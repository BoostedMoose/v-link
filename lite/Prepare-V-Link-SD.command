#!/bin/bash
set -Eeuo pipefail

DEFAULT_REPOSITORY="PabloMartin97/v-link"
DEFAULT_SOURCE_REF="Lite-os-for-pr"
OFFICIAL_REPOSITORY="BoostedMoose/v-link"
OFFICIAL_SOURCE_REF="dev"
REPOSITORY=""
SOURCE_REF=""
SOURCE_DIRECTORY="lite"
INSTALLER_NAME="Install-Lite.sh"
BOOTSTRAP_NAME="V-Link-FirstBoot.sh"
BOOTSTRAP_SOURCE="bootstrap/$BOOTSTRAP_NAME"
CONFIG_NAME="v-link-firstboot.conf"
DEFAULT_BOOT_RUNTIME="/boot/firmware"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CURL_BIN="${V_LINK_CURL:-/usr/bin/curl}"

pause_and_exit() {
    local status="${1:-0}"
    printf '\nPress Return to close this window...'
    read -r _ || true
    exit "$status"
}

fail() {
    printf '\nERROR: %s\n' "$*" >&2
    pause_and_exit 1
}

usage() {
    cat <<'EOF'
Usage: ./Prepare-V-Link-SD.command [--repo OWNER/REPO --ref REF]

Prepare a Raspberry Pi OS Lite SD card for V-Link first boot. Without source
arguments, an interactive selector offers the development fork by default.

  --repo OWNER/REPO   Repository containing the Lite installer and app source.
  --ref REF           Branch or tag to pin to one commit.
  -h, --help          Show this help.

Examples:
  ./Prepare-V-Link-SD.command
  ./Prepare-V-Link-SD.command --repo BoostedMoose/v-link --ref dev
  ./Prepare-V-Link-SD.command --repo PabloMartin97/v-link --ref Lite-os-for-pr
EOF
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

validate_source_ref() {
    local source_ref="$1"
    [[ "$source_ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || return 1
    [[ "$source_ref" != *//* && "$source_ref" != */ && \
       "$source_ref" != */../* && "$source_ref" != ../* && "$source_ref" != */.. ]] || return 1
}

select_source() {
    local choice="" custom_repository="" custom_ref=""
    printf 'Choose installer repository and source:\n'
    printf '  1) PabloMartin97/v-link — Lite-os-for-pr  [development, default]\n'
    printf '  2) BoostedMoose/v-link  — dev             [official]\n'
    printf '  3) Custom OWNER/REPO and ref\n'
    printf 'Selection [1]: '
    read -r choice || choice=""
    [[ -n "$choice" ]] || choice=1
    case "$choice" in
        1) REPOSITORY="$DEFAULT_REPOSITORY"; SOURCE_REF="$DEFAULT_SOURCE_REF" ;;
        2) REPOSITORY="$OFFICIAL_REPOSITORY"; SOURCE_REF="$OFFICIAL_SOURCE_REF" ;;
        3)
            printf 'GitHub repository (OWNER/REPO): '
            read -r custom_repository || custom_repository=""
            validate_repository "$custom_repository" || fail "repository must use GitHub OWNER/REPO syntax"
            printf 'Branch or tag: '
            read -r custom_ref || custom_ref=""
            validate_source_ref "$custom_ref" || fail "invalid GitHub branch or tag"
            REPOSITORY="$custom_repository"
            SOURCE_REF="$custom_ref"
            ;;
        *) fail "selection must be 1, 2 or 3" ;;
    esac
}

REPOSITORY_EXPLICIT=false
SOURCE_REF_EXPLICIT=false
while (($#)); do
    case "$1" in
        --repo)
            (($# >= 2)) || fail "--repo requires OWNER/REPO"
            REPOSITORY="$2"
            REPOSITORY_EXPLICIT=true
            shift
            ;;
        --ref)
            (($# >= 2)) || fail "--ref requires a branch or tag"
            SOURCE_REF="$2"
            SOURCE_REF_EXPLICIT=true
            shift
            ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; fail "unknown option: $1" ;;
    esac
    shift
done

preserve_mode() {
    local reference="$1"
    local target="$2"
    local mode=""
    if mode="$(stat -f '%Lp' "$reference" 2>/dev/null)"; then
        :
    elif mode="$(stat -c '%a' "$reference" 2>/dev/null)"; then
        :
    else
        return 0
    fi
    chmod "$mode" "$target" 2>/dev/null || true
}

printf '\n============================================================\n'
printf '              Prepare SD card for V-Link Lite\n'
printf '============================================================\n\n'
printf 'This helper prepares an already-flashed Raspberry Pi OS Lite\n'
printf 'Bookworm SD card so the V-Link installer starts automatically.\n\n'
printf 'Recommended: use Raspberry Pi Imager OS Customisation to set:\n'
printf '  - a username and password (optional; the Pi can ask on first boot)\n'
printf '  - Wi-Fi credentials if you will not use Ethernet\n'
printf '  - optionally SSH\n\n'
printf 'An already-flashed or already-prepared card can be refreshed safely;\n'
printf 'you do not need to format it again between V-Link tests.\n\n'

if [[ "$REPOSITORY_EXPLICIT" != true && "$SOURCE_REF_EXPLICIT" != true ]]; then
    select_source
else
    [[ -n "$REPOSITORY" ]] || REPOSITORY="$DEFAULT_REPOSITORY"
    if [[ -z "$SOURCE_REF" ]]; then
        case "$REPOSITORY" in
            "$OFFICIAL_REPOSITORY") SOURCE_REF="$OFFICIAL_SOURCE_REF" ;;
            "$DEFAULT_REPOSITORY") SOURCE_REF="$DEFAULT_SOURCE_REF" ;;
            *) fail "--ref is required with a custom repository" ;;
        esac
    fi
fi
validate_repository "$REPOSITORY" || fail "repository must use GitHub OWNER/REPO syntax"
validate_source_ref "$SOURCE_REF" || fail "invalid GitHub branch or tag"
printf 'Application source: %s @ %s\n\n' "$REPOSITORY" "$SOURCE_REF"

if [[ -n "${V_LINK_BOOT_VOLUME:-}" ]]; then
    BOOT_VOLUME="$V_LINK_BOOT_VOLUME"
    [[ -f "$BOOT_VOLUME/cmdline.txt" && -f "$BOOT_VOLUME/config.txt" ]] || \
        fail "V_LINK_BOOT_VOLUME is not a Raspberry Pi boot partition"
else
    candidates=()
    for volume in /Volumes/*; do
        [[ -d "$volume" ]] || continue
        if [[ -f "$volume/cmdline.txt" && -f "$volume/config.txt" ]]; then
            candidates+=("$volume")
        fi
    done

    ((${#candidates[@]} > 0)) || fail "No mounted Raspberry Pi boot partition was found. Reinsert the flashed SD card and try again."

    if ((${#candidates[@]} == 1)); then
        BOOT_VOLUME="${candidates[0]}"
    else
        printf 'Raspberry Pi boot partitions found:\n'
        for i in "${!candidates[@]}"; do
            printf '  %d) %s\n' "$((i + 1))" "${candidates[i]}"
        done
        while true; do
            printf 'Select the SD boot partition: '
            read -r choice
            if [[ "$choice" =~ ^[0-9]+$ ]] && ((choice >= 1 && choice <= ${#candidates[@]})); then
                BOOT_VOLUME="${candidates[choice - 1]}"
                break
            fi
            printf 'Invalid selection.\n'
        done
    fi
fi

printf '\nSelected: %s\n' "$BOOT_VOLUME"

CMDLINE="$BOOT_VOLUME/cmdline.txt"
[[ -f "$CMDLINE" && ! -L "$CMDLINE" ]] || fail "cmdline.txt must be a regular file, not a symlink"
for managed_name in firstrun.sh "$INSTALLER_NAME" "$BOOTSTRAP_NAME" "$CONFIG_NAME" cmdline.txt.v-link-prep.bak; do
    [[ ! -L "$BOOT_VOLUME/$managed_name" ]] || fail "refusing a symlink at $BOOT_VOLUME/$managed_name"
done
CMDLINE_TEXT="$(LC_ALL=C awk '
    NR == 1 { sub(/\r$/, ""); if ($0 == "" || index($0, "\r") || index($0, "\t")) bad = 1; line = $0 }
    END { if (NR != 1 || bad) exit 1; print line }
' "$CMDLINE")" || fail "cmdline.txt must contain exactly one non-empty line (CRLF is allowed)"
if [[ -f "$BOOT_VOLUME/$CONFIG_NAME" || -f "$CMDLINE.v-link-prep.bak" ]]; then
    printf '\nUpdating an already prepared V-Link SD card.\n'
fi

TMPDIR_VLINK="$(mktemp -d)"
STAGE_DIR=""
cleanup() {
    rm -rf "$TMPDIR_VLINK"
    if [[ -n "$STAGE_DIR" && -d "$STAGE_DIR" ]]; then
        rm -rf "$STAGE_DIR"
    fi
}
trap cleanup EXIT

if [[ -f "$SCRIPT_DIR/$INSTALLER_NAME" && -f "$SCRIPT_DIR/$BOOTSTRAP_SOURCE" ]]; then
    printf '\nUsing the first-boot files from this local checkout...\n'
    cp "$SCRIPT_DIR/$INSTALLER_NAME" "$TMPDIR_VLINK/$INSTALLER_NAME"
    cp "$SCRIPT_DIR/$BOOTSTRAP_SOURCE" "$TMPDIR_VLINK/$BOOTSTRAP_NAME"
    FILE_SOURCE="local checkout"
else
    printf '\nResolving the V-Link source branch...\n'
    "$CURL_BIN" -fL --retry 3 \
        "https://api.github.com/repos/$REPOSITORY/commits/$SOURCE_REF" \
        -o "$TMPDIR_VLINK/source-commit.json" || fail "Could not resolve GitHub ref $SOURCE_REF"
    SOURCE_SHA="$(LC_ALL=C sed -nE '/^[[:space:]]*"sha":[[:space:]]*"[0-9a-fA-F]{40}",?[[:space:]]*$/ {
        s/^[[:space:]]*"sha":[[:space:]]*"([0-9a-fA-F]{40})",?[[:space:]]*$/\1/
        p
        q
    }' "$TMPDIR_VLINK/source-commit.json")"
    [[ "$SOURCE_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || fail "GitHub returned an invalid commit SHA for $SOURCE_REF"

    printf '\nDownloading the V-Link first-boot files from commit %s...\n' "$SOURCE_SHA"
    "$CURL_BIN" -fL --retry 3 \
        "https://raw.githubusercontent.com/$REPOSITORY/$SOURCE_SHA/$SOURCE_DIRECTORY/$INSTALLER_NAME" \
        -o "$TMPDIR_VLINK/$INSTALLER_NAME" || fail "Could not download $INSTALLER_NAME"
    "$CURL_BIN" -fL --retry 3 \
        "https://raw.githubusercontent.com/$REPOSITORY/$SOURCE_SHA/$SOURCE_DIRECTORY/$BOOTSTRAP_SOURCE" \
        -o "$TMPDIR_VLINK/$BOOTSTRAP_NAME" || fail "Could not download $BOOTSTRAP_NAME"
    FILE_SOURCE="GitHub ref $REPOSITORY $SOURCE_REF @ $SOURCE_SHA"
fi

/bin/bash -n "$TMPDIR_VLINK/$INSTALLER_NAME" || fail "$INSTALLER_NAME contains a syntax error"
/bin/bash -n "$TMPDIR_VLINK/$BOOTSTRAP_NAME" || fail "$BOOTSTRAP_NAME contains a syntax error"
grep -qFx 'readonly V_LINK_FIRST_BOOT_PROTOCOL=3' "$TMPDIR_VLINK/$BOOTSTRAP_NAME" || \
    fail "$BOOTSTRAP_NAME is too old for this SD preparation helper"

FIRSTRUN_RUNTIME=""
RUN_COUNT=0
read -r -a CMDLINE_OPTIONS <<<"$CMDLINE_TEXT"
SAFE_OPTIONS=()
for option in "${CMDLINE_OPTIONS[@]}"; do
    case "$option" in
        systemd.run=/boot/firstrun.sh|systemd.run=/boot/firmware/firstrun.sh)
            ((RUN_COUNT += 1))
            FIRSTRUN_RUNTIME="${option#systemd.run=}"
            ;;
        systemd.run=/boot/V-Link-FirstBoot.sh|systemd.run=/boot/firmware/V-Link-FirstBoot.sh)
            ((RUN_COUNT += 1))
            ;;
        systemd.run=*) fail "Unknown systemd.run hook '$option'; cmdline.txt was not changed" ;;
        systemd.run_success_action=*|systemd.run_failure_action=*|systemd.unit=kernel-command-line.target|systemd.wants=kernel-command-line.target) ;;
        *) SAFE_OPTIONS+=("$option") ;;
    esac
done
((RUN_COUNT <= 1)) || fail "cmdline.txt has multiple systemd.run hooks; refusing to choose one"
if ((RUN_COUNT == 0)); then
    for option in "${CMDLINE_OPTIONS[@]}"; do
        case "$option" in
            systemd.run_success_action=*|systemd.run_failure_action=*|systemd.unit=kernel-command-line.target|systemd.wants=kernel-command-line.target)
                fail "Orphaned systemd first-boot option '$option'; cmdline.txt was not changed" ;;
        esac
    done
fi
(( ${#SAFE_OPTIONS[@]} > 0 )) || fail "refusing to empty cmdline.txt"
if [[ -z "$FIRSTRUN_RUNTIME" ]]; then
    FIRSTRUN_RUNTIME="$DEFAULT_BOOT_RUNTIME/firstrun.sh"
fi
BOOTSTRAP_RUNTIME="$(dirname -- "$FIRSTRUN_RUNTIME")/$BOOTSTRAP_NAME"
if [[ -f "$BOOT_VOLUME/firstrun.sh" ]]; then
    SAFE_OPTIONS+=("systemd.run=$FIRSTRUN_RUNTIME" "systemd.run_success_action=reboot" "systemd.unit=kernel-command-line.target")
else
    [[ "$FIRSTRUN_RUNTIME" == "$DEFAULT_BOOT_RUNTIME/firstrun.sh" ]] || \
        fail "Imager firstrun.sh hook exists, but firstrun.sh is missing; cmdline.txt was not changed"
    BOOTSTRAP_RUNTIME="$DEFAULT_BOOT_RUNTIME/$BOOTSTRAP_NAME"
    SAFE_OPTIONS+=("systemd.run=$BOOTSTRAP_RUNTIME" "systemd.run_success_action=reboot" "systemd.run_failure_action=reboot" "systemd.unit=kernel-command-line.target")
fi
CMDLINE_TEXT="${SAFE_OPTIONS[*]}"

if [[ -f "$BOOT_VOLUME/firstrun.sh" ]]; then
    FIRSTRUN_TEMP="$TMPDIR_VLINK/firstrun.sh"
    awk '
        /^# Stage the V-Link installer for the next normal boot\.$/ { next }
        /^\/bin\/bash .*V-Link-FirstBoot\.sh/ { next }
        /^rm -f \/boot(\/firmware)?\/firstrun\.sh$/ && !inserted {
            print "# Stage the V-Link installer for the next normal boot."
            print "/bin/bash \"$(dirname \"$0\")/V-Link-FirstBoot.sh\" >\"$(dirname \"$0\")/v-link-firstboot.log\" 2>&1 || true"
            inserted=1
        }
        { print }
        END { if (!inserted) exit 1 }
    ' "$BOOT_VOLUME/firstrun.sh" >"$FIRSTRUN_TEMP" || \
        fail "Could not add the V-Link hook to Raspberry Pi Imager firstrun.sh"
fi

STAGE_DIR="$(mktemp -d "$BOOT_VOLUME/.v-link-prep.XXXXXX")" || \
    fail "Could not create a staging directory on the SD card"
INSTALLER_STAGE="$STAGE_DIR/$INSTALLER_NAME"
BOOTSTRAP_STAGE="$STAGE_DIR/$BOOTSTRAP_NAME"
CONFIG_STAGE="$STAGE_DIR/$CONFIG_NAME"
CMDLINE_STAGE="$STAGE_DIR/cmdline.txt"

cp "$TMPDIR_VLINK/$INSTALLER_NAME" "$INSTALLER_STAGE" || fail "Could not stage $INSTALLER_NAME"
cp "$TMPDIR_VLINK/$BOOTSTRAP_NAME" "$BOOTSTRAP_STAGE" || fail "Could not stage $BOOTSTRAP_NAME"
cmp -s "$TMPDIR_VLINK/$INSTALLER_NAME" "$INSTALLER_STAGE" || fail "Could not verify staged $INSTALLER_NAME"
cmp -s "$TMPDIR_VLINK/$BOOTSTRAP_NAME" "$BOOTSTRAP_STAGE" || fail "Could not verify staged $BOOTSTRAP_NAME"
if [[ -f "$BOOT_VOLUME/$INSTALLER_NAME" ]]; then
    preserve_mode "$BOOT_VOLUME/$INSTALLER_NAME" "$INSTALLER_STAGE"
fi
if [[ -f "$BOOT_VOLUME/$BOOTSTRAP_NAME" ]]; then
    preserve_mode "$BOOT_VOLUME/$BOOTSTRAP_NAME" "$BOOTSTRAP_STAGE"
fi
chmod +x "$INSTALLER_STAGE" "$BOOTSTRAP_STAGE" 2>/dev/null || true

INSTALLER_SHA256="$(/usr/bin/shasum -a 256 "$INSTALLER_STAGE" | awk '{print $1}')"
BOOTSTRAP_SHA256="$(/usr/bin/shasum -a 256 "$BOOTSTRAP_STAGE" | awk '{print $1}')"
printf 'SOURCE=%s\nREPOSITORY=%s\nSOURCE_REF=%s\nINSTALLER_SHA256=%s\nBOOTSTRAP_SHA256=%s\n' \
    "$FILE_SOURCE" "$REPOSITORY" "$SOURCE_REF" \
    "$INSTALLER_SHA256" "$BOOTSTRAP_SHA256" >"$CONFIG_STAGE"
if [[ -f "$BOOT_VOLUME/$CONFIG_NAME" ]]; then
    preserve_mode "$BOOT_VOLUME/$CONFIG_NAME" "$CONFIG_STAGE"
fi
grep -qFx "SOURCE=$FILE_SOURCE" "$CONFIG_STAGE" && \
    grep -qFx "REPOSITORY=$REPOSITORY" "$CONFIG_STAGE" && \
    grep -qFx "SOURCE_REF=$SOURCE_REF" "$CONFIG_STAGE" && \
    grep -qFx "INSTALLER_SHA256=$INSTALLER_SHA256" "$CONFIG_STAGE" && \
    grep -qFx "BOOTSTRAP_SHA256=$BOOTSTRAP_SHA256" "$CONFIG_STAGE" || \
    fail "Could not verify staged $CONFIG_NAME"

if [[ -f "$BOOT_VOLUME/firstrun.sh" ]]; then
    FIRSTRUN_STAGE="$STAGE_DIR/firstrun.sh"
    cp "$FIRSTRUN_TEMP" "$FIRSTRUN_STAGE" || fail "Could not stage firstrun.sh"
    cmp -s "$FIRSTRUN_TEMP" "$FIRSTRUN_STAGE" || fail "Could not verify staged firstrun.sh"
    preserve_mode "$BOOT_VOLUME/firstrun.sh" "$FIRSTRUN_STAGE"
fi

printf '%s\n' "$CMDLINE_TEXT" >"$CMDLINE_STAGE"
preserve_mode "$CMDLINE" "$CMDLINE_STAGE"
[[ "$(LC_ALL=C awk 'NR == 1 { line = $0 } END { if (NR != 1) exit 1; print line }' "$CMDLINE_STAGE")" == "$CMDLINE_TEXT" ]] || \
    fail "Could not verify staged cmdline.txt"

if [[ ! -f "$CMDLINE.v-link-prep.bak" ]]; then
    BACKUP_STAGE="$STAGE_DIR/cmdline.txt.v-link-prep.bak"
    cp "$CMDLINE" "$BACKUP_STAGE" || fail "Could not stage the original cmdline.txt backup"
    cmp -s "$CMDLINE" "$BACKUP_STAGE" || fail "Could not verify the original cmdline.txt backup"
    preserve_mode "$CMDLINE" "$BACKUP_STAGE"
    mv -f "$BACKUP_STAGE" "$CMDLINE.v-link-prep.bak" || fail "Could not save the original cmdline.txt backup"
fi

# Each rename is atomic because staging is on the boot partition. Assets and
# their hash manifest are committed before cmdline.txt activates first boot.
mv -f "$INSTALLER_STAGE" "$BOOT_VOLUME/$INSTALLER_NAME" || fail "Could not install $INSTALLER_NAME"
mv -f "$BOOTSTRAP_STAGE" "$BOOT_VOLUME/$BOOTSTRAP_NAME" || fail "Could not install $BOOTSTRAP_NAME"
mv -f "$CONFIG_STAGE" "$BOOT_VOLUME/$CONFIG_NAME" || fail "Could not install $CONFIG_NAME"
if [[ -f "$BOOT_VOLUME/firstrun.sh" ]]; then
    mv -f "$FIRSTRUN_STAGE" "$BOOT_VOLUME/firstrun.sh" || fail "Could not install firstrun.sh"
fi

# Commit cmdline.txt last. If any validation or earlier rename fails, the card
# retains its previous boot command line and cannot activate an incomplete set.
mv -f "$CMDLINE_STAGE" "$CMDLINE" || fail "Could not install cmdline.txt"

printf '\nSD card prepared successfully.\n\n'
printf 'First boot flow:\n'
printf '  1. Raspberry Pi Imager applies any configured user/network settings.\n'
printf '  2. Without a configured user, Raspberry Pi OS first asks you to create one.\n'
printf '  3. V-Link Lite Installer then opens automatically on the screen.\n'
printf '  4. It installs %s @ %s and lets you choose the hardware mode.\n' "$REPOSITORY" "$SOURCE_REF"
printf '  5. After a successful installation the temporary installer removes itself.\n\n'
printf 'You can now eject the SD card and put it in the Raspberry Pi.\n'
pause_and_exit 0
