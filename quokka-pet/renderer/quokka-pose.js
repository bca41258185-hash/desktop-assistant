// 可擺姿勢的 3D 庫卡：pose 物件 → 任意角度的 SVG。
// 動作與多隻互動都用「關鍵姿勢 + 內插」驅動，所以身體可以蹲、跳、前傾，頭可以轉、點、歪，
// 雙手在 3D 空間定位（會自動決定在身體前或後），道具與特效跟著手或場景走。
//
// 座標同 quokka-art.js：x 右、y 下、z 朝前（口鼻方向）；θ＝整隻轉向角（0 正面、90 面向右）。
// pose 欄位（都可省略）：
//   x, y        畫面位移（y 負＝跳起）。位移用外層 <g transform> 做，身體本身的毛邊雜訊不會跟著「沸騰」
//   sq          壓扁／拉長（<1 蹲壓、>1 伸展），以腳底為基準，體積大致守恆
//   lean, roll  身體前傾（正＝往口鼻方向）、側傾（正＝頭往右）；以腳底為支點。
//               前傾超過 25° 的部分只彎上半身（胸、頸、頭，以腰為支點），臀和後腳留在地上 → 四腳著地
//   head        { yaw 左右轉, pitch 點頭（正＝低頭）, roll 歪頭 }
//   headScale   頭的放大倍率（小袋鼠用；口鼻不會跟著拉長）。省略時亞成體個體自動 1.12
//   arms        { L: {hand:[x,y,z], elbow?:[x,y,z], paw?:角度}, R: … }；省略＝合在胸前。
//               hand 是身體座標（跟著身體傾斜）；會自動限制在地面以上，手伸向觀者時改畫掌心肉墊
//   eyes        open | happy | closed | wide | focus | dizzy | sad | sleepy | wink（右眼眨） ；look:[dx,dy] 眼珠方向
//   blink       0–1 眨眼程度（0 全開、1 閉上）；只影響睜著的眼型（open／wide／focus／sad／sleepy）
//   earFlop     { L, R } 每隻耳朵繞耳根多轉的角度（度；正＝往外倒）。抖耳朵、跑步時耳朵後甩用
//               照原值旋轉（×1.0，不打折、不隨轉向衰減），支點在耳根；桌面大小約 10–15° 就看得出來
//   noseTwitch  −1…1 鼻子抽動（「聞一聞」用）：正＝鼻子往上抬約 0.8 單位並放大 6%，負＝往下並縮小 6%
//   mouth       smile | open | o | flat | chew
//   blush       腮紅濃度 0–1.5
//   feet        auto | stand | air（騰空時腳尖朝下）；tailUp 尾巴上揚 0–1（負值＝尾巴往下壓：身體抬高時尾端仍拖在地上）
//   footShift   [dz, up, toe] 後腳掌相對身體的位移（步態用，站姿腳掌才有效）：dz 往前（口鼻方向）、up 抬高、toe 腳尖下垂量。
//               慢走時後腳離地往前擺、著地後留在原地讓身體先走，靠這個才不會滑步
//   accessory   飾品：'straw' 或 {type,color} 或陣列；省略＝用目前套用的個體特徵（traits.accessory，舊資料＝頭帶）；'none'＝不戴
//   props       [{t:'racket', hand:'R', ang, len}, {t:'shuttle'|'vball'|'bball'|'leaf', at:[X,Y], rot, s}, {t:'hoop', at, s, flip}, {t:'fx', kind, at, rot, s}]
//               道具可加 hand:'L'|'R'|'both'（黏在手上）、off:[dx,dy]、behind:true（畫在身體後面）、
//               layer:'back'|'between'|'front'（between＝遠側手之後、近側手之前；hand:'both' 的球預設就是 between）
//               拿在手上的球拍會畫在那隻手的下面（手掌握在握把上）
//   detail      'high'＝大圖才需要的細節（前爪爪尖、腳趾爪）；預設（桌面約 170px 高）不畫，太小只會變雜點
//   raw         true＝不做個體毛色換色（給 quokka-art.js 的靜態方位圖用，它自己會換色）
//
// render(th, id, pose) 回傳 { svg, hands, layers }：
//   svg     完整一隻（＝ layers.defs + shadow + back + body + front）
//   hands   { L, R }：手掌的畫面座標 { X, Y, Z, behind, ang, palm:[X,Y] }（已含 pose.x／y）
//   layers  { defs, shadow, back, body, front }：分層字串，讓舞台把兩隻貼在一起時能交錯疊放
//           （例如 A.back → B.back → A.body → B.body → A.front → B.front；每隻的 defs 都要放進去一次）。
//           back＝尾巴、後側的手腳、被身體擋住的飾品與道具；body＝身體、耳朵、頭、五官、飾品；
//           front＝前側的手、拿在手上或臉前的道具與特效

(function () {
  const A = (typeof window !== 'undefined' && window.QuokkaArt) ? window.QuokkaArt : require('./quokka-art.js');
  const I = A.internals;
  // 飾品模組（頭帶、帽子、眼鏡、圍巾…）；沒載入時就不畫飾品
  const ACC = () => (typeof window !== 'undefined' && window.QuokkaAcc) ? window.QuokkaAcc
    : (typeof require === 'function' ? require('./quokka-acc.js') : null);
  const rad = (a) => a * Math.PI / 180, f1 = (v) => (+v).toFixed(1);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const HEAD = new Set(['head', 'cheekL', 'cheekR', 'snout', 'snoutTip', 'jaw']);
  const FEET_Y = 176, NECK = [0, 80, 0], WAIST = [0, 136, -8], LEAN_ALL = 25;

  // ---- 3D 變換 -------------------------------------------------------------
  function rotX(p, a, c) { const s = Math.sin(rad(a)), co = Math.cos(rad(a)), y = p[1] - c[1], z = p[2] - c[2]; return [p[0], c[1] + y * co + z * s, c[2] + z * co - y * s]; }
  function rotZ(p, a, c) { const s = Math.sin(rad(a)), co = Math.cos(rad(a)), x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * co - y * s, c[1] + y * co + x * s, p[2]]; }
  function rotY(p, a, c) { const s = Math.sin(rad(a)), co = Math.cos(rad(a)), x = p[0] - c[0], z = p[2] - c[2]; return [c[0] + x * co + z * s, p[1], c[2] - x * s + z * co]; }
  function makeT(pose, hs) {
    const sq = pose.sq || 1, k = 1 / Math.sqrt(sq), h = pose.head || {}, FEET = [0, FEET_Y, 0];
    // 前傾：25° 以內整隻以腳底為支點；超過的部分只彎上半身（以腰為支點，越往上彎越多）
    const lean = pose.lean || 0, l1 = clamp(lean, -LEAN_ALL, LEAN_ALL), l2 = lean - l1;
    const S = (p) => [p[0] * k, FEET_Y + (p[1] - FEET_Y) * sq, p[2] * k];
    const piv = rotX(S(WAIST), l1, FEET);
    const wUp = (y) => { const t = clamp((146 - y) / 36, 0, 1); return t * t * (3 - 2 * t); };
    const B = (p, wForce) => {
      let q = S(p);
      if (l1) q = rotX(q, l1, FEET);
      if (l2) { const w = wForce == null ? wUp(p[1]) : wForce; if (w) q = rotX(q, l2 * w, piv); }
      if (pose.roll) q = rotZ(q, pose.roll, FEET);
      return q;
    };
    // 腳掌與尾巴用：只壓扁，不跟著身體前傾／側傾（前傾時後腳仍貼地、尾巴仍沿地面往後）
    const F = (p) => [p[0] * k, FEET_Y + (p[1] - FEET_Y) * sq, p[2] * k];
    const H = (p) => {
      // 頭放大時口鼻（z>14 的部分）不跟著拉長
      let q = hs === 1 ? p : [NECK[0] + (p[0] - NECK[0]) * hs, NECK[1] + (p[1] - NECK[1]) * hs, NECK[2] + (Math.min(p[2], 14) - NECK[2]) * hs + Math.max(0, p[2] - 14)];
      if (h.roll) q = rotZ(q, h.roll, NECK);
      if (h.pitch) q = rotX(q, h.pitch, NECK);          // 正＝低頭（口鼻往下）
      if (h.yaw) q = rotY(q, h.yaw, NECK);
      return B(q, 1);
    };
    return { B, H, F, sq, k, yaw: h.yaw || 0, hs, lean, leanAt: (y) => l1 + l2 * wUp(y), pitch: (h.pitch || 0) + lean };
  }

  // ---- 手臂：固定長度的上臂＋前臂（兩段骨架反向運動學），手肘自然往外下方彎；目標太遠就伸直（最多拉長 12%）
  const UPPER = 18, FORE = 20;
  const v3 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len: (a) => Math.hypot(a[0], a[1], a[2]) };
  function ik(S, T, hint) {
    let d = v3.sub(T, S), dist = v3.len(d);
    const st = clamp(dist / (UPPER + FORE - 0.8), 1, 1.12), U = UPPER * st, Fo = FORE * st;
    const max = U + Fo - 0.8, min = Math.abs(Fo - U) + 4;
    if (dist < 1e-3) { d = [0, 1, 0]; dist = 1; }
    const dir = v3.mul(d, 1 / dist), D = Math.max(min, Math.min(max, dist));
    const hand = v3.add(S, v3.mul(dir, D));
    const a = (U * U - Fo * Fo + D * D) / (2 * D), h = Math.sqrt(Math.max(0, U * U - a * a));
    let perp = v3.sub(hint, v3.mul(dir, v3.dot(hint, dir)));
    const pl = v3.len(perp); perp = pl < 1e-3 ? [0, 1, 0] : v3.mul(perp, 1 / pl);
    return { elbow: v3.add(v3.add(S, v3.mul(dir, a)), v3.mul(perp, h)), hand };
  }

  // ---- 輪廓：逐列取橢圓聯集、平滑；回傳路徑與幾撮沿輪廓往外下方翹的短毛 ----------------
  function union(E, noTuft) {
    let y0 = Infinity, y1 = -Infinity;
    E.forEach((e) => { y0 = Math.min(y0, e.cy - e.ry); y1 = Math.max(y1, e.cy + e.ry); });
    const rows = [];
    for (let y = Math.ceil(y0); y <= Math.floor(y1); y += 1) {
      let L = Infinity, R = -Infinity;
      for (const e of E) { const d = (y - e.cy) / e.ry; if (Math.abs(d) < 1) { const w = e.rx * Math.sqrt(1 - d * d); L = Math.min(L, e.cx - w); R = Math.max(R, e.cx + w); } }
      if (R > L) rows.push([y, L, R]);
    }
    if (rows.length < 3) return { d: '', tufts: '' };
    const sm = (k) => rows.map((r0, i) => { let w = 0, v = 0; for (let j = -6; j <= 6; j++) { const q = rows[i + j]; if (!q) continue; const ww = Math.exp(-(j * j) / 14); w += ww; v += q[k] * ww; } return v / w; });
    const Ls = sm(1), Rs = sm(2), pts = [];
    const top = rows[0][0], bot = rows[rows.length - 1][0];
    pts.push([(Ls[0] + Rs[0]) / 2, top - 1]);
    for (let i = 0; i < rows.length; i += 3) pts.push([Rs[i], rows[i][0]]);
    pts.push([Rs[rows.length - 1], bot]); pts.push([(Ls[rows.length - 1] + Rs[rows.length - 1]) / 2, bot + 1]);
    pts.push([Ls[rows.length - 1], bot]);
    for (let i = rows.length - 1; i >= 0; i -= 3) pts.push([Ls[i], rows[i][0]]);
    // 短毛：位置由「離地高度」決定（不是點的序號），姿勢連續變化時不會亂跳
    let tufts = '';
    const n = pts.length;
    for (let i = 2; i < n - 2; i++) {
      const p = pts[i], hsh = Math.abs(Math.sin((Math.round(p[1] / 3) * 12.9898 + (p[0] > (Ls[0] + Rs[0]) / 2 ? 7.1 : 3.3)) * 43758.5453)) % 1;
      if (hsh > .3 || p[1] > bot - 10 || (noTuft && noTuft(p))) continue;
      const a = pts[i - 1], b = pts[i + 1];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const nx = ty, ny = -tx, len = 2 + hsh * 6;        // 點順時針排列 → 外側法向量
      tufts += ` M${f1(p[0] - tx * 1.9)} ${f1(p[1] - ty * 1.9)} L${f1(p[0] + nx * len + tx * .6)} ${f1(p[1] + ny * len + 1.4)} L${f1(p[0] + tx * 1.9)} ${f1(p[1] + ty * 1.9)} Z`;
    }
    return { d: I.cr(pts), tufts };
  }
  // 沿中心線的粗細漸變圓管（尾巴、腳掌用）：pts＝[{X,Y,r}]，回傳平滑封閉路徑
  function tubePath(pts) {
    const n = pts.length, L = [], R = [];
    let px = 1, py = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b.X - a.X, ty = b.Y - a.Y; const l = Math.hypot(tx, ty);
      if (l < 1e-3) { tx = px; ty = py; } else { tx /= l; ty /= l; px = tx; py = ty; }
      L.push([pts[i].X - ty * pts[i].r, pts[i].Y + tx * pts[i].r]); R.push([pts[i].X + ty * pts[i].r, pts[i].Y - tx * pts[i].r]);
      pts[i].tx = tx; pts[i].ty = ty;
    }
    const e = pts[n - 1], s = pts[0];
    return I.cr([[s.X - s.tx * s.r, s.Y - s.ty * s.r], ...L, [e.X + e.tx * e.r, e.Y + e.ty * e.r], ...R.reverse()]);
  }

  // ---- 道具與特效（畫面座標） ----------------------------------------------
  const PROP_DEFS = (id) => `
    <radialGradient id="vb${id}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#efece4"/><stop offset="1" stop-color="#c9c3b5"/></radialGradient>
    <radialGradient id="bb${id}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#f8b276"/><stop offset=".6" stop-color="#e3813a"/><stop offset="1" stop-color="#b05a22"/></radialGradient>
    <linearGradient id="lf${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8cc06b"/><stop offset="1" stop-color="#4d8a3a"/></linearGradient>
    <linearGradient id="lg${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c3d6a8"/><stop offset=".45" stop-color="#8fb277"/><stop offset="1" stop-color="#5a8650"/></linearGradient>
    <radialGradient id="fg${id}" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#f0c9e6"/><stop offset=".55" stop-color="#cf93c3"/><stop offset="1" stop-color="#9c5c92"/></radialGradient>
    <linearGradient id="sg${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a08a6c"/><stop offset="1" stop-color="#6e5a44"/></linearGradient>
    <filter id="lz${id}" x="-20%" y="-60%" width="140%" height="220%"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="1.1" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="lb${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation=".7"/></filter>
    <filter id="lc${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.6"/></filter>
    <linearGradient id="tg${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9d884"/><stop offset=".5" stop-color="#82b256"/><stop offset="1" stop-color="#4f8438"/></linearGradient>
    <linearGradient id="rf${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fb0d8"/><stop offset=".5" stop-color="#4d82b5"/><stop offset="1" stop-color="#35618f"/></linearGradient>
    <linearGradient id="gr${id}" gradientUnits="userSpaceOnUse" x1="-2" y1="0" x2="2" y2="0"><stop offset="0" stop-color="#f6efe0"/><stop offset=".55" stop-color="#ddd2bb"/><stop offset="1" stop-color="#b3a58a"/></linearGradient>
    <linearGradient id="sh${id}" gradientUnits="userSpaceOnUse" x1="-1.2" y1="0" x2="1.2" y2="0"><stop offset="0" stop-color="#e2ddd2"/><stop offset="1" stop-color="#9a9084"/></linearGradient>
    <radialGradient id="ck${id}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#fff8ea"/><stop offset=".7" stop-color="#e8d6b4"/><stop offset="1" stop-color="#c8b08a"/></radialGradient>
    <linearGradient id="fe${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#f3ecdf"/><stop offset="1" stop-color="#d8cdb9"/></linearGradient>
    <linearGradient id="po${id}" gradientUnits="userSpaceOnUse" x1="21" y1="0" x2="25.4" y2="0"><stop offset="0" stop-color="#ddd5c6"/><stop offset=".45" stop-color="#b3a999"/><stop offset="1" stop-color="#857b6d"/></linearGradient>
    <filter id="pw${id}" x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency=".3" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="1.5" xChannelSelector="R" yChannelSelector="G"/></filter>
    <linearGradient id="rm${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f08a4e"/><stop offset="1" stop-color="#c4522a"/></linearGradient>
    <linearGradient id="bd${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#e6dccb"/></linearGradient>
    <radialGradient id="fl${id}"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".5" stop-color="#fff6c8" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`;
  // ---- 道具：畫風與庫卡一致（漸層、柔邊、模糊亮面與陰影，不用黑色硬邊）----
  const soft = (id, d, dx = .8, dy = 1.2, op = .18) => `<path d="${d}" fill="#4a3a2e" opacity="${op}" transform="translate(${dx} ${dy})" filter="url(#lb${id})"/>`;
  // 球拍：握把在原點（手掌握在 y≈0），拍面朝 -y。預設比舊版大 1.5 倍；握把與拍桿的漸層用 userSpaceOnUse
  //（垂直線的外框寬度是 0，objectBoundingBox 漸層會整條不畫）
  // OL＝道具共用的描邊色（和庫卡毛色同一系的暖棕，半透明、圓角）；pw 濾鏡讓線條輕微抖動，像手繪而不是向量線
  const OL = '#6b4f3a';
  function racket(id, hx, hy, ang, len = 1, hit = false, swoosh = false) {
    // ang：拍子方向（0＝朝上，順時針為正）；握把從手掌往外
    return `<g transform="translate(${f1(hx)} ${f1(hy)}) rotate(${f1(ang)}) scale(${(len * 1.5).toFixed(2)})">
      <path d="M0 4.5 L0 -14" stroke="#4a3a2e" stroke-width="3.2" stroke-linecap="round" opacity=".16" transform="translate(.8 1)" filter="url(#lb${id})"/>
      <ellipse cx="0" cy="-27" rx="9" ry="11.5" fill="none" stroke="#4a3a2e" stroke-width="2.6" opacity=".15" transform="translate(.8 1)" filter="url(#lb${id})"/>
      <g filter="url(#pw${id})">
      <path d="M0 -3 L0 -14.5 M0 -14.5 L-2.6 -17.5 M0 -14.5 L2.6 -17.5" stroke="${OL}" stroke-width="2.9" stroke-linecap="round" opacity=".6" fill="none"/>
      <path d="M0 -3 L0 -14.5" stroke="url(#sh${id})" stroke-width="1.9" stroke-linecap="round"/>
      <path d="M0 5 L0 -4.5" stroke="${OL}" stroke-width="4.7" stroke-linecap="round" opacity=".6"/>
      <path d="M0 5 L0 -4.5" stroke="url(#gr${id})" stroke-width="3.6" stroke-linecap="round"/>
      <path d="M-1.7 2.6 L1.7 1.5 M-1.7 .2 L1.7 -.9 M-1.7 -2.2 L1.7 -3.3" stroke="#9a8666" stroke-width=".55" opacity=".8"/>
      <path d="M-1.8 5 H1.8" stroke="#8a7458" stroke-width="1.2" stroke-linecap="round"/>
      <ellipse cx="0" cy="-27" rx="9" ry="11.5" fill="#fff8ea" fill-opacity=".4"/>
      <path d="M-5 -36 V-18 M0 -38.5 V-15.5 M5 -36 V-18 M-8 -32 H8 M-8.8 -27 H8.8 M-8 -22 H8" stroke="#a8946f" stroke-width=".5" fill="none" opacity=".75"/>
      <ellipse cx="0" cy="-27" rx="9" ry="11.5" fill="none" stroke="${OL}" stroke-width="3.5" opacity=".6"/>
      <path d="M0 -14.5 L-2.6 -17.5 M0 -14.5 L2.6 -17.5" stroke="url(#rf${id})" stroke-width="1.6" stroke-linecap="round"/>
      <ellipse cx="0" cy="-27" rx="9" ry="11.5" fill="none" stroke="url(#rf${id})" stroke-width="2.4"/>
      </g>
      <path d="M-6 -34 Q-7.5 -29 -6.6 -23" fill="none" stroke="#e4f0fa" stroke-width="1" stroke-linecap="round" opacity=".75" filter="url(#lb${id})"/>
      ${swoosh ? `<path d="M14 -6 Q20 -30 2 -44" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".75" filter="url(#lb${id})"/><path d="M14 -6 Q20 -30 2 -44" fill="none" stroke="#c9d6e4" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>` : ''}
      ${hit ? fx(id, 'impact', 0, -27, 0, .8) : ''}
    </g>`;
  }
  // 羽球：球頭朝 +x、羽毛裙朝 −x。淺色背景上要看得到 → 暖棕描邊、羽毛一片片的輪廓、裙邊扇貝形、藍色束帶＋紅色球頭邊
  const FEATHER = 'M-2 -1.9 L-13.4 -7.9 Q-14.6 -6.6 -14 -5.2 Q-15.4 -3.9 -14.6 -2.6 Q-15.8 -1.3 -14.9 0 Q-15.8 1.3 -14.6 2.6 Q-15.4 3.9 -14 5.2 Q-14.6 6.6 -13.4 7.9 L-2 1.9 Z';
  const shuttle = (id, x, y, rot = 0, s = 1) => `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)}) scale(${s})">
      ${soft(id, FEATHER, .8, 1.2, .22)}
      <path d="${FEATHER}" fill="url(#fe${id})" stroke="${OL}" stroke-width="1.15" stroke-linejoin="round" stroke-opacity=".8"/>
      <path d="M-2.6 -.9 L-14 -5.2 M-2.6 -.3 L-14.6 -2.6 M-2.6 0 L-14.9 0 M-2.6 .3 L-14.6 2.6 M-2.6 .9 L-14 5.2" stroke="#8a7460" stroke-width=".55" stroke-linecap="round" opacity=".7"/>
      <path d="M-6.4 -4 Q-7.3 0 -6.4 4" fill="none" stroke="#4d82b5" stroke-width="1.5" stroke-linecap="round" opacity=".95"/>
      <path d="M-9.4 -5.4 Q-10.5 0 -9.4 5.4" fill="none" stroke="#8a7460" stroke-width=".5" opacity=".6"/>
      <circle cx=".6" cy=".8" r="3.6" fill="#4a3a2e" opacity=".18" filter="url(#lb${id})"/>
      <circle cx="0" cy="0" r="3.5" fill="url(#ck${id})" stroke="${OL}" stroke-width="1" stroke-opacity=".8"/>
      <path d="M-2.4 -2.5 Q-3.5 0 -2.4 2.5" fill="none" stroke="#d6584a" stroke-width="1.6" stroke-linecap="round"/>
      <ellipse cx=".9" cy="-1.3" rx="1.2" ry=".8" fill="#fff" opacity=".8" filter="url(#lb${id})"/></g>`;
  const ballShade = (id) => `<circle cx="1.6" cy="2.2" r="12" fill="#4a3a2e" opacity=".16" filter="url(#lb${id})"/>`;
  const ballHi = (id) => `<ellipse cx="-4.2" cy="-5" rx="3.6" ry="2.4" fill="#fff" opacity=".55" transform="rotate(-30 -4.2 -5)" filter="url(#lb${id})"/><path d="M-12 0 A12 12 0 0 0 12 0" fill="none" stroke="#4a3a2e" stroke-width="3" opacity=".08" filter="url(#lb${id})"/>`;
  const vball = (id, x, y, rot = 0, s = 1) => `<g transform="translate(${f1(x)} ${f1(y)}) scale(${s})">${ballShade(id)}<g transform="rotate(${f1(rot)})">
      <circle r="12" fill="url(#vb${id})"/>
      <path d="M-12 0 Q0 -6.3 12 0 M-7.6 -9.2 Q2.5 -2.5 3.3 11.5 M7.6 -9.2 Q5.3 2.3 -6.6 9.9" fill="none" stroke="#6a93cc" stroke-width="2" stroke-linecap="round" opacity=".85"/>
      <path d="M-10.1 6 Q-1.3 7.6 5.7 10.5" fill="none" stroke="#e8c463" stroke-width="2" stroke-linecap="round" opacity=".9"/></g>${ballHi(id)}</g>`;
  const bball = (id, x, y, rot = 0, s = 1) => `<g transform="translate(${f1(x)} ${f1(y)}) scale(${s})">${ballShade(id)}<g transform="rotate(${f1(rot)})">
      <circle r="12" fill="url(#bb${id})"/>
      <path d="M-12 0 H12 M0 -12 V12 M-8.6 -8.3 Q-2 0 -8.6 8.3 M8.6 -8.3 Q2 0 8.6 8.3" fill="none" stroke="#7a3f1c" stroke-width="1.1" stroke-linecap="round" opacity=".7"/></g>${ballHi(id)}</g>`;
  // 大片葉子：西澳大陸森林族群最偏好的 Thomasia（以 T. macrocarpa 為參考）
  // 特徵：葉片 3–12 × 1.5–7 cm、心形到卵形、邊緣細鋸齒、密生星狀毛（年輕葉絨絨的）
  const bigLeaf = (id, x, y, rot = 0, s = 1) => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {           // 葉緣：卵形＋心形基部，加上細鋸齒
      const t = i / 40 * Math.PI * 2, w = Math.sin(t), h = Math.cos(t);
      const L = 30, W = 12 * (1 - .25 * h);       // 葉長（沿 -x 方向）與半寬，基部較寬
      let px = -L / 2 * (1 - h), py = W * w * (0.55 + 0.45 * Math.sin((1 - h) / 2 * Math.PI));
      if (i % 2 === 1 && Math.abs(w) > .2) { px += .5; py *= 1.05; }
      pts.push([px, py]);
    }
    const d = I.cr(pts);
    const vein = 'M0 0 Q-15 -.8 -29 0';
    const side = [-6, -11, -16, -21].map((vx) => `M${vx} ${(-vx * .02).toFixed(1)} Q${vx - 3} -4 ${vx - 5} -7.5 M${vx} ${(-vx * .02).toFixed(1)} Q${vx - 3} 4 ${vx - 5} 7.5`).join(' ');
    return `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)}) scale(${s})">
      ${soft(id, d, 1, 1.6, .2)}
      <path d="M2 .4 L0 0" stroke="url(#sg${id})" stroke-width="1.6" stroke-linecap="round"/>
      <path d="${d}" fill="url(#tg${id})" stroke="#3f6a30" stroke-width="1.1" stroke-linejoin="round" stroke-opacity=".6" filter="url(#lz${id})"/>
      <path d="${vein}" fill="none" stroke="#dcebbd" stroke-width="1" stroke-linecap="round" opacity=".9"/>
      <path d="${side}" fill="none" stroke="#dcebbd" stroke-width=".6" stroke-linecap="round" opacity=".7"/>
      <ellipse cx="-11" cy="-4.5" rx="8" ry="3" fill="#eef5e2" opacity=".35" filter="url(#lb${id})"/>
    </g>`;
  };
  // 籃框：原點在籃框中心偏右一點（與舊版相同的錨點）；框比舊版大（rx 17），籃板畫成 3/4 視角的平行四邊形，
  // 柱子用純色＋高光（垂直線不能用 objectBoundingBox 漸層）。
  // 幾何（乘上 s）：框 x −20…14、y 0；籃板正面 x 15…25、y −34…12；柱子 x 23、往下到 y 132
  // flip＝水平鏡射（框在右、籃板在左），x 座標全部變號；大小仍由數字 s 決定
  const hoop = (id, x, y, s = 1, flip = false) => `<g transform="translate(${f1(x)} ${f1(y)}) scale(${flip ? -s : s} ${s})">
      <path d="M24 10 L24 133" stroke="#4a3a2e" stroke-width="5" opacity=".14" stroke-linecap="round" filter="url(#lb${id})"/>
      <path d="M21.3 9 Q20.9 40 21.4 70 Q21.1 104 21.3 131.6 Q23.2 132.8 25 131.6 Q25.3 100 24.9 68 Q25.2 38 24.9 9 Q23.1 7.6 21.3 9 Z" fill="url(#po${id})" stroke="${OL}" stroke-width="1" stroke-linejoin="round" stroke-opacity=".65"/>
      <path d="M22.2 11 Q21.9 60 22.2 129" fill="none" stroke="#f6f0e2" stroke-width=".9" stroke-linecap="round" opacity=".7"/>
      <ellipse cx="23" cy="133" rx="9" ry="2.2" fill="#4a3a2e" opacity=".14" filter="url(#lb${id})"/>
      <path d="M15 -29 L25 -36 L25 9 L15 15 Z" fill="#4a3a2e" opacity=".16" transform="translate(1 1.4)" filter="url(#lb${id})"/>
      <ellipse cx="-3" cy="1.2" rx="17" ry="4.6" fill="none" stroke="#4a3a2e" stroke-width="3.2" opacity=".14" filter="url(#lb${id})"/>
      <g filter="url(#pw${id})">
      <path d="M23 4 L17 2" stroke="${OL}" stroke-width="3.4" stroke-linecap="round" opacity=".6"/>
      <path d="M23 4 L17 2" stroke="#a39989" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M15 -29 L25 -36 L25 9 L15 15 Z" fill="url(#bd${id})" stroke="${OL}" stroke-width="1.3" stroke-linejoin="round" stroke-opacity=".65"/>
      <path d="M17.6 -12 L22.6 -15.4 L22.6 -1.6 L17.6 1.6 Z" fill="none" stroke="#dd7a52" stroke-width="1.2" stroke-linejoin="round" opacity=".95"/>
      <path d="M-19 1 L-13 22 M-10 3.6 L-7 23.5 M-1 4 L-1.5 24 M8 3.2 L4 23.5 M14 1 L9 22 M-16.4 10 Q-3 14 11.6 10 M-14.4 17 Q-3 20.4 10 17 M-13 22 Q-3 25.6 9 22" stroke="#8a7460" stroke-width="2" fill="none" opacity=".5" stroke-linecap="round"/>
      <path d="M-19 1 L-13 22 M-10 3.6 L-7 23.5 M-1 4 L-1.5 24 M8 3.2 L4 23.5 M14 1 L9 22 M-16.4 10 Q-3 14 11.6 10 M-14.4 17 Q-3 20.4 10 17 M-13 22 Q-3 25.6 9 22" stroke="#fffaf0" stroke-width="1.15" fill="none" stroke-linecap="round"/>
      <ellipse cx="-3" cy="0" rx="17" ry="4.6" fill="none" stroke="${OL}" stroke-width="4.3" opacity=".6"/>
      <ellipse cx="-3" cy="0" rx="17" ry="4.6" fill="none" stroke="url(#rm${id})" stroke-width="3"/>
      </g>
      <path d="M-18 -2.2 Q-10 -5 0 -4.9" fill="none" stroke="#ffd9bd" stroke-width="1" stroke-linecap="round" opacity=".8" filter="url(#lb${id})"/></g>`;
  // 葉子：短尾矮袋鼠在羅特尼斯島最偏好的食物 Guichenotia ledifolia（錦葵科）
  // 特徵：葉片細長（約 1.5–6 cm × 2–5 mm）、邊緣反捲、兩面密生白色星狀毛 → 銀灰綠；花為下垂的粉紫色鐘形小花（7–11 月）
  // 畫法：一小段枝條，上面幾片細長銀灰葉（淺色中線表現反捲的邊），枝頭一朵下垂小花
  const leaf = (id, x, y, rot = 0, s = 1, flower = true) => {
    // 畫風與庫卡一致：漸層上色、柔邊細毛質感（輕微擾動）、模糊的亮面與陰影，不用硬黑邊。
    // 實際大小（一片葉子不到 10px）也要看得出是綠葉：葉片畫寬一點（披針形）、鼠尾草綠＋深綠細邊、葉與枝的夾角拉開、枝條用暖棕色
    const shape = (len, w) => `M0 0 C${f1(len * .22)} ${-w} ${f1(len * .72)} ${f1(-w * .95)} ${len} 0 C${f1(len * .72)} ${f1(w * .95)} ${f1(len * .22)} ${w} 0 0 Z`;
    const L = (ax, ay, ang, len, w = 2.7) => `<g transform="translate(${ax} ${ay}) rotate(${ang})">
        <path d="${shape(len, w)}" fill="#4a3a2e" opacity=".18" transform="translate(.5 .9)" filter="url(#lb${id})"/>
        <path d="${shape(len, w)}" fill="url(#lg${id})" stroke="#44663a" stroke-width=".8" stroke-linejoin="round" stroke-opacity=".6" filter="url(#lz${id})"/>
        <path d="M1.4 -.2 Q${len * .5} -.7 ${len - 2} -.1" fill="none" stroke="#eef5e0" stroke-width=".8" stroke-linecap="round" opacity=".8"/></g>`;
    return `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)}) scale(${s})">
      <path d="M0 .6 C-9 -.4 -18 -1.6 -30 -4.9" fill="none" stroke="#4a3a2e" stroke-width="1.8" opacity=".16" stroke-linecap="round" filter="url(#lb${id})"/>
      ${L(-22.5, -3.4, 142, 13)}${L(-13, -1.7, 140, 15)}${L(-4.5, -.5, 143, 12.5)}
      <path d="M0 0 C-9 -1 -18 -2.2 -30 -5.5" fill="none" stroke="#7a5c40" stroke-width="1.7" stroke-linecap="round" filter="url(#lz${id})"/>
      ${L(-8.5, -1.1, -140, 14)}${L(-17.5, -2.4, -138, 15.5)}${L(-26, -4.3, -146, 13)}${L(-29.5, -5.4, -172, 11.5, 2.4)}
      ${flower ? `<g transform="translate(-21 -3.3) rotate(${f1(-rot)})">
        <path d="M0 0 Q.6 3 0 5" fill="none" stroke="#8a6a52" stroke-width=".8" opacity=".9"/>
        <path d="M-2.8 5.2 Q-3.2 9.6 0 10.2 Q3.2 9.6 2.8 5.2 Q0 3.8 -2.8 5.2 Z" fill="#4a3a2e" opacity=".18" transform="translate(.5 .8)" filter="url(#lb${id})"/>
        <path d="M-2.8 5.2 Q-3.2 9.6 0 10.2 Q3.2 9.6 2.8 5.2 Q0 3.8 -2.8 5.2 Z" fill="url(#fg${id})" stroke="#8a4f80" stroke-width=".6" stroke-opacity=".6" filter="url(#lz${id})"/>
        <ellipse cx="-1" cy="6.6" rx=".8" ry="1.6" fill="#fbe8f5" opacity=".6" filter="url(#lb${id})"/></g>` : ''}
    </g>`;
  };
  // 特效：統一成柔邊厚塗（底下一層同色暈開、上面一層實色＋小亮點），線條類用圓頭粗線＋暈邊；不用字型
  function fx(id, kind, x, y, rot = 0, s = 1) {
    const g = (inner) => `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)}) scale(${s})">${inner}</g>`;
    const blob = (d, col, glow = col) => `<path d="${d}" fill="${glow}" opacity=".45" filter="url(#lc${id})"/><path d="${d}" fill="${col}" filter="url(#lb${id})" opacity=".55"/><path d="${d}" fill="${col}"/>`;
    const line = (d, col, w, op = .85) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w * 2.2}" stroke-linecap="round" stroke-linejoin="round" opacity="${(op * .3).toFixed(2)}" filter="url(#lc${id})"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"/>`;
    const HEART = 'M0 4.6 C-6.4 .6 -6.2 -4.6 -2.9 -4.6 C-1.2 -4.6 -.3 -3.4 0 -2.4 C.3 -3.4 1.2 -4.6 2.9 -4.6 C6.2 -4.6 6.4 .6 0 4.6 Z';
    const SPARK = 'M0 -6.4 Q.9 -.9 6.4 0 Q.9 .9 0 6.4 Q-.9 .9 -6.4 0 Q-.9 -.9 0 -6.4 Z';
    const STAR = 'M0 -5.6 L1.5 -1.9 L5.4 -1.7 L2.4 .8 L3.4 4.6 L0 2.5 L-3.4 4.6 L-2.4 .8 L-5.4 -1.7 L-1.5 -1.9 Z';
    const Z = (zx, zy, k) => `M${zx - 3 * k} ${zy - 3.6 * k} H${zx + 3 * k} L${zx - 3 * k} ${zy + 3.6 * k} H${zx + 3.2 * k}`;
    switch (kind) {
      case 'impact': return g(`<circle r="16" fill="url(#fl${id})"/><path d="M0 -15 L3 -5 L13 -8 L6 0 L14 7 L4 5 L0 15 L-3 5 L-13 8 L-6 0 L-14 -7 L-4 -5 Z" fill="#ffd66b" opacity=".55" filter="url(#lc${id})"/><path d="M0 -12 L2.4 -4 L10.4 -6.4 L4.8 0 L11.2 5.6 L3.2 4 L0 12 L-2.4 4 L-10.4 6.4 L-4.8 0 L-11.2 -5.6 L-3.2 -4 Z" fill="#ffe89a" stroke="#ffe89a" stroke-width="1.6" stroke-linejoin="round"/><circle r="3.4" fill="#fffbe6" filter="url(#lb${id})"/>`);
      case 'speed': return g(line('M0 -6 H-24', '#b9c0ca', 2, .7) + line('M2 0 H-34', '#aab2bd', 2.6, .8) + line('M0 6 H-20', '#b9c0ca', 2, .6));
      case 'arc': return g(`<path d="M-20 10 Q0 -22 22 8" fill="none" stroke="#c4c9d1" stroke-width="2.4" stroke-linecap="round" stroke-dasharray=".1 6" opacity=".9"/>`);
      case 'swoosh': return g(`<path d="M-18 14 Q-22 -10 4 -22" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" opacity=".7" filter="url(#lc${id})"/><path d="M-18 14 Q-22 -10 4 -22" fill="none" stroke="#ffffff" stroke-width="3.4" stroke-linecap="round" opacity=".9"/><path d="M-18 14 Q-22 -10 4 -22" fill="none" stroke="#b8c7da" stroke-width="1.2" stroke-linecap="round" opacity=".8"/>`);
      case 'sweat': return g(blob('M0 -1 Q-3.6 4.6 -2.4 6.6 Q0 9 2.4 6.6 Q3.6 4.6 0 -1 Z', '#9fcdf2', '#bfe0f8') + `<ellipse cx="-.9" cy="5" rx=".8" ry="1.3" fill="#fff" opacity=".8"/>`);
      case 'heart': return g(blob(HEART, '#ef6f7c', '#f7a3ab') + `<ellipse cx="-2.3" cy="-2.2" rx="1.3" ry=".9" fill="#fff" opacity=".6" transform="rotate(-30 -2.3 -2.2)"/>`);
      case 'sparkle': return g(blob(SPARK, '#ffd95e', '#ffe9a0') + `<circle r="1.3" fill="#fffbe6"/>`);
      case 'star': return g(`<g stroke="#ffd95e" stroke-width="1.6" stroke-linejoin="round">${blob(STAR, '#ffd95e', '#ffe9a0')}</g><ellipse cx="-1.2" cy="-1.4" rx="1.2" ry=".8" fill="#fffbe6" opacity=".8"/>`);
      case 'dust': return g([[-10, 0, 6, 3.4], [10, 0, 6, 3.4], [-17, -2.6, 3.4, 2.4], [17, -2.6, 3.4, 2.4], [0, -1.6, 4, 2.4]].map(([cx, cy, rx, ry]) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx + 1.5}" ry="${ry + 1.2}" fill="#e5dac6" opacity=".5" filter="url(#lc${id})"/><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#dccfb8" opacity=".8" filter="url(#lb${id})"/>`).join(''));
      case 'zzz': return g(line(Z(0, -3, 1), '#8f9bb0', 1.9) + line(Z(8.5, -13, 1.25), '#8f9bb0', 2.2) + line(Z(19, -25.5, 1.5), '#8f9bb0', 2.5, .7));
      case 'note': return g(line('M-.2 -.4 V-10.4 L6.8 -12.4 V-2.4', '#8296c4', 1.6) + `<ellipse cx="-2" cy="0" rx="2.7" ry="2" fill="#8296c4" transform="rotate(-18 -2 0)"/><ellipse cx="5" cy="-2" rx="2.7" ry="2" fill="#8296c4" transform="rotate(-18 5 -2)"/><ellipse cx="-2.6" cy="-.6" rx=".9" ry=".5" fill="#fff" opacity=".5"/>`);
      case 'sniff': return g(line('M0 0 q-4 -3 -8 0 M-2 6 q-5 -2 -9 1', '#aab2bd', 1.6));
      case 'sniffR': return g(line('M0 0 q4 -3 8 0 M2 6 q5 -2 9 1', '#aab2bd', 1.6));
      case 'shadow': return g(`<ellipse cx="0" cy="0" rx="24" ry="4.5" fill="#000" opacity=".12" filter="url(#lb${id})"/>`);
      default: return '';
    }
  }

  // ---- 主繪製 ---------------------------------------------------------------
  const BALLS = new Set(['vball', 'bball']);
  function render(th, id, pose = {}) {
    const tr = A.traits ? A.traits() : null, juv = I.juvenile ? I.juvenile() : false;
    const hs = pose.headScale || (juv ? 1.12 : 1), eyeK = juv ? 1.1 : 1, detail = pose.detail === 'high';
    const T = makeT(pose, hs), c = Math.cos(rad(th)), s = Math.sin(rad(th)), dx = pose.x || 0, dy = pose.y || 0;
    const P = (p3) => I.proj(p3, th);
    const PB = (p) => P(T.B(p)), PH = (p) => P(T.H(p)), PF = (p) => P(T.F(p));
    const thH = th + T.yaw, cH = Math.cos(rad(thH)), sH = Math.sin(rad(thH)), aS = Math.abs(sH), aC = Math.abs(cH);
    // 身體與頭各自的橢圓（傾斜時把橢球的高與深互換一部分，四腳著地時背才是橫的）
    const ell = (part) => {
      const [n, x, y, z, rx, ry, rz] = part;
      if (HEAD.has(n)) {
        const q = PH([x, y, z]), a = rad(T.pitch), kz = (n === 'snout' || n === 'snoutTip') ? 1 : hs;
        const ryE = Math.hypot(ry * hs * Math.cos(a), rz * kz * Math.sin(a)), rzE = Math.hypot(rz * kz * Math.cos(a), ry * hs * Math.sin(a));
        return { cx: q.X, cy: q.Y, rx: Math.hypot(rx * hs * cH, rzE * sH), ry: ryE };
      }
      const q = PB([x, y, z]), a = rad(T.leanAt(y));
      const ryE = Math.hypot(ry * T.sq * Math.cos(a), rz * T.k * Math.sin(a)), rzE = Math.hypot(rz * T.k * Math.cos(a), ry * T.sq * Math.sin(a));
      return { cx: q.X, cy: q.Y, rx: Math.hypot(rx * T.k * c, rzE * s), ry: ryE };
    };
    const parts = I.q3();
    const EL = parts.map(ell);
    // 口鼻一帶毛短：輪廓上不長翹毛（側面的鼻尖、下巴才不會像長了刺）
    const muzE = EL.filter((e, i) => ['snout', 'snoutTip', 'jaw'].includes(parts[i][0]));
    const U = union(EL, (p) => muzE.some((e) => ((p[0] - e.cx) / (e.rx + 3)) ** 2 + ((p[1] - e.cy) / (e.ry + 3)) ** 2 < 1)), bodyD = U.d;
    const facingH = (n) => I.facing(rotY(n, T.yaw, [0, 0, 0]), th);
    const out = { back: [], feet: [], body: [], front: [] };

    // 尾巴：粗、從臀部長出來，顏色由身體色漸漸變深；根部跟著臀部，尾巴本身沿地面往後（不跟著前傾翹起來）。
    // 觀者視線略高於地面：尾巴朝觀者時（背面）畫成躺在地上的水滴形
    const tk = I.tailK(), up = pose.tailUp || 0;
    const tRoot = [0, 160, -38], tR = PB(tRoot), tF = PF(tRoot);
    const tq = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, r = 8.6 - 5.8 * Math.pow(t, .8);
      const y = Math.min(160 + 16 * Math.min(1, t * 2.6), 175.6 - r) - up * t * t * 30;
      const q = PF([0, y, -38 - 58 * tk * t]), w = (1 - t) * (1 - t);
      const Z = q.Z + (tR.Z - tF.Z) * w;
      tq.push({ X: q.X + (tR.X - tF.X) * w, Y: q.Y + (tR.Y - tF.Y) * w + Math.max(0, Z - tR.Z) * .2 * (1 - up * .6), Z, r: r * (T.k + 1) / 2 });
    }
    const tl = Math.hypot(tq[8].X - tq[0].X, tq[8].Y - tq[0].Y), fs = clamp((1 - tl / 60) * 1.3, 0, 1);
    tq.forEach((q, i) => { q.r = q.r + (Math.max(q.r, 5.6 - i * .12) - q.r) * fs; });
    if (tl > 5) {
      const tailD = tubePath(tq);
      const tailSvg = `<defs><linearGradient id="tg2${id}" gradientUnits="userSpaceOnUse" x1="${f1(tq[0].X)}" y1="${f1(tq[0].Y)}" x2="${f1(tq[8].X)}" y2="${f1(tq[8].Y)}"><stop offset="0" stop-color="#b9a283"/><stop offset=".22" stop-color="#a38a6a"/><stop offset=".45" stop-color="#93704c"/><stop offset=".75" stop-color="#7a5c40"/><stop offset="1" stop-color="#5e4632"/></linearGradient></defs>
        <path d="${tailD}" fill="#4a3a2e" opacity=".16" transform="translate(0 1.6)" filter="url(#b1${id})"/>
        <path d="${tailD}" fill="url(#tg2${id})" filter="url(#fz${id})"/>
        <path d="M${tq.slice(1, 7).map((q) => f1(q.X - q.ty * q.r * -.35) + ' ' + f1(q.Y - q.r * .35)).join(' L')}" fill="none" stroke="#d8bd98" stroke-width="1.6" stroke-linecap="round" opacity=".25" filter="url(#b1${id})"/>`;
      (tq[5].Z > 2 ? out.front : out.back).push(tailSvg);
    }

    // 腳：站著時腳掌貼地、朝前（後寬前窄）；騰空時腳尖朝下
    const air = pose.feet === 'air' || (pose.feet !== 'stand' && dy < -4);
    [-1, 1].forEach((k) => {
      const fs = (!air && pose.footShift) || [0, 0, 0], fz = fs[0] || 0, fu = fs[1] || 0, ft = fs[2] || 0;
      const heel = PF(air ? [k * 17, 166, -4] : [k * 18, 171.4 - fu, -12 + fz]), toe = PF(air ? [k * 17, 182, 12] : [k * 18, 173.2 - fu + ft, 30 + fz - ft * .35]);
      const vx = toe.X - heel.X, vy = toe.Y - heel.Y, L = Math.hypot(vx, vy);
      const farSide = PF([k * 18, 172, 10]).Z < -2;
      let d, extra = '';
      if (L < 5) {
        const cy = heel.Y + 4.6;
        d = `<ellipse cx="${f1(heel.X)}" cy="${f1(cy)}" rx="9.6" ry="7.4" fill="${I.FOOT}"/>`;
        // 正面：腳尖朝觀者，畫兩道淺淺的趾縫；背面只看到腳跟
        if (toe.Z > heel.Z) extra = `<path d="M${f1(heel.X - 3)} ${f1(cy + 2.6)} v4 M${f1(heel.X + 3)} ${f1(cy + 2.6)} v4" stroke="#4a3b30" stroke-width="1" stroke-linecap="round" opacity=".3"/><ellipse cx="${f1(heel.X - 1)}" cy="${f1(cy - 2.4)}" rx="5.4" ry="2.6" fill="#d8bd98" opacity=".22" filter="url(#b1${id})"/>`
          + (detail ? [-5.4, 0, 5.4].map((o) => I.CLAW(f1(heel.X + o), f1(cy + 6), 0, 2.6)).join('') : '');
      } else {
        const ux = vx / L, uy = vy / L, mid = { X: heel.X + vx * .55, Y: heel.Y + vy * .55, r: 5 };
        d = `<path d="${tubePath([{ X: heel.X, Y: heel.Y, r: 6.2 }, mid, { X: toe.X, Y: toe.Y, r: 3.9 }])}" fill="${I.FOOT}"/>`;
        extra = `<path d="M${f1(heel.X + ux * 2)} ${f1(heel.Y + uy * 2 - 2.6)} L${f1(toe.X - ux * 3)} ${f1(toe.Y - uy * 3 - 1.6)}" stroke="#d8bd98" stroke-width="2" stroke-linecap="round" opacity=".22" filter="url(#b1${id})"/>`;
        if (detail && (toe.Z > -6 || air)) { const ang = Math.atan2(-vx, vy) * 180 / Math.PI; extra += [-2.6, 0, 2.6].map((o) => I.CLAW(f1(toe.X + ux * 3 - uy * o), f1(toe.Y + uy * 3 + ux * o), f1(ang), 2.6)).join(''); }
      }
      (farSide ? out.back : out.feet).push(`<g filter="url(#fz${id})"${farSide ? ' opacity=".94"' : ''}>${d}</g>${extra}`);
    });

    // 身體（含明暗）：明暗用身體上的 3D 點定位，身體傾斜、彎腰時跟著轉
    const bF = I.facing([0, 0, 1], th), belly = PB([0, 146, 26]), chestP = PB([0, 108, 24]);
    const spine = [[66, -22], [86, -34], [108, -40], [130, -44], [150, -46], [166, -42]].map(([y, z]) => PB([0, y, z]));
    const spineD = 'M' + spine.map((q) => f1(q.X) + ' ' + f1(q.Y)).join(' L');
    const big = Math.abs(T.lean) > 18 || Math.abs(pose.roll || 0) > 12;
    const bodyLayer = `<path d="${bodyD}" fill="none" stroke="#5e4632" stroke-width="2" opacity=".2" filter="url(#fz${id})"/><path d="${bodyD}${U.tufts}" fill="url(#bg${id})" filter="url(#fz${id})"/>
      <g clip-path="url(#cb${id})">
        ${bF > -0.3 ? `<ellipse cx="${f1(belly.X)}" cy="${f1(belly.Y)}" rx="${f1((17 + 23 * Math.max(0, bF)) * T.k)}" ry="${f1(29 * T.sq)}" transform="rotate(${f1(T.leanAt(146) * s)} ${f1(belly.X)} ${f1(belly.Y)})" fill="#f0dcb9" opacity="${(0.92 * Math.min(1, bF + .5)).toFixed(2)}" filter="url(#b6${id})"/>
          <ellipse cx="${f1(chestP.X)}" cy="${f1(chestP.Y)}" rx="${f1(6 + 9 * Math.max(0, bF))}" ry="13" fill="#f0dcb9" opacity="${(0.4 * Math.min(1, bF + .5)).toFixed(2)}" filter="url(#b6${id})"/>` : ''}
        ${bF < 0.3 ? `<path d="${spineD}" fill="none" stroke="#68533e" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" opacity=".1" filter="url(#b6${id})"/>` : ''}
        <path d="${spineD}" fill="none" stroke="#76604a" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" opacity="${(0.3 * Math.abs(s)).toFixed(2)}" filter="url(#b6${id})"/>
        <path d="${bodyD}" fill="none" stroke="#fff6e6" stroke-width="3" opacity=".3" filter="url(#b1${id})"/>
        ${big ? I.fur(1250, -30, 190, 11) : I.fur(700, 30, 130, 11)}
      </g>`;

    // 耳朵（在頭後面）：遠側耳朵不會窄成尖刺（寬度有下限、稍微放低）；earFlop 讓每隻耳朵繞耳根多轉一點
    const ek = I.earK(), flop = pose.earFlop || {};
    const headZ = PH([0, 30, 0]).Z;
    const earList = [-1, 1].map((k) => {
      const q0 = PH([k * 22, 19, -10]), f = facingH([k * .3, 0, 1]), w = 9 * (0.66 + 0.34 * Math.abs(f)), base = PH([k * 18, 28, -8]);
      const farE = q0.Z < headZ - 4, q = { X: q0.X, Y: q0.Y + (farE ? 2.4 * aS : 0), Z: q0.Z };
      const inner = f > 0.15 ? `<ellipse cx="${f1(q.X)}" cy="${f1(q.Y + 1.6)}" rx="${f1(w * .62)}" ry="6.8" fill="#f2c38c"/><ellipse cx="${f1(q.X)}" cy="${f1(q.Y + 2.8)}" rx="${f1(w * .35)}" ry="4" fill="#8a7460"/>` : '';
      // 耳朵本身的外張角維持 ×0.6；earFlop 照原值（×1.0）加上去，繞耳根轉
      const tilt = Math.atan2(q.X - base.X, base.Y - q.Y) * 180 / Math.PI * .6 + k * ((k < 0 ? flop.L : flop.R) || 0);
      return { z: q.Z, svg: `<g class="ear" filter="url(#fz${id})" transform="rotate(${f1(tilt)} ${f1(base.X)} ${f1(base.Y)}) translate(${f1(q.X)} ${f1(q.Y + 8)}) scale(${(ek * T.hs).toFixed(3)}) translate(${f1(-q.X)} ${f1(-q.Y - 8)})"><ellipse cx="${f1(q.X)}" cy="${f1(q.Y)}" rx="${f1(w)}" ry="10.5" fill="${f > 0 ? '#b38a5e' : '#93744f'}"/>${inner}</g>` };
    });

    // 飾品：全部在頭部／身體的 3D 座標裡定位，前後遮擋用頭部本身的座標判斷（見 quokka-acc.js）
    const AC = ACC();
    const accL = AC ? AC.draw(AC.resolve(pose.accessory, tr), {
      id, th, PH, PB, hs: T.hs,
      head: parts.filter((p) => HEAD.has(p[0])).map((p) => p.slice(1)),
      body: parts.filter((p) => !HEAD.has(p[0])).map((p) => p.slice(1))
    }) : { back: [], ear: [], front: [], top: [], earsOver: false };
    if (!accL.overEars) accL.overEars = [];
    // 耳朵與耳邊小飾品依深度排序（遠的先畫）
    const ears = earList.concat(accL.ear).sort((a, b) => a.z - b.z).map((e) => e.svg).join('');

    // 頭的明暗：頭頂較深、口鼻周圍偏暖、下巴淺；年長個體的口鼻與眼睛上方先變白
    const hc = PH([0, 22, 0]), muz = PH([0, 60, 22]), chin = PH([0, 67.5, 22]), hF = facingH([0, 0, 1]);
    const grey = tr && tr.stage === 'senior' && tr.fur ? (tr.fur.grey || 0) : 0;
    let old = '';
    if (grey > 0 && hF > -0.2) {
      const go = Math.min(.85, grey * 2.6), mz = PH([0, 59, 26]);
      old = `<ellipse cx="${f1(mz.X)}" cy="${f1(mz.Y + 1)}" rx="${f1(8 + 9 * aC)}" ry="10.5" fill="#f4efe6" opacity="${go.toFixed(2)}" filter="url(#b3${id})"/>`;
      for (const k of [-1, 1]) { const b = PH([k * 13.5, 35, 21]), fb = facingH([k * .5, 0, .87]); if (fb > .05) old += `<ellipse cx="${f1(b.X)}" cy="${f1(b.Y)}" rx="${f1(6.5 * Math.min(1, .3 + fb))}" ry="3.4" fill="#f4efe6" opacity="${(go * .8).toFixed(2)}" filter="url(#b1${id})"/>`; }
    }
    const headSvg = `<g clip-path="url(#cb${id})">
        <ellipse cx="${f1(hc.X)}" cy="${f1(hc.Y - 2)}" rx="26" ry="9" fill="#7c6244" opacity=".4" filter="url(#b3${id})"/>
        ${hF > -0.2 ? `<ellipse cx="${f1(muz.X)}" cy="${f1(muz.Y + 2)}" rx="${f1((12 + 18 * Math.max(0, cH)) * Math.sqrt(hs))}" ry="${f1(15 * Math.sqrt(hs))}" fill="#dfa65e" opacity=".85" filter="url(#b3${id})"/><ellipse cx="${f1(chin.X)}" cy="${f1(chin.Y)}" rx="${f1(7 + 7 * Math.max(0, cH))}" ry="6" fill="#f3e2c4" opacity=".85" filter="url(#b3${id})"/>` : ''}${old}
      </g>`;

    // 五官
    const face = [];
    const look = pose.look || [0, 0], blink = clamp(pose.blink || 0, 0, 1);
    const spiral = (x, y) => { let d = ''; for (let i = 0; i <= 40; i++) { const t = i / 40, a = t * Math.PI * 4.6, r = .4 + 4.5 * t; d += (i ? ' L' : 'M') + f1(x + Math.cos(a) * r) + ' ' + f1(y + Math.sin(a) * r); } return d; };
    for (const k of [-1, 1]) {
      // 眼睛長在頭的兩側偏前：正面看是圓的，側面看近側那隻也幾乎是圓的
      const e = PH([k * 13.5, 43, 21]), f = facingH([k * .5, 0, .87]);
      if (f > 0.05) {
        const sx = Math.min(1, 0.3 + 1.1 * f), ex = e.X + look[0] * 1.4 * f, ey = e.Y + look[1], es = T.hs * eyeK;
        let mode = pose.eyes || 'open';
        if (mode === 'wink') mode = k === 1 ? 'happy' : 'open';
        const openType = !['happy', 'closed', 'dizzy'].includes(mode);
        if (openType && blink >= .78) mode = 'closed';
        const sy = openType && mode !== 'closed' ? 1 - .85 * blink : 1;
        const g = (inner) => `<g transform="translate(${f1(e.X)} ${f1(e.Y)}) scale(${(sx * es).toFixed(2)} ${(es * sy).toFixed(2)}) translate(${f1(-e.X)} ${f1(-e.Y)})">${inner}</g>`;
        const ln = (d, w = 1.8) => g(`<path d="${d}" fill="none" stroke="#1f1814" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`);
        // 眉毛：inner＝靠鼻樑那端的高度、outer＝外側那端（負＝較高）
        const brow = (inner, outer) => `<path d="M${f1(e.X - k * 4.4)} ${f1(e.Y + inner)} Q${f1(e.X)} ${f1(e.Y + (inner + outer) / 2 - .7)} ${f1(e.X + k * 4.6)} ${f1(e.Y + outer)}" fill="none" stroke="#5a4232" stroke-width="1.25" stroke-linecap="round" opacity=".85"/>`;
        switch (mode) {
          case 'happy': face.push(ln(`M${f1(e.X - 4.5)} ${f1(e.Y + 1.2)} Q${f1(e.X)} ${f1(e.Y - 3.8)} ${f1(e.X + 4.5)} ${f1(e.Y + 1.2)}`)); break;
          case 'closed': face.push(ln(`M${f1(e.X - 4.5)} ${f1(e.Y)} Q${f1(e.X)} ${f1(e.Y + 3)} ${f1(e.X + 4.5)} ${f1(e.Y)}`)); break;
          case 'dizzy': face.push(ln(spiral(e.X, e.Y), 1.35)); break;
          case 'wide': face.push(g(I.eye(ex, ey - .5, id, { scale: 1.35 }))); break;
          case 'focus': face.push(g(I.eye(ex, ey, id) + brow(-5.2, -7.8))); break;
          case 'sad': face.push(g(I.eye(ex, ey + .4, id, { scale: 1.04 }) + `<ellipse cx="${f1(ex)}" cy="${f1(ey + 3.3)}" rx="2.6" ry="1" fill="#bfe0f8" opacity=".7"/>` + brow(-8.2, -5.4))); break;
          case 'sleepy': face.push(g(I.eye(ex, ey + .4, id) + `<path d="M${f1(e.X - 5.6)} ${f1(e.Y + .2)} A5.6 5.6 0 0 1 ${f1(e.X + 5.6)} ${f1(e.Y + .2)} Q${f1(e.X)} ${f1(e.Y + .9)} ${f1(e.X - 5.6)} ${f1(e.Y + .2)} Z" fill="#a37a52"/><path d="M${f1(e.X - 4.6)} ${f1(e.Y + .3)} Q${f1(e.X)} ${f1(e.Y + 1)} ${f1(e.X + 4.6)} ${f1(e.Y + .3)}" fill="none" stroke="#3a2c22" stroke-width="1" stroke-linecap="round"/>`)); break;
          default: face.push(g(I.eye(ex, ey, id)));
        }
      }
      const b = PH([k * 20, 57, 17]), fb = facingH([k * .6, 0, .8]);
      if (fb > 0.1) face.push(`<ellipse cx="${f1(b.X)}" cy="${f1(b.Y)}" rx="${f1(6.5 * fb)}" ry="4" fill="#f0907c" opacity="${(0.3 * (pose.blush == null ? 1 : pose.blush)).toFixed(2)}" filter="url(#b1${id})"/>`);
    }
    if (hF > -0.25) {
      // 鼻子：正面寬、側面扁而小，貼著口鼻前端（不會像掛在臉外的球）
      const w = 6.5 * (0.5 + 0.5 * aC), nh = 5.4 * (0.84 + 0.16 * aC);
      const n0 = PH([0, 54, 35.5 * (1 - aS) + (38.9 - w) * aS]);
      // 鼻子抽動：正＝往上抬（Y 減少）並放大，負＝往下並縮小；幅度 ±0.8 單位、±6%
      const tw = clamp(pose.noseTwitch || 0, -1, 1), nk = 1 + 0.06 * tw;
      const n = { X: n0.X, Y: n0.Y - 0.8 * tw }, wN = w * nk, nhN = nh * nk;
      face.push(`<ellipse cx="${f1(n.X)}" cy="${f1(n.Y)}" rx="${f1(wN + 1)}" ry="${f1(nhN + .8)}" fill="#3b2f26" opacity=".3" filter="url(#b1${id})"/><ellipse cx="${f1(n.X)}" cy="${f1(n.Y)}" rx="${f1(wN)}" ry="${f1(nhN)}" fill="url(#ns${id})"/><ellipse cx="${f1(n.X - wN * .32)}" cy="${f1(n.Y - nhN * .45)}" rx="${f1(wN * .38)}" ry="${f1(1.1 * nk)}" fill="#d4dfec" opacity=".5"/>`);
      const mf = 0.3 + 0.7 * aC;
      // 嘴：各點都在口鼻表面上；張嘴類的中心隨轉頭往回收，並裁在輪廓內
      const mc0 = PH([0, 63, 29 - 3 * aS]), mc = { X: mc0.X, Y: mc0.Y };
      const mp = [[-9, 60, 22], [-4.4, 64, 30], [0, 62.2, 34.5], [4.4, 64, 30], [9, 60, 22]].map((p) => ({ q: PH(p), f: facingH([p[0] / 20, 0, 1]), far: p[0] * sH > 0 })).filter((m) => m.f > (m.far ? 0.6 : -0.1));
      const smile = mp.length > 1 ? `<path d="M${f1(mp[0].q.X)} ${f1(mp[0].q.Y)} ${mp.slice(1).map((m, i) => { const a = mp[i].q, bq = m.q; return 'Q' + f1((a.X + bq.X) / 2) + ' ' + f1(Math.max(a.Y, bq.Y) + 1.2) + ' ' + f1(bq.X) + ' ' + f1(bq.Y); }).join(' ')}" fill="none" stroke="#2a211b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` : '';
      // 人中：轉到側面就淡出（|sin|>0.8 不畫），不會變成往下滴的黑線
      const mTop = PH([0, 62.2, 34.5]), pOp = clamp(1 - aS / .8, 0, 1);
      const philtrum = (toY) => (pOp > .02 ? `<path d="M${f1(n.X)} ${f1(n.Y + nh - .4)} L${f1(n.X * .5 + mTop.X * .5)} ${f1(toY)}" stroke="#2a211b" stroke-width="1.2" stroke-linecap="round" opacity="${pOp.toFixed(2)}"/>` : '');
      const clipM = (inner) => `<g clip-path="url(#cb${id})">${inner}</g>`;
      switch (pose.mouth) {
        case 'open': face.push(philtrum(mc.Y - 1.4) + clipM(`<path d="M${f1(mc.X - 8 * mf)} ${f1(mc.Y - 2)} Q${f1(mc.X)} ${f1(mc.Y + 1)} ${f1(mc.X + 8 * mf)} ${f1(mc.Y - 2)} Q${f1(mc.X + 6.5 * mf)} ${f1(mc.Y + 6.6)} ${f1(mc.X)} ${f1(mc.Y + 7.1)} Q${f1(mc.X - 6.5 * mf)} ${f1(mc.Y + 6.6)} ${f1(mc.X - 8 * mf)} ${f1(mc.Y - 2)} Z" fill="#4a2622" stroke="#2a211b" stroke-width="1"/><path d="M${f1(mc.X - 4 * mf)} ${f1(mc.Y + 4.6)} Q${f1(mc.X)} ${f1(mc.Y + 2.4)} ${f1(mc.X + 4 * mf)} ${f1(mc.Y + 4.6)} Q${f1(mc.X)} ${f1(mc.Y + 7)} ${f1(mc.X - 4 * mf)} ${f1(mc.Y + 4.6)} Z" fill="#e58a8a"/>`)); break;
        case 'o': face.push(philtrum(mc.Y - 1.4) + clipM(`<ellipse cx="${f1(mc.X)}" cy="${f1(mc.Y + 2.2)}" rx="${f1(2.8 * mf)}" ry="3.3" fill="#4a2622" stroke="#2a211b" stroke-width=".9"/>`)); break;
        case 'flat': face.push(philtrum(mc.Y + 1) + clipM(`<path d="M${f1(mc.X - 5 * mf)} ${f1(mc.Y + 1)} Q${f1(mc.X)} ${f1(mc.Y + 2)} ${f1(mc.X + 5 * mf)} ${f1(mc.Y + 1)}" fill="none" stroke="#2a211b" stroke-width="1.5" stroke-linecap="round"/>`)); break;
        case 'chew': face.push(philtrum(mc.Y - .4) + clipM(`<ellipse cx="${f1(mc.X)}" cy="${f1(mc.Y + 1.8)}" rx="${f1(3.4 * mf)}" ry="2.1" fill="#4a2622" stroke="#2a211b" stroke-width=".9"/>`)); break;
        default: face.push(smile + philtrum(mTop.Y));
      }
    }

    // 手：肩膀在身體兩側，手掌位置由 pose 指定（身體座標，跟著身體傾斜），手肘自動往外彎；
    // 反向運動學在「傾斜後」的空間裡解，所以手可以限制在地面以上（四腳著地時前掌撐在地上）
    const hands = {}, armItems = [];
    const ground = FEET_Y - dy - 3;
    [['L', -1], ['R', 1]].forEach(([key, k]) => {
      const spec = (pose.arms && pose.arms[key]) || null;
      const handB = spec ? spec.hand : [k * 6.5, 122, 28];
      // 手舉過肩：肩關節略往上往後移（手從頭旁邊舉上去，不會擋臉）
      const lift = clamp((100 - handB[1]) / 40, 0, 1);
      const shB = [k * (24 + lift), 100 - 5 * lift, 8 - 5 * lift];
      const Sw = T.B(shB);
      let Tw = T.B(handB);
      if (!air && Tw[1] > ground) Tw = [Tw[0], ground, Tw[2]];
      // 手肘方向：平常往外下後方；手舉高時往外側
      const hintB = spec && spec.elbow ? spec.elbow : [k * 1, 0.7 - 0.6 * lift, -0.35];
      const sol = ik(Sw, Tw, v3.sub(T.B(v3.add(shB, v3.mul(hintB, 10))), Sw));
      const sh = P(Sw), el = P(sol.elbow), wr = P(sol.hand);
      const vx = wr.X - el.X, vy = wr.Y - el.Y, fl = Math.hypot(vx, vy);
      const fixedPaw = spec && spec.paw != null;
      const palm = !!spec && !fixedPaw && fl < FORE * .6 && wr.Z > el.Z + 10;           // 手伸向觀者 → 畫掌心
      const ang = fixedPaw ? spec.paw : palm ? 180 : Math.atan2(-vx, vy) * 180 / Math.PI;
      const zKey = .35 * sh.Z + .65 * wr.Z, behind = zKey < -3;
      const c1 = [sh.X + (el.X - sh.X) * 1.25, sh.Y + (el.Y - sh.Y) * 1.25], c2 = [el.X + (wr.X - el.X) * .25, el.Y + (wr.Y - el.Y) * .25];
      // 肩膀的一撮毛：用和身體同一個漸層，手臂根部自然融進身體（舉手時胸口不會多出兩顆球）
      const tuft = behind ? '' : `<ellipse cx="${f1(sh.X - k * c * 1.5)}" cy="${f1(sh.Y + .5)}" rx="5" ry="6.4" fill="url(#bg${id})" opacity=".7" filter="url(#b1${id})"/>`;
      const svg = I.arm(id, [[sh.X, sh.Y], c1, c2, [wr.X, wr.Y]], f1(ang), { thumb: palm ? 0 : k, side: k, fade: spec ? 0 : .1, w1: 12.5, w2: 8, bulge: .8, palm, detail, far: behind }) + tuft;
      const a = rad(ang), palmC = [wr.X - Math.sin(a) * 3.6, wr.Y - 1 + Math.cos(a) * 3.6];
      armItems.push({ key, z: zKey, behind, svg, pre: [] });
      hands[key] = { X: wr.X, Y: wr.Y + 6, Z: wr.Z, behind, ang, palm: palmC };
    });
    armItems.sort((a, b) => a.z - b.z);

    // 道具與特效。at＝畫面絕對座標；hand＝黏在手上（跟著角色位移）
    const abs = { back: [], front: [] }, chr = { back: [], between: [], front: [] };
    (pose.props || []).forEach((p) => {
      if (p.t === 'racket' && p.at) { abs.front.push(racket(id, p.at[0], p.at[1], p.ang || 0, p.len || 1)); return; }
      if (p.t === 'racket') {
        // 握把畫在那隻手的下面：手掌握在握把上
        const key = p.hand || 'R', h = hands[key], it = armItems.find((q) => q.key === key);
        if (h && it) it.pre.push(racket(id, h.palm[0], h.palm[1], p.ang || 0, p.len || 1, p.hit, p.swoosh));
        return;
      }
      // 道具可以黏在手上：hand＝'L'／'R'／'both'（兩手中間），off＝相對位移
      let [x, y] = p.at || [0, 0], held = false;
      if (p.hand) {
        const hh = p.hand === 'both' ? [hands.L, hands.R].filter(Boolean) : [hands[p.hand]].filter(Boolean);
        if (hh.length) { held = true; x = hh.reduce((a, h) => a + h.X, 0) / hh.length + ((p.off || [])[0] || 0); y = hh.reduce((a, h) => a + h.Y, 0) / hh.length + ((p.off || [])[1] || 0); }
      }
      let svg = '';
      if (p.t === 'shuttle') svg = shuttle(id, x, y, p.rot, p.s);
      else if (p.t === 'vball') svg = vball(id, x, y, p.rot, p.s);
      else if (p.t === 'bball') svg = bball(id, x, y, p.rot, p.s);
      else if (p.t === 'leaf') svg = p.kind === 'big' ? bigLeaf(id, x, y, p.rot, p.s) : leaf(id, x, y, p.rot, p.s);
      else if (p.t === 'hoop') svg = hoop(id, x, y, p.s, !!p.flip);
      else if (p.t === 'fx') svg = fx(id, p.kind, x, y, p.rot, p.s);
      const layer = p.layer || (p.behind ? 'back' : (held && p.hand === 'both' && BALLS.has(p.t)) ? 'between' : 'front');
      if (held) chr[layer === 'back' ? 'back' : layer === 'between' ? 'between' : 'front'].push(svg);
      else abs[layer === 'back' ? 'back' : 'front'].push(svg);
    });
    // 兩手抱著的東西：遠側手 → 球 → 近側手（兩手差不多遠時，球在兩手後面）
    const armSvg = (it) => it.pre.join('') + it.svg;
    const backArms = armItems.filter((q) => q.behind), frontArms = armItems.filter((q) => !q.behind);
    const btw = chr.between.join('');
    let armsBack = backArms.map(armSvg).join(''), armsFront;
    if (frontArms.length === 2 && Math.abs(frontArms[0].z - frontArms[1].z) > 5) armsFront = armSvg(frontArms[0]) + btw + armSvg(frontArms[1]);
    else if (frontArms.length) armsFront = btw + frontArms.map(armSvg).join('');
    else { armsFront = ''; armsBack += btw; }

    // 漸層沿身體走向（頭頂 → 腳底），前傾、四腳著地時顏色跟著身體，不會變成水平分層
    const topP = PH([0, 15, 0]), g0 = Math.hypot(topP.X - 80, topP.Y - FEET_Y) < 60 ? { X: 80, Y: 14 } : topP;
    const defs = I.DEFS(id).replace(/<linearGradient id="bg[^>]*>/, `<linearGradient id="bg${id}" gradientUnits="userSpaceOnUse" x1="${f1(80 + (g0.X - 80) * .8)}" y1="${f1(Math.min(g0.Y, 60))}" x2="80" y2="176">`)
      .replace('</defs>', `${PROP_DEFS(id)}${AC ? AC.defs(id) : ''}<clipPath id="cb${id}"><path d="${bodyD}"/></clipPath></defs>`);
    const shadow = `<ellipse cx="${f1(80 + dx)}" cy="183" rx="${f1(30 - Math.min(16, -dy * .4))}" ry="4" fill="#000" opacity="${f1(Math.max(.04, .12 + dy * .002))}"/>`;
    // 位移用外層 <g transform>：裡面的座標（與毛邊雜訊的相對位置）不變，移動時毛邊不會「沸騰」
    const G = (inner) => (inner ? ((dx || dy) ? `<g transform="translate(${f1(dx)} ${f1(dy)})">${inner}</g>` : inner) : '');
    const layers = {
      defs, shadow,
      back: abs.back.join('') + G(out.back.join('') + armsBack + chr.back.join('') + accL.back.join('')),
      body: G(out.feet.join('') + bodyLayer + out.front.join('') + (accL.earsOver ? '' : ears) + headSvg + accL.front.join('') + (accL.earsOver ? ears : '') + accL.overEars.join('') + face.join('') + accL.top.join('')),
      front: G(armsFront + chr.front.join('')) + abs.front.join('')
    };
    const paint = pose.raw ? (v) => v : I.paint;
    for (const k of Object.keys(layers)) layers[k] = paint(layers[k]);
    for (const k of ['L', 'R']) if (hands[k]) { hands[k].X += dx; hands[k].Y += dy; hands[k].palm = [hands[k].palm[0] + dx, hands[k].palm[1] + dy]; }
    return { svg: layers.defs + layers.shadow + layers.back + layers.body + layers.front, hands, layers };
  }
  // 包成完整 SVG（單隻）
  function svg(th, id, pose, vb = '0 0 160 196') {
    return `<svg viewBox="${vb}" class="view-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="overflow:visible">${render(th, id, pose).svg}</svg>`;
  }

  // 單顆球（給獨立的球視窗用）：以球心為中心、半徑 12 的 SVG
  function ballSVG(kind, rot = 0, scale = 1) {
    const id = 'bw';
    const body = kind === 'bball' ? bball(id, 0, 0, rot, 1) : vball(id, 0, 0, rot, 1);
    return `<svg viewBox="-16 -16 32 32" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;overflow:visible"><defs>${PROP_DEFS(id)}</defs>${body}</svg>`;
  }
  const api = { render, svg, ballSVG };
  if (typeof window !== 'undefined') window.QuokkaPose = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
