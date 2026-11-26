const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createStockService, isMarketOpen, nextPollDelay, parseTwQuote, parseUsMeta, toYahooSymbol, BACKOFF_MAX,
} = require('../lib/stock-service');

const MIN = 60000, HOUR = 60 * MIN;
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

// 假時鐘：setTimer/clearTimer/now 全部由測試控制
function fakeClock(start) {
  let t = start, id = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const i = ++id; timers.set(i, { at: t + ms, fn, ms }); return i; },
    clearTimer: (i) => { timers.delete(i); },
    timers,
    delays: () => [...timers.values()].map((x) => x.ms),
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [i, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [i, x];
        if (!next) break;
        timers.delete(next[0]); t = next[1].at; next[1].fn(); await flush();
      }
      t = end; await flush();
    },
  };
}
const resp = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const twMsg = (o) => ({ c: '2330', n: '台積電', ex: 'tse', z: '2150.0000', y: '2000.0000', a: '2155.0000_2160.0000_', b: '2150.0000_2145.0000_', tlong: '1795588200000', d: '20261125', t: '13:30:00', ...o });
const EMPTY = { tv: '-', s: '-', c: '', z: '-' };
const usMeta = (o) => ({ symbol: 'AAPL', regularMarketPrice: 110, chartPreviousClose: 100, previousClose: 100, regularMarketTime: 1795618911, longName: 'Apple Inc.', shortName: 'Apple', currency: 'USD', exchangeTimezoneName: 'America/New_York', ...o });

// ───── 台股解析 ─────
test('台股：有成交用 z，漲跌幅以昨收計算', () => {
  const q = parseTwQuote(twMsg());
  assert.equal(q.price, 2150); assert.equal(q.prevClose, 2000);
  assert.equal(q.pct, 7.5); assert.equal(q.source, 'trade');
  assert.equal(q.day, '2026-11-25'); assert.equal(q.time, 1795588200000);
  assert.equal(q.name, '台積電'); assert.equal(q.ex, 'tse');
});
test('台股：還沒成交（z 是 "-"）用最佳買賣價中間值', () => {
  const q = parseTwQuote(twMsg({ z: '-', a: '101.0000_102.0000_', b: '100.0000_99.0000_', y: '100.0000' }));
  assert.equal(q.price, 100.5); assert.equal(q.source, 'mid');
  assert.ok(Math.abs(q.pct - 0.5) < 1e-9);
});
test('台股：全部是 "-" 時不回報價格與 pct', () => {
  const q = parseTwQuote(twMsg({ z: '-', a: '-', b: '-', y: '-' }));
  assert.equal(q.price, null); assert.equal(q.pct, null); assert.equal(q.prevClose, null);
  const q2 = parseTwQuote(twMsg({ z: '-', a: '', b: '' }));
  assert.equal(q2.pct, null);
});
test('台股：查無此代號（c 是空字串）回傳 null', () => {
  assert.equal(parseTwQuote(EMPTY), null);
});

// ───── 美股解析 ─────
test('美股：解析 meta，日期以紐約時區計算', () => {
  const q = parseUsMeta(usMeta(), 'AAPL');
  assert.equal(q.price, 110); assert.equal(q.prevClose, 100); assert.equal(q.pct, 10);
  assert.equal(q.name, 'Apple Inc.'); assert.equal(q.time, 1795618911000);
  assert.equal(q.day, '2026-11-25');
  // 沒有 previousClose 時改用 chartPreviousClose；沒有 longName 用 shortName
  const q2 = parseUsMeta(usMeta({ previousClose: undefined, chartPreviousClose: 200, longName: undefined }), 'AAPL');
  assert.equal(q2.prevClose, 200); assert.equal(q2.name, 'Apple');
  // 晚上 23:00（UTC 隔天 04:00）仍算紐約當天
  assert.equal(parseUsMeta(usMeta({ regularMarketTime: Date.UTC(2026, 10, 26, 4, 0) / 1000 })).day, '2026-11-25');
});
test('美股代號：BRK.B 轉成 Yahoo 的 BRK-B', () => {
  assert.equal(toYahooSymbol('brk.b'), 'BRK-B');
});

// ───── 交易時間 ─────
test('台股交易時間（Asia/Taipei），含週末', () => {
  assert.equal(isMarketOpen('tw', new Date('2026-11-23T01:00:00Z')), true);   // 週一 09:00
  assert.equal(isMarketOpen('tw', new Date('2026-11-23T00:59:00Z')), false);  // 08:59
  assert.equal(isMarketOpen('tw', new Date('2026-11-23T05:29:00Z')), true);   // 13:29
  assert.equal(isMarketOpen('tw', new Date('2026-11-23T05:30:00Z')), false);  // 13:30 收盤
  assert.equal(isMarketOpen('tw', new Date('2026-11-28T02:00:00Z')), false);  // 週六 10:00
  assert.equal(isMarketOpen('tw', new Date('2026-11-29T02:00:00Z')), false);  // 週日 10:00
});
test('美股交易時間：日光節約切換前後（2026-03-08 切換）', () => {
  // 3/6（週五，EST = UTC-5）：09:30 = 14:30Z
  assert.equal(isMarketOpen('us', new Date('2026-03-06T14:29:00Z')), false);
  assert.equal(isMarketOpen('us', new Date('2026-03-06T14:30:00Z')), true);
  assert.equal(isMarketOpen('us', new Date('2026-03-06T20:59:00Z')), true);
  assert.equal(isMarketOpen('us', new Date('2026-03-06T21:00:00Z')), false);
  // 3/9（週一，EDT = UTC-4）：09:30 = 13:30Z，16:00 = 20:00Z
  assert.equal(isMarketOpen('us', new Date('2026-03-09T13:29:00Z')), false);
  assert.equal(isMarketOpen('us', new Date('2026-03-09T13:30:00Z')), true);
  assert.equal(isMarketOpen('us', new Date('2026-03-09T20:00:00Z')), false);
  // 11/2（週一，已回到 EST）
  assert.equal(isMarketOpen('us', new Date('2026-11-02T13:30:00Z')), false);
  assert.equal(isMarketOpen('us', new Date('2026-11-02T14:30:00Z')), true);
});

// ───── 輪詢間隔 ─────
test('輪詢間隔：交易時間 5 秒／15 秒，非交易時間 30 分鐘，開盤前睡到開盤', () => {
  const mon10 = new Date('2026-11-23T02:00:00Z');                          // 台北週一 10:00
  assert.equal(nextPollDelay('tw', mon10, { lastTradeDay: '2026-11-23' }), 5000);
  assert.equal(nextPollDelay('us', new Date('2026-11-23T15:00:00Z'), {}), 15000);
  assert.equal(nextPollDelay('tw', new Date('2026-11-23T12:00:00Z'), { lastTradeDay: '2026-11-23' }), 30 * MIN); // 20:00
  assert.equal(nextPollDelay('tw', new Date('2026-11-23T00:50:00Z'), {}), 10 * MIN);   // 08:50 → 等到 09:00
  // 收盤前最後一次對準收盤時間
  assert.equal(nextPollDelay('tw', new Date('2026-11-23T05:29:58Z'), {}), 2000);
  // 剛收盤 10 分鐘內每分鐘抓一次（拿最終收盤價）
  assert.equal(nextPollDelay('tw', new Date('2026-11-23T05:31:00Z'), { lastTradeDay: '2026-11-23' }), MIN);
  // 美股開盤時間跟著日光節約走：3/9 13:00Z（EDT 09:00）→ 30 分鐘後開盤
  assert.equal(nextPollDelay('us', new Date('2026-03-09T13:00:00Z'), {}), 30 * MIN);
});
test('輪詢間隔：週末不輪詢，直接睡到週一開盤', () => {
  // 台北週六 12:00 → 週一 09:00 = 45 小時
  assert.equal(nextPollDelay('tw', new Date('2026-11-28T04:00:00Z'), {}), 45 * HOUR);
  // 紐約週六 12:00（EST）→ 週一 09:30 = 45.5 小時
  assert.equal(nextPollDelay('us', new Date('2026-11-28T17:00:00Z'), {}), 45.5 * HOUR);
  // 跨過日光節約：3/7（週六 12:00 EST = 17:00Z）→ 3/9 09:30 EDT = 13:30Z
  assert.equal(nextPollDelay('us', new Date('2026-03-07T17:00:00Z'), {}), Date.parse('2026-03-09T13:30:00Z') - Date.parse('2026-03-07T17:00:00Z'));
});
test('輪詢間隔：假日推測（開盤 15 分鐘後仍沒有當日成交 → 30 分鐘一次）', () => {
  assert.equal(nextPollDelay('tw', new Date('2026-11-23T01:05:00Z'), { lastTradeDay: '2026-11-20' }), 5000);     // 09:05 寬限期內
  assert.equal(nextPollDelay('tw', new Date('2026-11-23T02:00:00Z'), { lastTradeDay: '2026-11-20' }), 30 * MIN); // 10:00
  assert.equal(nextPollDelay('tw', new Date('2026-11-23T05:20:00Z'), { lastTradeDay: '2026-11-20' }), 10 * MIN); // 13:20 → 對準收盤
  // 休市日收盤後不用每分鐘抓
  assert.equal(nextPollDelay('tw', new Date('2026-11-23T05:31:00Z'), { lastTradeDay: '2026-11-20' }), 30 * MIN);
});
test('輪詢間隔：退避 5 → 10 → 20 秒 … 最多 5 分鐘', () => {
  const d = new Date('2026-11-23T02:00:00Z');
  assert.equal(nextPollDelay('tw', d, { failures: 1 }), 5000);
  assert.equal(nextPollDelay('tw', d, { failures: 2 }), 10000);
  assert.equal(nextPollDelay('tw', d, { failures: 3 }), 20000);
  assert.equal(nextPollDelay('tw', d, { failures: 20 }), BACKOFF_MAX);
  assert.equal(BACKOFF_MAX, 5 * MIN);
});

// ───── 服務 ─────
test('上櫃 fallback：不知道上市還上櫃時兩個都查，之後只查 otc', async () => {
  const clock = fakeClock(Date.parse('2026-11-23T02:00:00Z'));
  const urls = [];
  const fetch = async (url) => {
    urls.push(decodeURIComponent(url));
    return resp({ msgArray: [twMsg({ c: '6488', n: '環球晶', ex: 'otc', z: '477.0000', y: '506.0000', d: '20261123' }), EMPTY] });
  };
  const got = [];
  const svc = createStockService({ fetch, ...clock, onUpdate: (u) => got.push(u) });
  svc.setWatchlist([{ symbol: '6488', market: 'tw' }]);
  svc.start(); await flush();
  assert.match(urls[0], /tse_6488\.tw\|otc_6488\.tw/);
  assert.equal(got.length, 1);
  assert.equal(got[0].ex, 'otc'); assert.equal(got[0].name, '環球晶'); assert.equal(got[0].stale, false);
  assert.equal(got[0].day, '2026-11-23');
  assert.deepEqual(clock.delays(), [5000]);
  await clock.advance(5000);
  assert.ok(urls[1].includes('ex_ch=otc_6488.tw&'));
  svc.stop();
  assert.equal(clock.timers.size, 0);
});

test('lookup：台股自動判斷 tse/otc、查不到、美股 404', async () => {
  const clock = fakeClock(Date.parse('2026-11-23T02:00:00Z'));
  const fetch = async (url) => {
    if (url.includes('yahoo')) {
      if (url.includes('/ZZZZ?')) return resp({ chart: { result: null, error: { code: 'Not Found' } } }, 404);
      return resp({ chart: { result: [{ meta: usMeta({ symbol: 'BRK-B', longName: 'Berkshire Hathaway Inc.' }) }] } });
    }
    if (url.includes('6488')) return resp({ msgArray: [EMPTY, twMsg({ c: '6488', n: '環球晶', ex: 'otc' })] });
    return resp({ msgArray: [EMPTY, EMPTY] });
  };
  const svc = createStockService({ fetch, ...clock });
  const a = await svc.lookup('6488', 'tw');
  assert.equal(a.ok, true); assert.equal(a.ex, 'otc'); assert.equal(a.name, '環球晶');
  const b = await svc.lookup('9999', 'tw');
  assert.equal(b.ok, false); assert.match(b.reason, /查無此台股代號/);
  const c = await svc.lookup('ZZZZ', 'us');
  assert.equal(c.ok, false); assert.match(c.reason, /查無此美股代號/);
  const d = await svc.lookup('BRK.B', 'us');
  assert.equal(d.ok, true); assert.equal(d.symbol, 'BRK.B'); assert.equal(d.name, 'Berkshire Hathaway Inc.');
  const e = await svc.lookup('abc!', 'us');
  assert.equal(e.ok, false); assert.match(e.reason, /格式不正確/);
});

test('lookup：連線失敗會重試（預設共 3 次），仍失敗回傳原因', async () => {
  const clock = fakeClock(0);
  let calls = 0;
  const fetch = async () => { calls++; throw new Error('網路斷線'); };
  const svc = createStockService({ fetch, ...clock });
  const p = svc.lookup('2330', 'tw');
  await flush(); await clock.advance(5000);
  const r = await p;
  assert.equal(calls, 3); assert.equal(r.ok, false); assert.match(r.reason, /無法連線/);
});

test('美股：BRK.B 用 BRK-B 去查，一檔一次請求，回報時用原代號', async () => {
  const clock = fakeClock(Date.parse('2026-11-23T15:00:00Z'));
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    const sym = url.match(/chart\/([^?]+)/)[1];
    return resp({ chart: { result: [{ meta: usMeta({ symbol: sym }) }] } });
  };
  const got = [];
  const svc = createStockService({ fetch, ...clock, onUpdate: (u) => got.push(u) });
  svc.setWatchlist([{ symbol: 'AAPL', market: 'us' }, { symbol: 'BRK.B', market: 'us' }]);
  svc.start(); await flush();
  assert.equal(urls.length, 2);
  assert.ok(urls.some((u) => u.includes('/chart/BRK-B?interval=1m&range=1d')));
  assert.deepEqual(got.map((u) => u.symbol).sort(), ['AAPL', 'BRK.B']);
  assert.deepEqual(clock.delays(), [15000]);
  svc.stop();
});

test('去重：多個訂閱者盯同一檔只抓一次，結果分送給所有監聽者', async () => {
  const clock = fakeClock(Date.parse('2026-11-23T02:00:00Z'));
  const urls = [];
  const fetch = async (url) => { urls.push(decodeURIComponent(url)); return resp({ msgArray: [twMsg({ d: '20261123' })] }); };
  const svc = createStockService({ fetch, ...clock });
  const a = [], b = [];
  svc.subscribe((u) => a.push(u)); svc.subscribe((u) => b.push(u));
  svc.setWatchlist([{ symbol: '2330', market: 'tw', ex: 'tse' }, { symbol: '2330', market: 'tw' }], 'kuka-1');
  svc.setWatchlist([{ symbol: '2330', market: 'tw' }], 'kuka-2');
  assert.equal(svc.watchlist.length, 1);
  svc.start(); await flush();
  assert.equal(urls.length, 1);
  assert.equal((urls[0].match(/2330/g) || []).length, 1);
  assert.equal(a.length, 1); assert.equal(b.length, 1);
  // 價格沒變就不重複通知
  await clock.advance(5000);
  assert.equal(urls.length, 2); assert.equal(a.length, 1);
  svc.stop();
});

test('台股一次最多 50 檔：60 檔分兩次請求', async () => {
  const clock = fakeClock(Date.parse('2026-11-23T02:00:00Z'));
  const counts = [];
  const fetch = async (url) => {
    const ch = decodeURIComponent(url).match(/ex_ch=([^&]+)/)[1].split('|');
    counts.push(ch.length);
    return resp({ msgArray: ch.map((c) => twMsg({ c: c.slice(4, -3) })) });
  };
  const svc = createStockService({ fetch, ...clock });
  svc.setWatchlist(Array.from({ length: 60 }, (_, i) => ({ symbol: String(1101 + i), market: 'tw', ex: 'tse' })));
  svc.start(); await flush();
  assert.deepEqual(counts.sort((x, y) => y - x), [50, 10]);
  svc.stop();
});

test('退避與恢復：失敗標 stale 並加倍等待，恢復後清掉 stale', async () => {
  const clock = fakeClock(Date.parse('2026-11-23T02:00:00Z'));
  let fail = false;
  const fetch = async () => (fail ? resp('<html>FOR SECURITY REASONS</html>', 502) : resp({ msgArray: [twMsg({ d: '20261123' })] }));
  const got = [];
  const svc = createStockService({ fetch, ...clock, onUpdate: (u) => got.push(u) });
  svc.setWatchlist([{ symbol: '2330', market: 'tw' }]);
  svc.start(); await flush();
  assert.equal(got.at(-1).stale, false);
  assert.deepEqual(clock.delays(), [5000]);
  fail = true;
  await clock.advance(5000);
  assert.equal(got.at(-1).stale, true); assert.equal(got.at(-1).price, 2150);   // 保留最後價格
  assert.deepEqual(clock.delays(), [5000]);
  await clock.advance(5000);
  assert.deepEqual(clock.delays(), [10000]);
  await clock.advance(10000);
  assert.deepEqual(clock.delays(), [20000]);
  assert.equal(got.filter((u) => u.stale).length, 1);   // stale 只通知一次
  fail = false;
  await clock.advance(20000);
  assert.equal(got.at(-1).stale, false); assert.equal(got.at(-1).recovered, true);
  assert.deepEqual(clock.delays(), [5000]);
  svc.stop();
});

test('週末啟動：只抓一次，下一次排在週一開盤', async () => {
  const clock = fakeClock(Date.parse('2026-11-28T04:00:00Z'));   // 台北週六 12:00
  let calls = 0;
  const fetch = async () => { calls++; return resp({ msgArray: [twMsg({ d: '20261127' })] }); };
  const svc = createStockService({ fetch, ...clock });
  svc.setWatchlist([{ symbol: '2330', market: 'tw' }]);
  svc.start(); await flush();
  assert.equal(calls, 1);
  assert.deepEqual(clock.delays(), [45 * HOUR]);
  await clock.advance(44 * HOUR);
  assert.equal(calls, 1);
  svc.stop();
});

test('假日：交易時間內一直沒有當日成交 → 降成 30 分鐘一次', async () => {
  const clock = fakeClock(Date.parse('2026-11-23T02:00:00Z'));   // 台北週一 10:00
  const fetch = async () => resp({ msgArray: [twMsg({ d: '20261120' })] });   // 資料停在上週五
  const svc = createStockService({ fetch, ...clock });
  svc.setWatchlist([{ symbol: '2330', market: 'tw' }]);
  svc.start(); await flush();
  assert.deepEqual(clock.delays(), [30 * MIN]);
  svc.stop();
});

test('清單清空就停止計時器；新增股票會馬上抓一次', async () => {
  const clock = fakeClock(Date.parse('2026-11-23T02:00:00Z'));
  let calls = 0;
  const fetch = async () => { calls++; return resp({ msgArray: [twMsg({ d: '20261123' })] }); };
  const svc = createStockService({ fetch, ...clock });
  svc.start(); await flush();
  assert.equal(calls, 0); assert.equal(clock.timers.size, 0);
  svc.setWatchlist([{ symbol: '2330', market: 'tw' }]); await flush();
  assert.equal(calls, 1); assert.deepEqual(clock.delays(), [5000]);
  svc.setWatchlist([]);
  assert.equal(clock.timers.size, 0);
  svc.stop();
});

test('setAllWatchlists：刪掉的庫卡（不在清單裡的訂閱者）一併移除，不再抓它的股票', async () => {
  const clock = fakeClock(Date.parse('2026-11-23T02:00:00Z'));
  const urls = [];
  const fetch = async (url) => { urls.push(decodeURIComponent(url)); const ch = decodeURIComponent(url).match(/ex_ch=([^&]+)/)[1].split('|'); return resp({ msgArray: ch.map((c) => twMsg({ c: c.slice(4, -3), d: '20261123' })) }); };
  const svc = createStockService({ fetch, ...clock });
  svc.setAllWatchlists({ qa: [{ symbol: '2317', market: 'tw', ex: 'tse' }], qb: [{ symbol: '2330', market: 'tw', ex: 'tse' }] });
  assert.deepEqual(svc.owners.sort(), ['qa', 'qb']);
  svc.start(); await flush();
  assert.match(urls[0], /2330/);
  // qb 被刪掉：重設時不在清單裡
  svc.setAllWatchlists({ qa: [{ symbol: '2317', market: 'tw', ex: 'tse' }] });
  assert.deepEqual(svc.owners, ['qa']);
  assert.deepEqual(svc.watchlist.map((w) => w.symbol), ['2317']);
  assert.equal(svc.getQuote('2330', 'tw'), null);              // 報價也清掉
  urls.length = 0;
  await clock.advance(5000);
  assert.ok(urls.length >= 1);
  assert.ok(urls.every((u) => !/2330/.test(u)), urls.join('\n'));
  // 空的清單：所有訂閱都清掉，計時器停掉
  svc.setAllWatchlists({});
  assert.deepEqual(svc.owners, []); assert.equal(svc.watchlist.length, 0);
  svc.stop();
});
