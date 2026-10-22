// Opt-in integration check. Only disposable, uniquely identified app copies are
// modified. A disposable Ed25519 key and a loopback feed replace production
// update infrastructure. Bluetooth is a child-process fixture; updater/UI code
// and the native Sparkle installer run from the packaged application.
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, verify } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { extractAll, createPackage } from '@electron/asar';

assert.equal(process.platform, 'darwin', 'Run the upgrade check on macOS');
const arch = process.argv.find(arg => arg.startsWith('--arch='))?.split('=')[1] || process.arch;
const scenario = process.argv.find(arg => arg.startsWith('--scenario='))?.split('=')[1] || 'upgrade';
assert(['upgrade', 'offline', 'bad-feed', 'bad-archive'].includes(scenario), 'Unsupported scenario');
const headless = process.argv.includes('--headless');
assert(['arm64', 'x64'].includes(arch), 'Unsupported architecture');
const source = readFileSync(`release/mac-${arch}-app-path.txt`, 'utf8').trim();
assert(existsSync(source), 'Build the current app with package-mac.mjs --dir first');
const tools = readFileSync('release/sparkle-upgrade-tools-path.txt', 'utf8').trim();
const signer = path.join(tools, 'bin/sign_update');
assert(existsSync(signer), 'Provide checksum-verified official Sparkle tools');
const root = mkdtempSync(path.join(os.tmpdir(), `momobose-upgrade-${arch}-`));
const bundleId = `com.momo.momobose.upgradecheck.${path.basename(root).replaceAll('-', '').toLowerCase()}`;
const appName = 'MomoBose Upgrade Test.app';
const installed = path.join(root, 'installed', appName);
const eventsFile = path.join(root, 'events.jsonl');
const controlFile = path.join(root, 'control.json');
const profile = path.join(root, 'profile');
const archive = path.join(root, 'update.zip');
const archiveBad = path.join(root, 'update-tampered.zip');
const feedFile = path.join(root, 'appcast.xml');
const summary = { root, arch, hostArch: process.arch, bundleId, source, scenario, driver: headless ? 'official-sparkle-cli' : 'native-dialog', scenarios: [], requests: [] };
summary.hardwareArm64 = spawnSync('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8' }).stdout.trim() === '1';
mkdirSync(profile, { recursive: true });
writeFileSync(eventsFile, '');
writeFileSync(controlFile, '{}');
writeFileSync(`release/mac-upgrade-test-${arch}.json`, JSON.stringify({ root, eventsFile }, null, 2));
writeFileSync(`release/mac-upgrade-test-${arch}-${scenario}-${process.pid}.json`, JSON.stringify({ root, eventsFile }, null, 2));
console.log(`Upgrade fixture: ${root}`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', env, timeout: 120000, maxBuffer: 4 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${path.basename(command)}: ${result.stderr || result.stdout || result.error}`);
  return result.stdout.trim();
};
const events = () => readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = predicate(); if (value) return value; await pause(400); }
  throw new Error(`Timed out: ${label}; see ${eventsFile}`);
}
let sequence = 0;
function control(action) { writeFileSync(controlFile, JSON.stringify({ action, sequence: ++sequence })); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
const keyPair = generateKeyPairSync('ed25519');
const seed = keyPair.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64');
const publicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
let feedMode = scenario === 'upgrade' ? 'valid' : scenario;
const server = http.createServer((req, res) => {
  summary.requests.push({ url: req.url, mode: feedMode, time: Date.now() });
  if (req.url === '/appcast.xml') {
    if (feedMode === 'offline') { res.writeHead(503); res.end('Offline test'); return; }
    res.writeHead(200, { 'Content-Type': 'application/xml', 'Cache-Control': 'no-store' });
    const feed = readFileSync(feedFile, 'utf8');
    res.end(feedMode === 'bad-feed' ? feed.replace('MomoBose test updates', 'MomoBose modified updates') : feed);
  } else if (req.url === '/update.zip') {
    const file = feedMode === 'bad-archive' ? archiveBad : archive;
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': readFileSync(file).length, 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  } else { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const originalVersion = '0.1.13';
const updateVersion = '0.1.14';

// These wrappers live only in the fixture ASAR, never in the released app.
const wrapper = `const {app,BrowserWindow,shell}=require('electron');
const fs=require('node:fs');const cp=require('node:child_process');
const eventsFile=${JSON.stringify(eventsFile)}, controlFile=${JSON.stringify(controlFile)};
app.setPath('userData',${JSON.stringify(profile)});
const record=(event,data={})=>fs.appendFileSync(eventsFile,JSON.stringify({event,pid:process.pid,version:app.getVersion(),time:Date.now(),...data})+'\\n');
record('launch',{executable:process.execPath});
let shuttingDown=false;
const realSpawn=cp.spawn;cp.spawn=function(command,...args){const child=realSpawn.call(this,command,...args);if(String(command).endsWith('/momobose-bluetooth')){record('helper-start',{helperPid:child.pid});child.on('exit',()=>record('helper-exit',{helperPid:child.pid}));}return child;};
shell.openExternal=async url=>{record('external-url',{url});};
app.on('before-quit',()=>{shuttingDown=true;record('before-quit');});
app.on('will-quit',()=>record('will-quit'));
app.on('browser-window-created',(_event,window)=>window.webContents.once('did-finish-load',async()=>{
 try{const state=await window.webContents.executeJavaScript('window.momoBose.snapshot()');record('renderer-ready',{preferences:state.preferences});}catch(e){record('fixture-error',{message:String(e)});}
}));
const updaterReady=app.whenReady().then(async()=>{const {updater}=await import('electron-sparkle');for(const name of ['update-available','update-not-available','update-downloaded','before-install','before-relaunch','cycle-complete','error'])updater.on(name,value=>record(name,{message:value.error?.message,update:value.update}));return updater;});
let lastSequence=0;setInterval(async()=>{try{if(shuttingDown)return;const value=JSON.parse(fs.readFileSync(controlFile,'utf8'));if(!value.sequence||value.sequence===lastSequence)return;lastSequence=value.sequence;const window=BrowserWindow.getAllWindows()[0];if(!window)return;
 if(value.action==='background-check'){const updater=await updaterReady;await updater.start();updater.checkForUpdatesInBackground();record('control-result',{action:value.action});return;}
 const code=value.action==='check'?'window.momoBose.updates.check()':value.action==='manual'?'window.momoBose.updates.openRelease()':value.action==='quit'?'window.momoBose.command({type:"quit"})':'Promise.all([window.momoBose.snapshot(),window.momoBose.updates.snapshot()])';
 const result=await window.webContents.executeJavaScript(code);record('control-result',{action:value.action,result});}catch(e){if(!shuttingDown)record('fixture-error',{message:String(e)});}},250);
require('./dist-electron/main.cjs');
`;

const helperSource = path.join(root, 'bluetooth-fixture.m');
writeFileSync(helperSource, '#import <Foundation/Foundation.h>\n#include <stdio.h>\nint main(){@autoreleasepool{char *line=NULL;size_t n=0;while(getline(&line,&n,stdin)>0){@try{NSData *data=[[NSString stringWithUTF8String:line] dataUsingEncoding:NSUTF8StringEncoding];NSDictionary *req=[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];NSDictionary *reply=@{@"id":req[@"id"],@"result":@[]};NSData *out=[NSJSONSerialization dataWithJSONObject:reply options:0 error:NULL];fwrite(out.bytes,1,out.length,stdout);fputc(10,stdout);fflush(stdout);}@catch(NSException *e){}}free(line);}return 0;}\n');
const helper = path.join(root, 'momobose-bluetooth');
run('clang', ['-O2', '-fobjc-arc', '-arch', arch === 'x64' ? 'x86_64' : 'arm64', '-framework', 'Foundation', helperSource, '-o', helper]);

async function buildFixture(version, folder) {
  const target = path.join(root, folder, appName);
  mkdirSync(path.dirname(target), { recursive: true });
  run('/usr/bin/ditto', ['--norsrc', '--noextattr', source, target]);
  const resources = path.join(target, 'Contents/Resources');
  const unpacked = path.join(root, `asar-${version}`);
  extractAll(path.join(resources, 'app.asar'), unpacked);
  const metadata = JSON.parse(readFileSync(path.join(unpacked, 'package.json'), 'utf8'));
  metadata.version = version; metadata.main = 'upgrade-fixture.cjs';
  writeFileSync(path.join(unpacked, 'package.json'), JSON.stringify(metadata));
  writeFileSync(path.join(unpacked, 'upgrade-fixture.cjs'), wrapper);
  rmSync(path.join(resources, 'app.asar'));
  // Keep the existing unpacked native files; runtime loads the bridge from
  // Contents/Frameworks. No release source or production key is changed.
  await createPackage(unpacked, path.join(resources, 'app.asar'));
  copyFileSync(helper, path.join(resources, 'native/momobose-bluetooth'));
  writeFileSync(path.join(resources, 'upgrade-version.txt'), version);
  const plist = path.join(target, 'Contents/Info.plist');
  for (const [key, value] of Object.entries({ CFBundleIdentifier: bundleId, CFBundleDisplayName: 'MomoBose Upgrade Test', CFBundleVersion: version, CFBundleShortVersionString: version, SUFeedURL: `${origin}/appcast.xml`, SUPublicEDKey: publicKey, SURequireSignedFeed: 'true', SUVerifyUpdateBeforeExtraction: 'true', SUEnableAutomaticChecks: 'false', SUAutomaticallyUpdate: 'false' })) {
    run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
  }
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--options', 'runtime', '--entitlements', path.resolve('native/macos/entitlements.plist'), target]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', target]);
  rmSync(unpacked, { recursive: true, force: true });
  return target;
}

function snapshot() {
  writeFileSync(path.join(root, 'summary.json'), JSON.stringify(summary, null, 2));
}
let launched;
let cliChild;
function invokeCli(args) {
  return new Promise((resolve, reject) => {
    const child = cliChild = spawn(path.join(tools, 'sparkle-cli'), args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Sparkle CLI timed out')); }, 180000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
  });
}
try {
  const old = await buildFixture(originalVersion, 'old');
  const next = await buildFixture(updateVersion, 'new');
  run('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', next, archive]);
  const archiveBytes = readFileSync(archive);
  const archiveSigning = run(signer, ['--ed-key-file', '-', archive], { input: seed, env: { PATH: process.env.PATH || '' } });
  const signatureText = /sparkle:edSignature="([^"]+)"/.exec(archiveSigning)?.[1];
  assert(signatureText && verify(null, archiveBytes, keyPair.publicKey, Buffer.from(signatureText, 'base64')), 'Official archive signature must verify');
  const corrupted = Buffer.from(archiveBytes); corrupted[Math.floor(corrupted.length / 2)] ^= 1; writeFileSync(archiveBad, corrupted);
  writeFileSync(feedFile, `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>MomoBose test updates</title><item><title>MomoBose ${updateVersion}</title><sparkle:version>${updateVersion}</sparkle:version><sparkle:shortVersionString>${updateVersion}</sparkle:shortVersionString><sparkle:minimumSystemVersion>12.0.0</sparkle:minimumSystemVersion>${arch === 'arm64' ? '<sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>' : ''}<enclosure url="${origin}/update.zip" ${archiveSigning} type="application/octet-stream"/></item></channel></rss>\n`);
  run(signer, ['--ed-key-file', '-', feedFile], { input: seed, env: { PATH: process.env.PATH || '' } });
  summary.archiveSha256 = createHash('sha256').update(archiveBytes).digest('hex');
  writeFileSync(path.join(profile, 'preferences.json'), JSON.stringify({ appearance: 'dark', autoReconnect: false, launchAtLogin: false, showBatteryInTray: false, selectedAddress: null }));
  run('/usr/bin/ditto', ['--norsrc', '--noextattr', old, installed]);
  const log = path.join(root, 'application.log');
  launched = spawn(path.join(installed, 'Contents/MacOS/MomoBose'), [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  launched.stdout.on('data', bytes => appendFileSync(log, bytes));
  launched.stderr.on('data', bytes => appendFileSync(log, bytes));
  const ready = await until(() => {
    assert(launched.exitCode === null && launched.signalCode === null, `Fixture exited before its renderer loaded; see ${log}`);
    return events().find(e => e.event === 'renderer-ready' && e.version === originalVersion);
  }, 'old renderer');
  assert.equal(ready.preferences.appearance, 'dark');
  summary.oldPid = ready.pid;
  console.log('Old packaged MomoBose is running with isolated dark-mode preferences.');
  if (headless) {
    const cli = path.join(tools, 'sparkle-cli');
    assert(existsSync(cli), 'Compile the official sparkle-cli from its matching source first');
    console.log('Running the official Sparkle command-line installer against the disposable app.');
    summary.cliResult = await invokeCli([installed, '--check-immediately', '--verbose', '--user-agent-name', 'MomoBoseUpgradeValidation']);
    console.log(summary.cliResult.output.split('\n').filter(line => !/^Downloaded \d+ out of|^Extracting Update \(\d+%\)/.test(line)).join('\n'));
    assert.equal(summary.cliResult.signal, null, 'A killed CLI is not a successful test');
    if (scenario === 'upgrade') assert.equal(summary.cliResult.code, 0, 'Sparkle CLI upgrade must succeed');
    else {
      assert(Number.isInteger(summary.cliResult.code) && summary.cliResult.code !== 0, 'The invalid/offline update must fail normally');
      const diagnostic = scenario === 'offline' ? /503|unavailable|download/i : /signature|signed|validat|verif/i;
      assert.match(summary.cliResult.output, diagnostic, 'Require a scenario-specific rejection diagnostic');
    }
  } else {
  control(scenario === 'offline' || scenario === 'bad-feed' ? 'background-check' : 'check');
  }
  if (scenario !== 'upgrade') {
    if (!headless && scenario === 'bad-archive') {
      await until(() => events().find(e => e.event === 'update-available'), 'native update prompt');
      console.log('Tampered ZIP scenario: accept Install Update in the test window.');
    }
    if (!headless) {
      const rejected = await until(() => events().find(e => e.event === 'error'), 'native rejection');
      assert.match(rejected.message, scenario === 'offline' ? /server|internet|connection|download|feed|retriev/i : /sign|validat|verif/i, 'Require a scenario-specific native error');
    }
    assert(summary.requests.some(request => request.url === '/appcast.xml'), 'The updater must have requested the fixture feed');
    if (scenario === 'bad-archive') assert(summary.requests.some(request => request.url === '/update.zip'), 'The updater must have downloaded the tampered archive');
    assert(alive(ready.pid), 'A rejected update must leave the old app running');
    assert.equal(readFileSync(path.join(installed, 'Contents/Resources/upgrade-version.txt'), 'utf8'), originalVersion);
    const since = events().length; control('snapshot');
    const observation = await until(() => events().slice(since).find(e => e.event === 'control-result' && e.action === 'snapshot'), 'usable renderer after rejection');
    assert.equal(observation.result[0].preferences.appearance, 'dark');
    if (!headless) assert.equal(observation.result[1].status, 'error', 'The app must present an updater error');
    control('manual');
    await until(() => events().some(e => e.event === 'external-url' && e.url === 'https://github.com/OmarSerrah/MomoBose/releases/latest'), 'manual fallback');
    summary.scenarios.push({ name: scenario, passed: true, oldAppPreserved: true, rendererUsable: true, manualFallback: true });
    control('quit'); await until(() => !alive(ready.pid), 'failed-update fixture shutdown');
    summary.completed = true; snapshot();
    console.log(`PASS: ${scenario} rejected; old app and preferences preserved; manual fallback works.`);
  } else {
  if (!headless) {
  await until(() => events().find(e => e.event === 'update-available'), 'native update prompt');
  summary.scenarios.push({ name: 'check', passed: true }); snapshot();
  assert(!summary.requests.some(r => r.url === '/update.zip'), 'Do not download before consent');
  console.log('Native update is available. Ready to accept Install Update and Install and Relaunch.');
  }
  // Keep the server alive while the authorized native dialogs are driven by
  // Accessibility or by the maintainer. The parent agent can inspect events.
  const upgraded = await until(() => events().find(e => e.event === 'renderer-ready' && e.version === updateVersion), 'replacement and relaunch', 20 * 60 * 1000);
  assert.equal(upgraded.preferences.appearance, 'dark');
  assert.equal(upgraded.preferences.showBatteryInTray, false);
  assert.equal(readFileSync(path.join(installed, 'Contents/Resources/upgrade-version.txt'), 'utf8'), updateVersion);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed]);
  await until(() => !alive(ready.pid), 'old process termination');
  const oldHelper = events().find(e => e.event === 'helper-start' && e.pid === ready.pid);
  assert(oldHelper, 'The old helper must have run');
  await until(() => !alive(oldHelper.helperPid), 'old helper termination');
  summary.scenarios.push({ name: 'replacement-relaunch-preferences-helper-cleanup', passed: true, oldPid: ready.pid, newPid: upgraded.pid }); snapshot();
  console.log('PASS: replaced and relaunched at the new version; preferences retained; old app/helper exited.');
  if (headless) {
    summary.repeatProbe = await invokeCli([installed, '--probe', '--verbose', '--user-agent-name', 'MomoBoseUpgradeValidation']);
    assert.equal(summary.repeatProbe.signal, null);
    assert.equal(summary.repeatProbe.code, 4, 'The official probe must report no available update');
  } else {
    const since = events().length; control('check');
    await until(() => events().slice(since).find(e => e.event === 'update-not-available'), 'repeat check');
  }
  summary.scenarios.push({ name: 'repeat-check', passed: true }); snapshot();
  console.log('PASS: repeat check reports no update.');
  control('quit');
  await until(() => !alive(upgraded.pid), 'fixture shutdown', 20 * 60 * 1000);
  summary.completed = true; snapshot();
  }
} catch (error) {
  summary.error = String(error); snapshot(); throw error;
} finally {
  server.close();
  if (launched && alive(launched.pid)) launched.kill();
  if (cliChild && alive(cliChild.pid)) cliChild.kill();
  for (const pid of new Set(events().filter(e => e.event === 'launch' || e.event === 'helper-start').map(e => e.helperPid || e.pid))) {
    if (alive(pid)) { try { process.kill(pid, 'SIGTERM'); } catch { /* Already exited. */ } }
  }
  try {
    await until(() => events().filter(e => e.event === 'launch' || e.event === 'helper-start').every(e => !alive(e.helperPid || e.pid)), 'fixture process cleanup', 10000);
    summary.cleanupPassed = true;
  } catch (error) {
    summary.cleanupPassed = false;
    summary.cleanupForced = true;
    for (const pid of new Set(events().filter(e => e.event === 'launch' || e.event === 'helper-start').map(e => e.helperPid || e.pid))) {
      if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already exited. */ } }
    }
    if (!summary.error) throw error;
  } finally { snapshot(); }
}
