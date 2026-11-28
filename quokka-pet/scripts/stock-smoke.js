#!/usr/bin/env node
// 實測腳本（不在 npm test 裡）：真的連證交所 MIS 與 Yahoo，確認報價抓得到。
// 用法：node scripts/stock-smoke.js
// 在需要 HTTPS 代理的環境（有設 HTTPS_PROXY），Node 內建 fetch 預設不走代理，
// 這裡會自動以 NODE_USE_ENV_PROXY=1 重新啟動自己（Node 22.21 以上支援）。
'use strict';
const { spawnSync } = require('node:child_process');

if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ['--no-warnings', __filename, ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status == null ? 1 : r.status);
}

const { createStockService, isMarketOpen } = require('../lib/stock-service');

const TARGETS = [
  { symbol: '2330', market: 'tw' },
  { symbol: '0050', market: 'tw' },
  { symbol: '6488', market: 'tw' },   // 上櫃
  { symbol: 'AAPL', market: 'us' },
  { symbol: 'BRK.B', market: 'us' },  // 服務內轉成 Yahoo 的 BRK-B
  { symbol: '9999', market: 'tw' },   // 應該查不到
];

const fmtPct = (p) => (p == null ? '—' : `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`);
const fmtTime = (ms, tz) => (ms ? new Date(ms).toLocaleString('zh-TW', { timeZone: tz, hour12: false }) : '—');

(async () => {
  const now = new Date();
  console.log(`現在：台股${isMarketOpen('tw', now) ? '交易中' : '非交易時間'}，美股${isMarketOpen('us', now) ? '交易中' : '非交易時間'}`);

  // 1) lookup：逐一查證
  const svc = createStockService({ lookupAttempts: 5 });   // 實測時多試幾次，避開防火牆偶發阻擋
  let bad = 0;
  for (const t of TARGETS) {
    const r = await svc.lookup(t.symbol, t.market);
    if (!r.ok) {
      console.log(`[lookup] ${t.market} ${t.symbol}：失敗 → ${r.reason}`);
      // 連線被擋（證交所防火牆偶發 502）只算警告；應查得到卻回「查無」才算失敗
      if (t.symbol !== '9999' && !/無法連線/.test(r.reason)) bad++;
      continue;
    }
    const q = r.quote;
    const tz = t.market === 'tw' ? 'Asia/Taipei' : 'America/New_York';
    console.log(`[lookup] ${t.market} ${r.symbol}${r.ex ? `（${r.ex}）` : ''} ${r.name}：價格 ${q.price ?? '—'}（${q.source ?? '無'}）昨收 ${q.prevClose ?? '—'} 漲跌 ${fmtPct(q.pct)} 交易日 ${q.day} 時間 ${fmtTime(q.time, tz)}`);
  }

  // 2) 服務輪詢一輪：start() 會立刻各市場抓一次
  const got = new Map();
  const svc2 = createStockService({ onUpdate: (u) => got.set(`${u.market}:${u.symbol}`, u) });
  svc2.setWatchlist(TARGETS.filter((t) => t.symbol !== '9999'));
  svc2.start();
  const deadline = Date.now() + 45000;   // 讓退避重試（5、10、20 秒）有機會跑完
  while (got.size < 5 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  svc2.stop();
  console.log('\n[輪詢] onUpdate 收到：');
  for (const u of got.values()) {
    console.log(`  ${u.market} ${u.symbol.padEnd(6)} ${String(u.name).padEnd(28)} ${String(u.price).padStart(10)}  ${fmtPct(u.pct).padStart(8)}  day=${u.day} stale=${u.stale}`);
  }
  if (got.size < 5) { console.log(`  只收到 ${got.size}/5 檔（可能被報價來源暫時阻擋，稍後再試）`); bad++; }
  process.exit(bad ? 1 : 0);
})();
