import type { AppUpdater } from 'electron-updater';
import type { UpdateState } from '../src/shared/types';

export const RELEASES_URL = 'https://github.com/OmarSerrah/MomoBose/releases/latest';
export const UPDATE_INTERVAL = 4 * 60 * 60 * 1000;
type Updater = Pick<AppUpdater, 'on' | 'removeListener' | 'checkForUpdates' | 'quitAndInstall' | 'autoDownload' | 'autoInstallOnAppQuit' | 'allowDowngrade' | 'allowPrerelease' | 'channel'>;
type UpdateEvent = 'checking-for-update' | 'update-not-available' | 'update-available' | 'download-progress' | 'update-downloaded' | 'error';

// The updater owns all downloads and installation; renderers never supply URLs or paths.
export class UpdateManager {
  state: UpdateState;
  private stopped = false;
  private installing = false;
  private inFlight: Promise<void> | null = null;
  private startup?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private listeners: [UpdateEvent, (...args: any[]) => void][] = [];

  constructor(private updater: Updater | null, private options: {
    platform: string; arch: string; installed?: boolean;
    publish: (state: UpdateState) => void;
    beforeInstall: () => void;
    installFailed?: () => void;
    openRelease: (url: string) => Promise<void>;
  }) {
    this.state = {
      mode: !updater ? 'disabled' : options.platform === 'win32' && options.installed ? 'automatic' : 'manual',
      status: 'idle', version: null, percent: null,
      message: !updater ? 'Update checks are available in the installed app.' : null,
    };
    if (!updater) return;
    // Separate feeds prevent Intel and ARM manifests overwriting each other in CI.
    updater.channel = `latest-${options.arch}`;
    updater.allowDowngrade = false; // Setting channel enables downgrades by default.
    updater.allowPrerelease = false;
    updater.autoDownload = this.state.mode === 'automatic';
    // Installation is an explicit action; ordinary quits never launch an installer.
    updater.autoInstallOnAppQuit = false;
    this.listen('checking-for-update', () => this.set({ status: 'checking', message: null, percent: null }));
    this.listen('update-not-available', () => this.set({ status: 'idle', version: null, percent: null, message: 'You’re up to date.' }));
    this.listen('update-available', info => this.set({ status: this.state.mode === 'automatic' ? 'downloading' : 'available', version: info.version, percent: this.state.mode === 'automatic' ? 0 : null, message: null }));
    this.listen('download-progress', progress => this.set({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(progress.percent))) }));
    this.listen('update-downloaded', info => this.set({ status: 'downloaded', version: info.version, percent: 100, message: null }));
    this.listen('error', () => this.fail());
  }

  private listen(event: UpdateEvent, listener: (...args: any[]) => void) {
    this.listeners.push([event, listener]); this.updater!.on(event, listener);
  }
  private set(patch: Partial<UpdateState>) {
    if (this.stopped) return;
    this.state = { ...this.state, ...patch }; this.options.publish(this.state);
  }
  private fail() {
    if (this.installing) { this.installing = false; this.options.installFailed?.(); }
    this.set({ status: 'error', percent: null, message: 'Could not complete the update. Check your internet connection and try again.' });
  }

  start() {
    if (!this.updater || this.startup || this.stopped) return;
    this.startup = setTimeout(() => { void this.check(); }, 15_000);
    this.interval = setInterval(() => { void this.check(); }, UPDATE_INTERVAL);
    this.startup.unref(); this.interval.unref();
  }
  check(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (!this.updater || this.stopped || ['downloading', 'downloaded'].includes(this.state.status)) return Promise.resolve();
    this.set({ status: 'checking', message: null });
    this.inFlight = Promise.resolve().then(async () => {
      try {
        const result = await this.updater!.checkForUpdates();
        // Also wait for the download so concurrent checks cannot start another one.
        await result?.downloadPromise;
      } catch { this.fail(); }
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  install() {
    if (this.installing) return;
    if (this.stopped || this.state.mode !== 'automatic' || this.state.status !== 'downloaded') throw new Error('Download an update before installing it.');
    // Close-to-tray handlers must allow windows to close before quitAndInstall.
    this.options.beforeInstall();
    this.installing = true;
    try { this.updater!.quitAndInstall(true, true); }
    catch (error) { this.fail(); throw error; }
  }
  async openRelease() {
    if (this.stopped || this.state.mode !== 'manual' || this.state.status !== 'available') throw new Error('No update is ready to download.');
    await this.options.openRelease(RELEASES_URL);
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.startup); clearInterval(this.interval);
    for (const [event, listener] of this.listeners) this.updater?.removeListener(event, listener);
    this.listeners = [];
  }
}
