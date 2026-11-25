const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseInput: P, describe: D } = require('../lib/parse-input');
// 固定「現在」：2026-11-25（週三）14:05
const NOW = new Date(2026, 10, 25, 14, 5);
const p = (s) => P(s, NOW);

test('股票：台股代號', () => {
  for (const s of ['2330', '0050', '00878', '6488', '2881A', '２３３０']) assert.equal(p(s).type, 'stock', s);
  assert.deepEqual(p('2330'), { type: 'stock', symbol: '2330', market: 'tw' });
  assert.equal(p('233').type, 'task');            // 3 位數不算
  assert.equal(p('1234567').type, 'task');        // 7 位數不算
});
test('股票：美股代號（大寫）', () => {
  assert.deepEqual(p('AAPL'), { type: 'stock', symbol: 'AAPL', market: 'us' });
  assert.deepEqual(p('BRK.B'), { type: 'stock', symbol: 'BRK.B', market: 'us' });
  assert.equal(p('aapl').type, 'task');           // 小寫當一般文字
  assert.equal(p('TODOLIST').type, 'task');       // 超過 5 個字母
});
test('提醒：今天某時', () => {
  assert.deepEqual(p('15:30 開會'), { type: 'reminder', text: '開會', rule: { type: 'once', date: '2026-11-25', time: '15:30' } });
  assert.equal(p('15：30 開會').rule.time, '15:30');            // 全形冒號
  assert.equal(p('15:30開會').rule.time, '15:30');              // 沒空白
  assert.equal(p('下午3點半 開會').rule.time, '15:30');
  assert.equal(p('3點15分 喝水').rule.time, '15:15');           // 下午打、沒寫上下午、1–7 點 → 當成下午
  assert.equal(p('晚上9點 收信').rule.time, '21:00');
  assert.equal(p('中午12點 吃飯').rule.time, '12:00');
  assert.equal(p('中午1點 午休').rule.time, '13:00');
  assert.equal(p('凌晨12點 備份').rule.time, '00:00');
});
test('提醒：時間已過 → 改明天並註記', () => {
  const r = p('9:00 晨會');
  assert.equal(r.rule.date, '2026-11-26');
  assert.equal(r.movedToTomorrow, true);
  assert.match(D(r, NOW), /明天 09:00 提醒（今天已過，改明天）/);
  assert.equal(p('14:05 現在').rule.date, '2026-11-26');        // 同一分鐘也算已過
  assert.equal(p('14:06 等一下').rule.date, '2026-11-25');
});
test('提醒：明天、後天、週幾', () => {
  assert.deepEqual(p('明天 10:00 看工地').rule, { type: 'once', date: '2026-11-26', time: '10:00' });
  assert.equal(p('後天 8點 出差').rule.date, '2026-11-27');
  assert.equal(p('週五 16:00 週報').rule.date, '2026-11-27');   // 本週五
  assert.equal(p('週三 9:00 例會').rule.date, '2026-12-02');    // 今天週三但已過 → 下週三
  assert.equal(p('週三 15:00 例會').rule.date, '2026-11-25');   // 今天還沒到 → 今天
  assert.equal(p('星期日 10:00 爬山').rule.date, '2026-11-29');
});
test('提醒：每天、每週', () => {
  assert.deepEqual(p('每天 17:00 起來動一動').rule, { type: 'daily', time: '17:00' });
  assert.deepEqual(p('每週一 9點 週報').rule, { type: 'weekly', weekdays: [1], time: '09:00' });
  assert.deepEqual(p('每週一三五 8:30 運動').rule, { type: 'weekly', weekdays: [1, 3, 5], time: '08:30' });
  assert.match(D(p('每週一三五 8:30 運動'), NOW), /每週一、三、五 08:30/);
});
test('提醒：N 分鐘／小時後', () => {
  assert.deepEqual(p('30分 泡茶').rule, { type: 'once', date: '2026-11-25', time: '14:35' });
  assert.equal(p('2小時後 回電').rule.time, '16:05');
  assert.equal(p('90 min 休息').rule.time, '15:35');
  assert.equal(p('1.5h 開車').rule.time, '15:35');
  assert.equal(p('600分 跨日').rule.date, '2026-11-26');
});
test('不是時間的數字不會被當成提醒', () => {
  assert.equal(p('1500 報價').type, 'task');                  // 沒有冒號或「點」
  assert.equal(p('整理 2330 報價').type, 'task');
  assert.equal(p('25:00 不存在').type, 'task');                // 時間不合法 → 待辦
  assert.equal(p('10:75 不存在').type, 'task');
  assert.equal(p('15:30').type, 'task');                       // 只有時間沒有內容 → 待辦
});
test('待辦與空白', () => {
  assert.deepEqual(p('回覆業主信件'), { type: 'task', text: '回覆業主信件' });
  assert.deepEqual(p('   '), { type: 'none' });
  assert.equal(p('x'.repeat(300)).text.length, 200);
  assert.equal(D(p('回覆業主信件'), NOW), '→ 新增待辦');
  assert.equal(D(p('2330'), NOW), '→ 加入台股 2330');
});
test('下午打「3點 開會」當成今天 15:00（沒寫上下午、1–7 點、今天已過）', () => {
  assert.deepEqual(p('3點 開會').rule, { type: 'once', date: '2026-11-25', time: '15:00' });
  assert.deepEqual(p('2點 開會').rule, { type: 'once', date: '2026-11-26', time: '14:00' });   // 下午 2 點也過了 → 明天下午 2 點
  assert.equal(p('上午3點 開會').rule.date, '2026-11-26');        // 有寫上午就照字面（已過 → 明天）
  assert.equal(p('8點 晨會').rule.time, '08:00');                // 8 點以後不猜
  assert.equal(p('明天 3點 出發').rule.time, '03:00');           // 有寫日期就照字面
});
test('「30分泡茶」沒空白也算提醒；「10分鐘內完成」不算', () => {
  assert.equal(p('30分泡茶').type, 'reminder');
  assert.equal(p('30分泡茶').rule.time, '14:35');
  assert.equal(p('10分鐘內完成報告').type, 'task');
  assert.equal(p('5分以上的會議').type, 'task');
});
