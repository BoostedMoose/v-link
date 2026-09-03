import pytest

from backend.shared import backlight_helper
from backend.shared.shared_state import shared_state


BRIGHTNESS_STRINGS = [
    "0x20", "0x61", "0x62", "0x23",
    "0x64", "0x25", "0x26", "0x67",
    "0x68", "0x29", "0x2A", "0x2C",
    "0x6B", "0x6D", "0x6E", "0x2F",
]
BRIGHTNESS_BYTES = [int(value, 0) for value in BRIGHTNESS_STRINGS]


def _app_settings(*, manual=15, daylight=15, darkness=5, automatic=True):
    return {
        "manual_backlight": {"value": manual, "min": 1, "max": 16},
        "daylight_backlight": {"value": daylight, "min": 1, "max": 16},
        "darkness_backlight": {"value": darkness, "min": 1, "max": 16},
        "auto_backlight": {"autoOpen": {"value": automatic}},
    }


def _reset_runtime():
    shared_state.backlight_manual = None
    shared_state.backlight_daylight = None
    shared_state.backlight_darkness = None
    shared_state.backlight_auto_enabled = None
    shared_state.backlight_byte = None
    shared_state.car_data = {
        "data": {},
        "pollingrate": {},
        "timestamp": None,
    }


@pytest.fixture(autouse=True)
def reset_shared_backlight_state():
    original = (
        shared_state.backlight_manual,
        shared_state.backlight_daylight,
        shared_state.backlight_darkness,
        shared_state.backlight_auto_enabled,
        shared_state.backlight_byte,
        shared_state.car_data,
    )
    _reset_runtime()
    yield
    (
        shared_state.backlight_manual,
        shared_state.backlight_daylight,
        shared_state.backlight_darkness,
        shared_state.backlight_auto_enabled,
        shared_state.backlight_byte,
        shared_state.car_data,
    ) = original


def test_loads_brightness_table_from_rti_profile(monkeypatch):
    monkeypatch.setattr(
        backlight_helper.settings,
        "load_settings",
        lambda name: {"commands": {"brightness": BRIGHTNESS_STRINGS}} if name == "rti" else {},
    )

    assert backlight_helper.load_brightness_levels() == BRIGHTNESS_BYTES


def test_invalid_or_missing_profile_table_disables_brightness(monkeypatch):
    monkeypatch.setattr(
        backlight_helper.settings,
        "load_settings",
        lambda _name: {"commands": {"brightness": ["0x20", "not-a-byte"]}},
    )
    assert backlight_helper.load_brightness_levels() == []

    _reset_runtime()
    monkeypatch.setattr(
        backlight_helper.settings,
        "load_settings",
        lambda name: _app_settings(automatic=False) if name == "app" else {"commands": {}},
    )
    assert backlight_helper.BacklightController().update() == (None, False, "manual")


def test_maps_all_logical_steps_to_profile_commands(monkeypatch):
    _reset_runtime()
    monkeypatch.setattr(
        backlight_helper.settings,
        "load_settings",
        lambda name: _app_settings(automatic=False) if name == "app" else {},
    )
    controller = backlight_helper.BacklightController(BRIGHTNESS_BYTES)
    controller.update()

    for step, expected_byte in enumerate(BRIGHTNESS_BYTES, start=1):
        shared_state.backlight_manual = step
        byte, _changed, mode = controller.update()
        assert byte == expected_byte
        assert mode == "manual"


def test_manual_mode_ignores_can_light_state(monkeypatch):
    _reset_runtime()
    shared_state.car_data["data"]["light"] = 0.0
    monkeypatch.setattr(
        backlight_helper.settings,
        "load_settings",
        lambda name: _app_settings(manual=16, darkness=1, automatic=False) if name == "app" else {},
    )

    byte, _changed, mode = backlight_helper.BacklightController(BRIGHTNESS_BYTES).update()

    assert byte == BRIGHTNESS_BYTES[-1]
    assert mode == "manual"


def test_automatic_mode_uses_daylight_when_sensor_is_unavailable(monkeypatch):
    _reset_runtime()
    monkeypatch.setattr(
        backlight_helper.settings,
        "load_settings",
        lambda name: _app_settings(daylight=3, automatic=True) if name == "app" else {},
    )

    byte, _changed, mode = backlight_helper.BacklightController(BRIGHTNESS_BYTES).update()

    assert byte == BRIGHTNESS_BYTES[2]
    assert mode == "day"
