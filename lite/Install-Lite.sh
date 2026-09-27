#!/usr/bin/env bash

# V-Link installer for Raspberry Pi OS Lite (Bookworm)
# https://github.com/BoostedMoose/v-link

set -Eeuo pipefail

readonly DEFAULT_REPOSITORY="BoostedMoose/v-link"
readonly APP_NAME="v-link"
readonly CONFIG_BEGIN="# BEGIN V-LINK LITE"
readonly CONFIG_END="# END V-LINK LITE"
readonly SPLASH_CONFIG_BEGIN="# BEGIN V-LINK LITE SPLASH"
readonly SPLASH_CONFIG_END="# END V-LINK LITE SPLASH"
readonly NODE_VERSION="v22.23.2"
readonly NODE_MIN_MINOR=12
readonly PYTHON_BUILD_PIP="24.3.1"
readonly PYTHON_BUILD_SETUPTOOLS="75.6.0"
readonly PYTHON_BUILD_WHEEL="0.45.1"
readonly SYSTEM_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
readonly LITE_SESSION_LAUNCHER="/usr/local/libexec/v-link-lite-session"
readonly LITE_SESSION_DESKTOP="/usr/share/wayland-sessions/v-link-lite.desktop"
readonly LIGHTDM_LITE_CONFIG="/etc/lightdm/lightdm.conf.d/50-v-link-lite.conf"
readonly EXPERIMENTAL_LABWC_DESKTOP="/usr/share/wayland-sessions/labwc.desktop"
readonly EXPERIMENTAL_VISIBILITY_WRAPPER="/usr/local/bin/v-link-labwc-visibility-test"
readonly EXPERIMENTAL_VISIBILITY_WRAPPER_GOOD="/usr/local/bin/v-link-labwc-visibility-test.good"

ASSUME_YES=false
CONFIGURE_HARDWARE=true
FIRST_BOOT_MODE=false
HARDWARE_CHOICE_EXPLICIT=false
SOURCE_CHOICE_EXPLICIT=false
REPOSITORY_EXPLICIT=false
REBOOT=true
REPOSITORY="$DEFAULT_REPOSITORY"
SOURCE_DIR=""
SOURCE_REF=""
LIN_PORT=""
TARGET_USER="${SUDO_USER:-}"
TEMP_DIR=""
SUDOERS_TEMP=""
BOOT_TEMP=""
CMDLINE_TEMP=""
VENV_WORK=""
NODE_TEMP=""
NODE_STAGE=""
NODE_BIN_DIR=""
NODE_BUILD_PATH=""
HELPER_STAGING=""
SPLASH_WORK=""
VENV_BACKUP=""
VENV_TRANSACTION=false
APP_TRANSACTION=false
APP_CHANGED_PATHS=()
PLATFORM_TRANSACTION=false
PLATFORM_BACKUP=""
PLATFORM_PATHS=()
HCIUART_TRACKED=false
HCIUART_ORIGINAL=""
HCIUART_EXPECTED=""
FRONTEND_BUILD_REQUIRED=false
FRONTEND_SOURCE_HASH=""
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
    local status=$?
    trap - EXIT ERR HUP INT TERM
    set +e

    if ((status != 0)); then
        if [[ "$PLATFORM_TRANSACTION" == true ]]; then
            rollback_platform_files
            rollback_hciuart_state
        fi
        if [[ -n "$VENV_BACKUP" && -d "$VENV_BACKUP" ]]; then
            rm -rf -- "$APP_DIR/venv"
            mv "$VENV_BACKUP" "$APP_DIR/venv"
        elif [[ "$VENV_TRANSACTION" == true && -n "${APP_DIR:-}" ]]; then
            rm -rf -- "$APP_DIR/venv"
        fi
        if [[ "$APP_TRANSACTION" == true ]]; then
            local index
            for ((index=${#APP_CHANGED_PATHS[@]} - 1; index >= 0; index--)); do
                restore_app_path "${APP_CHANGED_PATHS[index]}"
            done
        fi
    fi

    if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
        rm -rf -- "$TEMP_DIR"
    fi
    if [[ -n "$SUDOERS_TEMP" && -e "$SUDOERS_TEMP" ]]; then
        rm -f -- "$SUDOERS_TEMP"
    fi
    [[ -z "$BOOT_TEMP" || ! -e "$BOOT_TEMP" ]] || rm -f -- "$BOOT_TEMP"
    [[ -z "$CMDLINE_TEMP" || ! -e "$CMDLINE_TEMP" ]] || rm -f -- "$CMDLINE_TEMP"
    [[ -z "$VENV_WORK" || ! -d "$VENV_WORK" ]] || rm -rf -- "$VENV_WORK"
    [[ -z "$NODE_TEMP" || ! -d "$NODE_TEMP" ]] || rm -rf -- "$NODE_TEMP"
    [[ -z "$NODE_STAGE" || ! -d "$NODE_STAGE" ]] || rm -rf -- "$NODE_STAGE"
    [[ -z "$HELPER_STAGING" || ! -e "$HELPER_STAGING" ]] || rm -f -- "$HELPER_STAGING"
    [[ -z "$SPLASH_WORK" || ! -d "$SPLASH_WORK" ]] || rm -r -- "$SPLASH_WORK"
    [[ -z "$PLATFORM_BACKUP" || ! -d "$PLATFORM_BACKUP" ]] || rm -rf -- "$PLATFORM_BACKUP"

    exit "$status"
}
trap cleanup EXIT

platform_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d' ' -f1
    else
        shasum -a 256 "$1" | cut -d' ' -f1
    fi
}

platform_fingerprint() {
    local path="$1"
    if [[ -L "$path" ]]; then
        printf 'link:%s\n' "$(readlink -- "$path")"
    elif [[ -f "$path" ]]; then
        local mode
        mode="$(stat -c '%u:%g:%a' "$path" 2>/dev/null)" || mode="$(stat -f '%u:%g:%Lp' "$path")"
        printf 'file:%s:%s\n' "$mode" "$(platform_sha256 "$path")"
    elif [[ ! -e "$path" ]]; then
        printf 'absent\n'
    else
        printf 'other\n'
    fi
}

begin_platform_files() {
    local index path
    PLATFORM_BACKUP="$(mktemp -d /tmp/v-link-lite-platform.XXXXXX)"
    PLATFORM_PATHS=(
        /usr/local/bin/v_link_lite_support.py /usr/local/bin/v_link_lite_audio.py
        /usr/local/bin/v_link_lite_display.py
        /usr/local/bin/v-link-lite-setup /usr/local/bin/v-link-lite-cursor
        /usr/local/lib/v-link-lite/setup/__init__.py
        /usr/local/lib/v-link-lite/setup/ui.py
        /usr/local/lib/v-link-lite/setup/navigation.py
        /usr/local/lib/v-link-lite/setup/network.py
        /usr/local/lib/v-link-lite/setup/audio.py
        /usr/local/lib/v-link-lite/setup/display.py
        /usr/local/lib/v-link-lite/setup/storage.py
        /usr/local/lib/v-link-lite/setup/vlink.py
        /usr/local/lib/v-link-lite/setup/diagnostics.py
        /usr/local/lib/v-link-lite/setup/terminal.py
        /usr/local/libexec/v-link-lite-boot /usr/local/libexec/v-link-lite-overlay
        /usr/local/libexec/v-link-lite-prepare-splash /usr/local/libexec/v-link-lite-session
        /usr/local/libexec/v-link-lite-render-splash
        /usr/local/share/v-link-lite/handoff.js
        /usr/local/share/v-link-lite/terminal.bashrc /usr/local/share/v-link-lite/logo.png
        /usr/local/share/v-link-lite/splash.png
        /etc/udev/rules.d/41-v-link-carplay.rules
        /etc/udev/rules.d/42-v-link.rules /etc/modules-load.d/v-link.conf
        /etc/systemd/system/default.target
        /etc/systemd/system/display-manager.service
        /etc/systemd/system/graphical.target.wants/lightdm.service
        /etc/systemd/system/multi-user.target.wants/v-link-can.service
        /etc/systemd/system/serial-getty@serial0.service
        /etc/systemd/system/serial-getty@ttyAMA0.service
        /etc/systemd/system/serial-getty@ttyAMA2.service
        /etc/systemd/system/serial-getty@ttyAMA3.service
        /etc/systemd/system/serial-getty@ttyS0.service
        /etc/chromium/policies/managed/v-link-webusb.json
        /etc/lightdm/lightdm.conf.d/50-v-link-lite.conf
        /usr/share/wayland-sessions/v-link-lite.desktop
        /usr/share/wayland-sessions/labwc.desktop
        /usr/local/bin/v-link-labwc-visibility-test
        /usr/local/bin/v-link-labwc-visibility-test.good
        /etc/sudoers.d/v-link-lite /etc/systemd/system/v-link-can.service
        /usr/local/sbin/v-link-can-up /usr/local/sbin/v-link-can-set
        /boot/firmware/config.txt /boot/firmware/cmdline.txt
        /boot/firmware/overlays/v-link.dtbo
        /boot/firmware/overlays/mcp2515-can1.dtbo
        /boot/firmware/overlays/mcp2515-can2.dtbo
        "$TARGET_HOME/.local/libexec/v-link-recover-update"
        "$USER_CONFIG_DIR/systemd/user/v-link.service"
        "$USER_CONFIG_DIR/systemd/user/v-link-lite-cursor-idle.service"
        "$USER_CONFIG_DIR/systemd/user/v-link-lite-setup.service"
        "$USER_CONFIG_DIR/systemd/user/default.target.wants/v-link.service"
        "$USER_CONFIG_DIR/labwc/rc.xml" "$USER_CONFIG_DIR/labwc/autostart"
        "$USER_CONFIG_DIR/labwc/environment.d/90-v-link-direct-scanout-test.env"
        "$USER_CONFIG_DIR/v-link-lite/settings.conf"
    )
    for index in "${!PLATFORM_PATHS[@]}"; do
        path="${PLATFORM_PATHS[index]}"
        platform_fingerprint "$path" >"$PLATFORM_BACKUP/$index.original"
        if [[ -e "$path" || -L "$path" ]]; then
            [[ -f "$path" || -L "$path" ]] || die "managed platform path is not a file: $path"
            cp -a -- "$path" "$PLATFORM_BACKUP/$index"
        else
            : >"$PLATFORM_BACKUP/$index.absent"
        fi
    done
    PLATFORM_TRANSACTION=true
}

platform_path_index() {
    local wanted="$1" index
    for index in "${!PLATFORM_PATHS[@]}"; do
        if [[ "${PLATFORM_PATHS[index]}" == "$wanted" ]]; then
            printf '%s\n' "$index"
            return 0
        fi
    done
    return 1
}

platform_path_written() {
    local path="$1" index
    index="$(platform_path_index "$path")" || die "untracked Lite platform path: $path"
    platform_fingerprint "$path" >"$PLATFORM_BACKUP/$index.expected"
    : >"$PLATFORM_BACKUP/$index.written"
}

platform_paths_written() {
    local path
    for path in "$@"; do
        platform_path_written "$path"
    done
}

rollback_platform_files() {
    local index path current expected failed=0
    for ((index=${#PLATFORM_PATHS[@]} - 1; index >= 0; index--)); do
        path="${PLATFORM_PATHS[index]}"
        current="$(platform_fingerprint "$path")"
        if [[ "$current" == "$(<"$PLATFORM_BACKUP/$index.original")" ]]; then
            continue
        fi
        if [[ ! -f "$PLATFORM_BACKUP/$index.written" ]]; then
            printf '[V-Link Lite] WARNING: %s changed before an installer write was recorded; not overwriting it.\n' "$path" >&2
            failed=1
            continue
        fi
        expected="$(<"$PLATFORM_BACKUP/$index.expected")"
        if [[ "$current" != "$expected" ]]; then
            printf '[V-Link Lite] WARNING: %s changed after installation; not overwriting it.\n' "$path" >&2
            failed=1
            continue
        fi
        if [[ -f "$PLATFORM_BACKUP/$index.absent" ]]; then
            rm -f -- "$path" || failed=1
        else
            rm -f -- "$path" && cp -a -- "$PLATFORM_BACKUP/$index" "$path" || failed=1
        fi
    done
    systemctl daemon-reload >/dev/null 2>&1 || true
    udevadm control --reload-rules >/dev/null 2>&1 || true
    if ((failed)); then
        printf '[V-Link Lite] WARNING: platform rollback was partial; review the paths above.\n' >&2
    else
        printf '[V-Link Lite] Managed Lite platform files restored.\n' >&2
    fi
}

validate_lite_session_launcher() {
    local path="$1"
    [[ -f "$path" && ! -L "$path" && -x "$path" ]] && \
        bash -n "$path" >/dev/null 2>&1 && \
        grep -qFx 'export WLR_SCENE_DISABLE_VISIBILITY=1' "$path" && \
        grep -qFx 'exec /usr/bin/labwc' "$path"
}

validate_lite_session_desktop() {
    local path="$1"
    [[ -f "$path" && ! -L "$path" ]] && \
        grep -qFx '[Desktop Entry]' "$path" && \
        grep -qFx 'Name=V-Link Lite' "$path" && \
        grep -qFx 'Exec=/usr/local/libexec/v-link-lite-session' "$path" && \
        grep -qFx 'Type=Application' "$path" && \
        grep -qFx 'DesktopNames=labwc;wlroots' "$path"
}

validate_lite_lightdm_config() {
    local path="$1" user="$2"
    [[ -f "$path" && ! -L "$path" ]] && \
        grep -qFx "autologin-user=$user" "$path" && \
        grep -qFx 'user-session=v-link-lite' "$path" && \
        grep -qFx 'autologin-session=v-link-lite' "$path"
}

file_matches_exact_content() {
    local path="$1" expected="$2"
    [[ -f "$path" && ! -L "$path" ]] && cmp -s -- "$path" "$expected"
}

restore_known_experimental_labwc_desktop() {
    local path="$1" staging owner mode
    [[ -f "$path" && ! -L "$path" ]] || return 0
    grep -qFx 'Exec=/usr/local/bin/v-link-labwc-visibility-test' "$path" || return 0

    staging="$(mktemp "$(dirname -- "$path")/.labwc.desktop.v-link-new.XXXXXX")"
    sed 's|^Exec=/usr/local/bin/v-link-labwc-visibility-test$|Exec=labwc|' \
        "$path" >"$staging"
    owner="$(stat -c '%u:%g' "$path" 2>/dev/null)" || owner="$(stat -f '%u:%g' "$path")"
    mode="$(stat -c '%a' "$path" 2>/dev/null)" || mode="$(stat -f '%Lp' "$path")"
    chown "$owner" "$staging"
    chmod "$mode" "$staging"
    mv -f -- "$staging" "$path"
    platform_path_written "$path"
}

remove_known_experimental_file() {
    local path="$1" expected="$2"
    if file_matches_exact_content "$path" "$expected"; then
        rm -f -- "$path"
        platform_path_written "$path"
        return 0
    fi
    [[ ! -e "$path" && ! -L "$path" ]]
}

hciuart_snapshot() {
    local load_state unit_state active_state
    load_state="$(systemctl show hciuart.service --property=LoadState --value 2>/dev/null || true)"
    if [[ -z "$load_state" || "$load_state" == not-found ]]; then
        printf 'not-found|-|-\n'
        return
    fi
    unit_state="$(systemctl is-enabled hciuart.service 2>/dev/null || true)"
    active_state="$(systemctl is-active hciuart.service 2>/dev/null || true)"
    printf '%s|%s|%s\n' "$load_state" "${unit_state:-unknown}" "${active_state:-unknown}"
}

track_hciuart_state() {
    if [[ "$HCIUART_TRACKED" != true ]]; then
        HCIUART_ORIGINAL="$(hciuart_snapshot)"
        HCIUART_TRACKED=true
    fi
}

hciuart_state_written() {
    HCIUART_EXPECTED="$(hciuart_snapshot)"
}

restore_hciuart_snapshot() {
    local snapshot="$1" load_state unit_state active_state
    IFS='|' read -r load_state unit_state active_state <<<"$snapshot"
    [[ "$load_state" != not-found ]] || return 0

    case "$unit_state" in
        enabled|linked)
            systemctl unmask hciuart.service >/dev/null 2>&1 || true
            systemctl enable hciuart.service >/dev/null 2>&1 || true
            ;;
        enabled-runtime|linked-runtime)
            systemctl unmask hciuart.service >/dev/null 2>&1 || true
            systemctl enable --runtime hciuart.service >/dev/null 2>&1 || true
            ;;
        masked|masked-runtime)
            # Restore activity before reapplying the mask so the unusual but
            # valid masked+active state is not silently changed.
            systemctl unmask hciuart.service >/dev/null 2>&1 || true
            systemctl disable hciuart.service >/dev/null 2>&1 || true
            ;;
        disabled)
            systemctl unmask hciuart.service >/dev/null 2>&1 || true
            systemctl disable hciuart.service >/dev/null 2>&1 || true
            ;;
        *)
            # Static/indirect units cannot be enabled directly; only remove a
            # mask that the installer may have created.
            systemctl unmask hciuart.service >/dev/null 2>&1 || true
            ;;
    esac
    if [[ "$active_state" == active ]]; then
        systemctl start hciuart.service >/dev/null 2>&1 || true
    else
        systemctl stop hciuart.service >/dev/null 2>&1 || true
    fi
    case "$unit_state" in
        masked) systemctl mask hciuart.service >/dev/null 2>&1 || true ;;
        masked-runtime) systemctl mask --runtime hciuart.service >/dev/null 2>&1 || true ;;
    esac
}

rollback_hciuart_state() {
    local current
    [[ "$HCIUART_TRACKED" == true ]] || return 0
    current="$(hciuart_snapshot)"
    [[ "$current" != "$HCIUART_ORIGINAL" ]] || return 0
    if [[ -z "$HCIUART_EXPECTED" || "$current" != "$HCIUART_EXPECTED" ]]; then
        printf '[V-Link Lite] WARNING: hciuart changed after the installer update; not overwriting its state.\n' >&2
        return 0
    fi
    restore_hciuart_snapshot "$HCIUART_ORIGINAL"
    current="$(hciuart_snapshot)"
    if [[ "$current" == "$HCIUART_ORIGINAL" ]]; then
        printf '[V-Link Lite] Previous hciuart state restored.\n' >&2
    else
        printf '[V-Link Lite] WARNING: hciuart rollback was incomplete (wanted %s, found %s).\n' \
            "$HCIUART_ORIGINAL" "$current" >&2
    fi
}

usage() {
    cat <<'EOF'
Usage: sudo ./Install-Lite.sh [options]

Install V-Link on Raspberry Pi OS Lite (Bookworm) with a minimal Wayland
session, Chromium kiosk, mouse/touch input, PipeWire audio and optional HAT
support.

Options:
  --yes                 Non-interactive mode; accept defaults/prompts.
  --user USER           User that will run the kiosk (defaults to SUDO_USER).
  --repo OWNER/REPO     GitHub repository to use for releases and refs
                        (default: BoostedMoose/v-link).
  --source-dir PATH     Install application files from a local checkout.
  --ref REF             Download, build and install this Git branch or tag.
  --lin-port PATH       Serial device for LIN controls (for example a stable
                        /dev/serial/by-id/... USB-UART path on Pi 3).
  --hardware            Configure V-Link HAT/CAN/UART/GPIO without asking.
  --no-hardware         UI-only mode; skip overlays, CAN, UART, GPIO and udev.
  --no-reboot           Do not reboot when installation finishes.
  --first-boot          First-boot mode used by the prepared-SD launcher.
  -h, --help            Show this help.

Without --yes, the installer can select the official repository, the
PabloMartin97/v-link development fork or another OWNER/REPO, then install its
latest stable release, a branch/tag, or an available local checkout.

Examples:
  sudo ./Install-Lite.sh --yes
      Install the latest stable release from BoostedMoose/v-link.

  sudo ./Install-Lite.sh --repo PabloMartin97/v-link --yes
      Install the latest stable release available in the development fork.

  sudo ./Install-Lite.sh --repo PabloMartin97/v-link --ref Lite-os-for-pr
      Install the Lite-os-for-pr branch from the development fork.
EOF
}

log() {
    printf '\n[V-Link Lite] %s\n' "$*"
}

clear_screen() {
    local output=""
    if [[ -t 1 ]]; then
        output=/dev/stdout
    elif [[ -t 0 && -w /dev/tty ]]; then
        # First boot logs through tee, so stdout is a pipe while stdin still
        # owns the installer VT. Clear the real console without logging ANSI.
        output=/dev/tty
    else
        return 0
    fi

    if command -v tput >/dev/null 2>&1 && \
       [[ -n "${TERM:-}" && "${TERM:-}" != dumb ]]; then
        if tput clear >"$output" 2>/dev/null; then
            return 0
        fi
    fi
    printf '\033[2J\033[H' >"$output"
}

show_interactive_screen() {
    local title="$1"

    clear_screen
    printf '\n============================================================\n'
    printf '                    V-Link Lite Installer\n'
    printf '                    Setup — %s\n' "$title"
    printf '============================================================\n\n'
}

show_phase() {
    local step="$1"
    local total="$2"
    local title="$3"

    clear_screen
    printf '\n============================================================\n'
    printf '                    V-Link Lite Installer\n'
    printf '                    Step %s/%s — %s\n' "$step" "$total" "$title"
    printf '============================================================\n\n'
}

die() {
    printf '\n[V-Link Lite] ERROR: %s\n' "$*" >&2
    exit 1
}

validate_repository() {
    local repository="$1"
    local owner="${repository%%/*}"
    local name="${repository#*/}"

    [[ "$repository" == */* && "$owner" != "$repository" ]] || return 1
    [[ "$owner" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || return 1
    [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || return 1
    [[ "$name" != "." && "$name" != ".." ]] || return 1
}

node_is_compatible() {
    local node_command="$1"
    "$node_command" -e \
        "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= $NODE_MIN_MINOR ? 0 : 1)" \
        >/dev/null 2>&1
}

select_or_install_node() {
    local node_command="" npm_command="" node_dist_arch=""
    local node_archive="" node_base_url="" node_install_dir=""

    node_command="$(command -v node || true)"
    npm_command="$(command -v npm || true)"
    if [[ -n "$node_command" && -n "$npm_command" ]] && \
            node_is_compatible "$node_command" && "$npm_command" --version >/dev/null 2>&1; then
        NODE_BIN_DIR="$(dirname -- "$node_command")"
        NODE_BUILD_PATH="$NODE_BIN_DIR:$(dirname -- "$npm_command"):$SYSTEM_PATH"
    else
        case "$ARCHITECTURE" in
            arm64) node_dist_arch=arm64 ;;
            armhf) node_dist_arch=armv7l ;;
            *) die "Node.js $NODE_VERSION is unavailable for architecture '$ARCHITECTURE'" ;;
        esac

        node_archive="node-$NODE_VERSION-linux-$node_dist_arch.tar.xz"
        node_base_url="https://nodejs.org/dist/$NODE_VERSION"
        node_install_dir="/opt/v-link-node-$NODE_VERSION-$node_dist_arch"

        if [[ ! -x "$node_install_dir/bin/node" ]] || \
                ! node_is_compatible "$node_install_dir/bin/node" || \
                [[ ! -x "$node_install_dir/bin/npm" ]]; then
            log "Installing the verified Node.js $NODE_VERSION build for $node_dist_arch"
            NODE_TEMP="$(mktemp -d /tmp/v-link-node.XXXXXX)"
            curl --fail --show-error --location --retry 3 --connect-timeout 10 \
                --max-time 900 --speed-limit 1024 --speed-time 30 \
                "$node_base_url/$node_archive" --output "$NODE_TEMP/$node_archive"
            curl --fail --show-error --location --retry 3 --connect-timeout 10 \
                --max-time 120 --speed-limit 32 --speed-time 30 \
                "$node_base_url/SHASUMS256.txt" --output "$NODE_TEMP/SHASUMS256.txt"
            awk -v archive="$node_archive" '
                $2 == archive && length($1) == 64 && $1 !~ /[^[:xdigit:]]/ { print; found=1 }
                END { if (!found) exit 1 }
            ' "$NODE_TEMP/SHASUMS256.txt" >"$NODE_TEMP/SHASUMS256.selected" || \
                die "Node.js checksum list does not contain $node_archive"
            (cd "$NODE_TEMP" && sha256sum --check SHASUMS256.selected)

            NODE_STAGE="$(mktemp -d /opt/.v-link-node.XXXXXX)"
            tar -xJf "$NODE_TEMP/$node_archive" --strip-components=1 -C "$NODE_STAGE"
            node_is_compatible "$NODE_STAGE/bin/node" || \
                die "downloaded Node.js runtime does not satisfy 22.$NODE_MIN_MINOR or newer"
            [[ -x "$NODE_STAGE/bin/npm" ]] || die "downloaded Node.js runtime has no npm executable"
            rm -rf -- "$node_install_dir"
            mv "$NODE_STAGE" "$node_install_dir"
            NODE_STAGE=""
            rm -rf -- "$NODE_TEMP"
            NODE_TEMP=""
        fi

        # mktemp creates a new staging directory as root with mode 0700. Also
        # repair a managed runtime left by an older installer before reusing it.
        # The frontend build itself deliberately runs as TARGET_USER.
        chmod -R a+rX "$node_install_dir"
        NODE_BIN_DIR="$node_install_dir/bin"
        NODE_BUILD_PATH="$NODE_BIN_DIR:$SYSTEM_PATH"
    fi

    runuser -u "$TARGET_USER" -- env PATH="$NODE_BUILD_PATH" node -e \
        "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= $NODE_MIN_MINOR ? 0 : 1)" || \
        die "the selected Node.js runtime is not available to user '$TARGET_USER'"
    runuser -u "$TARGET_USER" -- env PATH="$NODE_BUILD_PATH" npm --version >/dev/null || \
        die "the selected npm runtime is not available to user '$TARGET_USER'"

    log "Node.js: $(runuser -u "$TARGET_USER" -- env PATH="$NODE_BUILD_PATH" node --version)"
    log "npm: $(runuser -u "$TARGET_USER" -- env PATH="$NODE_BUILD_PATH" npm --version)"
}

confirm() {
    local prompt="$1"
    if [[ "$ASSUME_YES" == true ]]; then
        return 0
    fi

    local reply
    read -r -p "$prompt [y/N]: " reply
    [[ "$reply" =~ ^[Yy]$ ]]
}

print_welcome() {
    show_interactive_screen "Network"
    cat <<'EOF'
This installer configures Raspberry Pi OS Lite as a dedicated
V-Link kiosk. You will be shown the source, hardware mode and
important system changes before anything is installed.
EOF
}

internet_available() {
    timeout 6 bash -c 'exec 3<>/dev/tcp/api.github.com/443' >/dev/null 2>&1
}

wait_for_internet() {
    local answer=""
    local first_attempt=true

    while true; do
        if [[ "$first_attempt" != true ]]; then
            show_interactive_screen "Network"
        fi
        cat <<'EOF'
Waiting for network...

  V-Link Lite downloads packages and, for development installs, source code
  directly from GitHub. Connect Ethernet or configure Wi-Fi before continuing.
EOF
        if internet_available; then
            printf '\nInternet connection OK.\n'
            return
        fi

        printf '\nNo Internet connection detected. Retrying automatically in 3 seconds.\n'
        if command -v nmtui >/dev/null 2>&1; then
            printf '  [Enter] Retry now   [N] Network/Wi-Fi settings   [Q] Quit\n'
        else
            printf '  [Enter] Retry now   [Q] Quit\n'
        fi
        answer=""
        if read -r -t 3 -p '> ' answer; then
            case "$answer" in
                [Nn])
                    if command -v nmtui >/dev/null 2>&1; then
                        nmtui
                    else
                        printf 'NetworkManager text UI is not available. Configure Wi-Fi in Raspberry Pi Imager or use Ethernet.\n'
                    fi
                    ;;
                [Qq]) die "installation cancelled; Internet is required" ;;
                *) ;;
            esac
        fi
        first_attempt=false
    done
}

cleanup_first_boot_stage() {
    log "Scheduling first-boot file cleanup for the next normal boot"
    systemctl disable v-link-firstboot.service >/dev/null 2>&1 || true
    systemctl disable v-link-firstboot-wait.service >/dev/null 2>&1 || true

    cat >/usr/local/sbin/v-link-firstboot-cleanup <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

    rm -f -- \
        /etc/systemd/system/v-link-firstboot.service \
        /etc/systemd/system/v-link-firstboot-wait.service \
        /usr/local/sbin/v-link-firstboot-installer \
        /usr/local/sbin/v-link-firstboot-user \
        /usr/local/sbin/v-link-firstboot-wait \
        /usr/local/libexec/v-link-install-lite
    rm -f -- \
        /boot/firmware/Install-Lite.sh \
        /boot/firmware/V-Link-FirstBoot.sh \
        /boot/firmware/v-link-firstboot.conf \
        /boot/Install-Lite.sh \
        /boot/V-Link-FirstBoot.sh \
        /boot/v-link-firstboot.conf
    # Keep /var/log/v-link-firstboot-installer.log as the durable record.
    # Boot-partition copies are only temporary after a confirmed success.
    rm -f -- \
        /boot/firmware/v-link-firstboot.log \
        /boot/firmware/v-link-firstboot-installer.log \
        /boot/v-link-firstboot.log \
        /boot/v-link-firstboot-installer.log
rm -f -- \
    /etc/systemd/system/multi-user.target.wants/v-link-firstboot-cleanup.service \
    /etc/systemd/system/v-link-firstboot-cleanup.service
systemctl daemon-reload || true

# This must be the final command: the helper may safely remove itself only
# after systemd has finished reading every preceding cleanup instruction.
exec rm -f -- "$0"
EOF
    chmod 0755 /usr/local/sbin/v-link-firstboot-cleanup

    cat >/etc/systemd/system/v-link-firstboot-cleanup.service <<'EOF'
[Unit]
Description=Remove the completed V-Link first-boot installer
After=local-fs.target
Before=lightdm.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/v-link-firstboot-cleanup

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable v-link-firstboot-cleanup.service >/dev/null
}

select_repository() {
    local choice=""
    local custom_repository=""

    show_interactive_screen "Repository"
    printf 'Choose V-Link repository:\n'
    printf '  1) BoostedMoose/v-link      [official]\n'
    printf '  2) PabloMartin97/v-link     [development fork]\n'
    printf '  3) Custom OWNER/REPO\n'

    while true; do
        read -r -p 'Selection [1]: ' choice
        [[ -n "$choice" ]] || choice=1
        case "$choice" in
            1) REPOSITORY="$DEFAULT_REPOSITORY"; return ;;
            2) REPOSITORY="PabloMartin97/v-link"; return ;;
            3)
                read -r -p 'GitHub repository (OWNER/REPO): ' custom_repository
                if validate_repository "$custom_repository"; then
                    REPOSITORY="$custom_repository"
                    return
                fi
                printf 'Invalid GitHub repository; use OWNER/REPO.\n'
                ;;
            *) printf 'Please select 1, 2 or 3.\n' ;;
        esac
    done
}

fetch_github_branch_names() {
    local url="https://api.github.com/repos/$REPOSITORY/branches?per_page=100"
    local payload=""

    if command -v curl >/dev/null 2>&1; then
        payload="$(curl --fail --silent --show-error --location --retry 2 \
            --connect-timeout 10 --max-time 60 "$url")" || return 1
    elif command -v wget >/dev/null 2>&1; then
        payload="$(wget -qO- --timeout=60 "$url")" || return 1
    elif command -v python3 >/dev/null 2>&1; then
        payload="$(python3 -c 'import sys, urllib.request; print(urllib.request.urlopen(sys.argv[1], timeout=60).read().decode())' "$url")" || return 1
    else
        return 1
    fi

    printf '%s\n' "$payload" \
        | grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]+"' \
        | sed -E 's/^"name"[[:space:]]*:[[:space:]]*"(.*)"$/\1/' \
        | sort -u
}

select_github_branch() {
    local branches=()
    local choice=""
    local index

    show_interactive_screen "Source branch"
    printf 'Loading branches from %s...\n' "$REPOSITORY"
    mapfile -t branches < <(fetch_github_branch_names || true)
    show_interactive_screen "Source branch"

    if ((${#branches[@]} == 0)); then
        printf '\nCould not retrieve the branch list from GitHub.\n'
        read -r -p 'Enter a branch or tag manually: ' SOURCE_REF
        [[ -n "$SOURCE_REF" ]] || die "a GitHub branch or tag is required"
        return
    fi

    printf '\nAvailable GitHub branches from %s:\n' "$REPOSITORY"
    for index in "${!branches[@]}"; do
        printf '  %2d) %s\n' "$((index + 1))" "${branches[index]}"
    done

    while true; do
        read -r -p 'Select branch number: ' choice

        if [[ "$choice" =~ ^[0-9]+$ ]] && \
           ((choice >= 1 && choice <= ${#branches[@]})); then
            SOURCE_REF="${branches[choice - 1]}"
            return
        fi
        printf 'Please enter a number between 1 and %d.\n' "${#branches[@]}"
    done
}

select_install_source() {
    local local_checkout="$1"
    local choice=""

    show_interactive_screen "Installation source"
    printf 'Choose what V-Link source to install:\n'
    printf '  1) Latest stable release\n'
    printf '  2) GitHub branch or tag\n'
    if [[ -n "$local_checkout" ]]; then
        printf '  3) This local checkout       [%s]\n' "$local_checkout"
    fi

    while true; do
        read -r -p 'Selection [1]: ' choice
        [[ -n "$choice" ]] || choice=1
        case "$choice" in
            1)
                SOURCE_DIR=""
                SOURCE_REF=""
                return
                ;;
            2)
                SOURCE_DIR=""
                select_github_branch
                return
                ;;
            3)
                if [[ -n "$local_checkout" ]]; then
                    SOURCE_DIR="$local_checkout"
                    SOURCE_REF=""
                    return
                fi
                ;;
        esac
        printf 'Invalid selection.\n'
    done
}

select_hardware_mode() {
    local choice=""

    show_interactive_screen "Hardware"
    printf 'Will this Raspberry Pi use the V-Link vehicle hardware/HAT?\n'
    printf '  1) Yes - configure CAN, UART, GPIO, SPI/I2C and device-tree overlays\n'
    printf '  2) No  - UI/CarPlay/media test only; do not touch vehicle hardware setup\n'

    while true; do
        read -r -p 'Selection: ' choice
        case "$choice" in
            1) CONFIGURE_HARDWARE=true; return ;;
            2) CONFIGURE_HARDWARE=false; return ;;
            *) printf 'Please select 1 or 2.\n' ;;
        esac
    done
}

show_install_plan() {
    local source_description
    if [[ -n "$SOURCE_DIR" ]]; then
        source_description="Local checkout: $SOURCE_DIR"
    elif [[ -n "$SOURCE_REF" ]]; then
        source_description="GitHub branch/tag: $SOURCE_REF"
    else
        source_description="Latest stable release"
    fi

    show_interactive_screen "Confirmation"
    printf '============================================================\n'
    printf 'Installation plan\n'
    printf '============================================================\n'
    if [[ -z "$SOURCE_DIR" ]]; then
        printf 'Repository: %s\n' "$REPOSITORY"
    fi
    printf 'Source:     %s\n' "$source_description"
    printf 'User:       %s\n' "$TARGET_USER"
    printf 'Hardware:   %s\n' "$([[ "$CONFIGURE_HARDWARE" == true ]] && printf 'ENABLED' || printf 'DISABLED')"
    printf 'Reboot:     %s\n' "$([[ "$REBOOT" == true ]] && printf 'yes' || printf 'no')"

    if [[ -n "$SOURCE_REF" ]]; then
        cat <<EOF

DEVELOPMENT WARNING
  You selected '$SOURCE_REF' directly from GitHub. Branch builds may contain
  unfinished or unreviewed changes and the frontend will be built on this Pi.
EOF
    fi

    cat <<'EOF'

The installer will make these major system changes:
  - install a minimal Wayland desktop (labwc + LightDM) and set graphical boot
  - install Chromium kiosk plus PipeWire/WirePlumber audio
  - create a V-Link user systemd service and kiosk autostart
  - install/update the V-Link runtime and Python virtual environment
  - disable the firmware rainbow and show the V-Link mark in labwc
EOF

    if [[ "$CONFIGURE_HARDWARE" == true ]]; then
        cat <<'EOF'

Hardware mode will ALSO:
  - configure V-Link HAT boot options and release serial ports in cmdline.txt
  - install V-Link/CAN device-tree overlays and configure SPI/I2C/UART/GPIO
  - install CAN helper services, udev rules and limited sudo permissions
  - on Raspberry Pi 3, disable the onboard Bluetooth controller for the UART

Backups of the original boot configuration are kept with .v-link.bak suffixes.
EOF
    else
        cat <<'EOF'

UI-only mode will NOT install V-Link CAN/UART/GPIO overlays or change the
managed vehicle hardware configuration.
EOF
    fi

    printf '\n'
}

validate_source() {
    local source="$1"
    local required

    for required in \
        V-Link.py requirements.txt Update.sh \
        backend/server.py \
        updater/__init__.py \
        updater/releases.py \
        updater/keepalive.py \
        lite/Install-Lite.sh \
        lite/Check-Lite.sh \
        resources/dtoverlays/v-link.dtbo \
        resources/dtoverlays/mcp2515-can1.dtbo \
        resources/dtoverlays/mcp2515-can2.dtbo; do
        [[ -e "$source/$required" ]] || die "source is incomplete: missing $required"
    done

    [[ -f "$source/Check-Lite.sh" || -f "$source/lite/Check-Lite.sh" ]] || \
        die "source is incomplete: missing Check-Lite.sh"
    for required in lite/runtime/V-Link-Lite-Boot.sh lite/runtime/V-Link-Lite-Overlay.py lite/splash/V-Link-Lite-Prepare-Splash.py lite/runtime/V-Link-Lite-Session.sh lite/runtime/V-Link-Lite-Handoff.js lite/runtime/V-Link-Lite-Terminal.bashrc lite/V-Link-Lite-Setup.py lite/runtime/V-Link-Lite-Cursor.py lite/lib/v_link_lite_support.py lite/lib/v_link_lite_audio.py lite/lib/v_link_lite_display.py lite/splash/Render-Lite-Splash.py frontend/public/assets/svg/logos/moose.svg frontend/public/assets/svg/logos/vlink.svg; do
        [[ -f "$source/$required" ]] || die "source is incomplete: missing $required"
    done
    for required in __init__.py ui.py navigation.py network.py audio.py display.py storage.py vlink.py diagnostics.py terminal.py; do
        [[ -f "$source/lite/setup/$required" ]] || \
            die "source is incomplete: missing lite/setup/$required"
    done

    validate_lite_session_launcher "$source/lite/runtime/V-Link-Lite-Session.sh" || \
        die "source is incomplete: invalid V-Link Lite Wayland session launcher"

    if [[ ! -f "$source/frontend/dist/index.html" && ! -f "$source/frontend/package.json" ]]; then
        die "source is incomplete: frontend/dist/index.html or frontend/package.json is required"
    fi
}

lite_source_incompatible() {
    local reason="$1"
    cat >&2 <<EOF

[V-Link Lite] ERROR:
The selected V-Link source predates Lite support or does not contain a complete
Lite payload: $reason

No system changes were made.

Choose a newer Lite-compatible release or install a development branch.
EOF
    exit 1
}

validate_lite_release_manifest() {
    local manifest="$1/.vlink-release.json"

    python3 - "$manifest" <<'PY'
import json
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
try:
    manifest = json.loads(path.read_text(encoding="utf-8"))
except (OSError, UnicodeError, ValueError):
    raise SystemExit("missing or invalid .vlink-release.json")

if not isinstance(manifest, dict):
    raise SystemExit(".vlink-release.json must contain a JSON object")
if manifest.get("payload_schema") != 2 or isinstance(manifest.get("payload_schema"), bool):
    raise SystemExit(".vlink-release.json must declare payload_schema 2")
commit = manifest.get("commit")
if not isinstance(commit, str) or re.fullmatch(r"[0-9a-fA-F]{40}", commit) is None:
    raise SystemExit(".vlink-release.json must contain a 40-character Git commit SHA")
PY
}

verify_release_checksum() {
    python3 - "$1" "$2" <<'PY'
import hashlib
import re
import sys
from pathlib import Path

archive = Path(sys.argv[1])
checksum = Path(sys.argv[2])
try:
    lines = [line.strip() for line in checksum.read_text(encoding="utf-8").splitlines()
             if line.strip()]
except (OSError, UnicodeError) as error:
    raise SystemExit(f"cannot read release checksum: {error}")
if len(lines) != 1:
    raise SystemExit("release checksum must contain exactly one V-Link.zip entry")
match = re.fullmatch(r"([0-9a-fA-F]{64})[ \t]+[ *]?V-Link\.zip", lines[0])
if match is None:
    raise SystemExit("release checksum does not describe V-Link.zip")
hasher = hashlib.sha256()
with archive.open("rb") as source:
    while chunk := source.read(1024 * 1024):
        hasher.update(chunk)
digest = hasher.hexdigest()
if digest.lower() != match.group(1).lower():
    raise SystemExit("V-Link.zip checksum mismatch")
PY
}

extract_safe_release_zip() {
    python3 - "$1" "$2" <<'PY'
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath

archive = Path(sys.argv[1])
destination = Path(sys.argv[2])
try:
    with zipfile.ZipFile(archive) as bundle:
        seen = set()
        for member in bundle.infolist():
            path = PurePosixPath(member.filename)
            mode = member.external_attr >> 16
            kind = stat.S_IFMT(mode)
            if (not member.filename or path.is_absolute() or ".." in path.parts
                    or member.filename in seen or stat.S_ISLNK(mode)
                    or kind not in (0, stat.S_IFREG, stat.S_IFDIR)):
                raise ValueError(f"unsafe ZIP entry: {member.filename!r}")
            seen.add(member.filename)
        bundle.extractall(destination)
except (OSError, ValueError, zipfile.BadZipFile) as error:
    raise SystemExit(f"invalid release archive: {error}")
PY
}

extract_safe_source_tar() {
    python3 - "$1" "$2" <<'PY'
import sys
import tarfile
from pathlib import Path, PurePosixPath

archive = Path(sys.argv[1])
destination = Path(sys.argv[2])
try:
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        roots = set()
        safe = []
        for member in members:
            path = PurePosixPath(member.name)
            if (not member.name or path.is_absolute() or ".." in path.parts
                    or member.issym() or member.islnk() or member.isdev()
                    or member.isfifo()):
                raise ValueError(f"unsafe source archive entry: {member.name!r}")
            roots.add(path.parts[0])
            if len(path.parts) > 1:
                member.name = str(PurePosixPath(*path.parts[1:]))
                safe.append(member)
        if len(roots) != 1:
            raise ValueError("source archive does not have one root directory")
        bundle.extractall(destination, members=safe)
except (OSError, ValueError, tarfile.TarError) as error:
    raise SystemExit(f"invalid source archive: {error}")
PY
}

preflight_source() {
    local release_json encoded_ref ref_json source_sha
    local release_asset_urls release_url checksum_url

    if [[ -n "$SOURCE_DIR" ]]; then
        SOURCE_DIR="$(realpath "$SOURCE_DIR")"
    else
        command -v curl >/dev/null 2>&1 || \
            die "curl is required to validate the selected source before installation"
        command -v python3 >/dev/null 2>&1 || \
            die "python3 is required to validate the selected source before installation"
        TEMP_DIR="$(mktemp -d /tmp/v-link-lite.XXXXXX)"
        install -d "$TEMP_DIR/source"

        if [[ -n "$SOURCE_REF" ]]; then
            log "Downloading source ref '$SOURCE_REF' from $REPOSITORY for Lite preflight"
            encoded_ref="$(python3 - "$SOURCE_REF" <<'PY'
import sys
import urllib.parse
print(urllib.parse.quote(sys.argv[1], safe=""))
PY
)"
            ref_json="$TEMP_DIR/ref.json"
            curl --fail --silent --show-error --location --retry 3 \
                --connect-timeout 10 --max-time 60 --speed-limit 128 --speed-time 30 \
                "https://api.github.com/repos/$REPOSITORY/commits/$encoded_ref" \
                --output "$ref_json" || die "GitHub ref '$SOURCE_REF' does not exist or is not reachable"
            source_sha="$(python3 - "$ref_json" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    sha = json.load(source).get("sha", "")
if re.fullmatch(r"[0-9a-fA-F]{40}", sha) is None:
    raise SystemExit("GitHub returned an invalid commit SHA")
print(sha.lower())
PY
)" || die "could not resolve GitHub ref '$SOURCE_REF'"
            curl --fail --show-error --location --retry 3 --connect-timeout 10 \
                --max-time 900 --speed-limit 1024 --speed-time 30 \
                "https://github.com/$REPOSITORY/archive/$source_sha.tar.gz" \
                --output "$TEMP_DIR/source.tar.gz" || die "could not download GitHub ref '$SOURCE_REF'"
            extract_safe_source_tar "$TEMP_DIR/source.tar.gz" "$TEMP_DIR/source" || \
                lite_source_incompatible "the selected branch/tag archive is unsafe"
        else
            log "Downloading the latest V-Link release from $REPOSITORY for Lite preflight"
            release_json="$TEMP_DIR/release.json"
            curl --fail --silent --show-error --location --retry 3 \
                --connect-timeout 10 --max-time 60 --speed-limit 128 --speed-time 30 \
                "https://api.github.com/repos/$REPOSITORY/releases/latest" \
                --output "$release_json" || die "no published V-Link release is reachable"
            release_asset_urls="$(python3 - "$release_json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as release_file:
    release = json.load(release_file)
for name in ("V-Link.zip", "V-Link.zip.sha256"):
    for asset in release.get("assets", []):
        if asset.get("name") == name and asset.get("browser_download_url"):
            print(asset["browser_download_url"])
            break
PY
)"
            release_url="$(sed -n '1p' <<<"$release_asset_urls")"
            checksum_url="$(sed -n '2p' <<<"$release_asset_urls")"
            [[ -n "$release_url" && -n "$checksum_url" ]] && \
                [[ -z "$(sed -n '3p' <<<"$release_asset_urls")" ]] || \
                lite_source_incompatible "the release is missing V-Link.zip or V-Link.zip.sha256"
            curl --fail --show-error --location --retry 3 --connect-timeout 10 \
                --max-time 900 --speed-limit 1024 --speed-time 30 \
                "$release_url" --output "$TEMP_DIR/V-Link.zip" || \
                die "could not download V-Link.zip"
            curl --fail --show-error --location --retry 3 --connect-timeout 10 \
                --max-time 120 --speed-limit 32 --speed-time 30 \
                "$checksum_url" --output "$TEMP_DIR/V-Link.zip.sha256" || \
                die "could not download V-Link.zip.sha256"
            verify_release_checksum "$TEMP_DIR/V-Link.zip" "$TEMP_DIR/V-Link.zip.sha256" || \
                lite_source_incompatible "the dedicated release checksum is invalid"
            extract_safe_release_zip "$TEMP_DIR/V-Link.zip" "$TEMP_DIR/source" || \
                lite_source_incompatible "the release ZIP is invalid or unsafe"
            validate_lite_release_manifest "$TEMP_DIR/source" || \
                lite_source_incompatible "a valid .vlink-release.json with payload_schema 2 is required"
            [[ -f "$TEMP_DIR/source/Check-Lite.sh" ]] || \
                lite_source_incompatible "the release is missing Check-Lite.sh"
            [[ -f "$TEMP_DIR/source/frontend/dist/index.html" ]] || \
                lite_source_incompatible "the release is missing frontend/dist/index.html"
        fi
        SOURCE_DIR="$TEMP_DIR/source"
    fi

    SOURCE_DIR="$(realpath "$SOURCE_DIR")"
    if ! (validate_source "$SOURCE_DIR"); then
        lite_source_incompatible "required Lite runtime files are missing or invalid"
    fi
    log "Lite-compatible source validated before system installation"
}

validate_v_link_imports() {
    runuser -u "$TARGET_USER" -- sh -c \
        'cd "$1" && exec "$2" "$1/V-Link.py" --help' \
        sh "$APP_DIR" "$APP_DIR/venv/bin/python"
}

frontend_source_hash() {
    local source="$1"
    python3 - "$source/frontend" <<'PY'
import hashlib
import sys
from pathlib import Path

root = Path(sys.argv[1])
digest = hashlib.sha256()
for path in sorted(root.rglob('*')):
    relative = path.relative_to(root)
    if not path.is_file() or relative.parts[0] in {'dist', 'node_modules'}:
        continue
    digest.update(relative.as_posix().encode())
    digest.update(b'\0')
    digest.update(hashlib.sha256(path.read_bytes()).digest())
print(digest.hexdigest())
PY
}

restore_app_path() {
    local destination="$1"
    local backup="$destination.v-link-old"
    local absent="$destination.v-link-was-absent"

    if [[ -e "$backup" || -L "$backup" ]]; then
        rm -rf -- "$destination"
        mv "$backup" "$destination"
    elif [[ -e "$absent" ]]; then
        rm -rf -- "$destination"
    fi
    rm -f -- "$absent"
}

begin_app_path() {
    local destination="$1"
    local backup="$destination.v-link-old"
    local absent="$destination.v-link-was-absent"

    # A backup from a killed installer is always the last known-good copy.
    restore_app_path "$destination"
    APP_CHANGED_PATHS+=("$destination")
    if [[ -e "$destination" || -L "$destination" ]]; then
        mv "$destination" "$backup"
    else
        : >"$absent"
    fi
}

install_app_file() {
    local source="$1"
    local destination="$2"
    local mode="$3"
    local parent base staging

    parent="$(dirname -- "$destination")"
    base="$(basename -- "$destination")"
    install -d "$parent"
    staging="$(mktemp "$parent/.${base}.v-link-new.XXXXXX")"
    install -m "$mode" "$source" "$staging"
    begin_app_path "$destination"
    mv "$staging" "$destination"
}

replace_app_directory() {
    local source="$1"
    local destination="$2"
    local parent base staging

    parent="$(dirname -- "$destination")"
    base="$(basename -- "$destination")"
    install -d "$parent"
    staging="$(mktemp -d "$parent/.${base}.v-link-new.XXXXXX")"
    cp -a "$source/." "$staging/"
    begin_app_path "$destination"
    mv "$staging" "$destination"
}

remove_app_path() {
    local destination="$1"
    if [[ -e "$destination" || -L "$destination" ]]; then
        begin_app_path "$destination"
    fi
}

commit_app_transaction() {
    local destination
    for destination in "${APP_CHANGED_PATHS[@]}"; do
        rm -rf -- "$destination.v-link-old"
        rm -f -- "$destination.v-link-was-absent"
    done
    APP_CHANGED_PATHS=()
    APP_TRANSACTION=false
}

on_error() {
    local line="$1"
    local status="$2"
    local command="$3"
    printf '\n[V-Link Lite] Installation failed at line %s (exit %s).\n' "$line" "$status" >&2
    printf '[V-Link Lite] Command: %s\n' "$command" >&2
    printf '[V-Link Lite] Fix the reported error and run the installer again.\n' >&2
}
trap 'on_error "$LINENO" "$?" "$BASH_COMMAND"' ERR
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

while (($#)); do
    case "$1" in
        --yes)
            ASSUME_YES=true
            ;;
        --user)
            (($# >= 2)) || die "--user requires a value"
            TARGET_USER="$2"
            shift
            ;;
        --repo)
            (($# >= 2)) || die "--repo requires OWNER/REPO"
            REPOSITORY="$2"
            REPOSITORY_EXPLICIT=true
            shift
            ;;
        --source-dir)
            (($# >= 2)) || die "--source-dir requires a path"
            SOURCE_DIR="$2"
            shift
            ;;
        --ref)
            (($# >= 2)) || die "--ref requires a branch or tag"
            SOURCE_REF="$2"
            shift
            ;;
        --lin-port)
            (($# >= 2)) || die "--lin-port requires a path"
            LIN_PORT="$2"
            shift
            ;;
        --hardware)
            CONFIGURE_HARDWARE=true
            HARDWARE_CHOICE_EXPLICIT=true
            ;;
        --no-hardware)
            CONFIGURE_HARDWARE=false
            HARDWARE_CHOICE_EXPLICIT=true
            ;;
        --no-reboot)
            REBOOT=false
            ;;
        --first-boot)
            FIRST_BOOT_MODE=true
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            usage >&2
            die "unknown option: $1"
            ;;
    esac
    shift
done

show_phase 1 7 "Setup"

validate_repository "$REPOSITORY" || \
    die "--repo must use GitHub OWNER/REPO syntax"
[[ -z "$SOURCE_DIR" || -z "$SOURCE_REF" ]] || \
    die "use either --source-dir or --ref, not both"
if [[ -n "$SOURCE_DIR" || -n "$SOURCE_REF" ]]; then
    SOURCE_CHOICE_EXPLICIT=true
fi
[[ -z "$LIN_PORT" || "$CONFIGURE_HARDWARE" == true ]] || \
    die "--lin-port cannot be combined with --no-hardware"
if [[ -n "$LIN_PORT" && ! "$LIN_PORT" =~ ^/dev/[A-Za-z0-9._/+:-]+$ ]]; then
    die "--lin-port must be an absolute /dev path without spaces"
fi

[[ $EUID -eq 0 ]] || die "run this installer with sudo"
command -v flock >/dev/null 2>&1 || die "the util-linux flock command is required"
exec 9>/run/lock/v-link-lite-install.lock
flock -n 9 || die "another V-Link Lite installer is already running"
[[ -r /etc/os-release ]] || die "cannot identify the operating system"

# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == "raspbian" || "${ID:-}" == "debian" ]] || \
    die "Raspberry Pi OS or Debian is required (detected: ${ID:-unknown})"
[[ "${VERSION_CODENAME:-}" == "bookworm" ]] || \
    die "this installer targets Bookworm (detected: ${VERSION_CODENAME:-unknown})"

[[ -n "$TARGET_USER" ]] || die "could not determine the kiosk user; pass --user USER"
id "$TARGET_USER" >/dev/null 2>&1 || die "user '$TARGET_USER' does not exist"
[[ "$TARGET_USER" != "root" ]] || die "the kiosk must run as an unprivileged user"

TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
[[ -n "$TARGET_HOME" && -d "$TARGET_HOME" ]] || die "home directory for '$TARGET_USER' was not found"
TARGET_GROUP="$(id -gn "$TARGET_USER")"

APP_DIR="$TARGET_HOME/$APP_NAME"
USER_CONFIG_DIR="$TARGET_HOME/.config"
MODEL="unknown"
RPI_GENERATION=""

if [[ -r /proc/device-tree/model ]]; then
    MODEL="$(tr -d '\0' </proc/device-tree/model)"
    case "$MODEL" in
        *"Raspberry Pi 3"*) RPI_GENERATION=3 ;;
        *"Raspberry Pi 4"*) RPI_GENERATION=4 ;;
        *"Raspberry Pi 5"*) RPI_GENERATION=5 ;;
    esac
fi

[[ -n "$RPI_GENERATION" ]] || die "unsupported Raspberry Pi model '$MODEL' (Pi 3, 4 or 5 required)"
log "Detected $MODEL"

# Detect a local checkout, but in interactive mode let the user choose whether
# to use it. Non-interactive behavior stays compatible with the old installer.
LOCAL_SOURCE_CANDIDATE=""
if [[ -z "$SOURCE_DIR" && -z "$SOURCE_REF" ]]; then
    for source_candidate in "$SCRIPT_DIR" "$SCRIPT_DIR/.."; do
        if [[ -f "$source_candidate/V-Link.py" && -d "$source_candidate/frontend" ]]; then
            LOCAL_SOURCE_CANDIDATE="$(realpath -e "$source_candidate")"
            break
        fi
    done
fi

if [[ "$ASSUME_YES" != true ]]; then
    print_welcome
    wait_for_internet
    if [[ "$REPOSITORY_EXPLICIT" != true ]]; then
        select_repository
    fi
    if [[ "$SOURCE_CHOICE_EXPLICIT" != true ]]; then
        select_install_source "$LOCAL_SOURCE_CANDIDATE"
    fi
    if [[ "$HARDWARE_CHOICE_EXPLICIT" != true ]]; then
        select_hardware_mode
    fi
    show_install_plan
    confirm "Continue with this installation plan?" || die "installation cancelled by user"
fi

[[ -z "$LIN_PORT" || "$CONFIGURE_HARDWARE" == true ]] || \
    die "--lin-port requires hardware mode"

preflight_source

if [[ "$SOURCE_DIR" == "$(realpath -m "$APP_DIR")" ]]; then
    APP_DIR="$TARGET_HOME/v-link-runtime"
    log "Keeping the source checkout intact; the kiosk runtime will be installed at $APP_DIR"
fi
if [[ ! -f "$SOURCE_DIR/frontend/dist/index.html" ]]; then
    FRONTEND_BUILD_REQUIRED=true
elif [[ -f "$SOURCE_DIR/frontend/package.json" ]]; then
    FRONTEND_SOURCE_HASH="$(frontend_source_hash "$SOURCE_DIR")"
    if [[ ! -f "$SOURCE_DIR/frontend/dist/.v-link-source.sha256" ]] || \
       [[ "$(<"$SOURCE_DIR/frontend/dist/.v-link-source.sha256")" != "$FRONTEND_SOURCE_HASH" ]]; then
        FRONTEND_BUILD_REQUIRED=true
    fi
fi
if [[ -n "$SOURCE_REF" ]]; then
    FRONTEND_BUILD_REQUIRED=true
fi

UPDATE_MARKER="$TARGET_HOME/.v-link-update-active"
RECOVERY_HELPER="$TARGET_HOME/.local/libexec/v-link-recover-update"
if [[ -e "$UPDATE_MARKER" ]]; then
    [[ -x "$RECOVERY_HELPER" ]] || \
        die "an interrupted update needs recovery, but $RECOVERY_HELPER is unavailable"
    RECOVERY_APP_DIR="$(sed -n '2p' "$UPDATE_MARKER")"
    [[ -n "$RECOVERY_APP_DIR" ]] || RECOVERY_APP_DIR="$APP_DIR"
    case "$RECOVERY_APP_DIR" in
        "$TARGET_HOME"/v-link|"$TARGET_HOME"/v-link-runtime) ;;
        *) die "interrupted update contains an unsafe application path" ;;
    esac
    log "Recovering an interrupted V-Link update before installation"
    runuser -u "$TARGET_USER" -- "$RECOVERY_HELPER" "$RECOVERY_APP_DIR"
fi

ARCHITECTURE="$(dpkg --print-architecture)"
[[ "$ARCHITECTURE" == armhf || "$ARCHITECTURE" == arm64 ]] || \
    die "unsupported architecture '$ARCHITECTURE' (armhf or arm64 required)"

REQUIRED_FREE_KB=1572864
if [[ "$FRONTEND_BUILD_REQUIRED" == true ]]; then
    REQUIRED_FREE_KB=2621440
fi
for storage_path in / "$TARGET_HOME"; do
    AVAILABLE_KB="$(df -Pk "$storage_path" | awk 'NR == 2 {print $4}')"
    [[ "$AVAILABLE_KB" =~ ^[0-9]+$ ]] || die "could not measure free space on $storage_path"
    if ((AVAILABLE_KB < REQUIRED_FREE_KB)); then
        die "not enough free space on $storage_path (need at least $((REQUIRED_FREE_KB / 1024)) MiB)"
    fi
done

show_phase 2 7 "System packages"
log "Installing the minimal Wayland, browser, audio and runtime packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
    labwc wtype swayidle wlr-randr foot swaybg librsvg2-bin python3-pil \
    python3-gi gir1.2-gtk-3.0 gir1.2-gtklayershell-0.1 \
    lightdm lightdm-gtk-greeter chromium chromium-sandbox rpi-chromium-mods \
    pipewire-audio pipewire pipewire-pulse wireplumber libspa-0.2-modules libpipewire-0.3-modules alsa-utils libgl1-mesa-dri \
    dbus-user-session libinput-tools fonts-dejavu fonts-liberation \
    curl unzip ca-certificates python3 python3-dev python3-pip python3-venv \
    libudev-dev build-essential can-utils iproute2 network-manager udisks2 udiskie

FOOT_VERSION="$(dpkg-query -W -f='${Version}' foot)" || die "installed foot package is unavailable"
dpkg --compare-versions "$FOOT_VERSION" ge 1.13.1 || \
    die "foot $FOOT_VERSION is too old for the verified Bookworm Setup options"
command -v pw-dump >/dev/null 2>&1 || die "PipeWire pw-dump is required for Lite Setup audio selection"
command -v pw-record >/dev/null 2>&1 || die "PipeWire pw-record is required for Lite microphone level and calibration"
python3 -c 'import curses' >/dev/null 2>&1 || die "Python curses support is required for Lite Setup"

LABWC_VERSION="$(labwc --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"
[[ -n "$LABWC_VERSION" ]] || die "could not determine the installed labwc version"
dpkg --compare-versions "$LABWC_VERSION" ge 0.8.4 || \
    die "labwc $LABWC_VERSION does not support HideCursor (requires 0.8.4 or newer)"

UDISKIE_VERSION="$(udiskie --version 2>&1)" || die "could not determine the installed udiskie version"
log "Automounter: $UDISKIE_VERSION"
UDISKIE_HELP="$(udiskie --help 2>&1)" || die "installed udiskie --help failed"
for flag in --no-config --automount --no-notify --no-tray --no-file-manager --no-terminal --no-password-prompt; do
    grep -Fq -- "$flag" <<<"$UDISKIE_HELP" || die "installed udiskie does not support $flag"
done

if [[ "$FRONTEND_BUILD_REQUIRED" == true ]]; then
    log "Installing frontend build tools"
    apt-get install -y --no-install-recommends git xz-utils libusb-1.0-0-dev
    select_or_install_node
fi

show_phase 3 7 "V-Link source"
log "Using the Lite-compatible source validated before system package installation"

show_phase 4 7 "Frontend"

if [[ "$FRONTEND_BUILD_REQUIRED" == true ]]; then
    log "Building the frontend (this can take several minutes on a Pi 3)"
    [[ -f "$SOURCE_DIR/frontend/package.json" ]] || die "frontend source is unavailable for the required build"
    [[ -n "$NODE_BUILD_PATH" ]] || die "a compatible Node.js build runtime was not selected"
    chown -R "$TARGET_USER:$TARGET_GROUP" "$SOURCE_DIR/frontend"
    if [[ -z "$TEMP_DIR" ]]; then
        TEMP_DIR="$(mktemp -d /tmp/v-link-lite.XXXXXX)"
        chown "$TARGET_USER:$TARGET_GROUP" "$TEMP_DIR"
    fi
    install -d -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0700 "$TEMP_DIR/npm-cache"
    runuser -u "$TARGET_USER" -- env \
        PATH="$NODE_BUILD_PATH" \
        NODE_OPTIONS=--max-old-space-size=768 \
        ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
        npm_config_engine_strict=true \
        npm_config_cache="$TEMP_DIR/npm-cache" \
        bash -c \
        'cd "$1" && npm ci --legacy-peer-deps --no-audit --no-fund && npm run build' \
        bash "$SOURCE_DIR/frontend"
    FRONTEND_SOURCE_HASH="$(frontend_source_hash "$SOURCE_DIR")"
    runuser -u "$TARGET_USER" -- sh -c 'printf "%s\n" "$1" >"$2"' \
        sh "$FRONTEND_SOURCE_HASH" "$SOURCE_DIR/frontend/dist/.v-link-source.sha256"
else
    log "Using the existing frontend build"
fi

show_phase 5 7 "Runtime"

log "Installing V-Link application files"
[[ ! -L "$APP_DIR" ]] || die "$APP_DIR must not be a symbolic link"
install -d -o "$TARGET_USER" -g "$TARGET_GROUP" "$APP_DIR"
SOURCE_IS_APP=false

if [[ "$SOURCE_DIR" == "$(realpath "$APP_DIR")" ]]; then
    SOURCE_IS_APP=true
    log "The checkout is already at $APP_DIR; using it in place"
else
    APP_TRANSACTION=true
    install_app_file "$SOURCE_DIR/V-Link.py" "$APP_DIR/V-Link.py" 0755
    install_app_file "$SOURCE_DIR/requirements.txt" "$APP_DIR/requirements.txt" 0644
    replace_app_directory "$SOURCE_DIR/backend" "$APP_DIR/backend"
    replace_app_directory "$SOURCE_DIR/updater" "$APP_DIR/updater"
    replace_app_directory "$SOURCE_DIR/lite" "$APP_DIR/lite"
    replace_app_directory "$SOURCE_DIR/frontend/dist" "$APP_DIR/frontend/dist"
    replace_app_directory "$SOURCE_DIR/resources/dtoverlays" "$APP_DIR/resources/dtoverlays"
    for optional_file in Update.sh Patch.sh; do
        if [[ -f "$SOURCE_DIR/$optional_file" ]]; then
            install_app_file "$SOURCE_DIR/$optional_file" "$APP_DIR/$optional_file" 0755
        else
            remove_app_path "$APP_DIR/$optional_file"
        fi
    done
    if [[ -f "$SOURCE_DIR/Check-Lite.sh" ]]; then
        install_app_file "$SOURCE_DIR/Check-Lite.sh" "$APP_DIR/Check-Lite.sh" 0755
    elif [[ -f "$SOURCE_DIR/lite/Check-Lite.sh" ]]; then
        install_app_file "$SOURCE_DIR/lite/Check-Lite.sh" "$APP_DIR/Check-Lite.sh" 0755
    else
        remove_app_path "$APP_DIR/Check-Lite.sh"
    fi
fi

if [[ "$SOURCE_IS_APP" != true ]]; then
    chown -R "$TARGET_USER:$TARGET_GROUP" "$APP_DIR"
fi
for executable in V-Link.py Check-Lite.sh Update.sh; do
    if [[ -f "$APP_DIR/$executable" ]]; then
        chmod 0755 "$APP_DIR/$executable"
    fi
done

for required_path in \
    "$APP_DIR/V-Link.py" \
    "$APP_DIR/requirements.txt" \
    "$APP_DIR/Check-Lite.sh" \
    "$APP_DIR/Update.sh" \
    "$APP_DIR/backend/server.py" \
    "$APP_DIR/updater/__init__.py" \
    "$APP_DIR/updater/releases.py" \
    "$APP_DIR/updater/keepalive.py" \
    "$APP_DIR/lite/Install-Lite.sh" \
    "$APP_DIR/lite/Check-Lite.sh" \
    "$APP_DIR/frontend/dist/index.html"; do
    [[ -e "$required_path" ]] || die "installed application is incomplete: missing $required_path"
done
if [[ "$APP_TRANSACTION" == true ]]; then
    begin_app_path "$APP_DIR/.v-link-lite-runtime"
fi
install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 /dev/null "$APP_DIR/.v-link-lite-runtime"

log "Creating the Python virtual environment"
REQUIREMENTS_HASH="$(sha256sum "$APP_DIR/requirements.txt" | awk '{print $1}')"
VENV_CURRENT=false
VENV_BACKUP="$APP_DIR/.venv.v-link-old"
if [[ -d "$VENV_BACKUP" ]]; then
    log "Recovering the Python environment from an interrupted installation"
    rm -rf -- "$APP_DIR/venv"
    mv "$VENV_BACKUP" "$APP_DIR/venv"
fi
if [[ -x "$APP_DIR/venv/bin/python" && -f "$APP_DIR/venv/.v-link-requirements.sha256" ]] && \
   [[ "$(<"$APP_DIR/venv/.v-link-requirements.sha256")" == "$REQUIREMENTS_HASH" ]] && \
   runuser -u "$TARGET_USER" -- "$APP_DIR/venv/bin/python" -m pip check >/dev/null 2>&1 && \
   validate_v_link_imports >/dev/null 2>&1; then
    VENV_CURRENT=true
fi

if [[ "$VENV_CURRENT" != true ]]; then
    VENV_WORK="$(mktemp -d "$TARGET_HOME/.v-link-venv.XXXXXX")"
    chown "$TARGET_USER:$TARGET_GROUP" "$VENV_WORK"
    runuser -u "$TARGET_USER" -- python3 -m venv "$VENV_WORK/builder"
    install -d -o "$TARGET_USER" -g "$TARGET_GROUP" "$VENV_WORK/wheels"
    runuser -u "$TARGET_USER" -- env \
        PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_INPUT=1 PIP_NO_CACHE_DIR=1 \
        "$VENV_WORK/builder/bin/python" -m pip install --upgrade \
        "pip==$PYTHON_BUILD_PIP" \
        "setuptools==$PYTHON_BUILD_SETUPTOOLS" \
        "wheel==$PYTHON_BUILD_WHEEL"

    log "Python builder toolchain"
    printf '  Python:     %s\n' "$(runuser -u "$TARGET_USER" -- "$VENV_WORK/builder/bin/python" --version 2>&1)"
    printf '  pip:        %s\n' "$(runuser -u "$TARGET_USER" -- "$VENV_WORK/builder/bin/python" -c 'import importlib.metadata; print(importlib.metadata.version("pip"))')"
    printf '  setuptools: %s\n' "$(runuser -u "$TARGET_USER" -- "$VENV_WORK/builder/bin/python" -c 'import importlib.metadata; print(importlib.metadata.version("setuptools"))')"
    printf '  wheel:      %s\n' "$(runuser -u "$TARGET_USER" -- "$VENV_WORK/builder/bin/python" -c 'import importlib.metadata; print(importlib.metadata.version("wheel"))')"

    runuser -u "$TARGET_USER" -- env \
        PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_INPUT=1 PIP_NO_CACHE_DIR=1 \
        "$VENV_WORK/builder/bin/python" -m pip wheel \
        --wheel-dir "$VENV_WORK/wheels" \
        -r "$APP_DIR/requirements.txt"

    if [[ -d "$APP_DIR/venv" ]]; then
        mv "$APP_DIR/venv" "$VENV_BACKUP"
    fi
    VENV_TRANSACTION=true
    runuser -u "$TARGET_USER" -- python3 -m venv "$APP_DIR/venv"
    runuser -u "$TARGET_USER" -- env PIP_NO_CACHE_DIR=1 "$APP_DIR/venv/bin/python" -m pip install \
        --no-index --find-links "$VENV_WORK/wheels" \
        -r "$APP_DIR/requirements.txt"
    runuser -u "$TARGET_USER" -- "$APP_DIR/venv/bin/python" -m pip check
    validate_v_link_imports >/dev/null
    runuser -u "$TARGET_USER" -- sh -c 'printf "%s\n" "$1" >"$2"' \
        sh "$REQUIREMENTS_HASH" "$APP_DIR/venv/.v-link-requirements.sha256"
    rm -rf -- "$VENV_WORK"
    VENV_WORK=""
else
    log "Reusing the verified Python environment"
    VENV_BACKUP=""
fi

show_phase 6 7 "System configuration"
begin_platform_files
systemctl enable lightdm.service
platform_paths_written \
    /etc/systemd/system/display-manager.service \
    /etc/systemd/system/graphical.target.wants/lightdm.service
systemctl set-default graphical.target
platform_path_written /etc/systemd/system/default.target

log "Installing root-owned Lite maintenance helpers"
install -d -o root -g root -m 0755 /usr/local/libexec /usr/local/bin
install -o root -g root -m 0644 "$SOURCE_DIR/lite/lib/v_link_lite_support.py" /usr/local/bin/v_link_lite_support.py
platform_path_written /usr/local/bin/v_link_lite_support.py
install -o root -g root -m 0644 "$SOURCE_DIR/lite/lib/v_link_lite_audio.py" /usr/local/bin/v_link_lite_audio.py
platform_path_written /usr/local/bin/v_link_lite_audio.py
install -o root -g root -m 0755 "$SOURCE_DIR/lite/lib/v_link_lite_display.py" /usr/local/bin/v_link_lite_display.py
platform_path_written /usr/local/bin/v_link_lite_display.py
for helper_spec in \
    'lite/runtime/V-Link-Lite-Boot.sh:/usr/local/libexec/v-link-lite-boot' \
    'lite/runtime/V-Link-Lite-Overlay.py:/usr/local/libexec/v-link-lite-overlay' \
    'lite/splash/V-Link-Lite-Prepare-Splash.py:/usr/local/libexec/v-link-lite-prepare-splash' \
    'lite/splash/Render-Lite-Splash.py:/usr/local/libexec/v-link-lite-render-splash' \
    'lite/runtime/V-Link-Lite-Session.sh:/usr/local/libexec/v-link-lite-session' \
    'lite/V-Link-Lite-Setup.py:/usr/local/bin/v-link-lite-setup' \
    'lite/runtime/V-Link-Lite-Cursor.py:/usr/local/bin/v-link-lite-cursor'; do
    HELPER_SOURCE="${helper_spec%%:*}"
    HELPER_DESTINATION="${helper_spec#*:}"
    HELPER_STAGING="$(mktemp "${HELPER_DESTINATION}.new.XXXXXX")"
    install -o root -g root -m 0755 "$SOURCE_DIR/$HELPER_SOURCE" "$HELPER_STAGING"
    mv -f -- "$HELPER_STAGING" "$HELPER_DESTINATION"
    HELPER_STAGING=""
    platform_path_written "$HELPER_DESTINATION"
done
[[ ! -L /usr/local/lib/v-link-lite && ! -L /usr/local/lib/v-link-lite/setup ]] || \
    die "unsafe V-Link Lite Setup module path"
install -d -o root -g root -m 0755 /usr/local/lib/v-link-lite/setup
for setup_module in __init__.py ui.py navigation.py network.py audio.py display.py storage.py vlink.py diagnostics.py terminal.py; do
    install -o root -g root -m 0644 "$SOURCE_DIR/lite/setup/$setup_module" \
        "/usr/local/lib/v-link-lite/setup/$setup_module"
    platform_path_written "/usr/local/lib/v-link-lite/setup/$setup_module"
done
runuser -u "$TARGET_USER" -- python3 -c \
    'import sys; sys.path[:0] = ["/usr/local/lib/v-link-lite", "/usr/local/bin"]; from setup.audio import AudioMixin; from setup.diagnostics import DiagnosticsMixin; from setup.display import DisplayMixin; from setup.navigation import NavigationMixin; from setup.network import NetworkMixin; from setup.storage import StorageMixin; from setup.terminal import TerminalMixin; from setup.ui import BaseUI; from setup.vlink import VLinkMixin'
validate_lite_session_launcher "$LITE_SESSION_LAUNCHER" || \
    die "installed V-Link Lite Wayland session launcher is invalid"

log "Rendering V-Link branding for the graphical splash"
install -d -o root -g root -m 0755 /usr/local/share/v-link-lite
install -o root -g root -m 0644 "$SOURCE_DIR/lite/runtime/V-Link-Lite-Handoff.js" \
    /usr/local/share/v-link-lite/handoff.js
platform_path_written /usr/local/share/v-link-lite/handoff.js
install -o root -g root -m 0644 "$SOURCE_DIR/lite/runtime/V-Link-Lite-Terminal.bashrc" \
    /usr/local/share/v-link-lite/terminal.bashrc
platform_path_written /usr/local/share/v-link-lite/terminal.bashrc
SPLASH_WORK="$(mktemp -d /tmp/v-link-splash.XXXXXX)"
python3 "$SOURCE_DIR/lite/splash/Render-Lite-Splash.py" \
    --logos-dir "$SOURCE_DIR/frontend/public/assets/svg/logos" \
    --output-dir "$SPLASH_WORK"
for splash_image in logo.png splash.png; do
    install -o root -g root -m 0644 "$SPLASH_WORK/$splash_image" \
        "/usr/local/share/v-link-lite/$splash_image"
    platform_path_written "/usr/local/share/v-link-lite/$splash_image"
done
rm -r -- "$SPLASH_WORK"
SPLASH_WORK=""
runuser -u "$TARGET_USER" -- /usr/local/libexec/v-link-lite-prepare-splash --app-dir "$APP_DIR"

log "Granting the kiosk user access to display, input, audio and V-Link hardware"
for group in audio video render input plugdev dialout gpio i2c spi; do
    if getent group "$group" >/dev/null; then
        usermod -aG "$group" "$TARGET_USER"
    fi
done

log "Authorizing supported CarPlay dongles for the V-Link kiosk"
cat >/etc/udev/rules.d/41-v-link-carplay.rules <<'EOF'
SUBSYSTEM=="usb", ATTR{idVendor}=="1314", ATTR{idProduct}=="1520", MODE="0660", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="1314", ATTR{idProduct}=="1521", MODE="0660", GROUP="plugdev"
EOF
platform_path_written /etc/udev/rules.d/41-v-link-carplay.rules

install -d -m 0755 /etc/chromium/policies/managed
cat >/etc/chromium/policies/managed/v-link-webusb.json <<'EOF'
{
  "WebUsbAllowDevicesForUrls": [
    {
      "devices": [
        { "vendor_id": 4884, "product_id": 5408 },
        { "vendor_id": 4884, "product_id": 5409 }
      ],
      "urls": [ "http://localhost:4001" ]
    }
  ]
}
EOF
platform_path_written /etc/chromium/policies/managed/v-link-webusb.json
chmod 0644 /etc/chromium/policies/managed/v-link-webusb.json
platform_path_written /etc/chromium/policies/managed/v-link-webusb.json
udevadm control --reload-rules

log "Installing the V-Link Lite Wayland session"
install -d -o root -g root -m 0755 /usr/share/wayland-sessions
HELPER_STAGING="$(mktemp "$LITE_SESSION_DESKTOP.new.XXXXXX")"
cat >"$HELPER_STAGING" <<'EOF'
[Desktop Entry]
Name=V-Link Lite
Comment=V-Link Lite Wayland session
Exec=/usr/local/libexec/v-link-lite-session
Type=Application
DesktopNames=labwc;wlroots
EOF
chown root:root "$HELPER_STAGING"
chmod 0644 "$HELPER_STAGING"
validate_lite_session_desktop "$HELPER_STAGING" || \
    die "generated V-Link Lite Wayland session is invalid"
mv -f -- "$HELPER_STAGING" "$LITE_SESSION_DESKTOP"
HELPER_STAGING=""
platform_path_written "$LITE_SESSION_DESKTOP"

log "Configuring graphical autologin"
install -d /etc/lightdm/lightdm.conf.d
HELPER_STAGING="$(mktemp "$LIGHTDM_LITE_CONFIG.new.XXXXXX")"
cat >"$HELPER_STAGING" <<EOF
[Seat:*]
greeter-session=lightdm-gtk-greeter
autologin-user=$TARGET_USER
autologin-user-timeout=0
user-session=v-link-lite
autologin-session=v-link-lite
EOF
chown root:root "$HELPER_STAGING"
chmod 0644 "$HELPER_STAGING"
validate_lite_lightdm_config "$HELPER_STAGING" "$TARGET_USER" || \
    die "generated V-Link Lite LightDM configuration is invalid"
mv -f -- "$HELPER_STAGING" "$LIGHTDM_LITE_CONFIG"
HELPER_STAGING=""
platform_path_written "$LIGHTDM_LITE_CONFIG"

log "Migrating recognized Lite display experiments"
restore_known_experimental_labwc_desktop "$EXPERIMENTAL_LABWC_DESKTOP"

HELPER_STAGING="$(mktemp /tmp/v-link-lite-visibility-wrapper.XXXXXX)"
cat >"$HELPER_STAGING" <<'EOF'
#!/bin/sh
export WLR_SCENE_DISABLE_VISIBILITY=1
exec /usr/bin/labwc
EOF
for experimental_wrapper in \
    "$EXPERIMENTAL_VISIBILITY_WRAPPER" \
    "$EXPERIMENTAL_VISIBILITY_WRAPPER_GOOD"; do
    if [[ -e "$experimental_wrapper" || -L "$experimental_wrapper" ]]; then
        if remove_known_experimental_file "$experimental_wrapper" "$HELPER_STAGING"; then
            log "Removed recognized experimental wrapper: $experimental_wrapper"
        else
            log "Preserving unrecognized file at experimental wrapper path: $experimental_wrapper"
        fi
    fi
done
rm -f -- "$HELPER_STAGING"
HELPER_STAGING=""

DIRECT_SCANOUT_TEST="$USER_CONFIG_DIR/labwc/environment.d/90-v-link-direct-scanout-test.env"
HELPER_STAGING="$(mktemp /tmp/v-link-lite-direct-scanout.XXXXXX)"
printf '%s\n' 'WLR_SCENE_DISABLE_DIRECT_SCANOUT=1' >"$HELPER_STAGING"
if [[ -e "$DIRECT_SCANOUT_TEST" || -L "$DIRECT_SCANOUT_TEST" ]]; then
    if remove_known_experimental_file "$DIRECT_SCANOUT_TEST" "$HELPER_STAGING"; then
        log "Removed recognized direct scan-out test configuration"
    else
        log "Preserving unrecognized direct scan-out configuration: $DIRECT_SCANOUT_TEST"
    fi
fi
rm -f -- "$HELPER_STAGING"
HELPER_STAGING=""

install -d -o "$TARGET_USER" -g "$TARGET_GROUP" \
    "$USER_CONFIG_DIR/labwc" "$USER_CONFIG_DIR/systemd/user" \
    "$TARGET_HOME/.local/libexec"

cat >"$TARGET_HOME/.local/libexec/v-link-recover-update" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

LOCK_HELD=false
if [[ "${1:-}" == --lock-held ]]; then
    LOCK_HELD=true
    shift
fi
[[ "$#" -eq 1 ]]

APP_DIR="$1"
APP_PARENT="$(dirname -- "$APP_DIR")"
MARKER="$APP_PARENT/.v-link-update-active"
readonly -a APP_ITEMS=(
    V-Link.py backend frontend updater lite resources requirements.txt Patch.sh Check-Lite.sh Update.sh venv
)

if [[ "$LOCK_HELD" != true ]]; then
    exec 9>"$APP_PARENT/.v-link-update.lock"
    flock -w 30 9
fi
[[ -e "$MARKER" ]] || exit 0

IFS= read -r TRANSACTION_DIR <"$MARKER"
MARKED_APP_DIR="$(sed -n '2p' "$MARKER")"
if [[ -n "$MARKED_APP_DIR" && "$MARKED_APP_DIR" != "$APP_DIR" ]]; then
    printf 'V-Link recovery target mismatch: %s\n' "$MARKED_APP_DIR" >&2
    exit 1
fi
case "$TRANSACTION_DIR" in
    "$APP_PARENT"/.v-link-update.*) ;;
    *) printf 'Unsafe V-Link recovery path: %s\n' "$TRANSACTION_DIR" >&2; exit 1 ;;
esac
BACKUP_DIR="$TRANSACTION_DIR/backup"
[[ -d "$BACKUP_DIR" ]]

for item in "${APP_ITEMS[@]}"; do
    if [[ -e "$BACKUP_DIR/$item" ]]; then
        rm -rf -- "$APP_DIR/$item"
        mv "$BACKUP_DIR/$item" "$APP_DIR/$item"
    elif [[ -e "$BACKUP_DIR/.new-$item" ]]; then
        rm -rf -- "$APP_DIR/$item"
    fi
done

rm -f -- "$MARKER"
rm -rf -- "$TRANSACTION_DIR"
EOF
platform_path_written "$TARGET_HOME/.local/libexec/v-link-recover-update"
chown "$TARGET_USER:$TARGET_GROUP" "$TARGET_HOME/.local/libexec/v-link-recover-update"
platform_path_written "$TARGET_HOME/.local/libexec/v-link-recover-update"
chmod 0755 "$TARGET_HOME/.local/libexec/v-link-recover-update"
platform_path_written "$TARGET_HOME/.local/libexec/v-link-recover-update"

RUNTIME_ARGS=""
if [[ "$CONFIGURE_HARDWARE" != true ]]; then
    RUNTIME_ARGS=" --no-hardware"
fi
LIN_ENVIRONMENT=""
if [[ -n "$LIN_PORT" ]]; then
    LIN_ENVIRONMENT="Environment=VLINK_LIN_PORT=$LIN_PORT"
    if [[ ! -e "$LIN_PORT" ]]; then
        log "WARNING: LIN port $LIN_PORT is not connected yet; the health check will require it after reboot"
    fi
fi

cat >"$USER_CONFIG_DIR/systemd/user/v-link.service" <<EOF
[Unit]
Description=V-Link kiosk application
After=pipewire.service wireplumber.service
Wants=pipewire.service wireplumber.service

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStartPre=$TARGET_HOME/.local/libexec/v-link-recover-update $APP_DIR
ExecStart=$APP_DIR/venv/bin/python $APP_DIR/V-Link.py$RUNTIME_ARGS
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
Environment=PYTHONUNBUFFERED=1
Environment=VLINK_MANAGED_CAN=1
$LIN_ENVIRONMENT

EOF
platform_path_written "$USER_CONFIG_DIR/systemd/user/v-link.service"

# The graphical boot gate is the only automatic starter of V-Link. Remove a
# legacy user enable link if a previous installation created one.
USER_SERVICE_LINK="$USER_CONFIG_DIR/systemd/user/default.target.wants/v-link.service"
if [[ -L "$USER_SERVICE_LINK" ]]; then
    rm -f -- "$USER_SERVICE_LINK"
    platform_path_written "$USER_SERVICE_LINK"
fi

[[ ! -L "$USER_CONFIG_DIR/v-link-lite" ]] || die "unsafe Lite settings directory symlink"
install -d -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0700 "$USER_CONFIG_DIR/v-link-lite"
runuser -u "$TARGET_USER" -- env XDG_CONFIG_HOME="$USER_CONFIG_DIR" python3 -c \
    'import sys; sys.path.insert(0, "/usr/local/bin"); from v_link_lite_support import save_settings, DEFAULT_SETTINGS; save_settings(sys.argv[1], DEFAULT_SETTINGS, create_only=True)' \
    "$TARGET_HOME"
platform_path_written "$USER_CONFIG_DIR/v-link-lite/settings.conf"
runuser -u "$TARGET_USER" -- env XDG_CONFIG_HOME="$USER_CONFIG_DIR" /usr/local/bin/v-link-lite-cursor sync-config
platform_path_written "$USER_CONFIG_DIR/labwc/rc.xml"

cat >"$USER_CONFIG_DIR/systemd/user/v-link-lite-cursor-idle.service" <<'EOF'
[Unit]
Description=V-Link Lite cursor idle policy

[Service]
Type=simple
ExecStart=/usr/bin/swayidle -C /dev/null -w timeout 5 "/usr/local/bin/v-link-lite-cursor hide"
Restart=on-failure
RestartSec=2
EOF
platform_path_written "$USER_CONFIG_DIR/systemd/user/v-link-lite-cursor-idle.service"

cat >"$USER_CONFIG_DIR/systemd/user/v-link-lite-setup.service" <<'EOF'
[Unit]
Description=V-Link Lite Setup window

[Service]
Type=exec
ExecStart=/usr/bin/foot --fullscreen --font=monospace:size=16 "--title=V-Link Lite Setup" --app-id=v-link-lite-setup /usr/local/bin/v-link-lite-setup
EOF
platform_path_written "$USER_CONFIG_DIR/systemd/user/v-link-lite-setup.service"

cat >"$USER_CONFIG_DIR/labwc/autostart" <<'EOF'
# Make the Wayland session environment available to user services.
systemctl --user import-environment WAYLAND_DISPLAY DISPLAY XDG_CURRENT_DESKTOP XDG_SESSION_TYPE

# Apply a saved Lite display mode before the boot gate and Chromium start.
/usr/local/bin/v_link_lite_display.py apply || printf 'V-Link Lite: display policy failed; keeping compositor mode.\n' >&2

# Render once per effective resolution, then display the PNG at native size.
/usr/local/bin/v_link_lite_display.py refresh-splash || printf 'V-Link Lite: splash refresh failed; using the installed fallback.\n' >&2
swaybg -i /usr/local/share/v-link-lite/splash.png -m center -c 000000 &

# Automount removable media within the kiosk user's graphical session.
udiskie --no-config --automount --no-notify --no-tray --no-file-manager --no-terminal --no-password-prompt &

# The foreground gate holds V-Link until its three-second timeout or Setup exit.
# A confirmed reboot/shutdown skips the service launch.
if /usr/local/libexec/v-link-lite-boot; then
    # Reapply the Lite-only HTML hook after any headless V-Link update.
    if /usr/local/libexec/v-link-lite-prepare-splash; then
        # Wait for the overlay to map, not for a guessed Chromium delay.
        overlay_ready="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/v-link-lite-overlay-visible"
        rm -f -- "$overlay_ready"
        /usr/local/libexec/v-link-lite-overlay &
        overlay_pid=$!
        overlay_mapped=false
        for attempt in {1..50}; do
            if [[ -f "$overlay_ready" ]] && kill -0 "$overlay_pid" 2>/dev/null; then
                overlay_mapped=true
                break
            fi
            kill -0 "$overlay_pid" 2>/dev/null || break
            sleep 0.1
        done
        if [[ "$overlay_mapped" != true ]]; then
            printf 'V-Link Lite: splash overlay did not map; continuing startup.\n' >&2
        fi
    else
        printf 'V-Link Lite: splash handoff unavailable; continuing startup.\n' >&2
    fi
    # One policy application after Setup, before the only V-Link start.
    /usr/local/bin/v-link-lite-cursor apply || printf 'V-Link Lite: cursor policy failed.\n' >&2
    systemctl --user start v-link.service &
fi
EOF
platform_path_written "$USER_CONFIG_DIR/labwc/autostart"

chown -R "$TARGET_USER:$TARGET_GROUP" "$USER_CONFIG_DIR/labwc" "$USER_CONFIG_DIR/systemd"
platform_paths_written \
    "$USER_CONFIG_DIR/systemd/user/v-link.service" \
    "$USER_CONFIG_DIR/systemd/user/v-link-lite-cursor-idle.service" \
    "$USER_CONFIG_DIR/systemd/user/v-link-lite-setup.service" \
    "$USER_CONFIG_DIR/labwc/rc.xml" \
    "$USER_CONFIG_DIR/labwc/autostart"
chmod 0644 "$USER_CONFIG_DIR/systemd/user/v-link.service"
platform_path_written "$USER_CONFIG_DIR/systemd/user/v-link.service"
chmod 0644 "$USER_CONFIG_DIR/systemd/user/v-link-lite-cursor-idle.service"
platform_path_written "$USER_CONFIG_DIR/systemd/user/v-link-lite-cursor-idle.service"
chmod 0644 "$USER_CONFIG_DIR/systemd/user/v-link-lite-setup.service"
platform_path_written "$USER_CONFIG_DIR/systemd/user/v-link-lite-setup.service"
chmod 0644 "$USER_CONFIG_DIR/labwc/rc.xml"
platform_path_written "$USER_CONFIG_DIR/labwc/rc.xml"
chmod 0755 "$USER_CONFIG_DIR/labwc/autostart"
platform_path_written "$USER_CONFIG_DIR/labwc/autostart"

# The settings screen exposes only these two privileged power operations.
SUDOERS_TEMP="$(mktemp /tmp/v-link-sudoers.XXXXXX)"
cat >"$SUDOERS_TEMP" <<EOF
$TARGET_USER ALL=(root) NOPASSWD: /usr/sbin/reboot, /usr/sbin/reboot -h now, /usr/sbin/shutdown -h now
$TARGET_USER ALL=(root) NOPASSWD: /usr/local/libexec/v-link-lite-render-splash --refresh-installed --width * --height *
EOF
if [[ "$CONFIGURE_HARDWARE" == true ]]; then
    cat >>"$SUDOERS_TEMP" <<EOF
$TARGET_USER ALL=(root) NOPASSWD: /usr/local/sbin/v-link-can-set can1 125000 can2 250000, /usr/local/sbin/v-link-can-set can1 125000 can2 500000
EOF
fi
chmod 0440 "$SUDOERS_TEMP"
visudo -cf "$SUDOERS_TEMP" >/dev/null
install -o root -g root -m 0440 "$SUDOERS_TEMP" /etc/sudoers.d/v-link-lite
rm -f -- "$SUDOERS_TEMP"
SUDOERS_TEMP=""
platform_path_written /etc/sudoers.d/v-link-lite

if [[ "$CONFIGURE_HARDWARE" == true ]]; then
    log "Configuring the V-Link HAT, CAN, UART and GPIO"
    BOOT_CONFIG=/boot/firmware/config.txt
    OVERLAY_DIR=/boot/firmware/overlays
    [[ -f "$BOOT_CONFIG" && -d "$OVERLAY_DIR" ]] || \
        die "Bookworm boot configuration was not found under /boot/firmware"

    for overlay in v-link.dtbo mcp2515-can1.dtbo mcp2515-can2.dtbo; do
        [[ -s "$APP_DIR/resources/dtoverlays/$overlay" ]] || \
            die "application package is missing hardware overlay $overlay"
        install -m 0644 "$APP_DIR/resources/dtoverlays/$overlay" "$OVERLAY_DIR/$overlay"
        platform_path_written "$OVERLAY_DIR/$overlay"
    done

    CONFIG_BEGIN_COUNT="$(grep -cFx "$CONFIG_BEGIN" "$BOOT_CONFIG" || true)"
    CONFIG_END_COUNT="$(grep -cFx "$CONFIG_END" "$BOOT_CONFIG" || true)"
    if [[ "$CONFIG_BEGIN_COUNT" != "$CONFIG_END_COUNT" || "$CONFIG_BEGIN_COUNT" -gt 1 ]]; then
        die "$BOOT_CONFIG contains an incomplete or duplicated V-Link block"
    fi

    [[ -e "$BOOT_CONFIG.v-link.bak" ]] || cp "$BOOT_CONFIG" "$BOOT_CONFIG.v-link.bak"
    BOOT_TEMP="$(mktemp "$BOOT_CONFIG.v-link.XXXXXX")"
    if [[ "$CONFIG_BEGIN_COUNT" -eq 1 ]]; then
        sed "\|^${CONFIG_BEGIN}$|,\|^${CONFIG_END}$|d" "$BOOT_CONFIG" >"$BOOT_TEMP"
    else
        cp "$BOOT_CONFIG" "$BOOT_TEMP"
    fi

    {
        printf '\n%s\n' "$CONFIG_BEGIN"
        cat <<'EOF'
[all]
dtparam=spi=on
dtparam=i2c_arm=on
enable_uart=1
disable_poe_fan=1
force_eeprom_read=0
dtoverlay=v-link,cs2_spidev=off
dtoverlay=mcp2515-can1,oscillator=16000000,interrupt=24
dtoverlay=mcp2515-can2,oscillator=16000000,interrupt=22
dtoverlay=gpio-poweroff,gpiopin=0
EOF
        case "$RPI_GENERATION" in
            3)
                printf '%s\n' 'dtoverlay=disable-bt'
                ;;
            4)
                printf '%s\n' 'dtoverlay=uart3'
                ;;
            5)
                cat <<'EOF'
dtparam=uart0=on
dtoverlay=uart2-pi5
EOF
                ;;
        esac
        printf '%s\n' "$CONFIG_END"
    } >>"$BOOT_TEMP"
    chmod --reference="$BOOT_CONFIG" "$BOOT_TEMP"
    mv -f "$BOOT_TEMP" "$BOOT_CONFIG"
    BOOT_TEMP=""
    platform_path_written "$BOOT_CONFIG"

    CMDLINE_FILE=/boot/firmware/cmdline.txt
    [[ -f "$CMDLINE_FILE" ]] || die "missing $CMDLINE_FILE"
    case "$RPI_GENERATION" in
        3)
            SERIAL_CONSOLES='serial0|ttyAMA0|ttyS0'
            SERIAL_GETTY_UNITS=(serial0 ttyAMA0 ttyS0)
            ;;
        4)
            SERIAL_CONSOLES='serial0|ttyAMA3|ttyS0'
            SERIAL_GETTY_UNITS=(serial0 ttyAMA3 ttyS0)
            ;;
        5)
            SERIAL_CONSOLES='serial0|ttyAMA0|ttyAMA2'
            SERIAL_GETTY_UNITS=(serial0 ttyAMA0 ttyAMA2)
            ;;
    esac
    [[ -e "$CMDLINE_FILE.v-link.bak" ]] || cp "$CMDLINE_FILE" "$CMDLINE_FILE.v-link.bak"
    CMDLINE_TEMP="$(mktemp "$CMDLINE_FILE.v-link.XXXXXX")"
    sed -E \
        "s/(^| )console=($SERIAL_CONSOLES),[^ ]+//g; s/  +/ /g; s/^ //; s/ $//" \
        "$CMDLINE_FILE" >"$CMDLINE_TEMP"
    if ! awk 'NF { lines++ } END { exit(lines == 1 ? 0 : 1) }' "$CMDLINE_TEMP"; then
        die "refusing to install an invalid multi-line kernel command line"
    fi
    if grep -Eq "(^| )console=($SERIAL_CONSOLES)," "$CMDLINE_TEMP"; then
        die "could not release the V-Link serial ports from the kernel console"
    fi
    chmod --reference="$CMDLINE_FILE" "$CMDLINE_TEMP"
    mv -f "$CMDLINE_TEMP" "$CMDLINE_FILE"
    CMDLINE_TEMP=""
    platform_path_written "$CMDLINE_FILE"
    for serial_unit in "${SERIAL_GETTY_UNITS[@]}"; do
        systemctl mask "serial-getty@$serial_unit.service" >/dev/null 2>&1 || true
        platform_path_written "/etc/systemd/system/serial-getty@$serial_unit.service"
    done

    cat >/etc/modules-load.d/v-link.conf <<'EOF'
uinput
i2c-dev
EOF
    platform_path_written /etc/modules-load.d/v-link.conf

    cat >/etc/udev/rules.d/42-v-link.rules <<'EOF'
KERNEL=="ttyS0", MODE="0660", GROUP="plugdev"
KERNEL=="ttyAMA0", MODE="0660", GROUP="plugdev"
KERNEL=="ttyAMA2", MODE="0660", GROUP="plugdev"
KERNEL=="ttyAMA3", MODE="0660", GROUP="plugdev"
KERNEL=="uinput", MODE="0660", GROUP="plugdev"
EOF
    platform_path_written /etc/udev/rules.d/42-v-link.rules

cat >/usr/local/sbin/v-link-can-up <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

exec 9>/run/lock/v-link-can-config.lock
flock -w 30 9

resolve_spi_interface() {
    local spi_device="$1"
    local interfaces=()
    shopt -s nullglob
    interfaces=("/sys/bus/spi/devices/$spi_device/net/"*)
    shopt -u nullglob
    [[ "${#interfaces[@]}" -eq 1 ]] || return 1
    basename -- "${interfaces[0]}"
}

for attempt in {1..30}; do
    SPI1_INTERFACE="$(resolve_spi_interface spi0.1 2>/dev/null || true)"
    SPI2_INTERFACE="$(resolve_spi_interface spi0.2 2>/dev/null || true)"
    [[ -n "$SPI1_INTERFACE" && -n "$SPI2_INTERFACE" ]] && break
    sleep 1
done
[[ -n "$SPI1_INTERFACE" && -n "$SPI2_INTERFACE" ]]
[[ "$SPI1_INTERFACE" != "$SPI2_INTERFACE" ]]

ip link set dev "$SPI1_INTERFACE" down 2>/dev/null || true
ip link set dev "$SPI2_INTERFACE" down 2>/dev/null || true

# Move both devices out of the kernel can%d namespace before assigning the
# stable names. This avoids can0 -> can1 colliding with an existing can1.
if [[ "$SPI1_INTERFACE" != vlink-spi1 ]]; then
    [[ ! -e /sys/class/net/vlink-spi1 ]]
    ip link set dev "$SPI1_INTERFACE" name vlink-spi1
fi
if [[ "$SPI2_INTERFACE" != vlink-spi2 ]]; then
    [[ ! -e /sys/class/net/vlink-spi2 ]]
    ip link set dev "$SPI2_INTERFACE" name vlink-spi2
fi

[[ ! -e /sys/class/net/can1 ]]
[[ ! -e /sys/class/net/can2 ]]
ip link set dev vlink-spi1 name can1
ip link set dev vlink-spi2 name can2

# Leave both buses DOWN until V-Link has loaded a vehicle profile. Bringing a
# 250 kbit/s vehicle bus up at 500 kbit/s, even briefly, is unsafe and noisy.
ip link set dev can1 down
ip link set dev can2 down
EOF
    platform_path_written /usr/local/sbin/v-link-can-up
    chmod 0755 /usr/local/sbin/v-link-can-up
    platform_path_written /usr/local/sbin/v-link-can-up

    cat >/usr/local/sbin/v-link-can-set <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$#" -eq 4 ]]
[[ "$1" == can1 && "$2" == 125000 && "$3" == can2 ]]
[[ "$4" == 250000 || "$4" == 500000 ]]

# Ensure stable can1/can2 names exist before applying the selected profile.
/usr/bin/systemctl start v-link-can.service

exec 9>/run/lock/v-link-can-config.lock
flock -w 10 9

[[ "$(basename -- "$(readlink -f /sys/class/net/can1/device)")" == spi0.1 ]]
[[ "$(basename -- "$(readlink -f /sys/class/net/can2/device)")" == spi0.2 ]]

ip link set dev can1 down 2>/dev/null || true
ip link set dev can1 type can bitrate 125000 restart-ms 100
ip link set dev can1 up

ip link set dev can2 down 2>/dev/null || true
ip link set dev can2 type can bitrate "$4" restart-ms 100
ip link set dev can2 up
EOF
    platform_path_written /usr/local/sbin/v-link-can-set
    chmod 0755 /usr/local/sbin/v-link-can-set
    platform_path_written /usr/local/sbin/v-link-can-set

    cat >/etc/systemd/system/v-link-can.service <<'EOF'
[Unit]
Description=Configure V-Link CAN interfaces
After=systemd-modules-load.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/v-link-can-up
RemainAfterExit=yes
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
    platform_path_written /etc/systemd/system/v-link-can.service
    systemctl enable v-link-can.service
    platform_path_written /etc/systemd/system/multi-user.target.wants/v-link-can.service
    udevadm control --reload-rules

    if [[ "$RPI_GENERATION" -eq 3 ]]; then
        track_hciuart_state
        systemctl disable --now hciuart.service 2>/dev/null || true
        systemctl mask hciuart.service >/dev/null 2>&1 || true
        hciuart_state_written
    fi
else
    log "Removing any previously managed V-Link HAT configuration"
    systemctl disable --now v-link-can.service >/dev/null 2>&1 || true
    for managed_path in \
        /etc/systemd/system/v-link-can.service \
        /usr/local/sbin/v-link-can-up \
        /usr/local/sbin/v-link-can-set \
        /etc/modules-load.d/v-link.conf \
        /etc/udev/rules.d/42-v-link.rules \
        /etc/systemd/system/multi-user.target.wants/v-link-can.service; do
        rm -f -- "$managed_path"
        platform_path_written "$managed_path"
    done

    BOOT_CONFIG=/boot/firmware/config.txt
    if [[ -f "$BOOT_CONFIG" ]]; then
        CONFIG_BEGIN_COUNT="$(grep -cFx "$CONFIG_BEGIN" "$BOOT_CONFIG" || true)"
        CONFIG_END_COUNT="$(grep -cFx "$CONFIG_END" "$BOOT_CONFIG" || true)"
        if [[ "$CONFIG_BEGIN_COUNT" != "$CONFIG_END_COUNT" || "$CONFIG_BEGIN_COUNT" -gt 1 ]]; then
            die "$BOOT_CONFIG contains an incomplete or duplicated V-Link block"
        fi
        if [[ "$CONFIG_BEGIN_COUNT" -eq 1 ]]; then
            [[ -e "$BOOT_CONFIG.v-link.bak" ]] || cp "$BOOT_CONFIG" "$BOOT_CONFIG.v-link.bak"
            BOOT_TEMP="$(mktemp "$BOOT_CONFIG.v-link.XXXXXX")"
            sed "\|^${CONFIG_BEGIN}$|,\|^${CONFIG_END}$|d" "$BOOT_CONFIG" >"$BOOT_TEMP"
            chmod --reference="$BOOT_CONFIG" "$BOOT_TEMP"
            mv -f "$BOOT_TEMP" "$BOOT_CONFIG"
            BOOT_TEMP=""
            platform_path_written "$BOOT_CONFIG"
        fi
    fi
    for overlay in v-link.dtbo mcp2515-can1.dtbo mcp2515-can2.dtbo; do
        rm -f -- "/boot/firmware/overlays/$overlay"
        platform_path_written "/boot/firmware/overlays/$overlay"
    done

    case "$RPI_GENERATION" in
        3)
            SERIAL_GETTY_UNITS=(serial0 ttyAMA0 ttyS0)
            track_hciuart_state
            systemctl unmask hciuart.service >/dev/null 2>&1 || true
            systemctl enable hciuart.service >/dev/null 2>&1 || true
            hciuart_state_written
            ;;
        4) SERIAL_GETTY_UNITS=(serial0 ttyAMA3 ttyS0) ;;
        5) SERIAL_GETTY_UNITS=(serial0 ttyAMA0 ttyAMA2) ;;
    esac
    for serial_unit in "${SERIAL_GETTY_UNITS[@]}"; do
        systemctl unmask "serial-getty@$serial_unit.service" >/dev/null 2>&1 || true
        platform_path_written "/etc/systemd/system/serial-getty@$serial_unit.service"
    done
    udevadm control --reload-rules
fi

log "Keeping the Lite boot path independent of splash initramfs hooks"
BOOT_CONFIG=/boot/firmware/config.txt
CMDLINE_FILE=/boot/firmware/cmdline.txt
[[ -f "$BOOT_CONFIG" && -f "$CMDLINE_FILE" ]] || \
    die "Bookworm boot configuration is missing under /boot/firmware"
SPLASH_BEGIN_COUNT="$(grep -cFx "$SPLASH_CONFIG_BEGIN" "$BOOT_CONFIG" || true)"
SPLASH_END_COUNT="$(grep -cFx "$SPLASH_CONFIG_END" "$BOOT_CONFIG" || true)"
if [[ "$SPLASH_BEGIN_COUNT" != "$SPLASH_END_COUNT" || "$SPLASH_BEGIN_COUNT" -gt 1 ]]; then
    die "$BOOT_CONFIG contains an incomplete or duplicated V-Link splash block"
fi
[[ -e "$BOOT_CONFIG.v-link.bak" ]] || cp "$BOOT_CONFIG" "$BOOT_CONFIG.v-link.bak"
BOOT_TEMP="$(mktemp "$BOOT_CONFIG.v-link.XXXXXX")"
if [[ "$SPLASH_BEGIN_COUNT" -eq 1 ]]; then
    sed "\|$SPLASH_CONFIG_BEGIN|,\|$SPLASH_CONFIG_END|d" "$BOOT_CONFIG" >"$BOOT_TEMP"
else
    cp "$BOOT_CONFIG" "$BOOT_TEMP"
fi
printf '\n%s\n[all]\ndisable_splash=1\n%s\n' \
    "$SPLASH_CONFIG_BEGIN" "$SPLASH_CONFIG_END" >>"$BOOT_TEMP"
chmod --reference="$BOOT_CONFIG" "$BOOT_TEMP"
mv -f -- "$BOOT_TEMP" "$BOOT_CONFIG"
BOOT_TEMP=""
platform_path_written "$BOOT_CONFIG"

if ! awk 'NF { lines++ } END { exit(lines == 1 ? 0 : 1) }' "$CMDLINE_FILE"; then
    die "refusing to edit an invalid multi-line kernel command line"
fi
# Remove only the splash arguments used by older V-Link Lite installs. In
# particular, keep root=, console=, and unrelated boot options intact.
read -r -a CMDLINE_OPTIONS <<<"$(<"$CMDLINE_FILE")"
SAFE_CMDLINE_OPTIONS=()
for option in "${CMDLINE_OPTIONS[@]}"; do
    case "$option" in
        quiet|splash|vt.global_cursor_default=0|fullscreen_logo=1|fullscreen_logo_name=logo.tga) ;;
        *) SAFE_CMDLINE_OPTIONS+=("$option") ;;
    esac
done
[[ ${#SAFE_CMDLINE_OPTIONS[@]} -gt 0 ]] || die "refusing to empty $CMDLINE_FILE"
[[ -e "$CMDLINE_FILE.v-link.bak" ]] || cp "$CMDLINE_FILE" "$CMDLINE_FILE.v-link.bak"
CMDLINE_TEMP="$(mktemp "$CMDLINE_FILE.v-link.XXXXXX")"
printf '%s\n' "${SAFE_CMDLINE_OPTIONS[*]}" >"$CMDLINE_TEMP"
chmod --reference="$CMDLINE_FILE" "$CMDLINE_TEMP"
mv -f -- "$CMDLINE_TEMP" "$CMDLINE_FILE"
CMDLINE_TEMP=""
platform_path_written "$CMDLINE_FILE"

systemctl daemon-reload

show_phase 7 7 "Final checks"

log "Running pre-reboot health checks"
[[ -x "$APP_DIR/Check-Lite.sh" ]] || die "installed application is missing executable Check-Lite.sh"
if ! "$APP_DIR/Check-Lite.sh" --user "$TARGET_USER" --pre-reboot; then
    die "installation checks failed; review the failures above before rebooting"
fi

# The new code and venv are now known-good. Only now discard the previous
# application so a failed reinstall always leaves the last working version.
if [[ "$APP_TRANSACTION" == true ]]; then
    commit_app_transaction
fi
if [[ "$VENV_TRANSACTION" == true ]]; then
    rm -rf -- "$VENV_BACKUP"
    VENV_BACKUP=""
    VENV_TRANSACTION=false
fi
PLATFORM_TRANSACTION=false

if [[ "$FIRST_BOOT_MODE" == true ]]; then
    cleanup_first_boot_stage
fi

clear_screen
printf '\n============================================================\n'
printf '                    V-Link Lite Installer\n'
printf '                    Installation complete\n'
printf '============================================================\n\n'
printf '  ✓ V-Link installed\n'
printf '  ✓ Frontend ready\n'
printf '  ✓ Python environment ready\n'
printf '  ✓ Kiosk configured\n'
printf '  ✓ Health checks passed\n\n'
printf 'User:        %s\n' "$TARGET_USER"
printf 'Application: %s\n' "$APP_DIR"
printf 'Display:     LightDM + labwc + Chromium kiosk\n'
printf 'Audio:       PipeWire/WirePlumber (select the output with wpctl)\n'
printf 'Logs:        journalctl --user -u v-link.service -f\n'
printf 'Health:      sudo %s/Check-Lite.sh --user %s\n' "$APP_DIR" "$TARGET_USER"
if [[ "$RPI_GENERATION" -eq 3 && "$CONFIGURE_HARDWARE" == true ]]; then
    printf '\nWARNING: Pi 3 integrated Bluetooth is disabled to reserve the reliable UART for RTI.\n'
    if [[ -n "$LIN_PORT" ]]; then
        printf 'LIN steering controls will use the external UART at %s.\n' "$LIN_PORT"
    else
        printf 'P1/T5 simultaneous RTI + LIN is disabled unless you rerun with --lin-port /dev/serial/by-id/....\n'
        printf 'Use a CAN steering-control profile when no external USB-UART is configured.\n'
    fi
fi

if [[ "$REBOOT" == true ]] && confirm "Reboot now to start V-Link?"; then
    systemctl reboot
else
    printf '\nReboot later with: sudo reboot\n'
fi
