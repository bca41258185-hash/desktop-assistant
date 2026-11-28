const { test } = require('node:test');
const assert = require('node:assert/strict');
const { targetFps, createPerfSender } = require('../lib/perf');

test('目標幀率：預設 60；手動開省電或用電池 30', () => {
  assert.equal(targetFps({}), 60);
  assert.equal(targetFps({ saver: true }), 30);
  assert.equal(targetFps({ onBattery: true }), 30);
  assert.equal(targetFps({ saver: true, onBattery: true }), 30);
});

test('stage:perf 只在值變化時送；舞台載入好（force）一定補送；查電池出錯當成插電', () => {
  let saver = false, batt = false; const sent = [];
  const p = createPerfSender({ getSaver: () => saver, isOnBattery: () => { if (batt === 'boom') throw new Error('x'); return batt; }, send: (x) => sent.push(x.fps) });
  p.update(true); p.update(); assert.deepEqual(sent, [60]);
  batt = true; p.update(); assert.deepEqual(sent, [60, 30]);           // 拔掉電源（on-battery）
  saver = true; p.update(); assert.deepEqual(sent, [60, 30]);          // 仍是 30：不重送
  batt = false; p.update(); assert.deepEqual(sent, [60, 30]);          // 插電但省電開著
  saver = false; p.update(); assert.deepEqual(sent, [60, 30, 60]);
  p.update(true); assert.deepEqual(sent, [60, 30, 60, 60]);
  batt = 'boom'; assert.equal(p.current(), 60);
});
