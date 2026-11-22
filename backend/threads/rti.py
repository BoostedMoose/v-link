import threading
import time
import sys
import os
import subprocess
import serial

from ..shared.shared_state import shared_state
from ..shared.backlight_helper import BacklightController

class RTIThread(threading.Thread):
    REOPEN_DELAY = 2

    def __init__(self, logger):
        super().__init__()
        self.rti_serial = None
        self._stop_event = threading.Event()
        self.daemon = True

        self.logger = logger
        self._backlight = BacklightController()
        self._serial_error = False

        self._open_serial()

    def _open_serial(self):
        try:
            if(shared_state.rpiModel == 5):
                self.rti_serial = serial.Serial('/dev/ttyAMA2', baudrate = 2400, timeout = 1, write_timeout = 1)
            elif (shared_state.rpiModel == 4):
                self.rti_serial = serial.Serial('/dev/ttyAMA3', baudrate = 2400, timeout = 1, write_timeout = 1)
            elif (shared_state.rpiModel == 3):
                self.rti_serial = serial.Serial('/dev/ttyS0', baudrate = 2400, timeout = 1, write_timeout = 1)
        except serial.SerialException as e:
            # Log once per failure streak, the port is retried every REOPEN_DELAY seconds
            if not self._serial_error:
                self.logger.error(f'[RTI] Error initializing Serial port: {e}')
                self._serial_error = True
            self.rti_serial = None

    def run(self):
        self.run_rti()
        
    def stop_thread(self):
        self._stop_event.set()
        # Let the writer leave its loop before closing the serial port.
        if self.is_alive() and threading.current_thread() is not self:
            self.join()
        self.cleanup()

    def write(self, byte):
        if self.rti_serial and self.rti_serial.is_open:
            self.rti_serial.write(byte.to_bytes(1, 'big'))
            time.sleep(0.1)

    def run_rti(self):
        try:
            while not self._stop_event.is_set():
                if not self.rti_serial or not self.rti_serial.is_open:
                    self._stop_event.wait(self.REOPEN_DELAY)
                    if not self._stop_event.is_set():
                        self._open_serial()
                    continue
                try:
                    if shared_state.rtiStatus:
                        self.write(0x40)
                    else:
                        self.write(0x46)

                    byte, _changed, _mode = self._backlight.update()
                    if byte is not None:
                        self.write(byte)
                    self.write(0x83)

                    if self._serial_error:
                        self.logger.info('[RTI] Serial port working again.')
                        self._serial_error = False
                except Exception as e:
                    if not self._serial_error:
                        self.logger.error(f'[RTI] Error during operation: {e}, reopening port.')
                        self._serial_error = True
                    self.cleanup()
        finally:
            self.cleanup()

    def cleanup(self):
        if self.rti_serial and self.rti_serial.is_open:
            self.rti_serial.close()
