from unittest.mock import MagicMock

import pytest

from backend.shared import backlight_helper
from backend.shared.shared_state import shared_state
from backend.threads import rti


BRIGHTNESS_LEVELS = [
    "0x20", "0x61", "0x62", "0x23",
    "0x64", "0x25", "0x26", "0x67",
    "0x68", "0x29", "0x2A", "0x2C",
    "0x6B", "0x6D", "0x6E", "0x2F",
]


class FakeSerial:
    def __init__(self):
        self.is_open = True
        self.writes = []
        self.on_write = None

    def write(self, value):
        self.writes.append(value)
        if self.on_write:
            self.on_write()

    def close(self):
        self.is_open = False


@pytest.mark.parametrize(
    ("level", "expected_byte"),
    [
        (1, 0x20),
        (16, 0x2F),
    ],
)
def test_rti_transmits_brightness_byte_for_manual_level(monkeypatch, level, expected_byte):
    fake_serial = FakeSerial()
    monkeypatch.setattr(rti.serial, "Serial", lambda *_args, **_kwargs: fake_serial)
    monkeypatch.setattr(rti.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(
        backlight_helper.settings,
        "load_settings",
        lambda name: {"commands": {"brightness": BRIGHTNESS_LEVELS}} if name == "rti" else {},
    )

    original = (
        shared_state.rpiModel,
        shared_state.rtiStatus,
        shared_state.backlight_manual,
        shared_state.backlight_daylight,
        shared_state.backlight_darkness,
        shared_state.backlight_auto_enabled,
        shared_state.backlight_byte,
    )
    try:
        shared_state.rpiModel = 5
        shared_state.rtiStatus = True
        shared_state.backlight_manual = level
        shared_state.backlight_daylight = 15
        shared_state.backlight_darkness = 5
        shared_state.backlight_auto_enabled = False
        shared_state.backlight_byte = None

        thread = rti.RTIThread(MagicMock())
        fake_serial.on_write = lambda: (
            thread._stop_event.set() if len(fake_serial.writes) == 3 else None
        )

        thread.run_rti()

        assert fake_serial.writes == [
            b"\x40",
            expected_byte.to_bytes(1, "big"),
            b"\x83",
        ]
        assert shared_state.backlight_byte == expected_byte
    finally:
        (
            shared_state.rpiModel,
            shared_state.rtiStatus,
            shared_state.backlight_manual,
            shared_state.backlight_daylight,
            shared_state.backlight_darkness,
            shared_state.backlight_auto_enabled,
            shared_state.backlight_byte,
        ) = original
