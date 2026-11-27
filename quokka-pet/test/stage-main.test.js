const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const path = require('path');
const { createStageManager, reviveDelay, REVIVE_MAX } = require('../lib/stage-main');

function setup() {
  let t = 1e9, id = 0; const timers = new Map();
  const ipcMain = new EventEmitter();
  const wins = [];
  class BW extends EventEmitter {
    constructor(o) { super(); this.o = o; this.ignore = true; this.reloads = 0; this.webContents = Object.assign(new EventEmitter(), { id: 7, reload: () => { this.reloads++; }, send() {} }); wins.push(this); }
    setAlwaysOnTop() {} setIgnoreMouseEvents(v) { this.ignore = v; } loadFile() {} once() {} isDestroyed() { return false; } isFocused() { return false; } blur() {} showInactive() {}
  }
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const screen = Object.assign(new EventEmitter(), { getPrimaryDisplay: () => display, getCursorScreenPoint: () => ({ x: 5000, y: 5000 }) });
  const gone = [];
  const sm = createStageManager({ BrowserWindow: BW, screen, ipcMain, path, dir: '/x', onGone: (w) => gone.push(w),
    setTimer: (fn, ms) => { timers.set(++id, { at: t + ms, fn, ms }); return id; }, now: () => t });
  const advance = (ms) => { const end = t + ms; for (;;) { const n = [...timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!n) break; timers.delete(n[0]); t = n[1].at; n[1].fn(); } t = end; };
  const st = sm.primary();
  return { sm, st, win: wins[0], ipcMain, advance, timers, gone };
}

test('退避：0、10 秒、30 秒、1 分、2 分，之後每 5 分鐘（不會永遠放棄）', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(reviveDelay), [0, 10000, 30000, 60000, 120000, REVIVE_MAX, REVIVE_MAX]);
});

test('舞台當掉：立刻清掉可點範圍、回到穿透；10 秒內第二次當掉也會延後重新載入', () => {
  const s = setup();
  // 舞台回報可點範圍、游標在庫卡上 → 不穿透
  s.ipcMain.emit('stage:rects', { sender: { id: 7 } }, { rects: [{ id: 'q', x: 10, y: 10, w: 80, h: 80 }], dragging: true });
  assert.equal(s.st.rects.length, 1); assert.equal(s.win.ignore, false);
  s.win.webContents.emit('render-process-gone');
  assert.equal(s.st.rects.length, 0); assert.equal(s.st.dragging, false); assert.equal(s.win.ignore, true);
  assert.deepEqual(s.gone, ['gone']);
  s.advance(0); assert.equal(s.win.reloads, 1);
  s.advance(4000);
  s.win.webContents.emit('render-process-gone');                         // 4 秒後又當掉
  s.advance(9999); assert.equal(s.win.reloads, 1);
  s.advance(1); assert.equal(s.win.reloads, 2);                           // 10 秒後再載入
  s.win.webContents.emit('render-process-gone');
  s.win.emit('unresponsive');                                             // 已經排好了：不重複排
  assert.equal(s.timers.size, 1);
  s.advance(30000); assert.equal(s.win.reloads, 3);
  // 穩定跑超過 1 分鐘：重新計算，下次當掉馬上載入
  s.advance(61000);
  s.win.webContents.emit('render-process-gone');
  s.advance(0); assert.equal(s.win.reloads, 4);
});

test('右鍵選單開著時：游標移到選單上，舞台仍然可點、不放掉焦點；選單關掉後才恢復穿透', () => {
  const realST = global.setTimeout, realCT = global.clearTimeout, q = [];
  global.setTimeout = (fn) => { q.push(fn); return q.length; }; global.clearTimeout = () => {};
  try {
    const s = setup();
    let blurred = 0, focused = 0, popped = null;
    s.win.blur = () => { blurred++; }; s.win.focus = () => { focused++; }; s.win.isFocused = () => true;
    s.sm.start(); q.shift()();                                           // 第一次 poll：游標不在庫卡上 → 穿透
    assert.equal(s.win.ignore, true);
    s.sm.popupMenu({ popup: (o) => { popped = o; } }, s.win.webContents);
    assert.equal(popped.window, s.win); assert.equal(s.win.ignore, false); assert.equal(focused, 1);
    q.shift()();                                                         // 選單開著，游標在選單上（不在庫卡範圍）
    assert.equal(s.win.ignore, false); assert.equal(blurred, 0);
    popped.callback();                                                   // 選單關掉
    q.shift()();
    assert.equal(s.win.ignore, true);
  } finally { global.setTimeout = realST; global.clearTimeout = realCT; }
});
