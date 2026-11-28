// 滑鼠手勢：快速繞圈（1.5 秒內繞滿 2 圈、半徑 25–600 px）→ 回傳 { x, y, r }（繞圈的中心與半徑；主行程用來從那裡下落葉雨），沒有就回傳 false
// 做法：最近 1.5 秒的游標點，以它們的中心為圓心，累加相鄰兩點之間轉過的角度；
// 同一個方向轉滿 2 圈（720°）、幾乎每一步都同方向、平均半徑夠大、每一圈都有走出圓形（不是原地抖動）才算。
(function () {
  function createCircleDetector({ windowMs = 1500, minTurns = 2, minRadius = 25, maxRadius = 600 } = {}) {
    let pts = [];
    function push(x, y, t) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) return false;
      const last = pts[pts.length - 1];
      if (last && last.x === x && last.y === y) { pts = pts.filter((p) => t - p.t <= windowMs); return false; }   // 沒動
      pts.push({ x, y, t });
      pts = pts.filter((p) => t - p.t <= windowMs);
      if (pts.length < 12) return false;
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const rs = pts.map((p) => Math.hypot(p.x - cx, p.y - cy)), r = rs.reduce((s, v) => s + v, 0) / rs.length;
      if (r < minRadius || r > maxRadius) return false;
      if (rs.filter((v) => v < r * 0.35).length > pts.length * 0.2) return false;            // 很多點靠近中心：不是在繞圈
      const ds = [];
      for (let i = 1; i < pts.length; i++) {
        let d = Math.atan2(pts[i].y - cy, pts[i].x - cx) - Math.atan2(pts[i - 1].y - cy, pts[i - 1].x - cx);
        if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
        ds.push(d);
      }
      const sum = ds.reduce((s, d) => s + d, 0);
      if (Math.abs(sum) < minTurns * 2 * Math.PI) return false;
      // 真的在繞圈：幾乎每一步都往同一個方向轉、而且一步不會跳太大（亂動時角度忽正忽負、忽大忽小）
      if (ds.filter((d) => Math.sign(d) === Math.sign(sum)).length < ds.length * 0.85) return false;
      if (ds.filter((d) => Math.abs(d) > 2).length > ds.length * 0.15) return false;    // 偶爾取樣慢了一拍、跳一大步沒關係；常常跳就是亂動
      pts = [];                                                                               // 觸發一次就清掉，要重新繞
      return { x: Math.round(cx), y: Math.round(cy), r: Math.round(r) };
    }
    return { push, reset: () => { pts = []; } };
  }
  module.exports = { createCircleDetector };
})();
