#!/usr/bin/env bash
# Пересобирает веб-версию PhotoCraft и кладёт её в public/photocraft (macOS / Linux).
# Нужно один раз:  rustup target add wasm32-unknown-unknown && cargo install trunk --locked
set -euo pipefail
angular="$(cd "$(dirname "$0")/.." && pwd)"
repo="$angular/../photocraft"
(cd "$repo/apps/photocraft-web" && trunk build --release)
rm -rf "$angular/public/photocraft"
cp -r "$repo/dist/web" "$angular/public/photocraft"
echo "PhotoCraft скопирован в $angular/public/photocraft"
