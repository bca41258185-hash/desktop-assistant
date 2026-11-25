// 關鍵影格動畫：關鍵姿勢之間自動內插（緩入緩出），每一格交給 quokka-pose.js 畫。
// 一段動畫 = { dur, keys:[{t, th, pose}], props(t, st), events:[{t, name}] }
//   keys   關鍵姿勢；數值欄位（含巢狀的手、頭）會內插，文字欄位（眼睛、嘴巴）在中點切換
//   props  依時間回傳道具（球的飛行軌跡等）；st 是這一次播放的狀態（例如球已經丟出去了）
//   events 時間到了通知桌寵（例如「放手丟球」），由舞台（stage-ball.js）或舊版 pet.js 接手做真正的物理與撿球
//   頭部 pitch：正＝低頭、負＝抬頭（打球時抬頭看球用負值，撿球彎腰用正值）
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

  // ---------------------------------------------------------------------------
  // 撿球（新設計，照真實習性）：發現 → 衝刺 → 煞車 → 四腳著地聞一聞 → 撈起來 → 坐起來抱球 → 回程（抱回／用鼻子推回）→ 到家
  // 每個函式：u（0–1）→ { th, pose }，以「球在左邊」（面向左）為準；球在右邊用 mirrorFrame() 鏡射
  // ---------------------------------------------------------------------------
  const HOLD = { L: { hand: [-8, 112, 40] }, R: { hand: [8, 114, 40] } };            // 前爪把球捧在胸前
  const PAWS_DOWN = { L: { hand: [-8, 160, 32] }, R: { hand: [8, 160, 32] } };       // 四腳著地，前爪撐地
  const P_SNIFF = { lean: 62, sq: .86, head: { pitch: -36 }, tailUp: .4, eyes: 'focus', mouth: 'smile', arms: PAWS_DOWN };
  const P_SCOOP = { lean: 38, sq: .9, head: { pitch: 10 }, eyes: 'happy', mouth: 'open', arms: { L: { hand: [-8, 138, 42] }, R: { hand: [8, 140, 42] } } };
  const P_SIT = { sq: .96, lean: -4, eyes: 'happy', mouth: 'open', blush: 1.4, arms: HOLD };
  const P_NUDGE = { lean: 58, sq: .88, head: { pitch: -30 }, tailUp: .5, eyes: 'happy', mouth: 'smile', arms: { L: { hand: [-8, 158, 34] }, R: { hand: [8, 158, 34] } } };
  const P_BRAKE = { sq: .84, lean: -10, tailUp: .3, eyes: 'wide', mouth: 'o' };
  const ballHeld = (kind, off = [0, -4]) => ({ t: kind, hand: 'both', off });
  const FETCH2 = {
    // 1 發現：轉頭看球、睜大眼（頭上的「！」由舞台用 CSS 畫）
    discover: (u) => { const e = EASE.out(Math.min(1, u * 2)); return { th: lerp(-10, -40, e), pose: { head: { yaw: -40 * e }, eyes: 'wide', mouth: 'o', look: [-2 * e, 0] } }; },
    // 2 衝刺：大步跳，身體拉長前傾、尾巴平衡、後面揚塵＋速度線
    dash: (u) => ({ th: -90, pose: {
      y: -26 * Math.sin(Math.PI * u), sq: u < .15 ? lerp(.88, 1.08, u / .15) : u > .85 ? lerp(1.08, .9, (u - .85) / .15) : 1.08,
      lean: u < .15 || u > .85 ? 14 : 24, tailUp: Math.sin(Math.PI * u), eyes: 'focus', mouth: 'open', head: { pitch: -10 },
      props: u < .45 ? [{ t: 'fx', kind: 'dust', at: [120, 184], s: .7 }, { t: 'fx', kind: 'speed', at: [150, 110 - 26 * Math.sin(Math.PI * u)], rot: 180, s: .9 }] : [{ t: 'fx', kind: 'speed', at: [150, 110 - 26 * Math.sin(Math.PI * u)], rot: 180, s: .9 }] } }),
    // 3 煞車：落地壓低、往後仰，前面揚起一點灰
    brake: (u) => ({ th: -90, pose: { ...mix({ sq: .95, lean: 10, tailUp: .6, eyes: 'focus', mouth: 'open' }, P_BRAKE, EASE.out(Math.min(1, u * 2))), props: [{ t: 'fx', kind: 'dust', at: [10, 184], s: .6 }] } }),
    // 4 四腳著地聞一聞：前爪撐地、頭往前看、鼻子湊近球
    sniff: (u) => {
      const p = mix(P_BRAKE, P_SNIFF, EASE.io(Math.min(1, u / .3)));
      p.head = { ...p.head, pitch: p.head.pitch + (u > .3 ? 4 * Math.sin((u - .3) * Math.PI * 6) : 0) };
      p.props = u > .35 ? [{ t: 'fx', kind: 'sniff', at: [-36, 142] }] : [];
      return { th: -90, pose: p };
    },
    // 5 撈起來：前爪從下面把球捧起（球黏在雙手）
    scoop: (u, kind) => ({ th: -90, pose: { ...mix(P_SNIFF, P_SCOOP, EASE.io(u)), props: [ballHeld(kind, [-4, -2])] } }),
    // 6 坐起來抱球：直立、球抱在胸前、得意
    sit: (u, kind) => { const e = EASE.out(u); return { th: lerp(-90, -30, e), pose: { ...mix(P_SCOOP, P_SIT, e), props: [ballHeld(kind), ...(u > .4 ? [{ t: 'fx', kind: 'sparkle', at: [130, 40] }] : [])] } }; },
    // 轉向回家的方向（抱著球）；回程面向右（家在球的另一邊）
    turnHome: (u, kind) => ({ th: lerp(-30, 90, EASE.io(u)), pose: { ...P_SIT, mouth: 'smile', props: [ballHeld(kind)] } }),
    // 7A 抱著球小步蹦回去（看得出小心捧著）
    carry: (u, kind) => ({ th: 90, pose: { y: -12 * Math.sin(Math.PI * u), sq: u < .12 ? lerp(.92, 1, u / .12) : u > .88 ? lerp(1, .93, (u - .88) / .12) : 1, lean: 6, tailUp: .6 * Math.sin(Math.PI * u), eyes: 'happy', mouth: 'smile', blush: 1.2, arms: HOLD, props: [ballHeld(kind, [2, -4])] } }),
    // 7B 用鼻子推：先把球放下、趴低（球改由舞台畫在鼻子前的地上）
    drop: (u) => ({ th: 90, pose: mix({ ...P_SIT, mouth: 'smile' }, P_NUDGE, EASE.io(u)) }),
    // 一推一滾：前 35% 往前頂（球滾出去），之後小步跟上
    nudge: (u) => {
      const push = u < .35 ? Math.sin(Math.PI * u / .35) : 0;
      const p = mix(P_NUDGE, { ...P_NUDGE, lean: 66, head: { pitch: -22 } }, push);
      if (u >= .35) p.y = -4 * Math.sin(Math.PI * (u - .35) / .65);
      return { th: 90, pose: p };
    },
    // 用鼻子推回來的籃球：再撈起來、坐好（從趴低開始）
    rescoop: (u, kind) => ({ th: lerp(90, -30, EASE.io(Math.max(0, (u - .4) / .6))), pose: u < .4 ? { ...mix(P_NUDGE, P_SCOOP, EASE.io(u / .4)), props: [ballHeld(kind, [-4, -2])] } : { ...mix(P_SCOOP, P_SIT, EASE.out((u - .4) / .6)), props: [ballHeld(kind)] } }),
    // 8 到家（籃球）：轉向籃框、把球捧到胸前準備再投
    homeB: (u) => { const e = EASE.io(u); return { th: lerp(-30, -45, e), pose: { ...mix(P_SIT, { sq: .9, lean: 6, eyes: 'focus', mouth: 'smile', head: { pitch: -8 }, look: [-1.5, -1], arms: { R: { hand: [6, 106, 42] }, L: { hand: [-8, 104, 44] } } }, e), props: [ballHeld('bball', [-4, -6]), { t: 'hoop', at: [-12, 40], s: .9 }] } }; },
    // 8 到家（排球）：把球放在腳邊、伸爪拍一拍、冒小愛心（球由舞台畫在腳邊）
    homeV: (u) => {
      const set = { lean: 20, sq: .94, head: { pitch: 16 }, eyes: 'happy', mouth: 'smile', arms: { R: { hand: [12, 132, 48] } } };
      const p = mix({ ...P_SIT, mouth: 'smile' }, set, EASE.io(Math.min(1, u / .25)));
      if (u > .25) p.arms = { ...p.arms, R: { hand: [12, 132 - 6 * Math.abs(Math.sin((u - .25) * Math.PI * 4)), 48] } };
      p.props = u > .5 ? [{ t: 'fx', kind: 'heart', at: [118, 140 - (u - .5) * 30], s: .8 }] : [];
      return { th: -20, pose: p };
    },
    // 用鼻子推回來的排球：趴著伸爪拍一拍
    homeVNudge: (u) => {
      const p = mix(P_NUDGE, { ...P_NUDGE, eyes: 'happy', head: { pitch: -20 } }, Math.min(1, u * 3));
      p.arms = { L: { hand: [-8, 158, 34] }, R: { hand: [8, 150 - 6 * Math.abs(Math.sin(u * Math.PI * 4)), 48] } };
      p.props = u > .4 ? [{ t: 'fx', kind: 'heart', at: [196, 128 - (u - .4) * 30], s: .8 }] : [];
      return { th: 90, pose: p };
    }
  };
  // 鏡射（球在右邊時）：角度、轉頭、眼珠、場景道具的 x 都左右對調
  function mirrorFrame(fr) {
    const p = { ...fr.pose };
    if (p.head) p.head = { ...p.head, yaw: -(p.head.yaw || 0), roll: -(p.head.roll || 0) };
    if (p.look) p.look = [-p.look[0], p.look[1]];
    if (p.roll) p.roll = -p.roll;
    if (p.props) p.props = p.props.map((q) => {
      const o = { ...q };
      if (o.at) o.at = [160 - o.at[0], o.at[1]];
      if (o.off) o.off = [-o.off[0], o.off[1]];
      if (o.kind === 'speed' && o.rot != null) o.rot = 180 - o.rot;
      if (o.kind === 'sniff') o.kind = 'sniffR'; else if (o.kind === 'sniffR') o.kind = 'sniff';
      return o;
    });
    return { th: -fr.th, pose: p };
  }

  // ---------------------------------------------------------------------------
  // 舞台用的反應與小動作（工作反應、摸頭、頭暈、吃東西、跳、打盹…）
  // 頭部 pitch：正＝低頭、負＝抬頭（見 quokka-pose.js）
  // loop:true 的可以重複播（例如長摸撒嬌）
  // ---------------------------------------------------------------------------
  const UP = { L: { hand: [-34, 72, 8] }, R: { hand: [34, 72, 8] } };            // 雙手舉高
  const UP2 = { L: { hand: [-36, 76, 4] }, R: { hand: [36, 76, 4] } };
  const WAVE_A = { R: { hand: [30, 70, 14] } }, WAVE_B = { R: { hand: [38, 80, 2] } };
  const CHEEK = { L: { hand: [-19, 70, 22] }, R: { hand: [19, 70, 22] } };       // 雙手摀著臉頰（抱頭）
  const REACT = {
    // 點頭說「收到！」
    nod: { dur: 1.5, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .25, th: -10, pose: { head: { pitch: 14 }, eyes: 'happy', mouth: 'open' } },
      { t: .5, th: -10, pose: { head: { pitch: -2 }, eyes: 'happy', mouth: 'open' } },
      { t: .75, th: -10, pose: { head: { pitch: 12 }, eyes: 'happy', mouth: 'smile' } },
      { t: 1.05, th: -10, pose: { head: { pitch: 0 }, eyes: 'happy', mouth: 'smile', blush: 1.2 } },
      { t: 1.5, th: -10, pose: {} }] },
    // 完成一件事：跳一下
    hopJoy: { dur: 1.6, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .25, th: -10, pose: { sq: .86, eyes: 'happy', mouth: 'smile' } },
      { t: .55, th: 0, ease: 'out', pose: { y: -26, sq: 1.06, tailUp: .9, eyes: 'happy', mouth: 'open', head: { pitch: -6 }, arms: UP2 } },
      { t: .85, th: 0, ease: 'in', pose: { sq: .9, eyes: 'happy', mouth: 'open', arms: UP2 } },
      { t: 1.2, th: -10, pose: { eyes: 'happy', mouth: 'smile', blush: 1.3 } },
      { t: 1.6, th: -10, pose: {} }],
      props: (t) => (t > .45 && t < 1.4 ? [{ t: 'fx', kind: 'sparkle', at: [30, 40] }, { t: 'fx', kind: 'sparkle', at: [130, 30] }] : []) },
    // 歡呼（股票漲）
    cheer: { dur: 2.0, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .3, th: 0, pose: { sq: .86, eyes: 'happy', mouth: 'open' } },
      { t: .65, th: 0, ease: 'out', pose: { y: -22, sq: 1.06, tailUp: 1, eyes: 'happy', mouth: 'open', head: { pitch: -8 }, arms: UP, blush: 1.3 } },
      { t: .95, th: 0, ease: 'in', pose: { sq: .92, eyes: 'happy', mouth: 'open', arms: UP2, blush: 1.3 } },
      { t: 1.3, th: 0, pose: { y: -6, eyes: 'happy', mouth: 'open', arms: UP, blush: 1.3 } },
      { t: 2.0, th: -10, pose: { eyes: 'happy' } }],
      props: (t) => (t > .5 && t < 1.8 ? [{ t: 'fx', kind: 'star', at: [24, 26] }, { t: 'fx', kind: 'sparkle', at: [140, 44] }] : []) },
    // 大歡呼（全部完成、漲停）：兩段大跳、轉一圈
    bigCheer: { dur: 3.0, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .3, th: 0, pose: { sq: .82, eyes: 'happy', mouth: 'open' } },
      { t: .7, th: 90, ease: 'out', pose: { y: -36, sq: 1.08, tailUp: 1, eyes: 'happy', mouth: 'open', head: { pitch: -10 }, arms: UP, blush: 1.4 } },
      { t: 1.05, th: 180, ease: 'in', pose: { sq: .86, eyes: 'happy', mouth: 'open', arms: UP2 } },
      { t: 1.45, th: 270, ease: 'out', pose: { y: -34, sq: 1.08, tailUp: 1, eyes: 'happy', mouth: 'open', head: { pitch: -10 }, arms: UP, blush: 1.4 } },
      { t: 1.8, th: 360, ease: 'in', pose: { sq: .88, eyes: 'happy', mouth: 'open', arms: UP2, blush: 1.4 } },
      { t: 2.3, th: 360, pose: { eyes: 'happy', mouth: 'open', arms: UP, blush: 1.4 } },
      { t: 3.0, th: 350, pose: { eyes: 'happy', blush: 1.2 } }],
      props: (t) => (t > .5 && t < 2.8 ? [{ t: 'fx', kind: 'star', at: [16, 20] }, { t: 'fx', kind: 'star', at: [146, 30] }, { t: 'fx', kind: 'sparkle', at: [40, 0] }, { t: 'fx', kind: 'sparkle', at: [120, -4] }] : []) },
    // 垂頭冒汗（股票跌）
    droop: { dur: 2.4, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .5, th: -10, pose: { sq: .93, head: { pitch: 18 }, eyes: 'closed', mouth: 'flat', look: [0, 1.5], arms: { L: { hand: [-10, 134, 28] }, R: { hand: [10, 134, 28] } } } },
      { t: 1.8, th: -10, pose: { sq: .92, head: { pitch: 20, roll: -4 }, eyes: 'open', mouth: 'flat', look: [0, 2], blush: .4, arms: { L: { hand: [-10, 136, 28] }, R: { hand: [10, 136, 28] } } } },
      { t: 2.4, th: -10, pose: { head: { pitch: 6 }, mouth: 'flat' } }],
      props: (t) => (t > .4 ? [{ t: 'fx', kind: 'sweat', at: [116, 30], s: 1.3 }] : []) },
    // 坐下抱頭（跌停）
    cover: { dur: 3.0, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .4, th: -5, pose: { sq: .8, lean: 6, head: { pitch: 16 }, eyes: 'closed', mouth: 'flat', arms: CHEEK } },
      { t: 1.0, th: -5, pose: { sq: .78, lean: 6, head: { pitch: 18, roll: 6 }, eyes: 'closed', mouth: 'flat', arms: CHEEK } },
      { t: 1.6, th: -5, pose: { sq: .78, lean: 6, head: { pitch: 18, roll: -6 }, eyes: 'closed', mouth: 'flat', arms: CHEEK } },
      { t: 2.3, th: -5, pose: { sq: .8, lean: 4, head: { pitch: 14 }, eyes: 'open', mouth: 'flat', blush: .3, arms: CHEEK } },
      { t: 3.0, th: -10, pose: { head: { pitch: 6 }, mouth: 'flat' } }],
      props: (t) => (t > .3 ? [{ t: 'fx', kind: 'sweat', at: [118, 26], s: 1.4 }, { t: 'fx', kind: 'sweat', at: [42, 34], s: 1 }] : []) },
    // 轉頭聞聞（資料夾變了、游標停很久）
    sniff: { dur: 2.4, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .4, th: -35, pose: { lean: 10, head: { pitch: 10, yaw: -10 }, eyes: 'focus', mouth: 'o', look: [-1, 1] } },
      { t: .7, th: -35, pose: { lean: 12, head: { pitch: 6, yaw: -10 }, eyes: 'focus', mouth: 'smile', look: [-1, 1] } },
      { t: 1.0, th: -35, pose: { lean: 12, head: { pitch: 12, yaw: -12 }, eyes: 'focus', mouth: 'o', look: [-1, 1.5] } },
      { t: 1.3, th: -35, pose: { lean: 12, head: { pitch: 6, yaw: -10 }, eyes: 'focus', mouth: 'smile' } },
      { t: 1.8, th: -20, pose: { head: { pitch: -4, roll: 8 }, eyes: 'open', mouth: 'o' } },
      { t: 2.4, th: -10, pose: {} }] },
    // 說一句（單純說話、錯過的提醒）
    talk: { dur: 1.8, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .3, th: -5, pose: { head: { roll: 7, pitch: -3 }, mouth: 'open' } },
      { t: .6, th: -5, pose: { head: { roll: 5 }, mouth: 'smile' } },
      { t: .9, th: -5, pose: { head: { roll: 8, pitch: -3 }, mouth: 'open', arms: { R: { hand: [18, 104, 36] } } } },
      { t: 1.3, th: -8, pose: { head: { roll: 3 }, mouth: 'smile', arms: { R: { hand: [16, 108, 36] } } } },
      { t: 1.8, th: -10, pose: {} }] },
    // 揮手（回來時、響鈴）
    wave: { dur: 2.2, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .3, th: 0, pose: { eyes: 'happy', mouth: 'open', arms: WAVE_A, blush: 1.2 } },
      { t: .6, th: 0, pose: { eyes: 'happy', mouth: 'open', head: { roll: -5 }, arms: WAVE_B, blush: 1.2 } },
      { t: .9, th: 0, pose: { eyes: 'happy', mouth: 'open', head: { roll: 5 }, arms: WAVE_A, blush: 1.2 } },
      { t: 1.2, th: 0, pose: { eyes: 'happy', mouth: 'open', head: { roll: -5 }, arms: WAVE_B, blush: 1.2 } },
      { t: 1.5, th: 0, pose: { eyes: 'happy', mouth: 'smile', arms: WAVE_A, blush: 1.2 } },
      { t: 2.2, th: -10, pose: { eyes: 'happy' } }] },
    // 摸頭：兩種反應
    pat1: { dur: 1.6, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .25, th: -8, pose: { sq: .95, head: { pitch: 8, roll: 8 }, eyes: 'happy', mouth: 'smile', blush: 1.5 } },
      { t: 1.1, th: -8, pose: { sq: .96, head: { pitch: 6, roll: 10 }, eyes: 'happy', mouth: 'open', blush: 1.5 } },
      { t: 1.6, th: -10, pose: { blush: 1.2 } }] },
    pat2: { dur: 1.4, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .2, th: 0, pose: { sq: .9, head: { pitch: 10 }, eyes: 'closed', mouth: 'smile', blush: 1.4 } },
      { t: .55, th: 0, ease: 'out', pose: { y: -10, head: { pitch: -6 }, eyes: 'happy', mouth: 'open', tailUp: .7, blush: 1.4 } },
      { t: .9, th: 0, pose: { eyes: 'happy', mouth: 'smile', blush: 1.3 } },
      { t: 1.4, th: -10, pose: { blush: 1.1 } }] },
    // 轉一圈（第三種摸頭反應）
    spin: { dur: 1.2, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .6, th: 170, pose: { y: -8, eyes: 'happy', mouth: 'open', tailUp: .8 } },
      { t: 1.2, th: 350, pose: { eyes: 'happy', blush: 1.3 } }] },
    // 長摸撒嬌（重複播）
    petting: { dur: 1.6, loop: true, keys: [
      { t: 0, th: -5, pose: { sq: .95, head: { pitch: 8, roll: 9 }, eyes: 'happy', mouth: 'smile', blush: 1.5 } },
      { t: .8, th: -5, pose: { sq: .96, head: { pitch: 8, roll: -9 }, eyes: 'happy', mouth: 'smile', blush: 1.5 } },
      { t: 1.6, th: -5, pose: { sq: .95, head: { pitch: 8, roll: 9 }, eyes: 'happy', mouth: 'smile', blush: 1.5 } }],
      props: (t) => (t % 1.6 < .9 ? [{ t: 'fx', kind: 'heart', at: [128, 22], s: 1.3 }] : []) },
    // 頭暈（甩出去落地）
    dizzy: { dur: 2.6, keys: [
      { t: 0, th: 0, pose: { sq: .82, eyes: 'dizzy', mouth: 'o' } },
      { t: .4, th: 0, pose: { roll: 6, head: { roll: 12 }, eyes: 'dizzy', mouth: 'o' } },
      { t: .9, th: 0, pose: { roll: -6, head: { roll: -12 }, eyes: 'dizzy', mouth: 'flat' } },
      { t: 1.4, th: 0, pose: { roll: 5, head: { roll: 10 }, eyes: 'dizzy', mouth: 'o' } },
      { t: 1.9, th: 0, pose: { roll: -4, head: { roll: -8 }, eyes: 'dizzy', mouth: 'flat' } },
      { t: 2.6, th: -10, pose: { eyes: 'closed' } }],
      props: (t) => (t < 2.2 ? [{ t: 'fx', kind: 'star', at: [50 + 30 * Math.cos(t * 7), 14 + 6 * Math.sin(t * 7)] }, { t: 'fx', kind: 'star', at: [80 - 30 * Math.cos(t * 7), 14 - 6 * Math.sin(t * 7)] }] : []) },
    // 輕輕放下：跳一下
    land: { dur: .6, keys: [
      { t: 0, th: -10, pose: { sq: .86, eyes: 'happy' } },
      { t: .25, th: -10, ease: 'out', pose: { y: -10, sq: 1.04, tailUp: .6, eyes: 'happy', mouth: 'open' } },
      { t: .45, th: -10, ease: 'in', pose: { sq: .92 } },
      { t: .6, th: -10, pose: {} }] },
    // 陪我玩：吃東西（抱著葉子啃）
    eat: { dur: 4.2, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .5, th: -10, pose: { head: { pitch: 6 }, eyes: 'happy', mouth: 'open', arms: { L: { hand: [-5, 96, 36] }, R: { hand: [5, 96, 36] } } } },
      { t: .9, th: -10, pose: { head: { pitch: 8 }, eyes: 'happy', mouth: 'chew', arms: { L: { hand: [-5, 98, 36] }, R: { hand: [5, 98, 36] } } } },
      { t: 1.3, th: -10, pose: { head: { pitch: 4 }, eyes: 'happy', mouth: 'smile', arms: { L: { hand: [-5, 96, 36] }, R: { hand: [5, 96, 36] } } } },
      { t: 1.7, th: -10, pose: { head: { pitch: 8 }, eyes: 'happy', mouth: 'chew', arms: { L: { hand: [-5, 98, 36] }, R: { hand: [5, 98, 36] } } } },
      { t: 2.1, th: -10, pose: { head: { pitch: 4 }, eyes: 'happy', mouth: 'smile', arms: { L: { hand: [-5, 96, 36] }, R: { hand: [5, 96, 36] } } } },
      { t: 2.5, th: -10, pose: { head: { pitch: 8 }, eyes: 'happy', mouth: 'chew', arms: { L: { hand: [-5, 98, 36] }, R: { hand: [5, 98, 36] } } } },
      { t: 3.0, th: -10, pose: { head: { pitch: 2 }, eyes: 'happy', mouth: 'smile', blush: 1.3, arms: { L: { hand: [-5, 104, 36] }, R: { hand: [5, 104, 36] } } } },
      { t: 4.2, th: -10, pose: { eyes: 'happy', blush: 1.2 } }],
      props: (t) => (t < 3.4 ? [{ t: 'leaf', hand: 'both', off: [2, -4], rot: 80, s: Math.max(.35, 1 - Math.max(0, t - 1) * .25) }] : []),
      endLine: '好吃～' },
    // 陪我玩：原地跳三下
    hop: { dur: 2.4, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .2, th: -10, pose: { sq: .86, eyes: 'happy' } },
      { t: .45, th: -10, ease: 'out', pose: { y: -26, sq: 1.06, tailUp: .9, eyes: 'happy', mouth: 'open' } },
      { t: .7, th: -10, ease: 'in', pose: { sq: .88, eyes: 'happy', mouth: 'open' } },
      { t: .95, th: -10, ease: 'out', pose: { y: -28, sq: 1.06, tailUp: .9, eyes: 'happy', mouth: 'open' } },
      { t: 1.2, th: -10, ease: 'in', pose: { sq: .88, eyes: 'happy', mouth: 'open' } },
      { t: 1.5, th: 0, ease: 'out', pose: { y: -34, sq: 1.08, tailUp: 1, eyes: 'happy', mouth: 'open', arms: UP } },
      { t: 1.8, th: 0, ease: 'in', pose: { sq: .86, eyes: 'happy', mouth: 'smile' } },
      { t: 2.4, th: -10, pose: { eyes: 'happy', blush: 1.2 } }],
      endLine: '跳跳跳！' },
    // 陪我玩：打盹（坐著點頭打瞌睡）
    nap: { dur: 6.0, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .8, th: -10, pose: { sq: .9, head: { pitch: 10 }, eyes: 'closed', mouth: 'smile' } },
      { t: 2.0, th: -10, pose: { sq: .9, head: { pitch: 18, roll: 5 }, eyes: 'closed', mouth: 'smile' } },
      { t: 3.2, th: -10, pose: { sq: .91, head: { pitch: 12, roll: -3 }, eyes: 'closed', mouth: 'smile' } },
      { t: 4.4, th: -10, pose: { sq: .9, head: { pitch: 20, roll: 6 }, eyes: 'closed', mouth: 'smile' } },
      { t: 5.2, th: -10, ease: 'back', pose: { sq: 1.04, head: { pitch: -8 }, eyes: 'wide', mouth: 'o', arms: UP2 } },
      { t: 6.0, th: -10, pose: { eyes: 'happy' } }],
      props: (t) => (t > 1 && t < 5 ? [{ t: 'fx', kind: 'zzz', at: [112, 10 - (t % 1.4) * 6], s: 1.1 + (t % 1.4) * .2 }] : []),
      endLine: '睡飽了！' },
    // 兩隻碰鼻（面向左邊的對方；舞台依對方位置鏡射）
    greetNose: { dur: 2.0, keys: [
      { t: 0, th: -60, pose: {} },
      { t: .5, th: -75, pose: { lean: 14, head: { pitch: 4 }, eyes: 'closed', mouth: 'smile', blush: 1.4 } },
      { t: 1.3, th: -75, pose: { lean: 16, head: { pitch: 2, roll: -6 }, eyes: 'closed', mouth: 'smile', blush: 1.5 } },
      { t: 2.0, th: -60, pose: { eyes: 'happy', blush: 1.3 } }],
      props: (t) => (t > .5 && t < 1.9 ? [{ t: 'fx', kind: 'heart', at: [10, 20 - (t - .5) * 12], s: 1.2 }] : []) },
    // 兩隻互相揮手
    greetWave: { dur: 2.0, keys: [
      { t: 0, th: -60, pose: {} },
      { t: .35, th: -55, pose: { eyes: 'happy', mouth: 'open', arms: { L: { hand: [-30, 70, 14] } } } },
      { t: .7, th: -55, pose: { eyes: 'happy', mouth: 'open', head: { roll: -5 }, arms: { L: { hand: [-38, 80, 2] } } } },
      { t: 1.05, th: -55, pose: { eyes: 'happy', mouth: 'open', head: { roll: 5 }, arms: { L: { hand: [-30, 70, 14] } } } },
      { t: 1.4, th: -55, pose: { eyes: 'happy', mouth: 'smile', arms: { L: { hand: [-38, 80, 2] } } } },
      { t: 2.0, th: -60, pose: { eyes: 'happy' } }] },
    // 醒來伸懶腰
    stretch: { dur: 1.6, keys: [
      { t: 0, th: -10, pose: { sq: .92, head: { pitch: 10 }, eyes: 'closed' } },
      { t: .6, th: -5, pose: { sq: 1.06, head: { pitch: -8 }, eyes: 'closed', mouth: 'open', arms: UP } },
      { t: 1.1, th: -5, pose: { sq: 1.0, eyes: 'happy', mouth: 'smile' } },
      { t: 1.6, th: -10, pose: {} }] }
  };

  // 靜止圖（快取成點陣圖，不重畫）：待機、睡覺、看左看右、響鈴、拎起來、撿球
  const STILL = {
    sleep: { sq: .92, head: { pitch: 14, roll: 4 }, eyes: 'closed', mouth: 'smile', arms: { L: { hand: [-8, 130, 30] }, R: { hand: [8, 130, 30] } } },
    ring: { eyes: 'wide', mouth: 'open', blush: 1.2, arms: { R: { hand: [32, 70, 12] } } },
    lift: { feet: 'air', eyes: 'wide', mouth: 'o', arms: { L: { hand: [-26, 92, 20] }, R: { hand: [26, 92, 20] } } },
    shy: { head: { pitch: 8, roll: -6 }, eyes: 'happy', mouth: 'smile', blush: 1.5 }
  };

  const api = { sample, mix, EASE, ANIMS, FETCH, FETCH2, mirrorFrame, REACT, STILL };
  if (typeof window !== 'undefined') window.QuokkaAnim = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
