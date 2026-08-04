# BrewCult — Phase 1 Development Backlog

> Granular task breakdown for Phase 1 (Brewing Intelligence) per `second_draft.md` §24 and the
> engineering rules in `engineering_foundations.md` (EF). Security and privacy tasks are
> embedded in each epic **and** gated in the milestone exit criteria — they are not a
> parallel track that can slip.
>
> Sizing: S ≤ 1 day · M = 2–4 days · L = 1–2 weeks (single engineer; calibrate after M0).
> IDs are stable — reference them in commits/PRs (`F-03`, `BREW-07`).
> Every task inherits the Definition of Done (EF §1.5); acceptance notes below are the
> task-specific additions.

**Phase 1 exit criteria (from second_draft §24):** ≥40% of signups log 3+ brews in week 1;
dial-in advice rated helpful ≥70%; median time-to-log ≤15s.

---

## Milestone M0 — Foundations (everything else builds on this)

### Epic F — Repo, CI, infra
| ID | Task | Size | Acceptance |
|---|---|---|---|
| F-01 | Monorepo scaffold (`apps/web`, `api`, `packages/shared-types`, `docs/`) with lint, typecheck, formatter | S | `make check` green on empty project |
| F-02 | ADR practice: `docs/adr/` template + **ADR-001 stack decision** (EF §6) written and merged | S | ADR-001 approved |
| F-03 | CI pipeline: lint → typecheck → unit → integration → contract → build; <10 min | M | Red build blocks merge |
| F-04 | Module boundary enforcement in CI (import-linter/dependency-cruiser rules for the 8 modules) | S | Cross-module table import fails CI (proven by a test violation) |
| F-05 | Dependency audit + SAST + lockfile pinning in CI; auto-update PRs enabled | S | Known-critical CVE fails build |
| F-06 | Managed Postgres (PITR backups on) + Redis/queue; staging + prod environments | M | Restore-from-backup executed once and documented (runbook) |
| F-17 | Containerize all deployables (web, api, worker, scheduler — EF §7.2): multi-stage builds, non-root, minimal base; Docker Compose for local dev incl. Postgres/Redis/seed | M | `docker compose up` gives a working seeded environment on a clean machine |
| F-18 | 12-factor runtime conformance: env-only config, health/readiness endpoints, SIGTERM graceful drain, structured stdout logs (EF §7.2) | S | Rolling restart drops zero in-flight requests in test |
| F-19 | ~~Image registry pipeline~~ **Re-scoped to k8s era (ADR-003)** — Phase 1 deploys are rsync + server-side compose builds per `deployment_guide.md`; registry/image pipeline activates at the k8s migration (EF §7.3) | — | Deferred; tracked in "Explicitly deferred" |
| F-20 | Implement `infra/deploy.sh` + prod compose + Caddyfile per `deployment_guide.md` §5–6: CI-green gate, fail-loud migrate step, DEPLOYED hash, `--rollback` | M | Deploy, rollback, and "what's live?" all one command; failed migration aborts deploy |
| F-21 | Email per `deployment_guide.md` §8: self-hosted docker-mailserver (Zentra pattern) — own compose project on VPS, mailboxes (hello/support/legal/dmarc), DKIM gen, MX/SPF/DKIM/DMARC + PTR records, app SMTP credential; Mailpit in dev compose. Interim: host brewcult.coffee on the existing Zentra mail server for warmed IP reputation | M | Gmail *Show original* shows SPF/DKIM/DMARC = PASS; inbound to hello@ arrives via IMAP; mail-tester ≥9/10 |
| F-07 | Migration tooling wired to CI (staging on merge, prod on tag); rollback documented | S | Bad migration on staging demonstrably recoverable |
| F-08 | Secrets manager integration; zero secrets in repo/env files; access documented | S | Grep audit clean; app boots from secret store |
| F-09 | Deterministic seed command: 20 coffees, 10 grinders, 15 brewers, 50 recipes, 5 demo users | M | Fresh dev env realistic in one command |
| F-10 | Error tracking (Sentry-class) on API + web, release-tagged | S | Test error visible with release tag |
| F-11 | Observability baseline: golden-signal dashboard + one alert channel (EF §5.1) | M | Latency/error/rate visible per route class |
| F-12 | Transactional outbox + event bus skeleton; `event.v1` envelope schema; one demo consumer | M | Event emitted in same tx as write; consumer replays idempotently |
| F-13 | OpenAPI-first workflow: spec location, codegen/contract-test harness, CI conformance check (EF §1.3) | M | Endpoint diverging from spec fails CI |
| F-14 | Feature-flag service (server-evaluated) + `GET /v1/client-config` (EF §2.5) | S | Flag flips behavior without deploy |
| F-15 | Security headers/CSP/HSTS middleware + automated header check in CI (EF §3.3) | S | CSP has no `unsafe-inline`; check green |
| F-16 | Central rate-limit middleware (per-IP, per-account, route classes) (EF §3.3) | M | Auth routes strict-limited; 429s observable |

### Epic ID — Identity & auth
| ID | Task | Size | Acceptance |
|---|---|---|---|
| ID-01 | User model with **multi-provider auth identities** (email + Google + Apple linkable) (EF §2.3) | M | One user, N providers; unlink safe |
| ID-02 | Email/password auth: Argon2id, verification mail, strength policy, breach-list check | M | OWASP ASVS-aligned; lockout with backoff |
| ID-03 | Token issuance: 15-min JWT access + rotating refresh with family reuse-detection (EF §2.3) | L | Reuse of rotated token revokes family (tested) |
| ID-04 | Web cookie transport (HttpOnly/Secure/SameSite) + CSRF protection on cookie-authed mutations | M | CSRF test suite green |
| ID-05 | OAuth: Google sign-in via OAuth2.1/PKCE flow (shape reused by iOS later) | M | Links to existing account by verified email |
| ID-06 | Session management UI: list devices/sessions, revoke one/all | S | Revocation takes effect ≤ access-token TTL |
| ID-07 | TOTP MFA (optional for users; enforcement hook for staff roles) | M | Enroll, verify, recovery codes |
| ID-08 | RBAC roles + **central policy layer**, default-deny object policies (EF §3.2) | L | No inline ownership checks (lint rule); IDOR test suite green |
| ID-09 | Append-only audit log for auth events + role changes (EF §3.7) | S | App role cannot modify/delete audit rows |
| ID-10 | STRIDE-lite threat model doc: identity module (EF §3.1) | S | One page in `docs/threat-models/` |
| ID-11 | Privacy: password-reset + email-change flows hardened (old-address notify, token single-use) | S | Token reuse fails |
| ID-12 | Public profile: handle, display name, bio, equipment list, visibility defaults conservative | M | New accounts private-by-default except handle |

**M0 exit gate:** all F + ID tasks done; IDOR/CSRF/auth test suites in CI; restore-from-backup
proven; ADR-001 merged.

---

## Milestone M1 — Catalog & entity graph

### Epic CAT — Catalog
| ID | Task | Size | Acceptance |
|---|---|---|---|
| CAT-01 | Schema: Roaster, Origin, Farm, CoffeeLot, CoffeeProduct, RoastBatch (second_draft §21.2) | M | 3-level coffee taxonomy enforced by FKs |
| CAT-02 | Schema: EquipmentBrand, EquipmentModel with category + `grind_scale_type` | S | Grinders carry scale type (stepped/stepless/rotational) |
| CAT-03 | Data classification pass on all M1 tables per EF §4.1 + retention entries (EF §4.2) | S | Every field classed P0–P3 in schema docs |
| CAT-04 | Catalog read API: `GET /coffees`, `/roasters`, `/equipment` + detail-by-slug; OpenAPI'd | M | Cursor pagination; contract tests |
| CAT-05 | Admin/editorial CRUD for catalog (behind staff auth + MFA + audit log) | M | Non-staff gets 403; edits audited |
| CAT-06 | Entity autocomplete endpoint (typeahead across coffees/roasters/equipment) — powers §5 "no free text" rule | M | <100ms p95 on seed data |
| CAT-07 | Search v1: Postgres FTS across catalog + recipes | M | Relevance sanity-checked against 20 golden queries |
| CAT-08 | pgvector setup + embedding pipeline for catalog entities (batch job, event-driven refresh) | M | Semantic "fruity Ethiopian" query returns sane results |
| CAT-09 | SEO: SSR public pages for coffee/roaster/equipment with structured data (schema.org Product/Review stubs) | M | Lighthouse SEO ≥95; indexed in staging sitemap |
| CAT-10 | Seed real launch catalog: ~100 coffees, ~60 grinders/brewers from public data (editorial task, tooling support) | L | Catalog credible to a P2 user |

**M1 exit gate:** a P2 enthusiast can find their grinder, brewer, and a coffee they own in
seed data; all tables classified; staff surface MFA'd.

---

## Milestone M2 — Recipes & the brew logger (the make-or-break milestone)

### Epic REC — Recipes
| ID | Task | Size | Acceptance |
|---|---|---|---|
| REC-01 | Recipe schema: method-split params as versioned JSONB (filter/espresso schemas per second_draft §6.3) + JSON Schema validation at boundary (EF §1.3) | M | Invalid params rejected with field errors; `schema_version` stored |
| REC-02 | Grind representation: (grinder_model, setting, scale_type) + mandatory coarse category (§6.4) | S | Bare-number grind impossible via API |
| REC-03 | Recipe CRUD API with client-generated UUIDv7 + idempotent PUT upsert (EF §2.2) | M | Double-submit creates one recipe |
| REC-04 | Fork semantics: `parent_recipe_id`, stored diff, permanent attribution (§6.6) | M | Fork displays "forked from" + changed fields |
| REC-05 | Recipe visibility (private/unlisted/public) enforced via policy layer | S | IDOR tests cover all three states |
| REC-06 | Public recipe SSR pages (SEO surface: "V60 recipe for X") | M | Structured data; shareable OG cards |
| REC-07 | Recipe conflict-copy sync behavior (EF §2.2) | M | Concurrent edit produces "(conflicted copy)", never silent overwrite |

### Epic BREW — Brew logger
| ID | Task | Size | Acceptance |
|---|---|---|---|
| BREW-01 | BrewSession schema: equipment snapshot, actual params, structured result (§6.7 taste capture), rating, optional photo | M | Result maps to extraction diagnosis inputs |
| BREW-02 | **Logger UX design sprint**: ≤15s median flow, one-tap "same as last time" (todo item; do before build) | M | Clickable prototype; 5 hallway tests ≤15s |
| BREW-03 | Logger implementation (web/PWA): prefill from last session per coffee, timers optional not modal | L | Median time-to-log instrumented and ≤15s in beta |
| BREW-04 | Offline queue + replay for brew logging (PWA service worker + local store; EF §2.2 sync v1) | L | Airplane-mode log syncs cleanly on reconnect; retry-safe |
| BREW-05 | `GET /v1/sync/changes` for user's own brews/recipes | M | Cursor-based; contract-tested |
| BREW-06 | Photo upload: presigned URL, content-sniff, re-encode, EXIF/GPS strip, CDN domain (EF §3.5) | M | Polyglot file rejected; GPS provably stripped |
| BREW-07 | Brew history views: per-coffee timeline with rating trend ("improvement visible" — §10.2) | M | Trend chart on ≥3 sessions of same coffee |
| BREW-08 | Product events: `brew.logged.v1`, `recipe.forked.v1` etc. emitted via outbox; activation metric computed (EF §5.2) | S | Activation dashboard live |
| BREW-09 | Data export v1: brews + recipes, self-serve, machine-readable (EF §4.3 — deliberately early) | M | Complete export downloadable from settings |
| BREW-10 | Account deletion v1: hard-delete P1/P2, anonymize public forked recipes, plain-language notice (EF §4.3) | M | Deletion job verified; forks survive anonymized |
| BREW-11 | Threat model: brewing/community content module (EF §3.1) | S | Doc merged |

**M2 exit gate:** the logger hits ≤15s median in internal beta; offline log/sync works;
export + deletion shipped (privacy features are launch features, not fast-follows).

---

## Milestone M3 — AI assistant v1

### Epic AI — Intelligence
| ID | Task | Size | Acceptance |
|---|---|---|---|
| AI-01 | AI gateway module: provider client, per-feature model routing, token accounting per user/feature/day (§16.1) | M | Spend dashboard by feature |
| AI-02 | Tool layer over the graph: `get_user_setup`, `search_recipes`, `get_coffee`, `get_brew_history` — **executing through the policy layer with requester's authz** (EF §3.4) | L | Tool cannot read another user's private data (tested) |
| AI-03 | Prompt architecture: stable system prompt + tools first, per-user context after cache breakpoint; prompt caching verified | M | `cache_read_input_tokens` > 0 on repeat calls |
| AI-04 | Chat endpoint `POST /v1/ai/chat` (SSE streaming) + web UI | L | Streamed answers with entity cards |
| AI-05 | Starting-recipe generation for (coffee, equipment) grounded in official/community recipes with fallback disclosure (§7.2) | M | "No community data" honesty case covered |
| AI-06 | Dial-in diagnosis: structured taste result → one-variable-at-a-time advice (§7.1) | M | Golden-set eval ≥ agreed bar |
| AI-07 | **Eval harness in CI**: dial-in golden set + adversarial prompt-injection suite (incl. "recommend my store" seeded attack) (EF §1.4, §3.4) | L | Prompt/model changes blocked on eval regression |
| AI-08 | Output handling: markdown sanitization, entity-reference allowlist resolution (EF §3.4) | S | Injected HTML/script inert; fake entity IDs rejected |
| AI-09 | PII minimization in outbound context + gateway PII pattern guard (EF §3.4, §4.4) | S | Email/name never in prompts (test fixtures) |
| AI-10 | Per-user AI budgets + graceful budget-exhausted UX (free tier) | S | Budget hit → friendly limit message, not error |
| AI-11 | Processor inventory entry + data-retention configuration confirmed for the LLM account (EF §4.4) | S | `docs/privacy/processors.md` row complete |
| AI-12 | Threat model: intelligence module (EF §3.1) | S | Doc merged |
| AI-13 | Batch pipeline skeleton (for later news digests): nightly batch job harness using provider batch API | S | One toy batch runs nightly on staging |

**M3 exit gate:** eval suite in CI and green; injection suite green; AI spend per DAU within
modeled budget; helpfulness rating instrumented in UI.

---

## Milestone M4 — Grind conversion, taste profile, beta launch

### Epic GC — Grind conversion (the moat feature)
| ID | Task | Size | Acceptance |
|---|---|---|---|
| GC-01 | GrindConversion schema + seed from licensed/permissible public charts (§6.4) | M | Provenance field distinguishes seeded vs user-confirmed |
| GC-02 | Conversion capture: fork-to-my-grinder flow records confirmed pairs only after a rated-good brew (risk #9) | M | Unconfirmed conversions never enter the dataset |
| GC-03 | Conversion API + AI tool with confidence + data-point count surfaced (§6.4 Gherkin) | M | Low-data pairs say so explicitly |
| GC-04 | Flag/correct a bad conversion (trust loop) | S | Flagged pairs quarantined from suggestions |

### Epic TP — Taste profile v1
| ID | Task | Size | Acceptance |
|---|---|---|---|
| TP-01 | Taste feature extraction job from rated brews (event-driven, rebuildable — EF invariant) | M | Full rebuild from events matches incremental state |
| TP-02 | Consent surface: personalization explained at signup + off switch (EF §4.5) | S | Opt-out degrades recommendations only |
| TP-03 | "Your taste so far" profile view (competence display, §10.2) | M | Honest empty/low-data states |

### Epic LAUNCH — Beta hardening
| ID | Task | Size | Acceptance |
|---|---|---|---|
| L-01 | Onboarding: equipment picker + first-brew guided log + AI hello (activation path) | L | Instrumented funnel to the activation metric |
| L-02 | Weekly briefing email v1 (even pre-news: your brews + your gear tips) + one-click opt-out (§10.4) | M | Consent categories respected |
| L-03 | Privacy policy + ToS (plain language, 16+ gate) — legal review | M | Published; deletion/export flows referenced |
| L-04 | Beanconqueror import tool (§3.4 wedge) | L | Round-trip fidelity on sample exports |
| L-05 | Load test golden paths; fix to p95 targets | M | Logger p95 < 300ms server-side |
| L-06 | Security review pass: run EF §3.8 checklist across all M0–M4 PR surface; external pentest scoped (booked for pre-Phase-4) | M | Findings triaged to zero criticals |
| L-07 | Incident runbooks + on-call-lite rota (even solo: escalation and comms templates) (EF §5.4) | S | Tabletop exercise done once |
| L-08 | Closed beta cohort (30–50 P2 users from coffee communities), feedback loop, activation dashboard watch | L | Phase-1 exit criteria measured for real |

**Phase 1 done when:** second_draft §24 exit criteria met on the beta cohort, security/privacy
gates above all green, and the backlog for Phase 2 (community) is groomed against what beta
taught us.

---

## Standing tracks (no end date)

| ID | Track | Cadence |
|---|---|---|
| ST-01 | Dependency updates + CVE triage | Weekly |
| ST-02 | AI eval review (new failure cases → golden set) | Weekly during M3+ |
| ST-03 | Threat-model refresh when a module's surface changes | Per DoD |
| ST-04 | Retention-job verification (privacy schedule actually deleting) | Monthly |
| ST-05 | Backup restore test | Quarterly |
| ST-06 | ADR grooming — decisions made in chat/PRs get captured | Weekly |

---

## Explicitly deferred (so nobody "helpfully" builds them early)

- Native iOS app (after Phase 2 — but every EF §2 constraint is enforced now so it lands soft)
- Feeds/fan-out, reputation engine, moderation queues (Phase 2)
- News module, affiliate links (Phase 3)
- All commerce (Phase 4 — including Stripe integration; only the entitlements-service seam
  from EF §2.4 is stubbed)
- OpenSearch, Kafka, multi-region (revisit at scale triggers only)
- Microservice extraction — only when a named trigger in EF §7.4 fires; each extraction gets
  its own ADR (likely order: intelligence → media → commerce)
- Full Kubernetes — target runtime per EF §7.3, adopted Phase 2–3; Phase 1 beta runs
  Compose-on-VM or managed containers (Swarm rejected, ADR-002)
