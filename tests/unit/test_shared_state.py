"""
Unit tests for backend/shared/shared_state.py
"""
import threading

from backend.shared.shared_state import SharedState


def test_initial_module_flags_are_false():
    s = SharedState()
    assert s.canModule is False
    assert s.swcModule is False
    assert s.rtiModule is False
    assert s.adcModule is False


def test_initial_thread_dict_has_all_keys():
    s = SharedState()
    expected = {'server', 'app', 'can', 'swc', 'adc', 'rti', 'ign', 'cam', 'vcan', 'pimost'}
    assert set(s.THREADS.keys()) == expected
    assert all(v is None for v in s.THREADS.values())


def test_toggle_events_are_threading_events():
    s = SharedState()
    for attr in (
        'toggle_can', 'toggle_swc', 'toggle_adc', 'toggle_rti',
        'toggle_ign', 'toggle_reverse', 'toggle_app',
    ):
        assert isinstance(getattr(s, attr), threading.Event), \
            f'{attr} is not a threading.Event'


def test_system_events_are_threading_events():
    s = SharedState()
    for attr in ('start_event', 'exit_event', 'restart_event', 'update_event',
                 'hdmi_event', 'ignStatus', 'reverseStatus', 'shutdown_pi'):
        assert isinstance(getattr(s, attr), threading.Event), \
            f'{attr} is not a threading.Event'


def test_events_start_unset():
    s = SharedState()
    for attr in (
        'toggle_can', 'toggle_swc', 'exit_event',
        'start_event', 'ignStatus', 'reverseStatus',
    ):
        assert not getattr(s, attr).is_set(), f'{attr} should start unset'


def test_update_car_data_stores_value():
    s = SharedState()
    s.update_car_data('rpm', 3000.0)
    assert s.car_data['data']['rpm'] == '3000.00'


def test_update_car_data_overwrites_existing():
    s = SharedState()
    s.update_car_data('boost', 1.2)
    s.update_car_data('boost', 0.8)
    assert s.car_data['data']['boost'] == '0.80'


def test_update_car_data_thread_safety():
    """100 concurrent writers must not cause data corruption or exceptions."""
    s = SharedState()
    errors = []

    def writer(key, value):
        try:
            s.update_car_data(key, value)
        except Exception as exc:
            errors.append(exc)

    threads = [
        threading.Thread(target=writer, args=(f'sensor_{i}', float(i)))
        for i in range(100)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f'Thread safety errors: {errors}'
    assert len(s.car_data['data']) == 100
    assert all(isinstance(value, str) for value in s.car_data['data'].values())


def test_ignition_event_set_and_clear():
    s = SharedState()
    assert not s.ignStatus.is_set()
    s.ignStatus.set()
    assert s.ignStatus.is_set()
    s.ignStatus.clear()
    assert not s.ignStatus.is_set()


def test_reverse_event_independent_from_ignition():
    s = SharedState()
    s.ignStatus.set()
    assert not s.reverseStatus.is_set()
    s.reverseStatus.set()
    assert s.ignStatus.is_set()
    assert s.reverseStatus.is_set()
