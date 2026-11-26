// 戀愛與家族（規格第 8 節）：好感度、好朋友、成為一對、懷孕、出生、遺傳、育兒期、長大、刪除時的家族處理。
// 純邏輯：不碰 Electron 與畫面；時間與亂數可注入（now、random），方便用假時鐘測試。
// 資料直接改傳進來的 data（格式同規格第 2 節），存檔由呼叫端負責。
//
// 兩種時鐘（第 8.1 節）：
//   · 遊戲時鐘：懷孕 27 分、育兒袋 10 分、跟隨 50 分。只靠 tickClock(dtMs) 累加 gestationMs／phaseMs，
//     呼叫端只在「程式開著、沒休眠、使用者在、舞台沒隱藏」時呼叫，所以程式關閉的時間不算。
//   · 真實時鐘：年齡（真實 1 天＝遊戲 1 個月）、7 天長到成年體型、7 天再懷孕冷卻、好感度衰退、「每天第一次」。
(function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MIN_MS = 60 * 1000;

  const DEFAULTS = {
    affinityMax: 100,
    dailyGainCap: 20,            // 每對每天最多 +20
    passGain: 1,                 // 散步經過 +1，每對每天一次
    interruptedGain: 1,          // 播放中被工作反應打斷 +1（第 5.4 節）
    togetherMin: 4, togetherMax: 10,
    // 感情的時間單位是「半小時」（periodMs），不是一天：每半小時最多 +20、散步經過每半小時一次、
    // 連續 7 個半小時（3.5 小時）沒互動之後每半小時 −2、情侶每半小時第一次互動擲一次懷孕、生完 7 個半小時內不再懷孕
    periodMs: 30 * MIN_MS,
    decayAfterDays: 7,           // 連續 7 個半小時沒互動（欄位名稱沿用舊的）
    decayPerDay: 2,              // 之後每半小時 −2
    takenDecayAfter: 2,          // 放下得比較快：喜歡的對象已經有別的伴侶（例如舊情人有了新的另一半）→ 1 小時沒一起互動就開始淡
    takenDecayPer: 10,           //   之後每半小時愛情 −10（愛情 100 大約 6 小時淡完）；一起互動也不會再加愛情（友情照常）
    friendAt: 80,
    crushAt: 20,                 // 愛情達 20 才會「偷偷喜歡」（有伴侶就是伴侶；好朋友不算）
    flirtAt: 60,                 // 愛情達 60（互相有感覺、兩隻都單身）＝曖昧：公開（面板粉紅心）、常走在一起、不會分開太遠
    // 友情（affinity）和愛情（love）分開：每次互動都加友情；愛情只在「對牠有感覺」的一對之間累積
    loveP: 0.75,                 // 異性：成年後第一次一起互動時，有 75% 會對彼此有感覺
    sameSexLoveP: 0.12,          // 同性：也可能相愛，但機率低（12%）；大多是友情
    specialLoveP: 0.4,           // 有一方是特殊性別（性別認同）：40%；生不生寶寶仍看生理性別
    coupleAt: 100,
    matureMonths: { female: 18, male: 12 },
    juvenileUntilMonths: 18,     // 未滿 18 個月是亞成體
    seniorFromMonths: 96,        // 滿 96 個月是年長
    conceptionP: 0.3,
    rebreedCooldownMs: 7 * 30 * MIN_MS,                 // 生完 3.5 小時內不再懷孕
    gestationMs: 27 * MIN_MS,
    pouchMs: 10 * MIN_MS,
    followMs: 50 * MIN_MS,
    growMs: 7 * DAY_MS,          // 亞成體 7 天長到成年體型
    joeyScale: 0.7,              // 育兒袋期、跟隨期的身長比例
    juvenileScale: 0.78,         // 剛獨立時的身長比例（與 traits.generate 的亞成體一致）
    nameMax: 12,
    crowdedAt: 20                // 超過 20 隻提示一次
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  const pairKey = (a, b) => [String(a), String(b)].sort().join('|');

  // 可重現的亂數（與 traits.js 相同的演算法）
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // 本地日期字串 'YYYY-MM-DD'（「每天」以使用者所在時區的日曆日計算）
  function dayStr(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // 兩個日期字串相差幾天（b − a）
  function dayDiff(a, b) {
    const p = (s) => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((p(b) - p(a)) / DAY_MS);
  }

  // 名字比對用的正規化：去前後空白、全形轉半形（NFKC）、英文不分大小寫
  const normName = (s) => String(s || '').trim().normalize('NFKC').toLowerCase();

  // ---------------------------------------------------------------------------
  // 遺傳（第 8.5 節）：自己實作，不改 traits.js
  // ---------------------------------------------------------------------------
  // 個性類型與社交風格的判斷，和 traits.js 的 personality() 相同（那邊沒有匯出，這裡複製一份）
  function deriveStyle(P) {
    const cands = [
      ['athlete', P.activity > 0.68 && (P.likes || []).some((a) => ['badminton', 'volleyball', 'basketball'].includes(a)) ? P.activity : 0],
      ['clingy', P.affection > 0.68 && P.sociability > 0.5 ? (P.affection + P.sociability) / 2 : 0],
      ['shy', P.boldness < 0.3 ? 1 - P.boldness : 0],
      ['explorer', P.curiosity > 0.7 ? P.curiosity : 0],
      ['sleepy', P.activity < 0.3 ? 1 - P.activity : 0],
      ['cool', P.sociability < 0.3 && P.affection < 0.45 ? 1 - P.sociability : 0]
    ].filter((c) => c[1] > 0).sort((x, y) => y[1] - x[1]);
    const archetype = cands.length ? cands[0][0] : 'easy';
    // 主動性只看親人與膽量，與性別無關
    const initiative = round(clamp(P.sociability * (0.6 + 0.4 * P.boldness) * 1.25, 0, 1), 2);
    const socialStyle = initiative > 0.68 ? 'leader' : P.sociability > 0.5 ? 'friendly' : P.boldness < 0.4 ? 'watcher' : 'solo';
    return { archetype, socialStyle, initiative };
  }

  const FACETS = ['activity', 'sociability', 'boldness', 'curiosity', 'affection'];
  const CHEEK_BASE = { male: 1.04, female: 0.97 };

  // 成年後的體型（小袋鼠成長中的那隻要看 adultSize）
  const adultSizeOf = (t) => (t && t.adultSize) || { lengthCm: t.lengthCm, tailCm: t.tailCm, weightKg: t.weightKg };

  // 依成長比例套用目前的體型
  function applyScale(t, k) {
    const A = t.adultSize;
    t.lengthCm = round(A.lengthCm * k);
    t.tailCm = round(A.tailCm * k);
    t.weightKg = round(A.weightKg * Math.pow(k, 2.6), 2);
    t.sitHeightCm = round(t.lengthCm * 0.74);
    t.growScale = round(k, 3);
  }

  // 產生小袋鼠的特徵：mom、dad 是 traits 物件
  function inherit(TR, momT, dadT, seed, opts = {}) {
    const C = { ...DEFAULTS, ...opts };
    const base = TR.generate(seed);                // 性別、喜好、嗜好、飾品都由這組重新抽
    if (TR.ensurePersonality) TR.ensurePersonality(base);
    if (TR.ensureAccessory) TR.ensureAccessory(base);
    const r = rng(((seed >>> 0) ^ 0x9e3779b9) >>> 0);
    const noise = (amp) => (r() - 0.5) * 2 * amp;
    const sex = base.sex, R = TR.RANGES[sex];
    const pos = (t, key, range) => { const rr = TR.RANGES[t.sex] && TR.RANGES[t.sex][range]; const v = adultSizeOf(t)[key]; return rr ? clamp((v - rr[0]) / (rr[1] - rr[0]), 0, 1) : 0.5; };
    // 體型：把爸媽各自在「自己性別範圍」的相對位置取平均 ± 個體差，再對應到小袋鼠性別的範圍（一定落在正常範圍）
    const sizeOf = (key, range) => lerp(R[range][0], R[range][1], clamp((pos(momT, key, range) + pos(dadT, key, range)) / 2 + noise(0.12), 0, 1));
    const adultSize = { lengthCm: round(sizeOf('lengthCm', 'len')), tailCm: round(sizeOf('tailCm', 'tail')), weightKg: round(sizeOf('weightKg', 'wt'), 2) };
    // 毛色：色相、彩度、明度取中間值 ± 小幅隨機
    const mf = momT.fur || {}, df = dadT.fur || {};
    const mid = (k, d) => ((mf[k] != null ? mf[k] : d) + (df[k] != null ? df[k] : d)) / 2;
    const ft = r() < 0.5 ? mf : df;
    const fur = {
      type: ft.type || base.fur.type, name: ft.name || base.fur.name,
      dh: round(mid('dh', 0) + noise(1.2), 2),
      sat: round(clamp(mid('sat', 1) + noise(0.04), 0.5, 1.25), 3),
      dl: round(mid('dl', 0) + noise(0.012), 3),
      rufous: round(clamp(mid('rufous', 0.2) + noise(0.08), 0, 1), 2),
      grey: 0.04,
      bellyLight: round(mid('bellyLight', 0) + noise(0.01), 3)
    };
    // 個性：五個面向各自「爸媽平均 × 0.6 ＋ 隨機 × 0.4」
    const mp = momT.personality || {}, dp = dadT.personality || {};
    const P = { ...base.personality };
    for (const f of FACETS) {
      const avg = ((mp[f] != null ? mp[f] : 0.5) + (dp[f] != null ? dp[f] : 0.5)) / 2;
      P[f] = round(clamp(0.6 * avg + 0.4 * r(), 0, 1), 2);
    }
    Object.assign(P, deriveStyle(P));
    const cheekRel = ((momT.cheekK || CHEEK_BASE[momT.sex] || 1) - (CHEEK_BASE[momT.sex] || 1) + (dadT.cheekK || CHEEK_BASE[dadT.sex] || 1) - (CHEEK_BASE[dadT.sex] || 1)) / 2;
    const t = {
      v: 1, seed, sex, ageMonths: 0, stage: 'juvenile',
      adultSize, lengthCm: 0, tailCm: 0, weightKg: 0, sitHeightCm: 0,
      condition: round(clamp(((momT.condition || 1) + (dadT.condition || 1)) / 2 + noise(0.04), 0.8, 1.25), 3),
      earK: round(clamp(((momT.earK || 1) + (dadT.earK || 1)) / 2 + noise(0.02), 0.92, 1.08), 3),
      cheekK: round(CHEEK_BASE[sex] + cheekRel + noise(0.015), 3),
      fur,
      band: base.band,
      accessory: base.accessory,
      gender: base.gender,                         // 特殊性別（性別認同）不遺傳，跟著新抽的那組
      personality: P
    };
    applyScale(t, C.joeyScale);
    return t;
  }

  // ---------------------------------------------------------------------------
  function createRomance({ data, now = Date.now, random = Math.random, TR, constants } = {}) {
    if (!data) throw new Error('createRomance 需要 data');
    TR = TR || require('../renderer/traits');
    const C = { ...DEFAULTS, ...(constants || {}), matureMonths: { ...DEFAULTS.matureMonths, ...((constants && constants.matureMonths) || {}) } };
    data.relations = data.relations || {};
    data.lineage = data.lineage || {};
    data.settings = data.settings || {};
    data.quokkas = data.quokkas || [];
    // 舊資料（友情和愛情還沒分開）：已經是一對的＝愛情滿、互相有感覺；其他的愛情從 0 開始，有沒有感覺之後再決定
    for (const r of Object.values(data.relations)) {
      if (!r) continue;
      if (r.love == null) r.love = r.couple ? 100 : 0;
      if (r.attracted == null && r.couple) r.attracted = true;
      if (r.attracted === undefined) r.attracted = null;
    }

    const nowISO = () => new Date(now()).toISOString();
    // 「這一段」＝第幾個半小時（'p' + 編號）。舊資料存的是日期字串 'YYYY-MM-DD'：當成那天 0 點的那一段
    const slotOf = (ms) => 'p' + Math.floor(ms / C.periodMs);
    const slotIndex = (s) => {
      if (s == null) return NaN;
      const str = String(s);
      if (str[0] === 'p') return Number(str.slice(1));
      const [y, m, d] = str.split('-').map(Number);
      return Math.floor(new Date(y, m - 1, d).getTime() / C.periodMs);
    };
    const today = () => slotOf(now());
    const slotDiff = (a, b) => slotIndex(b) - slotIndex(a);
    const byId = (id) => data.quokkas.find((q) => q.id === id) || null;
    const S = () => data.settings;
    const romanceOn = () => S().romance !== false;
    const babiesOn = () => S().babies !== false;
    const sexOf = (q) => (q && q.traits && q.traits.sex) || null;
    const P = (q) => (q && q.traits && q.traits.personality) || {};

    // ---- 年齡（第 8.1 節）-------------------------------------------------------
    function birthMs(q) {
      const t = q.traits || {};
      const b = Date.parse(t.birthAt || q.birthAt || '');
      if (Number.isFinite(b)) return b;
      // 舊資料沒有 birthAt：以建立時間 − 生成時的年齡（月）天推算，並補存回去
      const created = Date.parse(q.createdAt || '') || now();
      const ms = created - (Number(t.ageMonths) || 0) * DAY_MS;
      if (q.traits) q.traits.birthAt = new Date(ms).toISOString();
      return ms;
    }
    // 遊戲年齡（月，可帶小數）：真實 1 天＝遊戲 1 個月，程式關閉時照算
    function ageMonths(q) { return q ? Math.max(0, (now() - birthMs(q)) / DAY_MS) : 0; }
    const isMature = (q) => ageMonths(q) >= (C.matureMonths[sexOf(q)] != null ? C.matureMonths[sexOf(q)] : 18);
    const isBaby = (q) => q && (q.stage === 'pouch' || q.stage === 'follow');

    // ---- 家譜與近親（第 8.2 節）--------------------------------------------------
    // 先找活著的那隻，再找墓碑紀錄（已刪除的祖先也算）
    function parentsOf(id) {
      const q = byId(id), L = data.lineage[id];
      const mom = q ? q.mom : L && L.mom, dad = q ? q.dad : L && L.dad;
      return [mom, dad].filter(Boolean);
    }
    // depth 代以內的祖先集合（含不限代數用 Infinity）
    function ancestors(id, depth) {
      const out = new Set();
      let front = [id];
      for (let d = 0; d < depth && front.length; d++) {
        const next = [];
        for (const x of front) for (const p of parentsOf(x)) if (!out.has(p) && p !== id) { out.add(p); next.push(p); }
        front = next;
      }
      return out;
    }
    function isKin(aId, bId) {
      if (aId === bId) return true;
      const allA = ancestors(aId, Infinity), allB = ancestors(bId, Infinity);
      if (allA.has(bId) || allB.has(aId)) return true;                 // 祖先與後代（父母子女、祖孫…）
      const a2 = ancestors(aId, 2), b2 = ancestors(bId, 2);
      for (const x of a2) if (b2.has(x)) return true;                  // 兩代內共同祖先：兄弟姊妹、半血緣、叔姪、表親
      return false;
    }
    function recordLineage(q) {
      const L = data.lineage[q.id] || {};
      data.lineage[q.id] = { ...L, name: q.name, sex: sexOf(q), mom: q.mom || null, dad: q.dad || null, bornAt: (q.traits && q.traits.birthAt) || L.bornAt || null, deletedAt: L.deletedAt || null };
    }

    // ---- 關係 -----------------------------------------------------------------
    function rel(aId, bId, create = true) {
      const k = pairKey(aId, bId);
      let r = data.relations[k];
      if (!r && create) r = data.relations[k] = { affinity: 0, love: 0, attracted: null, loveGain: 0, loveDay: null, couple: false, friend: false, since: null, lastTogetherDay: null, dailyGain: 0, gainDay: null, lastConceptionRollDay: null, lastPassDay: null, decayDays: 0 };
      return r || null;
    }
    function partnerOf(qid) {
      for (const [k, v] of Object.entries(data.relations)) {
        if (v && v.couple) { const [a, b] = k.split('|'); if (a === qid) return b; if (b === qid) return a; }
      }
      return null;
    }
    // 喜歡的對象：有伴侶就是伴侶；否則是愛情最高（至少 crushAt）、不是親人的那一隻（好朋友不算）。小袋鼠（育兒袋、跟隨期）不算
    function crushOf(qid) {
      const isKid = (q) => !q || q.stage === 'pouch' || q.stage === 'follow';
      if (isKid(byId(qid))) return null;
      const p = partnerOf(qid);
      if (p) return p;
      let best = null, top = C.crushAt - 1e-9;
      for (const [k, v] of Object.entries(data.relations)) {
        if (!v || !v.attracted || !((v.love || 0) > top)) continue;
        const [a, b] = k.split('|'), o = a === qid ? b : b === qid ? a : null;
        if (!o || isKid(byId(o)) || isKin(qid, o)) continue;
        best = o; top = v.love;
      }
      return best;
    }
    // 曖昧的對象：兩隻都單身、互相有感覺、愛情 ≥ flirtAt；有好幾個就取愛情最高的
    function flirtOf(qid) {
      const me = byId(qid);
      if (!me || me.stage === 'pouch' || me.stage === 'follow' || partnerOf(qid)) return null;
      let best = null, top = C.flirtAt - 1e-9;
      for (const [k, v] of Object.entries(data.relations)) {
        if (!v || v.couple || !v.attracted || !((v.love || 0) > top)) continue;
        const [a, b] = k.split('|'), o = a === qid ? b : b === qid ? a : null;
        const oq = o && byId(o);
        if (!oq || oq.stage === 'pouch' || oq.stage === 'follow' || partnerOf(o) || isKin(qid, o)) continue;
        best = o; top = v.love;
      }
      return best;
    }
    // b 已經有別的伴侶（不是 a）：a 對 b 的愛情要放下
    const takenBy = (a, b) => { const p = partnerOf(b); return !!p && p !== a; };
    const isCouple = (a, b) => { const r = rel(a, b, false); return !!(r && r.couple); };
    const isFriend = (a, b) => { const r = rel(a, b, false); return !!(r && r.friend); };
    // 好朋友：不分性別，好感達門檻就是（情侶另計）。性別不可影響社交主動性與互動頻率。
    function refreshFriend(r, a, b) {
      r.friend = !!(a && b && r.affinity >= C.friendAt);
    }
    // 這一對對彼此有沒有感覺（愛情）：兩隻都成年、不是親人時，第一次一起互動決定一次（異性 75%、同性 12%），之後不變
    function attraction(a, b, r) {
      if (r.attracted != null) return !!r.attracted;
      if (!romanceOn() || isBaby(a) || isBaby(b) || !isMature(a) || !isMature(b)) return false;   // 還沒決定（長大後再說）
      if (isKin(a.id, b.id)) { r.attracted = false; return false; }
      const sa = sexOf(a), sb = sexOf(b), same = sa && sa === sb;
      const special = (q) => q.traits && q.traits.gender === 'special';
      r.attracted = random() < (special(a) || special(b) ? C.specialLoveP : same ? C.sameSexLoveP : C.loveP);
      return r.attracted;
    }
    // 加愛情：和友情一樣每對每天最多 +20，最高 100
    function gainLove(r, amount) {
      const d = today();
      if (r.loveDay !== d) { r.loveDay = d; r.loveGain = 0; }
      const add = Math.max(0, Math.min(amount, C.dailyGainCap - (r.loveGain || 0), C.affinityMax - (r.love || 0)));
      r.love = (r.love || 0) + add; r.loveGain = (r.loveGain || 0) + add;
      return add;
    }
    // 加好感（友情），受每對每天上限限制；回傳實際加了多少
    function gain(r, amount) {
      const d = today();
      if (r.gainDay !== d) { r.gainDay = d; r.dailyGain = 0; }
      const add = Math.max(0, Math.min(amount, C.dailyGainCap - r.dailyGain, C.affinityMax - r.affinity));
      r.affinity += add; r.dailyGain += add;
      return add;
    }

    // ---- 成為一對（第 8.2 節）-----------------------------------------------------
    function canPair(a, b) {
      a = typeof a === 'string' ? byId(a) : a; b = typeof b === 'string' ? byId(b) : b;
      if (!a || !b || a.id === b.id) return { ok: false, reason: 'missing' };
      if (!romanceOn()) return { ok: false, reason: 'romance-off' };
      if (!sexOf(a) || !sexOf(b)) return { ok: false, reason: 'missing' };
      if (isBaby(a) || isBaby(b) || !isMature(a) || !isMature(b)) return { ok: false, reason: 'too-young' };
      if (partnerOf(a.id) || partnerOf(b.id)) return { ok: false, reason: 'has-partner' };
      const r = rel(a.id, b.id, false);
      if (!r || !r.attracted) return { ok: false, reason: 'no-love' };            // 只是朋友（大多數同性、少數異性）
      if ((r.love || 0) < C.coupleAt) return { ok: false, reason: 'love' };     // 愛情還沒滿
      if (isKin(a.id, b.id)) return { ok: false, reason: 'kin' };
      return { ok: true };
    }

    // ---- 懷孕（第 8.4 節）--------------------------------------------------------
    function canConceive(mom, dad) {
      if (!mom || !dad || !romanceOn() || !babiesOn()) return false;
      if (sexOf(mom) !== 'female' || sexOf(dad) !== 'male') return false;
      if (mom.pregnancy || mom.joey) return false;
      const last = Date.parse(mom.lastBirthAt || '');
      if (Number.isFinite(last) && now() - last < C.rebreedCooldownMs) return false;
      return true;
    }

    // 一起完成一次互動
    function onTogether(aId, bId, kind) {
      const a = byId(aId), b = byId(bId), events = [];
      if (!a || !b || aId === bId) return { gained: 0, events };
      const r = rel(aId, bId);
      const wasCouple = r.couple;
      // +4～+10：兩隻都愛社交、活潑程度接近的加得多
      const pa = P(a), pb = P(b);
      const soc = ((pa.sociability != null ? pa.sociability : 0.5) + (pb.sociability != null ? pb.sociability : 0.5)) / 2;
      const sim = 1 - Math.abs((pa.activity != null ? pa.activity : 0.5) - (pb.activity != null ? pb.activity : 0.5));
      const amount = Math.round(lerp(C.togetherMin, C.togetherMax, clamp(0.5 * soc + 0.5 * sim, 0, 1)));
      const gained = gain(r, amount);
      // 對方已經有別的伴侶：愛情不再增加（要放下），友情照常
      const loveGained = attraction(a, b, r) && !takenBy(aId, bId) && !takenBy(bId, aId) ? gainLove(r, amount) : 0;
      const d = today();
      const firstToday = r.lastTogetherDay !== d;
      r.lastTogetherDay = d; r.decayDays = 0; r.takenDecayDone = 0;
      const wasFriend = r.friend;
      refreshFriend(r, a, b);
      if (r.friend && !wasFriend) events.push({ type: 'friend', a: aId, b: bId });
      if (!r.couple && canPair(a, b).ok) {
        r.couple = true; r.since = nowISO();
        events.push({ type: 'couple', a: aId, b: bId });
      }
      // 成為一對「之後」每天第一次一起互動：異性、而且愛情是滿的，才擲一次 30%（同性伴侶不會生寶寶）
      if (wasCouple && r.couple && (r.love || 0) >= C.affinityMax && r.lastConceptionRollDay !== d) {
        const mom = sexOf(a) === 'female' ? a : b, dad = mom === a ? b : a;
        if (canConceive(mom, dad)) {
          r.lastConceptionRollDay = d;
          if (random() < C.conceptionP) {
            mom.pregnancy = { dad: dad.id, gestationMs: 0 };
            events.push({ type: 'pregnant', mom: mom.id, dad: dad.id });
          }
        }
      }
      return { gained, affinity: r.affinity, loveGained, love: r.love || 0, attracted: !!r.attracted, friend: r.friend, couple: r.couple, firstToday, kind: kind || null, events };
    }
    // 播放中被工作反應打斷：+1（也受每日上限）
    function onInterrupted(aId, bId) {
      if (!byId(aId) || !byId(bId)) return { gained: 0 };
      const r = rel(aId, bId);
      const gained = gain(r, C.interruptedGain);
      refreshFriend(r, byId(aId), byId(bId));
      return { gained, affinity: r.affinity };
    }
    // 散步經過：+1，每對每天一次
    function onPass(aId, bId) {
      if (!byId(aId) || !byId(bId) || aId === bId) return { gained: 0 };
      const r = rel(aId, bId), d = today();
      if (r.lastPassDay === d) return { gained: 0, affinity: r.affinity };
      r.lastPassDay = d;
      const gained = gain(r, C.passGain);
      refreshFriend(r, byId(aId), byId(bId));
      return { gained, affinity: r.affinity };
    }

    // 衰退：連續 7 天沒有互動，之後每天 −2（程式關著也算，開啟時補扣；可重複呼叫，不會重複扣）
    function dailyDecay() {
      const d = today(), changed = [];
      for (const [k, r] of Object.entries(data.relations)) {
        if (!r || !r.lastTogetherDay) continue;
        const gap = slotDiff(r.lastTogetherDay, d);
        if (!Number.isFinite(gap)) continue;
        const target = Math.max(0, gap - C.decayAfterDays);
        const done = r.decayDays || 0;
        if (target > done) {
          const before = r.affinity;
          r.affinity = Math.max(0, r.affinity - C.decayPerDay * (target - done));
          r.love = Math.max(0, (r.love || 0) - C.decayPerDay * (target - done));     // 愛情也一樣會淡
          r.decayDays = target;
          const [a, b] = k.split('|');
          refreshFriend(r, byId(a), byId(b));
          if (r.affinity !== before) changed.push({ pair: k, from: before, to: r.affinity });
        }
        // 放下得比較快：喜歡的對象已經有別的伴侶 → 1 小時沒一起互動後，愛情每半小時 −10
        const [a, b] = k.split('|');
        if (!r.couple && (r.love || 0) > 0 && (takenBy(a, b) || takenBy(b, a))) {
          const tt = Math.max(0, gap - C.takenDecayAfter), td = r.takenDecayDone || 0;
          if (tt > td) { const lb = r.love; r.love = Math.max(0, r.love - C.takenDecayPer * (tt - td)); r.takenDecayDone = tt; changed.push({ pair: k, love: true, from: lb, to: r.love }); }
        }
      }
      return changed;
    }

    // ---- 出生（第 8.4–8.5 節）----------------------------------------------------
    function nameTaken(name, exceptId) { const n = normName(name); return data.quokkas.some((q) => q.id !== exceptId && normName(q.name) === n); }
    // 暫名：媽媽名字＋「寶寶」，撞名加數字；總長不超過 12 字（太長就截短媽媽的名字）
    function tempName(momName, exceptId, avoid = []) {
      const av = new Set(avoid.map(normName));
      const make = (i) => {
        const suffix = '寶寶' + (i > 1 ? String(i) : '');
        return Array.from(String(momName || '庫卡')).slice(0, Math.max(1, C.nameMax - suffix.length)).join('') + suffix;
      };
      let i = 1, n = make(i);
      while (nameTaken(n, exceptId) || av.has(normName(n))) n = make(++i);
      return n;
    }
    // 使用者取的名字和小袋鼠暫名撞名：使用者優先，暫名改加數字（第 7.3 節）。回傳被改名的清單
    function resolveNameClash(name, exceptId) {
      const out = [];
      for (const q of data.quokkas) {
        if (q.id !== exceptId && q.nameTemp && normName(q.name) === normName(name)) {
          const momName = (byId(q.mom) || data.lineage[q.mom] || {}).name;
          const old = q.name;
          q.name = tempName(momName, q.id, [name]);
          out.push({ qid: q.id, from: old, to: q.name });
        }
      }
      return out;
    }
    function newChildId() { return 'q' + now().toString(36) + Math.floor(random() * 1e6).toString(36); }

    function giveBirth(mom, events) {
      const dadId = mom.pregnancy.dad;
      const dad = byId(dadId);
      const dadTraits = (dad && dad.traits) || (data.lineage[dadId] && data.lineage[dadId].traits) || mom.pregnancy.dadTraits || mom.traits;
      const seed = Math.floor(random() * 2 ** 31) || 1;
      const t = inherit(TR, mom.traits, dadTraits, seed, C);
      t.birthAt = nowISO();
      let id = newChildId(); while (byId(id)) id = newChildId();
      const child = {
        id, name: tempName(mom.name), nameTemp: true, traits: t,
        home: mom.home ? JSON.parse(JSON.stringify(mom.home)) : null,
        stage: 'pouch', mom: mom.id, dad: dadId || null,
        pregnancy: null, joey: null, growth: null, lastBirthAt: null, createdAt: nowISO()
      };
      data.quokkas.push(child);
      recordLineage(child);
      const overflow = Math.max(0, mom.pregnancy.gestationMs - C.gestationMs);
      mom.pregnancy = null;
      mom.joey = { id, phaseMs: overflow };
      mom.lastBirthAt = nowISO();
      events.push({ type: 'birth', mom: mom.id, dad: dadId || null, child: id, name: child.name });
      if (data.quokkas.length > C.crowdedAt && !S().crowdedHinted) { S().crowdedHinted = true; events.push({ type: 'crowded', count: data.quokkas.length }); }
    }

    // 小袋鼠變獨立（亞成體）：家設在當下位置由呼叫端處理
    function makeIndependent(child, events, guardianId) {
      child.stage = 'juvenile';
      child.growth = { adultAt: new Date(now() + C.growMs).toISOString() };
      if (child.traits && child.traits.adultSize) applyScale(child.traits, C.juvenileScale);
      events.push({ type: 'independent', qid: child.id, guardian: guardianId || null });
    }

    // 成長中體型：亞成體 7 天從 0.78 過渡到 1
    function updateGrowth(q, events) {
      if (!q.growth || !q.growth.adultAt) return;
      const end = Date.parse(q.growth.adultAt), start = end - C.growMs;
      const t = q.traits;
      if (now() >= end) {
        if (t && t.adultSize) { applyScale(t, 1); }
        q.growth = null;
        events.push({ type: 'grown', qid: q.id });
        return;
      }
      if (t && t.adultSize) {
        const k = lerp(C.juvenileScale, 1, clamp((now() - start) / C.growMs, 0, 1));
        if (Math.abs(k - (t.growScale || 0)) >= 0.01) { applyScale(t, k); events.push({ type: 'resize', qid: q.id }); }
      }
    }

    // 年齡相關：更新 traits.ageMonths／traits.stage，亞成體滿 18 個月變成年
    function refreshAges(events = []) {
      for (const q of data.quokkas) {
        if (!q.traits) continue;
        const m = ageMonths(q);
        q.traits.ageMonths = Math.floor(m);
        if (!isBaby(q)) q.traits.stage = m < C.juvenileUntilMonths ? 'juvenile' : m >= C.seniorFromMonths ? 'senior' : 'adult';
        if (q.stage === 'juvenile' && m >= C.juvenileUntilMonths) { q.stage = 'adult'; events.push({ type: 'adult', qid: q.id }); }
      }
      return events;
    }

    // 時鐘：dtMs 是這段期間遊戲時鐘前進的毫秒（呼叫端只在遊戲時鐘會前進時傳正數；暫停時傳 0 只處理真實時鐘）
    function tickClock(dtMs = 0) {
      const events = [];
      const dt = Math.max(0, Number(dtMs) || 0);
      // 先處理已經在育兒的（避免剛出生那一刻的溢出被重複加）
      for (const g of data.quokkas.slice()) {
        if (!g.joey || dt <= 0) continue;
        const child = byId(g.joey.id);
        if (!child) { g.joey = null; continue; }
        const before = g.joey.phaseMs;
        g.joey.phaseMs += dt;
        advanceJoey(g, child, before, events);
      }
      for (const mom of data.quokkas.slice()) {
        if (!mom.pregnancy) continue;
        if (dt > 0) mom.pregnancy.gestationMs += dt;
        if (mom.pregnancy.gestationMs >= C.gestationMs) {
          giveBirth(mom, events);
          // 溢出的時間直接算進育兒袋期
          const child = byId(mom.joey.id);
          advanceJoey(mom, child, 0, events);
        }
      }
      for (const q of data.quokkas) updateGrowth(q, events);
      refreshAges(events);
      return events;
    }
    function advanceJoey(g, child, before, events) {
      const ph = g.joey.phaseMs;
      if (child.stage === 'pouch' && ph >= C.pouchMs) {
        child.stage = 'follow';
        events.push({ type: 'joey-out', qid: child.id, guardian: g.id });
      }
      if (child.stage === 'follow' && ph >= C.pouchMs + C.followMs) {
        g.joey = null;
        makeIndependent(child, events, g.id);
      }
    }

    // ---- 刪除（第 7.4、5.5 節）：在呼叫端把牠從 quokkas 移除「之前」呼叫 -------------------
    // 放生後回信、牠回來了：放回名單、墓碑紀錄取消、恢復放生前的關係（友情、愛情；伴侶還單身才恢復成一對）
    //   q＝放生時存下的資料（不含懷孕、育兒袋）；rels＝[{ other, affinity, love, couple, ... }]
    function onReturn(q, rels = []) {
      const events = [];
      if (!q || !q.id || byId(q.id)) return events;
      data.quokkas.push(q);
      if (data.lineage[q.id]) data.lineage[q.id].deletedAt = null;
      recordLineage(q);
      for (const r of rels) {
        if (!r || !byId(r.other) || r.other === q.id) continue;
        const { other, ...rest } = r;
        const couple = !!rest.couple && !partnerOf(other) && !partnerOf(q.id);
        data.relations[pairKey(q.id, other)] = { ...rest, couple, since: couple ? rest.since || nowISO() : null };
        if (couple) events.push({ type: 'couple-again', a: q.id, b: other });
      }
      return events;
    }
    function deleteWarning(qid) { const q = byId(qid); return q && q.pregnancy ? 'pregnant' : null; }
    function onDelete(qid) {
      const q = byId(qid), events = [];
      if (!q) return events;
      // 墓碑紀錄（保留特徵，供懷孕中爸爸被刪時遺傳用）
      recordLineage(q);
      data.lineage[qid].deletedAt = nowISO();
      if (sexOf(q) === 'male' && q.traits) data.lineage[qid].traits = JSON.parse(JSON.stringify(q.traits));
      // 伴侶恢復單身；和牠有關的關係全部移除
      const partner = partnerOf(qid);
      for (const k of Object.keys(data.relations)) if (k.split('|').includes(qid)) delete data.relations[k];
      if (partner) events.push({ type: 'single', qid: partner });
      // 牠帶著的小袋鼠
      if (q.joey) {
        const child = byId(q.joey.id);
        const dad = child && child.dad && child.dad !== qid ? byId(child.dad) : null;
        if (child) {
          if (dad && !dad.joey && child.mom === qid) {
            // 交給爸爸：育兒袋期立刻變跟隨期，跟隨期照原本的時間繼續
            const phaseMs = Math.max(q.joey.phaseMs, C.pouchMs);
            if (child.stage === 'pouch') { child.stage = 'follow'; events.push({ type: 'joey-out', qid: child.id, guardian: dad.id }); }
            dad.joey = { id: child.id, phaseMs };
            events.push({ type: 'joey-to-dad', qid: child.id, dad: dad.id });
          } else {
            makeIndependent(child, events, null);
          }
        }
        q.joey = null;
      }
      // 牠自己是小袋鼠：照顧者解除 hasFollower
      for (const g of data.quokkas) if (g.joey && g.joey.id === qid) { g.joey = null; events.push({ type: 'follower-gone', qid: g.id }); }
      // 懷孕中的爸爸被刪除：懷孕照常進行，dad 指向墓碑紀錄（不需處理）
      return events;
    }

    // 重新生成限制：有伴侶、懷孕中、正在育兒、或有父母時不行
    function canRegenerate(q) {
      q = typeof q === 'string' ? byId(q) : q;
      if (!q) return { ok: false, reason: 'missing' };
      if (partnerOf(q.id)) return { ok: false, reason: 'has-partner' };
      if (q.pregnancy) return { ok: false, reason: 'pregnant' };
      if (q.joey) return { ok: false, reason: 'parenting' };
      if (q.mom || q.dad) return { ok: false, reason: 'has-parents' };
      return { ok: true };
    }
    // 重新生成後：好感度歸零
    function onRegenerate(qid) {
      for (const [k, r] of Object.entries(data.relations)) if (k.split('|').includes(qid)) { r.affinity = 0; r.love = 0; r.attracted = null; r.loveGain = 0; r.friend = false; r.dailyGain = 0; r.decayDays = 0; }
    }

    // 可以交辦事情嗎（跟隨期以前的小袋鼠不行）
    const canOwnTasks = (q) => { q = typeof q === 'string' ? byId(q) : q; return !!q && !isBaby(q); };
    // 現在誰在照顧這隻小袋鼠
    function guardianOf(childId) { const g = data.quokkas.find((x) => x.joey && x.joey.id === childId); return g ? g.id : null; }

    for (const q of data.quokkas) recordLineage(q);

    return {
      onTogether, onInterrupted, onPass, dailyDecay, canPair, tickClock, ageMonths, onDelete, deleteWarning,
      canRegenerate, onRegenerate, onReturn, refreshAges, isKin, partnerOf, crushOf, flirtOf, isCouple, isFriend, guardianOf, canOwnTasks,
      tempName, resolveNameClash, relation: (a, b) => rel(a, b, false), pairKey, constants: C
    };
  }

  module.exports = { createRomance, inherit, deriveStyle, pairKey, dayStr, dayDiff, DEFAULTS, DAY_MS };
})();
