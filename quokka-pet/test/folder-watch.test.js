const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('events');
const { createFolderWatch } = require('../lib/folder-watch');

// 假的 chokidar、檔案系統、計時器
function setup(folders, dirs) {
  let t = 0, id = 0; const timers = new Map(), repeats = new Map();
  const exists = new Set(dirs);
  const watchers = [];
  const chokidar = { watch: (p, opt) => { const w = new EventEmitter(); w.path = p; w.opt = opt; w.closed = false; w.close = () => { w.closed = true; return Promise.resolve(); }; watchers.push(w); return w; } };
  const fs = { statSync: (p) => { if (!exists.has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return { isDirectory: () => true }; } };
  const changes = [], statuses = [];
  const fw = createFolderWatch({
    chokidar, fs, path, getFolders: () => folders,
    onChanges: (f, c) => changes.push({ id: f.id, ...c }), onStatus: (f, s, prev) => statuses.push([f.id, s, prev]),
    setTimer: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id; }, clearTimer: (i) => timers.delete(i),
    setRepeat: (fn, ms) => { repeats.set(++id, { fn, ms }); return id; }, clearRepeat: (i) => repeats.delete(i), now: () => t
  });
  const advance = (ms) => { const end = t + ms; for (;;) { const n = [...timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!n) break; timers.delete(n[0]); t = n[1].at; n[1].fn(); } t = end; };
  const tick5min = () => { t += 300000; for (const r of repeats.values()) r.fn(); };
  return { fw, watchers, exists, changes, statuses, advance, tick5min, repeats };
}
const ROOT = path.resolve('/w/工地照片');

test('5 秒內的變動合併；件數只算檔案，資料夾分開算；保留最近變動清單', () => {
  const f = { id: 'f1', owner: 'qa', path: ROOT, status: 'ok' };
  const s = setup([f], [ROOT]);
  s.fw.watch(f);
  const w = s.watchers[0];
  assert.equal(w.opt.depth, 4); assert.equal(w.opt.ignoreInitial, true);
  assert.equal(w.opt.ignored(path.join(ROOT, '.git', 'x')), true);       // 隱藏項目不看
  w.emit('all', 'add', path.join(ROOT, 'a.txt'));
  w.emit('all', 'change', path.join(ROOT, 'a.txt'));                     // 新增後又修改：仍算一個新增
  w.emit('all', 'add', path.join(ROOT, 'b.dwg'));
  w.emit('all', 'addDir', path.join(ROOT, 'sub'));
  w.emit('all', 'add', path.join(ROOT, 'sub', 'c.pdf'));
  s.advance(4999); assert.equal(s.changes.length, 0);
  s.advance(1);
  assert.equal(s.changes.length, 1);
  assert.equal(s.changes[0].files, 3); assert.equal(s.changes[0].dirs, 1);
  const rec = s.fw.recent('f1');
  assert.equal(rec.length, 4);
  assert.deepEqual(rec.map((x) => x.kind).sort(), ['add', 'add', 'add', 'addDir']);
  assert.ok(rec.some((x) => x.path === path.join('sub', 'c.pdf')));
  // 新增又刪掉：當沒發生
  w.emit('all', 'add', path.join(ROOT, 'tmp.txt')); w.emit('all', 'unlink', path.join(ROOT, 'tmp.txt'));
  s.advance(5000); assert.equal(s.changes.length, 1);
  assert.deepEqual(Object.keys(s.fw.recentAll()), ['f1']);
});

test('執行中監看的資料夾被刪掉：標成 missing、報告一次；每 5 分鐘重試，找回來就恢復監看', () => {
  const f = { id: 'f1', owner: 'qa', path: ROOT, status: 'ok' };
  const s = setup([f], [ROOT]);
  s.fw.watch(f); s.fw.startLoop();
  assert.equal([...s.repeats.values()][0].ms, 300000);
  s.exists.delete(ROOT);
  s.watchers[0].emit('all', 'unlinkDir', ROOT);                           // chokidar 回報根目錄不見了
  assert.equal(f.status, 'missing'); assert.equal(s.watchers[0].closed, true);
  assert.deepEqual(s.statuses, [['f1', 'missing', 'ok']]);
  s.tick5min(); s.tick5min();                                             // 還沒回來：不重複報告
  assert.equal(s.statuses.length, 1); assert.equal(s.fw.watching('f1'), false);
  s.exists.add(ROOT);
  s.tick5min();
  assert.equal(f.status, 'ok'); assert.equal(s.fw.watching('f1'), true);
  assert.deepEqual(s.statuses[1], ['f1', 'ok', 'missing']);
  assert.equal(s.watchers.length, 2);                                     // 重新開一個監看
  s.watchers[1].emit('all', 'add', path.join(ROOT, 'IMG_002.jpg'));
  s.advance(5000); assert.equal(s.changes.length, 1);
});

test('chokidar 的 error：資料夾不在了 → missing；還在 → error', () => {
  const f = { id: 'f1', owner: 'qa', path: ROOT, status: 'ok' };
  const s = setup([f], [ROOT]);
  s.fw.watch(f);
  s.watchers[0].emit('error', new Error('EACCES'));
  assert.equal(f.status, 'error');
  s.exists.delete(ROOT);
  s.watchers[0].emit('error', new Error('ENOENT'));
  assert.equal(f.status, 'missing');
});

test('改名（chokidar 沒有事件）：5 分鐘檢查時發現；啟動時已不在的標 missing', () => {
  const f = { id: 'f1', owner: 'qa', path: ROOT, status: 'ok' };
  const g = { id: 'f2', owner: 'qb', path: path.resolve('/w/隨身碟'), status: 'ok' };
  const h = { id: 'f3', owner: 'qb', path: path.resolve('/w/早就不見'), status: 'missing' };
  const s = setup([f, g, h], [ROOT]);
  [f, g, h].forEach((x) => s.fw.watch(x)); s.fw.startLoop();
  assert.equal(g.status, 'missing');
  assert.deepEqual(s.statuses, [['f2', 'missing', 'ok']]);               // 上次已經報過的（f3）不再報
  s.exists.delete(ROOT);
  s.tick5min();
  assert.equal(f.status, 'missing'); assert.equal(s.statuses.length, 2);
  s.fw.unwatch('f1'); assert.deepEqual(s.fw.recent('f1'), []);
  s.fw.stop(); assert.equal(s.repeats.size, 0);
});
