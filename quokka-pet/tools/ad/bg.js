// 假桌面：直接插在舞台頁面最底層，和庫卡一起算圖（向量 CSS／SVG，任何縮放都清晰）
// 沒有任何真實軟體或品牌；不顯示時鐘。
function inject(opt = {}) {
  const icon = (kind, label) => {
    const g = kind === 'folder'
      ? '<path d="M6 16 h22 l6 6 h30 a5 5 0 0 1 5 5 v30 a5 5 0 0 1 -5 5 h-58 a5 5 0 0 1 -5 -5 v-36 a5 5 0 0 1 5 -5z" fill="#f3c97a"/><path d="M1 30 h68 v28 a5 5 0 0 1 -5 5 h-58 a5 5 0 0 1 -5 -5z" fill="#f7d898"/>'
      : kind === 'doc'
        ? '<path d="M14 6 h30 l14 14 v42 a4 4 0 0 1 -4 4 h-40 a4 4 0 0 1 -4 -4 v-52 a4 4 0 0 1 4 -4z" fill="#ffffff"/><path d="M44 6 v14 h14" fill="#e3ecf5"/><rect x="18" y="30" width="32" height="4" rx="2" fill="#b9c9d9"/><rect x="18" y="40" width="28" height="4" rx="2" fill="#b9c9d9"/><rect x="18" y="50" width="22" height="4" rx="2" fill="#b9c9d9"/>'
        : '<rect x="6" y="10" width="58" height="50" rx="8" fill="#fff"/><path d="M12 52 l14 -18 l10 12 l8 -8 l14 14z" fill="#9fd3a8"/><circle cx="48" cy="24" r="6" fill="#f6cf6a"/>';
    return `<div class="ic"><svg viewBox="0 0 70 70">${g}</svg><span>${label}</span></div>`;
  };
  const lines = (n) => Array.from({ length: n }, (_, i) => `<p style="width:${90 - ((i * 37) % 45)}%"></p>`).join('');
  const busy = !!opt.busy;
  const win = (cls, title, body) => `<div class="win ${cls}"><div class="wt"><i></i><i></i><i></i><b>${title}</b></div><div class="wb">${body}</div></div>`;
  const notes = busy ? ['報價單 週五前', '回覆客戶信', '下午三點開會', '交週報', '繳電話費', '訂會議室'].map((t, i) => `<div class="sticky s${i}">${t}</div>`).join('') : '';
  const html = `<div id="adbg">${opt.icons === false ? '' : `<div class="icons">${icon('folder', '工作資料')}${icon('doc', '週報草稿')}${icon('pic', '照片')}${icon('folder', '專案')}</div>`}
    ${opt.windows === false ? '' : win('w1', '筆記', `<div class="doc">${lines(9)}</div>`) + win('w2', '行事曆', `<div class="cal">${Array.from({ length: 28 }, (_, i) => `<span${i === 17 ? ' class="on"' : ''}>${i + 1}</span>`).join('')}</div>`)}
    ${notes}${opt.dim ? `<div class="dim" style="opacity:${opt.dim}"></div>` : ''}</div>`;
  const css = `#adbg{position:fixed;inset:0;z-index:-1;overflow:hidden;font-family:'WenQuanYi Zen Hei',sans-serif;color:#4a4033;
    background:radial-gradient(62vw 65vh at 20% 15%,#fff6e2 0%,rgba(255,246,226,0) 70%),radial-gradient(52vw 74vh at 85% 90%,#d7efd9 0%,rgba(215,239,217,0) 70%),linear-gradient(135deg,#fbefd9 0%,#eef6e4 55%,#dcefe3 100%)}
    #adbg .icons{position:absolute;left:1.9vw;top:3.3vh;display:flex;flex-direction:column;gap:3.2vh}
    #adbg .ic{width:5.2vw;text-align:center;font-size:max(9px,.9vw)}#adbg .ic svg{display:block;width:3.6vw;height:3.6vw;margin:0 auto .4vh;filter:drop-shadow(0 2px 3px rgba(80,60,30,.15))}
    #adbg .win{position:absolute;background:#fffdf8;border-radius:1vw;box-shadow:0 1vh 4vh rgba(90,70,40,.14),0 2px 6px rgba(90,70,40,.08);overflow:hidden}
    #adbg .w1{left:13.5vw;top:6.5vh;width:42.7vw;height:48vh}#adbg .w2{left:61.5vw;top:11vh;width:29.2vw;height:35vh}
    #adbg .wt{height:4vh;background:#f3ece0;display:flex;align-items:center;gap:.45vw;padding:0 .9vw;font-size:max(9px,.9vw);color:#7a6c58}
    #adbg .wt i{width:.7vw;height:.7vw;border-radius:50%;background:#d9cdb9}#adbg .wt b{margin-left:.6vw;font-weight:normal}
    #adbg .doc{padding:2.8vh 1.9vw}#adbg .doc p{height:1.3vh;border-radius:1vh;background:#ece4d6;margin:0 0 2vh}
    #adbg .cal{display:grid;grid-template-columns:repeat(7,1fr);gap:.9vh;padding:2.2vh 1.2vw}#adbg .cal span{height:4.6vh;border-radius:.6vw;background:#f6f0e5;font-size:max(8px,.8vw);padding:.4vh .4vw;color:#8a7c66}#adbg .cal span.on{background:#e3f2dd;color:#3d7a3a}
    #adbg .sticky{position:absolute;width:11vw;padding:1.6vh .8vw;font-size:1.25vw;background:#fff3a8;box-shadow:0 .6vh 1.6vh rgba(90,70,40,.18);color:#5a4a20}
    #adbg .s0{left:22vw;top:44vh;transform:rotate(-6deg)}#adbg .s1{left:35vw;top:52vh;transform:rotate(4deg);background:#ffd9e0}#adbg .s2{left:48vw;top:41vh;transform:rotate(-3deg);background:#d9f0ff}
    #adbg .s3{left:60vw;top:50vh;transform:rotate(7deg)}#adbg .s4{left:71vw;top:41vh;transform:rotate(-5deg);background:#e2f7d9}#adbg .s5{left:30vw;top:62vh;transform:rotate(-8deg);background:#ffe4c4}
    #adbg .dim{position:absolute;inset:0;background:#fff8ea}`;
  return `(function(){let s=document.getElementById('adbgcss');if(!s){s=document.createElement('style');s.id='adbgcss';document.head.appendChild(s);}s.textContent=${JSON.stringify(css)};
    const o=document.getElementById('adbg');if(o)o.remove();document.body.insertAdjacentHTML('afterbegin',${JSON.stringify(html)});document.documentElement.style.background='#fbefd9';})()`;
}
module.exports = { inject };
