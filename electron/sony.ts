import { EventEmitter } from 'node:events';
import type { Transport } from './bmap';
import { ListeningMode, emptySettings, type AudioSource, type SonySettings, type SonySwitch } from '../src/shared/types';

// Sony MDR framing and command tables. Protocol sources and hardware limits:
// docs/sony.md. This backend never sends Bose BMAP packets to a Sony headset.
export type SonyProtocol = 'v1' | 'v2';
export const sonyServices = {
  v1: '96cc203e-5068-46ad-b32d-e316f5e069ba',
  v2: '956c7b26-d49a-4ba8-b03f-b17d393cb6e2',
} as const;
export interface SonyFrame { type: number; sequence: number; payload: Buffer }
export function sonyPacket(type: number, sequence: number, payload: Uint8Array | number[] = []): Buffer {
  if (payload.length > 4096 || ![0, 1].includes(sequence)) throw new Error('Invalid Sony packet.');
  const body = Buffer.alloc(7 + payload.length);
  body[0] = type; body[1] = sequence; body.writeUInt32BE(payload.length, 2);
  body.set(payload, 6);
  body[body.length - 1] = body.subarray(0, -1).reduce((sum, byte) => (sum + byte) & 255, 0);
  const bytes = [0x3e];
  for (const byte of body) {
    if ([0x3c, 0x3d, 0x3e].includes(byte)) bytes.push(0x3d, byte - 0x10);
    else bytes.push(byte);
  }
  return Buffer.from([...bytes, 0x3c]);
}
export class SonyDecoder {
  private body: number[] | null = null;
  private escaped = false;
  reset() { this.body = null; this.escaped = false; }
  push(chunk: Buffer): SonyFrame[] {
    const frames: SonyFrame[] = [];
    for (const byte of chunk) {
      if (byte === 0x3e) { this.body = []; this.escaped = false; continue; }
      if (!this.body) continue;
      if (byte === 0x3c) {
        const body = Buffer.from(this.body), escaped = this.escaped;
        this.reset();
        if (escaped || body.length < 7 || body.readUInt32BE(2) !== body.length - 7 || body[1] > 1 || body.subarray(0, -1).reduce((sum, b) => (sum + b) & 255, 0) !== body[body.length - 1]) continue;
        frames.push({ type: body[0], sequence: body[1], payload: body.subarray(6, -1) });
      } else if (this.escaped) {
        if (![0x2c, 0x2d, 0x2e].includes(byte)) { this.reset(); continue; }
        this.body.push(byte + 0x10); this.escaped = false;
      } else if (byte === 0x3d) this.escaped = true;
      else this.body.push(byte);
      if (this.body && this.body.length > 4103) this.reset();
    }
    return frames;
  }
}
const initialSony = (): SonySettings => ({ ambientLevel: null, focusOnVoice: null, equalizer: null, speakToChat: null, touchSensor: null, wearingDetection: null, dsee: null, sourceManagement: false });
const presetNames: Record<number, string> = { 0: 'Off', 0x10: 'Bright', 0x11: 'Excited', 0x12: 'Mellow', 0x13: 'Relaxed', 0x14: 'Vocal', 0x15: 'Treble boost', 0x16: 'Bass boost', 0x17: 'Speech', 0xa0: 'Manual', 0xa1: 'Custom 1', 0xa2: 'Custom 2' };
function requireValue(condition: unknown, message = 'Invalid Sony response.'): asserts condition { if (!condition) throw new Error(message); }
function textAt(data: Buffer, offset: number): { value: string; end: number } {
  requireValue(offset < data.length && offset + 1 + data[offset] <= data.length);
  const end = offset + 1 + data[offset];
  const value = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(offset + 1, end));
  requireValue(!/[\u0000-\u001f\u007f]/.test(value));
  return { value, end };
}
export function parseSonySources(data: Buffer, inquiry: number, localAddress: string | null): AudioSource[] {
  requireValue([0x37, 0x39].includes(data[0]) && data[1] === inquiry && data.length >= 4 && data[2] <= 8, 'Invalid Sony source list.');
  let offset = 3;
  const sources: AudioSource[] = [];
  for (let index = 0; index < data[2]; index++) {
    requireValue(offset + 19 <= data.length, 'Incomplete Sony source list.');
    const address = data.subarray(offset, offset + 17).toString('ascii').toUpperCase();
    // Connected slots are numbered (1, 2); zero means disconnected.
    requireValue(/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(address) && !['00:00:00:00:00:00', 'FF:FF:FF:FF:FF:FF'].includes(address) && data[offset + 17] <= 2, 'Invalid Sony source identity.');
    const connected = data[offset + 17] !== 0;
    const name = textAt(data, offset + 18); offset = name.end;
    sources.push({ address, name: name.value || null, connected, isLocalDevice: address === localAddress });
  }
  requireValue(offset + 1 === data.length && new Set(sources.map(s => s.address)).size === sources.length, 'Invalid Sony source list.');
  return sources;
}

export class SonyHeadset extends EventEmitter {
  private decoder = new SonyDecoder();
  private active = false;
  private sequence = 0;
  private lastReceived: SonyFrame | null = null;
  private pending: { type: number; sequence: number; opcode?: number; inquiry?: number; ack: boolean; response?: Buffer; resolve: (data: Buffer) => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | null = null;
  private protocol: SonyProtocol = 'v1';
  private functions = new Set<number>();
  private noise: Buffer | null = null;
  private noiseInquiry: number | null = null;
  private batteryInquiry = 0;
  private slots = new Map<'multipoint' | 'touchSensor', { slot: number; settingType: number }>();
  private presets: { id: number; name: string }[] = [];
  private localAddress: string | null = null;
  private sony = initialSony();
  private multipointValue: boolean | null = null;
  private modeValue: number | null = null;
  private rememberedAmbientLevel = 20;
  private rememberedFocusOnVoice = false;
  get latestMode() { return this.modeValue; }
  constructor(private transport: Transport, private timeout = 4500) {
    super();
    transport.on('data', (hex: string) => {
      if (!this.active) return;
      for (const frame of this.decoder.push(Buffer.from(hex, 'hex'))) this.receive(frame);
    });
    transport.on('disconnected', () => { if (this.active) this.invalidate(new Error('Sony headphones disconnected. Turn them on and reconnect.')); });
  }
  private receive(frame: SonyFrame) {
    const pending = this.pending;
    if (frame.type === 1) {
      if (frame.payload.length === 0 && pending && frame.sequence === (pending.sequence ^ 1)) { pending.ack = true; this.finish(); }
      return;
    }
    if (![0x0c, 0x0e].includes(frame.type)) return;
    void this.transport.request('write', { hex: sonyPacket(1, frame.sequence ^ 1).toString('hex') }).catch(error => this.invalidate(error));
    // Retransmissions must be acknowledged again, without reapplying stale state.
    if (this.lastReceived?.sequence === frame.sequence && this.lastReceived.type === frame.type && this.lastReceived.payload.equals(frame.payload)) return;
    this.lastReceived = frame;
    try { this.observe(frame); }
    catch (error) { this.emit('diagnostic', (error as Error).message); }
    if (pending && pending.type === frame.type && frame.payload[0] === pending.opcode && (pending.inquiry === undefined || frame.payload[1] === pending.inquiry)) { pending.response = frame.payload; this.finish(); }
  }
  private finish() {
    const pending = this.pending;
    if (!pending || !pending.ack || (pending.opcode !== undefined && !pending.response)) return;
    clearTimeout(pending.timer); this.pending = null;
    pending.resolve(pending.response ?? Buffer.alloc(0));
  }
  private invalidate(error: Error) {
    const wasActive = this.active;
    this.active = false; this.modeValue = null; this.decoder.reset();
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
    if (wasActive) this.emit('lost', error);
  }
  private exchange(payload: number[] | Buffer, opcode?: number, type = 0x0c): Promise<Buffer> {
    if (!this.active) return Promise.reject(new Error('Connect Sony controls first.'));
    if (this.pending) return Promise.reject(new Error('A Sony command is already in progress.'));
    const sequence = this.sequence; this.sequence ^= 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.invalidate(new Error('Sony controls did not respond. Close Sony Sound Connect on your phone, then reconnect.'));
        void this.transport.request('close').catch(() => {});
      }, this.timeout);
      this.pending = { type, sequence, opcode, inquiry: opcode === undefined ? undefined : payload[1], ack: false, resolve, reject, timer };
      void this.transport.request('write', { hex: sonyPacket(type, sequence, payload).toString('hex') }).catch(error => this.invalidate(error));
    });
  }
  private get(opcode: number, inquiry: number, type = 0x0c) { return this.exchange([opcode, inquiry], opcode + 1, type); }
  private observe({ type, payload: p }: SonyFrame) {
    if (type === 0x0e) {
      if ([0x37, 0x39, 0x3d].includes(p[0])) this.emit('sourcesChanged');
      return;
    }
    const before = JSON.stringify([this.sony, this.multipointValue]);
    if ([0x67, 0x69].includes(p[0]) && p[1] === this.noiseInquiry) {
      if (this.protocol === 'v1') {
        requireValue(p.length === 8 && p[4] <= 2 && p[6] <= 1 && p[7] <= 20);
        this.modeValue = p[2] === 0 ? ListeningMode.Off : p[4] > 0 ? ListeningMode.Quiet : ListeningMode.Aware;
        this.sony.ambientLevel = p[7]; this.sony.focusOnVoice = p[6] === 1;
      } else {
        // WH-1000XM5 announces function 6B / inquiry 17 (mode + ambient level).
        requireValue(p.length === 7 && p[3] <= 1 && p[4] <= 1 && p[5] <= 1 && p[6] <= 20);
        this.modeValue = p[3] === 0 ? ListeningMode.Off : p[4] === 0 ? ListeningMode.Quiet : ListeningMode.Aware;
        this.sony.ambientLevel = p[6]; this.sony.focusOnVoice = p[5] === 1;
      }
      if (this.modeValue === ListeningMode.Aware && this.sony.ambientLevel > 0) {
        this.rememberedAmbientLevel = this.sony.ambientLevel;
        this.rememberedFocusOnVoice = this.sony.focusOnVoice;
      }
      this.noise = Buffer.from(p); this.emit('mode', this.modeValue);
    }
    if ([0x57, 0x59].includes(p[0]) && p[1] === this.eqInquiry) {
      requireValue(p.length === 10 && p[3] === 6 && [...p.subarray(4)].every(v => v <= 20), 'Sony did not provide a six-value equalizer.');
      this.sony.equalizer = { preset: p[2], values: [...p.subarray(4)].map(v => v - 10), presets: this.presets };
    }
    if ([0xd7, 0xd9].includes(p[0])) {
      for (const [setting, slot] of this.slots) {
        if (p[1] !== slot.slot) continue;
        requireValue(p.length === 4 && p[2] === slot.settingType && p[3] <= 1);
        const value = p[3] === (this.protocol === 'v1' ? 1 : 0);
        if (setting === 'multipoint') this.multipointValue = value;
        else this.sony.touchSensor = value;
      }
    }
    if ([0xf7, 0xf9].includes(p[0])) {
      const setting = p[1] === (this.protocol === 'v1' ? 5 : 2) ? 'speakToChat' : p[1] === (this.protocol === 'v1' ? 3 : 1) ? 'wearingDetection' : null;
      if (setting) {
        const index = this.protocol === 'v1' ? 3 : 2;
        requireValue(p.length === index + 1 && p[index] <= 1 && (this.protocol !== 'v1' || p[2] === 0));
        this.sony[setting] = p[index] === (this.protocol === 'v1' ? 1 : 0);
      }
    }
    if ([0xe7, 0xe9].includes(p[0]) && p[1] === (this.protocol === 'v1' ? 2 : 1)) {
      const index = this.protocol === 'v1' ? 3 : 2;
      requireValue(p.length === index + 1 && p[index] <= 1 && (this.protocol !== 'v1' || p[2] === 0));
      this.sony.dsee = p[index] === 1;
    }
    if (before !== JSON.stringify([this.sony, this.multipointValue])) this.emit('settings', { sony: structuredClone(this.sony), multipoint: this.multipointValue });
  }
  private get eqInquiry() { return this.protocol === 'v1' ? 1 : 0; }
  async connect(address: string, _confirmed: boolean, existingOnly = false, model = 'wh-1000xm4') {
    this.protocol = model === 'wh-1000xm5' ? 'v2' : 'v1';
    this.decoder.reset(); this.sequence = 0; this.lastReceived = null; this.functions.clear(); this.slots.clear();
    this.sony = initialSony(); this.noise = null; this.noiseInquiry = null; this.modeValue = null; this.multipointValue = null; this.presets = [];
    this.rememberedAmbientLevel = 20; this.rememberedFocusOnVoice = false;
    const info = await this.transport.request('connect', { address, serviceUuid: sonyServices[this.protocol], ...(existingOnly ? { existingOnly: true } : {}) });
    const local = typeof info?.localAddress === 'string' ? info.localAddress.replaceAll('-', ':').toUpperCase() : '';
    this.localAddress = /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(local) && !['00:00:00:00:00:00', 'FF:FF:FF:FF:FF:FF'].includes(local) ? local : null;
    this.active = true;
    const version = await this.get(0, 0);
    requireValue(version.length >= (this.protocol === 'v1' ? 4 : 8), 'The Sony protocol version could not be verified.');
    if (this.protocol === 'v2') requireValue(version[6] === 0, 'This Sony firmware does not expose the required command table.');
    const support = await this.get(6, 0);
    const stride = this.protocol === 'v1' ? 1 : 2;
    requireValue(support.length === 3 + support[2] * stride, 'Invalid Sony capability list.');
    this.functions = new Set(Array.from({ length: support[2] }, (_, i) => support[3 + i * stride]));
    if (this.protocol === 'v1' && this.functions.has(0x62)) this.noiseInquiry = 2;
    if (this.protocol === 'v2' && this.functions.has(0x6b)) this.noiseInquiry = 0x17;
    this.batteryInquiry = this.protocol === 'v2' && this.functions.has(0x28) ? 8 : 0;
    for (const slot of [0xd1, 0xd2, 0xd3, ...(this.protocol === 'v2' ? [0xd4] : [])]) {
      if (!this.functions.has(slot)) continue;
      const capability = await this.exchange([0xd0, slot, 1], 0xd1);
      try {
        const subject = textAt(capability, this.protocol === 'v1' ? 3 : 4).value;
        const setting = subject === 'MULTIPOINT_SETTING' ? 'multipoint' : subject === 'TOUCH_PANEL_SETTING' ? 'touchSensor' : null;
        if (setting) {
          const value = await this.get(0xd6, slot);
          requireValue(value.length === 4 && value[2] === (this.protocol === 'v1' ? 1 : 0) && value[3] <= 1, 'Unsupported Sony switch format.');
          this.slots.set(setting, { slot, settingType: value[2] });
          this.observe({ type: 0x0c, sequence: 0, payload: value });
        }
      } catch (error) { if (!this.active) throw error; this.emit('diagnostic', (error as Error).message); }
    }
    if (this.functions.has(this.protocol === 'v1' ? 0x51 : 0x50)) {
      const capability = await this.exchange([0x50, this.eqInquiry, 1], 0x51);
      try {
        requireValue(capability.length >= 5 && capability[2] === 6 && capability[3] === 21, 'Unsupported Sony equalizer shape.');
        let offset = 5;
        for (let i = 0; i < capability[4]; i++) {
          requireValue(offset + 1 < capability.length);
          const id = capability[offset], name = textAt(capability, offset + 1);
          this.presets.push({ id, name: name.value || presetNames[id] || `Preset ${id}` }); offset = name.end;
        }
        requireValue(offset === capability.length);
      } catch (error) { this.presets = []; this.emit('diagnostic', (error as Error).message); }
    }
    // v1 announces table-2 peripherals in table 1. v2 advertises table 2 separately.
    if ((this.protocol === 'v1' && this.functions.has(0x38)) || (this.protocol === 'v2' && version[7] === 0)) {
      if (this.protocol === 'v1') this.sony.sourceManagement = true;
      else {
        const peripheralSupport = await this.get(6, 0, 0x0e);
        requireValue(peripheralSupport.length === 3 + peripheralSupport[2] * 2);
        this.sony.sourceManagement = Array.from({ length: peripheralSupport[2] }, (_, i) => peripheralSupport[3 + i * 2]).includes(0x30);
      }
    }
  }
  async close() {
    this.invalidate(new Error('Sony control connection closed.'));
    await this.transport.request('close');
  }
  async readMode() {
    if (this.noiseInquiry === null) return null;
    this.noise = null; this.modeValue = null;
    await this.get(0x66, this.noiseInquiry);
    if (!this.noise) {
      this.sony.ambientLevel = null; this.sony.focusOnVoice = null;
      this.emit('mode', null); this.emit('settings', { sony: structuredClone(this.sony) });
    }
    return this.modeValue;
  }
  async read() {
    const settings = emptySettings(), warnings: string[] = [];
    const read = async (label: string, fn: () => Promise<void>) => {
      try { await fn(); } catch (error) { if (!this.active) throw error; warnings.push(`${label}: ${(error as Error).message}`); }
    };
    if (this.functions.has(this.protocol === 'v1' ? 0x11 : this.batteryInquiry === 8 ? 0x28 : 0x20)) await read('Battery', async () => {
      const p = await this.get(this.protocol === 'v1' ? 0x10 : 0x22, this.batteryInquiry);
      requireValue(p.length >= 4 && p[2] <= 100, 'Sony battery level is unavailable.'); settings.battery = p[2];
    });
    await read('Firmware', async () => { settings.firmware = textAt(await this.get(4, 2), 2).value || null; });
    await read('Listening mode', async () => { await this.readMode(); });
    this.sony.equalizer = null;
    if (this.presets.length) await read('Equalizer', async () => { await this.get(0x56, this.eqInquiry); });
    this.multipointValue = null; this.sony.touchSensor = null;
    for (const slot of this.slots.values()) await read('Sony switch', async () => { await this.get(0xd6, slot.slot); });
    for (const [setting, fn, inquiry] of [
      ['speakToChat', this.protocol === 'v1' ? 0xf5 : 0xf2, this.protocol === 'v1' ? 5 : 2],
      ['wearingDetection', this.protocol === 'v1' ? 0xf3 : 0xf1, this.protocol === 'v1' ? 3 : 1],
      ['dsee', 0xe2, this.protocol === 'v1' ? 2 : 1],
    ] as const) {
      this.sony[setting] = null;
      if (this.functions.has(fn)) await read(setting, async () => { await this.get(setting === 'dsee' ? 0xe6 : 0xf6, inquiry); });
    }
    const connectedDevices = this.sony.sourceManagement ? await this.readConnectedDevices().catch(error => { if (!this.active) throw error; warnings.push(`Sources: ${(error as Error).message}`); return null; }) : null;
    settings.mode = this.modeValue; settings.multipoint = this.multipointValue; settings.sony = structuredClone(this.sony);
    return { settings, warnings, connectedDevices };
  }
  async mode(value: number) {
    requireValue([ListeningMode.Quiet, ListeningMode.Aware, ListeningMode.Off].includes(value as 0 | 1 | 3), 'Choose Noise cancelling, Ambient sound, or Off.');
    await this.setNoise(value, this.rememberedAmbientLevel, this.rememberedFocusOnVoice);
  }
  private async setNoise(mode: number, level: number, voice: boolean) {
    await this.readMode();
    requireValue(this.noise && this.noiseInquiry !== null, 'Noise control is unavailable for this Sony firmware.');
    const payload = this.protocol === 'v1'
      ? [0x68, 2, mode === ListeningMode.Off ? 0 : 0x11, this.noise[3], mode === ListeningMode.Quiet ? 2 : 0, this.noise[5], Number(voice), mode === ListeningMode.Aware ? level : 0]
      : [0x68, 0x17, 1, mode === ListeningMode.Off ? 0 : 1, mode === ListeningMode.Aware ? 1 : 0, Number(voice), mode === ListeningMode.Aware ? level : 0];
    await this.exchange(payload); await this.readMode();
    requireValue(this.modeValue === mode && (mode !== ListeningMode.Aware || (this.sony.ambientLevel === level && this.sony.focusOnVoice === voice)), 'Sony did not confirm the requested listening mode.');
  }
  async ambient(level: number, focusOnVoice: boolean) {
    requireValue(Number.isInteger(level) && level >= 1 && level <= 20 && typeof focusOnVoice === 'boolean', 'Ambient level must be between 1 and 20.');
    await this.setNoise(ListeningMode.Aware, level, focusOnVoice);
  }
  async equalizer(values?: number[], preset?: number) {
    requireValue(this.sony.equalizer, 'Sony equalizer is unavailable.');
    if (values !== undefined) requireValue(Array.isArray(values) && values.length === 6 && values.every(v => Number.isInteger(v) && v >= -10 && v <= 10), 'Sony EQ needs Clear Bass and five bands between −10 and +10.');
    const target = values ? this.presets.find(p => p.id === 0xa0)?.id : preset;
    requireValue(target !== undefined && this.presets.some(p => p.id === target), 'Choose a preset reported by these headphones.');
    await this.exchange([0x58, this.eqInquiry, target, values ? 6 : 0, ...(values?.map(v => v + 10) ?? [])]);
    this.sony.equalizer = null;
    await this.get(0x56, this.eqInquiry);
    const actual = this.sony.equalizer as SonySettings['equalizer'];
    requireValue(actual && actual.preset === target && (!values || actual.values.every((v, i) => v === values[i])), 'Sony did not confirm the equalizer change.');
  }
  async multipoint(value: boolean) { await this.setSlot('multipoint', value); }
  private async setSlot(setting: 'multipoint' | 'touchSensor', value: boolean) {
    requireValue(typeof value === 'boolean' && this.slots.has(setting), 'This Sony setting is unavailable.');
    const slot = this.slots.get(setting)!;
    await this.exchange([0xd8, slot.slot, slot.settingType, this.protocol === 'v1' ? Number(value) : Number(!value)]);
    if (setting === 'multipoint') this.multipointValue = null; else this.sony.touchSensor = null;
    await this.get(0xd6, slot.slot);
    requireValue((setting === 'multipoint' ? this.multipointValue : this.sony.touchSensor) === value, 'Sony did not confirm the switch change.');
  }
  async switch(setting: SonySwitch, value: boolean) {
    requireValue(['touchSensor', 'speakToChat', 'wearingDetection', 'dsee'].includes(setting) && typeof value === 'boolean' && this.sony[setting] !== null, 'This Sony setting is unavailable.');
    if (setting === 'touchSensor') return this.setSlot(setting, value);
    const inquiry = setting === 'dsee' ? (this.protocol === 'v1' ? 2 : 1) : setting === 'speakToChat' ? (this.protocol === 'v1' ? 5 : 2) : (this.protocol === 'v1' ? 3 : 1);
    const encoded = setting === 'dsee' || this.protocol === 'v1' ? Number(value) : Number(!value);
    await this.exchange([setting === 'dsee' ? 0xe8 : 0xf8, inquiry, ...(this.protocol === 'v1' ? [0] : []), encoded]);
    this.sony[setting] = null;
    await this.get(setting === 'dsee' ? 0xe6 : 0xf6, inquiry);
    requireValue(this.sony[setting] === value, 'Sony did not confirm the setting change.');
  }
  async eq(_values: number[]) { throw new Error('Use the Sony five-band equalizer and Clear Bass controls.'); }
  async sidetone(_value: number) { throw new Error('Sony WH-1000XM4/XM5 do not expose adjustable self voice.'); }
  async listSources(): Promise<AudioSource[]> {
    requireValue(this.sony.sourceManagement, 'Source management is unavailable from this Sony firmware.');
    return parseSonySources(await this.get(0x36, this.protocol === 'v1' ? 1 : 0, 0x0e), this.protocol === 'v1' ? 1 : 0, this.localAddress);
  }
  async readConnectedDevices() { return (await this.listSources()).filter(s => s.connected); }
  private async changeSource(address: string, connect: boolean) {
    const sources = await this.listSources();
    const source = sources.find(s => s.address === address.toUpperCase());
    requireValue(this.localAddress && sources.some(s => s.isLocalDevice && s.connected), 'This computer’s Bluetooth identity is unavailable. Use Sony Sound Connect to manage connections.');
    requireValue(source && !source.isLocalDevice, 'Choose another paired source. Manage this computer through Bluetooth settings.');
    if (source.connected === connect) return sources;
    requireValue(!connect || (this.multipointValue === true && sources.filter(s => s.connected).length < 2), 'Free a connection slot and enable multipoint first.');
    const prefix = this.protocol === 'v1' ? [0x3c, 0, 0, Number(connect)] : [0x3c, 0, Number(connect)];
    await this.exchange(Buffer.concat([Buffer.from(prefix), Buffer.from(source.address, 'ascii')]), undefined, 0x0e);
    for (let attempt = 0; attempt < 5; attempt++) {
      const actual = await this.listSources();
      if (actual.find(s => s.address === source.address)?.connected === connect) return actual;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Sony did not confirm the source connection change. Refresh connections before retrying.');
  }
  async connectSource(address: string) { return this.changeSource(address, true); }
  async disconnectSource(address: string) { return this.changeSource(address, false); }
  async replaceSource(oldAddress: string, address: string) {
    const sources = await this.listSources();
    requireValue(this.localAddress && sources.some(s => s.isLocalDevice && s.connected) && oldAddress.toUpperCase() !== address.toUpperCase() && sources.some(s => s.address === oldAddress.toUpperCase() && s.connected && !s.isLocalDevice) && sources.some(s => s.address === address.toUpperCase() && !s.connected && !s.isLocalDevice), 'Choose a connected source and a different saved pairing.');
    requireValue(this.multipointValue === true, 'Enable multipoint before replacing a source.');
    await this.disconnectSource(oldAddress);
    return this.connectSource(address);
  }
}
