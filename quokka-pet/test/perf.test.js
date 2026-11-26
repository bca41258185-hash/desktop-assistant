const { test } = require('node:test');
const assert = require('node:assert/strict');
const { targetFps, createPerfSender } = require('../lib/perf');

test('目標幀率只看省電設定：預設 60；手動開省電 30', () => {
  assert.equal(targetFps({}), 60);
  assert.equal(targetFps({ saver: false }), 60);
  assert.equal(targetFps({ saver: true }), 30);
});

test('stage:perf 只在值變化時送；舞台載入好（force）一定補送', () => {
  let saver = false; const sent = [];
  const p = createPerfSender({ getSaver: () => saver, send: (x) => sent.push(x.fps) });
  p.update(true); p.update(); assert.deepEqual(sent, [60]);
  saver = true; p.update(); p.update(); assert.deepEqual(sent, [60, 30]);
  saver = false; p.update(); assert.deepEqual(sent, [60, 30, 60]);
  p.update(true); assert.deepEqual(sent, [60, 30, 60, 60]);
});
