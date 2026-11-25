#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 22+ is required.' >&2
  exit 1
fi
node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)" || { echo 'Node.js 22+ is required.' >&2; exit 1; }

if [ -f package-lock.json ]; then
  npm ci
else
  echo 'package-lock.json is required for reproducible installation.' >&2
  exit 1
fi
