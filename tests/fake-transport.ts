import { EventEmitter } from 'node:events';
import { packet } from '../electron/bmap';
export function modeProfile(index: number, prompt: number, cnc: number, name = prompt === 1 ? 'Quiet' : 'Aware', editable = false): Buffer {
  const data = Buffer.alloc(47); data[0] = index; data[2] = prompt; data[3] = Number(editable); data[4] = 1;
  data.write(name, 6, 32, 'utf8'); data[42] = cnc;
  return data;
}
export class FakeTransport extends EventEmitter {
  writes: Buffer[] = [];
  fields = new Map<string, Buffer>([
    ['0.1', Buffer.from([0, 0x40, 0x39])], ['0.5', Buffer.from('4.0.4')], ['2.2', Buffer.from([78])], ['31.3', Buffer.from([0])],
    ['1.7', Buffer.from([246, 10, 2, 0, 246, 10, 0, 1, 246, 10, 1, 2])], ['1.10', Buffer.from([7])], ['1.11', Buffer.from([1, 2])],
  ]);
  rejectWrites = false;
  ignoreChanges = false;
  silence = false;
  productId = 0x4039;
  audioReady = true;
  bluetoothConnected = false;
  volume = 42;
  volumeWritable = true;
  ignoreVolume = false;
  muted = false;
  nativeRequests: { method: string; params: Record<string, any> }[] = [];
  modeProfiles = [modeProfile(0, 1, 0), modeProfile(1, 2, 10)];
  profileDelayMs = 0;
  replyDelayMs = 0;
  beforeReply?: (request: Buffer) => void;
  multipointApplyAfterReads = 0;
  private pendingMultipoint: Buffer | null = null;
  async request(method: string, params: Record<string, any> = {}): Promise<any> {
    this.nativeRequests.push({ method, params });
    if (method === 'volume' && !this.ignoreVolume) { this.volume = params.value; this.muted = false; }
    if (method === 'list') return [{ address: '00:00:00:00:00:45', name: 'Ghost', productId: this.productId, connected: this.bluetoothConnected }];
    if (method === 'connect') return { productId: this.productId };
    if (['volume', 'audioStatus', 'selectOutput'].includes(method)) return { available: this.audioReady, isDefault: this.audioReady, name: this.audioReady ? 'Ghost' : null, volume: this.audioReady ? this.volume : null, volumeWritable: this.audioReady && this.volumeWritable, muted: this.audioReady ? this.muted : null };
    if (method !== 'write') return {};
    const request = Buffer.from(params.hex, 'hex'); this.writes.push(request);
    this.beforeReply?.(request);
    if (this.silence) return {};
    const [block, fn, op] = request, key = `${block}.${fn}`;
    const payload = request.subarray(4);
    if (key === '31.1' && op === 5) {
      const profiles = Buffer.concat(this.modeProfiles.map(p => packet(31, 6, 3, p)));
      const emitProfiles = () => { this.emit('data', profiles.subarray(0, 3).toString('hex')); this.emit('data', profiles.subarray(3).toString('hex')); };
      queueMicrotask(() => {
        // Mode STATUS frames can precede the PROCESSING acknowledgement.
        if (!this.profileDelayMs) emitProfiles();
        this.emit('data', packet(31, 1, 7).toString('hex'));
        if (this.profileDelayMs) setTimeout(emitProfiles, this.profileDelayMs);
      });
      return {};
    }
    if (key === '1.10' && op === 1 && this.pendingMultipoint && --this.multipointApplyAfterReads <= 0) {
      this.fields.set(key, this.pendingMultipoint); this.pendingMultipoint = null;
    }
    let response: Buffer;
    if (op !== 1 && this.rejectWrites) response = packet(block, fn, 4, [5]);
    else {
      if (!this.ignoreChanges && op !== 1) {
        // Observed protocol: 0x07=on, 0x06=off. Bare 0/1 silently do nothing.
        if (key === '1.10' && payload.length === 1 && (payload[0] & 0xfe) === (this.fields.get(key)![0] & 0xfe)) {
          if (this.multipointApplyAfterReads > 0) this.pendingMultipoint = Buffer.from(payload);
          else this.fields.set(key, Buffer.from(payload));
        }
        if (key === '31.3') this.fields.set(key, Buffer.from([payload[0]]));
        if (key === '1.11') this.fields.set(key, payload);
        if (key === '1.7') { const data = Buffer.from(this.fields.get(key)!); data[payload[1] * 4 + 2] = payload[0]; this.fields.set(key, data); }
      }
      response = packet(block, fn, op === 5 ? 6 : 3, this.fields.get(key) ?? []);
    }
    // Fragment responses, with an unrelated unsolicited frame first.
    const data = Buffer.concat([packet(2, 9, 3, [1]), response]);
    const reply = () => { this.emit('data', data.subarray(0, 3).toString('hex')); this.emit('data', data.subarray(3).toString('hex')); };
    if (this.replyDelayMs) setTimeout(reply, this.replyDelayMs); else queueMicrotask(reply);
    return {};
  }
}
