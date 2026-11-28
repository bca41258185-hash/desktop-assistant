const test = require('node:test');
const assert = require('node:assert');
const M = require('../lib/machine');

test('效能等級：獨顯＋多核心＋16G 是 high；內顯筆電是 mid；舊機器、軟體繪圖是 low', () => {
  assert.strictEqual(M.classify({ cores: 20, memGB: 15.7, gpu: { vendor: 'nvidia', discrete: true } }), 'high');
  assert.strictEqual(M.classify({ cores: 16, memGB: 15.8, gpu: { vendor: 'intel' } }), 'mid');
  assert.strictEqual(M.classify({ cores: 8, memGB: 7.8, gpu: { vendor: 'intel' } }), 'mid');
  assert.strictEqual(M.classify({ cores: 4, memGB: 3.9, gpu: { vendor: 'intel' } }), 'low');
  assert.strictEqual(M.classify({ cores: 2, memGB: 16, gpu: { vendor: 'nvidia', discrete: true } }), 'low');
  assert.strictEqual(M.classify({ cores: 4, memGB: 8, gpu: { vendor: 'software' } }), 'low');
  assert.strictEqual(M.classify({}), 'low');
});
test('顯示卡：取目前在用的那張；讀不到當成不知道', () => {
  assert.deepStrictEqual(M.gpuOf({ gpuDevice: [{ vendorId: 0x8086, active: false }, { vendorId: 0x10de, active: true }] }), { vendor: 'nvidia', discrete: true });
  assert.deepStrictEqual(M.gpuOf({ gpuDevice: [{ vendorId: 0x8086, active: true }] }), { vendor: 'intel', discrete: false });
  assert.deepStrictEqual(M.gpuOf(null), { vendor: 'unknown', discrete: false });
});
test('上限只會往下壓，不會往上；降一級到 low 為止', () => {
  assert.strictEqual(M.capTier('high', 'mid'), 'mid');
  assert.strictEqual(M.capTier('mid', 'high'), 'mid');
  assert.strictEqual(M.capTier('high', null), 'high');
  assert.strictEqual(M.lower('high'), 'mid');
  assert.strictEqual(M.lower('low'), 'low');
});
