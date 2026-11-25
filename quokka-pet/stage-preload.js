// 舞台圖層的 preload：只開放舞台需要的通道
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('stageApi', {
  reportRects: (rects, dragging) => ipcRenderer.send('stage:rects', { rects, dragging }),
  onCursor: (cb) => ipcRenderer.on('stage:cursor', (_e, p) => cb(p)),
  onQuokkas: (cb) => ipcRenderer.on('stage:quokkas', (_e, list) => cb(list)),
  savePos: (id, pos) => ipcRenderer.send('stage:save-pos', { id, pos }),
  ready: () => ipcRenderer.send('stage:ready')
});
