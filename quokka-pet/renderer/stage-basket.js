// 桌面道具籃：右下角一個小籃子（可以搬到別的地方）。游標碰到 → 道具彈出一圈；
//   按住一個拖出來 → 道具跟著游標（附近的庫卡會看、會說話）；放在某隻身上牠就用／收下，放在空地掉到地上讓牠們去撿，
//   甩出去會飛、會彈（球真的會滾）。右鍵籃子：收起來 30 分鐘、放回右下角。
//   庫卡閒著時偶爾跑到籃子旁邊探頭。
(function () {
  const S = window.Stage;
  const ITEMS = [['badminton', '🏸', '羽球拍'], ['volleyball', '🏐', '排球'], ['basketball', '🏀', '籃球'], ['eat', '🌿', '葉子'], ['rose', '🌹', '玫瑰'], ['snack', '🍪', '點心']];
  const GIFT = new Set(['rose', 'snack']);
  const W = 74, H = 60, R = 138, HIDE_MS = 160;
  let pos = null, hiddenUntil = 0, counts = {}, fan = null, hideT = 0, drag = null, move = null;
  const el = document.createElement('div');
  el.className = 'basket';
  el.innerHTML = '<svg viewBox="0 0 74 60" aria-hidden="true"><path d="M14 26 Q37 -6 60 26" fill="none" stroke="#a86a33" stroke-width="6" stroke-linecap="round"/>' +
    '<path d="M4 24h66l-7 32a4 4 0 0 1-4 3H15a4 4 0 0 1-4-3z" fill="#c98a4e"/>' +
    '<path d="M4 24h66v7H4z" fill="#a86a33"/>' +
    [12, 22, 32, 42, 52, 62].map((x) => `<path d="M${x} 31l${x < 37 ? 1.5 : -1.5} 26" stroke="#b5763d" stroke-width="3"/>`).join('') +
    '<path d="M8 41h58M10 50h54" stroke="#b5763d" stroke-width="2.5"/></svg>';
  el.title = '道具籃：游標碰到就打開，按住道具拖給庫卡';
  S.fxEl.appendChild(el);

  const defaultPos = () => ({ x: innerWidth - W / 2 - 40, y: innerHeight - 6 });   // y＝籃底
  // pos 存的是螢幕比例（fx, fy）：螢幕變小時只是畫的時候夾進來，變回原來大小還在原本的地方
  let frac = null;
  function place() {
    if (frac) pos = { x: frac.fx * innerWidth, y: frac.fy * innerHeight };
    const raw = pos || defaultPos();
    const p = { x: S.clamp(raw.x, W / 2 + 4, innerWidth - W / 2 - 4), y: S.clamp(raw.y, H + 4, innerHeight - 2) };
    el.style.transform = `translate(${Math.round(p.x - W / 2)}px, ${Math.round(p.y - H)}px)`;
    el.hidden = Date.now() < hiddenUntil || S.mode === 'hidden';
    if (fan) layoutFan();
    S.reportRects();
  }
  const cur = () => { const raw = pos || defaultPos(); return { x: S.clamp(raw.x, W / 2 + 4, innerWidth - W / 2 - 4), y: S.clamp(raw.y, H + 4, innerHeight - 2) }; };
  function rect() { const p = cur(); return { id: 'basket', kind: 'basket', x: Math.round(p.x - W / 2), y: Math.round(p.y - H), w: W, h: H }; }
  const inR = (r, x, y, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

  // ---- 彈出一圈道具 ----
  async function open() {
    if (fan || el.hidden) return;
    fan = { el: document.createElement('div'), btns: [] };
    fan.el.className = 'basket-fan';
    fan.el.innerHTML = ITEMS.map(([k, ic, nm]) => `<button type="button" class="bk-it" data-item="${k}" title="${nm}：按住拖給庫卡，或甩出去"><span>${ic}</span><i></i></button>`).join('');
    S.fxEl.appendChild(fan.el);
    fan.btns = [...fan.el.querySelectorAll('.bk-it')];
    layoutFan();
    requestAnimationFrame(() => fan && fan.el.classList.add('on'));
    try { counts = (await S.api.itemCounts()) || {}; } catch (e) { counts = {}; }
    showCounts();
    S.reportRects();
  }
  function showCounts() {
    if (!fan) return;
    for (const b of fan.btns) {
      const k = b.dataset.item, c = counts[k];
      const n = GIFT.has(k) && c ? c.n : null;
      b.querySelector('i').textContent = n == null ? '' : n;
      b.classList.toggle('empty', n === 0);
    }
  }
  function layoutFan() {
    const p = cur(), cx = p.x, cy = p.y - H * .55;
    // 籃子在右邊就往左上展開，在左邊往右上
    const right = cx > innerWidth / 2, a0 = right ? 190 : -10, a1 = right ? 78 : 102;
    fan.btns.forEach((b, i) => {
      const t = ITEMS.length > 1 ? i / (ITEMS.length - 1) : 0, a = (a0 + (a1 - a0) * t) * Math.PI / 180;
      const x = cx + Math.cos(a) * R, y = cy - Math.sin(a) * R;
      b.style.left = Math.round(x - 24) + 'px'; b.style.top = Math.round(y - 24) + 'px';
      b.dataset.x = x; b.dataset.y = y;
    });
  }
  function close() { clearTimeout(hideT); hideT = 0; if (!fan) return; const f = fan; fan = null; f.el.classList.remove('on'); setTimeout(() => f.el.remove(), 120); S.reportRects(); }
  function fanRects() { return fan ? fan.btns.map((b) => ({ id: 'basket-it', kind: 'basket', x: Math.round(+b.dataset.x - 28), y: Math.round(+b.dataset.y - 28), w: 56, h: 56 })) : []; }
  const overAny = (x, y) => inR(rect(), x, y, 6) || fanRects().some((r) => inR(r, x, y, 8)) || (fan && Math.hypot(x - cur().x, y - (cur().y - H * .55)) < R + 30);

  function onMove(x, y) {
    if (drag || move || el.hidden) return;
    if (overAny(x, y)) { clearTimeout(hideT); hideT = 0; if (inR(rect(), x, y, 6)) open(); return; }
    if (fan && !hideT) hideT = setTimeout(() => { hideT = 0; close(); }, HIDE_MS);
  }
  document.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY), { passive: true });
  if (S.api.onCursor) S.api.onCursor((p) => { if (p && (fan || hideT || inR(rect(), p.x, p.y, 40))) onMove(p.x, p.y); });

  // ---- 拿道具出來 ----
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('.bk-it');
    if (b && e.button === 0) {
      e.preventDefault(); e.stopPropagation();
      const k = b.dataset.item;
      if (b.classList.contains('empty')) { b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
      drag = { item: k, pts: [[e.clientX, e.clientY, performance.now()]] };
      S.Items.hold.begin(k); S.Items.hold.move(e.clientX, e.clientY);
      close(); S.reportRects();
      return;
    }
    if (e.target.closest && e.target.closest('.basket') && e.button === 0) {           // 搬籃子
      e.preventDefault();
      const p = cur(); move = { dx: e.clientX - p.x, dy: e.clientY - p.y, moved: false };
      close(); S.reportRects();
    }
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (drag) {
      drag.pts.push([e.clientX, e.clientY, performance.now()]); if (drag.pts.length > 8) drag.pts.shift();
      S.Items.hold.move(e.clientX, e.clientY);
    } else if (move) {
      if (!move.moved && Math.hypot(e.clientX - move.dx - cur().x, e.clientY - move.dy - cur().y) < 4) return;
      move.moved = true; frac = null; pos = { x: e.clientX - move.dx, y: e.clientY - move.dy }; place();
    }
  }, true);
  function endDrag(e, cancel) {
    if (drag) {
      const d = drag; drag = null;
      const last = d.pts[d.pts.length - 1], first = d.pts.find((p) => last[2] - p[2] < 90) || d.pts[0];
      const dt = Math.max(16, last[2] - first[2]) / 1000;
      const still = performance.now() - last[2] > 80;                                  // 放開前已經停住：輕輕放下，不算甩
      const x = e ? e.clientX : last[0], y = e ? e.clientY : last[1];
      if (cancel || inR(rect(), x, y, 6)) S.Items.hold.cancel();                     // 放回籃子＝不拿了
      else S.Items.hold.end(x, y, still ? 0 : (last[0] - first[0]) / dt, still ? 0 : (last[1] - first[1]) / dt);
      S.reportRects();
    } else if (move) {
      const m = move; move = null;
      if (m.moved) { const p = cur(); frac = { fx: p.x / innerWidth, fy: p.y / innerHeight }; S.api.basketPos(frac.fx, frac.fy); }
      else open();
      S.reportRects();
    }
  }
  document.addEventListener('pointerup', (e) => endDrag(e, false), true);
  document.addEventListener('pointercancel', (e) => endDrag(e, true), true);
  window.addEventListener('blur', () => { if (drag || move) endDrag(null, false); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); close(); S.api.basketMenu(); });

  S.api.onBasket && S.api.onBasket((p) => {
    if (!p) return;
    if ('hiddenUntil' in p) { hiddenUntil = p.hiddenUntil || 0; close(); setTimeout(place, Math.max(0, hiddenUntil - Date.now()) + 50); }
    if ('pos' in p && !p.pos) { pos = null; frac = null; }
    place();
  });
  S.api.basketGet && S.api.basketGet().then((b) => {
    if (b && b.pos && isFinite(b.pos.fx) && isFinite(b.pos.fy)) frac = { fx: b.pos.fx, fy: b.pos.fy };
    hiddenUntil = (b && b.hiddenUntil) || 0;
    if (hiddenUntil > Date.now()) setTimeout(place, hiddenUntil - Date.now() + 50);
    place();
  }).catch(place);
  window.addEventListener('resize', place);

  // ---- 庫卡閒著時偶爾跑到籃子旁邊探頭 ----
  const ASK = ['可以玩球嗎？', '籃子裡有什麼？', '有點心嗎？', '陪我玩～'];
  setInterval(() => {
    if (el.hidden || S.mode === 'hidden' || Math.random() > .3) return;
    const p = cur();
    const free = [...S.actors.values()].filter((a) => a.mode === 'awake' && !a.job && !a.inPouch && !a.isFollow && !a.dragging && Math.abs(a.x - p.x) > 120);
    if (!free.length) return;
    const a = free[Math.floor(Math.random() * free.length)];
    const side = a.x < p.x ? -1 : 1, tx = S.clamp(p.x + side * (W / 2 + 40 * a.k), 60, innerWidth - 60);
    const job = a.walkJob(tx, { name: 'visit', noPause: true, y: Math.abs(p.y - a.y) > 30 ? p.y - 2 : null,
      onArrive: () => { a.say(ASK[Math.floor(Math.random() * ASK.length)], { ms: 2600 }); el.classList.remove('wiggle'); void el.offsetWidth; el.classList.add('wiggle'); } });
    a.requestActivity(7, job);
  }, 90000);

  S.Basket = { rects: () => (el.hidden ? [] : [rect(), ...fanRects()]), dragging: () => !!(drag || move), open, close, pos: cur };
})();
