// 把技術指標的訊號翻成「庫卡的話」：每個訊號＝一句指標事實＋一句短尾矮袋鼠的比喻，再依個性調整語氣。
// 純文字範本（沒有用 AI）；同一天同一檔股票講出來的話固定（用日期＋代號當亂數種子），不會每次打開都不一樣。
// 只是描述行情，不是投資建議。
(function () {
  const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1), f0 = (n) => String(Math.round(n));
  // 每個訊號：fact＝指標事實；leaf＝庫卡生活的比喻（葉子、跳、灌木叢、曬太陽）；sport＝球場比喻（運動健將用）
  // 原則：每一句都只描述「已經發生的事」。不寫之後會怎樣、不寫現在是高點或低點、不寫該買該賣。
  const SIG = {
    limitUp: { tag: '漲停', fact: () => '漲停鎖住了', leaf: '一路跳到今天最高的那根樹枝', sport: '一記跳殺直接得分' },
    limitDown: { tag: '跌停', fact: () => '跌停鎖住了', leaf: '整隻滾到今天的坡底', sport: '被連續扣殺，這局被打到底' },
    bigUp: { tag: '大漲', fact: (s) => `今天大漲 ${f1(s.pct)}%`, leaf: '像一口氣跳過三叢灌木', sport: '像快攻一路衝到籃下' },
    bigDown: { tag: '大跌', fact: (s) => `今天大跌 ${f1(Math.abs(s.pct))}%`, leaf: '像踩到鬆掉的石頭，滑了好大一跤', sport: '像被對手連得好幾分' },
    newHigh: { tag: '創新高', fact: (s) => `創 ${s.days} 個交易日新高`, leaf: '站上這一季爬過最高的那顆石頭', sport: '刷新本季最高得分' },
    newLow: { tag: '創新低', fact: (s) => `創 ${s.days} 個交易日新低`, leaf: '鑽到這一季到過最深的樹洞', sport: '本季最低分的一場' },
    gapUp: { tag: '跳空開高', fact: (s) => `跳空開高 ${f1(s.gap)}%`, leaf: '一出洞就直接蹦上石頭，中間那段沒有踩', sport: '開賽第一球就得分' },
    gapDown: { tag: '跳空開低', fact: (s) => `跳空開低 ${f1(Math.abs(s.gap))}%`, leaf: '一出洞就踩空，直接掉一階', sport: '開賽第一球就失分' },
    streakUp: { tag: '連漲', fact: (s) => `已經連漲 ${s.n} 天`, leaf: '這幾天一跳比一跳高', sport: '這幾場都贏' },
    streakDown: { tag: '連跌', fact: (s) => `已經連跌 ${s.n} 天`, leaf: '這幾天一天比一天蹲得低', sport: '這幾場都輸' },
    goldenCross: { tag: '黃金交叉', fact: () => '5 日線往上穿過 20 日線（黃金交叉）', leaf: '最近幾天的腳步，跑贏了這個月的平均速度', sport: '短線節奏追過了中線' },
    deathCross: { tag: '死亡交叉', fact: () => '5 日線往下穿過 20 日線（死亡交叉）', leaf: '最近幾天的腳步，比這個月的平均還慢', sport: '短線節奏被中線壓過去' },
    aboveMa20: { tag: '站上月線', fact: () => '收盤站上 20 日線（月線）', leaf: '從灌木叢下面鑽出來，曬到太陽了', sport: '把比分追平又超前' },
    belowMa20: { tag: '跌破月線', fact: () => '收盤跌破 20 日線（月線）', leaf: '躲回灌木叢的陰影下面', sport: '被對手反超' },
    bullAlign: { tag: '多頭排列', fact: () => '均線多頭排列（5 日 > 20 日 > 60 日）', leaf: '短、中、長期的平均一層比一層高，這一段走的是上坡', sport: '三條線都站在進攻位置' },
    bearAlign: { tag: '空頭排列', fact: () => '均線空頭排列（5 日 < 20 日 < 60 日）', leaf: '短、中、長期的平均一層比一層低，這一段走的是下坡', sport: '三條線都退在防守位置' },
    rsiHot: { tag: 'RSI 偏高', fact: (s) => `RSI ${f0(s.rsi)}，超過 70`, leaf: '最近往上跳的步子，比往下滑的大很多', sport: '最近幾乎都是進攻方在得分' },
    rsiCold: { tag: 'RSI 偏低', fact: (s) => `RSI ${f0(s.rsi)}，低於 30`, leaf: '最近往下滑的步子，比往上跳的大很多', sport: '最近幾乎都是被壓著打' },
    macdUp: { tag: 'MACD 翻多', fact: () => 'MACD 黃金交叉（DIF 穿過訊號線往上）', leaf: '這陣子的風向從逆風轉成順風', sport: '這陣子的氣勢轉到我方' },
    macdDown: { tag: 'MACD 翻空', fact: () => 'MACD 死亡交叉（DIF 穿過訊號線往下）', leaf: '這陣子的風向從順風轉成逆風', sport: '這陣子的氣勢轉到對手那邊' },
    kdUpLow: { tag: 'KD 低檔交叉', fact: (s) => `KD 在低檔黃金交叉（K 值 ${f0(s.k)}）`, leaf: '在蹲得很低的位置，短線的腳步轉成往上', sport: '在落後的時候拿下一分' },
    kdUp: { tag: 'KD 交叉向上', fact: (s) => `KD 黃金交叉（K 值 ${f0(s.k)}）`, leaf: '短線的腳步轉成往上', sport: '短線轉守為攻' },
    kdDownHigh: { tag: 'KD 高檔交叉', fact: (s) => `KD 在高檔死亡交叉（K 值 ${f0(s.k)}）`, leaf: '在跳得很高的位置，短線的腳步轉成往下', sport: '在領先的時候丟了一分' },
    kdDown: { tag: 'KD 交叉向下', fact: (s) => `KD 死亡交叉（K 值 ${f0(s.k)}）`, leaf: '短線的腳步轉成往下', sport: '短線轉攻為守' },
    bbUp: { tag: '突破通道上緣', fact: () => '收盤衝出布林通道上緣', leaf: '跳得比平常的活動範圍還高', sport: '球飛出平常的落點範圍' },
    bbDown: { tag: '跌破通道下緣', fact: () => '收盤跌出布林通道下緣', leaf: '掉到比平常活動範圍還低的地方', sport: '球掉到平常接不到的位置' },
    squeeze: { tag: '通道收窄', fact: () => '布林通道縮到近期最窄', leaf: '最近大家都蹲在原地，活動範圍很小', sport: '最近雙方來回都很小，比分幾乎沒動' },
    volUp: { tag: '爆量上漲', fact: (s) => `成交量是平常的 ${f1(s.ratio)} 倍，而且收漲`, leaf: '整群庫卡都跑出來了，一起往上跳', sport: '全場觀眾都站起來了' },
    volDown: { tag: '爆量下跌', fact: (s) => `成交量是平常的 ${f1(s.ratio)} 倍，而且收跌`, leaf: '整群庫卡一起往洞裡跑', sport: '全場一起倒抽一口氣' },
    volBig: { tag: '爆量', fact: (s) => `成交量是平常的 ${f1(s.ratio)} 倍，價格沒什麼變`, leaf: '整群庫卡都跑出來了，擠在原地', sport: '全場都很吵，比分沒動' },
    volDry: { tag: '量縮', fact: (s) => `成交量只有平常的 ${f0(s.ratio * 100)}%`, leaf: '大家都在曬太陽，沒幾隻想動', sport: '球場上沒幾個人在跑' },
    longUpper: { tag: '長上影線', fact: () => '留了一根長上影線', leaf: '跳上去又落回來，收在今天比較低的地方', sport: '殺球被網子擋回來' },
    longLower: { tag: '長下影線', fact: () => '留了一根長下影線', leaf: '掉下去又彈回來，收在今天比較高的地方', sport: '快落地的球被救起來了' },
    quiet: { tag: '平靜', fact: () => '今天沒有特別的技術訊號', leaf: '風平浪靜，適合曬太陽', sport: '今天是練習日，沒有比賽' },
    still: { tag: '沒動靜', fact: () => '價格和上一個交易日一樣，沒有變動', leaf: '大家都趴著沒動', sport: '今天場上沒有人跑動' }
  };
  // 個性：開場（依多空）、收尾、語氣
  // 個性：開場（bull／bear＝跟著當天方向；flat＝漲跌不大但有訊號；calm＝沒有特別的訊號；
  //        still＝價格完全沒動；mixed(當天, 訊號)＝當天方向和訊號相反時的中性開場）、收尾、語氣
  //   下跌的日子不用驚嘆號和歡樂的語助詞（bear 開場本身就不寫，其他句子在 describe() 統一收掉）
  const VOICE = {
    athlete: { bull: ['得分！', '這球漂亮！'], bear: ['失分了，沒關係，我陪你看。', '被打回來了。'], flat: ['今天是拉鋸戰。'], calm: ['今天是練習日。'], still: ['今天球場一片安靜。'],
      mixed: (d, l) => `${d}，但${l}，這場還在拉鋸。`, end: ['報告完畢，我去熱身了！', '就這樣，今天的比賽紀錄報告完畢！'], use: 'sport' },
    clingy: { bull: ['你看你看！', '我一直幫你盯著喔！'], bear: ['嗚……先抱一下再說。', '別難過，我陪你。'], flat: ['今天漲跌不大，我還是一直幫你盯著。'], calm: ['今天沒什麼事，可以多摸我一下嗎？'], still: ['今天停在原地，我陪你等。'],
      mixed: (d, l) => `${d}，但${l}，我陪你一起看。`, end: ['我會繼續幫你看著，最喜歡你了！', '有變化我第一個跑來跟你說！'], use: 'leaf' },
    shy: { bull: ['那、那個……今天是漲的。'], bear: ['那個……有點不太好意思說……'], flat: ['那個……今天漲跌不大。'], calm: ['那個……今天沒什麼特別的。'], still: ['那個……今天一動也沒動。'],
      mixed: (d, l) => `那個……${d}，但${l}。`, end: ['……我說完了。（小聲）', '如、如果說錯了請不要生氣……'], use: 'leaf', soft: true },
    explorer: { bull: ['我發現了！', '快來看這個！'], bear: ['我去看過了，今天這段路是下坡。', '咦，這邊地形變了。'], flat: ['我繞了一圈，今天漲跌不大，但有幾個地方變了。'], calm: ['我繞了一圈，沒發現新東西。'], still: ['我繞了一圈，價格都停在原地。'],
      mixed: (d, l) => `我看了一圈：${d}，但${l}。`, end: ['我再去別的地方繞繞！', '還有好多線想去看看！'], use: 'leaf' },
    sleepy: { bull: ['呼啊……今天漲了。'], bear: ['嗯……跌了啊……'], flat: ['呼……今天漲跌不大。'], calm: ['呼……今天很安靜，好睡。'], still: ['呼……一動也沒動，好睡。'],
      mixed: (d, l) => `呼……${d}，但${l}。`, end: ['我講完了……可以回去睡了嗎……', '呼……有事再叫我……'], use: 'leaf', short: true },
    cool: { bull: ['漲了。'], bear: ['跌了。'], flat: ['小幅波動。'], calm: ['沒事。'], still: ['沒變。'],
      mixed: (d, l) => `${d}，但${l}。`, end: ['就這樣。', '以上。'], use: 'fact', short: true },
    easy: { bull: ['今天是漲的！', '今天不錯喔！'], bear: ['今天辛苦一點。', '嗯，今天是下坡。'], flat: ['今天平平的。'], calm: ['今天沒什麼特別的，慢慢看。'], still: ['今天就停在原地。'],
      mixed: (d, l) => `${d}，但${l}，我們慢慢看。`, end: ['大概是這樣，我們慢慢看。', '有變化我再跟你說～'], use: 'leaf' }
  };
  // 句數上限（lines 的長度）：酷酷派最多 2 句、慵懶睡神 3 句（兩句訊號＋想睡的收尾）、其他 7 句
  const MAX_LINES = { cool: 2, sleepy: 3 }, MAX_DEFAULT = 7;
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const pick = (arr, seed) => arr[seed % arr.length];

  // ---- 每一隻自己的個性（五項數值 0–1、喜好、嗜好、年紀）再微調說法 ----------------------
  //   膽量：低 → 在解讀句前加「好像、看起來、感覺」；高 → 加「我敢說」（都不加在數字事實前面）
  //   好奇：高 → 多講一個訊號、補一個數字；低 → 少講一個
  //   活潑：高 → 驚嘆號；低 → 句子短、語氣慢
  //   黏人：高 → 對著「你」說、說會幫你盯；低 → 不多說
  //   親人：高 → 會提到要去跟別隻說
  //   喜好：最愛球類的用球場比喻（開場用那種球的話）；最愛吃葉子的多用葉子比喻
  //   嗜好：收尾說講完要去做什麼；年紀：小的驚呼、年長的提「我看過的線多了」
  const SPORT_WORD = { badminton: { bull: '殺球得分！', bear: '這球掛網了。' }, volleyball: { bull: '扣球得分！', bear: '這球沒接起來。' }, basketball: { bull: '空心進球！', bear: '這球被蓋掉了。' } };
  // 不確定的語氣只加在「解讀（比喻）」前面，不加在數字事實前面
  const HEDGE = ['好像', '看起來，', '感覺'];
  function personalize(base, P, extra, seed) {
    if (!P) return base;
    let { opener, closer, n, use } = base;
    const likes = extra.likes || [], sportLike = likes.find((a) => SPORT_WORD[a]);
    if (sportLike && use !== 'fact') { use = 'sport'; if (base.mood === 'bull' || base.mood === 'bear') opener = SPORT_WORD[sportLike][base.mood]; }
    else if (likes.includes('eat') && use === 'sport') use = 'leaf';
    if (P.curiosity > 0.7) n += 1; else if (P.curiosity < 0.3) n = Math.max(1, n - 1);
    if (P.activity < 0.3) n = Math.max(1, n - 1);
    const hedge = P.boldness < 0.35 ? pick(HEDGE, seed) : P.boldness > 0.75 ? '我敢說，' : '';
    const punct = (t) => (P.activity > 0.7 && base.mood !== 'bear' ? t.replace(/。$/, '！') : P.activity < 0.3 ? t.replace(/。$/, '……') : t);
    const tail = [];
    if (P.affection > 0.7) tail.push(base.mood === 'bear' ? '你不要太擔心，我會一直幫你盯著。' : '我會一直幫你盯著，有變化馬上跟你說。');
    if (P.sociability > 0.75) tail.push('等一下我也去跟其他庫卡說。');
    // 年紀小的會先叫一聲；下跌的日子不驚呼，開場已經是語助詞開頭的就不再疊
    if (extra.stage === 'juvenile' && !/^[咦嗯嗚那欸呼]/.test(opener)) opener = (base.mood === 'bull' ? '哇！' : base.mood === 'bear' ? '欸……' : '咦？') + opener;
    else if (extra.stage === 'senior') tail.push('這種線我以前也看過。');
    const hobby = (extra.hobbies || [])[seed % Math.max(1, (extra.hobbies || []).length)];
    if (hobby && P.affection <= 0.7 && use !== 'fact') closer = `講完了，我要去${hobby}了。`;
    return { ...base, opener, n, use, hedge, punct, tail, closer };
  }

  // 當天漲跌和技術訊號方向相反時的中性開場：「今天小漲，但均線轉弱。」
  const LEAN_WORD = { goldenCross: '均線轉強', aboveMa20: '均線轉強', bullAlign: '均線仍是多頭排列', deathCross: '均線轉弱', belowMa20: '均線轉弱', bearAlign: '均線仍是空頭排列' };
  function mixedOpener(a, V) {
    const p = Math.abs(a.v.pct) || 0, day = !a.dayDir ? '今天平盤' : `今天${p < 1 ? '小' : p < 3 ? '上' : '大'}${a.dayDir > 0 ? '漲' : '跌'}`.replace('上跌', '下跌');
    const top = a.signals.find((s) => s.dir === a.lean);
    const lean = (top && LEAN_WORD[top.id]) || (a.lean > 0 ? '其他指標偏強' : '其他指標偏弱');
    return V.mixed ? V.mixed(day, lean) : `${day}，但${lean}。`;
  }

  // analysis：indicators.analyze() 的結果；回傳 { headline, lines[], tags[], mood, disclaimer }
  // who：archetype（七種個性類型）＋ 這一隻自己的 personality（五項數值）、likes、hobbies、stage
  function describe(analysis, { name = '', symbol = '', archetype = 'easy', maxLines, personality, likes, hobbies, stage } = {}) {
    const label = name || symbol;
    if (!analysis || !analysis.ok) return { headline: `${label ? label + '：' : ''}資料還不夠，我再多看幾天。`, lines: [], tags: [], mood: 'flat', disclaimer: DISCLAIMER };
    // 欄位缺了也不丟例外：沒有數值就當平盤、沒有可講的訊號就說「沒有特別的訊號」
    const v0 = analysis.v && typeof analysis.v === 'object' ? analysis.v : {};
    const v = { ...v0, pct: Number.isFinite(v0.pct) ? v0.pct : 0 };
    let signals = (Array.isArray(analysis.signals) ? analysis.signals : []).filter((s) => s && SIG[s.id]);
    if (!signals.length) signals = [{ id: 'quiet', dir: 0 }];
    analysis = { ...analysis, v, signals, dayDir: Number.isFinite(analysis.dayDir) ? analysis.dayDir : Math.round(Math.abs(v.pct) * 10) === 0 ? 0 : Math.sign(v.pct) };
    const V = VOICE[archetype] || VOICE.easy, seed = hash(symbol + '|' + (v.date || '') + '|' + archetype);
    const still = signals[0].id === 'still', calm = signals[0].id === 'quiet';
    // 開場講的是「今天」：和當天方向矛盾時用中性說法；完全沒動、沒有訊號時各用各的說法（不會說「沒什麼事」卻列出一堆訊號）
    const mood = analysis.mood === 'bull' || analysis.mood === 'bear' ? analysis.mood : 'flat';
    const opener0 = still ? pick(V.still, seed) : analysis.mixed ? mixedOpener(analysis, V) : calm && mood === 'flat' ? pick(V.calm, seed) : pick(V[mood], seed);
    const down = mood === 'bear' || analysis.dayDir < 0;
    const who = personalize({ opener: opener0, n: V.short ? 2 : 4, use: V.use, mood: still || analysis.mixed ? 'flat' : mood, closer: pick(V.end, seed >>> 3) }, personality, { likes, hobbies, stage }, seed);
    const cap = MAX_LINES[archetype] || MAX_DEFAULT;
    const n = Math.max(1, Math.min(maxLines || who.n, V.short ? 2 : 5)), use = who.use;
    const sigs = signals.slice(0, n);
    const flatDay = Math.round(Math.abs(v.pct) * 10) === 0;
    const pctTxt = flatDay ? '平盤' : `${v.pct > 0 ? '▲' : '▼'}${f1(Math.abs(v.pct))}%`;
    // 盤中（當天還沒收盤）不說「收盤」
    const live = (t) => (v.partial ? t.replace(/收盤/g, '目前').replace('而且收漲', '目前上漲').replace('而且收跌', '目前下跌').replace('留了一根', '目前留著一根')
      .replace('漲停鎖住了', '目前漲到漲停價').replace('跌停鎖住了', '目前跌到跌停價') : t);     // 盤中還沒收，不能說「鎖住」
    const say = (s, i) => {
      const d = SIG[s.id];
      const fact = live(d.fact(s)), extra = use === 'fact' ? '' : (use === 'sport' && d.sport) || d.leaf;
      const hedge = i === 0 && extra && who.hedge ? who.hedge : '';
      let line = extra ? `${fact}：${hedge}${extra}。` : `${fact}。`;
      if (V.soft) line = line.replace(/。$/, '……');
      return who.punct ? who.punct(line) : line;
    };
    const sigLines = sigs.map(say);
    const top = SIG[sigs[0].id];
    // 「平盤，沒動靜。」已經說了沒動，開場就不再重複
    const headline = `${label ? label + " " : ""}${pctTxt}，${top.tag}。${who.opener}`;
    // 位置說明：離月線多遠（一句話交代現在的位置）
    const extra = [];
    if (!V.short && !still && Number.isFinite(v.ma20) && v.ma20 > 0 && Number.isFinite(v.close)) {
      const off = (v.close - v.ma20) / v.ma20 * 100, near = Math.round(Math.abs(off) * 10) === 0;
      const now = `現在${v.partial ? '' : '收'} ${fmtPrice(v.close)}`;
      extra.push(near ? `${now}，貼著月線。`
        : `${now}，在月線${off >= 0 ? '上面' : '下面'} ${f1(Math.abs(off))}%${use === 'sport' ? (off >= 0 ? '，目前領先' : '，目前落後') : use === 'fact' ? '' : (off >= 0 ? '，在太陽底下' : '，在樹蔭裡')}。`);
    }
    // 句數上限：訊號 → 位置 →（個性的附帶話）→ 收尾；超過就先裁附帶話。酷酷派與睡神不說附帶話
    let lines;
    if (archetype === 'cool') { lines = sigLines.slice(0, cap); if (lines.length < cap) lines.push(who.closer); }
    else {
      const tails = V.short ? [] : (who.tail || []);
      lines = sigLines.concat(extra);
      const room = Math.max(0, cap - 1 - lines.length);
      lines = lines.slice(0, cap - 1).concat(tails.slice(0, room), [who.closer]);
    }
    // 下跌的日子：不用驚嘆號、不用「～」這種開心的語助詞
    const calmDown = (t) => (down ? t.replace(/！/g, '。').replace(/～/g, '。') : t);
    return { headline: calmDown(headline), lines: lines.map(calmDown), tags: sigs.map((s) => SIG[s.id].tag), mood: analysis.mood || 'flat', disclaimer: DISCLAIMER };
  }
  const fmtPrice = (p) => (p >= 100 ? f1(p).replace(/\.0$/, '') : (Math.round(p * 100) / 100).toString());
  const DISCLAIMER = '我只是看圖說故事，不是投資建議喔。';

  // 整體市場（大盤指數）一句話
  function marketLine(analysis, { indexName = '大盤', archetype = 'easy', ...who } = {}) {
    const r = describe(analysis, { name: indexName, symbol: indexName, archetype, ...who, maxLines: 1 });
    return r.lines.length ? `${r.headline} ${r.lines[0]}` : r.headline;
  }
  const api = { describe, marketLine, SIG, VOICE, DISCLAIMER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
