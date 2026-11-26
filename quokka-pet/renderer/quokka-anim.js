// 關鍵影格動畫：關鍵姿勢之間自動內插（緩入緩出），每一格交給 quokka-pose.js 畫。
// 一段動畫 = { dur, keys:[{t, th, pose, ease?}], props(t, st), events:[{t, name}], loop? }
//   keys   關鍵姿勢；數值欄位（含巢狀的手、頭、耳朵）會內插，文字欄位（眼睛、嘴巴）在中點切換
//   props  依時間回傳道具（球的飛行軌跡等）；st 是這一次播放的狀態（例如球已經丟出去了）
//   events 時間到了通知桌寵（例如「放手丟球」），由舞台（stage-ball.js）接手做真正的物理與撿球
//   頭部 pitch：正＝低頭、負＝抬頭（打球時抬頭看球用負值，撿球彎腰用正值）
//
// sample(anim, t) 會自動加上「跟隨動作」（除非 anim.follow === false 或關鍵姿勢自己寫了 earFlop）：
//   耳朵：依 0.06 秒前的垂直速度往後甩（上升時往外倒、下墜時往上收，限 ±18°）
//   尾巴：tailUp 晚 0.08 秒才跟上
//
// 這個檔案另外提供：
//   GAIT     三種步態（walk 四肢著地慢慢走／hop 中距離小跳／dash 衝刺），每一步回傳 { th, pose, advance }
//   ALERT    提醒（響鈴）用的循環動畫：ring（活潑版）、quiet（響很久之後的安靜版）
//   IDLE     待機小動畫庫（張望、抓臉、打哈欠、伸懶腰、理毛、吃葉子…）
//   ambient(t, seed, opts)／applyAmbient(pose, amb)   常駐層：呼吸、眨眼、視線、耳朵抖
//   scaleByPersonality(anim, personality)             依個性調整幅度與速度
(function () {
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
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
  const NEUTRAL = { x: 0, y: 0, sq: 1, lean: 0, roll: 0, tailUp: 0, blush: 1, look: [0, 0], blink: 0 };
  const withArms = (p) => ({ ...NEUTRAL, ...p, head: { yaw: 0, pitch: 0, roll: 0, ...(p.head || {}) }, arms: { ...REST, ...(p.arms || {}) },
    earFlop: { L: 0, R: 0, ...(p.earFlop || {}) }, eyes: p.eyes || 'open', mouth: p.mouth || 'smile' });
  // 找出時間 t 落在哪兩個關鍵姿勢之間，回傳 [前, 後, 緩動後的比例]
  function seg(anim, time) {
    const keys = anim.keys, t = clamp(time, 0, anim.dur);
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
    const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
    const span = b.t - a.t, u = span > 0 ? (t - a.t) / span : 0;
    return [a, b, (EASE[b.ease || 'io'] || EASE.io)(u)];
  }
  // 不含跟隨動作的原始取樣
  function sampleRaw(anim, time) {
    const [a, b, e] = seg(anim, time);
    return { th: lerp(a.th, b.th, e), pose: mix(withArms(a.pose), withArms(b.pose), e) };
  }
  // 只取一個數值欄位（算速度、延遲用；比整個姿勢內插便宜很多）
  function chan(anim, time, key) {
    const [a, b, e] = seg(anim, time);
    return lerp(a.pose[key] == null ? NEUTRAL[key] : a.pose[key], b.pose[key] == null ? NEUTRAL[key] : b.pose[key], e);
  }
  const EAR_LAG = .06, TAIL_LAG = .08, EAR_GAIN = .12, EAR_MAX = 18;
  // 由垂直速度（單位／秒；上升為負）算耳朵後甩的角度
  const flopOf = (vy) => clamp(-vy * EAR_GAIN, -EAR_MAX, EAR_MAX);
  function sample(anim, time) {
    const s = sampleRaw(anim, time);
    if (anim.follow === false) return s;
    const t = clamp(time, 0, anim.dur), p = s.pose;
    if (!anim._hasY) anim._hasY = anim.keys.some((k) => k.pose.y) ? 1 : -1;
    if (anim._hasY > 0) {
      // 耳朵：看 0.06 秒前的垂直速度；循環動畫繞回去取樣，才不會在接縫跳一下
      const wrap = (x) => (anim.loop ? ((x % anim.dur) + anim.dur) % anim.dur : x);
      const h = 1 / 60, vy = (chan(anim, wrap(t - EAR_LAG + h), 'y') - chan(anim, wrap(t - EAR_LAG - h), 'y')) / (2 * h), f = flopOf(vy);
      p.earFlop = { L: clamp(p.earFlop.L + f, -30, 30), R: clamp(p.earFlop.R + f, -30, 30) };
    }
    if (!anim._hasTail) anim._hasTail = anim.keys.some((k) => k.pose.tailUp) ? 1 : -1;
    if (anim._hasTail > 0 && !anim.loop) p.tailUp = chan(anim, t - TAIL_LAG, 'tailUp');
    return s;
  }

  // 量手掌位置用：需要 quokka-pose.js（瀏覽器裡是 window.QuokkaPose，測試時用 require）
  const poseLib = () => {
    if (typeof window !== 'undefined' && window.QuokkaPose) return window.QuokkaPose;
    try { return typeof require === 'function' ? require('./quokka-pose.js') : null; } catch (e) { return null; }
  };
  // 動畫在時間 t 的雙手畫面座標（每段動畫每個時間點只算一次）；沒有繪圖模組時回傳 null
  function handsAt(anim, t) {
    anim._hands = anim._hands || {};
    if (anim._hands[t] !== undefined) return anim._hands[t];
    let h = null;
    try { const Q = poseLib(), s = sampleRaw(anim, t); if (Q) h = Q.render(s.th, 'qh', { ...s.pose, props: [], accessory: 'none' }).hands; } catch (e) { h = null; }
    return (anim._hands[t] = h);
  }
  // 拋物線：從 p0 到 p1、最高點高度 apexY（畫面 y，越小越高）；x 等速。回傳 u（0–1）→ { at:[x,y], dir:飛行方向角度 }
  function arc(p0, p1, apexY) {
    const A = p0[1] - apexY, D = p1[1] - p0[1];
    const ua = Math.abs(D) < 1e-6 ? .5 : (-A + Math.sqrt(Math.max(0, A * A + A * D))) / D, b = A / (ua * ua), a = -2 * b * ua;
    return (u) => {
      const x = lerp(p0[0], p1[0], u), y = p0[1] + a * u + b * u * u;
      return { at: [x, y], dir: Math.atan2(a + 2 * b * u, p1[0] - p0[0]) * 180 / Math.PI };
    };
  }

  // ---------------------------------------------------------------------------
  // 三種球（面向左邊打；球從面向的那一側——左邊——飛來；籃框在庫卡左手邊）
  // 共通的節奏：慢蓄力（預備）→ 快出手 → 擊球瞬間停格 0.06 秒 → 慢收；跳躍在最高點停兩格、下降加速、落地擠壓再回彈。
  // 身體條件：前肢短（肩到掌最多約 42 單位）、後腿大、尾巴粗 → 力量都從後腿蹬地來，手只負責引導。
  // ---------------------------------------------------------------------------
  const HITSTOP = .06;
  const RACKET_LEN = 40.5;                                               // 握把（手掌）到拍面中心的距離（quokka-pose.js 的球拍放大 1.5 倍後）
  const racketHead = (palm, ang) => [palm[0] + RACKET_LEN * Math.sin(ang * Math.PI / 180), palm[1] - RACKET_LEN * Math.cos(ang * Math.PI / 180)];
  // 籃框：放大成真實比例（框寬約球的兩倍）、柱子落地、框高於跳起來的頭頂。
  // 籃框圖本身是「框在左、籃板在右」；庫卡在右邊，所以要左右翻轉成「籃板在遠側、框朝庫卡」——
  // 目前 quokka-pose.js 沒有翻轉選項，這裡用 s 傳 'sx sy' 字串讓它水平翻轉（之後有 flip 選項再換掉）。
  const HOOP_S = 1.5, HOOP_AT = [-16, -30];
  const HOOP_PROP = { t: 'hoop', at: HOOP_AT, s: HOOP_S, flip: true, layer: 'back' };
  // 給舞台做物理用的籃框幾何（姿勢座標；舞台用 toStage 換算）：框的左右緣與高度、籃板朝庫卡那一面的 x 與上下緣
  const HOOP = {
    at: HOOP_AT, s: HOOP_S,
    left: HOOP_AT[0] - 14 * HOOP_S, right: HOOP_AT[0] + 20 * HOOP_S, y: HOOP_AT[1],
    board: HOOP_AT[0] - 15 * HOOP_S, boardTop: HOOP_AT[1] - 30 * HOOP_S, boardBottom: HOOP_AT[1] + 14 * HOOP_S,
    // 從 from（姿勢座標）出手要進框的初速（單位／秒；G＝重力，舞台是 1500）。舞台可以再乘上 0.92–1.1 的隨機值，就會有時進、有時彈框
    aim(from, G = 1500) {
      const cx = (this.left + this.right) / 2, apex = Math.min(from[1], this.y) - 30;
      const vy = -Math.sqrt(2 * G * (from[1] - apex)), tt = (-vy + Math.sqrt(2 * G * (this.y - apex))) / G;
      return { vx: (cx - from[0]) / tt, vy };
    }
  };
  const ANIMS = {
    // 羽球（跳殺）：看球、慢慢蹲低引拍 → 蹬地起跳，持拍手拉到頭後上方（拍頭朝後上），另一手指向球 →
    // 最高點揮拍，拍面在頭前上方擊中球（擊球點＝手掌位置＋拍子方向 × 拍長，算出來的）→ 停格 → 收拍到身體另一側、落地擠壓回彈 → 轉正面歡呼。
    // rk＝球拍角度（0 朝上、順時針為正；面向左時「後」是畫面右邊，所以引拍是正值、揮出去變負值），跟著手一起內插
    badminton: {
      dur: 3.9, hitT: 1.12, hitFallback: [27, -5],
      keys: [
        { t: 0, th: -10, pose: { rk: 128, arms: { R: { hand: [28, 124, 14] } } } },
        // 預備：轉向來球方向，持拍在身體側前方（拍面不擋臉）
        { t: .3, th: -42, pose: { rk: 62, sq: .97, eyes: 'focus', mouth: 'flat', look: [-1.5, -1.5], head: { pitch: -8 }, arms: { R: { hand: [28, 108, 14] }, L: { hand: [-12, 108, 34] } } } },
        // 蓄力：慢慢蹲低，手開始往後拉
        { t: .72, th: -52, pose: { rk: 50, sq: .82, lean: 8, eyes: 'focus', mouth: 'flat', look: [-1.5, -2], head: { pitch: -14 }, arms: { R: { hand: [30, 96, 0] }, L: { hand: [-14, 96, 36] } } } },
        // 蹬地起跳：身體拉長後仰，持拍手到頭後上方（拍頭朝後上），左手指向球
        { t: .96, th: -58, ease: 'out', pose: { rk: 44, y: -26, sq: 1.09, lean: -10, tailUp: .8, eyes: 'focus', mouth: 'o', look: [-1, -2], head: { pitch: -20 }, arms: { R: { hand: [28, 64, -14] }, L: { hand: [-14, 62, 30] } } } },
        // 最高點（停）：引拍到底
        { t: 1.04, th: -58, pose: { rk: 54, y: -29, sq: 1.06, lean: -12, tailUp: 1, eyes: 'focus', mouth: 'o', look: [-1, -2], head: { pitch: -20 }, arms: { R: { hand: [28, 62, -16] }, L: { hand: [-14, 64, 30] } } } },
        // 擊球：手臂往前上方甩直，身體由後仰變前壓（很快）
        { t: 1.12, th: -60, ease: 'in', pose: { rk: -34, y: -30, sq: 1.10, lean: 8, tailUp: 1, eyes: 'focus', mouth: 'open', head: { pitch: -8 }, arms: { R: { hand: [28, 62, 38] }, L: { hand: [-14, 104, 16] } } } },
        // 停格 0.06 秒
        { t: 1.18, th: -60, pose: { rk: -40, y: -30, sq: 1.10, lean: 9, tailUp: 1, eyes: 'focus', mouth: 'open', head: { pitch: -6 }, arms: { R: { hand: [28, 63, 39] }, L: { hand: [-14, 106, 16] } } } },
        // 收拍：拍子順勢揮到身體左下方，開始下墜（加速）
        { t: 1.36, th: -44, ease: 'out', pose: { rk: -138, y: -19, sq: 1.02, lean: 18, tailUp: .7, eyes: 'focus', mouth: 'open', head: { pitch: 4 }, arms: { R: { hand: [4, 112, 38] }, L: { hand: [-16, 112, 14] } } } },
        // 落地擠壓
        { t: 1.5, th: -40, ease: 'in', pose: { rk: -150, sq: .8, lean: 16, eyes: 'focus', mouth: 'smile', head: { pitch: 6 }, arms: { R: { hand: [0, 124, 36] }, L: { hand: [-16, 116, 16] } } } },
        // 回彈
        { t: 1.66, th: -38, ease: 'out', pose: { rk: -135, sq: 1.04, lean: 6, eyes: 'happy', mouth: 'smile', arms: { R: { hand: [4, 118, 34] }, L: { hand: [-12, 118, 24] } } } },
        { t: 1.86, th: -35, pose: { rk: -120, sq: .98, lean: 3, eyes: 'happy', mouth: 'smile', arms: { R: { hand: [10, 120, 32] } } } },
        // 轉正面，小蹲一下再跳起來舉拍歡呼
        { t: 2.2, th: -12, pose: { rk: -250, sq: .88, eyes: 'happy', mouth: 'smile', arms: { R: { hand: [28, 116, 16] }, L: { hand: [-16, 116, 22] } } } },
        { t: 2.5, th: 0, ease: 'out', pose: { rk: -346, y: -16, sq: 1.06, tailUp: .8, eyes: 'happy', mouth: 'open', blush: 1.3, head: { pitch: -6 }, arms: { R: { hand: [38, 74, 8] }, L: { hand: [-36, 78, 8] } } } },
        { t: 2.58, th: 0, pose: { rk: -344, y: -17, sq: 1.05, tailUp: .8, eyes: 'happy', mouth: 'open', blush: 1.3, head: { pitch: -6 }, arms: { R: { hand: [38, 72, 8] }, L: { hand: [-36, 76, 8] } } } },
        { t: 2.8, th: 0, ease: 'in', pose: { rk: -338, sq: .88, eyes: 'happy', mouth: 'open', blush: 1.3, arms: { R: { hand: [38, 80, 8] }, L: { hand: [-36, 84, 8] } } } },
        { t: 2.96, th: 0, ease: 'out', pose: { rk: -348, sq: 1.03, eyes: 'happy', mouth: 'open', blush: 1.3, arms: { R: { hand: [38, 74, 8] }, L: { hand: [-36, 80, 8] } } } },
        { t: 3.3, th: 0, pose: { rk: -344, eyes: 'happy', mouth: 'smile', blush: 1.2, arms: { R: { hand: [36, 78, 8] }, L: { hand: [-28, 104, 14] } } } },
        { t: 3.9, th: -10, pose: { rk: -232, arms: { R: { hand: [28, 124, 14] } } } }
      ],
      // 擊球點：擊球那一格的手掌位置＋拍子方向 × 拍長
      hitPoint() {
        const A = ANIMS.badminton, h = handsAt(A, A.hitT);
        return h && h.R ? racketHead(h.R.palm, sampleRaw(A, A.hitT).pose.rk) : A.hitFallback;
      },
      props(t) {
        const A = ANIMS.badminton, T = A.hitT, H = A.hitPoint(), rk = sampleRaw(A, t).pose.rk;
        const out = [{ t: 'racket', hand: 'R', ang: rk, hit: t >= T - .01 && t < T + HITSTOP + .04, swoosh: t > T - .07 && t < T + .2 }];
        const T1 = T + HITSTOP, FLY = .26, G = [H[0] - 104, 171];                  // 殺球落點（左前方地上）
        if (t < T) {
          // 來球：從左邊畫面外高高吊過來（高弧線），落到擊球點
          const u = (t - .08) / (T - .08);
          if (u >= 0) { const f = arc([H[0] - 150, 70], H, -150)(u); out.push({ t: 'shuttle', at: f.at, rot: f.dir }); }
        } else if (t < T1) out.push({ t: 'shuttle', at: H, rot: 128 });  // 停格：球壓在拍面上
        else if (t < T1 + FLY) {
          // 殺球：幾乎直線往左下衝（方向和拍面揮出去的方向一致），後面拖速度線
          const u = (t - T1) / FLY, x = lerp(H[0], G[0], u), y = lerp(H[1], G[1], u) - 24 * u * (1 - u);
          const d = Math.atan2(G[1] - H[1], G[0] - H[0]) * 180 / Math.PI;
          out.push({ t: 'fx', kind: 'speed', at: [x + 16, y - 22], rot: d, s: .9 }, { t: 'shuttle', at: [x, y], rot: d });
        } else if (t < T1 + FLY + .3) {
          // 落地彈一小下
          const u = (t - T1 - FLY) / .3;
          out.push({ t: 'shuttle', at: [G[0] - 16 * u, G[1] - 14 * 4 * u * (1 - u)], rot: lerp(128, 200, u) });
          if (u < .5) out.push({ t: 'fx', kind: 'dust', at: [G[0], 180], s: .4 });
        } else if (t < 3.5) out.push({ t: 'shuttle', at: [G[0] - 16, G[1]], rot: 200 });
        if (t > 2.45 && t < 3.3) out.push({ t: 'fx', kind: 'sparkle', at: [20, 30] }, { t: 'fx', kind: 'star', at: [136, 18] });
        return out;
      },
      endLine: '殺球成功！'
    },
    // 排球（低手墊球）：側前方面向來球，雙手前伸併成平台、蹲低等球 → 球落在前臂上 → 後腿蹬直把球往上送（停格）→
    // 身體順勢伸展、抬頭跟著球 → 太用力了，球衝出視窗上方 → 落回原地、驚訝、冒汗 → 交給撿球
    volleyball: {
      dur: 2.5, hitT: 1.12, hitFallback: [27, 127],
      keys: [
        { t: 0, th: -10, pose: {} },
        // 預備：轉向來球、抬頭盯球、手往前伸
        { t: .35, th: -50, pose: { sq: .95, lean: 6, eyes: 'focus', mouth: 'flat', look: [-1.5, -2], head: { pitch: -22 }, arms: { L: { hand: [-6, 122, 36] }, R: { hand: [6, 122, 36] } } } },
        // 蓄力：慢慢蹲低、雙手併成平台往前下方伸
        { t: .92, th: -58, pose: { sq: .78, lean: 18, eyes: 'focus', mouth: 'flat', look: [-1, -2], head: { pitch: -26 }, arms: { L: { hand: [-3, 130, 46] }, R: { hand: [3, 130, 46] } } } },
        // 觸球：平台迎上去
        { t: 1.12, th: -58, ease: 'in', pose: { sq: .95, lean: 14, eyes: 'focus', mouth: 'o', head: { pitch: -24 }, arms: { L: { hand: [-3, 118, 46] }, R: { hand: [3, 118, 46] } } } },
        // 停格
        { t: 1.18, th: -58, pose: { sq: .98, lean: 13, eyes: 'focus', mouth: 'o', head: { pitch: -25 }, arms: { L: { hand: [-3, 116, 46] }, R: { hand: [3, 116, 46] } } } },
        // 往上送：後腿蹬直、身體伸展離地一點點、抬頭跟著球
        { t: 1.34, th: -54, ease: 'out', pose: { y: -9, sq: 1.09, lean: 0, tailUp: .7, eyes: 'focus', mouth: 'o', look: [0, -2], head: { pitch: -30 }, arms: { L: { hand: [-3, 98, 44] }, R: { hand: [3, 98, 44] } } } },
        { t: 1.42, th: -54, pose: { y: -10, sq: 1.07, lean: -2, tailUp: .7, eyes: 'wide', mouth: 'o', look: [0, -2], head: { pitch: -32 }, arms: { L: { hand: [-4, 96, 42] }, R: { hand: [4, 96, 42] } } } },
        // 落地擠壓 → 回彈
        { t: 1.6, th: -50, ease: 'in', pose: { sq: .88, lean: 2, eyes: 'wide', mouth: 'open', look: [0, -2], head: { pitch: -30 }, arms: { L: { hand: [-10, 108, 36] }, R: { hand: [10, 108, 36] } } } },
        { t: 1.76, th: -46, ease: 'out', pose: { sq: 1.03, lean: -3, eyes: 'wide', mouth: 'open', look: [0, -2], head: { pitch: -32 }, arms: { L: { hand: [-20, 104, 26] }, R: { hand: [20, 104, 26] } } } },
        // 看著球飛走：手慢慢放下
        { t: 2.5, th: -40, pose: { sq: 1, lean: -2, eyes: 'wide', mouth: 'o', look: [-.5, -2], head: { pitch: -24 }, arms: { L: { hand: [-10, 122, 30] }, R: { hand: [10, 122, 30] } } } }
      ],
      events: [{ t: 1.12, name: 'throw', kind: 'vball', fromHand: true, from: [27, 127], v: [0, -1] }],
      // 觸球點＝雙手中間往前上方一點（和舞台出手時算的位置相同：雙手中點 ＋ [-6, -10]）
      hitPoint() {
        const A = ANIMS.volleyball, h = handsAt(A, A.hitT);
        return h && h.L && h.R ? [(h.L.X + h.R.X) / 2 - 6, (h.L.Y + h.R.Y) / 2 - 10] : A.hitFallback;
      },
      props(t, st) {
        const A = ANIMS.volleyball, T = A.hitT, H = A.hitPoint(), out = [];
        // 來球：從左邊畫面外高高拋過來的拋物線，落在前臂平台上
        if (!(st && st.thrown) && t <= T + HITSTOP) { const u = Math.min(1, t / T), f = arc([H[0] - 190, 26], H, -22)(u); out.push({ t: 'vball', at: f.at, rot: -u * 300 }); }
        if (t > T - .02 && t < T + .22) out.push({ t: 'fx', kind: 'impact', at: [H[0], H[1] + 8], s: .6, behind: true });
        if (t > 1.7) out.push({ t: 'fx', kind: 'sweat', at: [112, 34], s: 1.2 });
        return out;
      }
    },
    // 籃球（原地跳投）：抱球看框 → 慢慢蹲低、球往下帶到肚子前 → 後腿蹬直起跳、球沿身體中線往上帶 →
    // 最高點把球推出去（手腕下壓）→ 滯空時手停在出手的位置 → 加速落下、落地擠壓回彈 → 抬頭看球（之後由物理決定進不進）
    basketball: {
      dur: 2.4, hoop: HOOP,
      keys: [
        { t: 0, th: -25, pose: { bo: [-2, -4], arms: { R: { hand: [7, 110, 40] }, L: { hand: [-7, 110, 40] } } } },
        // 瞄準：抬頭看框
        { t: .25, th: -42, pose: { bo: [-2, -4], eyes: 'focus', mouth: 'flat', look: [-1.5, -2], head: { pitch: -14 }, arms: { R: { hand: [7, 108, 40] }, L: { hand: [-7, 108, 40] } } } },
        // 蓄力：慢慢蹲低、球往下帶
        { t: .74, th: -50, pose: { bo: [-2, -3], sq: .79, lean: 10, eyes: 'focus', mouth: 'flat', look: [-1.5, -2], head: { pitch: -18 }, arms: { R: { hand: [7, 128, 38] }, L: { hand: [-7, 128, 38] } } } },
        // 蹬地起跳：身體拉長、球帶到臉前
        { t: .9, th: -52, ease: 'in', pose: { bo: [-4, -7], y: -14, sq: 1.10, lean: 0, tailUp: .8, eyes: 'focus', mouth: 'o', look: [-1.5, -2], head: { pitch: -16 }, arms: { R: { hand: [7, 84, 38] }, L: { hand: [-7, 84, 38] } } } },
        // 最高點出手：雙手往前上方推直
        { t: .98, th: -52, ease: 'out', pose: { bo: [-6, -10], y: -23, sq: 1.07, lean: -3, tailUp: 1, eyes: 'focus', mouth: 'o', look: [-1.5, -2], head: { pitch: -16 }, arms: { R: { hand: [7, 62, 34] }, L: { hand: [-7, 62, 34] } } } },
        // 滯空（停兩格以上）：手停在出手的位置、手腕下壓
        { t: 1.08, th: -52, pose: { bo: [-6, -10], y: -25, sq: 1.05, lean: -2, tailUp: 1, eyes: 'focus', mouth: 'o', look: [-1.5, -2], head: { pitch: -18 }, arms: { R: { hand: [7, 60, 38], paw: 235 }, L: { hand: [-7, 62, 38], paw: 235 } } } },
        { t: 1.16, th: -52, pose: { bo: [-6, -10], y: -24, sq: 1.04, lean: -1, tailUp: 1, eyes: 'focus', mouth: 'o', look: [-1.5, -2], head: { pitch: -20 }, arms: { R: { hand: [7, 60, 39], paw: 245 }, L: { hand: [-7, 62, 39], paw: 245 } } } },
        // 下降加速（手還舉著）
        { t: 1.38, th: -50, ease: 'in', pose: { bo: [-6, -10], sq: .82, lean: 6, eyes: 'focus', mouth: 'o', look: [-1.5, -2], head: { pitch: -22 }, arms: { R: { hand: [8, 72, 38], paw: 245 }, L: { hand: [-8, 74, 38], paw: 245 } } } },
        // 回彈、手放下
        { t: 1.54, th: -48, ease: 'out', pose: { bo: [-6, -10], sq: 1.04, lean: 0, eyes: 'focus', mouth: 'o', look: [-1.5, -2], head: { pitch: -24 }, arms: { R: { hand: [14, 96, 32] }, L: { hand: [-12, 98, 34] } } } },
        { t: 1.8, th: -46, pose: { bo: [-6, -10], sq: .99, eyes: 'wide', mouth: 'o', look: [-2, -2], head: { pitch: -24 }, arms: { R: { hand: [10, 116, 30] }, L: { hand: [-10, 116, 32] } } } },
        { t: 2.4, th: -42, pose: { bo: [-6, -10], eyes: 'wide', mouth: 'o', head: { pitch: -22 }, look: [-2, -1.5], arms: { R: { hand: [9, 120, 30] }, L: { hand: [-9, 120, 32] } } } }
      ],
      events: [{ t: .98, name: 'throw', kind: 'bball', fromHand: true, v: [-0.62, -1] }],
      props(t, st) {
        const out = [HOOP_PROP];
        // bo＝球相對雙手中點的位移，跟著姿勢內插；出手那一格是 [-6, -10]（和舞台算出手位置用的一樣）
        if (!(st && st.thrown)) out.push({ t: 'bball', hand: 'both', off: sampleRaw(ANIMS.basketball, Math.min(t, .98)).pose.bo });
        return out;
      }
    }
  };

  // 走路跳一步用的舊版姿勢（由舞台依位置即時組合）；新程式請改用下面的 GAIT
  const FETCH = {
    hop: (u) => GAIT.hop(u).pose,
    reach: (u) => ({ sq: lerp(1, .84, u), lean: lerp(0, 30, u), head: { pitch: lerp(0, 10, u) }, eyes: u > .7 ? 'happy' : 'focus', mouth: 'smile', arms: { L: { hand: [-8, lerp(118, 140, u), lerp(36, 46, u)] }, R: { hand: [8, lerp(120, 142, u), lerp(36, 44, u)] } } }),
    carry: (u) => ({ y: -14 * Math.sin(Math.PI * u), lean: 8, tailUp: .6 * Math.sin(Math.PI * u), eyes: 'happy', mouth: 'open', arms: { L: { hand: [-6, 108, 40] }, R: { hand: [6, 110, 40] } } })
  };

  // ---------------------------------------------------------------------------
  // 步態：一步的進度 u（0–1）→ { th, pose, advance }，以「往左走」為準（往右用 mirrorFrame() 鏡射）。
  // advance＝這一步已經前進的比例（0–1）。舞台請用 x = x0 + 方向 × stride × k × advance 來移動，
  // 腳（或撐地的前爪）著地的那一段 advance 不變，就不會滑步。每種步態建議的一步時間與位移在 GAIT.info。
  //   walk  慢慢移動：五足步態（前爪＋尾巴撐地，兩隻後腳一起往前擺）。
  //         前半步（u 0–.42）後腳踩著不動、身體往前送、前爪離地往前伸（advance＝0）；
  //         後半步（u .42–.9）前爪撐地不動、臀部抬高拱背、後腳離地往前擺到前爪後面再落地（advance 0→1）；最後 .1 站穩。
  //         腳和爪在地上時位移為零：身體自己的前後移動用 pose.x，後腳用 pose.footShift 抵銷（見 quokka-pose.js）
  //   hop   中距離：小步跳。u 0–.2 蹲低蹬地（腳在地上，advance＝0）→ .2–.8 騰空（等速前進）→ .8–1 落地擠壓（advance＝1）
  //         前爪與耳朵跟著節奏：蹬地時前爪收到胸口、耳朵後甩 → 騰空微張 → 落地前爪往下緩衝、耳朵被甩一下再彈回
  //   dash  趕路／撿球衝刺：大步跳，身體壓低拉長、腳往後收。u 0–.14 蹬地 → .14–.86 騰空 → 落地
  // ---------------------------------------------------------------------------
  const WALK_SW = [.1, .9], WALK_LIFT = 12, WALK_ARCH = 1.5, WALK_TOE = 6, WALK_BODY = 6;   // 後腳擺盪區間（撐地段內的比例）、離地高度、每抬高 1 單位多前傾幾度（肩膀才壓得住前爪）、腳尖下垂、身體前後送的幅度
  const WALK_LEAN = 59, WALK_ZB = 44, WALK_ZF = 56.2;                    // 前傾（前爪要搆得到地至少約 58°）；前爪在身體座標的前後範圍，對應畫面位移 stride − 2×WALK_BODY（量出來的）
  // 小跳的前爪關鍵位置 [u, 左右張開, 高度, 前後]（身體座標；左爪 x 取負）
  const HOP_ARMS = [[0, 8, 131, 33], [.2, 6, 113, 27], [.5, 12, 121, 37], [.8, 9.5, 126, 38], [1, 8, 131, 33]];
  const GAIT = {
    info: {
      walk: { dur: .8, stride: 22, plant: [.42, .9] },                   // plant＝前爪撐地、身體前移的區間
      hop: { dur: .42, stride: 34, air: [.2, .8] },
      dash: { dur: .36, stride: 60, air: [.14, .86] }
    },
    walk(u) {
      u = clamp(u, 0, 1);
      const inA = u < .42, w = clamp((u - .42) / .48, 0, 1), eB = EASE.io(w), eA = EASE.io(clamp(u / .42, 0, 1));
      const stride = GAIT.info.walk.stride, adv = inA ? 0 : eB;
      // 身體相對「步伐原點」的前後位移 cf（往前為正）：前半步後腳踩著、身體往前送（−C→+C），
      // 後半步前爪撐著、後腳往前擺到身體下方（+C→−C）。這樣身體是連續往前走的，不是走一下停一下
      const cf = inA ? lerp(-WALK_BODY, WALK_BODY, eA) : lerp(WALK_BODY, -WALK_BODY, eB);
      // 前爪：左爪先伸、右爪晚一點（只有離地的時候錯開，著地後一起撐）；撐地時往回收的量剛好抵銷身體前進 → 不滑
      const reach = (d) => EASE.io(clamp((u - d) / .34, 0, 1));
      const hand = (k, d) => {
        const e = inA ? reach(d) : 1 - eB, lift = inA ? 7 * Math.sin(Math.PI * reach(d)) : 0;
        return { hand: [k * 7, 174 - lift, lerp(WALK_ZB, WALK_ZF, e)] };
      };
      // 後腳（五足步態的擺盪相位）：前爪和尾巴撐著，兩隻後腳一起離地往前擺。
      // sw＝擺盪進度；fW＝後腳在地面上已前進的比例。腳在地上時 footShift 抵銷身體的位移（腳留在原地）→ 不滑步
      const sw = clamp((w - WALK_SW[0]) / (WALK_SW[1] - WALK_SW[0]), 0, 1), fW = EASE.io(sw), arc = Math.sin(Math.PI * sw);
      const up = WALK_LIFT * arc;                                        // 臀部連同後腳抬高（腳離地的高度）
      // 前傾：前爪往前伸時伸長壓低；後腳擺盪時臀部抬高、背拱起來（上半身多往下彎，肩膀才留在前爪上方）；落地後回到蹲姿
      const lean = (inA ? lerp(WALK_LEAN, WALK_LEAN + 3, eA) : u < .9 ? lerp(WALK_LEAN + 3, WALK_LEAN + 1, eB) : lerp(WALK_LEAN + 1, WALK_LEAN, (u - .9) / .1)) + WALK_ARCH * up;
      const sq = (inA ? lerp(1, .985, eA) : lerp(.985, 1, eB)) + .035 * arc;
      return {
        th: -90, advance: adv,
        pose: {
          x: -cf, y: -up, lean, feet: 'stand', sq,
          footShift: [(stride * (fW - adv) - cf) * Math.sqrt(sq), 0, WALK_TOE * arc * (1 - sw)],   // 剛離地時腳尖下垂，落地前放平
          head: { pitch: -(lean - 12) + 3 * Math.sin(2 * Math.PI * u) },    // 身體前傾，頭往回抬 → 平視前方，隨步伐輕輕點頭
          tailUp: -up / 30,                                              // 臀部抬高時尾端仍拖在地上（尾巴是第五隻腳）
          earFlop: { L: 3 + 6 * arc, R: 3 + 6 * arc },                   // 身體前移時耳朵往後壓一點
          eyes: 'open', mouth: 'smile', look: [-1, .3],
          arms: { L: hand(-1, 0), R: hand(1, .08) }
        }
      };
    },
    hop(u) {
      u = clamp(u, 0, 1);
      const v = clamp((u - .2) / .6, 0, 1), air = u > .2 && u < .8, h = Math.sin(Math.PI * v);
      const sq = u < .2 ? lerp(.9, 1.06, EASE.in(u / .2)) : u < .8 ? lerp(1.06, 1.03, v) : lerp(1.03, .9, EASE.out((u - .8) / .2));
      // 前爪跟著跳躍節奏：蹲低時垂在身前（＝上一步落地緩衝的位置，連續跳才接得起來）→ 蹬地時收到胸口 →
      // 騰空時微微張開往前 → 落地時往下往前伸、緩衝後沉到最低
      const armAt = (uu) => {
        const P = HOP_ARMS; let i = 0;
        while (i < P.length - 2 && P[i + 1][0] <= uu) i++;
        const e = EASE.io(clamp((uu - P[i][0]) / (P[i + 1][0] - P[i][0]), 0, 1));
        return [1, 2, 3].map((j) => lerp(P[i][j], P[i + 1][j], e));
      };
      const [ax, ay, az] = armAt(u), [bx, by, bz] = armAt(clamp(u - .05, 0, 1));          // 右爪晚 0.05 步（不會兩隻完全同步像機器）
      // 耳朵：蹲低時先豎起來一點 → 蹬出去往後甩 → 最高點回正、下墜時往上飄 → 落地被慣性往下甩一下再彈回；右耳晚一點
      const ear = (uu) => {
        if (uu < .2) { const t = uu / .2; return 9.6 * EASE.in(t) - 4 * Math.sin(Math.PI * t); }
        if (uu < .8) return 9.6 * Math.cos(Math.PI * clamp((uu - .2) / .6 - .1, 0, 1));
        const t = (uu - .8) / .2; return lerp(-9.1, 0, EASE.out(t)) + 11 * Math.sin(Math.PI * t) * (1 - .5 * t);
      };
      const g = u < .2 ? 1 - u / .2 : u > .8 ? (u - .8) / .2 : 0;                           // 在地上蹲多低（0–1）
      return {
        th: -90, advance: v,
        pose: { y: -16 * h, sq, lean: u < .2 ? lerp(8, 14, u / .2) : u < .8 ? 14 : lerp(14, 8, (u - .8) / .2), feet: air ? 'air' : 'stand', tailUp: .5 * Math.sin(Math.PI * clamp((u - .28) / .6, 0, 1)),
          head: { pitch: -8 - 3 * h + 4 * EASE.io(g) }, earFlop: { L: ear(u), R: ear(clamp(u - .04, 0, 1)) },
          eyes: 'open', mouth: 'smile', arms: { L: { hand: [-ax, ay, az] }, R: { hand: [bx, by, bz] } } }
      };
    },
    dash(u) {
      u = clamp(u, 0, 1);
      const v = clamp((u - .14) / .72, 0, 1), air = u > .14 && u < .86, h = Math.sin(Math.PI * v);
      const sq = u < .14 ? lerp(.86, 1.1, EASE.in(u / .14)) : u < .86 ? lerp(1.1, 1.04, v) : lerp(1.04, .86, EASE.out((u - .86) / .14));
      const fl = flopOf(-110 * Math.cos(Math.PI * clamp(v - .1, 0, 1))) * (air ? 1 : .4) + 6;
      const y = -24 * h;
      return {
        th: -90, advance: v,
        pose: { y, sq, lean: u < .14 ? lerp(18, 34, u / .14) : u < .86 ? lerp(34, 26, v) : lerp(26, 18, (u - .86) / .14), feet: air ? 'air' : 'stand', tailUp: .4 * Math.sin(Math.PI * clamp((u - .2) / .7, 0, 1)),
          head: { pitch: -24 }, earFlop: { L: fl, R: fl }, eyes: 'focus', mouth: 'open', arms: { L: { hand: [-7, 124, 30] }, R: { hand: [7, 124, 30] } },
          props: u < .4 ? [{ t: 'fx', kind: 'dust', at: [122, 184], s: .7 }, { t: 'fx', kind: 'speed', at: [152, 112 + y], rot: 180, s: .9 }] : [{ t: 'fx', kind: 'speed', at: [152, 112 + y], rot: 180, s: .9 }] }
      };
    }
  };

  // ---------------------------------------------------------------------------
  // 撿球（照使用者意見重排，不再用鼻子頂球）：
  // 發現 → 衝刺 → 煞車 → 靠近蹲低、看一眼 → 兩隻前爪伸出去搭在球上 → 把球撥到身前、從兩側捧起 →
  // 坐直抱在胸前（低頭看一眼、開心）→ 轉身 → 抱著球小步帶回去 → 到家輕拋一下接住慶祝
  // 每個函式：u（0–1）→ { th, pose }，以「球在左邊」（面向左）為準；球在右邊用 mirrorFrame() 鏡射。
  // 舊流程的名稱（sniff、drop、nudge、rescoop、homeVNudge）都保留，內容改成合理的動作；
  // 回程請一律用 carry（drop／nudge 只是保留給還沒改的舞台，畫出來一樣是抱著球走）。
  // ballDist：伸爪時球心在腳前方多遠（姿勢單位）；舞台請讓庫卡停在離球這麼遠的地方（取代舊的 NOSE＝106）
  // ---------------------------------------------------------------------------
  const BALL_DIST = 88, BALL_GROUND = [80 - BALL_DIST, 171];
  const HOLD = { L: { hand: [-8, 112, 40] }, R: { hand: [8, 114, 40] } };            // 前爪把球捧在胸前
  const P_BRAKE = { sq: .84, lean: -10, tailUp: .3, eyes: 'wide', mouth: 'o', feet: 'stand' };
  const P_PEEK = { lean: 34, sq: .9, head: { pitch: 4 }, tailUp: .2, eyes: 'focus', mouth: 'smile', look: [-1, 1.5], arms: { L: { hand: [-9, 140, 40] }, R: { hand: [9, 140, 40] } } };      // 蹲低前傾、低頭看球
  const P_REACH = { lean: 64, sq: .88, head: { pitch: -16 }, tailUp: .35, eyes: 'focus', mouth: 'open', look: [-1, 1.5], arms: { L: { hand: [-12, 150, 70] }, R: { hand: [12, 150, 70] } } }; // 兩爪伸出去搭在球上
  const P_PULL = { lean: 48, sq: .9, head: { pitch: -2 }, tailUp: .2, eyes: 'happy', mouth: 'open', look: [-1, 1.5], arms: { L: { hand: [-13, 156, 50] }, R: { hand: [13, 156, 50] } } };     // 把球撥到身前，兩爪在球兩側
  const P_SCOOP = { lean: 26, sq: .92, head: { pitch: 12 }, eyes: 'happy', mouth: 'open', arms: { L: { hand: [-9, 134, 42] }, R: { hand: [9, 136, 42] } } };                                // 從兩側捧起來
  const P_SIT = { sq: .96, lean: -4, eyes: 'happy', mouth: 'open', blush: 1.4, arms: HOLD };
  const mixP = (a, b, e) => mix(withArms(a), withArms(b), e);          // 兩個姿勢內插（沒寫的欄位先補中立值，才不會中途跳）
  const ballHeld = (kind, off = [0, -4]) => ({ t: kind, hand: 'both', off });
  // 伸爪那一格，球（在地上）相對雙手中點的位置：之後捧起來的過程由這個位移慢慢收到手心，球不會跳
  let reachOff = null;
  function reachOffset() {
    if (reachOff) return reachOff;
    let off = [-15, -4];                                                 // 沒有繪圖模組時的預設（量出來的）
    try { const Q = poseLib(); if (Q) { const h = Q.render(-90, 'qh', { ...P_REACH, accessory: 'none' }).hands; off = [BALL_GROUND[0] - (h.L.X + h.R.X) / 2, BALL_GROUND[1] - (h.L.Y + h.R.Y) / 2]; } } catch (e) { /* 用預設 */ }
    return (reachOff = off);
  }
  // 抱著球小步蹦（回程）：步子小、身體直、球穩穩在胸前
  const carryStep = (u, kind) => {
    const v = clamp((u - .18) / .64, 0, 1), air = u > .18 && u < .82, h = Math.sin(Math.PI * v);
    return { th: 90, pose: { y: -9 * h, sq: u < .18 ? lerp(.93, 1.03, u / .18) : u > .82 ? lerp(1.02, .93, (u - .82) / .18) : 1.03, lean: 6, feet: air ? 'air' : 'stand', tailUp: .4 * Math.sin(Math.PI * clamp((u - .25) / .7, 0, 1)),
      earFlop: { L: 6 * Math.cos(Math.PI * v) * (air ? 1 : 0), R: 6 * Math.cos(Math.PI * v) * (air ? 1 : 0) }, eyes: 'happy', mouth: 'smile', blush: 1.2, arms: HOLD, props: [ballHeld(kind, [2, -4])] } };
  };
  // 輕拋一下再接住（v 0–1）：手往上送 → 球離手往上約 24 單位 → 落回手心、手順勢往下緩衝
  const tossOff = (v) => { const up = clamp((v - .25) / .5, 0, 1); return [0, -4 - 24 * 4 * up * (1 - up)]; };
  const tossArms = (v) => { const d = v < .25 ? -6 * EASE.out(v / .25) : v < .75 ? lerp(-6, -2, (v - .25) / .5) : lerp(4, 0, EASE.out((v - .75) / .25)); return { L: { hand: [-8, 112 + d, 40] }, R: { hand: [8, 114 + d, 40] } }; };
  const FETCH2 = {
    ballDist: BALL_DIST,
    // 1 發現：轉頭看球、睜大眼（頭上的「！」由舞台用 CSS 畫）
    discover: (u) => { const e = EASE.out(Math.min(1, u * 2)); return { th: lerp(-10, -40, e), pose: { head: { yaw: -40 * e }, eyes: 'wide', mouth: 'o', look: [-2 * e, 0], earFlop: { L: -8 * Math.sin(Math.PI * Math.min(1, u * 2.5)), R: -8 * Math.sin(Math.PI * Math.min(1, u * 2.5)) } } }; },
    // 2 衝刺：大步跳（＝GAIT.dash），身體壓低拉長、騰空時腳往後收、尾巴平衡
    dash: (u) => { const g = GAIT.dash(u); return { th: g.th, pose: g.pose }; },
    // 3 煞車：落地壓低、往後仰，前面揚起一點灰
    brake: (u) => ({ th: -90, pose: { ...mixP({ sq: .95, lean: 14, tailUp: .4, eyes: 'focus', mouth: 'open', feet: 'stand' }, P_BRAKE, EASE.out(Math.min(1, u * 2))), props: [{ t: 'fx', kind: 'dust', at: [10, 184], s: .6 }] } }),
    // 4 靠近：蹲低前傾、低頭看一眼（很短）→ 兩隻前爪伸出去搭在球上
    sniff: (u) => {
      const p = u < .35 ? mixP(P_BRAKE, P_PEEK, EASE.io(u / .35)) : mixP(P_PEEK, P_REACH, EASE.io(Math.min(1, (u - .35) / .5)));
      return { th: -90, pose: p };
    },
    // 5 撥過來、捧起來：前爪把球往身前撥（球在地上滾過來）→ 兩爪從兩側捧起
    scoop: (u, kind) => {
      const o = reachOffset(), a = Math.min(1, u / .55), b = clamp((u - .55) / .45, 0, 1);
      const pose = u < .55 ? mixP(P_REACH, P_PULL, EASE.io(a)) : mixP(P_PULL, P_SCOOP, EASE.io(b));
      const off = u < .55 ? mix(o, [-3, -1], EASE.io(a)) : mix([-3, -1], [-3, -3], b);
      return { th: -90, pose: { ...pose, props: [{ ...ballHeld(kind, off), rot: -200 * EASE.io(a) }] } };
    },
    // 6 坐直抱在胸前：先低頭看一眼球，再抬頭開心
    sit: (u, kind) => {
      const e = EASE.out(u), p = mixP(P_SCOOP, P_SIT, e);
      p.head = { ...p.head, pitch: p.head.pitch + 10 * Math.sin(Math.PI * clamp((u - .1) / .6, 0, 1)) };
      return { th: lerp(-90, -30, e), pose: { ...p, props: [ballHeld(kind), ...(u > .6 ? [{ t: 'fx', kind: 'sparkle', at: [130, 40] }] : [])] } };
    },
    // 轉向回家的方向（抱著球）；回程面向右（家在球的另一邊）
    turnHome: (u, kind) => ({ th: lerp(-30, 90, EASE.io(u)), pose: { ...P_SIT, mouth: 'smile', props: [ballHeld(kind)] } }),
    // 7 抱著球小步帶回去
    carry: carryStep,
    // （舊流程保留）原本是把球放到地上用鼻子推：現在一律抱著走，這三段畫出來都是抱著球
    drop: (u, kind) => ({ th: 90, pose: { ...P_SIT, mouth: 'smile', props: [ballHeld(kind || 'vball', [2, -4])] } }),
    nudge: (u, kind) => carryStep(u, kind || 'vball'),
    rescoop: (u, kind) => ({ th: lerp(90, -30, EASE.io(u)), pose: { ...P_SIT, mouth: 'smile', props: [ballHeld(kind || 'bball')] } }),
    // 到家的慶祝：把球往上輕拋再接住（任何球都可以用；舞台可以接在 homeB／homeV 前面）
    homeToss: (u, kind) => {
      const v = clamp(u, 0, 1), up = Math.sin(Math.PI * clamp((v - .25) / .5, 0, 1));
      return { th: -30, pose: { ...P_SIT, sq: .96 + .03 * up, head: { pitch: -12 * up }, look: [0, -1.5 * up], arms: tossArms(v), props: [{ ...ballHeld(kind || 'vball', tossOff(v)), rot: 120 * v }] } };
    },
    // 8 到家（籃球）：輕拋一下接住，再轉向籃框、把球捧到胸前準備再投
    homeB: (u) => {
      if (u < .5) { const fr = FETCH2.homeToss(u / .5, 'bball'); fr.pose.props.push(HOOP_PROP); return fr; }
      const e = EASE.io((u - .5) / .5);
      return { th: lerp(-30, -42, e), pose: { ...mixP(P_SIT, { sq: .92, lean: 4, eyes: 'focus', mouth: 'smile', head: { pitch: -14 }, look: [-1.5, -2], arms: { R: { hand: [7, 108, 40] }, L: { hand: [-7, 108, 40] } } }, e), props: [ballHeld('bball', mix([0, -4], [-2, -4], e)), HOOP_PROP] } };
    },
    // 到家（排球）：接住之後抱著球左右晃、開心說話（說「撿回來了！」的時候球在手上）→ 最後回到抱球坐好（接 homeV）
    homeHug: (u) => {
      const sw = Math.sin(Math.PI * 2 * clamp(u / .85, 0, 1)) * (1 - clamp((u - .7) / .3, 0, 1)), e = EASE.io(clamp((u - .8) / .2, 0, 1));
      return { th: lerp(-30, -20, EASE.io(u)), pose: { ...P_SIT, mouth: u < .8 ? 'open' : 'smile', roll: 4 * sw, head: { roll: 6 * sw, pitch: -4 * (1 - e) }, sq: .96 + .02 * Math.abs(sw),
        arms: { L: { hand: [-8, 112 - 2 * Math.abs(sw), 40] }, R: { hand: [8, 114 - 2 * Math.abs(sw), 40] } },
        props: [ballHeld('vball', [0, -4 - 2 * Math.abs(sw)]), ...(u > .3 && u < .9 ? [{ t: 'fx', kind: 'heart', at: [124, 70 - (u - .3) * 40], s: .7 }] : [])] } };
    },
    // 8 到家（排球）：輕拋一下接住 → 把球放在腳邊（之後球由舞台畫在腳邊）→ 伸爪拍一拍、冒小愛心
    homeV: (u) => {
      if (u < .2) {
        // 彎腰把球放到右前方的地上
        const e = EASE.io(u / .2);
        return { th: -20, pose: { ...mixP({ ...P_SIT, mouth: 'smile' }, { lean: 22, sq: .9, head: { pitch: 14 }, eyes: 'happy', mouth: 'smile', arms: { L: { hand: [12, 150, 40] }, R: { hand: [30, 150, 34] } } }, e), props: [ballHeld('vball', mix([0, -4], [4, 0], e))] } };
      }
      const set = { lean: 20, sq: .94, head: { pitch: 16 }, eyes: 'happy', mouth: 'smile', arms: { R: { hand: [14, 134, 48] } } };
      const p = mixP({ lean: 22, sq: .9, head: { pitch: 14 }, eyes: 'happy', mouth: 'smile', arms: { L: { hand: [12, 150, 40] }, R: { hand: [30, 150, 34] } } }, set, EASE.io(Math.min(1, (u - .2) / .15)));
      if (u > .35) p.arms = { ...p.arms, R: { hand: [14, 134 - 7 * Math.abs(Math.sin((u - .35) * Math.PI * 4)), 48] } };
      p.props = u > .5 ? [{ t: 'fx', kind: 'heart', at: [118, 140 - (u - .5) * 30], s: .8 }] : [];
      return { th: -20, pose: p };
    },
    // （舊流程保留）用鼻子推回來的排球：現在和抱回來一樣，輕拋慶祝
    homeVNudge: (u) => { const fr = FETCH2.homeToss(u, 'vball'); return { th: 90, pose: fr.pose }; }
  };
  // 鏡射（球在右邊時）：角度、轉頭、眼珠、耳朵、左右手、場景道具的 x 都左右對調
  function mirrorFrame(fr) {
    const p = { ...fr.pose };
    if (p.head) p.head = { ...p.head, yaw: -(p.head.yaw || 0), roll: -(p.head.roll || 0) };
    if (p.look) p.look = [-p.look[0], p.look[1]];
    if (p.roll) p.roll = -p.roll;
    if (p.earFlop) p.earFlop = { L: p.earFlop.R || 0, R: p.earFlop.L || 0 };
    if (p.x) p.x = -p.x;
    if (p.arms) {
      // 左右手對調，x 反號（不對稱的姿勢——揮手、走路先伸的那隻前爪——鏡射後才是對的）
      const flip = (a) => (a ? { ...a, hand: a.hand ? [-a.hand[0], a.hand[1], a.hand[2]] : a.hand, ...(a.elbow ? { elbow: [-a.elbow[0], a.elbow[1], a.elbow[2]] } : {}) } : a);
      const arms = {};
      if (p.arms.R) arms.L = flip(p.arms.R);
      if (p.arms.L) arms.R = flip(p.arms.L);
      p.arms = arms;
    }
    if (p.props) p.props = p.props.map((q) => {
      const o = { ...q };
      if (o.at) o.at = [160 - o.at[0], o.at[1]];
      if (o.off) o.off = [-o.off[0], o.off[1]];
      if (o.hand === 'L') o.hand = 'R'; else if (o.hand === 'R') o.hand = 'L';
      if (o.kind === 'speed' && o.rot != null) o.rot = 180 - o.rot;
      if (o.kind === 'sniff') o.kind = 'sniffR'; else if (o.kind === 'sniffR') o.kind = 'sniff';
      return o;
    });
    const out = { th: -fr.th, pose: p };
    if (fr.advance != null) out.advance = fr.advance;
    return out;
  }

  // ---------------------------------------------------------------------------
  // 舞台用的反應與小動作（工作反應、摸頭、頭暈、吃東西、跳、打盹…）
  // 頭部 pitch：正＝低頭、負＝抬頭（見 quokka-pose.js）
  // loop:true 的可以重複播（例如長摸撒嬌）
  // ---------------------------------------------------------------------------
  const UP = { L: { hand: [-34, 72, 8] }, R: { hand: [34, 72, 8] } };            // 雙手舉高
  const UP2 = { L: { hand: [-36, 76, 4] }, R: { hand: [36, 76, 4] } };
  const WAVE_A = { R: { hand: [30, 70, 14] } }, WAVE_B = { R: { hand: [38, 80, 2] } };
  const CHEEK = { L: { hand: [-31, 60, 2] }, R: { hand: [31, 60, 2] } };         // 雙手抱在頭的兩側（不遮眼睛）
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
    // 大歡呼（全部完成、漲停）：兩段大跳。第一跳在空中轉一整圈、落地時剛好回到正面；第二跳正面舉手
    bigCheer: { dur: 3.0, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .3, th: 0, pose: { sq: .82, eyes: 'happy', mouth: 'open' } },
      { t: .64, th: 170, ease: 'out', pose: { y: -36, sq: 1.08, tailUp: 1, eyes: 'happy', mouth: 'open', head: { pitch: -10 }, arms: UP, blush: 1.4 } },
      { t: .72, th: 215, ease: 'lin', pose: { y: -36, sq: 1.07, tailUp: 1, eyes: 'happy', mouth: 'open', head: { pitch: -10 }, arms: UP, blush: 1.4 } },
      { t: 1.02, th: 360, ease: 'in', pose: { sq: .84, eyes: 'happy', mouth: 'open', arms: UP2 } },
      { t: 1.16, th: 360, ease: 'out', pose: { sq: 1.03, eyes: 'happy', mouth: 'open', arms: UP2, blush: 1.4 } },
      { t: 1.3, th: 360, pose: { sq: .86, eyes: 'happy', mouth: 'open', arms: { L: { hand: [-26, 104, 16] }, R: { hand: [26, 104, 16] } }, blush: 1.4 } },
      { t: 1.6, th: 360, ease: 'out', pose: { y: -32, sq: 1.08, tailUp: 1, eyes: 'happy', mouth: 'open', head: { pitch: -10 }, arms: UP, blush: 1.4 } },
      { t: 1.68, th: 360, pose: { y: -33, sq: 1.07, tailUp: 1, eyes: 'happy', mouth: 'open', head: { pitch: -10 }, arms: UP, blush: 1.4 } },
      { t: 1.96, th: 360, ease: 'in', pose: { sq: .86, eyes: 'happy', mouth: 'open', arms: UP2, blush: 1.4 } },
      { t: 2.12, th: 360, ease: 'out', pose: { sq: 1.03, eyes: 'happy', mouth: 'open', arms: UP, blush: 1.4 } },
      { t: 2.4, th: 360, pose: { eyes: 'happy', mouth: 'open', arms: UP, blush: 1.4 } },
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
    // 醒來伸懶腰：先往前趴著伸（手往前、屁股翹）→ 再往上伸（閉眼張嘴、雙手一高一低往外撐、尾巴翹）→ 放鬆。和歡呼的差別：閉眼、慢、手不對稱
    stretch: { dur: 1.9, keys: [
      { t: 0, th: -10, pose: { sq: .92, head: { pitch: 10 }, eyes: 'closed' } },
      { t: .5, th: -42, pose: { sq: .88, lean: 20, head: { pitch: -14 }, eyes: 'closed', mouth: 'flat', tailUp: .5, arms: { L: { hand: [-10, 146, 48] }, R: { hand: [10, 146, 48] } } } },
      { t: .7, th: -42, pose: { sq: .87, lean: 22, head: { pitch: -16 }, eyes: 'closed', mouth: 'flat', tailUp: .6, arms: { L: { hand: [-10, 148, 50] }, R: { hand: [10, 148, 50] } } } },
      { t: 1.15, th: -6, pose: { sq: 1.08, lean: -5, head: { pitch: -16, roll: 7 }, eyes: 'closed', mouth: 'open', tailUp: .8, arms: { L: { hand: [-44, 96, 0] }, R: { hand: [40, 72, 4] } } } },
      { t: 1.4, th: -6, pose: { sq: 1.09, lean: -6, head: { pitch: -18, roll: 8 }, eyes: 'closed', mouth: 'open', tailUp: .9, arms: { L: { hand: [-45, 94, 0] }, R: { hand: [41, 70, 4] } } } },
      { t: 1.65, th: -8, pose: { sq: .97, eyes: 'happy', mouth: 'smile' } },
      { t: 1.9, th: -10, pose: {} }] }
  };

  // ---------------------------------------------------------------------------
  // 提醒（響鈴）：循環動畫，可以連續播很久。
  //   ALERT.ring   活潑版：每輪 2.4 秒——跳一下吸引注意 → 舉手揮兩下 → 手指向頭上的氣泡、抬頭看氣泡再看使用者 → 原地小碎步踩兩下。
  //                六輪一個大循環（14.4 秒）：一般、一般、拍拍手、一般、一般、踮腳張望
  //   ALERT.quiet  響很久之後的安靜版（7.2 秒一輪）：坐下、眼巴巴看著使用者、偶爾揮一下手、嘆一口氣
  // 兩個都是正面（th≈0）、loop:true；舞台用 t % dur 取樣即可
  // ---------------------------------------------------------------------------
  const WAVE_HI = { R: { hand: [34, 66, 12] } }, WAVE_OUT = { R: { hand: [44, 78, 4] } };
  const POINT_UP = { R: { hand: [33, 57, 6] }, L: { hand: [-10, 122, 30] } };          // 右手舉到頭旁往上指（氣泡在頭上）
  const A_HOP = [                                                                      // 0–.56 跳一下
    { t: 0, th: 0, pose: { eyes: 'wide', mouth: 'open' } },
    { t: .14, th: 0, pose: { sq: .86, eyes: 'wide', mouth: 'open' } },
    { t: .3, th: 0, ease: 'out', pose: { y: -16, sq: 1.07, tailUp: .8, eyes: 'wide', mouth: 'open', arms: { L: { hand: [-28, 108, 14] }, R: { hand: [28, 108, 14] } } } },
    { t: .36, th: 0, pose: { y: -16, sq: 1.06, tailUp: .8, eyes: 'wide', mouth: 'open', arms: { L: { hand: [-28, 106, 14] }, R: { hand: [28, 106, 14] } } } },
    { t: .5, th: 0, ease: 'in', pose: { sq: .88, eyes: 'happy', mouth: 'open' } },
    { t: .62, th: 0, ease: 'out', pose: { sq: 1.03, eyes: 'happy', mouth: 'open', arms: { R: { hand: [28, 96, 18] } } } }];
  const A_WAVE = [                                                                     // .62–1.3 揮兩下
    { t: .76, th: 0, pose: { eyes: 'happy', mouth: 'open', head: { roll: 4 }, blush: 1.2, arms: WAVE_HI } },
    { t: .9, th: 0, pose: { eyes: 'happy', mouth: 'open', head: { roll: -5 }, blush: 1.2, arms: WAVE_OUT } },
    { t: 1.04, th: 0, pose: { eyes: 'happy', mouth: 'open', head: { roll: 5 }, blush: 1.2, arms: WAVE_HI } },
    { t: 1.18, th: 0, pose: { eyes: 'happy', mouth: 'open', head: { roll: -5 }, blush: 1.2, arms: WAVE_OUT } },
    { t: 1.3, th: 0, pose: { eyes: 'happy', mouth: 'open', blush: 1.2, arms: WAVE_HI } }];
  const A_CLAP = [                                                                     // 變化：在胸前拍三下手
    { t: .76, th: 0, pose: { eyes: 'happy', mouth: 'open', blush: 1.2, arms: { L: { hand: [-16, 96, 34] }, R: { hand: [16, 96, 34] } } } },
    { t: .85, th: 0, ease: 'in', pose: { sq: .98, eyes: 'happy', mouth: 'open', blush: 1.2, arms: { L: { hand: [-3, 96, 40] }, R: { hand: [3, 96, 40] } } } },
    { t: .96, th: 0, ease: 'out', pose: { eyes: 'happy', mouth: 'open', blush: 1.2, arms: { L: { hand: [-16, 94, 34] }, R: { hand: [16, 94, 34] } } } },
    { t: 1.05, th: 0, ease: 'in', pose: { sq: .98, eyes: 'happy', mouth: 'open', blush: 1.2, arms: { L: { hand: [-3, 96, 40] }, R: { hand: [3, 96, 40] } } } },
    { t: 1.16, th: 0, ease: 'out', pose: { eyes: 'happy', mouth: 'open', blush: 1.2, arms: { L: { hand: [-16, 94, 34] }, R: { hand: [16, 94, 34] } } } },
    { t: 1.25, th: 0, ease: 'in', pose: { sq: .98, eyes: 'happy', mouth: 'open', blush: 1.2, arms: { L: { hand: [-3, 96, 40] }, R: { hand: [3, 96, 40] } } } },
    { t: 1.32, th: 0, pose: { eyes: 'happy', mouth: 'open', blush: 1.2, arms: { L: { hand: [-12, 100, 34] }, R: { hand: [14, 92, 30] } } } }];
  const A_TIPTOE = [                                                                   // 變化：踮腳伸長脖子左右張望（找人）
    { t: .8, th: -12, pose: { sq: 1.09, eyes: 'wide', mouth: 'o', head: { yaw: -26, pitch: -8 }, look: [-2, -.5], arms: { L: { hand: [-10, 112, 30] }, R: { hand: [10, 112, 30] } } } },
    { t: 1.0, th: -14, pose: { sq: 1.1, eyes: 'wide', mouth: 'o', head: { yaw: -30, pitch: -8 }, look: [-2, -.5], arms: { L: { hand: [-10, 112, 30] }, R: { hand: [10, 112, 30] } } } },
    { t: 1.22, th: 10, pose: { sq: 1.1, eyes: 'wide', mouth: 'o', head: { yaw: 26, pitch: -8 }, look: [2, -.5], arms: { L: { hand: [-10, 112, 30] }, R: { hand: [10, 112, 30] } } } },
    { t: 1.36, th: 12, pose: { sq: 1.1, eyes: 'wide', mouth: 'o', head: { yaw: 30, pitch: -8 }, look: [2, -.5], arms: { L: { hand: [-10, 112, 30] }, R: { hand: [10, 112, 30] } } } }];
  const A_POINT = [                                                                    // 1.3–1.9 指氣泡：抬頭看氣泡 → 看使用者
    { t: 1.5, th: 0, pose: { sq: 1.03, eyes: 'wide', mouth: 'o', head: { pitch: -18 }, look: [.5, -2], arms: POINT_UP } },
    { t: 1.68, th: 0, pose: { sq: 1.03, eyes: 'wide', mouth: 'o', head: { pitch: -20 }, look: [.5, -2], arms: { R: { hand: [33, 54, 6] }, L: { hand: [-10, 122, 30] } } } },
    { t: 1.84, th: 0, pose: { eyes: 'open', mouth: 'open', head: { pitch: 2, roll: 5 }, look: [0, .3], arms: POINT_UP } },
    { t: 1.94, th: 0, pose: { eyes: 'happy', mouth: 'open', head: { pitch: 3, roll: 6 }, arms: { R: { hand: [33, 55, 6] }, L: { hand: [-10, 122, 30] } } } }];
  const A_STEPS = [                                                                    // 1.94–2.4 原地小碎步踩兩下
    { t: 2.05, th: 0, pose: { y: -4, roll: 4, feet: 'stand', eyes: 'happy', mouth: 'open', arms: { L: { hand: [-14, 112, 30] }, R: { hand: [16, 104, 28] } } } },
    { t: 2.14, th: 0, ease: 'in', pose: { sq: .96, feet: 'stand', eyes: 'happy', mouth: 'open', arms: { L: { hand: [-14, 114, 30] }, R: { hand: [14, 112, 30] } } } },
    { t: 2.24, th: 0, ease: 'out', pose: { y: -4, roll: -4, feet: 'stand', eyes: 'happy', mouth: 'open', arms: { L: { hand: [-16, 104, 28] }, R: { hand: [14, 112, 30] } } } },
    { t: 2.33, th: 0, ease: 'in', pose: { sq: .96, feet: 'stand', eyes: 'happy', mouth: 'smile' } },
    { t: 2.4, th: 0, pose: { eyes: 'wide', mouth: 'open' } }];
  const ROUND = 2.4;
  const roundKeys = (mid) => [...A_HOP, ...mid, ...A_POINT, ...A_STEPS];
  // 把幾輪接成一段長的循環動畫（每輪的最後一格和下一輪的第一格相同，接縫不會跳）
  const chain = (rounds) => rounds.flatMap((r, i) => r.filter((k) => i === 0 || k.t > 0).map((k) => ({ ...k, t: +(k.t + i * ROUND).toFixed(3) })));
  const R_BASE = roundKeys(A_WAVE), R_CLAP = roundKeys(A_CLAP), R_TIP = roundKeys(A_TIPTOE);
  const ALERT = {
    round: ROUND,
    ring: { dur: ROUND * 6, loop: true, keys: chain([R_BASE, R_BASE, R_CLAP, R_BASE, R_BASE, R_TIP]) },
    quiet: { dur: 7.2, loop: true, keys: [
      { t: 0, th: 0, pose: { sq: .9, head: { pitch: 6, roll: 5 }, eyes: 'open', mouth: 'flat', look: [0, -.6], earFlop: { L: 8, R: 8 }, arms: { L: { hand: [-9, 128, 30] }, R: { hand: [9, 128, 30] } } } },
      { t: 1.4, th: 0, pose: { sq: .91, head: { pitch: 7, roll: 7 }, eyes: 'open', mouth: 'flat', look: [0, -.6], earFlop: { L: 10, R: 8 }, arms: { L: { hand: [-9, 128, 30] }, R: { hand: [9, 128, 30] } } } },
      { t: 1.5, th: 0, pose: { sq: .91, head: { pitch: 7, roll: 7 }, eyes: 'open', blink: 1, mouth: 'flat', look: [0, -.6], earFlop: { L: 10, R: 8 }, arms: { L: { hand: [-9, 128, 30] }, R: { hand: [9, 128, 30] } } } },
      { t: 1.6, th: 0, pose: { sq: .91, head: { pitch: 7, roll: 7 }, eyes: 'open', mouth: 'flat', look: [0, -.6], earFlop: { L: 10, R: 8 }, arms: { L: { hand: [-9, 128, 30] }, R: { hand: [9, 128, 30] } } } },
      // 嘆一口氣：吸氣挺一下、吐氣垮下來
      { t: 2.5, th: 0, pose: { sq: .95, head: { pitch: 2, roll: 4 }, eyes: 'open', mouth: 'flat', look: [0, -.4], earFlop: { L: 6, R: 6 }, arms: { L: { hand: [-9, 126, 30] }, R: { hand: [9, 126, 30] } } } },
      { t: 3.3, th: 0, pose: { sq: .88, head: { pitch: 12, roll: 2 }, eyes: 'sad', mouth: 'o', look: [0, .8], earFlop: { L: 14, R: 14 }, arms: { L: { hand: [-9, 130, 30] }, R: { hand: [9, 130, 30] } } } },
      { t: 4.0, th: 0, pose: { sq: .9, head: { pitch: 6, roll: -4 }, eyes: 'open', mouth: 'flat', look: [0, -.6], earFlop: { L: 9, R: 9 }, arms: { L: { hand: [-9, 128, 30] }, R: { hand: [9, 128, 30] } } } },
      // 小小揮一下手：「還在這裡喔」
      { t: 4.5, th: 0, pose: { sq: .92, head: { pitch: 2, roll: -6 }, eyes: 'open', mouth: 'smile', look: [0, -.6], earFlop: { L: 4, R: 4 }, arms: { L: { hand: [-9, 128, 30] }, R: { hand: [30, 84, 16] } } } },
      { t: 4.75, th: 0, pose: { sq: .92, head: { pitch: 2, roll: -3 }, eyes: 'open', mouth: 'smile', look: [0, -.6], earFlop: { L: 4, R: 4 }, arms: { L: { hand: [-9, 128, 30] }, R: { hand: [38, 92, 8] } } } },
      { t: 5.0, th: 0, pose: { sq: .92, head: { pitch: 2, roll: -6 }, eyes: 'open', mouth: 'smile', look: [0, -.6], earFlop: { L: 4, R: 4 }, arms: { L: { hand: [-9, 128, 30] }, R: { hand: [30, 84, 16] } } } },
      { t: 5.25, th: 0, pose: { sq: .92, head: { pitch: 2, roll: -3 }, eyes: 'open', mouth: 'smile', look: [0, -.6], earFlop: { L: 4, R: 4 }, arms: { L: { hand: [-9, 128, 30] }, R: { hand: [38, 92, 8] } } } },
      { t: 5.9, th: 0, pose: { sq: .9, head: { pitch: 6, roll: 2 }, eyes: 'open', mouth: 'flat', look: [0, -.6], earFlop: { L: 8, R: 8 }, arms: { L: { hand: [-9, 128, 30] }, R: { hand: [9, 128, 30] } } } },
      { t: 6.0, th: 0, pose: { sq: .9, head: { pitch: 6, roll: 2 }, eyes: 'open', blink: 1, mouth: 'flat', look: [0, -.6], earFlop: { L: 8, R: 8 }, arms: { L: { hand: [-9, 128, 30] }, R: { hand: [9, 128, 30] } } } },
      { t: 6.1, th: 0, pose: { sq: .9, head: { pitch: 6, roll: 3 }, eyes: 'open', mouth: 'flat', look: [0, -.6], earFlop: { L: 8, R: 8 }, arms: { L: { hand: [-9, 128, 30] }, R: { hand: [9, 128, 30] } } } },
      { t: 7.2, th: 0, pose: { sq: .9, head: { pitch: 6, roll: 5 }, eyes: 'open', mouth: 'flat', look: [0, -.6], earFlop: { L: 8, R: 8 }, arms: { L: { hand: [-9, 128, 30] }, R: { hand: [9, 128, 30] } } } }] }
  };

  // ---------------------------------------------------------------------------
  // 待機小動畫庫：和 ANIMS／REACT 同格式。舞台在待機時依個性隨機挑一個播（建議見 IDLE_HINT）。
  // 都從待機的角度（th −10）開始、也回到那裡，所以可以直接接在靜止圖前後。
  // ---------------------------------------------------------------------------
  const CHEST = { L: { hand: [-6, 127, 30] }, R: { hand: [6, 127, 30] } };
  const EAT_ARMS = (dy = 0) => ({ L: { hand: [-5, 96 + dy, 36] }, R: { hand: [5, 96 + dy, 36] } });
  // 上下搓（理毛、抓臉用）：n 次來回
  const rub = (t0, t1, n, mk) => { const out = []; for (let i = 0; i <= n * 2; i++) out.push({ t: +(lerp(t0, t1, i / (n * 2))).toFixed(3), th: mk.th, pose: mk.pose(i % 2) }); return out; };
  const IDLE = {
    // 張望：先看左邊、再看右邊、回正；眼睛先動、頭跟上、身體晚 0.2 秒才小幅跟著轉
    lookAround: { dur: 2.4, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .12, th: -10, pose: { look: [-2, 0] } },
      { t: .45, th: -10, pose: { head: { yaw: -35 }, look: [-2, 0], eyes: 'open', mouth: 'o' } },
      { t: .65, th: -18, pose: { head: { yaw: -35, roll: -3 }, look: [-2, 0], mouth: 'o' } },
      { t: 1.0, th: -18, pose: { head: { yaw: -33, roll: -3 }, look: [-2, 0], mouth: 'o' } },
      { t: 1.1, th: -18, pose: { head: { yaw: -26 }, look: [2, 0] } },
      { t: 1.45, th: -16, pose: { head: { yaw: 30 }, look: [2, 0], mouth: 'o' } },
      { t: 1.65, th: -2, pose: { head: { yaw: 30, roll: 3 }, look: [2, 0], mouth: 'o' } },
      { t: 1.95, th: -2, pose: { head: { yaw: 28, roll: 3 }, look: [2, 0] } },
      { t: 2.2, th: -6, pose: { head: { yaw: 4 }, look: [0, 0] } },
      { t: 2.4, th: -10, pose: {} }] },
    // 抓臉：歪頭閉眼，右手在臉頰旁來回抓 4 次
    scratch: { dur: 1.8, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .25, th: -6, pose: { head: { roll: 10, pitch: 6 }, eyes: 'closed', mouth: 'smile', arms: { R: { hand: [22, 74, 24] } } } },
      ...rub(.35, 1.35, 4, { th: -6, pose: (k) => ({ head: { roll: 10 + (k ? 2 : 0), pitch: 6 }, eyes: 'closed', mouth: 'smile', earFlop: { R: k ? 8 : 2 }, arms: { R: { hand: k ? [20, 64, 26] : [23, 76, 24] } } }) }),
      { t: 1.55, th: -8, pose: { head: { roll: 4 }, eyes: 'happy', mouth: 'smile', arms: { R: { hand: [16, 104, 30] } } } },
      { t: 1.8, th: -10, pose: {} }] },
    // 打哈欠：身體挺起、抬頭閉眼、嘴慢慢張到最大停 0.5 秒 → 收 → 眨兩下眼
    yawn: { dur: 2.2, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .3, th: -10, pose: { sq: 1.01, head: { pitch: -4 }, eyes: 'sleepy', mouth: 'o' } },
      { t: .65, th: -10, pose: { sq: 1.04, head: { pitch: -14, roll: 3 }, eyes: 'closed', mouth: 'open', earFlop: { L: 10, R: 10 }, arms: { L: { hand: [-12, 118, 30] }, R: { hand: [12, 118, 30] } } } },
      { t: 1.15, th: -10, pose: { sq: 1.045, head: { pitch: -16, roll: 4 }, eyes: 'closed', mouth: 'open', earFlop: { L: 12, R: 12 }, arms: { L: { hand: [-12, 118, 30] }, R: { hand: [12, 118, 30] } } } },
      { t: 1.4, th: -10, pose: { sq: .97, head: { pitch: 4 }, eyes: 'closed', mouth: 'chew' } },
      { t: 1.55, th: -10, pose: { sq: .99, head: { pitch: 2 }, eyes: 'sleepy', mouth: 'smile' } },
      { t: 1.66, th: -10, pose: { head: { pitch: 1 }, eyes: 'open', blink: 1 } },
      { t: 1.78, th: -10, pose: { eyes: 'open', blink: 0 } },
      { t: 1.9, th: -10, pose: { eyes: 'open', blink: 1 } },
      { t: 2.02, th: -10, pose: { eyes: 'open', blink: 0 } },
      { t: 2.2, th: -10, pose: {} }] },
    // 伸懶腰：先往前趴（手往前、屁股和尾巴翹）→ 往上伸（抬頭、手往外上、尾巴翹）停 0.4 秒 → 回
    stretch: { dur: 2.4, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .55, th: -42, pose: { sq: .9, lean: 16, head: { pitch: -12 }, eyes: 'closed', mouth: 'flat', tailUp: .5, arms: { L: { hand: [-10, 144, 48] }, R: { hand: [10, 144, 48] } } } },
      { t: .8, th: -42, pose: { sq: .89, lean: 18, head: { pitch: -14 }, eyes: 'closed', mouth: 'flat', tailUp: .6, arms: { L: { hand: [-10, 146, 50] }, R: { hand: [10, 146, 50] } } } },
      { t: 1.35, th: -6, pose: { sq: 1.1, lean: -5, head: { pitch: -16, roll: 6 }, eyes: 'closed', mouth: 'open', tailUp: .9, arms: { L: { hand: [-44, 94, 0] }, R: { hand: [40, 72, 4] } } } },
      { t: 1.75, th: -6, pose: { sq: 1.105, lean: -6, head: { pitch: -18, roll: 8 }, eyes: 'closed', mouth: 'open', tailUp: 1, arms: { L: { hand: [-45, 92, 0] }, R: { hand: [41, 70, 4] } } } },
      { t: 2.1, th: -8, pose: { sq: .97, eyes: 'happy', mouth: 'smile' } },
      { t: 2.4, th: -10, pose: {} }] },
    // 理毛：側身低頭，雙手在胸前上下搓 6 次，結束甩甩頭
    groom: { dur: 2.6, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .3, th: -38, pose: { sq: .96, lean: 6, head: { pitch: 20 }, eyes: 'closed', mouth: 'smile', arms: { L: { hand: [-5, 104, 34] }, R: { hand: [5, 112, 34] } } } },
      ...rub(.4, 1.9, 6, { th: -38, pose: (k) => ({ sq: .96, lean: 6, head: { pitch: k ? 24 : 18, roll: k ? 3 : -3 }, eyes: 'closed', mouth: 'smile', arms: { L: { hand: [-5, k ? 118 : 102, 34] }, R: { hand: [5, k ? 102 : 118, 34] } } }) }),
      { t: 2.05, th: -28, pose: { head: { yaw: -16, roll: -6 }, eyes: 'closed', earFlop: { L: 12, R: -10 } } },
      { t: 2.17, th: -22, pose: { head: { yaw: 16, roll: 6 }, eyes: 'closed', earFlop: { L: -10, R: 12 } } },
      { t: 2.29, th: -16, pose: { head: { yaw: -10, roll: -4 }, eyes: 'closed', earFlop: { L: 8, R: -6 } } },
      { t: 2.42, th: -12, pose: { head: { yaw: 3 }, eyes: 'happy', earFlop: { L: -3, R: 4 } } },
      { t: 2.6, th: -10, pose: { eyes: 'happy' } }] },
    // 吃葉子：捧到嘴邊 → 咬（低頭、葉子被扯一下）→ 咀嚼（身體一鼓一鼓）×3 → 吃完滿足。葉子兩種隨機（每次播放由 st.leaf 決定）
    eat: { dur: 4.2, bites: [.62, 1.62, 2.62], keys: (() => {
      const k = [{ t: 0, th: -10, pose: {} }, { t: .4, th: -10, pose: { head: { pitch: 2 }, eyes: 'open', mouth: 'open', look: [0, 1.5], arms: EAT_ARMS(2) } }];
      [.62, 1.62, 2.62].forEach((b) => {
        k.push({ t: b - .06, th: -10, pose: { head: { pitch: 4 }, eyes: 'open', mouth: 'open', look: [0, 1.5], arms: EAT_ARMS(0) } });
        k.push({ t: b + .04, th: -10, ease: 'in', pose: { head: { pitch: 12 }, sq: .98, eyes: 'closed', mouth: 'chew', arms: EAT_ARMS(-1) } });          // 咬：低頭
        k.push({ t: b + .16, th: -10, ease: 'out', pose: { head: { pitch: 2, roll: 4 }, eyes: 'happy', mouth: 'chew', arms: EAT_ARMS(5) } });             // 扯：頭抬起、手往下拉
        for (let i = 0; i < 4; i++) k.push({ t: +(b + .3 + i * .16).toFixed(2), th: -10, pose: { sq: i % 2 ? .98 : 1.02, head: { pitch: 5, roll: i % 2 ? 2 : -2 }, eyes: 'happy', mouth: i % 2 ? 'smile' : 'chew', arms: EAT_ARMS(4) } });
      });
      k.push({ t: 3.7, th: -10, pose: { sq: 1.02, head: { pitch: -4, roll: 5 }, eyes: 'happy', mouth: 'smile', blush: 1.4, arms: { L: { hand: [-8, 122, 32] }, R: { hand: [8, 122, 32] } } } });
      k.push({ t: 4.2, th: -10, pose: { eyes: 'happy', blush: 1.2 } });
      return k;
    })(),
      props(t, st) {
        const kind = st ? (st.leaf || (st.leaf = Math.random() < .5 ? 'big' : 'twig')) : 'twig';
        if (t < .25 || t > 3.45) return [];
        const bites = IDLE.eat.bites.filter((b) => t > b + .04).length;                      // 咬過幾口：葉子越來越小
        const near = IDLE.eat.bites.find((b) => t > b + .04 && t < b + .2);                  // 剛咬下去：葉子被扯一下
        const tug = near ? Math.sin(Math.PI * (t - near - .04) / .16) : 0, s = (kind === 'big' ? 1 : 1) * (1 - bites * .24);
        return [{ t: 'leaf', ...(kind === 'big' ? { kind: 'big' } : {}), hand: 'both', off: [2, -4 + 2 * tug], rot: 80 + 14 * tug, s: Math.max(.3, s) }];
      },
      endLine: '好吃～' },
    // 打盹點頭（循環）：頭慢慢往下掉 → 猛然抬起、睜眼 0.3 秒 → 又閉上
    napNod: { dur: 2.6, loop: true, keys: [
      { t: 0, th: -10, pose: { sq: .92, head: { pitch: 8 }, eyes: 'closed', mouth: 'smile', earFlop: { L: 6, R: 6 } } },
      { t: 1.6, th: -10, ease: 'in', pose: { sq: .9, head: { pitch: 22, roll: 5 }, eyes: 'closed', mouth: 'smile', earFlop: { L: 10, R: 10 } } },
      { t: 1.75, th: -10, ease: 'out', pose: { sq: .96, head: { pitch: 4, roll: 0 }, eyes: 'wide', mouth: 'o', earFlop: { L: -8, R: -8 } } },
      { t: 2.05, th: -10, pose: { sq: .95, head: { pitch: 4 }, eyes: 'sleepy', mouth: 'flat', earFlop: { L: 0, R: 0 } } },
      { t: 2.3, th: -10, pose: { sq: .93, head: { pitch: 6 }, eyes: 'closed', mouth: 'smile', earFlop: { L: 4, R: 4 } } },
      { t: 2.6, th: -10, pose: { sq: .92, head: { pitch: 8 }, eyes: 'closed', mouth: 'smile', earFlop: { L: 6, R: 6 } } }],
      props: (t) => (t % 2.6 < 1.6 ? [{ t: 'fx', kind: 'zzz', at: [112, 12 - (t % 2.6) * 4], s: 1 + (t % 2.6) * .15 }] : []) },
    // 被摸（循環）：頭左右蹭、瞇眼、身體縮一點、耳朵往後壓、尾巴小擺
    petted: { dur: 1.6, loop: true, keys: [
      { t: 0, th: -5, pose: { sq: .94, head: { pitch: 8, roll: 9 }, eyes: 'happy', mouth: 'smile', blush: 1.5, earFlop: { L: 14, R: 10 }, tailUp: .1 } },
      { t: .4, th: -5, pose: { sq: .95, head: { pitch: 9, roll: 0 }, eyes: 'happy', mouth: 'smile', blush: 1.5, earFlop: { L: 12, R: 12 }, tailUp: .3 } },
      { t: .8, th: -5, pose: { sq: .94, head: { pitch: 8, roll: -9 }, eyes: 'happy', mouth: 'open', blush: 1.5, earFlop: { L: 10, R: 14 }, tailUp: .1 } },
      { t: 1.2, th: -5, pose: { sq: .95, head: { pitch: 9, roll: 0 }, eyes: 'happy', mouth: 'smile', blush: 1.5, earFlop: { L: 12, R: 12 }, tailUp: .3 } },
      { t: 1.6, th: -5, pose: { sq: .94, head: { pitch: 8, roll: 9 }, eyes: 'happy', mouth: 'smile', blush: 1.5, earFlop: { L: 14, R: 10 }, tailUp: .1 } }],
      props: (t) => (t % 1.6 < .9 ? [{ t: 'fx', kind: 'heart', at: [128, 22 - (t % 1.6) * 6], s: 1.2 }] : []) },
    // 開心小碎步：左右腳輪流踩四下，身體跟著左右晃、手小幅擺
    happySteps: { dur: 1.2, keys: (() => {
      const k = [{ t: 0, th: -10, pose: {} }, { t: .1, th: -6, pose: { sq: .95, eyes: 'happy', mouth: 'open' } }];
      for (let i = 0; i < 4; i++) {
        const s = i % 2 ? -1 : 1, t0 = .1 + i * .24;
        k.push({ t: +(t0 + .1).toFixed(2), th: -6, ease: 'out', pose: { y: -6, roll: 5 * s, sq: 1.03, feet: 'stand', eyes: 'happy', mouth: 'open', blush: 1.3, tailUp: .4, arms: { L: { hand: [-14, s > 0 ? 108 : 120, 30] }, R: { hand: [14, s > 0 ? 120 : 108, 30] } } } });
        k.push({ t: +(t0 + .24).toFixed(2), th: -6, ease: 'in', pose: { sq: .95, feet: 'stand', eyes: 'happy', mouth: 'open', blush: 1.3, arms: { L: { hand: [-12, 116, 30] }, R: { hand: [12, 116, 30] } } } });
      }
      k.push({ t: 1.2, th: -10, pose: { eyes: 'happy', blush: 1.2 } });
      return k;
    })() },
    // 失落：低頭、耳朵下垂、深吸一口氣再嘆出來，慢慢回神
    sad: { dur: 2.8, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .6, th: -10, pose: { sq: .95, head: { pitch: 16 }, eyes: 'sad', mouth: 'flat', look: [0, 1.5], earFlop: { L: 14, R: 14 }, blush: .5, arms: { L: { hand: [-9, 132, 28] }, R: { hand: [9, 132, 28] } } } },
      { t: 1.2, th: -10, pose: { sq: 1.0, head: { pitch: 10 }, eyes: 'sad', mouth: 'flat', look: [0, 1.5], earFlop: { L: 12, R: 12 }, blush: .5, arms: { L: { hand: [-9, 130, 28] }, R: { hand: [9, 130, 28] } } } },
      { t: 1.9, th: -10, pose: { sq: .91, head: { pitch: 22, roll: -4 }, eyes: 'closed', mouth: 'o', earFlop: { L: 18, R: 18 }, blush: .5, arms: { L: { hand: [-9, 136, 28] }, R: { hand: [9, 136, 28] } } } },
      { t: 2.3, th: -10, pose: { sq: .93, head: { pitch: 18, roll: -4 }, eyes: 'sad', mouth: 'flat', look: [0, 1], earFlop: { L: 16, R: 16 }, blush: .6, arms: { L: { hand: [-9, 134, 28] }, R: { hand: [9, 134, 28] } } } },
      { t: 2.8, th: -10, pose: { head: { pitch: 6 }, mouth: 'flat', earFlop: { L: 6, R: 6 } } }] },
    // 嚇一跳：瞬間彈起、耳朵豎直、手張開 → 落地縮一下 → 回神
    startle: { dur: .8, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .05, th: -10, pose: { sq: .93, eyes: 'wide', mouth: 'o' } },
      { t: .16, th: -8, ease: 'out', pose: { y: -14, sq: 1.1, eyes: 'wide', mouth: 'o', tailUp: 1, earFlop: { L: -12, R: -12 }, arms: { L: { hand: [-34, 96, 10] }, R: { hand: [34, 96, 10] } } } },
      { t: .22, th: -8, pose: { y: -14, sq: 1.08, eyes: 'wide', mouth: 'o', tailUp: 1, earFlop: { L: -12, R: -12 }, arms: { L: { hand: [-34, 94, 10] }, R: { hand: [34, 94, 10] } } } },
      { t: .36, th: -8, ease: 'in', pose: { sq: .86, eyes: 'wide', mouth: 'o', arms: { L: { hand: [-18, 108, 26] }, R: { hand: [18, 108, 26] } } } },
      { t: .5, th: -8, ease: 'out', pose: { sq: 1.02, eyes: 'wide', mouth: 'flat', arms: { L: { hand: [-8, 110, 30] }, R: { hand: [8, 110, 30] } } } },
      { t: .8, th: -10, pose: { eyes: 'open', mouth: 'flat' } }] },
    // 好奇歪頭：頭先歪一邊、停一下、再多歪一點（單耳垂下來）
    tiltHead: { dur: 1.4, keys: [
      { t: 0, th: -10, pose: {} },
      { t: .3, th: -8, ease: 'back', pose: { head: { roll: 15, yaw: -5, pitch: -2 }, eyes: 'open', mouth: 'o', earFlop: { R: 10 } } },
      { t: .6, th: -8, pose: { head: { roll: 14, yaw: -5, pitch: -2 }, eyes: 'open', blink: 1, mouth: 'o', earFlop: { R: 8 } } },
      { t: .7, th: -8, pose: { head: { roll: 14, yaw: -5, pitch: -2 }, eyes: 'open', mouth: 'o', earFlop: { R: 8 } } },
      { t: .9, th: -8, ease: 'back', pose: { head: { roll: 20, yaw: -6, pitch: -3 }, eyes: 'wide', mouth: 'o', earFlop: { R: 13 } } },
      { t: 1.15, th: -8, pose: { head: { roll: 19, yaw: -6, pitch: -3 }, eyes: 'wide', mouth: 'smile', earFlop: { R: 12 } } },
      { t: 1.4, th: -10, pose: {} }] },
    // 站起來張望：後腿伸直站高、抬頭，鼻子抽動聞一聞（頭小幅快速點動），看左看右
    standLook: { dur: 2.0, keys: (() => {
      const k = [{ t: 0, th: -10, pose: {} }, { t: .12, th: -10, pose: { sq: .95 } },
        { t: .4, th: -14, ease: 'out', pose: { sq: 1.1, head: { pitch: -10, yaw: -10 }, eyes: 'wide', mouth: 'flat', look: [-1.5, -1], tailUp: .3, earFlop: { L: -6, R: -6 }, arms: { L: { hand: [-10, 114, 32] }, R: { hand: [10, 114, 32] } } } }];
      // 鼻子抽動：0.1 秒一下的小點頭（pose 沒有獨立的鼻子可動，用頭與嘴型做）
      for (let i = 0; i < 12; i++) {
        const t = .5 + i * .1, side = i < 6 ? -1 : 1;
        k.push({ t: +t.toFixed(2), th: side < 0 ? -16 : -4, ease: 'lin', pose: { sq: 1.1, head: { pitch: -10 + (i % 2 ? 2.4 : 0), yaw: 14 * side }, eyes: 'wide', mouth: i % 2 ? 'o' : 'flat', look: [1.5 * side, -1], tailUp: .3, earFlop: { L: -6, R: -6 }, arms: { L: { hand: [-10, 114, 32] }, R: { hand: [10, 114, 32] } } } });
      }
      k.push({ t: 1.8, th: -10, pose: { sq: .97, eyes: 'open', mouth: 'smile' } }, { t: 2.0, th: -10, pose: {} });
      return k;
    })(),
      props: (t) => (t > .5 && t < 1.7 && Math.floor(t * 5) % 2 === 0 ? [{ t: 'fx', kind: t < 1.1 ? 'sniff' : 'sniffR', at: t < 1.1 ? [44, 44] : [116, 44], s: .8 }] : []) }
  };
  // 待機時怎麼挑（給舞台參考）：每種小動畫的相對機率（乘上個性）；asleep＝睡著時才用、awake＝醒著才用
  const IDLE_HINT = {
    lookAround: { w: 3, by: 'curiosity' }, tiltHead: { w: 2, by: 'curiosity' }, standLook: { w: 1.5, by: 'boldness' },
    scratch: { w: 2 }, groom: { w: 1.5 }, yawn: { w: 1.5, by: 'lazy' }, stretch: { w: 1, by: 'lazy' }, eat: { w: .6, by: 'lazy' },
    happySteps: { w: 1, by: 'activity' }, napNod: { w: 0, loop: true, when: '快睡著時' }, petted: { w: 0, loop: true, when: '長按撫摸' },
    sad: { w: 0, when: '被冷落、任務過期' }, startle: { w: 0, when: '游標突然衝過來、被吵醒' }
  };

  // 依個性調整幅度與速度：活潑的（activity 高）動作大又快，慵懶的小而慢。
  // personality＝traits.personality（activity 0–1）；也可以直接傳數字。回傳新的動畫物件（同一組參數有快取）
  const scaleCache = new WeakMap();
  function scaleByPersonality(anim, personality) {
    const act = clamp(typeof personality === 'number' ? personality : (personality && personality.activity != null ? personality.activity : .5), 0, 1);
    const amp = +lerp(.72, 1.28, act).toFixed(2), speed = +lerp(.82, 1.18, act).toFixed(2);
    let m = scaleCache.get(anim); if (!m) scaleCache.set(anim, (m = {}));
    const key = amp + '/' + speed; if (m[key]) return m[key];
    const sc = (p) => {
      const q = { ...p };
      if (p.y) q.y = p.y * amp;
      if (p.sq != null) q.sq = 1 + (p.sq - 1) * amp;
      if (p.lean) q.lean = p.lean * amp;
      if (p.roll) q.roll = p.roll * amp;
      if (p.tailUp) q.tailUp = clamp(p.tailUp * amp, 0, 1);
      if (p.head) q.head = { ...p.head, ...(p.head.yaw ? { yaw: p.head.yaw * amp } : {}), ...(p.head.pitch ? { pitch: p.head.pitch * amp } : {}), ...(p.head.roll ? { roll: p.head.roll * amp } : {}) };
      if (p.earFlop) q.earFlop = { L: (p.earFlop.L || 0) * amp, R: (p.earFlop.R || 0) * amp };
      return q;
    };
    const out = { ...anim, dur: anim.dur / speed, keys: anim.keys.map((k) => ({ ...k, t: k.t / speed, pose: sc(k.pose) })) };
    delete out._hands; delete out._hasY; delete out._hasTail;
    if (anim.events) out.events = anim.events.map((e) => ({ ...e, t: e.t / speed }));
    if (anim.props) out.props = (t, st) => anim.props(t * speed, st);
    return (m[key] = out);
  }

  // ---------------------------------------------------------------------------
  // 常駐層：疊在任何姿勢上的小變化（呼吸、眨眼、視線、耳朵抖）。
  // ambient(t, seed, opts) → { sq, blink, look:[dx,dy], head:{yaw,pitch}, earFlop:{L,R}, busy }
  //   t     秒（這一隻自己的時鐘）；seed 每隻不同（同一個 seed、同一個 t 結果一定相同，不需要保存狀態）
  //   opts  asleep:true 睡覺（呼吸更慢更深、不眨眼、不張望）
  //         lookAt:[dx,dy] 滑鼠相對於頭的位置（畫面像素或姿勢單位都可以，往右、往下為正）；有值時視線與頭小幅跟著滑鼠，沒有才隨機張望
  //         still:true 只要呼吸（播動畫時疊上去用）
  //   busy  這一刻有沒有「需要重畫」的變化（眨眼中、耳朵抖動中、視線移動中）；false 時只有呼吸，舞台可以不重畫、用 CSS 做呼吸
  // 事件排程不存狀態：把時間切成固定長度的格子，每格裡事件的位置由 seed 決定
  //   眨眼：每 3–6 秒一次、0.12 秒；15% 連眨兩下          視線：每 4–8 秒換方向、0.25 秒移過去，頭晚 0.15 秒小幅跟上
  //   耳朵抖：每 8–15 秒單耳 0→14°→−6°→0，共 0.25 秒
  // ---------------------------------------------------------------------------
  const hash = (seed, a, b) => {
    let h = (Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(a + 1, 0xc2b2ae35) ^ Math.imul(b + 7, 0x27d4eb2f)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };
  const AMB = { breath: 3.2, breathAmp: .012, sleepBreath: 5.4, sleepAmp: .024, blinkCell: 4.5, blinkJit: 1.5, blinkDur: .12, blinkGap: .24, dbl: .15,
    gazeCell: 6, gazeJit: 2, gazeMove: .25, headLag: .15, earCell: 11.5, earJit: 3.5, earDur: .25 };
  const cellTime = (seed, ch, k, cell, jit) => k * cell + jit * hash(seed, ch, k);            // 第 k 格裡事件發生的時間
  const tri = (u) => (u <= 0 || u >= 1 ? 0 : u < .4 ? u / .4 : (1 - u) / .6);                  // 眨眼：閉得快、睜得慢一點
  const earShape = (u) => (u <= 0 || u >= 1 ? 0 : u < .3 ? 14 * EASE.out(u / .3) : u < .68 ? lerp(14, -6, EASE.io((u - .3) / .38)) : lerp(-6, 0, EASE.io((u - .68) / .32)));
  const gazeTarget = (seed, k) => (k < 0 || hash(seed, 5, k) < .3 ? [0, 0] : [(hash(seed, 6, k) - .5) * 3.4, (hash(seed, 7, k) - .5) * 1.4]);
  // 時間 t 的視線（隨機張望）：從上一個目標移到目前的目標
  function gazeAt(seed, t) {
    let k = Math.floor(t / AMB.gazeCell);
    if (cellTime(seed, 4, k, AMB.gazeCell, AMB.gazeJit) > t) k--;
    const t0 = cellTime(seed, 4, k, AMB.gazeCell, AMB.gazeJit), e = EASE.io(clamp((t - t0) / AMB.gazeMove, 0, 1));
    return { at: mix(gazeTarget(seed, k - 1), gazeTarget(seed, k), k < 0 ? 1 : e), moving: k >= 0 && t - t0 < AMB.gazeMove };
  }
  function ambient(t, seed = 0, opts = {}) {
    t = Math.max(0, +t || 0);
    const asleep = !!opts.asleep, per = asleep ? AMB.sleepBreath : AMB.breath, amp = asleep ? AMB.sleepAmp : AMB.breathAmp;
    const out = { sq: 1 + amp * Math.sin(2 * Math.PI * (t / per + hash(seed, 0, 0))), blink: 0, look: [0, 0], head: { yaw: 0, pitch: 0 }, earFlop: { L: 0, R: 0 }, busy: false };
    if (opts.still) return out;
    // 眨眼（睡著不眨）
    if (!asleep) {
      const k = Math.floor(t / AMB.blinkCell);
      for (const j of [k - 1, k]) {
        if (j < 0) continue;
        const d = t - cellTime(seed, 1, j, AMB.blinkCell, AMB.blinkJit);
        let b = tri(d / AMB.blinkDur);
        if (hash(seed, 2, j) < AMB.dbl) b = Math.max(b, tri((d - AMB.blinkGap) / AMB.blinkDur));
        out.blink = Math.max(out.blink, b);
      }
    }
    // 視線：有滑鼠就跟滑鼠，否則隨機張望；頭小幅跟上
    if (opts.lookAt && !asleep) {
      const dx = +opts.lookAt[0] || 0, dy = +opts.lookAt[1] || 0, d = Math.hypot(dx, dy), n = d > 1e-6 ? Math.min(1, d / 160) / d : 0;
      out.look = [clamp(dx * n * 2.2, -2.2, 2.2), clamp(dy * n * 1.6, -1.6, 1.6)];
      out.head = { yaw: out.look[0] * 6, pitch: out.look[1] * 5 };
    } else if (!asleep) {
      const g = gazeAt(seed, t), gh = gazeAt(seed, Math.max(0, t - AMB.headLag));
      out.look = g.at; out.head = { yaw: gh.at[0] * 4.5, pitch: gh.at[1] * 3 };
      if (g.moving || gh.moving) out.busy = true;
    }
    // 耳朵抖（睡著也會，少一半）
    {
      const k = Math.floor(t / AMB.earCell);
      for (const j of [k - 1, k]) {
        if (j < 0 || (asleep && hash(seed, 9, j) < .5)) continue;
        const v = earShape((t - cellTime(seed, 3, j, AMB.earCell, AMB.earJit)) / AMB.earDur);
        if (v) out.earFlop[hash(seed, 8, j) < .5 ? 'L' : 'R'] = v;
      }
    }
    if (out.blink > 0 || out.earFlop.L || out.earFlop.R) out.busy = true;
    return out;
  }
  // 下一個需要重畫的常駐事件（眨眼／耳朵抖／視線移動）：{ t, kind, dur }。舞台可以睡到那個時間再畫，中間只用 CSS 呼吸
  function ambientNext(t, seed = 0, opts = {}) {
    const cands = [];
    const scan = (ch, cell, jit, kind, dur, skip) => {
      for (let k = Math.max(0, Math.floor(t / cell) - 1); k < Math.floor(t / cell) + 3; k++) {
        const tt = cellTime(seed, ch, k, cell, jit);
        if (tt > t && !(skip && skip(k))) { cands.push({ t: tt, kind, dur: typeof dur === 'function' ? dur(k) : dur }); break; }
      }
    };
    if (!opts.asleep) scan(1, AMB.blinkCell, AMB.blinkJit, 'blink', (k) => (hash(seed, 2, k) < AMB.dbl ? AMB.blinkGap + AMB.blinkDur : AMB.blinkDur));
    if (!opts.asleep && !opts.lookAt) scan(4, AMB.gazeCell, AMB.gazeJit, 'look', AMB.gazeMove + AMB.headLag);
    scan(3, AMB.earCell, AMB.earJit, 'ear', AMB.earDur, (k) => opts.asleep && hash(seed, 9, k) < .5);
    return cands.sort((a, b) => a.t - b.t)[0] || null;
  }
  // 把常駐層疊到姿勢上（回傳新的姿勢，不改原本的）。
  // 姿勢自己有指定視線（look 不是 0）時以姿勢為準——演戲的時候眼睛不亂飄；閉眼的眼型本來就不受 blink 影響
  function applyAmbient(pose, amb) {
    const p = { ...(pose || {}) };
    if (!amb) return p;
    p.sq = (p.sq == null ? 1 : p.sq) * amb.sq;
    p.blink = Math.max(p.blink || 0, amb.blink || 0);
    const own = p.look && (Math.abs(p.look[0]) > .05 || Math.abs(p.look[1]) > .05);
    if (!own) {
      p.look = [amb.look[0], amb.look[1]];
      const h = p.head || {};
      p.head = { ...h, yaw: (h.yaw || 0) + amb.head.yaw, pitch: (h.pitch || 0) + amb.head.pitch };
    }
    const f = p.earFlop || {};
    p.earFlop = { L: (f.L || 0) + amb.earFlop.L, R: (f.R || 0) + amb.earFlop.R };
    return p;
  }

  // 靜止圖（快取成點陣圖，不重畫）：待機、睡覺、看左看右、響鈴、拎起來、撿球
  const STILL = {
    sleep: { sq: .92, head: { pitch: 14, roll: 4 }, eyes: 'closed', mouth: 'smile', arms: { L: { hand: [-8, 130, 30] }, R: { hand: [8, 130, 30] } } },
    ring: { eyes: 'wide', mouth: 'open', blush: 1.2, arms: { R: { hand: [32, 70, 12] } } },
    lift: { feet: 'air', eyes: 'wide', mouth: 'o', arms: { L: { hand: [-26, 92, 20] }, R: { hand: [26, 92, 20] } } },
    shy: { head: { pitch: 8, roll: -6 }, eyes: 'happy', mouth: 'smile', blush: 1.5 }
  };

  const api = { sample, sampleRaw, mix, EASE, ANIMS, FETCH, FETCH2, GAIT, mirrorFrame, REACT, STILL, ALERT, IDLE, IDLE_HINT, HOOP,
    ambient, ambientNext, applyAmbient, scaleByPersonality, arc };
  if (typeof window !== 'undefined') window.QuokkaAnim = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
