// 動畫資料的健全性測試：取樣不出現 NaN／undefined、畫得出來、常駐層可重現、事件還在
const test = require('node:test');
const assert = require('node:assert');
const A = require('../renderer/quokka-anim.js');
const Q = require('../renderer/quokka-pose.js');

// 遞迴檢查：數字都是有限值、沒有 undefined 的必要欄位
function checkFinite(v, path) {
  if (typeof v === 'number') assert.ok(Number.isFinite(v), `${path} 不是有限數字：${v}`);
  else if (Array.isArray(v)) v.forEach((x, i) => { assert.notStrictEqual(x, undefined, `${path}[${i}] 是 undefined`); checkFinite(x, `${path}[${i}]`); });
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) checkFinite(v[k], `${path}.${k}`);
}
function checkPose(th, pose, name) {
  assert.ok(Number.isFinite(th), `${name} th`);
  for (const k of ['x', 'y', 'sq', 'lean', 'roll', 'tailUp']) if (k in pose) assert.ok(Number.isFinite(pose[k]), `${name} pose.${k}＝${pose[k]}`);
  for (const k of ['eyes', 'mouth']) if (k in pose) assert.strictEqual(typeof pose[k], 'string', `${name} pose.${k}`);
  for (const k of ['L', 'R']) if (pose.arms && pose.arms[k]) { assert.ok(Array.isArray(pose.arms[k].hand) && pose.arms[k].hand.length === 3, `${name} arms.${k}.hand`); }
  checkFinite({ ...pose, props: (pose.props || []).map((p) => ({ ...p, s: typeof p.s === 'string' ? 1 : p.s })) }, name);
}
const allKeyed = () => {
  const out = [];
  for (const [g, set] of [['ANIMS', A.ANIMS], ['REACT', A.REACT], ['IDLE', A.IDLE], ['ALERT', { ring: A.ALERT.ring, quiet: A.ALERT.quiet }]]) for (const k of Object.keys(set)) out.push([`${g}.${k}`, set[k]]);
  return out;
};

test('所有關鍵影格動畫：格式正確、關鍵姿勢時間遞增', () => {
  for (const [name, a] of allKeyed()) {
    assert.ok(a.dur > 0, name + ' dur');
    assert.ok(Array.isArray(a.keys) && a.keys.length >= 2, name + ' keys');
    assert.strictEqual(a.keys[0].t, 0, name + ' 第一格 t＝0');
    assert.ok(Math.abs(a.keys[a.keys.length - 1].t - a.dur) < 1e-6, name + ' 最後一格 t＝dur');
    for (let i = 1; i < a.keys.length; i++) assert.ok(a.keys[i].t > a.keys[i - 1].t, `${name} 第 ${i} 格時間沒有遞增（${a.keys[i - 1].t} → ${a.keys[i].t}）`);
  }
});

test('所有動畫每 1/30 秒取樣：沒有 NaN／undefined，render() 不丟例外', () => {
  let n = 0;
  for (const [name, a] of allKeyed()) {
    for (let i = 0; i <= Math.ceil(a.dur * 30); i++) {
      const t = Math.min(a.dur, i / 30), s = A.sample(a, t), st = { thrown: (a.events || []).some((e) => t >= e.t) };
      s.pose.props = a.props ? a.props(t, st) : [];
      checkPose(s.th, s.pose, `${name}@${t.toFixed(2)}`);
      // 每 3 格實際畫一次（全畫太慢）
      if (i % 3 === 0) { const r = Q.render(s.th, 't', s.pose); assert.ok(r.svg.length > 100 && !/NaN|undefined/.test(r.svg), `${name}@${t.toFixed(2)} 畫出來有 NaN／undefined`); n++; }
    }
  }
  assert.ok(n > 300);
});

test('撿球、步態：每個階段取樣正常、畫得出來，鏡射後也一樣', () => {
  const F = A.FETCH2;
  for (const ph of Object.keys(F)) {
    if (typeof F[ph] !== 'function') continue;
    for (const kind of ['vball', 'bball']) for (let i = 0; i <= 12; i++) {
      for (const fr of [F[ph](i / 12, kind), A.mirrorFrame(F[ph](i / 12, kind))]) {
        checkPose(fr.th, fr.pose, `FETCH2.${ph}@${i}`);
        const r = Q.render(fr.th, 't', fr.pose); assert.ok(!/NaN|undefined/.test(r.svg), `FETCH2.${ph}@${i}`);
      }
    }
  }
  for (const k of ['hop', 'reach', 'carry']) for (let i = 0; i <= 10; i++) { const p = A.FETCH[k](i / 10); checkPose(0, p, `FETCH.${k}`); Q.render(-90, 't', p); }
  for (const g of ['walk', 'hop', 'dash']) {
    let prev = 0;
    for (let i = 0; i <= 30; i++) {
      const fr = A.GAIT[g](i / 30);
      checkPose(fr.th, fr.pose, `GAIT.${g}@${i}`);
      assert.ok(fr.advance >= prev - 1e-9 && fr.advance >= 0 && fr.advance <= 1, `GAIT.${g} advance 要單調 0→1`);
      prev = fr.advance;
      assert.ok(!/NaN|undefined/.test(Q.render(fr.th, 't', fr.pose).svg));
    }
    assert.strictEqual(A.GAIT[g](0).advance, 0); assert.strictEqual(A.GAIT[g](1).advance, 1);
    assert.ok(A.GAIT.info[g].dur > 0 && A.GAIT.info[g].stride > 0);
  }
});

test('走路不滑步：前爪撐地的那一段，前爪在地面上的位置幾乎不動', () => {
  const I = A.GAIT.info.walk, xs = [];
  for (let u = I.plant[0] + .02; u <= I.plant[1]; u += .02) {
    const fr = A.GAIT.walk(u), h = Q.render(fr.th, 't', { ...fr.pose, accessory: 'none' }).hands;
    xs.push(h.R.X - I.stride * fr.advance);                              // 往左走：身體位移 −stride×advance
  }
  const slip = Math.max(...xs) - Math.min(...xs);
  assert.ok(slip < 2.5, `前爪滑動 ${slip.toFixed(2)} 單位（要小於 2.5）`);
  // 前半步後腳不動：advance 維持 0
  for (let u = 0; u < I.plant[0]; u += .05) assert.strictEqual(A.GAIT.walk(u).advance, 0);
});

test('走路（五足步態）：後腳有離地擺盪相位，腳在地上時不滑步，一步剛好前進 stride', () => {
  const I = A.GAIT.info.walk, before = [], after = [];
  let lift = 0, seenAir = false;
  for (let i = 0; i <= 200; i++) {
    const fr = A.GAIT.walk(i / 200), p = fr.pose, fs = p.footShift || [0, 0, 0];
    const h = -(p.y || 0) + (fs[1] || 0);                                // 後腳離地高度
    const x = (p.x || 0) - I.stride * fr.advance - fs[0] / Math.sqrt(p.sq || 1);   // 後腳在地面上的位置（往左走為負）
    lift = Math.max(lift, h);
    if (h > .3) seenAir = true; else (seenAir ? after : before).push(x);
    if (h > .3) assert.ok(i / 200 > I.plant[0] && i / 200 < I.plant[1], '後腳只在前爪撐地的那一段離地');
  }
  assert.ok(lift >= 8, `後腳離地高度 ${lift.toFixed(1)}（要看得出來，至少 8 單位）`);
  const span = (a) => Math.max(...a) - Math.min(...a);
  assert.ok(before.length > 50 && after.length > 10);
  assert.ok(span(before) < .8, `離地前後腳滑了 ${span(before).toFixed(2)}`);
  assert.ok(span(after) < .8, `落地後後腳滑了 ${span(after).toFixed(2)}`);
  assert.ok(Math.abs((before[0] - after[after.length - 1]) - I.stride) < .5, '後腳一步的落點要剛好前進 stride');
  // 連續走：一步結束的姿勢＝下一步開始的姿勢
  const a = A.GAIT.walk(0).pose, b = A.GAIT.walk(1).pose;
  for (const k of ['x', 'y', 'lean', 'sq']) assert.ok(Math.abs(a[k] - b[k]) < 1e-6, `walk 首尾 ${k} 不連續`);
  assert.ok(Math.abs(a.footShift[0] - b.footShift[0]) < 1e-6 && Math.abs(a.arms.R.hand[2] - b.arms.R.hand[2]) < 1e-6);
});

test('小跳：前爪與耳朵跟著節奏動，首尾相接', () => {
  const ys = [], es = [];
  for (let i = 0; i <= 20; i++) { const p = A.GAIT.hop(i / 20).pose; ys.push(p.arms.L.hand[1]); es.push(p.earFlop.L); }
  assert.ok(Math.max(...ys) - Math.min(...ys) > 10, '前爪要有上下動作');
  assert.ok(Math.max(...es) - Math.min(...es) > 10, '耳朵要有甩動');
  const a = A.GAIT.hop(0).pose, b = A.GAIT.hop(1).pose;
  assert.ok(Math.abs(a.arms.L.hand[1] - b.arms.L.hand[1]) < 1e-6 && Math.abs(a.sq - b.sq) < 1e-6);
});

test('三種球的事件（丟球時間點）還在，欄位沒變', () => {
  assert.deepStrictEqual(Object.keys(A.ANIMS).sort(), ['badminton', 'basketball', 'volleyball']);
  const v = A.ANIMS.volleyball.events.find((e) => e.name === 'throw'), b = A.ANIMS.basketball.events.find((e) => e.name === 'throw');
  assert.ok(v && v.kind === 'vball' && v.t > 0 && v.t < A.ANIMS.volleyball.dur && Array.isArray(v.from));
  assert.ok(b && b.kind === 'bball' && b.fromHand === true && b.t > 0 && b.t < A.ANIMS.basketball.dur);
  assert.ok(!A.ANIMS.badminton.events || !A.ANIMS.badminton.events.length);
  assert.strictEqual(typeof A.ANIMS.badminton.endLine, 'string');
});

test('羽球：擊球那一格球在拍面上；排球：觸球那一格球在雙手上方', () => {
  const B = A.ANIMS.badminton, s = A.sample(B, B.hitT), props = B.props(B.hitT + .01, {});
  const hands = Q.render(s.th, 't', { ...s.pose, accessory: 'none' }).hands;
  const rk = props.find((p) => p.t === 'racket'), sh = props.find((p) => p.t === 'shuttle');
  const head = [hands.R.palm[0] + 40.5 * Math.sin(rk.ang * Math.PI / 180), hands.R.palm[1] - 40.5 * Math.cos(rk.ang * Math.PI / 180)];
  assert.ok(Math.hypot(head[0] - sh.at[0], head[1] - sh.at[1]) < 6, `球離拍面中心 ${Math.hypot(head[0] - sh.at[0], head[1] - sh.at[1]).toFixed(1)}`);
  // 來球從面向的那一側（左邊）進場
  const first = B.props(.2, {}).find((p) => p.t === 'shuttle');
  assert.ok(first.at[0] < sh.at[0] - 60, '羽球要從左邊飛來');
  const V = A.ANIMS.volleyball, sv = A.sample(V, V.hitT), hv = Q.render(sv.th, 't', { ...sv.pose, accessory: 'none' }).hands;
  const ball = V.props(V.hitT, { thrown: false }).find((p) => p.t === 'vball');
  const mid = [(hv.L.X + hv.R.X) / 2, (hv.L.Y + hv.R.Y) / 2];
  assert.ok(Math.hypot(ball.at[0] - mid[0], ball.at[1] - mid[1]) < 16, '排球要落在手上');
  assert.ok(V.props(.2, {}).find((p) => p.t === 'vball').at[0] < ball.at[0] - 60, '排球要從左邊飛來');
  // 球的軌跡連續（不瞬移）：相鄰兩格位移有上限
  for (const [anim, kind, lim] of [[B, 'shuttle', 30], [V, 'vball', 18]]) {
    let prev = null;
    for (let t = .1; t < anim.dur; t += 1 / 30) {
      const p = anim.props(t, { thrown: kind === 'vball' && t >= V.events[0].t }).find((q) => q.t === kind);
      if (p && prev) assert.ok(Math.hypot(p.at[0] - prev.at[0], p.at[1] - prev.at[1]) < lim, `${kind} 在 t=${t.toFixed(2)} 跳了 ${Math.hypot(p.at[0] - prev.at[0], p.at[1] - prev.at[1]).toFixed(1)}`);
      prev = p || null;
    }
  }
});

test('籃球：框高於跳起來的頭頂；aim() 算出的初速會進框', () => {
  const K = A.ANIMS.basketball, H = K.hoop;
  assert.ok(H && H.left < H.right && H.board < H.left);
  let top = Infinity;
  for (let t = 0; t <= K.dur; t += 1 / 30) { const s = A.sample(K, t); top = Math.min(top, 176 - 164 * s.pose.sq + s.pose.y); }   // 頭頂（不含耳朵）大約的高度
  assert.ok(H.y < top, `框 y=${H.y} 要高於跳起來的頭頂 y=${top.toFixed(1)}`);
  const ev = K.events[0], s = A.sample(K, ev.t), h = Q.render(s.th, 't', { ...s.pose, accessory: 'none' }).hands;
  const from = [(h.L.X + h.R.X) / 2 - 6, (h.L.Y + h.R.Y) / 2 - 10], v = H.aim(from, 1500);
  assert.ok(v.vx < 0 && v.vy < 0);
  const tt = (-v.vy + Math.sqrt(v.vy * v.vy - 2 * 1500 * (from[1] - H.y))) / 1500, x = from[0] + v.vx * tt;
  assert.ok(x > H.left + 3 && x < H.right - 3, '球落到框的高度時要在框內');
});

test('跟隨動作：跳起來時耳朵會甩（限 ±18° 加上原本的），沒有跳的動畫不受影響', () => {
  let max = 0;
  for (let t = 0; t <= A.ANIMS.badminton.dur; t += 1 / 30) { const f = A.sample(A.ANIMS.badminton, t).pose.earFlop; max = Math.max(max, Math.abs(f.L)); assert.ok(Math.abs(f.L) <= 18 + 1e-9); }
  assert.ok(max > 8, '跳殺時耳朵應該明顯甩動');
  const f = A.sample(A.REACT.nod, .3).pose.earFlop; assert.strictEqual(f.L, 0);
});

test('ambient：同一個 seed 可重現、不同 seed 不同；呼吸幅度正確', () => {
  for (const t of [0, .5, 3.21, 17.7, 123.456, 3600.5]) assert.deepStrictEqual(A.ambient(t, 42), A.ambient(t, 42));
  let diff = 0, lo = Infinity, hi = -Infinity;
  for (let t = 0; t < 60; t += .1) { const a = A.ambient(t, 1), b = A.ambient(t, 2); if (a.blink !== b.blink || a.look[0] !== b.look[0]) diff++; lo = Math.min(lo, a.sq); hi = Math.max(hi, a.sq); checkFinite(a, 'ambient'); }
  assert.ok(diff > 50);
  assert.ok(Math.abs(hi - 1.012) < .001 && Math.abs(lo - .988) < .001, `呼吸 ${lo}–${hi}`);
  const s = A.ambient(10, 1, { asleep: true }); assert.strictEqual(s.blink, 0); assert.deepStrictEqual(s.look, [0, 0]);
  let sl = 0; for (let t = 0; t < 30; t += .05) sl = Math.max(sl, A.ambient(t, 1, { asleep: true }).sq); assert.ok(sl > 1.02, '睡覺時呼吸更深');
});

test('ambient：眨眼每 3–6 秒一次、每次約 0.12 秒、約 15% 連眨；耳朵抖每 8–15 秒；視線每 4–8 秒換', () => {
  for (const seed of [1, 7, 99, 12345]) {
    const dt = 1 / 120, T = 1800, blinks = [], ears = [], gazes = [];
    let pb = 0, pe = 0, pl = A.ambient(0, seed).look, moving = false, start = 0, maxEar = 0, minEar = 0;
    for (let t = 0; t < T; t += dt) {
      const a = A.ambient(t, seed), e = a.earFlop.L || a.earFlop.R;
      assert.ok(!(a.earFlop.L && a.earFlop.R), '一次只抖一隻耳朵');
      if (a.blink > 0 && pb === 0) start = t;
      if (a.blink === 0 && pb > 0) blinks.push([start, t - start]);
      if (e !== 0 && pe === 0) ears.push(t);
      maxEar = Math.max(maxEar, e); minEar = Math.min(minEar, e);
      const mv = Math.hypot(a.look[0] - pl[0], a.look[1] - pl[1]) > 1e-9;
      if (mv && !moving) gazes.push(t);
      moving = mv; pb = a.blink; pe = e; pl = a.look;
    }
    // 連眨兩下算一次（兩下之間不到 0.3 秒）
    const groups = []; let dbl = 0;
    for (const [t0, d] of blinks) { assert.ok(d > .1 && d < .14, `眨眼長度 ${d.toFixed(3)}`); if (groups.length && t0 - groups[groups.length - 1] < .4) dbl++; else groups.push(t0); }
    for (let i = 1; i < groups.length; i++) { const g = groups[i] - groups[i - 1]; assert.ok(g >= 3 - .02 && g <= 6 + .02, `眨眼間隔 ${g.toFixed(2)} 秒`); }
    const rate = groups.length / T; assert.ok(rate > 1 / 6 && rate < 1 / 3, `眨眼頻率 ${rate.toFixed(3)}／秒`);
    const dr = dbl / groups.length; assert.ok(dr > .07 && dr < .25, `連眨比例 ${dr.toFixed(2)}`);
    for (let i = 1; i < ears.length; i++) { const g = ears[i] - ears[i - 1]; assert.ok(g >= 8 - .05 && g <= 15 + .05, `耳朵抖間隔 ${g.toFixed(2)} 秒`); }
    assert.ok(maxEar > 13 && maxEar <= 14.01 && minEar < -5 && minEar >= -6.01);
    // 視線：有 30% 機率目標是正前方，連續兩次都是正前方時看不出「換方向」，所以只檢查下限與平均
    for (let i = 1; i < gazes.length; i++) assert.ok(gazes[i] - gazes[i - 1] >= 4 - .05, `視線間隔 ${(gazes[i] - gazes[i - 1]).toFixed(2)}`);
    assert.ok(gazes.length > T / 9 && gazes.length <= T / 4 + 1);
  }
});

test('ambient：lookAt 有值時視線與頭跟著滑鼠；ambientNext 回傳的時間真的有事件', () => {
  const r = A.ambient(5, 3, { lookAt: [200, 0] }), l = A.ambient(5, 3, { lookAt: [-200, -100] });
  assert.ok(r.look[0] > 1.5 && r.head.yaw > 5 && Math.abs(r.look[1]) < 1e-9);
  assert.ok(l.look[0] < -1 && l.look[1] < -.4 && l.head.yaw < 0 && l.head.pitch < 0);
  assert.deepStrictEqual(A.ambient(5, 3, { lookAt: [0, 0] }).look, [0, 0]);
  let t = 0;
  for (let i = 0; i < 40; i++) {
    const n = A.ambientNext(t, 9); assert.ok(n && n.t > t && n.dur > 0);
    const a = A.ambient(n.t + (n.kind === 'look' ? .1 : n.kind === 'ear' ? .05 : .04), 9);
    if (n.kind === 'blink') assert.ok(a.blink > 0);
    if (n.kind === 'ear') assert.ok(a.earFlop.L || a.earFlop.R);
    t = n.t + .001;
  }
});

test('applyAmbient：不改原姿勢；呼吸相乘、眨眼取大、耳朵相加；姿勢自己有視線時不蓋掉', () => {
  const pose = { sq: .9, head: { pitch: 10 }, earFlop: { L: 4, R: 0 }, eyes: 'open' }, copy = JSON.parse(JSON.stringify(pose));
  const amb = { sq: 1.01, blink: .7, look: [1, -.5], head: { yaw: 5, pitch: -2 }, earFlop: { L: 10, R: 0 } };
  const p = A.applyAmbient(pose, amb);
  assert.deepStrictEqual(pose, copy);
  assert.ok(Math.abs(p.sq - .909) < 1e-9); assert.strictEqual(p.blink, .7); assert.deepStrictEqual(p.look, [1, -.5]);
  assert.deepStrictEqual(p.head, { pitch: 8, yaw: 5 }); assert.deepStrictEqual(p.earFlop, { L: 14, R: 0 });
  const q = A.applyAmbient({ look: [-2, 0], head: { yaw: -30 } }, amb);
  assert.deepStrictEqual(q.look, [-2, 0]); assert.strictEqual(q.head.yaw, -30);
  assert.ok(!/NaN|undefined/.test(Q.render(-10, 't', A.applyAmbient({}, A.ambient(3, 1))).svg));
});

test('IDLE 小動畫庫齊全；scaleByPersonality：活潑的幅度大又快、慵懶的小而慢', () => {
  for (const k of ['lookAround', 'scratch', 'yawn', 'stretch', 'groom', 'eat', 'napNod', 'petted', 'happySteps', 'sad', 'startle', 'tiltHead', 'standLook']) assert.ok(A.IDLE[k] && A.IDLE[k].keys, 'IDLE.' + k);
  assert.ok(A.IDLE.napNod.loop && A.IDLE.petted.loop && A.ALERT.ring.loop && A.ALERT.quiet.loop);
  const a = A.IDLE.stretch, hi = A.scaleByPersonality(a, { activity: 1 }), lo = A.scaleByPersonality(a, { activity: 0 });
  assert.ok(hi.dur < a.dur && lo.dur > a.dur);
  const peak = (x) => Math.max(...x.keys.map((k) => Math.abs((k.pose.sq || 1) - 1)));
  assert.ok(peak(hi) > peak(a) && peak(lo) < peak(a));
  assert.strictEqual(A.scaleByPersonality(a, { activity: 1 }), hi, '同樣的參數要用快取');
  assert.strictEqual(a.dur, 2.4, '不改原動畫');
  // 有事件與道具的動畫：事件時間跟著縮放
  const v = A.scaleByPersonality(A.ANIMS.volleyball, 1);
  assert.ok(Math.abs(v.events[0].t - A.ANIMS.volleyball.events[0].t / 1.18) < 1e-9);
  for (let t = 0; t <= hi.dur; t += 1 / 30) checkPose(...Object.values(A.sample(hi, t)), 'scaled');
  // 吃葉子：兩種葉子由這一次播放的狀態決定
  const st = { leaf: 'big' }; assert.strictEqual(A.IDLE.eat.props(1, st)[0].kind, 'big');
  assert.strictEqual(A.IDLE.eat.props(1, { leaf: 'twig' })[0].kind, undefined);
});

test('反應動畫修正：bigCheer 落地時是正面；cover 的手在頭兩側（不遮眼）；向後相容的匯出都在', () => {
  const b = A.REACT.bigCheer;
  for (let t = 0; t <= b.dur; t += 1 / 60) { const s = A.sample(b, t); if (s.pose.y > -1 && t > .3) { const m = ((s.th % 360) + 360) % 360; assert.ok(m < 12 || m > 348, `bigCheer t=${t.toFixed(2)} 著地時 th=${s.th.toFixed(0)}`); } }
  const c = A.sample(A.REACT.cover, 1).pose.arms; assert.ok(Math.abs(c.L.hand[0]) > 26 && Math.abs(c.R.hand[0]) > 26);
  for (const k of ['sample', 'mix', 'EASE', 'ANIMS', 'FETCH', 'FETCH2', 'mirrorFrame', 'REACT', 'STILL', 'GAIT', 'ALERT', 'IDLE', 'ambient', 'applyAmbient', 'scaleByPersonality']) assert.ok(A[k], k);
  for (const k of ['discover', 'dash', 'brake', 'sniff', 'scoop', 'sit', 'turnHome', 'carry', 'drop', 'nudge', 'rescoop', 'homeB', 'homeV', 'homeVNudge']) assert.strictEqual(typeof A.FETCH2[k], 'function', 'FETCH2.' + k);
  for (const k of ['nod', 'hopJoy', 'cheer', 'bigCheer', 'droop', 'cover', 'sniff', 'talk', 'wave', 'pat1', 'pat2', 'spin', 'petting', 'dizzy', 'land', 'eat', 'hop', 'nap', 'greetNose', 'greetWave', 'stretch']) assert.ok(A.REACT[k], 'REACT.' + k);
  for (const k of ['sleep', 'ring', 'lift', 'shy']) assert.ok(A.STILL[k], 'STILL.' + k);
  // 衝刺：騰空時腳收起來、尾巴不超過 .4
  for (let u = 0; u <= 1; u += .05) { const p = A.FETCH2.dash(u).pose; assert.ok(p.tailUp <= .4 + 1e-9); if (p.y < -6) assert.strictEqual(p.feet, 'air'); }
});

test('排球撿回來：說「撿回來了」那一段（homeHug）球一直抱在雙手上，前後和 homeToss／homeV 接得起來', () => {
  const A = require('../renderer/quokka-anim.js'), F = A.FETCH2;
  assert.ok(typeof F.homeHug === 'function');
  for (let i = 0; i <= 20; i++) {
    const fr = F.homeHug(i / 20), ball = (fr.pose.props || []).find((p) => p.t === 'vball');
    assert.ok(ball && ball.hand === 'both', `homeHug(${i / 20}) 球在雙手上`);
  }
  const a = F.homeToss(1, 'vball'), b = F.homeHug(0), c = F.homeHug(1), d = F.homeV(0);
  assert.strictEqual(a.th, b.th, '接住 → 抱著說話：角度接得上');
  assert.strictEqual(c.th, d.th, '說完 → 放到腳邊：角度接得上');
  assert.deepStrictEqual(c.pose.arms.L.hand, d.pose.arms.L.hand, '說完 → 放到腳邊：手的位置接得上');
});

test('帽子：同一頂帽子在站、蹲、前傾放球、抬頭、正面、坐著抱球時，畫面上的大小一致、不會整片翻過來', () => {
  const AC = require('../renderer/quokka-acc.js'), F = A.FETCH2;
  const orig = AC.draw;
  let ctx = null;
  AC.draw = (list, c) => { ctx = c; return orig(list, c); };
  try {
    // 帽緣：頭部座標裡頭頂上方一圈（半徑 30）投影到畫面上的寬和高
    const brim = (th, pose) => {
      ctx = null; Q.render(th, 'hat', { ...pose, props: [], accessory: 'straw' });
      assert.ok(ctx && ctx.PHhat, '繪製時有傳帽子專用的投影');
      const xs = [], ys = [];
      for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, q = ctx.PHhat([30 * Math.sin(a), 12, 3 + 30 * Math.cos(a)]); xs.push(q.X); ys.push(q.Y); }
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    };
    const poses = [['站', -15, {}], ['正面', 0, {}], ['蹲（sq .82）', -15, { sq: .82 }], ['伸展（sq 1.08）', -15, { sq: 1.08 }], ['坐著抱球', F.homeHug(1).th, F.homeHug(1).pose],
      ['彎腰放球', F.homeV(.2).th, F.homeV(.2).pose], ['拍球', F.homeV(.6).th, F.homeV(.6).pose], ['抬頭看球', -20, { head: { pitch: -32 } }], ['低頭', -10, { head: { pitch: 24 }, lean: 10 }]];
    const ref = brim(-15, {});
    for (const [name, th, pose] of poses) {
      const b = brim(th, pose);
      assert.ok(Math.abs(b.w / ref.w - 1) < .06, `${name}：帽寬 ${b.w.toFixed(1)}（站姿 ${ref.w.toFixed(1)}）差超過 6%`);
      assert.ok(b.h / b.w < .42, `${name}：帽緣看起來翻過來了（高／寬＝${(b.h / b.w).toFixed(2)}）`);
      assert.ok(Math.abs(b.h - ref.h) < 8, `${name}：帽緣高度 ${b.h.toFixed(1)} 和站姿 ${ref.h.toFixed(1)} 差太多`);
    }
  } finally { AC.draw = orig; }
});
