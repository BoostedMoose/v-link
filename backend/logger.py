import logging
import os
import subprocess
import datetime
from typing import Iterable

LOG_DIR = os.path.expanduser("~/v-link/logs")
OLD_LOG_DIR = os.path.join(LOG_DIR, "old")

# Keep at most this many OLD (archived) app logs and boot logs in LOG_DIR/old/
MAX_BOOTLOGS = 5

# Current log names (always present only in LOG_DIR)
LOG_FILE = os.path.join(LOG_DIR, "logfile.txt")
BOOT_LOG = os.path.join(LOG_DIR, "bootlog.txt")


def check_dirs():
    os.makedirs(LOG_DIR, exist_ok=True)
    os.makedirs(OLD_LOG_DIR, exist_ok=True)


def exec(cmd):
    try:
        return subprocess.check_output(cmd, shell=True, text=True).strip()
    except subprocess.CalledProcessError as e:
        return f"[ERROR] Command '{cmd}' failed: {e}"


def collect_boot_diagnostics():
    # Create a fresh bootlog in LOG_DIR. Move any existing bootlog.txt into OLD_LOG_DIR with a timestamped name.
    check_dirs()

    # If there's an existing current bootlog, archive it first
    if os.path.exists(BOOT_LOG):
        ts = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        archived_name = f"bootlog_{ts}.txt"
        dst = os.path.join(OLD_LOG_DIR, archived_name)
        os.replace(BOOT_LOG, dst)

    timestamp = datetime.datetime.now().isoformat()
    lines = [f"=== Boot Diagnostics Log: {timestamp} ===\n"]

    commands = {
        "Uptime": "uptime",
        "Kernel Version": "uname -a",
        "GPIO Summary": "gpioinfo",
        "Network Interfaces": "ip link show",
        "MCP Driver": "dmesg | grep -i mcp25*",
        "I2C Devices": "i2cdetect -l",
        "SPI Devices": "ls /dev/spidev*",
        "SPI / I2C": "dmesg | grep -Ei 'spi|i2c|probe|error'",
        "Systemd Boot Warnings/Errors": "journalctl -b -p 3..4",
        "Recent Kernel Messages": "journalctl -k -n 100",
    }

    for title, cmd in commands.items():
        lines.append(f"\n--- {title} ---")
        lines.append(exec(cmd))

    with open(BOOT_LOG, "w") as f:
        f.write("\n".join(lines))


def _list_sorted(paths: Iterable[str]) -> list[str]:
    # Return existing paths sorted by mtime (newest first).
    existing = [p for p in paths if os.path.exists(p)]
    return sorted(existing, key=lambda p: os.path.getmtime(p), reverse=True)


def _enforce_archive_limits():
    # Keep only logfile.txt and bootlog.txt in LOG_DIR.
    # Archive older versions into OLD_LOG_DIR with timestamped names.
    # Limit archive size to MAX_BOOTLOGS for each log type.

    check_dirs()

    # Handle application logfile
    if os.path.exists(LOG_FILE):
        ts = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        archived_name = f"logfile_{ts}.txt"
        dst = os.path.join(OLD_LOG_DIR, archived_name)
        os.replace(LOG_FILE, dst)

    # In OLD_LOG_DIR: cap archived app logs
    archived_app = _list_sorted(
        [os.path.join(OLD_LOG_DIR, f) for f in os.listdir(OLD_LOG_DIR)
         if f.startswith("logfile_") and f.endswith(".txt")]
    )
    for path in archived_app[MAX_BOOTLOGS:]:
        try:
            os.remove(path)
        except OSError:
            pass

    # In OLD_LOG_DIR: cap archived boot logs
    archived_boot = _list_sorted(
        [os.path.join(OLD_LOG_DIR, f) for f in os.listdir(OLD_LOG_DIR)
         if f.startswith("bootlog_") and f.endswith(".txt")]
    )
    for path in archived_boot[MAX_BOOTLOGS:]:
        try:
            os.remove(path)
        except OSError:
            pass


def logger(verbose=True):
    check_dirs()

    log = logging.getLogger("vlink")
    log.setLevel(logging.DEBUG if verbose else logging.WARNING)
    log.propagate = False

    # Reset handlers to avoid duplicates if logger() is called again
    if log.handlers:
        log.handlers.clear()

    # Archive any previous logfile.txt before creating a fresh one
    _enforce_archive_limits()

    # New current logfile
    file_handler = logging.FileHandler(LOG_FILE, mode="w")
    file_handler.setLevel(logging.DEBUG if verbose else logging.WARNING)
    file_format = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
    file_handler.setFormatter(file_format)
    log.addHandler(file_handler)

    if verbose:
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.DEBUG)
        console_format = logging.Formatter('%(levelname)s - %(message)s')
        console_handler.setFormatter(console_format)
        log.addHandler(console_handler)

    # Fresh boot diagnostics; archives previous bootlog into OLD_LOG_DIR
    collect_boot_diagnostics()

    return log
