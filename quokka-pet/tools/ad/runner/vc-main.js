// 主行程的虛擬時鐘：覆寫 Date、setTimeout、setInterval。
// mode 'real'：跟著真實時間走（開機、載入用）；mode 'manual'：只有 advance(ms) 才前進（逐格算圖用）。
// 程式自己的排程（提醒、股價輪詢、離開偵測、資料夾合併…）都用這個時鐘，所以快轉時由程式自己觸發。
const RD = Date;
const R = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout, setInterval: global.setInterval, clearInterval: global.clearInterval };
const hr = () => Number(process.hrtime.bigint()) / 1e6;
const EPOCH = Number(process.env.VC_EPOCH) || RD.now();       // 虛擬「牆上時間」的起點
let mode = 'real', shift = hr(), vt = 0;
const vnow = () => { if (mode === 'real') vt = Math.max(vt, hr() - shift); return vt; };
let rs = (Number(process.env.VC_SEED) || 777) >>> 0;
Math.random = () => { rs = (rs + 0x6D2B79F5) >>> 0; let x = rs; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const timers = new Map();
let seq = 1;
class VTimeout {
  constructor(id) { this.id = id; }
  ref() { return this; } unref() { return this; } hasRef() { return true; }
  refresh() { const t = timers.get(this.id); if (t) t.due = vnow() + t.ms; return this; }
  close() { timers.delete(this.id); return this; }
  [Symbol.toPrimitive]() { return this.id; }
}
function add(fn, ms, args, iv) {
  if (typeof fn !== 'function') return new VTimeout(0);
  ms = Math.max(iv ? 1 : 0, Number(ms) || 0);
  const id = seq++;
  timers.set(id, { id, fn, args, ms, iv, due: vnow() + ms, order: id });
  return new VTimeout(id);
}
const clr = (h) => { if (h == null) return; timers.delete(typeof h === 'object' ? h.id : Number(h)); };
global.setTimeout = (fn, ms, ...a) => add(fn, ms, a, false);
global.setInterval = (fn, ms, ...a) => add(fn, ms, a, true);
global.clearTimeout = clr; global.clearInterval = clr;
class VDate extends RD {
  constructor(...a) { if (a.length === 0) super(Math.floor(EPOCH + vnow())); else super(...a); }
  static now() { return Math.floor(EPOCH + vnow()); }
}
VDate.parse = RD.parse; VDate.UTC = RD.UTC;
global.Date = VDate;
// 沒給日期的 Intl 格式化也用虛擬時間
const DTF = Intl.DateTimeFormat;
const fmtDesc = Object.getOwnPropertyDescriptor(DTF.prototype, 'format');
Object.defineProperty(DTF.prototype, 'format', { configurable: true, get() { const f = fmtDesc.get.call(this); return (d) => f(d === undefined ? new VDate() : d); } });
const fpOrig = DTF.prototype.formatToParts;
DTF.prototype.formatToParts = function (d) { return fpOrig.call(this, d === undefined ? new VDate() : d); };

function runDue(limit) {
  let n = 0;
  for (;;) {
    let best = null;
    for (const t of timers.values()) if (t.due <= limit && (!best || t.due < best.due || (t.due === best.due && t.order < best.order))) best = t;
    if (!best) return n;
    if (best.due > vt) vt = best.due;
    if (best.iv) { best.due += best.ms; best.order = seq++; } else timers.delete(best.id);
    try { best.fn(...best.args); } catch (e) { console.error('[vc-main] timer error', e); }
    if (++n > 100000) { console.error('[vc-main] runaway timers'); return n; }
  }
}
// real 模式：用真實計時器推動
let pump = null;
function startPump() { if (!pump) pump = R.setInterval(() => { if (mode === 'real') runDue(vnow()); }, 4); }
startPump();
const VC = {
  R, now: vnow, epoch: EPOCH, dateNow: () => EPOCH + vnow(),
  manual() { vnow(); mode = 'manual'; },
  real() { shift = hr() - vt; mode = 'real'; },
  advance(ms) { const target = vt + ms; runDue(target); vt = target; },
  // 快轉：一大段時間（不算圖）
  jump(ms, step = 1000) { const end = vt + ms; while (vt < end) VC.advance(Math.min(step, end - vt)); },
  pending: () => timers.size,
  timers: () => [...timers.values()],
  get mode() { return mode; }
};
global.__vc = VC;
module.exports = VC;
