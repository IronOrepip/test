// Success page: shows the result of a checkout. It only reads; the order is marked paid
// by the verified payment webhook, never by this page.
import { t, money, h, api, cart, optionText, track } from './core.js';

const title = document.querySelector('[data-success-title]');
const text = document.querySelector('[data-success-text]');
const detail = document.querySelector('[data-success-detail]');
const sessionId = new URLSearchParams(location.search).get('session_id');
const set = (key, vars) => { title.textContent = t(`success.${key}_title`); text.textContent = t(`success.${key}_text`, vars); document.title = title.textContent; };

function showOrder(order) {
  detail.hidden = false;
  detail.querySelector('[data-order-number]').textContent = order.number;
  detail.querySelector('[data-order-status]').textContent = t(`status.${order.status}`);
  detail.querySelector('[data-order-email]').textContent = order.email || '';
  detail.querySelector('[data-order-total]').textContent = money(order.total, order.currency);
  detail.querySelector('[data-website-note]').hidden = !order.has_website;
  detail.querySelector('[data-order-items]').replaceChildren(...order.items.map((i) =>
    h('li', { class: 'row row--between' }, h('span', { text: `${i.quantity} × ${i.name}${optionText(i.options) ? ` (${optionText(i.options)})` : ''}` }), h('span', { class: 'mono', text: money(i.line_total, order.currency) }))));
}

async function poll(attempt = 0) {
  let order;
  try {
    order = await api(`/api/checkout/session?session_id=${encodeURIComponent(sessionId)}`);
  } catch (err) {
    if (err.status === 404 || err.status === 400) { set('missing'); return; }
    order = null;
  }
  if (order && !['pending', 'cancelled'].includes(order.status)) {
    set('paid', { number: order.number });
    showOrder(order);
    cart.clear();
    track('purchase', { transaction_id: order.number, value: order.total / 100, currency: order.currency });
    title.focus();
    return;
  }
  if (order?.status === 'cancelled') { set('cancelled', { number: order.number }); return; }
  if (order?.payment === 'processing') { set('pending', { number: order.number }); showOrder(order); cart.clear(); return; }
  if (attempt >= 15) { set('timeout'); return; } // about 30 seconds
  setTimeout(() => poll(attempt + 1), 2000);
}

if (sessionId) poll(); else set('missing');
