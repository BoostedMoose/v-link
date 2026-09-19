#!/bin/bash
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
    echo "Commit all source changes before packaging so the archive matches its commit manifest." >&2
    exit 1
fi

echo "Building V-Link frontend..."
npm --prefix frontend run build

echo "Preparing release assets..."
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/package/frontend" "$STAGE/assets"
cp -a frontend/dist "$STAGE/package/frontend/dist"
cp -a backend "$STAGE/package/backend"
cp -a updater "$STAGE/package/updater"
cp V-Link.py requirements.txt Update.sh "$STAGE/package/"
cp Install.sh Uninstall.sh Update.sh "$STAGE/assets/"
find "$STAGE/package" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$STAGE/package" -type f -name '*.pyc' -delete

COMMIT=$(git rev-parse HEAD)
BRANCH=$(git symbolic-ref -q --short HEAD || echo detached)
python3 - "$COMMIT" "$BRANCH" "$STAGE/package/.vlink-release.json" <<'PY'
import json
import sys

commit, branch, destination = sys.argv[1:]
with open(destination, "w", encoding="utf-8") as output:
    json.dump({"tag": None, "branch": branch, "commit": commit, "prerelease": None}, output, indent=2)
    output.write("\n")
PY

(cd "$STAGE/package" && zip -qr "$STAGE/assets/V-Link.zip" V-Link.py requirements.txt Update.sh updater frontend backend .vlink-release.json)
rm -rf dist
mv "$STAGE/assets" dist
echo "Created release assets from $COMMIT:"
printf '  %s\n' "$ROOT/dist/Install.sh" "$ROOT/dist/Uninstall.sh" "$ROOT/dist/Update.sh" "$ROOT/dist/V-Link.zip"
