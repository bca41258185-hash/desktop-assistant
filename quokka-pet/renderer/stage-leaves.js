// 落葉雨：每 5 分鐘從螢幕上方飄下一陣葉子，落在庫卡走路的地面上；閒著的庫卡會跳過去撿起來吃
//   · 只在醒著（不是睡著、不是藏起來）而且沒開「減少動態效果」時下
//   · 葉子落地後，閒著的庫卡各自挑最近、沒人要的那片：跳過去 → 撿起來（地上的葉子消失）→ 播吃葉子的動畫
//   · 每隻一陣雨最多吃 4 片；挑路上沒有別隻擋著的葉子；1 分鐘沒人撿的葉子淡出
//   · 滑鼠快速繞圈（1.5 秒內繞 2 圈，主行程 lib/gesture.js 偵測）也會馬上下一陣
//   · 測試、除錯：window.__stage.leafRain()
(function () {
  const S = window.Stage, ANIM = S.ANIM;
  const RAIN_MS = 5 * 60000, LEAF_TTL = 60000, PER_EATER = 4;
  const COLORS = [['#6fae4a', '#4f8a33'], ['#86bf55', '#5e9a3a'], ['#9cc25a', '#6f9a36'], ['#e0b84a', '#b98d2c'], ['#e38a3c', '#b8612a']];
  const leaves = new Set();        // 地上的葉子：{ el, x, y, claimedBy, born }
  let timer = 0, tickT = 0;

  function leafSVG([fill, vein], rot) {
    return `<svg viewBox="-12 -20 24 40" width="22" height="34" style="transform:rotate(${rot}deg)" aria-hidden="true">
      <path d="M0 -18 C 10 -10 11 6 0 18 C -11 6 -10 -10 0 -18 Z" fill="${fill}"/>
      <path d="M0 -15 L0 16 M0 -4 L5 -8 M0 3 L-5 -1 M0 9 L4 6" stroke="${vein}" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`;
  }
  // 地面：庫卡站的那幾條水平線（大家通常在同一條）
  function grounds() {
    const ys = [...S.actors.values()].filter((a) => !a.inPouch && !a.isFollow).map((a) => Math.round(a.y));
    return ys.length ? ys : [innerHeight - 6];
  }
  function rain(n) {
    if (S.mode !== 'awake' || S.reduceMotion || !S.actors.size) return false;
    const gs = grounds(), xs = [...S.actors.values()].map((a) => a.x);
    const lo = Math.max(40, Math.min(...xs) - 350), hi = Math.min(innerWidth - 40, Math.max(...xs) + 350);
    n = n || 10 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const x = lo + Math.random() * (hi - lo), y = gs[Math.floor(Math.random() * gs.length)];
      const delay = Math.random() * 4500, dur = 3800 + Math.random() * 2600, rot = Math.random() * 360;
      const el = document.createElement('div');
      el.className = 'leaf-fall';
      el.style.cssText = `--x:${x.toFixed(0)}px;--y0:${(-60 - Math.random() * 80).toFixed(0)}px;--y1:${(y - 8).toFixed(0)}px;--sway:${(20 + Math.random() * 40).toFixed(0)}px;animation-duration:${dur.toFixed(0)}ms;animation-delay:${delay.toFixed(0)}ms`;
      el.innerHTML = `<div class="leaf-sway" style="animation-duration:${(900 + Math.random() * 700).toFixed(0)}ms">${leafSVG(COLORS[Math.floor(Math.random() * COLORS.length)], rot)}</div>`;
      S.fxEl.appendChild(el);
      setTimeout(() => land(el, x, y), delay + dur);
    }
    S.eatenThisRain = new Map();
    kickTick();
    return true;
  }
  function land(el, x, y) {
    if (!el.isConnected) return;
    el.classList.add('landed');
    const lf = { el, x, y, claimedBy: null, born: performance.now() };
    leaves.add(lf);
    kickTick();
  }
  function removeLeaf(lf, fade) {
    leaves.delete(lf);
    if (fade) { lf.el.classList.add('fade'); setTimeout(() => lf.el.remove(), 800); } else lf.el.remove();
  }
  // 每 0.6 秒：把沒人要的葉子分給閒著的庫卡；過期的淡出
  function kickTick() { if (!tickT) tickT = setTimeout(assign, 600); }
  function assign() {
    tickT = 0;
    const now = performance.now();
    for (const lf of [...leaves]) if (!lf.claimedBy && now - lf.born > LEAF_TTL) removeLeaf(lf, true);
    if (!leaves.size) return;
    if (S.mode === 'awake') {
      const eaten = S.eatenThisRain || new Map();
      const free = [...S.actors.values()].filter((a) => !a.job && a.mode === 'awake' && !a.inPouch && !a.isFollow && !a.dragging && !a.alerts.length && !a.queue.length && (eaten.get(a.id) || 0) < PER_EATER);
      for (const a of free) {
        let best = null, bd = Infinity;
        for (const lf of leaves) {
          if (lf.claimedBy || Math.abs(lf.y - a.y) > 40) continue;
          const d = Math.abs(lf.x - a.x);
          if (d >= bd || d >= 900 || (lf.skip && lf.skip.has(a))) continue;
          // 路上（含葉子旁邊的站位）有別隻：跳過去會被擋住，換一片
          const lo = Math.min(a.x, lf.x) - 60, hi = Math.max(a.x, lf.x) + 60;
          if ([...S.actors.values()].some((o) => o !== a && !o.inPouch && Math.abs(o.y - a.y) <= 40 && o.x > lo && o.x < hi && Math.abs(o.x - a.x) > 30)) continue;
          bd = d; best = lf;
        }
        if (!best) continue;
        best.claimedBy = a;
        if (!a.requestActivity(6, fetchLeafJob(a, best))) best.claimedBy = null;
      }
    }
    kickTick();
  }
  // 跳到葉子旁邊（站在葉子前面一點，吃的時候葉子在手上）→ 撿起來 → 吃
  function fetchLeafJob(a, lf) {
    const side = lf.x >= a.x ? 1 : -1;
    const stand = S.clamp(lf.x - side * 18 * a.k / S.SCALE, 30, innerWidth - 30);
    let m = null;
    const job = { name: 'leaf', ticks: true,
      start() { m = Math.abs(stand - a.x) > 3 ? a.mover(stand, { tol: 3, check: (nx, d) => !a.blocked(nx, d, null, null, { cursor: false }) }) : null; },
      tick(now) {
        if (!leaves.has(lf)) return false;                                   // 被別的拿走或過期了
        if (m && m.tick(now)) return true;
        if (m && m.blocked) { lf.claimedBy = null; (lf.skip || (lf.skip = new Set())).add(a); return false; }   // 路被擋住：這片讓別隻去撿
        // 到了：撿起來，接著吃（吃葉子動畫手上就有葉子）
        removeLeaf(lf, false);
        const eaten = S.eatenThisRain || (S.eatenThisRain = new Map());
        eaten.set(a.id, (eaten.get(a.id) || 0) + 1);
        a.faceDir = side;
        job.ate = true;
        return false;
      },
      end() { if (job.ate) eatSoon(a, side, 0); },
      interrupt() { if (leaves.has(lf)) lf.claimedBy = null; }
    };
    return job;
  }
  // 撿起來之後吃：先等收尾的小動作（轉回正面）做完，最多等 3 秒
  function eatSoon(a, side, n) {
    setTimeout(() => {
      const an = ANIM.IDLE && ANIM.IDLE.eat;
      if (!an || a.mode !== 'awake' || !S.actors.has(a.id)) return;
      if (a.job) { if (a.job.layer <= 5 || n >= 15) return; if (a.job.name === 'settle' || /^idle:/.test(a.job.name)) return eatSoon(a, side, n + 1); return; }
      if (!a.requestActivity(6, a.animJob('idle:eat', an, { flip: side > 0 })) && n < 15) eatSoon(a, side, n + 1);
    }, n ? 200 : 0);
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => { rain(); schedule(); }, RAIN_MS); }
  schedule();
  S.leafRain = rain;
  // 使用者用滑鼠快速繞圈（主行程偵測）：馬上下一陣
  if (S.api && S.api.onLeafRain) S.api.onLeafRain(() => { rain(); });
  S.groundLeaves = leaves;
})();
