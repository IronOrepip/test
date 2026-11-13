// Shared page shell: head, header, footer, cookie banner, quote dialog, cart drawer.
// All interface text comes from locales/<lang>.json through ctx.t().
import { readFileSync } from 'node:fs';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LOGO_PATH = /d="([^"]+)"/.exec(readFileSync(new URL('../../brand/nova-logo.svg', import.meta.url), 'utf8'))[1];

// The exact logo from brand/nova-logo.svg, coloured with CSS `color`. Never typed in a font.
export const logo = (cls = 'logo') =>
  `<svg class="${cls}" viewBox="0 -4 714 208" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="${LOGO_PATH}"/></svg>`;

const line = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${d}</svg>`;
export const icon = {
  cart: line('<path d="M3 4h2.5l2.2 11h10.6l2-8H6.6"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>'),
  user: line('<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.300 1.900 7.500 5.500"/>'),
  menu: line('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: line('<path d="M6 6l12 12M18 6 6 18"/>'),
  plus: line('<path d="M12 5v14M5 12h14"/>'),
  minus: line('<path d="M5 12h14"/>'),
  arrow: line('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  prev: line('<path d="M15 5l-7 7 7 7"/>'),
  next: line('<path d="M9 5l7 7-7 7"/>'),
  alert: line('<path d="M12 4 2.500 20h19z"/><path d="M12 10v5M12 17.500v.010"/>'),
  info: line('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.500v.010"/>'),
  check: line('<path d="M5 12.500l4.500 4.500L19 7.500"/>'),
  external: line('<path d="M14 5h5v5M19 5l-8 8M10 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-4"/>'),
  shop: line('<path d="M3 9l1.500-5h15L21 9M4 9v11h16V9M3 9h18M9 20v-6h6v6"/>'),
  bell: line('<path d="M4 18h16M6 18v-7a6 6 0 0 1 12 0v7M12 3v2"/>'),
  briefcase: line('<rect x="3" y="7" width="18" height="13" rx="1"/><path d="M9 7V4h6v3"/>')
};

export function fieldError(id) {
  return `<p class="field-error" id="${id}" role="alert" hidden>${icon.alert}<span></span></p>`;
}

export function breadcrumbs(ctx, items) {
  const { t, site } = ctx;
  const ld = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: site.url + it.href }))
  };
  const html = `<nav class="breadcrumbs wrap" aria-label="${t('nav.breadcrumbs')}"><ol class="label">${items
    .map((it, i) => `<li>${i === items.length - 1 ? `<span aria-current="page">${esc(it.name)}</span>` : `<a href="${it.href}">${esc(it.name)}</a>`}</li>`)
    .join('')}</ol></nav>`;
  return { html, ld };
}

function header(ctx, page) {
  const { t, url } = ctx;
  const current = (p) => (page.nav === p ? ' aria-current="page"' : '');
  const links = [
    ['home', url('/'), t('nav.home')],
    ['shop', url('/shop/'), t('nav.shop')],
    ['about', url('/about/'), t('nav.about')],
    ['contact', url('/contact/'), t('nav.contact')]
  ];
  const nav = links.map(([id, href, label]) => `<a href="${href}"${current(id)}>${label}</a>`).join('');
  const quoteClass = page.orange === 'header' ? 'btn--primary' : 'btn--outline';
  const langs = ctx.site.languages.length > 1
    ? `<label class="sr-only" for="lang-switch">${t('nav.language')}</label><select class="select" id="lang-switch" data-lang-switch>${ctx.site.languages
        .map((l) => `<option value="${l.prefix}"${l.code === ctx.lang ? ' selected' : ''}>${esc(l.label)}</option>`).join('')}</select>`
    : '';
  return `<header class="site-header${page.glassHeader ? ' site-header--glass' : ''}" data-header>
  <div class="wrap site-header-bar">
    <button class="icon-btn menu-toggle" type="button" data-open="nav-drawer" aria-haspopup="dialog">${icon.menu}<span class="sr-only">${t('nav.open_menu')}</span></button>
    <a class="brand" href="${url('/')}" aria-label="${t('nav.logo_label')}">${logo()}</a>
    <nav class="site-nav" aria-label="${t('nav.main')}">${nav}</nav>
    <div class="header-actions">
      ${langs}
      <div class="account-menu">
        <a class="icon-btn account-link" href="${url('/account/sign-in/')}" data-account>${icon.user}<span class="sr-only" data-account-label>${t('nav.sign_in')}</span></a>
        <div class="account-menu-list" data-account-menu hidden>
          <a href="${url('/admin/')}" data-admin-link hidden>${t('nav.admin')}</a>
          <button type="button" data-sign-out>${t('nav.sign_out')}</button>
        </div>
      </div>
      <a class="icon-btn" href="${url('/cart/')}" data-cart-link>${icon.cart}<span class="sr-only">${t('nav.cart')}</span><span class="cart-count" data-cart-count aria-hidden="true" hidden>0</span><span class="sr-only" data-cart-count-text></span></a>
      <a class="btn btn--sm ${quoteClass}" href="${url('/contact/')}" data-quote data-header-quote>${t('cta.quote')}</a>
    </div>
  </div>
</header>
<dialog class="drawer drawer--nav" id="nav-drawer" aria-label="${t('nav.main')}">
  <div class="drawer-inner">
    <div class="drawer-head">${logo()}<button class="icon-btn" type="button" data-close>${icon.close}<span class="sr-only">${t('nav.close_menu')}</span></button></div>
    <nav class="drawer-body drawer-nav" aria-label="${t('nav.main')}">${nav}<a href="${url('/cart/')}">${t('nav.cart')}</a><a href="${url('/account/sign-in/')}">${t('nav.sign_in')}</a><a href="${url('/help/shipping/')}">${t('footer.shipping')}</a><a href="${url('/help/returns/')}">${t('footer.returns')}</a></nav>
  </div>
</dialog>`;
}

function footer(ctx) {
  const { t, url, site } = ctx;
  const cats = site.categories.map((c) => `<li><a href="${url(`/shop/${c}/`)}">${t(`categories.${c}.name`)}</a></li>`).join('');
  return `<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div><a class="brand" href="${url('/')}" aria-label="${t('nav.logo_label')}">${logo()}</a><p>${t('footer.tagline')}</p></div>
      <nav aria-label="${t('footer.quick_links')}"><h2 class="label">${t('footer.quick_links')}</h2><ul>
        <li><a href="${url('/')}">${t('nav.home')}</a></li>
        <li><a href="${url('/shop/')}">${t('nav.shop')}</a></li>
        <li><a href="${url('/about/')}">${t('nav.about')}</a></li>
        <li><a href="${url('/contact/')}">${t('nav.contact')}</a></li>
        <li><a href="${url('/contact/')}" data-quote>${t('cta.quote')}</a></li>
      </ul></nav>
      <nav aria-label="${t('footer.shop')}"><h2 class="label">${t('footer.shop')}</h2><ul>
        <li><a href="${url('/shop/')}">${t('footer.all_products')}</a></li>${cats}
      </ul></nav>
      <nav aria-label="${t('footer.help')}"><h2 class="label">${t('footer.help')}</h2><ul>
        <li><a href="${url('/help/shipping/')}">${t('footer.shipping')}</a></li>
        <li><a href="${url('/help/returns/')}">${t('footer.returns')}</a></li>
        <li><a href="${url('/help/faq/')}">${t('footer.faq')}</a></li>
      </ul>
      <p class="label">${t('footer.company_details')}</p>
      <p>${esc(site.company.legalName)}<br>${esc(site.company.address)}<br>${esc(site.company.vatNumber)}</p></nav>
    </div>
    <div class="footer-bottom label">
      <p>© <span data-year></span> ${esc(site.name)}. ${t('footer.rights')}</p>
      <ul>
        <li><a href="${url('/legal/terms-of-sale/')}">${t('footer.terms')}</a></li>
        <li><a href="${url('/legal/withdrawal/')}">${t('footer.withdrawal')}</a></li>
        <li><a href="${url('/legal/privacy/')}">${t('footer.privacy')}</a></li>
        <li><button class="link-btn" type="button" data-cookie-open>${t('cookie.title')}</button></li>
      </ul>
      <div class="footer-social">
        <a href="${site.social.linkedin}" target="_blank" rel="noopener noreferrer" aria-label="${t('footer.linkedin')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.2 8.6H2.1V22h3.1V8.6ZM3.65 2a1.82 1.82 0 1 0 0 3.64 1.82 1.82 0 0 0 0-3.64ZM22 14.3c0-4.03-2.15-5.9-5.02-5.9a4.34 4.34 0 0 0-3.9 2.14V8.6H10V22h3.1v-6.63c0-1.75.33-3.44 2.5-3.44 2.14 0 2.17 2 2.17 3.55V22H22v-7.7Z"/></svg></a>
        <a href="${site.social.x}" target="_blank" rel="noopener noreferrer" aria-label="${t('footer.x')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932zm-1.291 19.49h2.039L6.486 3.24H4.298z"/></svg></a>
      </div>
    </div>
  </div>
</footer>`;
}

function overlays(ctx) {
  const { t, url } = ctx;
  return `<dialog class="drawer" id="cart-drawer" aria-labelledby="cart-drawer-title">
  <div class="drawer-inner">
    <div class="drawer-head"><h2 class="title" id="cart-drawer-title">${t('cart.drawer_title')}</h2><button class="icon-btn" type="button" data-close>${icon.close}<span class="sr-only">${t('common.close')}</span></button></div>
    <div class="drawer-body" data-drawer-lines aria-live="polite"></div>
    <div class="drawer-foot">
      <p class="row row--between"><span>${t('cart.subtotal')}</span><span class="mono" data-drawer-subtotal></span></p>
      <p class="small muted">${t('cart.vat_note')}</p>
      <a class="btn btn--primary" href="${url('/cart/')}#checkout">${t('cart.check_out')}</a>
      <a class="btn btn--outline" href="${url('/cart/')}">${t('cart.view_cart')}</a>
      <button class="btn btn--outline" type="button" data-close>${t('cart.continue')}</button>
    </div>
  </div>
</dialog>
<dialog id="quote-dialog" aria-labelledby="quote-title">
  <form class="dialog-body" method="dialog" data-contact-form data-kind="quote" novalidate>
    <div class="dialog-head"><div class="stack"><h2 class="display-md" id="quote-title">${t('quote.title')}</h2><p class="muted">${t('quote.sub')}</p></div>
      <button class="icon-btn" type="button" data-close>${icon.close}<span class="sr-only">${t('common.close')}</span></button></div>
    <div class="field"><label class="label" for="q-name">${t('form.name')}</label><input class="input" id="q-name" name="name" autocomplete="name" required aria-describedby="q-name-err">${fieldError('q-name-err')}</div>
    <div class="field"><label class="label" for="q-business">${t('form.business')}</label><input class="input" id="q-business" name="business" autocomplete="organization"></div>
    <div class="field"><label class="label" for="q-email">${t('form.email')}</label><input class="input" id="q-email" name="email" type="email" autocomplete="email" required aria-describedby="q-email-err">${fieldError('q-email-err')}</div>
    <div class="field"><label class="label" for="q-message">${t('quote.message')}</label><textarea class="textarea" id="q-message" name="message" required aria-describedby="q-message-err"></textarea>${fieldError('q-message-err')}</div>
    <div class="field" data-turnstile></div>
    <p class="notice" data-form-status role="status" hidden></p>
    <button class="btn btn--secondary btn--block" type="submit">${t('quote.send')}</button>
  </form>
</dialog>
<div class="cookie" id="cookie" role="dialog" aria-modal="false" aria-labelledby="cookie-title" data-nosnippet hidden>
  <h2 class="title" id="cookie-title">${t('cookie.title')}</h2>
  <p class="small">${t('cookie.text')}</p>
  <div class="cookie-opts" data-cookie-panel hidden>
    <label class="check"><input type="checkbox" checked disabled><span><strong>${t('cookie.necessary')}</strong><small>${t('cookie.necessary_text')}</small></span></label>
    <label class="check"><input type="checkbox" data-cookie-analytics><span><strong>${t('cookie.analytics')}</strong><small>${t('cookie.analytics_text')}</small></span></label>
    <label class="check"><input type="checkbox" data-cookie-marketing><span><strong>${t('cookie.marketing')}</strong><small>${t('cookie.marketing_text')}</small></span></label>
  </div>
  <div class="cookie-actions">
    <button class="btn btn--sm btn--outline" type="button" data-cookie-reject>${t('cookie.reject')}</button>
    <button class="btn btn--sm btn--outline" type="button" data-cookie-custom>${t('cookie.customise')}</button>
    <button class="btn btn--sm btn--outline" type="button" data-cookie-save hidden>${t('cookie.save')}</button>
    <button class="btn btn--sm btn--secondary" type="button" data-cookie-accept>${t('cookie.accept')}</button>
  </div>
</div>`;
}

// page: { path, title, description, index, nav, orange: 'header'|'page'|'none', glassHeader, body, scripts[], jsonld[], data{} }
export function layout(ctx, page) {
  const { t, site, lang } = ctx;
  const canonical = site.url + ctx.url(page.path);
  const alternates = page.index
    ? site.languages.map((l) => `<link rel="alternate" hreflang="${l.hreflang}" href="${site.url}${l.prefix}${page.path}">`).join('\n  ') +
      `\n  <link rel="alternate" hreflang="x-default" href="${site.url}${page.path}">`
    : '';
  const data = {
    lang, locale: ctx.language.locale, prefix: ctx.language.prefix, gtmId: site.gtmId, quoteEmail: site.emails.info,
    strings: t.raw('client'), ...(page.data || {})
  };
  const jsonld = (page.jsonld || []).map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n  ');
  const scripts = ['site.js', ...(page.scripts || [])].map((s) => `<script type="module" src="/assets/js/${s}"></script>`).join('\n  ');
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.description || t('meta.description'))}">
  ${page.index ? `<link rel="canonical" href="${canonical}">` : '<meta name="robots" content="noindex, nofollow">'}
  ${alternates}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(site.name)}">
  <meta property="og:title" content="${esc(page.title)}">
  <meta property="og:description" content="${esc(page.description || t('meta.description'))}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${site.url}/assets/img/social-share.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/assets/brand/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/assets/brand/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="/assets/brand/apple-touch-icon.png">
  <link rel="preload" href="/assets/fonts/barlow-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/barlow-condensed-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/css/tokens.css">
  <link rel="stylesheet" href="/assets/css/site.css">
  ${jsonld}
  <script type="application/json" id="nova-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
  ${scripts}
</head>
<body>
<a class="skip" href="#main">${t('nav.skip')}</a>
${header(ctx, page)}
<main id="main">
${page.body}
</main>
${footer(ctx)}
${overlays(ctx)}
</body>
</html>
`;
}
