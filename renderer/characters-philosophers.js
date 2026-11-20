// 哲學家角色包（Q 版致敬漫畫造型）。
// Philosopher pack — chibi caricatures, private personal toy.
//
// 選角原則：全部為過世數百至兩千多年的歷史人物，造型、姓名與引文皆無著作權或肖像權疑慮。
// 多數人物並無可靠的寫實肖像流傳，造型取自傳統畫像慣例（衣冠、鬍鬚）＋ 代表性符號（.motif）。
//
// 這個檔案是一個「角色包工廠」：由 characters.js 呼叫並傳入共用的繪圖工具（h），
// 回傳 { category, characters, order }。新增其他職業時，照這個格式另寫一個檔案即可。
// 瀏覽器：本檔需在 characters.js 之前載入（推入 window.CHAR_PACKS）；Node：module.exports。

(function () {
  function pack(h) {
    const { SKIN, wrap, eyes, THINK_DOTS, SKETCH } = h;

    const BODY = 'M50 172 Q47 123 80 119 Q113 123 110 172 Z';
    const FACE = 'M54 52 Q54 28 80 28 Q106 28 106 52 L105 78 Q103 98 80 104 Q57 98 55 78 Z';
    const NOSE = '<path d="M80 75 L78 84 L82 85" fill="none" stroke="#c69879" stroke-width="1.4"/>';

    function mouth(color, y) {
      color = color || '#8a5547';
      y = y || 92;
      return `<path class="mouth" d="M74 ${y} Q80 ${y + 3} 86 ${y}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>
        <path class="mouth-happy" display="none" d="M71 ${y - 2} Q80 ${y + 7} 89 ${y - 2}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;
    }

    // 細長、安詳的眼睛（仍保留 .eye 以沿用眨眼動畫）
    function calmEyes(cy) {
      cy = cy || 72;
      return `<ellipse class="eye" cx="66" cy="${cy}" rx="3.8" ry="2" fill="#242424"/>
        <ellipse class="eye" cx="94" cy="${cy}" rx="3.8" ry="2" fill="#242424"/>`;
    }

    // 長鬚（傳統中國畫像）：顏色、長度可調
    function longBeard(color, len) {
      const b = 104 + (len || 30);
      return `<path d="M58 84 Q60 100 68 110 Q72 ${b - 6} 80 ${b} Q88 ${b - 6} 92 110 Q100 100 102 84 Q94 97 80 98 Q66 97 58 84 Z" fill="${color}"/>
        <path d="M67 89 Q80 83 93 89 Q86 92 80 90 Q74 92 67 89 Z" fill="${color}"/>`;
    }

    // 捲曲大鬍子（古希臘羅馬胸像）
    function curlyBeard(color, shade) {
      let c = '';
      const pts = [[60, 88], [66, 98], [74, 104], [86, 104], [94, 98], [100, 88], [80, 108], [70, 110], [90, 110], [80, 99]];
      pts.forEach(([x, y]) => { c += `<circle cx="${x}" cy="${y}" r="7" fill="${color}" stroke="${shade}" stroke-width="1"/>`; });
      return c + `<path d="M68 88 Q80 82 92 88 Q86 91 80 89 Q74 91 68 88 Z" fill="${color}" stroke="${shade}" stroke-width="1"/>`;
    }

    function curls(color, shade, y, from, to, step, r) {
      let c = '';
      for (let x = from; x <= to; x += step) {
        c += `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="${shade}" stroke-width="1"/>`;
      }
      return c;
    }

    function star(cx, cy, r, fill) {
      let d = '';
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const rr = i % 2 ? r * 0.45 : r;
        d += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1) + ' ';
      }
      return `<path d="${d}Z" fill="${fill}"/>`;
    }

    // 交領（右衽）：中國古代服飾
    function crossCollar(color) {
      return `<path d="M68 120 L90 152" stroke="${color}" stroke-width="5" fill="none"/>
        <path d="M92 120 L82 134" stroke="${color}" stroke-width="5" fill="none"/>`;
    }

    // 組裝一位角色（沿用桌寵動畫所需的所有 class）
    function person(o) {
      return wrap(`
        <g class="motif">${o.motif}</g>
        <g class="pet-body">
          <g class="body">
            <path d="${o.bodyPath || BODY}" fill="${o.robe}" stroke="${o.robeStroke}" stroke-width="2"/>
            ${o.bodyExtra || ''}
          </g>
          <g class="gesture-arm">
            <path d="M55 136 Q38 150 27 154" fill="none" stroke="${o.sleeve || o.robe}" stroke-width="${o.sleeveW || 9}" stroke-linecap="round"/>
            <circle class="hand" cx="26" cy="155" r="6" fill="${o.skin || SKIN}"/>
          </g>
          <g class="head">
            ${o.back || ''}
            <path class="face" d="${o.face || FACE}" fill="${o.skin || SKIN}"/>
            ${o.front || ''}
            ${o.brows || ''}
            ${o.eyes || eyes(66, 94, 72, 3.4)}
            ${o.nose || NOSE}
            ${o.beard || ''}
            ${o.mouth || mouth()}
            ${o.over || ''}
            ${THINK_DOTS}
          </g>
          ${SKETCH}
        </g>`);
    }

    // =====================================================================
    // 東方
    // =====================================================================

    // 孔子 — 儒冠、灰白長鬚、濃眉、深藍深衣；竹簡。
    const confucius = person({
      motif: [0, 1, 2, 3, 4, 5].map((i) =>
        `<rect x="${8 + i * 5}" y="118" width="4.4" height="34" rx="1" fill="#dcc07e" stroke="#a8874c" stroke-width=".8"/>`).join('') +
        '<path d="M7 126 H38 M7 144 H38" stroke="#6e5126" stroke-width="1.3"/>',
      robe: '#3d4a6b', robeStroke: '#29324c',
      bodyExtra: crossCollar('#ece4cc') + '<rect x="51" y="150" width="58" height="6" fill="#8a6d3b"/>',
      back: '<path d="M52 56 Q50 30 80 27 Q110 30 108 56 L108 72 L52 72 Z" fill="#9c9b96"/>',
      front: '<path d="M54 52 Q56 32 80 31 Q104 32 106 52 Q96 42 80 42 Q64 42 54 52 Z" fill="#a8a7a1"/>' +
        '<path d="M68 31 L70 14 L90 14 L92 31 Z" fill="#2b2b2b"/><rect x="62" y="28" width="36" height="5" rx="2" fill="#2b2b2b"/>' +
        '<line x1="60" y1="21" x2="100" y2="21" stroke="#b08d57" stroke-width="2.5" stroke-linecap="round"/>',
      brows: '<path d="M57 64 Q65 59 73 64 M87 64 Q95 59 103 64" stroke="#7f7e78" stroke-width="3.4" fill="none" stroke-linecap="round"/>',
      eyes: calmEyes(72),
      beard: longBeard('#dcdbd4', 38),
      mouth: mouth('#7a4b40', 92)
    });

    // 老子 — 寬額光頂、白長髮、長垂白眉、及胸白鬚、麻色長袍；水紋（上善若水）。
    const laozi = person({
      motif: '<g fill="none" stroke="#5c9ac2" stroke-width="2.6" stroke-linecap="round">' +
        '<path d="M6 132 Q14 124 22 132 T38 132"/><path d="M6 142 Q14 134 22 142 T38 142"/><path d="M6 152 Q14 144 22 152 T38 152"/></g>',
      robe: '#cbb999', robeStroke: '#9c8a6c',
      bodyExtra: crossCollar('#7a6a50'),
      face: 'M53 56 Q52 18 80 18 Q108 18 107 56 L105 78 Q103 98 80 104 Q57 98 55 78 Z',
      back: '<path d="M51 52 Q46 86 54 122 L106 122 Q114 86 109 52 Q104 30 80 30 Q56 30 51 52 Z" fill="#efeee9"/>',
      front: '<ellipse cx="72" cy="30" rx="9" ry="4.5" fill="#ffffff" opacity=".4"/>' +
        '<path d="M53 60 Q47 48 54 40 L57 62 Z M107 60 Q113 48 106 40 L103 62 Z" fill="#f6f5f1"/>',
      brows: '<path d="M56 65 Q64 58 73 63 Q62 64 53 74 Z M104 65 Q96 58 87 63 Q98 64 107 74 Z" fill="#f6f5f1" stroke="#cfcdc6" stroke-width=".8"/>',
      eyes: calmEyes(72),
      beard: longBeard('#f4f3ef', 46),
      mouth: mouth('#8a5a4c', 92)
    });

    // 莊子 — 披散黑髮加木簪髮髻、短鬚、悠然笑意、青綠衣；蝴蝶（莊周夢蝶）。
    const zhuangzi = person({
      motif: '<g transform="translate(22 132)">' +
        '<ellipse cx="-7" cy="-5" rx="8" ry="6" fill="#eaa63e" transform="rotate(-25 -7 -5)"/>' +
        '<ellipse cx="7" cy="-5" rx="8" ry="6" fill="#eaa63e" transform="rotate(25 7 -5)"/>' +
        '<ellipse cx="-5" cy="5" rx="5" ry="4" fill="#d47f2a"/><ellipse cx="5" cy="5" rx="5" ry="4" fill="#d47f2a"/>' +
        '<circle cx="-8" cy="-6" r="1.6" fill="#fff6dc"/><circle cx="8" cy="-6" r="1.6" fill="#fff6dc"/>' +
        '<rect x="-1" y="-9" width="2" height="17" rx="1" fill="#3a3028"/>' +
        '<path d="M-1 -9 Q-4 -15 -7 -17 M1 -9 Q4 -15 7 -17" stroke="#3a3028" fill="none" stroke-width="1"/></g>',
      robe: '#5f7a64', robeStroke: '#435a48',
      bodyExtra: crossCollar('#e6e1cf'),
      back: '<path d="M52 54 Q50 26 80 25 Q110 26 108 54 L112 100 L101 94 L104 62 L56 62 L59 94 L48 100 Z" fill="#2c2a28"/>',
      front: '<path d="M54 52 Q58 30 80 29 Q102 30 106 52 Q92 38 80 40 Q66 38 54 52 Z" fill="#2c2a28"/>' +
        '<ellipse cx="80" cy="22" rx="9" ry="7" fill="#2c2a28"/>' +
        '<line x1="65" y1="23" x2="95" y2="18" stroke="#b08d57" stroke-width="2.2" stroke-linecap="round"/>',
      brows: '<path d="M59 64 Q66 61 72 64 M88 64 Q94 61 101 64" stroke="#2c2a28" stroke-width="2" fill="none" stroke-linecap="round"/>',
      beard: '<path d="M70 88 Q80 84 90 88" stroke="#2c2a28" stroke-width="2" fill="none"/><path d="M76 98 Q80 114 84 98 Z" fill="#2c2a28"/>',
      mouth: `<path class="mouth" d="M73 92 Q80 97 87 92" fill="none" stroke="#8a5547" stroke-width="2.2" stroke-linecap="round"/>
        <path class="mouth-happy" display="none" d="M71 90 Q80 100 89 90" fill="none" stroke="#8a5547" stroke-width="2.5" stroke-linecap="round"/>`
    });

    // 孟子 — 黑冠、黑長鬚、赭紅袍；規（圓規）與矩（曲尺）。
    const mencius = person({
      motif: '<path d="M8 118 L8 152 L38 152 L38 146 L14 146 L14 118 Z" fill="#c9a46c" stroke="#8a6a3a" stroke-width="1.2"/>' +
        '<path d="M28 116 L20 142 M28 116 L36 142" stroke="#5d6066" stroke-width="2.6" stroke-linecap="round"/>' +
        '<circle cx="28" cy="116" r="2.8" fill="#5d6066"/>',
      robe: '#7a3b2e', robeStroke: '#55281f',
      bodyExtra: crossCollar('#ece4cc') + '<rect x="51" y="150" width="58" height="6" fill="#2f2a26"/>',
      back: '<path d="M52 56 Q50 30 80 27 Q110 30 108 56 L108 70 L52 70 Z" fill="#26231f"/>',
      front: '<path d="M54 52 Q56 32 80 31 Q104 32 106 52 Q96 42 80 42 Q64 42 54 52 Z" fill="#26231f"/>' +
        '<path d="M66 32 L68 15 Q80 9 92 15 L94 32 Z" fill="#1f1f1f"/><rect x="62" y="29" width="36" height="5" rx="2" fill="#1f1f1f"/>' +
        '<path d="M62 33 Q56 60 58 84 M98 33 Q104 60 102 84" stroke="#1f1f1f" stroke-width="1.2" fill="none"/>',
      brows: '<path d="M58 64 Q65 60 72 63 M88 63 Q95 60 102 64" stroke="#26231f" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
      beard: longBeard('#2a2622', 30),
      mouth: mouth('#d9b8a0', 92)
    });

    // 墨子 — 布巾束髮、黝黑膚色、粗布短褐、短鬚；木鳶。
    const MOZI_SKIN = '#dfb48c';
    const mozi = person({
      motif: '<polygon points="5,134 24,123 41,131 27,134 31,147 20,136" fill="#b58a58" stroke="#7a5630" stroke-width="1.3"/>' +
        '<path d="M24 123 L22 136" stroke="#7a5630" stroke-width="1"/>',
      robe: '#8a6a48', robeStroke: '#5f4830', skin: MOZI_SKIN, sleeveW: 8,
      bodyExtra: crossCollar('#5f4830') + '<path d="M51 150 L109 150" stroke="#4a3a28" stroke-width="4"/>',
      back: '<path d="M54 50 Q54 25 80 25 Q106 25 106 50 Z" fill="#2a2622"/>',
      front: '<rect x="52" y="43" width="56" height="8" rx="3" fill="#5b4a3a"/>' +
        '<path d="M106 47 Q116 52 114 64 M106 48 Q120 50 120 58" stroke="#5b4a3a" stroke-width="3" fill="none" stroke-linecap="round"/>',
      brows: '<path d="M58 63 L72 62 M88 62 L102 63" stroke="#2a2622" stroke-width="3" stroke-linecap="round"/>',
      nose: '<path d="M80 75 L78 84 L82 85" fill="none" stroke="#a87554" stroke-width="1.4"/>',
      beard: '<path d="M59 84 Q62 102 80 106 Q98 102 101 84 Q92 98 80 98 Q68 98 59 84 Z" fill="#3a332c" opacity=".9"/>' +
        '<path d="M69 88 Q80 84 91 88" stroke="#3a332c" stroke-width="2.4" fill="none"/>',
      mouth: mouth('#f0d0b4', 92)
    });

    // 荀子 — 冠、灰黑鬚、靛藍袍（青出於藍）；藍草與染缸。
    const xunzi = person({
      motif: '<path d="M10 150 Q6 128 22 114 Q28 134 10 150 Z" fill="#4c8a5a"/>' +
        '<path d="M12 148 Q16 130 22 116" stroke="#2f6a3f" fill="none" stroke-width="1.2"/>' +
        '<path d="M22 138 L40 138 L37 154 L25 154 Z" fill="#8a6a48" stroke="#5f4830" stroke-width="1.2"/>' +
        '<ellipse cx="31" cy="139" rx="9" ry="2.6" fill="#1f4f8a"/>',
      robe: '#2f5d7c', robeStroke: '#1f4058',
      bodyExtra: crossCollar('#e8e4d8'),
      back: '<path d="M52 56 Q50 30 80 27 Q110 30 108 56 L108 70 L52 70 Z" fill="#3a3734"/>',
      front: '<path d="M54 52 Q56 32 80 31 Q104 32 106 52 Q96 42 80 42 Q64 42 54 52 Z" fill="#3a3734"/>' +
        '<rect x="68" y="16" width="24" height="15" rx="2" fill="#2b2b2b"/><rect x="62" y="28" width="36" height="5" rx="2" fill="#2b2b2b"/>' +
        '<line x1="58" y1="22" x2="102" y2="22" stroke="#9a8a6a" stroke-width="2.2" stroke-linecap="round"/>',
      brows: '<path d="M58 65 Q65 61 72 64 M88 64 Q95 61 102 65" stroke="#4a4642" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
      eyes: calmEyes(72),
      beard: longBeard('#6e6a64', 24),
      mouth: mouth('#e2c4ac', 92)
    });

    // 韓非子 — 高冠、黑衣紅緣（法家尚嚴）、皺眉、抿嘴、八字鬚；墨繩與懸錘。
    const hanfeizi = person({
      motif: '<rect x="10" y="112" width="24" height="4" fill="#9a7a4a"/>' +
        '<line x1="22" y1="116" x2="22" y2="144" stroke="#1d1d1d" stroke-width="1.5"/>' +
        '<path d="M22 144 L16 150 L22 157 L28 150 Z" fill="#8a8f96" stroke="#5d6066" stroke-width="1"/>',
      robe: '#262626', robeStroke: '#111',
      bodyExtra: crossCollar('#a8342b') + '<rect x="51" y="150" width="58" height="6" fill="#a8342b"/>',
      back: '<path d="M52 56 Q50 30 80 27 Q110 30 108 56 L108 70 L52 70 Z" fill="#1d1b19"/>',
      front: '<path d="M54 52 Q56 32 80 31 Q104 32 106 52 Q96 42 80 42 Q64 42 54 52 Z" fill="#1d1b19"/>' +
        '<path d="M70 31 L66 6 L94 6 L90 31 Z" fill="#141414"/><rect x="62" y="28" width="36" height="5" rx="2" fill="#141414"/>' +
        '<path d="M62 33 Q57 62 60 86 M98 33 Q103 62 100 86" stroke="#141414" stroke-width="1.2" fill="none"/>',
      brows: '<path d="M57 61 L72 65 M88 65 L103 61" stroke="#1d1b19" stroke-width="3" stroke-linecap="round"/>',
      beard: '<path d="M80 87 Q70 85 62 94 M80 87 Q90 85 98 94" stroke="#1d1b19" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
        '<path d="M77 99 L80 112 L83 99 Z" fill="#1d1b19"/>',
      mouth: `<path class="mouth" d="M74 93 L86 93" fill="none" stroke="#8a5547" stroke-width="2.2" stroke-linecap="round"/>
        <path class="mouth-happy" display="none" d="M73 91 Q80 97 87 91" fill="none" stroke="#8a5547" stroke-width="2.4" stroke-linecap="round"/>`
    });

    // 王陽明 — 明代烏紗帽（兩側帽翅）、紅色官袍與胸前補子、細長鬚；山中之花。
    const wangyangming = person({
      motif: '<path d="M22 152 Q20 138 23 126" stroke="#4c8a5a" stroke-width="2" fill="none"/>' +
        '<path d="M22 142 Q14 138 12 132 Q20 134 22 142 Z" fill="#4c8a5a"/>' +
        [0, 72, 144, 216, 288].map((a) =>
          `<ellipse cx="23" cy="117" rx="4.2" ry="7" fill="#e88aa4" transform="rotate(${a} 23 124)"/>`).join('') +
        '<circle cx="23" cy="124" r="3" fill="#f4cf4a"/>',
      robe: '#a6352b', robeStroke: '#74241d',
      bodyExtra: '<path d="M68 120 Q80 132 92 120" fill="none" stroke="#74241d" stroke-width="3"/>' +
        '<rect x="69" y="134" width="22" height="19" fill="#d9b44a" stroke="#8a6d1f" stroke-width="1.2"/>' +
        '<path d="M74 146 Q80 136 86 146" stroke="#8a6d1f" fill="none" stroke-width="1.2"/>',
      back: '<path d="M54 58 Q52 34 80 32 Q108 34 106 58 Z" fill="#1d1b19"/>',
      front: '<path d="M60 36 Q60 15 80 15 Q100 15 100 36 Z" fill="#161616"/>' +
        '<rect x="57" y="31" width="46" height="9" rx="2" fill="#161616"/>' +
        '<rect x="30" y="32" width="28" height="5" rx="2.5" fill="#161616"/><rect x="102" y="32" width="28" height="5" rx="2.5" fill="#161616"/>',
      brows: '<path d="M59 64 Q66 60 72 63 M88 63 Q94 60 101 64" stroke="#1d1b19" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
      eyes: calmEyes(72),
      beard: '<path d="M80 87 Q70 86 64 96 M80 87 Q90 86 96 96" stroke="#1d1b19" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
        '<path d="M76 99 Q78 118 80 126 Q82 118 84 99 Z" fill="#1d1b19"/>' +
        '<path d="M57 80 Q58 96 64 102 M103 80 Q102 96 96 102" stroke="#1d1b19" stroke-width="1.4" fill="none"/>',
      mouth: mouth('#8a5547', 93)
    });

    // =====================================================================
    // 古希臘羅馬
    // =====================================================================

    // 蘇格拉底 — 禿頂寬額、獅子鼻、大眼、捲曲白鬚、米色斜披外袍；陶杯。
    const socrates = person({
      motif: '<path d="M7 128 Q22 144 37 128 Z" fill="#c8693a" stroke="#8f4422" stroke-width="1.2"/>' +
        '<path d="M12 131 Q22 138 32 131" stroke="#2a1d16" stroke-width="1.6" fill="none"/>' +
        '<rect x="20" y="138" width="4" height="10" fill="#c8693a"/><ellipse cx="22" cy="150" rx="8" ry="2.6" fill="#c8693a"/>',
      robe: '#e9e1cc', robeStroke: '#b6aa8c',
      bodyExtra: '<path d="M52 140 Q72 128 96 120 L104 128 Q80 138 56 160 Z" fill="#d8ccb0"/>',
      sleeve: '#e9e1cc',
      face: 'M53 56 Q52 20 80 20 Q108 20 107 56 L105 78 Q103 98 80 104 Q57 98 55 78 Z',
      back: curls('#c9c6bd', '#a29e93', 62, 50, 56, 6, 6) + curls('#c9c6bd', '#a29e93', 62, 104, 110, 6, 6) +
        curls('#c9c6bd', '#a29e93', 52, 52, 52, 1, 6) + curls('#c9c6bd', '#a29e93', 52, 108, 108, 1, 6),
      front: '<ellipse cx="72" cy="31" rx="10" ry="5" fill="#ffffff" opacity=".4"/>' +
        '<path d="M66 40 Q80 36 94 40" stroke="#d8b496" stroke-width="1.2" fill="none"/>',
      brows: '<path d="M57 63 Q65 58 73 62 M87 62 Q95 58 103 63" stroke="#a29e93" stroke-width="3" fill="none" stroke-linecap="round"/>',
      eyes: eyes(66, 94, 71, 4.4),
      nose: '<path d="M74 80 Q80 88 86 80 Q87 87 80 88 Q73 87 74 80 Z" fill="#e3b593" stroke="#c69879" stroke-width="1"/>',
      beard: curlyBeard('#dddad2', '#b3afa4'),
      mouth: mouth('#8a5547', 94)
    });

    // 亞里斯多德 — 短捲髮、整齊捲鬚、藍灰外袍搭白色內衣；書卷。
    const aristotle = person({
      motif: '<rect x="8" y="140" width="30" height="11" rx="5.5" fill="#e6d3a3" stroke="#a88f5a" stroke-width="1.2"/>' +
        '<rect x="11" y="129" width="26" height="11" rx="5.5" fill="#ecdcb2" stroke="#a88f5a" stroke-width="1.2"/>' +
        '<rect x="14" y="118" width="22" height="11" rx="5.5" fill="#e6d3a3" stroke="#a88f5a" stroke-width="1.2"/>' +
        '<circle cx="9" cy="145.5" r="2" fill="#a88f5a"/><circle cx="12" cy="134.5" r="2" fill="#a88f5a"/><circle cx="15" cy="123.5" r="2" fill="#a88f5a"/>',
      robe: '#f0ece2', robeStroke: '#b9b2a0',
      bodyExtra: '<path d="M50 172 Q48 140 62 126 L104 168 L110 172 Z" fill="#5a6f8a" stroke="#3e4f66" stroke-width="1.5"/>',
      sleeve: '#5a6f8a',
      back: '<path d="M52 58 Q50 28 80 26 Q110 28 108 58 L106 72 L54 72 Z" fill="#5b524a"/>',
      front: curls('#5b524a', '#3f3832', 36, 58, 102, 8, 6) + curls('#5b524a', '#3f3832', 44, 54, 54, 1, 5) + curls('#5b524a', '#3f3832', 44, 106, 106, 1, 5),
      brows: '<path d="M59 63 Q66 60 72 63 M88 63 Q94 60 101 63" stroke="#3f3832" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
      beard: curlyBeard('#6b6158', '#4a423b'),
      mouth: mouth('#e9c8ae', 93)
    });

    // 馬可·奧理略 — 月桂冠、濃密捲髮與捲鬚、紫紅披風與金色扣針；蠟板筆記。
    const aurelius = person({
      motif: '<rect x="8" y="118" width="30" height="36" rx="2" fill="#8a5a32" stroke="#5e3b1e" stroke-width="1.2"/>' +
        '<rect x="12" y="122" width="22" height="28" fill="#d8a53a"/>' +
        '<path d="M15 128 H31 M15 134 H29 M15 140 H31 M15 146 H25" stroke="#7a4e16" stroke-width="1.2"/>',
      robe: '#c8bfa6', robeStroke: '#958c74',
      bodyExtra: '<path d="M50 172 Q47 128 66 120 L96 120 Q113 126 110 172 L98 172 Q100 140 84 126 L66 128 Q58 140 60 172 Z" fill="#6a3c6e" stroke="#4a2850" stroke-width="1.5"/>' +
        '<circle cx="96" cy="124" r="4" fill="#d9b44a" stroke="#8a6d1f"/>',
      sleeve: '#6a3c6e',
      back: '<path d="M52 58 Q50 28 80 26 Q110 28 108 58 L108 76 L52 76 Z" fill="#6b4a2e"/>',
      front: curls('#6b4a2e', '#4a3220', 36, 58, 102, 7, 6) + curls('#6b4a2e', '#4a3220', 46, 53, 53, 1, 5) + curls('#6b4a2e', '#4a3220', 46, 107, 107, 1, 5) +
        '<path d="M52 44 Q80 22 108 44" stroke="#4c8a3a" stroke-width="3" fill="none"/>' +
        [56, 64, 72, 88, 96, 104].map((x, i) =>
          `<ellipse cx="${x}" cy="${i < 3 ? 40 - i * 4 : 32 + (i - 3) * 4}" rx="5" ry="2.4" fill="#5da046" transform="rotate(${i < 3 ? -35 : 35} ${x} ${i < 3 ? 40 - i * 4 : 32 + (i - 3) * 4})"/>`).join(''),
      brows: '<path d="M59 63 Q66 60 72 63 M88 63 Q94 60 101 63" stroke="#4a3220" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
      beard: curlyBeard('#7a5636', '#4a3220'),
      mouth: mouth('#f0d0b4', 93)
    });

    // 塞內卡 — 稀疏凌亂的髮、短鬍渣、額頭皺紋、白色托加袍與紫邊；封蠟書信。
    const seneca = person({
      motif: '<rect x="8" y="122" width="30" height="24" rx="2" fill="#efe3c4" stroke="#a8946a" stroke-width="1.2"/>' +
        '<path d="M12 128 H34 M12 133 H30 M12 138 H32" stroke="#8a7a5a" stroke-width="1"/>' +
        '<circle cx="31" cy="145" r="5" fill="#b33a2e"/><circle cx="31" cy="145" r="2.2" fill="#8a2a20"/>',
      robe: '#f1ede4', robeStroke: '#bdb6a5',
      bodyExtra: '<path d="M54 140 Q76 126 100 120" stroke="#6a3c6e" stroke-width="4" fill="none"/>' +
        '<path d="M60 172 Q70 148 102 128" stroke="#d8d1c0" stroke-width="2" fill="none"/>',
      face: 'M53 56 Q52 22 80 22 Q108 22 107 56 L105 78 Q103 98 80 104 Q57 98 55 78 Z',
      back: '<path d="M52 66 Q48 46 56 40 L58 66 Z M108 66 Q112 46 104 40 L102 66 Z" fill="#5a4d42"/>',
      front: '<path d="M64 30 Q70 22 76 28 M78 26 Q84 20 90 27 M70 34 Q74 30 80 33" stroke="#5a4d42" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
        '<path d="M66 44 Q80 40 94 44 M68 50 Q80 47 92 50" stroke="#d2a888" stroke-width="1.2" fill="none"/>',
      brows: '<path d="M58 63 Q65 60 72 64 M88 64 Q95 60 102 63" stroke="#5a4d42" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
      beard: '<path d="M58 82 Q61 101 80 105 Q99 101 102 82 Q92 97 80 97 Q68 97 58 82 Z" fill="#6a5d50" opacity=".55"/>' +
        '<path d="M70 88 Q80 85 90 88" stroke="#6a5d50" stroke-width="1.6" fill="none" opacity=".7"/>',
      mouth: mouth('#8a5547', 92)
    });

    // =====================================================================
    // 近代歐洲
    // =====================================================================

    // 笛卡兒 — 中分及肩深色捲髮、細八字鬚與下唇小鬍、黑衣白色寬領；座標軸與曲線。
    const descartes = person({
      motif: '<path d="M10 154 L10 116 M10 154 L40 154" stroke="#3d4450" stroke-width="2" fill="none"/>' +
        '<path d="M7 120 L10 115 L13 120 M36 151 L41 154 L36 157" stroke="#3d4450" stroke-width="1.6" fill="none"/>' +
        '<path d="M12 150 Q22 148 28 136 Q32 126 38 122" stroke="#c0503c" stroke-width="2" fill="none"/>' +
        '<path d="M10 140 H40 M10 128 H40 M20 116 V154 M30 116 V154" stroke="#c9ccd2" stroke-width=".8"/>',
      robe: '#262a30', robeStroke: '#121418',
      bodyExtra: '<path d="M60 121 L100 121 L104 136 Q80 142 56 136 Z" fill="#f4f2ec" stroke="#c9c4b6" stroke-width="1"/>' +
        '<path d="M80 122 L80 140" stroke="#c9c4b6" stroke-width="1"/>',
      back: '<path d="M52 54 Q50 26 80 25 Q110 26 108 54 Q114 86 112 116 Q104 120 98 112 Q104 84 102 62 L58 62 Q56 84 62 112 Q56 120 48 116 Q46 86 52 54 Z" fill="#2e2621"/>',
      front: '<path d="M54 54 Q56 30 80 28 Q104 30 106 54 Q98 40 82 36 L80 42 L78 36 Q62 40 54 54 Z" fill="#2e2621"/>',
      brows: '<path d="M59 64 Q66 60 72 63 M88 63 Q94 60 101 64" stroke="#2e2621" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
      eyes: eyes(66, 94, 72, 3.8),
      beard: '<path d="M80 88 Q72 86 66 90 M80 88 Q88 86 94 90" stroke="#2e2621" stroke-width="2" fill="none" stroke-linecap="round"/>' +
        '<path d="M78 97 L80 103 L82 97 Z" fill="#2e2621"/>',
      mouth: mouth('#8a5547', 93)
    });

    // 康德 — 白色假髮兩側捲筒、清瘦臉、高鼻、棕色外套與白色領巾；星空（頭上的星空）。
    const kant = person({
      motif: '<circle cx="23" cy="134" r="17" fill="#26324f"/>' +
        star(16, 127, 4, '#f4d35e') + star(29, 129, 3, '#f4d35e') + star(22, 141, 3.4, '#f4d35e') + star(32, 142, 2.2, '#f9e9a8') +
        '<circle cx="12" cy="139" r="1" fill="#f9e9a8"/><circle cx="25" cy="121" r="1" fill="#f9e9a8"/>',
      robe: '#6b4f3a', robeStroke: '#4a3626',
      bodyExtra: '<path d="M72 121 Q80 140 88 121 Z" fill="#f4f2ec"/><path d="M76 126 Q80 142 84 126" fill="#f4f2ec" stroke="#d5d0c2" stroke-width="1"/>' +
        '<circle cx="80" cy="150" r="2" fill="#c9a46c"/><circle cx="80" cy="160" r="2" fill="#c9a46c"/>',
      face: 'M56 52 Q56 28 80 28 Q104 28 104 52 L103 78 Q101 98 80 104 Q59 98 57 78 Z',
      back: '<path d="M52 56 Q50 26 80 24 Q110 26 108 56 L106 70 L54 70 Z" fill="#ecebe6"/>',
      front: '<path d="M56 50 Q58 28 80 27 Q102 28 104 50 Q94 36 80 36 Q66 36 56 50 Z" fill="#ecebe6" stroke="#cfcdc6" stroke-width="1"/>' +
        '<rect x="44" y="60" width="14" height="9" rx="4.5" fill="#f4f3ef" stroke="#cfcdc6"/><rect x="44" y="70" width="14" height="9" rx="4.5" fill="#f4f3ef" stroke="#cfcdc6"/>' +
        '<rect x="102" y="60" width="14" height="9" rx="4.5" fill="#f4f3ef" stroke="#cfcdc6"/><rect x="102" y="70" width="14" height="9" rx="4.5" fill="#f4f3ef" stroke="#cfcdc6"/>',
      brows: '<path d="M60 64 Q66 61 72 64 M88 64 Q94 61 100 64" stroke="#a49e92" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
      eyes: eyes(66, 94, 72, 3.6),
      nose: '<path d="M80 72 Q76 82 76 86 Q80 88 83 86" fill="none" stroke="#c69879" stroke-width="1.6"/>',
      mouth: mouth('#8a5547', 94)
    });

    // 尼采 — 濃密後梳髮、招牌海象大鬍子、銳利濃眉、深色西裝白領；山峰與太陽（查拉圖斯特拉）。
    const nietzsche = person({
      motif: '<circle cx="30" cy="122" r="6" fill="#f2b84b"/>' +
        '<path d="M5 154 L19 124 L26 136 L32 128 L41 154 Z" fill="#7d8a99" stroke="#57626e" stroke-width="1.2"/>' +
        '<path d="M15 132 L19 124 L23 131 L20 129 Z" fill="#f4f6f8"/>',
      robe: '#2c3036', robeStroke: '#16191d',
      bodyExtra: '<path d="M70 120 L80 134 L90 120 Z" fill="#f4f2ec"/><path d="M78 124 L80 134 L82 124 Z" fill="#1d2024"/>' +
        '<path d="M70 120 L78 150 M90 120 L82 150" stroke="#16191d" stroke-width="1.5"/>',
      back: '<path d="M52 58 Q48 26 80 22 Q112 26 108 58 L108 74 L52 74 Z" fill="#4a3a2c"/>',
      front: '<path d="M54 52 Q54 24 80 23 Q106 24 106 52 Q100 38 92 36 Q82 30 70 36 Q60 40 54 52 Z" fill="#4a3a2c"/>' +
        '<path d="M64 33 Q80 26 96 34 M62 39 Q80 31 98 39" stroke="#6a5644" stroke-width="1.4" fill="none"/>',
      brows: '<path d="M56 62 L73 65 M87 65 L104 62" stroke="#3a2c20" stroke-width="3.8" stroke-linecap="round"/>',
      eyes: eyes(66, 94, 72, 3.4),
      mouth: mouth('#8a5547', 99),
      over: '<path d="M58 92 Q60 82 72 82 Q78 81 80 85 Q82 81 88 82 Q100 82 102 92 Q104 100 98 102 Q92 96 80 95 Q68 96 62 102 Q56 100 58 92 Z" fill="#4a3a2c" stroke="#3a2c20" stroke-width="1"/>'
    });

    // ---------------------------------------------------------------------
    // 角色資料：問候語為原創、依各家思想語氣撰寫，非引用原文。
    // ---------------------------------------------------------------------
    const characters = {
      confucius: { id: 'confucius', nameZh: '孔子', nameEn: 'Confucius', greeting: '今天也一步一步來吧，學了就要用上。', svg: confucius },
      mencius: { id: 'mencius', nameZh: '孟子', nameEn: 'Mencius', greeting: '心中有定見，手上有規矩，事情就能成。', svg: mencius },
      xunzi: { id: 'xunzi', nameZh: '荀子', nameEn: 'Xunzi', greeting: '一點一點累積，今天比昨天再好一些。', svg: xunzi },
      laozi: { id: 'laozi', nameZh: '老子', nameEn: 'Laozi', greeting: '別急，留一點空，事情自己會找到位置。', svg: laozi },
      zhuangzi: { id: 'zhuangzi', nameZh: '莊子', nameEn: 'Zhuangzi', greeting: '放輕鬆，換個角度，路就寬了。', svg: zhuangzi },
      mozi: { id: 'mozi', nameZh: '墨子', nameEn: 'Mozi', greeting: '先把標準定好，再動手，做出來才實在。', svg: mozi },
      hanfeizi: { id: 'hanfeizi', nameZh: '韓非子', nameEn: 'Han Feizi', greeting: '規則講清楚，執行到位，就不會亂。', svg: hanfeizi },
      wangyangming: { id: 'wangyangming', nameZh: '王陽明', nameEn: 'Wang Yangming', greeting: '想清楚了就去做，在做之中再想得更清楚。', svg: wangyangming },
      socrates: { id: 'socrates', nameZh: '蘇格拉底', nameEn: 'Socrates', greeting: '我們先問一個問題：你真正想解決的是什麼？', svg: socrates },
      aristotle: { id: 'aristotle', nameZh: '亞里斯多德', nameEn: 'Aristotle', greeting: '好習慣是一次次做出來的，今天也從這裡開始。', svg: aristotle },
      aurelius: { id: 'aurelius', nameZh: '馬可·奧理略', nameEn: 'Marcus Aurelius', greeting: '專注於眼前能掌握的事，其他的就隨它去。', svg: aurelius },
      seneca: { id: 'seneca', nameZh: '塞內卡', nameEn: 'Seneca', greeting: '時間是你最珍貴的材料，別讓它悄悄溜走。', svg: seneca },
      descartes: { id: 'descartes', nameZh: '笛卡兒', nameEn: 'René Descartes', greeting: '難題太大？把它拆小，一塊一塊解決。', svg: descartes },
      kant: { id: 'kant', nameZh: '康德', nameEn: 'Immanuel Kant', greeting: '按時、按理、按原則，今天也規律地前進。', svg: kant },
      nietzsche: { id: 'nietzsche', nameZh: '尼采', nameEn: 'Friedrich Nietzsche', greeting: '別怕混亂，那正是新東西誕生的地方。', svg: nietzsche }
    };

    return {
      category: {
        id: 'philosopher',
        label: '哲學家',
        persona: '一位沉穩、睿智的哲學導師',
        style: '像一位循循善誘的思想前輩，用平實的話把道理講清楚，引導使用者自己想通'
      },
      characters,
      order: ['confucius', 'mencius', 'xunzi', 'laozi', 'zhuangzi', 'mozi', 'hanfeizi', 'wangyangming',
        'socrates', 'aristotle', 'aurelius', 'seneca', 'descartes', 'kant', 'nietzsche']
    };
  }

  if (typeof window !== 'undefined') {
    (window.CHAR_PACKS = window.CHAR_PACKS || []).push(pack);
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = pack;
  }
})();
