// Codex CLI 對話紀錄解析器。
// 紀錄位置：~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl，每行 { timestamp, type, payload }。
//
// 注意：這不是公開規格，Codex 改版時欄位可能變動。
// 原則：看不懂的行一律略過、不拋錯；只取需要的欄位。

const path = require('path');

const tool = 'codex';
const label = 'Codex';

function accepts(root, file) {
  return file.endsWith('.jsonl') && path.basename(file).startsWith('rollout-');
}

function isSystemText(t) {
  const s = String(t || '').trim();
  return !s || s.startsWith('<');            // <environment_context>、<user_instructions> 等
}

function commandText(cmd) {
  if (Array.isArray(cmd)) {
    // 常見形式：["bash", "-lc", "實際指令"]
    const last = cmd[cmd.length - 1];
    return String(cmd.length >= 3 && /sh$/.test(String(cmd[0])) ? last : cmd.join(' '));
  }
  return String(cmd || '');
}

function patchFiles(patch) {
  const files = [];
  const re = /\*\*\* (?:Update|Add|Delete) File: (.+)/g;
  let m;
  while ((m = re.exec(String(patch || '')))) files.push(m[1].trim());
  return files;
}

function safeJson(s) {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(s); } catch (e) { return {}; }
}

function parse(entry) {
  const out = [];
  if (!entry || typeof entry !== 'object') return out;
  const p = entry.payload;
  if (!p || typeof p !== 'object') return out;

  if (entry.type === 'session_meta' || entry.type === 'turn_context') {
    if (p.cwd) out.push({ type: 'cwd', cwd: p.cwd });
    return out;
  }

  if (entry.type === 'event_msg') {
    switch (p.type) {
      case 'user_message':
        if (!isSystemText(p.message)) out.push({ type: 'prompt', text: String(p.message).trim(), fromEvent: true });
        break;
      case 'agent_message':
        if (p.message) out.push({ type: 'text', text: String(p.message).trim() });
        break;
      case 'task_started':
        out.push({ type: 'turnStart' });
        break;
      case 'task_complete':
        if (p.last_agent_message) out.push({ type: 'text', text: String(p.last_agent_message).trim() });
        out.push({ type: 'turnEnd' });
        break;
      case 'turn_aborted':
        out.push({ type: 'turnEnd', interrupted: true });
        break;
      case 'exec_approval_request':
      case 'apply_patch_approval_request':
        out.push({ type: 'waiting' });
        break;
      default:
        break;
    }
    return out;
  }

  if (entry.type === 'response_item') {
    switch (p.type) {
      case 'message':
        // 新版同時寫 event_msg 與 response_item；使用者訊息以 event_msg 為準，這裡標記讓核心去重
        if (p.role === 'user') {
          const t = (Array.isArray(p.content) ? p.content : [])
            .map((c) => (c && (c.text || '')) || '').join('\n');
          if (!isSystemText(t)) out.push({ type: 'prompt', text: t.trim(), fromItem: true });
        }
        break;
      case 'function_call': {
        const args = safeJson(p.arguments);
        if (p.name === 'shell' || args.command) {
          out.push({ type: 'action', id: p.call_id, text: `執行指令：${commandText(args.command).split('\n')[0].slice(0, 60)}` });
        } else {
          out.push({ type: 'action', id: p.call_id, text: `使用工具 ${p.name}` });
        }
        break;
      }
      case 'local_shell_call': {
        const cmd = p.action && p.action.command;
        out.push({ type: 'action', id: p.call_id, text: `執行指令：${commandText(cmd).split('\n')[0].slice(0, 60)}` });
        break;
      }
      case 'custom_tool_call': {
        if (p.name === 'apply_patch') {
          const files = patchFiles(p.input);
          const names = files.map((f) => path.basename(f)).join('、');
          out.push({ type: 'action', id: p.call_id, text: `修改 ${names || '檔案'}`, files });
        } else {
          out.push({ type: 'action', id: p.call_id, text: `使用工具 ${p.name}` });
        }
        break;
      }
      case 'function_call_output':
      case 'custom_tool_call_output':
        out.push({ type: 'toolDone', id: p.call_id });
        break;
      default:
        break;
    }
  }
  return out;
}

module.exports = { tool, label, accepts, parse, depth: 4 };
