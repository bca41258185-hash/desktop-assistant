// 傳球接力：球落地停下 → 最近、有空的那隻去撿（不一定是丟球的那隻）→ 轉頭看要傳的同伴、拉一條視線，
//   對方轉過來舉手喊「來！」→ 拋過去（拋物線）→ 接到就換牠傳下一個；偶爾漏接，球掉到地上滾，再由最近的撿起來接著傳。
//   傳個 3～7 次結束，最後拿到球的說一句，參加的兩兩加一點好感。
(function () {
  const S = window.Stage;
  const LINES = { call: ['來！', '這邊！', '傳我！', '我準備好了！'], miss: ['啊，漏了！', '欸欸欸——', '對不起！'], end: ['好球！大家好棒！', '傳得好順！', '下次再來！', '默契越來越好了～'], start: ['大家來傳球！', '要傳囉～', '接好喔！'] };
  const pick = (l) => l[Math.floor(Math.random() * l.length)];
  const relays = new Set();

  const free = (a) => a && a.mode === 'awake' && !a.inPouch && !a.isFollow && !a.dragging && !a.relay && (!a.job || (a.job.layer || 9) >= 6) && !(a.job && a.job.name === 'fetch');
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
    const getter = mates.filter((a) => free(a) || a === owner).sort((x, y) => Math.abs(x.x - ball.x) - Math.abs(y.x - ball.x))[0];
    if (!getter) return false;
    ball.picked = true; ball.relayLock = true;
    const run = r || { ball, team: new Set(), passes: 0, max: 3 + Math.floor(Math.random() * 5), pairs: new Set(), last: null };
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
      onArrive: () => setTimeout(() => take(run, a), 30) });
    const int0 = job.interrupt;
    job.interrupt = (...x) => { if (int0) int0(...x); if (run.holder !== a) { a.relay = null; endRun(run, null); } };
    if (!a.requestActivity(4, job)) { a.relay = null; endRun(run, null); }
  }

  function take(run, a) {
    const ball = run.ball;
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
  function aim(run, a) {
    if (run.holder !== a || run.ball.gone) return;
    const cands = [...S.actors.values()].filter((o) => o !== a && (free(o) || (o.relay === run && o.job && o.job.name === 'relay')) && Math.abs(o.x - a.x) < innerWidth * .7);
    const pool = cands.filter((o) => o !== run.last).length ? cands.filter((o) => o !== run.last) : cands;
    if (!pool.length) { finishRun(run, a); return; }
    const to = pool.sort((x, y) => Math.abs(x.x - a.x) - Math.abs(y.x - a.x))[Math.random() < .7 ? 0 : Math.floor(Math.random() * pool.length)];
    if (!enlist(run, to)) { finishRun(run, a); return; }
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
    el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="M${p.x - x0} ${p.y - y0} Q${mx} ${my} ${q.x - x0} ${q.y - y0}" fill="none" stroke="#ffd86b" stroke-width="3" stroke-dasharray="6 6" stroke-linecap="round"/><circle cx="${q.x - x0}" cy="${q.y - y0}" r="6" fill="#ffd86b"/></svg>`;
    el.style.transform = `translate(${x0}px, ${y0}px)`;
    S.fxEl.appendChild(el);
    return el;
  }

  function throwTo(run, a, to) {
    const ball = run.ball, p0 = handOf(a);
    const d = Math.hypot(to.x - a.x, to.y - a.y), T = 450 + d * .55, H = Math.max(70, Math.min(260, d * .35));
    const catchOk = Math.random() < ({ shy: .78, sleepy: .8, athlete: .96 }[((to.traits || {}).personality || {}).archetype] || .9);
    run.holder = null; run.last = a; release(run, a);
    const t0 = performance.now();
    const step = (now) => {
      if (ball.gone) return;
      const u = Math.min(1, (now - t0) / T), p1 = handOf(to);
      ball.x = p0.x + (p1.x - p0.x) * u; ball.y = p0.y + (p1.y - p0.y) * u - H * 4 * u * (1 - u);
      ball.rot += 9; ball.place();
      if (u < 1) { requestAnimationFrame(step); return; }
      if (to.relay !== run || !S.actors.has(to.id)) { dropBall(run, to, false); return; }
      if (!catchOk) { to.say(pick(LINES.miss), { ms: 1300 }); dropBall(run, to, false); return; }
      run.passes++; run.pairs.add([a.id, to.id].sort().join('|'));
      take(run, to);
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
    relays.delete(run);
    const ball = run.ball;
    for (const id of run.team) { const o = S.actors.get(id); if (o && o.relay === run) release(run, o); }
    if (!ball.gone) { ball.relayRun = null; ball.relayLock = false; if (ball.held) { ball.held = false; ball.fade(); } }
    if (run.pairs.size && S.api.relayDone) S.api.relayDone([...run.pairs].map((k) => k.split('|')));
  }

  S.Relay = { active: () => [...relays].map((r) => ({ passes: r.passes, max: r.max, holder: r.holder && r.holder.id, team: [...r.team] })) };
})();
