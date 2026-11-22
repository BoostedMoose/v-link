import threading
from unittest.mock import MagicMock

from backend.threads.rti import RTIThread


def test_stop_waits_for_writer_before_closing_port():
    # Build without opening real serial hardware. Exercise the real Thread join
    # and finally cleanup with an in-flight write.
    rti = RTIThread.__new__(RTIThread)
    threading.Thread.__init__(rti)
    rti._stop_event = threading.Event()
    rti.logger = MagicMock()
    rti.rti_serial = MagicMock(is_open=True)
    writing = threading.Event()
    release = threading.Event()
    observations = []

    def write_loop():
        try:
            writing.set()
            release.wait(timeout=2)
            observations.append(rti.rti_serial.close.call_count)
        finally:
            rti.cleanup()

    def close():
        rti.rti_serial.is_open = False

    rti.rti_serial.close.side_effect = close
    rti.run_rti = write_loop
    rti.start()
    assert writing.wait(timeout=2)
    stopper = threading.Thread(target=rti.stop_thread)
    stopper.start()
    try:
        assert rti._stop_event.wait(timeout=2)
        assert not rti.rti_serial.close.called
    finally:
        release.set()
        stopper.join(timeout=2)
        rti.join(timeout=2)
    assert not stopper.is_alive()
    assert observations == [0]
    rti.rti_serial.close.assert_called_once()


def test_write_error_reopens_port_and_keeps_running(monkeypatch):
    from backend.threads import rti as rti_module

    monkeypatch.setattr(rti_module.shared_state, "rpiModel", 5)
    monkeypatch.setattr(RTIThread, "REOPEN_DELAY", 0)
    broken, working = MagicMock(is_open=True), MagicMock(is_open=True)
    broken.write.side_effect = rti_module.serial.SerialException("I/O error")
    broken.close.side_effect = lambda: setattr(broken, "is_open", False)
    opener = MagicMock(side_effect=[broken, working])
    monkeypatch.setattr(rti_module.serial, "Serial", opener)

    rti = RTIThread(MagicMock())
    rti._backlight = MagicMock(update=MagicMock(return_value=(None, False, None)))
    working.write.side_effect = lambda data: rti._stop_event.set()
    rti.run_rti()

    assert opener.call_count == 2
    rti.logger.error.assert_called_once()
    working.write.assert_called()
