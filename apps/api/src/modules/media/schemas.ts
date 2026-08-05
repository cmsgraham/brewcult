/**
 * Fastify JSON schemas for every media input (EF §3.3: "all input validated at
 * the API boundary against schemas"; §3.8 "new input path? → schema-validated").
 *
 * `additionalProperties: false` everywhere — an unknown field is a client bug
 * or an attack, never something to silently ignore. The controlled
 * vocabularies are the same lists the 0008 CHECK constraints carry, so a bad
 * value is a 400 with a useful message instead of a 500 from the database.
 *
 * THE UPLOAD BODY IS NOT SCHEMA-VALIDATED, and cannot be: it is a multipart
 * stream. Its validation is the pipeline itself — magic-byte sniffing, the size
 * cap and the decode step in routes.ts — which is a far stronger check than any
 * schema could express. What IS schema-validated on that route is the `kind`
 * query parameter, so the one structured field the client controls goes through
 * the same gate as every other input.
 */

import { MEDIA_KINDS, ATTACH_TARGET_TYPES } from './types.js';

// Pattern rather than `format: 'uuid'` so validation never depends on which
// format plugins the Ajv instance happens to carry (matching catalog/admin).
const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const uuid = { type: 'string', pattern: UUID_RE } as const;
const nullableUuid = { type: ['string', 'null'], pattern: UUID_RE } as const;

export const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: uuid },
};

/**
 * `kind` on the upload route. Sent as a query parameter so it is validated
 * before a single byte of the body is read — the alternative (a multipart
 * field) is only readable after busboy has started parsing, which would mean
 * accepting the upload in order to find out we do not want it. The field form
 * is still accepted as a fallback for plain HTML form posts and is checked
 * against the same list in code.
 */
export const uploadQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: [...MEDIA_KINDS] },
  },
};

/** `PUT /v1/users/me/avatar`. `null` clears the avatar. */
export const avatarBody = {
  type: 'object',
  required: ['media_id'],
  additionalProperties: false,
  properties: { media_id: nullableUuid },
};

/** `PUT /v1/admin/media/attach`. `media_id: null` detaches. */
export const attachBody = {
  type: 'object',
  required: ['media_id', 'target_type', 'target_id'],
  additionalProperties: false,
  properties: {
    media_id: nullableUuid,
    target_type: { type: 'string', enum: [...ATTACH_TARGET_TYPES] },
    target_id: uuid,
  },
};
