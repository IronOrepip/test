// Local development server: the built site and the Worker's API on http://localhost:8787,
// with local stand-ins for the database, Stripe, the email provider and sign-in.
// No account or key is needed. Run `npm run build` first, then `npm run dev`.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker/index.js';
import { startServices, USERS } from './lib/local-services.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };

// Serves dist/ the way Cloudflare's asset store does: folders with a trailing slash, 404 page.
const assets = {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\]|\.\.)+/, '');
    let file = join(dist, safe);
    if (!extname(file)) {
      if (!pathname.endsWith('/') && existsSync(join(file, 'index.html'))) return new Response(null, { status: 307, headers: { Location: `${pathname}/` } });
      file = join(file, 'index.html');
    }
    if (!file.startsWith(dist) || !existsSync(file)) return new Response(await readFile(join(dist, '404.html')), { status: 404, headers: { 'Content-Type': TYPES['.html'] } });
    return new Response(await readFile(file), { headers: { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' } });
  }
};

export async function startDev({ port = 8787, servicesPort = 8788, dbPort = 54329, env: extra = {}, quiet = false } = {}) {
  const origin = `http://localhost:${port}`;
  const services = await startServices({ port: servicesPort, dbPort, workerUrl: () => origin });
  const env = { ...services.env, SITE_URL: origin, ASSETS: assets, ...extra };
  const pending = new Set();
  const ctx = { waitUntil: (p) => { pending.add(p); Promise.resolve(p).catch(() => {}).finally(() => pending.delete(p)); } };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const request = new Request(`${origin}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const response = await worker.fetch(request, env, ctx);
    const out = {};
    response.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
    const cookies = response.headers.getSetCookie?.() || [];
    // The Secure flag stops cookies on plain http://localhost in some browsers; drop it locally only.
    if (cookies.length) out['set-cookie'] = cookies.map((c) => c.replace('; Secure', ''));
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(port, ok));
  if (!quiet) {
    console.log(`NOVA dev site:   ${origin}`);
    console.log(`Admin sign-in:   ${USERS.admin.email} / ${USERS.admin.password}`);
    console.log(`Captured emails: .dev/emails/`);
  }
  return { origin, services, env, settle: () => Promise.allSettled([...pending]), async stop() { server.closeAllConnections(); await new Promise((ok) => server.close(ok)); await services.stop(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dev = await startDev();
  process.on('SIGINT', async () => { await dev.stop(); process.exit(0); });
}
