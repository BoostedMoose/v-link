# shared_state.py

import threading
from threading import Lock
import time

class SharedState:
    def __init__(self):
        #Global Variables
        self.car_data = {
            'data': {},
            'pollingrate': {},
            'timestamp': None,
        }
        self.car_data_lock = Lock()

        #Hardware
        self.rpiModel = 5
        self.sessionType = "wayland"

        #Modules
        self.vCan = False
        self.vLin = False
        self.dev = False
        self.pimost = False

        #Debug
        self.verbose = False
        self.vite = False

        #Display
        self.isKiosk = True
        self.browserWindowSize = (1280, 720)
        self.rtiStatus = False
        self.hdmiStatus = False

        self.update = False

        # Backlight settings (runtime). None means "not initialized yet".
        self.backlight_manual = None
        self.backlight_daylight = None
        self.backlight_darkness = None
        self.backlight_auto_enabled = None
        self.backlight_byte = None

        #Thread States:
        self.toggle_app = threading.Event()

        self.toggle_can = threading.Event()
        self.toggle_swc = threading.Event()
        self.toggle_adc = threading.Event()
        self.toggle_rti = threading.Event()
        self.toggle_ign = threading.Event()
        self.toggle_reverse = threading.Event()

        self.start_event = threading.Event()
        self.exit_event = threading.Event()
        self.restart_event = threading.Event()
        self.update_event = threading.Event()
        self.hdmi_event = threading.Event() 

        self.ignStatus = threading.Event()
        self.reverseStatus = threading.Event()

        self.shutdown_pi = threading.Event()

        #Module states:
        self.canModule = False
        self.swcModule = False
        self.rtiModule = False
        self.adcModule = False

        # store threads
        self.THREADS = {
            "server":   None,
            "app":      None,
            "can":      None,
            "swc":      None,
            "adc":      None,
            "rti":      None,
            "ign":      None,
            "cam":      None,
            "vcan":     None,
            "pimost":   None,
        }

    def update_car_data(self, key, value):
        with self.car_data_lock:
            self.car_data['data'][key] = f"{value:.2f}" if isinstance(value, float) else value
            self.car_data['timestamp'] = f"{time.monotonic():.3f}".replace('.', ',')

    def update_polling_rate(self, polling_rate: dict):
        with self.car_data_lock:
            self.car_data['pollingrate'] = polling_rate


shared_state = SharedState()
