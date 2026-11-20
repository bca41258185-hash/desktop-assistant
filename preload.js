// Preload：透過 contextBridge 暴露一個最小化、受控的 API 給 renderer。
// 不開啟 nodeIntegration，renderer 只能使用 window.api 下列方法。

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // --- 桌寵 ---
  movePetBy: (dx, dy) => ipcRenderer.send('pet:move-by', { dx, dy }),
  togglePanel: () => ipcRenderer.send('panel:toggle'),
  showPetMenu: () => ipcRenderer.send('pet:menu'),
  openCompose: () => ipcRenderer.send('pet:compose-open'),
  composeSend: (text, targetId) => ipcRenderer.send('pet:compose-send', { text, targetId }),
  focusClaude: (sessionId) => ipcRenderer.send('claude:focus', sessionId),
  answerChoice: (requestId, choice, text) => ipcRenderer.send('pet:choice', { requestId, choice, text }),
  notifyTyping: (requestId) => ipcRenderer.send('pet:typing', requestId),
  onInputExpire: (cb) => ipcRenderer.on('pet:input-expire', (_e, id) => cb(id)),
  onDismissReply: (cb) => ipcRenderer.on('pet:dismiss-reply', () => cb()),
  onSpeak: (cb) => ipcRenderer.on('pet:speak', (_e, text) => cb(text)),
  // 角色與姿勢
  onCharacter: (cb) => ipcRenderer.on('pet:character', (_e, payload) => cb(payload)),
  onPose: (cb) => ipcRenderer.on('pet:pose', (_e, pose) => cb(pose)),
  setBubbleOpen: (open) => ipcRenderer.send('pet:bubble', !!open),
  onLayout: (cb) => ipcRenderer.on('pet:layout', (_e, layout) => cb(layout)),
  onStatus: (cb) => ipcRenderer.on('pet:status', (_e, status) => cb(status)),
  setCharacter: (id) => ipcRenderer.invoke('character:set', id),
  onCharacterChanged: (cb) => ipcRenderer.on('character:changed', (_e, id) => cb(id)),

  // --- 名言 ---
  listQuotes: (id) => ipcRenderer.invoke('quotes:list', id),
  speakQuote: (index) => ipcRenderer.invoke('quotes:speak', index),
  speakRandomQuote: () => ipcRenderer.invoke('quotes:speak-random'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // --- 資料夾監看 ---
  pickFolders: () => ipcRenderer.invoke('folders:pick'),
  listFolders: () => ipcRenderer.invoke('folders:list'),
  removeFolder: (folder) => ipcRenderer.invoke('folders:remove', folder),
  listChanges: () => ipcRenderer.invoke('changes:list'),
  onChanges: (cb) => ipcRenderer.on('changes:update', (_e, list) => cb(list)),

  // --- AI 專案（Claude Code / Codex 進度，唯讀） ---
  listAi: () => ipcRenderer.invoke('ai:list'),
  addAiProject: () => ipcRenderer.invoke('ai:add-project'),
  removeAiProject: (p) => ipcRenderer.invoke('ai:remove-project', p),
  recentAiSessions: () => ipcRenderer.invoke('ai:recent-sessions'),
  addAiSession: (s) => ipcRenderer.invoke('ai:add-session', s),
  removeAiSession: (id) => ipcRenderer.invoke('ai:remove-session', id),
  installAiHooks: () => ipcRenderer.invoke('ai:hooks-install'),
  uninstallAiHooks: () => ipcRenderer.invoke('ai:hooks-uninstall'),
  onAiUpdate: (cb) => ipcRenderer.on('ai:update', (_e, list) => cb(list)),

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
