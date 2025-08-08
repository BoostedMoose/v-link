import can
import random
import time
import struct
import threading
import subprocess
import os
import shutil  # for checking can interface presence

from ..shared.shared_state import shared_state


class VCANThread(threading.Thread):
    def __init__(self, logger):
        super(VCANThread, self).__init__()
        self._stop_event = threading.Event()
        self.daemon = True
        self.can_bus = None
        self.logger = logger
        self.channel = self.detect_can_interface()

        # Run setup script for vcan if needed
        if self.channel.startswith("vcan"):
            script_directory = os.path.dirname(os.path.abspath(__file__))
            setup_script_path = os.path.join(script_directory, 'setup.sh')
            subprocess.run([setup_script_path], shell=True)

        # Simulation state (initial values)
        self.state = {
            "rpm": 1000,
            "boost": 1.0,
            "coolant": 70.0,
            "intake": 25.0,
            "lambda1": 0.9,
            "lambda2": 0.8,
            "voltage": 13.5,
        }

        # Parameter maps (PID bytes -> state keys)
        self.param_map = {
            (0x10, 0x1D): "rpm",
            (0x12, 0x9D): "boost",
            (0x10, 0xD8): "coolant",
            (0x10, 0xCE): "intake",
            (0x10, 0x34): "lambda1",
            (0x10, 0x2C): "lambda2",
            (0x10, 0x0A): "voltage",
        }

    def detect_can_interface(self):
        """Check available CAN interfaces and return preferred one."""
        try:
            with open("/proc/net/dev") as f:
                devs = f.read()
            if "can2:" in devs:
                print("Detected CAN interface: can2")
                return "can2"
            elif "vcan0:" in devs:
                print("Detected virtual CAN interface: vcan0")
                return "vcan0"
        except FileNotFoundError:
            pass

        # Default fallback
        print("No CAN interfaces detected, defaulting to vcan0")
        return "vcan0"

    def run(self):
        try:
            self.can_bus = can.interface.Bus(channel=self.channel, bustype='socketcan', bitrate=500000)
            while not self._stop_event.is_set():
                self.update_state()
                message = self.can_bus.recv(timeout=0.5)
                if message:
                    self.check_message(message)
        except Exception as e:
            print(f"VCAN thread error: {e}")
        finally:
            self.stop_canbus()

    def stop_thread(self):
        print("Stopping VCAN thread.")
        time.sleep(0.5)
        self._stop_event.set()

    def stop_canbus(self):
        if self.can_bus:
            self.can_bus.shutdown()

    def check_message(self, message):
        param = tuple(message.data[3:5])
        if param in self.param_map:
            key = self.param_map[param]
            self.send_response(param, key)

    def update_state(self):
        rpm = self.state["rpm"] + random.randint(-200, 300)
        rpm = max(800, min(7500, rpm))
        self.state["rpm"] = rpm

        boost = 0.8 + ((rpm - 800) / 6700.0) * 1.0 + random.uniform(-0.05, 0.05)
        self.state["boost"] = max(0.0, min(boost, 2.0))

        coolant = self.state["coolant"]
        if coolant < 90:
            coolant += random.uniform(0.1, 0.5)
        elif rpm > 4000:
            coolant += random.uniform(0.0, 0.3)
        else:
            coolant -= random.uniform(0.1, 0.3)
        self.state["coolant"] = max(60, min(coolant, 110))

        self.state["intake"] = 20 + self.state["boost"] * 15 + random.uniform(-2, 2)
        self.state["voltage"] = 13.8 + random.uniform(-0.2, 0.2)
        self.state["lambda1"] = 0.95 + random.uniform(-0.05, 0.05)
        self.state["lambda2"] = 0.85 + random.uniform(-0.1, 0.1)

    def send_response(self, param_bytes, key):
        value = self.state[key]
        encoded = self.encode_value(key, value)
        if encoded is None:
            return

        response = [0xCD, 0x7A, 0xA6] + list(param_bytes) + encoded
        response += [0x00] * (8 - len(response))

        msg = can.Message(arbitration_id=0x00400021,
                          data=bytearray(response),
                          is_extended_id=True)
        self.can_bus.send(msg)
        #self.logger.debug(f"Sent {key} = {value:.2f} -> {msg.data.hex()}")

    def encode_value(self, key, value):
        if key == "boost":
            raw = int((value / 0.01) + 101)
            return [raw & 0xFF]
        elif key in ["intake", "coolant"]:
            raw = int((value + 47.0) / 0.75)
            return [raw & 0xFF]
        elif key == "voltage":
            raw = int(value * 10.611399)
            return [raw & 0xFF]
        elif key == "lambda1":
            raw = int(value * 65536.0 / 16.0)
            return list(struct.pack(">H", raw))
        elif key == "lambda2":
            raw = int(value * 255.0 / 1.33)
            return [raw & 0xFF]
        elif key == "rpm":
            raw = int(value / 40)
            return [raw & 0xFF]
        return None
