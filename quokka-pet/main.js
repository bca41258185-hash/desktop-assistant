// 主行程：負責視窗、IPC、資料夾監看、設定讀寫、提醒、AI 呼叫。
// Main process: windows, IPC, folder watching, config I/O, reminders, AI calls.

const { app, BrowserWindow, ipcMain, dialog, screen, Menu, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const { createProvider } = require('./providers');
const { CHARACTERS, DEFAULT_ID } = require('./renderer/characters');
const QuokkaTraits = require('./renderer/traits');

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
    awayMinutes: 5,                // 多久沒碰鍵盤滑鼠就打盹（0＝關閉）
    characterId: DEFAULT_ID        // 目前選用的造型（目前只有 'quokka'）
  }
};

// 回傳有效且存在的角色 id（避免設定檔殘留無效值）
function currentCharacterId() {
  const id = config && config.settings && config.settings.characterId;
  return CHARACTERS[id] ? id : DEFAULT_ID;
}

// 個體特徵（體型、年齡、毛色…）：第一次啟動時隨機生成並存檔，之後固定；按「重新生成」才會換一隻
function currentTraits() {
  const t = config && config.settings && config.settings.quokkaTraits;
  if (t && t.v === 1 && t.fur) return t;
  config.settings.quokkaTraits = QuokkaTraits.generate();
  saveConfig();
  return config.settings.quokkaTraits;
}
// 舊設定檔可能只有體型沒有個性：補上（由同一個 seed 產生，所以每次補出來都一樣）
function traitsWithPersonality() {
  const t = currentTraits();
  if (!t.personality) { QuokkaTraits.ensurePersonality(t); saveConfig(); }
  return t;
}
function greetingFor(c) {
  const b = QuokkaTraits.behavior(traitsWithPersonality());
  return (b && b.greet) || c.greeting;
}
function traitsInfo() {
  const t = traitsWithPersonality();
  return { traits: t, info: QuokkaTraits.describe(t), personality: QuokkaTraits.describePersonality(t) };
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
      : (Number(s.quoteIntervalMinutes) || 20),
    awayMinutes: minutesOr(s.awayMinutes, 5)
  };
}

// 0 代表關閉；空值或非數字用預設
function minutesOr(v, dflt) {
  if (v === 0 || v === '0') return 0;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
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
    petWindow.webContents.send('pet:character', { id, greeting: greetingFor(c), traits: currentTraits() });
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

// 讓桌寵切換姿勢：'idle' | 'think' | 'happy'，或該角色會的動作（如 'badminton'、'eat'）
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
      greeting: withGreeting && c ? greetingFor(c) : undefined,
      traits: currentTraits()
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
// 游標跟隨：每 120ms 讀一次游標位置，只在靠近桌寵時把「相對位置」送給桌寵
// （不記錄、不保存任何游標軌跡；離開範圍時送最後一次讓牠轉回正面）
// ---------------------------------------------------------------------------
let cursorTimer = null;
let cursorNear = false;
let lastCursorSent = '';
let lastCursorAt = 0;
function setupCursorWatch() {
  if (cursorTimer) clearInterval(cursorTimer);
  cursorTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;
    let p;
    try { p = screen.getCursorScreenPoint(); } catch (e) { return; }
    const b = petWindow.getBounds();
    // 桌寵頭部大約在視窗底部往上 160px、水平置中
    const dx = p.x - (b.x + b.width / 2), dy = p.y - (b.y + b.height - 160);
    const near = Math.hypot(dx, dy) < 600;
    if (!near && !cursorNear) return;
    cursorNear = near;
    const key = `${dx},${dy}`;
    // 游標沒動時每秒仍送一次，讓桌寵能判斷「游標停很久」
    if (key === lastCursorSent && near && Date.now() - lastCursorAt < 1000) return;
    lastCursorSent = key;
    lastCursorAt = Date.now();
    petWindow.webContents.send('pet:cursor', { dx, dy });
  }, 120);
}

// ---------------------------------------------------------------------------
// 離開偵測：用作業系統的「多久沒有鍵盤滑鼠輸入」，不讀取輸入內容
// ---------------------------------------------------------------------------
let awayTimer = null;
let isAway = false;
function setupAwayWatch() {
  if (awayTimer) clearInterval(awayTimer);
  awayTimer = setInterval(() => {
    const mins = effectiveSettings().awayMinutes;
    let idle = 0;
    try { idle = powerMonitor.getSystemIdleTime(); } catch (e) { return; }
    const nowAway = mins > 0 && idle >= mins * 60;
    // 回來的判斷要有新的輸入（閒置秒數歸零附近）
    const back = isAway && idle < 3;
    if ((nowAway && !isAway) || back) {
      isAway = nowAway && !back;
      if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:away', isAway);
    }
  }, 2000);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 丟出去的球：獨立的透明小視窗（滑鼠穿透），主行程用簡單物理算位置
//   重力、地面彈跳（越彈越低）、滾動摩擦、螢幕左右邊與上緣反彈、籃框（框邊＋籃板）碰撞
//   地面＝庫卡腳下那條線（由桌寵傳來），停下後通知桌寵去撿
// ---------------------------------------------------------------------------
const BALL_PX = 44;            // 球視窗大小（球直徑約 26 px，四周留陰影空間）
let ball = null;               // { win, kind, x, y, vx, vy, r, rot, ground, timer, stopped, scored, hoop }
function removeBall(fade) {
  if (!ball) return;
  const b = ball; ball = null;
  clearInterval(b.timer);
  if (b.life) clearTimeout(b.life);
  if (!b.win || b.win.isDestroyed()) return;
  if (fade) { try { b.win.webContents.send('ball:state', { rot: b.rot, fade: true }); } catch (e) {} setTimeout(() => { if (!b.win.isDestroyed()) b.win.destroy(); }, 650); }
  else b.win.destroy();
}
function throwBall({ kind, x, y, vx, vy, ground, r, hoop }) {
  removeBall(false);
  const win = new BrowserWindow({
    width: BALL_PX, height: BALL_PX, x: Math.round(x - BALL_PX / 2), y: Math.round(y - BALL_PX / 2),
    frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'ball-preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'ball.html'), { query: { kind } });
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive(); });
  const wa = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
  ball = { win, kind, x, y, vx, vy, r: r || 13, rot: 0, ground: Math.min(ground, wa.y + wa.height), wa, stopped: false, scored: false, hoop, bounces: 0 };
  const G = 1500, DT = 1 / 60;
  ball.timer = setInterval(() => {
    const b = ball;
    if (!b || b.win.isDestroyed()) return;
    const floor = b.ground - b.r;
    if (!b.stopped) {
      b.vy += G * DT;
      const px = b.x, py = b.y;
      b.x += b.vx * DT; b.y += b.vy * DT;
      // 籃框：兩個框邊當小圓點碰撞，籃板當直線；球從框中間往下穿過＝進球
      if (b.hoop) {
        const H = b.hoop;
        for (const rx of [H.left, H.right]) {
          const dx = b.x - rx, dy = b.y - H.y, d = Math.hypot(dx, dy), min = b.r + 2;
          if (d < min && d > 0) {
            const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
            if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vy -= 1.6 * vn * ny; b.x = rx + nx * min; b.y = H.y + ny * min; }
          }
        }
        if (b.x - b.r < H.board && b.x > H.board - 30 && b.y > H.boardTop && b.y < H.boardBottom && b.vx < 0) { b.vx = -b.vx * .55; b.x = H.board + b.r; }
        if (!b.scored && py < H.y && b.y >= H.y && b.x > H.left + 3 && b.x < H.right - 3 && b.vy > 0) {
          b.scored = true; b.vx *= .3;
          if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('ball:event', { type: 'score' });
        }
      }
      // 螢幕邊界
      if (b.x - b.r < b.wa.x) { b.x = b.wa.x + b.r; b.vx = Math.abs(b.vx) * .6; }
      if (b.x + b.r > b.wa.x + b.wa.width) { b.x = b.wa.x + b.wa.width - b.r; b.vx = -Math.abs(b.vx) * .6; }
      if (b.y - b.r < b.wa.y) { b.y = b.wa.y + b.r; b.vy = Math.abs(b.vy) * .5; }
      // 地面：彈跳越來越低，太低就改成滾動
      if (b.y > floor) {
        b.y = floor;
        if (Math.abs(b.vy) > 140) { b.vy = -b.vy * (b.kind === 'bball' ? .62 : .5); b.vx *= .88; b.bounces++; }
        else { b.vy = 0; b.vx *= Math.pow(.2, DT); if (Math.abs(b.vx) < 10) { b.vx = 0; b.stopped = true; } }
      }
      b.rot += (b.x - px) / b.r * 57.3;
      if (b.stopped && petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('ball:event', { type: 'landed', x: b.x, y: b.y });
    }
    b.win.setPosition(Math.round(b.x - BALL_PX / 2), Math.round(b.y - BALL_PX / 2));
    try { b.win.webContents.send('ball:state', { rot: b.rot }); } catch (e) {}
  }, 1000 / 60);
  // 安全網：40 秒內沒被撿走就自己淡出
  ball.life = setTimeout(() => {
    removeBall(true);
    if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('ball:event', { type: 'gone' });
  }, 40000);
}

function registerIpc() {
  ipcMain.on('ball:throw', (e, p) => { if (p && isFinite(p.x) && isFinite(p.y)) throwBall(p); });
  ipcMain.on('ball:pickup', () => removeBall(false));
  ipcMain.on('ball:remove', () => removeBall(true));

  // 桌寵拖曳／甩出：依位移移動視窗，並限制在所在螢幕的工作區內（甩出去不會飛出螢幕）
  ipcMain.on('pet:move-by', (e, { dx, dy }) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const b = petWindow.getBounds();
    const nx = Math.round(b.x + (Number(dx) || 0)), ny = Math.round(b.y + (Number(dy) || 0));
    const wa = screen.getDisplayNearestPoint({ x: nx + b.width / 2, y: ny + b.height / 2 }).workArea;
    const cx = Math.min(Math.max(nx, wa.x - b.width * 0.3), wa.x + wa.width - b.width * 0.7);
    const cy = Math.min(Math.max(ny, wa.y - b.height * 0.5), wa.y + wa.height - b.height);
    petWindow.setPosition(Math.round(cx), Math.round(cy));
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
      awayMinutes: minutesOr(s.awayMinutes, 5),
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
      awayMinutes: minutesOr(incoming.awayMinutes, 5),
      characterId: nextCharacter
    };
    saveConfig();
    setupReminder();
    setupQuoteTimer();
    if (changedCharacter) setPetCharacter(nextCharacter, true);
    return { ok: true };
  });

  // 切換造型：立即更新桌寵（不需重啟）、持久化、播放問候語
  ipcMain.handle('quokka:traits', () => traitsInfo());
  ipcMain.handle('quokka:regenerate', () => {
    config.settings.quokkaTraits = QuokkaTraits.generate();
    saveConfig();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:character', { id: currentCharacterId(), traits: currentTraits(), greeting: greetingFor(CHARACTERS[currentCharacterId()]) });
    }
    return traitsInfo();
  });

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

  // 讓目前角色做一個動作（球類或招牌動作，僅限該角色 actions 清單內的項目）
  ipcMain.handle('pet:play-action', (e, action) => {
    const c = CHARACTERS[currentCharacterId()];
    if (!c || !Array.isArray(c.actions) || !c.actions.includes(action)) return { ok: false };
    setPetPose(action);
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
    const systemPrompt = c.persona + '\n' + QuokkaTraits.personaText(traitsWithPersonality());

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
// ---------------------------------------------------------------------------
// v2 舞台模式（開發中，QUOKKA_STAGE=1 才啟用）：所有庫卡在一個透明舞台圖層裡散步
// 資料存在 config-v2.json（第一次從 config.json 遷移），完成前不影響舊版
// ---------------------------------------------------------------------------
function startStageMode() {
  const { createStore } = require('./lib/store');
  const { createStageManager } = require('./lib/stage-main');
  const file = path.join(app.getPath('userData'), 'config-v2.json');
  const store = createStore(file);
  if (!fs.existsSync(file) && fs.existsSync(configPath())) { try { fs.copyFileSync(configPath(), file); } catch (e) {} }
  const data = store.load();
  // 至少一隻；開發測試可用 QUOKKA_DEMO=n 補到 n 隻
  const names = ['庫卡', '工地鼠', '股票鼠', '小助理', '資料夾鼠', '阿跳', '小麥', '團團'];
  const want = Math.max(1, Number(process.env.QUOKKA_DEMO) || 1);
  while (data.quokkas.length < want) {
    const i = data.quokkas.length;
    data.quokkas.push({ id: 'q' + (i + 1) + Date.now().toString(36), name: names[i % names.length] + (i >= names.length ? i : ''), traits: QuokkaTraits.generate(), pos: null, createdAt: new Date().toISOString() });
  }
  data.quokkas.forEach((q) => { if (!q.traits) q.traits = QuokkaTraits.generate(); QuokkaTraits.ensurePersonality(q.traits); });
  store.saveNow();
  const stage = createStageManager({ BrowserWindow, screen, ipcMain, path, dir: __dirname });
  ipcMain.on('stage:ready', (e) => e.sender.send('stage:quokkas', data.quokkas));
  ipcMain.on('stage:save-pos', (e, { id, pos }) => {
    const q = data.quokkas.find((x) => x.id === id);
    if (q && pos && isFinite(pos.x) && isFinite(pos.y)) { q.pos = { x: Math.round(pos.x), y: Math.round(pos.y) }; store.save(); }
  });
  stage.start();
  return { store, stage };
}

app.whenReady().then(() => {
  if (process.env.QUOKKA_STAGE === '1') { Menu.setApplicationMenu(null); global.v2 = startStageMode(); return; }
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
  setupCursorWatch();
  setupAwayWatch();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  for (const w of watchers.values()) w.close();
  if (reminderTimer) clearInterval(reminderTimer);
  if (quoteTimer) clearInterval(quoteTimer);
  if (cursorTimer) clearInterval(cursorTimer);
  if (awayTimer) clearInterval(awayTimer);
});

// 桌寵常駐，不因關閉面板而退出；全部視窗關閉才退出（Windows/Linux）。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
