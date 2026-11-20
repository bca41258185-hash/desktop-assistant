// 預告片配樂：用撥弦合成（Karplus-Strong）做一段五聲音階的古箏風小曲，輸出 WAV。
// 用法：node music.js <輸出.wav> [秒數]
// 全部是程式合成的聲音，沒有使用任何現成的音樂或取樣。

const fs = require('fs');

const out = process.argv[2] || 'music.wav';
const SECONDS = Number(process.argv[3]) || 64;
const SR = 44100;
const N = SR * SECONDS;
const L = new Float32Array(N);
const R = new Float32Array(N);

// 固定種子的亂數，讓每次產生的音樂都一樣
let seed = 20261121;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

// 撥一根弦：頻率 f、開始時間 t（秒）、音量、左右位置（0＝左，1＝右）
function pluck(f, t, gain, pan) {
  const period = Math.max(2, Math.round(SR / f));
  const buf = new Float32Array(period);
  for (let i = 0; i < period; i++) buf[i] = rnd() * 2 - 1;
  // 先把雜訊磨圓一點，音色比較柔
  for (let k = 0; k < 2; k++) for (let i = 1; i < period; i++) buf[i] = (buf[i] + buf[i - 1]) * 0.5;
  const start = Math.round(t * SR);
  const len = Math.min(N - start, Math.round(SR * 4.5));
  let idx = 0;
  const decay = 0.9965;
  for (let i = 0; i < len; i++) {
    const cur = buf[idx];
    const nxt = buf[(idx + 1) % period];
    buf[idx] = (cur + nxt) * 0.5 * decay;
    idx = (idx + 1) % period;
    const attack = Math.min(1, i / 60);
    const s = cur * gain * attack;
    L[start + i] += s * (1 - pan * 0.7);
    R[start + i] += s * (0.3 + pan * 0.7);
  }
}

// D 宮五聲：D E F# A B
const hz = (semi) => 293.66 * Math.pow(2, semi / 12);
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const BEAT = 0.5;               // 每拍 0.5 秒（120 BPM），旋律走得慢，用二分、四分音符

// 旋律：[音階位置, 拍數]，-1 是休止
const PHRASES = [
  [[2, 2], [4, 1], [5, 1], [4, 2], [2, 2]],
  [[3, 2], [4, 1], [2, 1], [1, 2], [0, 2]],
  [[2, 1], [3, 1], [4, 2], [5, 1], [7, 1], [5, 2]],
  [[4, 2], [3, 1], [2, 1], [1, 2], [2, 2]],
  [[5, 2], [7, 1], [8, 1], [7, 2], [5, 2]],
  [[4, 1], [5, 1], [4, 2], [2, 1], [1, 1], [0, 2]]
];
let t = 1.0;
let phrase = 0;
while (t < SECONDS - 6) {
  const p = PHRASES[phrase % PHRASES.length];
  // 每句開頭撥一個低音，像古箏的左手
  pluck(hz(SCALE[p[0][0] % 5] - 12), t, 0.32, 0.25);
  for (const [deg, beats] of p) {
    if (deg >= 0) {
      pluck(hz(SCALE[deg]), t, 0.5, 0.35 + (deg / 10) * 0.4);
      // 偶爾加一個高八度的裝飾音
      if (rnd() < 0.22) pluck(hz(SCALE[deg] + 12), t + BEAT * 0.5, 0.16, 0.8);
    }
    t += beats * BEAT;
  }
  // 句尾的琶音收束
  if (phrase % 2 === 1) [0, 2, 4, 5].forEach((d, i) => pluck(hz(SCALE[d]), t - BEAT * 2 + i * 0.09, 0.2, 0.6));
  phrase += 1;
}

// 簡單的殘響：幾條延遲線疊加
function reverb(ch) {
  const taps = [[0.043, 0.28], [0.071, 0.22], [0.113, 0.18], [0.167, 0.12]];
  const wet = new Float32Array(N);
  for (const [sec, g] of taps) {
    const d = Math.round(sec * SR);
    for (let i = d; i < N; i++) wet[i] += (ch[i - d] + wet[i - d] * 0.35) * g;
  }
  for (let i = 0; i < N; i++) ch[i] += wet[i] * 0.6;
}
reverb(L);
reverb(R);

// 淡入淡出、整體音量正規化
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const norm = 0.7 / (peak || 1);
const fadeIn = SR * 1.5;
const fadeOut = SR * 4;
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  const env = Math.min(1, i / fadeIn) * Math.min(1, (N - i) / fadeOut);
  pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * norm * env * 32767))), i * 4);
  pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * norm * env * 32767))), i * 4 + 2);
}
const head = Buffer.alloc(44);
head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8);
head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22);
head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34);
head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(out, Buffer.concat([head, pcm]));
console.log('music written:', out, SECONDS + 's');
