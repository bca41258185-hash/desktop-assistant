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
const bubbleHintEl = document.getElementById('bubbleHint');
const bubbleChoicesEl = document.getElementById('bubbleChoices');
const bubbleTargetsEl = document.getElementById('bubbleTargets');
const bubbleSkipEl = document.getElementById('bubbleSkip');
let composeTargetId = '';
if (bubbleSkipEl) {
  bubbleSkipEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = bubbleSkipEl.dataset.requestId;
    if (id && window.api.answerChoice) window.api.answerChoice(id, 'pass');
    hideBubble();
  });
}
const bubbleInputEl = document.getElementById('bubbleInput');
const bubbleTextInput = document.getElementById('bubbleTextInput');
if (bubbleInputEl) {
  bubbleInputEl.addEventListener('click', (e) => e.stopPropagation());
  bubbleInputEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = bubbleTextInput.value.trim();
    const id = bubbleInputEl.dataset.requestId;
    if (text && stickyAction === 'compose') {       // 主動說話：不屬於任何一個等待中的詢問
      hideBubble();
      if (window.api.composeSend) window.api.composeSend(text, composeTargetId);
      return;
    }
    if (!text || !id) return;
    if (window.api.answerChoice) window.api.answerChoice(id, 'text', text);
    hideBubble();
  });
  // 一開始打字（或點進輸入框）就通知主行程：請鉤子繼續等
  const typing = () => { const id = bubbleInputEl.dataset.requestId; if (id && window.api.notifyTyping) window.api.notifyTyping(id); };
  bubbleTextInput.addEventListener('focus', typing);
  bubbleTextInput.addEventListener('input', typing);
  // 等太久、鉤子已經結束：把輸入框收起來（泡泡本身留著）
  if (window.api.onInputExpire) {
    window.api.onInputExpire((id) => {
      if (bubbleInputEl.dataset.requestId !== id) return;
      bubbleInputEl.hidden = true;
      bubbleInputEl.dataset.requestId = '';
    });
  }
  // 中文輸入法選字時的 Enter 不算送出
  bubbleTextInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.isComposing) e.stopPropagation(); });
}
let bubbleTimer = null;
let stickyOpen = false;
let stickyAction = '';   // 'confirm'：點一下就收起；'reply'：點一下跳到 Claude 去回覆
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
  stickyAction = sticky ? (['reply', 'choice', 'compose'].includes(payload.action) ? payload.action : 'confirm') : '';
  // 選擇題：在泡泡裡放幾顆大選項，點了就把答案送回去
  if (bubbleChoicesEl) {
    bubbleChoicesEl.innerHTML = '';
    const choices = stickyAction === 'choice' && Array.isArray(payload.choices) ? payload.choices : [];
    choices.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'bubble-choice ' + c.id;
      b.textContent = c.label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.api.answerChoice) window.api.answerChoice(payload.requestId, c.id);
        hideBubble();
      });
      bubbleChoicesEl.appendChild(b);
    });
    // 超過兩個選項、或選項文字較長時改成直排
    bubbleChoicesEl.classList.toggle('stack', choices.length > 2 || choices.some((c) => String(c.label).length > 6));
    bubbleChoicesEl.hidden = !choices.length;
  }
  // 打字回覆：選項之外也可以自己輸入
  if (bubbleInputEl) {
    const canType = sticky && !!payload.inputPlaceholder && (!!payload.requestId || stickyAction === 'compose');
    bubbleInputEl.hidden = !canType;
    bubbleInputEl.dataset.requestId = canType ? (payload.requestId || '') : '';
    bubbleTextInput.value = '';
    bubbleTextInput.placeholder = canType ? payload.inputPlaceholder : '';
    if (stickyAction === 'compose') setTimeout(() => bubbleTextInput.focus(), 150);
  }
  // 主動說話：有好幾個對話時，列出來讓使用者點要送到哪一個（預設第一個）
  if (bubbleTargetsEl) {
    const targets = stickyAction === 'compose' && Array.isArray(payload.targets) ? payload.targets : [];
    bubbleTargetsEl.innerHTML = '';
    composeTargetId = targets.length ? targets[0].id : '';
    if (targets.length) {
      const label = document.createElement('div');
      label.className = 'bubble-targets-label';
      label.textContent = '送到打勾的對話（點別的可以換）：';
      bubbleTargetsEl.appendChild(label);
    }
    targets.forEach((t, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bubble-target' + (i === 0 ? ' on' : '');
      b.textContent = t.title;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        composeTargetId = t.id;
        bubbleTargetsEl.querySelectorAll('.bubble-target').forEach((x) => x.classList.toggle('on', x === b));
        bubbleTextInput.focus();
      });
      bubbleTargetsEl.appendChild(b);
    });
    bubbleTargetsEl.hidden = !targets.length;
  }
  // 選擇題／允許拒絕：給一個「先不回答」的出口（Claude 那邊的詢問還在，之後可以去那裡回答）
  if (bubbleSkipEl) {
    bubbleSkipEl.hidden = stickyAction !== 'choice';
    bubbleSkipEl.dataset.requestId = stickyAction === 'choice' ? (payload.requestId || '') : '';
  }
  bubbleEl.classList.toggle('sticky', sticky);
  bubbleEl.classList.toggle('confirm', stickyAction === 'confirm');
  bubbleEl.classList.toggle('compose', stickyAction === 'compose');
  bubbleEl.classList.toggle('reply', stickyAction === 'reply' || stickyAction === 'choice');
  if (bubbleHintEl) {
    const canReplyHere = stickyAction === 'confirm' && !!payload.inputPlaceholder && !!payload.requestId;
    bubbleHintEl.textContent = stickyAction === 'reply' ? '點一下，去 Claude 回答'
      : stickyAction === 'compose' ? '不說了就點一下泡泡'
        : canReplyHere ? '不回覆就點一下泡泡' : '知道了就點一下泡泡';
    bubbleHintEl.hidden = !sticky || stickyAction === 'choice';
  }
  stickyOpen = sticky;
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = sticky ? null : setTimeout(hideBubble, duration);
}

function hideBubble() {
  stickyOpen = false;
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = null;
  stickyAction = '';
  bubbleEl.classList.remove('show', 'sticky', 'confirm', 'reply', 'compose');
  if (bubbleHintEl) bubbleHintEl.hidden = true;
  if (bubbleChoicesEl) bubbleChoicesEl.hidden = true;
  if (bubbleInputEl) bubbleInputEl.hidden = true;
  if (bubbleTargetsEl) bubbleTargetsEl.hidden = true;
  if (bubbleSkipEl) bubbleSkipEl.hidden = true;
  if (window.api.setBubbleOpen) window.api.setBubbleOpen(false);
}
// 點泡泡本身就是確認；等你回覆的泡泡點了會把 Claude 視窗叫到最前面
bubbleEl.addEventListener('click', () => {
  if (!stickyOpen || stickyAction === 'choice') return;   // 選擇題要點選項才算
  const action = stickyAction;
  // 完成泡泡若還開著回覆框：點泡泡確認 = 不回覆，讓 Claude 馬上結束等待
  const rid = bubbleInputEl ? bubbleInputEl.dataset.requestId : '';
  if (rid && window.api.answerChoice) window.api.answerChoice(rid, 'pass');
  hideBubble();
  if (action === 'reply' && window.api.focusClaude) window.api.focusClaude();
});
// Claude 已經不再等你（例如你已在 Claude 裡回覆）→ 自動收起「等你回覆」的泡泡
if (window.api.onDismissReply) {
  window.api.onDismissReply(() => { if (stickyOpen && (stickyAction === 'reply' || stickyAction === 'choice')) hideBubble(); });
}

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
  if (moved >= 5) return;                 // 有移動 = 拖曳，不算點擊
  // 點一下 = 下一句名言；快速點兩下 = 打開面板
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
    window.api.togglePanel();
  } else {
    clickTimer = setTimeout(() => {
      clickTimer = null;
      if (window.api.speakRandomQuote) window.api.speakRandomQuote();
    }, 280);
  }
});
let clickTimer = null;

// ✏️ 按鈕：隨時對 Claude 說話
const composeBtn = document.getElementById('composeBtn');
if (composeBtn) {
  composeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  composeBtn.addEventListener('click', (e) => { e.stopPropagation(); if (window.api.openCompose) window.api.openCompose(); });
}

// 📋 按鈕：打開面板（和點角色兩下一樣，只是看得見）
const panelBtn = document.getElementById('panelBtn');
if (panelBtn) {
  panelBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  panelBtn.addEventListener('click', (e) => { e.stopPropagation(); window.api.togglePanel(); });
}
