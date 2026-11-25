// 短尾矮袋鼠「庫卡」的繪圖模組：十六方位與分層正面，全部是 inline SVG（無外部圖檔）。
// 比例依使用者提供的照片量測（照片 y112–1055 → SVG y14–173，中心 x372 → 80），
// 造型為「萌化 A」：大眼雙反光、暖色高彩度毛色、毛流減量、從胸毛伸出的短前臂與小爪子。
// 同時供 renderer（window.QuokkaArt）與 Node（module.exports）使用。
(function () {
function cr(pts) {
  const n = pts.length, f = (v) => v.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + ' Z';
}

const mirror = (R) => [...R, [80, 173.6], ...R.slice(1).reverse().map(([x, y]) => [160 - x, y])];

// 梨形：頭不變；頸肩略收（y84–96），腹部與臀部加寬（y125–160 約 +10%）
const RIGHT = [[80, 15], [95, 15.5], [104, 18.5], [109, 25], [110.6, 32], [112.2, 45.7], [114.4, 58], [115, 66], [114.6, 74], [113.6, 84], [114.2, 96], [117.6, 112], [121, 128], [122.6, 146], [121.4, 160], [115.2, 168.6], [105.6, 172.4], [94, 173.4]];

const FRONT = cr(mirror(RIGHT));

const SIDE = cr([[92, 16], [104, 19], [111, 27], [114, 37], [118, 45], [123.5, 50], [125, 55], [121, 59.5], [114, 63], [112, 70],
  [112.2, 82], [113.6, 98], [118, 118], [121.2, 138], [118, 156], [109.6, 168.4], [92, 173.2], [68, 173.2], [52.6, 166], [48.6, 150],
  [51, 126], [59.4, 100], [64.4, 76], [66, 52], [70, 32], [79, 20]]);

const BACK = FRONT;
// 45 度角輪廓：以頭（橢球）＋口鼻＋身體的簡單 3D 模型旋轉 45° 後投影得到
const F34 = cr([[78, 15], [92, 15.5], [101, 19], [105.5, 26], [107.5, 35], [109.5, 42], [113, 46], [115.8, 50.5], [115.2, 56], [111.8, 60.2],
  [109, 64], [108.6, 71], [108.4, 81], [109.4, 96], [113.6, 118], [115.6, 142], [112, 160], [103, 170.4], [88, 173.4], [70, 173.4],
  [53, 169.4], [42.6, 158], [38.8, 136], [41.4, 110], [46.6, 92], [48.2, 80], [47.2, 66], [48, 52], [49.5, 38], [53, 26], [60, 18.5], [69, 15.5]]);
// 後 45 度：口鼻轉到頭後面被擋住，右緣只剩臉頰的毛
const B34 = cr([[78, 15], [92, 15.5], [101, 19], [105.5, 26], [107.5, 35], [109.4, 44], [111.6, 51], [112, 58], [110, 66],
  [107.4, 81], [107.8, 96], [111.4, 118], [113.4, 142], [110, 160], [102, 170.4], [88, 173.4], [70, 173.4],
  [52.6, 169.4], [42, 158], [38.4, 136], [40.8, 110], [45.8, 92], [47.8, 80], [47.2, 66], [48, 52], [49.5, 38], [53, 26], [60, 18.5], [69, 15.5]]);

function fur(n, x0, x1, seed0) {
  let seed = seed0 || 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); let o = '';
  n = Math.round(n * 0.38);
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * (x1 - x0), y = 16 + rnd() * 158, len = 1.8 + rnd() * 2.4;
    const a = (90 + (x - (x0 + x1) / 2) * 1.1 + (rnd() - 0.5) * 36) * Math.PI / 180, lt = rnd() < 0.55;
    o += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + Math.cos(a) * len).toFixed(1)}" y2="${(y + Math.sin(a) * len).toFixed(1)}" stroke="${lt ? '#e6ddd0' : '#4f4439'}" stroke-opacity="${lt ? .24 : .2}" stroke-width="${(0.45 + rnd() * 0.35).toFixed(2)}" stroke-linecap="round"/>`;
  }
  return o;
}

// 手部元件：毛茸茸、粗細漸變的短前肢＋像小手的前爪（指頭、半藏在毛裡的爪尖、立體明暗）。
function armPath(sx, sy, wx, wy, w1, w2, bend) {
  const dx = wx - sx, dy = wy - sy, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
  const mx = (sx + wx) / 2 + nx * bend, my = (sy + wy) / 2 + ny * bend, wm = (w1 + w2) / 2 + .6;
  const p = (x, y, s, w) => [x + nx * w * s, y + ny * w * s];
  const a1 = p(sx, sy, 1, w1 / 2), a2 = p(mx, my, 1, wm / 2), a3 = p(wx, wy, 1, w2 / 2);
  const b3 = p(wx, wy, -1, w2 / 2), b2 = p(mx, my, -1, wm / 2), b1 = p(sx, sy, -1, w1 / 2);
  const f = (q) => q.map((v) => v.toFixed(1)).join(' ');
  return { d: `M${f(a1)} Q${f(a2)} ${f(a3)} Q${wx + dx / L * w2 * .55} ${wy + dy / L * w2 * .55} ${f(b3)} Q${f(b2)} ${f(b1)} Z`,
    hi: `M${f(p(sx, sy, 1, w1 * .28))} Q${f(p(mx, my, 1, wm * .3))} ${f(p(wx, wy, 1, w2 * .25))}`, nx, ny };
}
// 前爪：以腕部 (x,y) 為原點、ang＝指尖方向（0＝朝下），s＝大小
function paw(id, x, y, ang, s = 1, o = {}) {
  const fingers = [-3, -1, 1, 3].map((fx, i) => {
    const fy = 9.6 + (i === 0 || i === 3 ? -.8 : 0);
    return `<ellipse cx="${fx}" cy="${fy}" rx="1.3" ry="1.75" fill="url(#pw${id})"/>
      <path d="M${fx - .85} ${fy + 1.1} Q${fx - .3} ${fy + 3} ${(fx + fx * .12).toFixed(2)} ${fy + 4.2} Q${fx + .75} ${fy + 2.8} ${fx + .85} ${fy + 1.1} Z" fill="#f6eddf" stroke="#6e5844" stroke-width=".35"/>`;
  }).join('');
  return `<g transform="translate(${x} ${y}) rotate(${ang}) scale(${s})">
    <path d="M-4.2 -1.5 C-5.2 2.5 -5 6.8 -4.2 9.2 L4.2 9.2 C5 6.8 5.2 2.5 4.2 -1.5 C2 -2.8 -2 -2.8 -4.2 -1.5 Z" fill="url(#pw${id})" filter="url(#pf${id})"/>
    ${fingers}
    <path d="M-2.8 7.4 Q0 6.4 2.8 7.4" fill="none" stroke="#a08066" stroke-width=".7" opacity=".55"/>
    <path d="M-2.2 1.6 Q0 .6 2.2 1.6" fill="none" stroke="#a08066" stroke-width=".6" opacity=".35"/>
    ${o.thumb ? `<ellipse cx="${o.thumb * 4.2}" cy="4.6" rx="1.3" ry="1.9" fill="url(#pw${id})"/>` : ``}
  </g>`;
}
function handDefs(id) {
  return `<linearGradient id="pw${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6e4f37"/><stop offset=".6" stop-color="#523826"/><stop offset="1" stop-color="#3d291b"/></linearGradient>
  <linearGradient id="am${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#88633f"/><stop offset=".45" stop-color="#ad8455"/><stop offset="1" stop-color="#7a5838"/></linearGradient>
  <filter id="pf${id}" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="9"/><feDisplacementMap in="SourceGraphic" scale="1.2" xChannelSelector="R" yChannelSelector="G"/></filter>`;
}
// 彎曲的手臂：沿三次貝茲曲線（肩→外推的手肘→往內收的手腕）取樣，寬度在手肘處略鼓，再接前爪
function bez(p, t) { const u = 1 - t; return [0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]); }
function tube(P, w1, w2, bulge) {
  const N = 16, L = [], R = [], H = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, c = bez(P, t), d0 = bez(P, Math.max(0, t - .02)), d1 = bez(P, Math.min(1, t + .02));
    let tx = d1[0] - d0[0], ty = d1[1] - d0[1]; const l = Math.hypot(tx, ty); tx /= l; ty /= l;
    const w = (w1 + (w2 - w1) * t + bulge * Math.sin(Math.PI * Math.min(1, t * 1.25))) / 2;
    L.push([c[0] - ty * w, c[1] + tx * w]); R.push([c[0] + ty * w, c[1] - tx * w]); H.push([c[0] - ty * w * .45, c[1] + tx * w * .45]);
  }
  const f = (q) => q[0].toFixed(1) + ' ' + q[1].toFixed(1), end = P[3], dir = [P[3][0] - P[2][0], P[3][1] - P[2][1]], dl = Math.hypot(...dir);
  const tip = [end[0] + dir[0] / dl * w2 * .5, end[1] + dir[1] / dl * w2 * .5];
  return { d: 'M' + L.map(f).join(' L') + ` Q${f(tip)} ${f(R[N])} L` + R.slice().reverse().map(f).join(' L') + ' Z',
    hi: 'M' + H.slice(1, N - 2).map(f).join(' L'), shade: 'M' + R.slice(2, N).map(f).join(' L') };
}
let _arm = 0;
function arm(id, P, pawAng, o = {}) {
  const T = tube(P, o.w1 || 10, o.w2 || 7, o.bulge == null ? 1 : o.bulge), side = o.side || 1, k = id + 'a' + (_arm++);
  const fadeTo = o.fadeTo || .38;
  return `<defs><linearGradient id="fd${k}" gradientUnits="userSpaceOnUse" x1="${P[0][0]}" y1="${P[0][1]}" x2="${P[3][0]}" y2="${P[3][1]}"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="${fadeTo}" stop-color="#fff" stop-opacity="1"/></linearGradient>
   <mask id="mk${k}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="200" height="240"><rect x="-20" y="-20" width="200" height="240" fill="url(#fd${k})"/></mask></defs>
   <g mask="url(#mk${k})">
   <path d="${T.d}" fill="#4a3a2e" opacity=".25" transform="translate(${1.4 * side} 2)" filter="url(#b1${id})"/>
   <path d="${T.d}" fill="url(#am${id})" filter="url(#fz${id})"/>
   <path d="${T.hi}" fill="none" stroke="#d8bd98" stroke-width="1.4" stroke-linecap="round" opacity=".45" filter="url(#b1${id})"/>
   <path d="${T.shade}" fill="none" stroke="#5a4232" stroke-width="1.4" stroke-linecap="round" opacity=".35" filter="url(#b1${id})"/></g>
   ${paw(id, P[3][0], P[3][1] - 1, pawAng, o.ps || .92, o)}`;
}
const mir = (P) => P.map(([x, y]) => [160 - x, y]);
const REST_L = [[64.5, 103], [64, 113], [68, 122], [75, 127.5]];
const HANDS = {
  rest: (id) => arm(id, REST_L, 10, { thumb: 1, side: -1 }) + arm(id, mir(REST_L), -10, { thumb: -1, side: 1 }),
  wave: (id) => arm(id, REST_L, 10, { thumb: 1, side: -1 }) + arm(id, [[94, 104], [110, 103], [120, 90], [117, 76]], 196, { thumb: -1, side: 1, fadeTo: .25, w1: 11 }),
  up: (id) => arm(id, [[66, 104], [50, 101], [42, 88], [45, 75]], 164, { thumb: 1, side: -1, fadeTo: .25, w1: 11 }) + arm(id, [[94, 104], [110, 101], [118, 88], [115, 75]], 196, { thumb: -1, side: 1, fadeTo: .25, w1: 11 }),
  cheek: (id) => arm(id, REST_L, 10, { thumb: 1, side: -1 }) + arm(id, [[94, 106], [108, 102], [109, 84], [101, 74]], 160, { thumb: -1, side: 1, fadeTo: .25, w1: 11 })
};

const DEFS = (id) => `<defs>
  <filter id="fz${id}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="3.4" xChannelSelector="R" yChannelSelector="G"/></filter>
  <filter id="b3${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3"/></filter><filter id="b1${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.2"/></filter>
  <linearGradient id="bg${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a7650"/><stop offset=".33" stop-color="#b0855a"/><stop offset=".55" stop-color="#b0936c"/><stop offset="1" stop-color="#cbb08a"/></linearGradient>
  <linearGradient id="bk${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#93704c"/><stop offset=".3" stop-color="#a37a52"/><stop offset=".6" stop-color="#a38a6a"/><stop offset="1" stop-color="#b9a283"/></linearGradient>
  <radialGradient id="ns${id}" cx="40%" cy="28%" r="75%"><stop offset="0" stop-color="#6f7580"/><stop offset=".35" stop-color="#2e3138"/><stop offset="1" stop-color="#121316"/></radialGradient>
  <linearGradient id="tl${id}" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#94734f"/><stop offset=".6" stop-color="#7a5c40"/><stop offset="1" stop-color="#5e4632"/></linearGradient>
  ${handDefs(id)}
</defs>`;
const PAW = '#4a3b30', FOOT = '#5a4a3d', BAND = 'var(--band, #e5533d)';
const ER = 4.1;
function eye(x, y, id, o = {}) {
  const r = ER * (o.scale || 1);
  return `<ellipse cx="${x}" cy="${y}" rx="${r + 1}" ry="${r * .95 + .9}" fill="#3e3127" opacity=".45" filter="url(#b1${id})"/>
   <g class="eye"><ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * .92}" fill="#121014"/>
   <path d="M${x - r * .62} ${y - r * .05} Q${x} ${y - r * .85} ${x + r * .62} ${y - r * .12}" fill="none" stroke="#8fbbe8" stroke-width="${r * .32}" stroke-linecap="round"/>
   <circle cx="${x + r * .32}" cy="${y - r * .32}" r="${r * .28}" fill="#fff"/><circle cx="${x - r * .38}" cy="${y + r * .38}" r="${r * .13}" fill="#fff" opacity=".85"/></g>`;
}
const CLAW = (x, y, ang, len = 3.6) => `<path transform="translate(${x} ${y}) rotate(${ang})" d="M-1 0 Q-.35 ${len * .62} .35 ${len} Q.85 ${len * .55} 1 0 Z" fill="#f6eddf" stroke="#6e5844" stroke-width=".35"/>`;
const SIDEARMS = (id) => arm(id, [[103, 102], [106, 112], [110, 119], [115.5, 124]], -18, { thumb: -1, side: 1, fadeTo: .3 });
const F34ARMS = (id) => arm(id, [[77, 104], [78, 113], [84, 121.5], [91.5, 127.5]], 12, { thumb: 1, side: -1, w2: 6.2 }) + arm(id, [[100, 104], [102, 113], [102, 121], [100.5, 127.5]], -4, { thumb: -1, side: 1 });
// 尾巴：根部從身體裡漸漸浮現（遮罩漸層），邊緣與身體同樣毛絨
function softTail(id, key, d, x1, y1, x2, y2, fadeTo = .3) {
  return `<defs><linearGradient id="tf${id}${key}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="${fadeTo}" stop-color="#fff" stop-opacity="1"/></linearGradient>
  <mask id="tm${id}${key}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="200" height="240"><rect x="-20" y="-20" width="200" height="240" fill="url(#tf${id}${key})"/></mask></defs>
  <g mask="url(#tm${id}${key})"><path d="${d}" fill="url(#tl${id})" filter="url(#fz${id})"/></g>`;
}
const SIDECLAWS = () => [[122.6, 167.6, -78], [123.8, 170.4, -86], [123.2, 173.2, -94]].map(([x, y, a]) => CLAW(x, y, a, 3.2)).join('');
const F34CLAWS = () => [[105.5, 181.6, -28], [109.4, 181, -40], [112.6, 179, -55], [76.5, 179.6, -25], [80.2, 178.6, -40]].map(([x, y, a]) => CLAW(x, y, a, 3.1)).join('');

const SHADE = (id, cx) => `
    <ellipse cx="${cx}" cy="19" rx="26" ry="9" fill="#7c6244" opacity=".5" filter="url(#b3${id})"/>
    <ellipse cx="46" cy="62" rx="7" ry="22" fill="#76604a" opacity=".5" filter="url(#b3${id})"/>
    <ellipse cx="${cx}" cy="80" rx="32" ry="6" fill="#6a5c4e" opacity=".35" filter="url(#b3${id})"/>`;


function side(id) {
  return `<svg viewBox="0 0 160 196" xmlns="http://www.w3.org/2000/svg">${DEFS(id)}<clipPath id="c${id}"><path d="${SIDE}"/></clipPath>
  <!-- 細長、幾乎無毛的尾巴，沿地面往後拖（約頭身長 60%） -->
  <path d="M66 155 C50 161 32 166.5 14 169.4 C11 169.9 10.6 172.2 13.6 172.4 C32 173 50 172.6 68 170 Z" fill="url(#tl${id})" filter="url(#fz${id})"/>
  <!-- 遠側（另一隻）後腳，略偏前、較暗 -->
  <path d="M86 167 C98 166.5 112 167 126 169.5 C129.4 170.6 128.6 173.4 125 173.4 L84 173.4 Z" fill="#43372d" filter="url(#fz${id})"/>
  ${[[128.2, 169.6, -82], [128.4, 172, -92]].map(([x, y, a]) => CLAW(x, y, a, 2.6)).join('')}
  <!-- 遠側耳朵 -->
  <ellipse cx="93" cy="19" rx="5" ry="6.5" fill="#8a6a4b" filter="url(#fz${id})"/>
  <path d="${SIDE}" fill="url(#bg${id})" filter="url(#fz${id})"/>
  <g clip-path="url(#c${id})">
    <!-- 背部較深、頭頸偏暖褐、腹部較淺 -->
    <ellipse cx="58" cy="100" rx="10" ry="70" fill="#76604a" opacity=".5" filter="url(#b3${id})"/>
    <ellipse cx="96" cy="44" rx="22" ry="22" fill="#b38a5e" opacity=".55" filter="url(#b3${id})"/>
    <ellipse cx="113" cy="58" rx="11" ry="8" fill="#dfa65e" opacity=".8" filter="url(#b3${id})"/>
    <ellipse cx="110" cy="68" rx="7" ry="4" fill="#f3e2c4" opacity=".8" filter="url(#b3${id})"/>
    <ellipse cx="112" cy="132" rx="10" ry="30" fill="#f0dcb9" opacity=".85" filter="url(#b3${id})"/>
    <!-- 粗壯的大腿 -->
    <ellipse cx="78" cy="150" rx="24" ry="20" fill="#9a7a58" opacity=".35" filter="url(#b3${id})"/>
    <ellipse cx="74" cy="140" rx="18" ry="6" fill="#d9bf98" opacity=".25" filter="url(#b3${id})"/>
    ${fur(1050, 48, 124, 23)}
  </g>
  <!-- 近側耳朵：短而圓 -->
  <g filter="url(#fz${id})"><ellipse cx="82" cy="22" rx="7" ry="8.5" fill="#b38a5e"/><ellipse cx="83" cy="23" rx="4.4" ry="5.8" fill="#f2c38c"/><ellipse cx="83.6" cy="24.4" rx="2.4" ry="3.4" fill="#8a7460"/></g>
  <!-- 頭帶繞過額頭到後腦 -->
  <path d="M68 37 Q90 26 112 30 L110 24 Q88 20 69 31 Z" fill="${BAND}"/>
  <ellipse cx="104" cy="56.5" rx="5" ry="3.4" fill="#f0907c" opacity=".3" filter="url(#b1${id})"/>
  ${eye(106, 41.5, id)}
  <!-- 鼻子在口鼻最前端，嘴角往後上揚 -->
  <path d="M118 47.5 C122 46.5 126 49 126 53 C126 56.5 123 58.5 120 58 C117.6 57.2 116.6 52.5 118 47.5 Z" fill="url(#ns${id})"/>
  <ellipse cx="121.5" cy="49.5" rx="1.8" ry="1" fill="#c9d6e6" opacity=".5"/>
  <path d="M123.4 54.6 Q124.6 54 125.2 55.2" fill="none" stroke="#000" stroke-width=".7" opacity=".6"/>
  <path d="M120 58.2 Q117 62 112.5 61.6 Q110.4 61.3 109.6 59.4" fill="none" stroke="#2a211b" stroke-width="1.4" stroke-linecap="round"/>
  <!-- 近側後腳：長而平貼地面 -->
  <path d="M62 166 C60 170 62 174 68 174.4 L116 174.6 C121.4 174.6 124.6 172.4 124 169.8 C123.4 167.2 119 165.8 114 165.4 C100 164.2 80 163.2 70 163.4 C65 163.6 63 164.4 62 166 Z" fill="${FOOT}" filter="url(#fz${id})"/>
  <ellipse cx="72" cy="168" rx="9" ry="4.4" fill="#6b5847" opacity=".5" filter="url(#b1${id})"/>
  ${SIDECLAWS()}
  <path d="M114.5 166.6 L120 167.6 M115 169.6 L121.6 170.2 M115 172.4 L121 172.8" stroke="#2f2620" stroke-width=".55" opacity=".55" stroke-linecap="round"/>
  ${SIDEARMS(id)}
  </svg>`;
}


function back(id) {
  return `<svg viewBox="0 0 160 196" xmlns="http://www.w3.org/2000/svg">${DEFS(id)}<clipPath id="c${id}"><path d="${BACK}"/></clipPath>
  <!-- 腳跟：從背後看是兩個腳跟，腳掌往前延伸看不到 -->
  <g filter="url(#fz${id})"><ellipse cx="60" cy="172" rx="10" ry="5" fill="#43372d"/><ellipse cx="100" cy="172" rx="10" ry="5" fill="#43372d"/></g>
  <!-- 耳背：沒有淺色內耳 -->
  <g filter="url(#fz${id})"><ellipse cx="56.2" cy="22" rx="7" ry="8" fill="#93744f"/><ellipse cx="103.8" cy="22" rx="7" ry="8" fill="#93744f"/></g>
  <path d="${BACK}" fill="url(#bk${id})" filter="url(#fz${id})"/>
  <g clip-path="url(#c${id})">
    <!-- 頭頸背面帶紅褐、背中線較深、兩側臀部隆起 -->
    <ellipse cx="80" cy="50" rx="30" ry="26" fill="#b07f52" opacity=".45" filter="url(#b3${id})"/>
    <ellipse cx="80" cy="80" rx="20" ry="5" fill="#68533e" opacity=".15" filter="url(#b3${id})"/>
    <ellipse cx="80" cy="118" rx="9" ry="44" fill="#68533e" opacity=".2" filter="url(#b3${id})"/>
    <ellipse cx="58" cy="148" rx="18" ry="22" fill="#ad9878" opacity=".6" filter="url(#b3${id})"/><ellipse cx="102" cy="148" rx="18" ry="22" fill="#ad9878" opacity=".6" filter="url(#b3${id})"/>
    <ellipse cx="40" cy="120" rx="6" ry="40" fill="#78614a" opacity=".45" filter="url(#b3${id})"/><ellipse cx="120" cy="120" rx="6" ry="40" fill="#78614a" opacity=".45" filter="url(#b3${id})"/>
    ${fur(1150, 36, 124, 37)}
  </g>
  <!-- 頭帶背面：打結、兩條帶尾垂下 -->
  <path d="M49.5 34 Q80 41 110.5 34 L110 28 Q80 35 50 28 Z" fill="${BAND}"/>
  <path d="M77 37 Q74 46 70 52 L73 53 Q77 47 80 38 Z M83 37 Q86 46 90 52 L87 53 Q83 47 80 38 Z" fill="#c9432f"/>
  <ellipse cx="80" cy="36.5" rx="3.6" ry="3" fill="#d24a35"/>
  <!-- 尾巴：從臀部中央垂下，貼地往後（朝觀者）延伸，前縮變短 -->
  <ellipse cx="80" cy="183" rx="6.5" ry="2.2" fill="#000" opacity=".14" filter="url(#b1${id})"/>
  ${softTail(id, 'b', 'M73.5 154 C73 166 74 175 75.6 181.5 C76.8 185.6 83.2 185.6 84.4 181.5 C86 175 87 166 86.5 154 Z', 80, 154, 80, 184, .4)}
  </svg>`;
}


function f34(id) {
  return `<svg viewBox="0 0 160 196" xmlns="http://www.w3.org/2000/svg">${DEFS(id)}<clipPath id="c${id}"><path d="${F34}"/></clipPath>
  <!-- 尾巴往左後方沿地面拖 -->
  <path d="M62 156 C49 162 35 166 22 168.2 C19 168.7 18.6 170.8 21.6 171 C36 171.6 49 171 64 168.4 Z" fill="url(#tl${id})" filter="url(#fz${id})"/>
  <!-- 遠側耳（左，大半被頭擋住）、近側耳（往中間移，約 x90） -->
  <g filter="url(#fz${id})"><ellipse cx="56" cy="21.5" rx="6.4" ry="7.8" fill="#9a7a55"/><ellipse cx="56.8" cy="22.6" rx="3.8" ry="5" fill="#e5bb87"/></g>
  <g filter="url(#fz${id})"><ellipse cx="90" cy="19.5" rx="7" ry="8.2" fill="#b38a5e"/><ellipse cx="90.6" cy="20.6" rx="4.5" ry="5.6" fill="#f2c38c"/><ellipse cx="91.2" cy="21.8" rx="2.5" ry="3.4" fill="#8a7460"/></g>
  <!-- 遠側腳（大半在身體後面） -->
  <g filter="url(#fz${id})"><path d="M60 167 C68 166 78 168 84 173 C86 177 82 180 76 179.6 C68 179 61 176 58 172 Z" fill="${FOOT}"/></g>
  <path d="${F34}" fill="url(#bg${id})" filter="url(#fz${id})"/>
  <g clip-path="url(#c${id})">
    <ellipse cx="78" cy="19" rx="26" ry="9" fill="#7c6244" opacity=".45" filter="url(#b3${id})"/>
    <!-- 遠側（左）較暗，近側（右）受光 -->
    <ellipse cx="45" cy="100" rx="9" ry="70" fill="#76604a" opacity=".5" filter="url(#b3${id})"/>
    <ellipse cx="99" cy="61" rx="20" ry="13" fill="#dfa65e" opacity=".85" filter="url(#b3${id})"/>
    <ellipse cx="104" cy="67.5" rx="9" ry="5" fill="#f3e2c4" opacity=".9" filter="url(#b3${id})"/>
    <ellipse cx="78" cy="80" rx="30" ry="6" fill="#68533e" opacity=".3" filter="url(#b3${id})"/>
    <ellipse cx="96" cy="108" rx="13" ry="12" fill="#f0dcb9" opacity=".5" filter="url(#b3${id})"/>
    <ellipse cx="92" cy="150" rx="26" ry="26" fill="#f0dcb9" opacity=".88" filter="url(#b3${id})"/>
    <ellipse cx="52" cy="148" rx="11" ry="22" fill="#8a7258" opacity=".5" filter="url(#b3${id})"/>
    <path d="${F34}" fill="none" stroke="#fff6e6" stroke-width="3" opacity=".3" filter="url(#b1${id})"/>
    ${fur(1100, 38, 118, 51)}
  </g>
  <!-- 頭帶繞頭，結在左後方看不到 -->
  <path d="M49 35.5 Q78 24.5 108.6 33 L108 27 Q78 18 49.5 29.5 Z" style="fill: var(--band, #e5533d)"/>
  <ellipse cx="86.5" cy="56.5" rx="6" ry="3.8" fill="#f0907c" opacity=".3" filter="url(#b1${id})"/><ellipse cx="110.5" cy="56" rx="4" ry="3.6" fill="#f0907c" opacity=".3" filter="url(#b1${id})"/>
  <!-- 遠側眼較窄、近側眼完整 -->
  <g transform="translate(81 42.6) scale(.78 1) translate(-81 -42.6)">${eye(81, 42.6, id)}</g>
  ${eye(99, 42.2, id)}
  <!-- 鼻子：往右前方突出，右側輪廓較尖 -->
  <ellipse cx="105" cy="54" rx="7.4" ry="6.2" fill="#3b2f26" opacity=".4" filter="url(#b1${id})"/>
  <path d="M98.8 50.8 C99 46.8 110.4 46.8 111.8 50.6 C112.6 54.4 109.8 57.6 106.8 58.4 L105.6 58.8 L104.6 58.4 C101.4 57.6 98.6 54.8 98.8 50.8 Z" fill="url(#ns${id})"/>
  <ellipse cx="102.8" cy="49.3" rx="2.4" ry="1.1" fill="#d4dfec" opacity=".5"/>
  <path d="M102.4 55 Q103.5 53.9 104.6 55.1 M107.8 55 Q109.1 53.9 110.2 54.9" fill="none" stroke="#000" stroke-width=".8" opacity=".6"/>
  <!-- 招牌微笑：遠側嘴角較長、近側嘴角繞到臉頰 -->
  <path d="M105.4 58.8 V62 M94 58.6 Q97.6 65 101.8 64.2 Q104.4 63.6 105.4 62 Q106.4 63.6 108.2 63.6 Q110.4 63.4 111.6 59" fill="none" stroke="#2a211b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  ${F34ARMS(id)}
  <!-- 近側腳：腳趾朝右前方 -->
  <g filter="url(#fz${id})"><path d="M86 166 C96 165 108 168 114 174 C117 178 113 182 107 181.5 C97 181 88 178 84 174 Z" fill="${FOOT}"/></g>
  ${F34CLAWS()}
  <path class="sniff-lines" display="none" d="M120 44 Q124 42 126 45 M121 50 Q126 49 128 52 M120 56 Q124 57 126 60" fill="none" stroke="#9aa0a8" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`;
}

function b34(id) {
  return `<svg viewBox="0 0 160 196" xmlns="http://www.w3.org/2000/svg">${DEFS(id)}<clipPath id="c${id}"><path d="${B34}"/></clipPath>
  <!-- 耳背：近側往中間（x90）、遠側在左 -->
  <g filter="url(#fz${id})"><ellipse cx="56" cy="21.5" rx="7" ry="8" fill="#93744f"/><ellipse cx="90" cy="19.5" rx="6.6" ry="7.8" fill="#8d6f4f"/></g>
  <!-- 腳：腳跟在身體下方，近側腳的腳趾從右下方露出來 -->
  <g filter="url(#fz${id})"><ellipse cx="56" cy="172.6" rx="8.5" ry="4.6" fill="#43372d"/>
    <path d="M72 168 C86 166 104 169 115 174 C118 177 115 180.4 108 180 C96 179.4 82 178.4 72 176.4 C67.6 175 67.6 169 72 168 Z" fill="${FOOT}"/></g>
  <path d="${B34}" fill="url(#bk${id})" filter="url(#fz${id})"/>
  <g clip-path="url(#c${id})">
    <ellipse cx="70" cy="50" rx="28" ry="26" fill="#b07f52" opacity=".45" filter="url(#b3${id})"/>
    <!-- 背中線在左側（約 x60），右緣露出一點臉頰與腹部的淺色 -->
    <ellipse cx="60" cy="118" rx="6" ry="46" fill="#68533e" opacity=".38" filter="url(#b3${id})"/>
    <ellipse cx="110.5" cy="58" rx="7" ry="14" fill="#dfa65e" opacity=".6" filter="url(#b3${id})"/>
    <ellipse cx="111" cy="66" rx="4" ry="6" fill="#f3e2c4" opacity=".6" filter="url(#b3${id})"/>
    <ellipse cx="110" cy="140" rx="8" ry="28" fill="#d2bf9e" opacity=".6" filter="url(#b3${id})"/>
    <ellipse cx="52" cy="148" rx="15" ry="22" fill="#ad9878" opacity=".55" filter="url(#b3${id})"/><ellipse cx="90" cy="150" rx="17" ry="22" fill="#ad9878" opacity=".5" filter="url(#b3${id})"/>
    <ellipse cx="45" cy="120" rx="6" ry="40" fill="#78614a" opacity=".45" filter="url(#b3${id})"/>
    ${fur(1100, 38, 116, 63)}
  </g>
  <!-- 臉頰外緣的鬍鬚（口鼻轉到後面，只露出這一點） -->
  <path d="M111 50 l4 -1.2 M111.8 53.5 l4.6 .2 M111.2 57 l4 1.6" stroke="#4a3b30" stroke-width=".5" opacity=".55" stroke-linecap="round"/>
  <!-- 頭帶背面：結在後腦正中（投影到約 x62） -->
  <path d="M49.5 31 Q66 37 108.6 30 L108 24.5 Q66 31 50 25 Z" style="fill: var(--band, #e5533d)"/>
  <path d="M59 34 Q56 43 52 49 L55 50 Q59 44 62 35 Z M65 34 Q68 43 72 49 L69 50 Q65 44 62 35 Z" fill="#c9432f"/>
  <ellipse cx="62" cy="33.4" rx="3.4" ry="2.8" fill="#d24a35"/>
  ${[[112.2, 178.4, -62], [115.4, 176.6, -75]].map(([x, y, a]) => CLAW(x, y, a, 3)).join('')}
  <!-- 尾巴：從臀部往左前方（朝觀者）沿地面拖出 -->
  ${softTail(id, 'q', 'M57 150 C54 162 45 171 30 177.4 C26.8 178.8 27.6 181.8 31 181.2 C50 177.8 63 168 70 153 Z', 64, 150, 30, 180, .32)}
  </svg>`;
}


// ===========================================================================
// 3D 代理模型：身體由橢球組成，任意角度正交投影成 2D（16 方位都由這裡產生，彼此必定一致）。
// 座標：x 右、y 下（同 SVG）、z 朝觀者（正面時）。θ＝轉向角：0 正面、90 右側（口鼻朝右）、180 背面、-90 左側。
// 尺寸依參考照片（正面量測）與 iNaturalist 開放授權照片（斜角、側面）校正：梨形身材、圓臉頰、口鼻斜角時突出。
// ===========================================================================
const Q3_BASE = [
  // [名稱, cx, cy, cz, rx, ry, rz]
  ['thighL', -30, 148, -6, 17, 21, 25], ['thighR', 30, 148, -6, 17, 21, 25],
  ['hips', 0, 140, -1, 46, 34, 34],
  ['rump', 0, 158, -5, 41, 16, 30],
  ['chest', 0, 106, -1, 32, 28, 28],
  ['neck', 0, 84, -3, 30, 20, 24],
  ['head', 0, 45, -2, 31, 30, 25],
  ['cheekL', -21, 62, 5, 15, 13.5, 15], ['cheekR', 21, 62, 5, 15, 13.5, 15],
  ['snout', 0, 56.5, 21, 11, 9, 18],
  ['snoutTip', 0, 55, 34, 7, 6.5, 7]
];
let _views = null;
let Q3 = Q3_BASE, TAILK = 1, EARK = 1, TRAITS = null;
const TR = () => (typeof window !== 'undefined' && window.QuokkaTraits) ? window.QuokkaTraits
  : (typeof require === 'function' ? require('./traits.js') : null);
// 套用個體特徵（體型胖瘦、臉頰、耳朵、尾長、毛色）；之後產生的所有圖都會用這組特徵
function configure(traits) {
  TRAITS = traits || null; _views = null;
  const sh = traits && TR() ? TR().shape(traits) : null;
  if (!sh) { Q3 = Q3_BASE; TAILK = 1; EARK = 1; return; }
  const w = sh.widthK, c = sh.cheekK, k = (f) => 1 + (w - 1) * f;
  Q3 = Q3_BASE.map(([n, x, y, z, rx, ry, rz]) => {
    if (n === 'hips' || n === 'rump') return [n, x, y, z, rx * w, ry, rz * w];
    if (n.startsWith('thigh')) return [n, x * k(.8), y, z, rx * w, ry, rz * w];
    if (n === 'chest') return [n, x, y, z, rx * k(.6), ry, rz * k(.6)];
    if (n === 'neck') return [n, x, y, z, rx * k(.3), ry, rz * k(.3)];
    if (n.startsWith('cheek')) return [n, x * (1 + (c - 1) * .5), y, z, rx * c, ry * c, rz * c];
    return [n, x, y, z, rx, ry, rz];
  });
  TAILK = sh.tailK; EARK = sh.earK;
}
const paint = (svg) => (TRAITS && TR() ? TR().recolor(svg, TRAITS) : svg);
const rad = (a) => a * Math.PI / 180;
function q3proj(p, th) {
  const c = Math.cos(rad(th)), s = Math.sin(rad(th));
  return { X: 80 + p[0] * c + p[2] * s, Y: p[1], Z: -p[0] * s + p[2] * c };
}
// 朝向觀者的程度：法向量投影到深度方向（與 q3proj 的 Z 一致；+x 那側在轉向右時會轉到後面）
const q3facing = (n, th) => -n[0] * Math.sin(rad(th)) + n[2] * Math.cos(rad(th));
// 身體輪廓：逐列取所有橢球投影的最外緣，再平滑成一條連續曲線
function q3outline(th) {
  const c = Math.cos(rad(th)), s = Math.sin(rad(th));
  const E = Q3.map(([, x, y, z, rx, ry, rz]) => ({ cx: 80 + x * c + z * s, cy: y, rx: Math.hypot(rx * c, rz * s), ry }));
  const rows = [];
  for (let y = 12; y <= 180; y += 1) {
    let L = Infinity, R = -Infinity;
    for (const e of E) { const d = (y - e.cy) / e.ry; if (Math.abs(d) < 1) { const h = e.rx * Math.sqrt(1 - d * d); L = Math.min(L, e.cx - h); R = Math.max(R, e.cx + h); } }
    if (R > L) rows.push([y, L, R]);
  }
  const sm = (k) => rows.map((r0, i) => { let w = 0, v = 0; for (let j = -9; j <= 9; j++) { const q = rows[i + j]; if (!q) continue; const ww = Math.exp(-(j * j) / 28); w += ww; v += q[k] * ww; } return v / w; });
  const Ls = sm(1), Rs = sm(2), pts = [];
  for (let i = 0; i < rows.length; i += 3) pts.push([Rs[i], rows[i][0]]);
  pts.push([Rs[rows.length - 1], rows[rows.length - 1][0]]);
  for (let i = rows.length - 1; i >= 0; i -= 3) pts.push([Ls[i], rows[i][0]]);
  return cr(pts);
}
// 依角度畫出完整的庫卡（靜態方位用）。opts.front＝只回傳身體層（給分層正面用）
function q3render(th, id, opts = {}) {
  const c = Math.cos(rad(th)), s = Math.sin(rad(th)), P = (p) => q3proj(p, th), f1 = (v) => v.toFixed(1);
  const outline = q3outline(th);
  // 尾巴：由粗到細，從臀部往後沿地面拖；正背面時只看到朝觀者的一小截
  const tq = [[0, 158, -26, 6.5], [0, 164, -40, 5.4], [0, 168, -54, 4.4], [0, 170.5, -68, 3.4], [0, 171.5, -80, 2.4]].map(([x, y, z, r]) => ({ ...P([x, y, -26 + (z + 26) * TAILK]), r }));
  let tail = '', tailFront = false;
  if (Math.abs(tq[0].X - tq[4].X) < 6) {
    if (c < 0) { tailFront = true; const x = tq[0].X; tail = `<ellipse cx="${f1(x)}" cy="183" rx="6.5" ry="2.2" fill="#000" opacity=".14" filter="url(#b1${id})"/><path d="M${f1(x - 6)} 156 C${f1(x - 6.4)} 168 ${f1(x - 5)} 177 ${f1(x - 3.6)} 181.5 C${f1(x - 2.4)} 185.6 ${f1(x + 2.4)} 185.6 ${f1(x + 3.6)} 181.5 C${f1(x + 5)} 177 ${f1(x + 6.4)} 168 ${f1(x + 6)} 156 Z" fill="url(#tl${id})" filter="url(#fz${id})"/>`; }
  } else {
    const up = tq.map((q) => [q.X, q.Y - q.r * .85]), dn = tq.map((q) => [q.X, q.Y + q.r * .85]).reverse();
    tail = `<path d="M${up.concat(dn).map((p) => f1(p[0]) + ' ' + f1(p[1])).join(' L')} Z" fill="url(#tl${id})" stroke="url(#tl${id})" stroke-width="2" stroke-linejoin="round" filter="url(#fz${id})"/>`;
    tailFront = P([0, 165, -45]).Z > 0;
  }
  // 耳朵：圓而大、在頭頂偏後；朝前時露出淺色內耳
  const ears = [-1, 1].map((k) => {
    const q = P([k * 22, 19, -12]), f = q3facing([k * .3, 0, 1], th), w = 9 * (0.5 + 0.5 * Math.abs(f));
    const inner = f > 0.15 ? `<ellipse cx="${f1(q.X)}" cy="20.6" rx="${f1(w * .62)}" ry="6.8" fill="#f2c38c"/><ellipse cx="${f1(q.X)}" cy="21.8" rx="${f1(w * .35)}" ry="4" fill="#8a7460"/>` : '';
    return `<g class="ear" filter="url(#fz${id})" transform="translate(${f1(q.X)} 27) scale(${EARK}) translate(${f1(-q.X)} -27)"><ellipse cx="${f1(q.X)}" cy="19" rx="${f1(w)}" ry="10.5" fill="${f > 0 ? '#b38a5e' : '#93744f'}"/>${inner}</g>`;
  }).join('');
  // 腳：長腳掌，腳尖有小爪子
  const feet = [-1, 1].map((k) => {
    const heel = P([k * 18, 172, -10]), toe = P([k * 18, 173, 30]), fr = Math.abs(c);
    const cx = (toe.X + heel.X) / 2, rx = Math.max(10.5, Math.abs(toe.X - heel.X) / 2 + 6), cy = 171.5 + 5.5 * fr;
    const claws = toe.Z > -5 ? [-3.6, 0, 3.6].map((d) => {
      const tx = toe.X + d * fr + (s > 0 ? 3 : s < 0 ? -3 : 0) * (1 - fr), ty = fr > .7 ? cy + 6.5 : cy + d * .55;
      return CLAW(f1(tx), f1(ty), f1(-90 * s * (1 - fr * .2)), 3);
    }).join('') : '';
    return { z: P([k * 18, 172, 10]).Z, svg: `<g filter="url(#fz${id})"><ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(rx)}" ry="${f1(4.6 + 4 * fr)}" fill="${FOOT}"/></g>${claws}` };
  });
  // 身體明暗（clip 在輪廓內）
  const belly = P([0, 142, 33]), bF = q3facing([0, 0, 1], th), back = P([0, 110, -30]), muz = P([0, 60, 29]), side = Math.sign(s) || 1;
  const shade = `
    <ellipse cx="${f1(P([0, 22, -2]).X)}" cy="20" rx="26" ry="9" fill="#7c6244" opacity=".4" filter="url(#b3${id})"/>
    ${bF > -0.3 ? `<ellipse cx="${f1(belly.X)}" cy="146" rx="${f1(14 + 24 * Math.max(0, bF))}" ry="28" fill="#f0dcb9" opacity="${(0.9 * Math.min(1, bF + .5)).toFixed(2)}" filter="url(#b3${id})"/>` : ''}
    ${bF < 0.3 ? `<ellipse cx="${f1(back.X)}" cy="112" rx="9" ry="50" fill="#68533e" opacity=".2" filter="url(#b3${id})"/>` : ''}
    ${bF > -0.2 ? `<ellipse cx="${f1(muz.X)}" cy="62" rx="${f1(12 + 18 * Math.max(0, c))}" ry="15" fill="#dfa65e" opacity=".85" filter="url(#b3${id})"/><ellipse cx="${f1(P([0, 68, 30]).X)}" cy="68" rx="${f1(7 + 7 * Math.max(0, c))}" ry="6" fill="#f3e2c4" opacity=".85" filter="url(#b3${id})"/>` : ''}
    <ellipse cx="${f1(80 - 42 * side * Math.abs(s))}" cy="112" rx="12" ry="70" fill="#76604a" opacity="${(0.32 * Math.abs(s)).toFixed(2)}" filter="url(#b3${id})"/>
    <path d="${outline}" fill="none" stroke="#fff6e6" stroke-width="3" opacity=".3" filter="url(#b1${id})"/>
    ${fur(1150, 30, 130, 11)}`;
  const body = `<path d="${outline}" fill="url(#bg${id})" filter="url(#fz${id})"/><g clip-path="url(#c${id})">${shade}</g>`;
  if (opts.front) return { outline, body, tail: tailFront ? '' : tail };
  // 頭帶：沿頭在該高度的截面繞一圈，只畫朝觀者的半圈；背面看得到結
  const ring = [];
  for (let a = 0; a <= 360; a += 6) { const r = rad(a); ring.push(P([27.6 * Math.sin(r), 30 - 2.4 * Math.cos(r), -2 + 22.4 * Math.cos(r)])); }
  const vis = ring.filter((q) => q.Z > -1.5);
  const band = vis.length > 1 ? `<path d="M${vis.map((q) => f1(q.X) + ' ' + f1(q.Y)).join(' L')}" fill="none" style="stroke: var(--band, #e5533d)" stroke-width="6.4"/>` : '';
  const kn = P([0, 31, -27.5]);
  const knot = kn.Z > 0 ? `<path transform="translate(${f1(kn.X)} 0)" d="M-3 34 Q-6 43 -10 49 L-7 50 Q-3 44 0 35 Z M3 34 Q6 43 10 49 L7 50 Q3 44 0 35 Z" style="fill: var(--band, #e5533d)"/><path transform="translate(${f1(kn.X)} 0)" d="M-3 34 Q-6 43 -10 49 L-7 50 Q-3 44 0 35 Z M3 34 Q6 43 10 49 L7 50 Q3 44 0 35 Z" fill="#000" opacity=".15"/><ellipse cx="${f1(kn.X)}" cy="33" rx="${f1(3.4 * (0.5 + 0.5 * Math.abs(c)))}" ry="2.8" style="fill: var(--band, #e5533d)"/>` : '';
  // 五官：每個部位都有 3D 位置，轉開時自動變窄、移位或消失
  const face = [];
  for (const k of [-1, 1]) {
    const e = P([k * 13, 43, 19]), f = q3facing([k * .42, 0, .9], th);
    if (f > 0.05) face.push(`<g transform="translate(${e.X.toFixed(2)} 43) scale(${(0.35 + 0.65 * f).toFixed(2)} 1) translate(${(-e.X).toFixed(2)} -43)">${eye(e.X, 43, id)}</g>`);
    const b = P([k * 20, 57, 15]), fb = q3facing([k * .6, 0, .8], th);
    if (fb > 0.1) face.push(`<ellipse cx="${f1(b.X)}" cy="57" rx="${f1(6.5 * fb)}" ry="4" fill="#f0907c" opacity=".3" filter="url(#b1${id})"/>`);
  }
  if (q3facing([0, 0, 1], th) > -0.25) {
    const n = P([0, 53, 36 + 3 * Math.abs(s)]), w = 6.8 * (0.62 + 0.38 * Math.abs(c));
    face.push(`<ellipse cx="${f1(n.X)}" cy="53" rx="${f1(w)}" ry="5.8" fill="url(#ns${id})"/><ellipse cx="${f1(n.X - w * .35)}" cy="50.5" rx="${f1(w * .38)}" ry="1.2" fill="#d4dfec" opacity=".5"/>`);
    const mp = [[-9.5, 59, 25], [-4.6, 63.6, 30.5], [0, 61.4, 33], [4.6, 63.6, 30.5], [9.5, 59, 25]].map((p) => ({ q: P(p), f: q3facing([p[0] / 20, 0, 1], th) })).filter((m) => m.f > -0.1);
    if (mp.length > 1) face.push(`<path d="M${f1(mp[0].q.X)} ${f1(mp[0].q.Y)} ${mp.slice(1).map((m, i) => { const a = mp[i].q, b = m.q; return 'Q' + f1((a.X + b.X) / 2) + ' ' + f1(Math.max(a.Y, b.Y) + 1.2) + ' ' + f1(b.X) + ' ' + f1(b.Y); }).join(' ')}" fill="none" stroke="#2a211b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M${f1(n.X)} 58.6 V61.2" stroke="#2a211b" stroke-width="1.3"/>`);
    if (Math.abs(s) > .5) face.push(`<path class="sniff-lines" display="none" d="M${f1(n.X + side * 6)} 47 q${side * 4} -2 ${side * 6} 1 M${f1(n.X + side * 7)} 53 q${side * 5} -1 ${side * 7} 2 M${f1(n.X + side * 6)} 59 q${side * 4} 1 ${side * 6} 4" fill="none" stroke="#9aa0a8" stroke-width="1.2" stroke-linecap="round"/>`);
  }
  // 手：從胸前伸出、合在胸前；轉到背面看不到
  const arms = [-1, 1].map((k) => {
    if (q3facing([k * .5, 0, .85], th) < 0.3) return '';
    const sh = P([k * 15, 103, 20]), el = P([k * 17, 114, 25]), wr = P([k * 6, 127, 30]);
    return arm(id, [[sh.X, 103], [el.X, 113], [(el.X + wr.X) / 2, 122], [wr.X, 127.5]], f1(-k * 10 * c), { thumb: k, side: k });
  }).join('');
  const feetB = feet.filter((q) => q.z < 0).map((q) => q.svg).join(''), feetF = feet.filter((q) => q.z >= 0).map((q) => q.svg).join('');
  return `<svg viewBox="0 0 160 196" class="view-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${DEFS(id).replace(/<linearGradient id="bg[^>]*>/, `<linearGradient id="bg${id}" gradientUnits="userSpaceOnUse" x1="0" y1="14" x2="0" y2="176">`)}
  <clipPath id="c${id}"><path d="${outline}"/></clipPath>
  ${tailFront ? '' : tail}${feetB}${ears}
  ${body}
  ${feetF}${tailFront ? tail : ''}
  ${band}${knot}${face.join('')}${arms}
</svg>`;
}

// ---------------------------------------------------------------------------
// 正面（分層）：所有可切換的部件都在同一張 SVG，預設隱藏者帶 display="none"，
// 由 pet.css 依 #pet 的 data-pose 打開。手臂肩軸、球拍握點與舊版一致，運動關鍵影格可沿用。
// ---------------------------------------------------------------------------
function frontLayered(id) {
  const FO = q3outline(0);
  const ey = 43, ns = .9, nx = (v) => 80 + (v - 80) * ns, ny = (v) => 53.5 + (v - 53.5) * ns, my = ny(60);
  const H = 'display="none"';
  const NOSE = `M${nx(72.6)} ${ny(51.2)} C${nx(72.4)} ${ny(46.4)} ${nx(87.6)} ${ny(46.4)} ${nx(87.4)} ${ny(51.2)} C${nx(87.4)} ${ny(56.2)} ${nx(83.8)} ${ny(59)} ${nx(80.9)} ${ny(59.6)} L80 ${ny(60)} L${nx(79.1)} ${ny(59.6)} C${nx(76.2)} ${ny(59)} ${nx(72.6)} ${ny(56.2)} ${nx(72.6)} ${ny(51.2)} Z`;
  const ear = (cls, cx) => `<g class="ear ${cls}"><g filter="url(#fz${id})" transform="translate(${cx} 27) scale(${EARK}) translate(${-cx} -27)"><ellipse cx="${cx}" cy="19" rx="9" ry="10.5" fill="#b38a5e"/><ellipse cx="${cx}" cy="20.6" rx="5.6" ry="6.8" fill="#f2c38c"/><ellipse cx="${cx}" cy="21.8" rx="3.2" ry="4" fill="#8a7460"/></g></g>`;
  const toeClaws = [54.5, 58.6, 62.8, 67, 93, 97.2, 101.4, 105.5].map((x, i) => {
    const y = (i % 4 === 0 || i % 4 === 3) ? 182.4 : 183.6, k = x < 80 ? -.25 : .25;
    return `<path d="M${x - 1.05} ${y - .8} Q${x + k} ${y + 2} ${x + k * 3} ${y + 3.8} Q${x + .9} ${y + 1.6} ${x + 1.05} ${y - .8} Z" fill="#f6eddf" stroke="#6e5844" stroke-width=".35"/>`;
  }).join('');
  const REST_L = [[64.5, 103], [64, 113], [68, 122], [75, 127.5]];
  const mir = (P) => P.map(([x, y]) => [160 - x, y]);
  return `<svg viewBox="0 0 160 196" class="char-svg view-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${DEFS(id)}
  <defs>
    <clipPath id="c${id}"><path d="${FO}"/></clipPath>
    <radialGradient id="vb${id}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#eceae3"/><stop offset="1" stop-color="#bdb9ae"/></radialGradient>
    <radialGradient id="bb${id}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#f6a35a"/><stop offset=".65" stop-color="#e27a2c"/><stop offset="1" stop-color="#a94e16"/></radialGradient>
    <linearGradient id="lf${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8cc06b"/><stop offset="1" stop-color="#4d8a3a"/></linearGradient>
    <radialGradient id="fl${id}"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".55" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>

  <!-- 籃框（籃球） -->
  <g class="hoop" ${H}>
    <line x1="190" y1="58" x2="190" y2="182" stroke="#8a8f98" stroke-width="3" stroke-linecap="round"/>
    <rect x="186" y="24" width="5" height="40" rx="1.5" fill="#fbfbf8" stroke="#9aa0a8" stroke-width="1.2"/>
    <path d="M162 51 L165 68 M168 53 L169.5 69 M176 53 L174.5 69 M182 51 L179 68 M164.5 60 H179.5" stroke="#cfd2d6" stroke-width="1" fill="none"/>
    <ellipse cx="172" cy="50.5" rx="11" ry="3.2" fill="none" stroke="#d9572a" stroke-width="2.4"/>
  </g>

  <g class="pet-body">
    <!-- 腳：站立（含小爪子）／被拎起來時懸空 -->
    <g class="feet-stand">
      <g filter="url(#fz${id})"><path d="M52 164 C46 172 48 182 60 183.5 C70 184.5 76 180 75 168 Z" fill="${FOOT}"/><path d="M108 164 C114 172 112 182 100 183.5 C90 184.5 84 180 85 168 Z" fill="${FOOT}"/></g>
      ${toeClaws}
    </g>
    <g class="feet-dangle" ${H}>
      <g class="foot-l"><path d="M56 162 C50 172 52 190 59 194 C66 196 71 184 73 167 Z" fill="${FOOT}" filter="url(#fz${id})"/>${[55.5, 59, 62.5].map((x) => CLAW(x, 193.4, 4, 3)).join('')}</g>
      <g class="foot-r"><path d="M104 162 C110 172 108 190 101 194 C94 196 89 184 87 167 Z" fill="${FOOT}" filter="url(#fz${id})"/>${[97.5, 101, 104.5].map((x) => CLAW(x, 193.4, -4, 3)).join('')}</g>
    </g>
    ${ear('ear-l', 58)}${ear('ear-r', 102)}
    <!-- 頭身一體的毛皮 -->
    <path d="${FO}" fill="url(#bg${id})" filter="url(#fz${id})"/>
    <g clip-path="url(#c${id})">
      <ellipse cx="80" cy="19" rx="28" ry="9" fill="#7c6244" opacity=".4" filter="url(#b3${id})"/>
      <ellipse cx="44" cy="60" rx="7" ry="22" fill="#71573e" opacity=".35" filter="url(#b3${id})"/><ellipse cx="116" cy="60" rx="7" ry="22" fill="#71573e" opacity=".35" filter="url(#b3${id})"/>
      <ellipse cx="80" cy="62" rx="31" ry="16" fill="#dfa65e" opacity=".85" filter="url(#b3${id})"/><ellipse cx="80" cy="68" rx="14" ry="6.5" fill="#f3e2c4" opacity=".9" filter="url(#b3${id})"/>
      <ellipse cx="80" cy="150" rx="34" ry="28" fill="#f0dcb9" opacity=".9" filter="url(#b3${id})"/><ellipse cx="80" cy="108" rx="15" ry="12" fill="#f0dcb9" opacity=".5" filter="url(#b3${id})"/>
      <path d="${FO}" fill="none" stroke="#fff6e6" stroke-width="3" opacity=".35" filter="url(#b1${id})"/>
      ${fur(1150, 36, 124)}
    </g>
    <path class="band" d="M49.5 34 Q80 25 110.5 34 L110 28 Q80 19 50 28 Z" style="fill: var(--band, #e5533d)"/>

    <g class="face">
      <g class="blush"><ellipse cx="60" cy="56" rx="7" ry="4" fill="#f0907c" filter="url(#b1${id})"/><ellipse cx="100" cy="56" rx="7" ry="4" fill="#f0907c" filter="url(#b1${id})"/></g>
      <g class="eyes-open"><g class="eyes-look">${eye(67, ey, id)}${eye(93, ey, id)}</g></g>
      <g class="eyes-wide" ${H}>${eye(67, ey - .5, id, { scale: 1.18 })}${eye(93, ey - .5, id, { scale: 1.18 })}</g>
      <g class="eyes-happy" ${H}><path d="M62.5 ${ey + 1.2} Q67 ${ey - 3.6} 71.5 ${ey + 1.2} M88.5 ${ey + 1.2} Q93 ${ey - 3.6} 97.5 ${ey + 1.2}" fill="none" stroke="#1f1814" stroke-width="1.8" stroke-linecap="round"/></g>
      <g class="eyes-closed" ${H}><path d="M62.5 ${ey} Q67 ${ey + 3} 71.5 ${ey} M88.5 ${ey} Q93 ${ey + 3} 97.5 ${ey}" fill="none" stroke="#1f1814" stroke-width="1.6" stroke-linecap="round"/></g>
      <g class="eyes-dizzy" ${H}>${[67, 93].map((x) => `<path class="spiral" d="M${x} ${ey} m-3.6 0 a3.6 3.6 0 1 1 3.6 3.6 a2.4 2.4 0 1 1 -2.4 -2.4 a1.2 1.2 0 1 1 1.2 1.2" fill="none" stroke="#1f1814" stroke-width="1.2" stroke-linecap="round"/>`).join('')}</g>
      <ellipse cx="80" cy="${ny(54.5)}" rx="8.1" ry="6.75" fill="#3b2f26" opacity=".4" filter="url(#b1${id})"/>
      <path d="${NOSE}" fill="url(#ns${id})"/><ellipse cx="${nx(76.6)}" cy="${ny(49.6)}" rx="2.7" ry="1.26" fill="#d4dfec" opacity=".55"/>
      <g class="mouth"><path d="M80 ${my} V${my + 2.5} M71 ${my - 1} Q74.6 ${my + 5.5} 77.75 ${my + 4.6} Q80 ${my + 4} 80 ${my + 2.5} Q80 ${my + 4} 82.25 ${my + 4.6} Q85.4 ${my + 5.5} 89 ${my - 1}" fill="none" stroke="#2a211b" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g>
      <g class="mouth-open" ${H}><path d="M80 ${my} V${my + 1.6}" stroke="#2a211b" stroke-width="1.3"/><path d="M70.5 ${my - .5} Q80 ${my + 3} 89.5 ${my - .5} Q88 ${my + 9} 80 ${my + 9.5} Q72 ${my + 9} 70.5 ${my - .5} Z" fill="#4a2622" stroke="#2a211b" stroke-width="1.2"/><path d="M75 ${my + 6.5} Q80 ${my + 4} 85 ${my + 6.5} Q83 ${my + 9} 80 ${my + 9} Q77 ${my + 9} 75 ${my + 6.5} Z" fill="#e58a8a"/></g>
      <g class="mouth-o" ${H}><path d="M80 ${my} V${my + 1.6}" stroke="#2a211b" stroke-width="1.3"/><ellipse cx="80" cy="${my + 5}" rx="3" ry="3.6" fill="#4a2622" stroke="#2a211b" stroke-width="1.1"/></g>
      <g class="mouth-chew" ${H}><path d="M80 ${my} V${my + 2}" stroke="#2a211b" stroke-width="1.3"/><ellipse class="chew" cx="80" cy="${my + 4.6}" rx="3.4" ry="2.2" fill="#4a2622" stroke="#2a211b" stroke-width="1"/></g>
    </g>

    <!-- 手：平時合在胸前／揮手／摸臉／舉高／捧葉子／墊球／右手運動 -->
    <g class="arm-rest-l">${arm(id, REST_L, 10, { thumb: 1, side: -1 })}</g>
    <g class="arm-rest-r">${arm(id, mir(REST_L), -10, { thumb: -1, side: 1 })}</g>
    <g class="arm-wave-r" ${H}>${arm(id, [[94, 104], [110, 103], [120, 90], [117, 76]], 196, { thumb: -1, side: 1, fadeTo: .25, w1: 11 })}</g>
    <g class="arm-cheek-r" ${H}>${arm(id, [[94, 106], [108, 102], [109, 84], [101, 74]], 160, { thumb: -1, side: 1, fadeTo: .25, w1: 11 })}</g>
    <g class="arm-up-l" ${H}>${arm(id, [[66, 104], [50, 101], [42, 88], [45, 75]], 164, { thumb: 1, side: -1, fadeTo: .25, w1: 11 })}</g>
    <g class="arm-up-r" ${H}>${arm(id, [[94, 104], [110, 101], [118, 88], [115, 75]], 196, { thumb: -1, side: 1, fadeTo: .25, w1: 11 })}</g>
    <g class="arms-eat" ${H}>
      <g class="leaf">
        <path d="M78 66 C70 58 60 52 50 53 C54 61 64 67 78 66 Z" fill="url(#lf${id})" stroke="#3f7a2f" stroke-width=".8"/>
        <path d="M78 66 C68 61 60 57 52 54.5" fill="none" stroke="#e9f3dc" stroke-width=".7" opacity=".8"/>
      </g>
      ${arm(id, [[66, 104], [63, 92], [68, 80], [75.5, 74]], 172, { thumb: 1, side: -1, fadeTo: .25 })}
      ${arm(id, [[94, 104], [97, 92], [92, 80], [84.5, 74]], -172, { thumb: -1, side: 1, fadeTo: .25 })}
    </g>
    <g class="arms-bump" ${H}>
      ${arm(id, [[66, 104], [58, 114], [53, 124], [50, 131]], 28, { thumb: 1, side: -1, fadeTo: .2 })}
      ${arm(id, [[94, 104], [84, 116], [66, 127], [55.5, 132.5]], 50, { thumb: -1, side: 1, fadeTo: .2, w1: 11 })}
    </g>
    <g class="arm-r" ${H}>
      <g class="racket" ${H}>
        <line x1="114" y1="132" x2="117.5" y2="145.5" stroke="#2f3540" stroke-width="2.6" stroke-linecap="round"/>
        <line x1="114.4" y1="133.6" x2="116" y2="140" stroke="#d9d3c4" stroke-width="3" stroke-linecap="round"/>
        <g transform="rotate(-12.1 119.6 155.5)">
          <ellipse cx="119.6" cy="155.5" rx="8" ry="10.5" fill="#ffffff" fill-opacity=".45" stroke="#2b5f9a" stroke-width="2"/>
          <path d="M114.8 148 V163 M119.6 145.2 V165.8 M124.4 148 V163 M112.2 151.5 H127 M111.7 155.5 H127.5 M112.2 159.5 H127" stroke="#a7bdd1" stroke-width=".6" fill="none"/>
        </g>
      </g>
      <ellipse cx="106.5" cy="100" rx="7.5" ry="8" fill="#a9845c" filter="url(#fz${id})"/>
      ${arm(id, [[106, 98], [111, 107], [113.5, 118], [114, 128]], -4, { thumb: -1, side: 1, fadeTo: .04, w1: 12, w2: 7.4, bulge: 2 })}
    </g>

    <!-- 特效 -->
    <g class="think-dots" ${H}><circle cx="118" cy="20" r="3" fill="#8a8f98"/><circle cx="127" cy="14" r="2.3" fill="#8a8f98"/><circle cx="134" cy="9" r="1.7" fill="#8a8f98"/></g>
    <g class="zzz" ${H} font-family="Arial, sans-serif" font-weight="700" fill="#7c8696">
      <text class="z1" x="112" y="30" font-size="9">Z</text><text class="z2" x="121" y="20" font-size="11">Z</text><text class="z3" x="132" y="8" font-size="13">Z</text>
    </g>
    <g class="sparkles" ${H} fill="#ffd34d">
      <path class="sp1" d="M30 40 L32 46 L38 48 L32 50 L30 56 L28 50 L22 48 L28 46 Z"/>
      <path class="sp2" d="M128 34 L129.5 38.5 L134 40 L129.5 41.5 L128 46 L126.5 41.5 L122 40 L126.5 38.5 Z"/>
      <path class="sp3" d="M134 92 L135.2 95.8 L139 97 L135.2 98.2 L134 102 L132.8 98.2 L129 97 L132.8 95.8 Z"/>
    </g>
    <g class="hearts" ${H} fill="#ef6f7c">
      <path class="h1" d="M122 40 c0-3 4-4 5-1 c1-3 5-2 5 1 c0 3-5 6-5 6 s-5-3-5-6Z"/>
      <path class="h2" d="M130 22 c0-2.2 3-3 3.7-.7 c.7-2.3 3.7-1.5 3.7.7 c0 2.2-3.7 4.4-3.7 4.4 s-3.7-2.2-3.7-4.4Z" opacity=".75"/>
      <path class="h3" d="M28 34 c0-2 2.6-2.6 3.2-.6 c.6-2 3.2-1.4 3.2.6 c0 2-3.2 3.8-3.2 3.8 s-3.2-1.8-3.2-3.8Z" opacity=".6"/>
    </g>
    <g class="ear-sparks" ${H}><path d="M44 20 L38 14 M40 28 L32 26 M116 20 L122 14 M120 28 L128 26" stroke="#9aa0a8" stroke-width="1.4" stroke-linecap="round"/></g>
    <g class="motion" ${H}><path d="M30 150 Q22 140 30 128 M24 158 Q14 144 24 124 M130 150 Q138 140 130 128 M136 158 Q146 144 136 124" fill="none" stroke="#9aa0a8" stroke-width="1.3" stroke-linecap="round"/></g>
    <g class="wave-lines" ${H}><path d="M126 66 Q130 70 128 75 M129 62 Q135 68 132 76" fill="none" stroke="#9aa0a8" stroke-width="1.2" stroke-linecap="round"/></g>
  </g>
  <g class="stars" ${H} fill="#ffcf3d" stroke="#d9a520" stroke-width=".6">
    <path d="M48 14 l1.6 3.6 3.9.4-2.9 2.6.8 3.8-3.4-2-3.4 2 .8-3.8-2.9-2.6 3.9-.4Z"/><path d="M110 10 l1.3 2.9 3.1.3-2.3 2.1.6 3-2.7-1.6-2.7 1.6.6-3-2.3-2.1 3.1-.3Z"/><path d="M80 2 l1.1 2.5 2.7.3-2 1.8.6 2.7-2.4-1.4-2.4 1.4.6-2.7-2-1.8 2.7-.3Z"/>
  </g>

  <!-- 球：外層 .bx 走 X、內層 .by 走 Y；圖形以 (0,0) 為中心 -->
  <g class="ball ball-vb" ${H}><g class="bx"><g class="by"><g class="spin">
    <circle r="9.5" fill="url(#vb${id})" stroke="#9aa0a8" stroke-width=".8"/>
    <path d="M-9.5 0 Q0 -5 9.5 0 M-6 -7.3 Q2 -2 2.6 9.1 M6 -7.3 Q4.2 1.8 -5.2 7.8" fill="none" stroke="#3f6fb5" stroke-width="1.2"/>
    <path d="M-8 4.8 Q-1 6 4.5 8.3" fill="none" stroke="#e2b53b" stroke-width="1.2"/>
  </g></g></g></g>
  <g class="ball ball-bb" ${H}><g class="bx"><g class="by"><g class="spin">
    <circle r="9.5" fill="url(#bb${id})"/>
    <path d="M-9.5 0 H9.5 M0 -9.5 V9.5 M-6.8 -6.6 Q-1.6 0 -6.8 6.6 M6.8 -6.6 Q1.6 0 6.8 6.6" fill="none" stroke="#5a2a0d" stroke-width="1"/>
  </g></g></g></g>
  <g class="ball shuttle" ${H}><g class="bx"><g class="by"><g class="spin">
    <path d="M-1.6 1.6 L9 -3.5 L3.5 -9 Z" fill="#ffffff" stroke="#b9bec5" stroke-width=".8" stroke-linejoin="round"/>
    <path d="M-1.6 1.6 L6.2 -6.2 M1 -1.2 L7.4 -4.6 M-0.4 -0.4 L4.8 -7.6" stroke="#d6dade" stroke-width=".5"/>
    <circle cx="-3" cy="3" r="3" fill="#fff8ec" stroke="#c9483a" stroke-width="1.3"/>
  </g></g></g></g>
  <ellipse class="flash" ${H} cx="80" cy="80" rx="110" ry="120" fill="url(#fl${id})"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// 匯出：五個實際繪製的視角（左邊三個由 CSS 鏡射）
// ---------------------------------------------------------------------------
// 實際繪製的角度：正面（分層，可做所有姿勢）＋右半邊 22.5° 一格；左半邊用鏡射
const ANGLES = [22.5, 45, 67.5, 90, 112.5, 135, 157.5, 180];
const akey = (a) => 'a' + String(a).replace('.', '_');
function views() {
  if (_views) return _views;
  _views = { front: paint(frontLayered('qf')) };
  for (const a of ANGLES) _views[akey(a)] = paint(q3render(a, 'q' + akey(a)));
  return _views;
}
// 十六方位：名稱 → [圖, 是否鏡射, 角度]。舊名稱 f34r / sider / b34r / back… 保留給互動程式用
const VIEW_MAP = { front: ['front', false, 0] };
const NAMED = { 45: 'f34', 90: 'side', 135: 'b34' };
for (const a of ANGLES) {
  if (a === 180) { VIEW_MAP.back = [akey(a), false, 180]; continue; }
  const n = NAMED[a] || ('d' + Math.round(a));
  VIEW_MAP[n + 'r'] = [akey(a), false, a];
  VIEW_MAP[n + 'l'] = [akey(a), true, -a];
}
const TURN_ORDER = Object.keys(VIEW_MAP).sort((x, y) => ((VIEW_MAP[x][2] + 360) % 360) - ((VIEW_MAP[y][2] + 360) % 360));
// 給姿勢模組（quokka-pose.js）用的內部元件
const internals = { q3: () => Q3, tailK: () => TAILK, earK: () => EARK, proj: q3proj, facing: q3facing, cr, fur, eye, arm, paw, CLAW, DEFS, paint, FOOT, PAW };
const api = { internals, views, frontLayered, VIEW_MAP, TURN_ORDER, render3d: (a, id) => paint(q3render(a, id)), configure, traits: () => TRAITS, __arm: arm, __DEFS: DEFS, __fur: fur, __eye: eye, __claw: CLAW };
if (typeof window !== 'undefined') window.QuokkaArt = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
