// 實測：抓真實日線 → 算指標 → 用七種個性各講一次（不在 npm test 裡）
const { createHistory, INDEX } = require('../lib/stock-history');
const { analyze } = require('../lib/indicators');
const { describe, marketLine } = require('../lib/market-talk');
(async () => {
  const H = createHistory({ fetch });
  const list = [['2330', 'tw', 'tse', '台積電'], ['6488', 'tw', 'otc', '環球晶'], ['AAPL', 'us', null, 'Apple']];
  const idx = await H.daily(INDEX.tw.symbol, 'tw');
  if (idx.ok) console.log('【大盤】' + marketLine(analyze(idx.bars, { market: 'index' }), { indexName: INDEX.tw.name, archetype: 'easy' }) + '\n');
  const arch = ['athlete', 'clingy', 'shy', 'explorer', 'sleepy', 'cool', 'easy'];
  let k = 0;
  for (const [sym, m, ex, name] of list) {
    const h = await H.daily(sym, m, ex);
    if (!h.ok) { console.log(name, h.reason); continue; }
    const a = analyze(h.bars, { market: m });
    console.log(`── ${name} 指標：收 ${a.v.close.toFixed(2)}、RSI ${a.v.rsi.toFixed(0)}、K ${a.v.k.toFixed(0)} D ${a.v.d.toFixed(0)}、MACD柱 ${a.v.hist.toFixed(2)}、量比 ${(a.v.volRatio || 0).toFixed(2)}；訊號：${a.signals.map((s) => s.id).join('、')}`);
    for (const ar of (process.argv[2] === 'all' ? arch : [arch[k++ % 7], arch[k++ % 7]])) {
      const r = describe(a, { name, symbol: sym, archetype: ar });
      console.log(`［${ar}］${r.headline}\n   ` + r.lines.join('\n   '));
    }
    console.log();
  }
})();
