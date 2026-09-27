#!/usr/bin/python3
"""Recover an interrupted V-Link application transaction using only stdlib."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile


RECOVERY_PROTOCOL = 1
TRANSACTION_SCHEMA = 1
TRANSACTION_RE = re.compile(r"^[0-9a-f]{32}$")
MANAGED_ALLOWLIST = frozenset((
    "V-Link.py", "backend", "frontend", "updater", "lite",
    "resources/dtoverlays", "requirements.txt", "Update.sh", "Patch.sh",
    "Check-Lite.sh", ".vlink-release.json",
))


class RecoveryError(Exception):
    pass


def _lexists(path):
    return os.path.lexists(path)


def _fsync_dir(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _atomic_write(path, content, mode=0o600):
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, mode)
        descriptor = os.open(temporary, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.replace(temporary, path)
        _fsync_dir(path.parent)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def installed_protocol(helper):
    helper = Path(helper)
    if not helper.is_file() or helper.is_symlink():
        return None
    try:
        match = re.search(r"(?m)^RECOVERY_PROTOCOL\s*=\s*(\d+)\s*$",
                          helper.read_text(encoding="utf-8"))
    except OSError:
        return None
    return int(match.group(1)) if match else None


def install_helper(source, destination):
    source = Path(source).resolve()
    destination = Path(destination)
    protocol = installed_protocol(destination)
    if protocol is not None and protocol >= RECOVERY_PROTOCOL:
        return False
    if _lexists(destination) and protocol is None:
        raise RecoveryError(f"Refusing to replace an unrecognized recovery helper: {destination}")
    try:
        content = source.read_text(encoding="utf-8")
        compile(content, str(source), "exec")
        destination.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write(destination, content, 0o755)
    except (OSError, SyntaxError) as error:
        raise RecoveryError(f"Could not install external recovery helper: {error}") from error
    return True


def write_state(transaction_dir, state):
    _atomic_write(Path(transaction_dir) / "state.json",
                  json.dumps(state, sort_keys=True, indent=2) + "\n")


def _remove(path):
    path = Path(path)
    if not _lexists(path):
        return
    if path.is_symlink() or not path.is_dir():
        path.unlink()
    else:
        shutil.rmtree(path)
    _fsync_dir(path.parent)


def _validated_id(value):
    if not isinstance(value, str) or TRANSACTION_RE.fullmatch(value) is None:
        raise RecoveryError("Invalid V-Link transaction ID")
    return value


def _assert_safe_parents(root, relative):
    current = Path(root)
    for part in Path(relative).parts[:-1]:
        current = current / part
        if _lexists(current) and (current.is_symlink() or not current.is_dir()):
            raise RecoveryError(f"Unsafe parent for managed path: {relative}")


def _read_marker(parent):
    marker = parent / ".v-link-update-active"
    if not _lexists(marker):
        return None
    if marker.is_symlink() or not marker.is_file():
        raise RecoveryError("Unsafe V-Link update marker")
    try:
        lines = marker.read_text(encoding="ascii").splitlines()
    except (OSError, UnicodeError) as error:
        raise RecoveryError(f"Could not read V-Link update marker: {error}") from error
    if len(lines) != 1:
        raise RecoveryError("Unsupported V-Link update marker format")
    return _validated_id(lines[0])


def _load_state(app_dir, transaction_id):
    parent = app_dir.parent
    transaction = parent / f".v-link-update.{transaction_id}"
    if transaction.is_symlink() or not transaction.is_dir():
        raise RecoveryError("V-Link transaction directory is missing or unsafe")
    state_path = transaction / "state.json"
    if state_path.is_symlink() or not state_path.is_file():
        raise RecoveryError("V-Link transaction state is missing or unsafe")
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise RecoveryError(f"Invalid V-Link transaction state: {error}") from error
    if not isinstance(state, dict) or state.get("schema") != TRANSACTION_SCHEMA:
        raise RecoveryError("Unsupported V-Link transaction schema")
    if state.get("transaction_id") != transaction_id:
        raise RecoveryError("V-Link transaction ID mismatch")
    if state.get("app_dir") != str(app_dir):
        raise RecoveryError("V-Link recovery target mismatch")
    managed = state.get("managed_paths")
    originally_present = state.get("originally_present")
    if (not isinstance(managed, list) or len(managed) != len(set(managed))
            or any(name not in MANAGED_ALLOWLIST for name in managed)):
        raise RecoveryError("Unsafe managed paths in V-Link transaction")
    if (not isinstance(originally_present, list)
            or any(name not in managed for name in originally_present)):
        raise RecoveryError("Invalid original path state in V-Link transaction")
    candidate = state.get("candidate_venv")
    expected_candidate = f".v-link-venvs/{transaction_id}"
    if candidate != expected_candidate:
        raise RecoveryError("Unsafe candidate venv in V-Link transaction")
    previous_venv = state.get("previous_venv")
    if not isinstance(previous_venv, dict) or previous_venv.get("kind") not in (
            "absent", "directory", "symlink"):
        raise RecoveryError("Invalid previous venv state")
    if previous_venv["kind"] == "symlink" and not isinstance(previous_venv.get("target"), str):
        raise RecoveryError("Invalid previous venv symlink state")
    backup = transaction / "backup"
    if backup.is_symlink() or not backup.is_dir():
        raise RecoveryError("V-Link transaction backup is missing or unsafe")
    for name in managed:
        _assert_safe_parents(app_dir, name)
        _assert_safe_parents(backup, name)
    return transaction, backup, state


def _restore_path(app_dir, backup, name, originally_present):
    current = app_dir / name
    saved = backup / name
    if _lexists(saved):
        _remove(current)
        current.parent.mkdir(parents=True, exist_ok=True)
        os.replace(saved, current)
        _fsync_dir(saved.parent)
        _fsync_dir(current.parent)
        _fsync_dir(current.parent.parent)
    elif name not in originally_present:
        _remove(current)
    elif not _lexists(current):
        raise RecoveryError(f"Cannot reconstruct original path: {name}")


def _recover_locked(app_dir):
    parent = app_dir.parent
    transaction_id = _read_marker(parent)
    if transaction_id is None:
        return False
    transaction, backup, state = _load_state(app_dir, transaction_id)
    originally_present = set(state["originally_present"])

    for name in reversed(state["managed_paths"]):
        _restore_path(app_dir, backup, name, originally_present)

    venv = app_dir / "venv"
    saved_venv = backup / "venv"
    previous_kind = state["previous_venv"]["kind"]
    if _lexists(saved_venv):
        _remove(venv)
        os.replace(saved_venv, venv)
        _fsync_dir(saved_venv.parent)
        _fsync_dir(app_dir)
    elif previous_kind == "absent":
        _remove(venv)
    elif not _lexists(venv):
        raise RecoveryError("Cannot reconstruct original venv")

    marker = parent / ".v-link-update-active"
    marker.unlink()
    _fsync_dir(parent)
    shutil.rmtree(transaction, ignore_errors=True)
    candidate = app_dir / state["candidate_venv"]
    if candidate != (app_dir / "venv").resolve():
        shutil.rmtree(candidate, ignore_errors=True)
    return True


def recover(app_dir, *, lock_held=False):
    try:
        app_dir = Path(app_dir).resolve()
        if not app_dir.is_dir():
            raise RecoveryError(f"App directory does not exist: {app_dir}")
        if lock_held:
            return _recover_locked(app_dir)
        lock_path = app_dir.parent / ".v-link-update.lock"
        with open(lock_path, "a", encoding="utf-8") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            return _recover_locked(app_dir)
    except RecoveryError:
        raise
    except OSError as error:
        raise RecoveryError(f"Could not recover V-Link transaction: {error}") from error


def main():
    parser = argparse.ArgumentParser(description="Recover an interrupted V-Link update")
    parser.add_argument("--lock-held", action="store_true")
    parser.add_argument("app_dir", type=Path)
    args = parser.parse_args()
    try:
        recovered = recover(args.app_dir, lock_held=args.lock_held)
    except RecoveryError as error:
        print(f"V-Link recovery failed: {error}", file=sys.stderr)
        return 1
    if recovered:
        print("Recovered the previous V-Link installation.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
