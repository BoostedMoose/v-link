from __future__ import annotations

import threading
import time
import logging
import lgpio

import atexit
from typing import Optional

from ..shared.gpio import open_gpiochip
from ..shared.shared_state import shared_state




class CAMThread(threading.Thread):
    def __init__(self, logger: logging.Logger = None, line=20, chip=None, active_high=True, poll_ms=50, debounce_ms=120):
        super().__init__(name="REVERSEThread")
        self.logger = logger or logging.getLogger("vlink")
        self._stop_event = threading.Event()

        self.line = line            # Gpio reverse gear input
        self.chip_id = chip
        self.active_high = active_high
        self.dt = poll_ms / 1000.0

        # Debounce
        self._debounce_s = debounce_ms / 1000.0
        self._last_change_ts = 0.0
        self._candidate_state = None   

        self._prev = None

        self._requested_chip = chip
        self._chip: Optional[int] = None
        self._claimed = False

        self.daemon = True

    def stop_thread(self):
        # The run method releases GPIO after its loop exits.
        self._stop_event.set()

    def _initialize_gpio(self):
        self._chip, self.chip_id = open_gpiochip(self._requested_chip)
        try:
            lgpio.gpio_claim_input(self._chip, self.line)
            self._claimed = True
        except Exception:
            lgpio.gpiochip_close(self._chip)
            self._chip = None
            raise

        self.logger.info("Reverse input: using gpiochip%s line %s", self.chip_id, self.line)

    def _release_gpio(self):
        if self._chip is None:
            return

        try:
            if self._claimed:
                lgpio.gpio_free(self._chip, self.line)
        except lgpio.error as e:
            self.logger.error(f"[Reverse] Could not release GPIO (chip={self.chip_id}, line={self.line}): {e}")
        finally:
            try:
                lgpio.gpiochip_close(self._chip)
            except lgpio.error as e:
                self.logger.error(f"[Reverse] Could not close gpiochip{self.chip_id}: {e}")
            self._chip = None
            self._claimed = False


    def _read_active(self) -> bool:
        v = lgpio.gpio_read(self._chip, self.line)
        raw = bool(v)
        return raw if self.active_high else (not raw)

    def run(self):
        try:
            self._initialize_gpio()
        except Exception as e:
            requested_chip = self.chip_id if self.chip_id is not None else "auto"
            shared_state.reverseStatus.clear()
            self.logger.error(
                "Reverse init error (chip=%s, line=%s): %s. Reverse input disabled.",
                requested_chip,
                self.line,
                e,
            )
            return

        self.logger.info("Reverse thread: started (chip=%s, line=%s)", self.chip_id, self.line)

        # Reading initial state
        try:
            current = self._read_active()
        except Exception as e:
            self.logger.error("Reverse first read error: %s", e)
            current = False

        # Set initial state
        if current:
            shared_state.reverseStatus.set()
            self.logger.debug("Reverse ON (initial)")
        else:
            shared_state.reverseStatus.clear()
            self.logger.debug("Reverse OFF (initial)")

        self._prev = current
        self._candidate_state = current
        self._last_change_ts = time.monotonic()

        while not self._stop_event.is_set():
            try:
                on = self._read_active()

                # Debounce
                now = time.monotonic()
                if on != self._candidate_state:
                    self._candidate_state = on
                    self._last_change_ts = now
                else:
                    if (now - self._last_change_ts) >= self._debounce_s:
                        if on != self._prev:
                            if on:
                                # Reverse ON
                                shared_state.reverseStatus.set()
                                self.logger.debug("Reverse ON")
                            else:
                                # Reverse OFF
                                shared_state.reverseStatus.clear()
                                self.logger.debug("Reverse OFF")
                            self._prev = on

                time.sleep(self.dt)

            except lgpio.error as e:
                self.logger.warning("Reverse GPIO read error: %s", e)
                time.sleep(0.2)
            except Exception as e:
                self.logger.warning("Reverse loop error: %s", e)
                time.sleep(0.2)

        self._release_gpio()







try:
    import lgpio  # type: ignore
    LGPIO_AVAILABLE = True
    _LGPIO_IMPORT_ERROR: Optional[BaseException] = None
except Exception as e:  # ImportError or similar
    LGPIO_AVAILABLE = False
    _LGPIO_IMPORT_ERROR = e


class CameraGPIO:
    # GPIO driver to power camera on/off.
    # - line: BCM line number (e.g. 18)
    # - chip: optional gpiochip override (auto-detected by default)
    # - active_high: True if high level = ON (inverted if False)

    # Methods:
    # - set(on: bool)   -> power on/off
    # - get() -> bool   -> last requested logical state (not physical read)
    # - toggle() -> bool
    # - level() -> int  -> current electrical level (0/1) if readable
    # - cleanup()       -> power off and release resources



    def __init__(self, line: int = 26, chip: Optional[int] = None, active_high: bool = True, logger: Optional[logging.Logger] = None):
        self.logger = logger or logging.getLogger("vlink")
        self.line = int(line)
        self._requested_chip = chip
        self._chip_num: Optional[int] = None
        self.active_high = bool(active_high)

        self._chip: Optional[int] = None         # handle dev /dev/gpiochipN
        self._claimed: bool = False              # if line is claimed as output
        self._lock = threading.RLock()
        self._on: bool = False                   # logic state as requested

        # cleanup request at exit
        atexit.register(self._safe_cleanup)

        requested_chip = chip if chip is not None else "auto"
        self.logger.debug(f"CameraGPIO init: line={self.line}, chip={requested_chip}, active_high={self.active_high}")

    def _require_lgpio(self) -> None:
        if not LGPIO_AVAILABLE:
            raise RuntimeError(
                f"lgpio not available: {_LGPIO_IMPORT_ERROR!r}. "
                "Install 'lgpio' or run on compatible hardware."
            )

    def _open_chip(self) -> None:
        if self._chip is None:
            self._require_lgpio()
            try:
                self._chip, self._chip_num = open_gpiochip(self._requested_chip)
                self.logger.debug(f"CameraGPIO: opened gpiochip{self._chip_num}")
            except Exception as e:
                # disgnostic info
                raise RuntimeError(f"not able to open camera GPIO controller: {e}") from e

    def _ensure_claimed(self) -> None:
        if not self._claimed:
            self._require_lgpio()
            try:
                # claim as output, initial LOW
                lgpio.gpio_claim_output(self._chip, self.line, 0)  # type: ignore[arg-type]
                self._claimed = True
                self.logger.debug(f"CameraGPIO: {self.line} output (LOW)")
            except Exception as e:
                raise RuntimeError(f"not able to claim GPIO{self.line} as output: {e}") from e

    def _write_level(self, level: int) -> None:
        self._require_lgpio()
        try:
            lgpio.gpio_write(self._chip, self.line, int(level))  # type: ignore[arg-type]
        except Exception as e:
            raise RuntimeError(f"Failed writing level {level} on BCM{self.line}: {e}") from e

   
    def set(self, on: bool) -> None:
        # On (True) or off (False) camera.
        with self._lock:
            self._open_chip()
            self._ensure_claimed()
            desired = bool(on)
            level = 1 if (desired == self.active_high) else 0
            self._write_level(level)
            self._on = desired
            self.logger.info(f"CameraGPIO: {'ON' if desired else 'OFF'} (physical level={level})")

    def get(self) -> bool:
        #returs the last logical state requested (not physical reading).
        return self._on

    def toggle(self) -> bool:
        #Invert the current state and return the new logical state.
        with self._lock:
            self.set(not self._on)
            return self._on

    def level(self) -> int:
        
        self._open_chip()
        self._require_lgpio()
        try:
            if not self._claimed:
                return 1 if (self._on == self.active_high) else 0
            val = lgpio.gpio_read(self._chip, self.line)  # type: ignore[arg-type]
            return int(val)
        except Exception:
            
            return 1 if (self._on == self.active_high) else 0

    def cleanup(self) -> None:
        
        with self._lock:
            try:
                if self._claimed and LGPIO_AVAILABLE:
                    off_level = 1 if (False == self.active_high) else 0
                    try:
                        self._write_level(off_level)
                    finally:
                        self._on = False
                        self._claimed = False
                if self._chip is not None and LGPIO_AVAILABLE:
                    try:
                        lgpio.gpiochip_close(self._chip)  # type: ignore[arg-type]
                    finally:
                        self._chip = None
                self.logger.info("CameraGPIO: cleanup OK")
            except Exception as e:
                self.logger.error(f"CameraGPIO: cleanup error: {e}")

    
    def _safe_cleanup(self) -> None:
        try:
            self.cleanup()
        except Exception:
            pass

    def __repr__(self) -> str:  # debug
        chip = self._chip_num if self._chip_num is not None else "auto"
        return (f"<CameraGPIO line=BCM{self.line} chip={chip} "
                f"active_high={self.active_high} on={self._on}>")
