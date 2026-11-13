// Small shared helpers for the Worker: responses, cookies, database calls, Turnstile, rate limits.

export class HttpError extends Error {
  constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra; }
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

export const isProduction = (env) => env.ENVIRONMENT === 'production';
export const isDevelopment = (env) => env.ENVIRONMENT === 'development';
export const siteUrl = (env, request) => (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');

export function timingSafeEqual(a, b) {
  const x = String(a), y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

// ---------- Database: every call is a Postgres function, through the service-role key ----------
export async function rpc(env, fn, payload = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new HttpError(503, 'database_not_configured');
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ payload })
  });
  if (!res.ok) {
    console.error(`rpc ${fn} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    throw new HttpError(502, 'database_error');
  }
  return res.json();
}

// ---------- Request checks ----------
export async function readJson(request, maxBytes = 20000) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) throw new HttpError(415, 'json_required');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'too_large');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'invalid_json'); }
}

// CSRF: state-changing requests must come from this site. Browsers always send Origin on POST.
export function requireSameOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = new Set([new URL(request.url).origin, siteUrl(env, request)]);
  if (!origin || !allowed.has(origin)) throw new HttpError(403, 'bad_origin');
}

export const clientIp = (request) => request.headers.get('CF-Connecting-IP') || '0.0.0.0';

export async function rateLimit(env, key, max, windowSeconds) {
  const r = await rpc(env, 'api_rate_limit', { key, max, window_seconds: windowSeconds });
  if (!r.allowed) throw new HttpError(429, 'rate_limited');
}

export async function verifyTurnstile(env, token, request) {
  if (!env.TURNSTILE_SECRET_KEY) {
    if (isDevelopment(env)) return; // local development only; staging and production fail closed
    throw new HttpError(503, 'turnstile_not_configured');
  }
  if (!token || typeof token !== 'string') throw new HttpError(400, 'turnstile_failed');
  const res = await fetch(env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: clientIp(request) })
  });
  const out = res.ok ? await res.json() : { success: false };
  if (!out.success) throw new HttpError(400, 'turnstile_failed');
}

// ---------- Cookies ----------
export function getCookie(request, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(request.headers.get('Cookie') || '');
  return m ? decodeURIComponent(m[1]) : null;
}

export const setCookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
export const clip = (s, n) => String(s ?? '').trim().slice(0, n);
