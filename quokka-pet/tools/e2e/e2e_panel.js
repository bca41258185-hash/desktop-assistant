const { _electron } = require('playwright');
const S = __dirname, R = process.argv[2] || process.env.QUOKKA_DIR || require('path').resolve(__dirname, '../..'), wait = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({ executablePath: R + '/node_modules/electron/dist/electron', args: [R, '--no-sandbox'], cwd: R, env: { ...process.env, XDG_CONFIG_HOME: S + '/cfg11', QUOKKA_DEMO: '3', NODE_USE_ENV_PROXY: '1' } });
  await wait(3500);
  await app.evaluate(() => global.v2.showPanel());
  await wait(1500);
  let panel; for (const w of app.windows()) if ((await w.url()).includes('panel.html')) panel = w;
  const errs = []; panel.on('pageerror', (e) => errs.push(e.message)); panel.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const input = panel.locator('input[type="text"], textarea').first();
  const add = async (t) => { await input.fill(t); await wait(250); const hint = await panel.evaluate(() => (document.querySelector('[class*="hint"],[id*="hint"],[class*="preview"]') || {}).textContent || ''); await input.press('Enter'); await wait(t === '2330' ? 14000 : 500); const msg = await panel.evaluate(() => document.getElementById('addHint').textContent); return hint.trim().slice(0, 30) + ' ｜送出後：' + msg.trim().slice(0, 60); };
  for (const t of ['回覆業主信件', '明天 10:00 看工地', '每週一 9點 週報', '2330']) console.log(t, '｜提示：', await add(t));
  const st = await app.evaluate(() => { const d = global.v2.data; return { tasks: d.tasks.map((x) => x.text), rem: d.reminders.map((x) => x.text + ' ' + JSON.stringify(x.rule)), stocks: d.stocks.map((x) => x.name), owners: [...new Set(d.tasks.concat(d.reminders, d.stocks).map((x) => x.owner))].length }; });
  console.log(JSON.stringify(st));
  await panel.screenshot({ path: S + '/panel_real.png' });
  console.log('errors', errs);
  await app.close();
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
