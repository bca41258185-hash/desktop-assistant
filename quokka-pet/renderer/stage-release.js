// 放生：一隻禿鷹從螢幕另一邊飛過來，抓住庫卡的後頸，帶著牠飛出螢幕（回大自然）
//   主行程送 stage:release {qid}，接著才把牠從名單拿掉；舞台上這隻標記 releasing，名單更新時不會立刻消失，
//   等禿鷹飛出畫面才真的移除。時間軸（約 4.6 秒）：
//     0–1.7 秒  飛過來（從高處往下俯衝，到庫卡頭上）
//     1.7–2.3 秒 抓住：庫卡換成被拎起來的姿勢，「咦？」
//     2.3–4.6 秒 帶著飛走：往另一邊斜斜往上飛出螢幕，庫卡在爪子下晃，「掰掰～」
(function () {
  const S = window.Stage, ANIM = S.ANIM;
  const T_IN = 1700, T_GRAB = 600, T_OUT = 2300;
  // 卡通禿鷹（朝左）：深棕身體、白色頸毛圈、光禿的粉紅頭、黃色勾嘴、黃腳爪；翅膀上下兩格交替拍動
  const W = 200, H = 140, TALON = [100, 116];
  const SVG = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <g class="wing wing-up"><path d="M98 62 C 112 20 150 2 192 6 C 180 14 186 18 176 22 C 184 28 172 30 166 34 C 172 40 158 42 150 46 C 140 56 122 62 108 70 Z" fill="#3b2a20"/>
      <path d="M118 52 C 138 30 160 20 182 14" stroke="#5a4232" stroke-width="3" fill="none" stroke-linecap="round"/></g>
    <path d="M150 70 C 172 66 192 74 198 86 C 186 84 184 90 176 88 C 178 96 166 94 160 92 Z" fill="#3b2a20"/>
    <ellipse cx="112" cy="74" rx="46" ry="27" fill="#4a3426"/>
    <ellipse cx="104" cy="82" rx="30" ry="14" fill="#5c4331"/>
    <g class="wing wing-down"><path d="M100 70 C 118 92 150 116 190 120 C 178 112 184 108 172 104 C 180 98 168 96 162 92 C 168 86 154 84 146 80 C 134 74 118 70 104 66 Z" fill="#3b2a20"/>
      <path d="M118 80 C 138 98 160 108 182 112" stroke="#5a4232" stroke-width="3" fill="none" stroke-linecap="round"/></g>
    <path d="M92 96 L 96 110 M108 96 L 106 110" stroke="#d4a94a" stroke-width="5" stroke-linecap="round"/>
    <path d="M88 112 q 4 -6 10 -2 q 4 -5 9 0 q 5 -4 8 2" stroke="#d4a94a" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M86 112 q -1 5 3 7 M97 110 q -1 6 2 8 M107 110 q 0 6 3 8 M117 113 q 1 5 -2 7" stroke="#3a2c20" stroke-width="2" fill="none" stroke-linecap="round"/>
    <ellipse cx="74" cy="62" rx="19" ry="15" fill="#efe6d6"/>
    <path d="M60 58 q 6 -8 14 -2 q 6 -8 14 0 q 4 6 -2 12" fill="#e2d6c1"/>
    <path d="M66 54 C 62 42 56 34 50 34" stroke="#d48f7e" stroke-width="9" fill="none" stroke-linecap="round"/>
    <circle cx="48" cy="36" r="14" fill="#e8a48f"/>
    <circle cx="44" cy="32" r="4.2" fill="#fff"/><circle cx="43" cy="32.5" r="2.6" fill="#2a1f19"/><circle cx="42.2" cy="31.6" r=".9" fill="#fff"/>
    <path d="M36 37 C 28 36 22 40 21 46 C 25 44 28 44 30 46 C 33 43 36 42 38 42 Z" fill="#e9c46a"/>
    <path d="M21 46 C 20 49 22 51 24 50" stroke="#8a6a2a" stroke-width="2" fill="none" stroke-linecap="round"/>
    <ellipse cx="50" cy="41" rx="4" ry="2.4" fill="#f2a0a0" opacity=".7"/>
  </svg>`;
  const ease = (u) => (u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
  const bez = (p0, p1, p2, u) => (1 - u) * (1 - u) * p0 + 2 * (1 - u) * u * p1 + u * u * p2;

  S.release = function (qid) {
    const a = S.actors.get(qid);
    if (!a || a.releasing) return false;
    a.releasing = true;
    if (a.cancelDrag) try { a.cancelDrag(); } catch (e) { /* 沒在拖 */ }
    if (a.job) { const j = a.job; a.job = null; try { j.interrupt && j.interrupt('release'); } catch (e) { /* 收尾出錯不影響放生 */ } }
    try { a.hideLive(); } catch (e) { /* 沒有即時畫面 */ }
    if (S.reduceMotion || S.mode === 'hidden') { gone(a, null); return true; }      // 減少動態效果、藏起來：直接離開
    const sc = S.clamp(a.w * 1.25 / W, .6, 1.6);
    const v = document.createElement('div');
    v.className = 'vulture';
    v.innerHTML = SVG;
    S.fxEl.appendChild(v);
    const fromRight = a.x < innerWidth / 2;                     // 從比較遠的那一邊飛來，往同一邊的對面飛走
    const dir = fromRight ? -1 : 1;                             // 飛行方向（-1 往左）
    const head = () => ({ x: a.x, y: a.y - a.h * .86 });         // 抓的位置：後頸（頭頂下面一點）
    const g0 = head();
    const start = { x: fromRight ? innerWidth + W * sc : -W * sc, y: -H * sc - 40 };
    const end = { x: fromRight ? -W * sc - 80 : innerWidth + W * sc + 80, y: -H * sc - a.h - 120 };
    const ground = a.y;
    let t0 = 0, said = 0;
    const put = (x, y, tilt) => {                                // 讓爪子落在 (x, y)
      // 原點在左上角：朝左（不翻）時爪子在 left + 100·sc；往右飛要左右翻（scaleX 負），爪子在 left − 100·sc
      const left = dir < 0 ? x - TALON[0] * sc : x + TALON[0] * sc;
      v.style.transform = `translate3d(${left.toFixed(1)}px, ${(y - TALON[1] * sc).toFixed(1)}px, 0) scale(${dir < 0 ? sc : -sc}, ${sc}) rotate(${tilt.toFixed(1)}deg)`;
    };
    v.style.transformOrigin = '0 0';
    const job = { name: 'release', ticks: true, layer: 0,
      start(now) { t0 = now; },
      tick(now) {
        if (!t0) t0 = now;
        const t = now - t0;
        if (t < T_IN) {                                          // 俯衝過來：二次曲線，控制點在庫卡上方偏低處
          const u = ease(t / T_IN), mid = { x: (start.x + g0.x) / 2, y: g0.y - 30 };
          put(bez(start.x, mid.x, g0.x, u), bez(start.y, mid.y, g0.y, u), -8 * dir * (1 - u));
          return true;
        }
        if (t < T_IN + T_GRAB) {                                 // 抓住：拍翅膀停在空中，把庫卡拎起來一點
          const u = (t - T_IN) / T_GRAB;
          if (said === 0) { said = 1; a.setFrame('lift', 0, ANIM.STILL.lift); a.el.classList.add('dragging'); a.zBoost = 20000; a.say('咦？', { ms: 900 }); }
          const lift = 18 * ease(u);
          a.y = ground - lift; a.place();
          const h = head(); put(h.x, h.y, 0);
          return true;
        }
        const u = Math.min(1, (t - T_IN - T_GRAB) / T_OUT), e = u * u;   // 帶著飛走：慢慢加速
        if (said === 1 && u > .08) { said = 2; a.say('掰掰～', { ms: 1800 }); }
        const vx = bez(g0.x, g0.x + dir * 120, end.x, e), vy = bez(g0.y - 18, g0.y - 60, end.y, e);
        const swing = Math.sin(t / 170) * 6;
        a.x = vx + swing; a.y = vy + a.h * .86; a.place();
        put(vx, vy, -6 * dir);
        if (u >= 1) { gone(a, v); return true; }
        return true;
      },
      interrupt() { /* 放生不能被打斷 */ }
    };
    a.job = job; a.setLayer && a.setLayer(0);
    S.kick();
    return true;
  };
  function gone(a, v) {
    if (v) v.remove();
    a.job = null;
    try { a.destroy(); } catch (e) { /* 盡量清乾淨 */ }
    S.actors.delete(a.id);
    S.reportRects();
  }
  if (S.api && S.api.onRelease) S.api.onRelease((p) => { if (p && p.qid) S.release(p.qid); });
})();
