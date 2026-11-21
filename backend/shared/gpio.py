"""Locate the Raspberry Pi header controller without assuming its chip number."""

import os
from pathlib import Path

import lgpio


GPIO_DEVICE_DIR = Path("/dev")
RASPBERRY_PI_HEADER_LABELS = frozenset(
    {
        "pinctrl-rp1",
        "pinctrl-bcm2711",
        "pinctrl-bcm2835",
    }
)


def _chip_number(device):
    """Return the numeric suffix from a /dev/gpiochipN path."""
    return int(device.name.removeprefix("gpiochip"))


def _open_explicit_gpiochip(number):
    try:
        return lgpio.gpiochip_open(number), number
    except lgpio.error as exc:
        raise RuntimeError(
            f"Cannot open /dev/gpiochip{number}: {exc}. "
            "Check that the device exists and your user has read/write access."
        ) from exc


def open_gpiochip(chip=None):
    """Open the Raspberry Pi header GPIO controller.

    Return ``(handle, chip_number)``. Passing ``chip`` or setting the
    ``VLINK_GPIO_CHIP`` environment variable explicitly overrides detection.
    The caller owns the returned handle and must close it.
    """
    if chip is None:
        chip = os.environ.get("VLINK_GPIO_CHIP")
    if chip is not None:
        try:
            number = int(chip)
        except (TypeError, ValueError) as exc:
            raise RuntimeError(
                f"Invalid GPIO chip {chip!r}; expected a non-negative integer."
            ) from exc
        if number < 0:
            raise RuntimeError(
                f"Invalid GPIO chip {chip!r}; expected a non-negative integer."
            )
        return _open_explicit_gpiochip(number)

    devices = sorted(
        GPIO_DEVICE_DIR.glob("gpiochip[0-9]*"),
        key=_chip_number,
    )
    if not devices:
        raise RuntimeError(
            "No /dev/gpiochip* devices are available. Run on the Raspberry Pi "
            "with GPIO devices exposed to this process."
        )

    errors = []
    for device in devices:
        number = _chip_number(device)
        handle = None
        try:
            handle = lgpio.gpiochip_open(number)
            _, _, _, label = lgpio.gpio_get_chip_info(handle)
            if label in RASPBERRY_PI_HEADER_LABELS:
                selected = handle
                handle = None  # Ownership passes to the caller.
                return selected, number
            errors.append(f"{device}: controller {label}")
        except lgpio.error as exc:
            errors.append(f"{device}: {exc}")
        finally:
            if handle is not None:
                lgpio.gpiochip_close(handle)

    raise RuntimeError(
        "Cannot find an accessible Raspberry Pi header GPIO controller. "
        + "; ".join(errors)
        + ". Check device read/write permissions (GPIO group membership). "
        "Use VLINK_GPIO_CHIP=<number> to explicitly select a controller."
    )
