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
  const file = path.join(t.root, '-p', 's.jsonl');
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
  const file = path.join(t.root, '-p', 's.jsonl');
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
  const file = path.join(t.root, '-p', 's.jsonl');
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
  const file = path.join(t.root, '-p', 's.jsonl');
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
  const file = path.join(t.root, '-p', 's.jsonl');
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
