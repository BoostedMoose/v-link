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


def _app_settings(*, manual=15, automatic=True):
    return {
        "manual_backlight": {"value": manual, "min": 1, "max": 16},
        "auto_backlight": {"autoOpen": {"value": automatic}},
    }


def _reset_runtime():
    shared_state.backlight_manual = None
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
        shared_state.backlight_auto_enabled,
        shared_state.backlight_byte,
        shared_state.car_data,
    )
    _reset_runtime()
    yield
    (
        shared_state.backlight_manual,
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


def test_maps_all_manual_steps_to_profile_commands(monkeypatch):
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


@pytest.mark.parametrize("level", range(1, 17))
def test_automatic_mode_follows_all_dashboard_levels(monkeypatch, level):
    shared_state.car_data["data"]["dashboard_brightness"] = f"{level:.2f}"
    monkeypatch.setattr(
        backlight_helper.settings,
        "load_settings",
        lambda name: _app_settings(manual=7, automatic=True) if name == "app" else {},
    )

    byte, _changed, mode = backlight_helper.BacklightController(BRIGHTNESS_BYTES).update()

    assert byte == BRIGHTNESS_BYTES[level - 1]
    assert mode == "automatic"


def test_manual_mode_ignores_dashboard_brightness(monkeypatch):
    shared_state.car_data["data"]["dashboard_brightness"] = "1.00"
    monkeypatch.setattr(
        backlight_helper.settings,
        "load_settings",
        lambda name: _app_settings(manual=16, automatic=False) if name == "app" else {},
    )

    byte, _changed, mode = backlight_helper.BacklightController(BRIGHTNESS_BYTES).update()

    assert byte == BRIGHTNESS_BYTES[-1]
    assert mode == "manual"


@pytest.mark.parametrize("dashboard_value", [None, "invalid", "0.00", "17.00", "1.50"])
def test_automatic_mode_uses_manual_fallback_for_invalid_dashboard_level(monkeypatch, dashboard_value):
    if dashboard_value is not None:
        shared_state.car_data["data"]["dashboard_brightness"] = dashboard_value
    monkeypatch.setattr(
        backlight_helper.settings,
        "load_settings",
        lambda name: _app_settings(manual=3, automatic=True) if name == "app" else {},
    )

    byte, _changed, mode = backlight_helper.BacklightController(BRIGHTNESS_BYTES).update()

    assert byte == BRIGHTNESS_BYTES[2]
    assert mode == "automatic-fallback"
