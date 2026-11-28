// 看得見的感情：伴侶靠得近、兩隻都閒著時，偶爾轉頭互看、中間冒愛心
//   （偷偷喜歡的偷看、四目相對冒愛心在 stage-actor 的 glanceAt；這裡只管已經是一對的）
(function () {
  const S = window.Stage;
  const idle = (a) => a && a.mode === 'awake' && !a.job && !a.inPouch && !a.dragging;
  setInterval(() => {
    if (S.mode === 'hidden' || S.reduceMotion) return;
    const seen = new Set();
    for (const a of S.actors.values()) {
      const p = a.attach && a.attach.partner && S.actors.get(a.attach.partner);
      if (!p || seen.has(a.id) || seen.has(p.id)) continue;
      seen.add(a.id); seen.add(p.id);
      if (!idle(a) || !idle(p) || Math.abs(a.x - p.x) > 320 || Math.abs(a.y - p.y) > 60 || Math.random() > .35) continue;
      a.showLook(p.x < a.x ? 'L' : 'R'); p.showLook(a.x < p.x ? 'L' : 'R');
      S.burst((a.x + p.x) / 2, Math.min(a.y - 150 * a.k, p.y - 150 * p.k), 'hearts');
      setTimeout(() => { for (const q of [a, p]) if (!q.job) { q.lookBucket = null; q.showRest(); } }, 1400);
    }
  }, 20000);
})();
