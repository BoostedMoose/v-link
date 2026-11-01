import threading
import time
import os
import can
import serial
import uinput

from pathlib import Path
from enum import Enum, auto
from abc import ABC, abstractmethod

from .. import settings
from ..shared.shared_state import shared_state

import logging
logger = logging.getLogger('vlink')


def current_time_ms():
    # Get current time in milliseconds
    return int(time.time() * 1000)


def time_elapsed(start_time):
    # Calculate elapsed time from start_time in milliseconds
    return current_time_ms() - start_time


class InterfaceType(Enum):
    CAN = 'can'
    LIN = 'lin'


class ButtonState(Enum):
    IDLE = auto()
    PRESSED = auto()
    LONG_PRESSED = auto()


class LinFrame:
    # Helper class for LIN frame processing
    MAX_BYTES = 8

    def __init__(self):
        self.bytes = bytearray()

    def append_byte(self, b):
        self.bytes.append(b)

    def get_byte(self, index):
        return self.bytes[index] if 0 <= index < len(self.bytes) else None

    def pop_byte(self):
        return self.bytes.pop() if self.bytes else None

    def num_bytes(self):
        return len(self.bytes)

    def reset(self):
        self.bytes.clear()

    def is_valid(self):
        return len(self.bytes) >= 6


class ButtonHandler:
    # Handles button presses, long presses, and joystick movements
    
    def __init__(self, click_timeout, long_press_duration, mouse_speed):
        self.click_timeout = click_timeout
        self.long_press_duration = long_press_duration
        self.mouse_speed = mouse_speed
        self.mouse_mode = False

        self.button_state = ButtonState.IDLE
        self.current_button = None
        self.button_down_at = 0
        self.last_button_at = 0
        self.long_press_executed = False
        self.last_joystick_at = 0

        # Hardcoded keymap
        self.button_actions = {
            'BTN_ENTER': lambda: self._mouse_click() if self.mouse_mode else self._key_press(uinput.KEY_SPACE),
            'BTN_BACK': lambda: self._key_press(uinput.KEY_BACKSPACE),
            'BTN_NEXT': lambda: self._key_press(uinput.KEY_N),
            'BTN_PREV': lambda: self._key_press(uinput.KEY_V),
            'BTN_YES': lambda: self._key_press(uinput.KEY_A),
            'BTN_NO': lambda: self._key_press(uinput.KEY_R),
            'BTN_VOL_UP': lambda: self._key_press(uinput.KEY_U),
            'BTN_VOL_DOWN': lambda: self._key_press(uinput.KEY_D)
        }

        self.joystick_actions = {
            'BTN_UP': (-1, uinput.KEY_UP, (0, -1)),
            'BTN_DOWN': (-1, uinput.KEY_DOWN, (0, 1)),
            'BTN_LEFT': (-1, uinput.KEY_LEFT, (-1, 0)),
            'BTN_RIGHT': (-1, uinput.KEY_RIGHT, (1, 0))
        }

        self.long_press_actions = {
            'BTN_ENTER': self._toggle_rti_status,
            'BTN_PREV': self._toggle_mouse_mode
        }

        # Initialize uinput device
        self.input_device = uinput.Device([

            uinput.KEY_BACKSPACE,
            uinput.KEY_SPACE,

            uinput.KEY_UP,
            uinput.KEY_DOWN,
            uinput.KEY_LEFT,
            uinput.KEY_RIGHT,

            uinput.KEY_A,
            uinput.KEY_N,
            uinput.KEY_R,
            uinput.KEY_V,
            uinput.KEY_U,
            uinput.KEY_D,

            uinput.BTN_LEFT,
            uinput.REL_X,
            uinput.REL_Y
        ])

    # Main entry point for handling a key press
    def handle(self, button_name):
    
        if not button_name:
            if self.button_state != ButtonState.IDLE:
                self.timeout_button()
            return

        if button_name in self.joystick_actions:
            self._handle_joystick(button_name)
        else:
            self._handle_button(button_name)

    # Main entry point for handling a key press
    def _handle_button(self, button_name):
        # Handle button press logic
        now = current_time_ms()

        if button_name != self.current_button:
            if self.current_button:
                self._release_button()
                
            logger.debug(f'Button pressed: {button_name}')
            action = self.button_actions.get(button_name)
            if action:
                action()

            self.current_button = button_name
            self.button_state = ButtonState.PRESSED
            self.button_down_at = now

        self.last_button_at = now

        # Check for long press
        if (self.button_state == ButtonState.PRESSED and 
            time_elapsed(self.button_down_at) > self.long_press_duration and
            not self.long_press_executed):
            self.button_state = ButtonState.LONG_PRESSED
            self._long_press_action(button_name)
            self.long_press_executed = True

    # Execute long press action
    def _long_press_action(self, button_name):
        logger.debug(f'Long press: {button_name}')
        action = self.long_press_actions.get(button_name)
        if action:
            action()

    # Reset button state
    def _release_button(self):
        if self.long_press_executed:
            self.long_press_executed = False
        self.button_state = ButtonState.IDLE
        self.current_button = None

    # Auto release button on timeout
    def timeout_button(self):
        if self.current_button and time_elapsed(self.last_button_at) > self.click_timeout:
            self._release_button()

    # Handle joystick movement
    def _handle_joystick(self, joystick_name):
        now = current_time_ms()
        
        if self.mouse_mode:
            _, _, (dx, dy) = self.joystick_actions[joystick_name]
            self._move_mouse(dx, dy)
            return
        
        # Keyboard mode with timeout
        if now - self.last_joystick_at < self.click_timeout:
            return
            
        _, key, _ = self.joystick_actions[joystick_name]
        self._key_press(key)
        self.last_joystick_at = now

    # Execute key press
    def _key_press(self, key):
        self.input_device.emit_click(key, 1)

    # Execute mouse click
    def _mouse_click(self):
        self.input_device.emit(uinput.BTN_LEFT, 1)
        self.input_device.emit(uinput.BTN_LEFT, 0)

    # Move mouse cursor
    def _move_mouse(self, dx, dy):
        scaled_dx = int(dx * self.mouse_speed)
        scaled_dy = int(dy * self.mouse_speed)
        self.input_device.emit(uinput.REL_X, scaled_dx)
        self.input_device.emit(uinput.REL_Y, scaled_dy)

    # Toggle RTI status
    def _toggle_rti_status(self):
        shared_state.rtiStatus = not shared_state.rtiStatus
        shared_state.hdmiStatus = shared_state.rtiStatus
        shared_state.hdmi_event.set()
        logger.debug(f'[SWC] RTI status: {shared_state.rtiStatus}')

    # Toggle mouse mode
    def _toggle_mouse_mode(self):
        self.mouse_mode = not self.mouse_mode
        logger.debug(f'[SWC] Mouse mode: {self.mouse_mode}')


#############################################################
# SWC Interface - Abstract base class for SWC interfaces    #
#############################################################

class SWCInterface(ABC):
    
    def __init__(self, config, button_handler, logger):
        self.config = config
        self.button_handler = button_handler
        self._stop_event = threading.Event()
        self._parse_mappings()
    
    # Parse button/joystick mappings - implemented by subclasses
    def _parse_mappings(self):
        # Parse button/joystick mappings - implemented by subclasses
        pass
    
    @abstractmethod
    def start(self):
        pass
    
    @abstractmethod
    def stop(self):
        pass

    # Common message handling logic
    def _handle_message(self, message_data, expected_patterns):
        self.button_handler.timeout_button()
        
        for pattern, button_name in expected_patterns.items():
            if self._message_matches_pattern(message_data, pattern):
                logger.debug(f'[SWC] Button pressed: {button_name}')
                self.button_handler.handle(button_name)
                return True
        return False

    # Check if message matches expected pattern - implemented by subclasses
    def _message_matches_pattern(self, message_data, pattern):
        pass

#############################################################
# CAN Interface - CAN based steering wheel controls         #
#############################################################

class CAN(SWCInterface):

    def __init__(self, config, button_handler, logger):
        super().__init__(config, button_handler, logger)
        self.can_bus = None
        self.notifier = None
        
    # Parse CAN control mappings
    def _parse_mappings(self):
        interface_config = self.config['interface']
        self.rep_id = int(interface_config['rep_id'], 16)
        self.zero_message = [int(byte, 16) for byte in interface_config['zero_message']]
        self.control_byte_count = interface_config['control_byte_count']
        
        self.control_lookup = {}
        for button_name, values in {**self.config['button'], **self.config['joystick']}.items():
            if values:
                for value_list in self._parse_can_values(values):
                    self.control_lookup[value_list] = button_name
    
    # Parse CAN values
    def _parse_can_values(self, value):
        if isinstance(value[0], list):
            return [tuple(int(byte, 16) for byte in pair) for pair in value]
        return [tuple(int(byte, 16) for byte in value)]
    
    # Check CAN message pattern
    def _message_matches_pattern(self, message_data, pattern):
        control_bytes = tuple(message_data[-self.control_byte_count:])
        return pattern == control_bytes
    
    # Initialize CAN interface
    def start(self):
        try:
            channel = 'vcan0' if shared_state.vCan else self.config['interface']['name']
            bustype = self.config['interface']['bustype']
            bitrate = self.config['interface']['bitrate']
            is_extended = self.config['interface']['is_extended']
            
            self.can_bus = can.interface.Bus(channel=channel, bustype=bustype, bitrate=bitrate)
            
            # Set filter
            filters = [{'can_id': self.rep_id, 'can_mask': 0x1FFFFFFF, 'extended': is_extended}]
            self.can_bus.set_filters(filters)
            
            # Create a custom listener class
            class MessageListener(can.Listener):
                def __init__(self, callback):
                    self.callback = callback
                
                def on_message_received(self, msg):
                    self.callback(msg)
            
            # Create listener with callback
            listener = MessageListener(self._handle_can_message)
            self.notifier = can.Notifier(self.can_bus, [listener])
            
            logger.info(f'[SWC] CAN initialized on "{channel}"')
            
        except Exception as e:
            logger.error(f'[SWC] CAN init failed: {e}')
            raise
    
    def stop(self):
        # Stop CAN interface
        self._stop_event.set()
        if self.notifier:
            self.notifier.stop()
        if self.can_bus:
            self.can_bus.shutdown()
    
    def _handle_can_message(self, msg):
        # Handle CAN message
        try:
            if msg.arbitration_id != self.rep_id:
                return
                
            message_data = list(msg.data)
            
            # Check zero message
            if message_data[-len(self.zero_message):] == self.zero_message:
                return
            
            if not self._handle_message(message_data, self.control_lookup):
                message_hex = ' '.join(f'{byte:02X}' for byte in message_data)
                logger.debug(f'[SWC] Unknown CAN SWC: {message_hex}')
                
        except Exception as e:
            logger.error(f'[SWC] CAN message error: {e}')


#############################################################
# LIN Interface - LIN based steering wheel controls         #
#############################################################

class LIN(SWCInterface):
    
    def __init__(self, config, button_handler, logger):
        super().__init__(config, button_handler, logger)
        self.lin_serial = None
        self.lin_frame = LinFrame()
        self.processing_thread = None
        
    # Parse LIN control mappings
    def _parse_mappings(self):
        interface_config = self.config['interface']
        self.swm_id = bytes.fromhex(interface_config['swm_id'][2:])[0]
        self.sync_id = bytes.fromhex(interface_config['sync_id'][2:])
        self.zero_code = bytes.fromhex(interface_config['zero_code'][2:])[0]
        
        self.control_lookup = {}
        for mapping_type in ['button', 'joystick']:
            for name, command in self.config[mapping_type].items():
                if command:
                    hex_string = ''.join(cmd.replace('0x', '') for cmd in command)
                    self.control_lookup[bytes.fromhex(hex_string)] = name
    
    # Check LIN message pattern
    def _message_matches_pattern(self, message_data, pattern):
        return message_data == pattern
    
    # Initialize LIN interface
    def start(self):
        try:
            if not shared_state.vLin:
                port = '/dev/ttyAMA0' if shared_state.rpiModel == 5 else '/dev/ttyS0'
                self.lin_serial = serial.Serial(port=port, baudrate=9600, timeout=1)
                logger.info(f'[SWC] LIN SWC initialized on {port}')
            else:
                logger.info('[SWC] Emulated LIN mode enabled')
            
            self.processing_thread = threading.Thread(target=self._process_data, daemon=True)
            self.processing_thread.start()
            
        except Exception as e:
            logger.error(f'[SWC] LIN SWC init failed: {e}')
            raise
    
    # Stop LIN interface
    def stop(self):
        self._stop_event.set()
        if self.lin_serial and self.lin_serial.is_open:
            self.lin_serial.close()
        if self.processing_thread:
            self.processing_thread.join(timeout=2)
    
    # Process LIN data
    def _process_data(self):
        try:
            if shared_state.vLin:
                self._read_from_file()
            else:
                self._read_from_serial()
        except Exception as e:
            logger.error(f'[SWC] LIN processing error: {e}')
    
    # Read from serial port
    def _read_from_serial(self):
        while not self._stop_event.is_set():
            if self.lin_serial and self.lin_serial.is_open and self.lin_serial.in_waiting > 0:
                self._process_byte(self.lin_serial.read(1))
                self.button_handler.timeout_button()
            else:
                time.sleep(0.1)
    
    # Read from test file
    def _read_from_file(self):
        time.sleep(10)  # Wait for app start
        try:
            with open(Path(__file__).parent.parent / 'dev/lin_test.txt', 'r') as file:
                for line in file:
                    if self._stop_event.is_set():
                        break
                    frame_data = [int(byte, 16) for byte in line.strip().split()]
                    for byte in frame_data:
                        self._process_byte(byte.to_bytes(1, 'big'))
                    time.sleep(0.1)
        except Exception as e:
            logger.error(f'[SWC] LIN file error: {e}')
    
    # Process incoming byte
    def _process_byte(self, byte):
        if not byte:
            return
            
        n = self.lin_frame.num_bytes()
        
        if byte == self.sync_id and n > 2 and self.lin_frame.get_byte(n - 1) == 0x00:
            self.lin_frame.pop_byte()
            self._handle_frame()
            self.lin_frame.reset()
        elif n == self.lin_frame.MAX_BYTES:
            self.lin_frame.reset()
        else:
            byte_val = byte[0] if isinstance(byte, bytes) else byte
            self.lin_frame.append_byte(byte_val)
    
    # Handle complete LIN frame
    def _handle_frame(self):
        try:
            if (self.lin_frame.get_byte(0) != self.swm_id or 
                self.lin_frame.get_byte(5) == self.zero_code or 
                not self.lin_frame.is_valid()):
                return
            
            frame_data = b''.join(self.lin_frame.get_byte(i).to_bytes(1, 'big') for i in range(5))
            
            if not self._handle_message(frame_data, self.control_lookup):
                frame_hex = ' '.join(f'{b:02X}' for b in frame_data)
                logger.debug(f'[SWC] Unknown LIN frame: {frame_hex}')
                
        except Exception as e:
            logger.error(f'[SWC] LIN frame error: {e}')


#############################################################
# SWC Thread - Main SWC thread                              #
#############################################################

class SWCThread(threading.Thread):
    
    def __init__(self, logger):
        super().__init__(daemon=True)
        self._stop_event = threading.Event()
        self.interface = None
        
        self._initialize()
    
    def _initialize(self):
        # Initialize SWC components
        try:
            config = settings.load_settings('swc')
            controls_config = config.get('controls', {})
            
            if not controls_config.get('enabled', False):
                logger.info('[SWC] Controls disabled')
                return
            
            # Initialize button handler
            button_config = controls_config['config']
            button_handler = ButtonHandler(
                button_config['click_timeout'],
                button_config['long_press_duration'],
                button_config['mouse_speed']
            )
            
            # Create appropriate interface
            interface_name = controls_config['interface']['name']
            
            if interface_name.startswith('can'):
                self.interface = CAN(controls_config, button_handler, logger)
            elif interface_name.startswith('lin'):
                self.interface = LIN(controls_config, button_handler, logger)
            else:
                raise ValueError(f'[SWC] Unknown interface: {interface_name}')
            
            logger.info(f'[SWC] Initialized with "{interface_name}" interface')
            
        except Exception as e:
            logger.error(f'[SWC] Initialization failed: {e}')
            raise
    
    def run(self):
        # Main thread execution 
        if not self.interface:
            return
            
        try:
            self.interface.start()
            
            while not self._stop_event.is_set():
                time.sleep(1)
                
        except Exception as e:
            logger.error(f'[SWC] Runtime error: {e}')
        finally:
            if self.interface:
                self.interface.stop()
    
    def stop_thread(self):
        self._stop_event.set()
        
        if self.interface:
            self.interface.stop()
        
        self.join(timeout=5)