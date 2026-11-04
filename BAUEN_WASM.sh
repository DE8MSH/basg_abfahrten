#!/usr/bin/env bash
# WebAssembly-Zeitkern für GitHub Pages, vorzugsweise mit Emscripten.
set -euo pipefail
cd "$(dirname "$0")"
SRC="wasm/departures.c"
OUT="assets/departures.wasm"
EXPORTS=(-Wl,--no-entry -Wl,--export=minutes_until -Wl,--export=color_code -Wl,--export=delay_blink_on)
if command -v emcc >/dev/null 2>&1; then
  echo 'Compiler: Emscripten emcc (bevorzugt)'
  emcc "$SRC" -O3 -nostdlib -sSTANDALONE_WASM=1 "${EXPORTS[@]}" -o "$OUT"
elif command -v clang >/dev/null 2>&1; then
  echo 'Compiler: clang/LLVM mit wasm32-Ziel (kein emcc installiert)'
  clang --target=wasm32 "$SRC" -O3 -nostdlib "${EXPORTS[@]}" -Wl,--strip-all -o "$OUT"
else
  echo 'FEHLER: emcc oder clang mit WebAssembly-Ziel installieren.' >&2
  exit 1
fi
printf '[ OK ] %s (%s Bytes)\n' "$OUT" "$(stat -c%s "$OUT")"
if command -v node >/dev/null 2>&1; then
  node --input-type=module -e 'import{readFileSync}from"node:fs";let x=await WebAssembly.instantiate(readFileSync("assets/departures.wasm"));if(x.instance.exports.minutes_until(1600,1300,0)!==5)process.exit(1);console.log("[ OK ] WASM-Funktionstest")'
fi
