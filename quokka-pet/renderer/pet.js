// 桌寵 renderer：造型與八方位、姿勢與動作、互動（摸頭、長摸、游標跟隨、拎起、甩出、離開偵測）、說話氣泡。
//
// 狀態都寫在 #pet 的 data 屬性上，由 pet.css 決定畫面：
//   data-pose  目前姿勢（idle、think、happy、各種動作與互動）
//   data-view  目前方位（front、f34r、sider、b34r、back、b34l、sidel、f34l）

const petEl = document.getElementById('pet');
const petArt = document.getElementById('petArt');
const bubbleEl = document.getElementById('bubble');

const CHARS = window.CHARACTERS || {};
const ART = window.QuokkaArt;
let currentId = window.CHAR_DEFAULT || Object.keys(CHARS)[0];
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// 造型：五張圖疊在一起，依 data-view 顯示其中一張；左邊三個方位用 CSS 鏡射
// ---------------------------------------------------------------------------
function renderCharacter(id) {
  const c = CHARS[id] || CHARS[currentId];
  if (!c) return;
  currentId = c.id;
  const v = c.views || {};
  petArt.innerHTML = ['front', 'f34', 'side', 'b34', 'back']
    .map((k) => `<div class="view view-${k}">${v[k] || ''}</div>`).join('');
  petEl.dataset.character = c.id;
  setView('front');
  scheduleAction();
}
function setView(view) {
  if (!ART || !ART.VIEW_MAP[view]) view = 'front';
  petEl.dataset.view = view;
}

// 轉身：沿八方位一格一格轉，每格配一個小跳步
let turning = null;
function turnTo(target, opts = {}) {
  const order = ART ? ART.TURN_ORDER : ['front'];
  let i = order.indexOf(petEl.dataset.view || 'front');
  const t = order.indexOf(target);
  if (i < 0 || t < 0) return Promise.resolve();
  const steps = [];
  if (opts.full) { for (let k = 1; k <= 8; k++) steps.push(order[(i + k * (opts.dir || 1) + 8) % 8]); }
  else {
    const fwd = (t - i + 8) % 8, dir = fwd <= 4 ? 1 : -1;
    while (i !== t) { i = (i + dir + 8) % 8; steps.push(order[i]); }
  }
  if (turning) clearInterval(turning);
  return new Promise((resolve) => {
    if (!steps.length) return resolve();
    const stepMs = opts.stepMs || 110;
    petEl.classList.add('turning');
    let k = 0;
    const next = () => {
      setView(steps[k]);
      petEl.classList.remove('turn-step'); void petEl.offsetWidth; petEl.classList.add('turn-step');
      k += 1;
      if (k >= steps.length) {
        clearInterval(turning); turning = null;
        setTimeout(() => { petEl.classList.remove('turning', 'turn-step'); resolve(); }, stepMs);
      }
    };
    next();
    turning = setInterval(next, stepMs);
  });
}

// ---------------------------------------------------------------------------
// 姿勢
// ---------------------------------------------------------------------------
// 互動與基本姿勢：值＝自動回到 idle 的毫秒數（0＝不自動結束）
const BASE_POSES = {
  idle: 0, think: 0, happy: 2000,
  pat1: 1600, pat2: 1300, pet: 0, lifted: 0, dizzy: 2600, wave: 2600, sniff: 3000, sleep: 0
};
let poseTimer = null;
function charOf(id) { return CHARS[id] || {}; }
function actionsOf(id) { const c = charOf(id); return Array.isArray(c.actions) ? c.actions : []; }
function setPose(pose, opts = {}) {
  if (poseTimer) { clearTimeout(poseTimer); poseTimer = null; }
  pose = pose || 'idle';
  const isAction = actionsOf(currentId).includes(pose);
  if (!isAction && !(pose in BASE_POSES)) pose = 'idle';
  // 動作與大部分互動都用正面；聞聞用前斜（由呼叫端先轉好方位）
  if (pose !== 'idle' && pose !== 'sniff' && petEl.dataset.view !== 'front' && !opts.keepView) setView('front');
  if (petEl.dataset.pose === pose && pose !== 'idle') {
    // 同一個姿勢連續觸發：先回 idle 並強制重排，讓 CSS 動畫從頭播放
    petEl.dataset.pose = 'idle';
    void petEl.offsetWidth;
  }
  petEl.dataset.pose = pose;
  const c = charOf(currentId);
  const ms = isAction ? ((c.actionMs && c.actionMs[pose]) || 4800) : BASE_POSES[pose];
  if (ms) {
    poseTimer = setTimeout(() => {
      if (pose === 'sniff') setView('front');
      petEl.dataset.pose = 'idle';
      const line = isAction ? (c.actionLines && c.actionLines[pose]) : opts.endLine;
      if (line && !bubbleEl.classList.contains('show')) showBubble({ text: line, duration: 2500 });
    }, ms);
  }
}
const isIdle = () => petEl.dataset.pose === 'idle' && !turning;

// 待機時每隔 20–40 秒依權重隨機做一個動作（不連續重複）；忙碌時略過這一輪
let actionTimer = null;
let lastAction = '';
function pickAction() {
  const c = charOf(currentId);
  const list = actionsOf(currentId).filter((a) => a !== lastAction);
  const w = (a) => (c.actionWeights && c.actionWeights[a]) || 1;
  let r = Math.random() * list.reduce((sum, a) => sum + w(a), 0);
  for (const a of list) { r -= w(a); if (r < 0) return a; }
  return list[0];
}
function scheduleAction() {
  if (actionTimer) { clearTimeout(actionTimer); actionTimer = null; }
  if (reduceMotion || !actionsOf(currentId).length) return;
  actionTimer = setTimeout(() => {
    const busy = !isIdle() || petEl.dataset.view !== 'front' || bubbleEl.classList.contains('show') || dragging || away;
    if (!busy) {
      lastAction = pickAction();
      if (lastAction) setPose(lastAction);
    }
    scheduleAction();
  }, 20000 + Math.random() * 20000);
}

// ---------------------------------------------------------------------------
// 說話氣泡（字串＝一般訊息；物件可帶出處，用於名言）
// ---------------------------------------------------------------------------
const bubbleTextEl = bubbleEl.querySelector('.bubble-text') || bubbleEl;
const bubbleAttrEl = bubbleEl.querySelector('.bubble-attr');
let bubbleTimer = null;
function showBubble(payload) {
  let text = '';
  let attr = '';
  let duration = 6000;
  if (payload && typeof payload === 'object') {
    text = payload.text || payload.zh || '';
    attr = payload.attribution || payload.sourceZh || '';
    duration = Number(payload.duration) || (attr ? 12000 : 6000);
  } else {
    text = String(payload || '');
  }
  if (!text) return;
  bubbleTextEl.textContent = text;
  if (bubbleAttrEl) {
    bubbleAttrEl.textContent = attr;
    bubbleAttrEl.hidden = !attr;
  }
  bubbleEl.classList.toggle('has-attr', !!attr);
  bubbleEl.classList.add('show');
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubbleEl.classList.remove('show'), duration);
}

// ---------------------------------------------------------------------------
// 互動
// ---------------------------------------------------------------------------
const PAT_LINES = ['嘿嘿，好舒服。', '耳朵癢癢的！', '再摸一下嘛～'];
let patIndex = Math.floor(Math.random() * 3);

// 單擊摸頭：三種反應輪流
function patReaction() {
  if (dragging || away) return;
  patIndex = (patIndex + 1) % 3;
  if (patIndex === 0) setPose('pat1', { endLine: PAT_LINES[0] });
  else if (patIndex === 1) setPose('pat2', { endLine: PAT_LINES[1] });
  else {
    setPose('idle');
    turnTo('front', { full: true, dir: Math.random() < 0.5 ? 1 : -1, stepMs: 100 })
      .then(() => { if (!bubbleEl.classList.contains('show')) showBubble({ text: PAT_LINES[2], duration: 2000 }); });
  }
}

// 長摸：游標在頭部來回移動 → 撒嬌；摸很久 → 睡著
let petSamples = [];
let lastDirX = 0;
let petEndTimer = null;
let petStartedAt = 0;
function onHoverMove(e) {
  if (dragging || away || turning) return;
  const r = petEl.getBoundingClientRect();
  const inHead = e.clientY - r.top < r.height * 0.45 && e.clientX > r.left && e.clientX < r.right;
  if (!inHead) return;
  const now = performance.now();
  const dir = Math.sign(e.movementX || 0);
  if (dir && dir !== lastDirX && Math.abs(e.movementX) >= 2) { petSamples.push(now); lastDirX = dir; }
  petSamples = petSamples.filter((t) => now - t < 1400);
  const petting = petEl.dataset.pose === 'pet';
  if (petSamples.length >= 4 && (isIdle() || petting)) {
    if (!petting) { setPose('pet'); petStartedAt = now; }
    if (petEndTimer) clearTimeout(petEndTimer);
    petEndTimer = setTimeout(() => {
      if (petEl.dataset.pose === 'pet') { setPose('idle'); showBubble({ text: '嘿嘿，謝謝你摸我。', duration: 2200 }); }
    }, 900);
    if (now - petStartedAt > 8000) { clearTimeout(petEndTimer); petSamples = []; setPose('nap'); }
  }
}

// 游標靠近：眼睛跟著看；在側邊 → 轉頭（前斜）；停很久 → 湊過去聞
let cursorStillSince = 0;
let lastCursor = null;
let sniffedThisStill = false;
function onCursor({ dx, dy }) {
  if (reduceMotion) return;
  const dist = Math.hypot(dx, dy);
  const moving = !lastCursor || Math.hypot(dx - lastCursor.dx, dy - lastCursor.dy) > 3;
  lastCursor = { dx, dy };
  const now = performance.now();
  if (moving) { cursorStillSince = now; sniffedThisStill = false; }
  const canLook = isIdle() && !dragging && !away && ['front', 'f34r', 'f34l'].includes(petEl.dataset.view);
  if (!canLook) return;
  if (dist > 520) { setLook(0, 0); if (petEl.dataset.view !== 'front') setView('front'); return; }
  if (Math.abs(dx) > 150) setView(dx > 0 ? 'f34r' : 'f34l');
  else setView('front');
  setLook(Math.max(-1, Math.min(1, dx / 150)), Math.max(-1, Math.min(1, dy / 220)));
  if (!sniffedThisStill && dist < 280 && now - cursorStillSince > 6000) {
    sniffedThisStill = true;
    setView(dx >= 0 ? 'f34r' : 'f34l');
    setPose('sniff', { keepView: true });
  }
}
function setLook(x, y) {
  petEl.style.setProperty('--look-x', (x * 1.6).toFixed(2) + 'px');
  petEl.style.setProperty('--look-y', (y * 1).toFixed(2) + 'px');
}

// 離開偵測：主行程回報「多久沒碰鍵盤滑鼠」→ 睡著；回來 → 醒來揮手
let away = false;
function onAway(isAway) {
  if (isAway === away) return;
  away = isAway;
  if (away) { setView('front'); setPose('sleep'); }
  else { setPose('wave'); showBubble({ text: '你回來啦！歡迎回來～', duration: 3000 }); }
}

// ---------------------------------------------------------------------------
// 來自主行程的事件
// ---------------------------------------------------------------------------
window.api.onSpeak(showBubble);
window.api.onCharacter((payload) => {
  const id = typeof payload === 'string' ? payload : payload && payload.id;
  const greeting = payload && payload.greeting;
  if (id) renderCharacter(id);
  setPose('idle');
  if (greeting) showBubble(greeting);
});
window.api.onPose((pose) => setPose(pose));
if (window.api.onCursor) window.api.onCursor(onCursor);
if (window.api.onAway) window.api.onAway(onAway);

// ---------------------------------------------------------------------------
// 滑鼠：單擊摸頭、雙擊開面板、拖曳＝拎起來、用力甩＝飛出去頭暈、右鍵說一句
// ---------------------------------------------------------------------------
let dragging = false;
let lastX = 0;
let lastY = 0;
let moved = 0;
let samples = [];
let clickTimer = null;
const DOUBLE_CLICK_MS = 250;

petEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (window.api.speakRandomQuote) window.api.speakRandomQuote();
});

petEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragging = true;
  lastX = e.screenX;
  lastY = e.screenY;
  moved = 0;
  samples = [{ x: e.screenX, y: e.screenY, t: performance.now() }];
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) { onHoverMove(e); return; }
  const dx = e.screenX - lastX;
  const dy = e.screenY - lastY;
  lastX = e.screenX;
  lastY = e.screenY;
  moved += Math.abs(dx) + Math.abs(dy);
  const now = performance.now();
  samples.push({ x: e.screenX, y: e.screenY, t: now });
  samples = samples.filter((s) => now - s.t < 90);
  if (moved >= 5 && petEl.dataset.pose !== 'lifted' && !away) {
    if (turning) { clearInterval(turning); turning = null; petEl.classList.remove('turning', 'turn-step'); }
    setView('front');
    setPose('lifted');
  }
  window.api.movePetBy(dx, dy);
});

// 甩出去：放手後依速度繼續滑一段（逐格減速），落地後頭暈
function fling(vx, vy) {
  let x = vx * 16, y = vy * 16;
  const step = () => {
    x *= 0.86; y *= 0.86;
    if (Math.hypot(x, y) < 1.2) {
      setPose('dizzy', { endLine: '頭好暈……下次輕一點啦。' });
      return;
    }
    window.api.movePetBy(Math.round(x), Math.round(y));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  if (moved < 5) {
    // 位移很小 → 點擊；0.25 秒內再點一次＝雙擊開面板，否則＝摸頭
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; window.api.togglePanel(); return; }
    clickTimer = setTimeout(() => { clickTimer = null; patReaction(); }, DOUBLE_CLICK_MS);
    return;
  }
  if (away) return;
  // 拖曳結束：算最後一小段的速度，夠快就是「甩」
  const a = samples[0], b = samples[samples.length - 1];
  const dt = b && a ? Math.max(1, b.t - a.t) : 1;
  const vx = b && a ? (b.x - a.x) / dt : 0, vy = b && a ? (b.y - a.y) / dt : 0;
  if (!reduceMotion && Math.hypot(vx, vy) > 1.1) fling(vx, vy);   // 飛行中維持「被拎起來」的驚嚇表情
  else if (!reduceMotion && actionsOf(currentId).includes('hop')) setPose('hop');
  else setPose('idle');
});

// 先以預設角色渲染（放在所有狀態變數宣告之後）
renderCharacter(currentId);
