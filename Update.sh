#!/bin/sh
# A standalone entry point so a downgraded app can still install newer releases.
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PYTHON="$APP_DIR/venv/bin/python"
[ -x "$PYTHON" ] || PYTHON=python3

# Keep the RTI controller awake while the app is stopped for an update.
KEEPALIVE_PID=
if [ -f /proc/device-tree/model ] && [ -f "$APP_DIR/updater/keepalive.py" ]; then
    "$PYTHON" "$APP_DIR/updater/keepalive.py" &
    KEEPALIVE_PID=$!
fi
cleanup() {
    if [ -n "$KEEPALIVE_PID" ]; then
        kill "$KEEPALIVE_PID" 2>/dev/null || true
        wait "$KEEPALIVE_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

if "$PYTHON" "$APP_DIR/updater/releases.py" --app-dir "$APP_DIR" "$@"; then
    echo "Update completed. Rebooting..."
    cleanup
    trap - EXIT INT TERM
    sudo reboot
else
    echo "Update failed or was cancelled. The installed app was kept."
    exit 1
fi
