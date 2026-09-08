import threading
import time
import sys
import os
import subprocess
import signal
import shutil
from ..shared.shared_state import shared_state

class APPThread(threading.Thread):
    def __init__(self, logger):
        super().__init__()
        self.logger = logger

        self.url = f'http://localhost:{4001 if shared_state.vite else 5173}'
        self.browser = None
        self._stop_event = threading.Event()


    def run(self):
        self.start_browser()

        while not self._stop_event.is_set():
            if(shared_state.toggle_app.is_set()):
                self.stop_thread()
            time.sleep(.1)

    def stop_thread(self):
        self._stop_event.set()
        self.close_browser()
        shared_state.toggle_app.clear()

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
                '--kiosk',
                '--start-maximized'
            ]
        else:
            mode = [
                '--disable-resize',
                '--window-size=1280,720'
            ]

        flags = standard_flags + mode

        # Final command as list
        command = [self._browser_executable(), self.url] + flags

        self.browser = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,  # or subprocess.PIPE if you want logs
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL
        )
        #self.browser = subprocess.Popen(command)
        self.logger.info(f'[Browser] Chromium browser started with PID: "{self.browser.pid}"')


    def close_browser(self):
        if self.browser:
            try:
                # First, terminate the main browser process gracefully
                self.browser.terminate()

                # Wait for the process to exit (timeout to avoid hanging)
                try:
                    self.browser.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.logger.warning('[Browser] Chromium did not close in time; Trying to kill thread.')
                    self.browser.kill()
                    self.browser.wait()

                # Then kill any remaining child processes (optional safety)
                subprocess.run(['pkill', '-P', str(self.browser.pid)], check=False)

            except Exception as e:
                self.logger.error(f'[Browser] Error stopping chromium: {e}')
        else:
            self.logger.error('[Browser] Chromium not found on this system.')
