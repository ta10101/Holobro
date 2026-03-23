#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! command -v hc >/dev/null 2>&1; then
  echo "error: hc (Holochain CLI) not found on PATH." >&2
  exit 127
fi
cd "$ROOT/workdir"
exec hc app pack .
