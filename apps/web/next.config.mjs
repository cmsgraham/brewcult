import path from 'node:path';
import process from 'node:process';

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Pin the tracing root to the monorepo root. Without it Next guesses from
   * whichever lockfile it finds first, and the standalone layout
   * (`apps/web/server.js`) that Dockerfile.prod copies would move.
   */
  outputFileTracingRoot: path.join(import.meta.dirname, '..', '..'),

  // Linting runs at the repo root (`npm run lint`: eslint + boundary rules);
  // next build only needs to compile + typecheck.
  eslint: { ignoreDuringBuilds: true },

  // apps/web/Dockerfile.prod copies .next/standalone — this is what produces it.
  output: 'standalone',

  // `X-Powered-By` is free reconnaissance.
  poweredByHeader: false,

  /**
   * Dev-only mirror of the production edge (deployment_guide §5.3):
   * Caddy serves the API at `/api/*` on the same origin and strips the prefix
   * before proxying to `api:4000`. Reproducing that in dev keeps the browser
   * same-origin, so the HttpOnly auth cookies behave identically in both — and
   * no CORS configuration is needed anywhere.
   */
  async rewrites() {
    if (process.env.NODE_ENV === 'production') return [];
    const apiOrigin = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${apiOrigin}/:path*` }];
  },
};

export default nextConfig;
