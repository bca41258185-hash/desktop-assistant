// 短尾矮袋鼠個體特徵：每次「生成」都抽一組不同、但落在真實範圍內的體型、年齡與毛色。
// 主行程用它產生並存檔；renderer 用它把特徵換算成造型參數（身形寬窄、臉頰、耳朵、尾長、整體大小、毛色）。
//
// 真實範圍（成年個體）：
//   頭身長：公 43–54 cm、母 39–50 cm；尾長：公 25–31 cm、母 23.5–28.5 cm
//   體重：公 2.7–4.2 kg、母 1.6–3.5 kg（亞成體依成長比例縮小）
//   壽命：野外約 10 年、圈養可到 14 年；約 1 歲到 1 歲半性成熟
//   毛色：上身灰褐帶紅棕色調、腹面較淺；頭部常偏紅；個體間深淺不同，本島（Rottnest）與大陸族群也有差異
// 資料來源：西澳政府生物多樣性保育部（DBCA）物種資料、澳洲博物館、Animal Diversity Web。
// 造型仍是可愛插畫風：特徵差異會「看得出來」，但不會把角色畫到變形。

(function () {
  const RANGES = {
    male: { len: [43, 54], tail: [25, 31], wt: [2.7, 4.2] },
    female: { len: [39, 50], tail: [23.5, 28.5], wt: [1.6, 3.5] }
  };
  // 毛色類型：相對於預設暖棕的色相／彩度／明度位移；rufous＝臉部偏紅程度
  const FUR_TYPES = [
    { id: 'warm', name: '暖棕', w: 30, dh: 0, sat: 1, dl: 0, rufous: 0.2 },
    { id: 'grey', name: '灰褐', w: 25, dh: -3, sat: 0.6, dl: -0.015, rufous: 0.1 },
    { id: 'rufous', name: '紅褐', w: 18, dh: -7, sat: 1.15, dl: -0.03, rufous: 0.6 },
    { id: 'dark', name: '深棕', w: 15, dh: -2, sat: 0.88, dl: -0.075, rufous: 0.25 },
    { id: 'sand', name: '淺沙', w: 12, dh: 4, sat: 0.82, dl: 0.06, rufous: 0.05 }
  ];
  const BAND_COLORS = ['#e5533d', '#3f7fd9', '#e9a23b', '#3fa66b', '#a05ad1', '#e2588f'];

  // 可重現的亂數（同一個 seed 產生同一隻）
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  function normal(r) { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  // 範圍內的常態分佈：平均在中間，約 95% 落在範圍內，超出就夾回範圍
  const inRange = (r, [a, b], z) => clamp(lerp(a, b, 0.5 + (z === undefined ? normal(r) : z) / 4), a, b);
  function pickWeighted(r, list) { let t = r() * list.reduce((s, x) => s + x.w, 0); for (const x of list) { t -= x.w; if (t <= 0) return x; } return list[0]; }

  function generate(seed) {
    if (seed === undefined) seed = Math.floor(Math.random() * 2 ** 31);
    const r = rng(seed);
    const sex = r() < 0.5 ? 'male' : 'female', R = RANGES[sex];
    // 年齡：亞成體 10–17 個月 15%、成年 1.5–8 歲 70%、年長 8–14 歲 15%（10 歲以上較少）
    const ar = r();
    const ageMonths = ar < 0.15 ? Math.round(lerp(10, 17, r()))
      : ar < 0.85 ? Math.round(lerp(18, 96, r()))
        : Math.round(lerp(97, 168, Math.pow(r(), 1.6)));
    const stage = ageMonths < 18 ? 'juvenile' : ageMonths > 96 ? 'senior' : 'adult';
    // 體型：身長與尾長、體重相關（大隻的通常也比較重），再加上個體胖瘦
    const zLen = clamp(normal(r), -2, 2);
    let lengthCm = inRange(r, R.len, zLen);
    let tailCm = inRange(r, R.tail, clamp(zLen * 0.6 + normal(r) * 0.8, -2, 2));
    const zCond = clamp(normal(r), -2.2, 2.2);
    let weightKg = inRange(r, R.wt, clamp(zLen * 0.85 + zCond * 0.5, -2, 2));
    // 亞成體還在長：10 個月約成年的 78% 身長
    const grow = stage === 'juvenile' ? lerp(0.78, 0.97, (ageMonths - 10) / 7) : 1;
    lengthCm *= grow; tailCm *= grow; weightKg *= Math.pow(grow, 2.6);
    if (stage === 'senior') weightKg *= 0.96;
    // 胖瘦指數：實際體重 ÷ 同性別同身長的預期體重
    const expected = lerp(R.wt[0], R.wt[1], clamp((lengthCm / grow - R.len[0]) / (R.len[1] - R.len[0]), 0, 1)) * Math.pow(grow, 2.6);
    const condition = clamp(weightKg / expected, 0.8, 1.25);
    // 毛色：先抽類型，再做個體微調；年長個體毛色稍灰
    const ft = pickWeighted(r, FUR_TYPES);
    const fur = {
      type: ft.id, name: ft.name,
      dh: round(ft.dh + (r() - 0.5) * 5, 2),
      sat: round(clamp(ft.sat + (r() - 0.5) * 0.12, 0.5, 1.25), 3),
      dl: round(ft.dl + (r() - 0.5) * 0.04, 3),
      rufous: round(clamp(ft.rufous + (r() - 0.5) * 0.3, 0, 1), 2),
      grey: round(stage === 'senior' ? lerp(0.12, 0.3, (ageMonths - 97) / 71) : stage === 'juvenile' ? 0.04 : r() * 0.06, 3),
      bellyLight: round((r() - 0.5) * 0.05, 3)
    };
    return {
      v: 1, seed, sex, ageMonths, stage,
      lengthCm: round(lengthCm), tailCm: round(tailCm), weightKg: round(weightKg, 2),
      sitHeightCm: round(lengthCm * 0.74),           // 坐姿立起時的高度（估算：頭身長 × 0.74）
      condition: round(condition, 3),
      earK: round(lerp(0.92, 1.08, r()), 3),
      cheekK: round((sex === 'male' ? 1.04 : 0.97) + (r() - 0.5) * 0.06, 3),
      fur,
      band: BAND_COLORS[Math.floor(r() * BAND_COLORS.length)]
    };
  }

  // ---------------------------------------------------------------------------
  // 文字描述（面板「檔案卡」用）
  // ---------------------------------------------------------------------------
  function buildName(c) { return c < 0.92 ? '偏瘦' : c < 1.06 ? '標準' : c < 1.14 ? '圓潤' : '胖嘟嘟'; }
  function ageText(m) {
    if (m < 24) return m + ' 個月';
    const y = Math.floor(m / 12), mo = m % 12;
    return y + ' 歲' + (mo ? ' ' + mo + ' 個月' : '');
  }
  function describe(t) {
    if (!t) return [];
    return [
      ['性別', t.sex === 'male' ? '公' : '母'],
      ['年齡', ageText(t.ageMonths) + '（' + { juvenile: '亞成體', adult: '成年', senior: '年長' }[t.stage] + '）'],
      ['頭身長', t.lengthCm + ' cm'],
      ['尾長', t.tailCm + ' cm'],
      ['坐高', '約 ' + t.sitHeightCm + ' cm'],
      ['體重', t.weightKg + ' kg'],
      ['體型', buildName(t.condition)],
      ['毛色', t.fur.name + (t.fur.rufous > 0.5 ? '，臉偏紅' : '') + (t.fur.grey > 0.12 ? '，略帶灰白' : '')]
    ];
  }

  // ---------------------------------------------------------------------------
  // 換算成造型參數
  // ---------------------------------------------------------------------------
  function shape(t) {
    if (!t) return null;
    const R = RANGES[t.sex] || RANGES.male;
    const widthK = clamp(1 + (t.condition - 1) * 0.85, 0.9, 1.13);
    // 畫面大小：最小的亞成體約 0.84、最大的公成體約 1.06
    const sizeK = clamp(lerp(0.88, 1.06, (t.lengthCm - 39) / 15), 0.82, 1.06);
    const tailK = clamp((t.tailCm / t.lengthCm) / 0.58, 0.86, 1.14);
    return { widthK, sizeK, tailK, earK: t.earK || 1, cheekK: t.cheekK || 1, juvenile: t.stage === 'juvenile', R };
  }

  // 毛色換算：只改「毛」的顏色（身體、背、尾、耳、手腳、陰影），眼睛、鼻子、頭帶、腮紅、道具都不動
  const FUR_BODY = ['#9a7650', '#b0855a', '#b0936c', '#cbb08a', '#93704c', '#a37a52', '#a38a6a', '#b9a283', '#94734f', '#7a5c40', '#5e4632',
    '#b38a5e', '#93744f', '#7c6244', '#76604a', '#71573e', '#68533e', '#a9845c', '#6e4f37', '#523826', '#3d291b', '#88633f', '#ad8455',
    '#7a5838', '#a08066', '#d8bd98', '#5a4232', '#4a3a2e', '#5a4a3d', '#4a3b30'];
  const FUR_LIGHT = ['#f0dcb9', '#f3e2c4', '#8a7460'];
  const FUR_RUFOUS = ['#dfa65e', '#f2c38c'];
  function hex2hsl(h) {
    const n = parseInt(h.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [hh * 60, s, l];
  }
  function hsl2hex(h, s, l) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
    return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  function colorMap(t) {
    const map = {};
    if (!t || !t.fur) return map;
    const F = t.fur, grey = F.grey || 0;
    const tf = (c, kind) => {
      let [h, s, l] = hex2hsl(c);
      if (kind === 'light') { h += F.dh * 0.5; s *= 1 + (F.sat - 1) * 0.5; l += F.dl * 0.4 + F.bellyLight; }
      else if (kind === 'rufous') { h += F.dh * 0.6 - 4 * (F.rufous - 0.2); s *= (1 + (F.sat - 1) * 0.5) * (1 + 0.12 * (F.rufous - 0.2)); l += F.dl * 0.8; }
      else { h += F.dh; s *= F.sat; l += F.dl * (1 - Math.abs(2 * l - 1) * 0.5); }
      s *= 1 - grey; l += grey * 0.25 * (0.75 - l);
      return hsl2hex(h, s, l);
    };
    FUR_BODY.forEach((c) => { map[c] = tf(c, 'body'); });
    FUR_LIGHT.forEach((c) => { map[c] = tf(c, 'light'); });
    FUR_RUFOUS.forEach((c) => { map[c] = tf(c, 'rufous'); });
    return map;
  }
  function recolor(svg, t) {
    const m = colorMap(t);
    return svg.replace(/#[0-9a-fA-F]{6}\b/g, (c) => m[c.toLowerCase()] || c);
  }

  const api = { generate, describe, shape, recolor, colorMap, RANGES, FUR_TYPES, BAND_COLORS };
  if (typeof window !== 'undefined') window.QuokkaTraits = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
