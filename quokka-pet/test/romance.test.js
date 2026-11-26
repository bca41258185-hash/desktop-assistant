// 戀愛與家族（lib/romance.js）：好感度、好朋友、成為一對、懷孕、遊戲時鐘、出生與暫名、遺傳、長大、刪除
const { test } = require('node:test');
const assert = require('node:assert/strict');
const TR = require('../renderer/traits');
const { createRomance, inherit, pairKey, DAY_MS } = require('../lib/romance');

const MIN = 60 * 1000;
// 可重現的亂數
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// 假時鐘：從本地時間 2026-01-10 12:00 開始
function clock() {
  let t = new Date(2026, 0, 10, 12, 0, 0).getTime();
  const now = () => t;
  now.add = (ms) => { t += ms; };
  now.days = (d) => { t += d * DAY_MS; };
  return now;
}
let seedCounter = 100;
function mk(now, id, sex, ageDays = 365, extra = {}) {
  const t = TR.generate(seedCounter++); TR.ensurePersonality(t); TR.ensureAccessory(t);
  t.sex = sex;
  t.birthAt = new Date(now() - ageDays * DAY_MS).toISOString();
  if (extra.personality) Object.assign(t.personality, extra.personality);
  return { id, name: extra.name || id, traits: t, home: null, stage: 'adult', mom: extra.mom || null, dad: extra.dad || null, pregnancy: null, joey: null, growth: null, lastBirthAt: null, createdAt: new Date(now()).toISOString() };
}
function world(qs, opts = {}) {
  const now = opts.now || clock();
  const data = { version: 2, quokkas: [], relations: {}, lineage: {}, settings: { romance: true, babies: true, ...(opts.settings || {}) } };
  for (const q of qs) data.quokkas.push(typeof q === 'function' ? q(now) : q);
  let rv = opts.rv != null ? opts.rv : null;
  const rnd = seeded(opts.seed || 7);
  const random = () => (rv != null ? rv : rnd());
  const R = createRomance({ data, now, random, TR });
  return { data, now, R, setRandom: (v) => { rv = v; }, q: (id) => data.quokkas.find((x) => x.id === id) };
}
const setAff = (w, a, b, v) => { w.R.onPass(a, b); w.data.relations[pairKey(a, b)].affinity = v; };
// 愛情：設成互相有感覺（attracted），愛情 v
const setLove = (w, a, b, v, attracted = true) => { w.R.onPass(a, b); Object.assign(w.data.relations[pairKey(a, b)], { love: v, attracted }); };
// 一對成年的公母，愛情 100、已經是情侶
function couple(opts = {}) {
  const w = world([(n) => mk(n, 'm', 'male', 400, { name: '阿公' }), (n) => mk(n, 'f', 'female', 400, { name: '工地鼠' })], opts);
  setLove(w, 'm', 'f', 100);
  const r = w.R.onTogether('m', 'f');
  assert.ok(r.couple);
  return w;
}

test('好感度：一次互動 +4～+10，每對每天最多 +20，隔天再加', () => {
  const w = world([(n) => mk(n, 'a', 'male'), (n) => mk(n, 'b', 'male')]);
  const g = w.R.onTogether('a', 'b').gained;
  assert.ok(g >= 4 && g <= 10, `gained ${g}`);
  for (let i = 0; i < 10; i++) w.R.onTogether('a', 'b');
  assert.equal(w.R.relation('a', 'b').affinity, 20);
  assert.equal(w.R.onTogether('a', 'b').gained, 0);
  w.now.days(1);
  assert.ok(w.R.onTogether('a', 'b').gained > 0);
  assert.ok(w.R.relation('a', 'b').affinity <= 40);
});

test('好感度最高 100', () => {
  const w = world([(n) => mk(n, 'a', 'male'), (n) => mk(n, 'b', 'male')]);
  for (let d = 0; d < 20; d++) { for (let i = 0; i < 6; i++) w.R.onTogether('a', 'b'); w.now.days(1); }
  assert.equal(w.R.relation('a', 'b').affinity, 100);
});

test('散步經過 +1，每對每天一次', () => {
  const w = world([(n) => mk(n, 'a', 'male'), (n) => mk(n, 'b', 'female')]);
  assert.equal(w.R.onPass('a', 'b').gained, 1);
  assert.equal(w.R.onPass('b', 'a').gained, 0);
  w.now.days(1);
  assert.equal(w.R.onPass('a', 'b').gained, 1);
  assert.equal(w.R.relation('a', 'b').affinity, 2);
});

test('衰退：連續 7 天沒互動後每天 −2，補扣不重複，最低 0', () => {
  const w = world([(n) => mk(n, 'a', 'male'), (n) => mk(n, 'b', 'female')]);
  w.R.onTogether('a', 'b');
  const r = w.R.relation('a', 'b'); r.affinity = 50;
  w.now.days(7); w.R.dailyDecay();
  assert.equal(r.affinity, 50);
  w.now.days(3); w.R.dailyDecay(); w.R.dailyDecay();
  assert.equal(r.affinity, 44);
  w.now.days(100); w.R.dailyDecay();
  assert.equal(r.affinity, 0);
  // 互動後重新起算
  w.R.onTogether('a', 'b'); const v = r.affinity;
  w.now.days(5); w.R.dailyDecay();
  assert.equal(r.affinity, v);
});

test('好朋友：不分性別，好感 ≥ 80 就是好朋友（性別不影響社交主動性）', () => {
  const w = world([(n) => mk(n, 'a', 'female'), (n) => mk(n, 'b', 'female'), (n) => mk(n, 'c', 'male'), (n) => mk(n, 'd', 'male')]);
  setAff(w, 'a', 'b', 78);
  const r = w.R.onTogether('a', 'b');
  assert.ok(r.friend);
  assert.ok(r.events.some((e) => e.type === 'friend'));
  assert.ok(w.R.isFriend('a', 'b'));
  setAff(w, 'a', 'c', 85);                                       // 異性 80–99：一樣是好朋友
  const x = w.R.onTogether('a', 'c');
  assert.equal(x.friend, true);
  assert.ok(w.R.isFriend('a', 'c'));
  setAff(w, 'c', 'd', 85);                                       // 公公也是
  assert.equal(w.R.onTogether('c', 'd').friend, true);
  setAff(w, 'b', 'd', 50);                                       // 沒到門檻：不是
  assert.equal(w.R.onTogether('b', 'd').friend, false);
});

test('成為一對：互相有感覺、成年、單身、愛情 100（友情再高也不會變情侶）', () => {
  const w = world([(n) => mk(n, 'm', 'male'), (n) => mk(n, 'f', 'female')]);
  setAff(w, 'm', 'f', 100); setLove(w, 'm', 'f', 0, false);
  assert.equal(w.R.canPair('m', 'f').reason, 'no-love');               // 只是好朋友
  assert.equal(w.R.onTogether('m', 'f').couple, false);
  setLove(w, 'm', 'f', 99);
  assert.equal(w.R.canPair('m', 'f').reason, 'love');                  // 愛情還沒滿
  const r = w.R.onTogether('m', 'f');
  assert.ok(r.couple && r.events.some((e) => e.type === 'couple'));
  assert.equal(w.R.partnerOf('m'), 'f');
  assert.ok(w.R.relation('m', 'f').since);
});

test('同性也可以相愛成為一對，但不會生寶寶', () => {
  const w = world([(n) => mk(n, 'a', 'male'), (n) => mk(n, 'b', 'male')], { rv: 0 });
  setLove(w, 'a', 'b', 100);
  assert.ok(w.R.canPair('a', 'b').ok);
  assert.ok(w.R.onTogether('a', 'b').couple);
  for (let d = 0; d < 5; d++) { w.now.days(1); w.R.onTogether('a', 'b'); }
  assert.ok(!w.q('a').pregnancy && !w.q('b').pregnancy);
});

test('有沒有感覺：成年後第一次互動決定一次；異性約 75%、同性約 12%；親人不會', () => {
  const rate = (sexB) => {
    let n = 0;
    for (let s = 1; s <= 400; s++) { const w = world([(x) => mk(x, 'a', 'male'), (x) => mk(x, 'b', sexB)], { seed: s }); w.R.onTogether('a', 'b'); if (w.R.relation('a', 'b').attracted) n++; }
    return n / 400;
  };
  const opp = rate('female'), same = rate('male');
  assert.ok(opp > 0.65 && opp < 0.85, `opp ${opp}`);
  assert.ok(same > 0.06 && same < 0.2, `same ${same}`);
  // 決定後不變；沒感覺的只累積友情
  const w = world([(x) => mk(x, 'a', 'male'), (x) => mk(x, 'b', 'female')], { rv: 0.99 });
  const r1 = w.R.onTogether('a', 'b');
  assert.equal(r1.attracted, false); assert.equal(r1.love, 0); assert.ok(r1.affinity > 0);
  w.setRandom(0); w.now.days(1); w.R.onTogether('a', 'b');
  assert.equal(w.R.relation('a', 'b').attracted, false);
  // 有感覺：友情和愛情一起加
  const w2 = world([(x) => mk(x, 'a', 'male'), (x) => mk(x, 'b', 'female')], { rv: 0 });
  const r2 = w2.R.onTogether('a', 'b');
  assert.equal(r2.attracted, true); assert.ok(r2.love > 0 && r2.love === r2.affinity);
  // 還沒成年：先不決定，長大後再決定
  const w3 = world([(x) => mk(x, 'a', 'male', 5), (x) => mk(x, 'b', 'female', 5)], { rv: 0 });
  w3.R.onTogether('a', 'b');
  assert.equal(w3.R.relation('a', 'b').attracted, null);
});

test('愛情不滿就不會懷孕（愛情淡了也一樣）', () => {
  const w = couple({ rv: 0 });
  w.data.relations[pairKey('m', 'f')].love = 90;
  w.now.days(1); w.R.onTogether('m', 'f');                  // 這次會加愛情（+4～+10），但擲骰前要先滿
  const r = w.data.relations[pairKey('m', 'f')];
  if (r.love < 100) assert.equal(w.q('f').pregnancy, null);
  r.love = 100; w.now.days(1); w.R.onTogether('m', 'f');
  assert.ok(w.q('f').pregnancy);
});

test('舊資料：已經是情侶的轉成愛情滿、互相有感覺；其他從 0 開始', () => {
  const now = clock();
  const data = { version: 2, quokkas: [mk(now, 'm', 'male'), mk(now, 'f', 'female'), mk(now, 'x', 'male')], lineage: {}, settings: {},
    relations: { [pairKey('m', 'f')]: { affinity: 100, couple: true, friend: true }, [pairKey('m', 'x')]: { affinity: 60, couple: false, friend: false } } };
  const R = createRomance({ data, now, random: () => 0.5, TR });
  assert.equal(R.relation('m', 'f').love, 100); assert.equal(R.relation('m', 'f').attracted, true);
  assert.equal(R.relation('m', 'x').love, 0); assert.equal(R.relation('m', 'x').attracted, null);
});

test('成為一對：遊戲年齡（真實 1 天＝1 個月），母 ≥ 18、公 ≥ 12', () => {
  const w = world([(n) => mk(n, 'm', 'male', 11.5), (n) => mk(n, 'f', 'female', 17.5)]);
  setLove(w, 'm', 'f', 100);
  assert.ok(Math.abs(w.R.ageMonths(w.q('f')) - 17.5) < 1e-9);
  assert.equal(w.R.canPair('m', 'f').reason, 'too-young');
  w.now.days(0.6);              // 公 12.1、母 18.1
  assert.ok(w.R.canPair('m', 'f').ok);
  // 程式關著也照算：年齡只看 birthAt
  const w2 = world([(n) => mk(n, 'm', 'male', 12), (n) => mk(n, 'f', 'female', 17)]);
  setLove(w2, 'm', 'f', 100);
  assert.equal(w2.R.canPair('m', 'f').ok, false);
  w2.now.days(1);
  assert.ok(w2.R.canPair('m', 'f').ok);
});

test('成為一對：已經有伴侶的不行', () => {
  const w = couple();
  w.data.quokkas.push(mk(w.now, 'f2', 'female'));
  setLove(w, 'm', 'f2', 100);
  assert.equal(w.R.canPair('m', 'f2').reason, 'has-partner');
  assert.equal(w.R.onTogether('m', 'f2').couple, false);
});

test('成為一對：戀愛系統關閉時不行', () => {
  const w = world([(n) => mk(n, 'm', 'male'), (n) => mk(n, 'f', 'female')], { settings: { romance: false } });
  setLove(w, 'm', 'f', 100);
  assert.equal(w.R.canPair('m', 'f').reason, 'romance-off');
});

test('近親：父母子女、兄弟姊妹、同父異母、祖孫（含已刪除的祖先）、表親、叔姪', () => {
  const now = clock();
  const w = world([
    mk(now, 'dad', 'male'), mk(now, 'mom', 'female'),
    mk(now, 'son', 'male', 100, { mom: 'mom', dad: 'dad' }), mk(now, 'dau', 'female', 100, { mom: 'mom', dad: 'dad' }),
    mk(now, 'half', 'female', 100, { mom: 'other', dad: 'dad' }),
    mk(now, 'gs', 'male', 50, { mom: 'dau', dad: 'x1' }),
    mk(now, 'stranger', 'female', 100),
    // 祖先已刪除，只剩墓碑紀錄
    mk(now, 'c1', 'male', 100, { mom: 'gone1' }), mk(now, 'c2', 'female', 100, { mom: 'gone2' })
  ], { now });
  w.data.lineage.gone1 = { name: 'g1', sex: 'female', mom: 'grandma', dad: null, deletedAt: '2025-01-01' };
  w.data.lineage.gone2 = { name: 'g2', sex: 'female', mom: 'grandma', dad: null, deletedAt: '2025-01-01' };
  w.data.lineage.grandma = { name: 'gm', sex: 'female', mom: null, dad: null, deletedAt: '2024-01-01' };
  const R = w.R;
  assert.ok(R.isKin('dad', 'dau'));          // 父女
  assert.ok(R.isKin('son', 'dau'));          // 兄妹
  assert.ok(R.isKin('son', 'half'));         // 同父異母
  assert.ok(R.isKin('dad', 'gs'));           // 祖孫
  assert.ok(R.isKin('son', 'gs'));           // 舅甥（叔姪）
  assert.ok(R.isKin('c1', 'c2'));            // 表親：共同祖先只在墓碑紀錄裡
  assert.equal(R.isKin('son', 'stranger'), false);
  setLove(w, 'son', 'dau', 100);
  assert.equal(R.canPair('son', 'dau').reason, 'kin');
  setLove(w, 'c1', 'c2', 100);
  assert.equal(R.canPair('c1', 'c2').reason, 'kin');
  setLove(w, 'son', 'stranger', 100);
  assert.ok(R.canPair('son', 'stranger').ok);
  // 墓碑紀錄的祖先被刪掉的活庫卡：刪除後仍能從 lineage 查到
  R.onDelete('dau'); w.data.quokkas = w.data.quokkas.filter((q) => q.id !== 'dau');
  assert.ok(R.isKin('dad', 'gs'));
});

test('懷孕：成為一對之後，每天第一次一起互動擲一次 30%', () => {
  const w = couple();
  assert.equal(w.q('f').pregnancy, null);    // 成為一對的那次不擲
  w.setRandom(0.5);
  w.R.onTogether('m', 'f');
  assert.equal(w.q('f').pregnancy, null);
  w.setRandom(0.0);
  w.R.onTogether('m', 'f');                  // 同一天不再擲
  assert.equal(w.q('f').pregnancy, null);
  w.now.days(1);
  w.setRandom(0.29);
  const r = w.R.onTogether('f', 'm');
  assert.deepEqual(w.q('f').pregnancy, { dad: 'm', gestationMs: 0 });
  assert.ok(r.events.some((e) => e.type === 'pregnant' && e.mom === 'f' && e.dad === 'm'));
});

test('懷孕機率約 30%', () => {
  let hits = 0;
  for (let s = 1; s <= 400; s++) {
    const w = couple({ seed: s });
    w.now.days(1);
    w.R.onTogether('m', 'f');
    if (w.q('f').pregnancy) hits++;
  }
  assert.ok(hits > 90 && hits < 150, `hits ${hits}`);
});

test('懷孕：寶寶出生或戀愛設定關閉時不懷孕；已經懷孕的照常生', () => {
  for (const settings of [{ babies: false }, { romance: false }]) {
    const w = couple({ rv: 0 });
    Object.assign(w.data.settings, settings);
    w.now.days(1);
    w.R.onTogether('m', 'f');
    assert.equal(w.q('f').pregnancy, null);
  }
  const w = couple({ rv: 0 });
  w.now.days(1); w.R.onTogether('m', 'f');
  assert.ok(w.q('f').pregnancy);
  w.data.settings.babies = false; w.data.settings.romance = false;
  assert.ok(w.R.tickClock(27 * MIN).some((e) => e.type === 'birth'));
  // 關閉戀愛時仍維持伴侶關係
  assert.equal(w.R.partnerOf('m'), 'f');
});

test('懷孕冷卻：同一位媽媽生完 7 天內不再懷孕', () => {
  const w = couple({ rv: 0 });
  w.q('f').lastBirthAt = new Date(w.now() - 3 * DAY_MS).toISOString();
  w.now.days(1); w.R.onTogether('m', 'f');
  assert.equal(w.q('f').pregnancy, null);
  w.now.days(3); w.R.onTogether('m', 'f');     // 生完第 7 天
  assert.ok(w.q('f').pregnancy);
});

test('遊戲時鐘只在開著時累加：關閉期間（不呼叫 tickClock）不算', () => {
  const w = couple({ rv: 0 });
  w.now.days(1); w.R.onTogether('m', 'f');
  w.R.tickClock(10 * MIN);
  w.now.days(3);                               // 程式關了 3 天
  assert.deepEqual(w.R.tickClock(0).filter((e) => e.type === 'birth'), []);
  assert.equal(w.q('f').pregnancy.gestationMs, 10 * MIN);
  assert.deepEqual(w.R.tickClock(16 * MIN).filter((e) => e.type === 'birth'), []);
  const ev = w.R.tickClock(1 * MIN);
  const birth = ev.find((e) => e.type === 'birth');
  assert.ok(birth);
  const child = w.q(birth.child);
  assert.equal(child.stage, 'pouch');
  assert.equal(child.mom, 'f'); assert.equal(child.dad, 'm');
  assert.equal(child.name, '工地鼠寶寶'); assert.equal(child.nameTemp, true);
  assert.equal(w.q('f').pregnancy, null);
  assert.deepEqual(w.q('f').joey, { id: child.id, phaseMs: 0 });
  assert.equal(w.q('f').lastBirthAt, new Date(w.now()).toISOString());
  assert.ok(w.data.lineage[child.id] && w.data.lineage[child.id].mom === 'f');
  assert.equal(w.R.ageMonths(child), 0);
  assert.equal(w.R.canOwnTasks(child), false);
});

test('暫名撞名加數字；使用者取的名字優先，暫名改號', () => {
  const w = couple({ rv: 0 });
  w.data.quokkas.push(mk(w.now, 'x', 'male', 400, { name: '工地鼠寶寶' }));
  w.now.days(1); w.R.onTogether('m', 'f');
  const birth = w.R.tickClock(27 * MIN).find((e) => e.type === 'birth');
  const child = w.q(birth.child);
  assert.equal(child.name, '工地鼠寶寶2');
  // 使用者把別隻改名成「工地鼠寶寶2」：暫名讓位
  const moved = w.R.resolveNameClash('工地鼠寶寶2', 'x');
  assert.equal(moved.length, 1);
  assert.equal(child.name, '工地鼠寶寶3');
  // 名字太長時截短，總長不超過 12 字
  assert.equal(Array.from(w.R.tempName('一二三四五六七八九十十一')).length, 12);
});

test('育兒袋 10 分 → 跟隨 50 分 → 亞成體；7 天長到成年體型；18 個月成年', () => {
  const w = couple({ rv: 0 });
  w.now.days(1); w.R.onTogether('m', 'f');
  const id = w.R.tickClock(27 * MIN).find((e) => e.type === 'birth').child;
  const child = w.q(id);
  const len0 = child.traits.lengthCm;
  assert.deepEqual(w.R.tickClock(9 * MIN).map((e) => e.type), []);
  assert.ok(w.R.tickClock(1 * MIN).some((e) => e.type === 'joey-out' && e.qid === id));
  assert.equal(child.stage, 'follow');
  w.now.days(2);                               // 關掉兩天：跟隨期不前進
  w.R.tickClock(0);
  assert.equal(child.stage, 'follow');
  const ev = w.R.tickClock(50 * MIN);
  assert.ok(ev.some((e) => e.type === 'independent' && e.qid === id));
  assert.equal(child.stage, 'juvenile');
  assert.equal(w.q('f').joey, null);
  assert.equal(Date.parse(child.growth.adultAt), w.now() + 7 * DAY_MS);
  assert.ok(child.traits.lengthCm > len0);
  w.now.days(3.5); w.R.tickClock(0);
  const mid = child.traits.lengthCm;
  assert.ok(mid > child.traits.adultSize.lengthCm * 0.8 && mid < child.traits.adultSize.lengthCm);
  w.now.days(3.6);
  assert.ok(w.R.tickClock(0).some((e) => e.type === 'grown' && e.qid === id));
  assert.equal(child.traits.lengthCm, child.traits.adultSize.lengthCm);
  assert.equal(child.growth, null);
  w.now.days(11);                              // 出生約 18 天
  assert.ok(w.R.tickClock(0).some((e) => e.type === 'adult' && e.qid === id));
  assert.equal(child.stage, 'adult');
  assert.equal(child.traits.stage, 'adult');
});

test('遺傳：體型在該性別正常範圍、毛色在爸媽之間附近、個性 0.6×平均＋0.4×隨機', () => {
  const now = clock();
  const mom = mk(now, 'f', 'female'), dad = mk(now, 'm', 'male');
  mom.traits.fur = { ...mom.traits.fur, dh: -6, sat: 0.7, dl: -0.06 };
  dad.traits.fur = { ...dad.traits.fur, dh: 4, sat: 1.1, dl: 0.04 };
  Object.assign(mom.traits.personality, { activity: 1, sociability: 1, boldness: 0, curiosity: 0, affection: 0.5 });
  Object.assign(dad.traits.personality, { activity: 1, sociability: 0, boldness: 0, curiosity: 0, affection: 0.5 });
  const sums = { activity: 0, sociability: 0, boldness: 0 }, sexes = new Set();
  const N = 300;
  for (let s = 1; s <= N; s++) {
    const c = inherit(TR, mom.traits, dad.traits, s * 7919);
    const R = TR.RANGES[c.sex]; sexes.add(c.sex);
    assert.ok(c.adultSize.lengthCm >= R.len[0] && c.adultSize.lengthCm <= R.len[1]);
    assert.ok(c.adultSize.tailCm >= R.tail[0] && c.adultSize.tailCm <= R.tail[1]);
    assert.ok(c.adultSize.weightKg >= R.wt[0] && c.adultSize.weightKg <= R.wt[1]);
    assert.ok(c.fur.dh >= -1 - 1.3 && c.fur.dh <= -1 + 1.3, `dh ${c.fur.dh}`);
    assert.ok(c.fur.sat >= 0.9 - 0.05 && c.fur.sat <= 0.9 + 0.05);
    assert.ok(c.fur.dl >= -0.01 - 0.013 && c.fur.dl <= -0.01 + 0.013);
    const p = c.personality;
    assert.ok(p.activity >= 0.6 && p.activity <= 1);            // 平均 1 → 0.6～1.0
    assert.ok(p.sociability >= 0.3 && p.sociability <= 0.7);    // 平均 0.5 → 0.3～0.7
    assert.ok(p.boldness >= 0 && p.boldness <= 0.4);            // 平均 0 → 0～0.4
    for (const k of Object.keys(sums)) sums[k] += p[k];
    assert.ok(p.likes.length === 2 && p.hobbies.length === 2 && p.archetype && p.socialStyle);
    assert.ok(typeof p.initiative === 'number');
    assert.ok(c.accessory && c.accessory.type);
    assert.equal(c.ageMonths, 0);
  }
  assert.ok(Math.abs(sums.activity / N - 0.8) < 0.03);
  assert.ok(Math.abs(sums.sociability / N - 0.5) < 0.03);
  assert.ok(Math.abs(sums.boldness / N - 0.2) < 0.03);
  assert.equal(sexes.size, 2);
  // 同一個 seed 結果相同
  assert.deepEqual(inherit(TR, mom.traits, dad.traits, 42), inherit(TR, mom.traits, dad.traits, 42));
});

test('刪除伴侶：另一隻恢復單身，關係移除，留下墓碑紀錄', () => {
  const w = couple();
  const ev = w.R.onDelete('m');
  assert.ok(ev.some((e) => e.type === 'single' && e.qid === 'f'));
  assert.equal(w.R.partnerOf('f'), null);
  assert.equal(w.data.relations[pairKey('m', 'f')], undefined);
  assert.ok(w.data.lineage.m.deletedAt);
  assert.equal(w.data.lineage.m.sex, 'male');
});

test('刪除：懷孕中先警告；爸爸被刪除懷孕照常，dad 指向墓碑', () => {
  const w = couple({ rv: 0 });
  w.now.days(1); w.R.onTogether('m', 'f');
  assert.equal(w.R.deleteWarning('f'), 'pregnant');
  assert.equal(w.R.deleteWarning('m'), null);
  w.R.onDelete('m'); w.data.quokkas = w.data.quokkas.filter((q) => q.id !== 'm');
  const birth = w.R.tickClock(27 * MIN).find((e) => e.type === 'birth');
  assert.equal(w.q(birth.child).dad, 'm');
  assert.ok(w.data.lineage.m.deletedAt);
});

function withJoey(opts) {
  const w = couple({ rv: 0, ...opts });
  w.now.days(1); w.R.onTogether('m', 'f');
  const id = w.R.tickClock(27 * MIN).find((e) => e.type === 'birth').child;
  return { w, id };
}

test('刪除帶著育兒袋期小袋鼠的媽媽：變跟隨期交給爸爸；沒有爸爸就變亞成體', () => {
  let { w, id } = withJoey();
  let ev = w.R.onDelete('f'); w.data.quokkas = w.data.quokkas.filter((q) => q.id !== 'f');
  assert.equal(w.q(id).stage, 'follow');
  assert.equal(w.q('m').joey.id, id);
  assert.equal(w.R.guardianOf(id), 'm');
  assert.ok(ev.some((e) => e.type === 'joey-to-dad'));
  // 跟隨期照常結束
  assert.ok(w.R.tickClock(50 * MIN).some((e) => e.type === 'independent' && e.qid === id));
  assert.equal(w.q('m').joey, null);

  ({ w, id } = withJoey());
  w.R.onDelete('m'); w.data.quokkas = w.data.quokkas.filter((q) => q.id !== 'm');
  ev = w.R.onDelete('f'); w.data.quokkas = w.data.quokkas.filter((q) => q.id !== 'f');
  assert.equal(w.q(id).stage, 'juvenile');
  assert.ok(w.q(id).growth.adultAt);
  assert.ok(ev.some((e) => e.type === 'independent'));
});

test('刪除小袋鼠：媽媽解除 hasFollower', () => {
  const { w, id } = withJoey();
  const ev = w.R.onDelete(id);
  assert.equal(w.q('f').joey, null);
  assert.ok(ev.some((e) => e.type === 'follower-gone' && e.qid === 'f'));
});

test('重新生成：有伴侶、懷孕中、育兒中、有父母時不行', () => {
  const { w, id } = withJoey();
  assert.equal(w.R.canRegenerate('m').reason, 'has-partner');
  assert.equal(w.R.canRegenerate(id).reason, 'has-parents');
  w.data.quokkas.push(mk(w.now, 'solo', 'female'));
  assert.ok(w.R.canRegenerate('solo').ok);
  w.q('solo').pregnancy = { dad: 'z', gestationMs: 0 };
  assert.equal(w.R.canRegenerate('solo').reason, 'pregnant');
  w.data.quokkas.push(mk(w.now, 'p', 'female'));
  w.q('p').joey = { id: 'zz', phaseMs: 0 };
  assert.equal(w.R.canRegenerate('p').reason, 'parenting');
});

test('舊資料沒有 birthAt：用建立時間 − 年齡（月）天補上', () => {
  const now = clock();
  const q = mk(now, 'a', 'female');
  delete q.traits.birthAt; q.traits.ageMonths = 20;
  q.createdAt = new Date(now() - 5 * DAY_MS).toISOString();
  const w = world([q], { now });
  assert.ok(Math.abs(w.R.ageMonths(w.q('a')) - 25) < 1e-9);
  assert.ok(w.q('a').traits.birthAt);
});

test('喜歡的對象：愛情最高且至少 20；有伴侶就是伴侶；好朋友、親人、小袋鼠都不算', () => {
  const w = world([(n) => mk(n, 'a', 'male'), (n) => mk(n, 'b', 'female'), (n) => mk(n, 'c', 'female'), (n) => mk(n, 'kid', 'female', 400, { mom: 'b' })]);
  assert.equal(w.R.crushOf('a'), null);                    // 還沒有愛情
  setAff(w, 'a', 'b', 95);
  assert.equal(w.R.crushOf('a'), null);                    // 友情再高也不是「喜歡」
  setLove(w, 'a', 'b', 19);
  assert.equal(w.R.crushOf('a'), null);                    // 不到 20
  setLove(w, 'a', 'b', 30); setLove(w, 'a', 'c', 45);
  assert.equal(w.R.crushOf('a'), 'c');                     // 愛情最高的那一隻
  assert.equal(w.R.crushOf('c'), 'a');
  setLove(w, 'b', 'kid', 90);
  assert.equal(w.R.crushOf('kid'), null);                  // 親人不算（媽媽和女兒）
  w.q('c').stage = 'follow';
  assert.equal(w.R.crushOf('a'), 'b');                     // 跟隨期的小袋鼠不算
  w.q('c').stage = 'adult';
  w.data.relations[pairKey('a', 'b')].couple = true;
  assert.equal(w.R.crushOf('a'), 'b');                     // 有伴侶就是伴侶，即使對別隻愛情更高
});

test('特殊性別：和生理性別分開、約 4%、不影響原本抽出來的外型；有一方是特殊性別時約 40% 有感覺；生寶寶看生理性別', () => {
  let n = 0;
  for (let s = 1; s <= 4000; s++) { const t = TR.generate(s); assert.ok(t.sex === 'male' || t.sex === 'female'); if (t.gender === 'special') n++; }
  assert.ok(n > 100 && n < 230, `special ${n}`);
  const a = TR.generate(77), b = TR.generate(77); delete b.gender; TR.ensureGender(b);
  assert.deepEqual(a, b);                                   // 舊資料補上的結果和新產生的一樣
  let hit = 0;
  for (let s = 1; s <= 400; s++) {
    const w = world([(x) => mk(x, 'a', 'male'), (x) => mk(x, 'b', 'male')], { seed: s });
    w.q('a').traits.gender = 'special';
    w.R.onTogether('a', 'b'); if (w.R.relation('a', 'b').attracted) hit++;
  }
  assert.ok(hit / 400 > 0.3 && hit / 400 < 0.5, `special ${hit / 400}`);
  const w = couple({ rv: 0 }); w.q('f').traits.gender = 'special';
  w.now.days(1); w.R.onTogether('m', 'f');
  assert.ok(w.q('f').pregnancy);                            // 生理一公一母、愛情滿：照常
});
