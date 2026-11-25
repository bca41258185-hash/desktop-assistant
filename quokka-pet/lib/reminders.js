// 提醒排程（規格第 6 節）：不輪詢，算出最近一個要響的時間只設一個計時器。
// 規則：once（某天某時）、daily（每天）、weekly（每週幾）；支援貪睡（snoozeUntil）。
// 電腦睡眠或程式沒開而錯過超過 2 分鐘的，標成「錯過」，合併通知一次，不連響。
(function () {
  const MISSED_MS = 2 * 60 * 1000;
  const MAX_WAIT = 6 * 60 * 60 * 1000;      // 最長只睡 6 小時就醒來重算（防時鐘漂移、時區變更）
  const at = (dateStr, time) => { const [y, mo, d] = dateStr.split('-').map(Number), [h, m] = time.split(':').map(Number); return new Date(y, mo - 1, d, h, m, 0, 0); };
  const sameDayAt = (base, time) => { const [h, m] = time.split(':').map(Number); const d = new Date(base); d.setHours(h, m, 0, 0); return d; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  // 不晚於 t 的最近一次預定時間（沒有就回 null）
  function latestOccurrence(rule, t) {
    if (!rule) return null;
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
    if (!rule) return null;
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
    if (!rem.enabled) return null;
    const fired = rem.lastFiredAt ? new Date(rem.lastFiredAt) : null;
    const cands = [];
    const occ = latestOccurrence(rem.rule, now);
    if (occ && (!fired || fired < occ) && (!rem.createdAt || new Date(rem.createdAt) <= occ)) cands.push(occ);
    if (rem.snoozeUntil) { const s = new Date(rem.snoozeUntil); if (s <= now && (!fired || fired < s)) cands.push(s); }
    if (!cands.length) return null;
    const when = new Date(Math.max(...cands.map((d) => d.getTime())));
    return { at: when, missed: now - when > MISSED_MS };
  }
  // 下一次要醒來的時間（所有提醒裡最早的）
  function nextWake(reminders, now) {
    let best = null;
    for (const r of reminders) {
      if (!r.enabled) continue;
      const cands = [nextOccurrence(r.rule, now)];
      if (r.snoozeUntil && new Date(r.snoozeUntil) > now) cands.push(new Date(r.snoozeUntil));
      for (const c of cands) if (c && (!best || c < best)) best = c;
    }
    return best;
  }

  // 排程器：getReminders() 取目前清單；onFire(清單 [{ rem, at, missed }]) 一次交出所有該響的
  // 呼叫端負責把 lastFiredAt 寫回（用 markFired），一次性提醒響過後停用
  function createScheduler({ getReminders, onFire, now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout }) {
    let timer = null;
    function check() {
      const t = now(), due = [];
      for (const r of getReminders()) { const d = dueNow(r, t); if (d) due.push({ rem: r, ...d }); }
      if (due.length) onFire(due);
      schedule();
    }
    function schedule() {
      if (timer) clearTimer(timer);
      const t = now(), w = nextWake(getReminders(), t);
      const wait = w ? Math.min(MAX_WAIT, Math.max(0, w - t) + 50) : MAX_WAIT;
      timer = setTimer(check, wait);
      return w;
    }
    return { check, schedule, stop() { if (timer) clearTimer(timer); timer = null; } };
  }
  function markFired(rem, when) {
    rem.lastFiredAt = when.toISOString();
    if (rem.snoozeUntil && new Date(rem.snoozeUntil) <= when) delete rem.snoozeUntil;
    if (rem.rule.type === 'once' && !rem.snoozeUntil) rem.enabled = false;
  }
  function snooze(rem, minutes, now = new Date()) {
    rem.snoozeUntil = new Date(now.getTime() + minutes * 60000).toISOString();
    rem.enabled = true;
  }

  const api = { latestOccurrence, nextOccurrence, dueNow, nextWake, createScheduler, markFired, snooze, MISSED_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
