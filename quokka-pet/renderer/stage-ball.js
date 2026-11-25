// 舞台裡的球（規格 6.4）：DOM 元素＋物理，和庫卡共用同一個排程迴圈
// 重力、越彈越低、滾動摩擦、螢幕邊反彈；籃球有籃框（兩個框邊＋籃板）碰撞與進球判定
// 地面＝丟球那隻的腳下那條線；每隻最多 1 顆；球不跨螢幕
(function () {
  const S = window.Stage;
  const LIFE_MS = 40000;                  // 40 秒沒撿就消失

  class Ball {
    constructor(owner, kind, x, y, vx, vy, hoop) {
      this.owner = owner; this.kind = kind;
      this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.hoop = hoop;
      this.k = owner.k;
      this.r = 12 * owner.k;
      this.G = 1500 * owner.k;
      this.ground = Math.min(owner.y, innerHeight - 2);
      this.rot = 0; this.stopped = false; this.scored = false; this.picked = false; this.gone = false;
      this.born = performance.now();
      this.size = Math.round(32 * owner.k);
      this.el = document.createElement('div');
      this.el.className = 'ball';
      this.el.style.width = this.el.style.height = this.size + 'px';
      this.el.innerHTML = S.POSE.ballSVG(kind);
      S.fxEl.appendChild(this.el);
      if (owner.ball && owner.ball !== this) owner.ball.remove();
      owner.ball = this;
      S.balls.add(this);
      this.place();
      S.kick();
    }
    // 物理（dt 秒）；回傳 true＝還需要下一格
    tick(dt, now) {
      if (this.gone) return false;
      if (!this.picked && now - this.born > LIFE_MS) { this.fade(); this.owner.ballGone && this.owner.ballGone('timeout'); return false; }
      if (this.stopped || this.held) return this.nudging;
      const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;
      for (let i = 0; i < steps && !this.stopped; i++) this.step(h);
      this.place();
      if (this.stopped) { this.owner.ballStopped && this.owner.ballStopped(this); }
      return !this.stopped || this.nudging;
    }
    step(h) {
      const floor = this.ground - this.r, px = this.x, py = this.y;
      this.vy += this.G * h;
      this.x += this.vx * h; this.y += this.vy * h;
      const H = this.hoop;
      if (H) {
        for (const rx of [H.left, H.right]) {                           // 框邊當小圓點
          const dx = this.x - rx, dy = this.y - H.y, d = Math.hypot(dx, dy), min = this.r + 2 * this.k;
          if (d < min && d > 0) {
            const nx = dx / d, ny = dy / d, vn = this.vx * nx + this.vy * ny;
            if (vn < 0) { this.vx -= 1.6 * vn * nx; this.vy -= 1.6 * vn * ny; this.x = rx + nx * min; this.y = H.y + ny * min; }
          }
        }
        // 籃板（籃框在左邊時，板子在框的右側）
        if (this.x - this.r < H.board && this.x > H.board - 30 * this.k && this.y > H.boardTop && this.y < H.boardBottom && this.vx < 0) { this.vx = -this.vx * .55; this.x = H.board + this.r; }
        // 從框中間往下穿過＝進球
        if (!this.scored && py < H.y && this.y >= H.y && this.x > H.left + 3 && this.x < H.right - 3 && this.vy > 0) {
          this.scored = true; this.vx *= .3;
          this.owner.ballScored && this.owner.ballScored(this);
        }
      }
      // 螢幕邊
      if (this.x - this.r < 0) { this.x = this.r; this.vx = Math.abs(this.vx) * .6; }
      if (this.x + this.r > innerWidth) { this.x = innerWidth - this.r; this.vx = -Math.abs(this.vx) * .6; }
      if (this.y - this.r < 0) { this.y = this.r; this.vy = Math.abs(this.vy) * .5; }
      // 地面：越彈越低，太低就改成滾動（滾動摩擦）
      if (this.y > floor) {
        this.y = floor;
        if (Math.abs(this.vy) > 140 * this.k) { this.vy = -this.vy * (this.kind === 'bball' ? .62 : .5); this.vx *= .88; }
        else { this.vy = 0; this.vx *= Math.pow(.2, h); if (Math.abs(this.vx) < 10) { this.vx = 0; this.stopped = true; } }
      }
      this.rot += (this.x - px) / this.r * 57.3;
    }
    // 被鼻子推：往前滾一小段（由撿球流程每格呼叫）
    rollTo(x) { this.rot += (x - this.x) / this.r * 57.3; this.x = x; this.y = this.ground - this.r; this.place(); }
    place() {
      const s = this.size / 2;
      this.el.style.transform = `translate3d(${(this.x - s).toFixed(1)}px, ${(this.y - s).toFixed(1)}px, 0) rotate(${this.rot.toFixed(0)}deg)`;
    }
    hide() { this.held = true; this.el.style.visibility = 'hidden'; }
    show(x, y) { this.held = false; this.el.style.visibility = ''; if (x != null) { this.x = x; this.y = y != null ? y : this.ground - this.r; } this.place(); }
    // 淡出（被拖走、太遠、時間到、排球到家拍一拍之後）
    fade() {
      if (this.gone) return;
      this.gone = true; this.el.style.visibility = ''; this.el.classList.add('fade');
      S.balls.delete(this);
      if (this.owner.ball === this) this.owner.ball = null;
      setTimeout(() => this.el.remove(), 600);
    }
    remove() { this.gone = true; S.balls.delete(this); this.el.remove(); if (this.owner.ball === this) this.owner.ball = null; }
  }
  S.Ball = Ball;
})();
