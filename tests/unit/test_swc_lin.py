from unittest.mock import MagicMock, PropertyMock

from backend.threads import swc


def test_lin_read_error_reopens_port_and_keeps_reading(monkeypatch):
    monkeypatch.setattr(swc, "logger", MagicMock())
    monkeypatch.setattr(swc.LIN, "REOPEN_DELAY", 0)
    lin = swc.LIN({"interface": {"swm_id": "0x20", "sync_id": "0x55", "zero_code": "0x00"},
                   "button": {}, "joystick": {}}, MagicMock(), None)

    broken, working = MagicMock(is_open=True), MagicMock(is_open=True)
    type(broken).in_waiting = PropertyMock(side_effect=swc.serial.SerialException("I/O error"))
    broken.close.side_effect = lambda: setattr(broken, "is_open", False)
    type(working).in_waiting = PropertyMock(side_effect=lambda: lin._stop_event.set() or 0)
    monkeypatch.setattr(swc.serial, "Serial", MagicMock(return_value=working))
    lin.lin_serial = broken

    lin._read_from_serial()

    swc.serial.Serial.assert_called_once()
    swc.logger.error.assert_called_once()
