#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo 'Lokaler HTTP-Server unter http://127.0.0.1:8000/'
python3 -m http.server 8000 --bind 127.0.0.1
