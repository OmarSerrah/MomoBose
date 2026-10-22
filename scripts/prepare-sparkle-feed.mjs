import assert from 'node:assert/strict';
import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DOMParser } from '@xmldom/xmldom';
import { pathToFileURL } from 'node:url';

const SPARKLE_NS = 'http://www.andymatuschak.org/xml-namespaces/sparkle';
const ARCHES = Object.freeze({ x64: 'x86_64', arm64: 'arm64' });
const GITHUB_PREFIX = 'https://github.com/OmarSerrah/MomoBose/releases/download/';
const RAW_ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function getElements(node, localName, namespaceURI = null) {
  return Array.from(node.childNodes ?? []).filter(child => child.nodeType === 1
    && child.localName === localName
    && (namespaceURI === null ? !child.namespaceURI : child.namespaceURI === namespaceURI));
}

function singleElement(node, localName, namespaceURI = null) {
  const matches = getElements(node, localName, namespaceURI);
  assert.equal(matches.length, 1, `Expected exactly one ${localName} element`);
  return matches[0];
}

function getAttribute(element, name, namespaceURI = null) {
  if (namespaceURI === null) return element.hasAttribute(name) ? element.getAttribute(name) : null;
  return element.hasAttributeNS(namespaceURI, name) ? element.getAttributeNS(namespaceURI, name) : null;
}

function resolvePublicKey(publicKey) {
  assert.equal(typeof publicKey, 'string', 'Sparkle public key is required to verify update signatures');
  let rawKey;
  try { rawKey = Buffer.from(publicKey, 'base64'); } catch { rawKey = Buffer.alloc(0); }
  assert.equal(rawKey.length, 32, 'SUPublicEDKey must be a base64 encoded 32-byte Ed25519 public key');
  assert.equal(rawKey.toString('base64'), publicKey, 'SUPublicEDKey must use canonical base64 encoding');
  return createPublicKey({ key: Buffer.concat([RAW_ED25519_SPKI_PREFIX, rawKey]), format: 'der', type: 'spki' });
}

/**
 * Verify Sparkle's terminal signed-feed block before parsing any XML. Sparkle
 * signs the exact UTF-8 bytes preceding this comment, including its optional
 * signing-warning comment. Its 2.9.6 sign_update format ends with:
 *   <!-- sparkle-signatures:\n...
 */
function verifySignedFeed(xml, key) {
  assert.equal(typeof xml, 'string', 'Sparkle appcast must be XML text');
  const data = Buffer.from(xml, 'utf8');
  assert.equal(data.toString('utf8'), xml, 'Sparkle appcast must be valid UTF-8 text');
  const marker = Buffer.from('<!-- sparkle-signatures:\n', 'ascii');
  const start = data.lastIndexOf(marker);
  assert(start >= 0, 'Sparkle appcast is missing its signed-feed signature');
  assert.equal(data.indexOf(marker), start, 'Sparkle appcast contains multiple signed-feed signature blocks');
  const trailerBytes = data.subarray(start);
  assert(trailerBytes.every(byte => byte < 128), 'Sparkle signed-feed signature block must be ASCII');
  const trailer = trailerBytes.toString('ascii');
  const match = /^<!-- sparkle-signatures:\nedSignature: ([A-Za-z0-9+/]+={0,2})\nlength: (0|[1-9]\d*)\n-->\n?$/.exec(trailer);
  assert(match, 'Sparkle signed-feed signature block is malformed');
  const [, encodedSignature, encodedLength] = match;
  const signature = Buffer.from(encodedSignature, 'base64');
  assert.equal(signature.length, 64, 'Sparkle signed-feed signature has an invalid byte count');
  assert.equal(signature.toString('base64'), encodedSignature, 'Sparkle signed-feed signature is not canonical base64');
  const content = data.subarray(0, start);
  const signedLength = Number(encodedLength);
  assert(Number.isSafeInteger(signedLength), 'Sparkle signed-feed length is invalid');
  assert.equal(signedLength, content.length, 'Sparkle signed-feed length does not match its content');
  assert(verifySignature(null, content, key, signature), 'Invalid Ed25519 signed-feed signature');
}

function parseFeed(xml) {
  assert.equal(typeof xml, 'string', 'Sparkle appcast must be XML text');
  assert(!/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml), 'Sparkle appcast must not declare a DTD or entities');
  const errors = [];
  let document;
  try {
    document = new DOMParser({ onError: (_level, message) => errors.push(message) }).parseFromString(xml, 'application/xml');
  } catch (error) {
    assert.fail(`Malformed Sparkle appcast XML: ${error instanceof Error ? error.message : String(error)}`);
  }
  assert.equal(errors.length, 0, `Malformed Sparkle appcast XML: ${errors.join('; ')}`);
  assert(document.documentElement, 'Sparkle appcast must have a document element');
  assert.equal(document.documentElement.localName, 'rss', 'Sparkle appcast must be an RSS feed');
  assert(!document.documentElement.namespaceURI, 'Sparkle RSS elements must not have a namespace');
  assert.equal(document.getElementsByTagName('parsererror').length, 0, 'Malformed Sparkle appcast XML');
  return document.documentElement;
}

/**
 * Validates a Sparkle signed appcast and its ZIPs. The appcast signature and
 * each archive signature must verify against `publicKey`, the base64
 * SUPublicEDKey from app config. `archives` maps x64 and arm64 to local ZIPs.
 */
export function validateSparkleFeed(xml, version, { archives, publicKey } = {}) {
  assert.match(version, /^\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?$/, 'Release version is invalid');
  assert(archives && typeof archives === 'object', 'Archive paths are required to verify Sparkle signatures');
  const key = resolvePublicKey(publicKey);
  verifySignedFeed(xml, key);
  const rss = parseFeed(xml);
  const channels = getElements(rss, 'channel');
  assert.equal(channels.length, 1, 'Sparkle RSS feed must contain exactly one channel');
  const items = getElements(channels[0], 'item');
  assert.equal(items.length, 2, 'Expected exactly one Sparkle update for each Mac architecture');
  // Sparkle selects the first compatible item when versions are equal. Intel
  // excludes the ARM-only item; Apple silicon must see its native build first.
  const seen = new Set();
  const expectedPrefix = `${GITHUB_PREFIX}v${version}/`;

  for (const item of items) {
    const versionNode = singleElement(item, 'version', SPARKLE_NS);
    assert.equal(versionNode.textContent.trim(), version, 'Sparkle release version does not match the expected version');
    const enclosure = singleElement(item, 'enclosure');
    const url = getAttribute(enclosure, 'url');
    assert(url, 'Sparkle enclosure URL is required');
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch { assert.fail('Sparkle enclosure URL is invalid'); }
    assert.equal(parsedUrl.protocol, 'https:', 'Sparkle enclosure URL must use HTTPS');
    assert.equal(parsedUrl.origin, 'https://github.com', 'Sparkle enclosure must use the official GitHub host');
    assert.equal(parsedUrl.search, '', 'Sparkle enclosure URL must not contain a query string');
    assert.equal(parsedUrl.hash, '', 'Sparkle enclosure URL must not contain a fragment');
    assert(url.startsWith(expectedPrefix), 'Sparkle enclosure must point to the expected immutable GitHub release tag');
    const filename = decodeURIComponent(parsedUrl.pathname.slice(parsedUrl.pathname.lastIndexOf('/') + 1));
    const match = /^MomoBose-(.+)-mac-(x64|arm64)\.zip$/.exec(filename);
    assert(match, 'Sparkle enclosure must reference an expected Mac update archive');
    const [, assetVersion, arch] = match;
    assert.equal(assetVersion, version, 'Sparkle archive version does not match the expected version');
    assert(!seen.has(arch), `Duplicate ${arch} archive in Sparkle appcast`);
    seen.add(arch);
    assert.equal(filename, `MomoBose-${version}-mac-${arch}.zip`, `Unexpected ${arch} archive filename`);
    assert.equal(parsedUrl.pathname, `/OmarSerrah/MomoBose/releases/download/v${version}/${filename}`, 'Sparkle enclosure URL path is not canonical');

    // Sparkle 2.9+ generate_appcast writes hardwareRequirements=arm64 for an
    // ARM-only app. Intel-compatible apps have no hardwareRequirements node.
    const hardwareRequirements = getElements(item, 'hardwareRequirements', SPARKLE_NS);
    assert(hardwareRequirements.length <= 1, `Duplicate hardware requirements metadata for ${arch}`);
    const hardware = hardwareRequirements[0]?.textContent.trim() ?? null;
    assert(hardware === null || hardware === 'arm64', `Unsupported hardware requirements metadata: ${hardware}`);
    const metadataArch = hardware === 'arm64' ? 'arm64' : 'x64';
    assert.equal(metadataArch, arch, `Expected ${ARCHES[arch]} hardware metadata for ${arch}`);
    assert.equal(getAttribute(enclosure, 'arch', SPARKLE_NS), null, 'Unexpected Sparkle architecture attribute; use hardwareRequirements metadata');
    const archivePath = archives[arch];
    assert(archivePath && existsSync(archivePath), `Missing ${arch} archive required to verify its signature`);
    const lengthText = getAttribute(enclosure, 'length');
    assert(lengthText && /^\d+$/.test(lengthText), `Invalid archive length for ${arch}`);
    const archiveBytes = readFileSync(archivePath);
    assert.equal(Number(lengthText), archiveBytes.length, `Archive length does not match ${arch} ZIP`);
    const signatureText = getAttribute(enclosure, 'edSignature', SPARKLE_NS);
    assert(signatureText && /^[A-Za-z0-9+/]+={0,2}$/.test(signatureText), `Missing or invalid Ed25519 signature for ${arch}`);
    const signature = Buffer.from(signatureText, 'base64');
    assert.equal(signature.length, 64, `Invalid Ed25519 signature length for ${arch}`);
    assert.equal(signature.toString('base64'), signatureText, `Noncanonical Ed25519 signature for ${arch}`);
    assert(verifySignature(null, archiveBytes, key, signature), `Invalid Ed25519 archive signature for ${arch}`);
  }
  assert.deepEqual([...seen].sort(), Object.keys(ARCHES).sort(), 'Expected one signed archive for each Mac architecture');
  assert.equal(singleElement(items[0], 'hardwareRequirements', SPARKLE_NS).textContent.trim(), 'arm64', 'Put the ARM-only update before the Intel update');
  return true;
}

function readConfiguredPublicKey() {
  const config = JSON.parse(readFileSync('package.json', 'utf8'));
  return config.build?.mac?.extendInfo?.SUPublicEDKey;
}

export function prepareSparkleFeed({ assets = 'release-assets', version, signingKey, publicKey = readConfiguredPublicKey(), runner = spawnSync } = {}) {
  assert.match(version ?? '', /^\d+\.\d+\.\d+$/, 'Release version must be a stable semantic version');
  assert(signingKey, 'Set the SPARKLE_EDDSA_PRIVATE_KEY GitHub Actions secret before publishing a Sparkle release');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'momobose-sparkle-'));
  try {
    const archivePaths = {};
    for (const arch of Object.keys(ARCHES)) {
      const name = `MomoBose-${version}-mac-${arch}.zip`;
      const source = path.join(assets, name);
      assert(existsSync(source), `Missing Sparkle update archive ${name}`);
      const staged = path.join(dir, name);
      copyFileSync(source, staged);
      archivePaths[arch] = staged;
    }
    const cli = path.resolve('node_modules/.bin/electron-sparkle');
    const sign = file => {
      const result = runner(cli, ['sign-update', '--ed-key-file', '-', file], {
        encoding: 'utf8', input: signingKey, maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH ?? '' },
      });
      assert.equal(result.status, 0, 'Sparkle signing failed');
      return result.stdout?.trim() ?? '';
    };
    // generate_appcast rejects separate architecture archives with the same
    // CFBundleVersion. Use Sparkle's documented manual appcast/sign_update flow.
    // ARM first is required for Sparkle's first-compatible equal-version choice.
    const items = ['arm64', 'x64'].map(arch => {
      const attributes = sign(archivePaths[arch]);
      assert(/^sparkle:edSignature="[A-Za-z0-9+/]{86}==" length="\d+"$/.test(attributes), 'Unexpected Sparkle archive signing output');
      return `    <item><title>MomoBose ${version}</title><sparkle:version>${version}</sparkle:version><sparkle:shortVersionString>${version}</sparkle:shortVersionString><sparkle:minimumSystemVersion>12.0.0</sparkle:minimumSystemVersion>${arch === 'arm64' ? '<sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>' : ''}<enclosure url="${GITHUB_PREFIX}v${version}/${path.basename(archivePaths[arch])}" ${attributes} type="application/octet-stream"/></item>`;
    });
    const feedPath = path.join(dir, 'appcast.xml');
    writeFileSync(feedPath, `<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:sparkle="${SPARKLE_NS}"><channel><title>MomoBose updates</title>\n${items.join('\n')}\n</channel></rss>\n`);
    sign(feedPath);
    const xml = readFileSync(path.join(dir, 'appcast.xml'), 'utf8');
    validateSparkleFeed(xml, version, { archives: archivePaths, publicKey });
    const expectedFiles = ['appcast.xml', ...Object.values(archivePaths).map(file => path.basename(file))].sort();
    assert.deepEqual(readdirSync(dir).sort(), expectedFiles, 'Sparkle generated unexpected release assets');
    for (const name of expectedFiles) copyFileSync(path.join(dir, name), path.join(assets, name));
    return expectedFiles;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  assert.equal(process.env.GITHUB_REF_NAME, `v${version}`, 'Release tag must match package.json version');
  const assets = process.env.MOMOBOSE_RELEASE_ASSETS || 'release-assets';
  const generated = prepareSparkleFeed({ assets, version, signingKey: process.env.SPARKLE_EDDSA_PRIVATE_KEY });
  console.log(`Generated a signed Sparkle appcast and ${generated.length - 1} update archive assets for v${version}.`);
}
