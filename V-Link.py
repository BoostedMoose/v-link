'''
    V-Link - A modular, open-source infotainment system.
    Copyright (C) 2024
    Author:     Louis Raymond - github.com/BoostedMoose
    Co-Author:  Tigo Passchier - github.com/tigo2000

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
'''

import sys
import os
import subprocess


def activate_venv():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    venv_path = os.path.join(script_dir, 'venv')
    python_bin = os.path.join(venv_path, 'bin', 'python')

    if not os.path.exists(python_bin):
        sys.stderr.write(f'[V-Link] Python interpreter for venv not found: {python_bin}\n')
        sys.stderr.write('[V-Link] Please ensure the virtual environment is set up correctly. Exiting...\n')
        sys.exit(1)

    if os.path.abspath(sys.prefix) == os.path.abspath(venv_path):
        return

    env = os.environ.copy()
    env['VIRTUAL_ENV'] = venv_path
    env['PATH'] = os.path.join(venv_path, 'bin') + os.pathsep + env.get('PATH', '')
    env.pop('PYTHONHOME', None)

    os.execve(
        python_bin,
        [python_bin, os.path.abspath(__file__), *sys.argv[1:]],
        env,
    )

if __name__ == '__main__':
    activate_venv()

import threading
import time
import argparse
import collections
import logging

from pathlib import Path

from backend.version import VERSION


sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.dev.vcan            import VCANThread

from backend.server              import ServerThread

from backend.threads.mst         import MOSTThread
from backend.threads.app         import APPThread
from backend.threads.adc         import ADCThread
from backend.threads.rti         import RTIThread
from backend.threads.can         import CANThread
from backend.threads.ign         import IGNThread
from backend.threads.swc         import SWCThread
from backend.threads.cam         import CAMThread

from backend.logger import logger

from backend.shared.shared_state import shared_state

rpiModel = ''
rpiProtocol = ''

class VLINK:
    def __init__(self):
        self.exit_event = shared_state.exit_event
        self.rpiModel = ''
        self.rpiProtocol =''
        self.threads = {
            'server':   ServerThread,
            'app':      APPThread,

            'can':      CANThread,
            'adc':      ADCThread,
            'rti':      RTIThread,
            'ign':      IGNThread,
            'swc':      SWCThread,
            'cam':      CAMThread,
          
            'vcan':     VCANThread,
        }

        if shared_state.pimost:
            self.threads['mst'] = MOSTThread

        logger.info(f'Starting V-Link {VERSION}')

    def detect_rpi(self):

        try:
            # Get Raspberry Model
            with open('/proc/device-tree/model', 'r') as f:
                model = f.read().strip()
                found = False
                for i in range(3, 6):
                    if f'Raspberry Pi {i}' in model:
                        shared_state.rpiModel = i
                        self.rpiModel = f'Raspberry Pi {i}'
                        found = True
                        break
                if not found:
                    logger.error(f'No Raspberry Pi detected.')
                    self.rpiModel = 'Unknown'
                    shared_state.rpiModel = 4

            
            # Get Session Type
            session_type = os.getenv('XDG_SESSION_TYPE')
            if session_type == 'wayland':
                shared_state.sessionType = 'wayland'
                self.rpiProtocol = 'Wayland'
            elif session_type == 'x11':
                shared_state.sessionType = 'x11'
                self.rpiProtocol = 'X11'
            else:
                self.rpiProtocol = 'Unknown'

        except FileNotFoundError:
            return 'Not running on a Raspberry Pi or file at /proc/device-tree/model not found.'

    
    def start_modules(self):
        import backend.settings as settings
        settings.load_modules()

        if shared_state.vCan:
            self.start_thread('vcan', logger)
            time.sleep(.05)

        self.start_thread('cam', logger)
        time.sleep(.05)

        if shared_state.pimost:
            self.start_thread('mst', logger)
            time.sleep(.05)

        if shared_state.canModule:
            self.start_thread('can', logger)
            time.sleep(.05)
        if shared_state.rtiModule:
            self.start_thread('rti', logger)
            time.sleep(.05)
        if shared_state.adcModule:
            self.start_thread('adc', logger)
            time.sleep(.05)
        if shared_state.swcModule:
            self.start_thread('swc', logger)
            time.sleep(.05)

        vlink.start_thread('ign', logger)

    def start_thread(self, thread_name, logger):
        if thread_name in shared_state.THREADS:
            thread = shared_state.THREADS[thread_name]
            if isinstance(thread, threading.Thread) and thread.is_alive():
                logger.info(f'[V-Link] "{thread_name}" thread is already running.')
                return

        thread_class = self.threads[thread_name]
        thread = thread_class(logger=logger) # instantiate thread
        thread.daemon = True
        thread.start()

        shared_state.THREADS[thread_name] = thread

        time.sleep(.05)
        if not thread.is_alive():
            logger.error(f'[V-Link] "{thread_name}" failed to start.')
        else:
            logger.info(f'[V-Link] {thread_name}-thread started.')


    def stop_thread(self, thread_name):
        logger.info(f'[V-Link] Stopping {thread_name} thread.')
        if thread_name in shared_state.THREADS:
            thread = shared_state.THREADS[thread_name]
            if isinstance(thread, threading.Thread) and thread.is_alive():
                try:
                    thread.stop_thread()
                    thread.join()
                except Exception as e:
                    logger.error(f'[V-Link] Error stopping thread {thread_name}: {e}')
                finally:
                    shared_state.THREADS[thread_name] = None


    def toggle_thread(self, thread_name):
        thread = shared_state.THREADS.get(thread_name)
        is_alive = isinstance(thread, threading.Thread) and thread.is_alive()
        if is_alive:
            self.stop_thread(thread_name)
        else:
            self.start_thread(thread_name, logger)

    def join_threads(self):
        logger.info('\nStopping threads, please wait patiently...\n')
        for thread_name, thread in shared_state.THREADS.items():
            if isinstance(thread, threading.Thread) and thread.is_alive():
                self.stop_thread(thread_name)
            
    def print_thread_states(self):
        for thread_name, thread in shared_state.THREADS.items():
            state = 'Alive' if isinstance(thread, threading.Thread) and thread.is_alive() else 'Not alive'
            logger.debug(f'{thread_name} Thread: {state}')

    def process_toggle_event(self):
        if shared_state.toggle_can.is_set():
            self.toggle_thread('can')
            shared_state.toggle_can.clear()
            
        if shared_state.toggle_adc.is_set():
            self.toggle_thread('adc')
            shared_state.toggle_adc.clear()
        
        if shared_state.toggle_rti.is_set():
            self.toggle_thread('rti')
            shared_state.toggle_rti.clear()

        if shared_state.toggle_app.is_set():
            self.toggle_thread('app')
            shared_state.toggle_app.clear()

        if shared_state.toggle_ign.is_set():
            self.toggle_thread('ign')
            shared_state.toggle_ign.clear()
        
        if shared_state.toggle_reverse.is_set():
            self.toggle_thread('cam')
            shared_state.toggle_reverse.clear()

        if shared_state.toggle_swc.is_set():
            self.toggle_thread('swc')
            shared_state.toggle_swc.clear()


    def process_exit_event(self):
        if self.exit_event.is_set():
            logger.info('Exiting App')
            self.exit_event.clear()

            shared_state.rtiStatus = False

            time.sleep(5)

            shared_state.toggle_app.set()


    def process_restart_event(self):
        if shared_state.restart_event.is_set():
            logger.info('[V-Link] Restarting App')
            shared_state.restart_event.clear()

            for thread_name, thread in shared_state.THREADS.items():
                if thread_name != 'server' and isinstance(thread, threading.Thread) and thread.is_alive():
                    self.stop_thread(thread_name)
            time.sleep(.5)
            
            self.start_thread('app', logger)
            self.start_modules()

    def process_hdmi_event(self):
        if shared_state.hdmi_event.is_set():
            shared_state.hdmi_event.clear()
            hdmi_on, hdmi_off = (
                ('wlr-randr --output HDMI-A-1 --on', 'wlr-randr --output HDMI-A-1 --off')
                if shared_state.sessionType == 'wayland'
                else ('vcgencmd display_power 1', 'vcgencmd display_power 0')
            )

            if  not shared_state.hdmiStatus:
                logger.info('[V-Link] Toggle HDMI Off')
                os.system(hdmi_off)
            else:
                logger.info('[V-Link] Toggle HDMI On')
                os.system(hdmi_on)

            shared_state.hdmiStatus = not shared_state.hdmiStatus


    def process_update_event(self):
        if shared_state.update_event.is_set():
            shared_state.update_event.clear()
            shared_state.update = True
            shared_state.exit_event.set()

    def process_start_event(self):
        if shared_state.start_event.is_set():
            shared_state.start_event.clear()
            self.start_modules()
            return True
        return False


def clear_screen():
    if os.name == 'nt':
        os.system('cls')
    else:
        os.system('clear')


_display_initialized = False
_app_started = False
_prev_display_snapshot = None

LOG_CAPACITY = 20

class _RingBufferHandler(logging.Handler):
    def __init__(self):
        super().__init__(level=logging.WARNING)
        self.buffer = collections.deque(maxlen=LOG_CAPACITY)
        self.setFormatter(logging.Formatter('%(levelname)-8s %(message)s'))

    def emit(self, record):
        if record.levelno < self.level:
            return
        msg = self.format(record)
        if record.levelno >= logging.ERROR:
            msg = f'\033[31m{msg}\033[0m'
        else:
            msg = f'\033[33m{msg}\033[0m'
        self.buffer.append(msg)

_log_handler = _RingBufferHandler()


def non_blocking_input(prompt):
    try:
        return input(prompt)
    except EOFError:
        return None


def parse_window_size(value):
    try:
        width, height = (int(part) for part in value.lower().split('x', 1))
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError('window size must use WIDTHxHEIGHT, for example 400x234')

    if width <= 0 or height <= 0:
        raise argparse.ArgumentTypeError('window width and height must be greater than zero')
    return width, height


def setup_arguments():
    parser = argparse.ArgumentParser(
        description='Application Manual:\n\n'
                'This application can be run in various modes for development, testing, and production. '
                'Use the flags below to customize behavior.\n',
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    parser.add_argument('--vcan', action='store_true', help='Simulate CAN-Bus')
    parser.add_argument('--vlin', action='store_true', help='Simulate LIN-Bus')
    parser.add_argument('--vite', action='store_false', help='Start on Vite-Port 5173')
    parser.add_argument('--nokiosk', action='store_false', help='Start in windowed mode')
    parser.add_argument(
        '--window-size',
        type=parse_window_size,
        default=(1280, 720),
        metavar='WIDTHxHEIGHT',
        help='Window size used with --nokiosk (default: 1280x720)',
    )
    parser.add_argument('--dev', action='store_true', help='Development mode')

    return parser.parse_args()


def display_starting():
    dots = '.' * (int(time.monotonic() * 2) % 4)
    sys.stdout.write(f'\r\033[K  Starting V-Link{dots:<3}')
    sys.stdout.flush()


def _get_display_snapshot():
    thread_states = tuple(
        (key, isinstance(thread, threading.Thread) and thread.is_alive())
        for key, thread in shared_state.THREADS.items()
    )
    return (
        thread_states,
        shared_state.rtiStatus,
        shared_state.ignStatus.is_set(),
        tuple(_log_handler.buffer),
    )


def display_thread_states():
    global _display_initialized, _prev_display_snapshot

    snapshot = _get_display_snapshot()
    if _display_initialized and snapshot == _prev_display_snapshot:
        return
    _prev_display_snapshot = snapshot

    lines = [
        '',
        f'  The data below is updated automatically, to reflect the current state of V-Link.',
        '',
        f'  V-Link {VERSION}  |  Boosted Moose',
        f'  Device: {vlink.rpiModel} | {vlink.rpiProtocol}',
        f'  RTI: {"Up  " if shared_state.rtiStatus else "Down"}  |  IGN: {"High" if shared_state.ignStatus.is_set() else "Low "}',
        '',
        f'  {"Thread":<10}  Status',
        f'  {"─" * 10}  {"─" * 10}',
    ]

    for key, thread in shared_state.THREADS.items():
        alive = isinstance(thread, threading.Thread) and thread.is_alive()
        status = '\033[32m● running\033[0m' if alive else '\033[90m○ stopped\033[0m'
        lines.append(f'  {key.upper():<10}  {status}')

    lines.append(f'  {"─" * 25}')

    if _log_handler.buffer:
        count = len(_log_handler.buffer)
        lines.append(f'  {count} recent warning{"s" if count != 1 else ""}')
        for msg in _log_handler.buffer:
            lines.append(f'  {msg}')
    else:
        lines.append('  No recent warnings.')

    lines.append('')

    if _display_initialized:
        sys.stdout.write('\033[H')
    else:
        _display_initialized = True
        sys.stdout.write('\033[?25l')

    for line in lines:
        sys.stdout.write(f'\r\033[K{line}\n')
    sys.stdout.flush()


if __name__ == '__main__':
    shared_state.hdmi_event.set()
    clear_screen()

    args = setup_arguments()
    logger = logger(verbose=args.verbose)
    if not args.verbose:
        logging.getLogger('vlink').addHandler(_log_handler)


    vlink = VLINK()
    vlink.start_thread('server', logger)
    vlink.detect_rpi()


    # Update shared_state based on arguments
    shared_state.verbose = args.verbose
    shared_state.vCan = args.vcan
    shared_state.vLin = args.vlin
    shared_state.vite = args.vite
    shared_state.isKiosk = args.nokiosk
    shared_state.browserWindowSize = args.window_size
    shared_state.dev = args.dev

    #Set ignition signal HIGH initially
    shared_state.ignStatus.set()

    # Start frontend:
    vlink.start_thread('app', logger)

    # if(shared_state.verbose):
    #vlink.print_thread_states()

    try:
        while not vlink.exit_event.is_set():
            vlink.process_toggle_event()
            vlink.process_exit_event()
            vlink.process_restart_event()
            vlink.process_update_event()
            #vlink.process_hdmi_event() # Currently Removed

            if not shared_state.verbose:
                if _app_started:
                    display_thread_states()
                else:
                    if vlink.process_start_event():
                        _app_started = True
                        clear_screen()
                    else:
                        display_starting()
            else:
                vlink.process_start_event()

            time.sleep(.1)
    except KeyboardInterrupt:
            pass
    finally:
            sys.stdout.write('\033[?25h\n')
            print('Exiting... Please wait.\n')
            sys.stdout.flush()
            vlink.join_threads()
            logger.info('Done.')

            if shared_state.update:
                time.sleep(.5)

                #Set up update process
                current_dir = os.path.dirname(os.path.abspath(__file__))
                script_path = os.path.join(current_dir, 'Update.sh')

                # Launch updater in a new terminal window
                try:
                    logger.info('Starting update...')
                    subprocess.Popen([
                        'lxterminal',
                        f'--title=V-Link Updater',
                        '--command',
                        f"sh -c 'sh \"{script_path}\"; exec bash'"
                    ])
                except Exception as e:
                    logger.error(f'Update failed: {e}')

            sys.exit(0)
