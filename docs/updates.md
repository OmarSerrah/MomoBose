# Releases and updates

MomoBose uses electron-builder 26, `electron-updater` 6 on Windows, and Sparkle
2 on macOS. Both use public GitHub Releases; no update server or user token is
needed. Update IPC accepts only fixed actions; the main process owns the feed,
download URLs, and installation. The updater checks release versions and
validates Windows downloads against the manifest's SHA-512 checksum. Sparkle
verifies the feed and Mac update ZIPs with the app's Ed25519 public key before
extracting updates.

Installed Windows NSIS builds download updates automatically. The presence of
`Uninstall MomoBose.exe` beside the executable distinguishes an installed copy
from an unpacked ZIP. The installer is launched only by **Restart to Update**;
automatic installation on ordinary quit is disabled. Confirmed updates run the
installer silently and reopen the app. The app allows windows to
close and stops its Bluetooth helper during the normal quit sequence. Failed
checks/downloads show a retry action and never offer installation. If launching
the installer fails, the app resumes normal operation.

macOS builds use Sparkle's native update dialog. Downloads are not automatic;
Sparkle asks before installation and restarts MomoBose when the user confirms.
The **Download Manually** action opens GitHub Releases as a fallback. The app is
ad-hoc signed, which keeps the release process free but means macOS may show
approval prompts. Apple Developer ID signing and notarization remain optional
and are separate from Sparkle's Ed25519 archive verification. The first
Sparkle-enabled release must be installed manually by existing users because
their current build has no Sparkle updater.

The public Sparkle key is embedded in the app. Its private half must stay out of
the repository and app bundle. It is generated once and stored in the
maintainer's Keychain; the release workflow reads it from the
`SPARKLE_EDDSA_PRIVATE_KEY` secret in the protected GitHub `release` environment.
The environment requires maintainer approval for version tags. If the secret is
absent, the workflow stops before publishing a release. To create and provision a key:

1. Generate a key on a trusted Mac with `npx electron-sparkle generate-keys`.
   The generated public key must match `SUPublicEDKey` in `package.json`.
2. Export the private key to a protected file using Sparkle's `generate_keys
   -x <path>` option, then set the Actions secret with
   `gh secret set SPARKLE_EDDSA_PRIVATE_KEY --env release < <path>`. Keep the file
   outside the repository and remove it after securely backing it up.
3. Keep the public key stable for future releases. Rotating it requires a
   planned migration so installed apps can trust the replacement key.

## Publish a release

1. Update `package.json` and `package-lock.json` with
   `npm version X.Y.Z --no-git-tag-version`, and update the README version badge.
2. Run `npm run typecheck`, `npm test`, and `npm run build`.
3. Commit and push the changes; create and push the matching `vX.Y.Z` tag.
4. The tag workflow tests the app and builds macOS/Windows x64/ARM64 artifacts.
   The tag must point to main's history; existing release tags cannot be moved
   or deleted. Approve the protected `release` environment after reviewing the
   tagged commit. The signing job validates all four manifests, signs the two
   Mac ZIPs, and signs `appcast.xml` with an immutable URL for each architecture.
   A separate publishing job uploads installers, archives, manifests, blockmaps, and the appcast to a
   draft GitHub release. The release is published only after every asset has
   uploaded and the Ed25519 signatures have validated.

Use electron-builder's generated artifact names unchanged. They include version,
platform, and architecture, so they do not collide. Each architecture has its own
channel (`latest-x64` or `latest-arm64`), expanded by electron-builder from
`latest-${arch}`. Windows reads `latest-x64.yml` / `latest-arm64.yml`; macOS reads
`latest-x64-mac.yml` / `latest-arm64-mac.yml`. This avoids merging manifests from
separate matrix jobs or pointing an ARM install at an Intel installer.

`scripts/prepare-release.mjs` rejects missing/duplicate assets, mismatched
versions, architecture/platform mistakes, and installer checksum/size mismatches.
`scripts/prepare-sparkle-feed.mjs` requires the private-key secret and verifies
the feed's exact signed bytes and each ZIP against the embedded public key,
requiring x64 and arm64 archives with immutable GitHub release URLs, correct
versions, sizes and hardware metadata. Sparkle's official `sign_update` tool is
used for both archives and the feed. The ARM item is first so native Apple
silicon builds take priority over Intel-compatible builds at the same version.
See [release security](security-release.md) for environment and packaging details.
Do not rename files after building, edit checksums by hand, publish drafts to
users, or reuse a version number. Stable installs ignore prereleases and
downgrades. If asset uploading fails, keep the release as a draft until it has
been repaired and validated.

## Validate two packaged versions

Automated tests cover update state transitions, concurrent checks, download and
installer failures, manual fallback, Sparkle event mapping and appcast validation,
startup/periodic scheduling, cleanup, UI actions, and release asset integrity.
These do not prove an OS installer can replace a running app.

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
6. On a Windows ZIP copy, confirm a newer version offers **Download
   Update** and opens GitHub Releases without attempting replacement. Confirm a
   demo or development session makes no release requests.

Before calling Sparkle updates verified on hardware:

1. Install the Sparkle-enabled build manually on macOS x64 and arm64.
2. Publish a higher version with the signed appcast and both ZIP archives.
3. Check for updates, accept the native Sparkle prompt, and confirm the app
   replaces itself and reopens at the new version.
4. Confirm a repeat check reports no update. Test offline checks, invalid archive
   signatures, and the **Download Manually** fallback.
5. Confirm macOS approval prompts on the ad-hoc build and document the initial
   Gatekeeper steps for users.

## Run isolated macOS upgrade checks

On a trusted Mac with Node, Git and the Xcode command-line tools:

```sh
node scripts/prepare-sparkle-test-tools.mjs
npm run package:mac
node scripts/test-mac-upgrade.mjs --arch=arm64
```

Use the architecture built by `package:mac`. The last command opens a disposable
**MomoBose Upgrade Test** app. Accept **Install Update**, then **Install and
Relaunch**. Dismiss the final up-to-date dialog if it is displayed. The script
checks version replacement, relaunch, preference retention and old-process
cleanup. It never modifies the regular installed app or its profile.

Automatic checks can also run without Accessibility access:

```sh
node scripts/test-mac-upgrade.mjs --arch=arm64 --headless
node scripts/test-mac-upgrade.mjs --arch=arm64 --scenario=offline
node scripts/test-mac-upgrade.mjs --arch=arm64 --scenario=bad-feed
node scripts/test-mac-upgrade.mjs --arch=arm64 --headless --scenario=bad-archive
```

`--headless` uses the official Sparkle CLI compiled from the pinned upstream
source, so it exercises the installer without testing native button clicks.
Offline and bad-feed scenarios use the app's native background updater. The
fixtures use a disposable key, signed loopback feed and a harmless Bluetooth
helper process. The helper preserves child-process lifecycle checks without
accessing headphones. Report paths are printed; temporary fixture bundles and
logs are retained for inspection. Run interactive checks one at a time.

To prepare the Intel fixture from an Apple silicon Mac, build the x64 helper with
`MOMOBOSE_TARGET_ARCH=x64 npm run build:native`, then run
`node scripts/package-mac.mjs --dir --x64` and use `--arch=x64` above. This executes
through Rosetta and does not establish compatibility on physical Intel hardware.

Reference: [electron-builder 26 auto-update guide](https://www.electron.build/v26/docs/features/auto-update/).
