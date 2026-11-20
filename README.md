# 桌面大師（Desktop Masters）

一個用 **Electron + Node** 打造的桌面小幫手（桌寵）。螢幕上有一位可愛的 Q 版「大師」（建築大師或哲學家），能陪你工作、幫你監看資料夾變化、連接 AI 聊天，並協助追蹤今日工作進度。

> 本版本為最小可行版本（MVP）：以 Linux / Windows 皆可用為目標，直接 `npm install && npm start` 即可執行。

> **說明**：桌寵為六位普立茲克建築獎得主與十五位歷史哲學家的 **Q 版致敬漫畫造型**，純屬 **私人個人娛樂用途**。造型僅取公開可辨識的外型特徵（髮型、眼鏡、衣著）與代表性的建築符號，皆以純 inline SVG 手繪、非寫實、不含任何照片、商標或官方肖像，**亦不代表任何形式的官方授權或背書**。

---

## 功能特色

### 1. 桌寵（依職業分類，21 位大師可切換）
- 透明、無邊框、永遠置頂、可拖曳的小視窗。
- 角色以純 inline SVG 繪製，**不使用任何外部圖檔、字型或照片**。
- 角色依「職業」分類，在「設定」頁上方切換類別、點選角色即可即時更換（免重啟），預設為 **安藤忠雄**。
- **建築大師（6 位）**：
  - 安藤忠雄 Tadao Ando（清水混凝土方塊）
  - 法蘭克蓋瑞 Frank Gehry（揉皺金屬片）
  - 札哈哈迪 Zaha Hadid（流動參數化曲面）
  - 貝聿銘 I. M. Pei（玻璃金字塔）
  - 雷姆庫哈斯 Rem Koolhaas（CCTV 懸挑環圈）
  - 妹島和世 Kazuyo Sejima（輕薄白色曲面涼棚）
- **哲學家（15 位）**：皆為過世數百至兩千多年的歷史人物，造型與引文均無著作權、肖像權疑慮。
  - 先秦諸子：孔子（竹簡）、孟子（規矩）、荀子（藍草染缸）、老子（水紋）、莊子（蝴蝶）、墨子（木鳶）、韓非子（墨繩懸錘）
  - 明代：王陽明（山中之花）
  - 古希臘羅馬：蘇格拉底（陶杯）、亞里斯多德（書卷）、馬可·奧理略（蠟板）、塞內卡（書信）
  - 近代歐洲：笛卡兒（座標軸）、康德（星空）、尼采（山峰）
- 所有角色共用同一套動畫系統，由 `#pet` 上的 `data-pose` 控制：
  - **idle（待機）**：呼吸起伏、眨眼，並每隔數秒出現一次招牌手勢與「空中速寫」線條（有眼鏡者會順勢推一下眼鏡）。
  - **think（思考）**：等待 AI 回覆時傾頭、冒出「…」、招牌元素緩慢脈動。
  - **happy（開心）**：勾選完成任務時歡呼彈跳＋換成笑臉，約 2–3 秒後自動回到 idle。
- 每位大師切換時會以自己的語氣說一句原創問候語（非引用名言）。
- AI 聊天的人格會依類別調整：建築大師為「建築工作室導師」，哲學家為「哲學導師」。
- 點一下角色即可開啟／關閉控制面板。
- 桌寵視窗保持小巧（約 240px 寬）；控制面板則是另一個較大的視窗。

### 2. 資料夾監看（本版本為「唯讀」）
- 可用系統對話框挑選要監看的資料夾（`openDirectory`）。
- 清單儲存在 `app.getPath('userData')` 的 JSON 設定檔，**不會放進 repo，也不含任何金鑰**。
- 使用 [chokidar](https://github.com/paulmillr/chokidar) 監看資料夾。
- 當有檔案新增／修改／刪除時，桌寵會跳出簡短的繁體中文氣泡，例如「資料夾有新增檔案：xxx」。
- 面板會列出近期的檔案變更（路徑、事件類型、時間）。
- **重要原則：絕不刪除、搬移或改名任何使用者檔案。本版本只監看與通知。**

### 3. 大師名言
- 資料放在 `data/` 下，每個職業一個檔案（app 會自動讀取所有 `quotes*.json`）：
  - `data/quotes.json`：六位建築大師各 5 則查證過的真實引言（原文＋繁中翻譯＋出處與網址）。
  - `data/quotes-philosophers.json`：十五位哲學家各 5 則，引自原典並標註篇章（例：《論語·衛靈公》、Apology 38a、Meditations 5.20）。外文以原文（希臘文、拉丁文、法文、德文）收錄並附繁中譯文；文言則附白話解釋。
- 名言與角色的原創問候語分開。
- 桌寵可依設定的間隔（預設 20 分鐘）在氣泡中說一句目前角色的名言（中文＋出處）；在桌寵上按右鍵，或到「名言」分頁點選，也可立即說出。
- 「名言」分頁列出目前大師的翻譯、原文（或白話）與來源。

### 4. AI 聊天連接
- 採可插拔的供應商架構，位於 `providers/` 資料夾。
- 內建 **OpenAI 相容 HTTP 供應商**：可設定 Base URL、Model、API Key。
  - 設定來源可為環境變數（`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`），或 app 內「設定」頁存於本機（userData）的欄位。**金鑰絕不提交進 repo。**
- 另附一個 **stub 供應商**（本地／Ollama 佔位），說明尚未設定，供未來擴充。
- AI 人格為「**大師**」：一位沉穩、有涵養的建築工作室導師，一律以繁體中文、依目前選用的大師語氣回應（系統提示會帶入該大師名字）。
- 在面板輸入訊息，回覆會同時顯示在面板的聊天區與桌寵氣泡；送出期間桌寵會進入 thinking 姿勢。
- 提供「**帶上近期資料夾變更作為上下文**」勾選項，勾選後會把近期變更摘要一併送給 AI。

### 5. 工作進度
- 簡單的任務清單：新增任務、勾選完成、資料持久化於本機（userData）。
- 定時提醒氣泡（間隔可設定，預設 30 分鐘），顯示目前進度，例如「今天 3/5 完成」。
- 任務可切換完成／未完成。

### 6. AI 專案進度（Claude Code／Codex，唯讀）
- 即時讀取本機 **Claude Code**（`~/.claude/projects/`）與 **Codex**（`~/.codex/sessions/`）寫下的對話紀錄，依專案資料夾分組，顯示在面板「AI 專案」分頁：目前狀態、最後一句指令、正在做的動作或最後回覆、改過的檔案。
- 桌寵會跟著反應：
  - 送出指令時 → 思考姿勢＋「Claude Code 開始處理『專案名』：…」
  - 工具呼叫超過 20 秒沒有結果 → 「可能在等你確認（或指令執行較久）」；Codex 若在紀錄中寫入核准請求，則立即提醒
  - 回合結束 → 開心姿勢＋「完成了：…」；使用者中斷則提示「已中斷」
- **只看不改**：只以唯讀方式讀取紀錄檔新增的內容，不寫入任何檔案，也不修改 Claude Code／Codex 的設定。內容只在本機處理，不會送到任何 AI 服務。
- 可在「設定」頁關閉。若設定了 `CLAUDE_CONFIG_DIR` 或 `CODEX_HOME` 環境變數，會改監看對應位置。
- 限制：
  - 雲端（網頁版）Claude Code 的對話不在本機，看不到。
  - 「在等你確認權限」對 Claude Code 是依「工具呼叫久未回傳」推測，長時間執行的指令也會觸發。
  - 對話紀錄格式並非公開規格，工具改版後可能需要調整 `ai-watch/claude.js`、`ai-watch/codex.js`；解析失敗的行會被略過，不會讓程式崩潰。

### 7. 介面語言
- 所有介面文字皆為繁體中文（zh-TW）。

---

## 安裝

需求：Node.js 18+（建議 LTS）。

```bash
npm install
```

## 執行

```bash
npm start
```

啟動後右下角會出現桌寵，點一下即可開啟控制面板。

> Linux 註記：若在無桌面環境（headless）或缺少相依系統函式庫的環境執行 Electron，可能需要安裝相關套件（例如 `libgtk-3-0`、`libnss3`、`libasound2` 等），或在有圖形介面的桌面環境中執行。

---

## 測試

```bash
npm test
```

以模擬的 Claude Code／Codex 紀錄檔驗證狀態轉換（開始、等待、完成、中斷、半行寫入、啟動時不誤發通知、不寫入紀錄檔等）。

---

## 設定

### 方式一：環境變數（優先）
啟動前設定下列環境變數，會**優先於** app 內設定：

| 變數 | 說明 | 範例 |
| --- | --- | --- |
| `OPENAI_API_KEY` | API 金鑰 | `sk-...` |
| `OPENAI_BASE_URL` | API Base URL | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 模型名稱 | `gpt-4o-mini` |

例如：

```bash
OPENAI_API_KEY=sk-xxx OPENAI_MODEL=gpt-4o-mini npm start
```

### 方式二：app 內設定
開啟面板 → 「設定」頁，可填入供應商、Base URL、Model、API Key，以及提醒間隔。這些設定存於：

```
<userData>/config.json
```

`<userData>` 由 Electron 依作業系統決定（Windows 約在 `%APPDATA%/desktop-assistant`，Linux 約在 `~/.config/desktop-assistant`）。**此檔案含你的本機設定，不應提交進 repo**，`.gitignore` 已排除同名檔案。

---

## 專案結構

```
.
├── package.json            # 相依套件與 start 腳本（"start": "electron ."）
├── data/
│   ├── quotes.json             # 建築大師名言（原文、翻譯、出處）
│   └── quotes-philosophers.json# 哲學家名言（原文／文言、翻譯／白話、篇章出處）
├── main.js                 # 主行程：視窗、IPC、資料夾監看、設定讀寫、提醒、名言、AI 呼叫
├── ai-watch/
│   ├── index.js            # AI 專案監看核心：追蹤紀錄檔新增內容、維護對話狀態、依專案分組
│   ├── claude.js           # Claude Code 紀錄解析器
│   └── codex.js            # Codex 紀錄解析器
├── test/ai-watch.test.js   # AI 專案監看單元測試（npm test）
├── preload.js              # contextBridge 暴露的最小化 API（renderer 不開啟 nodeIntegration）
├── providers/
│   ├── index.js            # 供應商工廠
│   ├── openai-compatible.js# OpenAI 相容 HTTP 供應商
│   └── stub.js             # 佔位供應商（本地／Ollama，尚未實作）
└── renderer/
    ├── characters.js                     # 角色登錄中心＋建築大師 SVG、職業分類（桌寵、面板、主行程共用）
    ├── characters-philosophers.js        # 哲學家角色包（15 位 SVG、問候語、AI 人格設定）
    ├── pet.html / pet.css / pet.js       # 桌寵視窗（角色切換、姿勢、氣泡）
    └── panel.html / panel.css / panel.js # 控制面板視窗（含大師選擇器）
```

另有 `preview/`（非 app 執行相依）：可用瀏覽器開啟 `preview/all.html`，依職業分組一次檢視所有大師造型，方便截圖。

### 新增其他職業

角色以「職業角色包」擴充，不需改動動畫或視窗程式：

1. 仿照 `renderer/characters-philosophers.js` 新增一個角色包檔案，回傳 `{ category: { id, label, persona, style }, characters, order }`。角色 SVG 須沿用共用的 class（`.pet-body`、`.head`、`.eye`、`.mouth`、`.mouth-happy`、`.gesture-arm`、`.motif` 等）才能套用動畫。
2. 在 `renderer/pet.html`、`renderer/panel.html`、`preview/all.html` 中，於 `characters.js` **之前**加入該檔的 `<script>`；並在 `characters.js` 的 Node 分支 `require` 該檔（主行程使用）。
3. 名言放在 `data/quotes-<職業>.json`，格式同現有檔案。

安全性設計：`contextIsolation: true`、`nodeIntegration: false`，renderer 僅能透過 `preload.js` 暴露的 `window.api` 與主行程溝通。

---

## 開發／安全原則

- **不含任何 API 金鑰或機密**；金鑰只存在本機 userData 或環境變數。
- **不實作任何刪除／搬移／改名檔案的動作**；資料夾功能僅監看與通知。

---

## 未來規劃（Roadmap）

- 以 [electron-builder](https://www.electron.build/) 打包成 Windows 安裝檔。
- 更多 AI 供應商（真正的本地 Ollama、Anthropic Claude、Google 等）。
- 檔案整理動作（搬移／分類／改名），但一律**需使用者明確確認**後才執行。
- 更多職業角色包（例如科學家、藝術家、作家）。
- 桌寵更多表情與互動、多螢幕支援、開機自動啟動。
- 變更紀錄匯出、任務依日期分組與統計。

---

## 授權

MIT
