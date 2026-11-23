/* laolao-metre-stagefx —— Metre 的整页时刻（11-24，「总谱」语言；只在 Metre 出现，其他模式不加载任何东西）。
 * 四个时刻，都由已有脚本在那一刻直接调用（不加观察器、不加定时器循环；动画期间才有 rAF，完了就停）：
 *   turn(rect)    换会话 = 翻谱（laolao-metre-home.js 的 onSwitch）。≤ 600ms：
 *                 0–100   旧会话这一页铺上 Metre 的谱纸（日间纸色 / 夜间夜色，顶上一束暖的舞台光），右边画出终止线收尾；
 *                 100–400 这一页以左边为书脊翻走（越翻越窄、越暗，翻页的边上有一道高光、新页上落一道影子），露出新会话；
 *                 400–580 钴蓝指挥棒在新页左边从上往下画出第一条小节线，然后谱线淡掉。五线谱的横线前后两页一直连着。
 *   lights()      首页开演前亮灯（home.js 的 enter，首页时）：像素舞台不改；天幕从中间往两边亮 → 地板上的灯按三十二分音符
 *                 一盏盏亮（每盏一圈三档的光）→ 指挥台最后亮（位置读 laolao-metre-backdrop.js buildScene 的锚点），之后整台全开。
 *   melody(line)  引导语：每个词先停在高低不同的位置（像音高，6px 一级），再按拍子依次落回、轻弹一下；动的是叠在上面的拷贝，原文排版不变。
 *   lowStaff(canvas, on)  首页画带矮于 180px 时（最矮 144px）：画带只留一行五线谱，舞台装饰全收掉（backdrop.js 的 layout 调）。
 * 减少动态效果（data-pinkie-reduce-motion 或系统设置）时前三个都不做；lowStaff 是静的，照常。 */
(() => {
  'use strict';
  if (window.PinkieMetreStage) return;
  const root = document.documentElement;
  const reduced = () => root.hasAttribute('data-pinkie-reduce-motion') || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const dark = () => root.getAttribute('data-theme') === 'dark' || root.hasAttribute('data-pinkie-night');
  const metre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const frame = () => new Promise((r) => (document.hidden ? setTimeout(r, 32) : requestAnimationFrame(r)));
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const rnd = (i, s = 1) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
  const Q = 60000 / 72, E8 = Q / 2, S32 = Q / 8;   // ♩=72：一拍 833ms、八分 417ms、三十二分 104ms
  const palette = () => (dark()
    ? {paper: '#1E1D1A', back: '#2A2824', line: '#6A675F', on: '#ECEAE4', accent: '#93A5EE', light: 'rgba(233,199,122,.16)', shade: 'rgba(0,0,0,.5)', edge: 'rgba(236,234,228,.22)'}
    : {paper: '#EFEBE2', back: '#DCD5C6', line: '#8E8A81', on: '#1B1A18', accent: '#2F4BB0', light: 'rgba(214,170,80,.24)', shade: 'rgba(40,34,24,.2)', edge: 'rgba(255,255,255,.95)'});

  // ================= 换会话：翻谱 =================
  let turning = false;
  async function turn(r) {
    if (!metre() || reduced() || turning || !r || r.width < 80 || r.height < 80 || document.querySelector('.pk-metre-transition')) return;
    turning = true;
    const cv = document.createElement('canvas');
    try {
      const C = palette(), w = Math.round(r.width), h = Math.round(r.height), dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.className = 'pk-metre-turn'; cv.setAttribute('aria-hidden', 'true');
      Object.assign(cv.style, {position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: w + 'px', height: h + 'px', zIndex: '45', pointerEvents: 'none'});
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      const g = cv.getContext('2d'); if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      document.body.append(cv);
      // 整页谱面：每 112px 一行五线谱（8px 线距），第一行在 40px；横线在旧页、翻页、新页上是同一组 y
      const GAP = 8, rows = []; for (let y = 40; y + 4 * GAP < h - 16; y += 112) rows.push(y);
      const staves = (x0, x1, color, a = 1) => { g.globalAlpha = a; g.fillStyle = color; for (const y of rows) for (let k = 0; k < 5; k++) g.fillRect(x0, y + k * GAP, x1 - x0, 1); g.globalAlpha = 1; };
      const light = (x0, x1) => { const lg = g.createRadialGradient(w / 2, -h * 0.15, 0, w / 2, -h * 0.15, h * 1.1); lg.addColorStop(0, C.light); lg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = lg; g.fillRect(x0, 0, x1 - x0, h); };
      const END = w - 28, FIRST = 24, t0 = performance.now();
      let t;
      while ((t = performance.now() - t0) < 580) {
        g.clearRect(0, 0, w, h);
        // 翻页的边：100ms 以后从右往左走到书脊（左边），整页翻走
        const u = clamp((t - 100) / 300), e = w * (1 - easeInOut(u));
        if (u < 1) {
          // 正面：纸色 + 舞台光 + 谱线 + 终止线；横向按翻过的角度压窄（谱线的 y 不变，所以和新页连着）
          const fade = clamp(t / 100);
          g.globalAlpha = fade; g.fillStyle = C.paper; g.fillRect(0, 0, e, h); g.globalAlpha = 1;
          if (fade >= 1) {
            light(0, e); staves(0, e, C.line);
            const grow = clamp(t / 90), bx = END * (e / w);
            g.fillStyle = C.line; for (const y of rows) { const hh = (4 * GAP + 1) * grow; g.fillRect(bx - 6, y, 1, hh); g.fillRect(bx - 2, y, 3, hh); for (const f of [0.25, 0.5, 0.75]) g.fillRect(Math.round(e * f), y, 1, 4 * GAP + 1); }   // 终止线 + 三条小节线
            // 越翻越暗，像翻起来的纸背对舞台光；边上一道高光，新页上落一道影子
            if (u > 0) {
              g.globalAlpha = 0.55 * Math.sin(u * Math.PI / 2); g.fillStyle = C.back; g.fillRect(0, 0, e, h); g.globalAlpha = 1;
              g.fillStyle = C.edge; g.fillRect(Math.max(0, e - 2), 0, 2, h);
              const sw = 28 * Math.sin(u * Math.PI), sg = g.createLinearGradient(e, 0, e + sw, 0);
              sg.addColorStop(0, C.shade); sg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = sg; g.fillRect(e, 0, sw, h);
            }
          }
        }
        // 新页上的谱线（透明底，叠在新会话上，淡）：和旧页的横线接着；400ms 起指挥棒画第一条小节线，480ms 起谱线淡掉
        const out = 1 - clamp((t - 480) / 100);
        if (t >= 100) staves(Math.max(0, e), w, C.line, 0.45 * out);
        if (t >= 400) {
          const p = easeOut(clamp((t - 400) / 110)), top = rows[0], bottom = rows[rows.length - 1] + 4 * GAP + 1, y = top + (bottom - top) * p;
          g.globalAlpha = out; g.fillStyle = p < 1 ? C.accent : C.line;
          for (const ry of rows) { const y1 = Math.min(y, ry + 4 * GAP + 1); if (y1 > ry) g.fillRect(FIRST, ry, 2, y1 - ry); }
          if (p < 1) { g.fillStyle = C.accent; g.fillRect(FIRST - 2, y - 3, 6, 6); }
          g.globalAlpha = 1;
        }
        await frame();
      }
    } finally { cv.remove(); turning = false; }
  }

  // ================= 首页画带：开演前亮灯 =================
  let lighting = false;
  async function lights() {
    const src = document.querySelector('canvas.pk-metre-backdrop');
    if (lighting || !metre() || reduced() || !src || !src.width || root.hasAttribute('data-metre-band-low')) return;
    lighting = true;
    const dpr = window.devicePixelRatio || 1, cellDev = Math.max(2, Math.round(2 * dpr)), cellCss = cellDev / dpr;
    const cols = Math.round(src.width / cellDev), rows = Math.round(src.height / cellDev);
    const cv = document.createElement('canvas');
    cv.className = 'pk-metre-lights'; cv.setAttribute('aria-hidden', 'true'); cv.width = cols; cv.height = rows;
    Object.assign(cv.style, {position: 'fixed', left: src.style.left, top: src.style.top, bottom: src.style.bottom, width: src.style.width, height: src.style.height, zIndex: '-1', pointerEvents: 'none', imageRendering: 'pixelated'});
    src.after(cv);
    const g = cv.getContext('2d', {willReadFrequently: true});
    const low = document.createElement('canvas'); low.width = cols; low.height = rows;
    const lg = low.getContext('2d', {willReadFrequently: true}); lg.imageSmoothingEnabled = false;
    const [br, bgc, bb] = (getComputedStyle(root).backgroundColor.match(/[\d.]+/g) || [247, 246, 243]).map(Number);
    const bandCss = parseFloat(getComputedStyle(root).getPropertyValue('--metre-band')) || rows * cellCss * 0.4;
    const bandRows = Math.round(bandCss / cellCss), y0 = rows - bandRows, floorY = y0 + Math.round(bandRows * 0.4);
    const cx = cols / 2, OFF = 0.12, PODIUM = Q * 1.5;
    // 指挥台在哪：backdrop 画场景时记下的锚点（buildScene 的 anchors.podX，格坐标）；没有就当在正中
    const podX = Number.isFinite(parseFloat(src.dataset.podX)) ? parseFloat(src.dataset.podX) : cx;
    const floorH = rows - floorY, fy = floorY + floorH * 0.55;
    const lamps = Array.from({length: 8}, (_, k) => ({x: ((k + 0.5) / 8) * cols, y: fy, rx: (cols / 8) * 0.9, ry: floorH * 0.9, at: E8 + k * S32}))
      .filter((l) => Math.abs(l.x - podX) > cols * 0.08);
    lamps.push({x: podX, y: fy, rx: cols * 0.1, ry: floorH * 1.05, at: PODIUM});
    const N = cols * rows, zone = new Uint8Array(N), wallAt = new Float32Array(N), near = new Uint8Array(N), dist = new Float32Array(N);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const p = y * cols + x;
      if (y < floorY) { wallAt[p] = (Math.abs(x - cx) / cx) * 260; continue; }
      zone[p] = 1;
      let best = 9, bi = 0;
      lamps.forEach((l, i) => { const d = Math.hypot((x - l.x) / l.rx, (y - l.y) / l.ry); if (d < best) { best = d; bi = i; } });
      near[p] = bi; dist[p] = best;
    }
    const soft = (d) => (d < 0 ? OFF : d < 70 ? 0.4 : d < 140 ? 0.75 : 1);
    const pop = (d) => (d < 0 ? 0 : d < 50 ? 0.6 : d < 130 ? 1.25 : 1);            // 灯一亮先冲一下再稳住
    const pool = (d) => (d < 0.45 ? 1 : d < 0.75 ? 0.62 : d < 1 ? 0.34 : 0);        // 一圈光的三档
    const mix = (c, b, f) => Math.max(0, Math.min(255, b + (c - b) * f));
    src.style.opacity = '0';
    const t0 = performance.now(), END = PODIUM + 380;
    try {
      let t;
      while ((t = performance.now() - t0) < END && metre()) {
        lg.clearRect(0, 0, cols, rows);
        lg.drawImage(src, 0, 0, cols * cellDev, rows * cellDev, 0, 0, cols, rows);
        const img = lg.getImageData(0, 0, cols, rows), d = img.data;
        for (let p = 0, i = 0; p < N; p++, i += 4) {
          if (!d[i + 3]) continue;
          let f;
          if (!zone[p]) f = soft(t - wallAt[p]);
          else {
            const all = clamp((t - PODIUM - 60) / 240), l = lamps[near[p]];                  // 指挥台亮了以后，整台灯全开
            f = Math.max(OFF + (1 - OFF) * all, OFF + (1 - OFF) * pool(dist[p]) * pop(t - l.at));
          }
          if (f === 1) continue;
          d[i] = mix(d[i], br, f); d[i + 1] = mix(d[i + 1], bgc, f); d[i + 2] = mix(d[i + 2], bb, f);
        }
        g.putImageData(img, 0, 0);
        await frame();
      }
    } finally { src.style.opacity = ''; cv.remove(); lighting = false; }
  }

  // ================= 引导语：先停在不同音高，再按拍子落回原位 =================
  const PUNCT = /[，。、！？；：,.!?…—]/;
  function melody(line) {
    if (!line || reduced() || !metre()) return;
    const chars = [...line.querySelectorAll('.pk-metre-ch')];
    if (!chars.length) return;
    const words = []; let cur = [], curKw = null;
    const flush = () => { if (cur.length) words.push(cur); cur = []; curKw = null; };
    chars.forEach((ch) => {
      const kw = ch.parentElement?.classList.contains('pk-metre-kw') ? ch.parentElement : null;
      if (kw) { if (curKw !== kw) { flush(); curKw = kw; } cur.push(ch); return; }
      if (curKw) flush();
      cur.push(ch);
      if (PUNCT.test(ch.textContent) || cur.length >= 2 + (words.length % 2)) flush();
    });
    flush();
    document.querySelectorAll('.pk-metre-fly').forEach((n) => n.remove());
    clearTimeout(line._pkSung);
    const layer = document.createElement('div');
    layer.className = 'pk-metre-fly'; layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
    line.classList.add('is-sung'); line.style.visibility = 'hidden';
    const STEP = 6, step = Math.min(S32, 900 / Math.max(1, words.length)), fallStart = words.length * 30 + 280;
    let total = 0;
    words.forEach((w, i) => {
      const y = -(Math.round(rnd(i, 13) * 4) + 1) * STEP, appear = i * 30, fall = fallStart + i * step, land = fall + 190, settle = land + 90;
      total = Math.max(total, settle);
      const Y = `translateY(${y}px)`;
      w.forEach((ch) => {
        const r = ch.getBoundingClientRect(), cs = getComputedStyle(ch);
        if (!r.width) return;
        const c = document.createElement('span');
        c.textContent = ch.textContent;
        Object.assign(c.style, {position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', lineHeight: r.height + 'px',
          font: cs.font, color: cs.color, letterSpacing: cs.letterSpacing, whiteSpace: 'pre'});
        layer.append(c);
        c.animate([
          {offset: 0, opacity: 0, transform: Y},
          {offset: appear / settle, opacity: 0, transform: Y},
          {offset: (appear + 80) / settle, opacity: 1, transform: Y},
          {offset: fall / settle, opacity: 1, transform: Y, easing: 'cubic-bezier(.55,0,1,.45)'},
          {offset: land / settle, opacity: 1, transform: 'translateY(2px)', easing: 'ease-out'},
          {offset: 1, opacity: 1, transform: 'none'},
        ], {duration: settle, fill: 'both'});
      });
    });
    line.style.setProperty('--metre-reveal', Math.round(total) + 'ms');   // 关键词下面那排点（音符）在整句落定后亮
    line._pkSung = setTimeout(() => { line.style.visibility = ''; layer.remove(); }, total + 30);
  }

  // ================= 矮画带：只留一行五线谱 =================
  function lowStaff(canvas, on) {
    let staff = canvas?.parentElement?.querySelector(':scope > .pk-metre-lowstaff');
    if (!on || !canvas) { staff?.remove(); return; }
    if (!staff) { staff = Object.assign(document.createElement('div'), {className: 'pk-metre-lowstaff'}); staff.setAttribute('aria-hidden', 'true'); canvas.after(staff); }
    Object.assign(staff.style, {left: canvas.style.left, width: canvas.style.width});
  }

  window.PinkieMetreStage = Object.freeze({turn, lights, melody, lowStaff});
})();
