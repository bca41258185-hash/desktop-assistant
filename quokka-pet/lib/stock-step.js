// 股價「跨門檻」判斷（規格第 4.2、5.8 節）：漲跌每多跨過一個門檻（預設 1%）才反應一次。
// 每天第一筆只當基準；跨日歸零；同一檔至少隔 60 秒才再反應，除非跨到更大的步數；漲停跌停另外標記。
// 遲滯：跨過門檻後，要往回落超過 0.2 個百分點才算跨回（避免在 0.99／1.01 之間來回一直反應）。
// 冷卻中被吞掉的變動：冷卻結束後的下一筆，若所在級距和上次報的不同，補報一次。
(function () {
  const COOLDOWN_MS = 60 * 1000;
  const HYSTERESIS_PCT = 0.2;
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  // 台股漲跌停約 ±10%（以 9.5% 判斷，避免四捨五入誤差）
  const limitOf = (market, pct) => (market === 'tw' && pct >= 9.5 ? 'up' : market === 'tw' && pct <= -9.5 ? 'down' : null);
  const rawStep = (pct, stepPct) => Math.trunc(pct / stepPct) || 0;     // || 0：把 -0 變成 0
  // 目前在 level 級，新的漲跌幅 pct 算第幾級：往零的方向（跨回）要比門檻再多退 hyst 個百分點才算
  function levelOf(level, pct, stepPct, hyst = HYSTERESIS_PCT) {
    const raw = rawStep(pct, stepPct);
    if (!isNum(level) || level === 0 || raw === level) return raw;
    const sign = Math.sign(level);
    if (raw * sign > Math.abs(level)) return raw;                      // 往外跨到更大的一級
    if (raw * sign < 0) return raw;                                    // 直接跨到另一邊（例如 +1 → −1）
    return pct * sign <= Math.abs(level) * stepPct - hyst ? raw : level;
  }
  function createStepTracker({ stepPct = 1, now = () => Date.now(), hysteresisPct = HYSTERESIS_PCT } = {}) {
    const st = new Map();   // key → { day, step（目前所在級距，含遲滯）, reported（上次報的級距）, lastReactAt, maxAbs, limit }
    // 回傳 null（不反應）或 { dir: 'up'|'down', step, pct, limit }
    function update(key, { pct, day, market = 'tw' } = {}) {
      if (!isNum(pct)) return null;
      const s = st.get(key);
      if (!s || s.day !== day) {           // 新的一天（或第一次）：只記基準
        const step = rawStep(pct, stepPct);
        st.set(key, { day, step, reported: step, lastReactAt: 0, maxAbs: Math.abs(step), limit: limitOf(market, pct) });
        return null;
      }
      const step = levelOf(s.step, pct, stepPct, hysteresisPct);
      const limit = limitOf(market, pct);
      const newLimit = !!limit && limit !== s.limit;
      s.limit = limit; s.step = step;
      if (step === s.reported && !newLimit) return null;              // 和上次報的同一級：不用再講
      const t = now(), bigger = Math.abs(step) > s.maxAbs;
      if (!newLimit && !bigger && t - s.lastReactAt < COOLDOWN_MS) return null;   // 冷卻中：先記著，冷卻結束後補報
      const dir = newLimit ? limit : step > s.reported ? 'up' : 'down';
      s.reported = step; s.lastReactAt = t; s.maxAbs = Math.max(s.maxAbs, Math.abs(step));
      return { dir, step, pct, limit };
    }
    // 換門檻：以下一筆報價重新當基準，不會一改就反應
    return { update, setStep(p) { if (p !== stepPct) { stepPct = p; st.clear(); } }, _state: st };
  }
  const api = { createStepTracker, levelOf, COOLDOWN_MS, HYSTERESIS_PCT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
