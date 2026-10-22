import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const os = process.platform === 'darwin' ? 'mac' : 'win';
if (!existsSync(`native/bin/${os}-${process.arch}/${process.platform === 'win32' ? 'MomoBose.Bluetooth.exe' : 'momobose-bluetooth'}`)) execFileSync('node', ['scripts/build-native.mjs'], { stdio: 'inherit' });
execFileSync('node', ['scripts/build-electron.mjs'], { stdio: 'inherit' });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit' });
let electron;
for (let i = 0; i < 60; i++) {
  try { if ((await fetch('http://127.0.0.1:5173')).ok) break; } catch {}
  await new Promise(r => setTimeout(r, 250));
}
const binary = (await import('electron')).default;
const environment = { ...process.env, MOMOBOSE_DEV_URL: 'http://127.0.0.1:5173' };
delete environment.ELECTRON_RUN_AS_NODE;
electron = spawn(binary, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: environment });
const stop = () => { vite.kill(); electron?.kill(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop); electron.on('exit', () => { vite.kill(); });
