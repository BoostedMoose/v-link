"""Tests for dynamic Raspberry Pi GPIO controller selection."""

from unittest.mock import MagicMock

import pytest

from backend.shared import gpio
from backend.shared.shared_state import shared_state
from backend.threads import cam, ign


def _add_device(device_dir, number):
    (device_dir / f"gpiochip{number}").touch()


def test_auto_detection_selects_header_controller_in_numeric_order(tmp_path, monkeypatch):
    _add_device(tmp_path, 10)
    _add_device(tmp_path, 2)
    opened = []
    closed = []

    def open_chip(number):
        opened.append(number)
        return number + 100

    def chip_info(handle):
        labels = {
            102: "unrelated-controller",
            110: "pinctrl-rp1",
        }
        return 0, 54, f"gpiochip{handle - 100}", labels[handle]

    monkeypatch.setattr(gpio, "GPIO_DEVICE_DIR", tmp_path)
    monkeypatch.setattr(gpio.lgpio, "gpiochip_open", open_chip)
    monkeypatch.setattr(gpio.lgpio, "gpio_get_chip_info", chip_info)
    monkeypatch.setattr(gpio.lgpio, "gpiochip_close", closed.append)

    handle, number = gpio.open_gpiochip()

    assert (handle, number) == (110, 10)
    assert opened == [2, 10]
    assert closed == [102]


def test_environment_override_bypasses_auto_detection(tmp_path, monkeypatch):
    monkeypatch.setattr(gpio, "GPIO_DEVICE_DIR", tmp_path)
    monkeypatch.setenv("VLINK_GPIO_CHIP", "7")
    open_chip = MagicMock(return_value=123)
    monkeypatch.setattr(gpio.lgpio, "gpiochip_open", open_chip)

    assert gpio.open_gpiochip() == (123, 7)
    open_chip.assert_called_once_with(7)


def test_auto_detection_skips_a_chip_that_cannot_be_opened(tmp_path, monkeypatch):
    _add_device(tmp_path, 0)
    _add_device(tmp_path, 4)
    closed = []

    def open_chip(number):
        if number == 0:
            raise gpio.lgpio.error("can not open gpiochip")
        return 44

    monkeypatch.setattr(gpio, "GPIO_DEVICE_DIR", tmp_path)
    monkeypatch.setattr(gpio.lgpio, "gpiochip_open", open_chip)
    monkeypatch.setattr(
        gpio.lgpio,
        "gpio_get_chip_info",
        lambda handle: (0, 54, "gpiochip4", "pinctrl-rp1"),
    )
    monkeypatch.setattr(gpio.lgpio, "gpiochip_close", closed.append)

    assert gpio.open_gpiochip() == (44, 4)
    assert closed == []


@pytest.mark.parametrize("override", ["", "gpiochip4", "-1"])
def test_invalid_override_has_a_clear_error(override, monkeypatch):
    monkeypatch.setenv("VLINK_GPIO_CHIP", override)

    with pytest.raises(RuntimeError, match="expected a non-negative integer"):
        gpio.open_gpiochip()


def test_no_matching_header_controller_closes_every_handle(tmp_path, monkeypatch):
    _add_device(tmp_path, 1)
    _add_device(tmp_path, 3)
    closed = []

    monkeypatch.setattr(gpio, "GPIO_DEVICE_DIR", tmp_path)
    monkeypatch.setattr(gpio.lgpio, "gpiochip_open", lambda number: number + 20)
    monkeypatch.setattr(
        gpio.lgpio,
        "gpio_get_chip_info",
        lambda handle: (0, 8, f"gpiochip{handle - 20}", "unrelated-controller"),
    )
    monkeypatch.setattr(gpio.lgpio, "gpiochip_close", closed.append)

    with pytest.raises(RuntimeError, match="Cannot find an accessible"):
        gpio.open_gpiochip()

    assert closed == [21, 23]


def test_reverse_thread_uses_detected_chip(monkeypatch):
    logger = MagicMock()
    selector = MagicMock(return_value=(42, 7))
    claim_input = MagicMock()
    monkeypatch.setattr(cam, "open_gpiochip", selector)
    monkeypatch.setattr(cam.lgpio, "gpio_claim_input", claim_input)

    thread = cam.CAMThread(logger=logger)
    selector.assert_not_called()
    thread._stop_event.set()
    thread.run()

    selector.assert_called_once_with(None)
    claim_input.assert_called_once_with(42, 20)
    assert thread.chip_id == 7


def test_ignition_thread_uses_detected_chip(monkeypatch):
    logger = MagicMock()
    selector = MagicMock(return_value=(43, 8))
    monkeypatch.setattr(ign, "open_gpiochip", selector)

    thread = ign.IGNThread(logger=logger)
    selector.assert_not_called()
    thread._stop_event.set()
    thread.run()

    selector.assert_called_once_with(None)
    assert thread.chip_id == 8
    assert thread.chip is None


@pytest.mark.parametrize("thread_class", [cam.CAMThread, ign.IGNThread])
def test_gpio_initialization_failure_does_not_escape_thread_run(thread_class, monkeypatch):
    logger = MagicMock()
    module = cam if thread_class is cam.CAMThread else ign
    status = shared_state.reverseStatus if module is cam else shared_state.ignStatus
    status.set()
    monkeypatch.setattr(
        module,
        "open_gpiochip",
        MagicMock(side_effect=RuntimeError("no usable GPIO controller")),
    )

    thread = thread_class(logger=logger)
    thread.run()

    logger.error.assert_called()
    assert not status.is_set()


def test_camera_power_toggle_detects_chip_when_first_used(monkeypatch):
    logger = MagicMock()
    selector = MagicMock(return_value=(44, 9))
    claim_output = MagicMock()
    gpio_write = MagicMock()
    monkeypatch.setattr(cam, "open_gpiochip", selector)
    monkeypatch.setattr(cam.lgpio, "gpio_claim_output", claim_output)
    monkeypatch.setattr(cam.lgpio, "gpio_write", gpio_write)

    driver = cam.CameraGPIO(logger=logger)
    assert driver.toggle() is True

    selector.assert_called_once_with(None)
    claim_output.assert_called_once_with(44, 26, 0)
    gpio_write.assert_called_once_with(44, 26, 1)
    assert driver._chip_num == 9
