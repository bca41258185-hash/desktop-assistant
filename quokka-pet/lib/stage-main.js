// 舞台圖層（主行程端，規格第 1、8.4、15 節）
// 每個螢幕一層全螢幕透明視窗，所有庫卡都畫在裡面；平常滑鼠穿透，游標碰到某隻庫卡才接收點擊。
// 判斷方式（三個平台通用）：舞台回報每隻庫卡的範圍 → 主行程依游標位置切換穿透。
//   游標在任一隻 150 px 內：每 50 ms 查一次；400 px 內（看向游標）每 120 ms；否則每 400 ms；使用者離開電腦時暫停。
(function () {
  // 連續第 n 次當掉後，等多久再重新載入
  const REVIVE_STEPS = [0, 10000, 30000, 60000, 120000], REVIVE_MAX = 300000, STABLE_MS = 60000;
  const crashed = (wc) => !!(wc && typeof wc.isCrashed === 'function' && wc.isCrashed());
  const reviveDelay = (n) => (n < REVIVE_STEPS.length ? REVIVE_STEPS[n] : REVIVE_MAX);
  function createStageManager({ BrowserWindow, screen, ipcMain, path, dir, onGone = null, setTimer = setTimeout, now = () => Date.now() }) {
    const stages = new Map();          // displayId → { win, rects: [{id,x,y,w,h}], ignoring }
    let cursorTimer = null, paused = false, menuWin = null;   // menuWin：右鍵選單開著的那一層（選單關掉前不切穿透、不放焦點）

    function create(display) {
      const wa = display.workArea;
      const win = new BrowserWindow({
        x: wa.x, y: wa.y, width: wa.width, height: wa.height,
        frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
        fullscreenable: false, skipTaskbar: true, hasShadow: false, focusable: true, alwaysOnTop: true, show: false,
        webPreferences: { preload: path.join(dir, 'stage-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false }
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setIgnoreMouseEvents(true, { forward: true });
      win.loadFile(path.join(dir, 'renderer', 'stage.html'));
      win.once('ready-to-show', () => win.showInactive());
      const st = { win, display, rects: [], ignoring: true, crashes: 0, reviveTimer: null, lastReload: 0 };
      // 舞台頁面當掉或沒回應（規格 1.4）：
      //   1. 立刻清掉可點範圍、回到滑鼠穿透（不能讓透明舞台擋住桌面）
      //   2. 重新載入（stage:ready 會補送名單、設定、響鈴中的提醒、離開狀態）；
      //      連續當掉就延後再試：0 秒、10 秒、30 秒、1 分、2 分、之後每 5 分鐘（上限），不會永遠放棄
      const revive = (why) => {
        if (win.isDestroyed()) return;
        st.rects = []; st.dragging = false; setIgnore(st, true);
        if (onGone) try { onGone(why); } catch (e) { /* 呼叫端出錯不影響重載 */ }
        if (st.reviveTimer) return;                                  // 已經排好了
        const t = now();
        if (t - st.lastReload > STABLE_MS) st.crashes = 0;           // 上次重載後穩定跑了一陣子：重新計算
        const delay = reviveDelay(st.crashes);
        st.crashes++;
        st.reviveTimer = setTimer(() => {
          st.reviveTimer = null;
          if (win.isDestroyed()) return;
          st.lastReload = now();
          // 卡死（無限迴圈）的頁面不理 reload：先強制結束它的畫面程式（不再算成另一次當掉），再載入
          if (st.hung && !crashed(win.webContents)) { st.killing = true; try { win.webContents.forcefullyCrashRenderer(); } catch (e) { st.killing = false; } }
          st.hung = false;
          try { win.webContents.reload(); } catch (e) { /* 下次當掉再試 */ }
        }, delay);
      };
      win.webContents.on('render-process-gone', () => { if (st.killing) { st.killing = false; return; } revive('gone'); });
      win.on('unresponsive', () => { st.hung = true; revive('unresponsive'); });
      win.on('responsive', () => { st.hung = false; });
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
      // 游標離開庫卡、舞台恢復穿透時，把鍵盤焦點放掉，不搶使用者正在打字的視窗（拖曳中不會走到這裡）
      if (ignore && st.win.isFocused()) st.win.blur();
    }
    // 游標判斷：碰到任一隻就讓舞台可點；拖曳中（舞台自己回報）維持可點
    function poll() {
      if (paused) { cursorTimer = setTimeout(poll, 1000); return; }
      const c = screen.getCursorScreenPoint();
      let near = false, look = false;
      for (const st of stages.values()) {
        if (menuWin === st.win) continue;                         // 選單開著：游標移到選單上不能讓舞台變穿透、放掉焦點（選單會被關掉）
        let over = st.dragging;
        for (const r of st.rects) {
          const dx = Math.max(r.x - c.x, 0, c.x - (r.x + r.w)), dy = Math.max(r.y - c.y, 0, c.y - (r.y + r.h));
          if (dx === 0 && dy === 0) over = true;
          if (dx < 150 && dy < 150) near = true;
          if (dx < 400 && dy < 400) look = true;   // 400 px 內庫卡會看向游標
        }
        setIgnore(st, !over);
        if (look && !st.win.isDestroyed()) st.win.webContents.send('stage:cursor', { x: c.x - st.display.workArea.x, y: c.y - st.display.workArea.y });
      }
      cursorTimer = setTimeout(poll, near ? 50 : look ? 120 : 400);
    }
    ipcMain.on('stage:rects', (e, msg) => {
      const { rects, dragging } = msg || {};
      for (const st of stages.values()) {
        if (st.win.isDestroyed() || st.win.webContents.id !== e.sender.id) continue;
        const ox = st.display.workArea.x, oy = st.display.workArea.y;
        st.rects = (Array.isArray(rects) ? rects : []).slice(0, 500).filter((r) => r && [r.x, r.y, r.w, r.h].every(Number.isFinite)).map((r) => ({ id: r.id, x: r.x + ox, y: r.y + oy, w: r.w, h: r.h }));
        st.dragging = !!dragging && !paused;                 // 暫停（離開、鎖定、隱藏）時不接受拖曳狀態，舞台維持穿透
        if (st.dragging) setIgnore(st, false);
      }
    });
    function start() { primary(); if (!cursorTimer) poll(); }
    function send(channel, payload) { for (const st of stages.values()) if (!st.win.isDestroyed() && !crashed(st.win.webContents)) { try { st.win.webContents.send(channel, payload); } catch (e) { /* 頁面正在重載 */ } } }
    // 暫停（離開、鎖定、隱藏）時一律先恢復穿透，不能讓透明舞台擋住桌面
    function pause(v) {
      paused = !!v;
      if (paused) for (const st of stages.values()) { st.dragging = false; setIgnore(st, true); }
      else if (cursorTimer) { clearTimeout(cursorTimer); poll(); }
    }
    // 解析度、工作列、外接螢幕變動：舞台跟著工作區重新對齊
    function refit() {
      const d = screen.getPrimaryDisplay();
      for (const [id, st] of [...stages]) {
        if (st.win.isDestroyed()) { stages.delete(id); continue; }
        st.display = d; st.rects = [];
        const wa = d.workArea;
        st.win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height });
        if (id !== d.id) { stages.delete(id); stages.set(d.id, st); }
      }
    }
    for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, refit);
    // 在某一層（送出事件的那個網頁）打開原生右鍵選單：選單開著時維持可點、保留焦點，關掉後回到一般判斷
    function popupMenu(menu, sender) {
      let st = null;
      for (const x of stages.values()) if (!x.win.isDestroyed() && x.win.webContents === sender) st = x;
      st = st || primary();
      if (st.win.isDestroyed()) return;
      menuWin = st.win; setIgnore(st, false); st.win.focus();
      menu.popup({ window: st.win, callback: () => { if (menuWin === st.win) menuWin = null; } });
    }
    return { start, send, pause, stages, primary, popupMenu };
  }
  module.exports = { createStageManager, reviveDelay, REVIVE_MAX, STABLE_MS };
})();
