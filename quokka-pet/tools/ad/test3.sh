#!/bin/bash
# 3 秒測試：逐格算圖 → 每格另存 PNG → ffmpeg -framerate 60 合成 → mpdecimate 量每秒不同畫格數
#   bash test3.sh [SCALE]
set -e
D=$(cd "$(dirname "$0")" && pwd); SCALE=${1:-1}
T="$D/out/test3"; rm -rf "$T"; mkdir -p "$T/png"
DUMP_PNG="$T/png" bash "$D/render_shot.sh" test3 "$T/pipe.mp4" "$SCALE"
ffmpeg -v error -y -framerate 60 -i "$T/png/%05d.png" -c:v libx264 -crf 12 -pix_fmt yuv420p "$T/test3.mp4"
echo "PNG：$(ls "$T/png" | wc -l) 張"
for s in 0 1 2; do
  k=$(ffmpeg -ss $s -t 1 -i "$T/test3.mp4" -vf mpdecimate,showinfo -f null - 2>&1 | grep -c "n:")
  echo "第 $((s+1)) 秒：不同畫格 $k / 60"
done
k=$(ffmpeg -i "$T/test3.mp4" -vf mpdecimate=hi=64*2:lo=64:frac=0.05,showinfo -f null - 2>&1 | grep -c "n:")
echo "嚴格門檻（hi=128 lo=64 frac=0.05）全片：$k / 180"
