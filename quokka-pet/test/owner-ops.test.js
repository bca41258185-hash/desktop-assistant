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
