#!/usr/bin/env bash
set -Eeuo pipefail

# This script is called near the end of Raspberry Pi Imager's firstrun.sh, or
# once through systemd.run when Imager did not create a firstrun.sh. It only
# stages the interactive installer for the next normal boot.

readonly V_LINK_FIRST_BOOT_PROTOCOL=3
SYSTEM_ROOT="${V_LINK_FIRST_BOOT_ROOT:-}"
PROC_CMDLINE="${V_LINK_PROC_CMDLINE:-/proc/cmdline}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/cmdline.txt" ]]; then
    BOOT_ROOT="$SCRIPT_DIR"
elif [[ -f /boot/firmware/cmdline.txt ]]; then
    BOOT_ROOT=/boot/firmware
elif [[ -f /boot/cmdline.txt ]]; then
    BOOT_ROOT=/boot
else
    printf '[V-Link first boot] ERROR: could not locate cmdline.txt\n' >&2
    exit 1
fi
INSTALLER_SOURCE="$SCRIPT_DIR/Install-Lite.sh"
INSTALLER_STAGED="$SYSTEM_ROOT/usr/local/libexec/v-link-install-lite"
UNIT="$SYSTEM_ROOT/etc/systemd/system/v-link-firstboot.service"
WAIT_UNIT="$SYSTEM_ROOT/etc/systemd/system/v-link-firstboot-wait.service"
WAIT_HELPER="$SYSTEM_ROOT/usr/local/sbin/v-link-firstboot-wait"
INSTALL_HELPER="$SYSTEM_ROOT/usr/local/sbin/v-link-firstboot-installer"
INSTALL_LOG="$SYSTEM_ROOT/var/log/v-link-firstboot-installer.log"
BOOT_LOG="$BOOT_ROOT/v-link-firstboot.log"
BOOT_INSTALL_LOG="$BOOT_ROOT/v-link-firstboot-installer.log"
MANIFEST="$BOOT_ROOT/v-link-firstboot.conf"
USER_HELPER="$SYSTEM_ROOT/usr/local/sbin/v-link-firstboot-user"

# A read-only boot partition must not prevent the cmdline cleanup attempt.
if : >>"$BOOT_LOG" 2>/dev/null; then
    exec >>"$BOOT_LOG" 2>&1 || true
fi

log() {
    printf '[V-Link first boot] %s\n' "$*"
}

die() {
    printf '[V-Link first boot] ERROR: %s\n' "$*" >&2
    exit 1
}

file_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d' ' -f1
    else
        shasum -a 256 "$1" | cut -d' ' -f1
    fi
}

RUNNING_FROM_CMDLINE=false
if grep -Eq 'systemd\.run=/boot(/firmware)?/V-Link-FirstBoot\.sh' "$PROC_CMDLINE"; then
    RUNNING_FROM_CMDLINE=true
    CMDLINE_FILE="$BOOT_ROOT/cmdline.txt"
    CMDLINE_TEMP="$(mktemp "$BOOT_ROOT/.cmdline.v-link.XXXXXX")"
    sed -E \
        's#(^| )systemd\.run=/boot(/firmware)?/V-Link-FirstBoot\.sh##g; s/(^| )systemd\.run_success_action=[^ ]+//g; s/(^| )systemd\.run_failure_action=[^ ]+//g; s/(^| )systemd\.unit=kernel-command-line\.target//g; s/(^| )systemd\.wants=kernel-command-line\.target//g; s/  +/ /g; s/^ //; s/ $//' \
        "$CMDLINE_FILE" >"$CMDLINE_TEMP"
    if grep -Eq 'systemd\.(run|run_success_action|run_failure_action)=|systemd\.(unit|wants)=kernel-command-line\.target' \
            "$CMDLINE_TEMP"; then
        rm -f -- "$CMDLINE_TEMP"
        die "could not remove temporary first-boot arguments from $CMDLINE_FILE"
    fi
    mv -f "$CMDLINE_TEMP" "$CMDLINE_FILE"
fi

if [[ "$RUNNING_FROM_CMDLINE" == true ]]; then
    log "Temporary kernel command-line arguments removed"
fi

[[ -f "$MANIFEST" && ! -L "$MANIFEST" ]] || die "missing or unsafe $MANIFEST"
[[ -f "$INSTALLER_SOURCE" && ! -L "$INSTALLER_SOURCE" ]] || die "missing or unsafe $INSTALLER_SOURCE"
[[ -f "$SCRIPT_DIR/V-Link-FirstBoot.sh" && ! -L "$SCRIPT_DIR/V-Link-FirstBoot.sh" ]] || die "missing or unsafe first-boot script"
INSTALLER_SHA256=""
BOOTSTRAP_SHA256=""
SOURCE_TAG=""
SOURCE_REPOSITORY=""
SOURCE_REF=""
while IFS='=' read -r key value; do
    case "$key" in
        SOURCE) [[ -z "$SOURCE_TAG" && -n "$value" ]] || die "missing or duplicate SOURCE in first-boot manifest"; SOURCE_TAG="$value" ;;
        REPOSITORY) [[ -z "$SOURCE_REPOSITORY" && -n "$value" ]] || die "missing or duplicate REPOSITORY in first-boot manifest"; SOURCE_REPOSITORY="$value" ;;
        SOURCE_REF) [[ -z "$SOURCE_REF" && -n "$value" ]] || die "missing or duplicate SOURCE_REF in first-boot manifest"; SOURCE_REF="$value" ;;
        INSTALLER_SHA256) [[ -z "$INSTALLER_SHA256" ]] || die "duplicate installer hash"; INSTALLER_SHA256="$value" ;;
        BOOTSTRAP_SHA256) [[ -z "$BOOTSTRAP_SHA256" ]] || die "duplicate bootstrap hash"; BOOTSTRAP_SHA256="$value" ;;
        *) die "unexpected first-boot manifest field: $key" ;;
    esac
done <"$MANIFEST"
[[ -n "$SOURCE_TAG" ]] || die "missing SOURCE in first-boot manifest"
[[ "$SOURCE_REPOSITORY" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?/[A-Za-z0-9._-]+$ ]] || \
    die "invalid REPOSITORY in first-boot manifest"
[[ "$SOURCE_REPOSITORY" != */. && "$SOURCE_REPOSITORY" != */.. ]] || \
    die "invalid REPOSITORY in first-boot manifest"
[[ "$SOURCE_REF" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ && \
   "$SOURCE_REF" != *//* && "$SOURCE_REF" != */ && \
   "$SOURCE_REF" != */../* && "$SOURCE_REF" != ../* && "$SOURCE_REF" != */.. ]] || \
    die "invalid SOURCE_REF in first-boot manifest"
[[ "$INSTALLER_SHA256" =~ ^[[:xdigit:]]{64}$ && "$BOOTSTRAP_SHA256" =~ ^[[:xdigit:]]{64}$ ]] || \
    die "invalid SHA256 in first-boot manifest"
INSTALLER_SHA256="$(printf '%s' "$INSTALLER_SHA256" | tr '[:upper:]' '[:lower:]')"
BOOTSTRAP_SHA256="$(printf '%s' "$BOOTSTRAP_SHA256" | tr '[:upper:]' '[:lower:]')"
[[ "$(file_sha256 "$INSTALLER_SOURCE")" == "$INSTALLER_SHA256" ]] || \
    die "installer SHA256 mismatch; nothing was staged"
[[ "$(file_sha256 "$SCRIPT_DIR/V-Link-FirstBoot.sh")" == "$BOOTSTRAP_SHA256" ]] || \
    die "bootstrap SHA256 mismatch; nothing was staged"
log "Installer and bootstrap SHA256 verified"

[[ -f "$INSTALLER_SOURCE" ]] || die "missing $INSTALLER_SOURCE"
install -d \
    "$(dirname -- "$INSTALLER_STAGED")" \
    "$(dirname -- "$INSTALL_HELPER")" \
    "$(dirname -- "$UNIT")" \
    "$(dirname -- "$INSTALL_LOG")"
install -m 0755 "$INSTALLER_SOURCE" "$INSTALLER_STAGED"
log "Installer staged at $INSTALLER_STAGED"

cat >"$USER_HELPER" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

uid_min="$(awk '$1 == "UID_MIN" { print $2; exit }' /etc/login.defs 2>/dev/null || true)"
uid_max="$(awk '$1 == "UID_MAX" { print $2; exit }' /etc/login.defs 2>/dev/null || true)"
[[ "$uid_min" =~ ^[0-9]+$ ]] || uid_min=1000
[[ "$uid_max" =~ ^[0-9]+$ ]] || uid_max=60000
candidates=()
while IFS=: read -r name _ uid _ _ home shell; do
    [[ "$uid" =~ ^[0-9]+$ ]] || continue
    ((uid >= uid_min && uid <= uid_max)) || continue
    [[ "$name" != root && "$home" == /* && -d "$home" && "$shell" == /* && -x "$shell" ]] || continue
    case "$shell" in
        */false|*/nologin|"") continue ;;
    esac
    candidates+=("$name")
done < <(getent passwd)
case "${#candidates[@]}" in
    0) printf 'No eligible local user exists yet.\n' >&2; exit 2 ;;
    1) printf '%s\n' "${candidates[0]}" ;;
    *) printf 'Multiple eligible users: %s. Run Install-Lite.sh --user USER manually.\n' "${candidates[*]}" >&2; exit 3 ;;
esac
EOF
chmod 0755 "$USER_HELPER"

cat >"$INSTALL_HELPER" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail

copy_log_to_boot_partition() {
    cp -f "$INSTALL_LOG" "$BOOT_INSTALL_LOG" 2>/dev/null || true
}
trap copy_log_to_boot_partition EXIT

target_user="\$("$USER_HELPER")" || exit 1
target_home="\$(getent passwd "\$target_user" | cut -d: -f6)"
cd "\$target_home"
set +e
"$INSTALLER_STAGED" --first-boot --user "\$target_user" \
    --repo "$SOURCE_REPOSITORY" --ref "$SOURCE_REF" 2>&1 | \
    tee -a "$INSTALL_LOG"
pipeline_status=("\${PIPESTATUS[@]}")
set -e

installer_status="\${pipeline_status[0]}"
tee_status="\${pipeline_status[1]}"
if ((installer_status == 0 && tee_status == 0)); then
    exit 0
fi
failure_status="\$installer_status"
if ((failure_status == 0)); then
    failure_status="\$tee_status"
fi

printf '\n%s\n' '============================================================' >&2
printf '%s\n' 'V-Link Lite installation failed.' >&2
printf '%s\n\n' '============================================================' >&2
if ((tee_status == 0)); then
    printf '%s\n\n  %s\n\n' 'The error above has been saved to:' "$INSTALL_LOG" >&2
else
    printf 'Installer logging failed (tee exited with status %s).\n\n' "\$tee_status" >&2
    printf '%s\n\n  %s\n\n' 'Expected log path:' "$INSTALL_LOG" >&2
fi
printf '%s\n' 'No further installation steps will be performed.' >&2
if [[ -t 0 ]]; then
    printf '\n' >&2
    read -r -p 'Press Enter to return to the console... ' _ || true
fi
exit "\$failure_status"
EOF
chmod 0755 "$INSTALL_HELPER"

cat >"$WAIT_HELPER" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

while true; do
    status=0
    /usr/local/sbin/v-link-firstboot-user >/dev/null 2>&1 || status=$?
    [[ "$status" -ne 2 ]] && break
    sleep 2
done
while systemctl is-active --quiet userconfig.service; do
    sleep 2
done
exec systemctl --no-block start v-link-firstboot.service
EOF
chmod 0755 "$WAIT_HELPER"

cat >"$UNIT" <<EOF
[Unit]
Description=V-Link interactive first-boot installer
After=systemd-user-sessions.service userconfig.service NetworkManager.service
Wants=NetworkManager.service
Conflicts=getty@tty8.service display-manager.service lightdm.service

[Service]
Type=oneshot
ExecStartPre=-/bin/systemctl stop lightdm.service
ExecStartPre=-/usr/bin/chvt 8
ExecStart=$INSTALL_HELPER
StandardInput=tty-force
StandardOutput=tty
StandardError=tty
TTYPath=/dev/tty8
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=no
RemainAfterExit=no
ExecStopPost=-/bin/systemctl --no-block start getty@tty1.service
ExecStopPost=-/usr/bin/chvt 1

EOF

cat >"$WAIT_UNIT" <<EOF
[Unit]
Description=Wait for a local user before starting the V-Link installer
After=systemd-user-sessions.service userconfig.service

[Service]
Type=simple
ExecStart=$WAIT_HELPER
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable v-link-firstboot-wait.service >/dev/null
log "Interactive V-Link installer staged; waiting for an eligible local user"
if [[ "$RUNNING_FROM_CMDLINE" == true ]]; then
    log "Rebooting into the normal system to create or detect the local user"
fi
