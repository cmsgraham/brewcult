# BrewCult infra

One-page operator reference. Full details: `docs/deployment_guide.md` (DG); topology rationale: `docs/engineering_foundations.md` §7.

## Dev: one command after clone

```bash
cp .env.example .env        # fill the few required values (DG §9)
cd infra && docker compose up
```

Source is bind-mounted into plain `node:22-alpine` containers (`npm run dev` inside) — every save hot-reloads, no image rebuild. Named volumes shadow `node_modules` so Windows hosts and Linux containers never share binaries.

| URL | What |
|---|---|
| http://localhost:3000 | web (Next.js) |
| http://localhost:4000 | api (Fastify) |
| http://localhost:8025 | Mailpit — catches all dev email |
| http://localhost:9001 | MinIO console (minioadmin/minioadmin) |
| localhost:5433 | Postgres (pgvector) from the host |

Apply migrations in dev: `docker compose --profile tools run --rm migrate` (or standalone: `DATABASE_URL=postgres://brewcult:brewcult@localhost:5433/brewcult ./db/migrate.sh`).

## Prod: deploy

Deploys are rsync + server-side compose builds (ADR-003). From the dev machine/WSL:

```bash
./infra/deploy.sh            # web
./infra/deploy.sh api        # api + worker + scheduler (same image — always together)
./infra/deploy.sh all
./infra/deploy.sh caddy      # Caddyfile only, restart (not reload — Zentra lesson)
./infra/deploy.sh --rollback # re-sync previously recorded commit
```

Guardrails baked into the script: refuses to deploy unless the latest `main` CI run is green (`--force` overrides, with shame); runs the `migrate` one-shot and **aborts before restarting anything** if it fails; records the deployed commit in `/srv/brewcult/DEPLOYED` (previous in `DEPLOYED.prev`). Edit the `SSH_KEY`/`SSH_HOST`/`REMOTE` placeholders at the top before first use.

**Never run `docker compose down -v` on prod** — `brewcult_caddy_data` holds Let's Encrypt certs + the ACME account (rate-limited) and is read by the mail server (DG §5.4).

## Files

| File | What it is |
|---|---|
| `docker-compose.yml` | DEV — bind mounts + hot reload; web/api/worker/scheduler + postgres/redis/minio/minio-init/mailpit; opt-in `migrate` (profile `tools`) |
| `docker-compose.prod.yml` | PROD — built images, healthchecks, `restart: unless-stopped`; api/worker/scheduler gated on `migrate` completing successfully (DG §5.2) |
| `Caddyfile` | Edge: TLS for all four hostnames (apex, www→apex, media, mail cert-only), security headers, CSP without script `unsafe-inline`, `/api/*` → api, `/sw.js` no-store |
| `deploy.sh` | The deploy/rollback tool described above |
| `minio-create-bucket.sh` | One-shot bucket bootstrap run by `minio-init` |
| `../db/migrate.sh` | Fail-loud migration runner: applies `db/migrations/*.sql` in filename order, records filename+sha256 in `schema_migrations`, skips applied, errors on checksum drift, exits non-zero on any failure |
| `../apps/api/Dockerfile.prod` | One image, three deployables: api (`node dist/index.js` default), worker/scheduler via `command:` overrides in prod compose (`node dist/worker.js` / `node dist/scheduler.js`) — EF §7.2, no separate worker.Dockerfile |
| `../apps/web/Dockerfile.prod` | Next.js standalone build, non-root |

## Worker/scheduler entrypoint contract

`apps/api`'s build must emit `dist/index.js` (api), `dist/worker.js` (outbox relay + consumers), `dist/scheduler.js` (cron: retention, digests, backups). Changing these paths means updating `docker-compose.prod.yml` commands + healthchecks.
