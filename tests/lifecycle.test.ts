import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { createDemoAPI } from '../src/shared/demo';

const runtime = vi.hoisted(() => ({ controller: null as any, bridge: null as any, tray: null as any, window: null as any, startup: null as any }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  let dockVisible = true;
  const app = Object.assign(new EventEmitter(), {
    setName: vi.fn(), requestSingleInstanceLock: () => true, whenReady: async () => {},
    dock: { setIcon: vi.fn(), isVisible: () => dockVisible, hide: vi.fn(() => { dockVisible = false; }), show: vi.fn(async () => { dockVisible = true; }) }, getPath: () => '/tmp/momobose-lifecycle-test-missing', quit: vi.fn(), exit: vi.fn(), isPackaged: false,
  });
  class BrowserWindow extends EventEmitter {
    visible = false;
    webContents = { send: vi.fn(), isDestroyed: () => false, setWindowOpenHandler: vi.fn(), on: vi.fn(), session: { setPermissionRequestHandler: vi.fn() } };
    constructor() { super(); runtime.window = this; }
    isDestroyed() { return false; }
    isVisible() { return this.visible; }
    isMinimized = vi.fn(() => false); restore = vi.fn();
    loadFile = vi.fn(); show = vi.fn(() => { this.visible = true; }); focus = vi.fn(); hide = vi.fn(() => { this.visible = false; });
    getSize = () => [370, 608]; setPosition = vi.fn();
  }
  class Tray extends EventEmitter {
    destroyed = false;
    constructor() { super(); runtime.tray = this; }
    isDestroyed() { return this.destroyed; }
    setToolTip = vi.fn(() => { if (this.destroyed) throw new Error('Tray is destroyed'); });
    setTitle = vi.fn(() => { if (this.destroyed) throw new Error('Tray is destroyed'); });
    destroy() { this.destroyed = true; }
    getBounds = () => ({ x: 100, y: 0, width: 24, height: 24 });
  }
  return { app, BrowserWindow, Tray, nativeTheme: Object.assign(new EventEmitter(), { themeSource: 'system', shouldUseDarkColors: false }), ipcMain: { handle: vi.fn() }, Menu: { buildFromTemplate: vi.fn(template => template), setApplicationMenu: vi.fn() }, nativeImage: { createFromPath: (path: string) => ({ path, isEmpty: () => false, setTemplateImage: vi.fn() }) }, screen: { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }, shell: {}, powerMonitor: new EventEmitter() };
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

const originalArgv = process.argv;
afterEach(() => { process.argv = originalArgv; vi.useRealTimers(); vi.restoreAllMocks(); });

it.each([false, true])('closes to the tray, restores the Dock on reopen, and quits cleanly (hidden startup: %s)', async hidden => {
  vi.resetModules(); vi.clearAllMocks();
  process.argv = [...originalArgv.filter(arg => arg !== '--hidden'), ...(hidden ? ['--hidden'] : [])];
  const { app, nativeTheme, Menu, powerMonitor } = await import('electron');
  await app.dock!.show(); vi.clearAllMocks();
  app.removeAllListeners(); nativeTheme.removeAllListeners(); powerMonitor.removeAllListeners();
  (nativeTheme as any).shouldUseDarkColors = false;
  runtime.startup = null;
  await import('../electron/main');
  await vi.waitFor(() => expect(runtime.startup).toBeTypeOf('function'));
  const main = runtime.window;
  main.emit('ready-to-show');
  expect(main.isVisible()).toBe(!hidden);
  if (process.platform === 'darwin' && hidden) expect(app.dock!.hide).toHaveBeenCalledOnce();
  const menu = vi.mocked(Menu.setApplicationMenu).mock.calls[0][0] as any;
  expect(menu.find((item: any) => item.label === 'Window').submenu).toContainEqual({ id: 'close-window', role: 'close', accelerator: 'CmdOrCtrl+W' });
  if (hidden) app.emit('second-instance');
  const state = runtime.controller.snapshot();
  if (process.platform === 'darwin') {
    expect(app.dock!.setIcon).toHaveBeenLastCalledWith(expect.objectContaining({ path: expect.stringContaining('app-icon-light.png') }));
    (nativeTheme as any).shouldUseDarkColors = true; nativeTheme.emit('updated');
    expect(app.dock!.setIcon).toHaveBeenLastCalledWith(expect.objectContaining({ path: expect.stringContaining('app-icon-dark.png') }));
    (nativeTheme as any).shouldUseDarkColors = false; nativeTheme.emit('updated');
    expect(app.dock!.setIcon).toHaveBeenLastCalledWith(expect.objectContaining({ path: expect.stringContaining('app-icon-light.png') }));
  }
  vi.useFakeTimers();
  // Also cover a quick open/close immediately after hidden startup.
  const close = { preventDefault: vi.fn() };
  main.emit('close', close);
  if (process.platform === 'darwin' && hidden) {
    expect(app.dock!.hide).toHaveBeenCalledOnce();
    expect(app.dock!.isVisible()).toBe(true);
  }
  await vi.advanceTimersByTimeAsync(1100);
  expect(close.preventDefault).toHaveBeenCalledOnce();
  expect(main.hide).toHaveBeenCalledOnce();
  expect(main.isVisible()).toBe(false);
  if (process.platform === 'darwin') expect(app.dock!.hide).toHaveBeenCalledTimes(hidden ? 2 : 1);
  if (process.platform === 'darwin') expect(app.dock!.isVisible()).toBe(false);
  expect(runtime.tray.isDestroyed()).toBe(false);
  expect(runtime.controller.stop).not.toHaveBeenCalled();
  expect(runtime.bridge.stop).not.toHaveBeenCalled();
  app.emit('window-all-closed');
  expect(app.quit).not.toHaveBeenCalled();
  // The compact tray popover must not bring the Dock icon back.
  const dockShows = vi.mocked(app.dock!.show).mock.calls.length;
  runtime.tray.emit('click');
  const widget = runtime.window;
  expect(widget).not.toBe(main);
  expect(widget.isVisible()).toBe(true);
  widget.emit('close', { preventDefault: vi.fn() });
  expect(widget.isVisible()).toBe(false);
  expect(app.dock!.show).toHaveBeenCalledTimes(dockShows);
  // Opening the full window restores a minimized window and the Dock icon.
  main.isMinimized.mockReturnValue(true);
  main.show.mockClear(); main.focus.mockClear();
  app.emit('activate');
  expect(main.show).toHaveBeenCalledOnce();
  expect(main.focus).toHaveBeenCalledOnce();
  expect(main.restore).toHaveBeenCalledOnce();
  if (process.platform === 'darwin') expect(app.dock!.show).toHaveBeenCalledTimes(dockShows + 1);
  // A delayed Dock hide from a rapid close must not run after reopening.
  main.emit('close', { preventDefault: vi.fn() });
  if (process.platform === 'darwin') expect(app.dock!.isVisible()).toBe(true);
  app.emit('activate');
  const dockHides = vi.mocked(app.dock!.hide).mock.calls.length;
  await vi.advanceTimersByTimeAsync(1100);
  expect(app.dock!.hide).toHaveBeenCalledTimes(dockHides);
  if (process.platform === 'darwin') expect(app.dock!.isVisible()).toBe(true);
  // A renderer or tray can be destroyed before the full quit sequence begins.
  main.webContents.isDestroyed = () => true;
  widget.webContents.isDestroyed = () => true;
  runtime.tray.destroy();
  const sends = main.webContents.send.mock.calls.length;
  const tooltips = runtime.tray.setToolTip.mock.calls.length;
  expect(() => runtime.controller.emit('state', state)).not.toThrow();
  expect(main.webContents.send).toHaveBeenCalledTimes(sends);
  expect(runtime.tray.setToolTip).toHaveBeenCalledTimes(tooltips);
  expect(() => app.emit('before-quit')).not.toThrow();
  expect(runtime.controller.stop).toHaveBeenCalled(); expect(runtime.bridge.stop).toHaveBeenCalled();
  expect(runtime.controller.listenerCount('state')).toBe(0);
  const quittingClose = { preventDefault: vi.fn() };
  main.emit('close', quittingClose);
  expect(quittingClose.preventDefault).not.toHaveBeenCalled();
  // The original failure was a promise finishing after before-quit destroyed Tray.
  await expect(Promise.resolve().then(runtime.startup)).resolves.toBeUndefined();
  expect(runtime.tray.setToolTip).toHaveBeenCalledTimes(tooltips);
  expect(() => app.emit('before-quit')).not.toThrow();
});
