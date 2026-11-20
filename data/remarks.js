// 角色在「Claude 進行中」時發表的看法。
//
// 這些是依人物思想與典故寫的「原創台詞」，不是真實引言（真實引言在 quotes*.json，並附出處）。
// 每位角色依 Claude 當下在做的事有不同說法，每種情況有好幾句輪流說：
//   edit ＝ 正在改／寫檔案（{x} 會換成檔名）
//   run  ＝ 正在電腦上執行指令
//   look ＝ 正在讀檔、搜尋、上網查資料
//   long ＝ 這一回合已經做了好一陣子
//   any  ＝ 其他情況
//
// 目前只開放莊子、老子、墨子三位（見 renderer/characters.js 的 ACTIVE_IDS）。
// 其他角色先前寫好的台詞封存在 remarks-archived.json，重新開放角色時搬回這裡並補成多句即可。
// 這裡沒有台詞的角色不會發表看法。

const REMARKS = {
  // 莊子：逍遙、齊物、愛說寓言——庖丁解牛、無用之用、魚之樂、大鵬、井蛙、得魚忘筌
  zhuangzi: {
    edit: [
      '「{x}」在改。像庖丁解牛，順著紋理下刀就不費力。',
      '「{x}」換了個樣子。是它變了，還是我們看它的眼光變了？',
      '改「{x}」啊。別硬拗，硬砍的刀很快就鈍了。'
    ],
    run: [
      '跑起來了。魚在水裡游，你怎麼知道它不快樂？',
      '讓它跑。大鵬起飛，也要等六月的大風。',
      '試試看吧。朝三暮四還是朝四暮三，跑了才知道有沒有差。'
    ],
    look: [
      '在翻資料。井裡的青蛙，要先跳出來才知道天有多大。',
      '多看看也好。看起來沒用的東西，說不定最有用。',
      '查歸查，別被字困住。抓到魚，就可以把竹簍忘了。'
    ],
    long: [
      '還沒好？那就當作在大樹下睡個午覺。',
      '做了好久。沒關係，急著成材的樹最先被砍。'
    ],
    any: [
      '放輕鬆，路比你想的寬。',
      '這件事成也好、不成也好，天又不會塌下來。',
      '別太用力。順著做，反而走得遠。'
    ]
  },

  // 老子：無為、柔弱勝剛強、上善若水、少則得、大器晚成、治大國若烹小鮮
  laozi: {
    edit: [
      '「{x}」在改。改得少，常常改得好。',
      '動「{x}」要像煎小魚，翻太多次就碎了。',
      '「{x}」先從最簡單的地方下手。難的事，都是從容易的地方做起。'
    ],
    run: [
      '讓它自己跑，別去攪它。',
      '跑吧。水不爭先，最後還是流到了海。',
      '試一步看看。千里的路，也是從腳下這一步開始。'
    ],
    look: [
      '看的時候別急著下結論，留一點空。',
      '資料越多越容易迷路。抓住少數幾樣就夠了。',
      '先知道自己不知道什麼，這樣才查得到東西。'
    ],
    long: [
      '久了？大器晚成，不必催。',
      '慢慢來。硬撐的東西容易斷，柔軟的反而撐得久。'
    ],
    any: [
      '少做一點，事情反而順。',
      '知道什麼時候該停，就不會出錯。',
      '不搶著做完，事情自己會到位。'
    ]
  },

  // 墨子：兼愛、節用、重實用與標準（三表法）、工匠出身、言必有用
  mozi: {
    edit: [
      '「{x}」在改。改之前，標準先講清楚了沒？',
      '改「{x}」可以，但多出來又沒用的，就省掉。',
      '「{x}」這樣改，對用的人有沒有好處？有，就值得。'
    ],
    run: [
      '好，用結果說話，行不行一試便知。',
      '跑一次、驗一次。木匠也是拿尺量過才下鋸。',
      '光說沒用，做出來能用才算數。'
    ],
    look: [
      '查清楚再動手，白做的工最浪費。',
      '看資料要問三件事：有沒有根據、合不合實情、用起來有沒有好處。',
      '先看別人怎麼做成的，再想我們怎麼做得更省。'
    ],
    long: [
      '做得久沒關係，只要每一步都有用。',
      '城也是一天一天守下來的。繼續。'
    ],
    any: [
      '對大家有用的事，就值得認真做。',
      '把力氣花在有用的地方，別花在好看的地方。',
      '事情做得實在，比說得漂亮重要。'
    ]
  }
};

// 依 Claude 最後一個動作的說明文字判斷種類（文字來自 ai-watch/claude.js 的 describeTool）
function kindOf(lastAction) {
  const a = String(lastAction || '');
  if (/^(修改|寫入) /.test(a)) return 'edit';
  if (/^執行指令/.test(a)) return 'run';
  if (/^(讀取|搜尋) |^查詢網路/.test(a)) return 'look';
  return 'any';
}

function pick(list, avoid, rand) {
  const pool = (Array.isArray(list) ? list : [list]).filter(Boolean);
  const fresh = pool.filter((l) => l !== avoid);
  const from = fresh.length ? fresh : pool;
  return from.length ? from[Math.floor(rand() * from.length)] : '';
}

/**
 * 取得某角色此刻的看法；這位角色沒有台詞（例如已封存）時回傳空字串。
 * @param {string} characterId
 * @param {{lastAction?: string, longRunning?: boolean, avoid?: string, rand?: () => number}} ctx
 *        avoid：上一句說過的話（避免連續重複）；rand：測試時可固定亂數
 */
function remarkFor(characterId, ctx = {}) {
  const set = REMARKS[characterId];
  if (!set) return '';
  const rand = ctx.rand || Math.random;
  const kind = ctx.longRunning ? 'long' : kindOf(ctx.lastAction);
  const m = /^(?:修改|寫入) (.+)$/.exec(String(ctx.lastAction || ''));
  const name = m && m[1] && m[1] !== '檔案' ? m[1] : '';
  // 沒有檔名可說時，改用不需要檔名的那一組
  const useKind = kind === 'edit' && !name ? 'any' : kind;
  const fill = (l) => l.replace('{x}', name);
  const avoid = ctx.avoid || '';
  const lines = (set[useKind] || set.any || []).map(fill);
  return pick(lines, avoid, rand);
}

module.exports = { REMARKS, remarkFor, kindOf };
