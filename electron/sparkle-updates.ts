import type { SparkleUpdater, SparkleUpdaterEventType, SparkleUpdaterListener } from 'electron-sparkle';
import type { UpdateState } from '../src/shared/types';

export const SPARKLE_RELEASES_URL = 'https://github.com/OmarSerrah/MomoBose/releases/latest';

/** Sparkle owns its native update dialog, download, installation, and relaunch. */
export class SparkleUpdateManager {
  state: UpdateState = { mode: 'sparkle', status: 'idle', version: null, percent: null, message: null };
  private stopped = false;
  private ready = false;
  private preparingInstall = false;
  private startPromise?: Promise<void>;
  private cleanup: (() => void)[] = [];

  constructor(private updater: SparkleUpdater, private options: {
    publish: (state: UpdateState) => void;
    beforeInstall: () => void;
    installFailed?: () => void;
    openRelease: (url: string) => Promise<void>;
  }) {
    this.listen('update-available', ({ update }) => this.set({
      status: 'available', version: update.displayVersion, percent: null,
      message: 'Continue in the software update window, or download the release manually.',
    }));
    this.listen('update-not-available', () => this.set({ status: 'idle', version: null, percent: null, message: 'You’re up to date.' }));
    this.listen('update-downloaded', ({ update }) => this.set({
      status: 'downloaded', version: update.displayVersion, percent: 100,
      message: 'The update is ready. Complete installation in the software update window.',
    }));
    this.listen('state-changed', ({ state }) => {
      if (state.sessionInProgress && this.state.status === 'idle') this.set({ status: 'checking', message: null });
    });
    this.listen('cycle-complete', () => {
      if (this.state.status === 'checking') this.set({ status: 'idle' });
    });
    this.listen('error', () => this.fail());
  }

  private listen<E extends SparkleUpdaterEventType>(event: E, listener: SparkleUpdaterListener<E>) {
    this.updater.on(event, listener);
    this.cleanup.push(() => this.updater.off(event, listener));
  }
  private fail() {
    if (this.preparingInstall) {
      this.preparingInstall = false;
      this.options.installFailed?.();
    }
    this.set({ status: 'error', percent: null, message: 'Could not complete the update. Check for updates again or download the release manually.' });
  }
  private set(patch: Partial<UpdateState>) {
    if (this.stopped) return;
    this.state = { ...this.state, ...patch };
    this.options.publish(this.state);
  }
  start(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      try {
        this.updater.setBeforeRelaunchHandler(() => {
          if (!this.stopped) {
            this.preparingInstall = true;
            this.options.beforeInstall();
          }
        });
        await this.updater.start();
        this.ready = !this.stopped;
        // Info.plist supplies defaults. Sparkle persists the user's choices;
        // overriding its settings here would silently reset them every launch.
      } catch {
        this.ready = false;
        this.fail();
      }
    })().finally(() => { if (!this.ready) this.startPromise = undefined; });
    return this.startPromise;
  }
  async check() {
    await this.start();
    if (this.stopped || !this.ready) return;
    try {
      if (!this.updater.getState().canCheckForUpdates) return;
      this.set({ status: 'checking', message: null, version: null, percent: null });
      this.updater.checkForUpdates();
    } catch { this.fail(); }
  }
  install() {
    throw new Error('Sparkle controls installation in its update window.');
  }
  async openRelease() {
    if (this.stopped) throw new Error('The update manager has stopped.');
    await this.options.openRelease(SPARKLE_RELEASES_URL);
  }
  stop() {
    this.stopped = true;
    this.ready = false;
    for (const cleanup of this.cleanup) cleanup();
    this.cleanup = [];
    this.updater.setBeforeRelaunchHandler(null);
  }
}
