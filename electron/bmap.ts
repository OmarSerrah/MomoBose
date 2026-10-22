// BMAP packet layouts based on Aaron Bockelie's MIT-licensed bosectl.
// See THIRD_PARTY_NOTICES.md. QC45 uses the 47-byte mode layout, not Ultra's.
// Multipoint corrections: github.com/depau/bosectl-android/blob/main/docs/PROTOCOL.md#4-multipoint-110--bit-0-and-writes-must-preserve-the-other-bits
import { EventEmitter } from 'node:events';
import { ListeningMode, type HeadsetSettings } from '../src/shared/types';

export interface Transport extends EventEmitter {
  request(method: string, params?: Record<string, unknown>): Promise<any>;
}
export interface Frame { block: number; fn: number; op: number; payload: Buffer }
export const packet = (block: number, fn: number, op: number, payload: number[] | Buffer = []): Buffer => {
  if (payload.length > 255) throw new Error('BMAP payload is too large.');
  return Buffer.from([block, fn, op, payload.length, ...payload]);
};
export class FrameDecoder {
  private buffer = Buffer.alloc(0);
  push(chunk: Buffer): Frame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 4096) { this.reset(); throw new Error('Invalid headphone response. Reconnect your QC45.'); }
    const frames: Frame[] = [];
    while (this.buffer.length >= 4) {
      const size = this.buffer[3] + 4;
      if (this.buffer.length < size) break;
      frames.push({ block: this.buffer[0], fn: this.buffer[1], op: this.buffer[2] & 15, payload: Buffer.from(this.buffer.subarray(4, size)) });
      this.buffer = this.buffer.subarray(size);
    }
    return frames;
  }
  reset() { this.buffer = Buffer.alloc(0); }
}
const errors: Record<number, string> = {
  1: 'The headphones rejected the setting format.', 3: 'This feature is unavailable on these headphones.',
  4: 'This setting is unavailable on your firmware.', 5: 'The headphones refused this command. This setting may require the Bose app.',
  6: 'The headphones rejected the setting value.', 8: 'The headphones could not apply this setting.',
  10: 'The headphones are not ready for this change.', 12: 'The headphones are busy. Close the Bose app and retry.',
  20: 'The headphones require an encrypted Bluetooth connection. Pair them in Bluetooth settings.'
};
const signed = (n: number) => n > 127 ? n - 256 : n;
export function parseEq(payload: Buffer): [number, number, number] {
  if (!payload.length || payload.length % 4 !== 0) throw new Error('Invalid EQ response.');
  const bands = new Map<number, number>();
  for (let i = 0; i < payload.length; i += 4) {
    const id = payload[i + 3], value = signed(payload[i + 2]);
    if (id > 2 || bands.has(id) || value < -10 || value > 10) throw new Error('Invalid EQ response.');
    bands.set(id, value);
  }
  if (bands.size !== 3) throw new Error('Incomplete EQ response.');
  return [bands.get(0)!, bands.get(1)!, bands.get(2)!];
}
export function parseMultipoint(payload: Buffer): boolean {
  if (payload.length !== 1) throw new Error('Invalid multipoint status returned.');
  // Bit 0 is the state. Bit 1 is a capability flag and stays set when disabled.
  // Captured enabled/disabled values are 0x07/0x06, not 0x07/0x05.
  return Boolean(payload[0] & 1);
}
export function buildMultipoint(current: Buffer, enabled: boolean): Buffer {
  parseMultipoint(current);
  if (typeof enabled !== 'boolean') throw new Error('Invalid multipoint setting.');
  // Preserve every capability/reserved flag; bare 0/1 writes can be ignored.
  return Buffer.from([(current[0] & 0xfe) | (enabled ? 1 : 0)]);
}
// DeviceManagement formats cross-checked against the official app:
// https://github.com/depau/bosectl-android/blob/main/docs/PROTOCOL.md#14-multipoint-devices-4x--list-connect-disconnect
export interface ConnectedSource {
  address: string;
  name: string | null;
  isLocalDevice: boolean;
}
export interface Source extends ConnectedSource { connected: boolean }
export class SourceChangeError extends Error {
  constructor(
    message: string,
    readonly stage: 'disconnect' | 'connect',
    readonly lastKnownSources: Source[],
    readonly outcomeUncertain: boolean,
    options?: ErrorOptions,
  ) { super(message, options); this.name = 'SourceChangeError'; }
}
function sourceAddress(address: string): string {
  if (typeof address !== 'string' || !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(address)) throw new Error('Choose a valid paired Bluetooth address.');
  const normalized = address.toUpperCase();
  if (normalized === '00:00:00:00:00:00' || normalized === 'FF:FF:FF:FF:FF:FF') throw new Error('Choose a valid paired Bluetooth address.');
  return normalized;
}
const macAddress = (bytes: Buffer): string => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(':').toUpperCase();
export function parseDeviceList(payload: Buffer): { address: string; connected: boolean }[] {
  // Byte 0 is a positional bitmask, not a count. The paired list can reorder
  // between reads, so a mask must only be used with MACs from the same frame.
  if (!payload.length || (payload.length - 1) % 6 !== 0) throw new Error('Invalid connected device list.');
  const count = (payload.length - 1) / 6;
  if (count > 8 || payload[0] >= 2 ** count) throw new Error('Invalid connected device mask.');
  const devices = Array.from({ length: count }, (_, index) => ({
    address: macAddress(payload.subarray(1 + index * 6, 7 + index * 6)),
    connected: Boolean(payload[0] & (1 << index)),
  }));
  if (new Set(devices.map(device => device.address)).size !== count) throw new Error('Duplicate connected device address.');
  return devices;
}
export function parseDeviceInfo(payload: Buffer): ConnectedSource & { connected: boolean; isComponent: boolean } {
  if (payload.length < 9) throw new Error('Invalid connected device info.');
  const flags = payload[6], nameOffset = flags & 4 ? 10 : 9;
  if (payload.length < nameOffset) throw new Error('Invalid connected device info.');
  // Non-Bose devices carry two class bytes; Bose products add a variant byte.
  // The remaining bytes are the UTF-8 name, with no length prefix.
  const name = new TextDecoder('utf-8', { fatal: true }).decode(payload.subarray(nameOffset)).replace(/\0+$/, '').trim();
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error('Invalid connected device name.');
  return {
    address: macAddress(payload.subarray(0, 6)), name: name || null,
    connected: Boolean(flags & 1), isLocalDevice: Boolean(flags & 2), isComponent: Boolean(flags & 8),
  };
}
export function parseMode(payload: Buffer): number {
  if (payload.length !== 1 || payload[0] > 3) throw new Error('Unknown listening mode.');
  return payload[0];
}
export interface ModeProfile {
  index: number;
  name: string;
  prompt: [number, number];
  cncLevel: number;
  editable: boolean;
}
export function parseModeProfile(payload: Buffer): ModeProfile {
  // QC45 STATUS is 47 bytes. Do not read the Ultra's different config tail.
  if (payload.length !== 47 || payload[0] > 3 || payload[42] > 10 || payload[3] > 1) throw new Error('Invalid QC45 mode profile.');
  return {
    index: payload[0], name: payload.subarray(6, 38).toString('utf8').split('\0')[0],
    prompt: [payload[1], payload[2]], cncLevel: payload[42], editable: payload[3] === 1,
  };
}
export function resolveModeSlots(profiles: ModeProfile[]): { quiet: number; aware: number } {
  if (new Set(profiles.map(p => p.index)).size !== profiles.length) throw new Error('Duplicate headphone mode profiles.');
  // Voice-prompt IDs identify built-in modes without relying on display language
  // or slot order. Cross-check the profile: CNC 0=max ANC, 10=transparency.
  const quiet = profiles.filter(p => !p.editable && p.prompt[0] === 0 && p.prompt[1] === 1 && p.cncLevel === 0);
  const aware = profiles.filter(p => !p.editable && p.prompt[0] === 0 && p.prompt[1] === 2 && p.cncLevel === 10);
  if (quiet.length !== 1 || aware.length !== 1) throw new Error('Could not identify Quiet and Aware from the headphone profiles. Reconnect and retry.');
  return { quiet: quiet[0].index, aware: aware[0].index };
}

export class Qc45 extends EventEmitter {
  private decoder = new FrameDecoder();
  private pending: { block: number; fn: number; requestOp: number; responseAddress?: Buffer; responseMatch?: (frame: Frame) => boolean; resolve: (frame: Frame) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null;
  private sourceChangeInProgress = false;
  private lastWrite = 0;
  private active = false;
  private observedRawMode: number | null = null;
  private modeSlots: { quiet: number; aware: number } | null = null;
  private profiles: ModeProfile[] = [];
  get modeProfiles(): ModeProfile[] { return structuredClone(this.profiles); }
  get latestRawMode(): number | null { return this.observedRawMode; }
  get latestMode(): number | null { return this.normalizeMode(this.observedRawMode); }
  private normalizeMode(index: number | null): number | null {
    if (!this.modeSlots || index === null) return null;
    return index === this.modeSlots.quiet ? ListeningMode.Quiet : index === this.modeSlots.aware ? ListeningMode.Aware : ListeningMode.Custom;
  }
  constructor(private transport: Transport, private timeout = 4500) {
    super();
    transport.on('data', (hex: string) => {
      if (!this.active) return;
      try {
        for (const frame of this.decoder.push(Buffer.from(hex, 'hex'))) {
          const p = this.pending;
          if (p && frame.block === p.block && frame.fn === p.fn && (p.requestOp !== 1 || frame.op === 3 || frame.op === 4)
            && (frame.op === 4 || ((!p.responseAddress || frame.payload.subarray(0, 6).equals(p.responseAddress)) && (!p.responseMatch || p.responseMatch(frame))))) {
            this.pending = null; clearTimeout(p.timer);
            if (frame.op === 4) p.reject(new Error(errors[frame.payload[0]] ?? `Headphones returned error ${frame.payload[0] ?? 'unknown'}.`));
            else if ([3, 6, 7].includes(frame.op)) p.resolve(frame);
            else p.reject(new Error('Unexpected headphone response. Reconnect and retry.'));
          }
          // Physical button changes and GET replies share the CurrentMode STATUS
          // format. Process them even when no request is waiting for a response.
          if (frame.block === 31 && frame.fn === 3 && frame.op === 3 && frame.payload.length === 1 && frame.payload[0] <= 3) {
            this.observedRawMode = frame.payload[0];
            this.emit('mode', this.latestMode);
          }
          this.emit('frame', frame);
          if (frame.block === 4 && [4, 5].includes(frame.fn) && frame.op === 3) this.emit('sourcesChanged');
        }
      } catch (error) { this.invalidate(error as Error); }
    });
    transport.on('disconnected', () => this.invalidate(new Error('Headphones disconnected. Turn them on and reconnect.')));
  }
  private invalidate(error: Error) {
    this.active = false; this.observedRawMode = null; this.modeSlots = null; this.profiles = []; this.decoder.reset();
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
    this.emit('lost', error);
  }
  async connect(address: string, confirmedQc45: boolean, existingOnly = false) {
    this.decoder.reset(); this.observedRawMode = null; this.modeSlots = null; this.profiles = [];
    const info = await this.transport.request('connect', { address, channel: 8, ...(existingOnly ? { existingOnly: true } : {}) });
    if ((info?.productId && info.productId !== 0x4039) || (!info?.productId && !confirmedQc45)) {
      await this.transport.request('close');
      throw new Error('MomoBose currently supports QuietComfort 45 only. Select your QC45.');
    }
    this.active = true;
    // Required QC45 ProductInfo initialization; never probe arbitrary diagnostic channels.
    await this.exchange(0, 1, 1);
    try { await this.discoverModeProfiles(); }
    catch (error) {
      if (!this.active) throw error;
      // Other settings can still work. Never guess a mode index after a failed
      // discovery: doing so is exactly what can reverse the two controls.
      this.modeSlots = null;
      this.emit('diagnostic', `Listening modes unavailable: ${(error as Error).message}`);
    }
  }
  async close() {
    this.active = false; this.observedRawMode = null; this.modeSlots = null; this.profiles = [];
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('Connection closed.')); this.pending = null; }
    this.decoder.reset(); await this.transport.request('close');
  }
  async exchange(block: number, fn: number, op: number, payload: number[] | Buffer = []): Promise<Frame> {
    return this.requestFrame(block, fn, op, payload);
  }
  private async requestFrame(block: number, fn: number, op: number, payload: number[] | Buffer = [], options: { optional?: boolean; responseAddress?: Buffer; responseMatch?: (frame: Frame) => boolean; timeoutMessage?: string } = {}): Promise<Frame> {
    if (!this.active) throw new Error('Connect your QC45 first.');
    if (this.pending) throw new Error('A headphone command is already in progress.');
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (options.optional) {
          // Optional firmware metadata may be unsupported without an ERROR
          // reply. Leave the working audio/control connection untouched.
          this.pending = null;
          reject(new Error(options.timeoutMessage ?? 'Connected device information did not respond.'));
          return;
        }
        this.invalidate(new Error('The headphones did not respond. Close the Bose app, then reconnect.'));
        void this.transport.request('close').catch(() => {});
      }, options.optional ? Math.min(this.timeout, 1800) : this.timeout);
      this.pending = { block, fn, requestOp: op, responseAddress: options.responseAddress, responseMatch: options.responseMatch, resolve, reject, timer };
      const delay = Math.max(0, 200 - (Date.now() - this.lastWrite));
      setTimeout(() => {
        if (!this.pending || this.pending.timer !== timer || !this.active) return;
        this.lastWrite = Date.now();
        this.transport.request('write', { hex: packet(block, fn, op, payload).toString('hex') }).catch(error => this.invalidate(error));
      }, delay);
    });
  }
  private async get(block: number, fn: number): Promise<Buffer> {
    const result = await this.exchange(block, fn, 1);
    if (result.op !== 3) throw new Error('Headphones did not return the requested setting.');
    return result.payload;
  }
  private async discoverModeProfiles() {
    const profiles = new Map<number, Buffer>();
    let conflictingProfiles = false;
    let quietTimer: NodeJS.Timeout | undefined;
    let finish: (() => void) | undefined;
    const collect = (frame: Frame) => {
      if (frame.block !== 31 || frame.fn !== 6 || frame.op !== 3 || !frame.payload.length) return;
      const previous = profiles.get(frame.payload[0]);
      if (previous && !previous.equals(frame.payload)) conflictingProfiles = true;
      profiles.set(frame.payload[0], Buffer.from(frame.payload));
      if (quietTimer) { clearTimeout(quietTimer); quietTimer = setTimeout(() => finish?.(), 500); }
    };
    this.on('frame', collect);
    let deadline: NodeJS.Timeout | undefined;
    try {
      // AudioModes.GetAll START only requests a state dump. Collect every
      // ModeConfig STATUS, including frames sent before the acknowledgement.
      await this.exchange(31, 1, 5);
      await new Promise<void>(resolve => {
        finish = resolve;
        quietTimer = setTimeout(resolve, 500);
        deadline = setTimeout(resolve, 2500);
      });
      if (!this.active) throw new Error('Headphones disconnected while reading mode profiles.');
      if (conflictingProfiles) throw new Error('Headphone profiles changed during discovery. Reconnect and retry.');
      this.profiles = [...profiles.values()].map(parseModeProfile);
      for (const profile of this.profiles) this.emit('diagnostic', `Mode slot ${profile.index}: ${profile.name || '(unnamed)'}, prompt ${profile.prompt.join('.')}, CNC ${profile.cncLevel}, ${profile.editable ? 'custom' : 'preset'}.`);
      this.modeSlots = resolveModeSlots(this.profiles);
      this.emit('diagnostic', `Resolved listening modes: Quiet → slot ${this.modeSlots.quiet}; Aware → slot ${this.modeSlots.aware}.`);
    } finally {
      clearTimeout(quietTimer); clearTimeout(deadline); this.off('frame', collect);
    }
  }
  async readMode(): Promise<number | null> {
    if (!this.modeSlots) return null;
    return this.normalizeMode(parseMode(await this.get(31, 3)));
  }
  async readConnectedDevices(): Promise<ConnectedSource[]> {
    const list = await this.requestFrame(4, 4, 1, [], { optional: true });
    const connected: ConnectedSource[] = [];
    for (const entry of parseDeviceList(list.payload).filter(device => device.connected)) {
      const address = Buffer.from(entry.address.replace(/:/g, ''), 'hex');
      const frame = await this.requestFrame(4, 5, 1, address, { optional: true, responseAddress: address });
      const info = parseDeviceInfo(frame.payload);
      // A source can drop between ListDevices and Info. Component devices are
      // parts of a Bose product rather than the phone/computer sources.
      if (info.connected && !info.isComponent) connected.push({ address: info.address, name: info.name, isLocalDevice: info.isLocalDevice });
    }
    return connected;
  }
  /** Paired sources, keyed by MAC. Array order is neither priority nor active audio. */
  async readPairedSources(): Promise<Source[]> {
    const list = await this.requestFrame(4, 4, 1, [], { optional: true });
    const sources: Source[] = [];
    for (const entry of parseDeviceList(list.payload)) {
      const address = Buffer.from(entry.address.replace(/:/g, ''), 'hex');
      const frame = await this.requestFrame(4, 5, 1, address, { optional: true, responseAddress: address });
      const info = parseDeviceInfo(frame.payload);
      if (!info.isComponent) sources.push({ address: info.address, name: info.name, isLocalDevice: info.isLocalDevice, connected: info.connected });
    }
    return sources;
  }
  async listSources(): Promise<Source[]> { return this.readPairedSources(); }
  private pairedSource(sources: Source[], address: string): Source {
    const source = sources.find(source => source.address === address);
    if (!source) throw new Error('That device is not a paired audio source. Pair it in Bluetooth settings first.');
    return source;
  }
  private async changeSources<T>(operation: () => Promise<T>): Promise<T> {
    if (this.sourceChangeInProgress) throw new Error('A source change is already in progress.');
    this.sourceChangeInProgress = true;
    try { return await operation(); } finally { this.sourceChangeInProgress = false; }
  }
  private async checkConnectionSlot(sources: Source[]) {
    const connected = sources.filter(source => source.connected).length;
    if (connected >= 2) throw new Error('Both connection slots are occupied. Choose a device to replace first.');
    if (connected && !parseMultipoint(await this.get(1, 10))) throw new Error('Enable multipoint before adding a second connected source.');
  }
  private async setSourceConnected(address: string, connected: boolean, sources: Source[]): Promise<Source[]> {
    const stage = connected ? 'connect' : 'disconnect';
    let lastKnownSources = sources;
    try {
      const mac = Buffer.from(address.replace(/:/g, ''), 'hex');
      // Official-app DeviceManagement START formats, captured by depau (§14).
      // PROCESSING only acknowledges receipt. Independent GETs confirm success.
      // Never use RemoveDevice (4.3), ClearDeviceList (4.7), or guessed routing.
      await this.requestFrame(4, connected ? 1 : 2, 5, connected ? Buffer.concat([Buffer.from([0]), mac]) : mac, {
        optional: true, timeoutMessage: 'The source command was not acknowledged; its outcome is unknown.',
        responseMatch: frame => {
          if (connected) return frame.op === 7 && frame.payload.equals(mac);
          return (frame.op === 7 && frame.payload.length === 7 && frame.payload.subarray(1).equals(mac))
            || (frame.op === 6 && frame.payload.equals(mac));
        },
      });
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        lastKnownSources = await this.readPairedSources();
        if (this.pairedSource(lastKnownSources, address).connected === connected) return lastKnownSources;
      }
      throw new Error(`The headphones did not confirm the device ${connected ? 'connected' : 'disconnected'}. Refresh the sources before retrying.`);
    } catch (cause) {
      throw new SourceChangeError(
        this.active ? `Could not ${stage} the source: ${(cause as Error).message}` : 'The control connection was lost. Reconnect and refresh sources before making another change.',
        stage, lastKnownSources, true, { cause },
      );
    }
  }
  /** Call only for an explicit user action, serialized with settings reads/polls. */
  async connectSource(value: string): Promise<Source[]> {
    const address = sourceAddress(value);
    return this.changeSources(async () => {
      const sources = await this.readPairedSources();
      if (this.pairedSource(sources, address).connected) return sources;
      await this.checkConnectionSlot(sources);
      return this.setSourceConnected(address, true, sources);
    });
  }
  async disconnectSource(value: string): Promise<Source[]> {
    const address = sourceAddress(value);
    return this.changeSources(async () => {
      const sources = await this.readPairedSources(), source = this.pairedSource(sources, address);
      if (!source.connected) return sources;
      // Dropping this host can remove RFCOMM before RESULT or readback arrives.
      if (source.isLocalDevice) throw new Error('Disconnecting this Mac would also remove headphone controls. Use Bluetooth settings or the Bose app on another device.');
      return this.setSourceConnected(address, false, sources);
    });
  }
  async replaceSource(oldValue: string, newValue: string): Promise<Source[]> {
    const oldAddress = sourceAddress(oldValue), newAddress = sourceAddress(newValue);
    if (oldAddress === newAddress) throw new Error('Choose a different paired device to connect.');
    return this.changeSources(async () => {
      const sources = await this.readPairedSources();
      const oldSource = this.pairedSource(sources, oldAddress), newSource = this.pairedSource(sources, newAddress);
      if (!oldSource.connected || newSource.connected) throw new Error('Refresh sources and choose a connected device to replace with a disconnected paired device.');
      if (oldSource.isLocalDevice) throw new Error('Replacing this Mac would also remove headphone controls. Use Bluetooth settings or the Bose app on another device.');
      // Establish all prerequisites before dropping anything. There is no rollback:
      // auto-reconnecting the old source could displace another live connection.
      if (!parseMultipoint(await this.get(1, 10))) throw new Error('Enable multipoint before replacing a connected source.');
      const disconnected = await this.setSourceConnected(oldAddress, false, sources);
      try {
        this.pairedSource(disconnected, newAddress);
        if (this.pairedSource(disconnected, newAddress).connected) return disconnected;
        await this.checkConnectionSlot(disconnected);
      } catch (cause) {
        throw new SourceChangeError(`The old source disconnected, but the replacement cannot connect: ${(cause as Error).message}`, 'connect', disconnected, false, { cause });
      }
      return this.setSourceConnected(newAddress, true, disconnected);
    });
  }
  async selectSource(value: string): Promise<never> {
    sourceAddress(value);
    // aaronsb documents 4.12 START [82, MAC] for other models; depau finds it
    // FuncNotSupp. No QC45-verified routing/capability gate exists in either
    // source. Do not infer it from carousel flags or silently disconnect peers.
    throw new Error('Selecting a primary audio source is not verified for QC45. Pause audio on the current device, then play on the other connected device; or explicitly disconnect the other source.');
  }
  async read(): Promise<{ settings: HeadsetSettings; warnings: string[]; connectedDevices: ConnectedSource[] | null }> {
    const warnings: string[] = [];
    const read = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      try { return await fn(); } catch (e) { if (!this.active) throw e; warnings.push(`${label}: ${(e as Error).message}`); return null; }
    };
    const battery = await read('Battery', async () => {
      const p = await this.get(2, 2);
      if (!p.length || p[0] > 100) throw new Error('Battery level unavailable.');
      return p[0];
    });
    const firmware = await read('Firmware', async () => (await this.get(0, 5)).toString('utf8').replace(/\0/g, ''));
    const mode = await read('Listening mode', () => this.readMode());
    if (!this.modeSlots) warnings.push('Quiet and Aware could not be identified. Reconnect to reload headphone modes.');
    const eq = await read('Equalizer', async () => parseEq(await this.get(1, 7)));
    const multipoint = await read('Multipoint', async () => parseMultipoint(await this.get(1, 10)));
    const sidetone = await read('Self voice', async () => {
      const p = await this.get(1, 11);
      if (p.length < 2 || p[1] > 3) throw new Error('Self voice level unavailable.');
      return p[1];
    });
    const connectedDevices = multipoint === true ? await read('Connected devices', () => this.readConnectedDevices()) : null;
    // Kept alongside settings so callers can integrate the optional metadata
    // without changing the established settings snapshot or write contract.
    return { settings: { battery, firmware, mode, eq, multipoint, sidetone }, warnings, connectedDevices };
  }
  async mode(value: number) {
    if (value !== ListeningMode.Quiet && value !== ListeningMode.Aware) throw new Error('Choose Quiet or Aware.');
    if (!this.modeSlots) throw new Error('Quiet and Aware have not been identified. Reconnect your headphones.');
    const index = value === ListeningMode.Quiet ? this.modeSlots.quiet : this.modeSlots.aware;
    // Explicit user selections request the headphone's own spoken mode name.
    // Passive discovery and physical-button synchronization never switch modes.
    await this.exchange(31, 3, 5, [index, 1]);
    await new Promise(r => setTimeout(r, 350));
    if (await this.readMode() !== value) throw new Error('Listening mode did not change. Please retry.');
  }
  async eq(values: [number, number, number]) {
    if (values.length !== 3 || !values.every(v => Number.isInteger(v) && v >= -10 && v <= 10)) throw new Error('EQ values must be whole numbers from −10 to +10.');
    for (let band = 0; band < 3; band++) await this.exchange(1, 7, 2, [values[band] & 255, band]);
    const actual = parseEq(await this.get(1, 7));
    if (!actual.every((v, i) => v === values[i])) throw new Error('The headphones did not keep every EQ setting. Refresh to see the current values.');
  }
  async multipoint(enabled: boolean) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid multipoint setting.');
    const current = await this.get(1, 10);
    const actual = parseMultipoint(current);
    this.emit('diagnostic', `Multipoint read: 0x${current.toString('hex')} (${actual ? 'on' : 'off'}).`);
    if (actual === enabled) return;
    const payload = buildMultipoint(current, enabled);
    this.emit('diagnostic', `Multipoint write: 0x${payload.toString('hex')} (${enabled ? 'on' : 'off'}), preserving other flags.`);
    await this.exchange(1, 10, 2, payload);
    // Acknowledging the write is not proof that the asynchronous change applied.
    for (const delay of [250, 350, 500, 750, 1000]) {
      await new Promise(r => setTimeout(r, delay));
      const reported = await this.get(1, 10);
      const reportedState = parseMultipoint(reported);
      this.emit('diagnostic', `Multipoint readback: 0x${reported.toString('hex')} (${reportedState ? 'on' : 'off'}).`);
      if (reportedState === enabled) return;
    }
    throw new Error(`Multipoint is still ${enabled ? 'off' : 'on'}. The headphones did not apply the change. Reconnect and retry.`);
  }
  async sidetone(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 3) throw new Error('Invalid self voice level.');
    await this.exchange(1, 11, 2, [1, value]);
    if ((await this.get(1, 11))[1] !== value) throw new Error('Self voice did not change. Please retry.');
  }
}
