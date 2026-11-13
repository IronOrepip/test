// Cart page: lines and totals always come from /api/cart/price, never from stored prices.
import { data, t, money, h, api, cart, priceCart, getConfig, mountTurnstile, setFieldError, track } from './core.js';
import { lineElement } from './site.js';

const root = document.querySelector('[data-cart-page]');
const $ = (sel) => root.querySelector(sel);
const el = {
  loading: $('[data-cart-loading]'), error: $('[data-cart-error]'), empty: $('[data-cart-empty]'), content: $('[data-cart-content]'),
  lines: $('[data-cart-lines]'), changes: $('[data-cart-changes]'), country: $('#country'), noShip: $('[data-no-ship]'),
  subtotal: $('[data-sum-subtotal]'), shipping: $('[data-sum-shipping]'), total: $('[data-sum-total]'), delivery: $('[data-delivery-time]'),
  waiverField: $('[data-waiver-field]'), waiver: $('#waiver'), optin: $('#news-optin'), soon: $('[data-soon]'),
  checkout: $('[data-checkout]'), checkoutError: $('[data-checkout-error]')
};
const SEEN_KEY = 'nova-cart-seen-v1';
const COUNTRY_KEY = 'nova-country-v1';
const store = { get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } } };

let priced = null, config = null, widget = null;
const messages = [];

function show(state) {
  el.loading.hidden = state !== 'loading';
  el.error.hidden = state !== 'error';
  el.empty.hidden = state !== 'empty';
  el.content.hidden = state !== 'ready';
}

// Fix lines the server says cannot be bought as they are, and tell the buyer what changed.
function reconcile(lines) {
  let changed = false;
  for (const l of lines) {
    const name = l.name || l.variant_id;
    const validQty = (max) => { const steps = Math.floor((max - l.min_quantity) / l.quantity_step); return steps < 0 ? 0 : l.min_quantity + steps * l.quantity_step; };
    if (['unavailable', 'region_excluded', 'out_of_stock'].includes(l.status)) {
      cart.remove(l.variant_id); messages.push(t('cartpage.change_unavailable', { name })); changed = true;
    } else if (l.status === 'insufficient_stock') {
      const q = validQty(l.left);
      cart.set(l.variant_id, q);
      messages.push(q ? t('cartpage.change_stock', { n: l.left, name }) : t('cartpage.change_unavailable', { name })); changed = true;
    } else if (l.status === 'over_max' || l.status === 'invalid_quantity') {
      const q = Math.max(validQty(Math.min(l.quantity, l.max_online_quantity)), l.min_quantity);
      cart.set(l.variant_id, q); messages.push(t('cartpage.change_qty', { n: q, name })); changed = true;
    }
  }
  return changed;
}

function notePriceChanges(lines) {
  const seen = store.get(SEEN_KEY) || {};
  const next = {};
  for (const l of lines) {
    const key = `${l.variant_id}:${l.quantity}`;
    const before = seen[key];
    if (before != null && before !== l.unit_amount) messages.push(t('cartpage.change_price', { name: l.name, old: money(before), new: money(l.unit_amount) }));
    next[key] = l.unit_amount;
  }
  store.set(SEEN_KEY, next);
}

function render() {
  const list = el.changes.querySelector('ul');
  list.replaceChildren(...messages.map((m) => h('li', { text: m })));
  el.changes.hidden = messages.length === 0;

  el.lines.replaceChildren(...priced.lines.map((l) => lineElement(l, { editable: true, onChange: (line, q) => { cart.set(line.variant_id, q); refresh(); } })));
  el.subtotal.textContent = money(priced.subtotal, priced.currency);
  const country = el.country.value;
  const other = country === 'other' || priced.region_ok === false;
  el.noShip.hidden = !other;
  el.shipping.textContent = !priced.has_physical ? t('cartpage.shipping_none') : priced.shipping ? money(priced.shipping.amount, priced.currency) : t('cartpage.shipping_tbd');
  el.total.textContent = money(priced.total, priced.currency);
  el.delivery.textContent = [priced.shipping ? t('cartpage.delivery', { min: priced.shipping.min_days, max: priced.shipping.max_days }) : '', priced.has_website ? t('cartpage.delivery_digital') : ''].filter(Boolean).join(' ');
  el.waiverField.hidden = !priced.has_website;
  el.soon.hidden = config.checkout_enabled;
  el.checkout.hidden = !config.checkout_enabled;
  el.checkout.disabled = other;
}

async function refresh() {
  if (!cart.count()) { show('empty'); return; }
  try {
    config ||= await getConfig();
    const country = el.country.value && el.country.value !== 'other' ? el.country.value : null;
    for (let pass = 0; pass < 3; pass += 1) {
      priced = await priceCart(country);
      if (!reconcile(priced.lines)) break;
      if (!cart.count()) { show('empty'); renderEmptyMessages(); return; }
    }
    notePriceChanges(priced.lines);
    render();
    show('ready');
    if (config.checkout_enabled) widget ||= mountTurnstile($('[data-turnstile]'));
  } catch {
    show('error');
  }
}

function renderEmptyMessages() {
  if (messages.length) el.empty.querySelector('p').textContent = messages.join(' ');
}

function checkoutError(msg) {
  el.checkoutError.hidden = !msg;
  el.checkoutError.querySelector('span').textContent = msg || '';
}

el.country.addEventListener('change', () => { store.set(COUNTRY_KEY, el.country.value); setFieldError(el.country, ''); messages.length = 0; refresh(); });
el.waiver.addEventListener('change', () => setFieldError(el.waiver, ''));

el.checkout.addEventListener('click', async () => {
  checkoutError('');
  const country = el.country.value;
  if (!country || country === 'other') { setFieldError(el.country, t('cartpage.err_country')); el.country.focus(); return; }
  if (priced.has_website && !el.waiver.checked) { setFieldError(el.waiver, t('cartpage.err_waiver')); el.waiver.focus(); return; }
  el.checkout.disabled = true;
  const label = el.checkout.textContent;
  el.checkout.textContent = t('cartpage.redirecting');
  try {
    const ts = await widget;
    const out = await api('/api/checkout', { method: 'POST', body: { items: cart.payload(), country, lang: data.lang, waiver: el.waiver.checked, marketing: el.optin.checked, turnstile: ts?.token() || null } });
    track('begin_checkout', { value: priced.total / 100, currency: priced.currency });
    location.href = out.url;
  } catch (err) {
    el.checkout.disabled = false;
    el.checkout.textContent = label;
    (await widget)?.reset();
    const map = { cart_invalid: 'err_stock', region_unavailable: 'err_region', rate_limited: 'err_rate', turnstile_failed: 'err_turnstile', shop_closed: 'err_soon', waiver_required: 'err_waiver' };
    checkoutError(t(`cartpage.${map[err.code] || 'err_generic'}`));
    if (err.code === 'cart_invalid') { messages.length = 0; refresh(); }
  }
});

const savedCountry = store.get(COUNTRY_KEY);
if (savedCountry && [...el.country.options].some((o) => o.value === savedCountry)) el.country.value = savedCountry;
show('loading');
refresh();
track('view_cart');
