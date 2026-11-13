# NOVA website and shop

The novaporto.eu website with its shop. Static pages are built from templates; the API runs on a Cloudflare Worker on the same domain. Design rules are in [DESIGN.md](./DESIGN.md).

**State: phase 1 ("Sell") is built and tested locally. Nothing is deployed, and the shop is closed (`SHOP_LIVE=false`).**

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs the tools. On npm 11 also run `npm install-scripts approve sharp esbuild workerd @embedded-postgres/windows-x64` once. |
| `npm run build` | Builds every page into `dist/`. Lists any missing translation. |
| `npm run dev` | Site and API on http://localhost:8787 with local stand-ins for the database, Stripe, sign-in and email. No keys needed. |
| `npm test` | 27 automated tests against a real local Postgres. |
| `npm run check` | Design check: values outside `tokens.css`, shadows, gradients, radii, typed logo, orange buttons per view. |
| `npm run walk` | Walks the full journey in a browser at 375, 768, 996 and 1280 px; screenshots in `screenshots/`. |
| `npm run email:preview` | Writes every email as HTML and text into `email-previews/`. |
| `npm run seed` | Loads `data/products.seed.json` into Supabase. Keeps live stock unless `-- --reset-stock`. |
| `npm run assets` | Re-exports fonts, logo PNGs and favicons from `brand/nova-logo.svg`. |
| `npm run bundle:check` | Checks that the Worker bundles, without deploying. |

## Where things are

| Path | Content |
|---|---|
| `config/site.mjs` | Company details (TODO), languages, regions, shipping rates, email addresses |
| `data/products.seed.json` | The catalogue. **Placeholder products and prices.** |
| `locales/en.json` | Every piece of interface, page and email text |
| `src/pages.mjs`, `src/lib/layout.mjs` | Page templates and the shared header, footer, cookie banner |
| `src/static/css/tokens.css` | The only file with colours, sizes and spacing values |
| `src/static/js/` | Small browser modules: cart, product, checkout, carousel, admin |
| `worker/` | The API: prices, checkout, Stripe webhook, emails, sign-in, admin |
| `supabase/migrations/` | Database schema, row-level security and the `api_*` functions |
| `tests/`, `scripts/` | Tests, build, local services, design check, browser walk |
| `index.html`, `2index.html`, `about.html`, `staging-worker.js` | The old site, kept untouched. `index.html` is still what GitHub Pages serves in production. |

To change a product: edit `data/products.seed.json`, run `npm run seed`, then `npm run build`. Prices shown at checkout always come from the database.

## How the shop protects itself

- The browser sends only product ids, variant ids and quantities. The Worker reads prices, price breaks, shipping and stock from the database.
- An order becomes `paid` only when a Stripe webhook with a valid signature arrives. The success page only reads.
- Stock is reserved when checkout starts (35 minutes), released when the session expires or is cancelled, and taken off when the order is paid.
- A region is sold to only when it is enabled in `config/site.mjs` and its payment provider has keys. UK and Russia are off.
- `SHOP_LIVE=false` on production means no payment session can be created and the cart shows "Shop opening soon". Staging refuses live Stripe keys.

## Setting up staging (steps for you)

Nothing below has been done. Do not change MX, SPF, DKIM, DMARC or autodiscover records at any step.

1. **Supabase.** Create a project in the EU (Frankfurt) region. Run `supabase/migrations/0001_init.sql` in the SQL editor. Create your user under Authentication, then make it the admin: `insert into public.profiles (id, role) values ('<your user id>', 'admin');`
2. **Stripe (test mode).**
   - Copy the test secret key.
   - Add a webhook endpoint `https://staging.novaporto.eu/api/stripe/webhook` with these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `invoice.paid`. Copy its signing secret.
   - Settings > Public details: set the Terms of service URL (`/legal/terms-of-sale/`). Checkout refuses to start without it, because the site asks Stripe to collect acceptance of the terms.
   - Switch on Stripe Tax and add your tax registrations. I have not guessed any.
   - Payment methods are not listed in code. Switch on cards, Apple Pay, Google Pay, Link, and later SEPA Debit, Klarna or PayPal under Settings > Payment methods. With hosted Checkout, Apple Pay and Google Pay need no domain registration; they would if we later embed Stripe Elements.
   - Branding: upload `src/static/brand/nova-logo-ink@2x.png`, brand colour `#101418`, accent `#f2500f`, button radius 4px, a sans-serif font.
   - Radar is on by default.
3. **Resend.** Add the domain `mail.novaporto.eu`. It gives you DNS records for that subdomain only; add them by hand in Cloudflare. Create the mailboxes `hello@`, `orders@`, `invoices@` in Microsoft 365, because replies go there.
4. **Turnstile.** Create a widget for `staging.novaporto.eu` and `novaporto.eu`.
5. **Secrets.** For each name in `.env.example`: `npx wrangler secret put NAME --env staging`.
6. **Seed and deploy.** `npm run seed`, then `npm run deploy:staging`. This replaces what staging shows now.
7. **Test with the Stripe CLI** (see "Not tested yet" below).

## Adding a language

1. Add one line to `languages` in `config/site.mjs`.
2. Add `locales/<code>.json`. Missing strings fall back to English and are listed by the build.
3. Add the translated product text under `translations` in the seed file.
4. Import the locale in `worker/email.js` and `worker/api.js` so emails use it.

## What was tested, and what was not

**Passed locally:** build, design check, Worker bundle, 27 automated tests, and the browser walk at four widths plus keyboard-only use. The tests cover price breaks, cart validation, order numbers, webhook signature and replay, duplicate webhooks, stock under concurrent checkouts, refunds, refused regions, a tampered price, and row-level security.

**Not tested yet, because it needs your accounts:**

- Anything against real Stripe: a card payment, 3D Secure, a declined card, a real expired session, real refunds, Stripe Tax amounts, invoices. Locally a stand-in plays Stripe.
- Real Supabase Auth and PostgREST. Locally the sign-in is a stand-in; the database itself is real Postgres.
- Real email delivery, and rendering in Outlook, Gmail and Apple Mail.
- Turnstile with real keys. Apple Pay needs a real device.

## Known gaps in phase 1

- Two-step sign-in for the admin is checked by the server but cannot be enrolled yet, so `ADMIN_REQUIRE_MFA` is `false` until phase 2.
- No customer accounts, order tracking page, newsletter, Italian or Russian yet (phase 2). The footer links to them are left out until the pages exist.
- Barlow and Barlow Condensed have no Cyrillic letters. Russian headings and body text would fall back to Arial unless a companion font is chosen.
- Stripe's promotion-consent option is, as far as I know, for US merchants only, so the news opt-in is a tick box on the cart page. Verify against Stripe's current docs.
- Three sample photos are from Wikimedia Commons (`src/static/img/samples/CREDITS.md`). Replace them.
- The social share image is still the old dark one.

## Values you must confirm (`TODO`)

- Company legal name, address, VAT number (`config/site.mjs`)
- Every product, price, stock level, tax code, HS code and origin (`data/products.seed.json`)
- Shipping rate (set to EUR 9.00) and delivery time, 3 to 7 working days (`config/site.mjs`)
- Returns, withdrawal, terms and privacy text, with a lawyer (`locales/en.json`, under `docs`)
- Demo links for the two website products

## Go-live checklist (draft, completed at the end of phase 2)

1. Register the company; fill in the company details.
2. Stripe: activate the account, switch on payment methods, Tax and Radar, add the live webhook.
3. Supabase project in the EU region, migration run, admin user created.
4. Set production secrets.
5. Add the email provider's DNS records without touching the existing mail records.
6. Move production hosting from GitHub Pages to the Worker (add the route in `wrangler.toml`).
7. Make one real payment and refund it.
8. Set `SHOP_LIVE=true`.
