// 股價「跨門檻」判斷（規格第 5、7 節）：漲跌每多跨過一個門檻（預設 1%）才反應一次。
// 每天第一筆只當基準；跨日歸零；同一檔至少隔 60 秒才再反應，除非跨到更大的步數；漲停跌停另外標記。
(function () {
  const COOLDOWN_MS = 60 * 1000;
  // 台股漲跌停約 ±10%（以 9.5% 判斷，避免四捨五入誤差）
  const limitOf = (market, pct) => (market === 'tw' && pct >= 9.5 ? 'up' : market === 'tw' && pct <= -9.5 ? 'down' : null);
  function createStepTracker({ stepPct = 1, now = () => Date.now() } = {}) {
    const st = new Map();   // key → { day, step, base, lastReactAt, maxAbs, limit }
    // 回傳 null（不反應）或 { dir: 'up'|'down', step, pct, limit }
    function update(key, { pct, day, market = 'tw' }) {
      if (!isFinite(pct)) return null;
      const step = Math.trunc(pct / stepPct);
      let s = st.get(key);
      if (!s || s.day !== day) {           // 新的一天（或第一次）：只記基準
        st.set(key, { day, step, lastReactAt: 0, maxAbs: Math.abs(step), limit: limitOf(market, pct) });
        return null;
      }
      const limit = limitOf(market, pct);
      const newLimit = limit && limit !== s.limit;
      s.limit = limit;
      if (step === s.step && !newLimit) return null;
      const t = now(), bigger = Math.abs(step) > s.maxAbs;
      if (!newLimit && t - s.lastReactAt < COOLDOWN_MS && !bigger) { s.step = step; return null; }
      const dir = step > s.step || limit === 'up' ? 'up' : 'down';
      s.step = step; s.lastReactAt = t; s.maxAbs = Math.max(s.maxAbs, Math.abs(step));
      return { dir, step, pct, limit };
    }
    return { update, setStep(p) { stepPct = p; }, _state: st };
  }
  const api = { createStepTracker, COOLDOWN_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
