// 庫卡的飾品：頭帶、蝴蝶結、耳後小花、草帽、毛線帽、圓框眼鏡、小圍巾、三角領巾、鈴鐺項圈、葉子花冠、工地安全帽、貝雷帽。
//
// 每件飾品都定義在 3D 的「頭部座標」或「身體座標」裡（與 quokka-art.js 的 3D 代理模型同一套座標：
// x 右、y 下、z 朝前），由呼叫端傳入的投影函式 PH()／PB() 轉成畫面座標，所以頭轉、點頭、歪頭、
// 身體蹲跳傾斜時都會正確跟著動。
//
// 前後遮擋：不用「畫面深度差」猜，而是把觀者視線換算回頭部（或身體）的局部座標，
// 從飾品上的點往觀者方向打一條射線，看會不會穿過頭（或身體）的橢球 → 被擋住。
// 被擋住的部分放到「後層」（畫在身體輪廓之前，由身體自然遮住露不出來的地方），看得到的放「前層」。
//
// 畫風與庫卡一致：漸層、柔邊、模糊的亮面與陰影、不用黑色硬外框；布料與毛線用擾動濾鏡做毛邊。
// 顏色用 CSS 變數 --acc（每件飾品外層包一個 <g style="--acc:…">，所以同一頁多隻也能各自不同色）。
//
// draw(list, ctx) 回傳圖層：
//   back   畫在身體輪廓之前（被頭或身體擋住的部分）
//   ear    與耳朵依深度一起排序（耳朵附近的小飾品）：[{ z, svg }]
//   front  畫在頭部明暗之後、五官之前（帽子、頭帶、圍巾…）
//   overEars  畫在耳朵之後、五官之前（毛線帽的帽緣壓住耳根、耳邊的小花）
//   top    畫在五官之後（眼鏡）
//   earsOver  true＝耳朵要畫在帽子上面（毛線帽有耳洞）

(function () {
  const rad = (a) => a * Math.PI / 180, f1 = (v) => (+v).toFixed(1), f2 = (v) => (+v).toFixed(3);
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // 飾品目錄（名稱與預設色；抽色在 traits.js）
  const TYPES = {
    band: { name: '頭帶', slot: 'head', color: '#e5533d' },
    bow: { name: '蝴蝶結', slot: 'ear', color: '#e2588f' },
    flower: { name: '耳後小花', slot: 'ear', color: '#c77dbb' },
    straw: { name: '草帽', slot: 'head', color: '#e5533d' },
    beanie: { name: '毛線帽', slot: 'head', color: '#3f7fd9' },
    glasses: { name: '圓框眼鏡', slot: 'face', color: '#c9a14a' },
    scarf: { name: '小圍巾', slot: 'neck', color: '#e5533d' },
    bandana: { name: '三角領巾', slot: 'neck', color: '#3f7fd9' },
    collar: { name: '鈴鐺項圈', slot: 'neck', color: '#e5533d' },
    wreath: { name: '葉子花冠', slot: 'head', color: '#e48fb5' },
    hardhat: { name: '工地安全帽', slot: 'head', color: '#f4c430' },
    beret: { name: '貝雷帽', slot: 'head', color: '#c0392b' }
  };

  // ---- 旋轉（與 quokka-pose.js 同一套正負號：rotX 正＝前端往下、rotZ 正＝往右歪）----
  function rotX(p, a) { const s = Math.sin(rad(a)), c = Math.cos(rad(a)); return [p[0], p[1] * c + p[2] * s, p[2] * c - p[1] * s]; }
  function rotZ(p, a) { const s = Math.sin(rad(a)), c = Math.cos(rad(a)); return [p[0] * c - p[1] * s, p[1] * c + p[0] * s, p[2]]; }
  function rotY(p, a) { const s = Math.sin(rad(a)), c = Math.cos(rad(a)); return [p[0] * c + p[2] * s, p[1], p[2] * c - p[0] * s]; }
  // 子座標系：先點頭方向傾斜、再歪、再轉，最後平移到 origin（都在父座標裡）
  const place = (o, pitch = 0, roll = 0, yaw = 0) => (p) => add(o, rotY(rotZ(rotX(p, pitch), roll), yaw));
  const placeN = (pitch = 0, roll = 0, yaw = 0) => (n) => rotY(rotZ(rotX(n, pitch), roll), yaw);

  // ---- 3D 空間：投影＋「局部座標的視線方向」＋遮擋測試 ----------------------------
  function solve3(M, b) {
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(M) || 1e-9;
    return [0, 1, 2].map((k) => det(M.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / D);
  }
  // 射線（從 p 沿 v 往觀者）是否穿過橢球 e=[cx,cy,cz,rx,ry,rz]；p 在橢球內也算被擋
  function hitEll(p, v, e) {
    const q = [(p[0] - e[0]) / e[3], (p[1] - e[1]) / e[4], (p[2] - e[2]) / e[5]], d = [v[0] / e[3], v[1] / e[4], v[2] / e[5]];
    const a = dot(d, d), b = 2 * dot(q, d), c = dot(q, q) - 1;
    if (c < 0) return true;
    const disc = b * b - 4 * a * c;
    return disc > 0 && (-b + Math.sqrt(disc)) / (2 * a) > 0;
  }
  function space(P, parts) {
    const o = P([0, 0, 0]), ax = P([1, 0, 0]), ay = P([0, 1, 0]), az = P([0, 0, 1]);
    const M = [[ax.X - o.X, ay.X - o.X, az.X - o.X], [ax.Y - o.Y, ay.Y - o.Y, az.Y - o.Y], [ax.Z - o.Z, ay.Z - o.Z, az.Z - o.Z]];
    const S = { P, v: norm(solve3(M, [0, 0, 1])) };     // v：局部座標裡「往觀者」的方向（投影後只增加深度、不移動畫面位置）
    S.hid = (p) => (parts || []).some((e) => hitEll(p, S.v, e));
    S.face = (n) => dot(norm(n), S.v);                  // 局部法向量朝向觀者的程度
    S.xy = (p) => { const q = P(p); return [q.X, q.Y]; };
    return S;
  }
  function child(S, f) {
    const C = space((p) => S.P(f(p)), null);
    C.hid = (p) => S.hid(f(p));
    return C;
  }

  // ---- 2D 路徑工具 ------------------------------------------------------------------
  const pathOpen = (pts) => {
    if (pts.length < 2) return '';
    let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) d += ` Q${f1(pts[i][0])} ${f1(pts[i][1])} ${f1((pts[i][0] + pts[i + 1][0]) / 2)} ${f1((pts[i][1] + pts[i + 1][1]) / 2)}`;
    const L = pts[pts.length - 1];
    return d + ` L${f1(L[0])} ${f1(L[1])}`;
  };
  function cr(pts) {
    const n = pts.length;
    if (n < 3) return '';
    let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      d += ` C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
    }
    return d + ' Z';
  }
  function hull(pts) {
    const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (P.length < 3) return P;
    const cr2 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cr2(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr2(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    const h = lo.slice(0, -1).concat(up.slice(0, -1));
    // 去掉太近的點，平滑時才不會打結
    const out = [];
    for (const p of h) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1.2) out.push(p); }
    return out;
  }
  // 環狀樣本中連續可見的段落；全部可見時回傳 closed
  function runs(vis, closed = true) {
    const n = vis.length, out = [];
    if (vis.every(Boolean)) return [{ idx: [...Array(n).keys()], closed: closed }];
    let start = closed ? vis.findIndex((v) => !v) : 0;
    let cur = null;
    for (let k = 0; k < n; k++) {
      const i = closed ? (start + k) % n : k;
      if (vis[i]) { if (!cur) { cur = []; out.push({ idx: cur, closed: false }); } cur.push(i); } else cur = null;
    }
    // 讓每段頭尾各延伸半格，接縫對齊輪廓
    return out;
  }

  // ---- 貼片：把 2D 圖案貼在 3D 平面上（中心 c、法向 n、圖案的「下」方向），用 SVG matrix 正確透視縮放 ----
  function decal(S, c, n, inner, o = {}) {
    n = norm(n);
    const g = o.down || [0, 1, 0];
    let d = sub(g, mul(n, dot(g, n)));
    if (Math.hypot(...d) < 1e-3) d = [0, 0, 1];
    d = norm(d);
    const r = cross(d, n), s = o.s || 1;
    const O = S.P(c), Xq = S.P(add(c, mul(r, s))), Yq = S.P(add(c, mul(d, s)));
    let a = Xq.X - O.X, b = Xq.Y - O.Y;
    const cc = Yq.X - O.X, dd = Yq.Y - O.Y;
    const front = a * dd - b * cc > 0;
    if (o.minW) {                                       // 側面時不要薄到消失（緞帶、花有厚度）
      const w = Math.hypot(a, b), m = o.minW * s;
      if (w < m) {
        const dl = Math.hypot(cc, dd) || 1, px = dd / dl * (front ? 1 : -1), py = -cc / dl * (front ? 1 : -1);
        const t = w < 1e-3 ? 1 : (m - w) / m;
        const ux = w < 1e-3 ? px : a / w * (1 - t) + px * t, uy = w < 1e-3 ? py : b / w * (1 - t) + py * t, ul = Math.hypot(ux, uy) || 1;
        a = ux / ul * m; b = uy / ul * m;
      }
    }
    return { svg: `<g transform="matrix(${f2(a)} ${f2(b)} ${f2(cc)} ${f2(dd)} ${f1(O.X)} ${f1(O.Y)})">${inner(front)}</g>`, front, Z: O.Z };
  }

  const FILL = (def) => `style="fill:var(--acc, ${def})"`;
  const STROKE = (def) => `style="stroke:var(--acc, ${def})"`;
  // 同時上填色與描邊：一個標籤只能有一個 style 屬性（寫兩個的話，SVG 轉成圖片時整張會解析失敗）
  const FILLSTROKE = (def) => `style="fill:var(--acc, ${def});stroke:var(--acc, ${def})"`;
  const DEFS = (id) => `
    <radialGradient id="acV${id}" cx=".36" cy=".28" r=".85"><stop offset="0" stop-color="#ffffff" stop-opacity=".42"/><stop offset=".38" stop-color="#ffffff" stop-opacity=".06"/><stop offset=".7" stop-color="#2a1d14" stop-opacity=".02"/><stop offset="1" stop-color="#2a1d14" stop-opacity=".3"/></radialGradient>
    <linearGradient id="acD${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".3"/><stop offset=".5" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#2a1d14" stop-opacity=".25"/></linearGradient>
    <linearGradient id="acS${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7e6b0"/><stop offset=".55" stop-color="#e8c97f"/><stop offset="1" stop-color="#c99f52"/></linearGradient>
    <radialGradient id="acG${id}" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="#fff6d2"/><stop offset=".45" stop-color="#f2c94e"/><stop offset="1" stop-color="#b3832c"/></radialGradient>
    <linearGradient id="acL${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d3dec6"/><stop offset=".5" stop-color="#a6b998"/><stop offset="1" stop-color="#768c6d"/></linearGradient>
    <radialGradient id="acP${id}" cx=".4" cy=".25" r=".9"><stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".08"/><stop offset="1" stop-color="#3a1f2e" stop-opacity=".28"/></radialGradient>
    <filter id="acZ${id}" x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="9"/><feDisplacementMap in="SourceGraphic" scale="1.5" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="acB${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation=".6"/></filter>`;

  // 立體外形：可見點的凸包 → 平滑輪廓
  const blob = (S, pts) => cr(hull(pts.filter((p) => !S.hid(p)).map(S.xy)));

  // 沿環的條帶：只畫朝向觀者、且沒被擋住的段落
  function ringRuns(S, pts, normals, opt = {}) {
    const off = opt.off == null ? 1.2 : opt.off;
    const vis = pts.map((p, i) => (!opt.faceOnly || S.face(normals[i]) > (opt.minFace || 0)) && (opt.faceOnly ? true : !S.hid(add(p, mul(norm(normals[i]), off)))));
    return runs(vis, true).map((r) => {
      const xy = r.idx.map((i) => S.xy(pts[i]));
      if (r.closed) xy.push(xy[0]);
      // 段落頭尾往被擋住的鄰點延伸一半，接到輪廓上
      if (!r.closed && r.idx.length) {
        const n = pts.length, i0 = r.idx[0], i1 = r.idx[r.idx.length - 1];
        const a = S.xy(pts[(i0 - 1 + n) % n]), b = S.xy(pts[(i1 + 1) % n]);
        xy.unshift([(a[0] + xy[0][0]) / 2, (a[1] + xy[0][1]) / 2]);
        const L = xy[xy.length - 1]; xy.push([(b[0] + L[0]) / 2, (b[1] + L[1]) / 2]);
      }
      return { xy, idx: r.idx, closed: r.closed };
    }).filter((r) => r.xy.length > 1);
  }
  // 頭部橢球表面法向量
  // HE＝頭的主橢球 [cx,cy,cz,rx,ry,rz]（draw() 會換成呼叫端傳入的實際尺寸）
  let HE = [0, 45, 3, 31, 30, 28];
  const headN = (p) => norm([p[0] / (HE[3] * HE[3]), (p[1] - HE[1]) / (HE[4] * HE[4]), (p[2] - HE[2]) / (HE[5] * HE[5])]);
  // 頭部橢球在高度 y 的水平截面上、方位角 a 的點（k＝往外推的倍率）
  const headAt = (a, y, k = 1) => { const q = Math.sqrt(Math.max(0, 1 - ((y - HE[1]) / HE[4]) ** 2)); return [HE[3] * q * k * Math.sin(a), y, HE[2] + HE[5] * q * k * Math.cos(a)]; };
  // 繞頭一圈的東西（頭帶、花冠）用「水平徑向」法向量判斷朝前那半圈：在頭部局部座標裡算、經頭的旋轉後看朝向，
  // 永遠剛好是半圈，頭歪再大也不會變成整圈光環（畫出來的頭輪廓本身不會露出頭頂，所以不能多畫）
  const radialN = (p) => norm([p[0] / (HE[3] * HE[3]), 0, (p[2] - HE[2]) / (HE[5] * HE[5])]);

  // ===================================================================================
  // 各飾品
  // ===================================================================================

  // 頭帶：沿頭部截面一圈，只畫朝前那半；背後有結
  function band(H, L, ctx, col) {
    const id = ctx.id, w = 6.4 * ctx.hs, pts = [], ns = [];
    for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2; const p = headAt(a, 30 - 1.2 * Math.cos(a), 1.03); pts.push(p); ns.push(radialN(p)); }
    ringRuns(H, pts, ns, { faceOnly: true }).forEach((r) => {
      const d = pathOpen(r.xy);
      L.front.push(`<path d="${d}" fill="none" stroke="#4a3a2e" stroke-width="${f1(w + 1)}" opacity=".2" transform="translate(0 1.2)" filter="url(#b1${id})"/>
        <path d="${d}" fill="none" ${STROKE(col)} stroke-width="${f1(w)}" stroke-linejoin="round"/>
        <path d="${d}" fill="none" stroke="#ffffff" stroke-width="${f1(w * .28)}" opacity=".3" transform="translate(0 -1.5)" filter="url(#acB${id})"/>
        <path d="${d}" fill="none" stroke="#2a1d14" stroke-width="${f1(w * .25)}" opacity=".14" transform="translate(0 2.2)" filter="url(#acB${id})"/>`);
    });
    const kc = headAt(Math.PI, 31, 1.04);
    if (H.face([0, 0, -1]) > 0) {
      const k = decal(H, kc, [0, 0, -1], (front) => `
        <path d="M-2.6 1 Q-6 10 -10.5 16 L-7 17 Q-3 11 0 2 Z M2.6 1 Q6 10 10.5 16 L7 17 Q3 11 0 2 Z" fill="#4a3a2e" opacity=".2" transform="translate(.6 1.2)" filter="url(#b1${id})"/>
        <path d="M-2.6 1 Q-6 10 -10.5 16 L-7 17 Q-3 11 0 2 Z M2.6 1 Q6 10 10.5 16 L7 17 Q3 11 0 2 Z" ${FILL(col)}/>
        <path d="M0 0 C-3 -5 -9 -6 -9 -1 C-9 3 -4 3 0 0 Z M0 0 C3 -5 9 -6 9 -1 C9 3 4 3 0 0 Z" ${FILL(col)}/>
        <path d="M0 0 C-3 -5 -9 -6 -9 -1 C-9 3 -4 3 0 0 Z M0 0 C3 -5 9 -6 9 -1 C9 3 4 3 0 0 Z" fill="url(#acD${id})"/>
        <ellipse cx="0" cy="0" rx="2.8" ry="2.6" ${FILL(col)}/><ellipse cx="0" cy="0" rx="2.8" ry="2.6" fill="#2a1d14" opacity=".15"/>
        ${front ? '' : '<rect x="-11" y="-7" width="22" height="25" fill="#2a1d14" opacity="0"/>'}`, { minW: .55 });
      L.front.push(k.svg);
    }
  }

  // 蝴蝶結：別在右耳根旁的頭頂上
  function bow(H, L, ctx, col) {
    const id = ctx.id, k = 1, c = [k * 13.5, 16.5, -1.5], n = norm([k * .35, -.55, .75]);
    const art = (front) => `
      <path d="M0 0 C-3 -6.5 -11.5 -8.5 -12 -2.5 C-12.4 2.6 -6 4.6 0 0 Z M0 0 C3 -6.5 11.5 -8.5 12 -2.5 C12.4 2.6 6 4.6 0 0 Z M-1 1 Q-3.4 6 -6.2 10.4 L-3.6 10 L-2.4 12.2 Q.2 6.4 .6 1.6 Z M1 1 Q3.4 6 6.2 10.4 L3.6 10 L2.4 12.2 Q-.2 6.4 -.6 1.6 Z" fill="#4a3a2e" opacity=".22" transform="translate(.8 1.4)" filter="url(#b1${id})"/>
      <path d="M-1 1 Q-3.4 6 -6.2 10.4 L-3.6 10 L-2.4 12.2 Q.2 6.4 .6 1.6 Z M1 1 Q3.4 6 6.2 10.4 L3.6 10 L2.4 12.2 Q-.2 6.4 -.6 1.6 Z" ${FILL(col)}/>
      <path d="M-1 1 Q-3.4 6 -6.2 10.4 L-3.6 10 L-2.4 12.2 Q.2 6.4 .6 1.6 Z M1 1 Q3.4 6 6.2 10.4 L3.6 10 L2.4 12.2 Q-.2 6.4 -.6 1.6 Z" fill="#2a1d14" opacity=".18"/>
      <path d="M0 0 C-3 -6.5 -11.5 -8.5 -12 -2.5 C-12.4 2.6 -6 4.6 0 0 Z M0 0 C3 -6.5 11.5 -8.5 12 -2.5 C12.4 2.6 6 4.6 0 0 Z" ${FILL(col)} filter="url(#acZ${id})"/>
      <path d="M0 0 C-3 -6.5 -11.5 -8.5 -12 -2.5 C-12.4 2.6 -6 4.6 0 0 Z M0 0 C3 -6.5 11.5 -8.5 12 -2.5 C12.4 2.6 6 4.6 0 0 Z" fill="url(#acD${id})"/>
      <path d="M-1.5 -.5 C-4 -3.4 -7 -4 -9 -2.6 M1.5 -.5 C4 -3.4 7 -4 9 -2.6" fill="none" stroke="#2a1d14" stroke-width="1" stroke-linecap="round" opacity=".2" filter="url(#acB${id})"/>
      <ellipse cx="-7.5" cy="-4.6" rx="2.8" ry="1.3" fill="#ffffff" opacity=".5" transform="rotate(-20 -7.5 -4.6)" filter="url(#acB${id})"/><ellipse cx="7.5" cy="-4.6" rx="2.8" ry="1.3" fill="#ffffff" opacity=".42" transform="rotate(20 7.5 -4.6)" filter="url(#acB${id})"/>
      <ellipse cx="0" cy=".2" rx="2.9" ry="3.3" ${FILL(col)}/><ellipse cx="0" cy=".2" rx="2.9" ry="3.3" fill="url(#acV${id})"/>
      <circle cx="-4" cy="-1" r=".8" fill="#ffffff" opacity=".7"/><circle cx="-8.5" cy="-1.4" r=".8" fill="#ffffff" opacity=".7"/><circle cx="5" cy="-3.2" r=".8" fill="#ffffff" opacity=".7"/><circle cx="9" cy="-.2" r=".8" fill="#ffffff" opacity=".7"/>
      ${front ? '' : '<path d="M0 0 C-3 -6.5 -11.5 -8.5 -12 -2.5 C-12.4 2.6 -6 4.6 0 0 Z M0 0 C3 -6.5 11.5 -8.5 12 -2.5 C12.4 2.6 6 4.6 0 0 Z" fill="#2a1d14" opacity=".14"/>'}`;
    const D = decal(H, c, n, art, { minW: .5, s: 1.08 });
    // 蝴蝶結有厚度：用往外推一點的點判斷，貼著頭皮掠過時不會整個消失
    if (H.hid(add(c, mul(n, 4.5)))) L.back.push(D.svg); else L.ear.push({ z: D.Z, svg: D.svg });
  }

  // 耳後小花：Guichenotia（羅特尼斯島庫卡最愛吃的灌木）粉紫色下垂鐘形小花＋銀灰細葉，塞在左耳後
  function flower(H, L, ctx, col) {
    const id = ctx.id, k = -1, c = [k * 31.5, 27, -3], n = norm([k * .55, -.2, .82]);
    const bell = (x, y, a, s) => `<g transform="translate(${x} ${y}) rotate(${a}) scale(${s})">
        <path d="M0 -4 Q.4 -2 0 0" fill="none" stroke="#7f8a63" stroke-width=".6"/>
        <path d="M-3 0 Q-3.6 4.5 -4.2 6.4 Q-2.8 6 -2 6.9 Q-1 6.2 0 7 Q1 6.2 2 6.9 Q2.8 6 4.2 6.4 Q3.6 4.5 3 0 Q0 -1.3 -3 0 Z" fill="#4a3a2e" opacity=".2" transform="translate(.6 .9)" filter="url(#acB${id})"/>
        <path d="M-3 0 Q-3.6 4.5 -4.2 6.4 Q-2.8 6 -2 6.9 Q-1 6.2 0 7 Q1 6.2 2 6.9 Q2.8 6 4.2 6.4 Q3.6 4.5 3 0 Q0 -1.3 -3 0 Z" ${FILL(col)}/>
        <path d="M-3 0 Q-3.6 4.5 -4.2 6.4 Q-2.8 6 -2 6.9 Q-1 6.2 0 7 Q1 6.2 2 6.9 Q2.8 6 4.2 6.4 Q3.6 4.5 3 0 Q0 -1.3 -3 0 Z" fill="url(#acP${id})"/>
        <path d="M-1.2 1 Q-1.6 3.6 -1.8 5.4" fill="none" stroke="#ffffff" stroke-width=".7" stroke-linecap="round" opacity=".5"/>
        <circle cx="-.9" cy="6.7" r=".55" fill="#f7e7a6"/><circle cx=".9" cy="6.8" r=".55" fill="#f7e7a6"/></g>`;
    const leafP = 'M0 0 C1.5 -4 1.3 -10 0 -13.5 C-1.3 -10 -1.5 -4 0 0 Z';
    const leaf = (a, s) => `<g transform="rotate(${a}) scale(${s})"><path d="${leafP}" fill="#4a3a2e" opacity=".18" transform="translate(.5 .8)" filter="url(#acB${id})"/><path d="${leafP}" fill="url(#acL${id})" filter="url(#acZ${id})"/><path d="M0 -1 Q.3 -6 0 -11.5" fill="none" stroke="#eef3e6" stroke-width=".6" opacity=".7"/></g>`;
    const art = (front) => `${leaf(-62, 1)}${leaf(-18, 1.1)}${leaf(28, .95)}
      <path d="M0 0 Q-3 2 -5 3.2 M0 0 Q2 2.4 4.6 3 M0 0 Q.6 3.4 .4 6.4" fill="none" stroke="#8a7a62" stroke-width=".7" stroke-linecap="round"/>
      ${bell(-5.5, 3.4, 14, 1.15)}${bell(5, 3, -12, 1.05)}${bell(.4, 6.6, 3, 1.25)}
      ${front ? '' : '<circle r="10" fill="#2a1d14" opacity=".08" filter="url(#b1' + id + ')"/>'}`;
    const D = decal(H, c, n, art, { minW: .6, s: 1.35 });
    // 花有厚度、又別在頭的外緣：只有整朵都轉到頭後面才放後層；其餘畫在耳朵之後（頭的前面）
    if (H.hid(add(c, mul(n, 9))) && H.face(n) < -.2) L.back.push(D.svg); else L.overEars.push(D.svg);
  }

  // 帽簷（環狀面）：依前後切成兩半，後半畫在後層、前半畫在帽身之後
  function brim(C, L, ctx, o) {
    const id = ctx.id, N = 72, inner = [], outer = [], mid = [];
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
      const ro = o.outer(a), dr = o.droop(a);
      inner.push([o.rx * s, 0, o.rz * c]); outer.push([ro[0] * s, dr, ro[1] * c]);
      mid.push([(o.rx + ro[0]) / 2 * s, dr * .45, (o.rz + ro[1]) / 2 * c]);
    }
    const cz = C.P([0, 1, 0]).Z;
    const isBack = mid.map((p) => C.P(p).Z < cz);
    const top = C.face([0, -1, 0]);                     // >0：看得到帽簷上面
    const shape = (idx) => {
      const n = idx.length, ext = (arr) => { const a = arr.map((p) => C.xy(p)); return a; };
      const ii = idx.slice();
      if (n < N) { ii.unshift((idx[0] - 1 + N) % N); ii.push((idx[n - 1] + 1) % N); }
      const O = ext(ii.map((i) => outer[i])), I = ext(ii.map((i) => inner[i]));
      if (n >= N) return cr(O) + ' ' + cr(I.slice().reverse());
      return pathOpen(O) + ' L' + pathOpen(I.slice().reverse()).slice(1) + ' Z';
    };
    const lines = (idx, fr) => { const ii = idx.slice(); return pathOpen(ii.map((i) => C.xy([inner[i][0] + (outer[i][0] - inner[i][0]) * fr, outer[i][1] * fr, inner[i][2] + (outer[i][2] - inner[i][2]) * fr]))); };
    const draw = (idx, back) => {
      if (idx.length < 2) return '';
      const d = shape(idx);
      const under = top < 0 ? `<path d="${d}" fill="#2a1d14" opacity="${f2(Math.min(.3, -top * .6 + .08))}"/>` : '';
      const tex = o.rings ? o.rings.map((fr) => `<path d="${lines(idx, fr)}" fill="none" stroke="${o.ringCol}" stroke-width=".5" opacity=".38"/>`).join('') : '';
      return `${back ? '' : `<path d="${d}" fill="#2a1d14" opacity=".2" transform="translate(0 2.4)" filter="url(#b1${id})"/>`}
        <path d="${d}" ${o.fill} ${o.filter ? `filter="url(#${o.filter}${id})"` : ''} stroke-linejoin="round"/>${tex}${under}
        <path d="${pathOpen(idx.map((i) => C.xy(outer[i])))}" fill="none" stroke="#2a1d14" stroke-width="1" opacity=".16"/>
        ${top > 0 ? `<path d="${d}" fill="#ffffff" opacity="${f2(top * .16)}"/>` : ''}`;
    };
    const backIdx = [], frontIdx = [];
    runs(isBack, true).forEach((r) => backIdx.push(r.idx));
    runs(isBack.map((b) => !b), true).forEach((r) => frontIdx.push(r.idx));
    return { back: backIdx.map((ix) => draw(ix, true)).join(''), front: frontIdx.map((ix) => draw(ix, false)).join('') };
  }

  // 草帽：帽身在兩耳之間、帽簷微微下垂；帽身繞一圈彩色緞帶，側邊打個小結
  function straw(H, L, ctx, col) {
    const id = ctx.id, C = child(H, place([0, 17, 1], 9, 0, 0)), rx = 15, rz = 13.5;
    const crown = [];
    [[0, 1], [-5, 1.0], [-9, .97], [-11.5, .86], [-13, .62], [-13.8, .3], [-14, 0]].forEach(([y, k]) => {
      for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; crown.push([rx * k * Math.sin(a), y, rz * k * Math.cos(a)]); }
    });
    const crownD = blob(C, crown);
    const B = brim(C, L, ctx, { rx: rx - 1, rz: rz - 1, outer: () => [35, 31], droop: () => 4.2, fill: `fill="url(#acS${id})"`, filter: 'acZ', rings: [.25, .5, .75], ringCol: '#a8843f' });
    L.back.push(B.back);
    // 帽身
    const weave = [-2, -5, -8, -10.5].map((y) => {
      const k = y < -9 ? .93 : 1, pts = [], ns = [];
      for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; pts.push([rx * k * Math.sin(a), y, rz * k * Math.cos(a)]); ns.push([Math.sin(a) / rx, 0, Math.cos(a) / rz]); }
      return ringRuns(C, pts, ns, { faceOnly: true }).map((r) => `<path d="${pathOpen(r.xy)}" fill="none" stroke="#a8843f" stroke-width=".5" opacity=".4"/>`).join('');
    }).join('');
    const rib = [], rns = [];
    for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2; rib.push([(rx + .4) * Math.sin(a), -2.2, (rz + .4) * Math.cos(a)]); rns.push([Math.sin(a) / rx, 0, Math.cos(a) / rz]); }
    const ribbon = ringRuns(C, rib, rns, { faceOnly: true }).map((r) => `<path d="${pathOpen(r.xy)}" fill="none" ${STROKE(col)} stroke-width="${f1(3.8 * ctx.hs)}"/><path d="${pathOpen(r.xy)}" fill="none" stroke="#2a1d14" stroke-width="${f1(1.2 * ctx.hs)}" opacity=".18" transform="translate(0 1.2)"/>`).join('');
    const ka = rad(-55), kc = [(rx + .8) * Math.sin(ka), -2.2, (rz + .8) * Math.cos(ka)], kn = [Math.sin(ka), 0, Math.cos(ka)];
    const knot = C.face(kn) > -0.05 ? decal(C, kc, kn, () => `<path d="M0 0 C-2.4 -3.6 -7 -4 -7 -.6 C-7 2 -3 2 0 0 Z M0 0 C2.4 -3.6 7 -4 7 -.6 C7 2 3 2 0 0 Z M-.6 .6 L-3 7 L-1.2 6.4 Z M.6 .6 L3 7 L1.2 6.4 Z" ${FILL(col)}/><path d="M0 0 C-2.4 -3.6 -7 -4 -7 -.6 C-7 2 -3 2 0 0 Z M0 0 C2.4 -3.6 7 -4 7 -.6 C7 2 3 2 0 0 Z" fill="url(#acD${id})"/><circle r="1.6" ${FILL(col)}/><circle r="1.6" fill="#2a1d14" opacity=".18"/>`, { minW: .45, s: .9 }).svg : '';
    const hi = C.xy([-rx * .45, -10.5, rz * .5]);
    L.front.push(`<path d="${crownD}" fill="#2a1d14" opacity=".25" transform="translate(0 1.5)" filter="url(#b1${id})"/>
      <path d="${crownD}" fill="url(#acS${id})" filter="url(#acZ${id})"/>${weave}<path d="${crownD}" fill="url(#acV${id})"/>
      <ellipse cx="${f1(hi[0])}" cy="${f1(hi[1])}" rx="4.5" ry="2.4" fill="#fffbe8" opacity=".5" filter="url(#b1${id})"/>
      ${ribbon}${knot}${B.front}`);
  }

  // 毛線帽：罩住頭頂、反摺的羅紋帽緣、頂上一顆毛球；耳朵從耳洞鑽出來
  function beanie(H, L, ctx, col) {
    const id = ctx.id, E = [0, 44, HE[2], 33.5, 32.5, HE[5] + 2.5], pts = [];
    const ycb = (a) => 31.5 + 3 * Math.cos(a);          // 帽緣下緣（前面低、後面高）
    const sp = (a, e) => [E[3] * Math.cos(e) * Math.sin(a), E[1] - E[4] * Math.sin(e), E[2] + E[5] * Math.cos(e) * Math.cos(a)];
    const eEnd = (a) => Math.asin(Math.max(-1, Math.min(1, (E[1] - ycb(a)) / E[4])));
    for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2, e0 = eEnd(a); for (let j = 0; j <= 7; j++) pts.push(sp(a, e0 + (Math.PI / 2 - e0) * j / 7)); }
    pts.push([0, 8, HE[2] - 2]);                               // 頂端微微尖起（有點鬆垮）
    const d = blob(H, pts);
    // 直向羅紋
    const ribs = [];
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2, e0 = eEnd(a) + .12, seg = [];
      for (let j = 0; j <= 8; j++) { const e = e0 + (Math.PI / 2 - .2 - e0) * j / 8, p = sp(a, e), n = [Math.cos(e) * Math.sin(a) / E[3], -Math.sin(e) / E[4], Math.cos(e) * Math.cos(a) / E[5]]; seg.push(H.face(n) > .12 && !H.hid(add(p, mul(norm(n), 1))) ? H.xy(p) : null); }
      let cur = [];
      seg.concat([null]).forEach((q) => { if (q) cur.push(q); else { if (cur.length > 1) ribs.push(pathOpen(cur)); cur = []; } });
    }
    // 反摺帽緣
    const cuff = [], cns = [];
    for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2, y = ycb(a) - 3.4, e = Math.asin((E[1] - y) / E[4]), k = 1.04; cuff.push([E[3] * k * Math.cos(e) * Math.sin(a), y, E[2] + E[5] * k * Math.cos(e) * Math.cos(a)]); cns.push([Math.sin(a) / E[3], 0, Math.cos(a) / E[5]]); }
    const cw = 7.4 * ctx.hs;
    const cuffS = ringRuns(H, cuff, cns, { off: 1 }).map((r) => { const p = pathOpen(r.xy); return `<path d="${p}" fill="none" stroke="#2a1d14" stroke-width="${f1(cw)}" opacity=".18" transform="translate(0 1.4)" filter="url(#b1${id})"/><path d="${p}" fill="none" stroke="#2a1d14" stroke-width="${f1(cw)}" opacity=".2" transform="translate(0 -2.6)" filter="url(#b1${id})"/><path d="${p}" fill="none" ${STROKE(col)} stroke-width="${f1(cw)}" filter="url(#acZ${id})"/><path d="${p}" fill="none" stroke="#ffffff" stroke-width="${f1(cw)}" opacity=".16"/><path d="${p}" fill="none" stroke="#2a1d14" stroke-width="${f1(cw * .9)}" stroke-dasharray=".9 2.1" opacity=".14"/><path d="${p}" fill="none" stroke="#ffffff" stroke-width="${f1(cw * .25)}" opacity=".22" transform="translate(0 -2)" filter="url(#acB${id})"/>`; }).join('');
    // 毛球
    const pc = H.P([0, 6.5, HE[2] - 3]), pr = 6.8 * ctx.hs;
    const pom = `<circle cx="${f1(pc.X + .8)}" cy="${f1(pc.Y + 2)}" r="${f1(pr)}" fill="#2a1d14" opacity=".2" filter="url(#b1${id})"/>
      <circle cx="${f1(pc.X)}" cy="${f1(pc.Y)}" r="${f1(pr)}" fill="#fbf3e4" filter="url(#fz${id})"/><circle cx="${f1(pc.X)}" cy="${f1(pc.Y)}" r="${f1(pr)}" fill="url(#acV${id})" filter="url(#fz${id})"/>
      <ellipse cx="${f1(pc.X - 2)}" cy="${f1(pc.Y - 2.4)}" rx="2.6" ry="1.6" fill="#ffffff" opacity=".7" filter="url(#acB${id})"/>`;
    L.front.push(`<path d="${d}" fill="#2a1d14" opacity=".22" transform="translate(0 1.6)" filter="url(#b1${id})"/>
      <path d="${d}" ${FILL(col)} filter="url(#fz${id})"/>
      <g opacity=".9">${ribs.map((p) => `<path d="${p}" fill="none" stroke="#2a1d14" stroke-width="1.1" opacity=".13" stroke-linecap="round"/><path d="${p}" fill="none" stroke="#ffffff" stroke-width=".7" opacity=".12" stroke-linecap="round" transform="translate(.9 0)"/>`).join('')}</g>
      <path d="${d}" fill="url(#acV${id})" filter="url(#fz${id})"/>
      ${pom}`);
    // 耳朵從帽子的耳洞鑽出來；帽緣最後畫，壓住耳根，上緣再壓一道陰影
    L.overEars.push(cuffS);
    L.earsOver = true;
  }

  // 圓框眼鏡：鏡片綁在眼睛的 3D 位置（眼睛看不到的那一側就不畫，不會飄在臉外）；
  // 鏡腳只畫近側、只到耳朵前面；轉到背面整副都看不到
  function glasses(H, L, ctx, col) {
    const id = ctx.id, out = [], sw = 1.9;
    let shown = 0;
    [-1, 1].forEach((k) => {
      const en = norm([k * .5, 0, .87]);                // 與 quokka-pose.js 判斷眼睛是否可見的法向量相同
      if (H.face(en) <= 0.05) return;
      shown++;
      const c = add([k * 13.5, 43, 21], mul(en, 5)), n = norm([k * .32, 0, 1]);
      const D = decal(H, c, n, () => `
        <circle r="7.4" fill="#e9f3fb" opacity=".16"/>
        <path d="M-4.6 -3.6 Q-2 -5.6 1.2 -5.2" fill="none" stroke="#ffffff" stroke-width="1.3" stroke-linecap="round" opacity=".55" filter="url(#acB${id})"/>
        <circle r="7.4" fill="none" stroke="#2a1d14" stroke-width="${sw + .8}" opacity=".18" transform="translate(.5 1)" filter="url(#acB${id})"/>
        <circle r="7.4" fill="none" ${STROKE(col)} stroke-width="${sw}"/>
        <path d="M-6.4 -3.6 A7.4 7.4 0 0 1 -1 -7.3" fill="none" stroke="#ffffff" stroke-width=".6" opacity=".55"/>`, { minW: .5 });
      out.push({ z: D.Z, svg: D.svg });
      // 鏡腳：從鏡框外緣沿頭側到耳朵前面
      if (H.face([k, 0, 0]) > .15) {
        const tp = [[k * 21.6, 42.4, 24.6], [k * 27, 41.8, 17.5], [k * 30.6, 41.2, 9], [k * 31.6, 40.6, 2]];
        const vis = tp.map((p) => !H.hid(add(p, mul(headN(p), 1.6))));
        runs(vis, false).forEach((r) => {
          const xy = r.idx.map((i) => H.xy(tp[i]));
          if (xy.length > 1) out.push({ z: -99, svg: `<path d="${pathOpen(xy)}" fill="none" ${STROKE(col)} stroke-width="${f1(sw * .85)}" stroke-linecap="round"/>` });
        });
      }
    });
    // 鼻樑：兩片鏡片都看得到才畫
    if (shown === 2) {
      const br = [[-7, 41.6, 28.6], [-3.2, 39.6, 31.4], [0, 39.2, 32.2], [3.2, 39.6, 31.4], [7, 41.6, 28.6]];
      out.push({ z: 0, svg: `<path d="${pathOpen(br.map(H.xy))}" fill="none" ${STROKE(col)} stroke-width="${f1(sw)}" stroke-linecap="round"/>` });
    }
    if (out.length) L.top.push(out.sort((p, q) => p.z - q.z).map((p) => p.svg).join(''));
    else L.back.push('<g class="acc-hidden"/>');          // 整副被頭擋住：留一個空群組（飾品顏色變數仍在）
  }

  // 脖子上的環（身體座標）：中心、半徑、前低後高的傾斜
  const NZ = -2;                                        // 脖子截面的中心（身體座標 z）
  const neckRing = (y, tilt, rx, rz, N = 72) => {
    const pts = [], ns = [];
    for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; pts.push([rx * Math.sin(a), y + tilt * Math.cos(a), NZ + rz * Math.cos(a)]); ns.push(norm([Math.sin(a) / rx, 0, Math.cos(a) / rz])); }
    return { pts, ns };
  };

  // 小圍巾：毛線織的條紋圍巾繞脖子一圈，前面右側垂下兩條流蘇尾巴
  function scarf(B, L, ctx, col) {
    const id = ctx.id, R = neckRing(81, 4, 33, 29.5), w = 11;
    const ring = ringRuns(B, R.pts, R.ns, { off: 4 }).map((r) => { const p = pathOpen(r.xy); return `
      <path d="${p}" fill="none" stroke="#2a1d14" stroke-width="${w + 1}" opacity=".22" transform="translate(0 2.2)" filter="url(#b1${id})" stroke-linecap="round"/>
      <path d="${p}" fill="none" ${STROKE(col)} stroke-width="${w}" stroke-linecap="round" filter="url(#fz${id})"/>
      <path d="${p}" fill="none" stroke="#fbf3e4" stroke-width="${w * .92}" stroke-dasharray="2.6 5.4" opacity=".75" filter="url(#acZ${id})"/>
      <path d="${p}" fill="none" stroke="#ffffff" stroke-width="${w * .3}" opacity=".22" transform="translate(0 -2.6)" filter="url(#acB${id})"/>
      <path d="${p}" fill="none" stroke="#2a1d14" stroke-width="${w * .3}" opacity=".14" transform="translate(0 3)" filter="url(#acB${id})"/>`; }).join('');
    const a0 = rad(38), c = [34.5 * Math.sin(a0), 81 + 4 * Math.cos(a0) + 1, NZ + 31 * Math.cos(a0)], n = [Math.sin(a0), .1, Math.cos(a0)];
    const tail = (x, rot, len) => `<g transform="translate(${x} 0) rotate(${rot})">
        <path d="M-4.2 0 L4.2 0 L4.6 ${len} L-3.8 ${len} Z" fill="#2a1d14" opacity=".2" transform="translate(.8 1.4)" filter="url(#b1${id})"/>
        <path d="M-4.2 0 L4.2 0 L4.6 ${len} L-3.8 ${len} Z" ${FILL(col)} filter="url(#acZ${id})"/>
        ${[5, 13, 21].filter((y) => y < len - 2).map((y) => `<rect x="-4.3" y="${y}" width="8.9" height="3.6" fill="#fbf3e4" opacity=".75"/>`).join('')}
        <path d="M-4.2 0 L4.2 0 L4.6 ${len} L-3.8 ${len} Z" fill="url(#acD${id})" opacity=".8"/>
        <path d="${[-3, -1.5, 0, 1.5, 3, 4.2].map((x2) => `M${x2} ${len} l${f1(x2 * .06)} 3.2`).join(' ')}" ${STROKE(col)} stroke-width="1.1" stroke-linecap="round"/></g>`;
    const down = norm([0, 1, .38]);                     // 尾巴順著胸口的弧度往前垂
    const D = decal(B, c, n, () => `${tail(2.2, -6, 26)}${tail(-1.6, 9, 21)}<ellipse cx="0" cy="0" rx="6" ry="4.6" ${FILL(col)} filter="url(#fz${id})"/><ellipse cx="0" cy="0" rx="6" ry="4.6" fill="url(#acV${id})"/>`, { minW: .5, down });
    // 上端或中段任一被身體擋住 → 整條放後層，由身體輪廓遮住
    // 尾巴貼著胸口：背對觀者時也放後層（只露出輪廓外的部分）
    const tailsHidden = B.face(n) < .1 || B.hid(add(c, mul(norm(n), 3))) || B.hid(add(add(c, mul(down, 14)), mul(norm(n), 3)));
    if (tailsHidden) L.back.push(D.svg);
    L.front.push(ring + (tailsHidden ? '' : D.svg));
  }

  // 三角領巾：細帶子繞脖子，前面垂一片有白點點的三角巾（包到脖子兩側，側面看也是一片布，不是一條線）；
  // 背面才看得到貼在後頸的小結
  function bandana(B, L, ctx, col) {
    const id = ctx.id, R = neckRing(82, 2, 32.4, 29.4);
    const strap = ringRuns(B, R.pts, R.ns, { off: 2 }).map((r) => `<path d="${pathOpen(r.xy)}" fill="none" ${STROKE(col)} stroke-width="3.8" filter="url(#acZ${id})"/><path d="${pathOpen(r.xy)}" fill="none" stroke="#2a1d14" stroke-width="1.2" opacity=".16" transform="translate(0 1.4)"/>`).join('');
    // 三角巾：頂邊沿著環的前 3/4 圈、尖端垂到胸前並略往前鼓（直接用 3D 點）
    const edge = [];
    for (let a = -84; a <= 84; a += 8) { const t = rad(a); edge.push([33.4 * Math.sin(t), 82 + 2 * Math.cos(t) - .5, NZ + 30.6 * Math.cos(t)]); }
    const tip = [0, 107, 29], cen = [0, 91, 29];
    const poly = edge.concat([[19, 93, 22], [9, 101, 27.5], tip, [-9, 101, 27.5], [-19, 93, 22]]);
    const d = cr(hull(poly.map(B.xy)));
    const dots = [[-13, 88, 26.5], [0, 87.5, 30], [13, 88, 26.5], [-6.5, 95, 28.5], [6.5, 95, 28.5], [0, 102, 29.5], [-23, 86, 17], [23, 86, 17]].map((p) => {
      const nn = norm([p[0] / 30, .15, 1]);
      return B.face(nn) > .15 ? decal(B, p, nn, () => '<circle r="1.35" fill="#fbf3e4" opacity=".9"/>', {}).svg : '';
    }).join('');
    const vis = B.face([0, .2, 1]) > -.3;
    const cloth = `<path d="${d}" fill="#2a1d14" opacity=".22" transform="translate(0 2)" filter="url(#b1${id})"/>
      <path d="${d}" ${FILLSTROKE(col)} stroke-width="1.6" stroke-linejoin="round" filter="url(#acZ${id})"/>
      ${dots}<path d="${d}" fill="url(#acD${id})" opacity=".9"/>`;
    // 背後的結：貼在後頸上，朝向觀者才畫（側面不會多出一個飄著的小結）
    const kc = [0, 82.5, NZ - 30.2];
    const knot = B.face([0, 0, -1]) > .3 && !B.hid(add(kc, [0, 0, -2])) ? decal(B, kc, [0, 0, -1], () => `<path d="M0 0 C-2.4 -3.4 -6.6 -3.4 -6.4 0 C-6.2 2.6 -2.4 2 0 0 Z M0 0 C2.4 -3.4 6.6 -3.4 6.4 0 C6.2 2.6 2.4 2 0 0 Z M-.8 .8 L-3.6 7.4 L-1.4 7 Z M.8 .8 L3.6 7.4 L1.4 7 Z" ${FILL(col)}/><path d="M0 0 C-2.4 -3.4 -6.6 -3.4 -6.4 0 C-6.2 2.6 -2.4 2 0 0 Z M0 0 C2.4 -3.4 6.6 -3.4 6.4 0 C6.2 2.6 2.4 2 0 0 Z" fill="url(#acD${id})"/><circle r="1.7" ${FILL(col)}/><circle r="1.7" fill="#2a1d14" opacity=".2"/>`, { minW: .5, s: 1.15 }).svg : '';
    if (vis) L.front.push(strap + cloth + knot); else { L.back.push(cloth); L.front.push(strap + knot); }
  }

  // 鈴鐺項圈：皮革細項圈，前面掛一顆金色小鈴鐺
  function collar(B, L, ctx, col) {
    const id = ctx.id, R = neckRing(85, 1.6, 32, 29);
    const strap = ringRuns(B, R.pts, R.ns, { off: 2 }).map((r) => { const p = pathOpen(r.xy); return `<path d="${p}" fill="none" stroke="#2a1d14" stroke-width="5.6" opacity=".2" transform="translate(0 1.4)" filter="url(#b1${id})"/><path d="${p}" fill="none" ${STROKE(col)} stroke-width="4.6"/><path d="${p}" fill="none" stroke="#ffffff" stroke-width=".6" stroke-dasharray="1.6 1.6" opacity=".6"/><path d="${p}" fill="none" stroke="#ffffff" stroke-width="1.4" opacity=".2" transform="translate(0 -1.2)" filter="url(#acB${id})"/>`; }).join('');
    const bc = [0, 92.5, 28.6], q = B.P(bc), r = 5.2;
    const ring = B.P([0, 87.4, 27.4]);
    const bell = `<ellipse cx="${f1(ring.X)}" cy="${f1(ring.Y)}" rx="1.6" ry="1.4" fill="none" stroke="#c49a3a" stroke-width="1"/>
      <circle cx="${f1(q.X + .8)}" cy="${f1(q.Y + 1.4)}" r="${r}" fill="#2a1d14" opacity=".22" filter="url(#b1${id})"/>
      <circle cx="${f1(q.X)}" cy="${f1(q.Y)}" r="${r}" fill="url(#acG${id})"/>
      <path d="M${f1(q.X - r * .92)} ${f1(q.Y - .2)} Q${f1(q.X)} ${f1(q.Y + 1.6)} ${f1(q.X + r * .92)} ${f1(q.Y - .2)}" fill="none" stroke="#9a6f22" stroke-width=".7" opacity=".7"/>
      <circle cx="${f1(q.X)}" cy="${f1(q.Y + 2.2)}" r=".9" fill="#7a541a"/><path d="M${f1(q.X)} ${f1(q.Y + 2.6)} V${f1(q.Y + r - .3)}" stroke="#7a541a" stroke-width=".7"/>
      <ellipse cx="${f1(q.X - 1.6)}" cy="${f1(q.Y - 2)}" rx="1.5" ry=".9" fill="#ffffff" opacity=".8" filter="url(#acB${id})"/>`;
    if (B.hid(add(bc, [0, 0, 4]))) { L.back.push(bell); L.front.push(strap); } else L.front.push(strap + bell);
  }

  // 葉子花冠：細枝繞頭一圈，綴著銀灰綠的細葉與幾朵小花
  function wreath(H, L, ctx, col) {
    const id = ctx.id, N = 72, pts = [], ns = [];
    const at = (a) => { const y = 22.5 + 2.8 * Math.cos(a), k = Math.sqrt(Math.max(0, 1 - ((y - 45) / 30) ** 2)); return [HE[3] * k * 1.05 * Math.sin(a), y, HE[2] + HE[5] * k * 1.05 * Math.cos(a)]; };
    for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2, p = at(a); pts.push(p); ns.push(radialN(p)); }
    const twig = ringRuns(H, pts, ns, { faceOnly: true }).map((r) => `<path d="${pathOpen(r.xy)}" fill="none" stroke="#2a1d14" stroke-width="2.4" opacity=".16" transform="translate(0 1.2)" filter="url(#acB${id})"/><path d="${pathOpen(r.xy)}" fill="none" stroke="#8a7a5c" stroke-width="1.5"/>`).join('');
    const items = [];
    const leafP = 'M0 0 C2.3 2.6 2.4 8 0 11.5 C-2.4 8 -2.3 2.6 0 0 Z';
    for (let i = 0; i < 18; i++) {
      // 葉面朝外略往上（像花冠立在頭上），不完全貼平；頭往後仰時才不會變成一條線
      const a = (i / 18) * Math.PI * 2 + .08, p = at(a), n = norm(add(radialN(p), mul(headN(p), .5))), t = norm(sub(at(a + .05), at(a - .05)));
      const tw = i % 2 ? .7 : -.7;
      const down = norm(add(t, mul(norm(cross(n, t)), tw)));
      const c2 = add(p, mul(n, 1));
      const D = decal(H, c2, n, () => `<path d="${leafP}" fill="#4a3a2e" opacity=".2" transform="translate(.5 .9)" filter="url(#acB${id})"/><path d="${leafP}" fill="url(#acL${id})" filter="url(#acZ${id})"/><path d="M0 1 Q.3 5.5 0 10" fill="none" stroke="#eef3e6" stroke-width=".6" opacity=".75"/>`, { down, s: 1.05, minW: .35 });
      items.push({ hid: H.face(radialN(p)) < 0, z: D.Z, svg: D.svg });
    }
    [-1.15, -.45, .25, .95, 2.6].forEach((a, i) => {
      const p = add(at(a), mul(headN(at(a)), 1.8)), n = norm(add(radialN(at(a)), mul(headN(at(a)), .5)));
      const pet = [0, 72, 144, 216, 288].map((r) => `<ellipse cx="0" cy="-2.3" rx="1.7" ry="2.4" transform="rotate(${r})" ${FILL(col)}/>`).join('');
      const D = decal(H, p, n, () => `<circle r="4" fill="#4a3a2e" opacity=".2" transform="translate(.5 .8)" filter="url(#acB${id})"/>${pet}<circle r="3.8" fill="url(#acP${id})"/><circle r="1.2" fill="#f4d35e"/>`, { s: 1 + (i % 2) * .15 });
      items.push({ hid: H.face(radialN(p)) < 0, z: D.Z + 1, svg: D.svg });
    });
    items.sort((a, b) => a.z - b.z);
    L.back.push(items.filter((q) => q.hid).map((q) => q.svg).join(''));
    L.front.push(twig + items.filter((q) => !q.hid).map((q) => q.svg).join(''));
  }

  // 工地安全帽：小小一頂戴在兩耳之間，三道稜線、前面有帽舌（給建築師主人的工地夥伴）
  function hardhat(H, L, ctx, col) {
    const id = ctx.id, C = child(H, place([0, 21.5, 2], -4, 0, 0)), rx = 21, ry = 15.5, rz = 19.5;
    const sp = (a, e, k = 1) => [rx * k * Math.cos(e) * Math.sin(a), -ry * k * Math.sin(e), rz * k * Math.cos(e) * Math.cos(a)];
    const shell = [];
    for (let i = 0; i < 32; i++) for (let j = 0; j <= 7; j++) shell.push(sp(i / 32 * Math.PI * 2, j / 7 * Math.PI / 2));
    const d = blob(C, shell);
    const B = brim(C, L, ctx, { rx: rx - .5, rz: rz - .5, outer: (a) => { const f = Math.max(0, Math.cos(a)) ** 1.6; return [rx + 2.2 + 6.5 * f, rz + 2.2 + 8.5 * f]; }, droop: (a) => 1 + 1.6 * Math.max(0, Math.cos(a)), fill: FILL(col) });
    L.back.push(B.back);
    const ridge = (x0, w) => {
      const seg = [];
      for (let j = 0; j <= 24; j++) {
        const t = -Math.PI / 2 + j / 24 * Math.PI, a = t < 0 ? Math.PI : 0, e = Math.PI / 2 - Math.abs(t);
        const p = [x0, -ry * 1.05 * Math.sin(e), rz * 1.05 * Math.cos(e) * (a ? -1 : 1)];
        const kx = Math.sqrt(Math.max(0, 1 - (x0 / rx) ** 2));
        p[1] *= kx; p[2] *= kx;
        const n = [x0 / (rx * rx), p[1] / (ry * ry), p[2] / (rz * rz)];
        seg.push(C.face(n) > .05 ? C.xy(p) : null);
      }
      const out = []; let cur = [];
      seg.concat([null]).forEach((q) => { if (q) cur.push(q); else { if (cur.length > 1) out.push(pathOpen(cur)); cur = []; } });
      return out.map((p) => `<path d="${p}" fill="none" stroke="#2a1d14" stroke-width="${w + .6}" opacity=".14" transform="translate(.6 .6)" filter="url(#acB${id})"/><path d="${p}" fill="none" ${STROKE(col)} stroke-width="${w}" stroke-linecap="round"/><path d="${p}" fill="none" stroke="#ffffff" stroke-width="${w * .35}" opacity=".45" stroke-linecap="round"/>`).join('');
    };
    const hi = C.xy([-rx * .4, -ry * .78, rz * .35]), hi2 = C.xy([rx * .5, -ry * .3, rz * .6]);
    L.front.push(`<path d="${d}" fill="#2a1d14" opacity=".25" transform="translate(0 1.8)" filter="url(#b1${id})"/>
      <path d="${d}" ${FILL(col)}/><path d="${d}" fill="url(#acV${id})"/>
      ${ridge(0, 3.2)}${ridge(-7.5, 1.8)}${ridge(7.5, 1.8)}
      <ellipse cx="${f1(hi[0])}" cy="${f1(hi[1])}" rx="4.6" ry="2.2" fill="#ffffff" opacity=".7" filter="url(#b1${id})"/>
      <ellipse cx="${f1(hi2[0])}" cy="${f1(hi2[1])}" rx="1.6" ry="1" fill="#ffffff" opacity=".5" filter="url(#acB${id})"/>
      ${B.front}`);
  }

  // 貝雷帽：扁圓、往右歪戴，頂上一根小短梗
  function beret(H, L, ctx, col) {
    const id = ctx.id, C = child(H, place([3.5, 15, 2], -6, 13, 0)), rx = 25, ry = 8.2, rz = 22.5;
    const pts = [];
    for (let i = 0; i < 36; i++) for (let j = -6; j <= 6; j++) { const a = i / 36 * Math.PI * 2, e = j / 6 * Math.PI / 2; pts.push([rx * Math.cos(e) * Math.sin(a), -ry * Math.sin(e) - (j < 0 ? 0 : 0), rz * Math.cos(e) * Math.cos(a)]); }
    const d = blob(C, pts);
    // 帽口的滾邊
    const rim = [], rns = [];
    for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2; rim.push([18.5 * Math.sin(a), 4.6, 16.2 * Math.cos(a)]); rns.push([Math.sin(a), .3, Math.cos(a)]); }
    const band = ringRuns(C, rim, rns, { off: 1 }).map((r) => `<path d="${pathOpen(r.xy)}" fill="none" ${STROKE(col)} stroke-width="2.6"/><path d="${pathOpen(r.xy)}" fill="none" stroke="#2a1d14" stroke-width="2.6" opacity=".28"/>`).join('');
    const st = C.P([0, -ry - 1.6, 0]), hi = C.xy([-rx * .35, -ry * .8, rz * .3]);
    L.front.push(`<path d="${d}" fill="#2a1d14" opacity=".25" transform="translate(0 2)" filter="url(#b1${id})"/>${band}
      <path d="${d}" ${FILL(col)} filter="url(#acZ${id})"/><path d="${d}" fill="url(#acV${id})"/>
      <path d="${d}" fill="none" stroke="#2a1d14" stroke-width="1.4" opacity=".12" filter="url(#acB${id})"/>
      <ellipse cx="${f1(hi[0])}" cy="${f1(hi[1])}" rx="6" ry="2" fill="#ffffff" opacity=".28" filter="url(#b1${id})"/>
      <path d="M${f1(st.X)} ${f1(st.Y + 2)} q.4 -2.6 1.6 -3.2" fill="none" ${STROKE(col)} stroke-width="1.8" stroke-linecap="round"/>
      <path d="M${f1(st.X)} ${f1(st.Y + 2)} q.4 -2.6 1.6 -3.2" fill="none" stroke="#2a1d14" stroke-width="1.8" stroke-linecap="round" opacity=".15"/>`);
  }

  const DRAW = { band, bow, flower, straw, beanie, glasses, scarf, bandana, collar, wreath, hardhat, beret };
  const BODY_TYPES = new Set(['scarf', 'bandana', 'collar']);

  // 規格整理：pose.accessory／traits.accessory 可以是字串、物件、陣列或 { type, color, extra }；
  // 沒有資料時預設頭帶（舊存檔）；'none'／false／[] 表示不戴
  function resolve(spec, traits) {
    if (spec === undefined || spec === null) spec = traits && traits.accessory;
    if (spec === undefined || spec === null) return [{ type: 'band', color: (traits && traits.band) || undefined }];
    if (spec === false || spec === 'none') return [];
    const list = [];
    const push = (s) => {
      if (!s) return;
      if (typeof s === 'string') s = { type: s };
      if (!DRAW[s.type]) return;
      list.push({ type: s.type, color: s.color || (s.type === 'band' && traits && traits.band) || undefined });
      if (s.extra) push(s.extra);
    };
    (Array.isArray(spec) ? spec : [spec]).forEach(push);
    return list;
  }

  // ctx：{ id, th, PH(p)→{X,Y,Z}, PB(p)→{X,Y,Z}, head: 頭部橢球 [[cx,cy,cz,rx,ry,rz]…], body: 身體橢球, hs }
  function draw(list, ctx) {
    const L = { back: [], ear: [], front: [], overEars: [], top: [], earsOver: false };
    if (ctx.head && ctx.head[0]) HE = ctx.head[0];
    if (!list || !list.length) return L;
    const H = space(ctx.PH, ctx.head), B = space(ctx.PB, ctx.body);
    const c2 = { hs: 1, ...ctx };
    // 帽子類先畫、頸部再畫；同一層內依清單順序
    list.forEach((a) => {
      const def = TYPES[a.type], col = def.color;
      const sub = { back: [], ear: [], front: [], overEars: [], top: [], earsOver: false };
      DRAW[a.type](BODY_TYPES.has(a.type) ? B : H, sub, c2, col);
      const wrap = (s) => (a.color ? `<g style="--acc:${a.color}">${s}</g>` : s);
      ['back', 'front', 'overEars', 'top'].forEach((k) => { const s = sub[k].join(''); if (s.trim()) L[k].push(wrap(s)); });
      sub.ear.forEach((e) => L.ear.push({ z: e.z, svg: wrap(e.svg) }));
      if (sub.earsOver) L.earsOver = true;
    });
    return L;
  }

  const api = { TYPES, resolve, draw, defs: DEFS, _space: space };
  if (typeof window !== 'undefined') window.QuokkaAcc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
