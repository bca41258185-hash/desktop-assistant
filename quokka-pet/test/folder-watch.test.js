const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('events');
const { createFolderWatch } = require('../lib/folder-watch');

// 假的 chokidar、檔案系統、計時器
function setup(folders, dirs) {
  let t = 0, id = 0; const timers = new Map(), repeats = new Map();
  const exists = new Set(dirs), unreadable = new Set();
  const watchers = [], deferred = [];
  const chokidar = { watch: (p, opt) => { const w = new EventEmitter(); w.path = p; w.opt = opt; w.closed = false; w.close = () => { w.closed = true; return Promise.resolve(); }; watchers.push(w); return w; } };
  const err = (code) => { const e = new Error(code); e.code = code; return e; };
  const fs = {
    statSync: (p) => { if (!exists.has(p)) throw err('ENOENT'); return { isDirectory: () => true }; },
    readdirSync: (p) => { if (!exists.has(p)) throw err('ENOENT'); if (unreadable.has(p)) throw err('EACCES'); return []; }
  };
  const changes = [], statuses = [];
  const fw = createFolderWatch({
    chokidar, fs, path, getFolders: () => folders,
    onChanges: (f, c) => changes.push({ id: f.id, ...c }), onStatus: (f, s, prev) => statuses.push([f.id, s, prev]),
    setTimer: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id; }, clearTimer: (i) => timers.delete(i),
    setRepeat: (fn, ms) => { repeats.set(++id, { fn, ms }); return id; }, clearRepeat: (i) => repeats.delete(i), now: () => t,
    defer: (fn) => deferred.push(fn), log: () => {}
  });
  const runDeferred = () => { while (deferred.length) deferred.shift()(); };
  const advance = (ms) => { const end = t + ms; for (;;) { const n = [...timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!n) break; timers.delete(n[0]); t = n[1].at; n[1].fn(); } t = end; };
  const tick5min = () => { t += 300000; for (const r of repeats.values()) r.fn(); };
  return { fw, watchers, exists, unreadable, changes, statuses, advance, tick5min, repeats, deferred, runDeferred };
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
  assert.equal(f.status, 'missing');
  assert.equal(s.watchers[0].closed, false, '事件處理裡不能同步 close（chokidar 會漏關父資料夾的 fs.watch）');
  s.runDeferred(); assert.equal(s.watchers[0].closed, true);
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

test('chokidar 的 error：資料夾不在了 → missing；子項目讀不到 → 照常監看、維持 ok', () => {
  const f = { id: 'f1', owner: 'qa', path: ROOT, status: 'ok' };
  const s = setup([f], [ROOT]);
  s.fw.watch(f);
  assert.equal(s.watchers[0].opt.ignorePermissionErrors, true);            // 子資料夾讀不到就略過
  const e = new Error('EACCES'); e.code = 'EACCES'; e.path = path.join(ROOT, '私人');
  s.watchers[0].emit('error', e);
  s.watchers[0].emit('error', new Error('EMFILE'));
  s.runDeferred();
  assert.equal(f.status, 'ok'); assert.equal(s.fw.watching('f1'), true); assert.equal(s.watchers[0].closed, false);
  s.exists.delete(ROOT);
  s.watchers[0].emit('error', new Error('ENOENT'));
  assert.equal(f.status, 'missing');
  s.runDeferred(); assert.equal(s.watchers[0].closed, true);
});

test('監看的資料夾本身讀不到 → error，真的停掉監看；5 分鐘檢查讀得到了就恢復 ok', () => {
  const f = { id: 'f1', owner: 'qa', path: ROOT, status: 'ok' };
  const s = setup([f], [ROOT]);
  s.fw.watch(f); s.fw.startLoop();
  s.unreadable.add(ROOT);
  s.watchers[0].emit('error', Object.assign(new Error('EACCES'), { code: 'EACCES' }));
  assert.equal(f.status, 'error'); assert.equal(s.fw.watching('f1'), false);   // 面板說「暫停監看」＝真的停了
  assert.equal(s.watchers[0].closed, false); s.runDeferred(); assert.equal(s.watchers[0].closed, true);
  s.watchers[0].emit('all', 'add', path.join(ROOT, 'late.txt'));          // 關掉前的殘留事件不算
  s.advance(5000); assert.equal(s.changes.length, 0);
  s.tick5min(); assert.equal(f.status, 'error'); assert.deepEqual(s.statuses, [['f1', 'error', 'ok']]);   // 還讀不到：不重複報告
  s.unreadable.delete(ROOT);
  s.tick5min();
  assert.equal(f.status, 'ok'); assert.equal(s.fw.watching('f1'), true);
  assert.deepEqual(s.statuses.slice(-1)[0], ['f1', 'ok', 'error']);
});

test('啟動時資料夾讀不到 → error（不開監看）；監看中但舊資料標成 error 的，檢查時改回 ok；監看中變得讀不到也會發現', () => {
  const f = { id: 'f1', owner: 'qa', path: ROOT, status: 'ok' };
  const g = { id: 'f2', owner: 'qa', path: path.resolve('/w/B'), status: 'ok' };
  const s = setup([f, g], [ROOT, g.path]);
  s.unreadable.add(ROOT);
  s.fw.watch(f); s.fw.watch(g);
  assert.equal(f.status, 'error'); assert.equal(s.fw.watching('f1'), false);
  g.status = 'error';                                                      // 舊版留下的狀態
  s.fw.checkAll();
  assert.equal(g.status, 'ok'); assert.equal(f.status, 'error');
  s.unreadable.add(g.path); s.fw.checkAll();
  assert.equal(g.status, 'error'); assert.equal(s.fw.watching('f2'), false);
  const closedNow = s.watchers.find((w) => w.path === g.path).closed;
  assert.equal(closedNow, true);                                           // 不在事件處理裡：可以馬上關
});

test('stop()／unwatch() 不在事件處理裡：馬上 close', () => {
  const f = { id: 'f1', owner: 'qa', path: ROOT, status: 'ok' };
  const s = setup([f], [ROOT]);
  s.fw.watch(f); s.fw.stop();
  assert.equal(s.watchers[0].closed, true); assert.equal(s.deferred.length, 0);
});

test('真的 chokidar：監看的資料夾被刪掉／改名後 stop()，不會留下任何 fs.watch（行程可以正常結束）', async () => {
  const realFs = require('fs'), os = require('os');
  const open = new Map(); let n = 0;
  const ow = realFs.watch;
  realFs.watch = function (p, ...rest) { const w = ow.call(realFs, p, ...rest); const k = ++n; open.set(k, p); const oc = w.close.bind(w); w.close = () => { open.delete(k); return oc(); }; return w; };
  const chokidar = require('chokidar');
  const base = realFs.mkdtempSync(path.join(os.tmpdir(), 'fw-leak-'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    for (const mode of ['rm', 'mv']) {
      const P = path.join(base, mode, 'proj');
      realFs.mkdirSync(path.join(P, 'sub'), { recursive: true });
      const f = { id: 'f-' + mode, owner: 'q', path: P };
      const statuses = [];
      const fw = createFolderWatch({ chokidar, fs: realFs, path, getFolders: () => [f], mergeMs: 100, onStatus: (x, st) => statuses.push(st), log: () => {} });
      fw.watch(f);
      await sleep(400);
      if (mode === 'rm') realFs.rmSync(P, { recursive: true }); else realFs.renameSync(P, P + '_old');
      await sleep(1200);
      fw.checkAll();
      assert.equal(f.status, 'missing', mode);
      fw.stop();
      await sleep(300);
      assert.deepEqual([...open.values()], [], `${mode}：stop() 後還開著的 fs.watch`);
    }
  } finally { realFs.watch = ow; realFs.rmSync(base, { recursive: true, force: true }); }
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
