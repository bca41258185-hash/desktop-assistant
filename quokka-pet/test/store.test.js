const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { migrate, createStore } = require('../lib/store');

const V1 = { folders: ['/a', '/b'], tasks: [{ id: '1', text: '回信', done: false }, { id: '2', text: '畫圖', done: true }],
  settings: { provider: 'openai', apiKey: 'sk-secret', model: 'x', reminderIntervalMinutes: 30, awayMinutes: 7, quokkaTraits: { v: 1, sex: 'male' } } };

test('v1 → v2：原本那隻變 q1，任務與資料夾歸牠，聊天設定拿掉', () => {
  const d = migrate(V1);
  assert.equal(d.version, 2);
  assert.equal(d.quokkas.length, 1);
  assert.equal(d.quokkas[0].name, '庫卡');
  assert.deepEqual(d.quokkas[0].traits, { v: 1, sex: 'male' });
  assert.deepEqual(d.tasks.map((t) => [t.owner, t.text, t.done]), [['q1', '回信', false], ['q1', '畫圖', true]]);
  assert.deepEqual(d.folders.map((f) => [f.owner, f.path]), [['q1', '/a'], ['q1', '/b']]);
  assert.equal(d.settings.awayMinutes, 7);
  assert.ok(!JSON.stringify(d).includes('sk-secret'));
  assert.ok(!('reminderIntervalMinutes' in d.settings));
});
test('v2 原樣保留，缺的設定補預設值', () => {
  const d = migrate({ version: 2, quokkas: [{ id: 'q1' }], tasks: [], reminders: [], stocks: [], folders: [], settings: { stockStepPct: 2 } });
  assert.equal(d.settings.stockStepPct, 2);
  assert.equal(d.settings.romance, true);
});
test('讀檔：v1 先備份再遷移；寫檔用暫存檔改名（不留 .tmp）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qk-')), f = path.join(dir, 'config.json');
  fs.writeFileSync(f, JSON.stringify(V1));
  const s = createStore(f); s.load();
  assert.ok(fs.existsSync(path.join(dir, 'config.v1.bak.json')));
  assert.equal(JSON.parse(fs.readFileSync(f)).version, 2);
  s.data.tasks.push({ id: 'x', owner: 'q1', text: '新的' }); s.saveNow();
  assert.ok(!fs.existsSync(f + '.tmp'));
  assert.equal(JSON.parse(fs.readFileSync(f)).tasks.length, 3);
});
test('壞掉的設定檔不會讓程式掛掉', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qk-')), f = path.join(dir, 'config.json');
  fs.writeFileSync(f, '{壞掉');
  const s = createStore(f); const d = s.load();
  assert.equal(d.version, 2);
  assert.deepEqual(d.quokkas, []);
});

test('壞掉的設定檔會先備份，不會被預設值蓋掉', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { createStore } = require('../lib/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qk-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, '{"version":2,"tasks":[{"id":1');
  const s = createStore(file); s.load(); s.saveNow();
  const bak = fs.readdirSync(dir).find((n) => n.startsWith('config.corrupt-'));
  assert.ok(bak, '要留下備份');
  assert.equal(fs.readFileSync(path.join(dir, bak), 'utf-8'), '{"version":2,"tasks":[{"id":1');
});

test('比較新的版本不會被當成 v1 清空', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { createStore } = require('../lib/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qk-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ version: 3, reminders: [{ id: 'r1', owner: 'q1', text: 'x' }], quokkas: [{ id: 'q1', name: 'A' }] }));
  const d = createStore(file).load();
  assert.equal(d.reminders.length, 1);
  assert.equal(d.quokkas.length, 1);
});
