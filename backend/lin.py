import threading
import time
import sys
import serial
import uinput
from enum import Enum, auto
from pathlib import Path
from .buttonHandler import ButtonHandler
from . import settings
from .shared.shared_state import shared_state

class Config:
    def __init__(self):
        self.lin_settings = settings.load_settings("lin")

class LinFrame:
    kMaxBytes = 8

    def __init__(self):
        self.bytes = bytearray()

    def append_byte(self, b):
        self.bytes.append(b)

    def get_byte(self, index):
        if 0 <= index < len(self.bytes):
            return self.bytes[index]

    def pop_byte(self):
        return self.bytes.pop()

    def num_bytes(self):
        return len(self.bytes)

    def reset(self):
        self.bytes.clear()

    def is_valid(self):
        return len(self.bytes) >= 6


class LINThread(threading.Thread):
    def __init__(self):
        super(LINThread, self).__init__()
        self.config = Config()
        self.lin_frame = LinFrame()
        self.lin_serial = None

        # input device initialization
        self.input_device = uinput.Device([
            uinput.REL_X,        # Relative X axis (horizontal movement)
            uinput.REL_Y,        # Relative Y axis (vertical movement)
            uinput.BTN_LEFT,     # Mouse left click
            uinput.KEY_BACKSPACE,
            uinput.KEY_N,
            uinput.KEY_V,
            uinput.KEY_H,
            uinput.KEY_SPACE,
            uinput.KEY_UP,
            uinput.KEY_DOWN,
            uinput.KEY_LEFT,
            uinput.KEY_RIGHT
        ])

        self._stop_event = threading.Event()
        self.daemon = True
        lin_settings = self.config.lin_settings

        # Button and joystick mappings
        self.button_mappings = self._parse_command_mappings(
            lin_settings["commands"]["button"]
        )
        self.joystick_mappings = self._parse_command_mappings(
            lin_settings["commands"]["joystick"]
        )

        self.click_timeout = lin_settings.get("click_timeout", 300)
        self.long_press_duration = lin_settings.get("long_press_duration", 2000)

        self.button_handler = ButtonHandler(
            self.input_device,
            self.click_timeout,
            self.long_press_duration
        )

    def _parse_command_mappings(self, commands):
        return {
            bytes.fromhex("".join(cmd.replace("0x", "") for cmd in command)): name
            for name, command in commands.items()
        }

    def run(self):
        try:
            if not shared_state.vLin:
                port = "/dev/ttyAMA0" if shared_state.rpiModel == 5 else "/dev/ttyS0"
                try:
                    self.lin_serial = serial.Serial(port=port, baudrate=9600, timeout=1)
                except Exception as e:
                    print("UART error: ", e)
                
                while not self._stop_event.is_set():
                    try:
                        self._read_from_serial()
                    except serial.SerialException as e:
                        print(f"Serial communication error: {e}")
                    except Exception as e:
                        print(f"Error in LIN _read_from_serial: {e}")
            else:
                self._read_from_file()
        except Exception as e:
            print(f"Unexpected error in LIN thread: {e}")

    def stop_thread(self):
        print("Stopping LIN thread.")
        time.sleep(.5)
        self._stop_event.set()
        del self.input_device # Remove uinput device

    def _read_from_serial(self):
        try:
            while not self._stop_event.is_set():
                self._process_incoming_byte(self.lin_serial.read(1))
                # self._timeout_button() # not needed anymore? TODO: test in car
        except KeyboardInterrupt:
            print("Live data collection terminated.")
        except serial.SerialException as e:
            print(f"Serial communication error: {e}")
        except Exception as e:
            print(f"Unexpected error: {e}")

    def _read_from_file(self):
        print("Replaying LIN bus data from file...")
        try:
            with open(Path(__file__).parent / "dev/lin_test.txt", "r") as file:
                for line in file:
                    if self._stop_event.is_set():
                        break
                    frame_data = [int(byte, 16) for byte in line.strip().split()]
                    for byte in frame_data:
                        self._process_incoming_byte(byte.to_bytes(1, 'big'))
                    time.sleep(0.1)
        except KeyboardInterrupt:
            print("Replay terminated.")

    def _process_incoming_byte(self, byte):
        try:
            n = self.lin_frame.num_bytes()
            sync_id = bytes.fromhex(self.config.lin_settings["sync_id"][2:])

            if byte == sync_id and n > 2 and self.lin_frame.get_byte(n - 1) == 0x00:
                self.lin_frame.pop_byte()
                self._handle_frame()
                self.lin_frame.reset()
            elif n == self.lin_frame.kMaxBytes:
                self.lin_frame.reset()
            else:
                if byte:
                    self.lin_frame.append_byte(byte[0] if isinstance(byte, bytes) else byte)
                elif shared_state.verbose:
                    print("Empty byte, not adding to lin frame")
        except IndexError as e:
            print(f"IndexError: {e} while processing incoming bytes.")

    def _handle_frame(self):
        """Process a complete LIN frame."""
        swm_id = bytes.fromhex(self.config.lin_settings["swm_id"][2:])
                
        if self.lin_frame.get_byte(0) != swm_id[0]:
            print(f"Frame rejected - First byte = {self.lin_frame.get_byte(0)}, Expected = {swm_id[0]}")
            return

        zero_code = bytes.fromhex(self.config.lin_settings["zero_code"][2:])
        if self.lin_frame.get_byte(5) == zero_code[0]:
            return

        if not self.lin_frame.is_valid():
            return

        frame_data = b"".join(self.lin_frame.get_byte(i).to_bytes(1, 'big') for i in range(5))
        button_name = self.button_mappings.get(frame_data) or self.joystick_mappings.get(frame_data) 
        
        print(button_name)
        self.button_handler.handle(button_name)
