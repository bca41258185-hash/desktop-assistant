const { test } = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/indicators');
const { describe, VOICE, SIG, DISCLAIMER } = require('../lib/market-talk');
const { withToday, yahooSymbol } = require('../lib/stock-history');

// 造資料：每天漲跌 d%，開高低用簡單規則
function series(changes, start = 100, vol = 1000) {
  let c = start; const bars = [];
  changes.forEach((d, i) => { const o = c; c = +(c * (1 + d / 100)).toFixed(4); bars.push({ t: `2026-01-${String(i + 1).padStart(2, '0')}`, o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: Array.isArray(vol) ? vol[i] : vol }); });
  return bars;
}
const ids = (a) => a.signals.map((s) => s.id);

test('指標數值：均線、RSI 範圍、KD 範圍', () => {
  assert.deepEqual(I.sma([1, 2, 3, 4, 5], 5), [null, null, null, null, 3]);
  const up = I.rsi(series(Array(30).fill(1)).map((b) => b.c));
  assert.ok(up[up.length - 1] > 99);                              // 天天漲 → RSI 接近 100
  const dn = I.rsi(series(Array(30).fill(-1)).map((b) => b.c));
  assert.ok(dn[dn.length - 1] < 1);
  const k = I.kd(series(Array(40).fill(0).map((_, i) => (i % 2 ? 1 : -1))));
  assert.ok(k.k.slice(-1)[0] >= 0 && k.k.slice(-1)[0] <= 100);
});
test('資料不足時不亂講', () => {
  const a = I.analyze(series(Array(10).fill(1)));
  assert.equal(a.ok, false);
  assert.match(describe(a, { name: '台積電' }).headline, /資料還不夠/);
});
test('連漲 → RSI 過熱、連漲、多頭排列、創新高', () => {
  const a = I.analyze(series(Array(80).fill(0.8)));
  for (const id of ['rsiHot', 'streakUp', 'bullAlign', 'newHigh']) assert.ok(ids(a).includes(id), id);
  assert.equal(a.mood, 'bull');
});
test('連跌 → RSI 過冷、空頭排列、創新低', () => {
  const a = I.analyze(series(Array(80).fill(-0.8)));
  for (const id of ['rsiCold', 'streakDown', 'bearAlign', 'newLow']) assert.ok(ids(a).includes(id), id);
  assert.equal(a.mood, 'bear');
});
test('先跌後反彈 → 黃金交叉／站上月線／MACD 翻多其中至少一個', () => {
  let found = new Set();
  for (let n = 1; n <= 14; n++) ids(I.analyze(series(Array(50).fill(-0.3).concat(Array(10).fill(-1.5), Array(n).fill(1.6))))).forEach((x) => found.add(x));
  assert.ok(found.has('goldenCross')); assert.ok(found.has('aboveMa20')); assert.ok(found.has('macdUp'));
});
test('台股漲停、爆量；美股不算漲停', () => {
  const ch = Array(40).fill(0.1).concat([9.9]), vol = Array(40).fill(1000).concat([5000]);
  const tw = I.analyze(series(ch, 100, vol), { market: 'tw' });
  assert.equal(tw.signals[0].id, 'limitUp');
  assert.ok(ids(tw).includes('volUp'));
  const us = I.analyze(series(ch, 100, vol), { market: 'us' });
  assert.ok(!ids(us).includes('limitUp')); assert.ok(ids(us).includes('bigUp'));
});
test('盤整很久 → 通道收窄', () => {
  const a = I.analyze(series(Array(40).fill(0).map((_, i) => (i % 2 ? 3 : -2.9)).concat(Array(30).fill(0).map((_, i) => (i % 2 ? 0.05 : -0.05)))));
  assert.ok(ids(a).includes('squeeze'));
});
test('七種個性都有話說；同一天同一檔講的話固定；一定附免責', () => {
  const a = I.analyze(series(Array(80).fill(0.8)));
  for (const ar of Object.keys(VOICE)) {
    const r = describe(a, { name: '聯發科', symbol: '2454', archetype: ar });
    assert.ok(r.headline.startsWith('聯發科 ▲'), ar);
    assert.ok(r.lines.length >= 2 && r.lines.every((l) => typeof l === 'string' && l.length > 0), ar);
    assert.equal(r.disclaimer, DISCLAIMER);
    assert.deepEqual(describe(a, { name: '聯發科', symbol: '2454', archetype: ar }), r);
  }
  const cool = describe(a, { name: 'x', symbol: 'x', archetype: 'cool' }), ath = describe(a, { name: 'x', symbol: 'x', archetype: 'athlete' });
  assert.ok(cool.lines.join('').length < ath.lines.join('').length);        // 酷酷派話最少
  assert.ok(!/葉子|灌木|石頭/.test(cool.lines.join('')));                    // 酷酷派只講事實
  assert.match(describe(a, { name: 'x', symbol: 'x', archetype: 'shy' }).lines[0], /……$/);
});
test('每個訊號都有說法（不會講出 undefined）', () => {
  for (const [id, d] of Object.entries(SIG)) {
    const s = { id, pct: 3.2, gap: 2, n: 4, rsi: 75, k: 20, ratio: 2.5, days: 60 };
    assert.ok(d.tag && d.leaf && !/undefined|NaN/.test(d.fact(s) + d.leaf + (d.sport || '')), id);
  }
});
test('接上今天的即時報價；代號轉換', () => {
  const bars = series(Array(40).fill(0.2));
  const q = { price: 120, prevClose: 108, open: 110, high: 121, low: 109, volume: 9000, day: '2026-03-01' };
  const b = withToday(bars, q);
  assert.equal(b.length, 41); assert.deepEqual([b[40].o, b[40].h, b[40].l, b[40].c], [110, 121, 109, 120]);
  assert.equal(withToday(b, q).length, 41);                                  // 已經有今天就不重複加
  assert.equal(withToday(bars, { price: 5, day: '2026-03-01' })[40].o, 5);    // 沒有開盤價時用現價
  assert.equal(yahooSymbol('2330', 'tw', 'tse'), '2330.TW'); assert.equal(yahooSymbol('6488', 'tw', 'otc'), '6488.TWO'); assert.equal(yahooSymbol('BRK.B', 'us'), 'BRK-B');
});
