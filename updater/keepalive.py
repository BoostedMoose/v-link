"""Send the RTI keep-alive while the main application is stopped."""

import time

try:
    import serial

    with open("/proc/device-tree/model", encoding="utf-8") as model_file:
        model = model_file.read()
    port = next((port for name, port in (("Raspberry Pi 5", "/dev/ttyAMA2"),
                                        ("Raspberry Pi 4", "/dev/ttyAMA3"),
                                        ("Raspberry Pi 3", "/dev/ttyS0")) if name in model), None)
    if port:
        while True:
            try:
                with serial.Serial(port, 2400, timeout=1) as connection:
                    connection.write(bytes((0x40, 0x20, 0x83)))
            except (OSError, serial.SerialException):
                pass
            time.sleep(1)
except (ImportError, OSError):
    pass
