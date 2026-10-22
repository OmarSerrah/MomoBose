import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { SparkleUpdateManager, SPARKLE_RELEASES_URL } from '../electron/sparkle-updates';

function fixture() {
  const events = new EventEmitter();
  const updater = Object.assign(events, {
    start: vi.fn(async () => {}),
    getState: vi.fn(() => ({ started: true, canCheckForUpdates: true, sessionInProgress: false, automaticallyChecksForUpdates: true, automaticallyDownloadsUpdates: false })),
    checkForUpdates: vi.fn(), checkForUpdatesInBackground: vi.fn(),
    setHTTPHeaders: vi.fn(), setBeforeRelaunchHandler: vi.fn(),
    setAutomaticallyChecksForUpdates: vi.fn(), setAutomaticallyDownloadsUpdates: vi.fn(),
  });
  const publish = vi.fn();
  const beforeInstall = vi.fn();
  const installFailed = vi.fn();
  const openRelease = vi.fn(async () => {});
  return { updater: updater as any, manager: new SparkleUpdateManager(updater as any, { publish, beforeInstall, installFailed, openRelease }), publish, beforeInstall, installFailed, openRelease };
}

afterEach(() => vi.useRealTimers());

it('starts Sparkle with user-confirmed installation and opens the native update UI', async () => {
  const { updater, manager } = fixture();
  await manager.start();
  expect(updater.start).toHaveBeenCalledOnce();
  expect(updater.setAutomaticallyChecksForUpdates).not.toHaveBeenCalled();
  expect(updater.setAutomaticallyDownloadsUpdates).not.toHaveBeenCalled();
  await manager.check();
  expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  expect(manager.state).toMatchObject({ mode: 'sparkle', status: 'checking' });
  manager.stop();
});

it('maps Sparkle update events and keeps a manual GitHub release fallback', async () => {
  const { updater, manager, publish, beforeInstall, openRelease } = fixture();
  await manager.start();
  updater.emit('update-available', { update: { version: '0.2.0', displayVersion: '0.2.0' } });
  expect(manager.state).toMatchObject({ status: 'available', version: '0.2.0' });
  await manager.openRelease();
  expect(openRelease).toHaveBeenCalledWith(SPARKLE_RELEASES_URL);
  updater.emit('update-downloaded', { update: { version: '0.2.0', displayVersion: '0.2.0' } });
  expect(manager.state).toMatchObject({ status: 'downloaded', percent: 100 });
  const relaunch = updater.setBeforeRelaunchHandler.mock.calls.at(-1)?.[0];
  await relaunch();
  expect(beforeInstall).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalled();
  manager.stop();
  expect(updater.setBeforeRelaunchHandler).toHaveBeenLastCalledWith(null);
});

it('reports Sparkle startup and feed errors without losing manual fallback', async () => {
  const { updater, manager, openRelease } = fixture();
  updater.start.mockRejectedValueOnce(new Error('native bridge unavailable'));
  await manager.start();
  expect(manager.state).toMatchObject({ status: 'error', mode: 'sparkle' });
  await manager.openRelease();
  expect(openRelease).toHaveBeenCalledOnce();
  manager.stop();
});

it('does not query an uninitialized native bridge and can retry a failed startup', async () => {
  const { updater, manager } = fixture();
  updater.start.mockRejectedValueOnce(new Error('unavailable'));
  await manager.check();
  expect(updater.getState).not.toHaveBeenCalled();
  expect(manager.state.status).toBe('error');
  await manager.check();
  expect(updater.start).toHaveBeenCalledTimes(2);
  expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  manager.stop();
});

it('handles a native check failure without exposing native error details or rejecting IPC', async () => {
  const { updater, manager } = fixture();
  updater.checkForUpdates.mockImplementationOnce(() => { throw new Error('internal-path-and-details'); });
  await expect(manager.check()).resolves.toBeUndefined();
  expect(manager.state.status).toBe('error');
  expect(manager.state.message).not.toContain('internal-path-and-details');
  manager.stop();
});

it('restores normal app behavior if the native relaunch fails after preparation', async () => {
  const { updater, manager, beforeInstall, installFailed } = fixture();
  await manager.start();
  await updater.setBeforeRelaunchHandler.mock.calls.at(-1)?.[0]();
  expect(beforeInstall).toHaveBeenCalledOnce();
  updater.emit('error', { error: new Error('native relaunch failed') });
  expect(installFailed).toHaveBeenCalledOnce();
  expect(manager.state.status).toBe('error');
  updater.emit('error', { error: new Error('another error') });
  expect(installFailed).toHaveBeenCalledOnce();
  manager.stop();
});
