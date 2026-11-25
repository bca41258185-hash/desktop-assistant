// 一個輸入框新增所有東西：判斷使用者打的是股票、提醒還是待辦（規格第 3 節）。
// 純函式、不碰檔案或視窗，主行程與面板共用（面板用來即時顯示「→ 今天 15:30 提醒」）。
//
// parseInput(文字, 現在時間) 回傳：
//   { type: 'stock', symbol, market: 'tw' | 'us' }
//   { type: 'reminder', text, rule: { type: 'once', date: 'YYYY-MM-DD', time: 'HH:MM' }
//                                 | { type: 'daily', time } | { type: 'weekly', weekdays: [0-6], time },
//     movedToTomorrow?: true }
//   { type: 'task', text }
//   { type: 'none' }
(function () {
  const WD = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const WD_NAME = ['日', '一', '二', '三', '四', '五', '六'];
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  // 全形轉半形、統一空白
  function normalize(s) {
    return String(s || '')
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[：﹕]/g, ':').replace(/[．]/g, '.').replace(/　/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // 時間：一定要有冒號或「點」才算（「1500」不算時間）
  const PERIOD = '(上午|早上|中午|下午|晚上|凌晨|傍晚)?';
  const TIME = `${PERIOD}\\s*(\\d{1,2})(?::(\\d{2})|點(?:(半)|(\\d{1,2})分?)?)`;
  function toHM(period, h, m, half, m2) {
    let H = Number(h), M = m != null ? Number(m) : half ? 30 : m2 != null ? Number(m2) : 0;
    if (period === '下午' || period === '晚上' || period === '傍晚') { if (H < 12) H += 12; }
    else if (period === '中午') { if (H < 6) H += 12; }
    else if (period === '上午' || period === '早上' || period === '凌晨') { if (H === 12) H = 0; }
    if (H > 23 || M > 59) return null;
    return `${pad(H)}:${pad(M)}`;
  }
  const DAY = '(今天|明天|後天|每天|每日|(?:每週|每周|每星期|每禮拜)[一二三四五六日天]+|(?:週|周|星期|禮拜)[一二三四五六日天])?';
  const RE_TIMED = new RegExp(`^${DAY}\\s*${TIME}\\s*(.+)$`);
  const RE_REL = /^(\d+(?:\.\d+)?)\s*(分鐘|分|min|mins|m|小時|鐘頭|時|hr|hrs|h)後?\s*(?![鐘內以左前])(.+)$/i;

  function parseInput(raw, now = new Date()) {
    const s = normalize(raw);
    if (!s) return { type: 'none' };
    // 1) 台股：4–6 位數字（可帶一個英文字母）
    if (/^\d{4,6}[A-Z]?$/.test(s)) return { type: 'stock', symbol: s, market: 'tw' };
    // 2) 美股：1–5 個大寫英文（可帶 .B）
    if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(s)) return { type: 'stock', symbol: s, market: 'us' };
    // 3) N 分鐘／小時後
    let m = s.match(RE_REL);
    if (m) {
      const n = Number(m[1]), unit = m[2].toLowerCase();
      const mins = /^(小時|鐘頭|時|hr|hrs|h)$/.test(unit) ? n * 60 : n;
      if (mins > 0 && mins <= 7 * 24 * 60) {
        const at = new Date(now.getTime() + Math.round(mins * 60000));
        return { type: 'reminder', text: m[3].trim(), rule: { type: 'once', date: ymd(at), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` } };
      }
    }
    // 4)、5) ［日期詞］＋時間＋內容
    m = s.match(RE_TIMED);
    if (m) {
      const [, day, period, h, mm, half, m2, text] = m;
      let time = toHM(period, h, mm, half, m2);
      const nowHM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      if (time && !period && !day && Number(h) >= 1 && Number(h) <= 7 && time <= nowHM) {
        // 下午打「3點」多半是指下午 3 點；連下午也過了（例如 14:05 打「2點」）就是明天下午
        time = `${pad(Number(time.slice(0, 2)) + 12)}:${time.slice(3)}`;
      }
      const content = (text || '').trim();
      if (time && content) {
        if (day === '每天' || day === '每日') return { type: 'reminder', text: content, rule: { type: 'daily', time } };
        if (day && /^(每週|每周|每星期|每禮拜)/.test(day)) {
          const days = [...new Set([...day.replace(/^(每週|每周|每星期|每禮拜)/, '')].map((c) => WD[c]))].sort();
          return { type: 'reminder', text: content, rule: { type: 'weekly', weekdays: days, time } };
        }
        let date = new Date(now), moved = false;
        if (day === '明天') date = addDays(now, 1);
        else if (day === '後天') date = addDays(now, 2);
        else if (day && /^(週|周|星期|禮拜)/.test(day)) {
          const want = WD[day.slice(-1)];
          let diff = (want - now.getDay() + 7) % 7;
          if (diff === 0 && time <= `${pad(now.getHours())}:${pad(now.getMinutes())}`) diff = 7;
          date = addDays(now, diff);
        } else if (time <= `${pad(now.getHours())}:${pad(now.getMinutes())}`) {
          // 今天的時間已經過了 → 改成明天，並告訴使用者
          date = addDays(now, 1); moved = true;
        }
        const r = { type: 'reminder', text: content, rule: { type: 'once', date: ymd(date), time } };
        if (moved) r.movedToTomorrow = true;
        return r;
      }
    }
    // 6) 其他：待辦
    return { type: 'task', text: s.slice(0, 200) };
  }

  // 給輸入框下方顯示的說明
  function describe(r, now = new Date()) {
    if (!r || r.type === 'none') return '';
    if (r.type === 'task') return '→ 新增待辦';
    if (r.type === 'stock') return r.market === 'tw' ? `→ 加入台股 ${r.symbol}` : `→ 加入美股 ${r.symbol}`;
    const t = r.rule;
    if (t.type === 'daily') return `→ 每天 ${t.time} 提醒`;
    if (t.type === 'weekly') return `→ 每週${t.weekdays.map((d) => WD_NAME[d]).join('、')} ${t.time} 提醒`;
    const today = ymd(now), tmr = ymd(addDays(now, 1)), d2 = ymd(addDays(now, 2));
    const day = t.date === today ? '今天' : t.date === tmr ? '明天' : t.date === d2 ? '後天' : t.date.slice(5).replace('-', '/');
    return `→ ${day} ${t.time} 提醒${r.movedToTomorrow ? '（今天已過，改明天）' : ''}`;
  }

  const api = { parseInput, describe, normalize };
  if (typeof window !== 'undefined') window.QuokkaParse = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
