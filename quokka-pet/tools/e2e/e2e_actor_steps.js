// 各項行為檢查（e2e_actor.js 呼叫）
module.exports = async ({ app, stage, send, got, st, one, ids, A, B, C, wait, ok }) => {
  const until = async (fn, ms = 20000, step = 150) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(step); } return null; };
  // 等某個狀態出現（輪詢、有逾時），不靠固定的等待時間
  const soon = (fn, ms = 4000) => until(fn, ms, 40);
  const ev = (qid, kind, payload) => send('q:event', { qid, kind, payload, prio: 2 });
  const head = (id) => stage.evaluate((id) => { const a = window.__stage.actors.get(id); return { x: a.x, y: a.y - 120 * a.k }; }, id);

  console.log('1. L2 工作反應搶佔 L7 散步');
  await stage.evaluate((id) => { const a = window.__stage.actors.get(id); a.home = a.x; a.requestActivity(7, a.walkJob()); }, B);
  ok(await soon(async () => (await one(B)).layer === 7), 'B 開始散步（L7）');
  await ev(B, 'stock', { symbol: '2454', name: '聯發科', pct: 2.2, dir: 'up', limit: null });
  let b = await soon(async () => { const x = await one(B); return x.layer === 2 && x.live && /聯發科 ▲2.2%/.test(x.text) ? x : null; });
  ok(b, `B 散步被打斷改成工作反應（L2、即時 SVG、「${b && b.text}」）`);
  ok(await stage.evaluate((id) => getComputedStyle(window.__stage.actors.get(id).bubble.textEl.querySelector('.tone-up')).color, B) === 'rgb(215, 50, 47)', '漲是紅字');

  console.log('2. 報告佇列：同類合併、間隔 1.2 秒');
  await ev(B, 'stock', { symbol: '2330', name: '台積電', pct: -3.6, dir: 'down', limit: null });
  await ev(B, 'stock', { symbol: '2317', name: '鴻海', pct: 1.5, dir: 'up', limit: null });
  await ev(B, 'folder', { name: '設計圖', count: 3 });
  await ev(B, 'folder', { name: '設計圖', count: 2 });
  const qOf = () => stage.evaluate((id) => window.__stage.actors.get(id).queue.map((x) => x.kind + ':' + x.list.length), B);
  const qk = (await soon(async () => { const q = await qOf(); return q.includes('folder:2') ? q : null; }, 3000)) || await qOf();   // IPC 是非同步的：輪詢到四則都進來
  ok(qk.length <= 2 && new Set(qk.map((x) => x.split(':')[0])).size === qk.length && qk.includes('folder:2'), `佇列同類合併（${qk.join('、')}）`);
  const tStock = await until(async () => /2 檔股票有變化/.test((await one(B)).text), 9000, 100);
  ok(tStock, '合併後報「2 檔股票有變化：…」');
  ok(await stage.evaluate((id) => !!window.__stage.actors.get(id).bubble.textEl.querySelector('.tone-down'), B), '跌是綠字（片段上色）');
  ok(await until(async () => /設計圖資料夾有 5 個檔案變了/.test((await one(B)).text), 9000, 100), '資料夾合併：「設計圖資料夾有 5 個檔案變了」');
  ok(await until(async () => { const x = await one(B); return x.layer === 8 && !x.live; }, 8000), '報完回到待機（L8，即時 SVG 已移除）');

  console.log('3. 其他工作反應');
  for (const [kind, payload, re] of [['task-added', { text: '寫週報' }, /收到/], ['task-done', { text: '寫週報', allDone: false }, /完成「寫週報」/], ['task-done', { text: 'x', allDone: true }, /全部完成/],
    ['stock', { symbol: '2330', name: '台積電', pct: 10, dir: 'up', limit: 'up' }, /台積電 漲停/], ['stock', { symbol: '2330', name: '台積電', pct: -10, dir: 'down', limit: 'down' }, /跌停/],
    ['missed', { items: ['15:30 開會', '喝水'] }, /剛剛錯過：15:30 開會、喝水/], ['note', { text: '加油！' }, /加油/], ['birth', { child: 'x', name: '小豆' }, /生了！/]]) {
    await ev(A, kind, payload);
    ok(await until(async () => re.test((await one(A)).text), 9000, 100), `${kind} → 「${(await one(A)).text}」`);
    await until(async () => (await one(A)).layer === 8, 9000);
  }

  console.log('4. L1 提醒響鈴：搶佔 L2、氣泡按鈕、可點範圍');
  await ev(A, 'note', { text: '說一句話' });
  await soon(async () => (await one(A)).layer === 2);
  await send('q:alert', { qid: A, reminderId: 'r1', text: '15:30 開會' });
  let a = await soon(async () => { const x = await one(A); return x.layer === 1 && x.bubble === 'alert' && /15:30 開會/.test(x.text) ? x : null; });
  ok(a, '響鈴（L1）搶掉工作反應，大字氣泡一直顯示');
  await ev(A, 'task-added', { text: '買牛奶' });
  a = await soon(async () => { const x = await one(A); return x.layer === 1 && x.q >= 1 ? x : null; });
  ok(a, `響鈴中來的工作反應進佇列（${a && a.q} 則）`);
  const rects = await app.evaluate(({ }) => 0).then(() => stage.evaluate(() => { const r = []; for (const a of window.__stage.actors.values()) { const b = a.bubble.clickRect(); if (b) r.push(b); } return r; }));
  ok(rects.length === 1 && rects[0].w > 100, '提醒氣泡回報在可點範圍內');
  await wait(1200);
  a = await one(A);
  ok(a.layer === 1 && a.bubble === 'alert', '響 1.2 秒後氣泡還在');
  await stage.click('.bubble.alert.show button[data-act="snooze"]');
  ok(await soon(async () => (await got('alert:snooze')).some((g) => g.p.reminderId === 'r1')), '按「5 分後」送出 alert:snooze{r1}');
  ok(await until(async () => /收到/.test((await one(A)).text), 6000, 100), '收掉後接著報佇列（收到！）');
  await until(async () => (await one(A)).layer === 8, 8000);
  await send('q:alert', { qid: A, reminderId: 'r2', text: '喝水' });
  await soon(async () => (await one(A)).layer === 1 && stage.evaluate(() => !!document.querySelector('.bubble.alert.show')));
  // 拖曳時氣泡跟著走；放手後繼續響
  const h = await head(A);
  const bx0 = await stage.evaluate(() => document.querySelector('.bubble.alert.show').getBoundingClientRect().x);
  await stage.mouse.move(h.x, h.y); await stage.mouse.down();
  for (let i = 1; i <= 10; i++) { await stage.mouse.move(h.x - i * 15, h.y - i * 3); await wait(40); }
  ok(await soon(async () => { const x = await one(A); return x.layer === 0 && x.state === 'drag'; }, 2000), '拖曳（L0）搶掉響鈴');
  const bx1 = await stage.evaluate(() => document.querySelector('.bubble.alert.show').getBoundingClientRect().x);
  ok(Math.abs(bx1 - bx0) > 50, `氣泡跟著走（${Math.round(bx0)} → ${Math.round(bx1)}）`);
  await wait(300); await stage.mouse.up();
  ok(await until(async () => (await one(A)).layer === 1, 3000), '慢慢放手 → 跳一下 → 繼續響（L1）');
  ok(await soon(async () => (await got('stage:save-pos')).some((g) => g.p.id === A)), '放手存位置（stage:save-pos；q:drop 主行程沒接，已拿掉）');
  ok(!(await got('q:drop')).length, '不再送沒人接的 q:drop');
  await stage.click('.bubble.alert.show .bubble-text');
  ok(await soon(async () => (await got('alert:ack')).some((g) => g.p.reminderId === 'r2')), '點氣泡本體＝知道了（alert:ack{r2}）');
  await soon(async () => (await one(A)).layer === 8);
  await send('q:alert', { qid: A, reminderId: 'r3', text: '測試收掉' });
  await soon(async () => (await one(A)).layer === 1);
  await send('q:alert-clear', { qid: A, reminderId: 'r3' });
  ok(await soon(async () => { const x = await one(A); return x.layer === 8 && !x.bubble; }), 'q:alert-clear 收掉提醒');
  // 4a. 同時好幾個提醒在響（規格 4.1）：氣泡列出全部，每一則各自按掉；太多時列前 3 則＋「還有 N 則」
  for (const [rid, text] of [['m1', '開會'], ['m2', '喝水'], ['m3', '伸展'], ['m4', '回信'], ['m5', '吃藥']]) { await send('q:alert', { qid: A, reminderId: rid, text }); await wait(60); }
  const rows = () => stage.evaluate(() => { const b = document.querySelector('.bubble.alert.show'); return b ? { rows: [...b.querySelectorAll('.alert-row .alert-text')].map((e) => e.textContent), btn: b.querySelectorAll('button[data-rid]').length, more: (b.querySelector('.alert-more') || {}).textContent || '' } : null; });
  let r = await soon(async () => { const v = await rows(); return v && v.rows.length === 3 ? v : null; });
  ok(r && r.rows.join('|') === '⏰ 開會|⏰ 喝水|⏰ 伸展' && r.btn === 6 && /還有 2 則/.test(r.more), `5 個提醒同時響：列出前 3 則、每則各有兩個按鈕、最後寫「還有 2 則」（${JSON.stringify(r)}）`);
  await stage.click('.bubble.alert.show button[data-rid="m2"][data-act="ack"]');
  ok(await soon(async () => (await got('alert:ack')).some((g) => g.p.reminderId === 'm2')), '按第二則的「知道了」：只送 alert:ack{m2}');
  r = await soon(async () => { const v = await rows(); return v && !v.rows.includes('⏰ 喝水') ? v : null; });
  ok(r && r.rows.join('|') === '⏰ 開會|⏰ 伸展|⏰ 回信' && /還有 1 則/.test(r.more) && (await one(A)).alerts === 4, `按掉一則：其他照樣在響、後面的遞補上來（${JSON.stringify(r)}）`);
  await stage.click('.bubble.alert.show button[data-rid="m4"][data-act="snooze"]');
  ok(await soon(async () => (await got('alert:snooze')).some((g) => g.p.reminderId === 'm4')), '按某一則的「5 分後」：只送 alert:snooze{m4}');
  for (const rid of ['m1', 'm3', 'm5']) await send('q:alert-clear', { qid: A, reminderId: rid });
  ok(await soon(async () => { const x = await one(A); return x.layer === 8 && !x.bubble && x.alerts === 0; }), '全部按掉／收掉：氣泡收起、回到待機');

  console.log('4b. 拖曳中 mouseup 遺失 → 再按一下：舊的拖曳要結束、不能卡在 drag=true、不能丟例外');
  {
    await until(async () => (await one(C)).layer === 8, 8000);
    const r = await stage.evaluate(async (id) => {
      const a = window.__stage.actors.get(id), errs = [];
      const onErr = (e) => errs.push(String(e.message || e)); window.addEventListener('error', onErr);
      const ev = (t, x, y, b) => new MouseEvent(t, { button: 0, buttons: b, bubbles: true, clientX: x, clientY: y });
      const x = a.x, y = a.y - 40 * a.k;
      a.el.dispatchEvent(ev('mousedown', x, y, 1));
      for (let i = 1; i <= 5; i++) { window.dispatchEvent(ev('mousemove', x + i * 6, y, 1)); await new Promise((r) => setTimeout(r, 20)); }
      const dragging1 = a.dragging, yBefore = a.y;
      window.dispatchEvent(ev('mousemove', 640, 100, 0));                 // 視窗切換時 Chromium 補的 buttons=0 合成事件（座標是舊的）：不能拿來移動
      const jump = Math.abs(a.y - yBefore);
      window.dispatchEvent(ev('mousemove', x + 30, y, 1));
      // mouseup 遺失，使用者在原地再按一下、放開
      a.el.dispatchEvent(ev('mousedown', x + 30, y, 1));
      const afterSecondDown = a.dragging;
      window.dispatchEvent(ev('mouseup', x + 30, y, 0));
      await new Promise((r) => setTimeout(r, 50));
      // 再按一次、拖一下、cancelDrag（鎖定）→ 也要放下
      a.el.dispatchEvent(ev('mousedown', x + 30, y, 1));
      for (let i = 1; i <= 4; i++) { window.dispatchEvent(ev('mousemove', x + 30 + i * 8, y, 1)); await new Promise((r) => setTimeout(r, 20)); }
      const dragging3 = a.dragging;
      a.cancelDrag(); a.cancelDrag();
      const afterCancel = a.dragging;
      window.dispatchEvent(ev('mouseup', x, y, 0));                     // 遲到的 mouseup：不能出錯
      window.removeEventListener('error', onErr);
      return { dragging1, afterSecondDown, dragging3, afterCancel, errs, pressing: a.pressing(), jump };
    }, C);
    ok(r.dragging1 && r.dragging3, '拖得起來（拖曳中 dragging=true）');
    ok(r.jump < 1, `拖曳中收到 buttons=0 的合成 mousemove：不跟著瞬移（位移 ${r.jump} px）`);
    ok(!r.afterSecondDown, `再按一下就先放下舊的拖曳（${JSON.stringify(r)}）`);
    ok(!r.afterCancel && !r.pressing, 'cancelDrag 一定放下、沒有殘留的監聽');
    ok(!r.errs.length, '沒有 TypeError 等例外');
    await wait(1500);
    const main = await app.evaluate(() => { const st = [...global.v2.stage.stages.values()][0]; return { dragging: st.dragging, ignoring: st.ignoring }; });
    ok(!main.dragging, `主行程不再認為在拖曳（${JSON.stringify(main)}）`);
    // 放手的程式出錯也不能卡住
    const r2 = await stage.evaluate(async (id) => {
      const a = window.__stage.actors.get(id);
      const ev = (t, x, y, b) => new MouseEvent(t, { button: 0, buttons: b, bubbles: true, clientX: x, clientY: y });
      const x = a.x, y = a.y - 40 * a.k;
      a.el.dispatchEvent(ev('mousedown', x, y, 1));
      for (let i = 1; i <= 5; i++) { window.dispatchEvent(ev('mousemove', x + i * 6, y, 1)); await new Promise((r) => setTimeout(r, 20)); }
      const j = a.job; if (j && j.name === 'drag') j.release = () => { throw new Error('測試：放手出錯'); };
      const orig = console.warn; console.warn = () => {};
      window.dispatchEvent(ev('mouseup', x + 30, y, 0));
      console.warn = orig;
      await new Promise((r) => setTimeout(r, 50));
      return { dragging: a.dragging, pressing: a.pressing(), job: a.job && a.job.name };
    }, C);
    ok(!r2.dragging && !r2.pressing, `放手時出錯也會解除拖曳（${JSON.stringify(r2)}）`);
    await wait(1500);
    const main2 = await app.evaluate(() => { const st = [...global.v2.stage.stages.values()][0]; return { dragging: st.dragging }; });
    ok(!main2.dragging, '主行程的拖曳狀態也解除');
    await until(async () => (await one(C)).layer === 8, 8000);
  }

  console.log('5. L0 甩出 → 滑行 → 頭暈');
  await stage.evaluate(() => { for (const a of window.__stage.actors.values()) { a.nextAt = performance.now() + 1e9; a.idleAt = performance.now() + 1e9; } });   // 被拖過的那隻 8 秒後會自己散步：先叫大家都別動
  await until(async () => (await st()).every((x) => x.layer === 8), 15000);
  await until(async () => (await one(B)).layer === 8, 6000);              // 上一段放下時離別隻太近會自己跳開：等牠停好再拎
  const h2 = await head(B);
  const hitAt = await stage.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); const a = e && e.closest('.actor'); return e ? (e.tagName + '.' + e.className + (a ? ' in ' + a.getAttribute('aria-label') : '')) : null; }, [h2.x, h2.y]);
  await stage.mouse.move(h2.x, h2.y); await stage.mouse.down();
  for (let i = 1; i <= 6; i++) { await stage.mouse.move(h2.x - i * 8, h2.y); await wait(30); }
  const dragInfo = await stage.evaluate((id) => { const a = window.__stage.actors.get(id); return { job: a.job && a.job.name, dragging: a.dragging, x: Math.round(a.x) }; }, B);
  if (!dragInfo.dragging) console.log('     拎不起來：', hitAt, JSON.stringify(dragInfo), JSON.stringify(h2), JSON.stringify((await st()).map((q) => [q.name, q.x, q.y, q.state])));
  for (let i = 1; i <= 4; i++) await stage.mouse.move(h2.x - 48 - i * 80, h2.y - i * 10);   // 快速連續移動（不等待）：機器忙時也算得出是甩出去
  const nSave0 = (await got('stage:save-pos')).filter((g) => g.p.id === B).length, tUp = Date.now();
  await stage.mouse.up();
  ok(await soon(() => stage.evaluate((id) => { const j = window.__stage.actors.get(id).job; return !!(j && (j.fling || (j.after && j.after.line))); }, B), 1500), '甩出去 → 滑行減速（不是慢慢放下的落地）');
  { const sv = await soon(async () => { const L = (await got('stage:save-pos')).filter((g) => g.p.id === B).slice(nSave0); return L.length ? L : null; }, 1000);
    const jobNow = await stage.evaluate((id) => { const j = window.__stage.actors.get(id).job; return j && j.name; }, B);
    ok(sv && sv[0].t - tUp < 600 && jobNow === 'drag', `甩出去：放手當下就先用預計的落點存位置（${sv ? sv[0].t - tUp : '?'} ms，還在滑行／頭暈中，x=${sv && sv[0].p.pos.x}）`); }
  ok(await until(async () => { const x = await one(B); return x.layer === 0 && x.live; }, 2000, 50), '落地頭暈（還在 L0、即時繪製）');
  ok(await until(async () => /頭好暈/.test((await one(B)).text), 5000, 100), '頭暈 2.6 秒後說「頭好暈……」');
  ok((await got('q:rest')).some((g) => g.p.qid === B), '結束送 q:rest');
  { const L = (await got('stage:save-pos')).filter((g) => g.p.id === B).slice(nSave0), x = (await one(B)).x;
    ok(L.length >= 2 && Math.abs(L[L.length - 1].p.pos.x - x) <= 1 && Math.abs(L[0].p.pos.x - x) < 40, `甩出去：停下來再存一次（共 ${L.length} 次；預計 ${L[0] && L[0].p.pos.x}、實際 ${x}）`); }

  console.log('6. L3 使用者叫的：單擊摸頭、雙擊、右鍵、陪我玩');
  await until(async () => (await one(B)).layer === 8, 5000);
  const h3 = await head(B);
  await stage.mouse.click(h3.x, h3.y);
  ok(await until(async () => (await one(B)).layer === 3, 1500, 50), '單擊（等 0.25 秒確認不是雙擊）→ 摸頭（L3）');
  await until(async () => (await one(B)).layer === 8, 4000);
  await stage.mouse.dblclick(h3.x, h3.y);
  ok(await soon(async () => (await got('q:dblclick')).some((g) => g.p.qid === B)), '雙擊送 q:dblclick');
  await stage.mouse.click(h3.x, h3.y, { button: 'right' });
  ok(await soon(async () => (await got('q:context')).some((g) => g.p.qid === B)), '右鍵送 q:context');
  await until(async () => (await st()).every((x) => x.layer === 8 && !x.live), 6000);   // 等別隻的動作（例如被放下後跳開）都結束
  await send('q:play', { qid: B, action: 'eat' });
  ok(await soon(async () => { const x = await one(B); return x.layer === 3 && x.live && x.state === 'play:eat'; }), '陪我玩（吃葉子）：L3、只有這隻換成即時 SVG');
  { const lv = (await st()).filter((x) => x.live && (x.id === B || x.layer === 8)); if (lv.length !== 1) console.log('     live:', JSON.stringify(lv.map((x) => [x.name, x.state, x.layer]))); ok(lv.length === 1, '其他待機的隻沒有即時 SVG（正在走路的那隻起步／停下站起來時的姿勢混合會短暫用即時 SVG）'); }
  await ev(B, 'note', { text: '工作優先' });
  ok(await soon(async () => (await one(B)).layer === 2), '工作反應（L2）搶掉陪我玩（L3）');
  await until(async () => (await one(B)).layer === 8, 8000);
  ok(!(await one(B)).live, '播完換回 PNG 待機圖');

  console.log('7. L4 撿球：籃球、排球（一律抱回來，不再用鼻子推）');
  await stage.evaluate(() => { for (const a of window.__stage.actors.values()) { a.nextAt = performance.now() + 1e9; a.idleAt = performance.now() + 1e9; } });   // 被拖過的那隻 8 秒後會自己散步：先叫大家都別動
  await until(async () => (await st()).every((x) => x.layer === 8), 15000);
  for (const [action, ret] of [['basketball', 'carry'], ['volleyball', 'carry']]) {
    await send('stage:settings', { fetchReturn: ret });
    await stage.evaluate((id) => { const a = window.__stage.actors.get(id); a.x = 640; a.place(); }, C);
    const x0 = (await one(C)).x;
    await send('q:play', { qid: C, action });
    ok(await until(async () => (await one(C)).ball, 4000, 50), `${action}：出手時舞台裡產生球`);
    const stopped = await until(async () => { const c = await one(C); return c.ball && c.ball.stopped ? c : null; }, 15000, 100);
    ok(stopped, `球停下來（x=${stopped && stopped.ball.x}，主人在 ${x0}）`);
    ok(await until(async () => (await one(C)).layer === 4, 4000, 50), '去撿球（L4）');
    const phases = new Set(); let sayPhase = null;
    const trail = [];
    const back = await until(async () => { const [p, said] = await stage.evaluate((id) => { const a = window.__stage.actors.get(id); return [a.job && a.job.phase, a.bubble.kind && /撿/.test(a.bubble.textEl.textContent)]; }, C);   // 階段和氣泡同一次讀（分兩次讀會剛好跨過換階段的那一格）
      if (sayPhase == null && said) sayPhase = p || 'after-job'; if (p) { phases.add(p); const c0 = await one(C); if (!trail.length || trail[trail.length - 1][0] !== p) trail.push([p, c0.x]); } const c = await one(C); if (sayPhase == null && /撿/.test(c.text) && c.bubble) sayPhase = p || 'after-job'; return c.layer === 8 ? c : null; }, 30000, 60);
    if (action === 'volleyball') ok(sayPhase === 'homeHug' || sayPhase === 'homeToss', `排球撿回來說話的時候球抱在手上（說話時的階段：${sayPhase}）`);
    ok(back && Math.abs(back.x - x0) < 4, `撿回原位（${back && back.x} ≈ ${x0}）`);
    if (!(back && Math.abs(back.x - x0) < 4)) console.log('     路線：', JSON.stringify(trail), JSON.stringify((await st()).map((q) => [q.name, q.x, q.state])));
    console.log('     經過的階段：', [...phases].join(' → '));
    const nearHome = Math.abs(stopped.ball.x - x0) < 130;          // 球就停在腳邊：不用走回程
    ok((phases.has('carry') || nearHome) && phases.has('sniff') && phases.has('sit'), `有伸爪搭球、坐起來抱球、回程抱著走${nearHome ? '（球就在旁邊，不用走）' : ''}`);
    ok(await until(async () => !(await one(C)).ball, 2000), '到家後球收走');
  }
  // 撿球途中被拖走 → 球淡出
  await stage.evaluate((id) => { const a = window.__stage.actors.get(id); a.x = 640; a.place(); }, C);
  await send('q:play', { qid: C, action: 'basketball' });
  await until(async () => (await one(C)).layer === 4, 15000, 100);
  await wait(800);
  const h4 = await head(C);
  await stage.mouse.move(h4.x, h4.y); await stage.mouse.down();
  for (let i = 1; i <= 6; i++) { await stage.mouse.move(h4.x, h4.y - i * 6); await wait(30); }
  ok(await soon(async () => !(await one(C)).ball && stage.evaluate(() => !!document.querySelector('.ball.fade')), 2000), '撿球途中被拖走：球淡出');
  await stage.mouse.up();
  await until(async () => (await one(C)).layer === 8, 4000);

  console.log('8. 游標：看左看右、停很久湊過去聞');
  await app.evaluate(() => global.v2.stage.pause(true));          // 先停掉主行程的真實游標偵測，改由測試送座標
  const ax = (await one(A)).x, ay = (await one(A)).y;
  await send('stage:cursor', { x: ax - 200, y: ay - 120 });
  ok(await soon(async () => (await stage.evaluate((id) => window.__stage.actors.get(id).lookBucket, A)) === 'L', 2000), '游標在左 → 看左圖');
  await send('stage:cursor', { x: ax + 200, y: ay - 120 });
  ok(await soon(async () => (await stage.evaluate((id) => window.__stage.actors.get(id).lookBucket, A)) === 'R', 2000), '游標在右 → 看右圖');
  ok(!(await one(A)).live, '看游標不重畫（只換圖）');
  await stage.evaluate((id) => { const a = window.__stage.actors.get(id); if (a.beh) a.beh.sniffDelayMs = 600; }, A);
  let sniffed = null;
  for (let i = 0; i < 20 && !sniffed; i++) { await send('stage:cursor', { x: ax + 120, y: ay - 120 }); await wait(100); const s = (await one(A)).state; if (s === 'sniff' || s === 'shy') sniffed = s; }
  ok(sniffed, `游標停很久 → ${sniffed === 'shy' ? '膽小：害羞轉開' : '湊過去聞'}`);
  await send('stage:cursor', { x: -9999, y: -9999 });
  await app.evaluate(() => global.v2.stage.pause(false));
  await until(async () => (await one(A)).layer === 8, 5000);

  console.log('9. 社交（簡化版）：social:start → 走過去 → 碰鼻 → social:done；被拖走 → social:abort');
  await stage.evaluate(([a, b, c]) => { const A = window.__stage.actors.get(a), B = window.__stage.actors.get(b), C = window.__stage.actors.get(c); A.x = 300; A.y = B.y = C.y = innerHeight - 7; B.x = 700; C.x = 1120; A.place(); B.place(); C.place(); }, [A, B, C]);   // 第三隻移開：互動走位的路上有別隻會取消（不穿過）；地面高度用視窗高度算（原本寫死 713＝只適用 720 高的螢幕）
  await send('social:start', { pairId: 'p1', a: A, b: B, type: 'nose', initiator: A });
  ok(await soon(async () => (await one(A)).layer === 5 && (await one(B)).layer === 5), '兩隻都進 L5');
  const doneP = await until(async () => (await got('social:done')).find((g) => g.p.pairId === 'p1'), 15000, 150);
  ok(doneP, '走到對方前方、碰鼻 2 秒後送 social:done');
  const dist = Math.abs((await one(A)).x - (await one(B)).x);
  ok(dist > 90 && dist <= 135, `停在禮貌距離（90–135，與 e2e_social 相同）（${dist} px）`);
  await until(async () => (await one(A)).layer === 8 && (await one(B)).layer === 8, 4000);
  await send('social:start', { pairId: 'p2', a: B, b: A, type: 'cuddle', initiator: B });
  await wait(400);
  await send('q:alert', { qid: A, reminderId: 'r9', text: '中斷社交' });
  const ab = await until(async () => (await got('social:abort')).find((g) => g.p.pairId === 'p2'), 3000);
  ok(ab && ab.p.by === A && ab.p.reason === 'alert', `被提醒打斷 → social:abort{by:A, reason:${ab && ab.p.reason}}`);
  ok(await until(async () => (await one(B)).layer === 8, 2000, 50), '夥伴收尾（0.5–0.8 秒）後回待機');
  await send('q:alert-clear', { qid: A, reminderId: 'r9' });
  ok((await got('q:pos')).length > 0, `有送 q:pos（${(await got('q:pos')).length} 次）`);
  await stage.evaluate(([a, b]) => { const A = window.__stage.actors.get(a), B = window.__stage.actors.get(b); A.x = 500; B.x = 610; A.place(); B.place(); A.checkPass(); A.checkPass(); }, [A, B]);
  await soon(async () => (await got('q:pass')).length > 0, 2000); await wait(150);
  ok((await got('q:pass')).filter((g) => [g.p.a, g.p.b].sort().join() === [A, B].sort().join()).length === 1, '散步經過送 q:pass（同一對每天一次）');

  console.log('10. 離開電腦：全部睡、提醒照響、回來錯開報告');
  await send('presence', { away: true, sleep: true });
  ok(await soon(async () => (await st()).every((x) => x.state === 'sleep' && x.layer === 8)), '全部睡著（閉眼待機圖＋CSS zZ）');
  let all = await st();
  ok(await stage.evaluate(() => [...document.querySelectorAll('.actor.asleep .zz')].length) === all.length, 'zZ 用 CSS 動畫');
  await ev(B, 'stock', { symbol: '2330', name: '台積電', pct: -3.6, dir: 'down', limit: null });
  b = (await soon(async () => { const x = await one(B); return x.q === 1 ? x : null; }, 3000)) || await one(B);
  ok(b.layer === 8 && b.q === 1 && !b.bubble, '睡著時工作反應只記錄不演出');
  await send('q:alert', { qid: C, reminderId: 'r5', text: '吃藥' });
  ok(await soon(async () => { const s2 = await st(); return s2.find((x) => x.id === C).layer === 1 && s2.filter((x) => x.state === 'sleep').length === 2; }), '提醒照響：那一隻醒來響，其他繼續睡');
  await stage.click('.bubble.alert.show button[data-act="ack"]');
  ok(await soon(async () => (await one(C)).state === 'sleep'), '按掉後又睡回去');
  await send('presence', { away: false, digest: [{ qid: A, items: ['15:30 開會'] }] });
  const t0 = Date.now(), seen = {};
  await until(async () => { for (const x of await st()) if (x.layer === 2 && !seen[x.id]) seen[x.id] = Date.now() - t0; return Object.keys(seen).length >= 2; }, 6000, 50);
  ok(seen[A] != null && seen[B] != null, `有事要報告的兩隻揮手報告（A ${seen[A]} ms、B ${seen[B]} ms）`);
  ok(Math.abs(seen[A] - seen[B]) >= 600, '錯開約 0.8 秒');
  ok(await until(async () => /剛剛錯過：15:30 開會/.test((await one(A)).text), 8000, 100), 'A 報「剛剛錯過：15:30 開會」');
  ok(await until(async () => /台積電 ▼3.6%/.test((await one(B)).text), 8000, 100), 'B 報睡著時記下的股價');
  ok(seen[C] == null, '沒事的只醒過來');

  console.log('11. 效率：全部待機時不跑動畫迴圈');
  await until(async () => (await st()).every((x) => x.layer === 8), 10000);
  ok(await soon(async () => !(await stage.evaluate(() => window.__stage.running())) && (await st()).every((x) => x.layer === 8), 8000), '待機時沒有 requestAnimationFrame');
  ok((await st()).every((x) => !x.live), '沒有即時 SVG');
  const layers = (await got('q:state')).map((g) => g.p.layer);
  ok([0, 1, 2, 3, 4, 5, 8].every((l) => layers.includes(l)), `q:state 回報各層（${[...new Set(layers)].sort().join(',')}）`);
};
