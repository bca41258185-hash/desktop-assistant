// 測試用：確認這些角色在名言檔裡都有至少一句引言
const fs = require('fs');
const path = require('path');
module.exports = function hasQuotes(ids) {
  const all = [];
  for (const f of ['quotes.json', 'quotes-philosophers.json']) {
    try { all.push(...JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8')).quotes); } catch (e) { /* 沒有這個檔 */ }
  }
  return ids.every((id) => all.some((q) => q.id === id));
};
