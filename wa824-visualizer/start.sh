#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
export WA824_PORT="${WA824_PORT:-8001}"
python3 -c 'import pycparser' 2>/dev/null || { echo '[ERROR] pip install -r requirements.txt first' >&2; exit 1; }
echo "WA824 modular CPU bridge: http://localhost:$WA824_PORT"
if ! command -v iverilog >/dev/null 2>&1; then
  echo "[WARNING] Install Icarus Verilog (iverilog and vvp) for RTL CPU mode." >&2
fi
exec python3 backend/server.py
