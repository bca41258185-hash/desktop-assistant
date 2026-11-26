// 舞台圖層（畫面端）：接上主行程的事件（規格 1.5 節 IPC 合約）
// 核心在 stage-core.js（快取、迴圈、範圍回報），球在 stage-ball.js，氣泡在 stage-bubble.js，
// 每隻的狀態機在 stage-actor.js。這裡只負責：名單增刪改、把事件分給負責的那隻、模式（睡覺／回來／隱藏）。
(function () {
  const S = window.Stage, api = S.api;
  const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 80;
  const actorOf = (qid) => (isId(qid) ? S.actors.get(qid) : null);
  let awayNow = false;

  // ---- 名單 ----------------------------------------------------------------------
  function placeNew(q, i, n) {
    // 新來的：從右往左排，隻數多時自動縮小間距，保證都在螢幕內
    if (!q.pos || !isFinite(q.pos.x) || q.pos.x < 20 || q.pos.x > innerWidth - 20) {
      const gap = Math.max(36, Math.min(220, (innerWidth - 200) / Math.max(1, n)));
      q.pos = { x: Math.round(innerWidth - 120 - i * gap), y: innerHeight - 6 };
    }
  }
  function add(q, i = S.actors.size, n = S.actors.size + 1) {
    if (!q || !isId(q.id) || S.actors.has(q.id)) return;
    placeNew(q, i, n);
    const a = new S.Actor(q);
    S.actors.set(q.id, a);
    if (S.mode !== 'awake') a.setMode(S.mode);
  }
  function remove(qid) {
    const a = actorOf(qid);
    if (!a) return;
    a.destroy(); S.actors.delete(qid);
    S.reportRects();
  }
  // 育兒袋期的小袋鼠不是獨立的 Actor：畫在媽媽的育兒袋口（S.family.setPouch）
  const isPouch = (q) => q && (q.stage === 'pouch' || (q.traits && q.traits.stage === 'pouch'));
  let pouchList = [];
  const setPouch = (list) => { pouchList = list; S.family.setPouch(list); };
  // 剛出袋（變成跟隨期）的小袋鼠：從媽媽腳邊冒出來
  function addNear(q) {
    const mom = actorOf(q.mom) || actorOf(q.dad);
    if (mom && (q.stage === 'follow' || !q.pos)) q.pos = { x: Math.round(mom.x + (mom.faceDir > 0 ? -1 : 1) * 16), y: Math.round(mom.y) };
    add(q);
    const a = actorOf(q.id);
    if (a && mom && q.stage === 'follow') { const p = a.toStage(80, 60); S.burst(p.x, p.y, 'stars'); }
  }
  function setList(list) {
    if (!Array.isArray(list)) return;
    const seen = new Set();
    setPouch(list.filter(isPouch));
    list = list.filter((q) => !isPouch(q));
    list.slice(0, 500).forEach((q, i) => {
      if (!q || !isId(q.id)) return;
      seen.add(q.id);
      if (S.actors.has(q.id)) S.actors.get(q.id).applyData(q);
      else if (q.stage === 'follow' && S.actors.size) addNear(q);
      else add(q, i, list.length);
    });
    for (const id of [...S.actors.keys()]) if (!seen.has(id)) remove(id);
    S.family.setPouch(pouchList);
    S.reportRects(); S.kick();
  }
  api.onQuokkas(setList);
  api.onInit((p) => setList(p && p.actors));
  api.onAdd((p) => { const q = p && p.q ? p.q : p; if (!q) return; if (isPouch(q)) setPouch(pouchList.filter((x) => x.id !== q.id).concat([q])); else if (q.stage === 'follow') addNear(q); else add(q); S.reportRects(); S.kick(); });
  api.onUpdate((p) => {
    const q = p && p.q ? p.q : p; if (!q) return;
    const a = actorOf(q.id);
    if (isPouch(q)) { if (a) remove(q.id); setPouch(pouchList.filter((x) => x.id !== q.id).concat([q])); return; }
    if (pouchList.some((x) => x.id === q.id)) setPouch(pouchList.filter((x) => x.id !== q.id));     // 出袋了
    if (!a) { if (q.stage === 'follow') addNear(q); else add(q); S.kick(); return; }
    a.applyData(q);                                                     // 階段變了（跟隨期 → 亞成體）會自己播長大動畫
    S.kick();
  });
  api.onRemove((p) => { const id = p && typeof p === 'object' ? p.qid : p; if (pouchList.some((x) => x.id === id)) setPouch(pouchList.filter((x) => x.id !== id)); remove(id); });
  api.onSettings((p) => {
    if (!p) return;
    if (['carry', 'nudge', 'alternate'].includes(p.fetchReturn)) S.settings.fetchReturn = 'carry';   // 回程一律抱回來（舊設定值都當成 carry）
    if (['home', 'screen', 'off'].includes(p.walk)) S.settings.walk = p.walk;
    if (['system', 'on', 'off'].includes(p.reducedMotion)) S.settings.reducedMotion = p.reducedMotion;
    S.reduceMotion = S.settings.reducedMotion === 'on' ? true : S.settings.reducedMotion === 'off' ? false : S.systemReduce;
    document.body.classList.toggle('reduce', S.reduceMotion);
    // 改成不散步：正在走的原地停下
    if (S.settings.walk === 'off' || S.reduceMotion) for (const a of S.actors.values()) if (a.job && a.job.name === 'walk') { const j = a.job; a.job = null; j.interrupt(); a.th = Math.round(a.th / 15) * 15; a.setLayer(8); a.showRest(); }
  });

  // ---- 社交：兩隻共用一個「雙人動畫」（stage-social.js） -------------------------------
  api.onSocialStart((p) => { if (p && isId(p.pairId)) S.startSocial(p); });
  api.onSocialAbort((p) => { if (!p || !isId(p.pairId)) return; for (const a of [...S.actors.values()]) a.endSocial(p.pairId); });

  // ---- 工作事件 ------------------------------------------------------------------
  const KINDS = new Set(['task-added', 'task-done', 'stock', 'folder', 'missed', 'note', 'birth']);
  api.onEvent((p) => {
    const a = p && actorOf(p.qid);
    if (!a || !KINDS.has(p.kind)) return;
    a.event(p.kind, p.payload && typeof p.payload === 'object' ? p.payload : {}, p.prio);
  });
  api.onAlert((p) => { const a = p && actorOf(p.qid); if (a && p.reminderId != null) a.alert(String(p.reminderId), p.text); });
  api.onAlertClear((p) => {
    if (!p) return;
    const id = p.reminderId != null ? String(p.reminderId) : null;
    if (p.qid) { const a = actorOf(p.qid); if (a) a.clearAlert(id); return; }
    for (const a of S.actors.values()) a.clearAlert(id);                // 沒指定哪隻：每隻都找找看
  });
  api.onPlay((p) => { const a = p && actorOf(p.qid); if (a && typeof p.action === 'string') a.play(p.action); });

  // ---- 離開／回來 ----------------------------------------------------------------
  // digest：[{qid, kind?, payload?, text?}] 或 {qid: [文字…]}；有事要報告的（最多 5 隻）錯開 0.8 秒揮手報告
  function digestItems(digest) {
    const out = new Map();
    const push = (qid, it) => { if (!actorOf(qid)) return; if (!out.has(qid)) out.set(qid, []); out.get(qid).push(it); };
    if (Array.isArray(digest)) {
      for (const d of digest.slice(0, 200)) {
        if (!d) continue;
        if (KINDS.has(d.kind)) push(d.qid, { kind: d.kind, list: [d.payload || {}], prio: 2 });
        else if (Array.isArray(d.items)) push(d.qid, { kind: 'missed', list: [{ items: d.items.map((t) => S.str(t)) }], prio: 2 });
        else if (d.text) push(d.qid, { kind: 'note', list: [{ text: S.str(d.text) }], prio: 2 });
      }
    } else if (digest && typeof digest === 'object') {
      for (const [qid, v] of Object.entries(digest)) for (const t of [].concat(v).slice(0, 20)) {
        if (t && typeof t === 'object') { if (KINDS.has(t.kind)) push(qid, { kind: t.kind, list: [t.payload || {}], prio: 2 }); else if (t.text) push(qid, { kind: 'note', list: [{ text: S.str(t.text) }], prio: 2 }); }
        else if (t) push(qid, { kind: 'note', list: [{ text: S.str(t) }], prio: 2 });
      }
    }
    return out;
  }
  api.onPresence((p) => {
    if (!p) return;
    const away = !!(p.away || p.locked);
    if (away === awayNow && !p.digest) return;
    awayNow = away;
    if (S.mode === 'hidden') return;
    if (away) { S.mode = 'asleep'; for (const a of S.actors.values()) a.setMode('asleep'); S.reportRects(); return; }
    S.mode = 'awake';
    const items = digestItems(p.digest);
    for (const [qid, list] of items) for (const it of list) actorOf(qid).enqueue(it);
    for (const a of S.actors.values()) a.setMode('awake');
    // 有事要報告的：最多 5 隻，錯開 0.8 秒；其他隻只醒過來
    const reporters = [...S.actors.values()].filter((a) => a.queue.length).slice(0, 5);
    reporters.forEach((a, i) => a.wakeAndReport(300 + i * 800));
    for (const a of S.actors.values()) if (a.queue.length && !reporters.includes(a)) a.scheduleDrain(300 + 5 * 800 + 4000);
    S.kick();
  });

  // ---- 游標、暫停、隱藏 ----------------------------------------------------------------
  api.onCursor((c) => {
    if (!c || !isFinite(c.x) || !isFinite(c.y)) return;
    S.cursor = { x: c.x, y: c.y };
    const now = performance.now();
    for (const a of S.actors.values()) a.onCursor(S.cursor, now);
  });
  api.onPause(() => {
    S.paused = true;
    // 看不到就停：收掉 L2 以下的活動（提醒照常），球淡出
    for (const a of S.actors.values()) if (a.job && a.job.layer >= 4) { const j = a.job; a.job = null; j.interrupt && j.interrupt('pause'); a.hideLive(); a.setLayer(8); a.showRest(); }
    for (const a of S.actors.values()) a.stopLife();                    // 看不到的時候：眨眼、耳朵的計時器也停
  });
  api.onResume(() => { S.paused = false; for (const a of S.actors.values()) { a.nextAt = Math.max(a.nextAt, performance.now() + 3000); if (a.mode === 'awake') a.startLife(); } S.kick(); });
  let hideTimer = 0;
  function setHidden(h) {
    document.body.classList.toggle('hidden', h);
    S.mode = h ? 'hidden' : (awayNow ? 'asleep' : 'awake');
    for (const a of S.actors.values()) a.setMode(S.mode);
    if (!h) for (const a of S.actors.values()) if (a.alerts.length) a.startRing();   // 回來時補上提醒氣泡
    S.reportRects(); S.kick();
  }
  api.onHide((p) => {
    clearTimeout(hideTimer);
    const until = p && Number(p.until);
    if (p && p.hide === false) { setHidden(false); return; }
    setHidden(true);
    if (until && until > Date.now()) hideTimer = setTimeout(() => setHidden(false), Math.min(until - Date.now(), 24 * 3600e3));
  });

  window.addEventListener('resize', () => { for (const a of S.actors.values()) { a.y = Math.min(a.y, innerHeight - 4); a.x = S.clamp(a.x, 20, innerWidth - 20); a.place(); } S.reportRects(); });
  // 給測試和除錯用
  window.__stage = { actors: S.actors, balls: S.balls, cache: S.cacheInfo, kick: S.kick, running: S.running, S };
  api.ready();
})();
