// 頁面端的虛擬時鐘（在 stage.html／panel.html 的第一個 script 之前執行，main world）
// 覆寫 performance.now、Date、requestAnimationFrame、setTimeout／setInterval；CSS 動畫改由虛擬時間決定進度。
// __vc.advance(ms) 前進一格；__vc.settle() 等圖片解碼、canvas 轉檔都完成、畫面送出後才回來。
(function () {
  if (window.__vc) return;
  const RD = Date, rPerf = performance.now.bind(performance);
  const rST = window.setTimeout.bind(window), rCT = window.clearTimeout.bind(window), rRAF = window.requestAnimationFrame.bind(window);
  const DATE0 = Number(window.__VC_DATE0__) || RD.now();
  // 固定亂數種子：預覽與正式版的隨機選擇一樣
  let rs = (Number(window.__VC_SEED__) || 12345) >>> 0;
  Math.random = () => { rs = (rs + 0x6D2B79F5) >>> 0; let x = rs; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  let mode = 'real', shift = 0, vt = rPerf();
  let dateBase = DATE0 - vt;                   // Date.now() = dateBase + vt
  const vnow = () => { if (mode === 'real') vt = Math.max(vt, rPerf() - shift); return vt; };
  const timers = new Map(); let seq = 1;
  const add = (fn, ms, args, iv) => {
    if (typeof fn !== 'function') { if (typeof fn === 'string') { const s = fn; fn = () => (0, eval)(s); } else return 0; }
    ms = Math.max(0, Number(ms) || 0); if (iv && ms < 1) ms = 1;
    const id = seq++; timers.set(id, { id, fn, args, ms, iv, due: vnow() + ms, order: id }); return id;
  };
  window.setTimeout = (fn, ms, ...a) => add(fn, ms, a, false);
  window.setInterval = (fn, ms, ...a) => add(fn, ms, a, true);
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(Number(id)); };
  performance.now = () => vnow();
  class VDate extends RD {
    constructor(...a) { if (a.length === 0) super(Math.floor(dateBase + vnow())); else super(...a); }
    static now() { return Math.floor(dateBase + vnow()); }
  }
  VDate.parse = RD.parse; VDate.UTC = RD.UTC; window.Date = VDate;
  let rafs = new Map(), rafSeq = 1;
  window.requestAnimationFrame = (cb) => { const id = rafSeq++; rafs.set(id, cb); if (mode === 'real') kickReal(); return id; };
  window.cancelAnimationFrame = (id) => { rafs.delete(id); };
  function runDue(limit) {
    let n = 0;
    for (;;) {
      let best = null;
      for (const t of timers.values()) if (t.due <= limit && (!best || t.due < best.due || (t.due === best.due && t.order < best.order))) best = t;
      if (!best) return n;
      if (best.due > vt) vt = best.due;
      if (best.iv) { best.due += best.ms; best.order = seq++; } else timers.delete(best.id);
      try { best.fn(...best.args); } catch (e) { console.error(e); }
      if (++n > 20000) return n;
    }
  }
  function runRafs() {
    const list = rafs; rafs = new Map();
    for (const cb of list.values()) { try { cb(vt); } catch (e) { console.error(e); } }
  }
  // real 模式：真實 rAF 與計時器推動
  let realRaf = 0;
  function kickReal() { if (!realRaf) realRaf = rRAF(() => { realRaf = 0; if (mode !== 'real') return; runDue(vnow()); runRafs(); syncAnims(); if (rafs.size) kickReal(); }); }
  (function pump() { if (mode === 'real') { runDue(vnow()); } rST(pump, 4); })();
  // 圖片、canvas 的非同步工作：記數，settle 時等它們完成
  let pending = 0;
  const track = (p) => { pending++; const done = () => { pending--; }; p.then(done, done); return p; };
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true, enumerable: true, get() { return srcDesc.get.call(this); },
    set(v) {
      srcDesc.set.call(this, v);
      if (v && !this.complete) track(new Promise((res) => { const f = () => { this.removeEventListener('load', f); this.removeEventListener('error', f); res(); }; this.addEventListener('load', f); this.addEventListener('error', f); }));
    }
  });
  const dec = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function () { return track(dec.call(this)); };
  const tb = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (cb, ...a) { let r; track(new Promise((res) => { r = res; })); return tb.call(this, (b) => { try { cb(b); } finally { r(); } }, ...a); };
  // CSS 動畫／轉場：暫停，進度設成虛擬時間
  function syncAnims() {
    if (!document.getAnimations) return;
    for (const a of document.getAnimations()) {
      if (a.__vs == null) { a.__vs = vt - (Number(a.currentTime) || 0); }
      try { if (a.playState === 'running') a.pause(); a.currentTime = Math.max(0, vt - a.__vs); } catch (e) {}
    }
  }
  const raf2 = () => new Promise((r) => rRAF(() => rRAF(r)));
  const sleep = (ms) => new Promise((r) => rST(r, ms));
  window.__vc = {
    now: vnow,
    setDate(ms) { dateBase = ms - vnow(); },
    manual() { vnow(); mode = 'manual'; syncAnims(); },
    real() { shift = rPerf() - vt; mode = 'real'; for (const a of document.getAnimations()) { try { a.play(); } catch (e) {} delete a.__vs; } kickReal(); },
    advance(ms) {
      const target = vt + ms; runDue(target); vt = target; runRafs(); runDue(vt);
    },
    async settle(maxMs = 3000) {
      const t0 = rPerf();
      let quiet = 0;
      for (;;) {
        const n = runDue(vt);
        const imgs = [...document.images].filter((i) => i.src && !i.complete);
        if (!pending && !imgs.length && !n) { if (++quiet >= 2) break; } else quiet = 0;
        if (rPerf() - t0 > maxMs) { console.warn('[vc] settle timeout', pending, imgs.length); break; }
        await sleep(quiet ? 0 : 1);
      }
      syncAnims();
      await raf2();
      return true;
    },
    stats: () => ({ vt, timers: timers.size, rafs: rafs.size, pending, mode })
  };
})();
