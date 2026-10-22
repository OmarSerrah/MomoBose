import { expect, it, vi } from 'vitest';
import { airPodsReadings, AirPodsMonitor } from '../electron/airpods';
import { Controller } from '../electron/controller';
import { airPodsModels, modelForDevice } from '../src/shared/models';
import { defaultPreferences, emptySettings } from '../src/shared/types';
import { FakeTransport } from './fake-transport';
const address = '00:00:00:00:00:45';
const item = (fields: Record<string, unknown> = {}) => ({ device_address: address, device_vendorID: '0x004C', device_productID: '0x2024', ...fields });
const profile = (data: unknown, connected = true) => ({ SPBluetoothDataType: [{ [connected ? 'device_connected' : 'device_not_connected']: [{ Renamed: data }] }] });
it.each(Object.entries(airPodsModels))('recognizes AirPods product %s after renaming', (id, expected) => {
  expect(modelForDevice({ address, name: 'Renamed', connected: true, vendorId: 0x004c, productId: Number(id) })).toEqual(expected);
});
it('does not turn known Beats or another vendor into AirPods based on a name', () => {
  expect(modelForDevice({ address, name: 'AirPods Pro 2', connected: true, vendorId: 0x004c, productId: 0x2017 }).family).toBe('unknown');
  expect(modelForDevice({ address, name: 'AirPods', connected: true, vendorId: 0x1234, productId: 0x2024 }).family).toBe('unknown');
  expect(modelForDevice({ address, name: 'AirPods Pro', connected: true }).id).toBe('airpods-unknown');
});
it('reads only the selected connected AirPods and preserves zero and missing case levels', () => {
  const result = airPodsReadings(profile(item({ device_batteryLevelLeft: '0%', device_batteryLevelRight: '88%', device_firmwareVersion: '8B39' })), address, 'now');
  expect(result.battery).toBe(0); expect(result.batteries).toEqual({ left: 0, right: 88, case: null }); expect(result.firmware).toBe('8B39'); expect(result.batteryUpdatedAt).toBe('now');
  expect(airPodsReadings(profile(item({ device_batteryLevelLeft: '99%', device_batteryLevelCase: '80%' }), false), address)).toEqual(emptySettings());
  expect(airPodsReadings(profile(item({ device_address: '00:00:00:00:00:46', device_batteryLevelLeft: '99%' })), address)).toEqual(emptySettings());
});
it('handles Max batteries and invalid profiler readings without guessing', () => {
  expect(airPodsReadings(profile(item({ device_batteryLevelMain: '72%' })), address).battery).toBe(72);
  expect(airPodsReadings(profile(item({ device_batteryLevelLeft: '255%', device_batteryLevelRight: 'N/A', device_batteryLevelCase: '0%' })), address).batteries).toEqual({ left: null, right: null, case: 0 });
  expect(airPodsReadings(null, address)).toEqual(emptySettings());
});
it('shares concurrent profiler reads and never runs macOS commands on Windows', async () => {
  const read = vi.fn().mockResolvedValue(profile(item({ device_batteryLevelLeft: '81%' })));
  const monitor = new AirPodsMonitor('darwin', read);
  expect((await Promise.all([monitor.read(address), monitor.read(address)]))[0].battery).toBe(81);
  expect(read).toHaveBeenCalledTimes(1);
  await new AirPodsMonitor('win32', read).read(address); expect(read).toHaveBeenCalledTimes(1);
});
it.each(Object.keys(airPodsModels))('connects AirPods %s without opening or writing the Bose protocol', async id => {
  const transport = new FakeTransport(); const readings = { ...emptySettings(), battery: 88, batteries: { left: 88, right: 90, case: null } };
  const controller = new Controller(transport, defaultPreferences, () => {}, 'darwin', { read: async () => readings });
  try {
    controller.state.devices = [{ address, name: 'Renamed', connected: true, vendorId: 0x004c, productId: Number(id) }];
    expect(await controller.execute({ type: 'connect', address, confirmedQc45: false })).toEqual({ ok: true });
    expect(controller.state.connection).toBe('connected'); expect(controller.state.settings.battery).toBe(88);
    expect(transport.nativeRequests.some(r => r.method === 'connect' || r.method === 'write')).toBe(false);
    expect(await controller.execute({ type: 'volume', value: 59 })).toEqual({ ok: true }); expect(controller.state.audio.volume).toBe(59);
    expect((await controller.execute({ type: 'mode', value: 0 })).ok).toBe(false);
    expect(transport.writes).toHaveLength(0);
  } finally { controller.stop(); }
});
it('selects the AirPods output on this computer and verifies the result without Bose commands', async () => {
  const transport = new FakeTransport(); const controller = new Controller(transport, defaultPreferences, () => {}, 'darwin', { read: async () => emptySettings() });
  try {
    controller.state.device = { address, name: 'AirPods', connected: true, productId: 0x2002, vendorId: 0x004c };
    controller.state.audio = { available: true, isDefault: false, name: 'AirPods', volume: 42, volumeWritable: true, muted: false };
    expect(await controller.execute({ type: 'selectOutput' })).toEqual({ ok: true });
    expect(transport.nativeRequests.map(r => r.method)).toEqual(['selectOutput', 'audioStatus']);
    expect(controller.state.audio.isDefault).toBe(true); expect(transport.writes).toHaveLength(0);
    expect(modelForDevice(controller.state.device).automaticSwitching).toBe(false);
    controller.state.audio.available = false;
    expect((await controller.execute({ type: 'selectOutput' })).ok).toBe(false);
  } finally { controller.stop(); }
});
