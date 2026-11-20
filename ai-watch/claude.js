// Claude Code 對話紀錄解析器。
// 紀錄位置：~/.claude/projects/<專案路徑編碼>/<sessionId>.jsonl，每行一個 JSON。
//
// 注意：這不是公開規格，Claude Code 改版時欄位可能變動。
// 原則：看不懂的行一律略過、不拋錯；只取需要的欄位。

const path = require('path');

const tool = 'claude';
const label = 'Claude Code';

// 只監看 projects/<專案>/<session>.jsonl 這一層（子代理紀錄在更深的目錄，略過）
function accepts(root, file) {
  if (!file.endsWith('.jsonl')) return false;
  const rel = path.relative(root, file).split(path.sep);
  return rel.length === 2;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

// 使用者訊息裡，系統自動插入的內容（指令輸出、提醒等）不算「使用者的指令」
function isSystemText(t) {
  const s = String(t || '').trim();
  return !s || s.startsWith('<') || s.startsWith('Caveat:');
}

function describeTool(name, input) {
  input = input || {};
  const file = input.file_path || input.notebook_path || input.path || '';
  const base = file ? path.basename(String(file)) : '';
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { text: `修改 ${base || '檔案'}`, file };
    case 'Write':
      return { text: `寫入 ${base || '檔案'}`, file };
    case 'Read':
      return { text: `讀取 ${base || '檔案'}` };
    case 'Bash':
      return { text: `執行指令：${String(input.command || '').split('\n')[0].slice(0, 60)}` };
    case 'Grep':
    case 'Glob':
      return { text: `搜尋 ${String(input.pattern || '').slice(0, 40)}` };
    case 'WebFetch':
    case 'WebSearch':
      return { text: '查詢網路資料' };
    case 'Task':
    case 'Agent':
      return { text: `派出子代理：${String(input.description || '').slice(0, 40)}` };
    case 'TodoWrite':
      return { text: '更新待辦清單' };
    default:
      return { text: `使用工具 ${name}` };
  }
}

/**
 * 解析一行紀錄，回傳訊號陣列（由 index.js 統一處理狀態）。
 * 訊號：{ type: 'cwd'|'prompt'|'action'|'toolDone'|'text'|'turnEnd', ... }
 */
function parse(entry) {
  const out = [];
  if (!entry || typeof entry !== 'object') return out;
  if (entry.cwd) out.push({ type: 'cwd', cwd: entry.cwd });
  // Claude Code 自動產生的對話標題
  if (entry.type === 'ai-title' && entry.aiTitle) out.push({ type: 'title', text: String(entry.aiTitle) });
  if (entry.isSidechain) return out;            // 子代理內部的對話，不視為主線進度
  const msg = entry.message;
  if (!msg || typeof msg !== 'object') return out;

  if (entry.type === 'user') {
    const content = msg.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b && b.type === 'tool_result') out.push({ type: 'toolDone', id: b.tool_use_id });
      }
    }
    const t = textOf(content);
    if (/^\[Request interrupted by user/.test(t.trim())) {
      out.push({ type: 'turnEnd', interrupted: true });
    } else if (!entry.isMeta && !isSystemText(t) && !(Array.isArray(content) && content.some((b) => b && b.type === 'tool_result'))) {
      out.push({ type: 'prompt', text: t.trim() });
    }
  } else if (entry.type === 'assistant') {
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const b of content) {
      if (!b) continue;
      if (b.type === 'tool_use') {
        const d = describeTool(b.name, b.input);
        out.push({ type: 'action', id: b.id, text: d.text, file: d.file });
      } else if (b.type === 'text' && b.text && b.text.trim()) {
        out.push({ type: 'text', text: b.text.trim() });
      }
    }
    if (msg.stop_reason === 'end_turn') out.push({ type: 'turnEnd' });
  }
  return out;
}

module.exports = { tool, label, accepts, parse, depth: 1 };
