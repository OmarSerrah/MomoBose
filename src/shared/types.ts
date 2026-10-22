export interface Headset {
  address: string;
  name: string;
  connected: boolean;
  productId?: number;
  vendorId?: number;
  artwork?: string;
}
export interface AudioStatus {
  available: boolean;
  isDefault: boolean;
  name: string | null;
  volume: number | null;
  volumeWritable: boolean;
  muted: boolean | null;
}
export type Appearance = 'system' | 'light' | 'dark';
export interface Preferences {
  appearance: Appearance;
  autoReconnect: boolean;
  launchAtLogin: boolean;
  showBatteryInTray: boolean;
  selectedAddress: string | null;
}
// App values describe the sound mode; they are never raw BMAP slot indices.
export const ListeningMode = { Quiet: 0, Aware: 1, Custom: 2 } as const;
export interface AudioSource { address: string; name: string | null; isLocalDevice: boolean; connected: boolean }
export interface HeadsetSettings {
  battery: number | null;
  batteries?: { left: number | null; right: number | null; case: number | null } | null;
  batteryUpdatedAt?: string | null;
  firmware: string | null;
  mode: number | null;
  eq: [number, number, number] | null;
  multipoint: boolean | null;
  pairedSources?: AudioSource[] | null;
  connectedDevices?: { address: string; name: string | null; isLocalDevice: boolean }[] | null;
  sidetone: number | null;
}
export interface LogEntry { time: string; message: string; level: 'info' | 'error' }
export interface AppState {
  platform: string;
  version: string;
  demo: boolean;
  devices: Headset[];
  device: Headset | null;
  connection: 'disconnected' | 'connecting' | 'connected';
  busy: string | null;
  settings: HeadsetSettings;
  audio: AudioStatus;
  preferences: Preferences;
  error: string | null;
  notice: string | null;
  logs: LogEntry[];
  lastUpdated: string | null;
}
export type Command =
  | { type: 'discover' }
  | { type: 'connect'; address: string; confirmedQc45: boolean; existingOnly?: boolean }
  | { type: 'disconnect' }
  | { type: 'refresh' }
  | { type: 'selectOutput' }
  | { type: 'sources' }
  | { type: 'sourceConnect'; address: string }
  | { type: 'sourceDisconnect'; address: string }
  | { type: 'sourceReplace'; oldAddress: string; address: string }
  | { type: 'volume'; value: number }
  | { type: 'mode'; value: number }
  | { type: 'eq'; value: [number, number, number] }
  | { type: 'multipoint'; value: boolean }
  | { type: 'sidetone'; value: number }
  | { type: 'preferences'; value: Partial<Omit<Preferences, 'selectedAddress'>> }
  | { type: 'openSettings'; page: 'bluetooth' | 'sound' | 'permissions' | 'airpods' }
  | { type: 'showWindow' }
  | { type: 'dismissError' }
  | { type: 'quit' };
export interface DesktopAPI {
  snapshot(): Promise<AppState>;
  command(command: Command): Promise<{ ok: boolean; error?: string }>;
  subscribe(callback: (state: AppState) => void): () => void;
}
export const emptySettings = (): HeadsetSettings => ({ battery: null, firmware: null, mode: null, eq: null, multipoint: null, sidetone: null });
export const defaultPreferences: Preferences = { appearance: 'system', autoReconnect: false, launchAtLogin: false, showBatteryInTray: true, selectedAddress: null };
export const emptyAudio = (): AudioStatus => ({ available: false, isDefault: false, name: null, volume: null, volumeWritable: false, muted: null });
