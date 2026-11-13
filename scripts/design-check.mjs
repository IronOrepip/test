// Design check (brief section 13.4, DESIGN.md section 9 "Reject" list). Fails the run on any finding.
//  - colour, font-size and spacing values outside tokens.css
//  - box-shadow (other than the focus ring token), gradients, radii above 4px (except 14px glass)
//  - text that spells the logo in the pages' visible headings
//  - inline styles or inline scripts in the built pages
//  - more than one orange button per view
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const findings = [];
const add = (file, msg) => findings.push(`${relative(root, file)}: ${msg}`);
async function walk(dir, ext) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, ext)); else if (ext.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

// ---- CSS and JS sources ----
const cssFile = join(root, 'src', 'static', 'css', 'site.css');
const css = (await readFile(cssFile, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
css.split('\n').forEach((line, i) => {
  const at = `line ${i + 1}`;
  if (/^\s*@font-face/.test(line)) return; // font files and unicode ranges only
  const body = /^\s*@media/.test(line) ? '' : line; // breakpoints cannot be variables
  if (/#[0-9a-fA-F]{3,8}\b/.test(body)) add(cssFile, `${at}: hex colour outside tokens.css`);
  if (/\b(rgb|hsl)a?\(/.test(body)) add(cssFile, `${at}: colour function outside tokens.css`);
  if (/(^|[\s:(,-])\d*\.?\d+(px|rem|em|pt)\b/.test(body)) add(cssFile, `${at}: size value outside tokens.css -> ${body.trim().slice(0, 70)}`);
  if (/box-shadow\s*:(?!\s*var\(--ring\))/.test(body)) add(cssFile, `${at}: box-shadow that is not the focus ring`);
  if (/gradient\(/.test(body)) add(cssFile, `${at}: gradient`);
  if (/border-radius\s*:(?!\s*var\(--(radius|radius-glass|s0|s1)\))/.test(body)) add(cssFile, `${at}: radius not from tokens`);
});
const tokens = await readFile(join(root, 'src', 'static', 'css', 'tokens.css'), 'utf8');
const radius = /--radius:\s*(\d+)px/.exec(tokens)[1], glass = /--radius-glass:\s*(\d+)px/.exec(tokens)[1];
if (radius !== '4' || glass !== '14') add(cssFile, `radius tokens must be 4px and 14px (found ${radius}, ${glass})`);
if (/gradient\(|box-shadow/.test(tokens.replace(/\/\*[\s\S]*?\*\//g, ''))) add(cssFile, 'tokens.css defines a gradient or box-shadow');

for (const file of await walk(join(root, 'src'), ['.js', '.mjs'])) {
  const src = await readFile(file, 'utf8');
  if (/#[0-9a-fA-F]{6}\b/.test(src)) add(file, 'hex colour in script or template');
  if (/style="/.test(src)) add(file, 'inline style attribute');
}

// ---- Built pages ----
const dist = join(root, 'dist');
const pages = (await walk(dist, ['.html']));
for (const file of pages) {
  const html = await readFile(file, 'utf8');
  const main = /<main[\s\S]*<\/main>/.exec(html)?.[0] || '';
  if (/\sstyle="/.test(html)) add(file, 'inline style attribute');
  if (/<script(?![^>]*(src=|type="application\/(ld\+)?json"))[^>]*>/.test(html)) add(file, 'inline script');
  if (/fonts\.googleapis|fonts\.gstatic/.test(html)) add(file, 'calls Google Fonts');
  // The logo is never typed: no heading may consist of the word alone.
  if (/<h[1-6][^>]*>\s*NOVA\s*<\/h[1-6]>/i.test(html)) add(file, 'a heading spells the logo in a font');
  if (!/viewBox="0 -4 714 208"/.test(html)) add(file, 'exact logo SVG missing');
  // One orange button per view: the page itself (header + main), then each overlay on its own.
  const headerOrange = (/<header[\s\S]*?<\/header>/.exec(html)?.[0].match(/btn--primary/g) || []).length;
  const mainOrange = (main.match(/btn--primary/g) || []).length;
  if (headerOrange + mainOrange > 1) add(file, `${headerOrange + mainOrange} orange buttons in the page view`);
  for (const dialog of html.match(/<dialog[\s\S]*?<\/dialog>/g) || []) {
    if ((dialog.match(/btn--primary/g) || []).length > 1) add(file, 'more than one orange button in a dialog');
  }
  if ((/<div class="cookie"[\s\S]*?<\/div>\s*<\/div>/.exec(html)?.[0].match(/btn--primary/g) || []).length) add(file, 'orange button in the cookie banner');
  if (!/<html lang="[a-z]{2}">/.test(html)) add(file, 'missing lang attribute');
  for (const img of html.match(/<img\b[^>]*>/g) || []) if (!/\salt="/.test(img)) add(file, 'image without alt');
}

if (findings.length) {
  console.error(`design check: ${findings.length} finding(s)`);
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`design check passed: ${pages.length} pages, site.css and scripts clean`);
