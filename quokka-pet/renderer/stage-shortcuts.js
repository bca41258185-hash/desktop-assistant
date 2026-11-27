// 捷徑：游標碰到某隻短尾矮袋鼠 → 頭上浮出牠負責的資料夾／檔案（Windows 本來的圖示），排成弧形；
//   滑過去會放大，點一下打開。游標離開矮袋鼠和捷徑超過 0.7 秒就收起來。
//   也可以把檔案或資料夾拖到矮袋鼠身上，加進牠的捷徑。
//   滑鼠事件：舞台平常是穿透的，但游標移動會轉送進來（forward），所以用 mousemove 判斷游標在不在矮袋鼠上；
//   捷徑浮出來時，把它們的範圍一起回報（S.reportRects），主行程就會讓那一塊可以點。
(function () {
  const S = window.Stage;
  const MAX = 12, ROW = 6, ICON = 52, CELL = 78, HIDE_MS = 700;
  let fan = null;          // { qid, el, rects, items }
  let hideTimer = 0, loading = '', mx = -1, my = -1;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const short = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  const inRect = (r, x, y, pad = 0) => r && x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

  function hide() {
    clearTimeout(hideTimer); hideTimer = 0;
    if (!fan) return;
    const el = fan.el; fan = null; loading = '';
    el.classList.remove('on'); setTimeout(() => el.remove(), 160);
    S.reportRects();
  }
  // 排位置：頭頂上方一道平緩的弧（左右兩端稍微低一點），間距固定不會重疊；超過 6 個再往上排一排
  const GAP = 86, LIFT = 92, BEND = .0013;
  function layout(a, n) {
    const hx = a.x, top = a.y - a.h * .9 - 48, out = [];          // 名稱的底不能蓋到臉
    for (let i = 0; i < n; i++) {
      const row = i < ROW ? 0 : 1, k = row ? n - ROW : Math.min(n, ROW), j = row ? i - ROW : i;
      const dx = (j - (k - 1) / 2) * GAP;
      let x = hx + dx, y = top - LIFT * row + BEND * dx * dx;
      x = S.clamp(x, CELL / 2 + 2, innerWidth - CELL / 2 - 2); y = S.clamp(y, ICON / 2 + 4, innerHeight - 40);
      out.push({ x, y });
    }
    return out;
  }
  // 資料夾一律用自己畫的黃色資料夾（Windows 給資料夾的圖示常常不對）
  const FOLDER = '<svg width="36" height="30" viewBox="0 0 36 30" aria-hidden="true"><path d="M2 5.5a2 2 0 0 1 2-2h9.5l3 3H32a2 2 0 0 1 2 2V26a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" fill="#e9a92e"/><path d="M2 11a2 2 0 0 1 2-2h28a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" fill="#ffcf5a"/></svg>';
  async function show(a) {
    if (loading === a.id || (fan && fan.qid === a.id)) return;
    hide(); loading = a.id;
    let items = [];
    try { items = (await S.api.shortcuts(a.id)) || []; } catch (e) { items = []; }
    if (loading !== a.id || !S.actors.has(a.id)) return;
    loading = '';
    if (!items.length || a.dragging || S.mode === 'hidden') return;
    items = items.slice(0, MAX);
    const pos = layout(a, items.length), el = document.createElement('div');
    el.className = 'shortcuts';
    el.innerHTML = items.map((it, i) => `<button type="button" class="sc${it.missing ? ' missing' : ''}" data-id="${esc(it.id)}" title="${esc(it.path)}${it.missing ? '（找不到）' : ''}"
      style="left:${Math.round(pos[i].x - CELL / 2)}px;top:${Math.round(pos[i].y - ICON / 2)}px;transition-delay:${i * 25}ms">
      <span class="ic">${it.dir ? FOLDER : it.icon ? `<img src="${esc(it.icon)}" alt="">` : '<b>📄</b>'}</span><span class="lab">${esc(short(it.name, 14))}</span></button>`).join('');
    document.getElementById('fx').appendChild(el);
    const rects = pos.map((p) => ({ id: a.id, kind: 'shortcut', x: Math.round(p.x - CELL / 2), y: Math.round(p.y - ICON / 2 - 6), w: CELL, h: ICON + 40 }));
    fan = { qid: a.id, el, rects, items };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.sc'); if (!b) return;
      S.api.openShortcut(b.dataset.id);
      b.classList.add('opened'); setTimeout(hide, 250);
    });
    requestAnimationFrame(() => el.classList.add('on'));
    S.reportRects();
  }
  // 游標在哪一隻上（越前面的越優先）
  function actorAt(x, y) {
    let best = null;
    for (const a of S.actors.values()) if (a.rect && inRect(a.rect, x, y) && (!best || a.y > best.y)) best = a;
    return best;
  }
  function onMove(x, y) {
    mx = x; my = y;
    const a = actorAt(x, y);
    const overFan = fan && fan.rects.some((r) => inRect(r, x, y, 6));
    if (a && !a.dragging && a.mode === 'awake' || overFan) {
      clearTimeout(hideTimer); hideTimer = 0;
      if (a && !overFan && (!fan || fan.qid !== a.id)) show(a);
      return;
    }
    // 從矮袋鼠移到捷徑中間的空隙：給一點時間
    if ((fan || loading) && !hideTimer) hideTimer = setTimeout(() => { hideTimer = 0; if (!actorOrFan(mx, my)) { loading = ''; hide(); } }, HIDE_MS);
  }
  const actorOrFan = (x, y) => { const a = actorAt(x, y); return (a && fan && a.id === fan.qid) || (fan && fan.rects.some((r) => inRect(r, x, y, 6))); };
  document.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY), { passive: true });
  // 主行程送來的游標位置（舞台穿透時 mousemove 不一定到得了）
  if (S.api.onCursor) S.api.onCursor((p) => { if (p && (fan || hideTimer)) onMove(p.x, p.y); });
  document.addEventListener('mousedown', (e) => { if (fan && !e.target.closest('.shortcuts')) hide(); }, true);

  // 把檔案／資料夾拖到矮袋鼠身上 → 加進牠的捷徑；拖到別的地方什麼都不做（也不能讓舞台去開那個檔案）
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    const a = actorAt(e.clientX, e.clientY);
    e.dataTransfer.dropEffect = a ? 'link' : 'none';
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const a = actorAt(e.clientX, e.clientY);
    const files = [...(e.dataTransfer && e.dataTransfer.files || [])];
    if (!a || !files.length) return;
    hide();
    S.api.dropShortcuts(a.id, files);
  });

  S.Shortcuts = { hide, rects: () => (fan ? fan.rects : []), refresh: () => { if (fan) { const q = S.actors.get(fan.qid); hide(); if (q) show(q); } } };
})();
