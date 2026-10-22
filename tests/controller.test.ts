import { expect, it, vi } from 'vitest';
import { packet } from '../electron/bmap';
import { Controller } from '../electron/controller';
import { defaultPreferences } from '../src/shared/types';
import { FakeTransport, modeProfile } from './fake-transport';
const connect = (controller: Controller) => controller.execute({ type: 'connect', address: '00:00:00:00:00:45', confirmedQc45: true });
it('keeps UI semantics consistent when the headphones report reversed preset slots', async () => {
  vi.useFakeTimers(); const transport = new FakeTransport();
  transport.modeProfiles = [modeProfile(0, 2, 10), modeProfile(1, 1, 0)];
  transport.fields.set('31.3', Buffer.from([1]));
  const controller = new Controller(transport, defaultPreferences, () => {});
  try {
    await controller.start(); const connecting = connect(controller); await vi.advanceTimersByTimeAsync(2500); await connecting;
    expect(controller.state.settings.mode).toBe(0);
    const aware = controller.execute({ type: 'mode', value: 1 }); await vi.advanceTimersByTimeAsync(2500);
    expect(await aware).toEqual({ ok: true }); expect(transport.fields.get('31.3')![0]).toBe(0); expect(controller.state.settings.mode).toBe(1);
    transport.fields.set('31.3', Buffer.from([1])); transport.emit('data', packet(31, 3, 3, [1]).toString('hex'));
    expect(controller.state.settings.mode).toBe(0);
    transport.fields.set('31.3', Buffer.from([0])); await vi.advanceTimersByTimeAsync(1200);
    expect(controller.state.settings.mode).toBe(1);
  } finally { controller.stop(); vi.useRealTimers(); }
});
it('broadcasts physical Quiet/Aware changes to all views without writeback or duplicate updates', async () => {
  const transport = new FakeTransport(); const controller = new Controller(transport, defaultPreferences, () => {});
  try {
    await controller.execute({ type: 'discover' }); await connect(controller);
    const desktop = vi.fn(), widget = vi.fn(); controller.on('state', desktop); controller.on('state', widget);
    const count = transport.writes.length;
    transport.emit('data', packet(31, 3, 3, [1]).toString('hex'));
    expect(desktop.mock.calls.at(-1)![0].settings.mode).toBe(1); expect(widget.mock.calls.at(-1)![0].settings.mode).toBe(1);
    expect(controller.state.busy).toBe(null); expect(transport.writes).toHaveLength(count);
    transport.emit('data', packet(31, 3, 3, [1]).toString('hex'));
    expect(desktop).toHaveBeenCalledTimes(1);
    transport.emit('data', packet(31, 3, 3, [0]).toString('hex'));
    expect(controller.state.settings.mode).toBe(0); expect(widget).toHaveBeenCalledTimes(2);
    transport.emit('disconnected'); transport.emit('data', packet(31, 3, 3, [1]).toString('hex'));
    expect(controller.state.settings.mode).toBe(null);
  } finally { controller.stop(); }
});
it('keeps a newer button notification when a full refresh finishes', async () => {
  const transport = new FakeTransport(); const controller = new Controller(transport, defaultPreferences, () => {});
  try {
    await controller.execute({ type: 'discover' }); await connect(controller);
    transport.beforeReply = request => {
      if (request[0] === 1 && request[1] === 7) {
        transport.fields.set('31.3', Buffer.from([1])); transport.emit('data', packet(31, 3, 3, [1]).toString('hex'));
      }
    };
    expect((await controller.execute({ type: 'refresh' })).ok).toBe(true);
    expect(controller.state.settings.mode).toBe(1);
  } finally { controller.stop(); }
});
it('silently polls mode when firmware sends no button notification, then stops polling on shutdown', async () => {
  vi.useFakeTimers(); const transport = new FakeTransport(); const controller = new Controller(transport, defaultPreferences, () => {});
  try {
    await controller.start(); const connecting = connect(controller); await vi.advanceTimersByTimeAsync(2500); expect((await connecting).ok).toBe(true);
    const updates = vi.fn(); controller.on('state', updates); const count = transport.writes.length;
    transport.fields.set('31.3', Buffer.from([1])); await vi.advanceTimersByTimeAsync(1000);
    expect(controller.state.settings.mode).toBe(1); expect(controller.state.busy).toBe(null); expect(controller.state.error).toBe(null);
    expect(updates).toHaveBeenCalledTimes(1); expect(updates.mock.calls[0][0].busy).toBe(null);
    expect(transport.writes.slice(count).map(p => p.toString('hex'))).toEqual(['1f030100']);
    await vi.advanceTimersByTimeAsync(1000); expect(updates).toHaveBeenCalledTimes(1);
    controller.stop(); const stoppedCount = transport.writes.length; await vi.advanceTimersByTimeAsync(5000);
    expect(transport.writes).toHaveLength(stoppedCount);
  } finally { controller.stop(); vi.useRealTimers(); }
});
it('queues a user setting change behind a delayed background mode read', async () => {
  vi.useFakeTimers(); const transport = new FakeTransport(); const controller = new Controller(transport, defaultPreferences, () => {});
  try {
    await controller.start(); const connecting = connect(controller); await vi.advanceTimersByTimeAsync(2500); await connecting;
    transport.replyDelayMs = 300; await vi.advanceTimersByTimeAsync(501);
    expect(transport.writes.at(-1)!.toString('hex')).toBe('1f030100'); expect(controller.state.busy).toBe(null);
    const changing = controller.execute({ type: 'mode', value: 1 }); await vi.advanceTimersByTimeAsync(4500);
    expect(await changing).toEqual({ ok: true }); expect(controller.state.settings.mode).toBe(1); expect(controller.state.error).toBe(null);
  } finally { controller.stop(); vi.useRealTimers(); }
});
it('keeps settings connected when audio is unavailable, and clears controls on transport loss', async () => {
  const transport = new FakeTransport(); transport.audioReady = false;
  const controller = new Controller(transport, defaultPreferences, () => {});
  try {
    await controller.execute({ type: 'discover' });
    const result = await controller.execute({ type: 'connect', address: '00:00:00:00:00:45', confirmedQc45: true });
    expect(result.ok).toBe(true); expect(controller.state.connection).toBe('connected'); expect(controller.state.audio.available).toBe(false); expect(controller.state.settings.battery).toBe(78);
    transport.emit('disconnected'); expect(controller.state.connection).toBe('disconnected'); expect(controller.state.settings.multipoint).toBe(null); expect(controller.state.settings.battery).toBe(null);
  } finally { controller.stop(); }
});
it('requires confirmation for a device whose product ID is unknown', async () => {
  const transport = new FakeTransport(); transport.productId = 0;
  const controller = new Controller(transport, defaultPreferences, () => {});
  await controller.execute({ type: 'discover' });
  expect((await controller.execute({ type: 'connect', address: '00:00:00:00:00:45', confirmedQc45: false })).ok).toBe(false);
  expect(transport.writes).toHaveLength(0); controller.stop();
});
it('switches an active control connection and routes subsequent volume to the new headphones', async () => {
  const transport = new FakeTransport(); const save = vi.fn();
  const controller = new Controller(transport, defaultPreferences, save);
  try {
    await controller.execute({ type: 'discover' }); await connect(controller);
    const second = { name: 'Travel QC45', address: '00:00:00:00:00:46', productId: 0x4039, connected: false };
    controller.state.devices.push(second);
    const before = transport.nativeRequests.length;
    expect(await controller.execute({ type: 'connect', address: second.address, confirmedQc45: true })).toEqual({ ok: true });
    const requests = transport.nativeRequests.slice(before);
    expect(requests.findIndex(r => r.method === 'close')).toBeLessThan(requests.findIndex(r => r.method === 'connect'));
    expect(requests.find(r => r.method === 'connect')?.params.address).toBe(second.address);
    expect(requests.find(r => r.method === 'selectOutput')?.params.address).toBe(second.address);
    expect(controller.state.connection).toBe('connected'); expect(controller.state.device?.address).toBe(second.address);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ selectedAddress: second.address }));
    expect(await controller.execute({ type: 'volume', value: 53 })).toEqual({ ok: true });
    expect([...transport.nativeRequests].reverse().find(r => r.method === 'volume')?.params.address).toBe(second.address);
  } finally { controller.stop(); }
});
