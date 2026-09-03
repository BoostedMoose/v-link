import can
import random
import time
import struct
import threading
import subprocess
import os

# Route: (t, speed_kph, throttle, gear)
ROUTE = [
    (0.00,   0, 0.05, 1),
    (0.03,  20, 0.45, 1),
    (0.07,  50, 0.60, 3),
    (0.13,  50, 0.20, 3),
    (0.17,  30, 0.05, 2),
    (0.20,  20, 0.30, 2),
    (0.25,  70, 0.70, 4),
    (0.35, 100, 0.55, 5),
    (0.42, 120, 0.65, 6),
    (0.47, 100, 0.30, 6),
    (0.52,  60, 0.05, 4),
    (0.56,  40, 0.25, 3),
    (0.63,  80, 0.75, 5),
    (0.70, 110, 0.80, 6),
    (0.76,  50, 0.05, 3),
    (0.80,  50, 0.20, 3),
    (0.85,  80, 0.60, 5),
    (0.91,  30, 0.05, 2),
    (0.95,  20, 0.40, 2),
    (1.00,   0, 0.05, 1),
]

GEAR_RPM = {1: 110, 2: 62, 3: 43, 4: 32, 5: 25, 6: 20}
IDLE_RPM = 850


def lerp(a, b, t):
    return a + (b - a) * t

def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)

def route_state_at(pos):
    pos = pos % 1.0
    a, b = ROUTE[-1], ROUTE[0]
    for i in range(len(ROUTE) - 1):
        if ROUTE[i][0] <= pos <= ROUTE[i + 1][0]:
            a, b = ROUTE[i], ROUTE[i + 1]
            break
    span = b[0] - a[0]
    alpha = smoothstep((pos - a[0]) / span) if span > 0 else 0.0
    speed    = lerp(a[1], b[1], alpha)
    throttle = lerp(a[2], b[2], alpha)
    gear     = max(1, min(6, round(lerp(a[3], b[3], alpha))))
    return speed, throttle, gear

def derive_engine_state(speed_kph, throttle, gear):
    s = {}
    s["rpm"]   = max(IDLE_RPM, speed_kph * GEAR_RPM[gear])
    s["speed"] = speed_kph

    rpm_norm = min(1.0, max(0.0, (s["rpm"] - 1500) / 4000))
    load     = throttle * rpm_norm

    s["boost"]          = 1.0 + load
    s["coolant"]        = 75.0 + load * 15.0 + random.gauss(0, 0.3)
    s["intake"]         = 25.0 + s["boost"] * 8.0 - speed_kph * 0.05 + random.gauss(0, 0.5)
    s["exhaustgastemp"] = 350 + load * 600 + s["rpm"] * 0.03 + random.gauss(0, 5)

    lam = (0.88 if throttle > 0.75 else 1.02 if throttle < 0.10 else 1.00) + random.gauss(0, 0.008)
    s["lambda1"] = lam
    s["lambda2"] = lam + random.gauss(0, 0.008)

    s["shorttermfueltrim"]    = 1.0 + random.gauss(0, 0.02)
    s["longtermfueltrimidle"] = 1.0 + random.gauss(0, 0.005)
    s["longtermfueltrimload"] = 1.0 + random.gauss(0, 0.005)

    maf = s["rpm"] * s["boost"] * throttle * 0.004 + 5
    s["massairflowraw"]      = maf + random.gauss(0, 0.3)
    s["massairflowfiltered"] = maf + random.gauss(0, 0.1)
    s["relativeaircharge"]   = min(100, maf * 1.8 + random.gauss(0, 0.5))

    s["ignitionretarding"]   = random.uniform(-6.0, 0.0) if (load > 0.5 and random.random() < 0.15) else 0.0
    s["desiredenginetorque"] = throttle * 85 + rpm_norm * 15 + random.gauss(0, 1)
    s["voltage"]             = (14.1 - load * 0.3 if s["rpm"] > 1000 else 12.4) + random.gauss(0, 0.05)
    s["dashboard_brightness"] = 8

    return s


SMOOTH_K = {
    "rpm": 0.05, "speed": 0.05, "boost": 0.08, "coolant": 0.001,
    "intake": 0.03, "exhaustgastemp": 0.02, "lambda1": 0.15, "lambda2": 0.15,
    "shorttermfueltrim": 0.20, "longtermfueltrimidle": 0.002, "longtermfueltrimload": 0.002,
    "massairflowraw": 0.10, "massairflowfiltered": 0.05, "ignitionretarding": 0.30,
    "relativeaircharge": 0.10, "desiredenginetorque": 0.10, "voltage": 0.05,
}


class VCANThread(threading.Thread):
    def __init__(self, logger):
        super().__init__()
        self._stop_event = threading.Event()
        self.daemon = True
        self.can_bus = None
        self.logger = logger
        self.channel = "vcan0"

        script_directory = os.path.dirname(os.path.abspath(__file__))
        subprocess.run([os.path.join(script_directory, 'setup.sh')], shell=True)

        self.ROUTE_DURATION_S = 120.0
        self.route_pos = 0.0
        self._last_update_time = time.monotonic()

        self.smooth = derive_engine_state(*route_state_at(0.0))
        self.state  = dict(self.smooth)

        self.param_map = {
            (0x10, 0x1D): "rpm",
            (0x12, 0x9D): "boost",
            (0x10, 0xD8): "coolant",
            (0x10, 0xCE): "intake",
            (0x10, 0x34): "lambda1",
            (0x10, 0x2C): "lambda2",
            (0x10, 0x0A): "voltage",
            (0x10, 0xA5): "speed",
            (0x10, 0x5B): "shorttermfueltrim",
            (0x18, 0x65): "longtermfueltrimidle",
            (0x10, 0x5C): "longtermfueltrimload",
            (0x10, 0xAE): "massairflowraw",
            (0x10, 0x78): "massairflowfiltered",
            (0x19, 0x0A): "ignitionretarding",
            (0x10, 0x82): "exhaustgastemp",
            (0x10, 0xB5): "relativeaircharge",
            (0x12, 0xCB): "desiredenginetorque",
        }

    def run(self):
        try:
            self.can_bus = can.interface.Bus(channel=self.channel, bustype='socketcan', bitrate=500000)
            while not self._stop_event.is_set():
                self.update_state()
                self.send_dashboard_brightness()
                message = self.can_bus.recv(timeout=0.1)
                if message:
                    self.check_message(message)
        except Exception as e:
            self.logger.error(f"VCAN thread error: {e}")
        finally:
            self.stop_canbus()

    def update_state(self):
        now = time.monotonic()
        dt  = now - self._last_update_time
        self._last_update_time = now

        self.route_pos = (self.route_pos + dt / self.ROUTE_DURATION_S) % 1.0
        target = derive_engine_state(*route_state_at(self.route_pos))

        for key, tgt in target.items():
            k = SMOOTH_K.get(key, 0.05)
            prev = self.smooth.get(key, tgt)
            self.smooth[key] = prev + (tgt - prev) * k

        self.state = dict(self.smooth)

    def check_message(self, message):
        if len(message.data) >= 5:
            param = tuple(message.data[3:5])
            if param in self.param_map:
                self.send_response(param, self.param_map[param])

    def send_dashboard_brightness(self):
        level = max(0, min(15, int(self.state.get("dashboard_brightness", 8))))
        data = bytearray([level, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
        self.can_bus.send(can.Message(arbitration_id=0x0100082C, data=data, is_extended_id=True))

    def send_response(self, param_bytes, key):
        encoded = self.encode_value(key, self.state.get(key, 0.0))
        if encoded is None:
            return
        response = [0xCD, 0x7A, 0xA6] + list(param_bytes) + encoded
        response += [0x00] * (8 - len(response))
        self.can_bus.send(can.Message(arbitration_id=0x00400021, data=bytearray(response), is_extended_id=True))

    def encode_value(self, key, value):
        try:
            if key == "boost":
                return [int((value / 0.01) + 101) & 0xFF]
            elif key in ["intake", "coolant"]:
                return [int((value + 47.0) / 0.75) & 0xFF]
            elif key == "voltage":
                return [int(value * 10.611399) & 0xFF]
            elif key == "lambda1":
                return list(struct.pack(">H", int(value * 65536.0 / 16.0)))
            elif key == "lambda2":
                return [int(value * 255.0 / 1.33) & 0xFF]
            elif key == "rpm":
                return [int(value / 40) & 0xFF]
            elif key == "speed":
                return list(struct.pack(">H", int(value * 65536.0 / 512.0)))
            elif key in ["shorttermfueltrim", "longtermfueltrimload"]:
                return list(struct.pack(">H", int(value * 65535.0 / 2.0)))
            elif key == "longtermfueltrimidle":
                return list(struct.pack(">H", int(value * 65535.0 / 3072.0)))
            elif key in ["massairflowraw", "massairflowfiltered"]:
                return list(struct.pack(">H", int(value / 0.1)))
            elif key == "ignitionretarding":
                return [int(value / -0.75) & 0xFF]
            elif key == "exhaustgastemp":
                return list(struct.pack(">H", int((value * 256 + 12800) / 5)))
            elif key == "relativeaircharge":
                return list(struct.pack(">H", int(value * 32 / 0.75)))
            elif key == "desiredenginetorque":
                return list(struct.pack(">H", int(value * 65536 / 100)))
        except Exception:
            return None

    def stop_thread(self):
        self._stop_event.set()

    def stop_canbus(self):
        if self.can_bus:
            self.can_bus.shutdown()
