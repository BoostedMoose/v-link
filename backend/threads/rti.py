import threading
import time
import sys
import os
import subprocess
import serial

from ..shared.shared_state import shared_state
from ..shared.backlight_helper import BacklightController

class RTIThread(threading.Thread):
    def __init__(self, logger):
        super().__init__()
        self.rti_serial = None
        self._stop_event = threading.Event()
        self.daemon = True

        self.logger = logger
        self._backlight = BacklightController()

        try:
            if(shared_state.rpiModel == 5):
                self.rti_serial = serial.Serial('/dev/ttyAMA2', baudrate = 2400, timeout = 1)
            elif (shared_state.rpiModel == 4):
                self.rti_serial = serial.Serial('/dev/ttyAMA3', baudrate = 2400, timeout = 1)
            elif (shared_state.rpiModel == 3):
                self.rti_serial = serial.Serial('/dev/ttyS0', baudrate = 2400, timeout = 1)
        except serial.SerialException as e:
            self.logger.error(f'[RTI] Error initializing Serial port: {e}')
            self.rti_serial = None

    def run(self):
        self.run_rti()
        
    def stop_thread(self):
        time.sleep(.5)
        self.cleanup()
        self._stop_event.set()

    def write(self, byte):
        if self.rti_serial and self.rti_serial.is_open:
            self.rti_serial.write(byte.to_bytes(1, 'big'))
            time.sleep(0.1)

    def run_rti(self):
        try:
            while not self._stop_event.is_set():
                if not self.rti_serial or not self.rti_serial.is_open:
                    time.sleep(0.2)
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
                except Exception as e:
                    self.logger.error(f'[RTI] Error during operation: {e}')
                    break
        finally:
            self.cleanup()

    def cleanup(self):
        if self.rti_serial and self.rti_serial.is_open:
            self.rti_serial.close()
