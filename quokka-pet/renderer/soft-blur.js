// 柔邊橢圓：把「套高斯模糊濾鏡的實心橢圓／圓」換成「放射漸層填色的橢圓」，看起來一樣、省很多算力
//   濾鏡每用一次，畫面就要多開一張暫存圖、模糊完再疊回來；一隻短尾矮袋鼠每格有十幾個模糊的橢圓（腮紅、陰影、鼻頭的暗面……），
//   六隻一起動就是每秒上萬次。放射漸層只是填色，幾乎不花力氣。
//   漸層的深淺是照真的高斯模糊算出來的（在橢圓周圍取點，算「模糊後還剩多少顏色」），所以邊緣柔和的程度、
//   小橢圓模糊後中心變淡的程度都一樣；濾鏡區域（x/y/width/height 百分比）裁掉的地方也照樣裁掉。
//   只換「實心填色、沒有描邊、數字座標」的橢圓／圓；其他（路徑、描邊、漸層填色）原樣保留濾鏡。
//   用法：SB.apply(svg)  ── 會先讀 svg 裡的 <filter>（只有 feGaussianBlur 的那種）記住每個 id 的模糊半徑，
//         雙人互動的 defs 和圖層分開傳進來也可以（記住的 id 會保留）。
(function (root) {
  const blurOf = new Map();                       // 濾鏡 id → { s: 模糊半徑, w, h: 濾鏡區域寬高（相對外框的倍數，null＝不限） }
  const grads = new Map();                        // 漸層 key → id
  const GRAD_MAX = 2500;                          // 上限（漸層很小；超過就照舊用濾鏡）
  const FILTER_RE = /<filter\b([^>]*)>\s*<feGaussianBlur stdDeviation="([\d.]+)"\s*\/>\s*<\/filter>/g;
  const RX = {};
  const attr = (s, n) => { const m = s.match(RX[n] || (RX[n] = new RegExp('(?:^|\\s)' + n + '="([^"]*)"'))); return m ? m[1] : null; };
  function learn(svg) {
    if (svg.indexOf('feGaussianBlur') < 0) return;
    FILTER_RE.lastIndex = 0;
    let m;
    while ((m = FILTER_RE.exec(svg))) {
      const a = m[1], id = attr(a, 'id'); if (!id) continue;
      const user = attr(a, 'filterUnits') === 'userSpaceOnUse';
      const pc = (v) => (v && /%$/.test(v) ? parseFloat(v) / 100 : null);
      blurOf.set(id, { s: +m[2], w: user ? null : pc(attr(a, 'width')) || 1.2, h: user ? null : pc(attr(a, 'height')) || 1.2 });
    }
    if (blurOf.size > 6000) blurOf.clear();
  }
  // 高斯核（±3σ，13×13）
  const N = 13, K = [];
  { let sum = 0; for (let i = 0; i < N; i++) { const x = (i - (N - 1) / 2) / ((N - 1) / 6); const w = Math.exp(-x * x / 2); K.push([x, w]); sum += w; } for (const k of K) k[1] /= sum; }
  // 模糊後，點 (px, py) 還剩多少（0..1）
  function cover(px, py, rx, ry, s) {
    let v = 0;
    for (const [dx, wx] of K) {
      const x = (px + dx * s) / rx, xx = x * x; if (xx > 1) continue;
      for (const [dy, wy] of K) { const y = (py + dy * s) / ry; if (xx + y * y <= 1) v += wx * wy; }
    }
    return v;
  }
  const q = (v) => (v < 6 ? Math.round(v * 4) / 4 : +Math.exp(Math.round(Math.log(v) / 0.04) * 0.04).toFixed(3));
  // 回傳 { id, def, R: [Rx, Ry] }；def 是第一次要放進文件的漸層
  function gradFor(rx, ry, b, color) {
    const s = b.s;
    // 漸層畫在放大的橢圓上（多 3σ），但不超過濾鏡區域（超過的部分原本就被裁掉）
    let Rx = rx + 3 * s, Ry = ry + 3 * s;
    if (b.w) Rx = Math.min(Rx, rx * b.w); if (b.h) Ry = Math.min(Ry, ry * b.h);   // 區域半寬＝外框半寬 × width%
    // 漸層的深淺只跟「半徑／σ」有關 → 比例量化後共用（小的每 0.25σ 一級、大的每 4% 一級，邊緣誤差 < 0.15σ）；
    // 橢圓本身照實際大小畫，動作裡橢圓慢慢變大也不會一格一格跳
    const kx = q(rx / s), ky = q(ry / s);
    const ex = b.w ? Math.min(kx + 3, kx * b.w) : kx + 3, ey = b.h ? Math.min(ky + 3, ky * b.h) : ky + 3;
    const key = color + '|' + kx + '|' + ky + '|' + b.w + '|' + b.h;        // ex、ey 由 kx、ky 和濾鏡區域決定，不必放進 key
    let g = grads.get(key), fresh = false;
    if (!g) {
      if (grads.size >= GRAD_MAX) return null;
      const id = 'sbg' + grads.size;
      const STOPS = 14; let st = '';
      for (let i = 0; i <= STOPS; i++) {
        const t = i / STOPS;
        const a = (cover(t * ex, 0, kx, ky, 1) + cover(0, t * ey, kx, ky, 1)) / 2;
        st += `<stop offset="${+t.toFixed(3)}" stop-color="${color}" stop-opacity="${+a.toFixed(3)}"/>`;
      }
      g = { id, def: `<radialGradient id="${id}">${st}</radialGradient>` }; grads.set(key, g); fresh = true;
    }
    return { id: g.id, def: g.def, fresh, R: [Rx, Ry] };
  }
  const EL_RE = /<(ellipse|circle)\b([^>]*?)\sfilter="url\(#([^)"]+)\)"([^>]*?)\/>/g;
  const NUM = /^-?[\d.]+$/;
  //   opt.sink(def)：新的漸層交給呼叫的人放進文件裡共用的 <defs>（每個只給一次）；沒有 sink 就每次都附在 svg 裡
  function apply(svg, opt) {
    learn(svg);
    if (!blurOf.size) return svg;
    const sink = opt && opt.sink, used = new Set();
    let defs = '';
    const out = svg.replace(EL_RE, (m, tag, a1, fid, a2) => {
      const b = blurOf.get(fid); if (!b) return m;
      const a = a1 + a2;
      if (/\sstroke=/.test(a) || /\sstyle=/.test(a) || /\sfill-opacity=/.test(a)) return m;
      const fill = attr(a, 'fill') || '#000000';
      if (!/^#[0-9a-fA-F]{3,6}$/.test(fill)) return m;
      let rx, ry;
      if (tag === 'circle') { const r = attr(a, 'r'); if (!r || !NUM.test(r)) return m; rx = ry = +r; }
      else { const x = attr(a, 'rx'), y = attr(a, 'ry'); if (!x || !y || !NUM.test(x) || !NUM.test(y)) return m; rx = +x; ry = +y; }
      if (!(rx > 0 && ry > 0)) return m;
      const g = gradFor(rx, ry, b, fill.toLowerCase()); if (!g) return m;
      if (sink) { if (g.fresh) sink(g.def); } else if (!used.has(g.id)) { used.add(g.id); defs += g.def; }
      const rest = a.replace(/\s(?:r|rx|ry|fill)="[^"]*"/g, '');
      return `<ellipse${rest} rx="${+g.R[0].toFixed(2)}" ry="${+g.R[1].toFixed(2)}" fill="url(#${g.id})"/>`;
    });
    if (!defs) return out;
    // 漸層放在最前面（同一個 id 內容永遠一樣，live 繪製時會被搬進共用的 defs）
    const i = out.indexOf('>', out.indexOf('<svg') >= 0 ? out.indexOf('<svg') : 0);
    return out.indexOf('<svg') >= 0 ? out.slice(0, i + 1) + '<defs>' + defs + '</defs>' + out.slice(i + 1) : '<defs>' + defs + '</defs>' + out;
  }
  const api = { apply, learn, _cover: cover, info: () => ({ filters: blurOf.size, grads: grads.size }) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QuokkaSoftBlur = api;
})(typeof window !== 'undefined' ? window : globalThis);
