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
  assert.deepEqual(p('aapl'), { type: 'stock', symbol: 'AAPL', market: 'us' });   // 小寫也算（轉成大寫）
  assert.equal(p('Aapl').type, 'task');           // 大小寫混用當一般文字
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

// ---- 表格式測試：固定「現在」2026-11-25（週三）14:05 --------------------------------------
// 欄位：輸入、種類（R 提醒／T 待辦／S 股票）、其餘依種類：
//   R：規則（'日期 時間'｜'daily 時間'｜'weekly 星期 時間'）、內容、提示（正規表示式，null＝不可以有提示）
//   S：代號、市場
const TABLE = [
  // A1 晚上／凌晨／半夜／中午 12 點
  ['晚上12點睡覺', 'R', '2026-11-26 00:00', '睡覺', null],
  ['凌晨12點備份', 'R', '2026-11-26 00:00', '備份', null],
  ['半夜12點關機', 'R', '2026-11-26 00:00', '關機', null],
  ['中午12點吃飯', 'R', '2026-11-26 12:00', '吃飯'],                       // 今天中午已過 → 明天
  ['明天中午12點吃飯', 'R', '2026-11-26 12:00', '吃飯', null],
  ['明天晚上12點截稿', 'R', '2026-11-27 00:00', '截稿', null],               // 明天晚上的 12 點＝後天 00:00
  ['今晚12點截稿', 'R', '2026-11-26 00:00', '截稿', null],
  ['每天晚上12點備份', 'R', 'daily 00:00', '備份'],
  // A2 中文數字
  ['後天下午兩點半現場會勘', 'R', '2026-11-27 14:30', '現場會勘', null],
  ['下午三點開會', 'R', '2026-11-25 15:00', '開會', null],
  ['三點開會', 'R', '2026-11-25 15:00', '開會', null],
  ['半小時後打給結構技師', 'R', '2026-11-25 14:35', '打給結構技師', null],
  ['一小時後開會', 'R', '2026-11-25 15:05', '開會', null],
  ['十分鐘後', 'R', '2026-11-25 14:15', '時間到了', null],
  ['兩點四十五出發', 'R', '2026-11-25 14:45', '出發', null],
  ['三點一刻開會', 'R', '2026-11-25 15:15', '開會', null],
  ['四點三刻 收工', 'R', '2026-11-25 16:45', '收工', null],
  ['明天十一點半看工地', 'R', '2026-11-26 11:30', '看工地', null],
  ['明天上午十二點備份', 'R', '2026-11-26 00:00', '備份', null],
  ['二十三點關機', 'R', '2026-11-25 23:00', '關機', null],
  ['三十五分鐘後開會', 'R', '2026-11-25 14:40', '開會', null],
  ['一個半小時後出門', 'R', '2026-11-25 15:35', '出門', null],
  ['兩個小時後收信', 'R', '2026-11-25 16:05', '收信', null],
  ['下午五點零五分打卡', 'R', '2026-11-25 17:05', '打卡', null],
  ['十分感謝', 'T'], ['一點也不急', 'T'], ['有一點問題要問', 'T'], ['三點意見回覆', 'T'],
  // A4 各種說法
  ['下週一10點業主簡報', 'R', '2026-11-30 10:00', '業主簡報', null],
  ['下周三下午2點', 'R', '2026-12-02 14:00', '時間到了', null],
  ['下週五下午2點送審', 'R', '2026-12-04 14:00', '送審', null],
  ['12/5 10點 驗收', 'R', '2026-12-05 10:00', '驗收', null],
  ['12月5日上午10點驗收', 'R', '2026-12-05 10:00', '驗收', null],
  ['1/15 14:00 驗收', 'R', '2027-01-15 14:00', '驗收', /今年已過，當成明年/],
  ['13/45 10點 亂打', 'T'],
  ['明早9點交圖', 'R', '2026-11-26 09:00', '交圖', null],
  ['今晚8點倒垃圾', 'R', '2026-11-25 20:00', '倒垃圾', null],
  ['明晚7點聚餐', 'R', '2026-11-26 19:00', '聚餐', null],
  ['今早9點開會', 'R', '2026-11-26 09:00', '開會', /今天早上 9 點已過，改成明天/],
  ['下午 3 點 15 分 開會', 'R', '2026-11-25 15:15', '開會', null],
  ['下午3點15開會', 'R', '2026-11-25 15:15', '開會', null],
  ['3點 15樓會議', 'R', '2026-11-25 15:00', '15樓會議', null],             // 15 樓不是 15 分
  ['每週一、三 9點 晨會', 'R', 'weekly 1,3 09:00', '晨會'],
  ['每週一，三 9點 晨會', 'R', 'weekly 1,3 09:00', '晨會'],
  ['每星期二和星期四 下午2點 工務會議', 'R', 'weekly 2,4 14:00', '工務會議'],
  ['每週一到五 9點 晨會', 'R', 'weekly 1,2,3,4,5 09:00', '晨會'],
  ['提醒我下午3點開會', 'R', '2026-11-25 15:00', '開會', null],
  ['記得下午4點打給營造廠', 'R', '2026-11-25 16:00', '打給營造廠', null],
  ['記得買牛奶', 'T'],
  ['開會 下午3點', 'R', '2026-11-25 15:00', '開會', null],
  ['開會 15:30', 'R', '2026-11-25 15:30', '開會', null],
  ['明天 開會 下午3點', 'R', '2026-11-26 15:00', '開會', null],
  ['跟業主下午三點半開會', 'R', '2026-11-25 15:30', '跟業主開會', null],
  ['平日9點打卡', 'R', 'weekly 1,2,3,4,5 09:00', '打卡'],
  ['每個工作天8點50打卡', 'R', 'weekly 1,2,3,4,5 08:50', '打卡'],
  ['明天交圖', 'T'], ['下午3點', 'T'], ['1530開會', 'T'], ['開會3點', 'T'],
  ['1:50 平面圖比例調整', 'T'],                                             // 比例尺不是時間
  // A5 今天已過、語意線索、下午推斷
  ['今天9點開會', 'R', '2026-11-25 21:00', '開會', /今天早上 9 點已過，改成晚上 9 點？/],
  ['今天3點開會', 'R', '2026-11-25 15:00', '開會', null],
  ['今天2點開會', 'R', '2026-11-26 14:00', '開會', /今天下午 2 點已過，改成明天/],
  ['9點開會', 'R', '2026-11-26 09:00', '開會'],                             // 沒說今天、下午打的 → 明天早上
  ['8點吃晚餐', 'R', '2026-11-25 20:00', '吃晚餐', null],
  ['11點宵夜', 'R', '2026-11-25 23:00', '宵夜', null],
  ['6點下班', 'R', '2026-11-25 18:00', '下班', null],
  ['8點吃早餐', 'R', '2026-11-26 08:00', '吃早餐'],
  ['7點上班', 'R', '2026-11-26 07:00', '上班'],
  ['7點 叫車', 'R', '2026-11-25 19:00', '叫車', /早上 7 點已過，當成晚上 7 點/],
  ['12點睡覺', 'R', '2026-11-26 00:00', '睡覺', null],
  ['2點睡覺', 'R', '2026-11-26 02:00', '睡覺', null],
  ['明天3點出發', 'R', '2026-11-26 03:00', '出發', /當成凌晨 3 點/],
  ['每天3點喝水', 'R', 'daily 15:00', '喝水', /當成下午 3 點/],
  // A6 時間範圍
  ['9點~10點 開會', 'R', '2026-11-26 09:00', '開會（9:00–10:00）'],
  ['9-10點開會', 'R', '2026-11-26 09:00', '開會（9:00–10:00）'],
  ['明天 9:00-10:00 工務會議', 'R', '2026-11-26 09:00', '工務會議（9:00–10:00）', null],
  ['下午4點～5點半 工地會議', 'R', '2026-11-25 16:00', '工地會議（16:00–17:30）', null],
  ['3點到5點 簡報', 'R', '2026-11-25 15:00', '簡報（15:00–17:00）', null],
  // A7 沒有內容的相對時間
  ['5分鐘後', 'R', '2026-11-25 14:10', '時間到了', null],
  ['提醒我5分鐘後', 'R', '2026-11-25 14:10', '時間到了', null],
  ['回電 10分鐘後', 'R', '2026-11-25 14:15', '回電', null],
  ['100分', 'T'], ['5m', 'T'], ['3m 淨高檢討', 'T'],
  // A8 截止型
  ['今天下午5點前回信', 'R', '2026-11-25 16:30', '回信（17:00 前）', /17:00 截止，提早 30 分鐘提醒/],
  ['3點前交圖', 'R', '2026-11-25 14:30', '交圖（15:00 前）', /15:00 截止，提早 30 分鐘提醒/],
  ['14:20前回電', 'R', '2026-11-25 14:10', '回電（14:20 前）', /提早 10 分鐘提醒/],
  ['每天下午5點前回報', 'R', 'daily 16:30', '回報（17:00 前）', /提早 30 分鐘提醒/],
  ['週五前送審', 'R', '2026-11-27 09:00', '送審（週五前）', /沒寫時間，週五 09:00 提醒/],
  ['12/5前送審', 'R', '2026-12-05 09:00', '送審（12/5前）', /沒寫時間/],
  ['3點前往工地', 'R', '2026-11-25 15:00', '前往工地', null],               // 「前往」不是截止
  ['5點下班前備份', 'R', '2026-11-25 17:00', '下班前備份', null],
  // A9 股票
  ['BIM', 'T'], ['CAD', 'T'], ['PDF', 'T'], ['OK', 'T'], ['RC', 'T'], ['SRC', 'T'], ['MEP', 'T'], ['RFI', 'T'], ['FYI', 'T'], ['ASAP', 'T'], ['TODO', 'T'],
  ['todo', 'T'], ['hello', 'T'], ['dwg', 'T'],
  ['aapl', 'S', 'AAPL', 'us'], ['tsmc', 'S', 'TSMC', 'us'], ['TSLA', 'S', 'TSLA', 'us'], ['F', 'S', 'F', 'us'], ['brk.b', 'S', 'BRK.B', 'us'],
  ['2330 台積電', 'S', '2330', 'tw'], ['2330.TW', 'S', '2330', 'tw'], ['2330.TWO', 'S', '2330', 'tw'], ['6488.two', 'S', '6488', 'tw'],
  ['台積電', 'S', '2330', 'tw'], ['聯發科', 'S', '2454', 'tw'],
  ['2330 報價', 'T'], ['買2330', 'T'], ['TSLA 200', 'T'], ['3D列印模型', 'T'],
  // A10 既有規則
  ['10分鐘內回電', 'T'], ['2026結案報告', 'T'], ['1樓平面圖修改', 'T'], ['每個月5號繳房租', 'T']
];
test(`表格式測試（${TABLE.length} 句）`, () => {
  assert.ok(TABLE.length >= 60);
  for (const [input, kind, a, b, hint] of TABLE) {
    const r = p(input), line = D(r, NOW);
    assert.ok(!/undefined|NaN|null/.test(line + JSON.stringify(r.rule || '')), `${input} → ${line}`);
    if (kind === 'T') { assert.equal(r.type, 'task', input); assert.equal(r.text, input.trim(), input); continue; }
    if (kind === 'S') { assert.equal(r.type, 'stock', input); assert.equal(r.symbol, a, input); assert.equal(r.market, b, input); continue; }
    assert.equal(r.type, 'reminder', input);
    const t = r.rule, got = t.type === 'once' ? `${t.date} ${t.time}` : t.type === 'daily' ? `daily ${t.time}` : `weekly ${t.weekdays.join(',')} ${t.time}`;
    assert.equal(got, a, input);
    assert.equal(r.text, b, input);
    if (hint === null) { assert.equal(r.note, undefined, input); assert.equal(r.movedToTomorrow, undefined, input); }
    else if (hint) { assert.match(r.note || '', hint, input); assert.ok(line.includes(r.note), `${input}：提示要顯示在說明裡`); }
  }
});
test('內容不可殘留時間的碎片', () => {
  for (const [input, kind] of TABLE) {
    if (kind !== 'R') continue;
    const text = p(input).text.replace(/（[^（）]*）$/, '');
    assert.ok(!/^[後~\-–點分]|^前(?!往)|^\d+[點:]|[~\-–]\s*\d/.test(text), `${input} → ${text}`);
    assert.ok(text.length > 0, input);
  }
});
test('2330.TW／.TWO 帶上市上櫃（多的欄位，不影響原本的結構）', () => {
  assert.equal(p('2330.TW').ex, 'tse'); assert.equal(p('6488.TWO').ex, 'otc');
});
test('相對時間不會提早：有零頭秒數就進位到下一分鐘', () => {
  const at = (s, now) => { const r = P(s, now).rule, [y, mo, d] = r.date.split('-').map(Number), [h, m] = r.time.split(':').map(Number); return new Date(y, mo - 1, d, h, m); };
  for (const sec of [0, 1, 30, 59]) {
    const now = new Date(2026, 10, 25, 14, 5, sec, sec ? 500 : 0);
    for (const [s, mins] of [['30分 泡茶', 30], ['5分鐘後', 5], ['半小時後開會', 30], ['2小時後 回電', 120], ['1.5h 開車', 90]]) {
      const gap = at(s, now) - now;
      assert.ok(gap >= mins * 60000, `${s} @:${sec} 提早了`);
      assert.ok(gap < mins * 60000 + 60000, `${s} @:${sec} 晚超過一分鐘`);
    }
  }
  assert.equal(P('30分 泡茶', new Date(2026, 10, 25, 14, 5, 0)).rule.time, '14:35');     // 整分鐘時不變
  assert.equal(P('30分 泡茶', new Date(2026, 10, 25, 14, 5, 30)).rule.time, '14:36');
  assert.equal(P('1分鐘後', new Date(2026, 10, 25, 23, 59, 30)).rule.date, '2026-11-26');   // 進位跨日
});
test('沒寫上下午的推斷會看現在幾點', () => {
  const at = (h, m = 0) => new Date(2026, 10, 25, h, m);
  const r = (s, now) => { const x = P(s, now); return `${x.rule.date.slice(8)} ${x.rule.time}`; };
  // 1–6 點：當成下午；下午那次也過了就明天下午
  assert.equal(r('3點 開會', at(10)), '25 15:00');
  assert.equal(r('3點 開會', at(16)), '26 15:00');
  assert.equal(r('6點 開會', at(18, 30)), '26 18:00');
  // 例外：半夜還醒著，而且那個凌晨時刻還沒到
  assert.equal(r('3點 看球', at(2)), '25 03:00');
  assert.equal(r('1點 開會', at(2)), '25 13:00');
  // 7–11 點：早上那次還沒到就是早上
  assert.equal(r('9點 開會', at(8)), '25 09:00');
  assert.equal(r('11點 開會', at(10)), '25 11:00');
  // 早上那次過了：白天打的 → 明天早上；傍晚以後打的 → 今晚（附提示）
  assert.equal(r('9點 開會', at(10)), '26 09:00');
  assert.equal(P('9點 開會', at(10)).movedToTomorrow, true);
  assert.equal(r('9點 開會', at(18, 30)), '25 21:00');
  assert.match(P('9點 開會', at(18, 30)).note, /早上 9 點已過，當成晚上 9 點/);
  assert.equal(r('8點 倒垃圾', at(18, 30)), '25 20:00');
  assert.equal(r('9點 開會', at(22)), '26 09:00');                // 晚上那次也過了 → 明天早上
  // 語意線索優先
  assert.equal(r('8點吃晚餐', at(10)), '25 20:00');
  assert.equal(r('8點吃早餐', at(7)), '25 08:00');
  assert.equal(r('1點午休', at(10)), '25 13:00');
  assert.equal(r('12點吃午餐', at(10)), '25 12:00');
  // 0 點、13 點以後、有冒號的 24 小時制照字面
  assert.equal(r('13點 開會', at(10)), '25 13:00');
  assert.equal(r('19:30 聚餐', at(10)), '25 19:30');
  // 今天已是那個星期幾：時間沒過是今天，過了是下週
  assert.equal(r('週三 15:00 例會', at(14, 5)), '25 15:00');
  assert.equal(P('週三 9:00 例會', at(14, 5)).rule.date, '2026-12-02');
});
test('說明文字：遠一點的日期附星期，提示接在後面', () => {
  assert.equal(D(p('下週一10點業主簡報'), NOW), '→ 11/30（一） 10:00 提醒');
  assert.equal(D(p('今天9點開會'), NOW), '→ 今天 21:00 提醒（今天早上 9 點已過，改成晚上 9 點？）');
  assert.equal(D(p('今天下午5點前回信'), NOW), '→ 今天 16:30 提醒（17:00 截止，提早 30 分鐘提醒）');
  assert.equal(D(p('台積電'), NOW), '→ 加入台股 2330');
});
