// Shared browser helpers: page data, text, money, API calls, the cart store, Turnstile, analytics.
export const data = JSON.parse(document.getElementById('nova-data')?.textContent || '{}');

const lookup = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data.strings);
export function t(key, vars) {
  const s = lookup(key) ?? key;
  return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s;
}
export const plural = (key, n) => t(`${key}_${new Intl.PluralRules(data.locale).select(n) === 'one' ? 'one' : 'other'}`, { n });
export const money = (cents, currency = 'EUR') => new Intl.NumberFormat(data.locale, { style: 'currency', currency }).format((cents || 0) / 100);
export const url = (path) => `${data.prefix || ''}${path}`;
export const optionText = (options) => Object.values(options || {}).join(' / ');

// Element builder. Text is always set with textContent, never as HTML.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = { plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', close: 'M6 6l12 12M18 6 6 18' };
export function svgIcon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error || 'request_failed'), { status: res.status, code: out.error || 'request_failed', body: out });
  return out;
}

let configPromise;
export const getConfig = () => (configPromise ||= api('/api/config').catch(() => ({ checkout_enabled: false, turnstile_site_key: '', regions: [] })));

// ---------- Cart: product id, variant id and quantity only. Prices are never stored. ----------
const CART_KEY = 'nova-cart-v1';
export const cart = {
  read() {
    try {
      const v = JSON.parse(localStorage.getItem(CART_KEY));
      return Array.isArray(v) ? v.filter((i) => i && typeof i.p === 'string' && typeof i.v === 'string' && Number.isInteger(i.q) && i.q > 0) : [];
    } catch { return []; }
  },
  write(items) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch { /* storage unavailable */ }
    document.dispatchEvent(new CustomEvent('nova-cart', { detail: items }));
  },
  add(p, v, q) {
    const items = cart.read();
    const found = items.find((i) => i.v === v);
    if (found) found.q += q; else items.push({ p, v, q });
    cart.write(items);
  },
  set(v, q) { cart.write(cart.read().map((i) => (i.v === v ? { ...i, q } : i)).filter((i) => i.q > 0)); },
  remove(v) { cart.write(cart.read().filter((i) => i.v !== v)); },
  clear() { cart.write([]); },
  count() { return cart.read().length; },
  payload() { return cart.read().map((i) => ({ product_id: i.p, variant_id: i.v, quantity: i.q })); }
};
export const priceCart = (country) => api('/api/cart/price', { method: 'POST', body: { items: cart.payload(), country: country || null, lang: data.lang } });

// ---------- Turnstile ----------
let turnstileScript;
export async function mountTurnstile(container) {
  const { turnstile_site_key: key } = await getConfig();
  if (!container || !key) return { token: () => null, reset() {} };
  turnstileScript ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.onload = resolve; s.onerror = reject;
    document.head.append(s);
  });
  let token = null, id;
  try {
    await turnstileScript;
    id = window.turnstile.render(container, { sitekey: key, language: data.lang, callback: (v) => { token = v; }, 'expired-callback': () => { token = null; } });
  } catch { /* the server will answer with a clear error */ }
  return { token: () => token, reset() { token = null; if (id != null) window.turnstile.reset(id); } };
}

// ---------- Forms: errors sit next to the field and are announced ----------
export function setFieldError(input, message) {
  const field = input.closest('.field');
  const err = field?.querySelector('.field-error');
  field?.classList.toggle('has-error', Boolean(message));
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (err) { err.hidden = !message; err.querySelector('span').textContent = message || ''; }
}
export function validateForm(form) {
  let first = null;
  for (const input of form.querySelectorAll('input[required], textarea[required], select[required]')) {
    const value = input.value.trim();
    const message = !value ? t('form.required') : (input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? t('form.email') : '');
    setFieldError(input, message);
    if (message && !first) first = input;
  }
  first?.focus();
  return !first;
}

// ---------- Analytics: nothing is sent before consent ----------
export function track(event, params = {}) {
  if (!window.novaConsent?.analytics) return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...params });
}
