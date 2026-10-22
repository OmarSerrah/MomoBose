import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { packet, parseDeviceInfo, parseDeviceList, Qc45 } from '../electron/bmap';
import { FakeTransport } from './fake-transport';

// Protocol fixtures follow the captures and official-app layouts documented at
// https://github.com/depau/bosectl-android/blob/main/docs/PROTOCOL.md#14-multipoint-devices-4x--list-connect-disconnect
// These are synthetic host addresses/names, not local hardware identifiers.
const laptop = '02:10:20:30:40:50';
const phone = '02:11:21:31:41:51';
const stale = '02:12:22:32:42:52';
const mac = (address: string) => Buffer.from(address.replace(/:/g, ''), 'hex');
const list = (mask: number, addresses: string[]) => Buffer.concat([Buffer.from([mask]), ...addresses.map(mac)]);
const info = (address: string, flags: number, name: string) => Buffer.concat([
  mac(address), Buffer.from(flags & 4 ? [flags, 0x40, 0x39, 1] : [flags, 2, 3]), Buffer.from(name, 'utf8'),
]);

class DeviceTransport extends FakeTransport {
  listPayload: Buffer | 'unsupported' | 'silent' = list(3, [laptop, phone, stale]);
  infoPayloads = new Map<string, Buffer | 'unsupported' | 'silent'>([
    [laptop, info(laptop, 3, 'Work Mac')], [phone, info(phone, 1, 'Téléphone 📱')],
    [stale, info(stale, 0, 'Old tablet')],
  ]);
  beforeInfo?: (address: string) => void;
  async request(method: string, params: Record<string, any> = {}): Promise<any> {
    const request = method === 'write' ? Buffer.from(params.hex, 'hex') : null;
    if (!request || request[0] !== 4) return super.request(method, params);
    this.nativeRequests.push({ method, params }); this.writes.push(request);
    const fn = request[1];
    const address = [...request.subarray(4)].map(byte => byte.toString(16).padStart(2, '0')).join(':').toUpperCase();
    const payload = fn === 4 ? this.listPayload : this.infoPayloads.get(address) ?? 'unsupported';
    if (fn === 5) this.beforeInfo?.(address);
    if (payload === 'silent') return {};
    const response = payload === 'unsupported' ? packet(4, fn, 4, [4]) : packet(4, fn, 3, payload);
    queueMicrotask(() => {
      const data = Buffer.concat([packet(2, 9, 3, [1]), response]);
      this.emit('data', data.subarray(0, 7).toString('hex'));
      this.emit('data', data.subarray(7).toString('hex'));
    });
    return {};
  }
}

const opened: Qc45[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  for (const device of opened.splice(0)) await device.close();
  vi.useRealTimers();
});
async function run<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(value => ({ ok: true, value }) as const, error => ({ ok: false, error }) as const);
  await vi.runAllTimersAsync();
  const result = await settled;
  if (!result.ok) throw result.error;
  return result.value;
}
async function setup() {
  const transport = new DeviceTransport();
  const device = new Qc45(transport, 1200); opened.push(device);
  await run(device.connect('00:00:00:00:00:45', true));
  transport.writes = []; transport.nativeRequests = [];
  return { device, transport };
}

describe('DeviceManagement protocol fixtures', () => {
  it('interprets the list header as a connection bitmask and follows reordering', () => {
    expect(parseDeviceList(list(2, [phone, laptop, stale]))).toEqual([
      { address: phone, connected: false }, { address: laptop, connected: true }, { address: stale, connected: false },
    ]);
    expect(parseDeviceList(list(1, [laptop, phone, stale])).filter(device => device.connected)).toEqual([
      { address: laptop, connected: true },
    ]);
    expect(parseDeviceList(Buffer.from([0]))).toEqual([]);
    const addresses = Array.from({ length: 8 }, (_, index) => `02:10:20:30:40:0${index}`);
    expect(parseDeviceList(list(0x80, addresses)).filter(device => device.connected)).toEqual([{ address: addresses[7], connected: true }]);
  });

  it('rejects malformed lists instead of treating unknown data as no connections', () => {
    for (const payload of [Buffer.alloc(0), Buffer.from([0, 1]), list(4, [laptop, phone]), list(1, [laptop, laptop]), list(1, Array(9).fill(laptop))]) {
      expect(() => parseDeviceList(payload)).toThrow();
    }
  });

  it('reads full UTF-8 names and local/connection flags at the documented offsets', () => {
    expect(parseDeviceInfo(info(laptop, 3, 'Momo’s Mac'))).toEqual({
      address: laptop, name: 'Momo’s Mac', connected: true, isLocalDevice: true, isComponent: false,
    });
    expect(parseDeviceInfo(info(phone, 0, 'Téléphone 📱')).name).toBe('Téléphone 📱');
    expect(parseDeviceInfo(info(phone, 0, 'Téléphone 📱')).connected).toBe(false);
    expect(parseDeviceInfo(info(stale, 5, 'Bose speaker')).name).toBe('Bose speaker');
    expect(parseDeviceInfo(info(stale, 1, '')).name).toBeNull();
    expect(() => parseDeviceInfo(Buffer.alloc(8))).toThrow();
    const truncatedBose = info(stale, 5, '').subarray(0, 9);
    expect(() => parseDeviceInfo(truncatedBose)).toThrow();
    expect(() => parseDeviceInfo(Buffer.concat([info(phone, 1, ''), Buffer.from([0xff])]))).toThrow();
  });
});

describe('read-only multipoint source discovery', () => {
  it('returns only connected sources, including host identity, alongside the settings snapshot', async () => {
    const { device, transport } = await setup();
    const result = await run(device.read());
    expect(result.connectedDevices).toEqual([
      { address: laptop, name: 'Work Mac', isLocalDevice: true },
      { address: phone, name: 'Téléphone 📱', isLocalDevice: false },
    ]);
    expect(result.settings.multipoint).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(transport.writes.filter(request => request[0] === 4).map(request => request.toString('hex'))).toEqual([
      '04040100', `04050106${mac(laptop).toString('hex')}`, `04050106${mac(phone).toString('hex')}`,
    ]);
    expect(transport.writes.every(request => request[2] === 1)).toBe(true);
    expect(transport.nativeRequests.every(request => request.method === 'write')).toBe(true);
  });

  it('rebuilds the list by MAC after the firmware reorders paired entries', async () => {
    const { device, transport } = await setup();
    await run(device.read());
    transport.listPayload = list(2, [phone, laptop, stale]);
    transport.writes = [];
    expect((await run(device.read())).connectedDevices).toEqual([{ address: laptop, name: 'Work Mac', isLocalDevice: true }]);
    expect(transport.writes.filter(request => request[0] === 4 && request[1] === 5)).toHaveLength(1);
  });

  it('omits sources that disconnect during discovery and Bose component devices', async () => {
    const { device, transport } = await setup();
    transport.infoPayloads.set(laptop, info(laptop, 2, 'Work Mac'));
    transport.infoPayloads.set(phone, info(phone, 9, 'Headset component'));
    expect((await run(device.read())).connectedDevices).toEqual([]);
  });

  it.each([list(0, []), list(0, [laptop, phone, stale])])('reports a confirmed empty connected list without requesting names', async payload => {
    const { device, transport } = await setup(); transport.listPayload = payload;
    expect((await run(device.read())).connectedDevices).toEqual([]);
    expect(transport.writes.filter(request => request[0] === 4 && request[1] === 5)).toHaveLength(0);
  });

  it('does not query connected-source metadata while multipoint is disabled or unavailable', async () => {
    const { device, transport } = await setup();
    for (const payload of [Buffer.from([6]), Buffer.alloc(0)]) {
      transport.fields.set('1.10', payload); transport.writes = [];
      expect((await run(device.read())).connectedDevices).toBeNull();
      expect(transport.writes.filter(request => request[0] === 4)).toHaveLength(0);
    }
  });

  it.each(['unsupported', 'silent', Buffer.alloc(0), Buffer.from([3, 1])])('leaves settings and the control connection usable when list metadata fails (%s)', async payload => {
    const { device, transport } = await setup(); transport.listPayload = payload as Buffer | 'unsupported' | 'silent';
    const result = await run(device.read());
    expect(result.connectedDevices).toBeNull();
    expect(result.settings.battery).toBe(78); expect(result.settings.sidetone).toBe(2);
    expect(result.warnings.some(warning => warning.startsWith('Connected devices:'))).toBe(true);
    expect(transport.nativeRequests.some(request => request.method === 'close')).toBe(false);
    expect((await run(device.exchange(2, 2, 1))).payload[0]).toBe(78);
  });

  it.each(['unsupported', 'silent', Buffer.alloc(0)])('returns unavailable rather than a partially fabricated list when Info fails (%s)', async payload => {
    const { device, transport } = await setup(); transport.infoPayloads.set(phone, payload as Buffer | 'unsupported' | 'silent');
    const result = await run(device.read());
    expect(result.connectedDevices).toBeNull();
    expect(result.warnings.some(warning => warning.startsWith('Connected devices:'))).toBe(true);
    expect(transport.nativeRequests.some(request => request.method === 'close')).toBe(false);
    expect((await run(device.exchange(2, 2, 1))).payload[0]).toBe(78);
  });

  it('matches Info replies by echoed MAC as well as function address', async () => {
    const { device, transport } = await setup();
    transport.beforeInfo = address => {
      const otherAddress = address === phone ? laptop : phone;
      transport.emit('data', packet(4, 5, 3, info(otherAddress, 1, 'Unrelated update')).toString('hex'));
    };
    expect((await run(device.read())).connectedDevices).toEqual([
      { address: laptop, name: 'Work Mac', isLocalDevice: true },
      { address: phone, name: 'Téléphone 📱', isLocalDevice: false },
    ]);
  });

  it('propagates actual transport loss instead of swallowing it as unsupported metadata', async () => {
    const { device, transport } = await setup();
    transport.beforeInfo = () => transport.emit('disconnected');
    await expect(run(device.read())).rejects.toThrow('Headphones disconnected');
  });
});
