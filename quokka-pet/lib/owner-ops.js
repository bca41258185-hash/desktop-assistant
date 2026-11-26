// 把一隻庫卡的事情整批轉給另一隻（刪除庫卡時，規格 7.4）前的上限檢查。純函式。
(function () {
  const NAME = { task: '待辦', reminder: '提醒', stock: '股票', folder: '資料夾' };
  // 回傳 null（可以轉）或「手上的待辦會變成 53 件，超過上限 50 件」這樣的原因
  //   kinds：{ task: 'tasks', … }；LIM：{ task: 50, … }；counts(kind, item)：這一筆算不算名額（已完成的待辦不算）
  function transferProblem(data, from, to, { LIM, kinds, counts = () => true }) {
    for (const [kind, key] of Object.entries(kinds)) {
      const max = LIM[kind]; if (!max) continue;
      const list = data[key] || [];
      const n = (owner) => list.filter((x) => x.owner === owner && counts(kind, x)).length;
      const moving = n(from); if (!moving) continue;
      const total = n(to) + moving;
      if (total > max) return `手上的${NAME[kind] || kind}會變成 ${total} 件，超過上限 ${max} 件`;
    }
    return null;
  }
  module.exports = { transferProblem };
})();
