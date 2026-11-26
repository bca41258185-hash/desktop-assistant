// 舞台上「兩隻以上」的事：雙人互動（S.Duet）、避讓、育兒袋與小袋鼠、情侶待機（規格 5.4、5.5、6.3、7.5、8.3–8.6）
// 互動的劇本（關鍵姿勢、球的軌跡）在 quokka-anim-social.js；這裡負責走位、同步播放、被打斷的收尾。
//
// 雙人互動的流程：social:start → 發起的那隻一步一步走到劇本要的距離（不滑步）→ 兩隻平順轉向對方 →
//   同一個時鐘播放（兩隻畫在同一張即時 SVG 裡，依前後交錯疊放；球、愛心也在裡面）→ 播完換回各自的 PNG → social:done
// 被打斷：被打斷的那隻立刻去做高優先的事；另一隻播 0.5–0.8 秒收尾再回待機；送 social:abort
(function () {
  const S = window.Stage, ANIM = S.ANIM, SOC = S.SOC, EASE = ANIM.EASE, Actor = S.Actor;
  const COUPLE = new Set(['cuddle', 'groom', 'leanNap', 'walkTogether']);
  // 兩隻一起即時繪製：跟著共用迴圈的幀率（S.frameGap；預設 60 格，吃力時 stage-core 自動降級）
  let duetSeq = 0;
  S.duets = new Set();

  // ---- 雙人互動的畫面：每隻每層（影子、back、body、front）各自一個小 SVG 圖層（will-change: transform） -------
  //   · 位移（走位、跳起來的高度）只改圖層的 CSS transform，交給合成器，不重畫、不重新點陣化
  //   · 圖形（姿勢）有變才換那一層的內容；畫面吃力時兩隻輪流重建（每隻每秒 30 次），位移照樣每格
  //   · 疊放順序和 SOC.compose() 一樣：影子（遠、近）→ 場景後層 → back（遠、近）→ body → front → 場景前層
  //   · 會變的漸層、裁切（defs）放在一個看不見的 SVG 裡，同一份文件內各圖層用 url(#id) 引用
  const NS = 'http://www.w3.org/2000/svg';
  const BOX = { x: -110, y: -100, w: 380, h: 300 };                  // 每層圖的範圍（姿勢單位；含伸出去的手、球拍、尾巴）
  class DuetView {
    constructor(el) {
      this.el = el;
      const mk = (cls, full) => {
        const d = document.createElement('div'); d.className = 'dl ' + cls;
        const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('aria-hidden', 'true');
        const g = document.createElementNS(NS, 'g'); svg.appendChild(g); d.appendChild(svg);
        return { d, svg, g, full };
      };
      this.defs = mk('defs'); this.defs.d.style.cssText = 'width:0;height:0;overflow:hidden';
      this.wdefs = document.createElementNS(NS, 'g'); this.defs.g.appendChild(this.wdefs);
      this.wBack = mk('world', true); this.wFront = mk('world', true);
      this.slot = {};
      for (const k of ['a', 'b']) {
        const L = this.slot[k] = { defs: document.createElementNS(NS, 'g') };
        this.defs.g.appendChild(L.defs);
        for (const ly of ['shadow', 'back', 'body', 'front']) {
          const o = mk('part', false);
          if (ly !== 'shadow') { o.abs = document.createElementNS(NS, 'g'); o.rel = o.g; if (ly === 'back') o.svg.insertBefore(o.abs, o.g); else o.svg.appendChild(o.abs); }
          L[ly] = o;
        }
      }
      el.appendChild(this.defs.d);
      this.cache = new Map(); this.near = null; this.W = 0; this.H = 0; this.k = {};
    }
    set(node, key, str) { if (this.cache.get(key) === str) return; this.cache.set(key, str); node.innerHTML = str; }
    order(near, far) {
      if (this.near === near) return;
      this.near = near;
      const N = this.slot[near], F = this.slot[far];
      this.el.append(this.defs.d, F.shadow.d, N.shadow.d, this.wBack.d, F.back.d, N.back.d, F.body.d, N.body.d, F.front.d, N.front.d, this.wFront.d);
    }
    // 每隻圖層的大小（跟著體型）
    size(k, kk) {
      if (this.k[k] === kk) return;
      this.k[k] = kk;
      for (const ly of ['shadow', 'back', 'body', 'front']) {
        const o = this.slot[k][ly];
        o.svg.setAttribute('viewBox', `${BOX.x} ${BOX.y} ${BOX.w} ${BOX.h}`);
        o.svg.setAttribute('width', (BOX.w * kk).toFixed(2)); o.svg.setAttribute('height', (BOX.h * kk).toFixed(2));
      }
    }
    move(o, key, x, y) { const v = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`; if (this.cache.get(key) !== v) { this.cache.set(key, v); o.d.style.transform = v; } }
    draw(res) {
      if (this.W !== innerWidth || this.H !== innerHeight) {
        this.W = innerWidth; this.H = innerHeight;
        for (const w of [this.wBack, this.wFront]) { w.svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`); w.svg.setAttribute('width', this.W); w.svg.setAttribute('height', this.H); }
      }
      this.order(res.near, res.far);
      if (res.world && !this.cache.has('wd')) this.set(this.wdefs, 'wd', S.slim(SOC.worldDefs()));
      this.set(this.wBack.g, 'wb', res.wBack); this.set(this.wFront.g, 'wf', res.wFront);
      for (const k of ['a', 'b']) {
        const p = res.parts[k], L = this.slot[k], kk = p.k;
        this.size(k, kk);
        // 姿勢座標 (u, v) → 舞台：(X + (u − 80)·k, Y + (v − 183)·k)；圖層左上角是 (BOX.x, BOX.y)
        const bx = p.X + (BOX.x - 80) * kk, by = p.Y + (BOX.y - 183) * kk;
        this.move(L.shadow, k + 'sh', bx, by);
        this.set(L.shadow.g, k + 'shS', p.shadow);
        for (const ly of ['back', 'body', 'front']) this.move(L[ly], k + ly, bx + p.dx * kk, by + p.dy * kk);
        if (p.shape) {
          for (const ly of ['back', 'body', 'front']) { const o = L[ly]; if (o.band !== p.band) { o.band = p.band; o.svg.style.setProperty('--band', p.band); } }
          this.set(L.defs, k + 'defs', S.slim(p.defs));
          for (const ly of ['back', 'body', 'front']) {
            this.set(L[ly].rel, k + ly + 'R', S.slim(p[ly] || ''));
            // 場景座標的道具（球拍…）不跟著 dx、dy：在圖層裡反向抵銷
            const abs = p[ly + 'Abs'] || '';
            this.set(L[ly].abs, k + ly + 'A', abs ? `<g transform="translate(${(-p.dx).toFixed(1)} ${(-p.dy).toFixed(1)})">${S.slim(abs)}</g>` : '');
          }
        }
      }
    }
  }

  class Duet {
    constructor(soc, I, O) {
      this.soc = soc; this.I = I; this.O = O; this.type = SOC.TYPES[soc.type] ? soc.type : 'wave';
      this.T = SOC.TYPES[this.type]; this.phase = 'approach'; this.uid = ++duetSeq; this.over = false;
      this.jobI = this.makeJob(I, true, O); this.jobO = this.makeJob(O, false, I);
    }
    makeJob(a, isInit, other) {
      const d = this;
      const job = { name: 'social', ticks: true, soc: d.soc, isInit, other, duet: d, joeyOk: true };
      Object.defineProperty(job, 'phase', { get: () => (job.outro ? 'outro' : d.phase) });
      job.start = () => { a.lookBucket = null; };
      job.tick = (now) => {
        if (job.outro) return d.outroTick(a, job, now);
        if (d.over) return false;
        if (isInit) d.step(now);
        return !d.over || !!job.outro;
      };
      job.interrupt = (reason) => d.interrupted(a, reason);
      job.end = () => { a.zBoost = 0; };
      job.endOpts = { rest: true };
      return job;
    }
    ctxFor() {
      const I = this.I, O = this.O, W = innerWidth, side = O.x >= I.x ? 1 : -1;
      const act = (a) => ({ x: a.x, k: a.k, tr: a.traits, hs: a.hs, uid: a.uid, deco: S.deco ? (th, pose) => S.deco(a, th, pose, 'D' + a.uid) : null });
      // 背後的空間：到螢幕邊或最近的第三隻為止（追逐、並肩散步、籃框不會跑到別隻身上）
      const third = [...S.actors.values()].filter((o) => o !== I && o !== O && !o.inPouch && Math.abs(o.y - I.y) <= 40 && !(o.isFollow && (momOf(o) === I || momOf(o) === O)));
      const roomL = (x) => Math.min(x - 50, ...third.filter((o) => o.x < x).map((o) => x - o.x - 120)), roomR = (x) => Math.min(W - 50 - x, ...third.filter((o) => o.x > x).map((o) => o.x - x - 120));
      return SOC.context(act(I), act(O), { rnd: S.testRnd || Math.random, couple: I.attach.partner === O.id, room: { a: Math.max(0, side > 0 ? roomL(I.x) : roomR(I.x)), b: Math.max(0, side > 0 ? roomR(O.x) : roomL(O.x)) } });
    }
    begin(now) {
      const I = this.I, O = this.O, W = innerWidth;
      const gap = this.T.gap(this.ctxFor());
      const side = O.x >= I.x ? 1 : -1;
      // 兩隻都跳向對方，在中間會合（各走一半）
      const mid = (I.x + O.x) / 2;
      let ix = mid - side * gap / 2, ox = mid + side * gap / 2, laneFor = null;
      if ((ox - O.x) * side > 0) { ix = O.x - side * gap; ox = O.x; }      // 本來就比互動距離還近：對方不用往後退，發起的調整就好
      // 會合點不能站到第三隻旁邊（非伴侶要保持禮貌距離）：中間有別隻時，改成對方不動、發起的走過去（或反過來）
      {
        const thirds = [...S.actors.values()].filter((o) => o !== I && o !== O && !o.inPouch && Math.abs(o.y - I.y) <= 40 && !(o.isFollow && (momOf(o) === I || momOf(o) === O)) && !(F.close(I, o) && F.close(O, o)));
        const okPlan = (a, b) => thirds.every((o) => S.spotsOf(o).every((x) => Math.abs(x - a) >= S.politeGap(I, o) && Math.abs(x - b) >= S.politeGap(O, o)));
        if (!okPlan(ix, ox)) {
          const plans = [[O.x - side * gap, O.x], [I.x, I.x + side * gap]].filter(([a, b]) => a > 44 && a < W - 44 && b > 44 && b < W - 44);
          const good = plans.find(([a, b]) => okPlan(a, b));
          if (good) [ix, ox] = good;
        }
      }
      // 爸爸碰鼻小袋鼠：媽媽（錨點）擋在中間 → 爸爸留在自己這一側，小袋鼠從媽媽腳邊繞到爸爸這邊來
      const anc = this.soc.anchor ? S.actors.get(this.soc.anchor) : null;
      if (anc && anc !== I && anc !== O && !anc.inPouch && Math.abs(anc.y - I.y) <= 40 && (anc.x - I.x) * (anc.x - O.x) < 0) {
        ox = anc.x - side * (anc.w * .3 + O.w * .3 + 14); ix = ox - side * gap; laneFor = anc;
      }
      // 送禮物：送的那隻走到收禮的那隻面前（收禮的不動）
      const gift = !!this.soc.gift;
      if (gift && !anc) { ix = O.x - side * gap; ox = O.x; }
      // 螢幕邊放不下時，整組往內挪
      if (ix < 44) { ix = 44; ox = ix + side * gap; } else if (ix > W - 44) { ix = W - 44; ox = ix + side * gap; }
      else if (ox < 44) { ox = 44; ix = ox - side * gap; } else if (ox > W - 44) { ox = W - 44; ix = ox - side * gap; }
      if (ox < 40 || ox > W - 40) return false;
      // 任何走位都不穿過第三隻：兩隻要走的路上（含站位）有別隻 → 先請待機的那隻讓路（跳到這一段的外側；
      // 要越過這兩隻其中一隻時走靠鏡頭那一道、畫在前面繞過去）；正在忙的就等牠；等太久（7 秒）才取消
      const lo = Math.min(I.x, O.x, ix, ox) - S.POLITE - 4, hi = Math.max(I.x, O.x, ix, ox) + S.POLITE + 4;   // 路上和兩隻的站位附近（禮貌距離內）有別隻：請牠讓開
      const all = [...S.actors.values()].filter((o) => !o.inPouch && Math.abs(o.y - I.y) <= 40);
      let blocked = false, n = 0;
      const passBy = [];                                  // 送禮物時路上的別隻：不等牠讓路，從牠前面（靠鏡頭那一道）繞過去
      for (const o of all) {
        if (o === I || o === O || o === laneFor) continue;
        if (o.isFollow && (momOf(o) === I || momOf(o) === O)) continue;                  // 自己的小袋鼠會跟著讓開
        if (!(o.x > lo && o.x < hi)) continue;
        if (gift && Math.abs(o.x - O.x) > S.POLITE) { passBy.push(o); continue; }
        if (o.job && o.job.name === 'yield' && o.job.mover === I) { if (!o.job.ready) blocked = true; continue; }   // 已經往後退一步讓路了
        blocked = true;
        if (o.job || o.mode !== 'awake' || o.isFollow) continue;
        // 讓路：往後退一小步（不再跳到這一段的外側，免得走很遠、從球上或別隻旁邊經過）；兩隻互動完才跳回來
        const duet = this;
        o.requestActivity(6, yieldJob(o, I, null, I.x, { avoid: [ix, ox], busy: () => !duet.over && !!I.job && I.job.duet === duet }));
        n++;
      }
      if (blocked) return 'wait';
      if (laneFor && (laneFor.x - I.x) * (laneFor.x - ix) <= 0) return false;            // 爸爸的路上還是會碰到媽媽：取消
      if (ox < 40 || ox > W - 40) return false;
      this.gap = gap; this.t0 = now;
      const ig = new Set([I, O]);
      // 走到一半有別隻走進來擋路：停下、取消。游標不算擋路（不然滑鼠停在旁邊，互動一開始就被取消）
      const chk = (who) => (nx, d) => !who.blocked(nx, d, new Set([I, O, ...(laneFor ? [laneFor] : []), ...passBy]), null, { cursor: false });
      this.mI = Math.abs(ix - I.x) > 3 ? I.mover(ix, { ignore: ig, tol: 1.5, check: chk(I), lane: passBy.length ? passBy : null, gait: (rem) => (S.CRAWL && rem < 64 * I.k ? 'walk' : 'hop') }) : null;
      this.mO = Math.abs(ox - O.x) > 3 ? O.mover(ox, { ignore: ig, tol: 1.5, gait: 'hop', lane: laneFor ? [laneFor] : null, check: laneFor ? null : chk(O) }) : null;
      this.waitTurn = this.mO ? null : O.smoothTo(-side * 60, {}, 280);
      return true;
    }
    step(now) {
      if (this.last === now) return; this.last = now;
      try { this.step2(now); } catch (e) { console.warn('互動出錯，取消這一輪：' + this.type, e); this.cancel(this.I, 'error'); }
    }
    step2(now) {
      const I = this.I, O = this.O;
      if (this.phase === 'approach') {
        if (this.t0 == null) {
          if (this.clearT0 == null) this.clearT0 = now;
          if (now - (this.lastBegin || 0) < 240) return;                               // 等別隻讓路時，每 0.24 秒再看一次
          this.lastBegin = now;
          const r = this.begin(now);
          if (r === 'wait') { if (now - this.clearT0 > 7000) this.cancel(I, 'busy'); return; }
          if (!r) { this.cancel(I, 'busy'); return; }
        }
        if (Math.abs(I.y - O.y) > 40) { this.cancel(I, 'user'); return; }                 // 地面高度不同了：取消
        const a = this.mI && this.mI.tick(now), b = this.mO && this.mO.tick(now);
        if (this.waitTurn && !this.waitTurn.tick(now)) this.waitTurn = null;              // 對方：轉向走過來的那隻，等著
        if (now - this.t0 > 20000) { this.cancel(I, 'work'); return; }
        if ((this.mI && this.mI.blocked) || (this.mO && this.mO.blocked)) { this.cancel(I, 'busy'); return; }
        if (a || b) return;
        O.depth = 0; O.zBoost = 0; O.place();
        if (this.soc.gift) { I.depth = 0; I.zBoost = 0; I.place(); }          // 送禮物從別隻前面繞過來：到了回到地面線
        const side = O.x >= I.x ? 1 : -1;
        this.tI = I.smoothTo(side * SOC.TH0, {}, 300); this.tO = O.smoothTo(-side * SOC.TH0, {}, 300);
        this.phase = 'turn';
      }
      if (this.phase === 'turn') {
        const a = this.tI.tick(now), b = this.tO.tick(now);
        if (a || b) return;
        this.startPlay(now);
      }
      if (this.phase === 'play') this.playTick(now);
    }
    startPlay(now) {
      const I = this.I, O = this.O;
      this.ctx = this.ctxFor();
      try { this.sc = this.T.build(this.ctx); } catch (e) { console.error('互動劇本建立失敗', e); this.cancel(I, 'user'); return; }
      this.phase = 'play'; this.p0 = now; this.lastDraw = 0; this.frames = 0;
      this.el = document.createElement('div'); this.el.className = 'duet';
      S.stageEl.appendChild(this.el);
      this.view = new DuetView(this.el); this.lastShape = 0; this.slowN = 0; this.throttle = false; this.lastTickAt = 0;
      for (const a of [I, O]) { a.hideLive(); a.duetOn = true; a.el.classList.add('in-duet'); }
      S.duets.add(this);
    }
    playTick(now) {
      const I = this.I, O = this.O, sc = this.sc, t = (now - this.p0) / 1000;
      if (sc.handoff && !this.handed && t >= sc.handoff.t) this.handoff();
      if (now - this.lastDraw >= S.frameGap || t >= sc.dur) {
        this.lastDraw = now;
        const c0 = performance.now();
        const fr = sc.at(Math.min(t, sc.dur));
        this.lastFr = fr;
        if (this.handed && fr.world) fr.world = fr.world.filter((w) => w.k !== 'vball' && w.k !== 'bball').map((w) => (w.k === 'hoop' ? { ...w, o: Math.min(1, t * 3) } : w));   // 球交給舞台後籃框不淡出：等撿完球才收
        // 常駐層：眨眼
        if (ANIM.ambient) for (const [key, a] of [['a', I], ['b', O]]) { const am = ANIM.ambient(now / 1000, a.seed, { still: false }); if (am.blink) fr[key].pose.blink = Math.max(fr[key].pose.blink || 0, am.blink); }
        this.ctx.b.oy = O.y - I.y;
        // 畫面吃力（最近幾格平均超過 18.5 ms）：圖形改成每 33 ms 重建一次，位移照樣每格（之後這一輪都維持，不來回切）
        const gapMs = this.lastTickAt ? Math.min(100, now - this.lastTickAt) : 16.7; this.lastTickAt = now;
        this.gapAvg = this.gapAvg == null ? 16.7 : this.gapAvg * .85 + gapMs * .15;
        if (++this.frames > 6 && this.gapAvg > 18.5 && S.fps >= 45 && !S.duetFull) this.throttle = true;
        // 吃力時：兩隻輪流重建圖形（每隻每 2 格一次＝每秒 30 次），每一格的工作量減半；位移、球、影子照樣每格更新
        const shape = true, opts = { ground: I.y, id: 'D' + this.uid };
        if (this.throttle && t < sc.dur) { this.turnKey = this.turnKey === 'a' ? 'b' : 'a'; opts.only = this.turnKey; }
        const res = SOC.composeParts(this.ctx, fr, opts), c1 = performance.now();
        S.prof(opts.only ? 'duet.pose+svg(1隻)' : 'duet.pose+svg', c1 - c0);
        const st = this.el.style, z = String(Math.round(Math.max(I.y, O.y)) + 1);
        if (st.zIndex !== z) { st.zIndex = z; st.left = '0px'; st.top = '0px'; st.width = innerWidth + 'px'; st.height = innerHeight + 'px'; }
        this.view.draw(res);
        this.pos = this.pos || {};
        for (const k of ['a', 'b']) this.pos[k] = res.parts[k].shape ? res.pos[k] : { ...(this.pos[k] || {}), x: res.pos[k].x, th: res.pos[k].th };
        S.prof(opts.only ? 'duet.dom(1隻)' : 'duet.dom', performance.now() - c1);
        for (const [key, a] of [['a', I], ['b', O]]) {
          const nx = res.pos[key].x;
          a.x = nx; a.place();
        }
        const cost = performance.now() - c0;
        this.cost = this.cost == null ? cost : this.cost * .9 + cost * .1;
      }
      if (t >= sc.dur) this.finish();
    }
    // 扣球／投籃沒進：球交給舞台做物理，由負責的那隻去撿
    handoff() {
      const h = this.sc.handoff, I = this.I, owner = h.owner === 'a' ? I : this.O, side = this.ctx.side;
      this.handed = true;
      owner.throwX = owner.x;
      const b = new S.Ball(owner, h.kind, this.ctx.a.x0 + side * h.u, I.y - h.h, side * h.vu, -h.vh, null);
      if (h.from) b.noHit = new Set([h.from === 'a' ? I : this.O]);                       // 剛離手：不算打到出手的那隻
      b.coop = true; b.k = this.ctx.kk; b.G = 1500 * this.ctx.kk; b.r = 12 * this.ctx.kk; b.size = Math.round(32 * this.ctx.kk); b.el.style.width = b.el.style.height = b.size + 'px'; b.place();
      this.ball = b;
    }
    teardown() {
      if (this.el) { this.el.remove(); this.el = null; }
      if (S.unslim) S.unslim(['D' + this.uid + 'a' + this.I.uid, 'D' + this.uid + 'b' + this.O.uid]);
      S.duets.delete(this);
      for (const a of [this.I, this.O]) { a.duetOn = false; a.el.classList.remove('in-duet'); }
    }
    endTh(key) { const p = this.pos && this.pos[key]; return p ? Math.round(p.th / 15) * 15 : null; }
    finish() {
      const I = this.I, O = this.O;
      this.over = true;
      for (const [key, a] of [['a', I], ['b', O]]) { const th = this.endTh(key); if (th != null) a.th = S.clamp(th, -90, 90); a.nextAt = Math.max(a.nextAt, performance.now() + 6000 + Math.random() * 6000); }
      this.teardown();
      if (this.ball && !this.ball.gone) this.ball.owner.throwX = this.ball.owner.x;       // 撿完球回到互動結束時站的地方
      // 球還在外面（要去撿）：籃框留在原地，等撿完、收好球才淡出（不會比球先消失）
      const hoop = this.ball && !this.ball.gone && this.lastFr && (this.lastFr.world || []).find((w) => w.k === 'hoop');
      if (hoop) keepProp(SOC.worldItem({ ...hoop, o: 1 }, this.ctx.a.x0, I.y, this.ctx.kk, this.ctx.side), Math.round(Math.min(I.y, O.y)) - 60, this.ball);
      S.api.socialDone(this.soc.pairId, true, this.soc.type);
      for (const [a, job] of [[O, this.jobO], [I, this.jobI]]) if (a.job === job) a.finish(job, { rest: true });
    }
    // 出錯時由共用迴圈呼叫（a 的活動已經被拿掉）：照被打斷處理
    fail(a) { this.interrupted(a, 'error'); }
    // 還沒開始就取消（走不到、路上有別隻、地面不同）
    cancel(by, reason) {
      if (this.over) return;
      this.over = true; this.teardown();
      if (this.ball && !this.ball.gone && !this.ball.stopped) this.ball.fade();
      for (const a of [this.I, this.O]) { a.depth = 0; a.zBoost = 0; }
      S.api.socialAbort(this.soc.pairId, by.id, reason);
      for (const [a, job] of [[this.O, this.jobO], [this.I, this.jobI]]) if (a.job === job) { a.th = Math.round(a.th / 15) * 15; a.finish(job, { rest: true }); }
    }
    // 其中一隻被更高層的活動打斷（a 的工作已經被換掉了）
    interrupted(a, reason) {
      if (this.over) return;
      const why = reason === 'drag' ? 'drag' : reason === 'ring' ? 'alert' : /^react/.test(reason || '') ? 'work' : 'user';
      const wasPlay = this.phase === 'play', other = a === this.I ? this.O : this.I, oj = a === this.I ? this.jobO : this.jobI;
      const thA = this.endTh(a === this.I ? 'a' : 'b'), thO = this.endTh(a === this.I ? 'b' : 'a');
      this.over = true; this.teardown();
      if (this.ball && !this.ball.gone && !this.ball.stopped) this.ball.fade();           // 一起打球被打斷：球淡出
      if (thA != null) a.th = S.clamp(thA, -90, 90);
      a.zBoost = 0; a.depth = 0;
      // 依偎、靠著打盹被打斷：先起身 0.4 秒再處理（拖曳、響鈴不等）
      if (wasPlay && (this.type === 'cuddle' || this.type === 'leanNap') && reason !== 'drag' && reason !== 'ring' && reason !== 'error' && reason !== 'remove' && this.lastFr && !S.reduceMotion) {
        const c = SOC.real(this.ctx, a === this.I ? 'a' : 'b', this.lastFr[a === this.I ? 'a' : 'b']), t0 = performance.now();
        const an = { dur: .4, follow: false, keys: [{ t: 0, th: c.th, pose: { ...c.pose, props: undefined } }, { t: .4, th: a.th, pose: { eyes: 'wide' } }] };
        let last = 0;
        a.preAnim = { until: t0 + 200, tick(now) { const t = (now - t0) / 1000; if (now - last >= S.LIVE_MS) { last = now; const sm = ANIM.sample(an, Math.min(t, .4)); a.drawLive(sm.th, { ...sm.pose, noAmbient: true }); } if (t >= .4) { a.hideLive(); return false; } return true; } };
      }
      S.api.socialAbort(this.soc.pairId, a.id, why);
      if (other.job === oj) { if (thO != null) other.th = S.clamp(thO, -90, 90); this.startOutro(other, oj, a, why, wasPlay); }
    }
    // 主行程叫停（social:abort）：兩隻都收尾
    stop() {
      if (this.over) return;
      const wasPlay = this.phase === 'play', thI = this.endTh('a'), thO = this.endTh('b');
      this.over = true; this.teardown();
      if (this.ball && !this.ball.gone && !this.ball.stopped) this.ball.fade();
      if (thI != null) this.I.th = S.clamp(thI, -90, 90);
      if (thO != null) this.O.th = S.clamp(thO, -90, 90);
      if (this.I.job === this.jobI) this.startOutro(this.I, this.jobI, this.O, 'main', wasPlay);
      if (this.O.job === this.jobO) this.startOutro(this.O, this.jobO, this.I, 'main', wasPlay);
    }
    // 夥伴的收尾（0.5–0.8 秒）：抬頭目送（被拖走）／看對方一眼（響鈴）／「咦？」／頭一歪醒來（依偎、打盹）
    startOutro(a, job, other, why, wasPlay) {
      const th = Math.round(a.th), toward = other.x >= a.x ? 1 : -1, sleepy = wasPlay && (this.type === 'leanNap' || this.type === 'cuddle' || this.type === 'sunbathe');
      const couple = a.attach.partner === other.id, yaw = S.clamp(toward * 70 - th, -50, 50);
      let keys, dur;
      if (S.reduceMotion) { a.finish(job, { rest: true }); return; }
      if (sleepy) { dur = .75; keys = [{ t: 0, th, pose: { head: { roll: toward * 12, pitch: 8 }, eyes: 'closed' } }, { t: .22, th, pose: { head: { roll: -toward * 8, pitch: -4 }, eyes: 'wide', mouth: 'o', sq: 1.04, earFlop: { L: -8, R: -8 } }, ease: 'out' }, { t: .45, th, pose: { head: { roll: -toward * 3, yaw }, eyes: 'wide', blink: 1, mouth: 'o' } }, { t: .75, th, pose: { head: { yaw: yaw * .6 }, eyes: 'open' } }]; }
      else if (why === 'drag') { dur = .8; keys = [{ t: 0, th, pose: {} }, { t: .2, th, pose: { head: { pitch: -18, yaw }, eyes: couple ? 'sad' : 'wide', mouth: 'o', look: [toward * 1.5, -2], sq: 1.03 }, ease: 'out' }, { t: .62, th, pose: { head: { pitch: -20, yaw }, eyes: couple ? 'sad' : 'wide', mouth: 'o', look: [toward * 1.5, -2], sq: 1.02 } }, { t: .8, th, pose: { head: { pitch: -6, yaw: yaw * .4 } } }]; }
      else if (!wasPlay) { dur = .8; keys = [{ t: 0, th, pose: {} }, { t: .22, th, pose: { head: { yaw, pitch: -3 }, eyes: 'open', look: [toward * 2, 0] } }, { t: .62, th, pose: { head: { yaw, pitch: -3 }, eyes: 'open', look: [toward * 2, 0] } }, { t: .8, th, pose: {} }]; }
      else { dur = .58; keys = [{ t: 0, th, pose: {} }, { t: .16, th, pose: { head: { roll: toward * 10, yaw: yaw * .7, pitch: -4 }, eyes: 'wide', mouth: 'o', sq: 1.03, earFlop: { L: -6, R: -6 } }, ease: 'out' }, { t: .42, th, pose: { head: { roll: toward * 11, yaw: yaw * .7, pitch: -4 }, eyes: 'wide', mouth: 'o' } }, { t: .58, th, pose: {} }]; }
      job.outro = { anim: { dur, keys, follow: false }, t0: performance.now(), last: 0, worry: why === 'drag' && couple };
      // 並肩散步被打斷：在原地等對方最多 10 秒，對方回到待機就靠過去會合，逾時自己回家
      if (wasPlay && this.type === 'walkTogether' && why !== 'main') job.end = () => { a.zBoost = 0; setTimeout(() => S.family.waitFor(a, other), 0); };
      if (job.outro.worry) { const p = a.toStage(80 + toward * 26, 26); S.burst(p.x, p.y, 'worry'); }
      S.kick();
    }
    outroTick(a, job, now) {
      const o = job.outro, t = (now - o.t0) / 1000;
      a.depth = 0;
      if (now - o.last >= S.LIVE_MS) { o.last = now; const s = ANIM.sample(o.anim, Math.min(t, o.anim.dur)); a.drawLive(s.th, { ...s.pose, noAmbient: true }); }
      return t < o.anim.dur;
    }
  }
  // 場景道具（籃框）在互動結束後留在舞台上：球被撿回來收好（或球不見了）之後 0.7 秒淡出
  function keepProp(svg, z, ball) {
    const d = document.createElement('div'); d.className = 'kept-prop';
    d.style.cssText = `position:absolute;left:0;top:0;width:${innerWidth}px;height:${innerHeight}px;pointer-events:none;z-index:${z};transition:opacity .7s ease`;
    d.innerHTML = `<svg viewBox="0 0 ${innerWidth} ${innerHeight}" width="${innerWidth}" height="${innerHeight}" aria-hidden="true">${SOC.worldDefs()}${svg}</svg>`;
    S.stageEl.appendChild(d);
    const t0 = performance.now();
    const poll = () => {
      const o = ball.owner, busy = !ball.gone || (o && o.job && o.job.name === 'fetch');
      if (busy && performance.now() - t0 < 60000 && S.actors.has(o.id)) { setTimeout(poll, 250); return; }
      d.style.opacity = '0'; setTimeout(() => d.remove(), 800);
    };
    setTimeout(poll, 250);
  }
  S.Duet = Duet;
  S.COUPLE_TYPES = COUPLE;

  // social:start
  S.startSocial = function (p) {
    const A = S.actors.get(p.a), B = S.actors.get(p.b), api = S.api;
    if (!A || !B || A === B || A.inPouch || B.inPouch) { api.socialAbort(p.pairId, p.a, 'user'); return null; }
    if (Math.abs(A.y - B.y) > 40) { api.socialAbort(p.pairId, p.a, 'user'); return null; }       // 不在同一地面
    const soc = { pairId: p.pairId, a: p.a, b: p.b, type: S.str(p.type, 30), initiator: p.initiator === p.b ? p.b : p.a, anchor: p.anchor || null, gift: !!p.gift };
    const I = soc.initiator === p.a ? A : B, O = I === A ? B : A;
    if (S.reduceMotion) { api.socialDone(soc.pairId, true, soc.type); return null; }
    const d = new Duet(soc, I, O);
    // 進不去的理由：響鈴／拖曳＝alert，工作反應或使用者叫的＝work，其他（名額滿了、正在做別的小事）＝busy（不加好感）
    const why = (a) => (a.layer <= 1 ? 'alert' : a.layer <= 3 ? 'work' : 'busy');
    if (!I.requestActivity(5, d.jobI)) { api.socialAbort(soc.pairId, I.id, why(I)); return null; }
    if (!O.requestActivity(5, d.jobO)) { const w = why(O); d.over = true; if (I.job === d.jobI) I.finish(d.jobI, { rest: false }); api.socialAbort(soc.pairId, O.id, w); return null; }
    S.kick();
    return d;
  };

  // =====================================================================================
  // 避讓（規格 6.3）：有誰要從 x0 走到 x1（撿球），路上站著別隻 →
  //   待機中的那隻「橫向跳開」到整條路線（去撿球＋抱回來）的外側、和撿球的保持禮貌距離，撿球的不會穿過牠的身體；
  //   兩側都沒有空間（螢幕邊、別隻佔住）才退而求其次：往畫面裡退一大步（畫在後面），撿球的從牠前面經過、撿完再跳回地面線。
  //   正在忙的（響鈴、拖曳…）讓不了，撿球的就停下來等。回傳 true＝路是空的可以走了。
  // =====================================================================================
  S.avoid = null;
  S.clearPath = function (mover, x0, x1, pad = 50, route) {
    const dir = Math.sign(x1 - x0) || 1, lo = Math.min(x0 + dir * 24, x1 + dir * pad), hi = Math.max(x0 + dir * 24, x1 + dir * pad);
    let clear = true;
    const all = [...S.actors.values()].filter((o) => o !== mover && !o.inPouch && Math.abs(o.y - mover.y) <= 40);
    const ballX = mover.ball && !mover.ball.gone ? mover.ball.x : x1;
    for (const o of all) {
      if (o.isFollow && momOf(o) === mover) continue;
      if (o.job && o.job.name === 'yield' && o.job.mover === mover) { if (!o.job.ready) clear = false; continue; }   // 已經讓開了（跳到路線外，或退到後面）
      if (o.x < lo || o.x > hi) continue;
      clear = false;
      if (o.job || o.mode !== 'awake' || o.isFollow) continue;                            // 正在忙：等牠
      o.requestActivity(6, yieldJob(o, mover, ballX, x0, { route: route || [Math.min(x0, x1), Math.max(x0, x1)] }));
    }
    return clear;
  };
  // 讓路：看一眼 → 橫向小跳到路線外（一兩步）→ 轉頭看撿球的；沒空間時改成往後退一大步（depth）→ 等撿完 → 跳回地面線
  function yieldJob(o, mover, ballX, fromX, opt = {}) {
    const k = o.k, D = 64 * k, HOP = 460;
    const gapM = S.politeGap(o, mover) + 6;
    // 撿球的會停在球前面 88 單位（站位）
    const standX = ballX == null ? null : ballX - (Math.sign(ballX - fromX) || 1) * 88 * mover.k;
    const r0 = Math.min(...[fromX, standX, ...(opt.route || []), ...(opt.avoid || [])].filter((v) => v != null)), r1 = Math.max(...[fromX, standX, ...(opt.route || []), ...(opt.avoid || [])].filter((v) => v != null));
    const ign = new Set([mover]);
    // 橫向：路線兩側各往外找，不能越過任何一隻（不從別隻身上穿過去；地上的球可以跳過去）、要在螢幕內、和其他隻保持禮貌距離；挑要跳最近的
    let side = null;
    const bodies = [...S.actors.values()].filter((q) => q !== o && !q.inPouch && Math.abs(q.y - o.y) <= 40);
    for (const c of [r0 - gapM, r1 + gapM]) {
      const sgn = c < r0 ? -1 : 1;
      for (let x = c; x > 44 && x < innerWidth - 44 && Math.abs(x - o.x) < 420; x += sgn * 8) {
        if (bodies.some((q) => (q.x - o.x) * (q.x - x) < 0)) break;                         // 要越過別隻：這一側不行
        if (ballX != null && Math.abs(x - ballX) < 60 * k) continue;
        if (!S.politeOk(o, x, { ignore: ign })) continue;
        if (!side || Math.abs(x - o.x) < Math.abs(side - o.x)) side = x;
        break;
      }
    }
    const job = { name: 'yield', ticks: true, mover, ready: false, phase: 'look', lateral: side != null };
    let p0 = 0, x0 = 0, d0 = 0, sub = null, m = null;
    const hopDir = side != null ? Math.sign(side - o.x) || 1 : (Math.sign(o.x - mover.x) || 1);
    job.start = (now) => { p0 = now; o.sideTo = side != null ? side : o.x; o.lookBucket = mover.x < o.x ? 'L' : 'R'; o.showRest(); o.lookBucket = null; };
    job.tick = (now) => {
      switch (job.phase) {
        case 'look': if (now - p0 > 200) { job.phase = side != null ? 'side' : 'hop'; p0 = now; x0 = o.x; d0 = o.depth; if (side != null) m = o.mover(side, { gait: 'hop', tol: 2, speed: 1.15, ignore: ign }); } return true;
        case 'side': {                                                    // 橫向跳開（一步一步，不滑步）
          if (m.tick(now)) return true;
          job.ready = true; job.phase = 'turn'; o.home = o.x; sub = o.smoothTo((mover.x < o.x ? -1 : 1) * 30, {}, 200); return true;
        }
        case 'hop': {                                                     // 沒有空間：往後退一大步（畫在後面）
          const u = Math.min(1, (now - p0) / HOP), e = EASE.io(u);
          o.gaitFrame('hop', hopDir, u);
          o.depth = d0 + (D - d0) * e; o.zBoost = -40; o.place();
          if (u >= 1) { job.ready = true; job.phase = 'turn'; sub = o.smoothTo((mover.x < o.x ? -1 : 1) * 30, {}, 200); }
          return true;
        }
        case 'turn': if (sub.tick(now)) return true; job.phase = 'wait'; p0 = now; return true;
        case 'wait': {                                                    // 撿完（或放棄）才結束；往後退的才跳回地面線
          const busy = opt.busy ? opt.busy() : mover.job && mover.job.name === 'fetch' && S.actors.has(mover.id);
          if (busy && now - p0 < 25000) return true;
          if (side != null) { sub = o.smoothTo(-15, {}, 200); job.phase = 'end'; return true; }
          job.phase = 'back'; p0 = now; x0 = o.x; d0 = o.depth; return true;
        }
        case 'back': {                                                    // 跳回地面線
          const u = Math.min(1, (now - p0) / HOP), e = EASE.io(u);
          o.gaitFrame('hop', -hopDir, u);
          o.depth = d0 * (1 - e); o.place();
          if (u >= 1) { o.depth = 0; o.zBoost = 0; o.place(); sub = o.smoothTo(-15, {}, 200); job.phase = 'end'; }
          return true;
        }
        case 'end': return sub.tick(now);
      }
      return false;
    };
    // 被別的事打斷（拖曳會自己把 depth 歸零）：留在後面那條線上，等有空再自己跳回來
    job.interrupt = (why) => { o.sideTo = null; if (why === 'drag') { o.depth = 0; o.zBoost = 0; } else if (o.depth > 0) returnLater(o); };
    job.end = () => { o.sideTo = null; o.depth = 0; o.zBoost = 0; o.home = o.x; o.th = Math.round(o.th / 15) * 15; };
    job.endOpts = { rest: true };
    return job;
  }
  function returnLater(o) {
    clearTimeout(o.backT);
    o.backT = setTimeout(function poll() {
      if (!S.actors.has(o.id) || !(o.depth > 0)) return;
      if (o.job || o.mode !== 'awake') { o.backT = setTimeout(poll, 600); return; }
      const d0 = o.depth, job = { name: 'yieldBack', ticks: true };
      job.start = (now) => { job.p0 = now; };
      job.tick = (now) => { const u = Math.min(1, (now - job.p0) / 420); o.gaitFrame('hop', o.th >= 0 ? 1 : -1, u); o.depth = d0 * (1 - EASE.io(u)); o.place(); return u < 1; };
      job.end = job.interrupt = () => { o.depth = 0; o.zBoost = 0; o.place(); };
      if (!o.requestActivity(6, job)) o.backT = setTimeout(poll, 600); else S.kick();
    }, 600);
  }


  // =====================================================================================
  // 通則：任何兩隻（非情侶、非跟隨期的母子）靜止時身體不得重疊。
  // 偵測到重疊超過 2 秒 → 比較閒的那隻自己跳到空位。只在有活動結束、放下、名單變動之後檢查（平常不跑計時器）
  // =====================================================================================
  let ovT = 0;
  const ovSince = new Map();
  const OVERLAP = 92;                                           // 腳底相距小於這麼多 px（乘體型）＝太近（禮貌距離 S.POLITE）
  S.checkOverlapSoon = function (ms = 1100) { if (!ovT) ovT = setTimeout(checkOverlap, ms); };
  function checkOverlap() {
    ovT = 0;
    if (S.mode !== 'awake') return;
    const now = performance.now(), list = [...S.actors.values()].filter((a) => !a.inPouch && a.mode === 'awake' && !a.dragging);
    const seen = new Set();
    let again = false;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (Math.abs(a.y - b.y) > 40 || F.close(a, b)) continue;
      if (Math.abs(a.x - b.x) >= S.politeGap(a, b, OVERLAP)) continue;
      if (a.job && b.job && a.job.duet && a.job.duet === b.job.duet) continue;             // 正在一起互動：由劇本決定距離
      const key = a.id + '|' + b.id;
      seen.add(key); again = true;
      if (!ovSince.has(key)) { ovSince.set(key, now); continue; }
      if (now - ovSince.get(key) < 2000) continue;
      const free = [a, b].filter((x) => !x.job && !x.isFollow);
      if (!free.length) continue;                                                          // 兩隻都在忙：等牠們忙完
      // 兩隻都閒：讓離空位比較近的那隻走
      const dist = (x) => { const sp = x.freeSpot(100); return sp ? Math.abs(sp.x - x.x) + (sp.cross ? 200 : 0) : 1e9; };
      free.sort((p, q) => dist(p) - dist(q));
      if (free[0].stepAway(OVERLAP)) ovSince.delete(key);
    }
    for (const k of [...ovSince.keys()]) if (!seen.has(k)) ovSince.delete(k);
    if (again) ovT = setTimeout(checkOverlap, 700);
  }

  // =====================================================================================
  // 育兒袋（懷孕、育兒袋期探頭的小袋鼠、被拖走時鑽回袋裡的跟隨期小袋鼠）：畫在媽媽身體和前爪之間
  // =====================================================================================
  const pouchJoeys = new Map();                                // 媽媽 id → 育兒袋期小袋鼠的資料
  const lip = (cx, y, w) => `<path d="M${(cx - w).toFixed(1)} ${y.toFixed(1)} Q${cx.toFixed(1)} ${(y + 9).toFixed(1)} ${(cx + w).toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="#c9a77c" stroke-width="4.6" stroke-linecap="round" opacity=".95"/><path d="M${(cx - w).toFixed(1)} ${(y + 1.5).toFixed(1)} Q${cx.toFixed(1)} ${(y + 10.5).toFixed(1)} ${(cx + w).toFixed(1)} ${(y + 1.5).toFixed(1)}" fill="none" stroke="#8a6a4a" stroke-width="1" opacity=".45"/>`;
  function decoState(a) {
    const pj = pouchJoeys.get(a.id) || null;
    if (!a.attach.pregnant && !pj && !a.carried) return null;
    const hide = a.dragging || a.mode !== 'awake' || a.joeyHide;
    return { pj, carried: a.carried || null, out: a.carried ? true : (pj ? !hide : false) };
  }
  S.deco = function (a, th, pose, id) {
    const st = decoState(a);
    if (!st) return '';
    const c = Math.cos(th * Math.PI / 180);
    if (c < -.2) return '';                                     // 背對：看不到肚子
    const P = SOC.pt(th, pose, SOC.BELLY, false), w = 5 + 14 * Math.max(0, c), X = P.X, Y = P.Y - 1;
    let joey = '';
    const J = st.carried ? { tr: st.carried.traits, s: .34, seed: st.carried.uid } : st.pj ? { tr: st.pj.traits, s: .3, seed: 3 } : null;
    if (J && st.out) {
      // 小袋鼠只露出袋口以上的頭，跟著媽媽看的方向轉
      const yaw = (pose.head && pose.head.yaw) || 0, jth = S.clamp(th + yaw * .8 + ((pose.look && pose.look[0]) || 0) * 6, -80, 80);
      S.ART.configure(J.tr);
      let js = S.POSE.render(jth, id + 'j', { headScale: 1.4, eyes: st.carried ? 'happy' : 'open', mouth: 'smile', blush: 1.4, look: [((pose.look && pose.look[0]) || 0), -1], accessory: 'none' }).svg;
      S.ART.configure(null);
      js = js.replace(/<ellipse cx="80\.0" cy="183"[^>]*>/, '');                          // 不要影子
      joey = `<clipPath id="pc${id}"><rect x="${(X - 60).toFixed(1)}" y="${(Y - 90).toFixed(1)}" width="120" height="${(90 + 3).toFixed(1)}"/></clipPath><g clip-path="url(#pc${id})"><g transform="translate(${X.toFixed(1)} ${(Y + 27 * J.s / .3).toFixed(1)}) scale(${J.s}) translate(-80 -183)">${js}</g></g>`;
    }
    const bulge = `<ellipse cx="${X.toFixed(1)}" cy="${(Y + 9).toFixed(1)}" rx="${(w + 3).toFixed(1)}" ry="8" fill="#f6ead2" opacity=".45"/>`;
    return bulge + joey + lip(X, Y, w);
  };

  // =====================================================================================
  // 家族：跟隨期的小袋鼠、媽媽被拖走、長大、情侶待機
  // =====================================================================================
  const F = S.family = {};
  const momOf = (j) => S.actors.get(j.attach.mom) || S.actors.get(j.attach.dad) || null;
  const joeysOf = (m) => [...S.actors.values()].filter((j) => j.isFollow && momOf(j) === m);
  F.partnerOf = (a) => (a.attach.partner ? S.actors.get(a.attach.partner) || null : null);
  // 不用保持禮貌距離的對象：伴侶、自己跟隨期的小袋鼠和媽媽
  F.flirtOf = (a) => (a.attach.flirt && !a.attach.partner ? S.actors.get(a.attach.flirt) || null : null);
  F.close = (a, o) => a.attach.partner === o.id || o.attach.partner === a.id || a.attach.flirt === o.id || o.attach.flirt === a.id || (a.isFollow && momOf(a) === o) || (o.isFollow && momOf(o) === a);
  F.setPouch = function (list) {
    const old = new Map(pouchJoeys); pouchJoeys.clear();
    for (const q of list) if (q && q.mom) pouchJoeys.set(q.mom, q);
    for (const id of new Set([...old.keys(), ...pouchJoeys.keys()])) { const m = S.actors.get(id); if (m) F.refresh(m, true); }
  };
  // 外觀附加狀態變了：換快取鍵，待機圖重畫
  F.refresh = function (a, redraw) {
    const st = decoState(a), old = a.decoKey || '';
    a.decoKey = st ? `|p${st.pj ? st.pj.id : ''}${st.carried ? 'c' + st.carried.id : ''}${st.out ? 'o' : 'i'}` : '';
    if (st && st.pj && !a.peekT && a.mode === 'awake' && S.mode === 'awake') F.peekLoop(a);
    if (redraw && old !== a.decoKey && !a.job && a.img) { a.showRest(); }
    return old !== a.decoKey;
  };
  // 育兒袋期：偶爾縮回去再探出來（計時器，不跑迴圈）
  F.peekLoop = function (a) {
    const tick = () => {
      a.peekT = 0;
      if (!S.actors.has(a.id) || !pouchJoeys.get(a.id)) return;
      if (a.mode !== 'awake' || S.mode !== 'awake') return;                               // 睡覺、隱藏時停掉（醒來由 F.refresh 再啟動）
      if (a.joeyHide) { a.joeyHide = false; F.refresh(a, true); a.peekT = setTimeout(tick, 9000 + Math.random() * 14000); }
      else { a.joeyHide = true; F.refresh(a, true); a.peekT = setTimeout(tick, 2200 + Math.random() * 2200); }
    };
    a.peekT = setTimeout(tick, 7000 + Math.random() * 9000);
  };
  // 媽媽（或任何一隻）被拎起來
  F.lifted = function (a) {
    F.refresh(a);
    for (const j of joeysOf(a)) F.intoPouch(j, a);
    if (a.isFollow) { /* 小袋鼠自己被拖走：放下後自己跳回媽媽身邊 */ }
  };
  // 鑽回育兒袋：跳起來、往媽媽的袋口撲進去（畫在媽媽後面，被肚子擋住就看不到了），之後由媽媽的圖畫出探頭的小袋鼠
  F.intoPouch = function (j, mom) {
    if (j.inPouch || j.pouching) return;
    if (mom && !S.reduceMotion && j.mode === 'awake' && S.mode === 'awake' && j.requestActivity(0, F.pouchJob(j, mom, 'in'))) { S.kick(); return; }
    F.pouchNow(j, mom);
  };
  F.pouchNow = function (j, mom) {
    if (j.inPouch) return;
    if (j.job) { const job = j.job; j.job = null; job.interrupt && job.interrupt('pouch'); j.hideLive(); j.setLayer(8); }
    j.pouching = false; j.inPouch = true; j.depth = 0; j.place();
    if (mom && !mom.attach.carryingJoey && !pouchJoeys.get(mom.id)) { mom.carried = j; mom.attach.carryingJoey = true; }
    if (mom) { F.refresh(mom); if (mom.dragging) mom.setFrame('lift', 0, ANIM.STILL.lift); else if (!mom.job) mom.showRest(); }
    // 媽媽「袋裡有小袋鼠」的那一格還在解碼：小袋鼠先留著，等那一格換上去才收起來（中間不會有空袋子的一格）
    const t0 = performance.now();
    const hide = () => { if (!j.inPouch) return; if (mom && mom.pendingSrc && performance.now() - t0 < 500) { requestAnimationFrame(hide); return; } j.el.style.display = 'none'; j.el.style.opacity = ''; j.zBoost = 0; };
    hide();
    S.reportRects();
  };
  // 爬出來：從袋口跳下來，落在媽媽後面
  F.outOfPouch = function (j, mom) {
    if (!j.inPouch) return;
    j.inPouch = false; j.el.style.display = '';
    if (mom) { if (mom.carried === j) { mom.carried = null; mom.attach.carryingJoey = false; } F.refresh(mom, true); }
    j.nextAt = performance.now() + 4000;
    if (mom && !S.reduceMotion && j.mode === 'awake' && S.mode === 'awake' && j.requestActivity(0, F.pouchJob(j, mom, 'out'))) { S.reportRects(); S.kick(); return; }
    if (mom) { j.x = mom.x + (mom.faceDir > 0 ? -1 : 1) * 14 * mom.k; j.y = mom.y; }
    j.th = -15; j.showRest(); j.place();
    const p = j.toStage(80, 60); S.burst(p.x, p.y, 'stars');
    S.reportRects(); S.kick();
  };
  // 跳進／跳出育兒袋的小跳（快取的跳躍畫格＋拋物線位移；袋口跟著媽媽移動，被拖著走也追得上）
  F.pouchJob = function (j, mom, way) {
    const into = way === 'in', dur = into ? 760 : 720;
    const pouch = () => { const p = mom.toStage(80, 150); return { x: p.x, y: p.y + 64 * j.k }; };   // 小袋鼠腳底的位置：身體在袋口
    const job = { name: 'pouch', ticks: true, joeyOk: true, endOpts: { rest: false } };
    let x0, y0, ox, oy;
    job.start = (now) => {
      job.p0 = now; j.pouching = into; j.el.classList.remove('asleep');
      if (into) { x0 = j.x; y0 = j.y; }
      else { const p = pouch(); x0 = p.x; y0 = p.y; j.x = x0; j.y = y0; j.el.style.opacity = '0'; }
      ox = x0; oy = y0;
      j.zBoost = 10200; j.place();                                                   // 畫在媽媽前面（袋口在肚子前面）：看得到牠跳上來、鑽進去
    };
    // 鑽進去：先蹲一下（看著媽媽）→ 往上跳、抓著袋口（袋口跟著被拎起來的媽媽移動，跳的弧線也跟著）→ 頭朝下鑽進袋裡
    // 爬出來：從袋口探出身體 → 跳下來落地（一開始只露出上半身，像是從袋口出來）
    const CROUCH = .16, DIVE = .82;
    job.tick = (now) => {
      const u = Math.min(1, (now - job.p0) / dur);
      const tgt = into ? pouch() : { x: F.target(j, mom), y: mom.y };
      const from = into ? { x: ox, y: oy } : pouch();
      const dir = Math.sign(tgt.x - from.x) || (mom.x > j.x ? 1 : -1);
      if (into && u < CROUCH) { j.gaitFrame('hop', dir, 0); j.x = from.x; j.y = from.y; j.place(); return true; }   // 蹲下準備跳（不動）
      const v = into ? (u - CROUCH) / (1 - CROUCH) : u, e = EASE.io(Math.min(1, into ? v / DIVE : v));
      j.gaitFrame('hop', dir, Math.min(1, into ? v / DIVE : v));
      j.x = from.x + (tgt.x - from.x) * e;
      const arc = Math.sin(Math.PI * Math.min(1, into ? v / DIVE : v)) * (into ? 46 : 30) * j.k / .5;
      j.y = from.y + (tgt.y - from.y) * e - arc + (into && v > DIVE ? (v - DIVE) / (1 - DIVE) * 14 * j.k / .5 : 0);   // 最後往下鑽進袋口
      j.el.style.opacity = into ? String(v < DIVE ? 1 : S.clamp(1 - (v - DIVE) / (1 - DIVE), 0, 1)) : String(S.clamp(u / .2, 0, 1));
      j.place();
      return u < 1;
    };
    const clean = () => { j.pouching = false; j.el.style.opacity = ''; j.zBoost = 0; j.depth = 0; };
    job.interrupt = () => { clean(); if (!into) { j.y = mom.y; j.place(); } };
    job.end = () => {
      if (into) { clean(); F.pouchNow(j, mom); return; }
      clean(); j.zBoost = 80; j.y = mom.y; j.th = (mom.x > j.x ? 1 : -1) * 45; j.home = j.x; j.place();   // 落地時還在媽媽前面那一道（和跟著走時一樣）
      const p = j.toStage(80, 60); S.burst(p.x, p.y, 'stars');
    };
    return job;
  };
  // 放下 1.5 秒後再爬出來
  F.dropped = function (a) {
    F.refresh(a);
    clearTimeout(a.outT);
    a.outT = setTimeout(() => { if (a.mode !== 'awake' || a.dragging) return; for (const j of joeysOf(a)) F.outOfPouch(j, a); }, 1500);
  };
  // 使用者離開（睡覺）：小袋鼠鑽進袋裡；回來再出來
  F.modeChanged = function (a) {
    if (a.mode !== 'awake') { clearTimeout(a.peekT); a.peekT = 0; a.joeyHide = false; }      // 探頭的計時器停掉（醒來由 F.refresh 再啟動）
    F.refresh(a, true);
    if (a.isFollow) return;
    if (a.mode !== 'awake') for (const j of joeysOf(a)) F.intoPouch(j, a);
    else { clearTimeout(a.outT); a.outT = setTimeout(() => { if (a.mode === 'awake' && !a.dragging) for (const j of joeysOf(a)) F.outOfPouch(j, a); }, 900); }
  };
  F.removed = function (a) {
    clearTimeout(a.outT);
    for (const j of S.actors.values()) if (j.isFollow && j.inPouch && j.attach.mom === a.id) { j.inPouch = false; j.el.style.display = ''; j.place(); }
    for (const m of S.actors.values()) if (m.carried === a) { m.carried = null; m.attach.carryingJoey = false; F.refresh(m, true); }
  };
  // 媽媽有工作反應：小袋鼠學媽媽做縮小版的動作
  F.momReact = function (mom, anim) {
    for (const j of joeysOf(mom)) if (!j.inPouch && !j.job && !S.reduceMotion) { const job = j.animJob('mimic', anim); job.joeyOk = true; setTimeout(() => { if (!j.job && !j.inPouch) j.requestActivity(6, job); }, 260); }
  };
  // 跟隨期的小袋鼠：媽媽走牠就跟（保持在媽媽後方 40–60 px）；媽媽響鈴時坐著看、不擋氣泡；媽媽停下時偶爾學媽媽、打滾
  F.target = function (j, mom) {
    const back = mom.faceDir > 0 ? -1 : 1, ring = mom.job && mom.job.name === 'ring';
    const d = ring ? Math.max(76, mom.w * .3 + j.w * .3 + 24) : S.clamp(mom.w * .2 + j.w * .25, 44, 60);   // 響鈴時多留 12 px（跟隨停下的容差），一定不擋媽媽的點擊範圍   // 平常在後方 40–60 px；響鈴時退到不擋媽媽的點擊範圍和氣泡
    return S.clamp(mom.x + back * d, 24, innerWidth - 24);
  };
  F.tick = function (j, now) {
    if (j.inPouch || j.job) return false;
    const mom = momOf(j);
    if (!mom) return false;
    if (mom.dragging || mom.mode !== 'awake') { F.intoPouch(j, mom); return false; }
    const tx = F.target(j, mom), far = Math.abs(tx - j.x), dy = Math.abs(mom.y - j.y);
    const momMoving = mom.job && mom.job.ticks && mom.job.name !== 'ring' && mom.job.name !== 'social';
    if (far > (momMoving ? 26 : mom.job && mom.job.name === 'ring' ? 10 : 34) || dy > 3) { j.requestActivity(7, F.followJob(j, mom)); return !!j.job; }
    // 待機：面向媽媽坐著；偶爾打滾或學媽媽
    if (now >= j.nextAt && !S.reduceMotion && S.movingCount() < S.MAX_MOVING) {
      j.nextAt = now + 14000 + Math.random() * 22000;
      if (!mom.job) { const job = Math.random() < .5 ? F.rollJob(j) : j.animJob('mimic', (ANIM.IDLE && (ANIM.IDLE.eat || ANIM.IDLE.scratch)) || ANIM.REACT.eat); job.joeyOk = true; j.requestActivity(6, job); return !!j.job; }
    }
    return false;
  };
  F.wakeAt = function (j) {
    if (j.inPouch) return Infinity;
    const mom = momOf(j);
    if (mom && Math.abs(F.target(j, mom) - j.x) > (mom.job && mom.job.name === 'ring' ? 10 : 34)) return performance.now();
    return j.nextAt;
  };
  F.followJob = function (j, mom) {
    const m = j.mover(() => F.target(j, mom), { ignore: new Set([mom]), tol: 12, regait: true, speed: 1.25, turnMs: 180, toY: () => mom.y, lane: [mom],
      gait: (rem) => (rem > 70 * j.k / .5 ? 'dash' : 'hop') });
    let sub = null;
    const job = { name: 'follow', ticks: true, joeyOk: true };
    job.tick = (now) => {
      if (mom.dragging) { F.intoPouch(j, mom); return false; }
      if (!sub && m.tick(now)) return true;
      if (!sub) { j.y = mom.y; j.depth = 0; j.zBoost = 0; j.place(); sub = j.smoothTo((mom.x > j.x ? 1 : -1) * 45, {}, 200); }   // 停下：轉向媽媽
      return sub.tick(now);
    };
    job.interrupt = () => { j.depth = 0; j.zBoost = 0; };
    job.end = () => { j.home = j.x; j.depth = 0; j.zBoost = 0; };
    job.endOpts = { rest: false };
    return job;
  };
  // 打滾：縮成一團往前翻一圈
  F.rollJob = function (j) {
    const dir = Math.random() < .5 ? -1 : 1, dur = 900, x0 = j.x, dist = 26 * j.k / .5 * dir;
    const job = { name: 'roll', ticks: true, joeyOk: true, last: 0 };
    job.start = (now) => { job.p0 = now; };
    job.tick = (now) => {
      const u = Math.min(1, (now - job.p0) / dur), e = EASE.io(u), tuck = Math.sin(Math.PI * u);
      if (now - job.last >= S.LIVE_MS || u >= 1) {
        job.last = now;
        j.drawLive(dir * 80, { sq: 1 - .2 * tuck, lean: 30 * tuck, head: { pitch: 26 * tuck }, eyes: u > .15 && u < .85 ? 'closed' : 'happy', mouth: 'open', tailUp: .6 * tuck, y: -10 * tuck, noAmbient: true, arms: { L: { hand: [-8, 130 + 14 * tuck, 34] }, R: { hand: [8, 130 + 14 * tuck, 34] } } });
        j.live.style.transformOrigin = '50% 70%'; j.live.style.transform = `rotate(${(dir * 360 * e).toFixed(0)}deg)`;
      }
      j.x = S.clamp(x0 + dist * e, 20, innerWidth - 20); j.place();
      return u < 1;
    };
    const clean = () => { j.live.style.transform = ''; j.hideLive(); j.th = dir * 45; };
    job.interrupt = clean; job.end = () => { clean(); const p = j.toStage(80, 70); S.burst(p.x, p.y, 'stars'); };
    job.endOpts = { rest: false };
    return job;
  };
  // 長大（跟隨期 → 亞成體）：跳一下、變大一點、小星星。媽媽正在響鈴就晚一點再播
  F.grow = function (a, oldK) {
    const newK = a.k, mom = momOf(a);
    const setK = (k) => { a.k = k; a.w = S.VB.w * k; a.h = S.VB.h * k; a.el.style.width = a.w + 'px'; a.el.style.height = a.h + 'px'; };
    if (a.inPouch) { a.inPouch = false; a.el.style.display = ''; if (mom && mom.carried === a) { mom.carried = null; mom.attach.carryingJoey = false; F.refresh(mom, true); } }
    S.purgeFrames(a.id);
    if (S.reduceMotion) { a.showRest(); a.place(); return; }
    setK(oldK);
    const play = () => {
      if (!S.actors.has(a.id)) return;
      if (mom && mom.job && mom.job.name === 'ring') { a.growT = setTimeout(play, 2000); return; }
      if (a.job && a.job.layer <= 1) { a.growT = setTimeout(play, 1500); return; }          // 正在被拖或響鈴：等結束再長大（不打斷）
      // 先（還是小小的樣子）跳到旁邊的空位，離爸媽和別隻有禮貌距離，再在那裡長大：長大的時候不會和媽媽疊在一起
      if (!a.grewMoved && !a.job) {
        // 找空位：不要站到爸媽中間（情侶待機時會靠在一起）；優先站到媽媽「離爸爸遠的那一側」外面，再來是爸爸外側
        const dad = S.actors.get(a.attach.dad), mates = [mom, dad].filter((q) => q && !q.inPouch && Math.abs(q.y - a.y) <= 40);
        const lo = Math.min(...mates.map((q) => q.x)), hi = Math.max(...mates.map((q) => q.x));
        const others = [...S.actors.values()].filter((o) => o !== a && !o.inPouch && Math.abs(o.y - a.y) <= 40);
        const okAt = (x) => x > 44 && x < innerWidth - 44 && others.every((o) => Math.abs((o.sideTo != null ? o.sideTo : o.x) - x) >= 118) && !(mates.length === 2 && x > lo && x < hi);
        let sp = null;
        if (mates.length) {
          const cands = [];
          for (let d = 120; d <= 420; d += 12) cands.push(lo - d, hi + d);
          cands.sort((p, q) => Math.abs(p - a.x) - Math.abs(q - a.x));
          const x = cands.find(okAt);
          if (x != null) sp = { x, cross: others.some((o) => (o.x - a.x) * (o.x - x) < 0), others };
        }
        if (!sp) sp = a.freeSpot(118);
        if (sp && Math.abs(sp.x - a.x) > 6) {
          a.grewMoved = true; a.hs = 1.3; a.sideTo = sp.x;
          const m = a.mover(sp.x, { gait: 'hop', lane: sp.cross ? sp.others : null, speed: 1.1 });
          const clean = () => { a.depth = 0; a.zBoost = 0; a.sideTo = null; a.hs = 1; S.purgeFrames(a.id); };
          const mv = { name: 'growMove', x0: a.x, ticks: true, tick: (now) => m.tick(now), interrupt: clean, endOpts: { rest: false },
            end: () => { a.depth = 0; a.zBoost = 0; a.sideTo = null; a.place(); play(); } };          // 接著直接長大（頭的比例到長大動畫開始才換，不閃一格）
          if (a.requestActivity(6, mv)) { S.kick(); return; }
          clean(); a.grewMoved = false;
        }
      }
      const keys = [{ t: 0, th: -10, pose: { headScale: 1.3 } }, { t: .3, th: -5, pose: { headScale: 1.3, sq: .82, eyes: 'happy' } }, { t: .62, th: 0, pose: { headScale: 1.2, y: -26, sq: 1.1, eyes: 'happy', mouth: 'open', tailUp: .9, arms: { L: { hand: [-34, 72, 8] }, R: { hand: [34, 72, 8] } } }, ease: 'out' },
        { t: .9, th: 0, pose: { headScale: 1.12, sq: .86, eyes: 'happy', mouth: 'open', arms: { L: { hand: [-34, 76, 8] }, R: { hand: [34, 76, 8] } } }, ease: 'in' }, { t: 1.15, th: 0, pose: { headScale: 1.12, sq: 1.04, eyes: 'happy', mouth: 'open', blush: 1.4, arms: { L: { hand: [-36, 70, 6] }, R: { hand: [36, 70, 6] } } } },
        { t: 1.9, th: -10, pose: { headScale: 1.12, eyes: 'happy', blush: 1.3 } }, { t: 2.3, th: -10, pose: {} }];
      const anim = { dur: 2.3, keys };
      const job = a.animJob('grow', anim, {
        each: (jb, now, t) => { if (a.hs !== 1) { a.hs = 1; S.purgeFrames(a.id); } const u = S.clamp((t - .45) / .6, 0, 1); setK(oldK + (newK - oldK) * EASE.io(u)); a.place(); if (t > .6 && !jb.burst) { jb.burst = true; const p = a.toStage(80, 50); S.burst(p.x, p.y, 'stars'); } },
        interrupt: () => { a.hs = 1; S.purgeFrames(a.id); setK(newK); a.place(); }, end: () => { setK(newK); a.home = a.x; a.place(); S.api.savePos(a.id, { x: Math.round(a.x), y: Math.round(a.y) }); setTimeout(() => a.stepAway(100), 300); }
      });
      if (!a.grewMoved) a.th = -10;                                                         // 剛跳過來（側身）：讓動畫自己平順轉回來
      a.requestActivity(2, job);                                                            // 其他活動走正常的打斷流程（interrupt）
      if (a.job !== job) { if (a.hs !== 1) { a.hs = 1; S.purgeFrames(a.id); } setK(newK); if (!a.job) a.showRest(); a.place(); }
    };
    play();
  };
  // 並肩散步被打斷：在原地等對方（最多 10 秒）；對方回到待機就靠過去會合，逾時就自己回家
  F.waitFor = function (a, other) {
    const t0 = performance.now(), toward = other.x >= a.x ? 1 : -1;
    if (a.job || a.mode !== 'awake') return;
    a.th = toward * 45; a.showRest();
    const poll = () => {
      if (!S.actors.has(a.id) || a.job || a.mode !== 'awake') return;
      if (!S.actors.has(other.id) || performance.now() - t0 > 10000) { if (S.settings.walk !== 'off' && Math.abs(a.home - a.x) > 40) a.requestActivity(7, a.walkJob(a.home, { noPause: true })); else { a.th = -15; a.showRest(); } S.kick(); return; }
      if (!other.job && other.mode === 'awake' && Math.abs(other.y - a.y) <= 40) {
        const near = 72 * (a.k + other.k) / 2 / S.SCALE, side = Math.sign(a.x - other.x) || 1;
        if (Math.abs(other.x - a.x) > near + 20) a.requestActivity(7, a.walkJob(S.clamp(other.x + side * near, 40, innerWidth - 40), { ignore: new Set([other]), noPause: true, onArrive: (ok) => { if (ok) S.burst((a.x + other.x) / 2, a.y - 170 * a.k, 'heart1'); } }));
        else S.burst((a.x + other.x) / 2, a.y - 170 * a.k, 'heart1');
        S.kick(); return;
      }
      a.waitT = setTimeout(poll, 500);
    };
    a.waitT = setTimeout(poll, 500);
  };
  // 情侶待機：自己靠過去站在一起（約 70 px）、偶爾冒愛心
  // 曖昧（愛情 ≥ 60、還不是一對）：也常靠過去，但站得稍遠（約 95 px）、比較少冒愛心
  F.coupleIdle = function (a, now) {
    const mate = F.partnerOf(a), P = mate || F.flirtOf(a), flirt = !mate;
    if (!P || P.inPouch || P.mode !== 'awake' || Math.abs(P.y - a.y) > 40) return false;
    const d = Math.abs(P.x - a.x), near = (flirt ? 95 : 72) * (a.k + P.k) / 2 / S.SCALE;
    if (d <= near + 26) {
      if (Math.random() < (flirt ? .2 : .4) && !P.job) { const p = { x: (a.x + P.x) / 2, y: a.y - 170 * a.k }; S.burst(p.x, p.y, 'heart1'); a.nextAt = now + a.restGap() * .5; return true; }
      return false;
    }
    if (d > 2400 || P.job || (d <= 300 && Math.random() > (flirt ? .5 : .65)) || S.settings.walk === 'off') return false;   // 超過 300 px 一定走回去
    // 站在伴侶旁邊有空位的那一側（那邊已經站著別隻就換另一側；兩側都沒位置就不過去）
    const spotOk = (x) => x > 44 && x < innerWidth - 44 && S.politeOk(a, x, { ignore: new Set([P]) });     // 和別隻（非伴侶）保持禮貌距離（和散步挑目的地用同一個標準）
    // 靠近自己這一側被別隻佔住：改站伴侶的另一側，從伴侶前面繞過去（情侶可以靠近、畫在前面經過）
    const s0 = Math.sign(a.x - P.x) || 1, side = spotOk(P.x + s0 * near) ? s0 : spotOk(P.x - s0 * near) ? -s0 : 0;
    if (side === 0) return false;
    const tx = P.x + side * near;
    const job = a.walkJob(tx, { ignore: new Set([P]), lane: side !== s0 ? [P] : null, noPause: true, name: 'walk', onArrive: (ok) => { if (ok && Math.abs(P.x - a.x) < near + 30) { const p = { x: (a.x + P.x) / 2, y: a.y - 170 * a.k }; S.burst(p.x, p.y, 'heart1'); } } });
    return !!a.requestActivity(7, job);
  };
})();
