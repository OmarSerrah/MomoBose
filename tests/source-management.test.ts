import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { packet, Qc45, SourceChangeError } from '../electron/bmap';
import { FakeTransport } from './fake-transport';

// Synthetic fixtures for the official-app layouts and captures in:
// https://github.com/depau/bosectl-android/blob/main/docs/PROTOCOL.md#14-multipoint-devices-4x--list-connect-disconnect
// These exercise protocol sequencing only; no native helper or hardware is used.
const host = '02:10:20:30:40:50', phone = '02:11:21:31:41:51', tablet = '02:12:22:32:42:52';
const mac = (address: string) => Buffer.from(address.replace(/:/g, ''), 'hex');
const addressOf = (payload: Buffer) => [...payload].map(byte => byte.toString(16).padStart(2, '0')).join(':').toUpperCase();
class SourceTransport extends FakeTransport {
  sources = [
    { address: host, connected: true, local: true, component: false, name: 'Work Mac' },
    { address: phone, connected: true, local: false, component: false, name: 'Téléphone 📱' },
    { address: tablet, connected: false, local: false, component: false, name: 'Tablet' },
  ];
  applyAfterReads = 2;
  pendingChange: { address: string; connected: boolean; remaining: number } | null = null;
  ignoreChanges = false;
  rejectFn: number | null = null;
  loseOnDisconnect = false;
  failReadback = false;
  wrongAcknowledgement = false;
  beforeInfo?: (address: string) => void;
  async request(method: string, params: Record<string, any> = {}): Promise<any> {
    const request = method === 'write' ? Buffer.from(params.hex, 'hex') : null;
    if (!request || request[0] !== 4) return super.request(method, params);
    this.nativeRequests.push({ method, params }); this.writes.push(request);
    const [, fn, op] = request, payload = request.subarray(4);
    let response: Buffer;
    if (fn === this.rejectFn) response = packet(4, fn, 4, [4]);
    else if (fn === 4 && op === 1) {
      if (this.failReadback && this.pendingChange) response = packet(4, fn, 4, [4]);
      else {
        if (this.pendingChange && --this.pendingChange.remaining <= 0 && !this.ignoreChanges) {
          this.sources.find(source => source.address === this.pendingChange!.address)!.connected = this.pendingChange.connected;
          this.pendingChange = null;
        }
        // Reordering is deliberate. Every mask belongs to its own frame.
        this.sources.reverse();
        const mask = this.sources.reduce((mask, source, index) => mask | (Number(source.connected) << index), 0);
        response = packet(4, fn, 3, Buffer.concat([Buffer.from([mask]), ...this.sources.map(source => mac(source.address))]));
      }
    } else if (fn === 5 && op === 1) {
      const address = addressOf(payload); this.beforeInfo?.(address);
      const source = this.sources.find(source => source.address === address);
      response = source ? packet(4, fn, 3, Buffer.concat([
        mac(source.address), Buffer.from([Number(source.connected) | (Number(source.local) << 1) | (Number(source.component) << 3), 2, 3]), Buffer.from(source.name),
      ])) : packet(4, fn, 4, [6]);
    } else if ((fn === 1 || fn === 2) && op === 5) {
      const address = addressOf(fn === 1 ? payload.subarray(1) : payload);
      if (fn === 2 && this.loseOnDisconnect) { queueMicrotask(() => this.emit('disconnected')); return {}; }
      this.pendingChange = { address, connected: fn === 1, remaining: this.applyAfterReads };
      const echoedMac = this.wrongAcknowledgement ? mac(host) : mac(address);
      response = packet(4, fn, 7, fn === 2 ? Buffer.concat([Buffer.from([0x21]), echoedMac]) : echoedMac);
      // Late disconnect RESULT is not a reply to the next ListDevices GET.
      if (fn === 2 && !this.wrongAcknowledgement) response = Buffer.concat([response, packet(4, fn, 6, echoedMac)]);
    } else response = packet(4, fn, 4, [4]);
    queueMicrotask(() => {
      const data = Buffer.concat([packet(2, 9, 3, [1]), response]);
      this.emit('data', data.subarray(0, 5).toString('hex'));
      this.emit('data', data.subarray(5).toString('hex'));
    });
    return {};
  }
}
const opened: Qc45[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => { for (const device of opened.splice(0)) await device.close(); vi.useRealTimers(); });
async function run<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(value => ({ ok: true, value }) as const, error => ({ ok: false, error }) as const);
  await vi.runAllTimersAsync();
  const result = await settled;
  if (!result.ok) throw result.error;
  return result.value;
}
async function setup() {
  const transport = new SourceTransport(), device = new Qc45(transport, 1200); opened.push(device);
  await run(device.connect('00:00:00:00:00:45', true));
  transport.writes = []; transport.nativeRequests = [];
  return { device, transport };
}
const commands = (transport: SourceTransport) => transport.writes.filter(request => request[2] !== 1);

describe('paired source management', () => {
  it('lists connected and disconnected paired sources without invented order or audio priority', async () => {
    const { device, transport } = await setup();
    const sources = await run(device.listSources());
    expect(sources).toHaveLength(3);
    expect(sources.find(source => source.address === host)).toEqual({ address: host, name: 'Work Mac', connected: true, isLocalDevice: true });
    expect(sources.find(source => source.address === tablet)).toEqual({ address: tablet, name: 'Tablet', connected: false, isLocalDevice: false });
    expect(await run(device.readPairedSources())).toEqual([...sources].reverse());
    expect(commands(transport)).toEqual([]);
  });

  it('excludes component devices and rejects incomplete paired metadata', async () => {
    const { device, transport } = await setup();
    transport.sources.find(source => source.address === tablet)!.component = true;
    expect(await run(device.listSources())).toHaveLength(2);
    transport.rejectFn = 5;
    await expect(run(device.listSources())).rejects.toThrow('unavailable');
    expect(commands(transport)).toEqual([]);
    expect((await run(device.exchange(2, 2, 1))).payload[0]).toBe(78);
  });

  it('disconnects, verifies the old MAC is disconnected, then connects and verifies the replacement', async () => {
    const { device, transport } = await setup();
    const sources = await run(device.replaceSource(phone.toLowerCase(), tablet.toLowerCase()));
    expect(sources.find(source => source.address === host)?.connected).toBe(true);
    expect(sources.find(source => source.address === phone)?.connected).toBe(false);
    expect(sources.find(source => source.address === tablet)?.connected).toBe(true);
    expect(sources).toHaveLength(3); // Disconnect is not unpairing.
    expect(commands(transport).map(request => request.toString('hex'))).toEqual([
      `04020506${mac(phone).toString('hex')}`, `0401050700${mac(tablet).toString('hex')}`,
    ]);
    const disconnectIndex = transport.writes.findIndex(request => request[0] === 4 && request[1] === 2);
    const connectIndex = transport.writes.findIndex(request => request[0] === 4 && request[1] === 1);
    const readback = transport.writes.slice(disconnectIndex + 1, connectIndex);
    expect(readback.filter(request => request[0] === 4 && request[1] === 4)).toHaveLength(2);
    expect(readback.filter(request => request[0] === 4 && request[1] === 5 && request.subarray(4).equals(mac(phone)))).toHaveLength(2);
    expect(transport.nativeRequests.every(request => request.method === 'write')).toBe(true);
  });

  it('requires confirmed disconnect, not PROCESSING/RESULT, before connecting anything', async () => {
    const { device, transport } = await setup(); transport.ignoreChanges = true;
    const error = await run(device.replaceSource(phone, tablet)).catch(error => error);
    expect(error).toBeInstanceOf(SourceChangeError);
    expect(error.stage).toBe('disconnect'); expect(error.outcomeUncertain).toBe(true);
    expect(error.lastKnownSources.find((source: { address: string }) => source.address === phone).connected).toBe(true);
    expect(commands(transport).map(request => request[1])).toEqual([2]);
    expect(transport.nativeRequests.some(request => request.method === 'close')).toBe(false);
  });

  it('reports partial replacement if the new source fails without reconnecting or unpairing the old one', async () => {
    const { device, transport } = await setup(); transport.rejectFn = 1;
    const error = await run(device.replaceSource(phone, tablet)).catch(error => error);
    expect(error).toBeInstanceOf(SourceChangeError); expect(error.stage).toBe('connect');
    expect(error.lastKnownSources.find((source: { address: string }) => source.address === phone).connected).toBe(false);
    expect(commands(transport).map(request => request[1])).toEqual([2, 1]);
    expect((await run(device.exchange(2, 2, 1))).payload[0]).toBe(78);
  });

  it.each(['unsupported', 'lost', 'readback', 'wrongMac'])('aborts replacement safely when disconnect fails (%s)', async failure => {
    const { device, transport } = await setup();
    transport.rejectFn = failure === 'unsupported' ? 2 : null;
    transport.loseOnDisconnect = failure === 'lost'; transport.failReadback = failure === 'readback';
    transport.wrongAcknowledgement = failure === 'wrongMac';
    const error = await run(device.replaceSource(phone, tablet)).catch(error => error);
    expect(error).toBeInstanceOf(SourceChangeError); expect(error.stage).toBe('disconnect');
    expect(commands(transport).map(request => request[1])).toEqual([2]);
    if (failure === 'lost') expect(error.message).toContain('control connection was lost');
    else expect((await run(device.exchange(2, 2, 1))).payload[0]).toBe(78);
  });

  it('does not let a concurrent source change interleave with replacement', async () => {
    const { device, transport } = await setup();
    const replacement = device.replaceSource(phone, tablet);
    await expect(device.disconnectSource(phone)).rejects.toThrow('already in progress');
    await run(replacement);
    expect(commands(transport).map(request => request[1])).toEqual([2, 1]);
  });

  it('blocks invalid addresses, unknown pairings, same-source replacement and occupied targets before writes', async () => {
    const { device, transport } = await setup();
    for (const invalid of ['', '02:10:20:30:40', '02:10:20:30:40:zz', 'FF:FF:FF:FF:FF:FF', '00:00:00:00:00:00']) {
      await expect(device.connectSource(invalid)).rejects.toThrow('valid paired Bluetooth address');
    }
    await expect(run(device.connectSource('02:99:99:99:99:99'))).rejects.toThrow('not a paired');
    await expect(device.replaceSource(phone, phone)).rejects.toThrow('different');
    await expect(run(device.replaceSource(phone, host))).rejects.toThrow('disconnected paired');
    await expect(run(device.replaceSource(tablet, phone))).rejects.toThrow('connected device');
    expect(commands(transport)).toEqual([]);
  });

  it('blocks disconnecting/replacing the local control host before writes', async () => {
    const { device, transport } = await setup();
    await expect(run(device.disconnectSource(host))).rejects.toThrow('remove headphone controls');
    await expect(run(device.replaceSource(host, tablet))).rejects.toThrow('remove headphone controls');
    expect(commands(transport)).toEqual([]);
  });

  it('requires a free slot and multipoint when connecting a second device', async () => {
    const { device, transport } = await setup();
    await expect(run(device.connectSource(tablet))).rejects.toThrow('slots are occupied');
    transport.sources.find(source => source.address === phone)!.connected = false;
    transport.fields.set('1.10', Buffer.from([6]));
    await expect(run(device.connectSource(tablet))).rejects.toThrow('Enable multipoint');
    await expect(run(device.replaceSource(host, tablet))).rejects.toThrow('remove headphone controls');
    expect(commands(transport)).toEqual([]);
    transport.fields.set('1.10', Buffer.from([7]));
    const sources = await run(device.connectSource(tablet));
    expect(sources.find(source => source.address === tablet)?.connected).toBe(true);
    expect(commands(transport).map(request => request[1])).toEqual([1]);
  });

  it('checks multipoint before disconnecting the old source in a replacement', async () => {
    const { device, transport } = await setup(); transport.fields.set('1.10', Buffer.from([6]));
    await expect(run(device.replaceSource(phone, tablet))).rejects.toThrow('Enable multipoint');
    expect(commands(transport)).toEqual([]);
  });

  it('reports the confirmed partial state if multipoint becomes unavailable after disconnect', async () => {
    const { device, transport } = await setup();
    transport.beforeInfo = address => {
      if (address === phone && !transport.sources.find(source => source.address === phone)!.connected) {
        transport.fields.set('1.10', Buffer.from([6]));
      }
    };
    const error = await run(device.replaceSource(phone, tablet)).catch(error => error);
    expect(error).toBeInstanceOf(SourceChangeError); expect(error.stage).toBe('connect');
    expect(error.outcomeUncertain).toBe(false);
    expect(error.lastKnownSources.find((source: { address: string }) => source.address === phone).connected).toBe(false);
    expect(commands(transport).map(request => request[1])).toEqual([2]);
  });

  it('supports explicit disconnect with readback and no-op requests without writes', async () => {
    const { device, transport } = await setup();
    expect((await run(device.connectSource(phone))).find(source => source.address === phone)?.connected).toBe(true);
    expect((await run(device.disconnectSource(tablet))).find(source => source.address === tablet)?.connected).toBe(false);
    expect(commands(transport)).toEqual([]);
    expect((await run(device.disconnectSource(phone))).find(source => source.address === phone)?.connected).toBe(false);
    expect(commands(transport).map(request => request[1])).toEqual([2]);
  });

  it('does not guess routing, primary order or active-audio semantics from a source selection', async () => {
    const { device, transport } = await setup();
    await expect(device.selectSource(phone)).rejects.toThrow('not verified for QC45');
    expect(transport.writes).toEqual([]);
  });
});
