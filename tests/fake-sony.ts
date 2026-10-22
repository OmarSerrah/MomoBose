import { EventEmitter } from 'node:events';
import { SonyDecoder, sonyPacket, type SonyProtocol } from '../electron/sony';

export const sonyAddress = '00:11:22:33:44:55';
export const localAddress = '02:00:00:00:00:01';
export class FakeSonyTransport extends EventEmitter {
  requests: { method: string; params: Record<string, any> }[] = [];
  packets: { type: number; sequence: number; payload: Buffer }[] = [];
  ignoreChanges = false;
  silence = false;
  ackOnly = false;
  bluetoothConnected = true;
  includeLocalAddress = true;
  volume = 42;
  rxSequence = 0;
  functions: number[];
  fields = new Map<string, Buffer>();
  sources = [
    { address: localAddress, name: 'This computer', status: 1 },
    { address: '02:00:00:00:00:02', name: 'Phone', status: 2 },
    { address: '02:00:00:00:00:03', name: 'Tablet', status: 0 },
  ];
  constructor(readonly protocol: SonyProtocol) {
    super();
    this.functions = protocol === 'v1' ? [0x11, 0x62, 0x51, 0xd1, 0xd2, 0xe2, 0xf3, 0xf5, 0x38] : [0x20, 0x6b, 0x50, 0xd1, 0xd2, 0xe2, 0xf1, 0xf2];
    const pairs = protocol === 'v1' ? [
      ['102', [0x67, 2, 1, 2, 2, 1, 0, 0]], ['86', [0x57, 1, 0xa0, 6, 10, 10, 10, 10, 10, 10]],
      ['214.209', [0xd7, 0xd1, 1, 1]], ['214.210', [0xd7, 0xd2, 1, 1]], ['246.3', [0xf7, 3, 0, 1]], ['246.5', [0xf7, 5, 0, 0]], ['230.2', [0xe7, 2, 0, 1]],
    ] : [
      ['102', [0x67, 0x17, 1, 1, 0, 0, 0]], ['86', [0x57, 0, 0xa0, 6, 10, 10, 10, 10, 10, 10]],
      ['214.209', [0xd7, 0xd1, 0, 0]], ['214.210', [0xd7, 0xd2, 0, 0]], ['246.1', [0xf7, 1, 0]], ['246.2', [0xf7, 2, 1]], ['230.1', [0xe7, 1, 1]],
    ];
    for (const [key, value] of pairs) this.fields.set(key as string, Buffer.from(value as number[]));
  }
  get device() { return { address: sonyAddress, name: this.protocol === 'v1' ? 'WH-1000XM4' : 'WH-1000XM5', vendorId: 0x012d, connected: this.bluetoothConnected }; }
  notify(payload: number[], type = 0x0c) {
    const packet = sonyPacket(type, this.rxSequence, payload); this.rxSequence ^= 1;
    this.emit('data', packet.subarray(0, 4).toString('hex')); this.emit('data', packet.subarray(4).toString('hex'));
  }
  async request(method: string, params: Record<string, any> = {}): Promise<any> {
    this.requests.push({ method, params });
    if (method === 'list') return [this.device];
    if (method === 'connect') return { ...this.device, ...(this.includeLocalAddress ? { localAddress } : {}) };
    if (method === 'volume') this.volume = params.value;
    if (['volume', 'audioStatus', 'selectOutput'].includes(method)) return { available: true, isDefault: true, name: this.device.name, volume: this.volume, volumeWritable: true, muted: false };
    if (method !== 'write') return {};
    const frame = new SonyDecoder().push(Buffer.from(params.hex, 'hex'))[0];
    if (!frame) throw new Error('Invalid test packet');
    if (frame.type === 1) return {};
    this.packets.push(frame);
    if (this.silence) return {};
    const p = frame.payload, [op, inquiry] = p;
    let response: Buffer | undefined;
    if (op === 0) response = Buffer.from(this.protocol === 'v1' ? [1, 0, 0x70, 0] : [1, 0, 0, 0, 1, 0, 0, 0]);
    else if (op === 6) {
      const functions = frame.type === 0x0e ? [0x30] : this.functions;
      response = Buffer.from([7, 0, functions.length, ...functions.flatMap(fn => this.protocol === 'v1' ? [fn] : [fn, 0])]);
    } else if (op === 4) response = Buffer.from([5, 2, 5, ...Buffer.from('2.0.0')]);
    else if (op === 0xd0) {
      const subject = Buffer.from(inquiry === 0xd1 ? 'TOUCH_PANEL_SETTING' : 'MULTIPOINT_SETTING');
      response = Buffer.from([0xd1, inquiry, ...(this.protocol === 'v1' ? [2] : [0, 1]), subject.length, ...subject, 0]);
    } else if (op === 0x50) response = Buffer.from([0x51, inquiry, 6, 21, 3, 0, 0, 0x10, 0, 0xa0, 0]);
    else if ((op === 0x10 && this.protocol === 'v1') || (op === 0x22 && this.protocol === 'v2')) response = Buffer.from([op + 1, inquiry, 80, 0]);
    else if (op === 0x66 || op === 0x56) response = this.fields.get(String(op));
    else if ([0xd6, 0xe6, 0xf6].includes(op)) response = this.fields.get(`${op}.${inquiry}`);
    else if (op === 0x36 && frame.type === 0x0e) response = Buffer.from([0x37, inquiry, this.sources.length, ...this.sources.flatMap(s => [...Buffer.from(s.address), s.status, Buffer.byteLength(s.name), ...Buffer.from(s.name)]), 1]);
    else if (!this.ignoreChanges) {
      if (op === 0x68) { const value = Buffer.from(p); value[0] = 0x67; this.fields.set('102', value); }
      if (op === 0x58) {
        const value = Buffer.from(this.fields.get('86')!); value[2] = p[2];
        if (p[3]) value.set(p.subarray(4), 4);
        this.fields.set('86', value);
      }
      if ([0xd8, 0xe8, 0xf8].includes(op)) {
        const value = Buffer.from(p); value[0] = op - 1; this.fields.set(`${op - 2}.${inquiry}`, value);
      }
      if (op === 0x3c && frame.type === 0x0e) {
        const offset = this.protocol === 'v1' ? 4 : 3;
        const source = this.sources.find(s => s.address === p.subarray(offset).toString());
        if (source) source.status = p[offset - 1] ? 2 : 0;
      }
    }
    queueMicrotask(() => {
      this.emit('data', sonyPacket(1, frame.sequence ^ 1).toString('hex'));
      if (response && !this.ackOnly) this.notify([...response], frame.type);
    });
    return {};
  }
}
