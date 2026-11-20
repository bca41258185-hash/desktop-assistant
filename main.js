// 主行程：負責視窗、IPC、資料夾監看、設定讀寫、提醒、AI 呼叫。
// Main process: windows, IPC, folder watching, config I/O, reminders, AI calls.

const { app, BrowserWindow, ipcMain, dialog, screen, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const { createProvider } = require('./providers');
const { CHARACTERS, DEFAULT_ID } = require('./renderer/characters');

let petWindow = null;
let panelWindow = null;
const watchers = new Map();      // folderPath -> chokidar watcher
let recentChanges = [];          // { path, name, type, time }
let reminderTimer = null;
let config = null;

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
    characterId: DEFAULT_ID        // 目前選用的大師（'ando' | 'gehry' | ...）
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
    reminderIntervalMinutes: Number(s.reminderIntervalMinutes) || 30
  };
}

// ---------------------------------------------------------------------------
// 視窗
// ---------------------------------------------------------------------------
function createPetWindow() {
  petWindow = new BrowserWindow({
    width: 240,
    height: 340,
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
    workArea.x + workArea.width - 260,
    workArea.y + workArea.height - 360
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
      characterId: nextCharacter
    };
    saveConfig();
    setupReminder();
    if (changedCharacter) setPetCharacter(nextCharacter, true);
    return { ok: true };
  });

  // 切換大師：立即更新桌寵（不需重啟）、持久化、播放問候語
  ipcMain.handle('character:set', (e, id) => {
    if (!CHARACTERS[id]) return { ok: false };
    config.settings.characterId = id;
    saveConfig();
    setPetCharacter(id, true);
    return { ok: true, id };
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
    const systemPrompt =
      `你是「大師」，一位沉穩、有涵養的建築工作室導師。` +
      `此刻你以 ${c.nameZh}（${c.nameEn}）的風格與語氣與使用者對話。` +
      `請一律使用繁體中文，用字精煉、文化而不賣弄，不使用網路流行語或誇張口氣，` +
      `像一位受人敬重的建築前輩，給予簡潔、到位而帶有工作室氣息的回應。` +
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  for (const w of watchers.values()) w.close();
  if (reminderTimer) clearInterval(reminderTimer);
});

// 桌寵常駐，不因關閉面板而退出；全部視窗關閉才退出（Windows/Linux）。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
