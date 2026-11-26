// 社交導演（lib/social.js）：配對條件、互動種類、情侶與家族專屬、性別不影響主動性、名額、中止與好感度
const { test } = require('node:test');
const assert = require('node:assert/strict');
const TR = require('../renderer/traits');
const { createSocialDirector, TYPES } = require('../lib/social');
const { createRomance, pairKey, DAY_MS } = require('../lib/romance');

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const T0 = new Date(2026, 0, 10, 12).getTime();
let seedN = 500;
// 預設：很愛社交、膽大、主動
function mk(id, sex = 'male', P = {}, extra = {}) {
  const t = TR.generate(seedN++); TR.ensurePersonality(t);
  t.sex = sex; t.birthAt = new Date(T0 - 400 * DAY_MS).toISOString();
  Object.assign(t.personality, { activity: 0.6, sociability: 1, boldness: 1, curiosity: 0.5, affection: 0.5, initiative: 1, likes: [] }, P);
  return { id, name: id, traits: t, stage: 'adult', mom: null, dad: null, pregnancy: null, joey: null, ...extra };
}
// 建一個舞台：pos[qid] = {x, y, display}，layer[qid] = 8
function setup(qs, opts = {}) {
  const data = { version: 2, quokkas: qs, relations: {}, lineage: {}, settings: { romance: true, babies: true } };
  const pos = {}, layer = {};
  qs.forEach((q, i) => { pos[q.id] = { x: 100 + i * 150, y: 800, display: 1 }; layer[q.id] = 8; });
  let t = T0;
  const now = () => t;
  const random = seeded(opts.seed || 3);
  const romance = createRomance({ data, now, random, TR });
  const started = [], aborted = [];
  const S = createSocialDirector({
    getQuokkas: () => data.quokkas, getRelations: () => data.relations,
    getLayer: (id) => layer[id], getPos: (id) => pos[id], now, random, romance,
    onStart: (j) => started.push(j), onAbort: (j) => aborted.push(j),
    isBlocked: opts.isBlocked, isAway: opts.isAway, freeSlots: opts.freeSlots, constants: opts.constants
  });
  return { data, pos, layer, S, romance, started, aborted, advance: (ms) => { t += ms; } };
}
// 跑很多輪，每輪結束就回報完成
function runRounds(w, n) {
  for (let i = 0; i < n; i++) { w.S.tick(); for (const j of w.S.activePairs()) w.S.done(j.pairId, { ok: true }); }
  return w.started;
}

test('同一地面、700 px 內、都在 L8：會配對並回報 onStart', () => {
  const w = setup([mk('a'), mk('b')]);
  runRounds(w, 5);
  assert.ok(w.started.length > 0);
  const j = w.started[0];
  assert.deepEqual([j.a, j.b].sort(), ['a', 'b']);
  assert.equal(j.initiator, j.a);
  assert.ok(TYPES[j.type] && !TYPES[j.type].couple && !TYPES[j.type].family);
});

test('不同螢幕不配對', () => {
  const w = setup([mk('a'), mk('b')]);
  w.pos.b.display = 2;
  assert.equal(runRounds(w, 30).length, 0);
  w.pos.b.display = { id: 1 };                // display 也可以是物件
  assert.ok(runRounds(w, 30).length > 0);
});

test('地面高度差超過 40 px 不配對；剛好 40 可以', () => {
  const w = setup([mk('a'), mk('b')]);
  w.pos.b.y = w.pos.a.y + 41;
  assert.equal(runRounds(w, 30).length, 0);
  w.pos.b.y = w.pos.a.y + 40;
  assert.ok(runRounds(w, 30).length > 0);
});

test('距離超過 1000 px 不配對', () => {
  const w = setup([mk('a'), mk('b')]);
  w.pos.b.x = w.pos.a.x + 1001;
  assert.equal(runRounds(w, 30).length, 0);
  w.pos.b.x = w.pos.a.x + 990;
  assert.ok(runRounds(w, 30).length > 0);
});

test('忙碌的層級（L0–L6）不配對；L7 散步可以；游標附近不發起', () => {
  for (const l of [0, 1, 2, 3, 4, 5, 6, 'L2']) {
    const w = setup([mk('a'), mk('b')]);
    w.layer.b = l;
    assert.equal(runRounds(w, 20).length, 0, `layer ${l}`);
  }
  const w = setup([mk('a'), mk('b')]);
  w.layer.a = 'L7'; w.layer.b = 7;
  assert.ok(runRounds(w, 20).length > 0);
  const w2 = setup([mk('a'), mk('b')], { isBlocked: (id) => id === 'a' });
  assert.equal(runRounds(w2, 20).length, 0);
});

test('已經在互動中的不再被配對；名額有上限', () => {
  const w = setup([mk('a'), mk('b'), mk('c'), mk('d'), mk('e'), mk('f')], { constants: { maxStartsPerTick: 10, maxActive: 2 } });
  for (let i = 0; i < 10; i++) w.S.tick();
  const act = w.S.activePairs();
  assert.equal(act.length, 2);
  const ids = act.flatMap((j) => [j.a, j.b]);
  assert.equal(new Set(ids).size, ids.length);
  const w2 = setup([mk('a'), mk('b'), mk('c'), mk('d')], { freeSlots: () => 0 });
  assert.equal(runRounds(w2, 20).length, 0);
});

test('情侶專屬互動只給情侶；情侶也會用到情侶互動', () => {
  const w = setup([mk('m', 'male'), mk('f', 'female'), mk('x', 'male'), mk('y', 'female')]);
  w.data.relations[pairKey('m', 'f')] = { affinity: 100, couple: true };
  runRounds(w, 400);
  let coupleTypes = 0;
  for (const j of w.started) {
    const isC = pairKey(j.a, j.b) === pairKey('m', 'f');
    if (TYPES[j.type].couple) { assert.ok(isC, `${j.type} 給了 ${j.a}|${j.b}`); coupleTypes++; }
    assert.ok(!TYPES[j.type].family);
  }
  assert.ok(coupleTypes > 0);
});

test('依個性選種類：慵懶的常並排曬太陽，愛社交又膽大的常碰鼻／擊掌／打球／追逐；誰都常打球', () => {
  const lazy = setup([mk('a', 'male', { activity: 0.05, sociability: 0.6, boldness: 0.5 }), mk('b', 'female', { activity: 0.1, sociability: 0.6, boldness: 0.5 })]);
  const lt = runRounds(lazy, 300).map((j) => j.type);
  assert.ok(lt.filter((t) => t === 'sunbathe').length > lt.length * 0.3);
  assert.ok(lt.filter((t) => t === 'chase').length < lt.length * 0.05);
  assert.ok(lt.filter((t) => ['badminton', 'volleyball', 'basketball'].includes(t)).length > lt.length * 0.1);   // 慵懶的也會打球
  const bold = setup([mk('a', 'male', { activity: 0.8 }), mk('b', 'female', { activity: 0.8 })]);
  const bt = runRounds(bold, 300).map((j) => j.type);
  const n = bt.filter((t) => ['nose', 'paw', 'badminton', 'volleyball', 'basketball', 'chase'].includes(t)).length;
  assert.ok(n > bt.length * 0.6);
  assert.ok(bt.filter((t) => t === 'sunbathe').length < bt.length * 0.1);
});

test('家族：爸爸過來碰跟隨期的小袋鼠；小袋鼠不和別隻互動；育兒袋期不參加', () => {
  const w = setup([
    mk('dad', 'male'), mk('mom', 'female'),
    mk('kid', 'female', {}, { stage: 'follow', mom: 'mom', dad: 'dad' }),
    mk('other', 'male')
  ]);
  runRounds(w, 200);
  const fam = w.started.filter((j) => j.type === 'dadNose');
  assert.ok(fam.length > 0);
  for (const j of fam) { assert.equal(j.a, 'dad'); assert.equal(j.b, 'kid'); assert.equal(j.anchor, 'mom'); }
  for (const j of w.started) if (j.a === 'kid' || j.b === 'kid') assert.equal(j.type, 'dadNose');
  // 爸爸不在同一地面就取消
  const w2 = setup([mk('dad', 'male'), mk('kid', 'female', {}, { stage: 'follow', dad: 'dad' })]);
  w2.pos.dad.y += 100;
  assert.equal(runRounds(w2, 100).length, 0);
  const w3 = setup([mk('a'), mk('kid', 'female', {}, { stage: 'pouch', dad: 'a' })]);
  assert.equal(runRounds(w3, 100).length, 0);
});

test('性別不影響社交主動性：只換性別，配對與種類完全一樣', () => {
  const build = (flip) => {
    seedN = 9000;
    const qs = ['a', 'b', 'c', 'd', 'e'].map((id, i) => mk(id, (i % 2 === 0) !== flip ? 'male' : 'female', { initiative: 0.2 + i * 0.15, sociability: 0.3 + i * 0.1, boldness: 0.5 }));
    const w = setup(qs, { seed: 77, constants: { maxPerMinute: Infinity } });   // 時鐘不動：關掉每分鐘上限
    w.pos.e.x = 300;
    return runRounds(w, 200).map((j) => `${j.a}>${j.b}:${j.type}`);
  };
  const A = build(false), B = build(true);
  assert.ok(A.length > 10);
  assert.deepEqual(A, B);
});

test('主動性高的較常發起', () => {
  const w = setup([mk('hi', 'female', { initiative: 0.9 }), mk('lo', 'male', { initiative: 0.1 })], { seed: 11 });
  runRounds(w, 400);
  const hi = w.started.filter((j) => j.initiator === 'hi').length, lo = w.started.filter((j) => j.initiator === 'lo').length;
  assert.ok(hi > lo * 3, `${hi} vs ${lo}`);
});

test('膽小的對象先觀察，延後一輪', () => {
  const w = setup([mk('a', 'male', { initiative: 1 }), mk('b', 'male', { initiative: 0, boldness: 0.1, sociability: 1 })]);
  w.S.tick();
  assert.equal(w.started.length, 0);
  runRounds(w, 10);
  assert.ok(w.started.length > 0);
});

test('下一次 tick 延遲 15–30 秒，越愛社交越短', () => {
  const social = setup([mk('a', 'male', { sociability: 1 }), mk('b', 'male', { sociability: 1 })]);
  const shy = setup([mk('a', 'male', { sociability: 0, initiative: 0 }), mk('b', 'male', { sociability: 0, initiative: 0 })]);
  for (const w of [social, shy]) w.pos.b.x = w.pos.a.x + 600;          // 不在身邊（250 px 以外）
  let s1 = 0, s2 = 0;
  for (let i = 0; i < 50; i++) {
    const d1 = social.S.tick(), d2 = shy.S.tick();
    for (const d of [d1, d2]) assert.ok(d >= 15000 && d <= 30000, `delay ${d}`);
    s1 += d1; s2 += d2;
    for (const j of social.S.activePairs()) social.S.done(j.pairId);
  }
  assert.ok(s1 < s2);
});

test('同伴在身邊（250 px 內）：下一次檢查提早一半（7.5–15 秒）', () => {
  const w = setup([mk('a', 'male', { initiative: 0 }), mk('b', 'male', { initiative: 0 })]);   // 不主動：互動不會開始，兩隻一直閒著
  for (let i = 0; i < 30; i++) { const d = w.S.tick(); assert.ok(d >= 7500 && d <= 15000, `delay ${d}`); }
  w.pos.b.x = w.pos.a.x + 600;
  for (let i = 0; i < 30; i++) { const d = w.S.tick(); assert.ok(d >= 15000 && d <= 30000, `delay ${d}`); }
});

test('同伴在身邊：比距離遠時更常發起互動', () => {
  const count = (gap) => {
    let n = 0;
    for (let s = 1; s <= 40; s++) {
      const w = setup([mk('a', 'male', { initiative: 0.25 }), mk('b', 'male', { initiative: 0.25 })], { seed: s });
      w.pos.b.x = w.pos.a.x + gap;
      n += runRounds(w, 5).length;
    }
    return n;
  };
  const near = count(150), far = count(600);
  assert.ok(near > far * 1.4, `near ${near} far ${far}`);
});

test('保底：很害羞（不主動）也會在 40 秒內開始一次互動；下一次檢查準時回來', () => {
  const w = setup([mk('a', 'male', { initiative: 0, sociability: 0, boldness: 0.1 }), mk('b', 'female', { initiative: 0, sociability: 0, boldness: 0.1 })]);
  w.pos.b.x = w.pos.a.x + 600;
  assert.equal(runRounds(w, 5).length, 0);                // 時間還沒到：不發起
  w.advance(30000);
  const d = w.S.tick();
  assert.ok(d <= 10000, `delay ${d}`);                     // 保底快到了：10 秒內回來
  w.advance(d);
  w.S.tick();
  assert.equal(w.started.length, 1);                       // 到了 40 秒：一定開始一次
  for (const j of w.S.activePairs()) w.S.done(j.pairId);
  w.S.tick();
  assert.equal(w.started.length, 1);                       // 剛開始過：不會馬上再保底
});

test('done：一起完成加好感；abort：工作反應 +1、響鈴與拖曳不變', () => {
  const w = setup([mk('a'), mk('b')]);
  runRounds(w, 1);
  while (!w.started.length) runRounds(w, 1);
  const r = w.romance.relation('a', 'b');
  assert.ok(r.affinity >= 4 && r.affinity <= 10);
  const before = r.affinity;
  const go = () => { const n = w.started.length; while (w.started.length === n) w.S.tick(); return w.started[w.started.length - 1]; };
  let j = go();
  const res = w.S.abort(j.pairId, 'a', 'work');
  assert.equal(res.partner, 'b');
  assert.equal(r.affinity, before + 1);
  j = go(); w.S.abort(j.pairId, 'b', 'alert');
  j = go(); w.S.abort(j.pairId, 'a', 'drag');
  j = go(); w.S.done(j.pairId, { ok: false });
  assert.equal(r.affinity, before + 1);
  assert.equal(w.S.isBusy('a'), false);
});

test('onLayer：任一方變成比 L5 高的層級就中止並通知 social:abort', () => {
  const w = setup([mk('a'), mk('b')]);
  while (!w.S.activePairs().length) w.S.tick();
  const j = w.S.activePairs()[0];
  assert.equal(w.S.onLayer('a', 5), null);     // 自己進入 L5 不算
  assert.equal(w.S.onLayer('a', 7), null);
  const out = w.S.onLayer('b', 1);
  assert.equal(out.pairId, j.pairId);
  assert.equal(out.reason, 'alert');
  assert.equal(w.aborted.length, 1);
  assert.equal(w.S.isBusy('a'), false);
  assert.equal(w.S.onLayer('b', 0), null);     // 已經沒有互動
});

test('刪除：先中止互動；散步經過 +1 每天一次', () => {
  const w = setup([mk('a'), mk('b')]);
  while (!w.S.activePairs().length) w.S.tick();
  const out = w.S.removeQuokka('a');
  assert.equal(out.reason, 'delete');
  assert.equal(w.S.activePairs().length, 0);
  const w2 = setup([mk('a', 'male', { initiative: 0 }), mk('b', 'male', { initiative: 0 })]);
  w2.S.passBy('a', 'b'); w2.S.passBy('b', 'a');
  assert.equal(w2.romance.relation('a', 'b').affinity, 1);
  w2.advance(DAY_MS);
  w2.S.passBy('a', 'b');
  assert.equal(w2.romance.relation('a', 'b').affinity, 2);
  w2.pos.b.display = 9;                         // 不同螢幕不算經過
  w2.advance(DAY_MS);
  w2.S.passBy('a', 'b');
  assert.equal(w2.romance.relation('a', 'b').affinity, 2);
});

// 模擬：照主行程的排程方式跑 30 分鐘（每次 tick 回傳下一次延遲；互動 6–20 秒後完成），量每個 60 秒區間開始幾次
function simulate(qs, minutes, seed, opts = {}) {
  const w = setup(qs, { seed, ...opts });
  const rnd = seeded(seed + 99);
  const ends = [];                                         // [時間, pairId]
  let t = 0, nextTick = 15000;
  const starts = [];
  w.S._onStartTimes = starts;
  const total = minutes * 60000;
  while (t < total) {
    const nextEnd = ends.length ? Math.min(...ends.map((e) => e[0])) : Infinity;
    const step = Math.min(nextTick, nextEnd) - t;
    w.advance(step); t += step;
    for (const e of ends.filter((e) => e[0] <= t)) { w.S.done(e[1]); ends.splice(ends.indexOf(e), 1); }
    if (t >= nextTick) {
      const before = w.started.length;
      nextTick = t + w.S.tick();
      for (const j of w.started.slice(before)) { starts.push(t); ends.push([t + 6000 + rnd() * 14000, j.pairId]); }
    }
  }
  return starts;
}
const perWindow = (starts, minutes) => { const out = []; for (let s = 60000; s + 60000 <= minutes * 60000; s += 1000) out.push(starts.filter((x) => x >= s && x < s + 60000).length); return out; };

test('頻率：害羞的 4 隻（像使用者的設定）每 60 秒至少 1 次、最多 10 次', () => {
  for (const seed of [1, 2, 3]) {
    const qs = [mk('a', 'male', { sociability: 0.14, initiative: 0.14, boldness: 0.48, activity: 0.5 }), mk('b', 'male', { sociability: 0.06, initiative: 0.05, boldness: 0.3, activity: 0.23 }),
      mk('c', 'female', { sociability: 0.56, initiative: 0.5, boldness: 0.27, activity: 0.14 }), mk('d', 'female', { sociability: 0.36, initiative: 0.44, boldness: 0.95, activity: 0.56 })];
    const win = perWindow(simulate(qs, 30, seed), 30);
    assert.ok(Math.min(...win) >= 1, `seed ${seed} min ${Math.min(...win)}`);
    assert.ok(Math.max(...win) <= 10, `seed ${seed} max ${Math.max(...win)}`);
  }
});

test('頻率：10 隻都很愛社交也不超過每 60 秒 10 次', () => {
  const qs = Array.from({ length: 10 }, (_, i) => mk('q' + i, i % 2 ? 'female' : 'male'));
  const win = perWindow(simulate(qs, 30, 5), 30);
  assert.ok(Math.max(...win) <= 10, `max ${Math.max(...win)}`);
  assert.ok(Math.min(...win) >= 1);
});

test('使用者剛離開：保底提早到 20 秒、互動比較多，但仍然每 60 秒最多 10 次', () => {
  const shy = () => [mk('a', 'male', { initiative: 0, sociability: 0, boldness: 0.1 }), mk('b', 'female', { initiative: 0, sociability: 0, boldness: 0.1 })];
  const w = setup(shy(), { isAway: () => true });
  w.pos.b.x = w.pos.a.x + 600;
  w.advance(20000); w.S.tick();
  assert.equal(w.started.length, 1);                       // 離開時 20 秒就保底
  const user = () => [mk('a', 'male', { sociability: 0.14, initiative: 0.14, boldness: 0.48, activity: 0.5 }), mk('b', 'male', { sociability: 0.06, initiative: 0.05, boldness: 0.3, activity: 0.23 }),
    mk('c', 'female', { sociability: 0.56, initiative: 0.5, boldness: 0.27, activity: 0.14 }), mk('d', 'female', { sociability: 0.36, initiative: 0.44, boldness: 0.95, activity: 0.56 })];
  const here = perWindow(simulate(user(), 30, 1), 30), away = perWindow(simulate(user(), 30, 1, { isAway: () => true }), 30);
  const avg = (w) => w.reduce((a, b) => a + b, 0) / w.length;
  assert.ok(avg(away) > avg(here) * 1.4, `away ${avg(away)} here ${avg(here)}`);
  assert.ok(Math.min(...away) >= 2 && Math.max(...away) <= 10, `away min ${Math.min(...away)} max ${Math.max(...away)}`);
  const ten = perWindow(simulate(Array.from({ length: 10 }, (_, i) => mk('q' + i, i % 2 ? 'female' : 'male')), 30, 5, { isAway: () => true }), 30);
  assert.ok(Math.max(...ten) <= 10);
});
