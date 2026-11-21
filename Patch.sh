#!/bin/sh
# One-time migration of v3.1.0 and 3.2.x beta installations to the managed system setup.
# The v3.1.0 updater runs this file after unpacking a release; on a 3.2.x beta, run it once by hand.
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONFIG=/boot/firmware/config.txt
DELAY=3

echo "Migrating V-Link to the managed system setup..."

if [ -x "$APP_DIR/venv/bin/python" ]; then
    echo "Installing Python requirements..."
    "$APP_DIR/venv/bin/python" -m pip install -r "$APP_DIR/requirements.txt" || DELAY=60
fi

# Mark the old [V-LINK ...] block so system.py replaces it in a single write.
# Until then, config.txt keeps working exactly as before.
if grep -q '^\[V-LINK' "$CONFIG" && ! grep -q '^# >>> V-Link' "$CONFIG"; then
    start=$(grep -n '^\[V-LINK' "$CONFIG" | head -n 1 | cut -d: -f1)
    length=$(tail -n "+$start" "$CONFIG" | grep -n -m 1 '^disable_splash=1' | cut -d: -f1)
    if [ "$(grep -c '^\[V-LINK' "$CONFIG")" = 1 ] && [ -n "$length" ] && [ "$length" -le 40 ]; then
        sudo cp "$CONFIG" "${CONFIG%/*}/config.backup"
        sudo sed -i -e "$((start + length - 1))a # <<< V-Link <<<" \
            -e "${start}i # >>> V-Link (managed, do not edit) >>>" "$CONFIG"
    else
        echo "Could not identify the old V-Link block in $CONFIG."
        echo "Remove it by hand, from the [V-LINK line to disable_splash=1, then run:"
        echo "  sudo python3 -I $APP_DIR/updater/system.py --apply"
        DELAY=60
    fi
fi

echo "Updating system components..."
sudo python3 -I "$APP_DIR/updater/system.py" --apply || DELAY=60

if [ "$DELAY" -gt 3 ]; then
    echo "Some steps need attention, see above. Rebooting in $DELAY seconds; press Ctrl+C to stay."
fi
sleep "$DELAY"
sudo reboot
