// 桌寵 renderer：角色注入／切換、姿勢（idle/think/happy＋運動）、說話氣泡、拖曳與點擊。

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
  scheduleSport();
}

// --- 姿勢：idle / think / happy（happy 會在數秒後自動回到 idle） ---
// 運動姿勢（羽球／排球／籃球）只有具備 sports 的角色才有，播完 SPORT_MS 後回到 idle。
const SPORT_MS = 4800;            // 需與 pet.css 的運動動畫總長一致
let happyTimer = null;
function sportsOf(id) {
  const c = CHARS[id];
  return (c && Array.isArray(c.sports)) ? c.sports : [];
}
function setPose(pose) {
  if (happyTimer) { clearTimeout(happyTimer); happyTimer = null; }
  pose = pose || 'idle';
  const isSport = sportsOf(currentId).includes(pose);
  // 不認得的姿勢（例如切到不會運動的角色後才送達的運動指令）一律視為 idle
  if (!isSport && !['idle', 'think', 'happy'].includes(pose)) pose = 'idle';
  if (petEl.dataset.pose === pose && isSport) {
    // 同一項運動連按：先回 idle 並強制重排，讓 CSS 動畫從頭播放
    petEl.dataset.pose = 'idle';
    void petEl.offsetWidth;
  }
  petEl.dataset.pose = pose;
  if (pose === 'happy') {
    happyTimer = setTimeout(() => { petEl.dataset.pose = 'idle'; }, 2500);
  } else if (isSport) {
    happyTimer = setTimeout(() => {
      petEl.dataset.pose = 'idle';
      const c = CHARS[currentId];
      const line = c && c.sportLines && c.sportLines[pose];
      if (line && !bubbleEl.classList.contains('show')) showBubble({ text: line, duration: 2500 });
    }, SPORT_MS);
  }
}

// 待機時每隔 20–40 秒自動輪流打一項球（氣泡顯示中、拖曳中、非 idle 時略過這一輪）
let sportTimer = null;
let sportIndex = Math.floor(Math.random() * 3);
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function scheduleSport() {
  if (sportTimer) { clearTimeout(sportTimer); sportTimer = null; }
  if (reduceMotion || !sportsOf(currentId).length) return;
  sportTimer = setTimeout(() => {
    const list = sportsOf(currentId);
    const busy = petEl.dataset.pose !== 'idle' || bubbleEl.classList.contains('show') || dragging;
    if (list.length && !busy) {
      sportIndex = (sportIndex + 1) % list.length;
      setPose(list[sportIndex]);
    }
    scheduleSport();
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
  // 位移很小 → 視為點擊 → 開/關面板
  if (moved < 5) window.api.togglePanel();
});
