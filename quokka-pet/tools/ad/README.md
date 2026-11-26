# 庫卡助理 介紹廣告：算圖工具

用**真實程式**逐格算出約 2 分鐘、1920×1080、每秒 60 格的介紹廣告。每一格都由程式自己畫，不錄螢幕、不放大舊影片、不用色鍵去背。

## 需要的軟體

- Node.js 18 以上，並且在專案資料夾（`quokka-pet/`）執行過 `npm install`。Electron 用專案自己的版本。
- Python 3 和 numpy（`pip install numpy`）。
- ffmpeg 和 ffprobe，需要有 libx264 和 AAC。
- Linux 需要 Xvfb（`xvfb-run`）。

Windows 請用 WSL2 執行，在 WSL2 裡安裝上面這些軟體和 `xvfb`。在 Git Bash 或 macOS 上沒有 Xvfb 時，腳本會直接在真的螢幕上開視窗，並把主螢幕改報成鏡頭需要的大小。這個做法還是實驗性的，可能會失敗。

## 用法

以下指令都在 `quokka-pet/` 執行。

```bash
bash tools/ad/render_all.sh --preview      # 預覽：960×540、60fps → tools/ad/out/preview.mp4
bash tools/ad/render_all.sh                # 正式版：1920×1080、60fps → tools/ad/out/kuka_ad_v2.mp4
```

其他參數：

| 參數 | 作用 |
|---|---|
| `--only hook,work` | 只重算這幾個鏡頭，再重新剪接 |
| `--skip-shots` | 不重算鏡頭，只重新剪接、配樂、疊字卡 |
| `--jobs 4` | 同時算幾個鏡頭（預設 2） |
| `--caps` | 重新產生字卡 PNG（已附在 `caps/`） |

專案路徑預設是本資料夾往上兩層，也可以用環境變數 `QUOKKA_DIR=/path/to/quokka-pet` 指定。

`bash tools/ad/test3.sh` 是 3 秒測試。它會把每一格存成 PNG，用 `ffmpeg -framerate 60` 合成，再用 mpdecimate 量每一秒有幾個不同的畫格。

輸出都放在 `out/`，這個資料夾不提交到 git：

- `kuka_ad_v2.mp4`／`preview.mp4`：成片
- `*_grid.png`：每秒一格的格圖
- `shots-*/`：各鏡頭的原始算圖，以及每個鏡頭的事件時間（`.json`）
- `logs/`：各鏡頭的紀錄

## 運作方式

1. **`runner/boot.js`** 是 Electron 進入點。它先載入主行程的虛擬時鐘（`vc-main.js`），覆寫 `Date`、`setTimeout`、`setInterval`，再載入專案的 `main.js`。所以程式本身的提醒排程、股價輪詢、離開偵測、資料夾變動合併、遊戲時鐘都跟著虛擬時間走。
2. 它會攔截 `stage.html` 和 `panel.html`，在第一個 `<script>` 前插入頁面虛擬時鐘（`vc-renderer.js`）。頁面虛擬時鐘覆寫這些東西：
   - `performance.now`、`Date`
   - `requestAnimationFrame`、`setTimeout`、`setInterval`
   - CSS 動畫的進度
   - 亂數：用固定種子，預覽和正式版的隨機選擇會一樣
3. **`runner/driver.js`** 逐格推進。每一格依序做這幾件事：
   1. 主行程前進 1/60 秒。
   2. 每個頁面前進 1/60 秒。
   3. 等圖片解碼、canvas 轉檔都完成，畫面也送出。
   4. 用 `capturePage` 擷取畫面，拼成一格送進 ffmpeg。

   拼格時只會裁切，或用原尺寸、縮小，不會放大。
4. **`shots.js`** 是各鏡頭的設定和腳本，**`cast.js`** 是角色表和設定檔。
   - 庫卡要畫多大，由 deviceScaleFactor 決定，也就是由程式本身畫大。
   - 背景（`bg.js`）是向量假桌面，直接插在舞台頁面最底層，和庫卡一起算圖。背景上沒有時鐘，也沒有任何品牌。
5. **`mock-stock.js`** 是模擬的報價來源，股票代號、公司和價格都是虛構的。成片在股價段落的角落標示「虛構示意資料」。
6. **`edit.py`** 負責剪接、彈跳字卡、音效和配樂。
   - 剪接表和字卡時間都寫在檔案裡。
   - 音效對齊各鏡頭記錄的事件，例如羽球、排球的每一次擊球，以及球的反彈。
   - 配樂由 **`music.py`** 用 numpy 原創合成，響度用兩段式 loudnorm 調到 −16 LUFS，真峰值低於 −1 dBTP。
7. **`check.sh`** 檢查成片：每秒不同畫格數、響度、每秒一格的格圖。

## 不誇大的原則

- 角色的動作和氣泡台詞都是程式自己產生的。用到的功能有：
  - 面板輸入、右鍵選單「今天股市怎麼了？」、面板的「交給…」
  - 「陪我玩」的跳一跳
  - 拖曳甩動、離開偵測、程式自己的待機小動作
  - 雙人互動：用 `social:start` 指令觸發，和主行程社交排程送出的指令相同
- 提醒是在面板真的輸入時間，再把虛擬時鐘快轉到響鈴前，由程式自己的排程觸發。
- 出生、出袋和長大，是把遊戲時鐘快轉到觸發前，再由程式自己判斷。
- 字卡屬於旁白，文字寫在 `capsapp/caps.js`。
