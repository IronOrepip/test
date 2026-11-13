// Product page: option and quantity selectors, live price table, stock state, add to cart.
import { data, t, money, api, cart, track } from './core.js';

const p = data.product;
const form = document.querySelector('[data-buy]');
const $ = (sel) => form.querySelector(sel) || document.querySelector(sel);
const qtyInput = form.elements.quantity;
const addBtn = $('[data-add]');
const reason = $('[data-add-reason]');
const stockEl = document.querySelector('[data-stock]');
const table = document.querySelector('[data-break-table] tbody');
let breaks = p.breaks;
let stock = null; // variant id -> { state, left }

const variantId = () => new FormData(form).get('variant');
const quantity = () => Math.floor(Number(qtyInput.value)) || 0;
const breaksFor = (v) => { const own = breaks.filter((b) => b.v === v); return (own.length ? own : breaks.filter((b) => !b.v)).sort((a, b) => a.min - b.min); };
const unitPrice = (v, q) => breaksFor(v).filter((b) => b.min <= Math.max(q, p.min)).pop()?.amount ?? null;

function disabledReason(v, q) {
  const s = stock?.[v];
  if (s?.state === 'out') return t('product.reason_out');
  if (q > p.max) return t('product.reason_max', { max: p.max });
  if (q < p.min) return t('product.reason_min', { min: p.min });
  if ((q - p.min) % p.step !== 0) return t('product.reason_step', { step: p.step });
  if (s?.state === 'low' && q > s.left) return t('product.reason_stock', { n: s.left });
  return '';
}

function render() {
  const v = variantId(), q = quantity();
  const unit = unitPrice(v, q);
  document.querySelector('[data-unit-price]').textContent = unit == null ? '' : money(unit);
  document.querySelector('[data-line-total]').textContent = unit == null ? '' : money(unit * Math.max(q, 0));
  document.querySelector('[data-sku]').textContent = v;

  if (table) {
    const rows = breaksFor(v);
    const active = rows.filter((b) => b.min <= q).pop();
    table.replaceChildren(...rows.map((b) => {
      const tr = document.createElement('tr');
      if (b === active) tr.setAttribute('aria-current', 'true');
      const th = Object.assign(document.createElement('th'), { scope: 'row', className: 'num', textContent: `${b.min}+` });
      const td = Object.assign(document.createElement('td'), { textContent: money(b.amount) });
      tr.append(th, td);
      return tr;
    }));
  }

  const s = stock?.[v];
  const label = !stock ? t('stock.unknown') : s?.state === 'out' ? t('stock.out') : s?.state === 'low' ? t('stock.only_left', { n: s.left }) : s?.state === 'available' ? t('stock.available') : t('stock.in_stock');
  stockEl.textContent = label;
  stockEl.classList.toggle('status--steel', s?.state === 'out' || !stock);
  stockEl.classList.toggle('status--solid', s?.state === 'low');

  const why = disabledReason(v, q);
  addBtn.disabled = Boolean(why);
  reason.hidden = !why;
  reason.querySelector('span').textContent = why;
  document.querySelector('[data-back-in-stock]').hidden = s?.state !== 'out';

  for (const radio of form.querySelectorAll('input[name="variant"][type="radio"]')) {
    const out = stock?.[radio.value]?.state === 'out';
    radio.closest('.radio-pill').querySelector('span').title = out ? t('stock.out') : '';
  }
}

form.addEventListener('input', render);
form.addEventListener('change', render);
form.querySelector('[data-qty-up]')?.addEventListener('click', () => { qtyInput.value = Math.min(quantity() + p.step, p.max + p.step); render(); });
form.querySelector('[data-qty-down]')?.addEventListener('click', () => { qtyInput.value = Math.max(quantity() - p.step, p.min); render(); });

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = variantId(), q = quantity();
  if (disabledReason(v, q)) { render(); return; }
  if (p.type === 'website' && cart.read().some((i) => i.v === v)) cart.set(v, 1); else cart.add(p.id, v, q);
  track('add_to_cart', { item_id: v, item_name: p.name, quantity: q, value: (unitPrice(v, q) * q) / 100, currency: p.currency });
  document.dispatchEvent(new CustomEvent('nova-cart-added', { detail: { trigger: addBtn } }));
});

// Back in stock opt-in
document.querySelector('[data-bis-submit]')?.addEventListener('click', async () => {
  const email = document.getElementById('bis-email');
  const out = document.querySelector('[data-bis-status]');
  try {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) throw new Error('invalid');
    await api('/api/stock-alert', { method: 'POST', body: { variant_id: variantId(), email: email.value.trim(), lang: data.lang } });
    out.textContent = t('product.bis_ok');
    email.value = '';
  } catch {
    out.textContent = t('product.bis_error');
    email.focus();
  }
});

// Gallery thumbnails
for (const thumb of document.querySelectorAll('[data-gallery-thumb]')) {
  thumb.addEventListener('click', () => {
    const img = document.querySelector('[data-gallery-main] img');
    img.src = thumb.dataset.galleryThumb; img.alt = thumb.dataset.alt;
    document.querySelectorAll('[data-gallery-thumb]').forEach((b) => b.removeAttribute('aria-current'));
    thumb.setAttribute('aria-current', 'true');
  });
}

render();
track('view_item', { item_id: p.id, item_name: p.name });
api(`/api/products?id=${encodeURIComponent(p.id)}`).then(({ products }) => {
  const livep = products[0];
  if (!livep) return;
  breaks = livep.price_breaks.map((b) => ({ v: b.variant_id || null, min: b.min_quantity, amount: b.unit_amount }));
  stock = Object.fromEntries(livep.variants.map((v) => [v.id, v]));
  // Preselect the first option that is in stock.
  const radios = [...form.querySelectorAll('input[name="variant"][type="radio"]')];
  if (radios.length && stock[variantId()]?.state === 'out') { const ok = radios.find((r) => stock[r.value]?.state !== 'out'); if (ok) ok.checked = true; }
  render();
}).catch(render);
