// 助手們空閒時的閒聊。
//
// 依人物思想寫的「原創對話」，不是真實引言。每段兩位角色你一句我一句，每人至少五句。
// 只有兩位都在場、而且沒有任何對話在進行或等你回答時才會聊。
//
// 五種情境（scene），依當下狀況挑選：
//   done     ＝ 剛有對話做完（10 分鐘內）
//   longidle ＝ 已經很久沒有動靜（20 分鐘以上）
//   night    ＝ 深夜（23 點～凌晨 5 點）
//   morning  ＝ 早上（5 點～11 點）
//   any      ＝ 平常，任何時候都可以聊
// 新增角色時，補上他和其他人在各情境的對話即可。

const z = 'zhuangzi';
const l = 'laozi';
const m = 'mozi';

// 把「誰先說」和十句話排成 [[誰, 話], ...]，兩人輪流
function talk(first, second, lines) {
  return lines.map((text, i) => [i % 2 === 0 ? first : second, text]);
}

const CHATS = [
  // ===== 莊子 × 老子 =====
  { scene: 'any', lines: talk(z, l, [
    '老先生，你站在這裡一整天，不悶嗎？',
    '山也站了幾萬年，沒聽它喊悶。',
    '山不會說話啊。',
    '所以它從來不說錯話。',
    '那我話這麼多，豈不是錯很多？',
    '你的話像風，吹過就沒了，不算。',
    '這是誇我還是損我？',
    '你覺得是哪個，就是哪個。',
    '那我當成誇獎，心情好一點。',
    '這樣想，你就學會了。'
  ]) },
  { scene: 'done', lines: talk(z, l, [
    '剛剛那件事做完了，你看到了嗎？',
    '看到了。做完就放下，別一直回頭看。',
    '可是做得不錯，想多看兩眼。',
    '好東西不用盯著，它自己會在那裡。',
    '那做壞了的呢？',
    '壞的更不用盯，盯久了會捨不得改。',
    '你怎麼什麼都能放下？',
    '因為我本來就沒拿起來。',
    '厲害。我是拿起來，然後忘了放哪。',
    '那也算放下了。'
  ]) },
  { scene: 'longidle', lines: talk(z, l, [
    '好久沒有動靜了，人去哪了？',
    '去哪都好，該回來就會回來。',
    '我們就這樣乾等嗎？',
    '等，也是一種做事。',
    '那我可以邊等邊睡嗎？',
    '你不是一直都這樣？',
    '被你發現了。我剛夢見自己是一條魚。',
    '魚不用等人，挺好。',
    '可是醒來發現還是我，有點可惜。',
    '是你也不錯，至少有人陪我等。'
  ]) },
  { scene: 'night', lines: talk(z, l, [
    '這麼晚了，燈還亮著。',
    '夜深了，該讓事情自己沉一沉。',
    '可是他好像還想再做一點。',
    '弓拉得太滿，會斷的。',
    '那我去跟他說，明天的事明天再煩？',
    '不用說，你打個呵欠，他就懂了。',
    '哈——啊。這樣嗎？',
    '很好，我也想睡了。',
    '老先生也會睏？',
    '順著天黑就睏，這叫自然。'
  ]) },
  { scene: 'morning', lines: talk(z, l, [
    '早啊，老先生。今天也要站一整天？',
    '早。站著站著，一天就過了。',
    '你不訂個今天的目標嗎？',
    '目標訂多了，路就窄了。',
    '那我訂一個：今天不訂目標。',
    '你這不就訂了嗎。',
    '啊，被你抓到。那我取消。',
    '取消也是一件事。算了，隨你。',
    '好，那我就隨我了。',
    '這句最像樣，今天就這樣開始吧。'
  ]) },

  // ===== 莊子 × 墨子 =====
  { scene: 'any', lines: talk(m, z, [
    '莊先生，你今天做了什麼有用的事？',
    '我看了一下午的雲，算嗎？',
    '雲能擋雨，還是能吃？',
    '不能，但看了心情好。',
    '心情好能多搬幾塊磚嗎？',
    '能，心情好的人搬得比較久。',
    '……這倒是實話。',
    '所以我是在幫大家養心情。',
    '那你下次看雲，順便幫我看會不會下雨。',
    '成交，這個我在行。'
  ]) },
  { scene: 'done', lines: talk(m, z, [
    '那件事做完了，我來驗收一下。',
    '做完就做完了，還要驗？',
    '沒量過的東西，不算完成。',
    '那你量吧，我幫你鼓掌。',
    '鼓掌不能讓牆變直。',
    '但能讓砌牆的人開心。',
    '嗯……牆是直的，可以。',
    '你看，我的掌聲有效。',
    '那是他自己砌得好。',
    '那我為他再鼓一次。'
  ]) },
  { scene: 'longidle', lines: talk(m, z, [
    '人離開好久了，工作就這樣放著？',
    '放著也不會壞，急什麼。',
    '時間放著就沒了，這最浪費。',
    '時間又不是你的，怎麼浪費？',
    '大家的時間都是時間。',
    '那你把我的也拿去用吧，我不太用。',
    '時間不能借。',
    '可惜，不然我能借你好幾年。',
    '你還是留著，多看點有用的書。',
    '好，我先從沒用的那本看起。'
  ]) },
  { scene: 'night', lines: talk(m, z, [
    '這麼晚了，還有事沒做完。',
    '墨先生，夜裡的事留給夜裡的夢吧。',
    '夢裡做的不算數。',
    '可是睡飽了，明天做得快。',
    '這個說法我可以接受。',
    '你看，我也是很實用的。',
    '只有這一句。',
    '一句也夠了，今晚收工？',
    '再檢查一遍門窗，就收。',
    '果然是你，連睡覺都要守城。'
  ]) },
  { scene: 'morning', lines: talk(m, z, [
    '早。今天要做的事，我已經排好了。',
    '早。我今天要做的事，還沒醒。',
    '那你先幫我扛這根木頭。',
    '木頭這麼直，一看就很有用，好累。',
    '有用的東西才值得扛。',
    '我比較喜歡沒用的，輕。',
    '那你扛那捆稻草。',
    '稻草可以，躺起來也舒服。',
    '是叫你扛，不是叫你躺。',
    '先扛過去，再躺，兩全其美。'
  ]) },

  // ===== 老子 × 墨子 =====
  { scene: 'any', lines: talk(m, l, [
    '老先生，我有個問題想請教。',
    '你問，我不一定答。',
    '怎樣才能讓大家都過得好？',
    '少管一點，他們自己就會好。',
    '可是不管，有人會吃虧。',
    '管太多，吃虧的人更多。',
    '那管到哪裡剛好？',
    '像你量木頭，多一分少一分都不行。',
    '這個我懂，那就是要有尺。',
    '尺在你手上，別握太緊就好。'
  ]) },
  { scene: 'done', lines: talk(m, l, [
    '事情做完了，我覺得還能再改好一點。',
    '完成的東西，再動就是多了。',
    '可是多一分牢靠，不好嗎？',
    '碗裝得太滿，端不穩。',
    '那留多少才對？',
    '夠用就停，這最難。',
    '夠用……我一向是這樣主張的。',
    '所以你其實懂，只是手停不下來。',
    '這是做工的人的毛病。',
    '是好毛病，但今天可以休息了。'
  ]) },
  { scene: 'longidle', lines: talk(m, l, [
    '人不在，我們是不是該主動做點什麼？',
    '人不在的時候，最好什麼都別動。',
    '萬一他回來發現沒進展呢？',
    '萬一他回來發現被你改亂了呢？',
    '……有道理，守著比亂動好。',
    '守，本來就是你的專長。',
    '守城我可以守三個月。',
    '那守一個下午，不算什麼。',
    '好，我守。你呢？',
    '我陪你守，順便什麼都不做。'
  ]) },
  { scene: 'night', lines: talk(l, m, [
    '墨翟，天黑了，放下吧。',
    '還有一點沒弄完。',
    '那一點，明天還在。',
    '明天又有明天的事。',
    '所以今天的你，要留一點給明天。',
    '這聽起來像在節用。',
    '是啊，省著用自己，也是節用。',
    '這個道理我沒想過。',
    '你替天下省，偶爾也替自己省。',
    '好，今晚就省一次。'
  ]) },
  { scene: 'morning', lines: talk(m, l, [
    '老先生早，今天從哪件事開始？',
    '早。從最小的那件開始。',
    '最要緊的不是應該先做？',
    '大事都是小事疊起來的。',
    '那我先把工具排整齊。',
    '很好，這就是最小的那件。',
    '排好了，接下來呢？',
    '接下來的事，它自己會出現。',
    '我還是列個清單比較安心。',
    '列吧，但別把清單當成事情本身。'
  ]) }
];

// 其餘組合（韓非子、鬼谷子、孔子和每個人之間）放在 chats-more.json：
// 每筆是 { scene, first, second, lines: [十句] }，first 先說、兩人輪流。
require('./chats-more.json').forEach((c) => {
  CHATS.push({ scene: c.scene, lines: talk(c.first, c.second, c.lines) });
});

const SCENES = ['done', 'longidle', 'night', 'morning', 'any'];

/**
 * 依當下狀況判斷情境。可以同時符合好幾種（例如深夜而且剛做完），回傳所有符合的。
 * @param {{hour: number, msSinceDone?: number, msSinceActivity?: number}} ctx
 * @returns {string[]} 一定包含 'any'
 */
function scenesFor(ctx = {}) {
  const out = [];
  if (Number.isFinite(ctx.msSinceDone) && ctx.msSinceDone <= 10 * 60 * 1000) out.push('done');
  if (!Number.isFinite(ctx.msSinceActivity) || ctx.msSinceActivity >= 20 * 60 * 1000) out.push('longidle');
  if (ctx.hour >= 23 || ctx.hour < 5) out.push('night');
  else if (ctx.hour >= 5 && ctx.hour < 11) out.push('morning');
  out.push('any');
  return out;
}

/**
 * 從在場的角色裡挑一段可以聊的對話（對話裡的每位角色都要在場）。
 * @param {string[]} presentIds 目前在場的角色 id
 * @param {{scenes?: string[], avoid?: number, rand?: () => number}} opts
 *        scenes：目前符合的情境（預設只有 'any'）；符合特定情境的對話優先於平常的
 *        avoid：上次聊過的那段（避免連續重複）
 * @returns {{index: number, scene: string, lines: string[][]} | null}
 */
function pickChat(presentIds, opts = {}) {
  const rand = opts.rand || Math.random;
  const present = new Set(presentIds || []);
  const scenes = opts.scenes && opts.scenes.length ? opts.scenes : ['any'];
  const ok = CHATS.map((c, index) => ({ index, scene: c.scene, lines: c.lines }))
    .filter((c) => c.lines.every(([who]) => present.has(who)) && scenes.includes(c.scene));
  if (!ok.length) return null;
  // 有符合當下情境的就先聊那個；聊過了（avoid）或沒有，才聊平常的
  const specific = ok.filter((c) => c.scene !== 'any' && c.index !== opts.avoid);
  const fresh = ok.filter((c) => c.index !== opts.avoid);
  const pool = specific.length ? specific : (fresh.length ? fresh : ok);
  return pool[Math.floor(rand() * pool.length)];
}

module.exports = { CHATS, SCENES, scenesFor, pickChat };
