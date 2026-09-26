# Welcome to the Boosted Moose V-Link project!

![TITLE IMAGE](resources/media/banner.jpg?raw=true "Banner")

### Let's face it. MMIs from the 2000s suck.

This project was started because no suitable aftermarket solution could be found. I wanted to implement live vehicle data as well as AndroidAuto/Apple CarPlay in an **OEM like fashion** to enhance the driving experience of retro cars and give the user the ability to tinker around.

The heart of this project is the open source **V-Link app**. It's running natively on Raspberry Pi OS which enables full support of an OS without the restrictions of 3rd party images. **The custom V-Link HAT** builds the bridge between the Raspberry Pi and the car and works plug and play with the app. To use this application you need a Raspberry Pi, the V-Link Hat (optional) and an HDMI-screen, preferably with touch support.


 *This project is in ongoing development. Feel free to fork it, create a new branch and open a pull request with your cool ideas. Do you have  any tips for improvement, need help or just want to be part of our awesome little community?*

* [Swedespeed Forum](https://www.swedespeed.com/threads/volvo-rtvi-raspberry-media-can-interface.658254/)
* [V-Link Discord Server](https://discord.gg/V4RQG6p8vM)
* [Documentation](https://www.boostedmoose.de/docs)

# Installation

## Updating and downgrading

On Desktop, **Settings → System → Update** can install or downgrade to published releases. Prereleases are grouped by branch and show a seven-character commit hash. If GitHub is unavailable while browsing releases or starting an update, the picker offers Retry and the app keeps running. Once an update starts, the app closes while the updater downloads and checks the archive, installs Python requirements, replaces the app files, and reboots. If the download or archive check then fails, the installed app files are kept; the app stays stopped so you can inspect the error in the updater terminal.

The standalone updater is also available on the Pi:

```sh
sh ~/v-link/Update.sh
```

It lists published releases with a `V-Link.zip` asset and prompts for a release number. This remains available after downgrading to a release that predates the in-app picker. On installations made before the updater was included in the ZIP, install a new release package once to get the standalone updater. Both update paths are temporarily blocked when `.v-link-lite-runtime` marks a Lite installation; use `Install-Lite.sh` to reinstall or upgrade Lite until transactional platform migration is implemented.

### Creating releases

`frontend/package.json` is the source of the app version. The UI and Python app read it, and the release ZIP includes it. To set a version, run `npm version 3.2.0 --no-git-tag-version` from `frontend/`; this also updates `frontend/package-lock.json`. Use a prerelease version such as `3.2.0-beta.1` when appropriate. The root `package.json` is a separate Node package. The packager checks that the frontend package and lockfile versions match.

Commit all source changes and run `./Package.sh` from the exact commit you will tag. Upload every generated file in `dist/`: `Install.sh`, `Install-Lite.sh`, `Uninstall.sh`, `Update.sh`, `V-Link.zip`, and `V-Link.zip.sha256`. The packager refuses a dirty checkout. The single `V-Link.zip` contains the Desktop application plus the versioned Lite payload; V-Link Lite is not a separate release and there is no `V-Link-Lite.zip`. The installers and standalone updater are separate launchers. The package contains a commit manifest and payload schema; the updater checks that its commit matches the release tag before installing. Mark a prerelease with GitHub's **Set as a pre-release** option. When creating its tag in GitHub, choose the source branch in **Target**. For an existing tag, put `V-Link-Branch: dev` (or another branch name, such as `factory-screen`) on its own line in the release notes; a tag like `dev/v3.2.0-beta.1` also identifies the branch. This keeps prereleases from different branches separate in the picker.

Updates do not run `Patch.sh` automatically. A release that requires system configuration changes should include explicit migration instructions in its release notes.

### > System Requirements:
```
Raspberry Pi 3/4/5
Raspberry Pi OS 12 (Bookworm)
```

For the best user experience a RPi 4 or 5 is recommended.

---

### > Run the App:

When using the Installer everything is being set up automatically. More information can be found in the Wiki.

```
#Download and Install
wget -q $(curl -s https://api.github.com/repos/BoostedMoose/v-link/releases/latest | grep -oP '"browser_download_url": "\K[^"]*Install.sh')
sudo chmod +x Install.sh
sudo ./Install.sh

#Test Hardware (Requires V-Link HAT)
python /home/$USER/v-link/HWT.py

#Execute
python /home/$USER/v-link/V-Link.py

#Advanced Options:
python /home/$USER/v-link/V-Link.py -h
```

### Raspberry Pi OS Lite (Bookworm)

The Lite installer adds a minimal Wayland session, Chromium kiosk, mouse/touch
input, PipeWire audio and optional V-Link HAT support. It targets Raspberry Pi
OS **Bookworm Lite** on Pi 3, 4 or 5.

The official non-interactive installation uses the latest stable release from
`BoostedMoose/v-link`:

```sh
curl -fLO https://github.com/BoostedMoose/v-link/releases/latest/download/Install-Lite.sh
chmod +x Install-Lite.sh
sudo ./Install-Lite.sh --yes
```

An official branch or tag can be selected explicitly:

```sh
sudo ./Install-Lite.sh --repo BoostedMoose/v-link --ref dev --yes
```

For development, the same installer can use the fork directly:

```sh
sudo ./Install-Lite.sh \
  --repo PabloMartin97/v-link \
  --ref Lite-os-for-pr \
  --yes
```

`--no-hardware` is independent of repository and source selection:

```sh
sudo ./Install-Lite.sh \
  --repo PabloMartin97/v-link \
  --ref Lite-os-for-pr \
  --no-hardware \
  --yes
```

Branch and tag installations build the frontend on the Pi and are therefore
slower. An explicit `--source-dir` keeps a local Git checkout intact and deploys
the kiosk to `~/v-link-runtime`. Use `--no-reboot` to inspect the result before
the first reboot. See every option with `./Install-Lite.sh --help`.

On macOS, `lite/Prepare-V-Link-SD.command` prepares an already-flashed card.
Its terminal selector defaults to `PabloMartin97/v-link` at `Lite-os-for-pr`
during development and also offers `BoostedMoose/v-link` at `dev`. The same
choice can be supplied directly:

```sh
./lite/Prepare-V-Link-SD.command \
  --repo BoostedMoose/v-link \
  --ref dev
```

Prepare SD resolves the selected ref once, downloads its installer and
bootstrap from that commit, and carries the same repository/ref into first boot.

After reboot, validate the complete installation:

```sh
sudo "$HOME/v-link/Check-Lite.sh" --user "$(id -un)"
journalctl --user -u v-link.service -b --no-pager
wpctl status
speaker-test -c 2 -t wav
```

At startup, press **S** during the three-second V-Link Lite screen to open
Setup before V-Link starts. The persistent terminal menu is available later from
a local terminal or SSH (`ssh -t user@host v-link-lite-setup`). It provides
network (`nmtui`), audio, display and USB status, diagnostics, and V-Link
service controls. Closing Setup with “Continue to V-Link” resumes normal
startup; opening it manually does not stop a running V-Link service.
Lite renders the existing V-Link logos on a black boot splash, uses the same
branding for the Settings gate, and keeps a matching Wayland background until
Chromium shows its own splash. The firmware rainbow is disabled; the earliest
custom image is enabled when Raspberry Pi OS provides its splash-support tool.
The Wayland background and GTK cover use the same native-resolution PNG without
scaling. Lite regenerates it only when the effective display dimensions change,
including after a fixed resolution is selected in Setup.
On the tested labwc 0.8.4 / wlroots 0.18.2 combination, removing a layer-shell
splash over fullscreen Chromium can expose a transient white frame. The Lite
session applies `WLR_SCENE_DISABLE_VISIBILITY=1` as a targeted workaround before
labwc starts; setting it from labwc's own environment configuration would be too
late because wlroots is already running by then.
`Display / Input` offers cursor Auto (hidden at start and again after five
seconds idle) or Visible, plus a separate mouse Activated/Deactivated switch.
Deactivated ignores mouse and touchpad input but leaves touch and keyboard
available; verify that your touchscreen is detected as touch input before using
it. Deactivated also hides the pointer even when cursor mode is Visible.
Preferences live in `~/.config/v-link-lite/settings.conf` and survive a
reinstall. Mouse-input changes take effect on the next graphical boot.
`Diagnostics -> System details` shows CPU, memory, temperature, storage and Pi
power status. `V-Link -> Console` shows live read-only service status; Logs
remain separate.

On a Pi 3, the HAT setup assigns the good PL011 UART to RTI and disables the
integrated Bluetooth controller. HDMI, analog and USB audio remain available;
Bluetooth requires a USB adapter. Simultaneous RTI plus the LIN steering-wheel
profile (P1/T5) also needs an external USB-UART on Pi 3. Give the installer its
stable device path, for example `sudo ./Install-Lite.sh --lin-port
/dev/serial/by-id/usb-YOUR_ADAPTER --yes`. The CAN steering-wheel profiles do
not have that UART conflict.

## Wiki

Detailed instructions on all the functions and features can be found in the [Documentation](https://www.boostedmoose.de/docs) of this repository. In there you will find schematics, instructions to set up the HAT or your custom circuit and more. Definitely check it out!

## Disclaimer

The use of this soft- and hardware is at your own risk. The author and distributor of this project is not responsible for any damage, personal injury, or any other loss resulting from the use or misuse of the setup described in this repository. By using this setup, you agree to accept full responsibility for any consequences that arise from its use. It’s DIY after all!


#### The project is inspired by the following repositories:

* [volvo-can-gauge](https://github.com/Alfaa123/Volvo-CAN-Gauge)
* [react-carplay](https://github.com/rhysmorgan134/react-carplay)
* [volvo-crankshaft](https://github.com/laurynas/volvo_crankshaft)
* [volve](https://github.com/LuukEsselbrugge/Volve)
* [volvo-vida](https://github.com/Tigo2000/Volvo-VIDA)

#### Want to join development, got any tips for improvement or need help?  

* [Swedespeed Forum](https://www.swedespeed.com/threads/volvo-rtvi-raspberry-media-can-interface.658254/)
* [V-Link Discord Server](https://discord.gg/V4RQG6p8vM)



## Want to support us?

In the Wiki you can find a guide to set everything up.
If you want to help, you can leave a tip through the buttons below.

Your support is highly appreciated :)

| [![Buy Me A Coffee](https://cdn.buymeacoffee.com/buttons/default-orange.png)](https://www.buymeacoffee.com/lrymnd)  | [![Buy Me A Coffee](https://cdn.buymeacoffee.com/buttons/default-orange.png)](https://www.buymeacoffee.com/tigo) |
|---|---|
| <center>(Louis)</center> | <center>(Tigo)</center> |
