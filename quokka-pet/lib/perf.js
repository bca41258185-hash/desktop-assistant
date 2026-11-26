// 動畫幀率（規格 12 效能）：預設每秒 60 格；只有使用者手動打開「省電」（settings.saver）才是 30 格。
// 不因為用電池就降速：卡不卡靠優化，不靠砍幀率。主行程用 'stage:perf' {fps} 告訴舞台。
(function () {
  const FPS_FULL = 60, FPS_SAVER = 30;
  const targetFps = ({ saver = false } = {}) => (saver ? FPS_SAVER : FPS_FULL);
  // send({ fps })：值有變才送；force（舞台剛載入好）一定送
  function createPerfSender({ getSaver, send }) {
    let last = null;
    const current = () => targetFps({ saver: !!getSaver() });
    function update(force = false) {
      const fps = current();
      if (!force && fps === last) return null;
      last = fps;
      send({ fps });
      return fps;
    }
    return { update, current };
  }
  module.exports = { targetFps, createPerfSender, FPS_FULL, FPS_SAVER };
})();
