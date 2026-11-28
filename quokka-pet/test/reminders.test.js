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

// ---- 錯過標記（missedAt） ----
test('錯過的提醒寫入 missedAt；按「知道了」清掉；下次正常響起也清掉', () => {
  const r = rem({ type: 'daily', time: '08:00' }, { lastFiredAt: T(24, 8, 0).toISOString() });
  const d = R.dueNow(r, T(25, 13, 0));
  assert.ok(d.missed);
  R.markFired(r, T(25, 13, 0), { missed: true });
  assert.equal(r.missedAt, T(25, 13, 0).toISOString());
  assert.equal(R.ackMissed(r), true);
  assert.equal(r.missedAt, undefined);
  assert.equal(R.ackMissed(r), false);
  R.markFired(r, T(25, 13, 0), { missed: true });
  assert.ok(R.dueNow(r, T(26, 8, 0)));
  R.markFired(r, T(26, 8, 0));                                   // 正常響起
  assert.equal(r.missedAt, undefined);
});

// ---- 壞資料 ----
test('壞資料一律跳過，不丟例外', () => {
  const bad = [
    rem({ type: 'once' }), rem({ type: 'once', time: '10:00' }), rem({ type: 'once', date: '2026-02-31', time: '10:00' }),
    rem({ type: 'weekly', time: '09:00' }), rem({ type: 'weekly', weekdays: [], time: '09:00' }), rem({ type: 'weekly', weekdays: [9], time: '09:00' }),
    rem({ type: 'daily', time: '25:99' }), rem({ type: 'daily', time: '24:00' }), rem({ type: 'daily' }), rem({ type: 'daily', time: 900 }),
    rem({ type: 'yearly', time: '09:00' }), rem(null), rem('daily'), null, 'x', 42, { enabled: true, rule: { type: 'daily', time: '09:00' }, lastFiredAt: 'garbage', createdAt: 'garbage' }
  ];
  for (const r of bad.slice(0, -1)) {
    assert.doesNotThrow(() => R.dueNow(r, T(25, 12, 0)));
    assert.equal(R.dueNow(r, T(25, 12, 0)), null);
    assert.doesNotThrow(() => R.nextOccurrence(r && r.rule, T(25, 12, 0)));
  }
  assert.doesNotThrow(() => R.nextWake(bad, T(25, 12, 0)));
  // 壞的 lastFiredAt／createdAt 當作沒有：照常響
  assert.ok(R.dueNow(bad[bad.length - 1], T(25, 9, 0)));
  assert.equal(R.isValidRule({ type: 'daily', time: '25:99' }), false);
  assert.equal(R.isValidRule({ type: 'daily', time: '23:59' }), true);
  assert.equal(R.nextOccurrence({ type: 'daily', time: '25:99' }, T(25, 12, 0)), null);   // 不會被當成隔天 02:39
  assert.doesNotThrow(() => R.markFired(null, T(25, 12, 0)));
  assert.doesNotThrow(() => R.markFired({ text: 'no rule' }, T(25, 12, 0)));
});
test('排程器：單筆壞資料不會讓整個排程停掉，好的照樣響', () => {
  let clock = T(25, 15, 0), pending = null; const fired = [];
  const list = [rem({ type: 'once' }, { id: 'bad1' }), rem({ type: 'weekly', time: '15:30' }, { id: 'bad2' }), null,
    rem({ type: 'daily', time: '15:30' }, { id: 'ok', lastFiredAt: T(24, 15, 30).toISOString() })];
  const s = R.createScheduler({ getReminders: () => list, now: () => clock, onFire: (due) => { fired.push(...due.map((d) => d.rem.id)); due.forEach((d) => R.markFired(d.rem, clock)); },
    setTimer: (fn, ms) => (pending = { fn, ms }), clearTimer: () => {}, setTick: null });
  const w = s.schedule();
  assert.equal(w.getHours() * 60 + w.getMinutes(), 15 * 60 + 30);
  clock = T(25, 15, 30); pending.fn();
  assert.deepEqual(fired, ['ok']);
  assert.ok(pending);
});
test('排程器：onFire 丟例外也會繼續排下一個', () => {
  let clock = T(25, 15, 30), pending = null;
  const list = [rem({ type: 'daily', time: '15:30' }, { lastFiredAt: T(24, 15, 30).toISOString() })];
  const err = console.error; console.error = () => {};
  try {
    const s = R.createScheduler({ getReminders: () => list, now: () => clock, onFire: () => { throw new Error('boom'); }, setTimer: (fn, ms) => (pending = { fn, ms }), clearTimer: () => {}, setTick: null });
    assert.doesNotThrow(() => s.check());
    assert.ok(pending && pending.ms > 0);
  } finally { console.error = err; }
});

// ---- 時鐘跳動檢查 ----
test('每 60 秒檢查時鐘跳動：系統時間被改就重新排程，正常經過不動作', () => {
  let wall = T(25, 12, 0).getTime(), mono = 0, ticks = null, timers = 0;
  const list = [rem({ type: 'daily', time: '18:00' }, { lastFiredAt: T(24, 18, 0).toISOString() })];
  const s = R.createScheduler({ getReminders: () => list, now: () => new Date(wall), mono: () => mono, onFire: () => {},
    setTimer: () => ++timers, clearTimer: () => {}, setTick: (fn, ms) => { ticks = { fn, ms }; return 1; }, clearTick: () => {} });
  s.schedule();
  assert.equal(ticks.ms, 60000);
  const before = timers;
  wall += 60000; mono += 60000;
  assert.equal(s.tick(), false);                                 // 正常經過 60 秒
  assert.equal(timers, before);
  wall += 60000 + 3 * 3600000; mono += 60000;                    // 使用者把時鐘往後調 3 小時
  assert.equal(s.tick(), true);
  assert.equal(timers, before + 1);                              // 重新排程
  wall -= 2 * 3600000; mono += 60000;                            // 往回調
  assert.equal(s.tick(), true);
});
test('時區改變也重新排程', () => {
  let tz = -480, wall = T(25, 12, 0).getTime(), mono = 0, n = 0;
  const now = () => { const d = new Date(wall); d.getTimezoneOffset = () => tz; return d; };
  const s = R.createScheduler({ getReminders: () => [], now, mono: () => mono, onFire: () => {}, setTimer: () => ++n, clearTimer: () => {}, setTick: () => 1, clearTick: () => {} });
  s.schedule();
  wall += 60000; mono += 60000;
  assert.equal(s.tick(), false);
  tz = 0; wall += 60000; mono += 60000;
  assert.equal(s.tick(), true);
});

// ---- 系統通知合併 ----
test('系統通知 2 秒內多筆合併成一則「3 則提醒：A、B、C」', () => {
  const sent = []; let pending = null;
  const b = R.createNotifyBatcher({ send: (m) => sent.push(m), setTimer: (fn, ms) => (pending = { fn, ms }), clearTimer: () => (pending = null) });
  b.push({ title: '庫卡', body: '⏰ A', label: 'A', qid: 'q1' });
  b.push({ title: '小花', body: '⏰ B', label: 'B', qid: 'q2' });
  b.push({ title: '庫卡', body: '⏰ C', label: 'C', qid: 'q1' });
  assert.equal(sent.length, 0);
  assert.equal(pending.ms, 2000);
  pending.fn();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body, '3 則提醒：A、B、C');
  assert.equal(sent[0].title, '庫卡助理');
  assert.equal(sent[0].qid, null);
  b.push({ title: '庫卡', body: '⏰ D', label: 'D', qid: 'q1' });     // 只有一筆：原樣送出
  pending.fn();
  assert.deepEqual(sent[1], { title: '庫卡', body: '⏰ D', qid: 'q1' });
});

// ---- 離開期間的報告 ----
test('離開期間的報告：錯過與提醒類一律保留且排最前面，其他類滿了合併成「…還有 N 則」', () => {
  let d;
  for (let i = 0; i < 10; i++) d = R.digestPush(d, 'stock', `股票${i}`);
  d = R.digestPush(d, 'missed', '錯過的提醒：開會');
  d = R.digestPush(d, 'missed', '錯過的提醒：喝水');
  const out = R.digestTexts(d);
  assert.equal(out.length, 8);
  assert.equal(out[0], '錯過的提醒：開會');
  assert.equal(out[1], '錯過的提醒：喝水');
  assert.deepEqual(out.slice(2, 7), ['股票0', '股票1', '股票2', '股票3', '股票4']);
  assert.equal(out[7], '…還有 5 則');
  // 沒滿：全部列出，不加「還有」
  let e = R.digestPush(undefined, 'task-done', 'A');
  e = R.digestPush(e, 'missed', 'M');
  assert.deepEqual(R.digestTexts(e), ['M', 'A']);
  // 剛好 8 則：不合併
  let f; for (let i = 0; i < 8; i++) f = R.digestPush(f, 'folder', String(i));
  assert.equal(R.digestTexts(f).length, 8);
  assert.ok(!R.digestTexts(f).some((t) => t.includes('還有')));
  // 錯過的很多：全部保留
  let g; for (let i = 0; i < 12; i++) g = R.digestPush(g, 'missed', 'm' + i);
  g = R.digestPush(g, 'stock', 's');
  const go = R.digestTexts(g);
  assert.equal(go.filter((t) => t.startsWith('m')).length, 12);
  assert.equal(go[12], '…還有 1 則');
});

test('停用的每天／每週提醒過了時間才重新打開：停用期間的時段不算錯過，下一次照常響', () => {
  const { reenable, dueNow, nextWake } = require('../lib/reminders');
  const now = new Date(2026, 10, 26, 12, 0);
  for (const rule of [{ type: 'daily', time: '09:00' }, { type: 'weekly', weekdays: [now.getDay()], time: '09:00' }]) {
    const rem = { id: 'r', rule, enabled: false, createdAt: new Date(2026, 10, 1).toISOString(), lastFiredAt: new Date(2026, 10, 25, 9, 0).toISOString() };
    assert.ok(dueNow({ ...rem, enabled: true }, now).missed, '沒有基準時間時會被當成錯過（修正前的行為）');
    const r = reenable(rem, now);
    assert.equal(r.moved, false); assert.equal(rem.enabled, true); assert.equal(rem.enabledAt, now.toISOString());
    assert.equal(dueNow(rem, now), null);
    assert.equal(dueNow(rem, new Date(2026, 10, 26, 18, 0)), null);           // 之後的檢查也不會補報
    if (rule.type === 'daily') {
      assert.equal(nextWake([rem], now).getTime(), new Date(2026, 10, 27, 9, 0).getTime());
      const d = dueNow(rem, new Date(2026, 10, 27, 9, 0, 30));
      assert.ok(d && !d.missed);                                              // 明天照常響
    }
  }
});

test('重新開啟還沒到的一次性提醒：不改時間', () => {
  const { reenable } = require('../lib/reminders');
  const now = new Date(2026, 10, 26, 12, 0);
  const rem = { rule: { type: 'once', date: '2026-11-27', time: '10:00' }, enabled: false };
  assert.deepEqual(reenable(rem, now), { moved: false });
  assert.equal(rem.rule.date, '2026-11-27'); assert.equal(rem.enabled, true);
});

test('重新開啟響過的一次性提醒：改到下一次同一時間（今天還沒到就今天，否則明天），而且真的會響', () => {
  const { reenable, dueNow, nextWake, markFired } = require('../lib/reminders');
  const now = new Date(2026, 10, 26, 12, 0);
  const rem = { rule: { type: 'once', date: '2026-11-20', time: '09:00', at: new Date(2026, 10, 20, 9).toISOString() }, enabled: false, lastFiredAt: new Date(2026, 10, 20, 9).toISOString() };
  const r = reenable(rem, now);
  assert.deepEqual(r, { moved: true, date: '2026-11-27', time: '09:00', tomorrow: true });
  assert.equal(rem.rule.at, new Date(2026, 10, 27, 9).toISOString());
  assert.equal(dueNow(rem, now), null);
  assert.equal(nextWake([rem], now).getTime(), new Date(2026, 10, 27, 9).getTime());
  const d = dueNow(rem, new Date(2026, 10, 27, 9, 0, 10));
  assert.ok(d && !d.missed);
  markFired(rem, new Date(2026, 10, 27, 9, 0, 10)); assert.equal(rem.enabled, false);
  // 今天稍晚的時間：改到今天
  const later = { rule: { type: 'once', date: '2026-11-25', time: '15:30' }, enabled: false, lastFiredAt: new Date(2026, 10, 25, 15, 30).toISOString() };
  assert.deepEqual(reenable(later, now), { moved: true, date: '2026-11-26', time: '15:30', tomorrow: false });
});
