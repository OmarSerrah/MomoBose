import sharp from 'sharp';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The transparent RGBA masters preserve the supplied artwork inside each tile.
// Tray images are independent monochrome assets and must remain untouched.
const assets = fileURLToPath(new URL('../assets/', import.meta.url));
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const iconsetSizes = [16, 32, 128, 256, 512];
const pngOptions = { compressionLevel: 9, adaptiveFiltering: true, palette: false };

if (process.platform !== 'darwin') {
  throw new Error('Regenerating all app icons requires macOS and its native iconutil command.');
}

function createIco(images) {
  let offset = 6 + 16 * images.length;
  const header = Buffer.alloc(offset);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  images.forEach((png, index) => {
    const entry = 6 + index * 16;
    const size = icoSizes[index];
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images]);
}

function preserveSmallIcnsPngs(icns, pngs) {
  // iconutil's legacy ARGB conversion can corrupt the last blue-channel run.
  // Modern PNG entries preserve every resized pixel, including at 16/32px.
  const chunks = [];
  for (let offset = 8; offset < icns.length;) {
    const type = icns.toString('ascii', offset, offset + 4);
    const length = icns.readUInt32BE(offset + 4);
    const size = type === 'ic04' ? 16 : type === 'ic05' ? 32 : undefined;
    if (size) {
      const png = pngs.get(size);
      const header = Buffer.alloc(8);
      header.write(size === 16 ? 'icp4' : 'icp5');
      header.writeUInt32BE(8 + png.length, 4);
      chunks.push(header, png);
    } else {
      chunks.push(icns.subarray(offset, offset + length));
    }
    offset += length;
  }
  const header = Buffer.alloc(8);
  header.write('icns');
  header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

// Validate both inputs before producing any output. Never rewrite the masters.
const masters = new Map();
for (const theme of ['light', 'dark']) {
  const master = await readFile(join(assets, `app-icon-${theme}.png`));
  const metadata = await sharp(master).metadata();
  if (metadata.width !== 1254 || metadata.height !== 1254 || metadata.channels !== 4
      || metadata.depth !== 'uchar' || metadata.isPalette || !metadata.hasAlpha
      || metadata.space !== 'srgb') {
    throw new Error(`app-icon-${theme}.png must be a transparent 1254×1254, 8-bit RGBA master.`);
  }
  const { data, info } = await sharp(master).raw().toBuffer({ resolveWithObject: true });
  for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) {
    if (data[(y * info.width + x) * 4 + 3] !== 0) throw new Error(`${theme} icon has an opaque outer corner.`);
  }
  masters.set(theme, master);
}

const temporary = await mkdtemp(join(tmpdir(), 'momobose-icons-'));
try {
  for (const [theme, master] of masters) {
    const suffix = theme === 'light' ? '' : '-dark';
    const iconset = join(temporary, `${theme}.iconset`);
    await mkdir(iconset);

    // Cache shared dimensions, always resampling directly from the master.
    const dimensions = [...new Set([
      ...icoSizes,
      ...iconsetSizes.flatMap(size => [size, size * 2]),
    ])];
    const pngs = new Map(await Promise.all(dimensions.map(async size => [
      size,
      await sharp(master)
        .resize(size, size, { kernel: sharp.kernel.lanczos3 })
        .ensureAlpha()
        .png(pngOptions)
        .toBuffer(),
    ])));

    for (const size of iconsetSizes) {
      for (const scale of [1, 2]) {
        const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
        await writeFile(join(iconset, name), pngs.get(size * scale));
      }
    }
    execFileSync('/usr/bin/iconutil', [
      '-c', 'icns', iconset, '-o', join(temporary, `icon${suffix}.icns`),
    ]);
    const icnsPath = join(temporary, `icon${suffix}.icns`);
    await writeFile(icnsPath, preserveSmallIcnsPngs(await readFile(icnsPath), pngs));
    await writeFile(join(temporary, `icon${suffix}.ico`), createIco(icoSizes.map(size => pngs.get(size))));
  }

  // Finish building both themes before replacing the bundled derivatives.
  for (const name of ['icon.icns', 'icon-dark.icns', 'icon.ico', 'icon-dark.ico']) {
    await writeFile(join(assets, name), await readFile(join(temporary, name)));
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log('Generated light and dark ICNS/ICO app icons; masters and tray assets preserved.');
