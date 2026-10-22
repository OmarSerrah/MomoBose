import { EventEmitter } from 'node:events';
import { Qc45, type Transport } from './bmap';
import { SonyHeadset } from './sony';
import { ListeningMode, defaultPreferences, emptyAudio, emptySettings, type AppState, type Command, type Headset, type Preferences } from '../src/shared/types';
import { modelForDevice, supportedDevice } from '../src/shared/models';
import { AirPodsMonitor } from './airpods';
import { APP_VERSION } from '../src/shared/version';

export class Controller extends EventEmitter {
  state: AppState;
  private headset: Qc45 | SonyHeadset;
  private bose: Qc45;
  private sony: SonyHeadset;
  private pollTimer?: NodeJS.Timeout;
  private modePollTimer?: NodeJS.Timeout;
  private audioPollTimer?: NodeJS.Timeout;
  private audioSync: Promise<void> | null = null;
  private audioGeneration = 0;
  private modeSync: Promise<void> | null = null;
  private sourceSync: Promise<void> | null = null;
  private sourceTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private retries = 0;
  private stopped = false;
  private devicePollTimer?: NodeJS.Timeout;
  private deviceSync: Promise<void> | null = null;
  private controlError: string | null = null;
  private passiveAttempted: string | null = null;
  private audioFailure: string | null = null;
  private intentionalDisconnect = false;
  constructor(private native: Transport, preferences: Preferences, private save: (preferences: Preferences) => void, platform = process.platform, private airPods: Pick<AirPodsMonitor, 'read'> = new AirPodsMonitor(platform)) {
    super();
    this.state = {
      platform, version: APP_VERSION, demo: false, devices: [], device: null, connection: 'disconnected', busy: null,
      settings: emptySettings(), audio: emptyAudio(), preferences: { ...defaultPreferences, ...preferences },
      error: null, notice: null, logs: [], lastUpdated: null,
    };
    this.bose = new Qc45(native); this.sony = new SonyHeadset(native); this.headset = this.bose;
    for (const headset of [this.bose, this.sony]) {
    headset.on('diagnostic', (message: string) => { if (headset === this.headset) this.log(message); });
    headset.on('mode', (mode: number | null) => {
      if (headset !== this.headset || this.stopped || this.intentionalDisconnect || this.state.connection !== 'connected' || this.state.settings.mode === mode) return;
      this.state.settings.mode = mode;
      this.state.lastUpdated = new Date().toISOString();
      this.publish();
    });
    headset.on('sourcesChanged', () => { if (headset === this.headset) this.syncSources(); });
    headset.on('lost', (error: Error) => {
      if (headset !== this.headset) return;
      this.audioGeneration++;
      const hadConnection = this.state.connection !== 'disconnected';
      this.state.connection = 'disconnected'; this.state.settings = emptySettings();
      if (hadConnection && !this.intentionalDisconnect && !this.stopped) {
        this.passiveAttempted = null;
        this.state.error = error.message; this.controlError = error.message; this.log(error.message, 'error'); this.scheduleRetry();
      }
      this.publish();
    });
    }
    this.sony.on('settings', (settings: Partial<AppState['settings']>) => {
      if (this.headset !== this.sony || this.stopped || this.intentionalDisconnect || this.state.connection !== 'connected' || this.state.busy) return;
      this.state.settings = { ...this.state.settings, ...settings }; this.state.lastUpdated = new Date().toISOString(); this.publish();
    });
    native.on('diagnostic', (message: string) => this.log(message, 'error'));
  }
  snapshot(): AppState { return structuredClone(this.state); }
  private publish() { this.emit('state', this.snapshot()); }
  log(message: string, level: 'info' | 'error' = 'info') {
    this.state.logs = [{ time: new Date().toISOString(), message: message.slice(0, 1000), level }, ...this.state.logs].slice(0, 35);
  }
  async start() {
    await this.execute({ type: 'discover' });
    if (this.state.preferences.autoReconnect && this.state.preferences.selectedAddress) this.scheduleRetry();
    clearInterval(this.pollTimer); clearInterval(this.modePollTimer); clearInterval(this.audioPollTimer); clearInterval(this.devicePollTimer); clearInterval(this.sourceTimer);
    this.syncAudio();
    this.sourceTimer = setInterval(() => this.syncSources(), 10000);
    this.devicePollTimer = setInterval(() => this.syncDevices(), 5000);
    this.audioPollTimer = setInterval(() => this.syncAudio(), 500);
    this.pollTimer = setInterval(() => {
      if (!this.state.busy && this.state.connection === 'connected') void this.execute({ type: 'refresh' });
    }, 30000);
    // Some QC45 firmware does not push button changes on every connection.
    // Read only CurrentMode in the background, without disabling the UI.
    this.modePollTimer = setInterval(() => this.syncMode(), 1000);
  }
  private syncMode() {
    if (this.stopped || this.intentionalDisconnect || this.state.busy || this.modeSync || this.sourceSync || this.state.connection !== 'connected' || !['bose', 'sony'].includes(modelForDevice(this.state.device).family)) return;
    const task = this.headset.readMode().then(() => {}).catch((error: Error) => {
      if (!this.stopped && !this.intentionalDisconnect && this.state.connection === 'connected') this.log(`Mode sync: ${error.message}`);
    });
    this.modeSync = task;
    void task.finally(() => { if (this.modeSync === task) this.modeSync = null; });
  }
  private syncSources() {
    if (this.stopped || this.intentionalDisconnect || this.state.busy || this.modeSync || this.sourceSync || this.state.connection !== 'connected' || this.state.settings.multipoint !== true || !['bose', 'sony'].includes(modelForDevice(this.state.device).family) || (this.headset === this.sony && !this.state.settings.sony?.sourceManagement)) return;
    const generation = this.audioGeneration;
    const task = this.headset.readConnectedDevices().catch(() => null).then(devices => {
      if (this.stopped || generation !== this.audioGeneration || this.state.connection !== 'connected') return;
      if (JSON.stringify(devices) !== JSON.stringify(this.state.settings.connectedDevices)) {
        this.state.settings.connectedDevices = devices; this.state.lastUpdated = new Date().toISOString(); this.publish();
      }
    });
    this.sourceSync = task;
    void task.finally(() => { if (this.sourceSync === task) this.sourceSync = null; });
  }
  private syncDevices() {
    if (this.stopped || this.state.busy || this.deviceSync) return;
    const generation = this.audioGeneration;
    const task = (async () => {
      const devices = (await this.native.request('list') as Headset[]).filter(d => d && typeof d.address === 'string' && typeof d.name === 'string');
      if (this.stopped || this.state.busy || generation !== this.audioGeneration) return;
      let selected = devices.find(d => d.address === this.state.device?.address) ?? this.state.device;
      // Follow a newly active system output only when no Bose control session is
      // in use. Observing OS connections must never reroute audio or open BMAP.
      if (this.state.connection !== 'connected' || modelForDevice(selected).family === 'airpods') {
        for (const device of devices.filter(d => d.connected && supportedDevice(d))) {
          const audio = await this.native.request('audioStatus', { address: device.address, name: device.name }).catch(() => null);
          if (this.stopped || this.state.busy || generation !== this.audioGeneration) return;
          if (audio?.available && audio.isDefault) { selected = device; break; }
        }
      }
      if (!selected) selected = devices.find(d => d.connected && supportedDevice(d)) ?? devices.find(d => d.address === this.state.preferences.selectedAddress) ?? null;
      const changed = JSON.stringify(devices) !== JSON.stringify(this.state.devices);
      this.state.devices = devices;
      if (selected && selected.address !== this.state.device?.address) {
        this.audioGeneration++; this.state.device = selected; this.state.settings = emptySettings(); this.state.audio = emptyAudio(); this.state.connection = 'disconnected'; this.state.error = null;
        this.publish(); this.syncAudio();
      } else if (changed) { this.state.device = selected; this.publish(); this.maybeAttachControls(); }
    })().catch(error => { if (!this.stopped) this.log(`Device discovery: ${(error as Error).message}`); });
    this.deviceSync = task;
    void task.finally(() => { if (this.deviceSync === task) this.deviceSync = null; });
  }
  private syncAudio() {
    if (this.stopped || this.intentionalDisconnect || this.state.busy || this.audioSync || !this.state.device || this.state.connection === 'connecting') return;
    const device = this.state.device, generation = this.audioGeneration;
    const task = this.native.request('audioStatus', { address: device.address, name: device.name }).then(async value => {
      if (this.stopped || generation !== this.audioGeneration || this.state.device?.address !== device.address) return;
      this.audioFailure = null;
      const wasAvailable = this.state.audio.available;
      if (!value.available) this.passiveAttempted = null;
      let changed = (['available', 'isDefault', 'name', 'volume', 'volumeWritable', 'muted'] as const).some(key => this.state.audio[key] !== value[key]);
      this.state.audio = value;
      if (value.available && this.state.error === this.controlError && this.controlError) { this.state.error = null; changed = true; }
      if (modelForDevice(device).family === 'airpods') {
        const connection = value.available ? 'connected' : 'disconnected';
        if (this.state.connection !== connection) {
          this.state.connection = connection; changed = true;
          this.state.settings = value.available ? await this.airPods.read(device.address).catch(() => emptySettings()) : emptySettings();
          if (this.stopped || generation !== this.audioGeneration) return;
        }
      } else if (value.available && !wasAvailable && this.state.connection === 'disconnected') { this.retries = 0; this.scheduleRetry(); }
      if (changed) { this.state.lastUpdated = new Date().toISOString(); this.publish(); }
    }).catch(error => {
      if (this.stopped || generation !== this.audioGeneration) return;
      const message = (error as Error).message;
      if (message !== this.audioFailure) { this.log(`Audio status unavailable: ${message}`); this.audioFailure = message; }
      if (this.state.audio.available || this.state.audio.volume !== null) {
        this.state.audio = emptyAudio();
        if (modelForDevice(this.state.device).family === 'airpods') { this.state.connection = 'disconnected'; this.state.settings = emptySettings(); }
        this.publish();
      }
    });
    this.audioSync = task;
    void task.finally(() => { if (this.audioSync === task) this.audioSync = null; this.maybeAttachControls(); });
  }
  private maybeAttachControls() {
    const device = this.state.device;
    if (this.stopped || this.state.busy || this.intentionalDisconnect || this.state.connection !== 'disconnected' || !device || !['bose', 'sony'].includes(modelForDevice(device).family) || !this.state.devices.some(d => d.address === device.address && d.connected) || this.passiveAttempted === device.address) return;
    this.passiveAttempted = device.address;
    // Adopt an existing OS link even when reconnecting disconnected headphones
    // is disabled. This path may open only the control channel, never baseband
    // or change the user's selected sound output.
    void this.execute({ type: 'connect', address: device.address, confirmedQc45: true, existingOnly: true });
  }
  private async volume(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('Volume must be between 0 and 100.');
    const device = this.state.device;
    if (!device || !this.state.audio.available || !this.state.audio.volumeWritable) throw new Error('Connect the headphone audio output to change volume.');
    const generation = this.audioGeneration;
    const result = await this.native.request('volume', { address: device.address, name: device.name, value });
    if (this.stopped || generation !== this.audioGeneration) throw new Error('The headphone connection changed.');
    this.state.audio = result;
    for (let attempt = 0; attempt < 4; attempt++) {
      const audio = await this.native.request('audioStatus', { address: device.address, name: device.name });
      if (this.stopped || generation !== this.audioGeneration) throw new Error('The headphone connection changed.');
      this.state.audio = audio;
      const actual = this.state.audio.volume;
      if (this.state.audio.available && actual !== null && Math.abs(actual - value) <= 2 && (value === 0 || this.state.audio.muted !== true)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('The headphones did not confirm that volume. The current reading is shown.');
  }
  async execute(command: Command): Promise<{ ok: boolean; error?: string }> {
    if (command.type === 'dismissError') { this.state.error = null; this.publish(); return { ok: true }; }
    if (this.state.busy) return { ok: false, error: 'Please wait for the current change to finish.' };
    const busy: Record<string, string> = { discover: 'Looking for your headphones…', connect: 'Connecting to your headphones…', disconnect: 'Disconnecting…', refresh: 'Checking your headphones…', mode: 'Changing listening mode…', eq: 'Applying equalizer…', multipoint: 'Changing multipoint…', sidetone: 'Changing self voice…', volume: 'Changing headphone volume…', preferences: 'Saving preferences…', selectOutput: 'Selecting headphone output…', sources: 'Reading paired sources…', sourceConnect: 'Connecting the selected source…', sourceDisconnect: 'Disconnecting the selected source…', sourceReplace: 'Replacing the selected connection…' };
    this.state.busy = busy[command.type] ?? 'Working…'; this.state.error = null; this.state.notice = null; this.publish();
    try {
      // Reserve the user action first, then let an in-flight background GET finish.
      // This keeps one BMAP request active at a time without flashing a spinner
      // or rejecting clicks during routine mode synchronization.
      await Promise.all([this.modeSync, this.audioSync, this.sourceSync]);
      if (this.stopped) throw new Error('MomoBose is closing.');
      if (['sources', 'sourceConnect', 'sourceDisconnect', 'sourceReplace'].includes(command.type) && (!['bose', 'sony'].includes(modelForDevice(this.state.device).family) || this.state.connection !== 'connected')) throw new Error('Connect headphone controls to manage paired sources.');
      if (['mode', 'eq', 'multipoint', 'sidetone'].includes(command.type) && !['bose', 'sony'].includes(modelForDevice(this.state.device).family)) throw new Error('Use the AirPods controls in system settings for this feature.');
      if (['sonyEq', 'sonyAmbient', 'sonySwitch'].includes(command.type) && (this.headset !== this.sony || this.state.connection !== 'connected')) throw new Error('Connect Sony headphone controls first.');
      switch (command.type) {
        case 'discover': await this.discover(); break;
        case 'connect': await this.connect(command.address, command.confirmedQc45, command.existingOnly); break;
        case 'disconnect': {
          this.audioGeneration++;
          this.cancelRetry(); this.intentionalDisconnect = true;
          try {
            await this.headset.close();
            if (this.state.device) await this.native.request('disconnect', { address: this.state.device.address, name: this.state.device.name });
          } finally {
            this.state.connection = 'disconnected'; this.state.settings = emptySettings(); this.state.audio = emptyAudio();
            this.intentionalDisconnect = false;
          }
          this.log('Disconnected from this computer.'); break;
        }
        case 'refresh': await this.refresh(); break;
        case 'sources': case 'sourceConnect': case 'sourceDisconnect': case 'sourceReplace': {
          const sources = command.type === 'sources' ? await this.headset.listSources() : command.type === 'sourceConnect' ? await this.headset.connectSource(command.address) : command.type === 'sourceDisconnect' ? await this.headset.disconnectSource(command.address) : await this.headset.replaceSource(command.oldAddress, command.address);
          this.state.settings.pairedSources = sources;
          this.state.settings.connectedDevices = sources.filter(source => source.connected).map(({ address, name, isLocalDevice }) => ({ address, name, isLocalDevice }));
          if (command.type !== 'sources') this.state.notice = 'Connections updated. To switch playback, pause audio on one device and play on the other.';
          break;
        }
        case 'selectOutput': {
          if (!this.state.device || !this.state.audio.available) throw new Error('Connect your headphone audio first.');
          const device = this.state.device;
          await this.native.request('selectOutput', { address: device.address, name: device.name });
          this.state.audio = await this.native.request('audioStatus', { address: device.address, name: device.name });
          if (!this.state.audio.available || !this.state.audio.isDefault) throw new Error('The output change was not confirmed. Choose your headphones in Sound settings.');
          break;
        }
        case 'volume': await this.volume(command.value); break;
        case 'mode': await this.headset.mode(command.value); await this.refresh(); this.log(`Listening mode changed to ${command.value === ListeningMode.Off ? 'Off' : command.value === ListeningMode.Quiet ? this.headset === this.sony ? 'Noise cancelling' : 'Quiet' : this.headset === this.sony ? 'Ambient sound' : 'Aware'}.`); break;
        case 'eq': await this.headset.eq(command.value); await this.refresh(); this.log('Equalizer applied and verified.'); break;
        case 'multipoint': await this.headset.multipoint(command.value); await this.refresh(); this.log(`Multipoint ${command.value ? 'enabled' : 'disabled'} and verified.`); break;
        case 'sidetone': await this.headset.sidetone(command.value); await this.refresh(); this.log('Self voice changed and verified.'); break;
        case 'sonyEq': await this.sony.equalizer(command.values, command.preset); await this.refresh(); this.log('Sony equalizer applied and verified.'); break;
        case 'sonyAmbient': await this.sony.ambient(command.level, command.focusOnVoice); await this.refresh(); break;
        case 'sonySwitch': await this.sony.switch(command.setting, command.value); await this.refresh(); break;
        case 'preferences': {
          if (command.value.appearance !== undefined) {
            if (!['system', 'light', 'dark'].includes(command.value.appearance)) throw new Error('Choose System, Light, or Dark.');
            this.state.preferences.appearance = command.value.appearance;
          }
          for (const key of ['autoReconnect', 'launchAtLogin', 'showBatteryInTray'] as const) {
            if (typeof command.value[key] === 'boolean') this.state.preferences[key] = command.value[key]!;
          }
          this.save(this.state.preferences);
          if (!this.state.preferences.autoReconnect) this.cancelRetry();
          else if (this.state.connection === 'disconnected') { this.retries = 0; this.scheduleRetry(); }
          break;
        }
        default: throw new Error('Unknown command.');
      }
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'This action could not be completed.';
      this.state.error = message; this.log(message, 'error');
      // A failed multi-band write can apply partially. Do not keep stale controls on screen.
      if (['mode', 'eq', 'multipoint', 'sidetone', 'sonyEq', 'sonyAmbient', 'sonySwitch'].includes(command.type) && this.state.connection === 'connected') {
        try { await this.refresh(); } catch { /* lost connection handler clears values */ }
      }
      if (['sources', 'sourceConnect', 'sourceDisconnect', 'sourceReplace'].includes(command.type)) {
        this.state.settings.pairedSources = null; this.state.settings.connectedDevices = null;
        if (this.state.connection === 'connected' && ['bose', 'sony'].includes(modelForDevice(this.state.device).family)) {
          try {
            const sources = await this.headset.listSources();
            this.state.settings.pairedSources = sources; this.state.settings.connectedDevices = sources.filter(source => source.connected);
          } catch { /* Unknown outcomes remain unavailable, never the old snapshot. */ }
        }
      }
      if (command.type === 'volume' && this.state.device && !this.stopped) {
        try { this.state.audio = await this.native.request('audioStatus', { address: this.state.device.address, name: this.state.device.name }); } catch { this.state.audio = emptyAudio(); }
      }
      if (command.type === 'connect') {
        this.state.connection = 'disconnected'; this.state.settings = emptySettings();
        this.controlError = message;
        await this.headset.close().catch(() => {});
        if (this.state.device) {
          try { this.state.audio = await this.native.request('audioStatus', { address: this.state.device.address, name: this.state.device.name }); } catch { this.state.audio = emptyAudio(); }
        }
      }
      return { ok: false, error: message };
    } finally { this.state.busy = null; this.publish(); }
  }
  private async discover() {
    const devices = await this.native.request('list') as Headset[];
    if (!Array.isArray(devices)) throw new Error('Could not read paired Bluetooth devices.');
    this.state.devices = devices.filter(d => d && typeof d.name === 'string' && typeof d.address === 'string')
      .sort((a, b) => Number(supportedDevice(b)) - Number(supportedDevice(a)));
    const selected = this.state.devices.find(d => d.address === this.state.preferences.selectedAddress);
    if (this.state.connection === 'disconnected') {
      const connected = this.state.devices.filter(d => d.connected && supportedDevice(d));
      const outputs = await Promise.all(connected.map(device => this.native.request('audioStatus', { address: device.address, name: device.name }).catch(() => null)));
      if (this.stopped) return;
      // Adopt the output macOS is already using before considering a saved pair.
      // This observes the existing connection without selecting an output or
      // reconnecting a different headset.
      const active = connected.find((_, index) => outputs[index]?.available && outputs[index].isDefault);
      const device = active ?? connected.find(d => d.address === selected?.address) ?? connected[0] ?? selected ?? this.state.devices.find(supportedDevice) ?? null;
      if (device?.address !== this.state.device?.address) {
        this.audioGeneration++;
        this.state.settings = emptySettings();
        this.state.audio = emptyAudio();
      }
      this.state.device = device;
      const audio = device ? outputs[connected.indexOf(device)] : null;
      if (audio) this.state.audio = audio;
    }
    this.log(this.state.devices.length ? 'Paired headphones found. Choose a pair to connect.' : 'No paired headphones found. Pair your headphones in Bluetooth settings.');
  }
  private async connect(address: string, confirmedQc45: boolean, existingOnly = false) {
    if (!/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(address)) throw new Error('Select a valid paired headset.');
    const selected = this.state.devices.find(d => d.address === address);
    if (!selected) throw new Error('Headphones are no longer in the paired device list. Refresh the list.');
    const family = modelForDevice(selected).family;
    if (family === 'unknown' && selected.productId) throw new Error('Choose a supported AirPods, Bose QC45, Sony WH-1000XM4, or WH-1000XM5.');
    if (family === 'unknown' && !selected.productId && !confirmedQc45) throw new Error('Confirm that the selected headphones are your QC45.');
    if (existingOnly && (!selected.connected || !['bose', 'sony'].includes(family))) throw new Error('The existing headphone connection is no longer available.');
    this.passiveAttempted = address;
    this.cancelRetry();
    this.intentionalDisconnect = true;
    await this.headset.close().catch(() => {});
    this.headset = family === 'sony' ? this.sony : this.bose;
    this.intentionalDisconnect = false;
    this.audioGeneration++;
    this.state.device = selected; this.state.connection = 'connecting'; this.state.settings = emptySettings(); if (!existingOnly) this.state.audio = emptyAudio(); this.publish();
    if (family === 'airpods') {
      await this.native.request('reconnectAudio', { address, name: selected.name });
      for (let attempt = 0; attempt < 12; attempt++) {
        this.state.audio = await this.native.request('audioStatus', { address, name: selected.name });
        if (this.state.audio.available) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!this.state.audio.available) throw new Error('AirPods audio is not ready. Take them out of the case, then connect again.');
      this.state.connection = 'connected'; this.state.device.connected = true;
      this.state.preferences.selectedAddress = address; this.save(this.state.preferences); this.retries = 0;
      await this.refresh();
      try { this.state.audio = await this.native.request('selectOutput', { address, name: selected.name }); }
      catch (e) { this.state.notice = 'AirPods are connected. Choose them as your output in Sound settings.'; this.log((e as Error).message); }
      this.log('AirPods connected.');
      return;
    }
    if (this.state.platform === 'win32' && !existingOnly) {
      try { await this.native.request('reconnectAudio', { address, name: selected.name }); }
      catch (e) { this.log(`Audio reconnect: ${(e as Error).message}`); }
    }
    if (this.headset === this.sony) await this.sony.connect(address, confirmedQc45, existingOnly, modelForDevice(selected).id);
    else await this.bose.connect(address, confirmedQc45, existingOnly);
    this.state.connection = 'connected'; this.state.device.connected = true;
    this.state.preferences.selectedAddress = address; this.save(this.state.preferences); this.retries = 0;
    await this.refresh();
    if (this.state.audio.available && !existingOnly) {
      try { this.state.audio = await this.native.request('selectOutput', { address, name: selected.name }); }
      catch (e) { this.log((e as Error).message); }
    }
    this.log(`${family === 'sony' ? modelForDevice(selected).shortName : 'QC45'} settings connected.`);
    if (!this.state.audio.available) this.state.notice = 'Settings are connected. Audio is not ready yet; check Sound settings or wait a moment and refresh.';
    else if (!this.state.audio.isDefault) this.state.notice = 'Headphones are connected. Choose them as the output in Sound settings.';
  }
  private async refresh() {
    if (modelForDevice(this.state.device).family === 'airpods' && this.state.device) {
      const device = this.state.device;
      this.state.audio = await this.native.request('audioStatus', { address: device.address, name: device.name });
      this.state.settings = this.state.audio.available ? await this.airPods.read(device.address).catch(() => emptySettings()) : emptySettings();
      this.state.connection = this.state.audio.available ? 'connected' : 'disconnected';
      this.state.lastUpdated = new Date().toISOString();
      return;
    }
    if (this.state.connection !== 'connected') {
      if (this.state.device) this.state.audio = await this.native.request('audioStatus', { address: this.state.device.address, name: this.state.device.name });
      return;
    }
    const result = await this.headset.read();
    // A physical-button notification can arrive while the rest of the snapshot
    // (EQ, multipoint, etc.) is still being read. Keep the newest observed mode.
    this.state.settings = { ...result.settings, connectedDevices: result.connectedDevices, mode: this.headset.latestMode ?? result.settings.mode };
    if (result.settings.mode === null) this.state.notice = 'Listening modes are unavailable. Reconnect to read the headphone profiles.';
    for (const warning of result.warnings) this.log(warning);
    if (this.state.device) {
      try { this.state.audio = await this.native.request('audioStatus', { address: this.state.device.address, name: this.state.device.name }); }
      catch (e) { this.state.audio = emptyAudio(); this.log(`Audio status unavailable: ${(e as Error).message}`); }
    }
    this.state.lastUpdated = new Date().toISOString();
  }
  private cancelRetry() { if (this.retryTimer) clearTimeout(this.retryTimer); this.retryTimer = undefined; }
  private scheduleRetry() {
    if (this.stopped || this.intentionalDisconnect || !this.state.preferences.autoReconnect || !this.state.preferences.selectedAddress || this.retries >= 4 || this.retryTimer) return;
    const delay = [3000, 7000, 15000, 30000][this.retries++];
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = undefined;
      if (this.state.busy) { this.retries--; this.scheduleRetry(); return; }
      const result = await this.execute({ type: 'connect', address: this.state.preferences.selectedAddress!, confirmedQc45: true });
      if (!result.ok) this.scheduleRetry();
    }, delay);
  }
  async suspend() {
    this.passiveAttempted = null;
    this.audioGeneration++;
    this.cancelRetry(); this.intentionalDisconnect = true;
    try { await this.headset.close(); } catch {}
    this.state.connection = 'disconnected'; this.state.settings = emptySettings(); this.state.audio = emptyAudio();
    this.intentionalDisconnect = false; this.publish();
  }
  resume() { this.retries = 0; this.scheduleRetry(); }
  stop() { clearInterval(this.sourceTimer); this.stopped = true; this.audioGeneration++; clearInterval(this.devicePollTimer); clearInterval(this.audioPollTimer); clearInterval(this.pollTimer); clearInterval(this.modePollTimer); this.cancelRetry(); }
}
