#!/bin/sh
# A standalone entry point so a downgraded app can still install newer releases.
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
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

if "$PYTHON" "$APP_DIR/updater/releases.py" --app-dir "$APP_DIR" "$@"; then
    # Run the system setup of the release that was just installed.
    if [ -f "$APP_DIR/updater/system.py" ]; then
        echo "Updating system components..."
        if ! sudo python3 -I "$APP_DIR/updater/system.py" --apply; then
            echo "System components were not fully updated, see above. The app update is installed."
            sleep 30
        fi
    fi
    echo "Update completed. Rebooting..."
    cleanup
    trap - EXIT INT TERM
    sudo reboot
else
    echo "Update failed or was cancelled. The installed app was kept."
    if [ "${1:-}" = "--release-id" ]; then
        # The app quit for this update; bring it back once the error could be read.
        echo "Starting V-Link again in 30 seconds..."
        sleep 30
        setsid "$PYTHON" "$APP_DIR/V-Link.py" >/dev/null 2>&1 &
    else
        echo "If the app closed for this update, reboot or run: $PYTHON $APP_DIR/V-Link.py"
    fi
    exit 1
fi
