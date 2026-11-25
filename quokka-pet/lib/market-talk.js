// 把技術指標的訊號翻成「庫卡的話」：每個訊號＝一句指標事實＋一句短尾矮袋鼠的比喻，再依個性調整語氣。
// 純文字範本（沒有用 AI）；同一天同一檔股票講出來的話固定（用日期＋代號當亂數種子），不會每次打開都不一樣。
// 只是描述行情，不是投資建議。
(function () {
  const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1), f0 = (n) => String(Math.round(n));
  // 每個訊號：fact＝指標事實；leaf＝庫卡生活的比喻（葉子、跳、灌木叢、曬太陽）；sport＝球場比喻（運動健將用）
  const SIG = {
    limitUp: { tag: '漲停', fact: () => '漲停鎖住了', leaf: '一路跳到最高的樹枝，今天不能再高了', sport: '一記跳殺直接得分，對手連碰都碰不到' },
    limitDown: { tag: '跌停', fact: () => '跌停鎖住了', leaf: '整隻滾到坡底，今天沒辦法再低了', sport: '被連續扣殺，這局先被打到底' },
    bigUp: { tag: '大漲', fact: (s) => `今天大漲 ${f1(s.pct)}%`, leaf: '像一口氣跳過三叢灌木', sport: '像快攻一路衝到籃下' },
    bigDown: { tag: '大跌', fact: (s) => `今天大跌 ${f1(Math.abs(s.pct))}%`, leaf: '像踩到鬆掉的石頭，滑了好大一跤', sport: '像被對手連得好幾分' },
    newHigh: { tag: '創新高', fact: (s) => `創 ${s.days} 個交易日新高`, leaf: '爬到這一季最高的那顆石頭上了，視野很好', sport: '刷新本季最高得分' },
    newLow: { tag: '創新低', fact: (s) => `創 ${s.days} 個交易日新低`, leaf: '鑽到這一季最深的樹洞裡了', sport: '本季最低分的一場' },
    gapUp: { tag: '跳空開高', fact: (s) => `開盤就跳空高 ${f1(s.gap)}%`, leaf: '一出洞就直接蹦上石頭，中間那段沒有踩', sport: '開賽第一球就得分' },
    gapDown: { tag: '跳空開低', fact: (s) => `開盤就跳空低 ${f1(Math.abs(s.gap))}%`, leaf: '一出洞就踩空，直接掉一階', sport: '開賽第一球就失分' },
    streakUp: { tag: '連漲', fact: (s) => `已經連漲 ${s.n} 天`, leaf: '一跳比一跳高，還沒停下來', sport: '連勝中，手感正熱' },
    streakDown: { tag: '連跌', fact: (s) => `已經連跌 ${s.n} 天`, leaf: '一天比一天蹲得低', sport: '連敗中，要喊暫停了' },
    goldenCross: { tag: '黃金交叉', fact: () => '5 日線往上穿過 20 日線（黃金交叉）', leaf: '最近幾天的腳步，跑贏了這個月的平均速度', sport: '短線節奏追過中線，攻守交換' },
    deathCross: { tag: '死亡交叉', fact: () => '5 日線往下穿過 20 日線（死亡交叉）', leaf: '最近幾天的腳步，比這個月的平均還慢', sport: '短線節奏被中線壓過去' },
    aboveMa20: { tag: '站上月線', fact: () => '收盤站上 20 日線（月線）', leaf: '從灌木叢下面鑽出來，曬到太陽了', sport: '把比分追平又超前' },
    belowMa20: { tag: '跌破月線', fact: () => '收盤跌破 20 日線（月線）', leaf: '躲回灌木叢的陰影下面', sport: '被對手反超' },
    bullAlign: { tag: '多頭排列', fact: () => '均線多頭排列（5 日 > 20 日 > 60 日）', leaf: '短、中、長期都朝上，一路是上坡', sport: '三線都在進攻位置' },
    bearAlign: { tag: '空頭排列', fact: () => '均線空頭排列（5 日 < 20 日 < 60 日）', leaf: '短、中、長期都朝下，一路是下坡', sport: '三線都退到防守位置' },
    rsiHot: { tag: 'RSI 過熱', fact: (s) => `RSI ${f0(s.rsi)}，超過 70`, leaf: '大家搶葉子搶得很兇，樹都快被吃禿了，通常會想歇一下', sport: '全場都在搶攻，體力快見底了' },
    rsiCold: { tag: 'RSI 過冷', fact: (s) => `RSI ${f0(s.rsi)}，低於 30`, leaf: '沒人要吃的葉子堆了一地，賣得有點過頭了', sport: '被壓著打很久，但也快到谷底了' },
    macdUp: { tag: 'MACD 翻多', fact: () => 'MACD 黃金交叉（DIF 穿過訊號線往上）', leaf: '風向轉成順風，跳起來比較省力', sport: '氣勢轉到我方' },
    macdDown: { tag: 'MACD 翻空', fact: () => 'MACD 死亡交叉（DIF 穿過訊號線往下）', leaf: '風向轉成逆風，跳起來比較吃力', sport: '氣勢被對手拿走' },
    kdUpLow: { tag: 'KD 低檔交叉', fact: (s) => `KD 在低檔黃金交叉（K 值 ${f0(s.k)}）`, leaf: '蹲得很低之後，後腿開始用力了', sport: '救起一顆快落地的球' },
    kdUp: { tag: 'KD 交叉向上', fact: (s) => `KD 黃金交叉（K 值 ${f0(s.k)}）`, leaf: '短線的腳步轉成往上跳', sport: '短線轉守為攻' },
    kdDownHigh: { tag: 'KD 高檔交叉', fact: (s) => `KD 在高檔死亡交叉（K 值 ${f0(s.k)}）`, leaf: '跳到高處之後，腿有點軟了', sport: '跳到最高點，開始往下落' },
    kdDown: { tag: 'KD 交叉向下', fact: (s) => `KD 死亡交叉（K 值 ${f0(s.k)}）`, leaf: '短線的腳步轉成往下', sport: '短線轉攻為守' },
    bbUp: { tag: '突破通道上緣', fact: () => '收盤衝出布林通道上緣', leaf: '跳得比平常的活動範圍還高', sport: '球飛出平常的落點範圍' },
    bbDown: { tag: '跌破通道下緣', fact: () => '收盤跌出布林通道下緣', leaf: '掉到比平常活動範圍還低的地方', sport: '球掉到平常接不到的位置' },
    squeeze: { tag: '通道收窄', fact: () => '布林通道縮到近期最窄', leaf: '大家都蹲著不動；蹲越久，之後那一跳通常越大（往哪邊跳還不知道）', sport: '雙方都在等對方先出手' },
    volUp: { tag: '爆量上漲', fact: (s) => `成交量是平常的 ${f1(s.ratio)} 倍，而且收漲`, leaf: '整群庫卡都跑出來了，一起往上跳', sport: '全場觀眾都站起來了' },
    volDown: { tag: '爆量下跌', fact: (s) => `成交量是平常的 ${f1(s.ratio)} 倍，而且收跌`, leaf: '整群庫卡一起往洞裡跑', sport: '全場一起倒抽一口氣' },
    volDry: { tag: '量縮', fact: (s) => `成交量只有平常的 ${f0(s.ratio * 100)}%`, leaf: '大家都在曬太陽，沒幾隻想動', sport: '球場上沒幾個人在跑' },
    longUpper: { tag: '長上影線', fact: () => '留了一根長上影線', leaf: '跳上去又被拍下來，上面有人不想讓牠過', sport: '殺球被網子擋回來' },
    longLower: { tag: '長下影線', fact: () => '留了一根長下影線', leaf: '掉下去又被接住，下面有人撐著', sport: '快落地的球被救起來了' },
    quiet: { tag: '平靜', fact: () => '今天沒有特別的技術訊號', leaf: '風平浪靜，適合曬太陽', sport: '今天是練習日，沒有比賽' }
  };
  // 個性：開場（依多空）、收尾、語氣
  const VOICE = {
    athlete: { bull: ['得分！', '這球漂亮！'], bear: ['失分了，沒關係，下一球！', '被打回來了。'], flat: ['今天是拉鋸戰。'], end: ['報告完畢，我去熱身了！', '就這樣，球還沒落地都有機會！'], use: 'sport' },
    clingy: { bull: ['你看你看！', '我一直幫你盯著喔！'], bear: ['嗚……先抱一下再說。', '別難過，我陪你。'], flat: ['今天沒什麼事，可以多摸我一下嗎？'], end: ['我會繼續幫你看著，最喜歡你了！', '有變化我第一個跑來跟你說！'], use: 'leaf' },
    shy: { bull: ['那、那個……好像是好消息。'], bear: ['那個……有點不太好意思說……'], flat: ['那個……今天沒什麼特別的。'], end: ['……我說完了。（小聲）', '如、如果說錯了請不要生氣……'], use: 'leaf', soft: true },
    explorer: { bull: ['我發現了！', '快來看這個！'], bear: ['我去看過了，前面的路往下。', '咦，這邊地形變了。'], flat: ['我繞了一圈，沒發現新東西。'], end: ['我再去前面探探路！', '還有好多線想去看看！'], use: 'leaf' },
    sleepy: { bull: ['呼啊……好像漲了。'], bear: ['嗯……跌了啊……'], flat: ['呼……今天很安靜，好睡。'], end: ['我講完了……可以回去睡了嗎……', '呼……有事再叫我……'], use: 'leaf', short: true },
    cool: { bull: ['漲了。'], bear: ['跌了。'], flat: ['沒事。'], end: ['就這樣。', '自己判斷。'], use: 'fact', short: true },
    easy: { bull: ['好消息！', '今天不錯喔！'], bear: ['今天辛苦一點。', '嗯，有點下坡。'], flat: ['今天平平的。'], end: ['大概是這樣，我們慢慢看。', '有變化我再跟你說～'], use: 'leaf' }
  };
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const pick = (arr, seed) => arr[seed % arr.length];

  // analysis：indicators.analyze() 的結果；who：{ archetype }；回傳 { headline, lines[], tags[], mood, disclaimer }
  function describe(analysis, { name = '', symbol = '', archetype = 'easy', maxLines } = {}) {
    if (!analysis || !analysis.ok) return { headline: `${name || symbol}：資料還不夠，我再多看幾天。`, lines: [], tags: [], mood: 'flat', disclaimer: DISCLAIMER };
    const V = VOICE[archetype] || VOICE.easy, v = analysis.v, seed = hash(symbol + '|' + (v.date || '') + '|' + archetype);
    const n = maxLines || (V.short ? 2 : 4);
    const sigs = analysis.signals.slice(0, n);
    const arrow = v.pct >= 0 ? '▲' : '▼', pctTxt = `${arrow}${f1(Math.abs(v.pct))}%`;
    const say = (s) => {
      const d = SIG[s.id]; if (!d) return null;
      const fact = d.fact(s), extra = V.use === 'fact' ? '' : (V.use === 'sport' && d.sport) || d.leaf;
      let line = extra ? `${fact}：${extra}。` : `${fact}。`;
      if (V.soft) line = line.replace(/。$/, '……');
      return line;
    };
    const lines = sigs.map(say).filter(Boolean);
    const opener = pick(V[analysis.mood] || V.flat, seed);
    const top = SIG[sigs[0].id];
    const headline = `${name || symbol} ${pctTxt}，${top.tag}。${opener}`;
    // 位置說明：離月線多遠（一句話交代大方向）
    if (!V.short && v.ma20) {
      const off = (v.close - v.ma20) / v.ma20 * 100;
      lines.push(`現在收 ${fmtPrice(v.close)}，在月線${off >= 0 ? '上面' : '下面'} ${f1(Math.abs(off))}%${V.use === 'sport' ? (off >= 0 ? '，還在領先' : '，還在落後') : (off >= 0 ? '，還在太陽底下' : '，還在樹蔭裡')}。`);
    }
    lines.push(pick(V.end, seed >>> 3));
    return { headline, lines, tags: sigs.map((s) => SIG[s.id].tag), mood: analysis.mood, disclaimer: DISCLAIMER };
  }
  const fmtPrice = (p) => (p >= 100 ? f1(p).replace(/\.0$/, '') : (Math.round(p * 100) / 100).toString());
  const DISCLAIMER = '我只是看圖說故事，不是投資建議喔。';

  // 整體市場（大盤指數）一句話
  function marketLine(analysis, { indexName = '大盤', archetype = 'easy' } = {}) {
    const r = describe(analysis, { name: indexName, symbol: indexName, archetype, maxLines: 1 });
    return r.lines.length ? `${r.headline} ${r.lines[0]}` : r.headline;
  }
  const api = { describe, marketLine, SIG, VOICE, DISCLAIMER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
