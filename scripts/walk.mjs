// Walks the full journey in a real browser at 375, 768, 996 and 1280 px and saves screenshots:
// home carousel -> product -> cart -> checkout -> success, then sign-in and the admin order list.
// Also checks: no console errors, no blocked resources, no sideways scrolling, keyboard-only use.
// Run `npm run build` first. Screenshots go to screenshots/.
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startDev } from './dev.mjs';
import { freePort, USERS } from './lib/local-services.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'screenshots');
await rm(shots, { recursive: true, force: true });
await mkdir(shots, { recursive: true });

const dev = await startDev({ port: await freePort(), servicesPort: await freePort(), dbPort: await freePort(), quiet: true });
const browser = await chromium.launch();
const problems = [];
const note = (msg) => { problems.push(msg); console.error(`  PROBLEM: ${msg}`); };

async function walk(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') note(`[${width}] console: ${m.text()}`); });
  page.on('pageerror', (e) => note(`[${width}] page error: ${e.message}`));
  page.on('requestfailed', (r) => { if (!r.url().includes('googletagmanager')) note(`[${width}] request failed: ${r.url()}`); });
  const shot = async (name, opts = {}) => {
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) note(`[${width}] ${name}: page scrolls sideways by ${overflow}px`);
    await page.screenshot({ path: join(shots, `${width}-${name}.png`), fullPage: opts.fullPage ?? true });
  };
  const go = (path) => page.goto(`${dev.origin}${path}`, { waitUntil: 'networkidle' });

  // 1. Home: cookie banner, then the page and the carousel.
  await go('/');
  await shot('01-home-cookie-banner', { fullPage: false });
  await page.getByRole('button', { name: 'Reject all' }).click();
  await shot('02-home');
  await page.locator('#discover').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Next products' }).click();
  await page.waitForTimeout(400);
  await shot('03-home-carousel', { fullPage: false });

  // 2. From the carousel to a product.
  await page.locator('[data-carousel-track]').evaluate((el) => el.scrollTo({ left: 0, behavior: 'instant' }));
  await page.locator('#discover').getByRole('link', { name: 'NFC card, white PVC', exact: true }).click();
  await page.waitForURL('**/products/nfc-card-white-pvc/');
  await page.waitForFunction(() => document.querySelector('[data-stock]')?.textContent === 'In stock');
  await page.getByRole('radio', { name: 'NTAG215' }).check({ force: true });
  await page.locator('#qty').fill('25');
  await page.locator('#qty').dispatchEvent('change');
  if ((await page.locator('[data-unit-price]').textContent()).trim() !== '€0.95') note(`[${width}] price break at 25 not shown`);
  await shot('04-product');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.locator('#cart-drawer[open]').waitFor();
  await page.locator('#cart-drawer .cart-line').first().waitFor();
  await shot('05-mini-cart', { fullPage: false });
  const orangeVisible = await page.evaluate(() => [...document.querySelectorAll('.btn--primary')].filter((b) => b.checkVisibility()).length);
  if (orangeVisible !== 1) note(`[${width}] ${orangeVisible} orange buttons visible with the mini cart open`);

  // 3. Cart page.
  await page.locator('#cart-drawer').getByRole('link', { name: 'View cart' }).click();
  await page.waitForURL('**/cart/');
  await page.locator('[data-cart-content]:not([hidden])').waitFor();
  await page.locator('#country').selectOption('IT');
  await page.waitForFunction(() => document.querySelector('[data-sum-shipping]')?.textContent.includes('9.00'));
  await shot('06-cart');
  const total = (await page.locator('[data-sum-total]').textContent()).trim();
  if (total !== '€32.75') note(`[${width}] cart total is ${total}, expected €32.75 (25 x 0.95 + 9.00)`);

  // 4. Checkout on the stand-in payment page, then the success page.
  await page.getByRole('button', { name: 'Check out' }).click();
  await page.waitForURL('**/pay/**');
  await shot('07-test-payment-page');
  await page.locator('#pay').click();
  await page.waitForURL('**/checkout/success/**');
  await page.getByRole('heading', { name: 'Thank you. Your order is confirmed.' }).waitFor();
  await shot('08-checkout-success');
  const cartAfter = await page.evaluate(() => localStorage.getItem('nova-cart-v1'));
  if (cartAfter !== '[]') note(`[${width}] cart not cleared after payment`);

  // 5. Shop, category, cancelled checkout, contact, about, help.
  await go('/shop/');
  await shot('09-shop');
  await page.locator('#f-type').selectOption('website');
  await shot('10-shop-filtered', { fullPage: false });
  await go('/shop/nfc-stands/');
  await shot('11-category');
  await go('/products/nfc-table-stand/');
  await page.waitForFunction(() => document.querySelector('[data-stock]')?.textContent !== 'Checking stock');
  await page.getByRole('radio', { name: 'White' }).check({ force: true });
  await shot('12-product-out-of-stock');
  if (!(await page.getByRole('button', { name: 'Add to cart' }).isDisabled())) note(`[${width}] out-of-stock option can be added`);
  await go('/products/restaurant-menu-website/');
  await shot('13-product-website');
  await go('/checkout/cancelled/');
  await shot('14-checkout-cancelled');
  await go('/contact/');
  await shot('15-contact');
  await go('/about/');
  await shot('16-about');
  await go('/help/returns/');
  await shot('17-help-returns');
  if (width < 1140) {
    await page.getByRole('button', { name: 'Open menu' }).click();
    await shot('18-nav-drawer', { fullPage: false });
    await page.keyboard.press('Escape');
  }

  // 6. Sign in as the admin and open the order list.
  await go('/account/sign-in/?next=/admin/');
  await shot('19-sign-in');
  await page.locator('#si-email').fill(USERS.admin.email);
  await page.locator('#si-password').fill(USERS.admin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/admin/');
  await page.locator('[data-admin-rows] tr').first().waitFor();
  await shot('20-admin-orders');
  await context.close();
}

// Keyboard only: reach and operate the product page, the mini cart and the cart without a mouse.
async function keyboard() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${dev.origin}/products/nfc-epoxy-tag/`, { waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  const skip = await page.evaluate(() => document.activeElement?.className);
  if (skip !== 'skip') note('keyboard: the first Tab does not reach the skip link');
  await page.getByRole('button', { name: 'Reject all' }).focus();
  await page.keyboard.press('Enter');
  await page.locator('#qty').focus();
  await page.keyboard.press('ArrowUp');
  await page.getByRole('button', { name: 'Add to cart' }).focus();
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
  if (!ring || ring === 'none') note('keyboard: no visible focus ring on the add button');
  await page.keyboard.press('Enter');
  await page.locator('#cart-drawer[open]').waitFor();
  const inDrawer = await page.evaluate(() => Boolean(document.activeElement?.closest('#cart-drawer')));
  if (!inDrawer) note('keyboard: focus does not move into the mini cart');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#cart-drawer').open);
  const back = await page.evaluate(() => document.activeElement?.hasAttribute('data-add'));
  if (!back) note('keyboard: focus does not return to the add button when the mini cart closes');
  await page.goto(`${dev.origin}/`, { waitUntil: 'networkidle' });
  const track = page.locator('[data-carousel-track]');
  await track.focus();
  const before = await track.evaluate((el) => el.scrollLeft);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(700);
  if ((await track.evaluate((el) => el.scrollLeft)) <= before) note('keyboard: arrow keys do not move the carousel');
  await context.close();
  console.log('keyboard walk done');
}

try {
  for (const width of [375, 768, 996, 1280]) { console.log(`walking at ${width}px`); await walk(width); }
  await keyboard();
} catch (e) {
  note(`walk stopped: ${e.message.split('\n').slice(0, 14).join(' | ')}`);
} finally {
  await browser.close();
  await dev.settle();
  await dev.stop();
}
console.log(problems.length ? `${problems.length} problem(s) found` : 'walk passed with no problems');
process.exit(problems.length ? 1 : 0);
