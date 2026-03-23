#!/usr/bin/env bash
set -euo pipefail
if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi
command -v cargo >/dev/null 2>&1 || { echo "cargo missing"; exit 1; }
rustup target list --installed | grep -q wasm32-unknown-unknown || {
  echo "Run: rustup target add wasm32-unknown-unknown"
  exit 1
}
echo "Rust + wasm32-unknown-unknown OK"
