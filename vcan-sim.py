import can
import random
import time
import struct
import argparse
import sys


class CANHardwareSimulator:
    def __init__(self, channel, bitrate):
        self.channel = channel
        self.bitrate = bitrate
        self.can_bus = None

        self.state = {
            "rpm": 1000,
            "boost": 1.0,
            "coolant": 70.0,
            "intake": 25.0,
            "lambda1": 0.9,
            "lambda2": 0.8,
            "voltage": 13.5,
        }

        self.param_map = {
            (0x10, 0x1D): "rpm",
            (0x12, 0x9D): "boost",
            (0x10, 0xD8): "coolant",
            (0x10, 0xCE): "intake",
            (0x10, 0x34): "lambda1",
            (0x10, 0x2C): "lambda2",
            (0x10, 0x0A): "voltage",
        }

    def start(self):
        try:
            self.can_bus = can.interface.Bus(channel=self.channel, bustype='socketcan', bitrate=self.bitrate)
        except Exception as e:
            print(f"Failed to initialize CAN interface '{self.channel}': {e}")
            sys.exit(1)

        print(f"CAN Hardware Simulator started on {self.channel} (bitrate: {self.bitrate})")

        try:
            while True:
                self.update_state()
                message = self.can_bus.recv(timeout=0.5)
                if message:
                    self.handle_request(message)
        except KeyboardInterrupt:
            print("\nSimulation stopped.")
        finally:
            self.shutdown()

    def shutdown(self):
        if self.can_bus:
            self.can_bus.shutdown()
            print("CAN bus closed.")

    def handle_request(self, message):
        data = message.data
        param = tuple(data[3:5])
        if param in self.param_map:
            sensor_key = self.param_map[param]
            self.send_response(param, sensor_key)

    def send_response(self, param_bytes, key):
        value = self.state[key]
        encoded = self.encode_value(key, value)
        if encoded is None:
            return
        response = [0xCD, 0x7A, 0xA6] + list(param_bytes) + encoded
        response += [0x00] * (8 - len(response))  # pad to 8 bytes
        msg = can.Message(arbitration_id=0x00400021, data=bytearray(response), is_extended_id=True)
        self.can_bus.send(msg)
        print(f"Sent {key} = {value:.2f} -> {msg.data.hex()}")

    def update_state(self):
        rpm = self.state["rpm"]
        rpm += random.randint(-200, 300)
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CAN Hardware Simulator")
    parser.add_argument("--channel", default="can2", help="CAN interface to use (e.g. can1, can2)")
    parser.add_argument("--bitrate", type=int, default=500000, help="CAN bitrate (default: 500000)")
    args = parser.parse_args()

    simulator = CANHardwareSimulator(channel=args.channel, bitrate=args.bitrate)
    simulator.start()
