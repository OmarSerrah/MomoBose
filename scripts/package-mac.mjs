import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const config = JSON.parse(readFileSync('package.json', 'utf8'));
const args = process.argv.slice(2);
assert.equal(process.platform, 'darwin', 'Package macOS builds on a Mac');
assert(args.every(arg => ['--dir', '--arm64', '--x64'].includes(arg)), 'Unsupported macOS packaging argument');
assert(!(args.includes('--arm64') && args.includes('--x64')), 'Choose one Mac architecture');
const arch = args.includes('--arm64') ? 'arm64' : args.includes('--x64') ? 'x64' : process.env.MOMOBOSE_TARGET_ARCH || process.arch;
assert(['arm64', 'x64'].includes(arch), 'Unsupported Mac architecture');
assert.equal(config.build.mac.identity, '-', 'MomoBose uses free ad-hoc macOS signing');
assert.equal(config.build.mac.hardenedRuntime, true, 'Keep Hardened Runtime enabled');
const directoryOnly = args.includes('--dir');
const output = path.resolve(process.env.MOMOBOSE_RELEASE_DIR || config.build.directories.output);
// Desktop/File Provider metadata can make codesign reject an otherwise valid
// bundle. Sign and archive on a clean temporary volume path, before copying ZIPs
// and DMGs to the workspace. Do not copy a signed .app into a synced folder.
const staging = mkdtempSync(path.join(os.tmpdir(), 'momobose-mac-'));
let retainApp = false;
const run = (command, arguments_, capture = false) => {
  const result = spawnSync(command, arguments_, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  assert.equal(result.status, 0, `${path.basename(command)} failed while packaging macOS`);
  return `${result.stdout || ''}${result.stderr || ''}`;
};

try {
  const targets = directoryOnly ? ['--dir'] : ['dmg', 'zip'];
  run(process.execPath, [require.resolve('electron-builder/cli.js'), '--mac', ...targets, `--${arch}`, '--publish', 'never', `--config.directories.output=${staging}`]);
  const apps = readdirSync(staging, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(staging, entry.name, `${config.build.productName}.app`))
    .filter(existsSync);
  assert.equal(apps.length, 1, 'Expected one packaged macOS app');
  const app = apps[0];
  const machoArch = arch === 'x64' ? 'x86_64' : 'arm64';
  for (const binary of ['Contents/MacOS/MomoBose', 'Contents/Resources/native/momobose-bluetooth', 'Contents/Frameworks/electron_sparkle.node']) {
    const architectures = run('/usr/bin/lipo', ['-archs', path.join(app, binary)], true).trim().split(/\s+/);
    assert(architectures.includes(machoArch), `Packaged ${binary} does not support ${arch}`);
  }
  run('codesign', ['--verify', '--deep', '--strict', app]);
  const signature = run('codesign', ['--display', '--verbose=2', app], true);
  assert(signature.includes('Signature=adhoc') && /flags=.*\bruntime\b/.test(signature), 'Expected an ad-hoc signature with Hardened Runtime');
  const plist = path.join(app, 'Contents/Info.plist');
  for (const key of ['SUPublicEDKey', 'SUFeedURL', 'SURequireSignedFeed', 'SUVerifyUpdateBeforeExtraction']) {
    const value = run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], true).trim();
    assert.equal(value, String(config.build.mac.extendInfo[key]), `Packaged ${key} differs from release configuration`);
  }
  for (const key of ['CFBundleVersion', 'CFBundleShortVersionString']) {
    assert.equal(run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], true).trim(), config.version, `Packaged ${key} differs from the release version`);
  }
  const sparkleRoot = path.dirname(require.resolve('electron-sparkle/package.json'));
  run(process.execPath, [path.join(sparkleRoot, 'dist/cli.js'), 'doctor', '--app', app]);
  mkdirSync(output, { recursive: true });
  if (directoryOnly) {
    writeFileSync(path.join(output, `mac-${arch}-app-path.txt`), `${app}\n`);
    retainApp = true;
    console.log(`Verified ad-hoc signed app: ${app}`);
  } else {
    const base = `MomoBose-${config.version}-mac-${arch}`;
    const required = [`${base}.dmg`, `${base}.zip`, `latest-${arch}-mac.yml`];
    const optional = [`${base}.dmg.blockmap`, `${base}.zip.blockmap`];
    for (const name of required) assert(existsSync(path.join(staging, name)), `Missing release artifact: ${name}`);
    for (const name of [...required, ...optional.filter(name => existsSync(path.join(staging, name)))]) {
      copyFileSync(path.join(staging, name), path.join(output, name));
    }
    console.log(`Verified ${arch} macOS release archives copied to ${output}`);
  }
} finally {
  if (!retainApp) rmSync(staging, { recursive: true, force: true });
}
