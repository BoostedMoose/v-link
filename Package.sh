#!/bin/bash
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
    echo "Commit all source changes before packaging so the archive matches its commit manifest." >&2
    exit 1
fi

python3 - <<'PY'
import json
from pathlib import Path

package = json.loads(Path("frontend/package.json").read_text(encoding="utf-8"))
lock = json.loads(Path("frontend/package-lock.json").read_text(encoding="utf-8"))
version = package["version"]
if lock["version"] != version or lock["packages"][""]["version"] != version:
    raise SystemExit("Frontend package and lockfile versions differ. Run npm version in frontend/ first.")
PY

echo "Building V-Link frontend..."
npm --prefix frontend run build

echo "Preparing release assets..."
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

mkdir -p \
    "$STAGE/package/frontend" \
    "$STAGE/package/frontend/public/assets/svg/logos" \
    "$STAGE/package/resources" \
    "$STAGE/assets"

cp -a frontend/dist "$STAGE/package/frontend/dist"
cp frontend/package.json "$STAGE/package/frontend/package.json"

# Lite needs the original marks to generate the boot splash.
cp frontend/public/assets/svg/logos/moose.svg \
   frontend/public/assets/svg/logos/vlink.svg \
   "$STAGE/package/frontend/public/assets/svg/logos/"

cp -a backend "$STAGE/package/backend"
cp -a updater "$STAGE/package/updater"

# Lite installer/runtime files and hardware overlays are also part of the
# release archive so Raspberry Pi OS Lite can install from a stable release.
cp -a lite "$STAGE/package/lite"
cp -a resources/. "$STAGE/package/resources/"

cp V-Link.py requirements.txt Update.sh "$STAGE/package/"
cp lite/Check-Lite.sh "$STAGE/package/Check-Lite.sh"
if [ -f Patch.sh ]; then
    cp Patch.sh "$STAGE/package/Patch.sh"
fi

cp Install.sh Uninstall.sh Update.sh "$STAGE/assets/"
cp lite/Install-Lite.sh "$STAGE/assets/Install-Lite.sh"

find "$STAGE/package" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$STAGE/package" -type f -name '*.pyc' -delete

COMMIT=$(git rev-parse HEAD)
BRANCH=$(git symbolic-ref -q --short HEAD || echo detached)
python3 - "$COMMIT" "$BRANCH" "$STAGE/package/.vlink-release.json" <<'PY'
import json
import sys

commit, branch, destination = sys.argv[1:]
with open(destination, "w", encoding="utf-8") as output:
    json.dump({"tag": None, "branch": branch, "commit": commit,
               "prerelease": None, "payload_schema": 2}, output, indent=2)
    output.write("\n")
PY

(
    cd "$STAGE/package"
    PACKAGE_ITEMS=(
        V-Link.py requirements.txt Update.sh Check-Lite.sh
        updater frontend backend resources lite .vlink-release.json
    )
    if [ -f Patch.sh ]; then
        PACKAGE_ITEMS+=(Patch.sh)
    fi
    zip -qr "$STAGE/assets/V-Link.zip" "${PACKAGE_ITEMS[@]}"
)

# Lite verifies the release archive before installing it.
if command -v sha256sum >/dev/null 2>&1; then
    (
        cd "$STAGE/assets"
        sha256sum V-Link.zip > V-Link.zip.sha256
    )
else
    (
        cd "$STAGE/assets"
        shasum -a 256 V-Link.zip > V-Link.zip.sha256
    )
fi

rm -rf dist
mv "$STAGE/assets" dist

echo "Created release assets from $COMMIT:"
printf '  %s\n' \
    "$ROOT/dist/Install.sh" \
    "$ROOT/dist/Install-Lite.sh" \
    "$ROOT/dist/Uninstall.sh" \
    "$ROOT/dist/Update.sh" \
    "$ROOT/dist/V-Link.zip" \
    "$ROOT/dist/V-Link.zip.sha256"
