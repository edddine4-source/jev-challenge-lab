#!/usr/bin/env sh
# Start Jev Challenge Lab directly with Python; Docker is optional.
set -eu

if [ ! -x ".venv/bin/python" ]; then
  python3 -m venv .venv
fi

.venv/bin/python -m pip install --quiet --require-hashes --only-binary=:all: -r requirements.lock

if [ ! -f ".env" ]; then
  cp .env.example .env
  printf '%s\n' "Created .env. Add TYPESAFE_API_KEY there, or add it from the app."
fi

exec .venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
