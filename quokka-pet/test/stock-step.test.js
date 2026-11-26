const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepTracker } = require('../lib/stock-step');

test('每天第一筆只當基準、不反應', () => {
  const t = createStepTracker({ now: () => 0 });
  assert.equal(t.update('2330', { pct: -3.6, day: 'd1' }), null);
});
test('跨過 1% 才反應，方向正確', () => {
  let now = 0; const t = createStepTracker({ now: () => now });
  t.update('2454', { pct: 0.4, day: 'd1' });
  assert.equal(t.update('2454', { pct: 0.9, day: 'd1' }), null);
  now = 100000;
  assert.deepEqual(t.update('2454', { pct: 1.2, day: 'd1' }), { dir: 'up', step: 1, pct: 1.2, limit: null });
  now = 200000;
  assert.equal(t.update('2454', { pct: 1.8, day: 'd1' }), null);
  assert.equal(t.update('2454', { pct: 0.5, day: 'd1' }).dir, 'down');
});
test('60 秒冷卻：同級來回不反應，跨到更大步數照樣反應', () => {
  let now = 0; const t = createStepTracker({ now: () => now });
  t.update('x', { pct: 0, day: 'd' });
  now = 61000; assert.ok(t.update('x', { pct: 1.1, day: 'd' }));
  now = 70000; assert.equal(t.update('x', { pct: 0.9, day: 'd' }), null);   // 冷卻中回落
  now = 75000; assert.equal(t.update('x', { pct: 1.2, day: 'd' }), null);   // 冷卻中回到同級
  now = 80000; assert.ok(t.update('x', { pct: 2.1, day: 'd' }));            // 更大：照樣反應
});
test('跨日歸零', () => {
  let now = 0; const t = createStepTracker({ now: () => now });
  t.update('x', { pct: 3.2, day: 'd1' });
  now = 1e6; assert.equal(t.update('x', { pct: 0.2, day: 'd2' }), null);    // 新的一天：基準
  now = 2e6; assert.equal(t.update('x', { pct: 1.3, day: 'd2' }).dir, 'up');
});
test('台股漲停、跌停', () => {
  let now = 0; const t = createStepTracker({ now: () => now });
  t.update('t', { pct: 8.6, day: 'd', market: 'tw' });
  now = 1e5; assert.equal(t.update('t', { pct: 9.96, day: 'd', market: 'tw' }).limit, 'up');
  const u = createStepTracker({ now: () => now });
  u.update('u', { pct: -8, day: 'd', market: 'tw' });
  now = 2e5; assert.equal(u.update('u', { pct: -9.9, day: 'd', market: 'tw' }).limit, 'down');
  const us = createStepTracker({ now: () => now });
  us.update('a', { pct: 8, day: 'd', market: 'us' });
  now = 3e5; assert.equal(us.update('a', { pct: 10.5, day: 'd', market: 'us' }).limit, null);  // 美股沒有漲跌停
});

test('pct 為 null／undefined／字串時不反應（isFinite(null) 的陷阱）', () => {
  let now = 0; const t = createStepTracker({ now: () => now });
  t.update('x', { pct: 1.5, day: 'd' });
  now = 1e6;
  for (const pct of [null, undefined, '0', '', NaN, Infinity]) assert.equal(t.update('x', { pct, day: 'd' }), null);
  assert.equal(t._state.get('x').step, 1);                       // 狀態沒被 null 改成 0
  // 第一筆就是 null：不建立基準
  assert.equal(t.update('y', { pct: null, day: 'd' }), null);
  assert.equal(t._state.has('y'), false);
});
test('遲滯：1.01 歡呼後 0.99 不算跨回，要回落超過 0.2 個百分點', () => {
  let now = 0; const t = createStepTracker({ now: () => now });
  t.update('x', { pct: 0.5, day: 'd' });
  now = 100000; assert.equal(t.update('x', { pct: 1.01, day: 'd' }).dir, 'up');
  now = 105000; assert.equal(t.update('x', { pct: 0.99, day: 'd' }), null);
  now = 200000; assert.equal(t.update('x', { pct: 0.9, day: 'd' }), null);    // 冷卻過了，但還在遲滯範圍內：仍算 1 級，不用更正
  now = 300000; assert.equal(t.update('x', { pct: 1.01, day: 'd' }), null);
  now = 400000; assert.equal(t.update('x', { pct: 0.79, day: 'd' }).dir, 'down');   // 回落超過 0.2：跨回
});
test('在 0.99／1.01 之間每 61 秒來回不會一直反應', () => {
  let now = 0; const t = createStepTracker({ now: () => now });
  t.update('x', { pct: 0.5, day: 'd' });
  let n = 0;
  for (let i = 0; i < 20; i++) { now += 61000; if (t.update('x', { pct: i % 2 ? 0.99 : 1.01, day: 'd' })) n++; }
  assert.equal(n, 1);                                            // 只有第一次跨過 1% 反應
});
test('冷卻中被吞掉的反向變動：冷卻結束時級距和上次報的不同，補報一次', () => {
  let now = 0; const t = createStepTracker({ now: () => now });
  t.update('x', { pct: 0.5, day: 'd' });
  now = 100000; assert.equal(t.update('x', { pct: 1.2, day: 'd' }).dir, 'up');
  now = 105000; assert.equal(t.update('x', { pct: 0.4, day: 'd' }), null);    // 冷卻中跌回：先不講
  now = 150000; assert.equal(t.update('x', { pct: 0.4, day: 'd' }), null);    // 還在冷卻
  now = 161000; const r = t.update('x', { pct: 0.4, day: 'd' });            // 冷卻結束：補報
  assert.equal(r.dir, 'down'); assert.equal(r.step, 0);
  now = 300000; assert.equal(t.update('x', { pct: 0.4, day: 'd' }), null);    // 只補一次
});
test('冷卻中漲上去又回到原級：冷卻結束後不補報', () => {
  let now = 0; const t = createStepTracker({ now: () => now });
  t.update('x', { pct: 1.5, day: 'd' });
  now = 100000; assert.equal(t.update('x', { pct: 0.5, day: 'd' }).dir, 'down');
  now = 105000; assert.equal(t.update('x', { pct: 1.3, day: 'd' }), null);    // 冷卻中回到 1 級（不是更大）
  now = 110000; assert.equal(t.update('x', { pct: 0.6, day: 'd' }), null);    // 又跌回 0 級
  now = 200000; assert.equal(t.update('x', { pct: 0.6, day: 'd' }), null);    // 和上次報的同級：不補
});
test('跌的一邊也有遲滯', () => {
  let now = 0; const t = createStepTracker({ now: () => now });
  t.update('x', { pct: -0.5, day: 'd' });
  now = 100000; assert.equal(t.update('x', { pct: -1.05, day: 'd' }).dir, 'down');
  now = 200000; assert.equal(t.update('x', { pct: -0.95, day: 'd' }), null);
  now = 300000; assert.equal(t.update('x', { pct: -0.7, day: 'd' }).dir, 'up');
  now = 400000; assert.equal(t.update('x', { pct: 1.1, day: 'd' }).dir, 'up');   // 直接跨到另一邊
});
