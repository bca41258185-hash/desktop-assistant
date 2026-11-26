// 舞台 Actor 狀態機整合測試：從主行程直接送事件給舞台，讀舞台狀態確認
const { _electron } = require('playwright');
const fs = require('fs');
const S = __dirname, R = process.argv[2] || (process.env.QUOKKA_DIR || require('path').resolve(__dirname, '../..')), MODE = process.argv[3] || 'test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✘ ') + msg); if (!cond) fails++; };
const { execSync } = require('child_process');
const cleanup = () => { try { execSync("pkill -f 'e2e-tag=actor' || true", { stdio: 'ignore' }); } catch (e) { /* 沒有殘留 */ } };
cleanup();                                                          // 開頭：清掉上次跑到一半留下的 electron 行程（會搶 CPU、讓計時不穩）
(async () => {
  const cfg = S + '/cfg-actor-' + Date.now(); fs.mkdirSync(cfg);
  const app = await _electron.launch({ executablePath: R + '/node_modules/electron/dist/electron', args: [R, '--no-sandbox', '--e2e-tag=actor'], cwd: R,
    env: { ...process.env, XDG_CONFIG_HOME: cfg, QUOKKA_STAGE: '1', QUOKKA_DEMO: process.env.N || '3' } });
  // 主行程端：攔截舞台送出的訊息
  await app.evaluate(({ ipcMain }) => {
    global.__got = [];
    for (const ch of ['q:rest', 'q:state', 'q:drop', 'q:dblclick', 'q:context', 'alert:ack', 'alert:snooze', 'social:done', 'social:abort', 'q:pos', 'q:pass', 'stage:save-pos']) ipcMain.on(ch, (e, p) => global.__got.push({ ch, p, t: Date.now() }));
  });
  let stage;
  for (let i = 0; i < 40 && !stage; i++) { for (const w of app.windows()) if ((await w.url()).includes('stage.html')) stage = w; if (!stage) await wait(250); }
  const errs = []; stage.on('pageerror', (e) => errs.push(e.message)); stage.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /出錯/.test(m.text()))) errs.push(m.text()); });   // 活動出錯被保護起來的警告也算失敗
  await wait(4000);
  const send0 = (ch, p) => app.evaluate(({ BrowserWindow }, [ch, p]) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('stage.html')) w.webContents.send(ch, p); }, [ch, p]);
  await stage.evaluate(() => { const S = window.__stage.S, orig = S.startSocial; window.__allow = new Set(); S.startSocial = (p) => (window.__allow.has(p.pairId) ? orig(p) : (S.api.socialAbort(p.pairId, p.a, 'user'), null)); });   // 主行程自己排的互動先擋掉，只放行測試送的
  const send = async (ch, p) => { if (ch === 'social:start') await stage.evaluate((id) => window.__allow.add(id), p.pairId); return send0(ch, p); };
  const got = (ch) => app.evaluate((_, ch) => global.__got.filter((g) => g.ch === ch), ch);
  const st = () => stage.evaluate(() => [...window.__stage.actors.values()].map((a) => ({ id: a.id, name: a.name, layer: a.layer, state: a.state, mode: a.mode, x: Math.round(a.x), y: Math.round(a.y), q: a.queue.length, alerts: a.alerts.length, bubble: a.bubble.kind, text: a.bubble.textEl.textContent, live: a.liveOn, ball: a.ball ? { x: Math.round(a.ball.x), stopped: a.ball.stopped, picked: a.ball.picked } : null })));
  const ids = (await st()).map((a) => a.id);
  const [A, B, C] = ids;
  const one = async (id) => (await st()).find((a) => a.id === id);
  // 全部先不散步，免得干擾
  await stage.evaluate(() => { for (const a of window.__stage.actors.values()) { a.nextAt = performance.now() + 1e9; a.idleAt = performance.now() + 1e9; } });   // 不散步、不做待機小動作，免得干擾
  await app.evaluate(({ powerMonitor }) => { powerMonitor.getSystemIdleTime = () => 0; });
  // 真實游標固定停在螢幕外：Xvfb 的游標預設在螢幕正中央，螢幕高度不同（1280x720 / xvfb-run 預設 1280x1024）時會剛好落在庫卡走的路上，
  // 讓散步、撿球、社交走位「被游標擋住」→ 結果隨螢幕大小改變。游標相關行為由第 8 段自己送座標測。
  await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = () => ({ x: -10000, y: -10000 }); });
  module.exports = { app, stage, send, got, st, one, ids, wait, ok, errs };
  const T = require(process.env.STEPS || (S + '/e2e_actor_steps.js'));
  await T({ app, stage, send, got, st, one, ids, A, B, C, wait, ok, errs, MODE });
  console.log('pageerror / console error:', errs.length ? errs : '無');
  if (errs.length) fails++;
  console.log(fails ? `失敗 ${fails} 項` : '全部通過');
  await app.close().catch(() => {});
  cleanup();                                                        // 結尾：確定沒有留下行程
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.stack); cleanup(); process.exit(1); });
