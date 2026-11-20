// 桌寵 renderer：角色注入／切換、姿勢（idle/think/happy）、說話氣泡、拖曳與點擊。

const petEl = document.getElementById('pet');
const petArt = document.getElementById('petArt');
const bubbleEl = document.getElementById('bubble');

const CHARS = window.CHARACTERS || {};
let currentId = window.CHAR_DEFAULT || 'ando';

// --- 角色注入 / 切換 ---
function renderCharacter(id) {
  const c = CHARS[id] || CHARS[currentId] || CHARS['ando'];
  if (!c) return;
  currentId = c.id;
  petArt.innerHTML = c.svg;
  petEl.dataset.character = c.id;
}

// --- 姿勢：idle / think / happy（happy 會在數秒後自動回到 idle） ---
let happyTimer = null;
function setPose(pose) {
  if (happyTimer) { clearTimeout(happyTimer); happyTimer = null; }
  petEl.dataset.pose = pose || 'idle';
  if (pose === 'happy') {
    happyTimer = setTimeout(() => { petEl.dataset.pose = 'idle'; }, 2500);
  }
}

// --- 說話氣泡 ---
let bubbleTimer = null;
function showBubble(text) {
  if (!text) return;
  bubbleEl.textContent = text;
  bubbleEl.classList.add('show');
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubbleEl.classList.remove('show'), 6000);
}

// 先以預設角色渲染，避免切換前空白
renderCharacter(currentId);

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

petEl.addEventListener('mousedown', (e) => {
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

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  // 位移很小 → 視為點擊 → 開/關面板
  if (moved < 5) window.api.togglePanel();
});
