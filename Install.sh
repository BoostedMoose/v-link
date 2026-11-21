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

# Optional: install from a local V-Link.zip instead of the latest GitHub release.
LOCAL_ZIP=${1:-}
if [[ -n "$LOCAL_ZIP" && ! -f "$LOCAL_ZIP" ]]; then
    echo "Release archive not found: $LOCAL_ZIP" >&2
    exit 1
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

# Check for a supported Raspberry Pi; the system setup uses model-specific settings.
if ! grep -qaE 'Raspberry Pi [345]' /proc/device-tree/model 2>/dev/null; then
    echo "No Raspberry Pi 3, 4 or 5 detected. The system setup will skip config.txt."
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


if [ -n "$LOCAL_ZIP" ]; then
    echo "Using local release archive: $LOCAL_ZIP"
else
    # Fetch the latest release info from GitHub
    echo "Fetching the latest release URL from GitHub..."
    LATEST_RELEASE_URL=$(curl -s https://api.github.com/repos/BoostedMoose/v-link/releases/latest | grep "browser_download_url" | grep "V-Link.zip" | cut -d '"' -f 4)

    if [ -z "$LATEST_RELEASE_URL" ]; then
        echo "Error: Could not find the latest V-Link.zip release."
        exit 1
    fi
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
    if [ -n "$LOCAL_ZIP" ]; then
        sudo cp "$LOCAL_ZIP" "$output_path/V-Link.zip"
    else
        sudo curl -L "$download_url" --output "$output_path/V-Link.zip"
    fi
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

    # Overlays, config.txt, uinput, udev and other system components
    SYSTEM_SETUP="/home/$CURRENT_USER/v-link/updater/system.py"
    if [[ -f "$SYSTEM_SETUP" ]]; then
        python3 -I "$SYSTEM_SETUP" --apply || echo -e "The system setup needs attention, see above.\n"
    else
        echo "System setup not found: $SYSTEM_SETUP. Install V-Link first."
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



# Step 6: Prompt to reboot the system
if confirm_action "Please reboot the system now to apply all changes..."; then
    setup_complete
    sudo reboot
else
    echo "Reboot was skipped. Please reboot manually to apply all changes."
    setup_complete
fi
