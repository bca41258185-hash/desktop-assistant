// 關鍵影格動畫：關鍵姿勢之間自動內插（緩入緩出），每一格交給 quokka-pose.js 畫。
// 一段動畫 = { dur, keys:[{t, th, pose}], props(t, st), events:[{t, name}] }
//   keys   關鍵姿勢；數值欄位（含巢狀的手、頭）會內插，文字欄位（眼睛、嘴巴）在中點切換
//   props  依時間回傳道具（球的飛行軌跡等）；st 是這一次播放的狀態（例如球已經丟出去了）
//   events 時間到了通知桌寵（例如「放手丟球」），由 pet.js 接手做真正的物理與撿球
(function () {
  const lerp = (a, b, t) => a + (b - a) * t;
  const EASE = {
    io: (u) => (u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),   // 緩入緩出
    out: (u) => 1 - (1 - u) * (1 - u),                                    // 快出慢停（揮擊、落地）
    in: (u) => u * u,                                                      // 慢起快收（蓄力後爆發）
    lin: (u) => u,
    back: (u) => { const c = 1.6; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); }  // 稍微超過再回來（有彈性）
  };
  function mix(a, b, t) {
    if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, t);
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((v, i) => mix(v, b[i], t));
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
      const o = {};
      new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => {
        if (k in a && k in b) o[k] = mix(a[k], b[k], t);
        else if (k in a) o[k] = (k === 'arms' || k === 'head') ? a[k] : (t < .5 ? a[k] : undefined);
        else o[k] = (k === 'arms' || k === 'head') ? b[k] : (t >= .5 ? b[k] : undefined);
      });
      return o;
    }
    return t < .5 ? a : b;
  }
  // 手：關鍵姿勢沒寫的手＝放在胸前；為了能內插，補上胸前的位置
  const REST = { L: { hand: [-6, 127, 30] }, R: { hand: [6, 127, 30] } };
  // 數值欄位沒寫的＝中立值，這樣才能平順內插（不會在中點突然跳）
  const NEUTRAL = { x: 0, y: 0, sq: 1, lean: 0, roll: 0, tailUp: 0, blush: 1, look: [0, 0] };
  const withArms = (p) => ({ ...NEUTRAL, ...p, head: { yaw: 0, pitch: 0, roll: 0, ...(p.head || {}) }, arms: { ...REST, ...(p.arms || {}) }, eyes: p.eyes || 'open', mouth: p.mouth || 'smile' });
  function sample(anim, time) {
    const keys = anim.keys, t = Math.max(0, Math.min(anim.dur, time));
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
    const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
    const span = b.t - a.t, u = span > 0 ? (t - a.t) / span : 0;
    const e = (EASE[b.ease || 'io'] || EASE.io)(u);
    const pose = mix(withArms(a.pose), withArms(b.pose), e);
    return { th: lerp(a.th, b.th, e), pose };
  }

  // ---------------------------------------------------------------------------
  // 三種球（面向左邊打；籃框在庫卡左手邊）
  // ---------------------------------------------------------------------------
  const bez2 = (p0, p1, p2, u) => [lerp(lerp(p0[0], p1[0], u), lerp(p1[0], p2[0], u), u), lerp(lerp(p0[1], p1[1], u), lerp(p1[1], p2[1], u), u)];
  const ANIMS = {
    // 羽球：預備 → 起跳引拍 → 跳殺（球從右上飛進來、被殺到左下）→ 落地收拍 → 轉正面歡呼。羽毛球很輕，留在視窗內。
    badminton: {
      dur: 3.6,
      keys: [
        { t: 0, th: -10, pose: {} },
        { t: .45, th: -40, pose: { sq: .9, lean: 6, eyes: 'focus', mouth: 'flat', look: [1, -1.5], arms: { R: { hand: [20, 92, 38] }, L: { hand: [-12, 104, 42] } } } },
        { t: .95, th: -55, ease: 'out', pose: { y: -24, sq: 1.06, lean: -12, tailUp: .8, eyes: 'focus', mouth: 'o', head: { pitch: -16 }, look: [1, -2], arms: { R: { hand: [24, 70, -16] }, L: { hand: [-16, 74, 30] } } } },
        { t: 1.15, th: -50, ease: 'in', pose: { y: -28, sq: 1.04, lean: 14, tailUp: 1, eyes: 'focus', mouth: 'open', head: { pitch: -6 }, arms: { R: { hand: [22, 64, 2] }, L: { hand: [-14, 112, -4] } } } },
        { t: 1.55, th: -35, ease: 'out', pose: { sq: .84, lean: 12, eyes: 'focus', mouth: 'smile', arms: { R: { hand: [-10, 134, 34] }, L: { hand: [-16, 112, 20] } } } },
        { t: 2.0, th: -35, pose: { sq: .97, lean: 4, eyes: 'happy', mouth: 'smile', arms: { R: { hand: [-6, 126, 34] } } } },
        { t: 2.45, th: 0, ease: 'back', pose: { y: -12, eyes: 'happy', mouth: 'open', blush: 1.3, arms: { R: { hand: [34, 72, 8] }, L: { hand: [-34, 76, 8] } } } },
        { t: 2.8, th: 0, ease: 'out', pose: { sq: .94, eyes: 'happy', mouth: 'open', blush: 1.3, arms: { R: { hand: [34, 74, 8] }, L: { hand: [-34, 78, 8] } } } },
        { t: 3.6, th: 0, pose: {} }
      ],
      props(t) {
        // 拍子角度跟著揮擊走
        const ang = t < .45 ? lerp(10, 30, t / .45) : t < .95 ? lerp(30, 160, (t - .45) / .5) : t < 1.15 ? lerp(160, -28, EASE.in((t - .95) / .2)) : t < 1.55 ? lerp(-28, 215, EASE.out((t - 1.15) / .4)) : t < 2.45 ? lerp(215, 20, EASE.io((t - 1.55) / .9)) : 20;
        const out = [{ t: 'racket', hand: 'R', ang, hit: t > 1.12 && t < 1.24, swoosh: t > 1.05 && t < 1.35 }];
        if (t < 1.15) { const u = Math.max(0, t / 1.15); const [x, y] = bez2([200, -60], [120, -70], [40, 6], u); out.push({ t: 'shuttle', at: [x, y], rot: lerp(-80, -40, u) }); }
        else if (t < 1.7) { const u = (t - 1.15) / .55; out.push({ t: 'shuttle', at: [lerp(30, -60, u), lerp(6, 150, u * u)], rot: 150 }, { t: 'fx', kind: 'speed', at: [lerp(46, -40, u), lerp(-2, 140, u * u)], rot: -30 }); }
        if (t > 2.45 && t < 3.3) out.push({ t: 'fx', kind: 'sparkle', at: [20, 30] }, { t: 'fx', kind: 'star', at: [130, 18] });
        return out;
      },
      endLine: '殺球成功！'
    },
    // 排球：低姿勢等球 → 墊球（太用力了，球飛出視窗上方）→ 抬頭看、驚訝 → 交給撿球
    volleyball: {
      dur: 2.4,
      keys: [
        { t: 0, th: -10, pose: {} },
        { t: .5, th: -15, pose: { sq: .82, lean: 14, eyes: 'focus', mouth: 'flat', look: [0, -2], head: { pitch: -10 }, arms: { L: { hand: [-4, 138, 46] }, R: { hand: [4, 138, 46] } } } },
        { t: .95, th: -15, ease: 'in', pose: { sq: .86, lean: 12, eyes: 'focus', mouth: 'flat', head: { pitch: -6 }, arms: { L: { hand: [-4, 136, 46] }, R: { hand: [4, 136, 46] } } } },
        { t: 1.15, th: -15, ease: 'out', pose: { sq: 1.04, lean: 2, eyes: 'focus', mouth: 'o', head: { pitch: -16 }, arms: { L: { hand: [-3, 118, 48] }, R: { hand: [3, 118, 48] } } } },
        { t: 1.6, th: -20, pose: { sq: 1.03, eyes: 'wide', mouth: 'open', head: { pitch: -24 }, look: [0, -2], arms: { L: { hand: [-34, 72, 6] }, R: { hand: [34, 72, 6] } } } },
        { t: 2.4, th: -20, pose: { eyes: 'wide', mouth: 'o', head: { pitch: -8 }, look: [-1.5, 0] } }
      ],
      events: [{ t: 1.12, name: 'throw', kind: 'vball', from: [76, 112], v: [0, -1] }],
      props(t, st) {
        const out = [];
        if (!st.thrown) {
          const u = Math.min(1, t / 1.12);
          const [x, y] = bez2([150, -40], [110, 40], [76, 112], EASE.io(u));
          out.push({ t: 'vball', at: [x, y], rot: u * 200 });
        }
        if (t > 1.1 && t < 1.35) out.push({ t: 'fx', kind: 'impact', at: [76, 112], s: .6, behind: true });
        if (t > 1.6) out.push({ t: 'fx', kind: 'sweat', at: [118, 30], s: 1.2 });
        return out;
      }
    },
    // 籃球：雙手抱球蓄力 → 跳起推球出手（球往左上飛向籃框，之後由物理決定進不進、彈去哪）→ 落地看球
    basketball: {
      dur: 2.2,
      keys: [
        { t: 0, th: -20, pose: { arms: { R: { hand: [6, 108, 40] }, L: { hand: [-8, 106, 42] } } } },
        { t: .5, th: -45, pose: { sq: .82, lean: 8, eyes: 'focus', mouth: 'flat', look: [-1.5, -1.5], head: { pitch: -8 }, arms: { R: { hand: [6, 108, 40] }, L: { hand: [-8, 106, 42] } } } },
        { t: .85, th: -50, ease: 'out', pose: { y: -26, sq: 1.08, tailUp: .8, eyes: 'focus', mouth: 'o', head: { pitch: -12 }, look: [-1, -1.5], arms: { R: { hand: [6, 78, 40] }, L: { hand: [-6, 76, 42] } } } },
        { t: 1.0, th: -50, pose: { y: -30, sq: 1.06, tailUp: 1, eyes: 'focus', mouth: 'o', head: { pitch: -10 }, arms: { R: { hand: [6, 64, 48], paw: 210 }, L: { hand: [-6, 62, 50], paw: 210 } } } },
        { t: 1.35, th: -45, ease: 'out', pose: { sq: .88, lean: 4, eyes: 'focus', mouth: 'o', head: { pitch: -14 }, look: [-2, -2] } },
        { t: 2.2, th: -40, pose: { eyes: 'wide', mouth: 'o', head: { pitch: -10 }, look: [-2, -1] } }
      ],
      events: [{ t: .98, name: 'throw', kind: 'bball', fromHand: true, v: [-0.62, -1] }],
      props(t, st) {
        const out = [{ t: 'hoop', at: [-12, 40], s: .9 }];
        if (!st.thrown) out.push({ t: 'bball', hand: 'both', off: t < .85 ? [-4, -6] : [-6, -10] });
        return out;
      }
    }
  };

  // 撿球用的姿勢（由 pet.js 依位置即時組合）
  const FETCH = {
    hop: (u) => ({ y: -18 * Math.sin(Math.PI * u), sq: u < .15 ? lerp(.88, 1.05, u / .15) : u > .85 ? lerp(1.04, .9, (u - .85) / .15) : 1.05, lean: 10, tailUp: .8 * Math.sin(Math.PI * u), eyes: 'focus', mouth: 'open' }),
    reach: (u) => ({ sq: lerp(1, .84, u), lean: lerp(0, 30, u), head: { pitch: lerp(0, 10, u) }, eyes: u > .7 ? 'happy' : 'focus', mouth: 'smile', arms: { L: { hand: [-8, lerp(118, 140, u), lerp(36, 46, u)] }, R: { hand: [8, lerp(120, 142, u), lerp(36, 44, u)] } } }),
    carry: (u) => ({ y: -14 * Math.sin(Math.PI * u), lean: 8, tailUp: .6 * Math.sin(Math.PI * u), eyes: 'happy', mouth: 'open', arms: { L: { hand: [-6, 108, 40] }, R: { hand: [6, 110, 40] } } })
  };

  const api = { sample, mix, EASE, ANIMS, FETCH };
  if (typeof window !== 'undefined') window.QuokkaAnim = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
