// 逐格算圖的驅動：每格 主行程時鐘 +dt → 各頁面時鐘 +dt → 等畫好 → capturePage → 拼成一格 → ffmpeg
const VC = require('./vc-main.js');
const { BrowserWindow, screen, powerMonitor } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const R = VC.R;
const sleep = (ms) => new Promise((r) => R.setTimeout(r, ms));
const OUT = process.env.OUT;
const SCALE = Number(process.env.SCALE) || 1;             // 預覽：輸出解析度倍率（同時乘到 deviceScaleFactor）
const OW = Math.round(1920 * SCALE / 2) * 2, OH = Math.round(1080 * SCALE / 2) * 2;
const DUMP = process.env.DUMP_PNG;                        // 測試用：每格另存 PNG
const BG = require('../bg.js');
const { Menu } = require('electron');
// 右鍵選單（原生選單，截圖看不到）：腳本指定要點的項目，等同使用者點下去
Menu.prototype.popup = function () {
  const want = global.__menuPick; global.__menuPick = null; if (!want) return;
  const find = (m) => { for (const it of m.items) { if (it.label === want) return it; if (it.submenu) { const r = find(it.submenu); if (r) return r; } } return null; };
  const it = find(this); if (it && it.click) it.click(); else console.log('[drive] menu item not found', want);
};
require('../mock-stock.js');

module.exports = async function drive(shot) {
  const log = (...a) => console.log('[drive]', ...a);
  const dsf = screen.getPrimaryDisplay().scaleFactor;
  // ---- 等程式起來 ----------------------------------------------------------------
  let stageWin = null;
  for (let i = 0; i < 200 && !stageWin; i++) { stageWin = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('stage.html')); if (!stageWin) await sleep(50); }
  if (!stageWin) throw new Error('stage not found');
  const stage = stageWin.webContents;
  for (let i = 0; i < 200; i++) { if (!stage.isLoading() && await stage.executeJavaScript('!!(window.__stage && window.__vc)').catch(() => false)) break; await sleep(50); }
  stageWin.setAlwaysOnTop(false);
  // 離開偵測、游標：改成腳本控制（程式自己的輪詢照常讀這兩個值）
  global.__idle = 0; powerMonitor.getSystemIdleTime = () => global.__idle;
  global.__cur = { x: -5000, y: -5000 }; screen.getCursorScreenPoint = () => ({ x: Math.round(global.__cur.x), y: Math.round(global.__cur.y) });
  const W = await stage.executeJavaScript('innerWidth'), H = await stage.executeJavaScript('innerHeight');
  log('stage', W, H, 'dsf', dsf, 'out', OW, OH);
  await stage.executeJavaScript(BG.inject(shot.bg || {}));
  const v2 = global.v2;

  // ---- 狀態 ----------------------------------------------------------------------
  let t = 0, rec = false, speed = 1, frames = 0, ff = null, panelWin = null;
  const pages = () => [stage, ...(panelWin && !panelWin.isDestroyed() ? [panelWin.webContents] : [])];
  const A = {
    W, H, dsf, v2, stage, VC, log, sleep,
    get t() { return t; }, get panel() { return panelWin && panelWin.webContents; }, get panelWin() { return panelWin; },
    views: [{ src: 'stage', rect: [0, 0, W, H], dst: [0, 0, 1920, 1080] }],
    fill: [246, 239, 227],
    js: (code, wc = stage) => wc.executeJavaScript(code),
    send: (ch, p) => stage.send(ch, p),
    speed(s) { speed = s; },
    cursor(x, y) { global.__cur = { x, y }; A.curShow = x > -100; },
    curShow: false, curKind: 'arrow'
  };
  A.GY = await stage.executeJavaScript('innerHeight');
  // 舞台上的假游標（代表使用者的滑鼠）
  async function drawCursor() {
    const c = global.__cur;
    await stage.executeJavaScript(`(function(){let c=document.getElementById('adcur');if(!c){c=document.createElement('div');c.id='adcur';c.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;width:0;height:0;left:0;top:0';document.body.appendChild(c);}
      const k=${JSON.stringify(A.curKind)};if(c.dataset.k!==k){c.dataset.k=k;c.innerHTML=k==='hand'?'<svg width="30" height="32" viewBox="0 0 30 32" style="position:absolute;left:-12px;top:-6px"><path d="M9 14V5.5a2.2 2.2 0 0 1 4.4 0V12l.2-2.3a2.2 2.2 0 0 1 4.3.2V12a2.2 2.2 0 0 1 4.3 0v1.4a2.2 2.2 0 0 1 4.3.3V21c0 5-3.5 9-8.6 9h-2.3c-3 0-5.2-1.4-6.8-3.8L4 19.6a2.1 2.1 0 0 1 3.4-2.4L9 19z" fill="#fff" stroke="#3d3326" stroke-width="1.6" stroke-linejoin="round"/></svg>':'<svg width="22" height="30" viewBox="-2 -2 20 30"><path d="M0 0 L0 22 L5.5 17 L9.5 26 L13 24.4 L9 15.6 L16 15.6 Z" fill="#fff" stroke="#3d3326" stroke-width="1.6" stroke-linejoin="round"/></svg>';}
      c.style.transform='translate(${c.x}px,${c.y}px)';c.style.display=${A.curShow ? "''" : "'none'"};})()`);
  }
  // ---- 截圖、拼格 ---------------------------------------------------------------------
  const frameBuf = Buffer.alloc(OW * OH * 4);
  function fillBg() { const [r, g, b] = A.fill; for (let i = 0; i < frameBuf.length; i += 4) { frameBuf[i] = b; frameBuf[i + 1] = g; frameBuf[i + 2] = r; frameBuf[i + 3] = 255; } }
  function blit(img, dx, dy) {
    const { width: w, height: h } = img.getSize(), bm = img.toBitmap();
    for (let y = 0; y < h; y++) {
      const ty = dy + y; if (ty < 0 || ty >= OH) continue;
      const x0 = Math.max(0, -dx), x1 = Math.min(w, OW - dx); if (x1 <= x0) continue;
      bm.copy(frameBuf, (ty * OW + dx + x0) * 4, (y * w + x0) * 4, (y * w + x1) * 4);
    }
  }
  const val = (v) => (typeof v === 'function' ? v(t) : v);
  async function capture() {
    const views = val(A.views);
    if (views.length !== 1 || views[0].dst[2] !== 1920) fillBg();
    for (const v of views) {
      const wc = v.src === 'panel' ? panelWin.webContents : stage;
      let [x, y, w, h] = val(v.rect);
      const d = val(v.dst).map((n) => Math.round(n * SCALE));
      const r = { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
      let img = await wc.capturePage(r);
      const s = img.getSize();
      if (s.width !== d[2] || s.height !== d[3]) {
        if (s.width < d[2] - 2 || s.height < d[3] - 2) A.upscaleWarn = (A.upscaleWarn || 0) + 1;     // 不應發生：只允許縮小
        img = img.resize({ width: d[2], height: d[3], quality: 'best' });
      }
      blit(img, d[0], d[1]);
    }
    if (DUMP) fs.writeFileSync(path.join(DUMP, String(frames).padStart(5, '0') + '.png'), require('electron').nativeImage.createFromBitmap(frameBuf, { width: OW, height: OH }).toPNG());
    if (!ff.stdin.write(frameBuf)) await new Promise((r) => ff.stdin.once('drain', r));
    frames++;
  }
  // ---- 記錄擊球時間（給音效對齊）：互動劇本裡每一次擊球的時間 -------------------------
  A.marks = [];
  const mark = (kind, tt, extra) => { A.marks.push({ kind, t: +tt.toFixed(3), ...extra }); if (kind !== 'hit' && kind !== 'bounce') log('mark', kind, tt.toFixed(2), 'frames', frames, 'vdate', new Date(VC.dateNow()).toISOString()); };
  A.mark = (kind, extra) => mark(kind, t, extra);
  async function probe() {
    const r = await stage.executeJavaScript(`(function(){const S=window.__stage.S,out=[];for(const d of (S.duets||[])){if(d.sc&&d.sc.info&&d.sc.info.hits&&!d.__hl){d.__hl=1;out.push({type:d.type,p0:d.p0,hits:d.sc.info.hits.map(h=>[h.T,h.kind])});}}
      const balls=[];for(const b of (S.balls||[])){balls.push({id:b.__id||(b.__id='b'+(window.__bid=(window.__bid||0)+1)),vy:b.vy,y:b.y,x:b.x,sc:b.scored});}return {vt:performance.now(),out,balls};})()`).catch(() => null);
    if (!r) return;
    for (const d of r.out) for (const [T, kind] of d.hits) mark('hit', t + ((d.p0 + T * 1000) - r.vt) / 1000 / speed, { type: d.type, hk: kind });
    // 球（籃球、排球掉地）反彈：垂直速度由下往上翻轉
    A._bv = A._bv || {};
    for (const b of r.balls) { const pv = A._bv[b.id]; if (pv != null && pv > 60 && b.vy < -20) mark('bounce', t, { x: b.x }); A._bv[b.id] = b.vy; if (b.sc && !A._sc) { A._sc = 1; mark('score', t); } }
  }
  // ---- 一格 ------------------------------------------------------------------------------
  async function frame(capture_) {
    const dt = 1000 / 60 * speed;
    VC.advance(dt);
    if (A.onFrame) await A.onFrame(t);
    await drawCursor();
    if (panelWin && !panelWin.isDestroyed()) await panelWin.webContents.executeJavaScript(`(function(){let c=document.getElementById('adcur');if(!c){c=document.createElement('div');c.id='adcur';c.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;left:0;top:0';c.innerHTML='<svg width="22" height="30" viewBox="-2 -2 20 30"><path d="M0 0 L0 22 L5.5 17 L9.5 26 L13 24.4 L9 15.6 L16 15.6 Z" fill="#fff" stroke="#3d3326" stroke-width="1.6" stroke-linejoin="round"/></svg>';document.body.appendChild(c);}
      const p=${JSON.stringify(A.pcur || null)};c.style.display=p?'':'none';if(p)c.style.transform='translate('+p[0]+'px,'+p[1]+'px)';})()`).catch(() => {});
    for (const wc of pages()) await wc.executeJavaScript(`__vc.advance(${dt})`).catch(() => {});
    for (const wc of pages()) await wc.executeJavaScript('__vc.settle()').catch(() => {});
    await probe();
    if (capture_) await capture();
    t += 1 / 60;
  }
  A.frame = () => frame(rec);
  // 算圖直到鏡頭時間 t1（秒，以輸出影片時間計）
  A.until = async (t1) => { while (t < t1 - 1e-6) await frame(rec); };
  A.wait = (s) => A.until(t + s);
  // 不錄的空轉：讓程式照虛擬時間跑一段（例如等球停、快轉到提醒前）；每格 step 毫秒
  A.idle = async (ms, step = 1000 / 60) => {
    const was = rec; rec = false;
    for (let done = 0; done < ms; done += step) {
      VC.advance(step);
      for (const wc of pages()) await wc.executeJavaScript(`__vc.advance(${step})`).catch(() => {});
      for (const wc of pages()) await wc.executeJavaScript('__vc.settle(800)').catch(() => {});
    }
    rec = was;
  };
  A.start = () => {
    rec = true; t = 0;
    ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${OW}x${OH}`, '-framerate', '60', '-i', '-',
      '-c:v', 'libx264', '-preset', process.env.X264_PRESET || 'veryfast', '-crf', process.env.CRF || '12', '-pix_fmt', 'yuv420p', '-r', '60', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
  };
  // ---- 輸入：舞台滑鼠、面板打字 --------------------------------------------------------
  A.mouse = (type, x, y, extra = {}) => stage.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra });
  A.openPanel = async (qid, bounds, zoom = 1) => {
    v2.showPanel(qid || null);
    for (let i = 0; i < 200 && !panelWin; i++) { panelWin = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('panel.html')); if (!panelWin) await sleep(30); }
    const pw = panelWin.webContents;
    // 面板載入中：讓時鐘照真實時間跑到載入完
    for (let i = 0; i < 300; i++) { if (!pw.isLoading() && await pw.executeJavaScript('!!(window.__vc && document.getElementById("addInput"))').catch(() => false)) break; await sleep(30); }
    await pw.executeJavaScript(`__vc.setDate(${Math.floor(VC.dateNow())}); __vc.manual();`);
    if (bounds) panelWin.setBounds({ x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3] });
    pw.setZoomFactor(zoom);
    for (let i = 0; i < 20; i++) await A.frameNoT();
    return pw;
  };
  A.frameNoT = async () => { const was = rec; rec = false; await frame(false); rec = was; };
  A.type = async (text, cps = 9) => {
    const pw = panelWin.webContents;
    await pw.executeJavaScript(`document.getElementById('addInput').focus()`);
    for (const ch of text) { pw.insertText(ch); await A.wait(1 / cps); }
  };
  A.key = async (key) => {
    const pw = panelWin.webContents;
    pw.sendInputEvent({ type: 'keyDown', keyCode: key }); if (key === 'Enter') pw.sendInputEvent({ type: 'char', keyCode: '\r' }); pw.sendInputEvent({ type: 'keyUp', keyCode: key });
  };
  A.panelClick = async (sel) => {
    const pw = panelWin.webContents;
    const r = await pw.executeJavaScript(`(function(){const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
    if (!r) { log('panelClick miss', sel); return false; }
    const z = pw.getZoomFactor();
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) pw.sendInputEvent({ type, x: Math.round(r[0] * z), y: Math.round(r[1] * z), button: 'left', clickCount: 1 });
    return true;
  };
  A.actor = (id) => stage.executeJavaScript(`(function(){const a=window.__stage.S.actors.get(${JSON.stringify(id)});return a?{x:a.x,y:a.y,k:a.k,w:a.w,h:a.h,layer:a.layer,th:a.th,job:a.job&&a.job.name}:null})()`);
  A.actors = () => stage.executeJavaScript(`[...window.__stage.S.actors.values()].map(a=>({id:a.id,x:a.x,y:a.y,k:a.k,w:a.w,h:a.h,layer:a.layer,job:a.job&&a.job.name}))`);
  // 擺位：只在開錄前用（等同使用者把牠們拖到家的位置）
  A.place = (spots) => stage.executeJavaScript(`(function(sp){const S=window.__stage.S;for(const [id,x,th] of sp){const a=S.actors.get(id);if(!a)continue;a.x=a.home=x;a.y=innerHeight-6;if(th!=null)a.th=th;a.place();if(!a.job)a.showRest();}S.reportRects();})(${JSON.stringify(spots)})`);
  // 暫停自主行為（散步、小動作）到某個時間；用於開錄前讓牠們站好
  A.hold = (ids, ms = 1e9) => stage.executeJavaScript(`(function(ids,ms){for(const a of window.__stage.S.actors.values()){if(ids&&!ids.includes(a.id))continue;a.nextAt=performance.now()+ms;}})(${JSON.stringify(ids || null)},${ms})`);
  A.release = (ids) => A.hold(ids, 0);
  A.play = (qid, action) => stage.send('q:play', { qid, action });
  A.social = (type, a, b, pairId = 'ad' + Math.random().toString(36).slice(2, 7)) => { stage.send('social:start', { pairId, a, b, type, initiator: a }); return pairId; };

  // 鏡頭：中心 x、寬度、底邊 y（邏輯座標）→ 16:9 的框
  A.cam = (cx, w, bottom = H + 10, ar = 16 / 9) => { const h = w / ar; let x = cx - w / 2, y = bottom - h; x = Math.max(0, Math.min(W - w, x)); y = Math.max(0, Math.min(H - h, y)); return [x, y, w, h]; };
  A.ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  A.lerp = (a, b, u) => a + (b - a) * u;
  // 右鍵某隻 → 點選單上的某一項（例如「今天股市怎麼了？」）
  A.context = async (qid, label) => {
    const a = await A.actor(qid); global.__menuPick = label;
    const x = a.x, y = a.y - a.h * .45;
    stage.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'right', clickCount: 1 });
    stage.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'right', clickCount: 1 });
    await A.frame();
    if (global.__menuPick) { await stage.executeJavaScript(`window.__stage.S.actors.get(${JSON.stringify(qid)}).el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:${x},clientY:${y}}))`); }
  };
  // 點一下某隻（摸頭）：游標移過去、按下、放開
  A.clickActor = async (qid, dy = .7) => {
    const a = await A.actor(qid), x = a.x, y = a.y - a.h * dy;
    A.mouse('mouseMove', x, y); A.mouse('mouseDown', x, y); await A.frame(); A.mouse('mouseUp', x, y);
  };
  // 面板 HTML5 拖放（用 DevTools 協定，和真的拖曳一樣走 dragstart／dragover／drop）
  A.dragPanel = async (fromSel, toSel, frames = 40) => {
    const pw = panelWin.webContents, dbg = pw.debugger, z = pw.getZoomFactor();
    const pos = (sel) => pw.executeJavaScript(`(function(){const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
    const p0 = await pos(fromSel), p1 = await pos(toSel);
    if (!p0 || !p1) { log('drag miss', fromSel, toSel, p0, p1); return false; }
    const P = (p) => ({ x: p[0] * z, y: p[1] * z });
    if (!dbg.isAttached()) dbg.attach('1.3');
    let data = null; dbg.on('message', (e, m, params) => { if (m === 'Input.dragIntercepted') data = params.data; });
    await dbg.sendCommand('Input.setInterceptDrags', { enabled: true });
    const a = P(p0), b = P(p1);
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...a });
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...a, button: 'left', buttons: 1, clickCount: 1 });
    A.pcur = [p0[0], p0[1]]; await A.frame();
    for (let i = 1; i <= frames; i++) {
      const u = A.ease(i / frames), c = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
      A.pcur = [c.x / z, c.y / z];
      if (!data) await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...c, button: 'left', buttons: 1 });
      else await dbg.sendCommand('Input.dispatchDragEvent', { type: i === 1 ? 'dragEnter' : 'dragOver', ...c, data });
      await A.frame();
    }
    if (data) await dbg.sendCommand('Input.dispatchDragEvent', { type: 'drop', ...b, data });
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...b, button: 'left', buttons: 0, clickCount: 1 });
    await dbg.sendCommand('Input.setInterceptDrags', { enabled: false });
    log('drag data', !!data);
    return !!data;
  };
  // 快轉主行程＋頁面（不算圖），用來跳過等待的時間；step 大一點比較快
  A.skip = (ms, step = 250) => A.idle(ms, step);
  // 只快轉主行程（遊戲時鐘這種很長的等待）；頁面只前進一點點，之後再一起逐格
  A.skipMain = async (ms) => { VC.jump(ms, 1000); await A.idle(300, 100); };
  // 主行程某個計時器（例如遊戲時鐘，每 30 秒）下一次觸發的時間
  A.timerDue = (re, ms) => { const t = VC.timers().find((x) => x.ms === ms && re.test(String(x.fn))); return t ? t.due : null; };

  // ---- 開始：切成手動時鐘 ---------------------------------------------------------------
  // 讓舞台把名單畫好（真實時間）再凍結
  await sleep(600);
  VC.manual();
  await stage.executeJavaScript(`__vc.setDate(${Math.floor(VC.dateNow())}); __vc.manual();`);
  for (let i = 0; i < 30; i++) await frame(false);
  const t0 = Date.now ? process.hrtime.bigint() : 0;
  await shot.run(A);
  if (ff) { ff.stdin.end(); await new Promise((r) => ff.on('exit', r)); }
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  log('done frames', frames, 'secs', secs.toFixed(1), 'fps', (frames / secs).toFixed(2), 'upscaleWarn', A.upscaleWarn || 0);
  fs.writeFileSync(OUT + '.json', JSON.stringify({ frames, marks: A.marks || [], secs }));
};
