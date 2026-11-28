// 庫卡位置（家）的存檔節流（規格 2、10.2）
// 舞台每做完一個小動作就回報一次位置（q:rest）；30 隻時約每秒一次。
// 位置沒變就不寫；有變的先改在記憶體，最快每 10 秒才真的寫一次磁碟；結束程式前一定寫入（flush）。
(function () {
  const MIN_GAP_MS = 10000;
  function createPosSaver({ save, minGap = MIN_GAP_MS, setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now() }) {
    let timer = null, dirty = false, lastWrite = -Infinity;
    function write() { timer = null; if (!dirty) return; dirty = false; lastWrite = now(); save(); }
    // 回傳 true 表示位置真的變了（記憶體已更新，稍後寫入）
    function update(q, x, y) {
      if (!q || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      const nx = Math.round(x), ny = Math.round(y);
      if (q.home && q.home.x === nx && q.home.y === ny) return false;
      q.home = { x: nx, y: ny };
      dirty = true;
      if (!timer) timer = setTimer(write, Math.max(0, lastWrite + minGap - now()));
      return true;
    }
    // 結束程式前：有沒寫的就馬上寫
    function flush() { if (timer) { clearTimer(timer); timer = null; } if (dirty) write(); }
    // 別的修改已經整份寫入（位置也在裡面）：不用再另外寫
    function markSaved() { dirty = false; }
    return { update, flush, markSaved, get pending() { return dirty; } };
  }
  module.exports = { createPosSaver, MIN_GAP_MS };
})();
