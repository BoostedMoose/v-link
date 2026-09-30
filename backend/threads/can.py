import threading
import time
import can

from collections import deque

from .. import settings
from ..shared.shared_state import shared_state

class Config:
    def __init__(self, logger):
        self.logger = logger

        self.can_settings = settings.load_settings('can')
        self.interfaces = []
        self.sensors = {}
        self.signal_sensors = {}

        self.load_interfaces()
        self.load_sensors()
        self.load_signal_sensors()

    def load_interfaces(self):
        for iface in self.can_settings['interfaces']:
            if iface['enabled']:
                self.interfaces.append({
                    'channel': iface['channel'],
                    'bustype': iface['bustype'],
                    'is_extended': iface['is_extended'],
                    'bitrate': iface['bitrate'],
                    'wait_for_ecu': iface['wait_for_ecu']
                })

    def load_sensors(self):
        # Make sure can_data exists
        if not hasattr(shared_state, 'can_data'):
            shared_state.can_data = {}

        for key, sensor in self.can_settings['sensors'].items():
            try:
                iface = sensor['interface']

                if not sensor['enabled']:
                    continue

                if iface not in self.sensors:
                    self.sensors[iface] = []

                scale = sensor['scale']
                req_id = int(sensor['req_id'], 16)
                rep_id = int(sensor['rep_id'], 16)
                target = int(sensor['target'], 16)
                action = int(sensor['action'], 16)
                params: list[int] = [int(p, 16) for p in sensor.get('parameter', [])][:2]

                request_count = 0x01
                payload: list[int] = [target, action, *params, request_count]
                message_bytes: list[int] = [0x00, *payload]

                # calculate dlc
                message_bytes[0] = 0xC8 + (len(message_bytes) - 1)

                # Pad with zeroes
                while len(message_bytes) < 8:
                    message_bytes.append(0x00)

                if not isinstance(scale, str) or 'value' not in scale:
                    raise ValueError(f'Invalid scale format for sensor "{key}"')
                
                sensor_entry = {
                    'key': key,
                    'label': sensor['label'],
                    'channel': sensor['interface'],
                    'type': sensor['type'],
                    'req_id': [req_id],
                    'rep_id': [rep_id],
                    'message_bytes': message_bytes,
                    'scale': scale,
                    'is_16bit': sensor['is_16bit'],
                    'app_id': sensor['app_id'],
                    'priority': sensor['priority'],
                }

                self.sensors[iface].append(sensor_entry)

            except Exception as e:
                self.logger.error(f'[CAN] Error loading sensor "{key}" on "{iface}": {e}')

    def load_signal_sensors(self):
        for sensor in self.can_settings.get('signal_sensors', []):
            try:
                iface = sensor['interface']

                if not sensor.get('enabled', False):
                    continue

                if iface not in self.signal_sensors:
                    self.signal_sensors[iface] = []

                key = sensor['key']
                can_id = int(sensor['can_id'], 16)
                byte_index = int(sensor['byte_index'])
                mask = sensor.get('mask')
                if mask is not None:
                    mask = int(mask, 0) if isinstance(mask, str) else int(mask)
                    shift = int(sensor.get('shift', 0))
                    if not 0 < mask <= 0xFF:
                        raise ValueError(f'Invalid mask for signal sensor "{key}"')
                    if shift < 0 or shift > 7:
                        raise ValueError(f'Invalid shift for signal sensor "{key}"')
                    bit_index = None
                else:
                    bit_index = int(sensor['bit_index'])
                    shift = None
                invert = bool(sensor.get('invert', False))
                scale = sensor.get('scale')

                if scale is not None and (not isinstance(scale, str) or 'value' not in scale):
                    raise ValueError(f'Invalid scale format for signal sensor "{key}"')

                sensor_entry = {
                    'key': key,
                    'label': sensor.get('label', key),
                    'channel': iface,
                    'can_id': can_id,
                    'byte_index': byte_index,
                    'bit_index': bit_index,
                    'mask': mask,
                    'shift': shift,
                    'invert': invert,
                    'scale': scale,
                }

                self.signal_sensors[iface].append(sensor_entry)

            except Exception as e:
                key = sensor.get('key', 'unknown')
                self.logger.error(f'[CAN] Error loading signal sensor "{key}": {e}')


class CANThread(threading.Thread):
    def __init__(self, logger):
        super(CANThread, self).__init__()
        self.logger = logger

        self._stop_event = threading.Event()
        self.daemon = True

        self.config = Config(logger)

        self.can_buses = {}
        self.notifiers = {}
        self.broadcast_tasks = []

        
    def run(self):
        self.initialize_can()
        
        try:
            while not self._stop_event.is_set():
                time.sleep(1)
        except KeyboardInterrupt:
            pass

    def initialize_can(self):
        interfaces_to_process = []

        if shared_state.vCan:
            self.logger.debug('[CAN] vCAN mode is enabled. Overriding CAN settings to use vcan0.')
            all_sensors = [sensor for sensor_list in self.config.sensors.values() for sensor in sensor_list]
            all_signal_sensors = [sensor for sensor_list in self.config.signal_sensors.values() for sensor in sensor_list]
            
            if all_sensors or all_signal_sensors:
                interfaces_to_process.append({
                    'channel': 'vcan0',
                    'bustype': 'socketcan',
                    'bitrate': 500000,
                    'is_extended': True,
                    'sensors': all_sensors,
                    'signal_sensors': all_signal_sensors,
                    'wait_for_ecu': False,
                })
        else:
            for interface in self.config.interfaces:
                channel = interface['channel']
                sensors_for_channel = self.config.sensors.get(channel, [])
                signal_sensors_for_channel = self.config.signal_sensors.get(channel, [])
                
                if sensors_for_channel or signal_sensors_for_channel:
                    interfaces_to_process.append({
                        'channel': channel,
                        'bustype': interface['bustype'],
                        'bitrate': interface['bitrate'],
                        'is_extended': interface['is_extended'],
                        'sensors': sensors_for_channel,
                        'signal_sensors': signal_sensors_for_channel,
                        'wait_for_ecu': interface['wait_for_ecu'],
                    })

        for iface_cfg in interfaces_to_process:
            channel = iface_cfg['channel']
            sensors = iface_cfg['sensors']
            signal_sensors = iface_cfg.get('signal_sensors', [])
            is_extended = iface_cfg['is_extended']
            wait_for_ecu = iface_cfg['wait_for_ecu']

            try:
                bus = can.interface.Bus(
                    channel=channel,
                    bustype=iface_cfg['bustype'],
                    bitrate=iface_cfg['bitrate']
                )
                self.can_buses[channel] = bus

                rep_ids = {s['rep_id'][0] for s in sensors}
                signal_ids = {s['can_id'] for s in signal_sensors}
                filter_ids = rep_ids | signal_ids
            
                if filter_ids:
                    filters = [
                        {
                            'can_id': can_id,
                            'can_mask': 0x1FFFFFFF if is_extended else 0x7FF,
                            'extended': is_extended
                        }
                        for can_id in filter_ids
                    ]
                    bus.set_filters(filters)
                    self.logger.info(f'[CAN] Applied {len(filter_ids)} filter(s) to "{channel}".')

                self.logger.info(f'[CAN] Initialized {bus}')

                sensors_by_id = {}
                for sensor in sensors:
                    rep_id = sensor['rep_id'][0]
                    sensors_by_id.setdefault(rep_id, []).append(sensor)

                signal_sensors_by_id = {}
                for signal_sensor in signal_sensors:
                    can_id = signal_sensor['can_id']
                    signal_sensors_by_id.setdefault(can_id, []).append(signal_sensor)

                reply_event = threading.Event()

                if sensors:
                    canScheduler = CANScheduler(
                        sensors,
                        bus,
                        is_extended,
                        self.logger,
                        reply_event=reply_event if wait_for_ecu else None,
                        wait_for_ecu=wait_for_ecu,
                    )
                    self.broadcast_tasks.append(canScheduler)

                listener = CANListener(
                    sensors_by_id,
                    signal_sensors_by_id,
                    self.logger,
                    reply_event=reply_event if wait_for_ecu else None,
                )
                notifier = can.Notifier(bus, [listener])
                self.notifiers[channel] = notifier

                if sensors:
                    canScheduler.start()

            except Exception as e:
                self.logger.error(f'[CAN] Failed to initialize CAN interface "{channel}": {e}')


    def stop_thread(self):
        self._stop_event.set()

        for scheduler in self.broadcast_tasks:
            scheduler.stop()

        for notifier in self.notifiers.values():
            try:
                notifier.stop()
            except Exception as e:
                self.logger.error(f'[CAN] Error stopping Notifier: {e}')

        for bus in self.can_buses.values():
            bus.shutdown()


def build_poll_cycle(sensors: list[dict]) -> list[dict]:
    WEIGHT = {1: 6, 2: 3, 3: 1}

    credits = {s['key']: WEIGHT.get(s['priority'], 1) for s in sensors}
    weights = {s['key']: WEIGHT.get(s['priority'], 1) for s in sensors}
    sensor_map = {s['key']: s for s in sensors}

    total_slots = sum(weights.values())
    cycle = []

    for _ in range(total_slots):
        winner_key = max(credits, key=lambda k: (credits[k], k))
        cycle.append(sensor_map[winner_key])
        credits[winner_key] -= total_slots
        for k in credits:
            credits[k] += weights[k]

    return cycle


class CANScheduler(threading.Thread):
    REPLY_TIMEOUT = 0.1

    def __init__(self, sensors, can_bus, is_extended, logger, reply_event=None, wait_for_ecu=False):
        super().__init__()
        self.daemon = True
        self.logger = logger
        self.can_bus = can_bus
        self.is_extended = is_extended
        self._stop_event = threading.Event()
        self.wait_for_ecu = wait_for_ecu
        self.reply_event = reply_event

        self.poll_cycle = build_poll_cycle(sensors)
        self.cycle_length = len(self.poll_cycle)

        self.logger.info(
            f'[CAN] Scheduler cycle: {self.cycle_length} slots — '
            + ', '.join(
                f'{s["label"]} (P{s["priority"]})'
                for s in self.poll_cycle
            )
        )

    def run(self):
        self.logger.info('[CAN] Message Scheduler started.')
        index = 0

        while not self._stop_event.is_set():
            sensor = self.poll_cycle[index % self.cycle_length]
            index += 1

            try:
                msg = can.Message(
                    arbitration_id=sensor['req_id'][0],
                    data=bytes(sensor['message_bytes']),
                    is_extended_id=self.is_extended
                )

                if self.wait_for_ecu and self.reply_event:
                    self.reply_event.clear()

                self.can_bus.send(msg)

                if self.wait_for_ecu and self.reply_event:
                    replied = self.reply_event.wait(timeout=self.REPLY_TIMEOUT)
                    if not replied:
                        self.logger.warning(f'[CAN] No reply for "{sensor["label"]}" within {self.REPLY_TIMEOUT * 1000:.0f}ms, moving on.')

                time.sleep(0.01)

            except Exception as e:
                self.logger.error(f'[CAN] Failed to send message for "{sensor["label"]}": {e}')
                self.logger.error(f'[CAN] Bus not available, stopping scheduler.')
                self._stop_event.set()

    def stop(self):
        self._stop_event.set()


class CANListener(can.Listener):
    def __init__(self, sensors_by_id, signal_sensors_by_id, logger, reply_event=None):
        self.logger = logger
        self.sensors_by_id = sensors_by_id
        self.signal_sensors_by_id = signal_sensors_by_id
        self.reply_event = reply_event


        self.polling_timestamps = {}
        self.polling_windows: dict[int, deque] = {}

        for sensors in sensors_by_id.values():
            for sensor in sensors:
                priority = sensor['priority']
                key = sensor['key']
                if priority not in self.polling_timestamps:
                    self.polling_timestamps[priority] = {}
                    self.polling_windows[priority] = deque(maxlen=100)
                self.polling_timestamps[priority][key] = {
                    'last_received': None,
                    'time_received': None,
                    'delta_ms': None,
                }

    def on_message_received(self, msg):
        try:
            data = list(msg.data)

            for sensor in self.sensors_by_id.get(msg.arbitration_id, []):
                if shared_state.verbose:
                    message_hex = ' '.join(f'{byte:02X}' for byte in data)

                mb = sensor.get("message_bytes", ())
                is_match = False
                value = None

                if data[2] == 0xE5:
                    if len(mb) > 3 and data[3] == mb[3]:
                        value = data[7]
                        is_match = True
                else:
                    if len(mb) > 4 and data[3] == mb[3] and data[4] == mb[4]:
                        value = ((data[5] << 8) | data[6]) if sensor.get("is_16bit") else data[5]
                        is_match = True

                if not is_match:
                    continue

                converted_value = eval(sensor['scale'], {'value': value})
                shared_state.update_car_data(sensor['key'], float(converted_value))
                
                # Update polling timestamps
                priority = sensor['priority']
                key = sensor['key']
                entry = self.polling_timestamps[priority][key]
                now = time.monotonic()
                entry['last_received'] = entry['time_received']
                entry['time_received'] = now

                if entry['last_received'] is not None:
                    entry['delta_ms'] = (entry['time_received'] - entry['last_received']) * 1000

                # Compute polling averages using rolling windows per priority group
                polling_rate = {}
                for prio, sensors in self.polling_timestamps.items():
                    deltas = [s['delta_ms'] for s in sensors.values() if s['delta_ms'] is not None]
                    if deltas:
                        avg = sum(deltas) / len(deltas)
                        self.polling_windows[prio].append(avg)
                        polling_rate[prio] = round(sum(self.polling_windows[prio]) / len(self.polling_windows[prio]), 1)

                shared_state.update_polling_rate(polling_rate)

                if self.reply_event:
                    self.reply_event.set()
                
                return

            for sensor in self.signal_sensors_by_id.get(msg.arbitration_id, []):
                byte_index = sensor['byte_index']

                if byte_index < 0 or byte_index >= len(data):
                    continue

                mask = sensor.get('mask')
                if mask is not None:
                    value = (data[byte_index] & mask) >> sensor['shift']
                else:
                    bit_index = sensor['bit_index']
                    if bit_index < 0 or bit_index > 7:
                        continue
                    value = (data[byte_index] >> bit_index) & 0x01

                if sensor.get('invert', False):
                    value = 0 if value else 1

                if sensor.get('scale'):
                    value = eval(sensor['scale'], {'value': value, 'data': data})

                shared_state.update_car_data(sensor['key'], float(value))

        except Exception as e:
            self.logger.error(f'[CAN] CAN listener error: {e}')
