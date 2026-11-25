// 日線歷史（給技術指標用）：Yahoo chart API，台股代號加 .TW（上市）／.TWO（上櫃），美股 . 換成 -。
// 每檔每天只抓一次（記憶體快取 30 分鐘）；抓不到就回 { ok:false }，不影響其他功能。
(function () {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
  const INDEX = { tw: { symbol: '^TWII', name: '加權指數' }, us: { symbol: '^GSPC', name: '標普 500' } };
  function yahooSymbol(symbol, market, ex) {
    if (symbol.startsWith('^')) return symbol;
    return market === 'tw' ? `${symbol}.${ex === 'otc' ? 'TWO' : 'TW'}` : symbol.replace(/\./g, '-');
  }
  function createHistory({ fetch, now = () => Date.now(), ttlMs = 30 * 60000 }) {
    const cache = new Map();
    async function daily(symbol, market, ex) {
      const key = yahooSymbol(symbol, market, ex), hit = cache.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.val;
      let val;
      try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?range=6mo&interval=1d`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const r = (await res.json()).chart.result[0], q = r.indicators.quote[0];
        const bars = r.timestamp.map((t, i) => ({ t: new Date(t * 1000).toISOString().slice(0, 10), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] }))
          .filter((b) => [b.o, b.h, b.l, b.c].every((x) => x != null && isFinite(x)));
        val = { ok: true, bars };
      } catch (e) { val = { ok: false, reason: '暫時拿不到歷史資料' }; }
      if (val.ok) cache.set(key, { at: now(), val });
      return val;
    }
    return { daily, INDEX };
  }
  // 把「今天的即時報價」接到日線最後面：歷史資料通常要收盤後一陣子才有今天那一根
  function withToday(bars, q) {
    if (!q || q.price == null || !q.day) return bars;
    const lastBar = bars[bars.length - 1];
    if (lastBar && lastBar.t >= q.day) return bars;
    const o = q.open != null ? q.open : q.prevClose != null ? q.prevClose : q.price;
    const today = { t: q.day, o, h: Math.max(q.high != null ? q.high : -Infinity, o, q.price), l: Math.min(q.low != null ? q.low : Infinity, o, q.price), c: q.price, v: q.volume || 0, live: true };
    return bars.concat([today]);
  }
  module.exports = { createHistory, yahooSymbol, withToday, INDEX };
})();
