# shared_state.py

import queue
import threading

class SharedState:
    def __init__(self):
        #Global Variables
        self.verbose = False

        self.rpiModel = 5
        self.sessionType = "wayland"

        self.vCan = False
        self.vLin = False

        self.vite = True
        self.isKiosk = True

        self.rtiStatus = False
        self.hdmiStatus = False

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
        self.ign_event = threading.Event()

        self.shutdown_pi = threading.Event()

        self.THREAD_STATES = {
            "server":   False,
            "app":      False,
            
            "can":      False,
            "lin":      False,
            "adc":      False,
            "rti":      False,
            "ign":      False,

            "vcan":     False,
        }

shared_state = SharedState()