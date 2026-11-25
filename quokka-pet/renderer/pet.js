// 桌寵 renderer：角色注入／切換、姿勢與動作（球類＋招牌動作）、說話氣泡、拖曳與點擊。

const petEl = document.getElementById('pet');
const petArt = document.getElementById('petArt');
const bubbleEl = document.getElementById('bubble');

const CHARS = window.CHARACTERS || {};
let currentId = window.CHAR_DEFAULT || Object.keys(CHARS)[0];

// --- 角色注入 / 切換 ---
function renderCharacter(id) {
  const c = CHARS[id] || CHARS[currentId];
  if (!c) return;
  currentId = c.id;
  petArt.innerHTML = c.svg;
  petEl.dataset.character = c.id;
  scheduleAction();
}

// --- 姿勢 ---
// 基本姿勢：idle / think / happy；動作（球類＋招牌動作）由角色的 actions 清單定義，
// 播完 actionMs 指定的長度後回到 idle，並說一句 actionLines。
const BASE_POSES = ['idle', 'think', 'happy'];
let poseTimer = null;
function charOf(id) { return CHARS[id] || {}; }
function actionsOf(id) { const c = charOf(id); return Array.isArray(c.actions) ? c.actions : []; }
function setPose(pose) {
  if (poseTimer) { clearTimeout(poseTimer); poseTimer = null; }
  pose = pose || 'idle';
  const isAction = actionsOf(currentId).includes(pose);
  // 不認得的姿勢（例如角色不會的動作）一律視為 idle
  if (!isAction && !BASE_POSES.includes(pose)) pose = 'idle';
  if (petEl.dataset.pose === pose && (isAction || pose === 'happy')) {
    // 同一個動作連按：先回 idle 並強制重排，讓 CSS 動畫從頭播放
    petEl.dataset.pose = 'idle';
    void petEl.offsetWidth;
  }
  petEl.dataset.pose = pose;
  if (pose === 'happy') {
    poseTimer = setTimeout(() => { petEl.dataset.pose = 'idle'; }, 2000);
  } else if (isAction) {
    const c = charOf(currentId);
    const ms = (c.actionMs && c.actionMs[pose]) || 4800;
    poseTimer = setTimeout(() => {
      petEl.dataset.pose = 'idle';
      const line = c.actionLines && c.actionLines[pose];
      if (line && !bubbleEl.classList.contains('show')) showBubble({ text: line, duration: 2500 });
    }, ms);
  }
}

// 待機時每隔 20–40 秒依權重隨機做一個動作（不連續重複）；
// 氣泡顯示中、拖曳中、非 idle 時略過這一輪。
let actionTimer = null;
let lastAction = '';
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    const busy = petEl.dataset.pose !== 'idle' || bubbleEl.classList.contains('show') || dragging;
    if (!busy) {
      lastAction = pickAction();
      if (lastAction) setPose(lastAction);
    }
    scheduleAction();
  }, 20000 + Math.random() * 20000);
}

// --- 說話氣泡（字串＝一般訊息；物件可帶出處，用於名言） ---
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


// --- 來自主行程的事件 ---
window.api.onSpeak(showBubble);

window.api.onCharacter((payload) => {
  const id = typeof payload === 'string' ? payload : payload && payload.id;
  const greeting = payload && payload.greeting;
  if (id) renderCharacter(id);
  setPose('idle');
  if (greeting) showBubble(greeting);
});

window.api.onPose((pose) => setPose(pose));

// --- 拖曳 / 點擊（手動移動視窗以便區分「點擊」與「拖曳」） ---
let dragging = false;
let lastX = 0;
let lastY = 0;
let moved = 0;

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
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - lastX;
  const dy = e.screenY - lastY;
  lastX = e.screenX;
  lastY = e.screenY;
  moved += Math.abs(dx) + Math.abs(dy);
  window.api.movePetBy(dx, dy);
});

// 先以預設角色渲染，避免切換前空白（放在所有狀態變數宣告之後）
renderCharacter(currentId);

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  // 位移很小 → 視為點擊 → 開/關面板；真的拖曳過 → 放下時蹦一下（短尾矮袋鼠用後腳跳）
  if (moved < 5) window.api.togglePanel();
  else if (petEl.dataset.pose === 'idle' && actionsOf(currentId).includes('hop') && !reduceMotion) setPose('hop');
});
