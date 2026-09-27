"""Host-side tests for the Lite SD bootstrap; never mount or alter a real SD."""

import ast
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PREPARE = ROOT / "lite/Prepare-V-Link-SD.command"
FIRSTBOOT = ROOT / "lite/bootstrap/V-Link-FirstBoot.sh"
INSTALL = ROOT / "lite/Install-Lite.sh"
SESSION = ROOT / "lite/runtime/V-Link-Lite-Session.sh"
CHECK = ROOT / "lite/Check-Lite.sh"
TERMINAL_RC = ROOT / "lite/runtime/V-Link-Lite-Terminal.bashrc"


def prepare(boot, cmdline, firstrun=None, *, script=PREPARE, extra_env=None,
            args=None):
    (boot / "cmdline.txt").write_bytes(cmdline)
    (boot / "config.txt").write_text("[all]\n")
    if firstrun is not None:
        (boot / "firstrun.sh").write_text(firstrun)
    env = {**os.environ, "V_LINK_BOOT_VOLUME": str(boot)}
    if extra_env:
        env.update(extra_env)
    return subprocess.run(["bash", str(script), *(args or ())], input="\n", text=True,
                          capture_output=True, env=env, timeout=30)


def make_fake_curl(directory, sha):
    fake = directory / "curl"
    fake.write_text(f'''#!/bin/bash
set -eu
url=""
output=""
while (($#)); do
    case "$1" in
        -o) output="$2"; shift 2 ;;
        http*) url="$1"; shift ;;
        *) shift ;;
    esac
done
printf '%s\\n' "$url" >>"$V_LINK_CURL_LOG"
case "$url" in
    https://api.github.com/*) printf '%s\\n' '{{' '  "sha": "{sha}",' '}}' >"$output" ;;
    */lite/Install-Lite.sh) cp "$V_LINK_REMOTE_INSTALLER" "$output" ;;
    */lite/bootstrap/V-Link-FirstBoot.sh) cp "$V_LINK_REMOTE_BOOTSTRAP" "$output" ;;
    *) exit 22 ;;
esac
''')
    fake.chmod(0o755)
    return fake


def make_failing_mv(directory):
    fake = directory / "mv"
    fake.write_text('''#!/bin/bash
set -eu
target="${!#}"
if [[ "$(basename -- "$target")" == "$V_LINK_FAIL_MV_TARGET" ]]; then
    exit 91
fi
exec /bin/mv "$@"
''')
    fake.chmod(0o755)
    return fake


def test_prepare_clean_card_and_manifest_hashes():
    with tempfile.TemporaryDirectory() as directory:
        boot = Path(directory)
        result = prepare(boot, b"rootwait console=tty1\n")
        assert result.returncode == 0, result.stderr
        cmdline = (boot / "cmdline.txt").read_text()
        assert cmdline.count("systemd.run=") == 1
        assert "V-Link-FirstBoot.sh" in cmdline
        assert (boot / "cmdline.txt.v-link-prep.bak").read_bytes() == b"rootwait console=tty1\n"
        manifest = dict(line.split("=", 1) for line in
                        (boot / "v-link-firstboot.conf").read_text().splitlines())
        for key, filename in (("INSTALLER_SHA256", "Install-Lite.sh"),
                              ("BOOTSTRAP_SHA256", "V-Link-FirstBoot.sh")):
            assert manifest[key] == hashlib.sha256((boot / filename).read_bytes()).hexdigest()


def test_prepare_imager_hook_is_inserted_once_and_repeated_run_is_stable():
    with tempfile.TemporaryDirectory() as directory:
        boot = Path(directory)
        imager = '#!/bin/bash\necho setup\nrm -f /boot/firmware/firstrun.sh\n'
        result = prepare(boot, b"rootwait systemd.run=/boot/firmware/firstrun.sh systemd.run_success_action=reboot systemd.unit=kernel-command-line.target\n", imager)
        assert result.returncode == 0, result.stderr
        first = (boot / "cmdline.txt").read_bytes()
        hook = (boot / "firstrun.sh").read_bytes()
        second = subprocess.run(["bash", str(PREPARE)], input="\n", text=True,
                                capture_output=True,
                                env={**os.environ, "V_LINK_BOOT_VOLUME": str(boot)}, timeout=30)
        assert second.returncode == 0, second.stderr
        assert (boot / "cmdline.txt").read_bytes() == first
        assert (boot / "firstrun.sh").read_bytes() == hook
        assert hook.count(b"V-Link-FirstBoot.sh") == 1
        assert (boot / "cmdline.txt.v-link-prep.bak").read_bytes().startswith(b"rootwait systemd.run=/boot/firmware/firstrun.sh")


def test_prepare_replaces_only_known_old_hook():
    with tempfile.TemporaryDirectory() as directory:
        boot = Path(directory)
        result = prepare(boot, b"rootwait systemd.run=/boot/V-Link-FirstBoot.sh systemd.run_failure_action=reboot systemd.unit=kernel-command-line.target\n")
        assert result.returncode == 0, result.stderr
        text = (boot / "cmdline.txt").read_text()
        assert text.count("systemd.run=") == 1
        assert "systemd.run=/boot/firmware/V-Link-FirstBoot.sh" in text


def test_prepare_rejects_unknown_hook_without_changing_cmdline():
    with tempfile.TemporaryDirectory() as directory:
        boot = Path(directory)
        original = b"rootwait systemd.run=/boot/custom.sh systemd.unit=kernel-command-line.target\n"
        result = prepare(boot, original)
        assert result.returncode != 0
        assert "Unknown systemd.run" in result.stderr
        assert (boot / "cmdline.txt").read_bytes() == original
        assert not (boot / "v-link-firstboot.conf").exists()


def test_prepare_rejects_multiline_without_changing_card():
    with tempfile.TemporaryDirectory() as directory:
        boot = Path(directory)
        original = b"rootwait\nconsole=tty1\n"
        result = prepare(boot, original)
        assert result.returncode != 0
        assert (boot / "cmdline.txt").read_bytes() == original
        assert not (boot / "v-link-firstboot.conf").exists()


def test_prepare_accepts_single_crlf_without_merging_tokens():
    with tempfile.TemporaryDirectory() as directory:
        boot = Path(directory)
        result = prepare(boot, b"rootwait console=tty1\r\n")
        assert result.returncode == 0, result.stderr
        assert (boot / "cmdline.txt").read_text().startswith("rootwait console=tty1 ")


def test_prepare_remote_downloads_are_pinned_to_one_resolved_sha():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        helper_dir = root / "helper"
        helper_dir.mkdir()
        remote_prepare = helper_dir / PREPARE.name
        shutil.copy2(PREPARE, remote_prepare)
        sha = "a1" * 20
        curl_log = root / "curl.log"
        fake_curl = make_fake_curl(root, sha)
        boot = root / "boot"
        boot.mkdir()
        result = prepare(
            boot, b"rootwait console=tty1\n", script=remote_prepare,
            extra_env={
                "V_LINK_CURL": str(fake_curl),
                "V_LINK_CURL_LOG": str(curl_log),
                "V_LINK_REMOTE_INSTALLER": str(INSTALL),
                "V_LINK_REMOTE_BOOTSTRAP": str(FIRSTBOOT),
            })
        assert result.returncode == 0, result.stderr
        urls = curl_log.read_text().splitlines()
        assert urls[0].endswith("/commits/Lite-os-for-pr")
        assert len(urls) == 3
        assert all(f"/{sha}/" in url for url in urls[1:])
        manifest = (boot / "v-link-firstboot.conf").read_text()
        assert f"SOURCE=GitHub ref PabloMartin97/v-link Lite-os-for-pr @ {sha}" in manifest
        assert "REPOSITORY=PabloMartin97/v-link" in manifest
        assert "SOURCE_REF=Lite-os-for-pr" in manifest


def test_prepare_explicit_official_repo_and_ref_are_pinned_and_recorded():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        helper_dir = root / "helper"
        helper_dir.mkdir()
        remote_prepare = helper_dir / PREPARE.name
        shutil.copy2(PREPARE, remote_prepare)
        sha = "b2" * 20
        curl_log = root / "curl.log"
        fake_curl = make_fake_curl(root, sha)
        boot = root / "boot"
        boot.mkdir()
        result = prepare(
            boot, b"rootwait console=tty1\n", script=remote_prepare,
            args=("--repo", "BoostedMoose/v-link", "--ref", "dev"),
            extra_env={
                "V_LINK_CURL": str(fake_curl),
                "V_LINK_CURL_LOG": str(curl_log),
                "V_LINK_REMOTE_INSTALLER": str(INSTALL),
                "V_LINK_REMOTE_BOOTSTRAP": str(FIRSTBOOT),
            })
        assert result.returncode == 0, result.stderr
        urls = curl_log.read_text().splitlines()
        assert urls[0].endswith("/repos/BoostedMoose/v-link/commits/dev")
        assert all(f"/{sha}/" in url for url in urls[1:])
        manifest = (boot / "v-link-firstboot.conf").read_text()
        assert "REPOSITORY=BoostedMoose/v-link" in manifest
        assert "SOURCE_REF=dev" in manifest


def test_prepare_rejects_invalid_repository_before_changing_card():
    with tempfile.TemporaryDirectory() as directory:
        boot = Path(directory)
        original = b"rootwait console=tty1\n"
        result = prepare(
            boot, original,
            args=("--repo", "https://github.com/foo/bar", "--ref", "dev"))
        assert result.returncode != 0
        assert "OWNER/REPO" in result.stderr
        assert (boot / "cmdline.txt").read_bytes() == original
        assert not (boot / "v-link-firstboot.conf").exists()


def test_prepare_remote_rejects_invalid_resolved_sha_before_downloads():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        helper_dir = root / "helper"
        helper_dir.mkdir()
        remote_prepare = helper_dir / PREPARE.name
        shutil.copy2(PREPARE, remote_prepare)
        curl_log = root / "curl.log"
        fake_curl = make_fake_curl(root, "not-a-git-sha")
        boot = root / "boot"
        boot.mkdir()
        result = prepare(
            boot, b"rootwait console=tty1\n", script=remote_prepare,
            extra_env={"V_LINK_CURL": str(fake_curl), "V_LINK_CURL_LOG": str(curl_log)})
        assert result.returncode != 0
        assert "invalid commit SHA" in result.stderr
        assert len(curl_log.read_text().splitlines()) == 1
        assert not (boot / "Install-Lite.sh").exists()
        assert not (boot / "v-link-firstboot.conf").exists()


def test_prepare_failed_installer_rename_preserves_all_previous_final_files():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        boot = root / "boot"
        bin_dir = root / "bin"
        boot.mkdir()
        bin_dir.mkdir()
        make_failing_mv(bin_dir)
        old_installer = b"#!/bin/bash\necho old installer\n"
        old_bootstrap = b"#!/bin/bash\necho old bootstrap\n"
        old_manifest = b"SOURCE=old\nINSTALLER_SHA256=old\nBOOTSTRAP_SHA256=old\n"
        (boot / "Install-Lite.sh").write_bytes(old_installer)
        (boot / "V-Link-FirstBoot.sh").write_bytes(old_bootstrap)
        (boot / "v-link-firstboot.conf").write_bytes(old_manifest)
        (boot / "cmdline.txt.v-link-prep.bak").write_bytes(b"original backup\n")
        original_cmdline = b"rootwait console=tty1\n"
        result = prepare(
            boot, original_cmdline,
            extra_env={
                "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
                "V_LINK_FAIL_MV_TARGET": "Install-Lite.sh",
            })
        assert result.returncode != 0
        assert (boot / "Install-Lite.sh").read_bytes() == old_installer
        assert (boot / "V-Link-FirstBoot.sh").read_bytes() == old_bootstrap
        assert (boot / "v-link-firstboot.conf").read_bytes() == old_manifest
        assert (boot / "cmdline.txt").read_bytes() == original_cmdline
        assert not list(boot.glob(".v-link-prep.*"))


def test_prepare_failed_manifest_rename_leaves_complete_assets_and_old_manifest():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        boot = root / "boot"
        bin_dir = root / "bin"
        boot.mkdir()
        bin_dir.mkdir()
        make_failing_mv(bin_dir)
        old_manifest = b"SOURCE=old\nINSTALLER_SHA256=old\nBOOTSTRAP_SHA256=old\n"
        (boot / "Install-Lite.sh").write_text("old installer\n")
        (boot / "V-Link-FirstBoot.sh").write_text("old bootstrap\n")
        (boot / "v-link-firstboot.conf").write_bytes(old_manifest)
        (boot / "cmdline.txt.v-link-prep.bak").write_bytes(b"original backup\n")
        original_cmdline = b"rootwait console=tty1\n"
        result = prepare(
            boot, original_cmdline,
            extra_env={
                "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
                "V_LINK_FAIL_MV_TARGET": "v-link-firstboot.conf",
            })
        assert result.returncode != 0
        assert (boot / "Install-Lite.sh").read_bytes() == INSTALL.read_bytes()
        assert (boot / "V-Link-FirstBoot.sh").read_bytes() == FIRSTBOOT.read_bytes()
        assert (boot / "v-link-firstboot.conf").read_bytes() == old_manifest
        assert (boot / "cmdline.txt").read_bytes() == original_cmdline
        assert not list(boot.glob(".v-link-prep.*"))


def stage_firstboot(boot, system, valid=True, direct=False, *,
                    repository="BoostedMoose/v-link", source_ref="dev"):
    boot.mkdir()
    system.mkdir()
    shutil.copy2(FIRSTBOOT, boot / FIRSTBOOT.name)
    (boot / "Install-Lite.sh").write_text("#!/bin/bash\nexit 0\n")
    cmdline = "rootwait console=tty1"
    if direct:
        cmdline += " systemd.run=/boot/firmware/V-Link-FirstBoot.sh systemd.run_success_action=reboot systemd.unit=kernel-command-line.target"
    (boot / "cmdline.txt").write_text(cmdline + "\n")
    proc = boot / "proc-cmdline"
    proc.write_text(cmdline + "\n")
    installer_hash = hashlib.sha256((boot / "Install-Lite.sh").read_bytes()).hexdigest()
    bootstrap_hash = hashlib.sha256((boot / FIRSTBOOT.name).read_bytes()).hexdigest()
    if not valid:
        installer_hash = "0" * 64
    (boot / "v-link-firstboot.conf").write_text(
        f"SOURCE=test\nREPOSITORY={repository}\nSOURCE_REF={source_ref}\n"
        f"INSTALLER_SHA256={installer_hash}\nBOOTSTRAP_SHA256={bootstrap_hash}\n")
    bin_dir = boot / "bin"
    bin_dir.mkdir()
    (bin_dir / "systemctl").write_text("#!/bin/sh\nexit 0\n")
    (bin_dir / "systemctl").chmod(0o755)
    env = {**os.environ, "V_LINK_FIRST_BOOT_ROOT": str(system),
           "V_LINK_PROC_CMDLINE": str(proc), "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"]}
    return subprocess.run(["bash", str(boot / FIRSTBOOT.name)], text=True,
                          capture_output=True, env=env, timeout=30)


def test_firstboot_rejects_bad_hash_before_staging():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        result = stage_firstboot(root / "boot", root / "system", valid=False)
        assert result.returncode != 0
        assert not (root / "system/usr/local/libexec/v-link-install-lite").exists()
        assert "SHA256 mismatch" in (root / "boot/v-link-firstboot.log").read_text()


def test_firstboot_rejects_mixed_bootstrap_version():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        boot = root / "boot"
        result = stage_firstboot(boot, root / "system", valid=False)
        # An installer/bootstrap mismatch must be rejected whichever file
        # differs; repeat with an intact installer but a changed bootstrap hash.
        assert result.returncode != 0
        manifest = boot / "v-link-firstboot.conf"
        lines = manifest.read_text().splitlines()
        lines = [
            "INSTALLER_SHA256=" + hashlib.sha256(
                (boot / "Install-Lite.sh").read_bytes()).hexdigest()
            if line.startswith("INSTALLER_SHA256=") else
            "BOOTSTRAP_SHA256=" + "0" * 64
            if line.startswith("BOOTSTRAP_SHA256=") else line
            for line in lines
        ]
        manifest.write_text("\n".join(lines) + "\n")
        system = root / "system"
        second = subprocess.run(["bash", str(boot / FIRSTBOOT.name)], text=True,
                                capture_output=True,
                                env={**os.environ, "V_LINK_FIRST_BOOT_ROOT": str(system),
                                     "V_LINK_PROC_CMDLINE": str(boot / "proc-cmdline")}, timeout=30)
        assert second.returncode != 0
        assert not (system / "usr/local/libexec/v-link-install-lite").exists()
        assert "bootstrap SHA256 mismatch" in (boot / "v-link-firstboot.log").read_text()


def test_firstboot_valid_hash_stages_installer_and_user_selection():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        result = stage_firstboot(root / "boot", root / "system")
        assert result.returncode == 0, (root / "boot/v-link-firstboot.log").read_text()
        assert (root / "system/usr/local/libexec/v-link-install-lite").exists()
        install_helper = (root / "system/usr/local/sbin/v-link-firstboot-installer").read_text()
        assert '--repo "BoostedMoose/v-link" --ref "dev"' in install_helper
        selector = (root / "system/usr/local/sbin/v-link-firstboot-user").read_text()
        assert "UID_MIN" in selector and "UID_MAX" in selector
        assert "getent passwd 1000" not in selector
        assert "Multiple eligible users" in selector


def test_firstboot_propagates_development_repo_and_ref_to_installer():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        result = stage_firstboot(
            root / "boot", root / "system",
            repository="PabloMartin97/v-link", source_ref="Lite-os-for-pr")
        assert result.returncode == 0, (root / "boot/v-link-firstboot.log").read_text()
        helper = (root / "system/usr/local/sbin/v-link-firstboot-installer").read_text()
        assert '--repo "PabloMartin97/v-link" --ref "Lite-os-for-pr"' in helper


def test_firstboot_installer_uses_tty8_and_returns_to_tty1():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        result = stage_firstboot(root / "boot", root / "system")
        assert result.returncode == 0, (root / "boot/v-link-firstboot.log").read_text()
        unit = (root / "system/etc/systemd/system/v-link-firstboot.service").read_text()
        assert "Conflicts=getty@tty8.service display-manager.service lightdm.service" in unit
        assert "ExecStartPre=-/usr/bin/chvt 8" in unit
        assert "TTYPath=/dev/tty8" in unit
        assert "getty@tty1.service" in unit
        assert "ExecStopPost=-/usr/bin/chvt 1" in unit
        assert "TTYPath=/dev/tty1" not in unit


def test_firstboot_direct_removes_only_its_temporary_cmdline_arguments():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        result = stage_firstboot(root / "boot", root / "system", direct=True)
        assert result.returncode == 0, (root / "boot/v-link-firstboot.log").read_text()
        assert (root / "boot/cmdline.txt").read_text() == "rootwait console=tty1\n"


def test_firstboot_user_selector_waits_for_one_and_rejects_ambiguity():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        result = stage_firstboot(root / "boot", root / "system")
        assert result.returncode == 0
        selector = root / "system/usr/local/sbin/v-link-firstboot-user"
        home_a = root / "human-a"
        home_b = root / "human-b"
        home_a.mkdir()
        home_b.mkdir()
        bin_dir = root / "boot/bin"
        getent = bin_dir / "getent"
        env = {**os.environ, "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"]}
        getent.write_text("#!/bin/sh\nexit 0\n")
        getent.chmod(0o755)
        assert subprocess.run(["bash", str(selector)], env=env, capture_output=True).returncode == 2
        getent.write_text(f'#!/bin/sh\nprintf "%s\\n" "human-a:x:1100:1100::{home_a}:/bin/bash"\n')
        one = subprocess.run(["bash", str(selector)], env=env, capture_output=True, text=True)
        assert one.returncode == 0 and one.stdout.strip() == "human-a"
        getent.write_text(f'#!/bin/sh\nprintf "%s\\n" "human-a:x:1100:1100::{home_a}:/bin/bash" "human-b:x:1101:1101::{home_b}:/bin/bash"\n')
        many = subprocess.run(["bash", str(selector)], env=env, capture_output=True, text=True)
        assert many.returncode == 3 and "Multiple eligible users" in many.stderr


def test_lite_installer_cache_and_cleanup_remain_scoped():
    source = INSTALL.read_text()
    assert 'npm_config_cache="$TEMP_DIR/npm-cache"' in source
    assert "PIP_NO_CACHE_DIR=1" in source
    assert "rm -rf ~/.cache" not in source and "rm -rf ~/.npm" not in source
    assert "/var/log/v-link-firstboot-installer.log" in source
    assert "/boot/firmware/v-link-firstboot-installer.log" in source
    assert "/usr/local/sbin/v-link-firstboot-user" in source


def make_minimal_lite_source(root):
    required_files = (
        "V-Link.py", "requirements.txt", "Update.sh", "backend/server.py",
        "updater/__init__.py", "updater/releases.py", "updater/keepalive.py",
        "resources/dtoverlays/v-link.dtbo",
        "resources/dtoverlays/mcp2515-can1.dtbo",
        "resources/dtoverlays/mcp2515-can2.dtbo", "lite/Install-Lite.sh",
        "lite/Check-Lite.sh",
        "lite/runtime/V-Link-Lite-Boot.sh",
        "lite/runtime/V-Link-Lite-Overlay.py",
        "lite/splash/V-Link-Lite-Prepare-Splash.py",
        "lite/runtime/V-Link-Lite-Session.sh",
        "lite/runtime/V-Link-Lite-Handoff.js",
        "lite/runtime/V-Link-Lite-Terminal.bashrc",
        "lite/V-Link-Lite-Setup.py", "lite/runtime/V-Link-Lite-Cursor.py",
        "lite/lib/v_link_lite_support.py", "lite/lib/v_link_lite_audio.py",
        "lite/lib/v_link_lite_display.py", "lite/splash/Render-Lite-Splash.py",
        "frontend/public/assets/svg/logos/moose.svg",
        "frontend/public/assets/svg/logos/vlink.svg", "frontend/dist/index.html",
    )
    setup_modules = (
        "__init__.py", "ui.py", "navigation.py", "network.py", "audio.py",
        "display.py", "storage.py", "vlink.py", "diagnostics.py", "terminal.py",
    )
    for relative in required_files + tuple(
            f"lite/setup/{module}" for module in setup_modules):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("test\n")


def validate_source_function():
    source = INSTALL.read_text()
    body = source.split("validate_source() {", 1)[1].split(
        "\nvalidate_v_link_imports() {", 1)[0]
    return "validate_source() {" + body


def test_lite_source_validation_requires_complete_updater_package():
    function = validate_source_function()
    script = (
        "set -Eeuo pipefail\n"
        "die() { printf '%s\\n' \"$*\" >&2; exit 1; }\n"
        "validate_lite_session_launcher() { return 0; }\n"
        + function + "\nvalidate_source \"$1\"\n")
    updater_files = (
        "updater/__init__.py", "updater/releases.py", "updater/keepalive.py")

    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / "source"
        make_minimal_lite_source(source)
        valid = subprocess.run(
            ["bash", "-c", script, "bash", str(source)], text=True,
            capture_output=True)
        assert valid.returncode == 0, valid.stderr

        for relative in updater_files:
            missing_source = Path(directory) / relative.replace("/", "-")
            shutil.copytree(source, missing_source)
            (missing_source / relative).unlink()
            result = subprocess.run(
                ["bash", "-c", script, "bash", str(missing_source)], text=True,
                capture_output=True)
            assert result.returncode != 0
            assert f"source is incomplete: missing {relative}" in result.stderr


def preflight_functions():
    source = INSTALL.read_text()
    body = source.split("lite_source_incompatible() {", 1)[1].split(
        "\nvalidate_v_link_imports() {", 1)[0]
    return "lite_source_incompatible() {" + body


def archive_lite_source(source, archive):
    with zipfile.ZipFile(archive, "w") as bundle:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                bundle.write(path, path.relative_to(source).as_posix())


def write_preflight_tools(root):
    fake_bin = root / "bin"
    fake_bin.mkdir()
    curl = fake_bin / "curl"
    curl.write_text('''#!/bin/bash
set -eu
url=""
output=""
while (($#)); do
    case "$1" in
        --output) output="$2"; shift 2 ;;
        http*) url="$1"; shift ;;
        *) shift ;;
    esac
done
case "$url" in
    */releases/latest) cp "$PREFLIGHT_FIXTURES/release.json" "$output" ;;
    */commits/*) cp "$PREFLIGHT_FIXTURES/ref.json" "$output" ;;
    */archive/*.tar.gz) cp "$PREFLIGHT_FIXTURES/source.tar.gz" "$output" ;;
    */V-Link.zip.sha256) cp "$PREFLIGHT_FIXTURES/V-Link.zip.sha256" "$output" ;;
    */V-Link.zip) cp "$PREFLIGHT_FIXTURES/V-Link.zip" "$output" ;;
    *) printf 'unexpected URL: %s\n' "$url" >&2; exit 2 ;;
esac
''')
    curl.chmod(0o755)
    mktemp = fake_bin / "mktemp"
    mktemp.write_text('''#!/bin/bash
set -eu
mkdir -p "$PREFLIGHT_TEMP"
printf '%s\n' "$PREFLIGHT_TEMP"
''')
    mktemp.chmod(0o755)
    return fake_bin


def run_source_preflight(root, *, source_dir="", source_ref=""):
    fake_bin = write_preflight_tools(root)
    script = (
        "set -Eeuo pipefail\n"
        "log() { :; }\n"
        "die() { printf '%s\\n' \"$*\" >&2; exit 1; }\n"
        "validate_lite_session_launcher() { return 0; }\n" +
        validate_source_function() + "\n" + preflight_functions() + "\n"
        'REPOSITORY="example/v-link"\n'
        'SOURCE_DIR="${TEST_SOURCE_DIR:-}"\n'
        'SOURCE_REF="${TEST_SOURCE_REF:-}"\n'
        'TEMP_DIR=""\n'
        "preflight_source\n"
        'printf "validated=%s\\nstaging=%s\\n" "$SOURCE_DIR" "$TEMP_DIR"\n')
    env = {
        **os.environ,
        "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"],
        "PREFLIGHT_FIXTURES": str(root / "fixtures"),
        "PREFLIGHT_TEMP": str(root / "preflight"),
        "TEST_SOURCE_DIR": str(source_dir),
        "TEST_SOURCE_REF": source_ref,
    }
    return subprocess.run(
        ["bash", "-c", script], text=True, capture_output=True, env=env)


def prepare_release_preflight(root, *, manifest=None, missing=(), checksum=True):
    fixtures = root / "fixtures"
    source = root / "release-source"
    fixtures.mkdir()
    make_minimal_lite_source(source)
    shutil.copy2(source / "lite/Check-Lite.sh", source / "Check-Lite.sh")
    if manifest is None:
        manifest = {"commit": "a" * 40, "payload_schema": 2}
    if manifest is not False:
        (source / ".vlink-release.json").write_text(json.dumps(manifest))
    for relative in missing:
        path = source / relative
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()
    archive = fixtures / "V-Link.zip"
    archive_lite_source(source, archive)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (fixtures / "V-Link.zip.sha256").write_text(f"{digest}  V-Link.zip\n")
    assets = [{
        "name": "V-Link.zip",
        "browser_download_url": "https://fixtures.invalid/V-Link.zip",
    }]
    if checksum:
        assets.append({
            "name": "V-Link.zip.sha256",
            "browser_download_url": "https://fixtures.invalid/V-Link.zip.sha256",
        })
    (fixtures / "release.json").write_text(json.dumps({"assets": assets}))
    (fixtures / "ref.json").write_text(json.dumps({"sha": "a" * 40}))
    return source


def test_modern_lite_release_passes_preflight_and_keeps_staging(tmp_path):
    prepare_release_preflight(tmp_path)

    result = run_source_preflight(tmp_path)

    assert result.returncode == 0, result.stderr
    assert f"validated={tmp_path / 'preflight/source'}" in result.stdout
    assert f"staging={tmp_path / 'preflight'}" in result.stdout
    assert (tmp_path / "preflight/source/lite/Install-Lite.sh").is_file()


def test_lite_release_preflight_rejects_missing_or_legacy_manifest(tmp_path):
    cases = (
        (False, "without-manifest"),
        ({"commit": "a" * 40}, "legacy-manifest"),
        ({"payload_schema": 2}, "missing-commit"),
        ({"commit": "not-a-sha", "payload_schema": 2}, "invalid-commit"),
        ({"commit": "a" * 40, "payload_schema": 1}, "schema-1"),
        ({"commit": "a" * 40, "payload_schema": 3}, "schema-3"),
    )
    for manifest, name in cases:
        case_root = tmp_path / name
        case_root.mkdir()
        prepare_release_preflight(case_root, manifest=manifest)

        result = run_source_preflight(case_root)

        assert result.returncode != 0, name
        assert "payload_schema 2 is required" in result.stderr
        assert "No system changes were made" in result.stderr


def test_lite_release_preflight_rejects_incomplete_payloads(tmp_path):
    cases = (
        ("lite/Install-Lite.sh", "Lite runtime"),
        ("updater", "updater"),
        ("Check-Lite.sh", "Check-Lite.sh"),
        ("frontend/dist/index.html", "frontend build"),
    )
    for missing, label in cases:
        case_root = tmp_path / missing.replace("/", "-")
        case_root.mkdir()
        prepare_release_preflight(case_root, missing=(missing,))

        result = run_source_preflight(case_root)

        assert result.returncode != 0, label
        assert "No system changes were made" in result.stderr


def test_lite_release_preflight_requires_dedicated_checksum_asset(tmp_path):
    prepare_release_preflight(tmp_path, checksum=False)

    result = run_source_preflight(tmp_path)

    assert result.returncode != 0
    assert "V-Link.zip.sha256" in result.stderr
    assert "No system changes were made" in result.stderr


def test_branch_and_local_pre_lite_sources_fail_preflight(tmp_path):
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    incomplete = tmp_path / "pre-lite"
    incomplete.mkdir()
    (incomplete / "V-Link.py").write_text("pre-Lite\n")
    (fixtures / "ref.json").write_text(json.dumps({"sha": "a" * 40}))
    with tarfile.open(fixtures / "source.tar.gz", "w:gz") as bundle:
        bundle.add(incomplete, arcname="v-link-old")
    (fixtures / "release.json").write_text(json.dumps({"assets": []}))

    branch = run_source_preflight(tmp_path, source_ref="old-branch")
    assert branch.returncode != 0
    assert "required Lite runtime files" in branch.stderr
    assert "No system changes were made" in branch.stderr

    shutil.rmtree(tmp_path / "bin")
    shutil.rmtree(tmp_path / "preflight")
    local = run_source_preflight(tmp_path, source_dir=incomplete)
    assert local.returncode != 0
    assert "required Lite runtime files" in local.stderr
    assert "No system changes were made" in local.stderr


def test_source_preflight_precedes_apt_and_staging_is_not_downloaded_again():
    source = INSTALL.read_text()
    call = source.index("\npreflight_source\n")
    apt = source.index("\napt-get update\n")
    phase_three = source.split('show_phase 3 7 "V-Link source"', 1)[1].split(
        'show_phase 4 7 "Frontend"', 1)[0]

    assert call < apt
    assert "curl " not in phase_three
    assert "extract_safe" not in phase_three
    assert 'SOURCE_DIR="$TEMP_DIR/source"' not in phase_three
    assert "Using the Lite-compatible source validated" in phase_three


def app_transaction_functions():
    source = INSTALL.read_text()
    functions = source.split("restore_app_path() {", 1)[1].split(
        "\non_error() {", 1)[0]
    return "restore_app_path() {" + functions


def test_lite_runtime_installs_updater_as_a_transactional_directory():
    install = INSTALL.read_text()
    runtime = install.split('log "Installing V-Link application files"', 1)[1].split(
        'log "Creating the Python virtual environment"', 1)[0]
    assert 'replace_app_directory "$SOURCE_DIR/updater" "$APP_DIR/updater"' in runtime

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        source = root / "source/updater"
        destination = root / "app/updater"
        source.mkdir(parents=True)
        destination.mkdir(parents=True)
        for filename in ("__init__.py", "releases.py", "keepalive.py"):
            (source / filename).write_text(f"new {filename}\n")
        (destination / "releases.py").write_text("old updater\n")
        script = (
            "set -Eeuo pipefail\n" + app_transaction_functions() + "\n"
            "APP_CHANGED_PATHS=()\nAPP_TRANSACTION=true\n"
            'replace_app_directory "$1" "$2"\ncommit_app_transaction\n')
        result = subprocess.run(
            ["bash", "-c", script, "bash", str(source), str(destination)],
            text=True, capture_output=True)
        assert result.returncode == 0, result.stderr
        for filename in ("__init__.py", "releases.py", "keepalive.py"):
            assert (destination / filename).read_text() == f"new {filename}\n"
        assert not Path(str(destination) + ".v-link-old").exists()


def test_lite_runtime_installs_lite_source_as_a_transactional_directory():
    install = INSTALL.read_text()
    runtime = install.split('log "Installing V-Link application files"', 1)[1].split(
        'log "Creating the Python virtual environment"', 1)[0]
    assert 'replace_app_directory "$SOURCE_DIR/lite" "$APP_DIR/lite"' in runtime

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        source = root / "source/lite"
        destination = root / "app/lite"
        source.mkdir(parents=True)
        destination.mkdir(parents=True)
        (source / "Install-Lite.sh").write_text("new installer\n")
        (source / "Check-Lite.sh").write_text("new check\n")
        (destination / "Install-Lite.sh").write_text("old installer\n")
        script = (
            "set -Eeuo pipefail\n" + app_transaction_functions() + "\n"
            "APP_CHANGED_PATHS=()\nAPP_TRANSACTION=true\n"
            'replace_app_directory "$1" "$2"\ncommit_app_transaction\n')
        result = subprocess.run(
            ["bash", "-c", script, "bash", str(source), str(destination)],
            text=True, capture_output=True)
        assert result.returncode == 0, result.stderr
        assert (destination / "Install-Lite.sh").read_text() == "new installer\n"
        assert (destination / "Check-Lite.sh").read_text() == "new check\n"
        assert not Path(str(destination) + ".v-link-old").exists()


def test_lite_runtime_rolls_back_lite_source_after_later_failure():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        source = root / "source/lite"
        destination = root / "app/lite"
        source.mkdir(parents=True)
        destination.mkdir(parents=True)
        (source / "Install-Lite.sh").write_text("incomplete new installer\n")
        (destination / "Install-Lite.sh").write_text("known good installer\n")
        script = (
            "set -Eeuo pipefail\n" + app_transaction_functions() + "\n"
            "APP_CHANGED_PATHS=()\nAPP_TRANSACTION=true\n"
            'replace_app_directory "$1" "$2"\n'
            'for ((index=${#APP_CHANGED_PATHS[@]} - 1; index >= 0; index--)); do\n'
            '  restore_app_path "${APP_CHANGED_PATHS[index]}"\n'
            "done\n")
        result = subprocess.run(
            ["bash", "-c", script, "bash", str(source), str(destination)],
            text=True, capture_output=True)
        assert result.returncode == 0, result.stderr
        assert (destination / "Install-Lite.sh").read_text() == "known good installer\n"
        assert not Path(str(destination) + ".v-link-old").exists()


def recovery_helper_source():
    source = INSTALL.read_text()
    marker = 'cat >"$TARGET_HOME/.local/libexec/v-link-recover-update" <<\'EOF\'\n'
    return source.split(marker, 1)[1].split("\nEOF\n", 1)[0] + "\n"


def test_interrupted_update_recovery_restores_updater_directory():
    helper_source = recovery_helper_source()
    assert "V-Link.py backend frontend updater lite resources" in helper_source

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        app = root / "v-link"
        transaction = root / ".v-link-update.test"
        backup = transaction / "backup/updater"
        (app / "updater").mkdir(parents=True)
        backup.mkdir(parents=True)
        (app / "updater/releases.py").write_text("incomplete update\n")
        (backup / "releases.py").write_text("known good\n")
        (root / ".v-link-update-active").write_text(
            f"{transaction}\n{app}\n")
        helper = root / "recover"
        helper.write_text(helper_source)
        helper.chmod(0o755)

        result = subprocess.run(
            ["bash", str(helper), "--lock-held", str(app)], text=True,
            capture_output=True)
        assert result.returncode == 0, result.stderr
        assert (app / "updater/releases.py").read_text() == "known good\n"
        assert not (root / ".v-link-update-active").exists()
        assert not transaction.exists()


def test_interrupted_update_recovery_restores_lite_directory():
    helper_source = recovery_helper_source()

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        app = root / "v-link"
        transaction = root / ".v-link-update.test"
        backup = transaction / "backup/lite"
        (app / "lite").mkdir(parents=True)
        backup.mkdir(parents=True)
        (app / "lite/Install-Lite.sh").write_text("incomplete update\n")
        (backup / "Install-Lite.sh").write_text("known good\n")
        (root / ".v-link-update-active").write_text(f"{transaction}\n{app}\n")
        helper = root / "recover"
        helper.write_text(helper_source)
        helper.chmod(0o755)

        result = subprocess.run(
            ["bash", str(helper), "--lock-held", str(app)], text=True,
            capture_output=True)
        assert result.returncode == 0, result.stderr
        assert (app / "lite/Install-Lite.sh").read_text() == "known good\n"
        assert not (root / ".v-link-update-active").exists()
        assert not transaction.exists()


def test_lite_health_check_requires_complete_updater_package():
    check = CHECK.read_text()
    application = check.split("printf '\\nApplication\\n'", 1)[1]
    for relative in ("__init__.py", "releases.py", "keepalive.py"):
        assert f'"$APP_DIR/updater/{relative}"' in application


def test_lite_health_check_requires_versioned_lite_source():
    check = CHECK.read_text()
    application = check.split("printf '\\nApplication\\n'", 1)[1]
    for relative in ("Install-Lite.sh", "Check-Lite.sh"):
        assert f'"$APP_DIR/lite/{relative}"' in application


def test_runtime_resources_scope_is_only_device_tree_overlays():
    installer = INSTALL.read_text()
    package = (ROOT / "Package.sh").read_text()
    updater = (ROOT / "updater/releases.py").read_text()

    assert 'replace_app_directory "$SOURCE_DIR/resources/dtoverlays" "$APP_DIR/resources/dtoverlays"' in installer
    assert 'cp -a resources/dtoverlays/. "$STAGE/package/resources/dtoverlays/"' in package
    assert '"resources/dtoverlays"' in updater
    assert 'replace_app_directory "$SOURCE_DIR/resources" "$APP_DIR/resources"' not in installer
    assert 'cp -a resources/. "$STAGE/package/resources/"' not in package


def test_lite_health_check_requires_critical_runtime_scripts_to_be_executable():
    check = CHECK.read_text()
    executable_check = "for executable_path in" + check.split(
        "for executable_path in", 1)[1].split("\ndone", 1)[0] + "\ndone"
    for relative in ("V-Link.py", "Update.sh", "Check-Lite.sh"):
        assert f'"$APP_DIR/{relative}"' in executable_check
    assert '[[ -x "$executable_path" ]]' in executable_check
    assert 'fail "not executable: $executable_path"' in executable_check

    with tempfile.TemporaryDirectory() as directory:
        app = Path(directory)
        for relative in ("V-Link.py", "Update.sh", "Check-Lite.sh"):
            target = app / relative
            target.touch()
            target.chmod(0o755)
        (app / "Update.sh").chmod(0o644)
        script = (
            "set -Eeuo pipefail\nfailures=0\n"
            "pass() { :; }\nfail() { failures=$((failures + 1)); }\n" +
            executable_check + "\nprintf '%s\\n' \"$failures\"\n")
        result = subprocess.run(
            ["bash", "-c", script, "bash"], text=True, capture_output=True,
            env={**os.environ, "APP_DIR": str(app)})
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "1"


def test_lite_installer_keeps_full_v_link_import_validation():
    installer = INSTALL.read_text()
    import_check = installer.split("validate_v_link_imports() {", 1)[1].split(
        "\nfrontend_source_hash() {", 1)[0]
    assert 'cd "$1"' in import_check
    assert 'exec "$2" "$1/V-Link.py" --help' in import_check
    assert installer.count("validate_v_link_imports") >= 3


def installer_function(name, next_name):
    source = INSTALL.read_text()
    body = source.split(f"{name}() {{", 1)[1].split(
        f"\n{next_name}() {{", 1)[0]
    return f"{name}() {{" + body


def test_repository_validation_accepts_github_names_and_rejects_urls_and_paths():
    function = installer_function("validate_repository", "node_is_compatible")
    valid = ("BoostedMoose/v-link", "PabloMartin97/v-link", "owner/repo.js")
    invalid = (
        "invalid", "owner/", "https://github.com/foo/bar", "../../foo",
        "/foo/bar", "foo/bar/baz", "-owner/repo", "owner-/repo", "owner/..",
        "owner/repo name", "owner//repo", "",
    )
    for repository in valid:
        result = subprocess.run(
            ["bash", "-c", function + '\nvalidate_repository "$1"',
             "bash", repository], capture_output=True)
        assert result.returncode == 0, repository
    for repository in invalid:
        result = subprocess.run(
            ["bash", "-c", function + '\nvalidate_repository "$1"',
             "bash", repository], capture_output=True)
        assert result.returncode != 0, repository


def run_repository_selector(user_input):
    functions = (
        installer_function("validate_repository", "node_is_compatible") + "\n" +
        installer_function("select_repository", "fetch_github_branch_names"))
    script = (
        "set -Eeuo pipefail\n"
        "show_interactive_screen() { :; }\n"
        "DEFAULT_REPOSITORY=BoostedMoose/v-link\n"
        "REPOSITORY=$DEFAULT_REPOSITORY\n" + functions + "\n"
        "select_repository\nprintf '%s\\n' \"$REPOSITORY\"\n")
    return subprocess.run(
        ["bash", "-c", script], input=user_input, text=True,
        capture_output=True)


def test_repository_selector_supports_official_fork_and_validated_custom_repo():
    assert run_repository_selector("\n").stdout.splitlines()[-1] == "BoostedMoose/v-link"
    assert run_repository_selector("2\n").stdout.splitlines()[-1] == "PabloMartin97/v-link"
    custom = run_repository_selector("3\ninvalid\n3\nexample/custom-repo\n")
    assert custom.returncode == 0, custom.stderr
    assert "Invalid GitHub repository" in custom.stdout
    assert custom.stdout.splitlines()[-1] == "example/custom-repo"


def test_repository_option_and_all_v_link_github_operations_use_selected_repo():
    source = INSTALL.read_text()
    parser = source.split("while (($#)); do", 1)[1].split(
        'show_phase 1 7 "Setup"', 1)[0]
    assert 'readonly DEFAULT_REPOSITORY="BoostedMoose/v-link"' in source
    assert 'REPOSITORY="$DEFAULT_REPOSITORY"' in source
    assert "--repo)" in parser
    assert 'REPOSITORY="$2"' in parser
    assert "REPOSITORY_EXPLICIT=true" in parser
    assert 'validate_repository "$REPOSITORY"' in source
    assert "https://api.github.com/repos/$REPOSITORY/branches?per_page=100" in source
    assert "https://api.github.com/repos/$REPOSITORY/commits/$encoded_ref" in source
    assert source.count(
        "https://api.github.com/repos/$REPOSITORY/releases/latest") == 1
    assert '"https://github.com/$REPOSITORY/archive/$source_sha.tar.gz"' in source
    for fixed_url in (
            "api.github.com/repos/PabloMartin97/v-link",
            "api.github.com/repos/BoostedMoose/v-link",
            "github.com/PabloMartin97/v-link.git",
            "github.com/BoostedMoose/v-link.git"):
        assert fixed_url not in source


def run_source_selector(user_input, local_checkout=""):
    function = installer_function("select_install_source", "select_hardware_mode")
    script = (
        "set -Eeuo pipefail\n"
        "show_interactive_screen() { :; }\n"
        "select_github_branch() { SOURCE_REF=chosen-ref; }\n"
        "SOURCE_DIR=before\nSOURCE_REF=before\n" + function + "\n"
        'select_install_source "$1"\n'
        "printf 'dir=%s\\nref=%s\\n' \"$SOURCE_DIR\" \"$SOURCE_REF\"\n")
    return subprocess.run(
        ["bash", "-c", script, "bash", local_checkout], input=user_input,
        text=True, capture_output=True)


def test_source_selector_defaults_to_release_and_keeps_branch_and_local_choices():
    release = run_source_selector("\n")
    assert release.returncode == 0, release.stderr
    assert release.stdout.endswith("dir=\nref=\n")

    branch = run_source_selector("2\n")
    assert branch.returncode == 0, branch.stderr
    assert branch.stdout.endswith("dir=\nref=chosen-ref\n")

    local = run_source_selector("3\n", "/checkout")
    assert local.returncode == 0, local.stderr
    assert local.stdout.endswith("dir=/checkout\nref=\n")


def test_release_is_reachable_without_ref_and_local_source_stays_explicit():
    source = INSTALL.read_text()
    decisions = source.split('if [[ "$ASSUME_YES" != true ]]; then', 1)[1].split(
        '[[ -z "$LIN_PORT" || "$CONFIGURE_HARDWARE" == true ]]', 1)[0]
    preflight = source.split("preflight_source() {", 1)[1].split(
        "\nvalidate_v_link_imports() {", 1)[0]
    assert "current published release lacks the Lite installation payload" not in source
    assert 'SOURCE_DIR="$LOCAL_SOURCE_CANDIDATE"' not in decisions
    assert 'if [[ -n "$SOURCE_DIR" ]]; then' in preflight
    assert "https://api.github.com/repos/$REPOSITORY/releases/latest" in preflight
    assert 'SOURCE_DIR="$(realpath "$SOURCE_DIR")"' in preflight
    source_phase = source.split('show_phase 3 7 "V-Link source"', 1)[1].split(
        'show_phase 4 7 "Frontend"', 1)[0]
    assert "curl " not in source_phase
    assert "validated before system package installation" in source_phase


def test_interactive_flow_keeps_repository_source_and_hardware_independent():
    source = INSTALL.read_text()
    interactive = source.split('if [[ "$ASSUME_YES" != true ]]; then', 1)[1].split(
        '[[ -z "$LIN_PORT" || "$CONFIGURE_HARDWARE" == true ]]', 1)[0]
    parser = source.split("while (($#)); do", 1)[1].split(
        'show_phase 1 7 "Setup"', 1)[0]
    hardware = parser.split("--hardware)", 1)[1].split("--no-reboot)", 1)[0]

    assert interactive.index("select_repository") < interactive.index(
        "select_install_source") < interactive.index("select_hardware_mode")
    assert '[[ "$REPOSITORY_EXPLICIT" != true ]]' in interactive
    assert '[[ "$SOURCE_CHOICE_EXPLICIT" != true ]]' in interactive
    assert '[[ "$HARDWARE_CHOICE_EXPLICIT" != true ]]' in interactive
    assert "REPOSITORY" not in hardware
    assert "SOURCE_REF" not in hardware
    assert "SOURCE_DIR" not in hardware
    assert "CONFIGURE_HARDWARE=true" in hardware
    assert "CONFIGURE_HARDWARE=false" in hardware


def test_usage_and_install_plan_describe_repository_and_release_defaults():
    source = INSTALL.read_text()
    usage = source.split("usage() {", 1)[1].split("\nlog() {", 1)[0]
    plan = source.split("show_install_plan() {", 1)[1].split(
        "\nvalidate_source() {", 1)[0]
    assert "--repo OWNER/REPO" in usage
    assert "default: BoostedMoose/v-link" in usage
    assert "PabloMartin97/v-link --ref Lite-os-for-pr" in usage
    assert "Latest stable release" in plan
    assert "Repository: %s" in plan


def test_branch_selector_has_no_recommended_or_automatic_lite_choice():
    source = INSTALL.read_text()
    selector = source.split("select_github_branch() {", 1)[1].split(
        "\nselect_install_source() {", 1)[0]
    assert "recommended Lite test" not in selector
    assert "default_index" not in selector
    assert "Select branch number: " in selector
    assert '[[ -n "$choice" ]] || choice=' not in selector


def test_interactive_steps_clear_and_network_blocks_source_selection():
    source = INSTALL.read_text()
    clear = source.split("clear_screen() {", 1)[1].split("\nshow_interactive_screen() {", 1)[0]
    wait = source.split("wait_for_internet() {", 1)[1].split(
        "\ncleanup_first_boot_stage() {", 1)[0]
    main = source.split('if [[ "$ASSUME_YES" != true ]]; then', 1)[1].split(
        '[[ -z "$LIN_PORT" || "$CONFIGURE_HARDWARE" == true ]]', 1)[0]

    assert "-t 0 && -w /dev/tty" in clear
    assert 'output=/dev/tty' in clear
    assert 'tput clear >"$output"' in clear
    assert "Waiting for network..." in wait
    assert "internet_available" in wait
    assert "read -r -t 3" in wait
    assert main.index("wait_for_internet") < main.index("select_repository")
    assert main.index("wait_for_internet") < main.index("select_install_source")
    for title in ("Repository", "Installation source", "Source branch", "Hardware", "Confirmation"):
        assert f'show_interactive_screen "{title}"' in source


def test_overlay_has_normal_handoff_and_bounded_fail_open():
    source = (ROOT / "lite/runtime/V-Link-Lite-Overlay.py").read_text()
    assert "if READY.is_set():" in source
    assert "SLOW_BOOT_SECONDS = 45" in source
    assert "MAX_COVER_SECONDS = 120" in source
    assert "HANDOFF_GRACE_MS = 500" in source
    assert "Continue to V-Link" in source
    assert "self.window.destroy()" in source.split("def absolute_timeout", 1)[1]
    tree = ast.parse(source)
    overlay = next(node for node in tree.body if isinstance(node, ast.ClassDef)
                   and node.name == "Overlay")
    methods = [node for node in overlay.body if isinstance(node, ast.FunctionDef)
               and node.name in {"schedule_handoff", "finish_handoff",
                                 "check_handoff", "absolute_timeout"}]

    class Glib:
        calls = []

        @classmethod
        def timeout_add(cls, delay, callback):
            cls.calls.append((delay, callback))

    namespace = {"GLib": Glib, "HANDOFF_GRACE_MS": 500}
    exec(compile(ast.Module(body=methods, type_ignores=[]), "overlay-methods", "exec"), namespace)

    class Window:
        destroyed = False

        def destroy(self):
            self.destroyed = True

    class Ready:
        value = False

        def is_set(self):
            return self.value

    namespace["READY"] = Ready()
    instance = type("FakeOverlay", (), {
        "window": Window(),
        "handoff_scheduled": False,
        "schedule_handoff": namespace["schedule_handoff"],
        "finish_handoff": namespace["finish_handoff"],
    })()
    assert namespace["check_handoff"](instance) is True
    assert not instance.window.destroyed
    assert namespace["absolute_timeout"](instance) is False
    assert instance.window.destroyed
    instance.window.destroyed = False
    namespace["READY"].value = True
    assert namespace["check_handoff"](instance) is False
    assert not instance.window.destroyed
    assert len(Glib.calls) == 1 and Glib.calls[0][0] == 500
    assert namespace["check_handoff"](instance) is False
    assert len(Glib.calls) == 1
    assert Glib.calls[0][1]() is False
    assert instance.window.destroyed
    instance.window.destroyed = False
    assert namespace["absolute_timeout"](instance) is False
    assert not instance.window.destroyed


def installer_transaction_functions():
    source = INSTALL.read_text()
    functions = source.split("platform_sha256() {", 1)[1].split("\nusage() {", 1)[0]
    return "platform_sha256() {" + functions


def test_platform_rollback_restores_each_write_without_a_later_checkpoint():
    functions = installer_transaction_functions()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        first = root / "first.conf"
        second = root / "second.conf"
        backup = root / "backup"
        backup.mkdir()
        first.write_text("original A")
        second.write_text("original B")
        shutil.copy2(first, backup / "0")
        shutil.copy2(second, backup / "1")
        script = ("set -Eeuo pipefail\n" + functions + "\n"
                  'PLATFORM_PATHS=("$1" "$2")\nPLATFORM_BACKUP="$3"\n'
                  'platform_fingerprint "$1" >"$3/0.original"\n'
                  'platform_fingerprint "$2" >"$3/1.original"\n'
                  'printf "installer A" >"$1"\nplatform_path_written "$1"\n'
                  'printf "installer B" >"$2"\nplatform_path_written "$2"\n'
                  'rollback_platform_files\n')
        result = subprocess.run(
            ["bash", "-c", script, "bash", str(first), str(second), str(backup)],
            text=True, capture_output=True)
        assert result.returncode == 0, result.stderr
        assert first.read_text() == "original A"
        assert second.read_text() == "original B"
        assert "Managed Lite platform files restored" in result.stderr


def test_platform_rollback_preserves_external_change_after_installer_write():
    functions = installer_transaction_functions()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        target = root / "managed.conf"
        backup = root / "backup"
        backup.mkdir()
        target.write_text("original")
        shutil.copy2(target, backup / "0")
        script = ("set -Eeuo pipefail\n" + functions + "\n"
                  'PLATFORM_PATHS=("$1")\nPLATFORM_BACKUP="$2"\n'
                  'platform_fingerprint "$1" >"$2/0.original"\n'
                  'printf installer >"$1"\nplatform_path_written "$1"\n'
                  'printf external >"$1"\nrollback_platform_files\n')
        result = subprocess.run(
            ["bash", "-c", script, "bash", str(target), str(backup)],
            text=True, capture_output=True)
        assert result.returncode == 0, result.stderr
        assert target.read_text() == "external"
        assert "changed after installation" in result.stderr
        assert "rollback was partial" in result.stderr


def test_lite_session_asset_and_generated_desktop_are_valid():
    session = SESSION.read_text()
    install = INSTALL.read_text()
    check = CHECK.read_text()

    assert session.startswith("#!/bin/sh\n")
    assert "export WLR_SCENE_DISABLE_VISIBILITY=1" in session
    assert "exec /usr/bin/labwc" in session
    assert "WLR_SCENE_DISABLE_DIRECT_SCANOUT" not in session
    assert "Exec=/usr/local/libexec/v-link-lite-session" in install
    assert "DesktopNames=labwc;wlroots" in install
    assert "user-session=v-link-lite" in install
    assert "autologin-session=v-link-lite" in install
    assert "WLR_SCENE_DISABLE_VISIBILITY=1" in check
    assert "running labwc has the wlroots visibility workaround" in check


def test_lite_terminal_help_is_installed_and_managed():
    install = INSTALL.read_text()
    check = CHECK.read_text()
    terminal = TERMINAL_RC.read_text()
    setup_terminal = (ROOT / "lite/setup/terminal.py").read_text().splitlines()

    assert "lite/runtime/V-Link-Lite-Terminal.bashrc" in install
    assert "/usr/local/share/v-link-lite/terminal.bashrc" in install
    assert "platform_path_written /usr/local/share/v-link-lite/terminal.bashrc" in install
    assert "Lite maintenance terminal help is installed root:root 0644" in check
    health_check = check.split(
        "if [[ -f /usr/local/share/v-link-lite/terminal.bashrc", 1)[1].split("\nfi", 1)[0]
    assert "-f /usr/local/lib/v-link-lite/setup/terminal.py" in health_check
    assert "! -L /usr/local/lib/v-link-lite/setup/terminal.py" in health_check
    assert "grep -qFx" in health_check
    assert 'TERMINAL_RC = "/usr/local/share/v-link-lite/terminal.bashrc"' in health_check
    assert "/usr/local/bin/v-link-lite-setup" not in health_check
    assert 'TERMINAL_RC = "/usr/local/share/v-link-lite/terminal.bashrc"' in setup_terminal
    assert "help()" in terminal
    assert "exit          Return to V-Link Lite Setup" in terminal
    assert 'builtin help "$@"' in terminal


def test_lite_setup_package_is_installed_inside_platform_transaction():
    install = INSTALL.read_text()
    check = CHECK.read_text()
    modules = ("__init__.py", "ui.py", "navigation.py", "network.py", "audio.py",
               "display.py", "storage.py", "vlink.py", "diagnostics.py", "terminal.py")

    assert install.index("begin_platform_files") < install.index(
        "install -d -o root -g root -m 0755 /usr/local/lib/v-link-lite/setup")
    for module in modules:
        installed = f"/usr/local/lib/v-link-lite/setup/{module}"
        assert installed in install
        assert (ROOT / "lite/setup" / module).is_file()
    assert 'platform_path_written "/usr/local/lib/v-link-lite/setup/$setup_module"' in install
    assert "Lite Setup modular package is installed root-owned and importable" in check


def test_lite_session_is_installed_before_lightdm_selects_it():
    install = INSTALL.read_text()
    launcher = install.index(
        "validate_lite_session_launcher \"$LITE_SESSION_LAUNCHER\"", 1000)
    desktop = install.index("platform_path_written \"$LITE_SESSION_DESKTOP\"")
    lightdm = install.index("user-session=v-link-lite", desktop)
    migration = install.index(
        'restore_known_experimental_labwc_desktop "$EXPERIMENTAL_LABWC_DESKTOP"')

    assert launcher < desktop < lightdm < migration
    assert 'user-session=labwc\nautologin-session=labwc' not in install
    assert "v-link-lite-session" not in (ROOT / "Update.sh").read_text()


def run_lite_migration(root, labwc_text, wrapper_text, direct_scanout_text):
    functions = installer_transaction_functions()
    labwc = root / "labwc.desktop"
    wrapper = root / "v-link-labwc-visibility-test"
    direct_scanout = root / "90-v-link-direct-scanout-test.env"
    expected_wrapper = root / "expected-wrapper"
    expected_direct_scanout = root / "expected-direct-scanout"
    backup = root / "backup"
    backup.mkdir()
    labwc.write_text(labwc_text)
    wrapper.write_text(wrapper_text)
    direct_scanout.write_text(direct_scanout_text)
    expected_wrapper.write_text(
        "#!/bin/sh\nexport WLR_SCENE_DISABLE_VISIBILITY=1\nexec /usr/bin/labwc\n")
    expected_direct_scanout.write_text("WLR_SCENE_DISABLE_DIRECT_SCANOUT=1\n")
    script = (
        "set -Eeuo pipefail\n" + functions + "\n"
        'PLATFORM_PATHS=("$1" "$2" "$3")\nPLATFORM_BACKUP="$4"\n'
        'for index in "${!PLATFORM_PATHS[@]}"; do\n'
        '  path="${PLATFORM_PATHS[index]}"\n'
        '  platform_fingerprint "$path" >"$PLATFORM_BACKUP/$index.original"\n'
        '  cp -a -- "$path" "$PLATFORM_BACKUP/$index"\n'
        'done\n'
        'restore_known_experimental_labwc_desktop "$1"\n'
        'if remove_known_experimental_file "$2" "$5"; then :; fi\n'
        'if remove_known_experimental_file "$3" "$6"; then :; fi\n'
        '# A repeated migration must be a no-op.\n'
        'restore_known_experimental_labwc_desktop "$1"\n'
        'if remove_known_experimental_file "$2" "$5"; then :; fi\n'
        'if remove_known_experimental_file "$3" "$6"; then :; fi\n')
    result = subprocess.run(
        ["bash", "-c", script, "bash", str(labwc), str(wrapper),
         str(direct_scanout), str(backup), str(expected_wrapper),
         str(expected_direct_scanout)], text=True, capture_output=True)
    return result, labwc, wrapper, direct_scanout


def test_known_experimental_session_is_migrated_idempotently():
    with tempfile.TemporaryDirectory() as directory:
        result, labwc, wrapper, direct_scanout = run_lite_migration(
            Path(directory),
            "[Desktop Entry]\nName=labwc\n"
            "Exec=/usr/local/bin/v-link-labwc-visibility-test\nType=Application\n",
            "#!/bin/sh\nexport WLR_SCENE_DISABLE_VISIBILITY=1\nexec /usr/bin/labwc\n",
            "WLR_SCENE_DISABLE_DIRECT_SCANOUT=1\n")

        assert result.returncode == 0, result.stderr
        assert "Exec=labwc\n" in labwc.read_text()
        assert not wrapper.exists()
        assert not direct_scanout.exists()


def test_unknown_experimental_files_are_preserved():
    with tempfile.TemporaryDirectory() as directory:
        result, labwc, wrapper, direct_scanout = run_lite_migration(
            Path(directory),
            "[Desktop Entry]\nName=custom\nExec=/opt/custom-labwc\n",
            "#!/bin/sh\nexec /opt/custom-labwc\n",
            "USER_OWNED_SETTING=1\n")

        assert result.returncode == 0, result.stderr
        assert "Exec=/opt/custom-labwc" in labwc.read_text()
        assert wrapper.read_text() == "#!/bin/sh\nexec /opt/custom-labwc\n"
        assert direct_scanout.read_text() == "USER_OWNED_SETTING=1\n"


def test_session_installation_checkpoints_are_rolled_back_on_failure():
    functions = installer_transaction_functions()
    names = ("v-link-lite-session", "v-link-lite.desktop", "50-v-link-lite.conf")
    for fail_after in range(1, len(names) + 1):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = [root / name for name in names]
            backup = root / "backup"
            backup.mkdir()
            paths[2].write_text("original LightDM\n")
            shutil.copy2(paths[2], backup / "2")
            (backup / "0.absent").touch()
            (backup / "1.absent").touch()
            script = (
                "set -Eeuo pipefail\n" + functions + "\n"
                'PLATFORM_PATHS=("$1" "$2" "$3")\nPLATFORM_BACKUP="$4"\n'
                'for index in "${!PLATFORM_PATHS[@]}"; do\n'
                '  platform_fingerprint "${PLATFORM_PATHS[index]}" '
                '>"$PLATFORM_BACKUP/$index.original"\n'
                'done\n'
                'for ((index=0; index<$5; index++)); do\n'
                '  printf "installed %s\\n" "$index" >"${PLATFORM_PATHS[index]}"\n'
                '  platform_path_written "${PLATFORM_PATHS[index]}"\n'
                'done\n'
                'rollback_platform_files\n')
            result = subprocess.run(
                ["bash", "-c", script, "bash", *map(str, paths), str(backup),
                 str(fail_after)], text=True, capture_output=True)
            assert result.returncode == 0, result.stderr
            assert not paths[0].exists()
            assert not paths[1].exists()
            assert paths[2].read_text() == "original LightDM\n"


def test_lite_installer_does_not_manage_general_labwc_environment():
    install = INSTALL.read_text()
    assert '"$USER_CONFIG_DIR/labwc/environment"' not in install
    assert install.count("WLR_SCENE_DISABLE_DIRECT_SCANOUT=1") == 1


def write_mock_systemctl(path):
    path.write_text(r'''#!/usr/bin/env bash
set -Eeuo pipefail
IFS='|' read -r load enabled active <"$MOCK_SYSTEMCTL_STATE"
command="$1"
shift
case "$command" in
    show) printf '%s\n' "$load"; exit 0 ;;
    is-enabled) printf '%s\n' "$enabled"; exit 0 ;;
    is-active) printf '%s\n' "$active"; exit 0 ;;
esac
[[ "$load" != not-found ]] || exit 1
case "$command" in
    unmask) [[ "$enabled" != masked && "$enabled" != masked-runtime ]] || enabled=disabled ;;
    disable)
        enabled=disabled
        [[ " $* " != *" --now "* ]] || active=inactive
        ;;
    enable)
        if [[ " $* " == *" --runtime "* ]]; then enabled=enabled-runtime; else enabled=enabled; fi
        ;;
    mask)
        if [[ " $* " == *" --runtime "* ]]; then enabled=masked-runtime; else enabled=masked; fi
        ;;
    start) active=active ;;
    stop) active=inactive ;;
    *) exit 2 ;;
esac
printf '%s|%s|%s\n' "$load" "$enabled" "$active" >"$MOCK_SYSTEMCTL_STATE"
''')
    path.chmod(0o755)


def run_hciuart_rollback(root, original, installer_commands, after_mark=""):
    functions = installer_transaction_functions()
    state = root / "systemctl.state"
    state.write_text(original + "\n")
    bin_dir = root / "bin"
    bin_dir.mkdir()
    write_mock_systemctl(bin_dir / "systemctl")
    script = ("set -Eeuo pipefail\n" + functions + "\n"
              'HCIUART_TRACKED=false\nHCIUART_ORIGINAL=""\nHCIUART_EXPECTED=""\n'
              'track_hciuart_state\n' + installer_commands + '\n'
              'hciuart_state_written\n' + after_mark + '\n'
              'rollback_hciuart_state\nhciuart_snapshot\n')
    return subprocess.run(
        ["bash", "-c", script], text=True, capture_output=True,
        env={**os.environ, "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
             "MOCK_SYSTEMCTL_STATE": str(state)})


def test_hciuart_rollback_restores_previous_enabled_and_active_state():
    with tempfile.TemporaryDirectory() as directory:
        result = run_hciuart_rollback(
            Path(directory), "loaded|enabled|active",
            "systemctl disable --now hciuart.service\nsystemctl mask hciuart.service")
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "loaded|enabled|active"
        assert "Previous hciuart state restored" in result.stderr


def test_hciuart_rollback_restores_previous_masked_and_inactive_state():
    with tempfile.TemporaryDirectory() as directory:
        result = run_hciuart_rollback(
            Path(directory), "loaded|masked|inactive",
            "systemctl unmask hciuart.service\nsystemctl enable hciuart.service")
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "loaded|masked|inactive"
        assert "Previous hciuart state restored" in result.stderr


def test_hciuart_transaction_tolerates_missing_service():
    with tempfile.TemporaryDirectory() as directory:
        result = run_hciuart_rollback(
            Path(directory), "not-found|-|-",
            "systemctl disable --now hciuart.service 2>/dev/null || true\n"
            "systemctl mask hciuart.service 2>/dev/null || true")
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "not-found|-|-"
        assert "Previous hciuart state restored" not in result.stderr


def test_hciuart_rollback_preserves_concurrent_state_change():
    with tempfile.TemporaryDirectory() as directory:
        result = run_hciuart_rollback(
            Path(directory), "loaded|disabled|inactive",
            "systemctl disable --now hciuart.service\nsystemctl mask hciuart.service",
            "systemctl unmask hciuart.service\nsystemctl enable hciuart.service\n"
            "systemctl start hciuart.service")
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "loaded|enabled|active"
        assert "changed after the installer update" in result.stderr
        assert "Previous hciuart state restored" not in result.stderr
