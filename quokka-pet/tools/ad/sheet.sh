#!/bin/bash
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
# 檢查用格圖：bash sheet.sh in.mp4 out.png [每秒幾格] [欄數]
F=${3:-2}; C=${4:-4}
N=$(ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 "$1")
R=$(python -c "import math;print(max(1,math.ceil($N/60*$F/$C)))")
ffmpeg -v error -y -i "$1" -vf "fps=$F,scale=480:-2,drawtext=fontfile=/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc:text='%{pts\:hms}':x=4:y=4:fontsize=16:fontcolor=yellow:box=1:boxcolor=black,tile=${C}x${R}" -frames:v 1 "$2"
