// 主行程 v2（規格第 1–4、7 節）：唯一的資料來源與排程中心
//   Store、Router（事件交給負責的那隻）、ReminderClock、StockService、FolderWatch、PresenceWatch、
//   StageManager（舞台圖層）、面板、右鍵選單、系統通知
// 面板與舞台之間不直接溝通；所有修改經這裡驗證後寫入，再廣播完整快照給面板、必要的事件給舞台。
const { app, BrowserWindow, ipcMain, dialog, screen, Menu, Notification, powerMonitor, net } = require('electron');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const { createStore, newId, LIMITS } = require('./store');
const { parseInput } = require('./parse-input');
const R = require('./reminders');
const { createStockService } = require('./stock-service');
const { createStepTracker } = require('./stock-step');
const { createStageManager } = require('./stage-main');
const TR = require('../renderer/traits');

const ROOT = path.join(__dirname, '..');
const KINDS = { task: 'tasks', reminder: 'reminders', stock: 'stocks', folder: 'folders' };
const ACTIONS = new Set(['badminton', 'volleyball', 'basketball', 'eat', 'hop', 'nap']);
const NAMES = ['庫卡', '工地鼠', '股票鼠', '小助理', '資料夾鼠', '阿跳', '小麥', '團團'];

function start() {
  // ---- 資料：正式切換（config-v2.json → config.json，規格第 2.1 節）----------------
  const dir = app.getPath('userData');
  const file = path.join(dir, 'config.json'), v2file = path.join(dir, 'config-v2.json');
  try {
    if (fs.existsSync(v2file)) {
      const bak = path.join(dir, 'config.v1.bak.json');
      if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
      fs.renameSync(v2file, file);
    }
  } catch (e) { console.error('切換設定檔失敗:', e.message); }
  const store = createStore(file);
  const data = store.load();
  const want = Math.max(1, Number(process.env.QUOKKA_DEMO) || 1);       // 開發測試：補到 n 隻
  while (data.quokkas.length < want) {
    const i = data.quokkas.length;
    data.quokkas.push({ id: 'q' + (i + 1) + Date.now().toString(36), name: uniqueName(NAMES[i % NAMES.length]), traits: TR.generate(), home: null, createdAt: new Date().toISOString() });
  }
  data.quokkas.forEach((q) => {
    if (!q.traits) q.traits = TR.generate();
    TR.ensurePersonality(q.traits); TR.ensureAccessory(q.traits);
    if (!q.home && q.pos) { q.home = q.pos; delete q.pos; }
  });
  data.settings.defaultOwner = data.settings.defaultOwner && qById(data.settings.defaultOwner) ? data.settings.defaultOwner : data.quokkas[0].id;
  store.saveNow();

  function qById(id) { return data.quokkas.find((q) => q.id === id); }
  function uniqueName(base) {
    let n = String(base || '').trim().slice(0, LIMITS.name) || '庫卡', i = 2;
    const taken = (x) => data.quokkas.some((q) => q.name === x);
    let out = n; while (taken(out)) out = `${n}${i++}`;
    return out;
  }
  const ownerOf = (o) => (qById(o) ? o : data.settings.defaultOwner);
  const nowISO = () => new Date().toISOString();

  // ---- 舞台與面板 ---------------------------------------------------------------
  const stage = createStageManager({ BrowserWindow, screen, ipcMain, path, dir: ROOT });
  const toStage = (ch, payload) => stage.send(ch, payload);
  const stageQ = (q) => ({ id: q.id, name: q.name, traits: q.traits, pos: q.home || null, stage: q.stage || 'adult' });
  let panel = null;
  function createPanel() {
    panel = new BrowserWindow({
      width: 400, height: 720, show: false, title: '庫卡助理', backgroundColor: '#f6efe3', autoHideMenuBar: true,
      webPreferences: { preload: path.join(ROOT, 'panel-preload.js'), contextIsolation: true, nodeIntegration: false }
    });
    panel.loadFile(path.join(ROOT, 'renderer', 'panel.html'));
    panel.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); panel.hide(); } });
  }
  function showPanel(qid) {
    if (!panel || panel.isDestroyed()) createPanel();
    const go = () => { panel.show(); panel.focus(); if (qid) panel.webContents.send('panel:select', { qid }); };
    if (panel.webContents.isLoading()) panel.webContents.once('did-finish-load', go); else go();
  }
  const quotes = {};                 // symbol → 最新報價
  function snapshot() {
    return { quokkas: data.quokkas, tasks: data.tasks, reminders: data.reminders, stocks: data.stocks, folders: data.folders,
      relations: data.relations, settings: data.settings, quotes, ringing: data.reminders.filter((r) => r.ringing).map((r) => r.id) };
  }
  function changed({ quokkas = false } = {}) {
    store.save();
    if (panel && !panel.isDestroyed()) panel.webContents.send('store:changed', snapshot());
    if (quokkas) toStage('stage:quokkas', data.quokkas.map(stageQ));
  }
  const event = (qid, kind, payload) => { if (qById(qid)) toStage('q:event', { qid, kind, payload, prio: 2 }); };

  // ---- 提醒（ReminderClock） ------------------------------------------------------
  const clock = R.createScheduler({
    getReminders: () => data.reminders,
    onFire: (due) => {
      const now = new Date(), missed = {};
      for (const { rem, missed: m } of due) {
        R.markFired(rem, now);
        if (m) { (missed[rem.owner] = missed[rem.owner] || []).push(rem.text); continue; }
        rem.ringing = true;
        toStage('q:alert', { qid: rem.owner, reminderId: rem.id, text: rem.text, speak: !!data.settings.reminderVoice });
        notify(qById(rem.owner), `⏰ ${rem.text}`, rem.owner);
      }
      for (const [qid, items] of Object.entries(missed)) event(qid, 'missed', { items });
      changed();
    }
  });
  function notify(q, body, qid) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: q ? q.name : '庫卡助理', body, silent: false });
    n.on('click', () => showPanel(qid));
    n.show();
  }
  powerMonitor.on('resume', () => clock.check());
  powerMonitor.on('unlock-screen', () => clock.check());

  // ---- 股價（StockService ＋ 跨門檻） ----------------------------------------------
  const steps = createStepTracker({ stepPct: data.settings.stockStepPct || 1 });
  const stocks = createStockService({
    fetch: (url, opt) => net.fetch(url, opt),                 // Electron 的 net 會走系統代理（公司網路）
    onUpdate: (u) => {
      quotes[u.symbol] = { price: u.price, pct: u.pct, stale: !!u.stale, recovered: !!u.recovered, name: u.name, time: u.time, market: u.market };
      if (panel && !panel.isDestroyed()) panel.webContents.send('stock:tick', { symbol: u.symbol, market: u.market, ...quotes[u.symbol] });
      if (u.stale || !isFinite(u.pct)) return;
      if (u.recovered) steps._state.delete(u.symbol);          // 斷線恢復：重新當基準
      const r = steps.update(u.symbol, { pct: u.pct, day: u.day, market: u.market });
      if (!r) return;
      const owners = new Set(data.stocks.filter((s) => s.symbol === u.symbol).map((s) => s.owner));
      for (const qid of owners) event(qid, 'stock', { symbol: u.symbol, name: u.name || u.symbol, pct: u.pct, dir: r.dir, limit: r.limit });
    }
  });
  function syncWatchlist() {
    const by = {};
    for (const s of data.stocks) (by[s.owner] = by[s.owner] || []).push({ symbol: s.symbol, market: s.market, ex: s.ex });
    for (const q of data.quokkas) stocks.setWatchlist(by[q.id] || [], q.id);
  }

  // ---- 資料夾監看（FolderWatch，唯讀） ---------------------------------------------
  const watchers = new Map();   // folder id → { w, timer, count }
  function watchFolder(f) {
    if (watchers.has(f.id)) return;
    if (!fs.existsSync(f.path)) { f.status = 'missing'; return; }
    f.status = 'ok';
    const st = { count: 0, timer: null };
    st.w = chokidar.watch(f.path, { ignoreInitial: true, depth: 4, ignored: /(^|[\/\\])\../, awaitWriteFinish: { stabilityThreshold: 800 } });
    const bump = () => {
      st.count++;
      if (st.timer) return;
      st.timer = setTimeout(() => {           // 5 秒內的變動合併成一次
        const cur = data.folders.find((x) => x.id === f.id);
        if (cur) {
          event(cur.owner, 'folder', { name: path.basename(cur.path), count: st.count });
          if (panel && !panel.isDestroyed()) panel.webContents.send('folder:changes', { id: cur.id, count: st.count, at: nowISO() });
        }
        st.count = 0; st.timer = null;
      }, 5000);
    };
    st.w.on('all', bump).on('error', () => { f.status = 'error'; changed(); });
    watchers.set(f.id, st);
  }
  function unwatchFolder(id) { const st = watchers.get(id); if (st) { st.w.close(); clearTimeout(st.timer); watchers.delete(id); } }

  // ---- 離開偵測（PresenceWatch） --------------------------------------------------
  let away = false;
  const digest = {};                    // 離開期間各隻的待報告事項（給回來時報告）
  setInterval(() => {
    const mins = Number(data.settings.awayMinutes) || 0;
    const idle = powerMonitor.getSystemIdleTime();
    const nowAway = mins > 0 && idle >= mins * 60;
    if (nowAway === away) return;
    away = nowAway;
    stage.pause(away);
    toStage('presence', { away, digest: away ? null : digest });
    if (!away) for (const k of Object.keys(digest)) delete digest[k];
  }, 5000);
  powerMonitor.on('lock-screen', () => { stage.pause(true); toStage('presence', { away: true, locked: true }); });

  // ---- 面板 → 主行程 ---------------------------------------------------------------
  const str = (v, n = LIMITS.text) => String(v == null ? '' : v).trim().slice(0, n);
  const findItem = (kind, id) => (KINDS[kind] ? data[KINDS[kind]].find((x) => x.id === id) : null);
  const countOf = (kind, owner) => data[KINDS[kind]].filter((x) => x.owner === owner).length;
  const LIM = { task: LIMITS.tasksPerQuokka, reminder: LIMITS.remindersPerQuokka, stock: LIMITS.stocksPerQuokka, folder: 50 };
  const undoBox = new Map();

  ipcMain.handle('state:get', () => snapshot());
  ipcMain.handle('item:add', async (e, p = {}) => {
    const text = str(p.text), owner = ownerOf(p.owner);
    if (!text) return { ok: false, message: '請先輸入內容' };
    // 貼上一個存在的資料夾路徑 → 監看資料夾
    if (!p.forceType && /[\\/]/.test(text)) {
      try { if (fs.statSync(text).isDirectory()) return addFolder(text, owner); } catch (err) { /* 不是路徑就當一般文字 */ }
    }
    let r = parseInput(text);
    if (p.forceType === 'task') r = { type: 'task', text };
    if (r.type === 'none') return { ok: false, message: '請先輸入內容' };
    if (countOf(r.type, owner) >= (LIM[r.type] || 50)) return { ok: false, message: '這隻盯的東西太多了，先完成或交給別隻吧' };
    if (r.type === 'stock') {
      if (data.stocks.some((s) => s.owner === owner && s.symbol === r.symbol)) return { ok: false, message: '這檔已經在盯了' };
      const found = await stocks.lookup(r.symbol, r.market);
      if (!found.ok) return { ok: false, type: 'stock', message: (found.reason || '找不到這檔股票') + '。要當成待辦嗎？', askTask: true };
      const item = { id: newId('s'), owner, symbol: found.symbol, market: found.market, name: found.name, ex: found.ex, createdAt: nowISO() };
      data.stocks.push(item); syncWatchlist(); changed();
      event(owner, 'note', { text: `好，我幫你盯 ${found.name}！` });
      return { ok: true, type: 'stock', item };
    }
    if (r.type === 'reminder') {
      const item = { id: newId('r'), owner, text: str(r.text), rule: r.rule, enabled: true, createdAt: nowISO() };
      data.reminders.push(item); clock.schedule(); changed();
      event(owner, 'task-added', { text: item.text });
      return { ok: true, type: 'reminder', item, message: r.movedToTomorrow ? '今天已過，改明天' : undefined };
    }
    const item = { id: newId('t'), owner, text: r.text, done: false, createdAt: nowISO(), order: data.tasks.length };
    data.tasks.push(item); changed();
    event(owner, 'task-added', { text: item.text });
    return { ok: true, type: 'task', item };
  });
  function addFolder(p, owner) {
    if (data.folders.some((f) => f.path === p)) return { ok: false, message: '這個資料夾已經在監看了' };
    const f = { id: newId('f'), owner, path: p, status: 'ok', createdAt: nowISO() };
    data.folders.push(f); watchFolder(f); changed();
    event(owner, 'note', { text: `我會幫你看著「${path.basename(p)}」` });
    return { ok: true, type: 'folder', item: f };
  }
  ipcMain.handle('item:update', (e, { kind, id, patch } = {}) => {
    const it = findItem(kind, id);
    if (!it || !patch || typeof patch !== 'object') return { ok: false };
    if (kind === 'task') {
      if ('text' in patch && str(patch.text)) it.text = str(patch.text);
      if ('done' in patch) {
        const was = it.done; it.done = !!patch.done; it.doneAt = it.done ? nowISO() : null;
        if (it.done && !was) event(it.owner, 'task-done', { text: it.text, allDone: !data.tasks.some((t) => t.owner === it.owner && !t.done) });
      }
    } else if (kind === 'reminder') {
      if ('text' in patch && str(patch.text)) it.text = str(patch.text);
      if ('enabled' in patch) { it.enabled = !!patch.enabled; if (!it.enabled && it.ringing) clearAlert(it); }
      clock.schedule();
    }
    changed();
    return { ok: true };
  });
  ipcMain.handle('item:remove', (e, { kind, id } = {}) => {
    const list = data[KINDS[kind]]; if (!list) return { ok: false };
    const i = list.findIndex((x) => x.id === id); if (i < 0) return { ok: false };
    const [it] = list.splice(i, 1);
    if (kind === 'folder') unwatchFolder(it.id);
    if (kind === 'stock') syncWatchlist();
    if (kind === 'reminder') { if (it.ringing) clearAlert(it); clock.schedule(); }
    const token = newId('u'); undoBox.set(token, { kind, it, i });
    setTimeout(() => undoBox.delete(token), 5000);           // 5 秒內可以復原
    changed();
    return { ok: true, undoToken: token };
  });
  ipcMain.handle('item:undo', (e, token) => {
    const u = undoBox.get(token); if (!u) return { ok: false };
    undoBox.delete(token);
    const list = data[KINDS[u.kind]];
    if (!qById(u.it.owner)) u.it.owner = data.settings.defaultOwner;
    list.splice(Math.min(u.i, list.length), 0, u.it);
    if (u.kind === 'folder') watchFolder(u.it);
    if (u.kind === 'stock') syncWatchlist();
    if (u.kind === 'reminder') clock.schedule();
    changed();
    return { ok: true };
  });
  ipcMain.handle('item:reassign', (e, { kind, id, owner } = {}) => {
    const it = findItem(kind, id); if (!it || !qById(owner)) return { ok: false };
    if (it.ringing) clearAlert(it);
    it.owner = owner;
    if (kind === 'stock') syncWatchlist();
    changed();
    event(owner, 'task-added', { text: it.text || it.name || path.basename(it.path || '') });
    return { ok: true };
  });

  // ---- 庫卡：新增、改名、重新生成、換飾品、刪除、陪我玩 ------------------------------
  ipcMain.handle('quokka:create', (e, { name, traits } = {}) => {
    const nm = str(name, LIMITS.name);
    if (!nm) return { ok: false, message: '幫牠取個名字吧' };
    if (data.quokkas.some((q) => q.name === nm)) return { ok: false, message: '已經有同名的庫卡了' };
    // 不直接信任面板傳來的特徵：用同一個 seed 在主行程重新生成（保證格式正確）
    const seed = traits && Number.isFinite(traits.seed) ? traits.seed : undefined;
    const t = TR.generate(seed); TR.ensurePersonality(t); TR.ensureAccessory(t);
    const q = { id: newId('q'), name: nm, traits: t, home: null, stage: 'adult', createdAt: nowISO() };
    data.quokkas.push(q); changed({ quokkas: true });
    return { ok: true, qid: q.id };
  });
  ipcMain.handle('quokka:rename', (e, { qid, name } = {}) => {
    const q = qById(qid), nm = str(name, LIMITS.name);
    if (!q || !nm) return { ok: false, message: '名字不能空白' };
    if (data.quokkas.some((x) => x !== q && x.name === nm)) return { ok: false, message: '已經有同名的庫卡了' };
    q.name = nm; changed({ quokkas: true });
    return { ok: true };
  });
  const familyLock = (q) => q.mom || q.dad || q.pregnancy || q.joey || Object.entries(data.relations || {}).some(([k, v]) => v && v.couple && k.split('|').includes(q.id));
  ipcMain.handle('quokka:regenerate', (e, { qid } = {}) => {
    const q = qById(qid); if (!q) return { ok: false };
    if (familyLock(q)) return { ok: false, message: '牠有家人或伴侶，不能重新生成（可以換飾品）' };
    const t = TR.generate(); TR.ensurePersonality(t); TR.ensureAccessory(t);
    q.traits = t; changed({ quokkas: true });
    return { ok: true };
  });
  ipcMain.handle('quokka:set-accessory', (e, { qid, accessory } = {}) => {
    const q = qById(qid); if (!q || !accessory) return { ok: false };
    const ok = (a) => a && TR.ACCESSORIES.some((x) => (x.id || x) === a.type);
    if (accessory.type !== 'none' && !ok(accessory)) return { ok: false, message: '沒有這種飾品' };
    const color = /^#[0-9a-fA-F]{6}$/.test(accessory.color || '') ? accessory.color : undefined;
    const extra = ok(accessory.extra) ? { type: accessory.extra.type, color: /^#[0-9a-fA-F]{6}$/.test(accessory.extra.color || '') ? accessory.extra.color : undefined } : undefined;
    q.traits.accessory = { type: accessory.type, color, ...(extra ? { extra } : {}) };
    if (accessory.type === 'band' && color) q.traits.band = color;
    changed({ quokkas: true });
    return { ok: true };
  });
  ipcMain.handle('quokka:delete', (e, { qid, transferTo } = {}) => {
    const q = qById(qid); if (!q) return { ok: false };
    if (data.quokkas.length <= 1) return { ok: false, message: '最後一隻不能刪除' };
    const to = transferTo === 'delete' ? null : qById(transferTo) && transferTo !== qid ? transferTo : data.quokkas.find((x) => x.id !== qid).id;
    for (const k of Object.values(KINDS)) {
      if (to) data[k].forEach((x) => { if (x.owner === qid) x.owner = to; });
      else { data[k].filter((x) => x.owner === qid && k === 'folders').forEach((f) => unwatchFolder(f.id)); data[k] = data[k].filter((x) => x.owner !== qid); }
    }
    for (const key of Object.keys(data.relations || {})) if (key.split('|').includes(qid)) delete data.relations[key];
    data.lineage = data.lineage || {};
    data.lineage[qid] = { name: q.name, sex: q.traits.sex, mom: q.mom || null, dad: q.dad || null, deletedAt: nowISO() };
    data.quokkas = data.quokkas.filter((x) => x.id !== qid);
    if (data.settings.defaultOwner === qid) data.settings.defaultOwner = data.quokkas[0].id;
    syncWatchlist(); clock.schedule(); changed({ quokkas: true });
    return { ok: true };
  });
  ipcMain.handle('quokka:play', (e, { qid, action } = {}) => {
    const q = qById(qid) || data.quokkas[0];
    if (!ACTIONS.has(action)) return { ok: false };
    toStage('q:play', { qid: q.id, action });
    return { ok: true };
  });
  ipcMain.handle('settings:set', (e, patch = {}) => {
    const S = data.settings, n = (v, a, b) => Math.max(a, Math.min(b, Number(v)));
    if ('stockStepPct' in patch && [1, 2, 3].includes(Number(patch.stockStepPct))) { S.stockStepPct = Number(patch.stockStepPct); steps.setStep(S.stockStepPct); }
    if ('reminderVoice' in patch) S.reminderVoice = !!patch.reminderVoice;
    if ('awayMinutes' in patch && isFinite(patch.awayMinutes)) S.awayMinutes = n(patch.awayMinutes, 0, 240);
    if ('walk' in patch && ['home', 'screen', 'off'].includes(patch.walk)) S.walk = patch.walk;
    for (const k of ['romance', 'babies']) if (k in patch) S[k] = !!patch[k];
    if ('reducedMotion' in patch && ['system', 'on', 'off'].includes(patch.reducedMotion)) S.reducedMotion = patch.reducedMotion;
    if ('panelOwner' in patch && (patch.panelOwner === 'all' || qById(patch.panelOwner))) S.panelOwner = patch.panelOwner;
    changed({ quokkas: true });
    toStage('stage:settings', S);
    return { ok: true };
  });
  ipcMain.handle('folders:pick', async (e, { owner } = {}) => {
    const r = await dialog.showOpenDialog(panel, { title: '選擇要監看的資料夾（唯讀，不會改動檔案）', properties: ['openDirectory', 'multiSelections'] });
    if (r.canceled) return { ok: false };
    let last = { ok: false };
    for (const p of r.filePaths) last = addFolder(p, ownerOf(owner));
    return last;
  });
  ipcMain.handle('baby:name', (e, { qid, name } = {}) => {
    const q = qById(qid), nm = str(name, LIMITS.name);
    if (!q || !nm || data.quokkas.some((x) => x !== q && x.name === nm)) return { ok: false, message: '名字不能空白或重複' };
    q.name = nm; q.namedAt = nowISO(); changed({ quokkas: true });
    return { ok: true };
  });

  // ---- 提醒：知道了／5 分後（面板與舞台都可以送） -----------------------------------
  function clearAlert(rem) { rem.ringing = false; toStage('q:alert-clear', { qid: rem.owner, reminderId: rem.id }); }
  const ack = (e, p = {}) => { const r = data.reminders.find((x) => x.id === p.reminderId); if (r) { clearAlert(r); clock.schedule(); changed(); } return { ok: !!r }; };
  const snooze = (e, p = {}) => { const r = data.reminders.find((x) => x.id === p.reminderId); if (r) { clearAlert(r); R.snooze(r, 5); clock.schedule(); changed(); } return { ok: !!r }; };
  ipcMain.handle('alert:ack', ack); ipcMain.handle('alert:snooze', snooze);
  ipcMain.on('alert:ack', ack); ipcMain.on('alert:snooze', snooze);

  // ---- 舞台 → 主行程 ---------------------------------------------------------------
  const layers = {};
  ipcMain.on('stage:ready', (e) => {
    e.sender.send('stage:quokkas', data.quokkas.map(stageQ));
    e.sender.send('stage:settings', data.settings);
    for (const r of data.reminders) if (r.ringing) e.sender.send('q:alert', { qid: r.owner, reminderId: r.id, text: r.text });
  });
  const savePos = (e, { id, qid, pos, x, y } = {}) => {
    const q = qById(qid || id), px = pos ? pos.x : x, py = pos ? pos.y : y;
    if (q && isFinite(px) && isFinite(py)) { q.home = { x: Math.round(px), y: Math.round(py) }; store.save(); }
  };
  ipcMain.on('stage:save-pos', savePos);
  ipcMain.on('q:rest', savePos);
  ipcMain.on('q:state', (e, { qid, layer } = {}) => { if (qById(qid)) layers[qid] = layer; });
  ipcMain.on('q:dblclick', (e, { qid } = {}) => showPanel(qById(qid) ? qid : null));
  ipcMain.on('q:context', (e, { qid } = {}) => {
    const q = qById(qid); if (!q) return;
    const say = () => {
      try {
        const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'quotes.json'), 'utf-8')).quotes || [];
        const one = list[Math.floor(Math.random() * list.length)];
        if (one) event(qid, 'note', { text: one.zh });
      } catch (err) { /* 沒有語錄就算了 */ }
    };
    const play = (a, label) => ({ label, click: () => toStage('q:play', { qid, action: a }) });
    Menu.buildFromTemplate([
      { label: `${q.name} 說一句話`, click: say },
      { label: '陪我玩', submenu: [play('badminton', '羽球'), play('volleyball', '排球'), play('basketball', '籃球'), play('eat', '吃葉子'), play('hop', '跳一跳'), play('nap', '打盹')] },
      { label: '打開面板', click: () => showPanel(qid) },
      { type: 'separator' },
      { label: '暫時藏起來 30 分鐘', click: () => hideAll(30) },
      { label: '結束庫卡助理', click: () => { app.isQuitting = true; app.quit(); } }
    ]).popup();
  });
  ipcMain.on('perf:stats', () => {});
  function hideAll(mins) {
    for (const st of stage.stages.values()) if (!st.win.isDestroyed()) st.win.hide();
    stage.pause(true);
    setTimeout(() => { for (const st of stage.stages.values()) if (!st.win.isDestroyed()) st.win.showInactive(); stage.pause(false); }, mins * 60000);
  }

  // ---- 啟動 ------------------------------------------------------------------------
  stage.start();
  createPanel();
  data.folders.forEach(watchFolder);
  syncWatchlist(); stocks.start();
  clock.check();                       // 啟動時先處理錯過的提醒，再排下一個
  app.on('before-quit', () => { app.isQuitting = true; stocks.stop(); clock.stop(); store.saveNow(); });
  return { store, stage, data, showPanel };
}

module.exports = { start };
