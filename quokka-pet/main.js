// 主行程：負責視窗、IPC、資料夾監看、設定讀寫、提醒、AI 呼叫。
// Main process: windows, IPC, folder watching, config I/O, reminders, AI calls.

const { app, BrowserWindow, ipcMain, dialog, screen, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const { createProvider } = require('./providers');
const { CHARACTERS, DEFAULT_ID } = require('./renderer/characters');

function loadQuotes() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'quotes.json'), 'utf-8'));
    const list = Array.isArray(raw) ? raw : (raw.quotes || []);
    const map = {};
    for (const q of list) {
      if (!q || !q.id || !q.zh) continue;
      if (!map[q.id]) map[q.id] = [];
      map[q.id].push(q);
    }
    return map;
  } catch (e) {
    console.error('載入名言失敗:', e.message);
    return {};
  }
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
    characterId: DEFAULT_ID        // 目前選用的造型（目前只有 'quokka'）
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

  // 載入完成後，告知桌寵目前的造型並顯示問候語
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
    title: '庫卡的休息室',
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

// 讓桌寵切換姿勢：'idle' | 'think' | 'happy'，或該角色會的運動（如 'badminton'）
function setPetPose(pose) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:pose', pose);
  }
}

// 切換桌寵造型並播放問候語
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
// 語錄：庫卡的原創打氣語與生態小知識（與問候語分開）
// ---------------------------------------------------------------------------
function quotesFor(id) {
  return QUOTES_BY_ID[id] || [];
}

function speakQuote(quote) {
  if (!quote || !quote.zh) return false;
  const c = CHARACTERS[quote.id] || CHARACTERS[currentCharacterId()];
  const name = c ? (c.callName || c.nameZh) : '';
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
      characterId: nextCharacter
    };
    saveConfig();
    setupReminder();
    setupQuoteTimer();
    if (changedCharacter) setPetCharacter(nextCharacter, true);
    return { ok: true };
  });

  // 切換造型：立即更新桌寵（不需重啟）、持久化、播放問候語
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

  // 讓目前角色打一項球（僅限該角色 sports 清單內的項目）
  ipcMain.handle('pet:play-sport', (e, sport) => {
    const c = CHARACTERS[currentCharacterId()];
    if (!c || !Array.isArray(c.sports) || !c.sports.includes(sport)) return { ok: false };
    setPetPose(sport);
    return { ok: true };
  });

  // --- 名言 ---
  ipcMain.handle('quotes:list', (e, id) => {
    const cid = CHARACTERS[id] ? id : currentCharacterId();
    const c = CHARACTERS[cid];
    return {
      id: cid,
      nameZh: c ? c.nameZh : '',
      nameEn: c ? c.nameEn : '',
      title: (c && c.quoteTitle) || '語錄',
      hint: (c && c.quoteHint) || '',
      speakLabel: (c && c.speakLabel) || '說這句',
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
      // 勾選「完成」時（非取消完成）讓桌寵開心一下
      if (t.done) {
        setPetPose('happy');
        const c = CHARACTERS[currentCharacterId()];
        speak((c && c.cheer) || '完成一項！');
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
    const systemPrompt = c.persona;

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
      speak('啊，這球沒接到……等等再試一次。');
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  for (const w of watchers.values()) w.close();
  if (reminderTimer) clearInterval(reminderTimer);
  if (quoteTimer) clearInterval(quoteTimer);
});

// 桌寵常駐，不因關閉面板而退出；全部視窗關閉才退出（Windows/Linux）。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
