// 短尾矮袋鼠「庫卡」的造型資料（純 inline SVG，無任何外部圖檔／字型）。
//
// 造型依據：使用者提供的照片（站姿、頭身一體、前爪合在胸前），比例由照片量測換算：
//   照片 y112–1055 → SVG y14–173（比例 0.1686），中心 x372 → 80。
//   眼睛約在全高 17%、鼻寬約頭寬 22%、爪子在 70–80% 高度、細尾巴自身後下垂。
// 外觀依據公開資料：灰褐粗毛、腹部較淺、頭頸偏暖褐；耳朵短而圓；鼻子無毛、黑色；尾巴短而細。
//
// 圖層與動畫類別（由 pet.css 依 #pet 的 data-pose 切換）：
//   .pet-body（身體群組）、.ear-l/.ear-r（抖耳）、.face（臉部五官）、.eye（眨眼）、
//   .eyes-open/.eyes-closed、.mouth/.mouth-open/.mouth-chew、.band（頭帶，顏色用 CSS 變數 --band）、
//   .arm-rest-l/.arm-rest-r（平時合在胸前的前肢）、.arms-eat/.leaf（捧葉子吃）、
//   .arms-bump（排球）、.arm-r/.racket（右手：羽球、籃球；肩軸 108,98）、.hoop、.ball-vb/.ball-bb/.shuttle（.bx/.by/.spin）、
//   .think-dots、.zzz、.sparkles、.flash。
//
// 資料結構保留「角色表」的形式（CHARACTERS / ORDER / DEFAULT_ID）。
// 此檔同時供 renderer（window.CHARACTERS）與主行程（module.exports）使用。

(function () {
  // ---------------------------------------------------------------------------
  // 輪廓：右半邊量測點（左半邊鏡射），以 Catmull-Rom 轉成平滑貝茲曲線
  // ---------------------------------------------------------------------------
  const RIGHT = [[80, 15], [95, 15.5], [104, 18.5], [109, 25], [110.6, 32], [112.2, 45.7], [114.4, 58],
    [115, 66], [115.4, 74], [116.2, 84], [117.2, 96], [118.8, 123], [118.8, 150], [116.7, 163.5],
    [108.5, 171], [95, 173.2]];
  function closedCR(pts) {
    const n = pts.length, f = (v) => v.toFixed(1);
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)}` +
        ` ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
    }
    return d + ' Z';
  }
  const SIL = closedCR([...RIGHT, [80, 173.6], ...RIGHT.slice(1).reverse().map(([x, y]) => [160 - x, y])]);

  // 毛流短線（固定亂數種子，每次產生的圖一樣）
  function furStrokes(n) {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let out = '';
    for (let i = 0; i < n; i++) {
      const x = 40 + rnd() * 80, y = 16 + rnd() * 158, len = 1.8 + rnd() * 2.4;
      const a = (90 + (x - 80) * 1.1 + (rnd() - 0.5) * 36) * Math.PI / 180, light = rnd() < 0.55;
      out += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + Math.cos(a) * len).toFixed(1)}"` +
        ` y2="${(y + Math.sin(a) * len).toFixed(1)}" stroke="${light ? '#e6ddd0' : '#4f4439'}"` +
        ` stroke-opacity="${light ? 0.24 : 0.2}" stroke-width="${(0.45 + rnd() * 0.35).toFixed(2)}" stroke-linecap="round"/>`;
    }
    return out;
  }

  const EYE = 3;
  const eye = (x, y) => `
      <g class="eye">
        <ellipse cx="${x}" cy="${y}" rx="${EYE + 1}" ry="${EYE * 0.9 + 0.9}" fill="#3e3127" opacity=".5" filter="url(#qkB1)"/>
        <ellipse cx="${x}" cy="${y}" rx="${EYE}" ry="${EYE * 0.86}" fill="#0f1013"/>
        <path d="M${x - EYE * 0.6} ${y - EYE * 0.1} Q${x} ${y - EYE * 0.8} ${x + EYE * 0.6} ${y - EYE * 0.15}" fill="none" stroke="#8fbbe8" stroke-width="${EYE * 0.35}" stroke-linecap="round"/>
        <circle cx="${x + EYE * 0.3}" cy="${y - EYE * 0.35}" r="${EYE * 0.22}" fill="#fff"/>
      </g>`;

  const PAW = '#4a3b30', ARM = '#7a6857';

  const quokkaSvg = `<svg viewBox="0 0 160 180" class="char-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <filter id="qkFur" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4"/>
      <feDisplacementMap in="SourceGraphic" scale="3.4" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="qkB3"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="qkB1"><feGaussianBlur stdDeviation="1.2"/></filter>
    <linearGradient id="qkBodyG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8e7f6d"/><stop offset=".33" stop-color="#9c8a74"/>
      <stop offset=".55" stop-color="#9a9084"/><stop offset="1" stop-color="#aaa39b"/>
    </linearGradient>
    <radialGradient id="qkNose" cx="40%" cy="28%" r="75%">
      <stop offset="0" stop-color="#6f7580"/><stop offset=".35" stop-color="#2e3138"/><stop offset="1" stop-color="#121316"/>
    </radialGradient>
    <radialGradient id="qkVB" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#eceae3"/><stop offset="1" stop-color="#bdb9ae"/></radialGradient>
    <radialGradient id="qkBB" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#f6a35a"/><stop offset=".65" stop-color="#e27a2c"/><stop offset="1" stop-color="#a94e16"/></radialGradient>
    <linearGradient id="qkLeaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8cc06b"/><stop offset="1" stop-color="#4d8a3a"/></linearGradient>
    <clipPath id="qkClip"><path d="${SIL}"/></clipPath>
  </defs>

  <!-- 籃框（只在籃球時出現） -->
  <g class="hoop">
    <line x1="190" y1="58" x2="190" y2="174" stroke="#8a8f98" stroke-width="3" stroke-linecap="round"/>
    <rect x="186" y="24" width="5" height="40" rx="1.5" fill="#fbfbf8" stroke="#9aa0a8" stroke-width="1.2"/>
    <path d="M162 51 L165 68 M168 53 L169.5 69 M176 53 L174.5 69 M182 51 L179 68 M164.5 60 H179.5" stroke="#cfd2d6" stroke-width="1" fill="none"/>
    <ellipse cx="172" cy="50.5" rx="11" ry="3.2" fill="none" stroke="#d9572a" stroke-width="2.4"/>
  </g>

  <g class="pet-body">
    <!-- 細尾巴，從身後垂下 -->
    <path d="M63 166 Q62 175 64 182 Q67 183 67.5 180 Q67.5 173 68.5 166 Z" fill="#4e4238" filter="url(#qkFur)"/>
    <!-- 短圓耳 -->
    <g class="ear ear-l" filter="url(#qkFur)">
      <ellipse cx="56.2" cy="22" rx="7" ry="8" fill="#9a8770"/><ellipse cx="56.5" cy="23" rx="4.6" ry="5.6" fill="#cdb48f"/>
      <ellipse cx="57" cy="24.2" rx="2.6" ry="3.4" fill="#8a7460"/>
    </g>
    <g class="ear ear-r" filter="url(#qkFur)">
      <ellipse cx="103.8" cy="22" rx="7" ry="8" fill="#9a8770"/><ellipse cx="103.5" cy="23" rx="4.6" ry="5.6" fill="#cdb48f"/>
      <ellipse cx="103" cy="24.2" rx="2.6" ry="3.4" fill="#8a7460"/>
    </g>
    <!-- 頭身一體的毛皮：輪廓＋明暗＋毛流 -->
    <path d="${SIL}" fill="url(#qkBodyG)" filter="url(#qkFur)"/>
    <g clip-path="url(#qkClip)">
      <ellipse cx="80" cy="19" rx="28" ry="9" fill="#7a6c5c" opacity=".5" filter="url(#qkB3)"/>
      <ellipse cx="44" cy="60" rx="7" ry="22" fill="#6f6152" opacity=".45" filter="url(#qkB3)"/>
      <ellipse cx="116" cy="60" rx="7" ry="22" fill="#6f6152" opacity=".45" filter="url(#qkB3)"/>
      <ellipse cx="80" cy="62" rx="30" ry="15" fill="#b8936a" opacity=".8" filter="url(#qkB3)"/>
      <ellipse cx="80" cy="68" rx="13" ry="6" fill="#d9c6aa" opacity=".85" filter="url(#qkB3)"/>
      <ellipse cx="80" cy="80" rx="32" ry="6" fill="#6a5c4e" opacity=".35" filter="url(#qkB3)"/>
      <ellipse cx="80" cy="108" rx="14" ry="12" fill="#cfc2b0" opacity=".55" filter="url(#qkB3)"/>
      <ellipse cx="80" cy="152" rx="30" ry="26" fill="#cbc5bd" opacity=".85" filter="url(#qkB3)"/>
      <ellipse cx="40" cy="140" rx="7" ry="30" fill="#7d7268" opacity=".4" filter="url(#qkB3)"/>
      <ellipse cx="120" cy="140" rx="7" ry="30" fill="#7d7268" opacity=".4" filter="url(#qkB3)"/>
      ${furStrokes(1100)}
    </g>
    <!-- 運動頭帶（顏色由 CSS 變數 --band 決定，多隻時可各自不同） -->
    <g class="band">
      <path d="M49.5 34 Q80 25 110.5 34 L110 28 Q80 19 50 28 Z" style="fill: var(--band, #e5533d)"/>
      <path d="M49.5 34 Q80 25 110.5 34" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="1.2"/>
    </g>

    <g class="face">
      <g class="eyes-open">${eye(67, 42.4)}${eye(93, 42.4)}</g>
      <g class="eyes-closed">
        <path d="M63.5 43 Q67 45.6 70.5 43 M89.5 43 Q93 45.6 96.5 43" fill="none" stroke="#2a211b" stroke-width="1.4" stroke-linecap="round"/>
      </g>
      <!-- 黑色大鼻子 -->
      <ellipse cx="80" cy="54.5" rx="9" ry="7.5" fill="#3b2f26" opacity=".45" filter="url(#qkB1)"/>
      <path d="M72.6 51.2 C72.4 46.4 87.6 46.4 87.4 51.2 C87.4 56.2 83.8 59 80.9 59.6 L80 60 L79.1 59.6 C76.2 59 72.6 56.2 72.6 51.2 Z" fill="url(#qkNose)"/>
      <ellipse cx="76.6" cy="49.6" rx="3" ry="1.4" fill="#c9d6e6" opacity=".45"/>
      <path d="M75.2 55.6 Q76.6 54.4 78 55.8 M82 55.8 Q83.4 54.4 84.8 55.6" fill="none" stroke="#000" stroke-width=".8" opacity=".65"/>
      <!-- 招牌微笑 -->
      <g class="mouth">
        <path d="M80 60 V62.5" stroke="#2a211b" stroke-width="1.3" stroke-linecap="round"/>
        <path d="M70.5 59 Q74 65.5 77.6 64.6 Q79.2 64 80 62.5 Q80.8 64 82.4 64.6 Q86 65.5 89.5 59" fill="none" stroke="#2a211b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M73 64.5 Q80 70 87 64.5" fill="none" stroke="#7a6350" stroke-width="2" opacity=".35" filter="url(#qkB1)"/>
      </g>
      <!-- 開口大笑（開心、運動、自拍） -->
      <g class="mouth-open">
        <path d="M80 60 V62" stroke="#2a211b" stroke-width="1.3" stroke-linecap="round"/>
        <path d="M70 59.5 Q72 61.5 76 62.5 Q80 63 84 62.5 Q88 61.5 90 59.5 Q88 69 80 69.5 Q72 69 70 59.5 Z" fill="#4a2622" stroke="#2a211b" stroke-width="1.2" stroke-linejoin="round"/>
        <path d="M75 66.5 Q80 64 85 66.5 Q83 69 80 69 Q77 69 75 66.5 Z" fill="#e58a8a"/>
      </g>
      <!-- 嚼葉子 -->
      <g class="mouth-chew">
        <path d="M80 60 V62" stroke="#2a211b" stroke-width="1.3" stroke-linecap="round"/>
        <ellipse class="chew" cx="80" cy="64.3" rx="3.4" ry="2.2" fill="#4a2622" stroke="#2a211b" stroke-width="1"/>
      </g>
    </g>

    <!-- 平時：短前肢合在胸前、爪子下垂 -->
    <g class="arm-rest-l">
      <path d="M59 98 C61 112 66 122 71 129 L77 127 C75 117 74 106 72 97 Z" fill="${ARM}" opacity=".75" filter="url(#qkB1)"/>
      <path d="M70 126 C68.5 134 71.5 143.5 76 144.4 C79.5 144.8 80.2 139 79.4 128 Z" fill="${PAW}" filter="url(#qkFur)"/>
      <path d="M72.3 141.5 V143.8 M75 142.3 V144.6 M77.5 142 V144" stroke="#2a211b" stroke-width=".7" stroke-linecap="round"/>
    </g>
    <g class="arm-rest-r">
      <path d="M101 98 C99 112 94 122 89 129 L83 127 C85 117 86 106 88 97 Z" fill="${ARM}" opacity=".75" filter="url(#qkB1)"/>
      <path d="M90 126 C91.5 134 88.5 143.5 84 144.4 C80.5 144.8 79.8 139 80.6 128 Z" fill="${PAW}" filter="url(#qkFur)"/>
      <path d="M87.7 141.5 V143.8 M85 142.3 V144.6 M82.5 142 V144" stroke="#2a211b" stroke-width=".7" stroke-linecap="round"/>
    </g>

    <!-- 招牌動作：雙手捧著葉子吃 -->
    <g class="arms-eat">
      <g class="leaf">
        <path d="M78 66 C70 58 60 52 50 53 C54 61 64 67 78 66 Z" fill="url(#qkLeaf)" stroke="#3f7a2f" stroke-width=".8"/>
        <path d="M78 66 C68 61 60 57 52 54.5" fill="none" stroke="#e9f3dc" stroke-width=".7" opacity=".8"/>
      </g>
      <path d="M60 98 C62 86 68 77 74 71 L79 74 C74 80 70 90 70 98 Z" fill="${ARM}" filter="url(#qkFur)"/>
      <path d="M100 98 C98 86 92 77 86 71 L81 74 C86 80 90 90 90 98 Z" fill="${ARM}" filter="url(#qkFur)"/>
      <ellipse cx="76" cy="70.5" rx="4.6" ry="4" fill="${PAW}" filter="url(#qkFur)"/>
      <ellipse cx="84" cy="70.5" rx="4.6" ry="4" fill="${PAW}" filter="url(#qkFur)"/>
    </g>

    <!-- 排球：雙臂併攏在左前方墊球 -->
    <g class="arms-bump">
      <path d="M62 98 C58 110 54 122 49 132 L55 135 C60 125 66 113 70 100 Z" fill="${ARM}" filter="url(#qkFur)"/>
      <path d="M98 98 C88 112 70 126 54 133 L57 138 C74 131 94 118 104 102 Z" fill="${ARM}" filter="url(#qkFur)"/>
      <ellipse cx="51" cy="135.5" rx="6" ry="5" fill="${PAW}" filter="url(#qkFur)"/>
    </g>

    <!-- 右手（羽球、籃球）：貼著身體右緣，以肩膀 (108,98) 為軸往外上方舉，不會擋到臉 -->
    <g class="arm-r">
      <g class="racket">
        <line x1="114" y1="132" x2="117.5" y2="145.5" stroke="#2f3540" stroke-width="2.6" stroke-linecap="round"/>
        <line x1="114.4" y1="133.6" x2="116" y2="140" stroke="#d9d3c4" stroke-width="3" stroke-linecap="round"/>
        <g transform="rotate(-12.1 119.6 155.5)">
          <ellipse cx="119.6" cy="155.5" rx="8" ry="10.5" fill="#ffffff" fill-opacity=".45" stroke="#2b5f9a" stroke-width="2"/>
          <path d="M114.8 148 V163 M119.6 145.2 V165.8 M124.4 148 V163 M112.2 151.5 H127 M111.7 155.5 H127.5 M112.2 159.5 H127" stroke="#a7bdd1" stroke-width=".6" fill="none"/>
        </g>
      </g>
      <path d="M103.5 96 C106.5 108 109.5 118 110.5 127 L117 126 C116 116 114.5 106 112.5 95 Z" fill="${ARM}" filter="url(#qkFur)"/>
      <ellipse cx="114" cy="129" rx="5" ry="6" fill="${PAW}" filter="url(#qkFur)"/>
    </g>

    <!-- 思考的「…」、打盹的 Zzz、自拍的閃光星星 -->
    <g class="think-dots">
      <circle cx="118" cy="20" r="3" fill="#8a8f98"/><circle cx="127" cy="14" r="2.3" fill="#8a8f98"/><circle cx="134" cy="9" r="1.7" fill="#8a8f98"/>
    </g>
    <g class="zzz" font-family="Arial, sans-serif" font-weight="700" fill="#7c8696">
      <text class="z1" x="112" y="30" font-size="9">Z</text>
      <text class="z2" x="121" y="20" font-size="11">Z</text>
      <text class="z3" x="132" y="8" font-size="13">Z</text>
    </g>
    <g class="sparkles" fill="#ffd34d">
      <path class="sp1" d="M30 40 L32 46 L38 48 L32 50 L30 56 L28 50 L22 48 L28 46 Z"/>
      <path class="sp2" d="M128 34 L129.5 38.5 L134 40 L129.5 41.5 L128 46 L126.5 41.5 L122 40 L126.5 38.5 Z"/>
      <path class="sp3" d="M134 92 L135.2 95.8 L139 97 L135.2 98.2 L134 102 L132.8 98.2 L129 97 L132.8 95.8 Z"/>
    </g>
  </g>

  <!-- 球：外層 .bx 走 X、內層 .by 走 Y，合成拋物線；圖形以 (0,0) 為中心 -->
  <g class="ball ball-vb"><g class="bx"><g class="by"><g class="spin">
    <circle r="9.5" fill="url(#qkVB)" stroke="#9aa0a8" stroke-width=".8"/>
    <path d="M-9.5 0 Q0 -5 9.5 0 M-6 -7.3 Q2 -2 2.6 9.1 M6 -7.3 Q4.2 1.8 -5.2 7.8" fill="none" stroke="#3f6fb5" stroke-width="1.2"/>
    <path d="M-8 4.8 Q-1 6 4.5 8.3" fill="none" stroke="#e2b53b" stroke-width="1.2"/>
  </g></g></g></g>
  <g class="ball ball-bb"><g class="bx"><g class="by"><g class="spin">
    <circle r="9.5" fill="url(#qkBB)"/>
    <path d="M-9.5 0 H9.5 M0 -9.5 V9.5 M-6.8 -6.6 Q-1.6 0 -6.8 6.6 M6.8 -6.6 Q1.6 0 6.8 6.6" fill="none" stroke="#5a2a0d" stroke-width="1"/>
  </g></g></g></g>
  <g class="ball shuttle"><g class="bx"><g class="by"><g class="spin">
    <path d="M-1.6 1.6 L9 -3.5 L3.5 -9 Z" fill="#ffffff" stroke="#b9bec5" stroke-width=".8" stroke-linejoin="round"/>
    <path d="M-1.6 1.6 L6.2 -6.2 M1 -1.2 L7.4 -4.6 M-0.4 -0.4 L4.8 -7.6" stroke="#d6dade" stroke-width=".5"/>
    <circle cx="-3" cy="3" r="3" fill="#fff8ec" stroke="#c9483a" stroke-width="1.3"/>
  </g></g></g></g>
  <radialGradient id="qkFlash"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".55" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <ellipse class="flash" cx="80" cy="80" rx="110" ry="120" fill="url(#qkFlash)"/>
</svg>`;

  // ---------------------------------------------------------------------------
  // 角色資料
  // ---------------------------------------------------------------------------
  const CHARACTERS = {
    quokka: {
      id: 'quokka', nameZh: '短尾矮袋鼠', nameEn: 'Quokka', callName: '庫卡',
      greeting: '嗨，我是庫卡！今天也笑著把事情做完，等等一起打球吧。',
      cheer: '完成一項，得分！',
      // 動作清單（對應 pet.css 的 data-pose）：球類＋依真實習性設計的招牌動作
      actions: ['badminton', 'volleyball', 'basketball', 'eat', 'hop', 'selfie', 'nap'],
      actionGroups: [
        { title: '打球', ids: ['badminton', 'volleyball', 'basketball'] },
        { title: '招牌動作', ids: ['eat', 'hop', 'selfie', 'nap'] }
      ],
      actionNames: {
        badminton: '羽球', volleyball: '排球', basketball: '籃球',
        eat: '捧葉子吃', hop: '跳一跳', selfie: '自拍', nap: '坐著打盹'
      },
      // 每個動作的長度（毫秒），需與 pet.css 的動畫總長一致
      actionMs: {
        badminton: 4800, volleyball: 4800, basketball: 4800,
        eat: 4800, hop: 1600, selfie: 3200, nap: 9600
      },
      // 自動輪播的權重（越大越常出現）
      actionWeights: { badminton: 3, volleyball: 3, basketball: 3, eat: 2, hop: 2, selfie: 1, nap: 1 },
      actionLines: {
        badminton: '殺球成功！', volleyball: '這球接得漂亮！', basketball: '進球，兩分！',
        eat: '葉子真好吃。', selfie: '這張一定會紅。', nap: '呼……我剛剛沒有睡著喔。'
      },
      // AI 聊天人格
      persona:
        '你是「庫卡」，一隻住在使用者桌面上的短尾矮袋鼠（quokka），個性開朗、愛笑，' +
        '最喜歡打羽球、排球和籃球，也喜歡用前爪捧著葉子吃、白天在陰涼處打盹、跟人自拍。' +
        '請一律使用繁體中文，語氣溫暖、簡短、有精神，偶爾可以用球場上的比喻替使用者打氣，' +
        '但回答問題時仍要具體、正確、有條理，不要為了可愛而犧牲內容。',
      quoteTitle: '庫卡語錄',
      quoteHint: '以下是庫卡的原創球場打氣語，以及幾則短尾矮袋鼠的生態小知識；並非引用任何名人名言。',
      speakLabel: '讓庫卡說這句',
      svg: quokkaSvg
    }
  };

  const ORDER = ['quokka'];
  const DEFAULT_ID = 'quokka';

  const api = { CHARACTERS, ORDER, DEFAULT_ID };

  if (typeof window !== 'undefined') {
    window.CHARACTERS = CHARACTERS;
    window.CHAR_ORDER = ORDER;
    window.CHAR_DEFAULT = DEFAULT_ID;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
