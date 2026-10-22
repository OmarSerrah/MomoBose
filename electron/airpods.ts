import { execFile } from 'node:child_process';
import { emptySettings, type HeadsetSettings } from '../src/shared/types';
const key = (address: string) => address.toLowerCase().replace(/[^a-f0-9]/g, '');
const percent = (value: unknown): number | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^\d{1,3}%?$/.test(text)) return null;
  const number = Number(text.replace('%', '')); return number >= 0 && number <= 100 ? number : null;
};
export function airPodsReadings(profile: unknown, address: string, now = new Date().toISOString()): HeadsetSettings {
  const settings = emptySettings();
  if (!profile || typeof profile !== 'object' || key(address).length !== 12) return settings;
  const data = (profile as Record<string, any>).SPBluetoothDataType;
  if (!Array.isArray(data)) return settings;
  // Disconnected entries contain cached battery values. Never display those as live.
  for (const adapter of data) {
    if (!Array.isArray(adapter?.device_connected)) continue;
    for (const group of adapter.device_connected) for (const item of Object.values(group ?? {}) as any[]) {
      if (!item || typeof item.device_address !== 'string' || key(item.device_address) !== key(address)) continue;
      const left = percent(item.device_batteryLevelLeft), right = percent(item.device_batteryLevelRight), batteryCase = percent(item.device_batteryLevelCase);
      const buds = [left, right].filter((v): v is number => v !== null);
      settings.battery = buds.length ? Math.min(...buds) : percent(item.device_batteryLevelMain ?? item.device_batteryLevel ?? item.device_batteryLevelSingle);
      settings.batteries = { left, right, case: batteryCase };
      settings.batteryUpdatedAt = settings.battery !== null || batteryCase !== null ? now : null;
      settings.firmware = typeof item.device_firmwareVersion === 'string' && item.device_firmwareVersion !== '255.15.15' ? item.device_firmwareVersion : null;
      return settings;
    }
  }
  return settings;
}
type ReadProfile = () => Promise<unknown>;
export class AirPodsMonitor {
  private pending: Promise<unknown> | null = null;
  constructor(private platform: string, private readProfile: ReadProfile = () => new Promise((resolve, reject) => {
    execFile('/usr/sbin/system_profiler', ['SPBluetoothDataType', '-json', '-detailLevel', 'mini'], { timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error); else { try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); } }
    });
  })) {}
  async read(address: string): Promise<HeadsetSettings> {
    if (this.platform !== 'darwin') return emptySettings();
    const task = this.pending ??= this.readProfile();
    try { return airPodsReadings(await task, address); }
    finally { if (this.pending === task) this.pending = null; }
  }
}
