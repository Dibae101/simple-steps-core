#!/usr/bin/env bash
# Launches the simple-steps-core Streamlit dashboard — the step-wise
# collapsible-card UI (st.expander per step, with run/reset buttons).
#
# Usage:
#   ./scripts/run_dashboard.sh
#
# What it does:
#   1. Activates ./.venv (creates it if missing).
#   2. Installs the "dashboard" extra (streamlit) if not already present.
#   3. Runs streamlit_example/example_tools_and_resources.py, whose
#      Dashboard().run() call opens the UI in your browser.
#
# To run your own tools file instead of the bundled example, pass its path:
#   ./scripts/run_dashboard.sh path/to/your_tools.py

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment in .venv ..."
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

if ! python -c "import streamlit" >/dev/null 2>&1; then
  echo "Installing simple-steps-core with the 'dashboard' extra ..."
  python -m pip install -e ".[dashboard]"
fi

TOOLS_FILE="${1:-streamlit_example/example_tools_and_resources.py}"

echo "Starting the dashboard from ${TOOLS_FILE} ..."
python "${TOOLS_FILE}"
