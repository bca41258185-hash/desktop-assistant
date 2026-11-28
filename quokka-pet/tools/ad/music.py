# 原創配樂＋音效（python3 music.py <資料夾>：讀 plan.json，寫 mix_raw.wav）
#（numpy 合成，不使用任何外部素材）。120 BPM，一小節 2 秒，段落對齊分鏡。
import numpy as np, json, sys, wave
import os
AUD = sys.argv[1]
PLAN = json.load(open(os.path.join(AUD, 'plan.json')))
SR = 48000; BPM = 120; B = 60 / BPM; DUR = PLAN['total']
rng = np.random.default_rng(7)
N = int(SR * (DUR + 2)); L = np.zeros(N); R = np.zeros(N)
def env(n, a=0.004, d=0.3):
    t = np.arange(n) / SR; e = np.exp(-t / d); k = int(a * SR)
    if k > 0: e[:k] *= np.linspace(0, 1, k)
    return e
def add(sig, t, pan=0.0, g=1.0):
    i = int(t * SR); j = min(N, i + len(sig))
    if i >= N or j <= i: return
    s = sig[:j - i] * g; L[i:j] += s * np.sqrt((1 - pan) / 2) * 1.414 / 1.414; R[i:j] += s * np.sqrt((1 + pan) / 2)
def f(m): return 440 * 2 ** ((m - 69) / 12)
def marimba(m, dur=0.5, g=0.5):
    n = int(SR * max(dur, 0.6)); t = np.arange(n) / SR; fr = f(m)
    s = np.sin(2 * np.pi * fr * t) * env(n, .002, .28) + .35 * np.sin(2 * np.pi * fr * 4 * t) * env(n, .001, .05) + .12 * np.sin(2 * np.pi * fr * 10 * t) * env(n, .001, .015)
    return s * g
def glock(m, g=0.3):
    n = int(SR * 1.4); t = np.arange(n) / SR; fr = f(m)
    s = np.sin(2 * np.pi * fr * t) * env(n, .001, .6) + .4 * np.sin(2 * np.pi * fr * 2.76 * t) * env(n, .001, .25) + .2 * np.sin(2 * np.pi * fr * 5.4 * t) * env(n, .001, .08)
    return s * g
def bass(m, dur=0.45, g=0.5):
    n = int(SR * dur); t = np.arange(n) / SR; fr = f(m)
    s = np.sin(2 * np.pi * fr * t) + .3 * np.sin(4 * np.pi * fr * t) + .1 * np.sin(6 * np.pi * fr * t)
    e = np.minimum(1, t / .005) * np.exp(-t / .35); e[-200:] *= np.linspace(1, 0, 200)
    return s * e * g
def kick(g=0.9):
    n = int(SR * .35); t = np.arange(n) / SR; ph = 2 * np.pi * np.cumsum(50 + 110 * np.exp(-t / .03)) / SR
    return np.sin(ph) * np.exp(-t / .12) * g
def noise(n): return rng.standard_normal(n)
def hp(x, a=.85):
    y = np.zeros_like(x); p = 0; px = 0
    for i in range(len(x)): p = a * (p + x[i] - px); px = x[i]; y[i] = p
    return y
HH = hp(noise(int(SR * .06))) * env(int(SR * .06), .0005, .018)
SN = (hp(noise(int(SR * .2)), .6) * env(int(SR * .2), .001, .06) * .7 + np.sin(2 * np.pi * 190 * np.arange(int(SR * .2)) / SR) * env(int(SR * .2), .001, .05) * .5)
def _cl():
    out = np.zeros(int(SR * .14))
    for d in (0, .012, .024):
        s = hp(noise(int(SR * .08)), .7) * env(int(SR * .08), .0005, .02); i = int(SR * d); out[i:i + len(s)] += s
    return out * .5
CL = _cl()
def shaker(g=.12): return hp(noise(int(SR * .05)), .9) * env(int(SR * .05), .01, .015) * g
# 和弦進行（C 大調）：C Am F G ／ 柔情段 F G Em Am
PROG = [(48, [60, 64, 67]), (45, [57, 60, 64]), (41, [57, 60, 65]), (43, [55, 59, 62])]
SOFT = [(41, [57, 60, 65]), (43, [55, 59, 62]), (40, [55, 59, 64]), (45, [57, 60, 64])]
# 主旋律動機（每小節 8 個八分音符，None＝休止），依和弦挑音
MOT = [[72, None, 76, 79, 76, None, 74, 72], [69, None, 72, 76, 74, 72, None, 69], [72, 74, 77, None, 76, 74, 72, None], [71, None, 74, 79, None, 77, 74, 71]]
MOT2 = [[79, 76, 79, 84, None, 79, 76, None], [76, 72, 76, 81, None, 79, 76, 72], [77, None, 81, 84, 81, None, 77, 76], [79, 81, 83, None, 86, None, 83, 79]]
# 段落：(起, 迄, 類型)
SECS = [tuple(x) for x in PLAN['secs']]
END_AT = PLAN['endChord']
def sec_at(t):
    for a, b, k in SECS:
        if a <= t < b: return k
    return 'end'
bar = 0
while bar * 2 < DUR:
    t0 = bar * 2.0; k = sec_at(t0 + .01)
    if k == 'hit':
        if bar == 0:
            add(kick(1.1), 0.0); add(CL, 0.0, g=1.0); add(bass(36, 1.2, .7), 0.0)
            for m in [60, 64, 67, 72]: add(marimba(m, 1.2, .3), 0.0)
            add(glock(84, .3), 0.0)
        k = 'intro'
    prog = SOFT if k == 'soft' else PROG
    root, ch = prog[bar % 4]
    if k == 'end':
        if t0 < END_AT - 0.01:   # 片尾前段：上行琶音
            for i, m in enumerate([60, 64, 67, 72, 76, 79, 84, 88]): add(glock(m, .22), t0 + i * B / 2, pan=(i % 2) * .4 - .2)
            add(bass(36, 1.8, .55), t0); add(kick(), t0)
        elif t0 < END_AT + 1.99:  # 大和弦
            for m in [48, 55, 60, 64, 67, 72, 76]: add(marimba(m, 2.5, .3), t0)
            add(kick(1.0), t0); add(CL, t0, g=.9); add(bass(36, 3.5, .7), t0)
            for m in [72, 76, 79, 84, 88]: add(glock(m, .28), t0 + .02)
            for i in range(24): add(shaker(.05), t0 + .5 + i * .06, pan=.3)
        bar += 1; continue
    # 和弦（木琴輕敲：每拍反拍）
    if k != 'intro' or bar >= 2:
        for beat in range(4):
            if k in ('break', 'soft') and beat % 2: continue
            for m in ch: add(marimba(m, .4, .11 if k != 'soft' else .13), t0 + beat * B + (B / 2 if k not in ('soft', 'break') else 0), pan=-.3)
    # 貝斯
    if k not in ('intro', 'break'):
        pat = [0, 1.5, 2, 3] if k in ('groove', 'groove2', 'sport') else [0, 2]
        for p in pat: add(bass(root + (12 if p == 1.5 else 0) + (7 if p == 3 and k == 'sport' else 0), .45 if k != 'soft' else 1.0, .42), t0 + p * B)
    # 鼓
    if k in ('groove', 'groove2', 'sport', 'light'):
        for beat in range(4):
            if beat in (0, 2) or (k == 'sport' and beat == 3 and bar % 2): add(kick(.75 if k != 'light' else .5), t0 + beat * B)
            if beat in (1, 3) and k != 'light': add(SN if k == 'sport' else CL, t0 + beat * B, g=.5)
            for h in (0, .5): add(HH, t0 + (beat + h) * B, pan=.4, g=.22 if h else .14)
        if k == 'sport':
            for s in range(16): add(shaker(), t0 + s * B / 4, pan=-.5)
    if k == 'soft':
        add(kick(.35), t0)
        for s in range(8): add(shaker(.06), t0 + s * B / 2, pan=.5)
    # 旋律
    mel = MOT2 if k in ('sport', 'groove2') else MOT
    m8 = mel[bar % 4]
    if k == 'intro':
        if bar < 2: m8 = [None, None, 79, None, 76, None, 72, None] if bar == 0 else [None, 74, None, 76, None, 79, None, None]
    if k == 'break': m8 = [72, None, None, 79, None, None, 76, None]
    if k == 'soft': m8 = [m if i % 2 == 0 else None for i, m in enumerate(m8)]
    for i, m in enumerate(m8):
        if m is None: continue
        if k == 'soft' or k == 'intro' or k == 'break': add(glock(m, .26), t0 + i * B / 2, pan=.25)
        else: add(marimba(m, .3, .34), t0 + i * B / 2, pan=.15); add(glock(m + 12, .06), t0 + i * B / 2, pan=.3)
    # 段落轉換前的小過門（最後半拍鼓花）
    nxt = sec_at(t0 + 2.01)
    if nxt != k and k not in ('intro',):
        for s in range(4): add(SN, t0 + 1.5 + s * B / 8 * 2, g=.18 + s * .06)
    bar += 1
# ---- 音效 ------------------------------------------------------------------------------
def ding():
    n = int(SR * 1.6); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 1568 * t) * env(n, .001, .5) + .5 * np.sin(2 * np.pi * 2093 * t) * env(n, .001, .35) + .25 * np.sin(2 * np.pi * 4330 * t) * env(n, .001, .08)) * .55
def pop():
    n = int(SR * .12); t = np.arange(n) / SR; ph = 2 * np.pi * np.cumsum(500 + 1400 * t / .12) / SR
    return np.sin(ph) * env(n, .001, .035) * .6
def boing():
    n = int(SR * .5); t = np.arange(n) / SR; fr = 220 + 90 * np.sin(2 * np.pi * 9 * t) * np.exp(-t / .2)
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * env(n, .002, .18) * .6
def bounce():
    n = int(SR * .25); t = np.arange(n) / SR; ph = 2 * np.pi * np.cumsum(140 * np.exp(-t / .08) + 60) / SR
    return (np.sin(ph) * env(n, .001, .07) + hp(noise(n), .5) * env(n, .0005, .01) * .25) * .8
def whoosh():
    n = int(SR * .45); x = noise(n); y = np.zeros(n); a = 0
    for i in range(n): c = .02 + .25 * np.sin(np.pi * i / n); a += c * (x[i] - a); y[i] = a
    return y * np.sin(np.pi * np.arange(n) / n) ** 2 * .5
def tick():
    n = int(SR * .03); return hp(noise(n), .7) * env(n, .0003, .006) * .25
def plip():
    n = int(SR * .2); t = np.arange(n) / SR; return np.sin(2 * np.pi * np.cumsum(900 + 700 * t / .2) / SR) * env(n, .001, .05) * .4
def sad():
    n = int(SR * .7); t = np.arange(n) / SR; return np.sin(2 * np.pi * np.cumsum(420 - 200 * t / .7) / SR) * env(n, .01, .3) * .45
def chime():
    out = np.zeros(int(SR * 1.2))
    for i, m in enumerate([84, 88, 91]): s = glock(m, .3); j = int(i * .08 * SR); out[j:j + len(s)] += s[:len(out) - j]
    return out
def twinkle():
    out = np.zeros(int(SR * 1.0))
    for i, m in enumerate([96, 93, 96, 93]): s = glock(m, .12); j = int(i * .11 * SR); out[j:j + len(s)] += s[:len(out) - j]
    return out
def shuttle():
    n = int(SR * .09); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 1250 * t) * env(n, .0005, .012) + hp(noise(n), .6) * env(n, .0003, .008) * .6) * .9
def vbhit():
    n = int(SR * .18); t = np.arange(n) / SR; ph = 2 * np.pi * np.cumsum(260 * np.exp(-t / .04) + 90) / SR
    return (np.sin(ph) * env(n, .0008, .05) + hp(noise(n), .4) * env(n, .0004, .012) * .5) * .95
def spring():
    n = int(SR * .8); t = np.arange(n) / SR; fr = 330 + 260 * np.sin(2 * np.pi * 11 * t) * np.exp(-t / .35)
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * env(n, .003, .3) * .55
def bigpop():
    n = int(SR * .25); t = np.arange(n) / SR; ph = 2 * np.pi * np.cumsum(300 + 1800 * (t / .25) ** .5) / SR
    return (np.sin(ph) * env(n, .001, .07) + .3 * np.sin(2 * ph) * env(n, .001, .03)) * .8
def dong():
    n = int(SR * 1.2); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 392 * t) * env(n, .002, .45) + .4 * np.sin(2 * np.pi * 784 * t) * env(n, .002, .2)) * .5
SFX = dict(shuttle=shuttle(), vbhit=vbhit(), spring=spring(), bigpop=bigpop(), dong=dong(), ding=ding(), pop=pop(), boing=boing(), bounce=bounce(), whoosh=whoosh(), tick=tick(), plip=plip(), sad=sad(), chime=chime(), twinkle=twinkle())
mus = np.stack([L, R]); mus /= np.abs(mus).max() + 1e-9; mus *= .55
L2 = np.zeros(N); R2 = np.zeros(N)
for t, kind, g in PLAN['sfx']:
    s = SFX[kind] * g; i = int(t * SR); j = min(N, i + len(s))
    if i < N: L2[i:j] += s[:j - i]; R2[i:j] += s[:j - i]
mix = mus + np.stack([L2, R2]) * .9
n = int(SR * DUR); mix = mix[:, :n]
fo = int(SR * 1.0); mix[:, -fo:] *= np.linspace(1, 0, fo)
mix /= np.abs(mix).max() / 0.89
w = wave.open(os.path.join(AUD, 'mix_raw.wav'), 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((mix.T * 32767).astype('<i2').tobytes()); w.close()
print('ok', mix.shape)
