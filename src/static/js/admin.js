// Admin order list. Access is decided by the server on every request; this page only shows the result.
import { data, t, plural, money, h, api } from './core.js';

const root = document.querySelector('[data-admin]');
const gate = root.querySelector('[data-admin-gate]');
const content = root.querySelector('[data-admin-content]');
const rows = root.querySelector('[data-admin-rows]');
const count = root.querySelector('[data-admin-count]');
const form = root.querySelector('[data-admin-filters]');
const date = new Intl.DateTimeFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' });

function deny(message, showSignIn) {
  gate.hidden = false;
  gate.querySelector('span').textContent = message;
  content.hidden = true;
  root.querySelector('[data-admin-signin]').hidden = !showSignIn;
}

async function load() {
  const params = new URLSearchParams(new FormData(form));
  try {
    const out = await api(`/api/admin/orders?${params}`);
    gate.hidden = true;
    content.hidden = false;
    count.textContent = out.total ? plural('admin.count', out.total) : t('admin.none');
    rows.replaceChildren(...out.orders.map((o) => h('tr', {},
      h('th', { scope: 'row', class: 'num', text: o.number }),
      h('td', { text: date.format(new Date(o.created_at)) }),
      h('td', {}, h('span', { class: `status${['pending', 'cancelled'].includes(o.status) ? ' status--steel' : ''}`, text: t(`status.${o.status}`) })),
      h('td', { text: [o.customer_name, o.email || t('admin.guest'), o.shipping_country].filter(Boolean).join(' · ') }),
      h('td', { text: o.items.map((i) => `${i.quantity} × ${i.variant_id}`).join(', ') }),
      h('td', { text: money(o.total, o.currency) }),
      h('td', {}, o.provider_payment_id && o.payment_provider === 'stripe'
        ? h('a', { href: `https://dashboard.stripe.com/payments/${encodeURIComponent(o.provider_payment_id)}`, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${t('admin.open_payment')}: ${o.number}`, text: 'Stripe' })
        : h('span', { class: 'muted', text: o.payment_provider }))
    )));
  } catch (err) {
    if (err.status === 401) deny(t('admin.signin'), true);
    else if (err.status === 403) deny(t('admin.denied'), false);
    else deny(t('admin.error'), false);
  }
}

form.addEventListener('submit', (e) => { e.preventDefault(); load(); });
load();
