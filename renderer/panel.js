// 面板 renderer：分頁切換、聊天、資料夾/變更、任務、設定。
// 全部透過 window.api（preload 暴露）與主行程溝通。

// ---------------------------------------------------------------------------
// 分頁切換
// ---------------------------------------------------------------------------
const tabs = document.querySelectorAll('.tab');
const views = document.querySelectorAll('.panel-view');
// 顯示某一頁；tabName 是上方要亮起的分頁（「更多」底下的子頁都算在「更多」）
function showView(name, tabName) {
  views.forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === (tabName || name)));
}
tabs.forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.tab)));
document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.open, 'more')));
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => showView('more')));

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString('zh-TW', { hour12: false });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// 聊天
// ---------------------------------------------------------------------------
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const withContext = document.getElementById('withContext');

function appendMsg(text, kind) {
  const div = document.createElement('div');
  div.className = 'msg ' + kind;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

async function sendChat() {
  const message = chatInput.value.trim();
  if (!message) return;
  appendMsg(message, 'user');
  chatInput.value = '';
  chatSend.disabled = true;
  const pending = appendMsg('思考中…', 'bot');
  try {
    const res = await window.api.sendChat({
      message,
      withContext: withContext.checked
    });
    if (res.ok) {
      pending.textContent = res.reply;
    } else {
      pending.className = 'msg err';
      pending.textContent = '錯誤：' + res.error;
    }
  } catch (e) {
    pending.className = 'msg err';
    pending.textContent = '錯誤：' + e.message;
  } finally {
    chatSend.disabled = false;
    chatLog.scrollTop = chatLog.scrollHeight;
  }
}

chatSend.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

// ---------------------------------------------------------------------------
// 資料夾與變更
// ---------------------------------------------------------------------------
const folderList = document.getElementById('folderList');
const changeList = document.getElementById('changeList');

function renderFolders(folders) {
  folderList.innerHTML = '';
  if (!folders.length) {
    folderList.innerHTML = '<li class="empty">尚未加入任何資料夾。</li>';
    return;
  }
  folders.forEach((folder) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'path';
    span.textContent = folder;
    const btn = document.createElement('button');
    btn.textContent = '移除';
    btn.addEventListener('click', async () => {
      renderFolders(await window.api.removeFolder(folder));
    });
    li.appendChild(span);
    li.appendChild(btn);
    folderList.appendChild(li);
  });
}

function renderChanges(changes) {
  changeList.innerHTML = '';
  if (!changes.length) {
    changeList.innerHTML = '<li class="empty">目前沒有變更紀錄。</li>';
    return;
  }
  changes.forEach((c) => {
    const li = document.createElement('li');
    const left = document.createElement('div');
    left.innerHTML = `<span class="type">[${c.type}]</span>${c.name}`;
    const t = document.createElement('span');
    t.className = 'time';
    t.textContent = fmtTime(c.time);
    li.appendChild(left);
    li.appendChild(t);
    li.title = c.path;
    changeList.appendChild(li);
  });
}

document.getElementById('pickFolders').addEventListener('click', async () => {
  renderFolders(await window.api.pickFolders());
});

// 主行程推播的即時變更
window.api.onChanges(renderChanges);

// ---------------------------------------------------------------------------
// 任務
// ---------------------------------------------------------------------------
const taskList = document.getElementById('taskList');
const taskInput = document.getElementById('taskInput');
const taskProgress = document.getElementById('taskProgress');

function renderTasks(tasks) {
  taskList.innerHTML = '';
  const done = tasks.filter((t) => t.done).length;
  taskProgress.textContent = `${done}/${tasks.length}`;
  if (!tasks.length) {
    taskList.innerHTML = '<li class="empty">還沒有任務，新增一項吧！</li>';
    return;
  }
  tasks.forEach((t) => {
    const li = document.createElement('li');
    if (t.done) li.classList.add('done');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.done;
    cb.addEventListener('change', async () => {
      renderTasks(await window.api.toggleTask(t.id));
    });

    const span = document.createElement('span');
    span.className = 'task-text';
    span.textContent = t.text;

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '刪除';
    del.addEventListener('click', async () => {
      renderTasks(await window.api.removeTask(t.id));
    });

    li.appendChild(cb);
    li.appendChild(span);
    li.appendChild(del);
    taskList.appendChild(li);
  });
}

async function addTask() {
  const text = taskInput.value.trim();
  if (!text) return;
  taskInput.value = '';
  renderTasks(await window.api.addTask(text));
}

document.getElementById('taskAdd').addEventListener('click', addTask);
taskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTask();
});


// ---------------------------------------------------------------------------
// 名言
// ---------------------------------------------------------------------------
const quoteList = document.getElementById('quoteList');
const quoteMaster = document.getElementById('quoteMaster');

function renderQuotes(payload) {
  if (!quoteList) return;
  quoteList.innerHTML = '';
  const name = (payload && payload.nameZh) || '';
  if (quoteMaster) quoteMaster.textContent = name;
  const quotes = (payload && payload.quotes) || [];
  if (!quotes.length) {
    quoteList.innerHTML = '<li class="empty">這位大師目前還沒有收錄名言。</li>';
    return;
  }
  quotes.forEach((q, index) => {
    const li = document.createElement('li');
    li.className = 'quote-card';

    const zh = document.createElement('div');
    zh.className = 'quote-zh';
    zh.textContent = '「' + q.zh + '」';

    // 外文名言顯示原文；文言名言（lang: lzh）則顯示白話解釋
    const orig = document.createElement('div');
    orig.className = 'quote-orig';
    orig.textContent = q.original || (q.gloss ? '白話：' + q.gloss : '');

    const src = document.createElement('div');
    src.className = 'quote-src';
    const srcLabel = document.createElement('span');
    srcLabel.textContent = (q.sourceZh || q.source || '') + (q.url ? '  ·  ' : '');
    src.appendChild(srcLabel);
    if (q.url) {
      const a = document.createElement('button');
      a.type = 'button';
      a.textContent = '開啟來源';
      a.addEventListener('click', () => window.api.openExternal(q.url));
      src.appendChild(a);
    }

    const actions = document.createElement('div');
    actions.className = 'quote-actions';
    const speakBtn = document.createElement('button');
    speakBtn.textContent = '讓大師說這句';
    speakBtn.addEventListener('click', () => window.api.speakQuote(index));
    actions.appendChild(speakBtn);

    li.appendChild(zh);
    if (orig.textContent) li.appendChild(orig);
    li.appendChild(src);
    li.appendChild(actions);
    quoteList.appendChild(li);
  });
}

async function loadQuotes(id) {
  renderQuotes(await window.api.listQuotes(id));
}

const quoteRandom = document.getElementById('quoteRandom');
if (quoteRandom) {
  quoteRandom.addEventListener('click', () => window.api.speakRandomQuote());
}
if (window.api.onCharacterChanged) {
  window.api.onCharacterChanged((id) => { loadQuotes(id); });
}

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------
const setProvider = document.getElementById('setProvider');
const setBaseUrl = document.getElementById('setBaseUrl');
const setModel = document.getElementById('setModel');
const setApiKey = document.getElementById('setApiKey');
const setReminder = document.getElementById('setReminder');
const setQuoteInterval = document.getElementById('setQuoteInterval');
const envHint = document.getElementById('envHint');
const saveStatus = document.getElementById('saveStatus');
const charPicker = document.getElementById('charPicker');
const setAiWatch = document.getElementById('setAiWatch');

// 目前選用的大師（供儲存設定時一併帶上）
let selectedCharId = (window.CHAR_DEFAULT || 'ando');

// 繪製大師選擇器：上方為職業分類標籤，下方為該類別的角色卡（縮圖 + 繁中名 + 英文名）
let pickerCategory = null;   // 目前顯示的類別；預設跟隨已選角色

function renderCharPicker() {
  const chars = window.CHARACTERS || {};
  const cats = window.CHAR_CATEGORIES ||
    [{ id: 'all', label: '全部', order: window.CHAR_ORDER || Object.keys(chars) }];
  if (!pickerCategory || !cats.some((c) => c.id === pickerCategory)) {
    const cur = chars[selectedCharId];
    pickerCategory = (cur && cur.category) || cats[0].id;
  }
  charPicker.innerHTML = '';

  if (cats.length > 1) {
    const tabs = document.createElement('div');
    tabs.className = 'char-cats';
    cats.forEach((cat) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'char-cat' + (cat.id === pickerCategory ? ' active' : '');
      b.textContent = `${cat.label}（${cat.order.length}）`;
      b.addEventListener('click', () => {
        pickerCategory = cat.id;
        renderCharPicker();
      });
      tabs.appendChild(b);
    });
    charPicker.appendChild(tabs);
  }

  const grid = document.createElement('div');
  grid.className = 'char-grid';
  const cat = cats.find((c) => c.id === pickerCategory) || cats[0];
  cat.order.forEach((id) => {
    const c = chars[id];
    if (!c) return;
    const card = document.createElement('div');
    card.className = 'char-card' + (id === selectedCharId ? ' selected' : '');
    card.dataset.id = id;
    card.innerHTML =
      `<div class="char-thumb">${c.svg}</div>` +
      `<div class="char-name-zh">${c.nameZh}</div>` +
      `<div class="char-name-en">${c.nameEn}</div>`;
    card.addEventListener('click', async () => {
      if (selectedCharId === id) return;
      selectedCharId = id;
      charPicker.querySelectorAll('.char-card').forEach((el) =>
        el.classList.toggle('selected', el.dataset.id === id));
      await window.api.setCharacter(id);   // 立即切換桌寵並持久化
    });
    grid.appendChild(card);
  });
  charPicker.appendChild(grid);
}

async function loadSettings() {
  const s = await window.api.getSettings();
  setProvider.value = s.provider;
  setBaseUrl.value = s.baseUrl;
  setModel.value = s.model;
  setApiKey.value = s.apiKey;
  setReminder.value = s.reminderIntervalMinutes;
  if (setQuoteInterval) setQuoteInterval.value = s.quoteIntervalMinutes;
  selectedCharId = s.characterId || selectedCharId;
  if (setAiWatch) setAiWatch.checked = s.aiWatch !== false;
  renderCharPicker();

  const overrides = [];
  if (s.env.apiKey) overrides.push('OPENAI_API_KEY');
  if (s.env.baseUrl) overrides.push('OPENAI_BASE_URL');
  if (s.env.model) overrides.push('OPENAI_MODEL');
  envHint.textContent = overrides.length
    ? `目前以下環境變數生效中（會覆蓋此處設定）：${overrides.join('、')}`
    : '';
}

document.getElementById('saveSettings').addEventListener('click', async () => {
  await window.api.saveSettings({
    provider: setProvider.value,
    baseUrl: setBaseUrl.value.trim(),
    model: setModel.value.trim(),
    apiKey: setApiKey.value,
    reminderIntervalMinutes: Number(setReminder.value) || 0,
    quoteIntervalMinutes: Number(setQuoteInterval && setQuoteInterval.value),
    characterId: selectedCharId,
    aiWatch: setAiWatch ? setAiWatch.checked : true
  });
  loadAi();
  saveStatus.textContent = '已儲存 ✓';
  setTimeout(() => (saveStatus.textContent = ''), 2000);
});

// ---------------------------------------------------------------------------
// AI 專案：Claude Code / Codex 對話進度（資料由主行程推送，這裡只負責顯示）
// ---------------------------------------------------------------------------
const aiList = document.getElementById('aiList');
const aiBadge = document.getElementById('aiBadge');
const aiWatchList = document.getElementById('aiWatchList');
const aiHookStatus = document.getElementById('aiHookStatus');
const aiHookBtn = document.getElementById('aiHookBtn');
const aiHookHint = document.getElementById('aiHookHint');
let aiState = { enabled: true, roots: null, watchProjects: [], hooks: {}, projects: [] };
let aiHookMsg = '';

function renderAiConfig() {
  // 進階設定裡：追蹤整個資料夾的清單
  aiWatchList.innerHTML = '';
  (aiState.watchProjects || []).forEach((p) => {
    const li = el('li');
    li.appendChild(el('span', 'ai-watch-path', '📁 ' + p));
    const rm = el('button', '', '移除');
    rm.addEventListener('click', async () => {
      aiState = await window.api.removeAiProject(p);
      renderAi();
    });
    li.appendChild(rm);
    aiWatchList.appendChild(li);
  });

  const h = aiState.hooks || {};
  if (h.error) {
    aiHookStatus.textContent = '設定檔無法讀取';
    aiHookStatus.className = 'ai-hook-status warn';
  } else if (h.installed) {
    aiHookStatus.textContent = '已開啟';
    aiHookStatus.className = 'ai-hook-status ok';
  } else {
    aiHookStatus.textContent = h.partial ? '需要重新開啟' : '未開啟';
    aiHookStatus.className = 'ai-hook-status';
  }
  aiHookBtn.textContent = h.installed ? '關閉' : (h.partial ? '重新開啟' : '開啟');
  aiHookHint.textContent = aiHookMsg || (h.installed
    ? 'Claude 一需要你、或一做完，大師馬上提醒。沒反應時，把 Claude 整個關掉再重新打開。'
    : '開啟後提醒更快更準。會在 Claude 的設定檔加一小段，隨時可以關閉還原。');
}

// 「加入對話」：列出近三天用過的 Claude 對話。排法和 Claude 側欄一樣（同樣的群組、
// 子對話收在母對話底下），最上面多一組「剛剛在用」，還可以打字搜尋。
const aiPicker = document.getElementById('aiSessionPicker');
const aiPickerList = document.getElementById('aiPickerList');
const aiPickerSearch = document.getElementById('aiPickerSearch');
let pickerItems = [];

function closeSessionPicker() {
  aiPicker.hidden = true;
  aiList.hidden = false;
}

async function openSessionPicker() {
  aiPicker.hidden = false;
  aiList.hidden = true;            // 挑選時整頁只剩清單，不被下面的東西擠壓
  if (aiPickerSearch) { aiPickerSearch.value = ''; aiPickerSearch.focus(); }
  aiPickerList.innerHTML = '';
  aiPickerList.appendChild(el('li', 'empty', '讀取中…'));
  pickerItems = await window.api.recentAiSessions();
  renderPicker();
}

function renderPicker() {
  const q = (aiPickerSearch ? aiPickerSearch.value : '').trim().toLowerCase();
  // 沒打字：只看近三天用過的；有打字：連更早的對話一起找
  const items = pickerItems.filter((s) => (q ? (s.title + ' ' + (s.group || '') + ' ' + (s.parentTitle || '') + ' ' + (s.firstPrompt || '')).toLowerCase().includes(q) : s.recent !== false));
  aiPickerList.innerHTML = '';
  if (!items.length) {
    aiPickerList.appendChild(el('li', 'empty', q ? '找不到符合的對話。' : '最近三天沒有用過的 Claude 對話。先去 Claude 開一個對話、說一句話，再回來按「＋ 加入對話」。'));
    return;
  }
  const older = pickerItems.filter((s) => s.recent === false).length;
  const addGroup = (name, list) => {
    if (!list.length) return;
    const head = el('li', 'ai-picker-group');
    head.appendChild(el('span', 'ai-picker-group-name', name));
    head.appendChild(el('span', 'ai-picker-group-count', list.length + ' 個'));
    aiPickerList.appendChild(head);
    list.forEach((s) => addPickerRow(s));
  };
  // 剛剛在用（15 分鐘內）：最可能就是你要找的
  const now = Date.now();
  const recent = q ? [] : items.filter((s) => now - s.mtime < 15 * 60 * 1000);
  addGroup('剛剛在用', recent);
  // 其餘照側欄群組；群組依最近使用排序，組內母對話在前、子對話緊跟在後
  const rest = items.filter((s) => !recent.includes(s));
  const groups = new Map();
  rest.forEach((s) => {
    const key = s.group || '其他';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  });
  groups.forEach((list, name) => {
    const titles = new Set(list.map((s) => s.title));
    const parents = list.filter((s) => !(s.parentTitle && titles.has(s.parentTitle)));
    const ordered = [];
    parents.forEach((p) => {
      ordered.push(p);
      list.filter((c) => c.parentTitle === p.title && c !== p && !parents.includes(c)).forEach((c) => ordered.push(Object.assign({}, c, { child: true })));
    });
    addGroup(name, ordered);
  });
  if (!q && older) aiPickerList.appendChild(el('li', 'empty', `找不到？在上面打幾個字，可以找到更早的 ${older} 個對話。`));
}

function addPickerRow(s) {
  const li = el('li', (s.watched ? 'watched ' : '') + (s.child ? 'child' : ''));
  const text = el('div', 'ai-picker-text');
  text.appendChild(el('span', 'ai-picker-title', s.title));
  // 第二行：你在這個對話說的第一句話（標題是英文或「New session」時靠它辨認）
  // 由別的對話自動開出來的對話，第一句是系統交辦文字，不是你說的話，不顯示
  if (s.firstPrompt && s.firstPrompt !== s.title && !s.firstPrompt.startsWith('Background (')) text.appendChild(el('span', 'ai-picker-first', '「' + s.firstPrompt + '」'));
  text.appendChild(el('span', 'ai-picker-meta', timeAgo(s.mtime) + (s.parentTitle && !s.child ? '・來自「' + s.parentTitle + '」' : '')));
  li.appendChild(text);
  const btn = el('button', '', s.watched ? '已加入' : '加入');
  btn.disabled = s.watched;
  const add = async () => {
    if (s.watched) return;
    s.watched = true;
    aiState = await window.api.addAiSession({ id: s.id, title: s.title, cwd: s.cwd });
    closeSessionPicker();          // 加完就回到對話列表
    renderAi();
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); add(); });
  li.addEventListener('click', add);   // 點整列也可以
  li.appendChild(btn);
  aiPickerList.appendChild(li);
}

document.getElementById('aiAddSession').addEventListener('click', () => {
  if (aiPicker.hidden) openSessionPicker(); else closeSessionPicker();
});
document.getElementById('aiPickerClose').addEventListener('click', closeSessionPicker);
if (aiPickerSearch) aiPickerSearch.addEventListener('input', renderPicker);

document.getElementById('aiAddProject').addEventListener('click', async () => {
  aiState = await window.api.addAiProject();
  renderAi();
});

aiHookBtn.addEventListener('click', async () => {
  const h = aiState.hooks || {};
  const r = h.installed || h.partial ? await window.api.uninstallAiHooks() : await window.api.installAiHooks();
  if (r.state) aiState = r.state;
  if (r.error) aiHookMsg = '失敗：' + r.error;
  else if (r.ok && r.backup) aiHookMsg = '完成。原設定已備份：' + r.backup;
  else if (r.ok) aiHookMsg = '完成。';
  else aiHookMsg = '';
  renderAi();
});

const AI_STATUS = {
  working: { text: '進行中', cls: 'working' },
  waiting: { text: '等你回答', cls: 'waiting' },
  done: { text: '完成', cls: 'done' },
  idle: { text: '休息中', cls: 'idle' }
};

function timeAgo(ms) {
  if (!ms) return '';
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 60) return '剛剛';
  if (sec < 3600) return Math.floor(sec / 60) + ' 分鐘前';
  if (sec < 86400) return Math.floor(sec / 3600) + ' 小時前';
  return Math.floor(sec / 86400) + ' 天前';
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// 對話頁：一份清單。每一列 = 一段對話：狀態、名稱、一行說明、移除。
function renderAi() {
  renderAiConfig();
  aiList.innerHTML = '';
  if (!aiState.enabled) {
    aiList.appendChild(el('p', 'empty big', '追蹤已關閉。到「更多 → 換角色／設定 → 進階設定」可以打開。'));
    return;
  }
  // 即時提醒還沒開：在最上面放一條看得見的提示（開關本體在進階設定裡，新手找不到）
  const hk = aiState.hooks || {};
  if (!hk.installed && !hk.error) {
    const bar = el('div', 'ai-banner');
    bar.appendChild(el('span', '', '開啟「即時提醒」，大師才能馬上通知你，你也才能在泡泡上直接回答 Claude。'));
    const on = el('button', 'primary', '開啟');
    on.addEventListener('click', () => aiHookBtn.click());
    bar.appendChild(on);
    aiList.appendChild(bar);
    // 開啟失敗時，原因直接寫在這裡（不要只寫在收起來的進階設定裡）
    if (aiHookMsg && aiHookMsg.startsWith('失敗')) aiList.appendChild(el('div', 'ai-banner-msg bad', '沒有開成功。' + aiHookMsg.replace(/^失敗：/, '')));
  } else if (hk.installed && aiHookMsg && aiHookMsg.startsWith('完成')) {
    aiList.appendChild(el('div', 'ai-banner-msg ok', '✓ 即時提醒已開啟。'));
  }
  // 目前有動靜的對話（依檔名對應回加入的那一段）
  const live = new Map();
  (aiState.projects || []).forEach((p) => p.sessions.forEach((s) => {
    const m = /([^\\/]+)\.jsonl$/.exec(s.id || '');
    live.set(m ? m[1] : s.id, s);
  }));
  const rows = [];
  (aiState.watchSessions || []).forEach((w) => {
    rows.push({ id: w.id, title: w.title || '對話', s: live.get(w.id), removable: true });
    live.delete(w.id);
  });
  // 透過「整個資料夾」追蹤到的其他對話
  live.forEach((s, id) => rows.push({ id, title: s.title, s, removable: false }));

  if (!rows.length) {
    aiList.appendChild(el('p', 'empty big', '還沒有對話。按上面的「＋ 加入對話」選一個，大師就會幫你盯著。'));
    return;
  }
  const order = { waiting: 0, working: 1, done: 2, idle: 3 };
  rows.sort((a, b) => (order[(a.s || {}).status] ?? 4) - (order[(b.s || {}).status] ?? 4));

  rows.forEach((r) => {
    const s = r.s;
    const st = s ? (AI_STATUS[s.status] || AI_STATUS.idle) : { text: '休息中', cls: 'idle' };
    const row = el('div', 'ai-row ' + st.cls);
    row.appendChild(el('span', 'ai-row-status ' + st.cls, s && s.interrupted && s.status === 'done' ? '已中斷' : st.text));
    const body = el('div', 'ai-row-body');
    body.appendChild(el('div', 'ai-row-title', (s && s.title && s.title !== '（尚無指令）') ? s.title : r.title));
    let line = '';
    if (s) {
      if (s.status === 'waiting') line = 'Claude 在等你回答。點這一列，打開那個對話去回答';
      else if (s.status === 'done') line = s.lastText || '';
      else if (s.status === 'working') line = s.lastAction || s.lastPrompt || '';
      if (line) body.appendChild(el('div', 'ai-row-line', line));
      body.appendChild(el('div', 'ai-row-time', timeAgo(s.lastActivity)));
    }
    row.appendChild(body);
    // 等你回答的那一列可以點：直接開到那個對話
    if (s && s.status === 'waiting' && window.api.focusClaude) {
      row.classList.add('clickable');
      row.addEventListener('click', () => window.api.focusClaude(r.id));
    }
    if (r.removable) {
      const rm = el('button', 'ai-row-remove', '不再追蹤');
      rm.title = '大師不再盯著這個對話；Claude 裡的對話不會被刪除';
      rm.addEventListener('click', async (e) => {
        e.stopPropagation();
        // 先問一次，並講清楚後果：只是不盯了，對話本身還在
        if (!window.confirm('不再追蹤「' + r.title + '」？\n\n只是大師不再盯著它，Claude 裡的對話不會被刪除，之後也可以再加回來。')) return;
        aiState = await window.api.removeAiSession(r.id);
        renderAi();
      });
      row.appendChild(rm);
    }
    aiList.appendChild(row);
  });
}

async function loadAi() {
  aiState = await window.api.listAi();
  renderAi();
}

window.api.onAiUpdate((projects) => {
  aiState.projects = projects;
  renderAi();
});
setInterval(renderAi, 30000);   // 更新「幾分鐘前」

// ---------------------------------------------------------------------------
// 初始載入
// ---------------------------------------------------------------------------
(async function init() {
  renderFolders(await window.api.listFolders());
  renderChanges(await window.api.listChanges());
  renderTasks(await window.api.listTasks());
  await loadSettings();
  await loadQuotes(selectedCharId);
  await loadAi();
})();
