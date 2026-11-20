// Preload：透過 contextBridge 暴露一個最小化、受控的 API 給 renderer。
// 不開啟 nodeIntegration，renderer 只能使用 window.api 下列方法。

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // --- 桌寵 ---
  movePetBy: (dx, dy) => ipcRenderer.send('pet:move-by', { dx, dy }),
  togglePanel: () => ipcRenderer.send('panel:toggle'),
  onSpeak: (cb) => ipcRenderer.on('pet:speak', (_e, text) => cb(text)),

  // --- 資料夾監看 ---
  pickFolders: () => ipcRenderer.invoke('folders:pick'),
  listFolders: () => ipcRenderer.invoke('folders:list'),
  removeFolder: (folder) => ipcRenderer.invoke('folders:remove', folder),
  listChanges: () => ipcRenderer.invoke('changes:list'),
  onChanges: (cb) => ipcRenderer.on('changes:update', (_e, list) => cb(list)),

  // --- 設定 ---
  getSettings: () => ipcRenderer.invoke('config:get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('config:save-settings', s),

  // --- 任務 ---
  listTasks: () => ipcRenderer.invoke('tasks:list'),
  addTask: (text) => ipcRenderer.invoke('tasks:add', text),
  toggleTask: (id) => ipcRenderer.invoke('tasks:toggle', id),
  removeTask: (id) => ipcRenderer.invoke('tasks:remove', id),

  // --- AI 聊天 ---
  sendChat: (payload) => ipcRenderer.invoke('chat:send', payload)
});
