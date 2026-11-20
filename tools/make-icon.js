// 用 Electron 離屏渲染角色，產生 app 圖示（assets/icon.png 與 icon.ico）
// 用法：electron make-icon.js <repo 路徑> <角色 id>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const repo = process.argv[2];
const charId = process.argv[3] || 'zhuangzi';
const SIZE = 256;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, frame: false, transparent: true,
    webPreferences: { offscreen: true }
  });
  const base = 'file:///' + path.join(repo, 'renderer').replace(/\\/g, '/');
  const html = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;width:${SIZE}px;height:${SIZE}px;background:transparent;overflow:hidden}
  .tile{position:absolute;left:8px;top:8px;width:240px;height:240px;border-radius:54px;
        background:linear-gradient(160deg,#fbf8ee,#e6dfca);box-shadow:inset 0 0 0 4px #d8d2c2}
  #art{position:absolute;left:30px;top:26px;width:196px;height:218px}
  #art svg{width:100%;height:100%;display:block}
  .think-dots,.sketch-lines,.mouth-happy{display:none}
</style>
<div class="tile"></div><div id="art"></div>
<script src="${base}/characters-philosophers.js"></script><script src="${base}/characters.js"></script>
<script>document.getElementById('art').innerHTML = window.CHARACTERS[${JSON.stringify(charId)}].svg;</script>`;
  const tmp = path.join(app.getPath('temp'), 'da-icon.html');
  fs.writeFileSync(tmp, html);
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 800));
  const img = await win.webContents.capturePage();
  const png = img.resize({ width: SIZE, height: SIZE }).toPNG();
  const out = path.join(repo, 'assets');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), png);
  // ICO 可以直接內嵌 PNG（Windows Vista 之後支援）：6 位元組檔頭 + 16 位元組目錄 + PNG
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([head, png]));
  console.log('icon written', img.getSize(), png.length);
  app.quit();
});
