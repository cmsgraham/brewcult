import { z } from 'zod';

/**
 * Validated process environment. Every variable here MUST also exist in
 * `.env.example` and `docs/deployment_guide.md` §9 (DoD rule, EF §1.5).
 *
 * Empty-string defaults mean "feature cleanly disabled" (Zentra pattern):
 * no GOOGLE_CLIENT_ID → Google sign-in is not registered; no SMTP_HOST →
 * the mailer no-ops instead of throwing.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  APP_URL: z.string().default('http://localhost:3000'),
  API_URL: z.string().default('http://localhost:4000'),
  COOKIE_DOMAIN: z.string().default('localhost'),

  /**
   * Path scope for the refresh cookie, expressed as the BROWSER sees it.
   *
   * This is a public-URL concern, not an internal routing one, and the two are
   * not the same string. Caddy (prod) and the Next dev rewrite both strip a
   * leading `/api` before the request reaches Fastify, so the API serves
   * `/v1/auth/refresh` while the browser is talking to `/api/v1/auth/refresh`.
   * Cookie path matching happens in the browser against the URL IT used, so
   * scoping the cookie to the internal path means it is never sent at all.
   *
   * Kept narrow on purpose (rather than `/`): the long-lived refresh credential
   * should not ride along on ordinary API traffic. Override it if the API is
   * ever mounted somewhere other than `/api`.
   */
  AUTH_COOKIE_PATH: z.string().default('/api/v1/auth'),

  DATABASE_URL: z.string().default('postgres://brewcult:brewcult@localhost:5433/brewcult'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().default('dev-only-insecure-secret-change-me'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  ADMIN_EMAILS: z.string().default(''),

  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('BrewCult <noreply@brewcult.coffee>'),
  MAIL_ALLOWLIST: z.string().default(''),

  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_BUCKET: z.string().default('brewcult-media'),
  MEDIA_BASE_URL: z.string().default('http://localhost:9000/brewcult-media'),

  /**
   * Which AiProvider implementation the intelligence module uses.
   * 'anthropic' is the reference implementation (second_draft §16); 'openai'
   * is the adapter behind the same seam (provider-openai.ts).
   */
  AI_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  /** Model ids per feature tier when AI_PROVIDER=openai. */
  OPENAI_MODEL_DEFAULT: z.string().default('gpt-4.1'),
  OPENAI_MODEL_PREMIUM: z.string().default('gpt-5'),
  OPENAI_MODEL_CLASSIFY: z.string().default('gpt-4.1-mini'),
  AI_DAILY_TOKEN_BUDGET_FREE: z.coerce.number().default(50_000),

  SENTRY_DSN: z.string().default(''),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: clears the memoised env so a test can re-parse a mutated process.env. */
export function resetEnvCache(): void {
  cached = null;
}

export const isProduction = (): boolean => getEnv().NODE_ENV === 'production';
