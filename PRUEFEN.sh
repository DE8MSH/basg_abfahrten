#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo '=== BSAG Web-App: Linux-Mint-22 / GitHub-Pages-Voraussetzungen ==='
for program in python3 node emcc clang git sha256sum; do
  if command -v "$program" >/dev/null 2>&1; then
    printf '[ OK ] %-12s %s\n' "$program" "$(command -v "$program")"
  else
    printf '[ -- ] %-12s nicht installiert (für reines Hosting nicht nötig)\n' "$program"
  fi
done
for file in index.html assets/app.mjs assets/core.mjs assets/style.css assets/departures.wasm; do
  test -s "$file" || { echo "[ FEHLER ] $file fehlt"; exit 1; }
  echo "[ OK ] $file"
done
printf 'WASM: '; file assets/departures.wasm
printf 'SHA256: '; sha256sum assets/departures.wasm
printf '\nErgebnis: GitHub Pages kann den gesamten Ordner ohne Build übernehmen.\n'
