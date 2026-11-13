// API route handlers. The server decides prices, shipping and availability; the browser only
// ever sends product ids, variant ids and quantities.
import { site, regionForCountry, enabledRegions, langByCode } from '../config/site.mjs';
import en from '../locales/en.json' with { type: 'json' };
import { HttpError, json, rpc, readJson, requireSameOrigin, rateLimit, verifyTurnstile, clientIp, getCookie, setCookie, isProduction, siteUrl, isEmail, clip } from './lib.js';
import { providers, providerFor } from './payments/index.js';
import { sendEmail } from './email.js';
import { afterSignIn, providerFlags } from './account.js';
import { handlePlanEvent, orderEmail, setupLink } from './fulfilment.js';

// ---------- Shop state and regions ----------
// SHOP_LIVE=false keeps production closed: the cart shows "Shop opening soon" and no payment
// session can be created. Staging and local development accept test-mode keys only.
export function shopState(env) {
  const configured = providers.stripe.isConfigured(env);
  if (isProduction(env)) return { enabled: env.SHOP_LIVE === 'true' && configured, reason: 'soon' };
  if (!configured) return { enabled: false, reason: 'not_configured' };
  if (!providers.stripe.isTestMode(env)) return { enabled: false, reason: 'live_key_outside_production' };
  return { enabled: true };
}

// A region is sold to only when it is enabled in config AND its payment provider is configured.
export const sellableRegions = (env) => enabledRegions().filter((r) => providerFor(r).isConfigured(env));
const sellableRegion = (env, country) => {
  const region = regionForCountry(country);
  return region && sellableRegions(env).some((r) => r.id === region.id) ? region : null;
};

export const pickLang = (value) => langByCode(typeof value === 'string' ? value : site.defaultLang).code;

function cleanItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) throw new HttpError(400, 'invalid_cart');
  return items.map((i) => {
    const quantity = Number(i?.quantity);
    if (typeof i?.product_id !== 'string' || typeof i?.variant_id !== 'string' || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new HttpError(400, 'invalid_cart');
    // Only these three fields are read. Anything else the browser sends (a price, a total) is ignored.
    return { product_id: i.product_id.slice(0, 80), variant_id: i.variant_id.slice(0, 80), quantity };
  });
}

const publicLine = (l) => ({
  product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity, status: l.status, name: l.name, slug: l.slug, type: l.type,
  options: l.options, image: l.image, unit_amount: l.unit_amount, line_total: l.line_total,
  min_quantity: l.min_quantity, quantity_step: l.quantity_step, max_online_quantity: l.max_online_quantity,
  left: ['insufficient_stock', 'out_of_stock'].includes(l.status) ? l.available : undefined
});

// ---------- Public config and catalogue ----------
export async function getConfig(request, env) {
  const state = shopState(env);
  return json({
    checkout_enabled: state.enabled,
    turnstile_site_key: env.TURNSTILE_SITE_KEY || '',
    regions: sellableRegions(env).map((r) => ({ id: r.id, currency: r.currency, countries: r.countries, shipping: r.shipping }))
  });
}

export async function getProducts(request, env) {
  const id = new URL(request.url).searchParams.get('id');
  const rows = await rpc(env, 'api_catalog', { id: id || null, currency: 'EUR' });
  const products = rows.map((p) => ({
    id: p.id, slug: p.slug, type: p.type, price_breaks: p.price_breaks,
    min_quantity: p.min_quantity, quantity_step: p.quantity_step, max_online_quantity: p.max_online_quantity,
    variants: p.variants.map((v) => {
      if (v.available === null) return { id: v.id, state: 'available' };
      if (v.available <= 0) return { id: v.id, state: 'out', left: 0 };
      if (p.low_stock_threshold != null && v.available <= p.low_stock_threshold) return { id: v.id, state: 'low', left: v.available };
      return { id: v.id, state: 'in' };
    })
  }));
  return json({ products }, 200, { 'Cache-Control': 'public, max-age=15' });
}

// ---------- Cart ----------
export async function priceCart(request, env) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  const items = cleanItems(body.items);
  const country = typeof body.country === 'string' ? body.country.toUpperCase().slice(0, 2) : null;
  const region = country ? sellableRegion(env, country) : null;
  const cart = await rpc(env, 'api_price_cart', { items, lang: pickLang(body.lang), currency: region?.currency || 'EUR', region: region?.id || null });
  const shipping = region && cart.has_physical ? region.shipping : null;
  return json({
    lines: cart.lines.map(publicLine), subtotal: cart.subtotal, currency: cart.currency, ok: cart.ok,
    has_physical: cart.has_physical, has_website: cart.has_website,
    region_ok: country ? Boolean(region) : null,
    shipping: shipping ? { amount: shipping.amount, min_days: shipping.minDays, max_days: shipping.maxDays } : null,
    total: cart.subtotal + (shipping ? shipping.amount : 0),
    checkout_enabled: shopState(env).enabled
  });
}

// ---------- Checkout ----------
export async function startCheckout(request, env) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  if (!shopState(env).enabled) throw new HttpError(403, 'shop_closed');
  await rateLimit(env, `checkout:${clientIp(request)}`, 10, 600);
  await verifyTurnstile(env, body.turnstile, request);

  const items = cleanItems(body.items);
  const lang = pickLang(body.lang);
  const country = typeof body.country === 'string' ? body.country.toUpperCase().slice(0, 2) : '';
  const region = sellableRegion(env, country);
  if (!region) throw new HttpError(400, 'region_unavailable');
  const provider = providerFor(region);

  const preview = await rpc(env, 'api_price_cart', { items, lang, currency: region.currency, region: region.id });
  if (!preview.ok) throw new HttpError(409, 'cart_invalid', { cart: { lines: preview.lines.map(publicLine) } });
  if (preview.has_website && body.waiver !== true) throw new HttpError(400, 'waiver_required');

  const session = await getSession(request, env).catch(() => null);
  const shipping = preview.has_physical ? region.shipping : { amount: 0, minDays: 0, maxDays: 0 };
  const created = await rpc(env, 'api_create_order', {
    items, lang, currency: region.currency, region: region.id, country, payment_provider: provider.id,
    shipping_amount: shipping.amount, marketing_consent: body.marketing === true, waiver: body.waiver === true,
    email: session?.user?.email || null, customer_id: session?.user?.id || null,
    reservation_minutes: site.checkout.reservationMinutes, order_prefix: site.checkout.orderPrefix
  });
  if (created.error) throw new HttpError(409, 'cart_invalid', { cart: { lines: created.cart.lines.map(publicLine) } });

  const { order, cart } = created;
  const base = siteUrl(env, request);
  const prefix = langByCode(lang).prefix;
  try {
    const checkout = await provider.createCheckout(env, {
      order, cart, region: region.id, shipping, countries: region.countries, locale: lang, email: session?.user?.email || null,
      expiresAt: Math.floor(Date.now() / 1000) + site.checkout.sessionMinutes * 60 + 5,
      labels: { shipping: en.cart.shipping },
      urls: { success: `${base}${prefix}/checkout/success/?session_id={CHECKOUT_SESSION_ID}`, cancel: `${base}${prefix}/checkout/cancelled/` }
    });
    await rpc(env, 'api_attach_session', { order_id: order.id, session_id: checkout.sessionId });
    return json({ url: checkout.url, order_number: order.number });
  } catch (e) {
    // The payment page could not be created: release the stock straight away.
    await rpc(env, 'api_cancel_order', { order_id: order.id, actor: 'system', note: 'Payment session could not be created' }).catch(() => {});
    throw e;
  }
}

// The success page reads the result here. It never creates or marks an order.
export async function getCheckoutSession(request, env) {
  const sessionId = new URL(request.url).searchParams.get('session_id') || '';
  if (!/^[A-Za-z0-9_]{10,200}$/.test(sessionId)) throw new HttpError(400, 'invalid_session');
  await rateLimit(env, `session:${clientIp(request)}`, 120, 600);
  const order = await rpc(env, 'api_get_order', { session_id: sessionId });
  if (!order) throw new HttpError(404, 'not_found');
  let payment = null;
  if (order.status === 'pending') {
    const st = await providers[order.payment_provider].getStatus(env, sessionId).catch(() => null);
    if (st?.status === 'complete' && st.paymentStatus === 'unpaid') payment = 'processing';
  }
  return json({
    number: order.number, status: order.status, payment, email: order.email, total: order.total, currency: order.currency,
    has_website: order.items.some((i) => i.product_type === 'website'),
    items: order.items.map((i) => ({ name: i.name, options: i.options, quantity: i.quantity, line_total: i.line_total }))
  });
}

// ---------- Paid orders and their emails ----------
export const alertAdmin = (env, request, title, details) =>
  sendEmail(env, { template: 'problem_alert', to: site.emails.orders, box: 'orders', data: { title, details, siteUrl: siteUrl(env, request) } });

async function markPaid(env, request, ctx, session) {
  const orderId = session.metadata?.order_id || session.client_reference_id;
  if (!orderId) throw new Error('session has no order id');
  const details = session.customer_details || {};
  const shipping = session.shipping_details || session.collected_information?.shipping_details || null;
  let invoiceUrl = null;
  if (session.invoice) invoiceUrl = await providers.stripe.getInvoiceUrl(env, session.invoice).catch(() => null);
  const result = await rpc(env, 'api_mark_paid', {
    order_id: orderId, actor: 'stripe', email: details.email || null, name: details.name || null,
    payment_id: session.payment_intent || null, customer_id: typeof session.customer === 'string' ? session.customer : null,
    invoice_url: invoiceUrl, subtotal: session.amount_subtotal, shipping_amount: session.total_details?.amount_shipping ?? null,
    tax_amount: session.total_details?.amount_tax ?? null, total: session.amount_total,
    shipping_address: shipping ? { name: shipping.name, ...(shipping.address || {}) } : null,
    billing_address: details.address ? { name: details.name, ...details.address } : null,
    vat_id: details.tax_ids?.[0]?.value || null, marketing_consent: session.consent?.promotions === 'opt_in'
  });
  if (result.error) throw new Error(`order ${orderId}: ${result.error}`);
  if (result.already) return;

  const order = result.order;
  const base = siteUrl(env, request);
  ctx.waitUntil((async () => {
    if (order.email) await sendEmail(env, { template: 'order_confirmation', to: order.email, box: 'orders', lang: order.language, orderId: order.id, data: { order, siteUrl: base } });
    await sendEmail(env, { template: 'new_order_alert', to: site.emails.orders, box: 'orders', orderId: order.id, data: { order, siteUrl: base } });
    if (order.email && order.invoice_url) await orderEmail(env, request, 'invoice', order, { url: order.invoice_url, box: 'invoices' });
    if (order.status === 'awaiting_details' && env.LINK_SIGNING_SECRET) await orderEmail(env, request, 'setup_request', order, { url: await setupLink(env, request, order) });
    if (result.low_stock.length) await sendEmail(env, { template: 'low_stock_alert', to: site.emails.orders, box: 'orders', data: { items: result.low_stock, siteUrl: base } });
    if (result.oversold.length) await alertAdmin(env, request, `Order ${order.number} sold more than was in stock`, result.oversold);
    if (result.was_cancelled) await alertAdmin(env, request, `Order ${order.number} was paid after its checkout had expired`, { order: order.number });
  })());
}

export async function stripeWebhook(request, env, ctx) {
  // The signature is checked against the raw body. Anything unverified is rejected.
  const event = await providers.stripe.verifyWebhook(env, request);
  if (!event?.id || !event.type) return json({ error: 'invalid_signature' }, 400);

  const begin = await rpc(env, 'api_webhook_begin', { provider: 'stripe', event_id: event.id, type: event.type });
  if (!begin.fresh) return json({ received: true, duplicate: true });

  const obj = event.data?.object || {};
  const orderRef = obj.metadata?.order_id || obj.client_reference_id;
  try {
    if (await handlePlanEvent(env, request, ctx, event)) {
      await rpc(env, 'api_webhook_done', { provider: 'stripe', event_id: event.id });
      return json({ received: true });
    }
    switch (event.type) {
      case 'checkout.session.completed':
        if (['paid', 'no_payment_required'].includes(obj.payment_status)) await markPaid(env, request, ctx, obj);
        else {
          const held = await rpc(env, 'api_hold_for_async', { order_id: orderRef, email: obj.customer_details?.email || null, days: site.checkout.asyncReservationDays });
          ctx.waitUntil(orderEmail(env, request, 'payment_pending', held.order));
        }
        break;
      case 'checkout.session.async_payment_succeeded':
        await markPaid(env, request, ctx, obj);
        break;
      case 'checkout.session.async_payment_failed':
        {
          const failed = await rpc(env, 'api_cancel_order', { order_id: orderRef, actor: 'stripe', note: 'Delayed payment failed' });
          if (failed.changed) ctx.waitUntil(orderEmail(env, request, 'payment_failed', failed.order, { url: `${siteUrl(env, request)}${langByCode(failed.order.language).prefix}/cart/` }));
        }
        break;
      case 'checkout.session.expired':
        await rpc(env, 'api_cancel_order', { order_id: orderRef, actor: 'stripe', note: 'Checkout session expired' });
        // Kept for the two abandoned-cart emails, which go out only with the buyer's consent.
        if (obj.after_expiration?.recovery?.url) await rpc(env, 'api_set_recovery', { order_id: orderRef, recovery_url: obj.after_expiration.recovery.url, email: obj.customer_details?.email || null, marketing_consent: obj.consent?.promotions === 'opt_in' });
        break;
      case 'charge.refunded':
        {
          const refund = await rpc(env, 'api_refund', { payment_id: obj.payment_intent, amount_refunded: obj.amount_refunded, actor: 'stripe' });
          if (refund.changed) ctx.waitUntil(orderEmail(env, request, 'refund_issued', refund.order, { vars: { amount: new Intl.NumberFormat('en-GB', { style: 'currency', currency: refund.order.currency }).format(obj.amount_refunded / 100) } }));
        }
        break;
      case 'invoice.paid':
        if (obj.metadata?.order_id && (obj.hosted_invoice_url || obj.invoice_pdf)) {
          const before = await rpc(env, 'api_get_order', { order_id: obj.metadata.order_id });
          await rpc(env, 'api_set_invoice', { order_id: obj.metadata.order_id, invoice_url: obj.hosted_invoice_url || obj.invoice_pdf });
          if (before && !before.invoice_url) ctx.waitUntil(orderEmail(env, request, 'invoice', before, { url: obj.hosted_invoice_url || obj.invoice_pdf, box: 'invoices' }));
        }
        break;
      case 'charge.dispute.created':
        ctx.waitUntil(alertAdmin(env, request, 'A payment was disputed', { dispute: obj.id, charge: obj.charge, amount: obj.amount, reason: obj.reason }));
        break;
      default:
        break; // other event types are acknowledged and ignored
    }
    await rpc(env, 'api_webhook_done', { provider: 'stripe', event_id: event.id });
    return json({ received: true });
  } catch (e) {
    console.error(`webhook ${event.type} ${event.id} failed: ${e.message}`);
    await rpc(env, 'api_webhook_done', { provider: 'stripe', event_id: event.id, error: String(e.message).slice(0, 500) }).catch(() => {});
    ctx.waitUntil(alertAdmin(env, request, `Webhook ${event.type} failed`, { event: event.id, error: e.message }));
    return json({ error: 'processing_failed' }, 500); // Stripe will retry
  }
}

// ---------- Contact, quote and back-in-stock ----------
export async function postContact(request, env) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  await rateLimit(env, `contact:${clientIp(request)}`, 5, 600);
  await verifyTurnstile(env, body.turnstile, request);
  const data = { kind: body.kind === 'quote' ? 'quote' : 'contact', name: clip(body.name, 120), business: clip(body.business, 160), email: clip(body.email, 254), message: clip(body.message, 5000), siteUrl: siteUrl(env, request) };
  if (!data.name || !data.message || !isEmail(data.email)) throw new HttpError(400, 'invalid_form');
  const sent = await sendEmail(env, { template: 'contact_message', to: site.emails.info, box: 'hello', replyTo: data.email, data });
  if (!sent) throw new HttpError(502, 'email_failed');
  return json({ ok: true });
}

export async function postStockAlert(request, env) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  await rateLimit(env, `stock-alert:${clientIp(request)}`, 10, 600);
  if (!isEmail(body.email) || typeof body.variant_id !== 'string') throw new HttpError(400, 'invalid_form');
  await rpc(env, 'api_stock_alert', { variant_id: body.variant_id.slice(0, 80), email: body.email, lang: pickLang(body.lang) });
  return json({ ok: true });
}

// ---------- Sign-in (Supabase Auth, tokens kept in HttpOnly cookies) ----------
const AT = 'nova_at', RT = 'nova_rt';
export const authHeaders = (env, token) => ({ 'Content-Type': 'application/json', apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token || env.SUPABASE_ANON_KEY}` });
export const tokenCookies = (t) => [setCookie(AT, t.access_token, t.expires_in || 3600), setCookie(RT, t.refresh_token, 60 * 60 * 24 * 30)];
export const clearCookies = () => [setCookie(AT, '', 0), setCookie(RT, '', 0)];
export const withCookies = (response, cookies = []) => { cookies.forEach((c) => response.headers.append('Set-Cookie', c)); return response; };

function claim(token, name) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))[name]; } catch { return undefined; }
}

export async function getSession(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  let access = getCookie(request, AT);
  const refresh = getCookie(request, RT);
  let user = null, cookies = [];
  if (access) {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: authHeaders(env, access) });
    if (r.ok) user = await r.json();
  }
  if (!user && refresh) {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: authHeaders(env), body: JSON.stringify({ refresh_token: refresh }) });
    if (r.ok) { const t = await r.json(); access = t.access_token; user = t.user; cookies = tokenCookies(t); }
  }
  if (!user?.id) return null;
  return { user, aal: claim(access, 'aal'), cookies };
}

// Checked on the server on every admin request.
export async function requireAdmin(request, env, { allowPasswordOnly = false } = {}) {
  const session = await getSession(request, env);
  if (!session) throw new HttpError(401, 'sign_in_required');
  const { admin } = await rpc(env, 'api_is_admin', { user_id: session.user.id });
  if (!admin) throw new HttpError(403, 'forbidden');
  if (env.ADMIN_REQUIRE_MFA === 'true' && session.aal !== 'aal2' && !allowPasswordOnly) throw new HttpError(403, 'mfa_required');
  return session;
}

export async function signIn(request, env, ctx) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  await rateLimit(env, `signin:${clientIp(request)}`, 10, 600);
  await verifyTurnstile(env, body.turnstile, request);
  // One generic error for every failure, so the response does not reveal whether an email is registered.
  if (!isEmail(body.email) || typeof body.password !== 'string' || !body.password) throw new HttpError(401, 'invalid_credentials');
  await rateLimit(env, `signin-email:${body.email.toLowerCase()}`, 10, 900);
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: authHeaders(env), body: JSON.stringify({ email: body.email, password: body.password }) });
  if (!r.ok) throw new HttpError(401, 'invalid_credentials');
  const tokens = await r.json();
  await afterSignIn(env, request, ctx, tokens.user, pickLang(body.lang));
  const { admin } = await rpc(env, 'api_is_admin', { user_id: tokens.user.id });
  const needsCode = admin && env.ADMIN_REQUIRE_MFA === 'true';
  return withCookies(json({ ok: true, admin, mfa_required: needsCode, mfa_enrolled: (tokens.user.factors || []).some((f) => f.status === 'verified') }), tokenCookies(tokens));
}

export async function signOut(request, env) {
  requireSameOrigin(request, env);
  const access = getCookie(request, AT);
  if (access && env.SUPABASE_URL) await fetch(`${env.SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: authHeaders(env, access) }).catch(() => {});
  return withCookies(json({ ok: true }), clearCookies());
}

export async function getMe(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ signed_in: false, providers: providerFlags(env) });
  const { admin } = await rpc(env, 'api_is_admin', { user_id: session.user.id });
  return withCookies(json({ signed_in: true, email: session.user.email, admin, verified: Boolean(session.user.email_confirmed_at || session.user.confirmed_at), providers: providerFlags(env) }), session.cookies);
}

// ---------- Admin ----------
export async function adminOrders(request, env) {
  const session = await requireAdmin(request, env);
  const q = new URL(request.url).searchParams;
  const data = await rpc(env, 'api_admin_orders', { q: clip(q.get('q'), 100), status: clip(q.get('status'), 30), limit: 50, offset: Math.max(0, Number(q.get('offset')) || 0) });
  const orders = data.orders.map((o) => ({
    number: o.number, status: o.status, created_at: o.created_at, email: o.email, customer_name: o.customer_name, total: o.total, currency: o.currency,
    shipping_country: o.shipping_country, payment_provider: o.payment_provider, provider_payment_id: o.provider_payment_id,
    items: o.items.map((i) => ({ name: i.name, variant_id: i.variant_id, quantity: i.quantity }))
  }));
  return withCookies(json({ total: data.total, orders }), session.cookies);
}
