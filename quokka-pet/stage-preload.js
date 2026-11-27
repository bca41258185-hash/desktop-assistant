// 舞台圖層的 preload：只開放舞台需要的通道（規格 1.5 節）
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const on = (ch) => (cb) => ipcRenderer.on(ch, (_e, p) => cb(p));
const str = (v, n = 80) => String(v == null ? '' : v).slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
contextBridge.exposeInMainWorld('stageApi', {
  // 主行程 → 舞台
  onQuokkas: on('stage:quokkas'),           // 全部名單（相容舊名稱）
  onInit: on('stage:init'),                 // {display, actors[]}
  onAdd: on('stage:add'),                   // {q}
  onUpdate: on('stage:update'),             // {q}
  onRemove: on('stage:remove'),             // {qid, reason}
  onSettings: on('stage:settings'),         // {fetchReturn, walk: 'home'|'screen'|'off', reducedMotion: 'system'|'on'|'off'}
  onEvent: on('q:event'),                   // {qid, kind, payload, prio}
  onAlert: on('q:alert'),                   // {qid, reminderId, text}
  onAlertClear: on('q:alert-clear'),        // {qid, reminderId}
  onPlay: on('q:play'),                     // {qid, action}
  onPresence: on('presence'),               // {away, locked, digest?}
  onCursor: on('stage:cursor'),             // {x, y}
  onHide: on('stage:hide'),                 // {until}
  onSocialStart: on('social:start'),        // {pairId, a, b, type, initiator}
  onSocialAbort: on('social:abort'),        // {pairId, by, reason}
  onPerf: on('stage:perf'),                 // {fps: 60|30}（使用電池、省電模式時 30；沒收到＝60）
  onLeafRain: on('stage:leafrain'),
  onRelease: on('stage:release'),           // {qid}：放生，禿鷹把這隻帶出畫面
  onArrive: on('stage:arrive'),             // {qid, line}：回信後回來，禿鷹把這隻帶回來放下         // {by: 'cursor', x, y, r}：使用者用滑鼠快速繞圈，從繞圈的位置下一陣落葉雨
  // 舞台 → 主行程
  ready: () => ipcRenderer.send('stage:ready'),
  reportRects: (rects, dragging) => ipcRenderer.send('stage:rects', { rects, dragging: !!dragging }),
  savePos: (id, pos) => ipcRenderer.send('stage:save-pos', { id: str(id), pos: { x: num(pos && pos.x), y: num(pos && pos.y) } }),
  rest: (qid, x, y) => ipcRenderer.send('q:rest', { qid: str(qid), x: num(x), y: num(y) }),
  state: (qid, layer) => ipcRenderer.send('q:state', { qid: str(qid), layer: num(layer) }),
  dblclick: (qid) => ipcRenderer.send('q:dblclick', { qid: str(qid) }),
  context: (qid) => ipcRenderer.send('q:context', { qid: str(qid) }),
  ack: (reminderId) => ipcRenderer.send('alert:ack', { reminderId: str(reminderId) }),
  pos: (list) => ipcRenderer.send('q:pos', (Array.isArray(list) ? list : []).slice(0, 500).map((p) => ({ qid: str(p.qid), x: num(p.x), y: num(p.y), display: 'primary' }))),
  pass: (a, b) => ipcRenderer.send('q:pass', { a: str(a), b: str(b) }),
  socialDone: (pairId, ok, type) => ipcRenderer.send('social:done', { pairId: str(pairId), ok: !!ok, type: str(type, 30) }),
  socialAbort: (pairId, by, reason) => ipcRenderer.send('social:abort', { pairId: str(pairId), by: str(by), reason: str(reason, 20) }),
  shortcuts: (qid) => ipcRenderer.invoke('shortcuts:list', { qid: str(qid) }),          // [{ id, name, path, dir, missing, icon }]
  openShortcut: (id) => ipcRenderer.send('shortcut:open', { id: str(id) }),
  // 拖進來的檔案：在這裡換成路徑（網頁那邊拿不到路徑）
  dropShortcuts: (qid, files) => ipcRenderer.send('shortcut:drop', { qid: str(qid), paths: (Array.isArray(files) ? files : []).slice(0, 20).map((f) => { try { return webUtils.getPathForFile(f); } catch (e) { return ''; } }).filter(Boolean).map((p) => str(p, 1024)) }),
  snooze: (reminderId) => ipcRenderer.send('alert:snooze', { reminderId: str(reminderId) })
});
