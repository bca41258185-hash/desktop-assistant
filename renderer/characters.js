// 六位普立茲克建築大師的 Q 版（chibi）造型資料。
// Six Q-version (chibi) caricatures of Pritzker laureates — private personal toy.
//
// 設計原則：
//  - 純 inline SVG，無任何外部圖檔／字型／照片。
//  - 全部共用同一套動畫類別名稱，桌寵切換角色時只換 SVG，CSS 動畫自動沿用：
//      .pet-body（呼吸）、.eye（眨眼）、.gesture-arm / .sketch-lines（招牌手勢 + 空中速寫）、
//      .head（thinking 傾頭）、.mouth / .mouth-happy（happy 換嘴）、.think-dots（思考點點）、
//      .glasses（有眼鏡者的推眼鏡動作）、.motif（招牌建築元素）。
//  - 這是私人用的「致敬式漫畫」：取公開可辨識的特徵（髮型、眼鏡、衣著）＋ 建築符號，
//    非寫實、非照片、不含任何商標或官方肖像。
//
// 此檔同時供 renderer（window.CHARACTERS）與主行程（module.exports，取名稱/問候語）使用。

(function () {
  const SKIN = '#f3d4b4';

  // 共用：一對大眼睛（.eye 會被 CSS 以 scaleY 眨眼，瞳孔反光另放不眨）
  function eyes(lx, rx, cy, r) {
    r = r || 6;
    return `
      <ellipse class="eye" cx="${lx}" cy="${cy}" rx="${r}" ry="${r + 1}" fill="#242424"/>
      <ellipse class="eye" cx="${rx}" cy="${cy}" rx="${r}" ry="${r + 1}" fill="#242424"/>
      <circle class="shine" cx="${lx + 2}" cy="${cy - 2}" r="1.7" fill="#ffffff"/>
      <circle class="shine" cx="${rx + 2}" cy="${cy - 2}" r="1.7" fill="#ffffff"/>`;
  }

  // 共用：思考時冒出的「…」
  const THINK_DOTS = `
    <g class="think-dots" opacity="0">
      <circle cx="122" cy="30" r="3.2" fill="#8a8f98"/>
      <circle cx="132" cy="25" r="2.5" fill="#8a8f98"/>
      <circle cx="140" cy="21" r="1.8" fill="#8a8f98"/>
    </g>`;

  // 共用：手勢時在手邊浮現又淡出的「空中速寫」線條
  const SKETCH = `
    <g class="sketch-lines">
      <line x1="18" y1="150" x2="33" y2="146"/>
      <line x1="16" y1="156" x2="37" y2="151"/>
      <line x1="20" y1="162" x2="33" y2="159"/>
    </g>`;

  function wrap(inner) {
    return `<svg viewBox="0 0 160 180" class="char-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse class="shadow" cx="80" cy="174" rx="42" ry="6" fill="#000000" fill-opacity="0.16"/>
      ${inner}
    </svg>`;
  }

  // -------------------------------------------------------------------------
  // 1) 安藤忠雄 Tadao Ando — 預設。深灰妹妹頭＋齊瀏海、深色衣、清水混凝土方塊。
  // -------------------------------------------------------------------------
  const ando = wrap(`
    <g class="motif">
      <rect x="6" y="120" width="34" height="34" rx="2" fill="#d2d0ca" stroke="#aeaca4" stroke-width="2"/>
      <circle cx="13" cy="127" r="1.4" fill="#9d9b92"/><circle cx="33" cy="127" r="1.4" fill="#9d9b92"/>
      <circle cx="13" cy="147" r="1.4" fill="#9d9b92"/><circle cx="33" cy="147" r="1.4" fill="#9d9b92"/>
      <line x1="6" y1="137" x2="40" y2="137" stroke="#c0bdb4" stroke-width="1.2"/>
    </g>
    <g class="pet-body">
      <g class="body">
        <path d="M50 172 Q47 123 80 119 Q113 123 110 172 Z" fill="#30333a" stroke="#1f2128" stroke-width="2"/>
        <path d="M72 121 L80 134 L88 121" fill="none" stroke="#50545c" stroke-width="2"/>
      </g>
      <g class="gesture-arm">
        <path d="M55 136 Q38 150 27 156" fill="none" stroke="#30333a" stroke-width="9" stroke-linecap="round"/>
        <circle class="hand" cx="26" cy="157" r="6" fill="${SKIN}"/>
      </g>
      <g class="head">
        <ellipse cx="80" cy="60" rx="43" ry="41" fill="#4b4b4b"/>
        <ellipse class="face" cx="80" cy="66" rx="39" ry="40" fill="${SKIN}"/>
        <path d="M40 62 Q40 29 80 26 Q120 29 120 62 Q100 50 80 52 Q60 50 40 62 Z" fill="#4b4b4b"/>
        <path d="M40 60 Q36 90 45 100 L52 95 Q45 78 47 60 Z" fill="#4b4b4b"/>
        <path d="M120 60 Q124 90 115 100 L108 95 Q115 78 113 60 Z" fill="#4b4b4b"/>
        <line x1="58" y1="58" x2="71" y2="61" stroke="#3a3a3a" stroke-width="2.6" stroke-linecap="round"/>
        <line x1="102" y1="58" x2="89" y2="61" stroke="#3a3a3a" stroke-width="2.6" stroke-linecap="round"/>
        <g class="eyes">${eyes(66, 94, 70)}</g>
        <path class="mouth" d="M72 92 Q80 95 88 92" fill="none" stroke="#9a5a4a" stroke-width="2.6" stroke-linecap="round"/>
        <path class="mouth-happy" display="none" d="M70 90 Q80 100 90 90 Q80 96 70 90 Z" fill="#b5674f"/>
        ${THINK_DOTS}
      </g>
      ${SKETCH}
    </g>`);

  // -------------------------------------------------------------------------
  // 2) 法蘭克蓋瑞 Frank Gehry — 年長、蓬亂白髮、圓眼鏡、休閒開領衫、揉皺金屬片。
  // -------------------------------------------------------------------------
  const gehry = wrap(`
    <g class="motif">
      <polygon points="8,152 13,120 30,114 38,134 28,140 36,154 15,157" fill="#c7ccd2" stroke="#9aa0a8" stroke-width="1.5"/>
      <polyline points="13,120 24,132 28,140" fill="none" stroke="#aeb4bb" stroke-width="1.2"/>
      <polyline points="30,114 28,130 36,154" fill="none" stroke="#e2e6ea" stroke-width="1"/>
    </g>
    <g class="pet-body">
      <g class="body">
        <path d="M50 172 Q47 123 80 119 Q113 123 110 172 Z" fill="#cdd7e0" stroke="#9fb0bd" stroke-width="2"/>
        <path d="M74 120 L80 138 L86 120" fill="#e7edf2" stroke="#9fb0bd" stroke-width="1.5"/>
      </g>
      <g class="gesture-arm">
        <path d="M55 136 Q38 150 27 150" fill="none" stroke="#cdd7e0" stroke-width="9" stroke-linecap="round"/>
        <circle class="hand" cx="26" cy="151" r="6" fill="${SKIN}"/>
      </g>
      <g class="head">
        <g stroke="#d4d8db" stroke-width="0.8">
          <ellipse cx="80" cy="58" rx="40" ry="34" fill="#eceff1"/>
          <path d="M44 52 Q36 30 54 32 Q48 42 56 52 Z" fill="#eceff1"/>
          <path d="M60 40 Q62 24 74 32 Q68 40 72 48 Z" fill="#eceff1"/>
          <path d="M84 38 Q92 24 98 36 Q92 42 96 50 Z" fill="#eceff1"/>
          <path d="M104 46 Q118 32 118 50 Q110 48 108 56 Z" fill="#eceff1"/>
        </g>
        <ellipse class="face" cx="80" cy="66" rx="40" ry="39" fill="${SKIN}"/>
        <g class="eyes">${eyes(66, 94, 70, 5)}</g>
        <g class="glasses">
          <circle cx="66" cy="70" r="11" fill="none" stroke="#3a3a3a" stroke-width="2.2"/>
          <circle cx="94" cy="70" r="11" fill="none" stroke="#3a3a3a" stroke-width="2.2"/>
          <line x1="77" y1="70" x2="83" y2="70" stroke="#3a3a3a" stroke-width="2.2"/>
          <line x1="55" y1="68" x2="46" y2="65" stroke="#3a3a3a" stroke-width="1.8"/>
          <line x1="105" y1="68" x2="114" y2="65" stroke="#3a3a3a" stroke-width="1.8"/>
        </g>
        <path class="mouth" d="M70 90 Q80 97 90 90" fill="none" stroke="#9a5a4a" stroke-width="2.4" stroke-linecap="round"/>
        <path class="mouth-happy" display="none" d="M68 89 Q80 101 92 89 Q80 96 68 89 Z" fill="#b5674f"/>
        ${THINK_DOTS}
      </g>
      ${SKETCH}
    </g>`);

  // -------------------------------------------------------------------------
  // 3) 札哈哈迪 Zaha Hadid — 深髮、戲劇性深色裝、誇張項鍊、流動參數化曲面。
  // -------------------------------------------------------------------------
  const hadid = wrap(`
    <g class="motif">
      <path d="M116 158 Q150 140 142 104 Q138 128 120 126 Q140 140 116 158 Z" fill="#d9d2e2" stroke="#b7acc9" stroke-width="1.5"/>
      <path d="M120 150 Q142 138 138 116" fill="none" stroke="#c4b9d6" stroke-width="1.2"/>
    </g>
    <g class="pet-body">
      <g class="body">
        <path d="M48 172 Q46 122 80 118 Q114 122 112 172 Z" fill="#23232b" stroke="#141418" stroke-width="2"/>
        <path d="M66 126 Q80 141 94 126" fill="none" stroke="#c9a24a" stroke-width="1.5"/>
        <circle cx="74" cy="134" r="2.4" fill="#d9b25a"/><circle cx="80" cy="137" r="2.8" fill="#e0bd6a"/><circle cx="86" cy="134" r="2.4" fill="#d9b25a"/>
      </g>
      <g class="gesture-arm">
        <path d="M54 136 Q36 150 24 146" fill="none" stroke="#23232b" stroke-width="9" stroke-linecap="round"/>
        <circle class="hand" cx="23" cy="145" r="6" fill="${SKIN}"/>
      </g>
      <g class="head">
        <ellipse cx="80" cy="60" rx="43" ry="42" fill="#242027"/>
        <ellipse class="face" cx="80" cy="66" rx="38" ry="40" fill="${SKIN}"/>
        <path d="M40 64 Q38 28 80 26 Q122 28 120 64 Q110 44 86 46 Q70 40 40 64 Z" fill="#242027"/>
        <path d="M86 46 Q62 50 52 80 Q60 54 88 54 Z" fill="#1b181f"/>
        <path d="M58 59 Q66 55 73 59" stroke="#1a1a1a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M87 59 Q94 55 102 59" stroke="#1a1a1a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <g class="eyes">${eyes(66, 94, 70)}</g>
        <path class="mouth" d="M70 91 Q80 97 90 91 Q80 94 70 91 Z" fill="#9c3b4a"/>
        <path class="mouth-happy" display="none" d="M68 90 Q80 100 92 90 Q80 95 68 90 Z" fill="#b4475a"/>
        ${THINK_DOTS}
      </g>
      ${SKETCH}
    </g>`);

  // -------------------------------------------------------------------------
  // 4) 貝聿銘 I. M. Pei — 年長、圓框黑眼鏡、領結、溫暖笑容、玻璃金字塔。
  // -------------------------------------------------------------------------
  const pei = wrap(`
    <g class="motif">
      <polygon points="24,152 8,152 24,116 40,152" fill="#bfe0ef" fill-opacity="0.5" stroke="#86b9d0" stroke-width="1.5"/>
      <line x1="24" y1="116" x2="24" y2="152" stroke="#9fcbdd" stroke-width="1"/>
      <line x1="16" y1="134" x2="32" y2="134" stroke="#9fcbdd" stroke-width="1"/>
      <line x1="12" y1="143" x2="36" y2="143" stroke="#9fcbdd" stroke-width="1"/>
    </g>
    <g class="pet-body">
      <g class="body">
        <path d="M50 172 Q47 123 80 119 Q113 123 110 172 Z" fill="#3a4654" stroke="#273039" stroke-width="2"/>
        <path d="M74 121 L80 134 L86 121 Z" fill="#f2f2ee"/>
        <path d="M80 124 l-10 -5 v10 z" fill="#b5423c"/><path d="M80 124 l10 -5 v10 z" fill="#b5423c"/>
        <circle cx="80" cy="124" r="2.2" fill="#8f2f2b"/>
      </g>
      <g class="gesture-arm">
        <path d="M55 136 Q38 150 27 152" fill="none" stroke="#3a4654" stroke-width="9" stroke-linecap="round"/>
        <circle class="hand" cx="26" cy="153" r="6" fill="${SKIN}"/>
      </g>
      <g class="head">
        <path d="M41 70 Q39 48 54 44 Q48 60 50 74 Z" fill="#b9b9b9"/>
        <path d="M119 70 Q121 48 106 44 Q112 60 110 74 Z" fill="#b9b9b9"/>
        <ellipse class="face" cx="80" cy="66" rx="39" ry="39" fill="${SKIN}"/>
        <path d="M48 52 Q80 40 112 52 Q80 46 48 52 Z" fill="#c4c4c4"/>
        <g class="eyes">${eyes(66, 94, 70, 5)}</g>
        <g class="glasses">
          <circle cx="66" cy="70" r="12" fill="#ffffff" fill-opacity="0.15" stroke="#1e1e1e" stroke-width="2.4"/>
          <circle cx="94" cy="70" r="12" fill="#ffffff" fill-opacity="0.15" stroke="#1e1e1e" stroke-width="2.4"/>
          <line x1="78" y1="70" x2="82" y2="70" stroke="#1e1e1e" stroke-width="2.4"/>
          <line x1="54" y1="68" x2="44" y2="64" stroke="#1e1e1e" stroke-width="2"/>
          <line x1="106" y1="68" x2="116" y2="64" stroke="#1e1e1e" stroke-width="2"/>
        </g>
        <path class="mouth" d="M68 90 Q80 99 92 90" fill="none" stroke="#9a5a4a" stroke-width="2.6" stroke-linecap="round"/>
        <path class="mouth-happy" display="none" d="M66 89 Q80 102 94 89 Q80 97 66 89 Z" fill="#b5674f"/>
        ${THINK_DOTS}
      </g>
      ${SKETCH}
    </g>`);

  // -------------------------------------------------------------------------
  // 5) 雷姆庫哈斯 Rem Koolhaas — 偏高瘦、光頭、清瘦臉、黑衣、嚴肅、CCTV 懸挑環圈。
  // -------------------------------------------------------------------------
  const koolhaas = wrap(`
    <g class="motif">
      <path fill-rule="evenodd" d="M8 156 L8 118 L36 118 L36 140 L26 140 L26 130 L18 130 L18 148 L36 148 L36 156 Z" fill="#b9bdc2" stroke="#8a8f95" stroke-width="1.4"/>
    </g>
    <g class="pet-body">
      <g class="body">
        <path d="M54 172 Q52 124 80 120 Q108 124 106 172 Z" fill="#1c1c1f" stroke="#101012" stroke-width="2"/>
        <path d="M74 122 L80 134 L86 122" fill="none" stroke="#39393d" stroke-width="1.5"/>
      </g>
      <g class="gesture-arm">
        <path d="M57 138 Q40 150 30 150" fill="none" stroke="#1c1c1f" stroke-width="8.5" stroke-linecap="round"/>
        <circle class="hand" cx="29" cy="151" r="5.5" fill="${SKIN}"/>
      </g>
      <g class="head">
        <ellipse class="face" cx="80" cy="64" rx="35" ry="40" fill="${SKIN}"/>
        <path d="M47 50 Q52 40 60 38" fill="none" stroke="#e7cbab" stroke-width="2" opacity="0.6"/>
        <path d="M113 50 Q108 40 100 38" fill="none" stroke="#e7cbab" stroke-width="2" opacity="0.6"/>
        <path d="M60 80 Q62 88 66 92" fill="none" stroke="#dcb892" stroke-width="1.4" opacity="0.7"/>
        <path d="M100 80 Q98 88 94 92" fill="none" stroke="#dcb892" stroke-width="1.4" opacity="0.7"/>
        <line x1="58" y1="58" x2="70" y2="58" stroke="#5b5b5b" stroke-width="2.4" stroke-linecap="round"/>
        <line x1="90" y1="58" x2="102" y2="58" stroke="#5b5b5b" stroke-width="2.4" stroke-linecap="round"/>
        <g class="eyes">${eyes(66, 94, 68, 5)}</g>
        <path class="mouth" d="M70 88 L90 88" fill="none" stroke="#8a5346" stroke-width="2.4" stroke-linecap="round"/>
        <path class="mouth-happy" display="none" d="M72 88 Q80 94 88 88" fill="none" stroke="#8a5346" stroke-width="2.4" stroke-linecap="round"/>
        ${THINK_DOTS}
      </g>
      ${SKETCH}
    </g>`);

  // -------------------------------------------------------------------------
  // 6) 妹島和世 Kazuyo Sejima — 俐落黑短髮齊瀏海、極簡黑白衣、纖細五官、輕薄白色曲面涼棚。
  // -------------------------------------------------------------------------
  const sejima = wrap(`
    <g class="motif">
      <path d="M4 152 Q26 122 48 152 L43 152 Q26 130 9 152 Z" fill="#f7f7f7" stroke="#8d8d8d" stroke-width="1.6"/>
      <line x1="10" y1="150" x2="10" y2="160" stroke="#a3a3a3" stroke-width="1.5"/>
      <line x1="26" y1="128" x2="26" y2="160" stroke="#a3a3a3" stroke-width="1.5"/>
      <line x1="42" y1="150" x2="42" y2="160" stroke="#a3a3a3" stroke-width="1.5"/>
    </g>
    <g class="pet-body">
      <g class="body">
        <path d="M50 172 Q48 124 80 120 Q112 124 110 172 Z" fill="#f4f4f4" stroke="#cfcfcf" stroke-width="2"/>
        <path d="M72 122 L80 132 L88 122" fill="none" stroke="#cfcfcf" stroke-width="1.5"/>
      </g>
      <g class="gesture-arm">
        <path d="M54 138 Q38 150 28 150" fill="none" stroke="#f4f4f4" stroke-width="8.5" stroke-linecap="round"/>
        <circle class="hand" cx="27" cy="151" r="5.5" fill="${SKIN}"/>
      </g>
      <g class="head">
        <ellipse cx="80" cy="58" rx="42" ry="40" fill="#1e1e1e"/>
        <ellipse class="face" cx="80" cy="66" rx="36" ry="39" fill="${SKIN}"/>
        <path d="M39 60 Q40 30 80 27 Q120 30 121 60 Q100 52 80 54 Q60 52 39 60 Z" fill="#1e1e1e"/>
        <path d="M39 58 L39 96 Q45 100 50 96 L50 58 Z" fill="#1e1e1e"/>
        <path d="M121 58 L121 96 Q115 100 110 96 L110 58 Z" fill="#1e1e1e"/>
        <line x1="60" y1="60" x2="72" y2="60" stroke="#2a2a2a" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="100" y1="60" x2="88" y2="60" stroke="#2a2a2a" stroke-width="1.8" stroke-linecap="round"/>
        <g class="eyes">${eyes(67, 93, 70, 5)}</g>
        <path class="mouth" d="M74 90 Q80 94 86 90" fill="none" stroke="#b07a6a" stroke-width="2.2" stroke-linecap="round"/>
        <path class="mouth-happy" display="none" d="M72 90 Q80 97 88 90" fill="none" stroke="#b07a6a" stroke-width="2.4" stroke-linecap="round"/>
        ${THINK_DOTS}
      </g>
      ${SKETCH}
    </g>`);

  // -------------------------------------------------------------------------
  // 角色資料（含繁中名、英文名、原創語氣問候語、SVG）
  // 問候語為「致敬語氣」的原創句，非引用任何名言。
  // -------------------------------------------------------------------------
  const CHARACTERS = {
    ando: {
      id: 'ando', nameZh: '安藤忠雄', nameEn: 'Tadao Ando',
      greeting: '少一點，留白多一點，讓光與混凝土自己說話。',
      svg: ando
    },
    gehry: {
      id: 'gehry', nameZh: '法蘭克蓋瑞', nameEn: 'Frank Gehry',
      greeting: '要不要把它揉皺看看？說不定更有意思。',
      svg: gehry
    },
    hadid: {
      id: 'hadid', nameZh: '札哈哈迪', nameEn: 'Zaha Hadid',
      greeting: '線條不必停下，讓形體繼續流動。',
      svg: hadid
    },
    pei: {
      id: 'pei', nameZh: '貝聿銘', nameEn: 'I. M. Pei',
      greeting: '幾何與光，安放得當，自然就美了。',
      svg: pei
    },
    koolhaas: {
      id: 'koolhaas', nameZh: '雷姆庫哈斯', nameEn: 'Rem Koolhaas',
      greeting: '城市本身就是最大的提案，你準備好了嗎？',
      svg: koolhaas
    },
    sejima: {
      id: 'sejima', nameZh: '妹島和世', nameEn: 'Kazuyo Sejima',
      greeting: '輕一點、薄一點，幾乎要透明了。',
      svg: sejima
    }
  };

  const ORDER = ['ando', 'gehry', 'hadid', 'pei', 'koolhaas', 'sejima'];
  const DEFAULT_ID = 'ando';

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
