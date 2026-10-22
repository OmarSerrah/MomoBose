// Run from the repository root. Test tooling is never invoked by release signing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

assert.equal(process.platform, 'darwin', 'Sparkle integration tests require macOS');
const version = '2.9.6';
const checksum = '52bf9e88cdd972fc0c81501377a880e90d47031bd8ca5462488f843e2609e192';
const revision = 'ac2def288cbff5cfc7df3ffef6abdf45b72bcb0a';
const root = mkdtempSync(path.join(os.tmpdir(), 'momobose-upgrade-tools-'));
const archive = path.join(root, `Sparkle-${version}.tar.xz`);
const response = await fetch(`https://github.com/sparkle-project/Sparkle/releases/download/${version}/Sparkle-${version}.tar.xz`, { signal: AbortSignal.timeout(60000) });
assert(response.ok, 'Could not download the official Sparkle distribution');
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'), checksum, 'Official Sparkle archive checksum mismatch');
writeFileSync(archive, bytes);
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, `${command}: ${result.stderr || result.stdout || result.error}`);
  return result.stdout.trim();
};
run('/usr/bin/tar', ['-xf', archive, '-C', root]);
const source = path.join(root, 'source');
run('git', ['clone', '--depth', '1', '--branch', version, 'https://github.com/sparkle-project/Sparkle.git', source]);
assert.equal(run('git', ['-C', source, 'rev-parse', 'HEAD']), revision, 'Official Sparkle source revision mismatch');
run('clang', [
  '-fobjc-arc', '-fmodules',
  '-DSPU_OBJC_DIRECT=__attribute__((objc_direct))',
  '-DSPU_OBJC_DIRECT_MEMBERS=__attribute__((objc_direct_members))',
  '-F', root, '-I', source, '-I', path.join(source, 'Sparkle'),
  '-include', 'Sparkle/SUExport.h', '-framework', 'Foundation',
  '-framework', 'AppKit', '-framework', 'Sparkle', `-Wl,-rpath,${root}`,
  ...['main.m', 'SPUCommandLineDriver.m', 'SPUCommandLineUserDriver.m'].map(name => path.join(source, 'sparkle-cli', name)),
  '-o', path.join(root, 'sparkle-cli'),
]);
mkdirSync('release', { recursive: true });
writeFileSync('release/sparkle-upgrade-tools-path.txt', `${root}\n`);
console.log(`Checksum-verified Sparkle distribution and source-built test CLI: ${root}`);
