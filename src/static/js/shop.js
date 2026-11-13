// Product cards anywhere on the site: live prices, quick add, and the shop filters and sort.
import { t, plural, money, api, cart, track } from './core.js';

const cards = [...document.querySelectorAll('[data-product-card]')];
const status = document.querySelector('[data-shop-status]');
const say = (msg) => { if (status) { status.hidden = !msg; status.querySelector('span').textContent = msg || ''; } };

// ---------- Live prices and stock ----------
let live = null;
async function loadLive() {
  if (!cards.length) return;
  say(t('shop.loading'));
  try {
    live = Object.fromEntries((await api('/api/products')).products.map((p) => [p.id, p]));
    for (const card of cards) {
      const p = live[card.dataset.id];
      if (!p) continue;
      const base = p.price_breaks.filter((b) => !b.variant_id).map((b) => b.unit_amount);
      if (base.length) {
        const from = Math.min(...base);
        card.dataset.price = from;
        card.querySelector('[data-card-price]').textContent = `${t('product.from')} ${money(from)}`;
      }
      if (p.variants.every((v) => v.state === 'out')) card.querySelector('[data-card-price]').textContent = t('stock.out');
    }
    say('');
  } catch {
    say(t('shop.error'));
  }
}

// ---------- Quick add: the square button adds the first option in stock at the minimum quantity ----------
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-quick-add]');
  if (!btn) return;
  const p = live?.[btn.dataset.quickAdd];
  const variant = p?.variants.find((v) => v.state !== 'out');
  if (!p || !variant || p.variants.length > 1) return; // several options or no live data: open the product page
  e.preventDefault();
  cart.add(p.id, variant.id, p.min_quantity);
  track('add_to_cart', { item_id: variant.id, quantity: p.min_quantity });
  document.dispatchEvent(new CustomEvent('nova-cart-added', { detail: { trigger: btn } }));
});

// ---------- Filters and sort (shop and category pages) ----------
const form = document.querySelector('[data-filters]');
const grid = document.querySelector('[data-product-grid]');
if (form && grid) {
  const empty = document.querySelector('[data-shop-empty]');
  const count = document.querySelector('[data-result-count]');
  const original = [...grid.children];
  const apply = () => {
    const fd = new FormData(form);
    const category = fd.get('category') || '', type = fd.get('type') || '', sort = fd.get('sort');
    const shown = original.filter((c) => (!category || c.dataset.category === category) && (!type || c.dataset.type === type));
    const by = {
      name: (a, b) => a.dataset.name.localeCompare(b.dataset.name),
      'price-asc': (a, b) => a.dataset.price - b.dataset.price,
      'price-desc': (a, b) => b.dataset.price - a.dataset.price
    }[sort];
    if (by) shown.sort(by);
    for (const c of original) c.hidden = !shown.includes(c);
    grid.append(...shown);
    empty.hidden = shown.length > 0;
    count.textContent = plural('shop.results', shown.length);
    const params = new URLSearchParams([...fd].filter(([, v]) => v && v !== 'featured'));
    history.replaceState(null, '', params.size ? `?${params}` : location.pathname);
  };
  const initial = new URLSearchParams(location.search);
  for (const [k, v] of initial) if (form.elements[k]) form.elements[k].value = v;
  form.addEventListener('change', apply);
  form.addEventListener('submit', (e) => e.preventDefault());
  apply();
  track('view_item_list');
}

loadLive().then(() => { if (form) form.dispatchEvent(new Event('change')); });
