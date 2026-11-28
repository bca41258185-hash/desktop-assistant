const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transferProblem } = require('../lib/owner-ops');

const KINDS = { task: 'tasks', reminder: 'reminders', stock: 'stocks', folder: 'folders' };
const LIM = { task: 50, reminder: 30, stock: 20, folder: 50 };
const tasks = (owner, n, done = false) => Array.from({ length: n }, (_, i) => ({ id: owner + i, owner, done }));

test('刪除時轉給新主人：超過每隻 50 件待辦就擋下並說明', () => {
  const data = { tasks: [...tasks('a', 10), ...tasks('b', 45)], reminders: [], stocks: [], folders: [] };
  assert.match(transferProblem(data, 'a', 'b', { LIM, kinds: KINDS }), /手上的待辦會變成 55 件，超過上限 50 件/);
  assert.equal(transferProblem(data, 'a', 'c', { LIM, kinds: KINDS }), null);
  // 剛好 50 可以
  const ok = { tasks: [...tasks('a', 5), ...tasks('b', 45)], reminders: [], stocks: [], folders: [] };
  assert.equal(transferProblem(ok, 'a', 'b', { LIM, kinds: KINDS }), null);
});
test('不佔名額的（已完成的待辦）不算；其他種類也檢查', () => {
  const counts = (kind, x) => !(kind === 'task' && x.done);
  const data = { tasks: [...tasks('a', 10, true), ...tasks('b', 45)], reminders: [], stocks: [], folders: [] };
  assert.equal(transferProblem(data, 'a', 'b', { LIM, kinds: KINDS, counts }), null);
  const st = { tasks: [], reminders: [], stocks: Array.from({ length: 21 }, (_, i) => ({ owner: i < 3 ? 'a' : 'b' })), folders: [] };
  assert.match(transferProblem(st, 'a', 'b', { LIM, kinds: KINDS }), /股票會變成 21 件，超過上限 20 件/);
});

test('股票轉移要去重：兩隻都盯 2330 只留一筆；數量上限用去重後的數字算', () => {
  const { transferDupes } = require('../lib/owner-ops');
  const keyOf = { stock: (x) => x.symbol };
  const sym = (owner, list) => list.map((s, i) => ({ id: owner + i, owner, symbol: s }));
  // b 已經盯 18 檔（含 2330、2317），a 有 2330、2317、0050、0050（自己重複）→ 去重後只多 1 檔 → 19，不超過 20
  const bList = ['2330', '2317', ...Array.from({ length: 16 }, (_, i) => 'B' + i)];
  const data = { tasks: [], reminders: [], folders: [], stocks: [...sym('b', bList), ...sym('a', ['2330', '2317', '0050', '0050'])] };
  const drop = transferDupes(data, 'a', 'b', { kinds: KINDS, keyOf });
  assert.deepEqual(drop.map((d) => d.item.id).sort(), ['a0', 'a1', 'a3']);
  assert.equal(transferProblem(data, 'a', 'b', { LIM, kinds: KINDS, keyOf }), null);
  assert.match(transferProblem(data, 'a', 'b', { LIM, kinds: KINDS }), /股票會變成 22 件/);   // 沒去重時（修正前）會誤擋
  // 去重後仍超過才擋
  const full = { tasks: [], reminders: [], folders: [], stocks: [...sym('b', Array.from({ length: 20 }, (_, i) => 'B' + i)), ...sym('a', ['B0', 'X'])] };
  assert.match(transferProblem(full, 'a', 'b', { LIM, kinds: KINDS, keyOf }), /股票會變成 21 件/);
});
