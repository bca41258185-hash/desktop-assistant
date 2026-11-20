// 主行程：負責視窗、IPC、資料夾監看、設定讀寫、提醒、AI 呼叫。
// Main process: windows, IPC, folder watching, config I/O, reminders, AI calls.

const { app, BrowserWindow, ipcMain, dialog, screen, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const { createProvider } = require('./providers');
const { createAiWatcher } = require('./ai-watch');
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
    aiWatch: true                  // 監看 Claude Code / Codex 對話進度（唯讀）
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
function createPetWindow() {
  petWindow = new BrowserWindow({
    width: 250,
    height: 400,
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
    workArea.x + workArea.width - 270,
    workArea.y + workArea.height - 420
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

function clip(text, n) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function onAiEvent({ kind, session: s }) {
  const key = s.id + ':' + kind;
  const t = Date.now();
  if (t - (aiLastBubble.get(key) || 0) < 4000) return;
  aiLastBubble.set(key, t);

  if (kind === 'start') {
    setPetPose('think');
    speak(`${s.label} 開始處理「${s.projectName}」：${clip(s.lastPrompt, 26)}`);
  } else if (kind === 'waiting') {
    setPetPose('idle');
    speak(`「${s.projectName}」的 ${s.label} 可能在等你確認（或指令執行較久）`);
  } else if (kind === 'done') {
    if (s.interrupted) {
      setPetPose('idle');
      speak(`「${s.projectName}」的 ${s.label} 已中斷`);
    } else {
      setPetPose('happy');
      speak(`「${s.projectName}」完成了：${clip(s.lastText, 30) || s.lastAction}`);
    }
  }
}

function onAiUpdate(list) {
  aiSnapshot = list;
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send('ai:update', list);
  }
}

function setupAiWatch() {
  const want = config.settings.aiWatch !== false;
  if (want && !aiWatcher) {
    aiWatcher = createAiWatcher({ onEvent: onAiEvent, onUpdate: onAiUpdate }).start();
  } else if (!want && aiWatcher) {
    aiWatcher.stop();
    aiWatcher = null;
    onAiUpdate([]);
  }
}

function registerIpc() {
  // 桌寵拖曳：依位移移動視窗
  ipcMain.on('pet:move-by', (e, { dx, dy }) => {
    if (!petWindow) return;
    const [x, y] = petWindow.getPosition();
    petWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
  });

  // 點擊桌寵 → 開/關面板
  ipcMain.on('panel:toggle', () => togglePanel());

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
  ipcMain.handle('ai:list', () => ({
    enabled: !!aiWatcher,
    roots: aiWatcher ? aiWatcher.roots : null,
    projects: aiSnapshot
  }));

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
