import threading
import time
import bisect
import socketio
from .. import settings
from ..shared.shared_state import shared_state

import board
import busio
import adafruit_ads1x15.ads1115 as ADS
from adafruit_ads1x15.analog_in import AnalogIn

PULL_UP = 2000
STEP = 0.5


class ADCThread(threading.Thread):
    def __init__(self, logger):
        super().__init__()
        self.logger = logger

        self.client = socketio.Client()
        self._stop_event = threading.Event()

        self.ads = None
        self.i2c = None

        self.channels = []
        self.failed_sensors = set()

        self.sensor_data = None
        self.pressure_data = None
        self.temperature_data = None

    def run(self):
        self.init_adc()

        if self.ads and self.read_settings():
            self.start_adc()

    def stop_thread(self):
        time.sleep(.5)
        self._stop_event.set()

    def init_adc(self):
        try:
            self.i2c = busio.I2C(board.SCL, board.SDA)
            self.ads = ADS.ADS1115(self.i2c)
            self.ads.gain = 1
        except Exception as e:
            self.logger.error(f'[ADC] I2C initialization failed: {e}')
            self.ads = None


    def start_adc(self):
        while not self._stop_event.is_set():
            self.read_sensor()
            time.sleep(.1)


    def read_settings(self):
        self.sensor_data = settings.load_settings('adc')
        if not self.sensor_data:
            return False

        for i, (sensor_name, sensor_details) in enumerate(self.sensor_data['sensors'].items()):
            channel = sensor_details['channel']
            analog_in_instance = AnalogIn(self.ads, getattr(ADS, channel))
            self.channels.append(analog_in_instance)
        return True


    def read_sensor(self):    
        for i, (key, sensor) in enumerate(self.sensor_data['sensors'].items()):
            try:
                voltage = self.channels[i].voltage
                resistance = None

                if sensor['ntc']:
                    resistance = PULL_UP * voltage / (5 - voltage)

                characteristics = sensor['characteristic']
                interpolated_value = self.interpolate_value(voltage, resistance, characteristics)

                converted_value = eval(sensor['scale'], {'value': interpolated_value})

                shared_state.update_car_data(key , float(converted_value))
            except Exception as e:
                # Log once per failure streak, the loop runs at 10 Hz
                if key not in self.failed_sensors:
                    self.logger.error(f'[ADC] Error reading sensor "{key}": {e}')
                    self.failed_sensors.add(key)
                continue

            if key in self.failed_sensors:
                self.logger.info(f'[ADC] Sensor "{key}" readable again.')
                self.failed_sensors.discard(key)

            #with shared_state.car_data_lock:
            #    snapshot = shared_state.car_data.copy() 
            #print(snapshot)

            #self.emit_data_to_frontend(data)

    def interpolate_value(self, voltage, resistance, characteristics):
        # NTC sensors are looked up by resistance, all others by voltage
        x = resistance if resistance is not None else voltage
        points = sorted((float(key), value) for key, value in characteristics.items())
        keys = [key for key, _ in points]

        # Use the two enclosing points; outside the table, extend the outer segment
        i = min(max(bisect.bisect_left(keys, x), 1), len(points) - 1)
        (x1, y1), (x2, y2) = points[i - 1], points[i]
        interpolated_value = y1 + (y2 - y1) * (x - x1) / (x2 - x1)

        if resistance is not None:
            interpolated_value = round(interpolated_value / STEP) * STEP

        return interpolated_value