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

echo "Preparing release archive..."
rm -rf dist
mkdir -p dist/frontend
cp -a frontend/dist dist/frontend/dist
cp -a backend dist/backend
cp -a updater dist/updater
cp V-Link.py requirements.txt Update.sh dist/
find dist -type d -name __pycache__ -prune -exec rm -rf {} +
find dist -type f -name '*.pyc' -delete

COMMIT=$(git rev-parse HEAD)
BRANCH=$(git symbolic-ref -q --short HEAD || echo detached)
python3 - "$COMMIT" "$BRANCH" "$ROOT/dist/.vlink-release.json" <<'PY'
import json
import sys

commit, branch, destination = sys.argv[1:]
with open(destination, "w", encoding="utf-8") as output:
    json.dump({"tag": None, "branch": branch, "commit": commit, "prerelease": None}, output, indent=2)
    output.write("\n")
PY

(cd dist && zip -qr V-Link.zip V-Link.py requirements.txt Update.sh updater frontend backend .vlink-release.json)
echo "Created $ROOT/dist/V-Link.zip from $COMMIT"
