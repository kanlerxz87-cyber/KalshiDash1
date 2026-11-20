import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
const exePath = await chromium.executablePath();
console.log('exe:', exePath);
const browser = await puppeteer.launch({args: chromium.args, executablePath: exePath, headless: true});
const page = await browser.newPage();
page.on('console', m => console.log('[console]', m.text().slice(0,300)));
await page.goto('data:text/html,<h1>x</h1>');
const result = await page.evaluate(async () => {
  const out = {};
  const urls = {
    markets: 'https://external-api.demo.kalshi.co/trade-api/v2/markets?limit=1',
    status: 'https://external-api.demo.kalshi.co/trade-api/v2/exchange/status'
  };
  for (const [k,u] of Object.entries(urls)) {
    try {
      const r = await fetch(u, {method:'GET'});
      out[k] = 'HTTP ' + r.status;
    } catch (e) { out[k] = 'BLOCKED: ' + e.message; }
  }
  return out;
});
console.log('RESULT', JSON.stringify(result, null, 1));
await browser.close();
