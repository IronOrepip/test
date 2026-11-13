// After the sale: the full admin tools, the website set-up and review flow, plans
// (subscriptions through Stripe) and the scheduled email jobs.
import { site, langByCode, regionForCountry } from '../config/site.mjs';
import { HttpError, json, rpc, readJson, requireSameOrigin, rateLimit, clientIp, siteUrl, clip, timingSafeEqual, isEmail } from './lib.js';
import { requireAdmin, withCookies, alertAdmin, pickLang, shopState, sellableRegions, tokenCookies } from './api.js';
import { requireUser } from './account.js';
import { sendEmail, templates } from './email.js';

const base = (env, request) => siteUrl(env, request);
const page = (env, request, lang, path) => `${base(env, request)}${langByCode(lang).prefix}${path}`;

// Sends one of the simple order emails to the buyer, in the order's language.
export function orderEmail(env, request, template, order, { url = null, vars = {}, box = 'orders', withItems = false } = {}) {
  if (!order?.email) return Promise.resolve(false);
  return sendEmail(env, { template, to: order.email, box, lang: order.language, orderId: order.id,
    data: { vars: { number: order.number, ...vars }, url, order: withItems ? order : null, siteUrl: base(env, request) } });
}

// ---------- Signed links (website set-up form) ----------
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function setupLink(env, request, order, days = 30) {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const sig = await hmac(env.LINK_SIGNING_SECRET, `setup.${order.number}.${exp}`);
  return page(env, request, order.language, `/orders/${order.number}/setup/?exp=${exp}&sig=${sig}`);
}
// A set-up request is allowed with a valid, unexpired signed link, or for the signed-in owner.
async function setupAccess(request, env, { number, exp, sig }) {
  if (typeof number !== 'string' || !/^[A-Z]+-\d+$/.test(number)) throw new HttpError(404, 'not_found');
  const data = await rpc(env, 'api_setup', { number, action: 'get' });
  if (data.error) throw new HttpError(404, 'not_found');
  let ok = false;
  if (env.LINK_SIGNING_SECRET && sig && Number(exp) > Date.now() / 1000) ok = timingSafeEqual(String(sig), await hmac(env.LINK_SIGNING_SECRET, `setup.${number}.${Number(exp)}`));
  if (!ok) {
    const session = await requireUser(request, env, { verified: true }).catch(() => null);
    ok = Boolean(session && data.customer_id && session.user.id === data.customer_id);
  }
  if (!ok) throw new HttpError(403, 'link_invalid');
  return data;
}
const setupView = (d) => ({ order: { number: d.order.number, status: d.order.status, preview_url: d.order.preview_url, items: d.order.items.filter((i) => i.type === 'website').map((i) => ({ name: i.name })) },
  fields: d.fields, answers: d.setup?.answers || {}, files: (d.setup?.files || []).map((f) => ({ name: f.name, size: f.size })), submitted_at: d.setup?.submitted_at || null });

export async function getSetup(request, env) {
  await rateLimit(env, `setup:${clientIp(request)}`, 60, 600);
  const q = new URL(request.url).searchParams;
  return json(setupView(await setupAccess(request, env, { number: q.get('number'), exp: q.get('exp'), sig: q.get('sig') })));
}

const UPLOAD_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'application/pdf': 'pdf' };
const UPLOAD_MAX = 10 * 1024 * 1024;

// One file per request, sent as the raw body. Stored in the private "setup" bucket.
export async function uploadSetupFile(request, env) {
  requireSameOrigin(request, env);
  await rateLimit(env, `setup-upload:${clientIp(request)}`, 30, 600);
  const q = new URL(request.url).searchParams;
  const data = await setupAccess(request, env, { number: q.get('number'), exp: q.get('exp'), sig: q.get('sig') });
  if (!['awaiting_details', 'in_setup'].includes(data.order.status)) throw new HttpError(409, 'not_allowed');
  const type = (request.headers.get('Content-Type') || '').split(';')[0];
  if (!UPLOAD_TYPES[type]) throw new HttpError(415, 'file_type');
  if (Number(request.headers.get('Content-Length') || 0) > UPLOAD_MAX) throw new HttpError(413, 'file_too_large');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > UPLOAD_MAX) throw new HttpError(413, 'file_too_large');
  if ((data.setup?.files || []).length >= 20) throw new HttpError(409, 'too_many_files');
  const name = clip(q.get('name'), 80).replace(/[^\w.\- ]+/g, '_') || `file.${UPLOAD_TYPES[type]}`;
  const path = `${data.order.number}/${crypto.randomUUID()}.${UPLOAD_TYPES[type]}`;
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/setup/${path}`, { method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': type }, body: bytes });
  if (!res.ok) throw new HttpError(502, 'upload_failed');
  const saved = await rpc(env, 'api_setup', { number: data.order.number, action: 'save', answers: data.setup?.answers || {}, files: [{ path, name, type, size: bytes.byteLength }] });
  return json(setupView(saved));
}

export async function postSetup(request, env, ctx) {
  requireSameOrigin(request, env);
  const body = await readJson(request, 60000);
  await rateLimit(env, `setup:${clientIp(request)}`, 60, 600);
  const data = await setupAccess(request, env, body);
  const action = ['save', 'approve', 'request_changes'].includes(body.action) ? body.action : null;
  if (!action) throw new HttpError(400, 'invalid_action');
  const answers = {};
  if (action === 'save') for (const f of data.fields) if (typeof body.answers?.[f] === 'string') answers[f] = clip(body.answers[f], 4000);
  const out = await rpc(env, 'api_setup', { number: data.order.number, action, answers, files: [], message: clip(body.message, 4000) });
  if (out.error) throw new HttpError(409, out.error);
  const title = action === 'save' ? `Website details received for ${out.order.number}` : action === 'approve' ? `Website approved for ${out.order.number}` : `Changes requested for ${out.order.number}`;
  ctx.waitUntil(alertAdmin(env, request, title, action === 'request_changes' ? clip(body.message, 4000) : answers));
  return json(setupView(out));
}

// ---------- Admin ----------
export async function adminOrder(request, env) {
  const session = await requireAdmin(request, env);
  const order = await rpc(env, 'api_admin_order', { number: clip(new URL(request.url).searchParams.get('number'), 30) });
  if (!order) throw new HttpError(404, 'not_found');
  // Short-lived links to the uploaded files, which sit in a private bucket.
  const files = [];
  for (const f of order.setup?.files || []) {
    const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/setup/${f.path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }, body: JSON.stringify({ expiresIn: 600 }) }).catch(() => null);
    const signed = r?.ok ? (await r.json()).signedURL : null;
    files.push({ name: f.name, size: f.size, type: f.type, url: signed ? `${env.SUPABASE_URL}/storage/v1${signed}` : null });
  }
  return withCookies(json({ order: { ...order, setup: order.setup ? { ...order.setup, files } : null } }), session.cookies);
}

export async function adminUpdateOrder(request, env, ctx) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  const session = await requireAdmin(request, env);
  const number = clip(body.number, 30);
  if (typeof body.note === 'string' && body.note.trim()) await rpc(env, 'api_admin_note', { number, actor: session.user.email, body: clip(body.note, 4000) });
  const payload = { number, actor: session.user.id, status: typeof body.status === 'string' ? body.status : null };
  if ('tracking_number' in body) Object.assign(payload, { tracking_number: clip(body.tracking_number, 80), tracking_carrier: clip(body.tracking_carrier, 60), tracking_url: /^https:\/\//.test(body.tracking_url || '') ? clip(body.tracking_url, 300) : '' });
  if ('preview_url' in body) payload.preview_url = /^https:\/\//.test(body.preview_url || '') ? clip(body.preview_url, 300) : '';
  const out = await rpc(env, 'api_admin_set_status', payload);
  if (out.error) throw new HttpError(out.error === 'not_found' ? 404 : 409, out.error, { from: out.from, to: out.to });
  if (out.changed) {
    const o = out.order;
    const send = {
      shipped: () => orderEmail(env, request, 'shipped', o, { url: o.tracking_url || page(env, request, o.language, '/track/'), vars: { carrier: o.tracking_carrier || '-', tracking: o.tracking_number || '-' } }),
      ready_for_review: async () => orderEmail(env, request, 'ready_for_review', o, { url: await setupLink(env, request, o) }),
      cancelled: () => orderEmail(env, request, 'order_cancelled', o)
    }[o.status];
    if (send) ctx.waitUntil(send());
  }
  return withCookies(json({ ok: true, changed: out.changed, status: out.order.status }), session.cookies);
}

export async function adminStock(request, env, ctx) {
  const session = await requireAdmin(request, env);
  let payload = {};
  if (request.method === 'POST') {
    requireSameOrigin(request, env);
    const body = await readJson(request);
    if (typeof body.variant_id !== 'string' || !Number.isInteger(body.stock) || body.stock < 0 || body.stock > 1000000) throw new HttpError(400, 'invalid_form');
    payload = { variant_id: body.variant_id.slice(0, 80), stock: body.stock };
  }
  const out = await rpc(env, 'api_admin_stock', payload);
  if (request.method === 'POST') ctx.waitUntil(notifyBackInStock(env, request));
  return withCookies(json({ variants: out.variants }), session.cookies);
}

export async function notifyBackInStock(env, request) {
  for (const r of await rpc(env, 'api_back_in_stock_due', {})) {
    await sendEmail(env, { template: 'back_in_stock', to: r.email, box: 'hello', lang: r.language, data: { vars: { name: r.name }, url: page(env, request, r.language, `/products/${r.slug}/`), siteUrl: base(env, request) } });
  }
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n;]|^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
export async function adminExport(request, env) {
  await requireAdmin(request, env);
  const q = new URL(request.url).searchParams;
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const rows = await rpc(env, 'api_admin_export', { from: isDate(q.get('from')) ? q.get('from') : null, to: isDate(q.get('to')) ? q.get('to') : null });
  const cols = ['number', 'status', 'created_at', 'paid_at', 'email', 'customer_name', 'country', 'vat_id', 'currency', 'subtotal', 'shipping', 'tax', 'total', 'refunded', 'provider', 'payment_id', 'invoice_url', 'items'];
  const cents = new Set(['subtotal', 'shipping', 'tax', 'total', 'refunded']);
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(cents.has(c) ? (Number(r[c] || 0) / 100).toFixed(2) : r[c])).join(','))].join('\r\n');
  return new Response(`﻿${csv}\r\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="nova-orders.csv"', 'Cache-Control': 'no-store' } });
}

export async function adminResend(request, env) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  const session = await requireAdmin(request, env);
  const row = await rpc(env, 'api_email_get', { id: Number(body.id) || 0 });
  if (!row?.payload?.template || !templates[row.payload.template]) throw new HttpError(404, 'not_found');
  const sent = await sendEmail(env, { ...row.payload, orderId: row.order_id });
  return withCookies(json({ ok: sent }), session.cookies);
}

// ---------- Two-step sign-in for the admin (authenticator app) ----------
export async function adminMfa(request, env) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  const session = await requireAdmin(request, env, { allowPasswordOnly: true });
  const token = (request.headers.get('Cookie') || '').match(/nova_at=([^;]+)/)?.[1];
  const call = (path, payload) => fetch(`${env.SUPABASE_URL}/auth/v1/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${decodeURIComponent(token)}` }, body: JSON.stringify(payload) });
  if (body.action === 'enroll') {
    const r = await call('factors', { factor_type: 'totp', friendly_name: 'NOVA admin' });
    if (!r.ok) throw new HttpError(400, 'mfa_enroll_failed');
    const f = await r.json();
    return json({ factor_id: f.id, secret: f.totp?.secret, uri: f.totp?.uri });
  }
  if (body.action === 'verify') {
    const factorId = clip(body.factor_id, 60) || (session.user.factors || []).find((f) => f.status === 'verified')?.id;
    if (!factorId) throw new HttpError(400, 'mfa_not_enrolled');
    const c = await call(`factors/${factorId}/challenge`, {});
    if (!c.ok) throw new HttpError(400, 'mfa_failed');
    const v = await call(`factors/${factorId}/verify`, { challenge_id: (await c.json()).id, code: clip(body.code, 10) });
    if (!v.ok) throw new HttpError(400, 'mfa_failed');
    const tokens = await v.json();
    return withCookies(json({ ok: true }), tokenCookies(tokens));
  }
  throw new HttpError(400, 'invalid_action');
}

// ---------- Plans: a monthly or yearly subscription for one product, paid on Stripe ----------
const stripeApi = async (env, method, path, params) => {
  const res = await fetch(`${env.STRIPE_API_BASE || 'https://api.stripe.com'}${path}`, { method, headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: params?.toString() });
  if (!res.ok) throw new HttpError(502, 'payment_provider_error');
  return res.json();
};

// A plan needs an account, so the buyer can manage or cancel it later.
export async function startPlan(request, env) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  if (!shopState(env).enabled) throw new HttpError(403, 'shop_closed');
  const session = await requireUser(request, env, { verified: true });
  await rateLimit(env, `plan:${session.user.id}`, 10, 600);
  const lang = pickLang(body.lang);
  const billing = body.billing === 'yearly' ? 'yearly' : 'monthly';
  const region = regionForCountry(typeof body.country === 'string' ? body.country : '');
  // Plans are sold through Stripe only.
  if (!region || region.provider !== 'stripe' || !sellableRegions(env).some((r) => r.id === region.id)) throw new HttpError(400, 'region_unavailable');
  const plan = await rpc(env, 'api_plan_price', { product_id: clip(body.product_id, 80), billing, lang, currency: region.currency });
  if (!plan) throw new HttpError(404, 'plan_not_found');
  if (plan.type === 'website' && body.waiver !== true) throw new HttpError(400, 'waiver_required');
  const p = new URLSearchParams({ mode: 'subscription', 'line_items[0][quantity]': '1', locale: lang, customer_email: session.user.email, 'automatic_tax[enabled]': 'true',
    'tax_id_collection[enabled]': 'true', billing_address_collection: 'required', allow_promotion_codes: 'true', 'consent_collection[terms_of_service]': 'required',
    success_url: page(env, request, lang, '/account/?plan=started'), cancel_url: page(env, request, lang, '/checkout/cancelled/') });
  p.set('line_items[0][price_data][currency]', plan.currency.toLowerCase());
  p.set('line_items[0][price_data][unit_amount]', String(plan.unit_amount));
  p.set('line_items[0][price_data][tax_behavior]', 'exclusive');
  p.set('line_items[0][price_data][recurring][interval]', billing === 'yearly' ? 'year' : 'month');
  p.set('line_items[0][price_data][product_data][name]', plan.name);
  if (plan.tax_code) p.set('line_items[0][price_data][product_data][tax_code]', plan.tax_code);
  for (const [k, v] of Object.entries({ kind: 'plan', product_id: plan.product_id, billing, user_id: session.user.id, language: lang, unit_amount: plan.unit_amount })) { p.set(`metadata[${k}]`, String(v)); p.set(`subscription_data[metadata][${k}]`, String(v)); }
  const s = await stripeApi(env, 'POST', '/v1/checkout/sessions', p);
  return withCookies(json({ url: s.url }), session.cookies);
}

// Opens Stripe's customer portal: update the card, cancel, download invoices.
export async function planPortal(request, env) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  const session = await requireUser(request, env, { verified: true });
  const plans = await rpc(env, 'api_subscription', { action: 'list', user_id: session.user.id });
  const customer = (await rpc(env, 'api_account_update', { user_id: session.user.id }))?.stripe_customer_id;
  if (!plans.length || !customer) throw new HttpError(404, 'no_plan');
  const s = await stripeApi(env, 'POST', '/v1/billing_portal/sessions', new URLSearchParams({ customer, return_url: page(env, request, pickLang(body.lang), '/account/') }));
  return withCookies(json({ url: s.url }), session.cookies);
}

const periodEnd = (sub) => sub.current_period_end || sub.items?.data?.[0]?.current_period_end || null;
const planMail = (env, request, template, sub, extra = {}) => (isEmail(sub.email) ? sendEmail(env, { template, to: sub.email, box: template === 'plan_renewed' ? 'invoices' : 'orders', lang: extra.lang || 'en',
  data: { vars: { name: sub.name || '', amount: new Intl.NumberFormat('en-GB', { style: 'currency', currency: sub.currency || 'EUR' }).format((sub.unit_amount || 0) / 100), date: sub.current_period_end ? new Date(sub.current_period_end).toISOString().slice(0, 10) : '' }, url: extra.url || page(env, request, extra.lang || 'en', '/account/'), siteUrl: base(env, request) } }) : Promise.resolve());

// Stripe events about plans. Returns true when the event was one of them.
export async function handlePlanEvent(env, request, ctx, event) {
  const obj = event.data?.object || {};
  if (event.type === 'checkout.session.completed' && obj.mode === 'subscription') {
    const m = obj.metadata || {};
    const sub = await stripeApi(env, 'GET', `/v1/subscriptions/${encodeURIComponent(obj.subscription)}`);
    const row = await rpc(env, 'api_subscription', { id: sub.id, customer_id: m.user_id, email: obj.customer_details?.email || obj.customer_email, product_id: m.product_id, status: sub.status, billing: m.billing, unit_amount: Number(m.unit_amount) || null,
      currency: (obj.currency || 'eur').toUpperCase(), current_period_end: periodEnd(sub), cancel_at_period_end: sub.cancel_at_period_end, provider_customer_id: obj.customer });
    if (m.user_id) await rpc(env, 'api_account_update', { user_id: m.user_id, stripe_customer_id: obj.customer });
    ctx.waitUntil(Promise.all([planMail(env, request, 'plan_renewed', row, { lang: m.language }), alertAdmin(env, request, `New plan: ${row.name} (${m.billing})`, { email: row.email, subscription: sub.id })]));
    return true;
  }
  if (event.type === 'invoice.paid' && obj.billing_reason === 'subscription_cycle') {
    const id = obj.subscription || obj.parent?.subscription_details?.subscription;
    const sub = await stripeApi(env, 'GET', `/v1/subscriptions/${encodeURIComponent(id)}`);
    const row = await rpc(env, 'api_subscription', { id, status: sub.status, current_period_end: periodEnd(sub), cancel_at_period_end: sub.cancel_at_period_end, email: obj.customer_email });
    ctx.waitUntil(planMail(env, request, 'plan_renewed', row, { lang: sub.metadata?.language, url: obj.hosted_invoice_url }));
    return true;
  }
  if (event.type === 'invoice.payment_failed' && (obj.subscription || obj.parent?.subscription_details?.subscription)) {
    const id = obj.subscription || obj.parent.subscription_details.subscription;
    const row = await rpc(env, 'api_subscription', { id, status: 'past_due', email: obj.customer_email });
    // The link lets the buyer update the card; Stripe retries the payment by itself.
    ctx.waitUntil(planMail(env, request, 'plan_payment_failed', row, { url: obj.hosted_invoice_url }));
    return true;
  }
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const ended = event.type.endsWith('deleted');
    const wasCancelling = event.data?.previous_attributes?.cancel_at_period_end;
    const row = await rpc(env, 'api_subscription', { id: obj.id, status: ended ? 'canceled' : obj.status, current_period_end: periodEnd(obj), cancel_at_period_end: Boolean(obj.cancel_at_period_end), email: null });
    if (ended || (obj.cancel_at_period_end && wasCancelling === false)) {
      ctx.waitUntil(Promise.all([planMail(env, request, 'plan_cancelled', row, { lang: obj.metadata?.language }), alertAdmin(env, request, `Plan ${ended ? 'ended' : 'set to cancel'}: ${row.name || obj.id}`, { email: row.email, subscription: obj.id })]));
    }
    return true;
  }
  return false;
}

// ---------- Scheduled jobs (every 10 minutes) ----------
export async function runJobs(env) {
  const request = new Request(`${env.SITE_URL}/`);
  const each = async (kind, extra, fn) => { for (const row of await rpc(env, 'api_due', { kind, ...extra })) await fn(row).catch((e) => console.error(`job ${kind} failed: ${e.message}`)); };
  await each('setup_reminder', { days: 3 }, async (o) => orderEmail(env, request, 'setup_reminder', o, { url: await setupLink(env, request, o) }));
  await each('review_request', { days: site.reviewRequestDays }, (o) => orderEmail(env, request, 'delivered_review', o, { url: page(env, request, o.language, '/contact/') }));
  // Marketing emails below go only to people who opted in, and always carry an unsubscribe link.
  const unsub = async (email, lang) => { const n = await rpc(env, 'api_newsletter', { action: 'request', email, lang, source: 'cart' }); return `${env.SITE_URL}/api/newsletter/unsubscribe?token=${n.token}&lang=${lang}`; };
  await each('checkout_recovery', {}, async (o) => sendEmail(env, { template: 'cart_reminder', to: o.email, box: 'hello', lang: o.language, orderId: o.id, data: { url: o.recovery_url, unsubscribeUrl: await unsub(o.email, o.language), siteUrl: env.SITE_URL } }));
  await each('saved_cart', {}, async (c) => sendEmail(env, { template: 'cart_reminder', to: c.email, box: 'hello', lang: c.language, data: { url: page(env, request, c.language, '/cart/'), unsubscribeUrl: await unsub(c.email, c.language), siteUrl: env.SITE_URL } }));
  await notifyBackInStock(env, request);
  await syncNewsletter(env);
}

// Confirmed subscribers go to Brevo (EU hosting) once BREVO_API_KEY is set. Until then they stay in our table.
export async function syncNewsletter(env) {
  if (!env.BREVO_API_KEY) return 0;
  const rows = await rpc(env, 'api_newsletter', { action: 'to_sync' });
  for (const r of rows) {
    const res = await fetch('https://api.brevo.com/v3/contacts', { method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: r.email, updateEnabled: true, emailBlacklisted: Boolean(r.unsubscribed_at), attributes: { LANGUAGE: r.language, SOURCE: r.source, CONSENT_AT: r.confirmed_at }, ...(env.BREVO_LIST_ID ? { listIds: [Number(env.BREVO_LIST_ID)] } : {}) }) });
    if (res.ok || res.status === 204) await rpc(env, 'api_newsletter', { action: 'synced', email: r.email });
  }
  return rows.length;
}
