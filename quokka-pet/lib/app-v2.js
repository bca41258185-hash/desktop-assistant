// 主行程 v2（規格第 1–4、7 節）：唯一的資料來源與排程中心
//   Store、Router（事件交給負責的那隻）、ReminderClock、StockService、FolderWatch、PresenceWatch、
//   StageManager（舞台圖層）、面板、右鍵選單、系統通知
// 面板與舞台之間不直接溝通；所有修改經這裡驗證後寫入，再廣播完整快照給面板、必要的事件給舞台。
const { app, BrowserWindow, ipcMain, dialog, screen, Menu, Notification, powerMonitor, net, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const { createStore, newId, LIMITS } = require('./store');
const { parseInput, noteText } = require('./parse-input');
const R = require('./reminders');
const { createStockService, isMarketOpen } = require('./stock-service');
const { createStepTracker } = require('./stock-step');
const { createStageManager } = require('./stage-main');
const { createCircleDetector } = require('./gesture');
const postcard = require('./postcard');
const { createFolderWatch } = require('./folder-watch');
const { createPosSaver } = require('./pos-saver');
const { createPerfSender } = require('./perf');
const { transferProblem, transferDupes } = require('./owner-ops');
const TRANSFER_KEY = { stock: (x) => x.symbol };      // 轉移時要去重的種類
const { createRomance } = require('./romance');
const { createSocialDirector } = require('./social');
const { createHistory, withToday, INDEX } = require('./stock-history');
const { analyze } = require('./indicators');
const talk = require('./market-talk');
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
  const posSaver = createPosSaver({ save: () => store.save() });   // 位置沒變不寫、最快 10 秒寫一次
  const want = Math.max(1, Number(process.env.QUOKKA_DEMO) || 1);       // 開發測試：補到 n 隻
  while (data.quokkas.length < want) {
    const i = data.quokkas.length;
    data.quokkas.push({ id: 'q' + (i + 1) + Date.now().toString(36), name: uniqueName(NAMES[i % NAMES.length]), traits: TR.generate(), home: null, createdAt: new Date().toISOString() });
  }
  data.quokkas.forEach((q) => {
    if (!q.traits) q.traits = TR.generate();
    TR.ensurePersonality(q.traits); TR.ensureAccessory(q.traits); if (TR.ensureGender) TR.ensureGender(q.traits);
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
  const ownerOf = (o) => { const q = qById(o); return q && romance.canOwnTasks(q) ? o : data.settings.defaultOwner; };   // 小袋鼠不能接任務
  const nowISO = () => new Date().toISOString();

  // ---- 舞台與面板 ---------------------------------------------------------------
  // 舞台當掉：在重新載入完成（stage:ready）之前，事件先存著，不要送進已經不在的頁面
  const stage = createStageManager({ BrowserWindow, screen, ipcMain, path, dir: ROOT, onGone: () => { stageReady = false; } });
  // 舞台頁面載入完成前的事件先存著（例如開機時「錯過的提醒」），ready 後補送
  let stageReady = false; const stageBacklog = [];
  const toStage = (ch, payload) => { if (!stageReady && (ch === 'q:event' || ch === 'presence')) { if (stageBacklog.length < 50) stageBacklog.push([ch, payload]); return; } stage.send(ch, payload); };
  const stageQ = (q) => ({ id: q.id, name: q.name, traits: q.traits, pos: q.home || null, stage: q.stage || 'adult', mom: q.mom || null, dad: q.dad || null,
    growScale: (q.traits && q.traits.growScale) || null, pregnant: !!q.pregnancy, hasJoey: q.joey ? q.joey.id : null, partner: partnerId(q.id), crush: crushId(q.id), flirt: flirtId(q.id), holding: (data.holding && data.holding[q.id]) || null });
  function partnerId(qid) { try { return romance.partnerOf(qid) || null; } catch (e) { return null; } }
  function crushId(qid) { try { return romance.crushOf(qid) || null; } catch (e) { return null; } }
  function crushesOf(qid) { try { return romance.crushesOf ? romance.crushesOf(qid) : [romance.crushOf(qid)].filter(Boolean); } catch (e) { return []; } }
  function flirtId(qid) { try { return romance.flirtOf(qid) || null; } catch (e) { return null; } }
  // 喜歡的對象變了（好感度變動後）：舞台要知道才會偷看對方；面板顯示也跟著更新
  let crushSig = '';
  function syncCrush() {
    const sig = data.quokkas.map((q) => q.id + ':' + (crushId(q.id) || '') + ':' + (flirtId(q.id) || '')).join('|');   // 喜歡的人或曖昧對象變了
    if (sig === crushSig) return;
    crushSig = sig;
    toStage('stage:quokkas', data.quokkas.map(stageQ));
    toPanel('store:changed', snapshot());
  }
  let away = false;
  const digest = {};                    // 離開期間各隻的待報告事項：{ qid: R.digestPush 的累積 }，回來時由各隻報告（R.digestTexts 轉成文字）
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  // ---- 戀愛與家族（RomanceDirector）、社交（SocialDirector） --------------------------
  const romance = createRomance({ data, now: () => Date.now(), random: Math.random, TR });
  const layers = {}, positions = {};
  let stageVisible = true;
  const social = createSocialDirector({
    getQuokkas: () => data.quokkas, getRelations: () => data.relations,
    getLayer: (qid) => (layers[qid] == null ? 8 : layers[qid]),
    getPos: (qid) => positions[qid] || null,
    now: () => Date.now(), random: Math.random, romance,
    isBlocked: () => sleeping || !stageVisible,      // 睡著（離開超過 20 分鐘、鎖定）或藏起來時不排
    isAway: () => away && !sleeping,                 // 剛離開（前 20 分鐘）：互動加倍
    onStart: (job) => toStage('social:start', job),
    onAbort: (job) => { toStage('social:abort', { pairId: job.pairId, by: job.by, reason: job.reason }); refundGift(job); }
  });
  let socialTimer = null;
  function scheduleSocial(ms) { clearTimeout(socialTimer); socialTimer = setTimeout(() => { let next = 240000; try { next = social.tick() || next; } catch (e) { console.error('社交排程失敗:', e.message); } changed(); scheduleSocial(next); }, ms); }
  // 戀愛事件 → 舞台、面板、系統通知
  function onRomanceEvents(events) {
    if (!events || !events.length) return;
    let quokkasChanged = false;
    for (const ev of events) {
      switch (ev.type) {
        case 'friend': event(ev.a, 'note', { text: `我跟${(qById(ev.b) || {}).name || '牠'}變成好朋友了！` }); break;
        case 'couple': quokkasChanged = true; event(ev.a, 'note', { text: '💕' }); event(ev.b, 'note', { text: '💕' }); break;
        case 'pregnant': quokkasChanged = true; event(ev.mom, 'note', { text: '肚子裡有寶寶了！' }); break;
        case 'birth': {
          quokkasChanged = true;
          event(ev.mom, 'birth', { child: ev.child, name: ev.name });
          notify(qById(ev.mom), `🎉 生了！幫「${ev.name}」取個名字吧`, ev.child);
          break;
        }
        case 'crowded': toPanel('panel:hint', { kind: 'crowded', count: ev.count }); break;
        default: quokkasChanged = true;          // joey-out、independent、resize、grown、adult、single、joey-to-dad、follower-gone
      }
    }
    changed({ quokkas: quokkasChanged });
  }
  // 遊戲時鐘：只在程式開著、使用者在、舞台沒藏起來時前進（懷孕 27 分鐘、育兒 1 小時）
  let lastTick = Date.now(), idleTicks = 0;
  setInterval(() => {
    const t = Date.now(), dt = away || !stageVisible ? 0 : Math.min(t - lastTick, 120000);
    lastTick = t;
    // 保險：互動超過 2 分鐘還沒回報（舞台出錯或重新載入），主行程自己收掉，不讓兩隻永遠卡在「忙碌」
    try { for (const j of social.activePairs()) if (t - j.startedAt > 120000) { refundGift(social.abort(j.pairId, null, 'timeout')); toStage('social:abort', { pairId: j.pairId, reason: 'timeout' }); } } catch (e) {}
    // 沒有懷孕、育兒、成長中的庫卡時，每 10 分鐘更新一次年齡就夠了
    const active = data.quokkas.some((q) => q.pregnancy || q.joey || q.growth || (q.stage && q.stage !== 'adult'));
    if (!active && (idleTicks = (idleTicks + 1) % 20) !== 0) return;
    try { onRomanceEvents(romance.tickClock(dt)); } catch (e) { console.error('遊戲時鐘失敗:', e.message); }
  }, 30000);
  // 響過的一次性提醒隔天自動清掉（錯過還沒按「知道了」的留著）
  function sweepReminders() {
    const cut = Date.now() - 24 * 3600000, n = data.reminders.length;
    data.reminders = data.reminders.filter((r) => !(spent(r) && !r.missedAt && new Date(r.lastFiredAt).getTime() < cut));
    if (data.reminders.length !== n) changed();
  }
  setInterval(() => { try { const ch = romance.dailyDecay(); if (ch && ch.length) saveAffinitySoon(); sweepReminders(); syncCrush(); } catch (e) {} }, 5 * 60000);   // 感情以半小時為單位：每 5 分鐘檢查一次變淡（有變就存）

  let panel = null;
  function createPanel() {
    // 預設開大一點：寬 720、高度幾乎整個工作區，靠螢幕左邊
    const wa = screen.getPrimaryDisplay().workArea, pw = Math.min(720, wa.width - 40), ph = Math.min(1000, wa.height);
    panel = new BrowserWindow({
      width: pw, height: ph, x: wa.x + 40, y: wa.y + Math.max(0, Math.round((wa.height - ph) / 2)), minWidth: 360, minHeight: 480, show: false, title: '庫卡助理', backgroundColor: '#f6efe3', autoHideMenuBar: true,
      webPreferences: { preload: path.join(ROOT, 'panel-preload.js'), contextIsolation: true, nodeIntegration: false }
    });
    panel.loadFile(path.join(ROOT, 'renderer', 'panel.html'));
    panel.on('closed', () => { panel = null; });            // 關掉就整個釋放；下次打開重新載入（約 1 秒）
    // 最小化或藏起來的時候可能沒收到更新：叫回來（restore／show／focus）時補送一份完整快照
    const resync = () => { if (panel && !panel.isDestroyed() && !panel.webContents.isLoading()) panel.webContents.send('store:changed', snapshot()); };
    for (const ev of ['restore', 'show', 'focus']) panel.on(ev, resync);
  }
  // 只有面板開著、看得到時才傳資料給它
  const panelLive = () => panel && !panel.isDestroyed() && panel.isVisible();
  const toPanel = (ch, payload) => { if (panelLive()) panel.webContents.send(ch, payload); };
  function showPanel(qid) {
    if (!panel || panel.isDestroyed()) createPanel();
    const go = () => { panel.show(); panel.focus(); if (qid) panel.webContents.send('panel:select', { qid }); };
    if (panel.webContents.isLoading()) panel.webContents.once('did-finish-load', go); else go();
  }
  const quotes = {};                 // symbol → 最新報價
  function snapshot() {
    return { quokkas: data.quokkas, tasks: data.tasks, reminders: data.reminders, stocks: data.stocks, folders: data.folders,
      relations: data.relations, items: itemsView(), postcards: (data.postcards || []).filter((c) => c.sent).slice(-20), crushes: Object.fromEntries(data.quokkas.map((q) => [q.id, crushId(q.id)])), crushLists: Object.fromEntries(data.quokkas.map((q) => [q.id, crushesOf(q.id)])), flirts: Object.fromEntries(data.quokkas.map((q) => [q.id, flirtId(q.id)])), settings: data.settings, quotes, ringing: data.reminders.filter((r) => r.ringing).map((r) => r.id),
      folderChanges: folderWatch.recentAll() };
  }
  function changed({ quokkas = false } = {}) {
    store.save(); posSaver.markSaved();               // 整份寫入時位置也在裡面
    toPanel('store:changed', snapshot());
    if (quokkas) toStage('stage:quokkas', data.quokkas.map(stageQ));
  }
  const DIGEST_TEXT = {
    'task-added': (p) => `收到新的事：「${p.text}」`, 'task-done': (p) => `「${p.text}」完成了`,
    stock: (p) => `${p.name} ${p.pct >= 0 ? '▲' : '▼'}${Math.abs(p.pct).toFixed(1)}%${p.limit === 'up' ? '（漲停）' : p.limit === 'down' ? '（跌停）' : ''}`,
    folder: (p) => `「${p.name}」資料夾有 ${p.count} 個檔案變了`, missed: (p) => `錯過的提醒：${(p.items || []).join('、')}`, birth: (p) => `${p.name} 出生了！`,
    'folder-note': (p) => p.text
  };
  const STAGE_KIND = { 'folder-note': 'note' };          // 只有主行程分得出來的種類：舞台一律當成一句話
  const event = (qid, kind, payload) => {
    if (!qById(qid)) return;
    if (away && DIGEST_TEXT[kind]) { digest[qid] = R.digestPush(digest[qid], kind, DIGEST_TEXT[kind](payload || {})); return; }
    toStage('q:event', { qid, kind: STAGE_KIND[kind] || kind, payload, prio: 2 });
  };

  // ---- 提醒（ReminderClock） ------------------------------------------------------
  const clock = R.createScheduler({
    getReminders: () => data.reminders,
    onFire: (due) => {
      const now = new Date(), missed = {};
      for (const { rem, missed: m } of due) {
        R.markFired(rem, now, { missed: !!m });              // 錯過的寫入 missedAt，正常響起就清掉
        if (m) { (missed[rem.owner] = missed[rem.owner] || []).push(rem.text); continue; }
        rem.ringing = true;
        toStage('q:alert', { qid: rem.owner, reminderId: rem.id, text: rem.text, speak: !!data.settings.reminderVoice });
        notifyReminder(rem.owner, `⏰ ${rem.text}`, rem.text);
      }
      for (const [qid, items] of Object.entries(missed)) {
        event(qid, 'missed', { items });
        notifyReminder(qid, `錯過的提醒：${items.join('、')}`.slice(0, 200), `錯過：${items.join('、')}`);
      }
      if (!stageVisible && due.some((d) => !d.missed)) unhide();     // 提醒優先：藏起來時也要出來響
      changed();
    }
  });
  function notify(q, body, qid) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: q ? q.name : '庫卡助理', body, silent: false });
    n.on('click', () => showPanel(qid));
    n.show();
  }
  // 提醒的系統通知：2 秒內多筆合併成一則「3 則提醒：A、B、C」（規格 4.1、4.4）
  const reminderNotes = R.createNotifyBatcher({ send: ({ title, body, qid }) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: false });
    n.on('click', () => showPanel(qid && qById(qid) ? qid : null));
    n.show();
  } });
  function notifyReminder(qid, body, label) { const q = qById(qid); reminderNotes.push({ title: q ? q.name : '庫卡助理', body, label, qid }); }
  powerMonitor.on('resume', () => clock.check());
  powerMonitor.on('unlock-screen', () => clock.check());

  // ---- 股價（StockService ＋ 跨門檻） ----------------------------------------------
  const quoteAt = {};                                         // 每檔最後一次拿到新報價的時間（判斷今天有沒有開盤）
  const steps = createStepTracker({ stepPct: data.settings.stockStepPct || 1 });
  const stocks = createStockService({
    fetch: (url, opt) => net.fetch(url, opt),                 // Electron 的 net 會走系統代理（公司網路）
    onUpdate: (u) => {
      if (!u.stale) quoteAt[u.symbol] = Date.now();
      quotes[u.symbol] = { price: u.price, pct: u.pct, stale: !!u.stale, recovered: !!u.recovered, name: u.name, time: u.time, market: u.market,
        prevClose: u.prevClose, open: u.open, high: u.high, low: u.low, volume: u.volume, day: u.day };
      toPanel('stock:tick', { symbol: u.symbol, market: u.market, ...quotes[u.symbol] });
      if (u.stale || !isNum(u.pct)) return;
      if (u.recovered) steps._state.delete(u.symbol);          // 斷線恢復：重新當基準
      const r = steps.update(u.symbol, { pct: u.pct, day: u.day, market: u.market });
      if (!r) return;
      const owners = new Set(data.stocks.filter((s) => s.symbol === u.symbol).map((s) => s.owner));
      for (const qid of owners) event(qid, 'stock', { symbol: u.symbol, name: u.name || u.symbol, pct: u.pct, dir: r.dir, limit: r.limit });
    }
  });
  // ---- 技術指標解說：用負責那隻庫卡的個性，講今天這檔股票發生了什麼 ------------------
  const history = createHistory({ fetch: (url, opt) => net.fetch(url, opt) });
  const archetypeOf = (qid) => { const q = qById(qid); return (q && q.traits.personality && q.traits.personality.archetype) || 'easy'; };
  // 這一隻自己的說話方式：個性類型＋五項個性數值＋喜好＋嗜好＋年紀
  const voiceOf = (qid) => { const q = qById(qid), P = q && q.traits.personality; return P ? { archetype: P.archetype, personality: P, likes: P.likes, hobbies: P.hobbies, stage: q.traits.stage } : { archetype: 'easy' }; };
  async function stockReport(stock, qid) {
    const h = await history.daily(stock.symbol, stock.market, stock.ex);
    if (!h.ok) return { ok: false, message: h.reason };
    const a = analyze(withToday(h.bars, quotes[stock.symbol]), { market: stock.market });
    const r = talk.describe(a, { name: stock.name || stock.symbol, symbol: stock.symbol, ...voiceOf(qid || stock.owner) });
    return { ok: true, report: r, score: a.ok ? a.signals[0].score : 0, values: a.ok ? a.v : null };
  }
  async function marketReport(market, qid) {
    const idx = INDEX[market] || INDEX.tw, h = await history.daily(idx.symbol, market);
    if (!h.ok) return null;
    return talk.marketLine(analyze(h.bars, { market: 'index' }), { indexName: idx.name, ...voiceOf(qid) });
  }
  // 讓某一隻講牠盯的股票裡「今天最有事」的那一檔（沒有盯股票就講大盤）
  async function tellMarket(qid, { brief = false } = {}) {
    const mine = data.stocks.filter((x) => x.owner === qid);
    if (!mine.length) { const line = await marketReport('tw', qid); event(qid, 'note', { text: line || '我今天拿不到大盤的資料。' }); return; }
    const reps = (await Promise.all(mine.map((st) => stockReport(st, qid)))).filter((r) => r.ok).sort((x, y) => y.score - x.score);
    if (!reps.length) { event(qid, 'note', { text: '我今天拿不到股價的歷史資料，晚點再試。' }); return; }
    const r = reps[0].report;
    event(qid, 'note', { text: r.headline, long: true });
    for (const line of r.lines.slice(0, brief ? 1 : 3)) event(qid, 'note', { text: line, long: true });
    if (!brief) event(qid, 'note', { text: r.disclaimer });
  }
  // 收盤後自動講一次（每個市場每天一次；使用者不在時留到回來再講）
  const closeTold = {};
  setInterval(() => {
    for (const market of ['tw', 'us']) {
      const any = Object.values(quotes).find((q) => q.market === market && q.day);
      if (!any || closeTold[market] === any.day) continue;
      const hm = new Intl.DateTimeFormat('en-GB', { timeZone: market === 'tw' ? 'Asia/Taipei' : 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce((o, p) => (o[p.type] = p.value, o), {});
      const today = `${hm.year}-${hm.month}-${hm.day}`, mins = Number(hm.hour) * 60 + Number(hm.minute), closeAt = market === 'tw' ? 13 * 60 + 30 : 16 * 60;
      if (any.day !== today || isMarketOpen(market, new Date()) || mins < closeAt + 5 || mins > closeAt + 90 || away) continue;
      closeTold[market] = any.day;
      const owners = new Set(data.stocks.filter((x) => x.market === market).map((x) => x.owner));
      let i = 0; for (const qid of owners) setTimeout(() => tellMarket(qid, { brief: true }).catch(() => {}), 1500 * i++);
    }
  }, 5 * 60000);
  // 盤中每分鐘報一次價：每隻把自己盯的、開盤中而且有新報價的股票說一遍（使用者不在、睡著時不報）
  setInterval(() => {
    if (away || sleeping) return;
    const by = {}, t = Date.now();
    for (const s of data.stocks) {
      const q = quotes[s.symbol];
      if (!q || q.stale || !isNum(q.pct) || !isNum(q.price) || !isMarketOpen(s.market, new Date()) || !(t - (quoteAt[s.symbol] || 0) < 3 * 60000)) continue;
      (by[s.owner] = by[s.owner] || []).push({ symbol: s.symbol, name: q.name || s.name || s.symbol, pct: q.pct, price: q.price, dir: q.pct < 0 ? 'down' : 'up', tick: true });
    }
    let i = 0;
    for (const [qid, list] of Object.entries(by)) setTimeout(() => { if (!away) event(qid, 'stock', { ticks: list }); }, 1500 * i++);   // 一隻的好幾檔一起講
  }, 60000);
  ipcMain.handle('stock:report', async (e, { id, symbol } = {}) => {
    const st = data.stocks.find((x) => x.id === id) || data.stocks.find((x) => x.symbol === symbol);
    if (!st) return { ok: false, message: '找不到這檔股票' };
    try { const r = await stockReport(st); return r.ok ? { ok: true, report: r.report, by: (qById(st.owner) || {}).name, values: r.values } : r; }
    catch (err) { return { ok: false, message: '暫時算不出來' }; }
  });

  // 依目前的股票清單重設所有訂閱：已刪掉的庫卡、沒有人盯的股票一併移除（報價也清掉）
  function syncWatchlist() {
    const by = {};
    for (const s of data.stocks) if (qById(s.owner)) (by[s.owner] = by[s.owner] || []).push({ symbol: s.symbol, market: s.market, ex: s.ex });
    stocks.setAllWatchlists(by);
    for (const sym of Object.keys(quotes)) if (!data.stocks.some((s) => s.symbol === sym)) delete quotes[sym];
  }

  // ---- 資料夾監看（FolderWatch，唯讀，lib/folder-watch.js） --------------------------
  const folderName = (f) => path.basename(f.path) || f.path;
  const folderWatch = createFolderWatch({
    chokidar, fs, path, getFolders: () => data.folders,
    onChanges: (f, c) => {
      // 檔案和資料夾分開說：「3 個檔案變了」只算檔案；只有資料夾變動時另外說一句
      if (c.files) event(f.owner, 'folder', { name: folderName(f), count: c.files, dirs: c.dirs });
      else if (c.dirs) event(f.owner, 'folder-note', { text: `「${folderName(f)}」資料夾裡${dirText(c.items)}` });
      toPanel('folder:changes', { id: f.id, files: c.files, dirs: c.dirs, at: c.at, recent: folderWatch.recent(f.id) });
    },
    onStatus: (f, status, prev) => {
      if (status === 'missing' && prev !== 'missing') event(f.owner, 'folder-note', { text: `「${folderName(f)}」資料夾找不到了（可能被改名、刪掉或隨身碟拔掉），我每 5 分鐘再找一次` });
      else if (status === 'ok' && prev === 'missing') event(f.owner, 'folder-note', { text: `「${folderName(f)}」資料夾找回來了，我繼續幫你看著` });
      else if (status === 'ok' && prev === 'error') event(f.owner, 'folder-note', { text: `「${folderName(f)}」資料夾讀得到了，我繼續幫你看著` });
      // 只有資料夾本身讀不到才會是 error，這時監看真的停了（folder-watch 會關掉），每 5 分鐘再試
      else if (status === 'error' && prev !== 'error') event(f.owner, 'folder-note', { text: `「${folderName(f)}」資料夾讀不到（權限不夠），先暫停監看，我每 5 分鐘再試一次` });
      changed();
    }
  });
  function dirText(items) {
    const add = items.filter((x) => x.kind === 'addDir').length, del = items.filter((x) => x.kind === 'unlinkDir').length;
    return [add && `新增了 ${add} 個資料夾`, del && `少了 ${del} 個資料夾`].filter(Boolean).join('、');
  }
  // 資料夾項目現在是「捷徑」（資料夾或檔案），只負責打開，不再監看變動（省電腦資源）；監看的程式留著，之後要再開可以用
  const watchFolder = () => {};
  const unwatchFolder = () => {};

  // ---- 捷徑：游標碰到矮袋鼠時浮出來的資料夾／檔案 ----------------------------------------
  const iconCache = new Map();                               // 路徑 → 圖示（data URL）
  async function iconOf(p) {
    if (iconCache.has(p)) return iconCache.get(p);
    let url = '';
    try { const im = await app.getFileIcon(p, { size: 'large' }); url = im && !im.isEmpty() ? im.toDataURL() : ''; } catch (e) { url = ''; }
    if (iconCache.size > 300) iconCache.clear();
    iconCache.set(p, url);
    return url;
  }
  // 捷徑指定的圖示檔（.ico／.png）：直接讀圖（getFileIcon 只會給「圖示檔」這種檔案類型的通用圖）
  function imageIcon(p) {
    if (iconCache.has('img:' + p)) return iconCache.get('img:' + p);
    let url = '';
    try { let im = nativeImage.createFromPath(p); if (!im.isEmpty()) { const z = im.getSize(); if (z.width > 64) im = im.resize({ width: 64, quality: 'best' }); url = im.toDataURL(); } } catch (e) { url = ''; }
    iconCache.set('img:' + p, url);
    return url;
  }
  ipcMain.handle('shortcuts:list', async (e, { qid } = {}) => Promise.all(data.folders.filter((f) => f.owner === qid).slice(0, 12).map(shortcutInfo)));
  // 面板的捷徑格子也要圖示：全部一次給（id → {name, dir, missing, icon}）
  ipcMain.handle('shortcuts:icons', async () => Object.fromEntries((await Promise.all(data.folders.slice(0, 200).map(shortcutInfo))).map((x) => [x.id, x])));
  async function shortcutInfo(f) {
    {
      let st = null; try { st = await fs.promises.stat(f.path); } catch (err) { /* 找不到 */ }
      let name = path.basename(f.path) || f.path, dir = st ? st.isDirectory() : !f.file, icon = '';
      // Windows 捷徑（.lnk）：用它指向的程式／資料夾的圖示（直接拿 .lnk 的圖示只會是一張白紙），名稱去掉 .lnk
      if (st && st.isFile() && /\.lnk$/i.test(f.path) && process.platform === 'win32') {
        name = name.replace(/\.lnk$/i, '');
        let link = null; try { link = shell.readShortcutLink(f.path); } catch (err) { /* 讀不到就照一般檔案 */ }
        let tst = null; if (link && link.target) { try { tst = await fs.promises.stat(link.target); } catch (err) { /* 目標不見了 */ } }
        if (tst && tst.isDirectory()) dir = true;
        else if (link) icon = (link.icon && (/\.(ico|png)$/i.test(link.icon) ? imageIcon(link.icon) : await iconOf(link.icon))) || (link.target && tst && await iconOf(link.target)) || '';
      }
      if (!dir && !icon && st && st.isFile()) icon = await iconOf(f.path);
      return { id: f.id, path: f.path, name, dir, missing: !st, icon };
    }
  }
  ipcMain.on('shortcut:open', async (e, { id } = {}) => {
    const f = data.folders.find((x) => x.id === id); if (!f) return;      // 只開清單裡的路徑
    const err = await shell.openPath(f.path).catch((x) => String(x));
    if (err) event(f.owner, 'note', { text: `打不開「${path.basename(f.path) || f.path}」，可能被移走或刪掉了` });
  });
  ipcMain.on('shortcut:drop', (e, { qid, paths } = {}) => {
    if (!qById(qid) || !Array.isArray(paths)) return;
    let added = 0, last = null;
    for (const p of paths.slice(0, 20)) { if (typeof p !== 'string' || !p) continue; last = addFolder(p, qid, { quiet: true }); if (last.ok) added++; }
    if (added) event(qid, 'note', { text: added > 1 ? `好，${added} 個捷徑放好了！` : `好，「${path.basename(last.item.path)}」放進捷徑了！` });
    else if (last && last.message) event(qid, 'note', { text: last.message });
  });

  // ---- 離開偵測（PresenceWatch） --------------------------------------------------
  // 離開（一段時間沒動電腦）的前 20 分鐘：庫卡不睡，反而玩得更兇（互動加倍）；離開超過 20 分鐘才睡；鎖定螢幕一律睡
  const AWAY_PLAY_MS = 20 * 60000;
  let locked = false, awaySince = 0, sleeping = false;
  function checkPresence() {
    const mins = Number(data.settings.awayMinutes) || 0;
    const idle = powerMonitor.getSystemIdleTime();
    const nowAway = locked || (mins > 0 && idle >= mins * 60);
    if (nowAway && !away) awaySince = Date.now();
    const nowSleep = locked || (nowAway && Date.now() - awaySince >= AWAY_PLAY_MS);
    if (nowAway === away && nowSleep === sleeping) return;
    const back = away && !nowAway;
    away = nowAway; sleeping = nowSleep;
    stage.pause(away || !stageVisible);
    const texts = {};
    if (back) for (const [qid, d] of Object.entries(digest)) { const t = R.digestTexts(d); if (t.length) texts[qid] = t; }
    toStage('presence', { away, locked, sleep: sleeping, digest: away ? null : texts });
    if (back) for (const k of Object.keys(digest)) delete digest[k];
  }
  setInterval(checkPresence, 5000);
  // 明信片：到時間就寄給愛人（不在了就給朋友、預設負責人）；程式關著時到期的，下次開啟時寄到
  function deliverPostcards() {
    // 回過信的：時間到就讓牠回來
    for (const c of (data.postcards || []).filter((x) => x.replied && !x.returned && Date.now() >= x.returnAt)) returnQuokka(c);
    const due = (data.postcards || []).filter((c) => !c.sent && Date.now() >= c.dueAt);
    if (!due.length) return;
    for (const c of due) {
      c.scene = postcard.scene(c);                     // 漫畫場景（每隻不一樣，落腳處和信裡寫的一致）
      c.text = postcard.compose(c);
      c.to = postcard.recipient(c, (id) => !!qById(id), data.settings.defaultOwner);
      c.sent = true; c.sentAt = new Date().toISOString(); c.read = false;
      event(c.to, 'note', { text: `📮 收到${c.from.name}寄來的明信片！` });
      notify(qById(c.to), `📮 ${c.from.name}從大自然寄了一張明信片給${(qById(c.to) || {}).name || '你'}`, c.to);
    }
    changed();
  }
  setInterval(deliverPostcards, 15000);
  // 回信：約 1 分鐘後（信寄到小島要一點時間）禿鷹把牠帶回來
  ipcMain.handle('postcard:reply', (e, { id, text } = {}) => {
    const c = (data.postcards || []).find((x) => x.id === id);
    if (!c || !c.sent) return { ok: false, message: '找不到這張明信片' };
    if (c.returned || qById(c.from.id)) return { ok: false, message: `${c.from.name}已經回來了` };
    if (c.replied) return { ok: true, returnAt: c.returnAt };
    c.replied = true; c.replyText = str(text, LIMITS.text); c.repliedAt = new Date().toISOString(); c.returnAt = Date.now() + 60000;
    changed();
    setTimeout(deliverPostcards, 61000);
    return { ok: true, returnAt: c.returnAt };
  });
  function returnQuokka(c) {
    c.returned = true; c.returnedAt = new Date().toISOString();
    for (const x of data.postcards || []) if (x.from.id === c.from.id) { x.replied = true; x.returned = true; }   // 同一隻的其他明信片也算回來了
    if (qById(c.from.id)) { changed(); return; }
    const q = JSON.parse(JSON.stringify(c.snapshot || { id: c.from.id, name: c.from.name, traits: c.from.traits, createdAt: new Date().toISOString() }));
    if (!q.traits) q.traits = TR.generate();
    TR.ensurePersonality(q.traits); TR.ensureAccessory(q.traits); if (TR.ensureGender) TR.ensureGender(q.traits);
    if (data.quokkas.some((x) => x.name === q.name)) q.name = uniqueName(q.name);
    if (!q.home && q.pos) { q.home = q.pos; delete q.pos; }
    const events = romance.onReturn(q, c.rels || []);
    changed({ quokkas: true });
    toStage('stage:arrive', { qid: q.id, line: c.replyText ? '我回來了！謝謝你的信 💌' : '我回來了！' });
    const lover = c.lover && qById(c.lover.id);
    if (lover) setTimeout(() => event(lover.id, 'note', { text: `💕 ${q.name}回來了！` }), 5500);
    onRomanceEvents(events); syncCrush();
  }
  setTimeout(deliverPostcards, 8000);
  ipcMain.handle('postcard:read', (e, { id } = {}) => { const c = (data.postcards || []).find((x) => x.id === id); if (c && !c.read) { c.read = true; changed(); } return { ok: true }; });
  // 滑鼠快速繞圈（1.5 秒內繞 2 圈）→ 從繞圈的位置下一陣落葉雨；冷卻 20 秒。睡著、藏起來時不理
  const circles = createCircleDetector();
  let lastRainAt = 0;
  // 滑鼠在動時每 40 ms 取樣；停著不動超過 1 秒就放慢到每 250 ms 看一次（一動就回到 40 ms，繞圈一定是在動）
  let lastCur = null, stillSince = 0;
  const circlePoll = () => {
    let wait = 250;
    if (stageVisible && !sleeping && stageReady) {
      const c = screen.getCursorScreenPoint(), t = Date.now();
      const moved = !lastCur || c.x !== lastCur.x || c.y !== lastCur.y;
      lastCur = c;
      if (moved) stillSince = t;
      wait = t - stillSince < 1000 ? 40 : 250;
      const hit = circles.push(c.x, c.y, t);
      if (hit && t - lastRainAt > 20000) {
        lastRainAt = t;
        const wa = screen.getPrimaryDisplay().workArea;                                    // 舞台座標＝螢幕座標 − 工作區左上角
        toStage('stage:leafrain', { by: 'cursor', x: hit.x - wa.x, y: hit.y - wa.y, r: hit.r });
      }
    }
    setTimeout(circlePoll, wait);
  };
  circlePoll();
  powerMonitor.on('lock-screen', () => { locked = true; checkPresence(); });
  powerMonitor.on('unlock-screen', () => { locked = false; checkPresence(); });

  // ---- 面板 → 主行程 ---------------------------------------------------------------
  const str = (v, n = LIMITS.text) => String(v == null ? '' : v).trim().slice(0, n);
  const nameTooLong = (v) => String(v == null ? '' : v).trim().length > LIMITS.name;   // 名字上限 12 字：超過就擋下，不偷偷截斷
  const findItem = (kind, id) => (KINDS[kind] ? data[KINDS[kind]].find((x) => x.id === id) : null);
  const countOf = (kind, owner) => data[KINDS[kind]].filter((x) => x.owner === owner && !(kind === 'task' && x.done) && !(kind === 'reminder' && spent(x))).length;   // 已完成的待辦不佔名額
  const spent = (r) => r.enabled === false && r.rule && r.rule.type === 'once' && !!r.lastFiredAt && !r.ringing;   // 響過的一次性提醒
  const normName = (n) => String(n).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const LIM = { task: LIMITS.tasksPerQuokka, reminder: LIMITS.remindersPerQuokka, stock: LIMITS.stocksPerQuokka, folder: 50 };
  const undoBox = new Map();

  ipcMain.handle('state:get', () => snapshot());
  ipcMain.handle('item:add', async (e, p = {}) => {
    const text = str(p.text), owner = ownerOf(p.owner);
    if (!text) return { ok: false, message: '請先輸入內容' };
    // 貼上一個存在的資料夾路徑 → 監看資料夾
    if (!p.forceType && /[\\/]/.test(text)) {
      const full = expandHome(text);                          // 「~/專案」→ 家目錄底下
      let st = null; try { st = fs.statSync(full); } catch (err) { /* 不是路徑就當一般文字 */ }
      if (st && (st.isDirectory() || st.isFile())) return addFolder(full, owner);     // 資料夾或檔案 → 捷徑
      if (/^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/])/.test(text)) return { ok: false, type: 'folder', message: '找不到這個資料夾或檔案，請確認路徑。要當成待辦嗎？', askTask: true };
    }
    let r = parseInput(text);
    if (p.forceType === 'task') r = { type: 'task', text };
    if (p.forceType === 'reminder' && r.type !== 'reminder') {      // 強制當提醒但沒寫時間 → 1 小時後提醒一次
      const at = new Date(Date.now() + 3600000), pad = (n) => String(n).padStart(2, '0');
      r = { type: 'reminder', text: r.text || text, rule: { type: 'once', date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, time: `${pad(at.getHours())}:${pad(at.getMinutes())}`, at: at.toISOString() } };
    }
    if (r.type === 'none') return { ok: false, message: '請先輸入內容' };
    if (countOf(r.type, owner) >= (LIM[r.type] || 50)) return { ok: false, message: '這隻盯的東西太多了，先完成或交給別隻吧' };
    // 「3000 訂金」這種只是長得像代號＋名稱的：查不到或名稱對不上就直接當待辦，不多問一步
    let stockFound = null;
    if (r.type === 'stock') {
      if (data.stocks.some((s) => s.owner === owner && s.symbol === r.symbol)) return { ok: false, message: '這檔已經在盯了' };
      // 查詢最多等 12 秒，不讓輸入框一直鎖著
      const found = await Promise.race([stocks.lookup(r.symbol, r.market, r.ex), new Promise((res) => setTimeout(() => res({ ok: false, offline: true, reason: '查詢太久沒有回應，請稍後再試' }), 12000))]);
      let problem = found.ok ? null : (found.reason || '找不到這檔股票') + '。要當成待辦嗎？';
      // 一個常見英文字（IT、ON、NOW…）：查得到也先問一次，按「加入股票」才真的盯（p.confirm）
      if (!problem && r.word && !p.confirm) return { ok: false, type: 'stock', message: `「${r.symbol}」是美股「${found.name || found.symbol}」的代號。要盯這檔股票，還是當成待辦？`, askTask: true, askStock: true };
      // 使用者有打名稱（「2330 台積電」「台積電」）：查到的名稱要對得上（互相包含就算），對不上就不加入
      if (!problem && r.nameHint && found.name && found.name !== found.symbol) {
        const clean = (x) => String(x).replace(/[\s*＊]/g, '').replace(/臺/g, '台').toUpperCase();
        const a = clean(found.name), b = clean(r.nameHint);
        if (a && b && !a.includes(b) && !b.includes(a)) problem = `查到的是「${found.name}」，和你打的「${r.nameHint}」不一樣。要當成待辦嗎？`;
      }
      if (problem && r.loose && !found.offline) {      // 連不上時不能斷定不是股票：照常詢問
        if (countOf('task', owner) >= LIM.task) return { ok: false, message: '這隻盯的東西太多了，先完成或交給別隻吧' };
        r = { type: 'task', text };
      } else if (problem) return { ok: false, type: 'stock', message: problem, askTask: true };
      else {
        if (!qById(owner)) return { ok: false, message: '這隻庫卡已經不在了' };                       // 查詢期間被刪掉
        if (countOf('stock', owner) >= LIM.stock) return { ok: false, message: '這隻盯的東西太多了，先完成或交給別隻吧' };   // 查詢期間同時送出好幾檔
        if (data.stocks.some((s) => s.owner === owner && s.symbol === found.symbol)) return { ok: false, message: '這檔已經在盯了' };   // 查詢期間連按兩次
        stockFound = found;
      }
    }
    if (r.type === 'stock') {
      const found = stockFound;
      const item = { id: newId('s'), owner, symbol: found.symbol, market: found.market, name: found.name, ex: found.ex, createdAt: nowISO() };
      data.stocks.push(item); syncWatchlist(); changed();
      event(owner, 'note', { text: `好，我幫你盯 ${found.name}！` });
      return { ok: true, type: 'stock', item };
    }
    if (r.type === 'reminder') {
      const item = { id: newId('r'), owner, text: str(r.text), rule: r.rule, enabled: true, createdAt: nowISO() };
      data.reminders.push(item); clock.schedule(); changed();
      event(owner, 'task-added', { text: item.text });
      return { ok: true, type: 'reminder', item, message: noteText(r) || undefined };
    }
    const item = { id: newId('t'), owner, text: r.text, done: false, createdAt: nowISO(), order: data.tasks.length };
    data.tasks.push(item); changed();
    event(owner, 'task-added', { text: item.text });
    return { ok: true, type: 'task', item, message: r.note || undefined };    // 看得出日期時間但排不了的，說明為什麼當待辦
  });
  // 「~」開頭的路徑展開成家目錄（fs 不會自己展開）
  function expandHome(t) { return /^~(?=[\\/]|$)/.test(t) ? path.join(app.getPath('home'), t.slice(1)) : t; }
  function addFolder(p, owner, { quiet = false } = {}) {
    p = path.resolve(p);
    let st = null; try { st = fs.statSync(p); } catch (err) { /* 下面處理 */ }
    if (!st) return { ok: false, message: '找不到這個資料夾或檔案' };
    if (countOf('folder', owner) >= LIM.folder) return { ok: false, message: '這隻的捷徑太多了，先移掉幾個吧' };
    const dup = data.folders.find((f) => f.path.toLowerCase() === p.toLowerCase());
    if (dup) return { ok: false, message: dup.owner === owner ? `「${path.basename(p) || p}」已經在我的捷徑裡了` : `「${path.basename(p) || p}」已經是「${(qById(dup.owner) || {}).name || '別隻'}」的捷徑了` };
    const f = { id: newId('f'), owner, path: p, file: st.isFile(), status: 'ok', createdAt: nowISO() };
    data.folders.push(f); changed();
    if (!quiet) event(owner, 'note', { text: `好，「${path.basename(p) || p}」放進捷徑了！` });
    return { ok: true, type: 'folder', item: f };
  }
  ipcMain.handle('item:update', (e, { kind, id, patch } = {}) => {
    const it = findItem(kind, id); let message;
    if (!it || !patch || typeof patch !== 'object') return { ok: false };
    if (kind === 'task') {
      if ('text' in patch && str(patch.text)) it.text = str(patch.text);
      if ('done' in patch) {
        const was = it.done; it.done = !!patch.done; it.doneAt = it.done ? nowISO() : null;
        if (it.done && !was) event(it.owner, 'task-done', { text: it.text, allDone: !data.tasks.some((t) => t.owner === it.owner && !t.done) });
      }
    } else if (kind === 'reminder') {
      if ('text' in patch && str(patch.text)) it.text = str(patch.text);
      if ('enabled' in patch) {
        const was = it.enabled !== false;
        if (!patch.enabled) { it.enabled = false; delete it.snoozeUntil; if (it.ringing) clearAlert(it); }
        else if (!was) {
          // 重新開啟：停用期間的時段不算錯過；時間已過的一次性提醒改到下一次同一時間，並告訴使用者
          if (countOf('reminder', it.owner) >= LIM.reminder && spent(it)) return { ok: false, message: '這隻的提醒已經滿了，先刪掉幾個吧' };
          const mv = R.reenable(it, new Date());
          if (mv.moved) message = `時間已經過了，改成${mv.tomorrow ? '明天' : '今天'} ${mv.time} 提醒`;
        }
      }
      clock.schedule();
    }
    changed();
    return { ok: true, message };
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
    if (!romance.canOwnTasks(qById(owner))) return { ok: false, message: '小袋鼠還不能接任務' };
    if (it.owner === owner) return { ok: true };
    if (LIM[kind] && countOf(kind, owner) >= LIM[kind]) return { ok: false, message: '牠手上的事已經滿了' };
    if (kind === 'stock' && data.stocks.some((x) => x.owner === owner && x.symbol === it.symbol)) return { ok: false, message: '牠已經在盯這檔了' };
    const wasRinging = !!it.ringing;
    if (wasRinging) clearAlert(it);
    it.owner = owner;
    if (wasRinging) { it.ringing = true; toStage('q:alert', { qid: owner, reminderId: it.id, text: it.text }); }   // 響到一半換人：新負責人接著響
    if (kind === 'stock') syncWatchlist();
    changed();
    event(owner, 'task-added', { text: it.text || it.name || path.basename(it.path || '') });
    return { ok: true };
  });

  // ---- 庫卡：新增、改名、重新生成、換飾品、刪除、陪我玩 ------------------------------
  ipcMain.handle('quokka:create', (e, { name, traits } = {}) => {
    const nm = str(name, LIMITS.name);
    if (!nm) return { ok: false, message: '幫牠取個名字吧' };
    if (nameTooLong(name)) return { ok: false, message: `名字最多 ${LIMITS.name} 個字` };
    romance.resolveNameClash(nm, null);                       // 小袋鼠的暫名讓位
    if (data.quokkas.some((q) => normName(q.name) === normName(nm))) return { ok: false, message: '已經有同名的庫卡了' };
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
    if (nameTooLong(name)) return { ok: false, message: `名字最多 ${LIMITS.name} 個字` };
    romance.resolveNameClash(nm, qid);
    if (data.quokkas.some((x) => x !== q && normName(x.name) === normName(nm))) return { ok: false, message: '已經有同名的庫卡了' };
    q.name = nm; q.nameTemp = false; changed({ quokkas: true });
    return { ok: true };
  });
  const REGEN_WHY = { 'has-partner': '牠有伴侶', pregnant: '牠正在懷孕', parenting: '牠正在帶小袋鼠', 'has-parents': '牠是別隻生的' };
  ipcMain.handle('quokka:regenerate', (e, { qid } = {}) => {
    const q = qById(qid); if (!q) return { ok: false };
    const can = romance.canRegenerate(q);
    if (!can.ok) return { ok: false, message: `${REGEN_WHY[can.reason] || '有家人'}，不能重新生成（可以換飾品）` };
    const t = TR.generate(); TR.ensurePersonality(t); TR.ensureAccessory(t);
    q.traits = t; romance.onRegenerate(qid); changed({ quokkas: true });
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
  // 刪除／放生：資料上的處理一樣（負責的事轉給別隻或一起刪、家族紀錄）；放生時舞台先播禿鷹把牠帶走，再從名單拿掉
  ipcMain.handle('quokka:delete', (e, { qid, transferTo, release } = {}) => removeQuokka(qid, transferTo, !!release));
  function removeQuokka(qid, transferTo, release) {
    const q = qById(qid); if (!q) return { ok: false };
    if (data.holding && data.holding[qid]) { const h = data.holding[qid]; delete data.holding[qid]; if (GIFTS[h]) { const it = items()[h]; it.n = Math.min(GIFTS[h].max, it.n + 1); } }   // 手上的禮物退回道具包
    const owners = data.quokkas.filter((x) => romance.canOwnTasks(x));
    if (owners.length <= 1 && romance.canOwnTasks(q)) return { ok: false, message: release ? '最後一隻不能放生' : '最後一隻不能刪除' };
    const to = transferTo === 'delete' ? null : qById(transferTo) && transferTo !== qid && romance.canOwnTasks(qById(transferTo)) ? transferTo : (owners.find((x) => x.id !== qid) || {}).id;
    // 轉給新主人前先檢查上限（每隻 50 件待辦…）：超過就不刪，請使用者選別隻或「一起刪除」
    if (to) {
      const why = transferProblem(data, qid, to, { LIM, kinds: KINDS, keyOf: TRANSFER_KEY, counts: (kind, x) => !(kind === 'task' && x.done) && !(kind === 'reminder' && spent(x)) });
      if (why) return { ok: false, full: true, message: `${qById(to).name}${why}，請選別隻，或選「一起刪除」` };
      // 兩隻都盯同一檔股票：轉過去會重複，先把這隻的那一筆拿掉
      for (const d of transferDupes(data, qid, to, { kinds: KINDS, keyOf: TRANSFER_KEY })) data[d.key] = data[d.key].filter((x) => x !== d.item);
    }
    for (const k of Object.values(KINDS)) {
      if (to) data[k].forEach((x) => { if (x.owner === qid) x.owner = to; });
      else { data[k].filter((x) => x.owner === qid && k === 'folders').forEach((f) => unwatchFolder(f.id)); data[k] = data[k].filter((x) => x.owner !== qid); }
    }
    if (release) {
      toStage('stage:release', { qid });               // 舞台會標記這隻，名單更新時等禿鷹飛走才移除
      // 約 10 分鐘後寄明信片回來：先記下牠的愛人和朋友（關係等一下就會被清掉）
      const rels = Object.entries(data.relations).map(([k, r]) => { const [a, b] = k.split('|'); return a === qid || b === qid ? { other: a === qid ? b : a, ...r } : null; }).filter(Boolean);
      data.postcards = (data.postcards || []).concat([postcard.plan({ from: q, relations: rels, nameOf: (id) => (id !== qid && qById(id) ? qById(id).name : null) })]).slice(-50);
    }
    social.removeQuokka(qid);
    delete layers[qid]; delete positions[qid]; delete digest[qid];      // 舞台回報的圖層、位置、離開期間的待報告事項
    const famEvents = romance.onDelete(qid);                   // 墓碑紀錄、伴侶恢復單身、小袋鼠交給爸爸
    data.quokkas = data.quokkas.filter((x) => x.id !== qid);
    onRomanceEvents(famEvents);
    if (data.settings.defaultOwner === qid) data.settings.defaultOwner = (data.quokkas.find((x) => romance.canOwnTasks(x)) || data.quokkas[0]).id;
    // 正在響的提醒換了主人：請新主人接著響
    if (to) for (const r of data.reminders) if (r.owner === to && r.ringing) toStage('q:alert', { qid: to, reminderId: r.id, text: r.text });
    syncWatchlist(); clock.schedule(); changed({ quokkas: true });
    return { ok: true };
  }
  // 右鍵「放生」：先確認；負責的事交給第一隻放得下的，都放不下就問要不要一起刪除
  //   確認框一定要用非同步的：同步的會卡住主行程，舞台（右鍵時暫時可點）就一直蓋在確認框上面，按不到
  async function confirmRelease(qid) {
    const q = qById(qid); if (!q) return;
    const owners = data.quokkas.filter((x) => x.id !== qid && romance.canOwnTasks(x));
    if (!owners.length) { dialog.showMessageBox({ type: 'info', title: '放生', message: '至少要留 1 隻庫卡，最後一隻不能放生。', buttons: ['好'] }); return; }
    const n = Object.keys(KINDS).reduce((s, k) => s + countOf(k, qid), 0);
    const fits = owners.find((o) => !transferProblem(data, qid, o.id, { LIM, kinds: KINDS, keyOf: TRANSFER_KEY, counts: (kind, x) => !(kind === 'task' && x.done) && !(kind === 'reminder' && spent(x)) }));
    const to = fits || null;
    const what = !n ? '' : to ? `牠負責的 ${n} 件事會交給${to.name}。` : `其他庫卡都放不下牠負責的 ${n} 件事，這些事會一起刪除。`;
    const { response: r } = await dialog.showMessageBox({ type: 'question', title: '放生', message: `要放生${q.name}嗎？`,
      detail: `會有一隻禿鷹飛過來，把牠帶回大自然。${what}放生以後牠就不會回來了。`, buttons: ['放生', '取消'], defaultId: 1, cancelId: 1, noLink: true });
    if (r !== 0 || !qById(qid)) return;
    removeQuokka(qid, to ? to.id : 'delete', true);
  }
  ipcMain.handle('quokka:delete-warning', (e, { qid } = {}) => ({ warning: romance.deleteWarning(qid) }));
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
    if ('saver' in patch) S.saver = !!patch.saver;
    if ('awayMinutes' in patch && isNum(Number(patch.awayMinutes)) && patch.awayMinutes !== null && String(patch.awayMinutes).trim() !== '') S.awayMinutes = n(patch.awayMinutes, 0, 240);
    if ('walk' in patch && ['home', 'screen', 'off'].includes(patch.walk)) S.walk = patch.walk;
    for (const k of ['romance', 'babies']) if (k in patch) S[k] = !!patch[k];
    if ('reducedMotion' in patch && ['system', 'on', 'off'].includes(patch.reducedMotion)) S.reducedMotion = patch.reducedMotion;
    if ('panelOwner' in patch && (patch.panelOwner === 'all' || qById(patch.panelOwner))) S.panelOwner = patch.panelOwner;
    if ('defaultOwner' in patch && qById(patch.defaultOwner) && romance.canOwnTasks(qById(patch.defaultOwner))) S.defaultOwner = patch.defaultOwner;
    if ('fetchReturn' in patch && ['carry', 'nudge', 'alternate'].includes(patch.fetchReturn)) S.fetchReturn = patch.fetchReturn;
    changed({ quokkas: true });
    toStage('stage:settings', S);
    sendPerf();
    return { ok: true };
  });
  ipcMain.handle('folders:pick', async (e, { owner, files } = {}) => {
    const r = await dialog.showOpenDialog(panel, files ? { title: '選擇要放進捷徑的檔案', properties: ['openFile', 'multiSelections'] } : { title: '選擇要放進捷徑的資料夾', properties: ['openDirectory', 'multiSelections'] });
    if (r.canceled) return { ok: false };
    let last = { ok: false };
    for (const p of r.filePaths) last = addFolder(p, ownerOf(owner));
    return last;
  });
  ipcMain.handle('baby:name', (e, { qid, name } = {}) => {
    const q = qById(qid), nm = str(name, LIMITS.name);
    if (q && nameTooLong(name)) return { ok: false, message: `名字最多 ${LIMITS.name} 個字` };
    if (!q || !nm || data.quokkas.some((x) => x !== q && normName(x.name) === normName(nm))) return { ok: false, message: '名字不能空白或重複' };
    q.name = nm; q.namedAt = nowISO(); changed({ quokkas: true });
    return { ok: true };
  });

  // ---- 提醒：知道了／5 分後（面板與舞台都可以送） -----------------------------------
  function clearAlert(rem) { rem.ringing = false; toStage('q:alert-clear', { qid: rem.owner, reminderId: rem.id }); }
  const ack = (e, p = {}) => { const r = data.reminders.find((x) => x.id === p.reminderId); if (r) { clearAlert(r); R.ackMissed(r); clock.schedule(); changed(); } return { ok: !!r }; };
  const snooze = (e, p = {}) => { const r = data.reminders.find((x) => x.id === p.reminderId); if (r) { clearAlert(r); R.snooze(r, 5); clock.schedule(); changed(); } return { ok: !!r }; };
  ipcMain.handle('alert:ack', ack); ipcMain.handle('alert:snooze', snooze);
  ipcMain.on('alert:ack', ack); ipcMain.on('alert:snooze', snooze);

  // ---- 動畫幀率：預設每秒 60 格；手動開「省電」或用電池時 30 格（lib/perf.js） ----
  const perf = createPerfSender({ getSaver: () => data.settings.saver, isOnBattery: () => powerMonitor.isOnBatteryPower(), send: (p) => stage.send('stage:perf', p) });
  const sendPerf = (force = false) => perf.update(force);
  powerMonitor.on('on-battery', () => sendPerf());           // 拔掉電源 → 30 格
  powerMonitor.on('on-ac', () => sendPerf());                // 插回電源 → 60 格（省電沒開時）

  // ---- 舞台 → 主行程 ---------------------------------------------------------------
  ipcMain.on('stage:ready', (e) => {
    e.sender.send('stage:quokkas', data.quokkas.map(stageQ));
    e.sender.send('stage:settings', data.settings);
    sendPerf(true);                                   // 舞台（重新）載入好：一定補送目前的幀率
    for (const r of data.reminders) if (r.ringing) e.sender.send('q:alert', { qid: r.owner, reminderId: r.id, text: r.text });
    stageReady = true;
    const backlog = stageBacklog.splice(0);
    for (const [ch, payload] of backlog) e.sender.send(ch, payload);
    // 重新載入（當掉、沒回應）後：補送目前的離開／鎖定狀態（開機時的已在上面的待送事項裡）
    if (away && !backlog.some(([ch]) => ch === 'presence')) e.sender.send('presence', { away, locked, sleep: sleeping, digest: null });
    if (hiddenUntil > Date.now()) e.sender.send('stage:hide', { until: hiddenUntil });
  });
  // 位置沒變就不寫；有變的最快每 10 秒寫一次（結束程式前一定寫入）
  const savePos = (e, { id, qid, pos, x, y } = {}) => {
    const q = qById(qid || id), px = pos ? pos.x : x, py = pos ? pos.y : y;
    if (q && isNum(px) && isNum(py)) posSaver.update(q, px, py);
  };
  ipcMain.on('stage:save-pos', savePos);
  ipcMain.on('q:rest', savePos);
  ipcMain.on('q:state', (e, { qid, layer } = {}) => { if (qById(qid)) { layers[qid] = layer; social.onLayer(qid, layer); } });
  ipcMain.on('q:pos', (e, list) => { if (Array.isArray(list)) for (const p of list.slice(0, 500)) if (p && qById(p.qid)) positions[p.qid] = { x: p.x, y: p.y, display: p.display || 'primary' }; });
  // 好感度變動（互動完成、擦身而過）：很頻繁，不每次都寫；節流成最多每 10 秒寫一次（結束前一定寫）
  let affTimer = null;
  function saveAffinitySoon() {
    if (affTimer) return;
    affTimer = setTimeout(() => { affTimer = null; store.save(); posSaver.markSaved(); }, 10000);
  }
  ipcMain.on('social:done', (e, { pairId, ok, type } = {}) => { try {
    // 互動完成的戀愛事件（變成好朋友、成為一對、懷孕）在 r.result.events（原本讀錯成 r.events，通知一直沒出來）
    const r = social.done(pairId, { ok: !!ok, type }); saveAffinitySoon(); onRomanceEvents(r && r.result && r.result.events);
    // 禮物送到了：玫瑰、點心的效果（romance.onGift）
    if (r && r.ok && r.gift && GIFTS[r.type]) { const g = romance.onGift(r.a, r.b, r.type); onRomanceEvents(g.events); changed(); }
    syncCrush();
  } catch (err) {} });
  // ---- 道具欄：玫瑰（最多 3，每 30 分鐘 +1）、點心（最多 5，每 10 分鐘 +1）。給某一隻 → 牠拿去送給別隻 ----
  const GIFTS = { rose: { name: '玫瑰', icon: '🌹', max: 3, every: 30 * 60000 }, snack: { name: '點心', icon: '🍪', max: 5, every: 10 * 60000 } };
  function items() {
    const now = Date.now();
    if (!data.items || typeof data.items !== 'object') data.items = {};
    for (const [k, g] of Object.entries(GIFTS)) {
      const it = data.items[k] && Number.isFinite(data.items[k].n) ? data.items[k] : (data.items[k] = { n: g.max, at: now });
      if (it.n >= g.max) { it.at = now; continue; }
      const add = Math.floor((now - (it.at || now)) / g.every);
      if (add > 0) { it.n = Math.min(g.max, it.n + add); it.at = it.n >= g.max ? now : (it.at || now) + add * g.every; }
    }
    return data.items;
  }
  const itemsView = () => { const it = items(); return Object.fromEntries(Object.entries(GIFTS).map(([k, g]) => [k, { n: it[k].n, max: g.max, every: g.every, next: it[k].n >= g.max ? null : it[k].at + g.every }])); };
  // 送給誰：玫瑰＝伴侶 → 曖昧 → 喜歡的（對方沒有別的伴侶）→ 最熟的；點心＝最熟的 → 伴侶、喜歡的
  function giftTarget(qid, item) {
    const ok = (id) => { const q = id && qById(id); return q && id !== qid && romance.canOwnTasks(q) ? id : null; };
    const rels = Object.entries(data.relations).map(([k, r]) => { const [a, b] = k.split('|'); return a === qid || b === qid ? { other: a === qid ? b : a, ...r } : null; }).filter((r) => r && ok(r.other));
    const best = rels.slice().sort((x, y) => (y.affinity || 0) - (x.affinity || 0))[0];
    const taken = (id) => { const p = romance.partnerOf(id); return p && p !== qid; };
    if (item === 'rose') {
      const lover = ok(romance.partnerOf(qid)) || ok(romance.flirtOf(qid)) || (ok(romance.crushOf(qid)) && !taken(romance.crushOf(qid)) ? romance.crushOf(qid) : null);
      if (lover) return lover;
      const single = rels.filter((r) => !taken(r.other)).sort((x, y) => (y.love || 0) - (x.love || 0) || (y.affinity || 0) - (x.affinity || 0))[0];
      return single ? single.other : (data.quokkas.find((q) => ok(q.id) && !taken(q.id)) || {}).id || null;
    }
    return (best && best.other) || ok(romance.partnerOf(qid)) || ok(romance.crushOf(qid)) || (data.quokkas.find((q) => ok(q.id)) || {}).id || null;
  }
  const lastGiftTo = {};                                      // 每隻 10 分鐘內只收一份禮物
  //   o.prepaid：道具已經先扣掉了（從道具包丟在地上、被撿起來的）；送不出去就退回
  function giveGift(qid, item, o = {}) {
    const r = giveGift0(qid, item, o);
    if (o.prepaid && !r.ok && GIFTS[item]) { const it = items()[item]; it.n = Math.min(GIFTS[item].max, it.n + 1); changed(); }
    return r;
  }
  function giveGift0(qid, item, o) {
    const g = GIFTS[item], q = qById(qid);
    if (!g || !q) return { ok: false, message: '找不到這個道具' };
    if (!romance.canOwnTasks(q)) return { ok: false, message: '小袋鼠還太小，不能幫忙送禮物' };
    const it = items()[item];
    if (!o.prepaid && it.n <= 0) return { ok: false, message: `${g.name}用完了，等一下會補` };
    const to = o.to && o.to !== qid && qById(o.to) && romance.canOwnTasks(qById(o.to)) ? o.to : giftTarget(qid, item);
    if (!to) return { ok: false, message: `${q.name}還沒有可以送的對象` };
    if (lastGiftTo[to] && Date.now() - lastGiftTo[to] < 10 * 60000) return { ok: false, message: `${qById(to).name}剛收過禮物，等一下再送吧` };
    const r = social.gift(qid, to, item);
    if (!r.ok) return { ok: false, message: r.reason === 'busy' ? `${q.name}或${qById(to).name}正在忙，等一下再試` : `${qById(to).name}離得太遠了` };
    if (!o.prepaid) { it.n -= 1; if (it.n === GIFTS[item].max - 1) it.at = Date.now(); }
    lastGiftTo[to] = Date.now();
    changed();
    return { ok: true, to: qById(to).name, item: g.name };
  }
  ipcMain.handle('gift:give', (e, { qid, item } = {}) => giveGift(qid, item));

  // ---- 道具包：從面板按住道具拖出來 → 道具跟著游標在桌面上（舞台畫）→ 放開時看放在哪 ----
  //   面板按下去就抓住滑鼠（pointer capture），所以拖出面板也收得到放開；游標位置由這裡每格讀、送給舞台
  const BAG = { badminton: 'play', volleyball: 'play', basketball: 'play', eat: 'play', rose: 'gift', snack: 'gift' };
  let carry = null;
  ipcMain.on('item:grab', (e, { item } = {}) => {
    if (!BAG[item] || carry) return;
    if (BAG[item] === 'gift' && items()[item].n <= 0) return;
    const st = stage.primary(); if (!st || st.win.isDestroyed()) return;
    const wa = st.display.workArea;
    const tick = () => { const c = screen.getCursorScreenPoint(); if (!st.win.isDestroyed()) st.win.webContents.send('item:carry', { item, x: c.x - wa.x, y: c.y - wa.y }); };
    carry = { item, st, timer: setInterval(tick, 16), until: setTimeout(() => endCarry(true), 30000) };
    tick();
  });
  function endCarry(cancel) {
    if (!carry) return;
    const { item, st } = carry; clearInterval(carry.timer); clearTimeout(carry.until); carry = null;
    if (st.win.isDestroyed()) return;
    const c = screen.getCursorScreenPoint(), wa = st.display.workArea;
    const pb = panel && !panel.isDestroyed() && panel.isVisible() && !panel.isMinimized() ? panel.getBounds() : null;
    const inPanel = !!pb && c.x >= pb.x && c.x < pb.x + pb.width && c.y >= pb.y && c.y < pb.y + pb.height;
    const off = c.x < wa.x || c.y < wa.y || c.x >= wa.x + wa.width || c.y >= wa.y + wa.height;
    st.win.webContents.send('item:drop', { item, x: c.x - wa.x, y: c.y - wa.y, cancel: !!cancel || inPanel || off });
  }
  ipcMain.on('item:release', (e, { cancel } = {}) => endCarry(!!cancel));
  // 放在某隻身上的禮物，或掉在地上被撿起來的禮物 → 牠拿去送給想送的那隻
  ipcMain.handle('item:use', (e, { qid, item, prepaid, to } = {}) => (BAG[item] === 'gift' ? giveGift(qid, item, { prepaid: !!prepaid, to: typeof to === 'string' ? to : null }) : { ok: false }));
  // 禮物自己用（點心自己吃、玫瑰自己收下）：扣一個
  ipcMain.handle('item:self', (e, { qid, item } = {}) => {
    if (BAG[item] !== 'gift' || !qById(qid)) return { ok: false };
    const it = items()[item];
    if (it.n <= 0) return { ok: false, message: `${GIFTS[item].name}用完了，等一下會補` };
    it.n -= 1; if (it.n === GIFTS[item].max - 1) it.at = Date.now();
    changed(); return { ok: true };
  });
  // 給某隻禮物：要自己用還是送人、送給誰，都由牠自己決定（看個性和跟大家的感情，每次不一定一樣）
  const STRANGER = { snack: 2.5, rose: .5 };                 // 還不熟的同伴：點心常常拿去送（交朋友），玫瑰偶爾
  const KEEP = { sleepy: .4, cool: .4, shy: .3, athlete: .25, explorer: .25, easy: .2, clingy: .1 };
  function decideGift(qid, item) {
    const q = qById(qid); if (!q || BAG[item] !== 'gift') return { ok: false };
    if (!romance.canOwnTasks(q)) return { ok: false, message: '小袋鼠還太小了' };
    if (items()[item].n <= 0) return { ok: false, message: `${GIFTS[item].name}用完了，等一下會補` };
    const ar = (q.traits && q.traits.personality && q.traits.personality.archetype) || 'easy';
    const others = data.quokkas.filter((o) => o.id !== qid && romance.canOwnTasks(o));
    const keep = others.length ? (KEEP[ar] || .2) + (item === 'snack' ? .1 : 0) : 1;
    if (Math.random() < keep) {
      const it = items()[item]; it.n -= 1; if (it.n === GIFTS[item].max - 1) it.at = Date.now(); changed();
      return { ok: true, self: true };
    }
    const crush = new Set(crushesOf(qid));
    const w = others.map((o) => { const r = data.relations[[qid, o.id].sort().join('|')] || {};
      return 1 + (r.affinity || 0) / 20 + (item === 'rose' ? (r.love || 0) / 8 + (r.couple ? 8 : 0) + (crush.has(o.id) ? 5 : 0) : (r.friend ? 3 : 0)) + ((r.affinity || 0) < 10 ? STRANGER[item] : 0) + Math.random() * 2; });
    // 依權重排順序（每次抽一個，抽過的拿掉）；第一個沒空（正在忙、剛收過禮物）就換下一個
    const pool = others.map((o, i) => [o, w[i]]); let last = null;
    while (pool.length) {
      let x = Math.random() * pool.reduce((a, b) => a + b[1], 0), i = 0;
      for (; i < pool.length - 1; i++) { x -= pool[i][1]; if (x <= 0) break; }
      const [to] = pool.splice(i, 1);
      last = giveGift(qid, item, { to: to.id });
      if (last.ok) return last;
    }
    // 大家都沒空：那就自己用
    const it = items()[item]; it.n -= 1; if (it.n === GIFTS[item].max - 1) it.at = Date.now(); changed();
    return { ok: true, self: true, busy: true };
  }
  ipcMain.handle('item:decide', (e, { qid, item } = {}) => decideGift(qid, item));
  // 你給牠的禮物先拿在手上（扣掉道具包的一個）；之後要自己用、留著還是送誰，牠自己挑時間決定
  ipcMain.handle('item:hold', (e, { qid, item } = {}) => {
    const q = qById(qid);
    if (!q || BAG[item] !== 'gift') return { ok: false };
    if (!romance.canOwnTasks(q)) return { ok: false, message: '小袋鼠還太小了' };
    if (!data.holding || typeof data.holding !== 'object') data.holding = {};
    const it = items()[item];
    if (it.n <= 0) return { ok: false, message: `${GIFTS[item].name}用完了，等一下會補` };
    // 點心一定收：手上已經有東西就直接吃掉
    if (data.holding[qid] && item === 'snack') { it.n -= 1; if (it.n === GIFTS[item].max - 1) it.at = Date.now(); changed(); return { ok: true, eatNow: true }; }
    if (data.holding[qid]) return { ok: false, message: `我手上已經有${GIFTS[data.holding[qid]] ? GIFTS[data.holding[qid]].name : '東西'}了` };
    it.n -= 1; if (it.n === GIFTS[item].max - 1) it.at = Date.now();
    data.holding[qid] = item; changed();
    return { ok: true };
  });
  // 手上的禮物：牠決定好了 → 自己用（拿掉）／送給誰（照個性和感情挑，沒空就換下一個）／再拿一下（之後再說）
  ipcMain.handle('item:held-decide', (e, { qid } = {}) => {
    const q = qById(qid), item = data.holding && data.holding[qid];
    if (!q || !GIFTS[item]) return { ok: false };
    const ar = (q.traits && q.traits.personality && q.traits.personality.archetype) || 'easy';
    const others = data.quokkas.filter((o) => o.id !== qid && romance.canOwnTasks(o));
    const r = Math.random(), keep = (KEEP[ar] || .2) + (item === 'snack' ? .1 : 0);
    if (!others.length || r < keep) { delete data.holding[qid]; changed(); return { ok: true, self: true, item }; }
    if (r < keep + .15) return { ok: true, wait: true, item };                       // 再拿一下、捨不得
    const crush = new Set(crushesOf(qid));
    const pool = others.map((o) => { const rr = data.relations[[qid, o.id].sort().join('|')] || {};
      return [o, 1 + (rr.affinity || 0) / 20 + (item === 'rose' ? (rr.love || 0) / 8 + (rr.couple ? 8 : 0) + (crush.has(o.id) ? 5 : 0) : (rr.friend ? 3 : 0)) + ((rr.affinity || 0) < 10 ? STRANGER[item] : 0) + Math.random() * 2]; });
    while (pool.length) {
      let x = Math.random() * pool.reduce((a, b) => a + b[1], 0), i = 0;
      for (; i < pool.length - 1; i++) { x -= pool[i][1]; if (x <= 0) break; }
      const [to] = pool.splice(i, 1);
      const g = giveGift0(qid, item, { prepaid: true, to: to.id });
      if (g.ok) { delete data.holding[qid]; changed(); return { ...g, item }; }
    }
    return { ok: true, wait: true, item };                                          // 大家都沒空：先拿著
  });
  ipcMain.on('item:offer', (e, { qid, item } = {}) => { if (BAG[item] === 'gift' && qById(qid)) toStage('item:offer', { qid, item }); });
  // 禮物掉在地上：先扣掉（不能同時丟好幾朵最後一朵玫瑰）；沒人撿、消失了就退回
  ipcMain.handle('item:ground', (e, { item } = {}) => {
    if (BAG[item] !== 'gift') return { ok: true };
    const it = items()[item];
    if (it.n <= 0) return { ok: false, message: `${GIFTS[item].name}用完了，等一下會補` };
    it.n -= 1; if (it.n === GIFTS[item].max - 1) it.at = Date.now();
    changed(); return { ok: true };
  });
  ipcMain.on('item:refund', (e, { item } = {}) => { if (BAG[item] !== 'gift') return; const it = items()[item]; it.n = Math.min(GIFTS[item].max, it.n + 1); changed(); });
  // 送禮物的途中被打斷（拖曳、響鈴、太久）：道具退回去
  function refundGift(j) {
    if (!j || !j.gift || !GIFTS[j.type]) return;
    const it = items()[j.type]; it.n = Math.min(GIFTS[j.type].max, it.n + 1); delete lastGiftTo[j.b]; changed();
  }
  ipcMain.on('social:abort', (e, { pairId, by, reason } = {}) => { try {
    refundGift(social.abort(pairId, by, reason));
  } catch (err) {} });
  ipcMain.on('q:pass', (e, { a, b } = {}) => { if (qById(a) && qById(b)) { try { social.passBy(a, b); saveAffinitySoon(); syncCrush(); } catch (err) {} } });
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
    stage.popupMenu(Menu.buildFromTemplate([
      { label: `${q.name} 說一句話`, click: say },
      { label: '今天股市怎麼了？', click: () => tellMarket(qid).catch(() => {}) },
      { label: '陪我玩', submenu: [play('badminton', '羽球'), play('volleyball', '排球'), play('basketball', '籃球'), play('eat', '吃葉子'), play('hop', '跳一跳'), play('nap', '打盹')] },
      { label: '打開面板', click: () => showPanel(qid) },
      { label: '送禮物', enabled: romance.canOwnTasks(q), submenu: Object.entries(GIFTS).map(([k, g]) => ({ label: `${g.icon} ${g.name}（剩 ${items()[k].n}）`, enabled: items()[k].n > 0, click: () => { const r = giveGift(qid, k); event(qid, 'note', { text: r.ok ? `我把${g.name}送給${r.to}！` : r.message }); } })) },
      { type: 'separator' },
      { label: `放生${q.name}…`, enabled: romance.canOwnTasks(q) ? data.quokkas.filter((x) => romance.canOwnTasks(x)).length > 1 : true, click: () => confirmRelease(qid) },
      // 有提醒在響時不能藏；選單打開後才開始響的，點下去時再檢查一次
      { label: '暫時藏起來 30 分鐘', enabled: !data.reminders.some((r) => r.ringing), click: () => {
        if (data.reminders.some((r) => r.ringing)) { event(qid, 'note', { text: '有提醒在響，先按「知道了」再藏起來喔' }); return; }
        hideAll(30);
      } },
      { label: '結束庫卡助理', click: () => { app.isQuitting = true; app.quit(); } }
    ]), e.sender);
  });
  ipcMain.on('perf:stats', () => {});
  let hideTimer = null, hiddenUntil = 0;
  function unhide() {
    clearTimeout(hideTimer); hideTimer = null; hiddenUntil = 0;
    if (stageVisible) return;
    for (const st of stage.stages.values()) if (!st.win.isDestroyed()) st.win.showInactive();
    stageVisible = true; stage.pause(away);
    toStage('stage:hide', { hide: false });
  }
  function hideAll(mins) {
    clearTimeout(hideTimer);
    hiddenUntil = Date.now() + mins * 60000;
    toStage('stage:hide', { until: hiddenUntil });               // 舞台停下動畫與計時器（看不到就停）
    for (const st of stage.stages.values()) if (!st.win.isDestroyed()) st.win.hide();
    stageVisible = false; stage.pause(true);
    hideTimer = setTimeout(unhide, mins * 60000);
  }

  // ---- 啟動 ------------------------------------------------------------------------
  // 各子系統各自保護：任何一個失敗都不能讓提醒排不起來
  const boot = (name, fn) => { try { fn(); } catch (e) { console.error(`啟動 ${name} 失敗:`, e); } };
  boot('舞台', () => stage.start());              // 面板等使用者第一次打開才建立
  boot('提醒', () => clock.check());              // 先處理錯過的提醒，再排下一個
  boot('股價', () => { syncWatchlist(); stocks.start(); });
  try { romance.refreshAges(); romance.dailyDecay(); sweepReminders(); } catch (e) {}
  scheduleSocial(15000);               // 開機 15 秒後開始安排互動
  app.on('before-quit', () => { app.isQuitting = true; clearTimeout(socialTimer); clearTimeout(affTimer); stocks.stop(); clock.stop(); folderWatch.stop(); reminderNotes.flush(); posSaver.flush(); store.saveNow(); });
  return { store, stage, data, showPanel, unhide, stocks, quotes, layers, positions, folderWatch, posSaver, perf };
}

module.exports = { start };
