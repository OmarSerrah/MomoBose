import { expect, it, vi } from 'vitest';
import { Controller } from '../electron/controller';
import { defaultPreferences, emptySettings } from '../src/shared/types';
import { FakeTransport } from './fake-transport';
const address = '00:00:00:00:00:45';
it('adopts an existing Mac connection and attaches controls even with automatic reconnection off, without rerouting audio', async () => {
  vi.useFakeTimers(); const transport = new FakeTransport(); transport.bluetoothConnected = true;
  const controller = new Controller(transport, { ...defaultPreferences, autoReconnect: false }, () => {});
  try {
    await controller.start(); await vi.advanceTimersByTimeAsync(2500);
    expect(controller.state.connection).toBe('connected'); expect(controller.state.audio.volume).toBe(42);
    expect(transport.nativeRequests.filter(r => r.method === 'connect')).toEqual([{ method: 'connect', params: { address, channel: 8, existingOnly: true } }]);
    expect(transport.nativeRequests.some(r => ['selectOutput', 'reconnectAudio', 'disconnect', 'volume'].includes(r.method))).toBe(false);
    expect(transport.writes.every(p => p[2] === 1 || p[0] === 31 && p[1] === 1)).toBe(true);
    transport.emit('disconnected'); await vi.advanceTimersByTimeAsync(3000);
    expect(controller.state.connection).toBe('connected');
    expect(transport.nativeRequests.filter(r => r.method === 'connect')).toHaveLength(2);
    expect(transport.nativeRequests.some(r => r.method === 'selectOutput' || r.method === 'reconnectAudio')).toBe(false);
  } finally { controller.stop(); vi.useRealTimers(); }
});
it('preserves independently connected audio after a failed control connection and clears its stale error on recovery', async () => {
  vi.useFakeTimers(); const transport = new FakeTransport(); const request = transport.request.bind(transport);
  vi.spyOn(transport, 'request').mockImplementation((method, params) => method === 'connect' ? Promise.reject(new Error('QC45 is not reachable (status 10).')) : request(method, params));
  const controller = new Controller(transport, defaultPreferences, () => {});
  try {
    await controller.start(); await vi.advanceTimersByTimeAsync(0);
    expect((await controller.execute({ type: 'connect', address, confirmedQc45: true })).ok).toBe(false);
    expect(controller.state.audio.volume).toBe(42); expect(controller.state.audio.available).toBe(true);
    await vi.advanceTimersByTimeAsync(500); expect(controller.state.error).toBeNull();
    expect(controller.state.connection).toBe('disconnected'); expect(controller.state.audio.volumeWritable).toBe(true);
  } finally { controller.stop(); vi.useRealTimers(); }
});
it('preserves audio on Bose transport loss and allows Refresh while controls are offline', async () => {
  const transport = new FakeTransport(); const controller = new Controller(transport, defaultPreferences, () => {});
  try {
    await controller.execute({ type: 'discover' }); await controller.execute({ type: 'connect', address, confirmedQc45: true });
    transport.emit('disconnected');
    expect(controller.state.connection).toBe('disconnected'); expect(controller.state.settings.mode).toBeNull(); expect(controller.state.audio.available).toBe(true);
    transport.volume = 63; const before = transport.writes.length;
    expect(await controller.execute({ type: 'refresh' })).toEqual({ ok: true });
    expect(controller.state.audio.volume).toBe(63); expect(transport.writes).toHaveLength(before);
  } finally { controller.stop(); }
});
it('observes AirPods connected later through macOS without sending connection or Bose commands', async () => {
  vi.useFakeTimers(); const transport = new FakeTransport(); const request = transport.request.bind(transport); let present = false;
  vi.spyOn(transport, 'request').mockImplementation((method, params) => method === 'list' ? Promise.resolve(present ? [{ address, name: 'Renamed', vendorId: 0x004c, productId: 0x2024, connected: true }] : []) : request(method, params));
  const controller = new Controller(transport, defaultPreferences, () => {}, 'darwin', { read: async () => ({ ...emptySettings(), battery: 82 }) });
  try {
    await controller.start(); present = true; await vi.advanceTimersByTimeAsync(5500);
    expect(controller.state.connection).toBe('connected'); expect(controller.state.audio.volume).toBe(42); expect(controller.state.settings.battery).toBe(82);
    expect(transport.nativeRequests.some(r => ['connect', 'reconnectAudio', 'selectOutput', 'volume'].includes(r.method))).toBe(false);
    expect(transport.writes).toHaveLength(0);
    transport.audioReady = false; await vi.advanceTimersByTimeAsync(500);
    expect(controller.state.connection).toBe('disconnected'); expect(controller.state.settings.battery).toBeNull();
  } finally { controller.stop(); vi.useRealTimers(); }
});
it('publishes paired and connected sources from confirmed changes and clears uncertain snapshots', async () => {
  const transport = new FakeTransport(); const controller = new Controller(transport, defaultPreferences, () => {});
  const headset = (controller as any).headset;
  const sources = [{ address: '02:00:00:00:00:01', name: 'This Mac', isLocalDevice: true, connected: true }, { address: '02:00:00:00:00:02', name: 'Phone', isLocalDevice: false, connected: false }];
  try {
    controller.state.device = { address, name: 'Ghost', productId: 0x4039, connected: true }; controller.state.connection = 'connected';
    vi.spyOn(headset, 'listSources').mockResolvedValue(sources);
    expect(await controller.execute({ type: 'sources' })).toEqual({ ok: true });
    expect(controller.state.settings.pairedSources).toEqual(sources); expect(controller.state.settings.connectedDevices).toHaveLength(1);
    vi.spyOn(headset, 'connectSource').mockResolvedValue(sources.map(s => ({ ...s, connected: true })));
    expect(await controller.execute({ type: 'sourceConnect', address: sources[1].address })).toEqual({ ok: true });
    expect(controller.state.settings.connectedDevices).toHaveLength(2);
    headset.connectSource.mockRejectedValue(new Error('Outcome unknown')); headset.listSources.mockRejectedValue(new Error('Read unavailable'));
    expect((await controller.execute({ type: 'sourceConnect', address: sources[1].address })).ok).toBe(false);
    expect(controller.state.settings.pairedSources).toBeNull(); expect(controller.state.settings.connectedDevices).toBeNull();
    controller.state.device = { address, name: 'AirPods', vendorId: 0x004c, productId: 0x2024, connected: true };
    expect((await controller.execute({ type: 'sources' })).ok).toBe(false);
  } finally { controller.stop(); }
});
