#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# BrewCult migration runner (deployment_guide.md §5.2 — FAIL LOUD)
#
# Applies db/migrations/*.sql in filename order (NNN_name.sql, forward-only)
# via psql. Each applied file is recorded in schema_migrations with its
# sha256 checksum; already-applied files are skipped; a checksum mismatch on
# an already-applied file is an ERROR (someone edited history — forbidden).
#
# EXITS NON-ZERO ON ANY ERROR. There is deliberately no `|| true` here:
# a failed migration must block the api from starting
# (compose: api depends_on migrate: condition: service_completed_successfully).
#
# Usage:
#   In compose (prod & dev): mounted at /db, entrypoint /db/migrate.sh,
#     DATABASE_URL + MIGRATIONS_DIR=/db/migrations from the environment.
#   Standalone in dev (host psql, compose postgres on host port 5433):
#     DATABASE_URL=postgres://brewcult:brewcult@localhost:5433/brewcult ./db/migrate.sh
#
# Env:
#   DATABASE_URL    (required) postgres connection URL
#   MIGRATIONS_DIR  (optional) default: <this script's dir>/migrations
#
# Note: each migration is applied inside a single transaction together with
# its schema_migrations bookkeeping row. Statements that cannot run in a
# transaction (e.g. CREATE INDEX CONCURRENTLY) need a dedicated approach —
# flag those in migration review.
# ─────────────────────────────────────────────────────────────────────────────
set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$SCRIPT_DIR/migrations}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Refusing to guess a database." >&2
  exit 1
fi

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: migrations directory not found: $MIGRATIONS_DIR" >&2
  exit 1
fi

run_psql() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 "$@"
}

# ── Wait briefly for the database (compose healthcheck usually covers this) ──
tries=0
until run_psql -q -c "SELECT 1" >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then
    echo "ERROR: database unreachable after 30s: $DATABASE_URL" >&2
    exit 1
  fi
  echo "Waiting for database... ($tries)"
  sleep 1
done

# ── Bookkeeping table (created if absent) ──
run_psql -q -c "
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   text        PRIMARY KEY,
    checksum   text        NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
"

applied=0
skipped=0
found=0

for f in "$MIGRATIONS_DIR"/*.sql; do
  # In POSIX sh an unmatched glob stays literal — guard against empty dir.
  [ -e "$f" ] || continue
  found=1
  name=$(basename "$f")
  sum=$(sha256sum "$f" | awk '{print $1}')

  recorded=$(run_psql -tA -c \
    "SELECT checksum FROM schema_migrations WHERE filename = '$name';")

  if [ -n "$recorded" ]; then
    if [ "$recorded" != "$sum" ]; then
      echo "ERROR: checksum mismatch for already-applied migration '$name'." >&2
      echo "  recorded: $recorded" >&2
      echo "  on disk:  $sum" >&2
      echo "Migrations are forward-only and immutable once applied — write a new one." >&2
      exit 1
    fi
    echo "skip    $name (already applied)"
    skipped=$((skipped + 1))
    continue
  fi

  echo "apply   $name"
  # File + bookkeeping row commit atomically; any error aborts the whole run.
  run_psql --single-transaction \
    -f "$f" \
    -c "INSERT INTO schema_migrations (filename, checksum) VALUES ('$name', '$sum');"
  applied=$((applied + 1))
done

if [ "$found" -eq 0 ]; then
  echo "No migration files in $MIGRATIONS_DIR — nothing to do."
  exit 0
fi

echo "Migrations complete: $applied applied, $skipped skipped."
