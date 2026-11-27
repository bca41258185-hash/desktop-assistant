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
    if (PLAY.has(item)) {
      // 球類：多半會去找同伴一起玩（害羞、酷酷的比較常自己玩）；找不到有空的就自己玩
      const ar = (a.traits && a.traits.personality && a.traits.personality.archetype) || 'easy';
      if (item !== 'eat' && Math.random() < ({ shy: .45, cool: .4, sleepy: .55 }[ar] || .8)) {
        const r = await S.api.playWith({ qid: a.id, item }).catch(() => null);
        if (r && r.ok) { a.say(r.stranger ? `${r.with}，要不要一起${NAME[item] === '羽球拍' ? '打羽球' : '打' + NAME[item]}？` : `${r.with}！來${NAME[item] === '羽球拍' ? '打羽球' : '打' + NAME[item]}！`, { ms: 2200 }); return; }
      }
      if (!a.play(item)) a.say('等我一下～', { ms: 1600 });
      return;
    }
    if (!prepaid) { choose(a, item); return; }                          // 你放到牠身上的禮物：牠自己決定自己用還是送給誰
    const r = await S.api.useItem({ qid: a.id, item, prepaid }).catch(() => null);
    if (!r || !r.ok) a.say((r && r.message) || `${NAME[item]}送不出去`, { ms: 2600 });
    else a.say(`我拿${NAME[item]}去給${r.to}！`, { ms: 2000 });
  }

  // ---- 你給牠的禮物：先拿在手上；過一陣子（看個性 20 秒～1 分半）牠自己決定要自己吃、留著，還是拿去送誰 ----
  const pickOne = (l) => l[Math.floor(Math.random() * l.length)];
  const holdEls = new Map();                                            // qid → 手上那個道具的元素
  const PATIENCE = { athlete: [15, 40], clingy: [15, 45], explorer: [20, 60], easy: [30, 80], shy: [40, 100], sleepy: [50, 120], cool: [40, 100] };
  function setHolding(a, item) {
    a.holding = item || null;
    let el = holdEls.get(a.id);
    if (!item) { if (el) { el.remove(); holdEls.delete(a.id); } return; }
    if (!el) { el = document.createElement('div'); el.className = 'item-hand'; S.fxEl.appendChild(el); holdEls.set(a.id, el); }
    el.textContent = ICON[item];
    const [lo, hi] = PATIENCE[(a.traits && a.traits.personality && a.traits.personality.archetype) || 'easy'] || [30, 80];
    a.holdDecideAt = performance.now() + (lo + Math.random() * (hi - lo)) * 1000;
    follow();
  }
  // 手上的道具跟著牠（抱在胸前、手的位置）；正在送禮物（那段動畫自己會畫禮物）、在育兒袋裡時先藏起來
  function follow() {
    for (const [id, el] of holdEls) {
      const a = S.actors.get(id);
      if (!a) { el.remove(); holdEls.delete(id); continue; }
      const hide = a.inPouch || (a.job && a.job.name === 'social') || S.mode === 'hidden';
      el.hidden = !!hide;
      if (hide) continue;
      const p = a.toStage(88, 112), sz = Math.round(26 * a.k / .8);
      el.style.fontSize = sz + 'px';
      el.style.transform = `translate(${(p.x - sz / 2).toFixed(1)}px, ${(p.y - sz / 2).toFixed(1)}px) rotate(-10deg)`;
      el.style.zIndex = (a.z || 0) + 1;
    }
    if (holdEls.size) requestAnimationFrame(follow);
  }
  const hearts = (a) => { if (S.burst) { const p = a.toStage(80, 40); S.burst(p.x, p.y, 'hearts'); } };
  async function choose(a, item, prepaid) {
    if (a.holding && item !== 'snack') { a.say(`我手上已經有${NAME[a.holding]}了～`, { ms: 2000 }); if (prepaid) S.api.refundItem(item); return; }
    const r = await S.api.holdItem({ qid: a.id, item, prepaid: !!prepaid }).catch(() => null);
    if (!r || !r.ok) { a.say((r && r.message) || `${NAME[item]}拿不到`, { ms: 2400 }); return; }
    if (r.eatNow) { a.play('eat'); a.say(pickOne(['點心！謝謝！我直接吃掉～', '手上拿不下了，那就馬上吃！', '好好吃！']), { ms: 2200 }); return; }
    if (!holdEls.size) setTimeout(() => requestAnimationFrame(follow), 0);
    setHolding(a, item);
    hearts(a);
    a.say(pickOne(item === 'rose' ? ['哇，玫瑰！謝謝你！', '好香～我先拿著！', '給我的？嘿嘿 ♥'] : ['點心！謝謝！', '先拿著，等一下再想要怎麼吃～', '好香喔！']), { ms: 2200 });
  }
  // 每 3 秒看一下：手上有禮物、時間到了、醒著、沒在忙 → 問主行程牠決定怎麼做
  setInterval(async () => {
    const now = performance.now();
    for (const a of S.actors.values()) {
      if (!a.holding || now < (a.holdDecideAt || 0) || a.mode !== 'awake' || a.dragging || a.inPouch || (a.job && a.job.layer <= 5) || a.deciding) continue;
      a.deciding = true;
      const item = a.holding;
      const r = await S.api.heldDecide(a.id, a.giftFor && a.giftTries < 6 ? a.giftFor : null).catch(() => null);
      a.deciding = false;
      if (!r || !r.ok) { a.holdDecideAt = now + 30000; continue; }
      if (r.pending) {                                                   // 對方在忙：走過去開口問，等牠忙完再給
        const first = a.askedFor !== r.toId;                             // 第一次等這一隻：先走過去開口
        a.giftFor = r.toId; a.askedFor = r.toId; a.giftTries = first ? 1 : (a.giftTries || 0) + 1;
        const o = S.actors.get(r.toId);
        if (o && first) {
          const side = o.x > a.x ? -1 : 1, tx = S.clamp(o.x + side * 110 * a.k, 60, innerWidth - 60);
          const job = a.walkJob(tx, { name: 'askGift', noPause: true, y: Math.abs(o.y - a.y) > 30 ? o.y : null,
            onArrive: () => a.say(r.stranger ? `${r.to}你好～我有${NAME[item]}想給你，等你忙完喔！` : `${r.to}，等你忙完，有${NAME[item]}要給你！`, { ms: 2800 }) });
          if (!a.requestActivity(7, job)) a.say(`等${r.to}忙完，我要把${NAME[item]}給牠～`, { ms: 2400 });
        } else if (Math.random() < .5) a.say(pickOne([`${r.to}忙完了嗎？`, `再等${r.to}一下下～`, `${NAME[item]}要給${r.to}的！`]), { ms: 2000 });
        a.holdDecideAt = performance.now() + (6 + Math.random() * 5) * 1000;
        if (a.giftTries >= 6) { a.giftFor = null; a.askedFor = null; a.giftTries = 0; }       // 等太久了：之後再想要給誰
        continue;
      }
      a.giftFor = null; a.askedFor = null; a.giftTries = 0;
      if (r.wait) { a.holdDecideAt = performance.now() + (20 + Math.random() * 40) * 1000; if (Math.random() < .4) a.say(pickOne(['這個要給誰好呢……', '再拿一下下～', '捨不得用掉耶。']), { ms: 2000 }); continue; }
      setHolding(a, null);
      if (r.self) {
        if (item === 'snack') { a.play('eat'); a.say(pickOne(['我決定自己吃！', '嘿嘿，這個我要自己吃～', '好好吃！'])); }
        else { hearts(a); a.say(pickOne(['這朵我要自己留著！', '送給我自己 ♥', '好香～放在家裡。'])); }
      } else a.say(r.stranger ? pickOne([`我去問${r.to}要不要${NAME[item]}～`, `${r.to}還不熟，送個${NAME[item]}交朋友！`, `${r.to}，這個${NAME[item]}給你，當朋友好嗎？`]) : `我要把${NAME[item]}拿去給${r.to}！`, { ms: 2400 });
    }
  }, 3000);
  // 重開程式：手上的東西還在
  S.api.onQuokkas && S.api.onQuokkas((list) => setTimeout(() => { for (const q of list || []) { const a = q && S.actors.get(q.id); if (a && (q.holding || null) !== (a.holding || null)) setHolding(a, ICON[q.holding] ? q.holding : null); } }, 0));
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

  async function drop(item, x, y, vx = 0, vy = 0) {
    const cap = (v, m) => Math.max(-m, Math.min(m, v));
    vx = cap(vx, 1600); vy = cap(vy, 1400);
    // 排球、籃球：變成真的球，交給最近的那隻（球停下來牠就會去撿，抱回自己站的地方）
    if (BALL[item]) {
      const a = finder(x);
      if (a) { a.throwX = a.x; new S.Ball(a, BALL[item], x, Math.min(y, a.y - 20), vx * a.k, vy * a.k, null); a.say(Math.hypot(vx, vy) > 500 ? '球飛出去了！我去撿！' : '咦，有球！', { ms: 1600 }); return; }
    }
    if (!PLAY.has(item)) {
      const r = await S.api.groundItem(item).catch(() => null);
      if (!r || !r.ok) return;
    }
    const g = { item, x, y, vx: vx * .6, vy: Math.min(vy, 0) * .6, el: mk('item-ground', item), floor: floorNear(x), born: performance.now(), tries: new Set(), who: null };
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
      g.vy += 2200 * dt; g.y += g.vy * dt; g.x += g.vx * dt;
      if (g.x < 20 || g.x > innerWidth - 20) { g.x = S.clamp(g.x, 20, innerWidth - 20); g.vx = -g.vx * .5; }      // 碰到螢幕邊彈回來
      if (g.y >= g.floor) {
        g.y = g.floor; g.vx *= .8;
        if (g.vy > 300) g.vy = -g.vy * .35;
        else { g.vy = 0; if (Math.abs(g.vx) > 30) { g.vx *= Math.pow(.05, dt); } else { place(g); g.landed = true; fetchSoon(g, 300); return; } }   // 甩出去的在地上滑一下才停
      }
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
    const job = a.walkJob(g.x, { name: 'pickup', noPause: true, gait: 'hop', cursorOk: true, y: Math.abs(g.y - a.y) > 30 ? g.y : null, onArrive: () => { if (Math.abs(a.x - g.x) < 140 * a.k) pick(a, g); } });
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
    if (PLAY.has(g.item)) { use(a, g.item, false); return; }
    choose(a, g.item, true);                                            // 撿到禮物：先拿在手上，之後自己決定
  }

  // 道具籃用：在舞台上直接拿著道具（不經過面板）；放開時看放在哪、甩多快
  const hold = {
    begin(item) { clear(); held = { item, el: mk('item-held', item) }; },
    move(x, y) {
      if (!held) return;
      held.el.style.transform = `translate(${x - 18}px, ${y - 30}px) rotate(-12deg)`;
      setOver(actorAt(x, y));
      // 拿著道具經過：附近醒著、沒事做的抬頭說一句（每隻 4 秒最多一次）
      const now = performance.now();
      for (const a of S.actors.values()) {
        if (a === over || !canUse(a) || a.mode !== 'awake' || a.job || Math.hypot(a.x - x, (a.y - a.h * .5) - y) > 260 || now - (a.itemSeeAt || 0) < 4000) continue;
        a.itemSeeAt = now; a.say(SEE[held.item] || '那是什麼？', { ms: 1300 });
      }
    },
    end(x, y, vx, vy) {
      const item = held && held.item; clear();
      if (!item) return;
      const a = actorAt(x, y);
      if (a && Math.hypot(vx, vy) < 900) use(a, item, false);
      else drop(item, x, y, vx, vy);
    },
    cancel() { clear(); },
    get item() { return held ? held.item : null; }
  };
  S.Items = { hold, rects: () => [], ground: () => [...ground].map((g) => ({ item: g.item, x: g.x, y: g.y, landed: !!g.landed })), held: () => (held ? held.item : null) };
})();
