#!/usr/bin/env bash
# Start the timetable constraint solver for local development.
#
# Creates the virtualenv on first run. The service reads SOLVER_SHARED_SECRET
# and refuses to start without it, so .env.local is sourced here — a solver
# that quietly accepted anything when its secret was missing would be worse
# than one that fails loudly.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

if [ ! -x .venv/bin/python ]; then
  echo "Creating virtualenv (ortools is a ~130MB download, so this takes a minute)…"
  python3 -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r requirements-dev.txt
fi

env_file="$here/../../.env.local"
if [ -f "$env_file" ]; then
  set -a; . "$env_file"; set +a
fi

if [ -z "${SOLVER_SHARED_SECRET:-}" ]; then
  echo "SOLVER_SHARED_SECRET is not set. Add it to .env.local alongside" >&2
  echo "SOLVER_INTERNAL_URL=http://127.0.0.1:${PORT:-8099}" >&2
  exit 1
fi

echo "Solver on http://127.0.0.1:${PORT:-8099}  (ortools takes ~10s to import)"
exec .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port "${PORT:-8099}"
