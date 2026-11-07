#!/usr/bin/env bash
# One-command dev start (macOS/Linux): venv, deps, .env, then backend (:8000) + frontend (:5173).
# Usage: ./scripts/dev.sh      (Ctrl+C stops both)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

if [ ! -x "$BACKEND/.venv/bin/python" ]; then
  echo "==> Creating Python venv"
  PY=$(command -v python3.12 || command -v python3 || command -v python || true)
  [ -n "$PY" ] || { echo "Python 3.12+ not found"; exit 1; }
  "$PY" -m venv "$BACKEND/.venv"
fi
STAMP="$BACKEND/.venv/.deps-installed"
if [ ! -f "$STAMP" ] || [ "$BACKEND/requirements.txt" -nt "$STAMP" ]; then
  echo "==> Installing backend dependencies"
  "$BACKEND/.venv/bin/python" -m pip install -q -r "$BACKEND/requirements.txt"
  touch "$STAMP"
fi
if [ ! -f "$BACKEND/.env" ]; then
  cp "$BACKEND/.env.example" "$BACKEND/.env"
  echo "==> Created backend/.env (mock provider, no API key needed)"
fi

command -v npm >/dev/null || { echo "Node.js 20+ not found"; exit 1; }
if [ ! -d "$FRONTEND/node_modules" ]; then
  echo "==> Installing frontend dependencies"
  (cd "$FRONTEND" && npm install)
fi

echo "==> Backend http://localhost:8000   Frontend http://localhost:5173"
(cd "$BACKEND" && exec .venv/bin/python -m uvicorn app.main:app --port 8000) &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT INT TERM
cd "$FRONTEND" && npm run dev
