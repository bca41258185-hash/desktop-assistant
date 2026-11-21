// 預告片的聲音：配樂＋音效，全部用程式合成（沒有使用任何現成的音樂或取樣），輸出 WAV。
// 用法：node music.js <輸出.wav> <秒數> [events.json]
//
// events.json 是錄影時記下的時間點 [{ t: 秒, type: 名稱 }, …]（舞台頁用 console.log('SFX:名稱') 發出）。
// 配樂的結構跟著其中三個時間點走：
//   開場 → 'drop'：低音嗡鳴＋越來越快的滴答聲（緊張）
//   'drop' → 'sting'：進節奏（鼓、低音、撥弦旋律）
//   'sting'：音樂突然停掉（冷場笑點），'end' 再一聲收尾
// 沒有 events.json 時用預設時間，方便單獨試聽。

const fs = require('fs');

const out = process.argv[2] || 'music.wav';
const SECONDS = Number(process.argv[3]) || 60;
let events = [];
try { if (process.argv[4]) events = JSON.parse(fs.readFileSync(process.argv[4], 'utf8')); } catch (e) { events = []; }

const SR = 44100;
const N = Math.round(SR * SECONDS);
const L = new Float32Array(N);
const R = new Float32Array(N);

let seed = 20261121;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function put(i, s, pan) {
  if (i < 0 || i >= N) return;
  L[i] += s * (1 - pan * 0.6);
  R[i] += s * (0.4 + pan * 0.6);
}

// ---------- 基本音色 ----------
// 正弦音：頻率可從 f0 滑到 f1，指數衰減
function tone(t, dur, f0, f1, gain, pan, decay) {
  const start = Math.round(t * SR);
  const len = Math.round(dur * SR);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const x = i / len;
    const f = f0 * Math.pow(f1 / f0, x);
    ph += 2 * Math.PI * f / SR;
    const env = Math.exp(-x * (decay || 5)) * Math.min(1, i / 40);
    put(start + i, Math.sin(ph) * gain * env, pan === undefined ? 0.5 : pan);
  }
}
// 雜訊：一階低通／高通，cut0→cut1 是濾波頻率的滑動
function noise(t, dur, gain, pan, opts) {
  const o = opts || {};
  const start = Math.round(t * SR);
  const len = Math.round(dur * SR);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const x = i / len;
    const cut = (o.cut0 || 4000) * Math.pow((o.cut1 || o.cut0 || 4000) / (o.cut0 || 4000), x);
    const a = Math.min(1, 2 * Math.PI * cut / SR);
    const w = rnd() * 2 - 1;
    lp += a * (w - lp);
    const s = o.high ? w - lp : lp;
    const env = (o.swell ? Math.sin(Math.PI * x) : Math.exp(-x * (o.decay || 6))) * Math.min(1, i / 30);
    put(start + i, s * gain * env, pan === undefined ? 0.5 : pan);
  }
}
// 撥弦（Karplus-Strong）
function pluck(t, f, gain, pan, bright) {
  const period = Math.max(2, Math.round(SR / f));
  const buf = new Float32Array(period);
  for (let i = 0; i < period; i++) buf[i] = rnd() * 2 - 1;
  for (let k = 0; k < (bright ? 1 : 3); k++) for (let i = 1; i < period; i++) buf[i] = (buf[i] + buf[i - 1]) * 0.5;
  const start = Math.round(t * SR);
  const len = Math.min(N - start, Math.round(SR * 2.2));
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = buf[idx];
    buf[idx] = (cur + buf[(idx + 1) % period]) * 0.5 * 0.996;
    idx = (idx + 1) % period;
    put(start + i, cur * gain * Math.min(1, i / 50), pan === undefined ? 0.5 : pan);
  }
}
// 鋸齒波（低通過），做搞笑的「哇——」
function saw(t, dur, f0, f1, gain) {
  const start = Math.round(t * SR);
  const len = Math.round(dur * SR);
  let ph = 0;
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const x = i / len;
    const f = f0 * Math.pow(f1 / f0, x);
    ph = (ph + f / SR) % 1;
    lp += 0.12 * ((ph * 2 - 1) - lp);
    put(start + i, lp * gain * Math.sin(Math.PI * Math.min(1, x * 1.15)) , 0.5);
  }
}

// ---------- 打擊 ----------
const kick = (t, g) => { tone(t, 0.26, 150, 42, 0.95 * (g || 1), 0.5, 5); noise(t, 0.03, 0.25 * (g || 1), 0.5, { cut0: 3000, decay: 8 }); };
const clap = (t, g) => { for (const d of [0, 0.011, 0.023]) noise(t + d, 0.11, 0.3 * (g || 1), 0.55, { cut0: 1800, high: true, decay: 9 }); };
const hat = (t, g) => noise(t, 0.035, 0.11 * (g || 1), 0.7, { cut0: 7000, high: true, decay: 7 });
const wood = (t, f, g, pan) => tone(t, 0.07, f, f * 0.96, g || 0.3, pan, 9);

// ---------- 時間點 ----------
const at = (type) => events.filter((e) => e.type === type).map((e) => e.t);
const T_DROP = at('drop')[0] !== undefined ? at('drop')[0] : 6.5;
const T_STING = at('sting')[0] !== undefined ? at('sting')[0] : SECONDS - 9;
const T_END = at('end')[0] !== undefined ? at('end')[0] : SECONDS - 6.5;
const hz = (semi) => 293.66 * Math.pow(2, semi / 12);      // 以 D4 為 0

// ---------- 開場：低鳴＋滴答 ----------
{
  const len = Math.round(T_DROP * SR);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < len; i++) {
    const x = i / len;
    p1 += 2 * Math.PI * 73.42 / SR;
    p2 += 2 * Math.PI * 110.0 / SR;
    const swell = 0.10 + 0.22 * x * x;
    const trem = 0.75 + 0.25 * Math.sin(2 * Math.PI * (2 + 5 * x) * i / SR);
    const s = (Math.sin(p1) + 0.6 * Math.sin(p2)) * swell * trem * Math.min(1, i / 8000) * Math.min(1, (len - i) / 2500);
    put(i, s, 0.5);
  }
  // 滴答越來越高（計數器每跳一次一聲）
  at('tick').forEach((t, i) => wood(t, 620 * Math.pow(2, i / 14), 0.34, i % 2 ? 0.3 : 0.7));
  // 蓋章前的上升雜訊
  const stamp = at('thump')[0];
  if (stamp !== undefined && stamp < T_DROP) noise(Math.max(0, stamp - 1.3), 1.3, 0.2, 0.5, { cut0: 300, cut1: 6000, swell: true });
}

// ---------- 節奏段：'drop' → 'sting' ----------
const BPM = 126;
const BEAT = 60 / BPM;
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];          // D 宮五聲
const ROOTS = [0, -3, -7, -5];                              // D、B、G、A
// 一小節八個八分音符的旋律型（音階位置，-1 休止）
const RIFFS = [
  [4, 5, 7, 5, 4, 2, 4, -1],
  [5, 7, 8, 7, 5, 4, 2, -1],
  [2, 4, 5, 4, 7, 5, 4, 2],
  [7, -1, 5, 4, 5, 7, 9, -1]
];
function groove(from, to, level) {
  let bar = 0;
  for (let t = from; t < to - 0.05; t += BEAT * 4, bar++) {
    const root = ROOTS[bar % 4];
    const riff = RIFFS[bar % RIFFS.length];
    for (let e = 0; e < 8; e++) {
      const te = t + e * BEAT / 2;
      if (te >= to) break;
      if (level >= 1) {
        if (e === 0 || e === 3 || e === 4) kick(te, e === 3 ? 0.7 : 1);
        if (e === 2 || e === 6) clap(te);
      } else if (e === 0 || e === 4) kick(te, 0.55);
      hat(te, e % 2 ? 1.3 : 0.7);
      if (e === 0 || e === 3 || e === 6) pluck(te, hz(root - 24), 0.5, 0.45);
      const deg = riff[e];
      if (deg >= 0) {
        pluck(te, hz(SCALE[deg]), 0.34, 0.3 + deg * 0.05, true);
        if (level >= 1 && e % 4 === 0) pluck(te, hz(SCALE[deg] + 12), 0.12, 0.8, true);
      }
    }
  }
}
// 進節奏的那一下：大鼓＋和弦
kick(T_DROP, 1.25);
noise(T_DROP, 0.9, 0.3, 0.5, { cut0: 9000, high: true, decay: 3.2 });
[0, 4, 7, 12, 16].forEach((s, i) => pluck(T_DROP + i * 0.018, hz(s), 0.3, 0.3 + i * 0.1, true));
groove(T_DROP, T_STING, 1);

// ---------- 冷場：'sting' 一聲「哇——」，音樂停掉 ----------
saw(T_STING + 0.05, 0.34, 196, 190, 0.42);
saw(T_STING + 0.42, 0.62, 147, 104, 0.42);

// ---------- 收尾：'end' ----------
kick(T_END, 1.25);
noise(T_END, 1.2, 0.3, 0.5, { cut0: 9000, high: true, decay: 2.6 });
[0, 4, 7, 12, 16, 19].forEach((s, i) => pluck(T_END + i * 0.02, hz(s), 0.34, 0.25 + i * 0.1, true));
groove(T_END, SECONDS - 2.6, 0.5);
[0, 7, 12, 16, 19, 24].forEach((s, i) => pluck(SECONDS - 2.6 + i * 0.05, hz(s), 0.36, 0.25 + i * 0.1, true));

// ---------- 音效 ----------
const FX = {
  pop: (t) => tone(t, 0.08, 520, 980, 0.3, 0.5, 4),
  click: (t) => { noise(t, 0.012, 0.5, 0.5, { cut0: 5000, high: true, decay: 3 }); tone(t, 0.03, 1900, 1500, 0.3, 0.5, 6); },
  type: (t) => { noise(t, 0.008, 0.22, 0.5, { cut0: 6000, high: true, decay: 3 }); tone(t, 0.012, 2400, 2200, 0.12, 0.5, 6); },
  thump: (t) => { kick(t, 1.3); noise(t, 0.2, 0.35, 0.5, { cut0: 500, decay: 6 }); },
  whoosh: (t) => noise(t, 0.3, 0.2, 0.5, { cut0: 400, cut1: 5000, swell: true }),
  boing: (t) => { tone(t, 0.16, 200, 520, 0.3, 0.5, 2.5); tone(t + 0.13, 0.2, 520, 380, 0.24, 0.5, 4); },
  ding: (t) => { tone(t, 0.7, 1318.5, 1318.5, 0.2, 0.6, 6); tone(t, 0.5, 2637, 2637, 0.09, 0.6, 8); },
  alert: (t) => { tone(t, 0.11, 880, 880, 0.26, 0.5, 4); tone(t + 0.12, 0.2, 1174.7, 1174.7, 0.26, 0.5, 5); },
  yes: (t) => [12, 16, 19, 24].forEach((s, i) => { pluck(t + i * 0.055, hz(s), 0.4, 0.3 + i * 0.13, true); tone(t + i * 0.055, 0.25, hz(s) * 2, hz(s) * 2, 0.07, 0.6, 7); }),
  fanfare: (t) => { [0, 7, 12, 16, 19, 24, 28].forEach((s, i) => pluck(t + i * 0.045, hz(s), 0.42, 0.2 + i * 0.1, true)); tone(t + 0.3, 0.9, 2349.3, 2349.3, 0.12, 0.6, 5); noise(t, 0.7, 0.18, 0.5, { cut0: 9000, high: true, decay: 3.5 }); },
  send: (t) => { noise(t, 0.22, 0.2, 0.5, { cut0: 600, cut1: 7000, swell: true }); tone(t + 0.12, 0.12, 700, 1500, 0.26, 0.5, 4); },
  talkA: (t) => [0, 0.07, 0.15].forEach((d, i) => wood(t + d, 300 + i * 25, 0.26, 0.55)),
  talkB: (t) => [0, 0.07, 0.15].forEach((d, i) => wood(t + d, 430 + (2 - i) * 30, 0.26, 0.3))
};
for (const e of events) if (FX[e.type]) FX[e.type](e.t);

// ---------- 殘響、正規化、淡出 ----------
function reverb(ch) {
  const taps = [[0.031, 0.2], [0.057, 0.16], [0.089, 0.12]];
  const wet = new Float32Array(N);
  for (const [sec, g] of taps) {
    const d = Math.round(sec * SR);
    for (let i = d; i < N; i++) wet[i] += (ch[i - d] + wet[i - d] * 0.3) * g;
  }
  for (let i = 0; i < N; i++) ch[i] += wet[i] * 0.5;
}
reverb(L);
reverb(R);
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const norm = 0.92 / (peak || 1);
const soft = (x) => Math.tanh(x * 1.25) / Math.tanh(1.25);   // 輕微壓縮，整體聽起來比較滿
const fadeOut = SR * 1.6;
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  const env = Math.min(1, (N - i) / fadeOut);
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, soft(L[i] * norm) * env)) * 32767), i * 4);
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, soft(R[i] * norm) * env)) * 32767), i * 4 + 2);
}
const head = Buffer.alloc(44);
head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8);
head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22);
head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34);
head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(out, Buffer.concat([head, pcm]));
console.log('sound written:', out, SECONDS.toFixed(1) + 's', 'events=' + events.length, 'drop=' + T_DROP.toFixed(2), 'sting=' + T_STING.toFixed(2), 'end=' + T_END.toFixed(2));
