// Email templates and sending. One shared HTML layout, each email with a plain-text version.
// Email clients do not support CSS variables or web fonts, so the colours below repeat the
// DESIGN.md palette as literal values with an Arial / monospace fallback stack.
import en from '../locales/en.json' with { type: 'json' };
import it from '../locales/it.json' with { type: 'json' };
import { site } from '../config/site.mjs';
import { rpc } from './lib.js';

const locales = { en, it };
const INK = '#101418', STEEL = '#5a636d', RULE = '#e3e5e8', ORANGE = '#f2500f', WHITE = '#ffffff';
const SANS = 'Arial, Helvetica, sans-serif';
const MONO = "'Courier New', Courier, monospace";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fill = (s, vars = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
const strings = (lang) => (locales[lang] || locales.en).email;
const money = (cents, currency, lang) => new Intl.NumberFormat(site.languages.find((l) => l.code === lang)?.locale || 'en-GB', { style: 'currency', currency: currency || 'EUR' }).format((cents || 0) / 100);
const label = (text) => `<p style="margin:0 0 4px;font:bold 12px/1.4 ${MONO};letter-spacing:1px;text-transform:uppercase;color:${STEEL}">${esc(text)}</p>`;
const para = (text) => `<p style="margin:0 0 16px;font:16px/24px ${SANS};color:${INK}">${esc(text)}</p>`;
const rule = `<tr><td style="border-top:1px solid ${RULE};font-size:0;line-height:0;height:1px">&nbsp;</td></tr>`;

function layout({ siteUrl, lang, heading, bodyHtml, button }) {
  const s = strings(lang);
  // One orange button per email, Ink text, 4px corners. Padding-based so it also works in Outlook.
  const btn = button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td bgcolor="${ORANGE}" style="border-radius:4px"><a href="${esc(button.url)}" style="display:inline-block;padding:14px 24px;font:bold 16px/20px ${SANS};color:${INK};text-decoration:none">${esc(button.label)}</a></td></tr></table>` : '';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:${WHITE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${WHITE}"><tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
<tr><td style="padding:0 0 24px"><img src="${siteUrl}/assets/brand/nova-logo-ink@2x.png" width="134" height="39" alt="NOVA" style="display:block;border:0"></td></tr>
${rule}
<tr><td style="padding:32px 0 8px"><h1 style="margin:0 0 16px;font:bold 28px/1.15 'Arial Narrow', ${SANS};text-transform:uppercase;letter-spacing:0.5px;color:${INK}">${esc(heading)}</h1>
${bodyHtml}${btn}</td></tr>
${rule}
<tr><td style="padding:16px 0"><p style="margin:0 0 8px;font:14px/20px ${SANS};color:${STEEL}">${esc(s.footer_help)}</p>
<p style="margin:0;font:12px/1.5 ${MONO};color:${STEEL}">${esc(site.company.legalName)} · ${esc(site.company.address)} · ${esc(site.company.vatNumber)}</p></td></tr>
</table></td></tr></table></body></html>`;
}

function itemsTable(order, lang) {
  const s = strings(lang).labels;
  const cell = `padding:8px 0;border-bottom:1px solid ${RULE};font:14px/20px ${SANS};color:${INK};vertical-align:top`;
  const num = `padding:8px 0 8px 12px;border-bottom:1px solid ${RULE};font:14px/20px ${MONO};color:${INK};text-align:right;white-space:nowrap;vertical-align:top`;
  const rows = order.items.map((i) => {
    const opts = Object.values(i.options || {}).join(' / ');
    return `<tr><td style="${cell}">${esc(i.name)}${opts ? ` (${esc(opts)})` : ''}<br><span style="font:12px/1.4 ${MONO};color:${STEEL}">${esc(i.variant_id)}</span></td><td style="${num}">${i.quantity} × ${money(i.unit_amount, order.currency, lang)}</td><td style="${num}">${money(i.line_total, order.currency, lang)}</td></tr>`;
  }).join('');
  const total = (name, value, bold) => `<tr><td colspan="2" style="padding:6px 0;font:${bold ? 'bold ' : ''}14px/20px ${SANS};color:${INK}">${esc(name)}</td><td style="padding:6px 0 6px 12px;font:${bold ? 'bold ' : ''}14px/20px ${MONO};color:${INK};text-align:right">${money(value, order.currency, lang)}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-top:1px solid ${RULE}">${rows}
${total(s.subtotal, order.subtotal)}${total(s.shipping, order.shipping_amount)}${total(s.tax, order.tax_amount)}${total(s.total, order.total, true)}</table>`;
}

function itemsText(order, lang) {
  const s = strings(lang).labels;
  const lines = order.items.map((i) => `- ${i.name}${Object.values(i.options || {}).length ? ` (${Object.values(i.options).join(' / ')})` : ''} [${i.variant_id}]: ${i.quantity} x ${money(i.unit_amount, order.currency, lang)} = ${money(i.line_total, order.currency, lang)}`);
  return [...lines, '', `${s.subtotal}: ${money(order.subtotal, order.currency, lang)}`, `${s.shipping}: ${money(order.shipping_amount, order.currency, lang)}`, `${s.tax}: ${money(order.tax_amount, order.currency, lang)}`, `${s.total}: ${money(order.total, order.currency, lang)}`].join('\n');
}

function addressLines(a) {
  if (!a) return [];
  const ad = a.address || a;
  return [a.name, ad.line1, ad.line2, [ad.postal_code, ad.city].filter(Boolean).join(' '), ad.state, ad.country].filter(Boolean);
}

const kv = (pairs) => pairs.filter(([, v]) => v).map(([k, v]) => `${label(k)}${para(v)}`).join('');
const kvText = (pairs) => pairs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');

// Each template returns { subject, heading, html, text }.
export const templates = {
  order_confirmation({ order, siteUrl }, lang) {
    const s = strings(lang), t = s.order_confirmation;
    const hasWebsite = order.items.some((i) => i.product_type === 'website');
    const hasGoods = order.items.some((i) => i.product_type !== 'website');
    const next = [hasGoods && t.next_goods, hasWebsite && t.next_website].filter(Boolean);
    const ship = addressLines(order.shipping_address);
    const bodyHtml = para(fill(t.intro, { number: order.number })) + label(`${s.labels.order} ${order.number}`) + itemsTable(order, lang) +
      (ship.length ? label(s.labels.ship_to) + para(ship.join(', ')) : '') + next.map(para).join('') + (hasGoods ? para(t.returns) : '');
    const text = [fill(t.intro, { number: order.number }), '', itemsText(order, lang), '', ship.length ? `${s.labels.ship_to}: ${ship.join(', ')}` : '', ...next, hasGoods ? t.returns : '', order.invoice_url ? `${t.invoice_button}: ${order.invoice_url}` : '', '', s.footer_help].filter((x) => x !== false).join('\n');
    return { subject: fill(t.subject, { number: order.number }), heading: t.heading, text,
      html: layout({ siteUrl, lang, heading: t.heading, bodyHtml, button: order.invoice_url ? { url: order.invoice_url, label: t.invoice_button } : null }) };
  },

  new_order_alert({ order, siteUrl }, lang) {
    const s = strings(lang), t = s.new_order_alert;
    const pairs = [[s.labels.customer, [order.customer_name, order.email].filter(Boolean).join(', ')], [s.labels.status, order.status], [s.labels.ship_to, addressLines(order.shipping_address).join(', ')], ['VAT ID', order.vat_id]];
    const subject = fill(t.subject, { number: order.number, total: money(order.total, order.currency, lang) });
    return { subject, heading: t.heading,
      html: layout({ siteUrl, lang, heading: t.heading, bodyHtml: para(fill(t.intro, { number: order.number })) + itemsTable(order, lang) + kv(pairs) }),
      text: [fill(t.intro, { number: order.number }), '', itemsText(order, lang), '', kvText(pairs)].join('\n') };
  },

  problem_alert({ title, details, siteUrl }, lang) {
    const s = strings(lang), t = s.problem_alert;
    const detailText = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
    return { subject: fill(t.subject, { title }), heading: t.heading,
      html: layout({ siteUrl, lang, heading: t.heading, bodyHtml: para(t.intro) + label(title) + `<pre style="margin:0 0 16px;padding:12px;border:1px solid ${RULE};font:13px/1.5 ${MONO};color:${INK};white-space:pre-wrap;word-break:break-word">${esc(detailText)}</pre>` }),
      text: [t.intro, '', title, detailText].join('\n') };
  },

  low_stock_alert({ items, siteUrl }, lang) {
    const s = strings(lang), t = s.low_stock_alert;
    const lines = items.map((i) => `${i.variant_id}: ${i.stock} (threshold ${i.threshold})`);
    return { subject: fill(t.subject, { sku: items.map((i) => i.variant_id).join(', ') }), heading: t.heading,
      html: layout({ siteUrl, lang, heading: t.heading, bodyHtml: para(t.intro) + lines.map((l) => `<p style="margin:0 0 8px;font:14px/20px ${MONO};color:${INK}">${esc(l)}</p>`).join('') }),
      text: [t.intro, '', ...lines].join('\n') };
  },

  contact_message({ kind, name, business, email, message, siteUrl }, lang) {
    const s = strings(lang), t = s.contact_message;
    const heading = kind === 'quote' ? t.heading_quote : t.heading_contact;
    const pairs = [[s.labels.from, [name, business].filter(Boolean).join(', ')], ['Email', email], [s.labels.message, message]];
    return { subject: fill(kind === 'quote' ? t.subject_quote : t.subject_contact, { name }), heading,
      html: layout({ siteUrl, lang, heading, bodyHtml: kv(pairs) }), text: kvText(pairs) };
  }
};

// ---------- Simple emails: subject, heading, a few lines and one button, all from the locale file ----------
// email.<name> = { subject, heading, body: [lines], button }. Lines may use {placeholders}.
// Marketing emails pass unsubscribeUrl and then always carry a one-click unsubscribe link.
export const SIMPLE = ['confirm_email', 'magic_link', 'reset_password', 'account_changed', 'welcome', 'payment_pending', 'payment_failed',
  'setup_request', 'setup_reminder', 'ready_for_review', 'back_in_stock', 'shipped', 'delivered_review', 'refund_issued', 'order_cancelled',
  'invoice', 'plan_renewed', 'plan_payment_failed', 'plan_cancelled', 'newsletter_confirm', 'cart_reminder'];
for (const name of SIMPLE) {
  templates[name] = ({ vars = {}, url = null, order = null, unsubscribeUrl = null, siteUrl }, lang) => {
    const s = strings(lang), t = s[name];
    const lines = t.body.map((l) => fill(l, vars));
    const unsub = unsubscribeUrl ? `<p style="margin:0 0 16px;font:12px/1.5 ${SANS};color:${STEEL}">${esc(s.unsubscribe_text)} <a href="${esc(unsubscribeUrl)}" style="color:${INK}">${esc(s.unsubscribe_link)}</a></p>` : '';
    const bodyHtml = lines.map(para).join('') + (order ? label(`${s.labels.order} ${order.number}`) + itemsTable(order, lang) : '') + unsub;
    return {
      subject: fill(t.subject, vars), heading: fill(t.heading, vars),
      html: layout({ siteUrl, lang, heading: fill(t.heading, vars), bodyHtml, button: url ? { url, label: t.button } : null }),
      text: [...lines, order ? `\n${itemsText(order, lang)}` : '', url ? `\n${t.button}: ${url}` : '', unsubscribeUrl ? `\n${s.unsubscribe_text} ${unsubscribeUrl}` : '', '', s.footer_help].filter(Boolean).join('\n')
    };
  };
}

const FROM = { orders: 'orders', invoices: 'invoices', hello: 'hello' };

async function deliver(env, mail) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
  const res = await fetch(`${env.RESEND_API_BASE || 'https://api.resend.com'}/emails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(mail)
  });
  if (!res.ok) throw new Error(`email provider ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).id;
}

// Sends one email and records it in email_log. Never throws: a failed email must not fail a webhook.
// box: which Microsoft 365 address replies go to ('orders', 'invoices', 'hello').
export async function sendEmail(env, { template, to, box = 'orders', lang = 'en', orderId = null, data, logId = null, replyTo = null }) {
  const payload = { template, to, box, lang, data, replyTo };
  let id = logId;
  try {
    if (!id) id = (await rpc(env, 'api_email_log', { order_id: orderId, template, to_email: to, language: lang, payload })).id;
    const rendered = templates[template](data, lang);
    const mail = {
      from: `NOVA <${FROM[box]}@${site.emails.sendingDomain}>`, to: [to], reply_to: replyTo || site.emails[box],
      subject: rendered.subject, html: rendered.html, text: rendered.text
    };
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const providerId = await deliver(env, mail);
        await rpc(env, 'api_email_log', { id, status: 'sent', provider_id: providerId });
        return true;
      } catch (e) {
        lastError = e;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw lastError;
  } catch (e) {
    console.error(`email ${template} to ${to} failed: ${e.message}`);
    if (id) await rpc(env, 'api_email_log', { id, status: 'failed', error: String(e.message).slice(0, 500) }).catch(() => {});
    return false;
  }
}

// Called by the scheduled trigger: tries failed emails again (up to 5 attempts each).
export async function retryFailedEmails(env) {
  const rows = await rpc(env, 'api_email_retry_list', {});
  for (const row of rows) {
    const p = row.payload;
    if (p?.template && templates[p.template]) await sendEmail(env, { ...p, orderId: row.order_id, logId: row.id });
  }
  return rows.length;
}
