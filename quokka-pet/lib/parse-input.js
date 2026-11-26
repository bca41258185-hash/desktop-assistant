// 一個輸入框新增所有東西：判斷使用者打的是股票、提醒還是待辦（規格第 3 節）。
// 純函式、不碰檔案或視窗，主行程與面板共用（面板用來即時顯示「→ 今天 15:30 提醒」）。
//
// parseInput(文字, 現在時間) 回傳：
//   { type: 'stock', symbol, market: 'tw' | 'us', ex?: 'tse' | 'otc',
//     nameHint?: '使用者打的名稱' }   // 有的話，主行程查到代號後要核對名稱，對不上就不加入
//   { type: 'reminder', text, rule: { type: 'once', date: 'YYYY-MM-DD', time: 'HH:MM' }
//                                 | { type: 'daily', time } | { type: 'weekly', weekdays: [0-6], time },
//     movedToTomorrow?: true,      // 今天那個時刻已過，改成明天
//     note?: '給使用者看的提示' }   // 有做推斷或調整時說明（describe() 會接在後面顯示）
//   { type: 'task', text }
//   { type: 'none' }
(function () {
  const WD = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const WD_NAME = ['日', '一', '二', '三', '四', '五', '六'];
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const hm = (H, M) => `${pad(H)}:${pad(M)}`;
  const showHM = (t) => `${Number(t.slice(0, 2))}:${t.slice(3)}`;          // 給內容用：9:00、17:00

  // 全形轉半形、統一空白與波浪號
  function normalize(s) {
    return String(s || '')
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[：﹕]/g, ':').replace(/[．]/g, '.').replace(/[～〜]/g, '~').replace(/[－﹣]/g, '-').replace(/／/g, '/').replace(/　/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // ---- 中文數字（0–99）：零〇一二兩三四五六七八九十、十一、二十、三十五 ----------------------
  const CN = '零〇一二兩三四五六七八九十';
  const CN_D = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  function cnNum(str) {
    if (str == null || str === '') return NaN;
    if (/^\d+(\.\d+)?$/.test(str)) return Number(str);
    if (str.includes('十')) {
      const parts = str.split('十');
      if (parts.length !== 2 || parts[0].length > 1 || parts[1].length > 1) return NaN;
      const tens = parts[0] === '' ? 1 : CN_D[parts[0]], ones = parts[1] === '' ? 0 : CN_D[parts[1]];
      return tens == null || ones == null || tens === 0 ? NaN : tens * 10 + ones;
    }
    if (str.length === 1) return CN_D[str] == null ? NaN : CN_D[str];
    if (str.length === 2 && CN_D[str[0]] === 0 && CN_D[str[1]] != null) return CN_D[str[1]];   // 零五
    return NaN;
  }

  // ---- 股票 --------------------------------------------------------------------------------
  // 常見縮寫與建築用語：就算是 1–5 個英文字母也不當成美股（排除清單優先）
  const NOT_TICKER = new Set(('BIM CAD PDF OK RC SRC MEP RFI FYI ASAP TODO SC SS DWG DXF IFC RVT SKP PLN PPT PPTX DOC DOCX XLS XLSX CSV TXT JPG JPEG PNG GIF PSD ZIP RAR ' +
    'AI VR AR MR UI UX QA QC PM AM HR PR ID VIP FAQ TBD TBA TBC NA NG WIP DIY LOD BEP EIR CDE COBIE HVAC MEPF LEED EEWH ESG CSR KPI SOP PCM CM FM RD ' +
    'FL GL RF PH BF EL SL WL CL TYP NTS DN UP EXP REV VER ' +
    'EMAIL MAIL TEL FAX URL WIFI USB APP WEB API GPS ATM IG FB YT LINE PS RE FW CC BCC ' +
    'PVC PE PU LED ALC GRC FRP CLT LVL OSB MDF RCP FFE MOCK ' +
    'HI HELLO YES NO BYE THX TKS TEST DEMO MEMO NOTE NOTES DRAFT FINAL DONE ' +
    'PDCA SWOT ROI VE CSA IPD EPC BOT BTO PCCES BOQ QS QTO GFA FAR BCR').split(' '));
  // 小寫的一般英文字（小寫輸入才擋；大寫的 COST、NOW 仍可當代號）
  const LOWER_WORDS = new Set(('a i am an as at be by do go he if in is it me my no of on or so to up us we ' +
    'all and any are ask bad big buy can cut day did end fix for fun get got had has her him his how its key let low man may new not now off old one our out own pay put run saw say see set she sit six ten the too top try two use was way who why win yes yet you ' +
    'back best book call care cash chat city cold come cook cool copy cost deal desk done down draw each easy edit else even ever exam face fact fail fast file fill find fine fire five flat fold food form four free from full game gift give glad goes gold gone good grab gray grey grow hair half hall hand hard have head hear heat help here high hold home hope hour idea into item join jump just keep kind know land last late lead left less life like line link list live load loan lock long look lost love lunch made mail main make many meet mind miss mode more most move much must name near need next nice none note once only open over page paid pair park part pass past pick plan play plus post pull push read real rent rest ride ring road room rule safe sale same save seat seem sell send ship shop show shut side sign site size slow some soon sort stay step stop such sure take talk task team tell test text than that them then they this time tidy tile todo told took tool trip true turn type unit upon used user very view wait wake walk wall want warm wash wear week well went were what when wide wife will wind wish with wood word work yard year your zero zone ' +
    'about above after again agree alarm allow alone along apply audit basic begin below board break bring build call clean clear check class close color count cover daily dance draft dream drink drive early email empty enjoy enter equal error event every extra field final first floor focus fresh front given glass going grade great green group guess guide happy hello house ideas image index issue items large later learn leave level light limit lunch maybe model money month never night notes offer often order other owner paint paper party phone photo piece place plans point price print proof quick quiet quite ready reply right round scale scope sheet short since sleep small solve space spend staff stair start still stone store study stuff style table taken tasks thank their there these thing think third those three title today total touch train trust under until upper using usual visit watch water where which while white whole women world would write wrong years young').split(' '));
  // 常見台股名稱 → 代號（沒有名稱查詢服務時的小對照表；只收不容易和一般待辦混淆的名稱）
  // 2026-11-26 已用 StockService.lookup() 逐檔向證交所核對過代號與名稱
  const TW_NAMES = {
    台積電: '2330', 鴻海: '2317', 聯發科: '2454', 台達電: '2308', 廣達: '2382', 聯電: '2303', 日月光投控: '3711', 日月光: '3711', 大立光: '3008',
    富邦金: '2881', 國泰金: '2882', 中信金: '2891', 兆豐金: '2886', 玉山金: '2884', 元大金: '2885', 第一金: '2892', 合庫金: '5880', 華南金: '2880', 永豐金: '2890',
    中華電: '2412', 中華電信: '2412', 台灣大: '3045', 台灣大哥大: '3045', 遠傳: '4904', 台塑: '1301', 南亞: '1303', 台化: '1326', 台塑化: '6505', 中鋼: '2002',
    統一超: '2912', 長榮海運: '2603', 陽明海運: '2609', 萬海: '2615', 長榮航: '2618', 華航: '2610',
    華碩: '2357', 宏碁: '2353', 仁寶: '2324', 緯創: '3231', 緯穎: '6669', 英業達: '2356', 和碩: '4938', 技嘉: '2376', 微星: '2377',
    瑞昱: '2379', 聯詠: '3034', 研華: '2395', 光寶科: '2301', 國巨: '2327', 欣興: '3037', 南亞科: '2408', 華邦電: '2344', 旺宏: '2337', 友達: '2409', 群創: '3481',
    台泥: '1101', 亞泥: '1102', 奇鋐: '3017', 雙鴻: '3324', 台光電: '2383', 金像電: '2368', 健鼎: '3044', 上銀: '2049', 和泰車: '2207', 裕隆: '2201',
    儒鴻: '1476', 遠東新: '1402', 彰銀: '2801', 世界先進: '5347', 穩懋: '3105', 環球晶: '6488', 中美晶: '5483', 信驊: '5274', 力旺: '3529', 元太: '8069', 力積電: '6770',
    元大台灣50: '0050', 台灣50: '0050', 元大高股息: '0056', 國泰永續高股息: '00878', 富邦台50: '006208'
  };
  // 代號後面那幾個字如果有時間或動作的字眼，就不是股票名稱（「2330 明天再看」「2000 買材料」）
  const NOT_NAME = /[今明後昨]天|點|分鐘|小時|週|周|星期|禮拜|[上下中]午|早上|晚上|買|賣|繳|交|送|打|回|看|寫|做|改|查|訂|約|開會|整理|檢查|確認|提醒|記得|完成|準備/;
  function parseStock(s) {
    let m;
    if (/^\d{4,6}[A-Za-z]?$/.test(s)) return { type: 'stock', symbol: s.toUpperCase(), market: 'tw' };
    if ((m = s.match(/^(\d{4,6}[A-Za-z]?)\.(TWO|TW)$/i))) return { type: 'stock', symbol: m[1].toUpperCase(), market: 'tw', ex: m[2].toUpperCase() === 'TWO' ? 'otc' : 'tse' };
    // nameHint＝使用者打的名稱：主行程查到代號後會核對名稱，對不上就不加入（改問要不要當待辦）
    const known = (n) => Object.prototype.hasOwnProperty.call(TW_NAMES, n);
    if (known(s)) return { type: 'stock', symbol: TW_NAMES[s], market: 'tw', nameHint: s };
    // 「2330 台積電」：代號＋空白＋2–6 個中文字的名稱（代號為準、名稱拿去核對）；有時間或動作的字眼就不算
    if ((m = s.match(/^(\d{4,6}[A-Za-z]?) ([\u4e00-\u9fff]{2,6}(?:-KY|\d{1,2})?)$/)) && (known(m[2]) || !NOT_NAME.test(m[2]))) return { type: 'stock', symbol: m[1].toUpperCase(), market: 'tw', nameHint: m[2], ...(known(m[2]) ? {} : { loose: true }) };   // loose＝只是長得像（「3000 訂金」），查不到就直接當待辦
    if ((m = s.match(/^(\d{4,6}[A-Za-z]?)(\S+)$/)) && known(m[2])) return { type: 'stock', symbol: m[1].toUpperCase(), market: 'tw', nameHint: m[2] };
    // 「台積電 2330」：名稱在前面的，只認對照表裡的名稱
    if ((m = s.match(/^(\S+?)\s*(\d{4,6}[A-Za-z]?)$/)) && known(m[1])) return { type: 'stock', symbol: m[2].toUpperCase(), market: 'tw', nameHint: m[1] };
    // 美股：1–5 個英文字母（可帶 .B），全大寫或全小寫；排除清單優先
    if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(s)) return NOT_TICKER.has(s) ? null : { type: 'stock', symbol: s, market: 'us' };
    if (/^[a-z]{2,5}(\.[a-z])?$/.test(s)) {
      const up = s.toUpperCase();
      return NOT_TICKER.has(up) || LOWER_WORDS.has(s) ? null : { type: 'stock', symbol: up, market: 'us' };
    }
    return null;
  }

  // ---- 日期詞 --------------------------------------------------------------------------------
  const WK = '(?:週|周|星期|禮拜)', WDC = '[一二三四五六日天]', LSEP = '[、,，和跟及與]';
  const DAY = '(?:' + [
    `每(?:個)?(?:工作天|工作日|上班日)|平日|工作日|上班日|每?${WK}一\\s*(?:到|至|~|-)\\s*${WK}?五`,
    `每(?:個)?${WK}末`,
    `每(?:個)?${WK}${WDC}(?:\\s*${LSEP}\\s*${WK}?${WDC}|${WDC})*`,
    '每天早上|每天晚上|每天|每日|天天|每晚|每早',
    '大後天|後天|明天|明日|今天|今日|明早|明晚|今早|今晚',
    `下下?(?:個)?${WK}${WDC}|(?:這|本)?${WK}${WDC}`,
    `(?<![\\d/.])(?:\\d{4}/)?\\d{1,2}/\\d{1,2}(?![/\\d])`,
    `(?<!\\d)(?:\\d{1,2}|[${CN}]{1,2})月(?:\\d{1,2}|[${CN}]{1,3})[日號]?`,
    `(?<![\\d.])(?:\\d{1,2}|[${CN}]{1,2})天(?:之後|以後|後)`
  ].join('|') + ')';
  const PERIOD = '(?:上午|早上|早晨|清晨|一早|中午|下午|午後|傍晚|晚上|晚間|凌晨|半夜|午夜|深夜)';
  const NOT_AFTER_BEFORE = '(?![往去進面天後場置提言者任])';       // 「3點前往工地」的「前」不是截止
  // 一個時刻：15:30、3點、3點半、3點15分、3 點 15 分、三點一刻、兩點四十五
  const timeSrc = (k) => `(?<![\\d:./])(?<h${k}>\\d{1,2}|[${CN}]{1,3})(?:(?<colon${k}>:)(?<mm${k}>\\d{2})(?![\\d:])|\\s*點(?!數|名|擊)(?:\\s*(?:(?<half${k}>半)|整|(?<q${k}>[一三])刻|(?<m${k}>\\d{1,2}|[${CN}]{1,3})\\s*分(?!鐘|之))|(?<m2${k}>\\d{1,2})(?![\\d樓F坪件張個人份頁號年月日%/:.])|(?<m3${k}>[${CN}]{2,3})(?![樓坪件張個人份頁]))?)`;
  const RE_TIME = new RegExp(
    `(?:(?<day>${DAY})\\s*的?\\s*)?(?:(?<per>${PERIOD})\\s*的?\\s*)?${timeSrc('')}` +
    `(?:\\s*(?:~|-|–|—|到|至)\\s*(?:(?<perB>${PERIOD})\\s*)?${timeSrc('B')})?` +
    `(?:\\s*(?<dl>以前|之前|前)${NOT_AFTER_BEFORE})?`, 'g');
  const RE_DAY_HEAD = new RegExp(`^(${DAY})\\s*的?\\s*`), RE_DAY_TAIL = new RegExp(`\\s*(${DAY})$`);
  const RE_DATE_DL_HEAD = new RegExp(`^(${DAY})\\s*(?:以前|之前|前)${NOT_AFTER_BEFORE}\\s*(.+)$`);
  const RE_DATE_DL_TAIL = new RegExp(`^(.+?)\\s*(${DAY})\\s*(?:以前|之前|前)$`);
  const PREFIX = /^(?:請|麻煩)?(?:幫我)?(?:提醒我?|記得要?|別忘記?了?|不要忘記?了?|叫我)\s*[:,，]?\s*/;
  // 只寫中文數字「一點…」「三點…」時，這些開頭多半不是時間（一點也不、三點意見）
  const CN_NOT_TIME = /^(點|也|都|兒|小|意見|建議|問題|心意|想法|看法|疑問|要求|說明|修正|結論|原因|重點|注意|事項|不|就好|時間|東西)/;
  const SCALE_WORDS = /比例|大樣|詳圖|平面圖|立面圖|剖面圖|scale/i;         // 「1:50 平面圖」是比例尺不是時間

  // 把日期詞解析成 { kind: 'none' | 'once' | 'daily' | 'weekly', ... }；看不懂回 null
  function parseDay(tok, now) {
    if (!tok) return { kind: 'none' };
    let m, per = null;
    if (/工作天|工作日|上班日|平日/.test(tok) || new RegExp(`一\\s*(?:到|至|~|-)\\s*${WK}?五`).test(tok)) return { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] };
    if (new RegExp(`^每(?:個)?${WK}末$`).test(tok)) return { kind: 'weekly', weekdays: [0, 6] };
    if ((m = tok.match(new RegExp(`^每(?:個)?${WK}(.+)$`)))) {
      const days = [...new Set([...m[1]].filter((c) => WD[c] != null && !/[週周]/.test(c)).map((c) => WD[c]))].sort();
      return days.length ? { kind: 'weekly', weekdays: days } : null;
    }
    if (/^(每天早上|每早)$/.test(tok)) return { kind: 'daily', per: '早上' };
    if (/^(每天晚上|每晚)$/.test(tok)) return { kind: 'daily', per: '晚上' };
    if (/^(每天|每日|天天)$/.test(tok)) return { kind: 'daily' };
    if (/早$/.test(tok)) per = '早上'; else if (/晚$/.test(tok)) per = '晚上';
    if (/^今/.test(tok)) return { kind: 'once', offset: 0, today: true, per, label: tok };
    if (/^明/.test(tok)) return { kind: 'once', offset: 1, per, label: tok };
    if (tok === '後天') return { kind: 'once', offset: 2, label: tok };
    if (tok === '大後天') return { kind: 'once', offset: 3, label: tok };
    if ((m = tok.match(new RegExp(`^(下下?)(?:個)?${WK}(${WDC})$`)))) {
      const want = WD[m[2]], dow = now.getDay(), toMon = ((8 - dow) % 7) || 7;       // 到下週一還有幾天（週一到週日算一週）
      return { kind: 'once', offset: toMon + (want === 0 ? 6 : want - 1) + (m[1].length === 2 ? 7 : 0), label: tok };
    }
    if ((m = tok.match(new RegExp(`^(?:這|本)?${WK}(${WDC})$`)))) return { kind: 'once', weekday: WD[m[1]], label: tok };
    if ((m = tok.match(/^(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})$/)) || (m = tok.match(new RegExp(`^()(\\d{1,2}|[${CN}]{1,2})月(\\d{1,2}|[${CN}]{1,3})[日號]?$`)))) {
      const mo = cnNum(m[2]), d = cnNum(m[3]);
      let y = m[1] ? Number(m[1]) : now.getFullYear();
      const mk = (yy) => { const x = new Date(yy, mo - 1, d); return x.getMonth() === mo - 1 && x.getDate() === d ? x : null; };
      let date = mk(y); if (!date) return null;
      const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let rolled = false;
      if (!m[1] && date < today0) { date = mk(y + 1); rolled = true; if (!date) return null; }      // 今年的已過 → 明年
      if (date < today0) return null;
      return { kind: 'once', date, label: tok, rolled };
    }
    if ((m = tok.match(new RegExp(`^(\\d{1,2}|[${CN}]{1,2})天`)))) { const n = cnNum(m[1]); return n >= 1 ? { kind: 'once', offset: n, label: tok } : null; }
    return null;
  }

  // 內容裡的語意線索：沒寫上下午時用來推斷
  function cueOf(text) {
    if (/睡覺|睡前|就寢|宵夜|熬夜|消夜/.test(text)) return 'late';
    if (/晚餐|晚飯|下班|晚班|夜市|夜跑|晚會|尾牙|晚宴/.test(text)) return 'evening';
    if (/早餐|上班|晨會|早會|起床|晨跑|早班|早安|晨間/.test(text)) return 'morning';
    if (/午餐|午飯|午休|中餐|午覺|便當/.test(text)) return 'noon';
    return null;
  }
  const partOf = (H) => (H < 5 ? '凌晨' : H < 12 ? '早上' : H === 12 ? '中午' : H < 18 ? '下午' : '晚上');
  const sayHour = (t) => { const H = Number(t.slice(0, 2)), M = t.slice(3); return `${partOf(H)} ${H % 12 || 12} 點${M === '00' ? '' : M === '30' ? '半' : ` ${Number(M)} 分`}`; };

  // 時、分、上下午 → { H, M, wrap（指的是當晚過了午夜）, soft（沒寫日期時直接找下一次，不算「已過」） }
  function clock(g, k, per) {
    let H = cnNum(g['h' + k]);
    let M = g['mm' + k] != null ? Number(g['mm' + k]) : g['half' + k] ? 30 : g['q' + k] ? (g['q' + k] === '一' ? 15 : 45)
      : g['m' + k] != null ? cnNum(g['m' + k]) : g['m2' + k] != null ? Number(g['m2' + k]) : g['m3' + k] != null ? cnNum(g['m3' + k]) : 0;
    if (!Number.isFinite(H) || !Number.isFinite(M) || M > 59) return null;
    let wrap = false, soft = false;
    if (H === 24 && M === 0) { H = 0; wrap = true; }
    else if (per === '下午' || per === '午後' || per === '傍晚') { if (H < 12) H += 12; }
    else if (per === '晚上' || per === '晚間' || per === '半夜' || per === '午夜' || per === '深夜') {
      if (H === 12) { H = 0; wrap = true; } else if (H <= 4) wrap = true; else if (H < 12) H += 12;
    }
    else if (per === '中午') { if (H <= 4) H += 12; }
    else if (per === '上午' || per === '早上' || per === '早晨' || per === '清晨' || per === '一早' || per === '凌晨') { if (H === 12) { H = 0; soft = true; } else if (per === '凌晨' && H < 6) soft = true; }
    if (H > 23) return null;
    if (H === 0) soft = true;                                   // 0 點：直接找下一次，不算「已過」
    return { H, M, wrap, soft };
  }

  // 把一段「［日期］［上下午］時間［~結束時間］［前］」算成規則
  function build(g, content, dayTok, now) {
    const day = parseDay(dayTok, now);
    if (!day) return null;
    const per = g.per || day.per || null;
    const c = clock(g, '', per);
    if (!c) return null;
    let { H, M, wrap, soft } = c, note = null;
    const literalH = cnNum(g.h);
    const nowHM = hm(now.getHours(), now.getMinutes());
    const explicitDay = day.kind !== 'none' && !day.today;      // 明天、週五、12/5、每天…（今天另外處理）
    if (!per && !wrap && H >= 1 && H <= 12) {
      const cue = cueOf(content);
      if (cue === 'late') { if (H === 12) { H = 0; wrap = true; } else if (H <= 5) wrap = true; else H += 12; }
      else if (cue === 'evening') { if (H < 12) H += 12; }
      else if (cue === 'noon') { if (H <= 3) H += 12; }
      else if (cue === 'morning') { /* 照字面（早上） */ }
      else if (explicitDay) {
        // 有寫日期（明天、週五、12/5、每天、每週X）：1–6 點一律當成下午並提示；7–12 點照字面
        if (H <= 6) { note = `當成下午 ${H} 點；凌晨請寫「凌晨${H}點」`; H += 12; }
      } else if (H <= 6) {
        // 1–6 點：上班時間幾乎都是指下午。例外：半夜還醒著、而且那個凌晨時刻還沒到
        const owl = now.getHours() < 6 && hm(H, M) > nowHM;
        if (!owl) H += 12;
      } else if (H <= 11 && hm(H, M) <= nowHM) {
        // 7–11 點、早上那次已過：晚上那次還沒到，而且（使用者明說今天／現在已是傍晚／是 7 點）→ 當成晚上
        if (hm(H + 12, M) > nowHM && (day.today || now.getHours() >= 17 || H === 7)) {
          const am = sayHour(hm(H, M)), pm = sayHour(hm(H + 12, M));
          note = day.today ? `今天${am}已過，改成${pm}？` : `${am}已過，當成${pm}`;
          H += 12;
        }
      }
    }
    let time = hm(H, M);
    if (day.rolled) note = `${day.label} 今年已過，當成明年`;

    // 結束時間（時間範圍）：只用來寫進內容
    let rangeTxt = '';
    if (g.hB != null) {
      const e = clock(g, 'B', g.perB || per);
      if (e) {
        let eH = e.H;
        if (!g.perB && !per) { if (H >= 12 && literalH < 12 && eH < 12) eH += 12; }
        if (hm(eH, e.M) <= time && eH < 12) eH += 12;
        if (eH <= 23) rangeTxt = `（${showHM(time)}–${showHM(hm(eH, e.M))}）`;
      }
    }
    const deadline = !!g.dl;
    const LEAD = 30;
    const withLead = (t) => { const mins = Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); return mins >= LEAD ? hm(Math.floor((mins - LEAD) / 60), (mins - LEAD) % 60) : t; };
    let text = content + rangeTxt;

    // 重複提醒
    if (day.kind === 'daily' || day.kind === 'weekly') {
      let weekdays = day.weekdays;
      if (wrap) {                                         // 「每天晚上12點」＝隔天 00:00
        if (weekdays) weekdays = weekdays.map((d) => (d + 1) % 7).sort();
      }
      let ruleTime = time;
      if (deadline) { ruleTime = withLead(time); text += `（${showHM(time)} 前）`; note = ruleTime === time ? `${time} 截止，準時提醒` : `${time} 截止，提早 ${LEAD} 分鐘提醒`; }
      const r = { type: 'reminder', text, rule: day.kind === 'daily' ? { type: 'daily', time: ruleTime } : { type: 'weekly', weekdays, time: ruleTime } };
      if (note) r.note = note;
      return r;
    }

    // 一次性：決定日期
    let date, moved = false;
    const passedToday = time <= nowHM;
    if (day.kind === 'none' || day.today) {
      date = new Date(now);
      if (wrap && day.today) date = addDays(date, 1);                                                // 今晚12點＝明天 00:00
      else if (wrap || soft) { if (passedToday) date = addDays(date, 1); }                            // 沒寫日期：直接找下一次，不算「已過」
      else if (passedToday) {
        date = addDays(date, 1); moved = true;
        if (day.today) note = `今天${sayHour(time)}已過，改成明天`;
      }
    } else if (day.weekday != null) {
      let diff = (day.weekday - now.getDay() + 7) % 7;
      if (diff === 0 && passedToday && !wrap) diff = 7;
      date = addDays(now, diff + (wrap ? 1 : 0));
    } else {
      date = day.date ? new Date(day.date) : addDays(now, day.offset);
      if (wrap) date = addDays(date, 1);
      else if (ymd(date) === ymd(now) && passedToday) { date = addDays(date, 1); moved = true; note = `今天${sayHour(time)}已過，改成明天`; }
    }

    if (deadline) {
      // 截止型：提早提醒（30 分鐘；來不及就 10 分鐘；再來不及就準時）
      const [y, mo, d] = ymd(date).split('-').map(Number);
      const due = new Date(y, mo - 1, d, H, M, 0, 0);
      let lead = [LEAD, 10, 0].find((n) => due.getTime() - n * 60000 > now.getTime());
      if (lead == null) lead = 0;
      const at = new Date(due.getTime() - lead * 60000);
      text += `（${showHM(time)} 前）`;
      const dlNote = lead ? `${time} 截止，提早 ${lead} 分鐘提醒` : `${time} 截止，快到了，準時提醒`;
      note = note ? `${note}；${dlNote}` : dlNote;
      date = at; time = hm(at.getHours(), at.getMinutes());
    }
    const r = { type: 'reminder', text, rule: { type: 'once', date: ymd(date), time } };
    if (moved) r.movedToTomorrow = true;
    if (note) r.note = note;
    return r;
  }

  const tidy = (t) => t.replace(/\s+/g, ' ').replace(/^[\s,，、;；:~\-]+|[\s,，、;；:~\-]+$/g, '');

  // ［日期詞］＋時間＋內容（時間可以在前面、後面，或夾在有空白隔開的中間）
  function parseTimed(s0, now) {
    // 「9-10點」→「9點-10點」
    const s = s0.replace(new RegExp(`(?<![\\d:./])(\\d{1,2})(\\s*(?:~|-|–|—|到|至)\\s*(?:${PERIOD}\\s*)?\\d{1,2}\\s*點)`), '$1點$2');
    const leadDay = RE_DAY_HEAD.test(s);
    RE_TIME.lastIndex = 0;
    let m;
    while ((m = RE_TIME.exec(s))) {
      const idx = m.index, g = m.groups, end = idx + m[0].length;
      const next = () => { RE_TIME.lastIndex = idx + 1; };
      const hourCN = !/^\d/.test(g.h), hasMin = !!(g.mm || g.half || g.q || g.m || g.m2 || g.m3);
      const atStart = idx === 0, bounded = atStart || /[\s,，、;；:（(]/.test(s[idx - 1]);
      const rest0 = s.slice(end);
      let ok;
      if (g.day || g.per) ok = true;
      else if (hourCN) ok = bounded && !(!hasMin && !g.dl && CN_NOT_TIME.test(rest0.trim())) && (atStart || hasMin || end === s.length || /^\s/.test(rest0));
      else if (g.colon) ok = bounded || end === s.length;
      else ok = bounded || hasMin || leadDay;
      if (!ok) { next(); continue; }
      let content = tidy(s.slice(0, idx) + rest0), dayTok = g.day || null;
      if (!dayTok) {
        let dm;
        if ((dm = content.match(RE_DAY_HEAD))) { dayTok = dm[1]; content = tidy(content.slice(dm[0].length)); }
        else if ((dm = content.match(RE_DAY_TAIL))) { dayTok = dm[1]; content = tidy(content.slice(0, dm.index)); }
      }
      if (!content) { if (!dayTok) return null; content = '時間到了'; }      // 只有時間 → 待辦；有日期詞 → 提醒（預設內容）
      if (g.colon && !g.per && !dayTok && cnNum(g.h) === 1 && SCALE_WORDS.test(content)) { next(); continue; }
      const r = build(g, content, dayTok, now);
      if (r) return r;
      next();
    }
    return null;
  }

  // N 分鐘／小時後（中文數字、半小時、一個半小時也可以）
  const REL_N = `(?:(?<n>\\d+(?:\\.\\d+)?|[${CN}]{1,3})(?:個)?(?<hf>半)?|(?<only>半)(?:個)?)`;
  const REL_U = '(?<u>分鐘|分|mins?|m|小時|鐘頭|時|hrs?|h)';
  const RE_REL = new RegExp(`^${REL_N}\\s*${REL_U}(?<after>之後|以後|後)?\\s*(?![鐘內以左前])(?<text>.*)$`, 'i');
  const RE_REL_TAIL = new RegExp(`^(?<text>.+?)[\\s,，]*${REL_N}\\s*${REL_U}(?<after>之後|以後|後)$`, 'i');
  function parseRelative(s, now, re) {
    const m = s.match(re);
    if (!m) return null;
    const g = m.groups, unit = g.u.toLowerCase(), isHour = /^(小時|鐘頭|時|hrs?|h)$/.test(unit);
    const cn = g.only || !/^\d/.test(g.n);
    if (cn && !g.after) return null;                              // 「十分感謝」不是十分鐘
    let n = g.only ? 0.5 : cnNum(g.n);
    if (!Number.isFinite(n)) return null;
    if (g.hf) { if (!isHour) return null; n += 0.5; }
    const text = tidy(g.text || '');
    if (!text && !g.after) return null;                           // 「100分」「5m」不是提醒
    if (unit === 'm' && !g.after && /^(淨|寬|高|長|深|厚|退|跨|間距|以|x|X|\*|×|的)/.test(text)) return null;   // 「3m 淨高」是公尺
    const mins = isHour ? n * 60 : n;
    if (!(mins > 0 && mins <= 7 * 24 * 60)) return null;
    // 規則只能存到「分」，排程也只看到分；為了確實滿 N 分鐘，有零頭秒數就進位到下一分鐘（最多晚 59 秒，不會提早）
    let at = new Date(now.getTime() + Math.round(mins * 60000));
    if (at.getSeconds() || at.getMilliseconds()) { at = new Date(at.getTime() + 60000); at.setSeconds(0, 0); }
    return { r: { type: 'reminder', text: text || '時間到了', rule: { type: 'once', date: ymd(at), time: hm(at.getHours(), at.getMinutes()) } }, after: !!g.after };
  }

  // 只有日期的截止：「週五前送審」→ 該日 09:00 提醒
  function parseDateDeadline(s, now) {
    let m = s.match(RE_DATE_DL_HEAD), tok, content;
    if (m) { tok = m[1]; content = tidy(m[2]); }
    else if ((m = s.match(RE_DATE_DL_TAIL))) { tok = m[2]; content = tidy(m[1]); }
    else return null;
    const day = parseDay(tok, now);
    if (!day || day.kind !== 'once' || day.today || !content) return null;
    const r = build({ h: '9', mm: '00', colon: ':', per: '上午' }, content, tok, now);
    if (!r || r.movedToTomorrow) return null;
    const label = tok.replace(/[早晚]$/, '天');
    r.text = `${content}（${label}前）`;
    r.note = `沒寫時間，${label} 09:00 提醒`;
    return r;
  }

  function parseReminder(s, now) {
    const rel = parseRelative(s, now, RE_REL);
    if (rel && rel.after) return rel.r;
    const timed = parseTimed(s, now);
    if (timed) return timed;
    if (rel) return rel.r;
    const tail = parseRelative(s, now, RE_REL_TAIL);
    if (tail) return tail.r;
    return parseDateDeadline(s, now);
  }

  function parseInput(raw, now = new Date()) {
    const s = normalize(raw);
    if (!s) return { type: 'none' };
    // 1)、2) 股票
    const stock = parseStock(s);
    if (stock) return stock;
    // 3)–5) 提醒（先試原文，再試去掉「提醒我」「記得」等前綴）
    const stripped = s.replace(PREFIX, '');
    const rem = (stripped !== s && stripped ? parseReminder(stripped, now) : null) || parseReminder(s, now);
    if (rem) return rem;
    // 6) 其他：待辦
    return { type: 'task', text: s.slice(0, 200) };
  }

  // 給輸入框下方顯示的說明
  function describe(r, now = new Date()) {
    if (!r || r.type === 'none') return '';
    if (r.type === 'task') return '→ 新增待辦';
    if (r.type === 'stock') return r.market === 'tw' ? `→ 加入台股 ${r.symbol}` : `→ 加入美股 ${r.symbol}`;
    const t = r.rule, tail = r.note ? `（${r.note}）` : r.movedToTomorrow ? '（今天已過，改明天）' : '';
    if (t.type === 'daily') return `→ 每天 ${t.time} 提醒${tail}`;
    if (t.type === 'weekly') return `→ 每週${t.weekdays.map((d) => WD_NAME[d]).join('、')} ${t.time} 提醒${tail}`;
    const today = ymd(now), tmr = ymd(addDays(now, 1)), d2 = ymd(addDays(now, 2));
    let day;
    if (t.date === today) day = '今天'; else if (t.date === tmr) day = '明天'; else if (t.date === d2) day = '後天';
    else {
      const [y, mo, d] = t.date.split('-').map(Number), dt = new Date(y, mo - 1, d);
      day = `${y !== now.getFullYear() ? y + '/' : ''}${t.date.slice(5).replace('-', '/')}（${WD_NAME[dt.getDay()]}）`;
    }
    return `→ ${day} ${t.time} 提醒${tail}`;
  }

  const api = { parseInput, describe, normalize };
  if (typeof window !== 'undefined') window.QuokkaParse = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
