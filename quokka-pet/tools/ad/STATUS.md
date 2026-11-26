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
