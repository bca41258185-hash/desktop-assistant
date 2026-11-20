// 助手們空閒時的閒聊。
//
// 依人物思想寫的「原創對話」，不是真實引言。每段是兩位角色你一句我一句（2～4 句），
// 只有兩位都在場、而且沒有任何對話在進行或等你回答時才會聊。
// 新增角色時，在這裡補上他和其他人的對話即可。

const CHATS = [
  // --- 莊子 × 老子 ---
  [['zhuangzi', '老先生，他們忙了一整天，你怎麼看？'], ['laozi', '忙是忙，可別把自己忙丟了。'], ['zhuangzi', '那我去夢裡當隻蝴蝶，丟不了。']],
  [['laozi', '莊周，你又在發呆。'], ['zhuangzi', '我在看那朵雲。它沒打算去哪，卻哪都去了。'], ['laozi', '嗯，這就對了。']],
  [['zhuangzi', '你說「無為」，那我們現在站著不動算不算？'], ['laozi', '算。而且做得很好。']],
  [['laozi', '水往低處流，所以成了海。'], ['zhuangzi', '我比較想當海裡那條不知道自己在海裡的魚。']],

  // --- 莊子 × 墨子 ---
  [['mozi', '莊先生，站著也是站著，不如幫忙做點有用的事。'], ['zhuangzi', '你看那棵歪樹，就是因為沒用才活到現在。'], ['mozi', '……那至少幫我扶一下尺。']],
  [['zhuangzi', '墨先生，你的鞋都磨破了。'], ['mozi', '走的路多，才幫得上人。'], ['zhuangzi', '我的鞋還很新，因為我讓路自己走過來。']],
  [['mozi', '我剛算過，這樣做最省工。'], ['zhuangzi', '我剛睡了一覺，夢裡完全不用工。'], ['mozi', '夢裡的城牆擋不住人。']],
  [['zhuangzi', '你說要兼愛，那蝴蝶也愛嗎？'], ['mozi', '愛。不過蝴蝶不會幫忙搬木頭。']],

  // --- 老子 × 墨子 ---
  [['mozi', '老先生，事情這麼多，不趕快做怎麼行？'], ['laozi', '急著煮的魚會碎。'], ['mozi', '可是餓的人等不了。'], ['laozi', '所以火小一點，但別熄。']],
  [['laozi', '墨翟，你一刻都停不下來。'], ['mozi', '天下還有人在挨凍，怎麼停？'], ['laozi', '那你至少坐著想。'], ['mozi', '……這個可以。']],
  [['mozi', '我主張把標準訂清楚。'], ['laozi', '我主張標準越少越好。'], ['mozi', '那我們訂一條：少訂。'], ['laozi', '成交。']],
  [['laozi', '最好的幫忙，是讓人不覺得被幫了。'], ['mozi', '最好的幫忙，是真的幫上忙。'], ['laozi', '這兩件事不衝突。']]
];

/**
 * 從在場的角色裡挑一段可以聊的對話（對話裡的每位角色都要在場）。
 * @param {string[]} presentIds 目前在場的角色 id
 * @param {{avoid?: number, rand?: () => number}} opts avoid：上次聊過的那段（避免連續重複）
 * @returns {{index: number, lines: string[][]} | null}
 */
function pickChat(presentIds, opts = {}) {
  const rand = opts.rand || Math.random;
  const present = new Set(presentIds || []);
  const ok = CHATS.map((lines, index) => ({ index, lines }))
    .filter((c) => c.lines.every(([who]) => present.has(who)));
  if (!ok.length) return null;
  const fresh = ok.filter((c) => c.index !== opts.avoid);
  const pool = fresh.length ? fresh : ok;
  return pool[Math.floor(rand() * pool.length)];
}

module.exports = { CHATS, pickChat };
