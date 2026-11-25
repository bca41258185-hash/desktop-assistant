// 飾品系統：個體特徵抽飾品、3D 繪製不出錯、前後遮擋（頭歪很大時頭帶不會變光環）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../renderer/traits');
const ACC = require('../renderer/quokka-acc');
const Q = require('../renderer/quokka-pose');
const ART = require('../renderer/quokka-art');

const TYPES = Object.keys(ACC.TYPES);

test('目錄：traits 與繪圖模組的飾品種類一致，至少 10 種', () => {
  assert.ok(TYPES.length >= 10);
  assert.deepEqual(T.ACCESSORIES.map((a) => a.id).sort(), TYPES.slice().sort());
});

test('generate：每隻都有飾品，同一個 seed 結果相同；兩件時部位不同', () => {
  const seen = new Set();
  for (let s = 1; s <= 400; s++) {
    const a = T.generate(s), b = T.generate(s);
    assert.deepEqual(a.accessory, b.accessory);
    assert.ok(TYPES.includes(a.accessory.type));
    assert.match(a.accessory.color, /^#[0-9a-f]{6}$/i);
    if (a.accessory.type === 'band') assert.equal(a.accessory.color, a.band);
    if (a.accessory.extra) {
      const slot = (id) => T.ACCESSORIES.find((x) => x.id === id).slot;
      assert.notEqual(slot(a.accessory.type), slot(a.accessory.extra.type));
    }
    seen.add(a.accessory.type);
  }
  assert.equal(seen.size, TYPES.length);
});

test('舊資料沒有飾品：預設頭帶，顏色沿用 band', () => {
  assert.deepEqual(ACC.resolve(undefined, { band: '#3f7fd9' }), [{ type: 'band', color: '#3f7fd9' }]);
  assert.deepEqual(ACC.resolve(undefined, null), [{ type: 'band', color: undefined }]);
  assert.deepEqual(T.ensureAccessory({ band: '#3fa66b' }).accessory, { type: 'band', color: '#3fa66b' });
  assert.deepEqual(ACC.resolve('none', { band: '#3f7fd9' }), []);
  assert.deepEqual(ACC.resolve({ type: 'straw', color: '#e5533d', extra: { type: 'glasses' } }).map((a) => a.type), ['straw', 'glasses']);
});

test('每種飾品 16 個方位＋歪頭點頭都畫得出來，沒有 NaN', () => {
  for (const type of TYPES) {
    for (let i = 0; i < 16; i++) {
      const th = -180 + i * 22.5;
      const { svg } = Q.render(th, 't', { accessory: { type, color: '#3f7fd9' } });
      assert.ok(!/NaN|undefined/.test(svg), `${type} θ=${th}`);
      assert.ok(svg.includes('--acc:#3f7fd9'), `${type} θ=${th} 要有飾品顏色變數`);
    }
    const { svg } = Q.render(30, 't', { accessory: type, head: { roll: 28, pitch: -15, yaw: 20 }, lean: 8 });
    assert.ok(!/NaN|undefined/.test(svg), `${type} 歪頭`);
  }
});

// 實際畫出來的頭帶：數基本色那條線經過幾個環上的點（整圈＝72 點）
function bandPoints(th, head) {
  const { svg } = Q.render(th, 'v', { accessory: 'band', head });
  const paths = [...svg.matchAll(/<path d="([^"]+)" fill="none" style="stroke:var\(--acc[^"]*" stroke-width="[\d.]+" stroke-linejoin="round"/g)];
  return paths.reduce((n, m) => n + (m[1].match(/-?\d+(\.\d+)?/g) || []).length / 2, 0);
}

test('頭歪 20–30°（加點頭、轉頭）時頭帶只畫朝前的半圈，不會變成一整圈光環', () => {
  for (const roll of [-30, -25, -20, 20, 25, 30]) for (const th of [0, 45, 90, 135, 180, -45, -90, -135]) {
    for (const extra of [{}, { pitch: -14 }, { pitch: 12, yaw: 25 }]) {
      const n = bandPoints(th, { roll, ...extra });
      // 路徑每段是 Q 曲線（控制點＋終點）：半圈約 37 點 → 約 74 組座標；整圈會超過 140 組
      assert.ok(n > 40 && n < 100, `roll ${roll} θ=${th} ${JSON.stringify(extra)}：${n} 點`);
    }
  }
  const full = bandPoints(0, {});
  assert.ok(full > 40 && full < 100, `正面 ${full} 點`);
});

test('眼鏡轉到背面看不到；正面看得到', () => {
  const lens = (svg) => (svg.match(/<circle r="7.4" fill="none" style=/g) || []).length;
  assert.equal(lens(Q.render(0, 'g', { accessory: 'glasses' }).svg), 2);
  assert.equal(lens(Q.render(180, 'g', { accessory: 'glasses' }).svg), 0);
});

test('靜態方位圖也畫飾品，飾品顏色不會被毛色換色改到', () => {
  const t = T.generate(7);
  t.accessory = { type: 'beanie', color: '#3f7fd9' };
  ART.configure(t);
  const v = ART.views();
  ART.configure(null);
  assert.ok(v.front.includes('--acc:#3f7fd9'));
  assert.ok(v.a90.includes('--acc:#3f7fd9'));
  const map = T.colorMap(t);
  for (const a of T.ACCESSORIES) for (const c of a.colors) assert.ok(!(c.toLowerCase() in map), `${a.id} ${c} 與毛色撞色`);
});
