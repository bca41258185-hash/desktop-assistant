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
  // 真正「最後使用」的時間 = 最後一則對話訊息的時間。
  // 不能用檔案修改時間：Claude 桌面版開啟時會在舊紀錄後面補寫標題，檔案時間會變新。
  let lastUsed = 0;
  const lines = (tail || head).split('\n');
  for (let i = lines.length - 1; i >= 0 && !lastUsed; i--) {
    const line = lines[i];
    if (!line.includes('"timestamp"') || line.length > 400000) continue;
    try {
      const e = JSON.parse(line);
      if ((e.type === 'user' || e.type === 'assistant') && e.timestamp) lastUsed = Date.parse(e.timestamp) || 0;
    } catch (err) { /* 被截斷的行 */ }
  }
  const title = (customTitle || aiTitle || prompt.replace(/\s+/g, ' ').slice(0, 60) || '（尚無指令）').trim();
  return { id: path.basename(file, '.jsonl'), file, cwd, title, mtime: lastUsed || st.mtimeMs };
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
      if (s.title !== '（尚無指令）' && now - s.mtime <= maxAgeMs) out.push(s);
    } catch (e) { /* 讀不到就略過 */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// ---------------------------------------------------------------------------
// Claude 桌面版的側欄資料（唯讀）：每段對話一個小檔，記著側欄標題、是否封存、
// 以及它是從哪段對話開出來的。用來讓挑選清單和側欄長得一樣。
// 位置：%LOCALAPPDATA%/Claude-Data/<帳號>/claude-code-sessions/**/local_*.json
// ---------------------------------------------------------------------------
function desktopSessionDirs() {
  const out = [];
  const bases = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Claude-Data'), process.env.APPDATA && path.join(process.env.APPDATA, 'Claude')].filter(Boolean);
  for (const base of bases) {
    let names = [];
    try { names = fs.readdirSync(base); } catch (e) { continue; }
    for (const n of [''].concat(names)) {
      const d = path.join(base, n, 'claude-code-sessions');
      try { if (fs.statSync(d).isDirectory()) out.push(d); } catch (e) { /* 沒有 */ }
    }
  }
  return out;
}

function walkJson(dir, depth, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) walkJson(p, depth - 1, out); } else if (e.name.startsWith('local_') && e.name.endsWith('.json')) out.push(p);
  }
}

/**
 * 回傳 Map：CLI 對話 ID → { title, archived, group, parentTitle }
 *  - group：側欄的群組名稱（最上層母對話所在資料夾的名稱）
 *  - parentTitle：若是從別段對話開出來的，母對話的標題
 */
function desktopSessionMeta(dirs) {
  const byLocal = new Map();
  for (const d of dirs || desktopSessionDirs()) {
    const files = [];
    walkJson(d, 3, files);
    for (const f of files) {
      try {
        const o = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (o && o.sessionId) byLocal.set(o.sessionId, o);
      } catch (e) { /* 略過讀不懂的 */ }
    }
  }
  const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
  const out = new Map();
  for (const o of byLocal.values()) {
    if (!o.cliSessionId) continue;
    let root = o;
    for (let i = 0; i < 10 && root.spawnedFrom && byLocal.has(root.spawnedFrom.sessionId); i++) root = byLocal.get(root.spawnedFrom.sessionId);
    const parent = o.spawnedFrom && byLocal.get(o.spawnedFrom.sessionId);
    out.set(String(o.cliSessionId), {
      title: String(o.title || ''),
      archived: !!o.isArchived,
      group: base(root.originCwd || root.cwd),
      parentTitle: parent ? String(parent.title || '') : ''
    });
  }
  return out;
}

module.exports = { listClaudeSessions, summarize, desktopSessionMeta };
