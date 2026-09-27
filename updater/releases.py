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
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
import zipfile

try:
    from . import recovery
except ImportError:  # Direct execution from updater/releases.py.
    import recovery


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
RECOVERY_HELPER = ".local/libexec/v-link-recovery"


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


def _lexists(path):
    return os.path.lexists(path)


def _durable_replace(source, destination):
    source = Path(source)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    os.replace(source, destination)
    recovery._fsync_dir(source.parent)
    if source.parent != destination.parent:
        recovery._fsync_dir(destination.parent)
        recovery._fsync_dir(destination.parent.parent)


def _previous_venv(app_dir):
    path = app_dir / "venv"
    if path.is_symlink():
        return {"kind": "symlink", "target": os.readlink(path)}
    if path.is_dir():
        return {"kind": "directory"}
    if _lexists(path):
        raise UpdateError("The active venv path is neither a directory nor a symlink")
    return {"kind": "absent"}


def _ensure_space(parent, archive_size):
    # The archive, extracted payload and candidate environment coexist.
    required = max(128 * 1024 * 1024, int(archive_size or 0) * 3)
    if shutil.disk_usage(parent).free < required:
        raise UpdateError("Not enough free space to prepare the update safely")


def _sync_prepared_payload():
    # pip and archive extraction create many files; one filesystem sync keeps
    # preparation simple and makes their contents durable before activation.
    os.sync()


def _cleanup_abandoned_preparations(app_dir):
    if _lexists(app_dir.parent / ".v-link-update-active"):
        return
    current_venv = (app_dir / "venv").resolve() if _lexists(app_dir / "venv") else None
    prefix = ".v-link-update."
    for transaction in app_dir.parent.iterdir():
        if not transaction.name.startswith(prefix):
            continue
        transaction_id = transaction.name[len(prefix):]
        if recovery.TRANSACTION_RE.fullmatch(transaction_id) is None:
            continue
        if transaction.is_symlink() or not transaction.is_dir():
            continue
        state_path = transaction / "state.json"
        if state_path.exists():
            try:
                state = json.loads(state_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if (not isinstance(state, dict)
                    or state.get("schema") != recovery.TRANSACTION_SCHEMA
                    or state.get("transaction_id") != transaction_id
                    or state.get("app_dir") != str(app_dir)):
                continue
            if isinstance(state.get("previous_venv"), dict):
                _cleanup_previous_candidate(app_dir, state)
        candidate = app_dir / ".v-link-venvs" / transaction_id
        if candidate != current_venv:
            shutil.rmtree(candidate, ignore_errors=True)
        shutil.rmtree(transaction, ignore_errors=True)


def _prepare_candidate_venv(stage, candidate, modern):
    if _lexists(candidate):
        raise UpdateError(f"Candidate venv already exists: {candidate}")
    candidate.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run([sys.executable, "-m", "venv", str(candidate)], check=True)
        python = candidate / "bin/python"
        subprocess.run([str(python), "-m", "pip", "install", "-r",
                        str(stage / "requirements.txt")], check=True)
        subprocess.run([str(python), "-m", "pip", "check"], check=True)
        stage_venv = stage / "venv"
        if _lexists(stage_venv):
            raise UpdateError("Release archive contains an unexpected venv path")
        stage_venv.symlink_to(os.path.relpath(candidate, stage))
        try:
            command = ([str(python), str(stage / "V-Link.py"), "--help"] if modern else
                       [str(python), "-m", "py_compile", str(stage / "V-Link.py")])
            subprocess.run(command, check=True, timeout=120,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        finally:
            stage_venv.unlink(missing_ok=True)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise UpdateError(f"Candidate Python environment validation failed: {error}") from error


def _ensure_recovery_helper(app_dir):
    source = Path(recovery.__file__).resolve()
    helper = app_dir.parent / RECOVERY_HELPER
    try:
        recovery.install_helper(source, helper)
    except recovery.RecoveryError as error:
        raise UpdateError(f"Could not install the external recovery helper: {error}") from error
    return helper


def _transaction_state(transaction_id, app_dir, stage, metadata):
    paths = _managed_paths(stage, metadata)
    return {
        "schema": recovery.TRANSACTION_SCHEMA,
        "transaction_id": transaction_id,
        "app_dir": str(app_dir),
        "phase": "prepared",
        "managed_paths": paths,
        "originally_present": [name for name in paths if _lexists(app_dir / name)],
        "from_release": installed_release(app_dir),
        "to_release": metadata,
        "candidate_venv": f".v-link-venvs/{transaction_id}",
        "previous_venv": _previous_venv(app_dir),
    }


def _preserve_transaction_engine(stage, app_dir):
    """Do not let an application downgrade remove the durable update engine."""
    current_updater = app_dir / "updater"
    if not (current_updater / "recovery.py").is_file():
        return
    if any(path.is_symlink() for path in current_updater.rglob("*")):
        raise UpdateError("The installed updater contains an unsafe symlink")
    staged_updater = stage / "updater"
    if _lexists(staged_updater):
        shutil.rmtree(staged_updater)
    shutil.copytree(
        current_updater, staged_updater,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    current_script = app_dir / "Update.sh"
    if current_script.is_file() and not current_script.is_symlink():
        shutil.copy2(current_script, stage / "Update.sh")


def _write_marker(parent, transaction_id):
    recovery._atomic_write(parent / ".v-link-update-active", transaction_id + "\n")


def _validate_activated(app_dir, candidate, modern):
    python = app_dir / "venv/bin/python"
    if os.path.realpath(python) != os.path.realpath(candidate / "bin/python"):
        raise UpdateError("Activated venv does not resolve to the candidate environment")
    command = ([str(python), str(app_dir / "V-Link.py"), "--help"] if modern else
               [str(python), "-m", "py_compile", str(app_dir / "V-Link.py")])
    try:
        subprocess.run(command, check=True, timeout=120,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise UpdateError(f"Activated installation validation failed: {error}") from error


def _cleanup_previous_candidate(app_dir, state):
    previous = state["previous_venv"]
    if previous["kind"] != "symlink":
        return
    old_target = (app_dir / previous["target"]).resolve()
    candidates = (app_dir / ".v-link-venvs").resolve()
    current = (app_dir / "venv").resolve()
    if old_target.parent == candidates and old_target != current and old_target.name != state["transaction_id"]:
        shutil.rmtree(old_target, ignore_errors=True)


def _activate(stage, app_dir, metadata, transaction, candidate, state):
    backup = transaction / "backup"
    marker_created = False
    try:
        state["phase"] = "activating"
        recovery.write_state(transaction, state)
        _write_marker(app_dir.parent, state["transaction_id"])
        marker_created = True

        for name in state["managed_paths"]:
            source = app_dir / name
            if _lexists(source):
                _durable_replace(source, backup / name)
        for name in state["managed_paths"]:
            source = stage / name
            if _lexists(source):
                _durable_replace(source, app_dir / name)

        active_venv = app_dir / "venv"
        if _lexists(active_venv):
            _durable_replace(active_venv, backup / "venv")
        active_venv.symlink_to(state["candidate_venv"])
        recovery._fsync_dir(app_dir)

        _validate_activated(app_dir, candidate,
                            metadata.get("payload_schema") == PAYLOAD_SCHEMA)
        state["phase"] = "activated"
        recovery.write_state(transaction, state)
        (app_dir.parent / ".v-link-update-active").unlink()
        recovery._fsync_dir(app_dir.parent)
    except BaseException as error:
        if marker_created:
            try:
                recovery.recover(app_dir, lock_held=True)
            except recovery.RecoveryError as rollback_error:
                raise UpdateError(
                    f"Update failed and rollback is incomplete: {rollback_error}") from error
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            raise
        if isinstance(error, UpdateError):
            raise
        raise UpdateError(f"Could not activate release; previous version restored: {error}") from error
    else:
        _cleanup_previous_candidate(app_dir, state)
        shutil.rmtree(transaction, ignore_errors=True)


def install(release_id, app_dir):
    app_dir = Path(app_dir).resolve()
    if not app_dir.is_dir():
        raise UpdateError(f"App directory does not exist: {app_dir}")
    if (app_dir / ".git").exists():
        raise UpdateError("Cannot install a release over a source checkout")
    if (app_dir / ".v-link-lite-runtime").is_file():
        raise UpdateError("V-Link Lite updates remain disabled until platform migration is transactional")
    with open(app_dir.parent / ".v-link-update.lock", "a", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise UpdateError("Another V-Link update is already running") from error
        try:
            recovery.recover(app_dir, lock_held=True)
        except recovery.RecoveryError as error:
            raise UpdateError(f"Interrupted update recovery failed: {error}") from error
        try:
            _cleanup_abandoned_preparations(app_dir)
            return _install_locked(release_id, app_dir)
        except UpdateError:
            raise
        except OSError as error:
            raise UpdateError(f"Update filesystem operation failed: {error}") from error


def _install_locked(release_id, app_dir):
    release = get_release(release_id)
    asset = _asset(release)
    print(f"Selected {release['tag_name']} ({_branch(release)})", flush=True)
    sha = commit_sha(release["tag_name"])
    metadata = {"tag": release["tag_name"], "branch": _branch(release) if release["prerelease"] else "stable",
                "commit": sha, "prerelease": bool(release["prerelease"])}
    _ensure_space(app_dir.parent, asset.get("size"))
    transaction_id = uuid.uuid4().hex
    transaction = app_dir.parent / f".v-link-update.{transaction_id}"
    stage = transaction / "stage"
    backup = transaction / "backup"
    candidate = app_dir / ".v-link-venvs" / transaction_id
    transaction.mkdir(mode=0o700)
    stage.mkdir()
    backup.mkdir()
    recovery._fsync_dir(app_dir.parent)
    if os.stat(transaction).st_dev != os.stat(app_dir).st_dev:
        raise UpdateError("Update transaction and application are on different filesystems")
    try:
        archive = transaction / ASSET_NAME
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
        metadata_path = stage / MANIFEST
        metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        _preserve_transaction_engine(stage, app_dir)
        print("Building candidate Python environment...", flush=True)
        _prepare_candidate_venv(
            stage, candidate, metadata.get("payload_schema") == PAYLOAD_SCHEMA)
        _ensure_recovery_helper(app_dir)
        state = _transaction_state(transaction_id, app_dir, stage, metadata)
        _sync_prepared_payload()
        recovery.write_state(transaction, state)
        print("Installing release...", flush=True)
        _activate(stage, app_dir, metadata, transaction, candidate, state)
    except BaseException:
        if not _lexists(app_dir.parent / ".v-link-update-active"):
            shutil.rmtree(candidate, ignore_errors=True)
            shutil.rmtree(transaction, ignore_errors=True)
        raise
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
