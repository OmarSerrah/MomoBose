# MomoBose

[![Build](https://github.com/OmarSerrah/MomoBose/actions/workflows/build.yml/badge.svg)](https://github.com/OmarSerrah/MomoBose/actions/workflows/build.yml)
[![Version](https://img.shields.io/badge/version-0.1.11-blue)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

MomoBose is a desktop companion for Bose QuietComfort 45 headphones and Apple AirPods. It provides quick controls from the macOS menu bar or Windows system tray, plus a full desktop window. The app runs locally and stores preferences on your computer.

> The Windows control is a system tray flyout. On macOS it is a menu bar popover.

## Why use MomoBose

- View headphone battery and connection/audio status.
- Control QC45 Quiet/Aware mode, three-band EQ, multipoint, self voice, and volume.
- Connect or switch between paired devices and manage QC45 multipoint sources.
- Control AirPods connection and volume; macOS also shows left, right, and case battery levels when available.
- Choose light, dark, or system appearance, and optionally reconnect after interruptions or launch at login.
- No account, cloud service, analytics, or firmware changes.

AirPods ANC, Adaptive Audio, Spatial Audio, Find My, and Apple account switching remain in Apple system controls. Windows can connect recognizable AirPods names, but exact identification of renamed models and per-ear/case battery readings are macOS-only. Windows runtime behavior should be checked on physical hardware.

## Screenshots

| Desktop window | Menu bar / system tray widget |
| --- | --- |
| ![MomoBose Bose QC45 desktop controls](docs/screenshots/volume-light-main.png) | ![MomoBose Bose QC45 compact widget](docs/screenshots/volume-light-widget.png) |

## Get started

### Install a release

Download the installer or archive for your operating system from [GitHub Releases](https://github.com/OmarSerrah/MomoBose/releases). Pair your headphones in macOS Bluetooth settings or Windows Bluetooth settings before opening MomoBose. MomoBose does not perform initial Bluetooth pairing.

### Run from source

Requirements:

- Node.js 22.12 or newer and npm.
- macOS 12 or newer with Apple Command Line Tools (`xcode-select --install`), or Windows 10/11 with the .NET 8 SDK.
- A paired Bose QC45 or supported AirPods for hardware use. The demo runs without Bluetooth hardware.

```sh
git clone https://github.com/OmarSerrah/MomoBose.git
cd MomoBose
npm ci
npm run build:native
npm run build
npm start
```

During development, start the Vite and Electron processes with:

```sh
npm run dev
```

The browser preview does not access Bluetooth. To explore simulated controls, use either:

```sh
npm run demo                  # Electron desktop demo
npm run dev:ui                # then open http://127.0.0.1:5173/?demo=1
```

Add `&widget=1` to the browser demo URL to view its compact layout. The demo is explicitly simulated and does not send Bluetooth commands.

### Build installers

```sh
npm run dist:mac   # run on macOS; DMG and ZIP for the current architecture
npm run dist:win   # run on Windows; installer and ZIP
```

## Help and documentation

- Check [VALIDATION.md](VALIDATION.md) for platform checks, known limitations, and hardware validation status.
- Check [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for artwork and dependency notices.
- For bugs or setup questions, open a [GitHub issue](https://github.com/OmarSerrah/MomoBose/issues) and include your OS version, app version, and the steps to reproduce. Do not include Bluetooth addresses or other private device information.

## Contributing and maintenance

MomoBose is maintained by **Momo**. Contributions are welcome. Before opening a pull request:

1. Open an issue to discuss larger changes, especially changes to device protocol behavior.
2. Keep platform-specific native code and shared UI/state logic in their existing areas (`native/`, `electron/`, and `src/`).
3. Run the checks and build:

   ```sh
   npm run typecheck
   npm test
   npm run build
   ```

4. Describe the change, platforms affected, and any hardware validation performed. Automated protocol tests do not confirm behavior on a physical headset; state clearly when hardware checks have not been done.

The project uses the [MIT License](LICENSE). See [docs/artwork.md](docs/artwork.md) for asset guidance.
