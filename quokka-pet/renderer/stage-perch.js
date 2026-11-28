// 爬到桌面上別的視窗上緣站著：偶爾有一隻（愛探險、運動型的比較常）跳上去看風景；
//   視窗被拖動 → 牠跟著走（動太快會喊一聲）；視窗關掉、縮小、被別的視窗蓋住 → 牠掉回地面。
//   視窗位置由主行程提供（只有位置，沒有內容）；沒有可以站的視窗就什麼都不做。
(function () {
  const S = window.Stage;
  if (!S.api.windowEdges) return;
  const pick = (l) => l[Math.floor(Math.random() * l.length)];
  const perched = new Set();
  let watching = false, lastTry = performance.now();
  const W = { explorer: 3, athlete: 2, clingy: 1, easy: 1, cool: .8, sleepy: .6, shy: .4 };
  const arch = (a) => ((a.traits || {}).personality || {}).archetype || 'easy';
  const LAND = {
    explorer: ['上面的風景好好！', '發現新地方！', '從這裡看得好遠～'], athlete: ['一跳就上來了！', '這個高度剛剛好！', '上來熱身一下！'],
    sleepy: ['這裡曬得到太陽……', '上面比較安靜，適合睡。'], shy: ['（躲在上面偷看）', '這裡……比較沒人。'],
    cool: ['還行。', '視野不錯。'], clingy: ['你看我在這裡～', '從這裡看得到你！'], easy: ['上來坐坐～', '這裡不錯耶。']
  };
  const fit = (e) => e.y > 260 && e.y < innerHeight - 170 && e.x2 - e.x1 >= 170 && e.x1 < innerWidth - 60 && e.x2 > 60;
  const edgesNow = async () => { const r = await S.api.windowEdges().catch(() => null); return r && r.ready ? r.edges || [] : null; };

  async function tryClimb(force) {
    if (S.mode === 'hidden' || S.reduceMotion || perched.size >= 2) return false;
    const cands = [...S.actors.values()].filter((a) => a.mode === 'awake' && !a.job && !a.inPouch && !a.isFollow && !a.dragging && !a.perch && !a.holding && !a.relay && !a.releasing && !a.giftFor);
    if (!cands.length) return false;
    let list = await edgesNow();
    if (list === null) { await new Promise((r) => setTimeout(r, 2600)); list = await edgesNow(); }      // 第一次問：等視窗清單準備好
    list = (list || []).filter(fit);
    if (!list.length) return false;
    let r = Math.random() * cands.reduce((n, a) => n + (W[arch(a)] || 1), 0), a = cands[0];
    for (const c of cands) { r -= W[arch(c)] || 1; if (r <= 0) { a = c; break; } }
    if (a.job || a.dragging || a.mode !== 'awake') return false;
    const e = list.sort((p, q) => Math.abs((p.x1 + p.x2) / 2 - a.x) - Math.abs((q.x1 + q.x2) / 2 - a.x))[Math.random() < .6 ? 0 : Math.floor(Math.random() * list.length)];
    const lo = Math.max(e.x1 + 45, 40), hi = Math.min(e.x2 - 45, innerWidth - 40);
    if (hi < lo) return false;
    // 落點：在上緣範圍內、離現在的位置至少 70（太近的話散步會自己改目的地）；不用跟別隻保持距離（不同高度）
    let tx = lo + Math.random() * (hi - lo);
    if (Math.abs(tx - a.x) < 70) tx = a.x + 70 <= hi ? a.x + 70 + Math.random() * Math.min(60, hi - a.x - 70) : a.x - 70 >= lo ? a.x - 70 : (lo + hi) / 2;
    const all = new Set(S.actors.values()), inside = () => a.x >= e.x1 + 20 && a.x <= e.x2 - 20;
    const job = a.walkJob(S.clamp(tx, lo, hi), { name: 'climb', noPause: true, gait: 'hop', cursorOk: true, y: e.y, ignore: all,
      onArrive: () => {
        if (Math.abs(a.y - e.y) >= 14) return;
        if (inside()) { land(a, e); return; }
        // 跳偏了：在同一個高度再跳一步到上緣上
        setTimeout(() => { if (a.job || a.dragging) return; const j2 = a.walkJob(S.clamp(a.x, lo, hi), { name: 'climb', noPause: true, gait: 'hop', cursorOk: true, ignore: all, onArrive: () => { if (Math.abs(a.y - e.y) < 14 && inside()) land(a, e); } }); a.requestActivity(6, j2); S.kick(); }, 60);
      } });
    if (!a.requestActivity(force ? 5 : 6, job)) return false;
    a.say(pick(['我去上面看看～', '那個視窗上面好像不錯！', '爬上去瞧瞧！']), { ms: 1700 });
    S.kick();
    return true;
  }
  function land(a, e) {
    a.perch = { id: e.id, dx: a.x - e.wl, y: e.y, since: performance.now() };
    perched.add(a);
    a.home = a.x; a.homeY = a.y;
    a.nextAt = performance.now() + 35000 + Math.random() * 45000;              // 在上面待一陣子再走
    setTimeout(() => { if (a.perch && S.actors.has(a.id)) a.say(pick(LAND[arch(a)] || LAND.easy), { ms: 2400 }); }, 500);
    if (!watching) { watching = true; watch(); }
  }
  function leave(a) { a.perch = null; perched.delete(a); }
  // 腳下的視窗不見了：掉回地面（重力），落地說一句
  function fall(a) {
    leave(a);
    if (!S.actors.has(a.id) || a.dragging) return;
    if (a.job) { try { S.failJob(a); } catch (err) { /* 收尾失敗就算了 */ } }
    a.say(pick(['哇啊——', '欸？！地板呢！', '啊啊啊～']), { ms: 1200 });
    const y0 = a.y, y1 = innerHeight - 4, t0 = performance.now(), T = Math.max(260, Math.sqrt((y1 - y0) / 900) * 1000 * .9);
    a.falling = true;
    const step = (now) => {
      if (!S.actors.has(a.id) || a.dragging) { a.falling = false; return; }
      const u = Math.min(1, (now - t0) / T);
      a.y = y0 + (y1 - y0) * u * u; a.place();
      if (u < 1) { requestAnimationFrame(step); return; }
      a.falling = false; a.homeY = a.y; a.home = a.x;
      if (S.api.savePos) S.api.savePos(a.id, { x: Math.round(a.x), y: Math.round(a.y) });
      setTimeout(() => { if (S.actors.has(a.id) && !a.job) a.say(pick(arch(a) === 'athlete' ? ['完美落地！', '這點高度沒問題！'] : arch(a) === 'explorer' ? ['再來一次！好好玩！', '原來會掉下來呀！'] : ['嚇我一跳……', '呼，還好沒事。', '視窗怎麼不見了……']), { ms: 2000 }); }, 350);
      S.reportRects(); S.kick();
    };
    requestAnimationFrame(step);
  }
  async function watch() {
    while (perched.size) {
      await new Promise((r) => setTimeout(r, 250));
      const list = await edgesNow();
      for (const a of [...perched]) {
        const p = a.perch;
        if (!p || !S.actors.has(a.id) || a.inPouch || a.releasing) { leave(a); continue; }
        if (a.dragging) { leave(a); continue; }                                  // 被主人拎走
        if (a.job && (a.job.name === 'walk' || a.job.name === 'social' || a.job.name === 'relayGet' || a.job.name === 'pickup' || a.job.name === 'toLayer' || a.job.name === 'askGift')) { leave(a); continue; }   // 自己走掉了
        if (list === null) continue;                                             // 視窗清單暫時沒有：先不動
        const nx = p.dx, e = list.find((x) => x.id === p.id && x.wl + nx >= x.x1 - 6 && x.wl + nx <= x.x2 + 6);
        if (!e || !fit({ ...e, x1: e.x1 - 200, x2: e.x2 + 200 }) || e.wl + nx < 20 || e.wl + nx > innerWidth - 20) { fall(a); continue; }
        const tx = e.wl + nx, moved = Math.hypot(tx - a.x, e.y - a.y);
        if (moved < 1) continue;
        a.x = tx; a.y = e.y; p.y = e.y; a.home = a.x; a.homeY = a.y; a.place();
        if (moved > 70 && performance.now() - (p.saidAt || 0) > 4000) { p.saidAt = performance.now(); a.say(pick(['哇，抓緊！', '慢一點啦～', '要去哪裡呀？', '好晃！']), { ms: 1400 }); }
        S.reportRectsThrottled ? S.reportRectsThrottled() : S.reportRects();
      }
    }
    watching = false;
  }
  // 每 3～5 分鐘看一次要不要有誰爬上去（視窗清單平常不開，問的時候才開）
  setInterval(() => {
    const now = performance.now();
    if (now - lastTry < 180000 + Math.random() * 120000) return;
    lastTry = now;
    if (Math.random() < .7) tryClimb(false).catch(() => {});
  }, 20000);
  S.Perch = { tryClimb: (f) => tryClimb(f !== false), perched: () => [...perched].map((a) => a.id) };
})();
