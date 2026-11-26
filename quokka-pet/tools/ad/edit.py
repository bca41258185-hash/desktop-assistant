# 剪接＋字卡＋音效＋配樂 → 成片
#   python3 edit.py <鏡頭資料夾> <輸出.mp4> [SCALE]
# 鏡頭資料夾裡是 render_shot.sh 算好的 <鏡頭>.mp4 與 <鏡頭>.mp4.json（記錄擊球、反彈等時間）。
# 剪接點都對齊 120 BPM（一拍 0.5 秒），字卡在重拍上彈出。只剪接、疊字卡，不放大任何畫面。
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.abspath(sys.argv[1]); OUT = os.path.abspath(sys.argv[2]); SCALE = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
W, H = round(1920 * SCALE / 2) * 2, round(1080 * SCALE / 2) * 2
TMP = OUT + '.tmp'; os.makedirs(TMP, exist_ok=True)
CAPS = os.path.join(HERE, 'caps'); AUD = os.path.join(TMP, 'audio'); os.makedirs(AUD, exist_ok=True)
FPS = 60

# ---- 剪接表：(鏡頭, 入點秒, 出點秒)；章節：(名稱, 配樂段落) -----------------------------
EDL = []
CH = []          # (起點, 配樂段落類型)
EV = []          # 字卡：(png, 起, 迄, x 中心, y 中心, 樣式)
SFX = []         # (時間, 種類, 音量)
t = 0.0
def clip(shot, a, b, tag=None):
    global t
    EDL.append((shot, a, b, t)); s = t; t += b - a; return s
def chapter(kind): CH.append((t, kind))
def cap(png, a, b, x=960, y=150, style='pop'): EV.append((png, a, b, x, y, style))
def sfx(tt, kind, g=1.0): SFX.append((round(tt, 3), kind, g))
def marks(shot):
    p = os.path.join(SHOTS, shot + '.mp4.json')
    return json.load(open(p))['marks'] if os.path.exists(p) else []
def mark(shot, kind, i=0, default=None):
    m = [x['t'] for x in marks(shot) if x['kind'] == kind]
    return m[i] if len(m) > i else default
def map_marks(start, shot, a, b, kinds, fn):
    # 這個片段裡的事件（擊球、反彈）→ 成片時間
    for m in marks(shot):
        if m['kind'] in kinds and a <= m['t'] < b: fn(start + m['t'] - a, m)

# 1 鉤子：臉部特寫＋跳（慢動作），大字
chapter('hit')
s = clip('hook', 0.0, 3.5)
sfx(s + 0.42, 'bigpop', 1.0); sfx(s + 1.35, 'boing', .5)
cap('hook', s + 1.0, s + 3.5, 960, 250, 'big')
# 問題：雜亂桌面，庫卡走進來（快速閃過）
s = clip('desk', 1.0, 3.0)
sfx(s, 'whoosh', .5)
cap('problem', s + 0.0, s + 2.0, 960, 140)
# 被摸頭
s = clip('desk', 4.7, 7.7)
sfx(s + mark('desk', 'pat', 0, 5.1) - 4.7, 'pop', .8)
# 2 早上：看游標、伸懶腰
chapter('light')
s = clip('morning', 0.4, 4.4)
cap('t0855', s, s + 4.0, 190, 90, 'tag'); cap('morning', s + 0.5, s + 4.0, 960, 150)
s = clip('morning', 5.0, 7.5)
# 3 上班：面板交代、準時提醒
chapter('groove')
s = clip('work', 0.2, 6.7)
sfx(s, 'whoosh', .5)
cap('t0900', s, s + 6.5, 190, 90, 'tag'); cap('work', s + 0.5, s + 6.5, 1440, 960)
for k in ('enter1', 'enter2'):
    m = mark('work', k)
    if m: sfx(s + m - 0.2, 'pop', .8)
rs = mark('work', 'ringStart', 0, 8.4)
s = clip('work', rs + 1.6, rs + 7.4)
sfx(s + 0.4, 'ding', 1.0); sfx(s + 1.4, 'ding', .7)
cap('t0902', s, s + 5.8, 190, 90, 'tag'); cap('ring', s + 0.5, s + 5.8, 1440, 960)
ack = mark('work', 'ack')
if ack: sfx(s + ack - (rs + 1.6), 'pop', .9)
# 4 股價：漲停／跌停 左右分割
chapter('groove2')
s = clip('stock', 0.2, 5.7)
sfx(s, 'whoosh', .5)
lm = mark('stock', 'limit', 0, 0.6)
sfx(s + lm - 0.2 + 0.25, 'chime', .9); sfx(s + lm - 0.2 + 0.35, 'sad', .7)
cap('t0905', s, s + 5.5, 190, 90, 'tag')
cap('limitup', s + 1.0, s + 5.5, 480, 960); cap('limitdown', s + 1.5, s + 5.5, 1440, 960)
cap('fake', s, s + 5.5, 1780, 40, 'still')
STOCK = [(s, s + 5.5)]
# 同一檔股票，兩種說法
s = clip('talk', 0.6, 9.6)
cap('t1020', s, s + 9.0, 190, 90, 'tag')
cap('talk', s + 0.5, s + 9.0, 960, 975)
cap('cool', s, s + 9.0, 480, 200, 'still'); cap('clingy', s, s + 9.0, 1440, 200, 'still')
cap('fake', s, s + 9.0, 1780, 40, 'still')
# 5 分工：好幾隻、把事情交給另一隻
chapter('groove')
s = clip('team', 0.2, 2.6)
sfx(s, 'whoosh', .5)
for i in range(4): sfx(s + 0.1 + i * .22, 'pop', .6)
cap('t1100', s, s + 2.4, 190, 90, 'tag'); cap('team', s + 0.3, s + 2.4, 960, 975)
s = clip('team', 3.4, 9.4)
ho = mark('team', 'handoff', 0, 5.0)
sfx(s + ho - 3.4, 'pop', .9)
cap('handoff', s + ho - 3.4 + 0.3, s + 6.0, 1440, 960)
# 6 資料夾
chapter('light')
s = clip('folder', 0.4, 1.9)
sfx(s, 'whoosh', .5)
for i in range(3): sfx(s + 0.2 + i * .3, 'plip', .8)
cap('t1500', s, s + 6.0, 190, 90, 'tag')
s = clip('folder', 5.6, 10.1)
sfx(s + 0.4, 'pop', .8)
cap('folder', s + 0.5, s + 4.5, 1440, 960)
# 7 休息：一起玩（快速蒙太奇，切在拍子上）
chapter('sport')
PLAY = []
def playclip(shot, a, b, hitkind):
    s = clip(shot, a, b)
    map_marks(s, shot, a, b, ('hit',), lambda tt, m: sfx(tt, hitkind, .95))
    map_marks(s, shot, a, b, ('bounce',), lambda tt, m: sfx(tt, 'bounce', .8))
    PLAY.append(s); return s
s = playclip('play_bad', 3.2, 7.2, 'shuttle'); sfx(s, 'whoosh', .5)
cap('t1530', s, s + 4.0, 190, 90, 'tag'); cap('play', s + 0.5, s + 4.0, 960, 975)
playclip('play_vb', 2.6, 6.6, 'vbhit')
s = playclip('play_bb2', 5.4, 8.9, 'vbhit')
sfx(s + 0.9, 'spring', .9)
s = playclip('play_bb2', 12.2, 15.2, 'vbhit')
playclip('play_chase', 2.0, 5.0, 'shuttle')
# 8 傍晚：戀愛、生寶寶、跟著媽媽、長大
chapter('soft')
s = clip('love', 0.6, 5.6)
sfx(s, 'whoosh', .35); sfx(s + 1.5, 'twinkle', .6)
cap('t1800', s, s + 5.0, 190, 90, 'tag'); cap('love', s + 0.5, s + 5.0, 960, 150)
b = mark('love', 'birth', 0, 10)
s = clip('love', b - 0.8, b + 4.2)
sfx(s + 0.8, 'chime', .8)
cap('baby', s + 1.0, s + 5.0, 960, 150)
jo = mark('love', 'joeyOut', 0, 20)
fo = mark('love', 'follow', 0, jo + 4)
s = clip('love', jo - 0.3, jo + 2.7); sfx(s + 0.4, 'twinkle', .5)
s = clip('love', fo + 0.5, fo + 4.5)
cap('follow', s + 0.0, s + 4.0, 960, 150)
gr = mark('love', 'grown', 0, 40)
s = clip('love', gr + 0.6, gr + 4.6)
sfx(s + 0.4, 'twinkle', .6)
cap('grown', s + 0.5, s + 4.0, 960, 150)
# 9 下班：甩到頭暈（慢動作由程式虛擬時鐘處理）、離開打盹、回來打招呼
chapter('groove')
g = mark('dizzy', 'grab', 0, 0.4)
s = clip('dizzy', g - 0.3, g + 5.2)
sfx(s, 'whoosh', .5); sfx(s + 0.6, 'spring', .9); sfx(s + 2.2, 'boing', .9); sfx(s + 3.0, 'spring', .6)
cap('dizzy', s + 2.5, s + 5.5, 960, 150)
chapter('soft')
lv = mark('away', 'asleep', 0, 3)
s = clip('away', lv - 0.6, lv + 3.4)
sfx(s, 'whoosh', .35)
cap('t1940', s, s + 4.0, 190, 90, 'tag'); cap('away', s + 0.5, s + 4.0, 960, 150)
bk = mark('away', 'back', 0, 10)
s = clip('away', bk - 0.5, bk + 6.0)
sfx(s + 1.0, 'chime', .6)
cap('back', s + 1.0, s + 6.5, 960, 975)
# 10 片尾：全部一起跳（慢動作）→ 標題、標語、行動呼籲
chapter('end')
END = t
s = clip('finale', 0.2, 4.9)
sfx(s + 0.25, 'bigpop', .8)
for i in range(7): sfx(s + 0.3 + i * .04, 'pop', .35)
TITLE = s + 3.0
FREEZE = 4.0
END_T = t + FREEZE
cap('title', TITLE, END_T, 960, 200, 'drop')
cap('tagline', TITLE + 1.0, END_T, 960, 400, 'pop')
cap('cta', TITLE + 2.0, END_T, 960, 530, 'pop')

TOTAL = t + FREEZE
for _, a, b, *_ in EV:
    pass
for png, a, b, x, y, st in EV:
    if st in ('pop', 'big', 'drop'): sfx(a, 'pop', .4)
print('TOTAL', round(TOTAL, 2), 'clips', len(EDL))

# ---- 1. 剪接（逐格精準，60fps）-------------------------------------------------------------
def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: print(' '.join(cmd)[:2000]); print(r.stderr[-3000:]); sys.exit(1)
inp, fc = [], []
srcs = {}
for i, (shot, a, b, st) in enumerate(EDL):
    if shot not in srcs: srcs[shot] = len(srcs); inp += ['-i', os.path.join(SHOTS, shot + '.mp4')]
for i, (shot, a, b, st) in enumerate(EDL):
    fa, fb = round(a * FPS), round(b * FPS)
    tp = f",tpad=stop_mode=clone:stop_duration={FREEZE}" if i == len(EDL) - 1 else ''
    fc.append(f"[{srcs[shot]}:v]trim=start_frame={fa}:end_frame={fb},setpts=PTS-STARTPTS,scale={W}:{H}:flags=area{tp}[c{i}]")
fc.append(''.join(f'[c{i}]' for i in range(len(EDL))) + f"concat=n={len(EDL)}:v=1:a=0[v]")
CAT = os.path.join(TMP, 'cat.mp4')
run(['ffmpeg', '-v', 'error', '-y'] + inp + ['-filter_complex', ';'.join(fc), '-map', '[v]', '-r', str(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', CAT])
print('cat ok')

# ---- 2. 配樂＋音效 ----------------------------------------------------------------------
secs = []
for i, (a, k) in enumerate(CH): secs.append([a, CH[i + 1][0] if i + 1 < len(CH) else TOTAL + 2, k])
plan = {'total': TOTAL, 'secs': secs, 'endChord': round((TITLE) / 2) * 2, 'sfx': sorted(SFX)}
json.dump(plan, open(os.path.join(AUD, 'plan.json'), 'w'), ensure_ascii=False, indent=0)
run([sys.executable, os.path.join(HERE, 'music.py'), AUD])
MIX = os.path.join(AUD, 'mix.wav')
# 響度 -16 LUFS、真峰值 < -1 dBTP：兩段式 loudnorm（先量再正規化）
r = subprocess.run(['ffmpeg', '-hide_banner', '-i', os.path.join(AUD, 'mix_raw.wav'), '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True)
js = r.stderr[r.stderr.rindex('{'):r.stderr.rindex('}') + 1]; m = json.loads(js)
run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(AUD, 'mix_raw.wav'), '-af',
     f"loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,aresample=48000",
     '-ar', '48000', MIX])
print('audio ok')

# ---- 3. 字卡疊圖（彈跳進場）＋輸出 ----------------------------------------------------------
inp = ['-i', CAT, '-i', MIX]; fc = []; last = '0:v'; k = 2
def bounce(a, f=13): return f"(1-exp(-7*(t-{a}))*cos({f}*(t-{a})))"
for png, a, b, x, y, st in EV:
    inp += ['-loop', '1', '-framerate', str(FPS), '-t', f'{b - a + .1:.3f}', '-i', os.path.join(CAPS, png + '.png')]
    S = SCALE
    fo = f",fade=t=out:st={b - .2:.3f}:d=0.2:alpha=1" if b < TOTAL - .05 else ''
    if st in ('pop', 'big'):
        fc.append(f"[{k}:v]format=rgba,setpts=PTS-STARTPTS+{a}/TB,scale=w='max(4,trunc(iw*{S}*max(0.02,{bounce(a)})/2)*2)':h=-2:eval=frame{fo}[c{k}]")
        ov = f"x='{x * S}-w/2':y='{y * S}-h/2'"
    elif st == 'tag':
        fc.append(f"[{k}:v]format=rgba,setpts=PTS-STARTPTS+{a}/TB,scale=w=trunc(iw*{S}/2)*2:h=-2{fo}[c{k}]")
        ov = f"x='{x * S}-w/2-({400 * S})*exp(-9*(t-{a}))':y='{y * S}-h/2'"
    elif st == 'drop':
        fc.append(f"[{k}:v]format=rgba,setpts=PTS-STARTPTS+{a}/TB,scale=w=trunc(iw*{S}/2)*2:h=-2{fo}[c{k}]")
        ov = f"x='{x * S}-w/2':y='{y * S}-h/2-{420 * S}*exp(-5*(t-{a}))*cos(10*(t-{a}))'"
    else:
        fc.append(f"[{k}:v]format=rgba,setpts=PTS-STARTPTS+{a}/TB,scale=w=trunc(iw*{S}/2)*2:h=-2{fo}[c{k}]")
        ov = f"x='min(W-w-6,{x * S}-w/2)':y='max(6,{y * S}-h/2)'"
    fc.append(f"[{last}][c{k}]overlay={ov}:enable='between(t,{a:.3f},{b:.3f})':eof_action=pass[v{k}]"); last = f'v{k}'; k += 1
fc.append(f"[{last}]fade=t=out:st={TOTAL - .6:.3f}:d=0.6:color=white[vout]")
CRF = os.environ.get('CRF', '16')
run(['ffmpeg', '-v', 'error', '-y'] + inp + ['-filter_complex', ';'.join(fc), '-map', '[vout]', '-map', '1:a', '-t', f'{TOTAL:.3f}', '-r', str(FPS),
     '-c:v', 'libx264', '-preset', os.environ.get('X264_PRESET', 'medium'), '-crf', CRF, '-profile:v', 'high', '-pix_fmt', 'yuv420p',
     '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', OUT])
json.dump({'total': TOTAL, 'edl': EDL, 'caps': EV, 'chapters': CH}, open(OUT + '.edl.json', 'w'), ensure_ascii=False, indent=1)
print('done', OUT)
