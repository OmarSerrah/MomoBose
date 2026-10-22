# MomoBose 0.1.14 — Sparkle two-version upgrade validation

Checked on 2026-10-22 using disposable copies of the packaged application on an
Apple silicon Mac. The real updater, renderer IPC, native Sparkle framework,
installation and app lifecycle were exercised with free ad-hoc signatures and
Hardened Runtime. Test versions 0.1.13 and 0.1.14 are fixture versions only.

- **Native ARM UI:** the maintainer accepted Sparkle's Install Update and Install
  and Relaunch buttons. The installed test bundle was replaced, version 0.1.14
  opened, dark appearance and tray-battery preferences were retained, and the
  old app and helper processes exited. A repeat native check reported no update.
- **Intel build under Rosetta:** the official Sparkle CLI downloaded, verified,
  installed and relaunched the x64 test app at 0.1.14. Preferences were retained,
  old app/helper processes exited, and a subsequent CLI probe reported no update.
- **Rejection/fallback:** the native background updater rejected a modified
  signed feed and an HTTP 503 response. The official installer rejected a
  same-length corrupted ZIP with Sparkle error 4005 before replacement. In each
  case the old app remained usable with its preferences and manual-release
  fallback. Interactive error dialogs require dismissal; unattended error tests
  use background checks and CLI probes instead.
- **Remote CI:** [workflow run 39830496430](https://github.com/OmarSerrah/MomoBose/actions/runs/39830496430)
  passed tests, production builds, .NET checks, and packaging for macOS arm64/x64
  and Windows arm64/x64. It ran source snapshot
  `bd741ab5307c4a3355be8c2e0d0956d61688489c` on
  `test/sparkle-upgrade-validation-20261022`. The production updater, packaging,
  dependency and workflow files in this checkout match that snapshot. No tag,
  release or PR was created; signing and publishing jobs were skipped.

Five successful case reports and event logs are saved locally under
`release/upgrade-validation/`, indexed by `manifest.json`. A final independent
review found no concrete false-success condition in those passes. Expected
renderer teardown during quit is excluded from future fixture error logs.

The fixture adds an observation entrypoint, unique bundle ID, isolated profile,
disposable Ed25519 key and local feed. Its Bluetooth child process returns an
empty device list to avoid interacting with headphones; this does not validate
Bluetooth reconnection after updating. Manual fallback URLs are logged without
opening a browser. The regular installation and user preferences are untouched.
Actual Intel hardware, Windows installer upgrades, fresh Gatekeeper/quarantine
prompts and the protected tag signing/publishing jobs remain unverified. The
Rosetta check is not a physical Intel check. Existing users must manually install
their first Sparkle-enabled release. Reproduction steps are in
[the updater guide](docs/updates.md#run-isolated-macos-upgrade-checks).

# MomoBose 0.1.14 — Sparkle security fixes

Checked on 2026-10-22 on Apple silicon macOS. These changes retain free ad-hoc
signing and require no Apple Developer certificate or notarization.

- All 215 Vitest tests pass, along with type checking and the production build.
  The feed tests use real Ed25519 keys and cover modified signed bytes, same-size
  archive tampering, wrong keys, malformed XML, duplicate attributes, namespace
  substitutions, exact URLs/versions/lengths, hardware metadata and item ordering.
  Mac-only tests run the official signer with a disposable key over stdin.
- `npm audit` reports zero vulnerabilities. All 396 audited packages have
  verified registry signatures; 97 have verified attestations. The exact
  `electron-sparkle` version and its upstream Sparkle archive provenance were
  checked; `global-agent` 4.1.3 replaces its vulnerable older dependency chain.
- Both Intel and ARM Mac apps passed strict deep `codesign` verification and
  Sparkle's doctor check. Both architectures produced DMG/ZIP archives using
  ad-hoc signatures with Hardened Runtime enabled. Packaging checks executable,
  helper and bridge architecture; bundle versions; and embedded feed/key flags.
  Signing and archiving outside Desktop resolves the Finder metadata failure.
  Both release ZIPs also passed strict signature verification after extraction.
- The actual electron-builder ZIPs were signed locally using the existing
  Keychain key. Their appcast and archive signatures verify against the public
  key embedded in MomoBose. The appcast also passed the official Sparkle
  `sign_update --verify` check. No release was published. `generate_appcast`
  rejected equal-version architecture archives, so the release script now uses
  Sparkle's documented manual appcast and `sign_update` flow, ARM item first.
- Disposable Electron app fixtures with separate bundle identifiers initialized
  the native Sparkle bridge on ARM and x64 under Rosetta. These fixtures used
  isolated local feeds and disabled automatic checks; they did not change the
  installed MomoBose app or preferences. The ARM native updater accepted the
  signed feed, selected the ARM ZIP, and rejected a modified feed. The x64
  updater under Rosetta also accepted the valid feed, selected native ARM
  for this Apple silicon Mac, and rejected the modified feed. Its first feed-check launch exceeded the initial
  30-second fixture timeout; a follow-up check completed successfully.
- GitHub API checks confirmed the protected `release` environment, required
  owner approval, tag-only deployment policy and environment-scoped signing key.
  Its repository-scoped secret copy was removed. Active rulesets make `v*` tags
  immutable and restrict their creation to administrators. Actions are pinned,
  signing and publication are separate, and only publication has contents write.
- Independent delegated reviews found no remaining concrete security issue in
  the revised signing, packaging, runtime and release workflow code.

Two-version upgrade and remote workflow results are recorded above. macOS
approval prompts remain possible for ad-hoc builds; existing users must install
the first Sparkle-enabled release manually. See
[the hardware checklist](docs/updates.md) and [release security](docs/security-release.md).

The following sections record earlier validation snapshots.

# MomoBose 0.1.13 app updates (before Sparkle)

Checked on 2026-10-22 on Apple Silicon macOS.

- All 199 Vitest tests passed, along with type checking, the production build,
  the macOS native helper build, and the .NET Windows identity/endpoint checks.
  Updater tests cover architecture feeds, startup/periodic checks, concurrent
  checks, failed downloads/installer launches, explicit installation, manual
  fallback, cleanup, IPC sender validation, and UI actions.
- macOS ARM64 DMG/ZIP and Windows x64 NSIS/ZIP cross-packaging succeeded.
  Generated feed URLs, artifact sizes, SHA-512 checksums, and blockmaps were
  checked against real artifacts. A final macOS app bundle passed deep strict
  ad-hoc signature verification and an isolated Electron smoke run: its packaged
  updater dependency loaded, the desktop/preload and widget worked, close-to-tray
  retained the app, and reopening restored the Dock. Smoke/demo update checks
  remained disabled.
- Browser fixtures verified download progress, explicit restart and manual
  download actions, Preferences placement, and absence of horizontal overflow.
  Those update readings were simulated and did not download or install software.
- macOS uses manual installation as requested; no Apple Developer signing
  credentials are configured. Windows ZIP copies also use manual installation.
  Windows replacement/restart between two installed releases remains unverified
  on physical Windows hardware. See [the updater checklist](docs/updates.md).

# Sony WH-1000XM4/XM5 implementation

Checked on 2026-10-22 on Apple Silicon macOS. Sony support is experimental:
neither model has been connected to this build for hardware validation.

The app now has a separate Sony MDR backend (v1 for XM4, v2 for XM5), native
service-based RFCOMM discovery on both platforms, and Sony controls in the
desktop window and widget/tray. Automated coverage includes independent wire
fixtures, escaping/checksums/fragmentation, capability-based controls, each
model's switch encodings, noise modes, six-value EQ, write/readback mismatches,
timeouts, live notifications, source management, and local-computer protection.
UI checks cover both models, staged EQ/ambient changes, and widget commands.
The existing Bose/AirPods regression tests continue to pass.

Local validation: all 183 Vitest tests passed. Production build/type checking and the macOS native helper
build passed; the .NET identity/endpoint regression executable passed; the
self-contained Windows x64 helper published successfully. Windows RFCOMM
service-GUID/address serialization assertions are Windows-only and remain
unexecuted locally. Native Bluetooth/audio on Windows requires hardware testing.

Both models use original transparent PNGs, bundled for offline use: XM4 is
1200 × 1200 and XM5 is 1200 × 1050. Alpha pixels outside the product and inside
the headband were checked. Browser demo checks cover artwork, light/dark
appearance, desktop and widget layouts, and horizontal overflow.

See [Sony support](docs/sony.md) for supported commands, protocol references,
name-based identification limits, self-voice limitations, and the outstanding
hardware checklist. Browser screenshots/demo readings are simulated.

# MomoBose 0.1.12 Windows startup, QC45 identity, and listening mode fixes

Checked on 2026-10-22 on Apple Silicon macOS. Windows hardware testing remains
outstanding; these changes have not been confirmed against a live Windows QC45.

- Automatic control attachment now accepts an explicitly recognized QC45 name
  without requiring a product ID. It still requires an existing OS connection
  and does not reroute audio or reconnect offline headphones when automatic
  reconnection is disabled.
- The Windows helper reads installed BTHENUM device nodes through SetupAPI,
  joins their cached hardware IDs by ContainerId, and returns vendor/product
  identity. This allows a renamed QC45 to use its bundled artwork and controls
  when Windows has cached the device ID. Missing or conflicting IDs are not
  guessed. Selected device metadata updates on subsequent discovery.
- Audio endpoints use ContainerId to match the paired headphones, with an
  unambiguous name fallback. Windows Stereo/Hands-Free suffixes are normalized.
  Active audio endpoints supplement Bluetooth's cached connection flag; drivers
  without the KS reconnect property can still expose audio status. Optional
  audio discovery failures leave the paired device list available. When both
  audio profiles are active, matching prefers the system's default output.
- Mode discovery waits up to its existing 2.5-second deadline for a complete
  Quiet/Aware profile pair. The 500-ms silence window now applies after both
  profiles arrive. Tests cover a delayed first profile and a delayed second
  profile, preserving verified slot mapping rather than guessing indices.
- TypeScript regression coverage exercises Windows startup with no product ID,
  a later hardware identity update, artwork selection, and a mode write/readback.
  The .NET regression executable checks identity joins, missing/conflicting IDs,
  both VID namespaces, endpoint suffixes, duplicate names, and container matching.
  CI runs these checks on Linux and Windows; the RFCOMM address-layout assertion
  requires Windows and is skipped locally on macOS.

Local results: all 149 Vitest tests passed; type checking and the production app
build passed; the .NET identity/endpoint regression executable passed; and the
self-contained Windows x64 and ARM64 helpers published successfully. These
cross-builds do not exercise Windows Bluetooth, COM, or SetupAPI at runtime.

Implementation references:
[Windows Bluetooth hardware IDs](https://learn.microsoft.com/en-us/windows-hardware/drivers/bluetooth/installing-a-bluetooth-device),
[device ContainerId](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/devpkey-device-containerid),
and [SetupDiGetDeviceProperty](https://learn.microsoft.com/en-us/windows/win32/api/setupapi/nf-setupapi-setupdigetdevicepropertyw).

To validate on Windows: connect the QC45 before opening MomoBose with automatic
reconnection disabled; check its artwork, audio status, and battery, then switch
Quiet/Aware in both directions in the window and tray. Repeat after renaming
the headphones. Confirm the default output and volume are preserved during
startup. Also check a pair that connects after launch and an offline saved pair.

# MomoBose 0.1.9 AirPods, automatic connection, and source management

Checked on 2026-10-22 on Apple Silicon macOS.

The final 0.1.9 app is installed and running at `/Applications/MomoBose.app`.
Its deep strict signature verification passed; the renderer and native helper
are running. The previous app is preserved at
`/tmp/momobose-before-ui-0.1.9/MomoBose.app`.

- The AirPods model catalog covers AirPods 1–5, Pro 1–3, both AirPods 4 variants,
  both AirPods 5 variants, AirPods Max Lightning/USB-C, and Max 2. Hardware IDs
  take precedence over editable names. Apple Support 109525 supplies model names;
  IDs were checked against local CoreTypes/CoreBluetoothUI asset catalogs and
  the source research linked in README. Unknown generations keep a generic
  AirPods label; known other vendors and Beats IDs are not relabeled as AirPods.
- Native read-only discovery identified four paired AirPods families on this Mac,
  including renamed sets, with vendor/product identity and transparent model
  assets from macOS CoreBluetoothUI. No serial numbers are needed or sent to the
  renderer. Missing OS assets use a neutral vector illustration.
- AirPods connection and volume use the Bluetooth audio endpoint, never Bose
  packets. AirPods-specific features open macOS's HeadphoneSettings pane when
  available, otherwise Bluetooth settings. Windows supports basic audio with
  name-based discovery, without per-ear battery or renamed-model identification.
- The macOS battery parser uses only connected entries from system_profiler.
  Left/right/case and Max readings preserve real zero values, reject malformed
  values, and remain unavailable when omitted. Disconnected cached readings are
  never presented as live. Readings refresh every 30 seconds while connected.
  Case readings are the latest levels reported by macOS, not a guarantee that
  a sleeping case has just transmitted.
- A live native Electron check automatically adopted Ghost's existing Mac link
  with autoReconnect=false, then attached Bose controls and read battery 80%,
  volume 87%, multipoint enabled, and two connected sources (one other source).
  Audio remained the same default output and volume; no sound-setting, volume,
  source connection, disconnection, or priority changes were issued.
- An earlier read-only attempt while the old app was still running timed out
  attaching controls. Audio stayed correctly available/default at 87%, with no
  stale unreachable error. After closing the old app, automatic attachment
  succeeded. This checks the separate audio/control state under both outcomes.
- Bose source management reads 4.4 connection masks and 4.5 per-MAC flags/names.
  It never treats list position as primary priority. Source changes send only
  explicit 4.1 connect / 4.2 disconnect START requests, followed by independent
  reads. Replacement confirms the old connection dropped before connecting the
  new source. No pairing-removal commands, automatic mutation retry, or implicit
  rollback are used. Unknown outcomes clear stale source snapshots.
- The local control computer is protected from remote source replacement because
  dropping its link prevents confirming/completing the operation. The UI directs
  that action to Bluetooth settings. QC45 primary routing has no verified command
  here; playback guidance follows Bose's documented pause-one/play-other flow.
  AirPods automatic switching remains an Apple setting; no fictitious remote
  source list or primary selector is shown for AirPods.

AirPods connections/volume and Bose source mutations are covered by simulated
transports; physical AirPods control/volume-button tests, QC45 source-mutation
round trips, and Windows runtime checks remain outstanding. Model catalog
coverage does not establish that every physical model/firmware has been tested.

# MomoBose 0.1.8 headphone chooser validation

Checked on 2026-10-22 on Apple Silicon macOS.

- All 54 automated tests passed. New cases cover the desktop and widget choosers,
  keyboard navigation and Escape, known unsupported models, switching directly
  from an active pair, cross-window selection updates, new output selection,
  and routing subsequent volume commands to the new headphones.
- The redundant native dropdown is replaced by a device-name button with a
  chevron. The menu keeps a checkmark and Connected label on the active pair,
  offers refresh, and remains available while connected. Selecting another QC45
  switches the control connection and attempts to select its audio output.
  Disconnected selection remains a draft until Connect is pressed.
- Known QC45s appear first without unrelated paired devices crowding the menu.
  Show other paired devices reveals unknown devices with an explicit model
  label; known unsupported models remain disabled.
- A live read-only native Electron check showed Ghost's current endpoint volume
  at 87%, with an enabled slider while Bose controls were offline. System, Light,
  and Dark each updated the renderer, native theme, and saved preferences.
  The native top-layer chooser fit within the 1040 × 780 desktop window.
- A 370 × 608 browser widget check showed the chooser while connected, with a
  checkmark and Connected label, no horizontal overflow, and a menu inside the
  viewport. This preview used simulated demo state.

- Final native demo checks confirmed the connected chooser fits both the desktop
  and widget, the preload remains isolated, and closing/reopening the window
  retains a live tray. Deep strict signature verification passed for the final
  Mac arm64 build. Version 0.1.8 was installed in `/Applications/MomoBose.app`,
  preserving preferences and the previous app under `/tmp/momobose-before-ui-0.1.8`.

Switching between two physical QC45s has not been tested; automated switching
checks use a simulated transport. Physical volume-button propagation and Windows
runtime checks remain outstanding as described below.

# MomoBose 0.1.7 volume, appearance, and tray validation

Checked on 2026-10-22 on Apple Silicon macOS.

- 48 automated tests passed, including polling external volume changes into both
  views without writeback, endpoint-only writes and independent readback, refused
  writes restoring actual readings, unavailable-output handling, shutdown races,
  volume drag commit behavior, and persistent appearance selection.
  The final UI/volume checks and close-to-tray lifecycle regression also passed.
- Native macOS helper compiled, and the Windows x64 .NET helper cross-compiled.
  TypeScript and renderer/main/preload production builds passed.
- A live read-only check identified Ghost (QC45 product ID 0x4039), matched its
  Bluetooth Core Audio output, and read volume 93% with a writable volume control.
  No physical volume changes were issued during validation.
- A real Electron check with an isolated user profile showed 93% on the enabled
  slider while the separate Bose settings connection was disconnected. Light,
  Dark, and System each updated the renderer, nativeTheme, and saved preferences
  correctly. The test profile disabled automatic reconnect and did not issue
  headphone setting or volume writes.
- Native demo smoke checks passed in explicit Light and Dark appearances, with
  an isolated preload, tray creation, and a 370 × 608 widget without horizontal
  overflow. Desktop checks at 1040 × 780 fit without scrolling; at 860 × 640,
  the footer remains visible and the controls pane scrolls. A browser keyboard
  volume adjustment committed successfully and updated the displayed percentage.
- Volume uses the matched headphone audio endpoint (Core Audio on Mac and
  IAudioEndpointVolume on Windows). It does not use an invented BMAP register or
  fall back to whichever speakers happen to be the default. Reads occur every
  500 ms and are never restored from a saved app value.
- Closing the window is intercepted and hides it while retaining the tray,
  renderer, controller, native helper, and connection. Activating the app reopens
  the same window. Explicit Quit is allowed to terminate the app and remove the
  tray. This behavior is covered by the lifecycle regression and native smoke
  close/reopen checks. The native report confirmed `windowHidden`,
  `windowRetained`, `trayAlive`, and `reopened` were all true.
- The final Mac arm64 app passed deep strict signature verification and was
  installed at `/Applications/MomoBose.app`. Preferences were preserved; earlier
  copies are retained under `/tmp/momobose-before-ui-0.1.7` and
  `/tmp/momobose-before-tray-0.1.7`.

Physical volume-button propagation on the headset and Windows audio behavior
still require a physical runtime check. The Bluetooth stack must synchronize
absolute volume; a different active multipoint source has its own volume.

# MomoBose 0.1.6 macOS design validation

Checked on 2026-10-22 on Apple Silicon macOS.

- Uses macOS system typography, semantic light/dark surfaces, grouped form
  settings, a compact segmented listening-mode selector, white switch/slider
  knobs, and a shared 4-point spacing scale. The Electron Mac window uses native
  sidebar/popover vibrancy. Guidance: Apple HIG Layout and Segmented Controls.
- Replaced the white-backed product photo with a 640 × 640 transparent RGBA QC45
  cutout. Alpha values are zero both at the outside corner and within the
  headband opening. Original source, output and exact edit prompt are recorded
  in `docs/artwork.md` and `THIRD_PARTY_NOTICES.md`.
- 40 automated tests passed. After the final control-label/slider changes, all
  nine UI/product tests passed again. TypeScript and production builds passed.
- Browser checks at minimum desktop 860 × 640 and widget 370 × 520 found no
  horizontal overflow. The desktop footer stays visible and its controls pane
  scrolls at minimum height. The compact widget fits without vertical scrolling.
- Widget mode selection updates the active mode and explanatory text. Preferences
  fits the compact window, initially focuses Close, closes with Escape, and
  returns focus to the Preferences button.
- Real Electron demo smoke checks passed separately in light and dark appearance:
  renderer loaded, preload bridge available, renderer Node access absent, tray
  created, and 370-pixel widget rendered without horizontal overflow.
- Native runtime screenshots are saved as `docs/screenshots/apple-light-main.png`,
  `apple-dark-main.png`, `apple-light-widget.png`, and `apple-dark-widget.png`.
  These show simulated device data, not live headphone readings.
- Packaged the Mac arm64 0.1.6 app outside Desktop, passed deep strict signature
  verification, installed it in `/Applications/MomoBose.app`, and retained the
  prior installed copy at `/tmp/momobose-before-ui-0.1.6/MomoBose.app`.

No headphone setting writes were made during this design work. Hardware and
Windows runtime limitations from earlier validation remain applicable.

# MomoBose 0.1.5 UI validation

Checked on 2026-10-22 on Apple Silicon macOS.

- TypeScript and production renderer/main/preload builds passed.
- 40 automated tests passed, including hardware-based artwork selection, unknown
  model fallback, preference failure visibility, EQ drafts and mode synchronization.
- Browser checks at 1040 × 780, minimum 860 × 640, and tray 370 × 608: no horizontal
  overflow. The default desktop and tray fit without vertical scrolling; smaller
  desktop panes scroll independently while the footer remains visible.
- Demo disconnect disables headphone controls, then reconnect restores them.
- Preferences uses a native modal dialog with initial focus on its close button;
  Escape closes it. Command failures are displayed inside the open dialog.
- Real Electron smoke check with an isolated temporary profile passed: renderer
  loaded, preload bridge available, renderer Node access absent, tray created,
  370-pixel widget rendered without horizontal overflow. Existing running app and
  its preferences were left in place during this check.
- The 42 KB QC45 product photograph is a local build asset, selected by product ID
  for renamed hardware. Unknown IDs do not receive QC45 imagery. Image source and
  physical-color limitation are documented in THIRD_PARTY_NOTICES.md.
- `docs/screenshots/desktop-redesign.png` and `widget-redesign.png` show the real
  Electron renderer in explicitly simulated demo mode.

The Mac arm64 0.1.5 app was packaged outside Desktop, passed deep strict code
signature verification, and replaced `/Applications/MomoBose.app`. The old app is
kept at `/tmp/momobose-before-ui-20261022/MomoBose.app`. The installed app was
reopened with ELECTRON_RUN_AS_NODE cleared, and its main process, renderer
processes, and native helper were verified running. User preferences were
preserved.

No headphone setting writes were made as part of this UI work. Hardware and
Windows runtime limitations from the previous validation still apply.

# MomoBose 0.1.10 validation

The Light and Dark app icons now have transparent margins and corners instead
of the supplied PNGs' opaque white canvas. A built-in imagegen cutout supplied
the alpha mask, cleaned to remove exterior matte; the original RGB artwork is
retained without resampling. Both variants share the same smooth mask.

Verified both masters' RGB channels against the original optimized images and
confirmed fully transparent exterior margins. All ten representations in each
ICNS retain transparent corners and opaque centers. The tray assets are unchanged.
See `assets/icon-optimization.json` for source provenance and current checks.

All 142 tests and the production build passed. Native Dock switching passed for
Light, Dark, and System. Version 0.1.10 was deep-strict signature verified,
installed at `/Applications/MomoBose.app`, and reopened with its native helper.
Its packaged masters match the corrected source PNGs. The previous app is at
`/tmp/momobose-before-ui-0.1.10/MomoBose.app`.

## Earlier 0.1.9 validation

Checked on 2026-10-22 on Apple Silicon macOS.

- Production build and TypeScript passed; all 142 tests across 11 files passed.
- Startup regressions cover adopting the actual connected default output over an
  inactive saved selection, attaching Bose controls while audio loads, and
  avoiding unsolicited reconnects or repeated failed attachment attempts.
- Live read-only startup recognized Ghost with auto-reconnect disabled: Bose
  controls connected, headphone output available/default, volume 87%, battery
  80%, multipoint enabled, two connected sources including one other computer.
  The connection manager independently read five paired sources. No volume,
  listening-mode, EQ, multipoint, or source connection writes were issued.
- Native Electron demo checks passed for preload isolation, tray creation,
  close-to-tray/reopen, and a 370px widget without horizontal overflow.
  These checks also passed in the final ad-hoc-signed packaged app. Packaged
  main-process code, icon masters, icon report, and Finder icon match the final
  build inputs byte for byte.
- Native Electron Dock checks passed for Light, Dark, and System preferences;
  each applied image matched the corresponding supplied master pixels.
- Both icon masters preserve all 4,717,548 decoded RGB bytes. Light shrank from
  1,560,994 to 1,153,720 bytes; Dark from 1,666,220 to 1,258,534 bytes. ICO frames
  and embedded ICNS PNG representations match direct Lanczos3 derivatives.
  Regeneration is byte-identical and preserves every tray asset. Native iconutil
  recognizes all ICNS sizes; its legacy small-frame extraction can alter a few
  blue-channel bytes, so pixel validation uses the embedded PNGs directly.
- macOS ARM64/Intel and Windows x64 native helper builds passed. Real Windows
  behavior and physical AirPods operation remain untested. AirPods identities,
  battery parsing, and feature gating have fixture coverage; unavailable readings
  remain unavailable. Proprietary AirPods controls open Apple's settings.
- Bose remote connect/disconnect/replacement has protocol and controller fixture
  coverage, but those mutation commands have not been exercised on hardware.
  QC45 permanent source priority is unsupported; playback handoff uses pause/play.
  AirPods automatic switching is handled by Apple, with no invented multipoint
  source list or primary-device command.

Read-only reports: `/tmp/momobose-existing-connection-0.1.9/report.json` and
`/tmp/momobose-source-manager-live-0.1.9/report.json`. Icon runtime report:
`/tmp/momobose-final-icon-runtime/report.json`. Icon provenance and checks:
`assets/icon-optimization.json`.

## Earlier 0.1.4 validation

Checked on 2026-10-21, on an Apple Silicon Mac running macOS 26.6.2.

## Passed

- TypeScript type checking and production renderer/main/preload builds.
- 36 automated tests across protocol parsing, command/readback flows, controller state, renderer interaction and shutdown.
- Native macOS Objective-C helper compilation.
- macOS Intel helper cross-compilation and Windows .NET 8 self-contained win-x64/win-arm64 publication.
- Real Electron desktop runtime: renderer loaded, preload API available, Node access absent from renderer.
- Real Electron tray creation and 370-pixel compact widget with no horizontal overflow.
- Packaged Mac app launch with local ad-hoc signing and Bluetooth usage descriptions.
- Native read-only discovery identified Ghost as a QC45 (Bluetooth product ID 0x4039).
- Version 0.1.1 live read-only check: Ghost returned battery 30%, firmware `4.0.4-4360+de6a887`, raw mode index 0 (then displayed as Quiet without independent profile identification), EQ `[8, 0, 0]`, self voice Medium and multipoint raw byte `0x06`. The corrected multipoint decoder reports it as off; the old decoder would incorrectly report on.
- Version 0.1.2 packaged Mac read-only smoke check again passed with no setting warnings, tray creation, isolated preload and no widget overflow. Ghost reported the same battery, firmware, mode, EQ and self voice; multipoint was now `0x07` (on). No setting writes were issued by this check.
- Version 0.1.3 repeated the packaged Mac read-only check successfully, with the same readings as 0.1.2 and a clean exit without an unhandled rejection. The shutdown race itself is covered by the automated regression test.
- Version 0.1.4 packaged Mac read-only check passed with no warnings, all four mode profiles, raw mode 1 / semantic Aware, tray creation, isolated preload, no widget overflow and clean shutdown. Multipoint was off and self voice High, as found. The app was then reopened for the user's listening check.
- macOS ARM64 DMG/ZIP and Windows x64 NSIS/ZIP packaging.
- No known vulnerabilities reported by `npm audit --omit=dev` for production dependencies. Build-only dependencies retain an advisory through electron-builder's proxy-download dependency chain.

## Device-derived mode mapping in 0.1.4

The user reported that selecting Aware appears to enable noise cancellation and vice versa. Earlier versions assumed slot 0 was Quiet and slot 1 was Aware. This assumption agrees with [bosectl's QC45 preset table](https://github.com/aaronsb/bosectl/blob/main/python/pybmap/devices/qc45.py), but does not independently establish Ghost's stored configuration or audible behavior.

The app now requests a read-only AudioModes.GetAll state dump and collects ModeConfig STATUS frames before and after acknowledgement. The [QC45 profile layout](https://github.com/aaronsb/bosectl/blob/main/python/pybmap/devices/parsers.py) provides the preset's voice-prompt identity and CNC level (0=max ANC, 10=transparency). Those fields resolve Quiet/Aware independently of slot order and display language. Every mode read, physical-button notification, and explicit selection uses the discovered mapping. The UI and tray share semantic mode values rather than raw indices. Profiles are reloaded on reconnect and recorded in Connection details. Missing, malformed, conflicting or ambiguous profiles disable mode selection instead of using a guessed mapping; remaining settings can still be read.

Tests cover both slot orders, localized profile names, custom profiles that reuse a preset prompt, CNC contradictions, missing profiles, delayed profile frames, reconnect, correct mode command bytes (including the announce flag), semantic readback, notifications, polling and both UI layouts. These fixtures are protocol simulations.

Two initial live read-only connection attempts failed with native status 10 (QC45 unreachable). After the user connected Ghost, live reads succeeded with no warnings. Its profiles are slot 0: Quiet / prompt 0.1 / CNC 0 / preset, slot 1: Aware / prompt 0.2 / CNC 10 / preset, and two empty editable slots 2–3. CurrentMode returned raw slot 1, and the independent live CNC GET `[1.5]` returned `0b0a03` (current level 10, transparency). These readings confirm the original slot mapping on Ghost and do not demonstrate a label reversal. They do not measure the subjective listening effect. No setting changes were issued during these checks.

Explicit app selections now set the START command's announcement flag to 1 so the headphone can announce its mode, instead of the previous silent flag 0. Passive reads and synchronization still issue no mode-change commands. Audible spoken confirmation still needs to be checked by the user with a selection in the new app.

## Shutdown correction in 0.1.3

The 0.1.1 process log exposed `Error: Tray is destroyed` when an asynchronous controller command completed after the tray was removed. This also affected 0.1.2. The main process now stops UI updates once quit begins, detaches its controller listener before stopping Bluetooth, checks the renderer/tray lifecycle before use, and makes tray cleanup safe when repeated. A regression test covers destroyed resources, synchronous Bluetooth shutdown updates, and a pending command completing after quit.

## Live listening mode in 0.1.2

The controller consumes valid CurrentMode STATUS frames even when no request is pending, then publishes the mode to both windows. A one-second read-only poll handles connections that do not send unsolicited changes. It skips busy/disconnected states, does not disable controls, and waits for an in-flight mode read before running user commands. Full refreshes preserve mode notifications received during later setting reads.

Automated checks cover fragmented notifications, unrelated requests in flight, malformed/irrelevant frames, duplicate events, stale frames after disconnect, notification/refresh races, silent polling and shutdown, clicks during delayed polling, and desktop/widget updates without writeback. A physical button press has not yet been observed in an instrumented hardware check.

## Multipoint correction in 0.1.1

The user supplied a live screenshot showing Ghost connected, a 30% battery reading, readable listening mode/EQ/self voice, and a failed multipoint change. This supersedes the original inability to establish a live connection. The screenshot does not establish that setting writes worked.

The original multipoint implementation and its simulator were wrong about the read bit: they treated capability bit 1 as the state. Bare 0/1 writes also failed to preserve advertised flags. [Hardware protocol findings](https://github.com/depau/bosectl-android/blob/main/docs/PROTOCOL.md#4-multipoint-110--bit-0-and-writes-must-preserve-the-other-bits) identify bit 0 as the state (0x07 on, 0x06 off) and require preserving the rest of the byte. Those findings were captured on another Bose model. A subsequent read from Ghost on QC45 firmware 4.0.4 returned 0x06 and confirms the old reader would falsely show on. Whether the original write was ignored is not established; the false failure message is explained by the incorrect reader.

The simulator now ignores writes that discard flags. New regression cases cover disabled-state reads, 0x07→0x06 and 0x06→0x07, reserved high bits, ignored legacy payloads, unchanged settings and delayed application. The live connection details log records only the multipoint flag bytes and requested/readback state when a change is attempted.

## Remaining hardware checks

The initial 0.1.0 read-only connection attempt timed out. In 0.1.1 and 0.1.2, a live handshake and setting reads succeeded with no warnings. No mode, EQ, sidetone or multipoint writes were issued during these checks; physical write/readback round trips still need verification. Multipoint was off during the 0.1.1 check and on during the 0.1.2 check; both checks preserved the state found.

The Windows helper compiles, but Windows Bluetooth/audio behavior and the Windows tray need a real Windows runtime test. macOS reconnect, audio routing, multipoint changes, and sleep/wake also need a connected QC45 test. Simulator tests do not establish hardware compatibility.

## Development distribution

The Mac artifact is locally ad-hoc signed and not notarized. Windows artifacts are unsigned development builds. Platform testing remains required before claiming installation and self-updates verified on hardware; paid Apple signing is optional for this release approach. The cross-built Windows executable keeps Electron's embedded executable metadata/icon; the app window, tray and installer use MomoBose branding. Building on Windows normally enables executable resource editing.

After moving the project under Desktop, File Provider attached FinderInfo metadata to generated Mach-O files and prevented signing, including after an attribute-cleanup hook. Version 0.1.4 is staged outside Desktop; its installer archives stay in the project. The unpacked signed Mac build is referenced from outside File Provider storage.

`docs/screenshots` contains screenshots of explicitly simulated demo mode, not screenshots of a physical headphone connection.
