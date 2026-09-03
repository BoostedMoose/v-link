#!/usr/bin/env python3
"""Run the standalone V-Link interface preview.

This launcher starts Vite's development server and opens the special
``vlink-preview.html`` entry point. That entry point loads the application
settings directly from ``backend/config/app.json`` and initializes the
frontend state in the browser, so the Python/Flask backend does not need to
be running.

Its purpose is to make the V-Link graphical interface available on a desktop
computer for development, visual inspection, and interaction without needing
the target V-Link hardware or its backend services. Google Chrome is the
recommended browser for opening the local web server because the interface
uses modern browser features and Chrome provides the most consistent preview
and development experience.

What this preview provides:
    * The real V-Link React interface and styling.
    * Settings loaded from the repository's app.json file.
    * Responsive resizing in a normal desktop browser.

What it does not provide:
    * Live CAN, ADC, SWC, RTI, ignition, camera, or vehicle data.
    * A Socket.IO connection to the backend on port 4001.
    * Persistence for changes that normally require the backend.
    * Real hardware integration.

Usage from the project root:
    python3 vlink-preview.py

Press Ctrl+C in the terminal to stop the Vite server.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
PREVIEW_URL = "http://localhost:5173/vlink-preview.html"


def main(args: argparse.Namespace) -> int:
    """Validate the local setup and run Vite until the user stops it.

    If the frontend dependencies are missing the launcher can optionally
    install them when invoked with `--install` or `--ci`.
    """

    # Resolve every path relative to this script instead of the current
    # working directory. This makes the launcher usable from any directory.
    package_json = FRONTEND_DIR / "package.json"
    if not package_json.is_file():
        print(
            "Error: the frontend project could not be found.\n"
            f"Expected file: {package_json}",
            file=sys.stderr,
        )
        return 1

    # npm is used because the Vite version required by this project is a
    # local frontend dependency declared in package.json.
    npm = shutil.which("npm")
    if npm is None:
        print(
            "Error: npm is not installed or is not available in PATH.\n"
            "Install Node.js (which includes npm), then run this file again.",
            file=sys.stderr,
        )
        return 1

    # If the frontend dependencies are missing offer to install them when the
    # user requested it via command-line flags. By default do not modify
    # repository files automatically — explicit action is required.
    node_modules_dir = FRONTEND_DIR / "node_modules"
    if not node_modules_dir.is_dir():
        if args.install or args.ci:
            # Ask user for confirmation before modifying the workspace.
            prompt = (
                "Frontend dependencies are missing. Install now? [y/N]: "
            )
            try:
                answer = input(prompt).strip().lower()
            except EOFError:
                print("No input available; aborting installation.", file=sys.stderr)
                return 1

            if answer not in ("y", "yes"):
                print("Installation aborted by user.")
                return 1

            install_cmd = [
                shutil.which("npm") or "npm",
                "ci" if args.ci else "install",
                "--prefix",
                str(FRONTEND_DIR),
            ]
            print("Installing frontend dependencies...")
            try:
                subprocess.check_call(install_cmd)
            except subprocess.CalledProcessError as error:
                print(
                    f"Failed to install frontend dependencies: {error}",
                    file=sys.stderr,
                )
                return 1
        else:
            print(
                "Error: the frontend dependencies have not been installed.\n"
                f"Run this command first:\n  npm install --prefix {FRONTEND_DIR}\n\n"
                "Or re-run this script with `--install` to install them automatically,\n"
                "or `--ci` to run a clean CI-style install.",
                file=sys.stderr,
            )
            return 1

    # --strictPort prevents Vite from silently selecting a different port.
    # --open selects the backend-free HTML entry point instead of index.html.
    command = [
        npm,
        "run",
        "vite",
        "--",
        "--host",
        "localhost",
        "--port",
        "5173",
        "--strictPort",
        "--open",
        "/vlink-preview.html",
    ]

    print("Starting the standalone V-Link interface preview...")
    print("The Python/Flask backend will not be started or contacted.")
    print("This server lets you use and inspect the V-Link graphical interface")
    print("on a desktop computer without connecting the V-Link hardware.")
    print(f"Preview URL: {PREVIEW_URL}")
    print("Your default browser should open automatically.")
    print("Google Chrome is the recommended browser for this preview.")
    print("If Chrome is not your default browser, copy the URL above into Chrome.")
    print("Press Ctrl+C in this terminal to stop the server.\n")

    try:
        # Keep Vite attached to this process so its output remains visible and
        # Ctrl+C can stop the development server normally.
        return subprocess.call(command, cwd=FRONTEND_DIR)
    except KeyboardInterrupt:
        print("\nThe V-Link preview server has been stopped.")
        return 0
    except OSError as error:
        print(f"Vite could not be started: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        prog="vlink-preview.py",
        description=(
            "Start the standalone V-Link frontend preview. Use --install to "
            "automatically install frontend dependencies if they are missing."
        ),
    )
    parser.add_argument(
        "--install",
        action="store_true",
        help="Run `npm install --prefix frontend` if node_modules is missing",
    )
    parser.add_argument(
        "--ci",
        action="store_true",
        help="Run `npm ci --prefix frontend` (clean install) if node_modules is missing",
    )

    args = parser.parse_args()
    raise SystemExit(main(args))
