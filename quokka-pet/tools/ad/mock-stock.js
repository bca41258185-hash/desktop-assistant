// 模擬報價來源（虛構代號、虛構公司、虛構價格）：攔截主行程的 net.fetch，不連外網
// 參考 scratchpad/fix3b/mock2.js 與第一版 mockStocks
const { net } = require('electron');
const NAMES = { '8888': '綠葉科技', '6666': '尤加利食品' };
global.__px = { '8888': [125.0, 125.0], '6666': [88.0, 88.0] };      // [昨收, 現價]
const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
function bars(sym, last, trend) {
  let s = sym.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0; const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const n = 120, ts = [], o = [], h = [], l = [], c = [], v = []; let p = last / (1 + trend); const now = Math.floor(Date.now() / 1000) - 86400;
  for (let i = 0; i < n; i++) { const t = now - (n - 1 - i) * 86400; const d = new Date(t * 1000).getUTCDay(); if (d === 0 || d === 6) continue; const op = p; p = p * (1 + trend / n + (r() - .5) * 0.03); ts.push(t); o.push(+op.toFixed(2)); c.push(+p.toFixed(2)); h.push(+(Math.max(op, p) * (1 + r() * .01)).toFixed(2)); l.push(+(Math.min(op, p) * (1 - r() * .01)).toFixed(2)); v.push(Math.round(2e6 + r() * 3e6)); }
  const kf = last / c[c.length - 1]; for (const A of [o, h, l, c]) for (let i = 0; i < A.length; i++) A[i] = +(A[i] * kf).toFixed(2);
  return { timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] }, meta: {} };
}
const orig = net.fetch.bind(net);
net.fetch = async (req, opt) => {
  const url = typeof req === 'string' ? req : req && req.url ? req.url : String(req);
  if (!/^https?:/.test(url)) return orig(req, opt);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
  if (url.includes('mis.twse.com.tw')) {
    const chs = decodeURIComponent(url.match(/ex_ch=([^&]+)/)[1]).split('|'), msgArray = [];
    for (const ch of chs) { const m = /^(tse|otc)_(\w+)\.tw$/.exec(ch); if (!m || m[1] !== 'tse' || !NAMES[m[2]]) continue; const [y, z] = global.__px[m[2]]; msgArray.push({ c: m[2], n: NAMES[m[2]], ex: 'tse', z: z.toFixed(2), y: y.toFixed(2), o: y.toFixed(2), h: Math.max(y, z).toFixed(2), l: Math.min(y, z).toFixed(2), v: '12000', d: day.replace(/-/g, ''), tlong: String(Date.now()) }); }
    return J({ msgArray, rtcode: '0000' });
  }
  if (url.includes('/v8/finance/chart/')) {
    const key = decodeURIComponent(url.split('/chart/')[1].split('?')[0]);
    if (key === '8888.TW') return J({ chart: { result: [bars(key, 125.0, 0.18)] } });
    if (key === '6666.TW') return J({ chart: { result: [bars(key, 88, -0.12)] } });
    if (key === '^TWII') return J({ chart: { result: [bars(key, 22000, 0.05)] } });
    return J({ chart: { result: null, error: { code: 'Not Found' } } });
  }
  if (/^https?:/.test(url)) throw new Error('廣告算圖：不連外網');
  return orig(req, opt);
};
global.__setPx = (sym, p) => { global.__px[sym][1] = p; try { global.v2.stocks.pollNow('tw'); } catch (e) { console.log('pollNow fail', e.message); } };
