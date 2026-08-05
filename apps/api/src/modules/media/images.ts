/**
 * Image re-encode — EF §3.5, second and decisive gate of the upload pipeline.
 *
 * THE PROPERTY THIS FILE BUYS: nothing the client uploaded is ever stored. The
 * bytes are decoded to a pixel buffer and a NEW file is written by our own
 * encoder. Everything that is not a pixel — appended payloads, trailing zip
 * archives, ICC-smuggled data, XMP, IPTC, comments, thumbnails and the entire
 * EXIF block including GPS — is simply not carried across, because there is no
 * code path here that copies it.
 *
 * That single structural fact is what defeats:
 *   • POLYGLOTS / APPENDED PAYLOADS. A file that is a valid PNG followed by a
 *     zip or a `<script>` blob decodes to exactly the PNG's pixels; the tail is
 *     never read by the encoder and never reaches storage.
 *   • STEGANOGRAPHY in metadata (and most LSB stego, which resize destroys).
 *   • EXIF GPS. A phone photo of a brew is taken in the user's kitchen and
 *     routinely carries coordinates good to a few metres — the user's home
 *     address. EF §4.1 forbids the platform to hold precise geolocation at all.
 *     sharp keeps metadata ONLY when explicitly asked via `.withMetadata()` /
 *     `.withExif()`. Neither is called here, and neither may ever be: an
 *     "improvement" that preserves the ICC profile or the capture date must not
 *     reach for `withMetadata()`, which would restore the GPS block along with
 *     it. Orientation — the one piece of EXIF that is load-bearing — is applied
 *     to the pixels by `.rotate()` and then discarded with the rest.
 *
 * DECOMPRESSION BOMBS: `limitInputPixels` caps the decoded pixel count, so a
 * 5 MB file that claims to be 60000×60000 is refused before allocation rather
 * than after the process dies. `animated: false` means only the first frame of
 * a multi-frame WebP is ever decoded.
 */

import sharp, { type Metadata, type Sharp } from 'sharp';

/** Hard size cap on the uploaded bytes (EF §3.5 "size caps"). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Long edge of the normalised original. */
export const MAX_LONG_EDGE = 2048;

/** Long edge of the derivative used in lists and cards. */
export const THUMBNAIL_LONG_EDGE = 400;

/**
 * Decoded-pixel ceiling (≈ 8000×8000). Generous for any real photograph, fatal
 * for a decompression bomb.
 */
export const MAX_INPUT_PIXELS = 64_000_000;

/** Output encoder settings. WebP at these qualities is visually transparent
 *  for photographs at a fraction of the JPEG size, and is supported by every
 *  browser BrewCult targets (DG §5.3 serves it from the media origin). */
const ORIGINAL_QUALITY = 82;
const THUMBNAIL_QUALITY = 75;

/** The MIME the encoder emits. Stored verbatim in `media.mime_type`. */
export const OUTPUT_MIME = 'image/webp';

/** Thrown when the input is not a decodable image. Mapped to a 400 by routes. */
export class ImageRejected extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ImageRejected';
  }
}

export interface Rendition {
  body: Buffer;
  contentType: string;
  width: number;
  height: number;
}

export interface ProcessedImage {
  original: Rendition;
  thumbnail: Rendition;
  /** Dimensions of the DECODED input, for logging/diagnostics only. */
  sourceWidth: number;
  sourceHeight: number;
}

/**
 * Opens a buffer for decoding with the safety limits applied.
 *
 * `failOn: 'error'` is the deliberate middle setting. sharp's default
 * ('warning') refuses files that merely have recoverable defects, which real
 * phone JPEGs occasionally do; 'none' would happily decode a truncated file
 * into a half-grey image. 'error' rejects anything genuinely malformed while
 * still accepting the messy-but-valid photographs users actually own.
 */
const open = (input: Buffer): Sharp =>
  sharp(input, {
    limitInputPixels: MAX_INPUT_PIXELS,
    sequentialRead: true,
    animated: false,
    failOn: 'error',
    unlimited: false,
  });

/**
 * Decodes `input` and re-emits it as a normalised original plus a thumbnail.
 *
 * Throws `ImageRejected` if the bytes do not decode — the caller must NOT
 * persist anything in that case (routes.ts writes the object only after this
 * returns, so a rejected upload leaves no trace in storage or in the database).
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw new ImageRejected('The uploaded file is empty.');
  if (input.length > MAX_UPLOAD_BYTES) {
    throw new ImageRejected(
      `That image is larger than the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`,
    );
  }

  let meta: Metadata;
  try {
    meta = await open(input).metadata();
  } catch (err) {
    throw new ImageRejected(
      'That file could not be read as an image.',
      err instanceof Error ? err.message : undefined,
    );
  }

  if (!meta.width || !meta.height) {
    throw new ImageRejected('That file could not be read as an image.');
  }
  if (meta.width * meta.height > MAX_INPUT_PIXELS) {
    throw new ImageRejected('That image has too many pixels to process.');
  }

  const original = await render(input, MAX_LONG_EDGE, ORIGINAL_QUALITY);
  const thumbnail = await render(input, THUMBNAIL_LONG_EDGE, THUMBNAIL_QUALITY);

  return { original, thumbnail, sourceWidth: meta.width, sourceHeight: meta.height };
}

/**
 * One rendition. The pipeline order matters:
 *   1. `.rotate()` with no argument bakes the EXIF orientation into the pixels.
 *      It MUST come before `.resize()`, or a portrait photo tagged "rotate 90°"
 *      is fitted to the box in landscape and comes out the wrong shape.
 *   2. `.resize(..., { fit: 'inside', withoutEnlargement: true })` bounds the
 *      long edge without upscaling small images.
 *   3. `.webp(...)` encodes. No `.withMetadata()` — see the file header.
 */
async function render(input: Buffer, longEdge: number, quality: number): Promise<Rendition> {
  try {
    const { data, info } = await open(input)
      .rotate()
      .resize({
        width: longEdge,
        height: longEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    return {
      body: data,
      contentType: OUTPUT_MIME,
      width: info.width,
      height: info.height,
    };
  } catch (err) {
    // Reached when the header parsed but the pixel data did not, e.g. a
    // truncated JPEG or a HEIC this build's libvips cannot decode.
    throw new ImageRejected(
      'That image could not be processed. It may be corrupt or in an unsupported variant.',
      err instanceof Error ? err.message : undefined,
    );
  }
}

/**
 * Test/diagnostic helper: does the buffer carry an EXIF block at all?
 *
 * Used by the suite to prove the fixture HAD GPS going in and that the stored
 * output has no metadata coming out. Not used by the pipeline itself — the
 * pipeline does not strip EXIF, it simply never writes any.
 */
export async function hasExif(buffer: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(buffer, { failOn: 'none' }).metadata();
    return Buffer.isBuffer(meta.exif) && meta.exif.length > 0;
  } catch {
    return false;
  }
}
