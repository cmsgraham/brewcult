/**
 * Object storage seam — EF §3.5 ("served from a separate media domain via CDN,
 * no cookies, no same-origin privileges"), DG §5.3 (`media.brewcult.coffee`).
 *
 * ── WHY A SEAM AND NOT `new S3Client()` INLINE ──────────────────────────────
 * `MediaStorage` is four methods wide. The default implementation is
 * `@aws-sdk/client-s3`; the test suite injects an in-memory Map. That means the
 * unit/integration suite never needs a live MinIO, never mocks the SDK's
 * internals, and still exercises the real bytes that would have been written —
 * the tests assert on the exact buffer the pipeline produced.
 *
 * ── WHY @aws-sdk/client-s3 RATHER THAN THE `minio` CLIENT ───────────────────
 * The deployment story is MinIO in dev and on the VPS today (DG §3/§5.3), but
 * "today" is the operative word: the S3 API is the portable interface, and a
 * move to S3 proper, R2, B2 or Spaces is then an endpoint change in `.env`
 * rather than a rewrite. The AWS SDK is also the client every one of those
 * providers documents first, ships credential/retry/checksum handling we would
 * otherwise hand-roll, and is modular enough (`client-s3` only) that it does
 * not drag the whole AWS surface into the bundle. The `minio` package is a
 * pleasant client for MinIO specifically — which is the one thing we do not
 * want to be locked to.
 *
 * `@aws-sdk/s3-request-presigner` is deliberately NOT a dependency. Nothing in
 * this design signs a URL: uploads go through the API (a presigned PUT cannot
 * sniff or re-encode, which is the whole point of EF §3.5), and reads are
 * capability URLs on the media origin (see `publicUrl` below). Adding the
 * presigner would mean carrying a dependency for a code path that does not
 * exist. If media is ever made non-public-read it is one small module here.
 *
 * ── HOW READS ARE AUTHORIZED ────────────────────────────────────────────────
 * Object keys carry 128 bits of randomness, so a key is a capability: knowing
 * it is the only way to fetch it, and it cannot be guessed or enumerated. The
 * API answers "may this actor see this media row?" through the policy layer;
 * the bytes themselves are served by the media origin with no cookies and no
 * session, exactly as EF §3.5 requires, and are never proxied through the API.
 * This is the same model every large photo product uses for private-ish media,
 * and it is why the key generator below must never be simplified into something
 * derived from the media id.
 */

import { randomUUID, randomBytes } from 'node:crypto';
import {
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getEnv } from '../../lib/env.js';
import type { MediaKind } from './types.js';

export interface StoredObject {
  key: string;
  body: Buffer;
  contentType: string;
}

/** The whole contract this module has with object storage. */
export interface MediaStorage {
  put(object: StoredObject): Promise<void>;
  /** Best-effort removal. Missing keys are not an error. */
  remove(keys: readonly string[]): Promise<void>;
  /** Absolute URL on the cookie-less media origin. */
  publicUrl(key: string): string;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * Builds a non-guessable object key.
 *
 *   <kind>/<yyyy>/<mm>/<uuid><32 hex chars>.webp
 *
 * The `kind`/date prefix exists purely so a human staring at a bucket listing
 * during an incident can find things and so lifecycle rules can target a
 * prefix; it carries no user identifier, by design — a key must not leak WHOSE
 * photo it is to anyone who sees the URL. The random tail is 128 bits from
 * `randomBytes` on top of the uuid: the security property is "unguessable",
 * and that is a CSPRNG's job, not `Date.now()`'s.
 */
export function buildStorageKey(kind: MediaKind, extension = 'webp'): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const id = randomUUID().replace(/-/g, '');
  const salt = randomBytes(16).toString('hex');
  return `${kind}/${yyyy}/${mm}/${id}${salt}.${extension}`;
}

/** Thumbnail key derived from the original's, kept adjacent for lifecycle rules. */
export function thumbnailKeyFor(storageKey: string): string {
  const dot = storageKey.lastIndexOf('.');
  return dot === -1
    ? `${storageKey}_thumb`
    : `${storageKey.slice(0, dot)}_thumb${storageKey.slice(dot)}`;
}

/** `MEDIA_BASE_URL` + key, with exactly one slash between them. */
export function mediaUrl(key: string): string {
  const base = getEnv().MEDIA_BASE_URL.replace(/\/+$/, '');
  return `${base}/${key.replace(/^\/+/, '')}`;
}

// ---------------------------------------------------------------------------
// S3 / MinIO implementation
// ---------------------------------------------------------------------------

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  const env = getEnv();
  const config: S3ClientConfig = {
    endpoint: env.S3_ENDPOINT,
    // MinIO serves buckets as a path segment, not a DNS subdomain. Required for
    // any self-hosted S3-compatible endpoint; harmless against AWS proper.
    forcePathStyle: true,
    // Never used against a real AWS region, but the SDK requires one.
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
  };
  client = new S3Client(config);
  return client;
}

/** Test-only: drop the memoised client so a mutated env is re-read. */
export function resetStorageClient(): void {
  client = null;
}

export const s3Storage: MediaStorage = {
  async put({ key, body, contentType }) {
    await s3().send(
      new PutObjectCommand({
        Bucket: getEnv().S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Immutable content at an unguessable key: safe to cache for a year.
        // A "changed" image is a new key, never an overwrite.
        CacheControl: 'public, max-age=31536000, immutable',
        // Belt and braces for any origin that would otherwise sniff: the object
        // is what we say it is.
        ContentDisposition: 'inline',
      }),
    );
  },

  async remove(keys) {
    if (keys.length === 0) return;
    await s3().send(
      new DeleteObjectsCommand({
        Bucket: getEnv().S3_BUCKET,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  },

  publicUrl: mediaUrl,
};

/**
 * In-memory storage. Exported for the test suite (and useful for a local run
 * with no MinIO): it keeps the exact bytes the pipeline produced so a test can
 * assert on them.
 */
export function memoryStorage(): MediaStorage & { objects: Map<string, StoredObject> } {
  const objects = new Map<string, StoredObject>();
  return {
    objects,
    async put(object) {
      objects.set(object.key, object);
    },
    async remove(keys) {
      for (const key of keys) objects.delete(key);
    },
    publicUrl: mediaUrl,
  };
}
