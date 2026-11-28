#!/bin/bash
# 一個指令重跑全部：bash render_all.sh [--preview] [--only 鏡頭,鏡頭] [--jobs N] [--caps] [--skip-shots]
#   預設：正式版 1920×1080、60fps → out/kuka_ad_v2.mp4
#   --preview：960×540、60fps（一樣逐格）→ out/preview.mp4
# 專案路徑：環境變數 QUOKKA_DIR（預設是本資料夾往上兩層，也就是 quokka-pet/）
set -e
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8   # Windows：路徑有中文時 Python 要用 UTF-8 輸出，否則會寫到亂碼資料夾
D=$(cd "$(dirname "$0")" && pwd)
SCALE=1; NAME=kuka_ad_v2; JOBS=${JOBS:-2}; ONLY=""; CAPS=0; SKIP=0
while [ $# -gt 0 ]; do case "$1" in
  --preview) SCALE=0.5; NAME=preview ;;
  --only) ONLY="$2"; shift ;;
  --jobs) JOBS="$2"; shift ;;
  --caps) CAPS=1 ;;
  --skip-shots) SKIP=1 ;;
  *) echo "不認得的參數 $1"; exit 2 ;;
esac; shift; done
export QUOKKA_DIR=$(cd "${QUOKKA_DIR:-$D/../..}" && pwd)
PY=$(for p in python3 python; do "$p" -c "import numpy" >/dev/null 2>&1 && { command -v "$p"; break; }; done)
OUTD="$D/out"; SH="$OUTD/shots-$NAME"; mkdir -p "$SH" "$OUTD/logs"
for c in node ffmpeg ffprobe; do command -v $c >/dev/null || { echo "缺少 $c"; exit 1; }; done
$PY -c "import numpy" || { echo "缺少 Python numpy（pip install numpy）"; exit 1; }
[ -x "$(cd "$QUOKKA_DIR" && node -e "console.log(require('electron'))")" ] || { echo "找不到 Electron：請先在 $QUOKKA_DIR 執行 npm install"; exit 1; }
T0=$(date +%s)
# 1. 字卡（已附在 caps/；--caps 重新產生）
if [ $CAPS = 1 ] || [ ! -s "$D/caps/title.png" ]; then
  ELECTRON=$(cd "$QUOKKA_DIR" && node -e "console.log(require('electron'))")
  if command -v xvfb-run >/dev/null; then xvfb-run -a "$ELECTRON" "$D/capsapp" --no-sandbox "$D/caps" 2>&1 | grep -E "caps ok|Error" || true
  else "$ELECTRON" "$D/capsapp" "$D/caps" 2>&1 | grep -E "caps ok|Error" || true; fi
fi
# 2. 各鏡頭逐格算圖（真實程式＋虛擬時鐘）
SHOTS=$(node -e "console.log(require(process.argv[1]).ORDER.join(' '))" "$D/shots.js")
[ -n "$ONLY" ] && SHOTS=$(echo "$ONLY" | tr ',' ' ')
if [ $SKIP = 0 ]; then
  echo "算圖：$SHOTS（SCALE=$SCALE，同時 $JOBS 個）"
  printf '%s\n' $SHOTS | xargs -P "$JOBS" -I{} bash -c 'bash "$0/render_shot.sh" {} "$1/{}.mp4" "$2" > "$3/{}.log" 2>&1 && echo "  ✓ {} $(grep -o "done frames.*" "$3/{}.log" | tail -1)" || echo "  ✗ {}（看 $3/{}.log）"' "$D" "$SH" "$SCALE" "$OUTD/logs"
fi
# 3. 剪接＋字卡＋配樂＋音效 → 成片
$PY "$D/edit.py" "$SH" "$OUTD/$NAME.mp4" "$SCALE"
# 4. 檢查：每秒格數、響度、格圖
bash "$D/check.sh" "$OUTD/$NAME.mp4" "$OUTD/${NAME}_grid.png"
echo "完成：$OUTD/$NAME.mp4（$(( $(date +%s) - T0 )) 秒）"
