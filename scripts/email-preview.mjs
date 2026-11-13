// Renders every email template with sample data into email-previews/ (HTML and plain text),
// so they can be opened in a browser or sent to a test inbox. Run: npm run email:preview
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { templates } from '../worker/email.js';
import { site } from '../config/site.mjs';

const out = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'email-previews');
const siteUrl = process.argv[2] || 'http://localhost:8787';
const order = {
  id: '00000000-0000-4000-8000-0000000000aa', number: 'NOVA-1001', status: 'paid', email: 'buyer@example.test', customer_name: 'Test Buyer',
  currency: 'EUR', language: 'en', subtotal: 51750, shipping_amount: 900, tax_amount: 11583, total: 64233, vat_id: 'IT12345678901',
  invoice_url: 'https://invoice.stripe.com/i/example', shipping_address: { name: 'Test Buyer', line1: 'Via Roma 1', postal_code: '80100', city: 'Napoli', country: 'IT' },
  items: [
    { name: 'NFC card, white PVC', variant_id: 'NFC-CARD-PVC-215', options: { chip: 'NTAG215' }, quantity: 25, unit_amount: 95, line_total: 2375, product_type: 'standard' },
    { name: 'Restaurant menu website', variant_id: 'WEB-MENU-STD', options: {}, quantity: 1, unit_amount: 49000, line_total: 49000, product_type: 'website' }
  ]
};
const samples = {
  order_confirmation: { order, siteUrl },
  new_order_alert: { order, siteUrl },
  problem_alert: { title: 'Webhook checkout.session.completed failed', details: { event: 'evt_123', error: 'database_error' }, siteUrl },
  low_stock_alert: { items: [{ variant_id: 'NFC-STAND-ACR-BLK', stock: 8, threshold: 10 }], siteUrl },
  contact_message: { kind: 'quote', name: 'Ada Rossi', business: 'Bar Ada', email: 'ada@example.test', message: 'We need 500 NFC stickers by March.', siteUrl }
};
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const lang of site.languages.map((l) => l.code)) {
  for (const [name, data] of Object.entries(samples)) {
    const mail = templates[name](data, lang);
    await writeFile(join(out, `${lang}-${name}.html`), mail.html);
    await writeFile(join(out, `${lang}-${name}.txt`), `Subject: ${mail.subject}\n\n${mail.text}\n`);
    console.log(`${lang}-${name}: ${mail.subject}`);
  }
}
