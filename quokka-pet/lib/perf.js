// 動畫幀率（規格 12 效能）：預設每秒 60 格；使用者手動打開「省電」（settings.saver）或筆電用電池時 30 格。
// 主行程用 'stage:perf' {fps} 告訴舞台（舞台載入好時補送、值有變時再送）。
// 電腦實際跟不上時，舞台自己會暫時降到 30、順了再回到目標值（舞台端負責）。
(function () {
  const FPS_FULL = 60, FPS_SAVER = 30;
  const targetFps = ({ saver = false, onBattery = false } = {}) => (saver || onBattery ? FPS_SAVER : FPS_FULL);
  // send({ fps })：值有變才送；force（舞台剛載入好）一定送。查電池狀態出錯時當成插電。
  function createPerfSender({ getSaver, isOnBattery = () => false, send }) {
    let last = null;
    const batt = () => { try { return !!isOnBattery(); } catch (e) { return false; } };
    const current = () => targetFps({ saver: !!getSaver(), onBattery: batt() });
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
