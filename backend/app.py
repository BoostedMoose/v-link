import threading
import time
import sys
import os
import subprocess
import signal
from .shared.shared_state import shared_state

class APPThread(threading.Thread):
    def __init__(self, logger):
        super().__init__()
        self.logger = logger

        self.url = f"http://localhost:{4001 if shared_state.vite else 5173}"
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


    def start_browser(self):
        standard_flags = [
            "--enable-experimental-web-platform-features",
            "--enable-features=SharedArrayBuffer",
            "--autoplay-policy=no-user-gesture-required",
            #"--disable-extensions",
            "--disable-logging",
            "--log-level=3"
        ]

        if shared_state.isKiosk:
            mode = [
                "--kiosk",
                "--ozone-platform=wayland",
                "--start-maximized"
            ]
        else:
            mode = [
                "--disable-resize",
                "--window-size=800,480"
            ]

        flags = standard_flags + mode

        # Final command as list
        command = ["chromium-browser", self.url] + flags

        self.browser = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,  # or subprocess.PIPE if you want logs
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL
        )
        #self.browser = subprocess.Popen(command)
        self.logger.info(f"Chromium browser started with PID: {self.browser.pid}")


    def close_browser(self):
        if self.browser:
            try:
                # First, terminate the main browser process gracefully
                self.browser.terminate()

                # Wait for the process to exit (timeout to avoid hanging)
                try:
                    self.browser.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.logger.warning("Browser did not terminate in time; killing it now.")
                    self.browser.kill()
                    self.browser.wait()

                # Then kill any remaining child processes (optional safety)
                subprocess.run(['pkill', '-P', str(self.browser.pid)], check=False)

            except Exception as e:
                self.logger.error(f"Error stopping frontend: {e}")
        else:
            self.logger.error("Chromium not found on this system.")
