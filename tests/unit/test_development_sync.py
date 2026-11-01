"""Exercise the manual sync workflow without SSH, hardware, or third-party modules."""

import hashlib
import contextlib
import importlib.util
import io
import json
import shlex
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


if __name__ == "__main__":
    unittest.main()
