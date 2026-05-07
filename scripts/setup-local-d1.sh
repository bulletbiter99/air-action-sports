#!/usr/bin/env bash
# M3 batch 1 — local D1 setup for staging fixtures.
#
# Applies all migrations to a local D1 file and seeds it with the synthetic
# fixtures from scripts/seed-staging.sql. Idempotent — re-running produces
# identical state (migrations re-apply as no-op; seed uses INSERT OR IGNORE).
#
# Usage:
#   bash scripts/setup-local-d1.sh
#
# After this runs, you can:
#   - Boot the worker: npx wrangler dev --local
#   - Inspect the DB:  npx wrangler d1 execute --local air-action-sports-db --command="SELECT COUNT(*) FROM bookings"
#   - Tear down:       bash scripts/teardown-local-d1.sh

set -euo pipefail

DB_NAME="air-action-sports-db"
SEED_FILE="scripts/seed-staging.sql"

cd "$(dirname "$0")/.."

if [[ ! -f wrangler.toml ]]; then
    echo "Error: wrangler.toml not found. Run from repo root or via 'bash scripts/setup-local-d1.sh'." >&2
    exit 1
fi

if [[ ! -f "$SEED_FILE" ]]; then
    echo "Error: $SEED_FILE not found." >&2
    exit 1
fi

echo "── M3 local-D1 setup ──"
echo

echo "Step 1/3: Applying migrations to local D1…"
npx wrangler d1 migrations apply "$DB_NAME" --local
echo

echo "Step 2/3: Seeding staging fixtures…"
npx wrangler d1 execute "$DB_NAME" --local --file "$SEED_FILE"
echo

echo "Step 3/3: Sanity check…"
echo
echo "Bookings by status:"
npx wrangler d1 execute "$DB_NAME" --local --command "SELECT status, COUNT(*) AS n FROM bookings GROUP BY status ORDER BY n DESC;"
echo
echo "Row counts (table → n):"
for tbl in events ticket_types bookings attendees users vendors audit_log; do
    n=$(npx wrangler d1 execute "$DB_NAME" --local --command "SELECT COUNT(*) AS n FROM ${tbl};" --json 2>/dev/null | grep -E '"n":' | head -1 | grep -oE '[0-9]+')
    printf "  %-15s %s\n" "$tbl" "${n:-?}"
done

echo
echo "✓ Local D1 ready. Next:"
echo "    npx wrangler dev --local"
