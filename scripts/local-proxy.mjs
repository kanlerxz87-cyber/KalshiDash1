#!/usr/bin/env node
/* local-proxy.mjs — serve docs/ locally and proxy /api/* to the Kalshi demo API,
 * bypassing any browser CORS restriction while developing (Node 18+, no deps).
 *
 *   node scripts/local-proxy.mjs     # http://localhost:8080
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DOCS = path.join(process.cwd(), 'docs');
const UPSTREAM = process.env.KALSHI_API_ROOT || 'https://external-api.demo.kalshi.co/trade-api/v2';
const PORT = process.env.PORT || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    try {
      const upstream = await fetch(UPSTREAM + url.pathname.slice(4) + url.search);
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json' });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream failed', detail: String(e) }));
    }
    return;
  }
  let rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(DOCS, rel));
  if (!file.startsWith(DOCS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(PORT, () => {
  console.log(`KalshiDash1 local server: http://localhost:${PORT} ( /api/* -> ${UPSTREAM} )`);
  console.log('Tip: open the site and set localStorage "kalshidash:apiBase" is not needed — use js override:');
  console.log('  In the browser console: window.KALSHI_CONFIG.endpoints.primary="/api"; window.KALSHI_CONFIG.endpoints.legacy="/api";');
});
