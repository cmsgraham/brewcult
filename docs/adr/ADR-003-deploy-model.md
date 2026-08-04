# ADR-003 — Phase-1 deploy model: rsync + server-side compose builds

- **Status**: Accepted
- **Date**: 2026-08-04
- **Deciders**: BrewCult core
- **Source**: `docs/deployment_guide.md` §1 (ADR-003), §4–6

## Context

Phase 1 runs on a single VPS (Compose topology per ADR-002) operated by a
very small team. The deploy mechanism must be one command, fully understood
by the operator, and must not scatter credentials: no registry account, no CI
deploy keys on the server. Zentra already proved exactly such a model in this
team's operations: rsync source to the server, rebuild containers there with
`docker compose`. The alternative — a registry + image pipeline with CI-driven
deploys — is the right k8s-era answer but is day-one ceremony for a one-box
beta.

## Decision

**Phase-1 deploys are file-sync deploys.** `infra/deploy.sh` rsyncs source to
the VPS and rebuilds containers server-side with `docker compose`
(`./deploy.sh [web|api|all|caddy] [--no-sync|--rollback|--force]`).

- **CI (GitHub Actions) is the quality gate, not the deployer.** The script
  refuses to deploy unless the latest `main` CI run is green (`--force`
  overrides, loudly). Deploys run from the developer machine (or WSL).
- **Migrations are a deploy step, not a side effect**: the one-shot `migrate`
  container runs after sync and a failure **aborts the deploy** — fail-loud,
  `schema_migrations` tracked, api blocked from starting on a bad migration.
- Worker + scheduler restart together with api (same image — schema skew
  between processes consuming the same events is a subtle-bug factory).
- Every deploy writes the deployed commit hash to `/srv/brewcult/DEPLOYED`;
  `--rollback` re-checks-out the previously deployed tag and re-syncs.
- Secrets live in `/srv/brewcult/.env.prod` (root:brewcult, chmod 640), never
  in the repo — the documented Phase-1 pragmatic exception to EF §3.7; a
  managed secrets store replaces it at the k8s migration.
- The registry + image pipeline (backlog F-19) is **re-scoped to the
  Kubernetes era** (Phase 2–3): when we move to k8s, deploys become
  image-based (CI builds/pushes on merge, staging on merge, prod on tag).

## Consequences

- One-command deploy/rollback with zero deploy credentials on the server and
  zero registry cost; "what's live?" is always answerable (`cat DEPLOYED`).
- Server-side builds mean a deploy briefly consumes VPS CPU and there is no
  zero-downtime guarantee — accepted for beta; the k8s migration (or a
  blue-green need) is the recorded trigger to supersede this ADR.
- CI-green gating depends on the operator's discipline plus the script's
  check; branch protection on `main` backs it up.
- Superseded automatically by the k8s-era pipeline: nothing in the app changes
  (images already build from the same Dockerfiles), only the delivery path.
