/**
 * Media client — the browser half of the media API (Lane M).
 *
 * Everything goes through `lib/api.ts#apiFetch`, which owns credentials, the
 * single 401 → refresh → retry dance, the CSRF double-submit token and the
 * friendly-error mapping. This module never forks that wrapper; it adds:
 *
 *  1. **Multipart upload.** `POST /api/v1/media` with a `file` field. The body is
 *     a `FormData`, which `apiFetch` passes through untouched — the
 *     `Content-Type` header is deliberately NOT set so the browser can add the
 *     multipart boundary. Setting it by hand produces a request no server can
 *     parse, and it is the single most common way this endpoint gets broken.
 *  2. **Tolerant readers.** The API is in flight and entity payloads are about to
 *     grow an image field whose exact spelling is not settled
 *     (`image_url` / `imageUrl` / `image` / `avatar_url` / …). {@link readImageUrl}
 *     accepts all of them and answers `null` for anything it does not recognise,
 *     so a shape change degrades to today's text-only rendering instead of
 *     throwing inside a server component.
 *  3. **Graceful absence.** The endpoints may 404/501 until Lane M ships.
 *     {@link isMediaUnavailable} lets every surface say "not switched on yet"
 *     rather than "something went wrong", and nothing in this module ever makes
 *     a media failure fatal to the thing it decorates.
 *  4. **A pending-photo stash** for the brew logger, so a photo taken with no
 *     signal survives a reload and uploads later — without the brew ever waiting
 *     for it (docs/brew_logger_ux.md §4: the photo never blocks the log).
 *
 * ── File handling ────────────────────────────────────────────────────────────
 * File *contents* are never logged, never put in an error string and never sent
 * anywhere but the upload endpoint. `no-console` is an error repo-wide; this
 * module additionally keeps every failure message derived from the API's error
 * envelope, never from the bytes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { ApiError, apiFetch, isApiError, type ApiRequestOptions } from './api';
import type { OfflineStore } from './offline/store';

export const MEDIA_PATHS = {
  media: '/api/v1/media',
  byId: (id: string) => `/api/v1/media/${encodeURIComponent(id)}`,
  avatar: '/api/v1/users/me/avatar',
  adminAttach: '/api/v1/admin/media/attach',
} as const;

/**
 * What an upload is *for*. The API requires it as a query parameter and
 * validates it before reading a byte of the body, and it decides who may
 * upload: `avatar` and `brew_photo` are self-serve, the three catalog kinds are
 * staff-only (media module public interface).
 */
export const MEDIA_KINDS = [
  'avatar',
  'brew_photo',
  'coffee_image',
  'equipment_image',
  'roaster_logo',
  /** A photo attached to a catalogue suggestion — yours, private, never published. */
  'equipment_submission',
] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Which upload kind belongs on which catalog entity, mirroring the API. */
export const KIND_FOR_TARGET: Record<MediaTargetType, MediaKind> = {
  coffee_product: 'coffee_image',
  equipment_model: 'equipment_image',
  roaster: 'roaster_logo',
};

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/** What `POST /api/v1/media` and `GET /api/v1/media/:id` answer. */
export interface MediaAsset {
  id: string;
  url: string;
  /** Smaller derivative when the API made one; falls back to `url`. */
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  mime_type: string | null;
}

export type MediaTargetType = 'coffee_product' | 'equipment_model' | 'roaster';

export interface MediaAttachInput {
  media_id: string;
  target_type: MediaTargetType;
  target_id: string;
}

/* ------------------------------------------------------------------ *
 * Client-side limits — a courtesy, never the authority
 * ------------------------------------------------------------------ */

/**
 * Mirrors the API's `MAX_UPLOAD_BYTES` (modules/media/images.ts). Refusing an
 * oversize file here saves the user from spending mobile data on an upload the
 * parser will abort mid-stream anyway. The server's cap remains the authority —
 * if it ever tightens, its 413 is what the person sees.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * What the API's magic-byte sniffer accepts. SVG is refused there by name (it
 * is a script-capable document, not a raster image), so it is not offered here
 * either. HEIC matters: it is what an iPhone camera actually produces.
 */
export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

/** `accept` attribute for the file input. `image/*` also lets a phone offer the
 *  camera; the explicit list is the belt to that pair of braces. */
export const IMAGE_ACCEPT = 'image/*';

/**
 * The one line of privacy copy shown wherever a person uploads a photo.
 * It is true because the API re-encodes every upload, which drops EXIF.
 */
export const PHOTO_PRIVACY_NOTE = 'Location data is stripped from photos when they upload.';

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/**
 * Pre-flight a file in the browser. Returns a line of copy to show, or null
 * when the file is worth trying. Never throws.
 */
export function validateImageFile(file: File | Blob | null | undefined): string | null {
  if (!file) return null;
  const type = (file.type || '').toLowerCase();
  if (type !== '' && !type.startsWith('image/')) {
    return 'That file is not an image. JPEG, PNG, WebP or HEIC all work.';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `That photo is ${formatBytes(file.size)} — anything under ${formatBytes(
      MAX_IMAGE_BYTES,
    )} works. A smaller export or a screenshot will do it.`;
  }
  if (file.size === 0) return 'That file came through empty. Try picking it again.';
  return null;
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/** The endpoint is not deployed yet (or was removed). Not the user's problem. */
export function isMediaUnavailable(error: unknown): boolean {
  return isApiError(error) && (error.status === 404 || error.status === 501 || error.status === 405);
}

/** We never reached the server: offline, DNS, a dead socket. */
export function isOfflineError(error: unknown): boolean {
  return isApiError(error) && error.status === 0;
}

/** Retrying later could plausibly work (offline, rate limit, server wobble). */
export function isRetryableMediaError(error: unknown): boolean {
  if (!isApiError(error)) return false;
  if (error.status === 0 || error.status === 408 || error.status === 429) return true;
  return error.status >= 500 && error.status !== 501;
}

const TOO_BIG = `That photo is over the ${formatBytes(MAX_IMAGE_BYTES)} limit. A smaller export will go through.`;
const WRONG_TYPE = 'That file type is not supported. JPEG, PNG, WebP or HEIC all work.';
const UNREADABLE = "We couldn't read that image. Try a different file, or re-export it as JPEG.";
const OUT_OF_ROOM = 'Your photo storage is full. Removing an old photo makes room for this one.';

const MEDIA_ERROR_BY_CODE: Record<string, string> = {
  file_too_large: TOO_BIG,
  payload_too_large: TOO_BIG,
  unsupported_media_type: WRONG_TYPE,
  invalid_file_type: WRONG_TYPE,
  invalid_image: UNREADABLE,
  quota_exceeded: OUT_OF_ROOM,
  storage_quota_exceeded: OUT_OF_ROOM,
};

const MEDIA_ERROR_BY_STATUS: Record<number, string> = {
  413: TOO_BIG,
  415: WRONG_TYPE,
  422: UNREADABLE,
  507: OUT_OF_ROOM,
};

/**
 * One line of copy for any media failure. Anti-gatekeeping (§9.7/§10.2): it
 * says what happened and what to do, and never blames the person.
 *
 * The file itself is never referenced beyond its size — no name, no bytes.
 *
 * 400 and 429 defer to the API's own wording: the media module writes a
 * genuinely specific line for both ("not an image we recognise…", "you've
 * uploaded 40 images in the last 24 hours…"), and the generic mapping in
 * lib/api.ts would replace real information with a shrug.
 */
export function describeMediaError(error: unknown): string {
  if (isMediaUnavailable(error)) {
    return 'Photos are not switched on yet. Everything else saved normally.';
  }
  if (isOfflineError(error)) {
    return "You're offline, so the photo is waiting on this device. It uploads when you have signal.";
  }
  if (!isApiError(error)) return 'That upload did not go through. Try again in a moment.';

  const serverSaidSomethingUseful =
    (error.status === 400 || error.status === 429) && error.message !== '';

  return (
    MEDIA_ERROR_BY_CODE[error.code] ??
    MEDIA_ERROR_BY_STATUS[error.status] ??
    (serverSaidSomethingUseful ? error.message : error.userMessage)
  );
}

/* ------------------------------------------------------------------ *
 * Normalisation — tolerant on the way in, strict on the way out
 * ------------------------------------------------------------------ */

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Read whatever the media endpoint answered into a {@link MediaAsset}, or null
 * when it is unrecognisable. `id` and `url` are the only required fields —
 * everything else is decoration a card can live without.
 */
export function normalizeMedia(raw: unknown): MediaAsset | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  // Some APIs wrap the resource: { media: {...} } / { data: {...} }.
  const inner = record['media'] ?? record['data'] ?? record['asset'];
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    const unwrapped = normalizeMedia(inner);
    if (unwrapped) return unwrapped;
  }

  const id = asText(record['id']) ?? asText(record['media_id']) ?? asText(record['mediaId']);
  const url =
    asText(record['url']) ??
    asText(record['image_url']) ??
    asText(record['imageUrl']) ??
    asText(record['src']);
  if (id === null || url === null) return null;

  return {
    id,
    url,
    thumbnail_url: asText(record['thumbnail_url']) ?? asText(record['thumbnailUrl']),
    width: asSize(record['width']),
    height: asSize(record['height']),
    mime_type: asText(record['mime_type']) ?? asText(record['mimeType']) ?? asText(record['type']),
  };
}

/** Keys an entity might carry its picture under, most specific first. */
const IMAGE_KEYS = [
  'image_url',
  'imageUrl',
  'image',
  'photo_url',
  'photoUrl',
  'photo',
  'hero_image_url',
  'heroImageUrl',
  'hero_image',
  'primary_image',
  'primaryImage',
  'avatar_url',
  'avatarUrl',
  'avatar',
  'media',
  'images',
  'thumbnail_url',
  'thumbnailUrl',
] as const;

const URL_KEYS_FULL = ['url', 'src', 'href', 'image_url', 'imageUrl', 'thumbnail_url', 'thumbnailUrl'];
const URL_KEYS_THUMB = ['thumbnail_url', 'thumbnailUrl', 'url', 'src', 'href', 'image_url', 'imageUrl'];

function urlFromValue(value: unknown, prefer: 'full' | 'thumbnail'): string | null {
  const direct = asText(value);
  if (direct !== null) return direct;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = urlFromValue(entry, prefer);
      if (found !== null) return found;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of prefer === 'thumbnail' ? URL_KEYS_THUMB : URL_KEYS_FULL) {
      const found = asText(record[key]);
      if (found !== null) return found;
    }
  }
  return null;
}

/**
 * The image URL for an arbitrary entity payload, read across every spelling the
 * API might land on. Answers null when there is no image — which is the normal
 * case today and must render as the existing text-only card, not as a broken
 * one.
 *
 * `prefer: 'thumbnail'` picks the small derivative when the payload carries
 * both; it still falls back to the full-size URL rather than rendering nothing.
 */
export function readImageUrl(
  entity: unknown,
  options: { prefer?: 'full' | 'thumbnail' } = {},
): string | null {
  if (!entity || typeof entity !== 'object') return null;
  const prefer = options.prefer ?? 'full';
  const record = entity as Record<string, unknown>;

  for (const key of IMAGE_KEYS) {
    if (!(key in record)) continue;
    const found = urlFromValue(record[key], prefer);
    if (found !== null) return found;
  }
  return null;
}

/** The same tolerance, aimed at a user/profile payload. */
export function readAvatarUrl(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const record = user as Record<string, unknown>;
  for (const key of ['avatar_url', 'avatarUrl', 'avatar', 'image_url', 'imageUrl', 'image']) {
    if (!(key in record)) continue;
    const found = urlFromValue(record[key], 'full');
    if (found !== null) return found;
  }
  return null;
}

/**
 * Up to two initials for the avatar fallback. Handles "Anna Ortiz" → "AO",
 * "@anna" → "A", "anna-ortiz" → "AO". Answers "" when there is nothing to
 * work with, so the caller can draw a neutral mark instead of a stray letter.
 */
export function initialsFrom(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const cleaned = (candidate ?? '').replace(/^@+/, '').trim();
    if (cleaned === '') continue;
    const words = cleaned.split(/[\s._-]+/).filter((word) => word !== '');
    const letters = words
      .map((word) => [...word][0] ?? '')
      .filter((letter) => /\p{L}|\p{N}/u.test(letter))
      .slice(0, 2)
      .join('');
    if (letters !== '') return letters.toUpperCase();
  }
  return '';
}

/* ------------------------------------------------------------------ *
 * Calls
 * ------------------------------------------------------------------ */

/**
 * `POST /api/v1/media?kind=…` — multipart, field name `file`.
 *
 * Two details the API is strict about:
 *
 *  - **`kind` is required**, and it travels as a *query parameter* so the API
 *    can reject an unwanted upload before reading a byte of the body. It is
 *    also repeated as a form field, which is the fallback the route accepts for
 *    plain HTML form posts.
 *  - **No `Content-Type` header.** `apiFetch` passes a `FormData` body straight
 *    through and only sets JSON's content type, so the browser adds
 *    `multipart/form-data; boundary=…` itself. That boundary is the whole point;
 *    setting the header by hand produces a request no parser can read.
 */
export async function uploadMedia(
  file: File | Blob,
  kind: MediaKind,
  options: ApiRequestOptions = {},
): Promise<MediaAsset> {
  const form = new FormData();
  const filename = file instanceof File ? file.name : 'upload';
  form.append('file', file, filename);
  form.append('kind', kind);

  const raw = await apiFetch<unknown>(
    `${MEDIA_PATHS.media}?${new URLSearchParams({ kind }).toString()}`,
    {
      ...options,
      method: 'POST',
      body: form,
    },
  );

  const asset = normalizeMedia(raw);
  if (asset === null) {
    // A 2xx we cannot read is still a failure, and it must look like one.
    throw new ApiError(502, { error: 'invalid_media_response', message: '' });
  }
  return asset;
}

export async function fetchMedia(id: string, options?: ApiRequestOptions): Promise<MediaAsset | null> {
  return normalizeMedia(await apiFetch<unknown>(MEDIA_PATHS.byId(id), options));
}

export async function deleteMedia(id: string, options?: ApiRequestOptions): Promise<void> {
  await apiFetch<void>(MEDIA_PATHS.byId(id), { ...options, method: 'DELETE' });
}

/** `PUT /api/v1/users/me/avatar` — `null` clears the picture. */
export async function setAvatar(
  mediaId: string | null,
  options?: ApiRequestOptions,
): Promise<void> {
  await apiFetch<void>(MEDIA_PATHS.avatar, {
    ...options,
    method: 'PUT',
    body: { media_id: mediaId },
  });
}

/** `PUT /api/v1/admin/media/attach` — staff only, MFA-gated by the API. */
export async function attachMedia(
  input: MediaAttachInput,
  options?: ApiRequestOptions,
): Promise<void> {
  await apiFetch<void>(MEDIA_PATHS.adminAttach, { ...options, method: 'PUT', body: input });
}

/* ------------------------------------------------------------------ *
 * Pending photos — the offline half of the logger's photo affordance
 * ------------------------------------------------------------------ *
 *
 * A brew is logged the instant it is written to the device (brew_logger_ux §5).
 * A photo taken alongside it is a *decoration of a row that already exists*, so
 * it gets its own little queue rather than a place in the brew queue: if the
 * upload never succeeds, nothing about the brew is affected.
 *
 * Photos are stashed as data URLs rather than Blobs because the offline store's
 * memory adapter (SSR, private-mode Safari, tests) round-trips values through
 * JSON, and a Blob would silently become `{}`. The ~33% base64 overhead is the
 * price of the photo surviving a reload in every environment.
 */

export const PENDING_PHOTO_PREFIX = 'media:pending-photo:';

/** Bigger than this and we decline to stash rather than blow the storage quota. */
export const MAX_STASHED_PHOTO_BYTES = MAX_IMAGE_BYTES;

/** Give up after this many failed uploads; the brew is untouched either way. */
export const MAX_PHOTO_UPLOAD_ATTEMPTS = 6;

export interface PendingPhoto {
  /** The brew session this photo belongs to, once one exists. */
  session_id: string;
  /** `data:image/jpeg;base64,…` — see the note above on why not a Blob. */
  data_url: string;
  filename: string;
  /** Stored so a retry sends the same `?kind=` the first attempt did. */
  kind?: MediaKind;
  queued_at: string;
  attempts: number;
}

export function pendingPhotoKey(sessionId: string): string {
  return `${PENDING_PHOTO_PREFIX}${sessionId}`;
}

/** Read a Blob as a data URL. Resolves null rather than throwing. */
export function fileToDataUrl(file: Blob): Promise<string | null> {
  if (typeof FileReader === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.onabort = () => resolve(null);
      reader.readAsDataURL(file);
    } catch {
      resolve(null);
    }
  });
}

/** Turn a stashed data URL back into a File. Null when it cannot be decoded. */
export function dataUrlToFile(dataUrl: string, filename: string): File | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || 'application/octet-stream';
  const isBase64 = match[2] !== undefined;
  const payload = match[3] ?? '';
  try {
    if (!isBase64) {
      return new File([decodeURIComponent(payload)], filename, { type: mime });
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], filename, { type: mime });
  } catch {
    return null;
  }
}

/**
 * Park a photo for later. Returns false when it could not be stashed (too big,
 * unreadable, storage refused) — the caller should say so plainly rather than
 * promise an upload that will never happen.
 */
export async function stashPendingPhoto(
  store: OfflineStore,
  input: { sessionId: string; file: File | Blob; kind?: MediaKind; now?: () => number },
): Promise<boolean> {
  if (input.file.size > MAX_STASHED_PHOTO_BYTES) return false;
  const dataUrl = await fileToDataUrl(input.file);
  if (dataUrl === null) return false;

  const pending: PendingPhoto = {
    session_id: input.sessionId,
    data_url: dataUrl,
    filename: input.file instanceof File ? input.file.name : 'photo.jpg',
    kind: input.kind ?? 'brew_photo',
    queued_at: new Date((input.now ?? Date.now)()).toISOString(),
    attempts: 0,
  };

  try {
    await store.set(pendingPhotoKey(input.sessionId), pending);
    return true;
  } catch {
    return false;
  }
}

export async function pendingPhotos(store: OfflineStore): Promise<PendingPhoto[]> {
  try {
    const entries = await store.entries<PendingPhoto>(PENDING_PHOTO_PREFIX);
    return entries
      .map(([, value]) => value)
      .filter((value): value is PendingPhoto => Boolean(value?.session_id && value?.data_url))
      .sort((a, b) => (a.queued_at < b.queued_at ? -1 : 1));
  } catch {
    return [];
  }
}

export function dropPendingPhoto(store: OfflineStore, sessionId: string): Promise<void> {
  return store.delete(pendingPhotoKey(sessionId)).catch(() => undefined);
}

export interface FlushPendingPhotosOptions {
  store: OfflineStore;
  /** Called once per successful upload so the caller can amend its session. */
  attach: (sessionId: string, asset: MediaAsset) => Promise<void> | void;
  fetchImpl?: ApiRequestOptions['fetchImpl'];
  now?: () => number;
}

export interface FlushPendingPhotosResult {
  uploaded: number;
  remaining: number;
  dropped: number;
}

/**
 * Retry every parked photo. Safe to call on mount, on `online`, and twice at
 * once — the worst case is a duplicate upload of one photo, never a lost brew.
 *
 * Stops at the first transport failure: there is no point walking the rest of
 * the queue through a dead socket.
 */
export async function flushPendingPhotos(
  options: FlushPendingPhotosOptions,
): Promise<FlushPendingPhotosResult> {
  const queued = await pendingPhotos(options.store);
  const result: FlushPendingPhotosResult = { uploaded: 0, remaining: queued.length, dropped: 0 };

  for (const pending of queued) {
    const file = dataUrlToFile(pending.data_url, pending.filename);
    if (file === null) {
      await dropPendingPhoto(options.store, pending.session_id);
      result.remaining -= 1;
      result.dropped += 1;
      continue;
    }

    try {
      const asset = await uploadMedia(file, pending.kind ?? 'brew_photo', {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
      await dropPendingPhoto(options.store, pending.session_id);
      result.remaining -= 1;
      result.uploaded += 1;
      await options.attach(pending.session_id, asset);
    } catch (error) {
      const attempts = pending.attempts + 1;
      const giveUp = !isRetryableMediaError(error) || attempts >= MAX_PHOTO_UPLOAD_ATTEMPTS;
      if (giveUp) {
        await dropPendingPhoto(options.store, pending.session_id);
        result.remaining -= 1;
        result.dropped += 1;
      } else {
        await options.store
          .set(pendingPhotoKey(pending.session_id), { ...pending, attempts })
          .catch(() => undefined);
      }
      if (isOfflineError(error)) break;
    }
  }

  return result;
}
