import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { extractFile } from '@electron/asar';
import assert from 'node:assert/strict';
import path from 'node:path';

// Verify that the distributable app folders contain this build, not an older bundle.
const expected = readFileSync('dist-electron/main.cjs');
const release = process.env.MOMOBOSE_RELEASE_DIR || 'release';
for (const archive of [path.join(release, 'mac-arm64/MomoBose.app/Contents/Resources/app.asar'), path.join(release, 'win-unpacked/resources/app.asar')]) {
  assert(extractFile(archive, 'dist-electron/main.cjs').equals(expected), `${archive} does not match the current build`);
  const metadata = JSON.parse(extractFile(archive, 'package.json').toString());
  assert.equal(metadata.productName, 'MomoBose');
}
const windowsHelper = path.join(release, 'win-unpacked/resources/native/MomoBose.Bluetooth.exe');
assert(readFileSync(windowsHelper).equals(readFileSync('native/bin/win-x64/MomoBose.Bluetooth.exe')), 'Windows helper is stale');
const macHelper = path.join(release, 'mac-arm64/MomoBose.app/Contents/Resources/native/momobose-bluetooth');
assert(existsSync(macHelper), 'Mac helper is missing');
if (process.platform === 'darwin') {
  execFileSync('codesign', ['--verify', '--deep', '--strict', path.join(release, 'mac-arm64/MomoBose.app')], { stdio: 'inherit' });
  const usage = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :NSBluetoothAlwaysUsageDescription', path.join(release, 'mac-arm64/MomoBose.app/Contents/Info.plist')], { encoding: 'utf8' });
  assert(usage.includes('MomoBose'), 'Missing Bluetooth usage description');
}
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const files = [`MomoBose-${version}-arm64.dmg`, `MomoBose-${version}-arm64-mac.zip`, `MomoBose Setup ${version}.exe`, `MomoBose-${version}-win.zip`];
const hashes = files.map(name => `${createHash('sha256').update(readFileSync(path.join(release, name))).digest('hex')}  ${name}`);
writeFileSync(path.join(release, 'SHA256SUMS'), `${hashes.join('\n')}\n`);
console.log('Verified both app bundles, native helpers, Mac signature, Bluetooth description and four release artifacts.');
