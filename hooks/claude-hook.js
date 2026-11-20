#!/usr/bin/env node
// Claude Code 通知鉤子（由桌面大師安裝到 ~/.claude/settings.json）。
//
// 用途：Claude Code 發生「送出指令／需要你允許／回合結束」時，把事件記到桌寵的資料夾，
//       讓桌寵即時、精準地反應。
//
// 安全原則（這支腳本在每次 Claude Code 事件時都會執行）：
//  - 一律 exit 0；除了下面這個例外，stdout 不輸出任何東西 → 不阻擋、不改變 Claude 的行為
//  - 例外（PermissionRequest）：使用者開啟「在泡泡上回答」且桌寵開著時，等使用者在泡泡上按
//    允許／拒絕（最多 60 秒）再把決定回給 Claude；沒回答就不輸出，由 Claude 自己的畫面詢問。
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

const PERMISSION_WAIT_MS = 60 * 1000;   // 權限詢問最多等使用者 60 秒，之後交回 Claude 自己的詢問畫面
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

// 回傳 null（一般事件，已記錄完）或 Promise（權限詢問：等桌寵上的回答）
function main(raw) {
  const dir = process.argv[2];
  if (!dir) return null;
  let input;
  try { input = JSON.parse(raw); } catch (e) { return null; }
  if (!input || !input.cwd) return null;

  let watch;
  try { watch = JSON.parse(fs.readFileSync(path.join(dir, 'watch-projects.json'), 'utf8')); } catch (e) { return null; }
  const projects = Array.isArray(watch) ? watch : (watch && Array.isArray(watch.projects) ? watch.projects : []);
  const sessions = watch && Array.isArray(watch.sessions) ? watch.sessions.map(String) : [];
  const ok = inProjects(input.cwd, projects) || (input.session_id && sessions.includes(String(input.session_id)));
  if (!ok) return null;

  const isPermission = input.hook_event_name === 'PermissionRequest';
  // 權限詢問只有在「桌寵開著」且使用者開了「在泡泡上回答」時才處理；否則完全不介入
  if (isPermission && !(watch && watch.answer === true && appAlive(dir))) return null;

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
  let reqFile = '';
  if (isPermission) {
    // 要顯示在泡泡上的內容放在獨立的小檔，回答後就刪掉，不留在事件紀錄裡
    const id = `${Date.now()}-${process.pid}`;
    const pdir = path.join(dir, 'permission');
    fs.mkdirSync(pdir, { recursive: true });
    reqFile = path.join(pdir, id + '.json');
    fs.writeFileSync(reqFile, JSON.stringify({ id, tool_name: String(input.tool_name || ''), summary: summarize(input.tool_name, input.tool_input) }));
    ev.request_id = id;
    ev.tool_name = String(input.tool_name || '');
  }

  const file = path.join(dir, 'hook-events.jsonl');
  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + '.old');
  } catch (e) { /* 檔案還不存在 */ }
  fs.appendFileSync(file, JSON.stringify(ev) + '\n');

  return isPermission ? waitForAnswer(reqFile) : null;
}

// 桌寵每幾秒更新一次 app-alive；太久沒更新代表桌寵沒開，就不要讓 Claude 空等
function appAlive(dir) {
  try { return Date.now() - fs.statSync(path.join(dir, 'app-alive')).mtimeMs < 20000; } catch (e) { return false; }
}

// 給泡泡看的一行摘要（只取最必要的部分）
function summarize(tool, input) {
  input = input || {};
  if (typeof input.command === 'string') return input.command.split('\n')[0].slice(0, 80);
  const f = input.file_path || input.notebook_path || input.path || '';
  if (f) return path.basename(String(f));
  if (typeof input.url === 'string') return input.url.slice(0, 80);
  return '';
}

// 等桌寵寫入 <id>.answer.json：allow／deny 就回覆 Claude；其他或逾時就什麼都不說（交回 Claude 自己的詢問畫面）
function waitForAnswer(reqFile) {
  const ansFile = reqFile.replace(/\.json$/, '.answer.json');
  const deadline = Date.now() + PERMISSION_WAIT_MS;
  return new Promise((resolve) => {
    const finish = (out) => {
      try { fs.unlinkSync(reqFile); } catch (e) { /* ignore */ }
      try { fs.unlinkSync(ansFile); } catch (e) { /* ignore */ }
      if (out) process.stdout.write(JSON.stringify(out));
      resolve();
    };
    const tick = () => {
      let ans = null;
      try { ans = JSON.parse(fs.readFileSync(ansFile, 'utf8')); } catch (e) { /* 還沒回答 */ }
      if (ans && ans.choice === 'allow') {
        return finish({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
      }
      if (ans && ans.choice === 'deny') {
        return finish({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: '使用者在桌面大師上按了「拒絕」。' } } });
      }
      if (ans || Date.now() > deadline) return finish(null);
      setTimeout(tick, 200);
    };
    tick();
  });
}

let raw = '';
let guard = setTimeout(() => process.exit(0), 3000);   // 一般事件最多 3 秒，絕不拖住 Claude Code
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let pending = null;
  try { pending = main(raw); } catch (e) { /* 吞掉所有錯誤 */ }
  clearTimeout(guard);
  if (!pending) process.exit(0);
  guard = setTimeout(() => process.exit(0), PERMISSION_WAIT_MS + 5000);
  pending.then(() => process.exit(0), () => process.exit(0));
});
process.stdin.on('error', () => process.exit(0));
