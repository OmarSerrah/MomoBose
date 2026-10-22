import { spawn } from 'node:child_process';
import electron from 'electron';
const environment = { ...process.env };
// Some desktop coding environments run their tools with Electron in Node mode.
// A child desktop app must restore ordinary Electron behavior.
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: environment });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
