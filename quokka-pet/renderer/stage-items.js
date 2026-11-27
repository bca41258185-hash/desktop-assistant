// 道具包：從面板把道具拖出來（主行程每格送游標位置來），道具跟著游標；經過哪一隻，牠身上亮虛線圈、抬頭說一句
//   放在某隻身上 → 牠拿去用：球就玩、葉子就吃、玫瑰／點心拿去送給牠想送的那隻
//   放在空地上 → 道具掉到地上；排球、籃球變成真的球（會彈、會滾），最近醒著的那隻去撿；
//                其他道具掉在地上，最近醒著的那隻走過去撿起來用。60 秒沒人撿就消失（禮物退回道具包）
(function () {
  const S = window.Stage;
  const ICON = { badminton: '🏸', volleyball: '🏐', basketball: '🏀', eat: '🌿', rose: '🌹', snack: '🍪' };
  const NAME = { badminton: '羽球拍', volleyball: '排球', basketball: '籃球', eat: '葉子', rose: '玫瑰', snack: '點心' };
  const PLAY = new Set(['badminton', 'volleyball', 'basketball', 'eat']);
  const BALL = { volleyball: 'vball', basketball: 'bball' };
  const SEE = { badminton: '要打羽球嗎？', volleyball: '排球！', basketball: '籃球！', eat: '葉子！好香～', rose: '玫瑰？給我的嗎！', snack: '點心！' };
  const LIFE_MS = 60000;
  let held = null, ring = null, over = null;
  const ground = new Set();

  const canUse = (a) => a && !a.inPouch && !a.isFollow && !a.releasing;
  function actorAt(x, y) {
    let best = null;
    for (const a of S.actors.values()) {
      const r = a.rect;
      if (!r || a.inPouch || x < r.x - 10 || x > r.x + r.w + 10 || y < r.y - 10 || y > r.y + r.h + 10) continue;
      if (!best || a.y > best.y) best = a;
    }
    return best;
  }
  function mk(cls, item) { const el = document.createElement('div'); el.className = cls; el.textContent = ICON[item] || '❔'; S.fxEl.appendChild(el); return el; }
  function setOver(a) {
    if (a === over) return;
    over = a;
    if (!a) { if (ring) ring.hidden = true; return; }
    if (!ring) { ring = document.createElement('div'); ring.className = 'item-ring'; S.fxEl.appendChild(ring); }
    const r = a.rect; ring.hidden = false;
    Object.assign(ring.style, { left: r.x - 12 + 'px', top: r.y - 8 + 'px', width: r.w + 24 + 'px', height: r.h + 16 + 'px' });
    if (held && a.mode === 'awake' && canUse(a) && !a.job) a.say(SEE[held.item] || '這是什麼？', { ms: 1400 });
  }
  function clear() { if (held) held.el.remove(); held = null; setOver(null); }

  S.api.onItemCarry && S.api.onItemCarry((p) => {
    if (!p || !ICON[p.item]) return;
    if (!held || held.item !== p.item) { clear(); held = { item: p.item, el: mk('item-held', p.item) }; }
    held.el.style.transform = `translate(${p.x - 18}px, ${p.y - 30}px) rotate(-12deg)`;
    setOver(actorAt(p.x, p.y));
  });
  S.api.onItemDrop && S.api.onItemDrop((p) => {
    clear();
    if (!p || !ICON[p.item] || p.cancel) return;
    const a = actorAt(p.x, p.y);
    if (a) use(a, p.item, false);
    else drop(p.item, p.x, p.y);
  });

  // 牠拿去用
  async function use(a, item, prepaid) {
    if (!canUse(a)) { a.say('我還太小了……', { ms: 1800 }); if (prepaid) S.api.refundItem(item); return; }
    if (a.mode !== 'awake') { a.say('Zzz……', { ms: 1600 }); if (prepaid) S.api.refundItem(item); return; }
    if (PLAY.has(item)) { if (!a.play(item)) a.say('等我一下～', { ms: 1600 }); return; }
    if (!prepaid) { choose(a, item); return; }                          // 你放到牠身上的禮物：讓你選自己用還是送給誰
    const r = await S.api.useItem({ qid: a.id, item, prepaid }).catch(() => null);
    if (!r || !r.ok) a.say((r && r.message) || `${NAME[item]}送不出去`, { ms: 2600 });
    else a.say(`我拿${NAME[item]}去給${r.to}！`, { ms: 2000 });
  }

  // ---- 禮物選單：在牠頭上浮出「自己用」和「送給○○」，點一個；8 秒沒選就收起來（禮物不會用掉） ----
  let menu = null;
  const SELF = { rose: '🌹 自己收下', snack: '🍪 自己吃' };
  function closeMenu() { if (!menu) return; clearTimeout(menu.timer); menu.el.remove(); menu = null; S.reportRects(); }
  function choose(a, item) {
    closeMenu();
    const others = [...S.actors.values()].filter((o) => o !== a && canUse(o)).sort((x, y) => Math.abs(x.x - a.x) - Math.abs(y.x - a.x)).slice(0, 6);
    const el = document.createElement('div'); el.className = 'gift-menu';
    el.innerHTML = `<div class="gm-t">${ICON[item]} ${NAME[item]}要怎麼用？</div>
      <button type="button" class="gm-b self" data-to="">${SELF[item]}</button>
      ${others.map((o) => `<button type="button" class="gm-b" data-to="${o.id}">送給${String(o.name || '').replace(/[&<>"]/g, '')}</button>`).join('')}`;
    S.fxEl.appendChild(el);
    const r = a.rect, w = el.offsetWidth, h = el.offsetHeight;
    const x = S.clamp(r.x + r.w / 2 - w / 2, 6, innerWidth - w - 6), y = Math.max(6, r.y - h - 58);          // 在牠自己的對話泡泡上面
    el.style.left = x + 'px'; el.style.top = y + 'px';
    menu = { el, a, rect: { id: a.id, kind: 'giftmenu', x: Math.round(x) - 4, y: Math.round(y) - 4, w: Math.round(w) + 8, h: Math.round(h) + 8 }, timer: setTimeout(closeMenu, 8000) };
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('.gm-b'); if (!b) return;
      const to = b.dataset.to; closeMenu();
      if (!to) {                                                        // 自己用
        const r2 = await S.api.selfItem({ qid: a.id, item }).catch(() => null);
        if (!r2 || !r2.ok) { a.say((r2 && r2.message) || `${NAME[item]}用完了`, { ms: 2200 }); return; }
        if (item === 'snack') { a.play('eat'); a.say('好好吃！', { ms: 1800 }); } else { a.play('hop'); a.say('好香～我好喜歡！', { ms: 2000 }); }
        return;
      }
      const r3 = await S.api.useItem({ qid: a.id, item, to }).catch(() => null);
      if (!r3 || !r3.ok) a.say((r3 && r3.message) || `${NAME[item]}送不出去`, { ms: 2600 });
      else a.say(`我拿${NAME[item]}去給${r3.to}！`, { ms: 2000 });
    });
    S.reportRects();
  }
  document.addEventListener('mousedown', (e) => { if (menu && !e.target.closest('.gift-menu')) closeMenu(); }, true);
  S.api.onItemOffer && S.api.onItemOffer((p) => { const a = p && S.actors.get(p.qid); if (a && ICON[p.item]) { if (a.mode !== 'awake') a.say('Zzz……', { ms: 1600 }); else choose(a, p.item); } });

  // 最近、醒著、有空的那一隻
  function finder(x, skip) {
    let best = null;
    for (const a of S.actors.values()) {
      if (!canUse(a) || a.mode !== 'awake' || a.dragging || (skip && skip.has(a.id))) continue;
      if (a.job && a.job.layer <= 4) continue;
      if (!best || Math.abs(a.x - x) < Math.abs(best.x - x)) best = a;
    }
    return best;
  }
  const floorNear = (x) => { const a = finder(x) || [...S.actors.values()][0]; return a ? a.y : innerHeight - 4; };

  async function drop(item, x, y) {
    // 排球、籃球：變成真的球，交給最近的那隻（球停下來牠就會去撿，抱回自己站的地方）
    if (BALL[item]) {
      const a = finder(x);
      if (a) { a.throwX = a.x; new S.Ball(a, BALL[item], x, Math.min(y, a.y - 20), 0, 0, null); a.say('咦，有球！', { ms: 1600 }); return; }
    }
    if (!PLAY.has(item)) {
      const r = await S.api.groundItem(item).catch(() => null);
      if (!r || !r.ok) return;
    }
    const g = { item, x, y, vy: 0, el: mk('item-ground', item), floor: floorNear(x), born: performance.now(), tries: new Set(), who: null };
    ground.add(g);
    place(g);
    fall(g);
  }
  function place(g) { g.el.style.transform = `translate(${g.x - 16}px, ${g.y - 32}px)`; }
  function fall(g) {
    let last = performance.now();
    const step = (now) => {
      if (!ground.has(g)) return;
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      g.vy += 2200 * dt; g.y += g.vy * dt;
      if (g.y >= g.floor) { g.y = g.floor; if (g.vy > 300) g.vy = -g.vy * .35; else { place(g); g.landed = true; fetchSoon(g, 400); return; } }
      place(g); requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function remove(g, refund) {
    if (!ground.has(g)) return;
    ground.delete(g); clearTimeout(g.timer);
    g.el.classList.add('fade'); setTimeout(() => g.el.remove(), 500);
    if (refund && !PLAY.has(g.item)) S.api.refundItem(g.item);
  }
  function fetchSoon(g, ms) { clearTimeout(g.timer); g.timer = setTimeout(() => fetchIt(g), ms); }
  function fetchIt(g) {
    if (!ground.has(g)) return;
    if (performance.now() - g.born > LIFE_MS) { remove(g, true); return; }
    if (g.who) return;
    const a = finder(g.x, g.tries);
    if (!a) { g.tries.clear(); fetchSoon(g, 2500); return; }
    if (Math.abs(a.x - g.x) < 110 * a.k) { pick(a, g); return; }
    const job = a.walkJob(g.x, { name: 'pickup', noPause: true, gait: 'hop', cursorOk: true, onArrive: () => { if (Math.abs(a.x - g.x) < 140 * a.k) pick(a, g); } });
    const int0 = job.interrupt;
    job.interrupt = (...x) => { if (int0) int0(...x); if (g.who === a) { g.who = null; g.tries.add(a.id); fetchSoon(g, 1500); } };
    const end0 = job.end;
    job.end = () => { if (end0) end0(); if (g.who === a) { g.who = null; g.tries.add(a.id); fetchSoon(g, 1500); } };
    g.who = a;
    if (!a.requestActivity(4, job)) { g.who = null; g.tries.add(a.id); fetchSoon(g, 2000); return; }
    a.say(SEE[g.item] || '咦？', { ms: 1400 });
  }
  function pick(a, g) {
    if (!ground.has(g)) return;
    g.who = null; ground.delete(g); clearTimeout(g.timer); g.el.remove();
    use(a, g.item, !PLAY.has(g.item));
  }

  S.Items = { rects: () => (menu ? [menu.rect] : []), ground: () => [...ground].map((g) => ({ item: g.item, x: g.x, y: g.y, landed: !!g.landed })), held: () => (held ? held.item : null) };
})();
