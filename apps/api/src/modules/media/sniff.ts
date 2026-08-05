/**
 * Content sniffing — EF §3.5, first gate of the upload pipeline.
 *
 * THE RULE: the file type is whatever the BYTES say it is. The filename
 * extension and the client's `Content-Type` are attacker-controlled strings;
 * they are never read here, and the value the client sent is never persisted
 * (0008 deliberately stores only our encoder's output MIME) so that no future
 * reader can be tempted to trust it.
 *
 * Two separate questions, kept separate on purpose:
 *   1. `sniff()`  — what IS this? Recognises far more formats than we accept,
 *      including the dangerous ones, so the rejection message can be specific
 *      ("SVG is not accepted") instead of a shrug. A specific 400 is worth a
 *      lot: the alternative is a user with a perfectly ordinary photo staring
 *      at "invalid file".
 *   2. `isAllowedInput()` — may we accept it? A short allowlist.
 *
 * WHY SVG IS NOT ON THE ALLOWLIST: an SVG is an XML document that may contain
 * `<script>`, `<foreignObject>`, event handlers and external references. Served
 * from the media origin it executes in that origin's context, and any future
 * decision to serve media from the app origin would turn every uploaded avatar
 * into stored XSS. It is also not a raster image, so the re-encode step that
 * neutralises every other format does not apply to it in the same way. It is
 * recognised and refused by name.
 *
 * Sniffing alone is NOT the defence — a polyglot file can carry a valid PNG
 * header and a zip/script payload in a trailing chunk and will sniff as PNG.
 * The defence is the re-encode in `images.ts`: only decoded pixels survive, so
 * whatever rode along in the container is discarded. Sniffing is what stops the
 * pipeline from ever handing a non-image (or an SVG) to the decoder in the
 * first place.
 */

/** MIME types the pipeline will decode. */
export const ALLOWED_INPUT_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

export type AllowedInputMime = (typeof ALLOWED_INPUT_MIME)[number];

export interface SniffResult {
  /** Detected media type, e.g. `image/png`. */
  mime: string;
  /** Human label used in rejection messages. */
  label: string;
  /** True when the pipeline is willing to decode it. */
  allowed: boolean;
  /** Set when we want to say something more useful than "not allowed". */
  reason?: string;
}

const startsWith = (buf: Buffer, bytes: readonly number[], offset = 0): boolean => {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
};

const ascii = (buf: Buffer, offset: number, length: number): string =>
  buf.length >= offset + length ? buf.subarray(offset, offset + length).toString('latin1') : '';

/**
 * ISO-BMFF brands that mean "HEIF still image". `avif`/`avis` are the AV1
 * flavour of the same container — sharp decodes them, but they are NOT on the
 * input allowlist for this build (one line away if product wants them).
 */
const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);

const AVIF_BRANDS = new Set(['avif', 'avis']);

/** Leading whitespace/BOM an XML document is allowed to carry. */
const stripXmlLeader = (text: string): string => text.replace(/^\uFEFF/, '').trimStart();

/**
 * Identifies a buffer from its magic bytes. Returns `null` when nothing matches
 * — an unknown binary is refused exactly like a known-bad one, it just gets a
 * generic message.
 *
 * Only the first ~1 KiB is ever examined; everything after that is payload as
 * far as identification is concerned.
 */
export function sniff(input: Buffer): SniffResult | null {
  const buf = input.subarray(0, 1024);
  if (buf.length < 4) return null;

  // --- accepted raster formats ---------------------------------------------

  // JPEG: SOI + first marker. (JFIF/Exif/SPIFF all share this prefix.)
  if (startsWith(buf, [0xff, 0xd8, 0xff])) {
    return { mime: 'image/jpeg', label: 'JPEG', allowed: true };
  }

  // PNG: the 8-byte signature, including the CRLF/EOF trap bytes.
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', label: 'PNG', allowed: true };
  }

  // WebP: RIFF container whose form type is 'WEBP'.
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') {
    return { mime: 'image/webp', label: 'WebP', allowed: true };
  }

  // HEIF family: ISO base media file format, 'ftyp' box at offset 4.
  if (ascii(buf, 4, 4) === 'ftyp') {
    const brand = ascii(buf, 8, 4);
    if (HEIC_BRANDS.has(brand)) {
      return { mime: 'image/heic', label: 'HEIC', allowed: true };
    }
    if (AVIF_BRANDS.has(brand)) {
      return {
        mime: 'image/avif',
        label: 'AVIF',
        allowed: false,
        reason: 'AVIF is not accepted yet. Upload a JPEG, PNG, WebP or HEIC image.',
      };
    }
    return {
      mime: 'application/octet-stream',
      label: `ISO media (${brand || 'unknown'})`,
      allowed: false,
      reason: 'Video and other ISO media files are not accepted.',
    };
  }

  // --- recognised, deliberately refused ------------------------------------

  // SVG. Text format, so it is sniffed as text: XML declaration, DOCTYPE,
  // comment or the root element itself, in any order of leading whitespace.
  const head = stripXmlLeader(buf.toString('utf8', 0, Math.min(buf.length, 512)));
  if (/^<\?xml[\s?]/i.test(head) || /^<!doctype\s+svg/i.test(head) || /^<svg[\s>]/i.test(head)) {
    if (/<svg[\s>]/i.test(head) || /^<!doctype\s+svg/i.test(head)) {
      return {
        mime: 'image/svg+xml',
        label: 'SVG',
        allowed: false,
        // Say why. An SVG upload is usually an honest logo, not an attack.
        reason:
          'SVG is not accepted: it is a script-capable document, not a raster image. ' +
          'Export it to PNG or WebP first.',
      };
    }
    return {
      mime: 'application/xml',
      label: 'XML',
      allowed: false,
      reason: 'XML documents are not accepted.',
    };
  }

  if (ascii(buf, 0, 5) === '%PDF-') {
    return {
      mime: 'application/pdf',
      label: 'PDF',
      allowed: false,
      reason: 'PDFs are not accepted. Upload an image.',
    };
  }

  // GIF. Refused rather than decoded: BrewCult has no product need for
  // animation, and GIF is the classic polyglot carrier (a valid header followed
  // by an arbitrary appended payload). Refusing at the sniff gate means those
  // bytes never reach the decoder at all.
  if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') {
    return {
      mime: 'image/gif',
      label: 'GIF',
      allowed: false,
      reason: 'GIF is not accepted. Upload a JPEG, PNG, WebP or HEIC image.',
    };
  }

  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) {
    return {
      mime: 'application/zip',
      label: 'ZIP',
      allowed: false,
      reason: 'Archives are not accepted.',
    };
  }

  // Windows PE / ELF / Mach-O / shell script — never an image, always worth
  // naming in the log.
  if (ascii(buf, 0, 2) === 'MZ') {
    return { mime: 'application/x-msdownload', label: 'Windows executable', allowed: false };
  }
  if (startsWith(buf, [0x7f, 0x45, 0x4c, 0x46])) {
    return { mime: 'application/x-elf', label: 'ELF executable', allowed: false };
  }
  if (ascii(buf, 0, 2) === '#!') {
    return { mime: 'text/x-shellscript', label: 'shell script', allowed: false };
  }
  if (/^<(!doctype\s+html|html)[\s>]/i.test(head)) {
    return {
      mime: 'text/html',
      label: 'HTML',
      allowed: false,
      reason: 'HTML documents are not accepted.',
    };
  }
  if (startsWith(buf, [0x42, 0x4d])) {
    return {
      mime: 'image/bmp',
      label: 'BMP',
      allowed: false,
      reason: 'BMP is not accepted. Upload a JPEG, PNG, WebP or HEIC image.',
    };
  }
  if (startsWith(buf, [0x49, 0x49, 0x2a, 0x00]) || startsWith(buf, [0x4d, 0x4d, 0x00, 0x2a])) {
    return {
      mime: 'image/tiff',
      label: 'TIFF',
      allowed: false,
      reason: 'TIFF is not accepted. Upload a JPEG, PNG, WebP or HEIC image.',
    };
  }

  return null;
}

/** True when `mime` is a type the pipeline will hand to the decoder. */
export function isAllowedInput(mime: string): mime is AllowedInputMime {
  return (ALLOWED_INPUT_MIME as readonly string[]).includes(mime);
}
