// Runs on every page: navigation drawer, glass header, cookie consent, quote dialog,
// contact forms, cart badge, mini cart drawer and the account icon.
import { data, t, plural, money, url, h, svgIcon, api, cart, priceCart, optionText, mountTurnstile, validateForm, track } from './core.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- Dialogs and drawers ----------
let lastTrigger = null;
// One orange button per view: while the cart drawer is open, its "Check out" is the orange one,
// so every orange button on the page behind it switches to the outline style until it closes.
let demoted = [];
const demoteOrange = (dialog) => { demoted = $$('.btn--primary').filter((b) => !dialog.contains(b)); demoted.forEach((b) => b.classList.replace('btn--primary', 'btn--outline')); };
const restoreOrange = () => { demoted.forEach((b) => b.classList.replace('btn--outline', 'btn--primary')); demoted = []; };
function openDialog(dialog, trigger) {
  if (!dialog || dialog.open) return;
  lastTrigger = trigger || document.activeElement;
  dialog.showModal();
  if (dialog.id === 'cart-drawer') demoteOrange(dialog);
}
for (const dialog of $$('dialog')) {
  dialog.addEventListener('click', (e) => { if (e.target === dialog || e.target.closest('[data-close]')) dialog.close(); });
  dialog.addEventListener('close', () => {
    if (dialog.id === 'cart-drawer') restoreOrange();
    lastTrigger?.focus?.();
  });
}
document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-open]');
  if (opener) { e.preventDefault(); openDialog(document.getElementById(opener.dataset.open), opener); return; }
  const quote = e.target.closest('[data-quote]');
  const dialog = $('#quote-dialog');
  if (quote && dialog?.showModal) {
    e.preventDefault();
    quote.closest('dialog')?.close();
    openDialog(dialog, quote);
    $('#q-name').focus();
  }
});

// ---------- Glass header turns solid once the hero is scrolled away ----------
const header = $('[data-header]');
if (header?.classList.contains('site-header--glass')) {
  const hero = $('.hero');
  const update = () => header.classList.toggle('is-solid', window.scrollY > (hero?.offsetHeight || 0) - header.offsetHeight);
  addEventListener('scroll', update, { passive: true });
  update();
}

for (const el of $$('[data-year]')) el.textContent = new Date().getFullYear();

// ---------- Cookie consent. The tag manager loads only after analytics consent. ----------
const CONSENT_KEY = 'nova-consent-v1';
const box = $('#cookie');
const readConsent = () => { try { return JSON.parse(localStorage.getItem(CONSENT_KEY)); } catch { return null; } };
let gtmLoaded = false;
function applyConsent(c) {
  window.novaConsent = c;
  document.dispatchEvent(new CustomEvent('nova-consent', { detail: c }));
  if (c.analytics && data.gtmId && !gtmLoaded) {
    gtmLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(data.gtmId)}`;
    document.head.append(s);
  }
}
function saveConsent(analytics, marketing) {
  const c = { necessary: true, analytics, marketing, date: new Date().toISOString() };
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
  box.hidden = true;
  applyConsent(c);
}
function openConsent() {
  const c = readConsent() || {};
  $('[data-cookie-analytics]').checked = Boolean(c.analytics);
  $('[data-cookie-marketing]').checked = Boolean(c.marketing);
  box.hidden = false;
}
if (box) {
  $('[data-cookie-accept]').addEventListener('click', () => saveConsent(true, true));
  $('[data-cookie-reject]').addEventListener('click', () => saveConsent(false, false));
  $('[data-cookie-custom]').addEventListener('click', (e) => { $('[data-cookie-panel]').hidden = false; e.currentTarget.hidden = true; $('[data-cookie-save]').hidden = false; });
  $('[data-cookie-save]').addEventListener('click', () => saveConsent($('[data-cookie-analytics]').checked, $('[data-cookie-marketing]').checked));
  for (const b of $$('[data-cookie-open]')) b.addEventListener('click', openConsent);
  const saved = readConsent();
  if (saved) applyConsent(saved); else openConsent();
}

// ---------- Contact and quote forms ----------
for (const form of $$('[data-contact-form]')) {
  const status = $('[data-form-status]', form);
  const submit = $('button[type="submit"]', form);
  let widget;
  const ensureWidget = () => (widget ||= mountTurnstile($('[data-turnstile]', form)));
  form.addEventListener('focusin', ensureWidget, { once: true });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(form)) return;
    const fd = new FormData(form);
    const say = (msg) => { status.hidden = false; status.textContent = msg; };
    submit.disabled = true;
    say(t('form.sending'));
    try {
      const ts = await ensureWidget();
      await api('/api/contact', { method: 'POST', body: { kind: form.dataset.kind, name: fd.get('name'), business: fd.get('business'), email: fd.get('email'), message: fd.get('message'), turnstile: ts.token() } });
      say(t('form.sent'));
      form.reset();
      track(form.dataset.kind === 'quote' ? 'quote_request' : 'contact_message');
    } catch (err) {
      say(err.code === 'turnstile_failed' ? t('form.turnstile') : t('form.failed', { email: data.quoteEmail }));
      (await ensureWidget()).reset();
    } finally {
      submit.disabled = false;
    }
  });
}

// ---------- Cart badge ----------
function updateBadge() {
  const n = cart.count();
  for (const el of $$('[data-cart-count]')) { el.textContent = n; el.hidden = n === 0; }
  for (const el of $$('[data-cart-count-text]')) el.textContent = n ? ` (${plural('cart.count', n)})` : '';
}
document.addEventListener('nova-cart', updateBadge);
addEventListener('storage', (e) => { if (e.key === 'nova-cart-v1') updateBadge(); });
updateBadge();

// ---------- Mini cart drawer ----------
const drawer = $('#cart-drawer');
export function lineElement(line, { editable = false, onChange } = {}) {
  const opts = optionText(line.options);
  const media = h('div', { class: 'well' }, line.image ? h('img', { src: line.image, alt: '', loading: 'lazy' }) : null);
  const main = h('div', { class: 'cart-line-main' },
    h('p', { class: 'pcard-name' }, line.slug ? h('a', { href: url(`/products/${line.slug}/`), text: line.name }) : line.name),
    h('p', { class: 'label muted', text: [line.variant_id, opts].filter(Boolean).join(' · ') }));
  if (editable) {
    const input = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: line.min_quantity, max: line.max_online_quantity, step: line.quantity_step, value: line.quantity, 'aria-label': t('cart.qty_named', { name: line.name }) });
    const change = (q) => onChange(line, Math.min(Math.max(q, 0), line.max_online_quantity));
    input.addEventListener('change', () => change(Number(input.value) || line.min_quantity));
    const dec = h('button', { class: 'btn-square', type: 'button', 'aria-label': t('cart.decrease_named', { name: line.name }), onclick: () => change(line.quantity - line.quantity_step < line.min_quantity ? 0 : line.quantity - line.quantity_step) }, svgIcon('minus'));
    const inc = h('button', { class: 'btn-square', type: 'button', 'aria-label': t('cart.increase_named', { name: line.name }), disabled: line.quantity + line.quantity_step > line.max_online_quantity, onclick: () => change(line.quantity + line.quantity_step) }, svgIcon('plus'));
    main.append(h('div', { class: 'cart-line-controls' },
      line.type === 'website' ? null : h('div', { class: 'stepper stepper--sm' }, dec, input, inc),
      h('button', { class: 'link-btn small', type: 'button', 'aria-label': t('cart.remove_named', { name: line.name }), text: t('cart.remove'), onclick: () => onChange(line, 0) })));
  } else {
    main.append(h('p', { class: 'small muted', text: `${line.quantity} × ${money(line.unit_amount)}` }));
  }
  const total = h('p', { class: 'cart-line-total' }, money(line.line_total), editable ? h('span', { class: 'label muted', text: ` ${money(line.unit_amount)} ${t('cart.each')}` }) : null);
  return h('li', { class: 'cart-line' }, media, main, total);
}

async function renderDrawer() {
  const list = $('[data-drawer-lines]', drawer);
  const subtotal = $('[data-drawer-subtotal]', drawer);
  if (!cart.count()) { list.replaceChildren(h('p', { class: 'muted', text: t('cart.empty') })); subtotal.textContent = money(0); return; }
  list.replaceChildren(h('p', { class: 'loading', text: t('cart.updating') }));
  try {
    const priced = await priceCart();
    list.replaceChildren(h('ul', { class: 'cart-lines' }, priced.lines.filter((l) => l.name).map((l) => lineElement(l))));
    subtotal.textContent = money(priced.subtotal, priced.currency);
  } catch {
    list.replaceChildren(h('p', { class: 'notice', text: t('shop.error') }));
  }
}
export function openCartDrawer(trigger) {
  if (!drawer) return;
  openDialog(drawer, trigger);
  renderDrawer();
}
document.addEventListener('nova-cart-added', (e) => openCartDrawer(e.detail?.trigger));

// ---------- Account icon ----------
api('/api/auth/me').then((me) => {
  if (!me.signed_in) return;
  const link = $('[data-account]');
  const menu = $('[data-account-menu]');
  $('[data-account-label]').textContent = t('auth.account');
  link.setAttribute('aria-haspopup', 'true');
  link.setAttribute('aria-expanded', 'false');
  link.setAttribute('role', 'button');
  $('[data-admin-link]').hidden = !me.admin;
  const toggle = (open) => { menu.hidden = !open; link.setAttribute('aria-expanded', String(open)); };
  link.addEventListener('click', (e) => { e.preventDefault(); toggle(menu.hidden); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { toggle(false); link.focus(); } });
  document.addEventListener('click', (e) => { if (!e.target.closest('.account-menu')) toggle(false); });
  $('[data-sign-out]').addEventListener('click', async () => { await api('/api/auth/sign-out', { method: 'POST', body: {} }).catch(() => {}); location.href = url('/'); });
}).catch(() => {});
