// 預告片用：讓助手畫面（renderer/pet.js）在沒有主行程的情況下運作。
// 舞台頁（stage.html）透過 window.petCtl 指揮這位助手說話、換狀態、換姿勢。
const cbs = {};
window.api = new Proxy({}, {
  get(_t, name) {
    if (String(name).startsWith('on')) return (cb) => { cbs[name] = cb; };
    return () => {};
  }
});
window.petCtl = {
  character: (id) => cbs.onCharacter && cbs.onCharacter({ id }),
  speak: (payload) => cbs.onSpeak && cbs.onSpeak(payload),
  status: (st) => cbs.onStatus && cbs.onStatus(st || { text: '', cls: '' }),
  pose: (p) => cbs.onPose && cbs.onPose(p)
};
window.addEventListener('load', () => {
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  const id = new URLSearchParams(location.search).get('char') || 'mozi';
  setTimeout(() => window.petCtl.character(id), 50);
});
