# 庫卡（Quokka Pet）

一隻住在桌面上的短尾矮袋鼠「庫卡」，用 **Electron + Node** 製作。牠會打羽球、排球、籃球，也會做短尾矮袋鼠的招牌動作（捧葉子吃、蹦跳、自拍、坐著打盹），並陪你工作：監看資料夾變化、連接 AI 聊天、追蹤今日工作進度。

這是獨立專案，有自己的 `package.json`，與上層資料夾的「桌面大師」互不相依；設定檔也分開存放。

![庫卡各姿勢](preview/quokka-poses.png)

## 安裝與執行

需求：Node.js 18+。請在 **本資料夾（`quokka-pet/`）** 內執行：

```bash
npm install
```

```bash
npm start
```

啟動後桌寵出現在螢幕右下角。拖曳可移動，點一下開啟／關閉控制面板，右鍵讓牠說一句話。

## 功能

### 造型
- 插畫風、純 inline SVG（不使用外部圖檔）。比例依使用者提供的照片量測換算：站姿、頭身一體、前爪合在胸前、細尾巴自身後下垂；眼睛約在全高 17%、鼻寬約頭寬 22%。
- 外觀依公開資料：灰褐粗毛、腹部較淺、頭頸偏暖褐；耳朵短而圓；黑色無毛的大鼻子；招牌「微笑」。
- 紅色運動頭帶的顏色由 CSS 變數 `--band` 控制，日後多隻同時出現時可用顏色區分。

### 動作
姿勢由 `#pet` 的 `data-pose` 控制，動作清單、長度、權重與台詞都寫在 `renderer/characters.js`。

| 類別 | 動作 | 說明 |
| --- | --- | --- |
| 基本 | `idle` 待機 | 呼吸、眨眼、偶爾抖耳朵、左右看 |
| 基本 | `think` 思考 | 等 AI 回覆時歪頭、冒出「…」 |
| 基本 | `happy` 開心 | 勾選完成任務時咧嘴小跳 |
| 招牌動作 | `eat` 捧葉子吃 | 雙爪捧葉子，邊嚼邊把葉子吃短（前爪能抓握食物） |
| 招牌動作 | `hop` 跳一跳 | 用後腳蹦跳；把桌寵拖曳放下時也會跳一下 |
| 招牌動作 | `selfie` 自拍 | 湊近鏡頭、歪頭咧嘴、閃光（羅特尼斯島自拍明星） |
| 招牌動作 | `nap` 坐著打盹 | 往下坐、頭低垂、閉眼冒 Zzz（白天常在陰涼處坐著睡） |
| 打球 | `badminton` 羽球 | 右手從頭頂側邊揮拍，把飛來的羽球擊回 |
| 打球 | `volleyball` 排球 | 雙臂併攏在左前方墊球 |
| 打球 | `basketball` 籃球 | 運球三下後起跳，投進右側籃框 |

- 待機時每隔 20–40 秒依權重隨機做一個動作（不連續重複；說話、思考或拖曳中略過）；也可到「設定 → 讓庫卡動一動」手動指定。
- 系統開啟「減少動態效果」時不會自動做動作。
- 效能：整隻身體的位移（呼吸、跳、打盹、自拍）放在外層 HTML 元素上由合成器處理，帶毛絨濾鏡的 SVG 不需每格重畫；在測試環境中閒置時 CPU 約 1%。

### 語錄
- `data/quotes.json`：6 則原創打氣語＋9 則短尾矮袋鼠生態小知識，**皆非引用名言**。
- 依設定間隔（預設 20 分鐘）以氣泡說一句；右鍵桌寵或在「語錄」分頁點選可立即說。

### 資料夾監看（唯讀）
- 以系統對話框挑選資料夾，用 chokidar 監看；有檔案新增／修改／刪除時跳出氣泡，面板列出近期變更。
- **只監看與通知，絕不刪除、搬移或改名任何檔案。**

### AI 聊天
- 可插拔供應商（`providers/`），內建 OpenAI 相容 HTTP 供應商與一個佔位用的 stub。
- 人格為開朗的短尾矮袋鼠「庫卡」，一律以繁體中文回覆（見 `renderer/characters.js` 的 `persona`）。
- 可勾選「帶上近期資料夾變更作為上下文」。

### 工作進度
- 任務清單（新增、勾選、刪除），定時提醒目前進度（預設 30 分鐘）。

## 設定

環境變數優先於 app 內設定：

| 變數 | 說明 | 範例 |
| --- | --- | --- |
| `OPENAI_API_KEY` | API 金鑰 | `sk-...` |
| `OPENAI_BASE_URL` | API Base URL | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 模型名稱 | `gpt-4o-mini` |

app 內設定存於 `<userData>/config.json`（Windows 約在 `%APPDATA%/quokka-pet`，Linux 約在 `~/.config/quokka-pet`），不會進入 repo。**金鑰絕不提交。**

## 專案結構

```
quokka-pet/
├── package.json
├── main.js                 # 主行程：視窗、IPC、資料夾監看、設定、提醒、語錄、AI 呼叫
├── preload.js              # contextBridge 暴露的最小化 API
├── data/quotes.json        # 原創打氣語與生態小知識
├── providers/              # AI 供應商（OpenAI 相容、stub）
├── renderer/
│   ├── characters.js       # 庫卡的 SVG、問候語、運動清單、AI 人格
│   ├── pet.html / pet.css / pet.js       # 桌寵視窗（姿勢與運動動畫、氣泡）
│   └── panel.html / panel.css / panel.js # 控制面板
└── preview/quokka-poses.png              # 各姿勢畫格（文件用）
```

安全性：`contextIsolation: true`、`nodeIntegration: false`，renderer 只能透過 `window.api` 與主行程溝通。

## 想調整的話

- 造型：改 `renderer/characters.js` 裡的 SVG。運動道具預設以 `display="none"` 隱藏，由 `pet.css` 依姿勢顯示。
- 動畫：改 `renderer/pet.css` 的關鍵影格（`bd*` 羽球、`vb*` 排球、`bb*` 籃球、`eat*`／`leafBite` 吃葉子、`hop`、`selfieZoom`、`napBody`）；每段總長需與 `characters.js` 的 `actionMs` 一致。
- 自動動作的頻率與權重：`renderer/pet.js` 的 `scheduleAction()` 與 `characters.js` 的 `actionWeights`。
