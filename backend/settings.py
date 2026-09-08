import json
import shutil
import logging
from copy import deepcopy
from pathlib import Path

from backend.shared.shared_state import shared_state

logger = logging.getLogger('vlink')

# Constants
APP_ROOT = Path(__file__).resolve().parent.parent
USER_CONFIG_DIR = Path.home() / '.config' / 'v-link'

DEFAULT_PROFILES_DIR = APP_ROOT / 'backend' / 'config' / 'profiles'
DEFAULT_CONFIG_DIR = APP_ROOT / 'backend' / 'config'
REARCAM_SETTINGS_VERSION = 1

def load_directory():
    # Ensure user config directory exists.
    try:
        USER_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        return USER_CONFIG_DIR
    except Exception as e:
        logger.error(f'Error creating directory: {e}')
        return None
    

def _rearcam_schema_is_current(defaults, user):
    """Return True only when rearcam uses the exact current settings structure."""
    if not isinstance(defaults, dict) or not isinstance(user, dict):
        return False
    if set(user) != set(defaults):
        return False

    for setting_name, default_setting in defaults.items():
        user_setting = user.get(setting_name)

        # Block metadata is part of the schema and must match exactly.
        if not isinstance(default_setting, dict):
            if user_setting != default_setting:
                return False
            continue

        if not isinstance(user_setting, dict) or set(user_setting) != set(default_setting):
            return False

        for field, default_value in default_setting.items():
            user_value = user_setting.get(field)
            if field != 'value':
                if user_value != default_value:
                    return False
                continue

            # User-selected values may differ, but their type and enumerated
            # values must remain compatible with the current schema.
            if isinstance(default_value, bool):
                if not isinstance(user_value, bool):
                    return False
            elif isinstance(default_value, (int, float)):
                if isinstance(user_value, bool) or not isinstance(user_value, (int, float)):
                    return False
            elif not isinstance(user_value, type(default_value)):
                return False

            options = default_setting.get('options')
            allows_empty = setting_name == 'deviceSelectionMode' and user_value == ''
            if options and setting_name != 'deviceId' and user_value not in options and not allows_empty:
                return False

    return True


def migrate_settings():
    # Add only entirely new top-level sections. Nested schemas must be migrated
    # explicitly so obsolete fields cannot survive indefinitely.
    default_app = DEFAULT_CONFIG_DIR / 'app.json'
    user_app = USER_CONFIG_DIR / 'app.json'
    if not default_app.exists() or not user_app.exists():
        return
    try:
        with default_app.open('r', encoding='utf-8') as f:
            defaults = json.load(f)
        with user_app.open('r', encoding='utf-8') as f:
            user = json.load(f)

        added = []
        for key, default_value in defaults.items():
            if key not in user:
                user[key] = deepcopy(default_value)
                added.append(key)

        updated = []

        default_reverse_cam = defaults.get('reverseCam')
        if isinstance(default_reverse_cam, dict):
            user_constants = user.get('constants')
            if not isinstance(user_constants, dict):
                user_constants = {}
                user['constants'] = user_constants

            saved_version = user_constants.get('rearcam_settings_version')
            reverse_cam_is_current = _rearcam_schema_is_current(
                default_reverse_cam,
                user.get('reverseCam'),
            )

            # Rearcam intentionally uses a clean format boundary. Reset only
            # this block when its version or structure is old/incompatible.
            if saved_version != REARCAM_SETTINGS_VERSION or not reverse_cam_is_current:
                logger.error(
                    '[Settings] Incompatible rearcam settings detected '
                    f'(saved version={saved_version!r}, expected={REARCAM_SETTINGS_VERSION}, '
                    f'schema_current={reverse_cam_is_current}). '
                    'Resetting only reverseCam to the current defaults.'
                )
                user['reverseCam'] = deepcopy(default_reverse_cam)
                user_constants['rearcam_settings_version'] = REARCAM_SETTINGS_VERSION
                user_constants['rearcam_settings_reset_notice'] = True
                updated.append('reverseCam (reset to current schema)')

        if added or updated:
            save_settings('app', user)
            logger.info(f'[Settings] Migrated app config; added={added}, updated={updated}')
    except Exception as e:
        logger.error(f'[Settings] Error during settings migration: {e}')


def check_settings():
    # Print directory paths for debugging
    logger.info(f'[Settings] (Dir) App Root: {APP_ROOT}')
    logger.info(f'[Settings] (Dir) Default profiles: {DEFAULT_PROFILES_DIR}')
    logger.info(f'[Settings] (Dir) Default configs: {DEFAULT_CONFIG_DIR}')
    logger.info(f'[Settings] (Dir) User configs: {USER_CONFIG_DIR}')

    # If user app config exists, return True
    if (USER_CONFIG_DIR / 'app.json').exists():
        migrate_settings()
        load_modules()
        return True
    else:
        # Scan profile directories and return available platforms + engines.
        try:
            result = {}
            for d in DEFAULT_PROFILES_DIR.iterdir():
                if d.is_dir():
                    subdirs = [sub.name for sub in d.iterdir() if sub.is_dir() and sub.name != "Default"]
                    if subdirs:
                        result[d.name] = subdirs
            return result
        except Exception as e:
            logger.error(f'Error reading directories: {e}')
            return None


def load_settings(setting):
    # Load settings file from user config.
    if not USER_CONFIG_DIR:
        return None

    settings_file = USER_CONFIG_DIR / f'{setting}.json'
    try:
        with settings_file.open('r', encoding='utf-8') as f:
            data = json.load(f)
            logger.info(f'[Settings] {setting}-settings loaded.')
            return data
    except Exception as e:
        logger.error(f'[Settings] Error loading settings from "{settings_file}": {e}')
        return None
    
    
def save_settings(setting, data):
    # Specify the file path
    logger.info(f'[Settings] Saving settings to "{setting}.json"...')
    json_path = USER_CONFIG_DIR / f'{setting}.json'

    # Save the settings to the JSON file
    try:
        with open(json_path, 'w') as file:
            json.dump(data, file, indent=4)
    except Exception as e:
        logger.error(f'[Settings] Error saving settings to "{json_path}": {e}')


def reset_settings():
    # Reset configs by re-applying the last saved profile from app.json.
    logger.info(f'[Settings] Resetting settings...')
    app_json_path = USER_CONFIG_DIR / 'app.json'
    if not app_json_path.exists():
        logger.error(f'[Settings] Undefined profile, please delete .config/v-link/ and restart the app.')
        shared_state.exit_event.set()

    with app_json_path.open('r', encoding='utf-8') as f:
        config = json.load(f)

    profile_data = config.get('constants', {}).get('profile')
    if not profile_data:
        logger.error(f'[Settings] Undefined profile, please delete .config/v-link/ and restart the app.')
        shared_state.exit_event.set()

    copy_files(profile_data)


def copy_files(data):
    try:
        logger.info(f'[Settings] Copying files to user config directory...')
        # Copy base + profile-specific config files into user config directory.

        if data == "default":
            profile_config = DEFAULT_CONFIG_DIR / 'profiles' / 'Default'

        else:
            platform = data.get('platform')
            engine = data.get('engine')

            profile_config = DEFAULT_CONFIG_DIR / 'profiles' / platform / engine


        USER_CONFIG_DIR.mkdir(parents=True, exist_ok=True)

        def copy_json_files(src: Path, dst: Path):
            if src.is_dir():
                for file in src.glob('*.json'):
                    shutil.copy(file, dst)

        # Copy base + profile-specific configs
        copy_json_files(DEFAULT_CONFIG_DIR, USER_CONFIG_DIR)
        if data != "default":
            copy_json_files(profile_config, USER_CONFIG_DIR)


        # Set modules states in app based on available config files
        try:
            app_settings = load_settings('app')
            modules = app_settings.get('constants', {}).get('modules', {})
            profile = app_settings.get('constants', {}).get('profile', {})

            for module_file in USER_CONFIG_DIR.glob("*.json"):
                name = module_file.stem  # e.g. "can" from "can.json"
                if name != "app":  # don’t toggle app.json itself
                    modules[name] = True
            
            app_settings['constants']['profile'] = data
            
            save_settings('app', app_settings)
        except Exception as e:
            logger.error(f'[Settings] Error loading app settings: {e}')
            shared_state.exit_event.set()
            return False
        
        load_modules()
        return True
    
    except Exception as e:
        logger.error(f'[Settings] Error copying files: {e}')
        return False
    
# Setting a shared_state based on app.json
def load_modules():
    settings = load_settings('app')
    if settings is None:
        logger.error('[Settings] Cannot load modules: app.json missing or invalid')
        return
    constants = settings.get('constants', {})

    shared_state.canModule = constants['modules']['can']
    shared_state.swcModule = constants['modules']['swc']
    shared_state.rtiModule = constants['modules']['rti']
    shared_state.adcModule = constants['modules']['adc']
