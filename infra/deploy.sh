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

# ── Server configuration — FILL THESE IN before first use ────────────────────
SSH_KEY="${SSH_KEY:-$HOME/.ssh/brewcult}"      # SSH private key for the VPS
SSH_HOST="${SSH_HOST:-brewcult@203.0.113.10}"  # user@host — replace with the real VPS IP/hostname
REMOTE="${REMOTE:-/srv/brewcult}"              # deploy root on the server (§5.1; .env.prod lives here)
BRANCH="${BRANCH:-main}"                       # branch whose CI status gates deploys
SITE_URL="https://brewcult.coffee"

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
  echo "→ Syncing shared workspace files (root manifests, packages/, db/, infra/)..."
  rsync_file package.json package.json
  if [[ -f "$LOCAL/package-lock.json" ]]; then
    rsync_file package-lock.json package-lock.json
  fi
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
  echo "→ Restarting Caddy..."
  # 'caddy reload' can silently no-op (Zentra lesson); restart takes ~3s and
  # certificates persist in the brewcult_caddy_data volume.
  ssh_run "docker restart brewcult-caddy"
  echo "✓ Caddy restarted"
}

# ── Migrations as an aborting step (§6.2, §5.2) ──────────────────────────────
run_migrations() {
  echo "→ Running database migrations (fail-loud one-shot)..."
  if ! ssh_run "cd $REMOTE/infra && $COMPOSE run --rm migrate"; then
    echo "" >&2
    echo "✗ MIGRATION FAILED — deploy aborted. No services were rebuilt or restarted." >&2
    echo "  Inspect: ssh $SSH_HOST 'cd $REMOTE/infra && $COMPOSE run --rm migrate'" >&2
    exit 1
  fi
  echo "✓ Migrations applied"
}

# ── Build & restart ──────────────────────────────────────────────────────────
build_and_restart() {  # takes one or more service names
  local services="$*"
  echo "→ Building: $services..."
  ssh_run "cd $REMOTE/infra && $COMPOSE build $services"
  echo "→ Restarting: $services..."
  ssh_run "cd $REMOTE/infra && $COMPOSE up -d $services"
  echo "✓ Deployed: $services"
}

# ── DEPLOYED hash bookkeeping (§6.4) ─────────────────────────────────────────
record_deployed() {  # record_deployed <commit-hash>
  ssh_run "cd $REMOTE && if [ -f DEPLOYED ]; then cp DEPLOYED DEPLOYED.prev; fi && echo '$1' > DEPLOYED"
  echo "✓ Recorded deployed commit $1 in $REMOTE/DEPLOYED"
}

deploy_services_for_target() {
  case "$TARGET" in
    web) build_and_restart web ;;
    # worker + scheduler always restart with api — same image; schema/event
    # skew between api and consumers is a subtle-bug factory (§6.3).
    api) build_and_restart api worker scheduler ;;
    all)
      build_and_restart web
      build_and_restart api worker scheduler
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

DEPLOY_HASH=$(git -C "$LOCAL" rev-parse HEAD)
record_deployed "$DEPLOY_HASH"

echo ""
echo "🚀 Done! $SITE_URL"
echo ""
