#!/usr/bin/env node
// Claude Code 通知鉤子（由桌面大師安裝到 ~/.claude/settings.json）。
//
// 用途：Claude Code 發生「送出指令／需要你允許／回合結束」時，把事件記到桌寵的資料夾，
//       讓桌寵即時、精準地反應。
//
// 安全原則（這支腳本在每次 Claude Code 事件時都會執行）：
//  - 一律 exit 0；除了下面這個例外，stdout 不輸出任何東西 → 不阻擋、不改變 Claude 的行為
//  - 例外（PermissionRequest）：使用者開啟「在泡泡上回答」且桌寵開著時，等使用者在泡泡上按
//    允許／拒絕（最多 10 分鐘）再把決定回給 Claude；沒回答就不輸出，由 Claude 自己的畫面詢問。
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

// 最多等使用者 10 分鐘。等待期間 Claude 自己的詢問畫面照常可用（兩邊誰先回答算誰的），
// 桌寵發現對話不再等待時也會主動放掉，所以等久一點不會卡住任何東西。
const PERMISSION_WAIT_MS = 10 * 60 * 1000;
// 從桌寵送給 Claude 的訊息，前後各加一小段說明
const REPLY_PREFIX = '使用者透過桌面大師（桌寵）傳來新的訊息，請當成使用者的下一則訊息來處理：\n';
const REPLY_SUFFIX = '\n\n（你的回覆會顯示在桌寵的小泡泡上：第一行請用一句 30 字以內的完整句子直接講結論，細節寫在後面。）';
const STOP_BASE_WAIT_MS = 20 * 1000;    // 回合結束後先等 20 秒，看使用者要不要在泡泡上回覆
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
  // Claude 用選項問問題（AskUserQuestion）：把題目和選項交給桌寵；複選題桌寵不處理，交回 Claude
  const questions = isPermission && input.tool_name === 'AskUserQuestion' ? pickQuestions(input.tool_input) : null;
  if (isPermission && input.tool_name === 'AskUserQuestion' && !questions) return null;
  if (isPermission) {
    // 要顯示在泡泡上的內容放在獨立的小檔，回答後就刪掉，不留在事件紀錄裡
    const id = `${Date.now()}-${process.pid}`;
    const pdir = path.join(dir, 'permission');
    fs.mkdirSync(pdir, { recursive: true });
    reqFile = path.join(pdir, id + '.json');
    fs.writeFileSync(reqFile, JSON.stringify({ id, tool_name: String(input.tool_name || ''), summary: summarize(input.tool_name, input.tool_input), questions: questions || undefined }));
    ev.request_id = id;
    ev.tool_name = String(input.tool_name || '');
  }

  // 回合結束時先看「待送信箱」：使用者在 Claude 做事途中從桌寵打的話，這時交給 Claude 繼續做
  if (input.hook_event_name === 'Stop' && /^[\w-]+$/.test(String(input.session_id || ''))) {
    const ob = path.join(dir, 'outbox', String(input.session_id) + '.json');
    let queued = '';
    try { queued = String(JSON.parse(fs.readFileSync(ob, 'utf8')).text || '').trim(); } catch (e) { /* 沒有待送的 */ }
    if (queued) {
      try { fs.unlinkSync(ob); } catch (e) { /* ignore */ }
      process.stdout.write(JSON.stringify({ decision: 'block', reason: REPLY_PREFIX + queued + REPLY_SUFFIX }));
      return null;
    }
  }

  // 回合結束：使用者開了「做完後可在泡泡回覆」且桌寵開著時，留一個回覆請求給桌寵
  const isReply = input.hook_event_name === 'Stop' && watch && watch.answer === true && watch.replyAfterDone === true && appAlive(dir);
  if (isReply) {
    const id = `${Date.now()}-${process.pid}`;
    const pdir = path.join(dir, 'permission');
    fs.mkdirSync(pdir, { recursive: true });
    reqFile = path.join(pdir, id + '.json');
    fs.writeFileSync(reqFile, JSON.stringify({ id, kind: 'stop' }));
    ev.request_id = id;
  }

  const file = path.join(dir, 'hook-events.jsonl');
  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + '.old');
  } catch (e) { /* 檔案還不存在 */ }
  fs.appendFileSync(file, JSON.stringify(ev) + '\n');

  if (isReply) return waitForReply(reqFile);
  return isPermission ? waitForAnswer(reqFile, input.tool_input) : null;
}

// 只接受「每題單選、選項 2～6 個」的題目；其他情況回傳 null（不介入）
function pickQuestions(toolInput) {
  const qs = toolInput && Array.isArray(toolInput.questions) ? toolInput.questions : [];
  if (!qs.length || qs.length > 4) return null;
  const out = [];
  for (const q of qs) {
    const opts = q && Array.isArray(q.options) ? q.options.map((o) => String((o && o.label) || '')).filter(Boolean) : [];
    if (!q || q.multiSelect || typeof q.question !== 'string' || opts.length < 2 || opts.length > 6) return null;
    out.push({ question: q.question, options: opts });
  }
  return out;
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
function waitForAnswer(reqFile, toolInput) {
  const ansFile = reqFile.replace(/\.json$/, '.answer.json');
  const deadline = Date.now() + PERMISSION_WAIT_MS;
  return new Promise((resolve) => {
    const finish = (out, why) => {
      // 除錯用的小紀錄：只記時間與結果，不記內容
      try {
        fs.appendFileSync(path.join(path.dirname(path.dirname(reqFile)), 'permission-debug.log'),
          `${new Date().toISOString()} hook ${path.basename(reqFile, '.json')} ${why} waited=${Math.round((Date.now() - (deadline - PERMISSION_WAIT_MS)) / 1000)}s
`);
      } catch (e) { /* ignore */ }
      try { fs.unlinkSync(reqFile); } catch (e) { /* ignore */ }
      try { fs.unlinkSync(ansFile); } catch (e) { /* ignore */ }
      if (out) process.stdout.write(JSON.stringify(out));
      resolve();
    };
    const tick = () => {
      let ans = null;
      try { ans = JSON.parse(fs.readFileSync(ansFile, 'utf8')); } catch (e) { /* 還沒回答 */ }
      if (ans && ans.choice === 'allow') {
        const decision = { behavior: 'allow' };
        // 選擇題：把使用者選的答案放回工具輸入（題目文字 → 選項文字）
        if (ans.answers && typeof ans.answers === 'object') decision.updatedInput = Object.assign({}, toolInput, { answers: ans.answers });
        return finish({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }, decision.updatedInput ? 'allow+answers' : 'allow');
      }
      if (ans && ans.choice === 'deny') {
        return finish({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: typeof ans.message === 'string' && ans.message ? '使用者沒有允許這一步，並說：' + ans.message : '使用者在桌面大師上按了「拒絕」。' } } }, 'deny');
      }
      if (ans || Date.now() > deadline) return finish(null, ans ? 'pass' : 'timeout');
      setTimeout(tick, 200);
    };
    tick();
  });
}

// 回合結束（Stop）後短暫等一下：使用者若在泡泡上打字，就把那句話交給 Claude 讓它繼續做。
//  - 先等 STOP_BASE_WAIT_MS；這段時間內使用者開始打字（桌寵寫入 <id>.hold）才會繼續等，最多 10 分鐘。
//  - 沒人理就什麼都不輸出，Claude 照常結束。
function waitForReply(reqFile) {
  const ansFile = reqFile.replace(/\.json$/, '.answer.json');
  const holdFile = reqFile.replace(/\.json$/, '.hold');
  const started = Date.now();
  return new Promise((resolve) => {
    const finish = (out, why) => {
      try {
        fs.appendFileSync(path.join(path.dirname(path.dirname(reqFile)), 'permission-debug.log'),
          new Date().toISOString() + ' hook ' + path.basename(reqFile, '.json') + ' stop:' + why + ' waited=' + Math.round((Date.now() - started) / 1000) + 's\n');
      } catch (e) { /* ignore */ }
      for (const f of [reqFile, ansFile, holdFile]) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
      if (out) process.stdout.write(JSON.stringify(out));
      resolve();
    };
    const tick = () => {
      let ans = null;
      try { ans = JSON.parse(fs.readFileSync(ansFile, 'utf8')); } catch (e) { /* 還沒回答 */ }
      if (ans && ans.choice === 'reply' && typeof ans.message === 'string' && ans.message.trim()) {
        return finish({ decision: 'block', reason: REPLY_PREFIX + ans.message.trim() + REPLY_SUFFIX }, 'reply');
      }
      if (ans) return finish(null, 'pass');
      const waited = Date.now() - started;
      const holding = fs.existsSync(holdFile);
      if (waited > PERMISSION_WAIT_MS || (!holding && waited > STOP_BASE_WAIT_MS)) return finish(null, 'timeout');
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
