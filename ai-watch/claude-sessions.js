// 列出本機最近的 Claude Code 對話（給「加入對話」挑選用）。
//
// 紀錄位置：~/.claude/projects/<專案路徑編碼>/<sessionId>.jsonl
// 標題來源（後者覆蓋前者）：第一句指令 → Claude 自動標題（ai-title）→ 使用者命名（custom-title，
// Claude 桌面版側欄顯示的就是這個）。
// 只讀不寫；大型紀錄只讀檔頭與結尾，避免拖慢面板。

const fs = require('fs');
const path = require('path');

const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 2 * 1024 * 1024;

function readPart(fd, start, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, start);
  return buf.toString('utf8', 0, n);
}

function readHeadTail(file, size) {
  const fd = fs.openSync(file, 'r');
  try {
    if (size <= HEAD_BYTES + TAIL_BYTES) return { head: readPart(fd, 0, size), tail: '' };
    return { head: readPart(fd, 0, HEAD_BYTES), tail: readPart(fd, size - TAIL_BYTES, TAIL_BYTES) };
  } finally {
    fs.closeSync(fd);
  }
}

function firstPromptText(entry) {
  if (!entry || entry.type !== 'user' || entry.isMeta || entry.isSidechain || !entry.message) return '';
  const c = entry.message.content;
  const t = typeof c === 'string' ? c
    : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ') : '';
  const s = String(t || '').trim();
  return !s || s.startsWith('<') || s.startsWith('Caveat:') ? '' : s;
}

// 讀出一個紀錄檔的摘要：{ id, file, cwd, title, mtime }
function summarize(file) {
  const st = fs.statSync(file);
  const { head, tail } = readHeadTail(file, st.size);
  let cwd = '';
  let prompt = '';
  let aiTitle = '';
  let customTitle = '';
  const scan = (text, isHead) => {
    for (const line of text.split('\n')) {
      // 先用字串粗篩，只解析可能有用的行
      const want = line.includes('-title"') || (isHead && (!cwd || !prompt));
      if (!want) continue;
      let e;
      try { e = JSON.parse(line); } catch (err) { continue; }
      if (!cwd && e.cwd) cwd = String(e.cwd);
      if (!prompt) prompt = firstPromptText(e);
      if (e.type === 'ai-title' && e.aiTitle) aiTitle = String(e.aiTitle);
      if (e.type === 'custom-title' && e.customTitle) customTitle = String(e.customTitle);
    }
  };
  scan(head, true);
  if (tail) scan(tail, false);
  const title = (customTitle || aiTitle || prompt.replace(/\s+/g, ' ').slice(0, 60) || '（尚無指令）').trim();
  return { id: path.basename(file, '.jsonl'), file, cwd, title, mtime: st.mtimeMs };
}

/**
 * 最近的 Claude Code 對話，最近修改的在前。
 * @param {string} root  ~/.claude/projects
 * @param {{limit?: number, maxAgeMs?: number, now?: number}} opts
 */
function listClaudeSessions(root, opts = {}) {
  const limit = opts.limit || 40;
  const maxAgeMs = opts.maxAgeMs || 14 * 24 * 3600 * 1000;
  const now = opts.now || Date.now();
  const files = [];
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch (e) { return []; }
  for (const d of dirs) {
    const dir = path.join(root, d.name);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const f = path.join(dir, n);
      try {
        const st = fs.statSync(f);
        if (st.isFile() && st.size > 0 && now - st.mtimeMs <= maxAgeMs) files.push({ f, m: st.mtimeMs });
      } catch (e) { /* 略過 */ }
    }
  }
  files.sort((a, b) => b.m - a.m);
  const out = [];
  for (const { f } of files.slice(0, limit)) {
    try {
      const s = summarize(f);
      if (s.title !== '（尚無指令）') out.push(s);
    } catch (e) { /* 讀不到就略過 */ }
  }
  return out;
}

module.exports = { listClaudeSessions, summarize };
