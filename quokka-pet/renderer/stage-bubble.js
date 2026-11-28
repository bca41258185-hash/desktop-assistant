// 舞台的說話氣泡、提醒氣泡與小特效（星星、煙火）
// · 說話氣泡：大字、圓角、柔和陰影，不接收滑鼠（不擋使用者），幾秒後自己收起
// · 提醒氣泡：一直顯示，直到按「知道了」或「5 分後」；會回報可點範圍給主行程（滑鼠穿透判斷）
// · 氣泡放在最上層的 #fx，位置跟著庫卡（拖曳時一起走）
(function () {
  const S = window.Stage;

  class Bubble {
    constructor(actor) {
      this.a = actor;
      this.el = document.createElement('div');
      this.el.className = 'bubble';
      this.el.setAttribute('role', 'status');
      this.el.setAttribute('aria-live', 'polite');
      this.textEl = document.createElement('div'); this.textEl.className = 'bubble-text';
      this.btns = document.createElement('div'); this.btns.className = 'bubble-btns';
      this.el.append(this.textEl, this.btns);
      S.fxEl.appendChild(this.el);
      this.kind = null;          // null | 'say' | 'alert'
      this.timer = 0; this.bw = 0; this.bh = 0;
      // 提醒氣泡的按鈕：按下時不要變成拖曳庫卡
      this.el.addEventListener('mousedown', (e) => e.stopPropagation());
      this.el.addEventListener('click', (e) => {
        if (this.kind !== 'alert') return;
        e.stopPropagation();
        const b = e.target.closest('button');
        if (b && b.dataset.act === 'more') return;
        const row = e.target.closest('[data-rid]');
        // 按鈕＝那一則的「知道了／5 分後」；點某一則的文字＝那一則知道了；只有一則時點氣泡任何地方＝知道了
        const rid = b && b.dataset.rid ? b.dataset.rid : row ? row.dataset.rid : (this.list && this.list.length === 1 ? this.list[0].reminderId : null);
        if (rid == null) return;
        this.a.answerAlert(rid, b ? b.dataset.act : 'ack');
      });
    }
    // 說一句：text 可以帶顏色（台股漲紅跌綠）
    say(text, { ms = 2600, tone = '', big = false } = {}) {
      if (this.kind === 'alert') return;                           // 響鈴中不蓋掉提醒
      clearTimeout(this.timer);
      this.kind = 'say';
      this.el.className = 'bubble say show' + (tone ? ' tone-' + tone : '') + (big ? ' big' : '');
      this.el.setAttribute('role', 'status');
      this.el.setAttribute('aria-live', 'polite');
      // text 可以是字串，或 [{t, tone}] 片段（例如多檔股票各自漲紅跌綠）
      this.textEl.textContent = '';
      if (Array.isArray(text)) {
        for (const seg of text.slice(0, 20)) {
          const sp = document.createElement('span');
          sp.textContent = S.str(seg && seg.t, 60);
          if (seg && seg.tone) sp.className = 'tone-' + seg.tone;
          this.textEl.appendChild(sp);
        }
      } else this.textEl.textContent = S.str(text);
      this.btns.textContent = '';
      this.measure(); this.place();
      this.timer = setTimeout(() => this.hide('say'), ms);
    }
    // 提醒氣泡（規格 4.1）：同一隻同時有好幾個提醒在響 → 全部列出來，每一則各自有「知道了／5 分後」；
    // 太多時列前 MAX_ROWS 則，最後一行顯示「還有 N 則」（前面的按掉，後面的就遞補上來）
    alerts(list) {
      list = (list || []).slice();
      if (!list.length) { this.hide('alert'); return; }
      clearTimeout(this.timer);
      const MAX_ROWS = 3, shown = list.slice(0, MAX_ROWS), more = list.length - shown.length;
      this.kind = 'alert'; this.alertId = shown[0].reminderId; this.list = list;
      this.el.className = 'bubble alert show' + (list.length > 1 ? ' multi' : '');
      this.el.setAttribute('role', 'alertdialog');
      this.el.setAttribute('aria-live', 'assertive');
      this.el.setAttribute('aria-label', '提醒：' + list.map((x) => S.str(x.text)).join('；'));
      this.textEl.textContent = ''; this.btns.textContent = '';
      const mkBtns = (rid, box) => {
        for (const [act, label] of [['ack', '知道了'], ['snooze', '5 分後']]) {
          const b = document.createElement('button'); b.type = 'button'; b.dataset.act = act; b.dataset.rid = rid; b.textContent = label;
          b.setAttribute('aria-label', label + '：' + S.str(this.list.find((x) => x.reminderId === rid).text, 60));
          box.appendChild(b);
        }
      };
      if (list.length === 1) {                                     // 只有一則：和以前一樣（文字＋一排按鈕）
        const row = document.createElement('div'); row.dataset.rid = shown[0].reminderId; row.textContent = '⏰ ' + S.str(shown[0].text);
        this.textEl.appendChild(row);
        mkBtns(shown[0].reminderId, this.btns);
      } else {
        for (const al of shown) {
          const row = document.createElement('div'); row.className = 'alert-row';
          const t = document.createElement('div'); t.className = 'alert-text'; t.dataset.rid = al.reminderId; t.textContent = '⏰ ' + S.str(al.text);
          const bx = document.createElement('div'); bx.className = 'bubble-btns small';
          mkBtns(al.reminderId, bx);
          row.append(t, bx); this.textEl.appendChild(row);
        }
        if (more > 0) { const m = document.createElement('div'); m.className = 'alert-more'; m.textContent = `還有 ${more} 則`; this.textEl.appendChild(m); }
      }
      this.measure(); this.place();
      S.reportRects();
    }
    // 舊介面：一則
    alert(reminderId, text) { this.alerts([{ reminderId, text }]); }
    hide(kind) {
      if (kind && this.kind !== kind) return;
      clearTimeout(this.timer);
      const wasAlert = this.kind === 'alert';
      this.kind = null; this.alertId = null; this.list = null;
      this.el.classList.remove('show', 'alert', 'multi');
      this.btns.textContent = '';
      if (wasAlert) S.reportRects();
    }
    measure() { this.bw = this.el.offsetWidth; this.bh = this.el.offsetHeight; }
    // 跟著庫卡：在頭上方置中；靠螢幕邊時往內推，尾巴仍指向庫卡
    place() {
      if (!this.kind) return;
      const a = this.a, headTop = a.y - 168 * a.k + (a.dy || 0);
      const left = S.clamp(a.x - this.bw / 2, 8, Math.max(8, innerWidth - this.bw - 8));
      let top = headTop - this.bh - 12;
      if (top < 8) top = 8;
      this.left = left; this.top = top;
      this.el.style.transform = `translate3d(${left.toFixed(0)}px, ${top.toFixed(0)}px, 0)`;
      this.el.style.setProperty('--tail-x', S.clamp(a.x - left, 18, this.bw - 18).toFixed(0) + 'px');
    }
    // 提醒氣泡要能點：回報範圍（含一點邊距）
    clickRect() {
      if (this.kind !== 'alert') return null;
      return { id: this.a.id, kind: 'bubble', x: Math.round(this.left - 4), y: Math.round(this.top - 4), w: Math.round(this.bw + 8), h: Math.round(this.bh + 16) };
    }
    destroy() { clearTimeout(this.timer); this.el.remove(); }
  }
  S.Bubble = Bubble;

  // 小特效：撒星星、煙火（純 CSS 動畫，播完就移除；不重畫庫卡）
  S.burst = function (x, y, kind = 'stars') {
    if (S.reduceMotion) return;
    const box = document.createElement('div');
    box.className = 'burst ' + kind;
    box.style.transform = `translate3d(${x.toFixed(0)}px, ${y.toFixed(0)}px, 0)`;
    const waves = kind === 'fireworks' ? [[0, -60, -150], [350, 70, -120], [700, -10, -190]] : [[0, 0, 0]];
    const colors = kind === 'hearts' || kind === 'heart1' ? ['#ef6f7c', '#f59ab0', '#e8576a'] : ['#ffcf3f', '#ff7a6b', '#7fd0ff', '#b98cff', '#7be08f'];
    let n = 0;
    for (const [delay, ox, oy] of waves) {
      const count = kind === 'fireworks' ? 14 : kind === 'big' ? 14 : kind === 'heart1' ? 2 : kind === 'worry' ? 1 : 8;
      for (let i = 0; i < count; i++) {
        const s = document.createElement('span');
        const ang = (i / count) * Math.PI * 2 + Math.random() * .3, dist = (kind === 'fireworks' ? 55 : kind === 'big' ? 90 : 60) * (0.7 + Math.random() * .5);
        s.textContent = kind === 'fireworks' ? '' : kind === 'hearts' || kind === 'heart1' ? '♥' : kind === 'worry' ? '？' : '★';
        if (kind === 'heart1' || kind === 'worry') { s.style.cssText = `--ox:${i * 14 - 6}px;--oy:${-i * 8}px;--dx:${i ? 8 : -6}px;--dy:-52px;--c:${kind === 'worry' ? '#7c93b8' : '#ef6f7c'};animation-delay:${i * 260}ms;font-size:${kind === 'worry' ? 20 : 15 - i * 3}px;font-weight:900`; box.appendChild(s); continue; }
        s.style.cssText = `--ox:${ox}px;--oy:${oy}px;--dx:${(Math.cos(ang) * dist).toFixed(0)}px;--dy:${(Math.sin(ang) * dist - (kind === 'fireworks' ? 0 : 30)).toFixed(0)}px;--c:${colors[(i + n) % colors.length]};animation-delay:${delay}ms`;
        box.appendChild(s);
      }
      n++;
    }
    S.fxEl.appendChild(box);
    setTimeout(() => box.remove(), kind === 'fireworks' ? 2200 : 1500);
  };
})();
