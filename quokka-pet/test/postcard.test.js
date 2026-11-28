// 放生後的明信片（lib/postcard.js）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plan, compose, recipient, MIN } = require('../lib/postcard');

const names = { b: '小麥', c: '團團', d: '阿呆', e: '路人' };
const nameOf = (id) => names[id] || null;
const T = new Date(2026, 10, 27, 12).getTime();
let s = 3; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };

test('伴侶是愛人；友情高的前三個是朋友；約 10 分鐘（8–12 分）後寄到', () => {
  const card = plan({ from: { id: 'a', name: '阿跳' }, nameOf, now: T, rnd, relations: [
    { other: 'b', affinity: 70, love: 100, couple: true, attracted: true },
    { other: 'c', affinity: 85, friend: true }, { other: 'd', affinity: 40 }, { other: 'e', affinity: 5 }, { other: 'gone', affinity: 99 }] });
  assert.deepEqual(card.lover, { id: 'b', name: '小麥', partner: true });
  assert.deepEqual(card.friends.map((f) => f.name), ['團團', '阿呆']);    // 路人太不熟、不在的不算
  assert.ok(card.dueAt - T >= 8 * MIN && card.dueAt - T <= 12 * MIN);
  for (let i = 0; i < 30; i++) {
    const text = compose(card, { rnd });
    assert.ok(text.includes('小麥') && text.includes('團團') && text.includes('阿呆'), text);
    assert.ok(text.includes('阿跳'));
  }
});

test('沒有伴侶：愛情最高（≥ 20）的那隻是偷偷喜歡的人，信裡會告白', () => {
  const card = plan({ from: { id: 'a', name: '阿跳' }, nameOf, now: T, rnd, relations: [
    { other: 'b', affinity: 30, love: 45, attracted: true }, { other: 'c', affinity: 60, love: 0, attracted: false }] });
  assert.deepEqual(card.lover, { id: 'b', name: '小麥', partner: false });
  assert.deepEqual(card.friends.map((f) => f.name), ['團團']);
  const t = compose(card, { rnd });
  assert.ok(t.startsWith('親愛的小麥') && t.includes('團團'), t);
});

test('沒有愛人也沒有朋友：寫給大家；寄給誰的順序', () => {
  const card = plan({ from: { id: 'a', name: '阿跳' }, nameOf, now: T, rnd, relations: [] });
  assert.equal(card.lover, null);
  assert.ok(compose(card, { rnd }).startsWith('親愛的大家'));
  const c2 = { lover: { id: 'b' }, friends: [{ id: 'c' }, { id: 'd' }] };
  assert.equal(recipient(c2, () => true, 'x'), 'b');
  assert.equal(recipient(c2, (id) => id !== 'b', 'x'), 'c');
  assert.equal(recipient(c2, () => false, 'x'), 'x');
});

test('漫畫場景：每張不太一樣；落腳的地方和信裡寫的一致；個性影響玩什麼', () => {
  const { scene, PLACES } = require('../lib/postcard');
  const base = (arch) => ({ from: { id: 'a', name: '阿跳', traits: { personality: { archetype: arch } } }, lover: { id: 'b', name: '小麥', partner: true }, friends: [] });
  const seen = new Set(), plays = { athlete: 0 };
  for (let i = 0; i < 60; i++) {
    const c = base(i % 2 ? 'athlete' : 'easy'); c.scene = scene(c, { rnd });
    seen.add(JSON.stringify([c.scene.place, c.scene.play, c.scene.mood, c.scene.send]));
    if (i % 2 && c.scene.play === 'ball') plays.athlete++;
    assert.ok(compose(c, { rnd }).includes(PLACES[c.scene.place]));
  }
  assert.ok(seen.size > 20, `組合 ${seen.size}`);
  assert.ok(plays.athlete > 18, `愛運動的打球 ${plays.athlete}/30`);
});
