// 資料夾監看（FolderWatch，規格 4.3）：唯讀，不改動任何檔案。
//   - 每個資料夾一個 chokidar 監看（深度 4 層，忽略隱藏項目）；5 秒內的變動合併成一次報告。
//   - 檔案和資料夾分開算：「3 個檔案變了」只算檔案，新增／刪除的資料夾另外列。
//   - 每個資料夾保留最近的變動清單（記憶體，不存檔），給面板顯示。
//   - 資料夾不見了（刪除、改名、隨身碟拔掉）：標成 missing，負責的那隻報告一次；
//     之後每 5 分鐘檢查一次，找回來就恢復監看並報告。執行中被刪掉也會發現：
//     監看根目錄的 unlinkDir、chokidar 的 error，或每 5 分鐘的檢查（改名時 chokidar 不一定有事件）。
//   - 讀不到（權限）：只有「監看的資料夾本身」讀不到才算 error，這時真的停掉監看，每 5 分鐘再試，讀得到就恢復 ok。
//     裡面某個子資料夾讀不到（EACCES／EPERM）只是略過那一個，整個資料夾照常監看、狀態仍是 ok。
//   - 在 chokidar 的事件處理裡不能同步 close（chokidar 3 會漏關父資料夾的 fs.watch，
//     在 Windows 上會讓隨身碟無法退出）：事件處理裡只標記狀態，close 延後到 setImmediate 再做。
// 依賴（chokidar、fs、計時器）全部由外面注入，方便測試。
(function () {
  const MERGE_MS = 5000, RETRY_MS = 5 * 60000, KEEP = 30;
  const KIND = { add: 'add', change: 'change', unlink: 'unlink', addDir: 'addDir', unlinkDir: 'unlinkDir' };

  function createFolderWatch({
    chokidar, fs, path, getFolders,
    onChanges = () => {},          // (folder, { files, dirs, items, at }) 合併後的一次變動
    onStatus = () => {},           // (folder, status, prev) 狀態改變：'ok' | 'missing' | 'error'
    setTimer = setTimeout, clearTimer = clearTimeout, setRepeat = setInterval, clearRepeat = clearInterval,
    mergeMs = MERGE_MS, retryMs = RETRY_MS, keep = KEEP, now = () => Date.now(), depth = 4,
    defer = (fn) => setImmediate(fn),   // 事件處理裡要關監看時，延後到這一輪事件處理結束後
    log = (...a) => { if (typeof console !== 'undefined') console.warn(...a); }
  }) {
    const watchers = new Map();    // folder id → { w, timer, pending: Map(rel → kind) }
    const recent = new Map();      // folder id → [{ at, kind, path }]（新的在前，最多 keep 筆）
    let loop = null;

    const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
    // 資料夾本身讀得到嗎（權限不夠時 readdir 會失敗）
    const canRead = (p) => { try { fs.readdirSync(p); return true; } catch (e) { return !(e && (e.code === 'EACCES' || e.code === 'EPERM')); } };
    const same = (a, b) => path.resolve(a) === path.resolve(b);
    const find = (id) => getFolders().find((f) => f.id === id);
    function setStatus(f, status) {
      const prev = f.status;
      if (prev === status) return;
      f.status = status;
      onStatus(f, status, prev);
    }

    function flush(f, st) {
      st.timer = null;
      const items = [...st.pending.entries()].map(([rel, kind]) => ({ kind, path: rel }));
      st.pending.clear();
      if (!items.length) return;
      const cur = find(f.id) || f;
      const at = new Date(now()).toISOString();
      const files = items.filter((x) => x.kind === 'add' || x.kind === 'change' || x.kind === 'unlink').length;
      const dirs = items.length - files;
      const list = recent.get(f.id) || [];
      recent.set(f.id, items.map((x) => ({ at, ...x })).concat(list).slice(0, keep));
      onChanges(cur, { files, dirs, items, at });
    }

    function start(f) {
      const ignored = (p) => path.relative(f.path, p).split(/[\/\\]/).some((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..');   // 只看根目錄底下的隱藏項目
      const st = { pending: new Map(), timer: null, w: null, dead: false };
      // ignorePermissionErrors：子資料夾讀不到就略過，不報 error（根目錄讀不到由 canRead 另外檢查）
      st.w = chokidar.watch(f.path, { ignoreInitial: true, depth, ignored, ignorePermissionErrors: true, awaitWriteFinish: { stabilityThreshold: 800 } });
      watchers.set(f.id, st);
      st.w.on('all', (ev, p) => {
        if (st.dead || !KIND[ev]) return;
        if (ev === 'unlinkDir' && same(p, f.path)) { lost(f, { inHandler: true }); return; }          // 監看的資料夾本身不見了
        const rel = path.relative(f.path, p) || path.basename(p);
        const prev = st.pending.get(rel);
        // 同一個檔案 5 秒內「新增又修改」仍算新增；「新增又刪除」就當沒發生
        if (prev === 'add' && ev === 'change') return;
        if (prev === 'add' && ev === 'unlink') st.pending.delete(rel);
        else if (prev === 'addDir' && ev === 'unlinkDir') st.pending.delete(rel);
        else st.pending.set(rel, prev === 'unlink' && ev === 'add' ? 'change' : ev);   // 刪掉又放回來＝修改
        if (!st.timer) st.timer = setTimer(() => flush(f, st), mergeMs);
      });
      st.w.on('error', (err) => {
        if (st.dead) return;
        if (!isDir(f.path)) { lost(f, { inHandler: true }); return; }
        if (!canRead(f.path)) { paused(f, { inHandler: true }); return; }
        // 裡面某個檔案／子資料夾的問題：記下來就好，整個資料夾照常監看（狀態維持 ok）
        log('[folder-watch]', f.path, err && (err.code || err.message));
      });
      setStatus(f, 'ok');
    }
    // inHandler：在 chokidar 自己的事件處理裡，close 要延後（見檔頭說明）
    function stopWatcher(id, { inHandler = false } = {}) {
      const st = watchers.get(id); if (!st) return;
      watchers.delete(id);
      st.dead = true;
      if (st.timer) clearTimer(st.timer);
      st.timer = null;
      const close = () => { try { const r = st.w.close(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* 已經關了 */ } };
      if (inHandler) defer(close); else close();
    }
    function lost(f, opt) { stopWatcher(f.id, opt); setStatus(f, 'missing'); }
    // 資料夾還在但讀不到：真的停掉監看（面板說「暫停」），每 5 分鐘再試
    function paused(f, opt) { stopWatcher(f.id, opt); setStatus(f, 'error'); }

    // 開始監看；資料夾不在就標 missing、讀不到就標 error（都等每 5 分鐘的檢查）
    function watch(f) {
      if (watchers.has(f.id)) return;
      if (!isDir(f.path)) { setStatus(f, 'missing'); return; }
      if (!canRead(f.path)) { setStatus(f, 'error'); return; }
      start(f);
    }
    function unwatch(id) { stopWatcher(id); recent.delete(id); }
    // 每 5 分鐘：不見的、讀不到的再試一次；在監看中的確認還在、還讀得到（改名時 chokidar 不一定會發事件）
    function checkAll() {
      for (const f of getFolders()) {
        const watching = watchers.has(f.id), dir = isDir(f.path), readable = dir && canRead(f.path);
        if (watching && !dir) lost(f);
        else if (watching && !readable) paused(f);
        else if (watching) setStatus(f, 'ok');                  // 舊資料留下的 error：監看其實在跑，改回 ok
        else if (readable) start(f);                            // missing／error → ok
        else if (dir) setStatus(f, 'error');                    // 回來了但讀不到
        else setStatus(f, 'missing');
      }
    }
    function startLoop() { if (!loop) loop = setRepeat(checkAll, retryMs); }
    function stop() { if (loop) clearRepeat(loop); loop = null; for (const id of [...watchers.keys()]) stopWatcher(id); }
    const recentOf = (id) => (recent.get(id) || []).slice();
    function recentAll() { const o = {}; for (const [id, l] of recent) o[id] = l.slice(); return o; }
    return { watch, unwatch, checkAll, startLoop, stop, recent: recentOf, recentAll, watching: (id) => watchers.has(id) };
  }

  module.exports = { createFolderWatch, MERGE_MS, RETRY_MS };
})();
