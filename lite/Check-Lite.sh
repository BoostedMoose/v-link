#!/usr/bin/env bash

# Read-only health check for a V-Link Raspberry Pi OS Lite installation.

set -uo pipefail

TARGET_USER="${SUDO_USER:-${USER:-}}"
PRE_REBOOT=false
FAILURES=0
WARNINGS=0

usage() {
    cat <<'EOF'
Usage: ./Check-Lite.sh [--user USER] [--pre-reboot]

Checks the operating system, graphical session, V-Link installation, Python
environment, audio stack and optional HAT configuration without changing them.
EOF
}

while (($#)); do
    case "$1" in
        --user)
            (($# >= 2)) || { printf 'Missing value for --user\n' >&2; exit 2; }
            TARGET_USER="$2"
            shift
            ;;
        --pre-reboot)
            PRE_REBOOT=true
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            printf 'Unknown option: %s\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
    shift
done

pass() {
    printf '  [PASS] %s\n' "$*"
}

warn() {
    WARNINGS=$((WARNINGS + 1))
    printf '  [WARN] %s\n' "$*"
}

fail() {
    FAILURES=$((FAILURES + 1))
    printf '  [FAIL] %s\n' "$*"
}

check_command() {
    if command -v "$1" >/dev/null 2>&1; then
        pass "command available: $1"
    else
        fail "missing command: $1"
    fi
}

if [[ $EUID -ne 0 ]]; then
    printf 'Run this health check with sudo.\n' >&2
    exit 2
fi

[[ -n "$TARGET_USER" ]] || { printf 'Could not determine the kiosk user. Use --user USER.\n' >&2; exit 2; }
if ! id "$TARGET_USER" >/dev/null 2>&1; then
    printf "User '%s' does not exist.\n" "$TARGET_USER" >&2
    exit 2
fi

TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_FILE="$TARGET_HOME/.config/systemd/user/v-link.service"
CONFIGURED_APP_DIR="$(sed -n 's/^WorkingDirectory=//p' "$SERVICE_FILE" 2>/dev/null | tail -n 1)"
if [[ -n "$CONFIGURED_APP_DIR" && -f "$CONFIGURED_APP_DIR/V-Link.py" ]]; then
    APP_DIR="$CONFIGURED_APP_DIR"
elif [[ -f "$SCRIPT_DIR/V-Link.py" ]]; then
    APP_DIR="$SCRIPT_DIR"
else
    APP_DIR="$TARGET_HOME/v-link"
fi
USER_ID="$(id -u "$TARGET_USER")"
USER_GROUP_ID="$(id -g "$TARGET_USER")"
RUNTIME_DIR="/run/user/$USER_ID"
MODEL="unknown"

printf '\nV-Link Lite health check\n'
printf 'User: %s\nApplication: %s\n\n' "$TARGET_USER" "$APP_DIR"

printf 'Base system\n'
if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
    if [[ "${VERSION_CODENAME:-}" == bookworm ]]; then
        pass "Raspberry Pi OS/Debian Bookworm detected"
    else
        fail "expected Bookworm, detected ${VERSION_CODENAME:-unknown}"
    fi
else
    fail "/etc/os-release is unavailable"
fi

if [[ -r /proc/device-tree/model ]]; then
    MODEL="$(tr -d '\0' </proc/device-tree/model)"
    if [[ "$MODEL" =~ Raspberry\ Pi\ [345] ]]; then
        pass "$MODEL"
    else
        fail "unsupported model: $MODEL"
    fi
else
    warn "Raspberry Pi model cannot be read"
fi

for command_name in chromium labwc wtype swayidle wlr-randr foot swaybg lightdm pipewire wireplumber wpctl pw-dump pw-record nmcli udiskie udisksctl; do
    check_command "$command_name"
done
if python3 -c 'from PIL import Image' >/dev/null 2>&1 && command -v rsvg-convert >/dev/null 2>&1; then
    pass "Lite splash renderer dependencies are available"
else
    warn "python3-pil or rsvg-convert is missing; installed splash still works, but regeneration needs them"
fi
if runuser -u "$TARGET_USER" -- python3 -c 'import curses' >/dev/null 2>&1; then
    pass "Python curses is available for the persistent Lite Setup interface"
else
    fail "Python curses is unavailable for Lite Setup"
fi
FOOT_VERSION="$(dpkg-query -W -f='${Version}' foot 2>/dev/null || true)"
if [[ -n "$FOOT_VERSION" ]] && dpkg --compare-versions "$FOOT_VERSION" ge 1.13.1; then
    pass "foot $FOOT_VERSION supports the Lite Setup window options"
else
    fail "foot 1.13.1 or newer is required for the Lite Setup window"
fi
if command -v nmtui >/dev/null 2>&1; then
    pass "nmtui is available for network configuration"
else
    warn "nmtui is unavailable; the Network summary still works"
fi

for helper in /usr/local/libexec/v-link-lite-boot /usr/local/libexec/v-link-lite-overlay /usr/local/libexec/v-link-lite-prepare-splash /usr/local/libexec/v-link-lite-render-splash /usr/local/libexec/v-link-lite-session /usr/local/bin/v-link-lite-setup /usr/local/bin/v-link-lite-cursor; do
    if [[ -f "$helper" && -x "$helper" ]] && \
       [[ "$(stat -c '%u:%g' "$helper")" == '0:0' ]] && \
       [[ "$(stat -c '%a' "$helper")" == 755 ]]; then
        pass "$helper is installed root:root 0755"
    else
        fail "$helper is missing or has incorrect ownership/mode"
    fi
done
if [[ -x /usr/bin/labwc ]]; then
    pass "/usr/bin/labwc is available to the Lite session launcher"
else
    fail "missing executable: /usr/bin/labwc"
fi
if [[ -f /usr/local/libexec/v-link-lite-session && \
      ! -L /usr/local/libexec/v-link-lite-session ]] && \
   bash -n /usr/local/libexec/v-link-lite-session >/dev/null 2>&1 && \
   grep -qFx 'export WLR_SCENE_DISABLE_VISIBILITY=1' /usr/local/libexec/v-link-lite-session && \
   grep -qFx 'exec /usr/bin/labwc' /usr/local/libexec/v-link-lite-session; then
    pass "V-Link Lite session enables the wlroots visibility workaround"
else
    fail "V-Link Lite session launcher is invalid"
fi
if [[ -f /usr/local/libexec/v-link-lite-boot ]] && \
   bash -n /usr/local/libexec/v-link-lite-boot >/dev/null 2>&1; then
    pass "Lite boot gate shell syntax is valid"
else
    fail "Lite boot gate shell syntax is invalid"
fi
if python3 -c 'import gi; gi.require_version("Gtk", "3.0"); gi.require_version("GtkLayerShell", "0.1"); from gi.repository import Gtk, GtkLayerShell' >/dev/null 2>&1; then
    pass "GTK layer-shell is available for the Lite splash overlay"
else
    fail "GTK layer-shell is unavailable"
fi
if [[ -f /usr/local/libexec/v-link-lite-overlay && -f /usr/local/libexec/v-link-lite-prepare-splash && \
      -f /usr/local/libexec/v-link-lite-render-splash ]] && \
   python3 -c 'import ast, pathlib; [ast.parse(pathlib.Path(p).read_text()) for p in ("/usr/local/libexec/v-link-lite-overlay", "/usr/local/libexec/v-link-lite-prepare-splash", "/usr/local/libexec/v-link-lite-render-splash")]' >/dev/null 2>&1; then
    pass "Lite splash helpers have valid Python syntax"
else
    fail "Lite splash helpers are unavailable or invalid"
fi
if [[ -f /usr/local/share/v-link-lite/handoff.js ]] && \
   [[ "$(stat -c '%u:%g:%a' /usr/local/share/v-link-lite/handoff.js)" == '0:0:644' ]]; then
    pass "Lite splash handoff script is installed root:root 0644"
else
    fail "Lite splash handoff script is missing or unsafe"
fi
if [[ -f /usr/local/share/v-link-lite/terminal.bashrc && \
      ! -L /usr/local/share/v-link-lite/terminal.bashrc ]] && \
   [[ "$(stat -c '%u:%g:%a' /usr/local/share/v-link-lite/terminal.bashrc)" == '0:0:644' ]] && \
   grep -qF '_v_link_lite_help()' /usr/local/share/v-link-lite/terminal.bashrc && \
   grep -qF 'exit          Return to V-Link Lite Setup' /usr/local/share/v-link-lite/terminal.bashrc && \
   [[ -f /usr/local/lib/v-link-lite/setup/terminal.py && \
      ! -L /usr/local/lib/v-link-lite/setup/terminal.py ]] && \
   grep -qFx 'TERMINAL_RC = "/usr/local/share/v-link-lite/terminal.bashrc"' \
       /usr/local/lib/v-link-lite/setup/terminal.py; then
    pass "Lite maintenance terminal help is installed root:root 0644"
else
    fail "Lite maintenance terminal help is missing or unsafe"
fi
if [[ -f /usr/local/libexec/v-link-lite-boot ]] && \
   grep -Fq 's|S)' /usr/local/libexec/v-link-lite-boot && \
   grep -Fq '/usr/local/bin/v-link-lite-setup --startup' /usr/local/libexec/v-link-lite-boot && \
   grep -Fq 'read -r -s -n 1 -t 1 key' /usr/local/libexec/v-link-lite-boot && \
   grep -Fq -- '--override=colors.alpha=0' /usr/local/libexec/v-link-lite-boot; then
    pass "transparent boot gate offers the hidden Settings shortcut"
else
    fail "boot gate branding or Settings shortcut is missing"
fi
for splash_asset in \
    /usr/local/share/v-link-lite/logo.png \
    /usr/local/share/v-link-lite/splash.png; do
    if [[ -s "$splash_asset" && ! -L "$splash_asset" ]] && \
       [[ "$(stat -c '%u:%g:%a' "$splash_asset")" == '0:0:644' ]]; then
        pass "Lite splash asset is installed: $splash_asset"
    else
        fail "Lite splash asset is missing or unsafe: $splash_asset"
    fi
done
if grep -qsFx "$TARGET_USER ALL=(root) NOPASSWD: /usr/local/libexec/v-link-lite-render-splash --refresh-installed --width * --height *" \
      /etc/sudoers.d/v-link-lite; then
    pass "Lite splash renderer has restricted sudo permission"
else
    fail "Lite splash renderer sudo permission is missing"
fi
if [[ -f /boot/firmware/config.txt ]] && \
   grep -qFx '# BEGIN V-LINK LITE SPLASH' /boot/firmware/config.txt && \
   grep -qFx 'disable_splash=1' /boot/firmware/config.txt && \
   awk '/^# BEGIN V-LINK LITE SPLASH$/ { inside=1; next } /^# END V-LINK LITE SPLASH$/ { inside=0 } inside && /^auto_initramfs=1$/ { old_hook=1 } END { exit old_hook ? 1 : 0 }' /boot/firmware/config.txt && \
   grep -qFx '# END V-LINK LITE SPLASH' /boot/firmware/config.txt; then
    pass "firmware rainbow is disabled without changing initramfs selection"
else
    fail "V-Link Lite firmware splash configuration is missing"
fi
if [[ -f /boot/firmware/cmdline.txt ]] && \
   ! grep -Eq '(^| )(splash|fullscreen_logo=1|fullscreen_logo_name=logo.tga)( |$)' /boot/firmware/cmdline.txt; then
    pass "kernel command line has no V-Link splash hooks"
else
    fail "kernel command line still requests the old splash hooks"
fi
if [[ -f /usr/local/bin/v_link_lite_support.py ]] && \
   [[ "$(stat -c '%u:%g:%a' /usr/local/bin/v_link_lite_support.py)" == '0:0:644' ]]; then
    pass "Lite support module is installed root:root 0644"
else
    fail "Lite support module is missing or has incorrect owner/mode"
fi
if [[ -f /usr/local/bin/v_link_lite_audio.py && ! -L /usr/local/bin/v_link_lite_audio.py ]] && \
   [[ "$(stat -c '%u:%g:%a' /usr/local/bin/v_link_lite_audio.py)" == '0:0:644' ]] && \
   python3 -c 'import ast; ast.parse(open("/usr/local/bin/v_link_lite_audio.py", encoding="utf-8").read())' >/dev/null 2>&1; then
    pass "Lite microphone helper is installed and valid"
else
    fail "Lite microphone helper is missing, unsafe, or invalid"
fi
if compgen -G '/usr/lib/*/spa-0.2/aec/libspa-aec-webrtc.so' >/dev/null && \
   compgen -G '/usr/lib/*/pipewire-0.3/libpipewire-module-echo-cancel.so' >/dev/null; then
    pass "local WebRTC AEC and PipeWire echo-cancel modules are installed"
elif [[ -f "$TARGET_HOME/.config/pipewire/pipewire.conf.d/90-v-link-microphone.conf" ]]; then
    fail "Lite microphone processing is configured but its local AEC module is missing"
else
    warn "local AEC module is missing; microphone processing is Off"
fi
MICROPHONE_CONFIG="$TARGET_HOME/.config/pipewire/pipewire.conf.d/90-v-link-microphone.conf"
if [[ -f /usr/local/bin/v_link_lite_audio.py ]] && \
   runuser -u "$TARGET_USER" -- env XDG_CONFIG_HOME="$TARGET_HOME/.config" python3 -c \
      'import sys; sys.path.insert(0,"/usr/local/bin"); from v_link_lite_audio import validate_installed_config; validate_installed_config(sys.argv[1])' \
      "$TARGET_HOME" >/dev/null 2>&1; then
    if [[ -e "$MICROPHONE_CONFIG" ]]; then
        pass "Lite PipeWire microphone fragment is valid and private"
    else
        pass "Lite microphone processing is Off (no managed PipeWire fragment)"
    fi
else
    fail "Lite PipeWire microphone fragment is invalid or unsafe"
fi
SETTINGS_DIR="$TARGET_HOME/.config/v-link-lite"
SETTINGS_FILE="$SETTINGS_DIR/settings.conf"
if [[ -d "$SETTINGS_DIR" && ! -L "$SETTINGS_DIR" ]] && \
   [[ "$(stat -c '%u:%g:%a' "$SETTINGS_DIR")" == "$USER_ID:$USER_GROUP_ID:700" ]]; then
    pass "Lite settings directory is user-owned and private"
else
    fail "Lite settings directory is missing or has incorrect owner/mode"
fi
if [[ -f "$SETTINGS_FILE" && ! -L "$SETTINGS_FILE" ]] && \
   [[ "$(stat -c '%u:%g:%a' "$SETTINGS_FILE")" == "$USER_ID:$USER_GROUP_ID:600" ]] && \
   runuser -u "$TARGET_USER" -- env XDG_CONFIG_HOME="$TARGET_HOME/.config" python3 -c \
       'import sys; sys.path.insert(0,"/usr/local/bin"); from v_link_lite_support import load_settings; load_settings(sys.argv[1])' \
       "$TARGET_HOME" >/dev/null 2>&1; then
    pass "Lite settings (including display mode/output) are safe and valid"
else
    fail "Lite settings or display mode/output are missing, unsafe, or invalid"
fi
if [[ -f /usr/local/bin/v-link-lite-cursor ]] && \
   runuser -u "$TARGET_USER" -- python3 -c \
       'import ast, pathlib; ast.parse(pathlib.Path("/usr/local/bin/v-link-lite-cursor").read_text())' >/dev/null 2>&1; then
    pass "Lite cursor helper syntax is valid"
else
    fail "Lite cursor helper is unavailable or invalid"
fi
if [[ -f /usr/local/bin/v_link_lite_display.py && ! -L /usr/local/bin/v_link_lite_display.py ]] && \
   [[ "$(stat -c '%u:%g:%a' /usr/local/bin/v_link_lite_display.py)" == '0:0:755' ]] && \
   runuser -u "$TARGET_USER" -- python3 -c \
       'import ast, pathlib; ast.parse(pathlib.Path("/usr/local/bin/v_link_lite_display.py").read_text(encoding="utf-8"))' >/dev/null 2>&1; then
    pass "Lite display helper is installed root:root 0755 and valid"
else
    fail "Lite display helper is missing, unsafe, or invalid"
fi
if [[ -f /usr/local/bin/v-link-lite-setup ]] && \
   runuser -u "$TARGET_USER" -- python3 -c \
       'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))' \
       /usr/local/bin/v-link-lite-setup >/dev/null 2>&1; then
    pass "Lite Setup Python syntax is valid"
else
    fail "Lite Setup Python syntax is invalid"
fi
SETUP_MODULE_DIR=/usr/local/lib/v-link-lite/setup
SETUP_MODULES_OK=true
if [[ ! -d "$SETUP_MODULE_DIR" || -L "$SETUP_MODULE_DIR" ]] || \
   [[ "$(stat -c '%u:%g:%a' "$SETUP_MODULE_DIR" 2>/dev/null)" != '0:0:755' ]]; then
    SETUP_MODULES_OK=false
fi
for setup_module in __init__.py ui.py navigation.py network.py audio.py display.py storage.py vlink.py diagnostics.py terminal.py; do
    setup_path="$SETUP_MODULE_DIR/$setup_module"
    if [[ ! -f "$setup_path" || -L "$setup_path" ]] || \
       [[ "$(stat -c '%u:%g:%a' "$setup_path" 2>/dev/null)" != '0:0:644' ]]; then
        SETUP_MODULES_OK=false
    fi
done
if [[ "$SETUP_MODULES_OK" == true ]] && \
   runuser -u "$TARGET_USER" -- python3 -c \
       'import sys; sys.path[:0] = ["/usr/local/lib/v-link-lite", "/usr/local/bin"]; from setup.audio import AudioMixin; from setup.diagnostics import DiagnosticsMixin; from setup.display import DisplayMixin; from setup.navigation import NavigationMixin; from setup.network import NetworkMixin; from setup.storage import StorageMixin; from setup.terminal import TerminalMixin; from setup.ui import BaseUI; from setup.vlink import VLinkMixin' \
       >/dev/null 2>&1; then
    pass "Lite Setup modular package is installed root-owned and importable"
else
    fail "Lite Setup modular package is missing, unsafe, or not importable"
fi

for package_name in udisks2 udiskie; do
    if [[ "$(dpkg-query -W -f='${Status}' "$package_name" 2>/dev/null)" == 'install ok installed' ]]; then
        pass "$package_name is installed"
    else
        fail "$package_name is not installed"
    fi
done

if command -v udiskie >/dev/null 2>&1 && UDISKIE_HELP="$(udiskie --help 2>&1)"; then
    pass "udiskie --help runs successfully"
    for flag in --no-config --automount --no-notify --no-tray --no-file-manager --no-terminal --no-password-prompt; do
        if grep -Fq -- "$flag" <<<"$UDISKIE_HELP"; then
            pass "udiskie supports $flag"
        else
            fail "udiskie does not support $flag"
        fi
    done
else
    fail "udiskie --help is unavailable"
fi

if command -v labwc >/dev/null 2>&1; then
    LABWC_VERSION="$(labwc --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"
    if [[ -n "$LABWC_VERSION" ]] && dpkg --compare-versions "$LABWC_VERSION" ge 0.8.4; then
        pass "labwc $LABWC_VERSION supports HideCursor"
    else
        fail "labwc must be version 0.8.4 or newer for HideCursor (detected: ${LABWC_VERSION:-unknown})"
    fi
fi

if [[ "$(systemctl get-default 2>/dev/null)" == graphical.target ]]; then
    pass "default boot target is graphical.target"
else
    fail "default boot target is not graphical.target"
fi

if systemctl is-enabled --quiet lightdm.service; then
    pass "LightDM is enabled"
else
    fail "LightDM is not enabled"
fi

if grep -qsE '^dtoverlay=vc4-kms-v3d([,[:space:]]|$)' /boot/firmware/config.txt; then
    pass "VC4 KMS graphics overlay is configured"
else
    fail "VC4 KMS graphics overlay is not configured"
fi

if [[ "$PRE_REBOOT" == true ]]; then
    warn "runtime display checks deferred until reboot"
elif systemctl is-active --quiet lightdm.service; then
    pass "LightDM is running"
else
    fail "LightDM is not running"
fi

if [[ -f /usr/share/wayland-sessions/labwc.desktop ]]; then
    pass "LightDM labwc session is installed"
else
    fail "missing /usr/share/wayland-sessions/labwc.desktop"
fi
if [[ -f /usr/share/wayland-sessions/v-link-lite.desktop && \
      ! -L /usr/share/wayland-sessions/v-link-lite.desktop ]] && \
   [[ "$(stat -c '%u:%g:%a' /usr/share/wayland-sessions/v-link-lite.desktop)" == '0:0:644' ]] && \
   grep -qFx '[Desktop Entry]' /usr/share/wayland-sessions/v-link-lite.desktop && \
   grep -qFx 'Exec=/usr/local/libexec/v-link-lite-session' /usr/share/wayland-sessions/v-link-lite.desktop && \
   grep -qFx 'Type=Application' /usr/share/wayland-sessions/v-link-lite.desktop; then
    pass "V-Link Lite Wayland session is installed"
else
    fail "V-Link Lite Wayland session is missing or invalid"
fi
if [[ -f /usr/share/wayland-sessions/labwc.desktop ]]; then
    if grep -qsFx 'Exec=/usr/local/bin/v-link-labwc-visibility-test' \
          /usr/share/wayland-sessions/labwc.desktop; then
        fail "packaged labwc session still points to the experimental V-Link wrapper"
    else
        pass "packaged labwc session is not redirected by V-Link"
    fi
fi

LABWC_RC="$TARGET_HOME/.config/labwc/rc.xml"
LABWC_AUTOSTART="$TARGET_HOME/.config/labwc/autostart"
MOUSE_SETTING="$(runuser -u "$TARGET_USER" -- env XDG_CONFIG_HOME="$TARGET_HOME/.config" python3 -c \
    'import sys; sys.path.insert(0,"/usr/local/bin"); from v_link_lite_support import load_settings; print(load_settings(sys.argv[1])["MOUSE_ENABLED"])' \
    "$TARGET_HOME" 2>/dev/null || true)"
if [[ -f "$LABWC_RC" ]]; then
    pass "labwc rc.xml is installed"
    if python3 - "$LABWC_RC" "$MOUSE_SETTING" <<'PY'
import sys
import xml.etree.ElementTree as ET

try:
    root = ET.parse(sys.argv[1]).getroot()
except (ET.ParseError, OSError):
    raise SystemExit(1)

if root.tag != 'labwc_config':
    raise SystemExit(1)

for binding in root.findall('./keyboard/keybind'):
    actions = binding.findall('action')
    if (binding.get('key') == 'A-W-h'
            and len(actions) == 2
            and actions[0].get('name') == 'HideCursor'
            and actions[1].get('name') == 'WarpCursor'
            and actions[1].get('x') == '-1'
            and actions[1].get('y') == '-1'):
        disabled = root.findall('./libinput/device')
        categories = {device.get('category') for device in disabled
                      if device.findtext('sendEventsMode') == 'no'}
        mouse_off = sys.argv[2] == 'no'
        if mouse_off and categories != {'non-touch', 'touchpad'}:
            raise SystemExit(1)
        if not mouse_off and disabled:
            raise SystemExit(1)
        required = ('F1', 'F5', 'F11', 'F12', 'Menu', 'S-F10', 'A-F4', 'A-Tab',
                    'A-Space', 'A-f', 'A-e', 'C-w', 'C-t', 'C-l', 'C-S-j')
        keybinds = {item.get('key'): item for item in root.findall('./keyboard/keybind')}
        for key in required:
            blocker = keybinds.get(key)
            if blocker is None or len(blocker.findall('action')) != 1:
                raise SystemExit(1)
            action = blocker.find('action')
            if action.get('name') != 'Execute' or action.get('command') != '/usr/bin/true':
                raise SystemExit(1)
        for context, buttons in (('Frame', ('Right',)),
                                 ('Root', ('Left', 'Middle', 'Right'))):
            for button in buttons:
                blocker = root.find(f'./mouse/context[@name="{context}"]/mousebind[@button="{button}"][@action="Press"]/action')
                if blocker is None or blocker.get('name') != 'Execute' or blocker.get('command') != '/usr/bin/true':
                    raise SystemExit(1)
        if root.find('./mouse/default') is not None:
            raise SystemExit(1)
        raise SystemExit(0)
raise SystemExit(1)
PY
    then
        pass "labwc cursor policy and Chromium shortcut blockers are valid"
    else
        fail "labwc rc.xml is invalid or missing cursor/kiosk bindings"
    fi
    if runuser -u "$TARGET_USER" -- test -r "$LABWC_RC"; then
        pass "$TARGET_USER can read labwc rc.xml"
    else
        fail "$TARGET_USER cannot read labwc rc.xml"
    fi
    if [[ ! -L "$LABWC_RC" ]] && \
       [[ "$(stat -c '%u:%g:%a' "$LABWC_RC")" == "$USER_ID:$USER_GROUP_ID:644" ]]; then
        pass "labwc rc.xml is user-owned 0644"
    else
        fail "labwc rc.xml has incorrect owner or mode"
    fi
else
    fail "missing $LABWC_RC"
fi
IDLE_UNIT="$TARGET_HOME/.config/systemd/user/v-link-lite-cursor-idle.service"
if [[ -f "$IDLE_UNIT" ]] && \
   [[ "$(stat -c '%u:%g:%a' "$IDLE_UNIT")" == "$USER_ID:$USER_GROUP_ID:644" ]] && \
   grep -Fq 'ExecStart=/usr/bin/swayidle -C /dev/null -w timeout 5 "/usr/local/bin/v-link-lite-cursor hide"' "$IDLE_UNIT"; then
    pass "one managed event-driven cursor idle service is installed"
else
    fail "cursor idle service is missing or invalid"
fi
SETUP_UNIT="$TARGET_HOME/.config/systemd/user/v-link-lite-setup.service"
if [[ -f "$SETUP_UNIT" && ! -L "$SETUP_UNIT" ]] && \
   [[ "$(stat -c '%u:%g:%a' "$SETUP_UNIT")" == "$USER_ID:$USER_GROUP_ID:644" ]] && \
   grep -Fq 'ExecStart=/usr/bin/foot --fullscreen --font=monospace:size=16 "--title=V-Link Lite Setup" --app-id=v-link-lite-setup /usr/local/bin/v-link-lite-setup' "$SETUP_UNIT" && \
   [[ ! -L "$TARGET_HOME/.config/systemd/user/default.target.wants/v-link-lite-setup.service" ]]; then
    pass "on-demand Lite Setup window is installed and not enabled at login"
else
    fail "on-demand Lite Setup window is missing or invalid"
fi
if [[ -f "$LABWC_AUTOSTART" ]] && ! grep -Eq '^[[:space:]]*(wtype|swayidle)[[:space:]]' "$LABWC_AUTOSTART"; then
    pass "labwc autostart has no duplicate cursor process or shortcut"
else
    fail "labwc autostart duplicates cursor policy"
fi

if [[ -f "$LABWC_AUTOSTART" ]] && awk '
    /^[[:space:]]*systemctl[[:space:]]+--user[[:space:]]+import-environment[[:space:]]/ { if (!imported) imported = NR }
    /^[[:space:]]*\/usr\/local\/bin\/v-link-lite-cursor apply/ { policy++; applied = NR }
    /^[[:space:]]*systemctl[[:space:]]+--user[[:space:]]+start[[:space:]]+v-link[.]service([[:space:]]|$)/ { if (!started) started = NR }
    END { exit !(imported && policy == 1 && applied > imported && started > applied) }
' "$LABWC_AUTOSTART"; then
    pass "labwc autostart applies cursor policy once before V-Link starts"
else
    fail "labwc autostart is missing the ordered cursor policy"
fi
if [[ -f "$LABWC_AUTOSTART" ]] && awk '
    /^[[:space:]]*systemctl[[:space:]]+--user[[:space:]]+import-environment[[:space:]]/ { imported = NR }
    /^\/usr\/local\/bin\/v_link_lite_display[.]py apply/ { display++; applied = NR }
    /^\/usr\/local\/bin\/v_link_lite_display[.]py refresh-splash/ { refresh++; refreshed = NR }
    /^if \/usr\/local\/libexec\/v-link-lite-boot; then$/ { gate = NR }
    /^[[:space:]]*systemctl[[:space:]]+--user[[:space:]]+start[[:space:]]+v-link[.]service &$/ { started = NR }
    END { exit !(imported && display == 1 && applied > imported && refresh == 1 &&
                  refreshed > applied && gate > refreshed && started > gate) }
' "$LABWC_AUTOSTART"; then
    pass "labwc applies the display policy and refreshes the matching splash before V-Link"
else
    fail "labwc autostart is missing the ordered display or splash policy"
fi
if [[ -f "$LABWC_AUTOSTART" ]] && awk '
    /^[[:space:]]*systemctl[[:space:]]+--user[[:space:]]+import-environment[[:space:]]/ { imported = NR }
    /^\/usr\/local\/bin\/v_link_lite_display[.]py refresh-splash/ { refreshed = NR }
    /^swaybg -i \/usr\/local\/share\/v-link-lite\/splash[.]png -m center -c 000000 &$/ { background = NR }
    /^udiskie --no-config --automount --no-notify --no-tray --no-file-manager --no-terminal --no-password-prompt &$/ { automounter = NR }
    /^if \/usr\/local\/libexec\/v-link-lite-boot; then$/ { gate = NR }
    /^[[:space:]]*if \/usr\/local\/libexec\/v-link-lite-prepare-splash; then$/ { prepared = NR }
    /^[[:space:]]*\/usr\/local\/libexec\/v-link-lite-overlay &$/ { overlay = NR }
    /^[[:space:]]*if \[\[ -f "\$overlay_ready" \]\] && kill -0 "\$overlay_pid"/ { mapped = NR }
    /^[[:space:]]*\/usr\/local\/bin\/v-link-lite-cursor apply/ { policy = NR }
    /^[[:space:]]*systemctl[[:space:]]+--user[[:space:]]+start[[:space:]]+v-link[.]service &$/ { starts++; started = NR }
    /^fi$/ { if (gate && NR > gate) closed = NR }
    END { exit !(imported && refreshed > imported && background > refreshed && automounter > background && gate > automounter &&
                  prepared > gate && overlay > prepared && mapped > overlay && policy > mapped &&
                  started > policy && closed > started && starts == 1) }
' "$LABWC_AUTOSTART"; then
    pass "labwc maps the splash overlay before the single V-Link service start"
else
    fail "labwc boot gate or splash overlay is missing, unordered, or bypassed"
fi
if [[ -f "$LABWC_AUTOSTART" ]] && runuser -u "$TARGET_USER" -- test -x "$LABWC_AUTOSTART"; then
    pass "$TARGET_USER can execute labwc autostart"
else
    fail "$TARGET_USER cannot execute labwc autostart"
fi

UDISKIE_START='udiskie --no-config --automount --no-notify --no-tray --no-file-manager --no-terminal --no-password-prompt &'
if [[ -f "$LABWC_AUTOSTART" ]] && grep -Fxq "$UDISKIE_START" "$LABWC_AUTOSTART" && awk '
    /^[[:space:]]*systemctl[[:space:]]+--user[[:space:]]+import-environment[[:space:]]/ { imported = NR }
    /^udiskie --no-config --automount --no-notify --no-tray --no-file-manager --no-terminal --no-password-prompt &$/ { automounter = NR }
    /^[[:space:]]*systemctl[[:space:]]+--user[[:space:]]+start[[:space:]]+v-link[.]service([[:space:]]|$)/ { started = NR }
    END { exit !(imported && automounter > imported && started > automounter) }
' "$LABWC_AUTOSTART"; then
    pass "labwc starts udiskie before V-Link in the kiosk session"
else
    fail "labwc autostart is missing the ordered, headless udiskie launch"
fi
if [[ -f "$LABWC_AUTOSTART" ]] && \
   [[ "$(stat -c '%u:%g' "$LABWC_AUTOSTART")" == "$USER_ID:$USER_GROUP_ID" ]] && \
   [[ "$(stat -c '%a' "$LABWC_AUTOSTART")" == 755 ]]; then
    pass "labwc autostart owner and mode are correct"
else
    fail "labwc autostart owner or mode is incorrect"
fi
if [[ -f "$LABWC_AUTOSTART" ]] && \
   ! grep -Eq '^[[:space:]]*(sudo[[:space:]]+)?(/usr/bin/)?mount([[:space:]]|$)|^[[:space:]]*udiskie[[:space:]].*(/dev/|/home/|/media/|/run/media/)' "$LABWC_AUTOSTART"; then
    pass "labwc automount has no manual mount command, device, or hardcoded user"
else
    fail "labwc automount contains a manual mount command, device, or hardcoded user"
fi

if [[ "$PRE_REBOOT" == true ]]; then
    warn "UDisks and udiskie runtime checks deferred until reboot"
else
    if systemctl is-active --quiet udisks2.service; then
        pass "UDisks daemon is active"
    else
        fail "UDisks daemon is not active"
    fi
    if pgrep -u "$TARGET_USER" -f '(^|[[:space:]])(/usr/bin/)?udiskie([[:space:]]|$)' >/dev/null 2>&1; then
        pass "udiskie is running as $TARGET_USER"
    else
        fail "udiskie is not running as $TARGET_USER"
    fi
fi

if [[ -f /etc/udev/rules.d/41-v-link-carplay.rules ]]; then
    pass "CarPlay dongle USB permissions are installed"
else
    fail "missing CarPlay dongle USB permissions"
fi

WEBUSB_POLICY=/etc/chromium/policies/managed/v-link-webusb.json
if [[ -f "$WEBUSB_POLICY" ]] && \
   grep -qs '"WebUsbAllowDevicesForUrls"' "$WEBUSB_POLICY" && \
   grep -qs '"http://localhost:4001"' "$WEBUSB_POLICY"; then
    pass "Chromium automatically authorizes supported dongles for V-Link"
else
    fail "missing or invalid V-Link Chromium WebUSB policy"
fi

for required_group in audio video render input; do
    if id -nG "$TARGET_USER" | tr ' ' '\n' | grep -qx "$required_group"; then
        pass "$TARGET_USER belongs to $required_group"
    else
        fail "$TARGET_USER is missing group $required_group"
    fi
done

if grep -qs "^autologin-user=$TARGET_USER$" /etc/lightdm/lightdm.conf.d/50-v-link-lite.conf; then
    pass "graphical autologin targets $TARGET_USER"
else
    fail "graphical autologin is not configured for $TARGET_USER"
fi
for session_setting in user-session=v-link-lite autologin-session=v-link-lite; do
    if grep -qs "^$session_setting$" /etc/lightdm/lightdm.conf.d/50-v-link-lite.conf; then
        pass "LightDM has $session_setting"
    else
        fail "LightDM is missing $session_setting"
    fi
done

if [[ "$PRE_REBOOT" == true ]]; then
    warn "active V-Link Lite session environment check deferred until reboot"
else
    LABWC_PID="$(pgrep -u "$TARGET_USER" -o -x labwc 2>/dev/null || true)"
    if [[ -n "$LABWC_PID" ]] && \
       tr '\0' '\n' <"/proc/$LABWC_PID/environ" 2>/dev/null | \
           grep -qFx 'WLR_SCENE_DISABLE_VISIBILITY=1'; then
        pass "running labwc has the wlroots visibility workaround"
    elif [[ -n "$LABWC_PID" ]]; then
        fail "running labwc lacks WLR_SCENE_DISABLE_VISIBILITY=1; reboot into v-link-lite"
    else
        fail "cannot verify the V-Link Lite environment because labwc is not running"
    fi
fi

printf '\nApplication\n'
if [[ -r "$APP_DIR/backend/shared/lite_console.py" ]] && \
   grep -qs 'from backend.shared.lite_console import build_payload' "$APP_DIR/V-Link.py" && \
   grep -qs '_write_lite_console_snapshot' "$APP_DIR/V-Link.py"; then
    pass "V-Link Console snapshot producer is installed"
else
    fail "V-Link Console snapshot producer is missing"
fi
for required_path in \
    "$APP_DIR/V-Link.py" \
    "$APP_DIR/Check-Lite.sh" \
    "$APP_DIR/Update.sh" \
    "$APP_DIR/backend/server.py" \
    "$APP_DIR/updater/__init__.py" \
    "$APP_DIR/updater/releases.py" \
    "$APP_DIR/updater/keepalive.py" \
    "$APP_DIR/frontend/dist/index.html" \
    "$APP_DIR/.v-link-lite-runtime" \
    "$APP_DIR/venv/bin/python" \
    "$TARGET_HOME/.local/libexec/v-link-recover-update" \
    "$TARGET_HOME/.config/systemd/user/v-link.service" \
    "$TARGET_HOME/.config/labwc/autostart"; do
    if [[ -e "$required_path" ]]; then
        pass "found $required_path"
    else
        fail "missing $required_path"
    fi
done
for executable_path in \
    "$APP_DIR/V-Link.py" \
    "$APP_DIR/Update.sh" \
    "$APP_DIR/Check-Lite.sh"; do
    [[ -e "$executable_path" ]] || continue
    if [[ -x "$executable_path" ]]; then
        pass "executable: $executable_path"
    else
        fail "not executable: $executable_path"
    fi
done
if grep -qF '<!-- BEGIN V-LINK LITE SPLASH HANDOFF -->' "$APP_DIR/frontend/dist/index.html" 2>/dev/null && \
   grep -qF '127.0.0.1:40777/ready' "$APP_DIR/frontend/dist/index.html" 2>/dev/null && \
   grep -qF '<!-- END V-LINK LITE SPLASH HANDOFF -->' "$APP_DIR/frontend/dist/index.html" 2>/dev/null; then
    pass "Lite-only splash handoff is installed in the built HTML"
else
    fail "Lite-only splash handoff is missing from the built HTML"
fi

if grep -qsF "ExecStartPre=$TARGET_HOME/.local/libexec/v-link-recover-update $APP_DIR" \
    "$TARGET_HOME/.config/systemd/user/v-link.service"; then
    pass "interrupted updates are recovered before V-Link starts"
else
    fail "v-link.service is missing interrupted-update recovery"
fi
if grep -qsFx "WorkingDirectory=$APP_DIR" "$SERVICE_FILE" && \
   grep -qsF "ExecStart=$APP_DIR/venv/bin/python $APP_DIR/V-Link.py" "$SERVICE_FILE"; then
    pass "v-link.service has the expected working directory and runtime command"
else
    fail "v-link.service is missing the expected working directory or runtime command"
fi
if [[ -L "$TARGET_HOME/.config/systemd/user/default.target.wants/v-link.service" ]]; then
    fail "v-link.service is enabled outside the labwc boot gate"
else
    pass "v-link.service is not independently enabled at user login"
fi
if [[ "$PRE_REBOOT" == true ]]; then
    warn "user service unit verification deferred until the user session exists"
elif [[ ! -S "$RUNTIME_DIR/bus" ]]; then
    fail "user session bus is unavailable; cannot verify v-link.service"
elif ! command -v systemd-analyze >/dev/null 2>&1; then
    fail "systemd-analyze is unavailable; cannot verify v-link.service"
else
    VERIFY_OUTPUT="$(runuser -u "$TARGET_USER" -- env \
        "XDG_RUNTIME_DIR=$RUNTIME_DIR" \
        "DBUS_SESSION_BUS_ADDRESS=unix:path=$RUNTIME_DIR/bus" \
        systemd-analyze --user --recursive-errors=no verify "$SERVICE_FILE" 2>&1)"
    if [[ $? -eq 0 ]]; then
        pass "v-link.service unit syntax is valid"
    else
        fail "v-link.service unit verification failed"
        printf '    %s\n' "$VERIFY_OUTPUT"
    fi
fi

if [[ -x "$APP_DIR/venv/bin/python" ]]; then
    if runuser -u "$TARGET_USER" -- "$APP_DIR/venv/bin/python" -m pip check >/dev/null 2>&1; then
        pass "Python dependency consistency check"
    else
        fail "pip check reports inconsistent Python dependencies"
    fi

    if runuser -u "$TARGET_USER" -- sh -c \
        'cd "$1" && exec "$2" -c "$3"' \
        sh "$APP_DIR" "$APP_DIR/venv/bin/python" \
        'import flask, flask_socketio, can, serial, eventlet, lgpio, uinput, board, busio; import adafruit_ads1x15.ads1115' \
        >/dev/null 2>&1; then
        pass "core Python modules import correctly"
    else
        fail "one or more core Python modules cannot be imported"
    fi

    if runuser -u "$TARGET_USER" -- sh -c \
        'cd "$1" && exec "$2" "$1/V-Link.py" --help' \
        sh "$APP_DIR" "$APP_DIR/venv/bin/python" >/dev/null 2>&1; then
        pass "V-Link loads its complete Python import graph"
    else
        fail "V-Link fails during startup imports"
    fi
fi

NO_HARDWARE_RUNTIME=false
if grep -qs -- '--no-hardware' "$TARGET_HOME/.config/systemd/user/v-link.service"; then
    NO_HARDWARE_RUNTIME=true
    pass "v-link.service uses UI-only no-hardware mode"
else
    pass "v-link.service uses the physical hardware runtime"
fi

if [[ "$NO_HARDWARE_RUNTIME" == true ]]; then
    if ! systemctl is-enabled --quiet v-link-can.service 2>/dev/null && \
       ! systemctl is-active --quiet v-link-can.service 2>/dev/null; then
        pass "system CAN setup is disabled in UI-only mode"
    else
        fail "v-link-can.service must be disabled in UI-only mode"
    fi
    if ! grep -qsFx '# BEGIN V-LINK LITE' /boot/firmware/config.txt; then
        pass "V-Link HAT boot overlays are disabled in UI-only mode"
    else
        fail "V-Link HAT boot configuration remains active in UI-only mode"
    fi
fi

LIN_PORT="$(sed -n 's/^Environment=VLINK_LIN_PORT=//p' "$TARGET_HOME/.config/systemd/user/v-link.service" 2>/dev/null | tail -n 1)"
if [[ -n "$LIN_PORT" ]]; then
    if [[ "$LIN_PORT" =~ ^/dev/[A-Za-z0-9._/+:-]+$ ]]; then
        pass "external LIN port is configured: $LIN_PORT"
    else
        fail "configured LIN port is not a safe /dev path"
    fi
fi

if [[ "$PRE_REBOOT" != true && -S "$RUNTIME_DIR/bus" ]]; then
    USER_ENV=(env "XDG_RUNTIME_DIR=$RUNTIME_DIR" "DBUS_SESSION_BUS_ADDRESS=unix:path=$RUNTIME_DIR/bus")
    if runuser -u "$TARGET_USER" -- "${USER_ENV[@]}" systemctl --user is-active --quiet v-link.service; then
        pass "v-link.service is running"
        MAIN_PID="$(runuser -u "$TARGET_USER" -- "${USER_ENV[@]}" systemctl --user show v-link.service -p MainPID --value 2>/dev/null || true)"
        if [[ "$MAIN_PID" =~ ^[1-9][0-9]*$ ]] && \
           runuser -u "$TARGET_USER" -- python3 -c \
             'import sys; sys.path.insert(0,"/usr/local/bin"); from v_link_lite_support import read_snapshot; raise SystemExit(0 if read_snapshot(int(sys.argv[1]), int(sys.argv[2])) else 1)' \
             "$USER_ID" "$MAIN_PID" >/dev/null 2>&1; then
            pass "V-Link Console runtime snapshot is fresh and private"
        else
            warn "V-Link Console snapshot is unavailable or stale"
        fi
    else
        fail "v-link.service is not running"
    fi

    if runuser -u "$TARGET_USER" -- "${USER_ENV[@]}" wpctl status >/dev/null 2>&1; then
        pass "PipeWire audio graph is available"
    else
        fail "PipeWire audio graph is unavailable"
    fi

    if runuser -u "$TARGET_USER" -- "${USER_ENV[@]}" wpctl get-volume @DEFAULT_AUDIO_SINK@ >/dev/null 2>&1; then
        pass "a default PipeWire audio output is selected"
    else
        fail "no default PipeWire audio output is selected"
    fi

    USER_MANAGER_ENV="$(runuser -u "$TARGET_USER" -- "${USER_ENV[@]}" systemctl --user show-environment 2>/dev/null || true)"
    if grep -q '^WAYLAND_DISPLAY=' <<<"$USER_MANAGER_ENV" && \
       grep -q '^XDG_SESSION_TYPE=wayland$' <<<"$USER_MANAGER_ENV"; then
        pass "the user service manager has the Wayland environment"
        WAYLAND_DISPLAY_VALUE="$(sed -n 's/^WAYLAND_DISPLAY=//p' <<<"$USER_MANAGER_ENV" | tail -n 1)"
        EFFECTIVE_SIZE="$(runuser -u "$TARGET_USER" -- "${USER_ENV[@]}" \
            "WAYLAND_DISPLAY=$WAYLAND_DISPLAY_VALUE" "XDG_CONFIG_HOME=$TARGET_HOME/.config" \
            /usr/local/bin/v_link_lite_display.py current-size 2>/dev/null || true)"
        SPLASH_SIZE="$(python3 -c 'from PIL import Image; image=Image.open("/usr/local/share/v-link-lite/splash.png"); print(f"{image.width}x{image.height}")' 2>/dev/null || true)"
        if [[ -n "$EFFECTIVE_SIZE" && "$SPLASH_SIZE" == "$EFFECTIVE_SIZE" ]]; then
            pass "Lite splash matches the effective display resolution ($EFFECTIVE_SIZE)"
        else
            fail "Lite splash resolution ($SPLASH_SIZE) does not match the effective display ($EFFECTIVE_SIZE)"
        fi
    else
        fail "the user service manager is missing its Wayland environment"
    fi
elif [[ "$PRE_REBOOT" != true ]]; then
    fail "user runtime bus is unavailable at $RUNTIME_DIR/bus"
else
    warn "V-Link Console runtime snapshot check deferred until reboot"
fi

if [[ "$PRE_REBOOT" != true ]]; then
    if compgen -G '/dev/dri/card*' >/dev/null; then
        pass "DRM/KMS display device is present"
    else
        fail "no /dev/dri/card* display device is present"
    fi
fi

if [[ "$PRE_REBOOT" == true ]]; then
    warn "Chromium and HTTP checks deferred until reboot"
else
    if pgrep -u "$TARGET_USER" -x chromium >/dev/null 2>&1; then
        pass "Chromium kiosk process is running"
    else
        fail "Chromium kiosk process is not running"
    fi

    HTTP_HEADERS="$(curl --fail --silent --show-error --max-time 3 --dump-header - --output /dev/null http://localhost:4001/ 2>/dev/null || true)"
    if [[ -n "$HTTP_HEADERS" ]]; then
        pass "V-Link frontend responds on http://localhost:4001"
        if grep -qi '^Cross-Origin-Opener-Policy: *same-origin' <<<"$HTTP_HEADERS" && \
           grep -qi '^Cross-Origin-Embedder-Policy: *require-corp' <<<"$HTTP_HEADERS"; then
            pass "frontend enables cross-origin isolation for CarPlay audio"
        else
            fail "frontend is missing COOP/COEP headers required by shared audio buffers"
        fi
    else
        fail "V-Link frontend does not respond on port 4001"
    fi

    SOCKETS_4001="$(ss -ltnH 2>/dev/null | grep -E '(^|[[:space:]])(127\.0\.0\.1|0\.0\.0\.0|\[::\]):4001([[:space:]]|$)' || true)"
    if grep -q '127\.0\.0\.1:4001' <<<"$SOCKETS_4001" && \
       ! grep -Eq '(0\.0\.0\.0|\[::\]):4001' <<<"$SOCKETS_4001"; then
        pass "backend port 4001 is restricted to localhost"
    else
        fail "backend port 4001 is not listening only on localhost"
    fi

    UNTRUSTED_STATUS="$(curl --silent --output /dev/null --max-time 3 \
        --write-out '%{http_code}' \
        --header 'Origin: https://attacker.invalid' \
        'http://localhost:4001/socket.io/?EIO=4&transport=polling' || true)"
    if [[ "$UNTRUSTED_STATUS" == 400 || "$UNTRUSTED_STATUS" == 403 ]]; then
        pass "Socket.IO rejects untrusted browser origins"
    else
        fail "Socket.IO accepted an untrusted browser origin (HTTP $UNTRUSTED_STATUS)"
    fi
fi

if grep -qsFx '# BEGIN V-LINK LITE' /boot/firmware/config.txt; then
    printf '\nV-Link HAT\n'
    BEGIN_COUNT="$(grep -cFx '# BEGIN V-LINK LITE' /boot/firmware/config.txt || true)"
    END_COUNT="$(grep -cFx '# END V-LINK LITE' /boot/firmware/config.txt || true)"
    if [[ "$BEGIN_COUNT" -eq 1 && "$END_COUNT" -eq 1 ]]; then
        pass "V-Link boot configuration block is complete"
    else
        fail "V-Link boot configuration block is incomplete or duplicated"
    fi

    for config_line in \
        'dtparam=spi=on' \
        'dtparam=i2c_arm=on' \
        'enable_uart=1' \
        'disable_poe_fan=1' \
        'force_eeprom_read=0' \
        'dtoverlay=v-link,cs2_spidev=off' \
        'dtoverlay=mcp2515-can1,oscillator=16000000,interrupt=24' \
        'dtoverlay=mcp2515-can2,oscillator=16000000,interrupt=22' \
        'dtoverlay=gpio-poweroff,gpiopin=0'; do
        if grep -qsFx "$config_line" /boot/firmware/config.txt; then
            pass "boot config: $config_line"
        else
            fail "missing boot config: $config_line"
        fi
    done

    case "$MODEL" in
        *"Raspberry Pi 3"*)
            GENERATION_CONFIG='dtoverlay=disable-bt'
            SERIAL_CONSOLES='serial0|ttyAMA0|ttyS0'
            EXPECTED_UART=/dev/serial0
            ;;
        *"Raspberry Pi 4"*)
            GENERATION_CONFIG='dtoverlay=uart3'
            SERIAL_CONSOLES='serial0|ttyAMA3|ttyS0'
            EXPECTED_UART=/dev/ttyAMA3
            ;;
        *"Raspberry Pi 5"*)
            GENERATION_CONFIG='dtoverlay=uart2-pi5'
            SERIAL_CONSOLES='serial0|ttyAMA0|ttyAMA2'
            EXPECTED_UART=/dev/ttyAMA2
            ;;
        *)
            GENERATION_CONFIG=''
            SERIAL_CONSOLES='serial0|ttyAMA[0-9]+|ttyS0'
            EXPECTED_UART=''
            ;;
    esac
    if [[ -n "$GENERATION_CONFIG" ]] && grep -qsFx "$GENERATION_CONFIG" /boot/firmware/config.txt; then
        pass "generation-specific boot config: $GENERATION_CONFIG"
    else
        fail "missing generation-specific UART configuration"
    fi
    if [[ "$MODEL" == *"Raspberry Pi 5"* ]]; then
        if grep -qsFx 'dtparam=uart0=on' /boot/firmware/config.txt; then
            pass "Pi 5 UART0 is enabled"
        else
            fail "Pi 5 UART0 is not enabled"
        fi
    fi

    if grep -qsFx 'uinput' /etc/modules-load.d/v-link.conf && \
       grep -qsFx 'i2c-dev' /etc/modules-load.d/v-link.conf; then
        pass "uinput and i2c-dev are configured for boot"
    else
        fail "uinput or i2c-dev is missing from modules-load configuration"
    fi

    for required_group in plugdev dialout gpio i2c spi; do
        if id -nG "$TARGET_USER" | tr ' ' '\n' | grep -qx "$required_group"; then
            pass "$TARGET_USER belongs to $required_group"
        else
            fail "$TARGET_USER is missing hardware group $required_group"
        fi
    done
    for overlay in v-link.dtbo mcp2515-can1.dtbo mcp2515-can2.dtbo; do
        if [[ -f "/boot/firmware/overlays/$overlay" ]]; then
            pass "installed overlay: $overlay"
        else
            fail "missing overlay: $overlay"
        fi
    done

    if systemctl is-enabled --quiet v-link-can.service; then
        pass "v-link-can.service is enabled"
    else
        fail "v-link-can.service is not enabled"
    fi
    if [[ -x /usr/local/sbin/v-link-can-up && -x /usr/local/sbin/v-link-can-set ]]; then
        pass "CAN naming and profile-bitrate helpers are installed"
    else
        fail "a V-Link CAN helper is missing or not executable"
    fi
    if grep -qsF '/usr/local/sbin/v-link-can-set can1 125000 can2 250000' /etc/sudoers.d/v-link-lite && \
       grep -qsF '/usr/local/sbin/v-link-can-set can1 125000 can2 500000' /etc/sudoers.d/v-link-lite; then
        pass "CAN bitrate helper has restricted sudo permissions"
    else
        fail "CAN bitrate helper sudo permissions are incomplete"
    fi

    if grep -Eq "(^| )console=($SERIAL_CONSOLES)," /boot/firmware/cmdline.txt; then
        fail "serial console still owns a V-Link UART"
    else
        pass "serial console is disabled"
    fi

    if [[ "$PRE_REBOOT" == true ]]; then
        warn "CAN, UART and uinput device checks deferred until reboot"
    else
        if systemctl is-active --quiet v-link-can.service; then
            pass "v-link-can.service is active"
        else
            fail "v-link-can.service is not active"
        fi
        if [[ "$(basename -- "$(readlink -f /sys/class/net/can1/device 2>/dev/null || true)")" == spi0.1 ]]; then
            pass "can1 maps to physical SPI device spi0.1"
        else
            fail "can1 does not map to physical SPI device spi0.1"
        fi
        if [[ "$(basename -- "$(readlink -f /sys/class/net/can2/device 2>/dev/null || true)")" == spi0.2 ]]; then
            pass "can2 maps to physical SPI device spi0.2"
        else
            fail "can2 does not map to physical SPI device spi0.2"
        fi
        USER_CAN_CONFIG="$TARGET_HOME/.config/v-link/can.json"
        if [[ -f "$USER_CAN_CONFIG" ]]; then
            CONFIGURED_CAN2_BITRATE="$(python3 - "$USER_CAN_CONFIG" <<'PY' 2>/dev/null || true
import json
import sys

with open(sys.argv[1], encoding='utf-8') as config_file:
    config = json.load(config_file)

for interface in config.get('interfaces', []):
    if interface.get('channel') == 'can2':
        print(int(interface['bitrate']))
        break
PY
)"
            if [[ "$CONFIGURED_CAN2_BITRATE" == 250000 || "$CONFIGURED_CAN2_BITRATE" == 500000 ]]; then
                EXPECTED_CAN2_BITRATE="$CONFIGURED_CAN2_BITRATE"
            else
                fail "saved profile has an invalid can2 bitrate"
                EXPECTED_CAN2_BITRATE=""
            fi
            for interface in can1 can2; do
                if ip -details link show "$interface" 2>/dev/null | grep -qE '<[^>]*UP[^>]*>'; then
                    pass "$interface is present and UP"
                else
                    fail "$interface is missing or DOWN after profile selection"
                fi
            done
            if ip -details link show can1 2>/dev/null | grep -q 'bitrate 125000'; then
                pass "can1 bitrate is 125000"
            else
                fail "can1 bitrate is not 125000"
            fi
            if [[ -n "$EXPECTED_CAN2_BITRATE" ]] && \
               ip -details link show can2 2>/dev/null | grep -q "bitrate $EXPECTED_CAN2_BITRATE"; then
                pass "can2 bitrate matches the profile: $EXPECTED_CAN2_BITRATE"
            else
                fail "can2 bitrate does not match the saved profile"
            fi
        else
            for interface in can1 can2; do
                if ip link show "$interface" >/dev/null 2>&1 && \
                   ! ip link show "$interface" | grep -qE '<[^>]*UP[^>]*>'; then
                    pass "$interface is present and safely DOWN until a profile is selected"
                else
                    fail "$interface must remain DOWN until a vehicle profile is selected"
                fi
            done
        fi
        if [[ -e /dev/uinput ]] && runuser -u "$TARGET_USER" -- test -w /dev/uinput; then
            pass "$TARGET_USER can write to /dev/uinput"
        else
            fail "/dev/uinput is missing or not writable by $TARGET_USER"
        fi
        if [[ -e /dev/i2c-1 ]]; then
            pass "/dev/i2c-1 is present"
        else
            fail "/dev/i2c-1 is missing"
        fi
        if [[ -n "$EXPECTED_UART" && -e "$EXPECTED_UART" ]]; then
            pass "V-Link serial device is present: $EXPECTED_UART"
        else
            fail "V-Link serial device is missing: $EXPECTED_UART"
        fi
        if [[ -n "$LIN_PORT" ]]; then
            if [[ -e "$LIN_PORT" ]] && runuser -u "$TARGET_USER" -- test -r "$LIN_PORT" && \
               runuser -u "$TARGET_USER" -- test -w "$LIN_PORT"; then
                pass "$TARGET_USER can access the external LIN port: $LIN_PORT"
            else
                fail "external LIN port is missing or inaccessible: $LIN_PORT"
            fi
        fi
    fi

    if [[ "$MODEL" == *"Raspberry Pi 3"* ]]; then
        if systemctl is-enabled --quiet hciuart.service 2>/dev/null; then
            fail "hciuart is still enabled and can claim the Pi 3 RTI UART"
        else
            pass "hciuart is disabled for the Pi 3 RTI UART"
        fi
        warn "Pi 3 integrated Bluetooth is unavailable"
        if [[ -z "$LIN_PORT" ]]; then
            warn "Pi 3 simultaneous RTI + LIN SWC requires --lin-port with an external USB-UART"
        fi
    fi
fi

printf '\nResult: %d failure(s), %d warning(s)\n' "$FAILURES" "$WARNINGS"
if ((FAILURES)); then
    exit 1
fi
