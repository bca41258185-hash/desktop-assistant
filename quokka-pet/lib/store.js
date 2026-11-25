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
      settings: { stockStepPct: 1, reminderVoice: false, awayMinutes: 5, walk: 'home', romance: true, babies: true, panelOwner: 'all' }
    };
  }

  // v1（單一隻、沒有 owner）→ v2
  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return defaults();
    if (raw.version === 2) {
      const d = defaults();
      return { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) } };
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
    let data = defaults(), timer = null;
    function load() {
      let raw = null;
      try { raw = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) { raw = null; }
      if (raw && raw.version !== 2) {
        try { fs.writeFileSync(file.replace(/\.json$/, '.v1.bak.json'), JSON.stringify(raw, null, 2)); } catch (e) { /* 備份失敗不阻擋 */ }
      }
      data = migrate(raw);
      if (raw && raw.version !== 2) saveNow();
      return data;
    }
    function saveNow() {
      if (timer) { clearTimeout(timer); timer = null; }
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tmp, file);              // 原子取代：不會留下寫一半的檔案
      } catch (e) { console.error('儲存失敗:', e.message); }
    }
    function save() { if (timer) clearTimeout(timer); timer = setTimeout(saveNow, debounceMs); }
    return { load, save, saveNow, get data() { return data; }, set data(v) { data = v; } };
  }

  module.exports = { createStore, migrate, defaults, newId, LIMITS };
})();
