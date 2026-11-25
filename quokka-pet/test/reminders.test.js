const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/reminders');
const T = (d, h, m) => new Date(2026, 10, d, h, m);            // 2026-11-d h:m（11/25 週三）
const rem = (rule, extra = {}) => ({ id: 'r', text: 'x', rule, enabled: true, createdAt: T(20, 0, 0).toISOString(), ...extra });

test('一次性：時間到才響，響過停用', () => {
  const r = rem({ type: 'once', date: '2026-11-25', time: '15:30' });
  assert.equal(R.dueNow(r, T(25, 15, 29)), null);
  const d = R.dueNow(r, T(25, 15, 30));
  assert.ok(d && !d.missed);
  R.markFired(r, T(25, 15, 30));
  assert.equal(r.enabled, false);
  assert.equal(R.dueNow(r, T(25, 15, 31)), null);
});
test('每天：每天同一時間，同一天不重響', () => {
  const r = rem({ type: 'daily', time: '17:00' });
  assert.ok(R.dueNow(r, T(25, 17, 0)));
  R.markFired(r, T(25, 17, 0));
  assert.equal(R.dueNow(r, T(25, 23, 0)), null);
  assert.ok(R.dueNow(r, T(26, 17, 0)));
  assert.equal(r.enabled, true);
});
test('每週：只在指定的星期幾', () => {
  const r = rem({ type: 'weekly', weekdays: [1], time: '09:00' }, { lastFiredAt: T(23, 9, 0).toISOString() });   // 週一；上週一已響過
  assert.equal(R.nextOccurrence(r.rule, T(25, 10, 0)).getDate(), 30);  // 11/30 是週一
  assert.equal(R.dueNow(r, T(26, 9, 0)), null);
  assert.ok(R.dueNow(r, T(30, 9, 0)));
});
test('錯過超過 2 分鐘標成錯過、只報一次', () => {
  const r = rem({ type: 'daily', time: '08:00' });
  r.lastFiredAt = T(24, 8, 0).toISOString();
  const d = R.dueNow(r, T(25, 13, 0));                          // 早上電腦沒開，下午才開
  assert.ok(d && d.missed);
  R.markFired(r, T(25, 13, 0));
  assert.equal(R.dueNow(r, T(25, 13, 1)), null);
});
test('建立之前的時間不算錯過', () => {
  const r = rem({ type: 'daily', time: '08:00' }, { createdAt: T(25, 10, 0).toISOString() });
  assert.equal(R.dueNow(r, T(25, 10, 1)), null);                // 今天 08:00 在建立之前
  assert.ok(R.dueNow(r, T(26, 8, 0)));
});
test('貪睡 5 分鐘：一次性提醒響過後再響一次', () => {
  const r = rem({ type: 'once', date: '2026-11-25', time: '15:30' });
  R.markFired(r, T(25, 15, 30));
  R.snooze(r, 5, T(25, 15, 30));
  assert.equal(r.enabled, true);
  assert.equal(R.dueNow(r, T(25, 15, 34)), null);
  assert.ok(R.dueNow(r, T(25, 15, 35)));
  R.markFired(r, T(25, 15, 35));
  assert.equal(r.enabled, false);
});
test('排程器：只設一個計時器，醒來時一次交出所有該響的', () => {
  let clock = T(25, 15, 0), pending = null, fired = [];
  const list = [rem({ type: 'once', date: '2026-11-25', time: '15:30' }, { id: 'a' }), rem({ type: 'daily', time: '15:30' }, { id: 'b', lastFiredAt: T(24, 15, 30).toISOString() }), rem({ type: 'daily', time: '18:00' }, { id: 'c', lastFiredAt: T(24, 18, 0).toISOString() })];
  const s = R.createScheduler({
    getReminders: () => list, now: () => clock,
    onFire: (due) => { fired.push(due.map((d) => d.rem.id).join(',')); due.forEach((d) => R.markFired(d.rem, clock)); },
    setTimer: (fn, ms) => (pending = { fn, ms }), clearTimer: () => (pending = null)
  });
  const w = s.schedule();
  assert.equal(w.getHours() * 60 + w.getMinutes(), 15 * 60 + 30);
  assert.ok(pending.ms >= 30 * 60000 && pending.ms < 30 * 60000 + 1000);   // 30 分鐘後才醒來，中間不輪詢
  clock = T(25, 15, 30); pending.fn();
  assert.deepEqual(fired, ['a,b']);
  assert.ok(pending.ms >= 2.5 * 3600000);                       // 下一個是 18:00
});
test('沒有提醒時最多睡 6 小時就醒來重算', () => {
  let pending = null;
  const s = R.createScheduler({ getReminders: () => [], onFire: () => {}, now: () => T(25, 12, 0), setTimer: (fn, ms) => (pending = { ms }), clearTimer: () => {} });
  s.schedule();
  assert.equal(pending.ms, 6 * 3600000);
});
test('從沒響過、中間錯過的那一次會被報成「錯過」（合併一次）', () => {
  const r = rem({ type: 'daily', time: '18:00' });                // 11/20 建立後程式都沒開
  const d = R.dueNow(r, T(25, 15, 0));
  assert.ok(d && d.missed);
  assert.equal(d.at.getDate(), 24);                               // 只報最近的那一次（昨天 18:00）
});
