// 技術指標（純函式）：從日線算出均線、RSI、MACD、KD、布林通道、量比，並找出「今天發生了什麼」的訊號。
// 輸入 bars：[{ t, o, h, l, c, v }] 由舊到新；缺值（null）的日子先濾掉。
// 這些只是描述行情的統計量，不是買賣建議。
(function () {
  const last = (a, i = 0) => a[a.length - 1 - i];
  const sma = (xs, n) => xs.map((_, i) => (i + 1 < n ? null : xs.slice(i + 1 - n, i + 1).reduce((s, v) => s + v, 0) / n));
  function ema(xs, n) { const k = 2 / (n + 1), out = []; let e = null; xs.forEach((v, i) => { e = e == null ? v : v * k + e * (1 - k); out.push(i + 1 < n ? null : e); }); return out; }
  // RSI（Wilder 平滑）
  function rsi(cs, n = 14) {
    const out = [null]; let g = 0, l = 0;
    for (let i = 1; i < cs.length; i++) {
      const d = cs[i] - cs[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up; l += dn; out.push(i === n ? 100 - 100 / (1 + (g / n) / ((l / n) || 1e-9)) : null); if (i === n) { g /= n; l /= n; } }
      else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out.push(100 - 100 / (1 + g / (l || 1e-9))); }
    }
    return out;
  }
  function macd(cs, a = 12, b = 26, s = 9) {
    const ea = ema(cs, a), eb = ema(cs, b), dif = cs.map((_, i) => (ea[i] == null || eb[i] == null ? null : ea[i] - eb[i]));
    const start = dif.findIndex((v) => v != null), sig = ema(dif.slice(start), s);
    const dea = dif.map((_, i) => (i < start ? null : sig[i - start]));
    return { dif, dea, hist: dif.map((v, i) => (v == null || dea[i] == null ? null : v - dea[i])) };
  }
  // KD（隨機指標 9,3,3，台股常用）
  function kd(bars, n = 9) {
    let K = 50, D = 50; const ks = [], ds = [];
    bars.forEach((b, i) => {
      if (i + 1 < n) { ks.push(null); ds.push(null); return; }
      const w = bars.slice(i + 1 - n, i + 1), hh = Math.max(...w.map((x) => x.h)), ll = Math.min(...w.map((x) => x.l));
      const rsv = hh === ll ? 50 : (b.c - ll) / (hh - ll) * 100;
      K = K * 2 / 3 + rsv / 3; D = D * 2 / 3 + K / 3; ks.push(K); ds.push(D);
    });
    return { k: ks, d: ds };
  }
  function boll(cs, n = 20, m = 2) {
    const mid = sma(cs, n);
    return cs.map((_, i) => { if (mid[i] == null) return null; const w = cs.slice(i + 1 - n, i + 1), sd = Math.sqrt(w.reduce((s, v) => s + (v - mid[i]) ** 2, 0) / n); return { mid: mid[i], up: mid[i] + m * sd, dn: mid[i] - m * sd, width: mid[i] ? (2 * m * sd) / mid[i] : 0 }; });
  }
  const crossUp = (a, b) => last(a, 1) != null && last(b, 1) != null && last(a, 1) <= last(b, 1) && last(a) > last(b);
  const crossDn = (a, b) => last(a, 1) != null && last(b, 1) != null && last(a, 1) >= last(b, 1) && last(a) < last(b);

  // 分析：回傳數值與「訊號」清單（依重要性排序）
  function analyze(rawBars, { market = 'tw' } = {}) {
    const bars = (rawBars || []).filter((b) => b && [b.o, b.h, b.l, b.c].every((v) => v != null && isFinite(v)));
    if (bars.length < 30) return { ok: false, reason: '資料不足（至少要 30 個交易日）' };
    const cs = bars.map((b) => b.c), vs = bars.map((b) => b.v || 0), b0 = last(bars), b1 = last(bars, 1);
    const ma5 = sma(cs, 5), ma20 = sma(cs, 20), ma60 = sma(cs, 60), R = rsi(cs), M = macd(cs), KD = kd(bars), BB = boll(cs);
    const pct = (b0.c - b1.c) / b1.c * 100;
    const volAvg = vs.slice(-21, -1).reduce((s, v) => s + v, 0) / 20, volRatio = volAvg ? b0.v / volAvg : null;
    let streak = 0; for (let i = cs.length - 1; i > 0; i--) { const d = Math.sign(cs[i] - cs[i - 1]); if (!d || (streak && d !== Math.sign(streak))) break; streak += d; }
    const win = bars.slice(-60), hi60 = Math.max(...win.map((b) => b.h)), lo60 = Math.min(...win.map((b) => b.l));
    const gap = (b0.o - b1.c) / b1.c * 100, body = (b0.c - b0.o) / b0.o * 100, range = b0.h - b0.l;
    const v = { close: b0.c, pct, ma5: last(ma5), ma20: last(ma20), ma60: last(ma60), rsi: last(R), k: last(KD.k), d: last(KD.d), dif: last(M.dif), dea: last(M.dea), hist: last(M.hist),
      bb: last(BB), volRatio, streak, hi60, lo60, gap, body, days: bars.length, date: b0.t };
    const S = [], add = (id, score, dir, data) => S.push({ id, score, dir, ...data });
    // 價
    if (market === 'tw' && pct >= 9.5) add('limitUp', 100, 1); else if (market === 'tw' && pct <= -9.5) add('limitDown', 100, -1);
    else if (Math.abs(pct) >= 3) add(pct > 0 ? 'bigUp' : 'bigDown', 70 + Math.abs(pct), Math.sign(pct), { pct });
    if (b0.h >= hi60 && b0.c >= hi60 * 0.995) add('newHigh', 80, 1, { days: 60 });
    if (b0.l <= lo60 && b0.c <= lo60 * 1.005) add('newLow', 80, -1, { days: 60 });
    if (Math.abs(gap) >= 1.5) add(gap > 0 ? 'gapUp' : 'gapDown', 55 + Math.abs(gap), Math.sign(gap), { gap });
    if (Math.abs(streak) >= 3) add(streak > 0 ? 'streakUp' : 'streakDown', 50 + Math.min(8, Math.abs(streak)) * 3, Math.sign(streak), { n: Math.abs(streak) });
    // 均線
    if (crossUp(ma5, ma20)) add('goldenCross', 75, 1); if (crossDn(ma5, ma20)) add('deathCross', 75, -1);
    if (b1.c <= last(ma20, 1) && b0.c > v.ma20) add('aboveMa20', 60, 1); if (b1.c >= last(ma20, 1) && b0.c < v.ma20) add('belowMa20', 60, -1);
    if (v.ma60 != null) { if (v.ma5 > v.ma20 && v.ma20 > v.ma60) add('bullAlign', 35, 1); else if (v.ma5 < v.ma20 && v.ma20 < v.ma60) add('bearAlign', 35, -1); }
    // 動能
    if (v.rsi >= 70) add('rsiHot', 58 + (v.rsi - 70), 1, { rsi: v.rsi }); else if (v.rsi <= 30) add('rsiCold', 58 + (30 - v.rsi), -1, { rsi: v.rsi });
    if (crossUp(M.dif, M.dea)) add('macdUp', 65, 1); if (crossDn(M.dif, M.dea)) add('macdDown', 65, -1);
    if (crossUp(KD.k, KD.d)) add(v.k < 30 ? 'kdUpLow' : 'kdUp', v.k < 30 ? 66 : 48, 1, { k: v.k }); if (crossDn(KD.k, KD.d)) add(v.k > 70 ? 'kdDownHigh' : 'kdDown', v.k > 70 ? 66 : 48, -1, { k: v.k });
    // 波動與量
    if (v.bb) { if (b0.c > v.bb.up) add('bbUp', 62, 1); else if (b0.c < v.bb.dn) add('bbDown', 62, -1); const widths = BB.slice(-60).filter(Boolean).map((x) => x.width); if (v.bb.width <= Math.min(...widths) * 1.05) add('squeeze', 45, 0); }
    if (volRatio != null && vs.some((x) => x > 0)) { if (volRatio >= 2) add(pct >= 0 ? 'volUp' : 'volDown', 60 + Math.min(20, volRatio * 3), Math.sign(pct) || 1, { ratio: volRatio }); else if (volRatio <= 0.5) add('volDry', 30, 0, { ratio: volRatio }); }
    // K 棒形狀
    if (range > 0) { const upper = b0.h - Math.max(b0.o, b0.c), lower = Math.min(b0.o, b0.c) - b0.l; if (upper / range > 0.6 && pct < 1) add('longUpper', 42, -1); if (lower / range > 0.6 && pct > -1) add('longLower', 42, 1); }
    if (!S.length) add('quiet', 10, 0);
    S.sort((a, b) => b.score - a.score);
    const mood = S.reduce((s, x) => s + x.dir * x.score, 0);
    return { ok: true, v, signals: S, mood: mood > 60 ? 'bull' : mood < -60 ? 'bear' : 'flat' };
  }
  const api = { sma, ema, rsi, macd, kd, boll, analyze };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
