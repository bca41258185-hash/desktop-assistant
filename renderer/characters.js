// 角色登錄中心：內建六位普立茲克建築大師，並載入其他職業的角色包（如哲學家）。
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
        <path d="M39 55 Q39 24 80 23 Q121 24 121 55 L117 83 L43 83 Z" fill="#373839"/>
        <path class="face" d="M44 51 L116 51 L114 83 Q113 99 100 105 L60 105 Q47 99 46 83 Z" fill="${SKIN}"/>
        <path d="M40 57 L40 48 Q42 23 80 23 Q118 23 120 48 L120 57 L112 56 L112 62 L101 59 L94 61 L86 59 L78 61 L70 59 L62 61 L54 59 L48 62 L48 57 Z" fill="#373839"/>
        <path d="M47 42 Q77 28 110 39" fill="none" stroke="#626262" stroke-width="2" opacity=".6"/>
        <path d="M55 66 L71 68 M89 68 L105 66" stroke="#333" stroke-width="3" stroke-linecap="round"/>
        <ellipse class="eye" cx="64" cy="74" rx="4.5" ry="2.8" fill="#242424"/><ellipse class="eye" cx="96" cy="74" rx="4.5" ry="2.8" fill="#242424"/>
        <circle class="shine" cx="65" cy="73" r="1" fill="white"/><circle class="shine" cx="97" cy="73" r="1" fill="white"/>
        <path d="M80 73 L77 85 L83 86" fill="none" stroke="#c69879" stroke-width="1.5"/>
        <path class="mouth" d="M70 96 Q80 93 90 96" fill="none" stroke="#87564c" stroke-width="2.3" stroke-linecap="round"/>
        <path class="mouth-happy" display="none" d="M70 94 Q80 101 90 94" fill="none" stroke="#87564c" stroke-width="2.5" stroke-linecap="round"/>
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
        <path d="M50 172 Q47 123 80 119 Q113 123 110 172 Z" fill="#30373b" stroke="#222a2e" stroke-width="2"/>
        <path d="M74 120 L80 138 L86 120" fill="#596166" stroke="#222a2e" stroke-width="1.5"/>
      </g>
      <g class="gesture-arm">
        <path d="M55 136 Q38 150 27 150" fill="none" stroke="#30373b" stroke-width="9" stroke-linecap="round"/>
        <circle class="hand" cx="26" cy="151" r="6" fill="${SKIN}"/>
      </g>
      <g class="head">
        <path d="M42 64 Q33 59 37 50 Q31 43 40 39 Q37 30 48 32 Q48 25 57 29 L59 75 L43 91 Q35 88 39 79 Q33 72 42 64 Z M118 64 Q127 59 123 50 Q129 43 120 39 Q123 30 112 32 Q112 25 103 29 L101 75 L117 91 Q125 88 121 79 Q127 72 118 64 Z" fill="#edf0ef" stroke="#d1d6d5" stroke-width="1.5"/>
        <path class="face" d="M48 55 Q48 26 80 25 Q112 26 112 55 Q120 66 116 81 Q115 97 103 101 Q94 110 80 108 Q66 110 57 101 Q45 97 44 81 Q40 66 48 55 Z" fill="${SKIN}"/>
        <path d="M53 43 Q80 36 107 43 M58 48 Q80 44 102 48" fill="none" stroke="#d4ab8f" stroke-width="1.2"/>
        <path d="M48 57 Q43 45 47 37 M112 57 Q117 45 113 37" fill="none" stroke="#fafafa" stroke-width="5" stroke-linecap="round"/>
        <path d="M55 82 Q56 94 64 96 M105 82 Q104 94 96 96" fill="none" stroke="#d5a98c" stroke-width="1.6"/>
        <ellipse class="eye" cx="65" cy="70" rx="4" ry="3.4" fill="#242424"/><ellipse class="eye" cx="95" cy="70" rx="4" ry="3.4" fill="#242424"/>
        <circle class="shine" cx="66" cy="69" r="1.1" fill="white"/><circle class="shine" cx="96" cy="69" r="1.1" fill="white"/>
        <g class="glasses" fill="none" stroke="#555b60" stroke-width="1.7"><circle cx="65" cy="70" r="12"/><circle cx="95" cy="70" r="12"/><path d="M77 69 Q80 66 83 69 M53 68 L45 65 M107 68 L115 65"/></g>
        <path d="M79 73 Q75 83 81 84" fill="none" stroke="#c99b7f" stroke-width="1.5"/>
        <path class="mouth" d="M65 90 Q80 105 95 90 Q80 96 65 90 Z" fill="#92564b"/><path class="mouth" d="M69 92 Q80 97 91 92" fill="none" stroke="#fff9ed" stroke-width="2.5"/>
        <path class="mouth-happy" display="none" d="M62 88 Q80 110 98 88 Q80 98 62 88 Z" fill="#9b514a"/>
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
        <path d="M53 145 L101 128 M51 155 L106 135 M58 171 L110 145" fill="none" stroke="#51505b" stroke-width="2"/><path d="M66 126 Q80 141 94 126" fill="none" stroke="#c9a24a" stroke-width="1.5"/>
        <circle cx="74" cy="134" r="2.4" fill="#d9b25a"/><circle cx="80" cy="137" r="2.8" fill="#e0bd6a"/><circle cx="86" cy="134" r="2.4" fill="#d9b25a"/>
      </g>
      <g class="gesture-arm">
        <path d="M54 136 Q36 150 24 146" fill="none" stroke="#23232b" stroke-width="9" stroke-linecap="round"/>
        <circle class="hand" cx="23" cy="145" r="6" fill="${SKIN}"/>
      </g>
      <g class="head">
        <path d="M36 91 Q28 72 35 49 Q38 20 68 20 Q83 13 96 22 Q123 21 127 51 Q135 75 123 101 L107 108 L49 108 Z" fill="#242027"/>
        <path class="face" d="M49 49 Q55 34 80 34 Q103 32 112 52 L109 81 Q106 98 91 104 L80 107 L68 104 Q52 97 49 81 Z" fill="${SKIN}"/>
        <path d="M44 62 Q40 35 60 25 Q75 17 85 26 Q107 19 118 42 Q122 53 117 70 Q110 49 96 43 Q77 36 49 56 L48 91 Q39 83 44 62 Z" fill="#242027"/>
        <path d="M96 29 Q111 33 115 51 M47 53 Q50 37 64 31" fill="none" stroke="#51434f" stroke-width="2"/>
        <path d="M55 63 Q64 57 73 62 M87 62 Q96 57 105 62" fill="none" stroke="#2a2023" stroke-width="2.5"/>
        <path d="M54 70 Q64 62 74 70 M86 70 Q96 62 106 70 M55 70 L51 66 M105 70 L109 66" fill="none" stroke="#211b21" stroke-width="2.5" stroke-linecap="round"/>
        <ellipse class="eye" cx="64" cy="71" rx="5" ry="5.5" fill="#242024"/><ellipse class="eye" cx="96" cy="71" rx="5" ry="5.5" fill="#242024"/>
        <circle class="shine" cx="65.5" cy="69" r="1.5" fill="white"/><circle class="shine" cx="97.5" cy="69" r="1.5" fill="white"/>
        <path d="M80 72 L77 85 Q80 87 83 85" fill="none" stroke="#c28f76" stroke-width="1.5"/>
        <path class="mouth" d="M69 94 Q75 89 80 92 Q85 89 91 94 Q80 99 69 94 Z" fill="#9c3547"/>
        <path class="mouth-happy" display="none" d="M67 92 Q80 104 93 92 Q80 97 67 92 Z" fill="#ad3d50"/>
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
        <path d="M48 59 Q46 31 59 28 Q70 21 80 24 Q102 21 111 37 L112 61 Z" fill="#aeb2b2"/>
        <path class="face" d="M51 48 Q54 27 80 27 Q106 27 109 48 L108 78 Q107 96 97 104 Q90 110 80 110 Q70 110 63 104 Q53 96 52 78 Z" fill="${SKIN}"/>
        <path d="M51 52 Q49 37 57 31 Q64 24 78 26 Q65 29 61 38 Q72 30 91 29 Q102 30 108 39 L108 52 Q104 41 101 39 Q80 34 58 43 L55 53 Z" fill="#b6baba"/>
        <path d="M58 35 Q72 27 92 29 M58 39 Q76 31 96 32" fill="none" stroke="#e3e4e1" stroke-width="1.2"/>
        <ellipse class="eye" cx="66" cy="70" rx="3.5" ry="3.4" fill="#242424"/><ellipse class="eye" cx="94" cy="70" rx="3.5" ry="3.4" fill="#242424"/>
        <circle class="shine" cx="67" cy="69" r="1" fill="white"/><circle class="shine" cx="95" cy="69" r="1" fill="white"/>
        <g class="glasses" fill="none" stroke="#1d1e20" stroke-width="3.6"><circle cx="65" cy="70" r="13.5"/><circle cx="95" cy="70" r="13.5"/><path d="M78.5 69 Q80 67 81.5 69 M51.5 68 L48 66 M108.5 68 L112 66"/></g>
        <path d="M79 73 L77 83 L82 84" fill="none" stroke="#c89b7e" stroke-width="1.4"/>
        <path class="mouth" d="M65 91 Q80 104 95 91 Q80 96 65 91 Z" fill="#99594c"/><path class="mouth" d="M69 92 Q80 96 91 92" fill="none" stroke="#fff9ee" stroke-width="2"/>
        <path class="mouth-happy" display="none" d="M62 89 Q80 109 98 89 Q80 97 62 89 Z" fill="#a85b4e"/>
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
        <path d="M61 172 L61 131 Q62 118 80 116 Q98 118 99 131 L99 172 Z" fill="#1c1c1f" stroke="#101012" stroke-width="2"/>
        <path d="M74 122 L80 134 L86 122" fill="none" stroke="#39393d" stroke-width="1.5"/>
      </g>
      <g class="gesture-arm">
        <path d="M57 138 Q40 150 30 150" fill="none" stroke="#1c1c1f" stroke-width="8.5" stroke-linecap="round"/>
        <circle class="hand" cx="29" cy="151" r="5.5" fill="${SKIN}"/>
      </g>
      <g class="head">
        <path class="face" d="M52 48 Q52 17 80 16 Q108 17 108 48 L106 74 Q105 87 99 92 L95 103 Q90 111 80 113 Q70 111 65 103 L61 92 Q55 87 54 74 Z" fill="${SKIN}"/>
        <path d="M58 77 L67 82 L63 88 M102 77 L93 82 L97 88" fill="none" stroke="#cda687" stroke-width="1.8"/>
        <path d="M59 59 Q66 56 73 60 M87 60 Q94 56 101 59" fill="none" stroke="#65564e" stroke-width="2.6"/>
        <path d="M59 67 Q66 63 73 67 M87 67 Q94 63 101 67" fill="none" stroke="#a9806d" stroke-width="1.6"/>
        <ellipse class="eye" cx="66" cy="68" rx="3.6" ry="2.8" fill="#242424"/><ellipse class="eye" cx="94" cy="68" rx="3.6" ry="2.8" fill="#242424"/>
        <circle class="shine" cx="67" cy="67" r=".9" fill="white"/><circle class="shine" cx="95" cy="67" r=".9" fill="white"/>
        <path d="M80 69 L76 84 L82 85" fill="none" stroke="#bd947b" stroke-width="1.8"/>
        <path class="mouth" d="M71 96 L89 96" fill="none" stroke="#805b50" stroke-width="2" stroke-linecap="round"/>
        <path class="mouth-happy" display="none" d="M71 95 Q80 100 89 95" fill="none" stroke="#805b50" stroke-width="2" stroke-linecap="round"/>
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
        <path d="M46 172 L49 137 Q50 123 70 120 L90 120 Q110 123 111 137 L114 172 Z" fill="#f4f4f4" stroke="#cfcfcf" stroke-width="2"/>
        <path d="M72 122 L80 132 L88 122" fill="none" stroke="#cfcfcf" stroke-width="1.5"/>
      </g>
      <g class="gesture-arm">
        <path d="M54 138 Q38 150 28 150" fill="none" stroke="#f4f4f4" stroke-width="8.5" stroke-linecap="round"/>
        <circle class="hand" cx="27" cy="151" r="5.5" fill="${SKIN}"/>
      </g>
      <g class="head">
        <path d="M47 55 Q47 23 80 23 Q113 23 113 55 L113 101 L101 104 L59 104 L47 101 Z" fill="#1e1e20"/>
        <path class="face" d="M56 51 L104 51 L103 80 Q101 98 80 103 Q59 98 57 80 Z" fill="${SKIN}"/>
        <path d="M48 54 Q48 24 80 24 Q112 24 112 54 L104 55 L104 58 L56 58 L56 55 Z" fill="#1e1e20"/>
        <path d="M47 53 L56 53 L56 101 L47 100 Z M104 53 L113 53 L113 100 L104 101 Z" fill="#1e1e20"/>
        <path d="M59 65 L71 65 M89 65 L101 65" stroke="#39302e" stroke-width="1.5" stroke-linecap="round"/>
        <ellipse class="eye" cx="65" cy="72" rx="3.2" ry="3.5" fill="#242424"/><ellipse class="eye" cx="95" cy="72" rx="3.2" ry="3.5" fill="#242424"/>
        <circle class="shine" cx="66" cy="71" r=".9" fill="white"/><circle class="shine" cx="96" cy="71" r=".9" fill="white"/>
        <path d="M80 73 L78 82 L81 83" fill="none" stroke="#cea58b" stroke-width="1.2"/>
        <path class="mouth" d="M76 91 L84 91" fill="none" stroke="#a96f64" stroke-width="1.7" stroke-linecap="round"/>
        <path class="mouth-happy" display="none" d="M74 90 Q80 95 86 90" fill="none" stroke="#a96f64" stroke-width="1.9" stroke-linecap="round"/>
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

  // -------------------------------------------------------------------------
  // 職業分類（類別）與角色包
  //  - 建築大師為本檔內建；其他職業以「角色包」檔案擴充（例：characters-philosophers.js）。
  //  - 每個類別帶 persona / style，供主行程組 AI 系統提示用。
  // -------------------------------------------------------------------------
  Object.values(CHARACTERS).forEach((c) => { c.category = 'architect'; });

  const CATEGORIES = [{
    id: 'architect',
    label: '建築大師',
    persona: '一位沉穩、有涵養的建築工作室導師',
    style: '像一位受人敬重的建築前輩，給予簡潔、到位而帶有工作室氣息的回應',
    order: ['ando', 'gehry', 'hadid', 'pei', 'koolhaas', 'sejima']
  }];

  const helpers = { SKIN, wrap, eyes, THINK_DOTS, SKETCH };
  let packs = [];
  if (typeof window !== 'undefined' && Array.isArray(window.CHAR_PACKS)) {
    packs = window.CHAR_PACKS;
  } else if (typeof require === 'function') {
    packs = [require('./characters-philosophers')];
  }
  packs.forEach((factory) => {
    const p = factory(helpers);
    Object.values(p.characters).forEach((c) => {
      if (CHARACTERS[c.id]) throw new Error('角色 id 重複：' + c.id);
      c.category = p.category.id;
      CHARACTERS[c.id] = c;
    });
    CATEGORIES.push(Object.assign({}, p.category, { order: p.order }));
  });

  // -------------------------------------------------------------------------
  // 目前開放的角色。其他角色先「封存」：造型、名言、台詞都留著，只是不出現在選單裡。
  // 要重新開放某位角色，把他的 id 加回 ACTIVE_IDS 即可。
  // -------------------------------------------------------------------------
  const ACTIVE_IDS = ['zhuangzi', 'laozi', 'mozi', 'hanfeizi', 'guiguzi', 'confucius'];
  const ALL_CATEGORIES = CATEGORIES.slice();
  ALL_CATEGORIES.forEach((cat) => {
    cat.archivedOrder = cat.order.filter((id) => !ACTIVE_IDS.includes(id));
    cat.order = cat.order.filter((id) => ACTIVE_IDS.includes(id));
  });
  // 選單只列出還有開放角色的類別
  const VISIBLE_CATEGORIES = ALL_CATEGORIES.filter((cat) => cat.order.length > 0);

  const ORDER = VISIBLE_CATEGORIES.flatMap((cat) => cat.order);
  const DEFAULT_ID = ORDER[0];

  function categoryOf(id) {
    const c = CHARACTERS[id];
    return ALL_CATEGORIES.find((cat) => c && cat.id === c.category) || ALL_CATEGORIES[0];
  }

  const api = { CHARACTERS, ORDER, DEFAULT_ID, CATEGORIES: VISIBLE_CATEGORIES, categoryOf };

  if (typeof window !== 'undefined') {
    window.CHARACTERS = CHARACTERS;
    window.CHAR_ORDER = ORDER;
    window.CHAR_DEFAULT = DEFAULT_ID;
    window.CHAR_CATEGORIES = VISIBLE_CATEGORIES;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
