#!/usr/bin/env node
// Claude Code 通知鉤子（由桌面大師安裝到 ~/.claude/settings.json）。
//
// 用途：Claude Code 發生「送出指令／需要你允許／回合結束」時，把事件記到桌寵的資料夾，
//       讓桌寵即時、精準地反應。
//
// 安全原則（這支腳本在每次 Claude Code 事件時都會執行）：
//  - 一律 exit 0、stdout 不輸出任何東西 → 絕不阻擋或改變 Claude 的行為
//    （UserPromptSubmit 的 stdout 會被加進 Claude 的上下文，所以必須保持安靜）。
//  - 只記錄「指定專案」內或「指定對話」（session ID）的事件；其他對話直接略過、不寫任何東西。
//  - 不記錄你輸入的指令內容與 Claude 的回覆，只記事件種類、時間、對話檔路徑。
//  - 不依賴任何套件；任何錯誤都吞掉。
//
// 用法：node claude-hook.js <資料夾>
//   <資料夾>/watch-projects.json  ← 桌寵寫入的清單：{ projects: [...], sessions: [...] }
//                                    （舊版為專案路徑陣列，仍相容）
//   <資料夾>/hook-events.jsonl    ← 這支腳本附加事件的檔案

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024;   // 事件檔超過 1MB 就換新，避免無限成長

function norm(p) {
  let s = path.resolve(String(p || '')).replace(/\\/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32') s = s.toLowerCase();
  return s;
}

function inProjects(cwd, projects) {
  const c = norm(cwd);
  return projects.some((p) => {
    const n = norm(p);
    return c === n || c.startsWith(n + '/');
  });
}

function main(raw) {
  const dir = process.argv[2];
  if (!dir) return;
  let input;
  try { input = JSON.parse(raw); } catch (e) { return; }
  if (!input || !input.cwd) return;

  let watch;
  try { watch = JSON.parse(fs.readFileSync(path.join(dir, 'watch-projects.json'), 'utf8')); } catch (e) { return; }
  const projects = Array.isArray(watch) ? watch : (watch && Array.isArray(watch.projects) ? watch.projects : []);
  const sessions = watch && Array.isArray(watch.sessions) ? watch.sessions.map(String) : [];
  const ok = inProjects(input.cwd, projects) || (input.session_id && sessions.includes(String(input.session_id)));
  if (!ok) return;

  const ev = {
    t: new Date().toISOString(),
    event: input.hook_event_name,
    session_id: input.session_id,
    transcript_path: input.transcript_path,
    cwd: input.cwd
  };
  if (input.hook_event_name === 'Notification') {
    ev.notification_type = input.notification_type || '';
    ev.message = String(input.message || '').slice(0, 200);   // 系統通知文字，例如「Claude needs your permission to use Bash」
  }

  const file = path.join(dir, 'hook-events.jsonl');
  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + '.old');
  } catch (e) { /* 檔案還不存在 */ }
  fs.appendFileSync(file, JSON.stringify(ev) + '\n');
}

let raw = '';
const guard = setTimeout(() => process.exit(0), 3000);   // 最多 3 秒，絕不拖住 Claude Code
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  try { main(raw); } catch (e) { /* 吞掉所有錯誤 */ }
  clearTimeout(guard);
  process.exit(0);
});
process.stdin.on('error', () => process.exit(0));
