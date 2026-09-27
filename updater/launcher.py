#!/usr/bin/python3
"""Install the stable Desktop launcher and its XDG autostart entry."""

import argparse
import os
from pathlib import Path
import shlex
import tempfile

try:
    from . import recovery
except ImportError:
    import recovery


def _fsync_dir(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _atomic_write(path, content, mode):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
        _fsync_dir(path.parent)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def install(app_dir):
    app_dir = Path(app_dir).resolve()
    home = app_dir.parent
    helper = home / ".local/libexec/v-link-recovery"
    launcher = home / ".local/libexec/v-link-launch"
    autostart = home / ".config/autostart/v-link.desktop"
    recovery.install_helper(Path(recovery.__file__), helper)
    quoted_app = shlex.quote(str(app_dir))
    quoted_helper = shlex.quote(str(helper))
    launcher_text = f"""#!/bin/sh
set -eu
APP_DIR={quoted_app}
/usr/bin/python3 {quoted_helper} "$APP_DIR"
exec "$APP_DIR/venv/bin/python" "$APP_DIR/V-Link.py" "$@"
"""
    desktop_text = f"""[Desktop Entry]
Name=V-Link
Exec={launcher}
Type=Application
"""
    _atomic_write(launcher, launcher_text, 0o755)
    _atomic_write(autostart, desktop_text, 0o644)
    return launcher, autostart


def main():
    parser = argparse.ArgumentParser(description="Install V-Link Desktop startup integration")
    parser.add_argument("--install", action="store_true", required=True)
    parser.add_argument("--app-dir", type=Path, required=True)
    args = parser.parse_args()
    install(args.app_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
