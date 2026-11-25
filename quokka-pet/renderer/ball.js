// 球視窗：只負責畫球和轉動；位置與物理由主行程計算
(function () {
  const el = document.getElementById('ball');
  const kind = new URLSearchParams(location.search).get('kind') === 'bball' ? 'bball' : 'vball';
  let last = null;
  const draw = (rot) => {
    const r = Math.round(rot / 6) * 6;            // 每 6 度才重畫一次，省資源
    if (r === last) return;
    last = r;
    el.innerHTML = window.QuokkaPose.ballSVG(kind, r);
  };
  draw(0);
  window.ballApi.onState((s) => { draw(s.rot || 0); if (s.fade) el.style.opacity = '0'; });
})();
