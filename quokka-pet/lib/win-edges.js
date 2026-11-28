// 桌面上其他視窗的「上緣」：給庫卡爬上去站著用（只有 Windows）。
// 需要時才開一個小幫手（PowerShell 呼叫系統的 EnumWindows），每 0.3 秒回報一次所有看得見的視窗位置；
// 20 秒沒人問就關掉，平常不佔資源。只讀視窗的位置和大小，不讀內容、標題文字。
(function () {
  'use strict';
  const { spawn } = require('child_process');

  // C# 原始碼裡的字串用 ~ 代替雙引號（整段當成命令列參數傳給 PowerShell，避免引號被吃掉）
  const CS = `
using System; using System.Text; using System.Runtime.InteropServices;
public class QW {
  delegate bool EP(IntPtr h, IntPtr l);
  [DllImport(~user32.dll~)] static extern bool EnumWindows(EP f, IntPtr l);
  [DllImport(~user32.dll~)] static extern bool IsWindowVisible(IntPtr h);
  [DllImport(~user32.dll~)] static extern bool IsIconic(IntPtr h);
  [DllImport(~user32.dll~)] static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport(~user32.dll~)] static extern int GetWindowTextLength(IntPtr h);
  [DllImport(~user32.dll~)] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport(~user32.dll~, CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport(~dwmapi.dll~)] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int sz);
  [StructLayout(LayoutKind.Sequential)] struct R { public int l, t, r, b; }
  public static string Snap() {
    StringBuilder sb = new StringBuilder(~[~);
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      int c = 0; DwmGetWindowAttribute(h, 14, out c, 4); if (c != 0) return true;
      R r; if (!GetWindowRect(h, out r)) return true;
      if (r.r - r.l < 40 || r.b - r.t < 20) return true;
      int ex = GetWindowLong(h, -20);
      if ((ex & 0x20) != 0 && (ex & 0x80000) != 0) return true;
      StringBuilder cn = new StringBuilder(64); GetClassName(h, cn, 64); string k = cn.ToString();
      int ok = (GetWindowTextLength(h) > 0 && (ex & 0x80) == 0 && k != ~Progman~ && k != ~WorkerW~ && k != ~Shell_TrayWnd~ && k != ~Shell_SecondaryTrayWnd~) ? 1 : 0;
      if (sb.Length > 1) sb.Append(',');
      sb.Append('[').Append(h.ToInt64()).Append(',').Append(r.l).Append(',').Append(r.t).Append(',').Append(r.r).Append(',').Append(r.b).Append(',').Append(ok).Append(']');
      return true;
    }, IntPtr.Zero);
    return sb.Append(']').ToString();
  }
}`;
  const script = (ppid) => `$ErrorActionPreference='Stop'; $src=@'${CS}\n'@; Add-Type -TypeDefinition $src.Replace('~',[string][char]34); $n=0; while($true){ [Console]::Out.WriteLine([QW]::Snap()); Start-Sleep -Milliseconds 300; $n++; if($n % 10 -eq 0 -and -not (Get-Process -Id ${ppid} -ErrorAction SilentlyContinue)){ break } }`;

  // 從視窗清單（最上層的排最前面）算出每個視窗「看得見的上緣」：被上面的視窗蓋住的區段扣掉
  function visibleEdges(wins, { own = [], ox = 0, oy = 0, minWidth = 150 } = {}) {
    const skip = new Set(own.map(Number));
    const list = wins.filter((w) => Array.isArray(w) && w.length >= 6 && !skip.has(Number(w[0])));
    const out = [];
    list.forEach((w, i) => {
      if (!w[5]) return;
      const [id, l, t, r] = w;
      let segs = [[l + 10, r - 10]];
      for (let j = 0; j < i && segs.length; j++) {
        const o = list[j];
        if (o[2] > t || o[4] <= t) continue;                    // 上面那個視窗沒有蓋到這條線
        const next = [];
        for (const [a, b] of segs) {
          if (o[3] <= a || o[1] >= b) { next.push([a, b]); continue; }
          if (o[1] > a) next.push([a, o[1]]);
          if (o[3] < b) next.push([o[3], b]);
        }
        segs = next;
      }
      for (const [a, b] of segs) if (b - a >= minWidth) out.push({ id: String(id), wl: l - ox, y: t - oy, x1: a - ox, x2: b - ox });
    });
    return out;
  }

  function create({ idleMs = 20000 } = {}) {
    let ps = null, last = [], lastAt = 0, buf = '', idle = null;
    function stop() { clearTimeout(idle); idle = null; if (ps) { try { ps.kill(); } catch (e) { /* 已經結束 */ } ps = null; } last = []; lastAt = 0; }
    function start() {
      if (ps || process.platform !== 'win32') return;
      try {
        ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      } catch (e) { ps = null; return; }
      const me = ps; buf = '';
      ps.stdout.setEncoding('utf8');
      ps.stdout.on('data', (d) => {
        buf += d; let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (line[0] === '[') { try { last = JSON.parse(line); lastAt = Date.now(); } catch (e) { /* 這一行壞了就跳過 */ } }
        }
        if (buf.length > 200000) buf = '';
      });
      const gone = () => { if (ps === me) { ps = null; last = []; lastAt = 0; } };
      ps.on('exit', gone); ps.on('error', gone);
    }
    // 回傳 { ready, edges }：第一次呼叫會啟動幫手（ready=false），過一兩秒再問就有資料
    function edges(opts) {
      start();
      clearTimeout(idle); idle = setTimeout(stop, idleMs); if (idle.unref) idle.unref();
      const fresh = lastAt && Date.now() - lastAt < 2500;
      return { ready: !!fresh, edges: fresh ? visibleEdges(last, opts) : [] };
    }
    return { edges, stop, running: () => !!ps };
  }
  module.exports = { create, visibleEdges };
})();
