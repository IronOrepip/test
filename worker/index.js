// NOVA site Worker: serves the built static site and the /api/ routes on the same domain.
// On staging it also keeps the HTTP Basic Auth gate that staging-worker.js used to provide.
import { HttpError, json, timingSafeEqual, isProduction } from './lib.js';
import * as api from './api.js';
import { retryFailedEmails } from './email.js';

const routes = {
  'GET /api/config': api.getConfig,
  'GET /api/products': api.getProducts,
  'POST /api/cart/price': api.priceCart,
  'POST /api/checkout': api.startCheckout,
  'GET /api/checkout/session': api.getCheckoutSession,
  'POST /api/stripe/webhook': api.stripeWebhook,
  'POST /api/contact': api.postContact,
  'POST /api/stock-alert': api.postStockAlert,
  'POST /api/auth/sign-in': api.signIn,
  'POST /api/auth/sign-out': api.signOut,
  'GET /api/auth/me': api.getMe,
  'GET /api/admin/orders': api.adminOrders
};

// Content Security Policy: this site, Cloudflare Turnstile, and the consent-gated tag manager.
// Stripe needs nothing here because payment happens on Stripe's own hosted page.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com https://www.googletagmanager.com",
  "frame-src https://challenges.cloudflare.com",
  "style-src 'self'",
  "img-src 'self' data: https://www.googletagmanager.com",
  "font-src 'self'",
  "connect-src 'self' https://www.googletagmanager.com https://www.google-analytics.com",
  "form-action 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join('; ');

function secure(response, env, { noindex = false } = {}) {
  const res = new Response(response.body, response);
  res.headers.set('Content-Security-Policy', CSP);
  res.headers.set('Strict-Transport-Security', 'max-age=31536000');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (noindex || !isProduction(env)) res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

function basicAuth(request, env) {
  const gated = env.ENVIRONMENT === 'staging' || env.STAGING_USERNAME || env.STAGING_PASSWORD;
  if (!gated) return null;
  if (!env.STAGING_USERNAME || !env.STAGING_PASSWORD) {
    return new Response('NOVA staging authentication is not configured.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const m = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(request.headers.get('Authorization') || '');
  let user = '', pass = '';
  if (m) {
    try {
      const value = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
      const i = value.indexOf(':');
      if (i > 0) { user = value.slice(0, i); pass = value.slice(i + 1); }
    } catch { /* fall through to 401 */ }
  }
  if (user && timingSafeEqual(user, env.STAGING_USERNAME) && timingSafeEqual(pass, env.STAGING_PASSWORD)) return null;
  return new Response('Sign in is required to view NOVA staging.', { status: 401, headers: { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Basic realm="NOVA staging", charset="UTF-8"' } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !isLocal) {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }

    // Stripe cannot send a staging password. The webhook is protected by its signature instead.
    const isWebhook = url.pathname === '/api/stripe/webhook';
    if (!isWebhook) {
      const denied = basicAuth(request, env);
      if (denied) return denied;
    }

    if (url.pathname.startsWith('/api/')) {
      const handler = routes[`${request.method} ${url.pathname}`];
      try {
        if (!handler) throw new HttpError(404, 'not_found');
        return secure(await handler(request, env, ctx), env, { noindex: true });
      } catch (e) {
        if (e instanceof HttpError) return secure(json({ error: e.code, ...(e.extra || {}) }, e.status), env, { noindex: true });
        console.error(`${request.method} ${url.pathname} failed: ${e.stack || e.message}`);
        return secure(json({ error: 'server_error' }, 500), env, { noindex: true });
      }
    }

    // Static pages. The Authorization header is not passed on to the asset store.
    const headers = new Headers(request.headers);
    headers.delete('Authorization');
    const asset = await env.ASSETS.fetch(new Request(request, { headers }));
    const res = secure(asset, env);
    if (env.ENVIRONMENT === 'staging') res.headers.set('Cache-Control', 'private, no-store');
    return res;
  },

  // Every 10 minutes: try failed emails again.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(retryFailedEmails(env).catch((e) => console.error(`email retry failed: ${e.message}`)));
  }
};
