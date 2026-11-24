#!/bin/sh
set -eu
[ "$(uname -s)" = Linux ] || { echo "Run on Linux." >&2; exit 1; }
RAEE_WORKSPACE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if dpkg-query -W sidecut >/dev/null 2>&1; then echo "Existing raE.E installation will not be replaced." >&2; exit 1; fi
set -- "$RAEE_WORKSPACE"/apps/desktop/release/raE.E-*-linux-*.deb
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo "Build exactly one Debian package first." >&2; exit 1; }
trap 'sudo dpkg --remove sidecut' EXIT HUP INT TERM
sudo apt-get install -y --no-install-recommends "$1"
RAEE_INSTALLED=$(readlink -f "$(command -v raee)")
cd "$RAEE_WORKSPACE"
vp exec node scripts/verify-packaged.mjs --executable "$RAEE_INSTALLED"
