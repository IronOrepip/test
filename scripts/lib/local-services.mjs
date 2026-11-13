// Local stand-ins for the outside services, used by `npm run dev`, the tests and the Playwright walk:
//  - a real Postgres (embedded) with the migrations applied and the Supabase roles and auth schema stubbed
//  - Supabase REST (rpc only) and Supabase Auth (password sign-in for two fixed users)
//  - Stripe Checkout (create/retrieve a session, a plain pay page, signed webhooks)
//  - Resend (emails are captured to memory and to .dev/emails)
//  - Turnstile siteverify (token "pass" succeeds)
// Nothing here is used on staging or production.
import http from 'node:http';
import net from 'node:net';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WEBHOOK_SECRET = 'whsec_local_test_secret';
export const USERS = {
  admin: { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test', password: 'admin-password-123' },
  customer: { id: '00000000-0000-4000-8000-000000000002', email: 'customer@example.test', password: 'customer-password-123' }
};

// What a fresh Supabase project already has before our migration runs.
const SUPABASE_STUB = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

// Asks the system for a port nobody is using, so parallel or leftover runs never collide.
export const freePort = () => new Promise((ok, fail) => { const s = net.createServer(); s.once('error', fail); s.listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); }); });

export function signStripe(body, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

export async function startDatabase({ port = 54329 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nova-pg-'));
  const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  await server.createDatabase('nova');
  // Stopping must never hang a test run. If the normal stop takes too long, the database
  // process this script started (its id is in postmaster.pid) is ended directly.
  const stopServer = async () => {
    const stopped = await Promise.race([server.stop().then(() => true, () => true), new Promise((ok) => setTimeout(() => ok(false), 8000))]);
    if (!stopped) {
      try { process.kill(Number(readFileSync(join(dir, 'postmaster.pid'), 'utf8').split('\n')[0])); } catch { /* already gone */ }
    }
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch { /* Windows can keep the folder locked for a moment; it lives in the temp folder */ }
  };
  // If set-up fails, stop the database again so no process is left behind.
  try {
  const pool = new pg.Pool({ host: 'localhost', port, user: 'postgres', password: 'postgres', database: 'nova', max: 12 });
  await pool.query(SUPABASE_STUB);
  const migrations = join(root, 'supabase', 'migrations');
  for (const file of readdirSync(migrations).sort()) await pool.query(readFileSync(join(migrations, file), 'utf8'));
  await pool.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()), ($3, $4, now())`, [USERS.admin.id, USERS.admin.email, USERS.customer.id, USERS.customer.email]);
  await pool.query(`insert into public.profiles (id, role) values ($1, 'admin'), ($2, 'customer')`, [USERS.admin.id, USERS.customer.id]);
  const seed = JSON.parse(readFileSync(join(root, 'data', 'products.seed.json'), 'utf8'));
  await pool.query('select public.api_seed($1::jsonb)', [JSON.stringify({ products: seed.products, reset_stock: true })]);
  // Never wait more than a few seconds for idle connections: the database is stopped right after.
  return { pool, port, async stop() { await Promise.race([pool.end().catch(() => {}), new Promise((ok) => setTimeout(ok, 3000))]); await stopServer(); } };
  } catch (e) {
    await stopServer();
    throw e;
  }
}

const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => ok(b)); });
const fakeJwt = (claims) => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.local`;

export async function startServices({ port = 8788, dbPort = 54329, workerUrl = () => 'http://localhost:8787', emailDir = join(root, '.dev', 'emails') } = {}) {
  const db = await startDatabase({ port: dbPort });
  const emails = [];
  const sessions = new Map();
  const tokens = new Map();
  const state = { failEmails: false };
  mkdirSync(emailDir, { recursive: true });
  const base = `http://localhost:${port}`;

  const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json', ...headers }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

  // Runs one api_* function the way PostgREST does: as the service role, in its own transaction.
  async function rpc(fn, payload) {
    if (!/^api_[a-z_]+$/.test(fn)) throw new Error('unknown function');
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role service_role');
      const { rows } = await client.query(`select public.${fn}($1::jsonb) as r`, [JSON.stringify(payload ?? {})]);
      await client.query('commit');
      return rows[0].r;
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  function sessionObject(s) {
    const subtotal = s.lines.reduce((n, l) => n + l.amount * l.quantity, 0);
    const shipping = s.shippingAmount;
    const tax = Math.round((subtotal + shipping) * 0.22); // stands in for Stripe Tax (Italian 22%)
    return {
      id: s.id, object: 'checkout.session', status: s.status, payment_status: s.payment_status, mode: 'payment',
      client_reference_id: s.params.get('client_reference_id'), metadata: { order_id: s.params.get('metadata[order_id]'), order_number: s.params.get('metadata[order_number]') },
      amount_subtotal: subtotal, amount_total: subtotal + shipping + tax, currency: 'eur',
      total_details: { amount_shipping: shipping, amount_tax: tax, amount_discount: 0 },
      payment_intent: s.payment_status === 'paid' ? `pi_test_${s.id.slice(8)}` : null, customer: null, invoice: null,
      customer_details: { email: s.email, name: 'Test Buyer', address: { line1: 'Via Roma 1', city: 'Napoli', postal_code: '80100', country: 'IT' }, tax_ids: [] },
      shipping_details: shipping ? { name: 'Test Buyer', address: { line1: 'Via Roma 1', city: 'Napoli', postal_code: '80100', country: 'IT' } } : null,
      url: `${base}/pay/${s.id}`
    };
  }

  async function sendEvent(type, object, { id = `evt_${randomUUID().replace(/-/g, '')}`, secret = WEBHOOK_SECRET } = {}) {
    const body = JSON.stringify({ id, object: 'event', type, data: { object } });
    const res = await fetch(`${workerUrl()}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signStripe(body, secret) }, body });
    return { id, status: res.status, body: await res.json().catch(() => ({})) };
  }

  const payPage = (s) => `<!doctype html><html lang="en"><meta charset="utf-8"><title>Test payment page</title>
<body style="font:16px/1.5 Arial;max-width:520px;margin:40px auto;padding:0 16px">
<h1>Test payment page</h1><p>This local page stands in for Stripe Checkout. Order ${s.params.get('metadata[order_number]')}.</p>
<ul>${s.lines.map((l) => `<li>${l.quantity} × ${l.name}: ${(l.amount / 100).toFixed(2)} EUR each</li>`).join('')}</ul>
<p>Shipping: ${(s.shippingAmount / 100).toFixed(2)} EUR</p>
<form method="post" action="/pay/${s.id}/pay"><button id="pay">Pay</button></form>
<form method="post" action="/pay/${s.id}/cancel"><button id="cancel">Cancel and go back</button></form>
<form method="post" action="/pay/${s.id}/expire"><button id="expire">Let the session expire</button></form></body></html>`;

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, base);
    const path = u.pathname;
    try {
      // ---- Supabase REST ----
      let m = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path);
      if (m && req.method === 'POST') {
        const { payload } = JSON.parse(await readBody(req));
        return send(res, 200, await rpc(m[1], payload));
      }
      // ---- Supabase Auth ----
      if (path === '/auth/v1/token' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        let user;
        if (u.searchParams.get('grant_type') === 'password') user = Object.values(USERS).find((x) => x.email === body.email && x.password === body.password);
        else user = Object.values(USERS).find((x) => `refresh-${x.id}` === body.refresh_token);
        if (!user) return send(res, 400, { error: 'invalid_grant' });
        const access = fakeJwt({ sub: user.id, email: user.email, aal: 'aal1' });
        tokens.set(access, user);
        return send(res, 200, { access_token: access, refresh_token: `refresh-${user.id}`, expires_in: 3600, user: { id: user.id, email: user.email } });
      }
      if (path === '/auth/v1/user') {
        const user = tokens.get((req.headers.authorization || '').replace('Bearer ', ''));
        return user ? send(res, 200, { id: user.id, email: user.email }) : send(res, 401, { error: 'unauthorized' });
      }
      if (path === '/auth/v1/logout') { tokens.delete((req.headers.authorization || '').replace('Bearer ', '')); return send(res, 204, {}); }

      // ---- Stripe ----
      if (path === '/v1/checkout/sessions' && req.method === 'POST') {
        const params = new URLSearchParams(await readBody(req));
        const lines = [];
        for (let i = 0; params.has(`line_items[${i}][quantity]`); i += 1) {
          lines.push({ quantity: Number(params.get(`line_items[${i}][quantity]`)), amount: Number(params.get(`line_items[${i}][price_data][unit_amount]`)), name: params.get(`line_items[${i}][price_data][product_data][name]`) });
        }
        const key = req.headers['idempotency-key'];
        const existing = [...sessions.values()].find((x) => key && x.key === key);
        const s = existing || { id: `cs_test_${randomUUID().replace(/-/g, '')}`, key, params, lines, status: 'open', payment_status: 'unpaid', email: params.get('customer_email') || 'buyer@example.test',
          shippingAmount: Number(params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]') || 0) };
        sessions.set(s.id, s);
        return send(res, 200, sessionObject(s));
      }
      m = /^\/v1\/checkout\/sessions\/(\w+)$/.exec(path);
      if (m) return sessions.has(m[1]) ? send(res, 200, sessionObject(sessions.get(m[1]))) : send(res, 404, { error: { message: 'No such session' } });
      m = /^\/pay\/(\w+)(?:\/(pay|cancel|expire))?$/.exec(path);
      if (m && sessions.has(m[1])) {
        const s = sessions.get(m[1]);
        if (!m[2]) return send(res, 200, payPage(s));
        if (m[2] === 'pay') {
          s.status = 'complete'; s.payment_status = 'paid';
          await sendEvent('checkout.session.completed', sessionObject(s));
          return send(res, 303, '', { Location: s.params.get('success_url').replace('{CHECKOUT_SESSION_ID}', s.id) });
        }
        if (m[2] === 'expire') { s.status = 'expired'; await sendEvent('checkout.session.expired', sessionObject(s)); }
        return send(res, 303, '', { Location: s.params.get('cancel_url') });
      }

      // ---- Resend ----
      if (path === '/emails' && req.method === 'POST') {
        if (state.failEmails) return send(res, 500, { message: 'simulated failure' });
        const mail = JSON.parse(await readBody(req));
        const id = `email_${emails.length + 1}`;
        emails.push({ id, ...mail });
        const name = `${String(emails.length).padStart(2, '0')}-${mail.subject.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}`;
        writeFileSync(join(emailDir, `${name}.html`), mail.html);
        writeFileSync(join(emailDir, `${name}.txt`), `From: ${mail.from}\nTo: ${mail.to}\nReply-To: ${mail.reply_to}\nSubject: ${mail.subject}\n\n${mail.text}`);
        return send(res, 200, { id });
      }

      // ---- Turnstile ----
      if (path === '/turnstile/v0/siteverify') {
        const body = JSON.parse(await readBody(req));
        return send(res, 200, { success: body.response === 'pass' });
      }
      send(res, 404, { error: 'not mocked' });
    } catch (e) {
      send(res, 500, { message: e.message });
    }
  });
  await new Promise((ok) => server.listen(port, ok));

  // The settings the Worker needs to talk to these stand-ins.
  const env = {
    ENVIRONMENT: 'development', SHOP_LIVE: 'false',
    SUPABASE_URL: base, SUPABASE_ANON_KEY: 'local-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'local-service-role-key',
    STRIPE_SECRET_KEY: 'sk_test_local', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_API_BASE: base,
    RESEND_API_KEY: 're_local', RESEND_API_BASE: base, TURNSTILE_VERIFY_URL: `${base}/turnstile/v0/siteverify`
  };
  return { db, env, emails, sessions, state, rpc, sendEvent, sessionObject, base, async stop() { server.closeAllConnections(); await new Promise((ok) => server.close(ok)); await db.stop(); } };
}
