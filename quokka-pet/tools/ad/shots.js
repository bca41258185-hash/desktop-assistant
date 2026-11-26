// 各鏡頭的設定與腳本。每個鏡頭開一次真實程式（runner/boot.js），逐格算圖。
//   screen：邏輯螢幕大小（舞台＝整個螢幕）；dsf：deviceScaleFactor（庫卡畫多大由它決定，正式版值）
//   鏡頭取景（A.views）只會「裁切＋縮小或等大」，不會放大。
// 只用程式本身的功能：面板輸入、提醒排程、股價輪詢（模擬來源）、資料夾監看、右鍵選單、陪我玩、
// 互動（social:start，等同主行程的社交排程送出的指令）、拖曳、離開偵測、程式自己的待機小動作。
const path = require('path'), fs = require('fs');
const WORK = path.resolve(process.env.AD_WORK || path.join(__dirname, 'out', 'work'));
const S = {};
const D = (s) => Date.parse(s);
const iso = () => new Date().toISOString();
const split = (A, panelZoom = 0.62) => ({ panelBounds: [0, 0, 300, 338], panelZoom });
// 左右分割：兩個 300×338 的框各佔半個畫面（dsf 3.2 時剛好 960×1080，原尺寸）
const halves = (l, r) => [{ src: l.src || 'stage', rect: l.rect, dst: [0, 0, 956, 1080] }, { src: r.src || 'stage', rect: r.rect, dst: [964, 0, 956, 1080] }];

// ---- 測試：3 秒（量每秒不同畫格數）-------------------------------------------------------
S.test3 = {
  screen: [640, 360], dsf: 3, cast: [0, 3], epoch: '2026-11-25T08:55:00+08:00',
  async run(A) {
    await A.place([['ad0', 230, -15], ['ad3', 420, 15]]); await A.hold();
    A.views = [{ src: 'stage', rect: [0, 0, 640, 360], dst: [0, 0, 1920, 1080] }];
    A.start();
    A.play('ad0', 'hop');
    A.onFrame = (t) => A.cursor(600 - t * 90, 120 + t * 40);
    await A.until(1.2); A.play('ad3', 'hop');
    await A.until(3);
  }
};

// ---- 1 開場：庫卡特寫，跳起來（陪我玩→跳一跳）------------------------------------------
S.hook = {
  screen: [640, 360], dsf: 4.8, cast: [0], epoch: '2026-11-25T08:50:00+08:00', bg: { windows: false },
  async run(A) {
    await A.place([['ad0', 320, -12]]); await A.hold();
    A.views = (t) => [{ src: 'stage', rect: A.cam(320, A.lerp(400, 470, A.ease(t / 4)), 362), dst: [0, 0, 1920, 1080] }];
    A.start();
    await A.until(0.35); A.mark('hop'); A.play('ad0', 'hop');
    await A.until(0.95); A.speed(0.45);            // 跳到最高點附近：慢動作
    await A.until(1.9); A.speed(1);
    await A.until(4.2);
  }
};

// ---- 2 問題：雜亂桌面，庫卡走進畫面、被摸頭 ---------------------------------------------
S.desk = {
  screen: [960, 540], dsf: 3.2, cast: [0], epoch: '2026-11-25T08:52:00+08:00', bg: { busy: true, windows: false },
  async run(A) {
    await A.place([['ad0', 815, -20]]); await A.hold();
    A.views = [{ src: 'stage', rect: A.cam(470, 600), dst: [0, 0, 1920, 1080] }];
    A.start();
    await A.until(0.1);
    // 散步（程式本身的走路，四肢慢走）走進畫面
    await A.js(`(function(){const S=window.__stage.S,a=S.actors.get('ad0');a.requestActivity(7,a.walkJob(520,{gait:'hop',noPause:true}));S.kick();})()`);
    A.mark('walk');
    await A.until(4.4);
    const a = await A.actor('ad0');
    A.curShow = true;
    for (let i = 0; i <= 30; i++) { const u = A.ease(i / 30); A.cursor(A.lerp(820, a.x + 4, u), A.lerp(250, a.y - a.h * .7, u)); await A.frame(); }
    A.curKind = 'hand'; A.mark('pat'); await A.clickActor('ad0');
    await A.wait(0.4); A.curKind = 'arrow';
    for (let i = 0; i <= 30; i++) { const u = A.ease(i / 30); A.cursor(A.lerp(a.x + 4, a.x + 260, u), A.lerp(a.y - a.h * .7, a.y - 260, u)); await A.frame(); }
    await A.until(8.2);
  }
};

// ---- 3 早上：游標靠近，頭和眼睛跟著轉；伸懶腰（待機小動作）-----------------------------------
S.morning = {
  screen: [640, 360], dsf: 4.8, cast: [0], epoch: '2026-11-25T08:55:00+08:00', bg: { windows: false },
  async run(A) {
    await A.place([['ad0', 320, 0]]); await A.hold();
    A.views = [{ src: 'stage', rect: A.cam(320, 400, 362), dst: [0, 0, 1920, 1080] }];
    const hx = 320, hy = 354 - 80;
    A.curShow = true; A.cursor(560, 150);
    A.start();
    A.onFrame = (t) => {
      if (t < 1) { const u = A.ease(t); A.cursor(A.lerp(560, hx + 110, u), A.lerp(150, hy - 40, u)); }
      else if (t < 4.2) { const g = (t - 1) / 3.2 * Math.PI * 2 * 1.15 - .3; A.cursor(hx + Math.cos(g) * 120, hy - 20 + Math.sin(g) * 70); }
      else if (t < 5) { const u = A.ease((t - 4.2) / .8); A.cursor(A.lerp(hx + 115, 700, u), A.lerp(hy - 40, 40, u)); }
      else A.curShow = false;
    };
    await A.until(5.2); A.onFrame = null; A.curShow = false;
    await A.js(`(function(){const S=window.__stage.S,a=S.actors.get('ad0'),N=S.ANIM;a.requestActivity(6,a.animJob('idle:stretch',N.IDLE.stretch));S.kick();})()`);
    A.mark('stretch');
    await A.until(8.2);
  }
};

// ---- 4 上班：面板一句話交代 → 庫卡收下；快轉到 9:02 準時響 -------------------------------
S.work = {
  screen: [960, 540], dsf: 3.2, cast: [0], epoch: '2026-11-25T09:00:20+08:00', bg: {},
  async run(A) {
    await A.place([['ad0', 640, -15]]); await A.hold();
    await A.openPanel('ad0', [0, 0, 300, 338], 0.8);
    A.views = halves({ src: 'panel', rect: [0, 0, 300, 338] }, { rect: A.cam(640, 300, 545, 300 / 338) });
    A.start();
    await A.until(0.4); A.mark('type1');
    await A.type('9:02 開會', 8); await A.wait(0.35); A.mark('enter1'); await A.key('Enter');
    await A.until(4.2); A.mark('type2');
    await A.type('記得買牛奶', 8); await A.wait(0.35); A.mark('enter2'); await A.key('Enter');
    await A.until(8.4); A.mark('cut');
    // 快轉：主行程與頁面一起前進，程式自己的提醒排程在 9:02:00 觸發
    const ms = D('2026-11-25T09:01:58+08:00') - A.VC.dateNow();
    await A.skip(ms, 250);
    A.mark('ringStart');
    await A.wait(4.5);
    // 游標點「知道了」
    const b = await A.js(`(function(){const e=document.querySelector('.bubble.alert.show button[data-act="ack"]');if(!e)return null;const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
    if (b) {
      A.curShow = true;
      for (let i = 0; i <= 24; i++) { const u = A.ease(i / 24); A.cursor(A.lerp(b[0] + 120, b[0], u), A.lerp(b[1] + 120, b[1], u)); await A.frame(); }
      A.mark('ack'); await A.mouse('mouseMove', b[0], b[1]); await A.mouse('mouseDown', b[0], b[1]); await A.frame(); await A.mouse('mouseUp', b[0], b[1]);
    } else A.log('no ack button');
    await A.wait(2.5);
  }
};

// ---- 5a 股價：同時漲停／跌停，左右對比 -------------------------------------------------
const stockExtra = (owners) => () => ({ stocks: owners.map(([o, sym, nm]) => ({ id: 's' + sym + o, owner: o, symbol: sym, market: 'tw', name: nm, ex: 'tse', createdAt: iso() })) });
S.stock = {
  screen: [960, 540], dsf: 3.2, cast: [5, 3], epoch: '2026-11-25T09:05:00+08:00', bg: {},
  extra: stockExtra([['ad5', '8888', '綠葉科技'], ['ad3', '6666', '尤加利食品']]),
  async run(A) {
    await A.place([['ad5', 230, 15], ['ad3', 730, -15]]); await A.hold();
    global.__setPx('8888', 125.6); global.__setPx('6666', 87.8);
    await A.skip(3000, 100);
    A.views = halves({ rect: A.cam(230, 300, 545, 300 / 338) }, { rect: A.cam(730, 300, 545, 300 / 338) });
    A.start();
    await A.until(0.6); A.mark('limit');
    global.__setPx('8888', 137.5); global.__setPx('6666', 79.2);
    await A.until(6.5);
  }
};
// ---- 5b 同一檔股票，兩種個性的說法（右鍵「今天股市怎麼了？」）-------------------------------
S.talk = {
  screen: [960, 540], dsf: 3.2, cast: [5, 3], epoch: '2026-11-25T10:20:00+08:00', bg: {},
  extra: stockExtra([['ad5', '8888', '綠葉科技'], ['ad3', '8888', '綠葉科技']]),
  async run(A) {
    await A.place([['ad5', 230, 15], ['ad3', 730, -15]]); await A.hold();
    global.__setPx('8888', 127.9);
    await A.skip(3000, 100);
    A.views = halves({ rect: A.cam(230, 300, 545, 300 / 338) }, { rect: A.cam(730, 300, 545, 300 / 338) });
    A.start();
    await A.until(0.3); A.mark('ask');
    await A.context('ad5', '今天股市怎麼了？');
    await A.context('ad3', '今天股市怎麼了？');
    await A.until(12);
  }
};

// ---- 6 資料夾監看 -----------------------------------------------------------------------
const FOLDER = path.join(WORK, 'demo-folder', '專案資料');
S.folder = {
  screen: [960, 540], dsf: 3.2, cast: [2], epoch: '2026-11-25T15:00:00+08:00', bg: {},
  extra: () => { fs.rmSync(path.join(WORK, 'demo-folder'), { recursive: true, force: true }); fs.mkdirSync(FOLDER, { recursive: true }); fs.writeFileSync(path.join(FOLDER, '需求說明.txt'), '示意檔案'); return { folders: [{ id: 'fdemo', owner: 'ad2', path: FOLDER, status: 'ok', createdAt: iso() }] }; },
  async run(A) {
    await A.place([['ad2', 640, -15]]); await A.hold();
    await A.skip(2500, 100);
    await A.openPanel('ad2', [0, 0, 300, 338], 0.8);
    A.views = halves({ src: 'panel', rect: [0, 0, 300, 338] }, { rect: A.cam(640, 300, 545, 300 / 338) });
    A.start();
    await A.until(0.6); A.mark('files');
    for (const f of ['報價單_v2.xlsx', '會議紀錄.docx', '設計稿.png']) { fs.writeFileSync(path.join(FOLDER, f), 'demo ' + f); await A.wait(0.3); }
    await A.until(11);
  }
};

// ---- 7 好幾隻各自分工：把任務拖給另一隻 ---------------------------------------------------
S.team = {
  screen: [960, 540], dsf: 3.2, cast: [0, 4, 5, 3], epoch: '2026-11-25T11:00:00+08:00', bg: {},
  extra: () => ({ tasks: [{ id: 'tdemo', owner: 'ad0', text: '整理報價單', done: false, createdAt: iso(), order: 0 }] }),
  async run(A) {
    await A.place([['ad0', 300, 15], ['ad5', 430, 5], ['ad3', 560, -5], ['ad4', 690, -15]]); await A.hold();
    await A.openPanel(null, [0, 0, 300, 338], 0.8);
    A.views = (t) => (t < 2.6 ? [{ src: 'stage', rect: A.cam(495, 600), dst: [0, 0, 1920, 1080] }] : halves({ src: 'panel', rect: [0, 0, 300, 338] }, { rect: A.cam(690, 300, 545, 300 / 338) }));
    A.start();
    await A.until(0.3);
    for (const id of ['ad0', 'ad5', 'ad3', 'ad4']) { A.play(id, 'hop'); await A.wait(0.22); }
    await A.until(3.0);
    // 面板：在「整理報價單」上按右鍵 →「交給…」→ 小麥（和拖到頭像上是同一個換人功能）
    const pw = A.panel, z = pw.getZoomFactor();
    const pos = (sel) => pw.executeJavaScript(`(function(){const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return [r.x+Math.min(r.width/2,90),r.y+r.height/2]})()`);
    const glide = async (p0, p1, n) => { for (let i = 0; i <= n; i++) { const u = A.ease(i / n); A.pcur = [A.lerp(p0[0], p1[0], u), A.lerp(p0[1], p1[1], u)]; await A.frame(); } };
    const r = await pos('#lists [data-kind="task"]');
    await glide([300, 380], r, 30);
    A.mark('menu');
    for (const type of ['mouseDown', 'mouseUp']) pw.sendInputEvent({ type, x: Math.round(r[0] * z), y: Math.round(r[1] * z), button: 'right', clickCount: 1 });
    await A.wait(0.6);
    const m = await pos('#menu .menu-item[data-owner="ad4"]');
    if (m) {
      await glide(r, m, 24);
      A.mark('handoff');
      await A.panelClick('#menu .menu-item[data-owner="ad4"]');
    } else A.log('menu item missing');
    await A.wait(0.4); A.pcur = null;
    await A.until(9.5);
  }
};

// ---- 8 一起玩 -----------------------------------------------------------------------
const follow2 = (A, a, b, w) => async () => { const p = await A.actors(); const xa = p.find((q) => q.id === a).x, xb = p.find((q) => q.id === b).x; return (xa + xb) / 2; };
function playShot(cast, type, xs, w = 560) {
  return {
    screen: [960, 540], dsf: 3.5, cast, epoch: '2026-11-25T15:30:00+08:00', bg: {},
    async run(A) {
      const ids = cast.map((i) => 'ad' + i);
      await A.place(ids.map((id, i) => [id, xs[i], i ? -20 : 20])); await A.hold();
      let cx = (xs[0] + xs[1]) / 2;
      A.views = () => [{ src: 'stage', rect: A.cam(cx, w), dst: [0, 0, 1920, 1080] }];
      A.onFrame = async () => { const p = await A.actors(); const m = p.filter((q) => ids.includes(q.id)).reduce((s, q) => s + q.x, 0) / ids.length; cx += (m - cx) * 0.06; };
      A.start();
      await A.until(0.3);
      if (type === 'solo-basketball') A.play(ids[0], 'basketball'); else A.social(type, ids[0], ids[1]);
      A.mark('go');
      for (const [a, b, sp] of this.slow || []) { await A.until(a); A.speed(sp); A.mark('slow'); await A.until(b); A.speed(1); A.mark('normal'); }
      await A.until(this.dur || 13);
    }
  };
}
S.play_bad = { ...playShot([6, 1], 'badminton', [400, 560]), dur: 12 };
S.play_vb = { ...playShot([2, 3], 'volleyball', [400, 560]), dur: 12 };
S.play_chase = { ...playShot([4, 5], 'chase', [420, 560], 640), dur: 9 };
S.play_bb = { ...playShot([6], 'solo-basketball', [520, 520], 680), dur: 14, seed: Number(process.env.BB_SEED) || 12345 };
S.play_bb2 = { ...playShot([6, 2], 'basketball', [400, 560], 640), dur: 18.5, slow: [[5.2, 7.6, 0.5]] };

// ---- 9 戀愛、生寶寶 ------------------------------------------------------------------
S.love = {
  screen: [960, 540], dsf: 3.5, cast: [0, 2], epoch: '2026-11-25T18:00:00+08:00', bg: {},
  settings: { romance: true, babies: true, walk: 'home' },
  mutate(qs) { qs[0].pregnancy = { dad: 'ad2', gestationMs: 27 * 60000 - 75000, since: iso() }; },
  extra: () => ({ relations: { 'ad0|ad2': { affinity: 100, couple: true, friend: true, since: iso(), lastTogetherDay: null, dailyGain: 0, gainDay: null, lastConceptionRollDay: null, lastPassDay: null, decayDays: 0 } } }),
  async run(A) {
    await A.place([['ad0', 440, 20], ['ad2', 560, -20]]); await A.hold();
    let cx = 500;
    A.views = () => [{ src: 'stage', rect: A.cam(cx, 560), dst: [0, 0, 1920, 1080] }];
    A.start();
    await A.until(0.3); A.social('cuddle', 'ad2', 'ad0'); A.mark('cuddle');
    await A.until(7.5); A.mark('cut1');
    // 遊戲時鐘（主行程每 30 秒一次 tickClock）：快轉到「這一次 tick 就會生產」的前 1.5 秒，讓程式自己判斷生產
    const tickDue = () => A.timerDue(/tickClock/, 30000);
    const mom = () => A.v2.data.quokkas.find((q) => q.id === 'ad0');
    const toTick = async (lead) => { const d = tickDue() - A.VC.now() - lead; if (d > 0) await A.skip(d, 250); };
    for (let i = 0; i < 10 && mom().pregnancy && 27 * 60000 - mom().pregnancy.gestationMs > 30000; i++) await toTick(-100);
    await toTick(1500);
    let n = 0; while (A.v2.data.quokkas.length <= 2 && n++ < 6 * 60) await A.frame();
    A.mark('birth');
    await A.wait(6);
    A.mark('cut2');
    // 育兒袋期 10 分鐘：主行程快轉（遊戲時鐘照常一格一格 tick），到出袋那一次 tick 前 1.5 秒再逐格
    const kid = () => A.v2.data.quokkas.find((q) => q.mom === 'ad0');
    const phase = () => (mom().joey ? mom().joey.phaseMs : 0);
    while (kid() && kid().stage === 'pouch' && 10 * 60000 - phase() > 30000) { const d = tickDue() - A.VC.now() + 100; await A.skipMain(Math.max(d, 1000)); }
    await toTick(1500);
    n = 0; while (kid() && kid().stage === 'pouch' && n++ < 6 * 60) await A.frame();
    A.mark('joeyOut');
    await A.wait(4);
    // 媽媽散步，小袋鼠跟著
    await A.js(`(function(){const S=window.__stage.S,a=S.actors.get('ad0');a.requestActivity(7,a.walkJob(a.x-150,{gait:'walk',noPause:true}));S.kick();})()`);
    A.onFrame = async () => { const p = await A.actors(); const m = p.find((q) => q.id === 'ad0'); if (m) cx += (m.x - 40 - cx) * 0.05; };
    A.mark('follow');
    await A.wait(6);
    A.onFrame = null;
    A.mark('cut3');
    // 跟隨期 50 分鐘 → 獨立（亞成體）
    while (kid() && kid().stage === 'follow' && 60 * 60000 - phase() > 30000) { const d = tickDue() - A.VC.now() + 100; await A.skipMain(Math.max(d, 1000)); }
    await toTick(1500);
    n = 0; while (kid() && kid().stage === 'follow' && n++ < 6 * 60) await A.frame();
    A.mark('grown');
    await A.wait(5);
  }
};

// ---- 10 拎起來甩 → 頭暈 ---------------------------------------------------------------
S.dizzy = {
  screen: [640, 360], dsf: 4, cast: [0], epoch: '2026-11-25T17:40:00+08:00', bg: { windows: false },
  async run(A) {
    await A.place([['ad0', 200, -12]]); await A.hold();
    let cx = 240;
    A.views = () => [{ src: 'stage', rect: A.cam(cx, 480, 362), dst: [0, 0, 1920, 1080] }];
    A.onFrame = async () => { const q = await A.actor('ad0'); if (q) cx += (q.x - cx) * 0.08; };
    const a = await A.actor('ad0'); const hx = a.x + 40, hy = a.y - a.h * .42;
    A.curShow = true; A.cursor(hx + 180, hy - 60);
    A.start();
    for (let i = 0; i <= 24; i++) { const u = A.ease(i / 24); A.cursor(A.lerp(hx + 180, hx, u), A.lerp(hy - 60, hy, u)); await A.frame(); }
    A.curKind = 'hand'; await A.mouse('mouseMove', hx, hy); await A.mouse('mouseDown', hx, hy); A.mark('grab');
    const mv = (x, y) => { A.cursor(x, y); return A.mouse('mouseMove', x, y); };
    for (let i = 1; i <= 20; i++) { await mv(hx, hy - i * 4.5); await A.frame(); }
    A.mark('shake');
    for (let i = 0; i < 66; i++) { await mv(hx - Math.sin(i / 66 * Math.PI * 2 * 5.5) * 95, hy - 90 + Math.cos(i / 66 * Math.PI * 2 * 11) * 14); await A.frame(); }
    // 最後往右一甩、在移動中放手（程式判斷放手速度夠快＝甩出去 → 滑行 → 頭暈）
    let x = hx, y = hy - 90;
    for (let i = 0; i < 7; i++) { x += 22; y += 6; await mv(x, y); await A.frame(); }
    await A.mouse('mouseUp', x, y); A.mark('drop'); A.curKind = 'arrow';
    for (let i = 0; i <= 20; i++) { const u = A.ease(i / 20); A.cursor(A.lerp(x, x + 260, u), A.lerp(y, y - 140, u)); await A.frame(); }
    A.curShow = false;
    await A.wait(4.5);
  }
};

// ---- 11 下班：離開 → 打盹；離開時資料夾有變動；回來 → 揮手打招呼＋報告 ----------------------
const FOLDER2 = path.join(WORK, 'demo-folder2', '週報');
S.away = {
  screen: [640, 360], dsf: 4, cast: [0, 3], epoch: '2026-11-25T19:00:00+08:00', bg: {},
  settings: { awayMinutes: 1 },
  extra: () => { fs.rmSync(path.join(WORK, 'demo-folder2'), { recursive: true, force: true }); fs.mkdirSync(FOLDER2, { recursive: true }); fs.writeFileSync(path.join(FOLDER2, '草稿.txt'), '示意'); return { folders: [{ id: 'fd2', owner: 'ad3', path: FOLDER2, status: 'ok', createdAt: iso() }] }; },
  async run(A) {
    await A.place([['ad0', 250, -12], ['ad3', 410, 12]]); await A.hold();
    await A.skip(2500, 100);
    A.views = [{ src: 'stage', rect: A.cam(330, 480, 362), dst: [0, 0, 1920, 1080] }];
    A.start();
    await A.until(0.2);
    global.__idle = 61; A.mark('leave');                     // 使用者 1 分鐘沒動（設定：離開 1 分鐘）
    let n = 0; while (!(await A.js('window.__stage.S.mode')).includes('asleep') && n++ < 600) await A.frame();
    A.mark('asleep');
    await A.wait(4);
    fs.writeFileSync(path.join(FOLDER2, '週報_final.docx'), 'demo'); fs.writeFileSync(path.join(FOLDER2, '附件.pdf'), 'demo');
    A.mark('cut');
    await A.skip(9000, 250);
    A.mark('napAgain');
    await A.wait(1.5);
    global.__idle = 0; A.mark('back');
    n = 0; while ((await A.js('window.__stage.S.mode')) !== 'awake' && n++ < 600) await A.frame();
    A.mark('awake');
    await A.wait(7);
  }
};

// ---- 12 片尾：全部一起跳（慢動作）----------------------------------------------------
S.finale = {
  screen: [700, 394], dsf: 2.75, cast: [0, 1, 2, 3, 4, 5, 6], epoch: '2026-11-25T19:30:00+08:00', bg: { windows: false, icons: false },
  async run(A) {
    const ids = [6, 4, 1, 0, 3, 2, 5].map((i) => 'ad' + i);
    await A.place(ids.map((id, i) => [id, 72 + i * 93, i < 3 ? 15 : i > 3 ? -15 : 0])); await A.hold();
    A.views = [{ src: 'stage', rect: [0, 0, 700, 394], dst: [0, 0, 1920, 1080] }];
    A.start();
    await A.until(0.4); A.mark('hop');
    for (const id of ids) A.play(id, 'hop');
    await A.until(0.75); A.speed(0.35); A.mark('slow');
    await A.until(4.0); A.speed(1); A.mark('normal');
    await A.until(7.5);
  }
};
// 成片會用到的鏡頭（render_all.sh 依序算）
S.ORDER = ['hook', 'desk', 'morning', 'work', 'stock', 'talk', 'team', 'folder', 'play_bad', 'play_vb', 'play_bb2', 'play_chase', 'love', 'dizzy', 'away', 'finale'];
module.exports = S;
