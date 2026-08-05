/**
 * Fastify JSON schemas for every admin input (EF §3.3: "all input validated at
 * the API boundary against schemas", §3.8 "new input path? → schema-validated").
 *
 * `additionalProperties: false` everywhere — an unknown field on an operator
 * endpoint is a client bug or an attack, never something to silently ignore.
 * The controlled vocabularies below are the same lists the 0007 CHECK
 * constraints carry, so a bad value is a 400 with a useful message instead of a
 * 500 from the database.
 */

import {
  ASSIGNABLE_ROLES,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  SELLER_APPLICATION_STATUSES,
} from './types.js';

export const USER_STATUSES = ['active', 'suspended', 'deactivated', 'deleted'] as const;

// Pattern rather than `format: 'uuid'` so validation never depends on which
// format plugins the Ajv instance happens to carry (matching catalog).
const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const uuid = { type: 'string', pattern: UUID_RE } as const;
const cursor = { type: 'string', minLength: 1, maxLength: 512 } as const;
const limit = { type: 'integer', minimum: 1, maximum: 100, default: 20 } as const;
const timestamp = { type: 'string', minLength: 4, maxLength: 40 } as const;

/** Operator-authored free text that ends up in the audit trail. */
const reason = { type: 'string', minLength: 3, maxLength: 2000 } as const;

export const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: uuid },
};

/**
 * The "…/me" endpoints. Deliberately carries NO filter of any kind: the row
 * scope is the caller's own id, applied in SQL, and a query parameter that
 * could widen it is a hole waiting to be found.
 */
export const selfListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { cursor, limit },
};

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const adminUserListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    /** Prefix match on email OR handle. */
    q: { type: 'string', minLength: 1, maxLength: 200 },
    role: { type: 'string', enum: [...ASSIGNABLE_ROLES] },
    status: { type: 'string', enum: [...USER_STATUSES] },
    created_from: timestamp,
    created_to: timestamp,
    cursor,
    limit,
  },
};

export const suspendBody = {
  type: 'object',
  required: ['reason'],
  additionalProperties: false,
  // A suspension with no stated reason is unreviewable six months later, so the
  // reason is required rather than optional — it lands in the audit payload.
  properties: { reason },
};

export const reactivateBody = {
  type: 'object',
  additionalProperties: false,
  properties: { reason: { type: 'string', minLength: 3, maxLength: 2000 } },
};

export const roleChangeBody = {
  type: 'object',
  required: ['role'],
  additionalProperties: false,
  properties: {
    role: { type: 'string', enum: [...ASSIGNABLE_ROLES] },
    reason: { type: 'string', minLength: 3, maxLength: 2000 },
  },
};

export const forceLogoutBody = {
  type: 'object',
  additionalProperties: false,
  properties: { reason: { type: 'string', minLength: 3, maxLength: 2000 } },
};

// ---------------------------------------------------------------------------
// Audit viewer
// ---------------------------------------------------------------------------

export const auditListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    actor_id: uuid,
    action: { type: 'string', minLength: 1, maxLength: 100 },
    target_type: { type: 'string', minLength: 1, maxLength: 60 },
    target_id: { type: 'string', minLength: 1, maxLength: 200 },
    from: timestamp,
    to: timestamp,
    cursor,
    limit,
  },
};

// ---------------------------------------------------------------------------
// Seller applications
// ---------------------------------------------------------------------------

export const sellerApplicationCreateBody = {
  type: 'object',
  required: ['business_name', 'contact_email'],
  additionalProperties: false,
  properties: {
    business_name: { type: 'string', minLength: 2, maxLength: 200 },
    // `format: 'email'` is not assumed to be available; the shape check here
    // plus the citext CHECK in 0007 is the pair that actually holds.
    contact_email: { type: 'string', minLength: 3, maxLength: 254, pattern: '^[^@\\s]+@[^@\\s]+$' },
    notes: { type: ['string', 'null'], maxLength: 4000 },
  },
};

export const sellerApplicationListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: [...SELLER_APPLICATION_STATUSES] },
    user_id: uuid,
    cursor,
    limit,
  },
};

export const sellerApplicationDecisionBody = {
  type: 'object',
  additionalProperties: false,
  properties: { reason: { type: 'string', minLength: 3, maxLength: 2000 } },
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const reportCreateBody = {
  type: 'object',
  required: ['target_type', 'target_id', 'reason'],
  additionalProperties: false,
  properties: {
    target_type: { type: 'string', enum: [...REPORT_TARGET_TYPES] },
    target_id: { type: 'string', minLength: 1, maxLength: 200 },
    reason: { type: 'string', enum: [...REPORT_REASONS] },
    detail: { type: ['string', 'null'], maxLength: 4000 },
  },
};

export const reportListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: [...REPORT_STATUSES] },
    target_type: { type: 'string', enum: [...REPORT_TARGET_TYPES] },
    target_id: { type: 'string', minLength: 1, maxLength: 200 },
    reporter_id: uuid,
    cursor,
    limit,
  },
};

export const reportResolveBody = {
  type: 'object',
  required: ['outcome', 'resolution'],
  additionalProperties: false,
  properties: {
    outcome: { type: 'string', enum: ['actioned', 'dismissed'] },
    resolution: { type: 'string', minLength: 3, maxLength: 2000 },
  },
};
