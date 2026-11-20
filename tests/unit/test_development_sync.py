"""Exercise the manual sync workflow without SSH, hardware, or third-party modules."""

import hashlib
import contextlib
import importlib.util
import io
import json
import shlex
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[2] / "development" / "sync-backend.py"
SPEC = importlib.util.spec_from_file_location("development_sync", SCRIPT)
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


class DevelopmentSyncTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for directory in ("backend", "updater", "frontend", "development"):
            (self.root / directory).mkdir()
        (self.root / "development" / "__init__.py").write_text("")
        (self.root / "development" / "vcan.py").write_text("pass\n")
        (self.root / "development" / "setup-vcan.sh").write_text("#!/bin/bash\n")
        (self.root / "V-Link.py").write_text("pass\n")
        (self.root / "backend" / "server.py").write_text("pass\n")
        (self.root / "updater" / "__init__.py").write_text("")
        (self.root / "requirements.txt").write_text("python-socketio==5.11.4\n")
        (self.root / "frontend" / "package.json").write_text('{"version": "1.0.0"}')
        self.remote = {
            "root": "/home/pi/v-link",
            "requirements": hashlib.sha256((self.root / "requirements.txt").read_bytes()).hexdigest(),
        }
        self.which = patch.object(sync.shutil, "which", return_value="/usr/bin/tool")
        self.which.start()
        self.addCleanup(self.which.stop)

    def result(self, *args, **kwargs):
        return subprocess.CompletedProcess(args[0], 0, stdout=json.dumps(self.remote))

    def run_sync(self, *options):
        sync.sync_backend(sync.parse_arguments(["pi@pi-host", *options]), self.root)

    @patch.object(sync.subprocess, "run")
    def test_restart_follows_every_successful_transfer(self, run):
        run.side_effect = self.result
        self.run_sync()
        transfers = [call for call in run.call_args_list if call.args[0][0] == "rsync"]
        self.assertEqual(len(transfers), 5)
        last = run.call_args_list[-1]
        self.assertEqual(last.kwargs["input"], sync.VALIDATE_AND_RESTART)
        self.assertEqual(shlex.split(last.args[0][-1])[-1], "restart")

    @patch.object(sync.subprocess, "run")
    def test_failed_transfer_prevents_restart(self, run):
        run.side_effect = [self.result(["ssh"]), subprocess.CalledProcessError(23, ["rsync"])]
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_sync()
        self.assertEqual(run.call_count, 2)

    @patch.object(sync.subprocess, "run")
    def test_failed_preflight_prevents_all_transfers(self, run):
        run.side_effect = subprocess.CalledProcessError(1, ["ssh"])
        with self.assertRaisesRegex(RuntimeError, "no sources were transferred"):
            self.run_sync()
        self.assertEqual(run.call_count, 1)

    @patch.object(sync.subprocess, "run")
    def test_preflight_timeout_reports_progress_and_prevents_transfers(self, run):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            def stalled_preflight(command, **kwargs):
                self.assertIn("Connecting to pi@pi-host", output.getvalue())
                raise subprocess.TimeoutExpired(command, kwargs["timeout"])

            run.side_effect = stalled_preflight
            with self.assertRaisesRegex(RuntimeError, "Pi preflight timed out.*no sources were transferred"):
                self.run_sync()
        run.assert_called_once()

    @patch.object(sync.subprocess, "run")
    def test_transfer_timeout_prevents_restart(self, run):
        run.side_effect = [self.result(["ssh"]), subprocess.TimeoutExpired(["rsync"], sync.TRANSFER_TIMEOUT)]
        with self.assertRaisesRegex(RuntimeError, "Transfer of backend/ timed out.*no restart was requested"):
            self.run_sync()
        self.assertEqual(run.call_count, 2)

    @patch.object(sync.subprocess, "run")
    def test_validation_timeout_reports_that_files_were_synced(self, run):
        run.side_effect = [
            self.result(["ssh"]), *[self.result(["rsync"]) for _ in range(5)],
            subprocess.TimeoutExpired(["ssh"], sync.REMOTE_COMMAND_TIMEOUT),
        ]
        with self.assertRaisesRegex(RuntimeError, "Sources were synced.*a restart may already have been requested"):
            self.run_sync()
        self.assertEqual(run.call_count, 7)

    @patch.object(sync.subprocess, "run")
    def test_remote_commands_and_transfers_have_timeouts_and_ssh_keepalives(self, run):
        run.side_effect = self.result
        self.run_sync()
        for call in run.call_args_list:
            command = call.args[0]
            if command[0] == "rsync":
                self.assertEqual(call.kwargs["timeout"], sync.TRANSFER_TIMEOUT)
                self.assertIn("--timeout=60", command)
                ssh = shlex.split(command[command.index("-e") + 1])
            else:
                self.assertEqual(call.kwargs["timeout"], sync.REMOTE_COMMAND_TIMEOUT)
                ssh = command
            for option in ("ConnectTimeout=10", "ConnectionAttempts=1", "ServerAliveInterval=10", "ServerAliveCountMax=3"):
                self.assertIn(option, ssh)

    @patch.object(sync.subprocess, "run")
    def test_cleanup_timeout_does_not_mask_preflight_timeout(self, run):
        def stalled_connection(command, **kwargs):
            if "ControlMaster=auto" in command:
                control_path = next(option.split("=", 1)[1] for option in command if option.startswith("ControlPath="))
                Path(control_path).touch()
            raise subprocess.TimeoutExpired(command, kwargs["timeout"])

        run.side_effect = stalled_connection
        with contextlib.redirect_stderr(io.StringIO()) as errors:
            with self.assertRaisesRegex(RuntimeError, "Pi preflight timed out"):
                self.run_sync()
        self.assertIn("could not close", errors.getvalue())
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args.kwargs["timeout"], 5)

    @patch.object(sync.subprocess, "run")
    def test_invalid_local_python_prevents_all_remote_commands(self, run):
        (self.root / "backend" / "server.py").write_text("def broken(:\n")
        with self.assertRaises(SyntaxError):
            self.run_sync()
        run.assert_not_called()

    @patch.object(sync.subprocess, "run")
    def test_dry_run_never_validates_or_restarts_remote_app(self, run):
        run.side_effect = self.result
        self.run_sync("--dry-run")
        self.assertEqual(run.call_count, 6)
        for call in run.call_args_list[1:]:
            self.assertIn("--dry-run", call.args[0])
            self.assertNotIn("input", call.kwargs)

    @patch.object(sync.subprocess, "run")
    def test_no_restart_still_checks_remote_python(self, run):
        run.side_effect = self.result
        self.run_sync("--no-restart")
        last = run.call_args_list[-1]
        self.assertEqual(last.kwargs["input"], sync.VALIDATE_AND_RESTART)
        self.assertEqual(shlex.split(last.args[0][-1])[-1], "check")

    @patch.object(sync.subprocess, "run")
    def test_changed_requirements_require_manual_dependency_install(self, run):
        run.side_effect = self.result
        self.remote["requirements"] = "different"
        self.run_sync()
        self.assertEqual(shlex.split(run.call_args_list[-1].args[0][-1])[-1], "check")

    def test_deletions_are_scoped_to_source_directories(self):
        commands = sync.rsync_commands("pi@host", "/home/pi/v-link", ["ssh"])
        mirrored = [command for command in commands if "--delete-delay" in command]
        self.assertEqual([command[-1] for command in mirrored], [
            "pi@host:/home/pi/v-link/backend/", "pi@host:/home/pi/v-link/updater/",
        ])
        for command in commands:
            self.assertIn("--protect-args", command)
            self.assertIn("--exclude=__pycache__/", command)
            self.assertEqual("--delete-excluded" in command, command in mirrored)

    def test_simulation_sync_preserves_other_development_files(self):
        command = sync.rsync_commands("pi@host", "/home/pi/v-link", ["ssh"])[-1]
        self.assertNotIn("--delete-delay", command)
        self.assertEqual(command[-1], "pi@host:/home/pi/v-link/development/")
        for filename in ("development/__init__.py", "development/vcan.py", "development/setup-vcan.sh"):
            self.assertIn(filename, command)

    @patch.object(sync.subprocess, "run")
    def test_remote_paths_with_shell_characters_are_quoted(self, run):
        run.side_effect = self.result
        self.remote["root"] = "/home/pi/project with spaces;echo invalid"
        self.run_sync("--remote-dir", "~/project with spaces;echo invalid")
        inspected = shlex.split(run.call_args_list[0].args[0][-1])
        self.assertEqual(inspected[:3], ["python3", "-", "~/project with spaces;echo invalid"])
        self.assertEqual(inspected[3], "restart")
        restarted = shlex.split(run.call_args_list[-1].args[0][-1])
        self.assertEqual(restarted[2], self.remote["root"])

    @patch.object(sync.subprocess, "run")
    def test_invalid_destination_prevents_transfers(self, run):
        run.side_effect = self.result
        self.remote["root"] = "/"
        with self.assertRaisesRegex(RuntimeError, "invalid installation path"):
            self.run_sync()
        self.assertEqual(run.call_count, 1)

    def inspect_remote(self, mode, requirements_hash):
        (self.root / "venv/bin").mkdir(parents=True, exist_ok=True)
        (self.root / "venv/bin/python").touch()
        with patch("sys.argv", ["-", str(self.root), mode, requirements_hash]):
            with contextlib.redirect_stdout(io.StringIO()) as output:
                exec(compile(sync.INSPECT_REMOTE, "remote-inspection", "exec"), {})
        return json.loads(output.getvalue())

    @patch("socket.create_connection", side_effect=ConnectionRefusedError)
    def test_stopped_app_has_actionable_error_before_sync(self, connect):
        with self.assertRaisesRegex(SystemExit, "No files were synced.*--no-restart"):
            self.inspect_remote("restart", self.remote["requirements"])
        connect.assert_called_once_with(("127.0.0.1", 4001), timeout=3)

    @patch("socket.create_connection")
    def test_stopped_app_can_be_synced_without_restart(self, connect):
        result = self.inspect_remote("check", self.remote["requirements"])
        self.assertEqual(result["root"], str(self.root))
        connect.assert_not_called()

    @patch("socket.create_connection")
    def test_requirements_change_can_be_synced_while_app_is_stopped(self, connect):
        self.inspect_remote("restart", "new-requirements-hash")
        connect.assert_not_called()


@unittest.skipUnless(shutil.which("rsync"), "rsync is not installed")
class RsyncCacheCleanupTests(unittest.TestCase):
    def check_cache_cleanup(self, *, dry_run=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index, directory in enumerate(sync.SOURCE_DIRECTORIES):
                with self.subTest(directory=directory):
                    source = root / "source" / directory
                    destination = root / "destination" / directory
                    source.mkdir(parents=True)
                    (source / "current.py").write_text("pass\n")
                    local_cache = source / "__pycache__"
                    local_cache.mkdir()
                    (local_cache / "local.pyc").write_bytes(b"local bytecode")
                    (source / "local.pyo").write_bytes(b"local bytecode")
                    stale_cache = destination / "dev" / "__pycache__"
                    stale_cache.mkdir(parents=True)
                    (stale_cache / "old.pyc").write_bytes(b"Pi bytecode")
                    (destination / "dev" / "old.pyo").write_bytes(b"Pi bytecode")
                    preserved = destination.parent / "development" / "keep.pyc"
                    preserved.parent.mkdir(exist_ok=True)
                    preserved.write_bytes(b"preserve outside mirrored folders")

                    command = sync.rsync_commands(
                        "pi@host", "/home/pi/v-link", ["ssh"], dry_run=dry_run
                    )[index]
                    # Exercise the actual transfer options locally without SSH or a Pi.
                    command[-1] = str(destination) + "/"
                    result = subprocess.run(
                        command, cwd=source.parent, capture_output=True, text=True, check=True
                    )

                    self.assertNotIn("cannot delete non-empty directory", result.stdout + result.stderr)
                    self.assertEqual((destination / "dev").exists(), dry_run)
                    self.assertEqual((destination / "current.py").exists(), not dry_run)
                    self.assertFalse((destination / "__pycache__").exists())
                    self.assertFalse((destination / "local.pyo").exists())
                    self.assertEqual(preserved.read_bytes(), b"preserve outside mirrored folders")
                    self.assertTrue((local_cache / "local.pyc").exists())
                    if dry_run:
                        self.assertEqual((stale_cache / "old.pyc").read_bytes(), b"Pi bytecode")
                        self.assertEqual((destination / "dev" / "old.pyo").read_bytes(), b"Pi bytecode")

    def test_obsolete_directories_with_excluded_bytecode_are_deleted(self):
        self.check_cache_cleanup()

    def test_dry_run_preserves_obsolete_directories_and_bytecode(self):
        self.check_cache_cleanup(dry_run=True)


if __name__ == "__main__":
    unittest.main()
