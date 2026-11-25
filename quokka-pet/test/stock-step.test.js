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
