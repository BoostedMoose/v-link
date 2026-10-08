#!/bin/bash

# V-Link Installer - https://www.github.com/BoostedMoose/v-link

# CHECK PERMISSION
if [ $EUID -ne 0 ]; then
  echo "This script must be run as root to install certain services. Please use sudo. More information can be found in the source of this installer." >&2
  exit 1
fi

if [ -z "$SUDO_USER" ]; then
    # Fallback: Get the current user
    CURRENT_USER=$(whoami)
else
    CURRENT_USER=$SUDO_USER
fi

# HELPER FUNCTIONS
confirm_action() {
    while true; do
        read -p "$1 (y/n): " choice
        case "$choice" in 
            y|Y ) return 0;;
            n|N ) return 1;;
            * ) echo "Invalid input. Please enter 'y' or 'n'.";;
        esac
    done
}

prompt_bitrate() {
    local variable_name="$1"
    local interface_name="$2"
    local default_bitrate="$3"
    local bitrate

    while true; do
        read -r -p "Enter BitRate for $interface_name [default: $default_bitrate]: " bitrate
        bitrate=${bitrate:-$default_bitrate}

        if [[ "$bitrate" =~ ^[0-9]{1,7}$ ]] &&
           (( 10#$bitrate >= 1 && 10#$bitrate <= 1000000 )); then
            printf -v "$variable_name" '%s' "$bitrate"
            return 0
        fi

        echo "Invalid BitRate. Enter a whole number from 1 to 1000000 (bit/s)."
    done
}

fix_ownership() {
    sudo chown -R "$CURRENT_USER:$CURRENT_USER" "$1"
}

user_exit() {
    echo "Aborted by user. Exiting."
    exit 1
}

setup_complete() {
    echo ""
    echo "Setup complete. Drive carefully :)"
    echo ""
}

# SETUP
echo "Installing V-Link"

# Determine Raspberry Pi Version
if [ -f /proc/device-tree/model ]; then
    # Read the content of the model file, stripping any null bytes with `strings`
    model=$(strings /proc/device-tree/model)

    # Loop through the Raspberry Pi models we want to detect
    rpiModel=""
    for i in 3 4 5; do
        if [[ "$model" == *"Raspberry Pi $i"* ]]; then
            echo "Raspberry Pi $i detected."
            rpiModel=$i
            break
        fi
    done

    # Default to Raspberry Pi 4 if no match found and rpiModel is unset
    if [ -z "$rpiModel" ]; then
        echo "Device not recognized, using config for Raspberry Pi 4."
        if ! confirm_action "proceed anyways"; then
            user_exit
        else
            rpiModel=4
        fi
    fi
else
    echo "Not running on a Raspberry Pi or file at /proc/device-tree/model not found."
    if ! confirm_action "proceed anyways"; then
        user_exit
    fi
fi


# Step 1: Update System
if confirm_action "Do you want to update the system? (Recommended)"; then
    sudo apt-get update -y && sudo apt-get upgrade -y
fi


# Step 2: Install python
if ! command -v python &>/dev/null; then
    sudo apt-get install -y python3
    sudo apt-get install -y python3-pip
fi


# Fetch the latest release info from GitHub
echo "Fetching the latest release URL from GitHub..."
LATEST_RELEASE_URL=$(curl -s https://api.github.com/repos/BoostedMoose/v-link/releases/latest | grep "browser_download_url" | grep "V-Link.zip" | cut -d '"' -f 4)

if [ -z "$LATEST_RELEASE_URL" ]; then
    echo "Error: Could not find the latest V-Link.zip release."
    exit 1
fi


# Step 3: Install Volvo V-Link
if confirm_action "Do you want to install Boosted Moose V-Link?"; then
    # Step 4.1: Install dependencies
    sudo apt-get install -y ffmpeg libudev-dev libusb-dev build-essential python3-venv

    # Step 4.4: Download the file
    download_url=$LATEST_RELEASE_URL
    output_path="/home/$CURRENT_USER/v-link"
    echo "Downloading files to: $output_path"
    sudo mkdir -p "$output_path"
    sudo curl -L "$download_url" --output "$output_path/V-Link.zip"
    fix_ownership "$output_path"

    # Step 4.5: Unzip the contents
    echo "Unzipping the contents..."
    sudo -u "$CURRENT_USER" unzip "$output_path/V-Link.zip" -d "$output_path"

    # Step 4.6: Setup virtual environment
    cd "$output_path"
    if [ -d "venv" ]; then
        echo "Virtual environment already exists."
        source venv/bin/activate
    else
        echo "Creating virtual environment..."
        sudo -u "$CURRENT_USER" python3 -m venv venv
        source venv/bin/activate
    fi

    # Step 4.7: Install requirements
    requirements="$output_path/requirements.txt"
    if [ -f "$requirements" ]; then
        echo "Installing requirements..."
        pip install -r "$requirements"
    else
        echo "Requirements file not found: $requirements"
    fi

    echo -e "\nV-Link installation completed.\n"
    fix_ownership "$output_path"
else
    if confirm_action "do you want to abort the installation"; then
        user_exit
    fi
fi


# Step 4: Configure Raspberry Pi
echo "Do you want to continue with the software configuration of the Raspberry Pi?"
if confirm_action "You can skip this step if you ran the installer before and the Pi is configured."; then

    # Download overlays
    echo "Download custom DeviceTree overlays, required for the V-Link HAT"
    OVERLAY_DIR="/boot/firmware/overlays"

    
    sudo wget -O "$OVERLAY_DIR/v-link.dtbo" \
        https://github.com/BoostedMoose/v-link/raw/master/resources/dtoverlays/v-link.dtbo
    sudo wget -O "$OVERLAY_DIR/mcp2515-can1.dtbo" \
        https://github.com/BoostedMoose/v-link/raw/master/resources/dtoverlays/mcp2515-can1.dtbo
    sudo wget -O "$OVERLAY_DIR/mcp2515-can2.dtbo" \
        https://github.com/BoostedMoose/v-link/raw/master/resources/dtoverlays/mcp2515-can2.dtbo


    # Renaming pwrkey service so ign logic works:
    echo "Renaming /etc/xdg/autostart/pwrkey.desktop to pwrkey.desktop.backup"
    sudo mv /etc/xdg/autostart/pwrkey.desktop /etc/xdg/autostart/pwrkey.desktop.backup

    CONFIG_PATH="/boot/firmware/config.txt"

    # Check if V-LINK block exists
    if grep -q '^\[V-LINK' "$CONFIG_PATH"; then
        if confirm_action "V-LINK config block already exists in $CONFIG_PATH. Overwrite it?"; then
            sudo sed -i '/^\[V-LINK/,/disable_splash=1/d' "$CONFIG_PATH"
        else
            echo "Skipped updating $CONFIG_PATH."
            SKIP_CONFIG=true
        fi
    fi

    if [[ "$SKIP_CONFIG" != true ]]; then
        # Append the correct config block based on rpiModel (your existing code)
        if [[ "$rpiModel" -eq 5 ]]; then
            sudo bash -c 'cat >> /boot/firmware/config.txt <<EOF
[V-LINK RPi5]

#Enable GPIO 0&1
disable_poe_fan=1
force_eeprom_read=0

#Enable devicetree overlays
dtparam=spi=on
dtparam=i2c_arm=on

dtoverlay=v-link
dtparam=uart0=on
dtoverlay=uart2-pi5
dtoverlay=mcp2515-can1,oscillator=16000000,interrupt=24
dtoverlay=mcp2515-can2,oscillator=16000000,interrupt=22

#Configure IGN logic
dtoverlay=gpio-poweroff,gpiopin=0

#No Splash on boot
disable_splash=1
EOF'

        elif [[ "$rpiModel" -eq 4 ]]; then
            sudo bash -c 'cat >> /boot/firmware/config.txt <<EOF
[V-LINK RPi4]

#Enable GPIO 0&1
disable_poe_fan=1
force_eeprom_read=0

#Enable devicetree overlays
dtparam=spi=on
enable_uart=1
dtparam=i2c_arm=on

dtoverlay=v-link
dtoverlay=uart3
dtoverlay=mcp2515-can1,oscillator=16000000,interrupt=24
dtoverlay=mcp2515-can2,oscillator=16000000,interrupt=22

#Configure IGN logic
dtoverlay=gpio-poweroff,gpiopin=0

#No Splash on boot
disable_splash=1
EOF'

        else
            sudo bash -c 'cat >> /boot/firmware/config.txt <<EOF
[V-LINK RPi3]

#Enable GPIO 0&1
disable_poe_fan=1
force_eeprom_read=0

#Enable devicetree overlays
dtparam=spi=on
enable_uart=1
dtparam=i2c_arm=on

dtoverlay=v-link
dtoverlay=uart3
dtoverlay=mcp2515-can1,oscillator=16000000,interrupt=24
dtoverlay=mcp2515-can2,oscillator=16000000,interrupt=22

#Configure IGN logic
dtoverlay=pi3-disable-bt
dtoverlay=gpio-poweroff,gpiopin=0

#No Splash on boot
disable_splash=1
EOF'
        fi
    fi


    # Setting up systemd-networkd
    echo "Creating systemd-networkd configuration files for can1 and can2..."

    # Info about config verify
    echo ""
    echo "------------------------------------------------------------------"
    echo "NOTE: After the first V-Link launch and profile selection, verify"
    echo "that these CAN bitrates match /home/$CURRENT_USER/.config/v-link/can.json."
    echo "That file does not exist before the first launch."
    echo "------------------------------------------------------------------"
    echo ""

    # CAN1 configuration
    prompt_bitrate CAN1_BITRATE can1 125000

    if [[ ! -f /etc/systemd/network/can1.network ]] || confirm_action "can1.network exists. Overwrite it?"; then
        sudo tee /etc/systemd/network/can1.network > /dev/null <<EOF
[Match]
Name=can1

[CAN]
BitRate=$CAN1_BITRATE

[Network]
# raw CAN
EOF
        echo "Configured can1.network with BitRate=$CAN1_BITRATE"
    else
        echo "Skipped overwriting can1.network"
    fi

    # CAN2 configuration
    prompt_bitrate CAN2_BITRATE can2 500000

    if [[ ! -f /etc/systemd/network/can2.network ]] || confirm_action "can2.network exists. Overwrite it?"; then
        sudo tee /etc/systemd/network/can2.network > /dev/null <<EOF
[Match]
Name=can2

[CAN]
BitRate=$CAN2_BITRATE

[Network]
# raw CAN
EOF
        echo "Configured can2.network with BitRate=$CAN2_BITRATE"
    else
        echo "Skipped overwriting can2.network"
    fi

    # Enable and restart systemd-networkd
    sudo systemctl enable systemd-networkd
    echo "Systemd-networkd now manages can1 and can2 automatically at boot."


    # Load uinput kernel module at boot
    echo "Creating /etc/modules-load.d/uinput.conf..."
    UINPUT_CONF="/etc/modules-load.d/uinput.conf"

    if [[ -f "$UINPUT_CONF" ]]; then
        if confirm_action "$UINPUT_CONF exists. Overwrite it?"; then
            echo "uinput" | sudo tee "$UINPUT_CONF" > /dev/null
        else
            echo "Skipped overwriting $UINPUT_CONF."
        fi
    else
        echo "uinput" | sudo tee "$UINPUT_CONF" > /dev/null
    fi

    if [[ $? -eq 0 ]]; then
        echo -e "uinput module will now be auto-loaded at boot.\n"
    else
        echo -e "Failed to create $UINPUT_CONF.\n"
    fi



    echo "Creating combined udev rule"
    RULE_FILE=/etc/udev/rules.d/42-v-link.rules

    if [[ ! -f "$RULE_FILE" ]] || confirm_action "$RULE_FILE exists. Overwrite it?"; then
        {
            echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="1314", ATTR{idProduct}=="152*", MODE="0660", GROUP="plugdev"'
            echo 'SUBSYSTEM=="net", ACTION=="add", KERNELS=="spi0.1", NAME="can1"'
            echo 'SUBSYSTEM=="net", ACTION=="add", KERNELS=="spi0.2", NAME="can2"'
            echo 'KERNEL=="ttyS0", MODE="0660", GROUP="plugdev"'
            echo 'KERNEL=="uinput", MODE="0660", GROUP="plugdev"'
        } | sudo tee "$RULE_FILE" > /dev/null && echo -e "Permissions created\n" || echo -e "Unable to create permissions\n"
    else
        echo "Skipped creating $RULE_FILE."
    fi
fi

# Step 5: Create autostart file for V-Link
if confirm_action "Do you want to create an autostart file for V-Link?"; then
    AUTOSTART_FILE="/etc/xdg/autostart/v-link.desktop"
    output_path="/home/$CURRENT_USER/v-link"

    if [[ ! -f "$AUTOSTART_FILE" ]] || confirm_action "$AUTOSTART_FILE exists. Overwrite it?"; then
        sudo bash -c "cat > $AUTOSTART_FILE <<EOL
[Desktop Entry]
Name=V-Link
Exec=sh -c 'python ~/v-link/V-Link.py'
Type=Application
EOL"
        echo "Autostart file created or overwritten."
    else
        echo "Skipped creating autostart file."
    fi
fi



# Step 6: Remove logo and cursor on boot
if confirm_action "Do you want to remove the boot logo?"; then
    FILE="/boot/firmware/cmdline.txt"
    APPEND_TEXT="logo.nologo vt.global_cursor_default=0"

    if [[ ! -f "$FILE" ]]; then
        echo "Error: File $FILE does not exist."
        exit 1
    fi

    if grep -qF -- "$APPEND_TEXT" "$FILE"; then
        echo "Entries already present in $FILE."
    else
        sudo sed -i "1{s/$/ $APPEND_TEXT/}" "$FILE"
        echo "Appended entries to $FILE."
    fi
fi



# Step 7: Prompt to reboot the system
if confirm_action "Please reboot the system now to apply all changes..."; then
    setup_complete
    sudo reboot
else
    echo "Reboot was skipped. Please reboot manually to apply all changes."
    setup_complete
fi
