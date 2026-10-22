import { expect, it, vi } from 'vitest';
import { Controller } from '../electron/controller';
import { defaultPreferences } from '../src/shared/types';
import { FakeTransport } from './fake-transport';
import { productForDevice } from '../src/shared/products';

const address = '00:00:00:00:00:45';
const savedAddress = '00:00:00:00:00:46';

it.each(['Bose QC45', 'Bose QuietComfort 45'])('attaches Windows controls to an already-connected %s without a product ID', async name => {
  vi.useFakeTimers();
  const transport = new FakeTransport();
  const request = transport.request.bind(transport);
  vi.spyOn(transport, 'request').mockImplementation((method, params = {}) => method === 'list'
    ? Promise.resolve([{ address, name, connected: true }]) : request(method, params));
  const controller = new Controller(transport, { ...defaultPreferences, autoReconnect: false }, () => {}, 'win32');
  try {
    await controller.start(); await vi.advanceTimersByTimeAsync(2500);
    expect(controller.state.connection).toBe('connected');
    expect(productForDevice(controller.state.device).image).toMatch(/bose-qc45-black-cutout\.png$/);
    expect(transport.nativeRequests.filter(r => r.method === 'connect')).toEqual([
      { method: 'connect', params: { address, channel: 8, existingOnly: true } },
    ]);
    expect(transport.nativeRequests.some(r => ['selectOutput', 'reconnectAudio', 'disconnect', 'volume'].includes(r.method))).toBe(false);
    const changing = controller.execute({ type: 'mode', value: 1 });
    await vi.advanceTimersByTimeAsync(2500);
    expect(await changing).toEqual({ ok: true });
    expect(controller.state.settings.mode).toBe(1);
  } finally { controller.stop(); vi.useRealTimers(); }
});

it('recognizes a renamed Windows QC45 when cached hardware identity arrives on a later discovery', async () => {
  vi.useFakeTimers();
  const transport = new FakeTransport(); let identified = false;
  const request = transport.request.bind(transport);
  vi.spyOn(transport, 'request').mockImplementation((method, params = {}) => method === 'list'
    ? Promise.resolve([{ address, name: 'Ghost', connected: true, ...(identified ? { vendorId: 0x009e, productId: 0x4039 } : {}) }]) : request(method, params));
  const controller = new Controller(transport, { ...defaultPreferences, selectedAddress: address }, () => {}, 'win32');
  try {
    await controller.start(); await vi.advanceTimersByTimeAsync(500);
    expect(transport.nativeRequests.some(r => r.method === 'connect')).toBe(false);
    identified = true; await vi.advanceTimersByTimeAsync(7000);
    expect(controller.state.connection).toBe('connected');
    expect(productForDevice(controller.state.device).image).toMatch(/bose-qc45-black-cutout\.png$/);
    expect(controller.state.device?.vendorId).toBe(0x009e);
    expect(transport.nativeRequests.filter(r => r.method === 'connect')).toHaveLength(1);
  } finally { controller.stop(); vi.useRealTimers(); }
});

it.each([false, true])('adopts the current Mac output instead of a saved headset whose Bluetooth connection is %s', async savedConnected => {
  vi.useFakeTimers();
  const transport = new FakeTransport();
  const request = transport.request.bind(transport);
  vi.spyOn(transport, 'request').mockImplementation(async (method, params = {}) => {
    const result = await request(method, params);
    if (method === 'list') return [
      { address: savedAddress, name: 'Travel QC45', productId: 0x4039, connected: savedConnected },
      { address, name: 'Ghost', productId: 0x4039, connected: true },
    ];
    if (method === 'audioStatus') return { ...result, isDefault: params.address === address };
    return result;
  });
  const controller = new Controller(transport, { ...defaultPreferences, selectedAddress: savedAddress, autoReconnect: false }, () => {}, 'darwin');
  const updates = vi.fn(); controller.on('state', updates);
  try {
    await controller.start();
    expect(controller.state.device?.address).toBe(address);
    expect(controller.state.audio.available).toBe(true);
    await vi.advanceTimersByTimeAsync(2500);
    expect(controller.state.connection).toBe('connected');
    expect(controller.state.settings.battery).toBe(78);
    expect(controller.state.audio.volume).toBe(42);
    expect(transport.nativeRequests.filter(r => r.method === 'connect')).toEqual([
      { method: 'connect', params: { address, channel: 8, existingOnly: true } },
    ]);
    expect(transport.nativeRequests.some(r => ['selectOutput', 'reconnectAudio', 'disconnect', 'volume'].includes(r.method))).toBe(false);
    const attaching = updates.mock.calls.map(([state]) => state).filter(state => state.connection === 'connecting');
    expect(attaching.length).toBeGreaterThan(0);
    expect(attaching.every(state => state.audio.available && state.audio.volume === 42)).toBe(true);
  } finally { controller.stop(); vi.useRealTimers(); }
});

it('attaches Bose controls to an existing Bluetooth connection while its audio endpoint is still loading', async () => {
  vi.useFakeTimers();
  const transport = new FakeTransport(); transport.bluetoothConnected = true; transport.audioReady = false;
  const controller = new Controller(transport, defaultPreferences, () => {}, 'darwin');
  try {
    await controller.start(); await vi.advanceTimersByTimeAsync(2500);
    expect(controller.state.connection).toBe('connected');
    expect(controller.state.settings.battery).toBe(78);
    expect(controller.state.audio.available).toBe(false);
    expect(transport.nativeRequests.find(r => r.method === 'connect')?.params.existingOnly).toBe(true);
    transport.audioReady = true; await vi.advanceTimersByTimeAsync(500);
    expect(controller.state.audio.volume).toBe(42);
    expect(transport.nativeRequests.some(r => ['selectOutput', 'reconnectAudio', 'disconnect', 'volume'].includes(r.method))).toBe(false);
  } finally { controller.stop(); vi.useRealTimers(); }
});

it('keeps system audio connected when automatic control attachment fails, without repeatedly reconnecting', async () => {
  vi.useFakeTimers();
  const transport = new FakeTransport(); transport.bluetoothConnected = true;
  const request = transport.request.bind(transport);
  vi.spyOn(transport, 'request').mockImplementation((method, params = {}) => {
    if (method === 'connect') {
      transport.nativeRequests.push({ method, params });
      return Promise.reject(new Error('Controls are unavailable.'));
    }
    return request(method, params);
  });
  const controller = new Controller(transport, defaultPreferences, () => {}, 'darwin');
  try {
    await controller.start(); await vi.advanceTimersByTimeAsync(10000);
    expect(controller.state.connection).toBe('disconnected');
    expect(controller.state.audio).toMatchObject({ available: true, isDefault: true, volume: 42, volumeWritable: true });
    expect(transport.nativeRequests.filter(r => r.method === 'connect')).toHaveLength(1);
    expect(transport.nativeRequests.some(r => ['selectOutput', 'reconnectAudio', 'disconnect', 'volume'].includes(r.method))).toBe(false);
    expect(transport.writes).toHaveLength(0);
  } finally { controller.stop(); vi.useRealTimers(); }
});

it('does not open a Bluetooth connection to an offline saved pair when auto-reconnect is off', async () => {
  vi.useFakeTimers();
  const transport = new FakeTransport(); transport.audioReady = false;
  const controller = new Controller(transport, { ...defaultPreferences, selectedAddress: address }, () => {}, 'darwin');
  try {
    await controller.start(); await vi.advanceTimersByTimeAsync(10000);
    expect(controller.state.connection).toBe('disconnected');
    expect(transport.nativeRequests.some(r => ['connect', 'reconnectAudio', 'selectOutput'].includes(r.method))).toBe(false);
    expect(transport.writes).toHaveLength(0);
  } finally { controller.stop(); vi.useRealTimers(); }
});
