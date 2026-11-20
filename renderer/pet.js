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

// --- 說話氣泡（字串＝一般訊息；物件可帶出處，用於名言） ---
const bubbleTextEl = bubbleEl.querySelector('.bubble-text') || bubbleEl;
const bubbleAttrEl = bubbleEl.querySelector('.bubble-attr');
const bubbleImgEl = bubbleEl.querySelector('.bubble-img');
const bubbleOkEl = document.getElementById('bubbleOk');
let bubbleTimer = null;
let stickyOpen = false;
function showBubble(payload) {
  let text = '';
  let attr = '';
  let image = '';
  let duration = 6000;
  const sticky = !!(payload && payload.sticky);
  // 等使用者確認的泡泡還在時，只有 AI 對話的新訊息能取代它（名言、提醒不行）
  if (stickyOpen && !(payload && payload.ai)) return;
  if (payload && typeof payload === 'object') {
    text = payload.text || payload.zh || '';
    attr = payload.attribution || payload.sourceZh || '';
    // 只接受 data: 圖片（對話紀錄裡的截圖／貼上的圖片），不載入任何外部網址
    image = /^data:image\/(png|jpeg|gif|webp);base64,/.test(payload.image || '') ? payload.image : '';
    duration = Number(payload.duration) || (attr ? 12000 : 6000);
  } else {
    text = String(payload || '');
  }
  if (!text && !image) return;
  if (bubbleImgEl) {
    if (image) bubbleImgEl.src = image; else bubbleImgEl.removeAttribute('src');
    bubbleImgEl.hidden = !image;
  }
  bubbleEl.classList.toggle('has-img', !!image);
  bubbleTextEl.textContent = text;
  if (bubbleAttrEl) {
    bubbleAttrEl.textContent = attr;
    bubbleAttrEl.hidden = !attr;
  }
  bubbleEl.classList.toggle('has-attr', !!attr);
  // 先請主行程把視窗展開，再顯示泡泡；泡泡消失後收回，只留角色大小
  if (window.api.setBubbleOpen) window.api.setBubbleOpen(true);
  bubbleEl.classList.add('show');
  bubbleEl.classList.toggle('sticky', sticky);
  if (bubbleOkEl) bubbleOkEl.hidden = !sticky;
  stickyOpen = sticky;
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = sticky ? null : setTimeout(hideBubble, duration);
}

function hideBubble() {
  stickyOpen = false;
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = null;
  bubbleEl.classList.remove('show', 'sticky');
  if (bubbleOkEl) bubbleOkEl.hidden = true;
  if (window.api.setBubbleOpen) window.api.setBubbleOpen(false);
}
if (bubbleOkEl) bubbleOkEl.addEventListener('click', hideBubble);

// 視窗被推回螢幕內時，角色反向位移以維持在原位
const stageEl = document.getElementById('stage');
if (window.api.onLayout) {
  window.api.onLayout((layout) => {
    stageEl.style.setProperty('--pet-shift', ((layout && layout.shift) || 0) + 'px');
  });
}

// 小狀態標籤
const statusEl = document.getElementById('status');
if (window.api.onStatus && statusEl) {
  window.api.onStatus((st) => {
    const text = (st && st.text) || '';
    statusEl.textContent = text;
    statusEl.className = 'status-chip' + (st && st.cls ? ' ' + st.cls : '');
    statusEl.hidden = !text;
  });
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

petEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // 右鍵 → 選單（打開面板、說名言、開機啟動、結束）
  if (window.api.showPetMenu) window.api.showPetMenu();
  else if (window.api.speakRandomQuote) window.api.speakRandomQuote();
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

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  // 位移很小 → 視為點擊 → 開/關面板
  if (moved < 5) window.api.togglePanel();
});
