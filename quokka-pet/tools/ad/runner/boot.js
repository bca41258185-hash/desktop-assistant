// 廣告逐格算圖的 Electron 進入點（只讀專案檔案，不修改專案）
//   electron runner/ --force-device-scale-factor=N   環境變數 SHOT=<鏡頭名> OUT=<輸出.mp4>
// 1. 先裝主行程虛擬時鐘（vc-main.js），再載入專案的 main.js（程式本身）
// 2. 攔截 file:// 的 stage.html／panel.html：在第一個 <script> 前插入頁面虛擬時鐘（vc-renderer.js）
// 3. 程式啟動後交給 driver.js 跑該鏡頭的腳本，逐格前進、截圖、送進 ffmpeg
const path = require('path'), fs = require('fs');
const VC = require('./vc-main.js');
const { app, protocol, net } = require('electron');
const PROJ = path.resolve(process.env.QUOKKA_DIR || path.join(__dirname, '..', '..', '..'));   // 專案資料夾（tools/ad/runner → quokka-pet）
const SHOTS = require(path.join(__dirname, '..', 'shots.js'));
const shot = SHOTS[process.env.SHOT];
if (!shot) { console.error('no shot', process.env.SHOT); process.exit(2); }

// ---- 設定檔（每個鏡頭各自一份）-------------------------------------------------------
const cfgDir = process.env.XDG_CONFIG_HOME;
fs.rmSync(cfgDir, { recursive: true, force: true });
fs.mkdirSync(path.join(cfgDir, 'quokka-pet'), { recursive: true });
fs.writeFileSync(path.join(cfgDir, 'quokka-pet', 'config.json'), JSON.stringify(require('../cast.js').config(shot)));
app.setPath('userData', path.join(cfgDir, 'quokka-pet'));

// 沒有 Xvfb 的電腦（Windows／macOS）：把主螢幕改報成鏡頭的邏輯大小（實驗性）
if (process.env.AD_FAKE_SCREEN) {
  const [fw, fh] = process.env.AD_FAKE_SCREEN.split('x').map(Number);
  app.whenReady().then(() => {
    const { screen } = require('electron');
    const real = screen.getPrimaryDisplay.bind(screen);
    const fake = () => { const d = real(); return { ...d, bounds: { x: 0, y: 0, width: fw, height: fh }, workArea: { x: 0, y: 0, width: fw, height: fh }, size: { width: fw, height: fh }, workAreaSize: { width: fw, height: fh } }; };
    screen.getPrimaryDisplay = fake; screen.getAllDisplays = () => [fake()];
  });
}
const SHIM = fs.readFileSync(path.join(__dirname, 'vc-renderer.js'), 'utf8');
app.whenReady().then(() => {
  protocol.handle('file', async (req) => {
    const u = new URL(req.url), p = decodeURIComponent(u.pathname);
    if (p.endsWith('/renderer/__vc.js')) {
      return new Response(`window.__VC_DATE0__=${Math.floor(VC.dateNow())};window.__VC_SEED__=${Number(shot.seed) || 12345};\n` + SHIM, { headers: { 'content-type': 'text/javascript' } });
    }
    const fp = require('url').fileURLToPath(req.url);
    if (path.resolve(fp).startsWith(path.join(PROJ, 'renderer')) && /(stage|panel)\.html$/.test(fp)) {
      let html = fs.readFileSync(fp, 'utf8');
      html = html.replace('<script', '<script src="__vc.js"></script>\n  <script');
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });
  // 程式本身的 whenReady 在這之後註冊，所以攔截一定先裝好
  require(path.join(PROJ, 'main.js'));
  require('./driver.js')(shot).then(() => { app.exit(0); }, (e) => { console.error('DRIVER FAIL', e && e.stack || e); app.exit(1); });
});
