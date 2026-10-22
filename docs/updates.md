# Releases and updates

MomoBose uses electron-builder 26 and electron-updater 6 with the public
`OmarSerrah/MomoBose` GitHub Releases feed. No user token or update server is
needed. Update IPC accepts only fixed actions; the main process owns the feed,
download URLs, and installation. The updater checks release versions and
validates downloaded installers against the manifest's SHA-512 checksum.

Installed Windows NSIS builds download updates automatically. The presence of
`Uninstall MomoBose.exe` beside the executable distinguishes an installed copy
from an unpacked ZIP. The installer is launched only by **Restart to Update**;
automatic installation on ordinary quit is disabled. Confirmed updates run the
installer silently and reopen the app. The app allows windows to
close and stops its Bluetooth helper during the normal quit sequence. Failed
checks/downloads show a retry action and never offer installation. If launching
the installer fails, the app resumes normal operation.

macOS builds and unpacked Windows copies check the same release feed, with
automatic downloads disabled, and open the release download page when requested.
macOS builds are currently ad-hoc signed. Enabling macOS self-installation later
requires Developer ID Application signing, notarized release artifacts, and
changing the macOS mode in `electron/updates.ts` only after testing signed builds.
The first signed build must be installed manually by existing unsigned users.

## Publish a release

1. Update `package.json` and `package-lock.json` with
   `npm version X.Y.Z --no-git-tag-version`, and update the README version badge.
2. Run `npm run typecheck`, `npm test`, and `npm run build`.
3. Commit and push the changes; create and push the matching `vX.Y.Z` tag.
4. The tag workflow tests the app and builds macOS/Windows x64/ARM64 artifacts.
   The release job validates all four manifests and their referenced files before
   uploading installers, archives, manifests, and blockmaps to a draft GitHub
   release. The release is published only after every asset has uploaded.

Use electron-builder's generated artifact names unchanged. They include version,
platform, and architecture, so they do not collide. Each architecture has its own
channel (`latest-x64` or `latest-arm64`), expanded by electron-builder from
`latest-${arch}`. Windows reads `latest-x64.yml` / `latest-arm64.yml`; macOS reads
`latest-x64-mac.yml` / `latest-arm64-mac.yml`. This avoids merging manifests from
separate matrix jobs or pointing an ARM install at an Intel installer.

`scripts/prepare-release.mjs` rejects missing/duplicate assets, mismatched
versions, architecture/platform mistakes, and installer checksum/size mismatches.
Do not rename files after building, edit checksums by hand, publish drafts to
users, or reuse a version number. Stable installs ignore prereleases and
downgrades. If asset uploading fails, keep the release as a draft until it has
been repaired and validated.

## Validate two packaged versions

Automated tests cover update state transitions, concurrent checks, download and
installer failures, manual fallback, startup/periodic scheduling, cleanup, UI
actions, and release asset integrity. These do not prove an OS installer can
replace a running app.

Before calling Windows self-updates verified on hardware:

1. Install the older updater-enabled version through NSIS on Windows x64 and
   ARM64. Change an appearance preference and keep the app running in its tray.
2. Publish a higher version with all four feed manifests. Check from the menu and
   Preferences; confirm the correct architecture downloads and reports progress.
3. Test an offline check and an interrupted/failed download. Confirm the app
   remains usable, retries work, and **Restart to Update** appears only after a
   complete verified download.
4. Select **Restart to Update**. Confirm both main/window and tray copies quit,
   the native Bluetooth helper exits, the installer completes, the app reopens
   at the new version, and the preference is retained. Repeat from hidden startup.
5. Confirm a normal quit does not launch the installer, and a failed installer
   launch restores the app instead of leaving it in a quitting state.
6. On macOS and a Windows ZIP copy, confirm a newer version offers **Download
   Update** and opens GitHub Releases without attempting replacement. Confirm a
   demo or development session makes no release requests.

Reference: [electron-builder 26 auto-update guide](https://www.electron.build/v26/docs/features/auto-update/).
