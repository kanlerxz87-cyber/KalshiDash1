import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
const html = readFileSync('dashboard.html','utf8');
const dom = new JSDOM(html, { url:'https://x.test/dashboard.html', runScripts:'outside-only', pretendToBeVisual:true });
const w = dom.window;
const snap = { meta:{captured_at:new Date().toISOString()}, markets:[{ticker:'BADFIXTURE',topic:'elections',title:'x',status:'active',last_price_dollars:'0.003'}],
  orderbooks:{}, topics:{}, candlesticks:{ BADFIXTURE:{ m1:{ source_url:'u', candles:[[1,0.003],[61,0.822],[121,0.003]] } } } };
const feed = { meta:{generated_at:new Date().toISOString(),threshold:0.1}, alerts:[], markets:[], awaiting:[], resolutions:[], by_topic:{}, topics:{}, history:{}, orderbooks:{} };
w.fetch = async (u) => { const s=String(u);
  const body = s.includes('snapshot.json') ? snap : s.includes('feed.json') ? feed : (s.includes('exchange/status') ? {exchange_active:true,trading_active:true} : {markets:[],events:[],series:[]});
  return { ok:true, status:200, json:async()=>body, text:async()=>JSON.stringify(body) };
};
w.console.error = (...a)=>console.log('CONSOLE.ERR', ...a);
w.eval(readFileSync('assets/app.js','utf8'));
await new Promise(r=>setTimeout(r,1500));
console.log('mode', w.KD && w.KD.state && w.KD.state.mode);
console.log('alerts', w.KD.state.alerts.length, 'rejected', JSON.stringify(w.KD.state.replayRejected));
console.log('alerts sample', JSON.stringify(w.KD.state.alerts.slice(0,2)));
