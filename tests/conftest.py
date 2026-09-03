"""
conftest.py — shared pytest fixtures and hardware mock injection.

IMPORTANT: The sys.modules injections at the top of this file MUST run before
any backend module is imported. pytest loads conftest.py first, so this is safe.

Why mocks are needed:
- backend/__init__.py imports ALL thread classes at import time
- Several threads import Pi-specific hardware libraries at module level (can, cam, adc)
"""

import os
import sys
import types
import shutil
import json
from pathlib import Path


_APP_ROOT = Path(__file__).resolve().parent.parent


def _restart_in_test_venv():
    """Restart pytest in the project venv when invoked from outside it."""
    venv_path = _APP_ROOT / 'venv'
    python_bin = venv_path / 'bin' / 'python'

    if Path(sys.prefix).resolve() == venv_path.resolve():
        return

    if not python_bin.exists():
        raise RuntimeError(f'Python interpreter for test venv not found: {python_bin}')

    env = os.environ.copy()
    env['VIRTUAL_ENV'] = str(venv_path)
    env['PATH'] = str(python_bin.parent) + os.pathsep + env.get('PATH', '')
    env.pop('PYTHONHOME', None)

    os.execve(
        python_bin,
        [python_bin, '-m', 'pytest', *sys.argv[1:]],
        env,
    )


import pytest


def pytest_cmdline_main(config):
    """Ensure a bare `pytest` command uses the project's virtual environment."""
    del config
    _restart_in_test_venv()

# lgpio (Raspberry Pi GPIO via libgpiod)
from tests.mocks import lgpio_mock
sys.modules['lgpio'] = lgpio_mock

# Adafruit I2C / ADS1x15 ecosystem
_board = types.ModuleType('board')
_board.SCL = None
_board.SDA = None
sys.modules['board'] = _board

_busio = types.ModuleType('busio')
_busio.I2C = type('I2C', (), {
    '__init__': lambda self, *a, **kw: None,
    '__enter__': lambda self: self,
    '__exit__': lambda self, *a: None,
})
sys.modules['busio'] = _busio

_adafruit = types.ModuleType('adafruit_ads1x15')
_ads1115 = types.ModuleType('adafruit_ads1x15.ads1115')
_ads1115.ADS1115 = type('ADS1115', (), {'__init__': lambda self, *a, **kw: None})
for _ch in ('P0', 'P1', 'P2', 'P3'):
    setattr(_ads1115, _ch, ord(_ch[-1]) - ord('0'))
_adafruit.ads1115 = _ads1115
sys.modules['adafruit_ads1x15'] = _adafruit
sys.modules['adafruit_ads1x15.ads1115'] = _ads1115

_analog_in = types.ModuleType('adafruit_ads1x15.analog_in')
_analog_in.AnalogIn = type('AnalogIn', (), {
    '__init__': lambda self, *a, **kw: None,
    'value': property(lambda self: 0),
    'voltage': property(lambda self: 0.0),
})
_adafruit.analog_in = _analog_in
sys.modules['adafruit_ads1x15.analog_in'] = _analog_in

# uinput
_uinput = types.ModuleType('uinput')
_uinput.Device = type('Device', (), {
    '__init__': lambda self, *a, **kw: None,
    '__enter__': lambda self: self,
    '__exit__': lambda self, *a: None,
    'emit': lambda self, *a, **kw: None,
    'syn': lambda self: None,
})

# Provide the key/event constants swc.py references
for _kname in (
    'KEY_UP', 'KEY_DOWN', 'KEY_LEFT', 'KEY_RIGHT', 'KEY_ENTER',
    'KEY_BACK', 'KEY_VOLUMEUP', 'KEY_VOLUMEDOWN', 'KEY_MUTE',
    'KEY_NEXTSONG', 'KEY_PREVIOUSSONG', 'KEY_PLAYPAUSE',
    'BTN_LEFT', 'BTN_RIGHT', 'BTN_MIDDLE',
    'REL_X', 'REL_Y', 'REL_WHEEL',
    'EV_KEY', 'EV_REL',
):
    setattr(_uinput, _kname, 0)
sys.modules['uinput'] = _uinput


# Fixtures
@pytest.fixture()
def temp_config_dir(tmp_path, monkeypatch):
    """
    Redirect settings.USER_CONFIG_DIR to a fresh temp directory.
    Nothing is pre-seeded — useful for tests that verify 'no config' behaviour.
    """
    from backend import settings
    config_dir = tmp_path / 'v-link'
    config_dir.mkdir()
    monkeypatch.setattr(settings, 'USER_CONFIG_DIR', config_dir)
    return config_dir


@pytest.fixture()
def seeded_config_dir(temp_config_dir):
    """
    Same as temp_config_dir but with app.json copied in from the default
    backend/config/ directory so load_settings('app') succeeds.
    """
    src = _APP_ROOT / 'backend' / 'config' / 'app.json'
    shutil.copy(src, temp_config_dir / 'app.json')
    return temp_config_dir


@pytest.fixture()
def sio_client(seeded_config_dir):
    """
    In-process Flask-SocketIO test client connected to the root namespace.
    No network binding — uses Flask-SocketIO's synchronous test transport.
    """
    from backend.server import server, socketio
    server.config['TESTING'] = True
    client = socketio.test_client(server)
    yield client
    client.disconnect()


@pytest.fixture()
def sio_client_ns(seeded_config_dir):
    """
    Factory fixture: returns a helper that creates a test client for a
    given namespace and cleans it up after the test.

    Usage:
        def test_foo(sio_client_ns):
            client = sio_client_ns('/app')
    """
    from backend.server import server, socketio
    server.config['TESTING'] = True
    clients = []

    def _make(namespace='/'):
        client = socketio.test_client(server, namespace=namespace)
        clients.append((client, namespace))
        return client

    yield _make

    for client, ns in clients:
        try:
            client.disconnect(namespace=ns)
        except Exception:
            pass
