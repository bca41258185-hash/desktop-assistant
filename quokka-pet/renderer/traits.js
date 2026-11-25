// 短尾矮袋鼠個體特徵：每次「生成」都抽一組不同、但落在真實範圍內的體型、年齡、毛色，以及個性、社交風格與興趣。
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
    const t = {
      v: 1, seed, sex, ageMonths, stage,
      lengthCm: round(lengthCm), tailCm: round(tailCm), weightKg: round(weightKg, 2),
      sitHeightCm: round(lengthCm * 0.74),           // 坐姿立起時的高度（估算：頭身長 × 0.74）
      condition: round(condition, 3),
      earK: round(lerp(0.92, 1.08, r()), 3),
      cheekK: round((sex === 'male' ? 1.04 : 0.97) + (r() - 0.5) * 0.06, 3),
      fur,
      band: BAND_COLORS[Math.floor(r() * BAND_COLORS.length)]
    };
    t.personality = personality(t);
    return t;
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
  // 個性與興趣
  // 動物個性研究常用的面向：活潑（activity）、親人／社交（sociability）、膽量（boldness）、好奇（curiosity），
  // 另加「黏人」（affection）描述對使用者的依賴。依據：
  //   · 短尾矮袋鼠天性好奇、敢靠近人，但約五分之一的人與牠互動時牠會緊張 → 膽量有高有低
  //   · 袋鼠研究：膽子大的個體朋友也較多 → 膽量與社交正相關
  //   · 公的會依體重排地位、較常主動互動；母的很少主動社交 → 母的「主動找朋友」機率較低
  // ---------------------------------------------------------------------------
  const ACTIVITIES = {
    badminton: '羽球', volleyball: '排球', basketball: '籃球', eat: '吃葉子', hop: '跳跳', selfie: '自拍', nap: '打盹'
  };
  const HOBBIES = ['曬太陽', '看雲', '收集漂亮的葉子', '聽海浪聲', '數星星', '散步探險', '整理毛毛', '拍風景照', '研究零食', '聽音樂', '跟朋友聊天', '找陰涼的樹叢'];
  const ARCHETYPES = {
    athlete: { name: '運動健將', greet: '嗨！我是庫卡，今天打哪一種球？我已經熱身好了！', back: '你回來了！來，打一場！', pat: ['嘿嘿，好舒服。', '摸完再來打球！', '再摸一下就出發！'], petDone: '好，充電完畢！' },
    clingy: { name: '黏人開心果', greet: '嗨嗨！我是庫卡，可以一直待在你旁邊嗎？', back: '你終於回來了！我好想你～', pat: ['嘿嘿，好舒服。', '再摸一下嘛～', '最喜歡你了！'], petDone: '嘿嘿，謝謝你摸我。' },
    shy: { name: '害羞小可愛', greet: '那個……你好，我是庫卡。請、請多指教。', back: '啊……你回來了。（小聲）歡迎回來。', pat: ['嗚……有點不好意思。', '耳、耳朵癢癢的。', '……謝謝。'], petDone: '（臉紅）……謝謝。' },
    explorer: { name: '好奇探險家', greet: '你好！我是庫卡，你的桌面好多新東西，我可以到處看看嗎？', back: '你回來啦！剛剛我發現了好多東西！', pat: ['嘿嘿，好舒服。', '咦，你手上有什麼味道？', '再摸一下，我再去探險！'], petDone: '謝謝！我要繼續去探險了。' },
    sleepy: { name: '慵懶睡神', greet: '呼……我是庫卡。工作加油，我先瞇一下喔。', back: '嗯……你回來啦？我剛剛只是閉目養神。', pat: ['嗯……好舒服……', '再摸下去我會睡著喔……', '呼……'], petDone: '呼……謝謝……' },
    cool: { name: '獨立酷酷派', greet: '我是庫卡。你忙你的，我自己會找事做。', back: '喔，回來了。', pat: ['……還行。', '好啦好啦，夠了喔。', '哼，沒有很舒服啦。'], petDone: '好了，夠了。' },
    easy: { name: '隨和好夥伴', greet: '嗨，我是庫卡！今天也笑著把事情做完，等等一起打球吧。', back: '你回來啦！歡迎回來～', pat: ['嘿嘿，好舒服。', '耳朵癢癢的！', '再摸一下嘛～'], petDone: '嘿嘿，謝謝你摸我。' }
  };
  const SOCIAL_STYLES = {
    leader: '主動找朋友、喜歡帶頭玩',
    friendly: '朋友來找就很開心',
    watcher: '先在旁邊觀察，熟了才靠近',
    solo: '喜歡自己玩'
  };
  const sig = (z) => 1 / (1 + Math.exp(-1.7 * z));
  function personality(t) {
    const r = rng(((t.seed >>> 0) ^ 0x5bd1e995) >>> 0);
    const n = () => clamp(normal(r), -2.5, 2.5);
    const zb = n(), zs = 0.5 * zb + 0.87 * n(), zc = 0.4 * zb + 0.92 * n(), za = n(), zf = 0.5 * zs + 0.87 * n();
    const ageAct = t.stage === 'juvenile' ? 0.5 : t.stage === 'senior' ? -0.6 : 0;
    const P = {
      activity: round(sig(za + ageAct), 2), sociability: round(sig(zs), 2), boldness: round(sig(zb), 2),
      curiosity: round(sig(zc + (t.stage === 'juvenile' ? 0.4 : 0)), 2), affection: round(sig(zf), 2)
    };
    // 喜歡兩種活動、不太愛一種；活潑的偏好運動、慵懶的偏好打盹與吃
    const ids = Object.keys(ACTIVITIES);
    const pref = (a) => (['badminton', 'volleyball', 'basketball', 'hop'].includes(a) ? P.activity : a === 'nap' || a === 'eat' ? 1 - P.activity : a === 'selfie' ? P.sociability : 0.5) + r() * 0.9;
    const ranked = ids.map((a) => [a, pref(a)]).sort((x, y) => y[1] - x[1]).map((x) => x[0]);
    const likes = ranked.slice(0, 2), dislike = ranked[ranked.length - 1];
    const hb = HOBBIES.slice(); const hobbies = [];
    while (hobbies.length < 2) hobbies.push(hb.splice(Math.floor(r() * hb.length), 1)[0]);
    // 個性類型：取最突出的特質
    const cands = [
      ['athlete', P.activity > 0.68 && likes.some((a) => ['badminton', 'volleyball', 'basketball'].includes(a)) ? P.activity : 0],
      ['clingy', P.affection > 0.68 && P.sociability > 0.5 ? (P.affection + P.sociability) / 2 : 0],
      ['shy', P.boldness < 0.3 ? 1 - P.boldness : 0],
      ['explorer', P.curiosity > 0.7 ? P.curiosity : 0],
      ['sleepy', P.activity < 0.3 ? 1 - P.activity : 0],
      ['cool', P.sociability < 0.3 && P.affection < 0.45 ? 1 - P.sociability : 0]
    ].filter((c) => c[1] > 0).sort((x, y) => y[1] - x[1]);
    const archetype = cands.length ? cands[0][0] : 'easy';
    // 社交風格（之後多隻庫卡互動用）：母的較少主動
    const initiative = round(clamp(P.sociability * (t.sex === 'female' ? 0.65 : 1) * (0.6 + 0.4 * P.boldness) * 1.4, 0, 1), 2);
    const socialStyle = initiative > 0.68 ? 'leader' : P.sociability > 0.5 ? 'friendly' : P.boldness < 0.4 ? 'watcher' : 'solo';
    return { ...P, likes, dislike, hobbies, archetype, socialStyle, initiative };
  }
  function ensurePersonality(t) {
    if (t && !t.personality) t.personality = personality(t);
    return t;
  }
  const bars = (v) => '●'.repeat(Math.round(v * 4) + 1) + '○'.repeat(4 - Math.round(v * 4));
  function describePersonality(t) {
    const P = t && t.personality; if (!P) return [];
    return [
      ['個性', ARCHETYPES[P.archetype].name],
      ['社交', SOCIAL_STYLES[P.socialStyle]],
      ['活潑', bars(P.activity)], ['親人', bars(P.sociability)], ['膽量', bars(P.boldness)],
      ['好奇', bars(P.curiosity)], ['黏人', bars(P.affection)],
      ['最愛', P.likes.map((a) => ACTIVITIES[a]).join('、')],
      ['不太愛', ACTIVITIES[P.dislike]],
      ['嗜好', P.hobbies.join('、')]
    ];
  }
  // 行為參數：桌寵依此調整動作頻率、偏好、台詞與互動反應
  function behavior(t) {
    const P = t && t.personality;
    if (!P) return null;
    const A = ARCHETYPES[P.archetype];
    const weightK = {};
    Object.keys(ACTIVITIES).forEach((a) => {
      let k = P.likes.includes(a) ? 3 : a === P.dislike ? 0.25 : 1;
      if (a === 'nap') k *= 1.6 - P.activity;
      weightK[a] = round(k, 2);
    });
    const gap = 30 - 16 * P.activity;          // 平均間隔（秒）：很活潑約 14 秒、很慵懶約 30 秒
    return {
      weightK, likes: P.likes, dislike: P.dislike, names: ACTIVITIES,
      intervalMs: [Math.round(gap * 700), Math.round(gap * 1300)],
      sniffDelayMs: Math.round(3000 + (1 - P.curiosity) * 7000),
      shy: P.boldness < 0.3,                   // 膽小：游標靠太久會害羞地轉開，而不是湊過去聞
      petReversals: P.affection > 0.6 ? 3 : P.affection < 0.35 ? 6 : 4,
      greet: A.greet, back: A.back, pat: A.pat, petDone: A.petDone
    };
  }
  // AI 聊天：把這一隻的個性與興趣接在角色人格後面
  function personaText(t) {
    const P = t && t.personality; if (!P) return '';
    const A = ARCHETYPES[P.archetype];
    return `這一隻庫卡的個體設定：${t.sex === 'male' ? '公' : '母'}的，${ageText(t.ageMonths)}，個性是「${A.name}」，` +
      `社交上${SOCIAL_STYLES[P.socialStyle]}；最喜歡${P.likes.map((a) => ACTIVITIES[a]).join('和')}，不太愛${ACTIVITIES[P.dislike]}，` +
      `平常的嗜好是${P.hobbies.join('和')}。說話語氣請符合這個個性（例如：${A.greet}）。`;
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

  const api = { generate, describe, describePersonality, ensurePersonality, behavior, personaText, ARCHETYPES, shape, recolor, colorMap, RANGES, FUR_TYPES, BAND_COLORS };
  if (typeof window !== 'undefined') window.QuokkaTraits = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
