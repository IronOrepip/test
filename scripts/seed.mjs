// Loads data/products.seed.json into the Supabase database through the api_seed function.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (never commit them).
// Stock already in the database is kept, unless you pass --reset-stock.
import { readFile } from 'node:fs/promises';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
  process.exit(1);
}
const seed = JSON.parse(await readFile(new URL('../data/products.seed.json', import.meta.url), 'utf8'));
const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/api_seed`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  body: JSON.stringify({ payload: { products: seed.products, reset_stock: process.argv.includes('--reset-stock') } })
});
if (!res.ok) { console.error(`Seeding failed: ${res.status} ${await res.text()}`); process.exit(1); }
console.log(`Seeded ${(await res.json()).products} products. Now run: npm run build`);
