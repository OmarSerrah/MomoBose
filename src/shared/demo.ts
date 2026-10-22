import { ListeningMode, defaultPreferences, type AppState, type Command, type DesktopAPI } from './types';
import { airPodsModels } from './models';
import { APP_VERSION } from './version';
export function createDemoAPI(airPodsProductId?: number): DesktopAPI {
  let state: AppState = {
    platform: 'darwin', version: APP_VERSION, demo: true,
    devices: [{ name: 'Ghost', address: '00:00:00:00:00:45', connected: true, productId: 0x4039 }],
    device: { name: 'Ghost', address: '00:00:00:00:00:45', connected: true, productId: 0x4039 },
    connection: 'connected', busy: null,
    settings: { battery: 78, firmware: '4.0.4', mode: ListeningMode.Quiet, eq: [2, 0, 1], multipoint: true, connectedDevices: [{ address: '02:00:00:00:00:01', name: 'This Mac', isLocalDevice: true }, { address: '02:00:00:00:00:02', name: 'Momo’s iPhone', isLocalDevice: false }], sidetone: 2 },
    audio: { available: true, isDefault: true, name: 'Ghost', volume: 42, volumeWritable: true, muted: false },
    preferences: { ...defaultPreferences }, error: null, notice: null,
    logs: [{ time: new Date().toISOString(), message: 'Demo mode. Changes affect this preview only.', level: 'info' }], lastUpdated: new Date().toISOString(),
  };
  const bose = structuredClone(state);
  if (airPodsProductId && airPodsModels[airPodsProductId]) {
    state.device = { name: 'Momo’s AirPods', address: '00:00:00:00:00:02', connected: true, productId: airPodsProductId, vendorId: 0x004c };
    state.devices.push(state.device);
    state.settings = { battery: 88, batteries: { left: 88, right: 92, case: 61 }, batteryUpdatedAt: new Date().toISOString(), firmware: null, mode: null, eq: null, multipoint: null, sidetone: null };
    state.audio.name = state.device.name;
  }
  const apple = structuredClone(state);
  const listeners = new Set<(state: AppState) => void>();
  const publish = () => { for (const listener of listeners) listener(structuredClone(state)); };
  return {
    snapshot: async () => structuredClone(state),
    subscribe: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    command: async (command: Command) => {
      state.busy = 'Updating preview…'; publish(); await new Promise(r => setTimeout(r, 200));
      switch (command.type) {
        case 'sources': state.settings.pairedSources ??= [...(state.settings.connectedDevices ?? []).map(source => ({ ...source, connected: true })), { address: '02:00:00:00:00:03', name: 'iPad', isLocalDevice: false, connected: false }]; break;
        case 'sourceConnect': case 'sourceDisconnect': case 'sourceReplace': {
          state.settings.pairedSources?.forEach(source => { if (command.type === 'sourceReplace' && source.address === command.oldAddress) source.connected = false; if (source.address === command.address) source.connected = command.type !== 'sourceDisconnect'; });
          state.settings.connectedDevices = state.settings.pairedSources?.filter(source => source.connected);
          break;
        }
        case 'selectOutput': state.audio.isDefault = true; break;
        case 'volume': state.audio.volume = command.value; state.audio.muted = false; break;
        case 'mode': state.settings.mode = command.value; break;
        case 'eq': state.settings.eq = command.value; break;
        case 'multipoint': state.settings.multipoint = command.value; break;
        case 'sidetone': state.settings.sidetone = command.value; break;
        case 'connect': { const device = state.devices.find(d => d.address === command.address); if (device) { state.device = device; state.settings = structuredClone(device.vendorId === 0x004c ? apple.settings : bose.settings); state.audio.name = device.name; } } state.audio.volume = 42; state.audio.volumeWritable = true; state.connection = 'connected'; state.audio.available = true; state.audio.isDefault = true; break;
        case 'disconnect': state.audio.volume = null; state.audio.volumeWritable = false; state.connection = 'disconnected'; state.audio.available = false; state.audio.isDefault = false; break;
        case 'preferences': Object.assign(state.preferences, command.value); break;
        case 'dismissError': state.error = null; break;
        default: break;
      }
      state = { ...state, busy: null, lastUpdated: new Date().toISOString() }; publish(); return { ok: true };
    },
  };
}
