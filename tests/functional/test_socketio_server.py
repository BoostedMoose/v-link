"""
Functional tests for the Flask-SocketIO server.

Uses flask_socketio.test_client() — fully in-process, no network binding.
All SocketIO event handlers are registered at class-definition time when
backend/server.py is imported, so no ServerThread instantiation is required.

conftest.py injects all hardware mocks before this file is loaded.
"""
import json
import shutil
from pathlib import Path

import pytest

_APP_ROOT = Path(__file__).resolve().parent.parent.parent


# helpers
def _get_events(client, namespace, name):
    """Return args of all received events with the given name on a namespace."""
    return [r['args'] for r in client.get_received(namespace) if r['name'] == name]


def _make_client(socketio, server, namespace='/'):
    from backend.server import server as _srv, socketio as _sio
    server.config['TESTING'] = True
    return _sio.test_client(_srv, namespace=namespace)


# connection
def test_client_connects_to_root_namespace(sio_client):
    assert sio_client.is_connected()


def test_sys_connect_emits_ign_and_reverse(seeded_config_dir):
    """
    Connecting to /sys must immediately receive 'ign' and 'reverse' events
    reflecting the current ignition/reverse state from shared_state.
    """
    from backend.server import server, socketio
    from backend.shared.shared_state import shared_state
    server.config['TESTING'] = True

    client = socketio.test_client(server, namespace='/sys')
    try:
        received = client.get_received('/sys')
        names = [r['name'] for r in received]
        assert 'ign' in names
        assert 'reverse' in names
    finally:
        client.disconnect(namespace='/sys')


# /app namespace
def test_app_load_emits_settings(seeded_config_dir):
    """'load' event on /app must respond with a 'settings' event containing app config."""
    from backend.server import server, socketio
    server.config['TESTING'] = True

    client = socketio.test_client(server, namespace='/app')
    try:
        client.get_received('/app')
        client.emit('load', namespace='/app')
        received = client.get_received('/app')
        settings_events = _get_events(client, '/app', 'settings')
        settings_payloads = [r['args'] for r in received if r['name'] == 'settings']
        assert len(settings_payloads) == 1
        payload = settings_payloads[0][0]
        assert isinstance(payload, dict)
        assert 'constants' in payload
    finally:
        client.disconnect(namespace='/app')


def test_app_save_persists_to_json(temp_config_dir):
    """'save' event on /app must write the payload to app.json in USER_CONFIG_DIR."""
    from backend import settings as s_mod
    from backend.server import server, socketio
    server.config['TESTING'] = True

    client = socketio.test_client(server, namespace='/app')
    try:
        data = {
            'constants': {
                'modules': {'can': True, 'rti': False, 'swc': False, 'adc': False}
            }
        }
        client.emit('save', data, namespace='/app')
        written = json.loads((temp_config_dir / 'app.json').read_text())
        assert written['constants']['modules']['can'] is True
    finally:
        client.disconnect(namespace='/app')


def test_app_ping_emits_state_bool(seeded_config_dir):
    """'ping' event on /app must respond with a boolean 'state' event."""
    from backend.server import server, socketio
    server.config['TESTING'] = True

    client = socketio.test_client(server, namespace='/app')
    try:
        client.get_received('/app')
        client.emit('ping', namespace='/app')
        received = client.get_received('/app')
        state_events = [r for r in received if r['name'] == 'state']
        assert len(state_events) == 1
        assert isinstance(state_events[0]['args'][0], bool)
    finally:
        client.disconnect(namespace='/app')


def test_backlight_update_applies_valid_values_and_rejects_invalid_values(seeded_config_dir):
    from backend.server import server, socketio
    from backend.shared.shared_state import shared_state
    server.config['TESTING'] = True
    shared_state.backlight_manual = 5
    shared_state.backlight_auto_enabled = True

    client = socketio.test_client(server, namespace='/app')
    try:
        client.emit('backlight:update', {'manual': 9, 'auto_enabled': False}, namespace='/app')
        assert shared_state.backlight_manual == 9
        assert shared_state.backlight_auto_enabled is False

        client.emit('backlight:update', {'manual': 17, 'auto_enabled': 'false'}, namespace='/app')
        assert shared_state.backlight_manual == 9
        assert shared_state.backlight_auto_enabled is False
    finally:
        shared_state.backlight_manual = None
        shared_state.backlight_auto_enabled = None
        client.disconnect(namespace='/app')


# /sys namespace
def test_systemtask_check_returns_true_when_config_exists(seeded_config_dir):
    """systemTask('check') returns True when the user config dir has files."""
    from backend.server import server, socketio
    server.config['TESTING'] = True

    client = socketio.test_client(server, namespace='/sys')
    try:
        client.get_received('/sys')
        result = client.emit('systemTask', 'check', namespace='/sys', callback=True)
        assert result is True
    finally:
        client.disconnect(namespace='/sys')


def test_systemtask_check_returns_profiles_when_no_config(temp_config_dir):
    """systemTask('check') returns a platform dict when no config exists."""
    from backend.server import server, socketio
    server.config['TESTING'] = True

    # Remove any files to ensure an empty config dir
    for f in temp_config_dir.iterdir():
        f.unlink()

    client = socketio.test_client(server, namespace='/sys')
    try:
        client.get_received('/sys')
        result = client.emit('systemTask', 'check', namespace='/sys', callback=True)
        assert isinstance(result, dict)
        assert any(k in result for k in ('P1', 'P2'))
    finally:
        client.disconnect(namespace='/sys')


def test_systemtask_start_sets_start_event(seeded_config_dir):
    """systemTask('start') must set shared_state.start_event."""
    from backend.server import server, socketio
    from backend.shared.shared_state import shared_state
    server.config['TESTING'] = True
    shared_state.start_event.clear()

    client = socketio.test_client(server, namespace='/sys')
    try:
        client.emit('systemTask', 'start', namespace='/sys')
        assert shared_state.start_event.is_set()
    finally:
        shared_state.start_event.clear()
        client.disconnect(namespace='/sys')


# /data namespace
def test_data_request_returns_car_data(seeded_config_dir):
    """
    'request' event on /data must emit a 'data' event with a timestamp
    and the current car_data dict.
    """
    from backend.server import server, socketio
    from backend.shared.shared_state import shared_state
    server.config['TESTING'] = True

    shared_state.update_car_data('rpm', 2500.0)
    shared_state.update_car_data('boost', 1.1)

    client = socketio.test_client(server, namespace='/data')
    try:
        client.get_received('/data')
        client.emit('request', namespace='/data')
        received = client.get_received('/data')
        data_events = [r for r in received if r['name'] == 'data']
        assert len(data_events) == 1
        payload = data_events[0]['args'][0]
        assert 'timestamp' in payload
        assert 'data' in payload
        assert payload['data'].get('rpm') == '2500.00'
    finally:
        client.disconnect(namespace='/data')


_CAN_PROFILE = _APP_ROOT / 'backend' / 'config' / 'profiles' / 'P1' / 'T5' / 'can.json'


def _seed_can(config_dir):
    """Copy the P1/T5 can.json into config_dir so load_settings('can') succeeds."""
    shutil.copy(_CAN_PROFILE, config_dir / 'can.json')


# /can namespace
def test_can_toggle_sets_shared_state_event(seeded_config_dir):
    """'toggle' on /can must set shared_state.toggle_can."""
    from backend.server import server, socketio
    from backend.shared.shared_state import shared_state
    server.config['TESTING'] = True
    shared_state.toggle_can.clear()

    client = socketio.test_client(server, namespace='/can')
    try:
        client.get_received('/can')
        client.emit('toggle', namespace='/can')
        assert shared_state.toggle_can.is_set()
    finally:
        shared_state.toggle_can.clear()
        client.disconnect(namespace='/can')


def test_can_load_returns_settings(seeded_config_dir):
    """'load' on /can must respond with a 'settings' event containing sensors and interfaces."""
    _seed_can(seeded_config_dir)
    from backend.server import server, socketio
    server.config['TESTING'] = True

    client = socketio.test_client(server, namespace='/can')
    try:
        client.get_received('/can')
        client.emit('load', namespace='/can')
        received = client.get_received('/can')
        settings_events = [r for r in received if r['name'] == 'settings']
        assert len(settings_events) == 1
        payload = settings_events[0]['args'][0]
        assert isinstance(payload, dict)
        assert 'sensors' in payload
        assert 'interfaces' in payload
        assert 'signal_sensors' in payload
    finally:
        client.disconnect(namespace='/can')


def test_can_save_persists_sensor_enabled(seeded_config_dir):
    """'save' on /can must write the modified sensor enabled state to can.json."""
    _seed_can(seeded_config_dir)
    from backend.server import server, socketio
    server.config['TESTING'] = True

    # Build a minimal payload toggling boost sensor to disabled
    can_data = json.loads(_CAN_PROFILE.read_text())
    can_data['sensors']['boost']['enabled'] = False

    client = socketio.test_client(server, namespace='/can')
    try:
        client.emit('save', can_data, namespace='/can')
        written = json.loads((seeded_config_dir / 'can.json').read_text())
        assert written['sensors']['boost']['enabled'] is False
    finally:
        client.disconnect(namespace='/can')


def test_can_save_persists_signal_sensor_enabled(seeded_config_dir):
    """'save' on /can must persist signal_sensor enabled toggles to can.json."""
    _seed_can(seeded_config_dir)
    from backend.server import server, socketio
    server.config['TESTING'] = True

    can_data = json.loads(_CAN_PROFILE.read_text())
    can_data['signal_sensors'][0]['enabled'] = True

    client = socketio.test_client(server, namespace='/can')
    try:
        client.emit('save', can_data, namespace='/can')
        written = json.loads((seeded_config_dir / 'can.json').read_text())
        assert written['signal_sensors'][0]['enabled'] is True
    finally:
        client.disconnect(namespace='/can')
