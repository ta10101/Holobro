#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi
cd "$ROOT"

export CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="${CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS:+${CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS} }--cfg getrandom_backend=\"custom\""

exec cargo build --release --target wasm32-unknown-unknown
