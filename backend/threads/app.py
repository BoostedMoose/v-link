import threading
import time
import sys
import os
import subprocess
import signal
import shutil
import socket
from ..logger import LOG_DIR
from ..shared.shared_state import shared_state

CHROMIUM_LOG = os.path.join(LOG_DIR, 'chromium.txt')

class APPThread(threading.Thread):
    RESTART_DELAY = 5
    MAX_RESTARTS = 3
    RESTART_WINDOW = 600

    def __init__(self, logger):
        super().__init__()
        self.logger = logger

        self.url = f'http://localhost:{4001 if shared_state.vite else 5173}'
        self.browser = None
        self._stop_event = threading.Event()
        self._restarts = []
        self._monitor = True
        self._log_mode = 'w'
        self._browser_lock = threading.Lock()


    def run(self):
        self.start_browser()

        while not self._stop_event.is_set():
            # stop_thread closes the browser on purpose; only react to exits while running
            browser = self.browser
            if self._monitor and browser and browser.poll() is not None and not self._stop_event.is_set():
                self._restart_browser(browser.returncode)
            time.sleep(.1)

    def stop_thread(self):
        self._stop_event.set()
        # Wait for a restart in progress, so no new browser outlives the stop
        with self._browser_lock:
            self.close_browser()

    def _restart_browser(self, code):
        """Restart Chromium after an unexpected exit, with a limit against restart loops."""
        now = time.monotonic()
        self._restarts = [t for t in self._restarts if now - t < self.RESTART_WINDOW]

        if len(self._restarts) >= self.MAX_RESTARTS:
            self.logger.error(
                f'[Browser] Chromium exited (code {code}) after {self.MAX_RESTARTS} restarts '
                f'within {self.RESTART_WINDOW // 60} minutes, not restarting again.'
            )
            self._monitor = False
            return

        self.logger.error(f'[Browser] Chromium exited unexpectedly (code {code}), restarting in {self.RESTART_DELAY} s.')
        self._restarts.append(now)
        if self._stop_event.wait(self.RESTART_DELAY):
            return
        with self._browser_lock:
            if not self._stop_event.is_set():
                self.start_browser()

    def _remove_stale_profile_lock(self, profile_dir):
        # Chromium refuses a profile locked from another hostname, e.g. after renaming the Pi
        try:
            target = os.readlink(os.path.join(profile_dir, 'SingletonLock'))
        except OSError:
            return

        if target.rsplit('-', 1)[0] == socket.gethostname():
            return

        try:
            for name in ('SingletonLock', 'SingletonCookie', 'SingletonSocket'):
                if os.path.lexists(os.path.join(profile_dir, name)):
                    os.remove(os.path.join(profile_dir, name))
            self.logger.warning('[Browser] Removed stale Chromium profile lock from a different hostname.')
        except OSError as e:
            self.logger.error(f'[Browser] Could not remove stale Chromium profile lock: {e}')

    def _browser_executable(self):
        codename = None
        try:
            with open('/etc/os-release', encoding='utf-8') as os_release:
                for line in os_release:
                    if line.startswith('VERSION_CODENAME='):
                        codename = line.split('=', 1)[1].strip().strip('"').lower()
                        break
        except OSError as error:
            self.logger.warning(f'[Browser] Could not read /etc/os-release: {error}')

        preferred = 'chromium' if codename == 'trixie' else 'chromium-browser'
        fallback = 'chromium-browser' if preferred == 'chromium' else 'chromium'

        if shutil.which(preferred):
            return preferred
        if shutil.which(fallback):
            self.logger.warning(f'[Browser] "{preferred}" not found, using "{fallback}" instead.')
            return fallback

        return preferred


    def start_browser(self):
        profile_dir = os.path.expanduser('~/.config/v-link/chromium-profile')
        os.makedirs(profile_dir, exist_ok=True)
        self._remove_stale_profile_lock(profile_dir)

        standard_flags = [
            '--enable-experimental-web-platform-features',
            '--enable-features=SharedArrayBuffer',
            '--autoplay-policy=no-user-gesture-required',
            '--use-fake-ui-for-media-stream',
            '--disable-logging',
            '--log-level=3',
            '--disable-gpu',
            f'--user-data-dir={profile_dir}', 
            '--no-first-run',
            '--no-default-browser-check',
            '--allow-insecure-localhost',
            '--ozone-platform=wayland',
            '--unsafely-treat-insecure-origin-as-secure=http://localhost:4001,http://localhost:5173'
        ]

        if shared_state.isKiosk:
            mode = [
                '--kiosk'
            ]
        else:
            window_width, window_height = shared_state.browserWindowSize
            mode = [
                f'--window-size={window_width},{window_height}'
            ]

        flags = standard_flags + mode

        # Final command as list
        command = [self._browser_executable(), self.url] + flags

        # Overwrite the log once per V-Link start, append on restarts
        try:
            browser_log = open(CHROMIUM_LOG, self._log_mode)
            self._log_mode = 'a'
        except OSError as e:
            self.logger.warning(f'[Browser] Could not open Chromium log: {e}')
            browser_log = subprocess.DEVNULL

        try:
            self.browser = subprocess.Popen(
                command,
                start_new_session=True,
                stdout=browser_log,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL
            )
        finally:
            if browser_log is not subprocess.DEVNULL:
                browser_log.close()
        #self.browser = subprocess.Popen(command)
        self.logger.info(f'[Browser] Chromium browser started with PID: "{self.browser.pid}"')


    def close_browser(self):
        if self.browser:
            try:
                # Chromium has its own process group. Target that group so USB
                # utility processes cannot outlive the browser during restart.
                try:
                    os.killpg(self.browser.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass

                # Wait for the process to exit (timeout to avoid hanging)
                try:
                    self.browser.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.logger.warning('[Browser] Chromium did not close in time; Trying to kill thread.')
                    try:
                        os.killpg(self.browser.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    self.browser.wait()

                # The parent may exit before its children; their process group
                # remains addressable even after they have been reparented.
                try:
                    os.killpg(self.browser.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                self.browser = None

            except Exception as e:
                self.logger.error(f'[Browser] Error stopping chromium: {e}')
        else:
            self.logger.error('[Browser] Chromium not found on this system.')
