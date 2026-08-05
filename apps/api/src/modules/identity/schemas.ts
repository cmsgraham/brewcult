/**
 * JSON Schemas for every identity route — EF §1.3 (contracts before clients),
 * §3.3 (all input validated at the API boundary).
 *
 * These are Fastify schemas, so they do three jobs at once: AJV validates and
 * coerces the request, fast-json-stringify serialises the response against an
 * allow-list of fields (a field the schema does not mention cannot leak, even
 * if a handler accidentally returns it), and @fastify/swagger renders them into
 * the OpenAPI document.
 *
 * `additionalProperties: false` everywhere on request bodies — unknown fields
 * are stripped rather than silently trusted.
 */

export const IDENTITY_TAG = 'identity';

// --- shared fragments --------------------------------------------------------

const email = { type: 'string', format: 'email', minLength: 3, maxLength: 254 } as const;
const password = { type: 'string', minLength: 12, maxLength: 128 } as const;
const handle = { type: 'string', minLength: 3, maxLength: 32, pattern: '^[A-Za-z0-9_]+$' } as const;
const uuid = { type: 'string', format: 'uuid' } as const;
const totpCode = { type: 'string', pattern: '^[0-9]{6}$' } as const;

export const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['error', 'message'],
} as const;

/**
 * The single response shape used by every enumeration-sensitive endpoint. It
 * carries no account-specific information, so "we sent you a code" and "there is
 * no such account" are byte-identical (DG §7.1).
 */
export const acceptedResponse = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['status', 'message'],
} as const;

export const publicProfileSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    handle: { type: 'string' },
    display_name: { type: ['string', 'null'] },
    bio: { type: ['string', 'null'] },
    created_at: { type: 'string' },
  },
} as const;

export const selfProfileSchema = {
  type: 'object',
  properties: {
    ...publicProfileSchema.properties,
    email: { type: 'string' },
    role: { type: 'string' },
    status: { type: 'string' },
    email_verified: { type: 'boolean' },
    mfa_enabled: { type: 'boolean' },
    // Session standing, not enrolment. Fastify serialises responses against
    // this schema and DROPS anything not declared here, so omitting it silently
    // hid the field the operator console gates on.
    mfa: { type: 'boolean' },
    last_seen_at: { type: ['string', 'null'] },
    identities: {
      type: 'array',
      items: {
        type: 'object',
        properties: { provider: { type: 'string' }, created_at: { type: 'string' } },
      },
    },
  },
} as const;

export const sessionTokensSchema = {
  type: 'object',
  properties: {
    access_token: { type: 'string' },
    refresh_token: { type: 'string' },
    token_type: { type: 'string' },
    expires_in: { type: 'integer' },
    session_id: { type: 'string' },
  },
} as const;

// --- auth --------------------------------------------------------------------

export const registerSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Register an email/password account',
  description:
    'Always answers 202 with an identical body whether or not the address is already ' +
    'registered (anti-enumeration, DG §7.1). A duplicate address receives a ' +
    '"someone tried to register" notice instead of a verification code.',
  body: {
    type: 'object',
    required: ['email', 'handle', 'password'],
    additionalProperties: false,
    properties: {
      email,
      handle,
      password,
      display_name: { type: 'string', maxLength: 80 },
    },
  },
  response: { 202: acceptedResponse, 400: errorResponse, 409: errorResponse },
} as const;

export const verifyEmailSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Confirm an email address with the 15-minute code',
  body: {
    type: 'object',
    required: ['email', 'code'],
    additionalProperties: false,
    properties: { email, code: { type: 'string', pattern: '^[0-9]{6}$' } },
  },
  response: { 200: acceptedResponse, 400: errorResponse },
} as const;

export const resendVerificationSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Re-send the email verification code',
  body: {
    type: 'object',
    required: ['email'],
    additionalProperties: false,
    properties: { email },
  },
  response: { 202: acceptedResponse },
} as const;

export const loginSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Sign in with email and password',
  description:
    'Returns tokens, or `{ mfa_required: true, mfa_token }` when the account has TOTP ' +
    'enabled. Sets the access and refresh cookies for browser clients.',
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: { email, password: { type: 'string', minLength: 1, maxLength: 128 } },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        ...sessionTokensSchema.properties,
        mfa_required: { type: 'boolean' },
        mfa_token: { type: 'string' },
      },
    },
    401: errorResponse,
    403: errorResponse,
    429: errorResponse,
  },
} as const;

export const mfaLoginSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Complete a sign-in by answering the TOTP challenge',
  body: {
    type: 'object',
    required: ['mfa_token'],
    additionalProperties: false,
    properties: {
      mfa_token: { type: 'string', minLength: 1 },
      code: totpCode,
      recovery_code: { type: 'string', minLength: 4, maxLength: 64 },
    },
  },
  response: { 200: sessionTokensSchema, 401: errorResponse },
} as const;

export const refreshSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Rotate the refresh token',
  description:
    'Presenting an already-rotated token is treated as theft: the entire token family is ' +
    'revoked and the call fails (EF §2.3).',
  // Nullable: a browser sends the token in the `bc_refresh` cookie and posts no
  // body at all, so an absent body must validate rather than 400.
  body: {
    type: ['object', 'null'],
    additionalProperties: false,
    properties: { refresh_token: { type: 'string', minLength: 1 } },
  },
  response: { 200: sessionTokensSchema, 401: errorResponse },
} as const;

export const logoutSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Sign out — revokes the current refresh-token family',
  body: {
    type: ['object', 'null'],
    additionalProperties: false,
    properties: { refresh_token: { type: 'string', minLength: 1 } },
  },
  response: { 200: acceptedResponse },
} as const;

export const forgotPasswordSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Request a password-reset link',
  description: 'Always 202, identical body regardless of account existence.',
  body: {
    type: 'object',
    required: ['email'],
    additionalProperties: false,
    properties: { email },
  },
  response: { 202: acceptedResponse },
} as const;

export const resetPasswordSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Complete a password reset with a single-use token',
  body: {
    type: 'object',
    required: ['token', 'password'],
    additionalProperties: false,
    properties: { token: { type: 'string', minLength: 1, maxLength: 200 }, password },
  },
  response: { 200: acceptedResponse, 400: errorResponse },
} as const;

export const changePasswordSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Change your own password',
  body: {
    type: 'object',
    required: ['current_password', 'new_password'],
    additionalProperties: false,
    properties: {
      current_password: { type: 'string', minLength: 1, maxLength: 128 },
      new_password: password,
    },
  },
  response: { 200: acceptedResponse, 400: errorResponse, 401: errorResponse },
} as const;

export const requestEmailChangeSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Request an email-address change (verification sent to the new address)',
  body: {
    type: 'object',
    required: ['new_email', 'current_password'],
    additionalProperties: false,
    properties: { new_email: email, current_password: { type: 'string', minLength: 1, maxLength: 128 } },
  },
  response: { 202: acceptedResponse, 400: errorResponse, 401: errorResponse },
} as const;

export const confirmEmailChangeSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Confirm an email-address change',
  body: {
    type: 'object',
    required: ['code'],
    additionalProperties: false,
    properties: { code: { type: 'string', pattern: '^[0-9]{6}$' } },
  },
  response: { 200: acceptedResponse, 400: errorResponse },
} as const;

export const csrfTokenSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Issue a CSRF token for cookie-authenticated mutations',
  response: {
    200: {
      type: 'object',
      properties: { csrf_token: { type: 'string' }, header: { type: 'string' } },
    },
  },
} as const;

// --- sessions ----------------------------------------------------------------

export const listSessionsSchema = {
  tags: [IDENTITY_TAG],
  summary: 'List your own sessions (refresh-token families)',
  response: {
    200: {
      type: 'object',
      properties: {
        sessions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              family_id: { type: 'string' },
              started_at: { type: 'string' },
              last_used_at: { type: 'string' },
              expires_at: { type: 'string' },
              revoked: { type: 'boolean' },
              current: { type: 'boolean' },
              user_agent: { type: ['string', 'null'] },
              ip: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
    401: errorResponse,
  },
} as const;

export const revokeSessionSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Revoke one session',
  params: {
    type: 'object',
    required: ['familyId'],
    properties: { familyId: uuid },
  },
  response: { 200: acceptedResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse },
} as const;

export const revokeAllSessionsSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Revoke every session',
  querystring: {
    type: 'object',
    properties: { keep_current: { type: 'boolean', default: false } },
  },
  response: { 200: acceptedResponse, 401: errorResponse },
} as const;

// --- MFA ---------------------------------------------------------------------

export const mfaEnrolSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Begin TOTP enrolment',
  response: {
    200: {
      type: 'object',
      properties: {
        secret: { type: 'string' },
        otpauth_url: { type: 'string' },
        digits: { type: 'integer' },
        period: { type: 'integer' },
      },
    },
    401: errorResponse,
  },
} as const;

export const mfaConfirmSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Confirm TOTP enrolment and receive recovery codes',
  body: {
    type: 'object',
    required: ['code'],
    additionalProperties: false,
    properties: { code: totpCode },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        recovery_codes: { type: 'array', items: { type: 'string' } },
      },
    },
    400: errorResponse,
    401: errorResponse,
  },
} as const;

export const mfaDisableSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Disable TOTP',
  body: {
    type: 'object',
    required: ['password'],
    additionalProperties: false,
    properties: { password: { type: 'string', minLength: 1, maxLength: 128 }, code: totpCode },
  },
  response: { 200: acceptedResponse, 400: errorResponse, 401: errorResponse },
} as const;

export const mfaRecoveryCodesSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Regenerate recovery codes',
  body: {
    type: 'object',
    required: ['code'],
    additionalProperties: false,
    properties: { code: totpCode },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        recovery_codes: { type: 'array', items: { type: 'string' } },
      },
    },
    400: errorResponse,
    401: errorResponse,
  },
} as const;

// --- profile -----------------------------------------------------------------

export const getMeSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Your own profile',
  response: { 200: selfProfileSchema, 401: errorResponse },
} as const;

export const getProfileSchema = {
  tags: [IDENTITY_TAG],
  summary: 'A public profile by handle',
  params: {
    type: 'object',
    required: ['handle'],
    properties: { handle },
  },
  // Superset schema: the handler decides whether it returns the public or the
  // self projection, and fast-json-stringify only emits the keys that are
  // present. A public-only schema here would silently strip the owner's own
  // fields out of their own profile response.
  response: { 200: selfProfileSchema, 404: errorResponse },
} as const;

export const updateProfileSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Update a profile (self only)',
  params: { type: 'object', required: ['id'], properties: { id: uuid } },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      display_name: { type: 'string', maxLength: 80 },
      bio: { type: 'string', maxLength: 500 },
    },
  },
  response: { 200: selfProfileSchema, 401: errorResponse, 403: errorResponse, 404: errorResponse },
} as const;

export const deleteAccountSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Deactivate your account and revoke every session',
  params: { type: 'object', required: ['id'], properties: { id: uuid } },
  response: { 200: acceptedResponse, 401: errorResponse, 403: errorResponse },
} as const;

export const changeRoleSchema = {
  tags: [IDENTITY_TAG],
  summary: 'Change a user role (staff, MFA-gated, audit-logged)',
  params: { type: 'object', required: ['id'], properties: { id: uuid } },
  body: {
    type: 'object',
    required: ['role'],
    additionalProperties: false,
    properties: {
      role: { type: 'string', enum: ['user', 'moderator', 'editor', 'seller_owner', 'admin'] },
      reason: { type: 'string', maxLength: 500 },
    },
  },
  response: { 200: selfProfileSchema, 401: errorResponse, 403: errorResponse, 404: errorResponse },
} as const;
