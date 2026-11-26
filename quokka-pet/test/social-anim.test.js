// 互動劇本（renderer/quokka-anim-social.js）的健全性測試：每種互動都建得起來、每一格都畫得出來、沒有 NaN
const test = require('node:test');
const assert = require('node:assert');
const SOC = require('../renderer/quokka-anim-social.js');
const TR = require('../renderer/traits.js');

const mk = (seed, x, joey) => { const tr = TR.generate(seed); return { x, k: 0.95 * TR.shape(tr).sizeK * (joey ? .5 : 1), tr, hs: joey ? 1.3 : 1 }; };
const rng = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
function finite(v, path) {
  if (typeof v === 'number') assert.ok(Number.isFinite(v), `${path}＝${v}`);
  else if (Array.isArray(v)) v.forEach((x, i) => finite(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) finite(v[k], `${path}.${k}`);
}
function play(type, sa, sb, flip, seed) {
  const T = SOC.TYPES[type], joey = type === 'dadNose';
  let ctx = SOC.context(mk(sa, 0), mk(sb, 100, joey), { rnd: rng(seed), couple: !!T.couple });
  const gap = T.gap(ctx);
  assert.ok(Number.isFinite(gap) && gap > 20 && gap < 320, `${type} 站位距離 ${gap}`);
  ctx = SOC.context(mk(sa, flip ? gap : 0), mk(sb, flip ? 0 : gap, joey), { rnd: rng(seed), couple: !!T.couple, room: { a: 300, b: 300 } });
  const sc = T.build(ctx);
  assert.ok(sc.dur >= 3 && sc.dur <= 16, `${type} 長度 ${sc.dur}`);
  return { ctx, sc, gap };
}

test('15 種互動：兩個方向都建得起來，每一格姿勢與場景都是有限數字、合成得出 SVG', () => {
  const types = Object.keys(SOC.TYPES);
  assert.ok(['wave', 'nose', 'paw', 'leaf', 'chase', 'sunbathe', 'cuddle', 'groom', 'leanNap', 'walkTogether', 'dadNose', 'badminton', 'volleyball', 'basketball'].every((t) => types.includes(t)));
  for (const type of types) for (const flip of [false, true]) {
    const { ctx, sc } = play(type, 8, 4, flip, 7);
    for (let i = 0; i <= 12; i++) {
      const fr = sc.at(sc.dur * i / 12);
      for (const key of ['a', 'b']) { assert.ok(Number.isFinite(fr[key].th), `${type}.${key}.th`); finite(fr[key].pose, `${type}@${i}.${key}`); finite(fr[key].dx || 0, `${type}.${key}.dx`); }
      finite(fr.world || [], `${type}@${i}.world`);
      if (i % 4 === 0) { const r = SOC.compose(ctx, fr, { ground: 0 }); assert.ok(r.svg.length > 1000 && !/NaN|undefined/.test(r.svg), `${type}@${i} SVG`); }
    }
    // 開場與收場的角度是 15 的倍數（和待機的快取畫格接得起來）
    assert.strictEqual(Math.abs(sc.at(0).a.th % 15), 0, `${type} 開場角度`);
  }
});

test('碰鼻：鼻頭之間留一點距離（鼻尖相距 7–12 單位，鼻頭本身半徑約 3，看起來不會疊在一起）、其中一隻歪頭 8°；身高不同也對得上', () => {
  for (const [sa, sb] of [[8, 4], [2, 9], [5, 11]]) {
    const { ctx, sc, gap } = play('nose', sa, sb, false, 3);
    const fr = sc.at(2.4), na = SOC.noseOf(ctx.a, fr.a), nb = SOC.noseOf(ctx.b, fr.b);
    const sep = (gap - na.f - nb.f) / ctx.kk;
    assert.ok(sep > 7 && sep < 12, `鼻尖距離 ${sep.toFixed(1)} 單位`);
    // 碰鼻那一整段（含歪頭晃動）鼻尖都不會更靠近
    for (let t = 1.5; t <= 3.2; t += .05) { const f2 = sc.at(t), a2 = SOC.noseOf(ctx.a, f2.a), b2 = SOC.noseOf(ctx.b, f2.b); assert.ok((gap - a2.f - b2.f) / ctx.kk > 6.5, `${t.toFixed(2)} 秒鼻尖距離 ${((gap - a2.f - b2.f) / ctx.kk).toFixed(1)} 單位`); }
    assert.ok(Math.abs(na.h - nb.h) < 5, `鼻尖高度差 ${(na.h - nb.h).toFixed(1)} px`);
    assert.ok(Math.abs((fr.a.pose.head.roll || 0) - (fr.b.pose.head.roll || 0)) >= 5, '其中一隻歪頭（另一隻不歪）');
  }
});

test('一起打球：球連續運動（不瞬移），擊球那一格在拍面／手上', () => {
  for (const type of ['badminton', 'volleyball']) for (const seed of [1, 5, 9]) {
    const { sc } = play(type, 6, 8, false, seed), I = sc.info;
    assert.ok(I.hits.length >= 3 && I.hits.length <= 6, `${type} 來回 ${I.hits.length} 拍`);
    let prev = null;
    for (let t = I.hits[0].T; t < I.hits[I.hits.length - 1].T; t += 1 / 60) {
      const b = I.ballAt(t);
      if (prev && b.show) assert.ok(Math.hypot(b.u - prev.u, b.h - prev.h) < 26, `${type} 球在 ${t.toFixed(2)} 秒跳了 ${Math.hypot(b.u - prev.u, b.h - prev.h).toFixed(0)} px`);
      prev = b;
    }
    for (const h of I.hits) { const b = I.ballAt(h.T); assert.ok(Math.hypot(b.u - h.c.u, b.h - h.c.h) < 3, `${type} 第 ${h.T} 秒擊球點`); }
  }
  for (const seed of [1, 2, 3, 4]) {
    const { sc } = play('basketball', 6, 8, false, seed), I = sc.info;
    let prev = null;
    for (let t = I.tPass + .01; t < I.tCatch; t += 1 / 60) { const b = I.ballAt(t); if (prev) assert.ok(Math.hypot(b.u - prev.u, b.h - prev.h) < 20, '傳球連續'); prev = b; }
    const end = I.ballAt(I.tRim - .001);
    if (I.make) assert.ok(Math.abs(end.u - I.rimC.u) < 2 && Math.abs(end.h - I.rimH) < 2, '進球：球心過框心');
    assert.ok(sc.handoff && ['a', 'b'].includes(sc.handoff.owner), '球最後一定交給其中一隻去撿（不淡出）');
    if (I.make) assert.ok(sc.handoff.vu === 0 && sc.handoff.vh === 0 && sc.handoff.owner === I.shooter, '進球：球停在籃下，由投籃的去撿');
  }
});

test('左右鏡射：站在右邊的那隻姿勢對稱（左右手對調）', () => {
  const c = { th: 60, pose: { roll: 4, head: { yaw: 10, roll: 5 }, look: [1, 0], arms: { L: { hand: [-10, 90, 30] } }, props: [{ t: 'racket', hand: 'L', ang: 30 }] } };
  const m = SOC.mirrorPose(c);
  assert.strictEqual(m.th, -60); assert.deepStrictEqual(m.pose.arms.R.hand, [10, 90, 30]); assert.strictEqual(m.pose.arms.L, undefined);
  assert.strictEqual(m.pose.head.yaw, -10); assert.strictEqual(m.pose.props[0].hand, 'R'); assert.strictEqual(m.pose.props[0].ang, -30);
  assert.deepStrictEqual(SOC.mirrorPose(m).pose.arms, c.pose.arms);
});

test('理毛：理毛那隻的鼻子不貼到對方的耳朵（鼻尖離耳朵邊緣至少 4 單位，各種體型、兩個方向）', () => {
  for (const [sa, sb] of [[11, 22], [3, 4], [5, 6], [7, 8], [101, 202], [31, 41], [8, 4]]) for (const flip of [false, true]) {
    const { ctx, sc } = play('groom', sa, sb, flip, 12345);
    let min = Infinity, at = 0;
    for (let t = 0; t <= sc.dur; t += 0.05) {
      const fr = sc.at(t);
      const W = (key, P) => { const o = ctx[key], c = SOC.real(ctx, key, fr[key]), x = o.x0 + ctx.side * (fr[key].dx || 0), p = SOC.pt(c.th, c.pose, P, true, o.hs); return [x + (p.X - 80) * o.k, (p.Y - 183) * o.k]; };
      const n = W('a', SOC.NOSE);
      for (const ear of [[-22, 19, -10], [22, 19, -10]]) { const e = W('b', ear), d = Math.hypot(n[0] - e[0], n[1] - e[1]) / ctx.b.k - 14; if (d < min) { min = d; at = t; } }   // 耳朵半徑約 10、鼻頭約 4
    }
    assert.ok(min >= 4, `groom ${sa}/${sb}${flip ? ' flip' : ''}：鼻子離耳朵邊緣 ${min.toFixed(1)} 單位（${at.toFixed(2)} 秒）`);
  }
});

test('排球：球的整段路徑都不經過臉（球心離鼻尖／嘴、頭的中心都大於安全距離），擊球那一格球在手上', () => {
  const R = 12, HEADC = [0, 40, 14];
  const NOSE_SAFE = R + 12, HEAD_SAFE = R + 24 + 8, HAND_MAX = R + 6;        // 單位：SVG 單位（除以各自的 k）；頭的半徑約 24
  for (const [sa, sb] of [[6, 8], [2, 9], [8, 4], [5, 11], [1, 3]]) for (const seed of [1, 2, 3, 5, 7, 9]) for (const flip of [false, true]) {
    const { ctx, sc } = play('volleyball', sa, sb, flip, seed), I = sc.info;
    const where = (p, key, c, P) => { const o = ctx[key], q = SOC.pt(c.th, c.pose, P, true, o.hs); return { u: (p ? ctx.d : 0) + (c.dx || 0) + (p ? -1 : 1) * (q.X - 80) * o.k, h: (183 - q.Y) * o.k }; };
    for (let t = 0; t < sc.dur; t += 1 / 60) {
      const b = I.ballAt(t);
      if (!b.show || b.toss) continue;                                // 還捧在手上（道具跟著手）不算
      const fr = sc.at(t);
      for (const [p, key] of [[0, 'a'], [1, 'b']]) {
        const o = ctx[key], c = fr[key];
        for (const [P, safe, name] of [[SOC.NOSE, NOSE_SAFE, '鼻尖'], [[0, 64, 30], NOSE_SAFE, '嘴'], [HEADC, HEAD_SAFE, '頭']]) {
          const w = where(p, key, c, P), d = Math.hypot(b.u - w.u, b.h - w.h) / o.k;
          assert.ok(d >= safe, `${sa}/${sb} seed ${seed}${flip ? ' flip' : ''}：${t.toFixed(2)} 秒球心離 ${key} 的${name} ${d.toFixed(1)} 單位（要 ≥ ${safe}）`);
        }
      }
    }
    for (const h of I.hits) {
      const key = h.p ? 'b' : 'a', o = ctx[key], c = sc.at(h.T)[key], H = SOC.handsOf(o, c), hand = h.kind === 'spike' ? H.L : H.mid, b = I.ballAt(h.T);
      const d = Math.hypot(b.u - ((h.p ? ctx.d : 0) + (c.dx || 0) + (h.p ? -1 : 1) * hand.f), b.h - hand.h) / o.k;
      assert.ok(d <= HAND_MAX, `${sa}/${sb} seed ${seed}：第 ${h.T.toFixed(2)} 秒（${h.kind}）球心離手 ${d.toFixed(1)} 單位（要 ≤ ${HAND_MAX}）`);
    }
  }
});

test('籃球沒進：彈出來的球整段拋物線都高過傳球那隻的頭（不穿過頭）', () => {
  let n = 0;
  for (const [sa, sb] of [[6, 8], [2, 9], [8, 4], [5, 11]]) for (let i = 1; i <= 60 && n < 24; i++) {
    const seed = i * 7919 * 4111, { ctx, sc } = play('basketball', sa, sb, false, seed), I = sc.info, h = sc.handoff;
    if (I.make || h.owner === I.shooter) continue;
    n++;
    const P = h.owner === 'a' ? ctx.a : ctx.b, pu = h.owner === 'a' ? 0 : ctx.d, G = 1500 * ctx.kk, top = 180 * P.k + 12 * ctx.kk;   // 頭頂含耳朵約 180 單位
    for (let t = 0; t < 3; t += 1 / 240) {
      const u = h.u + h.vu * t, y = h.h + h.vh * t - G * t * t / 2;
      if (y < 12 * ctx.kk) break;
      if (Math.abs(u - pu) < 46 * P.k + 12 * ctx.kk) assert.ok(y >= top, `${sa}/${sb} seed ${seed}：球經過傳球那隻頭上時高 ${y.toFixed(0)}，頭頂＋球半徑 ${top.toFixed(0)}`);
    }
  }
  assert.ok(n >= 3, `測到 ${n} 個沒進的情況`);
});
