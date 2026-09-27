#!/bin/sh
# A standalone entry point so a downgraded app can still install newer releases.
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ -f "$APP_DIR/.v-link-lite-runtime" ]; then
    echo "In-app and standalone updates are temporarily disabled on V-Link Lite while transactional platform migration is being completed." >&2
    echo "Use Install-Lite.sh to upgrade this installation." >&2
    exit 1
fi

if [ ! -f "$APP_DIR/updater/releases.py" ]; then
    echo "V-Link updater files are missing. Run Update.sh from an installed V-Link directory containing updater/." >&2
    exit 1
fi

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

restart_known_good() {
    cleanup
    trap - EXIT INT TERM
    if [ -x "$APP_DIR/../.local/libexec/v-link-launch" ]; then
        exec "$APP_DIR/../.local/libexec/v-link-launch"
    fi
    exec "$PYTHON" "$APP_DIR/V-Link.py"
}

# Install the stable user-space recovery path before the transaction starts.
if [ -f "$APP_DIR/updater/launcher.py" ]; then
    if ! "$PYTHON" "$APP_DIR/updater/launcher.py" --install --app-dir "$APP_DIR"; then
        echo "Could not install the recovery-aware Desktop launcher." >&2
        restart_known_good
    fi
fi

if "$PYTHON" "$APP_DIR/updater/releases.py" --app-dir "$APP_DIR" "$@"; then
    echo "Update completed. Rebooting..."
    cleanup
    trap - EXIT INT TERM
    sudo reboot
else
    echo "Update failed or was cancelled. The installed app was kept."
    echo "Restarting the known-good V-Link installation..."
    restart_known_good
fi
