"""Host-side tests for the Lite SD bootstrap; never mount or alter a real SD."""

import ast
import hashlib
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PREPARE = ROOT / "lite/Prepare-V-Link-SD.command"
FIRSTBOOT = ROOT / "lite/bootstrap/V-Link-FirstBoot.sh"
INSTALL = ROOT / "lite/Install-Lite.sh"
SESSION = ROOT / "lite/runtime/V-Link-Lite-Session.sh"
CHECK = ROOT / "lite/Check-Lite.sh"
TERMINAL_RC = ROOT / "lite/runtime/V-Link-Lite-Terminal.bashrc"


def prepare(boot, cmdline, firstrun=None, *, script=PREPARE, extra_env=None):
    (boot / "cmdline.txt").write_bytes(cmdline)
    (boot / "config.txt").write_text("[all]\n")
    if firstrun is not None:
        (boot / "firstrun.sh").write_text(firstrun)
    env = {**os.environ, "V_LINK_BOOT_VOLUME": str(boot)}
    if extra_env:
        env.update(extra_env)
    return subprocess.run(["bash", str(script)], input="\n", text=True,
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
        assert urls[0].endswith("/commits/little-os-test")
        assert len(urls) == 3
        assert all(f"/{sha}/" in url for url in urls[1:])
        manifest = (boot / "v-link-firstboot.conf").read_text()
        assert f"SOURCE=GitHub branch little-os-test @ {sha}" in manifest


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


def stage_firstboot(boot, system, valid=True, direct=False):
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
        f"SOURCE=test\nINSTALLER_SHA256={installer_hash}\nBOOTSTRAP_SHA256={bootstrap_hash}\n")
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
        lines[1] = "INSTALLER_SHA256=" + hashlib.sha256((boot / "Install-Lite.sh").read_bytes()).hexdigest()
        lines[2] = "BOOTSTRAP_SHA256=" + "0" * 64
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
        selector = (root / "system/usr/local/sbin/v-link-firstboot-user").read_text()
        assert "UID_MIN" in selector and "UID_MAX" in selector
        assert "getent passwd 1000" not in selector
        assert "Multiple eligible users" in selector


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
        'elif [[ "$SOURCE_CHOICE_EXPLICIT"', 1)[0]

    assert "-t 0 && -w /dev/tty" in clear
    assert 'output=/dev/tty' in clear
    assert 'tput clear >"$output"' in clear
    assert "Waiting for network..." in wait
    assert "internet_available" in wait
    assert "read -r -t 3" in wait
    assert main.index("wait_for_internet") < main.index("select_install_source")
    for title in ("Installation source", "Source branch", "Hardware", "Confirmation"):
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
