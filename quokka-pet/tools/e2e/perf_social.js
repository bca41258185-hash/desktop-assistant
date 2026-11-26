// 效能：4 隻待機（含 CSS 呼吸、眨眼）、兩隻互動中、一起打球、響鈴
const { _electron } = require('playwright');
const fs = require('fs');
const S = __dirname, R = (process.env.QUOKKA_DIR || require('path').resolve(__dirname, '../..')), wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const cfg = S + '/cfg-perfs-' + Date.now(); fs.mkdirSync(cfg);
  const app = await _electron.launch({ executablePath: R + '/node_modules/electron/dist/electron', args: [R, '--no-sandbox'], cwd: R, env: { ...process.env, XDG_CONFIG_HOME: cfg, QUOKKA_STAGE: '1', QUOKKA_DEMO: '4' } });
  await wait(8000);
  await app.evaluate(({ powerMonitor }) => { powerMonitor.getSystemIdleTime = () => 0; });   // 測試環境沒有人動滑鼠：不要被判定成「使用者離開」
  let stage; for (const w of app.windows()) if ((await w.url()).includes('stage.html')) stage = w;
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.getURL().includes('stage.html')) w.close(); });
  await wait(2000);
  await app.evaluate(({ ipcMain, screen }) => { global.__cur = { x: -5000, y: -5000 }; screen.getCursorScreenPoint = () => global.__cur; ipcMain.on('social:abort', (e, p) => console.log('abort', JSON.stringify(p))); });   // 游標移到很遠（不然會一直看游標、呼吸）
  app.process().stdout.on('data', (d) => { const t = String(d); if (/abort/.test(t)) process.stdout.write('  [main] ' + t); });
  const send0 = (ch, p) => app.evaluate(({ BrowserWindow }, [ch, p]) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('stage.html')) w.webContents.send(ch, p); }, [ch, p]);
  await stage.evaluate(() => { const S = window.__stage.S, orig = S.startSocial; window.__allow = new Set(); S.startSocial = (p) => (window.__allow.has(p.pairId) ? orig(p) : (S.api.socialAbort(p.pairId, p.a, 'user'), null)); });   // 主行程自己排的互動先擋掉，只放行測試送的
  const send = async (ch, p) => { if (ch === 'social:start') await stage.evaluate((id) => window.__allow.add(id), p.pairId); return send0(ch, p); };
  const metrics = async (label, ms) => {
    await app.evaluate(({ app }) => app.getAppMetrics()); await wait(ms);
    const m = await app.evaluate(({ app }) => app.getAppMetrics().map((p) => ({ type: p.type, cpu: p.cpu.percentCPUUsage, mem: p.memory.workingSetSize })));
    console.log(`${label}: CPU ${m.reduce((a, p) => a + p.cpu, 0).toFixed(1)}%（${m.map((p) => p.type + ' ' + p.cpu.toFixed(1)).join('、')}），記憶體 ${(m.reduce((a, p) => a + p.mem, 0) / 1024).toFixed(0)} MB`);
  };
  const quiet = () => stage.evaluate(() => { for (const a of window.__stage.actors.values()) { a.nextAt = performance.now() + 1e9; a.idleAt = performance.now() + 1e9; } });
  const ids = await stage.evaluate(() => { let i = 0; const xs = [330, 620, 960, 1160]; for (const a of window.__stage.actors.values()) { a.x = a.home = xs[i++]; a.place(); } return [...window.__stage.actors.keys()]; });
  await quiet(); await wait(15000);   // 等剛啟動的動作結束、呼吸停下（動完 10 秒後停在靜止格）
  console.log('待機時動畫迴圈在跑嗎：', await stage.evaluate(() => window.__stage.running()));
  await metrics('4 隻全部待機（靜止格＋眨眼換圖；游標不在附近）', 10000);
  // 游標真的移到兩隻之間（主行程輪詢游標 → 看游標、呼吸）；每 0.5 秒動一點，像使用者在旁邊操作
  const near = await stage.evaluate(() => { const L = [...window.__stage.actors.values()]; return { x: (L[0].x + L[1].x) / 2 + window.screenX, y: L[0].y - 160 + window.screenY }; });
  let jig = true; (async () => { let i = 0; while (jig) { await app.evaluate((_, p) => { global.__cur = p; }, { x: Math.round(near.x + (i++ % 2) * 6), y: Math.round(near.y) }); await wait(500); } })();
  await wait(1500);
  await metrics('4 隻待機、游標在旁邊（看游標換圖＋400 px 內的兩隻 CSS 呼吸）', 10000);
  jig = false; await wait(600);
  await app.evaluate(() => { global.__cur = { x: -5000, y: -5000 }; });
  await stage.evaluate(() => { for (const a of window.__stage.actors.values()) a.breathe(1); }); await wait(3000);
  stage.on('console', (m) => console.log('  [stage]', m.text().slice(0, 300)));
  const idleAll = async () => { for (let i = 0; i < 200; i++) { if (await stage.evaluate(() => [...window.__stage.actors.values()].every((a) => !a.job))) return; await wait(100); } console.log('  （還有活動沒結束）', await stage.evaluate(() => [...window.__stage.actors.values()].map((a) => a.job && a.job.name))); };
  const playing = async () => { for (let i = 0; i < 150; i++) { if (await stage.evaluate(() => !!document.querySelector('.duet svg'))) return; await wait(100); } };
  await stage.evaluate(() => { let i = 0; const xs = [330, 620, 960, 1160]; for (const a of window.__stage.actors.values()) { a.x = a.home = xs[i++]; a.place(); } });
  await quiet(); await idleAll();
  await send('social:start', { pairId: 'p1', a: ids[0], b: ids[1], type: 'cuddle', initiator: ids[0] }); await playing();
  await metrics('兩隻互動中（依偎；同一張即時 SVG）', 6000);
  console.log('  實際每秒格數：', await stage.evaluate(async () => { const el = document.querySelector('.duet'); if (!el) return '已結束'; let n = 0, last = el.innerHTML; const t0 = performance.now(); while (performance.now() - t0 < 2000) { await new Promise((r) => requestAnimationFrame(r)); if (el.innerHTML !== last) { n++; last = el.innerHTML; } } return n / 2; }));
  await wait(9000);
  await quiet(); await idleAll();
  await send('social:start', { pairId: 'p2', a: ids[0], b: ids[1], type: 'badminton', initiator: ids[0] }); await playing();
  await metrics('兩隻一起打羽球（兩隻＋球拍＋球）', 6000);
  await wait(9000);
  await metrics('互動剛結束（還在呼吸的 10 秒內）', 6000);
  await wait(8000);
  await metrics('回到待機 10 秒後', 8000);
  await send('q:alert', { qid: ids[2], reminderId: 'r', text: '開會' }); await wait(600);
  await metrics('一隻響鈴（ALERT.ring，每秒 20 格）', 6000);
  await send('presence', { away: true }); await wait(1500);
  await metrics('使用者離開（asleep）、響鈴未滿 45 秒（照常播動畫）', 6000);
  await stage.evaluate((id) => { const j = window.__stage.actors.get(id).job; if (j && j.name === 'ring') j.dimAt = performance.now() - 46000; }, ids[2]); await wait(1500);
  console.log('  響鈴靜止格：', await stage.evaluate((id) => { const a = window.__stage.actors.get(id); return { still: !!(a.job && a.job.still), live: a.liveOn, bubble: a.bubble.kind, loop: window.__stage.running() }; }, ids[2]));
  await metrics('使用者離開、響鈴超過 45 秒（靜止格＋氣泡，不重畫）', 8000);
  await send('presence', { away: false }); await wait(2500);
  await send('q:alert-clear', { qid: ids[2], reminderId: 'r' }); await wait(1500);
  console.log('快取', JSON.stringify(await stage.evaluate(() => window.__stage.cache())), '迴圈在跑嗎：', await stage.evaluate(() => window.__stage.running()));
  await app.close();
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
