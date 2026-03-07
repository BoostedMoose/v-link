import threading
import queue
import os
import time
import subprocess
import eventlet

#eventlet.monkey_patch()

from flask                  import Flask, send_from_directory, render_template
from flask_socketio         import SocketIO
from flask_cors             import CORS

from .                      import settings
from .shared.shared_state   import shared_state

from .threads.cam         import CAMThread


import logging
logger = logging.getLogger('vlink')

# Flask configuration
server = Flask(__name__, template_folder=os.path.join(os.path.dirname(__file__), '..', 'frontend', 'dist'), static_folder=os.path.join(os.path.dirname(__file__), '..', 'frontend', 'dist', 'assets'), static_url_path='/assets')
server.config['SECRET_KEY'] = 'v-link'
CORS(server, resources={r'/*': {'origins': '*'}})

# Socket.io configuration
socketio = SocketIO(server, cors_allowed_origins='*', async_mode='eventlet')

# List of supported modules
modules = ['app', 'mmi', 'can', 'swc', 'adc', 'rti', 'mst', 'rearcam']


class ServerThread(threading.Thread):
    def __init__(self, logger):
        super().__init__()
        self.daemon = True  # Ensure thread stops when main program exits
        self.app = server
        self.stop_event = threading.Event()
        self.server_socket = eventlet.listen(('0.0.0.0', 4001))        

    def run(self):
        try:
            # Run the server in a green thread
            eventlet.spawn(self._serve)

            # Handle ignition in a green thread
            eventlet.spawn(self.monitor_ignition_state)
            # Handle reverse in a green thread
            eventlet.spawn(self.monitor_reverse_state)

            # Keep the thread alive until stop_event is set
            while not self.stop_event.is_set():
                eventlet.sleep(0.1)

        except Exception as e:
            logger.error(e)

    def _serve(self):
        try:
            eventlet.wsgi.server(
                self.server_socket,
                self.app,
                log=open(os.devnull, 'w'),  # Suppress logs
            )
        except eventlet.StopServe:
            logger.info(f'[Server] Server stopped.')

    def stop_thread(self):
        if shared_state.verbose:
            time.sleep(.5)

        # Raise StopServe to terminate the WSGI server loop
        eventlet.spawn(self.server_socket.close)
        self.stop_event.set()

    def monitor_ignition_state(self):
        previous_ignStatus = None  # Variable to track the previous state of shared_state.ign
        
        while not self.stop_event.is_set():
            # Check if shared_state.ign has changed
            current_ignStatus = shared_state.ignStatus.is_set()

            # If the state has changed, send a message to the frontend
            if current_ignStatus != previous_ignStatus:
                if current_ignStatus:
                    socketio.emit('ign', True, namespace='/sys')
                else:
                    socketio.emit('ign', False, namespace='/sys')

                # Update the previous state to the current state
                previous_ignStatus = current_ignStatus
            eventlet.sleep(0.1)  # Allow other tasks to run while checking ignition state

    def monitor_reverse_state(self):
        previous_reverseStatus = None  # Variable to track the previous state of shared_state.reverse
        
        while not self.stop_event.is_set():
            # Check if shared_state.reverse has changed
            current_reverseStatus = shared_state.reverseStatus.is_set()

            # If the state has changed, send a message to the frontend
            if current_reverseStatus != previous_reverseStatus:
                if current_reverseStatus:
                    logger.debug("Reverse ON, sending event to frontend.")
                    socketio.emit('reverse', True, namespace='/sys')
                else:
                    logger.debug("Reverse OFF, sending event to frontend.")
                    socketio.emit('reverse', False, namespace='/sys')

                # Update the previous state to the current state
                previous_reverseStatus = current_reverseStatus

            eventlet.sleep(0.1)  # Allow other tasks to run while checking reverse state
        
    # Add custom headers to all responses
    @server.after_request
    def after_request(response):
        return response

    # Route to serve the index.html file
    @server.route('/')
    def serve_index():
        return render_template('index.html')

    # Route to serve static files (js, css, etc.) from the 'dist/assets' folder
    @server.route('/assets/<path:filename>')
    def serve_assets(filename):
        response = send_from_directory(os.path.join(os.path.dirname(__file__), '..', 'frontend', 'dist', 'assets'), filename)
        response.headers['Cross-Origin-Embedder-Policy'] = 'require-corp'
        response.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
        return response
    
    # Handle client connection
    @socketio.on('connect', namespace='/')
    def handle_connect():
        if (shared_state.verbose): print("Client connected")
    
    @socketio.on('connect', namespace='/sys')
    def handle_sys_connect():
     socketio.emit('ign',     shared_state.ignStatus.is_set(),     namespace='/sys')
     socketio.emit('reverse', shared_state.reverseStatus.is_set(), namespace='/sys')


    # Create event handler
    def register_socketio(module):
        namespace = f'/{module}'
        toggle_attr = f'toggle_{module}'

        # rearcam: instancia perezosa del driver
        rearcam = {"drv": None}

        # Emit module Data
        def emit_data(data):
            socketio.emit('data', data, namespace=namespace)

        # Save module settings
        def save_settings(data):
            # rearcam no usa settings; mantenemos la firma y no persistimos
            if module != "rearcam":
                settings.save_settings(module, data)
                if module == "app":
                    try:
                        shared_state.backlight_daylight = data.get('daylight_backlight', {}).get('value', shared_state.backlight_daylight)
                        shared_state.backlight_darkness = data.get('darkness_backlight', {}).get('value', shared_state.backlight_darkness)
                        shared_state.backlight_auto_enabled = data.get('auto_backlight', {}).get('autoOpen', {}).get('value', shared_state.backlight_auto_enabled)
                    except Exception as e:
                        logger.error(f'[Settings] Error updating backlight shared state from save: {e}')

        # Emit module settings
        def load_settings():
            payload = {} if module == "rearcam" else settings.load_settings(module)
            socketio.emit('settings', payload, namespace=namespace)

        # Emit module status
        def emit_state():
            thread_state = shared_state.THREADS.get(module, None)
            state = thread_state.is_alive() if thread_state else False

            # rearcam: "state" es el ON/OFF del GPIO
            if module == "rearcam" and rearcam["drv"] is not None:
                try:
                    state = bool(rearcam["drv"].get())
                except Exception as e:
                    logger.error(f"rearcam.get() error: {e}")
                    state = False

            socketio.emit('state', state, namespace=namespace)

        # Toggle module status
        def toggle_state():
            # rearcam: toggle = invertir GPIO
            if module == "rearcam":
                try:
                    if rearcam["drv"] is None:
                        rearcam["drv"] = CameraGPIO(line=26, chip=0, active_high=True, logger=logger)
                    on = rearcam["drv"].toggle()
                    socketio.emit('state', on, namespace=namespace)
                    socketio.emit('camera/status', {'on': on}, namespace=namespace)
                except Exception as e:
                    logger.exception("rearcam.toggle failed")
                    socketio.emit('state', False, namespace=namespace)
                    socketio.emit('camera/status', {'on': False, 'error': str(e)}, namespace=namespace)
                return

            if (shared_state.verbose): print('Toggling Thread')
            getattr(shared_state, toggle_attr).set()

            thread_state = shared_state.THREADS.get(module, None)
            thread_state = thread_state.is_alive() if thread_state else False
            socketio.emit('state', not thread_state, namespace=namespace)

        load_settings.__name__  = f'load_settings_{module}'
        save_settings.__name__  = f'save_settings_{module}'
        emit_state.__name__     = f'emit_status_{module}'
        toggle_state.__name__   = f'handle_toggle_{module}'
        emit_data.__name__      = f'handle_data_{module}'

        def backlight_update(data):
            if module != "app":
                return
            if not isinstance(data, dict):
                return
            try:
                if 'daylight' in data:
                    shared_state.backlight_daylight = data['daylight']
                if 'darkness' in data:
                    shared_state.backlight_darkness = data['darkness']
                if 'auto_enabled' in data:
                    shared_state.backlight_auto_enabled = data['auto_enabled']
                logger.info(
                    f"[Backlight] daylight={shared_state.backlight_daylight} "
                    f"darkness={shared_state.backlight_darkness} "
                    f"auto_enabled={shared_state.backlight_auto_enabled}"
                )
            except Exception as e:
                logger.error(f'[Settings] Error updating backlight shared state: {e}')

        backlight_update.__name__ = f'backlight_update_{module}'

        socketio.on_event('load', load_settings, namespace=namespace)
        socketio.on_event('save', save_settings, namespace=namespace)
        socketio.on_event('ping', emit_state, namespace=namespace)
        socketio.on_event('data', emit_data, namespace=namespace)
        socketio.on_event('toggle', toggle_state, namespace=namespace)
        socketio.on_event('backlight:update', backlight_update, namespace=namespace)

        # ------- Eventos específicos para rearcam -------
        if module == "rearcam":
            def rearcam_mount(_payload=None):
                try:
                    if rearcam["drv"] is None:
                        rearcam["drv"] = CameraGPIO(line=26, chip=0, active_high=True, logger=logger)
                    rearcam["drv"].set(True)
                    on = rearcam["drv"].get()
                    socketio.emit('state', on, namespace=namespace)
                    socketio.emit('camera/status', {'on': on}, namespace=namespace)
                except Exception as e:
                    logger.exception("rearcam.mount failed")
                    socketio.emit('state', False, namespace=namespace)
                    socketio.emit('camera/status', {'on': False, 'error': str(e)}, namespace=namespace)

            def rearcam_unmount(_payload=None):
                try:
                    if rearcam["drv"] is None:
                        rearcam["drv"] = CameraGPIO(line=26, chip=0, active_high=True, logger=logger)
                    rearcam["drv"].set(False)
                    on = rearcam["drv"].get()
                    socketio.emit('state', on, namespace=namespace)
                    socketio.emit('camera/status', {'on': on}, namespace=namespace)
                except Exception as e:
                    logger.exception("rearcam.unmount failed")
                    socketio.emit('state', False, namespace=namespace)
                    socketio.emit('camera/status', {'on': False, 'error': str(e)}, namespace=namespace)

            def rearcam_status(_payload=None):
                try:
                    if rearcam["drv"] is None:
                        rearcam["drv"] = CameraGPIO(line=26, chip=0, active_high=True, logger=logger)
                    on = bool(rearcam["drv"].get())
                    socketio.emit('camera/status', {'on': on}, namespace=namespace)
                except Exception as e:
                    logger.error(f"rearcam.status error: {e}")
                    socketio.emit('camera/status', {'on': False, 'error': str(e)}, namespace=namespace)

            socketio.on_event('mount',   rearcam_mount,   namespace=namespace)
            socketio.on_event('unmount', rearcam_unmount, namespace=namespace)
            socketio.on_event('status',  rearcam_status,  namespace=namespace)

            # Aliases de compatibilidad desde el root "/"
            @socketio.on('rearcam:mount', namespace='/')
            def _alias_mount(_p=None):   rearcam_mount(_p)

            @socketio.on('rearcam:unmount', namespace='/')
            def _alias_unmount(_p=None): rearcam_unmount(_p)
        

    # Register modules
    for module in modules:
        register_socketio(module)

    # Handle UI update requests
    @socketio.on('request', namespace='/data')
    def handle_can_request():
        try:
            request_timestamp = time.time()

            # Limit output to 2 decimal places
            data = {
                k: round(v, 2) if isinstance(v, float) else v
                for k, v in shared_state.car_data.items()
            }

            payload = {
                'timestamp': request_timestamp,
                'data': data
            }

            socketio.emit('data', payload, namespace='/data')
        except Exception as e:
            logger.error(f'[Server] Error handling data request: {e}')



    # Handle system  tasks
    @socketio.on('systemTask', namespace='/sys')
    def handle_system_task(args, payload=None):
        if   args == 'check':
            logger.info(f'[Server] Check for existing profiles')
            # Checks whether .config/v-link/ exists
            # Returns either true or an object with selectable profiles.
            result = settings.check_settings()
            if result is True:
                # Push the current (potentially migrated) settings
                socketio.emit('settings', settings.load_settings('app'), namespace='/app')
            return result
        
        elif args == 'load':
            # Loads the profile which was selected through the frontend.
            if payload == "Default":
                logger.info(f'[Server] Loading default profile')
                result = settings.copy_files("Default")
            else:
                logger.info(f'[Server] Load Profile and copy settings')
                result = settings.copy_files(payload)
            if result:
                socketio.emit('settings', settings.load_settings('app'), namespace='/app')
                return {'result': result}
            
        elif args == 'start':
            # Loads the profile which was selected through the frontend.
            logger.info(f'[Server] Start all threads')
            shared_state.start_event.set()

        elif args == 'reboot':
            # Reboots the system
            logger.info(f'[Server] Reboot system')
            subprocess.run('sudo reboot -h now', shell=True)

        elif args == 'shutdown':
            # Shuts down the system
            logger.info(f'[Server] Shutdown system')
            subprocess.run('sudo shutdown -h now', shell=True)

        elif args == 'reset':
            # Resets settings to default and restarts the application
            logger.info(f'[Server] Reset settings to default')
            settings.reset_settings()
            shared_state.restart_event.set()

        elif args == 'rti':
            # Toggles RTI and HDMI status
            logger.info(f'[Server] Toggle RTI/HDMI')
            shared_state.rtiStatus = not shared_state.rtiStatus
            shared_state.hdmiStatus = shared_state.rtiStatus

            socketio.emit('state', shared_state.rtiStatus, namespace='/rti')
            if not shared_state.dev:
                shared_state.hdmi_event.set()

        elif args == 'quit':
            # Quits the application
            logger.info(f'[Server] Quit application')
            shared_state.exit_event.set()

        elif args == 'restart':
            # Restarts the application (namely the frontend)
            logger.info(f'[Server] Restart application')
            shared_state.restart_event.set()

        elif args == 'hdmi':
            # Toggles HDMI on/off
            logger.info(f'[Server] Toggle HDMI')
            shared_state.hdmiStatus = not shared_state.hdmiStatus
            if not shared_state.dev:
                shared_state.hdmi_event.set()

        elif args == 'reverse':
            socketio.emit('reverse', shared_state.reverseStatus.is_set(), namespace="/sys")

        elif args == 'update':
            # Updates the application
            logger.info(f'[Server] Update Application')
            shared_state.update_event.set()

        elif args == 'ign':
            # Sends the current ignition status to the frontend
            logger.info(f'[Server] Ignition status request')
            socketio.emit('ign', shared_state.ignStatus.is_set(), namespace='/sys')

        else:
            logger.debug(f'[Server] Unknown action: {args}')


    # Handle force MOST switch request
    @socketio.on('force_switch', namespace='/most')
    def handle_force_switch():
        logger.info(f'[Server] Force MOST switch')
        most_thread = shared_state.THREADS.get('pimost', None)

        if most_thread and most_thread.is_alive():
            most_thread.force_switch()

    # Currently unused, we can perform certain actions based on MOST messages here or in pimost.py
    @socketio.on('most_message', namespace='/most')
    def print_most_message(args):
        logger.debug(f'[Server] Received most message on most namespace: {args}')


    # Handle DTC read requests
    @socketio.on('read', namespace='/dtc')
    def handle_dtc_read(payload=None):
        can_thread = shared_state.THREADS.get('can')
        if not can_thread or not can_thread.is_alive():
            socketio.emit('error', 'CAN module not running', namespace='/dtc')
            return

        mode = (payload or {}).get('mode', 'targeted')
        can_settings = settings.load_settings('can')

        if mode == 'full':
            primary_iface = 'can2'
            for iface in can_settings.get('interfaces', []):
                if iface.get('enabled'):
                    primary_iface = iface['channel']
                    break
            if shared_state.vCan:
                primary_iface = 'vcan0'

            dtc_modules = [
                {'id': hex(i), 'name': hex(i), 'interface': primary_iface}
                for i in range(0x00, 0x100)
            ]
            scan_kwargs = {'timeout': 0.5, 'skip_timeouts': True}
        else:
            dtc_modules = can_settings.get('dtc_modules', [])
            if not dtc_modules:
                socketio.emit('error', 'No DTC modules configured', namespace='/dtc')
                return
            scan_kwargs = {'timeout': 2.0, 'skip_timeouts': False}

        # Create/reset a stop event so the user can cancel mid-scan
        stop_event = threading.Event()
        stop_event.clear()
        shared_state.dtc_stop_event = stop_event
        scan_kwargs['stop_event'] = stop_event

        # Bridge queue: scan_dtc (real OS thread) puts events here;
        # an eventlet green thread reads and emits them to the frontend.
        # This is required because socketio.emit() must be called from
        # an eventlet green thread when async_mode='eventlet'.
        result_queue = queue.Queue()

        def emit_fn(event, data):
            result_queue.put((event, data))

        def relay_events():
            while True:
                try:
                    event, data = result_queue.get(block=False)
                    socketio.emit(event, data, namespace='/dtc')
                    if event in ('complete', 'error'):
                        break
                except queue.Empty:
                    eventlet.sleep(0.05)

        threading.Thread(
            target=can_thread.scan_dtc,
            args=(dtc_modules, emit_fn),
            kwargs=scan_kwargs,
            daemon=True
        ).start()
        socketio.start_background_task(relay_events)

    # Handle DTC stop requests
    @socketio.on('stop', namespace='/dtc')
    def handle_dtc_stop():
        stop_event = getattr(shared_state, 'dtc_stop_event', None)
        if stop_event:
            stop_event.set()
            logger.info('[DTC] Stop requested by user.')

    # Handle DTC report save requests
    @socketio.on('save_report', namespace='/dtc')
    def handle_dtc_save_report(payload):
        import datetime
        results = (payload or {}).get('results', [])
        mode    = (payload or {}).get('mode', 'unknown')

        timestamp = datetime.datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        report_dir = os.path.expanduser('~/.config/v-link/dtc_reports')
        os.makedirs(report_dir, exist_ok=True)
        filepath = os.path.join(report_dir, f'dtc_{timestamp}.txt')

        lines = [
            'DTC Scan Report',
            f'Date  : {datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")}',
            f'Mode  : {mode}',
            '',
            f'{"Module":<10} {"ID":<8} {"Response CAN ID":<18} {"Status"}',
            f'{"-"*10} {"-"*8} {"-"*18} {"-"*20}',
        ]
        for r in results:
            status = 'No response' if r.get('has_dtc') is None else (f'DTC: {r["dtc"]}' if r['has_dtc'] else 'OK')
            can_id = r.get('can_id') or '—'
            lines.append(f'{r["name"]:<10} {r["id"]:<8} {can_id:<18} {status}')

        try:
            with open(filepath, 'w') as f:
                f.write('\n'.join(lines))
            socketio.emit('report_saved', {'path': filepath}, namespace='/dtc')
            logger.info(f'[DTC] Report saved to {filepath}')
        except Exception as e:
            logger.error(f'[DTC] Failed to save report: {e}')
            socketio.emit('error', f'Failed to save report: {e}', namespace='/dtc')

    # Handle UI log messages
    @socketio.on('info', namespace='/log')
    def handle_frontend_error(args):
        logger.info(f'[Frontend] {args}')

    @socketio.on('debug', namespace='/log')
    def handle_frontend_error(args):
        logger.debug(f'[Frontend] {args}')

    @socketio.on('error', namespace='/log')
    def handle_frontend_error(args):
        logger.error(f'[Frontend] {args}')
