#!/bin/bash
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

TAG=${1:-}
if [ -z "$TAG" ]; then
    echo "Usage: $0 <release tag>, for example: $0 v3.2.1" >&2
    exit 1
fi

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
    echo "Commit all source changes before packaging so the archive matches its commit manifest." >&2
    exit 1
fi

python3 - "$TAG" <<'PY'
import json
import sys
from pathlib import Path

package = json.loads(Path("frontend/package.json").read_text(encoding="utf-8"))
lock = json.loads(Path("frontend/package-lock.json").read_text(encoding="utf-8"))
version = package["version"]
if lock["version"] != version or lock["packages"][""]["version"] != version:
    raise SystemExit("Frontend package and lockfile versions differ. Run npm version in frontend/ first.")
tag = sys.argv[1].rsplit("/", 1)[-1]
if tag.removeprefix("v") != version:
    raise SystemExit(f"Tag {sys.argv[1]} does not match the app version {version}.")
PY

echo "Building V-Link frontend..."
npm --prefix frontend run build

echo "Preparing release assets..."
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/package/frontend" "$STAGE/assets"
cp -a frontend/dist "$STAGE/package/frontend/dist"
cp frontend/package.json "$STAGE/package/frontend/package.json"
cp -a backend "$STAGE/package/backend"
cp -a updater "$STAGE/package/updater"
mkdir -p "$STAGE/package/updater/templates/overlays"
cp resources/dtoverlays/*.dtbo "$STAGE/package/updater/templates/overlays/"
cp V-Link.py Hardware-Test.py requirements.txt Update.sh "$STAGE/package/"
# The v3.1.0 updater runs Patch.sh after unpacking; it only exists for that migration.
PATCH=
if [ -f Patch.sh ]; then
    cp Patch.sh "$STAGE/package/"
    PATCH=Patch.sh
fi
cp Install.sh Uninstall.sh Update.sh "$STAGE/assets/"
find "$STAGE/package" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$STAGE/package" -type f -name '*.pyc' -delete

COMMIT=$(git rev-parse HEAD)
BRANCH=$(git symbolic-ref -q --short HEAD || echo detached)
python3 - "$COMMIT" "$BRANCH" "$TAG" "$STAGE/package/.vlink-release.json" <<'PY'
import json
import sys

commit, branch, tag, destination = sys.argv[1:]
with open(destination, "w", encoding="utf-8") as output:
    json.dump({"tag": tag, "branch": branch, "commit": commit, "prerelease": None}, output, indent=2)
    output.write("\n")
PY

(cd "$STAGE/package" && zip -qr "$STAGE/assets/V-Link.zip" V-Link.py Hardware-Test.py requirements.txt Update.sh updater frontend backend .vlink-release.json $PATCH)
rm -rf dist
mv "$STAGE/assets" dist
echo "Created release assets from $COMMIT:"
printf '  %s\n' "$ROOT/dist/Install.sh" "$ROOT/dist/Uninstall.sh" "$ROOT/dist/Update.sh" "$ROOT/dist/V-Link.zip"
