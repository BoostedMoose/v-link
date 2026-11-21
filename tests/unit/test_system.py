import subprocess

import pytest

from updater import system


USER_BEFORE = "# Raspberry Pi settings\ndtparam=audio=on\n\n[cm4]\notg_mode=1\n"
USER_AFTER = "# Added by the user\nhdmi_force_hotplug=1\n"
OLD_BLOCK = "[V-LINK RPi5]\n\ndtoverlay=v-link\n\n#No Splash on boot\ndisable_splash=1\n"


@pytest.fixture
def root(tmp_path, monkeypatch):
    (tmp_path / "proc/device-tree").mkdir(parents=True)
    (tmp_path / "proc/device-tree/model").write_text("Raspberry Pi 5 Model B Rev 1.0\x00")
    (tmp_path / "boot/firmware").mkdir(parents=True)
    (tmp_path / "boot/firmware/config.txt").write_text(USER_BEFORE)
    monkeypatch.setattr(system, "_run", lambda args: subprocess.CompletedProcess(args, 0, stdout="install ok installed"))
    return tmp_path


def apply(root):
    return system.main(["--apply", "--root", str(root)])


def config(root):
    return (root / "boot/firmware/config.txt").read_text()


def block():
    return (f"{system.BLOCK_START}\n[all]\n{(system.TEMPLATES / 'config-pi5.txt').read_text()}"
            f"{system.BLOCK_END}\n")


def test_fresh_system_is_set_up_and_second_run_changes_nothing(root):
    assert apply(root) == 0

    assert config(root) == USER_BEFORE + "\n" + block()
    overlay = root / "boot/firmware/overlays/v-link.dtbo"
    assert overlay.read_bytes() == (system.APP_DIR / "resources/dtoverlays/v-link.dtbo").read_bytes()
    assert "BitRate=125000" in (root / "etc/systemd/network/can1.network").read_text()
    assert "BitRate=500000" in (root / "etc/systemd/network/can2.network").read_text()
    assert (root / "etc/modules-load.d/uinput.conf").read_text() == "uinput\n"
    assert (root / "etc/udev/rules.d/42-v-link.rules").is_file()
    assert system.main(["--check", "--root", str(root)]) == 0


def test_check_lists_changes_without_applying_them(root, capsys):
    assert system.main(["--check", "--root", str(root)]) == 1

    assert "Pending: Create" in capsys.readouterr().out
    assert config(root) == USER_BEFORE
    assert not (root / "etc").exists()


def test_marked_block_is_replaced_and_user_lines_are_kept(root):
    old = f"{system.BLOCK_START}\n{OLD_BLOCK}dtoverlay=removed-later\n{system.BLOCK_END}\n"
    (root / "boot/firmware/config.txt").write_text(USER_BEFORE + old + USER_AFTER)

    assert apply(root) == 0

    assert config(root) == USER_BEFORE + block() + USER_AFTER
    assert (root / "boot/firmware/config.txt.vlink-backup").read_text() == USER_BEFORE + old + USER_AFTER


def test_old_unmarked_block_is_refused_but_other_components_are_set_up(root, capsys):
    (root / "boot/firmware/config.txt").write_text(USER_BEFORE + OLD_BLOCK)

    assert apply(root) == 1

    assert config(root) == USER_BEFORE + OLD_BLOCK
    assert "Run Patch.sh once" in capsys.readouterr().err
    assert (root / "etc/udev/rules.d/42-v-link.rules").is_file()


@pytest.mark.parametrize("damaged", [
    f"{system.BLOCK_START}\ndtoverlay=v-link\n",
    f"{system.BLOCK_END}\ndtoverlay=v-link\n{system.BLOCK_START}\n",
    f"{system.BLOCK_START}\n{system.BLOCK_END}\n{system.BLOCK_START}\n{system.BLOCK_END}\n",
])
def test_damaged_markers_leave_config_untouched(root, damaged):
    (root / "boot/firmware/config.txt").write_text(USER_BEFORE + damaged)

    assert apply(root) == 1

    assert config(root) == USER_BEFORE + damaged


def test_unknown_model_leaves_config_untouched(root):
    (root / "proc/device-tree/model").write_text("Some other board\x00")

    assert apply(root) == 1

    assert config(root) == USER_BEFORE


def test_bitrate_from_installation_is_kept(root):
    network = root / "etc/systemd/network/can2.network"
    network.parent.mkdir(parents=True)
    network.write_text("[Match]\nName=can2\n\n[CAN]\nBitRate=250000\n")

    assert apply(root) == 0

    assert network.read_text() == system.TEMPLATES.joinpath("can.network").read_text().format(name="can2", bitrate=250000)


def test_pwrkey_networkd_and_missing_packages(root, monkeypatch, capsys):
    pwrkey = root / "etc/xdg/autostart/pwrkey.desktop"
    pwrkey.parent.mkdir(parents=True)
    pwrkey.write_text("pwrkey")
    calls = []

    def run(args):
        calls.append(args)
        disabled = "is-enabled" in args
        installed = "ffmpeg" not in args
        return subprocess.CompletedProcess(args, 1 if disabled else 0, stdout="install ok installed" if installed else "")

    monkeypatch.setattr(system, "_run", run)

    assert apply(root) == 1

    assert not pwrkey.exists()
    assert (root / "etc/xdg/autostart/pwrkey.desktop.backup").read_text() == "pwrkey"
    assert ["systemctl", f"--root={root}", "enable", "systemd-networkd"] in calls
    assert "Missing packages: ffmpeg" in capsys.readouterr().err


def test_missing_packages_are_installed_without_upgrading_others(monkeypatch):
    calls = []
    monkeypatch.setattr(system.subprocess, "run", lambda args, env, check: calls.append((args, env["DEBIAN_FRONTEND"])))

    system._install_packages(["ffmpeg", "python3-venv"])

    assert calls == [(["apt-get", "update"], "noninteractive"),
                     (["apt-get", "install", "-y", "ffmpeg", "python3-venv"], "noninteractive")]


def test_failed_change_stops_before_config_is_written(root, monkeypatch):
    def fail(_path, _data):
        raise OSError("disk full")

    monkeypatch.setattr(system, "write_file", fail)

    assert apply(root) == 1

    assert config(root) == USER_BEFORE
