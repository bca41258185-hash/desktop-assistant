// 社交導演 SocialDirector（規格第 7.5、5.4、6.3、8.3、5.5 節）：決定誰和誰、做哪一種兩隻一起的互動。
// 純邏輯：不碰 Electron 與畫面。位置、活動層級、時間、亂數都由呼叫端注入。
// 性別不影響社交主動性：這裡完全不讀 traits.sex，情侶身分只透過 romance／relations 取得。
(function () {
  const MIN_MS = 60 * 1000;
  const DEFAULTS = {
    maxDistance: 700,            // 社交候選範圍
    groundDiff: 40,              // 同一地面高度差
    minDelayMs: 3 * MIN_MS,      // 每 3–5 分鐘檢查一次
    maxDelayMs: 5 * MIN_MS,
    maxActive: 3,                // 同時進行的互動上限（一對算 1 個名額，另可用 freeSlots() 限制）
    maxStartsPerTick: 2,         // 每次 tick 最多發起幾對
    friendMult: 1.5,             // 好朋友互動頻率 ×1.5
    coupleMult: 2,               // 情侶互動頻率加倍
    dadNoseChance: 0.35,         // 爸爸每輪過來碰鼻的機率
    passWaveK: 0.5               // 散步經過時順便打招呼的機率係數（× 平均主動性）
  };

  // 互動種類：couple＝情侶專屬、family＝家族專屬
  const TYPES = {
    wave: { name: '揮手打招呼' },
    nose: { name: '碰鼻' },
    paw: { name: '碰碰手掌' },
    leaf: { name: '分享葉子' },
    chase: { name: '追逐' },
    badminton: { name: '一起打羽球' },
    volleyball: { name: '一起打排球' },
    basketball: { name: '一起打籃球' },
    sunbathe: { name: '並排曬太陽' },
    cuddle: { name: '依偎', couple: true },
    groom: { name: '幫對方理毛', couple: true },
    leanNap: { name: '靠著打盹', couple: true },
    walkTogether: { name: '並肩散步', couple: true },
    dadNose: { name: '爸爸碰鼻小袋鼠', family: true }
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const pairKey = (a, b) => [String(a), String(b)].sort().join('|');
  // 活動層級可能是數字 7 或字串 'L7'
  const layerNum = (l) => { if (typeof l === 'number') return l; const m = /^L?(\d)/i.exec(String(l == null ? 8 : l)); return m ? Number(m[1]) : 8; };
  const displayId = (d) => (d && typeof d === 'object' ? d.id : d);
  const P = (q) => {
    const p = (q && q.traits && q.traits.personality) || {};
    const v = (k) => (typeof p[k] === 'number' ? p[k] : 0.5);
    const initiative = typeof p.initiative === 'number' ? p.initiative : clamp(v('sociability') * (0.6 + 0.4 * v('boldness')) * 1.25, 0, 1);
    return { activity: v('activity'), sociability: v('sociability'), boldness: v('boldness'), curiosity: v('curiosity'), affection: v('affection'), initiative, likes: p.likes || [] };
  };
  function pickWeighted(rand, list) {
    const total = list.reduce((s, x) => s + Math.max(0, x.w), 0);
    if (total <= 0) return null;
    let t = rand() * total;
    for (const x of list) { t -= Math.max(0, x.w); if (t <= 0) return x; }
    return list[list.length - 1];
  }

  function createSocialDirector({
    getQuokkas, getRelations, getLayer, getPos, now = Date.now, random = Math.random,
    onStart, onAbort, romance, constants,
    isBlocked,     // (qid) → true：游標在附近等，不發起互動
    freeSlots      // () → 「同時動 3 隻」剩幾個名額；沒給就只看 maxActive
  } = {}) {
    const C = { ...DEFAULTS, ...(constants || {}) };
    const active = new Map();          // pairId → { pairId, a, b, type, startedAt }
    const busy = new Map();            // qid → pairId
    const watching = new Set();        // 膽小的「先觀察」：pairKey，下一輪才答應
    let seq = 0;

    const quokkas = () => (getQuokkas ? getQuokkas() : []) || [];
    const byId = (id) => quokkas().find((q) => q.id === id) || null;
    const relations = () => (getRelations ? getRelations() : {}) || {};
    const relOf = (a, b) => relations()[pairKey(a, b)] || null;
    const isCouple = (a, b) => { const r = relOf(a, b); return !!(r && r.couple); };
    const isFriend = (a, b) => { const r = relOf(a, b); return !!(r && r.friend); };
    const posOf = (qid) => (getPos ? getPos(qid) : null);
    const layerOf = (qid) => layerNum(getLayer ? getLayer(qid) : 8);

    // 雙方位置條件：同螢幕、同一地面（高度差 ≤ 40）、距離 ≤ 700
    function nearEnough(aId, bId) {
      const pa = posOf(aId), pb = posOf(bId);
      if (!pa || !pb) return false;
      if (displayId(pa.display) !== displayId(pb.display)) return false;
      if (Math.abs(pa.y - pb.y) > C.groundDiff) return false;
      return Math.hypot(pa.x - pb.x, pa.y - pb.y) <= C.maxDistance;
    }
    // 自己可以參加互動：L7 散步或 L8 待機、沒在別的互動裡、沒被擋（游標附近等）
    function available(q) {
      if (!q || busy.has(q.id)) return false;
      if (q.stage === 'pouch') return false;
      const l = layerOf(q.id);
      if (l !== 7 && l !== 8) return false;
      if (isBlocked && isBlocked(q.id)) return false;
      return true;
    }
    function slotsLeft() {
      const own = C.maxActive - active.size;
      const ext = freeSlots ? Number(freeSlots()) : Infinity;
      return Math.max(0, Math.min(own, Number.isFinite(ext) ? ext : own));
    }
    const isFollowJoey = (q) => q && q.stage === 'follow';

    // 依個性與關係挑互動種類
    function chooseType(a, b) {
      const pa = P(a), pb = P(b);
      const act = (pa.activity + pb.activity) / 2, soc = (pa.sociability + pb.sociability) / 2, bold = (pa.boldness + pb.boldness) / 2;
      const likes = (x) => pa.likes.includes(x) || pb.likes.includes(x);
      const outgoing = clamp((soc - 0.45) * 2, 0, 1) * clamp((bold - 0.35) * 2, 0, 1);   // 愛社交而且膽大
      const lazy = clamp((0.45 - act) * 3, 0, 1);                                         // 慵懶
      const list = [
        { type: 'wave', w: 1.2 },
        { type: 'leaf', w: 1.0 },
        { type: 'nose', w: 0.2 + 1.6 * outgoing },
        { type: 'paw', w: 0.1 + 1.4 * outgoing },
        { type: 'badminton', w: (0.05 + 1.2 * outgoing) * (act > 0.4 ? 1 : 0.3) * (likes('badminton') ? 2 : 1) },
        // 一起打排球（互相墊球）、打籃球（傳球、投籃）：其中一隻最愛那種球時更常出現
        { type: 'volleyball', w: (0.05 + 1.0 * outgoing) * (act > 0.4 ? 1 : 0.3) * (likes('volleyball') ? 2.2 : 1) },
        { type: 'basketball', w: (0.05 + 1.0 * outgoing) * (act > 0.4 ? 1 : 0.3) * (likes('basketball') ? 2.2 : 1) },
        { type: 'chase', w: (0.05 + outgoing) * clamp((act - 0.35) * 2.5, 0, 1.2) },
        { type: 'sunbathe', w: 0.1 + 2.5 * lazy }
      ];
      if (isCouple(a.id, b.id)) {
        // 情侶：依偎、理毛、靠著打盹、並肩散步，也會碰鼻、分享葉子
        list.length = 0;
        list.push(
          { type: 'cuddle', w: 1.2 + lazy },
          { type: 'groom', w: 0.8 + 0.6 * ((pa.affection + pb.affection) / 2) },
          { type: 'leanNap', w: 0.3 + 2 * lazy },
          { type: 'walkTogether', w: 0.3 + 1.4 * act },
          { type: 'nose', w: 0.8 },
          { type: 'leaf', w: 0.6 }
        );
      }
      return pickWeighted(random, list).type;
    }

    function start(a, b, type, extra) {
      const pairId = 's' + (++seq).toString(36) + '-' + now().toString(36);
      const job = { pairId, a: a.id, b: b.id, type, initiator: a.id, startedAt: now(), ...(extra || {}) };
      active.set(pairId, job);
      busy.set(a.id, pairId); busy.set(b.id, pairId);
      watching.delete(pairKey(a.id, b.id));
      if (onStart) onStart({ ...job });
      return job;
    }

    // 爸爸過來碰跟隨期的小袋鼠（媽媽當錨點；爸爸不在同一地面就取消這一輪）
    function tryDadNose(list) {
      for (const child of list) {
        if (!isFollowJoey(child) || !child.dad || !available(child)) continue;
        const dad = list.find((q) => q.id === child.dad);
        if (!available(dad) || !nearEnough(dad.id, child.id)) continue;
        if (random() >= C.dadNoseChance) continue;
        return start(dad, child, 'dadNose', { anchor: child.mom || null });
      }
      return null;
    }

    // 主排程：回傳下一次 tick 的建議延遲（毫秒，3–5 分鐘，越愛社交越常）
    function tick() {
      const list = quokkas();
      const started = [];
      let room = Math.min(slotsLeft(), C.maxStartsPerTick);
      if (room > 0) {
        const fam = tryDadNose(list);
        if (fam) { started.push(fam); room--; }
      }
      // 發起者隨機順序（Fisher–Yates，用注入的亂數）
      const order = list.filter((q) => !isFollowJoey(q)).slice();
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      for (const a of order) {
        if (room <= 0) break;
        if (!available(a)) continue;
        const cands = list.filter((b) => b.id !== a.id && !isFollowJoey(b) && available(b) && nearEnough(a.id, b.id));
        if (!cands.length) continue;
        const mult = (b) => (isCouple(a.id, b.id) ? C.coupleMult : isFriend(a.id, b.id) ? C.friendMult : 1);
        const best = Math.max(...cands.map(mult));
        const pa = P(a);
        if (random() >= clamp(pa.initiative * best, 0, 0.95)) continue;
        // 挑對象：越愛社交、好感越高、情侶與好朋友越容易被挑到
        const pick = pickWeighted(random, cands.map((b) => {
          const r = relOf(a.id, b.id);
          return { b, w: (0.3 + P(b).sociability) * mult(b) * (1 + ((r && r.affinity) || 0) / 100) };
        }));
        if (!pick) continue;
        const b = pick.b, pb = P(b), k = pairKey(a.id, b.id);
        const close = isCouple(a.id, b.id) || isFriend(a.id, b.id);
        // 膽小的先觀察，延後一輪
        if (!close && pb.boldness < 0.3 && !watching.has(k)) { watching.add(k); continue; }
        // 對方越愛社交越容易答應
        const accept = close ? 0.95 : 0.35 + 0.6 * pb.sociability;
        if (random() >= accept) continue;
        started.push(start(a, b, chooseType(a, b)));
        room--;
      }
      // 下一次延遲：大家越愛社交越短
      const others = list.filter((q) => !isFollowJoey(q) && q.stage !== 'pouch');
      const soc = others.length ? others.reduce((s, q) => s + P(q).sociability, 0) / others.length : 0.5;
      const jitter = (random() - 0.5) * 40 * 1000;
      const delay = clamp(lerp(C.maxDelayMs, C.minDelayMs, soc) + jitter, C.minDelayMs, C.maxDelayMs);
      return Math.round(delay);
    }

    function finish(pairId) {
      const job = active.get(pairId);
      if (!job) return null;
      active.delete(pairId);
      if (busy.get(job.a) === pairId) busy.delete(job.a);
      if (busy.get(job.b) === pairId) busy.delete(job.b);
      return job;
    }

    // 舞台回報 social:done
    function done(pairId, { ok = true, type } = {}) {
      const job = finish(pairId);
      if (!job) return null;
      let result = null;
      if (ok && romance) result = romance.onTogether(job.a, job.b, type || job.type);
      return { ...job, ok, result };
    }

    // 中止（第 5.4 節）：reason 是 'work' 時 +1；'alert'、'drag'、'user' 不變；'delete' 由 romance.onDelete 移除關係
    function abort(pairId, by, reason) {
      const job = finish(pairId);
      if (!job) return null;
      let result = null;
      if (reason === 'work' && romance && romance.onInterrupted) result = romance.onInterrupted(job.a, job.b);
      const partner = by === job.a ? job.b : by === job.b ? job.a : null;
      return { ...job, by: by || null, partner, reason: reason || null, result };
    }

    // 舞台回報某隻的 q:state.layer：比 L5 高（數字比 5 小）就中止牠的互動，並透過 onAbort 通知呼叫端送 social:abort
    const REASON_BY_LAYER = { 0: 'drag', 1: 'alert', 2: 'work', 3: 'user', 4: 'ball' };
    function onLayer(qid, layer, reason) {
      const pairId = busy.get(qid);
      if (!pairId) return null;
      const l = layerNum(layer);
      if (l >= 5) return null;
      const out = abort(pairId, qid, reason || REASON_BY_LAYER[l] || 'interrupt');
      if (out && onAbort) onAbort(out);
      return out;
    }

    // 庫卡被刪除：先中止牠的互動（好感度不動，關係由 romance.onDelete 移除）
    function removeQuokka(qid) {
      const pairId = busy.get(qid);
      if (!pairId) return null;
      const out = abort(pairId, qid, 'delete');
      if (out && onAbort) onAbort(out);
      return out;
    }

    // 散步經過（舞台偵測到兩隻擦身而過）：好感 +1（每對每天一次），有機會順便揮手打招呼
    function passBy(aId, bId) {
      const a = byId(aId), b = byId(bId);
      if (!a || !b || aId === bId) return null;
      if (isFollowJoey(a) || isFollowJoey(b) || a.stage === 'pouch' || b.stage === 'pouch') return null;
      if (!nearEnough(aId, bId)) return null;
      if (romance) romance.onPass(aId, bId);
      if (!available(a) || !available(b) || slotsLeft() <= 0) return null;
      const chance = C.passWaveK * (P(a).initiative + P(b).initiative) / 2;
      if (random() >= chance) return null;
      return start(a, b, 'wave', { pass: true });
    }

    return {
      tick, done, abort, onLayer, removeQuokka, passBy,
      isBusy: (qid) => busy.has(qid),
      pairOf: (qid) => (busy.has(qid) ? { ...active.get(busy.get(qid)) } : null),
      activePairs: () => Array.from(active.values()).map((j) => ({ ...j })),
      constants: C
    };
  }

  module.exports = { createSocialDirector, TYPES, DEFAULTS, pairKey };
})();
