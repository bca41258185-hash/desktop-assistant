// 傳球接力：球落地停下 → 最近、有空的那隻去撿（不一定是丟球的那隻）→ 轉頭看要傳的同伴、拉一條視線，
//   對方轉過來舉手喊「來！」→ 拋過去（拋物線）→ 接到就換牠傳下一個；偶爾漏接，球掉到地上滾，再由最近的撿起來接著傳。
//   傳個 3～7 次結束，最後拿到球的說一句，參加的兩兩加一點好感。
(function () {
  const S = window.Stage;
  const LINES = { call: ['來！', '這邊！', '傳我！', '我準備好了！'], miss: ['啊，漏了！', '欸欸欸——', '對不起！'], end: ['好球！大家好棒！', '傳得好順！', '下次再來！', '默契越來越好了～'], start: ['大家來傳球！', '要傳囉～', '接好喔！'] };
  const pick = (l) => l[Math.floor(Math.random() * l.length)];
  const relays = new Set();
  let lastEnd = -1e9;
  // 有誰正拿著禮物要送給牠、或牠正要去送禮：先不拉進接力（不然禮物永遠送不出去）
  const giftBusy = (a) => !!a.giftFor || [...S.actors.values()].some((o) => o.giftFor === a.id);

  const free = (a) => a && a.mode === 'awake' && !a.inPouch && !a.isFollow && !a.dragging && !a.relay && (!a.job || (a.job.layer || 9) >= 6) && !(a.job && a.job.name === 'fetch') && !giftBusy(a);
  // 手的位置（舞台座標）：抱在胸前
  const handOf = (a) => a.toStage(84, 104);

  // 球停下來：有其他有空的同伴在 → 改成接力（丟球的那隻不自己去撿）
  const orig = S.Actor.prototype.ballStopped;
  S.Actor.prototype.ballStopped = function (ball) {
    if (window.__relayDebug) console.warn('relay ballStopped', this.id, !!ball, ball && ball.picked, ball && ball.relayLock);
    if (ball && !ball.picked && !ball.relayLock && claim(ball, this)) return;
    return orig.call(this, ball);
  };

  function claim(ball, owner) {
    if (S.reduceMotion) return false;
    const r = ball.relayRun;
    const mates = [...S.actors.values()].filter((a) => free(a) || a === owner || (r && r.team.has(a.id)));
    if (!r && mates.filter((a) => a !== owner).length < 1) return false;          // 沒有同伴：照舊自己撿
    if (!r && Math.random() < .15) return false;                                  // 偶爾還是自己撿回來
    if (!r && performance.now() - lastEnd < 45000) return false;                   // 剛傳完：先休息一下
    if (!r && relays.size) return false;                                            // 已經有一場在傳：這顆球照舊自己撿
    const near = mates.filter((a) => free(a) || a === owner).sort((x, y) => Math.abs(x.x - ball.x) - Math.abs(y.x - ball.x));
    const getter = !r && owner && Math.abs(owner.x - ball.x) < 500 && near.includes(owner) ? owner : near[0];
    if (!getter) return false;
    ball.picked = true; ball.relayLock = true;
    const run = r || { at: performance.now(), ball, team: new Set(), passes: 0, max: (ball.kind === 'vball' ? 5 : 3) + Math.floor(Math.random() * 5), pairs: new Set(), last: null };
    ball.relayRun = run; relays.add(run);
    if (owner && owner.job && owner.job.st && owner.job.st.thrown) owner.job.handoff = true;   // 丟球的那隻不用再盯著球
    S.kick();
    fetchBy(run, getter);
    return true;
  }

  // 參加的那隻先掛一個「接力中」的活動（不會被散步、小動作打斷）
  function enlist(run, a) {
    run.team.add(a.id); a.relay = run;
    if (a.job && a.job.name === 'relay') return a.job;
    const job = { name: 'relay', ticks: false, start() {}, interrupt() { a.relay = null; if (run.holder === a) dropBall(run, a, true); } };
    if (!a.requestActivity(3, job)) { a.relay = null; return null; }      // 用陪玩那一層（不佔同時移動的名額）
    return job;
  }
  function release(run, a) { a.relay = null; if (a.job && a.job.name === 'relay') a.finish(a.job); }

  function fetchBy(run, a) {
    const ball = run.ball;
    run.holder = null;
    if (Math.abs(a.x - ball.x) < 70 * a.k && Math.abs(a.y - ball.ground) < 30) { take(run, a); return; }
    a.relay = run; run.team.add(a.id);
    const job = a.walkJob(ball.x - Math.sign(ball.x - a.x || 1) * 40 * a.k, { name: 'relayGet', noPause: true, gait: 'hop', cursorOk: true, y: Math.abs(ball.ground - a.y) > 30 ? ball.ground : null,
      onArrive: () => setTimeout(() => {
        if (!relays.has(run)) { if (a.relay === run) a.relay = null; return; }
        if (!run.ball.gone && Math.abs(a.x - run.ball.x) > 150 * a.k) { a.relay = null; endRun(run, null); return; }   // 被擋住沒走到：這一輪算了，球照舊處理
        take(run, a);
      }, 30) });
    const int0 = job.interrupt;
    job.interrupt = (...x) => { if (int0) int0(...x); if (run.holder !== a) { a.relay = null; endRun(run, null); } };
    if (!a.requestActivity(4, job)) { a.relay = null; endRun(run, null); }
  }

  function take(run, a) {
    if (!relays.has(run)) { if (a.relay === run) a.relay = null; return; }       // 這一輪已經結束（保險收掉了）：不要再掛上去
    const ball = run.ball; run.at = performance.now();
    if (ball.gone || !S.actors.has(a.id)) { endRun(run, null); return; }
    if (!enlist(run, a)) { endRun(run, null); return; }
    ball.held = true; ball.stopped = true; ball.vx = ball.vy = 0; ball.el.style.visibility = '';
    run.holder = a; holdAt(run, a);
    if (run.passes === 0 && !run.said) { run.said = true; a.say(pick(LINES.start), { ms: 1500 }); }
    if (run.passes >= run.max) { setTimeout(() => finishRun(run, a), 600); return; }
    setTimeout(() => aim(run, a), 450 + Math.random() * 400);
  }
  function holdAt(run, a) { const p = handOf(a); run.ball.x = p.x; run.ball.y = p.y; run.ball.born = performance.now(); run.ball.place(); }

  // 選要傳給誰：有空的、或已經在接力裡的；不傳回剛剛傳給我的那隻（有別人的話）
  function target(run, a) {
    const cands = [...S.actors.values()].filter((o) => o !== a && (free(o) || (o.relay === run && o.job && o.job.name === 'relay')) && Math.abs(o.x - a.x) < innerWidth * .7);
    const pool = cands.filter((o) => o !== run.last).length ? cands.filter((o) => o !== run.last) : cands;
    if (!pool.length) return null;
    return pool.sort((x, y) => Math.abs(x.x - a.x) - Math.abs(y.x - a.x))[Math.random() < .7 ? 0 : Math.floor(Math.random() * pool.length)];
  }
  // 排球：接到不停球，直接托給下一隻（跟真的排球一樣）；找不到人可以托就接住
  function bump(run, a) {
    run.at = performance.now();
    const to = target(run, a);
    if (!to || !enlist(run, to)) { take(run, a); return; }
    const dir = Math.sign(to.x - a.x) || 1;
    turn(a, dir * 55); turn(to, -dir * 40);
    if (Math.random() < .45) a.say(pick(['托！', '嘿！', '我來！', '接！', '給你！']), { ms: 650 });
    else if (Math.random() < .4) to.say(pick(LINES.call), { ms: 800 });
    run.holder = a;
    throwTo(run, a, to, true);
  }
  function aim(run, a) {
    if (run.ball.gone) { endRun(run, a); return; }
    if (run.holder !== a) return;
    run.at = performance.now();
    const to = target(run, a);
    if (!to || !enlist(run, to)) { finishRun(run, a); return; }
    // 先看對方一眼：兩隻轉向彼此、拉一條視線，對方舉手喊「來！」
    const dir = Math.sign(to.x - a.x) || 1;
    turn(a, dir * 55); turn(to, -dir * 40);
    const line = sight(a, to);
    setTimeout(() => { if (to.relay === run) to.say(pick(LINES.call), { ms: 1200 }); }, 250);
    setTimeout(() => { line.remove(); if (run.holder === a && to.relay === run) throwTo(run, a, to); else finishRun(run, a); }, 850);
  }
  function turn(a, th) {
    if (S.reduceMotion) return;
    const sm = a.smoothTo(th, {}, 260); if (!sm) return;
    let raf = 0; const step = (now) => { if (sm.tick(now)) raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step);
  }
  // 視線：從傳球的頭頂到接球的頭頂一條虛線，接球那邊有個小箭頭
  function sight(a, b) {
    const p = a.toStage(80, 40), q = b.toStage(80, 40);
    const x0 = Math.min(p.x, q.x) - 10, y0 = Math.min(p.y, q.y) - 40, w = Math.abs(p.x - q.x) + 20, h = Math.abs(p.y - q.y) + 50;
    const el = document.createElement('div'); el.className = 'relay-sight';
    const mx = (p.x + q.x) / 2 - x0, my = Math.min(p.y, q.y) - 30 - y0;
    el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="M${p.x - x0} ${p.y - y0} Q${mx} ${my} ${q.x - x0} ${q.y - y0}" fill="none" stroke="rgba(90,60,10,.55)" stroke-width="6" stroke-dasharray="7 6" stroke-linecap="round"/><path d="M${p.x - x0} ${p.y - y0} Q${mx} ${my} ${q.x - x0} ${q.y - y0}" fill="none" stroke="#ffc928" stroke-width="3.2" stroke-dasharray="7 6" stroke-linecap="round"/><circle cx="${q.x - x0}" cy="${q.y - y0}" r="7" fill="#ffc928" stroke="rgba(90,60,10,.6)" stroke-width="2"/></svg>`;
    el.style.transform = `translate(${x0}px, ${y0}px)`;
    S.fxEl.appendChild(el);
    return el;
  }

  function throwTo(run, a, to, bumped) {
    const ball = run.ball, p0 = bumped ? { x: ball.x, y: ball.y } : handOf(a);
    const d = Math.hypot(to.x - a.x, to.y - a.y), T = (bumped ? 620 : 450) + d * .55, H = bumped ? Math.max(150, Math.min(340, d * .5)) : Math.max(70, Math.min(260, d * .35));   // 托球：弧線比較高、滯空久一點
    const catchOk = Math.random() < ({ shy: .78, sleepy: .8, athlete: .96 }[((to.traits || {}).personality || {}).archetype] || .9);
    run.holder = null; run.last = a; release(run, a);
    if (window.__L) window.__L({ id: a.id, ev: '傳球', with: to.id, ok: catchOk });   // 記錄器（測試用，平常沒有）
    const t0 = performance.now();
    run.at = performance.now();
    const step = (now) => {
      if (ball.gone) { endRun(run, to); return; }
      const u = Math.min(1, (now - t0) / T), p1 = handOf(to);
      ball.x = p0.x + (p1.x - p0.x) * u; ball.y = p0.y + (p1.y - p0.y) * u - H * 4 * u * (1 - u);
      ball.rot += 9; ball.place();
      if (u < 1) { requestAnimationFrame(step); return; }
      if (to.relay !== run || !S.actors.has(to.id)) { dropBall(run, to, false); return; }
      if (!catchOk) {
        to.say(pick(LINES.miss), { ms: 1300 }); dropBall(run, to, false);
        setTimeout(() => { if (S.actors.has(a.id) && !(a.job && (a.job.layer || 9) < 3)) a.say(pick(['沒關係啦，你很接近了！', '是我傳太高了～', '下次我傳慢一點！']), { ms: 1800 }); }, 700);
        setTimeout(() => { if (S.actors.has(to.id)) to.say(pick(['下次我一定接到！', '嗚，謝謝……我會練的！', '再來一次！']), { ms: 1800 }); }, 1900);
        return;
      }
      run.passes++; run.pairs.add([a.id, to.id].sort().join('|'));
      if (ball.kind === 'vball' && run.passes < run.max && !S.reduceMotion) bump(run, to); else take(run, to);
    };
    requestAnimationFrame(step);
  }

  // 球掉下去（漏接、被打斷）：交給物理，停下來時再由最近的那隻撿（接力繼續）
  function dropBall(run, a, interrupted) {
    const ball = run.ball;
    if (ball.gone) { endRun(run, null); return; }
    run.holder = null;
    if (a) release(run, a);
    ball.held = false; ball.stopped = false; ball.picked = false; ball.relayLock = false;
    ball.owner = a && S.actors.has(a.id) ? a : ball.owner; if (ball.owner) { ball.owner.ball = ball; ball.ground = Math.min(ball.owner.y, innerHeight - 2); }
    ball.vx = (Math.random() * 2 - 1) * 160; ball.vy = -120; ball.born = performance.now();
    if (interrupted) run.max = Math.min(run.max, run.passes + 1);
    S.kick();
  }

  function finishRun(run, a) {
    if (a && S.actors.has(a.id)) a.say(pick(LINES.end), { ms: 2200 });
    endRun(run, a);
  }
  function endRun(run, a) {
    if (!relays.has(run)) return;
    relays.delete(run); lastEnd = performance.now();
    const ball = run.ball;
    for (const id of run.team) { const o = S.actors.get(id); if (o && o.relay === run) release(run, o); }
    if (!ball.gone) {
      ball.relayRun = null; ball.relayLock = false;
      if (ball.held) { ball.held = false; ball.fade(); }
      else { ball.picked = false; ball.born = performance.now(); if (ball.owner) { ball.owner.ball = ball; S.kick(); } }
    }
    if (run.pairs.size && S.api.relayDone) S.api.relayDone([...run.pairs].map((k) => k.split('|')));
    // 賽後互相說一句：漏接的那隻跟傳球的那隻說「下次一定接到」；不然隨便挑一對互相誇
    setTimeout(() => {
      let [x, y] = ([...run.pairs][Math.floor(Math.random() * run.pairs.size)] || '').split('|');
      const A = S.actors.get(x), B = S.actors.get(y);
      const busy = (q) => q.job && (q.job.layer || 9) < 6;                // 只在做事（不是待機小動作）時才不說
      if (!A || !B || busy(A) || busy(B) || A.mode !== 'awake' || B.mode !== 'awake') return;
      const praise = ['你剛剛那球太猛了！', '你傳得好準！', '接得好帥！', '跟你傳球好開心～', '你今天手感好好！', '那一球接得超穩！', '越傳越順了耶！'];
      const reply = ['嘿嘿，你也很厲害！', '再來一場？', '下次換我傳你！', '我們很有默契耶～', '是你傳得好啦！', '明天再練！', '下次傳快一點也可以喔！'];
      A.showLook(B.x < A.x ? 'L' : 'R'); A.say(pick(praise), { ms: 2200 });
      setTimeout(() => { if (!busy(B)) { B.showLook(A.x < B.x ? 'L' : 'R'); B.say(pick(reply), { ms: 2200 }); } }, 1500);
      setTimeout(() => { for (const q of [A, B]) if (!q.job) { q.lookBucket = null; q.showRest(); } }, 3800);
    }, 1800);
  }

  // 保險：20 秒沒有任何進展（撿、傳、接）就結束這一輪，不讓誰卡在接力裡
  setInterval(() => { const now = performance.now(); for (const r of [...relays]) { const walking = [...r.team].some((id) => { const o = S.actors.get(id); return o && o.job && o.job.name === 'relayGet'; }); if (now - (r.at || now) > (walking ? 60000 : 20000)) endRun(r, r.holder); } }, 5000);   // 還在走去撿球（寬螢幕要走比較久）：放寬到 60 秒
  S.Relay = { active: () => [...relays].map((r) => ({ age: Math.round(performance.now() - (r.at || 0)), passes: r.passes, max: r.max, holder: r.holder && r.holder.id, team: [...r.team] })) };
})();
