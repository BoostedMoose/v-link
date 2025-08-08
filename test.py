import can

def main():
    # Use the correct interface and channel (adjust if needed)
    bus = can.interface.Bus(bustype='socketcan', channel='can2', bitrate=500000)

    # Set filter for extended ID 0x00400021
    filters = [{"can_id": 0x00400021, "can_mask": 0x1FFFFFFF, "extended": True},
               {"can_id": 0x00400022, "can_mask": 0x1FFFFFFF, "extended": True}]
    bus.set_filters(filters)

    print("Listening for CAN ID 0x00400021...")

    # Loop to read messages
    while True:
        msg = bus.recv()
        if msg:
            print(f"Received message: ID=0x{msg.arbitration_id:X}, Data={msg.data.hex()}")

if __name__ == "__main__":
    main()
