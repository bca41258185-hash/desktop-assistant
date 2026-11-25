// 短尾矮袋鼠「庫卡」的造型資料（純 inline SVG，無任何外部圖檔／字型）。
//
// 動畫類別（由 pet.css 驅動）：
//   .pet-body（呼吸）、.eye（眨眼）、.gesture-arm（待機揮手）、.head（思考時傾頭）、
//   .mouth / .mouth-happy（換嘴）、.think-dots（思考點點）、.motif（腳邊的球）、
//   .arm-r / .racket / .arms-bump / .hoop / .ball（運動道具，預設隱藏）。
//
// 資料結構保留「角色表」的形式（CHARACTERS / ORDER / DEFAULT_ID），日後要加新造型只需多一筆。
// 此檔同時供 renderer（window.CHARACTERS）與主行程（module.exports）使用。

(function () {
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

  function wrap(inner) {
    return `<svg viewBox="0 0 160 180" class="char-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse class="shadow" cx="80" cy="174" rx="42" ry="6" fill="#000000" fill-opacity="0.16"/>
      ${inner}
    </svg>`;
  }

  // -------------------------------------------------------------------------
  // 短尾矮袋鼠「庫卡」Quokka — 圓耳、招牌微笑、紅色運動頭帶；會打羽球／排球／籃球。
  //    運動道具（球拍、球、籃框、墊球手臂）以 display="none" 預設隱藏（面板縮圖與預覽頁也因此不會露出），
//    只有桌寵視窗的 pet.css 會依 data-pose 顯示並播放動畫。
  //    球類以「外層 X 位移＋內層 Y 位移」兩層群組組成拋物線，圖形皆以 (0,0) 為中心繪製。
  // -------------------------------------------------------------------------
  const FUR = '#b48c62', FUR_D = '#8c6844', FUR_L = '#eedcbc';
  const quokka = wrap(`
    <g class="motif">
      <circle cx="20" cy="163" r="9" fill="#e58a3a" stroke="#7a3d12" stroke-width="1.4"/>
      <path d="M11 163 H29 M20 154 V172" stroke="#7a3d12" stroke-width="1.1" fill="none"/>
      <path d="M33 169 L38 158 L45 163 Z" fill="#ffffff" stroke="#9aa0a8" stroke-width="1"/>
      <circle cx="34" cy="169" r="3" fill="#ffffff" stroke="#d2493a" stroke-width="1.4"/>
    </g>
    <g class="hoop" display="none">
      <line x1="188" y1="60" x2="188" y2="174" stroke="#8a8f98" stroke-width="3" stroke-linecap="round"/>
      <rect x="185" y="20" width="5" height="44" rx="1.5" fill="#ffffff" stroke="#8a8f98" stroke-width="1.5"/>
      <path d="M161 53 L165 70 M168 55 L169 71 M176 55 L175 71 M183 53 L179 70 M164 62 H180" stroke="#c9ccd1" stroke-width="1.2" fill="none"/>
      <ellipse cx="172" cy="52" rx="12" ry="3.5" fill="none" stroke="#e2622b" stroke-width="2.6"/>
    </g>
    <g class="pet-body">
      <path class="tail" d="M102 150 Q130 150 140 168 Q122 174 100 170 Z" fill="${FUR_D}"/>
      <g class="body">
        <path d="M52 170 Q42 112 80 102 Q118 112 108 170 Z" fill="${FUR}" stroke="${FUR_D}" stroke-width="2"/>
        <ellipse cx="80" cy="148" rx="19" ry="22" fill="${FUR_L}"/>
        <ellipse cx="62" cy="171" rx="14" ry="6" fill="${FUR_D}"/>
        <ellipse cx="98" cy="171" rx="14" ry="6" fill="${FUR_D}"/>
      </g>
      <g class="arm-r">
        <g class="racket" display="none">
          <line x1="122" y1="152" x2="145" y2="175" stroke="#3f4650" stroke-width="3.2" stroke-linecap="round"/>
          <g transform="rotate(-45 153.5 183.5)">
            <ellipse cx="153.5" cy="183.5" rx="10" ry="13" fill="#ffffff" fill-opacity=".55" stroke="#2f7fbf" stroke-width="2.4"/>
            <path d="M147 176 V191 M153.5 171 V196 M160 176 V191 M144.5 179 H162.5 M143.6 185 H163.4 M145 190 H162" stroke="#9db7cc" stroke-width=".8" fill="none"/>
          </g>
        </g>
        <path d="M102 132 L122 152" fill="none" stroke="${FUR}" stroke-width="10" stroke-linecap="round"/>
        <circle class="hand" cx="122" cy="152" r="6" fill="${FUR_D}"/>
      </g>
      <g class="gesture-arm arm-l">
        <path d="M58 132 L38 152" fill="none" stroke="${FUR}" stroke-width="10" stroke-linecap="round"/>
        <circle class="hand" cx="38" cy="152" r="6" fill="${FUR_D}"/>
      </g>
      <g class="arms-bump" display="none">
        <path d="M100 134 Q70 152 38 142" fill="none" stroke="${FUR}" stroke-width="10" stroke-linecap="round"/>
        <path d="M58 132 L36 141" fill="none" stroke="${FUR}" stroke-width="10" stroke-linecap="round"/>
        <ellipse class="hand" cx="34" cy="141" rx="8" ry="6" fill="${FUR_D}"/>
      </g>
      <g class="head">
        <circle cx="50" cy="42" r="13" fill="${FUR}" stroke="${FUR_D}" stroke-width="2"/>
        <circle cx="110" cy="42" r="13" fill="${FUR}" stroke="${FUR_D}" stroke-width="2"/>
        <circle cx="50" cy="43" r="7" fill="#d9a58c"/><circle cx="110" cy="43" r="7" fill="#d9a58c"/>
        <ellipse class="face" cx="80" cy="72" rx="40" ry="36" fill="${FUR}" stroke="${FUR_D}" stroke-width="2"/>
        <path class="headband" d="M45 60 Q80 46 115 60 L112 51 Q80 38 48 51 Z" fill="#e5533d" stroke="#b83c2a" stroke-width="1.2" stroke-linejoin="round"/>
        <ellipse cx="80" cy="89" rx="22" ry="15" fill="${FUR_L}"/>
        <ellipse cx="55" cy="87" rx="6" ry="3.6" fill="#f0a08c" opacity=".55"/><ellipse cx="105" cy="87" rx="6" ry="3.6" fill="#f0a08c" opacity=".55"/>
        ${eyes(64, 96, 71, 5)}
        <ellipse cx="80" cy="81" rx="7.5" ry="5.5" fill="#3b2a22"/><ellipse cx="78" cy="79.5" rx="2.2" ry="1.3" fill="#ffffff" opacity=".7"/>
        <path class="mouth" d="M80 86 V91 M67 90 Q80 101 93 90" fill="none" stroke="#3b2a22" stroke-width="2.2" stroke-linecap="round"/>
        <g class="mouth-happy" display="none">
          <path d="M66 89 Q80 109 94 89 Z" fill="#7a3b34" stroke="#3b2a22" stroke-width="2" stroke-linejoin="round"/>
          <path d="M74 98 Q80 104 86 98 Q80 95 74 98 Z" fill="#f08a8a"/>
        </g>
        ${THINK_DOTS}
      </g>
    </g>
    <g class="ball ball-vb" display="none"><g class="bx"><g class="by"><g class="spin">
      <circle r="11" fill="#fdfdfb" stroke="#8a8f98" stroke-width="1.5"/>
      <path d="M-11 0 Q0 -6 11 0 M-7 -8.5 Q2 -2 3 10.6 M7 -8.5 Q5 2 -6 9.2" fill="none" stroke="#e0b23c" stroke-width="1.4"/>
    </g></g></g></g>
    <g class="ball ball-bb" display="none"><g class="bx"><g class="by"><g class="spin">
      <circle r="11" fill="#e58a3a" stroke="#7a3d12" stroke-width="1.5"/>
      <path d="M-11 0 H11 M0 -11 V11 M-8 -7.5 Q-2 0 -8 7.5 M8 -7.5 Q2 0 8 7.5" fill="none" stroke="#7a3d12" stroke-width="1.2"/>
    </g></g></g></g>
    <g class="ball shuttle" display="none"><g class="bx"><g class="by"><g class="spin">
      <path d="M-2 2 L9 -3 L3 -9 Z" fill="#ffffff" stroke="#9aa0a8" stroke-width="1" stroke-linejoin="round"/>
      <path d="M-2 2 L6 -6" stroke="#c9ccd1" stroke-width=".8"/>
      <circle cx="-3.5" cy="3.5" r="3.4" fill="#ffffff" stroke="#d2493a" stroke-width="1.5"/>
    </g></g></g></g>`);


  // -------------------------------------------------------------------------
  // 角色資料（名稱、問候語、運動清單、AI 人格、語錄分頁文字、SVG）
  // -------------------------------------------------------------------------
  const CHARACTERS = {
    quokka: {
      id: 'quokka', nameZh: '短尾矮袋鼠', nameEn: 'Quokka', callName: '庫卡',
      greeting: '嗨，我是庫卡！今天也笑著把事情做完，等等一起打球吧。',
      cheer: '完成一項，得分！',
      // 會的運動（對應 pet.css 的 data-pose）與打完後的一句話
      sports: ['badminton', 'volleyball', 'basketball'],
      sportNames: { badminton: '羽球', volleyball: '排球', basketball: '籃球' },
      sportLines: { badminton: '殺球成功！', volleyball: '這球接得漂亮！', basketball: '進球，兩分！' },
      // AI 聊天人格
      persona:
        '你是「庫卡」，一隻住在使用者桌面上的短尾矮袋鼠（quokka），個性開朗、愛笑，' +
        '最喜歡打羽球、排球和籃球。請一律使用繁體中文，語氣溫暖、簡短、有精神，' +
        '偶爾可以用球場上的比喻替使用者打氣，但回答問題時仍要具體、正確、有條理，不要為了可愛而犧牲內容。',
      quoteTitle: '庫卡語錄',
      quoteHint: '以下是庫卡的原創球場打氣語，以及幾則短尾矮袋鼠的生態小知識；並非引用任何名人名言。',
      speakLabel: '讓庫卡說這句',
      svg: quokka
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
