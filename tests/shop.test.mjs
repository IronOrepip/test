// Phase 1 tests. They run the real Worker code against a real local Postgres with the
// migrations applied, plus local stand-ins for Stripe, sign-in and the email provider.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { verifySignature, buildSessionParams } from '../worker/payments/stripe.js';
import { startDev } from '../scripts/dev.mjs';
import { signStripe, WEBHOOK_SECRET, USERS, freePort } from '../scripts/lib/local-services.mjs';

let dev, origin, pool;
before(async () => {
  dev = await startDev({ port: await freePort(), servicesPort: await freePort(), dbPort: await freePort(), quiet: true });
  origin = dev.origin;
  pool = dev.services.db.pool;
});
after(async () => { await dev.settle(); await dev.stop(); });

// Each request comes from its own address unless a test sets one, so rate limits do not couple the tests.
let ipCounter = 0;
const nextIp = () => `198.51.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;
const post = (path, body, headers = {}) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': nextIp(), ...headers }, body: JSON.stringify(body) });
const price = async (items, country) => (await post('/api/cart/price', { items, country })).json();
const item = (product_id, variant_id, quantity, extra = {}) => ({ product_id, variant_id, quantity, ...extra });
const checkout = (items, extra = {}) => post('/api/checkout', { items, country: 'IT', lang: 'en', ...extra });
const stock = async (id) => (await pool.query('select stock from variants where id = $1', [id])).rows[0].stock;
const available = async (id) => (await pool.query('select available_stock($1) as a', [id])).rows[0].a;
const orderByNumber = async (n) => (await pool.query('select * from orders where number = $1', [n])).rows[0];
const sessionFor = (url) => dev.services.sessions.get(url.split('/pay/')[1]);
// Calls the Worker directly with different settings (for example production with the shop closed).
const direct = (path, { method = 'POST', body, env = {}, headers = {} } = {}) =>
  worker.fetch(new Request(`${origin}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': nextIp(), ...headers }, body: body ? JSON.stringify(body) : undefined }), { ...dev.env, ...env }, { waitUntil() {} });

async function payFor(items, extra) {
  const res = await checkout(items, extra);
  assert.equal(res.status, 200);
  const { url, order_number } = await res.json();
  const s = sessionFor(url);
  s.status = 'complete'; s.payment_status = 'paid';
  const sent = await dev.services.sendEvent('checkout.session.completed', dev.services.sessionObject(s));
  await dev.settle();
  return { order_number, session: s, sent };
}

// ---------- Prices and price breaks ----------
test('unit price follows the price breaks', async () => {
  for (const [qty, unit] of [[1, 120], [24, 120], [25, 95], [99, 95], [100, 75], [200, 75]]) {
    const cart = await price([item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', qty)]);
    assert.equal(cart.lines[0].unit_amount, unit, `qty ${qty}`);
    assert.equal(cart.lines[0].line_total, unit * qty);
    assert.equal(cart.subtotal, unit * qty);
  }
});

test('a variant with its own price list uses it', async () => {
  const cart = await price([item('NFC-CARD-PVC', 'NFC-CARD-PVC-216', 25)]);
  assert.equal(cart.lines[0].unit_amount, 160);
});

test('shipping is added from config for a sellable country and not for websites', async () => {
  const goods = await price([item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', 2)], 'IT');
  assert.deepEqual(goods.shipping, { amount: 900, min_days: 3, max_days: 7 });
  assert.equal(goods.total, 240 + 900);
  const site = await price([item('WEB-MENU', 'WEB-MENU-STD', 1)], 'IT');
  assert.equal(site.shipping, null);
  assert.equal(site.total, 49000);
});

// ---------- Cart validation ----------
test('cart validation: minimum, step, maximum, unknown and out-of-stock items', async () => {
  const cart = await price([
    item('NFC-STICKER-25', 'NFC-STICKER-25-213', 15),   // sold in tens
    item('NFC-STICKER-25', 'NFC-STICKER-25-213', 5),    // below the minimum of 10
    item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', 201),      // above 200: quote only
    item('NO-SUCH', 'NO-SUCH-1', 1),
    item('NFC-CARD-PVC', 'NFC-STICKER-25-213', 1),      // variant of another product
    item('NFC-STAND-ACR', 'NFC-STAND-ACR-WHT', 1),      // stock 0
    item('NFC-STAND-ACR', 'NFC-STAND-ACR-BLK', 41)      // only 40 in stock
  ]);
  assert.deepEqual(cart.lines.map((l) => l.status), ['invalid_quantity', 'invalid_quantity', 'over_max', 'unavailable', 'unavailable', 'out_of_stock', 'insufficient_stock']);
  assert.equal(cart.lines[6].left, 40);
  assert.equal(cart.ok, false);
  assert.equal(cart.subtotal, 0);
});

test('malformed carts are rejected', async () => {
  for (const body of [{ items: [] }, { items: 'x' }, { items: [{ product_id: 1, variant_id: 'a', quantity: 1 }] }, { items: [item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', 1.5)] }, { items: [item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', -3)] }]) {
    assert.equal((await post('/api/cart/price', body)).status, 400);
  }
});

test('a tampered request cannot change a price', async () => {
  const tampered = item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', 3, { unit_amount: 1, price: 1, line_total: 1 });
  const cart = await (await post('/api/cart/price', { items: [tampered], subtotal: 1, total: 1 })).json();
  assert.equal(cart.lines[0].unit_amount, 120);
  assert.equal(cart.subtotal, 360);
  const res = await checkout([tampered], { subtotal: 1, total: 1, shipping_amount: 0 });
  assert.equal(res.status, 200);
  const { url, order_number } = await res.json();
  const s = sessionFor(url);
  assert.equal(s.lines[0].amount, 120, 'the amount sent to the payment provider comes from the database');
  assert.equal(s.shippingAmount, 900);
  const order = await orderByNumber(order_number);
  assert.equal(Number(order.subtotal), 360);
  assert.equal(Number(order.shipping_amount), 900);
  await dev.services.sendEvent('checkout.session.expired', dev.services.sessionObject(s));
});

// ---------- Order numbers ----------
test('order numbers are readable, increasing and unique under load', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => checkout([item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', 1)]).then((r) => r.json())));
  const numbers = results.map((r) => r.order_number);
  assert.ok(numbers.every((n) => /^NOVA-\d{4,}$/.test(n)), numbers.join(','));
  assert.equal(new Set(numbers).size, 8);
  assert.ok(numbers.every((n) => Number(n.slice(5)) >= 1001));
  for (const r of results) await dev.services.sendEvent('checkout.session.expired', dev.services.sessionObject(sessionFor(r.url)));
});

// ---------- Webhook signature ----------
test('webhook signature: only a correct signature over the raw body is accepted', async () => {
  const body = JSON.stringify({ id: 'evt_sig_test', type: 'ping', data: { object: {} } });
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await verifySignature(WEBHOOK_SECRET, body, signStripe(body)), true);
  assert.equal(await verifySignature(WEBHOOK_SECRET, body, signStripe(body, 'whsec_wrong')), false, 'wrong secret');
  assert.equal(await verifySignature(WEBHOOK_SECRET, `${body} `, signStripe(body)), false, 'body changed after signing');
  assert.equal(await verifySignature(WEBHOOK_SECRET, body, signStripe(body, WEBHOOK_SECRET, now - 3600)), false, 'old timestamp (replay)');
  assert.equal(await verifySignature(WEBHOOK_SECRET, body, null), false, 'no header');
  assert.equal(await verifySignature(WEBHOOK_SECRET, body, 't=abc,v1=zz'), false, 'malformed header');

  const send = (headers) => fetch(`${origin}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  assert.equal((await send({})).status, 400);
  assert.equal((await send({ 'Stripe-Signature': signStripe(body, 'whsec_wrong') })).status, 400);
  assert.equal((await send({ 'Stripe-Signature': signStripe(body) })).status, 200);
});

test('an unsigned "paid" event does not mark an order paid', async () => {
  const res = await checkout([item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', 1)]);
  const { url, order_number } = await res.json();
  const s = sessionFor(url);
  const forged = dev.services.sessionObject({ ...s, status: 'complete', payment_status: 'paid' });
  const sent = await dev.services.sendEvent('checkout.session.completed', forged, { secret: 'whsec_attacker' });
  assert.equal(sent.status, 400);
  assert.equal((await orderByNumber(order_number)).status, 'pending');
  await dev.services.sendEvent('checkout.session.expired', dev.services.sessionObject(s));
});

// ---------- Paid orders, idempotency, emails ----------
test('a paid order: stock goes down once, emails go out once, a duplicate webhook changes nothing', async () => {
  const before = await stock('NFC-CARD-PVC-215');
  const emailsBefore = dev.services.emails.length;
  const { order_number, session, sent } = await payFor([item('NFC-CARD-PVC', 'NFC-CARD-PVC-215', 4)]);
  assert.equal(sent.status, 200);
  const order = await orderByNumber(order_number);
  assert.equal(order.status, 'paid');
  assert.equal(order.email, 'buyer@example.test');
  assert.equal(Number(order.subtotal), 480);
  assert.equal(Number(order.tax_amount), Math.round((480 + 900) * 0.22));
  assert.equal(order.shipping_address.country, 'IT');
  assert.equal(await stock('NFC-CARD-PVC-215'), before - 4);

  const mails = dev.services.emails.slice(emailsBefore);
  assert.deepEqual(mails.map((m) => m.subject), [`Your NOVA order ${order_number}`, `New order ${order_number}: €16.84`]);
  assert.equal(mails[0].to[0], 'buyer@example.test');
  assert.equal(mails[0].reply_to, 'orders@novaporto.eu');
  assert.match(mails[0].from, /orders@mail\.novaporto\.eu/);
  assert.ok(mails[0].text.includes('NFC card, white PVC') && mails[0].html.includes('nova-logo-ink@2x.png'));
  assert.equal(mails[1].to[0], 'orders@novaporto.eu');

  // Same event id again, then the same session under a new event id.
  const again = await dev.services.sendEvent('checkout.session.completed', dev.services.sessionObject(session), { id: sent.id });
  assert.equal(again.body.duplicate, true);
  await dev.services.sendEvent('checkout.session.completed', dev.services.sessionObject(session));
  await dev.settle();
  assert.equal(await stock('NFC-CARD-PVC-215'), before - 4);
  assert.equal(dev.services.emails.length, emailsBefore + 2);
  const log = await pool.query('select template, status from email_log where order_id = $1 order by id', [order.id]);
  assert.deepEqual(log.rows, [{ template: 'order_confirmation', status: 'sent' }, { template: 'new_order_alert', status: 'sent' }]);
  const history = await pool.query('select to_status, actor from order_status_log where order_id = $1 order by id', [order.id]);
  assert.deepEqual(history.rows, [{ to_status: 'pending', actor: 'system' }, { to_status: 'paid', actor: 'stripe' }]);
});

test('an order with a website goes to awaiting_details and needs the withdrawal tick box', async () => {
  const noTick = await checkout([item('WEB-MENU', 'WEB-MENU-STD', 1)]);
  assert.equal(noTick.status, 400);
  assert.equal((await noTick.json()).error, 'waiver_required');
  const { order_number } = await payFor([item('WEB-MENU', 'WEB-MENU-STD', 1)], { waiver: true });
  const order = await orderByNumber(order_number);
  assert.equal(order.status, 'awaiting_details');
  assert.ok(order.withdrawal_waiver_at);
  assert.equal(Number(order.shipping_amount), 0);
});

test('a failed email never fails the webhook, is logged, and is sent by the retry job', async () => {
  dev.services.state.failEmails = true;
  const { order_number, sent } = await payFor([item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', 1)]);
  assert.equal(sent.status, 200);
  const order = await orderByNumber(order_number);
  assert.equal(order.status, 'paid');
  const failed = await pool.query("select count(*)::int as n from email_log where order_id = $1 and status = 'failed'", [order.id]);
  assert.equal(failed.rows[0].n, 2);
  dev.services.state.failEmails = false;
  await pool.query("update email_log set created_at = now() - interval '5 minutes' where order_id = $1", [order.id]);
  const { retryFailedEmails } = await import('../worker/email.js');
  await retryFailedEmails(dev.env);
  const done = await pool.query("select count(*)::int as n from email_log where order_id = $1 and status = 'sent'", [order.id]);
  assert.equal(done.rows[0].n, 2);
});

test('an order paid with the email of a verified account is linked to it', async () => {
  const res = await checkout([item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', 1)]);
  const { url, order_number } = await res.json();
  const s = sessionFor(url);
  s.email = USERS.customer.email; s.status = 'complete'; s.payment_status = 'paid';
  await dev.services.sendEvent('checkout.session.completed', dev.services.sessionObject(s));
  assert.equal((await orderByNumber(order_number)).customer_id, USERS.customer.id);
});

// ---------- Stock reservation ----------
test('stock is reserved at checkout, released on expiry and never oversold under concurrent checkouts', async () => {
  const id = 'NFC-STICKER-25-215'; // 30 in stock, sold in tens
  assert.equal(await available(id), 30);
  const results = await Promise.all(Array.from({ length: 6 }, () => checkout([item('NFC-STICKER-25', id, 10)])));
  const ok = results.filter((r) => r.status === 200);
  const refused = results.filter((r) => r.status === 409);
  assert.equal(ok.length, 3, 'exactly three buyers get the 30 pieces');
  assert.equal(refused.length, 3);
  const body = await refused[0].json();
  assert.equal(body.error, 'cart_invalid');
  assert.equal(body.cart.lines[0].status, 'out_of_stock');
  assert.equal(await available(id), 0);
  assert.equal(await stock(id), 30, 'reserved, not yet decremented');
  assert.equal((await price([item('NFC-STICKER-25', id, 10)])).lines[0].status, 'out_of_stock');

  const sessions = await Promise.all(ok.map(async (r) => sessionFor((await r.json()).url)));
  // One buyer pays, one lets the session expire, one cancels (expires later).
  sessions[0].status = 'complete'; sessions[0].payment_status = 'paid';
  await dev.services.sendEvent('checkout.session.completed', dev.services.sessionObject(sessions[0]));
  await dev.services.sendEvent('checkout.session.expired', dev.services.sessionObject(sessions[1]));
  await dev.settle();
  assert.equal(await stock(id), 20, 'decremented when paid');
  assert.equal(await available(id), 10, 'the expired reservation is released, one is still held');
  const cancelled = await orderByNumber(sessions[1].params.get('metadata[order_number]'));
  assert.equal(cancelled.status, 'cancelled');

  // A reservation that passes its expiry time stops counting even without a webhook.
  await pool.query("update stock_reservations set expires_at = now() - interval '1 minute' where released_at is null and variant_id = $1", [id]);
  assert.equal(await available(id), 20);
  const partial = await price([item('NFC-STICKER-25', id, 30)]);
  assert.equal(partial.lines[0].status, 'insufficient_stock');
  assert.equal(partial.lines[0].left, 20);
});

test('a low-stock alert is emailed when a paid order takes stock to its threshold', async () => {
  const n = dev.services.emails.length;
  await payFor([item('NFC-STAND-ACR', 'NFC-STAND-ACR-BLK', 30)]); // 40 in stock, threshold 10
  assert.ok(dev.services.emails.slice(n).some((m) => m.subject === 'Low stock: NFC-STAND-ACR-BLK'));
});

// ---------- Refunds ----------
test('refund events set partially_refunded and refunded', async () => {
  const { order_number } = await payFor([item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', 10)]);
  const order = await orderByNumber(order_number);
  const charge = (amount_refunded) => ({ id: 'ch_test', object: 'charge', payment_intent: order.provider_payment_id, amount: Number(order.total), amount_refunded });
  await dev.services.sendEvent('charge.refunded', charge(500));
  assert.equal((await orderByNumber(order_number)).status, 'partially_refunded');
  await dev.services.sendEvent('charge.refunded', charge(Number(order.total)));
  const done = await orderByNumber(order_number);
  assert.equal(done.status, 'refunded');
  assert.equal(Number(done.amount_refunded), Number(order.total));
});

// ---------- Regions and shop state ----------
test('disabled regions are refused by the server', async () => {
  for (const country of ['GB', 'RU', 'US', 'XX', '']) {
    const res = await checkout([item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', 1)], { country });
    assert.equal(res.status, 400, country);
    assert.equal((await res.json()).error, 'region_unavailable');
  }
  assert.equal((await price([item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', 1)], 'GB')).region_ok, false);
  assert.equal((await price([item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', 1)], 'NO')).region_ok, true);
  const config = await (await fetch(`${origin}/api/config`)).json();
  assert.deepEqual(config.regions.map((r) => r.id), ['eu_eea']);
  assert.ok(!config.regions[0].countries.includes('GB') && config.regions[0].countries.length === 30);
});

test('only allowed countries are passed to the payment page', () => {
  const p = buildSessionParams({
    order: { id: 'o1', number: 'NOVA-1' }, cart: { currency: 'EUR', has_physical: true, lines: [{ quantity: 2, unit_amount: 120, name: 'Card', options: { chip: 'NTAG213' }, variant_id: 'V', tax_code: 'txcd_99999999' }] },
    region: 'eu_eea', shipping: { amount: 900, minDays: 3, maxDays: 7 }, countries: ['IT', 'FR'], urls: { success: 's', cancel: 'c' }, locale: 'en', expiresAt: 1, email: null, labels: { shipping: 'Shipping' }
  });
  assert.equal(p.get('mode'), 'payment');
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '120');
  assert.equal(p.get('line_items[0][price_data][product_data][name]'), 'Card (NTAG213)');
  assert.equal(p.get('automatic_tax[enabled]'), 'true');
  assert.equal(p.get('tax_id_collection[enabled]'), 'true');
  assert.equal(p.get('billing_address_collection'), 'required');
  assert.equal(p.get('consent_collection[terms_of_service]'), 'required');
  assert.equal(p.get('invoice_creation[enabled]'), 'true');
  assert.equal(p.get('allow_promotion_codes'), 'true');
  assert.deepEqual([p.get('shipping_address_collection[allowed_countries][0]'), p.get('shipping_address_collection[allowed_countries][1]'), p.get('shipping_address_collection[allowed_countries][2]')], ['IT', 'FR', null]);
  assert.ok(![...p.keys()].some((k) => k.startsWith('payment_method_types')), 'payment methods stay dynamic');
});

test('production stays closed until SHOP_LIVE is true, and live keys are refused outside production', async () => {
  const items = [item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', 1)];
  const closed = await direct('/api/checkout', { body: { items, country: 'IT' }, env: { ENVIRONMENT: 'production', SHOP_LIVE: 'false' } });
  assert.equal(closed.status, 403);
  assert.equal((await closed.json()).error, 'shop_closed');
  const config = await (await direct('/api/config', { method: 'GET', env: { ENVIRONMENT: 'production', SHOP_LIVE: 'false' } })).json();
  assert.equal(config.checkout_enabled, false);
  const liveKeyOnStaging = await direct('/api/checkout', { body: { items, country: 'IT' }, env: { ENVIRONMENT: 'staging', STRIPE_SECRET_KEY: 'sk_live_x', STAGING_USERNAME: '', STAGING_PASSWORD: '' } });
  assert.ok([403, 503].includes(liveKeyOnStaging.status));
});

// ---------- Request protection ----------
test('state-changing requests need this site as Origin, a JSON body and a passing Turnstile check', async () => {
  const items = [item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', 1)];
  const noOrigin = await fetch(`${origin}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, country: 'IT' }) });
  assert.equal(noOrigin.status, 403);
  assert.equal((await post('/api/checkout', { items, country: 'IT' }, { Origin: 'https://evil.example' })).status, 403);
  const form = await fetch(`${origin}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: origin }, body: 'x' });
  assert.equal(form.status, 415);
  const withTurnstile = { TURNSTILE_SECRET_KEY: 'secret' };
  assert.equal((await direct('/api/checkout', { body: { items, country: 'IT', turnstile: 'wrong' }, env: withTurnstile })).status, 400);
  assert.equal((await direct('/api/checkout', { body: { items, country: 'IT' }, env: withTurnstile })).status, 400);
  const ok = await direct('/api/checkout', { body: { items, country: 'IT', turnstile: 'pass' }, env: withTurnstile });
  assert.equal(ok.status, 200);
  const missingSecretOnStaging = await direct('/api/contact', { body: { name: 'A', email: 'a@b.eu', message: 'Hi' }, env: { ENVIRONMENT: 'staging', STAGING_USERNAME: '', STAGING_PASSWORD: '' } });
  assert.ok([401, 503].includes(missingSecretOnStaging.status), 'staging never skips its checks');
});

test('the success endpoint only reads: it never marks an order paid', async () => {
  const res = await checkout([item('NFC-CARD-PVC', 'NFC-CARD-PVC-213', 1)]);
  const { url, order_number } = await res.json();
  const s = sessionFor(url);
  const view = await (await fetch(`${origin}/api/checkout/session?session_id=${s.id}`)).json();
  assert.equal(view.status, 'pending');
  assert.equal(view.number, order_number);
  assert.equal((await orderByNumber(order_number)).status, 'pending');
  assert.equal((await fetch(`${origin}/api/checkout/session?session_id=cs_test_doesnotexist000`)).status, 404);
  await dev.services.sendEvent('checkout.session.expired', dev.services.sessionObject(s));
});

test('security headers are set and API responses are not cached', async () => {
  const page = await fetch(`${origin}/shop/`);
  assert.equal(page.status, 200);
  const csp = page.headers.get('content-security-policy');
  assert.ok(csp.includes("default-src 'self'") && csp.includes('https://challenges.cloudflare.com') && !csp.includes('unsafe-inline'));
  assert.ok(page.headers.get('strict-transport-security'));
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${origin}/api/config`)).headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${origin}/no-such-page/`)).status, 404);
});

test('staging keeps its password gate, except for the signed webhook', async () => {
  const env = { ENVIRONMENT: 'staging', STAGING_USERNAME: 'nova', STAGING_PASSWORD: 'long-staging-password' };
  assert.equal((await direct('/shop/', { method: 'GET', env })).status, 401);
  assert.equal((await direct('/api/config', { method: 'GET', env })).status, 401);
  const ok = await direct('/api/config', { method: 'GET', env, headers: { Authorization: `Basic ${Buffer.from('nova:long-staging-password').toString('base64')}` } });
  assert.equal(ok.status, 200);
  assert.equal((await direct('/shop/', { method: 'GET', env: { ENVIRONMENT: 'staging', STAGING_USERNAME: '', STAGING_PASSWORD: '' } })).status, 503, 'fails closed without secrets');
  const hook = await direct('/api/stripe/webhook', { body: {}, env });
  assert.equal(hook.status, 400, 'reaches the signature check instead of the password prompt');
});

// ---------- Sign-in and admin ----------
const cookieFrom = (res) => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');

test('the admin order list is only for the admin, checked on the server', async () => {
  assert.equal((await fetch(`${origin}/api/admin/orders`)).status, 401);
  const bad = await post('/api/auth/sign-in', { email: USERS.admin.email, password: 'wrong' });
  const unknown = await post('/api/auth/sign-in', { email: 'nobody@example.test', password: 'wrong' });
  assert.equal(bad.status, 401);
  assert.deepEqual(await bad.json(), await unknown.json(), 'the same answer whether or not the email exists');

  const customer = await post('/api/auth/sign-in', { email: USERS.customer.email, password: USERS.customer.password });
  assert.equal(customer.status, 200);
  assert.equal((await fetch(`${origin}/api/admin/orders`, { headers: { Cookie: cookieFrom(customer) } })).status, 403);

  const admin = await post('/api/auth/sign-in', { email: USERS.admin.email, password: USERS.admin.password });
  const setCookies = admin.headers.getSetCookie();
  assert.ok(setCookies.every((c) => /HttpOnly/.test(c) && /SameSite=Lax/.test(c)));
  const list = await fetch(`${origin}/api/admin/orders?status=paid`, { headers: { Cookie: cookieFrom(admin) } });
  assert.equal(list.status, 200);
  const data = await list.json();
  assert.ok(data.total >= 1 && data.orders.every((o) => o.status === 'paid'));
  const search = await (await fetch(`${origin}/api/admin/orders?q=${data.orders[0].number}`, { headers: { Cookie: cookieFrom(admin) } })).json();
  assert.equal(search.orders[0].number, data.orders[0].number);
  const mfa = await direct('/api/admin/orders', { method: 'GET', env: { ADMIN_REQUIRE_MFA: 'true' }, headers: { Cookie: cookieFrom(admin) } });
  assert.equal(mfa.status, 403, 'with two-step sign-in required, a password-only session is refused');
});

// ---------- Row-level security ----------
async function asRole(role, sub, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    if (sub) await client.query("select set_config('request.jwt.claim.sub', $1, true)", [sub]);
    return await fn(client);
  } finally {
    await client.query('rollback').catch(() => {});
    client.release();
  }
}

test('row-level security: customer A cannot read customer B\'s order', async () => {
  const a = USERS.customer.id, b = USERS.admin.id;
  await pool.query(`insert into orders (number, region, payment_provider, customer_id, email, status) values ('RLS-A', 'eu_eea', 'stripe', $1, 'a@example.test', 'paid'), ('RLS-B', 'eu_eea', 'stripe', $2, 'b@example.test', 'paid')`, [a, b]);
  await pool.query(`insert into order_items (order_id, product_id, variant_id, product_type, name, quantity, unit_amount, line_total)
    select id, 'NFC-CARD-PVC', 'NFC-CARD-PVC-213', 'standard', 'Card', 1, 120, 120 from orders where number in ('RLS-A', 'RLS-B')`);

  const mine = (await pool.query('select count(*)::int as n from orders where customer_id = $1', [a])).rows[0].n;
  const seenByA = await asRole('authenticated', a, (c) => c.query('select number, customer_id from orders'));
  assert.equal(seenByA.rowCount, mine, 'A sees all of their own orders');
  assert.ok(seenByA.rows.every((r) => r.customer_id === a) && seenByA.rows.some((r) => r.number === 'RLS-A'));
  const direct = await asRole('authenticated', a, (c) => c.query("select number from orders where number = 'RLS-B'"));
  assert.equal(direct.rowCount, 0, 'the order of B is invisible to A even when asked for by number');
  const itemsA = await asRole('authenticated', a, (c) => c.query('select o.customer_id from order_items i join orders o on o.id = i.order_id'));
  assert.ok(itemsA.rowCount >= 1 && itemsA.rows.every((r) => r.customer_id === a));
  const foreignItems = await asRole('authenticated', a, (c) => c.query("select count(*)::int as n from order_items where order_id = (select id from orders where number = 'RLS-B')"));
  assert.equal(foreignItems.rows[0].n, 0);
  const seenByB = await asRole('authenticated', b, (c) => c.query("select number from orders where number like 'RLS-%'"));
  assert.deepEqual(seenByB.rows.map((r) => r.number), ['RLS-B']);
  const profiles = await asRole('authenticated', a, (c) => c.query('select id from profiles'));
  assert.deepEqual(profiles.rows.map((r) => r.id), [a]);

  // A customer cannot change rows, and sees nothing in the internal tables.
  const update = await asRole('authenticated', a, (c) => c.query("update orders set status = 'refunded' where number = 'RLS-A'"));
  assert.equal(update.rowCount, 0);
  for (const table of ['email_log', 'webhook_events', 'stock_reservations', 'order_status_log', 'rate_limits', 'variants', 'price_breaks']) {
    const r = await asRole('authenticated', a, (c) => c.query(`select count(*)::int as n from ${table}`));
    assert.equal(r.rows[0].n, 0, table);
  }
  const anon = await asRole('anon', null, (c) => c.query('select count(*)::int as n from orders'));
  assert.equal(anon.rows[0].n, 0);

  // The api_* functions are for the service role only.
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(asRole(role, a, (c) => c.query("select api_admin_orders('{}'::jsonb)")), /permission denied/);
    await assert.rejects(asRole(role, a, (c) => c.query(`select api_mark_paid('{"order_id":"00000000-0000-0000-0000-000000000000"}'::jsonb)`)), /permission denied/);
    await assert.rejects(asRole(role, a, (c) => c.query("select nextval('order_number_seq')")), /permission denied/);
  }
  const tables = await pool.query("select count(*)::int as n from pg_tables where schemaname = 'public' and not rowsecurity");
  assert.equal(tables.rows[0].n, 0, 'row-level security is on for every table');
});

// ---------- Contact form ----------
test('the contact form emails the message with the sender as Reply-To', async () => {
  const n = dev.services.emails.length;
  assert.equal((await post('/api/contact', { name: 'Ada', email: 'not-an-email', message: 'Hi' })).status, 400);
  const res = await post('/api/contact', { kind: 'quote', name: 'Ada', business: 'Bar Ada', email: 'ada@example.test', message: '500 stickers by March' });
  assert.equal(res.status, 200);
  const mail = dev.services.emails[n];
  assert.equal(mail.subject, 'Quote request from Ada');
  assert.equal(mail.to[0], 'info@novaporto.eu');
  assert.equal(mail.reply_to, 'ada@example.test');
});

test('rate limits stop repeated attempts', async () => {
  let last;
  for (let i = 0; i < 7; i += 1) last = await post('/api/contact', { name: 'Ada', email: 'ada@example.test', message: `Message ${i}` }, { 'CF-Connecting-IP': '203.0.113.9' });
  assert.equal(last.status, 429);
});
