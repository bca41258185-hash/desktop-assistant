// 錄影示範（Xvfb :94）：平常的散步／眨眼／看游標／響鈴 → 15 種互動 → 懷孕、探頭、跟隨、長大 → 被打斷
const { _electron } = require('playwright');
const fs = require('fs');
const S = __dirname, R = (process.env.QUOKKA_DIR || require('path').resolve(__dirname, '../..'));
const PARTS = (process.argv[2] || 'life,social,ball,family,abort').split(',');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const cfg = S + '/cfg-recs-' + Date.now(); fs.mkdirSync(cfg);
  const app = await _electron.launch({ executablePath: R + '/node_modules/electron/dist/electron', args: [R, '--no-sandbox'], cwd: R,
    env: { ...process.env, DISPLAY: ':94', XDG_CONFIG_HOME: cfg, QUOKKA_STAGE: '1', QUOKKA_DEMO: '4' } });
  await app.evaluate(({ ipcMain }) => { global.__got = []; for (const ch of ['social:done', 'social:abort']) ipcMain.on(ch, (e, p) => global.__got.push({ ch, p })); });
  await app.evaluate(({ powerMonitor }) => { powerMonitor.getSystemIdleTime = () => 0; });   // 測試環境沒有人動滑鼠：不要被判定成「使用者離開」
  let stage;
  for (let i = 0; i < 40 && !stage; i++) { for (const w of app.windows()) if ((await w.url()).includes('stage.html')) stage = w; if (!stage) await wait(250); }
  const errs = []; stage.on('pageerror', (e) => errs.push(e.message));
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.getURL().includes('stage.html')) w.hide(); });
  await wait(1200);
  await stage.evaluate(() => { for (const a of window.__stage.actors.values()) { a.nextAt = performance.now() + 1e9; a.idleAt = performance.now() + 1e9; } });
  await wait(2500);
  const send0 = (ch, p) => app.evaluate(({ BrowserWindow }, [ch, p]) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('stage.html')) w.webContents.send(ch, p); }, [ch, p]);
  await stage.evaluate(() => { const S = window.__stage.S, orig = S.startSocial; window.__allow = new Set(); S.startSocial = (p) => (window.__allow.has(p.pairId) ? orig(p) : (S.api.socialAbort(p.pairId, p.a, 'user'), null)); });   // 主行程自己排的互動先擋掉，只放行測試送的
  const send = async (ch, p) => { if (ch === 'social:start') await stage.evaluate((id) => window.__allow.add(id), p.pairId); return send0(ch, p); };
  const got = (ch) => app.evaluate((_, ch) => global.__got.filter((g) => g.ch === ch), ch);
  const st = () => stage.evaluate(() => [...window.__stage.actors.values()].map((a) => ({ id: a.id, layer: a.layer, x: a.x, ball: !!a.ball })));
  const until = async (fn, ms = 30000, step = 120) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(step); } return null; };
  const idle = (ms = 40000) => until(async () => (await st()).every((x) => x.layer === 8 && !x.ball), ms);
  const quiet = () => stage.evaluate(() => { for (const a of window.__stage.actors.values()) { a.nextAt = performance.now() + 1e9; a.idleAt = performance.now() + 1e9; } });
  const place = (xs) => stage.evaluate((xs) => { let i = 0; for (const a of window.__stage.actors.values()) { if (a.isFollow) continue; a.x = a.home = i < xs.length ? xs[i] : 60; i++; a.depth = 0; a.y = 690; a.th = -15; a.place(); if (!a.job) a.showRest(); } window.__stage.S.reportRects(); }, xs);
  const capLog = [];
  const cap = async (t) => { const pos = await stage.evaluate(() => [...window.__stage.actors.values()].map((a) => [a.name, Math.round(a.x), a.job && a.job.name, !!a.isFollow, a.attach.partner || null])); capLog.push({ t: Date.now(), cap: t, pos }); fs.writeFileSync(S + '/rec_caps.json', JSON.stringify(capLog)); if (process.env.NOREC) console.log(t, JSON.stringify(pos)); return cap0(t); };
  const cap0 = (t) => stage.evaluate((t) => { let el = document.getElementById('cap'); if (!el) { el = document.createElement('div'); el.id = 'cap'; el.style.cssText = 'position:fixed;left:24px;top:330px;font:700 26px "Noto Sans TC","WenQuanYi Zen Hei",sans-serif;color:#4a3a2c;background:rgba(255,250,241,.92);padding:8px 18px;border-radius:14px;z-index:999999'; document.body.appendChild(el); } el.textContent = t; }, t);
  const head = (id) => stage.evaluate((id) => { const a = window.__stage.actors.get(id); return { x: a.x, y: a.y - 120 * a.k }; }, id);
  await stage.evaluate(() => { document.body.style.background = '#e9e4d8'; });
  const ids = (await st()).map((a) => a.id), [A, B, C, D] = ids;
  await quiet(); await idle(15000); await place([200, 520, 860, 1120]);
  fs.writeFileSync(S + '/rec_ready', '1');
  await wait(1500);
  let pn = 0;
  const social = async (type, a, b, label, xs, rnd) => {
    await idle(); if (xs) await place(xs); await quiet(); await cap(label); await wait(500);
    await stage.evaluate((v) => { window.__stage.S.testRnd = v == null ? null : () => v; }, rnd == null ? null : rnd);
    const pairId = 'r' + (++pn);
    await send('social:start', { pairId, a, b, type, initiator: a });
    await until(async () => (await got('social:done')).find((g) => g.p.pairId === pairId) || (await got('social:abort')).find((g) => g.p.pairId === pairId), 40000);
    await wait(700);
  };

  if (PARTS.includes('life')) {
    await app.evaluate(({ screen }) => { global.__realCursor = screen.getCursorScreenPoint; screen.getCursorScreenPoint = () => ({ x: -5000, y: -5000 }); });
    await cap('游標不在附近：剛動完 10 秒內還在呼吸');
    await wait(6000);
    await cap('游標不在附近、靜置超過 10 秒：呼吸停下（只剩眨眼、耳朵抖；不耗資源）');
    await wait(12000);
    await cap('游標靠近（400 px 內）：開始呼吸，眼睛和頭跟著滑鼠');
    await app.evaluate(() => global.v2.stage.pause(true));
    const b = await head(B);
    for (let i = 0; i <= 44; i++) { const ang = i / 44 * Math.PI * 2.4; const x = b.x + Math.cos(ang) * 190, y = b.y - 30 + Math.sin(ang) * 150; await send('stage:cursor', { x, y }); await stage.evaluate(([x, y]) => { let c = document.getElementById('cur'); if (!c) { c = document.createElement('div'); c.id = 'cur'; c.style.cssText = 'position:fixed;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:18px solid #333;transform:rotate(-30deg);z-index:999999'; document.body.appendChild(c); } c.style.left = x + 'px'; c.style.top = y + 'px'; }, [x, y]); await wait(160); }
    { const bb = await head(B); await stage.evaluate(([x, y]) => { const c = document.getElementById('cur'); c.style.left = x + 'px'; c.style.top = y + 'px'; }, [bb.x + 150, bb.y - 60]); for (let i = 0; i < 12; i++) { await send('stage:cursor', { x: bb.x + 150, y: bb.y - 60 }); await wait(500); } }
    await send('stage:cursor', { x: -9999, y: -9999 }); await stage.evaluate(() => { const c = document.getElementById('cur'); if (c) c.remove(); window.__stage.S.cursor = { x: -9999, y: -9999 }; });
    await wait(1800);
    await place([200, 560, 760, 1180]); await quiet(); await wait(400);
    await cap('散步往右走：小跳，在別隻前面保持禮貌距離停下');
    await stage.evaluate((a) => { const S = window.__stage.S, q = S.actors.get(a); q.requestActivity(7, q.walkJob(q.x + 220, { gait: 'hop', noPause: true })); S.kick(); }, A);
    await idle(30000); await wait(600);
    await cap('散步往左走：小跳，中途停下張望');
    await stage.evaluate((d) => { const S = window.__stage.S, q = S.actors.get(d); const r = Math.random; Math.random = () => .2; const j = q.walkJob(q.x - 270, { gait: 'hop' }); Math.random = r; q.requestActivity(7, j); S.kick(); }, D);
    await idle(30000); await wait(600);
    await cap('小跳散步途中被叫去「跳」：平順接上，不會消失一格');
    await stage.evaluate((d) => { const S = window.__stage.S, q = S.actors.get(d); q.requestActivity(7, q.walkJob(Math.min(innerWidth - 70, q.x + 200), { gait: 'hop', noPause: true })); S.kick(); }, D);
    await wait(900);
    await send('q:play', { qid: D, action: 'hop' });
    await wait(600); await idle(15000); await wait(800);
    await place([200, 520, 860, 1120]); await quiet(); await wait(300);
    await cap('跳（陪我玩：跳）');
    await send('q:play', { qid: C, action: 'hop' });
    await wait(600); await idle(15000); await wait(800);
    await stage.evaluate(() => { for (const a of window.__stage.actors.values()) if (!a.job && a.bubble.kind === 'say') a.bubble.hide('say'); });
    await place([200, 520, 860, 1120]);
    await idle(30000);
    await app.evaluate(() => global.v2.stage.pause(false));
    await cap('待機小動作（張望、抓臉、打哈欠…）');
    await stage.evaluate(() => { for (const a of window.__stage.actors.values()) a.idleAt = performance.now() + 300 + Math.random() * 2500; window.__stage.kick(); });
    await wait(6500); await quiet(); await idle(8000);
    await cap('提醒響鈴：跳一下、揮手、指向氣泡、踩小碎步');
    await send('q:alert', { qid: B, reminderId: 'r1', text: '15:30 開會' });
    await wait(8500);
    await stage.click('.bubble.alert.show button[data-act="ack"]').catch(() => {});
    await wait(1500);
    await cap('同時好幾個提醒：全部列出、每則各自按掉');
    for (const [rid, text] of [['m1', '15:30 開會'], ['m2', '喝水'], ['m3', '回覆客戶信'], ['m4', '伸展一下']]) { await send('q:alert', { qid: B, reminderId: rid, text }); await wait(250); }
    await wait(3500);
    await stage.click('.bubble.alert.show button[data-rid="m2"][data-act="ack"]', { timeout: 1500 }).catch(() => {});
    await wait(2200);
    await stage.click('.bubble.alert.show button[data-rid="m3"][data-act="snooze"]', { timeout: 1500 }).catch(() => {});
    await wait(2200);
    for (const rid of ['m1', 'm4']) { await stage.click(`.bubble.alert.show button[data-rid="${rid}"][data-act="ack"]`, { timeout: 1500 }).catch(() => {}); await wait(900); }
    await wait(1500);
  }
  if (PARTS.includes('social')) {
    await social('wave', A, B, '1 揮手打招呼', [300, 640, 960, 1160]);
    await social('nose', C, B, '2 碰鼻（鼻頭之間留一點距離、歪頭）', [300, 520, 880, 1160]);
    await social('paw', A, B, '3 碰碰手掌', [300, 560, 960, 1160]);
    await social('leaf', D, C, '4 分享葉子', [200, 420, 800, 1100]);
    await social('chase', B, C, '5 追逐跳跳', [140, 420, 640, 1180]);
    await social('sunbathe', A, B, '6 並排曬太陽', [330, 600, 960, 1160]);
    await social('cuddle', A, B, '7 依偎（情侶）', [330, 600, 960, 1160]);
    await social('groom', B, A, '8 理毛（情侶）', [330, 600, 960, 1160]);
    await social('leanNap', C, D, '9 靠著打盹（情侶）', [200, 420, 760, 1040]);
    await social('walkTogether', A, B, '10 並肩散步（情侶）', [330, 560, 1000, 1180]);
  }
  if (PARTS.includes('ball')) {
    await social('badminton', A, B, '11 一起打羽球（最後一拍跳殺，輸的去撿）', [330, 640, 1000, 1180]);
    await social('volleyball', B, C, '12 一起打排球（扣球 → 落在對手腳前，對手去撿）', [140, 480, 760, 1180], .3);
    await idle(40000);
    await social('volleyball', D, C, '12 一起打排球（接住收尾）', [140, 330, 760, 1060], .7);
    await idle(40000);
    await social('basketball', A, B, '13 一起打籃球（進球 → 歡呼碰掌 → 去把球撿回來）', [330, 560, 1060, 1200], .3);
    await idle(50000);
    await social('basketball', A, B, '13 一起打籃球（沒進 → 球彈過頭頂，傳球的去撿）', [430, 660, 1100, 1220], .9);
    await idle(50000);
    await stage.evaluate(() => { window.__stage.S.testRnd = null; });
  }
  let base;
  if (PARTS.includes('family')) {
    await idle(); await place([300, 620, 980, 1180]); await quiet();
    base = await stage.evaluate(() => [...window.__stage.actors.values()].map((a) => ({ id: a.id, name: a.name, traits: a.traits, pos: { x: a.x, y: a.y }, stage: 'adult', mom: null, dad: null, pregnant: false, hasJoey: null, partner: null })));
    const withQ = (mod) => base.map((q) => ({ ...q, ...(mod[q.id] || {}) }));
    await cap('懷孕：媽媽肚子上看得到育兒袋');
    await send('stage:quokkas', withQ({ [A]: { partner: B }, [B]: { partner: A, pregnant: true } }));
    await wait(4000);
    const jt = JSON.parse(JSON.stringify(base[2].traits)); jt.band = '#ffd34d';
    const joey = { id: 'joey1', name: '寶寶', traits: jt, pos: null, stage: 'pouch', mom: B, dad: A, growScale: 0.5 };
    await cap('出生：小袋鼠從育兒袋探頭（偶爾縮回去）');
    await send('stage:quokkas', withQ({ [A]: { partner: B }, [B]: { partner: A, hasJoey: 'joey1' } }).concat([joey]));
    await wait(3500);
    await stage.evaluate((b) => { const S = window.__stage.S, m = S.actors.get(b); m.joeyHide = true; S.family.refresh(m, true); setTimeout(() => { m.joeyHide = false; S.family.refresh(m, true); }, 1800); }, B);
    await wait(3500);
    await stage.evaluate((b) => { const S = window.__stage.S, q = S.actors.get(b); q.requestActivity(7, q.walkJob(q.x + 120, { gait: 'hop', noPause: true })); S.kick(); }, B);
    await idle(15000); await wait(800);
    await cap('跟隨期：跳出來跟在媽媽後面');
    joey.stage = 'follow';
    await send('stage:quokkas', withQ({ [A]: { partner: B }, [B]: { partner: A, hasJoey: 'joey1' } }).concat([joey]));
    await wait(3500);
    await stage.evaluate((b) => { const S = window.__stage.S, q = S.actors.get(b); q.requestActivity(7, q.walkJob(q.x - 260, { gait: 'hop', noPause: true })); S.kick(); }, B);
    await idle(20000); await wait(600);
    await stage.evaluate(() => { const S = window.__stage.S, j = S.actors.get('joey1'); const job = S.family.rollJob(j); j.requestActivity(6, job); S.kick(); });
    await wait(2200);
    await cap('拖走媽媽：小袋鼠鑽回育兒袋，放下 1.5 秒後再爬出來');
    const h = await head(B);
    await stage.mouse.move(h.x, h.y); await stage.mouse.down();
    for (let i = 1; i <= 20; i++) { await stage.mouse.move(h.x + i * 12, h.y - Math.sin(i / 20 * Math.PI) * 120); await wait(60); }
    await wait(600); await stage.mouse.up();
    await wait(5000); await idle(8000);
    await cap('爸爸過來碰鼻小袋鼠');
    await send('social:start', { pairId: 'dn', a: A, b: 'joey1', type: 'dadNose', initiator: A, anchor: B });
    await until(async () => (await got('social:done')).find((g) => g.p.pairId === 'dn'), 40000);
    await wait(1200); await idle(8000);
    await cap('媽媽往右散步：在別隻（非伴侶）前面保持禮貌距離停下');
    await stage.evaluate((b) => { const S = window.__stage.S, q = S.actors.get(b); q.requestActivity(7, q.walkJob(innerWidth - 60, { gait: 'hop', noPause: true })); S.kick(); }, B);
    await wait(1500); await idle(15000); await wait(1500);
    await cap('長大：跳一下、變大一點，成為獨立的庫卡，然後自己走開（不和爸媽擠在一起）');
    joey.stage = 'juvenile';
    await send('stage:quokkas', withQ({ [A]: { partner: B }, [B]: { partner: A } }).concat([joey]));
    await wait(3000); await idle(15000); await wait(1200);
    await cap('情侶待機：自己靠過去站在一起');
    await until(async () => stage.evaluate((a) => { const q = window.__stage.S.actors.get(a); return !q.job && !q.bubble.kind; }, A), 8000);
    const ci = await stage.evaluate(([a]) => { const S = window.__stage.S, q = S.actors.get(a); const r = Math.random; Math.random = () => .3; S.cursor = { x: -9999, y: -9999 }; const ok = S.family.coupleIdle(q, performance.now()); Math.random = r; S.kick(); return ok; }, [A]);   // 直接叫情侶待機（平常是隨機排到的）
    if (process.env.NOREC) console.log('coupleIdle', ci);
    await wait(1500); await idle(25000); await wait(1500);
    if (process.env.NOREC) console.log('couple end', JSON.stringify(await stage.evaluate(() => [...window.__stage.actors.values()].map((a) => [a.name, Math.round(a.x)]))));
    await send('stage:quokkas', base.concat([joey])); await wait(600);              // 小袋鼠（已長大）留在名單裡：不要讓牠消失
  }
  if (PARTS.includes('abort')) {
    await idle(); await place([330, 640, 980, 1180]); await quiet();
    await cap('被打斷：碰鼻途中 A 提醒響了 → B 看一眼後回待機');
    if (process.env.NOREC) { console.log('stop'); }
    await send('social:start', { pairId: 'x1', a: A, b: B, type: 'nose', initiator: A });
    await until(async () => stage.evaluate(() => !!document.querySelector('.duet svg')), 15000);
    await wait(1700);
    await send('q:alert', { qid: A, reminderId: 'r2', text: '喝水' });
    await wait(4200);
    await stage.click('.bubble.alert.show button[data-act="ack"]').catch(() => {});
    await idle(8000);
    await cap('被打斷：靠著打盹時 B 被拖走 → A 頭一歪醒來、抬頭');
    await place([330, 640, 980, 1180]);
    await send('social:start', { pairId: 'x2', a: A, b: B, type: 'leanNap', initiator: A });
    await until(async () => stage.evaluate(() => !!document.querySelector('.duet svg')), 15000);
    await wait(4200);
    const h = await head(B);
    await stage.mouse.move(h.x, h.y); await stage.mouse.down();
    for (let i = 1; i <= 14; i++) { await stage.mouse.move(h.x + i * 10, h.y - i * 9); await wait(50); }
    await wait(900); await stage.mouse.up();
    await idle(9000);
    await cap('撿球不穿過別隻：擋路的那隻橫向跳到路線外讓路，撿球的來回都不碰到牠');
    await place([300, 520, 1000, 1180]); await quiet();
    await stage.evaluate((id) => { const S = window.__stage.S, a = S.actors.get(id); a.throwX = a.x; new S.Ball(a, 'vball', 760, a.y - 12 * a.k - 2, 0, 0, null); S.kick(); }, A);
    await wait(2000); await idle(30000); await wait(1000);
  }
  console.log('errors', errs);
  fs.writeFileSync(S + '/rec_done', '1');
  await app.close();
})().catch((e) => { console.log('FAIL', e.stack); fs.writeFileSync(S + '/rec_done', '1'); process.exit(1); });
