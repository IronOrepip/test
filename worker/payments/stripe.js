// Stripe provider. Hosted Checkout only: no card data ever touches this site.
// Uses the REST API directly (no SDK) so the Worker bundle stays small.
import { HttpError, timingSafeEqual } from '../lib.js';

const apiBase = (env) => env.STRIPE_API_BASE || 'https://api.stripe.com';

async function stripe(env, method, path, params, idempotencyKey) {
  const headers = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  if (env.STRIPE_API_VERSION) headers['Stripe-Version'] = env.STRIPE_API_VERSION;
  if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`${apiBase(env)}${path}`, { method, headers, body: params ? params.toString() : undefined });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`stripe ${method} ${path} failed: ${res.status} ${body?.error?.message || ''}`);
    throw new HttpError(502, 'payment_provider_error');
  }
  return body;
}

const optionText = (options) => Object.values(options || {}).join(' / ');

// Builds the Checkout Session parameters. Prices come from the database (cart.lines), never
// from the browser. Payment method types are deliberately not listed: they stay dynamic so
// cards, Apple Pay, Google Pay, Link and others are switched on in the Stripe dashboard.
export function buildSessionParams({ order, cart, region, shipping, countries, urls, locale, expiresAt, email, labels }) {
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  cart.lines.forEach((l, i) => {
    const k = `line_items[${i}]`;
    p.set(`${k}[quantity]`, String(l.quantity));
    p.set(`${k}[price_data][currency]`, cart.currency.toLowerCase());
    p.set(`${k}[price_data][unit_amount]`, String(l.unit_amount));
    p.set(`${k}[price_data][tax_behavior]`, 'exclusive');
    p.set(`${k}[price_data][product_data][name]`, optionText(l.options) ? `${l.name} (${optionText(l.options)})` : l.name);
    p.set(`${k}[price_data][product_data][metadata][sku]`, l.variant_id);
    if (l.tax_code) p.set(`${k}[price_data][product_data][tax_code]`, l.tax_code);
  });
  p.set('automatic_tax[enabled]', 'true');
  p.set('tax_id_collection[enabled]', 'true');
  p.set('billing_address_collection', 'required');
  if (cart.has_physical) {
    countries.forEach((c, i) => p.set(`shipping_address_collection[allowed_countries][${i}]`, c));
    const s = 'shipping_options[0][shipping_rate_data]';
    p.set(`${s}[type]`, 'fixed_amount');
    p.set(`${s}[display_name]`, labels.shipping);
    p.set(`${s}[fixed_amount][amount]`, String(shipping.amount));
    p.set(`${s}[fixed_amount][currency]`, cart.currency.toLowerCase());
    p.set(`${s}[tax_behavior]`, 'exclusive');
    p.set(`${s}[delivery_estimate][minimum][unit]`, 'business_day');
    p.set(`${s}[delivery_estimate][minimum][value]`, String(shipping.minDays));
    p.set(`${s}[delivery_estimate][maximum][unit]`, 'business_day');
    p.set(`${s}[delivery_estimate][maximum][value]`, String(shipping.maxDays));
  }
  if (email) p.set('customer_email', email);
  p.set('allow_promotion_codes', 'true');
  p.set('consent_collection[terms_of_service]', 'required');
  p.set('invoice_creation[enabled]', 'true');
  p.set('invoice_creation[invoice_data][metadata][order_id]', order.id);
  p.set('invoice_creation[invoice_data][metadata][order_number]', order.number);
  p.set('client_reference_id', order.id);
  p.set('metadata[order_id]', order.id);
  p.set('metadata[order_number]', order.number);
  p.set('metadata[region]', region);
  p.set('payment_intent_data[metadata][order_id]', order.id);
  p.set('payment_intent_data[metadata][order_number]', order.number);
  p.set('expires_at', String(expiresAt));
  // Lets Stripe give us a link to resume this checkout if it expires (used only with consent).
  p.set('after_expiration[recovery][enabled]', 'true');
  p.set('locale', locale);
  p.set('success_url', urls.success);
  p.set('cancel_url', urls.cancel);
  return p;
}

export async function verifySignature(secret, rawBody, header, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.trim().split('=')).filter((kv) => kv.length === 2 && kv[0] === 't').concat());
  const signatures = header.split(',').map((kv) => kv.trim()).filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  const t = Number(parts.t);
  if (!t || !signatures.length || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return signatures.some((s) => timingSafeEqual(s, expected));
}

export const stripeProvider = {
  id: 'stripe',
  isConfigured: (env) => Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
  isTestMode: (env) => String(env.STRIPE_SECRET_KEY || '').startsWith('sk_test_'),

  async createCheckout(env, args) {
    const session = await stripe(env, 'POST', '/v1/checkout/sessions', buildSessionParams(args), `checkout-${args.order.id}`);
    return { sessionId: session.id, url: session.url };
  },

  // Returns the verified event, or null when the signature does not match the raw body.
  async verifyWebhook(env, request) {
    const raw = await request.text();
    const ok = await verifySignature(env.STRIPE_WEBHOOK_SECRET, raw, request.headers.get('Stripe-Signature'));
    if (!ok) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },

  async getStatus(env, sessionId) {
    const s = await stripe(env, 'GET', `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
    return { status: s.status, paymentStatus: s.payment_status, orderId: s.metadata?.order_id || s.client_reference_id };
  },

  async getInvoiceUrl(env, invoiceId) {
    const inv = await stripe(env, 'GET', `/v1/invoices/${encodeURIComponent(invoiceId)}`);
    return inv.hosted_invoice_url || inv.invoice_pdf || null;
  },

  // Refunds are normally made in the Stripe dashboard; the webhook updates the order.
  async refund(env, paymentId, amount) {
    const p = new URLSearchParams({ payment_intent: paymentId });
    if (amount) p.set('amount', String(amount));
    return stripe(env, 'POST', '/v1/refunds', p);
  }
};
