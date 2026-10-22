import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray, screen, shell, powerMonitor, nativeTheme } from 'electron';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Controller } from './controller';
import { Qc45 } from './bmap';
import { NativeBridge } from './native';
import { UpdateManager } from './updates';
import { createDemoAPI } from '../src/shared/demo';
import { modelForDevice } from '../src/shared/models';
import { ListeningMode, defaultPreferences, type AppState, type Command, type Preferences } from '../src/shared/types';

app.setName('MomoBose');
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
let main: BrowserWindow | null = null, widget: BrowserWindow | null = null, tray: Tray;
let quitting = false;
let updates: UpdateManager | undefined;
let dockHideTimer: ReturnType<typeof setTimeout> | undefined;
let lastDockChange = -Infinity;
let controller: Controller | undefined;
let bridge: NativeBridge | undefined;
let current: AppState;
const demo = process.argv.includes('--demo');
const demoAPI = createDemoAPI(process.env.MOMOBOSE_DEMO_AIRPODS ? parseInt(process.env.MOMOBOSE_DEMO_AIRPODS, 16) : undefined);
const devURL = process.env.MOMOBOSE_DEV_URL;
const root = path.resolve(__dirname, '..');
const windows = () => [main, widget].filter((w): w is BrowserWindow => Boolean(w && !w.isDestroyed()));
let iconAppearance: 'light' | 'dark' | null = null;
const applicationIconPath = () => path.join(root, `assets/app-icon-${nativeTheme.shouldUseDarkColors ? 'dark' : 'light'}.png`);
function updateApplicationIcon() {
  if (quitting) return;
  const appearance = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  if (iconAppearance === appearance) return;
  const icon = nativeImage.createFromPath(applicationIconPath());
  if (icon.isEmpty()) return;
  if (process.platform === 'darwin') app.dock?.setIcon(icon);
  else for (const window of windows()) if (typeof window.setIcon === 'function') window.setIcon(icon);
  iconAppearance = appearance;
}
function savePreferences(value: Preferences) {
  const folder = app.getPath('userData'); mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'preferences.json');
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(`${file}.tmp`, file);
}
function loadPreferences(): Preferences {
  try {
    const data = JSON.parse(readFileSync(path.join(app.getPath('userData'), 'preferences.json'), 'utf8'));
    return { appearance: ['system', 'light', 'dark'].includes(data.appearance) ? data.appearance : 'system', autoReconnect: data.autoReconnect === true, launchAtLogin: data.launchAtLogin === true, showBatteryInTray: data.showBatteryInTray !== false, selectedAddress: typeof data.selectedAddress === 'string' ? data.selectedAddress : null };
  } catch { return { ...defaultPreferences }; }
}
function allowedSender(event: Electron.IpcMainInvokeEvent) {
  if (!windows().some(w => w.webContents === event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Unknown MomoBose window.');
}
function validate(input: unknown): Command {
  if (!input || typeof input !== 'object') throw new Error('Invalid action.');
  const c = input as Record<string, any>;
  if (!['discover', 'connect', 'disconnect', 'refresh', 'selectOutput', 'sources', 'sourceConnect', 'sourceDisconnect', 'sourceReplace', 'volume', 'mode', 'eq', 'multipoint', 'sidetone', 'preferences', 'openSettings', 'showWindow', 'dismissError', 'quit'].includes(c.type)) throw new Error('Unknown action.');
  if (['sourceConnect', 'sourceDisconnect', 'sourceReplace'].includes(c.type) && (typeof c.address !== 'string' || !/^([a-f0-9]{2}:){5}[a-f0-9]{2}$/i.test(c.address))) throw new Error('Invalid source address.');
  if (c.type === 'sourceReplace' && (typeof c.oldAddress !== 'string' || !/^([a-f0-9]{2}:){5}[a-f0-9]{2}$/i.test(c.oldAddress))) throw new Error('Invalid source to replace.');
  if (c.type === 'connect' && (typeof c.address !== 'string' || typeof c.confirmedQc45 !== 'boolean')) throw new Error('Invalid headphone selection.');
  if (c.type === 'connect' && c.existingOnly !== undefined && typeof c.existingOnly !== 'boolean') throw new Error('Invalid connection mode.');
  if (['mode', 'sidetone'].includes(c.type) && !Number.isInteger(c.value)) throw new Error('Invalid setting.');
  if (c.type === 'volume' && (!Number.isInteger(c.value) || c.value < 0 || c.value > 100)) throw new Error('Volume must be between 0 and 100.');
  if (c.type === 'preferences' && c.value?.appearance !== undefined && !['system', 'light', 'dark'].includes(c.value.appearance)) throw new Error('Choose System, Light, or Dark.');
  if (c.type === 'eq' && (!Array.isArray(c.value) || c.value.length !== 3 || !c.value.every((v: unknown) => Number.isInteger(v) && Number(v) >= -10 && Number(v) <= 10))) throw new Error('Invalid equalizer.');
  if (c.type === 'multipoint' && typeof c.value !== 'boolean') throw new Error('Invalid multipoint setting.');
  if (c.type === 'preferences' && (!c.value || typeof c.value !== 'object' || Array.isArray(c.value))) throw new Error('Invalid preferences.');
  if (c.type === 'openSettings' && !['bluetooth', 'sound', 'permissions', 'airpods'].includes(c.page)) throw new Error('Unknown settings page.');
  return c as Command;
}
async function command(input: unknown) {
  try {
    const action = validate(input);
    if (action.type === 'quit') { quitting = true; app.quit(); return { ok: true }; }
    if (action.type === 'showWindow') { showMain(); widget?.hide(); return { ok: true }; }
    if (action.type === 'openSettings') {
      const urls = process.platform === 'darwin'
        ? { airpods: current.audio.available && modelForDevice(current.device).family === 'airpods' && existsSync('/System/Library/ExtensionKit/Extensions/HeadphoneSettingsExtension.appex') ? 'x-apple.systempreferences:com.apple.HeadphoneSettings' : 'x-apple.systempreferences:com.apple.BluetoothSettings', bluetooth: 'x-apple.systempreferences:com.apple.BluetoothSettings', sound: 'x-apple.systempreferences:com.apple.Sound-Settings.extension', permissions: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Bluetooth' }
        : { airpods: 'ms-settings:bluetooth', bluetooth: 'ms-settings:bluetooth', sound: 'ms-settings:sound', permissions: 'ms-settings:privacy-radios' };
      await shell.openExternal(urls[action.page]); return { ok: true };
    }
    if (action.type === 'preferences' && typeof action.value.launchAtLogin === 'boolean' && !demo) {
      try {
        if (!app.isPackaged) throw new Error('Open the packaged MomoBose app to change login startup.');
        app.setLoginItemSettings({ openAtLogin: action.value.launchAtLogin, args: ['--hidden'] });
      }
      catch (error) { return { ok: false, error: `Could not change startup settings: ${(error as Error).message}` }; }
    }
    const result = demo ? await demoAPI.command(action) : await controller!.execute(action);
    return result;
  } catch (error) { return { ok: false, error: (error as Error).message }; }
}
function createWindow(compact = false) {
  const window = new BrowserWindow({
    width: compact ? 370 : 1040, height: compact ? 608 : 780,
    minWidth: compact ? 370 : 860, minHeight: compact ? 480 : 640,
    show: false, backgroundColor: process.platform === 'darwin' ? '#00000000' : '#1e1e1e', title: 'MomoBose',
    ...(process.platform === 'darwin' ? { vibrancy: compact ? 'popover' as const : 'sidebar' as const, visualEffectState: 'followWindow' as const } : {}),
    icon: applicationIconPath(),
    ...(compact ? { frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true } : process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 20 } } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const query = { ...(compact ? { widget: '1' } : {}), ...(demo ? { demo: '1' } : {}) };
  if (devURL) { const url = new URL(devURL); Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v)); void window.loadURL(url.toString()); }
  else void window.loadFile(path.join(root, 'dist/index.html'), { query });
  window.on('close', event => {
    if (!quitting) {
      event.preventDefault(); window.hide();
      if (!compact) hideDock();
    }
  });
  if (compact) window.on('blur', () => { if (!process.argv.includes('--keep-widget-open')) window.hide(); });
  return window;
}
function hideDock() {
  if (process.platform !== 'darwin' || quitting || main?.isVisible()) return;
  clearTimeout(dockHideTimer);
  // Electron ignores dock.hide() for one second after dock.show().
  const delay = 1100 - (Date.now() - lastDockChange);
  if (delay > 0) { dockHideTimer = setTimeout(hideDock, delay); return; }
  app.dock?.hide();
  lastDockChange = Date.now();
}
function showMain() {
  if (quitting) return;
  clearTimeout(dockHideTimer);
  if (process.platform === 'darwin' && app.dock && !app.dock.isVisible()) {
    lastDockChange = Date.now();
    void app.dock.show();
  }
  if (!main || main.isDestroyed()) main = createWindow();
  if (main.isMinimized()) main.restore();
  main.show(); main.focus();
}
function toggleWidget() {
  if (!widget || widget.isDestroyed()) widget = createWindow(true);
  if (widget.isVisible()) { widget.hide(); return; }
  const bounds = tray.getBounds();
  const area = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
  const [width, height] = widget.getSize();
  const x = Math.min(Math.max(area.x + 8, Math.round(bounds.x + bounds.width / 2 - width / 2)), area.x + area.width - width - 8);
  const top = process.platform === 'darwin' || bounds.y < area.y + area.height / 2;
  const y = top ? Math.max(area.y + 8, bounds.y + bounds.height + 7) : Math.min(area.y + area.height - height - 8, bounds.y - height - 7);
  widget.setPosition(x, Math.max(area.y + 8, y)); widget.show(); widget.focus();
}
function contextMenu() {
  const connected = current.connection === 'connected', enabled = connected && !current.busy;
  const family = modelForDevice(current.device).family;
  return Menu.buildFromTemplate([
    { label: `MomoBose · ${current.device?.name ?? 'QuietComfort 45'}`, enabled: false },
    { label: connected ? `Battery ${current.settings.battery ?? '—'}% · ${current.audio.isDefault ? 'Audio ready' : 'Check audio output'}` : current.audio.available ? 'Audio connected · controls offline' : 'Not connected', enabled: false },
    { type: 'separator' },
    { label: connected ? 'Disconnect' : 'Connect to this computer', enabled: !current.busy && Boolean(current.device), click: () => { void command(connected ? { type: 'disconnect' } : { type: 'connect', address: current.device!.address, confirmedQc45: true }); } },
    ...(['bose', 'sony'].includes(family) ? [{ label: family === 'sony' ? 'Noise cancelling' : 'Quiet', type: 'radio' as const, checked: current.settings.mode === ListeningMode.Quiet, enabled: enabled && current.settings.mode !== null, click: () => { void command({ type: 'mode', value: ListeningMode.Quiet }); } },
    { label: family === 'sony' ? 'Ambient sound' : 'Aware', type: 'radio' as const, checked: current.settings.mode === ListeningMode.Aware, enabled: enabled && current.settings.mode !== null, click: () => { void command({ type: 'mode', value: ListeningMode.Aware }); } },
    ...(family === 'sony' ? [{ label: 'Noise control off', type: 'radio' as const, checked: current.settings.mode === ListeningMode.Off, enabled: enabled && current.settings.mode !== null, click: () => { void command({ type: 'mode', value: ListeningMode.Off }); } }] : []),
    { label: 'Multipoint', type: 'checkbox' as const, checked: current.settings.multipoint === true, enabled: enabled && current.settings.multipoint !== null, click: () => { void command({ type: 'multipoint', value: !current.settings.multipoint }); } },
    ] : [{ label: 'Headphone settings…', click: () => { void command({ type: 'openSettings', page: 'airpods' }); } }]),
    { type: 'separator' },
    { label: 'Open MomoBose', click: showMain },
    updateMenuItem(),
    { label: 'Quit MomoBose', click: () => { quitting = true; app.quit(); } },
  ]);
}
function updateMenuItem(): Electron.MenuItemConstructorOptions {
  const state = updates?.state;
  return {
    label: state?.status === 'downloaded' ? 'Restart to Update…' : state?.status === 'available' ? 'Download Update…' : state?.status === 'downloading' ? `Downloading Update… ${state.percent ?? 0}%` : state?.status === 'checking' ? 'Checking for Updates…' : 'Check for Updates…',
    enabled: Boolean(state && state.mode !== 'disabled' && !['checking', 'downloading'].includes(state.status)),
    click: () => {
      showMain();
      if (updates?.state.status === 'downloaded') {
        try { updates.install(); } catch { /* The updater publishes the failure to the window. */ }
      }
      else if (updates?.state.status === 'available') void updates.openRelease().catch(() => {});
      else void updates?.check();
    },
  };
}
function refreshApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'MomoBose', submenu: [{ role: 'about' as const }, updateMenuItem(), { type: 'separator' as const }, { role: 'hide' as const }, { role: 'hideOthers' as const }, { type: 'separator' as const }, { label: 'Quit MomoBose', accelerator: 'Cmd+Q', click: () => { quitting = true; app.quit(); } }] }] : []),
    { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'selectAll' }] },
    { label: 'Window', submenu: [{ label: 'Show MomoBose', click: showMain }, { role: 'minimize' }, { id: 'close-window', role: 'close', accelerator: 'CmdOrCtrl+W' }] },
    ...(process.platform === 'darwin' ? [] : [{ label: 'Help', submenu: [updateMenuItem()] }]),
  ]));
}
function update(state: AppState) {
  current = state;
  if (quitting) return;
  if (nativeTheme.themeSource !== state.preferences.appearance) nativeTheme.themeSource = state.preferences.appearance;
  updateApplicationIcon();
  for (const window of windows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send('momobose:state', state);
  }
  if (!tray || tray.isDestroyed()) return;
  tray.setToolTip(`MomoBose · ${state.device?.name ?? 'QC45'} · ${state.connection}${state.settings.battery !== null ? ` · ${state.settings.battery}%` : ''}`);
  if (process.platform === 'darwin') tray.setTitle(state.preferences.showBatteryInTray && state.settings.battery !== null ? `${state.settings.battery}%` : '');
}
app.on('second-instance', showMain);
app.on('activate', showMain);
app.on('window-all-closed', () => { /* Keep the menu bar / tray control running. */ });
app.on('before-quit', () => {
  quitting = true;
  updates?.stop();
  clearTimeout(dockHideTimer);
  nativeTheme.off('updated', updateApplicationIcon);
  controller?.off('state', update);
  controller?.stop(); bridge?.stop();
  if (tray && !tray.isDestroyed()) tray.destroy();
});

if (single) void app.whenReady().then(async () => {
  if (demo) { current = await demoAPI.snapshot(); demoAPI.subscribe(update); }
  else {
    const folder = app.isPackaged ? path.join(process.resourcesPath, 'native') : path.join(root, 'native/bin', `${process.platform === 'darwin' ? 'mac' : 'win'}-${process.arch}`);
    bridge = new NativeBridge(folder); controller = new Controller(bridge, loadPreferences(), savePreferences);
    current = controller.snapshot(); controller.on('state', update);
  }
  const icon = nativeImage.createFromPath(path.join(root, process.platform === 'darwin' ? 'assets/trayTemplate.png' : 'assets/tray.png'));
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.on('click', toggleWidget); tray.on('right-click', () => tray.popUpContextMenu(contextMenu()));
  ipcMain.handle('momobose:snapshot', event => { allowedSender(event); return current; });
  ipcMain.handle('momobose:command', (event, action) => { allowedSender(event); return command(action); });
  // Do not contact GitHub during development, demo sessions, or smoke tests.
  const updater = app.isPackaged && !demo && !process.argv.includes('--smoke-test') && ['win32', 'darwin'].includes(process.platform)
    ? (await import('electron-updater')).default.autoUpdater : null;
  updates = new UpdateManager(updater, {
    platform: process.platform, arch: process.arch,
    installed: process.platform === 'win32' && existsSync(path.join(path.dirname(app.getPath('exe')), 'Uninstall MomoBose.exe')),
    publish: state => {
      if (quitting) return;
      for (const window of windows()) if (!window.webContents.isDestroyed()) window.webContents.send('momobose:updates:state', state);
      refreshApplicationMenu();
    },
    beforeInstall: () => { quitting = true; clearTimeout(dockHideTimer); },
    installFailed: () => { quitting = false; showMain(); },
    openRelease: url => shell.openExternal(url),
  });
  ipcMain.handle('momobose:updates:snapshot', event => { allowedSender(event); return updates!.state; });
  ipcMain.handle('momobose:updates:check', event => { allowedSender(event); void updates!.check(); });
  ipcMain.handle('momobose:updates:install', event => { allowedSender(event); updates!.install(); });
  ipcMain.handle('momobose:updates:open-release', event => { allowedSender(event); return updates!.openRelease(); });
  nativeTheme.on('updated', updateApplicationIcon);
  nativeTheme.themeSource = current.preferences.appearance;
  main = createWindow();
  if (process.argv.includes('--hidden')) hideDock();
  main.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) showMain(); });
  refreshApplicationMenu();
  updates.start();
  powerMonitor.on('suspend', () => { void controller?.suspend(); }); powerMonitor.on('resume', () => controller?.resume());
  update(current);
  // Smoke checks must not inherit a user's automatic reconnect preference.
  const startup = process.argv.includes('--smoke-test') ? controller?.execute({ type: 'discover' }) : controller?.start();
  if (!demo && !process.argv.includes('--smoke-test') && process.argv.includes('--connect-qc45')) {
    await startup;
    const selected = current.devices.find(device => device.address === current.preferences.selectedAddress && device.productId === 0x4039)
      ?? current.devices.find(device => device.productId === 0x4039);
    if (selected) await controller!.execute({ type: 'connect', address: selected.address, confirmedQc45: true });
  }
  if (process.argv.includes('--smoke-test')) {
    const output = process.env.MOMOBOSE_SMOKE_OUTPUT || '/tmp/momobose-smoke';
    mkdirSync(output, { recursive: true });
    await startup;
    await new Promise<void>(resolve => { if (main!.webContents.isLoading()) main!.webContents.once('did-finish-load', () => resolve()); else resolve(); });
    await new Promise(resolve => setTimeout(resolve, 500));
    const report: Record<string, unknown> = {
      state: current, trayCreated: !tray.isDestroyed(),
      updates: { state: updates.state, dependencyAvailable: typeof (await import('electron-updater')).default.autoUpdater.checkForUpdates === 'function' },
      renderer: await main!.webContents.executeJavaScript('({ title: document.title, text: document.body.innerText, nodeExposed: typeof window.require !== "undefined", bridgeAvailable: typeof window.momoBose?.command === "function" })'),
    };
    if (process.argv.includes('--read-qc45') && bridge && !demo) {
      const target = current.devices.find(device => device.productId === 0x4039);
      if (!target) report.hardwareRead = { ok: false, error: 'No positively identified paired QC45 found.' };
      else {
        const probe = new Qc45(bridge);
        try {
          await probe.connect(target.address, true);
          const readings = await probe.read();
          const multipoint = await probe.exchange(1, 10, 1);
          report.hardwareRead = { ok: true, ...readings, rawMode: probe.latestRawMode, modeProfiles: probe.modeProfiles, multipointRaw: multipoint.payload.toString('hex') };
        } catch (error) { report.hardwareRead = { ok: false, error: (error as Error).message }; }
        finally { await probe.close().catch(() => {}); }
      }
    }
    writeFileSync(path.join(output, 'main.png'), (await main!.webContents.capturePage()).toPNG());
    toggleWidget();
    await new Promise<void>(resolve => { if (widget!.webContents.isLoading()) widget!.webContents.once('did-finish-load', () => resolve()); else resolve(); });
    await new Promise(resolve => setTimeout(resolve, 350));
    report.widget = await widget!.webContents.executeJavaScript('({ text: document.body.innerText, compact: document.querySelector(".widget") !== null, width: innerWidth, noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth })');
    writeFileSync(path.join(output, 'widget.png'), (await widget!.webContents.capturePage()).toPNG());
    main!.close();
    await new Promise(resolve => setTimeout(resolve, 1200));
    report.closeToTray = { windowHidden: !main!.isVisible(), windowRetained: !main!.isDestroyed(), trayAlive: !tray.isDestroyed(), dockHidden: process.platform === 'darwin' ? !app.dock!.isVisible() : null };
    showMain();
    await new Promise(resolve => setTimeout(resolve, 100));
    report.reopened = main!.isVisible();
    report.dockRestored = process.platform === 'darwin' ? app.dock!.isVisible() : null;
    writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    quitting = true; app.quit();
  }
}).catch(error => { console.error('MomoBose startup failed:', error); app.exit(1); });
