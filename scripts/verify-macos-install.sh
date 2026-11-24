#!/bin/sh
set -eu
[ "$(uname -s)" = Darwin ] || { echo "Run on macOS." >&2; exit 1; }
RAEE_WORKSPACE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
set -- "$RAEE_WORKSPACE"/apps/desktop/release/raE.E-*-mac-*.dmg
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo "Build exactly one macOS DMG first." >&2; exit 1; }
RAEE_INSTALL_TEMP=$(mktemp -d "${TMPDIR:-/tmp}/sidecut-install-XXXXXX")
RAEE_MOUNT="$RAEE_INSTALL_TEMP/mounted"
RAEE_MOUNTED=0
cleanup() {
  if [ "$RAEE_MOUNTED" -eq 1 ]; then
    hdiutil detach "$RAEE_MOUNT" -quiet || { echo "Could not detach test DMG; retaining its temporary directory." >&2; return; }
  fi
  case "$RAEE_INSTALL_TEMP" in "${TMPDIR:-/tmp}"/sidecut-install-*) rm -rf -- "$RAEE_INSTALL_TEMP";; *) echo "Unsafe cleanup target." >&2;; esac
}
trap cleanup EXIT HUP INT TERM
mkdir "$RAEE_MOUNT"
hdiutil attach -readonly -nobrowse -mountpoint "$RAEE_MOUNT" "$1"
RAEE_MOUNTED=1
ditto "$RAEE_MOUNT/raE.E.app" "$RAEE_INSTALL_TEMP/raE.E 侧剪.app"
codesign --verify --deep --strict "$RAEE_INSTALL_TEMP/raE.E 侧剪.app"
cd "$RAEE_WORKSPACE"
vp exec node scripts/verify-packaged.mjs --executable "$RAEE_INSTALL_TEMP/raE.E 侧剪.app/Contents/MacOS/raE.E"
