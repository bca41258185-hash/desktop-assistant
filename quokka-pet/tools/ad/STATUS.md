# tools/ad 目前狀態

這份目錄是從雲端工作階段複製過來的快照。從現在起，**這個目錄以 git 裡的版本為準**，由你電腦上的工作階段接手算圖和修改。雲端不會再覆蓋這個目錄，有改動會先在這裡說明。

## 可以跑的

- **虛擬時鐘**
  - 主行程（`runner/vc-main.js`）：覆寫 `Date`、`setTimeout`、`setInterval`。
  - 頁面（`runner/vc-renderer.js`）：覆寫 `performance.now`、`Date`、`requestAnimationFrame`、計時器、CSS 動畫、亂數種子。
- **逐格算圖**：`runner/driver.js` 每格前進 1/60 秒，等解碼完成後 `capturePage`，送進 ffmpeg。
- **3 秒測試**：`test3.sh`。
- **字卡**：`caps/` 已經產生好，要重做用 `--caps`。
- **配樂與音效**：`music.py`，用 numpy 合成。
- **剪接、疊字卡、配樂**：`edit.py`。
- **鏡頭設定與腳本**：`shots.js`、`cast.js`。
- **背景**：`bg.js` 是向量假桌面，沒有時鐘，也沒有任何品牌。
- **雲端已跑完的預覽鏡頭**（960×540，60fps）：
  - desk、team、play_bad、play_vb、play_chase、play_bb、dizzy、away、finale 已完成。
  - love 正在算。
- **雲端算圖速度**：沒有 GPU，每秒只能算 10–23 格。

## 還沒完成或要注意的

1. **程式的動作尚未定版**：另一位雲端助手正在改 `renderer/`，內容包括：
   - 動作修正：非伴侶穿模、姿勢跳格、帽子大小突變、讓路、球和籃框收尾、多則響鈴氣泡。
   - 60fps 效能優化。

   修完後，雲端會推一個標題含「**動作修正完成**」的 commit。**正式版請在這個 commit 之後再算**；在那之前算的只當預覽。
2. **Windows**：README 寫的是 WSL2 加 Xvfb。沒有 Xvfb 時，直接在真螢幕開視窗的模式還是實驗性的，可能需要調整。
3. **預覽成片尚未檢查**：雲端的預覽成片還在剪，格圖也還沒檢查。
4. **mock-stock.js**：只是註解裡提到 scratchpad，不影響執行。

## 雲端最後一次同步

在 208db3a 之後同步一次修正。這是雲端最後一次改這個目錄，之後由你接手。

- **`runner/driver.js`**：滑鼠事件改用 DevTools 的 `Input.dispatchMouseEvent`，並等到頁面收到才繼續。原本甩動有時會被當成輕輕放下，就沒有頭暈。
- **`shots.js`**：
  - love 鏡頭取景寬度從 520 改成 560，避免放大。
  - dizzy 鏡頭的滑鼠呼叫都改成 await。
- **`edit.py`**：
  - 加上 4 倍取樣的限幅器，把真峰值壓到 −1 dBTP 以下。
  - dizzy 鏡頭的剪輯區段調整過，字卡移到畫面下方。
- **`check.sh`**、**`test3.sh`**：改用 `pts_time:` 計算畫格，算得比較準。

雲端預覽（960×540，60fps，120.2 秒）已經完成：
- 3 秒測試：每秒不同的畫格是 59／60／59 格。
- 響度：−16.4 LUFS，真峰值 −1.8 dBTP。

預覽發現、正式版要修的地方（交給你處理）：
1. 排球、追逐、籃球這幾個鏡頭，角色只佔畫面高度約 28–31%。要把取景縮窄、倍率調高，讓角色至少佔 1/3。
2. 面板的資料夾列會露出算圖機器上的路徑。要改成看起來自然的路徑，例如「專案資料」。
3. 約 0:03，「跳跳跳！」的氣泡和正在淡出的大字卡疊在一起。
4. 甩到頭暈那段的開頭，左邊露出半截桌面圖示。
5. 長大的變化不明顯（體型 0.7 → 0.78）。可以讓那段停久一點，或並排比較。
6. 面板出現系統捲軸。
7. 分鏡和 `docs/ad-plan.md` 第 3 節不同，以 `shots.js` 為準：
   - 面板輸入的是「9:02 開會」「記得買牛奶」。
   - 揮手移到「回來」那段，因為程式只有在有事報告時才會揮手。
   - 拿掉單獨的「小朋友也會用」面板特寫。
8. 籃球用的是雙人跳投、球滾走、追去撿。單人投籃一定會進，因為程式會自動瞄準。

## 協調：雲端看到你也在改程式（2026-11-26 17:30 UTC）

你推了 renderer／lib 的新功能（互動頻率、偷看喜歡的對象、資訊卡、友情與愛情分開、雷達圖等），雲端已經合併（7ec2fbb），`npm test` 213 項全過。

雲端的動作修正助手還在改這幾個檔案：
- `renderer/stage-actor.js`
- `renderer/stage-social.js`
- `renderer/stage-core.js`
- `renderer/stage.js`
- `renderer/quokka-anim*.js`
- `renderer/quokka-pose.js`
- `renderer/quokka-art.js`

它在處理：非伴侶穿模、姿勢跳格、帽子突變、讓路、球收尾、多則響鈴、60fps 效能優化。

為了避免衝突：
- 你要改上面這些檔案時，請在 commit 訊息裡寫清楚改了哪個函式，方便合併。
- 改得少的話也沒關係，雲端每次都會先 fetch、合併再推，衝突由雲端處理。
- lib/、panel、tools/ad 你可以自由改。

## 建議的分工

- **你的電腦**：
  - 先用 `--preview` 確認整套流程在本機可以跑。
  - 等「動作修正完成」的 commit 推上來後，再算正式版 1920×1080。
- **雲端**：負責程式本身（動作、效能、審查），不再改 `tools/ad/`。
- **回報問題**：寫在這個檔案底下，或寫在 commit 訊息裡。

## 用法

以下指令都在 `quokka-pet/` 執行。

```bash
bash tools/ad/test3.sh
```

```bash
bash tools/ad/render_all.sh --preview
```

```bash
bash tools/ad/render_all.sh
```

詳細說明見 `README.md`。廣告的整體計畫見 `docs/ad-plan.md`。
