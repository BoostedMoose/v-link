"""
Fake lgpio module for non-Raspberry Pi environments.
Injected into sys.modules['lgpio'] before any backend import.
"""

class LgpioError(Exception):
    pass


_pin_values: dict = {}
_chips: dict = {}
_chip_info: dict = {}


def gpiochip_open(chip_id: int) -> int:
    _chips[chip_id] = True
    return chip_id


def gpiochip_close(handle: int) -> None:
    _chips.pop(handle, None)


def gpio_get_chip_info(handle: int):
    return _chip_info.get(handle, (0, 54, f'gpiochip{handle}', 'pinctrl-bcm2711'))


def gpio_claim_input(handle: int, pin: int, flags: int = 0) -> int:
    _pin_values.setdefault((handle, pin), 0)
    return 0


def gpio_claim_output(handle: int, pin: int, initial: int = 0) -> int:
    _pin_values[(handle, pin)] = initial
    return 0


def gpio_read(handle: int, pin: int) -> int:
    return _pin_values.get((handle, pin), 0)


def gpio_write(handle: int, pin: int, value: int) -> int:
    _pin_values[(handle, pin)] = value
    return 0


def gpio_free(handle: int, pin: int) -> None:
    _pin_values.pop((handle, pin), None)


def gpio_set_pull_up_down(handle: int, pin: int, pud: int) -> int:
    return 0


def callback(handle: int, pin: int, edge: int, func) -> object:
    class _CB:
        def cancel(self):
            pass
    return _CB()


# Constants used by lgpio
RISING_EDGE = 1
FALLING_EDGE = 2
BOTH_EDGES = 3
SET_PULL_UP = 1
SET_PULL_DOWN = 2
SET_PULL_NONE = 0

error = LgpioError
