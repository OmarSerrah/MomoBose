import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppUpdater } from 'electron-updater';
import { RELEASES_URL, UPDATE_INTERVAL, UpdateManager } from '../electron/updates';

function fixture(platform = 'win32', arch = 'x64', installed = true) {
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async (): Promise<any> => { updater.emit('update-not-available'); return {}; }),
    quitAndInstall: vi.fn(),
    autoDownload: false, autoInstallOnAppQuit: true, allowDowngrade: true, allowPrerelease: true, channel: '',
  });
  const options = { platform, arch, installed, publish: vi.fn(), beforeInstall: vi.fn(), installFailed: vi.fn(), openRelease: vi.fn(async () => {}) };
  const manager = new UpdateManager(updater as unknown as AppUpdater, options);
  return { updater, manager, options };
}
afterEach(() => vi.useRealTimers());

it.each(['x64', 'arm64'])('uses the %s Windows feed, downloads automatically and installs only after confirmation', async arch => {
  const { manager, updater, options } = fixture('win32', arch);
  expect(updater.channel).toBe(`latest-${arch}`);
  expect(updater.allowDowngrade).toBe(false);
  expect(updater.allowPrerelease).toBe(false);
  expect(updater.autoDownload).toBe(true);
  expect(updater.autoInstallOnAppQuit).toBe(false);
  expect(() => manager.install()).toThrow();
  updater.checkForUpdates.mockImplementationOnce(async () => {
    updater.emit('update-available', { version: '0.1.14' });
    updater.emit('download-progress', { percent: 39.7 });
    return {};
  });
  await manager.check();
  expect(manager.state).toMatchObject({ status: 'downloading', percent: 40, version: '0.1.14' });
  expect(() => manager.install()).toThrow();
  await manager.check();
  expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  updater.emit('update-downloaded', { version: '0.1.14' });
  expect(updater.quitAndInstall).not.toHaveBeenCalled();
  await manager.check();
  expect(manager.state.status).toBe('downloaded');
  manager.install(); manager.install();
  expect(options.beforeInstall).toHaveBeenCalledOnce();
  expect(updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true);
  expect(options.beforeInstall.mock.invocationCallOrder[0]).toBeLessThan(updater.quitAndInstall.mock.invocationCallOrder[0]);
  manager.stop();
});

it.each([['darwin', true], ['win32', false]] as const)('offers manual installation on %s (installed: %s)', async (platform, installed) => {
  const { manager, updater, options } = fixture(platform, 'arm64', installed);
  expect(updater.autoDownload).toBe(false);
  expect(manager.state.mode).toBe('manual');
  await expect(manager.openRelease()).rejects.toThrow();
  updater.checkForUpdates.mockImplementationOnce(async () => { updater.emit('update-available', { version: '0.1.14' }); return {}; });
  await manager.check();
  expect(manager.state.status).toBe('available');
  await manager.openRelease();
  expect(options.openRelease).toHaveBeenCalledExactlyOnceWith(RELEASES_URL);
  expect(() => manager.install()).toThrow();
  expect(updater.quitAndInstall).not.toHaveBeenCalled();
  manager.stop();
});

it('deduplicates checks and catches network and checksum/download failures, allowing retry', async () => {
  const { manager, updater } = fixture();
  let rejectDownload!: (error: Error) => void;
  updater.checkForUpdates.mockImplementationOnce(async () => {
    updater.emit('update-available', { version: '0.1.14' });
    return { downloadPromise: new Promise((_, reject) => { rejectDownload = reject; }) };
  });
  const first = manager.check(), second = manager.check();
  expect(first).toBe(second);
  await vi.waitFor(() => expect(manager.state.status).toBe('downloading'));
  rejectDownload(new Error('sha512 mismatch'));
  await first;
  expect(manager.state.status).toBe('error');
  expect(() => manager.install()).toThrow();
  updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
  await manager.check();
  expect(manager.state.status).toBe('error');
  await manager.check();
  expect(manager.state).toMatchObject({ status: 'idle', message: 'You’re up to date.' });
  manager.stop();
});

it('restores normal app behavior when the installer cannot start', () => {
  const { manager, updater, options } = fixture();
  updater.emit('update-downloaded', { version: '0.1.14' });
  updater.quitAndInstall.mockImplementationOnce(() => { updater.emit('error', new Error('installer missing')); });
  manager.install();
  expect(options.installFailed).toHaveBeenCalledOnce();
  expect(manager.state.status).toBe('error');
  expect(() => manager.install()).toThrow();
  manager.stop();
});

it('checks after startup and every four hours, and cleans up on quit', async () => {
  vi.useFakeTimers();
  const { manager, updater, options } = fixture();
  manager.start(); manager.start();
  expect(updater.checkForUpdates).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL - 15_000);
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  manager.stop();
  const calls = options.publish.mock.calls.length;
  await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL);
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  updater.emit('update-downloaded', { version: '0.1.14' });
  expect(options.publish).toHaveBeenCalledTimes(calls);
  expect(updater.listenerCount('update-available')).toBe(0);
});

it('does no update work in development, demo, or smoke sessions', async () => {
  vi.useFakeTimers();
  const options = { platform: 'darwin', arch: 'arm64', publish: vi.fn(), beforeInstall: vi.fn(), openRelease: vi.fn() };
  const manager = new UpdateManager(null, options);
  manager.start(); await manager.check(); await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL * 2);
  expect(manager.state.mode).toBe('disabled');
  expect(options.publish).not.toHaveBeenCalled();
  expect(() => manager.install()).toThrow();
  manager.stop();
});
