// Static site build: renders every page for every language into dist/.
// Product and category pages are generated from data/products.seed.json so each has a real URL.
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { site, enabledCountries } from '../config/site.mjs';
import { layout } from '../src/lib/layout.mjs';
import { allPages } from '../src/pages.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const readJson = async (p) => JSON.parse(await readFile(join(root, p), 'utf8'));
const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const escText = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function loadCatalogue(lang) {
  const seed = await readJson('data/products.seed.json');
  return seed.products.filter((p) => p.active).sort((a, b) => a.sort - b.sort).map((p) => ({
    ...p,
    tr: p.translations[lang] || p.translations[site.defaultLang],
    fromPrice: Math.min(...p.price_breaks.filter((b) => b.currency === 'EUR' && !b.variant_id).map((b) => b.unit_amount))
  }));
}

async function build() {
  const started = Date.now();
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  const fallback = await readJson(`locales/${site.defaultLang}.json`);
  const sitemap = [];
  const warnings = [];
  let count = 0;

  for (const language of site.languages) {
    const dict = language.code === site.defaultLang ? fallback : await readJson(`locales/${language.code}.json`);
    const missing = new Set();
    const lookup = (key) => {
      let v = get(dict, key);
      if (v === undefined) { missing.add(key); v = get(fallback, key); }
      if (v === undefined) { warnings.push(`[${language.code}] key not found in any locale: ${key}`); v = key; }
      return v;
    };
    const t = (key, vars) => {
      const v = lookup(key);
      const s = typeof v === 'string' ? v : String(v);
      return escText(vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s);
    };
    t.raw = lookup;
    const regionNames = new Intl.DisplayNames([language.locale], { type: 'region' });
    const money = new Intl.NumberFormat(language.locale, { style: 'currency', currency: 'EUR' });
    const ctx = {
      lang: language.code, language, t,
      site: { ...site, shipCountries: enabledCountries() },
      url: (path) => `${language.prefix}${path}`,
      money: (cents) => money.format(cents / 100),
      countryName: (code) => regionNames.of(code),
      products: await loadCatalogue(language.code)
    };
    for (const page of allPages(ctx)) {
      const file = page.file ? join(dist, language.prefix, page.file) : join(dist, language.prefix, page.path, 'index.html');
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, layout(ctx, page));
      count += 1;
      if (page.index) sitemap.push(`${site.url}${language.prefix}${page.path}`);
    }
    if (missing.size) warnings.push(`[${language.code}] ${missing.size} strings fall back to ${site.defaultLang}: ${[...missing].join(', ')}`);
  }

  await cp(join(root, 'src', 'static'), join(dist, 'assets'), { recursive: true });
  await cp(join(root, 'social-share.png'), join(dist, 'assets', 'img', 'social-share.png'));
  await writeFile(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  await writeFile(join(dist, 'robots.txt'), `User-agent: *\nDisallow: /api/\nDisallow: /admin/\nDisallow: /cart/\nDisallow: /checkout/\nDisallow: /account/\nSitemap: ${site.url}/sitemap.xml\n`);

  for (const w of warnings) console.warn(`warning: ${w}`);
  console.log(`built ${count} pages, ${sitemap.length} in sitemap, in ${Date.now() - started} ms`);
  if (warnings.some((w) => w.includes('not found in any locale'))) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
