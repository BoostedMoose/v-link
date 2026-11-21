"""Check or apply the Raspberry Pi system setup this V-Link release needs (Python standard library only)."""

import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


APP_DIR = Path(__file__).resolve().parents[1]
# Inside updater/, because every updater version replaces that folder as a whole.
TEMPLATES = Path(__file__).resolve().parent / "templates"
OVERLAYS = ("v-link.dtbo", "mcp2515-can1.dtbo", "mcp2515-can2.dtbo")
PACKAGES = ("ffmpeg", "libudev-dev", "libusb-dev", "build-essential", "python3-venv")
BITRATES = {"can1": 125000, "can2": 500000}
BLOCK_START = "# >>> V-Link (managed, do not edit) >>>"
BLOCK_END = "# <<< V-Link <<<"


class SetupError(Exception):
    pass


def _run(args):
    return subprocess.run(args, capture_output=True, text=True)


def pi_model(root):
    try:
        model = (root / "proc/device-tree/model").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    return next((number for number in ("3", "4", "5") if f"Raspberry Pi {number}" in model), None)


def split_config(text):
    """Return the parts of config.txt before and after the V-Link block."""
    lines = text.splitlines(keepends=True)
    starts = [index for index, line in enumerate(lines) if line.rstrip() == BLOCK_START]
    ends = [index for index, line in enumerate(lines) if line.rstrip() == BLOCK_END]
    if not starts and not ends:
        before, after = (text if not text or text.endswith("\n") else text + "\n"), ""
    elif len(starts) == 1 and len(ends) == 1 and starts[0] < ends[0]:
        before, after = "".join(lines[:starts[0]]), "".join(lines[ends[0] + 1:])
    else:
        raise SetupError("the V-Link block markers are damaged")
    if any(line.startswith("[V-LINK") for line in (before + after).splitlines()):
        raise SetupError("it contains the V-Link block of an older version. Run Patch.sh once, "
                         "or remove the block from the [V-LINK line to disable_splash=1 by hand")
    return before, after


def write_file(path, data):
    """Back up the current file, then replace it in one rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        shutil.copyfile(path, path.with_name(path.name + ".vlink-backup"))
    temporary = path.with_name(f".{path.name}.vlink-new")
    with open(temporary, "wb") as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def _install_packages(packages):
    environment = {**os.environ, "DEBIAN_FRONTEND": "noninteractive"}
    subprocess.run(["apt-get", "update"], env=environment, check=True)
    subprocess.run(["apt-get", "install", "-y", *packages], env=environment, check=True)


def _file(changes, path, data):
    current = path.read_bytes() if path.exists() else None
    if current != data:
        changes.append((f"{'Update' if current is not None else 'Create'} {path}", lambda: write_file(path, data)))


def _config(root, changes, problems):
    path = root / "boot/firmware/config.txt"
    model = pi_model(root)
    if model is None:
        problems.append(f"{path} was not changed: unknown Raspberry Pi model")
        return
    try:
        text = path.read_text(encoding="utf-8")
        before, after = split_config(text)
    except (OSError, ValueError, SetupError) as error:
        problems.append(f"{path} was not changed: {error}")
        return
    if BLOCK_START not in text and before.strip() and not before.endswith("\n\n"):
        before += "\n"
    # [all] keeps the block active even if the file ended inside a filter section such as [pi4].
    content = (TEMPLATES / f"config-pi{model}.txt").read_text(encoding="utf-8")
    updated = f"{before}{BLOCK_START}\n[all]\n{content}{BLOCK_END}\n{after}"
    if split_config(updated) != (before, after):
        raise SetupError("could not build a valid config.txt")
    _file(changes, path, updated.encode("utf-8"))


def plan(root):
    """Return the pending changes and the problems found. Packages come last, so a missing
    network connection never keeps config.txt from being updated."""
    changes, problems = [], []
    root_option = [] if root == Path("/") else [f"--root={root}"]
    overlays = TEMPLATES / "overlays"
    if not overlays.is_dir():
        overlays = APP_DIR / "resources" / "dtoverlays"  # source checkout
    for name in OVERLAYS:
        _file(changes, root / "boot/firmware/overlays" / name, (overlays / name).read_bytes())
    for name, default in BITRATES.items():
        # Keep the bitrate chosen during installation.
        path = root / f"etc/systemd/network/{name}.network"
        match = re.search(r"^BitRate=(\d+)\s*$", path.read_text(encoding="utf-8"), re.M) if path.exists() else None
        network = (TEMPLATES / "can.network").read_text(encoding="utf-8")
        _file(changes, path, network.format(name=name, bitrate=match.group(1) if match else default).encode("utf-8"))
    _file(changes, root / "etc/modules-load.d/uinput.conf", (TEMPLATES / "uinput.conf").read_bytes())
    _file(changes, root / "etc/udev/rules.d/42-v-link.rules", (TEMPLATES / "42-v-link.rules").read_bytes())
    pwrkey = root / "etc/xdg/autostart/pwrkey.desktop"
    if pwrkey.exists():
        # The desktop power key service interferes with the ignition logic.
        changes.append((f"Disable {pwrkey}", lambda: os.replace(pwrkey, pwrkey.with_name("pwrkey.desktop.backup"))))
    if _run(["systemctl", *root_option, "is-enabled", "--quiet", "systemd-networkd"]).returncode != 0:
        changes.append(("Enable systemd-networkd",
                        lambda: _run(["systemctl", *root_option, "enable", "systemd-networkd"]).check_returncode()))
    _config(root, changes, problems)
    missing = [package for package in PACKAGES
               if "install ok installed" not in _run(["dpkg-query", *root_option, "-W", "-f=${Status}", package]).stdout]
    if missing and root == Path("/"):
        changes.append((f"Install packages {' '.join(missing)}", lambda: _install_packages(missing)))
    elif missing:
        problems.append(f"Missing packages: {' '.join(missing)}")
    return changes, problems


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check or apply the system setup of this V-Link release")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="list pending changes without applying them")
    mode.add_argument("--apply", action="store_true", help="apply pending changes")
    parser.add_argument("--root", type=Path, default=Path("/"), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        changes, problems = plan(args.root)
    except (OSError, ValueError, SetupError, subprocess.SubprocessError) as error:
        print(f"System check failed, nothing was changed: {error}", file=sys.stderr)
        return 1
    if not changes and not problems:
        print("System components are up to date.")
    elif args.check:
        for description, _action in changes:
            print(f"Pending: {description}")
    else:
        if args.root == Path("/") and os.geteuid() != 0:
            print("Run with sudo to apply system changes.", file=sys.stderr)
            return 1
        for description, action in changes:
            print(f"{description}...", flush=True)
            try:
                action()
            except (OSError, subprocess.SubprocessError) as error:
                print(f"Failed: {error}", file=sys.stderr)
                print("Later changes were not applied.", file=sys.stderr)
                return 1
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems or (args.check and changes) else 0


if __name__ == "__main__":
    sys.exit(main())
