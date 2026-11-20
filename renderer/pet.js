// 桌寵 renderer：處理拖曳（手動移動視窗以便區分「點擊」與「拖曳」）與說話氣泡。

const petEl = document.getElementById('pet');
const bubbleEl = document.getElementById('bubble');

let bubbleTimer = null;
function showBubble(text) {
  bubbleEl.textContent = text;
  bubbleEl.classList.add('show');
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubbleEl.classList.remove('show'), 6000);
}

// 主行程推播的「說話」事件
window.api.onSpeak(showBubble);

// --- 拖曳 / 點擊 ---
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

// 啟動問候
showBubble('嗨！點我一下可以開啟面板 👋');
