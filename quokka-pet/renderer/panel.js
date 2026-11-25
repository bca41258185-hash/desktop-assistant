// 面板 renderer：分頁切換、聊天、資料夾/變更、任務、設定。
// 全部透過 window.api（preload 暴露）與主行程溝通。

// ---------------------------------------------------------------------------
// 分頁切換
// ---------------------------------------------------------------------------
const tabs = document.querySelectorAll('.tab');
const views = document.querySelectorAll('.panel-view');
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    views.forEach((v) => v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('view-' + tab.dataset.tab).classList.add('active');
  });
});

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
const quoteTitle = document.getElementById('quoteTitle');
const quoteHint = document.getElementById('quoteHint');
const DEFAULT_QUOTE_HINT = quoteHint ? quoteHint.textContent : '';

function renderQuotes(payload) {
  if (!quoteList) return;
  quoteList.innerHTML = '';
  const name = (payload && payload.nameZh) || '';
  if (quoteMaster) quoteMaster.textContent = name;
  if (quoteTitle) quoteTitle.textContent = (payload && payload.title) || '語錄';
  if (quoteHint) quoteHint.textContent = (payload && payload.hint) || DEFAULT_QUOTE_HINT;
  const quotes = (payload && payload.quotes) || [];
  if (!quotes.length) {
    quoteList.innerHTML = '<li class="empty">這個角色目前還沒有收錄語錄。</li>';
    return;
  }
  quotes.forEach((q, index) => {
    const li = document.createElement('li');
    li.className = 'quote-card';

    const zh = document.createElement('div');
    zh.className = 'quote-zh';
    zh.textContent = '「' + q.zh + '」';

    const orig = document.createElement('div');
    orig.className = 'quote-orig';
    orig.textContent = q.original || '';

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
    speakBtn.textContent = (payload && payload.speakLabel) || '說這句';
    speakBtn.addEventListener('click', () => window.api.speakQuote(index));
    actions.appendChild(speakBtn);

    li.appendChild(zh);
    if (q.original) li.appendChild(orig);
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
const setAway = document.getElementById('setAway');
const envHint = document.getElementById('envHint');
const saveStatus = document.getElementById('saveStatus');
const charPicker = document.getElementById('charPicker');

// 目前選用的造型（供儲存設定時一併帶上）
let selectedCharId = (window.CHAR_DEFAULT || 'quokka');

// 動作按鈕：依目前造型的 actionGroups 分組產生（打球／招牌動作）
const actionRows = document.getElementById('actionRows');
function renderActionButtons() {
  if (!actionRows) return;
  const c = (window.CHARACTERS || {})[selectedCharId] || {};
  const groups = c.actionGroups || (c.actions ? [{ title: '動作', ids: c.actions }] : []);
  actionRows.innerHTML = '';
  groups.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'action-row';
    const label = document.createElement('span');
    label.className = 'action-label';
    label.textContent = g.title + '：';
    row.appendChild(label);
    g.ids.forEach((id) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = (c.actionNames && c.actionNames[id]) || id;
      btn.addEventListener('click', () => window.api.playAction(id));
      row.appendChild(btn);
    });
    actionRows.appendChild(row);
  });
}

// 繪製造型選擇器（每張卡 = 縮圖 + 繁中名 + 英文名）；只有一種造型時整區隱藏
function renderCharPicker() {
  const chars = window.CHARACTERS || {};
  const order = window.CHAR_ORDER || Object.keys(chars);
  charPicker.innerHTML = '';
  const charSection = document.getElementById('charSection');
  if (charSection) charSection.hidden = order.length <= 1;
  order.forEach((id) => {
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
      renderActionButtons();
      await window.api.setCharacter(id);   // 立即切換桌寵並持久化
    });
    charPicker.appendChild(card);
  });
  renderActionButtons();
}

async function loadSettings() {
  const s = await window.api.getSettings();
  setProvider.value = s.provider;
  setBaseUrl.value = s.baseUrl;
  setModel.value = s.model;
  setApiKey.value = s.apiKey;
  setReminder.value = s.reminderIntervalMinutes;
  if (setQuoteInterval) setQuoteInterval.value = s.quoteIntervalMinutes;
  if (setAway) setAway.value = s.awayMinutes;
  selectedCharId = s.characterId || selectedCharId;
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
    awayMinutes: Number(setAway && setAway.value),
    characterId: selectedCharId
  });
  saveStatus.textContent = '已儲存 ✓';
  setTimeout(() => (saveStatus.textContent = ''), 2000);
});

// ---------------------------------------------------------------------------
// 初始載入
// ---------------------------------------------------------------------------
// 庫卡檔案卡：顯示個體特徵；「重新生成」會換成另一隻（需確認，因為原本那隻就不見了）
const profileArt = document.getElementById('profileArt');
const profileInfo = document.getElementById('profileInfo');
function renderProfile(res) {
  if (!res || !profileInfo) return;
  if (window.QuokkaArt) {
    window.QuokkaArt.configure(res.traits);
    profileArt.innerHTML = window.QuokkaArt.views().front;
    profileArt.style.setProperty('--band', res.traits.band);
  }
  profileInfo.innerHTML = '';
  res.info.forEach(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    profileInfo.append(dt, dd);
  });
}
const regenBtn = document.getElementById('regenTraits');
if (regenBtn) regenBtn.addEventListener('click', async () => {
  if (!confirm('要換成另一隻新的庫卡嗎？目前這隻的體型與毛色不會保留。')) return;
  renderProfile(await window.api.regenerateTraits());
  renderCharPicker();
});

(async function init() {
  renderFolders(await window.api.listFolders());
  renderChanges(await window.api.listChanges());
  renderTasks(await window.api.listTasks());
  renderProfile(await window.api.getTraits());
  await loadSettings();
  await loadQuotes(selectedCharId);
})();
