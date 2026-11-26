// 兩隻庫卡互動的「劇本」：關鍵姿勢資料＋把兩隻合成同一張圖（交錯疊放）。
// 這個檔案不碰 DOM，Node 也能載入（畫抽格圖、測試用）；舞台端的走位、打斷、收尾在 stage-social.js。
//
// 用法：
//   const ctx = SOC.context(actorA, actorB, { rnd, room })   // actor = { x, k, tr(個體特徵), hs(頭的倍率), deco? }
//   const gap = SOC.TYPES[type].gap(ctx)                      // 兩隻腳底要站多遠（px）；舞台讓發起的那隻走到這個距離
//   const sc  = SOC.TYPES[type].build(ctx)                    // 到位後建立劇本 → { dur, at(t), handoff? }
//   const fr  = sc.at(t)                                      // { a:{th,pose,dx}, b:{th,pose,dx}, world:[…], near:'a'|'b' }
//   SOC.compose(ctx, fr)                                      // → { svg, box }：兩隻＋場景道具排好前後順序的 SVG 內容
//
// 座標約定：
//   · 每隻的姿勢用「標準式」寫：對方在自己的右邊（面向對方＝th 為正）。真的站在右邊的那隻由 real() 自動左右鏡射。
//   · 場景（world）用「a 軸」：u＝從 a 的起點往 b 的方向幾 px，h＝離地幾 px。球、羽毛球、愛心、籃框都在這個座標裡，
//     所以球可以連續地在兩隻之間飛，擊球那一格對得上拍面或手掌（位置用 render() 回傳的手掌座標算）。
//   · dx＝這隻沿 a 軸離開起點幾 px（追逐、並肩散步、接球前移一步）。
(function () {
  const isNode = typeof window === 'undefined';
  const ANIM = isNode ? require('./quokka-anim.js') : window.QuokkaAnim;
  const POSE = isNode ? require('./quokka-pose.js') : window.QuokkaPose;
  const ART = isNode ? require('./quokka-art.js') : window.QuokkaArt;
  const { EASE, mix } = ANIM;
  const lerp = (a, b, t) => a + (b - a) * t, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rad = (a) => a * Math.PI / 180, f1 = (v) => (+v).toFixed(1);
  const sin = Math.sin, PI = Math.PI;
  const FOOT = { x: 80, y: 183 };

  // ---- 3D 位置（和 quokka-pose.js 的 makeT 同一套變換；用來算鼻尖、頭頂在哪裡） -------------------
  const rotX = (p, a, c) => { const s = Math.sin(rad(a)), co = Math.cos(rad(a)), y = p[1] - c[1], z = p[2] - c[2]; return [p[0], c[1] + y * co + z * s, c[2] + z * co - y * s]; };
  const rotZ = (p, a, c) => { const s = Math.sin(rad(a)), co = Math.cos(rad(a)), x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * co - y * s, c[1] + y * co + x * s, p[2]]; };
  const rotY = (p, a, c) => { const s = Math.sin(rad(a)), co = Math.cos(rad(a)), x = p[0] - c[0], z = p[2] - c[2]; return [c[0] + x * co + z * s, p[1], c[2] - x * s + z * co]; };
  const NECK = [0, 80, 0], FEET = [0, 176, 0];
  function pt(th, pose, p, head, hs = 1) {
    const sq = pose.sq || 1, k = 1 / Math.sqrt(sq), h = pose.head || {};
    const lean = pose.lean || 0, l1 = clamp(lean, -25, 25), l2 = lean - l1;
    const Sc = (q) => [q[0] * k, 176 + (q[1] - 176) * sq, q[2] * k];
    const piv = rotX(Sc([0, 136, -8]), l1, FEET);
    const wUp = (y) => { const t = clamp((146 - y) / 36, 0, 1); return t * t * (3 - 2 * t); };
    const B = (q0, wF) => {
      let q = Sc(q0);
      if (l1) q = rotX(q, l1, FEET);
      if (l2) { const w = wF == null ? wUp(q0[1]) : wF; if (w) q = rotX(q, l2 * w, piv); }
      if (pose.roll) q = rotZ(q, pose.roll, FEET);
      return q;
    };
    let q;
    if (head) {
      q = hs === 1 ? p : [p[0] * hs, 80 + (p[1] - 80) * hs, Math.min(p[2], 14) * hs + Math.max(0, p[2] - 14)];
      if (h.roll) q = rotZ(q, h.roll, NECK);
      if (h.pitch) q = rotX(q, h.pitch, NECK);
      if (h.yaw) q = rotY(q, h.yaw, NECK);
      q = B(q, 1);
    } else q = B(p);
    const c = Math.cos(rad(th)), s = Math.sin(rad(th));
    return { X: 80 + q[0] * c + q[2] * s + (pose.x || 0), Y: q[1] + (pose.y || 0) };
  }
  const NOSE = [0, 55, 39], MOUTH = [0, 64, 30], CROWN = [0, 17, 6], BELLY = [0, 147, 30];

  // ---- 左右鏡射一個姿勢（站在右邊的那隻用）：角度、轉頭、左右手、道具全部對調 --------------------
  function mirrorPose(c) {
    const p = { ...c.pose };
    if (p.x) p.x = -p.x;
    if (p.roll) p.roll = -p.roll;
    if (p.head) p.head = { ...p.head, yaw: -(p.head.yaw || 0), roll: -(p.head.roll || 0) };
    if (p.look) p.look = [-p.look[0], p.look[1]];
    if (p.earFlop) p.earFlop = { L: p.earFlop.R || 0, R: p.earFlop.L || 0 };
    if (p.arms) {
      const fa = (a) => (a ? { ...a, hand: [-a.hand[0], a.hand[1], a.hand[2]], ...(a.elbow ? { elbow: [-a.elbow[0], a.elbow[1], a.elbow[2]] } : {}), ...(a.paw != null ? { paw: -a.paw } : {}) } : a);
      const arms = {};
      if (p.arms.R) arms.L = fa(p.arms.R);
      if (p.arms.L) arms.R = fa(p.arms.L);
      p.arms = arms;
    }
    if (p.props) p.props = p.props.map((q) => {
      const o = { ...q };
      if (o.hand === 'L') o.hand = 'R'; else if (o.hand === 'R') o.hand = 'L';
      if (o.off) o.off = [-o.off[0], o.off[1]];
      if (o.at) o.at = [160 - o.at[0], o.at[1]];
      if (o.t === 'racket') o.ang = -(o.ang || 0);
      else if (o.t === 'leaf' || o.t === 'shuttle' || (o.t === 'fx' && o.kind === 'speed')) o.rot = 180 - (o.rot || 0);
      else if (o.rot != null) o.rot = -o.rot;
      return o;
    });
    return { th: -c.th, pose: p, dx: c.dx };
  }

  // ---- 關鍵影格小工具 --------------------------------------------------------------------
  const K = (t, th, pose = {}, ease) => (ease ? { t, th, pose, ease } : { t, th, pose });
  const track = (keys, dur) => { keys = keys.slice().sort((a, b) => a.t - b.t); const an = { dur: dur || keys[keys.length - 1].t, keys }; return (t) => ANIM.sample(an, t); };
  // 分段函數：[[t, v, ease?]…] → f(t)
  const pw = (pts) => (t) => {
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const a = pts[i - 1], b = pts[i], u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]); return lerp(a[1], b[1], (EASE[b[2] || 'io'] || EASE.io)(u)); }
    return pts[pts.length - 1][1];
  };
  // 兩個姿勢之間平順過渡（沒寫的欄位補中立值，不會在中點突然跳）
  const tw = (c0, c1, u) => ANIM.sample({ dur: 1, keys: [{ t: 0, th: c0.th, pose: c0.pose || {}, ease: 'lin' }, { t: 1, th: c1.th, pose: c1.pose || {}, ease: 'lin' }] }, clamp(u, 0, 1));
  const bump = (t, t0, d) => (t > t0 && t < t0 + d ? sin(PI * (t - t0) / d) : 0);
  // 往上飄的小特效（愛心、星星）：出現、飄高、淡出
  const floatUp = (k, t, t0, u, h, s = 1, d = 1.5, rise = 26) => (t > t0 && t < t0 + d ? [{ k, u: u + 4 * sin((t - t0) * 5), h: h + rise * (t - t0) / d, s: s * Math.min(1, (t - t0) * 6), o: Math.min(1, (t0 + d - t) * 3) }] : []);

  // ---- 個性 ---------------------------------------------------------------------------
  // 害羞的先停頓、動作小、臉紅多；活潑的動作大、會跳一下；酷酷的回應淡；黏人的結束後多留一下
  function persona(tr) {
    const P = (tr && tr.personality) || {}, v = (x, d) => (typeof x === 'number' ? x : d);
    const shy = P.archetype === 'shy' || v(P.boldness, .5) < .3;
    const cool = P.archetype === 'cool' || (v(P.sociability, .5) < .25 && v(P.affection, .5) < .4);
    const lively = !shy && v(P.activity, .5) > .65;
    const clingy = P.archetype === 'clingy' || v(P.affection, .5) > .72;
    return { shy, cool, lively, clingy, lazy: v(P.activity, .5) < .3, act: v(P.activity, .5), aff: v(P.affection, .5),
      amp: shy ? .6 : lively ? 1.25 : 1, delay: shy ? .45 : cool ? .2 : 0, blush: shy ? .5 : cool ? -.3 : 0, likes: P.likes || [] };
  }
  // 套用個性：臉紅、跳的高度
  function styled(per, c) {
    const p = c.pose;
    if (per.blush) p.blush = clamp((p.blush == null ? 1 : p.blush) + per.blush, 0, 1.6);
    if (p.y && p.y < 0) p.y *= per.amp;
    if (per.cool && p.mouth === 'open') p.mouth = 'smile';
    return c;
  }

  // ---- 這一對的環境 ----------------------------------------------------------------------
  function context(a, b, opts = {}) {
    const side = (b.x - a.x) >= 0 ? 1 : -1;
    const mk = (o, key) => ({ ...o, key, hs: o.hs || 1, per: persona(o.tr), x0: o.x });
    const ctx = { a: mk(a, 'a'), b: mk(b, 'b'), side, d: Math.abs(b.x - a.x), rnd: opts.rnd || Math.random,
      room: opts.room || { a: 400, b: 400 },          // a 的背後、b 的背後各有多少空間（px）
      couple: !!opts.couple, kk: (a.k + b.k) / 2 };
    return ctx;
  }
  // 量測（標準式姿勢 → 往對方方向幾 px、離地幾 px）
  const fwd = (o, P) => ({ f: (P.X - FOOT.x) * o.k, h: (FOOT.y - P.Y) * o.k });
  const noseOf = (o, c) => fwd(o, pt(c.th, c.pose, NOSE, true, o.hs));
  const mouthOf = (o, c) => fwd(o, pt(c.th, c.pose, MOUTH, true, o.hs));
  const crownOf = (o, c) => fwd(o, pt(c.th, c.pose, CROWN, true, o.hs));
  function handsOf(o, c) {
    ART.configure(o.tr);
    const r = POSE.render(c.th, 'm', { ...ANIM.sample({ dur: 1, keys: [{ t: 0, th: c.th, pose: c.pose }] }, 0).pose, props: c.pose.props || [], headScale: o.hs !== 1 ? o.hs : undefined });
    ART.configure(null);
    const out = {};
    for (const key of ['L', 'R']) out[key] = { ...fwd(o, { X: r.hands[key].palm[0], Y: r.hands[key].palm[1] }), ang: r.hands[key].ang };
    out.mid = { f: (out.L.f + out.R.f) / 2, h: (out.L.h + out.R.h) / 2 };
    return out;
  }
  // 手要伸到「離地 h px」：換成這隻自己的身體座標 y
  const yFor = (o, h) => FOOT.y - h / o.k;

  // ---- 場景道具的樣板：用「有道具」和「沒道具」各畫一次取差，得到道具本身的 SVG（只做一次，之後只改位置） ----
  const tplCache = {};
  let worldDefs = '';
  function tpl(kind) {
    if (tplCache[kind]) return tplCache[kind];
    const isFx = !['shuttle', 'vball', 'bball', 'hoop', 'leaf'].includes(kind);
    const prop = isFx ? { t: 'fx', kind, at: [0, 0] } : { t: kind, at: [0, 0] };
    ART.configure(null);
    const base = POSE.render(0, 'W', { raw: true }), withP = POSE.render(0, 'W', { raw: true, props: [prop] });
    if (!worldDefs) worldDefs = withP.layers.defs;
    return (tplCache[kind] = withP.layers.front.slice(base.layers.front.length));
  }
  function worldItem(it, ox, gy, kk, side) {
    let s = tpl(it.k);
    if (!s) return '';
    const x = ox + side * it.u, y = gy - it.h, sc = (it.s == null ? 1 : it.s) * kk;
    let rot = it.rot || 0, flip = (side < 0) !== !!it.mir;
    if (it.k === 'vball' || it.k === 'bball') { s = s.replace(/rotate\(0\.0\)/, `rotate(${f1(side * rot)})`); rot = 0; flip = false; }
    return `<g transform="translate(${f1(x)} ${f1(y)}) scale(${flip ? -sc : sc} ${sc}) rotate(${f1(rot)})"${it.o != null && it.o < 1 ? ` opacity="${f1(Math.max(0, it.o))}"` : ''}>${s}</g>`;
  }

  // ---- 合成：兩隻＋場景，依前後交錯疊放 ---------------------------------------------------
  // 順序：影子 → 場景後層 → 遠的 back → 近的 back → 遠的 body → 近的 body → 遠的 front → 近的 front → 場景前層
  // （尾巴、後側的手都在 back，所以不會橫切對方的肚子；伸向對方的手在 front，會蓋在對方身上）
  function real(ctx, key, c) { return (key === 'a' ? ctx.side < 0 : ctx.side > 0) ? mirrorPose(c) : c; }
  function compose(ctx, fr, opts = {}) {
    const gy = opts.ground != null ? opts.ground : 0, out = {}, pos = {};
    for (const key of ['a', 'b']) {
      const o = ctx[key], c = real(ctx, key, fr[key]);
      const x = o.x0 + ctx.side * (fr[key].dx || 0);
      const pose = { ...c.pose };
      if (o.hs !== 1 && pose.headScale == null) pose.headScale = o.hs;
      ART.configure(o.tr);
      const r = POSE.render(c.th, (opts.id || 'D') + key + (o.uid || ''), pose);
      ART.configure(null);
      const L = r.layers, deco = o.deco ? o.deco(c.th, pose) : '';
      const wrap = (s) => (s ? `<g transform="translate(${f1(x)} ${f1(gy + (o.oy || 0))}) scale(${o.k.toFixed(4)}) translate(-80 -183)" style="--band:${(o.tr && o.tr.band) || '#e5533d'}">${s}</g>` : '');
      out[key] = { defs: wrap(L.defs), shadow: wrap(L.shadow), back: wrap(L.back), body: wrap(L.body + deco), front: wrap(L.front) };
      pos[key] = { x, th: c.th, hands: r.hands };
    }
    const near = fr.near === 'a' ? 'a' : 'b', far = near === 'a' ? 'b' : 'a';
    const N = out[near], F = out[far], ox = ctx.a.x0, wk = ctx.kk;
    const world = fr.world || [];
    const wBack = world.filter((w) => w.back).map((w) => worldItem(w, ox, gy, wk, ctx.side)).join('');
    const wFront = world.filter((w) => !w.back).map((w) => worldItem(w, ox, gy, wk, ctx.side)).join('');
    const svg = (world.length ? worldDefs : '') + F.defs + N.defs + F.shadow + N.shadow + wBack + F.back + N.back + F.body + N.body + F.front + N.front + wFront;
    return { svg, pos };
  }

  // =====================================================================================
  // 劇本。th0＝開場與收場的角度（15 的倍數，和待機的快取畫格接得起來）
  // =====================================================================================
  const TH0 = 60;
  const REST = {};
  const finish = (ctx, dur, fn) => ({ dur, at: (t) => { const fr = fn(Math.min(t, dur)); fr.a = styled(ctx.a.per, fr.a); fr.b = styled(ctx.b.per, fr.b); if (!fr.near) fr.near = 'b'; return fr; } });
  const polite = (ctx, units = 112) => units * ctx.kk;
  // 活潑的：開場先原地跳一下
  const introHop = (per, keys, t0 = 0) => (per.lively ? keys.concat([K(t0 + .16, TH0, { sq: .9 }), K(t0 + .34, TH0, { y: -12, sq: 1.05, tailUp: .7, eyes: 'happy', mouth: 'open' }, 'out'), K(t0 + .52, TH0, { sq: .94, eyes: 'happy' }, 'in')]) : keys);
  // 黏人的：結束後多留一下（看著對方、冒一顆小愛心）
  const linger = (ctx) => (ctx.a.per.clingy || ctx.b.per.clingy ? 1.2 : 0);

  const TYPES = {};

  // ---- 揮手打招呼：a 揮手 → b 看到，也揮手（酷酷的、害羞的只點頭）→ 相視而笑 --------------------
  TYPES.wave = {
    gap: (ctx) => polite(ctx, 138),
    build(ctx) {
      const pa = ctx.a.per, pb = ctx.b.per, d = pb.delay;
      const UP = (z) => ({ L: { hand: [-54 + z * 13, 70 - z * 12, 0 + z * 5] } });   // 手舉到頭的外側，側身也看得到
      const swing = (t0, n, th, amp, extra = {}) => { const ks = []; for (let i = 0; i < n; i++) ks.push(K(t0 + i * .26, th, { ...extra, head: { roll: (i % 2 ? 5 : -5) * amp, yaw: 16 }, roll: (i % 2 ? 1.5 : -1.5) * amp, arms: UP(i % 2 ? 1 : 0) })); return ks; };
      const A = track(introHop(pa, [K(0, TH0), K(.62, 62, { eyes: 'wide', head: { pitch: -4 } }),
        K(.95, 40, { eyes: 'happy', mouth: 'open', blush: 1.2, arms: UP(0) }, 'back'),
        ...swing(1.2, 5, 40, pa.amp, { eyes: 'happy', mouth: 'open', blush: 1.2 }),
        K(2.75, 62, { eyes: 'happy', mouth: 'smile', blush: 1.2 }), K(3.5 + d, 62, { eyes: 'happy', head: { pitch: 10 } }), K(3.8 + d, 62, { eyes: 'happy', head: { pitch: -2 } }),
        K(4.6 + d, TH0)]));
      const nod = pb.cool || pb.shy;
      const B = track(nod
        ? [K(0, TH0), K(1.3 + d, TH0, { eyes: 'wide' }), ...(pb.shy ? [K(1.75 + d, 48, { head: { yaw: -22, pitch: 8 }, eyes: 'happy', blush: 1.5 })] : []),
          K(2.1 + d, 62, { head: { pitch: 14 }, eyes: 'happy' }), K(2.4 + d, 62, { head: { pitch: -2 }, eyes: 'happy' }), K(2.7 + d, 62, { head: { pitch: pb.cool ? 2 : 12 }, eyes: 'happy' }),
          K(3.1 + d, 62, { eyes: 'happy', mouth: 'smile', head: { roll: pb.shy ? 6 : 0 } }), K(4.6 + d, TH0)]
        : [K(0, TH0), K(1.2 + d, 62, { eyes: 'wide', head: { pitch: -3 } }), K(1.55 + d, 40, { eyes: 'happy', mouth: 'open', blush: 1.2, arms: UP(0), y: pb.lively ? -10 : 0, tailUp: pb.lively ? .6 : 0 }, 'back'),
          ...swing(1.8 + d, 4, 40, pb.amp, { eyes: 'happy', mouth: 'open', blush: 1.2 }),
          K(3.0 + d, 62, { eyes: 'happy', mouth: 'smile' }), K(3.6 + d, 62, { eyes: 'happy', head: { pitch: 8 } }), K(3.9 + d, 62, { eyes: 'happy' }), K(4.6 + d, TH0)]);
      const ha = noseOf(ctx.a, { th: 60, pose: {} });
      return finish(ctx, 4.6 + d, (t) => ({ a: A(t), b: B(t), world: [...floatUp('sparkle', t, 1.0, ha.f - 10 * ctx.a.k, ha.h + 46 * ctx.a.k, .8, 1.2, 14), ...(nod ? [] : floatUp('sparkle', t, 1.7 + d, ctx.d - ha.f + 10 * ctx.b.k, ha.h + 40 * ctx.b.k, .7, 1.2, 14))] }));
    }
  };

  // ---- 碰鼻：伸長脖子輕碰、瞇眼、冒小星星。鼻尖留 2–3 單位，a 歪頭 8° -------------------------
  function noseFit(ctx, base, sep = 2.6) {
    // 兩隻身高不同：高的多低一點頭、矮的抬一點頭，讓鼻尖一樣高
    const mkP = (adj, roll) => ({ th: 75, pose: { ...base, head: { pitch: (base.head ? base.head.pitch || 0 : 4) + adj, roll } } });
    let adj = 0;
    for (let i = 0; i < 4; i++) { const na = noseOf(ctx.a, mkP(adj, 8)), nb = noseOf(ctx.b, mkP(-adj, 0)); adj = clamp(adj + (na.h - nb.h) / ctx.kk / 1.3, -16, 16); }
    const A = mkP(adj, 8), B = mkP(-adj, 0), na = noseOf(ctx.a, A), nb = noseOf(ctx.b, B);
    return { A, B, na, nb, gap: na.f + nb.f + sep * ctx.kk };
  }
  TYPES.nose = {
    gap: (ctx) => noseFit(ctx, { lean: 14 }).gap,
    build(ctx) {
      const F = noseFit(ctx, { lean: 14 }), pa = ctx.a.per, pb = ctx.b.per, d = Math.max(pb.delay, .12);
      const touch = (c, per) => ({ ...c.pose, eyes: 'closed', mouth: 'smile', blush: 1.3 });
      const seq = (c, per, d0, wig) => track(introHop(per, [K(0, TH0), K(.7 + d0, 64, { lean: -3, eyes: 'happy', head: { pitch: -2 } }),
        K(1.5 + d0, 75, touch(c, per)), K(2.1 + d0, 75, { ...touch(c, per), head: { ...c.pose.head, roll: (c.pose.head.roll || 0) + wig } }),
        K(2.7 + d0, 75, touch(c, per)), K(3.2, 75, { ...touch(c, per), head: { ...c.pose.head, roll: (c.pose.head.roll || 0) + wig * .6 } }),
        K(3.9, 66, { lean: 3, eyes: 'happy', mouth: 'open', blush: 1.4 }), K(4.5, 62, { eyes: 'happy', mouth: 'smile', blush: 1.2, y: per.lively ? -8 : 0 }), K(5.2, TH0)]));
      const A = seq(F.A, pa, 0, -2), B = seq(F.B, pb, d, 1.5);
      const T = 1.5 + d, cu = F.na.f + 1.3 * ctx.kk, ch = (F.na.h + F.nb.h) / 2;
      const dur = 5.2 + linger(ctx);
      return finish(ctx, dur, (t) => ({ a: A(Math.min(t, 5.2)), b: B(Math.min(t, 5.2)), world: [
        ...floatUp('sparkle', t, T + .05, cu - 8, ch + 22, .8, 1.3, 22), ...floatUp('star', t, T + .5, cu + 9, ch + 26, .55, 1.3, 24), ...floatUp('sparkle', t, T + 1.0, cu, ch + 30, .65, 1.2, 22),
        ...(ctx.couple ? floatUp('heart', t, T + .3, cu, ch + 40, 1, 1.8, 30) : []), ...floatUp('heart', t, 5.0, cu, ch + 34, .7, 1.2, 16)] }));
    }
  };

  // ---- 碰碰手掌：走近到鼻子不相碰，轉成 3/4 側身，伸出靠對方那一側的手在胸前輕拍一下 -------------
  const PAW_HIT = (yy) => ({ th: 58, pose: { lean: 13, head: { yaw: -26, pitch: -8 }, arms: { R: { hand: [22, yy, 40], paw: 150 } } } });   // 身體前傾把手伸出去，頭往後收並轉向觀眾，鼻子不會碰到
  function pawFit(ctx) {
    const h = 98 * ctx.kk;                                   // 拍掌的高度（胸前）
    const A = PAW_HIT(yFor(ctx.a, h) - 4), B = PAW_HIT(yFor(ctx.b, h) - 4);
    const ha = handsOf(ctx.a, A).R, hb = handsOf(ctx.b, B).R;
    return { A, B, ha, hb, gap: ha.f + hb.f + 1.5 * ctx.kk };
  }
  TYPES.paw = {
    gap: (ctx) => pawFit(ctx).gap,
    build(ctx) {
      const F = pawFit(ctx), pa = ctx.a.per, pb = ctx.b.per, d = pb.delay * .6, T = 1.7 + d;
      const seq = (c, per, d0) => {
        const hy = c.pose.arms.R.hand[1];
        return track(introHop(per, [K(0, TH0), K(.6 + d0, 52, { eyes: 'happy', mouth: 'open', arms: { R: { hand: [28, hy - 16, 26], paw: 150 } } }),
          K(T - .28, 50, { lean: -4, sq: .96, eyes: 'happy', mouth: 'open', arms: { R: { hand: [30, hy - 14, 18], paw: 150 } } }),
          K(T, 58, { ...c.pose, y: -7, eyes: 'happy', mouth: 'open', tailUp: .6, blush: 1.2 }, 'in'),
          K(T + .16, 58, { lean: 9, sq: .95, head: { yaw: -22, pitch: -6 }, eyes: 'happy', mouth: 'open', arms: { R: { hand: [24, hy + 2, 32], paw: 150 } }, blush: 1.2 }, 'out'),
          K(T + .7, 56, { eyes: 'happy', mouth: 'open', y: per.lively ? -12 : -4, tailUp: .5, arms: { R: { hand: [30, hy - 12, 24] } } }),
          K(T + 1.1, 58, { eyes: 'happy', mouth: 'smile', sq: .96 }), K(T + 1.9, TH0)]));
      };
      const A = seq(F.A, pa, 0), B = seq(F.B, pb, d);
      return finish(ctx, T + 1.9, (t) => ({ a: A(t), b: B(t), world: [
        ...(t > T - .02 && t < T + .22 ? [{ k: 'impact', u: F.ha.f, h: F.ha.h + 7 * ctx.kk, s: .8 }] : []),
        ...floatUp('sparkle', t, T + .1, F.ha.f - 12, F.ha.h + 26, .7, 1, 20), ...floatUp('star', t, T + .16, F.ha.f + 12, F.ha.h + 34, .5, 1, 22)] }));
    }
  };

  // ---- 分享葉子：a 拿出葉子遞過去 → b 聞一聞、探頭咬一口、嚼 → a 自己也吃一口 ------------------
  const LEAF_S = 1.6;
  function leafFit(ctx) {
    const Bp = { th: 72, pose: { lean: 17, head: { pitch: 8 } } }, mb = mouthOf(ctx.b, Bp);
    const mk = (y) => ({ th: 68, pose: { lean: 5, arms: { L: { hand: [-5, y, 40] }, R: { hand: [5, y + 2, 38] } } } });
    let y = clamp(yFor(ctx.a, mb.h) + 2, 78, 104), A = mk(y), ha = handsOf(ctx.a, A).mid;
    y = clamp(y + (ha.h - mb.h) / ctx.a.k * .9, 76, 106); A = mk(y); ha = handsOf(ctx.a, A).mid;
    const tip = ha.f + (6 + 28 * LEAF_S) * ctx.a.k;            // 葉尖
    return { A, Bp, y, gap: tip + mb.f - 3 * ctx.kk, ha };
  }
  TYPES.leaf = {
    gap: (ctx) => clamp(leafFit(ctx).gap, 118 * ctx.kk, 150 * ctx.kk),
    build(ctx) {
      const F = leafFit(ctx), pa = ctx.a.per, pb = ctx.b.per, d = pb.delay, y = F.y;
      const hold = (yy, z) => ({ L: { hand: [-5, yy, z] }, R: { hand: [5, yy + 2, z - 2] } });
      const A = track(introHop(pa, [K(0, TH0), K(.6, 40, { head: { pitch: 12, yaw: -10 }, arms: hold(124, 30), eyes: 'happy' }),
        K(1.1, 62, { arms: hold(108, 34), eyes: 'happy', mouth: 'open' }), K(1.8, 68, { ...F.A.pose, eyes: 'happy', mouth: 'smile', head: { roll: -5 } }),
        K(3.1 + d, 68, { ...F.A.pose, eyes: 'happy', mouth: 'smile', head: { roll: 4 } }), K(3.5 + d, 68, { ...F.A.pose, lean: 2, eyes: 'happy', mouth: 'open' }),
        K(4.6 + d, 64, { arms: hold(102, 36), eyes: 'happy', mouth: 'smile' }), K(5.1 + d, 60, { arms: hold(76, 30), head: { pitch: 8 }, eyes: 'happy', mouth: 'open' }),
        K(5.5 + d, 60, { arms: hold(76, 30), head: { pitch: 10 }, eyes: 'closed', mouth: 'chew' }), K(5.85 + d, 60, { arms: hold(80, 30), head: { pitch: 6 }, eyes: 'closed', mouth: 'chew' }),
        K(6.2 + d, 60, { arms: hold(78, 30), head: { pitch: 10 }, eyes: 'happy', mouth: 'chew' }), K(6.7 + d, 60, { eyes: 'happy', mouth: 'smile', blush: 1.3 }), K(7.3 + d, TH0)]));
      const bite = F.Bp.pose, chew = (p, m) => ({ lean: 8, head: { pitch: p }, eyes: 'happy', mouth: m, blush: 1.3 });
      const B = track([K(0, TH0), K(1.5 + d, 62, { eyes: 'wide', head: { pitch: -4 } }), K(2.0 + d, 68, { lean: 8, head: { pitch: 2 }, eyes: 'open', mouth: 'o' }),
        K(2.35 + d, 68, { lean: 10, head: { pitch: -3 }, eyes: 'open', mouth: 'o' }),
        K(2.9 + d, 72, { ...bite, eyes: 'happy', mouth: 'open' }), K(3.15 + d, 72, { ...bite, eyes: 'closed', mouth: 'chew' }),
        K(3.6 + d, 68, chew(2, 'chew')), K(3.9 + d, 68, chew(6, 'smile')), K(4.2 + d, 68, chew(1, 'chew')), K(4.5 + d, 68, chew(6, 'smile')), K(4.8 + d, 68, chew(1, 'chew')),
        K(5.3 + d, 64, { eyes: 'happy', mouth: 'open', blush: 1.4, y: pb.lively ? -8 : 0 }), K(6.0 + d, 62, { eyes: 'happy', mouth: 'smile', head: { pitch: 8 } }), K(6.4 + d, 62, { eyes: 'happy' }), K(7.3 + d, TH0)]);
      const leafS = pw([[.5, 0], [.75, LEAF_S, 'back'], [3.05 + d, LEAF_S], [3.2 + d, LEAF_S * .72, 'out'], [5.4 + d, LEAF_S * .72], [5.6 + d, LEAF_S * .4], [6.1 + d, LEAF_S * .4], [6.3 + d, 0]]);
      const leafR = pw([[0, 150], [1.8, 178], [4.6 + d, 178], [5.1 + d, 118]]);   // 自己吃的時候葉尖朝上
      const mb = mouthOf(ctx.b, F.Bp);
      return finish(ctx, 7.3 + d, (t) => {
        const a = A(t), s = leafS(t);
        if (s > .02) a.pose.props = [{ t: 'leaf', hand: 'both', off: [6, -5], rot: leafR(t), s }];
        return { a, b: B(t), near: 'a', world: [...floatUp('sparkle', t, .6, F.ha.f * .5, F.ha.h + 10, .7, .9, 16),
          ...floatUp('heart', t, 5.2 + d, ctx.d - mb.f + 6, mb.h + 44, .8, 1.4, 24), ...floatUp('note', t, 3.7 + d, ctx.d - mb.f + 16, mb.h + 34, .8, 1.3, 20)] };
      });
    }
  };

  // ---- 追逐跳跳：a 壓低身體邀玩 → b 嚇一跳、轉身跑、回頭笑 → a 追 → 停下來面對面喘氣笑 ----------
  const HOP = (u) => ANIM.FETCH.hop(u);
  TYPES.chase = {
    gap: (ctx) => polite(ctx, 142),
    build(ctx) {
      // 先跑的那隻（R）往自己背後有空間的方向跑、另一隻（C）追；追到了換 C 轉身跑回來、R 追回來 → 來回一趟，回到原位
      const step = 42 * ctx.kk, bRuns = ctx.room.b >= step * 3 || ctx.room.b >= ctx.room.a;
      const roomRun = bRuns ? ctx.room.b : ctx.room.a, N = clamp(Math.floor((roomRun - 20) / step), 1, 4);
      const R = bRuns ? ctx.b : ctx.a, Cz = bRuns ? ctx.a : ctx.b;
      const hopT = .36, t0 = 1.4, lag = .46, run = N * hopT, tTag = t0 + lag + run, t1 = tTag + 1.15, tEnd = t1 + lag + run, dur = tEnd + 2.0;
      const hops = (t, start) => { const v = clamp((t - start) / hopT, 0, N), i = Math.min(N - 1, Math.floor(v)), u = v - i, g = ANIM.GAIT ? ANIM.GAIT.hop(u) : null; return { v: i + (g ? g.advance : EASE.io(u)), u, moving: v > 0 && v < N }; };
      const bow = { lean: 12, sq: .9, tailUp: .9, eyes: 'happy', mouth: 'open', arms: { L: { hand: [-8, 148, 36] }, R: { hand: [8, 148, 36] } } };
      const laugh = (e) => ({ y: -6 * Math.abs(sin(e * 7)) * Math.max(0, 1 - e), sq: 1 - .03 * sin(e * 9), eyes: 'happy', mouth: 'open', blush: 1.3, tailUp: .3 });
      // x＝沿「往對方」的方向離開起點幾 px（跑開是負的、追過去是正的）
      const runner = (t) => {
        if (t < .55) return { ...tw({ th: TH0 }, { th: 62, pose: { eyes: 'wide', mouth: 'o', head: { pitch: -4 } } }, EASE.io(t / .55)), x: 0 };
        if (t < .85) return { th: 62, x: 0, pose: { y: -12 * sin(PI * (t - .55) / .3), eyes: 'wide', mouth: 'open', tailUp: .7, sq: 1.03 } };
        // 轉身逃跑：頭先轉過去、身體再跟上（轉身的過程放慢到 0.55 秒，不會看起來像一格突然變正面）
        if (t < t0) { const e = (t - .85) / (t0 - .85), eb = EASE.io(clamp((e - .15) / .85, 0, 1)), th = lerp(62, -90, eb), hy = clamp(lerp(62, -90, EASE.out(clamp(e / .7, 0, 1))) - th, -40, 40); return { th, x: 0, pose: { eyes: 'happy', mouth: 'open', sq: .95 - .03 * sin(PI * e), head: { yaw: hy } } }; }
        if (t < t0 + run) { const h = hops(t, t0), look = bump(t, t0 + hopT * Math.max(.6, N - 2.6), hopT * 2.2); return { th: -90, x: -h.v * step, pose: { ...HOP(h.u), eyes: 'happy', mouth: 'open', blush: 1.2, head: { yaw: 78 * look, roll: 6 * look } } }; }
        const X = -N * step;
        if (t < t0 + run + .4) { const e = (t - t0 - run) / .4; return { th: lerp(-90, 62, EASE.io(e)), x: X, pose: { eyes: 'happy', mouth: 'open', sq: lerp(.9, 1, e) } }; }
        if (t < t1 + lag - .3) return { th: 62, x: X, pose: t > tTag + .1 && t < tTag + .5 ? { y: -10 * sin(PI * (t - tTag - .1) / .4), eyes: 'wide', mouth: 'open', tailUp: .7 } : laugh(t - t0 - run - .4) };
        if (t < t1 + lag) return { th: lerp(62, 90, EASE.io((t - (t1 + lag - .3)) / .3)), x: X, pose: { sq: .92, lean: 6, eyes: 'focus', mouth: 'open' } };
        if (t < tEnd) { const h = hops(t, t1 + lag); return { th: 90, x: X + h.v * step, pose: { ...HOP(h.u), eyes: 'focus', mouth: 'open' } }; }
        const e = t - tEnd;
        if (e < .35) return { th: lerp(90, 62, EASE.io(e / .35)), x: 0, pose: { sq: lerp(.88, 1, e / .35), eyes: 'happy', mouth: 'open' } };
        return { th: 62, x: 0, pose: laugh(e - .35) };
      };
      const chaser = (t) => {
        if (t < .5) return { ...tw({ th: TH0 }, { th: 66, pose: bow }, EASE.io(t / .5)), x: 0 };
        if (t < t0 + lag - .2) { const w = sin(t * 16) * 3; return { th: 66 + w, x: 0, pose: { ...bow, roll: w * .5 } }; }
        if (t < t0 + lag) return { ...tw({ th: 66, pose: bow }, { th: 90, pose: { sq: .9, lean: 10, eyes: 'focus', mouth: 'open' } }, (t - (t0 + lag - .2)) / .2), x: 0 };
        if (t < tTag) { const h = hops(t, t0 + lag); return { th: 90, x: h.v * step, pose: { ...HOP(h.u), eyes: 'focus', mouth: 'open' } }; }
        const X = N * step;
        if (t < tTag + .3) { const e = (t - tTag) / .3; return { th: lerp(90, 66, EASE.io(e)), x: X, pose: { sq: lerp(.88, 1, e), lean: lerp(-6, 0, e), eyes: 'happy', mouth: 'open' } }; }
        if (t < t1 - .5) return { th: 66, x: X, pose: { y: -8 * Math.abs(sin((t - tTag - .3) * 9)), eyes: 'happy', mouth: 'open', blush: 1.2, tailUp: .5 } };       // 「抓到了！換你追我」
        if (t < t1) { const e = (t - (t1 - .5)) / .5, eb = EASE.io(clamp((e - .15) / .85, 0, 1)), th = lerp(66, -90, eb), hy = clamp(lerp(66, -90, EASE.out(clamp(e / .7, 0, 1))) - th, -40, 40); return { th, x: X, pose: { eyes: 'happy', mouth: 'open', sq: .95 - .03 * sin(PI * e), head: { yaw: hy } } }; }
        if (t < t1 + run) { const h = hops(t, t1), look = bump(t, t1 + hopT * Math.max(.6, N - 2.6), hopT * 2.2); return { th: -90, x: X - h.v * step, pose: { ...HOP(h.u), eyes: 'happy', mouth: 'open', blush: 1.2, head: { yaw: 78 * look, roll: 6 * look } } }; }
        const e = t - t1 - run;
        if (e < .4) return { th: lerp(-90, 62, EASE.io(e / .4)), x: 0, pose: { eyes: 'happy', mouth: 'open', sq: lerp(.9, 1, e / .4) } };
        return { th: 62, x: 0, pose: laugh(Math.max(0, e - .4) * .6) };
      };
      const close = (c, t) => (t > dur - .5 ? { ...tw(c, { th: TH0 }, EASE.io((t - (dur - .5)) / .5)), x: c.x } : c);
      return finish(ctx, dur, (t) => {
        const r = close(runner(t), t), c = close(chaser(t), t);
        const fr = bRuns ? { a: { th: c.th, pose: c.pose, dx: c.x }, b: { th: r.th, pose: r.pose, dx: -r.x } } : { a: { th: r.th, pose: r.pose, dx: r.x }, b: { th: c.th, pose: c.pose, dx: -c.x } };
        const ru = bRuns ? ctx.d - r.x : r.x, cu = bRuns ? c.x : ctx.d - c.x, away = bRuns ? 1 : -1;
        fr.world = [...(t > t0 && t < t0 + run ? [{ k: 'dust', u: ru - away * 14, h: 2, s: .6, o: .8 }] : []), ...(t > t1 && t < t1 + run ? [{ k: 'dust', u: cu + away * 14, h: 2, s: .6, o: .8 }] : []),
          ...floatUp('star', t, tTag + .05, (ru + cu) / 2, 150 * ctx.kk, .6, .8, 16),
          ...floatUp('sweat', t, tEnd + .5, cu - away * 16, 150 * Cz.k, 1, 1, -18), ...floatUp('sparkle', t, tEnd + .6, (ru + cu) / 2, 156 * ctx.kk, .8, 1.2, 18), ...floatUp('note', t, tEnd + .9, ru, 172 * R.k, .9, 1.1, 18)];
        fr.moves = true;
        return fr;
      });
    }
  };

  // ---- 並排曬太陽：各自坐好、仰頭瞇眼，一隻伸懶腰，慵懶的那隻打起盹；最後相視而笑 ---------------
  TYPES.sunbathe = {
    gap: (ctx) => polite(ctx, 146),
    build(ctx) {
      const pa = ctx.a.per, pb = ctx.b.per, sitA = { sq: .93, lean: -5, head: { pitch: -9, roll: 5 }, eyes: 'closed', mouth: 'smile', arms: { L: { hand: [-9, 134, 28] }, R: { hand: [9, 134, 28] } } };
      const br = (t, ph) => 1 + .012 * sin(t * 2 + ph);
      const sleeper = pb.act <= pa.act ? 'b' : 'a';
      const mk = (per, me, d0) => track([K(0, TH0), K(.7 + d0, 15, { eyes: 'happy', head: { pitch: -4 } }),
        ...(me !== sleeper ? [K(1.3, 12, { sq: 1.05, lean: -4, head: { pitch: -14 }, eyes: 'closed', mouth: 'open', arms: { L: { hand: [-34, 66, 6] }, R: { hand: [36, 62, 4] } } }), K(2.0, 12, { sq: 1.06, lean: -6, head: { pitch: -16, roll: 4 }, eyes: 'closed', mouth: 'open', arms: { L: { hand: [-38, 70, 2] }, R: { hand: [38, 66, 2] } } })] : []),
        K(2.6 + d0, 15, sitA), K(3.8, 15, { ...sitA, head: { pitch: me === sleeper ? 6 : -10, roll: me === sleeper ? 9 : 4 } }),
        K(5.4, 15, { ...sitA, head: { pitch: me === sleeper ? 10 : -9, roll: me === sleeper ? 10 : 5 } }),
        K(5.9, 15, { sq: .96, head: { pitch: 0, roll: 0 }, eyes: me === sleeper ? 'sleepy' : 'open', mouth: 'smile' }),
        K(6.5, 22, { head: { yaw: 34, roll: 4 }, eyes: 'happy', mouth: 'open', blush: 1.2 }), K(7.0, 22, { head: { yaw: 34, pitch: 8 }, eyes: 'happy' }), K(7.3, 22, { head: { yaw: 30 }, eyes: 'happy' }), K(8.0, 15)]);
      const A = mk(pa, 'a', 0), B = mk(pb, 'b', .25 + pb.delay * .5), su = ctx.d / 2, sl = sleeper === 'a' ? 16 : ctx.d - 16;
      return finish(ctx, 8.0, (t) => {
        const a = A(t), b = B(t);
        if (t > 2.6 && t < 5.6) { a.pose.sq *= br(t, 0); b.pose.sq *= br(t, 1.6); }
        const tw = (t0, u, h, s) => (t > t0 && t < 5.9 ? [{ k: 'sparkle', u, h, s: s * (0.75 + .25 * sin(t * 3 + u)), o: Math.min(1, (t - t0) * 2, (5.9 - t) * 2) }] : []);
        return { a, b, world: [...tw(1.6, su, 232 * ctx.kk, 1.5), ...tw(2.0, su - 34, 214 * ctx.kk, .8), ...tw(2.3, su + 30, 250 * ctx.kk, .7),
          ...(t > 3.4 && t < 5.7 ? [{ k: 'zzz', u: sl + 18, h: 178 * ctx[sleeper].k + ((t - 3.4) % 1.2) * 6, s: 1, o: Math.min(1, (5.7 - t) * 3) }] : [])] };
      });
    }
  };

  // 情侶貼近：先在禮貌距離站好，再各自往中間蹭兩小步（騰空時才位移，不滑步）。回傳 { dx(t), hop(t) }
  function scoot(ctx, units, t1, n = 2, stepT = .3) {
    const m = Math.max(0, (ctx.d - units * ctx.kk) / 2), t2 = t1 + n * stepT;
    const prog = (t) => { const v = clamp((t - t1) / stepT, 0, n), i = Math.min(n - 1, Math.floor(v)); return (i + EASE.io(v - i)) / n; };
    return { m, t2, a: (t) => m * prog(t), b: (t) => -m * prog(t), hop: (t) => (t > t1 && t < t2 ? -7 * sin(PI * (((t - t1) / stepT) % 1)) : 0) };
  }
  const br2 = (t, ph) => 1 + .014 * sin(t * 1.9 + ph);

  // ---- 依偎（情侶）：轉向正面、蹭到肩並肩、頭靠在一起、冒愛心 -----------------------------------
  TYPES.cuddle = {
    couple: true,
    gap: (ctx) => polite(ctx, 104),
    build(ctx) {
      const lean = (r, hr) => ({ roll: r, head: { roll: hr, pitch: 4 }, eyes: 'closed', mouth: 'smile', blush: 1.5, sq: .97 });
      const S = scoot(ctx, 74, .8), T1 = S.t2;
      const mk = (per, d0, hrK) => track([K(0, TH0), K(.7, 15, { eyes: 'happy', head: { yaw: 24 }, blush: 1.3 }), K(T1, 12, { eyes: 'happy', head: { yaw: 12 }, mouth: 'open', blush: 1.4 }),
        K(T1 + .8 + d0, 10, lean(4.5, 11 * hrK)), K(T1 + 2.4, 10, lean(5, 13 * hrK)), K(T1 + 4.0, 10, lean(4.5, 11 * hrK)), K(T1 + 4.8, 10, lean(5, 13 * hrK)),
        K(T1 + 5.5, 12, { head: { yaw: 16, roll: 4 }, eyes: 'happy', mouth: 'open', blush: 1.5 }), K(T1 + 6.2, 12, { head: { yaw: 12 }, eyes: 'happy', blush: 1.3 }), K(T1 + 6.8, 15)]);
      const A = mk(ctx.a.per, 0, 1), B = mk(ctx.b.per, .15 + ctx.b.per.delay * .5, .9), m = ctx.d / 2, top = 178 * ctx.kk;
      const end = T1 + 6.8, dur = end + linger(ctx);
      return finish(ctx, dur, (t) => {
        const a = A(Math.min(t, end)), b = B(Math.min(t, end));
        a.dx = S.a(t); b.dx = S.b(t); a.pose.y = (a.pose.y || 0) + S.hop(t); b.pose.y = (b.pose.y || 0) + S.hop(t - .05);
        if (t > T1 + .9 && t < T1 + 4.8) { a.pose.sq *= br2(t, 0); b.pose.sq *= br2(t, .5); }
        return { a, b, near: 'b', moves: true, world: [...floatUp('heart', t, T1 + 1.2, m - 6, top, 1.1, 1.8, 30), ...floatUp('heart', t, T1 + 2.4, m + 12, top + 6, .75, 1.7, 28), ...floatUp('heart', t, T1 + 3.7, m - 2, top, .95, 1.8, 30), ...floatUp('heart', t, end - .2, m, top, .8, 1.3, 18)] };
      });
    }
  };

  // ---- 理毛（情侶）：b 面向前方、把頭歪過來；a 側身用前爪輕輕梳牠頭側的毛。手臂保持自然彎曲（不伸成直線） ----
  const HEADSIDE = [21, 33, 8];
  const GROOM_HEAD = { pitch: 16, yaw: -70 };                  // 理毛那隻的頭（見 test/social-anim.test.js：鼻子離對方耳朵要有距離）                                 // 頭頂靠對方那一側（耳朵下面）
  function groomFit(ctx) {
    let A, ha, Bp, tg, hr = 22, sq = .94, y = 76;
    const sideOf = (c) => fwd(ctx.b, pt(c.th, c.pose, HEADSIDE, true, ctx.b.hs));
    for (let i = 0; i < 8; i++) {
      Bp = { th: 18, pose: { sq, roll: 6, head: { roll: hr, pitch: 5 } } }; tg = sideOf(Bp);
      A = { th: 64, pose: { lean: 13, arms: { L: { hand: [-12, y, 31] }, R: { hand: [9, y + 14, 30] } } } }; ha = handsOf(ctx.a, A).L;
      const err = (tg.h + 2 * ctx.kk - ha.h);                    // 手要在頭側的上面一點
      if (Math.abs(err) < 1.5) break;
      const ny = clamp(y - err / ctx.a.k * .8, 72, 96);
      if (ny === y && err > 0) { hr = Math.min(34, hr + 3); sq = Math.max(.86, sq - .02); }   // 手舉不了更高：b 頭再歪一點、坐低一點
      y = ny;
    }
    return { A, Bp, ha, tg, y, gap: ha.f + tg.f - 1 * ctx.kk };
  }
  TYPES.groom = {
    couple: true,
    gap: (ctx) => clamp(groomFit(ctx).gap, 62 * ctx.kk, 110 * ctx.kk),
    build(ctx) {
      const F = groomFit(ctx), pb = ctx.b.per, y = F.y, bp = F.Bp.pose;
      const st = (z, yy, rz, ry) => ({ L: { hand: [-12, y + yy, 31 + z] }, R: { hand: [9, y + 14 + ry, 30 + rz] } });
      // 頭：低頭看著自己的前爪、臉轉向鏡頭一點，鼻子不貼到對方的耳朵（梳的是耳朵下面的毛，用爪子不用鼻子）
      const HP = GROOM_HEAD.pitch, HY = GROOM_HEAD.yaw;
      const aKeys = [K(0, TH0), K(.9, 62, { eyes: 'happy', mouth: 'smile', head: { pitch: 4, yaw: HY * .5 } }), K(1.6, 64, { lean: 13, arms: st(-3, 6, -6, 8), eyes: 'happy', head: { pitch: HP, yaw: HY } })];
      for (let i = 0; i < 4; i++) { const t0 = 1.9 + i * .95; aKeys.push(K(t0, 64, { lean: 13, arms: st(0, 0, -5, 6), eyes: 'happy', mouth: 'smile', head: { pitch: HP, yaw: HY, roll: -3 } }), K(t0 + .5, 64, { lean: 13, arms: st(-4, 8, 0, 0), eyes: 'happy', mouth: i % 2 ? 'open' : 'smile', head: { pitch: HP + 1, yaw: HY + 2, roll: 3 } })); }
      aKeys.push(K(6.0, 62, { lean: 5, eyes: 'happy', mouth: 'open', head: { yaw: HY * .8 }, arms: { L: { hand: [-14, 104, 30] }, R: { hand: [10, 110, 28] } } }), K(6.7, 62, { eyes: 'happy', mouth: 'smile', blush: 1.3 }), K(7.5, TH0));
      const A = track(aKeys);
      const bow = (dr, ef) => ({ ...bp, head: { ...bp.head, roll: bp.head.roll + dr }, eyes: 'closed', mouth: 'smile', blush: 1.6, earFlop: ef });
      const bKeys = [K(0, TH0), K(.7, 30, { eyes: 'happy', blush: 1.3, head: { yaw: 20 } }), K(1.5, 18, bow(0, { L: 0, R: 0 }))];
      for (let i = 0; i < 4; i++) { const t0 = 1.9 + i * .95; bKeys.push(K(t0, 18, bow(1.5, { L: 0, R: 2 })), K(t0 + .5, 18, { ...bow(-1.5, { L: 0, R: 9 }), tailUp: .2 })); }
      bKeys.push(K(6.1, 22, { eyes: 'happy', mouth: 'open', blush: 1.6, head: { yaw: 20 } }), K(6.4, 22, { head: { roll: 8 }, earFlop: { L: 11, R: -7 }, eyes: 'closed', blush: 1.5 }), K(6.6, 22, { head: { roll: -8 }, earFlop: { L: -7, R: 11 }, eyes: 'closed', blush: 1.5 }),
        K(6.85, 30, { head: { roll: 3, yaw: 24 }, eyes: 'happy', mouth: 'open', blush: 1.5, y: pb.lively ? -8 : 0 }), K(7.5, 45));
      const B = track(bKeys), hu = F.ha.f, hh = F.ha.h;
      const dur = 7.5 + linger(ctx);
      return finish(ctx, dur, (t) => ({ a: A(Math.min(t, 7.5)), b: B(Math.min(t, 7.5)), near: 'a', world: [...floatUp('heart', t, 2.6, hu + 26, hh + 44, .9, 1.7, 26), ...floatUp('heart', t, 4.4, hu + 10, hh + 50, .7, 1.6, 26), ...floatUp('sparkle', t, 3.5, hu + 40, hh + 30, .6, 1.2, 20), ...floatUp('heart', t, 7.3, hu, hh + 44, .7, 1.3, 16)] }));
    }
  };

  // ---- 靠著打盹（情侶）：a 打呵欠、把頭靠在 b 肩上；b 也瞇眼睡著；最後 a 先醒、兩隻相視而笑 -------
  TYPES.leanNap = {
    couple: true,
    gap: (ctx) => polite(ctx, 104),
    build(ctx) {
      const S = scoot(ctx, 84, .9), T1 = S.t2;
      const napA = (hr, p) => ({ roll: 9, sq: .93, head: { roll: hr, pitch: p }, eyes: 'closed', mouth: 'smile', blush: 1.3, arms: { L: { hand: [-8, 132, 28] }, R: { hand: [8, 132, 28] } } });
      const napB = (p, hr) => ({ sq: .97, head: { pitch: p, roll: hr }, eyes: 'closed', mouth: 'smile', blush: 1.2 });
      const A = track([K(0, TH0), K(.7, 20, { eyes: 'sleepy', head: { pitch: 2 } }), K(T1 + .1, 20, { sq: 1.03, head: { pitch: -10 }, eyes: 'closed', mouth: 'open' }), K(T1 + .6, 20, { eyes: 'sleepy', mouth: 'smile', head: { yaw: 20 } }),
        K(T1 + 1.5, 20, napA(21, 8)), K(T1 + 3.3, 20, napA(23, 10)), K(T1 + 5.1, 20, napA(21, 8)), K(T1 + 5.8, 20, { roll: 4, head: { roll: 10, pitch: 4 }, eyes: 'sleepy', mouth: 'smile' }),
        K(T1 + 6.4, 18, { head: { yaw: 24 }, eyes: 'happy', mouth: 'open', blush: 1.4 }), K(T1 + 7.0, 18, { head: { yaw: 20 }, eyes: 'happy', blush: 1.3 }), K(T1 + 7.6, 15)]);
      const B = track([K(0, TH0), K(.8, 20, { eyes: 'open', head: { yaw: 22 } }), K(T1 + 1.2, 20, { eyes: 'happy', head: { yaw: 26, pitch: 6 }, blush: 1.4 }), K(T1 + 2.0, 20, { eyes: 'sleepy', head: { pitch: 4, roll: 3 } }),
        K(T1 + 2.7, 20, napB(8, 5)), K(T1 + 4.1, 20, napB(11, 6)), K(T1 + 5.5, 20, napB(8, 5)), K(T1 + 6.1, 20, { eyes: 'sleepy', head: { pitch: 2 } }), K(T1 + 6.35, 20, { eyes: 'wide', head: { pitch: -3 } }),
        K(T1 + 6.7, 18, { head: { yaw: 24 }, eyes: 'happy', mouth: 'open', blush: 1.4 }), K(T1 + 7.0, 18, { head: { yaw: 20 }, eyes: 'happy' }), K(T1 + 7.6, 15)]);
      const end = T1 + 7.6, dur = end + linger(ctx), d1 = ctx.d - 2 * S.m;
      return finish(ctx, dur, (t) => {
        const a = A(Math.min(t, end)), b = B(Math.min(t, end));
        a.dx = S.a(t); b.dx = S.b(t); a.pose.y = (a.pose.y || 0) + S.hop(t); b.pose.y = (b.pose.y || 0) + S.hop(t - .05);
        if (t > T1 + 1.5 && t < T1 + 5.5) { a.pose.sq *= br2(t, 0); b.pose.sq *= br2(t, .8); }
        const zu = ctx.d - S.m + 24 * ctx.kk;
        return { a, b, near: 'a', moves: true, world: [...(t > T1 + 2.8 && t < T1 + 5.6 ? [{ k: 'zzz', u: zu, h: 176 * ctx.b.k + ((t - T1 - 2.8) % 1.3) * 6, s: 1, o: Math.min(1, (t - T1 - 2.8) * 2, (T1 + 5.6 - t) * 3) }] : []),
          ...floatUp('heart', t, T1 + 1.8, ctx.d / 2, 180 * ctx.kk, .8, 1.6, 24), ...floatUp('heart', t, T1 + 6.6, ctx.d / 2, 180 * ctx.kk, .9, 1.3, 20)] };
      });
    }
  };

  // ---- 並肩散步（情侶）：轉向同一邊、後面的跳上前貼著，一起跳幾步，前面的回頭看、冒愛心，停下來相視 --------
  TYPES.walkTogether = {
    couple: true,
    gap: (ctx) => polite(ctx, 106),
    build(ctx) {
      // 往空間大的那邊走；dirW＝沿 a 軸的方向（+1＝往 b 那邊）
      const dirW = ctx.room.b >= ctx.room.a ? 1 : -1, room = dirW > 0 ? ctx.room.b : ctx.room.a;
      const step = 36 * ctx.kk, N = clamp(Math.floor((room - 20) / step), 1, 6), hopT = .42, t0 = 1.15, run = N * hopT;
      const lead = dirW > 0 ? 'b' : 'a', close = Math.max(0, ctx.d - 52 * ctx.kk);       // 後面那隻先跳上前這麼多
      const one = (me, t) => {
        const face = (me === 'a' ? 1 : -1) * dirW;                              // 標準式：面向對方＝正
        const ph = me === lead ? 0 : .07, tt = t - ph, base = me === lead ? 0 : dirW * close;
        if (tt < .6) return { th: lerp(TH0, 80 * face, EASE.io(clamp(tt / .6, 0, 1))), dx: 0, pose: { eyes: 'happy', mouth: 'smile', blush: 1.3 } };
        if (tt < t0) { const u = clamp((tt - .65) / .42, 0, 1); return me === lead ? { th: 80 * face, dx: 0, pose: { eyes: 'happy', mouth: 'smile', blush: 1.3, head: { yaw: -face * 50 * sin(PI * u) } } } : { th: 80 * face, dx: base * EASE.io(u), pose: { ...HOP(u), eyes: 'happy', mouth: 'open', blush: 1.3 } }; }
        const v = clamp((tt - t0) / hopT, 0, N);
        if (v < N) {
          const i = Math.floor(v), u = v - i, h = HOP(u);
          const back = me === lead ? bump(tt, t0 + hopT * Math.max(.5, N - 3.2), hopT * 2.2) : 0;
          return { th: 80 * face, dx: base + dirW * (i + EASE.io(u)) * step, pose: { ...h, y: h.y * .7, lean: 8, eyes: 'happy', mouth: me === lead ? 'open' : 'smile', blush: 1.4, head: { yaw: -face * 62 * back } } };
        }
        // 停下：前面那隻再多跳半步讓出一點空間，兩隻轉向正面、相視而笑
        const e = tt - t0 - run, u2 = clamp(e / .34, 0, 1), extra = me === lead ? dirW * 22 * ctx.kk * EASE.io(u2) : 0;
        return { th: lerp(80 * face, 15, EASE.io(clamp((e - .2) / .5, 0, 1))), dx: base + dirW * N * step + extra, pose: { y: me === lead ? -8 * sin(PI * u2) : 0, eyes: 'happy', mouth: e > .7 ? 'open' : 'smile', blush: 1.5, head: { yaw: 22 * clamp((e - .6) * 3, 0, 1), roll: e > .8 ? 5 * sin((e - .8) * 5) : 0 }, sq: e < .2 && me !== lead ? lerp(.92, 1, e / .2) : 1 } };
      };
      const dur = t0 + run + 1.9 + linger(ctx);
      return finish(ctx, dur, (t) => {
        const a = one('a', t), b = one('b', t);
        if (t > dur - .4) { const e = EASE.io((t - (dur - .4)) / .4); for (const c of [a, b]) if (c.pose.head) c.pose.head.yaw = (c.pose.head.yaw || 0) * (1 - e); }
        const mid = (a.dx + ctx.d + b.dx) / 2, hs = [];
        for (let i = 1; i < N; i += 2) hs.push(...floatUp('heart', t, t0 + i * hopT, dirW * i * step + ctx.d / 2 - dirW * 30, 180 * ctx.kk, .8, 1.3, 22));
        return { a, b, near: lead, moves: true, world: [...hs, ...floatUp('heart', t, t0 + run + .5, mid, 184 * ctx.kk, 1.1, 1.3, 24)] };
      });
    }
  };

  // ---- 爸爸碰鼻小袋鼠：a＝爸爸彎下腰，b＝小袋鼠踮腳抬頭；碰一下，小袋鼠開心地跳 -------------------
  function dadFit(ctx) {
    const J = { th: 72, pose: { sq: 1.05, lean: 6, head: { pitch: -16 } } }, nj = noseOf(ctx.b, J);
    let lean = 30, D;
    for (let i = 0; i < 14; i++) { D = { th: 74, pose: { lean, sq: .93, head: { pitch: 16, roll: 8 } } }; const nd = noseOf(ctx.a, D); lean = clamp(lean + (nd.h - nj.h) / ctx.a.k * .6, 0, 66); }
    const nd = noseOf(ctx.a, D);
    return { J, D, nj, nd, gap: nd.f + nj.f + 4.5 * ctx.b.k };
  }
  TYPES.dadNose = {
    family: true,
    gap: (ctx) => dadFit(ctx).gap,
    build(ctx) {
      const F = dadFit(ctx), low = F.D.pose.lean > 34 ? { arms: { L: { hand: [-9, 156, 34] }, R: { hand: [9, 156, 34] } } } : {};
      const A = track([K(0, TH0), K(.7, 66, { eyes: 'happy', head: { pitch: 12 } }), K(1.6, 74, { ...F.D.pose, ...low, eyes: 'happy', mouth: 'smile' }),
        K(2.0, 74, { ...F.D.pose, ...low, eyes: 'closed', mouth: 'smile', blush: 1.3 }), K(3.2, 74, { ...F.D.pose, ...low, head: { ...F.D.pose.head, roll: 5 }, eyes: 'closed', mouth: 'smile', blush: 1.3 }),
        K(4.0, 68, { lean: 8, head: { pitch: 14 }, eyes: 'happy', mouth: 'open' }), K(5.0, 64, { head: { pitch: 12 }, eyes: 'happy', mouth: 'smile' }), K(5.8, TH0)]);
      const B = track([K(0, TH0), K(.8, 64, { eyes: 'wide', head: { pitch: -10 } }), K(1.2, 66, { y: -8, eyes: 'happy', mouth: 'open', head: { pitch: -12 }, tailUp: .7 }, 'out'), K(1.4, 66, { sq: .94, eyes: 'happy', head: { pitch: -12 } }, 'in'),
        K(1.9, 72, { ...F.J.pose, eyes: 'happy', mouth: 'smile' }), K(2.1, 72, { ...F.J.pose, eyes: 'closed', mouth: 'smile', blush: 1.5 }), K(3.2, 72, { ...F.J.pose, eyes: 'closed', mouth: 'smile', blush: 1.5, head: { ...F.J.pose.head, roll: -4 } }),
        K(3.7, 66, { sq: .92, eyes: 'happy', mouth: 'open', head: { pitch: -10 } }), K(3.95, 66, { y: -14, sq: 1.05, eyes: 'happy', mouth: 'open', tailUp: .9, arms: { L: { hand: [-30, 76, 8] }, R: { hand: [30, 76, 8] } } }, 'out'), K(4.2, 66, { sq: .92, eyes: 'happy', mouth: 'open' }, 'in'),
        K(4.45, 66, { y: -12, sq: 1.05, eyes: 'happy', mouth: 'open', tailUp: .9, arms: { L: { hand: [-30, 76, 8] }, R: { hand: [30, 76, 8] } } }, 'out'), K(4.7, 66, { sq: .93, eyes: 'happy', mouth: 'open' }, 'in'), K(5.8, TH0, { eyes: 'happy' })]);
      const cu = F.nd.f + 1.3 * ctx.b.k, ch = F.nj.h;
      return finish(ctx, 5.8, (t) => ({ a: A(t), b: B(t), near: 'b', world: [...floatUp('heart', t, 2.2, cu, ch + 26, .9, 1.6, 30), ...floatUp('sparkle', t, 2.5, cu - 10, ch + 18, .6, 1.2, 22), ...floatUp('heart', t, 4.0, ctx.d - 4, ch + 40, .7, 1.4, 24)] }));
    }
  };

  // =====================================================================================
  // 一起打球：球是場景裡的獨立物件，永遠連續運動（兩個接觸點之間走拋物線）；
  // 擊球／接球那一格，球的位置＝拍面中心或手掌（用 render() 回傳的手掌座標＋球拍幾何算出來）
  // =====================================================================================
  const GRAV = 900;
  // 一段飛行：從 p0 到 p1 花 F 秒；drag>1 時前快後慢（羽毛球）
  function flight(p0, p1, T0, F, g = GRAV, drag = 1) {
    return (t) => {
      const q = clamp((t - T0) / F, 0, 1), w = drag === 1 ? q : 1 - Math.pow(1 - q, drag), tau = q * F;
      const u = lerp(p0.u, p1.u, w), h = p0.h + (p1.h - p0.h) * q + .5 * g * tau * (F - tau);
      const e = .01, q2 = Math.min(1, q + e), w2 = drag === 1 ? q2 : 1 - Math.pow(1 - q2, drag), tau2 = q2 * F;
      const du = lerp(p0.u, p1.u, w2) - u, dh = p0.h + (p1.h - p0.h) * q2 + .5 * g * tau2 * (F - tau2) - h;
      return { u, h, ang: Math.atan2(-dh, du || 1e-6) * 180 / PI, vu: du / (e * F), vh: dh / (e * F) };
    };
  }
  // 頭和視線跟著球
  function watch(c, o, footU, sgn, ball, w = .7) {
    const du = (ball.u - footU) * sgn, dh = ball.h - 135 * o.k, el = Math.atan2(dh, Math.abs(du) + 30) * 180 / PI;
    const p = c.pose, hd = p.head || (p.head = {});
    hd.pitch = lerp(hd.pitch || 0, clamp(-el * .55, -26, 14), w);
    p.look = [clamp(du / 60, -2, 2), clamp(-dh / 50, -2, 1.5)];
    return c;
  }
  const RK = (ang, hit, sw) => ({ t: 'racket', hand: 'L', ang, hit: !!hit, swoosh: !!sw });
  const faceOf = (o, c, ang) => { const h = handsOf(o, c).L, a = rad(ang), L = 40.5 * o.k; return { f: h.f + sin(a) * L, h: h.h + Math.cos(a) * L }; };
  const BAD = {
    ready: { th: 60, pose: { sq: .94, lean: 6, eyes: 'focus', mouth: 'smile', arms: { L: { hand: [-16, 106, 34] } } }, ang: 35 },
    over: {
      prep: { th: 52, pose: { sq: .97, lean: -7, head: { pitch: -14 }, eyes: 'focus', mouth: 'flat', arms: { L: { hand: [-34, 74, -8] }, R: { hand: [14, 96, 34] } } }, ang: -55 },
      hit: { th: 66, pose: { y: -5, sq: 1.04, lean: 5, head: { pitch: -10 }, eyes: 'focus', mouth: 'open', tailUp: .5, arms: { L: { hand: [-16, 62, 28] } } }, ang: 18 },
      follow: { th: 70, pose: { sq: .93, lean: 13, eyes: 'focus', mouth: 'open', arms: { L: { hand: [-8, 108, 40] } } }, ang: 125 }
    },
    serve: {
      prep: { th: 56, pose: { sq: .92, lean: 4, eyes: 'focus', mouth: 'flat', arms: { L: { hand: [-30, 120, -4] }, R: { hand: [12, 104, 40] } } }, ang: -140 },
      hit: { th: 64, pose: { sq: 1.0, lean: 6, eyes: 'focus', mouth: 'open', arms: { L: { hand: [-14, 116, 36] } } }, ang: 98 },
      follow: { th: 66, pose: { sq: 1.03, lean: 0, head: { pitch: -10 }, eyes: 'focus', mouth: 'open', arms: { L: { hand: [-16, 78, 30] } } }, ang: 22 }
    }
  };
  // 重用單人擊球動畫（quokka-anim.js 的 ANIMS，面向左）裡的一段關鍵姿勢：時間對齊到擊球那一刻 T。
  // toRight＝鏡射成面向右（標準式面向對方）；回傳 [{ t, th, pose, ease, rk, bo }]
  function borrow(name, t0, t1, hitT, T, toRight) {
    const A = ANIM.ANIMS && ANIM.ANIMS[name];
    if (!A) return null;
    return A.keys.filter((k) => k.t >= t0 - 1e-6 && k.t <= t1 + 1e-6).map((k) => {
      const c = toRight ? mirrorPose({ th: k.th, pose: k.pose }) : { th: k.th, pose: { ...k.pose } };
      const rk = k.pose.rk, bo = k.pose.bo;
      delete c.pose.rk; delete c.pose.bo;
      return { t: T + (k.t - hitT), th: c.th, pose: c.pose, ...(k.ease ? { ease: k.ease } : {}), rk: rk == null ? null : (toRight ? -rk : rk), bo };
    });
  }
  const SMASH = () => { const A = ANIM.ANIMS && ANIM.ANIMS.badminton; return A && A.hitT ? borrow('badminton', .72, 1.86, A.hitT, 0, true) : null; };
  const CHEER = (y) => ({ y, sq: y ? 1.05 : .93, eyes: 'happy', mouth: 'open', blush: 1.3, tailUp: y ? .8 : 0, arms: { L: { hand: [-36, 70, 6] }, R: { hand: [36, 70, 6] } } });
  const cheerKeys = (t, th = 30, n = 2) => { const ks = []; for (let i = 0; i < n; i++) ks.push(K(t + i * .5, th, CHEER(0)), K(t + .22 + i * .5, th, CHEER(-20), 'out'), K(t + .44 + i * .5, th, CHEER(0), 'in')); return ks; };
  const sorry = (per, t, th = 60) => (per.clingy || per.lazy
    ? [K(t, th, { eyes: 'happy', mouth: 'open', arms: { L: { hand: [-10, 100, 40] }, R: { hand: [10, 100, 40] } } }), K(t + .25, th, { eyes: 'happy', mouth: 'open', arms: { L: { hand: [-4, 100, 42] }, R: { hand: [4, 100, 42] } } }), K(t + .5, th, { eyes: 'happy', arms: { L: { hand: [-10, 100, 40] }, R: { hand: [10, 100, 40] } } }), K(t + .75, th, { eyes: 'happy', arms: { L: { hand: [-4, 100, 42] }, R: { hand: [4, 100, 42] } } })]
    : [K(t, th, { sq: .95, head: { pitch: 16, roll: -5 }, eyes: 'sad', mouth: 'flat' }), K(t + .8, th, { sq: .96, head: { pitch: 12, roll: 4 }, eyes: 'sad', mouth: 'flat' })]);
  // 誰贏：亂數；活潑、愛這種球的勝率略高
  const winA = (ctx, sport) => ctx.rnd() < clamp(.5 + .2 * (ctx.a.per.act - ctx.b.per.act) + (ctx.a.per.likes.includes(sport) ? .1 : 0) - (ctx.b.per.likes.includes(sport) ? .1 : 0), .25, .75);

  TYPES.badminton = {
    ball: true,
    gap: (ctx) => clamp(262 * ctx.kk, 220, 300),
    build(ctx) {
      const pl = [ctx.a, ctx.b], sg = [1, -1], base = [0, ctx.d], F = 1.12;
      const aWins = winA(ctx, 'badminton');
      let n = 3 + Math.floor(ctx.rnd() * 3); if (((n - 1) % 2 === 0) !== aWins) n += n >= 5 ? -1 : 1;
      const W = aWins ? 0 : 1, L = 1 - W;
      // 每一拍：誰打、什麼時候、腳往前後移多少（接球前移一小步到落點）、接觸點
      const off = [{}, {}];
      for (const i of [0, 1]) for (const kind of ['over', 'serve']) off[i][kind] = faceOf(pl[i], BAD[kind].hit, BAD[kind].hit.ang);
      // 最後一拍：跳起來殺球（重用單人羽球動畫的引拍、擊球、收拍）
      const SM = SMASH(), smHit = SM && SM.find((k) => Math.abs(k.t) < 1e-6);
      if (smHit) for (const i of [0, 1]) off[i].smash = faceOf(pl[i], smHit, smHit.rk);
      const hits = [], foot = [[[0, 0]], [[0, 0]]];
      for (let i = 0; i < n; i++) {
        const p = i % 2, T = 1.25 + i * F, kind = i === 0 ? 'serve' : (i === n - 1 && smHit) ? 'smash' : 'over';
        const st = i === 0 ? 0 : Math.round((ctx.rnd() * 30 - 12) * pl[p].k);
        foot[p].push([T - .66, foot[p][foot[p].length - 1][1]], [T - .36, st]);
        const o = off[p][kind];
        hits.push({ p, T, kind, st, c: { u: base[p] + sg[p] * (st + o.f), h: o.h } });
      }
      // 最後一球：落在輸的那隻前面，牠往前撲但來不及
      const last = hits[n - 1], smash = last.kind === 'smash', landU = base[L] + sg[L] * 50 * pl[L].k, Fl = smash ? .36 : F * 1.05, tL = last.T + Fl;
      const segs = [];
      for (let i = 0; i < n - 1; i++) segs.push({ t0: hits[i].T, t1: hits[i + 1].T, f: flight(hits[i].c, hits[i + 1].c, hits[i].T, F, GRAV, 1.45) });
      segs.push({ t0: last.T, t1: tL, f: flight(last.c, { u: landU, h: 4 }, last.T, Fl, smash ? 260 : GRAV, smash ? 1 : 1.45) });
      const bounce = flight({ u: landU, h: 4 }, { u: landU + sg[W] * 12, h: 3 }, tL, .3, 700);
      const restU = landU + sg[W] * 12, pick = tL + 2.0, end = tL + 3.3;
      const ballAt = (t) => {
        if (t < hits[0].T) { const c = hits[0].c, u = clamp((t - .75) / .5, 0, 1); return { u: c.u - sg[0] * 2, h: c.h + 26 * sin(PI * u) * pl[0].k + (1 - u) * 0, ang: -90, show: t > .6 }; }
        for (const s of segs) if (t <= s.t1) return { ...s.f(t), show: true };
        if (t < tL + .3) { const b = bounce(t); return { ...b, ang: lerp(60, 90, (t - tL) / .3) * sg[W] > 0 ? 100 : 80, show: true }; }
        return { u: restU, h: 3, ang: 90, show: t < pick };
      };
      const keysFor = (p) => {
        const ks = [K(0, TH0), K(.55, 60, BAD.ready.pose)], ang = [[0, 35], [.55, BAD.ready.ang]], flags = [];
        for (const h of hits.filter((x) => x.p === p)) {
          if (h.kind === 'smash') {
            ks.push(K(h.T - .7, 60, BAD.ready.pose)); ang.push([h.T - .7, BAD.ready.ang]);
            for (const k of SM) { ks.push({ ...k, t: h.T + k.t }); ang.push([h.T + k.t, k.rk, k.ease]); }
            flags.push(h.T); continue;
          }
          const S = BAD[h.kind];
          ks.push(K(h.T - .62, 60, BAD.ready.pose), K(h.T - .2, S.prep.th, S.prep.pose), K(h.T, S.hit.th, S.hit.pose, 'in'), K(h.T + .2, S.follow.th, S.follow.pose, 'out'), K(h.T + .6, 60, BAD.ready.pose));
          ang.push([h.T - .62, BAD.ready.ang], [h.T - .2, S.prep.ang], [h.T, S.hit.ang, 'in'], [h.T + .2, S.follow.ang, 'out'], [h.T + .6, BAD.ready.ang]);
          flags.push(h.T);
        }
        if (p === W) { ks.push(K(Math.max(tL + .1, last.T + .8), 60, BAD.ready.pose), ...cheerKeys(Math.max(tL + .35, last.T + 1.0), 30, 3), K(end - .5, 45, { eyes: 'happy', mouth: 'smile' }), K(end, TH0)); ang.push([Math.max(tL + .1, last.T + .8), BAD.ready.ang], [Math.max(tL + .6, last.T + 1.25), -20], [end - .5, 20]); }
        else {
          const lunge = { sq: .88, lean: 24, eyes: 'wide', mouth: 'o', arms: { L: { hand: [-10, 122, 44] } } };
          ks.push(K(tL - (smash ? .34 : .5), 60, BAD.ready.pose), K(tL - .04, 72, lunge), K(tL + .35, 72, { ...lunge, eyes: 'sad', mouth: 'flat' }), ...sorry(pl[L].per, tL + .7, 62).map((k) => ({ ...k, pose: { ...k.pose, arms: { ...(k.pose.arms || {}), L: { hand: [-16, 112, 30] } } } })),
            K(pick - .45, 78, { lean: 10, eyes: 'open', head: { pitch: 10 } }), K(pick, 80, { ...ANIM.FETCH.reach(1), arms: { L: { hand: [-16, 112, 30] }, R: { hand: [8, 142, 44] } } }), K(pick + .5, 62, { eyes: 'happy', mouth: 'open', arms: { R: { hand: [20, 84, 34] }, L: { hand: [-16, 110, 30] } } }), K(end - .4, 60, { eyes: 'happy' }), K(end, TH0));
          ang.push([tL - (smash ? .34 : .5), BAD.ready.ang], [tL - .04, 100], [tL + .7, 78], [end - .4, 70]);
          foot[p].push([tL - (smash ? .32 : .5), foot[p][foot[p].length - 1][1]], [tL - .06, foot[p][foot[p].length - 1][1] + 10 * pl[p].k]);
        }
        return { tr: track(ks), ang: pw(ang), dx: pw(foot[p]), flags };
      };
      const P = [keysFor(0), keysFor(1)];
      const res = finish(ctx, end, (t) => {
        const ball = ballAt(t), fr = { world: [], moves: true, near: 'b' };
        [0, 1].forEach((p) => {
          const c = P[p].tr(t), dx = P[p].dx(t), key = p ? 'b' : 'a';
          const mv = P[p].dx(t + .02) !== dx || P[p].dx(t - .02) !== dx;
          if (mv) { c.pose.y = (c.pose.y || 0) - 6; c.pose.tailUp = .4; }
          if (t > .5 && t < tL + .2 && ball.show) watch(c, pl[p], base[p] + sg[p] * dx, sg[p], ball, .65);
          const hitNow = P[p].flags.some((T) => t >= T - .02 && t < T + .1), sw = P[p].flags.some((T) => t >= T - .1 && t < T + .16);
          if (t > .4 && t < end - .35) c.pose.props = [RK(P[p].ang(t), hitNow, sw)];
          c.dx = sg[p] * dx; fr[key] = c;
        });
        if (ball.show) fr.world.push({ k: 'shuttle', u: ball.u, h: ball.h, rot: ball.ang, s: 1.45 });
        if (smash && t > last.T + .03 && t < tL) fr.world.push({ k: 'speed', u: ball.u - sg[W] * 22, h: ball.h + 16, rot: ball.ang, s: .9 });
        if (t >= tL && t < tL + .25) fr.world.push({ k: 'dust', u: landU, h: 2, s: .45 });
        if (t >= pick && t < end - .4) { /* 撿起來拿在手上：畫在輸的那隻的手邊 */ const c = fr[L ? 'b' : 'a']; c.pose.props = (c.pose.props || []).concat([{ t: 'shuttle', hand: 'R', off: [0, -8], rot: -90, s: 1.3 }]); }
        for (const tt of [.42, end - .36]) fr.world.push(...floatUp('sparkle', t, tt, 20, 110 * ctx.kk, .7, .5, 10), ...floatUp('sparkle', t, tt, ctx.d - 20, 110 * ctx.kk, .7, .5, 10));
        fr.world.push(...floatUp('star', t, tL + .5, base[W] + sg[W] * 10, 190 * pl[W].k, .7, 1.2, 20), ...floatUp('sparkle', t, tL + .9, base[W] - sg[W] * 14, 196 * pl[W].k, .8, 1.2, 20), ...floatUp('sweat', t, tL + .5, base[L] + sg[L] * 20, 150 * pl[L].k, 1, 1, -16));
        return fr;
      });
      res.info = { n, winner: W ? 'b' : 'a', hits, ballAt, tL };
      return res;
    }
  };

  // ---- 一起打排球：互相墊球（移到球下方 → 蹲低、雙手併成平台 → 往上送），最後跳起來輕扣或接住收尾 ---------
  const VB = {
    ready: { th: 62, pose: { sq: .9, lean: 8, eyes: 'focus', mouth: 'smile', arms: { L: { hand: [-5, 126, 40] }, R: { hand: [5, 126, 40] } } } },
    prep: { th: 66, pose: { sq: .8, lean: 14, head: { pitch: -12 }, eyes: 'focus', mouth: 'flat', arms: { L: { hand: [-4, 140, 46] }, R: { hand: [4, 140, 46] } } } },
    hit: { th: 66, pose: { sq: 1.04, lean: 3, head: { pitch: -18 }, eyes: 'focus', mouth: 'o', arms: { L: { hand: [-3, 116, 47] }, R: { hand: [3, 116, 47] } } } },
    follow: { th: 64, pose: { sq: 1.02, lean: 0, head: { pitch: -20 }, eyes: 'focus', mouth: 'open', arms: { L: { hand: [-3, 104, 45] }, R: { hand: [3, 104, 45] } } } },
    // 扣球：跳起來、身體往後仰，手掌在胸口前方「往前下方」拍（庫卡手短，舉不過頭；擊球點在臉的前下方，球不會掠過臉）
    spike: { th: 70, pose: { y: -34, sq: 1.06, lean: -6, tailUp: .9, head: { pitch: -14 }, eyes: 'focus', mouth: 'open', arms: { L: { hand: [-6, 92, 48], paw: 230 }, R: { hand: [14, 108, 26] } } } },
    // 接住：手往前伸、身體微微後仰（臉往後收），球落在伸出去的雙手上
    serve: { th: 64, pose: { sq: .96, lean: -2, eyes: 'happy', mouth: 'smile', head: { pitch: -10 }, arms: { L: { hand: [-6, 124, 46] }, R: { hand: [6, 126, 46] } } } },
    hold: { th: 64, pose: { sq: .97, lean: -5, eyes: 'happy', mouth: 'open', blush: 1.3, arms: { L: { hand: [-8, 114, 48] }, R: { hand: [8, 116, 48] } } } },
    // 墊球（標準式、時間相對擊球那一刻）：先蹲低把平台伸到球的落點等球 → 球落在前臂上 → 蹬直往上送。
    // 身體幾乎不前傾、頭往後仰看球：手永遠在臉的前下方，球最後一段不會經過臉
    bump: [
      { t: -.46, th: 64, pose: { sq: .9, lean: 3, eyes: 'focus', mouth: 'flat', head: { pitch: -20 }, arms: { L: { hand: [-4, 128, 46] }, R: { hand: [4, 128, 46] } } } },
      { t: -.16, th: 66, pose: { sq: .87, lean: 1, eyes: 'focus', mouth: 'flat', head: { pitch: -26 }, arms: { L: { hand: [-3, 136, 50] }, R: { hand: [3, 136, 50] } } } },
      { t: 0, th: 66, ease: 'in', pose: { sq: .9, lean: 0, eyes: 'focus', mouth: 'o', head: { pitch: -28 }, arms: { L: { hand: [-3, 133, 50] }, R: { hand: [3, 133, 50] } } } },
      { t: .06, th: 66, pose: { sq: .93, lean: -1, eyes: 'focus', mouth: 'o', head: { pitch: -28 }, arms: { L: { hand: [-3, 128, 50] }, R: { hand: [3, 128, 50] } } } },
      { t: .26, th: 64, ease: 'out', pose: { y: -8, sq: 1.07, lean: -4, tailUp: .6, eyes: 'focus', mouth: 'o', head: { pitch: -30 }, arms: { L: { hand: [-3, 108, 46] }, R: { hand: [3, 108, 46] } } } },
      { t: .5, th: 62, ease: 'in', pose: { sq: .95, lean: 2, eyes: 'focus', mouth: 'smile', head: { pitch: -18 }, arms: { L: { hand: [-5, 122, 42] }, R: { hand: [5, 122, 42] } } } }
    ]
  };
  TYPES.volleyball = {
    ball: true,
    gap: (ctx) => clamp(206 * ctx.kk, 170, 220),
    build(ctx) {
      const pl = [ctx.a, ctx.b], sg = [1, -1], base = [0, ctx.d], F = 1.06, R = 12, G = 450;   // 拋物線低一點：球斜斜地落到手上，不是從臉的正上方掉下來
      const aWins = winA(ctx, 'volleyball'), spike = ctx.rnd() < .6;
      let n = 3 + Math.floor(ctx.rnd() * 3); if (((n - 1) % 2 === 0) !== aWins) n += n >= 5 ? -1 : 1;
      const W = aWins ? 0 : 1, L = 1 - W;
      // 墊球：自己的關鍵姿勢（VB.bump）。擊球點＝那一格雙手掌心中間、往上一個球的半徑（球落在前臂／手腕上）
      const BUMP = VB.bump, bHit = BUMP.find((k) => Math.abs(k.t) < 1e-6);
      const off = [0, 1].map((i) => { const k = pl[i].k, m = handsOf(pl[i], bHit).mid, sp = handsOf(pl[i], { th: VB.spike.th, pose: { ...VB.spike.pose, y: VB.spike.pose.y * pl[i].per.amp } }).L, /* 跳的高度依個性（styled）放大 */ hd = handsOf(pl[i], VB.hold).mid; return { bump: { f: m.f + 3 * k, h: m.h + (R + 1) * k }, spike: { f: sp.f + (R - 2) * k, h: sp.h + 4 * k }, hold: { f: hd.f, h: hd.h + 10 * k } }; });
      const hits = [], foot = [[[0, 0]], [[0, 0]]];
      for (let i = 0; i < n; i++) {
        const p = i % 2, T = 1.3 + i * F, kind = spike && i === n - 1 && i > 0 ? 'spike' : 'bump';
        const st = i === 0 ? 0 : Math.round((ctx.rnd() * 28 - 10) * pl[p].k), o = off[p][kind];
        foot[p].push([T - .7, foot[p][foot[p].length - 1][1]], [T - .4, st]);
        hits.push({ p, T, kind, st, c: { u: base[p] + sg[p] * (st + o.f), h: o.h } });
      }
      const last = hits[n - 1], isSpike = last.kind === 'spike';
      const segs = [];
      for (let i = 0; i < n - 1; i++) segs.push({ t1: hits[i + 1].T, f: flight(hits[i].c, hits[i + 1].c, hits[i].T, F, G) });
      // 收尾：扣球 → 交給舞台的球（物理：落地彈、滾、停，輸的那隻去撿）；或另一隻接住
      const tC = last.T + F * .9, catchC = { u: base[L] + sg[L] * off[L].hold.f, h: off[L].hold.h };
      if (!isSpike) segs.push({ t1: tC, f: flight(last.c, catchC, last.T, F * .9, G) });
      const end = isSpike ? last.T + 1.9 : tC + 2.3;
      // 發球：雙手在腰前捧著球 → 輕輕往上一送、手放低變成平台 → 球落到平台上（球不會經過臉）
      const sv = handsOf(pl[0], VB.serve).mid, serveC = hits[0].c, tossC = { u: base[0] + sv.f, h: sv.h + 10 * pl[0].k }, toss = flight(tossC, serveC, .7, hits[0].T - .7, 220);
      const ballAt = (t) => {
        if (t < hits[0].T) { if (t <= .7) return { u: tossC.u, h: tossC.h, show: t > .45, spin: 0, toss: true }; const f = toss(t); return { ...f, show: true, spin: (t - .7) * 200 }; }
        for (const s of segs) if (t <= s.t1) return { ...s.f(t), show: true, spin: t * 260 };
        return { show: false };
      };
      const keysFor = (p) => {
        const ks = [K(0, TH0), K(.5, p === 0 ? VB.serve.th : 62, p === 0 ? VB.serve.pose : VB.ready.pose)];
        if (p === 0) ks.push(K(.7, VB.serve.th, { ...VB.serve.pose, eyes: 'focus' }), K(.86, 64, { sq: .98, lean: -2, head: { pitch: -18 }, eyes: 'focus', arms: { L: { hand: [-4, 116, 50] }, R: { hand: [4, 116, 50] } } }, 'out'));
        for (const h of hits.filter((x) => x.p === p)) {
          if (h.kind === 'spike') ks.push(K(h.T - .62, 62, VB.ready.pose), K(h.T - .3, 64, { sq: .8, lean: 6, eyes: 'focus', head: { pitch: -18 }, arms: { L: { hand: [-26, 110, 0] }, R: { hand: [20, 110, 10] } } }), K(h.T - .08, 64, { ...VB.spike.pose, y: -30, arms: { L: { hand: [-30, 66, 0] }, R: { hand: [14, 100, 30] } } }, 'out'), K(h.T, VB.spike.th, VB.spike.pose), K(h.T + .14, 70, { ...VB.spike.pose, y: -22, lean: -3, arms: { L: { hand: [-6, 110, 46] }, R: { hand: [14, 112, 26] } } }), K(h.T + .34, 64, { sq: .86, lean: 8, eyes: 'happy', mouth: 'open' }, 'in'));
          else { const first = h === hits[0]; if (!first) ks.push(K(h.T - .72, 62, VB.ready.pose)); for (const k of BUMP) if (!first || k.t > -.2) ks.push({ ...k, t: h.T + k.t }); ks.push(K(h.T + .78, 62, VB.ready.pose)); }
        }
        if (isSpike) {
          if (p === W) ks.push(...cheerKeys(last.T + .55, 30, 2), K(end - .4, 45, { eyes: 'happy' }), K(end, TH0));
          else ks.push(K(last.T - .1, 62, VB.ready.pose), K(last.T + .3, 70, { sq: .84, lean: 22, eyes: 'wide', mouth: 'o', arms: { L: { hand: [-5, 140, 46] }, R: { hand: [5, 140, 46] } } }), K(last.T + .8, 66, { sq: .95, eyes: 'wide', mouth: 'o', head: { pitch: 6 } }), K(last.T + 1.3, 62, { eyes: 'sad', mouth: 'flat', head: { pitch: 10 } }), K(end, TH0));
        } else if (p === L) ks.push(K(tC - .5, 62, VB.ready.pose), K(tC - .24, 64, { ...VB.hold.pose, lean: -6, eyes: 'focus', head: { pitch: -16 }, arms: { L: { hand: [-8, 112, 50] }, R: { hand: [8, 114, 50] } } }), K(tC, 64, VB.hold.pose), K(tC + .2, 60, { ...VB.hold.pose, sq: .92, lean: -8 }), K(tC + .6, 40, VB.hold.pose), K(tC + 1.0, 40, { ...VB.hold.pose, y: -14, tailUp: .7 }, 'out'), K(tC + 1.25, 40, { ...VB.hold.pose, sq: .93 }, 'in'), K(end - .5, 55, VB.hold.pose), K(end, TH0));
        else ks.push(...cheerKeys(tC + .4, 40, 2), K(end - .5, 55, { eyes: 'happy' }), K(end, TH0));
        // 接球的時段（球飛向自己手上的最後一段）
        const recv = hits.filter((x) => x.p === p).map((x) => [x.T - .55, x.T + .08]);
        if (p === 0) recv.push([.6, hits[0].T + .08]);
        if (!isSpike && p === L) recv.push([tC - .55, tC + .1]);
        return { tr: track(ks), dx: pw(foot[p]), recv };
      };
      const P = [keysFor(0), keysFor(1)];
      const res = finish(ctx, end, (t) => {
        const ball = ballAt(t), fr = { world: [], moves: true, near: 'b' };
        [0, 1].forEach((p) => {
          const c = P[p].tr(t), dx = P[p].dx(t), key = p ? 'b' : 'a';
          if (P[p].dx(t + .02) !== dx || P[p].dx(t - .02) !== dx) { c.pose.y = (c.pose.y || 0) - 6; c.pose.tailUp = .4; }
          if (ball.show && !ball.toss) {
            // 球快到自己手上時：頭維持往後仰（只用眼睛往下看球），臉不往球的方向湊過去
            const pk = (c.pose.head && c.pose.head.pitch) || 0, guard = P[p].recv.some(([a0, a1]) => t >= a0 && t <= a1);
            watch(c, pl[p], base[p] + sg[p] * dx, sg[p], ball, .6);
            if (guard) c.pose.head.pitch = Math.min(c.pose.head.pitch, pk);
          }
          c.dx = sg[p] * dx; fr[key] = c;
        });
        if (t <= .7 && t > .3) fr.a.pose.props = [{ t: 'vball', hand: 'both', off: [0, -10], s: Math.min(1, (t - .3) * 5) }];
        if (ball.show && !ball.toss) fr.world.push({ k: 'vball', u: ball.u, h: ball.h, rot: ball.spin });
        for (const h of hits) if (t >= h.T && t < h.T + (h.kind === 'spike' ? .1 : .16)) fr.world.push({ k: 'impact', u: h.c.u + sg[h.p] * 4 * ctx.kk, h: h.c.h - 4 * ctx.kk, s: h.kind === 'spike' ? .8 : .55 });
        if (!isSpike && t >= tC && t < end - .3) { const c = fr[L ? 'b' : 'a']; c.pose.props = [{ t: 'vball', hand: 'both', off: [0, -10] }]; }
        if (!isSpike) fr.world.push(...floatUp('sparkle', t, end - .3, catchC.u, catchC.h, .9, .4, 8), ...floatUp('star', t, tC + .3, ctx.d / 2, 190 * ctx.kk, .7, 1.2, 20));
        else fr.world.push(...floatUp('star', t, last.T + .6, base[W] + sg[W] * 10, 196 * pl[W].k, .7, 1.2, 20), ...floatUp('sweat', t, last.T + .7, base[L] + sg[L] * 18, 150 * pl[L].k, 1, 1, -16));
        fr.world.push(...floatUp('sparkle', t, .3, serveC.u, serveC.h, .8, .4, 8));
        return fr;
      });
      // 扣球之後：球交給舞台做物理，由輸的那隻去撿
      if (isSpike) { const tg = base[L] + sg[L] * 82 * pl[L].k, tt = .4; res.handoff = { t: last.T, kind: 'vball', u: last.c.u, h: last.c.h, vu: (tg - last.c.u) / tt, vh: (R * ctx.kk - last.c.h) / tt + .5 * 1500 * ctx.kk * tt, owner: L ? 'b' : 'a', from: W ? 'b' : 'a' }; }
      res.info = { n, winner: W ? 'b' : 'a', hits, ballAt, isSpike };
      return res;
    }
  };

  // ---- 一起打籃球：運球兩下 → 胸前傳球 → 接住（身體往後緩衝）→ 轉身跳投 → 進了一起歡呼碰掌／沒進球彈出來由傳球的去撿 ----
  const BB = {
    hold: { th: 60, pose: { arms: { L: { hand: [-7, 108, 40] }, R: { hand: [7, 110, 40] } }, eyes: 'happy' } },
    drib: (yy) => ({ sq: .93, lean: 10, eyes: 'focus', mouth: 'smile', head: { pitch: 8 }, arms: { L: { hand: [-12, yy, 40], paw: 170 }, R: { hand: [8, 118, 32] } } }),
    wind: { th: 62, pose: { sq: .95, lean: -4, eyes: 'focus', mouth: 'flat', arms: { L: { hand: [-7, 106, 30] }, R: { hand: [7, 108, 30] } } } },
    pass: { th: 66, pose: { sq: 1.0, lean: 10, eyes: 'focus', mouth: 'open', arms: { L: { hand: [-6, 102, 47] }, R: { hand: [6, 104, 47] } } } },
    catch: { th: 64, pose: { lean: 3, eyes: 'focus', mouth: 'o', arms: { L: { hand: [-6, 104, 46] }, R: { hand: [6, 106, 46] } } } },
    cushion: { th: 60, pose: { sq: .94, lean: -9, eyes: 'happy', mouth: 'open', arms: { L: { hand: [-7, 110, 36] }, R: { hand: [7, 112, 36] } } } },
    aim: { th: -62, pose: { sq: .83, lean: 8, eyes: 'focus', mouth: 'flat', head: { pitch: -10 }, arms: { L: { hand: [-7, 106, 40] }, R: { hand: [7, 108, 40] } } } },
    shot: { th: -64, pose: { y: -28, sq: 1.07, tailUp: .9, eyes: 'focus', mouth: 'o', head: { pitch: -12 }, arms: { L: { hand: [-6, 64, 46], paw: 150 }, R: { hand: [6, 62, 48], paw: 210 } } } },
    landed: { th: -60, pose: { sq: .88, lean: 4, eyes: 'focus', mouth: 'o', head: { pitch: -16 } } }
  };
  TYPES.basketball = {
    ball: true,
    gap: (ctx) => clamp(176 * ctx.kk, 150, 210),
    build(ctx) {
      // 籃框放在空間夠的那一側；靠籃框的那隻投籃，另一隻運球傳球
      const hoopB = ctx.room.b >= 150 * ctx.kk || ctx.room.b >= ctx.room.a;
      const SH = hoopB ? ctx.b : ctx.a, PS = hoopB ? ctx.a : ctx.b, sgS = hoopB ? -1 : 1, sgP = -sgS;   // 標準式的「往對方」在 a 軸上的方向
      const baseS = hoopB ? ctx.d : 0, baseP = hoopB ? 0 : ctx.d, R = 12 * ctx.kk, floor = R;
      const hs = 1.5, away = -sgS, room = hoopB ? ctx.room.b : ctx.room.a;
      const hoopU = baseS + away * clamp(room - 40, 70 * ctx.kk, 125 * ctx.kk), rimH = 132 * hs * ctx.kk;
      const rimC = { u: hoopU - away * 3 * hs * ctx.kk, h: rimH }, rimNear = hoopU - away * 20 * hs * ctx.kk;
      const make = ctx.rnd() < clamp(.55 + (SH.per.likes.includes('basketball') ? .15 : 0) + (SH.per.act - .5) * .2, .3, .85);
      // 接觸點
      // 跳投重用單人籃球動畫（蹲低蓄力 → 起跳 → 最高點出手 → 落地）；bo＝球相對雙手的位移
      const AB = ANIM.ANIMS && ANIM.ANIMS.basketball, relT = AB && AB.events && AB.events[0] ? AB.events[0].t : .98;
      const SHOT = AB ? borrow('basketball', .74, 1.54, relT, 0, false) : null, sRel = SHOT && SHOT.find((k) => Math.abs(k.t) < 1e-6);
      const dH = handsOf(PS, { th: 60, pose: BB.drib(126) }).L, pOut = handsOf(PS, BB.pass).mid, cIn = handsOf(SH, BB.catch).mid;
      const sM = handsOf(SH, sRel || BB.shot).mid, sOut = sRel ? { f: sM.f + (sRel.bo ? sRel.bo[0] : -6) * SH.k, h: sM.h - (sRel.bo ? sRel.bo[1] + 14 : 0) * SH.k } : sM;
      const dU = baseP + sgP * dH.f, dTop = dH.h - R * .9;
      const pass0 = { u: baseP + sgP * pOut.f + sgP * 8 * PS.k, h: pOut.h + 2 * PS.k }, pass1 = { u: baseS + sgS * cIn.f + sgS * 8 * SH.k, h: cIn.h + 2 * SH.k };
      const rel = { u: baseS + sgS * sOut.f, h: sOut.h + 14 * SH.k };
      const tD = .7, dT = .46, tPass = 2.15, tCatch = tPass + .5, tShot = tCatch + 1.55, Fs = .95, tRim = tShot + Fs;
      const pass = flight(pass0, pass1, tPass, .5, 420), shot = flight(rel, make ? rimC : { u: rimNear + away * 4, h: rimH + R * .7 }, tShot, Fs, 1100);
      const vEnd = shot(tRim - .001);
      // 進球：穿過籃網往下掉、彈兩下
      const fall = [];
      if (make) {
        const t1 = tRim + Math.sqrt(2 * (rimH - floor) / 1400) * 1.05;
        fall.push({ t0: tRim, t1, f: (t) => { const q = (t - tRim) / (t1 - tRim); return { u: rimC.u + away * 2 * q, h: lerp(rimH, floor, q * q) }; } });
        fall.push({ t0: t1, t1: t1 + .5, f: flight({ u: rimC.u + away * 2, h: floor }, { u: rimC.u - away * 12, h: floor }, t1, .5, 1300) });
        fall.push({ t0: t1 + .5, t1: t1 + .78, f: flight({ u: rimC.u - away * 12, h: floor }, { u: rimC.u - away * 22, h: floor }, t1 + .5, .28, 1300) });
      }
      const tDown = make ? fall[2].t1 : tRim;
      // 碰掌（進球後各自往中間跳兩步）
      const pawA = handsOf(ctx.a, PAW_HIT(yFor(ctx.a, 98 * ctx.kk) - 4)).R, pawB = handsOf(ctx.b, PAW_HIT(yFor(ctx.b, 98 * ctx.kk) - 4)).R;
      const gapPaw = pawA.f + pawB.f + 1.5 * ctx.kk, mv = Math.max(0, (ctx.d - gapPaw) / 2);
      const tCheer = tRim + .25, tGo = tCheer + 1.15, hopT = .36, tClap = tGo + 2 * hopT + .5, end = make ? tClap + 1.9 : tRim + 1.6;
      const five = (o, per) => { const c = PAW_HIT(yFor(o, 98 * ctx.kk) - 4), hy = c.pose.arms.R.hand[1]; return [
        K(tClap - .28, 50, { lean: -4, sq: .96, eyes: 'happy', mouth: 'open', arms: { R: { hand: [30, hy - 14, 18], paw: 150 } } }), K(tClap, 58, { ...c.pose, y: -7, eyes: 'happy', mouth: 'open', tailUp: .6, blush: 1.2 }, 'in'),
        K(tClap + .16, 58, { lean: 9, sq: .95, head: { yaw: -22, pitch: -6 }, eyes: 'happy', mouth: 'open', arms: { R: { hand: [24, hy + 2, 32], paw: 150 } }, blush: 1.2 }, 'out'), K(tClap + .8, 56, { eyes: 'happy', mouth: 'open', y: per.lively ? -10 : -3 }), K(tClap + 1.2, 58, { eyes: 'happy', sq: .96 }), K(end, TH0)]; };
      const hopKeys = (th) => [K(tGo - .25, th, { eyes: 'happy', mouth: 'open' }), K(tGo + 2 * hopT, th, { eyes: 'happy', mouth: 'open' })];
      const PK = [K(0, TH0), K(.45, 60, BB.hold.pose), K(tD, 62, BB.drib(124)), K(tD + dT * .3, 62, BB.drib(134)), K(tD + dT * .7, 62, BB.drib(120)), K(tD + dT, 62, BB.drib(124)), K(tD + dT * 1.3, 62, BB.drib(134)), K(tD + dT * 1.7, 62, BB.drib(120)), K(tD + dT * 2, 62, BB.drib(124)),
        K(tPass - .5, 60, BB.hold.pose), K(tPass - .2, 62, BB.wind.pose), K(tPass, 66, BB.pass.pose, 'in'), K(tPass + .2, 66, { ...BB.pass.pose, lean: 12, arms: { L: { hand: [-12, 108, 44] }, R: { hand: [12, 110, 44] } } }, 'out'), K(tPass + .7, 60, { eyes: 'focus', mouth: 'smile' }), K(tShot, 58, { eyes: 'wide', mouth: 'o', sq: .97 }), K(tRim, 58, { eyes: 'wide', mouth: 'o', sq: 1.02 }),
        ...(make ? [...cheerKeys(tCheer, 40, 2), ...hopKeys(80), ...five(PS, PS.per)] : [K(tRim + .25, 60, { eyes: 'wide', mouth: 'o', y: -8 }, 'out'), K(tRim + .5, 60, { eyes: 'wide', mouth: 'o', sq: .94 }, 'in'), K(end - .3, 45, { eyes: 'focus', mouth: 'smile', head: { yaw: -30 } }), K(end, TH0)])];
      const SK = [K(0, TH0), K(.6, 60, { eyes: 'happy', mouth: 'open' }), K(tPass - .4, 62, { sq: .94, lean: 6, eyes: 'focus', arms: { L: { hand: [-10, 108, 40] }, R: { hand: [10, 110, 40] } } }), K(tCatch - .1, 64, BB.catch.pose), K(tCatch, 64, BB.catch.pose), K(tCatch + .2, 60, BB.cushion.pose, 'out'),
        K(tCatch + .5, 50, { ...BB.hold.pose, eyes: 'happy' }), K(tCatch + .95, -55, { ...BB.hold.pose, eyes: 'focus', head: { pitch: -8 } }), ...(SHOT ? SHOT.map((k) => ({ ...k, t: tShot + k.t })) : [K(tShot - .35, BB.aim.th, BB.aim.pose), K(tShot - .08, -64, { ...BB.shot.pose, y: -22, arms: { L: { hand: [-6, 80, 42] }, R: { hand: [6, 78, 44] } } }, 'out'), K(tShot, BB.shot.th, BB.shot.pose),
        K(tShot + .3, BB.landed.th, BB.landed.pose, 'in')]), K(tRim, -58, { eyes: 'wide', mouth: 'o', head: { pitch: -16 } }),
        ...(make ? [K(tCheer, -30, CHEER(0)), K(tCheer + .22, 0, CHEER(-20), 'out'), K(tCheer + .44, 30, CHEER(0), 'in'), K(tCheer + .72, 40, CHEER(-18), 'out'), K(tCheer + .94, 40, CHEER(0), 'in'), ...hopKeys(80), ...five(SH, SH.per)]
          : [K(tRim + .3, -50, { eyes: 'wide', mouth: 'o', arms: { L: { hand: [-19, 70, 22] }, R: { hand: [19, 70, 22] } } }), K(tRim + .9, -20, { head: { pitch: 14 }, eyes: 'sad', mouth: 'flat', sq: .95 }), K(end, 15, { eyes: 'sad' })])];
      const PT = track(PK), ST = track(SK);
      const hopAt = (t) => { const v = clamp((t - tGo) / hopT, 0, 2), i = Math.min(1, Math.floor(v)), u = v - i; return { m: mv * (i + EASE.io(u)) / 2, u, on: make && v > 0 && v < 2 }; };
      const ballAt = (t) => {
        if (t < tD) return { held: 'P' };
        if (t < tD + 2 * dT) { const q = ((t - tD) % dT) / dT, e = q < .5 ? EASE.in(q * 2) : 1 - EASE.out((q - .5) * 2); return { u: dU, h: lerp(dTop, floor, e), spin: (t - tD) * 300 }; }
        if (t < tPass) return { held: 'P' };
        if (t < tCatch) return { ...pass(t), spin: t * 500 };
        if (t < tShot) return { held: 'S' };
        if (t < tRim) return { ...shot(t), spin: -t * 400 };
        if (make) { for (const s of fall) if (t <= s.t1) return { ...s.f(t), spin: t * 200 }; return { u: rimC.u - away * 22, h: floor, spin: 0 }; }
        return { gone: true };
      };
      const res = finish(ctx, end, (t) => {
        const ball = ballAt(t), p = PT(t), s = ST(t), fr = { world: [], moves: true, near: hoopB ? 'a' : 'b' };
        const h = hopAt(t);
        if (h.on) for (const c of [p, s]) { const hp = HOP(h.u); c.pose = { ...c.pose, y: hp.y * .7, sq: hp.sq, tailUp: hp.tailUp }; }
        p.dx = make ? sgP * h.m : 0; s.dx = make ? sgS * h.m : 0;
        if (ball.held === 'P') p.pose.props = [{ t: 'bball', hand: 'both', off: [0, -5], s: t < .45 ? Math.max(.05, (t - .2) * 4) : 1 }];
        if (ball.held === 'S') { const bo = SHOT && t > tShot - .3 ? pw([[tShot - .3, 0], [tShot - .24, -3], [tShot - .08, -7], [tShot, -10]])(t) : null; s.pose.props = [{ t: 'bball', hand: 'both', off: bo != null ? [-(6 * (bo / -10)), bo - 0] : [0, -5] }]; }
        if (ball.u != null) { fr.world.push({ k: 'bball', u: ball.u, h: ball.h, rot: ball.spin, o: ball.o }); if (t > tD) { watch(p, PS, baseP, sgP, ball, t < tPass ? .25 : .6); if (t > tPass) watch(s, SH, baseS, sgS, ball, .6); } }
        if (t < .45 && t > .2) p.pose.props = p.pose.props || [];
        const ho = Math.min(1, t * 3, (end - t) * 3);
        fr.world.push({ k: 'hoop', u: hoopU, h: rimH, s: hs, o: ho, back: true, mir: !hoopB });
        if (make) fr.world.push(...floatUp('star', t, tRim + .1, rimC.u, rimH + 20, .9, 1.1, 26), ...floatUp('sparkle', t, tRim + .2, rimC.u - away * 20, rimH + 6, .8, 1.1, 22),
          ...(t > tClap - .02 && t < tClap + .22 ? [{ k: 'impact', u: ctx.d / 2, h: pawA.h + 7 * ctx.kk, s: .8 }] : []), ...floatUp('sparkle', t, tClap + .1, ctx.d / 2, pawA.h + 30, .7, 1, 20));
        else fr.world.push(...(t >= tRim && t < tRim + .18 ? [{ k: 'impact', u: rimNear, h: rimH + 4, s: .6 }] : []), ...floatUp('sweat', t, tRim + .5, baseS - sgS * 16, 150 * SH.k, 1, 1, -16));
        fr[hoopB ? 'a' : 'b'] = p; fr[hoopB ? 'b' : 'a'] = s;
        return fr;
      });
      // 沒進：球打到框緣彈出來，交給舞台做物理，由傳球的那隻去撿
      // 球最後一定有人用手撿回來（不淡出）：
      //   進球：球掉在籃下停住 → 交給舞台，互動結束後由投籃的那隻走過去撿
      //   沒進：打到框緣高高彈起，越過兩隻的頭頂落在傳球那隻的背後 → 傳球的轉身去撿；背後沒空間就輕輕彈到投籃那隻的腳前（碰到身體會被擋下）
      const keyS = hoopB ? 'b' : 'a', keyP = hoopB ? 'a' : 'b', roomP = hoopB ? ctx.room.a : ctx.room.b;
      if (make) res.handoff = { t: tDown, kind: 'bball', u: rimC.u - away * 22, h: floor, vu: 0, vh: 0, owner: keyS };
      else {
        const u0 = rimNear - away * 3, h0 = rimH + R * .8, G = 1500 * ctx.kk;
        if (roomP >= 120 * ctx.kk) {
          // 拋物線要整段高過傳球那隻的頭（頭頂＋耳朵約 186 單位、再加球的半徑和一點餘裕）：不夠高就加大往上的速度
          const land = baseP - away * 100 * ctx.kk, clearH = 186 * PS.k + R + 8 * ctx.kk, halfW = 50 * PS.k + R;
          let vh = 640 * ctx.kk, tt = 0, vu = 0;
          for (; vh < 1600 * ctx.kk; vh += 20 * ctx.kk) {
            tt = (vh + Math.sqrt(vh * vh + 2 * G * (h0 - R))) / G; vu = (land - u0) / tt;
            let okPath = true;
            for (let q = 0; q <= 1; q += 1 / 80) { const t = q * tt, u = u0 + vu * t, h = h0 + vh * t - G * t * t / 2; if (Math.abs(u - baseP) < halfW && h < clearH) { okPath = false; break; } }
            if (okPath) break;
          }
          res.handoff = { t: tRim, kind: 'bball', u: u0, h: h0, vu, vh, owner: keyP, clear: { u: baseP, halfW, h: clearH } };
        }
        else res.handoff = { t: tRim, kind: 'bball', u: u0, h: h0, vu: -away * 55 * ctx.kk, vh: 210 * ctx.kk, owner: keyS };
      }
      res.info = { make, hoopU, rimH, rimC, ballAt, shooter: hoopB ? 'b' : 'a', tRim, tShot, tPass, tCatch };
      return res;
    }
  };

  const api = { TYPES, flight, watch, context, compose, real, mirrorPose, persona, pt, noseOf, handsOf, crownOf, mouthOf, yFor, K, track, pw, bump, floatUp, finish, styled, polite, tpl, worldItem, TH0, HOP, FOOT, NOSE, BELLY, worldDefs: () => { tpl('heart'); return worldDefs; } };
  if (!isNode) window.QuokkaSocial = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
