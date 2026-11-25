// 產生介紹／下載網頁 site/index.html（單一檔案，角色造型直接內嵌）。
// 用法：node tools/build-site.js
// 下載連結指向 GitHub Releases 的 v<版本> 標籤；發佈新版時先改 package.json 的版本再重新產生。

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const { CHARACTERS, ORDER } = require(path.join(root, 'renderer', 'characters'));

const REPO = 'https://github.com/bca41258185-hash/desktop-assistant';
const V = pkg.version;
const DL_SETUP = `${REPO}/releases/download/v${V}/DesktopMaster-Setup-${V}.exe`;
const DL_PORTABLE = `${REPO}/releases/download/v${V}/DesktopMaster-${V}-win.exe`;

const ROLE = {
  confucius: '溫和的老師。會誇你，也會委婉提醒你一步一步來。',
  laozi: '話少、慢條斯理。提醒你少做一點，事情反而順。',
  zhuangzi: '逍遙自在，愛說寓言。看你太緊繃時會勸你放輕鬆。',
  mozi: '工匠出身，凡事問有沒有用。量過才算數。',
  hanfeizi: '冷面法家。只信規則和證據，話短但句句到位。',
  guiguzi: '山中的謀略家。先觀察、等時機，再開口。'
};

// 個性標籤與一句他會說的話（都是 app 裡的原創台詞，不是真實引言）
const TAG = { confucius: '溫和的老師', laozi: '話最少的那位', zhuangzi: '逍遙的夢想家', mozi: '實幹的工匠', hanfeizi: '冷面法家', guiguzi: '山中的謀略家' };
const LINE = {
  confucius: '知道哪裡不好就改，這很難得。', laozi: '讓它自己跑，別去攪它。', zhuangzi: '放輕鬆，路比你想的寬。',
  mozi: '光說沒用，做出來能用才算數。', hanfeizi: '別靠運氣。運氣不是辦法。', guiguzi: '時機沒到，說什麼都是多的。'
};
const who = (id) => {
  const c = CHARACTERS[id];
  return '<figure class="who"><div class="art">' + c.svg + '</div><figcaption><em>' + (TAG[id] || '') + '</em><b>' + c.nameZh +
    '</b><span>' + (ROLE[id] || '') + '</span><q>' + (LINE[id] || c.greeting) + '</q></figcaption></figure>';
};
const face = (id) => `<span class="face">${CHARACTERS[id].svg}</span>`;

const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta property="og:title" content="桌面大師">
<meta property="og:description" content="請幾位古人站在桌面角落，幫你盯著 Claude。Windows 免費下載。">
<title>桌面大師</title>
<style>
/* 版面：一張製圖用的描圖紙。米白方格底、墨色字，只有下載鈕用深墨色；泡泡和狀態標籤照 app 裡真正的樣子畫。 */
:root {
  --paper: #f4f1e9;
  --surface: #faf8f1;
  --line: #d8d2c2;
  --ink: #2b2b28;
  --ink-soft: #5c5b54;
  --muted: #8a887d;
  --btn: #3a3a36;
  --working: #3b7dd8;
  --waiting: #d9902a;
  --done: #4c9a5f;
  color-scheme: light;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; color: var(--ink); font-size: 17px; line-height: 1.75;
  font-family: "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif;
  background:
    repeating-linear-gradient(0deg, transparent 0 27px, rgba(120, 130, 120, 0.09) 27px 28px),
    repeating-linear-gradient(90deg, transparent 0 27px, rgba(120, 130, 120, 0.09) 27px 28px),
    var(--paper);
}
.wrap { max-width: 1040px; margin: 0 auto; padding: 0 16px; }
h1, h2, h3 { margin: 0; line-height: 1.3; text-wrap: balance; }
h2 { font-size: clamp(28px, 4.4vw, 40px); letter-spacing: 0.06em; }
h3 { font-size: 20px; }
p { margin: 0; }
a { color: inherit; }
section { padding: 64px 0; }
.eyebrow { font-size: 13px; letter-spacing: 0.28em; color: var(--muted); margin-bottom: 8px; }
.lede { color: var(--ink-soft); max-width: 60ch; margin-top: 12px; }
svg .think-dots, svg .sketch-lines, svg .mouth-happy { display: none; }

/* ---------- 開頭 ---------- */
.hero { padding: 72px 0 40px; text-align: center; }
.hero h1 { font-size: clamp(54px, 12vw, 120px); letter-spacing: 0.16em; padding-left: 0.16em; font-weight: 800; }
.hero .tag { font-size: clamp(19px, 2.8vw, 26px); color: var(--ink-soft); letter-spacing: 0.1em; margin-top: 10px; }
.dl { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-top: 28px; }
.btn {
  display: inline-flex; flex-direction: column; align-items: center; padding: 12px 28px; border-radius: 999px;
  text-decoration: none; font-weight: 700; font-size: 18px; border: 2px solid var(--btn); line-height: 1.4;
}
.btn small { font-weight: 400; font-size: 12px; opacity: 0.8; }
.btn.main { background: var(--btn); color: #fff; }
.btn.main:hover { background: #55554f; }
.btn.alt { background: transparent; color: var(--btn); }
.btn.alt:hover { background: #fff; }
.lineup { display: flex; justify-content: center; align-items: flex-end; gap: clamp(2px, 1vw, 12px); margin-top: 44px; }
.lineup .face { display: block; width: clamp(48px, 15vw, 150px); }
.lineup .face svg { width: 100%; height: auto; display: block; }

/* ---------- 影片 ---------- */
.film video { width: 100%; display: block; border-radius: 14px; border: 1px solid var(--line); background: #1f1e1c; box-shadow: 0 18px 50px rgba(60, 50, 30, 0.22); margin-top: 24px; }

/* ---------- 他會做什麼 ---------- */
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 16px; margin-top: 28px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.card p { color: var(--ink-soft); font-size: 15.5px; }
/* 照 app 裡的泡泡畫的小示意 */
.bub { position: relative; align-self: flex-start; max-width: 100%; background: #faf8f1; border: 1px solid var(--line); border-radius: 5px; padding: 10px 14px; font-size: 17px; line-height: 1.5; box-shadow: 0 4px 12px rgba(60, 60, 50, 0.16); }
.bub::after { content: ""; position: absolute; left: 28px; bottom: -8px; border: 8px solid transparent; border-top-color: #faf8f1; border-bottom: 0; filter: drop-shadow(0 1px 0 var(--line)); }
.bub.wait { background: #fff8e6; border-color: #e0a84a; box-shadow: 0 0 0 3px rgba(224, 168, 74, 0.35), 0 4px 12px rgba(60, 60, 50, 0.16); }
.bub.wait::after { border-top-color: #fff8e6; }
.bub.ok { border-color: #6fae7c; box-shadow: 0 0 0 3px rgba(111, 174, 124, 0.4), 0 4px 12px rgba(60, 60, 50, 0.16); }
.bub .row { display: flex; gap: 8px; margin-top: 8px; }
.bub .pill { flex: 1; text-align: center; color: #fff; font-weight: 700; border-radius: 6px; padding: 5px 10px; font-size: 15px; }
.bub .yes { background: #3f8f55; } .bub .no { background: #b5483f; } .bub .opt { background: var(--btn); }
.bub .field { margin-top: 8px; border: 2px solid #d8c9a0; border-radius: 6px; background: #fff; padding: 4px 10px; color: var(--muted); font-size: 14px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { font-size: 13px; padding: 2px 10px 3px; border-radius: 999px; background: #faf8f1; border: 1px solid var(--line); }
.chip::before { content: "●"; font-size: 10px; margin-right: 5px; vertical-align: 1px; }
.chip.working::before { color: var(--working); }
.chip.waiting { background: #fff6dd; border-color: #e0c48a; font-weight: 700; } .chip.waiting::before { color: var(--waiting); }
.chip.done::before { content: "✓"; color: var(--done); font-size: 12px; }
.duo { display: flex; gap: 10px; align-items: flex-end; }
.duo .face { width: 62px; flex-shrink: 0; } .duo .face svg { width: 100%; height: auto; display: block; }
.duo .bub { font-size: 14.5px; padding: 7px 11px; }

/* ---------- 六位角色 ---------- */
.cast { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 16px; margin-top: 28px; }
.who { margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px 18px 8px; display: flex; align-items: center; gap: 6px; }
.who .art { flex-shrink: 0; }
.who .art svg { width: 124px; height: auto; display: block; }
.who figcaption { min-width: 0; }
.who figcaption em { display: block; font-style: normal; font-size: 13px; letter-spacing: 0.12em; color: #b0661c; font-weight: 700; }
.who figcaption b { display: block; font-size: 26px; line-height: 1.3; }
.who figcaption span { display: block; font-size: 14px; color: var(--ink-soft); line-height: 1.6; margin-top: 2px; }
.who figcaption q { display: block; quotes: none; margin-top: 8px; padding: 6px 10px; font-size: 14.5px; line-height: 1.5; background: #fff; border: 1px solid var(--line); border-radius: 6px; }
.who figcaption q::before { content: "「"; } .who figcaption q::after { content: "」"; }

/* ---------- 步驟、下載 ---------- */
.steps { counter-reset: s; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 28px; padding: 0; list-style: none; }
.steps li { counter-increment: s; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px 18px 18px 62px; position: relative; }
.steps li::before { content: counter(s); position: absolute; left: 16px; top: 16px; width: 34px; height: 34px; border-radius: 50%; background: var(--btn); color: #fff; font-weight: 800; display: grid; place-items: center; }
.steps b { display: block; }
.steps span { color: var(--ink-soft); font-size: 15px; }
.get { text-align: center; }
.notes { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 16px; margin-top: 32px; text-align: left; }
.notes .card ul { margin: 0; padding-left: 1.2em; color: var(--ink-soft); font-size: 15px; }
footer { padding: 36px 0 60px; color: var(--muted); font-size: 13.5px; text-align: center; border-top: 1px dashed var(--line); }
footer p + p { margin-top: 6px; }
@media (max-width: 520px) { section { padding: 44px 0; } .btn { width: 100%; } }
</style>
</head>
<body>

<header class="hero">
  <div class="wrap">
    <h1>桌面大師</h1>
    <p class="tag">請幾位古人站在桌面角落，幫你盯著 Claude</p>
    <div class="dl">
      <a class="btn main" href="${DL_SETUP}">下載安裝版<small>Windows 10／11・v${V}</small></a>
      <a class="btn alt" href="#film">先看影片<small>約 1 分鐘</small></a>
    </div>
    <div class="lineup" aria-hidden="true">${ORDER.map(face).join('')}</div>
  </div>
</header>

<section class="film" id="film">
  <div class="wrap">
    <p class="eyebrow">一分鐘看完</p>
    <h2>你忙你的，有事他會叫你</h2>
    <p class="lede">讓 Claude 去做事的時候，不用一直切回去看它做完沒。助手會站在桌面角落，Claude 開始、等你、做完時用泡泡告訴你。</p>
    <video controls preload="metadata" playsinline poster="trailer-poster.jpg" aria-label="桌面大師介紹影片">
      <source src="trailer.mp4" type="video/mp4">
      你的瀏覽器無法播放影片，可以<a href="trailer.mp4">直接下載影片</a>。
    </video>
  </div>
</section>

<section id="what">
  <div class="wrap">
    <p class="eyebrow">他會做什麼</p>
    <h2>不用切視窗，在泡泡上就能處理</h2>
    <div class="grid">
      <div class="card">
        <div class="chips"><span class="chip working">進行中</span><span class="chip waiting">等你回答</span><span class="chip done">完成</span></div>
        <h3>一眼看出 Claude 在幹嘛</h3>
        <p>助手頭上有一個小標籤，隨時顯示這個對話現在是進行中、在等你，還是已經做完。</p>
      </div>
      <div class="card">
        <div class="bub wait">Claude 想修改檔案，要讓它改嗎？<div class="row"><span class="pill yes">允許</span><span class="pill no">拒絕</span></div></div>
        <h3>要你同意時，按一下就好</h3>
        <p>Claude 需要你允許才能繼續時，泡泡上直接有「允許」和「拒絕」。不同意也可以打字告訴它改怎麼做。</p>
      </div>
      <div class="card">
        <div class="bub wait">報告要用哪一種格式交？<div class="row"><span class="pill opt">Word 檔</span><span class="pill opt">PDF</span></div></div>
        <h3>Claude 問你問題，直接回答</h3>
        <p>Claude 用選項問你時，選項會出現在泡泡上；都不是的話也能自己打字回答。</p>
      </div>
      <div class="card">
        <div class="bub ok">格式整理好了，已經存成 PDF。<div class="field">回覆 Claude…</div></div>
        <h3>做完了會叫你，還能直接回話</h3>
        <p>做完的泡泡會發光，等你看過。在下面打字就是下一個指令，也可以隨時按「對 Claude 說」主動交代事情。</p>
      </div>
      <div class="card">
        <div class="duo">${face('mozi')}<div class="bub">你今天做了什麼有用的事？</div></div>
        <div class="duo">${face('zhuangzi')}<div class="bub">我看了一下午的雲，算嗎？</div></div>
        <h3>一個對話，一位助手</h3>
        <p>同時跑好幾個對話時，每個對話各有一位助手盯著。大家都沒事的時候，他們會自己聊起來。</p>
      </div>
      <div class="card">
        <div class="bub">跑一次、驗一次。木匠也是拿尺量過才下鋸。</div>
        <h3>各有各的脾氣</h3>
        <p>Claude 做事時，助手會照自己的性格說兩句看法；點他一下，會說一句查證過出處的真實名言。</p>
      </div>
    </div>
  </div>
</section>

<section id="cast">
  <div class="wrap">
    <p class="eyebrow">目前開放六位</p>
    <h2>你想請誰來盯？</h2>
    <p class="lede">都是兩千多年前的思想家，畫成 Q 版。每位有自己的個性：Claude 做事時他會照自己的脾氣說兩句，沒事時還會和其他人鬥嘴。框裡是他們會說的話。</p>
    <div class="cast">${ORDER.map(who).join('')}</div>
  </div>
</section>

<section id="start">
  <div class="wrap">
    <p class="eyebrow">三步開始</p>
    <h2>一分鐘就能上手</h2>
    <ol class="steps">
      <li><b>裝好、打開</b><span>助手會出現在螢幕右下角，可以拖到你喜歡的位置。</span></li>
      <li><b>按「📋 對話清單」</b><span>再按「＋ 加入對話」，點你要盯的那個 Claude 對話。</span></li>
      <li><b>開啟「即時提醒」</b><span>清單上方的黃色提示按「開啟」，之後就能在泡泡上直接回答 Claude。</span></li>
    </ol>
  </div>
</section>

<section class="get" id="get">
  <div class="wrap">
    <p class="eyebrow">免費下載</p>
    <h2>把他們請到你的桌面</h2>
    <div class="dl">
      <a class="btn main" href="${DL_SETUP}">安裝版<small>DesktopMaster-Setup-${V}.exe</small></a>
      <a class="btn alt" href="${DL_PORTABLE}">免安裝版<small>DesktopMaster-${V}-win.exe</small></a>
    </div>
    <div class="notes">
      <div class="card">
        <h3>第一次打開時</h3>
        <ul>
          <li>這個程式沒有購買數位簽章，Windows 可能跳出「已保護您的電腦」。</li>
          <li>按「其他資訊」，再按「仍要執行」就可以了。</li>
        </ul>
      </div>
      <div class="card">
        <h3>需要什麼</h3>
        <ul>
          <li>Windows 10 或 11。</li>
          <li>Claude 桌面版的 Code 分頁，或 Claude Code。</li>
          <li>「即時提醒」需要電腦上有 Node.js；沒有也能用，只是提醒會慢一點、不能在泡泡上回答。</li>
        </ul>
      </div>
      <div class="card">
        <h3>你的資料</h3>
        <ul>
          <li>只讀取你電腦裡的 Claude 對話紀錄，不會修改它們。</li>
          <li>所有內容都留在你的電腦，不會上傳到任何地方。</li>
          <li>開啟「即時提醒」會在 Claude 的設定加一小段，隨時可以關掉還原。</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <p>原始碼：<a href="${REPO}">${REPO.replace('https://', '')}</a></p>
    <p>角色為歷史人物的 Q 版造型；助手的看法與閒聊是原創台詞，名言則附有原典出處。</p>
  </div>
</footer>

</body>
</html>
`;

fs.mkdirSync(path.join(root, 'site'), { recursive: true });
fs.writeFileSync(path.join(root, 'site', 'index.html'), html);
console.log('site/index.html', Math.round(html.length / 1024) + ' KB');
