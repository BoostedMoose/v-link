"""Unit tests for the Chromium application thread."""

import os
import socket
from unittest.mock import MagicMock

import pytest

from backend.threads import app as app_module


@pytest.fixture(autouse=True)
def isolated_browser_files(tmp_path, monkeypatch):
    """Keep the Chromium log and profile lock out of the real home directory."""
    monkeypatch.setenv('HOME', str(tmp_path))
    monkeypatch.setattr(app_module, 'CHROMIUM_LOG', str(tmp_path / 'chromium.txt'))


def test_start_browser_passes_each_chromium_flag_as_separate_argument(monkeypatch):
    """Adjacent Chromium flags must not be joined by a missing list comma."""
    browser_process = MagicMock(pid=1234)
    popen = MagicMock(return_value=browser_process)

    monkeypatch.setattr(app_module.os, 'makedirs', MagicMock())
    monkeypatch.setattr(app_module.APPThread, '_browser_executable', lambda self: 'chromium')
    monkeypatch.setattr(app_module.subprocess, 'Popen', popen)
    monkeypatch.setattr(app_module.shared_state, 'isKiosk', False)
    monkeypatch.setattr(app_module.shared_state, 'browserWindowSize', (400, 234))

    app_thread = app_module.APPThread(MagicMock())
    app_thread.start_browser()

    command = popen.call_args.args[0]

    assert '--no-default-browser-check' in command
    assert '--allow-insecure-localhost' in command
    assert '--window-size=400,234' in command
    assert all(argument.count('--') == 1 for argument in command[2:])
    assert popen.call_args.kwargs['start_new_session'] is True


def test_kiosk_uses_fullscreen_without_competing_maximize_flag(monkeypatch):
    browser_process = MagicMock(pid=1234)
    popen = MagicMock(return_value=browser_process)

    monkeypatch.setattr(app_module.os, 'makedirs', MagicMock())
    monkeypatch.setattr(app_module.APPThread, '_browser_executable', lambda self: 'chromium')
    monkeypatch.setattr(app_module.subprocess, 'Popen', popen)
    monkeypatch.setattr(app_module.shared_state, 'isKiosk', True)

    thread = app_module.APPThread(MagicMock())
    thread.start_browser()

    command = popen.call_args.args[0]
    assert '--kiosk' in command
    assert '--start-maximized' not in command


def test_browser_shutdown_cleans_up_reparented_children(monkeypatch):
    import signal

    killpg = MagicMock()
    monkeypatch.setattr(app_module.os, 'killpg', killpg)
    app_thread = app_module.APPThread(MagicMock())
    process = MagicMock(pid=1234)
    app_thread.browser = process

    app_thread.close_browser()

    assert killpg.call_args_list[0].args == (1234, signal.SIGTERM)
    process.wait.assert_called_once_with(timeout=5)
    assert killpg.call_args_list[1].args == (1234, signal.SIGKILL)
    assert app_thread.browser is None


def test_browser_shutdown_escalates_when_group_does_not_exit(monkeypatch):
    import signal
    import subprocess

    killpg = MagicMock()
    monkeypatch.setattr(app_module.os, 'killpg', killpg)
    app_thread = app_module.APPThread(MagicMock())
    process = MagicMock(pid=1234)
    process.wait.side_effect = [subprocess.TimeoutExpired('chromium', 5), 0]
    app_thread.browser = process

    app_thread.close_browser()

    assert (1234, signal.SIGKILL) in [call.args for call in killpg.call_args_list]
    assert process.wait.call_count == 2
    assert app_thread.browser is None


def test_browser_shutdown_accepts_already_exited_group(monkeypatch):
    monkeypatch.setattr(app_module.os, 'killpg', MagicMock(side_effect=ProcessLookupError))
    app_thread = app_module.APPThread(MagicMock())
    app_thread.browser = MagicMock(pid=1234)
    app_thread.close_browser()
    assert app_thread.browser is None
    app_thread.logger.error.assert_not_called()


def test_crashed_browser_is_restarted_until_the_limit(monkeypatch):
    monkeypatch.setattr(app_module.APPThread, 'RESTART_DELAY', 0)
    app_thread = app_module.APPThread(MagicMock())
    start_browser = MagicMock()
    monkeypatch.setattr(app_thread, 'start_browser', start_browser)

    for _ in range(app_thread.MAX_RESTARTS + 1):
        app_thread._restart_browser(1)

    assert start_browser.call_count == app_thread.MAX_RESTARTS
    assert app_thread._monitor is False


@pytest.mark.parametrize('same_host', [False, True])
def test_profile_lock_is_removed_only_for_another_hostname(tmp_path, same_host):
    lock_host = socket.gethostname() if same_host else 'other-host'
    removed = not same_host
    os.symlink(f'{lock_host}-4321', tmp_path / 'SingletonLock')
    os.symlink('/tmp/missing-cookie', tmp_path / 'SingletonCookie')

    app_module.APPThread(MagicMock())._remove_stale_profile_lock(str(tmp_path))

    assert os.path.lexists(tmp_path / 'SingletonLock') is not removed
    assert os.path.lexists(tmp_path / 'SingletonCookie') is not removed
