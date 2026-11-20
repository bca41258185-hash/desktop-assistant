// AI 專案監看：即時追蹤 Claude Code / Codex 的對話進度（唯讀）。
//
// 運作方式：
//  - 監看各工具寫在本機的對話紀錄檔（.jsonl），只「讀取」新增的行，絕不寫入或修改任何檔案。
//  - 每個紀錄檔 = 一個對話（session），依工作目錄（cwd）分組成「專案」。
//  - 解析器（claude.js / codex.js）把每行轉成訊號，這裡統一維護狀態：
//      working（進行中）→ waiting（可能在等你）→ working … → done（完成）／idle（閒置）
//  - 狀態轉換時呼叫 onEvent（給桌寵反應），任何變動時呼叫 onUpdate（給面板列表）。

const fs = require('fs');
const path = require('path');
const os = require('os');
const chokidar = require('chokidar');

const PARSERS = {
  claude: require('./claude'),
  codex: require('./codex')
};

const DEFAULTS = {
  // 啟動時只載入最近修改過的紀錄（更舊的只從結尾開始追蹤）
  recentMs: 6 * 3600 * 1000,
  // 啟動時每個檔案最多讀取結尾這麼多位元組，避免大型紀錄拖慢啟動
  initialTailBytes: 512 * 1024,
  // 有工具呼叫尚未回傳超過此時間 → 視為「可能在等你確認權限」（或指令執行較久）
  waitingMs: 20 * 1000,
  // 最後一筆是文字回覆且安靜超過此時間 → 視為完成（補足紀錄沒寫結束標記的情況）
  settleMs: 15 * 1000,
  // 進行中但安靜超過此時間 → 閒置
  idleMs: 30 * 60 * 1000,
  // 面板只列出這段時間內有活動的對話
  listWindowMs: 24 * 3600 * 1000,
  tickMs: 3000
};

function defaultRoots() {
  const home = os.homedir();
  return {
    claude: process.env.CLAUDE_CONFIG_DIR
      ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects')
      : path.join(home, '.claude', 'projects'),
    codex: process.env.CODEX_HOME
      ? path.join(process.env.CODEX_HOME, 'sessions')
      : path.join(home, '.codex', 'sessions')
  };
}

function shorten(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function createAiWatcher(options) {
  const opt = Object.assign({}, DEFAULTS, options || {});
  const roots = Object.assign(defaultRoots(), opt.roots || {});
  const enabled = opt.tools || ['claude', 'codex'];
  const now = opt.now || (() => Date.now());
  const onEvent = opt.onEvent || (() => {});
  const onUpdate = opt.onUpdate || (() => {});

  const files = new Map();      // file -> { offset, rest }
  const sessions = new Map();   // file -> session
  const watchers = [];
  let timer = null;
  let updateQueued = false;

  function queueUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    setImmediate(() => { updateQueued = false; onUpdate(snapshot()); });
  }

  function getSession(tool, file) {
    let s = sessions.get(file);
    if (!s) {
      s = {
        id: file, tool, label: PARSERS[tool].label, cwd: '', title: '',
        status: 'idle', lastPrompt: '', lastPromptAt: 0, lastAction: '', lastText: '',
        lastKind: '', files: [], pending: new Set(), turns: 0,
        lastActivity: 0, notifiedWaiting: false
      };
      sessions.set(file, s);
    }
    return s;
  }

  function emit(kind, s, silent) {
    if (!silent) onEvent({ kind, session: publicSession(s) });
  }

  function apply(s, sig, silent, at) {
    s.lastActivity = Math.max(s.lastActivity, at);
    switch (sig.type) {
      case 'cwd':
        s.cwd = sig.cwd;
        break;
      case 'title':
        s.aiTitle = shorten(sig.text, 60);
        break;
      case 'prompt': {
        // 去重：同一句指令短時間內重複出現（例如 Codex 同時寫兩種格式）
        if (sig.text === s.lastPrompt && at - s.lastPromptAt < 10000) break;
        s.lastPrompt = sig.text;
        s.lastPromptAt = at;
        if (!s.title) s.title = shorten(sig.text, 60);
        s.turns += 1;
        s.pending.clear();
        s.lastKind = 'prompt';
        s.lastAction = '';
        s.notifiedWaiting = false;
        s.status = 'working';
        emit('start', s, silent);
        break;
      }
      case 'turnStart':
        if (s.status !== 'working') { s.status = 'working'; s.notifiedWaiting = false; }
        break;
      case 'action':
        if (sig.id) s.pending.add(sig.id);
        s.lastAction = sig.text;
        s.lastKind = 'action';
        for (const f of [].concat(sig.file || [], sig.files || [])) {
          if (!f) continue;
          s.files = [f].concat(s.files.filter((x) => x !== f)).slice(0, 20);
        }
        backToWorking(s);
        break;
      case 'toolDone':
        if (sig.id) s.pending.delete(sig.id);
        s.lastKind = 'toolDone';
        backToWorking(s);
        break;
      case 'text':
        s.lastText = sig.text;
        s.lastKind = 'text';
        backToWorking(s);
        break;
      case 'waiting':
        if (s.status !== 'waiting') {
          s.status = 'waiting';
          s.notifiedWaiting = true;
          emit('waiting', s, silent);
        }
        break;
      case 'turnEnd':
        s.pending.clear();
        s.lastKind = 'end';
        if (s.status === 'working' || s.status === 'waiting') {
          s.status = 'done';
          s.interrupted = !!sig.interrupted;
          emit('done', s, silent);
        }
        break;
      default:
        break;
    }
  }

  function backToWorking(s) {
    if (s.status === 'waiting') { s.status = 'working'; s.notifiedWaiting = false; }
    else if (s.status === 'done' || s.status === 'idle') {
      // 沒有新指令卻又有動作（例如背景任務）：視為進行中，但不再發「開始」通知
      s.status = 'working';
    }
  }

  function processLines(tool, file, text, silent) {
    const parser = PARSERS[tool];
    const s = getSession(tool, file);
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch (e) { continue; }   // 半行或格式異常：略過
      const at = Date.parse(entry.timestamp) || now();
      let sigs = [];
      try { sigs = parser.parse(entry); } catch (e) { sigs = []; }
      for (const sig of sigs) apply(s, sig, silent, silent ? at : now());
    }
  }

  // 讀取檔案從 offset 到結尾的新內容（唯讀開啟）
  function readFrom(file, start) {
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const size = fs.fstatSync(fd).size;
      if (size <= start) return { text: '', size };
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return { text: buf.toString('utf8'), size };
    } catch (e) {
      return null;
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* ignore */ }
    }
  }

  function onAdd(tool, file, initial) {
    if (files.has(file)) return onChange(tool, file);
    let st;
    try { st = fs.statSync(file); } catch (e) { return; }
    const recent = now() - st.mtimeMs < opt.recentMs;
    if (initial && !recent) {
      // 舊對話：不載入內容，只從結尾開始追蹤，之後有新內容再出現在列表
      files.set(file, { offset: st.size, rest: '' });
      return;
    }
    let start = 0;
    if (initial && st.size > opt.initialTailBytes) start = st.size - opt.initialTailBytes;
    const r = readFrom(file, start);
    if (!r) return;
    let text = r.text;
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);   // 丟掉被截斷的第一行
    const cut = text.lastIndexOf('\n');
    files.set(file, { offset: r.size, rest: cut === text.length - 1 ? '' : text.slice(cut + 1) });
    processLines(tool, file, cut >= 0 ? text.slice(0, cut + 1) : '', initial);
    if (initial) settleSilently(sessions.get(file));
    queueUpdate();
  }

  function onChange(tool, file) {
    const f = files.get(file);
    if (!f) return onAdd(tool, file, false);
    const r = readFrom(file, f.offset);
    if (!r) return;
    if (r.size < f.offset) { f.offset = 0; f.rest = ''; return onChange(tool, file); }   // 檔案被截斷或重寫
    f.offset = r.size;
    const text = f.rest + r.text;
    const cut = text.lastIndexOf('\n');
    if (cut < 0) { f.rest = text; return; }
    f.rest = text.slice(cut + 1);
    processLines(tool, file, text.slice(0, cut + 1), false);
    queueUpdate();
  }

  // 啟動時載入的舊內容：依安靜時間直接定出狀態，不發通知（避免一開機就連發「完成了」）
  function settleSilently(s) {
    if (!s || s.status !== 'working') return;
    const quiet = now() - s.lastActivity;
    if (quiet > opt.idleMs) s.status = 'idle';
    else if (s.pending.size > 0 && quiet > opt.waitingMs) { s.status = 'waiting'; s.notifiedWaiting = true; }
    else if (s.pending.size === 0 && s.lastKind === 'text' && quiet > opt.settleMs) s.status = 'done';
  }

  function tick() {
    const t = now();
    let changed = false;
    for (const s of sessions.values()) {
      const quiet = t - s.lastActivity;
      if (s.status === 'working') {
        if (s.pending.size > 0 && quiet > opt.waitingMs && !s.notifiedWaiting) {
          s.status = 'waiting';
          s.notifiedWaiting = true;
          emit('waiting', s, false);
          changed = true;
        } else if (s.pending.size === 0 && s.lastKind === 'text' && quiet > opt.settleMs) {
          s.status = 'done';
          emit('done', s, false);
          changed = true;
        } else if (quiet > opt.idleMs) {
          s.status = 'idle';
          changed = true;
        }
      } else if (s.status === 'waiting' && quiet > opt.idleMs) {
        s.status = 'idle';
        changed = true;
      }
    }
    if (changed) queueUpdate();
  }

  function publicSession(s) {
    const project = s.cwd || '（未知目錄）';
    return {
      id: s.id, tool: s.tool, label: s.label, project,
      projectName: s.cwd ? path.basename(s.cwd) : '未知專案',
      title: s.aiTitle || s.title || '（尚無指令）', status: s.status, interrupted: !!s.interrupted,
      lastPrompt: shorten(s.lastPrompt, 120), lastAction: s.lastAction,
      lastText: shorten(s.lastText, 200), files: s.files.slice(0, 8),
      turns: s.turns, lastActivity: s.lastActivity
    };
  }

  // 依專案分組，最近活動的在前
  function snapshot() {
    const t = now();
    const groups = new Map();
    for (const s of sessions.values()) {
      if (!s.lastActivity || t - s.lastActivity > opt.listWindowMs) continue;
      if (!s.turns && !s.lastAction) continue;   // 尚無實質內容
      const p = publicSession(s);
      if (!groups.has(p.project)) groups.set(p.project, { project: p.project, name: p.projectName, sessions: [] });
      groups.get(p.project).sessions.push(p);
    }
    const list = [...groups.values()];
    list.forEach((g) => {
      g.sessions.sort((a, b) => b.lastActivity - a.lastActivity);
      g.lastActivity = g.sessions[0].lastActivity;
    });
    return list.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  function start() {
    for (const tool of enabled) {
      const parser = PARSERS[tool];
      const root = roots[tool];
      if (!parser || !root) continue;
      // 目錄不存在（沒安裝該工具）時就不監看，不報錯
      if (!fs.existsSync(root)) continue;
      let ready = false;
      const w = chokidar.watch(root, {
        persistent: true,
        depth: parser.depth,
        ignorePermissionErrors: true
      });
      w.on('add', (file) => { if (parser.accepts(root, file)) onAdd(tool, file, !ready); })
        .on('change', (file) => { if (parser.accepts(root, file)) onChange(tool, file); })
        .on('unlink', (file) => { files.delete(file); if (sessions.delete(file)) queueUpdate(); })
        .on('ready', () => { ready = true; queueUpdate(); })
        .on('error', (err) => console.error(`AI 專案監看錯誤（${tool}）:`, err.message));
      watchers.push(w);
    }
    timer = setInterval(tick, opt.tickMs);
    return api;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    return Promise.all(watchers.splice(0).map((w) => w.close()));
  }

  // 測試用：直接餵入檔案內容變動，不經 chokidar
  const api = {
    start, stop, snapshot, tick, roots,
    _onAdd: (tool, file, initial) => onAdd(tool, file, initial),
    _onChange: (tool, file) => onChange(tool, file)
  };
  return api;
}

module.exports = { createAiWatcher, defaultRoots };
