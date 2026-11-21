import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const html = fs.readFileSync('alerts/index.html', 'utf8');
const feed = JSON.parse(fs.readFileSync('data/live/feed.json', 'utf8'));
const dom = new JSDOM(html, { url: 'https://kanlerxz87-cyber.github.io/KalshiDash1/alerts/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
// stub network: feed loads from the committed file, live poll is refused (feed-only mode)
w.fetch = async (u) => {
  if (String(u).includes('feed.json')) return { ok: true, status: 200, json: async () => feed };
  throw new Error('blocked in test');
};
w.HTMLCanvasElement.prototype.getContext = () => null;
for (const f of ['assets/freshness.js', 'alerts/js/alerts-live.js', 'alerts/js/alerts-page.js']) {
  w.eval(fs.readFileSync(f, 'utf8'));
}
await new Promise(r => setTimeout(r, 1500));
const rows = [...w.document.querySelectorAll('#await-table tbody tr')].map(tr => tr.textContent.replace(/\s+/g, ' ').trim());
console.log('awaiting rows:', rows.length);
rows.forEach(r => console.log(' -', r.slice(0, 150)));
console.log('note:', w.document.getElementById('awaiting-note').textContent);
console.log('res table:', w.document.querySelector('#res-table tbody').textContent.replace(/\s+/g,' ').slice(0,120));
