// 短尾矮袋鼠「庫卡」的角色資料：名稱、問候語、動作清單、台詞、AI 人格與造型。
// 造型由 quokka-art.js 產生（十六方位＋分層正面）；此檔不含繪圖細節。
//
// 資料結構保留「角色表」的形式（CHARACTERS / ORDER / DEFAULT_ID）。
// 此檔同時供 renderer（window.CHARACTERS）與主行程（module.exports）使用。

(function () {
  const ART = (typeof window !== 'undefined' && window.QuokkaArt) ? window.QuokkaArt
    : (typeof require === 'function' ? require('./quokka-art.js') : null);

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
      // 正面造型（面板縮圖用）與十六方位（桌寵用）；用 getter 延後產生，主行程用不到就不產生
      get svg() { return ART ? ART.views().front : ''; },
      get views() { return ART ? ART.views() : {}; }
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
