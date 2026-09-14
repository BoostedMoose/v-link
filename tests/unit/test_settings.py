"""
Unit tests for backend/settings.py
"""
import json
from copy import deepcopy
from pathlib import Path

import pytest

_APP_ROOT = Path(__file__).resolve().parent.parent.parent


# load_directory
def test_load_directory_creates_missing_dir(tmp_path, monkeypatch):
    from backend import settings
    new_dir = tmp_path / 'new_config'
    monkeypatch.setattr(settings, 'USER_CONFIG_DIR', new_dir)
    result = settings.load_directory()
    assert result == new_dir
    assert new_dir.is_dir()


def test_load_directory_returns_existing_dir(temp_config_dir):
    from backend import settings
    result = settings.load_directory()
    assert result == temp_config_dir
    assert result.is_dir()


# check_settings
def test_check_settings_returns_true_when_config_exists(seeded_config_dir):
    """Returns True when USER_CONFIG_DIR contains files (app.json is present)."""
    from backend import settings
    result = settings.check_settings()
    assert result is True


def test_check_settings_returns_profiles_dict_when_no_config(temp_config_dir):
    """Returns a platform→engines dict when USER_CONFIG_DIR is empty."""
    from backend import settings
    # Remove any files that might be there
    for f in temp_config_dir.iterdir():
        f.unlink()
    result = settings.check_settings()
    assert isinstance(result, dict)

    assert any(k in result for k in ('P1', 'P2'))


# save_settings / load_settings
def test_save_and_load_settings_roundtrip(temp_config_dir):
    from backend import settings
    payload = {'key': 'value', 'nested': {'n': 42}}
    settings.save_settings('test_module', payload)
    loaded = settings.load_settings('test_module')
    assert loaded == payload


def test_load_settings_returns_none_for_missing_file(temp_config_dir):
    from backend import settings
    result = settings.load_settings('nonexistent_module')
    assert result is None


def test_save_settings_writes_valid_json(temp_config_dir):
    from backend import settings
    settings.save_settings('json_check', {'a': 1, 'b': [1, 2, 3]})
    raw = (temp_config_dir / 'json_check.json').read_text()
    parsed = json.loads(raw)
    assert parsed == {'a': 1, 'b': [1, 2, 3]}


# copy_files
def test_copy_files_p1_t5_copies_profile_configs(temp_config_dir):
    """copy_files with P1/T5 must copy base app.json + profile can.json."""
    from backend import settings
    result = settings.copy_files({'platform': 'P1', 'engine': 'T5'})
    assert result is True
    assert (temp_config_dir / 'app.json').exists()


def test_copy_files_p2_d5_copies_profile_configs(temp_config_dir):
    from backend import settings
    result = settings.copy_files({'platform': 'P2', 'engine': 'D5'})
    assert result is True
    assert (temp_config_dir / 'app.json').exists()
    assert (temp_config_dir / 'can.json').exists()


# migrate_settings
def test_migrate_settings_adds_missing_keys(tmp_path, monkeypatch):
    """Keys present in the default config but absent from the user config are added."""
    from backend import settings

    default_dir = tmp_path / 'default'
    default_dir.mkdir()
    user_dir = tmp_path / 'user'
    user_dir.mkdir()

    (default_dir / 'app.json').write_text(json.dumps({'existing': {'value': 1}, 'new_key': {'value': 42}}))
    (user_dir / 'app.json').write_text(json.dumps({'existing': {'value': 99}}))

    monkeypatch.setattr(settings, 'DEFAULT_CONFIG_DIR', default_dir)
    monkeypatch.setattr(settings, 'USER_CONFIG_DIR', user_dir)

    settings.migrate_settings()

    result = settings.load_settings('app')
    assert result['new_key'] == {'value': 42}       # default value inserted
    assert result['existing'] == {'value': 99}       # user value preserved


def test_migrate_settings_preserves_user_values(tmp_path, monkeypatch):
    """Keys that already exist in the user config are never overwritten."""
    from backend import settings

    default_dir = tmp_path / 'default'
    default_dir.mkdir()
    user_dir = tmp_path / 'user'
    user_dir.mkdir()

    (default_dir / 'app.json').write_text(json.dumps({'key': {'value': 'default_val'}}))
    (user_dir / 'app.json').write_text(json.dumps({'key': {'value': 'user_val'}}))

    monkeypatch.setattr(settings, 'DEFAULT_CONFIG_DIR', default_dir)
    monkeypatch.setattr(settings, 'USER_CONFIG_DIR', user_dir)

    settings.migrate_settings()

    result = settings.load_settings('app')
    assert result['key']['value'] == 'user_val'


def test_migrate_settings_noop_when_no_missing_keys(tmp_path, monkeypatch):
    """save_settings is not called when the user config already has all default keys."""
    from backend import settings

    default_dir = tmp_path / 'default'
    default_dir.mkdir()
    user_dir = tmp_path / 'user'
    user_dir.mkdir()

    app_data = {'key': {'value': 1}}
    (default_dir / 'app.json').write_text(json.dumps(app_data))
    user_file = user_dir / 'app.json'
    user_file.write_text(json.dumps(app_data))
    saved = []
    monkeypatch.setattr(settings, 'save_settings', lambda name, data: saved.append(name))

    monkeypatch.setattr(settings, 'DEFAULT_CONFIG_DIR', default_dir)
    monkeypatch.setattr(settings, 'USER_CONFIG_DIR', user_dir)

    settings.migrate_settings()

    assert saved == [], "save_settings should not be called when nothing is missing"


def test_migrate_settings_noop_when_default_app_json_absent(tmp_path, monkeypatch):
    """Does not crash or modify the user config when the default app.json is missing."""
    from backend import settings

    default_dir = tmp_path / 'default'
    default_dir.mkdir()          # intentionally no app.json
    user_dir = tmp_path / 'user'
    user_dir.mkdir()

    user_app = {'key': {'value': 1}}
    (user_dir / 'app.json').write_text(json.dumps(user_app))

    monkeypatch.setattr(settings, 'DEFAULT_CONFIG_DIR', default_dir)
    monkeypatch.setattr(settings, 'USER_CONFIG_DIR', user_dir)

    settings.migrate_settings()   # must not raise

    assert settings.load_settings('app') == user_app


def test_migrate_settings_adds_backlight_keys_to_old_config(tmp_path, monkeypatch):
    """Simulates a real-world old user config missing the backlight keys added in this branch."""
    from backend import settings

    default_dir = tmp_path / 'default'
    default_dir.mkdir()
    user_dir = tmp_path / 'user'
    user_dir.mkdir()

    backlight_defaults = {
        'daylight_backlight': {'ui': 'range', 'label': 'Daylight Backlight Level', 'value': 15, 'min': 1, 'max': 16, 'step': 1},
        'auto_backlight': {'title': 'Automatic Backlight', 'type': 'system', 'autoOpen': {'value': True, 'label': 'Enable Automatic Backlight'}},
        'darkness_backlight': {'ui': 'range', 'label': 'Darkness Backlight Level', 'value': 5, 'min': 1, 'max': 10, 'step': 1},
    }
    default_app = {'general': {'colorTheme': {'value': 'Green'}}, **backlight_defaults}
    user_app   = {'general': {'colorTheme': {'value': 'Red'}}}   # old config, no backlight keys

    (default_dir / 'app.json').write_text(json.dumps(default_app))
    (user_dir / 'app.json').write_text(json.dumps(user_app))

    monkeypatch.setattr(settings, 'DEFAULT_CONFIG_DIR', default_dir)
    monkeypatch.setattr(settings, 'USER_CONFIG_DIR', user_dir)

    settings.migrate_settings()

    result = settings.load_settings('app')
    assert 'daylight_backlight' in result
    assert 'auto_backlight' in result
    assert 'darkness_backlight' in result
    assert result['general']['colorTheme']['value'] == 'Red'   # user preference kept


def test_migrate_settings_replaces_legacy_rearcam_without_touching_other_settings(tmp_path, monkeypatch):
    """An incompatible rearcam block is replaced instead of recursively merged."""
    from backend import settings

    default_dir = tmp_path / 'default'
    default_dir.mkdir()
    user_dir = tmp_path / 'user'
    user_dir.mkdir()

    with (settings.DEFAULT_CONFIG_DIR / 'app.json').open(encoding='utf-8') as file:
        default_app = json.load(file)

    user_app = deepcopy(default_app)
    user_app['general']['colorTheme']['value'] = 'Red'
    user_app['constants'].pop('rearcam_settings_version')
    user_app['reverseCam'] = {
        'title': 'Reverse Camera Settings',
        'type': 'system',
        'enabled': {'value': False, 'label': 'Enabled'},
        'delay': {'value': 12, 'label': 'Off Delay (sec)'},
        'deviceSelectionMode': {
            'value': 'label',
            'label': 'Device Selection',
            'options': [
                {'value': 'auto', 'label': 'Automatic'},
                {'value': 'label', 'label': 'Device label'},
            ],
        },
        'deviceLabel': {'value': 'USB Camera', 'label': 'Camera Label'},
        'videoWidth': {'value': 640, 'label': 'Video Width'},
        'videoHeight': {'value': 360, 'label': 'Video Height'},
        'videoFps': {'value': 25, 'label': 'Video FPS'},
    }

    (default_dir / 'app.json').write_text(json.dumps(default_app))
    (user_dir / 'app.json').write_text(json.dumps(user_app))
    monkeypatch.setattr(settings, 'DEFAULT_CONFIG_DIR', default_dir)
    monkeypatch.setattr(settings, 'USER_CONFIG_DIR', user_dir)

    settings.migrate_settings()

    result = settings.load_settings('app')
    assert result['reverseCam'] == default_app['reverseCam']
    assert result['reverseCam']['guidelineMode']['value'] == 'Standard'
    assert 'deviceLabel' not in result['reverseCam']
    assert 'videoWidth' not in result['reverseCam']
    assert 'videoHeight' not in result['reverseCam']
    assert result['constants']['rearcam_settings_version'] == settings.REARCAM_SETTINGS_VERSION
    assert result['constants']['rearcam_settings_reset_notice'] is True
    assert result['general']['colorTheme']['value'] == 'Red'


def test_migrate_settings_preserves_current_versioned_rearcam_values(tmp_path, monkeypatch):
    """A current rearcam schema keeps compatible user-selected values."""
    from backend import settings

    default_dir = tmp_path / 'default'
    default_dir.mkdir()
    user_dir = tmp_path / 'user'
    user_dir.mkdir()

    with (settings.DEFAULT_CONFIG_DIR / 'app.json').open(encoding='utf-8') as file:
        default_app = json.load(file)

    user_app = deepcopy(default_app)
    user_app['reverseCam']['deviceId']['value'] = 'saved-camera-id'
    user_app['reverseCam']['delay']['value'] = 9
    user_app['reverseCam']['guidelineMode']['value'] = 'Custom'
    user_app['constants']['rearcam_settings_reset_notice'] = False

    (default_dir / 'app.json').write_text(json.dumps(default_app))
    (user_dir / 'app.json').write_text(json.dumps(user_app))
    saved = []
    monkeypatch.setattr(settings, 'save_settings', lambda name, data: saved.append(name))
    monkeypatch.setattr(settings, 'DEFAULT_CONFIG_DIR', default_dir)
    monkeypatch.setattr(settings, 'USER_CONFIG_DIR', user_dir)

    settings.migrate_settings()

    assert saved == []
    assert json.loads((user_dir / 'app.json').read_text())['reverseCam'] == user_app['reverseCam']


def test_check_settings_migrates_on_existing_config(tmp_path, monkeypatch):
    """check_settings() calls migrate_settings() when a user config already exists."""
    from backend import settings

    default_dir = tmp_path / 'default'
    default_dir.mkdir()
    user_dir = tmp_path / 'user'
    user_dir.mkdir()

    default_app = {
        'constants': {'modules': {'can': False, 'rti': False, 'swc': False, 'adc': False}},
        'daylight_backlight': {'ui': 'range', 'value': 15, 'min': 1, 'max': 16, 'step': 1},
    }
    user_app = {
        'constants': {'modules': {'can': False, 'rti': False, 'swc': False, 'adc': False}},
    }

    (default_dir / 'app.json').write_text(json.dumps(default_app))
    (user_dir / 'app.json').write_text(json.dumps(user_app))

    monkeypatch.setattr(settings, 'DEFAULT_CONFIG_DIR', default_dir)
    monkeypatch.setattr(settings, 'USER_CONFIG_DIR', user_dir)

    result = settings.check_settings()

    assert result is True
    migrated = settings.load_settings('app')
    assert 'daylight_backlight' in migrated


# load_modules
def test_load_modules_sets_shared_state_flags(temp_config_dir, monkeypatch):
    """load_modules reads app.json constants.modules and sets shared_state flags."""
    from backend import settings
    from backend.shared.shared_state import SharedState

    fresh_state = SharedState()
    monkeypatch.setattr(settings, 'shared_state', fresh_state)

    app_data = {
        'constants': {
            'modules': {'can': True, 'rti': False, 'swc': True, 'adc': False}
        }
    }
    (temp_config_dir / 'app.json').write_text(json.dumps(app_data))

    settings.load_modules()

    assert fresh_state.canModule is True
    assert fresh_state.rtiModule is False
    assert fresh_state.swcModule is True
    assert fresh_state.adcModule is False
