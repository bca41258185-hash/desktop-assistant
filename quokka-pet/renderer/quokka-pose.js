// 可擺姿勢的 3D 庫卡：pose 物件 → 任意角度的 SVG。
// 動作與多隻互動都用「關鍵姿勢 + 內插」驅動，所以身體可以蹲、跳、前傾，頭可以轉、點、歪，
// 雙手在 3D 空間定位（會自動決定在身體前或後），道具與特效跟著手或場景走。
//
// 座標同 quokka-art.js：x 右、y 下、z 朝前（口鼻方向）；θ＝整隻轉向角（0 正面、90 面向右）。
// pose 欄位（都可省略）：
//   x, y        畫面位移（y 負＝跳起）
//   sq          壓扁／拉長（<1 蹲壓、>1 伸展），以腳底為基準，體積大致守恆
//   lean, roll  身體前傾（正＝往口鼻方向）、側傾（正＝頭往右）；以腳底為支點
//   head        { yaw 左右轉, pitch 點頭（正＝低頭）, roll 歪頭 }
//   arms        { L: {hand:[x,y,z], elbow?:[x,y,z], paw?:角度}, R: … }；省略＝合在胸前
//   eyes        open | happy | closed | wide | focus | dizzy ；look:[dx,dy] 眼珠方向
//   mouth       smile | open | o | flat | chew
//   blush       腮紅濃度 0–1.5
//   feet        auto | stand | air（騰空時腳尖朝下）；tailUp 尾巴上揚 0–1
//   props       [{t:'racket', hand:'R', ang, len}, {t:'shuttle'|'vball'|'bball'|'leaf', at:[X,Y], rot, s}, {t:'hoop', at}, {t:'fx', kind, at, rot, s}]

(function () {
  const A = (typeof window !== 'undefined' && window.QuokkaArt) ? window.QuokkaArt : require('./quokka-art.js');
  const I = A.internals;
  const rad = (a) => a * Math.PI / 180, f1 = (v) => (+v).toFixed(1);
  const HEAD = new Set(['head', 'cheekL', 'cheekR', 'snout', 'snoutTip']);
  const FEET_Y = 176, NECK = [0, 80, -2];

  // ---- 3D 變換 -------------------------------------------------------------
  function rotX(p, a, c) { const s = Math.sin(rad(a)), co = Math.cos(rad(a)), y = p[1] - c[1], z = p[2] - c[2]; return [p[0], c[1] + y * co + z * s, c[2] + z * co - y * s]; }
  function rotZ(p, a, c) { const s = Math.sin(rad(a)), co = Math.cos(rad(a)), x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * co - y * s, c[1] + y * co + x * s, p[2]]; }
  function rotY(p, a, c) { const s = Math.sin(rad(a)), co = Math.cos(rad(a)), x = p[0] - c[0], z = p[2] - c[2]; return [c[0] + x * co + z * s, p[1], c[2] - x * s + z * co]; }
  function makeT(pose) {
    const sq = pose.sq || 1, k = 1 / Math.sqrt(sq), h = pose.head || {};
    const B = (p) => {
      let q = [p[0] * k, FEET_Y + (p[1] - FEET_Y) * sq, p[2] * k];
      if (pose.lean) q = rotX(q, pose.lean, [0, FEET_Y, 0]);
      if (pose.roll) q = rotZ(q, pose.roll, [0, FEET_Y, 0]);
      return [q[0], q[1] + (pose.y || 0), q[2]];
    };
    const H = (p) => {
      let q = p;
      if (h.roll) q = rotZ(q, h.roll, NECK);
      if (h.pitch) q = rotX(q, -h.pitch, NECK);
      if (h.yaw) q = rotY(q, h.yaw, NECK);
      return B(q);
    };
    return { B, H, sq, k, yaw: h.yaw || 0 };
  }

  // ---- 輪廓：逐列取橢圓聯集、平滑 -------------------------------------------
  function union(E) {
    let y0 = Infinity, y1 = -Infinity;
    E.forEach((e) => { y0 = Math.min(y0, e.cy - e.ry); y1 = Math.max(y1, e.cy + e.ry); });
    const rows = [];
    for (let y = Math.ceil(y0); y <= Math.floor(y1); y += 1) {
      let L = Infinity, R = -Infinity;
      for (const e of E) { const d = (y - e.cy) / e.ry; if (Math.abs(d) < 1) { const w = e.rx * Math.sqrt(1 - d * d); L = Math.min(L, e.cx - w); R = Math.max(R, e.cx + w); } }
      if (R > L) rows.push([y, L, R]);
    }
    if (rows.length < 3) return '';
    const sm = (k) => rows.map((r0, i) => { let w = 0, v = 0; for (let j = -6; j <= 6; j++) { const q = rows[i + j]; if (!q) continue; const ww = Math.exp(-(j * j) / 14); w += ww; v += q[k] * ww; } return v / w; });
    const Ls = sm(1), Rs = sm(2), pts = [];
    const top = rows[0][0], bot = rows[rows.length - 1][0];
    pts.push([(Ls[0] + Rs[0]) / 2, top - 1]);
    for (let i = 0; i < rows.length; i += 3) pts.push([Rs[i], rows[i][0]]);
    pts.push([Rs[rows.length - 1], bot]); pts.push([(Ls[rows.length - 1] + Rs[rows.length - 1]) / 2, bot + 1]);
    pts.push([Ls[rows.length - 1], bot]);
    for (let i = rows.length - 1; i >= 0; i -= 3) pts.push([Ls[i], rows[i][0]]);
    return I.cr(pts);
  }

  // ---- 道具與特效（畫面座標） ----------------------------------------------
  const PROP_DEFS = (id) => `
    <radialGradient id="vb${id}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#eceae3"/><stop offset="1" stop-color="#bdb9ae"/></radialGradient>
    <radialGradient id="bb${id}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#f6a35a"/><stop offset=".65" stop-color="#e27a2c"/><stop offset="1" stop-color="#a94e16"/></radialGradient>
    <linearGradient id="lf${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8cc06b"/><stop offset="1" stop-color="#4d8a3a"/></linearGradient>
    <radialGradient id="fl${id}"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".5" stop-color="#fff6c8" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`;
  function racket(id, hx, hy, ang, len = 1, hit = false, swoosh = false) {
    // ang：拍子方向（0＝朝上，順時針為正）；握把從手掌往外
    return `<g transform="translate(${f1(hx)} ${f1(hy)}) rotate(${f1(ang)}) scale(${len})">
      <line x1="0" y1="4" x2="0" y2="-11" stroke="#2f3540" stroke-width="2.6" stroke-linecap="round"/>
      <line x1="0" y1="3" x2="0" y2="-4" stroke="#d9d3c4" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M-1.4 -11 L0 -14 L1.4 -11" fill="none" stroke="#2b5f9a" stroke-width="1.4"/>
      <ellipse cx="0" cy="-25" rx="9" ry="11.5" fill="#ffffff" fill-opacity=".5" stroke="#2b5f9a" stroke-width="2.2"/>
      <path d="M-5 -34 V-16 M0 -36.5 V-13.5 M5 -34 V-16 M-8 -30 H8 M-8.8 -25 H8.8 M-8 -20 H8" stroke="#a7bdd1" stroke-width=".6" fill="none"/>
      ${swoosh ? `<path d="M14 -6 Q20 -30 2 -44" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".75"/><path d="M14 -6 Q20 -30 2 -44" fill="none" stroke="#b8c7da" stroke-width="1.5" stroke-linecap="round"/>` : ''}
      ${hit ? fx(id, 'impact', 0, -27, 0, .8) : ''}
    </g>`;
  }
  const shuttle = (x, y, rot = 0, s = 1) => `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)}) scale(${s})">
      <path d="M-2 0 L-13 -6.5 L-13 6.5 Z" fill="#ffffff" stroke="#b9bec5" stroke-width=".8" stroke-linejoin="round"/>
      <path d="M-2 0 L-12.5 -3 M-2 0 L-12.5 3 M-2 0 L-13 0" stroke="#d6dade" stroke-width=".5"/>
      <circle cx="0" cy="0" r="3.3" fill="#fff8ec" stroke="#c9483a" stroke-width="1.4"/></g>`;
  const vball = (id, x, y, rot = 0, s = 1) => `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)}) scale(${s})">
      <circle r="12" fill="url(#vb${id})" stroke="#9aa0a8" stroke-width=".9"/>
      <path d="M-12 0 Q0 -6.3 12 0 M-7.6 -9.2 Q2.5 -2.5 3.3 11.5 M7.6 -9.2 Q5.3 2.3 -6.6 9.9" fill="none" stroke="#3f6fb5" stroke-width="1.5"/>
      <path d="M-10.1 6 Q-1.3 7.6 5.7 10.5" fill="none" stroke="#e2b53b" stroke-width="1.5"/></g>`;
  const bball = (id, x, y, rot = 0, s = 1) => `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)}) scale(${s})">
      <circle r="12" fill="url(#bb${id})"/>
      <path d="M-12 0 H12 M0 -12 V12 M-8.6 -8.3 Q-2 0 -8.6 8.3 M8.6 -8.3 Q2 0 8.6 8.3" fill="none" stroke="#5a2a0d" stroke-width="1.15"/></g>`;
  const leaf = (id, x, y, rot = 0, s = 1) => `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)}) scale(${s})">
      <path d="M0 0 C-8 -8 -18 -14 -28 -13 C-24 -5 -14 1 0 0 Z" fill="url(#lf${id})" stroke="#3f7a2f" stroke-width=".8"/>
      <path d="M0 0 C-10 -5 -18 -9 -26 -11.5" fill="none" stroke="#e9f3dc" stroke-width=".7" opacity=".8"/></g>`;
  const hoop = (x, y, s = 1) => `<g transform="translate(${f1(x)} ${f1(y)}) scale(${s})">
      <line x1="20" y1="6" x2="20" y2="130" stroke="#8a8f98" stroke-width="3" stroke-linecap="round"/>
      <rect x="15" y="-26" width="6" height="40" rx="1.5" fill="#fbfbf8" stroke="#9aa0a8" stroke-width="1.2"/>
      <path d="M-12 1 L-9 19 M-5 3 L-3.5 20 M3 3 L1.5 20 M9 1 L6 19 M-10 10 H8" stroke="#cfd2d6" stroke-width="1" fill="none"/>
      <ellipse cx="-1" cy="0" rx="12" ry="3.4" fill="none" stroke="#d9572a" stroke-width="2.6"/></g>`;
  function fx(id, kind, x, y, rot = 0, s = 1) {
    const g = (inner) => `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)}) scale(${s})">${inner}</g>`;
    switch (kind) {
      case 'impact': return g(`<circle r="16" fill="url(#fl${id})"/><path d="M0 -15 L3 -5 L13 -8 L6 0 L14 7 L4 5 L0 15 L-3 5 L-13 8 L-6 0 L-14 -7 L-4 -5 Z" fill="#ffe27a" stroke="#f0a92b" stroke-width="1" stroke-linejoin="round"/>`);
      case 'speed': return g(`<path d="M0 -6 H-26 M2 0 H-34 M0 6 H-22" stroke="#9aa0a8" stroke-width="1.5" stroke-linecap="round" opacity=".8"/>`);
      case 'arc': return g(`<path d="M-20 10 Q0 -22 22 8" fill="none" stroke="#c4c9d1" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 5"/>`);
      case 'swoosh': return g(`<path d="M-18 14 Q-22 -10 4 -22" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity=".85"/><path d="M-18 14 Q-22 -10 4 -22" fill="none" stroke="#b8c7da" stroke-width="1.6" stroke-linecap="round"/>`);
      case 'sweat': return g(`<path d="M0 0 Q-3 5 0 7 Q3 5 0 0 Z" fill="#8fc3f0" stroke="#5a92c8" stroke-width=".6"/>`);
      case 'heart': return g(`<path d="M-5 -2 c0-3 4-4 5-1 c1-3 5-2 5 1 c0 3-5 6-5 6 s-5-3-5-6Z" fill="#ef6f7c"/>`);
      case 'sparkle': return g(`<path d="M0 -6 L1.6 -1.6 L6 0 L1.6 1.6 L0 6 L-1.6 1.6 L-6 0 L-1.6 -1.6 Z" fill="#ffd34d"/>`);
      case 'star': return g(`<path d="M0 -5 l1.6 3.6 3.9.4-2.9 2.6.8 3.8-3.4-2-3.4 2 .8-3.8-2.9-2.6 3.9-.4Z" fill="#ffcf3d" stroke="#d9a520" stroke-width=".6"/>`);
      case 'dust': return g(`<ellipse cx="-10" cy="0" rx="6" ry="3" fill="#d8cbb4" opacity=".7"/><ellipse cx="10" cy="0" rx="6" ry="3" fill="#d8cbb4" opacity=".7"/><ellipse cx="-17" cy="-2" rx="3" ry="2" fill="#e5dac6" opacity=".6"/><ellipse cx="17" cy="-2" rx="3" ry="2" fill="#e5dac6" opacity=".6"/>`);
      case 'zzz': return g(`<text x="0" y="0" font-family="Arial, sans-serif" font-weight="700" font-size="10" fill="#7c8696">Z</text><text x="8" y="-9" font-family="Arial, sans-serif" font-weight="700" font-size="12" fill="#7c8696">Z</text>`);
      case 'note': return g(`<path d="M0 0 V-10 L7 -12 V-2" fill="none" stroke="#6b7fb0" stroke-width="1.4"/><ellipse cx="-1.6" cy="0" rx="2.4" ry="1.8" fill="#6b7fb0"/><ellipse cx="5.4" cy="-2" rx="2.4" ry="1.8" fill="#6b7fb0"/>`);
      case 'shadow': return g(`<ellipse cx="0" cy="0" rx="24" ry="4.5" fill="#000" opacity=".12"/>`);
      default: return '';
    }
  }

  // ---- 主繪製 ---------------------------------------------------------------
  function render(th, id, pose = {}) {
    const T = makeT(pose), c = Math.cos(rad(th)), s = Math.sin(rad(th)), dx = pose.x || 0;
    const P = (p3) => { const q = I.proj(p3, th); return { X: q.X + dx, Y: q.Y, Z: q.Z }; };
    const PB = (p) => P(T.B(p)), PH = (p) => P(T.H(p));
    const thH = th + T.yaw, cH = Math.cos(rad(thH)), sH = Math.sin(rad(thH));
    // 身體與頭各自的橢圓
    const ell = (part, head) => {
      const [, x, y, z, rx, ry, rz] = part, q = head ? PH([x, y, z]) : PB([x, y, z]), cc = head ? cH : c, ss = head ? sH : s;
      return { cx: q.X, cy: q.Y, rx: Math.hypot(rx * cc, rz * ss) * T.k, ry: ry * (head ? 1 : T.sq) };
    };
    const parts = I.q3();
    const bodyE = parts.filter((p) => !HEAD.has(p[0])).map((p) => ell(p, false));
    const headE = parts.filter((p) => HEAD.has(p[0])).map((p) => ell(p, true));
    const bodyD = union(bodyE.concat(headE)), headD = bodyD;
    const facingH = (n) => I.facing(rotY(n, T.yaw, [0, 0, 0]), th);
    const out = { back: [], body: [], front: [], top: [] };

    // 尾巴
    const tk = I.tailK(), up = pose.tailUp || 0;
    const tq = [[158, -26, 6.5], [164, -40, 5.4], [168, -54, 4.4], [170.5, -68, 3.4], [171.5, -80, 2.4]]
      .map(([y, z, r], i) => ({ ...PB([0, y - up * i * i * 2.2, -26 + (z + 26) * tk]), r }));
    if (Math.abs(tq[0].X - tq[4].X) < 6) {
      if (c < 0) { const x = tq[0].X, y0 = tq[0].Y; out.front.push(`<path d="M${f1(x - 6)} ${f1(y0 - 2)} C${f1(x - 6.4)} ${f1(y0 + 10)} ${f1(x - 5)} ${f1(y0 + 19)} ${f1(x - 3.6)} ${f1(y0 + 23.5)} C${f1(x - 2.4)} ${f1(y0 + 27.6)} ${f1(x + 2.4)} ${f1(y0 + 27.6)} ${f1(x + 3.6)} ${f1(y0 + 23.5)} C${f1(x + 5)} ${f1(y0 + 19)} ${f1(x + 6.4)} ${f1(y0 + 10)} ${f1(x + 6)} ${f1(y0 - 2)} Z" fill="url(#tl${id})" filter="url(#fz${id})"/>`); }
    } else {
      const upL = tq.map((q) => [q.X, q.Y - q.r * .85]), dn = tq.map((q) => [q.X, q.Y + q.r * .85]).reverse();
      (PB([0, 165, -45]).Z > 0 ? out.front : out.back).push(`<path d="M${upL.concat(dn).map((p) => f1(p[0]) + ' ' + f1(p[1])).join(' L')} Z" fill="url(#tl${id})" stroke="url(#tl${id})" stroke-width="2" stroke-linejoin="round" filter="url(#fz${id})"/>`);
    }

    // 腳：站著時腳掌貼地、朝前；騰空時腳尖朝下
    const air = pose.feet === 'air' || (pose.feet !== 'stand' && (pose.y || 0) < -4);
    [-1, 1].forEach((k) => {
      const heel = PB(air ? [k * 17, 166, -4] : [k * 18, 172, -10]), toe = PB(air ? [k * 17, 182, 12] : [k * 18, 173, 30]);
      const vx = toe.X - heel.X, vy = toe.Y - heel.Y, L = Math.hypot(vx, vy);
      const d = L < 4 ? `<ellipse cx="${f1(heel.X)}" cy="${f1(heel.Y + 4)}" rx="10.5" ry="8.4" fill="${I.FOOT}"/>`
        : `<path d="M${f1(heel.X)} ${f1(heel.Y)} L${f1(toe.X)} ${f1(toe.Y)}" stroke="${I.FOOT}" stroke-width="10" stroke-linecap="round"/><ellipse cx="${f1(toe.X)}" cy="${f1(toe.Y)}" rx="6.6" ry="5.4" fill="${I.FOOT}"/>`;
      const ang = L < 4 ? 0 : Math.atan2(-vx, vy) * 180 / Math.PI;
      const ux = L < 4 ? 0 : vx / L, uy = L < 4 ? 1 : vy / L;
      const tipX = L < 4 ? heel.X : toe.X + ux * 4, tipY = L < 4 ? heel.Y + 11 : toe.Y + uy * 4;
      const claws = (toe.Z > -6 || air) ? [-3.4, 0, 3.4].map((o) => I.CLAW(f1(tipX - uy * o), f1(tipY + ux * o), f1(ang), 3)).join('') : '';
      (PB([k * 18, 172, 10]).Z < -2 ? out.back : out.body).push(`<g filter="url(#fz${id})">${d}</g>${claws}`);
    });

    // 身體（含明暗）
    const bF = I.facing([0, 0, 1], th), belly = PB([0, 142, 33]), backP = PB([0, 110, -30]), side = Math.sign(s) || 1;
    out.body.push(`<path d="${bodyD}" fill="none" stroke="#5e4632" stroke-width="2.2" opacity=".28" filter="url(#fz${id})"/><path d="${bodyD}" fill="url(#bg${id})" filter="url(#fz${id})"/>
      <g clip-path="url(#cb${id})">
        ${bF > -0.3 ? `<ellipse cx="${f1(belly.X)}" cy="${f1(belly.Y + 4)}" rx="${f1((14 + 24 * Math.max(0, bF)) * T.k)}" ry="${f1(28 * T.sq)}" fill="#f0dcb9" opacity="${(0.9 * Math.min(1, bF + .5)).toFixed(2)}" filter="url(#b3${id})"/>` : ''}
        ${bF < 0.3 ? `<ellipse cx="${f1(backP.X)}" cy="${f1(backP.Y + 2)}" rx="9" ry="50" fill="#68533e" opacity=".2" filter="url(#b3${id})"/>` : ''}
        <ellipse cx="${f1(PB([0, 112, 0]).X - 42 * side * Math.abs(s))}" cy="${f1(PB([0, 112, 0]).Y)}" rx="12" ry="70" fill="#76604a" opacity="${(0.32 * Math.abs(s)).toFixed(2)}" filter="url(#b3${id})"/>
        <path d="${bodyD}" fill="none" stroke="#fff6e6" stroke-width="3" opacity=".3" filter="url(#b1${id})"/>
        <g transform="translate(${f1(dx)} ${f1(pose.y || 0)})">${I.fur(700, 30, 130, 11)}</g>
      </g>`);

    // 耳朵（在頭後面）
    const ek = I.earK();
    const ears = [-1, 1].map((k) => {
      const q = PH([k * 22, 19, -12]), f = facingH([k * .3, 0, 1]), w = 9 * (0.5 + 0.5 * Math.abs(f)), base = PH([k * 18, 27, -10]);
      const inner = f > 0.15 ? `<ellipse cx="${f1(q.X)}" cy="${f1(q.Y + 1.6)}" rx="${f1(w * .62)}" ry="6.8" fill="#f2c38c"/><ellipse cx="${f1(q.X)}" cy="${f1(q.Y + 2.8)}" rx="${f1(w * .35)}" ry="4" fill="#8a7460"/>` : '';
      const tilt = Math.atan2(q.X - base.X, base.Y - q.Y) * 180 / Math.PI;
      return `<g filter="url(#fz${id})" transform="rotate(${f1(tilt * .6)} ${f1(base.X)} ${f1(base.Y)}) translate(${f1(q.X)} ${f1(q.Y + 8)}) scale(${ek}) translate(${f1(-q.X)} ${f1(-q.Y - 8)})"><ellipse cx="${f1(q.X)}" cy="${f1(q.Y)}" rx="${f1(w)}" ry="10.5" fill="${f > 0 ? '#b38a5e' : '#93744f'}"/>${inner}</g>`;
    }).join('');

    // 頭（獨立輪廓：可以轉、點、歪）
    const hc = PH([0, 22, -2]), muz = PH([0, 60, 29]), chin = PH([0, 68, 30]), hF = facingH([0, 0, 1]);
    const nk = PB([0, 76, 4]);
    const headSvg = `<g clip-path="url(#ch${id})">
        <ellipse cx="${f1(hc.X)}" cy="${f1(hc.Y - 2)}" rx="26" ry="9" fill="#7c6244" opacity=".4" filter="url(#b3${id})"/>
        ${hF > -0.2 ? `<ellipse cx="${f1(muz.X)}" cy="${f1(muz.Y + 2)}" rx="${f1(12 + 18 * Math.max(0, cH))}" ry="15" fill="#dfa65e" opacity=".85" filter="url(#b3${id})"/><ellipse cx="${f1(chin.X)}" cy="${f1(chin.Y)}" rx="${f1(7 + 7 * Math.max(0, cH))}" ry="6" fill="#f3e2c4" opacity=".85" filter="url(#b3${id})"/>` : ''}
      </g>`;

    // 頭帶
    const ring = [];
    for (let a = 0; a <= 360; a += 6) { const r = rad(a); ring.push(PH([27.6 * Math.sin(r), 30 - 2.4 * Math.cos(r), -2 + 22.4 * Math.cos(r)])); }
    const hz = PH([0, 30, -2]).Z;
    const vis = ring.filter((q) => q.Z > hz - 1.5);
    const band = vis.length > 1 ? `<path d="M${vis.map((q) => f1(q.X) + ' ' + f1(q.Y)).join(' L')}" fill="none" style="stroke: var(--band, #e5533d)" stroke-width="6.4" stroke-linejoin="round"/>` : '';
    const kn = PH([0, 31, -27.5]);
    const knot = kn.Z - hz > 0 ? `<g transform="translate(${f1(kn.X)} ${f1(kn.Y - 31)})"><path d="M-3 34 Q-6 43 -10 49 L-7 50 Q-3 44 0 35 Z M3 34 Q6 43 10 49 L7 50 Q3 44 0 35 Z" style="fill: var(--band, #e5533d)"/><ellipse cx="0" cy="33" rx="3" ry="2.8" style="fill: var(--band, #e5533d)"/></g>` : '';

    // 五官
    const face = [];
    const look = pose.look || [0, 0];
    for (const k of [-1, 1]) {
      const e = PH([k * 13, 43, 19]), f = facingH([k * .42, 0, .9]);
      if (f > 0.05) {
        const sx = (0.35 + 0.65 * f).toFixed(2), ex = e.X + look[0] * 1.4 * f, ey = e.Y + look[1];
        const g = (inner) => `<g transform="translate(${f1(e.X)} ${f1(e.Y)}) scale(${sx} 1) translate(${f1(-e.X)} ${f1(-e.Y)})">${inner}</g>`;
        const ln = (d) => g(`<path d="${d}" fill="none" stroke="#1f1814" stroke-width="1.8" stroke-linecap="round"/>`);
        switch (pose.eyes) {
          case 'happy': face.push(ln(`M${f1(e.X - 4.5)} ${f1(e.Y + 1.2)} Q${f1(e.X)} ${f1(e.Y - 3.8)} ${f1(e.X + 4.5)} ${f1(e.Y + 1.2)}`)); break;
          case 'closed': face.push(ln(`M${f1(e.X - 4.5)} ${f1(e.Y)} Q${f1(e.X)} ${f1(e.Y + 3)} ${f1(e.X + 4.5)} ${f1(e.Y)}`)); break;
          case 'dizzy': face.push(g(`<path d="M${f1(e.X)} ${f1(e.Y)} m-3.6 0 a3.6 3.6 0 1 1 3.6 3.6 a2.4 2.4 0 1 1 -2.4 -2.4" fill="none" stroke="#1f1814" stroke-width="1.2"/>`)); break;
          case 'wide': face.push(g(I.eye(ex, ey - .5, id, { scale: 1.2 }))); break;
          case 'focus': face.push(g(I.eye(ex, ey, id) + `<path d="M${f1(e.X - 5.2)} ${f1(e.Y - 3.2 - k * .9)} L${f1(e.X + 5.2)} ${f1(e.Y - 3.2 + k * .9)}" stroke="#5a4232" stroke-width="2.2" stroke-linecap="round"/>`)); break;
          default: face.push(g(I.eye(ex, ey, id)));
        }
      }
      const b = PH([k * 20, 57, 15]), fb = facingH([k * .6, 0, .8]);
      if (fb > 0.1) face.push(`<ellipse cx="${f1(b.X)}" cy="${f1(b.Y)}" rx="${f1(6.5 * fb)}" ry="4" fill="#f0907c" opacity="${(0.3 * (pose.blush == null ? 1 : pose.blush)).toFixed(2)}" filter="url(#b1${id})"/>`);
    }
    if (hF > -0.25) {
      const n = PH([0, 53, 36 + 3 * Math.abs(sH)]), w = 6.8 * (0.62 + 0.38 * Math.abs(cH));
      face.push(`<ellipse cx="${f1(n.X)}" cy="${f1(n.Y)}" rx="${f1(w)}" ry="5.8" fill="url(#ns${id})"/><ellipse cx="${f1(n.X - w * .35)}" cy="${f1(n.Y - 2.5)}" rx="${f1(w * .38)}" ry="1.2" fill="#d4dfec" opacity=".5"/>`);
      const mc = PH([0, 62.5, 32]), mf = Math.abs(cH) * .6 + .4;
      const mp = [[-9.5, 59, 25], [-4.6, 63.6, 30.5], [0, 61.4, 33], [4.6, 63.6, 30.5], [9.5, 59, 25]].map((p) => ({ q: PH(p), f: facingH([p[0] / 20, 0, 1]) })).filter((m) => m.f > -0.1);
      const smile = mp.length > 1 ? `<path d="M${f1(mp[0].q.X)} ${f1(mp[0].q.Y)} ${mp.slice(1).map((m, i) => { const a = mp[i].q, bq = m.q; return 'Q' + f1((a.X + bq.X) / 2) + ' ' + f1(Math.max(a.Y, bq.Y) + 1.2) + ' ' + f1(bq.X) + ' ' + f1(bq.Y); }).join(' ')}" fill="none" stroke="#2a211b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` : '';
      const philtrum = `<path d="M${f1(n.X)} ${f1(n.Y + 5.6)} V${f1(n.Y + 8.2)}" stroke="#2a211b" stroke-width="1.3"/>`;
      switch (pose.mouth) {
        case 'open': face.push(philtrum + `<path d="M${f1(mc.X - 8 * mf)} ${f1(mc.Y - 2)} Q${f1(mc.X)} ${f1(mc.Y + 1)} ${f1(mc.X + 8 * mf)} ${f1(mc.Y - 2)} Q${f1(mc.X + 6.5 * mf)} ${f1(mc.Y + 7)} ${f1(mc.X)} ${f1(mc.Y + 7.5)} Q${f1(mc.X - 6.5 * mf)} ${f1(mc.Y + 7)} ${f1(mc.X - 8 * mf)} ${f1(mc.Y - 2)} Z" fill="#4a2622" stroke="#2a211b" stroke-width="1.1"/><path d="M${f1(mc.X - 4 * mf)} ${f1(mc.Y + 4.8)} Q${f1(mc.X)} ${f1(mc.Y + 2.6)} ${f1(mc.X + 4 * mf)} ${f1(mc.Y + 4.8)} Q${f1(mc.X)} ${f1(mc.Y + 7.4)} ${f1(mc.X - 4 * mf)} ${f1(mc.Y + 4.8)} Z" fill="#e58a8a"/>`); break;
        case 'o': face.push(philtrum + `<ellipse cx="${f1(mc.X)}" cy="${f1(mc.Y + 2.5)}" rx="${f1(2.8 * mf)}" ry="3.4" fill="#4a2622" stroke="#2a211b" stroke-width="1"/>`); break;
        case 'flat': face.push(philtrum + `<path d="M${f1(mc.X - 5 * mf)} ${f1(mc.Y + 1)} Q${f1(mc.X)} ${f1(mc.Y + 2)} ${f1(mc.X + 5 * mf)} ${f1(mc.Y + 1)}" fill="none" stroke="#2a211b" stroke-width="1.5" stroke-linecap="round"/>`); break;
        case 'chew': face.push(philtrum + `<ellipse cx="${f1(mc.X)}" cy="${f1(mc.Y + 2)}" rx="${f1(3.4 * mf)}" ry="2.2" fill="#4a2622" stroke="#2a211b" stroke-width="1"/>`); break;
        default: face.push(smile + philtrum);
      }
    }

    // 手：肩膀固定在身上，手掌位置由 pose 指定（身體座標），手肘自動往外彎
    const hands = {};
    const armsSvg = { back: [], front: [] };
    [['L', -1], ['R', 1]].forEach(([key, k]) => {
      const spec = (pose.arms && pose.arms[key]) || null;
      const handL = spec ? spec.hand : [k * 6, 127, 30];
      // 手舉過肩：肩關節改用身體側面（手才會從頭旁邊舉上去，不會擋臉）；手越高越往側面移
      const lift = Math.max(0, Math.min(1, (100 - handL[1]) / 40));
      const shL = [k * (15 + 6 * lift), 103 - 4 * lift, 20 - 16 * lift];
      const elL = spec && spec.elbow ? spec.elbow : spec
        ? [(shL[0] + handL[0]) / 2 + k * 7, (shL[1] + handL[1]) / 2 + 3, (shL[2] + handL[2]) / 2 - 2]
        : [k * 17, 114, 25];
      const sh = PB(shL), el = PB(elL), wr = PB(handL);
      const vx = wr.X - el.X, vy = wr.Y - el.Y;
      const ang = spec && spec.paw != null ? spec.paw : Math.atan2(-vx, vy) * 180 / Math.PI;
      const behind = (sh.Z + wr.Z) / 2 < -3;
      if (!spec && I.facing([k * .5, 0, .85], th) < 0.3) { hands[key] = { X: wr.X, Y: wr.Y, Z: wr.Z, behind: true }; return; }
      const raised = spec && handL[1] < 100;
      const shoulder = raised ? `<ellipse cx="${f1(sh.X)}" cy="${f1(sh.Y - 2)}" rx="8" ry="9" fill="#a9845c" filter="url(#fz${id})"/>` : '';
      const svg = shoulder + I.arm(id, [[sh.X, sh.Y], [el.X, el.Y], [(el.X + wr.X) / 2, (el.Y + wr.Y) / 2], [wr.X, wr.Y]], f1(ang), { thumb: k, side: k, fadeTo: raised ? .06 : spec ? .2 : .38, w1: spec ? 11.5 : 10, w2: raised ? 7.6 : 7 });
      (behind ? armsSvg.back : armsSvg.front).push(svg);
      hands[key] = { X: wr.X, Y: wr.Y + 6, Z: wr.Z, behind, ang };
    });

    // 道具與特效
    const props = { back: [], front: [] };
    (pose.props || []).forEach((p) => {
      let svg = '';
      if (p.t === 'racket') { const h = hands[p.hand || 'R']; if (h) { svg = racket(id, h.X, h.Y, p.ang || 0, p.len || 1, p.hit, p.swoosh); (h.behind ? props.back : props.front).push(svg); } return; }
      const [x, y] = p.at || [0, 0];
      if (p.t === 'shuttle') svg = shuttle(x, y, p.rot, p.s);
      else if (p.t === 'vball') svg = vball(id, x, y, p.rot, p.s);
      else if (p.t === 'bball') svg = bball(id, x, y, p.rot, p.s);
      else if (p.t === 'leaf') svg = leaf(id, x, y, p.rot, p.s);
      else if (p.t === 'hoop') svg = hoop(x, y, p.s);
      else if (p.t === 'fx') svg = fx(id, p.kind, x, y, p.rot, p.s);
      (p.behind ? props.back : props.front).push(svg);
    });

    const defs = I.DEFS(id).replace(/<linearGradient id="bg[^>]*>/, `<linearGradient id="bg${id}" gradientUnits="userSpaceOnUse" x1="0" y1="14" x2="0" y2="176">`)
      .replace('</defs>', `${PROP_DEFS(id)}<clipPath id="cb${id}"><path d="${bodyD}"/></clipPath><clipPath id="ch${id}"><path d="${headD}"/></clipPath></defs>`);
    const shadow = `<ellipse cx="${f1(80 + dx)}" cy="183" rx="${f1(30 - Math.min(16, -(pose.y || 0) * .4))}" ry="4" fill="#000" opacity="${f1(Math.max(.04, .12 + (pose.y || 0) * .002))}"/>`;
    const svg = `${defs}${shadow}${props.back.join('')}${out.back.join('')}${armsSvg.back.join('')}${out.body.join('')}${out.front.join('')}${ears}${headSvg}${band}${knot}${face.join('')}${armsSvg.front.join('')}${props.front.join('')}`;
    return { svg: I.paint(svg), hands };
  }
  // 包成完整 SVG（單隻）
  function svg(th, id, pose, vb = '0 0 160 196') {
    return `<svg viewBox="${vb}" class="view-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="overflow:visible">${render(th, id, pose).svg}</svg>`;
  }

  const api = { render, svg };
  if (typeof window !== 'undefined') window.QuokkaPose = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
