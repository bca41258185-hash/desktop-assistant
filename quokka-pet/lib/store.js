// 資料儲存（規格第 2 節）：schema v2、v1 自動遷移、原子寫入（暫存檔＋改名）、連續修改合併寫入。
(function () {
  const fs = require('fs');
  const path = require('path');

  const LIMITS = { text: 200, name: 12, tasksPerQuokka: 50, remindersPerQuokka: 30, stocksPerQuokka: 20 };
  const newId = (p) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

  function defaults() {
    return {
      version: 2,
      quokkas: [],
      tasks: [], reminders: [], stocks: [], folders: [],
      relations: {},                       // 'q1|q2' → { affinity, couple, since }（第 16 節）
      postcards: [],                       // 放生後寄回來的明信片（lib/postcard.js）
      items: null,                         // 道具欄：{ rose: {n, at}, snack: {n, at} }（lib/app-v2.js 的 ITEMS；null＝全滿）
      settings: { stockStepPct: 1, reminderVoice: false, awayMinutes: 5, walk: 'home', romance: true, babies: true, panelOwner: 'all',
        saver: false }                     // 省電：打開（或用電池）時動畫每秒 30 格；預設 60 格（規格 12 效能）
    };
  }

  // v1（單一隻、沒有 owner）→ v2
  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return defaults();
    if (raw.version === 2) {
      const d = defaults();
      const out = { ...d, ...raw, settings: { ...d.settings, ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) } };
      // 欄位型別不對（手動改壞、同步軟體衝突）：該欄用空的，其他照讀，不讓程式起不來
      for (const k of ['quokkas', 'tasks', 'reminders', 'stocks', 'folders', 'postcards']) out[k] = Array.isArray(out[k]) ? out[k].filter((x) => x && typeof x === 'object') : [];
      if (!out.relations || typeof out.relations !== 'object' || Array.isArray(out.relations)) out.relations = {};
      return out;
    }
    const v1 = raw, s = v1.settings || {}, d = defaults();
    const q1 = { id: 'q1', name: '庫卡', traits: s.quokkaTraits || null, pos: null, createdAt: new Date().toISOString() };
    d.quokkas.push(q1);
    d.tasks = (v1.tasks || []).filter((t) => t && t.text).map((t, i) => ({
      id: String(t.id || newId('t')), owner: 'q1', text: String(t.text).slice(0, LIMITS.text), done: !!t.done, createdAt: new Date().toISOString(), order: i
    }));
    d.folders = (v1.folders || []).filter((f) => typeof f === 'string').map((p) => ({ id: newId('f'), owner: 'q1', path: p }));
    if (s.awayMinutes != null) d.settings.awayMinutes = s.awayMinutes;
    // 聊天相關（provider、apiKey、baseUrl、model）與舊的「每 N 分鐘提醒」不再保留
    return d;
  }

  function createStore(file, { debounceMs = 300 } = {}) {
    let data = defaults(), timer = null; const readOnly = false;
    // 把讀不懂的檔案另存一份，絕不直接用預設值蓋掉使用者的資料
    function quarantine(tag) {
      try { fs.copyFileSync(file, file.replace(/\.json$/, '') + `.${tag}-${Date.now()}.json`); } catch (e) { /* 備份失敗不阻擋 */ }
    }
    function load() {
      let raw = null, text = null;
      // 暫時讀不到（防毒、同步軟體鎖住）：重試幾次；還是不行就丟出去，由呼叫端告訴使用者並結束，
      // 絕不拿空白資料繼續跑（那樣提醒不會響、新增的東西也存不了）
      for (let i = 0; ; i++) {
        try { text = fs.readFileSync(file, 'utf-8'); break; }
        catch (e) {
          if (e.code === 'ENOENT') break;
          if (i >= 4) { const err = new Error('讀不到設定檔：' + e.message); err.code = 'CONFIG_UNREADABLE'; throw err; }
          const until = Date.now() + 150 * (i + 1); while (Date.now() < until) { /* 短暫等待後重試 */ }
        }
      }
      if (text != null) {
        try { raw = JSON.parse(text); } catch (e) { raw = null; }
        if (!raw || typeof raw !== 'object') {
          // 寫到一半斷電留下的暫存檔若還在且完整，優先救回來
          quarantine('corrupt');
          try { raw = JSON.parse(fs.readFileSync(file + '.tmp', 'utf-8')); } catch (e) { raw = null; }
        }
      }
      const ver = raw && raw.version;
      if (raw && ver != null && ver !== 2 && ver !== 1) {   // 比這一版還新的資料：留一份備份，照 v2 的欄位盡量讀
        quarantine(`v${String(ver).replace(/[^0-9a-z.]/gi, '')}`);
        raw = { ...raw, version: 2 };
      }
      const isV1 = raw && raw.version !== 2;
      if (isV1) {
        const bak = file.replace(/\.json$/, '.v1.bak.json');
        try { if (!fs.existsSync(bak)) fs.writeFileSync(bak, JSON.stringify(raw, null, 2)); } catch (e) { /* 備份失敗不阻擋 */ }
      }
      data = migrate(raw);
      if (isV1) saveNow();
      return data;
    }
    function saveNow() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (readOnly) return;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';
        const fd = fs.openSync(tmp, 'w');
        try { fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf-8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, file);              // 原子取代：不會留下寫一半的檔案
      } catch (e) { console.error('儲存失敗:', e.message); }
    }
    function save() { if (timer) clearTimeout(timer); timer = setTimeout(saveNow, debounceMs); }
    return { load, save, saveNow, get data() { return data; }, set data(v) { data = v; } };
  }

  module.exports = { createStore, migrate, defaults, newId, LIMITS };
})();
