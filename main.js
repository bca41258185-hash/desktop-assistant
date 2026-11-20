// 主行程：負責視窗、IPC、資料夾監看、設定讀寫、提醒、AI 呼叫。
// Main process: windows, IPC, folder watching, config I/O, reminders, AI calls.

const { app, BrowserWindow, ipcMain, dialog, screen, Menu, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const { createProvider } = require('./providers');
const { createAiWatcher, defaultRoots } = require('./ai-watch');
const hooksInstaller = require('./ai-watch/hooks-installer');
const { listClaudeSessions, desktopSessionMeta } = require('./ai-watch/claude-sessions');
const compose = require('./ai-watch/compose');
const { CHARACTERS, DEFAULT_ID, categoryOf } = require('./renderer/characters');

// 名言資料：讀取 data/ 下所有 quotes*.json（每個職業一個檔，方便擴充）
function loadQuotes() {
  const map = {};
  const dir = path.join(__dirname, 'data');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /^quotes.*\.json$/.test(f)).sort();
  } catch (e) {
    console.error('讀取名言資料夾失敗:', e.message);
    return map;
  }
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      const list = Array.isArray(raw) ? raw : (raw.quotes || []);
      for (const q of list) {
        if (!q || !q.id || !q.zh) continue;
        if (!map[q.id]) map[q.id] = [];
        map[q.id].push(q);
      }
    } catch (e) {
      console.error(`載入名言失敗（${f}）:`, e.message);
    }
  }
  return map;
}
let petWindow = null;
let panelWindow = null;
const watchers = new Map();      // folderPath -> chokidar watcher
let recentChanges = [];          // { path, name, type, time }
let reminderTimer = null;
let quoteTimer = null;
let lastQuoteIndex = -1;
let config = null;
let QUOTES_BY_ID = loadQuotes();
let aiWatcher = null;             // AI 專案監看（Claude Code / Codex）
let aiSnapshot = [];

// ---------------------------------------------------------------------------
// 設定讀寫（存於 app.getPath('userData')，絕不放進 repo）
// ---------------------------------------------------------------------------
const CONFIG_DEFAULTS = {
  folders: [],
  tasks: [],
  settings: {
    provider: 'openai',            // 'openai' | 'stub'
    apiKey: '',
    baseUrl: '',
    model: '',
    reminderIntervalMinutes: 30,
    quoteIntervalMinutes: 20,      // 名言氣泡間隔（0＝關閉）
    characterId: DEFAULT_ID,       // 目前選用的大師（'ando' | 'gehry' | ...）
    aiWatch: true,                 // 監看 Claude Code / Codex 對話進度（唯讀）
    aiProjects: []                 // 只監看這些專案資料夾內的對話（空 = 不讀任何對話）
  }
};

// 回傳有效且存在的角色 id（避免設定檔殘留無效值）
function currentCharacterId() {
  const id = config && config.settings && config.settings.characterId;
  return CHARACTERS[id] ? id : DEFAULT_ID;
}

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    return {
      ...CONFIG_DEFAULTS,
      ...parsed,
      settings: { ...CONFIG_DEFAULTS.settings, ...(parsed.settings || {}) }
    };
  } catch (e) {
    return JSON.parse(JSON.stringify(CONFIG_DEFAULTS));
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('儲存設定失敗:', e.message);
  }
}

// 將本機設定與環境變數合併後的「有效設定」（環境變數優先）
function effectiveSettings() {
  const s = config.settings;
  return {
    provider: s.provider || 'openai',
    apiKey: process.env.OPENAI_API_KEY || s.apiKey || '',
    baseUrl: process.env.OPENAI_BASE_URL || s.baseUrl || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || s.model || 'gpt-4o-mini',
    reminderIntervalMinutes: Number(s.reminderIntervalMinutes) || 30,
    quoteIntervalMinutes: (s.quoteIntervalMinutes === 0 || s.quoteIntervalMinutes === '0')
      ? 0
      : (Number(s.quoteIntervalMinutes) || 20)
  };
}

// ---------------------------------------------------------------------------
// 視窗
// ---------------------------------------------------------------------------
// 桌寵視窗平常只有角色大小（不擋住後面的畫面），說話時才向上展開放泡泡。
// 兩種大小都以「角色底部中央」為錨點，所以角色不會跳動。
const PET_SMALL = { width: 240, height: 250 };
const PET_BIG = { width: 520, height: 640 };
let petExpanded = false;
let petShift = 0;   // 展開時因貼近螢幕邊緣而把視窗推回的距離（角色在視窗內反向位移）

function setPetExpanded(open) {
  if (!petWindow || petWindow.isDestroyed() || open === petExpanded) return;
  const from = petExpanded ? PET_BIG : PET_SMALL;
  const to = open ? PET_BIG : PET_SMALL;
  const b = petWindow.getBounds();
  const anchorX = b.x + from.width / 2 + petShift;   // 角色水平中心（含展開時的位移）
  const bottom = b.y + from.height;           // 角色腳底
  let x = Math.round(anchorX - to.width / 2);
  const y = Math.round(bottom - to.height);
  let shift = 0;
  if (open) {
    // 靠近螢幕邊緣時把視窗推回畫面內，並請角色反向位移，維持原位
    const wa = screen.getDisplayNearestPoint({ x: Math.round(anchorX), y: bottom - 10 }).workArea;
    const clamped = Math.min(Math.max(x, wa.x), wa.x + wa.width - to.width);
    shift = x - clamped;
    x = clamped;
  }
  petExpanded = open;
  petShift = shift;
  petWindow.setBounds({ x, y, width: to.width, height: to.height });
  petWindow.webContents.send('pet:layout', { shift });
}

function createPetWindow() {
  petExpanded = false;
  petShift = 0;
  petWindow = new BrowserWindow({
    width: PET_SMALL.width,
    height: PET_SMALL.height,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  petWindow.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
  petWindow.setAlwaysOnTop(true, 'screen-saver');

  // 載入完成後，告知桌寵目前選用的大師並顯示其問候語
  petWindow.webContents.on('did-finish-load', () => {
    const id = currentCharacterId();
    const c = CHARACTERS[id];
    petWindow.webContents.send('pet:character', { id, greeting: c.greeting });
  });

  // 預設放在主螢幕右下角
  const { workArea } = screen.getPrimaryDisplay();
  petWindow.setPosition(
    workArea.x + workArea.width - PET_SMALL.width - 40,
    workArea.y + workArea.height - PET_SMALL.height - 20
  );
}

function createPanelWindow() {
  panelWindow = new BrowserWindow({
    width: 440,
    height: 640,
    show: false,
    title: '桌面大師工作室',
    backgroundColor: '#f4f1e9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 隱藏原生英文選單列（File / Edit / View ...），Windows / Linux 皆適用
  panelWindow.setMenuBarVisibility(false);
  panelWindow.removeMenu();

  panelWindow.loadFile(path.join(__dirname, 'renderer', 'panel.html'));

  // 關閉時只隱藏，不真的結束（除非整個 app 要退出）
  panelWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      panelWindow.hide();
    }
  });
}

function togglePanel() {
  if (!panelWindow) createPanelWindow();
  if (panelWindow.isVisible()) {
    panelWindow.hide();
  } else {
    panelWindow.show();
    panelWindow.focus();
  }
}

// ---------------------------------------------------------------------------
// 讓桌寵「說話」：把文字送到桌寵視窗顯示氣泡
// ---------------------------------------------------------------------------
function speak(text) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:speak', text);
  }
}

// 讓桌寵切換姿勢：'idle' | 'think' | 'happy'
function setPetPose(pose) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:pose', pose);
  }
}

// 切換桌寵角色並播放該大師的問候語
function setPetCharacter(id, withGreeting) {
  if (petWindow && !petWindow.isDestroyed()) {
    const c = CHARACTERS[id];
    petWindow.webContents.send('pet:character', {
      id,
      greeting: withGreeting && c ? c.greeting : undefined
    });
  }
}

// ---------------------------------------------------------------------------
// 資料夾監看（唯讀：只通知，不刪除/搬移/改名任何檔案）
// ---------------------------------------------------------------------------
function watchFolder(folder) {
  if (watchers.has(folder)) return;
  try {
    const watcher = chokidar.watch(folder, {
      ignoreInitial: true,
      persistent: true,
      depth: 4,
      ignored: /(^|[/\\])\../   // 略過隱藏檔 .xxx
    });
    const handler = (type) => (filePath) => recordChange(type, filePath);
    watcher
      .on('add', handler('新增'))
      .on('change', handler('修改'))
      .on('unlink', handler('刪除'))
      .on('error', (err) => console.error('監看錯誤:', err.message));
    watchers.set(folder, watcher);
  } catch (e) {
    console.error('無法監看資料夾:', folder, e.message);
  }
}

function unwatchFolder(folder) {
  const w = watchers.get(folder);
  if (w) {
    w.close();
    watchers.delete(folder);
  }
}

function recordChange(type, filePath) {
  const name = path.basename(filePath);
  const entry = { path: filePath, name, type, time: new Date().toISOString() };
  recentChanges.unshift(entry);
  if (recentChanges.length > 50) recentChanges = recentChanges.slice(0, 50);

  speak(`資料夾有${type}檔案：${name}`);
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send('changes:update', recentChanges);
  }
}

function changesSummary(limit = 10) {
  if (!recentChanges.length) return '目前沒有資料夾變更紀錄。';
  return recentChanges
    .slice(0, limit)
    .map((c) => `- [${c.type}] ${c.name}（${new Date(c.time).toLocaleString('zh-TW')}）`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// 定時提醒：顯示目前工作進度
// ---------------------------------------------------------------------------
function setupReminder() {
  if (reminderTimer) clearInterval(reminderTimer);
  const mins = effectiveSettings().reminderIntervalMinutes;
  if (!mins || mins <= 0) return;
  reminderTimer = setInterval(() => {
    const total = config.tasks.length;
    const done = config.tasks.filter((t) => t.done).length;
    if (total > 0) speak(`今天 ${done}/${total} 完成，加油！`);
  }, mins * 60 * 1000);
}

// ---------------------------------------------------------------------------
// 名言：目前大師的查證引言（與角色問候語分開）
// ---------------------------------------------------------------------------
function quotesFor(id) {
  // 沒有收錄名言的角色回傳空陣列，避免誤顯示其他人的名言
  return QUOTES_BY_ID[id] || [];
}

function speakQuote(quote) {
  if (!quote || !quote.zh) return false;
  const master = CHARACTERS[quote.id] || CHARACTERS[currentCharacterId()];
  const name = master ? master.nameZh : '';
  const source = quote.sourceZh || quote.source || '';
  const attribution = [name, source].filter(Boolean).join(' ／ ');
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:speak', {
      text: quote.zh,
      attribution: attribution ? '—— ' + attribution : '',
      duration: 12000
    });
  }
  return true;
}

function speakRandomQuote() {
  const list = quotesFor(currentCharacterId());
  if (!list.length) return false;
  let idx = Math.floor(Math.random() * list.length);
  if (list.length > 1 && idx === lastQuoteIndex) {
    idx = (idx + 1) % list.length;
  }
  lastQuoteIndex = idx;
  return speakQuote(list[idx]);
}

function setupQuoteTimer() {
  if (quoteTimer) clearInterval(quoteTimer);
  const mins = effectiveSettings().quoteIntervalMinutes;
  if (!mins || mins <= 0) return;
  quoteTimer = setInterval(() => {
    speakRandomQuote();
  }, mins * 60 * 1000);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// AI 專案監看：即時反映 Claude Code / Codex 的對話進度（唯讀，只讀對話紀錄檔）
// ---------------------------------------------------------------------------
const aiLastBubble = new Map();   // sessionId+kind -> 時間，避免同一事件連續洗版

// 給泡泡用的一句話：取回覆的第一行、去掉 Markdown 符號，只留第一句；太長才截斷
function petLine(text, n) {
  const first = String(text || '').split('\n').map((l) => l.trim()).find((l) => l && !/^[-=*_#>|\s]+$/.test(l) && !l.startsWith('#')) || '';   // 標題行不算
  const plain = first.replace(/^[#>*\s-]+/, '').replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
  const m = /^(.+?[。！？!?])(?![」』）)"'])/.exec(plain);   // 引號裡的問號不算句尾
  const sentence = m && m[1].length <= n ? m[1] : plain;
  return sentence.length > n ? sentence.slice(0, n - 1) + '…' : sentence;
}

function clip(text, n) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

// 把「Claude 想用某個工具」說成白話（不出現 Bash、Edit 這類名稱）
function permissionQuestion(tool, summary) {
  const what = clip(summary, 40);
  const quoted = what ? `「${what}」` : '';
  switch (tool) {
    case 'Bash': case 'PowerShell': return `Claude 想在電腦上執行${quoted || '一個指令'}，要讓它做嗎？`;
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `Claude 想修改檔案${quoted}，要讓它改嗎？`;
    case 'Write': return `Claude 想寫入檔案${quoted}，要讓它寫嗎？`;
    case 'Read': return `Claude 想讀取檔案${quoted}，要讓它讀嗎？`;
    case 'WebFetch': case 'WebSearch': return `Claude 想上網查資料${quoted}，要讓它查嗎？`;
    default: return `Claude 想做一件需要你同意的事${quoted}，要讓它做嗎？`;
  }
}

// --- 在泡泡上回答 Claude 的權限詢問 ---
const pendingPermissions = new Set();   // 還在等使用者回答的請求 id
const pendingReplies = new Set();       // 做完後等使用者回覆的請求 id
const pendingQuestions = new Map();     // 請求 id → { questions, index, answers }（Claude 的選擇題，一題一題問）

function askNextQuestion(id) {
  const st = pendingQuestions.get(id);
  if (!st) return;
  const q = st.questions[st.index];
  speak({
    text: q.question,
    attribution: st.questions.length > 1 ? `第 ${st.index + 1} 題，共 ${st.questions.length} 題` : '',
    ai: true, sticky: true, action: 'choice', requestId: id,
    choices: q.options.map((label, i) => ({ id: 'opt' + i, label })),
    inputPlaceholder: '或自己打字回答…'
  });
}

// 讓鉤子知道桌寵開著（沒開的話鉤子不會讓 Claude 空等）
function touchAlive() {
  try {
    fs.mkdirSync(aiHooksDir(), { recursive: true });
    fs.writeFileSync(path.join(aiHooksDir(), 'app-alive'), String(Date.now()));
  } catch (e) { /* ignore */ }
}

// choice：'allow'｜'deny'｜'pass'（不回答，交回 Claude 自己的詢問畫面）
function permLog(msg) {
  try { fs.appendFileSync(path.join(aiHooksDir(), 'permission-debug.log'), `${new Date().toISOString()} app ${msg}
`); } catch (e) { /* ignore */ }
}

function answerPermission(id, choice, answers, message) {
  permLog(`${id} answer=${choice}${answers ? '+answers' : ''} pending=${pendingPermissions.has(id)}`);
  pendingQuestions.delete(id);
  if (!/^[\w-]+$/.test(String(id || '')) || !pendingPermissions.delete(id)) return;
  try {
    const dir = path.join(aiHooksDir(), 'permission');
    if (!fs.existsSync(path.join(dir, id + '.json'))) {
      // 鉤子已經結束（等太久）：答案送不過去了，直接帶使用者到 Claude 去回答
      permLog(`${id} expired`);
      if (choice !== 'pass') focusClaudeWindow();
      return;
    }
    fs.writeFileSync(path.join(dir, id + '.answer.json'), JSON.stringify(Object.assign({ choice }, answers ? { answers } : {}, message ? { message } : {})));
  } catch (e) {
    console.error('寫入權限回答失敗:', e.message);
  }
}

function onAiEvent({ kind, session: s, image, fromUser, request }) {
  if (kind === 'reply-open') {
    // Claude 做完了，而且鉤子還在等：完成泡泡多一格輸入框，打字就把話交給 Claude 繼續做
    const id = request.id;
    permLog(`${id} reply-open`);
    pendingPermissions.add(id);
    pendingReplies.add(id);
    replyBySession.set(sessionIdOf(s), id);
    setPetPose('happy');
    speak({
      text: petLine(s.lastTextFull || s.lastText, 44) || '完成了',
      ai: true, sticky: true, action: 'confirm', requestId: id, inputPlaceholder: '回覆 Claude…'
    });
    // 20 秒內沒有開始打字，鉤子會自己結束；輸入框也跟著收起來
    setTimeout(() => {
      if (!pendingReplies.has(id)) return;
      if (fs.existsSync(path.join(aiHooksDir(), 'permission', id + '.hold'))) return;
      pendingReplies.delete(id);
      pendingPermissions.delete(id);
      if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:input-expire', id);
    }, 19000);
    return;
  }
  if (kind === 'permission') {
    permLog(`${request.id} shown tool=${request.tool}`);
    pendingPermissions.add(request.id);
    setPetPose('idle');
    if (Array.isArray(request.questions) && request.questions.length) {
      pendingQuestions.set(request.id, { questions: request.questions, index: 0, answers: {} });
      askNextQuestion(request.id);
      return;
    }
    speak({
      text: permissionQuestion(request.tool, request.summary),
      ai: true, sticky: true, action: 'choice', requestId: request.id,
      choices: [{ id: 'allow', label: '允許' }, { id: 'deny', label: '拒絕' }],
      inputPlaceholder: '或告訴 Claude 改怎麼做…'
    });
    return;
  }
  // 使用者自己貼的圖不顯示（自己已經看過），只顯示 Claude 在對話中開的圖
  if (kind === 'image' && fromUser) return;
  const key = s.id + ':' + kind;
  const t = Date.now();
  // 圖片不節流：連續好幾張時一律顯示最新的一張
  if (kind !== 'image' && t - (aiLastBubble.get(key) || 0) < 4000) return;
  aiLastBubble.set(key, t);
  // 剛顯示圖片的幾秒內，「開始」不要蓋掉圖片（等你確認、完成比較重要，照樣顯示）
  if (kind === 'start' && t - (aiLastBubble.get(s.id + ':image') || 0) < 8000) {
    setPetPose('think');
    return;
  }

  // 泡泡只說發生了什麼，不寫專案／對話名稱（字大、空間小，名稱只是雜訊）
  if (kind === 'image') {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:speak', { text: '我在看的圖', image, duration: 15000, ai: true });
    }
  } else if (kind === 'start') {
    setPetPose('think');
    speak({ text: `開始處理：${clip(s.lastPrompt, 30)}`, ai: true });
  } else if (kind === 'waiting') {
    setPetPose('idle');
    // 等你回覆的泡泡也留著，點一下就跳到 Claude
    speak({ text: 'Claude 在等你回答', ai: true, sticky: true, action: 'reply' });
  } else if (kind === 'done') {
    if (s.interrupted) {
      setPetPose('idle');
      speak({ text: '已中斷', ai: true });
    } else {
      setPetPose('happy');
      // 「完成」要等使用者按確認才消失，不會自己不見，也不會被名言／提醒蓋掉
      speak({ text: petLine(s.lastTextFull || s.lastText, 44) || '完成了', ai: true, sticky: true });
    }
  }
}

// --- 主動對 Claude 說話 ---
const replyBySession = new Map();   // 對話 ID → 做完後還在等回覆的鉤子請求 id

function sessionIdOf(s) {
  return path.basename(String((s && s.id) || ''), '.jsonl');
}

// 可以送話過去的對話：所有追蹤中的對話，等你的 > 進行中的 > 最近有動靜的；第一個是預設
function composeTargets() {
  const rank = { waiting: 0, working: 1, done: 2, idle: 3 };
  const out = new Map();
  const live = [].concat(...(aiSnapshot || []).map((p) => p.sessions || []));
  live.sort((a, b) => (rank[a.status] - rank[b.status]) || (b.lastActivity - a.lastActivity));
  live.forEach((s) => out.set(sessionIdOf(s), {
    id: sessionIdOf(s), title: (s.title && s.title !== '（尚無指令）') ? s.title : '對話', status: s.status
  }));
  aiSessions().forEach((w) => { if (!out.has(w.id)) out.set(w.id, { id: w.id, title: w.title || '對話', status: 'idle' }); });
  return [...out.values()];
}

function composeTarget(id) {
  const list = composeTargets();
  return list.find((t) => t.id === id) || list[0] || null;
}

function openCompose() {
  const list = composeTargets();
  if (!list.length) {
    speak({ text: '先點我兩下，按「＋ 加入對話」選一個對話。', duration: 8000 });
    return;
  }
  speak({
    text: '要跟 Claude 說什麼？',
    // 只有一個對話時直接寫出名稱；有好幾個時列出來讓使用者點選
    attribution: list.length > 1 ? '' : '送到：' + clip(list[0].title, 30),
    targets: list.length > 1 ? list.slice(0, 5).map((t) => ({ id: t.id, title: clip(t.title, 26) })) : [],
    ai: true, sticky: true, action: 'compose', inputPlaceholder: '打字，按 Enter 送出'
  });
}

async function sendCompose(text, targetId) {
  text = String(text || '').trim().slice(0, 4000);
  const t = composeTarget(targetId);
  if (!text || !t) return;
  const say = (msg) => speak({ text: msg, ai: true, duration: 7000 });
  try {
    // 1. Claude 剛做完、鉤子還在等：直接交給它
    const rid = replyBySession.get(t.id);
    if (rid && pendingReplies.delete(rid)) {
      answerPermission(rid, 'reply', null, text);
      return say('送出了。');
    }
    // 2. Claude 正在做事：先放進待送信箱，這一回合做完就會交給它
    if (t.status === 'working' || t.status === 'waiting') {
      compose.queueMessage(aiHooksDir(), t.id, text);
      return say('收到，Claude 做完手上的事就會看到。');
    }
    // 3. Claude 閒著：用官方連結開到那段對話，把字貼進去送出
    let meta = null;
    try { meta = desktopSessionMeta().get(t.id); } catch (e) { /* 沒有桌面版資料 */ }
    clipboard.writeText(text);
    if (!meta || !/^local_[A-Za-z0-9-]+$/.test(meta.localId || '')) {
      focusClaudeWindow();
      return say('已經複製好了，請到 Claude 按 Ctrl+V 貼上。');
    }
    await shell.openExternal('claude://code/continue?session=' + meta.localId);
    const r = await compose.pasteIntoClaude();
    say(r === 'sent' ? '送出了。' : '已經複製好了，請到 Claude 按 Ctrl+V 貼上。');
  } catch (e) {
    console.error('送出訊息失敗:', e.message);
    say('沒送出去，請到 Claude 直接打字。');
  }
}

// 角色頭上的小狀態標籤：等你 > 進行中 > 剛完成（10 分鐘內）；都沒有就不顯示
function petStatusOf(list) {
  const all = [].concat(...(list || []).map((p) => p.sessions || []));
  if (all.some((s) => s.status === 'waiting')) return { text: '等你回答', cls: 'waiting' };
  const working = all.filter((s) => s.status === 'working').length;
  if (working) return { text: working > 1 ? `${working} 段進行中` : '進行中', cls: 'working' };
  if (all.some((s) => s.status === 'done' && Date.now() - s.lastActivity < 10 * 60 * 1000)) return { text: '完成', cls: 'done' };
  return { text: '', cls: '' };
}

function onAiUpdate(list) {
  aiSnapshot = list;
  if (petWindow && !petWindow.isDestroyed()) {
    const st = petStatusOf(list);
    petWindow.webContents.send('pet:status', st);
    if (st.cls !== 'waiting') {
      petWindow.webContents.send('pet:dismiss-reply');
      // 已經不在等了（例如你在 Claude 裡回答了）：放掉還在等的鉤子
      [...pendingPermissions].filter((id) => !pendingReplies.has(id)).forEach((id) => answerPermission(id, 'pass'));
    }
  }
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send('ai:update', list);
  }
}

// 鉤子腳本與桌寵交換資料的資料夾（userData/ai-hooks）
function aiHooksDir() {
  return path.join(app.getPath('userData'), 'ai-hooks');
}

function aiProjects() {
  const list = config.settings.aiProjects;
  return Array.isArray(list) ? list.filter((p) => typeof p === 'string' && p) : [];
}

// 個別指定的 Claude Code 對話：[{ id, title, cwd }]
function aiSessions() {
  const list = config.settings.aiSessions;
  return Array.isArray(list) ? list.filter((s) => s && typeof s.id === 'string' && s.id) : [];
}

// 把指定專案／對話清單寫給鉤子腳本讀（鉤子據此決定要不要記錄事件）
function writeWatchProjects() {
  try {
    fs.mkdirSync(aiHooksDir(), { recursive: true });
    const on = config.settings.aiWatch !== false;
    // answer：允許鉤子等使用者在泡泡上按「允許／拒絕」
    // replyAfterDone：Claude 做完後先等一下，讓使用者可以在泡泡上打字回覆
    const data = {
      projects: on ? aiProjects() : [], sessions: on ? aiSessions().map((s) => s.id) : [],
      answer: on, replyAfterDone: on && config.settings.aiReplyAfterDone !== false
    };
    fs.writeFileSync(path.join(aiHooksDir(), 'watch-projects.json'), JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('寫入監看專案清單失敗:', e.message);
  }
}

function setupAiWatch() {
  if (aiWatcher) { aiWatcher.stop(); aiWatcher = null; }
  writeWatchProjects();
  if (config.settings.aiWatch === false) { onAiUpdate([]); return; }
  aiWatcher = createAiWatcher({
    projects: aiProjects(),
    sessions: aiSessions().map((s) => s.id),
    hookEventsFile: path.join(aiHooksDir(), 'hook-events.jsonl'),
    onEvent: onAiEvent,
    onUpdate: onAiUpdate
  }).start();
  onAiUpdate([]);
}

function aiState() {
  return {
    enabled: !!aiWatcher,
    roots: aiWatcher ? aiWatcher.roots : null,
    watchProjects: aiProjects(),
    watchSessions: aiSessions(),
    hooks: hooksInstaller.status(),
    projects: aiSnapshot
  };
}

function registerIpc() {
  // 桌寵拖曳：依位移移動視窗
  ipcMain.on('pet:move-by', (e, { dx, dy }) => {
    if (!petWindow) return;
    // 一律帶上寬高，避免在非 100% 顯示比例下拖曳時視窗大小漂移
    const b = petWindow.getBounds();
    const size = petExpanded ? PET_BIG : PET_SMALL;
    petWindow.setBounds({ x: Math.round(b.x + dx), y: Math.round(b.y + dy), width: size.width, height: size.height });
  });

  // 泡泡出現／消失 → 展開／收起桌寵視窗
  ipcMain.on('pet:bubble', (e, open) => setPetExpanded(!!open));

  // 點擊桌寵 → 開/關面板
  ipcMain.on('panel:toggle', () => togglePanel());
  ipcMain.on('pet:menu', () => showPetMenu());
  ipcMain.on('pet:compose-open', () => openCompose());
  ipcMain.on('pet:compose-send', (e, { text, targetId }) => { sendCompose(text, targetId); });
  ipcMain.on('claude:focus', () => focusClaudeWindow());
  // 使用者開始在泡泡上打字：請鉤子繼續等
  ipcMain.on('pet:typing', (e, requestId) => {
    if (!pendingReplies.has(requestId)) return;
    try { fs.writeFileSync(path.join(aiHooksDir(), 'permission', requestId + '.hold'), '1'); } catch (err) { /* ignore */ }
  });

  ipcMain.on('pet:choice', (e, { requestId, choice, text }) => {
    permLog(`${requestId} clicked ${choice}`);
    const typed = choice === 'text' ? String(text || '').trim().slice(0, 2000) : '';
    // 做完後的回覆：有打字就交給 Claude 繼續；只是點泡泡確認就放掉鉤子
    if (pendingReplies.delete(requestId)) {
      return answerPermission(requestId, typed ? 'reply' : 'pass', null, typed);
    }
    // Claude 的選擇題：記下這題的答案，還有下一題就繼續問，問完一次回覆
    const st = pendingQuestions.get(requestId);
    if (st) {
      const q = st.questions[st.index];
      // 自己打字的回答直接當成這題的答案（等同 Claude 畫面上的「其他」）
      const label = typed || q.options[Number(String(choice).replace('opt', ''))];
      if (label === undefined) return answerPermission(requestId, 'pass');
      st.answers[q.question] = label;
      st.index += 1;
      if (st.index < st.questions.length) return askNextQuestion(requestId);
      return answerPermission(requestId, 'allow', st.answers);
    }
    // 權限詢問時打字 = 不允許這一步，並把你的話交給 Claude（等同 Claude 畫面上「告訴它改怎麼做」）
    if (typed) return answerPermission(requestId, 'deny', null, typed);
    answerPermission(requestId, choice === 'allow' ? 'allow' : choice === 'deny' ? 'deny' : 'pass');
  });

  // --- 資料夾 ---
  ipcMain.handle('folders:pick', async () => {
    const res = await dialog.showOpenDialog(panelWindow || petWindow, {
      title: '選擇要監看的資料夾',
      properties: ['openDirectory', 'multiSelections']
    });
    if (res.canceled) return config.folders;
    for (const folder of res.filePaths) {
      if (!config.folders.includes(folder)) {
        config.folders.push(folder);
        watchFolder(folder);
      }
    }
    saveConfig();
    return config.folders;
  });

  ipcMain.handle('folders:list', () => config.folders);

  ipcMain.handle('folders:remove', (e, folder) => {
    config.folders = config.folders.filter((f) => f !== folder);
    unwatchFolder(folder);
    saveConfig();
    return config.folders;
  });

  // --- 變更紀錄 ---
  ipcMain.handle('changes:list', () => recentChanges);

  // --- AI 專案 ---
  ipcMain.handle('ai:list', () => aiState());

  // 指定要監看的專案資料夾（只有這些資料夾內的對話會被讀取）
  ipcMain.handle('ai:add-project', async () => {
    const res = await dialog.showOpenDialog(panelWindow, {
      title: '選擇要監看的專案資料夾（Claude Code／Codex 的工作目錄）',
      properties: ['openDirectory', 'multiSelections']
    });
    if (res.canceled) return aiState();
    const set = new Set(aiProjects());
    res.filePaths.forEach((p) => set.add(p));
    config.settings.aiProjects = [...set];
    saveConfig();
    setupAiWatch();
    return aiState();
  });

  // 列出最近的 Claude Code 對話，讓使用者挑選要追蹤哪一段（標題與 Claude 桌面版側欄相同）
  ipcMain.handle('ai:recent-sessions', () => {
    const watched = new Set(aiSessions().map((s) => s.id));
    // 只列近三天用過的對話，太久沒用的不出現
    // 群組、母子關係、封存狀態照 Claude 桌面版側欄（讀不到就退回用資料夾名稱分組）
    let meta = new Map();
    try { meta = desktopSessionMeta(); } catch (e) { /* 沒有桌面版資料 */ }
    const folderName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '其他';
    // 清單只顯示近三天用過的（recent）；更早的（60 天內）只有打字搜尋時才會出現
    const now = Date.now();
    return listClaudeSessions(defaultRoots().claude, { limit: 200, maxAgeMs: 60 * 24 * 3600 * 1000 })
      .filter((s) => !(meta.get(s.id) || {}).archived)
      .map((s) => {
        const m = meta.get(s.id) || {};
        return {
          id: s.id, title: m.title || s.title, cwd: s.cwd, mtime: s.mtime, watched: watched.has(s.id),
          recent: now - s.mtime <= 3 * 24 * 3600 * 1000,
          firstPrompt: s.firstPrompt || '',
          group: m.group || folderName(s.cwd), parentTitle: m.parentTitle || ''
        };
      });
  });

  ipcMain.handle('ai:add-session', (e, s) => {
    if (!s || typeof s.id !== 'string' || !/^[\w-]+$/.test(s.id)) return aiState();
    const list = aiSessions().filter((x) => x.id !== s.id);
    list.push({ id: s.id, title: String(s.title || '').slice(0, 80), cwd: String(s.cwd || '') });
    config.settings.aiSessions = list;
    saveConfig();
    setupAiWatch();
    return aiState();
  });

  ipcMain.handle('ai:remove-session', (e, id) => {
    config.settings.aiSessions = aiSessions().filter((x) => x.id !== id);
    saveConfig();
    setupAiWatch();
    return aiState();
  });

  ipcMain.handle('ai:remove-project', (e, p) => {
    config.settings.aiProjects = aiProjects().filter((x) => x !== p);
    saveConfig();
    setupAiWatch();
    return aiState();
  });

  // 安裝／移除 Claude Code 通知鉤子：會修改使用者層級的 settings.json，因此一律先跳確認視窗
  ipcMain.handle('ai:hooks-install', async () => {
    const file = hooksInstaller.settingsPath();
    const { response } = await dialog.showMessageBox(panelWindow, {
      type: 'question',
      buttons: ['開啟提醒', '先不要'],
      defaultId: 1,
      cancelId: 1,
      title: '開啟即時提醒',
      message: '要讓 Claude 在「需要你允許」和「做完」時，立刻通知桌寵嗎？',
      detail:
        '・不會影響 Claude 的運作，也不會記錄你打的內容或 Claude 的回覆。\n' +
        '・只對你加入追蹤的對話有作用。\n' +
        '・會在 Claude 的設定裡加一小段（會先備份），隨時可以關掉還原。\n\n' +
        `設定檔位置：${file}`
    });
    if (response !== 0) return { ok: false, canceled: true, state: aiState() };
    try {
      writeWatchProjects();
      const r = hooksInstaller.install({
        scriptPath: path.join(__dirname, 'hooks', 'claude-hook.js'),
        dataDir: aiHooksDir()
      });
      return { ok: true, backup: r.backup, state: aiState() };
    } catch (err) {
      return { ok: false, error: err.message, state: aiState() };
    }
  });

  ipcMain.handle('ai:hooks-uninstall', async () => {
    const { response } = await dialog.showMessageBox(panelWindow, {
      type: 'question',
      buttons: ['關閉提醒', '先不要'],
      defaultId: 1,
      cancelId: 1,
      title: '關閉即時提醒',
      message: '要關閉即時提醒嗎？',
      detail: `會把桌面大師加進 Claude 設定檔的那一小段拿掉，其他設定不受影響（先自動備份）。\n\n設定檔位置：${hooksInstaller.settingsPath()}`
    });
    if (response !== 0) return { ok: false, canceled: true, state: aiState() };
    try {
      const r = hooksInstaller.uninstall();
      return { ok: true, removed: r.removed, backup: r.backup, state: aiState() };
    } catch (err) {
      return { ok: false, error: err.message, state: aiState() };
    }
  });

  // --- 設定 ---
  ipcMain.handle('config:get-settings', () => {
    const s = config.settings;
    return {
      provider: s.provider || 'openai',
      apiKey: s.apiKey || '',
      baseUrl: s.baseUrl || '',
      model: s.model || '',
      reminderIntervalMinutes: Number(s.reminderIntervalMinutes) || 30,
      quoteIntervalMinutes: (s.quoteIntervalMinutes === 0 || s.quoteIntervalMinutes === '0')
        ? 0
        : (Number(s.quoteIntervalMinutes) || 20),
      characterId: currentCharacterId(),
      aiWatch: s.aiWatch !== false,
      // 提示 UI：哪些值被環境變數覆蓋
      env: {
        apiKey: !!process.env.OPENAI_API_KEY,
        baseUrl: !!process.env.OPENAI_BASE_URL,
        model: !!process.env.OPENAI_MODEL
      }
    };
  });

  ipcMain.handle('config:save-settings', (e, incoming) => {
    const nextCharacter = CHARACTERS[incoming.characterId]
      ? incoming.characterId
      : currentCharacterId();
    const changedCharacter = nextCharacter !== currentCharacterId();
    config.settings = {
      ...config.settings,
      provider: incoming.provider || 'openai',
      apiKey: incoming.apiKey || '',
      baseUrl: incoming.baseUrl || '',
      model: incoming.model || '',
      reminderIntervalMinutes: Number(incoming.reminderIntervalMinutes) || 30,
      quoteIntervalMinutes: (incoming.quoteIntervalMinutes === 0 || incoming.quoteIntervalMinutes === '0')
        ? 0
        : (Number(incoming.quoteIntervalMinutes) || 20),
      characterId: nextCharacter,
      aiWatch: incoming.aiWatch !== false
    };
    saveConfig();
    setupReminder();
    setupQuoteTimer();
    setupAiWatch();
    if (changedCharacter) setPetCharacter(nextCharacter, true);
    return { ok: true };
  });

  // 切換大師：立即更新桌寵（不需重啟）、持久化、播放問候語
  ipcMain.handle('character:set', (e, id) => {
    if (!CHARACTERS[id]) return { ok: false };
    config.settings.characterId = id;
    saveConfig();
    setPetCharacter(id, true);
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.webContents.send('character:changed', id);
    }
    return { ok: true, id };
  });

  // --- 名言 ---
  ipcMain.handle('quotes:list', (e, id) => {
    const cid = CHARACTERS[id] ? id : currentCharacterId();
    const c = CHARACTERS[cid];
    return {
      id: cid,
      nameZh: c ? c.nameZh : '',
      nameEn: c ? c.nameEn : '',
      quotes: quotesFor(cid)
    };
  });

  ipcMain.handle('quotes:speak', (e, index) => {
    const list = quotesFor(currentCharacterId());
    const q = list[Number(index)];
    if (!q) return { ok: false };
    lastQuoteIndex = Number(index);
    speakQuote(q);
    return { ok: true };
  });

  ipcMain.handle('quotes:speak-random', () => {
    return { ok: speakRandomQuote() };
  });

  ipcMain.handle('shell:open-external', (e, url) => {
    if (typeof url === 'string' && /^https:\/\//i.test(url)) {
      return shell.openExternal(url);
    }
    return false;
  });

  // --- 任務 ---
  ipcMain.handle('tasks:list', () => config.tasks);

  ipcMain.handle('tasks:add', (e, text) => {
    const trimmed = String(text || '').trim();
    if (trimmed) {
      config.tasks.push({
        id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        text: trimmed,
        done: false
      });
      saveConfig();
    }
    return config.tasks;
  });

  ipcMain.handle('tasks:toggle', (e, id) => {
    const t = config.tasks.find((x) => x.id === id);
    if (t) {
      t.done = !t.done;
      saveConfig();
      // 勾選「完成」時（非取消完成）讓大師開心一下
      if (t.done) {
        setPetPose('happy');
        speak('完成一項了，好看。');
      }
    }
    return config.tasks;
  });

  ipcMain.handle('tasks:remove', (e, id) => {
    config.tasks = config.tasks.filter((x) => x.id !== id);
    saveConfig();
    return config.tasks;
  });

  // --- AI 聊天 ---
  ipcMain.handle('chat:send', async (e, { message, withContext }) => {
    const s = effectiveSettings();
    const provider = createProvider(s.provider, s);
    const c = CHARACTERS[currentCharacterId()];
    let userContent = String(message || '');
    if (withContext) {
      userContent =
        `【最近的資料夾變更】\n${changesSummary()}\n\n【使用者訊息】\n${userContent}`;
    }

    // 進入思考姿勢
    setPetPose('think');
    const cat = categoryOf(c.id);
    const systemPrompt =
      `你是「大師」，${cat.persona}。` +
      `此刻你以 ${c.nameZh}（${c.nameEn}）的風格與語氣與使用者對話。` +
      `請一律使用繁體中文，用字精煉、文化而不賣弄，不使用網路流行語或誇張口氣，` +
      `${cat.style}。` +
      `避免逐字引用任何名人名言，以自己的語氣表達即可。`;

    try {
      const reply = await provider.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]);
      // 氣泡只放簡短版，完整內容回面板
      setPetPose('idle');
      speak(reply.length > 60 ? reply.slice(0, 60) + '…' : reply);
      return { ok: true, reply };
    } catch (err) {
      setPetPose('idle');
      speak('抱歉，此刻難以回應。');
      return { ok: false, error: err.message };
    }
  });
}

// ---------------------------------------------------------------------------
// 生命週期
// ---------------------------------------------------------------------------
// 只允許開一個桌寵：重複點捷徑時，改成把面板叫出來
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!panelWindow) return;
    panelWindow.show();
    panelWindow.focus();
  });
}

// 開機自動啟動（未打包時要帶上程式資料夾當參數）
function loginItemOptions() {
  return app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] };
}
function autoStartEnabled() {
  try { return !!app.getLoginItemSettings(loginItemOptions()).openAtLogin; } catch (e) { return false; }
}

// 把 Claude 桌面版的視窗叫到最前面（讓使用者去回覆）。找不到就不做任何事。
function focusClaudeWindow() {
  if (process.platform !== 'win32') return;
  const ps = "$p = Get-Process claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1; " +
    "if ($p) { (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null }";
  try {
    require('child_process').spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps],
      { windowsHide: true, stdio: 'ignore', detached: true }).unref();
  } catch (e) { /* ignore */ }
}

// 桌寵的右鍵選單：所有「桌寵本身」的操作都在這裡，包含結束程式
function showPetMenu() {
  if (!petWindow || petWindow.isDestroyed()) return;
  Menu.buildFromTemplate([
    { label: '打開面板', click: () => { if (!panelWindow.isVisible()) togglePanel(); else panelWindow.focus(); } },
    { label: '✏️ 對 Claude 說話', click: () => openCompose() },
    { label: '說一句名言', click: () => speakRandomQuote() },
    { type: 'separator' },
    {
      label: '開機時自動啟動',
      type: 'checkbox',
      checked: autoStartEnabled(),
      click: (item) => app.setLoginItemSettings(Object.assign({ openAtLogin: item.checked }, loginItemOptions()))
    },
    { type: 'separator' },
    { label: '結束桌面大師', click: () => app.quit() }
  ]).popup({ window: petWindow });
}

app.whenReady().then(() => {
  config = loadConfig();
  // 移除整個應用程式的原生選單（避免出現英文 File/Edit/View... 選單列）
  Menu.setApplicationMenu(null);
  registerIpc();
  createPetWindow();
  createPanelWindow();

  // 還原已設定的監看資料夾
  for (const folder of config.folders) watchFolder(folder);
  setupReminder();
  setupQuoteTimer();
  setupAiWatch();
  touchAlive();
  setInterval(touchAlive, 5000);

  // 第一次使用（還沒追蹤任何對話）：自動打開面板，並由桌寵說明怎麼操作
  if (!config.settings.welcomed && !aiSessions().length && !aiProjects().length) {
    config.settings.welcomed = true;
    saveConfig();
    setTimeout(() => {
      if (!panelWindow.isVisible()) panelWindow.show();
      speak({ text: '點我兩下開面板，右鍵有選單。先按「＋ 加入對話」吧。', duration: 15000 });
    }, 7000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  for (const w of watchers.values()) w.close();
  if (reminderTimer) clearInterval(reminderTimer);
  if (quoteTimer) clearInterval(quoteTimer);
  if (aiWatcher) aiWatcher.stop();
});

// 桌寵常駐，不因關閉面板而退出；全部視窗關閉才退出（Windows/Linux）。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
