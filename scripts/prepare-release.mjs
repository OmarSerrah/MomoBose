import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'js-yaml';

// Keep generated filenames intact: the updater manifests and blockmaps refer to them.
export function prepareRelease(input, output, version) {
  assert(!existsSync(output), `Output directory already exists: ${output}`);
  const assets = new Map();
  for (const platform of ['mac', 'win']) for (const arch of ['x64', 'arm64']) {
    const dir = path.join(input, `MomoBose-${platform}-${arch}`);
    const manifest = `latest-${arch}${platform === 'mac' ? '-mac' : ''}.yml`;
    const entries = readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile());
    assert(entries.some(entry => entry.name === manifest), `Missing ${manifest}`);
    for (const { name } of entries) {
      assert(/\.(dmg|zip|exe|yml|blockmap)$/.test(name), `Unexpected release asset: ${name}`);
      assert(!name.endsWith('.yml') || name === manifest, `Unexpected update manifest: ${name}`);
      assert(!assets.has(name), `Duplicate release asset: ${name}`);
      assets.set(name, path.join(dir, name));
    }
    const info = load(readFileSync(path.join(dir, manifest), 'utf8'));
    assert.equal(info.version, version, `Incorrect version in ${manifest}`);
    assert(Array.isArray(info.files) && info.files.length > 0, `No files in ${manifest}`);
    const extensions = new Set(platform === 'mac' ? ['zip', 'dmg'] : ['exe']);
    for (const file of info.files) {
      assert.equal(typeof file.url, 'string');
      assert.equal(path.basename(file.url), file.url, `Unexpected URL in ${manifest}`);
      assert(file.url.startsWith(`MomoBose-${version}-${platform}-${arch}.`), `Wrong platform/architecture in ${manifest}: ${file.url}`);
      const data = readFileSync(path.join(dir, file.url));
      assert.equal(createHash('sha512').update(data).digest('base64'), file.sha512, `Checksum mismatch: ${file.url}`);
      assert.equal(data.length, file.size, `Size mismatch: ${file.url}`);
      extensions.delete(file.url.split('.').at(-1));
      if (file.url.endsWith('.exe')) assert(existsSync(path.join(dir, `${file.url}.blockmap`)), `Missing blockmap for ${file.url}`);
    }
    assert.equal(extensions.size, 0, `Missing update targets in ${manifest}: ${[...extensions]}`);
    if (info.path) {
      const file = info.files.find(file => file.url === info.path);
      assert(file && file.sha512 === info.sha512, `Legacy update path/checksum mismatch in ${manifest}`);
    }
  }
  mkdirSync(output);
  for (const [name, source] of assets) copyFileSync(source, path.join(output, name));
  return [...assets.keys()];
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  assert.equal(process.env.GITHUB_REF_NAME, `v${version}`, 'Release tag must match package.json version');
  const assets = prepareRelease('artifacts', 'release-assets', version);
  console.log(`Validated ${assets.length} release assets and all four update feeds for v${version}.`);
}
