// AI 專案監看的單元測試：用模擬的 Claude Code / Codex 紀錄檔驗證狀態轉換。
// 執行：npm test

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAiWatcher } = require('../ai-watch');

function setup(tool) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwatch-'));
  let clock = Date.parse('2026-11-20T10:00:00Z');
  const events = [];
  const w = createAiWatcher({
    roots: { [tool]: root },
    tools: [tool],
    now: () => clock,
    onEvent: (e) => events.push(e)
  });
  return {
    root, w, events,
    advance(ms) { clock += ms; },
    iso() { return new Date(clock).toISOString(); }
  };
}

// Claude Code 紀錄資料夾名稱（與 ai-watch 相同規則；Windows 上 /p 會解析成 D:p → D--p）
const enc = (p) => path.resolve(p).replace(/[^a-zA-Z0-9]/g, '-');

function append(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------
test('Claude Code：指令 → 改檔 → 完成', () => {
  const t = setup('claude');
  const file = path.join(t.root, '-home-me-villa', 'abc.jsonl');
  const cwd = '/home/me/villa';

  append(file, [{ type: 'user', cwd, timestamp: t.iso(), message: { role: 'user', content: '把平面圖說明更新' } }]);
  t.w._onAdd('claude', file, false);
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start']);
  assert.strictEqual(t.events[0].session.projectName, 'villa');
  assert.strictEqual(t.events[0].session.label, 'Claude Code');

  append(file, [{
    type: 'assistant', cwd, timestamp: t.iso(),
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/home/me/villa/notes.md' } }] }
  }]);
  t.w._onChange('claude', file);
  let s = t.w.snapshot()[0].sessions[0];
  assert.strictEqual(s.status, 'working');
  assert.strictEqual(s.lastAction, '修改 notes.md');
  assert.deepStrictEqual(s.files, ['/home/me/villa/notes.md']);

  append(file, [
    { type: 'user', cwd, timestamp: t.iso(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    { type: 'assistant', cwd, timestamp: t.iso(), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '已更新說明。' }] } }
  ]);
  t.w._onChange('claude', file);
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start', 'done']);
  assert.strictEqual(t.w.snapshot()[0].sessions[0].title, '把平面圖說明更新', '沒有 ai-title 時用第一句指令');
  append(file, [{ type: 'ai-title', aiTitle: '更新平面圖說明', sessionId: 'abc' }]);
  t.w._onChange('claude', file);
  s = t.w.snapshot()[0].sessions[0];
  assert.strictEqual(s.title, '更新平面圖說明', '有 ai-title 時優先使用');
  assert.strictEqual(s.status, 'done');
  assert.strictEqual(s.lastText, '已更新說明。');
  assert.strictEqual(s.turns, 1, 'tool_result 不應被當成新指令');
});

test('Claude Code：工具呼叫久未回傳 → 可能在等你確認；之後恢復', () => {
  const t = setup('claude');
  const file = path.join(t.root, enc('/p'), 's.jsonl');
  append(file, [
    { type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: '跑測試' } },
    { type: 'assistant', cwd: '/p', timestamp: t.iso(), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'npm test' } }] } }
  ]);
  t.w._onAdd('claude', file, false);
  t.advance(25 * 1000);
  t.w.tick();
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start', 'waiting']);
  t.w.tick();
  assert.strictEqual(t.events.length, 2, '同一次等待只通知一次');

  append(file, [{ type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1' }] } }]);
  t.w._onChange('claude', file);
  assert.strictEqual(t.w.snapshot()[0].sessions[0].status, 'working');
});

test('Claude Code：沒有結束標記時，文字回覆後安靜一段時間視為完成', () => {
  const t = setup('claude');
  const file = path.join(t.root, enc('/p'), 's.jsonl');
  append(file, [
    { type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: '解釋一下' } },
    { type: 'assistant', cwd: '/p', timestamp: t.iso(), message: { role: 'assistant', content: [{ type: 'text', text: '說明如下' }] } }
  ]);
  t.w._onAdd('claude', file, false);
  t.advance(5000); t.w.tick();
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start']);
  t.advance(15000); t.w.tick();
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start', 'done']);
});

test('Claude Code：系統插入內容、子代理、使用者中斷、半行寫入', () => {
  const t = setup('claude');
  const file = path.join(t.root, enc('/p'), 's.jsonl');
  append(file, [
    { type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: '<command-name>/clear</command-name>' } },
    { type: 'user', cwd: '/p', isMeta: true, timestamp: t.iso(), message: { role: 'user', content: 'meta' } }
  ]);
  t.w._onAdd('claude', file, false);
  assert.strictEqual(t.events.length, 0, '系統插入的內容不算指令');

  append(file, [
    { type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: '開始' } },
    { type: 'assistant', cwd: '/p', isSidechain: true, timestamp: t.iso(), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '子代理完成' }] } }
  ]);
  t.w._onChange('claude', file);
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start'], '子代理的結束不代表主對話結束');

  // 半行寫入：先寫一半，不應解析；補完後才處理
  const line = JSON.stringify({ type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
  fs.appendFileSync(file, line.slice(0, 20));
  t.w._onChange('claude', file);
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start']);
  fs.appendFileSync(file, line.slice(20) + '\n');
  t.w._onChange('claude', file);
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start', 'done']);
  assert.strictEqual(t.events[1].session.interrupted, true);
});

test('啟動時載入舊紀錄：不發通知，狀態直接定案；格式錯誤的行略過', () => {
  const t = setup('claude');
  const file = path.join(t.root, enc('/p'), 's.jsonl');
  const earlier = new Date(Date.parse(t.iso()) - 60 * 1000).toISOString();
  append(file, [
    { type: 'user', cwd: '/p', timestamp: earlier, message: { role: 'user', content: '舊指令' } },
    { type: 'assistant', cwd: '/p', timestamp: earlier, message: { role: 'assistant', content: [{ type: 'text', text: '舊回覆' }] } }
  ]);
  fs.appendFileSync(file, '{這不是 JSON\n');
  t.w._onAdd('claude', file, true);
  assert.strictEqual(t.events.length, 0);
  assert.strictEqual(t.w.snapshot()[0].sessions[0].status, 'done');
});

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------
test('Codex：指令 → 套用修補 → 完成（且不重複計算同一句指令）', () => {
  const t = setup('codex');
  const file = path.join(t.root, '2026', '11', '20', 'rollout-2026-11-20T10-00-00-x.jsonl');
  append(file, [
    { timestamp: t.iso(), type: 'session_meta', payload: { id: 'x', cwd: '/home/me/site' } },
    { timestamp: t.iso(), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>...</environment_context>' }] } },
    { timestamp: t.iso(), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '修正首頁標題' }] } },
    { timestamp: t.iso(), type: 'event_msg', payload: { type: 'user_message', message: '修正首頁標題' } },
    { timestamp: t.iso(), type: 'event_msg', payload: { type: 'task_started' } }
  ]);
  t.w._onAdd('codex', file, false);
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start']);
  assert.strictEqual(t.events[0].session.projectName, 'site');

  append(file, [
    { timestamp: t.iso(), type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c1', input: '*** Begin Patch\n*** Update File: src/index.html\n@@\n*** End Patch' } },
    { timestamp: t.iso(), type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'c1', output: 'ok' } },
    { timestamp: t.iso(), type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c2', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm run build'] }) } }
  ]);
  t.w._onChange('codex', file);
  const s = t.w.snapshot()[0].sessions[0];
  assert.strictEqual(s.lastAction, '執行指令：npm run build');
  assert.deepStrictEqual(s.files, ['src/index.html']);
  assert.strictEqual(s.turns, 1);

  append(file, [
    { timestamp: t.iso(), type: 'response_item', payload: { type: 'function_call_output', call_id: 'c2', output: 'done' } },
    { timestamp: t.iso(), type: 'event_msg', payload: { type: 'task_complete', last_agent_message: '標題已修正並建置成功。' } }
  ]);
  t.w._onChange('codex', file);
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start', 'done']);
  assert.strictEqual(t.w.snapshot()[0].sessions[0].lastText, '標題已修正並建置成功。');
});

test('Codex：明確的核准請求 → 立即通知等待', () => {
  const t = setup('codex');
  const file = path.join(t.root, '2026', '11', '20', 'rollout-y.jsonl');
  append(file, [
    { timestamp: t.iso(), type: 'session_meta', payload: { cwd: '/p' } },
    { timestamp: t.iso(), type: 'event_msg', payload: { type: 'user_message', message: '刪除暫存檔' } },
    { timestamp: t.iso(), type: 'event_msg', payload: { type: 'exec_approval_request', command: ['rm', '-rf', 'tmp'] } }
  ]);
  t.w._onAdd('codex', file, false);
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start', 'waiting']);
});

test('監看器從頭到尾都不寫入紀錄檔', () => {
  const t = setup('claude');
  const file = path.join(t.root, enc('/p'), 's.jsonl');
  append(file, [{ type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: 'hi' } }]);
  const before = fs.readFileSync(file);
  const mtime = fs.statSync(file).mtimeMs;
  t.w._onAdd('claude', file, false);
  t.w._onChange('claude', file);
  t.w.tick();
  assert.ok(before.equals(fs.readFileSync(file)));
  assert.strictEqual(fs.statSync(file).mtimeMs, mtime);
});

test('實際監看（chokidar）：新增的紀錄檔會被偵測', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwatch-live-'));
  const events = [];
  const w = createAiWatcher({ roots: { claude: root }, tools: ['claude'], onEvent: (e) => events.push(e) }).start();
  await new Promise((r) => setTimeout(r, 400));
  const file = path.join(root, '-p', 'live.jsonl');
  append(file, [{ type: 'user', cwd: '/p', timestamp: new Date().toISOString(), message: { role: 'user', content: '即時測試' } }]);
  for (let i = 0; i < 40 && !events.length; i++) await new Promise((r) => setTimeout(r, 100));
  await w.stop();
  assert.deepStrictEqual(events.map((e) => e.kind), ['start']);
});

// ---------------------------------------------------------------------------
// 指定專案（只讀指定的對話）
// ---------------------------------------------------------------------------
function setupWith(opts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwatch-p-'));
  let clock = Date.parse('2026-11-20T10:00:00Z');
  const events = [];
  const tool = opts.tool || 'claude';
  const w = createAiWatcher(Object.assign({
    roots: { [tool]: root }, tools: [tool], now: () => clock,
    onEvent: (e) => events.push(e), hookDelayMs: 0
  }, opts));
  return { root, w, events, advance(ms) { clock += ms; }, iso() { return new Date(clock).toISOString(); } };
}

test('指定專案：其他專案的 Claude 紀錄不讀；子資料夾算在專案內；資料夾名稱撞名時以實際工作目錄為準', () => {
  const proj = path.resolve('/work/villa');
  const t = setupWith({ projects: [proj] });
  const mk = (dir, cwd, text) => {
    const f = path.join(t.root, dir, 's-' + Math.random().toString(36).slice(2) + '.jsonl');
    append(f, [{ type: 'user', cwd, timestamp: t.iso(), message: { role: 'user', content: text } }]);
    t.w._onAdd('claude', f, false);
    return f;
  };
  mk(enc('/other/project'), '/other/project', '別的專案');
  mk(enc(proj) + '-site', path.join(proj, 'site'), '子資料夾');
  // 中文資料夾名稱編碼後都是「-」，可能撞名：/work/villa 與 /work/villa？ 都編成 -work-villa-
  mk(enc(proj) + '-', '/work/villa？', '撞名的另一個專案');
  mk(enc(proj), proj, '本專案');
  assert.deepStrictEqual(t.events.map((e) => e.session.lastPrompt).sort(), ['子資料夾', '本專案'].sort());
});

test('指定專案：未指定任何專案時完全不讀', async () => {
  const t = setupWith({ projects: [] });
  const f = path.join(t.root, enc('/p'), 's.jsonl');
  append(f, [{ type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: 'x' } }]);
  t.w.start();
  await new Promise((r) => setTimeout(r, 300));
  await t.w.stop();
  assert.strictEqual(t.w.snapshot().length, 0);
});

test('指定專案：Codex 以檔頭 session_meta 判斷；空檔先暫緩，寫入後再判斷', () => {
  const t = setupWith({ tool: 'codex', projects: ['/work/site'] });
  const f = path.join(t.root, '2026', '11', '20', 'rollout-a.jsonl');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '');
  t.w._onAdd('codex', f, false);
  append(f, [
    { timestamp: t.iso(), type: 'session_meta', payload: { cwd: '/work/site' } },
    { timestamp: t.iso(), type: 'event_msg', payload: { type: 'user_message', message: '開始' } }
  ]);
  t.w._onChange('codex', f);
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start']);

  const g = path.join(t.root, '2026', '11', '20', 'rollout-b.jsonl');
  append(g, [
    { timestamp: t.iso(), type: 'session_meta', payload: { cwd: '/elsewhere' } },
    { timestamp: t.iso(), type: 'event_msg', payload: { type: 'user_message', message: '不該出現' } }
  ]);
  t.w._onAdd('codex', g, false);
  assert.strictEqual(t.events.length, 1);
});

test('啟動時的舊對話之後才有新內容：舊指令不補發通知，只通知新的', () => {
  const t = setupWith({ projects: ['/p'], recentMs: 1000 });
  const f = path.join(t.root, enc('/p'), 's.jsonl');
  append(f, [{ type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: '很久以前的指令' } }]);
  const old = new Date(Date.parse(t.iso()) - 3600 * 1000);
  fs.utimesSync(f, old, old);
  t.w._onAdd('claude', f, true);          // 啟動掃描：太舊，不讀
  assert.strictEqual(t.w.snapshot().length, 0);
  append(f, [{ type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: '新指令' } }]);
  t.w._onChange('claude', f);
  assert.deepStrictEqual(t.events.map((e) => e.session.lastPrompt), ['新指令']);
});

// ---------------------------------------------------------------------------
// Claude Code 通知鉤子事件
// ---------------------------------------------------------------------------
test('鉤子：需要你允許 → 立即通知並附工具名；有鉤子後不再用時間推測；Stop → 完成', () => {
  const hookFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aiwatch-h-')), 'hook-events.jsonl');
  const t = setupWith({ projects: ['/p'], hookEventsFile: hookFile });
  fs.writeFileSync(hookFile, JSON.stringify({ event: 'Stop', cwd: '/p', transcript_path: 'old' }) + '\n');
  t.w._readHookEvents('skip');            // 啟動前的舊事件略過

  const f = path.join(t.root, enc('/p'), 's.jsonl');
  append(f, [
    { type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: '刪掉暫存資料夾' } },
    { type: 'assistant', cwd: '/p', timestamp: t.iso(), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'rm -rf tmp' } }] } }
  ]);
  t.w._onAdd('claude', f, false);
  append(hookFile, [
    { event: 'Notification', cwd: '/p', transcript_path: f, notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' },
    { event: 'Notification', cwd: '/other', transcript_path: f, notification_type: 'permission_prompt', message: '不在指定專案' }
  ]);
  t.w._readHookEvents();
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start', 'waiting']);
  assert.strictEqual(t.events[1].session.waitingMessage, '需要你允許使用 Bash');

  // 允許後繼續；長時間執行的指令不會再被時間推測誤報
  append(f, [{ type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1' }] } },
    { type: 'assistant', cwd: '/p', timestamp: t.iso(), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b2', name: 'Bash', input: { command: 'npm run build' } }] } }]);
  t.w._onChange('claude', f);
  t.advance(60 * 1000); t.w.tick();
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start', 'waiting']);

  append(hookFile, [{ event: 'Stop', cwd: '/p', transcript_path: f }]);
  t.w._readHookEvents();
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start', 'waiting', 'done']);
});

// ---------------------------------------------------------------------------
// 鉤子腳本本身（以子行程實際執行）
// ---------------------------------------------------------------------------
const { spawnSync } = require('child_process');
const HOOK = path.join(__dirname, '..', 'hooks', 'claude-hook.js');

test('鉤子腳本：只記錄指定專案、不記錄指令內容、stdout 無輸出、永遠 exit 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-'));
  fs.writeFileSync(path.join(dir, 'watch-projects.json'), JSON.stringify([path.resolve('/work/villa')]));
  const run = (input) => spawnSync(process.execPath, [HOOK, dir], { input, encoding: 'utf8' });

  let r = run(JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: path.resolve('/work/villa/a'), session_id: 's', transcript_path: '/t.jsonl', prompt: '機密指令內容' }));
  assert.strictEqual(r.status, 0); assert.strictEqual(r.stdout, '');
  r = run(JSON.stringify({ hook_event_name: 'Stop', cwd: path.resolve('/other'), session_id: 'x', transcript_path: '/x.jsonl' }));
  assert.strictEqual(r.status, 0); assert.strictEqual(r.stdout, '');
  r = run('這不是 JSON');
  assert.strictEqual(r.status, 0); assert.strictEqual(r.stdout, '');

  const lines = fs.readFileSync(path.join(dir, 'hook-events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].event, 'UserPromptSubmit');
  assert.ok(!JSON.stringify(lines[0]).includes('機密指令內容'), '不得記錄指令內容');

  // 沒有專案清單檔（例如桌寵從未設定）時什麼都不寫
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-'));
  r = spawnSync(process.execPath, [HOOK, empty], { input: JSON.stringify({ hook_event_name: 'Stop', cwd: '/x' }), encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(empty, 'hook-events.jsonl')));
});

// ---------------------------------------------------------------------------
// 鉤子安裝／移除（修改 settings.json）
// ---------------------------------------------------------------------------
const installer = require('../ai-watch/hooks-installer');

test('安裝鉤子：保留原有設定與其他鉤子、先備份、重複安裝不重複、移除只刪自己的', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-'));
  const file = path.join(dir, 'settings.json');
  const original = {
    model: 'opus',
    permissions: { allow: ['Bash(npm test)'] },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check.sh' }] }] }
  };
  fs.writeFileSync(file, JSON.stringify(original));

  const res = installer.install({ file, scriptPath: 'C:\\Apps\\desktop assistant\\hooks\\claude-hook.js', dataDir: 'C:\\Users\\me\\AppData\\ai-hooks' });
  assert.ok(res.backup && fs.existsSync(res.backup));
  assert.strictEqual(res.command, 'node "C:/Apps/desktop assistant/hooks/claude-hook.js" "C:/Users/me/AppData/ai-hooks"');
  installer.install({ file, scriptPath: '/new/place/hooks/claude-hook.js', dataDir: '/d' });   // 重新安裝（例如程式搬家）

  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(s.model, 'opus');
  assert.deepStrictEqual(s.permissions, original.permissions);
  assert.deepStrictEqual(s.hooks.PreToolUse, original.hooks.PreToolUse);
  assert.strictEqual(s.hooks.Stop.length, 2, '原有的 Stop 鉤子保留，自己的只有一組');
  assert.strictEqual(s.hooks.Stop[0].hooks[0].command, 'say done');
  for (const ev of installer.EVENTS) {
    const ours = s.hooks[ev].flatMap((g) => g.hooks).filter((h) => h.command.includes('hooks/claude-hook.js'));
    assert.strictEqual(ours.length, 1);
    assert.ok(ours[0].command.includes('/new/place/'));
    assert.strictEqual(ours[0].timeout, (ev === 'PermissionRequest' || ev === 'Stop') ? 660 : 5);
  }
  assert.strictEqual(installer.status(file).installed, true);

  const un = installer.uninstall({ file });
  assert.strictEqual(un.removed, installer.EVENTS.length);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), original);
  assert.strictEqual(installer.status(file).installed, false);
});

test('安裝鉤子：設定檔格式錯誤時完全不修改；設定檔不存在時建立', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-'));
  const bad = path.join(dir, 'settings.json');
  fs.writeFileSync(bad, '{ "model": "opus", // 註解\n }');
  assert.throws(() => installer.install({ file: bad, scriptPath: '/a/hooks/claude-hook.js', dataDir: '/d' }), /未做任何修改/);
  assert.strictEqual(fs.readFileSync(bad, 'utf8'), '{ "model": "opus", // 註解\n }');
  assert.deepStrictEqual(fs.readdirSync(dir), ['settings.json'], '不應留下備份或暫存檔');

  const fresh = path.join(dir, 'sub', 'settings.json');
  installer.install({ file: fresh, scriptPath: '/a/hooks/claude-hook.js', dataDir: '/d' });
  assert.strictEqual(installer.status(fresh).installed, true);
});

test('安裝→移除：Windows 常見格式（BOM、CRLF、4 格／Tab 縮排、無結尾換行、使用者原有鉤子）逐位元組還原', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-fmt-'));
  const cases = [
    // \u5DF2\u77E5\u9650\u5236\uFF1A\u539F\u6A94\u82E5\u6709\u300C\u7A7A\u7684\u300Dhooks \u7269\u4EF6\u6216\u7A7A\u4E8B\u4EF6\u9663\u5217\uFF0C\u79FB\u9664\u5F8C\u6703\u4E00\u8D77\u6D88\u5931\uFF08\u5C0D Claude Code \u7B49\u6548\uFF09
    '\uFEFF{\r\n    "theme": "dark",\r\n    "permissions": {\r\n        "allow": []\r\n    }\r\n}\r\n',
    '{\n\t"model": "opus",\n\t"hooks": {\n\t\t"PreToolUse": [\n\t\t\t{\n\t\t\t\t"matcher": "Bash",\n\t\t\t\t"hooks": [\n\t\t\t\t\t{\n\t\t\t\t\t\t"type": "command",\n\t\t\t\t\t\t"command": "echo hi"\n\t\t\t\t\t}\n\t\t\t\t]\n\t\t\t}\n\t\t]\n\t}\n}',
    '{\n  "theme": "light"\n}\n'
  ];
  cases.forEach((orig, i) => {
    const file = path.join(dir, `s${i}.json`);
    fs.writeFileSync(file, orig);
    installer.install({ file, scriptPath: 'D:\\建築 設計\\desktop-assistant\\hooks\\claude-hook.js', dataDir: 'C:\\Users\\me\\AppData\\Roaming\\desktop-assistant\\ai-hooks' });
    const mid = fs.readFileSync(file, 'utf8');
    assert.strictEqual(installer.status(file).installed, true);
    assert.strictEqual(mid.startsWith('\uFEFF'), orig.startsWith('\uFEFF'), '保留 BOM 與否');
    assert.strictEqual(/\r\n/.test(mid), /\r\n/.test(orig), '保留換行格式');
    installer.uninstall({ file });
    assert.strictEqual(fs.readFileSync(file, 'utf8'), orig, `第 ${i} 例未逐位元組還原`);
  });
});

// ---------------------------------------------------------------------------
// 個別指定的對話（session ID）
// ---------------------------------------------------------------------------
test('指定對話：不在指定專案的資料夾，只要 session ID 在清單就追蹤；標題用使用者命名的標題', () => {
  const hookFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aiwatch-s-')), 'hook-events.jsonl');
  const t = setupWith({ projects: [], sessions: ['sess-keep'], hookEventsFile: hookFile });
  const keep = path.join(t.root, enc('/anywhere/else'), 'sess-keep.jsonl');
  const other = path.join(t.root, enc('/anywhere/else'), 'sess-other.jsonl');
  const lines = (text) => [
    { type: 'user', cwd: '/anywhere/else', timestamp: t.iso(), message: { role: 'user', content: text } },
    { type: 'ai-title', aiTitle: '自動標題' },
    { type: 'custom-title', customTitle: 'Install desktop-assistant (PR #1) on this PC' }
  ];
  append(keep, lines('要追蹤'));
  append(other, lines('不追蹤'));
  t.w._onAdd('claude', keep, false);
  t.w._onAdd('claude', other, false);
  assert.deepStrictEqual(t.events.map((e) => e.session.lastPrompt), ['要追蹤']);
  assert.strictEqual(t.w.snapshot()[0].sessions[0].title, 'Install desktop-assistant (PR #1) on this PC');

  fs.writeFileSync(hookFile, '');
  t.w._readHookEvents('skip');
  append(hookFile, [{ event: 'Notification', cwd: '/anywhere/else', transcript_path: keep, notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }]);
  t.w._readHookEvents();
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['start', 'waiting']);
});

test('鉤子腳本：新格式 { projects, sessions } 依 session ID 記錄；舊陣列格式仍可用', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-s-'));
  const run = (input) => spawnSync(process.execPath, [HOOK, dir], { input: JSON.stringify(input), encoding: 'utf8' });
  const ev = path.join(dir, 'hook-events.jsonl');
  fs.writeFileSync(path.join(dir, 'watch-projects.json'), JSON.stringify({ projects: [], sessions: ['abc'] }));
  run({ hook_event_name: 'Stop', cwd: path.resolve('/x'), session_id: 'abc', transcript_path: '/a.jsonl' });
  run({ hook_event_name: 'Stop', cwd: path.resolve('/x'), session_id: 'zzz', transcript_path: '/z.jsonl' });
  assert.deepStrictEqual(fs.readFileSync(ev, 'utf8').trim().split('\n').map((l) => JSON.parse(l).session_id), ['abc']);

  fs.writeFileSync(path.join(dir, 'watch-projects.json'), JSON.stringify([path.resolve('/x')]));
  run({ hook_event_name: 'Stop', cwd: path.resolve('/x/sub'), session_id: 'zzz', transcript_path: '/z.jsonl' });
  assert.strictEqual(fs.readFileSync(ev, 'utf8').trim().split('\n').length, 2);
});

test('列出最近對話：標題優先序 custom-title > ai-title > 第一句指令；空對話不列出', () => {
  const { listClaudeSessions } = require('../ai-watch/claude-sessions');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-list-'));
  const mk = (id, entries) => append(path.join(root, '-p', id + '.jsonl'), entries);
  mk('a', [{ type: 'user', cwd: '/p', message: { role: 'user', content: '第一句指令' } }]);
  mk('b', [{ type: 'user', cwd: '/p', message: { role: 'user', content: 'x' } }, { type: 'ai-title', aiTitle: 'AI 標題' }]);
  mk('c', [{ type: 'user', cwd: '/p', message: { role: 'user', content: 'x' } }, { type: 'ai-title', aiTitle: 'AI 標題' },
    { type: 'custom-title', customTitle: '舊名' }, { type: 'custom-title', customTitle: '側欄名稱' }]);
  mk('d', [{ type: 'user', cwd: '/p', message: { role: 'user', content: '<command-name>/clear</command-name>' } }]);
  const byId = Object.fromEntries(listClaudeSessions(root).map((s) => [s.id, s]));
  assert.strictEqual(byId.a.title, '第一句指令');
  assert.strictEqual(byId.b.title, 'AI 標題');
  assert.strictEqual(byId.c.title, '側欄名稱');
  assert.strictEqual(byId.c.cwd, '/p');
  assert.ok(!byId.d);
});

// ---------------------------------------------------------------------------
// 對話中的圖片
// ---------------------------------------------------------------------------
test('圖片：使用者貼的圖與 Claude 讀取的圖都送給桌寵；啟動時的舊圖不送；非圖片格式略過', () => {
  const t = setupWith({ projects: ['/p'] });
  const f = path.join(t.root, enc('/p'), 's.jsonl');
  const img = (data, mt) => ({ type: 'image', source: { type: 'base64', media_type: mt || 'image/png', data } });
  append(f, [{ type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: [img('T0xE')] } }]);
  t.w._onAdd('claude', f, true);   // 啟動時已存在的內容：不送
  append(f, [
    { type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: [{ type: 'text', text: '看這張' }, img('VVNFUg==')] } },
    { type: 'assistant', cwd: '/p', timestamp: t.iso(), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'a.png' } }] } },
    { type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: [img('VE9PTA==', 'image/jpeg')] }] } },
    { type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: [img('PHN2Zz4=', 'image/svg+xml')] } }
  ]);
  t.w._onChange('claude', f);
  const imgs = t.events.filter((e) => e.kind === 'image');
  assert.deepStrictEqual(imgs.map((e) => [e.image, e.fromUser]), [
    ['data:image/png;base64,VVNFUg==', true],
    ['data:image/jpeg;base64,VE9PTA==', false]
  ]);
  assert.ok(!JSON.stringify(t.w.snapshot()).includes('base64'), '面板快照不含圖片資料');
});

// ---------------------------------------------------------------------------
// 在泡泡上回答權限詢問（PermissionRequest）
// ---------------------------------------------------------------------------
const { spawn } = require('child_process');

function runPermissionHook(dir, answer) {
  return new Promise((resolve) => {
    const started = Date.now();
    const p = spawn(process.execPath, [HOOK, dir]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out, ms: Date.now() - started }));
    p.stdin.end(JSON.stringify({
      hook_event_name: 'PermissionRequest', cwd: path.resolve('/x'), session_id: 'abc', transcript_path: '/a.jsonl',
      tool_name: 'Bash', tool_input: { command: 'npm test' }
    }));
    if (!answer) return;
    // 模擬桌寵：看到請求檔後寫入回答
    const pdir = path.join(dir, 'permission');
    const timer = setInterval(() => {
      let names = [];
      try { names = fs.readdirSync(pdir).filter((n) => n.endsWith('.json') && !n.endsWith('.answer.json')); } catch (e) { return; }
      if (!names.length) return;
      clearInterval(timer);
      const req = JSON.parse(fs.readFileSync(path.join(pdir, names[0]), 'utf8'));
      assert.deepStrictEqual([req.tool_name, req.summary], ['Bash', 'npm test']);
      fs.writeFileSync(path.join(pdir, names[0].replace(/[.]json$/, '.answer.json')), JSON.stringify({ choice: answer }));
    }, 50);
  });
}

test('權限詢問：桌寵回答允許／拒絕 → 鉤子把決定回給 Claude；不回答（pass）→ 不輸出', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-perm-'));
  fs.writeFileSync(path.join(dir, 'watch-projects.json'), JSON.stringify({ projects: [], sessions: ['abc'], answer: true }));
  fs.writeFileSync(path.join(dir, 'app-alive'), 'x');

  let r = await runPermissionHook(dir, 'allow');
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(JSON.parse(r.out), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });

  r = await runPermissionHook(dir, 'deny');
  assert.strictEqual(JSON.parse(r.out).hookSpecificOutput.decision.behavior, 'deny');

  r = await runPermissionHook(dir, 'pass');
  assert.deepStrictEqual([r.code, r.out], [0, '']);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'permission')), [], '請求與回答檔用完就刪');
  const evs = fs.readFileSync(path.join(dir, 'hook-events.jsonl'), 'utf8');
  assert.ok(!evs.includes('npm test'), '事件紀錄不含指令內容');
});

test('權限詢問：桌寵沒開、或沒開啟「在泡泡上回答」時，鉤子立刻結束、不讓 Claude 空等', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-perm2-'));
  fs.writeFileSync(path.join(dir, 'watch-projects.json'), JSON.stringify({ projects: [], sessions: ['abc'], answer: true }));
  let r = await runPermissionHook(dir, null);            // 沒有 app-alive
  assert.deepStrictEqual([r.code, r.out], [0, '']);
  assert.ok(r.ms < 3000);

  fs.writeFileSync(path.join(dir, 'app-alive'), 'x');
  fs.writeFileSync(path.join(dir, 'watch-projects.json'), JSON.stringify({ projects: [], sessions: ['abc'] }));
  r = await runPermissionHook(dir, null);                // 沒有 answer: true
  assert.deepStrictEqual([r.code, r.out], [0, '']);
  assert.ok(r.ms < 3000);
  assert.ok(!fs.existsSync(path.join(dir, 'permission')));
});

test('權限詢問：監看器收到鉤子事件 → 發出 permission 事件（含工具與摘要），狀態變成等你', () => {
  const hdir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwatch-perm-'));
  const hookFile = path.join(hdir, 'hook-events.jsonl');
  const t = setupWith({ projects: ['/p'], hookEventsFile: hookFile });
  const f = path.join(t.root, enc('/p'), 's.jsonl');
  append(f, [{ type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: '跑測試' } }]);
  t.w._onAdd('claude', f, false);
  fs.mkdirSync(path.join(hdir, 'permission'));
  fs.writeFileSync(path.join(hdir, 'permission', 'r1.json'), JSON.stringify({ id: 'r1', tool_name: 'Bash', summary: 'npm test' }));
  fs.writeFileSync(hookFile, '');
  t.w._readHookEvents('skip');
  append(hookFile, [{ event: 'PermissionRequest', cwd: '/p', transcript_path: f, request_id: 'r1', tool_name: 'Bash' }]);
  t.w._readHookEvents();
  const e = t.events.find((x) => x.kind === 'permission');
  assert.deepStrictEqual(e.request, { id: 'r1', tool: 'Bash', summary: 'npm test' });
  assert.strictEqual(e.session.status, 'waiting');
});

test('選擇題（AskUserQuestion）：單選題交給桌寵，答案放回 updatedInput.answers；複選題不介入', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-ask-'));
  fs.writeFileSync(path.join(dir, 'watch-projects.json'), JSON.stringify({ projects: [], sessions: ['abc'], answer: true }));
  fs.writeFileSync(path.join(dir, 'app-alive'), 'x');
  const ask = (toolInput, answers) => new Promise((resolve) => {
    const p = spawn(process.execPath, [HOOK, dir]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => { clearInterval(timer); resolve(out); });
    p.stdin.end(JSON.stringify({ hook_event_name: 'PermissionRequest', cwd: path.resolve('/x'), session_id: 'abc', transcript_path: '/a.jsonl', tool_name: 'AskUserQuestion', tool_input: toolInput }));
    const pdir = path.join(dir, 'permission');
    const timer = setInterval(() => {
      let names = [];
      try { names = fs.readdirSync(pdir).filter((n) => n.endsWith('.json') && !n.endsWith('.answer.json')); } catch (e) { return; }
      if (!names.length) return;
      clearInterval(timer);
      const req = JSON.parse(fs.readFileSync(path.join(pdir, names[0]), 'utf8'));
      assert.deepStrictEqual(req.questions, [{ question: '要哪一種？', options: ['甲', '乙', '丙'] }]);
      fs.writeFileSync(path.join(pdir, names[0].replace(/[.]json$/, '.answer.json')), JSON.stringify({ choice: 'allow', answers }));
    }, 50);
  });
  const input = { questions: [{ question: '要哪一種？', header: '種類', multiSelect: false, options: [{ label: '甲', description: 'a' }, { label: '乙', description: 'b' }, { label: '丙', description: 'c' }] }] };
  const out = JSON.parse(await ask(input, { '要哪一種？': '乙' }));
  assert.strictEqual(out.hookSpecificOutput.decision.behavior, 'allow');
  assert.deepStrictEqual(out.hookSpecificOutput.decision.updatedInput.answers, { '要哪一種？': '乙' });
  assert.deepStrictEqual(out.hookSpecificOutput.decision.updatedInput.questions, input.questions);

  const multi = { questions: [Object.assign({}, input.questions[0], { multiSelect: true })] };
  assert.strictEqual(await ask(multi, {}), '', '複選題：不輸出、不等待');
});

test('做完後回覆：Stop 鉤子等桌寵的回覆 → 以 decision:block 把訊息交給 Claude；點確認（pass）或沒開啟 → 不輸出', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-stop-'));
  const setWatch = (extra) => fs.writeFileSync(path.join(dir, 'watch-projects.json'), JSON.stringify(Object.assign({ projects: [], sessions: ['abc'], answer: true }, extra)));
  fs.writeFileSync(path.join(dir, 'app-alive'), 'x');
  const stop = (answer) => new Promise((resolve) => {
    const started = Date.now();
    const p = spawn(process.execPath, [HOOK, dir]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => { clearInterval(timer); resolve({ out, ms: Date.now() - started }); });
    p.stdin.end(JSON.stringify({ hook_event_name: 'Stop', cwd: path.resolve('/x'), session_id: 'abc', transcript_path: '/a.jsonl' }));
    const pdir = path.join(dir, 'permission');
    const timer = setInterval(() => {
      if (!answer) return;
      let names = [];
      try { names = fs.readdirSync(pdir).filter((n) => n.endsWith('.json') && !n.endsWith('.answer.json')); } catch (e) { return; }
      if (!names.length) return;
      clearInterval(timer);
      fs.writeFileSync(path.join(pdir, names[0].replace(/[.]json$/, '.answer.json')), JSON.stringify(answer));
    }, 50);
  });

  setWatch({ replyAfterDone: true });
  let r = await stop({ choice: 'reply', message: '再幫我加一個按鈕' });
  const o = JSON.parse(r.out);
  assert.strictEqual(o.decision, 'block');
  assert.ok(o.reason.includes('再幫我加一個按鈕'));

  r = await stop({ choice: 'pass' });
  assert.strictEqual(r.out, '');

  setWatch({});                               // 沒開啟「做完後回覆」：立刻結束，不等待
  r = await stop(null);
  assert.strictEqual(r.out, '');
  assert.ok(r.ms < 3000);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'permission')), []);
});

test('主動說話：Claude 做事途中打的話放進待送信箱，回合結束時由 Stop 鉤子交給 Claude，送完就清掉', () => {
  const composeLib = require('../ai-watch/compose');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-outbox-'));
  fs.writeFileSync(path.join(dir, 'watch-projects.json'), JSON.stringify({ projects: [], sessions: ['abc'], answer: true }));
  composeLib.queueMessage(dir, 'abc', '順便把標題改成藍色');
  composeLib.queueMessage(dir, 'abc', '還有字放大');
  const run = (sid) => spawnSync(process.execPath, [HOOK, dir], { encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'Stop', cwd: path.resolve('/x'), session_id: sid, transcript_path: '/a.jsonl' }) });
  assert.strictEqual(run('zzz').stdout, '', '別的對話收不到');
  const o = JSON.parse(run('abc').stdout);
  assert.strictEqual(o.decision, 'block');
  assert.ok(o.reason.includes('順便把標題改成藍色') && o.reason.includes('還有字放大'));
  assert.ok(!fs.existsSync(composeLib.outboxFile(dir, 'abc')));
  assert.strictEqual(run('abc').stdout, '', '送過就不再送');
  assert.throws(() => composeLib.queueMessage(dir, '../x', 'hi'));
});

test('角色看法：開放中的角色都有完整台詞；依 Claude 在做的事選句；不連續重複；封存角色不說話', () => {
  const { REMARKS, remarkFor, kindOf } = require('../data/remarks');
  const chars = require('../renderer/characters');
  assert.deepStrictEqual(chars.ORDER.slice().sort(), ['laozi', 'mozi', 'zhuangzi'], '目前只開放三位');
  assert.ok(chars.CHARACTERS.ando && chars.CHARACTERS.nietzsche, '封存的角色資料仍保留');
  for (const id of chars.ORDER) {
    assert.ok(REMARKS[id], '缺少 ' + id + ' 的台詞');
    for (const k of ['edit', 'run', 'look', 'long', 'any']) assert.ok(REMARKS[id][k].length >= 2, id + ' 的 ' + k + ' 至少兩句');
    assert.ok(REMARKS[id].any.every((l) => !l.includes('{x}')));
  }
  assert.deepStrictEqual(['修改 a.js', '寫入 b.md', '執行指令：npm test', '讀取 c.txt', '搜尋 foo', '查詢網路資料', '更新待辦清單'].map(kindOf),
    ['edit', 'edit', 'run', 'look', 'look', 'look', 'any']);
  const first = () => 0;
  assert.ok(remarkFor('zhuangzi', { lastAction: '修改 main.js', rand: first }).includes('main.js'));
  assert.ok(REMARKS.laozi.any.includes(remarkFor('laozi', { lastAction: '修改 檔案', rand: first })), '沒有檔名時改用通用句');
  assert.ok(REMARKS.mozi.long.includes(remarkFor('mozi', { lastAction: '修改 a.js', longRunning: true })));
  const one = remarkFor('mozi', { lastAction: '執行指令：x', rand: first });
  assert.notStrictEqual(remarkFor('mozi', { lastAction: '執行指令：x', rand: first, avoid: one }), one);
  assert.strictEqual(remarkFor('ando', { lastAction: '執行指令：x' }), '', '封存的角色不說話');
  assert.strictEqual(Object.keys(require('../data/remarks-archived.json')).length, 18);
});

test('已安裝即時提醒時，跑很久的指令不會被時間推測誤報成「在等你」；Codex 沒有鉤子仍照舊推測', () => {
  const mk = (extra) => {
    const t = setupWith(Object.assign({ projects: ['/p'] }, extra));
    const f = path.join(t.root, enc('/p'), 's.jsonl');
    append(f, [
      { type: 'user', cwd: '/p', timestamp: t.iso(), message: { role: 'user', content: '跑測試' } },
      { type: 'assistant', cwd: '/p', timestamp: t.iso(), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'sleep 60' } }] } }
    ]);
    t.w._onAdd('claude', f, false);
    t.advance(60 * 1000); t.w.tick();
    return t.events.map((e) => e.kind);
  };
  assert.deepStrictEqual(mk({ hooksInstalled: true }), ['start']);
  assert.deepStrictEqual(mk({ hooksInstalled: false }), ['start', 'waiting']);
});
