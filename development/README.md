# Development tools

Run these commands from the repository root. The Python tools resolve the checkout relative to their own location, so they also work from another working directory. These helpers require Python 3.10 or newer.

## Sync the backend to a Pi

Use this manually when your Python changes are ready to test:

```bash
python3 development/sync-backend.py pi-user@pi-host
```

Replace the SSH destination with your Pi username and hostname or an existing SSH config alias. The default destination is `~/v-link`; use `--remote-dir /path/to/v-link` for another installation.

The helper checks local Python syntax, syncs the sources, checks syntax using the Pi's virtual environment, and asks the running app to restart through its existing Socket.IO handler. It uses one SSH connection for the transfers and restart. The frontend reverse SSH tunnel can remain running independently.

Requirements:

- `ssh` and `rsync` on the development computer; `rsync` and Python 3 on the Pi.
- An existing V-Link installation with `venv/bin/python` and its runtime dependencies.
- For automatic restart, V-Link must already be running on the Pi on port 4001. This is checked before transferring files. Start it with `--vite` in a Pi desktop terminal when using the frontend reverse tunnel; the restart preserves its launch flags and desktop environment.

To preview changes or sync without restarting:

```bash
python3 development/sync-backend.py pi-user@pi-host --dry-run
python3 development/sync-backend.py pi-user@pi-host --no-restart
```

If the app is stopped, use `--no-restart` to sync and validate the sources, then start it from a Pi desktop terminal with `python3 V-Link.py --vite`. The helper's restart action controls an existing process; it does not launch a new desktop session over SSH.

The sync mirrors `backend/` and `updater/`, including removal of files deleted locally. It also copies `V-Link.py`, `requirements.txt`, `frontend/package.json` (the backend's version metadata), and the VCAN simulation files from `development/`. Other files in the Pi's `development/` folder are preserved. Use a Pi development checkout: local source changes replace the corresponding Pi files. Your Pi settings in `~/.config/v-link/`, virtual environment, frontend build, and logs are outside the mirrored directories. Changes to default configuration files do not automatically replace existing saved settings, although the app's normal settings migration still runs on restart.

If `requirements.txt` differs, the helper copies it and prints the Pi dependency installation command instead of restarting. Run that command before rerunning the sync. Subsequent syncs compare file contents, not installed package versions; installing dependencies remains a manual step.

A failed transfer or syntax check prevents the restart request. Transfers are not a transaction across all directories, so correct the error and rerun if a sync stops partway through. A restart also restarts Chromium and the CarPlay session; check the Pi terminal for runtime startup errors.

## Desktop interface preview

```bash
python3 development/vlink-preview.py
```

Install the frontend dependencies in `frontend/` first. The `--install` or `--ci` flags can install missing dependencies after confirmation. The preview opens `http://localhost:5173/vlink-preview.html` without starting the Python backend. It provides the interface and default settings, rather than live vehicle hardware or backend settings persistence.

## Create release assets

```bash
./development/Package.sh
```

Run from a clean, committed checkout matching the release tag. Output remains in the repository's `dist/` directory: `Install.sh`, `Uninstall.sh`, `Update.sh`, and `V-Link.zip`. The development utilities are not included in the release ZIP. The hardware test remains at the repository root and is included in releases. See the repository README for the release process.

## Diagnostics

- [`../Hardware-Test.py`](../Hardware-Test.py): available in both source checkouts and installed releases. Run on the Pi with `venv/bin/python Hardware-Test.py`. Requires the hardware libraries and directly exercises CAN, LIN, RTI, ADC, fan, and ignition interfaces; stop V-Link before using it.
- `plotter.py`: plot exported sensor JSON with `python3 development/plotter.py path/to/data.json`. Requires `matplotlib` and `pandas` in your Python environment.
- `lin_test.txt`: sample LIN data for development.

## Virtual CAN simulation

The VCAN simulator is in `development/vcan.py`, with interface setup in `development/setup-vcan.sh`. On a Pi development checkout, start it through the app:

```bash
venv/bin/python V-Link.py --vite --vcan
```

The app imports the simulator only when `--vcan` is enabled. Its setup script uses `sudo` to prepare the `vcan0` interface and load the `vcan` and `uinput` modules. The sync helper copies these files to the Pi automatically. Release ZIPs omit the development folder; use a source checkout for simulation.

## Tests

Python tests remain in `tests/`, and frontend tests remain alongside the frontend code. Install Python test dependencies into the repository's virtual environment:

```bash
python3 -m venv venv
venv/bin/python -m pip install -r development/requirements-test.txt
venv/bin/python -m pytest
```

The GitHub Actions workflow uses the same test requirements path. Run the frontend tests from `frontend/` with `npm test`.
