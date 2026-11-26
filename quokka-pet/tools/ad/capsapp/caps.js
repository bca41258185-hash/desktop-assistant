// 字卡 PNG（透明背景，1920×1080 座標的原尺寸）。用專案裡的 Electron 產生，不需要另外裝瀏覽器：
//   <electron> tools/ad/capsapp <輸出資料夾>
// 字卡是旁白（可以自己寫）；角色氣泡裡的台詞一律是程式自己說的。
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const OUT = path.resolve(process.argv[process.argv.length - 1]);
const CAPS = {
  hook: ['你的桌面，<br>需要一隻庫卡。', 'big'],
  problem: ['事情太多，記不住？', 'cream'],
  morning: ['早安！今天也一起加油', ''],
  work: ['一句話，交給我吧！', ''],
  ring: ['時間到！準時提醒 <span class="em">⏰</span>', 'orange'],
  limitup: ['漲停！放煙火～', 'red'],
  limitdown: ['跌停…先抱頭', 'greenk'],
  talk: ['同一檔股票，兩種說法', 'cream'],
  folder: ['資料夾有動靜，我盯著呢 <span class="em">👀</span>', ''],
  team: ['養一群，各管各的', 'cream'],
  handoff: ['這件交給你囉！', ''],
  play: ['休息一下，打個球！', ''],
  love: ['戀愛了 <span class="em">💕</span>', 'pink'],
  baby: ['生寶寶囉！', 'pink'],
  follow: ['跟著媽媽走', 'cream'],
  grown: ['長大了！', ''],
  dizzy: ['甩一甩…頭暈了', 'orange'],
  away: ['下班啦，我等你回來', 'cream'],
  back: ['回來就跟你打招呼', ''],
  tagline: ['桌面上最可愛的工作夥伴', 'cream'],
  cta: ['現在就讓庫卡住進你的桌面', '']
};
const TAGS = { t0855: '08:55', t0900: '09:00', t0902: '09:02', t0905: '09:05', t1020: '10:20', t1100: '11:00', t1500: '15:00', t1530: '15:30', t1800: '18:00', t1940: '19:00' };
const LABELS = { cool: '獨立酷酷派・酷酷', clingy: '黏人開心果・團團', fake: '虛構示意資料' };
const CSS = `*{margin:0;padding:0;box-sizing:border-box}body{background:transparent;font-family:'WenQuanYi Zen Hei','Noto Sans TC','Microsoft JhengHei','PingFang TC','Noto Color Emoji','Segoe UI Emoji',sans-serif}
.cap{position:absolute;left:60px;top:60px;display:inline-flex;align-items:center;gap:14px;padding:18px 46px 24px;border-radius:999px;background:#6fb26a;color:#fffbea;font-weight:bold;font-size:72px;letter-spacing:4px;
 box-shadow:0 9px 0 #4f8f4a,0 20px 40px rgba(60,90,50,.28);white-space:nowrap;text-shadow:0 3px 0 #4f8f4a;-webkit-text-stroke:2.5px currentColor}
.cap.big{font-size:104px;line-height:1.18;border-radius:64px;padding:30px 64px 40px;text-align:center;white-space:normal;display:block}
.cap.cream{background:#fff5dc;color:#4f8f4a;box-shadow:0 9px 0 #e8cf9a,0 20px 40px rgba(120,90,40,.22);text-shadow:none}
.cap.orange{background:#f39a3d;box-shadow:0 9px 0 #c9732a,0 20px 40px rgba(150,80,20,.28);text-shadow:0 3px 0 #c9732a}
.cap.red{background:#e0524a;box-shadow:0 9px 0 #ad3a33,0 20px 40px rgba(150,40,30,.28);text-shadow:0 3px 0 #ad3a33}
.cap.greenk{background:#3f8f6a;box-shadow:0 9px 0 #2c6a4d,0 20px 40px rgba(30,80,60,.28);text-shadow:0 3px 0 #2c6a4d}
.cap.pink{background:#f28aa5;box-shadow:0 9px 0 #cf6683,0 20px 40px rgba(160,60,90,.28);text-shadow:0 3px 0 #cf6683}
.em{font-family:'Noto Color Emoji','Segoe UI Emoji','Apple Color Emoji';font-size:.85em;-webkit-text-stroke:0;text-shadow:none}
.tag{position:absolute;left:60px;top:60px;display:inline-flex;align-items:center;gap:14px;padding:10px 30px 12px 22px;border-radius:22px;background:#3d3326;color:#fff6df;font-weight:bold;font-size:58px;letter-spacing:3px;box-shadow:0 6px 0 #241d14}
.tag svg{width:50px;height:50px}
.lab{position:absolute;left:60px;top:60px;padding:8px 22px;border-radius:16px;background:#fff5dc;color:#6a5a40;font-weight:bold;font-size:34px;box-shadow:0 4px 0 #e8cf9a}`;
const clock = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#f2c94e"/><path d="M12 6v6l4 2.5" stroke="#3d3326" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>';

const leaf = (x, y, s, rot) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 0 C6 -14 22 -18 30 -16 C28 -6 18 6 0 0Z" fill="#7cbf6a"/><path d="M0 0 C10 -6 18 -11 28 -15" stroke="#4f8f47" stroke-width="1.6" fill="none" stroke-linecap="round"/></g>`;
const heart = (x, y, s) => `<path transform="translate(${x} ${y}) scale(${s})" d="M-5 -2 c0-3 4-4 5-1 c1-3 5-2 5 1 c0 3-5 6-5 6 s-5-3-5-6Z" fill="#ef6f7c"/>`;
const TITLE = `<svg id="t" width="1300" height="330" viewBox="310 40 1300 330" style="position:absolute;left:0;top:0"><g font-family="WenQuanYi Zen Hei, Noto Sans TC, Microsoft JhengHei, PingFang TC, sans-serif" font-weight="bold" text-anchor="middle">
  <text x="960" y="290" font-size="200" letter-spacing="18" fill="#3f7f3c" opacity=".25" transform="translate(0 12)">庫卡助理</text>
  <text x="960" y="290" font-size="200" letter-spacing="18" fill="#4f8f4a" stroke="#fffaf0" stroke-width="32" stroke-linejoin="round" paint-order="stroke">庫卡助理</text>
  <text x="960" y="290" font-size="200" letter-spacing="18" fill="#4f8f4a" stroke="#4f8f4a" stroke-width="7" stroke-linejoin="round">庫卡助理</text></g>
  ${leaf(470, 140, 2.6, -30)}${leaf(1460, 110, 2.6, 190)}${heart(1500, 95, 2.6)}</svg>`;
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const w = new BrowserWindow({ width: 1920, height: 1080, show: false, frame: false, transparent: true, backgroundColor: '#00000000', webPreferences: { offscreen: true } });
  w.webContents.setFrameRate(30);
  const shot = async (html, sel, file, pad = [40, 30, 80, 80]) => {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}html,body{background:transparent}</style></head><body>${html}</body></html>`));
    await w.webContents.executeJavaScript('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
    const r = await w.webContents.executeJavaScript(`(function(){const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`);
    await new Promise((res) => setTimeout(res, 150));
    const rect = { x: Math.max(0, Math.floor(r[0] - pad[0])), y: Math.max(0, Math.floor(r[1] - pad[1])), width: Math.ceil(r[2] + pad[2]), height: Math.ceil(r[3] + pad[3]) };
    const img = await w.webContents.capturePage(rect);
    fs.writeFileSync(path.join(OUT, file), img.toPNG());
  };
  for (const [id, [t, cls]] of Object.entries(CAPS)) await shot(`<div class="cap ${cls}">${t}</div>`, '.cap', id + '.png');
  for (const [id, t] of Object.entries(TAGS)) await shot(`<div class="tag">${clock}${t}</div>`, '.tag', id + '.png');
  for (const [id, t] of Object.entries(LABELS)) await shot(`<div class="lab">${t}</div>`, '.lab', id + '.png');
  await shot(TITLE, '#t', 'title.png', [0, 0, 0, 0]);
  console.log('caps ok', OUT);
  app.exit(0);
});
