// Every page of the site as a function of the build context. Returns page objects for layout().
import { esc, icon, logo, breadcrumbs, fieldError } from './lib/layout.mjs';

const well = (ctx, image, { link, lazy = true } = {}) => {
  const inner = image
    ? `<img src="${image.src}" width="${image.width}" height="${image.height}" alt="${esc(image.alt?.[ctx.lang] || image.alt?.en || '')}"${lazy ? ' loading="lazy" decoding="async"' : ' fetchpriority="high"'}>${image.sample ? `<span class="tag">${ctx.t('product.sample_photo')}</span>` : ''}`
    : `<span class="label">${ctx.t('product.photo_to_follow')}</span>`;
  return link ? `<a class="pcard-media well" href="${link}" tabindex="-1" aria-hidden="true">${inner}</a>` : `<div class="well">${inner}</div>`;
};

export function productCard(ctx, p) {
  const { t, url } = ctx;
  const href = url(`/products/${p.slug}/`);
  return `<article class="pcard" data-product-card data-id="${p.id}" data-category="${p.category}" data-type="${p.type}" data-price="${p.fromPrice}" data-name="${esc(p.tr.name)}">
  ${well(ctx, p.images[0], { link: href })}
  <div class="stack">
    <h3 class="pcard-name"><a href="${href}">${esc(p.tr.name)}</a></h3>
    <p class="label muted">${esc(p.id)}</p>
  </div>
  <div class="pcard-foot">
    <p class="label" data-card-price>${t('product.from')} ${ctx.money(p.fromPrice)}</p>
    <a class="btn-square" href="${href}" data-quick-add="${p.id}" aria-label="${esc(t('product.add_named', { name: p.tr.name }))}">${icon.plus}</a>
  </div>
</article>`;
}

const quoteBtn = (ctx, cls = 'btn--outline') => `<a class="btn ${cls}" href="${ctx.url('/contact/')}" data-quote>${ctx.t('cta.quote')} ${icon.arrow}</a>`;

function services(ctx) {
  const { t } = ctx;
  const items = t.raw('services.items');
  return `<section class="section" aria-labelledby="services-title"><div class="wrap">
  <div class="section-head"><p class="label muted">${t('services.eyebrow')}</p><h2 class="display-lg" id="services-title">${t('services.title')}</h2><p class="lead">${t('services.lead')}</p></div>
  <ul class="grid grid-4">${items.map((s, i) => `<li class="card"><p class="label card-num">${String(i + 1).padStart(2, '0')}</p><h3 class="title">${esc(s.title)}</h3><p>${esc(s.text)}</p>${s.chips ? `<ul class="chips">${s.chips.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>
</div></section>`;
}

function segments(ctx) {
  const { t } = ctx;
  const icons = [icon.shop, icon.bell, icon.briefcase];
  return `<section class="section section--flush" aria-labelledby="who-title"><div class="wrap">
  <div class="section-head"><p class="label muted">${t('segments.eyebrow')}</p><h2 class="display-lg" id="who-title">${t('segments.title')}</h2><p class="lead">${t('segments.lead')}</p></div>
  <ul class="grid grid-3">${t.raw('segments.items').map((s, i) => `<li class="card"><span class="card-icon">${icons[i]}</span><h3 class="title">${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join('')}</ul>
</div></section>`;
}

function promises(ctx, { more } = {}) {
  const { t, url } = ctx;
  return `<section class="section band" id="work" aria-labelledby="promise-title"><div class="wrap">
  <div class="section-head"><p class="label muted">${t('promises.eyebrow')}</p><h2 class="display-lg" id="promise-title">${t('promises.title')}</h2><p class="lead">${t('promises.lead')}</p></div>
  <ul class="grid grid-${more ? 3 : 4}">${t.raw('promises.items').slice(0, more ? 3 : 4).map((s, i) => `<li class="card"><p class="label card-num">${String(i + 1).padStart(2, '0')}</p><h3 class="title">${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join('')}</ul>
  ${more ? `<p class="section-head"></p><a class="more-link" href="${url('/about/')}#work">${t('promises.more')} ${icon.arrow}</a>` : ''}
</div></section>`;
}

function steps(ctx) {
  const { t } = ctx;
  return `<section class="section" id="how" aria-labelledby="how-title"><div class="wrap"><div class="panel">
  <p class="label muted">${t('steps.eyebrow')}</p><h2 class="display-lg" id="how-title">${t('steps.title')}</h2>
  <ol class="steps grid grid-4">${t.raw('steps.items').map((s) => `<li><h3 class="title">${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join('')}</ol>
  <div class="row row--between"><p>${t('steps.foot')}</p>${quoteBtn(ctx, 'btn--secondary')}</div>
</div></div></section>`;
}

function cta(ctx) {
  const { t } = ctx;
  return `<section class="section section--tight band" aria-labelledby="cta-title"><div class="wrap row row--between">
  <div class="stack"><h2 class="display-lg" id="cta-title">${t('cta.title')}</h2><p class="muted">${t('cta.text')}</p></div>
  ${quoteBtn(ctx, 'btn--secondary')}
</div></section>`;
}

function featured(ctx) {
  const { t, url } = ctx;
  const items = ctx.products.filter((p) => p.featured).slice(0, 8);
  return `<section class="section section--flush" id="discover" aria-labelledby="discover-title"><div class="wrap" data-carousel>
  <div class="section-head"><p class="label muted">${t('discover.eyebrow')}</p><h2 class="display-lg" id="discover-title">${t('discover.title')}</h2><p class="lead">${t('discover.lead')}</p></div>
  <div class="carousel-track" data-carousel-track tabindex="0" role="group" aria-label="${t('discover.carousel_label')}">
    ${items.map((p) => productCard(ctx, p)).join('\n')}
    <article class="pcard pcard--all"><h3 class="display-md">${t('discover.all_title')}</h3><a class="btn btn--outline" href="${url('/shop/')}">${t('discover.all')} ${icon.arrow}</a></article>
  </div>
  <div class="carousel-controls">
    <div class="carousel-progress" aria-hidden="true"><span data-carousel-progress></span></div>
    <button class="btn-square btn-square--lg" type="button" data-carousel-prev>${icon.prev}<span class="sr-only">${t('discover.prev')}</span></button>
    <button class="btn-square btn-square--lg" type="button" data-carousel-next>${icon.next}<span class="sr-only">${t('discover.next')}</span></button>
  </div>
</div></section>`;
}

function home(ctx) {
  const { t, url, site } = ctx;
  const body = `<section class="hero on-dark" aria-labelledby="home-title">
  <div class="hero-media" aria-hidden="true"><canvas data-hero-canvas></canvas></div>
  <img class="hero-mark" src="/assets/img/n.png" width="210" height="232" alt="" fetchpriority="high">
  <div class="wrap"><div class="hero-panel">
    <p class="label">${t('home.eyebrow')}</p>
    <h1 class="display-xl" id="home-title">${t('home.title')}</h1>
    <p class="lead">${t('home.lead')}</p>
    <div class="row"><a class="btn btn--secondary" href="${url('/shop/')}">${t('home.shop_cta')} ${icon.arrow}</a><a class="btn btn--outline" href="${url('/about/')}">${t('home.about_cta')}</a></div>
  </div></div>
</section>
<section class="section section--tight" aria-label="${t('home.quick_label')}"><div class="wrap row row--between">
  <ul class="taglist">${t.raw('home.tags').map((x) => `<li class="tag">${esc(x)}</li>`).join('')}</ul>
  <ul class="row" aria-label="${t('footer.quick_links')}"><li><a class="more-link" href="${url('/shop/')}">${t('nav.shop')} ${icon.arrow}</a></li><li><a class="more-link" href="${url('/help/shipping/')}">${t('footer.shipping')} ${icon.arrow}</a></li></ul>
</div></section>
${featured(ctx)}
${services(ctx)}
${segments(ctx)}
${promises(ctx, { more: true })}
${steps(ctx)}
${cta(ctx)}`;
  const jsonld = [{
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'Organization', '@id': `${site.url}/#org`, name: site.name, url: site.url, logo: `${site.url}/assets/brand/nova-logo-ink@2x.png`, foundingDate: '2026-10', description: t('meta.description'), areaServed: 'Europe', sameAs: [site.social.linkedin, site.social.x] },
      { '@type': 'WebSite', name: site.name, url: `${site.url}/`, publisher: { '@id': `${site.url}/#org` } }
    ]
  }];
  return { path: '/', title: t('home.meta_title'), description: t('meta.description'), index: true, nav: 'home', orange: 'header', glassHeader: true, body, jsonld, scripts: ['hero.js', 'carousel.js', 'shop.js'] };
}

function about(ctx) {
  const { t } = ctx;
  const facts = t.raw('about.facts');
  const faq = t.raw('about.faq');
  const body = `<section class="page-head"><div class="wrap">
  <p class="label muted">${t('about.eyebrow')}</p>
  <h1 class="display-xl">${t('about.title')}</h1>
  <p class="lead">${t('about.lead')}</p>
</div></section>
<section class="section section--flush" aria-labelledby="welcome-title"><div class="wrap split">
  <div class="prose"><h2 class="display-lg" id="welcome-title">${t('about.welcome_title')}</h2>${t.raw('about.welcome').map((p) => `<p>${esc(p)}</p>`).join('')}</div>
  <table class="spec"><caption class="sr-only">${t('about.facts_label')}</caption><tbody>${facts.map((f) => `<tr><th scope="row">${esc(f[0])}</th><td>${esc(f[1])}</td></tr>`).join('')}</tbody></table>
</div></section>
${services(ctx)}
${segments(ctx)}
${promises(ctx)}
${steps(ctx)}
<section class="section section--flush" aria-labelledby="faq-title"><div class="wrap split">
  <div class="stack"><p class="label muted">${t('about.faq_eyebrow')}</p><h2 class="display-lg" id="faq-title">${t('about.faq_title')}</h2><p class="muted">${t('about.faq_text')}</p>${quoteBtn(ctx)}</div>
  <div class="faq">${faq.map((f, i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(f.q)}</summary><div class="answer"><p>${esc(f.a)}</p></div></details>`).join('')}</div>
</div></section>
${cta(ctx)}`;
  return { path: '/about/', title: t('about.meta_title'), description: t('about.meta_description'), index: true, nav: 'about', orange: 'header', body };
}

function contact(ctx) {
  const { t, site } = ctx;
  const body = `<section class="page-head"><div class="wrap">
  <p class="label muted">${t('contact.eyebrow')}</p><h1 class="display-xl">${t('contact.title')}</h1><p class="lead">${t('contact.lead')}</p>
</div></section>
<section class="section section--flush"><div class="wrap split">
  <form class="form" data-contact-form data-kind="contact" novalidate>
    <div class="field"><label class="label" for="c-name">${t('form.name')}</label><input class="input" id="c-name" name="name" autocomplete="name" required aria-describedby="c-name-err">${fieldError('c-name-err')}</div>
    <div class="field"><label class="label" for="c-business">${t('form.business')}</label><input class="input" id="c-business" name="business" autocomplete="organization"></div>
    <div class="field"><label class="label" for="c-email">${t('form.email')}</label><input class="input" id="c-email" name="email" type="email" autocomplete="email" required aria-describedby="c-email-err">${fieldError('c-email-err')}</div>
    <div class="field"><label class="label" for="c-message">${t('contact.message')}</label><textarea class="textarea" id="c-message" name="message" required aria-describedby="c-message-err"></textarea>${fieldError('c-message-err')}</div>
    <div class="field" data-turnstile></div>
    <p class="notice" data-form-status role="status" hidden></p>
    <button class="btn btn--secondary" type="submit">${t('contact.send')}</button>
    <p class="small muted">${t('contact.privacy_note')}</p>
  </form>
  <div class="stack-lg">
    <table class="spec"><caption class="sr-only">${t('contact.details')}</caption><tbody>
      <tr><th scope="row">${t('contact.email_label')}</th><td><a href="mailto:${site.emails.info}">${site.emails.info}</a></td></tr>
      <tr><th scope="row">${t('contact.orders_label')}</th><td><a href="mailto:${site.emails.orders}">${site.emails.orders}</a></td></tr>
      <tr><th scope="row">LinkedIn</th><td><a href="${site.social.linkedin}" target="_blank" rel="noopener noreferrer">${t('contact.linkedin')}</a></td></tr>
      <tr><th scope="row">${t('footer.company_details')}</th><td>${esc(site.company.legalName)}<br>${esc(site.company.address)}<br>${esc(site.company.vatNumber)}</td></tr>
    </tbody></table>
    <p class="muted">${t('contact.quote_hint')}</p>
  </div>
</div></section>`;
  return { path: '/contact/', title: t('contact.meta_title'), description: t('contact.lead'), index: true, nav: 'contact', orange: 'header', body };
}

function shopPages(ctx) {
  const { t, url, site } = ctx;
  const make = (category) => {
    const path = category ? `/shop/${category}/` : '/shop/';
    const list = ctx.products.filter((p) => !category || p.category === category);
    const title = category ? t(`categories.${category}.name`) : t('shop.title');
    const lead = category ? t(`categories.${category}.lead`) : t('shop.lead');
    const crumbs = [{ name: t('nav.home'), href: url('/') }, { name: t('nav.shop'), href: url('/shop/') }];
    if (category) crumbs.push({ name: title, href: url(path) });
    const bc = breadcrumbs(ctx, crumbs);
    const catNav = `<nav class="cat-nav" aria-label="${t('shop.categories')}"><a class="tag" href="${url('/shop/')}"${category ? '' : ' aria-current="page"'}>${t('footer.all_products')}</a>${site.categories
      .map((c) => `<a class="tag" href="${url(`/shop/${c}/`)}"${c === category ? ' aria-current="page"' : ''}>${t(`categories.${c}.name`)}</a>`).join('')}</nav>`;
    const body = `${bc.html}
<section class="page-head"><div class="wrap"><h1 class="display-xl">${esc(title)}</h1><p class="lead">${esc(lead)}</p>${catNav}</div></section>
<section class="section section--flush"><div class="wrap" data-shop>
  <form class="filters" data-filters aria-label="${t('shop.filters')}">
    ${category ? '' : `<div class="field"><label class="label" for="f-category">${t('shop.filter_category')}</label><select class="select" id="f-category" name="category"><option value="">${t('shop.all')}</option>${site.categories.map((c) => `<option value="${c}">${t(`categories.${c}.name`)}</option>`).join('')}</select></div>`}
    <div class="field"><label class="label" for="f-type">${t('shop.filter_type')}</label><select class="select" id="f-type" name="type"><option value="">${t('shop.all')}</option><option value="standard">${t('shop.type_standard')}</option><option value="website">${t('shop.type_website')}</option></select></div>
    <div class="field"><label class="label" for="f-sort">${t('shop.sort')}</label><select class="select" id="f-sort" name="sort"><option value="featured">${t('shop.sort_featured')}</option><option value="name">${t('shop.sort_name')}</option><option value="price-asc">${t('shop.sort_price_asc')}</option><option value="price-desc">${t('shop.sort_price_desc')}</option></select></div>
    <p class="label result-count" data-result-count role="status" aria-live="polite"></p>
  </form>
  <p class="notice" data-shop-status role="status" hidden>${icon.info}<span></span></p>
  <div class="product-grid" data-product-grid>${list.map((p) => productCard(ctx, p)).join('\n')}</div>
  <div class="empty" data-shop-empty${list.length ? ' hidden' : ''}><h2 class="title">${t('shop.empty_title')}</h2><p class="muted">${t('shop.empty_text')}</p><div class="row" data-center><a class="btn btn--outline" href="${url('/shop/')}">${t('footer.all_products')}</a></div></div>
  <div class="section-head"></div>
  <p class="muted">${t('shop.help_line')} <a href="${url('/help/shipping/')}">${t('footer.shipping')}</a> · <a href="${url('/help/returns/')}">${t('footer.returns')}</a> · <a href="${url('/contact/')}" data-quote>${t('shop.quote_large')}</a></p>
</div></section>`;
    return { path, title: `${title} | ${site.name}`, description: lead, index: true, nav: 'shop', orange: 'header', body, jsonld: [bc.ld], scripts: ['shop.js'] };
  };
  return [make(null), ...site.categories.map(make)];
}

function productPage(ctx, p) {
  const { t, url, site } = ctx;
  const path = `/products/${p.slug}/`;
  const bc = breadcrumbs(ctx, [
    { name: t('nav.home'), href: url('/') }, { name: t('nav.shop'), href: url('/shop/') },
    { name: t(`categories.${p.category}.name`), href: url(`/shop/${p.category}/`) }, { name: p.tr.name, href: url(path) }
  ]);
  const isSite = p.type === 'website';
  const optionKey = Object.keys(p.variants[0].options)[0];
  const variantLabel = (v) => Object.values(v.options).join(' / ') || t('product.standard');
  const variants = p.variants.length > 1
    ? `<fieldset class="field"><legend class="label">${optionKey ? t(`options.${optionKey}`) : t('product.variant')}</legend><div class="radio-row">${p.variants
        .map((v, i) => `<label class="radio-pill"><input type="radio" name="variant" value="${v.id}"${i === 0 ? ' checked' : ''}><span>${esc(variantLabel(v))}</span></label>`).join('')}</div></fieldset>`
    : `<input type="hidden" name="variant" value="${p.variants[0].id}">`;
  const qty = isSite
    ? `<input type="hidden" name="quantity" value="1">`
    : `<div class="field"><label class="label" for="qty">${t('product.quantity')}</label>
      <div class="stepper"><button class="btn-square btn-square--lg" type="button" data-qty-down>${icon.minus}<span class="sr-only">${t('product.decrease')}</span></button>
      <input class="input" id="qty" name="quantity" type="number" inputmode="numeric" min="${p.min_quantity}" max="${p.max_online_quantity}" step="${p.quantity_step}" value="${p.min_quantity}" aria-describedby="qty-hint">
      <button class="btn-square btn-square--lg" type="button" data-qty-up>${icon.plus}<span class="sr-only">${t('product.increase')}</span></button></div>
      <p class="field-hint" id="qty-hint">${t('product.qty_hint', { min: p.min_quantity, step: p.quantity_step, max: p.max_online_quantity })}</p></div>`;
  const breaks = p.price_breaks.filter((b) => !b.variant_id && b.currency === 'EUR');
  const breakTable = isSite ? '' : `<div><h2 class="title">${t('product.price_breaks')}</h2><div class="table-scroll"><table class="spec spec--data" data-break-table><thead><tr><th scope="col">${t('product.quantity')}</th><th scope="col">${t('product.unit_price')}</th></tr></thead><tbody>${breaks
    .map((b) => `<tr data-min="${b.min_quantity}"><th scope="row" class="num">${b.min_quantity}+</th><td>${ctx.money(b.unit_amount)}</td></tr>`).join('')}</tbody></table></div><p class="small muted">${t('product.above_max', { max: p.max_online_quantity })} <a href="${url('/contact/')}" data-quote>${t('cta.quote')}</a></p></div>`;
  const countries = site.shipCountries.map((c) => ctx.countryName(c)).sort((a, b) => a.localeCompare(b, ctx.language.locale)).join(', ');
  const specs = [
    [t('product.sku'), `<span data-sku>${esc(p.variants[0].id)}</span>`],
    [t('product.availability'), `<span class="status" data-stock>${t('product.stock_checking')}</span>`],
    [isSite ? t('product.setup_time') : t('product.dispatch'), t('product.days', { n: p.dispatch_days })],
    ...(isSite ? [[t('product.delivery'), t('product.delivery_digital')]] : [[t('product.weight'), `${p.weight_grams} g`], [t('product.delivery_countries'), esc(countries)]])
  ];
  const supply = isSite ? `<div><h2 class="title">${t('product.you_supply')}</h2><ul class="prose">${p.setup_fields.map((f) => `<li>${t(`setup_fields.${f}`)}</li>`).join('')}</ul><p class="small muted">${t('product.website_process')}</p></div>` : '';
  const related = ctx.products.filter((x) => x.id !== p.id && x.category === p.category).concat(ctx.products.filter((x) => x.id !== p.id && x.category !== p.category && x.featured)).slice(0, 4);
  const gallery = `<div class="gallery" data-gallery>${
    p.images.length
      ? `<div class="well" data-gallery-main><img src="${p.images[0].src}" width="${p.images[0].width}" height="${p.images[0].height}" alt="${esc(p.images[0].alt?.[ctx.lang] || p.images[0].alt?.en || '')}" fetchpriority="high">${p.images[0].sample ? `<span class="tag">${t('product.sample_photo')}</span>` : ''}</div>`
      : `<div class="well"><span class="label">${t('product.photo_to_follow')}</span></div>`
  }${p.images.length > 1 ? `<div class="gallery-thumbs">${p.images.map((im, i) => `<button type="button" data-gallery-thumb="${im.src}" data-alt="${esc(im.alt?.[ctx.lang] || im.alt?.en || '')}"${i === 0 ? ' aria-current="true"' : ''}><img src="${im.src}" width="${im.width}" height="${im.height}" alt="${esc(t('product.view_image', { n: i + 1 }))}"></button>`).join('')}</div>` : ''}</div>`;
  const body = `${bc.html}
<section class="section section--flush"><div class="wrap product">
  ${gallery}
  <form class="buy" data-buy novalidate>
    <div class="stack"><p class="label muted">${t(`categories.${p.category}.name`)}</p><h1 class="display-lg">${esc(p.tr.name)}</h1><p>${esc(p.tr.short_description)}</p></div>
    <p class="price"><small>${isSite ? t('product.price_once') : t('product.unit_price')}</small><span data-unit-price>${ctx.money(p.fromPrice)}</span></p>
    ${variants}
    ${qty}
    <p class="line-total"><span class="label">${t('product.line_total')}</span><span class="price" data-line-total aria-live="polite">${ctx.money(p.fromPrice * p.min_quantity)}</span></p>
    <p class="small muted">${t('cart.vat_note')}</p>
    <div class="buy-actions">
      <button class="btn btn--primary" type="submit" data-add aria-describedby="add-reason">${t('product.add_to_cart')}</button>
      <p class="field-error" id="add-reason" data-add-reason role="status" hidden>${icon.info}<span></span></p>
      ${isSite ? (p.demo_url ? `<a class="btn btn--outline" href="${esc(p.demo_url)}" target="_blank" rel="noopener noreferrer">${t('product.view_demo')} ${icon.external}<span class="sr-only">${t('common.new_tab')}</span></a>` : `<p class="small muted">${t('product.demo_soon')}</p>`) : ''}
      ${quoteBtn(ctx)}
    </div>
    <div class="field" data-back-in-stock hidden><label class="label" for="bis-email">${t('product.back_in_stock')}</label><div class="row"><input class="input" id="bis-email" type="email" autocomplete="email" placeholder="${t('form.email_placeholder')}"><button class="btn btn--outline" type="button" data-bis-submit>${t('product.notify_me')}</button></div><p class="field-hint" data-bis-status role="status"></p></div>
  </form>
</div></section>
<section class="section section--flush"><div class="wrap split">
  <div class="stack-lg"><div class="prose"><h2 class="title">${t('product.description')}</h2><p>${esc(p.tr.description)}</p></div>${supply}${breakTable}</div>
  <div class="stack-lg"><div><h2 class="title">${t('product.specs')}</h2><table class="spec"><tbody>${specs.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">${isSite ? t('product.website_withdrawal') : t('product.returns_line')} <a href="${url('/help/shipping/')}">${t('footer.shipping')}</a> · <a href="${url('/help/returns/')}">${t('footer.returns')}</a></p></div>
</div></section>
${related.length ? `<section class="section section--flush" aria-labelledby="related-title"><div class="wrap"><div class="section-head"><h2 class="display-md" id="related-title">${t('product.related')}</h2></div><div class="product-grid">${related.map((r) => productCard(ctx, r)).join('\n')}</div></div></section>` : ''}`;
  const prices = p.price_breaks.filter((b) => b.currency === 'EUR').map((b) => b.unit_amount);
  const inStock = isSite || p.variants.some((v) => v.stock > 0);
  const ld = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.tr.name, sku: p.id, description: p.tr.short_description,
    ...(p.images[0] ? { image: site.url + p.images[0].src } : {}), brand: { '@type': 'Brand', name: site.name }, category: t(`categories.${p.category}.name`),
    offers: { '@type': 'AggregateOffer', priceCurrency: 'EUR', lowPrice: (Math.min(...prices) / 100).toFixed(2), highPrice: (Math.max(...prices) / 100).toFixed(2), offerCount: p.variants.length, availability: `https://schema.org/${inStock ? 'InStock' : 'OutOfStock'}`, url: site.url + url(path) }
  };
  const data = { product: { id: p.id, type: p.type, name: p.tr.name, slug: p.slug, image: p.images[0]?.src || null, min: p.min_quantity, step: p.quantity_step, max: p.max_online_quantity, currency: 'EUR',
    variants: p.variants.map((v) => ({ id: v.id, label: variantLabel(v) })), breaks: p.price_breaks.filter((b) => b.currency === 'EUR').map((b) => ({ v: b.variant_id || null, min: b.min_quantity, amount: b.unit_amount })) } };
  return { path, title: `${p.tr.name} | ${site.name}`, description: p.tr.short_description, index: true, nav: 'shop', orange: 'page', body, jsonld: [bc.ld, ld], scripts: ['product.js', 'shop.js'], data };
}

function cart(ctx) {
  const { t, url, site } = ctx;
  const options = site.shipCountries.map((c) => [c, ctx.countryName(c)]).sort((a, b) => a[1].localeCompare(b[1], ctx.language.locale));
  const body = `<section class="page-head"><div class="wrap"><h1 class="display-xl">${t('cart.title')}</h1></div></section>
<section class="section section--flush"><div class="wrap" data-cart-page>
  <p class="loading" data-cart-loading role="status">${t('cart.loading')}</p>
  <p class="notice" data-cart-error role="alert" hidden>${icon.alert}<span>${t('cart.error')}</span></p>
  <div class="empty" data-cart-empty hidden><h2 class="title">${t('cart.empty_title')}</h2><p class="muted">${t('cart.empty_text')}</p><div><a class="btn btn--outline" href="${url('/shop/')}">${t('cart.continue')}</a></div></div>
  <div class="split split--aside" data-cart-content hidden>
    <div class="stack">
      <div class="notice" data-cart-changes role="status" hidden>${icon.info}<ul class="prose"></ul></div>
      <ul class="cart-lines" data-cart-lines></ul>
    </div>
    <aside class="summary" id="checkout" aria-labelledby="summary-title">
      <h2 class="title" id="summary-title">${t('cart.summary')}</h2>
      <div class="field" data-country-field><label class="label" for="country">${t('cart.country')}</label>
        <select class="select" id="country" name="country" autocomplete="country" aria-describedby="country-hint country-err"><option value="">${t('cart.choose_country')}</option>${options.map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join('')}<option value="other">${t('cart.other_country')}</option></select>
        <p class="field-hint" id="country-hint">${t('cart.country_hint')}</p>${fieldError('country-err')}</div>
      <p class="notice" data-no-ship role="status" hidden>${icon.info}<span>${t('cart.no_ship')} <a href="${url('/contact/')}">${t('nav.contact')}</a></span></p>
      <dl>
        <dt>${t('cart.subtotal')}</dt><dd data-sum-subtotal></dd>
        <dt>${t('cart.shipping')}</dt><dd data-sum-shipping></dd>
        <dt class="total">${t('cart.total_ex_vat')}</dt><dd class="total" data-sum-total></dd>
      </dl>
      <p class="small muted" data-delivery-time></p>
      <p class="small muted">${t('cart.vat_note')}</p>
      <div class="field" data-waiver-field hidden><label class="check"><input type="checkbox" id="waiver" aria-describedby="waiver-err"><span>${t('cart.waiver')}</span></label>${fieldError('waiver-err')}</div>
      <div class="field"><label class="check"><input type="checkbox" id="news-optin"><span>${t('cart.news_optin')}</span></label></div>
      <div class="field" data-turnstile></div>
      <p class="notice" data-soon hidden>${icon.info}<span>${t('cart.soon')}</span></p>
      <p class="field-error" data-checkout-error role="alert" hidden>${icon.alert}<span></span></p>
      <button class="btn btn--primary btn--block" type="button" data-checkout>${t('cart.check_out')}</button>
      <a class="btn btn--outline btn--block" href="${url('/shop/')}">${t('cart.continue')}</a>
      <p class="small muted">${t('cart.legal_before')} <a href="${url('/legal/terms-of-sale/')}">${t('footer.terms')}</a>, <a href="${url('/help/returns/')}">${t('footer.returns')}</a>, <a href="${url('/legal/privacy/')}">${t('footer.privacy')}</a>. ${t('cart.pay_on_stripe')}</p>
    </aside>
  </div>
</div></section>`;
  return { path: '/cart/', title: `${t('cart.title')} | ${site.name}`, index: false, orange: 'page', body, scripts: ['cart-page.js'] };
}

function checkoutPages(ctx) {
  const { t, url, site } = ctx;
  const success = `<section class="page-head"><div class="wrap" data-success>
  <p class="label muted">${t('success.eyebrow')}</p>
  <h1 class="display-xl" data-success-title tabindex="-1">${t('success.confirming_title')}</h1>
  <p class="lead" data-success-text role="status" aria-live="polite">${t('success.confirming_text')}</p>
</div></section>
<section class="section section--flush"><div class="wrap split" data-success-detail hidden>
  <div class="stack"><h2 class="title">${t('success.summary')}</h2><table class="spec"><tbody>
    <tr><th scope="row">${t('success.order_number')}</th><td data-order-number></td></tr>
    <tr><th scope="row">${t('success.status')}</th><td><span class="status" data-order-status></span></td></tr>
    <tr><th scope="row">${t('success.email')}</th><td data-order-email></td></tr>
    <tr><th scope="row">${t('success.total')}</th><td data-order-total></td></tr>
  </tbody></table><ul class="cart-lines" data-order-items></ul></div>
  <div class="stack"><p>${t('success.email_note')}</p><p class="muted" data-website-note hidden>${t('success.website_note')}</p><p class="muted">${t('success.account_note')}</p>
    <div class="row"><a class="btn btn--secondary" href="${url('/shop/')}">${t('cart.continue')}</a></div></div>
</div></section>`;
  const cancelled = `<section class="page-head"><div class="wrap"><p class="label muted">${t('cancelled.eyebrow')}</p><h1 class="display-xl">${t('cancelled.title')}</h1><p class="lead">${t('cancelled.text')}</p>
  <div class="row"><a class="btn btn--primary" href="${url('/cart/')}">${t('cancelled.back')}</a><a class="btn btn--outline" href="${url('/shop/')}">${t('cart.continue')}</a></div></div></section>`;
  return [
    { path: '/checkout/success/', title: `${t('success.meta_title')} | ${site.name}`, index: false, orange: 'none', body: success, scripts: ['checkout-success.js'] },
    { path: '/checkout/cancelled/', title: `${t('cancelled.title')} | ${site.name}`, index: false, orange: 'page', body: cancelled }
  ];
}

function signIn(ctx) {
  const { t, site } = ctx;
  const body = `<section class="page-head"><div class="wrap"><h1 class="display-xl">${t('auth.sign_in_title')}</h1><p class="lead">${t('auth.sign_in_lead')}</p></div></section>
<section class="section section--flush"><div class="wrap">
  <form class="form" data-sign-in novalidate>
    <div class="field"><label class="label" for="si-email">${t('form.email')}</label><input class="input" id="si-email" name="email" type="email" autocomplete="username" required aria-describedby="si-email-err">${fieldError('si-email-err')}</div>
    <div class="field"><label class="label" for="si-password">${t('auth.password')}</label><input class="input" id="si-password" name="password" type="password" autocomplete="current-password" required aria-describedby="si-password-err">${fieldError('si-password-err')}</div>
    <div class="field" data-turnstile></div>
    <p class="field-error" data-form-error role="alert" hidden>${icon.alert}<span></span></p>
    <button class="btn btn--primary" type="submit">${t('auth.sign_in')}</button>
  </form>
</div></section>`;
  return { path: '/account/sign-in/', title: `${t('auth.sign_in_title')} | ${site.name}`, index: false, orange: 'page', body, scripts: ['sign-in.js'] };
}

function admin(ctx) {
  const { t, url, site } = ctx;
  const statuses = t.raw('client.status');
  const body = `<section class="page-head"><div class="wrap"><p class="label muted">${t('admin.eyebrow')}</p><h1 class="display-xl">${t('admin.orders')}</h1></div></section>
<section class="section section--flush"><div class="wrap" data-admin>
  <p class="notice" data-admin-gate role="status">${icon.info}<span>${t('admin.checking')}</span></p>
  <div data-admin-content hidden>
    <form class="admin-bar" data-admin-filters>
      <div class="field"><label class="label" for="a-q">${t('admin.search')}</label><input class="input" id="a-q" name="q" type="search" placeholder="${t('admin.search_hint')}"></div>
      <div class="field"><label class="label" for="a-status">${t('admin.status')}</label><select class="select" id="a-status" name="status"><option value="">${t('shop.all')}</option>${Object.entries(statuses).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
      <button class="btn btn--secondary" type="submit">${t('admin.apply')}</button>
    </form>
    <p class="label" data-admin-count role="status" aria-live="polite"></p>
    <div class="table-scroll"><table class="spec spec--data"><thead><tr><th scope="col">${t('admin.col_number')}</th><th scope="col">${t('admin.col_date')}</th><th scope="col">${t('admin.status')}</th><th scope="col">${t('admin.col_customer')}</th><th scope="col">${t('admin.col_items')}</th><th scope="col">${t('admin.col_total')}</th><th scope="col">${t('admin.col_payment')}</th></tr></thead><tbody data-admin-rows></tbody></table></div>
    <p class="small muted">${t('admin.phase_note')}</p>
  </div>
  <p data-admin-signin hidden><a class="btn btn--secondary" href="${url('/account/sign-in/')}?next=/admin/">${t('auth.sign_in')}</a></p>
</div></section>`;
  return { path: '/admin/', title: `${t('admin.orders')} | ${site.name}`, index: false, orange: 'none', body, scripts: ['admin.js'] };
}

function textPages(ctx) {
  const { t, site } = ctx;
  const defs = [
    ['/help/shipping/', 'help_shipping', false], ['/help/returns/', 'help_returns', true], ['/help/faq/', 'help_faq', false],
    ['/legal/terms-of-sale/', 'legal_terms', true], ['/legal/withdrawal/', 'legal_withdrawal', true], ['/legal/privacy/', 'legal_privacy', true]
  ];
  return defs.map(([path, key, todo]) => {
    const doc = t.raw(`docs.${key}`);
    const body = `<section class="page-head"><div class="wrap"><p class="label muted">${esc(doc.eyebrow)}</p><h1 class="display-xl">${esc(doc.title)}</h1><p class="lead">${esc(doc.lead)}</p>
  ${todo ? `<p class="notice notice--todo">${icon.alert}<span>${t('docs.todo_banner')}</span></p>` : ''}</div></section>
<section class="section section--flush"><div class="wrap prose">${doc.sections.map((s) => `<h2 class="title">${esc(s.h)}</h2>${(s.p || []).map((p) => `<p>${esc(p)}</p>`).join('')}${s.list ? `<ul>${s.list.map((li) => `<li>${esc(li)}</li>`).join('')}</ul>` : ''}`).join('')}</div></section>`;
    return { path, title: `${doc.title} | ${site.name}`, description: doc.lead, index: true, orange: 'header', body };
  });
}

function notFound(ctx) {
  const { t, url, site } = ctx;
  return { path: '/404.html', file: '404.html', title: `${t('notfound.title')} | ${site.name}`, index: false, orange: 'header',
    body: `<section class="page-head"><div class="wrap"><p class="label muted">404</p><h1 class="display-xl">${t('notfound.title')}</h1><p class="lead">${t('notfound.text')}</p><div class="row"><a class="btn btn--secondary" href="${url('/')}">${t('nav.home')}</a><a class="btn btn--outline" href="${url('/shop/')}">${t('nav.shop')}</a></div></div></section>` };
}

export function allPages(ctx) {
  return [home(ctx), about(ctx), contact(ctx), ...shopPages(ctx), ...ctx.products.map((p) => productPage(ctx, p)), cart(ctx), ...checkoutPages(ctx), signIn(ctx), admin(ctx), ...textPages(ctx), notFound(ctx)];
}

export { logo };
