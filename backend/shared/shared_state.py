# shared_state.py

import queue
import threading

from threading import Lock

class SharedState:
    def __init__(self):
        #Global Variables
        self.car_data = {}
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
        self.vite = True
        self.isKiosk = True

        #Display Status
        self.rtiStatus = False
        self.hdmiStatus = False

        self.update = False

        #Thread States:
        self.toggle_app = threading.Event()

        self.toggle_can = threading.Event()
        self.toggle_lin = threading.Event()
        self.toggle_adc = threading.Event()
        self.toggle_rti = threading.Event()
        self.toggle_ign = threading.Event()

        self.exit_event = threading.Event()
        self.restart_event = threading.Event()
        self.update_event = threading.Event()
        self.hdmi_event = threading.Event() 

        self.ignStatus = threading.Event()
        self.shutdown_pi = threading.Event()


        # store threads
        self.THREADS = {
            "server":   None,
            "app":      None,
            "can":      None,
            "lin":      None,
            "adc":      None,
            "rti":      None,
            "ign":      None,
            "vcan":     None,
            "pimost":   None,
        }

    def update_car_data(self, key, value):
        with self.car_data_lock:
            self.car_data[key] = value


shared_state = SharedState()