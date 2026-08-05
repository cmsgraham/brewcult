# Processor inventory

> Required by EF §4.4. Every third party that processes BrewCult user data,
> what it receives, where it runs, and how long it keeps it. Update in the same
> PR that introduces or changes a processor — the privacy checklist (EF §4.6)
> asks for it.

Status legend: **live** = in use today · **planned** = decided, not yet wired.

---

## 1. Anthropic — AI features

| | |
|---|---|
| **Status** | live (code path complete; requires `ANTHROPIC_API_KEY`) |
| **Purpose** | Dial-in advice, starting recipes, the assistant chat (`modules/intelligence`) |
| **Data sent** | Brewing context only: coffee/equipment entities from the catalog, the user's own brew parameters and taste verdicts, and community recipe text. **No emails, handles, display names or IP addresses** — outbound context is minimised by design and a PII guard strips known patterns as defence-in-depth (EF §3.4). |
| **Data classification** | P1 pseudonymous activity. A pseudonymous user id is sent only where a tool needs it to scope a query; it is not a directory identifier. |
| **Region** | Anthropic API (US-operated). Confirm the account's region and retention configuration when the production key is created and record the answer here. |
| **Training** | API traffic is not used to train models by default. |
| **Retention (their side)** | Per Anthropic's API data-retention configuration for the account — **verify and record before production launch**; a zero-retention or 30-day setting materially changes what we tell users. |
| **Sub-processing risk** | Model output is untrusted input to us (see `docs/threat-models/intelligence.md`). |
| **User-facing disclosure** | §4.5 consent surface: personalization is explained at signup with an off switch; the assistant states its basis for each answer. |
| **DPA** | Required before production. **Not yet in place** — blocker for launch, not for development. |

## 2. Hosting / infrastructure

| | |
|---|---|
| **Status** | planned (single VPS per `deployment_guide.md` §5) |
| **Purpose** | Runs the app containers, Postgres, Redis and object storage |
| **Data** | Everything: P0–P3 including P2 personal data and (via the mail server) message contents |
| **Region** | Chosen with the commerce launch country (open decision, second_draft risk #10). If EU users are in scope at launch, prefer an EU region or document the transfer mechanism (EF §4.4). |
| **Retention** | Ours to control — the retention schedule in EF §4.2 is enforced by scheduled deletion jobs, not by the host |
| **DPA** | Required before production |

## 3. Self-hosted mail server (docker-mailserver)

| | |
|---|---|
| **Status** | planned (`deployment_guide.md` §8) |
| **Purpose** | Transactional email (verification, password reset) and the weekly briefing |
| **Data** | Email addresses (P2) and message contents |
| **Note** | Self-hosted on our own infrastructure, so **not a third-party processor** — it inherits the hosting entry above. Listed here so the data flow is visible in one place. |
| **Interim option** | Hosting `brewcult.coffee` on the existing Zentra mail server (a first-party system under the same operator) until BrewCult's own box exists. |

## 4. Error tracking (Sentry-class)

| | |
|---|---|
| **Status** | planned (`SENTRY_DSN` exists in env, not yet wired) |
| **Purpose** | Crash and error reporting |
| **Data** | Stack traces, request metadata. **Must be configured to scrub** bodies, headers and query strings — an unfiltered error reporter is a P2 leak by accident. |
| **Retention** | Provider default; keep short (≤90 days) |
| **DPA** | Required before production |

## 5. Payment provider (Stripe) — Phase 4 only

| | |
|---|---|
| **Status** | not started (marketplace is Phase 4) |
| **Purpose** | Marketplace payments, seller onboarding/KYC, payouts |
| **Data** | P3 — payment and identity artefacts. **Held by the provider, referenced by us**: BrewCult stores provider references, never card data (SAQ-A scope, `deployment_guide.md` §13.1). |
| **DPA** | Required before any live transaction |

---

## Not processors (worth stating, to prevent drift)

- **MinIO / object storage** — self-hosted alongside the app; inherits hosting.
- **Ollama / local models** — used only for *development* code generation on the
  maintainer's machine. **No user data ever reaches it.**
- **Analytics** — none. EF §4.1 mandates no third-party ad trackers; if
  first-party analytics ships later it is a change to this file.

## Open items before production

1. Record Anthropic account region + retention configuration once the
   production key exists.
2. DPAs: Anthropic, hosting provider, error tracking.
3. Decide the hosting region alongside the commerce launch country.
4. Configure error-tracking scrubbing before enabling `SENTRY_DSN`.
