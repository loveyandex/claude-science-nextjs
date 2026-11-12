#!/usr/bin/env bash
# Start the Next.js frontend and FastAPI backend together.
#
#   ./dev.sh
#   FRONTEND_PORT=7007 ./dev.sh
#
# Ctrl+C stops both. Qdrant is not started here (see backend/README.md).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

FRONTEND_PORT="${FRONTEND_PORT:-${PORT:-3000}}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"

resolve_python() {
  local venv="$ROOT/backend/venv"
  if [[ -x "$venv/bin/python" ]]; then
    printf '%s\n' "$venv/bin/python"
  elif [[ -x "$venv/Scripts/python.exe" ]]; then
    printf '%s\n' "$venv/Scripts/python.exe"
  elif [[ -x "$venv/Scripts/python" ]]; then
    printf '%s\n' "$venv/Scripts/python"
  elif command -v python3 >/dev/null 2>&1; then
    command -v python3
  elif command -v python >/dev/null 2>&1; then
    command -v python
  else
    return 1
  fi
}

if ! PYTHON="$(resolve_python)"; then
  echo "error: python not found. Create the backend venv first:" >&2
  echo "  cd backend && python -m venv venv && ./venv/bin/pip install -r requirements.txt" >&2
  echo "  (Windows Git Bash: backend/venv/Scripts/pip install -r requirements.txt)" >&2
  exit 1
fi

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "error: node_modules missing. Run npm install from the repo root first." >&2
  exit 1
fi

NEXT_BIN="$ROOT/node_modules/.bin/next"
if [[ ! -e "$NEXT_BIN" ]]; then
  echo "error: Next.js binary not found at node_modules/.bin/next" >&2
  exit 1
fi

PIDS=()

cleanup() {
  trap - INT TERM EXIT
  echo
  echo "Stopping frontend and backend..."
  if ((${#PIDS[@]})); then
    kill "${PIDS[@]}" 2>/dev/null || true
    wait "${PIDS[@]}" 2>/dev/null || true
  fi
}

trap cleanup INT TERM EXIT

echo "backend  → http://localhost:${BACKEND_PORT}  ($PYTHON)"
(
  cd "$ROOT/backend"
  exec "$PYTHON" -m uvicorn main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" --reload
) &
PIDS+=("$!")

echo "frontend → http://localhost:${FRONTEND_PORT}"
(
  cd "$ROOT"
  exec "$NEXT_BIN" dev --port "$FRONTEND_PORT"
) &
PIDS+=("$!")

echo
echo "Both running. Ctrl+C to stop."
echo

wait
