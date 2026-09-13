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
