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

test('同一種個性類型，個體數值不同講的話也不同', () => {
  const a = I.analyze(series(Array(50).fill(-0.3).concat(Array(10).fill(-1.5))));
  const base = { name: '台積電', symbol: '2330', archetype: 'easy' };
  const P = (o) => ({ activity: .5, sociability: .5, boldness: .5, curiosity: .5, affection: .5, ...o });
  const timid = describe(a, { ...base, personality: P({ boldness: .1 }) });
  const brave = describe(a, { ...base, personality: P({ boldness: .9 }) });
  // 不確定／肯定的語氣只加在解讀（冒號後面的比喻），不加在數字事實前面
  assert.match(timid.lines[0], /^RSI \d+，低於 30：(好像|看起來|感覺)/); assert.match(brave.lines[0], /^RSI \d+，低於 30：我敢說，/);
  const curious = describe(a, { ...base, personality: P({ curiosity: .9 }) }), bored = describe(a, { ...base, personality: P({ curiosity: .1 }) });
  assert.ok(curious.tags.length > bored.tags.length);                        // 好奇的多講幾個訊號
  assert.match(describe(a, { ...base, personality: P({ activity: .9 }) }).lines[0], /！$/);
  assert.match(describe(a, { ...base, personality: P({ activity: .1 }) }).lines[0], /……$/);
  assert.ok(describe(a, { ...base, personality: P({ affection: .9 }) }).lines.some((l) => /幫你盯著/.test(l)));
  assert.ok(describe(a, { ...base, personality: P({ sociability: .9 }) }).lines.some((l) => /其他庫卡/.test(l)));
  // 喜好：最愛籃球 → 球場比喻與籃球開場；嗜好：收尾說要去做什麼；年紀
  const hoop = describe(a, { ...base, personality: P({}), likes: ['basketball', 'nap'], hobbies: ['曬太陽'] });
  assert.match(hoop.headline, /被蓋掉了/); assert.ok(/對手|比分|落後|防守/.test(hoop.lines.join('')));
  assert.equal(hoop.lines.at(-1), '講完了，我要去曬太陽了。');
  assert.match(describe(a, { ...base, personality: P({}), stage: 'juvenile' }).headline, /哇！/);
  assert.ok(describe(a, { ...base, personality: P({}), stage: 'senior' }).lines.some((l) => /以前也看過/.test(l)));
  // 酷酷派就算愛打球也只講事實
  assert.ok(!/對手|灌木/.test(describe(a, { ...base, archetype: 'cool', personality: P({}), likes: ['basketball'] }).lines.join('')));
});

// ---- 審查後補的測試 ------------------------------------------------------------------------
const { marketLine } = require('../lib/market-talk');
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
// 造資料：f(i, 前一天收盤) → 當天收盤；opt.v(i) → 量；opt.hl=false → 高低等於開收（完全沒有影線）
function mk(n, f, opt = {}) {
  const bars = []; let c = 100;
  for (let i = 0; i < n; i++) { const pc = c; c = f(i, c); const o = pc, k = opt.hl === false ? 0 : 0.003; bars.push({ t: `2026-06-${String(i + 1).padStart(2, '0')}`, o, h: Math.max(o, c) * (1 + k), l: Math.min(o, c) * (1 - k), c, v: opt.v ? opt.v(i) : 1000 }); }
  return bars;
}
const N = 70, noise = (k) => (i, c) => c * (1 + (rnd() - 0.5) * k);
const SCEN = {
  大漲: mk(N, (i, c) => (i === N - 1 ? c * 1.06 : noise(0.01)(i, c))),
  大跌: mk(N, (i, c) => (i === N - 1 ? c * 0.94 : noise(0.01)(i, c))),
  漲停: mk(N, (i, c) => (i === N - 1 ? c * 1.099 : noise(0.01)(i, c))),
  跌停: mk(N, (i, c) => (i === N - 1 ? c * 0.901 : noise(0.01)(i, c))),
  盤整小漲帶死亡交叉: mk(N, (i) => 100 + Math.sin(i) * 0.3),
  完全不動: mk(N, () => 100),
  停牌無成交: mk(N, (i, c) => (i >= N - 3 ? c : noise(0.02)(i, c)), { v: (i) => (i >= N - 3 ? 0 : 1000), hl: false }),
  爆量: mk(N, noise(0.01), { v: (i) => (i === N - 1 ? 5000 : 1000) }),
  量縮: mk(N, noise(0.01), { v: (i) => (i === N - 1 ? 300 : 1000) }),
  連漲: mk(N, (i, c) => c * 1.012),
  連跌: mk(N, (i, c) => c * 0.988),
  零成交量: mk(N, noise(0.02), { v: () => 0 }),
  今日量0: mk(N, noise(0.02), { v: (i) => (i === N - 1 ? 0 : 1000) }),
  今日量缺值: mk(N, noise(0.02)).map((b, i) => (i === N - 1 ? { ...b, v: null } : b)),
  先跌後彈: mk(N, (i, c) => c * (i < 55 ? 0.99 : 1.02)),
  先漲後跌: mk(N, (i, c) => c * (i < 55 ? 1.01 : 0.98)),
  漲多小回: mk(N, (i, c) => c * (i === N - 1 ? 0.999 : i % 5 === 4 ? 0.997 : 1.004)),
  跌深小彈: mk(N, (i, c) => c * (i === N - 1 ? 1.008 : i % 4 === 3 ? 1.005 : 0.99)),
  漲多平盤: mk(N, (i, c) => c * (i === N - 1 ? 1 : i % 4 === 3 ? 0.995 : 1.01)),
  震盪: mk(N, noise(0.04)),
  剛好30天: mk(30, noise(0.03)),
  含缺值: mk(N, noise(0.02)).map((b, i) => (i % 9 === 0 ? { ...b, c: null } : b)),
  盤中: mk(N, noise(0.01), { v: (i) => (i === N - 1 ? 120 : 1000) }).map((b, i) => (i === N - 1 ? { ...b, partial: true, live: true } : b))
};
const PP = (o) => ({ activity: .5, sociability: .5, boldness: .5, curiosity: .5, affection: .5, ...o });
const WHO = [];
for (const archetype of Object.keys(VOICE)) {
  WHO.push({ archetype });
  WHO.push({ archetype, personality: PP({ boldness: .1, curiosity: .1, activity: .1 }), likes: ['eat'], hobbies: ['曬太陽'], stage: 'juvenile' });
  WHO.push({ archetype, personality: PP({ boldness: .9, curiosity: .9, activity: .9, affection: .95, sociability: .9 }), likes: ['basketball'], hobbies: ['打球'], stage: 'senior' });
  WHO.push({ archetype, personality: PP({ boldness: .2, affection: .9, sociability: .9, curiosity: .9 }), likes: ['badminton'], hobbies: [], stage: 'senior' });
}
// 禁用詞：暗示之後走勢、現在是高點或低點、或買賣時機的說法都不可以出現
const BANNED = ['通常', '之後', '即將', '快要', '快到', '谷底', '見底', '觸底', '到頂', '最高點', '最低點', '過頭', '過熱', '過冷', '超買', '超賣', '將會', '會漲', '會跌', '會反彈', '會回', '應該會', '遲早', '早晚', '等著', '機會', '越大', '歇一下', '蓄勢', '準備', '看好', '看壞', '看漲', '看跌',
  '反轉', '回檔', '支撐', '壓力', '撐著', '買進', '賣出', '買點', '賣點', '進場', '出場', '加碼', '減碼', '停損', '停利', '抄底', '逢低', '逢高', '目標價', '該買', '該賣', '建議', '便宜', '太貴', '值得', '下一球', '還沒停', '還有機會'];
const banned = (t) => BANNED.filter((w) => t.includes(w));
const BEAR_OPENERS = Object.values(VOICE).flatMap((v) => v.bear).concat(['這球掛網了。', '這球沒接起來。', '這球被蓋掉了。']);
const BULL_OPENERS = Object.values(VOICE).flatMap((v) => v.bull).concat(['殺球得分！', '扣球得分！', '空心進球！']);

test('全部模板都沒有預測或買賣字眼（禁用詞清單）', () => {
  for (const [id, d] of Object.entries(SIG)) {
    const s = { id, pct: 3.2, gap: 2, n: 4, rsi: 75, k: 20, ratio: 2.5, days: 60 };
    assert.deepEqual(banned([d.tag, d.fact(s), d.leaf, d.sport].join('｜')), [], id);
  }
  for (const [id, v] of Object.entries(VOICE)) assert.deepEqual(banned([...v.bull, ...v.bear, ...v.flat, ...v.end].join('｜')), [], id);
  assert.deepEqual(banned(DISCLAIMER.replace('不是投資建議', '')), []);
});
test('7 種個性 × 多組行情：沒有空字串／undefined／NaN、沒有預測字眼、方向不矛盾、不超過句數上限', () => {
  let count = 0;
  for (const [name, bars] of Object.entries(SCEN)) for (const market of ['tw', 'us']) {
    const a = I.analyze(bars, { market });
    assert.equal(a.ok, true, name);
    for (const [k, x] of Object.entries(a.v)) if (typeof x === 'number') assert.ok(isFinite(x), `${name} v.${k}`);
    assert.ok(a.v.rsi >= 0 && a.v.rsi <= 100, name);
    assert.ok(!(ids(a).includes('newHigh') && ids(a).includes('newLow')), `${name}：不可同時創新高又創新低`);
    // 語氣一定不能和當天方向相反
    if (a.v.pct > 0) assert.notEqual(a.mood, 'bear', name); if (a.v.pct < 0) assert.notEqual(a.mood, 'bull', name);
    if (a.dayDir === 0) assert.equal(a.mood, 'flat', name);
    for (const who of WHO) {
      const r = describe(a, { name: '台積電', symbol: '2330', ...who }), tag = `${name}/${market}/${who.archetype}`;
      const all = [r.headline, ...r.lines], text = all.join(' / ');
      count++;
      assert.ok(r.headline && r.lines.length >= 1 && all.every((l) => typeof l === 'string' && l.trim().length > 0), tag);
      assert.ok(!/undefined|NaN|null|Infinity|\[object/.test(text), `${tag}：${text}`);
      assert.deepEqual(banned(text), [], `${tag}：${text}`);
      assert.equal(r.disclaimer, DISCLAIMER);
      // 方向不矛盾：漲的日子不講下跌的開場白，跌的日子不講上漲的開場白；平盤兩種都不講
      const head = r.headline.replace(/^哇！/, '');
      if (a.v.pct >= 0 || a.dayDir === 0) for (const o of BEAR_OPENERS) assert.ok(!r.headline.endsWith(o), `${tag}：${r.headline}`);
      if (a.v.pct <= 0 || a.dayDir === 0) for (const o of BULL_OPENERS) assert.ok(!r.headline.endsWith(o), `${tag}：${r.headline}`);
      if (a.dayDir > 0) assert.ok(head.includes('▲') && !head.includes('▼'), tag); else if (a.dayDir < 0) assert.ok(head.includes('▼'), tag); else assert.ok(head.includes('平盤') && !/[▲▼]/.test(head), tag);
      // 數字事實前面不可以有不確定語氣；0.0% 要換說法
      assert.ok(!/(^|\/ )(好像|看起來|感覺|可能)/.test(text), `${tag}：${text}`);
      assert.ok(!/(好像|看起來|感覺|可能)\s*(RSI|KD|MACD|\d)/.test(text), `${tag}：${text}`);
      assert.ok(!/ 0\.0%|的 0%/.test(text), `${tag}：${text}`);
      // 句數上限
      assert.ok(r.lines.length <= (who.archetype === 'cool' ? 2 : who.archetype === 'sleepy' ? 3 : 7), `${tag}：${r.lines.length} 句`);
      if (who.archetype === 'cool') assert.ok(!/灌木|葉子|石頭|球|比分/.test(r.lines.join('')), tag);
      assert.deepEqual(describe(a, { name: '台積電', symbol: '2330', ...who }), r);
    }
    const ml = marketLine(a, { indexName: '加權指數', archetype: 'shy' });
    assert.ok(ml && !/undefined|NaN/.test(ml) && banned(ml).length === 0, name);
  }
  assert.ok(count >= 7 * 20);
});
test('多空語氣和當天漲跌矛盾時用中性說法', () => {
  const a = I.analyze(SCEN.盤整小漲帶死亡交叉);
  assert.ok(a.v.pct > 0 && ids(a)[0] === 'deathCross');
  assert.equal(a.mood, 'flat'); assert.equal(a.mixed, true); assert.equal(a.lean, -1); assert.equal(a.dayDir, 1);
  for (const ar of Object.keys(VOICE)) {
    const r = describe(a, { name: '台積電', symbol: '2330', archetype: ar });
    assert.equal(r.headline, '台積電 ▲0.2%，死亡交叉。今天小漲，但均線轉弱。', ar);
  }
  // 反過來：一路漲、今天小跌
  const b = I.analyze(SCEN.漲多小回);
  assert.ok(b.v.pct < 0); assert.equal(b.mixed, true); assert.equal(b.mood, 'flat');
  assert.match(describe(b, { name: 'x', symbol: 'x', archetype: 'cool' }).headline, /^x ▼0\.1%，.+。今天小跌，但其他指標偏強。$/);
  const c = I.analyze(SCEN.跌深小彈);
  assert.equal(c.mixed, true);
  assert.match(describe(c, { name: 'x', symbol: 'x', archetype: 'athlete' }).headline, /今天小漲，但其他指標偏弱。$/);
  const d = I.analyze(SCEN.漲多平盤);
  assert.equal(d.dayDir, 0); assert.equal(d.mood, 'flat');
  assert.match(describe(d, { name: 'x', symbol: 'x', archetype: 'sleepy' }).headline, /^x 平盤，.+。今天平盤，但其他指標偏強。$/);
  // 方向一致時照舊
  assert.equal(I.analyze(SCEN.大漲).mood, 'bull'); assert.equal(I.analyze(SCEN.大漲).mixed, false);
  assert.equal(I.analyze(SCEN.大跌).mood, 'bear');
});
test('價格完全不動：RSI 是 50、不報新高新低，只說今天沒什麼動靜', () => {
  assert.equal(I.rsi(Array(30).fill(100)).at(-1), 50);
  for (const name of ['完全不動', '停牌無成交']) {
    const a = I.analyze(SCEN[name]);
    assert.deepEqual(ids(a), ['still'], name); assert.equal(a.mood, 'flat');
    if (name === '完全不動') assert.equal(a.v.rsi, 50);
    for (const ar of Object.keys(VOICE)) {
      const r = describe(a, { name: '台積電', symbol: '2330', archetype: ar });
      assert.equal(r.headline, '台積電 平盤，沒動靜。今天沒什麼動靜。', ar);
      assert.deepEqual(r.tags, ['沒動靜']);
      assert.ok(!/新高|新低|RSI/.test(r.lines.join('')), ar);
    }
  }
});
test('量：盤中不判量縮、量是 0 或缺值不產生量的訊號', () => {
  const VOLS = ['volUp', 'volDown', 'volBig', 'volDry'], vols = (a) => ids(a).filter((x) => VOLS.includes(x));
  assert.deepEqual(vols(I.analyze(SCEN.量縮)), ['volDry']);                       // 收盤後的量縮照常
  const live = SCEN.量縮.map((b, i) => (i === N - 1 ? { ...b, partial: true } : b));
  assert.deepEqual(vols(I.analyze(live)), []);                                  // 同樣的量，盤中不講
  assert.equal(I.analyze(live).v.partial, true);
  assert.deepEqual(vols(I.analyze(SCEN.盤中)), []);
  for (const name of ['今日量0', '今日量缺值', '零成交量']) { const a = I.analyze(SCEN[name]); assert.deepEqual(vols(a), [], name); assert.equal(a.v.volRatio, null, name); }
  // 盤中累計量已經超過平常整天的 2 倍是事實，可以講
  const hot = SCEN.爆量.map((b, i) => (i === N - 1 ? { ...b, partial: true } : b));
  assert.equal(vols(I.analyze(hot)).length, 1);
  // 盤中不說「收盤」
  const txt = describe(I.analyze(SCEN.盤中), { name: 'x', symbol: 'x', archetype: 'easy', personality: PP({ curiosity: .9 }) });
  assert.ok(!/收盤|現在收/.test(txt.lines.join('')));
});
test('withToday：盤中那一根標 partial，收盤後不標；歷史已有今天那一根時盤中用即時報價更新', () => {
  const bars = series(Array(40).fill(0.2));
  const q = { price: 120, prevClose: 108, open: 110, high: 121, low: 109, volume: 9000, day: '2026-03-02', market: 'tw' };
  const tpe = (h, m) => Date.UTC(2026, 2, 2, h - 8, m);                          // 台北時間 → UTC
  assert.equal(withToday(bars, q, tpe(10, 30)).at(-1).partial, true);
  assert.equal(withToday(bars, q, tpe(13, 29)).at(-1).partial, true);
  assert.equal(withToday(bars, q, tpe(13, 30)).at(-1).partial, undefined);
  assert.equal(withToday(bars, q, tpe(20, 0)).at(-1).partial, undefined);
  assert.equal(withToday(bars, { ...q, market: undefined }, tpe(20, 0)).at(-1).partial, true);   // 不知道市場 → 保守當成盤中
  const us = { ...q, market: 'us' };
  assert.equal(withToday(bars, us, Date.UTC(2026, 2, 2, 15, 0)).at(-1).partial, true);           // 美東 10:00
  assert.equal(withToday(bars, us, Date.UTC(2026, 2, 2, 21, 30)).at(-1).partial, undefined);     // 美東 16:30
  // 歷史資料裡已經有今天（盤中抓到的舊值）
  const stale = bars.concat([{ t: '2026-03-02', o: 110, h: 112, l: 109.5, c: 111, v: 3000 }]);
  const m = withToday(stale, q, tpe(11, 0));
  assert.equal(m.length, 41); assert.deepEqual([m[40].o, m[40].h, m[40].l, m[40].c, m[40].v, m[40].partial], [110, 121, 109, 120, 9000, true]);
  assert.equal(stale[40].c, 111);                                                // 不改到原本的陣列
  assert.equal(withToday(stale, q, tpe(15, 0)), stale);                          // 收盤後照用歷史資料
  // 盤中接上去的那一根，量很少也不會被說成量縮
  const a = I.analyze(withToday(series(Array(40).fill(0.2), 100, 100000), { ...q, price: 108.5, open: 108.2, high: 108.6, low: 108.1, volume: 9000 }, tpe(9, 10)), { market: 'tw' });
  assert.ok(!ids(a).includes('volDry'));
});
test('膽量低：不確定語氣只在解讀句；貼著月線不說 0.0%；酷酷派＋年長不超過兩句', () => {
  const a = I.analyze(SCEN.連漲);
  const timid = describe(a, { name: 'x', symbol: 'x', archetype: 'easy', personality: PP({ boldness: .1 }) });
  assert.match(timid.lines[0], /^RSI 100，超過 70：(好像|看起來|感覺)/);
  const coolTimid = describe(a, { name: 'x', symbol: 'x', archetype: 'cool', personality: PP({ boldness: .1 }) });
  assert.equal(coolTimid.lines[0], 'RSI 100，超過 70。');                       // 只講事實的就完全不加
  const near = describe(I.analyze(SCEN.盤整小漲帶死亡交叉), { name: 'x', symbol: 'x', archetype: 'easy' });
  assert.ok(near.lines.some((l) => /貼著月線/.test(l)));
  const old = describe(a, { name: 'x', symbol: 'x', archetype: 'cool', personality: PP({ curiosity: .9, affection: .9, sociability: .9 }), stage: 'senior' });
  assert.equal(old.lines.length, 2);
  const one = describe(I.analyze(SCEN.今日量0), { name: 'x', symbol: 'x', archetype: 'cool', stage: 'senior', personality: PP({}) });
  assert.ok(one.lines.length <= 2 && one.lines.length >= 1);
});
