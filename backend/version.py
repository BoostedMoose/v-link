"""The frontend package version is the V-Link app version."""

import json
from pathlib import Path


_package_json = Path(__file__).resolve().parents[1] / "frontend" / "package.json"
try:
    with _package_json.open(encoding="utf-8") as package_file:
        VERSION = json.load(package_file)["version"]
except (OSError, ValueError, KeyError, TypeError) as error:
    raise RuntimeError(f"V-Link version metadata is missing or invalid: {_package_json}") from error

if not isinstance(VERSION, str) or not VERSION:
    raise RuntimeError(f"V-Link version metadata is missing or invalid: {_package_json}")
