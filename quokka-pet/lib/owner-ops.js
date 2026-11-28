// 把一隻庫卡的事情整批轉給另一隻（刪除庫卡時，規格 7.4）前的上限檢查與去重。純函式。
(function () {
  const NAME = { task: '待辦', reminder: '提醒', stock: '股票', folder: '資料夾' };
  // 轉過去之後會重複的（例如兩隻都盯 2330）：回傳要丟掉的那些（from 的那一筆）。
  //   keyOf：{ stock: (x) => x.symbol }，沒列的種類不去重
  function transferDupes(data, from, to, { kinds, keyOf = {} }) {
    const drop = [];
    for (const [kind, key] of Object.entries(kinds)) {
      const k = keyOf[kind]; if (!k) continue;
      const list = data[key] || [];
      const have = new Set(list.filter((x) => x.owner === to).map(k));
      for (const x of list) {
        if (x.owner !== from) continue;
        const id = k(x);
        if (have.has(id)) drop.push({ kind, key, item: x });
        else have.add(id);                                   // from 自己重複的也只留一筆
      }
    }
    return drop;
  }
  // 回傳 null（可以轉）或「手上的待辦會變成 53 件，超過上限 50 件」這樣的原因
  //   kinds：{ task: 'tasks', … }；LIM：{ task: 50, … }；counts(kind, item)：這一筆算不算名額（已完成的待辦不算）
  //   keyOf：去重用（見 transferDupes），去重後才算數量
  function transferProblem(data, from, to, { LIM, kinds, counts = () => true, keyOf = {} }) {
    const dropped = new Set(transferDupes(data, from, to, { kinds, keyOf }).map((d) => d.item));
    for (const [kind, key] of Object.entries(kinds)) {
      const max = LIM[kind]; if (!max) continue;
      const list = data[key] || [];
      const n = (owner) => list.filter((x) => x.owner === owner && !dropped.has(x) && counts(kind, x)).length;
      const moving = n(from); if (!moving) continue;
      const total = n(to) + moving;
      if (total > max) return `手上的${NAME[kind] || kind}會變成 ${total} 件，超過上限 ${max} 件`;
    }
    return null;
  }
  module.exports = { transferProblem, transferDupes };
})();
