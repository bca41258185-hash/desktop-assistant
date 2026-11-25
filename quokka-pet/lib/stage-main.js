// 舞台圖層（主行程端，規格第 1、8.4、15 節）
// 每個螢幕一層全螢幕透明視窗，所有庫卡都畫在裡面；平常滑鼠穿透，游標碰到某隻庫卡才接收點擊。
// 判斷方式（三個平台通用）：舞台回報每隻庫卡的範圍 → 主行程依游標位置切換穿透。
//   游標在任一隻 150 px 內：每 50 ms 查一次；否則每 400 ms；使用者離開電腦時暫停。
(function () {
  function createStageManager({ BrowserWindow, screen, ipcMain, path, dir }) {
    const stages = new Map();          // displayId → { win, rects: [{id,x,y,w,h}], ignoring }
    let cursorTimer = null, paused = false;

    function create(display) {
      const wa = display.workArea;
      const win = new BrowserWindow({
        x: wa.x, y: wa.y, width: wa.width, height: wa.height,
        frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
        fullscreenable: false, skipTaskbar: true, hasShadow: false, focusable: true, alwaysOnTop: true, show: false,
        webPreferences: { preload: path.join(dir, 'stage-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setIgnoreMouseEvents(true, { forward: true });
      win.loadFile(path.join(dir, 'renderer', 'stage.html'));
      win.once('ready-to-show', () => win.showInactive());
      const st = { win, display, rects: [], ignoring: true };
      stages.set(display.id, st);
      return st;
    }
    function primary() {
      const d = screen.getPrimaryDisplay();
      return stages.get(d.id) || create(d);
    }
    function setIgnore(st, ignore) {
      if (st.ignoring === ignore || st.win.isDestroyed()) return;
      st.ignoring = ignore;
      st.win.setIgnoreMouseEvents(ignore, { forward: true });
    }
    // 游標判斷：碰到任一隻就讓舞台可點；拖曳中（舞台自己回報）維持可點
    function poll() {
      if (paused) { cursorTimer = setTimeout(poll, 1000); return; }
      const c = screen.getCursorScreenPoint();
      let near = false;
      for (const st of stages.values()) {
        let over = st.dragging;
        for (const r of st.rects) {
          const dx = Math.max(r.x - c.x, 0, c.x - (r.x + r.w)), dy = Math.max(r.y - c.y, 0, c.y - (r.y + r.h));
          if (dx === 0 && dy === 0) over = true;
          if (dx < 150 && dy < 150) near = true;
        }
        setIgnore(st, !over);
        if (near && !st.win.isDestroyed()) st.win.webContents.send('stage:cursor', { x: c.x - st.display.workArea.x, y: c.y - st.display.workArea.y });
      }
      cursorTimer = setTimeout(poll, near ? 50 : 400);
    }
    ipcMain.on('stage:rects', (e, { rects, dragging }) => {
      for (const st of stages.values()) {
        if (st.win.isDestroyed() || st.win.webContents.id !== e.sender.id) continue;
        const ox = st.display.workArea.x, oy = st.display.workArea.y;
        st.rects = (Array.isArray(rects) ? rects : []).slice(0, 500).map((r) => ({ id: r.id, x: r.x + ox, y: r.y + oy, w: r.w, h: r.h }));
        st.dragging = !!dragging;
        if (dragging) setIgnore(st, false);
      }
    });
    function start() { primary(); if (!cursorTimer) poll(); }
    function send(channel, payload) { for (const st of stages.values()) if (!st.win.isDestroyed()) st.win.webContents.send(channel, payload); }
    function pause(v) { paused = !!v; }
    return { start, send, pause, stages, primary };
  }
  module.exports = { createStageManager };
})();
