// 依這台電腦的硬體決定「效能等級」（high／mid／low），舞台照等級設定同時做動作的隻數和快取大小。
//   只看核心數、記憶體、顯示卡廠牌（獨顯或內顯）；之後執行中如果畫不順，舞台會再自己降一級（見 stage-core.js）。
(function () {
  'use strict';
  const ORDER = ['low', 'mid', 'high'];
  const VENDOR = { 0x10de: 'nvidia', 0x1002: 'amd', 0x8086: 'intel', 0x1414: 'software', 0x5143: 'qualcomm' };

  // 目前在用的顯示卡：{ vendor, discrete }；讀不到回 { vendor: 'unknown', discrete: false }
  function gpuOf(info) {
    const list = (info && Array.isArray(info.gpuDevice) && info.gpuDevice) || [];
    const d = list.find((g) => g && g.active) || list.find((g) => g && VENDOR[g.vendorId] && VENDOR[g.vendorId] !== 'software') || list[0];
    const vendor = (d && VENDOR[d.vendorId]) || 'unknown';
    return { vendor, discrete: vendor === 'nvidia' };          // AMD 可能是內顯也可能是獨顯，分不出來：當成中間
  }
  // cores：邏輯核心數；memGB：記憶體；gpu：gpuOf 的結果
  function classify({ cores = 4, memGB = 8, gpu = {} } = {}) {
    let score = 0;
    score += cores >= 12 ? 2 : cores >= 6 ? 1 : 0;
    score += memGB >= 15 ? 2 : memGB >= 7.5 ? 1 : 0;
    score += gpu.discrete ? 2 : gpu.vendor === 'amd' ? 1 : gpu.vendor === 'software' ? -2 : 0;
    if (cores <= 2 || memGB < 3.5) return 'low';              // 很舊的機器：直接最低
    return score >= 5 ? 'high' : score >= 2 ? 'mid' : 'low';
  }
  // 不超過上限（舞台回報畫不順時記下來的等級）
  const capTier = (tier, cap) => (ORDER.includes(cap) && ORDER.indexOf(cap) < ORDER.indexOf(tier) ? cap : tier);
  const lower = (tier) => ORDER[Math.max(0, ORDER.indexOf(tier) - 1)] || 'low';

  module.exports = { classify, gpuOf, capTier, lower, ORDER };
})();
