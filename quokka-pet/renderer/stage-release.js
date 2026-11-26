// 放生：一隻大禿鷹從螢幕另一邊飛過來，用腳爪握住庫卡，帶著牠飛出螢幕（回大自然）
//   主行程送 stage:release {qid}，接著才把牠從名單拿掉；舞台上這隻標記 releasing，名單更新時不會立刻消失，
//   等禿鷹飛出畫面才真的移除。時間軸（約 4.6 秒）：
//     0–1.7 秒  飛過來（從高處往下俯衝，到庫卡頭上）
//     1.7–2.3 秒 抓住：爪子抓住背，邊拎起來邊把庫卡放倒成橫的（像老鷹抓魚），「咦？」
//     2.3–4.6 秒 帶著飛走：往另一邊斜斜往上飛出螢幕，庫卡橫著在爪子下晃，「掰掰～」
(function () {
  const S = window.Stage, ANIM = S.ANIM;
  const T_IN = 1700, T_GRAB = 600, T_OUT = 2300;
  // 禿鷹（朝左），畫法和庫卡一樣：漸層上色、羽毛邊緣用同一種毛絨濾鏡（較強）、柔和的陰影與亮面、有光澤的眼睛。
  // 樣子要兇又餓：壓低的粗眉骨、窄眼（琥珀色虹膜、紅眼眶）、尖勾嘴半開露出舌頭、嘴角滴口水、
  // 細瘦起皺的禿脖子、肚子上隱約看得到肋骨、翅膀末端參差的飛羽、黑色彎爪。翅膀上下兩格交替拍動。
  const W = 240, H = 200, TALON = [119, 172];                // TALON＝兩腳爪中間（握住庫卡肩膀的位置）
  let seq = 0;
  function vultureSVG() {
    const id = 'vu' + (++seq);
    const wingUp = 'M118 74 C 126 44 150 18 186 6 C 196 3 210 2 226 4 C 216 10 222 13 214 17 C 224 20 214 25 206 27 C 214 32 202 35 194 36 C 200 42 186 44 178 44 C 182 50 168 52 160 52 C 150 62 136 70 124 82 Z';
    const wingDown = 'M118 80 C 132 96 152 120 178 140 C 186 146 198 152 214 156 C 206 150 212 148 204 144 C 214 142 204 136 198 134 C 206 130 194 126 186 124 C 192 118 178 116 170 114 C 172 106 158 102 150 98 C 140 90 130 84 122 80 Z';
    const vanes = (d) => [0, 1, 2, 3].map((k) => `<path d="${d(k)}" stroke="#6a5240" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".45" filter="url(#b1${id})"/>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" style="overflow:visible">
    <defs>
      <filter id="fz${id}" x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency="0.32" numOctaves="2" seed="9"/><feDisplacementMap in="SourceGraphic" scale="5.5" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation=".45"/></filter>
      <filter id="fs${id}" x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency="0.3" numOctaves="1" seed="4"/><feDisplacementMap in="SourceGraphic" scale="2.6" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation=".35"/></filter>
      <filter id="b1${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.2"/></filter>
      <filter id="b3${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3"/></filter>
      <linearGradient id="bd${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2b21"/><stop offset=".55" stop-color="#4d3a2c"/><stop offset="1" stop-color="#6a5341"/></linearGradient>
      <linearGradient id="wg${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4b3829"/><stop offset=".55" stop-color="#33261d"/><stop offset="1" stop-color="#1f1712"/></linearGradient>
      <radialGradient id="hd${id}" cx="42%" cy="35%" r="70%"><stop offset="0" stop-color="#e3a08e"/><stop offset=".6" stop-color="#c97564"/><stop offset="1" stop-color="#a5554b"/></radialGradient>
      <linearGradient id="nk${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cf8472"/><stop offset="1" stop-color="#9e5247"/></linearGradient>
      <linearGradient id="rf${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1e8d7"/><stop offset="1" stop-color="#cdbda2"/></linearGradient>
      <linearGradient id="bk${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ead08a"/><stop offset=".6" stop-color="#c79e4c"/><stop offset="1" stop-color="#7f6030"/></linearGradient>
    </defs>
    <ellipse cx="130" cy="96" rx="62" ry="30" fill="#2a1f18" opacity=".18" filter="url(#b3${id})" transform="translate(4 6)"/>
    <path d="M176 84 C 196 78 222 84 234 96 C 224 96 228 102 218 101 C 224 108 212 108 206 106 C 208 112 196 110 190 106 Z" fill="url(#wg${id})" filter="url(#fz${id})"/>
    <path d="M86 86 C 92 66 118 58 146 62 C 172 66 188 80 186 96 C 184 112 160 120 132 120 C 106 120 84 108 86 86 Z" fill="url(#bd${id})" filter="url(#fz${id})"/>
    <path d="M100 104 C 114 112 136 114 156 108" stroke="#2c211a" stroke-width="2.2" fill="none" opacity=".35" filter="url(#b1${id})"/>
    <path d="M98 96 q 12 8 26 7 M100 103 q 12 7 25 6 M104 110 q 10 5 21 4" stroke="#9a7f66" stroke-width="2" fill="none" opacity=".55" stroke-linecap="round" filter="url(#b1${id})"/>
    <path d="M99 99 q 12 7 25 6 M102 106 q 11 6 23 5" stroke="#241a14" stroke-width="1.6" fill="none" opacity=".35" stroke-linecap="round" filter="url(#b1${id})"/>
    <ellipse cx="130" cy="74" rx="26" ry="8" fill="#7a604a" opacity=".35" filter="url(#b3${id})"/>
    <path d="M108 114 C 104 132 98 148 92 164 M130 114 C 134 132 140 148 146 164" stroke="#9c8760" stroke-width="10" fill="none" stroke-linecap="round" filter="url(#fs${id})"/>
    <path d="M106 122 C 103 136 99 148 95 158 M132 122 C 135 136 139 148 143 158" stroke="#c9b588" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".45"/>
    <path d="M100 134 h 8 M97 144 h 8 M95 153 h 7 M131 134 h 8 M134 144 h 8 M137 153 h 7" stroke="#6f5d40" stroke-width="1" opacity=".45"/>
    <g class="talons">
      <ellipse cx="92" cy="166" rx="9" ry="6" fill="#9c8760" filter="url(#fs${id})"/><ellipse cx="146" cy="166" rx="9" ry="6" fill="#9c8760" filter="url(#fs${id})"/>
      <g fill="#231b16">
        <path d="M86 164 C 84 172 88 180 96 182 C 92 176 91 171 92 166 Z"/><path d="M92 168 C 92 176 97 182 104 182 C 99 178 97 173 97 168 Z"/><path d="M98 164 C 101 170 106 174 110 173 C 106 170 104 166 103 162 Z"/>
        <path d="M152 164 C 154 172 150 180 142 182 C 146 176 147 171 146 166 Z"/><path d="M146 168 C 146 176 141 182 134 182 C 139 178 141 173 141 168 Z"/><path d="M140 164 C 137 170 132 174 128 173 C 132 170 134 166 135 162 Z"/>
      </g>
    </g>
    <g class="wing wing-up"><path d="${wingUp}" fill="url(#wg${id})" filter="url(#fz${id})"/>
      ${vanes((k) => `M${140 + k * 14} ${56 - k * 8} L ${186 + k * 10} ${22 - k * 4}`)}
      <path d="M124 74 C 138 58 156 46 176 38" stroke="#6e5541" stroke-width="5" fill="none" opacity=".35" stroke-linecap="round" filter="url(#b3${id})"/></g>
    <g class="wing wing-down"><path d="${wingDown}" fill="url(#wg${id})" filter="url(#fz${id})"/>
      ${vanes((k) => `M${140 + k * 12} ${100 + k * 6} L ${178 + k * 10} ${134 + k * 4}`)}
      <path d="M126 86 C 142 98 158 108 176 118" stroke="#6e5541" stroke-width="5" fill="none" opacity=".35" stroke-linecap="round" filter="url(#b3${id})"/></g>
    <path d="M68 78 C 64 70 70 62 78 62 C 78 54 88 52 94 56 C 100 50 112 54 112 62 C 120 64 122 74 116 78 C 120 86 112 92 104 90 C 98 96 86 96 82 90 C 72 92 66 86 68 78 Z" fill="url(#rf${id})" filter="url(#fz${id})"/>
    <path d="M78 70 q 6 -6 12 -1 q 6 -6 12 0 q 5 -4 9 2" stroke="#fffaf0" stroke-width="2" fill="none" opacity=".55" stroke-linecap="round" filter="url(#b1${id})"/>
    <path d="M86 66 C 80 54 72 46 62 44 C 58 52 64 58 70 62 C 74 66 78 70 84 72 Z" fill="url(#nk${id})" filter="url(#fs${id})"/>
    <path d="M70 52 q 4 3 8 2 M74 58 q 4 3 8 2 M78 63 q 3 3 7 2" stroke="#8a4238" stroke-width="1" fill="none" opacity=".5" stroke-linecap="round"/>
    <path d="M30 40 C 30 26 44 18 58 22 C 70 25 74 36 70 46 C 66 56 52 60 42 56 C 34 53 30 48 30 40 Z" fill="url(#hd${id})" filter="url(#fs${id})"/>
    <path d="M58 30 q 4 4 4 10 M64 34 q 2 4 1 9" stroke="#9a4c42" stroke-width="1" fill="none" opacity=".45" stroke-linecap="round"/>
    <ellipse cx="44" cy="34" rx="7" ry="6" fill="#5a2a24" opacity=".35" filter="url(#b1${id})"/>
    <circle cx="44" cy="36" r="5.6" fill="#f6c03a"/><circle cx="44" cy="36" r="5.6" fill="none" stroke="#c0392b" stroke-width="1.6" opacity=".85"/>
    <path d="M39.5 38 l 2 -1 M48.6 38.6 l -2 -1" stroke="#c0392b" stroke-width=".7" opacity=".7"/>
    <circle cx="43.2" cy="36.6" r="1.5" fill="#120c0a"/><circle cx="45.6" cy="35.4" r=".9" fill="#fff"/>
    <path d="M36 33 C 40 30 47 31 54 37 L 54 30 C 47 27 40 27 35 30 Z" fill="#b9675b"/>
    <path d="M36.5 33.2 C 41 31 47 32 53 36.6" stroke="#5a2620" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="M33 31 C 40 25 50 27 58 34" stroke="#3d1915" stroke-width="4.2" fill="none" stroke-linecap="round"/>
    <path d="M38 55 C 30 58 22 64 16 70 C 24 71 32 67 39 61 Z" fill="#a8823e" filter="url(#fs${id})"/>
    <path d="M38 52 C 29 55 21 60 16 67 C 24 66 31 62 38 58 Z" fill="#3e1715"/>
    <path d="M33 56 C 28 59 24 62 21 65 C 26 65 30 62 34 59 Z" fill="#d9707a"/>
    <path d="M38 44 C 28 41 15 42 6 50 C 1 55 1 63 6 66 C 7 61 10 58 14 57 C 22 54 31 52 40 51 Z" fill="url(#bk${id})" filter="url(#fs${id})"/>
    <path d="M6 66 C 3 61 4 55 9 52" stroke="#3b2f25" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path d="M16 47 C 22 45 30 45 36 46" stroke="#f6e3a8" stroke-width="1.4" fill="none" opacity=".6" stroke-linecap="round"/>
    <path d="M37 48 C 40 50 42 51 46 50" stroke="#7f6030" stroke-width="1.2" fill="none" opacity=".6" stroke-linecap="round"/>
    <g class="drool"><path d="M18 67 C 17 72 17 77 19 80 C 21 77 21 72 19 67 Z" fill="#dff3ff" opacity=".85"/><circle cx="19" cy="81" r="2.6" fill="#e8f7ff" opacity=".9"/><circle cx="18.2" cy="80.2" r=".8" fill="#fff"/></g>
  </svg>`;
  }
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
    const sc = S.clamp(a.w * 1.9 / W, .8, 2.4);                    // 大隻：翼展約庫卡寬度的兩倍
    const v = document.createElement('div');
    v.className = 'vulture';
    v.innerHTML = vultureSVG();
    S.fxEl.appendChild(v);
    const fromRight = a.x < innerWidth / 2;                     // 從比較遠的那一邊飛來，往同一邊的對面飛走
    const dir = fromRight ? -1 : 1;                             // 飛行方向（-1 往左）
    // 握法：像老鷹抓魚——庫卡橫躺在爪子下，頭朝飛行方向，兩隻腳爪抓在背上
    //   以庫卡圖框的中心為旋轉中心；爪子抓在中心往上 GRIP 的位置（躺平後就是背上）
    const C_OFF = (S.FOOT.y - S.VB.y) * a.k - a.h / 2;            // 腳底到圖框中心的距離
    const GRIP = 30 * a.k;                                       // 爪子在中心上方多少（身體半邊的厚度）
    const ROT = 84 * dir;                                        // 躺平的角度：頭朝飛行方向
    // 爪子抓的那一點 p（相對圖框中心、還沒轉的時候）：選「躺平後朝上」的那一側，轉完剛好在背上
    const TH = ROT * Math.PI / 180, px = -GRIP * Math.sin(TH), py = -GRIP * Math.cos(TH);
    const turned = (deg) => { const r = deg * Math.PI / 180; return { x: px * Math.cos(r) - py * Math.sin(r), y: px * Math.sin(r) + py * Math.cos(r) }; };
    const g0 = { x: a.x + px, y: a.y - C_OFF + py };
    const start = { x: fromRight ? innerWidth + W * sc : -W * sc, y: -H * sc - 40 };
    const end = { x: fromRight ? -W * sc - 80 : innerWidth + W * sc + 80, y: -H * sc - a.h - 120 };
    const ground = a.y;
    let t0 = 0, said = 0, rot = 0;
    a.el.style.transformOrigin = '50% 50%';
    const placeRot = () => { a.place(); if (rot) a.el.style.transform += ` rotate(${rot.toFixed(1)}deg)`; };
    const put = (x, y, tilt) => {                                // 讓爪子落在 (x, y)
      // 原點在左上角：朝左（不翻）時爪子在 left + TALON·sc；往右飛要左右翻（scaleX 負），爪子在 left − TALON·sc
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
        if (t < T_IN + T_GRAB) {                                 // 抓住：爪子抓住背，邊拎起來邊把牠放倒成橫的
          const u = (t - T_IN) / T_GRAB, e = ease(u);
          if (said === 0) { said = 1; a.setFrame('lift', 0, ANIM.STILL.lift); a.el.classList.add('dragging'); a.zBoost = 20000; if (a.tag) a.tag.style.display = 'none'; a.say('咦？', { ms: 900 }); }
          rot = ROT * e;
          // 爪子固定在 p 那一點；庫卡繞圖框中心轉，所以中心＝爪子 − 轉過的 p
          const lift = 24 * e, gx = g0.x, gy = g0.y - lift, q = turned(rot);
          a.x = gx - q.x; a.y = gy - q.y + C_OFF; placeRot();
          put(gx, gy, 0);
          return true;
        }
        const u = Math.min(1, (t - T_IN - T_GRAB) / T_OUT), e = u * u;   // 帶著飛走：慢慢加速，庫卡橫著在爪子下晃
        if (said === 1 && u > .08) { said = 2; a.say('掰掰～', { ms: 1800 }); }
        const vx = bez(g0.x, g0.x + dir * 120, end.x, e), vy = bez(g0.y - 24, g0.y - 70, end.y, e);
        rot = ROT + Math.sin(t / 190) * 5;
        const q = turned(rot);
        a.x = vx - q.x; a.y = vy - q.y + C_OFF; placeRot();
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
  S.vultureSVG = vultureSVG;                                     // 預覽、測試用
  if (S.api && S.api.onRelease) S.api.onRelease((p) => { if (p && p.qid) S.release(p.qid); });
})();
