// 身體上的毛（幾百條固定位置的短線）預先畫成一張高解析度的圖：
//   毛的位置是固定亂數、不跟著姿勢動（外面有身體輪廓裁切），每格重畫幾百條線很花力氣（顯示卡約四分之一的工作）。
//   第一次看到某一組毛時照原樣畫（<use> 共用定義），同時在背景畫成圖；畫好之後每格只貼這張圖。
//   FI.get(inner) → { href, x, y, w, h } 或 null（還沒畫好）
(function (root) {
  const RES = 4;                                    // 每個 SVG 單位畫幾個像素（螢幕上約 1 像素 → 4 倍）
  const done = new Map();                           // inner → { st, href, x, y, w, h }
  function box(inner) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const m of inner.matchAll(/[xy][12]="(-?[\d.]+)"/g)) {
      const v = +m[1], isX = m[0][0] === 'x';
      if (isX) { if (v < x0) x0 = v; if (v > x1) x1 = v; } else { if (v < y0) y0 = v; if (v > y1) y1 = v; }
    }
    if (!(x1 > x0 && y1 > y0)) return null;
    x0 = Math.floor(x0 - 2); y0 = Math.floor(y0 - 2); x1 = Math.ceil(x1 + 2); y1 = Math.ceil(y1 + 2);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function make(inner) {
    const b = box(inner), e = { st: 'wait' }; done.set(inner, e);
    if (!b) { e.st = 'bad'; return; }
    const k = RES * Math.max(1, root.devicePixelRatio || 1), W = Math.ceil(b.w * k), H = Math.ceil(b.h * k);
    const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" width="${W}" height="${H}">${inner}</svg>`;
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').drawImage(im, 0, 0, W, H); URL.revokeObjectURL(im.src);
      c.toBlob((bl) => { c.width = c.height = 0; if (!bl) { e.st = 'bad'; return; } Object.assign(e, b, { href: URL.createObjectURL(bl), st: 'ok' }); }, 'image/png');
    };
    im.onerror = () => { e.st = 'bad'; URL.revokeObjectURL(im.src); };
    im.src = URL.createObjectURL(new Blob([doc], { type: 'image/svg+xml' }));
  }
  function get(inner) {
    const e = done.get(inner);
    if (!e) { if (done.size < 60) make(inner); return null; }
    return e.st === 'ok' ? e : null;
  }
  const tag = (e) => `<image href="${e.href}" x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" preserveAspectRatio="none"/>`;
  root.QuokkaFurImage = { get, tag, info: () => ({ n: done.size, ok: [...done.values()].filter((e) => e.st === 'ok').length }) };
})(window);
