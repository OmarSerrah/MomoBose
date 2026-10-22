import { describe, expect, it, afterEach } from 'vitest';
import { FrameDecoder, packet, parseEq, parseMultipoint, buildMultipoint, parseModeProfile, resolveModeSlots, Qc45 } from '../electron/bmap';
import { FakeTransport, modeProfile } from './fake-transport';
const opened: Qc45[] = [];
afterEach(async () => { for (const device of opened.splice(0)) await device.close(); });
async function setup(configure?: (transport: FakeTransport) => void) { const transport = new FakeTransport(); configure?.(transport); const device = new Qc45(transport, 1200); opened.push(device); await device.connect('00:00:00:00:00:45', true); return { transport, device }; }
describe('BMAP framing and QC45 payloads', () => {
  it('identifies mode profiles using prompt identity and CNC rather than slot or translated name', () => {
    const profiles = [modeProfile(1, 1, 0, 'Silenzioso'), modeProfile(0, 2, 10, 'Suoni esterni'), modeProfile(2, 1, 0, 'Office', true)].map(parseModeProfile);
    expect(resolveModeSlots(profiles)).toEqual({ quiet: 1, aware: 0 });
    expect(() => parseModeProfile(Buffer.alloc(48))).toThrow('Invalid');
    const malformed = modeProfile(0, 1, 11); expect(() => parseModeProfile(malformed)).toThrow('Invalid');
    expect(() => resolveModeSlots([profiles[0], profiles[0], profiles[1]])).toThrow('Duplicate');
    expect(() => resolveModeSlots([parseModeProfile(modeProfile(1, 1, 10)), profiles[1]])).toThrow('Could not identify');
  });
  it('handles partial packets, concatenated frames, and high flag bits', () => {
    const decoder = new FrameDecoder(); const bytes = Buffer.concat([packet(1, 10, 0x83, [7]), packet(2, 2, 3, [78])]);
    expect(decoder.push(bytes.subarray(0, 3))).toEqual([]);
    const frames = decoder.push(bytes.subarray(3)); expect(frames).toHaveLength(2); expect(frames[0].op).toBe(3); expect(frames[1].payload[0]).toBe(78);
  });
  it('decodes signed EQ values by band ID, rejecting incomplete or duplicate bands', () => {
    expect(parseEq(Buffer.from([246, 10, 255, 2, 246, 10, 10, 0, 246, 10, 246, 1]))).toEqual([10, -10, -1]);
    expect(() => parseEq(Buffer.from([246, 10, 0, 0]))).toThrow('Incomplete');
    expect(() => parseEq(Buffer.from([246, 10, 0, 0, 246, 10, 0, 0]))).toThrow('Invalid');
  });
  it('decodes documented 0x07/0x06 captures using bit 0, not the constant capability bit', () => {
    expect(parseMultipoint(Buffer.from([7]))).toBe(true);
    expect(parseMultipoint(Buffer.from([6]))).toBe(false);
    expect(parseMultipoint(Buffer.from([2]))).toBe(false);
    expect(parseMultipoint(Buffer.from([5]))).toBe(true);
    expect(() => parseMultipoint(Buffer.alloc(0))).toThrow();
    expect(() => parseMultipoint(Buffer.from([7, 0]))).toThrow();
  });
  it('preserves all capability/reserved bits in multipoint writes', () => {
    const captured = Buffer.from([0x07]);
    expect(buildMultipoint(captured, false)).toEqual(Buffer.from([0x06]));
    expect(captured[0]).toBe(0x07);
    expect(buildMultipoint(Buffer.from([0x06]), true)).toEqual(Buffer.from([0x07]));
    expect(buildMultipoint(Buffer.from([0xa6]), true)).toEqual(Buffer.from([0xa7]));
    expect(() => buildMultipoint(Buffer.alloc(0), true)).toThrow();
  });
});
describe('real command sequences through a simulated transport', () => {
  it.each([false, true])('uses discovered mode slots for reads, writes and notifications (reversed=%s)', async reversed => {
    const quiet = reversed ? 1 : 0, aware = reversed ? 0 : 1;
    const { transport, device } = await setup(t => {
      t.modeProfiles = [modeProfile(aware, 2, 10), modeProfile(quiet, 1, 0)];
      t.fields.set('31.3', Buffer.from([quiet]));
    });
    expect(await device.readMode()).toBe(0);
    await device.mode(1);
    expect(transport.writes.some(p => p.toString('hex') === `1f0305020${aware}01`)).toBe(true);
    expect(await device.readMode()).toBe(1);
    await device.mode(0);
    expect(transport.writes.some(p => p.toString('hex') === `1f0305020${quiet}01`)).toBe(true);
    expect(await device.readMode()).toBe(0);
    transport.emit('data', packet(31, 3, 3, [aware]).toString('hex'));
    expect(device.latestMode).toBe(1);
    transport.emit('data', packet(31, 3, 3, [quiet]).toString('hex'));
    expect(device.latestMode).toBe(0);
  });
  it('collects profiles arriving after the state-dump acknowledgement', async () => {
    const { device } = await setup(t => { t.profileDelayMs = 200; });
    expect(device.modeProfiles).toHaveLength(2); expect(await device.readMode()).toBe(0);
  });
  it('leaves other settings available but refuses guessed mode writes when profiles are missing', async () => {
    const { transport, device } = await setup(t => { t.modeProfiles = []; });
    const result = await device.read(); expect(result.settings.battery).toBe(78); expect(result.settings.mode).toBe(null);
    expect(result.warnings.some(w => w.includes('could not be identified'))).toBe(true);
    const count = transport.writes.length; await expect(device.mode(1)).rejects.toThrow('have not been identified');
    expect(transport.writes).toHaveLength(count);
  });
  it('resolves profiles again after reconnect instead of keeping the previous slot mapping', async () => {
    const { transport, device } = await setup(); await device.close();
    transport.modeProfiles = [modeProfile(0, 2, 10), modeProfile(1, 1, 0)];
    transport.fields.set('31.3', Buffer.from([0]));
    await device.connect('00:00:00:00:00:45', true);
    expect(await device.readMode()).toBe(1); expect(device.latestRawMode).toBe(0);
    expect(transport.writes.filter(p => p[0] === 31 && p[1] === 3 && p[2] === 5)).toHaveLength(0);
  });
  it('publishes fragmented physical-button mode status without sending a command', async () => {
    const { transport, device } = await setup(); const modes: number[] = [];
    device.on('mode', value => modes.push(value)); const count = transport.writes.length;
    const status = packet(31, 3, 0x83, [1]);
    transport.emit('data', status.subarray(0, 2).toString('hex'));
    expect(modes).toEqual([]);
    transport.emit('data', status.subarray(2).toString('hex'));
    expect(modes).toEqual([1]); expect(device.latestMode).toBe(1); expect(transport.writes).toHaveLength(count);
    for (const frame of [packet(31, 3, 6, [0]), packet(31, 3, 3, [4]), packet(31, 3, 3, []), packet(31, 3, 3, [0, 1]), packet(1, 3, 3, [0])]) transport.emit('data', frame.toString('hex'));
    expect(modes).toEqual([1]);
    await device.close(); transport.emit('data', packet(31, 3, 3, [0]).toString('hex'));
    expect(modes).toEqual([1]); expect(device.latestMode).toBe(null);
  });
  it('handles a mode notification while a different setting request is pending', async () => {
    const { transport, device } = await setup();
    transport.beforeReply = request => { if (request[0] === 1 && request[1] === 10) transport.emit('data', packet(31, 3, 3, [1]).toString('hex')); };
    expect((await device.exchange(1, 10, 1)).payload[0]).toBe(7);
    expect(device.latestMode).toBe(1);
  });
  it('initializes QC45 before reading and tolerates unsolicited fragmented responses', async () => {
    const { transport, device } = await setup();
    const { settings } = await device.read();
    expect(transport.writes[0].toString('hex')).toBe('00010100');
    expect(settings).toEqual({ battery: 78, firmware: '4.0.4', mode: 0, eq: [2, 0, 1], multipoint: true, sidetone: 2 });
  });
  it('writes multipoint and independently reads back the changed bit', async () => {
    const { transport, device } = await setup(); await device.multipoint(false);
    expect(transport.writes.slice(-3).map(b => b.toString('hex'))).toEqual(['010a0100', '010a020106', '010a0100']);
    expect(parseMultipoint(transport.fields.get('1.10')!)).toBe(false);
  });
  it('reports an initially disabled 0x06 capture as off in the settings snapshot', async () => {
    const { transport, device } = await setup(); transport.fields.set('1.10', Buffer.from([6]));
    expect((await device.read()).settings.multipoint).toBe(false);
  });
  it('does not report success when firmware acknowledges but ignores a change', async () => {
    const { transport, device } = await setup(); transport.ignoreChanges = true;
    await expect(device.multipoint(false)).rejects.toThrow('still on');
  });
  it('ignores a legacy bare 0/1 write in the captured-protocol simulator', async () => {
    const { transport, device } = await setup();
    await device.exchange(1, 10, 2, [0]);
    expect(transport.fields.get('1.10')![0]).toBe(7);
  });
  it('enables multipoint from 0x06 without changing capability flags', async () => {
    const { transport, device } = await setup(); transport.fields.set('1.10', Buffer.from([6]));
    await device.multipoint(true);
    expect(transport.fields.get('1.10')![0]).toBe(7);
    expect(transport.writes.some(p => p.toString('hex') === '010a020107')).toBe(true);
  });
  it('waits for a delayed application instead of trusting the acknowledgement', async () => {
    const { transport, device } = await setup(); transport.multipointApplyAfterReads = 3;
    await device.multipoint(false);
    expect(transport.fields.get('1.10')![0]).toBe(6);
    expect(transport.writes.filter(p => p.toString('hex') === '010a0100')).toHaveLength(4);
  });
  it('does not send an unnecessary write if multipoint is already in the requested state', async () => {
    const { transport, device } = await setup();
    await device.multipoint(true);
    expect(transport.writes.filter(p => p[2] === 2)).toHaveLength(0);
  });
  it('surfaces rejected writes and rejects invalid EQ values before sending packets', async () => {
    const { transport, device } = await setup(); transport.rejectWrites = true;
    await expect(device.multipoint(false)).rejects.toThrow('Bose app');
    const count = transport.writes.length; await expect(device.eq([11, 0, 0])).rejects.toThrow(); expect(transport.writes).toHaveLength(count);
  });
  it('refuses a known different Bose model', async () => {
    const transport = new FakeTransport(); transport.productId = 0x4082;
    const device = new Qc45(transport); opened.push(device);
    await expect(device.connect('00:00:00:00:00:45', true)).rejects.toThrow('QuietComfort 45 only'); expect(transport.writes).toHaveLength(0);
  });
  it('invalidates a timed-out connection so late responses cannot satisfy a later command', async () => {
    const { transport, device } = await setup(); transport.silence = true;
    await expect(device.exchange(1, 10, 1)).rejects.toThrow('did not respond');
    transport.emit('data', packet(1, 10, 3, [7]).toString('hex'));
    await expect(device.exchange(1, 10, 1)).rejects.toThrow('Connect your QC45');
  });
});
