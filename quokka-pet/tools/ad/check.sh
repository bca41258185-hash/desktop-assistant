#!/bin/bash
# 成片檢查：bash check.sh 影片.mp4 格圖.png
#   · 每秒不同畫格數（mpdecimate）  · 響度（-16 LUFS、真峰值 < -1 dBTP）  · 每秒一格的格圖（附時間）
V="$1"; G="$2"
PY=$(command -v python3 || command -v python)
ffprobe -v error -select_streams v -show_entries stream=width,height,r_frame_rate,codec_name,profile -of compact=p=0 "$V"
ffprobe -v error -select_streams a -show_entries stream=codec_name,sample_rate,channels -of compact=p=0 "$V"
N=$(ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 "$V")
K=$(ffmpeg -i "$V" -vf mpdecimate,showinfo -f null - 2>&1 | grep -c "n:")
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$V")
echo "畫格 $N，長度 ${DUR}s，mpdecimate 保留 $K（平均每秒 $($PY -c "print(round($K/$DUR,1))") 個不同畫格；片尾定格與靜止畫面會被算成重複）"
ffmpeg -hide_banner -i "$V" -af ebur128=peak=true -f null - 2>&1 | grep -A12 "Summary" | grep -E "I:|Peak:|LRA:" | sed 's/^ */響度 /'
FONT=$(fc-match -f '%{file}' 'WenQuanYi Zen Hei' 2>/dev/null || true)
DT=""; [ -n "$FONT" ] && DT=",drawtext=fontfile=$FONT:text='%{pts\:hms}':x=4:y=4:fontsize=18:fontcolor=yellow:box=1:boxcolor=black@0.7"
ROWS=$($PY -c "import math;print(math.ceil(float('$DUR')/8))")
ffmpeg -v error -y -i "$V" -vf "fps=1,scale=320:-2$DT,tile=8x$ROWS" -frames:v 1 "$G" && echo "格圖：$G"
