#!/usr/bin/env bash
# Launches the simple-steps-core test app — a FastAPI backend plus a static
# HTML/JS frontend (tool palette + workflow builder) served from one process.
#
# Usage:
#   ./scripts/run_test_app.sh
#
# What it does:
#   1. Activates ./.venv (creates it if missing).
#   2. Installs the "api" extra (fastapi/uvicorn) if not already present.
#   3. Runs uvicorn on examples.test_app.app:app and opens on port 8000.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment in .venv ..."
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

if ! python -c "import fastapi" >/dev/null 2>&1; then
  echo "Installing simple-steps-core with the 'api' extra ..."
  python -m pip install -e ".[api]"
fi

echo "Starting the test app — open http://127.0.0.1:8000/ once it's up."
uvicorn examples.test_app.app:app --reload --port 8000
