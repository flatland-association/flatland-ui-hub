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
# (CI runners, containers). Set SETUP_TORCH_CPU=1 to install the CPU-only
# torch wheel first — on Linux the default wheel pulls CUDA (several GB); the
# dev container sets it. Set SETUP_NO_PLAYWRIGHT=1 to skip downloading the
# Chromium browser for the end-to-end tests (npm run e2e; install it later with
# npm run e2e:install). Needs Python 3.12+ and Node.js 22.22.3+.
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
if [ "${SETUP_TORCH_CPU:-}" = "1" ] && [ "$REQS" = "requirements-dev.txt" ]; then
  echo "→ backend: CPU-only torch"
  "$PY" -m pip install --quiet torch --index-url https://download.pytorch.org/whl/cpu
fi
(cd "$ROOT/backend" && "$PY" -m pip install --quiet -r "$REQS")

echo "→ frontend: npm ci"
(cd "$ROOT/frontend" && npm ci --no-fund --no-audit)

# Chromium for the Playwright end-to-end tests. Playwright skips browsers that
# are already installed, so this stays idempotent. On Linux (dev container,
# Copilot sandbox) --with-deps also installs the system libraries it needs.
if [ "${SETUP_NO_PLAYWRIGHT:-}" = "1" ]; then
  echo "→ frontend: skipping the Playwright browser (SETUP_NO_PLAYWRIGHT=1)"
else
  echo "→ frontend: Playwright Chromium"
  PW_DEPS=""
  [ "$(uname -s)" = "Linux" ] && PW_DEPS="--with-deps"
  (cd "$ROOT/frontend" && npx playwright install $PW_DEPS chromium)
fi

cat <<MSG

Done. Next:
  backend:   cd backend && $( [ "$PY" = "$ROOT/backend/.venv/bin/python" ] && echo "source .venv/bin/activate && " )uvicorn app.main:app --reload --port 8000
  frontend:  cd frontend && npm run start
  e2e tests: cd frontend && npm run e2e$( [ "${SETUP_NO_PLAYWRIGHT:-}" = "1" ] && echo "   (first: npm run e2e:install)" )
  checks:    see "Commands" in AGENTS.md
MSG
