/* laolao-metre-stagefx —— Metre 的整页时刻（11-24，「总谱」语言；只在 Metre 出现，其他模式不加载任何东西）。
 * 四个时刻，都由已有脚本在那一刻直接调用（不加观察器、不加定时器循环；动画期间才有 rAF，完了就停）：
 *   turn(rect)    换会话 = 翻谱（laolao-metre-home.js 的 onSwitch）。≤ 600ms：旧会话这一页铺上 Metre 的谱纸，
 *                 以左边的书脊为轴真的翻过去（透视、背光变暗、翻起的边一道高光、新页上一道投影），钴蓝指挥棒在新页画出第一条小节线。
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
  // ================= 换会话：翻谱（11-24 第二版：纸页真的以书脊为轴翻过去） =================
  // ≤ 600ms：0–90 旧会话这一页铺上谱纸（舞台光、谱线、右边终止线）；90–430 这一页以左边的书脊为轴翻起来——越翻越窄，
  // 离书脊越远的那一边越高（透视，朝人翻过来），背光的一面越来越暗，翻起的边上一道高光，书脊处一道折痕的暗，
  // 新页上落一道随角度变宽的投影；380–520 钴蓝指挥棒在新页左边从上往下画出第一条小节线（3px，粗、清楚）；500–580 一起淡掉。
  // 五线谱的横线前后页是同一组 y。夜间的纸是夜间舞台的冷灰蓝，不是泥棕色。
  const turnPalette = () => (dark()
    ? {paper: '#1F2230', back: '#141620', line: '#5A6280', ink: '#C9D2F5', accent: '#93A5EE', spot: 'rgba(147,165,238,.20)', warm: 'rgba(233,199,122,.07)', shade: '0,0,0', edge: 'rgba(214,222,255,.55)', fold: 'rgba(0,0,0,.55)'}
    : {paper: '#F5F2EB', back: '#DCD5C6', line: '#9E998E', ink: '#26408F', accent: '#2F4BB0', spot: 'rgba(255,244,214,.75)', warm: 'rgba(214,170,80,.10)', shade: '60,48,26', edge: 'rgba(255,255,255,.95)', fold: 'rgba(60,48,26,.30)'});
  let turning = false;
  async function turn(r) {
    if (!metre() || reduced() || turning || !r || r.width < 80 || r.height < 80 || document.querySelector('.pk-metre-transition')) return;
    turning = true;
    const cv = document.createElement('canvas');
    try {
      const C = turnPalette(), w = Math.round(r.width), h = Math.round(r.height), dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.className = 'pk-metre-turn'; cv.setAttribute('aria-hidden', 'true');
      Object.assign(cv.style, {position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: w + 'px', height: h + 'px', zIndex: '45', pointerEvents: 'none'});
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      const g = cv.getContext('2d'); if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      document.body.append(cv);
      // 整页谱面：每 112px 一行五线谱（8px 线距），第一行在 40px；横线在旧页、翻页、新页上是同一组 y
      const GAP = 8, rows = []; for (let y = 40; y + 4 * GAP < h - 16; y += 112) rows.push(y);
      const END = w - 28, FIRST = 44;
      // 旧页（正面）先画好在一张离屏画布上：纸色 + 舞台光 + 谱线 + 三条小节线 + 右边的终止线
      const sheet = document.createElement('canvas'); sheet.width = cv.width; sheet.height = cv.height;
      { const s = sheet.getContext('2d'); s.setTransform(dpr, 0, 0, dpr, 0, 0);
        s.fillStyle = C.paper; s.fillRect(0, 0, w, h);
        const spot = s.createRadialGradient(w * 0.55, -h * 0.1, 0, w * 0.55, -h * 0.1, h * 1.15); spot.addColorStop(0, C.spot); spot.addColorStop(1, 'rgba(0,0,0,0)'); s.fillStyle = spot; s.fillRect(0, 0, w, h);
        s.fillStyle = C.warm; s.fillRect(0, 0, w, h);
        s.fillStyle = C.line; for (const y of rows) { for (let k = 0; k < 5; k++) s.fillRect(0, y + k * GAP, w, 1); for (const f of [0.25, 0.5, 0.75]) s.fillRect(Math.round(w * f), y, 1, 4 * GAP + 1); }
        s.fillStyle = C.ink; for (const y of rows) { s.fillRect(END - 6, y, 1, 4 * GAP + 1); s.fillRect(END - 2, y, 3, 4 * GAP + 1); } }
      const staves = (x0, x1, a) => { g.globalAlpha = a; g.fillStyle = C.line; for (const y of rows) for (let k = 0; k < 5; k++) g.fillRect(x0, y + k * GAP, Math.max(0, x1 - x0), 1); g.globalAlpha = 1; };
      const STRIPS = 40, t0 = performance.now();
      let t;
      while ((t = performance.now() - t0) < 580) {
        g.clearRect(0, 0, w, h);
        const out = 1 - clamp((t - 500) / 80);
        const u = clamp((t - 90) / 340), th = u * u * (3 - 2 * u) * Math.PI / 2, c = Math.cos(th), s = Math.sin(th), edgeX = w * c;
        // 新页（就是下面已经换好的新会话）：谱线接着旧页的横线，淡一点
        if (t >= 90) staves(Math.max(0, edgeX), w, 0.65 * out);
        if (t < 90) { g.globalAlpha = clamp(t / 90); g.drawImage(sheet, 0, 0, w, h); g.globalAlpha = 1; }
        else if (u < 1) {
          // 投影：落在新页上，从翻起的边往右，角度越大越宽、越淡
          const sw = 18 + 90 * s, sh = g.createLinearGradient(edgeX, 0, edgeX + sw, 0);
          sh.addColorStop(0, `rgba(${C.shade},${0.42 * Math.sin(th * 2) + 0.12 * s})`); sh.addColorStop(1, `rgba(${C.shade},0)`); g.fillStyle = sh; g.fillRect(edgeX, 0, sw, h);
          // 纸页：切成竖条，每条按它离书脊的远近压窄、拉高（透视），越远越暗
          for (let i = 0; i < STRIPS; i++) {
            const a0 = i / STRIPS, a1 = (i + 1) / STRIPS, x0 = w * a0 * c, x1 = w * a1 * c, grow = 1 + 0.24 * a1 * s, hh = h * grow, y0 = (h - hh) / 2;
            if (x1 - x0 < 0.3) continue;
            g.drawImage(sheet, a0 * cv.width, 0, (a1 - a0) * cv.width, cv.height, x0, y0, x1 - x0 + 0.6, hh);
            g.fillStyle = `rgba(${C.shade},${(0.12 + 0.5 * a1) * s * (C.paper === '#1F2230' ? 1.2 : 1)})`; g.fillRect(x0, y0, x1 - x0 + 0.6, hh);
          }
          // 翻起的那一边：一道高光（纸边受光）；书脊：一道折痕的暗
          const ex = Math.max(0, edgeX - 3), eh = h * (1 + 0.24 * s);
          g.fillStyle = C.edge; g.fillRect(ex, (h - eh) / 2, 3, eh);
          const fold = g.createLinearGradient(0, 0, 22, 0); fold.addColorStop(0, C.fold); fold.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = fold; g.fillRect(0, 0, 22, h);
        }
        // 新页第一条小节线（总谱的系统线：从第一行谱一直连到最后一行）：钴蓝指挥棒从上往下画出来，4px 宽；画完变成墨色、留到最后
        if (t >= 380) {
          const p = easeOut(clamp((t - 380) / 140)), top = rows[0], bottom = rows[rows.length - 1] + 4 * GAP + 1, y = top + (bottom - top) * p;
          g.globalAlpha = out; g.fillStyle = p < 1 ? C.accent : C.ink;
          g.fillRect(FIRST - 2, top, 4, y - top); g.fillRect(FIRST + 4, top, 1, y - top);
          if (p < 1) { g.fillStyle = C.accent; g.fillRect(FIRST - 5, y - 5, 10, 10); for (let k = 1; k <= 8; k++) g.fillRect(FIRST + 3 + k * 3, y - 6 - k * 6, 5, 5); }   // 棒尖 + 斜着的一截棒身
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
