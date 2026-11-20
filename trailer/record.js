// 錄製預告片：用 Electron 離屏渲染 stage.html，把畫面以每秒 30 格送給 ffmpeg，配上 music.js 產生的配樂。
// 用法：electron trailer/record.js <輸出.mp4>
// 需要系統裝有 ffmpeg。舞台頁用 document.title 通知開始（GO）與結束（END）。

const { app, BrowserWindow } = require('electron');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'site', 'trailer.mp4'));
const W = 1920;
const H = 1080;
const FPS = 30;
const MUSIC = path.join(app.getPath('temp'), 'desktop-master-trailer-music.wav');

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  // 先產生配樂（比影片長一點，最後由 ffmpeg 裁到和畫面一樣長）
  const m = spawnSync(process.execPath, [path.join(__dirname, 'music.js'), MUSIC, '70'], { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }), encoding: 'utf8' });
  if (m.status !== 0) { console.error('配樂產生失敗', m.stderr); app.exit(1); return; }

  // Windows 不允許視窗比螢幕工作區高（1080p 螢幕扣掉工作列只剩 1032），
  // 所以用 0.95 倍的視窗加上 0.95 的縮放：版面仍是 1920×1080，畫面是 1824×1026，最後由 ffmpeg 放大回 1920×1080。
  const K = 0.95;
  const win = new BrowserWindow({
    width: Math.round(W * K), height: Math.round(H * K), show: false, frame: false, useContentSize: true,
    webPreferences: { offscreen: true, webSecurity: false, backgroundThrottling: false, zoomFactor: K }
  });
  win.webContents.setFrameRate(FPS);

  let latest = null;      // 最新一格畫面（BGRA）
  let size = null;
  let ff = null;
  let started = 0;
  let written = 0;
  let timer = null;

  win.webContents.on('paint', (_e, _dirty, image) => {
    latest = image.getBitmap();
    if (!size) size = image.getSize();
  });

  function startRecording() {
    if (ff || !latest) return;
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    ff = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${size.width}x${size.height}`, '-r', String(FPS), '-i', '-',
      '-i', MUSIC,
      '-vf', `scale=${W}:${H}:flags=lanczos`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-af', 'afade=t=out:st=58:d=4',
      '-shortest', '-movflags', '+faststart', OUT
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    ff.on('close', (code) => { console.log('ffmpeg 結束', code, '共', written, '格'); app.exit(code || 0); });
    started = Date.now();
    // 依實際經過的時間補足格數，維持固定每秒 30 格
    timer = setInterval(() => {
      const want = Math.floor((Date.now() - started) / 1000 * FPS);
      while (written < want && latest) { ff.stdin.write(latest); written += 1; }
    }, 1000 / FPS / 2);
    console.log('開始錄製', size);
  }

  function stopRecording() {
    if (!ff) return;
    clearInterval(timer);
    ff.stdin.end();
  }

  win.webContents.on('page-title-updated', (_e, title) => {
    if (title === 'GO') startRecording();
    if (title === 'END') stopRecording();
  });
  win.loadFile(path.join(__dirname, 'stage.html'));
  // 保險：最多錄 100 秒
  setTimeout(() => { console.error('逾時，強制結束'); stopRecording(); }, 100000);
});
