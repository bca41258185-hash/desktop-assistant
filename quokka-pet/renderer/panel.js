// 面板（唯一的清單與設定視窗）：一頁式，規格第 3、7、12 節
// 最上面是庫卡名單 → 一個輸入框 → 待辦／提醒／股票／資料夾 → 底部（誰盯著什麼、陪我玩、免責聲明）
// 資料一律以主行程送來的完整快照為準；面板只做「先畫出來」的樂觀更新，主行程回送快照後再對齊。
(function () {
  'use strict';
  const api = window.api;
  const TR = window.QuokkaTraits, ART = window.QuokkaArt, POSE = window.QuokkaPose, PARSE = window.QuokkaParse;
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';

  const HEAD_VB = '27 -8 106 106';            // 頭像取景：頭＋帽子
  const BODY_VB = '-4 -14 168 206';           // 新增卡的全身大圖
  const NAME_MAX = 12;
  const ROSTER_MAX = 6;                       // 名單最多直接顯示 6 隻，其他放進「更多…」（規格 7.1）
  const DONE_LINGER_MS = 3000;                // 完成的待辦劃線後停留 3 秒再移到「已完成」
  const UNDO_MS = 5000;                       // 刪除後 5 秒內可以復原
  const PREGNANCY_MS = 27 * 60 * 1000;
  const POUCH_MS = 10 * 60 * 1000, FOLLOW_MS = 50 * 60 * 1000;
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const PLAYS = [
    { id: 'badminton', icon: '🏸', name: '羽球' },
    { id: 'volleyball', icon: '🏐', name: '排球' },
    { id: 'basketball', icon: '🏀', name: '籃球' },
    { id: 'eat', icon: '🍃', name: '吃葉子' }
  ];
  const ARCH_NAME = { athlete: '運動健將', clingy: '黏人開心果', shy: '害羞小可愛', explorer: '好奇探險家', sleepy: '慵懶睡神', cool: '獨立酷酷派', easy: '隨和好夥伴' };

  // ---------------------------------------------------------------------------
  // 狀態
  // ---------------------------------------------------------------------------
  let S = { quokkas: [], tasks: [], reminders: [], stocks: [], folders: [], relations: {}, settings: {}, quotes: {}, ringing: [] };
  const ui = {
    sel: 'all',              // 'all' 或某隻的 id
    adding: null,            // 新增卡：{ traits, name, err }
    gear: false,             // 這隻的 ⚙ 是否展開
    gearMode: null,          // null | 'delete' | 'regen'
    gearMsg: null,           // ⚙ 裡的錯誤訊息
    globalOpen: false,       // 全域設定
    editing: null,           // 正在原地編輯的待辦 id
    editDraft: '',
    forceType: null,         // 使用者把判斷結果改成 'task' 或 'reminder'
    busy: false,             // 送出中
    msg: null,               // 輸入框下方的結果訊息 { text, kind, action }
    justDone: new Map(),     // 剛完成、還在劃線停留的待辦 id → 計時器
    hidden: new Set(),       // 已經按了刪除、等主行程確認的項目 'kind:id'
    doneOpen: false,         // 「已完成」是否展開
    ringingSeen: new Set(),
    recent: [],              // 最近選過的庫卡 id（新的在前），決定名單直接顯示哪 6 隻
    moreOpen: false,         // 「更多…」是否展開
    moreQuery: '',           // 「更多…」的搜尋字
    menu: null,              // 右鍵選單 { kind, id }
    folderOpen: new Set(),   // 展開「最近的變動」的資料夾 id
    confirmStock: null       // 按了「加入股票」的那段文字（常見英文字要確認）
  };
  let initialized = false;

  // ---------------------------------------------------------------------------
  // 小工具
  // ---------------------------------------------------------------------------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const hm = (t) => { if (t == null) return ''; const d = new Date(t); return isNaN(d) ? String(t) : `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const safeId = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_');
  const keyOf = (kind, id) => kind + ':' + id;
  const KIND_NAME = { task: '待辦', reminder: '提醒', stock: '股票', folder: '資料夾' };
  const LIST_OF = { task: 'tasks', reminder: 'reminders', stock: 'stocks', folder: 'folders' };

  // 名字比對用的正規化：去前後空白、全形轉半形、NFC、英文不分大小寫（規格 7.2）
  function normName(s) {
    return String(s || '')
      .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/　/g, ' ').normalize('NFC').trim().toLowerCase();
  }
  function nameError(name, exceptId) {
    const n = String(name || '').trim();
    if (!n) return '名字不能空白';
    if (n.length > NAME_MAX) return `名字最多 ${NAME_MAX} 個字`;      // 和輸入框 maxlength、主行程的上限一樣用 UTF-16 長度算
    const k = normName(n);
    const dup = S.quokkas.find((q) => q.id !== exceptId && normName(q.name) === k);
    if (dup) return `已經有一隻叫「${dup.name}」了`;
    return '';
  }

  // ---------------------------------------------------------------------------
  // 庫卡相關
  // ---------------------------------------------------------------------------
  const qById = (id) => S.quokkas.find((q) => q.id === id);
  const isJoey = (q) => !!q && (q.stage === 'pouch' || q.stage === 'follow');
  const workers = () => S.quokkas.filter((q) => !isJoey(q));
  const qName = (id) => { const q = qById(id); return q ? q.name : '（已刪除）'; };
  function relationsOf(qid) {
    const out = [];
    Object.entries(S.relations || {}).forEach(([k, r]) => {
      const [a, b] = k.split('|');
      if (a === qid || b === qid) out.push({ other: a === qid ? b : a, ...r });
    });
    return out;
  }
  const hasCouple = (qid) => relationsOf(qid).some((r) => r.couple);
  const hasFriend = (qid) => relationsOf(qid).some((r) => r.friend && !r.couple);
  function ageMonths(q) {
    if (q.birthAt) { const d = (Date.now() - new Date(q.birthAt).getTime()) / 86400000; if (isFinite(d)) return Math.max(0, Math.floor(d)); }
    return (q.traits && q.traits.ageMonths) || 0;
  }
  const ageText = (m) => (m < 24 ? `${m} 個月` : `${Math.floor(m / 12)} 歲`);
  function archetypeName(t) {
    const P = t && t.personality;
    return P ? (ARCH_NAME[P.archetype] || '') : '';
  }
  function traitLine(t, months) {
    if (!t) return '';
    const m = months != null ? months : t.ageMonths;
    return [t.sex === 'male' ? '公' : '母', ageText(m), `頭身長 ${Math.round(t.lengthCm)} cm`,
      (t.fur && t.fur.name ? t.fur.name + '色' : ''), archetypeName(t) && `個性：${archetypeName(t)}`,
      `飾品：${TR.accessoryName(t.accessory)}`].filter(Boolean).join('・');
  }
  // 選「全部」時，新東西交給預設負責人（不會交給跟隨期的小袋鼠）
  function targetOwner() {
    const sel = qById(ui.sel);
    if (sel && !isJoey(sel)) return sel.id;
    if (sel && isJoey(sel)) return null;
    const d = qById(S.settings.defaultOwner);
    if (d && !isJoey(d)) return d.id;
    const w = workers()[0];
    return w ? w.id : null;
  }
  function joeysOf(mom) {
    return S.quokkas.filter((j) => isJoey(j) && (j.mom === mom.id || (mom.joey && mom.joey.id === j.id)));
  }

  // ---------------------------------------------------------------------------
  // 項目
  // ---------------------------------------------------------------------------
  const visible = (kind, it) => !ui.hidden.has(keyOf(kind, it.id));
  function itemsOf(kind, owner) {
    const list = (S[LIST_OF[kind]] || []).filter((it) => visible(kind, it) && (owner === 'all' || it.owner === owner));
    return kind === 'task' ? list.filter((t) => !t.archivedAt) : list;
  }
  function counts(owner) {
    return {
      task: itemsOf('task', owner).filter((t) => !t.done).length,
      reminder: itemsOf('reminder', owner).length,
      stock: itemsOf('stock', owner).length,
      folder: itemsOf('folder', owner).length
    };
  }
  const total = (c) => c.task + c.reminder + c.stock + c.folder;
  // 每隻的上限（和主行程 lib/store.js LIMITS 一樣）；響過的一次性提醒、已完成的待辦不佔名額
  const LIM = { task: 50, reminder: 30, stock: 20, folder: 50 };
  const spentRem = (r) => r.enabled === false && r.rule && r.rule.type === 'once' && !!r.lastFiredAt && !isRinging(r);
  function slots(owner) {
    return { task: S.tasks.filter((t) => t.owner === owner && !t.done).length, reminder: S.reminders.filter((r) => r.owner === owner && !spentRem(r)).length,
      stock: S.stocks.filter((x) => x.owner === owner).length, folder: S.folders.filter((x) => x.owner === owner).length };
  }
  function wouldOverflow(from, to) {
    const a = slots(from), b = slots(to);
    return Object.keys(LIM).some((k) => a[k] && a[k] + b[k] > LIM[k]);
  }
  const isRinging = (r) => !!r.ringing || (S.ringing || []).includes(r.id);

  // 提醒下一次響的時間（毫秒）；用來排序與判斷錯過
  function scheduledAt(r) {
    const rule = r.rule || {};
    if (rule.type === 'once') {
      if (rule.at) return new Date(rule.at).getTime();
      return new Date(`${rule.date}T${rule.time || '00:00'}:00`).getTime();
    }
    const [h, m] = String(rule.time || '00:00').split(':').map(Number);
    const now = new Date();
    for (let i = 0; i < 8; i++) {
      const d = addDays(now, i); d.setHours(h, m, 0, 0);
      if (d.getTime() < now.getTime()) continue;
      if (rule.type === 'daily' || (rule.weekdays || []).includes(d.getDay())) return d.getTime();
    }
    return Infinity;
  }
  // 規則壞掉（缺日期、缺星期、時間超出範圍）：主行程會跳過，面板標成「資料有誤」並當作停用
  function ruleOk(rule) {
    if (!rule || typeof rule !== 'object') return false;
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(rule.time || ''));
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return false;
    if (rule.type === 'daily') return true;
    if (rule.type === 'weekly') return Array.isArray(rule.weekdays) && rule.weekdays.length > 0 && rule.weekdays.every((x) => Number.isInteger(x) && x >= 0 && x <= 6);
    if (rule.type === 'once') { const d = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(rule.date || '')); if (!d) return false; const t = new Date(+d[1], d[2] - 1, +d[3]); return t.getMonth() === d[2] - 1 && t.getDate() === +d[3]; }
    return false;
  }
  // 錯過：主行程報「錯過」時寫入 missedAt；一直顯示到使用者按「知道了」（清掉 missedAt）或下次正常響起
  function isMissed(r) {
    if (!r || isRinging(r)) return false;
    return !!r.missedAt && !isNaN(new Date(r.missedAt).getTime());
  }
  // 提醒的大字時間與規則標籤
  function ruleTag(rule) {
    if (!rule) return '';
    if (rule.type === 'daily') return '每天';
    if (rule.type === 'weekly') {
      const w = (rule.weekdays || []).slice().sort();
      if (w.length === 7) return '每天';
      if (w.join() === '1,2,3,4,5') return '週一到週五';
      return '每週' + w.map((d) => WD[d]).join('');
    }
    const now = new Date();
    const date = rule.at ? ymd(new Date(rule.at)) : rule.date;
    if (date === ymd(now)) return '今天';
    if (date === ymd(addDays(now, 1))) return '明天';
    if (date === ymd(addDays(now, 2))) return '後天';
    const d = new Date(date + 'T00:00:00');
    return isNaN(d) ? date : `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`;
  }
  const ruleTime = (rule) => (rule ? (rule.at ? hm(rule.at) : rule.time) : '');

  // ---------------------------------------------------------------------------
  // 頭像：每隻畫一次放進隱藏的圖庫，名單與清單用 <use> 引用（省記憶體與重畫時間）
  // ---------------------------------------------------------------------------
  const avKeys = new Map();
  function ensureAvatar(q) {
    const sid = 'av-' + safeId(q.id);
    const key = JSON.stringify(q.traits || null) + '|' + (q.stage || '');
    if (avKeys.get(q.id) === key && document.getElementById(sid)) return sid;
    let g = document.getElementById(sid);
    if (!g) { g = document.createElementNS(SVGNS, 'g'); g.id = sid; $('avatarDefs').appendChild(g); }
    let svg = '';
    try {
      if (q.traits) ART.configure(q.traits);
      svg = POSE.svg(-15, 'p' + safeId(q.id), { eyes: 'happy', mouth: 'smile' }, HEAD_VB);
    } catch (e) { svg = ''; } finally { ART.configure(null); }
    g.setAttribute('style', '--band:' + ((q.traits && q.traits.band) || '#e5533d'));
    g.innerHTML = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    avKeys.set(q.id, key);
    return sid;
  }
  function pruneAvatars() {
    const ids = new Set(S.quokkas.map((q) => q.id));
    for (const id of [...avKeys.keys()]) {
      if (!ids.has(id)) { const g = $('av-' + safeId(id)); if (g) g.remove(); avKeys.delete(id); }
    }
  }
  function avatar(q, cls) {
    if (!q) return `<span class="av ${cls || ''} av-missing" aria-hidden="true">?</span>`;
    const sid = ensureAvatar(q);
    return `<span class="av ${cls || ''}" aria-hidden="true"><svg viewBox="${HEAD_VB}" focusable="false"><use href="#${sid}"/></svg></span>`;
  }
  let bigSeq = 0;
  function bigArt(traits) {
    bigSeq += 1;
    try {
      ART.configure(traits);
      return `<div class="big-art" style="--band:${esc(traits.band || '#e5533d')}">${POSE.svg(-15, 'big' + bigSeq, { eyes: 'happy', mouth: 'smile' }, BODY_VB)}</div>`;
    } catch (e) { return ''; } finally { ART.configure(null); }
  }

  // ---------------------------------------------------------------------------
  // 畫面：保留鍵盤焦點（重畫後把焦點放回同一個按鈕）
  // ---------------------------------------------------------------------------
  function keepFocus(fn) {
    const a = document.activeElement;
    const fk = a && a.dataset ? a.dataset.fk : null;
    const sel = a && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
    fn();
    if (fk && (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected || document.activeElement.dataset.fk !== fk)) {
      const el = document.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
      if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* 不是文字框 */ } }
    }
  }
  function render() {
    keepFocus(() => {
      document.documentElement.dataset.motion = S.settings.reducedMotion || 'system';
      pruneAvatars();
      renderRoster();
      renderRosterMore();
      renderComposer();
      renderGlobal();
      renderCard();
      renderLists();
      renderFooter();
    });
  }

  // ---- 名單 ------------------------------------------------------------------
  function chip(q, small) {
    const c = total(counts(q.id));
    const sel = ui.sel === q.id;
    const marks = [];
    if (hasCouple(q.id)) marks.push('<span class="mark heart" aria-hidden="true">♥</span>');
    else if (hasFriend(q.id)) marks.push('<span class="mark star" aria-hidden="true">★</span>');
    let preg = '';
    if (q.pregnancy) {
      const left = Math.max(1, Math.ceil((PREGNANCY_MS - (q.pregnancy.gestationMs || 0)) / 60000));
      preg = `<span class="preg" aria-hidden="true">${left}分</span>`;
    }
    const label = small
      ? `小袋鼠 ${q.name}（點一下取名字）`
      : `${q.name}${c ? `，盯著 ${c} 件事` : ''}${hasCouple(q.id) ? '，有伴侶' : hasFriend(q.id) ? '，有好朋友' : ''}${q.pregnancy ? '，懷孕中' : ''}`;
    return `<button type="button" class="chip${small ? ' joey' : ''}${sel ? ' sel' : ''}" data-act="sel" data-q="${esc(q.id)}"
      ${small ? '' : `data-drop="${esc(q.id)}"`} data-fk="chip:${esc(q.id)}" aria-pressed="${sel}" aria-label="${esc(label)}" title="${esc(label)}">
      <span class="chip-av">${avatar(q)}${!small && c ? `<span class="badge" aria-hidden="true">${c > 99 ? '99+' : c}</span>` : ''}${marks.join('')}${preg}</span>
      <span class="chip-name">${esc(q.name)}</span></button>`;
  }
  // 名單直接顯示哪幾隻：不超過 6 隻就全部；超過時取最近選過的（目前選的那隻一定在內），其餘照原本順序補滿
  function rosterPick() {
    const w = workers();
    if (w.length <= ROSTER_MAX) return { shown: w, many: false };
    const rank = new Map();
    const sel = qById(ui.sel);
    const selWorker = sel ? (isJoey(sel) ? qById(sel.mom) || S.quokkas.find((q) => q.joey && q.joey.id === sel.id) : sel) : null;
    if (selWorker) rank.set(selWorker.id, -1);
    ui.recent.forEach((id, i) => { if (!rank.has(id)) rank.set(id, i); });
    const pick = new Set(w.map((q, i) => ({ q, r: rank.has(q.id) ? rank.get(q.id) : 1e6 + i })).sort((a, b) => a.r - b.r).slice(0, ROSTER_MAX).map((x) => x.q.id));
    return { shown: w.filter((q) => pick.has(q.id)), many: true };
  }
  function renderRoster() {
    const all = ui.sel === 'all';
    const parts = [`<button type="button" class="chip all${all ? ' sel' : ''}" data-act="sel" data-q="all" data-fk="chip:all" aria-pressed="${all}" aria-label="全部，顯示所有庫卡負責的事">
      <span class="chip-av"><span class="av av-all" aria-hidden="true">全</span></span><span class="chip-name">全部</span></button>`];
    const shown = new Set();
    const { shown: list, many } = rosterPick();
    list.forEach((q) => {
      parts.push(chip(q, false)); shown.add(q.id);
      joeysOf(q).forEach((j) => { parts.push(chip(j, true)); shown.add(j.id); });
    });
    if (!many) S.quokkas.filter((q) => !shown.has(q.id)).forEach((j) => parts.push(chip(j, true)));
    else {
      const rest = S.quokkas.length - shown.size;
      if (!ui.moreOpen && ui.moreQuery) ui.moreQuery = '';
      parts.push(`<button type="button" class="chip more${ui.moreOpen ? ' sel' : ''}" data-act="more" data-fk="chip:more" aria-expanded="${ui.moreOpen}" aria-controls="rosterMore"
        aria-label="更多庫卡（還有 ${rest} 隻），可以搜尋名字" title="更多庫卡（還有 ${rest} 隻）">
        <span class="chip-av"><span class="av av-more" aria-hidden="true">+${rest > 99 ? '99' : rest}</span></span><span class="chip-name">更多…</span></button>`);
    }
    if (!many && ui.moreOpen) ui.moreOpen = false;
    parts.push(`<button type="button" class="chip add${ui.adding ? ' sel' : ''}" data-act="new" data-fk="chip:new" aria-label="新增一隻庫卡" title="新增一隻庫卡">
      <span class="chip-av"><span class="av av-add" aria-hidden="true">＋</span></span><span class="chip-name">新增</span></button>`);
    $('roster').innerHTML = parts.join('');
  }
  // 「更多…」：搜尋框＋可捲動的完整名單（只在展開時才畫頭像）
  function moreRow(q) {
    const joey = isJoey(q), c = joey ? 0 : total(counts(q.id)), sel = ui.sel === q.id;
    const mom = joey ? qById(q.mom) : null;
    const sub = joey ? `小袋鼠${mom ? `・${esc(mom.name)}的孩子` : ''}` : c ? `盯著 ${c} 件事` : '還沒有事';
    return `<li data-name="${esc(normName(q.name))}"><button type="button" class="more-item${sel ? ' sel' : ''}" data-act="sel" data-q="${esc(q.id)}" data-fk="more:${esc(q.id)}" aria-pressed="${sel}"
      ${joey ? '' : `data-drop="${esc(q.id)}"`}>${avatar(q, 'sm')}<span class="more-name">${esc(q.name)}</span><span class="more-sub">${sub}</span></button></li>`;
  }
  function renderRosterMore() {
    const el = $('rosterMore');
    if (!el) return;
    if (!ui.moreOpen || !rosterPick().many) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    // 依原本順序列出：每一隻後面接牠的小袋鼠
    const order = [], seen = new Set();
    workers().forEach((q) => { order.push(q); seen.add(q.id); joeysOf(q).forEach((j) => { order.push(j); seen.add(j.id); }); });
    S.quokkas.forEach((q) => { if (!seen.has(q.id)) order.push(q); });
    el.innerHTML = `<div class="more-h"><input type="search" id="rosterSearch" class="text-in more-search" placeholder="找名字…" aria-label="找庫卡的名字" data-fk="more:search" autocomplete="off" spellcheck="false" value="${esc(ui.moreQuery)}">
      <span class="more-count" aria-live="polite"></span>
      <button type="button" class="icon-btn" data-act="more" data-fk="more:close" aria-label="收起更多">✕</button></div>
      <ul class="more-list" role="list">${order.map(moreRow).join('')}</ul><p class="note more-none" hidden>找不到這個名字</p>`;
    filterMore();
  }
  function filterMore() {
    const el = $('rosterMore'); if (!el || el.hidden) return;
    const k = normName(ui.moreQuery);
    let n = 0;
    el.querySelectorAll('.more-list > li').forEach((li) => { const hit = !k || li.dataset.name.includes(k); li.hidden = !hit; if (hit) n++; });
    const none = el.querySelector('.more-none'); if (none) none.hidden = n > 0;
    const cnt = el.querySelector('.more-count'); if (cnt) cnt.textContent = `${n} 隻`;
  }

  // ---- 輸入框 ----------------------------------------------------------------
  const looksLikePath = (s) => /^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/])/.test(s.trim());
  function renderComposer() {
    const input = $('addInput');
    const owner = targetOwner();
    const sel = qById(ui.sel);
    $('composer').hidden = !!ui.adding || ui.globalOpen;
    if (sel && isJoey(sel)) {
      input.disabled = true;
      input.placeholder = '小袋鼠還小，還不能交辦事情';
      input.setAttribute('aria-label', '小袋鼠還不能交辦事情');
    } else {
      input.disabled = !owner;
      const n = owner ? qName(owner) : '庫卡';
      input.placeholder = `交給${n}：任務、提醒（15:30 開會）或股票代號`;
      input.setAttribute('aria-label', `交給${n}的新事情：任務、提醒或股票代號，按 Enter 送出`);
    }
    updateHint();
  }
  // 依目前的文字算出「判斷結果」與可以切換的類型
  function hintFor(text) {
    if (!text.trim()) return null;
    if (looksLikePath(text)) return { line: '→ 監看這個資料夾（送出後確認路徑）', parsed: 'folder' };
    const r = PARSE.parseInput(text, new Date());
    if (r.type === 'none') return null;
    if (ui.forceType === 'task' && r.type !== 'task') {
      return { line: '→ 新增待辦', btn: r.type === 'stock' ? '改回股票' : '改回提醒', next: null, parsed: r.type };
    }
    if (ui.forceType === 'reminder' && r.type === 'task') {
      return { line: '→ 1 小時後提醒（沒寫時間）', btn: '改回待辦', next: null, parsed: r.type };
    }
    const line = PARSE.describe(r, new Date());
    if (r.type === 'task') return { line, btn: '改成提醒', next: 'reminder', parsed: r.type };
    return { line, btn: '改成待辦', next: 'task', parsed: r.type };
  }
  function updateHint() {
    const text = $('addInput').value;
    const hintEl = $('addHint'), sw = $('switchType'), alt = $('altAction');
    const h = ui.msg && ui.msg.kind === 'err' ? null : hintFor(text);
    alt.hidden = true;
    if (h) {
      hintEl.className = 'add-hint';
      hintEl.textContent = h.line;
      if (h.btn) {
        sw.hidden = false; sw.textContent = h.btn; sw.dataset.next = h.next || '';
        sw.setAttribute('aria-label', `判斷錯了？${h.btn}`);
      } else sw.hidden = true;
      return;
    }
    if (ui.msg) {
      hintEl.className = 'add-hint ' + (ui.msg.kind === 'err' ? 'is-err' : 'is-ok');
      hintEl.textContent = ui.msg.text;
      if (ui.msg.action === 'asTask') {
        sw.hidden = false; sw.textContent = '當成待辦'; sw.dataset.next = 'task-submit';
        sw.setAttribute('aria-label', '改成待辦並送出');
      } else sw.hidden = true;
      if (ui.msg.action2 === 'asStock') {                      // 常見英文字查到是股票：問要不要真的盯
        alt.hidden = false; alt.textContent = '加入股票';
        alt.setAttribute('aria-label', '確定要盯這檔股票，加入');
      }
      return;
    }
    hintEl.className = 'add-hint';
    hintEl.textContent = '';
    sw.hidden = true;
  }
  let msgTimer = null;
  function showMsg(text, kind, action, action2) {
    ui.msg = { text, kind, action, action2 };
    clearTimeout(msgTimer);
    if (kind !== 'err') msgTimer = setTimeout(() => { ui.msg = null; updateHint(); }, 4000);
    updateHint();
  }
  async function submit() {
    const input = $('addInput');
    const text = input.value.trim();
    const owner = targetOwner();
    if (!text || !owner || ui.busy) return;
    const h = hintFor(text);
    ui.busy = true;
    // 查股票要連線，可能要等幾秒：先告訴使用者正在查，並鎖住輸入框避免重複送出
    const slow = h && h.parsed === 'stock' && ui.forceType !== 'task';
    if (slow) showMsg('查詢股票中…（連線較慢時要等幾秒）', 'info');
    input.disabled = true;
    const payload = { text, owner };
    if (ui.forceType) payload.forceType = ui.forceType;
    if (ui.confirmStock && ui.confirmStock === text) payload.confirm = true;   // 按了「加入股票」
    ui.confirmStock = null;
    let res;
    try { res = await api.addItem(payload); } catch (e) { res = { ok: false, message: '沒有送出去，請再試一次' }; }
    ui.busy = false;
    input.disabled = false; input.focus();
    if (res && res.ok) {
      input.value = ''; ui.forceType = null;
      const kind = KIND_NAME[res.type] || '';
      showMsg(`✓ 已交給${qName(owner)}${kind ? `（${kind}）` : ''}${res.message ? `：${res.message}` : ''}`, 'ok');
    } else {
      const m = (res && res.message) || '沒有加進去，請再試一次';
      // 主行程問「要當成待辦嗎？」（找不到資料夾、查不到股票、名稱對不上、連不上…）就一定給「當成待辦」按鈕
      const canTask = !!(res && res.askTask) && ui.forceType !== 'task';
      showMsg(m, 'err', canTask ? 'asTask' : null, res && res.askStock ? 'asStock' : null);
    }
  }

  // ---- 全域設定 --------------------------------------------------------------
  function seg(key, options, cur, label) {
    return `<div class="seg" role="radiogroup" aria-label="${esc(label)}">${options.map(([v, t]) =>
      `<button type="button" role="radio" aria-checked="${String(cur) === String(v)}" data-act="set" data-k="${key}" data-v="${esc(v)}" data-fk="set:${key}:${esc(v)}">${esc(t)}</button>`).join('')}</div>`;
  }
  function sw(key, on, label, disabled) {
    return `<button type="button" class="switch" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}" data-act="setb" data-k="${key}" data-fk="set:${key}"${disabled ? ' disabled' : ''}><span></span></button>`;
  }
  function renderGlobal() {
    const el = $('globalSheet');
    $('globalGear').setAttribute('aria-expanded', String(ui.globalOpen));
    $('globalGear').classList.toggle('on', ui.globalOpen);
    el.hidden = !ui.globalOpen;
    if (!ui.globalOpen) { el.innerHTML = ''; return; }
    const st = S.settings || {};
    const romance = st.romance !== false;
    el.innerHTML = `<div class="card">
      <div class="card-h"><h2>設定</h2><button type="button" class="icon-btn" data-act="closeGlobal" data-fk="g:close" aria-label="關閉設定">✕</button></div>
      <div class="set-row"><span class="set-l">股價漲跌多少要反應</span>${seg('stockStepPct', [[1, '1%'], [2, '2%'], [3, '3%']], st.stockStepPct || 1, '股價漲跌多少要反應')}</div>
      <div class="set-row"><span class="set-l">提醒念出來</span>${sw('reminderVoice', st.reminderVoice, '提醒念出來')}</div>
      <div class="set-row"><label class="set-l" for="awayMin">多久沒動算離開</label>
        <span class="num"><input type="number" id="awayMin" min="1" max="120" step="1" value="${esc(st.awayMinutes || 5)}" data-fk="set:away"> 分鐘</span></div>
      <div class="set-row col"><span class="set-l">散步</span>${seg('walk', [['home', '家附近'], ['screen', '整個螢幕'], ['off', '不散步']], st.walk || 'home', '散步範圍')}</div>
      <div class="set-row"><span class="set-l">戀愛系統</span>${sw('romance', romance, '戀愛系統')}</div>
      <div class="set-row"><span class="set-l">寶寶出生${romance ? '' : '<small>（戀愛系統關著）</small>'}</span>${sw('babies', romance && st.babies !== false, '寶寶出生', !romance)}</div>
      <div class="set-row"><span class="set-l">省電<small>（動畫較不流暢）</small></span>${sw('saver', !!st.saver, '省電：開啟後動畫每秒 30 格，比較省電但較不流暢')}</div>
      <div class="set-row col"><span class="set-l">動作減少</span>${seg('reducedMotion', [['system', '跟系統'], ['on', '開'], ['off', '關']], st.reducedMotion || 'system', '動作減少')}</div>
      <div class="set-row"><label class="set-l" for="defOwner">選「全部」時交給</label>
        <select id="defOwner" data-fk="set:defOwner">${workers().map((q) => `<option value="${esc(q.id)}"${q.id === targetOwnerForAll() ? ' selected' : ''}>${esc(q.name)}</option>`).join('')}</select></div>
      <p class="set-foot">目前有 ${S.quokkas.length} 隻庫卡</p>
    </div>`;
  }
  function targetOwnerForAll() {
    const d = qById(S.settings.defaultOwner);
    return d && !isJoey(d) ? d.id : (workers()[0] || {}).id;
  }

  // ---- 卡片：新增庫卡、⚙（每隻）、小袋鼠取名 --------------------------------
  function renderCard() {
    const slot = $('cardSlot');
    if (ui.globalOpen) { slot.innerHTML = ''; return; }
    if (ui.adding) { slot.innerHTML = newCardHTML(); return; }
    const q = qById(ui.sel);
    if (q && isJoey(q)) { slot.innerHTML = joeyCardHTML(q); return; }
    if (q && ui.gear) { slot.innerHTML = gearCardHTML(q); return; }
    slot.innerHTML = '';
  }
  function newCardHTML() {
    const a = ui.adding;
    return `<div class="card newq" role="group" aria-label="新增庫卡">
      <div class="card-h"><h2>新的庫卡</h2><button type="button" class="icon-btn" data-act="cancelNew" data-fk="n:close" aria-label="不新增了">✕</button></div>
      ${bigArt(a.traits)}
      <p class="newq-desc">${esc(traitLine(a.traits))}</p>
      <div class="center"><button type="button" class="btn" data-act="reroll" data-fk="n:reroll"><span class="sym" aria-hidden="true">↻</span> 換一隻</button></div>
      <label class="field-l" for="newName">幫牠取名字</label>
      <input type="text" id="newName" class="text-in" maxlength="${NAME_MAX}" value="${esc(a.name)}" placeholder="最多 ${NAME_MAX} 個字" data-fk="n:name" aria-describedby="newErr" autocomplete="off">
      <p class="err" id="newErr" role="alert">${esc(a.err || '')}</p>
      <button type="button" class="btn primary wide" data-act="create" data-fk="n:create">好了！</button>
    </div>`;
  }
  function regenBlock(q) {
    if (hasCouple(q.id)) return '有伴侶的庫卡不能重新生成（可以換飾品）';
    if (q.pregnancy) return '懷孕中不能重新生成（可以換飾品）';
    if (q.joey || joeysOf(q).length) return '正在帶小袋鼠，不能重新生成（可以換飾品）';
    if (q.mom || q.dad) return '牠是別隻生的，不能重新生成（可以換飾品）';
    return '';
  }
  function gearCardHTML(q) {
    const t = q.traits || {};
    const acc = t.accessory || { type: 'band', color: t.band };
    const def = TR.ACCESSORIES.find((x) => x.id === acc.type) || TR.ACCESSORIES[0];
    const why = regenBlock(q);
    const n = total(counts(q.id));
    const others = workers().filter((w) => w.id !== q.id);
    const lastOne = others.length === 0;
    let danger = '';
    if (ui.gearMode === 'delete') {
      // 放不下的（轉過去會超過每隻的上限）先標出來、不能選；主行程會再檢查一次
      const full = new Set(others.filter((o) => wouldOverflow(q.id, o.id)).map((o) => o.id));
      const firstOk = others.find((o) => !full.has(o.id));
      danger = `<div class="confirm" role="group" aria-label="刪除${esc(q.name)}">
        ${q.pregnancy ? `<p class="warn">${esc(q.name)}懷孕中，刪除後寶寶不會出生。</p>` : ''}
        ${n ? `<p><b>${esc(q.name)}</b>負責的 ${n} 件事要交給誰？</p>
          <div class="radio-list" role="radiogroup" aria-label="交給誰">
          ${others.map((o) => `<label class="radio${full.has(o.id) ? ' is-full' : ''}"><input type="radio" name="xfer" value="${esc(o.id)}"${o === firstOk ? ' checked' : ''}${full.has(o.id) ? ' disabled' : ''}> ${avatar(o, 'sm')} ${esc(o.name)}${full.has(o.id) ? '（放不下了）' : ''}</label>`).join('')}
          <label class="radio"><input type="radio" name="xfer" value="delete"${firstOk ? '' : ' checked'}> 一起刪除</label></div>`
        : `<p>確定要刪除<b>${esc(q.name)}</b>嗎？</p>`}
        ${ui.gearMsg ? `<p class="err" role="alert">${esc(ui.gearMsg)}</p>` : ''}
        <p class="note">刪除庫卡不能復原。</p>
        <div class="btns"><button type="button" class="btn danger" data-act="delGo" data-fk="g:delGo">確定刪除</button>
        <button type="button" class="btn" data-act="gearCancel" data-fk="g:cancel">取消</button></div></div>`;
    } else if (ui.gearMode === 'regen') {
      danger = `<div class="confirm"><p>換成另一隻新的？名字和負責的事會留著，外型、個性會換掉，好感度歸零。</p>
        <div class="btns"><button type="button" class="btn primary" data-act="regenGo" data-fk="g:regenGo">換！</button>
        <button type="button" class="btn" data-act="gearCancel" data-fk="g:cancel">取消</button></div></div>`;
    } else {
      danger = `<div class="btns">
        <button type="button" class="btn" data-act="regenAsk" data-fk="g:regen"${why ? ' disabled aria-describedby="regenWhy"' : ''}><span class="sym" aria-hidden="true">↻</span> 重新生成</button>
        <button type="button" class="btn danger-ghost" data-act="delAsk" data-fk="g:del"${lastOne ? ' disabled aria-describedby="delWhy"' : ''}>刪除牠</button></div>
        ${why ? `<p class="note" id="regenWhy">${esc(why)}</p>` : ''}
        ${lastOne ? '<p class="note" id="delWhy">至少要留 1 隻庫卡，最後一隻不能刪除</p>' : ''}`;
    }
    const profile = TR.describe(t).concat(TR.describePersonality(t));
    return `<div class="card gear" role="group" aria-label="${esc(q.name)}的設定">
      <div class="card-h">${avatar(q, 'md')}<h2>${esc(q.name)}的設定</h2><button type="button" class="icon-btn" data-act="gear" data-fk="g:close" aria-label="收起設定">✕</button></div>
      <label class="field-l" for="gName">名字</label>
      <div class="inline"><input type="text" id="gName" class="text-in" maxlength="${NAME_MAX}" value="${esc(q.name)}" data-fk="g:name" aria-describedby="gErr" autocomplete="off">
        <button type="button" class="btn" data-act="rename" data-fk="g:rename">改名</button></div>
      <p class="err" id="gErr" role="alert">${esc(ui.gearMode === 'delete' ? '' : ui.gearMsg || '')}</p>
      <label class="field-l" for="gAcc">飾品</label>
      <div class="inline"><select id="gAcc" data-fk="g:acc">${TR.ACCESSORIES.map((a) => `<option value="${a.id}"${a.id === def.id ? ' selected' : ''}>${esc(TR.accessoryName({ type: a.id }))}</option>`).join('')}</select></div>
      <div class="swatches" role="radiogroup" aria-label="飾品顏色">${def.colors.map((c, i) =>
        `<button type="button" role="radio" class="swatch" style="--c:${esc(c)}" aria-checked="${c.toLowerCase() === String(acc.color || '').toLowerCase()}" aria-label="顏色 ${i + 1}" data-act="color" data-c="${esc(c)}" data-fk="g:c:${i}"></button>`).join('')}</div>
      <details class="profile"><summary>檔案卡</summary><dl>${profile.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>
      <div class="danger-zone">${danger}</div>
    </div>`;
  }
  function joeyCardHTML(j) {
    const mom = qById(j.mom) || S.quokkas.find((q) => q.joey && q.joey.id === j.id);
    const phase = mom && mom.joey ? mom.joey.phaseMs || 0 : 0;
    const status = j.stage === 'pouch'
      ? `在${mom ? esc(mom.name) : '媽媽'}的育兒袋裡，約 ${Math.max(1, Math.ceil((POUCH_MS - phase) / 60000))} 分鐘後出來`
      : `跟在${mom ? esc(mom.name) : '媽媽'}身邊，約 ${Math.max(1, Math.ceil((POUCH_MS + FOLLOW_MS - phase) / 60000))} 分鐘後長大`;
    return `<div class="card joeyc" role="group" aria-label="小袋鼠${esc(j.name)}">
      <div class="card-h">${avatar(j, 'md')}<h2>小袋鼠 ${esc(j.name)}</h2></div>
      <p class="note">${status}。長大以後就可以交辦事情。</p>
      <label class="field-l" for="jName">幫牠取名字</label>
      <div class="inline"><input type="text" id="jName" class="text-in" maxlength="${NAME_MAX}" value="${esc(j.name)}" data-fk="j:name" aria-describedby="jErr" autocomplete="off">
      <button type="button" class="btn primary" data-act="nameBaby" data-fk="j:go">取名</button></div>
      <p class="err" id="jErr" role="alert">${esc(ui.gearMsg || '')}</p>
    </div>`;
  }

  // ---- 清單 ------------------------------------------------------------------
  const delBtn = (kind, it, label) => `<button type="button" class="del" data-act="del" data-fk="${kind}:${esc(it.id)}:del" aria-label="刪除${KIND_NAME[kind]}「${esc(label)}」" title="刪除">✕</button>`;
  const rowAttrs = (kind, it) => `data-kind="${kind}" data-id="${esc(it.id)}" draggable="${ui.editing === it.id ? 'false' : 'true'}"`;
  function ownerAv(it) { return ui.sel === 'all' ? avatar(qById(it.owner), 'sm own') : ''; }

  function taskRow(t) {
    const done = !!t.done;
    const editing = ui.editing === t.id;
    const body = editing
      ? `<input type="text" class="edit-in" maxlength="200" data-act-input="edit" data-fk="task:${esc(t.id)}:edit" aria-label="修改待辦內容，Enter 儲存、Esc 取消" value="${esc(ui.editDraft)}">`
      : `<button type="button" class="txt" data-act="edit" data-fk="task:${esc(t.id)}:txt" aria-label="修改「${esc(t.text)}」">${esc(t.text)}</button>`;
    return `<li class="row task${done ? ' is-done' : ''}" ${rowAttrs('task', t)}>
      <button type="button" class="check" role="checkbox" aria-checked="${done}" data-act="toggle" data-fk="task:${esc(t.id)}:chk" aria-label="${done ? '取消完成' : '完成'}「${esc(t.text)}」"><span aria-hidden="true">✓</span></button>
      ${ownerAv(t)}${body}${delBtn('task', t, t.text)}</li>`;
  }
  function reminderRow(r) {
    // 響鈴中的一次性提醒：主行程已經把 enabled 設成 false（響過了），但還在響，開關要顯示「開著」
    const ringing = isRinging(r), missed = !ringing && isMissed(r), bad = !ruleOk(r.rule), on = (ringing || r.enabled !== false) && !bad;
    const tags = bad ? ['<span class="tag tag-miss" title="時間或日期有誤，這個提醒不會響">資料有誤</span>'] : [`<span class="tag">${esc(ruleTag(r.rule))}</span>`];
    if (missed) tags.push(`<span class="tag tag-miss" title="${esc('報告錯過的時間：' + hm(r.missedAt))}">錯過</span>`);
    if (!ringing && r.snoozeUntil && new Date(r.snoozeUntil).getTime() > Date.now()) tags.push(`<span class="tag tag-soft">貪睡到 ${esc(hm(r.snoozeUntil))}</span>`);
    return `<li class="row rem${ringing ? ' is-ringing' : ''}${missed ? ' is-missed' : ''}${on ? '' : ' is-off'}" ${rowAttrs('reminder', r)}>
      ${ownerAv(r)}<span class="when">${bad ? '--:--' : esc(ruleTime(r.rule))}</span>
      <div class="rbody"><div class="rtext">${esc(r.text)}</div><div class="tags">${tags.join('')}</div></div>
      <button type="button" class="switch" role="switch" aria-checked="${on}"${bad ? ' disabled' : ''} data-act="remOn" data-fk="reminder:${esc(r.id)}:on" aria-label="提醒「${esc(r.text)}」${on ? '開著' : '關著'}"><span></span></button>
      ${delBtn('reminder', r, r.text)}
      ${ringing ? `<div class="ring"><span class="ring-l"><span class="bell" aria-hidden="true">🔔</span> 響鈴中</span>
        <button type="button" class="btn sm primary" data-act="ack" data-fk="reminder:${esc(r.id)}:ack" aria-label="知道了：${esc(r.text)}">知道了</button>
        <button type="button" class="btn sm" data-act="snooze" data-fk="reminder:${esc(r.id)}:snz" aria-label="5 分鐘後再提醒：${esc(r.text)}">5 分後</button></div>` : ''}
      ${missed ? `<div class="ring miss-row"><span class="ring-l">錯過了這次提醒</span>
        <button type="button" class="btn sm primary" data-act="ackMissed" data-fk="reminder:${esc(r.id)}:ackm" aria-label="知道了，清掉錯過標記：${esc(r.text)}">知道了</button></div>` : ''}</li>`;
  }
  function fmtPrice(p) {
    if (p == null || !isFinite(p)) return '—';
    return Number(p).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function stockInner(s) {
    const q = (S.quotes || {})[s.symbol] || {};
    const name = s.name || q.name || s.symbol;
    const pct = q.pct;
    const dir = pct == null || !isFinite(pct) || Math.abs(pct) < 0.005 ? 'flat' : pct > 0 ? 'up' : 'down';
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '－';
    const pctText = pct == null || !isFinite(pct) ? '—' : `${arrow} ${Math.abs(pct).toFixed(2)}%`;
    const dirName = dir === 'up' ? '漲' : dir === 'down' ? '跌' : '平盤';
    const noQuote = q.price == null || !isFinite(q.price);             // 第一次就抓不到（或還在抓）：不能說成「平盤」
    const status = q.stale ? `<span class="s-stale">暫停更新${q.time ? `・最後 ${esc(hm(q.time))}` : ''}</span>`
      : noQuote ? '<span class="s-wait">還沒拿到報價</span>' : `<span class="s-pct">${esc(pctText)}</span>`;
    const sr = noQuote ? `${name}，${q.stale ? '暫停更新，' : ''}還沒拿到報價`
      : `${name} ${fmtPrice(q.price)}，${q.stale ? '暫停更新' : `${dirName} ${pct != null && isFinite(pct) ? Math.abs(pct).toFixed(2) + '%' : ''}`}`;
    return {
      cls: `stock ${q.stale ? 'is-stale' : noQuote ? 'is-wait' : dir}`,
      html: `<div class="s-top">${ownerAv(s)}<span class="s-name" title="${esc(name)}">${esc(name)}</span>${delBtn('stock', s, name)}</div>
        <div class="s-sym">${esc(s.symbol)}${s.market === 'us' ? '・美股' : ''}</div>
        <div class="s-price"${noQuote ? ' aria-hidden="true"' : ''}>${esc(fmtPrice(q.price))}</div>${status}
        <span class="sr-only">${esc(sr)}</span>`
    };
  }
  function stockCard(s) {
    const x = stockInner(s);
    return `<li class="${x.cls}" ${rowAttrs('stock', s)} data-sym="${esc(s.symbol)}" tabindex="0" role="button" aria-label="${esc(s.name || s.symbol)}，按下看技術指標解說">${x.html}</li>`;
  }
  // 技術指標解說：負責的庫卡用牠的個性講這檔股票今天發生了什麼
  function reportBox() {
    const r = ui.report; if (!r) return '';
    if (r.loading) return `<div class="report" role="status">${esc(r.name)}：我看一下線圖…</div>`;
    if (!r.ok) return `<div class="report">${esc(r.message || '暫時算不出來')}</div>`;
    const v = r.values || {}, n = (x, d = 0) => (x == null || !isFinite(x) ? '–' : Number(x).toFixed(d));
    return `<div class="report" aria-live="polite">
      <div class="report-h"><b>${esc(r.by || '庫卡')}說：</b><button type="button" class="icon-btn" data-act="closeReport" data-fk="report:close" aria-label="收起解說">✕</button></div>
      <p class="report-head">${esc(r.report.headline)}</p>
      <ul class="report-lines">${r.report.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <p class="report-tags">${r.report.tags.map((t) => `<span class="pill">${esc(t)}</span>`).join('')}</p>
      <p class="report-nums">RSI ${n(v.rsi)}｜K ${n(v.k)}／D ${n(v.d)}｜MACD 柱 ${n(v.hist, 2)}｜5 日線 ${n(v.ma5, 1)}｜月線 ${n(v.ma20, 1)}${v.volRatio ? `｜量比 ${n(v.volRatio, 1)}` : ''}</p>
      <p class="report-note">${esc(r.report.disclaimer)}</p></div>`;
  }
  async function openReport(li) {
    const id = li.dataset.id, sym = li.dataset.sym;
    const st = (S.stocks || []).find((x) => x.id === id || x.symbol === sym);
    ui.report = { loading: true, name: (st && st.name) || sym };
    renderLists();
    let res; try { res = await api.stockReport({ id, symbol: sym }); } catch (e) { res = { ok: false }; }
    ui.report = res || { ok: false };
    renderLists();
  }
  // 資料夾：狀態＋最近的變動清單（規格 4.3）。變動只存在主行程記憶體，程式重開後從頭記
  const FC_KIND = { add: '新增', change: '修改', unlink: '刪除', addDir: '新資料夾', unlinkDir: '刪資料夾' };
  function changeSummary(list) {
    const at = list[0].at, batch = list.filter((x) => x.at === at);
    const files = batch.filter((x) => !/Dir$/.test(x.kind)).length, dirs = batch.length - files;
    return `${hm(at)} ${[files && `${files} 個檔案`, dirs && `${dirs} 個資料夾`].filter(Boolean).join('、')}變了`;
  }
  function folderRow(f) {
    const changes = (S.folderChanges || {})[f.id] || [];
    const base = String(f.path).split(/[\\/]/).filter(Boolean).pop() || f.path;
    let pill, below = '', sum = '';
    if (f.status === 'missing') {
      pill = ['找不到', 'bad'];
      below = '<p class="f-missing">找不到這個資料夾（改名、刪掉或隨身碟拔掉了？）。每 5 分鐘會再找一次，找回來就繼續看著。</p>';
    } else if (f.status === 'error') {
      pill = ['讀不到', 'bad'];
      below = '<p class="f-missing">這個資料夾讀不到（權限不夠），先暫停監看。每 5 分鐘會再試一次，讀得到就繼續看著。</p>';
    }
    else if (changes.length) { pill = ['有變動', 'good']; sum = changeSummary(changes); }
    else pill = ['看著中', 'calm'];
    if (changes.length && f.status === 'ok') {
      const open = ui.folderOpen.has(f.id);
      below = `<details class="f-changes" data-fid="${esc(f.id)}"${open ? ' open' : ''}><summary data-fk="folder:${esc(f.id)}:chg">最近的變動（${changes.length}）</summary>
        <ul>${changes.map((c) => `<li title="${esc(c.path)}"><span class="fc-k">${esc(FC_KIND[c.kind] || c.kind)}</span> ${esc(hm(c.at))}　<bdi>${esc(c.path)}</bdi></li>`).join('')}</ul></details>`;
    }
    return `<li class="row folder" ${rowAttrs('folder', f)}>${ownerAv(f)}
      <span class="f-ico" aria-hidden="true">📁</span>
      <span class="f-text"><span class="f-name">${esc(base)}</span><span class="f-path" title="${esc(f.path)}"><bdi>${esc(f.path)}</bdi></span>${sum ? `<span class="f-sum">${esc(sum)}</span>` : ''}</span>
      <span class="pill ${pill[1]}">${esc(pill[0])}</span>${delBtn('folder', f, f.path)}${below}</li>`;
  }
  function section(kind, title, count, inner, extra) {
    return `<section class="sec sec-${kind}" aria-label="${title}">
      <div class="sec-h"><h2>${title}<span class="count">${count}</span></h2>${extra || ''}</div>${inner}</section>`;
  }
  function renderLists() {
    const el = $('lists');
    const sel = qById(ui.sel);
    if (ui.adding || ui.globalOpen || (sel && isJoey(sel))) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    const owner = ui.sel;
    const out = [];
    // 待辦
    const tasks = itemsOf('task', owner);
    const active = tasks.filter((t) => !t.done || ui.justDone.has(t.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    const done = tasks.filter((t) => t.done && !ui.justDone.has(t.id)).sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')));
    if (active.length || done.length) {
      const doneBox = done.length ? `<details class="done-box"${ui.doneOpen ? ' open' : ''}><summary data-fk="doneSum">已完成（${done.length}）</summary><ul class="list">${done.map(taskRow).join('')}</ul></details>` : '';
      out.push(section('task', '待辦', active.filter((t) => !t.done).length, `<ul class="list">${active.map(taskRow).join('')}</ul>${doneBox}`));
    }
    // 提醒：響鈴中、錯過的排最上面
    const rems = itemsOf('reminder', owner).map((r) => ({ r, ring: isRinging(r), miss: isMissed(r), at: scheduledAt(r) }));
    if (rems.length) {
      const off = (r) => r.enabled === false || !ruleOk(r.rule);
      rems.sort((a, b) => (b.ring - a.ring) || (b.miss - a.miss) || (off(a.r) - off(b.r)) || (a.at - b.at));
      out.push(section('reminder', '提醒', rems.length, `<ul class="list">${rems.map((x) => reminderRow(x.r)).join('')}</ul>`));
    }
    // 股票
    const stocks = itemsOf('stock', owner);
    if (stocks.length) out.push(section('stock', '股票', stocks.length, `<ul class="stocks">${stocks.map(stockCard).join('')}</ul><p class="tip">點一檔股票，負責的庫卡會用技術指標說說今天發生了什麼</p>${reportBox()}`));
    // 資料夾
    const folders = itemsOf('folder', owner);
    const addFolder = `<button type="button" class="link-btn" data-act="pickFolder" data-fk="pickFolder" aria-label="加入要監看的資料夾">＋ 資料夾</button>`;
    if (folders.length) out.push(section('folder', '資料夾', folders.length, `<ul class="list">${folders.map(folderRow).join('')}</ul>`, addFolder));
    if (!out.length) {
      const who = qName(targetOwner());
      out.push(`<div class="empty"><p>${owner === 'all' ? '還沒有交辦任何事。' : `${esc(who)}現在沒事做。`}</p>
        <p class="note">在上面的框打一件事，例如「回覆業主信件」「15:30 開會」「2330」，按 Enter 就交給${esc(who)}。</p>
        <p>${addFolder}</p></div>`);
    } else if (!folders.length) {
      out.push(`<div class="more-row">${addFolder}</div>`);
    }
    el.innerHTML = out.join('');
    if (ui.editing) {
      const inp = el.querySelector('.edit-in');
      if (inp && document.activeElement !== inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
  }
  // 股價跳動：只更新那幾張小卡，不重畫整頁
  function patchStock(symbol) {
    document.querySelectorAll(`.stock[data-sym="${CSS.escape(symbol)}"]`).forEach((li) => {
      const s = S.stocks.find((x) => x.id === li.dataset.id);
      if (!s) return;
      const x = stockInner(s);
      const had = document.activeElement && li.contains(document.activeElement);
      li.className = x.cls; li.innerHTML = x.html;
      if (had) { const b = li.querySelector('.del'); if (b) b.focus(); }
    });
  }

  // ---- 底部 ------------------------------------------------------------------
  function renderFooter() {
    const q = qById(ui.sel);
    const line = $('ownerLine');
    if (ui.globalOpen || ui.adding) line.innerHTML = '';
    else if (q && !isJoey(q)) {
      const c = counts(q.id);
      const parts = [['待辦', c.task], ['提醒', c.reminder], ['股票', c.stock], ['資料夾', c.folder]].filter((x) => x[1]).map((x) => `${x[0]} ${x[1]}`);
      const arch = archetypeName(q.traits);
      const preg = q.pregnancy ? `｜懷孕中，約 ${Math.max(1, Math.ceil((PREGNANCY_MS - (q.pregnancy.gestationMs || 0)) / 60000))} 分鐘後出生` : '';
      line.innerHTML = `<span class="ol-text">${esc(q.name)}盯著：${parts.length ? esc(parts.join('、')) : '還沒有事'}${arch ? `<span class="sep">｜</span><span class="nowrap">個性：${esc(arch)}</span>` : ''}${esc(preg)}</span>
        <button type="button" class="icon-btn gear-btn${ui.gear ? ' on' : ''}" data-act="gear" data-fk="gear" aria-expanded="${ui.gear}" aria-label="${esc(q.name)}的設定：改名、飾品、重新生成、刪除">⚙</button>`;
    } else if (!q) {
      const n = S.tasks.filter((t) => !t.archivedAt && !t.done).length + S.reminders.length + S.stocks.length + S.folders.length;
      line.innerHTML = `<span class="ol-text">${workers().length} 隻庫卡・一共盯著 ${n} 件事<span class="sep">｜</span>交給：${esc(qName(targetOwnerForAll()))}</span>`;
    } else line.innerHTML = '';
    const target = q || workers()[0];
    const tName = target ? target.name : '庫卡';
    $('playRow').hidden = !!ui.globalOpen || !!ui.adding || !target;
    $('playRow').innerHTML = `<span class="play-l">陪<b>${esc(tName)}</b>玩</span>${PLAYS.map((p) =>
      `<button type="button" class="play" data-act="play" data-a="${p.id}" data-fk="play:${p.id}" aria-label="叫${esc(tName)}${p.name === '吃葉子' ? '吃葉子' : '打' + p.name}" title="${p.name}"><span aria-hidden="true">${p.icon}</span></button>`).join('')}`;
    const hasStocks = !ui.adding && !ui.globalOpen && itemsOf('stock', ui.sel).length > 0 && !(q && isJoey(q));
    $('disclaimer').hidden = !hasStocks;
    $('footer').hidden = !!ui.globalOpen || !!ui.adding;
  }

  // ---------------------------------------------------------------------------
  // 動作
  // ---------------------------------------------------------------------------
  function select(qid) {
    if (qid !== 'all' && !qById(qid)) qid = 'all';
    const changed = ui.sel !== qid;
    ui.sel = qid; ui.adding = null; ui.globalOpen = false; ui.editing = null;
    if (qid !== 'all') ui.recent = [qid].concat(ui.recent.filter((x) => x !== qid)).slice(0, 100);
    const fromMore = ui.moreOpen; ui.moreOpen = false;
    if (changed) { ui.gear = false; ui.gearMode = null; ui.gearMsg = null; ui.forceType = null; ui.msg = null; }
    render();
    if (fromMore) { const c = document.querySelector(`[data-fk="chip:${CSS.escape(qid)}"]`); if (c) { c.focus({ preventScroll: true }); c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } }
    if (changed && api.setSettings) api.setSettings({ panelOwner: qid }).catch(() => {});
  }
  function findItem(kind, id) { return (S[LIST_OF[kind]] || []).find((x) => x.id === id); }
  function itemLabel(kind, it) { return kind === 'stock' ? (it.name || it.symbol) : kind === 'folder' ? it.path : it.text; }

  async function toggleTask(id) {
    const t = findItem('task', id); if (!t) return;
    const done = !t.done;
    t.done = done; t.doneAt = done ? new Date().toISOString() : null;      // 先畫出來
    clearTimeout(ui.justDone.get(id)); ui.justDone.delete(id);
    if (done) ui.justDone.set(id, setTimeout(() => { ui.justDone.delete(id); keepFocus(renderLists); }, DONE_LINGER_MS));
    render();
    await api.updateItem({ kind: 'task', id, patch: { done } });
  }
  let toastTimer = null;
  async function removeItem(kind, id) {
    const it = findItem(kind, id); if (!it) return;
    const k = keyOf(kind, id);
    ui.hidden.add(k);
    // 焦點移到下一個項目，避免掉到頁首
    const row = document.querySelector(`[data-kind="${kind}"][data-id="${CSS.escape(id)}"]`);
    const next = row && (row.nextElementSibling || row.previousElementSibling);
    render();
    if (next) { const b = document.querySelector(`[data-kind="${next.dataset.kind}"][data-id="${CSS.escape(next.dataset.id || '')}"] button`); if (b) b.focus(); }
    let res;
    try { res = await api.removeItem({ kind, id }); } catch (e) { res = { ok: false }; }
    if (!res || !res.ok) { ui.hidden.delete(k); render(); showToast(`沒有刪掉「${itemLabel(kind, it)}」，請再試一次`); return; }
    showToast(`已刪除${KIND_NAME[kind]}「${itemLabel(kind, it)}」`, res.undoToken ? async () => {
      await api.undo(res.undoToken);
      ui.hidden.delete(k); render();
    } : null);
    setTimeout(() => ui.hidden.delete(k), UNDO_MS + 2000);
  }
  function showToast(text, onUndo) {
    const el = $('toast');
    clearTimeout(toastTimer);
    el.innerHTML = `<span class="toast-t">${esc(text)}</span>${onUndo ? '<button type="button" class="btn sm" id="undoBtn">復原</button>' : ''}`;
    el.hidden = false;
    if (onUndo) $('undoBtn').addEventListener('click', () => { clearTimeout(toastTimer); el.hidden = true; onUndo(); });
    toastTimer = setTimeout(() => { el.hidden = true; }, UNDO_MS);
  }
  function startEdit(id) {
    const t = findItem('task', id); if (!t) return;
    ui.editing = id; ui.editDraft = t.text;
    renderLists();
  }
  async function finishEdit(save) {
    const id = ui.editing; if (!id) return;
    const t = findItem('task', id);
    const text = ui.editDraft.trim();
    ui.editing = null;
    if (save && t && text && text !== t.text) {
      t.text = text;
      api.updateItem({ kind: 'task', id, patch: { text } });
    }
    keepFocus(renderLists);
    const b = document.querySelector(`[data-fk="task:${CSS.escape(id)}:txt"]`);
    if (b) b.focus();
  }
  async function reassign(kind, id, owner) {
    const it = findItem(kind, id);
    if (!it || it.owner === owner) return;
    const from = it.owner;
    it.owner = owner;                                      // 先畫出來
    render();
    let res;
    try { res = await api.reassign({ kind, id, owner }); } catch (e) { res = { ok: false }; }
    if (res && res.ok === false) { it.owner = from; render(); showToast(res.message || '沒有換成功，請再試一次'); return; }
    showToast(`已把「${itemLabel(kind, it)}」交給${qName(owner)}`);
  }

  // ---- 新增庫卡 ----
  function openNew() {
    ui.adding = { traits: TR.generate(), name: '', err: '' };
    ui.globalOpen = false; ui.gear = false;
    render();
    const n = $('newName'); if (n) n.focus();
  }
  async function createQuokka() {
    const a = ui.adding; if (!a) return;
    const name = ($('newName') ? $('newName').value : a.name).trim();
    a.name = name;
    a.err = nameError(name);
    if (a.err) { render(); $('newName').focus(); return; }
    let res;
    try { res = await api.createQuokka({ name, traits: a.traits }); } catch (e) { res = { ok: false, message: '沒有新增成功，請再試一次' }; }
    if (!res || !res.ok) { a.err = (res && res.message) || '沒有新增成功，請再試一次'; render(); return; }
    ui.adding = null;
    const created = (res.qid && qById(res.qid)) || S.quokkas.find((q) => normName(q.name) === normName(name));
    pendingSelectName = created ? null : name;
    select(created ? created.id : ui.sel);
    $('addInput').focus();
  }
  let pendingSelectName = null;           // 主行程的快照比回覆晚到時，等快照到了再切過去

  // ---- ⚙（每隻）----
  async function doRename() {
    const q = qById(ui.sel); if (!q) return;
    const name = $('gName').value.trim();
    const err = nameError(name, q.id);
    if (err) { ui.gearMsg = err; render(); $('gName').focus(); return; }
    if (name === q.name) return;
    const res = await api.renameQuokka({ qid: q.id, name }).catch(() => ({ ok: false }));
    ui.gearMsg = res && res.ok ? null : (res && res.message) || '沒有改成功，請再試一次';
    if (res && res.ok) { q.name = name; showToast(`改好了，現在叫「${name}」`); }
    render();
  }
  async function doAccessory(type, color) {
    const q = qById(ui.sel); if (!q) return;
    const cur = (q.traits && q.traits.accessory) || {};
    const def = TR.ACCESSORIES.find((x) => x.id === type);
    if (!def) return;
    const acc = { type, color: color || (def.colors.includes(cur.color) ? cur.color : def.colors[0]) };
    // 第二件飾品：部位不衝突才保留
    if (cur.extra) {
      const ex = TR.ACCESSORIES.find((x) => x.id === cur.extra.type);
      if (ex && ex.slot !== def.slot && !((def.slot === 'head' || def.slot === 'ear') && (ex.slot === 'head' || ex.slot === 'ear'))) acc.extra = cur.extra;
    }
    q.traits = { ...q.traits, accessory: acc };               // 先畫出來
    render();
    const res = await api.setAccessory({ qid: q.id, accessory: acc }).catch(() => ({ ok: false }));
    if (res && res.ok === false) { ui.gearMsg = res.message || '沒有換成功，請再試一次'; render(); }
  }
  async function doRegen() {
    const q = qById(ui.sel); if (!q) return;
    const res = await api.regenerateQuokka({ qid: q.id }).catch(() => ({ ok: false }));
    ui.gearMode = null;
    ui.gearMsg = res && res.ok ? null : (res && res.message) || '沒有換成功';
    render();
  }
  async function doDelete() {
    const q = qById(ui.sel); if (!q) return;
    const pick = document.querySelector('input[name="xfer"]:checked');
    const transferTo = pick ? pick.value : 'delete';
    const res = await api.deleteQuokka({ qid: q.id, transferTo }).catch(() => ({ ok: false }));
    // 新主人放不下（超過上限）：留在確認畫面，讓使用者選別隻或「一起刪除」
    if (res && res.full) { ui.gearMsg = res.message; render(); const r = document.querySelector('input[name="xfer"]:checked'); if (r) r.focus(); return; }
    if (!res || !res.ok) { ui.gearMsg = (res && res.message) || '沒有刪除成功'; ui.gearMode = null; render(); return; }
    const name = q.name;
    ui.gear = false; ui.gearMode = null;
    select(transferTo !== 'delete' && qById(transferTo) ? transferTo : 'all');
    showToast(`已刪除${name}`);
  }
  async function doNameBaby() {
    const j = qById(ui.sel); if (!j) return;
    const name = $('jName').value.trim();
    const err = nameError(name, j.id);
    if (err) { ui.gearMsg = err; render(); $('jName').focus(); return; }
    const res = await api.nameBaby({ qid: j.id, name }).catch(() => ({ ok: false }));
    ui.gearMsg = res && res.ok ? null : (res && res.message) || '沒有取名成功';
    if (res && res.ok) { j.name = name; showToast(`歡迎${name}！`); }
    render();
  }

  // ---- 右鍵選單「交給…」----
  function openMenu(kind, id, x, y) {
    const it = findItem(kind, id); if (!it) return;
    const list = workers().filter((q) => q.id !== it.owner);
    if (!list.length) return;
    ui.menu = { kind, id, returnFocus: document.activeElement };
    const m = $('menu');
    const search = list.length > 6 ? '<input type="text" class="menu-search" placeholder="找名字…" aria-label="找名字">' : '';
    m.innerHTML = `<p class="menu-h">把「${esc(itemLabel(kind, it))}」交給…</p>${search}<div class="menu-items">${list.map((q) =>
      `<button type="button" role="menuitem" class="menu-item" data-owner="${esc(q.id)}" data-name="${esc(normName(q.name))}">${avatar(q, 'sm')}<span>${esc(q.name)}</span></button>`).join('')}</div>`;
    m.hidden = false;
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    const first = m.querySelector('.menu-search') || m.querySelector('.menu-item');
    if (first) first.focus();
  }
  function closeMenu(restore) {
    if (!ui.menu) return;
    const back = ui.menu.returnFocus;
    ui.menu = null; $('menu').hidden = true; $('menu').innerHTML = '';
    if (restore && back && back.isConnected) back.focus();
  }

  // ---------------------------------------------------------------------------
  // 事件
  // ---------------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const mi = e.target.closest('.menu-item');
    if (mi && ui.menu) { const { kind, id } = ui.menu; closeMenu(true); reassign(kind, id, mi.dataset.owner); return; }
    if (ui.menu && !e.target.closest('#menu')) closeMenu(false);
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const row = b.closest('[data-kind]');
    const kind = row && row.dataset.kind, id = row && row.dataset.id;
    switch (b.dataset.act) {
      case 'closeReport': ui.report = null; renderLists(); break;
      case 'sel': select(b.dataset.q); break;
      case 'more': {
        ui.moreOpen = !ui.moreOpen; render();
        const f = ui.moreOpen ? $('rosterSearch') : document.querySelector('[data-fk="chip:more"]');
        if (f) f.focus();
        break;
      }
      case 'new': ui.adding ? (ui.adding = null, render()) : openNew(); break;
      case 'cancelNew': ui.adding = null; render(); $('roster').querySelector('[data-act="new"]').focus(); break;
      case 'reroll': ui.adding.traits = TR.generate(); ui.adding.name = $('newName').value; render(); break;
      case 'create': createQuokka(); break;
      case 'toggle': toggleTask(id); break;
      case 'edit': startEdit(id); break;
      case 'del': removeItem(kind, id); break;
      case 'remOn': {
        const r = findItem('reminder', id); if (!r) break;
        const next = b.getAttribute('aria-checked') !== 'true';      // 照畫面上看到的切換（響鈴中顯示「開著」，按了就關掉並停止響鈴）
        r.enabled = next;
        if (!next && isRinging(r)) { r.ringing = false; S.ringing = (S.ringing || []).filter((x) => x !== r.id); }
        render();
        // 主行程可能回一句說明（例如一次性提醒時間已過 → 改到明天同一時間）或擋下（名額滿了）
        Promise.resolve(api.updateItem({ kind: 'reminder', id, patch: { enabled: next } })).then((res) => {
          if (res && res.message) showToast(res.message);
          if (res && res.ok === false) { r.enabled = !next; render(); }
        }).catch(() => {});
        break;
      }
      case 'ack': api.ackAlert({ reminderId: id }); break;
      case 'ackMissed': {                                   // 先畫出來，主行程清掉 missedAt 後回送快照
        const r = findItem('reminder', id); if (r) { delete r.missedAt; render(); }
        api.ackAlert({ reminderId: id });
        break;
      }
      case 'snooze': api.snoozeAlert({ reminderId: id }); break;
      case 'pickFolder': {
        const owner = targetOwner(); if (!owner) break;
        api.pickFolder({ owner }).then((res) => { if (res && res.message) showMsg(res.message, res.ok === false ? 'err' : 'ok'); }).catch(() => {});
        break;
      }
      case 'gear': ui.gear = !ui.gear; ui.gearMode = null; ui.gearMsg = null; render();
        if (ui.gear) { const n = $('gName'); if (n) { n.focus({ preventScroll: true }); n.closest('.card').scrollIntoView({ block: 'nearest' }); } } else { const g = document.querySelector('[data-fk="gear"]'); if (g) g.focus(); }
        break;
      case 'gearCancel': ui.gearMode = null; render(); break;
      case 'rename': doRename(); break;
      case 'color': doAccessory($('gAcc').value, b.dataset.c); break;
      case 'regenAsk': ui.gearMode = 'regen'; render(); break;
      case 'regenGo': doRegen(); break;
      case 'delAsk': ui.gearMode = 'delete'; ui.gearMsg = null; render(); break;
      case 'delGo': doDelete(); break;
      case 'nameBaby': doNameBaby(); break;
      case 'play': {
        const q = qById(ui.sel) || workers()[0];
        if (q) api.play({ qid: q.id, action: b.dataset.a });
        break;
      }
      case 'closeGlobal': ui.globalOpen = false; render(); $('globalGear').focus(); break;
      case 'set': {
        const k = b.dataset.k; let v = b.dataset.v;
        if (k === 'stockStepPct') v = Number(v);
        S.settings[k] = v; render(); api.setSettings({ [k]: v });
        break;
      }
      case 'setb': {
        const k = b.dataset.k; const v = b.getAttribute('aria-checked') !== 'true';
        S.settings[k] = v; render(); api.setSettings({ [k]: v });
        break;
      }
      default: break;
    }
  });
  document.addEventListener('click', (e) => {
    const li = e.target.closest && e.target.closest('li[data-sym]');
    if (li && !e.target.closest('button')) openReport(li);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('li[data-sym]')) { e.preventDefault(); openReport(e.target); }
  });
  $('globalGear').addEventListener('click', () => { ui.globalOpen = !ui.globalOpen; ui.adding = null; render(); });
  $('altAction').addEventListener('click', () => {
    ui.confirmStock = $('addInput').value.trim(); ui.forceType = null; ui.msg = null; submit();
  });
  $('switchType').addEventListener('click', () => {
    const next = $('switchType').dataset.next;
    if (next === 'task-submit') { ui.forceType = 'task'; ui.msg = null; submit(); return; }
    ui.forceType = next || null;
    updateHint();
    $('addInput').focus();
  });

  const addInput = $('addInput');
  addInput.addEventListener('input', () => {
    if (!addInput.value.trim()) ui.forceType = null;
    if (ui.msg && ui.msg.kind === 'err') ui.msg = null;
    updateHint();
  });
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); }
    else if (e.key === 'Escape' && addInput.value) { e.preventDefault(); addInput.value = ''; ui.forceType = null; updateHint(); }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.classList.contains('edit-in')) ui.editDraft = t.value;
    if (t.id === 'newName' && ui.adding) { ui.adding.name = t.value; }
    if (t.id === 'rosterSearch') { ui.moreQuery = t.value; filterMore(); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'gAcc') doAccessory(t.value);
    else if (t.id === 'awayMin') {
      const v = Math.max(1, Math.min(120, Math.round(Number(t.value) || 5)));
      t.value = v; S.settings.awayMinutes = v; api.setSettings({ awayMinutes: v });
    } else if (t.id === 'defOwner') { S.settings.defaultOwner = t.value; render(); api.setSettings({ defaultOwner: t.value }); }
  });
  document.addEventListener('toggle', (e) => {
    if (e.target.classList && e.target.classList.contains('done-box')) ui.doneOpen = e.target.open;
    if (e.target.classList && e.target.classList.contains('f-changes')) { const id = e.target.dataset.fid; if (e.target.open) ui.folderOpen.add(id); else ui.folderOpen.delete(id); }
  }, true);
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.classList && t.classList.contains('edit-in')) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finishEdit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
      return;
    }
    if (e.key === 'Enter' && !e.isComposing) {
      if (t.id === 'newName') { e.preventDefault(); createQuokka(); return; }
      if (t.id === 'gName') { e.preventDefault(); doRename(); return; }
      if (t.id === 'jName') { e.preventDefault(); doNameBaby(); return; }
      if (t.id === 'rosterSearch') {                       // Enter：選第一個符合的
        e.preventDefault();
        const first = [...$('rosterMore').querySelectorAll('.more-list > li:not([hidden]) .more-item')][0];
        if (first) select(first.dataset.q);
        return;
      }
    }
    if (ui.menu) {
      const items = [...$('menu').querySelectorAll('.menu-item:not([hidden])')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0])?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1])?.focus(); }
      return;
    }
    if (e.key === 'Escape') {
      if (ui.moreOpen) { ui.moreOpen = false; render(); const m = document.querySelector('[data-fk="chip:more"]'); if (m) m.focus(); }
      else if (ui.adding) { ui.adding = null; render(); }
      else if (ui.globalOpen) { ui.globalOpen = false; render(); $('globalGear').focus(); }
      else if (ui.gearMode) { ui.gearMode = null; render(); }
      else if (ui.gear) { ui.gear = false; render(); }
      return;
    }
    // 名單裡用左右鍵移動
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && t.closest && t.closest('#roster')) {
      const chips = [...$('roster').querySelectorAll('.chip')];
      const i = chips.indexOf(t.closest('.chip'));
      const n = chips[i + (e.key === 'ArrowRight' ? 1 : -1)];
      if (n) { e.preventDefault(); n.focus(); }
    }
  });
  document.addEventListener('focusout', (e) => {
    // 原地編輯：離開輸入框就儲存
    if (e.target.classList && e.target.classList.contains('edit-in') && ui.editing) setTimeout(() => { if (ui.editing && !document.activeElement.classList.contains('edit-in')) finishEdit(true); }, 0);
  });
  $('menu').addEventListener('input', (e) => {
    if (!e.target.classList.contains('menu-search')) return;
    const k = normName(e.target.value);
    $('menu').querySelectorAll('.menu-item').forEach((b) => { b.hidden = !!k && !b.dataset.name.includes(k); });
  });

  // 右鍵（或鍵盤的選單鍵、Shift+F10）→「交給…」
  document.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('#lists [data-kind]');
    if (!row) return;
    e.preventDefault();
    let x = e.clientX, y = e.clientY;
    if (!x && !y) { const r = row.getBoundingClientRect(); x = r.left + 24; y = r.bottom; }
    openMenu(row.dataset.kind, row.dataset.id, x, y);
  });

  // 拖到名單上的頭像 → 換負責的那隻
  document.addEventListener('dragstart', (e) => {
    const row = e.target.closest && e.target.closest('#lists [data-kind]');
    if (!row) return;
    e.dataTransfer.setData('application/x-quokka-item', JSON.stringify({ kind: row.dataset.kind, id: row.dataset.id }));
    e.dataTransfer.effectAllowed = 'move';
    document.body.classList.add('dragging');
    row.classList.add('is-drag');
  });
  // 拖曳結束：放下後清單會重畫、被拖的那一列可能已經不在（換了負責人），dragend 就傳不到，
  // 所以放下時、以及之後滑鼠一動（沒有按著）時都要清掉
  function endDrag() {
    document.body.classList.remove('dragging');
    document.querySelectorAll('.is-drag, .drop-over').forEach((x) => x.classList.remove('is-drag', 'drop-over'));
  }
  document.addEventListener('dragend', endDrag);
  document.addEventListener('drop', endDrag);
  document.addEventListener('mousemove', (e) => { if (!e.buttons && document.body.classList.contains('dragging')) endDrag(); });
  // 名單與「更多…」清單都可以當放下的目標
  [$('roster'), $('rosterMore')].filter(Boolean).forEach((roster) => {
  roster.addEventListener('dragover', (e) => {
    const c = e.target.closest('[data-drop]');
    if (!c || !e.dataTransfer.types.includes('application/x-quokka-item')) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    roster.querySelectorAll('.drop-over').forEach((x) => x !== c && x.classList.remove('drop-over'));
    c.classList.add('drop-over');
  });
  roster.addEventListener('dragleave', (e) => {
    const c = e.target.closest('[data-drop]');
    if (c && !c.contains(e.relatedTarget)) c.classList.remove('drop-over');
  });
  roster.addEventListener('drop', (e) => {
    const c = e.target.closest('[data-drop]');
    if (!c) return;
    e.preventDefault();
    let d = null;
    try { d = JSON.parse(e.dataTransfer.getData('application/x-quokka-item')); } catch (err) { return; }
    endDrag();
    if (d) reassign(d.kind, d.id, c.dataset.drop);
  });
  });

  // ---------------------------------------------------------------------------
  // 主行程的資料
  // ---------------------------------------------------------------------------
  function announceRinging() {
    const now = new Set(S.reminders.filter(isRinging).map((r) => r.id));
    const fresh = S.reminders.filter((r) => now.has(r.id) && !ui.ringingSeen.has(r.id));
    if (fresh.length && initialized) {
      $('announcer').textContent = fresh.map((r) => `${qName(r.owner)}提醒你：${ruleTime(r.rule)} ${r.text}`).join('。');
    }
    ui.ringingSeen = now;
  }
  function applyState(snap) {
    if (!snap) return;
    S = {
      quokkas: [], tasks: [], reminders: [], stocks: [], folders: [], relations: {}, quotes: {}, ringing: [], folderChanges: {},
      ...snap, settings: { ...(snap.settings || {}) }
    };
    S.quokkas.forEach((q) => { if (q.traits) { TR.ensureAccessory(q.traits); TR.ensurePersonality(q.traits); } });
    if (!initialized) {
      const po = S.settings.panelOwner;
      if (po && (po === 'all' || qById(po))) { ui.sel = po; if (po !== 'all') ui.recent = [po]; }
    }
    if (pendingSelectName) {
      const q = S.quokkas.find((x) => normName(x.name) === normName(pendingSelectName));
      if (q) { ui.sel = q.id; pendingSelectName = null; }
    }
    if (ui.sel !== 'all' && !qById(ui.sel)) { ui.sel = 'all'; ui.gear = false; }
    if (ui.editing && !findItem('task', ui.editing)) ui.editing = null;
    announceRinging();
    initialized = true;
    render();
  }

  api.onState((snap) => applyState(snap));
  if (api.onStockTick) api.onStockTick((t) => {
    if (!t || !t.symbol) return;
    S.quotes = S.quotes || {};
    S.quotes[t.symbol] = { ...(S.quotes[t.symbol] || {}), ...t };
    patchStock(t.symbol);
  });
  if (api.onSelect) api.onSelect((p) => { if (p && p.qid) select(p.qid); });
  if (api.onFolderChanges) api.onFolderChanges((p) => {
    if (!p || !p.id) return;
    S.folderChanges = { ...(S.folderChanges || {}), [p.id]: Array.isArray(p.recent) ? p.recent : [] };
    if (!ui.editing && !ui.menu) keepFocus(renderLists);
  });

  // 錯過、貪睡的標籤跟著時間變：每 30 秒重畫一次提醒
  setInterval(() => { if (!ui.editing && !ui.menu) keepFocus(renderLists); }, 30000);

  api.getState().then(applyState).catch(() => applyState(S));
})();
