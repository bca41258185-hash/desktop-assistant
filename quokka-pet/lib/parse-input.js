// 一個輸入框新增所有東西：判斷使用者打的是股票、提醒還是待辦（規格第 3 節）。
// 純函式、不碰檔案或視窗，主行程與面板共用（面板用來即時顯示「→ 今天 15:30 提醒」）。
//
// parseInput(文字, 現在時間) 回傳：
//   { type: 'stock', symbol, market: 'tw' | 'us', ex?: 'tse' | 'otc',
//     nameHint?: '使用者打的名稱' }   // 有的話，主行程查到代號後要核對名稱，對不上就不加入
//   { type: 'reminder', text, rule: { type: 'once', date: 'YYYY-MM-DD', time: 'HH:MM' }
//                                 | { type: 'daily', time } | { type: 'weekly', weekdays: [0-6], time },
//     movedToTomorrow?: true,      // 今天那個時刻已過，改成明天
//     note?: '給使用者看的提示',    // 有做推斷或調整時說明（describe() 會接在後面顯示）
//     uncertain?: true }           // 有看不懂或沒用到的日期時間片段、或是猜的：請使用者確認（一定同時有 note）
//   { type: 'task', text, note?, uncertain? }   // 看得出有日期時間但排不了（已過、不存在、太模糊）時，note 說明原因
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
    'zoom gym bank shop meal mom dad kid kids baby wifi coffee tea bus car taxi bike ' +
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
    // 大寫但剛好是常見英文字（IT、GO、ON、NOW、ME）：仍可以是代號，但帶 word，主行程查到後先問一次再加入
    if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(s)) return NOT_TICKER.has(s) ? null : { type: 'stock', symbol: s, market: 'us', ...(LOWER_WORDS.has(s.toLowerCase()) ? { word: true } : {}) };
    if (/^[a-z]{2,5}(\.[a-z])?$/.test(s)) {
      const up = s.toUpperCase();
      return NOT_TICKER.has(up) || LOWER_WORDS.has(s) ? null : { type: 'stock', symbol: up, market: 'us' };
    }
    return null;
  }

  // ---- 日期詞 --------------------------------------------------------------------------------
  // 作法：先在整句裡找「日期」，再找「時刻」，兩段都拿掉以後剩下的就是內容；
  // 最後做「殘留檢查」：內容裡如果還有看起來像日期或時間、但沒被用到的片段，就不默默排程（見 residue()）。
  const WK = '(?:週|周|星期|禮拜)', WD1 = '(?:[日天]|[一二三四五六](?!\\s*點(?!名|數|心|子|餐|菜|擊))|[1-7](?![\\d點:.樓層Ff號棟館]))', LSEP = '[、,，和跟及與]';
  const PERIOD = '(?:上午|早上|早晨|清晨|一早|中午|下午(?!茶)|午後|傍晚|晚上|晚間|凌晨|半夜|午夜|深夜)';
  const NOT_AFTER_BEFORE = '(?![往去進面天後場置提言者任])';       // 「3點前往工地」的「前」不是截止
  const DOM_NOT = '(?!樓|線|館|出口|機|房|倉|門|棟|店|桌|車|球|字|碼|廳|梯|柱|樑|窗|坑|井|地|公)';   // 「5號出口」「3號倉」不是日期
  // 還不支援的重複方式（每兩週、每隔一週、雙週、每月、每年、每季、每隔幾天…）：一律當待辦並說「尚未支援」，不默默排成一次
  const UNSUP = `每\\s*隔?\\s*(?:\\d+|[${CN}]{1,3}|半)\\s*(?:個)?\\s*(?:${WK}|月|年|季|天|日|工作天)(?:[一二三四五六日天](?!\\s*點)|[1-7](?![\\d點:]))?` +
    `|每\\s*隔\\s*(?:個)?\\s*(?:${WK}|月|年|季|天|日)(?:[一二三四五六日天](?!\\s*點)|[1-7](?![\\d點:]))?|(?:每\\s*)?雙\\s*(?:${WK}|月)(?:[一二三四五六日天](?!\\s*點))?` +
    `|每(?:個)?(?:月|年|季)(?:\\s*(?:\\d{1,2}|[${CN}]{1,3})\\s*[號日]|底|初|中)?|每個?${WK}(?![一二三四五六日天1-7末]|\\s*[一二三四五六日天1-7]\\s*(?:${LSEP}|到|至|~|-))`;
  const DATE_ALTS = [
    ['unsup', UNSUP],
    ['wkdays', `每(?:個)?(?:工作天|工作日|上班日)|平日|工作日|上班日|每?${WK}一\\s*(?:到|至|~|-)\\s*${WK}?五`],
    ['wkend', `每(?:個)?${WK}末`],
    ['weekly', `每(?:個)?${WK}(?<wl>${WD1}(?:\\s*${LSEP}\\s*${WK}?${WD1}|${WD1})*)`],
    ['hourly', `每(?:隔)?\\s*(?:\\d+|[${CN}]{1,2}|半)?\\s*(?:個)?(?:半)?(?:小時|鐘頭|分鐘)`],
    ['daily', '每天早上|每天晚上|每天|每日|天天|每晚|每早'],
    ['rel', '大後天|後天|明天|明日|今天|今日|明早|明晚|今早|今晚|隔天'],
    ['wd', `(?<wp>下下|下|這|本|隔)?(?:個)?${WK}(?<w>${WD1})`],
    ['wend', `(?<wep>下|這|本)?(?:個)?${WK}末`],
    ['ymd', `(?<![\\d/.-])(?:民國\\s*)?(?<y>\\d{3,4})(?<ysep>[/.-])(?<ym>\\d{1,2})\\k<ysep>(?<yd>\\d{1,2})(?![\\d/])[日號]?`],
    ['roc', `民國\\s*(?<ry>\\d{2,3})\\s*年\\s*(?<rm>\\d{1,2})\\s*月\\s*(?<rd>\\d{1,2})\\s*[日號]?`],
    ['md', `(?:(?<mdp>明年|今年)|(?<![\\dA-Za-z/.:-]))(?<mo>\\d{1,2})/(?<da>\\d{1,2})(?![/\\d])[日號]?`],
    ['mdash', `(?<![\\dA-Za-z/.:-])(?!7-11(?!\\d))(?<mo2>\\d{1,2})[-.](?<da2>\\d{1,2})(?=\\s+(?:${PERIOD}\\s*)?(?:\\d{1,2}(?::\\d{2}|\\s*點|\\s*[AaPp]\\.?[Mm](?![a-z]))|[${CN}]{1,3}點))`],
    ['cmd', `(?:(?<cy>(?<!\\d)\\d{4})\\s*年|(?<cyp>明年|今年))?\\s*(?<cmo>(?<!\\d)\\d{1,2}|(?<![${CN}])[${CN}]{1,2})月(?<cda>\\d{1,2}|[${CN}]{1,3})[日號]?`],
    ['dom', `(?:(?<domp>這個?月|本月|下下個?月|下個?月)|(?<![\\d/.:-]))(?<dom>\\d{1,2}|[${CN}]{1,3})號${DOM_NOT}`],
    ['mend', `(?:(?<mep>下下個?|下個?)|(?<mem>(?<![\\d/.:])\\d{1,2}|(?<![${CN}])[${CN}]{1,2})|(?<!\\d))月底`],
    ['mstart', `(?:(?<msp>下下個?|下個?)|(?<msm>(?<![\\d/.:])\\d{1,2}|(?<![${CN}])[${CN}]{1,2})|(?<!\\d))月初`],
    ['ndays', `(?<nd>(?<![\\d.])\\d{1,2}|[${CN}]{1,2})天(?:之後|以後|後)`]
  ];
  const RE_DATE = new RegExp(DATE_ALTS.map(([k, src]) => `(?<A_${k}>${src})`).join('|'), 'g');
  const RE_MD_RANGE = /^\s*(?:-|~|–|—|到|至)\s*(\d{1,2})\/(\d{1,2})(?![/\d])/;
  const RE_PAREN_WD = new RegExp(`^\\s*[（(]\\s*${WK}?([一二三四五六日天])\\s*[）)]`);
  const WDN = (c) => (/[1-7]/.test(c) ? Number(c) % 7 : WD[c]);
  const mkDate = (y, mo, d) => { const x = new Date(y, mo - 1, d); return x.getFullYear() === y && x.getMonth() === mo - 1 && x.getDate() === d ? x : null; };
  const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const mdLabel = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

  // 把找到的日期詞算成 { kind: 'once' | 'daily' | 'weekly', ... }；
  // 回傳 { bad: '原因' } 表示看得出是日期但不能用（不存在、已過、尚未支援）
  function resolveDate(m, now) {
    const g = m.groups, tok = m[0], today = day0(now);
    if (g.A_unsup) return { bad: new RegExp(`^每個?${WK}$`).test(tok) ? `「${tok}」沒說星期幾` : `「${tok.replace(/\s+/g, '')}」這種重複方式尚未支援`, hard: true };
    const past = (date, label) => {
      const days = Math.round((today - date) / 86400000);
      if (days <= 0) return null;
      return days <= 180 ? { bad: `${label} 已經過了` } : 'roll';
    };
    if (g.A_wkdays) return { kind: 'weekly', weekdays: [1, 2, 3, 4, 5], label: tok };
    if (g.A_wkend) return { kind: 'weekly', weekdays: [0, 6], label: tok };
    if (g.A_weekly) {
      const days = [...new Set([...g.wl].filter((c) => /[一二三四五六日天1-7]/.test(c)).map(WDN))].sort();
      return days.length ? { kind: 'weekly', weekdays: days, label: tok } : null;
    }
    if (g.A_hourly) return { bad: `「${tok}」這種重複方式尚未支援`, hard: true };
    if (g.A_daily) return { kind: 'daily', per: /早/.test(tok) ? '早上' : /晚/.test(tok) ? '晚上' : null, label: tok };
    if (g.A_rel) {
      const per = /早$/.test(tok) ? '早上' : /晚$/.test(tok) ? '晚上' : null;
      if (/^今/.test(tok)) return { kind: 'once', offset: 0, today: true, per, label: tok };
      if (/^(明|隔)/.test(tok)) return { kind: 'once', offset: 1, per, label: tok };
      return { kind: 'once', offset: tok === '後天' ? 2 : 3, label: tok };
    }
    if (g.A_wd) {
      const want = WDN(g.w), dow = now.getDay(), toMon = ((8 - dow) % 7) || 7;       // 到下週一還有幾天（週一到週日算一週）
      if (!g.wp || g.wp === '這' || g.wp === '本') return { kind: 'once', weekday: want, label: tok };
      const r = { kind: 'once', offset: toMon + (want === 0 ? 6 : want - 1) + (g.wp === '下下' ? 7 : 0), label: tok };
      if (g.wp === '隔') { r.notes = [`「${tok}」當成下${tok.slice(1)}（每隔一週重複尚未支援）`]; r.uncertain = true; }
      return r;
    }
    if (g.A_wend) {
      let diff = (6 - now.getDay() + 7) % 7;
      if (g.wep === '下') diff += now.getDay() === 0 ? 0 : 7;
      return { kind: 'once', offset: diff, label: tok, notes: [`「${tok}」先設成週六`], softToday: true };
    }
    if (g.A_ymd || g.A_roc) {
      let y = Number(g.y || g.ry); const mo = Number(g.ym || g.rm), d = Number(g.yd || g.rd);
      const roc = y < 1000;
      if (roc && (y < 100 || y > 199)) return null;
      if (roc) y += 1911;
      const date = mkDate(y, mo, d);
      if (!date) return { bad: `「${tok}」這個日期不存在` };
      if (date < today) return { bad: `${tok} 已經過了` };
      const r = { kind: 'once', date, label: tok };
      if (roc) r.notes = [`民國 ${y - 1911} 年＝${y} 年`];
      return r;
    }
    if (g.A_md || g.A_mdash || g.A_cmd) {
      const mo = cnNum(g.mo || g.mo2 || g.cmo), d = cnNum(g.da || g.da2 || g.cda), yp = g.mdp || g.cyp;
      let y = g.cy ? Number(g.cy) : now.getFullYear() + (yp === '明年' ? 1 : 0);
      let date = mkDate(y, mo, d);
      const fixedYear = !!(g.cy || yp);
      if (!date && !fixedYear && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) date = [1, 2, 3, 4].map((k) => mkDate(y + k, mo, d)).find(Boolean) || null;   // 2/29：找下一個閏年
      if (!date) return { bad: mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `「${tok}」這個日期不存在` : `「${tok}」看不懂，請確認日期` };
      const label = tok.replace(/[日號]$/, (c) => (g.A_md ? '' : c));
      const p = past(date, label);
      if (p && p.bad) return p;
      if (p === 'roll') {
        if (fixedYear) return { bad: `${label} 已經過了` };
        date = mkDate(date.getFullYear() + 1, mo, d);
        if (!date) return { bad: `「${tok}」這個日期不存在` };
        return { kind: 'once', date, label, notes: [`${label} 今年已過，當成明年`], uncertain: true };
      }
      const r = { kind: 'once', date, label };
      if (date.getFullYear() !== now.getFullYear() && !fixedYear) { r.notes = [`${label} 是 ${date.getFullYear()} 年`]; r.uncertain = true; }
      return r;
    }
    if (g.A_dom) {
      const d = cnNum(g.dom);
      if (!(d >= 1 && d <= 31)) return { bad: `「${tok}」這個日期不存在` };
      const next = /^下下/.test(g.domp || '') ? 2 : /^下/.test(g.domp || '') ? 1 : 0, fixed = !!g.domp;
      let date = null;
      for (let k = next; k < 4 && !date; k++) {
        const x = mkDate(now.getFullYear() + Math.floor((now.getMonth() + k) / 12), ((now.getMonth() + k) % 12) + 1, d);
        if (x && (x >= today || fixed)) date = x;
        if (fixed) break;
      }
      if (!date) return { bad: `「${tok}」這個日期不存在` };
      if (date < today) return { bad: `${mdLabel(date)} 已經過了` };
      const r = { kind: 'once', date, label: tok, rollMonth: !fixed, dom: d };
      if (!fixed && date.getMonth() !== now.getMonth()) r.notes = [`這個月 ${d} 號已過，設成 ${mdLabel(date)}`];
      return r;
    }
    // 月底／月初；「12月底」「下下個月初」也可以。寫了月份但今年已過 → 明年（附提示）
    if (g.A_mend || g.A_mstart) {
      const end = !!g.A_mend, pre = end ? g.mep : g.msp, M = cnNum(end ? g.mem : g.msm), notes = [];
      let date;
      if (Number.isFinite(M)) {
        if (!(M >= 1 && M <= 12)) return { bad: `「${tok}」看不懂，請確認日期` };
        date = end ? new Date(now.getFullYear(), M, 0) : new Date(now.getFullYear(), M - 1, 1);
        if (date < today) { date = end ? new Date(now.getFullYear() + 1, M, 0) : new Date(now.getFullYear() + 1, M - 1, 1); notes.push(`${M} 月今年已過，當成明年`); }
      } else {
        const k = pre ? (/^下下/.test(pre) ? 2 : 1) + (end ? 1 : 0) : end ? 1 : now.getDate() > 1 ? 1 : 0;
        date = end ? new Date(now.getFullYear(), now.getMonth() + k, 0) : new Date(now.getFullYear(), now.getMonth() + k, 1);
      }
      notes.push(end ? `${tok}＝${mdLabel(date)}` : `「${tok}」先設成 ${mdLabel(date)}`);
      return { kind: 'once', date, label: tok, notes, uncertain: !end || notes.length > 1 };
    }
    if (g.A_ndays) { const n = cnNum(g.nd); return n >= 1 ? { kind: 'once', offset: n, label: tok } : null; }
    return null;
  }

  // 在句子裡找第一個日期詞；回傳 { idx, end, day } 或 { bad }（有日期樣子但不能用）
  function findDate(s, now) {
    RE_DATE.lastIndex = 0;
    let m, bad = null;
    while ((m = RE_DATE.exec(s))) {
      const idx = m.index;
      let end = idx + m[0].length;
      const day = resolveDate(m, now);
      if (!day) { RE_DATE.lastIndex = idx + 1; continue; }
      if (day.bad) { if (day.hard) return { bad: day.bad, hard: true }; if (!bad) bad = day.bad; continue; }   // 不支援的重複方式：整句當待辦
      const notes = (day.notes || []).slice();
      let uncertain = !!day.uncertain, extra = '';
      // 日期區間 12/1-12/3：用開始日，區間寫進內容
      let rm;
      if (m.groups.A_md && (rm = s.slice(end).match(RE_MD_RANGE))) { extra = `（${m.groups.mo}/${m.groups.da}–${rm[1]}/${rm[2]}）`; end += rm[0].length; notes.push(`用開始日 ${m.groups.mo}/${m.groups.da} 提醒`); }
      // 括號裡的星期「12/5（六）」：拿掉，順便核對
      if (day.date && (rm = s.slice(end).match(RE_PAREN_WD))) {
        end += rm[0].length;
        if (WD[rm[1]] !== day.date.getDay()) { notes.push(`${mdLabel(day.date)} 是星期${WD_NAME[day.date.getDay()]}，不是星期${rm[1]}，請確認日期`); uncertain = true; }
      }
      return { idx, end, day: { ...day, notes, uncertain }, extra };
    }
    return bad ? { bad } : null;
  }

  // ---- 時刻 ----------------------------------------------------------------------------------
  const AP = '(?:am|pm|a\\.m\\.|p\\.m\\.)';
  // 一個時刻：15:30、3點、3點半、3點15分、3 點 15 分、三點一刻、兩點四十五、3點鐘、8:30pm、3pm
  const timeSrc = (k) => `(?<h${k}>(?<![\\d:./A-Za-z])\\d{1,2}|(?<![A-Za-z])[${CN}]{1,3})(?:(?<colon${k}>:)(?<mm${k}>\\d{2})(?![\\d:])|\\s*點(?!數|名|擊|子|心|餐|菜)(?:鐘|整)?(?:\\s*(?:(?<half${k}>半)|(?<q${k}>[一三])刻|(?<m${k}>\\d{1,2}|[${CN}]{1,3})\\s*分(?!鐘|之))|(?<m2${k}>\\d{1,2})(?![\\d樓F坪件張個人份頁號年月日%/:.x×*])|(?<m3${k}>[${CN}]{2,3})(?![樓坪件張個人份頁]))?|(?=\\s*${AP}(?![a-z])))(?:\\s*(?<ap${k}>${AP})(?![a-z]))?`;
  const RE_TIME = new RegExp(
    `(?:(?<pre>大概|大約|約莫|差不多|快)\\s*)?(?:(?<ap0>${AP})\\s+)?(?:(?<per>${PERIOD})\\s*的?\\s*)?${timeSrc('')}` +
    `(?:\\s*(?:~|-|–|—|到|至)\\s*(?:(?<perB>${PERIOD})\\s*)?${timeSrc('B')})?` +
    `(?<apx>多|左右|前後|上下)?(?:\\s*(?<dl>以前|之前|前)${NOT_AFTER_BEFORE})?`, 'gi');
  const RE_PERIOD_ONLY = new RegExp(`(?<pb>下班(?:以前|之前|前))|(?<p>${PERIOD})(?!\\s*(?:\\d|[${CN}]{1,3}點))(?:\\s*(?<pdl>以前|之前|前)${NOT_AFTER_BEFORE})?`);
  const PERIOD_DEFAULT = { 上午: '09:00', 早上: '09:00', 早晨: '09:00', 清晨: '09:00', 一早: '09:00', 中午: '12:00', 下午: '14:00', 午後: '14:00', 傍晚: '18:00', 晚上: '20:00', 晚間: '20:00' };
  const PREFIX = /^(?:請|麻煩)?(?:幫我)?(?:提醒我?|記得要?|別忘記?了?|不要忘記?了?|叫我)\s*[:,，]?\s*/;
  // 「3點」後面接這些多半不是時間（三點意見、3點多少錢）
  const NOT_TIME_AFTER = /^(點|也|都|兒|小|意見|建議|問題|心意|想法|看法|疑問|要求|說明|修正|結論|原因|重點|注意|事項|不|就好|時間|東西|多少)/;
  const SCALE_WORDS = /比例|大樣|詳圖|平面圖|立面圖|剖面圖|scale/i;         // 「1:50 平面圖」是比例尺不是時間
  const HOLE = '\u0001';                                                   // 日期被拿掉以後留下的記號

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
    const M = g['mm' + k] != null ? Number(g['mm' + k]) : g['half' + k] ? 30 : g['q' + k] ? (g['q' + k] === '一' ? 15 : 45)
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
  const apPer = (ap) => (ap ? (/^p/i.test(ap) ? '下午' : '上午') : null);

  // 把「日期 day ＋ 時刻 g ＋ 內容」算成結果。回傳提醒，或 { type: 'task', note, uncertain }（明寫的時間已過等）
  //   opt.notes：先前累積的提示；opt.noClock：沒寫幾點、用預設時間（不做上下午推斷）
  function build(g, content, day, now, opt = {}) {
    const notes = (opt.notes || []).concat(day.notes || []);
    let uncertain = !!opt.uncertain || !!day.uncertain;
    const per = g.per || apPer(g.ap || g.ap0) || (g.hB != null && !g.perB ? apPer(g.apB) : null) || day.per || null;
    const c = clock(g, '', per);
    if (!c) return null;
    let { H, M, wrap, soft } = c;
    const literalH = cnNum(g.h);
    const nowHM = hm(now.getHours(), now.getMinutes());
    const hasDay = day.kind !== 'none';
    const explicitDay = hasDay && !day.today;                     // 明天、週五、12/5、每天…（今天另外處理）
    const cue = cueOf(content);
    let eClock = g.hB != null ? clock(g, 'B', g.perB || apPer(g.apB) || per) : null, eH = eClock ? eClock.H : null;
    let guessNote = null;
    if (!per && !wrap && !opt.noClock && H >= 1 && H <= 12) {
      const endLit = eClock && !g.perB && !g.apB ? cnNum(g.hB) : null;
      if (endLit != null && endLit >= 1 && endLit <= 12 && !cue) {
        // 時間範圍：兩頭一起看。開始 1–6 點 → 都是下午；否則開始照字面，結束比開始早就當下午（8點到5點＝8:00–17:00）
        if (H <= 6) { H += 12; if (eH < 12) eH += 12; if (hasDay) guessNote = `當成下午 ${literalH} 點；凌晨請寫「凌晨${literalH}點」`; }
        else if (eH <= H && eH < 12) eH += 12;
      }
      else if (cue === 'late') { if (H === 12) { H = 0; wrap = true; } else if (H <= 5) wrap = true; else H += 12; }
      else if (cue === 'evening') { if (H < 12) H += 12; }
      else if (cue === 'noon') { if (H <= 3) H += 12; }
      else if (cue === 'morning') { /* 照字面（早上） */ }
      else if (explicitDay) {
        // 有寫日期（明天、週五、12/5、每天、每週X）：1–6 點一律當成下午並提示；7–12 點照字面
        if (H <= 6) { guessNote = `當成下午 ${H} 點；凌晨請寫「凌晨${H}點」`; H += 12; }
      } else if (H <= 6) {
        // 1–6 點：上班時間幾乎都是指下午。例外：半夜還醒著、而且那個凌晨時刻還沒到
        const owl = now.getHours() < 6 && hm(H, M) > nowHM;
        if (!owl) H += 12;
      } else if (H <= 11 && hm(H, M) <= nowHM) {
        // 7–11 點、早上那次已過：晚上那次還沒到，而且（使用者明說今天／現在已是傍晚／是 7 點）→ 當成晚上
        if (hm(H + 12, M) > nowHM && (day.today || now.getHours() >= 17 || H === 7)) {
          const am = sayHour(hm(H, M)), pm = sayHour(hm(H + 12, M));
          guessNote = day.today ? `今天${am}已過，改成${pm}？` : `${am}已過，當成${pm}`;
          H += 12;
        }
      }
    }
    if (guessNote) notes.push(guessNote);
    let time = hm(H, M);

    // 結束時間（時間範圍）：只用來寫進內容
    let rangeTxt = '';
    if (eClock) {
      if (H >= 12 && literalH < 12 && eH < 12 && !g.perB && !g.apB) eH += 12;
      if (hm(eH, eClock.M) <= time && eH < 12) eH += 12;
      if (eH <= 23 && hm(eH, eClock.M) > time) rangeTxt = `（${showHM(time)}–${showHM(hm(eH, eClock.M))}）`;
    }
    const deadline = !!g.dl;
    const LEAD = 30;
    const withLead = (t) => { const mins = Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); return mins >= LEAD ? hm(Math.floor((mins - LEAD) / 60), (mins - LEAD) % 60) : t; };
    let text = content + rangeTxt + (opt.suffix || '');
    const done = (r) => { if (notes.length) r.note = notes.join('；'); if (uncertain) r.uncertain = true; return r; };
    const giveUp = (why) => { notes.push(why); uncertain = true; return done({ type: 'task' }); };

    // 重複提醒
    if (day.kind === 'daily' || day.kind === 'weekly') {
      let weekdays = day.weekdays;
      if (wrap && weekdays) weekdays = weekdays.map((d) => (d + 1) % 7).sort();          // 「每天晚上12點」＝隔天 00:00
      let ruleTime = time;
      if (deadline) { ruleTime = withLead(time); text += opt.dlLabel || `（${showHM(time)} 前）`; notes.push(ruleTime === time ? `${time} 截止，準時提醒` : `${time} 截止，提早 ${LEAD} 分鐘提醒`); }
      return done({ type: 'reminder', text, rule: day.kind === 'daily' ? { type: 'daily', time: ruleTime } : { type: 'weekly', weekdays, time: ruleTime } });
    }

    // 一次性：決定日期。明寫的日期如果已過，不偷偷換日
    let date, moved = false;
    const passedToday = time <= nowHM;
    if (!hasDay || day.today) {
      date = new Date(now);
      if (wrap && day.today) date = addDays(date, 1);                                                // 今晚12點＝明天 00:00
      else if (wrap || soft) { if (passedToday) date = addDays(date, 1); }                            // 直接找下一次，不算「已過」
      else if (passedToday) {
        if (day.today) return giveUp(`今天 ${time} 已經過了，先當成待辦`);
        date = addDays(date, 1); moved = true;
      }
    } else if (day.weekday != null) {
      let diff = (day.weekday - now.getDay() + 7) % 7;
      if (diff === 0 && passedToday && !wrap) { diff = 7; notes.push(`今天就是${day.label.replace(/^(這|本)/, '')}、${time} 已過，設成下週`); }
      date = addDays(now, diff + (wrap ? 1 : 0));
    } else {
      date = day.date ? new Date(day.date) : addDays(now, day.offset);
      if (wrap) date = addDays(date, 1);
      else if (ymd(date) === ymd(now) && passedToday) {
        if (day.rollMonth) {
          const x = [1, 2, 3].map((k) => mkDate(now.getFullYear() + Math.floor((now.getMonth() + k) / 12), ((now.getMonth() + k) % 12) + 1, day.dom)).find(Boolean);
          if (!x) return giveUp(`${day.label} ${time} 已經過了，先當成待辦`);
          date = x; notes.push(`這個月 ${day.dom} 號 ${time} 已過，設成 ${mdLabel(x)}`);
        } else if (day.softToday) { date = addDays(date, 7); notes.push(`今天 ${time} 已過，設成下週`); }
        else return giveUp(`${day.label} ${time} 已經過了，先當成待辦`);
      }
    }

    if (deadline) {
      // 截止型：提早提醒（30 分鐘；來不及就 10 分鐘；再來不及就準時）
      const [y, mo, d] = ymd(date).split('-').map(Number);
      const due = new Date(y, mo - 1, d, H, M, 0, 0);
      let lead = [LEAD, 10, 0].find((n) => due.getTime() - n * 60000 > now.getTime());
      if (lead == null) lead = 0;
      const at = new Date(due.getTime() - lead * 60000);
      text += opt.dlLabel || (wrap && time === '00:00' ? '（半夜 12 點前）' : `（${showHM(time)} 前）`);
      notes.push(lead ? `${time} 截止，提早 ${lead} 分鐘提醒` : `${time} 截止，快到了，準時提醒`);
      date = at; time = hm(at.getHours(), at.getMinutes());
    }
    const r = { type: 'reminder', text, rule: { type: 'once', date: ymd(date), time } };
    if (moved) r.movedToTomorrow = true;
    return done(r);
  }

  const tidy = (t) => t.replace(new RegExp(HOLE, 'g'), ' ').replace(/\s+/g, ' ').replace(/^[\s,，、;；:~\-]+|[\s,，、;；:~\-]+$/g, '').replace(/^的(?=.)/, '').trim();

  // 殘留檢查：內容裡還有「看起來像日期或時間、但沒被用到」的片段嗎？回傳 { kind: 'date' | 'time', frag } 或 null
  const RESIDUE_DATE = new RegExp([
    '\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}', '民國\\s*\\d{2,3}', '(?<![\\dA-Za-z./:-])(?!7-11)\\d{1,2}-\\d{2}(?![\\d-])', '(?<![\\d.A-Za-z/:-])\\d{1,2}\\.\\d{1,2}(?=\\s*$|\\s+\\d)', '(?<![\\dA-Za-z/.:x×*-])\\d{1,2}/\\d{1,2}(?![/\\d])', `(?:\\d{1,2}|[${CN}]{1,2})月(?:\\d{1,2}|[${CN}]{1,3})[日號]?`,
    `(?<![\\d/.:-])\\d{1,2}號${DOM_NOT}`, '月底|月初|月中|年底|年初', `隔${WK}|隔天|隔週|隔周`, `下下?(?:個)?(?:${WK}|月)|下下?週|明年|後年`, `${WK}末`,
    `(?:這|本)?(?:個)?${WK}(?:[一二三四五六日天]|[1-7](?!\\d))`, '大後天|後天|明天|明日|今天|今日|昨天|前天|明早|明晚|今早|今晚', `每(?:天|日|週|周|星期|禮拜|個?月|年|小時|隔)`
  ].join('|'));
  const RESIDUE_TIME = new RegExp([
    `(?<![\\d:./A-Za-z第])\\d{1,2}\\s*點(?!數|名|擊|子|心|餐|菜)`, `(?<![\\d:./A-Za-z])\\d{1,2}:\\d{2}(?![\\d:])`, `[${CN}]{1,3}點(?:半|鐘|整|[一三]刻|\\d|[${CN}]{1,3}分)`,
    `(?<![A-Za-z\\d])\\d{1,2}(?::\\d{2})?\\s*${AP}(?![a-z])`, `(?:\\d+|[${CN}]{1,3}|半)\\s*(?:個)?(?:分鐘|小時|鐘頭)(?:之後|以後|後)`
  ].join('|'), 'i');
  const RESIDUE_GLUED = /\d{3,}\s*點(?!數|名|擊|子|心|餐|菜)|\d{5,}(?::\d{2}(?!\d)|[/.\-]\d|[年月號日]|天(?:之後|以後|後))/;      // 長串數字黏著時刻或日期（回電09123456783點）：分不出哪幾位是時間
  function residue(content) {
    let m = content.match(RESIDUE_GLUED);
    if (m) return { kind: 'time', frag: m[0], glued: true };
    m = content.match(RESIDUE_DATE);
    if (m) return { kind: 'date', frag: m[0] };
    m = content.match(RESIDUE_TIME);
    if (m && !(/^1:\d{2}$/.test(m[0]) && SCALE_WORDS.test(content))) return { kind: 'time', frag: m[0].trim() };
    return null;
  }

  // 在句子裡找時刻（日期已經換成 HOLE）。回傳 { idx, end, g, approx } 或 { bad }（有時間樣子但數字不對）
  function findTime(s, hasDay) {
    RE_TIME.lastIndex = 0;
    let m, bad = null;
    while ((m = RE_TIME.exec(s))) {
      const idx = m.index, g = m.groups, end = idx + m[0].length;
      const next = () => { RE_TIME.lastIndex = idx + 1; };
      const hourCN = !/^\d/.test(g.h), hasMin = !!(g.mm || g.half || g.q || g.m || g.m2 || g.m3);
      const hIdx = idx + m[0].indexOf(g.h, (g.pre || '').length), prev = hIdx > 0 ? s[hIdx - 1] : '';
      const atStart = idx === 0, bounded = atStart || /[\s,，、;；:（(\u0001]/.test(s[idx - 1]);
      const rest0 = s.slice(end), strong = !!(g.per || g.ap || g.ap0 || g.dl || g.hB);
      const notTime = !hasMin && !strong && !g.apx && NOT_TIME_AFTER.test(rest0.trim());
      let ok;
      if (g.per || g.ap || g.ap0) ok = true;
      else if (g.colon) ok = bounded || end === s.length || /[\u4e00-\u9fff]/.test(prev);
      else if (hourCN) ok = !notTime && (bounded || hasMin || strong || end === s.length || /[約在到跟於]/.test(prev)) && !/[有差第這那幾]/.test(prev);
      else ok = !notTime && !/[第這那有共幾每]/.test(prev);
      if (!ok) { next(); continue; }
      const c = clock(g, '', g.per || apPer(g.ap || g.ap0) || null);
      if (!c) { if (!bad) bad = m[0].trim(); next(); continue; }
      if (g.colon && !g.per && !g.ap && !hasDay && cnNum(g.h) === 1 && SCALE_WORDS.test(s)) { next(); continue; }
      return { idx, end, g, approx: g.pre || g.apx ? m[0].replace(/(以前|之前|前)$/, '').trim() : null };
    }
    return bad ? { bad } : null;
  }

  // 日期＋時刻＋內容（任何順序）。回傳提醒、{ type:'task', note }（看得出是日期時間但不能排），或 null（不是提醒）
  function parseTimed(s0, now) {
    const notes = [];
    let uncertain = false, suffix = '';
    // 「9-10點」→「9點-10點」；「3、4點」「三四點」→ 取前面那個，原文留在內容後面
    let s = s0.replace(new RegExp(`(?<![\\d:./A-Za-z])(\\d{1,2})(\\s*(?:~|-|–|—|到|至)\\s*(?:${PERIOD}\\s*)?\\d{1,2}\\s*點)`), '$1點$2');
    s = s.replace(/(?<![\d:./A-Za-z])(\d{1,2})\s*[、,，或]\s*(\d{1,2})\s*點(左右|前後|多)?/, (all, a) => { suffix = `（${all}）`; return `${a}點`; });
    s = s.replace(/(?<![零〇一二兩三四五六七八九十週周期拜])([一二兩三四五六七八九])([二三四五六七八九])點(左右|前後|多)?/, (all, a, b) => { if (CN_D[b] !== CN_D[a] + 1) return all; suffix = `（${all}）`; return `${a}點`; });

    const dm = findDate(s, now);
    if (dm && dm.hard) return { type: 'task', note: `${dm.bad}，先當成待辦`, uncertain: true };   // 不支援的重複方式：不排成一次性提醒
    let day = { kind: 'none' }, work = s, dateDl = false;
    if (dm && dm.day) {
      day = dm.day; suffix = dm.extra + suffix;
      work = s.slice(0, dm.idx) + HOLE + s.slice(dm.end);
      const dl = work.match(new RegExp(`${HOLE}\\s*(?:以前|之前|前)${NOT_AFTER_BEFORE}`));
      if (dl) { dateDl = true; work = work.replace(dl[0], HOLE); }
    }
    const tm = findTime(work, day.kind !== 'none');
    let g, content, noClock = false, dlLabel = null;
    if (tm && tm.g) {
      g = tm.g;
      let tEnd = tm.end;
      if (g.pre === '快' && work[tEnd] === '了') tEnd++;              // 「快3點了叫我」
      content = tidy(work.slice(0, tm.idx).replace(/(等一下|等下|待會兒?|等等)\s*$/, '') + work.slice(tEnd));      // 「等下3點開會」的「等下」不留在內容裡
      if (tm.approx) suffix += `（${tm.approx}）`;
      if (!content) { if (day.kind === 'none') return null; content = '時間到了'; }      // 只有時間 → 待辦；有日期詞 → 提醒（預設內容）
    } else {
      // 沒寫幾點：有時段詞用時段的預設，只有日期就早上 9 點；都要在提示裡說清楚
      const pm = work.match(RE_PERIOD_ONLY);
      const per = pm ? (pm.groups.pb ? '下班前' : pm.groups.p) : day.per || null;
      if (day.kind === 'none' && !per) return tm && tm.bad ? { type: 'task', note: `「${tm.bad}」時間不對，先當成待辦`, uncertain: true } : dm && dm.bad ? { type: 'task', note: `${dm.bad}，先當成待辦`, uncertain: true } : null;
      content = tidy(pm ? work.slice(0, pm.index) + ' ' + work.slice(pm.index + pm[0].length) : work);
      if (!content) return null;
      if (tm && tm.bad) return { type: 'task', note: `「${tm.bad}」時間不對，先當成待辦`, uncertain: true };
      noClock = true;
      if (per === '下班前') { g = { h: '17', mm: '30', colon: ':', dl: '前' }; dlLabel = '（下班前）'; notes.push('下班前當成 17:30 前'); }
      else if (per && PERIOD_DEFAULT[per]) {
        const t = PERIOD_DEFAULT[per];
        g = { h: String(Number(t.slice(0, 2))), mm: t.slice(3), colon: ':' };
        if (pm && pm.groups.pdl) { g.dl = '前'; dlLabel = `（${per}前）`; }
        notes.push(`沒寫幾點，先設${sayHour(t)}`);
      } else if (per) return { type: 'task', note: `「${per}」沒寫幾點，先當成待辦`, uncertain: true };
      else if (day.today) return null;                              // 「今天交圖」：就是今天的待辦
      else {
        g = { h: '9', mm: '00', colon: ':' };
        if (dateDl) { dlLabel = `（${day.label.replace(/[早晚]$/, '天')}前）`; notes.push(`沒寫時間，${day.label.replace(/[早晚]$/, '天')} 09:00 提醒`); }
        else notes.push('沒寫時間，先設早上 9 點');
      }
      if (dateDl && !dlLabel) dlLabel = `（${day.label}前）`;
    }
    if (dm && dm.bad && day.kind === 'none') return { type: 'task', note: `${dm.bad}，先當成待辦`, uncertain: true };
    if (day.kind === 'none' && wdOrHour(s)) return wdOrHour(s);
    // 殘留檢查
    const left = residue(content);
    if (left) {
      if (left.kind === 'date' && day.kind === 'none') return { type: 'task', note: `「${left.frag}」看不懂，請確認日期；先當成待辦`, uncertain: true };
      notes.push(left.glued ? `「${left.frag}」數字黏在一起，看不出是哪天幾點，請確認` : left.kind === 'date' ? `「${left.frag}」看不懂，請確認日期` : `「${left.frag}」沒有用到，請確認時間`);
      uncertain = true;
    }
    // 只有日期的截止（週五前送審）：當天 09:00 提醒，不再提早
    if (noClock && dateDl && !g.dl) suffix += dlLabel;
    return build(g, content, day, now, { notes, uncertain, suffix, noClock, dlLabel });
  }

  // N 分鐘／小時後（中文數字、半小時、一個半小時也可以）
  const REL_N = `(?:(?<n>\\d+(?:\\.\\d+)?|[${CN}]{1,3})(?:個)?(?<hf>半)?|(?<only>半)(?:個)?)`;
  const REL_U = '(?<u>分鐘|分|mins?|m|小時|鐘頭|時|hrs?|h)';
  // 小時後面還可以接「半」或「Y分（鐘）」：1小時半後、2小時30分後、兩小時十五分鐘後
  const REL_X = `(?:(?<hf2>半)|(?<m2>\\d{1,2}|[${CN}]{1,3})\\s*(?<u2>分鐘|分))?`;
  const RE_REL = new RegExp(`^${REL_N}\\s*${REL_U}${REL_X}(?<after>之後|以後|後)?\\s*(?![鐘內以左前])(?<text>.*)$`, 'i');
  const RE_REL_TAIL = new RegExp(`^(?<text>.+?)[\\s,，]*${REL_N}\\s*${REL_U}${REL_X}(?<after>之後|以後|後)$`, 'i');
  // 沒寫「後」的「30分 泡茶」：只有內容是常見的倒數情境才當成倒數（「30分 簡報」多半是指長度 → 待辦）
  const TIMER_WORDS = /^(泡|煮|燉|滷|蒸|烤|熬|悶|燜|休息|喝水|關火|收衣|洗衣|晾|叫我|提醒|起來|動一動|伸展|出門|出發|吃藥|回電|跨日)/;
  function parseRelative(s, now, re) {
    const m = s.match(re);
    if (!m) return null;
    const g = m.groups, unit = g.u.toLowerCase(), isHour = /^(小時|鐘頭|時|hrs?|h)$/.test(unit);
    const cn = g.only || !/^\d/.test(g.n);
    if (cn && !g.after) return null;                              // 「十分感謝」不是十分鐘
    let n = g.only ? 0.5 : cnNum(g.n);
    if (!Number.isFinite(n)) return null;
    if (g.hf) { if (!isHour) return null; n += 0.5; }
    if (g.hf2 || g.m2) {                                           // 「X小時半」「X小時Y分」：只有小時後面能接
      if (!isHour || g.hf) return null;
      if (g.hf2) n += 0.5;
      else { const mm = /^\d/.test(g.m2) ? Number(g.m2) : cnNum(g.m2); if (!Number.isFinite(mm) || mm >= 60) return null; n += mm / 60; }
    }
    const text = tidy(g.text || '').replace(PREFIX, '');
    if (!text && !g.after) return null;                           // 「100分」「5m」不是提醒
    if (!g.after) {
      // 英文 m／h 是公尺、小時數（6m 道路退縮、2h 防火時效）：一定要有「後」才算倒數
      if (unit === 'm' || unit === 'h') return null;
      if (!/^(mins?|hrs?)$/.test(unit) && !TIMER_WORDS.test(text)) return { hint: `要倒數請寫「${m[0].slice(0, m[0].length - (g.text || '').length).trim()}後」` };
    }
    const mins = isHour ? n * 60 : n;
    if (!(mins > 0 && mins <= 7 * 24 * 60)) return null;
    // 規則只能存到「分」，排程也只看到分；為了確實滿 N 分鐘，有零頭秒數就進位到下一分鐘（最多晚 59 秒，不會提早）
    let at = new Date(now.getTime() + Math.round(mins * 60000));
    if (at.getSeconds() || at.getMilliseconds()) { at = new Date(at.getTime() + 60000); at.setSeconds(0, 0); }
    const r = { type: 'reminder', text: text || '時間到了', rule: { type: 'once', date: ymd(at), time: hm(at.getHours(), at.getMinutes()) } };
    const left = text && residue(text);
    if (left) { r.note = left.kind === 'date' ? `「${left.frag}」看不懂，請確認日期` : `「${left.frag}」沒有用到，請確認時間`; r.uncertain = true; }
    return { r, after: !!g.after };
  }

  // 「15.30開會」「1530開會」：多半是 15:30，但不確定，所以附提示
  const UNIT_AFTER = '(?![年萬元塊坪張個件號樓人份台組片支箱米公毫厘度級%])';
  function parseLooseClock(s, now) {
    let m = s.match(new RegExp(`(?<![\\d.A-Za-z])(\\d{1,2})\\.(\\d{2})(?![\\d.])(?=\\s*[\\u4e00-\\u9fff])${UNIT_AFTER}`)), raw;
    if (m && Number(m[1]) >= 6 && Number(m[1]) <= 23 && Number(m[2]) <= 59 && Number(m[2]) % 5 === 0) raw = m;
    else if ((m = s.match(new RegExp(`(?:^|(?<=[\\s\\u4e00-\\u9fff]))(\\d{2})(\\d{2})(?=[\\u4e00-\\u9fff])${UNIT_AFTER}`))) && Number(m[1]) <= 23 && Number(m[2]) <= 59 && !/^(19|20)$/.test(m[1])) raw = m;
    if (!raw) return null;
    const t = `${Number(raw[1])}:${raw[2]}`;
    const r = parseTimed(s.slice(0, raw.index) + ' ' + t + ' ' + s.slice(raw.index + raw[0].length), now);
    if (!r || r.type !== 'reminder') return null;
    r.note = `把「${raw[0]}」當成 ${pad(Number(raw[1]))}:${raw[2]}，請確認` + (r.note ? `；${r.note}` : '');
    r.uncertain = true;
    return r;
  }

  // 「週三點」「下週三點半」：是星期三，還是（下週）三點？分不出來就問
  const RE_WD_OR_HOUR = new RegExp(`(?:下下|下|這|本)?(?:個)?${WK}[一二三四五六]\\s*點(?!名|數|心|子|餐|菜|擊)`);
  function wdOrHour(s) {
    const m = s.match(RE_WD_OR_HOUR);
    return m ? { type: 'task', note: `「${m[0]}」是星期${m[0].slice(-2, -1)}還是${m[0].slice(-2)}？請寫清楚；先當成待辦`, uncertain: true } : null;
  }

  function parseReminder(s, now) {
    const rel = parseRelative(s, now, RE_REL);
    if (rel && rel.r && rel.after) return rel.r;
    const timed = parseTimed(s, now);
    if (timed && timed.type === 'reminder') return timed;
    if (rel && rel.r) return rel.r;
    const tail = parseRelative(s, now, RE_REL_TAIL);
    if (tail && tail.r) return tail.r;
    const loose = !timed && parseLooseClock(s, now);
    if (loose) return loose;
    if (timed) return timed;                                       // { type: 'task', note }
    if (rel && rel.hint) return { type: 'task', note: rel.hint };
    // 完全沒排到，但句子裡有模糊的日期詞：當待辦，並說明為什麼
    const left = residue(s);
    if (left && left.glued) return { type: 'task', note: `「${left.frag}」數字黏在一起，看不出是哪天幾點，請確認`, uncertain: true };
    const amb = wdOrHour(s);
    if (amb) return amb;
    if (left && /^\d{1,2}-\d{2}$/.test(left.frag)) return { type: 'task', note: `「${left.frag}」看不懂，請確認日期；先當成待辦`, uncertain: true };
    if (left && left.kind === 'date' && /下|隔|年|月[底初中]/.test(left.frag)) return { type: 'task', note: `「${left.frag}」沒說是哪一天，先當成待辦`, uncertain: true };
    return null;
  }

  // 提醒內容去掉句中的「提醒我／記得／要記得…」（「明天早上提醒我帶便當」→「帶便當」）；去光了就用「時間到了」
  const MID_CUE = /(?:請|麻煩)?(?:幫我)?(?:提醒我|要記得|記得要|記得|別忘記?了|不要忘記?了)\s*[:,，]?\s*/g;
  function remText(t) {
    const out = tidy(String(t || '').replace(PREFIX, '').replace(MID_CUE, ''));
    return out || '時間到了';
  }

  function parseInput(raw, now = new Date()) {
    const s = normalize(raw);
    if (!s) return { type: 'none' };
    // 1)、2) 股票
    const stock = parseStock(s);
    if (stock) return stock;
    // 3)–5) 提醒（先試去掉「提醒我」「記得」等前綴，再試原文）
    const stripped = s.replace(PREFIX, '');
    let rem = stripped !== s && stripped ? parseReminder(stripped, now) : null;
    if (!rem || rem.type !== 'reminder') rem = parseReminder(s, now) || rem;
    if (rem && rem.type === 'reminder') { rem.text = remText(rem.text); return rem; }
    // 6) 其他：待辦（看得出有日期時間但排不了的，帶 note 說明原因）
    const task = { type: 'task', text: s.slice(0, 200) };
    if (rem && rem.note) { task.note = rem.note; if (rem.uncertain) task.uncertain = true; }
    return task;
  }

  // 給使用者看的提示（輸入框下方、送出後的訊息共用）：改到明天的一定要說，其他推斷接在後面
  function noteText(r) {
    if (!r) return '';
    const moved = r.movedToTomorrow && !/改明天|改成明天|設成明天/.test(r.note || '') ? '今天已過，改明天' : '';
    return [moved, r.note].filter(Boolean).join('；');
  }
  // 給輸入框下方顯示的說明
  function describe(r, now = new Date()) {
    if (!r || r.type === 'none') return '';
    if (r.type === 'task') return `→ 新增待辦${r.note ? `（${r.note}）` : ''}`;
    if (r.type === 'stock') return r.market === 'tw' ? `→ 加入台股 ${r.symbol}` : `→ 加入美股 ${r.symbol}${r.word ? '（也是一般英文字，送出後會先問）' : ''}`;
    const t = r.rule, nt = noteText(r), tail = nt ? `（${nt}）` : '';
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

  const api = { parseInput, describe, normalize, noteText };
  if (typeof window !== 'undefined') window.QuokkaParse = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
