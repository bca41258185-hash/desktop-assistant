// 股價服務 StockService（規格第 7 節）：依市場交易時間排程輪詢台股（證交所 MIS）與美股（Yahoo chart）。
//
// - 台股一次請求最多 50 個頻道（tse_/otc_），美股一檔一次。
// - 一個市場一個計時器；多隻庫卡盯同一檔只抓一次，結果分送給所有訂閱者。
// - 抓不到時退避 5 秒 → 10 → 20 … 最多 5 分鐘，並送出 stale: true；恢復後清掉並標 recovered: true。
// - fetch、now()、setTimer/clearTimer 都可注入，方便測試。
//
// 時區一律用 Intl API 計算（自動處理美國日光節約），不寫死 UTC 偏移。
'use strict';

const MIN = 60 * 1000;
const MARKETS = {
  tw: { tz: 'Asia/Taipei', open: 9 * 60, close: 13 * 60 + 30, interval: 5000 },
  us: { tz: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60, interval: 15000 },
};
const CLOSED_INTERVAL = 30 * MIN;      // 非交易時間：每 30 分鐘確認一次
const BACKOFF_BASE = 5000;             // 退避起點 5 秒
const BACKOFF_MAX = 5 * MIN;           // 退避上限 5 分鐘
const HOLIDAY_GRACE_MIN = 15;          // 開盤後 15 分鐘仍沒有當日成交 → 視為休市日
const AFTER_CLOSE_WINDOW_MIN = 10;     // 收盤後 10 分鐘內每分鐘抓一次，拿到最終收盤價
const AFTER_CLOSE_INTERVAL = MIN;
const TW_BATCH = 50;                   // 台股一次最多 50 個頻道

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TW_HEADERS = {
  'User-Agent': BROWSER_UA,
  Referer: 'https://mis.twse.com.tw/stock/index.jsp',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
};
const US_HEADERS = { 'User-Agent': BROWSER_UA, Accept: 'application/json' };
const TW_URL = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';
const US_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';

// ───────── 時區工具 ─────────
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map();
function formatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}
// 取得某時刻在指定時區的年月日時分秒與星期
function zonedParts(date, tz) {
  const o = {};
  for (const p of formatter(tz).formatToParts(date)) o[p.type] = p.value;
  return {
    year: +o.year, month: +o.month, day: +o.day,
    hour: +o.hour % 24, minute: +o.minute, second: +o.second,
    weekday: WEEKDAY[o.weekday],
  };
}
const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (p) => `${p.year}-${pad(p.month)}-${pad(p.day)}`;
// 某時刻在指定時區的日期字串 YYYY-MM-DD
function zonedDay(ms, tz) { return ymdOf(zonedParts(new Date(ms), tz)); }
// 該時區相對 UTC 的偏移（毫秒）
function tzOffset(ms, tz) {
  const p = zonedParts(new Date(ms), tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
// 指定時區的當地時間 → UTC 毫秒（日光節約切換時再校正一次）
function zonedToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffset(guess, tz);
  let t = guess - off1;
  const off2 = tzOffset(t, tz);
  if (off2 !== off1) t = guess - off2;
  return t;
}

// ───────── 交易時間（純函式） ─────────
function cfgOf(market) {
  const c = MARKETS[market];
  if (!c) throw new Error(`不支援的市場：${market}`);
  return c;
}
// 現在是否為該市場的交易時間（不含國定假日判斷；假日由 nextPollDelay 以「沒有當日成交」推測）
function isMarketOpen(market, date = new Date()) {
  const c = cfgOf(market);
  const p = zonedParts(date, c.tz);
  if (p.weekday === 0 || p.weekday === 6) return false;
  const mins = p.hour * 60 + p.minute + p.second / 60;
  return mins >= c.open && mins < c.close;
}
// 距離下一次開盤（週一到五）的毫秒數
function msUntilNextOpen(market, date = new Date()) {
  const c = cfgOf(market);
  const now = date.getTime();
  const p = zonedParts(date, c.tz);
  for (let k = 0; k <= 8; k++) {
    const cal = new Date(Date.UTC(p.year, p.month - 1, p.day + k));
    const wd = cal.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const t = zonedToUtc(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), Math.floor(c.open / 60), c.open % 60, c.tz);
    if (t > now) return t - now;
  }
  return CLOSED_INTERVAL;
}
// 距離今天收盤的毫秒數（可能為負）
function msUntilClose(market, date = new Date()) {
  const c = cfgOf(market);
  const p = zonedParts(date, c.tz);
  return zonedToUtc(p.year, p.month, p.day, Math.floor(c.close / 60), c.close % 60, c.tz) - date.getTime();
}
function backoffDelay(failures) {
  return Math.min(BACKOFF_BASE * 2 ** Math.max(0, failures - 1), BACKOFF_MAX);
}
// 下一次輪詢要等多久（毫秒）。
// state：{ failures: 連續失敗次數, lastTradeDay: 目前資料中最新的交易日 'YYYY-MM-DD' }
function nextPollDelay(market, date = new Date(), state = {}) {
  const c = cfgOf(market);
  if (state.failures > 0) return backoffDelay(state.failures);
  const p = zonedParts(date, c.tz);
  const today = ymdOf(p);
  const mins = p.hour * 60 + p.minute + p.second / 60;
  const weekend = p.weekday === 0 || p.weekday === 6;
  // 最新資料的交易日早於今天 → 今天還沒有成交
  const noTradeToday = !!state.lastTradeDay && state.lastTradeDay < today;
  if (isMarketOpen(market, date)) {
    const untilClose = msUntilClose(market, date);
    // 假日推測：開盤一段時間後仍沒有任何當日成交 → 降成 30 分鐘一次（若之後出現成交會自動恢復）
    if (noTradeToday && mins - c.open >= HOLIDAY_GRACE_MIN) return Math.min(CLOSED_INTERVAL, Math.max(untilClose, 1000));
    return Math.max(200, Math.min(c.interval, untilClose));
  }
  // 週末不輪詢：直接睡到下週一開盤
  if (weekend) return msUntilNextOpen(market, date);
  // 剛收盤：每分鐘抓一次，直到拿到最終收盤價（休市日不需要）
  if (!noTradeToday && mins >= c.close && mins < c.close + AFTER_CLOSE_WINDOW_MIN) return AFTER_CLOSE_INTERVAL;
  return Math.min(CLOSED_INTERVAL, msUntilNextOpen(market, date));
}

// ───────── 解析（純函式） ─────────
function num(v) {
  if (v == null || v === '-' || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
const firstLevel = (s) => (typeof s === 'string' ? num(s.split('_')[0]) : null);
const pctOf = (price, prev) => (price != null && prev != null ? ((price - prev) / prev) * 100 : null);

// 解析證交所 MIS 的一筆 msgArray；沒有代號（查無此股）回傳 null
function parseTwQuote(msg) {
  if (!msg || !msg.c) return null;
  const last = num(msg.z), prevClose = num(msg.y);
  const ask = firstLevel(msg.a), bid = firstLevel(msg.b);
  let price = last, source = last != null ? 'trade' : null;
  if (price == null) {
    // 還沒成交：用最佳買賣價中間值；只有單邊（例如漲跌停鎖死）就用那一邊
    if (ask != null && bid != null) { price = (ask + bid) / 2; source = 'mid'; }
    else if (bid != null) { price = bid; source = 'bid'; }
    else if (ask != null) { price = ask; source = 'ask'; }
  }
  const d = /^\d{8}$/.test(msg.d || '') ? `${msg.d.slice(0, 4)}-${msg.d.slice(4, 6)}-${msg.d.slice(6)}` : null;
  const tlong = Number(msg.tlong);
  const time = Number.isFinite(tlong) && tlong > 0 ? tlong : null;
  return {
    symbol: String(msg.c).toUpperCase(), market: 'tw', ex: msg.ex || null, name: msg.n || null,
    price, prevClose, pct: pctOf(price, prevClose), source,
    open: num(msg.o), high: num(msg.h), low: num(msg.l), volume: num(msg.v) != null ? num(msg.v) * 1000 : null,   // 今日開高低、成交量（張 → 股）
    time, day: d || (time ? zonedDay(time, MARKETS.tw.tz) : null),
  };
}
// 解析 Yahoo chart 的 meta；symbol 是使用者看到的代號（例如 BRK.B）
function parseUsMeta(meta, symbol) {
  if (!meta) return null;
  const price = num(meta.regularMarketPrice);
  const prevClose = num(meta.previousClose) ?? num(meta.chartPreviousClose);
  const time = Number(meta.regularMarketTime) > 0 ? Number(meta.regularMarketTime) * 1000 : null;
  const tz = meta.exchangeTimezoneName || MARKETS.us.tz;
  return {
    symbol: symbol || String(meta.symbol || '').replace(/-/g, '.'), market: 'us',
    name: meta.longName || meta.shortName || null, currency: meta.currency || null,
    price, prevClose, pct: pctOf(price, prevClose), source: price != null ? 'trade' : null,
    open: num(meta.regularMarketOpen), high: num(meta.regularMarketDayHigh), low: num(meta.regularMarketDayLow), volume: num(meta.regularMarketVolume),
    time, day: time ? zonedDay(time, tz) : null,
  };
}
// Yahoo 的代號用「-」：BRK.B → BRK-B
const toYahooSymbol = (s) => String(s).trim().toUpperCase().replace(/\./g, '-');
const twChannels = (sym, ex) => (ex ? [`${ex}_${sym}.tw`] : [`tse_${sym}.tw`, `otc_${sym}.tw`]);

// 把 { symbol, market } 正規化；不合法回傳 null
function normalizeItem(it) {
  if (!it) return null;
  const market = String(it.market || '').toLowerCase();
  const symbol = String(it.symbol || '').trim().toUpperCase();
  if (market === 'tw' && /^\d{4,6}[A-Z]?$/.test(symbol)) return { symbol, market, ex: it.ex === 'tse' || it.ex === 'otc' ? it.ex : null };
  if (market === 'us' && /^[A-Z]{1,5}([.-][A-Z])?$/.test(symbol)) return { symbol, market };
  return null;
}
const keyOf = (market, symbol) => `${market}:${symbol}`;

// ───────── 服務 ─────────
function createStockService({
  fetch = globalThis.fetch,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onUpdate = null,
  timeoutMs = 10000,
  lookupAttempts = 3,      // lookup 失敗時最多嘗試幾次（證交所防火牆偶爾會擋單次請求）
} = {}) {
  if (typeof fetch !== 'function') throw new Error('缺少 fetch 函式，無法取得報價');
  const listeners = new Set();
  if (typeof onUpdate === 'function') listeners.add(onUpdate);
  const owners = new Map();        // 訂閱者 → [key]
  const watch = new Map();         // key → { symbol, market }（所有訂閱者的聯集，已去重）
  const quotes = new Map();        // key → 最後一筆報價
  const exCache = new Map();       // 台股代號 → 'tse' | 'otc'
  const mk = {};
  for (const m of Object.keys(MARKETS)) mk[m] = { timer: null, failures: 0, lastTradeDay: null, inFlight: false, again: false };
  let running = false;

  function emit(q) {
    for (const fn of listeners) {
      try { fn({ ...q }); } catch (e) { /* 訂閱者自己的錯誤不影響服務 */ }
    }
  }

  async function getJson(url, headers) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = ctrl ? setTimer(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, { headers, signal: ctrl ? ctrl.signal : undefined });
      if (!res.ok) {
        const err = new Error(`報價來源回應錯誤（HTTP ${res.status}）`);
        err.status = res.status;
        throw err;
      }
      const text = await res.text();
      try { return JSON.parse(text); } catch (e) { throw new Error('報價來源回傳的內容不是 JSON'); }
    } finally {
      if (t != null) clearTimer(t);
    }
  }

  async function fetchTw(channels) {
    const url = `${TW_URL}?ex_ch=${encodeURIComponent(channels.join('|'))}&json=1&delay=0&_=${now()}`;
    const j = await getJson(url, TW_HEADERS);
    if (!j || !Array.isArray(j.msgArray)) throw new Error('證交所回應格式不正確（缺少 msgArray）');
    return j.msgArray.map(parseTwQuote).filter(Boolean);
  }
  // 回傳 quote；查無此代號回傳 null；連線失敗則丟出錯誤
  async function fetchUs(symbol) {
    const url = `${US_URL}${encodeURIComponent(toYahooSymbol(symbol))}?interval=1m&range=1d`;
    let j;
    try { j = await getJson(url, US_HEADERS); } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
    const r = j && j.chart && Array.isArray(j.chart.result) ? j.chart.result[0] : null;
    if (!r || !r.meta) {
      if (j && j.chart && j.chart.error) return null;
      throw new Error('Yahoo 回應格式不正確（缺少 chart.result）');
    }
    return parseUsMeta(r.meta, symbol);
  }

  // 有變化才分送，避免每 5 秒重複通知同樣的數字
  function deliver(key, q) {
    const prev = quotes.get(key);
    const out = { ...q, stale: false };
    quotes.set(key, out);
    if (!prev || prev.stale || prev.price !== out.price || prev.prevClose !== out.prevClose ||
        prev.time !== out.time || prev.name !== out.name || prev.day !== out.day) {
      // 規格：恢復後重新以第一筆報價當基準 → 標 recovered 讓上層重設
      emit(prev && prev.stale ? { ...out, recovered: true } : out);
    }
  }
  function markStale(key) {
    const prev = quotes.get(key);
    if (!prev || prev.stale) return;
    const out = { ...prev, stale: true };
    quotes.set(key, out);
    emit(out);
  }
  function itemsOf(market) { return [...watch.values()].filter((w) => w.market === market); }

  async function pollTw(items) {
    // 分批：每批頻道數不超過 50（未知上市／上櫃的代號要佔兩個頻道）
    const batches = [];
    let cur = [], n = 0;
    for (const it of items) {
      const ch = twChannels(it.symbol, exCache.get(it.symbol) || it.ex);
      if (n + ch.length > TW_BATCH && cur.length) { batches.push(cur); cur = []; n = 0; }
      cur.push({ it, ch }); n += ch.length;
    }
    if (cur.length) batches.push(cur);
    let okBatches = 0;
    await Promise.all(batches.map(async (b) => {
      try {
        const list = await fetchTw(b.flatMap((x) => x.ch));
        okBatches++;
        const bySym = new Map();
        for (const q of list) if (!bySym.has(q.symbol) || q.price != null) bySym.set(q.symbol, q);
        for (const { it } of b) {
          const q = bySym.get(it.symbol);
          if (!q) continue;                       // 查無此代號：不更新
          if (q.ex) exCache.set(it.symbol, q.ex);
          deliver(keyOf('tw', it.symbol), q);
        }
      } catch (e) {
        for (const { it } of b) markStale(keyOf('tw', it.symbol));
      }
    }));
    return okBatches > 0 || batches.length === 0;
  }
  async function pollUs(items) {
    let ok = 0;
    await Promise.all(items.map(async (it) => {
      const key = keyOf('us', it.symbol);
      try {
        const q = await fetchUs(it.symbol);
        ok++;
        if (q) deliver(key, q);
      } catch (e) {
        markStale(key);
      }
    }));
    return ok > 0 || items.length === 0;
  }

  async function poll(market) {
    const st = mk[market];
    if (st.inFlight) { st.again = true; return; }
    st.inFlight = true;
    if (st.timer != null) { clearTimer(st.timer); st.timer = null; }
    try {
      const items = itemsOf(market);
      if (!items.length) return;
      const ok = market === 'tw' ? await pollTw(items) : await pollUs(items);
      st.failures = ok ? 0 : st.failures + 1;
      // 這個市場目前資料中最新的交易日（給假日推測用）
      let last = null;
      for (const it of items) {
        const q = quotes.get(keyOf(market, it.symbol));
        if (q && q.day && (!last || q.day > last)) last = q.day;
      }
      st.lastTradeDay = last;
    } finally {
      st.inFlight = false;
      if (st.again) { st.again = false; poll(market); } else schedule(market);
    }
  }

  function schedule(market) {
    const st = mk[market];
    if (st.timer != null) { clearTimer(st.timer); st.timer = null; }
    if (!running || !itemsOf(market).length) return;
    const delay = nextPollDelay(market, new Date(now()), st);
    st.timer = setTimer(() => { st.timer = null; poll(market); }, delay);
  }

  // 更新某個訂閱者（例如某隻庫卡）要盯的清單；所有訂閱者的清單會合併去重
  function setWatchlist(list, owner = 'default') {
    const before = new Set(watch.keys());
    const items = [];
    for (const raw of Array.isArray(list) ? list : []) {
      const it = normalizeItem(raw);
      if (!it) continue;
      if (it.ex) exCache.set(it.symbol, it.ex);
      items.push(it);
    }
    if (items.length) owners.set(owner, items); else owners.delete(owner);
    watch.clear();
    for (const arr of owners.values()) {
      for (const it of arr) {
        const k = keyOf(it.market, it.symbol);
        if (!watch.has(k)) watch.set(k, { symbol: it.symbol, market: it.market });
      }
    }
    for (const k of quotes.keys()) if (!watch.has(k)) quotes.delete(k);
    const added = new Set([...watch.keys()].filter((k) => !before.has(k)).map((k) => k.split(':')[0]));
    for (const m of Object.keys(MARKETS)) {
      if (!running) continue;
      if (added.has(m)) poll(m);                 // 新加入的股票馬上抓一次
      else if (!itemsOf(m).length) schedule(m);  // 清空了就停掉計時器
    }
    return [...watch.values()].map((w) => ({ ...w }));
  }

  // 新增股票時查證用：台股自動判斷上市（tse）或上櫃（otc）
  async function lookup(symbol, market) {
    const it = normalizeItem({ symbol, market });
    if (!it) return { ok: false, reason: `代號格式不正確：${symbol}` };
    const attempt = async () => {
      if (it.market === 'tw') {
        const list = await fetchTw(twChannels(it.symbol));
        return list.find((q) => q.symbol === it.symbol) || null;
      }
      return fetchUs(it.symbol);
    };
    let q, lastErr;
    for (let i = 0; i < Math.max(1, lookupAttempts); i++) {   // 失敗就間隔 0.8、1.6 秒…再試
      try { q = await attempt(); lastErr = null; break; } catch (e) {
        lastErr = e;
        if (i < lookupAttempts - 1) await new Promise((r) => setTimer(r, 800 * 2 ** i));
      }
    }
    if (lastErr) return { ok: false, offline: true, reason: `無法連線到報價來源，請稍後再試（${lastErr.message}）` };
    if (!q) return { ok: false, reason: it.market === 'tw' ? `查無此台股代號：${it.symbol}` : `查無此美股代號：${it.symbol}` };
    const r = { ok: true, symbol: it.symbol, market: it.market, name: q.name || it.symbol, quote: q };
    if (it.market === 'tw') { r.ex = q.ex; if (q.ex) exCache.set(it.symbol, q.ex); }
    return r;
  }

  function start() {
    if (running) return;
    running = true;
    for (const m of Object.keys(MARKETS)) poll(m);   // 啟動時先抓一次（含週末、收盤後）
  }
  function stop() {
    running = false;
    for (const m of Object.keys(MARKETS)) {
      if (mk[m].timer != null) clearTimer(mk[m].timer);
      mk[m].timer = null;
    }
  }
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function getQuote(symbol, market) {
    const q = quotes.get(keyOf(market, String(symbol).trim().toUpperCase()));
    return q ? { ...q } : null;
  }

  return {
    setWatchlist, lookup, start, stop, subscribe, getQuote,
    pollNow: (market) => poll(market),
    get watchlist() { return [...watch.values()].map((w) => ({ ...w })); },
    _state: mk,
  };
}

module.exports = {
  createStockService, isMarketOpen, nextPollDelay, msUntilNextOpen, msUntilClose,
  parseTwQuote, parseUsMeta, toYahooSymbol, zonedDay, MARKETS,
  BACKOFF_MAX, CLOSED_INTERVAL,
};
