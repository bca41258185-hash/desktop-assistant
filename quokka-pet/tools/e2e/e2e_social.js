// 互動整合測試：從主行程直接送 social:start 各種 type、被打斷、小袋鼠與懷孕、避讓
// 用法：node e2e_social.js [要跑的段落，逗號分隔：types,abort,family,avoid,life]
const { _electron } = require('playwright');
const fs = require('fs');
const S = __dirname, R = (process.env.QUOKKA_DIR || require('path').resolve(__dirname, '../..'));
const ONLY = (process.argv[2] || 'types,abort,family,avoid,life,robust').split(',');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✘ ') + msg); if (!cond) fails++; };
const { execSync } = require('child_process');
const cleanup = () => { try { execSync("pkill -f 'e2e-tag=social' || true", { stdio: 'ignore' }); } catch (e) { /* 沒有殘留 */ } };
cleanup();                                                          // 開頭：清掉上次跑到一半留下的 electron 行程（會搶 CPU、讓計時不穩）
(async () => {
  const cfg = S + '/cfg-social-' + Date.now(); fs.mkdirSync(cfg);
  const app = await _electron.launch({ executablePath: R + '/node_modules/electron/dist/electron', args: [R, '--no-sandbox', '--e2e-tag=social'], cwd: R,
    env: { ...process.env, XDG_CONFIG_HOME: cfg, QUOKKA_STAGE: '1', QUOKKA_DEMO: '4' } });
  await app.evaluate(({ ipcMain }) => {
    global.__got = [];
    for (const ch of ['q:rest', 'q:state', 'q:drop', 'q:dblclick', 'social:done', 'social:abort']) ipcMain.on(ch, (e, p) => global.__got.push({ ch, p, t: Date.now() }));
  });
  await app.evaluate(({ powerMonitor }) => { powerMonitor.getSystemIdleTime = () => 0; });   // 測試環境沒有人動滑鼠：不要被判定成「使用者離開」
  await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = () => ({ x: -10000, y: -10000 }); });   // 真實游標停在螢幕外：Xvfb 游標預設在正中央，1024 高的螢幕上剛好擋在庫卡走的路上（游標行為由測試自己送座標測）
  let stage;
  for (let i = 0; i < 40 && !stage; i++) { for (const w of app.windows()) if ((await w.url()).includes('stage.html')) stage = w; if (!stage) await wait(250); }
  const errs = []; stage.on('pageerror', (e) => errs.push(e.message)); stage.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /出錯/.test(m.text()))) errs.push(m.text() + ' @' + ((m.location() || {}).url || '').slice(0, 60) + ' t=' + Date.now()); });   // 活動出錯被保護起來的警告也算失敗
  await wait(4000);
  // 主行程的社交排程、遊戲時鐘不要插手（測試自己送事件）
  await app.evaluate(() => { try { global.v2 && global.v2.stage && 0; } catch (e) {} });
  const send0 = (ch, p) => app.evaluate(({ BrowserWindow }, [ch, p]) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('stage.html')) w.webContents.send(ch, p); }, [ch, p]);
  await stage.evaluate(() => { const S = window.__stage.S, orig = S.startSocial; window.__allow = new Set(); S.startSocial = (p) => (window.__allow.has(p.pairId) ? orig(p) : (S.api.socialAbort(p.pairId, p.a, 'user'), null)); });   // 主行程自己排的互動先擋掉，只放行測試送的
  const send = async (ch, p) => { if (ch === 'social:start') await stage.evaluate((id) => window.__allow.add(id), p.pairId); return send0(ch, p); };
  const got = (ch) => app.evaluate((_, ch) => global.__got.filter((g) => g.ch === ch), ch);
  const st = () => stage.evaluate(() => [...window.__stage.actors.values()].map((a) => ({ id: a.id, layer: a.layer, state: a.state, x: Math.round(a.x), y: Math.round(a.y), k: a.k, live: a.liveOn, duet: !!a.duetOn, depth: a.depth, z: a.zBoost, inPouch: !!a.inPouch, follow: !!a.isFollow, th: a.th, phase: a.job && a.job.phase, ball: a.ball ? { x: Math.round(a.ball.x), stopped: a.ball.stopped } : null })));
  const one = async (id) => (await st()).find((a) => a.id === id);
  const until = async (fn, ms = 20000, step = 100) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(step); } return null; };
  const quiet = () => stage.evaluate(() => { for (const a of window.__stage.actors.values()) { a.nextAt = performance.now() + 1e9; a.idleAt = performance.now() + 1e9; } });
  const placeAll = (xs) => stage.evaluate((xs) => { let i = 0; for (const a of window.__stage.actors.values()) { if (a.isFollow) continue; a.x = a.home = xs[i++]; a.y = 700; a.th = -15; a.depth = 0; a.place(); if (!a.job) a.showRest(); } window.__stage.S.reportRects(); }, xs);
  const head = (id) => stage.evaluate((id) => { const a = window.__stage.actors.get(id); return { x: a.x, y: a.y - 120 * a.k }; }, id);
  // 禮貌距離監看（第 1 輪審查 #1）：
  //   (1) 任何走位、讓位、跳開、撿球、互動結束時，牠和每一隻非伴侶（不是自己的家人）腳底都至少相距 90 px
  //   (2) 走路／撿球／讓路／互動走位途中，非伴侶不會在同一條地面線上靠到 60 px 內（穿過身體；退到後面那一道的不算）
  //   四肢著地往前走時口鼻伸得比較前面：面向對方爬行時至少相距 130 px（口鼻不會頂進對方身體）
  await stage.evaluate(() => {
    const S = window.__stage.S; window.__polite = []; window.__pass = [];
    const ok2 = (a, q) => q !== a && !q.inPouch && !q.isFollow && !a.isFollow && Math.abs(q.y - a.y) <= 40 && !S.family.close(a, q) && !q.dragging && !a.dragging;
    const fin = S.Actor.prototype.finish;
    S.Actor.prototype.finish = function (job, o) {
      const r = fin.call(this, job, o);
      try {
        if (job && ['walk', 'stepAway', 'yield', 'yieldBack', 'growMove', 'fetch', 'social', 'pouch', 'settle'].includes(job.name) && this.mode === 'awake') for (const q of S.actors.values()) {
          if (!ok2(this, q) || ((job.name === 'social' || job.name === 'settle') && job.other === q)) continue;     // 互動的兩隻之間的距離由劇本決定（碰掌、依偎…）
          const d = Math.abs(q.x - this.x); if (d < 90) window.__polite.push({ job: job.name, a: this.name, b: q.name, d: Math.round(d), qjob: q.job && q.job.name });
        }
      } catch (e) { /* 只是監看 */ }
      return r;
    };
    setInterval(() => {
      const L = [...S.actors.values()];
      for (const a of L) {
        const j = a.job; if (!j || !['walk', 'fetch', 'yield', 'growMove'].includes(j.name) && !(j.name === 'social' && j.phase === 'approach')) continue;
        for (const q of L) {
          if (!ok2(a, q) || (j.duet && q.job && q.job.duet === j.duet) || (a.depth || 0) >= 30 || (q.depth || 0) >= 30) continue;
          if (j.name === 'growMove' && (a.attach.mom === q.id || a.attach.dad === q.id)) continue;   // 剛長大（還是小小的）：從爸媽身邊跳開、必要時從爸媽前面那一道繞過去（家人）
          const d = Math.abs(q.x - a.x), crawl = a.shown && a.shown.pose && (a.shown.pose.lean || 0) > 40 && Math.sign(q.x - a.x) === Math.sign(Math.sin((a.th || 0) * Math.PI / 180));
          if (d < 60 || (crawl && j.name === 'walk' && d < 130)) window.__pass.push({ job: j.name, ph: j.phase, a: a.name, b: q.name, qjob: q.job && q.job.name, d: Math.round(d), crawl: !!crawl });
        }
      }
    }, 100);
  });
  const ids = (await st()).map((a) => a.id), [A, B, C, D] = ids;
  await quiet();
  let pn = 0;

  if (ONLY.includes('types')) {
    console.log('1. 各種互動：social:start → 走位 → 同一張即時 SVG 播放 → social:done', Date.now());
    const TYPES = ['wave', 'nose', 'paw', 'leaf', 'chase', 'sunbathe', 'cuddle', 'groom', 'leanNap', 'walkTogether', 'badminton', 'volleyball', 'basketball'];
    for (const type of TYPES) {
      await until(async () => (await st()).every((x) => x.layer === 8), 40000);
      await placeAll([330, 600, 980, 1180]);
      await quiet();
      const pairId = 'p' + (++pn), t0 = Date.now();
      await send('social:start', { pairId, a: A, b: B, type, initiator: A });
      const in5 = await until(async () => { const s = await st(); return s.find((x) => x.id === A).layer === 5 && s.find((x) => x.id === B).layer === 5; }, 2000, 50);
      const playing = await until(async () => stage.evaluate(() => { const d = document.querySelector('.duet svg'); return d ? d.innerHTML.length : 0; }), 22000, 80);
      const dStart = Math.abs((await one(A)).x - (await one(B)).x);
      // 播放中：兩隻各自的圖藏起來、畫在同一張裡；量一下每秒幾格
      const info = await stage.evaluate(async () => { const el = document.querySelector('.duet'); if (!el) return null; let n = 0, last = el.innerHTML; const t0 = performance.now(); while (performance.now() - t0 < 1000) { await new Promise((r) => requestAnimationFrame(r)); if (el.innerHTML !== last) { n++; last = el.innerHTML; } } return { fps: n, hidden: [...document.querySelectorAll('.actor.in-duet')].length, groups: el.querySelectorAll('svg > g').length }; });
      const done = await until(async () => (await got('social:done')).find((g) => g.p.pairId === pairId), 30000, 100);
      const back = await until(async () => { const s = await st(); return s.find((x) => x.id === A).layer !== 5 && s.find((x) => x.id === B).layer !== 5; }, 3000, 50);
      const after = await stage.evaluate(() => ({ duet: !!document.querySelector('.duet'), live: [...window.__stage.actors.values()].filter((a) => a.liveOn && a.layer === 8).length, hid: document.querySelectorAll('.actor.in-duet').length }));
      const dEnd = Math.abs((await one(A)).x - (await one(B)).x);
      const all = in5 && playing && done && done.p.ok && done.p.type === type && back && !after.duet && !after.hid;
      if (!all) console.log('     ', JSON.stringify({ in5: !!in5, playing: !!playing, done, back: !!back, after, ab: (await got('social:abort')).filter((g) => g.p.pairId === pairId) }));
      ok(all, `${type}：L5 → 播放（${info ? info.fps : '?'} 格／秒、${info ? info.groups : '?'} 層）→ social:done（${((Date.now() - t0) / 1000).toFixed(1)} 秒；開始距離 ${Math.round(dStart)}、結束 ${Math.round(dEnd)} px）`);
      if (info) { if (info.fps > 66) ok(false, `${type} 即時繪製超過每秒 60 格（${info.fps}）`); if (info.hidden !== 2) ok(false, `${type} 播放中兩隻的 PNG 應該藏起來`); }
      if (type === 'nose') ok(dStart > 90 && dStart < 148, `碰鼻站位在禮貌距離（${Math.round(dStart)} px；鼻頭之間留 2–3 單位）`);
      if (type === 'paw') ok(dStart > 88 && dStart < 135, `碰掌：走近到鼻子不相碰的距離（${Math.round(dStart)} px）`);
      if (type === 'cuddle' || type === 'leanNap') ok(dEnd > 50 && dEnd < 90, `${type}：結束時貼在一起（${Math.round(dEnd)} px）`);
      if (type === 'badminton') ok(dStart >= 215 && dStart <= 305, `羽球相隔 220–300 px（${Math.round(dStart)}）`);
      if (type === 'volleyball') ok(dStart >= 165 && dStart <= 225, `排球相隔 160–220 px（${Math.round(dStart)}）`);
      // 一起打球可能留下一顆球給其中一隻去撿
      await until(async () => (await st()).every((x) => x.layer === 8 && !x.ball), 40000, 150);
    }
  }

  if (ONLY.includes('abort')) {
    console.log('2. 被打斷時的收尾（規格 5.4）', Date.now());
    await until(async () => (await st()).every((x) => x.layer === 8), 30000);
    await placeAll([330, 600, 980, 1180]); await quiet();
    // 走位途中 A 響鈴
    await send('social:start', { pairId: 'a1', a: A, b: B, type: 'nose', initiator: A });
    await wait(500);
    await send('q:alert', { qid: A, reminderId: 'r1', text: '開會' });
    let ab = await until(async () => (await got('social:abort')).find((g) => g.p.pairId === 'a1'), 3000);
    ok(ab && ab.p.by === A && ab.p.reason === 'alert', '走位途中 A 響鈴 → social:abort{by:A, reason:alert}');
    ok((await one(A)).layer === 1, 'A 立刻去響鈴（L1）');
    let b = await one(B);
    ok(b.layer === 5 && b.phase === 'outro', 'B 播收尾（看 A 一眼）');
    ok(await until(async () => (await one(B)).layer === 8, 1500, 40), 'B 約 0.8 秒後回待機');
    await send('q:alert-clear', { qid: A, reminderId: 'r1' });
    await until(async () => (await one(A)).layer === 8, 3000);
    // 播放中 B 有工作反應
    await placeAll([330, 600, 980, 1180]);
    await send('social:start', { pairId: 'a2', a: A, b: B, type: 'cuddle', initiator: A });
    await until(async () => stage.evaluate(() => !!document.querySelector('.duet svg')), 15000, 80);
    await wait(2600);
    await send('q:event', { qid: B, kind: 'stock', payload: { symbol: '2330', name: '台積電', pct: 1.2, dir: 'up' }, prio: 2 });
    ab = await until(async () => (await got('social:abort')).find((g) => g.p.pairId === 'a2'), 3000);
    ok(ab && ab.p.by === B && ab.p.reason === 'work', '依偎中 B 有工作反應 → social:abort{by:B, reason:work}');
    ok(!(await stage.evaluate(() => !!document.querySelector('.duet'))), '共用的互動畫面收掉');
    ok((await one(A)).phase === 'outro' && (await one(A)).live, 'A 播「頭一歪醒來」收尾（即時繪製）');
    ok(await until(async () => (await one(A)).layer === 8 && !(await one(A)).live, 1500, 40), 'A 收尾後回待機、換回 PNG');
    await until(async () => (await st()).every((x) => x.layer === 8), 9000);
    // 播放中 A 被拖走
    await placeAll([330, 600, 980, 1180]);
    await send('social:start', { pairId: 'a3', a: A, b: B, type: 'badminton', initiator: A });
    await until(async () => stage.evaluate(() => !!document.querySelector('.duet svg')), 15000, 80);
    await wait(1800);
    const h = await head(A);
    await stage.mouse.move(h.x, h.y); await stage.mouse.down();
    for (let i = 1; i <= 6; i++) { await stage.mouse.move(h.x, h.y - i * 8); await wait(30); }
    ab = await until(async () => (await got('social:abort')).find((g) => g.p.pairId === 'a3'), 3000);
    ok(ab && ab.p.by === A && ab.p.reason === 'drag', '打羽球時 A 被拖走 → social:abort{by:A, reason:drag}');
    ok((await one(B)).phase === 'outro', 'B 抬頭目送');
    await wait(300); await stage.mouse.up();
    ok(await until(async () => (await st()).every((x) => x.layer === 8), 6000), '放下後都回待機');
    // 主行程叫停
    await placeAll([330, 600, 980, 1180]);
    await send('social:start', { pairId: 'a4', a: A, b: B, type: 'wave', initiator: A });
    await until(async () => stage.evaluate(() => !!document.querySelector('.duet svg')), 15000, 80);
    await wait(800);
    const nAb = (await got('social:abort')).length;
    await send('social:abort', { pairId: 'a4', by: A, reason: 'work' });
    await wait(150);
    const s2 = await st();
    ok(s2.find((x) => x.id === A).phase === 'outro' && s2.find((x) => x.id === B).phase === 'outro', '收到主行程的 social:abort：兩隻都播收尾');
    ok(await until(async () => (await st()).every((x) => x.layer === 8), 2000), '收尾後回待機');
    ok((await got('social:abort')).length === nAb && !(await got('social:done')).some((g) => g.p.pairId === 'a4'), '不重複回報');
    // 地面高度不同 → 取消
    await stage.evaluate(([a]) => { const A = window.__stage.actors.get(a); A.y = 600; A.place(); }, [A]);
    await send('social:start', { pairId: 'a5', a: A, b: B, type: 'nose', initiator: A });
    ok(await until(async () => (await got('social:abort')).find((g) => g.p.pairId === 'a5'), 2000), '地面高度差 > 40 px：取消');
  }

  if (ONLY.includes('family')) {
    console.log('3. 懷孕、育兒袋探頭、跟隨、長大', Date.now());
    await until(async () => (await st()).every((x) => x.layer === 8), 30000);
    await placeAll([330, 640, 980, 1180]); await quiet();
    const base = await stage.evaluate(() => [...window.__stage.actors.values()].map((a) => ({ id: a.id, name: a.name, traits: a.traits, pos: { x: a.x, y: a.y }, stage: 'adult', mom: null, dad: null, pregnant: false, hasJoey: null, partner: null })));
    const withQ = (mod) => base.map((q) => ({ ...q, ...(mod[q.id] || {}) }));
    const srcOf = (id) => stage.evaluate((id) => window.__stage.actors.get(id).img.src, id);
    const src0 = await srcOf(B);
    await send('stage:quokkas', withQ({ [A]: { partner: B }, [B]: { partner: A, pregnant: true } }));
    ok(await until(async () => (await one(B)).layer === 8 && (await stage.evaluate((id) => /\|p/.test(window.__stage.actors.get(id).decoKey || ''), B)) && (await srcOf(B)) !== src0, 6000, 60), 'pregnant：媽媽換成有育兒袋口的畫格');
    ok(await stage.evaluate(([a, b]) => window.__stage.actors.get(a).attach.partner === b && window.__stage.actors.get(a).attach.coupled, [A, B]), 'partner 欄位記到附加狀態（coupled）');
    const jt = JSON.parse(JSON.stringify(base[2].traits)); jt.band = '#ffd34d';
    const joey = { id: 'joey1', name: '寶寶', traits: jt, pos: null, stage: 'pouch', mom: B, dad: A, pregnant: false, hasJoey: null, partner: null, growScale: 0.5 };
    const src1 = await srcOf(B);
    await send('stage:quokkas', withQ({ [A]: { partner: B }, [B]: { partner: A, hasJoey: 'joey1' } }).concat([joey]));
    const peek = await until(async () => (await one(B)).layer === 8 && (await srcOf(B)) !== src1 && (await stage.evaluate((id) => /joey1o/.test(window.__stage.actors.get(id).decoKey), B)), 6000, 60);
    ok((await st()).length === 4 && !(await st()).some((x) => x.id === 'joey1'), 'pouch 期：不是獨立 Actor');
    ok(peek, '媽媽的育兒袋口探出小袋鼠的頭');
    await send('presence', { away: true, sleep: true });
    await until(() => stage.evaluate((id) => window.__stage.actors.get(id).mode === 'asleep', B), 3000, 40);
    ok(await stage.evaluate((id) => { const a = window.__stage.actors.get(id); return !a.peekT && !a.joeyHide; }, B), '睡覺時：育兒袋探頭的計時器停掉');
    await send('presence', { away: false });
    ok(await until(() => stage.evaluate((id) => { const a = window.__stage.actors.get(id); return a.mode === 'awake' && !!a.peekT; }, B), 3000, 40), '醒來：探頭計時器重新開始');
    await until(async () => (await st()).every((x) => x.layer === 8), 8000); await quiet();
    // 媽媽被拖：縮回袋裡
    let h = await head(B);
    await stage.mouse.move(h.x, h.y); await stage.mouse.down();
    for (let i = 1; i <= 5; i++) { await stage.mouse.move(h.x, h.y - i * 6); await wait(30); }
    ok(await stage.evaluate((id) => { const a = window.__stage.actors.get(id); window.__stage.S.family.refresh(a); return /joey1i/.test(a.decoKey); }, B), '媽媽被拖：小袋鼠縮回袋裡');
    for (let i = 5; i >= 0; i--) { await stage.mouse.move(h.x, h.y - i * 6); await wait(30); }
    await stage.mouse.up();
    await until(async () => (await one(B)).layer === 8, 5000);
    // 出袋 → 跟隨期
    joey.stage = 'follow';
    await send('stage:quokkas', withQ({ [A]: { partner: B }, [B]: { partner: A, hasJoey: 'joey1' } }).concat([joey]));
    await wait(400);
    let j = await one('joey1'), m = await one(B);
    ok(j && j.follow && j.k < m.k * .75, `follow 期：獨立但縮小的 Actor（大小 ${(j && (j.k / m.k * 100).toFixed(0))}%）`);
    const behind = await until(async () => { const jj = await one('joey1'), mm = await one(B); return jj.layer === 8 && Math.abs(Math.abs(jj.x - mm.x) - 55) < 30; }, 8000);
    if (!behind) console.log('      ', JSON.stringify(await stage.evaluate(([b]) => { const S = window.__stage.S, j = S.actors.get('joey1'), m = S.actors.get(b); return { j: [j.x, j.y, j.layer, j.job && j.job.name, j.inPouch, j.mode, j.k], m: [m.x, m.y, m.layer, m.job && m.job.name, m.faceDir, m.mode], tgt: S.family.target(j, m), others: [...S.actors.values()].map((o) => [o.name, Math.round(o.x), o.job && o.job.name]) }; }, [B])));
    ok(behind, `跳到媽媽後方 40–60 px（${Math.abs((await one('joey1')).x - (await one(B)).x)} px）`);
    await send('q:event', { qid: 'joey1', kind: 'note', payload: { text: 'x' }, prio: 2 });
    await wait(200);
    ok((await one('joey1')).layer === 8, '跟隨期不能交辦事情');
    // 媽媽走：牠就跟
    await until(async () => (await st()).every((x) => x.layer === 8), 8000); await quiet();
    const wr = await stage.evaluate((id) => { const a = window.__stage.actors.get(id); const r = a.requestActivity(7, a.walkJob(a.x - 230, { noPause: true })); window.__stage.kick(); return [r, a.job && a.job.name, window.__stage.S.movingCount()]; }, B);
    if (!wr[0]) console.log('      媽媽散步沒開始：', JSON.stringify(wr), JSON.stringify(await st()));
    let maxGap = 0, followed = false;
    await until(async () => { const jj = await one('joey1'), mm = await one(B); maxGap = Math.max(maxGap, Math.abs(jj.x - mm.x)); if (jj.state === 'follow') followed = true; return mm.layer === 8 && jj.layer === 8; }, 20000, 80);
    j = await one('joey1'); m = await one(B);
        ok(followed && Math.abs(m.x - 410) < 45 && j.x > m.x && j.x - m.x < 95, `媽媽往左走 230 px，小袋鼠跟在後方（最後相距 ${j.x - m.x} px，途中最遠 ${Math.round(maxGap)} px；followed=${followed} 媽媽 x=${m.x}）`);
    // 媽媽響鈴：坐著看，不擋氣泡
    await send('q:alert', { qid: B, reminderId: 'rj', text: '餵奶時間' });
    // 小袋鼠要先挪到不擋的位置（跟隨是一步一步跳的）：輪詢到牠停下且不擋，最多 6 秒
    const ovNow = () => stage.evaluate(([b, jid]) => { const m = window.__stage.actors.get(b), j = window.__stage.actors.get(jid), br = m.bubble.clickRect(), r = j.rect, mr = m.rect; const hit = (p, q) => p && q && p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h; return { bubble: hit(r, br), mom: hit(r, mr), r, mr, br }; }, [B, 'joey1']);
    let ov = await until(async () => { const j = await one('joey1'); if (j.layer !== 8) return null; const o = await ovNow(); return !o.bubble && !o.mom ? o : null; }, 6000, 100);
    if (!ov) { ov = await ovNow(); console.log('      ', JSON.stringify(ov)); }
        ok(!ov.bubble && !ov.mom, '媽媽響鈴：小袋鼠不擋氣泡、不擋媽媽的點擊範圍');
    await send('q:alert-clear', { qid: B, reminderId: 'rj' });
    await until(async () => (await one(B)).layer === 8, 3000);
    // 雙擊小袋鼠
    h = await stage.evaluate((id) => { const a = window.__stage.actors.get(id); return { x: a.x, y: a.y - 50 * a.k }; }, 'joey1');
    await stage.mouse.dblclick(h.x, h.y);
    ok(await until(async () => (await got('q:dblclick')).some((g) => g.p.qid === 'joey1'), 1500), '雙擊小袋鼠送 q:dblclick');
    await wait(500);
    // 拖走媽媽：鑽回育兒袋跟著移動；放下 1.5 秒後再爬出來
    h = await head(B);
    await stage.mouse.move(h.x, h.y); await stage.mouse.down();
    let jumped = false;
    for (let i = 1; i <= 10; i++) { await stage.mouse.move(h.x + i * 20, h.y - i * 4); if ((await one('joey1')).state === 'pouch') jumped = true; await wait(30); }
    await until(async () => { const x = await one('joey1'); if (x.state === 'pouch') jumped = true; return x.inPouch; }, 1500, 20);
    ok(jumped, '拖走媽媽：小袋鼠先跳向袋口（有過渡動作，不是一格就瞬移進去）');
    j = await one('joey1');
    await until(() => stage.evaluate(() => getComputedStyle(window.__stage.actors.get('joey1').el).display === 'none'), 800, 20);
    ok(j.inPouch && await stage.evaluate(([b, jid]) => { const m = window.__stage.actors.get(b), j = window.__stage.actors.get(jid); return m.carried === j && getComputedStyle(j.el).display === 'none' && /cjoey1/.test(m.decoKey); }, [B, 'joey1']), '拖走媽媽：小袋鼠鑽回育兒袋（畫在媽媽身上）');
    for (let i = 10; i >= 6; i--) { await stage.mouse.move(h.x + i * 20, h.y - i * 4 + (10 - i) * 4); await wait(30); }
    await stage.mouse.move(h.x + 120, h.y); await wait(60);
    const tUp = Date.now(); await stage.mouse.up();
    await wait(900);
    ok((await one('joey1')).inPouch, '放下不到 1.5 秒：還在袋裡');
    const out = await until(async () => !(await one('joey1')).inPouch, 4000, 50);
    ok(out && Date.now() - tUp >= 1400, `放下約 1.5 秒後爬出來（${Date.now() - tUp} ms）`);
    const landed = await until(async () => { const x = await one('joey1'); return x.state !== 'pouch' ? x : null; }, 2000, 30);
    ok(landed && Math.abs(landed.y - (await one(B)).y) < 2, `從袋口跳下來，落回地面（y ${landed && landed.y}）`);
    await until(async () => (await st()).every((x) => x.layer === 8), 8000);
    // dadNose
    const nDone = (await got('social:done')).length;
    await send('social:start', { pairId: 'dn', a: A, b: 'joey1', type: 'dadNose', initiator: A, anchor: B });
    const dn = await until(async () => (await got('social:done')).find((g) => g.p.pairId === 'dn'), 30000);
    ok(dn && dn.p.ok, 'dadNose：爸爸走過來碰鼻小袋鼠 → social:done');
    await until(async () => (await st()).every((x) => x.layer === 8), 8000);
    // 長大
    const k0 = (await one('joey1')).k;
    joey.stage = 'juvenile';
    await send('stage:quokkas', withQ({ [A]: { partner: B }, [B]: { partner: A } }).concat([joey]));
    let growMoved = false, growOverlap = [];
    const growAt = await until(async () => { const x = await one('joey1'), mm = await one(B), dd = await one(A); if (x.state === 'growMove') growMoved = true; if (x.state === 'grow' && x.k > k0 * 1.05) for (const o of [mm, dd]) if (Math.abs(o.x - x.x) < 60 * (o.k + x.k) / 2 / .95) growOverlap.push([o.id, Math.round(Math.abs(o.x - x.x))]); return x.state === 'grow' && x.k > k0 * 1.2 ? x : null; }, 12000, 30);   // 先跳到離爸媽和別隻都有禮貌距離的空位（可能要跳好幾步）再長大
    ok(growAt, `變成 juvenile：${growMoved ? '先跳到旁邊的空位，再' : ''}播「長大」小動畫`);
    ok(!growOverlap.length, `長大（變大）的過程中沒有和爸媽身體重疊 ${JSON.stringify(growOverlap.slice(0, 3))}`);
    ok(await until(async () => { const x = await one('joey1'); return x.k > k0 * 1.3 && !x.follow; }, 5000), `長大後變大（${(k0).toFixed(2)} → ${((await one('joey1')).k).toFixed(2)}）、變成獨立的庫卡`);
    const tooClose = () => stage.evaluate(() => { const S = window.__stage.S, L = [...S.actors.values()].filter((a) => !a.inPouch), out = []; for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const a = L[i], b = L[j]; if (Math.abs(a.y - b.y) <= 40 && !S.family.close(a, b) && Math.abs(a.x - b.x) < 60 * (a.k + b.k) / 2 / S.SCALE) out.push([a.name, b.name, Math.round(Math.abs(a.x - b.x))]); } return out; });
    const freeAll = await until(async () => { const s2 = await st(); return s2.every((x) => x.layer === 8) && (await tooClose()).length === 0; }, 12000, 100);
    ok(freeAll, `剛長大的小袋鼠自己走開：全場沒有和爸媽（或別隻）身體重疊（${JSON.stringify(await tooClose())}）`);
    if (!freeAll) console.log('      ', JSON.stringify(await stage.evaluate(() => [...window.__stage.actors.values()].map((a) => [a.name, Math.round(a.x), a.job && a.job.name, a.job && a.job.phase, a.layer]))));
    // 兩側都被擋（和剛長大時一樣呼叫 stepAway）：夾在爸媽中間、外側還各站一隻 → 往空間較大的一側（右邊）越過最外側那隻到 100 px 外，走靠鏡頭那一道（畫在前面）
    await until(async () => (await st()).every((x) => x.layer === 8), 8000);
    await stage.evaluate(([a, b, c, d]) => { const S = window.__stage.S; const set = (id, x) => { const o = S.actors.get(id); o.x = o.home = x; o.y = 700; o.depth = 0; o.th = -15; o.place(); if (!o.job) o.showRest(); o.nextAt = performance.now() + 1e9; o.idleAt = performance.now() + 1e9; }; set(c, 380); set(a, 500); set(b, 570); set('joey1', 535); set(d, 760); S.actors.get('joey1').stepAway(100); window.__stage.kick(); }, [A, B, C, D]);
    let front = false, sq0 = Date.now();
    const sqOut = await until(async () => { const j = await one('joey1'); if (j.state === 'stepAway' && j.z > 0 && j.depth < 0) front = true; return j.layer === 8 && Math.abs(j.x - 535) > 50 ? j : null; }, 12000, 40);
    const dX = (await one(D)).x;
    ok(sqOut && sqOut.x > dX + 95 && front, `夾在爸媽中間、兩側都被擋：${((Date.now() - sq0) / 1000).toFixed(1)} 秒內往空間大的右側越過最外側那隻（x 535 → ${sqOut && sqOut.x}，外側那隻在 ${dX}），途中畫在前面（${front}）`);
    ok((await tooClose()).length === 0, `之後全場沒有身體重疊（${JSON.stringify(await tooClose())}）`);
    // 情侶待機：自己靠過去
    await stage.evaluate(([a, b, c, d]) => { const A = window.__stage.actors.get(a), B = window.__stage.actors.get(b); A.x = 300; B.x = 620; A.place(); B.place(); const J = window.__stage.actors.get('joey1'); J.x = 800; J.place(); for (const [id, x] of [[c, 1000], [d, 1180]]) { const o = window.__stage.actors.get(id); o.x = o.home = x; o.place(); } for (const o of window.__stage.actors.values()) { o.nextAt = performance.now() + 1e9; o.idleAt = performance.now() + 1e9; } A.nextAt = 0; window.__stage.S.cursor = { x: -9999, y: -9999 }; window.__stage.kick(); const r = Math.random; Math.random = () => .3; setTimeout(() => { Math.random = r; }, 2500); }, [A, B, C, D]);
    const ci = await until(async () => { const a = await one(A), b2 = await one(B); return a.layer === 8 && Math.abs(a.x - b2.x) < 110; }, 30000);
    ok(ci, `情侶待機：自己走過去站在一起（${Math.abs((await one(A)).x - (await one(B)).x)} px）`);
    await wait(2600);
    ok((await tooClose()).length === 0, `情侶靠攏後，別隻沒有被擠到重疊（${JSON.stringify(await tooClose())}）`);
    await send('stage:quokkas', base);
    await wait(400);
    ok((await st()).length === 4, '小袋鼠從名單拿掉 → 移除');
  }

  if (ONLY.includes('avoid')) {
    console.log('4. 避讓：撿球不穿過別隻、放下太近自己跳開', Date.now());
    await until(async () => (await st()).every((x) => x.layer === 8), 30000);
    await placeAll([300, 520, 1000, 1180]); await quiet();
    await stage.evaluate((id) => { const S = window.__stage.S, a = S.actors.get(id); a.throwX = a.x; new S.Ball(a, 'vball', 760, a.y - 12 * a.k - 2, 0, 0, null); window.__stage.kick(); }, A);
    // 讓路＝橫向跳到整條路線（去撿球＋抱回來）外側，和撿球的、和別隻都保持禮貌距離；撿球的不會從牠身上穿過去（第 1 輪審查 #4）
    let sawFetch = false, stepped = false, waited = false, maxDepth = 0, badPass = [], maxMove = 0, lateral = false; const bx0 = (await one(B)).x;
    await until(async () => { const a = await one(A), b = await one(B); if (a.layer === 4) { sawFetch = true; if (a.phase === 'wait') waited = true; if (Math.abs(a.x - b.x) < 92 && !(b.depth >= 40)) badPass.push([a.x, b.x, b.depth]); } if (b.state === 'yield') { stepped = true; if (await stage.evaluate((id) => !!window.__stage.actors.get(id).job.lateral, B)) lateral = true; } maxDepth = Math.max(maxDepth, b.depth); maxMove = Math.max(maxMove, Math.abs(b.x - bx0)); return sawFetch && a.layer === 8 && !a.ball && b.layer === 8; }, 40000, 30);
    const b1 = await one(B), others1 = (await st()).filter((x) => x.id !== B && !x.inPouch);
    ok(sawFetch && stepped && waited && (lateral ? maxMove >= 60 : maxDepth >= 40), `撿球路上有別隻：牠${lateral ? `橫向跳開到路線外（移動 ${Math.round(maxMove)} px）` : `往後退一大步（${Math.round(maxDepth)} px）`}，撿球的等牠讓好才衝`);
    ok(!badPass.length, `撿球的來回都沒有和讓路的那隻在同一條線上靠近到禮貌距離內（穿過身體）${badPass.length ? JSON.stringify(badPass.slice(0, 3)) : ''}`);
    ok(b1.depth === 0 && others1.every((o) => Math.abs(o.x - b1.x) >= 90), `讓完以後在地面線上，和別隻保持禮貌距離（最近 ${Math.round(Math.min(...others1.map((o) => Math.abs(o.x - b1.x))))} px ≥ 90）`);
    // 擋路的正在忙（響鈴）：撿球的停下來等，不穿過去
    await until(async () => (await st()).every((x) => x.layer === 8), 8000);
    await placeAll([300, 520, 1000, 1180]); await quiet();
    await send('q:alert', { qid: B, reminderId: 'rb', text: '忙' }); await wait(500);
    await stage.evaluate((id) => { const S = window.__stage.S, a = S.actors.get(id); a.throwX = a.x; new S.Ball(a, 'vball', 760, a.y - 12 * a.k - 2, 0, 0, null); window.__stage.kick(); }, A);
    await until(async () => (await one(A)).phase === 'wait', 5000, 40);
    await wait(1500);
    let a1 = await one(A);
    ok(a1.phase === 'wait' && Math.abs(a1.x - 300) < 3, '擋路的那隻在響鈴（不能讓）：撿球的停在原地等，不穿過去');
    await send('q:alert-clear', { qid: B, reminderId: 'rb' });
    let badPass2 = [];
    ok(await until(async () => { const a = await one(A), b = await one(B); if (Math.abs(a.x - b.x) < 60 && !(b.depth >= 40)) badPass2.push([a.x, b.x, b.depth]); return a.layer === 8 && !a.ball && a.x < 320; }, 40000, 30) && !badPass2.length, `牠忙完讓開後才去撿回來${badPass2.length ? JSON.stringify(badPass2.slice(0, 3)) : ''}`);
    await until(async () => (await st()).every((x) => x.layer === 8), 8000);
    // 互動走位：路上有第三隻 → 先請牠讓路（跳到這一段的外側），讓不了才取消
    await placeAll([300, 520, 760, 1180]); await quiet();
    await send('social:start', { pairId: 'av1', a: A, b: C, type: 'nose', initiator: A });
    let stepped2 = false, maxMove2 = 0, depth2 = 0;
    const avDone = await until(async () => { const b = await one(B); if (b.state === 'yield') stepped2 = true; maxMove2 = Math.max(maxMove2, Math.abs(b.x - 520)); depth2 = Math.max(depth2, b.depth); return (await got('social:done')).find((g) => g.p.pairId === 'av1'); }, 30000, 40);
    await until(async () => (await one(B)).layer === 8, 6000);
    const bEnd = (await one(B)).x, aEnd = (await one(A)).x, cEnd = (await one(C)).x, bDep = (await one(B)).depth;
    ok(avDone && stepped2 && (depth2 >= 40 || maxMove2 >= 60), `互動走位的路上站著待機的第三隻：牠讓路（往後 ${Math.round(depth2)} px、左右 ${Math.round(maxMove2)} px），互動照常完成`);
    ok(bDep === 0 && Math.abs(bEnd - aEnd) >= 90 && Math.abs(bEnd - cEnd) >= 90, `互動結束後在地面線上，和那兩隻保持禮貌距離 ≥ 90（B ${bEnd}、A ${aEnd}、C ${cEnd}）`);
    await until(async () => (await st()).every((x) => x.layer === 8), 6000);
    await placeAll([300, 520, 760, 1180]); await quiet();
    await send('q:alert', { qid: B, reminderId: 'rb2', text: '忙' });
    await until(async () => (await one(B)).layer === 1, 3000, 40);
    const tAv = Date.now();
    await send('social:start', { pairId: 'av2', a: A, b: C, type: 'nose', initiator: A });
    const avAb = await until(async () => (await got('social:abort')).find((g) => g.p.pairId === 'av2'), 12000);
    ok(avAb && avAb.p.reason === 'busy' && Date.now() - tAv > 6000 && Math.abs((await one(A)).x - 300) < 3, `第三隻正在響鈴讓不了：等了 ${((Date.now() - tAv) / 1000).toFixed(1)} 秒才取消（reason=${avAb && avAb.p.reason}），沒有穿過牠`);
    await send('q:alert-clear', { qid: B, reminderId: 'rb2' });
    await until(async () => (await st()).every((x) => x.layer === 8), 5000);
    // 通則：兩隻（非情侶、非母子）靜止時身體不得重疊，超過 2 秒比較閒的那隻自己跳開
    await placeAll([300, 520, 900, 1180]); await quiet();
    await stage.evaluate(([c, d]) => { const S = window.__stage.S, C = S.actors.get(c), D = S.actors.get(d); D.x = C.x + 28; D.place(); S.checkOverlapSoon(); }, [C, D]);
    await wait(1500);
    ok(Math.abs((await one(C)).x - (await one(D)).x) < 40, '重疊不到 2 秒：還沒動');
    const sep = await until(async () => { const s2 = await st(); const c = s2.find((x) => x.id === C), d = s2.find((x) => x.id === D); return c.layer === 8 && d.layer === 8 && Math.abs(c.x - d.x) >= 90 ? Math.abs(c.x - d.x) : null; }, 9000, 60);
    ok(sep, `兩隻靜止重疊超過 2 秒：其中一隻自己跳開（相距 ${sep && Math.round(sep)} px）`);
    const pairsTooClose = () => stage.evaluate(() => { const S = window.__stage.S, L = [...S.actors.values()].filter((a) => !a.inPouch), out = []; for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const a = L[i], b = L[j]; if (Math.abs(a.y - b.y) <= 40 && !S.family.close(a, b) && Math.abs(a.x - b.x) < 60 * (a.k + b.k) / 2 / S.SCALE) out.push([a.name, b.name, Math.round(Math.abs(a.x - b.x))]); } return out; });
    ok((await pairsTooClose()).length === 0, '全場沒有身體重疊的兩隻');
    // 放下時離另一隻 < 60 px：自己跳開
    await until(async () => (await st()).every((x) => x.layer === 8), 8000);
    await placeAll([300, 520, 1000, 1180]);
    const h = await head(C), t = await head(D);
    await stage.mouse.move(h.x, h.y); await stage.mouse.down();
    for (let i = 1; i <= 10; i++) { await stage.mouse.move(h.x + (t.x - 30 - h.x) * i / 10, h.y - 20); await wait(40); }
    await stage.mouse.move(t.x - 30, h.y); await wait(250); await stage.mouse.up();
    ok(await until(async () => (await one(C)).state === 'stepAway', 3000, 30), '放在別隻旁邊 30 px：自己跳開');
    ok(await until(async () => { const c = await one(C), d = await one(D); return c.layer === 8 && Math.abs(c.x - d.x) >= 80; }, 6000), `跳開後相距 ${Math.abs((await one(C)).x - (await one(D)).x)} px`);
  }

  if (ONLY.includes('life')) {
    console.log('5. 常駐：呼吸（CSS）、眨眼（換快取畫格）、看游標、散步不滑步、待機不跑迴圈', Date.now());
    await until(async () => (await st()).every((x) => x.layer === 8), 30000);
    await placeAll([300, 560, 900, 1150]); await quiet();
    await wait(11000);
    ok(!(await stage.evaluate(() => window.__stage.running())), '待機時沒有 requestAnimationFrame');
    ok(await stage.evaluate((id) => { const cs = getComputedStyle(window.__stage.actors.get(id).img); return cs.animationName === 'none'; }, A), '靜置超過 10 秒：呼吸停在靜止格（不耗資源）');
    const blinks = await stage.evaluate((id) => new Promise((res) => { const a = window.__stage.actors.get(id); let n = 0, run = 0, maxRun = 0; const vis = () => { const im = a.el.querySelector('img:not(.back)'); return im && im.src; }; let last = vis(); const mo = new MutationObserver(() => { const v = vis(); if (v !== last) { last = v; n++; } }); mo.observe(a.el, { attributes: true, subtree: true, childList: true, attributeFilter: ['src', 'class'] }); const iv = setInterval(() => { run = window.__stage.running() ? run + 1 : 0; maxRun = Math.max(maxRun, run); }, 50); setTimeout(() => { mo.disconnect(); clearInterval(iv); res({ n, raf: maxRun > 3 ? maxRun : 0, maxRun }); }, 9000); }), A);   // 低頻計時器每隔幾秒會醒來跑一格檢查（正常）；連續跑超過 150 ms 才算「啟動了動畫迴圈」
    ok(blinks.n >= 2 && blinks.raf === 0, `9 秒內眨眼／耳朵抖換了 ${blinks.n} 次圖，沒有啟動動畫迴圈`);
    await app.evaluate(() => global.v2.stage.pause(true));
    const a0 = await one(A);
    const seen = new Set();
    for (const [dx, dy] of [[-200, -110], [200, -110], [0, -330], [-160, -280], [160, -280], [-170, 40], [170, 40]]) { await send('stage:cursor', { x: a0.x + dx, y: a0.y + dy }); await wait(90); seen.add(await stage.evaluate((id) => window.__stage.actors.get(id).lookBucket, A)); }
    ok(seen.size >= 6 && !(await one(A)).live, `看游標：量化成 ${seen.size} 個方向的快取畫格（${[...seen].join('、')}），不即時重畫`);
    ok(await stage.evaluate((id) => { const cs = getComputedStyle(window.__stage.actors.get(id).img); return cs.animationName === 'breathe' && cs.willChange === 'transform'; }, A), '游標在 400 px 內：呼吸（<img> 上的 CSS transform 動畫）');
    await wait(1700);
    ok(await stage.evaluate(() => window.__stage.S.cursor.x === -9999), '游標 1.5 秒沒有新座標（主行程只在 400 px 內才送）：當成已走遠，不再擋散步');
    await send('stage:cursor', { x: -9999, y: -9999 });
    await app.evaluate(() => global.v2.stage.pause(false));
    await wait(1700);
    // 散步：位移和腳步對齊（腳著地的那段不移動）
    for (const gait of ['walk', 'hop']) {
      const r = await stage.evaluate(async ([id, gait]) => {
        const S = window.__stage.S, a = S.actors.get(id), G = S.ANIM.GAIT; a.th = -15;
        const m = a.mover(a.x + (gait === 'walk' ? -150 : 150), { gait }); /* 走過去再走回來：不要走到隔壁那隻身上（會觸發重疊跳開）；四肢著地往空間大的那邊（口鼻不會頂到別隻） */ const job = { name: 'walk', ticks: true, tick: (now) => m.tick(now), end() { a.th = 30; } };
        a.requestActivity(7, job); window.__stage.kick();
        // 記下每一格的「這一步前進比例」和實際位置：腳著地（比例不變）的時候位置不能動
        const orig = a.gaitFrame.bind(a); let prev = null, slide = 0, moved = 0, frames = 0, planted = 0; const x00 = a.x;
        let pp = null;
        a.gaitFrame = (g, d, u) => { const adv = orig(g, d, u); if (prev) prev.x = a.x; if (pp && prev && Math.abs(prev.adv - pp.adv) < 1e-6 && prev.u > pp.u) { planted++; slide += Math.abs(prev.x - pp.x); } pp = prev; prev = { adv, u }; frames++; return adv; };
        while (a.job === job) await new Promise((r) => requestAnimationFrame(r));
        a.gaitFrame = orig; moved = Math.abs(a.x - x00);
        return { slide: +slide.toFixed(2), moved: Math.round(moved), frames, planted };
      }, [C, gait]);
      ok(r.moved > 140 && r.frames > 8 && r.planted > 3 && r.slide < 1, `${gait}：走 ${r.moved} px（${r.frames} 格）；腳著地的 ${r.planted} 格總共滑了 ${r.slide} px`);
      await until(async () => (await one(C)).layer === 8, 3000);
    }
    const stopped = await until(() => stage.evaluate(() => !window.__stage.running()), 4000, 50);
    ok(stopped, '走完回到待機：迴圈停下' + (stopped ? '' : ' ' + JSON.stringify(await stage.evaluate(() => [...window.__stage.actors.values()].map((a) => [a.name, Math.round(a.x), a.job && a.job.name])))));
  }

  if (ONLY.includes('robust')) {
    console.log('6. 藏起來／回來、拖到畫面外、放手遺失、睡覺時的響鈴', Date.now());
    await until(async () => (await st()).every((x) => x.layer === 8), 30000);
    await placeAll([300, 560, 900, 1150]); await quiet();
    const textOf = (id) => stage.evaluate((id) => window.__stage.actors.get(id).bubble.textEl.textContent, id);
    // A：藏起來期間的報告，顯示出來後要講
    await send('stage:hide', { until: Date.now() + 600000 });
    await until(() => stage.evaluate(() => window.__stage.S.mode === 'hidden'), 3000, 40);
    await send('q:event', { qid: A, kind: 'stock', payload: { symbol: '2330', name: '台積電', pct: 1.2, dir: 'up' }, prio: 2 });
    await send('presence', { away: false, digest: [{ qid: B, items: ['15:30 開會'] }] });
    await wait(600);
    const qs = await stage.evaluate(([a, b]) => [window.__stage.actors.get(a).queue.length, window.__stage.actors.get(b).queue.length, window.__stage.S.mode], [A, B]);
    ok(qs[0] === 1 && qs[1] === 1 && qs[2] === 'hidden', `藏起來時：工作反應與回來的摘要都先記在佇列（A ${qs[0]} 則、B ${qs[1]} 則），不丟掉`);
    await send('stage:hide', { hide: false });
    ok(await until(async () => /台積電 ▲1.2%/.test(await textOf(A)), 8000, 60), `顯示出來後 A 把累積的報告講出來（「${await textOf(A)}」）`);
    ok(await until(async () => /剛剛錯過：15:30 開會/.test(await textOf(B)), 8000, 60), `B 也講（「${await textOf(B)}」）`);
    await until(async () => (await st()).every((x) => x.layer === 8), 9000);
    await stage.evaluate((id) => { const a = window.__stage.actors.get(id); a.home = a.x; a.nextAt = 0; window.__stage.S.cursor = { x: -9999, y: -9999 }; window.__stage.kick(); }, A);
    ok(await until(async () => (await one(A)).layer === 7, 6000, 60), '報告講完後照常散步（佇列清空了）');
    await until(async () => (await one(A)).layer === 8, 30000); await quiet();
    // B：慢慢放手把庫卡放到畫面外 → 拉回畫面內，存檔位置也在畫面內
    await app.evaluate(({ ipcMain }) => { global.__saved = []; ipcMain.on('stage:save-pos', (e, p) => global.__saved.push(p)); });
    let h = await head(A);
    await stage.mouse.move(h.x, h.y); await stage.mouse.down();
    for (let i = 1; i <= 14; i++) { await stage.mouse.move(h.x - i * 30, h.y); await wait(40); }
    await wait(300); await stage.mouse.up();
    await until(async () => (await one(A)).layer === 8, 6000);
    const ax = (await one(A)).x, saved = await app.evaluate(() => global.__saved.slice(-1)[0]);
    ok(ax >= 44 && ax <= 1280 - 44 && saved && saved.pos.x >= 44, `慢慢放到畫面左邊外：拉回畫面內（x=${ax}），存檔位置也在畫面內（${saved && saved.pos.x}）`);
    // C：拖曳中使用者離開（mouseup 收不到）→ 強制放下
    await quiet(); await until(async () => (await st()).every((x) => x.layer === 8), 8000);     // 上一段被放下的那隻可能還在跳開：等大家停好
    await placeAll([300, 560, 900, 1150]); await quiet(); await wait(300);
    h = await head(C);
    await stage.mouse.move(h.x, h.y); await stage.mouse.down();
    for (let i = 1; i <= 6; i++) { await stage.mouse.move(h.x, h.y - i * 10); await wait(30); }
    ok(await until(async () => (await one(C)).state === 'drag', 2000, 40), '拎起來');
    await send('presence', { away: true, sleep: true });
    ok(await until(() => stage.evaluate((id) => { const a = window.__stage.actors.get(id); return !a.dragging; }, C), 3000, 40), '拖曳中使用者離開（鎖定）：強制放下，不會卡在被拎著');
    await stage.mouse.up();
    // D：睡覺時響鈴超過 45 秒改成靜止格（測試把門檻調短）
    await send('q:alert', { qid: D, reminderId: 'rz', text: '吃藥' });
    ok(await until(async () => (await one(D)).layer === 1 && (await one(D)).live, 4000, 40), '使用者不在時提醒照響（先播動畫）');
    await stage.evaluate((id) => { const j = window.__stage.actors.get(id).job; j.dimAt = performance.now() - 46000; }, D);
    ok(await until(() => stage.evaluate((id) => { const a = window.__stage.actors.get(id); return a.job && a.job.name === 'ring' && a.job.still && !a.liveOn && a.bubble.kind === 'alert'; }, D), 3000, 40), '不在超過 45 秒：響鈴停在靜止格（氣泡留著），不再重畫');
    await wait(500);
    const busy = await until(() => stage.evaluate(() => !window.__stage.running()), 3000, 50);
    ok(busy, '這時候動畫迴圈是停的' + (busy ? '' : ' ' + JSON.stringify(await stage.evaluate(() => [...window.__stage.actors.values()].map((a) => [a.name, a.mode, a.job && a.job.name, a.job && a.job.ticks]).concat([...window.__stage.balls].map((b) => ['ball', b.stopped]))))));
    await send('presence', { away: false });
    ok(await until(async () => (await one(D)).live && (await one(D)).layer === 1, 4000, 40), '使用者回來：響鈴恢復動畫');
    // 舞台藏起來：響鈴立刻停在靜止格（氣泡留著）；顯示出來恢復動畫
    await send('stage:hide', { until: Date.now() + 600000 });
    ok(await until(() => stage.evaluate((id) => { const a = window.__stage.actors.get(id); return a.job && a.job.still && !a.liveOn && !window.__stage.running(); }, D), 3000, 40), '舞台藏起來：響鈴停在靜止格、動畫迴圈停下');
    await send('stage:hide', { hide: false });
    ok(await until(async () => (await one(D)).live && (await one(D)).layer === 1, 4000, 40), '顯示出來：響鈴恢復動畫');
    await send('q:alert-clear', { qid: D, reminderId: 'rz' });
    await until(async () => (await st()).every((x) => x.layer === 8), 9000);
    // E：拖曳中 mouseup 在視窗外遺失（之後的 mousemove 都是 buttons=0）→ 當作放手；單一個 buttons=0 的合成事件不算
    await placeAll([300, 560, 900, 1150]); await quiet();
    h = await head(B);
    await stage.mouse.move(h.x, h.y); await stage.mouse.down();
    for (let i = 1; i <= 6; i++) { await stage.mouse.move(h.x + i * 8, h.y - i * 6); await wait(30); }
    await stage.evaluate(([x, y]) => window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, buttons: 0 })), [h.x + 50, h.y - 36]);
    await wait(60);
    ok(await stage.evaluate((id) => window.__stage.actors.get(id).dragging, B), '拖曳中一個 buttons=0 的合成 mousemove：還拎著（不誤判）');
    await stage.evaluate(async ([x, y]) => { for (let i = 0; i < 4; i++) { window.dispatchEvent(new MouseEvent('mousemove', { clientX: x + i * 4, clientY: y, buttons: 0 })); await new Promise((r) => setTimeout(r, 40)); } }, [h.x + 50, h.y - 36]);
    ok(await until(() => stage.evaluate((id) => !window.__stage.actors.get(id).dragging, B), 2000, 40), 'mouseup 遺失（連續 buttons=0 的 mousemove）：自動放手');
    await stage.mouse.up();
    ok(await until(async () => (await one(B)).layer === 8, 5000), '放手後回到待機');
    // F：家在畫面外（舊存檔）：散步會走回畫面內
    await quiet();
    const back = await stage.evaluate((id) => { const S = window.__stage.S, a = S.actors.get(id); a.x = 70; a.home = -500; a.place(); const j = a.walkJob(); const t = j.target; a.requestActivity(7, j); window.__stage.kick(); return t; }, A);
    await until(async () => (await one(A)).layer === 8, 15000);
    ok(back >= 60 && back <= 1280 - 60 && (await one(A)).x >= 44, `家在畫面外（-500）：散步目標在畫面內（${Math.round(back)}），走完 x=${(await one(A)).x}`);
  }

  {
    const pol = await stage.evaluate(() => window.__polite), pas = await stage.evaluate(() => window.__pass);
    console.log('7. 禮貌距離（全程監看）', Date.now());
    ok(!pol.length, `所有走位、讓位、跳開、撿球、互動結束的站位，和非伴侶都相距 ≥ 90 px${pol.length ? ' ' + JSON.stringify(pol.slice(0, 6)) : ''}`);
    ok(!pas.length, `移動途中沒有穿過非伴侶的身體（同一條線上 < 60 px），四肢著地散步面向對方時 ≥ 130 px${pas.length ? ' ' + JSON.stringify(pas.slice(0, 6)) : ''}`);
  }
  console.log('pageerror / console error:', errs.length ? errs : '無');
  if (errs.length) fails++;
  console.log(fails ? `失敗 ${fails} 項` : '全部通過');
  await app.close().catch(() => {});
  cleanup();                                                        // 結尾：確定沒有留下行程
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.stack); cleanup(); process.exit(1); });
