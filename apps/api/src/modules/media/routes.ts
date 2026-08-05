/**
 * Media HTTP surface — EF §3.5 (upload pipeline), §3.2 (policy layer), §3.8.
 *
 * ── WHY THE API IS IN THE BYTE PATH ─────────────────────────────────────────
 * The obvious design is a presigned PUT: the API hands the client a signed URL
 * and the client uploads straight to object storage. It is cheaper, it is what
 * BREW-06's one-line description says ("presigned URL"), and it CANNOT satisfy
 * EF §3.5. A presigned PUT means the bytes never pass through code we control,
 * so nothing sniffs them, nothing decodes them and nothing re-encodes them —
 * the object in the bucket is whatever the client chose to send, EXIF GPS and
 * appended payload included, and the media origin then serves it. The security
 * requirement and the presign shortcut are mutually exclusive, so the pipeline
 * is server-processed and this file is where that happens.
 *
 * (The lighter alternative — presign the upload, then re-process asynchronously
 * — was rejected too: it leaves a window in which the raw file is fetchable
 * from the bucket at a URL the uploader knows, which is exactly the artefact we
 * are trying not to create.)
 *
 * ── ORDER OF OPERATIONS ON UPLOAD, AND WHY ──────────────────────────────────
 *   1. authenticate            (requireAuth — 401 before anything is read)
 *   2. authorize 'create'      (policy layer; staff kinds need `isStaff`)
 *   3. quota                   (429 before the CPU is spent, not after)
 *   4. read ≤5 MB of body      (hard cap enforced by the parser AND checked)
 *   5. sniff magic bytes       (400 on anything not on the allowlist)
 *   6. decode + re-encode      (400 if it is not really an image)
 *   7. write objects
 *   8. insert the row 'ready'
 * Nothing is persisted before step 7, so a rejected upload leaves NO byte
 * anywhere — not in the bucket, not in the database, not in a temp file (the
 * body is buffered in memory, capped at 5 MB, and dropped).
 *
 * Steps 7 and 8 are in that order deliberately: a 'ready' row whose object is
 * missing renders as a broken image for everyone, while an object with no row
 * is invisible and swept later. If the insert fails the objects are removed on
 * the way out.
 */

import { createHash } from 'node:crypto';
import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireAuth } from '../../lib/auth-plugin.js';
import { ApiError, badRequest, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { ANONYMOUS, authorize, type Actor } from '../../lib/policy.js';
import { csrfGuard } from '../identity/index.js';
import { recordMediaAudit } from './audit.js';
import { ImageRejected, MAX_UPLOAD_BYTES, processImage } from './images.js';
import { MEDIA_RESOURCE } from './policies.js';
import * as repo from './repository.js';
import { defaultMediaDb, withTransaction } from './repository.js';
import { attachBody, avatarBody, idParams, uploadQuery } from './schemas.js';
import { enforceUploadQuota } from './quota.js';
import { isAllowedInput, sniff } from './sniff.js';
import { buildStorageKey, mediaUrl, s3Storage, thumbnailKeyFor, type MediaStorage } from './storage.js';
import {
  KIND_FOR_TARGET,
  MEDIA_KINDS,
  SELF_SERVE_KINDS,
  type AttachTargetType,
  type MediaDb,
  type MediaDto,
  type MediaKind,
  type MediaRow,
} from './types.js';

export interface MediaRouteOptions {
  /** Database seam; defaults to the shared pool. Tests inject PGlite. */
  db?: MediaDb;
  /** Object-storage seam; defaults to S3/MinIO. Tests inject an in-memory map. */
  storage?: MediaStorage;
  /** Path prefix for every route in this module. */
  prefix?: string;
}

/** Reads the actor decorated by the auth plugin; anonymous when absent. */
function actorOf(request: FastifyRequest): Actor {
  return (request as FastifyRequest & { actor?: Actor }).actor ?? ANONYMOUS;
}

/**
 * The acting user's id. `requireAuth` has already answered 401 on every route
 * that calls this; the throw is the type-level proof, not a second gate.
 */
function actorIdOf(request: FastifyRequest): string {
  const id = actorOf(request).userId;
  if (id === null) throw unauthorized();
  return id;
}

const payloadTooLarge = (message: string): ApiError =>
  new ApiError(413, 'payload_too_large', message);

const isSelfServe = (kind: MediaKind): boolean =>
  (SELF_SERVE_KINDS as readonly MediaKind[]).includes(kind);

/** Public projection. URLs are derived at read time, never stored (0008). */
export function toDto(row: MediaRow): MediaDto {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    mime_type: row.mime_type,
    byte_size: row.byte_size,
    width: row.width,
    height: row.height,
    url: mediaUrl(row.storage_key),
    thumbnail_url: row.thumbnail_key ? mediaUrl(row.thumbnail_key) : null,
    owner_id: row.owner_id,
    created_at: row.created_at,
  };
}

interface ReadUpload {
  buffer: Buffer;
  fields: Record<string, string>;
}

/**
 * Buffers the single uploaded file and any accompanying text fields.
 *
 * `request.parts()` is used rather than `request.file()` so field order does
 * not matter: a browser `FormData` may serialise `kind` after the file, and a
 * pipeline that only sees fields declared BEFORE the file is a support ticket
 * waiting to happen.
 *
 * The 5 MB ceiling is enforced by the parser (`limits.fileSize`), which aborts
 * mid-stream — the process never buffers more than the cap regardless of what
 * Content-Length claimed.
 */
async function readUpload(request: FastifyRequest): Promise<ReadUpload> {
  if (!request.isMultipart()) {
    throw badRequest('Send the image as multipart/form-data with a "file" part.');
  }

  const fields: Record<string, string> = {};
  let buffer: Buffer | null = null;

  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (buffer !== null) {
          // Draining and ignoring a second file would silently discard what the
          // user thought they were uploading.
          throw badRequest('Upload one image at a time.');
        }
        buffer = await part.toBuffer();
      } else if (typeof part.value === 'string' && part.value.length <= 200) {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const code = (err as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT') {
      throw payloadTooLarge(
        `That image is larger than the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit. ` +
          'Most phones can export a smaller copy.',
      );
    }
    throw badRequest('That upload could not be read.');
  }

  if (!buffer || buffer.length === 0) {
    throw badRequest('No file was uploaded. Attach the image as the "file" part.');
  }
  return { buffer, fields };
}

/** `kind` from the query string, falling back to a multipart field. */
function resolveKind(fromQuery: string | undefined, fields: Record<string, string>): MediaKind {
  const raw = fromQuery ?? fields.kind;
  if (!raw) {
    throw badRequest(
      `Tell us what this image is for: ?kind=${MEDIA_KINDS.join('|')}.`,
    );
  }
  if (!(MEDIA_KINDS as readonly string[]).includes(raw)) {
    throw badRequest(`Unknown media kind '${raw}'.`);
  }
  return raw as MediaKind;
}

export async function registerMediaRoutes(
  app: FastifyInstance,
  options: MediaRouteOptions = {},
): Promise<void> {
  const db = options.db ?? defaultMediaDb;
  const storage = options.storage ?? s3Storage;
  const prefix = options.prefix ?? '/v1';

  /** Authenticated + CSRF-protected: every mutation on this surface. */
  const mutation = { preHandler: [requireAuth, csrfGuard] };

  /**
   * Type-level staff gate, applied BEFORE any row is loaded — the same shape
   * the admin lane uses. `authorize(..., undefined)` hits the resource-less
   * branch of the media policy, which is `isStaff` (and therefore MFA-backed).
   */
  const staffGate = async (request: FastifyRequest): Promise<void> => {
    await authorize(actorOf(request), 'update', MEDIA_RESOURCE);
  };

  /**
   * Loads a media row plus its policy resource and authorizes in one place.
   * Every handler that names an id goes through this: there is no second path
   * to a media row, which is what makes the IDOR argument checkable.
   */
  const loadAuthorized = async (
    request: FastifyRequest,
    id: string,
    action: 'read' | 'update' | 'delete',
  ): Promise<MediaRow> => {
    const resource = await repo.loadMediaResource(db, id);
    // A uuid that does not exist is a 404 before the policy runs. That is not
    // an enumeration oracle at 122 bits of entropy, and answering 403 for
    // "typo in the id" would send clients hunting for a permission bug.
    if (!resource) throw notFound('Media not found.');
    await authorize(actorOf(request), action, MEDIA_RESOURCE, resource);
    const row = await repo.findMediaById(db, id);
    if (!row) throw notFound('Media not found.');
    return row;
  };

  await app.register(async (scope) => {
    // Encapsulated so the multipart content-type parser applies to this
    // module's routes only — no other lane's JSON endpoints change behaviour
    // because media exists.
    await scope.register(fastifyMultipart, {
      limits: {
        fileSize: MAX_UPLOAD_BYTES,
        files: 1,
        fields: 8,
        fieldSize: 1024,
        // Header count per part; the default is generous for our shape.
        parts: 12,
      },
      throwFileSizeLimit: true,
    });

    // -----------------------------------------------------------------------
    // POST /v1/media — the pipeline
    // -----------------------------------------------------------------------
    scope.post<{ Querystring: { kind?: MediaKind } }>(
      `${prefix}/media`,
      { ...mutation, schema: { querystring: uploadQuery } },
      async (request, reply) => {
        const actor = actorOf(request);
        const actorId = actorIdOf(request);
        await authorize(actor, 'create', MEDIA_RESOURCE);

        // Cheap pre-check: refuse an obviously oversized body before reading
        // any of it. The parser's own limit is the real enforcement (a client
        // can lie about or omit Content-Length), this just fails faster.
        const declared = Number(request.headers['content-length'] ?? 0);
        if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES * 1.05) {
          throw payloadTooLarge(
            `That image is larger than the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`,
          );
        }

        const kindFromQuery = request.query.kind;
        // Catalog imagery is platform content: staff only, and `isStaff`
        // additionally requires an MFA-backed session.
        if (kindFromQuery && !isSelfServe(kindFromQuery)) await staffGate(request);

        // The quota is per-account and applies to self-serve kinds only (see
        // quota.ts). Checked BEFORE the body is read so an over-quota client
        // does not get to spend our bandwidth to find out.
        if (!kindFromQuery || isSelfServe(kindFromQuery)) {
          await enforceUploadQuota(db, actorId);
        }

        const { buffer, fields } = await readUpload(request);
        const kind = resolveKind(kindFromQuery, fields);
        // Re-check for the multipart-field path, which was not known above.
        if (!isSelfServe(kind)) await staffGate(request);

        // --- GATE 1: what IS this? Magic bytes only. -------------------------
        const sniffed = sniff(buffer);
        if (!sniffed || !isAllowedInput(sniffed.mime)) {
          request.log.warn(
            {
              user_id: actorId,
              sniffed: sniffed?.mime ?? 'unknown',
              claimed: request.headers['content-type'],
              bytes: buffer.length,
            },
            'media upload rejected at content sniffing',
          );
          throw badRequest(
            sniffed?.reason ??
              (sniffed
                ? `${sniffed.label} files are not accepted. Upload a JPEG, PNG, WebP or HEIC image.`
                : 'That file is not an image we recognise. Upload a JPEG, PNG, WebP or HEIC image.'),
          );
        }

        // --- GATE 2: decode and re-encode. Only pixels survive. --------------
        let processed;
        try {
          processed = await processImage(buffer);
        } catch (err) {
          if (err instanceof ImageRejected) {
            request.log.warn(
              { user_id: actorId, sniffed: sniffed.mime, detail: err.detail },
              'media upload rejected at decode',
            );
            throw badRequest(err.message);
          }
          throw err;
        }

        const storageKey = buildStorageKey(kind);
        const thumbnailKey = thumbnailKeyFor(storageKey);
        const checksum = createHash('sha256').update(processed.original.body).digest('hex');

        await storage.put({
          key: storageKey,
          body: processed.original.body,
          contentType: processed.original.contentType,
        });
        await storage.put({
          key: thumbnailKey,
          body: processed.thumbnail.body,
          contentType: processed.thumbnail.contentType,
        });

        let row: MediaRow;
        try {
          row = await repo.insertMedia(db, {
            // Catalog imagery is platform-owned — see the 0008 header for why
            // it must not carry the uploading editor's id.
            ownerId: isSelfServe(kind) ? actorId : null,
            uploadedBy: actorId,
            kind,
            storageKey,
            thumbnailKey,
            mimeType: processed.original.contentType,
            byteSize: processed.original.body.length,
            width: processed.original.width,
            height: processed.original.height,
            checksumSha256: checksum,
            status: 'ready',
          });
        } catch (err) {
          // No row means nothing will ever reference these objects.
          await storage.remove([storageKey, thumbnailKey]).catch(() => {});
          throw err;
        }

        request.log.info(
          {
            media_id: row.id,
            kind,
            sniffed: sniffed.mime,
            source: `${processed.sourceWidth}x${processed.sourceHeight}`,
            stored: `${row.width}x${row.height}`,
            in_bytes: buffer.length,
            out_bytes: row.byte_size,
          },
          'media stored',
        );

        return reply.status(201).send(toDto(row));
      },
    );

    // -----------------------------------------------------------------------
    // GET /v1/media/:id — metadata + absolute URLs on the media origin.
    //
    // Deliberately NOT behind requireAuth: media attached to a public entity is
    // readable by anonymous visitors, which is what lets the web client render
    // a coffee card to a logged-out user. The policy decides; the transport
    // does not.
    // -----------------------------------------------------------------------
    scope.get<{ Params: { id: string } }>(
      `${prefix}/media/:id`,
      { schema: { params: idParams } },
      async (request) => toDto(await loadAuthorized(request, request.params.id, 'read')),
    );

    // -----------------------------------------------------------------------
    // DELETE /v1/media/:id — owner or staff.
    // -----------------------------------------------------------------------
    scope.delete<{ Params: { id: string } }>(
      `${prefix}/media/:id`,
      { ...mutation, schema: { params: idParams } },
      async (request) => {
        const actorId = actorIdOf(request);
        const row = await loadAuthorized(request, request.params.id, 'delete');

        // Objects first, row second: the reverse order can leave a 'deleted'
        // row whose bytes are still fetchable from the media origin, and the
        // whole point of a delete here is that the picture goes away.
        await storage.remove(row.thumbnail_key ? [row.storage_key, row.thumbnail_key] : [row.storage_key]);

        const deleted = await withTransaction(db, async (tx) => {
          const updated = await repo.softDeleteMedia(tx, row.id);
          if (!updated) return null;
          await recordMediaAudit(tx, {
            actorId,
            action: 'media.deleted',
            targetType: 'media',
            targetId: row.id,
            payload: {
              kind: row.kind,
              owner_id: row.owner_id,
              by_staff: row.owner_id !== actorId,
              byte_size: row.byte_size,
            },
          });
          return updated;
        });

        if (!deleted) throw notFound('Media not found.');
        return { id: row.id, status: 'deleted' as const };
      },
    );

    // -----------------------------------------------------------------------
    // PUT /v1/users/me/avatar — owner only.
    //
    // `media_id: null` clears the avatar. Setting a new one RETIRES the old
    // avatar (soft-delete + object removal): an avatar the profile no longer
    // shows is not something the platform should keep serving from a URL that
    // may still be pasted in someone's cache.
    // -----------------------------------------------------------------------
    scope.put<{ Body: { media_id: string | null } }>(
      `${prefix}/users/me/avatar`,
      { ...mutation, schema: { body: avatarBody } },
      async (request) => {
        const actorId = actorIdOf(request);
        const { media_id: mediaId } = request.body;

        if (mediaId !== null) {
          const row = await loadAuthorized(request, mediaId, 'update');
          // Ownership is the policy's job (above). These are the media's own
          // invariants: right kind, usable state.
          if (row.owner_id !== actorId) throw forbidden('That image is not yours.');
          if (row.kind !== 'avatar') {
            throw badRequest("That image was not uploaded as an avatar. Upload it with kind='avatar'.");
          }
          if (row.status !== 'ready') throw badRequest('That image is not ready to use.');
        }

        const result = await repo.setUserAvatar(db, actorId, mediaId);
        if (!result.found) throw notFound('Account not found.');

        const previousId = result.previous_media_id;
        if (previousId && previousId !== mediaId) {
          const previous = await repo.findMediaById(db, previousId);
          if (previous) {
            await storage.remove(
              previous.thumbnail_key
                ? [previous.storage_key, previous.thumbnail_key]
                : [previous.storage_key],
            );
            await repo.softDeleteMedia(db, previousId);
          }
        }

        await recordMediaAudit(db, {
          actorId,
          action: mediaId ? 'media.avatar_set' : 'media.avatar_cleared',
          targetType: 'user',
          targetId: actorId,
          payload: { media_id: mediaId, previous_media_id: previousId },
        });

        return {
          media_id: mediaId,
          previous_media_id: previousId,
          avatar: mediaId ? toDto(await requireRow(db, mediaId)) : null,
        };
      },
    );

    // -----------------------------------------------------------------------
    // PUT /v1/admin/media/attach — staff only (MFA-gated), audited.
    //
    // The previous image is DETACHED, not deleted: catalog imagery is
    // editorial, an editor swapping a bag shot may want the old one back, and
    // deleting platform content as a side effect of an update is the kind of
    // surprise an operator surface must not have. Staff delete explicitly via
    // DELETE /v1/media/:id.
    // -----------------------------------------------------------------------
    scope.put<{
      Body: { media_id: string | null; target_type: AttachTargetType; target_id: string };
    }>(
      `${prefix}/admin/media/attach`,
      { ...mutation, schema: { body: attachBody } },
      async (request) => {
        const actorId = actorIdOf(request);
        await staffGate(request);

        const { media_id: mediaId, target_type: targetType, target_id: targetId } = request.body;

        if (!(await repo.targetExists(db, targetType, targetId))) {
          throw notFound(`No ${targetType} with that id.`);
        }

        if (mediaId !== null) {
          const row = await loadAuthorized(request, mediaId, 'update');
          const expected = KIND_FOR_TARGET[targetType];
          if (row.kind !== expected) {
            throw badRequest(
              `That image was uploaded as '${row.kind}'; a ${targetType} needs one uploaded as '${expected}'.`,
            );
          }
          if (row.status !== 'ready') throw badRequest('That image is not ready to use.');
        }

        const result = await withTransaction(db, async (tx) => {
          const swap = await repo.setEntityImage(tx, targetType, targetId, mediaId);
          if (!swap.found) throw notFound(`No ${targetType} with that id.`);
          await recordMediaAudit(tx, {
            actorId,
            action: mediaId ? 'media.attached' : 'media.detached',
            targetType,
            targetId,
            payload: {
              media_id: mediaId,
              previous_media_id: swap.previous_media_id,
              target_type: targetType,
            },
          });
          return swap;
        });

        return {
          target_type: targetType,
          target_id: targetId,
          media_id: mediaId,
          previous_media_id: result.previous_media_id,
          image: mediaId ? toDto(await requireRow(db, mediaId)) : null,
        };
      },
    );
  });
}

/** Re-reads a row that was just validated; a miss here is a real 404 race. */
async function requireRow(db: MediaDb, id: string): Promise<MediaRow> {
  const row = await repo.findMediaById(db, id);
  if (!row) throw notFound('Media not found.');
  return row;
}
