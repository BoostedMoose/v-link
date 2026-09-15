import json
import shutil
import logging
from pathlib import Path

from backend.shared.shared_state import shared_state

logger = logging.getLogger('vlink')

# Constants
APP_ROOT = Path(__file__).resolve().parent.parent
USER_CONFIG_DIR = Path.home() / '.config' / 'v-link'

DEFAULT_PROFILES_DIR = APP_ROOT / 'backend' / 'config' / 'profiles'
DEFAULT_CONFIG_DIR = APP_ROOT / 'backend' / 'config'

def load_directory():
    # Ensure user config directory exists.
    try:
        USER_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        return USER_CONFIG_DIR
    except Exception as e:
        logger.error(f'Error creating directory: {e}')
        return None
    

def migrate_settings():
    # Merge any top-level keys present in the default config but missing from the user config.
    default_app = DEFAULT_CONFIG_DIR / 'app.json'
    user_app = USER_CONFIG_DIR / 'app.json'
    if not default_app.exists() or not user_app.exists():
        return
    try:
        with default_app.open('r', encoding='utf-8') as f:
            defaults = json.load(f)
        with user_app.open('r', encoding='utf-8') as f:
            user = json.load(f)

        missing = {k: v for k, v in defaults.items() if k not in user}
        if missing:
            user.update(missing)
            save_settings('app', user)
            logger.info(f'[Settings] Migrated missing keys into user config: {list(missing.keys())}')
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
