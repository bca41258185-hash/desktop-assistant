// 柔邊橢圓：只換實心、沒描邊、數字座標的模糊橢圓；路徑和描邊的照舊用濾鏡
const test = require('node:test');
const assert = require('node:assert');
const SB = require('../renderer/soft-blur.js');

const DEFS = '<defs><filter id="b1T" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.2"/></filter>'
  + '<filter id="fzT"><feTurbulence baseFrequency=".3"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter></defs>';

test('實心的模糊橢圓／圓 → 放射漸層，濾鏡拿掉、半徑放大', () => {
  const out = SB.apply('<svg viewBox="0 0 10 10">' + DEFS + '<ellipse cx="5" cy="5" rx="4" ry="3" fill="#F0907C" opacity=".3" filter="url(#b1T)"/><circle cx="1" cy="1" r="2" fill="#000" filter="url(#b1T)"/></svg>');
  assert.ok(!/<ellipse[^>]*filter=/.test(out) && !/<circle/.test(out));
  assert.match(out, /<ellipse cx="5" cy="5" opacity=".3" rx="7.6" ry="6.6" fill="url\(#sbg\d+\)"\/>/);
  assert.match(out, /<radialGradient id="sbg\d+">.*stop-color="#f0907c"/);
});

test('描邊、路徑、不是純模糊的濾鏡：原樣保留', () => {
  const src = '<svg>' + DEFS + '<ellipse cx="0" cy="0" rx="4" ry="3" fill="none" stroke="#000" filter="url(#b1T)"/><path d="M0 0L5 5" fill="#000" filter="url(#b1T)"/><ellipse cx="0" cy="0" rx="4" ry="3" fill="#000" filter="url(#fzT)"/><ellipse cx="0" cy="0" rx="4" ry="3" fill="url(#g)" filter="url(#b1T)"/></svg>';
  assert.strictEqual(SB.apply(src), src);
});

test('濃淡照高斯模糊：中心接近全滿、邊上約一半、外面歸零；小橢圓中心變淡', () => {
  assert.ok(SB._cover(0, 0, 10, 10, 1) > .99);
  assert.ok(Math.abs(SB._cover(10, 0, 10, 10, 1) - .5) < .06);
  assert.ok(SB._cover(13.5, 0, 10, 10, 1) < .01);
  assert.ok(SB._cover(0, 0, 1, 1, 1) < .5);
});

test('交給 sink：同一個漸層只給一次', () => {
  const got = [];
  const src = '<svg>' + DEFS + '<ellipse cx="0" cy="0" rx="5" ry="5" fill="#123456" filter="url(#b1T)"/></svg>';
  SB.apply(src, { sink: (d) => got.push(d) }); SB.apply(src, { sink: (d) => got.push(d) });
  assert.strictEqual(got.length, 1);
  assert.ok(!/radialGradient/.test(SB.apply(src, { sink: () => {} })));
});

test('相鄰兩個毛邊／模糊濾鏡合成一組；飾品濾鏡、不相鄰的不動', () => {
  const a = '<path d="M0 0" fill="none" stroke="#000" opacity=".2" filter="url(#fzL1)"/><path d="M1 1" fill="url(#bgL1)" filter="url(#fzL1)"/>';
  assert.strictEqual(SB.merge(a), '<g filter="url(#fzL1)"><path d="M0 0" fill="none" stroke="#000" opacity=".2"/><path d="M1 1" fill="url(#bgL1)"/></g>');
  const b = '<path d="M0 0" filter="url(#acZL1)"/><path d="M1 1" filter="url(#acZL1)"/><path d="M0 0" filter="url(#fzL1)"/><ellipse rx="1" ry="1"/><path d="M1 1" filter="url(#fzL1)"/>';
  assert.strictEqual(SB.merge(b), b);
});
