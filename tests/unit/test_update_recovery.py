import json
import os
from pathlib import Path
import subprocess

import pytest

from updater import launcher, recovery, releases


TXID = "a" * 32


def make_state(app, managed=("V-Link.py",), present=("V-Link.py",), venv=None):
    return {
        "schema": recovery.TRANSACTION_SCHEMA,
        "transaction_id": TXID,
        "app_dir": str(app.resolve()),
        "phase": "activating",
        "managed_paths": list(managed),
        "originally_present": list(present),
        "from_release": {},
        "to_release": {},
        "candidate_venv": f".v-link-venvs/{TXID}",
        "previous_venv": venv or {"kind": "absent"},
    }


def active_transaction(tmp_path, app, state):
    transaction = tmp_path / f".v-link-update.{TXID}"
    (transaction / "backup").mkdir(parents=True)
    recovery.write_state(transaction, state)
    recovery._atomic_write(tmp_path / ".v-link-update-active", TXID + "\n")
    return transaction


def test_recovery_without_marker_is_noop(tmp_path):
    app = tmp_path / "v-link"
    app.mkdir()
    assert recovery.recover(app) is False


def test_abandoned_preparation_cleanup_is_scoped_and_keeps_active_venv(tmp_path):
    app = tmp_path / "v-link"
    app.mkdir()
    stale = tmp_path / f".v-link-update.{TXID}"
    stale.mkdir()
    candidate = app / ".v-link-venvs" / TXID
    candidate.mkdir(parents=True)
    (app / "venv").symlink_to(f".v-link-venvs/{TXID}")
    unknown = tmp_path / ".v-link-update.not-ours"
    unknown.mkdir()

    releases._cleanup_abandoned_preparations(app)
    assert not stale.exists()
    assert candidate.exists()
    assert unknown.exists()


def test_partial_activation_restores_old_and_removes_new_path(tmp_path):
    app = tmp_path / "v-link"
    app.mkdir()
    state = make_state(app, ("V-Link.py", "Patch.sh"), ("V-Link.py",))
    transaction = active_transaction(tmp_path, app, state)
    (transaction / "backup/V-Link.py").write_text("old")
    (app / "V-Link.py").write_text("new")
    (app / "Patch.sh").write_text("new optional")

    assert recovery.recover(app) is True
    assert (app / "V-Link.py").read_text() == "old"
    assert not (app / "Patch.sh").exists()
    assert not (tmp_path / ".v-link-update-active").exists()


def test_recovery_preserves_original_not_moved_yet(tmp_path):
    app = tmp_path / "v-link"
    app.mkdir()
    (app / "V-Link.py").write_text("old")
    active_transaction(tmp_path, app, make_state(app))
    recovery.recover(app)
    assert (app / "V-Link.py").read_text() == "old"


def test_inconsistent_recovery_keeps_marker_and_transaction(tmp_path):
    app = tmp_path / "v-link"
    app.mkdir()
    transaction = active_transaction(tmp_path, app, make_state(app))
    with pytest.raises(recovery.RecoveryError, match="Cannot reconstruct"):
        recovery.recover(app)
    assert (tmp_path / ".v-link-update-active").exists()
    assert transaction.exists()


def test_recovery_restores_previous_real_venv(tmp_path):
    app = tmp_path / "v-link"
    app.mkdir()
    state = make_state(app, managed=(), present=(), venv={"kind": "directory"})
    transaction = active_transaction(tmp_path, app, state)
    (transaction / "backup/venv").mkdir()
    (transaction / "backup/venv/old").write_text("yes")
    candidate = app / ".v-link-venvs" / TXID
    candidate.mkdir(parents=True)
    (app / "venv").symlink_to(f".v-link-venvs/{TXID}")

    recovery.recover(app)
    assert (app / "venv").is_dir() and not (app / "venv").is_symlink()
    assert (app / "venv/old").read_text() == "yes"
    assert not candidate.exists()


def test_recovery_restores_previous_venv_symlink(tmp_path):
    app = tmp_path / "v-link"
    app.mkdir()
    old = app / ".v-link-venvs/old"
    old.mkdir(parents=True)
    state = make_state(
        app, managed=(), present=(),
        venv={"kind": "symlink", "target": ".v-link-venvs/old"})
    transaction = active_transaction(tmp_path, app, state)
    (transaction / "backup/venv").symlink_to(".v-link-venvs/old")
    candidate = app / ".v-link-venvs" / TXID
    candidate.mkdir()
    (app / "venv").symlink_to(f".v-link-venvs/{TXID}")

    recovery.recover(app)
    assert (app / "venv").is_symlink()
    assert os.readlink(app / "venv") == ".v-link-venvs/old"
    assert (app / "venv").resolve() == old


def test_unknown_schema_and_unsafe_managed_path_change_nothing(tmp_path):
    app = tmp_path / "v-link"
    app.mkdir()
    (app / "V-Link.py").write_text("old")
    state = make_state(app)
    transaction = active_transaction(tmp_path, app, state)
    state["managed_paths"] = ["../outside"]
    recovery.write_state(transaction, state)
    with pytest.raises(recovery.RecoveryError, match="Unsafe managed"):
        recovery.recover(app)
    assert (app / "V-Link.py").read_text() == "old"
    assert (tmp_path / ".v-link-update-active").exists()


def test_launcher_installs_recovery_and_runs_it_before_v_link(tmp_path, monkeypatch):
    app = tmp_path / "v-link"
    app.mkdir()
    monkeypatch.setattr(recovery, "__file__", str(Path(recovery.__file__).resolve()))
    launch_path, autostart = launcher.install(app)
    launch_text = launch_path.read_text()
    assert launch_text.index("v-link-recovery") < launch_text.index("V-Link.py")
    assert launch_path.stat().st_mode & 0o777 == 0o755
    assert "Exec=" + str(launch_path) in autostart.read_text()
    assert (tmp_path / ".local/libexec/v-link-recovery").exists()


def test_new_launcher_starts_existing_desktop_when_preparation_never_created_marker(
        tmp_path):
    app = tmp_path / "v-link"
    python = app / "venv/bin/python"
    python.parent.mkdir(parents=True)
    (app / "V-Link.py").write_text("old app")
    launched = tmp_path / "old-desktop-launched"
    python.write_text(f"#!/bin/sh\nprintf '%s\\n' \"$*\" >'{launched}'\n")
    python.chmod(0o755)
    launch_path, _autostart = launcher.install(app)

    result = subprocess.run([str(launch_path)], text=True, capture_output=True)

    assert result.returncode == 0, result.stderr
    assert launched.read_text().strip() == str(app / "V-Link.py")
    assert not (tmp_path / ".v-link-update-active").exists()


def test_desktop_installer_uses_user_launcher_without_second_global_entry():
    source = Path("Install.sh").read_text()
    autostart = source.split("# Step 5: Create autostart", 1)[1].split(
        "# Step 6:", 1)[0]
    assert "updater/launcher.py" in autostart
    assert "/etc/xdg/autostart/v-link.desktop" not in autostart


def test_update_wrapper_owns_keepalive_and_stops_it_before_restart():
    source = Path("Update.sh").read_text()
    run_updater = 'if "$PYTHON" "$APP_DIR/updater/releases.py"'
    assert source.index("KEEPALIVE_PID=") < source.index(run_updater)
    restart = source.split("restart_known_good()", 1)[1].split("}", 1)[0]
    assert restart.index("cleanup") < restart.index("exec")


def test_newer_recovery_helper_is_not_downgraded(tmp_path):
    helper = tmp_path / "v-link-recovery"
    helper.write_text("RECOVERY_PROTOCOL = 99\n")
    source = Path(recovery.__file__)
    assert recovery.install_helper(source, helper) is False
    assert helper.read_text() == "RECOVERY_PROTOCOL = 99\n"


def test_state_is_complete_before_marker_and_marker_precedes_first_move(
        tmp_path, monkeypatch):
    app = tmp_path / "v-link"
    app.mkdir()
    (app / "V-Link.py").write_text("old")
    stage = tmp_path / "stage"
    stage.mkdir()
    (stage / "V-Link.py").write_text("new")
    transaction = tmp_path / f".v-link-update.{TXID}"
    (transaction / "backup").mkdir(parents=True)
    candidate = app / ".v-link-venvs" / TXID
    (candidate / "bin").mkdir(parents=True)
    state = releases._transaction_state(TXID, app, stage, {"commit": "a" * 40})
    recovery.write_state(transaction, state)
    observed = []
    real_move = releases._durable_replace

    def observe_move(source, destination):
        marker = tmp_path / ".v-link-update-active"
        saved = json.loads((transaction / "state.json").read_text())
        observed.append((marker.exists(), saved["originally_present"], saved["previous_venv"]))
        return real_move(source, destination)

    monkeypatch.setattr(releases, "_durable_replace", observe_move)
    monkeypatch.setattr(releases, "_validate_activated", lambda *_args: None)
    releases._activate(stage, app, {"commit": "a" * 40}, transaction, candidate, state)
    assert observed[0] == (True, ["V-Link.py"], {"kind": "absent"})


def test_post_commit_debris_does_not_roll_back_and_cleans_old_candidate(tmp_path):
    app = tmp_path / "v-link"
    app.mkdir()
    current = app / ".v-link-venvs" / TXID
    old = app / ".v-link-venvs/old"
    current.mkdir(parents=True)
    old.mkdir()
    (app / "venv").symlink_to(f".v-link-venvs/{TXID}")
    (app / "V-Link.py").write_text("new")
    transaction = tmp_path / f".v-link-update.{TXID}"
    (transaction / "backup").mkdir(parents=True)
    state = make_state(
        app, venv={"kind": "symlink", "target": ".v-link-venvs/old"})
    state["phase"] = "activated"
    recovery.write_state(transaction, state)

    assert recovery.recover(app) is False
    releases._cleanup_abandoned_preparations(app)
    assert (app / "V-Link.py").read_text() == "new"
    assert current.exists()
    assert not old.exists()
    assert not transaction.exists()


@pytest.mark.parametrize("cut", range(8))
def test_recovery_handles_power_loss_between_each_activation_move(tmp_path, cut):
    app = tmp_path / "v-link"
    stage = tmp_path / "stage"
    (app / "backend").mkdir(parents=True)
    (app / "V-Link.py").write_text("old app")
    (app / "backend/version.py").write_text("old backend")
    (app / "venv").mkdir()
    (app / "venv/known-good").write_text("old venv")
    (stage / "backend").mkdir(parents=True)
    (stage / "V-Link.py").write_text("new app")
    (stage / "backend/version.py").write_text("new backend")
    candidate = app / ".v-link-venvs" / TXID
    candidate.mkdir(parents=True)
    state = make_state(
        app, managed=("V-Link.py", "backend"),
        present=("V-Link.py", "backend"), venv={"kind": "directory"})
    transaction = active_transaction(tmp_path, app, state)
    backup = transaction / "backup"

    operations = (
        lambda: os.replace(app / "V-Link.py", backup / "V-Link.py"),
        lambda: os.replace(app / "backend", backup / "backend"),
        lambda: os.replace(stage / "V-Link.py", app / "V-Link.py"),
        lambda: os.replace(stage / "backend", app / "backend"),
        lambda: os.replace(app / "venv", backup / "venv"),
        lambda: (app / "venv").symlink_to(f".v-link-venvs/{TXID}"),
    )
    for operation in operations[:min(cut, len(operations))]:
        operation()
    if cut == 7:
        state["phase"] = "activated"
        recovery.write_state(transaction, state)

    recovery.recover(app)

    assert (app / "V-Link.py").read_text() == "old app"
    assert (app / "backend/version.py").read_text() == "old backend"
    assert (app / "venv/known-good").read_text() == "old venv"
    assert not (tmp_path / ".v-link-update-active").exists()


def test_v_link_uses_realpath_for_symlinked_venv():
    source = Path("V-Link.py").read_text()
    assert "os.path.realpath(sys.prefix) == os.path.realpath(venv_path)" in source
