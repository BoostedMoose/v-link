#!/bin/bash

# V-Link Uninstaller - https://www.github.com/BoostedMoose/v-link

# Function to prompt the user for confirmation
confirm_action() {
    while true; do
        read -p "Do you want to $1? (y/n): " choice
        case "$choice" in 
            y|Y ) return 0;;
            n|N ) return 1;;
            * ) echo "Invalid input. Please enter 'y' or 'n'.";;
        esac
    done
}

user_exit() {
    echo "Aborted by user. Exiting."
    exit 1
}

# Function to remove a file or directory if it exists
remove_if_exists() {
    if [ -e "$1" ]; then
        echo "Removing: $1"
        sudo rm -rf "$1"
    else
        echo "$1 not found, skipping."
    fi
}

echo "Uninstalling V-Link"
sudo -v  # This will prompt the user for their password upfront

# Step 1: Remove application files
if confirm_action "remove all application files"; then
    remove_if_exists "/home/$USER/v-link"
fi

# Step 2: Remove v-link.dtbo, mcp2515-can1, and mcp2515-can2 from /boot/firmware/overlays
if confirm_action "remove entries from /boot/firmware/overlays"; then
    remove_if_exists "/boot/firmware/overlays/v-link.dtbo"
    remove_if_exists "/boot/firmware/overlays/mcp2515-can1.dtbo"
    remove_if_exists "/boot/firmware/overlays/mcp2515-can2.dtbo"
fi

# Step 3: Remove v-link.desktop from /etc/xdg/autostart
if confirm_action "remove entries from /etc/xdg/autostart"; then
    remove_if_exists "/etc/xdg/autostart/v-link.desktop"
fi

# Step 4: Remove v-link.service from /etc/systemd/system
if confirm_action "remove entries from /etc/systemd/system"; then
    remove_if_exists "/etc/systemd/system/v-link.service"
fi

# Step 5: Remove v-link.service from /etc/systemd/system
if confirm_action "remove rules from /etc/udev/rules.d/"; then
    remove_if_exists "/etc/udev/rules.d/42-v-link.rules"
fi

# Step 6: Remove v-link rule from /etc/sudoers.d/
if confirm_action "remove rules from /etc/sudoers.d/"; then
    remove_if_exists "/etc/sudoers.d/v-link"
fi

# Step 7: Remove settings from ~/.config
if confirm_action "remove all user settings from ~/.config"; then
    remove_if_exists "/home/$USER/.config/v-link"
fi

# Step 8: Remove logo and cursor on boot
if confirm_action "revert boot changes (remove no-logo and cursor hiding)"; then    
    sudo sed -i '1{s/ logo.nologo vt.global_cursor_default=0//}' /boot/firmware/cmdline.txt
fi

# Step 9: Remove the V-Link block from /boot/firmware/config.txt (marked block, or the older [V-LINK ... disable_splash=1 block)
if confirm_action "remove entries from /boot/firmware/config.txt"; then
    sudo mv /etc/xdg/autostart/pwrkey.desktop.backup /etc/xdg/autostart/pwrkey.desktop
    if grep -q '^# >>> V-Link' /boot/firmware/config.txt && grep -q '^# <<< V-Link' /boot/firmware/config.txt; then
        sudo sed -i '/^# >>> V-Link/,/^# <<< V-Link/d' /boot/firmware/config.txt
    fi
    sudo sed -i '/\[V-LINK/,/disable_splash=1/d' /boot/firmware/config.txt
fi

echo "Uninstall complete."
