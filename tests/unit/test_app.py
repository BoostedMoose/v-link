"""Unit tests for the Chromium application thread."""

from unittest.mock import MagicMock

from backend.threads import app as app_module


def test_start_browser_passes_each_chromium_flag_as_separate_argument(monkeypatch):
    """Adjacent Chromium flags must not be joined by a missing list comma."""
    browser_process = MagicMock(pid=1234)
    popen = MagicMock(return_value=browser_process)

    monkeypatch.setattr(app_module.os, 'makedirs', MagicMock())
    monkeypatch.setattr(app_module.APPThread, '_browser_executable', lambda self: 'chromium')
    monkeypatch.setattr(app_module.subprocess, 'Popen', popen)
    monkeypatch.setattr(app_module.shared_state, 'isKiosk', False)

    app_thread = app_module.APPThread(MagicMock())
    app_thread.start_browser()

    command = popen.call_args.args[0]

    assert '--no-default-browser-check' in command
    assert '--allow-insecure-localhost' in command
    assert all(argument.count('--') == 1 for argument in command[2:])
    assert popen.call_args.kwargs['start_new_session'] is True


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
