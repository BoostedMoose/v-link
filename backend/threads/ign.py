import threading
import time
import lgpio

from ..shared.gpio import open_gpiochip
from ..shared.shared_state import shared_state

class IGNThread(threading.Thread):
    def __init__(self, logger, chip=None):
        super().__init__()
        self.logger = logger

        self.IGNITION_PIN = 1
        self._requested_chip = chip
        self.chip = None
        self.chip_id = chip
        self._claimed = False

        self._stop_event = threading.Event()
        self.daemon = True

    def run(self):
        try:
            self.chip, self.chip_id = open_gpiochip(self._requested_chip)
            lgpio.gpio_claim_input(self.chip, self.IGNITION_PIN)
            self._claimed = True
            self.logger.info(f'[Ignition] Using gpiochip{self.chip_id}')

            self.monitor_ignition()
        except Exception as e:
            shared_state.ignStatus.clear()
            requested_chip = self.chip_id if self.chip_id is not None else 'auto'
            self.logger.error(
                f'[Ignition] GPIO initialization failed (chip={requested_chip}, '
                f'line={self.IGNITION_PIN}): {e}. Ignition input disabled.'
            )
        finally:
            self.release_gpio()

    def stop_thread(self):
        self._stop_event.set()

    def release_gpio(self):
        if self.chip is None:
            return

        try:
            if self._claimed:
                lgpio.gpio_free(self.chip, self.IGNITION_PIN)
        except lgpio.error as e:
            self.logger.error(f'[Ignition] Could not release GPIO Pin {self.IGNITION_PIN}: {e}')
        finally:
            try:
                lgpio.gpiochip_close(self.chip)
            except lgpio.error as e:
                self.logger.error(f'[Ignition] Could not close gpiochip{self.chip_id}: {e}')
            self.chip = None
            self._claimed = False


    def monitor_ignition(self):
        previous_state = None  # Variable to track the previous state of the ignition pin
        
        while not self._stop_event.is_set():
            try:
                # Read GPIO pin value (LOW = Ignition OFF)
                current_state = lgpio.gpio_read(self.chip, self.IGNITION_PIN)
                
                # Check if the state has changed
                if current_state != previous_state:

                    # For V-Link HAT < v1.2, set this to False
                    IS_NEW_HAT = True  

                    ignition_off_state = 0 if IS_NEW_HAT else 1

                    if current_state == ignition_off_state:
                        self.logger.info(f'[Ignition] OFF')
                        if not shared_state.dev:
                            shared_state.ignStatus.clear()
                    else:
                        self.logger.info(f'[Ignition] ON')
                        shared_state.ignStatus.set()

                    # Update previous state for the next iteration
                    previous_state = current_state

            except lgpio.error as e:
                self.logger.error(f'[Ignition] Error reading GPIO {self.IGNITION_PIN}: {e}')
                time.sleep(1)  # Avoid tight looping if there's a problem
                continue

            time.sleep(1)  # Avoid high CPU usage

