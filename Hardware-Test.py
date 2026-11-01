#!/usr/bin/env python3

"""
V-LINK Hardware Test
A comprehensive tool for testing hardware interfaces including CAN bus, LIN bus,
RTI communication, ADC readings, fan speed, and ignition status.
"""

import os
import sys
import signal
import time
import threading
import subprocess
from typing import Dict, List, Any, Optional

# Hardware communication libraries
import serial
import can
import lgpio
import busio
import board
import adafruit_ads1x15.ads1115 as ADS
from adafruit_ads1x15.analog_in import AnalogIn


class VirtualEnvSetup:
    """Handles virtual environment setup and activation."""
    
    @staticmethod
    def ensure_virtualenv():
        """Ensure script runs in a virtual environment."""
        venv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "venv")
        python_bin = os.path.join(venv_path, "bin", "python3")

        if not os.path.exists(python_bin):
            print("Virtual environment not found. Creating one...")
            subprocess.run(["python3", "-m", "venv", venv_path], check=True)
            print("Virtual environment created. Please install dependencies inside 'venv' if needed.")

        if sys.executable != python_bin:
            print("Restarting script inside virtual environment...")
            os.execv(python_bin, [python_bin] + sys.argv)


class HardwareStatus:
    """Manages hardware status information."""
    
    def __init__(self):
        """Initialize status dictionary with default values."""
        self.status: Dict[str, List[str]] = {
            "CAN": ["No device found"] * 2,
            "LIN": ["No data received"],
            "RTI": ["Not initialized"],
            "ADC": ["No device found"] * 4,
            "FAN": ["No signal"],
            "IGN": ["Not checked"]
        }
        self.running = True
        
    def update(self, component: str, index: int, value: str) -> None:
        """Update status for a specific component and index."""
        if component in self.status and index < len(self.status[component]):
            self.status[component][index] = value
            
    def get(self, component: str, index: int) -> str:
        """Get status for a specific component and index."""
        if component in self.status and index < len(self.status[component]):
            return self.status[component][index]
        return "Unknown"

    def stop(self) -> None:
        """Signal all threads to stop."""
        self.running = False


class Dashboard:
    """Handles the display of hardware status information."""
    
    def __init__(self, status_manager: HardwareStatus):
        """Initialize dashboard with status manager."""
        self.status_manager = status_manager
        
    @staticmethod
    def clear_terminal() -> None:
        """Clear the terminal screen."""
        os.system('clear' if os.name == 'posix' else 'cls')
        
    def display(self) -> None:
        """Display current hardware status in terminal."""
        while self.status_manager.running:
            self.clear_terminal()
            print("[ V-LINK Hardware Test v1.0 ]\n")
            
            print("CANBus:")
            for i, msg in enumerate(self.status_manager.status["CAN"]):
                print(f"    CAN{i+1}: {msg}")
                
            print("LINBus:")
            print(f"    Frame: {self.status_manager.status['LIN'][0]}")
            
            print("RTI:")
            print(f"    Status: {self.status_manager.status['RTI'][0]}")
            
            print("ADC:")
            for i, val in enumerate(self.status_manager.status["ADC"]):
                print(f"    A{i}: {val}")
                
            print("FAN:")
            print(f"    RPM: {self.status_manager.status['FAN'][0]}")
            
            print("IGNITION:")
            print(f"    State: {self.status_manager.status['IGN'][0]}")
            
            time.sleep(0.5)  # Refresh rate


class CANBusHandler:
    """Handles CAN bus communication and testing."""
    
    def __init__(self, status_manager: HardwareStatus):
        """Initialize with status manager."""
        self.status_manager = status_manager
        
    def setup_interfaces(self) -> None:
        """Set up CAN interfaces with appropriate bitrate."""
        try:
            # Cleaning up can interfaces
            subprocess.run(["sudo", "ip", "link", "set", "can2", "down"], check=True)
            subprocess.run(["sudo", "ip", "link", "set", "can1", "down"], check=True)
            
            # Setting up can2 interface
            subprocess.run(["sudo", "ip", "link", "set", "can2", "type", "can", "bitrate", "125000"], 
                          check=True)
            subprocess.run(["sudo", "ip", "link", "set", "up", "can2"], check=True)
            
            # Setting up can1 interface
            subprocess.run(["sudo", "ip", "link", "set", "can1", "type", "can", "bitrate", "125000"], 
                          check=True)
            subprocess.run(["sudo", "ip", "link", "set", "up", "can1"], check=True)
            
            print("CAN interfaces set up successfully.")
        except subprocess.CalledProcessError as e:
            print(f"Error setting up CAN interfaces: {e}")
            
    def check_connection(self) -> None:
        """Check connection between CAN interfaces by sending test messages."""
        while self.status_manager.running:
            try:
                # Initialize both CAN buses
                can2 = can.interface.Bus(channel='can2', bustype='socketcan', bitrate=125000)
                can1 = can.interface.Bus(channel='can1', bustype='socketcan', bitrate=125000)
                
                # Test can2 -> can1 communication
                msg0 = can.Message(arbitration_id=0x123, data=[1, 2, 3, 4, 5])
                can2.send(msg0)
                rcv1 = can1.recv(timeout=1)
                if rcv1 and list(rcv1.data) == list(msg0.data):
                    self.status_manager.update("CAN", 0, "Connected and working")
                else:
                    self.status_manager.update("CAN", 0, "No data received")
                
                # Test can1 -> can2 communication
                msg1 = can.Message(arbitration_id=0x456, data=[6, 7, 8, 9, 10])
                can1.send(msg1)
                rcv0 = can2.recv(timeout=1)
                if rcv0 and list(rcv0.data) == list(msg1.data):
                    self.status_manager.update("CAN", 1, "Connected and working")
                else:
                    self.status_manager.update("CAN", 1, "No data received")
                
            except Exception as e:
                self.status_manager.update("CAN", 0, f"Error: {str(e)[:30]}")
                self.status_manager.update("CAN", 1, f"Error: {str(e)[:30]}")
            finally:
                try:
                    can2.shutdown()
                    can1.shutdown()
                except:
                    pass
                    
            # Check connection every 5 seconds
            time.sleep(5)


class LINBusHandler:
    """Handles LIN bus communication."""
    
    def __init__(self, status_manager: HardwareStatus):
        """Initialize with status manager."""
        self.status_manager = status_manager
        self.device = '/dev/ttyAMA0'
        self.baudrate = 9600
        
    def monitor(self) -> None:
        """Continuously monitor LIN bus for incoming messages."""
        while self.status_manager.running:
            try:
                with serial.Serial(self.device, self.baudrate, timeout=1) as ser:
                    data = ser.read(ser.in_waiting or 1)
                    if data:
                        hex_data = data.hex()
                        status_msg = f"{hex_data}"
                        if 0x14 in data:
                            status_msg += " (ID 0x14 detected)"
                        self.status_manager.update("LIN", 0, status_msg)
                    else:
                        self.status_manager.update("LIN", 0, "No data received")
            except Exception as e:
                self.status_manager.update("LIN", 0, f"Error: {str(e)[:30]}")
            
            time.sleep(0.1)


class RTIHandler:
    """Handles RTI communication."""
    
    def __init__(self, status_manager: HardwareStatus):
        """Initialize with status manager."""
        self.status_manager = status_manager
        self.device = '/dev/ttyAMA2'
        self.baudrate = 2400
        
    def send_messages(self) -> None:
        """Continuously send RTI messages."""
        while self.status_manager.running:
            try:
                with serial.Serial(self.device, self.baudrate, timeout=1) as ser:
                    for byte in [0x40, 0x20, 0x83]:
                        ser.write(byte.to_bytes(1, 'big'))
                        time.sleep(0.05)
                    self.status_manager.update("RTI", 0, "Messages sent successfully")
            except Exception as e:
                self.status_manager.update("RTI", 0, f"Error: {str(e)[:30]}")
            
            time.sleep(0.1)


class ADCHandler:
    """Handles ADC readings."""
    
    def __init__(self, status_manager: HardwareStatus):
        """Initialize with status manager."""
        self.status_manager = status_manager
        
    def read_values(self) -> None:
        """Read and update ADC values."""
        while self.status_manager.running:
            try:
                i2c = busio.I2C(board.SCL, board.SDA)
                ads = ADS.ADS1115(i2c)
                channels = [AnalogIn(ads, pin) for pin in [ADS.P0, ADS.P1, ADS.P2, ADS.P3]]
                
                for i, ch in enumerate(channels):
                    self.status_manager.update("ADC", i, f"{ch.voltage:.3f} V")
            except Exception as e:
                for i in range(4):
                    self.status_manager.update("ADC", i, f"Error: {str(e)[:30]}")
            
            time.sleep(1)


class FanHandler:
    """Handles fan RPM measurement."""
    
    def __init__(self, status_manager: HardwareStatus):
        """Initialize with status manager."""
        self.status_manager = status_manager
        self.chip = 0  # Default chip (onboard GPIO)
        self.pin = 12  # Pin 12
        
    def measure_rpm(self) -> None:
        """Measure and update fan RPM."""
        try:
            # Open the GPIO chip
            chip = lgpio.gpiochip_open(self.chip)
            # Set GPIO pin to input mode
            lgpio.gpio_claim_input(chip, self.pin)
            
            # Initialize variables for counting pulses
            pulse_count = 0
            start_time = time.time()
            pulse_detected = False
            
            while self.status_manager.running:
                # Read current state of the pin
                state = lgpio.gpio_read(chip, self.pin)
                
                if state == 1:
                    pulse_count += 1
                    pulse_detected = True
                    # Wait for pin to go low again to avoid counting same pulse multiple times
                    waiting_start = time.time()
                    while lgpio.gpio_read(chip, self.pin) == 1:
                        if time.time() - waiting_start > 0.1:  # Timeout after 100ms
                            break
                        time.sleep(0.001)
                
                # After 1 second, calculate RPM
                elapsed_time = time.time() - start_time
                if elapsed_time >= 1:
                    if pulse_detected:
                        rpm = (pulse_count * 60) / 2  # RPM calculation (2 pulses per rotation)
                        self.status_manager.update("FAN", 0, f"{rpm:.0f} RPM")
                    else:
                        self.status_manager.update("FAN", 0, "No signal")
                    
                    # Reset for next second
                    pulse_count = 0
                    start_time = time.time()
                    pulse_detected = False
                
                time.sleep(0.01)
        except Exception as e:
            self.status_manager.update("FAN", 0, f"Error: {str(e)[:30]}")
        finally:
            try:
                # Clean up GPIO resources
                lgpio.gpio_free(chip, self.pin)
                lgpio.gpiochip_close(chip)
            except:
                pass


class IgnitionHandler:
    """Handles ignition state checking."""
    
    def __init__(self, status_manager: HardwareStatus):
        """Initialize with status manager."""
        self.status_manager = status_manager
        self.chip = 0
        self.pin = 1
        
    def check_state(self) -> None:
        """Check and update ignition state."""
        while self.status_manager.running:
            try:
                h = lgpio.gpiochip_open(self.chip)
                lgpio.gpio_claim_input(h, self.pin)
                state = lgpio.gpio_read(h, self.pin)
                self.status_manager.update("IGN", 0, "HIGH" if state else "LOW")
                lgpio.gpio_free(h, self.pin)
                lgpio.gpiochip_close(h)
            except Exception as e:
                self.status_manager.update("IGN", 0, f"Error: {str(e)[:30]}")
            
            time.sleep(0.5)


class HardwareTestDashboard:
    """Main application class that orchestrates all hardware tests."""
    
    def __init__(self):
        """Initialize dashboard application."""
        self.status_manager = HardwareStatus()
        self.dashboard = Dashboard(self.status_manager)
        
        # Initialize hardware handlers
        self.can_handler = CANBusHandler(self.status_manager)
        self.lin_handler = LINBusHandler(self.status_manager)
        self.rti_handler = RTIHandler(self.status_manager)
        self.adc_handler = ADCHandler(self.status_manager)
        self.fan_handler = FanHandler(self.status_manager)
        self.ign_handler = IgnitionHandler(self.status_manager)
        
        # Set up signal handler for graceful exit
        signal.signal(signal.SIGINT, self.signal_handler)
        
    def signal_handler(self, sig, frame):
        """Handle keyboard interrupt to cleanly exit the application."""
        print("\nExiting...")
        self.status_manager.stop()
        time.sleep(1)  # Allow threads to clean up
        sys.exit(0)
        
    def run(self):
        """Run the dashboard application."""
        print("Starting V-LINK Hardware Test Dashboard...")
        
        # Set up CAN interfaces
        self.can_handler.setup_interfaces()
        
        # Create and start all monitoring threads
        threads = [
            threading.Thread(target=self.dashboard.display, name="Dashboard"),
            threading.Thread(target=self.can_handler.check_connection, name="CAN"),
            threading.Thread(target=self.lin_handler.monitor, name="LIN"),
            threading.Thread(target=self.rti_handler.send_messages, name="RTI"),
            threading.Thread(target=self.adc_handler.read_values, name="ADC"),
            threading.Thread(target=self.fan_handler.measure_rpm, name="FAN"),
            threading.Thread(target=self.ign_handler.check_state, name="IGN")
        ]
        
        # Start all threads
        for thread in threads:
            thread.daemon = True  # Make threads exit when main program exits
            thread.start()
            print(f"Started {thread.name} thread")
        
        # Keep main thread running
        try:
            while self.status_manager.running:
                time.sleep(0.1)
        except KeyboardInterrupt:
            self.signal_handler(None, None)


if __name__ == "__main__":
    # Ensure virtual environment is set up
    VirtualEnvSetup.ensure_virtualenv()
    
    # Start the dashboard
    dashboard = HardwareTestDashboard()
    dashboard.run()