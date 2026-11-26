// 滑鼠快速繞圈偵測（lib/gesture.js）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCircleDetector } = require('../lib/gesture');

// 每 40 ms 取樣一次，餵進偵測器；回傳第幾個點觸發（沒觸發回傳 -1）
function feed(points) {
  const d = createCircleDetector();
  for (let i = 0; i < points.length; i++) if (d.push(points[i][0], points[i][1], i * 40)) return i;
  return -1;
}
const circle = (turns, ms, r = 80, cx = 600, cy = 500, dir = 1) => {
  const n = Math.round(ms / 40), out = [];
  for (let i = 0; i <= n; i++) { const a = dir * 2 * Math.PI * turns * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
};

test('快速繞 2 圈以上（1.2 秒繞 2.5 圈）：觸發；順時針、逆時針都可以', () => {
  assert.ok(feed(circle(2.5, 1200)) > 0);
  assert.ok(feed(circle(2.5, 1200, 80, 600, 500, -1)) > 0);
  assert.ok(feed(circle(3, 1000, 40)) > 0);                       // 小一點的圈也行
});

test('慢慢繞（3 秒才 2 圈）、只繞 1 圈、半徑太小（原地抖）：不觸發', () => {
  assert.equal(feed(circle(2, 3000)), -1);
  assert.equal(feed(circle(1, 600)), -1);
  assert.equal(feed(circle(4, 1200, 10)), -1);
});

test('直線來回、亂動、靜止：不觸發', () => {
  const line = []; for (let i = 0; i < 60; i++) line.push([400 + (i % 10) * 40 * (Math.floor(i / 10) % 2 ? -1 : 1), 300]);
  assert.equal(feed(line), -1);
  let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const jitter = []; for (let i = 0; i < 80; i++) jitter.push([500 + rnd() * 300, 400 + rnd() * 300]);
  assert.equal(feed(jitter), -1);
  assert.equal(feed(Array.from({ length: 60 }, () => [300, 300])), -1);
});

test('觸發一次後要重新繞才會再觸發', () => {
  const d = createCircleDetector();
  const pts = circle(5, 2000);
  let hits = 0;
  pts.forEach((p, i) => { if (d.push(p[0], p[1], i * 40)) hits++; });
  assert.ok(hits >= 1 && hits <= 2, `hits ${hits}`);
});

test('觸發時回傳繞圈的中心和半徑', () => {
  const d = createCircleDetector();
  let hit = null;
  circle(3, 1200, 90, 700, 420).forEach((p, i) => { const h = d.push(p[0], p[1], i * 40); if (h && !hit) hit = h; });
  assert.ok(hit);
  assert.ok(Math.abs(hit.x - 700) < 15 && Math.abs(hit.y - 420) < 15, JSON.stringify(hit));
  assert.ok(Math.abs(hit.r - 90) < 15);
});

test('取樣偶爾慢一拍（漏掉幾個點）仍然算繞圈', () => {
  const pts = circle(3, 1200).filter((_, i) => i % 9 !== 4);     // 每 9 個點掉 1 個（主行程忙的時候）
  const d = createCircleDetector();
  let hit = false, t = 0;
  for (const p of pts) { t += 40; if (d.push(p[0], p[1], t)) hit = true; }
  assert.ok(hit);
});
