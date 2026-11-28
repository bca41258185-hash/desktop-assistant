// 角色表與每個鏡頭的設定檔（config.json）
const path = require('path');
const TR = require(path.join(path.resolve(process.env.QUOKKA_DIR || path.join(__dirname, '..', '..')), 'renderer', 'traits.js'));
// [seed, 名字]：個性由 traits.js 依 seed 產生
const CAST = [[81, '庫卡'], [5, '小葉'], [58, '阿灰'], [22, '團團'], [68, '小麥'], [75, '酷酷'], [14, '阿跳']];
function quokka(i) {
  const [seed, name] = CAST[i]; const t = TR.generate(seed); TR.ensurePersonality(t); TR.ensureAccessory(t);
  return { id: 'ad' + i, name, traits: t, home: null, createdAt: new Date(Date.now() - 40 * 86400e3).toISOString() };
}
function config(shot) {
  const ids = shot.cast || [0];
  const quokkas = ids.map(quokka);
  if (shot.mutate) shot.mutate(quokkas);
  return { version: 2, quokkas, tasks: [], reminders: [], stocks: [], folders: [], relations: {},
    settings: { stockStepPct: 1, reminderVoice: false, awayMinutes: 5, walk: 'home', romance: false, babies: false, panelOwner: 'all', defaultOwner: 'ad' + ids[0], ...(shot.settings || {}) },
    ...(shot.extra ? shot.extra() : {}) };
}
module.exports = { CAST, quokka, config, TR };
