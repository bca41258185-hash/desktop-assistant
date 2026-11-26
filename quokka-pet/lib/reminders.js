// 提醒排程（規格第 4.1 節）：不輪詢，算出最近一個要響的時間只設一個計時器。
// 規則：once（某天某時）、daily（每天）、weekly（每週幾）；支援貪睡（snoozeUntil）。
// 電腦睡眠或程式沒開而錯過超過 2 分鐘的，標成「錯過」（missedAt），合併通知一次，不連響。
// 壞資料（缺日期、缺星期、時間超出範圍）一律視為停用並跳過，不丟例外，排程器不會因單筆壞資料停掉。
(function () {
  const MISSED_MS = 2 * 60 * 1000;
  const MAX_WAIT = 6 * 60 * 60 * 1000;      // 最長只睡 6 小時就醒來重算（防時鐘漂移、時區變更）
  const DRIFT_CHECK_MS = 60 * 1000;          // 每 60 秒比對一次實際經過時間與時區偏移
  const DRIFT_TOLERANCE_MS = 5000;           // 落差超過 5 秒算時鐘跳動
  const NOTIFY_MERGE_MS = 2000;              // 系統通知 2 秒內合併成一則

  // ---- 資料檢查 ----------------------------------------------------------------
  // 'HH:MM'，00:00–23:59；其他（25:99、空字串、非字串）一律無效
  function parseTime(time) {
    const m = typeof time === 'string' && /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    return h <= 23 && mi <= 59 ? [h, mi] : null;
  }
  // 'YYYY-MM-DD'，而且是真的存在的日子（2026-02-31 無效）
  function parseDate(date) {
    const m = typeof date === 'string' && /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date.trim());
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const t = new Date(y, mo - 1, d);
    return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d ? [y, mo, d] : null;
  }
  const validWeekdays = (w) => Array.isArray(w) && w.length > 0 && w.every((x) => Number.isInteger(x) && x >= 0 && x <= 6);
  function isValidRule(rule) {
    if (!rule || typeof rule !== 'object' || !parseTime(rule.time)) return false;
    if (rule.type === 'once') return !!parseDate(rule.date);
    if (rule.type === 'daily') return true;
    if (rule.type === 'weekly') return validWeekdays(rule.weekdays);
    return false;
  }
  // 可以參與排程的提醒：物件、開著、規則有效
  const isActive = (rem) => !!rem && typeof rem === 'object' && !!rem.enabled && isValidRule(rem.rule);
  // 解析 ISO 時間；壞的回 null
  const dateOrNull = (s) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d; };

  const at = (dateStr, time) => { const [y, mo, d] = parseDate(dateStr), [h, m] = parseTime(time); return new Date(y, mo - 1, d, h, m, 0, 0); };
  const sameDayAt = (base, time) => { const [h, m] = parseTime(time); const d = new Date(base); d.setHours(h, m, 0, 0); return d; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  // 不晚於 t 的最近一次預定時間（沒有或規則壞掉就回 null）
  function latestOccurrence(rule, t) {
    if (!isValidRule(rule)) return null;
    if (rule.type === 'once') { const a = at(rule.date, rule.time); return a <= t ? a : null; }
    for (let i = 0; i <= 7; i++) {
      const d = sameDayAt(addDays(t, -i), rule.time);
      if (d > t) continue;
      if (rule.type === 'daily') return d;
      if (rule.type === 'weekly' && rule.weekdays.includes(d.getDay())) return d;
    }
    return null;
  }
  // 晚於 t 的下一次預定時間
  function nextOccurrence(rule, t) {
    if (!isValidRule(rule)) return null;
    if (rule.type === 'once') { const a = at(rule.date, rule.time); return a > t ? a : null; }
    for (let i = 0; i <= 8; i++) {
      const d = sameDayAt(addDays(t, i), rule.time);
      if (d <= t) continue;
      if (rule.type === 'daily') return d;
      if (rule.type === 'weekly' && rule.weekdays.includes(d.getDay())) return d;
    }
    return null;
  }
  // 現在該不該響：回傳 { at, missed } 或 null
  function dueNow(rem, now) {
    if (!isActive(rem)) return null;
    const fired = dateOrNull(rem.lastFiredAt), created = dateOrNull(rem.createdAt);
    const cands = [];
    const occ = latestOccurrence(rem.rule, now);
    if (occ && (!fired || fired < occ) && (!created || created <= occ)) cands.push(occ);
    const s = dateOrNull(rem.snoozeUntil);
    if (s && s <= now && (!fired || fired < s)) cands.push(s);
    if (!cands.length) return null;
    const when = new Date(Math.max(...cands.map((d) => d.getTime())));
    return { at: when, missed: now - when > MISSED_MS };
  }
  // 下一次要醒來的時間（所有提醒裡最早的）
  function nextWake(reminders, now) {
    let best = null;
    for (const r of Array.isArray(reminders) ? reminders : []) {
      try {
        if (!isActive(r)) continue;
        const cands = [nextOccurrence(r.rule, now)];
        const s = dateOrNull(r.snoozeUntil);
        if (s && s > now) cands.push(s);
        for (const c of cands) if (c && (!best || c < best)) best = c;
      } catch (e) { /* 單筆壞資料跳過 */ }
    }
    return best;
  }

  // 排程器：getReminders() 取目前清單；onFire(清單 [{ rem, at, missed }]) 一次交出所有該響的
  // 呼叫端負責把 lastFiredAt 寫回（用 markFired），一次性提醒響過後停用
  // 另外每 60 秒比對「牆上時鐘經過的時間」和「單調時鐘經過的時間」以及時區偏移，有落差就重新計算
  function createScheduler({ getReminders, onFire, now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout,
    setTick = setInterval, clearTick = clearInterval, mono = defaultMono, driftCheckMs = DRIFT_CHECK_MS } = {}) {
    let timer = null, ticker = null, last = null;
    const list = () => { try { const l = getReminders(); return Array.isArray(l) ? l : []; } catch (e) { return []; } };
    function mark() { const t = now(); last = { wall: t.getTime(), mono: mono(), tz: t.getTimezoneOffset() }; }
    function check() {
      const t = now(), due = [];
      for (const r of list()) { try { const d = dueNow(r, t); if (d) due.push({ rem: r, ...d }); } catch (e) { /* 單筆壞資料跳過 */ } }
      try { if (due.length) onFire(due); } catch (e) { if (typeof console !== 'undefined') console.error('[reminders] onFire 失敗', e); }
      schedule();
    }
    function schedule() {
      if (timer) clearTimer(timer);
      const t = now(), w = nextWake(list(), t);
      const wait = w ? Math.min(MAX_WAIT, Math.max(0, w - t) + 50) : MAX_WAIT;
      timer = setTimer(check, wait);
      mark();
      if (!ticker && setTick) { ticker = setTick(tick, driftCheckMs); if (ticker && typeof ticker.unref === 'function') ticker.unref(); }
      return w;
    }
    // 時鐘跳動檢查：回傳 true 表示偵測到跳動並重新計算
    function tick() {
      if (!last) { mark(); return false; }
      const t = now(), wallDt = t.getTime() - last.wall, monoDt = mono() - last.mono, tz = t.getTimezoneOffset();
      if (Math.abs(wallDt - monoDt) > DRIFT_TOLERANCE_MS || tz !== last.tz) { check(); return true; }
      mark();
      return false;
    }
    return { check, schedule, tick, stop() { if (timer) clearTimer(timer); timer = null; if (ticker) clearTick(ticker); ticker = null; } };
  }
  function defaultMono() {
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now();
    return Date.now();
  }
  // 響過（或報過錯過）：寫回 lastFiredAt；錯過的寫入 missedAt（面板顯示「錯過」直到按「知道了」），正常響起就清掉
  function markFired(rem, when, { missed = false } = {}) {
    if (!rem || typeof rem !== 'object') return;
    rem.lastFiredAt = when.toISOString();
    if (missed) rem.missedAt = when.toISOString();
    else delete rem.missedAt;
    if (rem.snoozeUntil) { const s = dateOrNull(rem.snoozeUntil); if (!s || s <= when) delete rem.snoozeUntil; }
    if (rem.rule && rem.rule.type === 'once' && !rem.snoozeUntil) rem.enabled = false;
  }
  // 使用者按「知道了」：清掉錯過標記
  function ackMissed(rem) { if (rem && rem.missedAt) { delete rem.missedAt; return true; } return false; }
  function snooze(rem, minutes, now = new Date()) {
    rem.snoozeUntil = new Date(now.getTime() + minutes * 60000).toISOString();
    rem.enabled = true;
  }

  // ---- 離開期間的報告（每隻上限 8 則）--------------------------------------------
  // 錯過與提醒類一律保留並排在最前面；其他類滿了就合併成「…還有 N 則」
  const DIGEST_MAX = 8, DIGEST_KEEP = 50;
  const DIGEST_PRIORITY = new Set(['missed', 'reminder', 'alert']);
  function digestPush(d, kind, text) {
    d = d && typeof d === 'object' && Array.isArray(d.pri) ? d : { pri: [], other: [], more: 0 };
    if (text == null || text === '') return d;
    if (DIGEST_PRIORITY.has(kind)) d.pri.push(String(text));
    else if (d.other.length < DIGEST_KEEP) d.other.push(String(text));
    else d.more++;
    return d;
  }
  function digestTexts(d, max = DIGEST_MAX) {
    if (!d || !Array.isArray(d.pri)) return [];
    const out = d.pri.slice();
    const room = Math.max(0, max - out.length), rest = d.other.length + (d.more || 0);
    if (rest <= room) return out.concat(d.other);
    const keep = Math.max(0, room - 1);
    return out.concat(d.other.slice(0, keep), [`…還有 ${rest - keep} 則`]);
  }

  // ---- 系統通知合併：2 秒內多筆合併成一則「3 則提醒：A、B、C」 ---------------------
  // push({ title, body, label, qid })；send({ title, body, qid }) 由呼叫端真的送出
  function createNotifyBatcher({ send, windowMs = NOTIFY_MERGE_MS, setTimer = setTimeout, clearTimer = clearTimeout, fallbackTitle = '庫卡助理' } = {}) {
    let pending = [], timer = null;
    function flush() {
      if (timer) clearTimer(timer);
      timer = null;
      const items = pending; pending = [];
      if (!items.length) return null;
      let msg;
      if (items.length === 1) msg = { title: items[0].title, body: items[0].body, qid: items[0].qid };
      else {
        const qids = [...new Set(items.map((x) => x.qid))];
        const titles = [...new Set(items.map((x) => x.title))];
        const body = `${items.length} 則提醒：${items.map((x) => x.label || x.body).join('、')}`;
        msg = { title: titles.length === 1 ? titles[0] : fallbackTitle, body: body.length > 200 ? body.slice(0, 199) + '…' : body, qid: qids.length === 1 ? qids[0] : null };
      }
      try { send(msg); } catch (e) { /* 通知失敗不影響排程 */ }
      return msg;
    }
    function push(item) {
      pending.push(item || {});
      if (!timer) timer = setTimer(flush, windowMs);
    }
    return { push, flush, get size() { return pending.length; } };
  }

  const api = { latestOccurrence, nextOccurrence, dueNow, nextWake, createScheduler, markFired, ackMissed, snooze, isValidRule, parseTime, parseDate,
    digestPush, digestTexts, createNotifyBatcher, MISSED_MS, DIGEST_MAX, NOTIFY_MERGE_MS, DRIFT_CHECK_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
