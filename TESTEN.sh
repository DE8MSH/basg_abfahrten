#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo 'Node.js wird für die automatischen Tests benötigt.'; exit 1; }
node --test tests/*.test.mjs
