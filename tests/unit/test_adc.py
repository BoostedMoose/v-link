from types import SimpleNamespace
from unittest.mock import MagicMock

from backend.threads import adc


def test_interpolation_uses_the_enclosing_points():
    thread = adc.ADCThread(MagicMock())
    voltage_table = {"0.5": 0, "2.5": 200, "4.5": 1000}
    ntc_table = {"2038": 25, "1683": 30, "1398": 35}

    assert thread.interpolate_value(1.0, None, voltage_table) == 50
    assert thread.interpolate_value(5.0, None, voltage_table) == 1200
    assert thread.interpolate_value(0, 1700, ntc_table) == 30.0


def test_sensor_error_does_not_stop_other_sensors(monkeypatch):
    thread = adc.ADCThread(MagicMock())
    table = {"0.5": 0, "4.5": 1000}
    thread.sensor_data = {"sensors": {
        "broken": {"ntc": False, "characteristic": table, "scale": "value +"},
        "pressure": {"ntc": False, "characteristic": table, "scale": "(value / 100)"},
    }}
    thread.channels = [SimpleNamespace(voltage=2.5), SimpleNamespace(voltage=2.5)]
    update = MagicMock()
    monkeypatch.setattr(adc.shared_state, "update_car_data", update)

    thread.read_sensor()
    thread.read_sensor()

    update.assert_called_with("pressure", 5.0)
    assert update.call_count == 2
    thread.logger.error.assert_called_once()
