// 球視窗的 preload：只接收主行程傳來的轉動角度與淡出指令
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ballApi', {
  onState: (cb) => ipcRenderer.on('ball:state', (_e, s) => cb(s))
});
