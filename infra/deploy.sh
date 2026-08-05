#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  BrewCult deploy script (deployment_guide.md §6, ADR-003)
#  Zentra's rsync + server-side-build model, upgraded with: CI-green gate,
#  migrations as an aborting step, DEPLOYED hash recording, --rollback.
#
#  Usage:
#    ./deploy.sh                 # sync + build + restart web
#    ./deploy.sh api             # sync + build + restart api (+ worker & scheduler, same image)
#    ./deploy.sh all             # everything
#    ./deploy.sh caddy           # sync Caddyfile + restart caddy (no rebuild)
#    ./deploy.sh --no-sync       # rebuild from what's already on the server
#    ./deploy.sh --force         # skip the CI-green gate (shame banner included)
#    ./deploy.sh --rollback      # re-sync + rebuild the previously deployed commit
#
#  Run from the developer machine or WSL (needs: bash, ssh, rsync, git, gh).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Server configuration (override any of these from the environment) ────────
SSH_KEY="${SSH_KEY:-$HOME/.ssh/key}"                # SSH private key for the VPS
SSH_HOST="${SSH_HOST:-cmsgraham@172.235.130.124}"   # user@host
REMOTE="${REMOTE:-/srv/brewcult}"                   # deploy root on the server (§5.1; .env.prod lives here)
BRANCH="${BRANCH:-main}"                            # branch whose CI status gates deploys
SITE_URL="https://brewcult.coffee"

# The container that terminates TLS. On the SHARED host this is Zentra's Caddy
# (it owns :80/:443 and the ACME account); BrewCult's own caddy service stays
# behind the `edge` compose profile. On a standalone BrewCult VPS, set
# EDGE_CONTAINER=brewcult-caddy. See docker-compose.prod.yml's EDGE note.
EDGE_CONTAINER="${EDGE_CONTAINER:-zentra-caddy}"
EDGE_CADDYFILE="${EDGE_CADDYFILE:-/home/cmsgraham/inkflow/infra/Caddyfile}"

LOCAL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root
COMPOSE="docker compose -f docker-compose.prod.yml --env-file $REMOTE/.env.prod"

# rsync policy (§6.5): checksum mode, --delete on source dirs,
# never ship env files, dependencies, or git history.
RSYNC_EXCLUDES=(--exclude '.env*' --exclude 'node_modules' --exclude '.git')

# ── Argument parsing ─────────────────────────────────────────────────────────
TARGET="web"
NO_SYNC=false
FORCE=false
ROLLBACK=false
for arg in "$@"; do
  case "$arg" in
    web|api|all|caddy) TARGET="$arg" ;;
    --no-sync)  NO_SYNC=true ;;
    --force)    FORCE=true ;;
    --rollback) ROLLBACK=true ;;
    *)
      echo "Unknown argument '$arg'. Usage: ./deploy.sh [web|api|all|caddy] [--no-sync] [--force] [--rollback]" >&2
      exit 1
      ;;
  esac
done

ssh_run() { ssh -i "$SSH_KEY" "$SSH_HOST" "$1"; }
rsync_dir() {  # rsync_dir <local-dir/> <remote-dir/>  (deleting extraneous files)
  rsync -az --delete --checksum "${RSYNC_EXCLUDES[@]}" -e "ssh -i $SSH_KEY" \
    "$LOCAL/$1" "$SSH_HOST:$REMOTE/$2"
}
rsync_file() { # rsync_file <local-file> <remote-file>
  rsync -az --checksum -e "ssh -i $SSH_KEY" \
    "$LOCAL/$1" "$SSH_HOST:$REMOTE/$2"
}

# ── CI gate (§6.1): latest CI run on $BRANCH must be green ───────────────────
ci_gate() {
  if [[ "$FORCE" == "true" ]]; then
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║  ⚠  --force: DEPLOYING WITHOUT A GREEN CI RUN.                ║"
    echo "║  You are shipping unverified code to production. If this      ║"
    echo "║  breaks, it was not the tooling's fault. Shame. Shame. Shame. ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "✗ gh CLI not found — cannot verify CI status for '$BRANCH'." >&2
    echo "  Install GitHub CLI, or use --force to bypass (discouraged)." >&2
    exit 1
  fi
  echo "→ Checking CI status on '$BRANCH'..."
  local run_info status conclusion
  run_info=$(gh run list --branch "$BRANCH" --limit 1 --json status,conclusion \
    --jq '.[0] | (.status // "none") + ":" + (.conclusion // "")')
  status="${run_info%%:*}"
  conclusion="${run_info#*:}"
  if [[ "$status" != "completed" || "$conclusion" != "success" ]]; then
    echo "✗ Latest CI run on '$BRANCH' is not green (status=$status conclusion=${conclusion:-n/a})." >&2
    echo "  Fix CI first, or use --force to bypass (discouraged)." >&2
    exit 1
  fi
  echo "✓ CI is green"
}

# ── Sync functions ───────────────────────────────────────────────────────────
sync_common() {
  # rsync creates the LEAF directory but not intermediate parents, so a
  # first-ever deploy dies on `mkdir "/srv/brewcult/apps/web": No such file`.
  # Cheap and idempotent, so it runs every time rather than only on bootstrap.
  ssh_run "mkdir -p $REMOTE/apps $REMOTE/packages"
  echo "→ Syncing shared workspace files (root config, packages/, db/, infra/)..."
  # Every top-level FILE, not an enumerated list. The Dockerfiles build from the
  # repo root and `COPY . .`, so anything at the root is potentially part of the
  # build — tsconfig.base.json, .dockerignore, .nvmrc, eslint config. Listing
  # them by hand means the next root config file added to the repo produces a
  # build that fails only on the server (this cost one deploy: `next build` died
  # on "Cannot read file '/app/tsconfig.base.json'").
  #   -f '- /*/'  excludes top-level DIRECTORIES; the explicit syncs below own
  #               those, and no --delete here so they are left untouched.
  rsync -az --checksum "${RSYNC_EXCLUDES[@]}" -f '- /*/' -e "ssh -i $SSH_KEY" \
    "$LOCAL/" "$SSH_HOST:$REMOTE/"
  if [[ -d "$LOCAL/packages" ]]; then
    rsync_dir packages/ packages/
  fi
  rsync_dir db/ db/            # migrations + migrate.sh always ship (§6.5)
  rsync_dir infra/ infra/      # compose files, Caddyfile, bucket script
  echo "✓ Shared files synced"
}

sync_web() {
  echo "→ Syncing web source..."
  rsync_dir apps/web/ apps/web/
  echo "✓ Web source synced"
}

sync_api() {
  echo "→ Syncing api source..."
  rsync_dir apps/api/ apps/api/
  echo "✓ API source synced"
}

sync_caddy() {
  echo "→ Syncing Caddyfile..."
  rsync_file infra/Caddyfile infra/Caddyfile
  # On the shared host the live config is Zentra's Caddyfile, which holds the
  # site blocks for BOTH apps; infra/Caddyfile here is the standalone-host copy
  # and is NOT what $EDGE_CONTAINER reads. Reloading it would be a no-op at
  # best, so refuse rather than pretend the deploy did something.
  if [[ "$EDGE_CONTAINER" != "brewcult-caddy" ]]; then
    echo "" >&2
    echo "✗ Edge TLS is served by '$EDGE_CONTAINER', not brewcult-caddy." >&2
    echo "  BrewCult's site blocks live in the shared config:" >&2
    echo "      $EDGE_CADDYFILE" >&2
    echo "  Edit that file, then: ssh $SSH_HOST 'docker exec $EDGE_CONTAINER caddy reload --config /etc/caddy/Caddyfile'" >&2
    exit 1
  fi
  echo "→ Reloading Caddy..."
  # Prefer reload (zero-downtime, and this box also serves a live app). Fall
  # back to restart if reload is rejected — restart takes ~3s and certificates
  # persist in the caddy data volume either way.
  ssh_run "docker exec $EDGE_CONTAINER caddy reload --config /etc/caddy/Caddyfile || docker restart $EDGE_CONTAINER"
  echo "✓ Caddy reloaded"
}

# ── Migrations as an aborting step (§6.2, §5.2) ──────────────────────────────
run_migrations() {
  echo "→ Running database migrations (fail-loud one-shot)..."
  if ! ssh_run "cd $REMOTE/infra && $COMPOSE run --rm brewcult-migrate"; then
    echo "" >&2
    echo "✗ MIGRATION FAILED — deploy aborted. No services were rebuilt or restarted." >&2
    echo "  Inspect: ssh $SSH_HOST 'cd $REMOTE/infra && $COMPOSE run --rm brewcult-migrate'" >&2
    exit 1
  fi
  echo "✓ Migrations applied"
}

# ── Build & restart ──────────────────────────────────────────────────────────
build_and_restart() {  # takes one or more service names
  local services="$*"
  echo "→ Building: $services..."
  # NOTE: deliberately NOT `--no-cache`. Building with --no-cache writes a fresh
  # multi-hundred-MB cache entry on every deploy that can never be reused — on
  # the Zentra box that leaked 48 GB over a few months and took the disk to 85%.
  # If a build ever needs to ignore cache, do it as a one-off by hand.
  ssh_run "cd $REMOTE/infra && $COMPOSE build $services"
  echo "→ Restarting: $services..."
  ssh_run "cd $REMOTE/infra && $COMPOSE up -d $services"
  bound_build_cache
  echo "✓ Deployed: $services"
}

# ── Keep the build cache bounded ─────────────────────────────────────────────
# Cache is what makes the NEXT build fast, so we keep a working set rather than
# dropping it all. Without a ceiling it grows until the disk is full, and a full
# disk on a box that also runs Postgres is an outage, not an inconvenience.
BUILD_CACHE_CEILING="${BUILD_CACHE_CEILING:-10GB}"
bound_build_cache() {
  echo "→ Trimming build cache above $BUILD_CACHE_CEILING..."
  # --keep-storage was renamed --reserved-space in newer Docker; try the new
  # flag first and fall back, so this works across engine versions.
  ssh_run "docker builder prune -f --reserved-space=$BUILD_CACHE_CEILING >/dev/null 2>&1         || docker builder prune -f --keep-storage=$BUILD_CACHE_CEILING >/dev/null 2>&1         || true"
  ssh_run "df -h / | tail -1"
}

# ── Post-deploy verification ─────────────────────────────────────────────────
# A build that COMPILES is not a deploy that WORKS: the artifact still has to
# boot. `docker compose up -d` returns as soon as the container is created, not
# when the process survives, so without this the script happily prints "🚀 Done!"
# over a crash-looping container. That is exactly what happened on the first
# BrewCult deploy — tsc and next build were both green, and the API died at
# runtime on an ESM resolution error that no unit test could see.
#
# Fails the deploy loudly and prints the logs, because a silent bad deploy is
# how you find out from a user instead of from your own tooling.
VERIFY_TIMEOUT="${VERIFY_TIMEOUT:-90}"
verify_running() {  # verify_running <container> [<container>...]
  local deadline=$((SECONDS + VERIFY_TIMEOUT)) failed=()
  echo "→ Verifying containers stay up (${VERIFY_TIMEOUT}s budget)..."
  for name in "$@"; do
    local ok=false state health
    while (( SECONDS < deadline )); do
      # A container with a healthcheck must report healthy; one without only
      # has to still be running a few seconds after start (crash loops flip to
      # "restarting", which never satisfies either condition).
      state=$(ssh_run "docker inspect -f '{{.State.Status}}' $name 2>/dev/null" || echo missing)
      health=$(ssh_run "docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $name 2>/dev/null" || echo none)
      if [[ "$state" == "running" && ( "$health" == "healthy" || "$health" == "none" ) ]]; then
        ok=true; break
      fi
      sleep 3
    done
    if [[ "$ok" == "true" ]]; then
      echo "  ✓ $name ($state/$health)"
    else
      echo "  ✗ $name ($state/$health)"
      failed+=("$name")
    fi
  done

  if (( ${#failed[@]} > 0 )); then
    echo "" >&2
    echo "✗ DEPLOY FAILED — these containers never came up: ${failed[*]}" >&2
    for name in "${failed[@]}"; do
      echo "" >&2
      echo "──── last 30 log lines: $name ────" >&2
      ssh_run "docker logs --tail 30 $name 2>&1" >&2 || true
    done
    exit 1
  fi
  echo "✓ All containers healthy"
}

# ── DEPLOYED hash bookkeeping (§6.4) ─────────────────────────────────────────
record_deployed() {  # record_deployed <commit-hash>
  ssh_run "cd $REMOTE && if [ -f DEPLOYED ]; then cp DEPLOYED DEPLOYED.prev; fi && echo '$1' > DEPLOYED"
  echo "✓ Recorded deployed commit $1 in $REMOTE/DEPLOYED"
}

deploy_services_for_target() {
  case "$TARGET" in
    web) build_and_restart brewcult-web ;;
    # worker + scheduler always restart with api — same image; schema/event
    # skew between api and consumers is a subtle-bug factory (§6.3).
    api) build_and_restart brewcult-api brewcult-worker brewcult-scheduler ;;
    all)
      # ORDER MATTERS, and not for the obvious reason. brewcult-web declares
      # `depends_on: brewcult-api: service_healthy`, so starting web first drags
      # up whatever api image is currently on the box. If that image is broken,
      # `compose up` aborts on "dependency failed to start" and `set -e` kills
      # the deploy BEFORE the fixed api is ever built — a deploy that can never
      # repair the thing it is deploying. api goes first for that reason.
      #
      # Sequential, not parallel: this host has 3.8 GB of RAM and also serves a
      # live app. Two concurrent `next build`/`tsc` runs is how you OOM-kill a
      # neighbour's container.
      build_and_restart brewcult-api brewcult-worker brewcult-scheduler
      build_and_restart brewcult-web
      ;;
  esac
}

# ── Rollback (§6.4): re-sync the previously deployed commit ──────────────────
do_rollback() {
  echo "→ Reading previous deploy from $REMOTE/DEPLOYED.prev..."
  local prev
  prev=$(ssh_run "cat $REMOTE/DEPLOYED.prev")
  if [[ -z "$prev" ]]; then
    echo "✗ No previous deploy recorded ($REMOTE/DEPLOYED.prev empty/missing) — cannot roll back." >&2
    exit 1
  fi
  echo "→ Rolling back to commit $prev"

  local wt
  wt=$(mktemp -d)
  trap 'git -C "$LOCAL" worktree remove --force "$wt/checkout" 2>/dev/null; rm -rf "$wt"' EXIT
  git -C "$LOCAL" worktree add --detach "$wt/checkout" "$prev"

  LOCAL="$wt/checkout"   # all sync functions now read from the old commit
  sync_common
  sync_web
  sync_api
  run_migrations         # forward-only, idempotent — safe to re-run (§5.2)
  TARGET="all"
  deploy_services_for_target
  record_deployed "$prev"
  echo ""
  echo "🔙 Rolled back to $prev — $SITE_URL"
}

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════╗"
echo "║  BrewCult Deploy — target: $TARGET"
echo "╚════════════════════════════════════╝"
echo ""

if [[ "$ROLLBACK" == "true" ]]; then
  do_rollback
  exit 0
fi

# Caddy config deploys skip CI/migrations — nothing is built.
if [[ "$TARGET" == "caddy" ]]; then
  sync_caddy
  echo ""
  echo "🚀 Done!"
  exit 0
fi

ci_gate

if [[ "$NO_SYNC" == "false" ]]; then
  sync_common
  case "$TARGET" in
    web) sync_web ;;
    api) sync_api ;;
    all) sync_web; sync_api ;;
  esac
else
  echo "⚠ Skipping file sync (--no-sync)"
fi

echo ""
run_migrations
echo ""
deploy_services_for_target

echo ""
case "$TARGET" in
  web) verify_running brewcult-web ;;
  api) verify_running brewcult-api brewcult-worker brewcult-scheduler ;;
  all) verify_running brewcult-api brewcult-worker brewcult-scheduler brewcult-web ;;
esac

# Recorded only AFTER verification, so DEPLOYED always names a commit that was
# observed running — otherwise --rollback would happily roll back TO a broken one.
DEPLOY_HASH=$(git -C "$LOCAL" rev-parse HEAD)
record_deployed "$DEPLOY_HASH"

echo ""
echo "🚀 Done! $SITE_URL"
echo ""
