import { expect, it, vi } from 'vitest';
import { Controller } from '../electron/controller';
import { defaultPreferences } from '../src/shared/types';
import { FakeTransport } from './fake-transport';

it('reads the matched headphone endpoint and broadcasts physical volume changes to both views without writeback', async () => {
  vi.useFakeTimers(); const transport = new FakeTransport(); const controller = new Controller(transport, defaultPreferences, () => {});
  try {
    await controller.start(); await vi.advanceTimersByTimeAsync(0);
    expect(controller.state.audio.volume).toBe(42);
    const desktop = vi.fn(), widget = vi.fn(); controller.on('state', desktop); controller.on('state', widget);
    transport.volume = 67; await vi.advanceTimersByTimeAsync(500);
    expect(controller.state.audio.volume).toBe(67); expect(controller.state.busy).toBeNull();
    expect(desktop.mock.calls.at(-1)![0].audio.volume).toBe(67); expect(widget).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500); expect(widget).toHaveBeenCalledTimes(1);
    expect(transport.writes).toHaveLength(0); expect(transport.nativeRequests.some(r => r.method === 'volume')).toBe(false);
    controller.stop(); const count = transport.nativeRequests.length; await vi.advanceTimersByTimeAsync(2000);
    expect(transport.nativeRequests).toHaveLength(count);
  } finally { controller.stop(); vi.useRealTimers(); }
});
it('writes only the selected headphone endpoint and independently reads volume back', async () => {
  vi.useFakeTimers(); const transport = new FakeTransport(); const controller = new Controller(transport, defaultPreferences, () => {});
  try {
    await controller.start(); await vi.advanceTimersByTimeAsync(0);
    const count = transport.nativeRequests.length;
    expect(await controller.execute({ type: 'volume', value: 35 })).toEqual({ ok: true });
    expect(controller.state.audio.volume).toBe(35);
    const requests = transport.nativeRequests.slice(count);
    expect(requests.map(r => r.method)).toEqual(['volume', 'audioStatus']);
    expect(requests[0].params).toMatchObject({ address: '00:00:00:00:00:45', value: 35 });
    expect(transport.writes).toHaveLength(0);
  } finally { controller.stop(); vi.useRealTimers(); }
});
it('shows actual endpoint volume when a write is ignored and refuses unavailable controls', async () => {
  vi.useFakeTimers(); const transport = new FakeTransport(); const controller = new Controller(transport, defaultPreferences, () => {});
  try {
    await controller.start(); await vi.advanceTimersByTimeAsync(0);
    transport.ignoreVolume = true;
    const changing = controller.execute({ type: 'volume', value: 12 }); await vi.advanceTimersByTimeAsync(600);
    expect((await changing).ok).toBe(false); expect(controller.state.audio.volume).toBe(42);
    transport.audioReady = false; await vi.advanceTimersByTimeAsync(500);
    expect(controller.state.audio.volume).toBeNull(); expect(controller.state.audio.volumeWritable).toBe(false);
    const count = transport.nativeRequests.filter(r => r.method === 'volume').length;
    expect((await controller.execute({ type: 'volume', value: 20 })).ok).toBe(false);
    expect(transport.nativeRequests.filter(r => r.method === 'volume')).toHaveLength(count);
  } finally { controller.stop(); vi.useRealTimers(); }
});
it('does not restore stale volume after shutdown while an endpoint read is pending', async () => {
  const transport = new FakeTransport(); const request = transport.request.bind(transport); let finish!: (value: unknown) => void;
  vi.spyOn(transport, 'request').mockImplementation((method, params) => method === 'audioStatus' ? new Promise(resolve => { finish = resolve; }) : request(method, params));
  const controller = new Controller(transport, defaultPreferences, () => {});
  try {
    await controller.start(); controller.stop();
    finish({ available: true, isDefault: true, name: 'Ghost', volume: 90, volumeWritable: true, muted: false });
    await Promise.resolve(); await Promise.resolve();
    expect(controller.state.audio.volume).toBeNull();
  } finally { controller.stop(); }
});
it('persists explicit appearance and preserves it when another preference changes', async () => {
  const save = vi.fn(); const controller = new Controller(new FakeTransport(), defaultPreferences, save);
  expect((await controller.execute({ type: 'preferences', value: { appearance: 'dark' } })).ok).toBe(true);
  expect((await controller.execute({ type: 'preferences', value: { autoReconnect: true } })).ok).toBe(true);
  expect(controller.state.preferences.appearance).toBe('dark'); expect(save).toHaveBeenCalledTimes(2);
  expect((await controller.execute({ type: 'preferences', value: { appearance: 'invalid' as any } })).ok).toBe(false);
  expect(controller.state.preferences.appearance).toBe('dark'); controller.stop();
});
