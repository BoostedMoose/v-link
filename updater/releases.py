"""GitHub release catalogue and staged V-Link installer (Python standard library only)."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
import zipfile


REPOSITORY = "BoostedMoose/v-link"
API = f"https://api.github.com/repos/{REPOSITORY}"
ASSET_NAME = "V-Link.zip"
MANIFEST = ".vlink-release.json"
PAYLOAD_SCHEMA = 2
MANAGED = ("V-Link.py", "backend", "frontend", "updater", "lite",
           "resources/dtoverlays", "requirements.txt", "Update.sh", "Patch.sh",
           "Check-Lite.sh", MANIFEST)
CORE_REQUIRED = ("frontend/dist/index.html", "backend/version.py", "V-Link.py",
                 "requirements.txt")
UPDATER_REQUIRED = ("updater/__init__.py", "updater/releases.py", "updater/keepalive.py",
                    "Update.sh")
LITE_REQUIRED = ("lite/Install-Lite.sh", "lite/Check-Lite.sh", "resources/dtoverlays",
                 "Check-Lite.sh")
MODERN_REQUIRED = (*CORE_REQUIRED, *UPDATER_REQUIRED, *LITE_REQUIRED, MANIFEST)
LEGACY_MANAGED = ("V-Link.py", "backend", "frontend", "requirements.txt", "Patch.sh", MANIFEST)
MAX_PAGES = 5
MAX_DOWNLOAD = 500 * 1024 * 1024
MAX_UNPACKED = 1024 * 1024 * 1024
SHA = re.compile(r"^[0-9a-f]{40}$")


class UpdateError(Exception):
    pass


def _request(url):
    return Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "V-Link-updater"})


def _json(url):
    try:
        with urlopen(_request(url), timeout=20) as response:
            return json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError) as error:
        raise UpdateError(f"GitHub request failed: {error}") from error


def _asset(release):
    return next((asset for asset in release.get("assets", [])
                 if asset.get("name") == ASSET_NAME and asset.get("state") == "uploaded"), None)


def _branch(release):
    # Existing tags do not reliably retain the branch selected in GitHub's UI.
    # A release note marker or branch-prefixed tag takes precedence.
    notes = release.get("body") or ""
    marker = re.search(r"(?m)^V-Link-Branch:\s*([A-Za-z0-9._/-]+)\s*$", notes)
    if marker:
        return marker.group(1)
    tag = release.get("tag_name", "")
    prefixed = re.match(r"^(.+)/v\d", tag)
    if prefixed:
        return prefixed.group(1)
    target = release.get("target_commitish", "")
    return target if target and not SHA.fullmatch(target) else "unknown"


def _summary(release):
    asset = _asset(release)
    return {
        "id": release["id"],
        "tag": release["tag_name"],
        "name": release.get("name") or release["tag_name"],
        "prerelease": bool(release["prerelease"]),
        "branch": _branch(release) if release["prerelease"] else "stable",
        "published_at": release.get("published_at"),
        "size": asset.get("size") if asset else None,
    }


def list_releases():
    """Return published releases with an installable asset, newest first."""
    releases = []
    truncated = False
    for page in range(1, MAX_PAGES + 1):
        batch = _json(f"{API}/releases?per_page=100&page={page}")
        if not isinstance(batch, list):
            raise UpdateError("Unexpected GitHub release response")
        releases.extend(_summary(item) for item in batch if not item.get("draft") and _asset(item))
        if len(batch) < 100:
            break
        if page == MAX_PAGES:
            truncated = True
    releases.sort(key=lambda item: item["published_at"] or "", reverse=True)
    return {"releases": releases, "truncated": truncated}


def get_release(release_id):
    if not isinstance(release_id, int) or isinstance(release_id, bool) or release_id <= 0:
        raise UpdateError("Invalid release ID")
    release = _json(f"{API}/releases/{release_id}")
    if not isinstance(release, dict) or release.get("draft") or not _asset(release):
        raise UpdateError("Release has no published V-Link.zip asset")
    return release


def commit_sha(tag):
    # A tag may be annotated. The commits endpoint resolves both tag types.
    data = _json(f"{API}/commits/{quote('tags/' + tag, safe='')}")
    sha = data.get("sha") if isinstance(data, dict) else None
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise UpdateError("Could not resolve the release tag to a commit")
    return sha


def installed_release(app_dir):
    path = Path(app_dir) / MANIFEST
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return {key: data.get(key) for key in ("tag", "branch", "commit", "prerelease")}
        except (OSError, ValueError):
            pass
    # A source checkout can still show its exact revision.
    if (Path(app_dir) / ".git").exists():
        try:
            result = subprocess.run(["git", "-C", str(app_dir), "rev-parse", "HEAD"],
                                    check=True, capture_output=True, text=True)
            return {"tag": None, "branch": None, "commit": result.stdout.strip(), "prerelease": None}
        except (OSError, subprocess.CalledProcessError):
            pass
    return {"tag": None, "branch": None, "commit": None, "prerelease": None}


def _download(url, destination, digest=None):
    expected = digest.removeprefix("sha256:") if isinstance(digest, str) and digest.startswith("sha256:") else None
    checksum = hashlib.sha256()
    size = 0
    try:
        with urlopen(_request(url), timeout=60) as response, open(destination, "wb") as output:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_DOWNLOAD:
                    raise UpdateError("Release archive is too large")
                checksum.update(chunk)
                output.write(chunk)
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        raise UpdateError(f"Download failed: {error}") from error
    if expected and checksum.hexdigest() != expected:
        raise UpdateError("Release archive checksum does not match GitHub's asset digest")


def _extract(archive, stage):
    try:
        with zipfile.ZipFile(archive) as bundle:
            members = bundle.infolist()
            if sum(member.file_size for member in members) > MAX_UNPACKED:
                raise UpdateError("Release archive is too large when extracted")
            for member in members:
                path = Path(member.filename)
                if (path.is_absolute() or ".." in path.parts or not path.parts
                        or (member.external_attr >> 16) & 0o170000 == 0o120000):
                    raise UpdateError("Release archive contains an unsafe path")
            bundle.extractall(stage)
    except (zipfile.BadZipFile, OSError) as error:
        raise UpdateError(f"Invalid release archive: {error}") from error
    manifest = _validate_payload(stage)
    _normalize_modes(stage)
    return manifest


def _normalize_modes(stage):
    """Set only the executable modes required by the staged application."""
    try:
        for name in ("V-Link.py", "Update.sh", "Check-Lite.sh"):
            path = stage / name
            if path.is_file():
                path.chmod(0o755)
    except OSError as error:
        raise UpdateError(f"Could not set release script permissions: {error}") from error


def _missing_paths(stage, required):
    missing = []
    for name in required:
        path = stage / name
        if name == "resources/dtoverlays":
            exists = path.is_dir()
        else:
            exists = path.is_file()
        if not exists:
            missing.append(name)
    return missing


def _validate_payload(stage):
    """Validate and classify an extracted release before it changes the app."""
    missing_core = _missing_paths(stage, CORE_REQUIRED)
    if missing_core:
        raise UpdateError(
            f"Release archive is missing required app files: {', '.join(missing_core)}")

    manifest = None
    manifest_path = stage / MANIFEST
    if manifest_path.exists():
        if not manifest_path.is_file():
            raise UpdateError("Release archive contains an invalid commit manifest")
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise UpdateError("Release archive contains an invalid commit manifest") from error
        if not isinstance(manifest, dict):
            raise UpdateError("Release archive contains an invalid commit manifest")

        commit = manifest.get("commit")
        if not isinstance(commit, str) or re.fullmatch(r"[0-9a-fA-F]{40}", commit) is None:
            raise UpdateError("Release archive contains an invalid commit manifest")
        manifest["commit"] = commit.lower()

    schema = manifest.get("payload_schema") if manifest is not None else None
    if schema is not None and (
            not isinstance(schema, int) or isinstance(schema, bool)
            or schema != PAYLOAD_SCHEMA):
        raise UpdateError(f"Unsupported release payload schema: {schema!r}")

    has_updater = (stage / "updater").exists()
    has_update_script = (stage / "Update.sh").exists()
    if has_updater != has_update_script:
        raise UpdateError("Release archive contains an incomplete updater payload")
    if has_updater:
        missing_updater = _missing_paths(stage, UPDATER_REQUIRED)
        if missing_updater:
            raise UpdateError(
                f"Release archive contains an incomplete updater payload: {', '.join(missing_updater)}")

    has_lite_payload = (stage / "lite").exists() or (stage / "Check-Lite.sh").exists()
    if has_lite_payload:
        missing_lite = _missing_paths(stage, LITE_REQUIRED)
        if missing_lite:
            raise UpdateError(
                f"Release archive contains an incomplete Lite payload: {', '.join(missing_lite)}")

    if schema == PAYLOAD_SCHEMA:
        missing_modern = _missing_paths(stage, MODERN_REQUIRED)
        if missing_modern:
            raise UpdateError(
                f"Modern release archive is incomplete: {', '.join(missing_modern)}")
    return manifest


def _managed_paths(stage, metadata):
    if metadata.get("payload_schema") == PAYLOAD_SCHEMA:
        return list(MANAGED)
    paths = list(LEGACY_MANAGED)
    if (stage / "updater").is_dir() and (stage / "Update.sh").is_file():
        paths.extend(("updater", "Update.sh"))
    if (stage / "lite").is_dir() and (stage / "Check-Lite.sh").is_file():
        paths.extend(("lite", "resources/dtoverlays", "Check-Lite.sh"))
    return paths


def _replace(stage, app_dir, metadata):
    """Swap managed paths and restore the previous app if a swap fails."""
    app_dir = Path(app_dir)
    backup = Path(tempfile.mkdtemp(prefix=".vlink-backup-", dir=app_dir))
    paths = _managed_paths(stage, metadata)
    (stage / MANIFEST).write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    moved_old = []
    moved_new = []
    try:
        for name in paths:
            if (app_dir / name).exists():
                (backup / name).parent.mkdir(parents=True, exist_ok=True)
                os.replace(app_dir / name, backup / name)
                moved_old.append(name)
        for name in paths:
            if (stage / name).exists():
                (app_dir / name).parent.mkdir(parents=True, exist_ok=True)
                os.replace(stage / name, app_dir / name)
                moved_new.append(name)
    except OSError as error:
        rollback_errors = []
        for name in reversed(moved_new):
            target = app_dir / name
            try:
                if target.is_dir():
                    shutil.rmtree(target)
                else:
                    target.unlink()
            except OSError as rollback_error:
                rollback_errors.append(rollback_error)
        for name in reversed(moved_old):
            try:
                (app_dir / name).parent.mkdir(parents=True, exist_ok=True)
                os.replace(backup / name, app_dir / name)
            except OSError as rollback_error:
                rollback_errors.append(rollback_error)
        if rollback_errors:
            raise UpdateError(f"Could not restore all app files. Previous files are in {backup}: {rollback_errors[0]}") from error
        shutil.rmtree(backup)
        raise UpdateError(f"Could not replace app files; previous version restored: {error}") from error
    else:
        shutil.rmtree(backup, ignore_errors=True)


def install(release_id, app_dir):
    app_dir = Path(app_dir).resolve()
    if not app_dir.is_dir():
        raise UpdateError(f"App directory does not exist: {app_dir}")
    if (app_dir / ".git").exists():
        raise UpdateError("Cannot install a release over a source checkout")
    with open(app_dir / ".vlink-update.lock", "w", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise UpdateError("Another V-Link update is already running") from error
        return _install_locked(release_id, app_dir)


def _install_locked(release_id, app_dir):
    release = get_release(release_id)
    asset = _asset(release)
    print(f"Selected {release['tag_name']} ({_branch(release)})", flush=True)
    sha = commit_sha(release["tag_name"])
    metadata = {"tag": release["tag_name"], "branch": _branch(release) if release["prerelease"] else "stable",
                "commit": sha, "prerelease": bool(release["prerelease"])}
    with tempfile.TemporaryDirectory(prefix=".vlink-stage-", dir=app_dir) as temporary:
        stage = Path(temporary) / "files"
        stage.mkdir()
        archive = Path(temporary) / ASSET_NAME
        print("Downloading release archive...", flush=True)
        _download(asset["browser_download_url"], archive, asset.get("digest"))
        print("Checking release archive...", flush=True)
        packaged_manifest = _extract(archive, stage)
        if packaged_manifest is not None:
            packaged_commit = packaged_manifest["commit"]
            if packaged_commit != sha.lower():
                raise UpdateError("Release archive was built from a different commit than its tag")
            if packaged_manifest.get("payload_schema") == PAYLOAD_SCHEMA:
                metadata["payload_schema"] = PAYLOAD_SCHEMA
        python = app_dir / "venv" / "bin" / "python"
        if python.is_file():
            print("Installing Python requirements...", flush=True)
            try:
                subprocess.run([str(python), "-m", "pip", "install", "-r", str(stage / "requirements.txt")],
                               check=True)
            except (OSError, subprocess.CalledProcessError) as error:
                raise UpdateError(f"Could not install Python requirements: {error}") from error
        print("Installing release...", flush=True)
        _replace(stage, app_dir, metadata)
    print(f"Installed {release['tag_name']} ({sha[:12]}).", flush=True)
    return metadata


def main():
    parser = argparse.ArgumentParser(description="Install or downgrade a published V-Link release")
    parser.add_argument("--release-id", type=int, help="GitHub release ID; omit to choose interactively")
    parser.add_argument("--app-dir", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        release_id = args.release_id
        if release_id is None:
            catalogue = list_releases()["releases"]
            if not catalogue:
                raise UpdateError("No published releases with V-Link.zip were found")
            current = installed_release(args.app_dir)
            print(f"Installed: {current['tag'] or 'unknown'} ({current['commit'] or 'unknown commit'})")
            for number, release in enumerate(catalogue, 1):
                channel = f"prerelease: {release['branch']}" if release["prerelease"] else "stable"
                print(f"{number:3}  {release['tag']:24} {channel:25} {release['published_at'] or ''}")
            choice = input("Release number (blank to cancel): ").strip()
            if not choice:
                return 1
            if not choice.isdecimal() or not 1 <= int(choice) <= len(catalogue):
                raise UpdateError("Invalid release number")
            release_id = catalogue[int(choice) - 1]["id"]
        install(release_id, args.app_dir)
    except (UpdateError, EOFError, KeyboardInterrupt) as error:
        print(f"Update stopped: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
