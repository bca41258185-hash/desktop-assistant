// AI 專案監看：即時追蹤 Claude Code / Codex 的對話進度（唯讀）。
//
// 運作方式：
//  - 監看各工具寫在本機的對話紀錄檔（.jsonl），只「讀取」新增的行，絕不寫入或修改任何檔案。
//  - 每個紀錄檔 = 一個對話（session），依工作目錄（cwd）分組成「專案」。
//  - 解析器（claude.js / codex.js）把每行轉成訊號，這裡統一維護狀態：
//      working（進行中）→ waiting（可能在等你）→ working … → done（完成）／idle（閒置）
//  - 狀態轉換時呼叫 onEvent（給桌寵反應），任何變動時呼叫 onUpdate（給面板列表）。
//  - 只處理「指定專案」（options.projects）內的對話；其他專案的紀錄檔不讀取內容
//    （Claude Code 先以資料夾名稱過濾；需要時只讀檔頭判斷工作目錄，不符合就永久略過）。
//  - 若安裝了 Claude Code 通知鉤子，另外讀取鉤子事件檔，取得精準的「需要你允許」「回合結束」。

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
  tickMs: 3000,
  // 鉤子事件延遲處理，讓紀錄檔的最後幾行先寫入（避免「完成」時拿到舊的回覆摘要）
  hookDelayMs: 1000,
  // 判斷檔案屬於哪個專案時，最多讀取檔頭這麼多位元組
  peekBytes: 64 * 1024
};

// 路徑正規化：統一斜線、去掉結尾斜線；Windows 不分大小寫
function normPath(p) {
  let s = path.resolve(String(p || '')).replace(/\\/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32') s = s.toLowerCase();
  return s;
}

// Claude Code 存放紀錄的資料夾名稱：工作目錄中非英數字元都換成「-」
function claudeDirName(p) {
  return String(p).replace(/[^a-zA-Z0-9]/g, '-');
}

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
  // null = 不限制（測試用）；陣列 = 只處理這些專案資料夾（含子資料夾）
  const projects = Array.isArray(opt.projects) ? opt.projects.filter(Boolean) : null;
  const projectNorms = projects ? projects.map(normPath) : null;
  // 個別指定的 Claude Code 對話（session ID）：不論在哪個資料夾都追蹤
  const sessionIds = new Set((Array.isArray(opt.sessions) ? opt.sessions : []).filter(Boolean).map(String));
  const fileSessionId = (file) => path.basename(String(file || ''), '.jsonl');
  const watchedSession = (file) => sessionIds.has(fileSessionId(file));

  function inProjects(cwd) {
    if (!projectNorms) return true;
    const c = normPath(cwd);
    return projectNorms.some((p) => c === p || c.startsWith(p + '/'));
  }

  // Claude Code 預先過濾：只看資料夾名稱，不讀內容
  function claudeDirMayMatch(file) {
    if (!projects) return true;
    // Windows 磁碟代號大小寫可能不同（d:\ 與 D:\ 會編成 d-- / D--），比對時不分大小寫
    const fold = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
    const dir = fold(path.basename(path.dirname(file)));
    return projects.some((p) => {
      const enc = fold(claudeDirName(path.resolve(p)));
      return dir === enc || dir.startsWith(enc + '-');
    });
  }

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
        lastActivity: 0, notifiedWaiting: false, viaHooks: false, waitingMessage: ''
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
      case 'image':
        // 圖片不放進面板快照（太大），只隨事件送給桌寵
        if (!silent) onEvent({ kind: 'image', image: sig.url, fromUser: !!sig.fromUser, session: publicSession(s) });
        break;
      case 'customTitle':
        s.customTitle = shorten(sig.text, 60);
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
        s.waitingMessage = sig.message || '';
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
  function readFrom(file, start, limit) {
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const size = fs.fstatSync(fd).size;
      if (size <= start) return { text: '', size };
      const buf = Buffer.alloc(Math.min(size - start, limit || Infinity));
      fs.readSync(fd, buf, 0, buf.length, start);
      return { text: buf.toString('utf8'), size };
    } catch (e) {
      return null;
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* ignore */ }
    }
  }

  // 判斷這個紀錄檔是否屬於指定專案：true／false／null（還無法判斷，例如檔案剛建立）
  function admit(tool, file) {
    if (!projects) return true;
    if (tool === 'claude' && watchedSession(file)) return true;
    if (tool === 'claude' && !claudeDirMayMatch(file)) return false;
    const r = readFrom(file, 0, opt.peekBytes);
    if (!r) return null;
    const parser = PARSERS[tool];
    for (const line of r.text.split('\n')) {
      let entry;
      try { entry = JSON.parse(line); } catch (e) { continue; }
      let sigs = [];
      try { sigs = parser.parse(entry); } catch (e) { sigs = []; }
      const c = sigs.find((x) => x.type === 'cwd');
      if (c) return inProjects(c.cwd);
    }
    return null;
  }

  // 新出現（或尚未判定）的紀錄檔
  //  - quietUntil 之前的內容是「啟動時就已存在」的舊內容：靜默載入（不發通知），且最多讀結尾一段
  //  - quietUntil 之後的內容視為即時進度
  function onAdd(tool, file, initial) {
    const known = files.get(file);
    if (known && !known.undecided) return onChange(tool, file);
    let st;
    try { st = fs.statSync(file); } catch (e) { return; }
    const quietUntil = known && known.undecided ? known.quietUntil : (initial ? st.size : 0);

    if (initial && now() - st.mtimeMs >= opt.recentMs) {
      // 舊對話：連檔頭都不讀，等之後有新內容再判斷
      files.set(file, { undecided: true, quietUntil });
      return;
    }
    const ok = admit(tool, file);
    if (ok === false) { files.set(file, { ignored: true }); return; }
    if (ok === null) { files.set(file, { undecided: true, quietUntil }); return; }

    let rest = '';
    if (quietUntil > 0) {
      const start = Math.max(0, quietUntil - opt.initialTailBytes);
      const r = readFrom(file, start, quietUntil - start);
      if (!r) return;
      let text = r.text;
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);   // 丟掉被截斷的第一行
      const cut = text.lastIndexOf('\n');
      rest = text.slice(cut + 1);
      processLines(tool, file, cut >= 0 ? text.slice(0, cut + 1) : '', true);
      settleSilently(sessions.get(file));
    }
    files.set(file, { offset: quietUntil, rest });
    onChange(tool, file);
    queueUpdate();
  }

  function onChange(tool, file) {
    const f = files.get(file);
    if (!f || f.undecided) return onAdd(tool, file, false);
    if (f.ignored) return;
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
        // 有鉤子時以鉤子的「需要你允許」為準，不再用時間推測
        if (s.pending.size > 0 && quiet > opt.waitingMs && !s.notifiedWaiting && !s.viaHooks) {
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
      title: s.customTitle || s.aiTitle || s.title || '（尚無指令）', status: s.status, interrupted: !!s.interrupted,
      lastPrompt: shorten(s.lastPrompt, 120), lastAction: s.lastAction,
      lastText: shorten(s.lastText, 200), files: s.files.slice(0, 8),
      lastTextFull: String(s.lastText || '').slice(0, 600),   // 保留換行，給桌寵取「第一行」用
      waitingMessage: s.waitingMessage, viaHooks: s.viaHooks,
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

  // -------------------------------------------------------------------------
  // Claude Code 通知鉤子事件（hooks/claude-hook.js 寫入的 hook-events.jsonl）
  // -------------------------------------------------------------------------
  let hookOffset = 0;
  let hookRest = '';

  function findSessionByTranscript(p) {
    if (!p) return null;
    const n = normPath(p);
    for (const [file, s] of sessions) if (normPath(file) === n) return s;
    return null;
  }

  function handleHook(ev) {
    if (!ev || !ev.event) return;
    const s = findSessionByTranscript(ev.transcript_path);
    if (!s) return;
    if (ev.cwd && !inProjects(ev.cwd) && !watchedSession(s.id)) return;
    s.viaHooks = true;
    const at = now();
    if (ev.event === 'UserPromptSubmit') {
      apply(s, { type: 'turnStart' }, false, at);
    } else if (ev.event === 'Notification' && ev.notification_type === 'permission_prompt') {
      const m = /permission to use (.+)$/i.exec(ev.message || '');
      apply(s, { type: 'waiting', message: m ? `需要你允許使用 ${m[1]}` : '需要你允許' }, false, at);
    } else if (ev.event === 'Stop') {
      apply(s, { type: 'turnEnd' }, false, at);
      // 鉤子正在等使用者回覆（做完後可在泡泡打字）：另外通知桌寵開放輸入
      // （「完成」通常已經由紀錄檔先發過了，所以不能只靠 done 事件帶出去）
      if (ev.request_id) onEvent({ kind: 'reply-open', session: publicSession(s), request: { id: String(ev.request_id) } });
    } else if (ev.event === 'PermissionRequest' && ev.request_id) {
      // Claude 正在問「可以用這個工具嗎」，而且鉤子在等桌寵上的回答
      let req = {};
      try {
        req = JSON.parse(fs.readFileSync(path.join(path.dirname(opt.hookEventsFile), 'permission', ev.request_id + '.json'), 'utf8'));
      } catch (e) { return; }   // 請求檔已不在（已逾時或已回答）就不用再問
      const tool = req.tool_name || ev.tool_name || '';
      s.lastActivity = Math.max(s.lastActivity, at);
      const questions = Array.isArray(req.questions) && req.questions.length ? req.questions : null;
      s.waitingMessage = questions ? 'Claude 有問題要問你' : `需要你允許使用 ${tool}`;
      s.status = 'waiting';
      s.notifiedWaiting = true;
      onEvent({ kind: 'permission', session: publicSession(s), request: Object.assign({ id: String(ev.request_id), tool, summary: String(req.summary || '') }, questions ? { questions } : {}) });
    }
    queueUpdate();
  }

  function readHookEvents(fromStart) {
    const file = opt.hookEventsFile;
    if (!file) return;
    let st;
    try { st = fs.statSync(file); } catch (e) { hookOffset = 0; hookRest = ''; return; }
    if (fromStart === 'skip') { hookOffset = st.size; return; }    // 啟動前的舊事件不處理
    if (st.size < hookOffset) { hookOffset = 0; hookRest = ''; }    // 事件檔被換新
    const r = readFrom(file, hookOffset);
    if (!r) return;
    hookOffset = r.size;
    const text = hookRest + r.text;
    const cut = text.lastIndexOf('\n');
    if (cut < 0) { hookRest = text; return; }
    hookRest = text.slice(cut + 1);
    const evs = [];
    for (const line of text.slice(0, cut + 1).split('\n')) {
      if (!line.trim()) continue;
      try { evs.push(JSON.parse(line)); } catch (e) { /* 略過 */ }
    }
    const run = () => evs.forEach(handleHook);
    if (opt.hookDelayMs > 0) setTimeout(run, opt.hookDelayMs); else run();
  }

  function start() {
    if (opt.hookEventsFile) {
      const dir = path.dirname(opt.hookEventsFile);
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
      readHookEvents('skip');
      const hw = chokidar.watch(dir, { persistent: true, depth: 0, ignoreInitial: true });
      const onHookFile = (f) => { if (path.resolve(f) === path.resolve(opt.hookEventsFile)) readHookEvents(); };
      hw.on('add', onHookFile).on('change', onHookFile)
        .on('error', (err) => console.error('鉤子事件監看錯誤:', err.message));
      watchers.push(hw);
    }
    if (projects && projects.length === 0 && sessionIds.size === 0) {
      // 沒有指定任何專案：不讀取任何對話紀錄
      timer = setInterval(tick, opt.tickMs);
      return api;
    }
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
    _onChange: (tool, file) => onChange(tool, file),
    _readHookEvents: (mode) => readHookEvents(mode)
  };
  return api;
}

module.exports = { createAiWatcher, defaultRoots };
