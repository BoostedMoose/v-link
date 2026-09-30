from .. import settings
from .shared_state import shared_state


DEFAULT_MANUAL = {"value": 15, "min": 1, "max": 16}
DEFAULT_AUTO = True


def clamp(value, low, high):
    return max(low, min(high, value))


def load_brightness_levels():
    """Load and validate the ordered brightness command table from rti.json."""
    rti = settings.load_settings("rti") or {}
    raw_levels = rti.get("commands", {}).get("brightness", [])
    if not isinstance(raw_levels, list):
        return []

    levels = []
    try:
        for raw_level in raw_levels:
            if isinstance(raw_level, str):
                level = int(raw_level, 0)
            elif isinstance(raw_level, int) and not isinstance(raw_level, bool):
                level = raw_level
            else:
                return []
            if not 0 <= level <= 0xFF:
                return []
            levels.append(level)
    except (TypeError, ValueError):
        return []

    return levels


def _read_range_setting(app, key, defaults):
    cfg = app.get(key, {}) if isinstance(app, dict) else {}
    if not isinstance(cfg, dict):
        return defaults.copy()

    value = cfg.get("value", defaults["value"])
    if isinstance(value, dict):
        value = value.get("value", defaults["value"])

    return {
        "value": value,
        "min": cfg.get("min", defaults["min"]),
        "max": cfg.get("max", defaults["max"]),
    }


def _read_toggle_setting(app, key, nested_key, default):
    cfg = app.get(key, {}) if isinstance(app, dict) else {}
    if isinstance(cfg, dict):
        nested = cfg.get(nested_key)
        if isinstance(nested, dict) and "value" in nested:
            return bool(nested.get("value", default))
        if "value" in cfg:
            return bool(cfg.get("value", default))
    return bool(default)


def load_backlight_config():
    runtime_manual = getattr(shared_state, "backlight_manual", None)
    runtime_auto = getattr(shared_state, "backlight_auto_enabled", None)

    if not isinstance(runtime_manual, (int, float)) or not isinstance(runtime_auto, bool):
        app = settings.load_settings("app") or {}
        manual = _read_range_setting(app, "manual_backlight", DEFAULT_MANUAL)
        auto_enabled = _read_toggle_setting(app, "auto_backlight", "autoOpen", DEFAULT_AUTO)

        if not isinstance(runtime_manual, (int, float)):
            shared_state.backlight_manual = manual["value"]
        else:
            manual["value"] = runtime_manual

        if not isinstance(runtime_auto, bool):
            shared_state.backlight_auto_enabled = auto_enabled
        else:
            auto_enabled = runtime_auto
    else:
        manual = {**DEFAULT_MANUAL, "value": runtime_manual}
        auto_enabled = runtime_auto

    return {"manual": manual, "auto": auto_enabled}


class BacklightMapper:
    def __init__(self, levels):
        self._levels = levels
        self._last_byte = None

    def map(self, step: int):
        if not self._levels:
            return None, False

        index = clamp(int(step) - 1, 0, len(self._levels) - 1)
        byte = self._levels[index]
        changed = byte != self._last_byte
        if changed:
            self._last_byte = byte
        return byte, changed


class BacklightController:
    """Select and translate the manual or dashboard-following brightness level."""

    def __init__(self, brightness_levels=None):
        levels = load_brightness_levels() if brightness_levels is None else brightness_levels
        self._mapper = BacklightMapper(levels)

    def _dashboard_level_from_can(self):
        """Return the 1-16 dashboard brightness level published by CAN."""
        try:
            with shared_state.car_data_lock:
                car_data = shared_state.car_data
                sensor_data = car_data.get("data")
                if isinstance(sensor_data, dict):
                    raw = sensor_data.get("dashboard_brightness")
                else:
                    raw = car_data.get("dashboard_brightness")
        except Exception:
            return None

        if raw is None:
            return None

        try:
            level = float(raw)
        except (TypeError, ValueError):
            return None

        if not level.is_integer() or not 1 <= level <= 16:
            return None
        return int(level)

    def update(self):
        """:return: (byte, changed, mode)"""
        cfg = load_backlight_config()

        dashboard_level = self._dashboard_level_from_can() if cfg["auto"] else None
        if dashboard_level is not None:
            step = dashboard_level
            mode = "automatic"
        else:
            manual = cfg["manual"]
            step = clamp(manual["value"], manual["min"], manual["max"])
            mode = "automatic-fallback" if cfg["auto"] else "manual"

        byte, changed = self._mapper.map(step)
        shared_state.backlight_byte = byte
        return byte, changed, mode
