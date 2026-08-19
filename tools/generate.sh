#!/usr/bin/env bash
# Wrapper so `./tools/generate.sh ...` works without remembering the venv path
# (playwright lives in tools/.venv, not the system Python).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$DIR/.venv/bin/python" "$DIR/generate.py" "$@"
