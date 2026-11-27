// 面板的 preload：只開放面板需要的通道（規格第 1.5 節）
// 所有請求都由主行程驗證；面板只拿得到下面這些方法。
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};
const call = (channel) => (payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('api', {
  // 狀態
  getState: () => ipcRenderer.invoke('state:get'),
  onState: on('store:changed'),
  onStockTick: on('stock:tick'),
  onSelect: on('panel:select'),
  onFolderChanges: on('folder:changes'),   // { id, files, dirs, at, recent: [{ at, kind, path }] }

  // 待辦、提醒、股票、資料夾
  addItem: call('item:add'),
  updateItem: call('item:update'),
  removeItem: call('item:remove'),
  undo: (undoToken) => ipcRenderer.invoke('item:undo', undoToken),
  reassign: call('item:reassign'),

  // 庫卡
  createQuokka: call('quokka:create'),
  renameQuokka: call('quokka:rename'),
  regenerateQuokka: call('quokka:regenerate'),
  setAccessory: call('quokka:set-accessory'),
  deleteQuokka: call('quokka:delete'),
  readPostcard: call('postcard:read'),
  replyPostcard: call('postcard:reply'),
  giveGift: call('gift:give'),
  itemGrab: (item) => ipcRenderer.send('item:grab', { item: String(item || '').slice(0, 20) }),   // 道具包：開始拖出面板
  itemRelease: (cancel) => ipcRenderer.send('item:release', { cancel: !!cancel }),
  itemOffer: (p) => ipcRenderer.send('item:offer', { qid: String((p && p.qid) || '').slice(0, 80), item: String((p && p.item) || '').slice(0, 20) }),
  deleteWarning: call('quokka:delete-warning'),
  stockReport: (p) => ipcRenderer.invoke('stock:report', p),
  play: call('quokka:play'),
  nameBaby: call('baby:name'),

  // 設定與其他
  setSettings: call('settings:set'),
  pickFolder: call('folders:pick'),
  ackAlert: call('alert:ack'),
  snoozeAlert: call('alert:snooze')
});
