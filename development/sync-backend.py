#!/usr/bin/env python3
"""Manually sync backend sources to a Pi and request a graceful V-Link restart."""

from __future__ import annotations

import argparse
import json
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIRECTORIES = ("backend", "updater")
ROOT_FILES = ("V-Link.py", "requirements.txt")
SIMULATION_FILES = ("development/__init__.py", "development/vcan.py", "development/setup-vcan.sh")

INSPECT_REMOTE = """
import hashlib
import json
import socket
import sys
from pathlib import Path

root = Path(sys.argv[1]).expanduser().resolve()
for relative in ('V-Link.py', 'backend', 'updater', 'frontend/package.json', 'venv/bin/python'):
    if not (root / relative).exists():
        raise SystemExit(f'Not an existing V-Link installation: {root / relative} is missing')
requirements = root / 'requirements.txt'
requirements_hash = hashlib.sha256(requirements.read_bytes()).hexdigest() if requirements.exists() else None
if sys.argv[2] == 'restart' and sys.argv[3] == requirements_hash:
    try:
        with socket.create_connection(('127.0.0.1', 4001), timeout=3):
            pass
    except OSError:
        raise SystemExit(
            'V-Link is not reachable on the Pi at 127.0.0.1:4001. No files were synced. '
            'Start V-Link in a Pi desktop terminal (python3 V-Link.py --vite), '
            'or rerun with --no-restart to sync while the app is stopped and start it manually.'
        ) from None
print(json.dumps({
    'root': str(root),
    'requirements': requirements_hash,
}))
"""

VALIDATE_AND_RESTART = """
import sys
from pathlib import Path

root = Path(sys.argv[1])
sources = [root / 'V-Link.py']
for directory in ('backend', 'updater'):
    sources.extend((root / directory).rglob('*.py'))
sources.extend(root / relative for relative in ('development/__init__.py', 'development/vcan.py'))
for source in sources:
    compile(source.read_bytes(), str(source), 'exec')
print('Python syntax validated with the Pi virtual environment.', flush=True)

if sys.argv[2] == 'restart':
    import socketio

    client = socketio.Client(reconnection=False)
    try:
        try:
            client.connect('http://127.0.0.1:4001', namespaces=['/sys'],
                           transports=['websocket'], wait_timeout=10)
        except socketio.exceptions.ConnectionError:
            raise SystemExit(
                'Sources were synced, but the restart client could not connect to V-Link '
                'at 127.0.0.1:4001. Check the Pi app terminal; if the app stopped, '
                'start it manually with python3 V-Link.py --vite.'
            ) from None
        try:
            client.call('systemTask', 'restart', namespace='/sys', timeout=10)
        except socketio.exceptions.TimeoutError:
            raise SystemExit(
                'The restart request was sent, but its acknowledgement timed out. '
                'Check the Pi app terminal to see whether it restarted before trying again.'
            ) from None
    finally:
        if client.connected:
            client.disconnect()
    print('Restart requested. Check the Pi terminal for startup errors.', flush=True)
"""


def parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", help="SSH destination, for example pi-user@pi-host")
    parser.add_argument("--remote-dir", default="~/v-link", help="Existing Pi installation (default: ~/v-link)")
    parser.add_argument("--dry-run", action="store_true", help="Preview transfers and deletions without changing the Pi")
    parser.add_argument("--no-restart", action="store_true", help="Sync and check syntax; restart manually afterward")
    args = parser.parse_args(argv)
    if args.target.startswith("-") or not re.fullmatch(r"[\w.@:\[\]-]+", args.target, flags=re.ASCII):
        parser.error("target must be an SSH hostname or user@hostname, without shell options")
    return args


def validate_local_sources(root: Path) -> None:
    """Catch syntax errors before transferring files, without importing Pi libraries."""
    sources = [root / "V-Link.py"]
    for directory in SOURCE_DIRECTORIES:
        sources.extend((root / directory).rglob("*.py"))
    sources.extend(root / relative for relative in SIMULATION_FILES if relative.endswith(".py"))
    for source in sources:
        compile(source.read_bytes(), str(source), "exec")


def rsync_commands(
    target: str, remote_root: str, ssh: list[str], *, dry_run: bool = False
) -> list[list[str]]:
    common = [
        "rsync", "-az", "--itemize-changes", "--delay-updates", "--protect-args",
        "--exclude=__pycache__/", "--exclude=*.py[co]", "-e", shlex.join(ssh),
    ]
    if dry_run:
        common.append("--dry-run")
    # Limit deletions to the two source directories, never the installation root.
    commands = [
        [*common, "--delete-delay", "--", f"{directory}/", f"{target}:{remote_root}/{directory}/"]
        for directory in SOURCE_DIRECTORIES
    ]
    commands.append([*common, "--", *ROOT_FILES, f"{target}:{remote_root}/"])
    # backend.version reads this file even when Vite runs on another computer.
    commands.append([*common, "--", "frontend/package.json", f"{target}:{remote_root}/frontend/"])
    # Copy only the simulator, preserving any other development tools on the Pi.
    commands.append([*common, "--", *SIMULATION_FILES, f"{target}:{remote_root}/development/"])
    return commands


def sync_backend(args: argparse.Namespace, root: Path = PROJECT_ROOT) -> None:
    import hashlib

    for program in ("ssh", "rsync"):
        if shutil.which(program) is None:
            raise RuntimeError(f"{program} is not installed or not in PATH; install it on the development computer")
    validate_local_sources(root)
    requirements_hash = hashlib.sha256((root / "requirements.txt").read_bytes()).hexdigest()

    with tempfile.TemporaryDirectory(prefix="vlink-sync-") as temporary:
        control_path = str(Path(temporary) / "ssh")
        # Reuse one authenticated connection for inspection, rsync, and restart.
        # The temporary control socket belongs only to this invocation.
        ssh = [
            "ssh", "-o", "ControlMaster=auto", "-o", "ControlPersist=60",
            "-o", f"ControlPath={control_path}",
        ]
        try:
            inspection = [
                "python3", "-", args.remote_dir,
                "check" if args.no_restart or args.dry_run else "restart", requirements_hash,
            ]
            try:
                inspected = subprocess.run(
                    [*ssh, args.target, shlex.join(inspection)],
                    input=INSPECT_REMOTE, text=True, stdout=subprocess.PIPE, check=True,
                )
            except subprocess.CalledProcessError as error:
                raise RuntimeError("Pi preflight failed; no sources were transferred. See the message above.") from error
            remote = json.loads(inspected.stdout)
            remote_root = remote["root"]
            if not isinstance(remote_root, str) or not remote_root.startswith("/") or remote_root == "/":
                raise RuntimeError("Pi returned an invalid installation path")
            requirements_changed = requirements_hash != remote["requirements"]
            print(f"{'Previewing' if args.dry_run else 'Syncing'} backend sources to {args.target}:{remote_root}", flush=True)
            for command in rsync_commands(args.target, remote_root, ssh, dry_run=args.dry_run):
                subprocess.run(command, cwd=root, check=True)
            if args.dry_run:
                print("Dry run complete; no files changed and no restart requested.")
                return

            restart = not args.no_restart and not requirements_changed
            command = [f"{remote_root}/venv/bin/python", "-", remote_root, "restart" if restart else "check"]
            try:
                subprocess.run(
                    [*ssh, args.target, shlex.join(command)],
                    input=VALIDATE_AND_RESTART, text=True, check=True,
                )
            except subprocess.CalledProcessError as error:
                raise RuntimeError(
                    "Sources were synced, but validation or restart failed. Check the Pi message above."
                ) from error
            if requirements_changed:
                install = shlex.join([
                    f"{remote_root}/venv/bin/python", "-m", "pip", "install", "-r",
                    f"{remote_root}/requirements.txt",
                ])
                print("requirements.txt changed. Sources were synced, but the app was not restarted.")
                print("Install dependencies on the Pi, then run this sync command again:")
                print(shlex.join(["ssh", args.target, install]))
            elif args.no_restart:
                print("Sync complete. Start or restart V-Link on the Pi to load the changes.")
        finally:
            if Path(control_path).exists():
                subprocess.run(
                    ["ssh", "-S", control_path, "-O", "exit", args.target],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
                )


def main(argv: list[str] | None = None) -> int:
    args = parse_arguments(argv)
    try:
        sync_backend(args)
    except (OSError, ValueError, KeyError, RuntimeError, SyntaxError, subprocess.CalledProcessError) as error:
        print(f"Sync failed: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nSync interrupted.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
