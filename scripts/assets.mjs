// One-off asset preparation. Run with `npm run assets` after changing the logo or fonts.
//  - copies the self-hosted WOFF2 fonts out of node_modules into src/static/fonts
//  - exports logo PNGs for emails and invoices (Outlook does not show SVG) and the favicons
//  - extracts the animated hero "N" mark from the legacy index.html
//  - optional: `npm run assets -- --samples <folder>` converts sample photos to WebP
import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = (...p) => join(root, 'src', 'static', ...p);
const INK = '#101418';
const PAPER = '#f4f5f6';

async function fonts() {
  const wanted = [
    ['barlow', ['latin', 'latin-ext'], [400, 500, 600]],
    ['barlow-condensed', ['latin', 'latin-ext'], [600]],
    // Barlow and Barlow Condensed ship no Cyrillic subset. IBM Plex Mono does.
    ['ibm-plex-mono', ['latin', 'latin-ext', 'cyrillic'], [400, 500]]
  ];
  await mkdir(out('fonts'), { recursive: true });
  let n = 0;
  for (const [family, subsets, weights] of wanted) {
    for (const subset of subsets) for (const weight of weights) {
      const file = `${family}-${subset}-${weight}-normal.woff2`;
      await copyFile(join(root, 'node_modules', '@fontsource', family, 'files', file), out('fonts', file));
      n += 1;
    }
  }
  console.log(`fonts: ${n} WOFF2 files`);
}

async function brand() {
  const svg = await readFile(join(root, 'brand', 'nova-logo.svg'), 'utf8');
  await mkdir(out('brand'), { recursive: true });
  const coloured = (colour) => Buffer.from(svg.replaceAll('currentColor', colour));
  // 2x PNGs, 6% clear space on every side, Ink on white for emails and invoices.
  const width = 480;
  const height = Math.round((width * 208) / 714);
  const padX = Math.round(width * 0.06);
  const padY = Math.round(height * 0.06);
  const render = async (colour, background, name) => {
    const mark = await sharp(coloured(colour), { density: 300 }).resize(width, height).png().toBuffer();
    await sharp(mark).extend({ top: padY, bottom: padY, left: padX, right: padX, background }).png().toFile(out('brand', name));
  };
  await render(INK, '#ffffff', 'nova-logo-ink@2x.png');
  await render(PAPER, INK, 'nova-logo-paper@2x.png');

  // Favicons: the first letterform of the exact logo path (unaltered path data), Paper on Ink.
  const path = /d="([^"]+)"/.exec(svg)[1];
  const first = path.split(' M')[0];
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-65 -50 300 300"><rect x="-65" y="-50" width="300" height="300" fill="${INK}"/><path fill="${PAPER}" d="${first}"/></svg>`;
  for (const [size, name] of [[512, 'favicon-512.png'], [180, 'apple-touch-icon.png'], [32, 'favicon-32.png']]) {
    await sharp(Buffer.from(icon), { density: 300 }).resize(size, size).png().toFile(out('brand', name));
  }
  await writeFile(out('brand', 'favicon.svg'), icon);
  await copyFile(join(root, 'brand', 'nova-logo.svg'), out('brand', 'nova-logo.svg'));
  console.log('brand: logo PNGs and favicons');
}

async function heroMark() {
  const legacy = join(root, 'index.html');
  if (!existsSync(legacy)) return;
  const m = /class="n" src="data:image\/png;base64,([^"]+)"/.exec(await readFile(legacy, 'utf8'));
  if (!m) return;
  await mkdir(out('img'), { recursive: true });
  await writeFile(out('img', 'n.png'), Buffer.from(m[1], 'base64'));
  console.log('hero: n.png extracted');
}

async function samples(dir) {
  await mkdir(out('img', 'samples'), { recursive: true });
  for (const file of await readdir(dir)) {
    if (!/\.(jpe?g|png)$/i.test(file)) continue;
    const target = out('img', 'samples', `${parse(file).name}.webp`);
    await sharp(join(dir, file)).resize(1200, 900, { fit: 'cover', position: 'attention' }).webp({ quality: 80 }).toFile(target);
    console.log(`sample: ${parse(file).name}.webp`);
  }
}

await fonts();
await brand();
await heroMark();
const i = process.argv.indexOf('--samples');
if (i > -1) await samples(resolve(process.argv[i + 1]));
