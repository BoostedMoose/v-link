import threading
import time
import can
import random
import queue

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
                bit_index = int(sensor['bit_index'])
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

        self.can_buses = {}         # can interfaces
        self.notifiers = {}         # can filters (using a callback)
        self.broadcast_tasks = []   # scheduled tasks to send can messages

        
    def run(self):
        self.initialize_can()
        
        try:
            while not self._stop_event.is_set():
                time.sleep(1)
        except KeyboardInterrupt:
            pass

    # Initialize CAN interface and load configurations
    def initialize_can(self):
        interfaces_to_process = []

        if shared_state.vCan:
            self.logger.debug('[CAN] vCAN mode is enabled. Overriding CAN settings to use vcan0.')
            all_sensors = [sensor for sensor_list in self.config.sensors.values() for sensor in sensor_list]
            all_signal_sensors = [ sensor for sensor_list in self.config.signal_sensors.values() for sensor in sensor_list ]
            
            if all_sensors or all_signal_sensors:
                interfaces_to_process.append({
                    'channel': 'vcan0',
                    'bustype': 'socketcan',
                    'bitrate': 500000,
                    'is_extended': True,  # Assume extended for debugging simplicity
                    'sensors': all_sensors,
                    'signal_sensors': all_signal_sensors,
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
                    })

        # --- Unified Initialization Loop ---
        for iface_cfg in interfaces_to_process:
            channel = iface_cfg['channel']
            sensors = iface_cfg['sensors']
            signal_sensors = iface_cfg.get('signal_sensors', [])
            is_extended = iface_cfg['is_extended']

            try:
                bus = can.interface.Bus(
                    channel=channel,
                    bustype=iface_cfg['bustype'],
                    bitrate=iface_cfg['bitrate']
                )
                self.can_buses[channel] = bus

                # Gather all reply IDs for filtering
                rep_ids = {s['rep_id'][0] for s in sensors} # TODO double check [0]
                signal_ids = {s['can_id'] for s in signal_sensors}
                filter_ids = rep_ids | signal_ids
            
                # Apply filters
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

                # Group sensors by reply ID for listeners
                sensors_by_id = {}
                for sensor in sensors:
                    rep_id = sensor['rep_id'][0] # TODO doublecheck [0]
                    sensors_by_id.setdefault(rep_id, []).append(sensor)

                signal_sensors_by_id = {}
                for signal_sensor in signal_sensors:
                    can_id = signal_sensor['can_id']
                    signal_sensors_by_id.setdefault(can_id, []).append(signal_sensor)

                # Start Scheduler only if there are sensors to request
                canScheduler = None
                if sensors:
                    canScheduler = CANScheduler(sensors_by_id, bus, is_extended, self.logger, wait_for_ecu=any(i.get('wait_for_ecu') for i in self.config.interfaces if i['channel'] == channel))
                    self.broadcast_tasks.append(canScheduler)
                    canScheduler.start()

                # Setup Listeners
                listeners = []
                if sensors or signal_sensors:
                    listeners.append(
                        CANListener(
                            sensors_by_id,
                            signal_sensors_by_id,
                            self.logger,
                            canScheduler.events if canScheduler else None
                        )
                    )
                
                if listeners:
                    notifier = can.Notifier(bus, listeners)
                    self.notifiers[channel] = notifier

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

    def scan_dtc(self, dtc_modules, emit_fn, timeout=2.0, skip_timeouts=False, stop_event=None):
        self.logger.info(f'[DTC] Starting DTC scan ({len(dtc_modules)} modules, timeout={timeout}s)')

        for s in self.broadcast_tasks:
            s.pause()
        time.sleep(0.15)

        original_filters = {}
        dtc_listener = DTCListener()

        try:
            for ch, bus in self.can_buses.items():
                original_filters[ch] = bus.filters
                bus.set_filters([])

            for notifier in self.notifiers.values():
                notifier.listeners.append(dtc_listener)

            for module in dtc_modules:
                if stop_event and stop_event.is_set():
                    self.logger.info('[DTC] Scan stopped by user.')
                    break

                module_id = int(module['id'], 16)
                iface = module['interface']
                bus = self.can_buses.get(iface)
                if not bus:
                    self.logger.warning(f'[DTC] Interface "{iface}" not found, skipping module {module["name"]}')
                    continue

                q = dtc_listener.register(module_id)
                data = [0xCB, module_id, 0xAE, 0x1B, 0x00, 0x00, 0x00, 0x00]
                try:
                    bus.send(can.Message(
                        arbitration_id=0x000FFFFE,
                        data=bytes(data),
                        is_extended_id=True
                    ))
                except Exception as e:
                    self.logger.error(f'[DTC] Failed to send request for {module["name"]}: {e}')
                    continue

                try:
                    result = q.get(timeout=timeout)
                    response_data = result['data']
                    can_id = result['can_id']
                    has_dtc = not (response_data[4] == 0x00 and response_data[5] == 0x00)
                    dtc_val = f"{response_data[4]:02X} {response_data[5]:02X}" if has_dtc else None
                    self.logger.info(f'[DTC] {module["name"]} ({module["id"]}): {"DTC " + dtc_val if has_dtc else "OK"} (rep_id=0x{can_id:08X})')
                    emit_fn('progress', {
                        'name': module['name'],
                        'id': module['id'],
                        'can_id': f'0x{can_id:08X}',
                        'has_dtc': has_dtc,
                        'dtc': dtc_val
                    })
                except queue.Empty:
                    self.logger.debug(f'[DTC] No response from {module["name"]} ({module["id"]})')
                    if not skip_timeouts:
                        emit_fn('progress', {
                            'name': module['name'],
                            'id': module['id'],
                            'can_id': None,
                            'has_dtc': None,
                            'dtc': None
                        })

                time.sleep(0.05)

        finally:
            for ch, bus in self.can_buses.items():
                bus.set_filters(original_filters.get(ch, []))
            for notifier in self.notifiers.values():
                if dtc_listener in notifier.listeners:
                    notifier.listeners.remove(dtc_listener)
            for s in self.broadcast_tasks:
                s.resume()
            self.logger.info('[DTC] Scan complete, scheduler resumed.')

        emit_fn('complete', None)


#############################################################
# CAN Scheduler - Sending out scheduled messages to network #
#############################################################

class CANScheduler(threading.Thread):
    def __init__(self, sensors_config, can_bus, is_extended, logger, wait_for_ecu=False):
        super().__init__()
        self.daemon = True
        self.logger = logger
        self.can_bus = can_bus
        self.is_extended = is_extended
        self._stop_event = threading.Event()
        self.wait_for_ecu = wait_for_ecu

        self.interval = 0.01  # 100Hz tick, one message every 10ms
        self.events = {}
        self._paused = threading.Event()

        # Initialize events for all reply IDs if wait_for_ecu is enabled
        if self.wait_for_ecu:
            for device_id, sensor_list in sensors_config.items():
                for sensor in sensor_list:
                    if sensor['type'] != 'internal':
                        rep_id = sensor['rep_id'][0]
                        self.events.setdefault(rep_id, threading.Event())

        # Group sensors by priority (1 = highest, 3 = lowest)
        self.prio_sensors = {1: [], 2: [], 3: []}

        for device_id, sensor_list in sensors_config.items():
            for sensor in sensor_list:
                try:
                    if sensor['type'] == 'internal':
                        continue

                    prio = sensor.get('priority', 2)
                    self.prio_sensors.setdefault(prio, []).append(sensor)
                except Exception as e:
                    self.logger.error(f'[CAN] Error adding sensor "{sensor["key"]}" with priority "{prio}"')

        # Keep track of the last sent sensor for each priority (round robin)
        self.rotation = {
            1: 0,
            2: 0,
            3: 0
            }

        # Token generator for smooth weighted scheduling
        self.token_stream = self.token_generator({
            1: 6,
            2: 3,
            3: 1
            })
        
    def pause(self):
        self._paused.set()

    def resume(self):
        self._paused.clear()

    def run(self):
        self.logger.info('[CAN] Message Scheduler started.')
        while not self._stop_event.is_set():
            if self._paused.is_set():
                time.sleep(0.01)
                continue

            # Get next token from pool (i.e. priority)
            token = next(self.token_stream)

            if self.prio_sensors[token]:
                #Select next sensor based on the token
                sensor = self.return_sensor(token)

                try:
                    # Construct message
                    msg = can.Message(
                        arbitration_id=sensor['req_id'][0],
                        data=bytes(sensor['message_bytes']),
                        is_extended_id=self.is_extended
                    )

                    rep_id = sensor['rep_id'][0]
                    evt = None

                    if self.wait_for_ecu:
                        evt = self.events.get(rep_id)
                        if evt:
                            evt.clear()

                    self.can_bus.send(msg)

                    if self.wait_for_ecu and evt:
                        if not evt.wait(timeout=1.0):
                            self.logger.warning(f'[CAN] Timeout waiting for response to {sensor["label"]}')
                    
                    #self.logger.debug(f'Sending message: {sensor['label']}: {msg}')

                except Exception as e:
                    err_msg = str(e)
                    self.logger.error(f'[CAN] Failed to send message: {err_msg}')
                    
                    self.logger.error(f'[CAN] Bus not available, stopping thread.')
                    self._stop_event.set()

            # Sleep to maintain 0.01s interval between messages
            time.sleep(0.01)


    def return_sensor(self, priority):
        #Get the next index of the message in the selected priority group
        index = self.rotation[priority]
        sensors = self.prio_sensors[priority]

        #Select sensor based on index
        sensor = sensors[index % len(sensors)]


        self.rotation[priority] = (index + 1) % len(sensors)
        return sensor

    def token_generator(self, weights):
        # Generator to create random token pools based on the provided weights
        token_pool = []
        for prio, weight in weights.items():
            token_pool.extend([prio] * weight)

        while True:
            # Shuffle the token pool after all tokens have been yealded
            random.shuffle(token_pool)

            for token in token_pool:
                # Return token from the pool one after another
                yield token

    def stop(self):
        self._stop_event.set()


#############################################################
# CAN Listener - Listening to diagnostic messages           #
#############################################################

class CANListener(can.Listener):
    def __init__(self, sensors_by_id, signal_sensors_by_id, logger, events=None):
        self.logger = logger
        self.sensors_by_id = sensors_by_id
        self.signal_sensors_by_id = signal_sensors_by_id
        self.events = events or {}

    def on_message_received(self, msg):
        try:
            for sensor in self.sensors_by_id.get(msg.arbitration_id, []):
                data = list(msg.data)
                if shared_state.verbose:
                    message_hex = ' '.join(f'{byte:02X}' for byte in data)
                    #self.logger.debug(f'Parsing message: {message_hex}')

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

                evt = self.events.get(sensor['rep_id'][0])
                if evt:
                    evt.set()

                return            

            for sensor in self.signal_sensors_by_id.get(msg.arbitration_id, []):
                byte_index = sensor['byte_index']
                bit_index = sensor['bit_index']

                if byte_index < 0 or byte_index >= len(data):
                    continue
                if bit_index < 0 or bit_index > 7:
                    continue

                value = (data[byte_index] >> bit_index) & 0x01
                if sensor.get('invert', False):
                    value = 0 if value else 1

                if sensor.get('scale'):
                    value = eval(sensor['scale'], {'value': value, 'data': data})

                shared_state.update_car_data(sensor['key'], float(value))
                return
                    
        except Exception as e:
            self.logger.error(f'[CAN] CAN listener error: {e}')


#############################################################
# DTC Listener - Listens for DTC responses                  #
#############################################################

class DTCListener(can.Listener):
    def __init__(self):
        self.queues = {}  # module_id (int) -> queue.Queue

    def register(self, module_id):
        self.queues[module_id] = queue.Queue()
        return self.queues[module_id]

    def on_message_received(self, msg):
        data = list(msg.data)
        if len(data) >= 6 and data[2] == 0xEE and data[3] == 0x1B:
            q = self.queues.get(data[1])
            if q:
                q.put({'data': data, 'can_id': msg.arbitration_id})
