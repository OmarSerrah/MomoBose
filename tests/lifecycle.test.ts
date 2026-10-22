import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { createDemoAPI } from '../src/shared/demo';

const runtime = vi.hoisted(() => ({ controller: null as any, bridge: null as any, tray: null as any, window: null as any, startup: null as any }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const app = Object.assign(new EventEmitter(), {
    setName: vi.fn(), requestSingleInstanceLock: () => true, whenReady: async () => {},
    dock: { setIcon: vi.fn() }, getPath: () => '/tmp/momobose-lifecycle-test-missing', quit: vi.fn(), exit: vi.fn(), isPackaged: false,
  });
  class BrowserWindow extends EventEmitter {
    webContents = { send: vi.fn(), isDestroyed: () => false, setWindowOpenHandler: vi.fn(), on: vi.fn(), session: { setPermissionRequestHandler: vi.fn() } };
    constructor() { super(); runtime.window = this; }
    isDestroyed() { return false; }
    loadFile = vi.fn(); show = vi.fn(); focus = vi.fn(); hide = vi.fn();
  }
  class Tray extends EventEmitter {
    destroyed = false;
    constructor() { super(); runtime.tray = this; }
    isDestroyed() { return this.destroyed; }
    setToolTip = vi.fn(() => { if (this.destroyed) throw new Error('Tray is destroyed'); });
    setTitle = vi.fn(() => { if (this.destroyed) throw new Error('Tray is destroyed'); });
    destroy() { this.destroyed = true; }
  }
  return { app, BrowserWindow, Tray, nativeTheme: Object.assign(new EventEmitter(), { themeSource: 'system', shouldUseDarkColors: false }), ipcMain: { handle: vi.fn() }, Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() }, nativeImage: { createFromPath: (path: string) => ({ path, isEmpty: () => false, setTemplateImage: vi.fn() }) }, screen: {}, shell: {}, powerMonitor: new EventEmitter() };
});
vi.mock('../electron/controller', async () => {
  const state = await createDemoAPI().snapshot();
  return { Controller: class extends EventEmitter {
    constructor() { super(); runtime.controller = this; }
    snapshot() { return state; }
    start() { return new Promise<void>(resolve => { runtime.startup = () => { this.emit('state', state); resolve(); }; }); }
    stop = vi.fn();
  } };
});
vi.mock('../electron/native', () => ({ NativeBridge: class {
  constructor() { runtime.bridge = this; }
  stop = vi.fn(() => runtime.controller.emit('state', runtime.controller.snapshot()));
} }));

it('keeps the tray alive when the window closes and ignores late updates after Quit', async () => {
  await import('../electron/main');
  const { app, nativeTheme } = await import('electron');
  await vi.waitFor(() => expect(runtime.startup).toBeTypeOf('function'));
  const state = runtime.controller.snapshot();
  if (process.platform === 'darwin') {
    expect(app.dock!.setIcon).toHaveBeenLastCalledWith(expect.objectContaining({ path: expect.stringContaining('app-icon-light.png') }));
    (nativeTheme as any).shouldUseDarkColors = true; nativeTheme.emit('updated');
    expect(app.dock!.setIcon).toHaveBeenLastCalledWith(expect.objectContaining({ path: expect.stringContaining('app-icon-dark.png') }));
    (nativeTheme as any).shouldUseDarkColors = false; nativeTheme.emit('updated');
    expect(app.dock!.setIcon).toHaveBeenLastCalledWith(expect.objectContaining({ path: expect.stringContaining('app-icon-light.png') }));
  }
  const close = { preventDefault: vi.fn() };
  runtime.window.emit('close', close);
  expect(close.preventDefault).toHaveBeenCalledOnce();
  expect(runtime.window.hide).toHaveBeenCalledOnce();
  expect(runtime.tray.isDestroyed()).toBe(false);
  expect(runtime.controller.stop).not.toHaveBeenCalled();
  expect(runtime.bridge.stop).not.toHaveBeenCalled();
  app.emit('window-all-closed');
  expect(app.quit).not.toHaveBeenCalled();
  app.emit('activate');
  expect(runtime.window.show).toHaveBeenCalledOnce();
  expect(runtime.window.focus).toHaveBeenCalledOnce();
  // A renderer or tray can be destroyed before the full quit sequence begins.
  runtime.window.webContents.isDestroyed = () => true;
  runtime.tray.destroy();
  const sends = runtime.window.webContents.send.mock.calls.length;
  const tooltips = runtime.tray.setToolTip.mock.calls.length;
  expect(() => runtime.controller.emit('state', state)).not.toThrow();
  expect(runtime.window.webContents.send).toHaveBeenCalledTimes(sends);
  expect(runtime.tray.setToolTip).toHaveBeenCalledTimes(tooltips);
  expect(() => app.emit('before-quit')).not.toThrow();
  expect(runtime.controller.stop).toHaveBeenCalled(); expect(runtime.bridge.stop).toHaveBeenCalled();
  expect(runtime.controller.listenerCount('state')).toBe(0);
  const quittingClose = { preventDefault: vi.fn() };
  runtime.window.emit('close', quittingClose);
  expect(quittingClose.preventDefault).not.toHaveBeenCalled();
  // The original failure was a promise finishing after before-quit destroyed Tray.
  await expect(Promise.resolve().then(runtime.startup)).resolves.toBeUndefined();
  expect(runtime.tray.setToolTip).toHaveBeenCalledTimes(tooltips);
  expect(() => app.emit('before-quit')).not.toThrow();
});
