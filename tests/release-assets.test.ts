import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dump, load } from 'js-yaml';
// @ts-expect-error Release preparation is also run directly by Node in CI.
import { prepareRelease } from '../scripts/prepare-release.mjs';

const temp: string[] = [];
afterEach(() => { for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'momobose-release-')); temp.push(dir);
  const input = path.join(dir, 'artifacts'), output = path.join(dir, 'assets');
  for (const platform of ['mac', 'win']) for (const arch of ['x64', 'arm64']) {
    const folder = path.join(input, `MomoBose-${platform}-${arch}`); mkdirSync(folder, { recursive: true });
    const files = (platform === 'mac' ? ['zip', 'dmg'] : ['exe']).map(ext => {
      const url = `MomoBose-0.1.13-${platform}-${arch}.${ext}`, data = Buffer.from(url);
      writeFileSync(path.join(folder, url), data);
      writeFileSync(path.join(folder, `${url}.blockmap`), '{}');
      return { url, sha512: createHash('sha512').update(data).digest('base64'), size: data.length };
    });
    writeFileSync(path.join(folder, `latest-${arch}${platform === 'mac' ? '-mac' : ''}.yml`), dump({ version: '0.1.13', files, path: files[0].url, sha512: files[0].sha512 }));
  }
  return { input, output };
}
it('preserves all installer/metadata/blockmap filenames and each architecture feed', () => {
  const { input, output } = fixture();
  const names = prepareRelease(input, output, '0.1.13');
  expect(names).toHaveLength(16);
  expect(readdirSync(output).filter(name => name.endsWith('.yml')).sort()).toEqual(['latest-arm64-mac.yml', 'latest-arm64.yml', 'latest-x64-mac.yml', 'latest-x64.yml']);
});
it('rejects changed artifacts and incorrect release versions', () => {
  const { input, output } = fixture();
  expect(() => prepareRelease(input, output, '0.1.14')).toThrow(/version/);
  writeFileSync(path.join(input, 'MomoBose-win-arm64', 'MomoBose-0.1.13-win-arm64.exe'), 'changed');
  expect(() => prepareRelease(input, output, '0.1.13')).toThrow(/Checksum mismatch/);
});
it('rejects architecture mismatches instead of distributing another platform build', () => {
  const { input, output } = fixture();
  const manifest = path.join(input, 'MomoBose-win-arm64', 'latest-arm64.yml');
  const info: any = load(readFileSync(manifest, 'utf8')); info.files[0].url = 'MomoBose-0.1.13-win-x64.exe';
  writeFileSync(manifest, dump(info));
  expect(() => prepareRelease(input, output, '0.1.13')).toThrow(/Wrong platform\/architecture/);
});
it('rejects renamed/missing manifests and duplicate upload assets', () => {
  const { input, output } = fixture();
  rmSync(path.join(input, 'MomoBose-win-arm64', 'latest-arm64.yml'));
  expect(() => prepareRelease(input, output, '0.1.13')).toThrow(/Missing latest-arm64.yml/);
  const other = fixture();
  writeFileSync(path.join(other.input, 'MomoBose-mac-x64', 'duplicate.blockmap'), '{}');
  writeFileSync(path.join(other.input, 'MomoBose-mac-arm64', 'duplicate.blockmap'), '{}');
  expect(() => prepareRelease(other.input, other.output, '0.1.13')).toThrow(/Duplicate release asset/);
});
