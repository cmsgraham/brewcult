# ADR-001 — Phase-1 stack: TypeScript everywhere

- **Status**: Accepted
- **Date**: 2026-08-04
- **Deciders**: BrewCult core
- **Source**: `docs/engineering_foundations.md` §6, `docs/deployment_guide.md` §1

## Context

BrewCult Phase 1 ships a responsive web app + installable PWA (native iOS is
deferred to after Phase 2, per the engineering-foundations review verdict). The
team has proven operational experience with the Zentra stack
(`todo_app/inkflow`): Node + Fastify API, Next.js web, Docker Compose on a
VPS. Phase 1 velocity depends on reusing that experience and selectively
porting Zentra assets (compose files, mailer, OAuth flow) rather than learning
a new ecosystem. Whatever we choose must support the module-boundary charter
(EF §1.2), OpenAPI-first contracts (EF §1.3), and the role-based container
topology (EF §7.2).

## Decision

**TypeScript for every deployable**, in an npm-workspaces monorepo
(`apps/web`, `apps/api`, `packages/shared-types`, `docs/`):

- **API**: Node 22 + Fastify 5. The eight domain modules (identity, catalog,
  brewing, community, news, commerce, intelligence, trust) live inside the one
  API codebase; boundaries are lint-enforced (dependency-cruiser in CI), not
  promised.
- **Worker / Scheduler**: same codebase as the API, different entrypoints
  (`src/worker.ts`, `src/scheduler.ts`) — EF §7.2 role-based deployables.
- **Web**: Next.js App Router (SSR for SEO pages, PWA for the ≤15s brew logger).
- **DB**: PostgreSQL 16 + pgvector (`pgvector/pgvector:pg16` image, as Zentra).
- **Cache/queue**: Redis 7.
- **Object storage**: MinIO self-hosted in Phase 1 (S3-compatible, swappable to
  cloud S3/R2 later without code change).
- **Edge**: Caddy 2 (automatic TLS, security headers).

Alternatives considered: a Go or Python API (stronger typing story or AI
ecosystem respectively) — rejected: no operational track record on this team,
and the shared-types package + one language across web/api is a real velocity
multiplier for a small team. Separate repos per app — rejected: contracts and
shared types churn too fast in Phase 1; the monorepo with workspace linking
keeps them atomic.

## Consequences

- One language, one toolchain: shared types flow from `packages/shared-types`
  into api and web; a single CI pipeline (lint → typecheck → unit →
  integration → contract → build) covers everything.
- Zentra assets port cheaply (compose files, mailer, Google OAuth flow) per
  the execution plan's reuse inventory.
- Node's weaker CPU-bound story is accepted; heavy work (media processing,
  batch AI) is queued to worker/scheduler processes and can be extracted per
  EF §7.4 if a runtime mismatch ever fires.
- The iOS app (Swift/SwiftUI, provisional lean — revisit when staffed) builds
  against the same `/v1` OpenAPI contract; nothing in this decision is
  web-only.
