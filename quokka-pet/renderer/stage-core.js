// 舞台共用核心：常數、畫格快取、共用排程迴圈、回報範圍（規格第 1、6、10 節）
// 其他舞台檔案（stage-ball.js、stage-bubble.js、stage-actor.js、stage.js）都掛在 window.Stage 上。
// 省資源的做法：
//   · 走路、轉身、待機、睡覺、看左看右、撿球的畫格先用 3D 姿勢模型畫成 SVG，再轉成 PNG 存起來，之後只換圖片
//   · 位置只改 CSS transform（交給顯示卡），不移動視窗
//   · 所有庫卡和球共用一個排程迴圈；沒有東西在動時迴圈完全停下（不跑 requestAnimationFrame），只留低頻計時器
(function () {
  const S = window.Stage = {};
  S.POSE = window.QuokkaPose; S.ART = window.QuokkaArt; S.TR = window.QuokkaTraits; S.ANIM = window.QuokkaAnim;
  S.api = window.stageApi;
  S.stageEl = document.getElementById('stage');
  S.fxEl = document.getElementById('fx');
  S.VB = { x: -10, y: -30, w: 180, h: 230 };          // 每隻的畫框（SVG 單位）；腳底在 (80,183)
  S.VB_STR = `${S.VB.x} ${S.VB.y} ${S.VB.w} ${S.VB.h}`;
  // 寬畫框：四腳著地、往前撲這類比較長的姿勢（撿球）用，免得口鼻或尾巴被切掉；圖片往左右各多 50 單位
  S.VBW = { x: -60, y: -30, w: 280, h: 230 };
  S.VBW_STR = `${S.VBW.x} ${S.VBW.y} ${S.VBW.w} ${S.VBW.h}`;
  S.FOOT = { x: 80, y: 183 };                         // 腳底在 SVG 座標
  S.SCALE = 0.95;                                     // 1 個 SVG 單位約 0.95 px（之後乘上個體大小）
  S.MAX_MOVING = 3;                                   // 同時最多 3 隻在動（只限 L4–L7）
  S.REPORT_GAP = 1200;                                // 報告佇列每則間隔
  S.QUEUE_MAX = 5;
  S.LIVE_MS = 1000 / 24;                              // 即時繪製的動作每秒 24 格
  S.actors = new Map();
  S.balls = new Set();
  S.cursor = { x: -9999, y: -9999 };
  S.paused = false;
  S.mode = 'awake';                                   // 全域模式：awake / asleep / hidden
  S.systemReduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  S.reduceMotion = S.systemReduce;                    // ⚙「減少動態效果」：system（跟系統）／on／off
  S.settings = { fetchReturn: 'alternate', walk: 'home', reducedMotion: 'system' };
  S.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  S.str = (v, n = 200) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);

  // ---- 畫格快取：同一隻、同一個姿勢只畫一次（LRU，總量 200 MB） ---------------------
  const cache = new Map();          // key → { url, bytes }
  let cacheBytes = 0;
  const CACHE_LIMIT = 200 * 1024 * 1024;
  S.frameURL = function (a, key, th, pose, wide) {
    const k = a.id + '|' + key + (wide ? '|w' : '');
    const hit = cache.get(k);
    if (hit) { cache.delete(k); cache.set(k, hit); return hit.url; }   // 最近使用的移到最後
    S.ART.configure(a.traits);
    let svg = S.POSE.svg(th, 'f' + a.uid, pose, wide ? S.VBW_STR : S.VB_STR);
    S.ART.configure(null);
    // 圖片是獨立文件，讀不到 CSS 變數 → 把頭帶等顏色直接寫進去
    const dpr = window.devicePixelRatio || 1;
    svg = svg.replace(/var\(--band,\s*#[0-9a-fA-F]{6}\)/g, a.traits.band || '#e5533d')
      .replace('<svg ', `<svg width="${Math.round(a.w * (wide ? S.VBW.w / S.VB.w : 1) * dpr)}" height="${Math.round(a.h * dpr)}" `);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const entry = { url: URL.createObjectURL(blob), bytes: blob.size, key: k };
    cache.set(k, entry);
    cacheBytes += blob.size;
    toPNG(entry, svg);
    while (cacheBytes > CACHE_LIMIT && cache.size) {               // 超過上限：丟掉最久沒用的
      const [ok, ov] = cache.entries().next().value;
      URL.revokeObjectURL(ov.url); cacheBytes -= ov.bytes; cache.delete(ok);
    }
    return entry.url;
  };
  // 某隻的外觀變了或被刪掉：丟掉牠的所有畫格
  S.purgeFrames = function (id) {
    for (const [k, v] of cache) if (k.startsWith(id + '|')) { URL.revokeObjectURL(v.url); cacheBytes -= v.bytes; cache.delete(k); }
  };
  S.cacheInfo = () => ({ n: cache.size, mb: +(cacheBytes / 1048576).toFixed(1) });

  // 背景把 SVG 畫格轉成 PNG：之後只留點陣圖（SVG 文件連同濾鏡會佔很多記憶體）
  const pngQueue = [];
  let pngBusy = false;
  function toPNG(entry, svg) { pngQueue.push(entry); if (!pngBusy) nextPNG(); }
  function nextPNG() {
    const entry = pngQueue.shift();
    if (!entry) { pngBusy = false; return; }
    pngBusy = true;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob((b) => {
        if (b && cache.get(entry.key) === entry) {
          const old = entry.url, png = URL.createObjectURL(b);
          for (const a of S.actors.values()) if (a.img.src === old) a.img.src = png;
          URL.revokeObjectURL(old);
          cacheBytes += b.size - entry.bytes; entry.url = png; entry.bytes = b.size;
        }
        setTimeout(nextPNG, 0);
      }, 'image/png');
    };
    img.onerror = () => setTimeout(nextPNG, 0);
    img.src = entry.url;
  }

  // ---- 名額：同時在動（L4–L7）的隻數 ----------------------------------------------
  // 一起互動的一對（L5）只算 1 個名額：只算發起的那隻
  S.movingCount = () => { let n = 0; for (const a of S.actors.values()) if (a.layer >= 4 && a.layer <= 7 && !(a.job && a.job.name === 'social' && !a.job.isInit)) n++; return n; };
  // 有球停下來在等主人撿：散步先讓位（L4 優先拿名額）
  S.fetchWaiting = () => { for (const b of S.balls) if (b.stopped && !b.picked && b.owner.layer > 4) return true; return false; };

  // ---- 共用的排程迴圈：有東西在動才跑；全部待機時只用低頻計時器 ----------------------
  let raf = 0, idleTimer = 0, lastFrame = 0, lastBall = 0;
  function loop(now) {
    raf = 0;
    if (S.paused) return;
    if (now - lastFrame < 30) { raf = requestAnimationFrame(loop); return; }   // 每秒最多約 30 格
    lastFrame = now;
    let busy = false;
    const dt = Math.min(0.05, (now - (lastBall || now)) / 1000); lastBall = now;
    for (const b of [...S.balls]) if (b.tick(dt, now)) busy = true;
    for (const a of [...S.actors.values()]) if (a.tick(now)) busy = true;
    if (busy) { raf = requestAnimationFrame(loop); S.reportRectsThrottled(); }
    else { lastBall = 0; wakeLater(); S.reportRects(); }
  }
  function wakeLater() {
    clearTimeout(idleTimer);
    let next = Infinity;
    for (const a of S.actors.values()) next = Math.min(next, a.wakeAt());
    if (!isFinite(next)) return;
    const wait = Math.max(200, Math.min(5000, next - performance.now()));
    idleTimer = setTimeout(() => S.kick(), wait);
  }
  S.kick = function () { if (!raf && !S.paused) { lastBall = 0; raf = requestAnimationFrame(loop); } };
  S.running = () => !!raf;

  // ---- 回報每隻（和提醒氣泡）的範圍給主行程（判斷滑鼠穿透） ---------------------------
  let lastReport = 0;
  S.reportRects = function (dragging) {
    lastReport = performance.now();
    const rects = [];
    let drag = !!dragging;
    if (S.mode !== 'hidden') for (const a of S.actors.values()) {
      if (a.rect) rects.push(a.rect);
      const br = a.bubble && a.bubble.clickRect();
      if (br) rects.push(br);
      if (a.dragging) drag = true;
    }
    S.api.reportRects(rects, drag);
    S.reportPos();
  };
  S.reportRectsThrottled = function () { if (performance.now() - lastReport > 120) S.reportRects(); };

  // ---- 回報腳底位置（q:pos，給社交排程判斷距離與地面）：有變才送，最多每秒一次 ----------------
  let lastPos = 0, posTimer = 0, lastPosSig = '';
  S.reportPos = function () {
    const now = performance.now();
    if (now - lastPos < 1000) { if (!posTimer) posTimer = setTimeout(() => { posTimer = 0; S.reportPos(); }, 1000 - (now - lastPos)); return; }
    const list = [...S.actors.values()].map((a) => ({ qid: a.id, x: Math.round(a.x), y: Math.round(a.y) }));
    const sig = list.map((p) => p.qid + p.x + ',' + p.y).join('|');
    if (sig === lastPosSig) return;
    lastPos = now; lastPosSig = sig;
    S.api.pos(list);
  };
})();
