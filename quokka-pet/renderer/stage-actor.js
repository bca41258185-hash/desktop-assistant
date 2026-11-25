// 舞台裡的一隻庫卡（Actor）與牠的狀態機（規格第 5 節）
//
// 三層模型：
//   1. 模式 mode：awake（醒著）／asleep（使用者離開）／hidden（舞台藏起來）
//   2. 活動 job：依優先層 L0–L8 搶佔，一次只做一件（requestActivity）
//        L0 拖曳、甩出、頭暈   L1 提醒響鈴   L2 工作反應（含報告佇列）   L3 使用者叫的
//        L4 撿球   L5 社交（之後）   L6 自己的小動作   L7 散步   L8 待機（job＝null）
//      新活動的層比較高 → 先呼叫目前活動的 interrupt(reason) 收尾再切換；
//      否則 L2 進報告佇列，L4–L7 直接丟掉。名額（同時最多 3 隻動）只限 L4–L7。
//   3. 附加狀態 attach：pregnant、carryingJoey、hasFollower、coupled、stage（先保留欄位，只影響畫法與允許的活動）
//
// 畫法：
//   · 靜止、走路、轉身、撿球：用快取的 PNG 畫格（<img>）
//   · 打球、反應這類不常出現的動作：播放時才把這隻換成即時 SVG（.live），播完移除、換回 PNG
(function () {
  const S = window.Stage, ANIM = S.ANIM, POSE = S.POSE, EASE = ANIM.EASE;
  const lerp = (a, b, t) => a + (b - a) * t;
  let uidSeq = 0;
  const passSeen = new Set();

  // ---- 工作反應的台詞與動作 ------------------------------------------------------
  const short = (t, n = 18) => { t = S.str(t); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const pctTxt = (p) => (Math.abs(Number(p) || 0)).toFixed(1) + '%';
  const stockSeg = (p) => {
    const nm = short(p.name || p.symbol || '股票', 8);
    if (p.limit === 'up') return { t: `${nm} 漲停！▲${pctTxt(p.pct)}`, tone: 'up' };
    if (p.limit === 'down') return { t: `${nm} 跌停……▼${pctTxt(p.pct)}`, tone: 'down' };
    return p.dir === 'down' ? { t: `${nm} ▼${pctTxt(p.pct)}……`, tone: 'down' } : { t: `${nm} ▲${pctTxt(p.pct)}！`, tone: 'up' };
  };
  // 一則報告 → 動作、台詞、特效
  function describe(item, beh) {
    const L = item.list, n = L.length, p = L[n - 1] || {};
    switch (item.kind) {
      case 'task-added':
        return { anim: 'nod', text: n > 1 ? `收到！記下 ${n} 件事了` : '收到！' + (p.text ? `「${short(p.text)}」` : '') };
      case 'task-done':
        if (L.some((x) => x.allDone)) return { anim: 'bigCheer', text: '全部完成了！太棒了！', burst: 'big', big: true };
        return { anim: 'hopJoy', text: n > 1 ? `完成 ${n} 件事了！` : '完成' + (p.text ? `「${short(p.text)}」` : '') + '！', burst: 'stars' };
      case 'stock': {
        if (n > 1) {
          const segs = [{ t: `${n} 檔股票有變化：` }];
          L.forEach((x, i) => { if (i) segs.push({ t: '、' }); segs.push(stockSeg(x)); });
          const ups = L.filter((x) => x.dir !== 'down').length;
          return { anim: ups * 2 >= n ? 'cheer' : 'droop', text: segs };
        }
        const seg = stockSeg(p);
        if (p.limit === 'up') return { anim: 'bigCheer', text: [seg], burst: 'fireworks', big: true };
        if (p.limit === 'down') return { anim: 'cover', text: [seg], big: true };
        return { anim: p.dir === 'down' ? 'droop' : 'cheer', text: [seg] };
      }
      case 'folder': {
        const names = [...new Set(L.map((x) => short(x.name || '資料夾', 12)))];
        const cnt = L.reduce((s, x) => s + (Number(x.count) || 1), 0);
        return { anim: 'sniff', text: names.length > 1 ? `${names.length} 個資料夾有 ${cnt} 個檔案變了` : `${names[0]}${/資料夾$/.test(names[0]) ? '' : '資料夾'}有 ${cnt} 個檔案變了` };
      }
      case 'missed': {
        const items = L.flatMap((x) => Array.isArray(x.items) ? x.items : x.text ? [x.text] : []).map((t) => short(t, 16));
        return { anim: 'talk', text: '剛剛錯過：' + (items.slice(0, 4).join('、') || '一則提醒') + (items.length > 4 ? ` 等 ${items.length} 則` : '') };
      }
      case 'birth': return { anim: 'hopJoy', text: '生了！' + (p.name ? `是「${short(p.name, 12)}」` : '') + '♥', burst: 'hearts', big: true };
      case 'back': return { anim: 'wave', text: (beh && beh.back) || '你回來啦！歡迎回來～' };
      default: return { anim: 'talk', text: short(p.text || '', 120) || '……' };
    }
  }

  // ---- 一隻庫卡 ------------------------------------------------------------------
  class Actor {
    constructor(q) {
      this.uid = ++uidSeq;
      this.id = q.id; this.name = S.str(q.name, 12);
      this.mode = S.mode === 'hidden' ? 'hidden' : 'awake';
      this.job = null; this.queue = []; this.alerts = []; this.ball = null;
      this.attach = { pregnant: false, carryingJoey: false, hasFollower: false, coupled: false, stage: 'adult' };   // 附加狀態（之後戀愛／育兒用）
      this.lastLayer = 8; this.lastReportEnd = 0; this.fetchCount = 0;
      this.depth = 0; this.zBoost = 0; this.hs = 1; this.faceDir = -1;      // depth＝往畫面裡退幾 px（讓路時用）；zBoost＝暫時畫在前面
      this.seed = (this.uid * 7919) % 1000 + Math.random() * 50;
      this.el = document.createElement('div');
      this.el.className = 'actor';
      this.img = document.createElement('img'); this.img.draggable = false;
      this.live = document.createElement('div'); this.live.className = 'live';
      this.zz = document.createElement('span'); this.zz.className = 'zz'; this.zz.setAttribute('aria-hidden', 'true'); this.zz.innerHTML = 'z<b>Z</b>';
      this.bang = document.createElement('span'); this.bang.className = 'bang'; this.bang.setAttribute('aria-hidden', 'true'); this.bang.textContent = '！';
      this.tag = document.createElement('span'); this.tag.className = 'name';
      this.el.append(this.img, this.live, this.zz, this.bang, this.tag);
      S.stageEl.appendChild(this.el);
      this.bubble = new S.Bubble(this);
      this.applyData(q, true);
      this.x = q.pos && isFinite(q.pos.x) ? q.pos.x : 200;
      this.y = q.pos && isFinite(q.pos.y) ? Math.min(innerHeight - 4, q.pos.y) : innerHeight - 6;
      this.home = this.x; this.dy = 0;
      this.th = -15;
      this.nextAt = performance.now() + 2500 + Math.random() * 6000;
      this.img.style.animationDelay = (-Math.random() * 3.2).toFixed(2) + 's';   // 每隻的呼吸錯開
      this.bindInput();
      this.showRest();
      this.place();
      this.startLife();
    }
    // 名字、特徵（外觀、個性）；外觀變了就丟掉舊畫格
    applyData(q, first) {
      const traitsChanged = !first && q.traits && JSON.stringify(q.traits) !== JSON.stringify(this.traits);
      if (q.name != null) this.name = S.str(q.name, 12);
      if (q.traits) this.traits = q.traits;
      if (!this.traits) this.traits = {};
      const sh = (S.TR.shape(this.traits)) || { sizeK: 1 };
      const A = this.attach, oldStage = A.stage, oldK = this.k, oldDeco = this.decoKey;
      if (q.stage) A.stage = q.stage; else if (first && this.traits.stage === 'follow') A.stage = 'follow';
      if ('mom' in q) A.mom = q.mom || null;
      if ('dad' in q) A.dad = q.dad || null;
      if ('partner' in q) A.partner = q.partner || null;
      if ('pregnant' in q) A.pregnant = !!q.pregnant;
      if ('hasJoey' in q) A.hasJoey = q.hasJoey || null;
      A.coupled = !!A.partner;
      // 跟隨期的小袋鼠：頭大身小
      this.isFollow = A.stage === 'follow';
      const grow = this.isFollow ? S.clamp(Number(q.growScale) || Number(this.traits.growScale) || 0.55, 0.42, 0.68) : 1;
      this.hs = this.isFollow ? 1.3 : 1;
      this.k = S.SCALE * sh.sizeK * grow;
      this.w = S.VB.w * this.k; this.h = S.VB.h * this.k;
      this.el.style.width = this.w + 'px'; this.el.style.height = this.h + 'px';
      this.el.style.setProperty('--band', this.traits.band || '#e5533d');
      this.el.classList.toggle('joey', this.isFollow);
      this.beh = S.TR.behavior(this.traits) || null;
      this.act = this.traits.personality ? this.traits.personality.activity : .5;
      this.img.alt = this.name; this.tag.textContent = this.name;
      this.el.setAttribute('aria-label', this.name);
      if (S.family) S.family.refresh(this);
      const sizeChanged = !first && Math.abs(this.k - oldK) > 1e-4;
      // 跟隨期滿（變成亞成體）：播「長大」小動畫
      if (!first && oldStage === 'follow' && !this.isFollow && S.family) { S.family.grow(this, oldK); return; }
      if (traitsChanged || sizeChanged || (!first && oldDeco !== this.decoKey)) { if (traitsChanged || sizeChanged) S.purgeFrames(this.id); if (!this.job) this.showRest(); this.place(); }
    }
    get layer() { return this.job ? this.job.layer : 8; }
    get state() { return this.job ? this.job.name : (this.mode === 'asleep' ? 'sleep' : 'idle'); }
    get dragging() { return !!(this.job && this.job.name === 'drag' && this.job.held); }

    // ---- 位置與畫格 ----
    place() {
      const left = this.x - (S.FOOT.x - S.VB.x) * this.k, top = this.y - (S.FOOT.y - S.VB.y) * this.k - this.depth;
      this.el.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
      const z = Math.round(this.y - this.depth) + this.zBoost + (this.dragging ? 10000 : 0);
      if (z !== this.z) { this.z = z; this.el.style.zIndex = z; }          // 腳底越下面畫越前面
      this.rect = this.inPouch ? null : { id: this.id, x: Math.round(left + this.w * .2), y: Math.round(top + this.h * .1), w: Math.round(this.w * .6), h: Math.round(this.h * .85) };
      this.bubble.place();
    }
    // SVG 座標 → 舞台座標（腳底 (80,183) 對到 (x, y)）
    toStage(sx, sy) { return { x: this.x + (sx - S.FOOT.x) * this.k, y: this.y + (sy - S.FOOT.y) * this.k }; }
    setFrame(key, th, pose, wide = false) {
      if (this.liveOn) this.hideLive();
      const u = S.frameURL(this, key, th, pose, wide);
      if (wide !== !!this.wideImg) { this.wideImg = wide; this.img.classList.toggle('wide', wide); }
      if (this.img.src !== u) this.img.src = u;
    }
    // 依時間取第幾格（快取用），回傳 [格號, 取樣點]
    static q(u, n) { const f = Math.min(n - 1, Math.floor(u * n)); return [f, (f + .5) / n]; }
    // 待機時的樣子：睡覺／待機（含看游標，量化成 8 個方向）→ { key, th, pose }
    restSpec() {
      if (this.isSleeping()) return { key: 'sleep', th: -10, pose: ANIM.STILL.sleep, sleep: true };
      const b = this.lookBucket, th = Math.round(this.th);
      if (b && LOOK[b]) { const [dx, dy] = LOOK[b]; return { key: 'look' + b + th, th: th + dx * 9, pose: { look: [dx * 2, dy * 1.5], head: { yaw: dx * 13, pitch: dy * 9 } } }; }
      return { key: 'idle' + th, th, pose: {} };
    }
    showRest() {
      const r = this.restSpec();
      this.el.classList.toggle('asleep', !!r.sleep);
      this.setFrame(r.key, r.th, r.pose);
    }
    isSleeping() { return this.mode === 'asleep' && !this.alerts.length && (!this.job || this.job.layer > 1); }
    showLook(b) { this.lookBucket = b; this.showRest(); }
    // ---- 常駐的小生命感：眨眼、耳朵抖（只換快取畫格，用計時器排程，不跑動畫迴圈；呼吸是 CSS）----
    canLife() { return !this.job && this.mode === 'awake' && !S.paused && !this.liveOn && !this.inPouch && S.mode === 'awake' && !this.duetOn; }
    lifeFrame(tag, extra, ms, then) {
      const r = this.restSpec();
      this.setFrame(r.key + tag, r.th, { ...r.pose, ...extra });
      this.lifeT2 = setTimeout(() => { if (this.canLife()) { if (then) then(); else this.showRest(); } }, ms);
    }
    startLife() {
      const blink = () => {
        this.blinkT = setTimeout(blink, 3000 + Math.random() * 3000);
        if (!this.canLife()) return;
        const twice = Math.random() < .15;
        this.lifeFrame('|b', { blink: 1 }, 120, twice ? () => { this.showRest(); this.lifeT2 = setTimeout(() => { if (this.canLife()) this.lifeFrame('|b', { blink: 1 }, 120); }, 120); } : null);
      };
      const ear = () => {
        this.earT = setTimeout(ear, 9000 + Math.random() * 9000);
        if (!this.canLife() || S.reduceMotion) return;
        const side = Math.random() < .5 ? 'L' : 'R';
        this.lifeFrame('|e' + side, { earFlop: { [side]: 14, [side === 'L' ? 'R' : 'L']: 0 } }, 110, () => this.lifeFrame('|f' + side, { earFlop: { [side]: -6, [side === 'L' ? 'R' : 'L']: 0 } }, 120));
      };
      this.blinkT = setTimeout(blink, 1500 + Math.random() * 4000);
      this.earT = setTimeout(ear, 5000 + Math.random() * 9000);
      // 先把眨眼的畫格準備好
      setTimeout(() => { if (this.canLife()) { const r = this.restSpec(); S.warm(this, r.key + '|b', r.th, { ...r.pose, blink: 1 }); } }, 600 + Math.random() * 600);
    }
    // 即時 SVG（只有播放動作的這隻、只在播的時候）
    drawLive(th, pose) {
      if (!this.liveOn) { this.liveOn = true; this.el.classList.add('live-on'); }
      // 常駐層（呼吸、眨眼、耳朵抖）也疊到即時繪製的動作上
      if (ANIM.ambient && !pose.noAmbient) { const am = ANIM.ambient(performance.now() / 1000, this.seed, { still: false }); pose = ANIM.applyAmbient(pose, { ...am, look: [0, 0], head: { yaw: 0, pitch: 0 } }); }
      this.live.innerHTML = S.svgFor(this, th, 'L' + this.uid, pose, S.VB_STR);
    }
    hideLive() { if (!this.liveOn) return; this.liveOn = false; this.live.innerHTML = ''; this.el.classList.remove('live-on'); }
    say(text, opts) { this.bubble.say(text, opts); }

    // ---- 狀態機核心 ----------------------------------------------------------------
    setLayer(layer) {
      if (layer === this.lastLayer) return;
      this.lastLayer = layer;
      S.api.state(this.id, layer);
    }
    // 要求做一件活動：高層搶佔低層；L2 進佇列；L4–L7 受名額限制
    requestActivity(layer, job, reason) {
      job.layer = layer;
      if (this.inPouch) return false;
      if (this.isFollow && !(layer === 0 || layer === 5 || job.joeyOk)) return false;      // 跟隨期：只有拖曳、家族互動、跟隨與牠自己的小動作
      if (this.mode === 'hidden' || (this.mode === 'asleep' && layer > 1)) {
        if (layer === 2 && job.item) this.enqueue(job.item);              // 只記錄不演出
        return false;
      }
      const cur = this.layer;
      if (layer >= 4 && layer <= 7 && !(cur >= 4 && cur <= 7) && S.movingCount() >= S.MAX_MOVING) return false;
      if (layer < cur || (layer === cur && layer <= 3 && layer !== 2)) {
        const old = this.job;
        this.job = null;
        if (old && old.name === 'social') this.lastSocial = old;
        if (old && old.interrupt) old.interrupt(reason || job.name);
        this.job = job;
        job.t0 = performance.now();
        if (job.start) job.start(job.t0);
        if (this.job === job) { this.setLayer(layer); if (job.ticks) S.kick(); }
        return true;
      }
      if (layer === 2 && job.item) { this.enqueue(job.item); return 'queued'; }
      return false;
    }
    // 活動自己做完了
    finish(job, { rest = true, line = null, tone = '' } = {}) {
      if (this.job !== job) return;
      this.job = null;
      if (job.end) job.end();
      this.hideLive();
      this.dy = 0;
      this.setLayer(8);
      if (line) this.say(line, { tone });
      if (rest) S.api.rest(this.id, Math.round(this.x), Math.round(this.y));
      this.afterJob();
    }
    // 做完一件事之後：還在響鈴 → 回 L1；佇列有東西 → 間隔 1.2 秒再報；撿球；否則待機
    afterJob() {
      if (this.job) return;
      this.showRest(); this.place();
      if (this.alerts.length) { this.startRing(); return; }
      if (this.queue.length) { this.scheduleDrain(); return; }
      if (this.ball && this.ball.stopped && !this.ball.picked && this.mode === 'awake') this.startFetch();
      if (this.mode === 'asleep' && !this.alerts.length) this.showRest();
      S.kick();
    }
    // 每格（共用迴圈呼叫）；回傳 true＝需要下一格
    tick(now) {
      if (this.job) {
        if (!this.job.ticks) return false;
        const j = this.job;
        if (j.tick(now) === false) this.finish(j, j.endOpts || {});
        return !!(this.job && this.job.ticks);
      }
      if (this.mode !== 'awake' || S.paused) return false;
      if (this.isFollow) return S.family ? S.family.tick(this, now) : false;
      // 球停了在等主人（名額滿時排隊，L4 優先）
      if (this.ball && this.ball.stopped && !this.ball.picked) { this.startFetch(); return !!(this.job && this.job.ticks); }
      if (now >= this.nextAt) {
        if (this.queue.length || this.alerts.length) { this.nextAt = now + 3000; return false; }
        const nearCursor = Math.abs(S.cursor.x - this.x) < 200 && Math.abs(S.cursor.y - (this.y - this.h / 2)) < 260;
        if (nearCursor || S.reduceMotion || S.settings.walk === 'off' || S.fetchWaiting() || this.bubble.kind) { this.nextAt = now + 3000; return false; }
        if (S.family && S.family.coupleIdle(this, now)) return !!(this.job && this.job.ticks);
        // 偶爾不走路，改成原地做個小動作（張望、抓臉、打哈欠…）
        if (ANIM.IDLE && Math.random() < .3 && this.idleAct()) { this.nextAt = now + this.restGap() * .5; return true; }
        if (!this.requestActivity(7, this.walkJob())) this.nextAt = now + 3000;
        return !!(this.job && this.job.ticks);
      }
      return false;
    }
    // 下一次需要醒來檢查的時間（給低頻計時器）
    wakeAt() {
      if (this.job) return this.job.ticks ? performance.now() : Infinity;
      if (this.mode !== 'awake') return Infinity;
      if (this.isFollow) return S.family ? S.family.wakeAt(this) : Infinity;
      if (this.ball && this.ball.stopped) return performance.now() + 500;
      return this.nextAt;
    }

    // ---- 報告佇列（L2q）：最多 5 則、同類合併、每則間隔 1.2 秒 ----------------------
    enqueue(item) {
      const same = item.kind !== 'note' && item.kind !== 'back' && this.queue.find((x) => x.kind === item.kind);
      if (same) {
        for (const p of item.list) {
          const i = item.kind === 'stock' ? same.list.findIndex((x) => x.symbol && x.symbol === p.symbol) : -1;
          if (i >= 0) same.list[i] = p; else same.list.push(p);
        }
        same.prio = Math.max(same.prio || 0, item.prio || 0);
        return;
      }
      if (item.front) this.queue.unshift(item); else this.queue.push(item);
      while (this.queue.length > S.QUEUE_MAX) {                         // 還是滿的：丟掉最舊的低優先項目
        let drop = 0;
        this.queue.forEach((x, i) => { if ((x.prio || 0) < (this.queue[drop].prio || 0)) drop = i; });
        this.queue.splice(drop, 1);
      }
    }
    scheduleDrain(delay) {
      clearTimeout(this.drainTimer);
      const wait = delay != null ? delay : Math.max(0, S.REPORT_GAP - (performance.now() - this.lastReportEnd));
      this.drainTimer = setTimeout(() => this.drain(), wait);
    }
    drain() {
      if (this.mode !== 'awake' || !this.queue.length) return;
      if (this.job && this.job.layer <= 2) return;                       // 忙著更重要的事：做完會再叫
      const item = this.queue.shift();
      if (!this.requestActivity(2, this.reactJob(item))) this.queue.unshift(item);
    }
    // q:event 進來
    event(kind, payload, prio) {
      if (this.isFollow) return;                                         // 跟隨期不能交辦事情
      const item = { kind, list: [payload || {}], prio: Number(prio) || 2 };
      if (this.mode !== 'awake') { this.enqueue(item); return; }
      // 剛報完不到 1.2 秒、或佇列裡還有：排隊
      if (this.queue.length || performance.now() - this.lastReportEnd < S.REPORT_GAP) { this.enqueue(item); if (!this.job || this.job.layer > 2) this.scheduleDrain(); return; }
      this.requestActivity(2, this.reactJob(item));
    }

    // ---- 各種活動 --------------------------------------------------------------
    // 播一段關鍵影格動畫（即時 SVG，每秒 24 格）
    animJob(name, anim, opts = {}) {
      const a = this;
      const job = {
        name, ticks: true, anim, last: 0, fired: new Set(), st: { thrown: false },
        start() { a.el.classList.remove('asleep', 'ringing'); if (opts.start) opts.start(job); },
        tick(now) {
          let t = (now - job.t0) / 1000;
          if (opts.loop) t %= anim.dur;
          for (const ev of anim.events || []) if (t >= ev.t && !job.fired.has(ev)) { job.fired.add(ev); opts.onEvent && opts.onEvent(ev, t, job); }
          const done = !opts.loop && t >= anim.dur;
          if (opts.hold && done) return opts.hold(job, now);
          if (now - job.last >= S.LIVE_MS || done) {
            job.last = now;
            const s = ANIM.sample(anim, t);
            s.pose.props = anim.props ? anim.props(Math.min(t, anim.dur), job.st) : [];
            a.drawLive(opts.flip ? -s.th : s.th, s.pose);
          }
          if (opts.each && opts.each(job, now, t) === false) return false;
          return !done;
        },
        interrupt(reason) { a.hideLive(); opts.interrupt && opts.interrupt(reason, job); },
        end() { opts.end && opts.end(job); }
      };
      if (opts.endLine) job.endOpts = { line: opts.endLine };
      return job;
    }
    // L2 工作反應
    reactJob(item) {
      const d = describe(item, this.beh);
      const anim = ANIM.REACT[d.anim] || ANIM.REACT.talk;
      const ms = Math.max(1500, Math.min(3000, anim.dur * 1000));
      const job = this.animJob('react:' + item.kind, anim, {
        start: () => {
          this.say(d.text, { ms: ms + 1600, big: d.big });
          if (d.burst) { const p = this.toStage(80, 40); S.burst(p.x, p.y, d.burst); }
        },
        each: (j, now) => now - j.t0 < ms,
        end: () => { this.lastReportEnd = performance.now(); }
      });
      job.item = item;
      return job;
    }
    // L1 響鈴：揮手的靜止圖＋CSS 晃動（不跑動畫迴圈）；氣泡一直顯示
    startRing() {
      if (!this.alerts.length) return;
      const al = this.alerts[this.alerts.length - 1];
      this.bubble.alert(al.reminderId, al.text);
      if (this.job && this.job.name === 'ring') return;
      const a = this;
      this.requestActivity(1, {
        name: 'ring', ticks: false,
        start() { a.el.classList.remove('asleep'); a.th = -10; a.setFrame('ring', 0, ANIM.STILL.ring); a.el.classList.add('ringing'); a.place(); },
        interrupt() { a.el.classList.remove('ringing'); },            // 被拖走：氣泡跟著走，放手後繼續響
        end() { a.el.classList.remove('ringing'); }
      });
    }
    alert(reminderId, text) {
      reminderId = S.str(reminderId, 80);
      this.alerts = this.alerts.filter((x) => x.reminderId !== reminderId);
      this.alerts.push({ reminderId, text: S.str(text) });
      this.bubble.hide('say');
      if (this.job && this.job.layer === 0) { this.bubble.alert(reminderId, text); return; }   // 拖曳中：氣泡先出來，放手後響
      this.startRing();
    }
    clearAlert(reminderId) {
      const before = this.alerts.length;
      this.alerts = reminderId ? this.alerts.filter((x) => x.reminderId !== reminderId) : [];
      if (before === this.alerts.length) return;
      if (this.alerts.length) { this.startRing(); return; }
      this.bubble.hide('alert');
      if (this.job && this.job.name === 'ring') this.finish(this.job, { rest: false });
      else this.showRest();
      S.reportRects();
    }
    answerAlert(reminderId, act) {
      if (!reminderId) return;
      if (act === 'snooze') S.api.snooze(reminderId); else S.api.ack(reminderId);
      this.clearAlert(reminderId);
      if (act === 'snooze') this.say('好，5 分鐘後再叫你！', { ms: 1800 });
    }

    // L7 散步：家附近 ±400、避開別隻與游標、不出螢幕
    walkJob() {
      const a = this, W = innerWidth, margin = 60, range = S.settings.walk === 'screen' ? W : 400;
      const backHome = Math.abs(a.x - a.home) > 250 && Math.random() < .6;
      let dir = backHome ? Math.sign(a.home - a.x) : (Math.random() < .5 ? -1 : 1);
      const hops = 3 + Math.floor(Math.random() * 6 * (0.5 + a.act));
      const step = 30 + a.act * 15;
      const lo = Math.max(margin, a.home - range), hi = Math.min(W - margin, a.home + range);
      let target = S.clamp(a.x + dir * hops * step, lo, hi);
      if (Math.abs(target - a.x) < step) { dir = -dir; target = S.clamp(a.x + dir * hops * step, lo, hi); }
      const job = {
        name: 'walk', ticks: true, phase: 'turn', dir, target, step, hopMs: 430 - a.act * 110,
        start(now) { job.from = a.th; job.to = dir > 0 ? 90 : -90; job.p0 = now; },
        tick(now) {
          if (job.phase === 'turn') {
            const u = Math.min(1, (now - job.p0) / 320), th = Math.round((job.from + (job.to - job.from) * EASE.io(u)) / 15) * 15;
            a.setFrame('t' + th, th, {});
            if (u >= 1) { a.th = job.to; job.phase = 'walk'; job.p0 = now; job.x0 = a.x; if (Math.abs(target - a.x) < step / 2) return false; }
            return true;
          }
          const u = Math.min(1, (now - job.p0) / job.hopMs), [f, v] = Actor.q(u, 8);
          a.setFrame(`hop${dir}_${f}`, a.th, ANIM.FETCH.hop(v));
          if (u < .05 && a.blocked(job.x0 + dir * step, dir)) return false;
          a.x = job.x0 + dir * step * EASE.io(u); a.place();
          if (u >= 1) {
            a.checkPass();
            if (Math.sign(target - a.x) !== dir || Math.abs(target - a.x) < step / 2) return false;
            job.p0 = now; job.x0 = a.x;
          }
          return true;
        },
        interrupt() { a.afterWalk(); },
        end() { a.afterWalk(); }
      };
      return job;
    }
    // 散步經過別隻（腳底水平 < 120 px、高度差 < 40 px）：同一對每天只報一次
    checkPass() {
      const day = new Date().toDateString();
      for (const o of S.actors.values()) {
        if (o === this || Math.abs(o.x - this.x) >= 120 || Math.abs(o.y - this.y) >= 40) continue;
        const key = [this.id, o.id].sort().join('|') + '|' + day;
        if (passSeen.has(key)) continue;
        passSeen.add(key);
        S.api.pass(this.id, o.id);
      }
    }
    afterWalk() {
      this.th = this.th > 0 ? 30 : -30;
      const base = 40000 + (1 - this.act) * 140000;                      // 活潑約 40–90 秒、慵懶 3–6 分鐘
      this.nextAt = performance.now() + base * (0.6 + Math.random() * 0.8);
    }
    blocked(nx, dir) {   // 前方 120 px 內有別隻、或游標就在前面 → 停
      for (const o of S.actors.values()) {
        if (o === this || Math.abs(o.y - this.y) > 80) continue;
        const ox = o.job && o.job.name === 'walk' ? o.x + o.job.dir * o.job.step : o.x;
        if (Math.sign(ox - this.x) === dir && Math.abs(ox - nx) < 120) return true;
      }
      return Math.abs(S.cursor.x - nx) < 120 && Math.abs(S.cursor.y - (this.y - 80)) < 160;
    }

    // L3 陪我玩（打球、吃東西、跳、打盹）
    play(action) {
      const sports = ANIM.ANIMS[action], anim = sports || ANIM.REACT[action];
      if (!anim || !['badminton', 'volleyball', 'basketball', 'eat', 'hop', 'nap'].includes(action)) return false;
      if (S.reduceMotion && action !== 'eat' && action !== 'nap') { this.say(anim.endLine || '好～', { ms: 1800 }); return false; }
      if (this.ball && (action === 'basketball' || action === 'volleyball')) this.ball.fade();
      const a = this;
      const job = this.animJob('play:' + action, anim, {
        onEvent: (ev, t, j) => { if (ev.name === 'throw') a.throwBall(action, ev, t, j); },
        // 球丟出去了：停在最後一格看著球，等球停下再去撿
        hold: (j) => {
          if (!j.st.thrown) return false;
          if (!a.ball || a.ball.gone) return false;
          if (a.ball.stopped) { j.handoff = true; return false; }
          return true;
        },
        interrupt: (reason) => { if (reason === 'drag' && a.ball && !a.ball.stopped) a.ball.fade(); },
        end: (j) => { if (!j.st.thrown && anim.endLine) a.say(anim.endLine, { ms: 2200 }); }
      });
      return this.requestActivity(3, job);
    }
    // 出手：從手上算出球的位置與速度，在舞台裡產生球
    throwBall(action, ev, t, job) {
      const anim = ANIM.ANIMS[action], s = ANIM.sample(anim, t);
      s.pose.props = [];
      S.ART.configure(this.traits);
      const { hands } = POSE.render(s.th, 'qe', s.pose);
      S.ART.configure(null);
      const from = ev.fromHand && hands.L && hands.R ? [(hands.L.X + hands.R.X) / 2 - 6, (hands.L.Y + hands.R.Y) / 2 - 10] : ev.from;
      const p = this.toStage(from[0], from[1]), k = this.k;
      let vx, vy, hoop = null;
      if (ev.kind === 'bball') {
        // 投向籃框；力道有隨機，所以有時進、有時彈框、有時打板
        const rL = this.toStage(-24, 40), rR = this.toStage(-2, 40), b0 = this.toStage(7, 14), b1 = this.toStage(7, 54);
        hoop = { left: rL.x, right: rR.x, y: rL.y, board: b0.x, boardTop: b0.y, boardBottom: b1.y };
        vx = -(170 + Math.random() * 120) * k / 1.02; vy = -(420 + Math.random() * 110) * k / 1.02;
      } else {
        // 排球：墊太大力，往上衝出去、往左或右落下
        const dir = Math.random() < .5 ? -1 : 1;
        vx = dir * (160 + Math.random() * 260) * k; vy = -(760 + Math.random() * 260) * k * (0.85 + Math.random() * .35);
      }
      job.st.thrown = true;
      this.throwX = this.x;                                              // 撿回來要回到這裡
      new S.Ball(this, ev.kind, p.x, p.y, vx, vy, hoop);
    }
    ballScored() { if (!this.bubble.kind) this.say('唰！空心！', { ms: 1600 }); }
    // 球停下來了：正在看球就直接接著去撿；否則等有空（L4）
    ballStopped() {
      if (this.job && this.job.handoff == null && this.job.st && this.job.st.thrown) this.job.handoff = true;
      S.kick();
    }
    ballGone() { if (this.job && this.job.name === 'fetch') this.finish(this.job, { line: '球不見了……' }); }

    // L4 撿球：發現 → 衝刺 → 煞車 → 四腳著地聞一聞 → 撈起來 → 坐起來抱球 → 回程（抱回／用鼻子推）→ 到家
    startFetch() {
      const b = this.ball;
      if (!b || b.gone || b.picked || this.mode !== 'awake') return false;
      if (this.job && this.job.layer <= 4) return false;
      if (Math.abs(b.x - this.x) > innerWidth / 2) {                     // 太遠：放棄
        b.fade(); this.say('球跑太遠了，算了～', { ms: 2200 }); return false;
      }
      const ok = this.requestActivity(4, this.fetchJob(b));
      return ok;
    }
    fetchJob(ball) {
      const a = this, F = ANIM.FETCH2, kind = ball.kind, k = a.k;
      const dir = Math.sign(ball.x - a.x) || -1;                         // 球在哪一邊
      const m = (fr) => (dir > 0 ? ANIM.mirrorFrame(fr) : fr);           // 關鍵影格以「球在左邊」為準
      const mh = m;                                                      // 回程：關鍵影格本身就是面向家（球的反方向）
      const walk = 30 + a.act * 15, hopMs = 430 - a.act * 110;
      const setting = S.settings.fetchReturn;
      const mode = setting === 'carry' || setting === 'nudge' ? setting : (a.fetchCount++ % 2 ? 'nudge' : 'carry');
      const home = a.throwX != null ? a.throwX : a.home;
      const NOSE = 106 * k;                                              // 四腳著地時鼻子在腳前方的距離
      const standX = ball.x - dir * NOSE;
      const P = {                                                        // 各段長度（毫秒）與格數
        discover: [Math.max(600, 250 + (1 - a.act) * 1200), 6], dash: [hopMs, 8], brake: [300, 4], sniff: [750, 10], scoop: [400, 5],
        sit: [500, 6], turnHome: [400, 6], carry: [hopMs * .9, 8], drop: [400, 5], nudge: [600, 8], rescoop: [900, 8], homeB: [1300, 6], homeV: [1600, 12], homeVNudge: [1300, 10]
      };
      const job = { name: 'fetch', ticks: true, phase: 'discover', mode };
      const go = (ph, now) => { job.phase = ph; job.p0 = now; job.x0 = a.x; };
      // 畫一格（快取）：key 含球種、方向、回程方式
      const frame = (ph, u, mirrorFn) => {
        const [f, v] = Actor.q(u, P[ph][1]);
        const fr = mirrorFn(F[ph](v, kind));
        a.setFrame(`F${ph}${kind}${dir}_${f}`, fr.th, fr.pose, true);
      };
      job.start = (now) => {
        go('discover', now);
        a.el.classList.add('bang-on');
        setTimeout(() => a.el.classList.remove('bang-on'), 700);
        const left = Math.abs(standX - a.x);
        job.dashHops = Math.max(0, Math.round(left / (walk * 1.4)));
        job.dashStep = job.dashHops ? (standX - a.x) / job.dashHops : 0;
      };
      job.tick = (now) => {
        const ph = job.phase, u = Math.min(1, (now - job.p0) / P[ph][0]);
        switch (ph) {
          case 'discover': frame(ph, u, m); if (u >= 1) go(job.dashHops ? 'dash' : 'brake', now); break;
          case 'dash':                                                   // 大步跳（步距約散步的 1.4 倍）
            frame(ph, u, m);
            a.x = job.x0 + job.dashStep * EASE.io(u); a.place();
            if (u >= 1) { job.dashHops--; go(job.dashHops > 0 ? 'dash' : 'brake', now); }
            break;
          case 'brake': frame(ph, u, m); if (u >= 1) go('sniff', now); break;
          case 'sniff': frame(ph, u, m); if (u >= 1) { go('scoop', now); ball.hide(); ball.picked = true; } break;
          case 'scoop': frame(ph, u, m); if (u >= 1) go('sit', now); break;
          case 'sit':
            frame(ph, u, m);
            if (u >= 1) {
              if (Math.abs(home - a.x) < walk * .6) go(kind === 'bball' ? 'homeB' : 'homeV', now);
              else go('turnHome', now);
            }
            break;
          case 'turnHome': frame(ph, u, m); if (u >= 1) go(mode === 'carry' ? 'carry' : 'drop', now); break;
          case 'carry': {                                                // 抱著球小步蹦回去（步距約散步的 0.7 倍）
            frame(ph, u, mh);
            const st = Math.min(walk * .7, Math.abs(home - job.x0)) * Math.sign(home - job.x0);
            a.x = job.x0 + st * EASE.io(u); a.place();
            if (u >= 1) { if (Math.abs(home - a.x) < 2) go(kind === 'bball' ? 'homeB' : 'homeV', now); else go('carry', now); }
            break;
          }
          case 'drop':                                                   // 趴低，球放到鼻子前的地上
            frame(ph, u, mh);
            if (u > .5 && ball.held) { ball.show(a.x - dir * NOSE); ball.nudging = true; }
            if (u >= 1) { if (ball.held) ball.show(a.x - dir * NOSE); ball.nudging = true; go('nudge', now); }
            break;
          case 'nudge': {                                                // 一推一滾：先頂球、球滾一小段，再跟上一步
            frame(ph, u, mh);
            const hd = Math.sign(home - job.x0), st = Math.min(walk * .8, Math.abs(home - job.x0)) * hd;
            const push = EASE.out(Math.min(1, u / .35)), follow = u > .35 ? EASE.io((u - .35) / .65) : 0;
            ball.rollTo(job.x0 + hd * NOSE + st * push);
            a.x = job.x0 + st * follow; a.place();
            if (u >= 1) {
              if (Math.abs(home - a.x) < 2) { ball.nudging = false; if (kind === 'bball') { ball.hide(); go('rescoop', now); } else go('homeVNudge', now); }
              else go('nudge', now);
            }
            break;
          }
          case 'rescoop': frame(ph, u, mh); if (u >= 1) go('homeB', now); break;
          case 'homeB':                                                  // 籃球：轉向籃框、捧在胸前準備再投
            frame(ph, u, (fr) => fr);
            if (u >= 1) { job.endOpts = { line: '撿回來了！再投一次～' }; ball.remove(); return false; }
            break;
          case 'homeV': {                                                // 排球：放在腳邊、拍一拍、冒愛心，然後球淡出
            frame(ph, u, (fr) => fr);
            if (ball.held && u > .2) { const p = a.toStage(112, 170); ball.show(p.x); }
            if (u >= 1) { ball.fade(); job.endOpts = { line: '撿到了！下次輕一點墊。' }; return false; }
            break;
          }
          case 'homeVNudge':
            frame(ph, u, mh);
            if (u >= 1) { ball.fade(); job.endOpts = { line: '推回來了！' }; return false; }
            break;
        }
        return true;
      };
      // 撿球途中被打斷：球淡出
      job.interrupt = () => { ball.nudging = false; ball.fade(); a.el.classList.remove('bang-on'); };
      job.end = () => { a.th = -15; a.home = a.x; };
      return job;
    }

    // ---- L5 社交（簡化版）：發起的走到對方前方 → 兩隻轉向對方 → 碰鼻＋愛心或揮手 2 秒 → social:done ----
    // 被更高層打斷：送 social:abort{by, reason}，另一隻原地收尾
    socialJob(soc, isInit, other) {
      const a = this, COUPLE = ['cuddle', 'groom', 'leanNap', 'walkTogether'];
      const gap = (COUPLE.includes(soc.type) ? 60 : 110) * Math.max(a.k, other.k) / S.SCALE;
      const job = { name: 'social', ticks: true, soc, isInit, other, phase: 'approach' };
      const loving = COUPLE.includes(soc.type) || soc.type === 'nose';
      job.start = (now) => { job.p0 = now; job.x0 = a.x; a.lookBucket = null; };
      job.tick = (now) => {
        if (job.phase === 'approach') {
          if (!isInit) {                                                 // 對方：轉向走過來的那隻，等著
            const th = other.x < a.x ? -60 : 60;
            a.setFrame('t' + th, th, {});
            if (other.job && other.job.soc && other.job.soc.pairId === soc.pairId && other.job.phase === 'greet') { job.phase = 'greet'; job.p0 = now; }
            return true;
          }
          const side = Math.sign(a.x - other.x) || 1, tx = other.x + side * gap, dir = Math.sign(tx - a.x);
          const step = 30 + a.act * 15, hopMs = 430 - a.act * 110;
          if (Math.abs(tx - a.x) < 4) { job.phase = 'greet'; job.p0 = now; return true; }
          if (!job.hop) job.hop = { t0: now, x0: a.x, st: Math.min(step, Math.abs(tx - a.x)) * dir, dir };
          const H = job.hop, u = Math.min(1, (now - H.t0) / hopMs), [f, v] = Actor.q(u, 8);
          a.th = H.dir > 0 ? 90 : -90;
          a.setFrame(`hop${H.dir}_${f}`, a.th, ANIM.FETCH.hop(v));
          a.x = H.x0 + H.st * EASE.io(u); a.place();
          if (u >= 1) job.hop = null;
          if (now - job.p0 > 20000) { job.endOpts = { rest: true }; a.abortSocial('work'); return false; }
          return true;
        }
        // 碰鼻＋愛心（情侶、碰鼻）或揮手：兩隻面對面，各自即時繪製 2 秒
        const t = (now - job.p0) / 1000, face = other.x < a.x ? -1 : 1, an = loving ? ANIM.REACT.greetNose : ANIM.REACT.greetWave;
        if (now - (job.last || 0) >= S.LIVE_MS) { job.last = now; const s = ANIM.sample(an, Math.min(t, an.dur)); s.pose.props = an.props ? an.props(t) : []; a.drawLive(-face * s.th, face > 0 ? ANIM.mirrorFrame({ th: 0, pose: s.pose }).pose : s.pose); }
        if (t >= 2) {
          if (isInit && !job.sent) { job.sent = true; S.api.socialDone(soc.pairId, true, soc.type); }
          job.endOpts = { rest: true };
          return false;
        }
        return true;
      };
      job.interrupt = (reason) => {
        if (job.quiet) return;
        const why = reason === 'drag' ? 'drag' : reason === 'ring' ? 'alert' : /^react|^ring/.test(reason) ? 'work' : 'user';
        a.abortSocial(why);
      };
      job.end = () => { a.th = -15; };
      return job;
    }
    // 自己被打斷：通知主行程，夥伴原地收尾
    abortSocial(reason) {
      const j = this.job && this.job.name === 'social' ? this.job : this.lastSocial;
      const soc = j && j.soc;
      if (!soc || soc.aborted) return;
      soc.aborted = true;
      S.api.socialAbort(soc.pairId, this.id, reason);
      const o = j.other;
      if (o && o.job && o.job.name === 'social' && o.job.soc.pairId === soc.pairId) { o.job.quiet = true; o.finish(o.job); }
    }
    // 主行程叫停（另一隻被打斷、或排程取消）
    endSocial(pairId) {
      if (this.job && this.job.name === 'social' && this.job.soc.pairId === pairId) { this.job.quiet = true; this.finish(this.job); }
    }

    // ---- 滑鼠：單擊摸頭、雙擊開面板、右鍵選單、長摸、拖曳（L0） ----------------------
    bindInput() {
      const el = this.el;
      let down = null, clickTimer = 0, patIdx = Math.floor(Math.random() * 3);
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); S.api.context(this.id); });
      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        down = { x: e.clientX, y: e.clientY, moved: 0, samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
        const move = (ev) => {
          if (!down) return;
          const now = performance.now();
          down.moved = Math.max(down.moved, Math.hypot(ev.clientX - down.x, ev.clientY - down.y));
          down.samples.push({ x: ev.clientX, y: ev.clientY, t: now });
          while (down.samples.length > 2 && now - down.samples[0].t > 90) down.samples.shift();
          if (!down.drag && down.moved >= 5) down.drag = this.startDrag(down.x, down.y);
          if (down.drag) down.drag.move(ev.clientX, ev.clientY);
        };
        const up = () => {
          window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
          const d = down; down = null;
          if (d.drag) { const a0 = d.samples[0], b0 = d.samples[d.samples.length - 1], dt = Math.max(1, b0.t - a0.t); d.drag.release((b0.x - a0.x) / dt, (b0.y - a0.y) / dt); return; }
          // 點擊：0.25 秒內再點一次＝雙擊（開面板），否則＝摸頭
          if (clickTimer) { clearTimeout(clickTimer); clickTimer = 0; S.api.dblclick(this.id); return; }
          clickTimer = setTimeout(() => { clickTimer = 0; patIdx = (patIdx + 1) % 3; this.pat(patIdx); }, 250);
        };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      });
      // 長摸：游標在頭上來回移動
      let rev = [], lastDir = 0;
      el.addEventListener('mousemove', (e) => {
        if (down || this.mode !== 'awake') return;
        const r = el.getBoundingClientRect();
        if (e.clientY - r.top > r.height * .5) return;
        const now = performance.now(), dir = Math.sign(e.movementX || 0);
        if (dir && dir !== lastDir && Math.abs(e.movementX) >= 2) { rev.push(now); lastDir = dir; }
        rev = rev.filter((t) => now - t < 1400);
        const need = (this.beh && this.beh.petReversals) || 4;
        if (this.job && this.job.name === 'petting') { if (dir) this.job.lastStroke = now; return; }
        if (rev.length >= need) { rev = []; this.startPetting(); }
      });
    }
    pat(i) {
      if (this.mode !== 'awake') return;
      const lines = (this.beh && this.beh.pat) || ['嘿嘿，好舒服。', '耳朵癢癢的！', '再摸一下嘛～'];
      const anim = ANIM.REACT[['pat1', 'pat2', 'spin'][i]];
      this.requestActivity(3, this.animJob('pat', anim, { endLine: lines[i % lines.length] }));
    }
    startPetting() {
      const a = this, beh = this.beh || {};
      const job = this.animJob('petting', ANIM.REACT.petting, {
        loop: true,
        start: (j) => { j.lastStroke = performance.now(); j.since = j.lastStroke; },
        each: (j, now) => {
          if (now - j.since > 8000) { j.endOpts = { line: null }; j.napNext = true; return false; }     // 摸超過 8 秒會睡著
          if (now - j.lastStroke > 900) { j.endOpts = { line: beh.petDone || '嘿嘿，謝謝你摸我。' }; return false; }
          return true;
        },
        end: (j) => { if (j.napNext) setTimeout(() => a.requestActivity(3, a.animJob('nap', ANIM.REACT.nap, { endLine: '睡飽了！' })), 0); }
      });
      this.requestActivity(3, job);
    }
    // L0 拖曳：拎起來 → 放手（甩得快：滑行減速 → 頭暈 2.6 秒；慢慢放：跳一下）
    startDrag(sx, sy) {
      const a = this, ox = a.x, oy = a.y;
      const job = {
        name: 'drag', ticks: false, held: true,
        start() {
          a.el.classList.remove('asleep', 'ringing'); a.el.classList.add('dragging');
          a.setFrame('lift', 0, ANIM.STILL.lift);
          a.lookBucket = null;
          S.reportRects(true);
        },
        move(cx, cy) { a.x = ox + cx - sx; a.y = Math.min(innerHeight - 4, oy + cy - sy); a.place(); },
        release(vx, vy) {
          job.held = false; a.el.classList.remove('dragging');
          if (!S.reduceMotion && Math.hypot(vx, vy) > 1.1) { job.fling = { vx: vx * 16, vy: vy * 16 }; job.ticks = true; S.kick(); }
          else job.land(performance.now());
          S.reportRects(false);
        },
        tick(now) {
          if (job.fling) {                                               // 滑行減速（每格 0.86）
            const f = job.fling; f.vx *= .86; f.vy *= .86;
            a.x = S.clamp(a.x + f.vx, a.w * .3, innerWidth - a.w * .3); a.y = S.clamp(a.y + f.vy, a.h * .8, innerHeight - 4); a.place();
            if (Math.hypot(f.vx, f.vy) < 1.2) { job.fling = null; job.after = { anim: ANIM.REACT.dizzy, t0: now, line: '頭好暈……下次輕一點啦。' }; }
            return true;
          }
          if (job.after) {
            const t = (now - job.after.t0) / 1000, an = job.after.anim;
            if (now - (job.last || 0) >= S.LIVE_MS) { job.last = now; const s = ANIM.sample(an, t); s.pose.props = an.props ? an.props(t, {}) : []; a.drawLive(s.th, s.pose); }
            if (t >= an.dur) { job.endOpts = { line: job.after.line }; return false; }
          }
          return true;
        },
        land(now) { job.ticks = true; job.after = { anim: ANIM.REACT.land, t0: now, line: null }; S.kick(); },
        end() {
          a.home = a.x; a.th = -15;
          S.api.drop(a.id, Math.round(window.screenX + a.x), Math.round(window.screenY + a.y));
          S.api.savePos(a.id, { x: Math.round(a.x), y: Math.round(a.y) });
          a.nextAt = performance.now() + 8000;
          a.el.classList.remove('dragging');
        }
      };
      if (!this.requestActivity(0, job, 'drag')) return null;
      return job;
    }

    // ---- 游標：靠近時眼睛看游標；停很久湊過去聞（膽小的害羞轉開） ----------------------
    onCursor(c, now) {
      const dx = c.x - this.x, dy = c.y - (this.y - 120 * this.k), dist = Math.hypot(dx, dy);
      this.el.classList.toggle('near', dist < 300);
      const moved = !this.lastC || Math.hypot(c.x - this.lastC.x, c.y - this.lastC.y) > 3;
      this.lastC = { x: c.x, y: c.y };
      if (moved) { this.stillSince = now; this.sniffed = false; }
      if (this.job || this.mode !== 'awake' || this.alerts.length) return;
      const b = dist > 320 ? null : dy < -60 && Math.abs(dx) < 70 ? 'U' : dx < -60 ? 'L' : dx > 60 ? 'R' : null;
      if (b !== this.lookBucket) { this.lookBucket = b; this.showRest(); }
      clearTimeout(this.lookTimer);
      if (b) this.lookTimer = setTimeout(() => { this.lookBucket = null; if (!this.job) this.showRest(); }, 1500);   // 游標走遠（沒有新座標）就回正
      const delay = (this.beh && this.beh.sniffDelayMs) || 6000;
      if (!this.sniffed && dist < 280 && now - this.stillSince > delay && !S.reduceMotion) {
        this.sniffed = true;
        if (this.beh && this.beh.shy) {                                  // 膽小：害羞地轉開、偷看
          const a = this, side = dx >= 0 ? -1 : 1;
          this.requestActivity(6, { name: 'shy', ticks: false, start() { a.setFrame('shy' + side, side * 50, ANIM.STILL.shy); a.say('（偷偷看你）', { ms: 1800 }); a.shyT = setTimeout(() => a.finish(a.job && a.job.name === 'shy' ? a.job : null), 1800); }, interrupt() { clearTimeout(a.shyT); } });
        } else this.requestActivity(6, this.animJob('sniff', ANIM.REACT.sniff, { flip: dx > 0 }));
      }
    }

    // ---- 模式 ------------------------------------------------------------------
    setMode(mode) {
      if (mode === this.mode) return;
      const prev = this.mode;
      this.mode = mode;
      if (mode === 'asleep' || mode === 'hidden') {
        // 只留 L0、L1；其他活動收掉（還沒報的留在佇列）
        if (this.job && this.job.layer >= 2) { const j = this.job; this.job = null; j.interrupt && j.interrupt(mode); this.hideLive(); this.setLayer(8); }
        if (this.ball && !this.ball.picked) this.ball.fade();
        clearTimeout(this.drainTimer);
        this.lookBucket = null;
        if (!this.job) this.showRest();
      } else if (prev !== 'awake') {
        this.el.classList.remove('asleep');
        this.nextAt = performance.now() + 5000 + Math.random() * 8000;
        if (!this.job) this.showRest();
      }
    }
    // 回來時報告：先揮手說「你回來啦」，再依序報佇列
    wakeAndReport(delay) {
      setTimeout(() => {
        if (this.mode !== 'awake') return;
        if (this.job && this.job.layer <= 2) return;
        this.queue.unshift({ kind: 'back', list: [{}], prio: 3 });
        this.drain();
      }, delay);
    }
    destroy() {
      if (this.job) { const j = this.job; this.job = null; j.interrupt && j.interrupt('remove'); }
      clearTimeout(this.drainTimer); clearTimeout(this.lookTimer);
      if (this.ball) this.ball.remove();
      this.bubble.destroy();
      this.el.remove();
      S.purgeFrames(this.id);
    }
  }
  S.Actor = Actor;
  S.describe = describe;
})();
