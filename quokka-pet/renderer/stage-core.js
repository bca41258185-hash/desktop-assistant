// 舞台共用核心：常數、畫格快取、共用排程迴圈、回報範圍（規格第 1、6、10 節）
// 其他舞台檔案（stage-ball.js、stage-bubble.js、stage-actor.js、stage.js）都掛在 window.Stage 上。
// 省資源的做法：
//   · 走路、轉身、待機、睡覺、看左看右、撿球的畫格先用 3D 姿勢模型畫成 SVG，再轉成 PNG 存起來，之後只換圖片
//   · 位置只改 CSS transform（交給顯示卡），不移動視窗
//   · 所有庫卡和球共用一個排程迴圈；沒有東西在動時迴圈完全停下（不跑 requestAnimationFrame），只留低頻計時器
(function () {
  const S = window.Stage = {};
  S.POSE = window.QuokkaPose; S.ART = window.QuokkaArt; S.TR = window.QuokkaTraits; S.ANIM = window.QuokkaAnim;
  S.SOC = window.QuokkaSocial;
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
  // ---- 幀率：預設每秒 60 格；只有主行程送 stage:perf {fps:30}（使用者手動開省電）才用 30 格。不自動降幀率 ----------
  //   S.fps        目前的幀率（60 或 30）
  //   S.frameGap   共用迴圈兩格之間至少隔多少毫秒（比一格的時間少一點容差，60 格時每次 rAF 都跑）
  //   S.LIVE_MS    即時繪製（live SVG）的間隔，跟著幀率走
  //   S.qMul       快取畫格（走路、跳、撿球）每段的格數倍率：60 格時用兩倍的格數（動作更細），位移照樣以時間計算
  // 所有位移、步態相位、球的物理都以「經過的時間」計算，所以改幀率不會變快或變慢。
  const perf = S.perf = { target: 60, fps: 60, frames: 0, work: 0, stages: {} };
  function applyFps(fps) {
    S.fps = perf.fps = fps;
    S.frameGap = 1000 / fps - 3;
    S.LIVE_MS = 1000 / fps - 2;
    S.qMul = fps >= 45 ? 2 : 1;
  }
  applyFps(60);
  S.setTargetFps = function (fps) {
    fps = Number(fps) === 30 ? 30 : 60;
    if (fps === perf.target) return;
    perf.target = fps; applyFps(fps);
  };
  // 分段計時（量效能用，平常只是累加幾個數字）：S.prof('svg', ms)
  S.prof = (k, ms) => { const o = perf.stages[k] || (perf.stages[k] = { n: 0, ms: 0 }); o.n++; o.ms += ms; };

  S.actors = new Map();
  S.balls = new Set();
  S.cursor = { x: -9999, y: -9999 };
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
    const k = a.id + '|' + key + (wide ? '|w' : '') + (a.decoKey || '');
    const hit = cache.get(k);
    if (hit) { cache.delete(k); cache.set(k, hit); S.prof('frame.hit', 0); return hit.url; }   // 最近使用的移到最後
    const t0 = performance.now();
    let svg = S.svgFor(a, th, 'f' + a.uid, pose, wide ? S.VBW_STR : S.VB_STR);
    S.prof('frame.miss.pose+svg', performance.now() - t0);
    // 圖片是獨立文件，讀不到 CSS 變數 → 把頭帶等顏色直接寫進去
    const dpr = window.devicePixelRatio || 1;
    svg = svg.replace(/var\(--band,\s*#[0-9a-fA-F]{6}\)/g, a.traits.band || '#e5533d')
      .replace('<svg ', `<svg width="${Math.round(a.w * (wide ? S.VBW.w / S.VB.w : 1) * dpr)}" height="${Math.round(a.h * dpr)}" `);
    svg = fixDupStyle(svg);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const entry = { url: URL.createObjectURL(blob), bytes: blob.size, key: k };
    cache.set(k, entry);
    cacheBytes += blob.size;
    toPNG(entry, svg);
    while (cacheBytes > CACHE_LIMIT && cache.size) {               // 超過上限：丟掉最久沒用的
      const [ok, ov] = cache.entries().next().value;
      URL.revokeObjectURL(ov.url); ready.delete(ov.url); cacheBytes -= ov.bytes; cache.delete(ok);
    }
    return entry.url;
  };
  // PNG 先在背景解碼好才換（換上去不會有空白格）
  const ready = new Set();
  S.decodeFrame = function (u) {
    const im = new Image();
    im.src = u;
    const done = () => { ready.add(u); };
    return (im.decode ? im.decode() : new Promise((r, j) => { im.onload = r; im.onerror = j; })).then(done, done);
  };
  // 畫一隻（含個體特徵、小袋鼠的大頭、媽媽肚子上的育兒袋與探頭的小袋鼠）→ 分層與手掌位置
  S.poseFor = (a, pose) => (a.hs && a.hs !== 1 && pose.headScale == null ? { ...pose, headScale: a.hs } : pose);
  S.renderActor = function (a, th, id, pose) {
    pose = S.poseFor(a, pose);
    S.ART.configure(a.traits);
    const r = S.POSE.render(th, id, pose);
    S.ART.configure(null);
    const L = r.layers, deco = S.deco ? S.deco(a, th, pose, id) : '';
    return { hands: r.hands, layers: L, inner: L.defs + L.shadow + L.back + L.body + deco + L.front };
  };
  S.svgFor = (a, th, id, pose, vb) => `<svg viewBox="${vb}" class="view-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="overflow:visible">${S.renderActor(a, th, id, pose).inner}</svg>`;
  // 先把某一格畫好放進快取（眨眼、耳朵抖這種只出現 0.1 秒的畫格，要用的時候才不會來不及）
  S.warm = (a, key, th, pose, wide) => { S.frameURL(a, key, th, pose, wide); };
  // 圖片（獨立 SVG 文件）用嚴格 XML 解析：同一個標籤有兩個 style 屬性會整張讀不出來（某些飾品會這樣）→ 合併成一個
  function fixDupStyle(svg) {
    return svg.replace(/<[a-zA-Z][^>]*>/g, (tag) => {
      const m = tag.match(/\sstyle="[^"]*"/g);
      if (!m || m.length < 2) return tag;
      const merged = ' style="' + m.map((x) => x.slice(8, -1)).join(';') + '"';
      let first = true;
      return tag.replace(/\sstyle="[^"]*"/g, () => (first ? ((first = false), merged) : ''));
    });
  }
  S.fixDupStyle = fixDupStyle;
  // 某隻的外觀變了或被刪掉：丟掉牠的所有畫格
  S.purgeFrames = function (id) {
    for (const [k, v] of cache) if (k.startsWith(id + '|')) { URL.revokeObjectURL(v.url); ready.delete(v.url); cacheBytes -= v.bytes; cache.delete(k); }
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
          // PNG 先解碼好再換（直接換 src 會有一格空白）；舊網址晚一點才釋放（可能還有一張正在等著換上去）
          S.decodeFrame(png).then(() => {
            if (cache.get(entry.key) !== entry) { URL.revokeObjectURL(png); return; }
            for (const a of S.actors.values()) if (a.img.src === old && !a.pendingSrc && !a.liveShown) a.showURL(png, !!a.wideImg);
            cacheBytes += b.size - entry.bytes; entry.url = png; entry.bytes = b.size;
            ready.delete(old); setTimeout(() => URL.revokeObjectURL(old), 3000);
            setTimeout(nextPNG, 0);
          });
          return;
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
    if (now - lastFrame < S.frameGap) { raf = requestAnimationFrame(loop); return; }   // 每秒最多 S.fps 格（預設 60，吃力時自動降級）
    const c0 = performance.now();
    lastFrame = now; perf.frames++;
    let busy = false;
    const dt = Math.min(0.05, (now - (lastBall || now)) / 1000); lastBall = now;
    for (const b of [...S.balls]) { try { if (b.tick(dt, now)) busy = true; } catch (e) { console.warn('球的更新出錯，收掉這顆球', e); try { b.remove(); } catch (e2) { /* 已經移除 */ } } }
    // 每一隻各自保護：某一隻的活動出錯，就強制結束牠的活動（互動中會送 social:abort），其他隻照常
    for (const a of [...S.actors.values()]) {
      try { if (a.tick(now)) busy = true; }
      catch (e) { console.warn('活動出錯，強制結束：' + (a.job && a.job.name), e); S.failJob(a); busy = true; }
    }
    perf.work += performance.now() - c0;
    if (busy) { raf = requestAnimationFrame(loop); S.reportRectsThrottled(); }
    else { lastBall = 0; lastFrame = 0; wakeLater(); S.reportRects(); }
  }
  function wakeLater() {
    clearTimeout(idleTimer);
    let next = Infinity;
    for (const a of S.actors.values()) next = Math.min(next, a.wakeAt());
    if (!isFinite(next)) return;
    const wait = Math.max(200, Math.min(5000, next - performance.now()));
    idleTimer = setTimeout(() => S.kick(), wait);
  }
  // 強制結束某一隻目前的活動（出錯時用）：照正常的打斷流程收尾，再回待機
  S.failJob = function (a) {
    const j = a.job;
    a.job = null;
    try { if (j && j.duet) j.duet.fail(a); else if (j && j.interrupt) j.interrupt('error'); } catch (e) { /* 收尾也出錯就算了 */ }
    try { a.hideLive(); a.depth = 0; a.zBoost = 0; a.dy = 0; a.el.classList.remove('in-duet', 'ringing', 'dragging', 'bang-on'); a.duetOn = false; a.th = Math.round((a.th || 0) / 15) * 15 || -15; a.setLayer(8); a.showRest(); a.place(); } catch (e) { /* 盡量恢復 */ }
  };
  S.kick = function () { if (!raf) { lastBall = 0; raf = requestAnimationFrame(loop); } };
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
      // 保險：拎著卻已經沒有按鍵在追蹤（監聽遺失、出錯）→ 當場放下，不讓舞台卡在「拖曳中」
      if (a.dragging && a.pressing && !a.pressing()) { try { a.job.release(0, 0); } catch (e) { S.failJob(a); } }
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
