import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from backend.shared.shared_state import shared_state
from backend.threads import can as can_thread


P1_T5_CAN_PROFILE = (
    Path(__file__).resolve().parents[2]
    / "backend"
    / "config"
    / "profiles"
    / "P1"
    / "T5"
    / "can.json"
)


@pytest.fixture(autouse=True)
def preserve_car_data():
    original = shared_state.car_data
    shared_state.car_data = {"data": {}, "pollingrate": {}, "timestamp": None}
    yield
    shared_state.car_data = original


def test_p1_t5_uses_enabled_hs_can_dashboard_brightness_signal():
    profile = json.loads(P1_T5_CAN_PROFILE.read_text(encoding="utf-8"))

    assert "light" not in profile["sensors"]
    brightness = next(
        sensor
        for sensor in profile["signal_sensors"]
        if sensor["key"] == "dashboard_brightness"
    )
    assert brightness == {
        "key": "dashboard_brightness",
        "label": "Dashboard Brightness",
        "interface": "can2",
        "enabled": True,
        "can_id": "0x0100082C",
        "byte_index": 0,
        "mask": "0x0F",
        "shift": 0,
        "scale": "value + 1",
    }


def test_signal_config_parses_masked_byte_field(monkeypatch):
    profile = {
        "interfaces": [],
        "sensors": {},
        "signal_sensors": [
            {
                "key": "dashboard_brightness",
                "label": "Dashboard Brightness",
                "interface": "can2",
                "enabled": True,
                "can_id": "0x0100082C",
                "byte_index": 0,
                "mask": "0x0F",
                "shift": 0,
                "scale": "value + 1",
            }
        ],
    }
    monkeypatch.setattr(can_thread.settings, "load_settings", lambda _name: profile)

    config = can_thread.Config(MagicMock())

    assert config.signal_sensors["can2"][0] == {
        "key": "dashboard_brightness",
        "label": "Dashboard Brightness",
        "channel": "can2",
        "can_id": 0x0100082C,
        "byte_index": 0,
        "bit_index": None,
        "mask": 0x0F,
        "shift": 0,
        "invert": False,
        "scale": "value + 1",
    }


@pytest.mark.parametrize(
    ("first_byte", "expected_level"),
    [
        (0x00, "1.00"),
        (0xA0, "1.00"),
        (0x0F, "16.00"),
        (0xBF, "16.00"),
    ],
)
def test_listener_maps_lower_nibble_to_one_based_brightness(first_byte, expected_level):
    sensor = {
        "key": "dashboard_brightness",
        "byte_index": 0,
        "bit_index": None,
        "mask": 0x0F,
        "shift": 0,
        "invert": False,
        "scale": "value + 1",
    }
    listener = can_thread.CANListener({}, {0x0100082C: [sensor]}, MagicMock())
    message = SimpleNamespace(
        arbitration_id=0x0100082C,
        data=bytes([first_byte, 0x40, 0xBE, 0x07, 0x05, 0x90, 0x00, 0x00]),
    )

    listener.on_message_received(message)

    assert shared_state.car_data["data"]["dashboard_brightness"] == expected_level


def test_listener_processes_multiple_fields_from_the_same_frame():
    sensors = [
        {
            "key": "dashboard_brightness",
            "byte_index": 0,
            "bit_index": None,
            "mask": 0x0F,
            "shift": 0,
            "invert": False,
            "scale": "value + 1",
        },
        {
            "key": "light_state",
            "byte_index": 1,
            "bit_index": 7,
            "mask": None,
            "shift": None,
            "invert": False,
            "scale": None,
        },
    ]
    listener = can_thread.CANListener({}, {0x0100082C: sensors}, MagicMock())
    message = SimpleNamespace(arbitration_id=0x0100082C, data=bytes([0x0F, 0x80]))

    listener.on_message_received(message)

    assert shared_state.car_data["data"]["dashboard_brightness"] == "16.00"
    assert shared_state.car_data["data"]["light_state"] == "1.00"


@pytest.fixture
def preserve_reverse_status():
    was_set = shared_state.reverseStatus.is_set()
    shared_state.reverseStatus.clear()
    yield
    if was_set:
        shared_state.reverseStatus.set()
    else:
        shared_state.reverseStatus.clear()


def reverse_listener():
    sensor = {
        "key": "reverse",
        "byte_index": 2,
        "bit_index": 3,
        "mask": None,
        "shift": None,
        "invert": False,
        "scale": None,
    }
    return can_thread.CANListener({}, {0x00123456: [sensor]}, MagicMock())


def reverse_frame(active):
    return SimpleNamespace(
        arbitration_id=0x00123456,
        data=bytes([0x00, 0x00, 0x08 if active else 0x00, 0x00]),
    )


def test_listener_sets_and_clears_reverse_status(preserve_reverse_status):
    listener = reverse_listener()

    listener.on_message_received(reverse_frame(True))
    assert shared_state.reverseStatus.is_set()
    assert shared_state.car_data["data"]["reverse"] == "1.00"

    listener.on_message_received(reverse_frame(False))
    assert not shared_state.reverseStatus.is_set()
    assert shared_state.car_data["data"]["reverse"] == "0.00"


def test_listener_does_not_override_gpio_reverse_without_a_change(preserve_reverse_status):
    listener = reverse_listener()
    shared_state.reverseStatus.set()

    listener.on_message_received(reverse_frame(False))

    assert shared_state.reverseStatus.is_set()


def test_stop_thread_clears_reverse_set_by_can(preserve_reverse_status, monkeypatch):
    monkeypatch.setattr(can_thread, "Config", MagicMock())
    thread = can_thread.CANThread(MagicMock())
    listener = reverse_listener()
    thread.listeners.append(listener)
    listener.on_message_received(reverse_frame(True))

    thread.stop_thread()

    assert not shared_state.reverseStatus.is_set()


def test_scheduler_keeps_sending_after_a_failed_send(monkeypatch):
    monkeypatch.setattr(can_thread.CANScheduler, "RETRY_DELAY_MIN", 0)
    sensor = {"key": "boost", "label": "Boost", "priority": 1, "req_id": [0x000FFFFE], "message_bytes": [0xCD] * 8}
    bus = MagicMock()
    scheduler = can_thread.CANScheduler([sensor], bus, True, MagicMock())

    def send(msg):
        if bus.send.call_count == 1:
            raise can_thread.can.CanError("bus off")
        scheduler.stop()

    bus.send.side_effect = send
    scheduler.run()

    assert bus.send.call_count == 2
