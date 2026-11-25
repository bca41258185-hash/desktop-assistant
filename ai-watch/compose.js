// 主動對 Claude 說話：把使用者在桌寵上打的字送進指定的對話。
//
// 依對話當下的狀態走不同的路（由 main.js 決定用哪一條）：
//  1. Claude 正在做事 → 寫進「待送信箱」（outbox/<對話 ID>.json），回合結束時由 Stop 鉤子交給 Claude。
//  2. Claude 閒著      → 用 Claude 桌面版的官方連結 claude://code/continue?session=… 開到那段對話，
//                        再把文字貼進輸入框並送出（只有在最前面的視窗確實是 Claude 時才按鍵）。
//
// 這個檔只放不依賴 Electron 的部分，方便測試。

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function outboxFile(hooksDir, sessionId) {
  return path.join(hooksDir, 'outbox', String(sessionId) + '.json');
}

// 放進待送信箱；同一段對話還有沒送出的就接在後面
function queueMessage(hooksDir, sessionId, text) {
  if (!/^[\w-]+$/.test(String(sessionId || ''))) throw new Error('對話代號不正確');
  const file = outboxFile(hooksDir, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prev = '';
  try { prev = String(JSON.parse(fs.readFileSync(file, 'utf8')).text || ''); } catch (e) { /* 沒有舊的 */ }
  fs.writeFileSync(file, JSON.stringify({ text: prev ? prev + '\n' + text : text, t: Date.now() }));
  return file;
}

function clearMessage(hooksDir, sessionId) {
  try { fs.unlinkSync(outboxFile(hooksDir, sessionId)); } catch (e) { /* 沒有就算了 */ }
}

// 最前面的視窗是 Claude 才貼上並按 Enter；不是就什麼都不按（避免把字打到別的程式）。
// 結果印在 stdout：sent／not-claude
const PASTE_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  "Add-Type 'using System; using System.Runtime.InteropServices; public class FG { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }'",
  '$ok = $false',
  'for ($i = 0; $i -lt 30 -and -not $ok; $i++) {',
  '  Start-Sleep -Milliseconds 150',
  '  $procId = 0; [void][FG]::GetWindowThreadProcessId([FG]::GetForegroundWindow(), [ref]$procId)',
  '  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue',
  "  if ($p -and $p.ProcessName -eq 'claude') { $ok = $true }",
  '}',
  "if (-not $ok) { 'not-claude'; exit }",
  'Start-Sleep -Milliseconds 900',
  "[System.Windows.Forms.SendKeys]::SendWait('^v')",
  'Start-Sleep -Milliseconds 350',
  "[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')",
  "'sent'"
].join('\n');

function pasteIntoClaude() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('unsupported');
    let out = '';
    let p;
    try {
      p = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', PASTE_SCRIPT], { windowsHide: true });
    } catch (e) { return resolve('error'); }
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve('error'));
    p.on('close', () => resolve(out.includes('sent') ? 'sent' : out.includes('not-claude') ? 'not-claude' : 'error'));
  });
}

module.exports = { queueMessage, clearMessage, outboxFile, pasteIntoClaude };
