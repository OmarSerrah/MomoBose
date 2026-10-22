import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error Release preparation is run directly by Node in CI.
import { prepareSparkleFeed, validateSparkleFeed } from '../scripts/prepare-sparkle-feed.mjs';

const VERSION = '0.1.14';
const temp: string[] = [];
const keyPair = generateKeyPairSync('ed25519');
const publicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const archiveContents = {
  x64: Buffer.from('disposable x64 test archive'),
  arm64: Buffer.from('disposable arm64 test archive'),
};
const signatureFor = (arch: 'x64' | 'arm64', pair = keyPair) => sign(null, archiveContents[arch], pair.privateKey).toString('base64');
const archiveName = (arch: 'x64' | 'arm64') => `MomoBose-${VERSION}-mac-${arch}.zip`;
const url = (arch: 'x64' | 'arm64') => `https://github.com/OmarSerrah/MomoBose/releases/download/v${VERSION}/${archiveName(arch)}`;
const enclosure = (arch: 'x64' | 'arm64', attrs = '') => `<enclosure url="${url(arch)}" length="${archiveContents[arch].length}" sparkle:edSignature="${signatureFor(arch)}" ${attrs}/>`;
const item = (arch: 'x64' | 'arm64', attrs = '') => `<item><sparkle:version>${VERSION}</sparkle:version>${arch === 'arm64' ? '<sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>' : ''}${enclosure(arch, attrs)}</item>`;
const unsignedFeed = (items = [item('arm64'), item('x64')]) => `<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel>${items.join('')}</channel></rss>`;
const signFeed = (xml: string, pair = keyPair) => {
  const content = Buffer.from(xml, 'utf8');
  const signature = sign(null, content, pair.privateKey).toString('base64');
  return `${xml}<!-- sparkle-signatures:\nedSignature: ${signature}\nlength: ${content.length}\n-->\n`;
};
const makeFeed = (items = [item('arm64'), item('x64')]) => signFeed(unsignedFeed(items));

function createArchiveDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'momobose-sparkle-feed-'));
  temp.push(dir);
  for (const arch of ['x64', 'arm64'] as const) writeFileSync(path.join(dir, archiveName(arch)), archiveContents[arch]);
  return dir;
}

function paths(dir: string) {
  return { x64: path.join(dir, archiveName('x64')), arm64: path.join(dir, archiveName('arm64')) };
}

afterEach(() => { for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('accepts the two exact release assets only when their real Ed25519 signatures and lengths verify', () => {
  const dir = createArchiveDir();
  expect(validateSparkleFeed(makeFeed(), VERSION, { archives: paths(dir), publicKey })).toBe(true);
  expect(() => validateSparkleFeed(makeFeed(), VERSION, { archives: paths(dir), publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' })).toThrow(/Invalid Ed25519 signed-feed signature/);

  const mutated = Buffer.from(archiveContents.arm64);
  mutated[0] ^= 1;
  writeFileSync(paths(dir).arm64, mutated);
  expect(() => validateSparkleFeed(makeFeed(), VERSION, { archives: paths(dir), publicKey })).toThrow(/Invalid Ed25519 archive signature for arm64/);

  writeFileSync(paths(dir).arm64, 'tampered archive');
  expect(() => validateSparkleFeed(makeFeed(), VERSION, { archives: paths(dir), publicKey })).toThrow(/Archive length does not match arm64 ZIP/);
});

it('rejects wrong release tags, versions, architectures, duplicate items, malformed XML and decoy attributes', () => {
  const dir = createArchiveDir();
  const options = { archives: paths(dir), publicKey };
  const feed = unsignedFeed();
  expect(() => validateSparkleFeed(signFeed(feed.replace(`/v${VERSION}/`, '/v0.1.13/')), VERSION, options)).toThrow(/expected immutable GitHub release tag/);
  expect(() => validateSparkleFeed(signFeed(feed.replace(`<sparkle:version>${VERSION}</sparkle:version>`, '<sparkle:version>0.1.13</sparkle:version>')), VERSION, options)).toThrow(/release version/);
  expect(() => validateSparkleFeed(makeFeed([item('x64'), item('x64')]), VERSION, options)).toThrow(/Duplicate x64/);
  const armOnlyIntelNamed = unsignedFeed().replace(item('x64'), item('x64').replace('</sparkle:version>', '</sparkle:version><sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>'));
  expect(() => validateSparkleFeed(signFeed(armOnlyIntelNamed), VERSION, options)).toThrow(/Expected x86_64 hardware metadata for x64/);
  expect(() => validateSparkleFeed(signFeed('<rss><channel><item></channel></rss>'), VERSION, options)).toThrow(/Malformed Sparkle appcast XML/);
  const decoy = `<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><item note='url="${url('x64')}" sparkle:edSignature="${signatureFor('x64')}"'><sparkle:version>${VERSION}</sparkle:version><enclosure/></item>${item('arm64')}</channel></rss>`;
  expect(() => validateSparkleFeed(signFeed(decoy), VERSION, options)).toThrow(/enclosure URL is required/);
  expect(() => validateSparkleFeed(signFeed(`<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>${unsignedFeed()}`), VERSION, options)).toThrow(/DTD or entities/);
});

it('requires a valid signed-feed block, exact signed bytes and matching public key before parsing XML', () => {
  const dir = createArchiveDir();
  const options = { archives: paths(dir), publicKey };
  const feed = makeFeed();
  expect(() => validateSparkleFeed(unsignedFeed(), VERSION, options)).toThrow(/missing its signed-feed signature/);
  expect(() => validateSparkleFeed(feed.replace('0.1.14', '9.9.99'), VERSION, options)).toThrow(/Invalid Ed25519 signed-feed signature/);
  expect(() => validateSparkleFeed(feed.replace(/length: \d+/, 'length: 1'), VERSION, options)).toThrow(/length does not match/);
  expect(() => validateSparkleFeed(feed, VERSION, { ...options, publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' })).toThrow(/Invalid Ed25519 signed-feed signature/);
  expect(() => validateSparkleFeed(feed.replace('edSignature:', 'decoy-edSignature:'), VERSION, options)).toThrow(/signature block is malformed/);
  expect(() => validateSparkleFeed(feed.replace('edSignature:', '\u00e5dSignature:'), VERSION, options)).toThrow(/must be ASCII/);
});

it('rejects namespace substitutions and duplicate enclosure attributes in a signed feed', () => {
  const dir = createArchiveDir();
  const options = { archives: paths(dir), publicKey };
  expect(() => validateSparkleFeed(signFeed(unsignedFeed().replace('<rss ', '<rss xmlns="https://example.com/foreign" ')), VERSION, options)).toThrow(/must not have a namespace/);
  expect(() => validateSparkleFeed(signFeed(unsignedFeed().replace('<enclosure ', '<enclosure xmlns="https://example.com/foreign" ')), VERSION, options)).toThrow(/exactly one enclosure/);
  expect(() => validateSparkleFeed(makeFeed([item('x64', 'url="https://example.com/decoy.zip"'), item('arm64')]), VERSION, options)).toThrow(/Malformed Sparkle appcast XML/);
});

it('rejects valid signatures made by a different Ed25519 key', () => {
  const dir = createArchiveDir();
  const other = generateKeyPairSync('ed25519');
  const feed = makeFeed([item('x64').replace(signatureFor('x64'), signatureFor('x64', other)), item('arm64')]);
  expect(() => validateSparkleFeed(feed, VERSION, { archives: paths(dir), publicKey })).toThrow(/Invalid Ed25519 archive signature for x64/);
});

it('passes the signing key over stdin and publishes only the validated appcast and two ZIPs', () => {
  const dir = createArchiveDir();
  const signingKey = 'disposable signing input';
  let seenKey = '';
  const files = prepareSparkleFeed({
    assets: dir, version: VERSION, signingKey, publicKey,
    runner: (_command: string, args: string[], options: { input: string; env: Record<string, string> }) => {
      seenKey = options.input;
      expect(Object.keys(options.env)).toEqual(['PATH']);
      expect(args.slice(0, 3)).toEqual(['sign-update', '--ed-key-file', '-']);
      const file = args.at(-1)!;
      if (file.endsWith('.xml')) {
        writeFileSync(file, signFeed(readFileSync(file, 'utf8')));
        return { status: 0, stdout: '' };
      }
      const bytes = readFileSync(file);
      return { status: 0, stdout: `sparkle:edSignature="${sign(null, bytes, keyPair.privateKey).toString('base64')}" length="${bytes.length}"\n` };
    },
  });
  expect(seenKey).toBe(signingKey);
  expect(files.sort()).toEqual([archiveName('arm64'), archiveName('x64'), 'appcast.xml'].sort());
  expect(validateSparkleFeed(readFileSync(path.join(dir, 'appcast.xml'), 'utf8'), VERSION, { archives: paths(dir), publicKey })).toBe(true);
  expect(() => prepareSparkleFeed({ assets: dir, version: VERSION, signingKey: '' })).toThrow(/SPARKLE_EDDSA_PRIVATE_KEY/);
});

it('rejects Intel-first equal-version ordering so Apple silicon receives its native archive', () => {
  const dir = createArchiveDir();
  expect(() => validateSparkleFeed(makeFeed([item('x64'), item('arm64')]), VERSION, { archives: paths(dir), publicKey })).toThrow(/exactly one hardwareRequirements/);
});

it.skipIf(process.platform !== 'darwin')('prepares the complete signed appcast with the official signer and a disposable stdin key', () => {
  const dir = createArchiveDir();
  const seed = keyPair.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64');
  expect(prepareSparkleFeed({ assets: dir, version: VERSION, signingKey: seed, publicKey }).sort()).toEqual(['appcast.xml', archiveName('arm64'), archiveName('x64')].sort());
  expect(validateSparkleFeed(readFileSync(path.join(dir, 'appcast.xml'), 'utf8'), VERSION, { archives: paths(dir), publicKey })).toBe(true);
});

it.skipIf(process.platform !== 'darwin')('accepts the signed-feed bytes produced by Sparkle sign-update using a disposable Node Ed25519 seed', () => {
  const dir = createArchiveDir();
  const { privateKey: nodePrivateKey, publicKey: nodePublicKey } = generateKeyPairSync('ed25519');
  const seed = nodePrivateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const sparklePublicKey = nodePublicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  const feedPath = path.join(dir, 'fixture.xml');
  const archiveSignedFeed = unsignedFeed().replaceAll(signatureFor('x64'), sign(null, archiveContents.x64, nodePrivateKey).toString('base64'))
    .replaceAll(signatureFor('arm64'), sign(null, archiveContents.arm64, nodePrivateKey).toString('base64'));
  writeFileSync(feedPath, archiveSignedFeed);
  const result = spawnSync(path.resolve('node_modules/.bin/electron-sparkle'), ['sign-update', '--ed-key-file', '-', feedPath], {
    encoding: 'utf8', input: `${seed.toString('base64')}\n`, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH ?? '' },
  });
  expect(result.status).toBe(0);
  expect(validateSparkleFeed(readFileSync(feedPath, 'utf8'), VERSION, { archives: paths(dir), publicKey: sparklePublicKey })).toBe(true);
});
