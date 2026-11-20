// Claude Code 通知鉤子的安裝／移除（修改使用者層級的 settings.json）。
//
// 原則：
//  - 只在使用者於面板按下按鈕並確認後才執行。
//  - 合併而非覆蓋：保留使用者原有的所有設定與其他鉤子，只增刪「本程式的」項目
//    （以指令中包含 hooks/claude-hook.js 辨識）。
//  - 修改前先備份原檔；原檔無法解析（例如格式錯誤）就完全不動，回報錯誤。
//  - 以「寫入暫存檔再改名」的方式寫入，避免寫到一半損毀設定檔。

const fs = require('fs');
const path = require('path');
const os = require('os');

const EVENTS = ['UserPromptSubmit', 'Notification', 'Stop'];
const MARKER = 'hooks/claude-hook.js';

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function settingsPath() {
  return path.join(claudeDir(), 'settings.json');
}

// 一律使用正斜線：在 sh、Git Bash、PowerShell 下都能正確解讀，Node 在 Windows 也接受
function slash(p) {
  return String(p).replace(/\\/g, '/');
}

function buildCommand(scriptPath, dataDir) {
  return `node "${slash(scriptPath)}" "${slash(dataDir)}"`;
}

function isOurs(h) {
  return !!(h && typeof h.command === 'string' && h.command.includes(MARKER));
}

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return {};
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('不是物件');
    return obj;
  } catch (e) {
    throw new Error(`無法解析 ${file}（${e.message}），為避免損毀設定，未做任何修改。`);
  }
}

function writeSettings(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-desktop-assistant';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${file}.bak-desktop-assistant-${stamp}`;
  fs.copyFileSync(file, bak);
  return bak;
}

// 從設定物件移除本程式的鉤子（不動其他鉤子）；回傳移除的數量
function stripOurs(settings) {
  let removed = 0;
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return 0;
  for (const ev of Object.keys(hooks)) {
    if (!Array.isArray(hooks[ev])) continue;
    hooks[ev] = hooks[ev]
      .map((group) => {
        if (!group || !Array.isArray(group.hooks)) return group;
        const kept = group.hooks.filter((h) => !isOurs(h));
        removed += group.hooks.length - kept.length;
        return kept.length === group.hooks.length ? group : Object.assign({}, group, { hooks: kept });
      })
      .filter((group) => !(group && Array.isArray(group.hooks) && group.hooks.length === 0));
    if (hooks[ev].length === 0) delete hooks[ev];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  return removed;
}

function status(file) {
  file = file || settingsPath();
  let settings;
  try { settings = readSettings(file); } catch (e) { return { installed: false, error: e.message, file }; }
  const found = new Set();
  let command = '';
  const hooks = settings.hooks || {};
  for (const ev of Object.keys(hooks)) {
    for (const group of hooks[ev] || []) {
      for (const h of (group && group.hooks) || []) {
        if (isOurs(h)) { found.add(ev); command = h.command; }
      }
    }
  }
  return { installed: EVENTS.every((e) => found.has(e)), partial: found.size > 0, events: [...found], command, file };
}

function install({ scriptPath, dataDir, file }) {
  file = file || settingsPath();
  const settings = readSettings(file);      // 解析失敗會丟錯，不會寫入
  const bak = backup(file);
  stripOurs(settings);                        // 重新安裝時先移除舊的（例如程式搬了位置）
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
  const command = buildCommand(scriptPath, dataDir);
  for (const ev of EVENTS) {
    if (!Array.isArray(settings.hooks[ev])) settings.hooks[ev] = [];
    settings.hooks[ev].push({ hooks: [{ type: 'command', command, timeout: 5 }] });
  }
  writeSettings(file, settings);
  return { file, backup: bak, command };
}

function uninstall({ file } = {}) {
  file = file || settingsPath();
  const settings = readSettings(file);
  const removed = stripOurs(settings);
  if (!removed) return { file, removed: 0, backup: null };
  const bak = backup(file);
  writeSettings(file, settings);
  return { file, removed, backup: bak };
}

module.exports = { install, uninstall, status, settingsPath, buildCommand, EVENTS };
