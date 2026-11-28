// 明信片上的四格小漫畫：用庫卡本身的畫法（QuokkaArt／QuokkaPose）畫寄件的那隻；每張的場景不一樣（lib/postcard.js 的 scene）
//   第 1 格 落腳處（和信裡寫的一致）：island 海邊小島｜forest 森林（禿鷹分果子）｜rocks 曬太陽的石頭島｜creek 小溪星空
//   第 2 格 在做什麼（看個性）：eat 吃葉子｜ball 和新朋友打排球｜nap 樹下睡午覺｜explore 追蝴蝶｜sun 曬太陽
//   第 3 格 想念愛人：sunset 夕陽背影＋想像泡泡｜stars 星空裡有牠的臉｜moon 月光下抱著葉子
//   第 4 格 寄信：write 捧著明信片｜mail 請禿鷹當郵差｜bottle 瓶中信
// PostcardComic.html({ from:{name, traits}, lover:{name, traits}|null, friends:[{name, traits}], scene }) → HTML 字串
(function () {
  const TR = window.QuokkaTraits, ART = window.QuokkaArt, POSE = window.QuokkaPose;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PLACE = ['island', 'forest', 'rocks', 'creek'];
  let seq = 0;
  // 畫一隻：th 轉向、pose 姿勢；(x, y)＝腳底、s 縮放。回傳 svg 和手的位置（換算到格子座標）
  function quokka(traits, th, pose, x, y, s) {
    const id = 'pcq' + (++seq);
    try {
      ART.configure(traits || null);
      const r = POSE.render(th, id, pose || {});
      const L = r.layers, tx = (p) => ({ x: x - 80 * s + p.X * s, y: y - 183 * s + p.Y * s });
      return { svg: `<g transform="translate(${x - 80 * s} ${y - 183 * s}) scale(${s})">${L.defs}${L.shadow}${L.back}${L.body}${L.front}</g>`, hands: r.hands, tx };
    } catch (e) { return { svg: '', hands: null, tx: (p) => p }; } finally { ART.configure(null); }
  }
  // 只有臉（想像泡泡、星空用）
  function face(traits, x, y, s, extra = '') {
    const id = 'pch' + (++seq);
    try {
      ART.configure(traits || null);
      const L = POSE.render(-10, id, { eyes: 'happy', mouth: 'smile', accessory: 'none' }).layers;
      return `<svg x="${x - 30 * s}" y="${y - 30 * s}" width="${60 * s}" height="${60 * s}" viewBox="25 5 110 110" overflow="hidden" ${extra}>${L.defs}${L.back}${L.body}${L.front}</svg>`;
    } catch (e) { return ''; } finally { ART.configure(null); }
  }
  const W = 200, H = 150;
  const cell = (inner, cap) => `<figure class="pc-cell"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cap)}">${inner}</svg><figcaption>${esc(cap)}</figcaption></figure>`;
  const names = (list) => (list.length <= 1 ? list.join('') : list.slice(0, -1).join('、') + '和' + list[list.length - 1]);
  const grad = (id, a, b, c) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/>${c ? `<stop offset=".6" stop-color="${b}"/><stop offset="1" stop-color="${c}"/>` : `<stop offset="1" stop-color="${b}"/>`}</linearGradient></defs>`;
  // 小禿鷹（遠景，和舞台上那隻同配色）；beak＝嘴裡叼著東西
  const tinyVulture = (x, y, s, flip = 1, beak = '') => `<g transform="translate(${x} ${y}) scale(${s * flip} ${s})"><path d="M-18 0 C -10 -12 0 -10 4 -2 C 10 -14 26 -16 34 -12 C 26 -6 18 -2 10 2 C 4 6 -10 6 -18 0 Z" fill="#3b2a20"/><circle cx="-18" cy="-2" r="3.4" fill="#d48f7e"/><path d="M-21 -1 l -4 2 l 4 0 Z" fill="#d9b45e"/>${beak}</g>`;
  const leaf = (x, y, r, c, s = 1) => `<path transform="translate(${x} ${y}) rotate(${r}) scale(${s})" d="M0 -6 C 4 -3 4 2 0 6 C -4 2 -4 -3 0 -6 Z" fill="${c}"/>`;
  const stars = (rnd, n, h) => Array.from({ length: n }, () => `<circle cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * h).toFixed(0)}" r="${(0.6 + rnd()).toFixed(1)}" fill="#fff" opacity="${(0.5 + rnd() * .5).toFixed(2)}"/>`).join('');
  const palm = (x, y) => `<path d="M${x} ${y} C ${x} ${y - 20} ${x + 2} ${y - 34} ${x + 8} ${y - 44}" stroke="#8a6a44" stroke-width="3" fill="none"/><path d="M${x + 8} ${y - 44} c -14 -4 -22 2 -26 8 M${x + 8} ${y - 44} c 12 -6 22 -2 26 4 M${x + 8} ${y - 44} c -2 -12 6 -18 12 -18" stroke="#5f9a3c" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  const tree = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-3" y="-26" width="6" height="26" fill="#8a6a44"/><circle cx="0" cy="-36" r="18" fill="#5f9a3c"/><circle cx="-12" cy="-28" r="11" fill="#6fae4a"/><circle cx="12" cy="-28" r="11" fill="#6fae4a"/></g>`;
  const rng = (seed) => { let s = (seed >>> 0) || 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };

  function html({ from, lover, friends = [], scene = {} }) {
    const t = from.traits, fr = friends.filter((f) => f && f.name), rnd = rng((scene.seed || 1) + 13);
    const pal = (k) => `pcg${++seq}${k}`;
    // 島上的新朋友：每張明信片不同的兩隻
    const mates = [TR.generate(1000 + (scene.seed || 0) % 9000), TR.generate(2000 + (scene.seed || 0) % 9000)];
    mates.forEach((o) => { TR.ensurePersonality(o); TR.ensureAccessory(o); });
    const who = lover && lover.name ? lover : fr[0] || null;
    const cells = [];

    // ---- 第 1 格：落腳處 ----
    const place = PLACE[scene.place] || 'island';
    if (place === 'island') {
      const g = pal('a');
      cells.push(cell(`${grad(g, '#bfe3f5', '#eaf6fb')}<rect width="${W}" height="${H}" fill="url(#${g})"/><rect y="104" width="${W}" height="46" fill="#7cc2d9"/>
        <ellipse cx="128" cy="112" rx="58" ry="12" fill="#e9d49a"/><ellipse cx="128" cy="106" rx="44" ry="9" fill="#9ccf6a"/>${palm(150, 104)}
        ${tinyVulture(52, 34, 1.1)}<path d="M56 46 q 20 20 50 44" stroke="#fff" stroke-width="1.6" stroke-dasharray="3 4" fill="none" opacity=".8"/>
        ${quokka(t, -20, { eyes: 'wide', mouth: 'o' }, 120, 110, .3).svg}`, '飛到小島了！'));
    } else if (place === 'forest') {
      const g = pal('b');
      cells.push(cell(`${grad(g, '#d6efd0', '#bfe0b0')}<rect width="${W}" height="${H}" fill="url(#${g})"/><rect y="112" width="${W}" height="38" fill="#8fc46a"/>
        ${tree(24, 118, 1.2)}${tree(176, 116, 1.1)}${tree(66, 112, .8)}
        <g transform="translate(150 112)">${tinyVulture(0, -10, 1.2, -1)}</g><circle cx="128" cy="96" r="5" fill="#e0553f"/><path d="M128 91 l 2 -4" stroke="#5f9a3c" stroke-width="2"/>
        ${quokka(t, 25, { eyes: 'happy', mouth: 'open', blush: 1.2 }, 96, 128, .32).svg}`, '降落在森林，禿鷹分我果子'));
    } else if (place === 'rocks') {
      const g = pal('c');
      cells.push(cell(`${grad(g, '#cfe9f7', '#f1f8fb')}<rect width="${W}" height="${H}" fill="url(#${g})"/><rect y="100" width="${W}" height="50" fill="#79b9d4"/>
        <ellipse cx="40" cy="112" rx="34" ry="14" fill="#a9a39a"/><ellipse cx="160" cy="116" rx="38" ry="15" fill="#b5ada1"/><circle cx="170" cy="22" r="12" fill="#ffd66b"/>
        ${quokka(mates[0], 20, { eyes: 'closed', mouth: 'smile' }, 34, 108, .2).svg}${quokka(mates[1], -20, { eyes: 'closed', mouth: 'smile' }, 168, 110, .2).svg}
        ${quokka(t, 0, { eyes: 'wide', mouth: 'smile' }, 100, 132, .3).svg}`, '這座島大家都在曬太陽'));
    } else {
      const g = pal('d');
      cells.push(cell(`${grad(g, '#3c4a78', '#6c6aa0', '#a98fb3')}<rect width="${W}" height="${H}" fill="url(#${g})"/>${stars(rnd, 22, 80)}
        <path d="M0 120 C 50 110 120 132 200 118 L 200 150 L 0 150 Z" fill="#6d8f5a"/><path d="M0 128 C 60 120 110 140 200 126" stroke="#9fd0e6" stroke-width="7" fill="none" opacity=".85"/>
        ${quokka(t, -15, { eyes: 'wide', mouth: 'o', look: [0, -1] }, 98, 124, .3).svg}`, '小溪邊的新家，星星好亮'));
    }

    // ---- 第 2 格：在做什麼 ----
    const play = scene.play || 'eat';
    const meadow = (g) => `${grad(g, '#e6f4da', '#d4ecc3')}<rect width="${W}" height="${H}" fill="url(#${g})"/><rect y="104" width="${W}" height="46" fill="#a7d47e"/>
      ${[[20, 124, 30], [60, 136, -20], [150, 128, 60], [182, 140, 10]].map(([x, y, r], i) => leaf(x, y, r, i % 2 ? '#6fae4a' : '#e0b84a')).join('')}`;
    if (play === 'ball') {
      const me = quokka(t, 35, { eyes: 'focus', mouth: 'open', arms: { L: { hand: [-12, 58, 24] }, R: { hand: [12, 58, 24] } } }, 66, 134, .32);
      const mate = quokka(mates[0], -35, { eyes: 'happy', mouth: 'open' }, 150, 132, .3);
      cells.push(cell(`${meadow(pal('e'))}${mate.svg}${me.svg}<circle cx="104" cy="34" r="9" fill="#f7f2e4" stroke="#3e7ad1" stroke-width="2"/><path d="M96 30 q 8 6 16 0 M104 25 v 18" stroke="#e5533d" stroke-width="1.6" fill="none"/>
        <path d="M78 56 q 10 -18 22 -20" stroke="#fff" stroke-dasharray="2 3" fill="none"/>`, '和新朋友打排球'));
    } else if (play === 'nap') {
      cells.push(cell(`${meadow(pal('f'))}${tree(138, 110, 1.5)}${quokka(t, -10, { eyes: 'closed', mouth: 'flat', head: { roll: 12, pitch: 8 } }, 104, 134, .34).svg}
        <text x="126" y="58" font-size="14" fill="#5a6b8a" font-weight="700">Z</text><text x="138" y="44" font-size="11" fill="#5a6b8a" font-weight="700">z</text>`, '樹下睡午覺'));
    } else if (play === 'explore') {
      const fly = (x, y, c) => `<g transform="translate(${x} ${y})"><ellipse cx="-5" cy="0" rx="6" ry="8" fill="${c}"/><ellipse cx="5" cy="0" rx="6" ry="8" fill="${c}"/><rect x="-1" y="-6" width="2" height="12" fill="#3e3127"/></g>`;
      cells.push(cell(`${meadow(pal('g'))}<circle cx="40" cy="102" r="5" fill="#f29ab5"/><circle cx="160" cy="98" r="5" fill="#f2c94e"/>${fly(140, 40, '#f2a65a')}${fly(168, 60, '#8fb8ef')}
        ${quokka(t, 30, { eyes: 'wide', mouth: 'open', look: [1, -1], head: { pitch: -10 }, arms: { R: { hand: [26, 60, 24] } } }, 90, 134, .34).svg}`, '追蝴蝶'));
    } else if (play === 'sun') {
      cells.push(cell(`${meadow(pal('h'))}<circle cx="168" cy="26" r="14" fill="#ffd66b"/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M168 26 m ${(Math.cos(a * Math.PI / 180) * 18).toFixed(1)} ${(Math.sin(a * Math.PI / 180) * 18).toFixed(1)} l ${(Math.cos(a * Math.PI / 180) * 6).toFixed(1)} ${(Math.sin(a * Math.PI / 180) * 6).toFixed(1)}" stroke="#ffd66b" stroke-width="2"/>`).join('')}
        <ellipse cx="96" cy="132" rx="46" ry="8" fill="#b7a98f"/>${quokka(t, -10, { eyes: 'closed', mouth: 'smile', blush: 1.4, head: { pitch: -14 } }, 96, 132, .34).svg}`, '曬太陽好舒服'));
    } else {
      cells.push(cell(`${meadow(pal('i'))}${quokka(mates[0], 30, { eyes: 'happy', mouth: 'smile' }, 32, 116, .2).svg}${quokka(mates[1], -30, { eyes: 'happy', mouth: 'open' }, 170, 116, .2).svg}
        ${quokka(t, -10, { eyes: 'happy', mouth: 'chew', blush: 1.3, props: [{ t: 'leaf', kind: 'big', hand: 'both', off: [2, -6], rot: 70, s: 1.7 }] }, 100, 136, .4).svg}`, '葉子吃到飽'));
    }

    // ---- 第 3 格：想念愛人 ----
    const mood = scene.mood || 'sunset';
    const miss = who ? `好想念${who.name}` : '好想念大家';
    if (mood === 'stars') {
      const g = pal('j');
      cells.push(cell(`${grad(g, '#1e2a52', '#36457a')}<rect width="${W}" height="${H}" fill="url(#${g})"/>${stars(rnd, 34, 110)}
        ${who ? face(who.traits, 140, 44, .9, 'opacity=".55"') : ''}<rect y="122" width="${W}" height="28" fill="#2f4a3a"/>
        ${quokka(t, 180, { head: { pitch: -14 } }, 70, 146, .3).svg}`, who ? `星星裡有${who.name}` : '星星好像大家'));
    } else if (mood === 'moon') {
      const g = pal('k');
      cells.push(cell(`${grad(g, '#2c3a66', '#4a5a8c')}<rect width="${W}" height="${H}" fill="url(#${g})"/>${stars(rnd, 16, 70)}<circle cx="40" cy="30" r="14" fill="#f7efcf"/><circle cx="46" cy="26" r="12" fill="#2f3d6a"/>
        <rect y="118" width="${W}" height="32" fill="#3d5a44"/>${quokka(t, -10, { eyes: 'sad', mouth: 'flat', props: [{ t: 'leaf', kind: 'big', hand: 'both', off: [2, -6], rot: 70, s: 1.4 }] }, 84, 142, .34).svg}
        <ellipse cx="156" cy="46" rx="32" ry="26" fill="#fff" opacity=".92"/><circle cx="122" cy="74" r="3.6" fill="#fff"/>${who ? face(who.traits, 150, 48, .6) : ''}<text x="174" y="40" font-size="12" fill="#e2588f">♥</text>`, miss));
    } else {
      const g = pal('l');
      cells.push(cell(`${grad(g, '#f7b26a', '#f6d39a', '#f3e3c0')}<rect width="${W}" height="${H}" fill="url(#${g})"/><circle cx="120" cy="96" r="20" fill="#f58a4b" opacity=".9"/><rect y="100" width="${W}" height="50" fill="#6a9fc0"/>
        <path d="M100 108 h 40 M106 116 h 28" stroke="#f6b37a" stroke-width="2" opacity=".8"/><rect y="128" width="${W}" height="22" fill="#d9c08a"/>
        ${quokka(t, 180, { head: { pitch: -6 } }, 70, 146, .3).svg}
        <ellipse cx="148" cy="38" rx="34" ry="28" fill="#fff" opacity=".95"/><circle cx="112" cy="70" r="4" fill="#fff"/><circle cx="102" cy="80" r="2.6" fill="#fff"/>
        ${who ? face(who.traits, 140, 40, .62) : ''}<text x="168" y="34" font-size="13" fill="#e2588f">♥</text>`, miss));
    }

    // ---- 第 4 格：寄信 ----
    const to = [lover && lover.name, ...fr.map((f) => f.name)].filter(Boolean);
    const toText = to.length ? names(to) : '大家';
    const card = (x, y, r = -6, s = 1) => `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${r}) scale(${s})"><rect x="-20" y="-13" width="40" height="27" rx="2" fill="#fffaf0" stroke="#d7b98b"/><path d="M-15 -6 h 18 M-15 -1 h 22 M-15 4 h 14" stroke="#b9a283" stroke-width="1.4"/><rect x="9" y="-10" width="8" height="9" fill="#f3c3cf"/></g>`;
    const send = scene.send || 'write';
    if (send === 'mail') {
      const g = pal('m');
      cells.push(cell(`${grad(g, '#c6e6f6', '#eef8fc')}<rect width="${W}" height="${H}" fill="url(#${g})"/><rect y="112" width="${W}" height="38" fill="#9ccf6a"/>
        ${tinyVulture(148, 40, 1.4, -1, `<rect x="-30" y="-4" width="12" height="8" fill="#fffaf0" stroke="#d7b98b" stroke-width=".8"/>`)}
        ${quokka(t, 20, { eyes: 'happy', mouth: 'open', arms: { R: { hand: [40, 44, 8] } } }, 78, 136, .34).svg}`, `請禿鷹當郵差，寄給${toText}`));
    } else if (send === 'bottle') {
      const g = pal('n');
      cells.push(cell(`${grad(g, '#bfe3f5', '#eaf6fb')}<rect width="${W}" height="${H}" fill="url(#${g})"/><rect y="96" width="${W}" height="54" fill="#7cc2d9"/><path d="M0 100 q 25 -4 50 0 t 50 0 t 50 0 t 50 0" stroke="#bfe6f0" stroke-width="2" fill="none"/>
        <path d="M0 150 L 0 122 C 40 116 70 124 96 136 L 96 150 Z" fill="#e9d49a"/>
        <g transform="translate(150 106) rotate(-20)"><rect x="-12" y="-5" width="24" height="10" rx="4" fill="#bfe8d8" opacity=".85" stroke="#7fb8a8"/><rect x="12" y="-3" width="5" height="6" fill="#a67c52"/><rect x="-7" y="-3" width="12" height="5" fill="#fffaf0"/></g>
        ${quokka(t, 40, { eyes: 'happy', mouth: 'smile', arms: { R: { hand: [34, 70, 30] } } }, 54, 140, .32).svg}`, `瓶中信漂給${toText}`));
    } else {
      const p = quokka(t, -15, { eyes: 'happy', mouth: 'smile', blush: 1.2, arms: { L: { hand: [-14, 112, 30] }, R: { hand: [14, 112, 30] } } }, 92, 140, .36);
      let c = '';
      if (p.hands && p.hands.L && p.hands.R) { const a = p.tx(p.hands.L), b = p.tx(p.hands.R); c = card((a.x + b.x) / 2, (a.y + b.y) / 2 - 6); }
      cells.push(cell(`<rect width="${W}" height="${H}" fill="#fbf1dc"/><rect y="112" width="${W}" height="38" fill="#e7cfa2"/>
        <rect x="148" y="22" width="34" height="26" rx="3" fill="#fff" stroke="#d7b98b" stroke-dasharray="3 2"/><text x="165" y="40" font-size="12" text-anchor="middle">📮</text>${p.svg}${c}`, `寫給${toText}`));
    }
    return `<div class="pc-comic">${cells.join('')}</div>`;
  }
  window.PostcardComic = { html };
})();
