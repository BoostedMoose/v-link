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

In **Settings → System → Update**, choose **Stable** or **Prerelease**, then select a release. Prereleases are grouped by branch and show a seven-character commit hash. Older releases are available in the same list for downgrades. If GitHub is unavailable while browsing releases or starting an update, the picker offers Retry and the app keeps running. Once an update starts, the app closes while the updater downloads and checks the archive, installs Python requirements, replaces the app files, and reboots. If the download or archive check then fails, the installed app files are kept; the app stays stopped so you can inspect the error in the updater terminal.

The standalone updater is also available on the Pi:

```sh
sh ~/v-link/Update.sh
```

It lists published releases with a `V-Link.zip` asset and prompts for a release number. This remains available after downgrading to a release that predates the in-app picker. On installations made before the updater was included in the ZIP, install a new release package once to get the standalone updater.

### Creating releases

`frontend/package.json` is the source of the app version. The UI and Python app read it, and the release ZIP includes it. To set a version, run `npm version 3.2.0 --no-git-tag-version` from `frontend/`; this also updates `frontend/package-lock.json`. Use a prerelease version such as `3.2.0-beta.1` when appropriate. The root `package.json` is a separate Node package. The packager checks that the frontend package and lockfile versions match.

Commit all source changes and run `./Package.sh` from the exact commit you will tag. Upload the four files in `dist/` as separate GitHub release assets: `Install.sh`, `Uninstall.sh`, `Update.sh`, and `V-Link.zip`. The packager refuses a dirty checkout. The ZIP contains the app and its updater; the installer and uninstaller are separate downloads. The standalone `Update.sh` asset is a launcher for an existing installation that also contains `updater/`. The installer currently installs the latest stable release by default, even if downloaded from a prerelease page. The package contains a commit manifest; the updater checks that its hash matches the release tag before installing. Mark a prerelease with GitHub's **Set as a pre-release** option. When creating its tag in GitHub, choose the source branch in **Target**. For an existing tag, put `V-Link-Branch: dev` (or another branch name, such as `factory-screen`) on its own line in the release notes; a tag like `dev/v3.2.0-beta.1` also identifies the branch. This keeps prereleases from different branches separate in the picker.

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
