#!/usr/bin/env bash
# Install backend + frontend dependencies for development — for people and for
# AI coding agents in cloud sandboxes (Codex cloud environments, the Copilot
# coding agent via .github/workflows/copilot-setup-steps.yml, Goose, …).
# Idempotent; starts no servers (use start-demo.sh or the commands in AGENTS.md).
#
#   scripts/setup-dev.sh             backend dev deps (incl. torch, pytest) + frontend
#   scripts/setup-dev.sh --runtime   backend runtime deps only (no torch/pytest) + frontend
#
# Python: uses the active virtualenv if there is one, otherwise creates
# backend/.venv. Set SETUP_NO_VENV=1 to install into the current interpreter
# (CI runners, containers). Needs Python 3.12+ and Node.js 22.22.3+.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REQS="requirements-dev.txt"
[ "${1:-}" = "--runtime" ] && REQS="requirements.txt"

PY="${PYTHON:-python3}"
if [ -z "${VIRTUAL_ENV:-}" ] && [ "${SETUP_NO_VENV:-}" != "1" ]; then
  if [ ! -x "$ROOT/backend/.venv/bin/python" ]; then
    echo "→ creating backend/.venv"
    "$PY" -m venv "$ROOT/backend/.venv"
  fi
  PY="$ROOT/backend/.venv/bin/python"
fi

echo "→ backend: pip install -r $REQS"
"$PY" -m pip install --quiet --upgrade pip
(cd "$ROOT/backend" && "$PY" -m pip install --quiet -r "$REQS")

echo "→ frontend: npm ci"
(cd "$ROOT/frontend" && npm ci --no-fund --no-audit)

cat <<MSG

Done. Next:
  backend:   cd backend && $( [ "$PY" = "$ROOT/backend/.venv/bin/python" ] && echo "source .venv/bin/activate && " )uvicorn app.main:app --reload --port 8000
  frontend:  cd frontend && npm run start
  checks:    see "Commands" in AGENTS.md
MSG
