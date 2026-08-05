# BrewCult — Deployment & Operations Guide

> How BrewCult is developed, tested, deployed, and operated in Phase 1.
> Modeled on the proven Zentra (`todo_app/inkflow`) workflow — dev-mode bind mounts,
> rsync-to-server deploys, server-side Docker builds, Caddy TLS — upgraded where the
> engineering foundations (EF) require it. Implements EF §7 (deployment topology) and
> records **ADR-001** and **ADR-003**.

---

# 1. Decisions recorded

## ADR-001 — Stack (DECIDED 2026-08-04)

**TypeScript everywhere**, matching the team's operational experience with Zentra:

- **API**: Node 22 + Fastify (module structure per EF §1.2), npm workspaces monorepo.
- **Web**: Next.js (SSR + PWA).
- **Worker/Scheduler**: same codebase, different entrypoints (EF §7.2).
- **DB**: Postgres 16 with pgvector (`pgvector/pgvector:pg16` image — same as Zentra).
- **Cache/queue**: Redis 7.
- **Object storage**: MinIO self-hosted in Phase 1 (S3-compatible → swappable to cloud S3/R2
  later without code change).
- **Edge**: Caddy 2 (automatic TLS, security headers).

## ADR-003 — Deploy model (DECIDED 2026-08-04)

**Phase 1 deploys are file-sync deploys**: `deploy.sh` rsyncs source to the VPS and rebuilds
containers server-side with `docker compose`. This is deliberately the Zentra model — one
command, no registry, no CI credentials on the server, fully understood by the operator.

- CI (GitHub Actions) is the **quality gate** (lint/tests/build must be green), not the
  deployer. Deploys run from the developer machine (or WSL) via `deploy.sh`.
- The registry+image pipeline (backlog F-19) is **re-scoped to the Kubernetes era**
  (Phase 2–3, EF §7.3). When we move to k8s, deploys become image-based; until then,
  rsync+build-on-server is the standard. This supersedes F-19's original Phase-1 wording.
- Secrets on the single VPS live in `/srv/brewcult/.env.prod` (root:brewcult, `chmod 640`),
  never in the repo. A managed secrets service replaces this at the k8s migration (EF §3.7
  applies fully then; this is the documented Phase-1 pragmatic exception).

---

# 2. Repository layout (infra-relevant parts)

```text
brewcult/
  apps/
    web/                  # Next.js (Dockerfile.prod)
    api/                  # Fastify API (Dockerfile.prod, worker + scheduler entrypoints)
  db/
    migrations/           # NNN_name.sql, forward-only, applied by migrate container
    seed/                 # deterministic dev seed (F-09)
  infra/
    docker-compose.yml        # DEV — bind mounts + hot reload
    docker-compose.prod.yml   # PROD — built images, restart policies, healthchecks
    Caddyfile
    deploy.sh
  .env.example            # every var documented; no real values
  .github/workflows/ci.yml
```

---

# 3. Local development (bind-mount hot reload)

One command after clone:

```bash
cp .env.example .env          # fill the few required values (see §9)
cd infra && docker compose up
```

`docker-compose.yml` (dev) follows the Zentra pattern exactly — **source bind-mounted into
plain `node:22-alpine` containers**, `npm run dev` inside, so every file save hot-reloads
with no image rebuild:

```yaml
services:
  web:
    image: node:22-alpine
    working_dir: /app
    command: sh -c "npm install && npm --workspace apps/web run dev"
    ports: ["3000:3000"]
    volumes:
      - ..:/app                      # ← bind mount: edit locally, runs in container
      - web_node_modules:/app/node_modules
    env_file: [../.env]
    depends_on: [api]

  api:
    image: node:22-alpine
    working_dir: /app
    command: sh -c "npm install && npm --workspace apps/api run dev"
    ports: ["4000:4000"]
    volumes:
      - ..:/app
      - api_node_modules:/app/node_modules
    env_file: [../.env]
    depends_on: [postgres, redis, minio]

  worker:
    image: node:22-alpine
    working_dir: /app
    command: sh -c "npm install && npm --workspace apps/api run worker:dev"
    volumes: [ "..:/app", worker_node_modules:/app/node_modules ]
    env_file: [../.env]
    depends_on: [postgres, redis]

  scheduler:
    image: node:22-alpine
    working_dir: /app
    command: sh -c "npm install && npm --workspace apps/api run scheduler:dev"
    volumes: [ "..:/app", scheduler_node_modules:/app/node_modules ]
    env_file: [../.env]
    depends_on: [postgres, redis]

  postgres:
    image: pgvector/pgvector:pg16
    environment: { POSTGRES_USER: brewcult, POSTGRES_PASSWORD: brewcult, POSTGRES_DB: brewcult }
    ports: ["5433:5432"]
    volumes: [ brewcult_pgdata:/var/lib/postgresql/data ]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment: { MINIO_ROOT_USER: minioadmin, MINIO_ROOT_PASSWORD: minioadmin }
    ports: ["9000:9000", "9001:9001"]
    volumes: [ brewcult_minio:/data ]

  mailpit:                            # dev mail catcher — see §8.5
    image: axllent/mailpit:latest
    ports: ["8025:8025", "1025:1025"]
```

Named volumes shadow `node_modules` so host OS (Windows) and container (Linux) never share
binaries. `npm run seed` populates the dev world (F-09). **Mailpit** catches every outbound
email in dev at `http://localhost:8025` — no real SMTP needed locally, and verification-code
flows are fully testable offline.

---

# 4. CI pipeline (GitHub Actions — quality gate)

`.github/workflows/ci.yml`, runs on every PR and push to `main`; **merge is blocked unless
green** (branch protection):

```yaml
name: ci
on:
  pull_request:
  push: { branches: [main] }

jobs:
  checks:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env: { POSTGRES_USER: test, POSTGRES_PASSWORD: test, POSTGRES_DB: test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U test" --health-interval 5s --health-retries 5
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint            # includes module-boundary rules (F-04)
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npm run test:integration   # real Postgres/Redis from services above
      - run: npm run test:contract      # OpenAPI conformance (F-13)
      - run: npm audit --audit-level=critical
      - run: npm run build              # web + api production builds must compile

  ai-evals:                             # M3+: golden set + injection suite (AI-07)
    if: contains(github.event.pull_request.changed_files, 'apps/api/src/modules/intelligence') # refine with paths filter
    runs-on: ubuntu-latest
    steps: [ ... ]                      # gated separately; requires ANTHROPIC_API_KEY secret
```

Pipeline stages match EF §1.6; target <10 min. Deploys are **not** in CI (ADR-003) — CI
green is the *precondition* the deploy script checks for.

---

# 5. Production server (single VPS, Phase 1)

## 5.1 One-time provisioning checklist

1. VPS (4 vCPU / 8 GB is plenty for beta), Ubuntu LTS.
2. Create user `brewcult`, SSH key-only login, disable root SSH + password auth.
3. `ufw`: allow 22, 80, 443 only. Fail2ban on sshd.
4. Install Docker Engine + compose plugin; add `brewcult` to `docker` group.
5. Unattended security upgrades enabled.
6. Create `/srv/brewcult/`; place `.env.prod` (chmod 640) from §9 template.
7. DNS: `A` records for **all four hostnames** → VPS IP *before* first boot (ACME needs
   them to resolve): `brewcult.coffee`, `www`, `media`, `mail`. Proxy/CDN optional later —
   if fronting with a proxy, keep ACME challenge paths reachable.
8. First deploy (§6), then verify Caddy obtained all certificates
   (`docker exec brewcult-caddy ls /data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/`).
9. **Backups**: nightly `pg_dump` to object storage (off-VPS!) via scheduler container +
   weekly restore test on dev (F-06 runbook). Postgres data lives in a named volume;
   the dump is the recovery source of truth.

## 5.2 `docker-compose.prod.yml` shape

Same topology as Zentra prod, with BrewCult's four deployables + healthchecks:

```yaml
services:
  caddy:      # ports 80/443, mounts Caddyfile, cert volumes
  web:        # build: apps/web/Dockerfile.prod, expose 3000
  api:        # build: apps/api/Dockerfile.prod, expose 4000, healthcheck /healthz
  worker:     # build: apps/api/worker.Dockerfile (outbox relay + consumers)
  scheduler:  # same image as worker, entrypoint scheduler (cron: retention jobs, digests, backups)
  postgres:   # pgvector/pgvector:pg16, named volume, healthcheck pg_isready
  redis:      # redis:7-alpine, named volume
  minio:      # media storage, named volume (+ minio-init bucket bootstrap)
  migrate:    # one-shot: applies db/migrations/*.sql before api starts
```

Prod rules (EF §7.2): every app container has a healthcheck, `restart: unless-stopped`,
graceful SIGTERM drain, structured logs to stdout (`docker logs` is the log viewer in
Phase 1; log shipping arrives with k8s).

**Migration note (improves on Zentra):** the migrate container must **fail loudly** — no
`|| true`. It records applied files in a `schema_migrations` table and exits non-zero on
error, which blocks the api from starting (`depends_on: migrate: condition:
service_completed_successfully`). Silent half-applied migrations are how data monsters begin.

## 5.3 Caddy — edge, TLS, and certificate lifecycle

Caddy is the single TLS terminator and reverse proxy for every HTTPS hostname, and the
**certificate authority client for the whole box** — including the mail server's certs
(§5.4). One Caddy, four hostnames:

| Hostname | Backed by | Notes |
|---|---|---|
| `brewcult.coffee` | `web:3000` (+ `/api/*` → `api:4000`) | Main site |
| `www.brewcult.coffee` | redirect → apex | Canonical host for SEO |
| `media.brewcult.coffee` | `minio:9000` | Cookie-less media origin (EF §3.5) |
| `mail.brewcult.coffee` | none (cert-only site block) | Exists so Caddy issues/renews the mail cert |

### Caddyfile

```caddy
www.brewcult.coffee {
  redir https://brewcult.coffee{uri} permanent
}

brewcult.coffee {
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    X-Frame-Options "DENY"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
    Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://media.brewcult.coffee; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    -Server
  }
  handle_path /api/* {
    reverse_proxy api:4000
  }
  @sw path /sw.js
  header @sw Cache-Control "no-store, no-cache, must-revalidate, max-age=0"   # PWA SW freshness (Zentra lesson)
  reverse_proxy web:3000
}

media.brewcult.coffee {                 # cookie-less media origin (EF §3.5)
  reverse_proxy minio:9000
}

mail.brewcult.coffee {                  # cert-only block: no proxy target needed —
  respond "ok" 200                      # its purpose is making Caddy manage the mail cert
}
```

Note the CSP has **no `unsafe-inline` for scripts** (EF §3.3 requirement — stricter than
Zentra's). Next.js emits its own per-request **nonce** CSP from `middleware.ts`, so Caddy's
policy is written with the `?` prefix (`?Content-Security-Policy`) meaning *set only if the
upstream didn't* — overwriting it would strip the nonce and break hydration. Caddy's copy
remains the defence-in-depth fallback for responses that carry no policy of their own.

### Certificate issuance & renewal (automatic — but understand it)

- **Issuer**: Let's Encrypt via ACME, negotiated by Caddy automatically for every hostname
  in the Caddyfile. No certbot, no cron, no manual renewal — Caddy renews each cert when
  ~1/3 of its lifetime remains (~30 days before expiry for 90-day LE certs).
- **Challenge**: HTTP-01 / TLS-ALPN-01, which is why **ports 80 and 443 must always reach
  Caddy** — never firewall port 80 "because we redirect anyway"; ACME needs it. DNS `A`
  records for all four hostnames must point at the VPS *before* first boot, or issuance
  fails (Caddy retries with backoff, but LE has rate limits — see below).
- **Storage**: certs + ACME account keys live in Caddy's data volume:

```yaml
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443", "443:443/udp"]     # udp = HTTP/3
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - brewcult_caddy_data:/data                  # ← certificates + ACME account (PERSIST!)
      - brewcult_caddy_config:/config
```

  Inside the volume, certs sit at
  `/data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/<host>/<host>.crt|.key`.
- **The data volume is precious**: losing it forces re-issuance of everything and burns
  against Let's Encrypt rate limits (50 certs/domain/week; 5 duplicates/week). Therefore:
  the `brewcult_caddy_data` volume is **in the nightly backup set**, and compose must never
  be run with `docker compose down -v` on prod (runbook warning).
- **Reload vs restart**: config changes deploy via `./deploy.sh caddy`, which *restarts*
  the container — Zentra lesson: `caddy reload` can silently no-op; restart takes ~3s and
  certs persist in the volume, so restarts are cheap and safe.
- **Monitoring**: the uptime check (external ping on `https://brewcult.coffee/healthz`)
  validates the certificate implicitly; add cert-expiry alerting (≤14 days remaining =
  alert) via the same monitor — if renewal is failing you want two weeks of warning, not a
  browser error on launch day.

### Dev & staging

- **Local dev**: no Caddy, no TLS — `localhost:3000/4000` over HTTP (§3). Cookies use
  `secure: false` under `NODE_ENV=development` (Zentra's pattern).
- If HTTPS is ever needed locally (e.g., PWA install testing), run Caddy with its **internal
  CA** (`tls internal`) — self-signed, zero ACME involvement.
- **Staging** (when it exists): real Caddy + real hostname (`staging.brewcult.coffee`), but
  set `acme_ca` to Let's Encrypt's **staging endpoint** while experimenting with config —
  staging certs are untrusted but don't consume production rate limits.

### Kubernetes era (EF §7.3)

At the k8s migration, this whole section is superseded by ingress + **cert-manager** with
the same LE account model. Nothing about the app changes; the Caddyfile's routing/header
rules translate to ingress annotations + middleware. Recorded here so nobody "temporarily"
runs both.

## 5.4 Sharing certificates with the mail server

The mail server (§8) needs the `mail.brewcult.coffee` cert for SMTPS (465), STARTTLS (587),
and IMAPS (993). **Caddy owns issuance; the mail container consumes read-only:**

```yaml
# in /srv/mail/docker-compose.yml (mail project)
  mailserver:
    volumes:
      - brewcult_caddy_data:/caddy-data:ro     # external named volume from the app project
    environment:
      SSL_TYPE: manual
      SSL_CERT_PATH: /caddy-data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/mail.brewcult.coffee/mail.brewcult.coffee.crt
      SSL_KEY_PATH:  /caddy-data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/mail.brewcult.coffee/mail.brewcult.coffee.key

volumes:
  brewcult_caddy_data:
    external: true      # owned by the app compose project; mail only reads it
```

- docker-mailserver's built-in **changedetector** watches the cert files and reloads
  Postfix/Dovecot automatically when Caddy renews — no cron, no coordination between the
  two compose projects. The renewal loop is: Caddy renews → file changes in the shared
  volume → mail server hot-reloads. Zero-touch.
- The mount is `:ro` and scoped: mail can read certs but can never write Caddy state. This
  preserves the §8 isolation rule (app deploys and mail never restart each other) — the
  *only* shared surfaces between the two projects are this read-only volume and SMTP itself.
- Fallback if volume sharing is ever inconvenient (e.g., projects on different hosts): a
  tiny cert-sync cron (`docker cp` + checksum compare) or DMS's own ACME via a dedicated
  certbot — documented option, not the default.

---

# 6. Deploying (`infra/deploy.sh`)

Same UX as Zentra's script — targets, rsync, server-side build, restart:

```text
./deploy.sh                 # sync + build + restart web
./deploy.sh api             # sync + build + restart api (+ worker & scheduler, same image)
./deploy.sh all             # everything
./deploy.sh caddy           # sync Caddyfile + restart caddy (no rebuild)
./deploy.sh --no-sync       # rebuild from what's already on the server
```

Differences from Zentra's script (lessons + EF requirements):

1. **CI gate**: the script first checks `gh run list --branch main --limit 1` (or
   `git push` + status API) and refuses to deploy if the latest `main` CI run isn't green.
   Override flag `--force` exists and prints a shame banner.
2. **Migrations run as a step, not a side effect**: after sync, the script runs the
   `migrate` one-shot container and **aborts the deploy if it fails** (see §5.2).
3. **Worker + scheduler restart with api** (same image; skew between api and worker
   consuming the same event schemas is a subtle-bug factory).
4. **Rollback**: `./deploy.sh --rollback` re-checks-out the previously deployed git tag
   locally and re-syncs. Every deploy writes the deployed commit hash to
   `/srv/brewcult/DEPLOYED` so "what's live?" is always answerable.
5. **Build cache is bounded, and `--no-cache` is never used.** Zentra's script
   builds with `--no-cache`, which writes a fresh multi-hundred-MB BuildKit
   entry on every deploy that can never be reused; on the shared box that
   leaked **48 GB** and took the disk to 85% full. BrewCult builds with cache
   and trims to `BUILD_CACHE_CEILING` (default 10 GB) after each deploy, then
   prints `df -h /` so disk drift is visible in the deploy output rather than
   discovered during an outage.
6. rsync includes `db/migrations/`, excludes `.env*`, `node_modules`, `.git` (checksum
   mode, `--delete` on source dirs — as in Zentra).

---

# 7. Authentication setup (email + Google)

Implements backlog ID-01..ID-05 with the Zentra flow as reference implementation, hardened
to EF §2.3.

## 7.1 Email + password

- Argon2id hashing (Zentra pattern upgraded from its current hash if needed), verification
  **code** email (15-min expiry — Zentra template reused, rebranded), password reset link
  (1-hour single-use token), breach-list check on registration.
- Anti-enumeration: register/reset endpoints always return 202 regardless of account
  existence (Zentra's `sendMail` contract already assumes this — keep it).
- Login attempts table (ip, user_agent, provider, failure_reason) — Zentra has this; keep,
  it feeds rate limiting and the audit log (ID-09).

## 7.2 Google OAuth

Flow identical to Zentra's `google.ts` (authorization-code flow via `@fastify/oauth2`,
scopes `openid email profile`, userinfo fetch, cookie session issue), with these required
changes:

1. **Multi-provider identity table** (EF §2.3 / ID-01): instead of `users.google_sub`
   column, an `auth_identities (user_id, provider, provider_sub, email_at_link_time)` table —
   Apple lands later without another migration.
2. **Auto-link rule kept but tightened**: link Google to an existing email account **only
   when Google reports `email_verified: true`** (Zentra checks this loosely; make it a hard
   gate — unverified-email linking is an account-takeover vector).
3. Refresh tokens: hashed + **family reuse detection** (EF §2.3 — Zentra stores hashed
   tokens but does not rotate families; upgrade).
4. `state`/PKCE handled by the plugin; verify `redirect_uri` is exact-match registered.

### Google Cloud Console setup (operator runbook)

1. console.cloud.google.com → new project `brewcult`.
2. **APIs & Services → OAuth consent screen**: External; app name BrewCult, support email
   `hello@brewcult.coffee`; scopes `openid`, `email`, `profile` (non-sensitive — no
   verification review needed); publish to Production (otherwise tokens expire in 7 days).
   Privacy policy URL required → `https://brewcult.coffee/privacy` (L-03).
3. **Credentials → OAuth client ID (Web application)**:
   - Authorized origins: `https://brewcult.coffee`, `http://localhost:3000`.
   - Redirect URIs: `https://brewcult.coffee/api/auth/google/callback`,
     `http://localhost:4000/auth/google/callback` (dev).
4. Put client ID/secret in `.env` / `.env.prod` (§9). Code boots cleanly without them
   (Google button hidden) — Zentra's conditional-registration pattern, keep it.

---

# 8. Email on brewcult.coffee (send + receive)

**Decision: self-hosted mail server, the Zentra pattern.** Zentra already runs its own mail
server in a container on the VPS (`mail.usezentra.app`, same IP as the app, DKIM selector
`mail`, SPF `v=spf1 mx ~all`) — the pattern is proven in this team's operations, so BrewCult
follows it rather than adding third-party mail providers. The app code is unchanged either
way: nodemailer over SMTP env vars, exactly Zentra's `mailer.ts` (transporter cache,
no-op-when-unset, 202-always contract, templates rebranded to BrewCult).

## 8.1 Mail server container

**docker-mailserver** (docker-mailserver/docker-mailserver) as its own compose project on
the VPS, *outside* the app repo — mirroring how it's done on the Zentra box. Kept separate
deliberately: app deploys (`deploy.sh`) must never restart the mail server.

```yaml
# /srv/mail/docker-compose.yml (server-side only, not in the app repo)
services:
  mailserver:
    image: ghcr.io/docker-mailserver/docker-mailserver:latest
    container_name: brewcult-mail
    hostname: mail.brewcult.coffee
    ports: ["25:25", "465:465", "587:587", "993:993"]
    volumes:
      - ./data/mail-data:/var/mail
      - ./data/mail-state:/var/mail-state
      - ./data/mail-logs:/var/log/mail
      - ./data/config:/tmp/docker-mailserver
      - brewcult_caddy_data:/caddy-data:ro   # Caddy-issued certs — full mechanics in §5.4
    environment:
      ENABLE_RSPAMD: 1
      ENABLE_CLAMAV: 0          # RAM saver on a small VPS; enable if headroom
      SSL_TYPE: manual          # cert/key paths + auto-reload on renewal: see §5.4
      SSL_CERT_PATH: /caddy-data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/mail.brewcult.coffee/mail.brewcult.coffee.crt
      SSL_KEY_PATH:  /caddy-data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/mail.brewcult.coffee/mail.brewcult.coffee.key
    restart: unless-stopped

volumes:
  brewcult_caddy_data:
    external: true              # owned by the app project; mail reads only
```

> **AS BUILT (2026-08-05).** BrewCult shares the existing `mail-usezentra`
> docker-mailserver on the Zentra box rather than running its own. The steps
> below are the standalone-VPS plan; what is actually deployed differs in four
> places, and the differences are deliberate:
>
> | Plan | As built | Why |
> |---|---|---|
> | `hello@`, `legal@`, `dmarc@` | `noreply@` (send), `admin@` (receive), `support@` → alias to `admin@` | Fewer boxes nobody reads. `support@` is referenced by the email-changed security notice in `lib/mailer.ts`, and `admin@` is the live DMARC `rua`, so those two had to exist. |
> | `SMTP_USER=app@brewcult.coffee` | `SMTP_USER=noreply@brewcult.coffee` | One send-only credential for one sending identity; a separate `app@` box added a password to rotate and nothing else. |
> | `rua=mailto:dmarc@…` | `rua=mailto:admin@brewcult.coffee` | Matches the mailbox that exists. Reports to an address that rejects mail are reports nobody sees. |
> | `SMTP_HOST=mail.brewcult.coffee` | `SMTP_HOST=mail.usezentra.app` | The MTA's Let's Encrypt cert is issued for its own hostname. Connecting as anything else fails STARTTLS hostname verification. SMTP does not require the envelope sender's domain to match the connection hostname, and OpenDKIM signs on the `From:` domain — so mail still leaves as brewcult.coffee, signed with brewcult.coffee's key. |
>
> PTR is set to `mail.usezentra.app` (one IP, one PTR, and that is the name the
> server announces). Certificate renewal is Caddy's, copied into place by
> `sync-mail-certs.timer` — see §5.4.
>
> Verified live: DKIM valid and aligned, SPF pass, TLS 1.3 on delivery, inbound
> accepts `admin@`/`support@`/`noreply@`, rejects unknown recipients, and refuses
> to relay for foreign domains from the public internet.

Setup steps for a STANDALONE BrewCult mail server (one-time, ~30 min):
1. TLS: nothing to do beyond §5.4 — the Caddyfile's `mail.brewcult.coffee` block makes
   Caddy issue and renew the cert; the mail container reads it from the shared volume and
   hot-reloads on renewal.
2. `docker exec brewcult-mail setup email add hello@brewcult.coffee` (repeat for
   `support@`, `legal@`, `dmarc@`; `noreply@` is send-only — create it too so bounces land).
3. `docker exec brewcult-mail setup config dkim` → generates the DKIM key (selector `mail`,
   same as Zentra) → publish the printed TXT record. NOTE: docker-mailserver rewrites
   `/etc/opendkim/SigningTable` on start and keeps only the primary domain, so a
   multi-domain server needs the `user-patches.sh` hook that restores the real tables
   (installed on the shared box at `mail-server/data/config/user-patches.sh`).
4. Create an SMTP credential for the app — the api/worker containers authenticate with it
   over the Docker network / localhost:587.
5. **Reverse DNS (PTR)**: set the VPS's rDNS to the mail hostname in the hosting panel
   (Linode/Akamai: Network tab → the IPv4 row, NOT the IPv6 one). Gmail hard-penalizes a
   default/dynamic-looking PTR — mail-tester scores it -1.36. Allow up to an hour for
   Linode to push the change to its authoritative servers.
6. Confirm the host provider has port 25 outbound open (Linode requires a support ticket on
   new accounts; the Zentra box already passed this hurdle).

App env (`.env.prod`):
```text
SMTP_HOST=mail.usezentra.app     # the MTA's own hostname — see the AS BUILT note above
SMTP_PORT=587
SMTP_SECURE=false                # STARTTLS
SMTP_USER=noreply@brewcult.coffee
SMTP_PASS=<generated at mailbox creation>
SMTP_FROM=BrewCult <noreply@brewcult.coffee>
```

Mailboxes: read via IMAP (993) from any mail client, or add Roundcube/Snappymail later if
webmail is wanted.

**Interim option while the BrewCult VPS doesn't exist yet:** docker-mailserver hosts
multiple domains — the *existing* Zentra mail server can serve `brewcult.coffee` too
(add the domain + accounts + a second DKIM key there, point BrewCult's MX at
`mail.usezentra.app`). This inherits the already-warmed IP reputation. Migrate to
BrewCult's own box whenever convenient; only DNS changes.

## 8.2 DNS records (the part everyone gets wrong)

Mirroring Zentra's working records, at the DNS host for brewcult.coffee:

| Record | Value | Purpose |
|---|---|---|
| `A` `mail.brewcult.coffee` | VPS IP | Mail host |
| `MX` `brewcult.coffee` | `10 mail.brewcult.coffee` | Receiving |
| `TXT` (SPF) | `v=spf1 mx ~all` — **one record only** (Zentra's exact policy) | Sender authorization |
| `TXT` `mail._domainkey` | DKIM key from setup step 3 | Signature validation |
| `TXT` `_dmarc` | LIVE: `v=DMARC1; p=none; rua=mailto:admin@brewcult.coffee` → tighten to `p=quarantine` after ~2 weeks of clean reports (Zentra still runs `p=none`; tightening is the upgrade). The `rua` address must be a mailbox that ACCEPTS mail, or the aggregate reports you would tighten on the strength of are bounced unread. | Spoofing protection |
| PTR (at the *hosting provider*, not DNS host) | `mail.brewcult.coffee` | Deliverability — required |

Verification (F-21 acceptance): send test mail to a Gmail account → *Show original* →
`SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`; and mail *to* `hello@brewcult.coffee` from Gmail
arrives in the IMAP inbox. Run the domain through a checker (mail-tester.com class) and fix
anything below 9/10 before real users get email.

## 8.3 Honest trade-offs of self-hosting (accepted, with mitigations)

- **IP reputation is yours to keep clean**: a fresh VPS IP starts cold with Gmail/Outlook —
  warm it (low volume first weeks), monitor DMARC reports at `dmarc@`, and check the IP
  against blocklists monthly (mxtoolbox-class). The multi-domain interim option in 8.1
  sidesteps the cold start entirely.
- **The weekly briefing (bulk mail) is the reputation risk**, not transactional mail. When
  briefing volume grows past ~1–2k/week, route *just the briefing* through Amazon SES or a
  Brevo-class relay (nodemailer supports multiple transports) and keep transactional on the
  own server — separation protects both streams. Revisit trigger recorded here.
- **Backups**: `/srv/mail/data` joins the nightly backup set (mail is user data too).
- If deliverability ever becomes a recurring time sink, the managed split (SMTP provider +
  Zoho-class mailboxes) remains the documented fallback — the app only ever sees SMTP env
  vars, so switching is a config change, not a code change.

## 8.4 Deliverability hygiene

- All transactional mail from `noreply@brewcult.coffee`; the weekly briefing (L-02) from
  `brew@brewcult.coffee` — separating streams protects transactional reputation if the
  newsletter ever gets flagged.
- One-click unsubscribe headers (`List-Unsubscribe`) on the briefing from day one — Gmail
  requires it for bulk senders and it's an EF §4.5 consent requirement anyway.
- Bounce/complaint webhooks from the SMTP provider → mark address undeliverable, stop
  sending (protects reputation + it's a privacy-adjacent courtesy).

## 8.5 Dev/staging

Dev uses **Mailpit** (§3) — full flows testable with zero external calls. Staging may point
at the real SMTP provider with a `SMTP_FROM` of `staging@` and a recipient allowlist guard
(`MAIL_ALLOWLIST=*@brewcult.coffee`) so a staging bug can never mass-mail real users.

---

# 9. Environment variables (`.env.example`)

Every variable documented; empty default = feature cleanly disabled (Zentra's pattern):

```text
# Core
NODE_ENV=development
APP_URL=http://localhost:3000
API_URL=http://localhost:4000
JWT_SECRET=                     # 64 random bytes; rotate per runbook
COOKIE_DOMAIN=localhost
AUTH_COOKIE_PATH=/api/v1/auth   # refresh-cookie scope, written as the BROWSER sees it

# Database / cache / storage
DATABASE_URL=postgres://brewcult:brewcult@postgres:5432/brewcult
POSTGRES_USER=brewcult          # compose-only: prod postgres container + healthcheck
POSTGRES_PASSWORD=brewcult      # must agree with DATABASE_URL
POSTGRES_DB=brewcult
NEXT_PUBLIC_API_URL=            # web build arg; empty = same-origin /api
REDIS_URL=redis://redis:6379
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=brewcult-media
MEDIA_BASE_URL=http://localhost:9000/brewcult-media

# Auth
GOOGLE_CLIENT_ID=               # empty → Google button hidden
GOOGLE_CLIENT_SECRET=
ADMIN_EMAILS=                   # comma-separated bootstrap allowlist (Zentra pattern)

# Mail (empty SMTP_HOST → mailer no-ops; dev uses mailpit:1025)
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=BrewCult <noreply@brewcult.coffee>
MAIL_ALLOWLIST=                 # staging guard; empty in prod

# AI
ANTHROPIC_API_KEY=
AI_DAILY_TOKEN_BUDGET_FREE=     # per-user cap (AI-10)

# Observability
SENTRY_DSN=
```

`.env.prod` on the server holds real values (ADR-003 §1). Adding a variable without adding
it to `.env.example` + this guide fails code review (DoD).

---

# 10. Runbooks (quick reference)

| Task | Command / procedure |
|---|---|
| Deploy web change | `./infra/deploy.sh` |
| Deploy api change (+ worker/scheduler) | `./infra/deploy.sh api` |
| What's live? | `ssh vps cat /srv/brewcult/DEPLOYED` |
| Rollback | `./infra/deploy.sh --rollback` |
| Logs | `ssh vps docker logs -f brewcult-api --since 1h` |
| DB console | `ssh vps docker exec -it brewcult-postgres psql -U brewcult` |
| Manual backup now | `ssh vps docker exec brewcult-scheduler npm run backup:now` |
| Restore test (quarterly, ST-05) | pull latest dump → restore into fresh dev compose → run smoke tests |
| Rotate JWT secret | set new secret alongside old (dual-verify window) → deploy → drop old after refresh TTL |
| Certificate issues | `./infra/deploy.sh caddy` (restart is more reliable than reload — Zentra lesson) |

---

# 11. Evolution triggers (when this guide gets superseded)

Per EF §7.3/§7.4 — revisit this document when any of: staging environment needed by a second
contributor · zero-downtime deploys become a requirement (blue-green or k8s) · first module
extraction (registry + image pipeline activates, F-19) · secrets move to a managed store ·
log volume outgrows `docker logs`.
