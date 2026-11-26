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

test('碰鼻：鼻尖留 2–3 單位、其中一隻歪頭 8°；身高不同也對得上', () => {
  for (const [sa, sb] of [[8, 4], [2, 9], [5, 11]]) {
    const { ctx, sc, gap } = play('nose', sa, sb, false, 3);
    const fr = sc.at(2.4), na = SOC.noseOf(ctx.a, fr.a), nb = SOC.noseOf(ctx.b, fr.b);
    const sep = (gap - na.f - nb.f) / ctx.kk;
    assert.ok(sep > 1.5 && sep < 4.5, `鼻尖距離 ${sep.toFixed(1)} 單位`);
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
    assert.strictEqual(!!sc.handoff, !I.make, '沒進才把球交給舞台去撿');
  }
});

test('左右鏡射：站在右邊的那隻姿勢對稱（左右手對調）', () => {
  const c = { th: 60, pose: { roll: 4, head: { yaw: 10, roll: 5 }, look: [1, 0], arms: { L: { hand: [-10, 90, 30] } }, props: [{ t: 'racket', hand: 'L', ang: 30 }] } };
  const m = SOC.mirrorPose(c);
  assert.strictEqual(m.th, -60); assert.deepStrictEqual(m.pose.arms.R.hand, [10, 90, 30]); assert.strictEqual(m.pose.arms.L, undefined);
  assert.strictEqual(m.pose.head.yaw, -10); assert.strictEqual(m.pose.props[0].hand, 'R'); assert.strictEqual(m.pose.props[0].ang, -30);
  assert.deepStrictEqual(SOC.mirrorPose(m).pose.arms, c.pose.arms);
});
