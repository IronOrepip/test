// Customer accounts: sign-up, email confirmation, one-time sign-in link, password reset,
// Google (and optionally Apple) sign-in, the account area, and order tracking without an account.
// Supabase Auth holds the users. Its tokens live only in HttpOnly cookies set here.
import { site, langByCode } from '../config/site.mjs';
import { HttpError, json, rpc, readJson, requireSameOrigin, rateLimit, verifyTurnstile, clientIp, getCookie, setCookie, siteUrl, isEmail, clip } from './lib.js';
import { getSession, authHeaders, tokenCookies, clearCookies, withCookies, pickLang } from './api.js';
import { sendEmail } from './email.js';

const adminHeaders = (env) => ({ 'Content-Type': 'application/json', apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` });
const isVerified = (user) => Boolean(user?.email_confirmed_at || user?.confirmed_at);
const localUrl = (env, request, lang, path) => `${siteUrl(env, request)}${langByCode(lang).prefix}${path}`;
const redirect = (location, cookies = []) => withCookies(new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } }), cookies);
const safeNext = (next) => (typeof next === 'string' && /^\/[a-z0-9/_-]*$/i.test(next) ? next : null);

// Which sign-in buttons the pages show. Apple stays off until APPLE_SIGN_IN is "true"
// (it needs a paid Apple Developer account).
export const providerFlags = (env) => ({ google: env.GOOGLE_SIGN_IN !== 'false', apple: env.APPLE_SIGN_IN === 'true' });

export async function requireUser(request, env, { verified = false } = {}) {
  const session = await getSession(request, env);
  if (!session) throw new HttpError(401, 'sign_in_required');
  if (verified && !isVerified(session.user)) throw new HttpError(403, 'email_not_verified');
  return session;
}

// Runs after every successful sign-in: profile, guest orders, welcome email.
export async function afterSignIn(env, request, ctx, user, lang) {
  const out = await rpc(env, 'api_account_touch', { user_id: user.id, lang });
  if (out.verified && out.profile && !out.profile.welcomed_at) {
    await rpc(env, 'api_account_update', { user_id: user.id, welcomed: true });
    const l = out.profile.language || lang;
    ctx.waitUntil(sendEmail(env, { template: 'welcome', to: user.email, box: 'hello', lang: l, data: { url: localUrl(env, request, l, '/account/'), siteUrl: siteUrl(env, request) } }));
  }
  return out;
}

// Asks Supabase for a one-time link, then sends it in our own email template.
async function emailLink(env, request, ctx, { type, email, password, lang, template, next }) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: adminHeaders(env), body: JSON.stringify({ type, email, password }) });
  if (!res.ok) return false; // unknown or already registered email: the caller answers the same either way
  const link = await res.json();
  const token = link.hashed_token || link.properties?.hashed_token;
  if (!token) return false;
  const url = `${siteUrl(env, request)}/api/auth/confirm?token_hash=${encodeURIComponent(token)}&type=${type}&lang=${lang}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
  ctx.waitUntil(sendEmail(env, { template, to: email, box: 'hello', lang, data: { url, siteUrl: siteUrl(env, request) } }));
  return true;
}

async function guarded(request, env, key, max = 6) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  await rateLimit(env, `${key}:${clientIp(request)}`, max, 600);
  await verifyTurnstile(env, body.turnstile, request);
  return body;
}

// The answer is the same whether or not the address already has an account.
export async function signUp(request, env, ctx) {
  const body = await guarded(request, env, 'signup');
  const lang = pickLang(body.lang);
  if (!isEmail(body.email)) throw new HttpError(400, 'invalid_email');
  if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 200) throw new HttpError(400, 'weak_password');
  await emailLink(env, request, ctx, { type: 'signup', email: body.email.trim(), password: body.password, lang, template: 'confirm_email' });
  if (body.news === true) ctx.waitUntil(requestNewsletter(env, request, body.email.trim(), lang, 'sign-up'));
  return json({ ok: true });
}

export async function magicLink(request, env, ctx) {
  const body = await guarded(request, env, 'magic');
  if (isEmail(body.email)) await emailLink(env, request, ctx, { type: 'magiclink', email: body.email.trim(), lang: pickLang(body.lang), template: 'magic_link', next: safeNext(body.next) });
  return json({ ok: true });
}

export async function resetRequest(request, env, ctx) {
  const body = await guarded(request, env, 'reset');
  if (isEmail(body.email)) await emailLink(env, request, ctx, { type: 'recovery', email: body.email.trim(), lang: pickLang(body.lang), template: 'reset_password' });
  return json({ ok: true });
}

// The link in the email lands here. A valid link signs the person in.
export async function confirm(request, env, ctx) {
  const q = new URL(request.url).searchParams;
  const lang = pickLang(q.get('lang'));
  const type = q.get('type');
  await rateLimit(env, `confirm:${clientIp(request)}`, 20, 600);
  const fail = redirect(localUrl(env, request, lang, '/account/sign-in/?link=expired'));
  if (!['signup', 'magiclink', 'recovery', 'email_change'].includes(type) || !q.get('token_hash')) return fail;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: authHeaders(env), body: JSON.stringify({ type, token_hash: q.get('token_hash') }) });
  if (!res.ok) return fail;
  const tokens = await res.json();
  if (!tokens.access_token) return fail;
  await afterSignIn(env, request, ctx, tokens.user, lang);
  const next = safeNext(q.get('next'));
  const to = type === 'recovery' ? localUrl(env, request, lang, '/account/reset-password/?step=new')
    : next ? `${siteUrl(env, request)}${next}` : localUrl(env, request, lang, '/account/?welcome=1');
  return redirect(to, tokenCookies(tokens));
}

// ---------- Google and Apple: OAuth through Supabase with PKCE ----------
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function oauthStart(request, env) {
  const q = new URL(request.url).searchParams;
  const provider = q.get('provider');
  if (!providerFlags(env)[provider]) throw new HttpError(404, 'provider_off');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = JSON.stringify({ v: verifier, n: safeNext(q.get('next')), l: pickLang(q.get('lang')) });
  const back = `${siteUrl(env, request)}/api/auth/callback`;
  const to = `${env.SUPABASE_URL}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(back)}&code_challenge=${challenge}&code_challenge_method=s256`;
  return redirect(to, [setCookie('nova_oauth', state, 600)]);
}

export async function oauthCallback(request, env, ctx) {
  const q = new URL(request.url).searchParams;
  let state = {};
  try { state = JSON.parse(getCookie(request, 'nova_oauth') || '{}'); } catch { /* handled below */ }
  const lang = pickLang(state.l);
  const fail = redirect(localUrl(env, request, lang, '/account/sign-in/?link=failed'), [setCookie('nova_oauth', '', 0)]);
  if (!q.get('code') || !state.v) return fail;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=pkce`, { method: 'POST', headers: authHeaders(env), body: JSON.stringify({ auth_code: q.get('code'), code_verifier: state.v }) });
  if (!res.ok) return fail;
  const tokens = await res.json();
  await afterSignIn(env, request, ctx, tokens.user, lang);
  return redirect(state.n ? `${siteUrl(env, request)}${state.n}` : localUrl(env, request, lang, '/account/'), [...tokenCookies(tokens), setCookie('nova_oauth', '', 0)]);
}

// ---------- Account area ----------
export async function getAccount(request, env, ctx) {
  const session = await requireUser(request, env);
  const touch = await afterSignIn(env, request, ctx, session.user, site.defaultLang);
  const p = touch.profile || {};
  const plans = await rpc(env, 'api_subscription', { action: 'list', user_id: session.user.id });
  return withCookies(json({
    email: session.user.email, verified: isVerified(session.user), admin: p.role === 'admin', linked_orders: touch.linked_orders,
    language: p.language, company_name: p.company_name, vat_number: p.vat_number, invoice_email: p.invoice_email,
    email_news: p.email_news, email_cart: p.email_cart,
    plans: plans.map((s) => ({ id: s.id, name: s.name, status: s.status, billing: s.billing, unit_amount: s.unit_amount, currency: s.currency, current_period_end: s.current_period_end, cancel_at_period_end: s.cancel_at_period_end }))
  }), session.cookies);
}

export async function updateAccount(request, env, ctx) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  const session = await requireUser(request, env);
  const patch = { user_id: session.user.id };
  for (const k of ['company_name', 'vat_number']) if (k in body) patch[k] = clip(body[k], 160);
  if ('invoice_email' in body) { if (body.invoice_email && !isEmail(body.invoice_email)) throw new HttpError(400, 'invalid_email'); patch.invoice_email = clip(body.invoice_email, 254); }
  if (typeof body.email_cart === 'boolean') patch.email_cart = body.email_cart;
  if (typeof body.language === 'string') patch.language = pickLang(body.language);
  if (typeof body.email_news === 'boolean') {
    patch.email_news = body.email_news;
    // The newsletter is double opt-in: ticking the box sends a confirmation email first.
    if (body.email_news) ctx.waitUntil(requestNewsletter(env, request, session.user.email, pickLang(body.language), 'account'));
    else await rpc(env, 'api_newsletter', { action: 'unsubscribe', email: session.user.email });
  }
  await rpc(env, 'api_account_update', patch);
  return withCookies(json({ ok: true }), session.cookies);
}

export async function accountOrders(request, env) {
  // Past orders are visible only once the email address is verified.
  const session = await requireUser(request, env, { verified: true });
  const number = new URL(request.url).searchParams.get('number');
  const orders = await rpc(env, 'api_account_orders', { user_id: session.user.id, number: number ? clip(number, 30) : null });
  if (number && !orders.length) throw new HttpError(404, 'not_found');
  return withCookies(json({ orders }), session.cookies);
}

export async function accountAddresses(request, env) {
  const session = await requireUser(request, env);
  let payload = { user_id: session.user.id };
  if (request.method === 'POST') {
    requireSameOrigin(request, env);
    const body = await readJson(request);
    if (body.action === 'delete') payload = { ...payload, action: 'delete', id: clip(body.id, 40) };
    else {
      const a = body.address || {};
      const address = { id: a.id ? clip(a.id, 40) : null, label: clip(a.label, 60), name: clip(a.name, 120), line1: clip(a.line1, 160), line2: clip(a.line2, 160), postal_code: clip(a.postal_code, 20), city: clip(a.city, 100), state: clip(a.state, 100), country: clip(a.country, 2).toUpperCase(), phone: clip(a.phone, 40), is_default: a.is_default === true };
      if (!address.name || !address.line1 || !address.postal_code || !address.city || !/^[A-Z]{2}$/.test(address.country)) throw new HttpError(400, 'invalid_form');
      payload = { ...payload, action: 'save', address };
    }
  }
  const out = await rpc(env, 'api_addresses', payload);
  if (out.error) throw new HttpError(400, out.error);
  return withCookies(json(out), session.cookies);
}

// Saved cart: merged with the browser cart on sign-in, then kept in step with it.
export async function accountCart(request, env) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  const session = await requireUser(request, env);
  const items = Array.isArray(body.items) ? body.items.slice(0, 50).filter((i) => typeof i?.p === 'string' && typeof i?.v === 'string' && Number.isInteger(i?.q) && i.q > 0 && i.q <= 100000).map((i) => ({ p: i.p.slice(0, 80), v: i.v.slice(0, 80), q: i.q })) : [];
  const out = await rpc(env, 'api_saved_cart', { user_id: session.user.id, items, merge: body.merge === true, lang: pickLang(body.lang) });
  return withCookies(json(out), session.cookies);
}

export async function accountExport(request, env) {
  const session = await requireUser(request, env, { verified: true });
  const data = await rpc(env, 'api_account_export', { user_id: session.user.id });
  return withCookies(new Response(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="nova-my-data.json"', 'Cache-Control': 'no-store' } }), session.cookies);
}

export async function changePassword(request, env, ctx) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  const session = await requireUser(request, env);
  await rateLimit(env, `password:${session.user.id}`, 6, 600);
  if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 200) throw new HttpError(400, 'weak_password');
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { method: 'PUT', headers: authHeaders(env, getCookie(request, 'nova_at')), body: JSON.stringify({ password: body.password }) });
  if (!res.ok) throw new HttpError(400, 'password_not_changed');
  ctx.waitUntil(sendEmail(env, { template: 'account_changed', to: session.user.email, box: 'hello', lang: pickLang(body.lang), data: { vars: { what: 'password' }, siteUrl: siteUrl(env, request) } }));
  return withCookies(json({ ok: true }), session.cookies);
}

export async function changeEmail(request, env, ctx) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  const session = await requireUser(request, env);
  await rateLimit(env, `email:${session.user.id}`, 4, 3600);
  if (!isEmail(body.email)) throw new HttpError(400, 'invalid_email');
  // Supabase sends the confirmation link to the new address; the change applies once it is clicked.
  await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { method: 'PUT', headers: authHeaders(env, getCookie(request, 'nova_at')), body: JSON.stringify({ email: body.email.trim() }) });
  // The old address is always told, so a change the owner did not make is noticed.
  ctx.waitUntil(sendEmail(env, { template: 'account_changed', to: session.user.email, box: 'hello', lang: pickLang(body.lang), data: { vars: { what: 'email address' }, siteUrl: siteUrl(env, request) } }));
  return withCookies(json({ ok: true }), session.cookies);
}

export async function deleteAccount(request, env) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  const session = await requireUser(request, env);
  if (body.confirm !== 'DELETE') throw new HttpError(400, 'confirmation_required');
  const out = await rpc(env, 'api_account_delete', { user_id: session.user.id });
  if (out.error) throw new HttpError(409, out.error);
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${session.user.id}`, { method: 'DELETE', headers: adminHeaders(env) });
  if (!res.ok) throw new HttpError(502, 'delete_failed');
  return withCookies(json({ ok: true }), clearCookies());
}

// ---------- Track an order without signing in ----------
export async function track(request, env) {
  requireSameOrigin(request, env);
  const body = await readJson(request);
  await rateLimit(env, `track:${clientIp(request)}`, 10, 600);
  await verifyTurnstile(env, body.turnstile, request);
  if (!isEmail(body.email) || typeof body.number !== 'string') throw new HttpError(404, 'not_found');
  await rateLimit(env, `track-email:${body.email.toLowerCase()}`, 10, 600);
  const order = await rpc(env, 'api_track', { number: clip(body.number, 30), email: body.email });
  if (!order) throw new HttpError(404, 'not_found'); // the same answer for a wrong number and a wrong email
  return json({ order });
}

// ---------- Newsletter: double opt-in ----------
export async function requestNewsletter(env, request, email, lang, source) {
  const n = await rpc(env, 'api_newsletter', { action: 'request', email, lang, source });
  if (n.already_confirmed) return;
  const base = siteUrl(env, request);
  await sendEmail(env, { template: 'newsletter_confirm', to: n.email, box: 'hello', lang, data: { url: `${base}/api/newsletter/confirm?token=${n.token}&lang=${lang}`, unsubscribeUrl: `${base}/api/newsletter/unsubscribe?token=${n.token}&lang=${lang}`, siteUrl: base } });
}

export async function newsletterSignUp(request, env, ctx) {
  const body = await guarded(request, env, 'newsletter', 5);
  if (!isEmail(body.email)) throw new HttpError(400, 'invalid_email');
  ctx.waitUntil(requestNewsletter(env, request, body.email.trim(), pickLang(body.lang), clip(body.source, 20) || 'footer'));
  return json({ ok: true });
}

export async function newsletterLink(request, env) {
  const url = new URL(request.url);
  const action = url.pathname.endsWith('/unsubscribe') ? 'unsubscribe' : 'confirm';
  const lang = pickLang(url.searchParams.get('lang'));
  await rateLimit(env, `newsletter-link:${clientIp(request)}`, 30, 600);
  const out = await rpc(env, 'api_newsletter', { action, token: clip(url.searchParams.get('token'), 80) });
  return redirect(localUrl(env, request, lang, `/newsletter/?state=${out.ok ? (action === 'confirm' ? 'confirmed' : 'unsubscribed') : 'invalid'}`));
}
