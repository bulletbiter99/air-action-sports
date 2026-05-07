#!/usr/bin/env bash
# M3 batch 1 — local D1 teardown.
#
# Removes the local D1 SQLite file (and wrangler's state directory if it's
# only this DB inside). After teardown, run setup-local-d1.sh to recreate.
#
# Usage:
#   bash scripts/teardown-local-d1.sh
#
# Safe to re-run if no DB exists; this is a no-op idempotent cleanup.

set -euo pipefail

cd "$(dirname "$0")/.."

WRANGLER_STATE_D1=".wrangler/state/v3/d1"

if [[ -d "$WRANGLER_STATE_D1" ]]; then
    echo "Removing local D1 state at $WRANGLER_STATE_D1 …"
    rm -rf "$WRANGLER_STATE_D1"
    echo "✓ Local D1 removed."
else
    echo "No local D1 state at $WRANGLER_STATE_D1 — nothing to remove."
fi
