const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPosSaver } = require('../lib/pos-saver');

function fake() {
  let t = 1000000, id = 0; const timers = new Map();
  return {
    now: () => t, setTimer: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id; }, clearTimer: (i) => timers.delete(i), timers,
    advance(ms) { const end = t + ms; for (;;) { const n = [...timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!n) break; timers.delete(n[0]); t = n[1].at; n[1].fn(); } t = end; }
  };
}

test('位置沒變就不寫；有變的合併成最快 10 秒寫一次', () => {
  const c = fake(); let writes = 0;
  const ps = createPosSaver({ save: () => writes++, ...c });
  const q = { home: { x: 100, y: 700 } };
  assert.equal(ps.update(q, 100.2, 699.8), false);          // 四捨五入後一樣：不算變
  c.advance(30000); assert.equal(writes, 0);
  assert.equal(ps.update(q, 120, 700), true); assert.deepEqual(q.home, { x: 120, y: 700 });
  c.advance(0); assert.equal(writes, 1);                    // 很久沒寫了：馬上寫
  // 30 隻每秒回報一次：10 秒內只寫一次
  for (let i = 0; i < 30; i++) { ps.update(q, 200 + i, 700); c.advance(1000); }
  assert.ok(writes <= 1 + 4, `寫了 ${writes} 次`);           // 30 秒內最多 3–4 次（每 10 秒一次）
  assert.ok(writes >= 3);
});
test('結束前 flush 一定寫入；別的修改已整份寫入就不用再寫', () => {
  const c = fake(); let writes = 0;
  const ps = createPosSaver({ save: () => writes++, ...c });
  const q = {};
  ps.update(q, 1, 2); c.advance(0); assert.equal(writes, 1);
  ps.update(q, 3, 4); assert.equal(ps.pending, true);
  ps.flush(); assert.equal(writes, 2); assert.equal(ps.pending, false);
  ps.flush(); assert.equal(writes, 2);                       // 沒有待寫的就不寫
  ps.update(q, 5, 6); ps.markSaved(); c.advance(20000); assert.equal(writes, 2);
  assert.equal(ps.update(q, NaN, 1), false);
});
