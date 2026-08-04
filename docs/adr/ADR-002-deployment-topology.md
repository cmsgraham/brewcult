# ADR-002 — Deployment topology: containerized modular core, Kubernetes path

- **Status**: Accepted
- **Date**: 2026-08-03
- **Deciders**: BrewCult core
- **Source**: `docs/engineering_foundations.md` §7

## Context

BrewCult's domain is one entity graph whose value is joins — coffees, gear,
recipes, brews, people. A small pre-PMF team running one service per module
would pay for N deploy pipelines, distributed transactions across its own
graph, network failure modes between its own modules, observability sprawl,
contract version skew, and slow local dev — hours not spent on the ≤15s brew
logger. A distributed monster is worse than a monolithic one: the mess hides
in the network. At the same time, an un-containerized snowflake deploy would
make the eventual scale-up a re-platforming event.

## Decision

**Containerized from day one; microservice-ready, not microservice-first.**

One codebase deploys as **role-based containers**, all built from the same
repo, differing only in entrypoint: `web` (Next.js), `api` (all modules'
routes), `worker` (outbox relay + event consumers), `scheduler` (cron:
retention jobs, digests, batch AI). Backing services (Postgres+pgvector,
Redis, object storage, secrets) are managed/attached, never bespoke. Every
container is 12-factor: env-only config, stateless, health + readiness
endpoints, graceful SIGTERM drain, structured logs to stdout.

Orchestrator path: Docker Compose for local dev → Compose on a single VM (or
managed containers) for Phase-1 beta → **managed Kubernetes at Phase 2–3**
(GKE/EKS/AKS; k3s acceptable as budget midpoint). **Docker Swarm is
rejected**: effectively maintenance-mode, shrinking ecosystem and hiring pool,
weak managed offerings — adopting it in 2026 is adopting legacy on day one.
The Compose→k8s road is industry standard and every tooling investment
transfers.

A module graduates to its own service only when a **named trigger** fires
(EF §7.4): a second team + real deploy contention; hard-diverging scaling
profile; a risk-isolation boundary (commerce at Phase 4); or a genuine runtime
mismatch. Never for aesthetics. Likely extraction order: intelligence (AI
gateway) → media pipeline → commerce. Each extraction gets its own ADR with a
rollback plan.

## Consequences

- Lint-enforced module boundaries + versioned events + OpenAPI contracts give
  the disciplines of microservices without the day-one tax; later extraction
  is mechanical (module already owns its tables, events, and interface).
- Worker/scheduler exist as containers from Wave 1 even while nearly empty —
  the topology is exercised before it matters.
- k8s manifests (Kustomize vs Helm: decide in a future ADR) enter the repo
  when we target k8s; CI grows image build/push at that point (see ADR-003).
- Cost: some day-one ceremony (healthchecks, drain handling, compose plumbing)
  for processes that are still tiny. Accepted — retrofitting 12-factor is far
  more expensive than starting with it.
