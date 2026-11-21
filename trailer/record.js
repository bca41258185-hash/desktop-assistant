// 錄製預告片：用 Electron 離屏渲染 stage.html。
// 用法：electron trailer/record.js <輸出.mp4>      （需要系統裝有 ffmpeg）
//
// 分三步：
//   1. 把畫面以每秒 30 格送給 ffmpeg，先錄成沒有聲音的影片；同時記下舞台頁發出的每個音效時間點
//      （舞台頁用 console.log('SFX:名稱')，並用 document.title 的 GO／END 通知開始與結束）。
//   2. 把時間點交給 music.js，合成和畫面對齊的配樂＋音效。
//   3. 把聲音合進影片。

const { app, BrowserWindow } = require('electron');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'site', 'trailer.mp4'));
const W = 1920;
const H = 1080;
const FPS = 30;
const TMP = app.getPath('temp');
const SILENT = path.join(TMP, 'desktop-master-trailer-silent.mp4');
const SOUND = path.join(TMP, 'desktop-master-trailer-sound.wav');
const EVENTS = path.join(TMP, 'desktop-master-trailer-events.json');

app.disableHardwareAcceleration();
app.whenReady().then(() => {
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
  const events = [];

  win.webContents.on('paint', (_e, _dirty, image) => {
    latest = image.getBitmap();
    if (!size) size = image.getSize();
  });
  win.webContents.on('console-message', (_e, _level, message) => {
    if (!started || !String(message).startsWith('SFX:')) return;
    events.push({ t: (Date.now() - started) / 1000, type: String(message).slice(4) });
  });

  function finish() {
    const seconds = written / FPS;
    fs.writeFileSync(EVENTS, JSON.stringify(events));
    console.log('畫面錄完：', written, '格，', seconds.toFixed(1), '秒，音效時間點', events.length, '個');
    const m = spawnSync(process.execPath, [path.join(__dirname, 'music.js'), SOUND, String(seconds), EVENTS],
      { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }), encoding: 'utf8' });
    console.log((m.stdout || '').trim());
    if (m.status !== 0) { console.error('聲音合成失敗', m.stderr); app.exit(1); return; }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const mux = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', SILENT, '-i', SOUND,
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
    console.log('完成：', OUT);
    app.exit(mux.status || 0);
  }

  function startRecording() {
    if (ff || !latest) return;
    ff = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${size.width}x${size.height}`, '-r', String(FPS), '-i', '-',
      '-vf', `scale=${W}:${H}:flags=lanczos`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', SILENT
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    ff.on('close', (code) => { if (code) { console.error('ffmpeg 失敗', code); app.exit(code); } else finish(); });
    started = Date.now();
    // 依實際經過的時間補足格數，維持固定每秒 30 格
    timer = setInterval(() => {
      const want = Math.floor((Date.now() - started) / 1000 * FPS);
      while (written < want && latest) { ff.stdin.write(latest); written += 1; }
    }, 1000 / FPS / 2);
    console.log('開始錄製', size);
  }

  function stopRecording() {
    if (!ff || !timer) return;
    clearInterval(timer);
    timer = null;
    ff.stdin.end();
  }

  win.webContents.on('page-title-updated', (_e, title) => {
    if (title === 'GO') startRecording();
    if (title === 'END') stopRecording();
  });
  win.loadFile(path.join(__dirname, 'stage.html'));
  // 保險：最多錄 110 秒
  setTimeout(() => { console.error('逾時，強制結束'); stopRecording(); }, 110000);
});
