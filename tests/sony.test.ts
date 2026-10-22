import { afterEach, describe, expect, it, vi } from 'vitest';
import { SonyDecoder, SonyHeadset, parseSonySources, sonyPacket, sonyServices } from '../electron/sony';
import { Controller } from '../electron/controller';
import { ListeningMode, defaultPreferences } from '../src/shared/types';
import { modelForDevice } from '../src/shared/models';
import { FakeSonyTransport, localAddress, sonyAddress } from './fake-sony';

afterEach(() => vi.useRealTimers());
it('matches independent Sony wire fixtures, escaping and fragmented/coalesced frames', () => {
  expect(sonyPacket(0x0c, 0, [0, 0]).toString('hex')).toBe('3e0c000000000200000e3c');
  expect(sonyPacket(1, 1).toString('hex')).toBe('3e010100000000023c');
  expect(sonyPacket(0x0c, 0, [0x3c, 0x3d, 0x3e]).toString('hex')).toBe('3e0c00000000033d2c3d2d3d2ec63c');
  const decoder = new SonyDecoder(), raw = Buffer.from('003e0c000000000200000e3c3e010100000000023c', 'hex');
  const frames = [...raw].flatMap(byte => decoder.push(Buffer.from([byte])));
  expect(frames.map(f => [f.type, f.sequence, [...f.payload]])).toEqual([[12, 0, [0, 0]], [1, 1, []]]);
});
it('drops invalid checksums, lengths, escapes and oversized fragments and recovers on the next start marker', () => {
  const decoder = new SonyDecoder(), valid = sonyPacket(12, 0, [0, 0]);
  for (const data of [Buffer.from('3e0c000000000200000f3c', 'hex'), Buffer.from('3e0c000000000300000e3c', 'hex'), Buffer.from('3e3d003c', 'hex'), Buffer.concat([Buffer.from([0x3e]), Buffer.alloc(10000, 0xff)])]) {
    expect(decoder.push(data)).toEqual([]); expect(decoder.push(valid)).toHaveLength(1);
  }
});
it.each(['WH-1000XM4', 'Sony WH-1000XM5', 'WH 1000XM4'])('recognizes %s even with a generic Sony hardware PID', name => {
  expect(modelForDevice({ name, address: 'a', connected: true, productId: 123, vendorId: 0x012d }).family).toBe('sony');
});
it.each(['WF-1000XM4', 'WF-1000XM5', 'WH-1000XM3', 'WH-1000XM6', 'WH-1000XM45', 'LE_WH-1000XM5'])('does not misidentify %s', name => {
  expect(modelForDevice({ name, address: 'a', connected: true }).family).toBe('unknown');
});
it('lets known hardware identity override a misleading Sony name', () => {
  expect(modelForDevice({ name: 'WH-1000XM5', address: 'a', connected: true, productId: 0x4039 }).family).toBe('bose');
  expect(modelForDevice({ name: 'WH-1000XM5', address: 'a', connected: true, productId: 0x2014, vendorId: 0x004c }).family).toBe('airpods');
});

describe.each(['v1', 'v2'] as const)('Sony %s', protocol => {
  const setup = async () => {
    const transport = new FakeSonyTransport(protocol), headset = new SonyHeadset(transport, 100);
    await headset.connect(sonyAddress, false, true, protocol === 'v1' ? 'wh-1000xm4' : 'wh-1000xm5');
    return { transport, headset };
  };
  it('discovers capabilities over the correct service and reads actual headset settings', async () => {
    const { transport, headset } = await setup();
    try {
      expect(transport.requests[0]).toEqual({ method: 'connect', params: { address: sonyAddress, serviceUuid: sonyServices[protocol], existingOnly: true } });
      const { settings, warnings, connectedDevices } = await headset.read();
      expect(warnings).toEqual([]);
      expect(settings).toMatchObject({ battery: 80, firmware: '2.0.0', mode: ListeningMode.Quiet, eq: null, sidetone: null, multipoint: true, sony: { speakToChat: false, wearingDetection: true, touchSensor: true, dsee: true, sourceManagement: true, equalizer: { values: [0, 0, 0, 0, 0, 0] } } });
      expect(connectedDevices).toHaveLength(2); expect(connectedDevices?.[0].isLocalDevice).toBe(true);
    } finally { await headset.close(); }
  });
  it('writes and verifies ANC, Ambient and Off without overwriting v1 setting types', async () => {
    const { transport, headset } = await setup();
    try {
      await headset.ambient(9, true); expect(headset.latestMode).toBe(ListeningMode.Aware);
      expect([...transport.packets.find(p => p.payload[0] === 0x68)!.payload]).toEqual(protocol === 'v1' ? [0x68, 2, 0x11, 2, 0, 1, 1, 9] : [0x68, 0x17, 1, 1, 1, 1, 9]);
      await headset.mode(ListeningMode.Off); expect(headset.latestMode).toBe(ListeningMode.Off);
      await headset.mode(ListeningMode.Quiet); expect(headset.latestMode).toBe(ListeningMode.Quiet);
      await headset.mode(ListeningMode.Aware);
      const noise = transport.fields.get('102')!;
      expect(noise[protocol === 'v1' ? 7 : 6]).toBe(9);
      await headset.mode(ListeningMode.Quiet);
      transport.ignoreChanges = true;
      await expect(headset.mode(ListeningMode.Aware)).rejects.toThrow('did not confirm');
    } finally { await headset.close(); }
  });
  it('sends native six-value EQ and uses readback rather than treating ACK as success', async () => {
    const { transport, headset } = await setup();
    try {
      await headset.read(); await headset.equalizer([-10, 10, 2, -2, 0, 1]);
      expect([...transport.packets.find(p => p.payload[0] === 0x58)!.payload]).toEqual([0x58, protocol === 'v1' ? 1 : 0, 0xa0, 6, 0, 20, 12, 8, 10, 11]);
      await headset.equalizer(undefined, 0x10);
      transport.ignoreChanges = true;
      await expect(headset.equalizer([0, 0, 0, 0, 0, 0])).rejects.toThrow('did not confirm');
      const count = transport.packets.length;
      await expect(headset.equalizer([100])).rejects.toThrow(); await expect(headset.equalizer(undefined, 200)).rejects.toThrow();
      expect(transport.packets).toHaveLength(count);
    } finally { await headset.close(); }
  });
  it('preserves family-specific switch formats and verifies all extra switches', async () => {
    const { transport, headset } = await setup();
    try {
      await headset.read();
      for (const setting of ['touchSensor', 'speakToChat', 'wearingDetection', 'dsee'] as const) await headset.switch(setting, false);
      await headset.multipoint(false);
      const writes = transport.packets.filter(p => [0xd8, 0xe8, 0xf8].includes(p.payload[0])).map(p => [...p.payload]);
      expect(writes).toContainEqual(protocol === 'v1' ? [0xd8, 0xd2, 1, 0] : [0xd8, 0xd2, 0, 1]);
      expect(writes).toContainEqual(protocol === 'v1' ? [0xf8, 5, 0, 0] : [0xf8, 2, 1]);
      expect(writes).toContainEqual(protocol === 'v1' ? [0xe8, 2, 0, 0] : [0xe8, 1, 0]);
      transport.ignoreChanges = true; await expect(headset.switch('touchSensor', true)).rejects.toThrow('did not confirm');
    } finally { await headset.close(); }
  });
  it('manages saved sources, protects this computer and never unpairs a device', async () => {
    const { transport, headset } = await setup();
    try {
      await headset.read();
      await expect(headset.disconnectSource(localAddress)).rejects.toThrow('another paired source');
      await expect(headset.connectSource('02:00:00:00:00:03')).rejects.toThrow('Free a connection slot');
      const sources = await headset.replaceSource('02:00:00:00:00:02', '02:00:00:00:00:03');
      expect(sources.find(s => s.name === 'Phone')?.connected).toBe(false); expect(sources.find(s => s.name === 'Tablet')?.connected).toBe(true);
      const changes = transport.packets.filter(p => p.type === 0x0e && p.payload[0] === 0x3c);
      expect(changes.map(p => [...p.payload.subarray(0, protocol === 'v1' ? 4 : 3)])).toEqual(protocol === 'v1' ? [[0x3c, 0, 0, 0], [0x3c, 0, 0, 1]] : [[0x3c, 0, 0], [0x3c, 0, 1]]);
    } finally { await headset.close(); }
  });
  it('connects through the shared controller and syncs unsolicited physical changes', async () => {
    const transport = new FakeSonyTransport(protocol), controller = new Controller(transport, defaultPreferences, () => {});
    try {
      expect((await controller.execute({ type: 'discover' })).ok).toBe(true);
      expect((await controller.execute({ type: 'connect', address: sonyAddress, confirmedQc45: false })).ok).toBe(true);
      transport.notify(protocol === 'v1' ? [0x69, 2, 1, 2, 0, 1, 1, 14] : [0x69, 0x17, 1, 1, 1, 1, 14]);
      expect(controller.state.settings.mode).toBe(ListeningMode.Aware); expect(controller.state.settings.sony?.ambientLevel).toBe(14);
      expect((await controller.execute({ type: 'sonySwitch', setting: 'speakToChat', value: true })).ok).toBe(true);
      expect(controller.state.settings.sony?.speakToChat).toBe(true);
      expect((await controller.execute({ type: 'volume', value: 57 })).ok).toBe(true); expect(controller.state.audio.volume).toBe(57);
      transport.emit('disconnected'); expect(controller.state.connection).toBe('disconnected'); expect(controller.state.settings.sony).toBeUndefined();
    } finally { controller.stop(); }
  });
});
it('fails on a response timeout even when the command was acknowledged', async () => {
  const transport = new FakeSonyTransport('v2'); transport.ackOnly = true;
  const headset = new SonyHeadset(transport, 20);
  await expect(headset.connect(sonyAddress, false, false, 'wh-1000xm5')).rejects.toThrow('did not respond');
  expect(transport.requests.some(r => r.method === 'close')).toBe(true);
});
it('does not guess the local source when the native identity is absent', async () => {
  const transport = new FakeSonyTransport('v1'); transport.includeLocalAddress = false;
  const headset = new SonyHeadset(transport, 100);
  try {
    await headset.connect(sonyAddress, false); await headset.read();
    await expect(headset.disconnectSource('02:00:00:00:00:02')).rejects.toThrow('Bluetooth identity is unavailable');
    expect(transport.packets.some(p => p.payload[0] === 0x3c)).toBe(false);
  } finally { await headset.close(); }
});
it('blocks source writes when the local adapter is absent from the connected source list', async () => {
  const transport = new FakeSonyTransport('v2');
  const headset = new SonyHeadset(transport, 100);
  try {
    await headset.connect(sonyAddress, false, false, 'wh-1000xm5'); await headset.read();
    transport.sources[0].address = '02:00:00:00:00:04';
    await expect(headset.disconnectSource('02:00:00:00:00:02')).rejects.toThrow('Bluetooth identity is unavailable');
    expect(transport.packets.some(p => p.payload[0] === 0x3c)).toBe(false);
  } finally { await headset.close(); }
});
it('leaves unannounced features unavailable and never probes their setting commands', async () => {
  const transport = new FakeSonyTransport('v2'); transport.functions = [0x20];
  const headset = new SonyHeadset(transport, 100);
  try {
    await headset.connect(sonyAddress, false, false, 'wh-1000xm5');
    const { settings } = await headset.read();
    expect(settings).toMatchObject({ battery: 80, mode: null, multipoint: null, sony: { equalizer: null, speakToChat: null, touchSensor: null, wearingDetection: null, dsee: null } });
    const count = transport.packets.length;
    await expect(headset.switch('dsee', true)).rejects.toThrow('unavailable');
    await expect(headset.mode(0)).rejects.toThrow('unavailable');
    expect(transport.packets).toHaveLength(count);
  } finally { await headset.close(); }
});
it('rejects malformed and duplicate Sony source identities', () => {
  expect(() => parseSonySources(Buffer.from([0x37, 0, 1, 0]), 0, localAddress)).toThrow();
  const source = [...Buffer.from(localAddress), 1, 0];
  expect(() => parseSonySources(Buffer.from([0x37, 0, 2, ...source, ...source, 1]), 0, localAddress)).toThrow();
});
