/**
 * Request validation and response shapes.
 *
 * The type vocabulary appears here as a JSON-schema enum, in types.ts as a TS
 * union, and in 0009 as a CHECK constraint. Three copies is deliberate — each
 * layer enforces its own — and a test asserts they agree, so adding a type in
 * one place and forgetting the others fails the build rather than production.
 */
import { z } from 'zod';
import { NOTIFICATION_TYPES } from './types.js';

export const updatePreferenceBody = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  email_enabled: z.boolean(),
});

export type UpdatePreferenceBody = z.infer<typeof updatePreferenceBody>;

/**
 * Fastify serialises responses against this and DROPS undeclared fields, so a
 * property missing here is silently absent on the wire no matter what the
 * handler returned. (That exact failure cost us the `mfa` flag on /me.)
 */
export const preferencesResponseSchema = {
  type: 'object',
  required: ['preferences'],
  properties: {
    preferences: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'email_enabled'],
        properties: {
          type: { type: 'string', enum: [...NOTIFICATION_TYPES] },
          email_enabled: { type: 'boolean' },
        },
      },
    },
  },
} as const;

/**
 * The unsubscribe reply. Declared rather than left implicit so Fastify
 * serialises it deterministically — and so the answer is identical for a valid
 * and an invalid token, which is the point (see routes.ts).
 */
export const okResponseSchema = {
  type: 'object',
  required: ['status'],
  properties: { status: { type: 'string' } },
} as const;
