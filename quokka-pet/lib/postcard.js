// 放生後的明信片：放生時記下牠的愛人（伴侶，或偷偷喜歡的那隻）和好朋友，約 10 分鐘後寄回來，內容提到他們
//   plan(...)   放生當下：決定愛人、朋友、寄到的時間（8–12 分鐘後）
//   compose(...) 寄到時：用幾組句子隨機組合成一張明信片（每張都不太一樣），一定提到愛人和朋友（有的話）
(function () {
  const MIN = 60000;
  const pick = (rnd, list) => list[Math.floor(rnd() * list.length) % list.length];
  const join = (names) => (names.length <= 1 ? names.join('') : names.slice(0, -1).join('、') + '和' + names[names.length - 1]);

  // relationsOf(qid) → [{ other, affinity, love, couple, friend, attracted }]；nameOf(id) → 名字（不在了回傳 null）
  function plan({ from, relations, nameOf, now = Date.now(), rnd = Math.random }) {
    const rs = relations.filter((r) => nameOf(r.other));
    const partner = rs.find((r) => r.couple);
    const crush = !partner && rs.filter((r) => r.attracted && (r.love || 0) >= 20).sort((a, b) => b.love - a.love)[0];
    const lover = partner || crush || null;
    const friends = rs.filter((r) => (!lover || r.other !== lover.other) && (r.friend || (r.affinity || 0) >= 30))
      .sort((a, b) => (b.affinity || 0) - (a.affinity || 0)).slice(0, 3);
    return {
      id: 'pc' + now.toString(36) + Math.floor(rnd() * 1e6).toString(36),
      from: { id: from.id, name: from.name, traits: from.traits || null },
      lover: lover ? { id: lover.other, name: nameOf(lover.other), partner: !!lover.couple } : null,
      friends: friends.map((r) => ({ id: r.other, name: nameOf(r.other) })),
      releasedAt: new Date(now).toISOString(),
      dueAt: now + Math.round((8 + rnd() * 4) * MIN),
      sent: false
    };
  }

  const PLACES = [
    '禿鷹沒有吃掉我！牠把我放在一座海邊的小島，草好嫩，葉子多到吃不完。',
    '那隻禿鷹看起來很兇，其實只是肚子餓，牠把我放在一片大森林，還分了我一顆果子。',
    '我現在住在一座有好多同類的小島，每天早上都在石頭上曬太陽。',
    '這裡有一條小溪，晚上可以看到好多星星，比螢幕上的游標還亮。'
  ];
  const LOVE_PARTNER = [
    (l) => `可是每次看到夕陽，我都會想起${l}。`,
    (l) => `${l}，我還記得我們靠在一起打盹的那個下午。`,
    (l) => `${l}，你有沒有好好吃飯？我每天都在想你。`,
    (l) => `這裡的葉子再好吃，也比不上和${l}一起分的那一片。`
  ];
  const LOVE_CRUSH = [
    (l) => `其實我一直偷偷喜歡${l}，以前不敢說，現在終於寫下來了。`,
    (l) => `${l}，每次你看過來，我都假裝在看別的地方……其實我在看你。`,
    (l) => `如果有一天${l}也來這座島，我想第一個跳過去打招呼。`
  ];
  const FRIENDS = [
    (f) => `幫我跟${f}說，我好想念一起打球的日子！`,
    (f) => `${f}，下次落葉雨記得替我多吃一片。`,
    (f) => `${f}，你們要繼續幫主人顧好待辦喔，不要偷懶打盹。`,
    (f) => `我在島上交了新朋友，但還是最想念${f}。`
  ];
  const ALONE = ['我在這裡交到好多新朋友，你們不用擔心我。', '主人，謝謝你以前照顧我。'];
  const SIGN = ['🌿', '🌊', '☀️', '🍃'];

  function compose(card, { rnd = Math.random, present = () => true } = {}) {
    const lover = card.lover && card.lover.name;
    const friends = card.friends.map((f) => f.name);
    const to = lover || (friends.length ? join(friends) : '大家');
    const lines = [`親愛的${to}：`, pick(rnd, PLACES)];
    if (lover) lines.push(pick(rnd, card.lover.partner ? LOVE_PARTNER : LOVE_CRUSH)(lover));
    if (friends.length && (lover || friends.length > 0)) lines.push(pick(rnd, FRIENDS)(join(friends)));
    if (!lover && !friends.length) lines.push(pick(rnd, ALONE));
    lines.push(`—— ${card.from.name} ${pick(rnd, SIGN)}`);
    return lines.join('\n');
  }
  // 寄給誰：愛人還在就寄給牠，不然寄給第一個還在的朋友，都不在就給 fallback（預設負責人）
  function recipient(card, isPresent, fallback) {
    if (card.lover && isPresent(card.lover.id)) return card.lover.id;
    const f = card.friends.find((x) => isPresent(x.id));
    return f ? f.id : fallback;
  }
  module.exports = { plan, compose, recipient, MIN };
})();
