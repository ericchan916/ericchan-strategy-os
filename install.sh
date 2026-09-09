#!/usr/bin/env sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_root"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required. Install Node.js LTS from https://nodejs.org/ and run this script again." >&2
  exit 1
fi

node_major=$(node --version | sed 's/^v//' | cut -d. -f1)
if [ "$node_major" -lt 18 ]; then
  echo "Node.js 18 or newer is required. Found $(node --version)." >&2
  exit 1
fi

npm ci

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Add optional LLM or search keys only when you need them."
else
  echo "Preserved existing .env."
fi

npm test

echo ""
echo "Installation complete. Start the local workspace with: npm run ask:ui"
echo "Then open: http://127.0.0.1:5177"
