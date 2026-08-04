# BrewCult — Parallel Execution Plan

> How the Phase-1 backlog (`docs/backlog_phase1.md`) gets built: an orchestrator session
> coordinating parallel agent lanes, with mechanical work delegated to local models.
> Companion to `docs/engineering_foundations.md` (EF) and `docs/deployment_guide.md` (DG).

---

## 1. Working model

- **Orchestrator** (Claude session): owns architecture decisions, reviews every line before
  merge, integrates lanes, runs the DoD checklists (EF §1.5). Nothing merges unreviewed —
  parallelism must not reintroduce vibe-coding.
- **Agent lanes** (parallel Claude subagents, worktree-isolated): each lane owns a **disjoint
  path set** — no two lanes touch the same directory, so merges are mechanical.
- **Local model lane** (`ollama run qwen3-coder:30b`, RTX 3090): token-saver for mechanical,
  well-specified tasks. Output is always orchestrator-reviewed before it enters the tree.

### Local-model delegation policy

| Delegate to qwen3-coder | Never delegate |
|---|---|
| Config boilerplate (tsconfig, eslint, prettier, editorconfig) | Auth / token / crypto code |
| Seed-data generation (coffees, grinders, recipes JSON) | Policy layer / authorization |
| Test scaffolds from a written spec | Payment / money paths (Phase 4) |
| Email template rebranding (Zentra → BrewCult strings/colors) | Schema/migration *design* (review-heavy) |
| README / doc stubs, comment passes | Anything touching security headers, CSP, cookies |
| Mechanical ports with an exact spec ("same file, rename X→Y") | AI prompt/eval design |

Invocation pattern: `ollama run qwen3-coder:30b < task-spec.md > draft.out` → orchestrator
reviews/edits → commits. If a draft needs more than one substantive correction pass, stop
delegating that task class — escalation is cheaper than review-ping-pong.

---

## 2. Zentra reuse inventory

Source: `C:\Users\crist\todo_app\inkflow`. Three reuse levels — **V** verbatim (rebrand
only), **P** port with defined changes, **S** pattern/reference only (rewrite).

| Zentra asset | Level | Changes required (source: EF/DG) |
|---|---|---|
| `infra/docker-compose.yml` (dev, bind mounts) | P | + scheduler + mailpit services; rename volumes (DG §3) |
| `infra/docker-compose.prod.yml` | P | + scheduler; migrate container must **fail loudly** + `schema_migrations` table (DG §5.2); healthchecks on all app containers |
| `infra/deploy.sh` | P | + CI-green gate, migrate-as-step-with-abort, `DEPLOYED` hash, `--rollback` (DG §6) |
| `infra/Caddyfile` | P | brewcult hostnames incl. `mail.` cert block + `media.`; CSP without script `unsafe-inline` (DG §5.3) |
| `apps/api/src/lib/mailer.ts` | V | Rebrand templates (BrewCult name/colors/domain) — **local-model task** |
| `apps/api/src/lib/env.ts` (zod env schema) | P | BrewCult vars per DG §9 |
| `apps/api/src/modules/auth/google.ts` | P | `auth_identities` table instead of `google_sub` column; hard gate on `email_verified`; family-rotated refresh (DG §7.2) |
| Email/password + verification flow | P | Argon2id; keep 202-anti-enumeration + `login_attempts` |
| Refresh-token issuance | S | Rewrite: rotation + reuse-detection revokes family (EF §2.3) — Zentra lacks rotation |
| PWA service worker + `/sw.js` no-store rule | P | Adapt for logger offline queue later (M2) |
| Next.js app structure, Dockerfile.prod pair | P | Baseline for `apps/web`, `apps/api` |
| MinIO + bucket-init script | V | Rename bucket/volumes |

Not reused: Zentra domain logic (todos/huddles), its DB schema, its lack of policy layer —
authorization is **new build** (EF §3.2), never ported.

---

## 3. Waves and lanes

Lanes within a wave run in parallel; waves are sequential (each ends with orchestrator
review + CI green + merge).

### Wave 0 — repo seed (orchestrator, no agents) ✅ this commit
Design docs + brand assets committed to `docs/`; this plan; `.gitignore`, LICENSE decision
pending (default: proprietary until stated otherwise).

### Wave 1 — foundations (4 parallel lanes)

| Lane | Owns paths | Backlog | Content | Executor |
|---|---|---|---|---|
| **A Scaffold** | `/` root configs, `.github/`, `packages/` | F-01..F-04, F-13 skeleton | npm workspaces, TS configs, eslint+boundary rules, CI yml, ADR template + ADR-001/002/003 files extracted from docs | Claude agent; configs drafted by local model |
| **B Infra** | `infra/`, `db/` tooling | F-06(local part), F-07, F-17, F-18, F-20 | dev+prod compose, Dockerfiles, deploy.sh, Caddyfile, migration runner (fail-loud), health/readiness endpoints contract | Claude agent (ports Zentra per §2) |
| **C Brand pipeline** | `tools/brand/`, `apps/web/public/` (icons only) | icon gaps from brand review | `npm run brand:export` (sharp): PWA 192/512 + maskable + apple-touch-180 + badge-96 + multi-ICO + OG + email header from `docs/brand/` SVGs | Local model drafts script; Claude agent verifies outputs pixel-by-pixel |
| **D Data base** | `db/migrations/`, `db/seed/` | F-09 start, CAT-01/02 schema draft | Initial migrations (identity + catalog per second_draft §21), deterministic seed harness + seed data | Claude agent designs schema; local model generates seed JSON |

Merge order: A → B → D → C (A defines the workspace everyone lands in).

### Wave 2 — identity & catalog (3 lanes, after Wave 1 merged)

| Lane | Owns | Backlog | Notes |
|---|---|---|---|
| **E Auth** | `apps/api/src/modules/identity/` | ID-01..ID-09 | The security-critical lane: **Claude only**, no local model. Ports Zentra auth per §2 with all hardenings; policy layer (ID-08) built here and exported for every later module |
| **F Catalog** | `apps/api/src/modules/catalog/`, admin routes | CAT-01..CAT-08 | CRUD + search + autocomplete; consumes policy layer stubs until E merges |
| **G Web shell** | `apps/web/` | app shell, auth pages, PWA manifest | Next.js skeleton, login/register/profile pages against E's OpenAPI contract; manifest wires Lane C icons |

### Wave 3 — the product (after Wave 2)
Recipes + logger (REC-*, BREW-*) — logger UX (BREW-02) must be designed before this wave
fires; offline sync; catalog SSR/SEO pages. Lane split decided at wave start.

### Wave 4 — AI (M3) — single lane, orchestrator-heavy (evals + injection suite are the point).

---

## 4. Rules of engagement

1. **One lane, one path set.** An agent needing to touch another lane's files stops and
   reports — the orchestrator re-slices; agents never cross-edit.
2. **Contracts first**: OpenAPI/event/schema stubs merge in Wave 1 so Wave-2 lanes build
   against contracts, not against each other's unmerged code.
3. Every lane's output lands as a PR-shaped change: orchestrator review against EF §1.5 DoD
   (+ §3.8/§4.6 checklists where triggered) before merge to `main`.
4. CI green is the merge gate from the moment Lane A lands the pipeline.
5. Local-model outputs are labeled in commit messages (`draft: qwen3-coder, reviewed`) —
   provenance stays auditable.
6. Wave ends with a **smoke ritual**: `docker compose up` from clean checkout must yield a
   working environment before the next wave fires.

---

## 5. Wave 1 exit criteria

- `docker compose up` on a clean clone → web + api + worker + scheduler + postgres + redis +
  minio + mailpit all healthy; seed command populates the dev world.
- CI runs lint/typecheck/unit/boundary checks on PR; red blocks merge.
- `npm run brand:export` regenerates every icon; PWA manifest set complete.
- Initial migrations apply via fail-loud runner; `schema_migrations` tracks state.
- ADR-001/002/003 committed as files.
