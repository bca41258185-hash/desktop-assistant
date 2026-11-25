// 庫卡桌面助理（v2）進入點：多隻庫卡在透明舞台圖層上，各自盯自己的待辦、提醒、股票、資料夾。
// 主要邏輯在 lib/app-v2.js；規格見 docs/interaction-logic.md。
// 過渡期：QUOKKA_LEGACY=1 可以執行舊的單隻版（legacy-main.js），之後會移除。
const { app, Menu } = require('electron');

if (process.env.QUOKKA_LEGACY === '1') {
  require('./legacy-main.js');
} else {
  // 只允許開一個：第二次開啟時把面板叫出來
  if (!app.requestSingleInstanceLock()) { app.quit(); }
  else {
    let v2 = null;
    app.on('second-instance', () => { if (v2) v2.showPanel(); });
    app.whenReady().then(() => {
      Menu.setApplicationMenu(null);
      v2 = require('./lib/app-v2').start();
      global.v2 = v2;
    });
    // 面板關掉只是隱藏；舞台一直在，所以不因為「所有視窗關閉」而結束
    app.on('window-all-closed', () => {});
  }
}
