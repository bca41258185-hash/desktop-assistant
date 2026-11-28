#!/bin/bash
# 算一個鏡頭（逐格、60fps）：bash render_shot.sh <鏡頭名> <輸出.mp4> [SCALE]
#   SCALE 1＝正式版 1920×1080；0.5＝預覽 960×540（deviceScaleFactor 也跟著乘，庫卡一樣是程式本身畫的）
set -e
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8   # Windows：路徑有中文時 Python 要用 UTF-8 輸出，否則會寫到亂碼資料夾
D=$(cd "$(dirname "$0")" && pwd)
SHOT=$1; OUT=$2; SCALE=${3:-${SCALE:-1}}
QUOKKA_DIR=$(cd "${QUOKKA_DIR:-$D/../..}" && pwd)
PY=$(for p in python3 python; do "$p" -c "import numpy" >/dev/null 2>&1 && { command -v "$p"; break; }; done)
OUT=$($PY -c "import os,sys;print(os.path.abspath(sys.argv[1]))" "$OUT")
mkdir -p "$(dirname "$OUT")"
read W H DSF EPOCH < <(QUOKKA_DIR="$QUOKKA_DIR" node -e "const s=require(process.argv[1])[process.argv[2]];if(!s){console.error('沒有這個鏡頭');process.exit(2)}console.log(s.screen[0],s.screen[1],s.dsf,Date.parse(s.epoch||'2026-11-25T09:00:00+08:00'))" "$D/shots.js" "$SHOT")
DS=$($PY -c "print(round($DSF*$SCALE,4))")
XW=$($PY -c "import math;print(math.ceil($W*$DS))"); XH=$($PY -c "import math;print(math.ceil($H*$DS))")
ELECTRON=$(cd "$QUOKKA_DIR" && node -e "console.log(require('electron'))")
export SHOT OUT SCALE QUOKKA_DIR VC_EPOCH=$EPOCH TZ=Asia/Taipei QUOKKA_DEMO=1
export AD_WORK="${AD_WORK:-$D/out/work}"
export XDG_CONFIG_HOME="$AD_WORK/cfg-$SHOT-$SCALE-$$"   # 每次各用一份：上一輪沒關乾淨的程式鎖住舊資料夾也不影響
mkdir -p "$AD_WORK"
FILTER='Fontconfig|dbus|bus\.cc|libva|VA-API|Gtk-|ALSA|GPU|gpu_|viz_main|ui/gl|sandbox_linux|object_proxy|openssl|CommandBuffer|Frame latency'
if command -v xvfb-run >/dev/null 2>&1 && [ -z "$AD_NO_XVFB" ]; then
  # Linux：虛擬螢幕＝邏輯螢幕 × 縮放倍率，舞台剛好是 W×H 的邏輯大小
  timeout ${SHOT_TIMEOUT:-5400} xvfb-run -a -s "-screen 0 ${XW}x${XH}x24 -nolisten tcp" \
    "$ELECTRON" "$D/runner" --no-sandbox --force-device-scale-factor=$DS 2>&1 | grep --line-buffered -Ev "$FILTER" || true
else
  # 沒有 Xvfb（Windows／macOS）：直接在真的螢幕上開，主行程把螢幕大小改報成 W×H（實驗性，建議用 WSL2）
  export AD_FAKE_SCREEN="${W}x${H}"
  "$ELECTRON" "$D/runner" --force-device-scale-factor=$DS 2>&1 | grep --line-buffered -Ev "$FILTER" || true
fi
rm -rf "$XDG_CONFIG_HOME" 2>/dev/null || true
[ -s "$OUT" ] && [ -s "$OUT.json" ] || { echo "鏡頭 $SHOT 失敗"; exit 1; }
