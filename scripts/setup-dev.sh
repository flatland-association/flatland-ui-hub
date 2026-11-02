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
# dev container sets it. Needs Python 3.10 – 3.12 (numpy < 2; checked by
# scripts/python-env.sh, which also picks one: $PYTHON if set, else python3.12,
# 3.11, 3.10, python3) and Node.js 22.22.3+.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REQS="requirements-dev.txt"
[ "${1:-}" = "--runtime" ] && REQS="requirements.txt"

# shellcheck source=scripts/python-env.sh
source "$ROOT/scripts/python-env.sh"
if [ -n "${VIRTUAL_ENV:-}" ]; then
  # the active virtualenv: checked, never replaced
  check_venv "$VIRTUAL_ENV" || exit 1
  PY="$VIRTUAL_ENV/bin/python"
elif [ "${SETUP_NO_VENV:-}" = "1" ]; then
  PY="$(pick_python)" || exit 1
elif [ -x "$ROOT/backend/.venv/bin/python" ]; then
  check_venv "$ROOT/backend/.venv" || exit 1
  PY="$ROOT/backend/.venv/bin/python"
else
  PY="$(pick_python)" || exit 1
  echo "→ creating backend/.venv ($("$PY" --version))"
  "$PY" -m venv "$ROOT/backend/.venv"
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

cat <<MSG

Done. Next:
  backend:   cd backend && $( [ "$PY" = "$ROOT/backend/.venv/bin/python" ] && echo "source .venv/bin/activate && " )uvicorn app.main:app --reload --port 8000
  frontend:  cd frontend && npm run start
  checks:    see "Commands" in AGENTS.md
MSG
