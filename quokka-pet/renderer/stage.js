// 舞台圖層（畫面端）：所有庫卡都在這一層裡（規格第 1、4、8.4、14、15 節）
// 省資源的做法：
//   · 每一格畫面先用 3D 姿勢模型畫成 SVG，再轉成點陣圖（blob 圖片）存起來；之後走路只換圖片，不重算 SVG
//   · 位置只改 CSS transform（交給顯示卡），不移動視窗
//   · 所有庫卡共用一個排程迴圈；沒有庫卡在動的時候迴圈自己停下
(function () {
  const POSE = window.QuokkaPose, ART = window.QuokkaArt, TR = window.QuokkaTraits, ANIM = window.QuokkaAnim;
  const stageEl = document.getElementById('stage');
  const VB = { x: -10, y: -30, w: 180, h: 230 };          // 每隻的畫框（SVG 單位）；腳底在 (80,183)
  const FOOT = { x: 80 - VB.x, y: 183 - VB.y };            // 腳底在畫框中的位置
  const SCALE = 0.95;                                     // 1 個 SVG 單位約 0.95 px（之後乘上個體大小）
  const MAX_MOVING = 3;                                   // 同時最多 3 隻在動（第 15 節）
  const actors = new Map();
  let cursor = { x: -9999, y: -9999 };

  // ---- 畫格快取：同一隻、同一個姿勢只畫一次 ----------------------------------
  const cache = new Map();          // key → objectURL
  let cacheBytes = 0;
  const CACHE_LIMIT = 200 * 1024 * 1024;
  function frameURL(a, key, th, pose) {
    const k = a.id + '|' + key;
    const hit = cache.get(k);
    if (hit) { cache.delete(k); cache.set(k, hit); return hit.url; }   // 最近使用的移到最後
    ART.configure(a.traits);
    let svg = POSE.svg(th, 'f' + a.id, pose, `${VB.x} ${VB.y} ${VB.w} ${VB.h}`);
    ART.configure(null);
    // 圖片是獨立文件，讀不到 CSS 變數 → 把頭帶等顏色直接寫進去
    svg = svg.replace(/var\(--band,\s*#[0-9a-fA-F]{6}\)/g, a.traits.band || '#e5533d')
      .replace('<svg ', `<svg width="${Math.round(a.w * (window.devicePixelRatio || 1))}" height="${Math.round(a.h * (window.devicePixelRatio || 1))}" `);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const entry = { url, bytes: blob.size };
    cache.set(k, entry);
    cacheBytes += blob.size;
    toPNG(entry, svg);
    while (cacheBytes > CACHE_LIMIT && cache.size) {               // 超過上限：丟掉最久沒用的
      const [ok, ov] = cache.entries().next().value;
      URL.revokeObjectURL(ov.url); cacheBytes -= ov.bytes; cache.delete(ok);
    }
    return url;
  }

  // 背景把 SVG 畫格轉成 PNG：之後只留點陣圖（SVG 文件連同濾鏡會佔很多記憶體）
  const pngQueue = [];
  let pngBusy = false;
  function toPNG(entry, svg) { pngQueue.push({ entry, svg }); if (!pngBusy) nextPNG(); }
  function nextPNG() {
    const job = pngQueue.shift();
    if (!job) { pngBusy = false; return; }
    pngBusy = true;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob((b) => {
        if (b && cache.get([...cache.entries()].find(([, v]) => v === job.entry)?.[0]) === job.entry) {
          const old = job.entry.url, png = URL.createObjectURL(b);
          for (const a of actors.values()) if (a.img.src === old) a.img.src = png;
          URL.revokeObjectURL(old);
          cacheBytes += b.size - job.entry.bytes; job.entry.url = png; job.entry.bytes = b.size;
        }
        setTimeout(nextPNG, 0);
      }, 'image/png');
    };
    img.onerror = () => setTimeout(nextPNG, 0);
    img.src = job.entry.url;
  }

  // ---- 一隻庫卡 ----------------------------------------------------------------
  class Actor {
    constructor(q) {
      this.id = q.id; this.name = q.name; this.traits = q.traits;
      const sh = TR.shape(q.traits) || { sizeK: 1 };
      this.k = SCALE * sh.sizeK;                                // 像素 / SVG 單位
      this.w = VB.w * this.k; this.h = VB.h * this.k;
      const act = q.traits && q.traits.personality ? q.traits.personality.activity : .5;
      this.act = act;
      this.x = q.pos && isFinite(q.pos.x) ? q.pos.x : 200; this.y = q.pos && isFinite(q.pos.y) ? q.pos.y : innerHeight - 6;
      this.home = this.x;
      this.th = -15; this.state = 'idle'; this.nextAt = performance.now() + 2000 + Math.random() * 4000;
      this.el = document.createElement('div');
      this.el.className = 'actor idle';
      this.el.style.width = this.w + 'px'; this.el.style.height = this.h + 'px';
      this.img = document.createElement('img'); this.img.alt = q.name; this.img.draggable = false;
      const tag = document.createElement('span'); tag.className = 'name'; tag.textContent = q.name;
      this.el.append(this.img, tag);
      stageEl.appendChild(this.el);
      this.bindDrag();
      this.showIdle();
      this.place();
    }
    place(dy = 0) {
      const left = this.x - FOOT.x * this.k, top = this.y - FOOT.y * this.k + dy;
      this.el.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
      this.rect = { id: this.id, x: Math.round(left + this.w * .2), y: Math.round(top + this.h * .1), w: Math.round(this.w * .6), h: Math.round(this.h * .85) };
    }
    setFrame(key, th, pose) { const u = frameURL(this, key, th, pose); if (this.img.src !== u) this.img.src = u; }
    showIdle() { this.el.classList.add('idle'); this.setFrame('idle' + Math.round(this.th), this.th, {}); }
    // 散步：決定目的地（家附近 ±400、避開別隻與游標、不出螢幕）
    planWalk() {
      const W = innerWidth, margin = 60, range = 400;
      const backHome = Math.abs(this.x - this.home) > 250 && Math.random() < .6;
      let dir = backHome ? Math.sign(this.home - this.x) : (Math.random() < .5 ? -1 : 1);
      const hops = 3 + Math.floor(Math.random() * 6 * (0.5 + this.act));
      const step = 30 + this.act * 15;
      let target = this.x + dir * hops * step;
      target = Math.max(Math.max(margin, this.home - range), Math.min(Math.min(W - margin, this.home + range), target));
      if (Math.abs(target - this.x) < step) { dir = -dir; target = this.x + dir * hops * step; target = Math.max(margin, Math.min(W - margin, target)); }
      this.walk = { dir, target, step, hopMs: 430 - this.act * 110, t0: 0, from: this.x, hopsLeft: Math.max(1, Math.round(Math.abs(target - this.x) / step)) };
      this.state = 'turn'; this.turn = { from: this.th, to: dir > 0 ? 90 : -90, t0: performance.now() };
      this.el.classList.remove('idle');
    }
    blocked(nx) {   // 前方 120 px 內有別隻、或游標就在前面 → 停
      for (const o of actors.values()) {
        if (o === this || Math.abs(o.y - this.y) > 80) continue;
        const ox = o.state === 'walk' && o.walk ? o.x + o.walk.dir * o.walk.step : o.x;   // 對方下一跳會到哪
        if (Math.sign(ox - this.x) === this.walk.dir && Math.abs(ox - nx) < 120) return true;
      }
      return Math.abs(cursor.x - nx) < 120 && Math.abs(cursor.y - (this.y - 80)) < 160;
    }
    tick(now) {
      if (this.state === 'idle') {
        if (now < this.nextAt || this.dragging) return false;
        const nearCursor = Math.abs(cursor.x - this.x) < 200 && Math.abs(cursor.y - this.y) < 260;
        if (nearCursor || movingCount() >= MAX_MOVING) { this.nextAt = now + 3000; return false; }
        this.planWalk();
      }
      if (this.state === 'turn') {
        const u = Math.min(1, (now - this.turn.t0) / 320);
        const th = this.turn.from + (this.turn.to - this.turn.from) * ANIM.EASE.io(u);
        this.setFrame('t' + Math.round(th / 15) * 15, Math.round(th / 15) * 15, {});
        if (u >= 1) { this.th = this.turn.to; this.state = 'walk'; this.walk.t0 = now; this.walk.from = this.x; }
        return true;
      }
      if (this.state === 'walk') {
        const W = this.walk, u = Math.min(1, (now - W.t0) / W.hopMs);
        const f = Math.min(7, Math.floor(u * 8));                   // 每一跳 8 格（快取）
        this.setFrame(`hop${W.dir}_${f}`, this.th, ANIM.FETCH.hop((f + .5) / 8));
        const nx = W.from + W.dir * W.step * ANIM.EASE.io(u);
        if (u < .05 && this.blocked(W.from + W.dir * W.step)) { this.stop(now); return false; }
        this.x = nx; this.place();
        if (u >= 1) {
          W.hopsLeft--;
          if (W.hopsLeft <= 0 || Math.sign(W.target - this.x) !== W.dir) { this.stop(now); return false; }
          W.t0 = now; W.from = this.x;
        }
        return true;
      }
      return false;
    }
    // 停下來：轉回前方、看看四周，再決定下一次什麼時候走（越活潑越常走）
    stop(now) {
      this.state = 'idle'; this.th = this.walk.dir > 0 ? 30 : -30; this.walk = null;
      this.showIdle(); this.place();
      const base = 40000 + (1 - this.act) * 140000;               // 活潑約 40–90 秒、慵懶 3–6 分鐘
      this.nextAt = now + base * (0.6 + Math.random() * 0.8);
      reportRects();
    }
    bindDrag() {
      let sx = 0, sy = 0, ox = 0, oy = 0;
      this.el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        this.dragging = true; this.el.classList.add('dragging'); this.el.classList.remove('idle');
        if (this.state !== 'idle') { this.state = 'idle'; this.walk = null; }
        sx = e.clientX; sy = e.clientY; ox = this.x; oy = this.y;
        this.setFrame('lift', 0, { feet: 'air', eyes: 'wide', mouth: 'o', arms: { L: { hand: [-26, 92, 20] }, R: { hand: [26, 92, 20] } } });
        reportRects(true);
        const move = (ev) => { this.x = ox + ev.clientX - sx; this.y = Math.min(innerHeight - 4, oy + ev.clientY - sy); this.place(); };
        const up = () => {
          window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
          this.dragging = false; this.el.classList.remove('dragging');
          this.home = this.x; this.th = -15; this.showIdle(); this.place();
          window.stageApi.savePos(this.id, { x: Math.round(this.x), y: Math.round(this.y) });
          this.nextAt = performance.now() + 8000;
          reportRects(false);
        };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
        e.preventDefault();
      });
    }
    destroy() { this.el.remove(); }
  }
  const movingCount = () => [...actors.values()].filter((a) => a.state !== 'idle').length;

  // ---- 共用的排程迴圈：有庫卡在動才跑；全部待機時改成低頻檢查 ----------------------
  let raf = 0, idleTimer = 0;
  let lastFrame = 0;
  function loop(now) {
    raf = 0;
    if (now - lastFrame < 30) { raf = requestAnimationFrame(loop); return; }   // 每秒最多約 30 格就夠順
    lastFrame = now;
    let busy = false;
    for (const a of actors.values()) if (a.tick(now)) busy = true;
    if (busy) { raf = requestAnimationFrame(loop); reportRectsThrottled(); }
    else wakeLater();
  }
  function wakeLater() {
    clearTimeout(idleTimer);
    let next = Infinity; for (const a of actors.values()) if (a.state === 'idle') next = Math.min(next, a.nextAt);
    const wait = Math.max(200, Math.min(5000, next - performance.now()));
    idleTimer = setTimeout(() => { if (!raf) raf = requestAnimationFrame(loop); }, wait);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }

  // ---- 回報每隻的範圍給主行程（判斷滑鼠穿透） -----------------------------------
  let lastReport = 0;
  function reportRects(dragging) { lastReport = performance.now(); window.stageApi.reportRects([...actors.values()].map((a) => a.rect), !!dragging || [...actors.values()].some((a) => a.dragging)); }
  function reportRectsThrottled() { if (performance.now() - lastReport > 120) reportRects(); }

  // 游標靠近才播呼吸動畫（平常完全靜止，不讓全螢幕圖層一直重新合成）
  window.stageApi.onCursor((c) => {
    cursor = c;
    for (const a of actors.values()) a.el.classList.toggle('near', Math.abs(c.x - a.x) < 260 && Math.abs(c.y - (a.y - a.h / 2)) < 260);
  });
  window.stageApi.onQuokkas((list) => {
    const seen = new Set();
    list.forEach((q, i) => {
      seen.add(q.id);
      if (!actors.has(q.id)) {
        // 新來的：從右往左排，隻數多時自動縮小間距，保證都在螢幕內
        if (!q.pos || q.pos.x < 20 || q.pos.x > innerWidth - 20) {
          const gap = Math.max(36, Math.min(220, (innerWidth - 200) / Math.max(1, list.length)));
          q.pos = { x: Math.round(innerWidth - 120 - i * gap), y: innerHeight - 6 };
        }
        actors.set(q.id, new Actor(q));
      }
    });
    for (const [id, a] of actors) if (!seen.has(id)) { a.destroy(); actors.delete(id); }
    reportRects(); kick();
  });
  window.__stage = { actors, cache: () => ({ n: cache.size, mb: +(cacheBytes / 1048576).toFixed(1) }), kick };
  window.stageApi.ready();
})();
