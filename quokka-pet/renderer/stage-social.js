// 舞台上「兩隻以上」的事：雙人互動（S.Duet）、避讓、育兒袋與小袋鼠、情侶待機（規格 5.4、5.5、6.3、7.5、8.3–8.6）
// 互動的劇本（關鍵姿勢、球的軌跡）在 quokka-anim-social.js；這裡負責走位、同步播放、被打斷的收尾。
//
// 雙人互動的流程：social:start → 發起的那隻一步一步走到劇本要的距離（不滑步）→ 兩隻平順轉向對方 →
//   同一個時鐘播放（兩隻畫在同一張即時 SVG 裡，依前後交錯疊放；球、愛心也在裡面）→ 播完換回各自的 PNG → social:done
// 被打斷：被打斷的那隻立刻去做高優先的事；另一隻播 0.5–0.8 秒收尾再回待機；送 social:abort
(function () {
  const S = window.Stage, ANIM = S.ANIM, SOC = S.SOC, EASE = ANIM.EASE, Actor = S.Actor;
  const COUPLE = new Set(['cuddle', 'groom', 'leanNap', 'walkTogether']);
  const DUET_MS = 28;                                           // 兩隻一起即時繪製：跟著共用迴圈，每秒最多 30 格
  let duetSeq = 0;
  S.duets = new Set();

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
      const roomL = (x) => x - 50, roomR = (x) => W - 50 - x;
      return SOC.context(act(I), act(O), { couple: I.attach.partner === O.id, room: { a: side > 0 ? roomL(I.x) : roomR(I.x), b: side > 0 ? roomR(O.x) : roomL(O.x) } });
    }
    begin(now) {
      const I = this.I, O = this.O, W = innerWidth;
      const gap = this.T.gap(this.ctxFor());
      let side = O.x >= I.x ? 1 : -1;
      // 爸爸碰鼻小袋鼠：媽媽（錨點）就在小袋鼠旁邊 → 爸爸站到小袋鼠的另一側，不要疊在媽媽身上
      const anc = this.soc.anchor ? S.actors.get(this.soc.anchor) : null;
      if (anc && anc !== I && anc !== O && Math.abs(anc.x - O.x) < 150) { const s2 = anc.x >= O.x ? 1 : -1, x2 = O.x - s2 * gap; if (x2 > 44 && x2 < W - 44) side = s2; }
      let ix = O.x - side * gap, ox = O.x;
      // 發起的走過去；螢幕邊放不下時，對方也挪一下
      if (ix < 44) { ix = 44; ox = ix + side * gap; } else if (ix > W - 44) { ix = W - 44; ox = ix + side * gap; }
      if (ox < 40 || ox > W - 40) return false;
      this.gap = gap; this.t0 = now;
      const ig = new Set([I, O]);
      this.mI = Math.abs(ix - I.x) > 3 ? I.mover(ix, { ignore: ig, tol: 1.5, gait: (rem) => (rem < 64 * I.k ? 'walk' : 'hop') }) : null;
      this.mO = Math.abs(ox - O.x) > 3 ? O.mover(ox, { ignore: ig, tol: 1.5, gait: 'hop' }) : null;
      this.waitTurn = this.mO ? null : O.turner(-side * 60, 280);
      return true;
    }
    step(now) {
      if (this.last === now) return; this.last = now;
      const I = this.I, O = this.O;
      if (this.phase === 'approach') {
        if (this.t0 == null && !this.begin(now)) { this.cancel(I, 'user'); return; }
        if (Math.abs(I.y - O.y) > 40) { this.cancel(I, 'user'); return; }                 // 地面高度不同了：取消
        const a = this.mI && this.mI.tick(now), b = this.mO && this.mO.tick(now);
        if (this.waitTurn && !this.waitTurn.tick(now)) this.waitTurn = null;              // 對方：轉向走過來的那隻，等著
        if (now - this.t0 > 20000) { this.cancel(I, 'work'); return; }
        if (a || b) return;
        const side = O.x >= I.x ? 1 : -1;
        this.tI = I.turner(side * SOC.TH0, 300); this.tO = O.turner(-side * SOC.TH0, 300);
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
      this.phase = 'play'; this.p0 = now; this.lastDraw = 0;
      this.el = document.createElement('div'); this.el.className = 'duet';
      S.stageEl.appendChild(this.el);
      for (const a of [I, O]) { a.hideLive(); a.duetOn = true; a.el.classList.add('in-duet'); }
      S.duets.add(this);
    }
    playTick(now) {
      const I = this.I, O = this.O, sc = this.sc, t = (now - this.p0) / 1000;
      if (sc.handoff && !this.handed && t >= sc.handoff.t) this.handoff();
      if (now - this.lastDraw >= DUET_MS || t >= sc.dur) {
        this.lastDraw = now;
        const fr = sc.at(Math.min(t, sc.dur));
        if (this.handed && fr.world) fr.world = fr.world.filter((w) => w.k !== 'vball' && w.k !== 'bball');
        // 常駐層：眨眼
        if (ANIM.ambient) for (const [key, a] of [['a', I], ['b', O]]) { const am = ANIM.ambient(now / 1000, a.seed, { still: false }); if (am.blink) fr[key].pose.blink = Math.max(fr[key].pose.blink || 0, am.blink); }
        this.ctx.b.oy = O.y - I.y;
        const res = SOC.compose(this.ctx, fr, { ground: I.y, id: 'D' + this.uid });
        const x0 = Math.min(res.pos.a.x, res.pos.b.x) - 230, x1 = Math.max(res.pos.a.x, res.pos.b.x) + 230, y0 = Math.max(0, I.y - 440), y1 = I.y + 24;
        const st = this.el.style;
        st.left = x0 + 'px'; st.top = y0 + 'px'; st.width = (x1 - x0) + 'px'; st.height = (y1 - y0) + 'px'; st.zIndex = Math.round(Math.max(I.y, O.y)) + 1;
        this.el.innerHTML = `<svg viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${res.svg}</svg>`;
        this.pos = res.pos;
        for (const [key, a] of [['a', I], ['b', O]]) {
          const nx = res.pos[key].x;
          if (fr.moves && Math.abs(nx - a.x) > .5 && S.avoid) S.avoid(a, a.x, nx, new Set([I, O]), true);
          a.x = nx; a.place();
        }
      }
      if (t >= sc.dur) this.finish();
    }
    // 扣球／投籃沒進：球交給舞台做物理，由負責的那隻去撿
    handoff() {
      const h = this.sc.handoff, I = this.I, owner = h.owner === 'a' ? I : this.O, side = this.ctx.side;
      this.handed = true;
      owner.throwX = owner.x;
      const b = new S.Ball(owner, h.kind, this.ctx.a.x0 + side * h.u, I.y - h.h, side * h.vu, -h.vh, null);
      b.coop = true; b.k = this.ctx.kk; b.r = 12 * this.ctx.kk; b.size = Math.round(32 * this.ctx.kk); b.el.style.width = b.el.style.height = b.size + 'px'; b.place();
      this.ball = b;
    }
    teardown() {
      if (this.el) { this.el.remove(); this.el = null; }
      S.duets.delete(this);
      for (const a of [this.I, this.O]) { a.duetOn = false; a.el.classList.remove('in-duet'); }
    }
    endTh(key) { const p = this.pos && this.pos[key]; return p ? Math.round(p.th / 15) * 15 : null; }
    finish() {
      const I = this.I, O = this.O;
      this.over = true;
      for (const [key, a] of [['a', I], ['b', O]]) { const th = this.endTh(key); if (th != null) a.th = S.clamp(th, -90, 90); a.nextAt = Math.max(a.nextAt, performance.now() + 6000 + Math.random() * 6000); }
      this.teardown();
      S.api.socialDone(this.soc.pairId, true, this.soc.type);
      for (const [a, job] of [[O, this.jobO], [I, this.jobI]]) if (a.job === job) a.finish(job, { rest: true });
    }
    // 還沒開始就取消（走不到、地面不同）
    cancel(by, reason) {
      if (this.over) return;
      this.over = true; this.teardown();
      S.api.socialAbort(this.soc.pairId, by.id, reason);
      for (const [a, job] of [[this.O, this.jobO], [this.I, this.jobI]]) if (a.job === job) { a.th = Math.round(a.th / 15) * 15; a.finish(job, { rest: true }); }
    }
    // 其中一隻被更高層的活動打斷（a 的工作已經被換掉了）
    interrupted(a, reason) {
      if (this.over) return;
      const why = reason === 'drag' ? 'drag' : reason === 'ring' ? 'alert' : /^react/.test(reason || '') ? 'work' : reason === 'remove' ? 'user' : (reason === 'asleep' || reason === 'hidden' || reason === 'pause') ? 'user' : 'user';
      const wasPlay = this.phase === 'play', other = a === this.I ? this.O : this.I, oj = a === this.I ? this.jobO : this.jobI;
      const thA = this.endTh(a === this.I ? 'a' : 'b'), thO = this.endTh(a === this.I ? 'b' : 'a');
      this.over = true; this.teardown();
      if (this.ball && !this.ball.gone && !this.ball.stopped) this.ball.fade();           // 一起打球被打斷：球淡出
      if (thA != null) a.th = S.clamp(thA, -90, 90);
      a.zBoost = 0;
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
      if (job.outro.worry) { const p = a.toStage(80 + toward * 26, 26); S.burst(p.x, p.y, 'worry'); }
      S.kick();
    }
    outroTick(a, job, now) {
      const o = job.outro, t = (now - o.t0) / 1000;
      if (now - o.last >= S.LIVE_MS) { o.last = now; const s = ANIM.sample(o.anim, Math.min(t, o.anim.dur)); a.drawLive(s.th, { ...s.pose, noAmbient: true }); }
      return t < o.anim.dur;
    }
  }
  S.Duet = Duet;
  S.COUPLE_TYPES = COUPLE;

  // social:start
  S.startSocial = function (p) {
    const A = S.actors.get(p.a), B = S.actors.get(p.b), api = S.api;
    if (!A || !B || A === B || A.inPouch || B.inPouch) { api.socialAbort(p.pairId, p.a, 'user'); return null; }
    if (Math.abs(A.y - B.y) > 40) { api.socialAbort(p.pairId, p.a, 'user'); return null; }       // 不在同一地面
    const soc = { pairId: p.pairId, a: p.a, b: p.b, type: S.str(p.type, 30), initiator: p.initiator === p.b ? p.b : p.a, anchor: p.anchor || null };
    const I = soc.initiator === p.a ? A : B, O = I === A ? B : A;
    if (S.reduceMotion) { api.socialDone(soc.pairId, true, soc.type); return null; }
    const d = new Duet(soc, I, O);
    if (!I.requestActivity(5, d.jobI)) { api.socialAbort(soc.pairId, I.id, I.layer <= 1 ? 'alert' : 'work'); return null; }
    if (!O.requestActivity(5, d.jobO)) { d.over = true; if (I.job === d.jobI) I.finish(d.jobI, { rest: false }); api.socialAbort(soc.pairId, O.id, O.layer <= 1 ? 'alert' : 'work'); return null; }
    S.kick();
    return d;
  };

  // =====================================================================================
  // 避讓（規格 6.3）：有誰要從 x0 走到 x1，路上站著別隻 →
  //   待機中的那隻往旁邊（畫面裡側）讓一步（小跳），等對方過去再跳回來；正在忙的就由移動的那隻從牠前面繞過去
  // =====================================================================================
  S.avoid = function (mover, x0, x1, ignore, urgent) {
    const lo = Math.min(x0, x1) - 46, hi = Math.max(x0, x1) + 46;
    let front = false;
    for (const o of S.actors.values()) {
      if (o === mover || o.inPouch || (ignore && ignore.has(o)) || Math.abs(o.y - mover.y) > 40) continue;
      if (o.x < lo || o.x > hi) continue;
      if (S.family && S.family.close(mover, o) && !urgent) continue;
      front = true;
      if (!o.job && o.mode === 'awake' && !o.isFollow) o.requestActivity(6, dodgeJob(o, mover));
      else if (o.isFollow && !o.job && S.family) S.family.dodge(o, mover);
    }
    mover.zBoost = front ? 60 : 0;                              // 從別隻前面過：暫時畫在前面
    return front;
  };
  const DODGE = 20;
  function dodgeJob(o, mover) {
    const D = DODGE * o.k / S.SCALE, hop = (u) => (ANIM.GAIT ? ANIM.GAIT.hop(u).pose : ANIM.FETCH.hop(u));
    const job = { name: 'dodge', ticks: true, phase: 'out', joeyOk: true };
    const frame = (u, tag) => { const [f, v] = Actor.q(u, 6), p = hop(v); o.setFrame(`dg${Math.round(o.th)}_${f}`, o.th, { ...p, lean: 2, head: { pitch: 0, yaw: (mover.x > o.x ? 1 : -1) * 20 }, look: [mover.x > o.x ? 1.5 : -1.5, 0], eyes: 'wide', mouth: 'o' }); };
    job.start = (now) => { job.p0 = now; o.lookBucket = null; };
    job.tick = (now) => {
      const u = Math.min(1, (now - job.p0) / 300);
      if (job.phase === 'out') { frame(u); o.depth = D * EASE.io(u); o.place(); if (u >= 1) { job.phase = 'wait'; job.p0 = now; o.showRest(); } return true; }
      if (job.phase === 'wait') {
        const gone = !mover.job || mover.layer === 8 || Math.abs(mover.x - o.x) > 96 || !S.actors.has(mover.id);
        const still = mover.job && mover.job.name === 'fetch' && Math.abs(mover.x - o.x) <= 96;      // 對方就在旁邊撿球：等牠走
        if ((gone && !still && now - job.p0 > 250) || now - job.p0 > 9000) { job.phase = 'back'; job.p0 = now; }
        return true;
      }
      frame(u); o.depth = D * (1 - EASE.io(u)); o.place();
      if (u >= 1) { o.depth = 0; o.place(); return false; }
      return true;
    };
    job.interrupt = () => { o.depth = 0; o.place(); };
    job.end = () => { o.depth = 0; };
    job.endOpts = { rest: false };
    return job;
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
  F.close = (a, o) => a.attach.partner === o.id || o.attach.partner === a.id || (a.isFollow && momOf(a) === o) || (o.isFollow && momOf(o) === a);
  F.setPouch = function (list) {
    const old = new Map(pouchJoeys); pouchJoeys.clear();
    for (const q of list) if (q && q.mom) pouchJoeys.set(q.mom, q);
    for (const id of new Set([...old.keys(), ...pouchJoeys.keys()])) { const m = S.actors.get(id); if (m) F.refresh(m, true); }
  };
  // 外觀附加狀態變了：換快取鍵，待機圖重畫
  F.refresh = function (a, redraw) {
    const st = decoState(a), old = a.decoKey || '';
    a.decoKey = st ? `|p${st.pj ? st.pj.id : ''}${st.carried ? 'c' + st.carried.id : ''}${st.out ? 'o' : 'i'}` : '';
    if (st && st.pj && !a.peekT) F.peekLoop(a);
    if (redraw && old !== a.decoKey && !a.job && a.img) { a.showRest(); }
    return old !== a.decoKey;
  };
  // 育兒袋期：偶爾縮回去再探出來（計時器，不跑迴圈）
  F.peekLoop = function (a) {
    const tick = () => {
      a.peekT = 0;
      if (!S.actors.has(a.id) || !pouchJoeys.get(a.id)) return;
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
  F.intoPouch = function (j, mom) {
    if (j.inPouch) return;
    if (j.job) { const job = j.job; j.job = null; job.interrupt && job.interrupt('pouch'); j.hideLive(); j.setLayer(8); }
    j.inPouch = true; j.el.style.display = 'none'; j.depth = 0; j.place();
    if (mom && !mom.attach.carryingJoey && !pouchJoeys.get(mom.id)) { mom.carried = j; mom.attach.carryingJoey = true; }
    if (mom) { F.refresh(mom); if (mom.dragging) mom.setFrame('lift', 0, ANIM.STILL.lift); else if (!mom.job) mom.showRest(); }
    S.reportRects();
  };
  F.outOfPouch = function (j, mom) {
    if (!j.inPouch) return;
    j.inPouch = false; j.el.style.display = '';
    if (mom) { j.x = mom.x + (mom.faceDir > 0 ? -1 : 1) * 14 * mom.k; j.y = mom.y; if (mom.carried === j) { mom.carried = null; mom.attach.carryingJoey = false; } F.refresh(mom, true); }
    j.th = -15; j.showRest(); j.place(); j.nextAt = performance.now() + 4000;
    const p = j.toStage(80, 60); S.burst(p.x, p.y, 'stars');
    S.reportRects(); S.kick();
  };
  // 放下 1.5 秒後再爬出來
  F.dropped = function (a) {
    F.refresh(a);
    clearTimeout(a.outT);
    a.outT = setTimeout(() => { if (a.mode !== 'awake' || a.dragging) return; for (const j of joeysOf(a)) F.outOfPouch(j, a); }, 1500);
  };
  // 使用者離開（睡覺）：小袋鼠鑽進袋裡；回來再出來
  F.modeChanged = function (a) {
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
  F.dodge = function (j, mover) { const job = dodgeJob(j, mover); j.requestActivity(6, job); };
  // 跟隨期的小袋鼠：媽媽走牠就跟（保持在媽媽後方 40–60 px）；媽媽響鈴時坐著看、不擋氣泡；媽媽停下時偶爾學媽媽、打滾
  F.target = function (j, mom) {
    const back = mom.faceDir > 0 ? -1 : 1, ring = mom.job && mom.job.name === 'ring';
    const d = ring ? Math.max(64, mom.w * .3 + j.w * .3 + 10) : S.clamp(mom.w * .2 + j.w * .25, 44, 60);   // 平常在後方 40–60 px；響鈴時退到不擋媽媽的點擊範圍和氣泡
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
    const m = j.mover(() => F.target(j, mom), { ignore: new Set([mom]), tol: 12, regait: true, speed: 1.25, turnMs: 180, toY: () => mom.y,
      gait: (rem) => (rem > 70 * j.k / .5 ? 'dash' : 'hop') });
    let sub = null;
    const job = { name: 'follow', ticks: true, joeyOk: true };
    job.tick = (now) => {
      if (mom.dragging) { F.intoPouch(j, mom); return false; }
      if (!sub && m.tick(now)) return true;
      if (!sub) { j.y = mom.y; sub = j.turner((mom.x > j.x ? 1 : -1) * 45, 200); }                  // 停下：轉向媽媽
      return sub.tick(now);
    };
    job.interrupt = () => {};
    job.end = () => { j.home = j.x; };
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
      if (a.job) { const job = a.job; a.job = null; job.interrupt && job.interrupt('grow'); }
      const keys = [{ t: 0, th: -10, pose: { headScale: 1.3 } }, { t: .3, th: -5, pose: { headScale: 1.3, sq: .82, eyes: 'happy' } }, { t: .62, th: 0, pose: { headScale: 1.2, y: -26, sq: 1.1, eyes: 'happy', mouth: 'open', tailUp: .9, arms: { L: { hand: [-34, 72, 8] }, R: { hand: [34, 72, 8] } } }, ease: 'out' },
        { t: .9, th: 0, pose: { headScale: 1.12, sq: .86, eyes: 'happy', mouth: 'open', arms: { L: { hand: [-34, 76, 8] }, R: { hand: [34, 76, 8] } } }, ease: 'in' }, { t: 1.15, th: 0, pose: { headScale: 1.12, sq: 1.04, eyes: 'happy', mouth: 'open', blush: 1.4, arms: { L: { hand: [-36, 70, 6] }, R: { hand: [36, 70, 6] } } } },
        { t: 1.9, th: -10, pose: { headScale: 1.12, eyes: 'happy', blush: 1.3 } }, { t: 2.3, th: -10, pose: {} }];
      const anim = { dur: 2.3, keys };
      const job = a.animJob('grow', anim, {
        each: (jb, now, t) => { const u = S.clamp((t - .45) / .6, 0, 1); setK(oldK + (newK - oldK) * EASE.io(u)); a.place(); if (t > .6 && !jb.burst) { jb.burst = true; const p = a.toStage(80, 50); S.burst(p.x, p.y, 'stars'); } },
        interrupt: () => { setK(newK); a.place(); }, end: () => { setK(newK); a.home = a.x; a.place(); S.api.savePos(a.id, { x: Math.round(a.x), y: Math.round(a.y) }); setTimeout(() => a.stepAway(), 400); }
      });
      a.th = -10;
      a.requestActivity(2, job);
      if (a.job !== job) { setK(newK); a.showRest(); a.place(); }
    };
    play();
  };
  // 情侶待機：自己靠過去站在一起（約 70 px）、偶爾冒愛心
  F.coupleIdle = function (a, now) {
    const P = F.partnerOf(a);
    if (!P || P.inPouch || P.mode !== 'awake' || Math.abs(P.y - a.y) > 40) return false;
    const d = Math.abs(P.x - a.x), near = 72 * (a.k + P.k) / 2 / S.SCALE;
    if (d <= near + 26) {
      if (Math.random() < .4 && !P.job) { const p = { x: (a.x + P.x) / 2, y: a.y - 170 * a.k }; S.burst(p.x, p.y, 'heart1'); a.nextAt = now + a.restGap() * .5; return true; }
      return false;
    }
    if (d > 700 || P.job || Math.random() > .65 || S.settings.walk === 'off') return false;
    const side = Math.sign(a.x - P.x) || 1, tx = S.clamp(P.x + side * near, 40, innerWidth - 40);
    const job = a.walkJob(tx, { ignore: new Set([P]), noPause: true, name: 'walk', onArrive: (ok) => { if (ok && Math.abs(P.x - a.x) < near + 30) { const p = { x: (a.x + P.x) / 2, y: a.y - 170 * a.k }; S.burst(p.x, p.y, 'heart1'); } } });
    return !!a.requestActivity(7, job);
  };
})();
