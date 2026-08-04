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

  ANTHROPIC_API_KEY: z.string().default(''),
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
