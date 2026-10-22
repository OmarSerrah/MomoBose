# Sony WH-1000XM4 and WH-1000XM5

Support is experimental and has not been validated on physical Sony hardware
with MomoBose. The app implements Sony MDR directly through its existing native
Bluetooth helper on macOS and Windows. Initial pairing stays in OS settings.

## Controls

- Battery, firmware, audio connection/output, volume, reconnect, appearance,
  launch-at-login, tray/menu bar battery, and device switching.
- Noise cancelling, Ambient sound, and Off in both the window and widget/tray.
  Physical mode changes update the UI through notifications and background reads.
- Five EQ bands (400 Hz, 1 kHz, 2.5 kHz, 6.3 kHz, 16 kHz), Clear Bass, and
  device-reported presets. All six values use Sony's −10…+10 scale. Changes are
  staged until Apply; the Bose three-band EQ is not sent to a Sony headset.
- Ambient level 1–20 and focus on voice, applied together in Ambient sound mode.
- Multipoint, touch sensor, Speak-to-Chat, pause when removed, and DSEE Extreme.
  Switches require a recognized capability and a valid value read from the device.
- Paired-source listing, connect/disconnect, and replacement through MDR table 2
  when the firmware announces classic Bluetooth source management. The local
  computer is identified by its adapter address. Changes are blocked when that
  identity is unavailable and must be confirmed by a subsequent source-list read.

These models do not expose the QC45's adjustable self-voice levels. Firmware
updates, spatial audio setup, adaptive location/activity automation, voice
assistant/button remapping, and codec selection remain in Sony/OS controls.

## Pairing and troubleshooting

1. Pair the headphones in the computer's Bluetooth settings. Select the normal
   WH device, not its `LE_` companion.
2. Preserve `WH-1000XM4` or `WH-1000XM5` in its name. Sony Bluetooth PIDs vary;
   this implementation does not guess a renamed model from an unverified PID.
3. Close Sony Sound Connect on the phone so it releases the control session.
   Choose the Sony headphones in MomoBose and connect.
4. If a feature is unavailable, refresh or reconnect. If two other sources occupy
   both connection slots, release one in Bluetooth settings or Sony's app.

## Protocol choices

XM4 uses MDR v1 on service `96cc203e-5068-46ad-b32d-e316f5e069ba`; XM5 uses
MDR v2 on `956c7b26-d49a-4ba8-b03f-b17d393cb6e2`. macOS resolves the RFCOMM
port from the matching SDP record. Windows supplies the service GUID to Winsock
for SDP resolution. Neither assumes Bose's fixed RFCOMM channel 8 for Sony.

Frames use escaped start/end delimiters, a big-endian length, additive checksum,
an alternating sequence bit, and acknowledgements. Commands run serially; a GET
requires both the corresponding RET on the correct table and the matching ACK.
Settings writes require independent GET readback. A timeout closes the control
session so a delayed response cannot satisfy a later request.

The v1 noise command echoes setting-type bytes read from the device. The v2
noise implementation requires XM5's announced `6B` function / `17` inquiry.
Unknown noise variants are left unavailable. General switches are located by
their reported subject (multipoint/touch panel) and preserve the setting type.
v1 and v2 switch polarities and payload lengths are handled separately.

Implementation references (consulted 2026-10-22):

- [XM Connect's captured WH-1000XM4 session](https://github.com/manurrdd/xm-connect/blob/main/docs/devices/WH-1000XM4.md),
  including v1 noise setting types, EQ capabilities, and general-setting polarity.
- [Sony Tray's XM5 command definitions](https://github.com/abhiinhii/sony-tray/blob/main/src/SonyProtocol/Commands.cs)
  and [framing](https://github.com/abhiinhii/sony-tray/blob/main/src/SonyProtocol/Framing.cs).
- [SonyHeadphonesClient](https://github.com/mos9527/SonyHeadphonesClient),
  MDR v1/v2 command definitions for firmware, system/audio switches, and table-2
  source management (`libmdr/include/mdr/ProtocolV1T1.hpp`, `ProtocolV1T2.hpp`,
  `ProtocolV2T1.hpp`, `ProtocolV2T2.hpp`).
- [Sony's XM5 feature guide](https://helpguide.sony.net/mdr/wh1000xm5/v1/en/contents/TP1000534533.html)
  and [multipoint guide](https://helpguide.sony.net/mdr/wh1000xm5/v1/en/contents/TP1000541784.html).

## Hardware validation still required

On each model and OS, verify discovery, connection with the phone app closed,
readings against Sony Sound Connect, all three listening modes in both views,
physical button synchronization, all six EQ values and presets, ambient controls,
every available switch, and source connect/disconnect/replacement. Check ignored
writes, occupied slots, phone-app contention, sleep/wake, unexpected disconnects,
and switching among Sony, QC45, and AirPods. Verify source changes never target
this computer or remove saved pairings. Confirm the existing audio route/volume
is preserved when attaching to an already-connected headset at startup.
