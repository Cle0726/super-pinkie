/* compaction-knot:v2 —— 上下文整理的「收束」动效
 *
 * 借用 C.le. 的动画语言（尖头笔笔压、粒子沿笔顺流动、光沿笔画掠过、句点墨晕），
 * 但不照搬签名：两侧是一行行对话细线，粒子沿细线向中间汇入，
 * 一支笔把它们打成一个结、落下句点；完成后两侧细线收成一条分隔线。
 *
 *   active / retrying  循环：细线流入 → 书写结 → 句点墨晕 → 光沿笔画 → 淡出
 *   complete / skipped 收尾一次，然后静止并停止渲染
 *   failed             静态：笔画中断，句点不落
 *
 * Canvas 2D，一个文档只保留一个渲染器；不可见时暂停。
 */
(() => {
  'use strict';
  if (window.__pinkieCompactionGlyph) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const CYCLE = 2800, SETTLE = 2200, HEIGHT = 34, COUNT = 96;
  const nightQuery = '[data-pinkie-night],[data-theme-mode="dark"]';
  const PALETTE = {
    day: {ink: '#2c2945', thread: '#5d5872', glow: '#2f7bff', fail: '#a8743a', blend: 'source-over'},
    night: {ink: '#e9eeff', thread: '#a9b4d8', glow: '#62b4ff', fail: '#e2b27a', blend: 'lighter'},
  };
  // The knot, in px around the centre (y down): an entry stroke rising into a
  // loop, crossing itself and leaving as a tapering swash; the period follows.
  const KNOT = [[-34, 4], [-22, 6], [-12, 6], [-4, 2], [4, -3], [8, -11], [3, -13], [-2, -15], [-8, -9], [-5, -3],
    [-2, 3], [8, 6], [16, 5], [22, 4], [27, 2], [31, 0]];
  const DOT = {x: 37, y: 2, r: 2};
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const span = (t, a, b) => clamp((t - a) / (b - a));
  // Rows narrow toward the knot, so the threads read as being gathered.
  const funnel = (t, along) => t.y * (.28 + .72 * clamp(along / t.length));

  function sampleKnot(n) {
    const raw = [];
    for (let i = 0; i + 3 < KNOT.length; i += 3) {
      const [p0, p1, p2, p3] = KNOT.slice(i, i + 4);
      for (let k = i ? 1 : 0; k <= 40; k++) {
        const t = k / 40, u = 1 - t;
        raw.push([u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0], u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]]);
      }
    }
    const lengths = [0];
    for (let i = 1; i < raw.length; i++) lengths.push(lengths[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
    const total = lengths[lengths.length - 1], points = [];
    for (let i = 0, j = 1; i < n; i++) {
      const s = total * i / (n - 1);
      while (j < raw.length - 1 && lengths[j] < s) j++;
      const f = (s - lengths[j - 1]) / ((lengths[j] - lengths[j - 1]) || 1);
      points.push({x: raw[j - 1][0] + (raw[j][0] - raw[j - 1][0]) * f, y: raw[j - 1][1] + (raw[j][1] - raw[j - 1][1]) * f});
    }
    // Pointed-pen pressure, as in C.le.: heavy on down strokes, a hairline up,
    // a short entry and a long exit taper.
    for (let i = 0; i < n; i++) {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const tx = (b.x - a.x) / len, ty = (b.y - a.y) / len, t = i / (n - 1);
      let w = 2.5 * (.2 + 1.05 * Math.pow(Math.max(0, ty), 1.4) + .16 * (1 - Math.abs(ty)));
      w *= .35 + .65 * Math.min(1, t / .07);
      if (t > .7) w *= 1 - .88 * Math.pow((t - .7) / .3, 1.2);
      Object.assign(points[i], {nx: -ty, ny: tx, w: Math.max(.4, w)});
    }
    return points;
  }
  const PATH = sampleKnot(180);

  let host, owner, phase = 'idle', visible = true, frame = 0, frames = 0, started = 0, settleAt = 0, settled = false;
  let canvas, ctx, width = 0, dpr = 1, palette = PALETTE.day, threads = [], particles = [], themeObserver, resizeObserver;

  function night() { return document.documentElement.matches(nightQuery); }
  function seeded(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

  function layout() {
    if (!canvas) return false;
    const w = Math.round(host.clientWidth);
    if (!w) return false;
    if (w === width && canvas.width) return true;
    width = w; dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(HEIGHT * dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${HEIGHT}px`;
    // Threads are "lines of conversation": word-length dashes on four rows
    // each side, longer toward the middle rows, ending at the knot's gate.
    const random = seeded(width * 7 + 13), gate = 52, reach = Math.max(30, w / 2 - gate - 6);
    threads = [];
    for (const side of [-1, 1]) for (const [row, y] of [-9, -3, 3, 9].entries()) {
      const words = [];
      let x = 0;
      const length = reach * (row === 1 || row === 2 ? 1 : .55 + random() * .3);
      while (x < length) { const word = 6 + random() * 22; words.push([x, Math.min(length, x + word)]); x += word + 3 + random() * 4; }
      threads.push({side, y, length, words, speed: 10 + random() * 8});
    }
    particles = Array.from({length: COUNT}, (_, i) => {
      const thread = threads[i % threads.length];
      return {thread, phase: random(), lane: (random() - .5) * 1.2, size: .45 + random() * .6, to: random(), glint: random() < .22};
    });
    return true;
  }

  function strokePolygon(progress, cx, cy) {
    const end = progress * (PATH.length - 1), last = Math.floor(end);
    if (end <= 0) return null;
    const pts = PATH.slice(0, last + 1);
    if (last < PATH.length - 1) {
      const a = PATH[last], b = PATH[last + 1], f = end - last;
      pts.push({x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, nx: a.nx, ny: a.ny, w: a.w + (b.w - a.w) * f});
    }
    const path = new Path2D();
    pts.forEach((p, i) => path[i ? 'lineTo' : 'moveTo'](cx + p.x + p.nx * p.w / 2, cy + p.y + p.ny * p.w / 2));
    for (let i = pts.length - 1; i >= 0; i--) path.lineTo(cx + pts[i].x - pts[i].nx * pts[i].w / 2, cy + pts[i].y - pts[i].ny * pts[i].w / 2);
    path.closePath();
    return {path, tip: pts[pts.length - 1]};
  }

  // One picture for a moment of the animation. `cycle` runs 0→1 while
  // working; `end` runs 0→1 through the closing sequence.
  function paint(cycle, end, now) {
    const c = ctx, cx = width / 2, cy = HEIGHT / 2 + 1, gate = 52;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, HEIGHT);
    c.globalCompositeOperation = palette.blend;
    const failed = phase === 'failed', closing = end > 0;
    const threadAlpha = failed ? .22 : closing ? .4 * (1 - span(end, .15, .55)) : .4;

    // Threads drift inward and dissolve at the gate.
    if (threadAlpha > .01) {
      c.fillStyle = palette.thread;
      for (const t of threads) {
        const shift = failed ? 0 : (now / 1000 * t.speed) % 40;
        for (const [a, b] of t.words) for (const offset of [shift, shift - 40]) {
          const from = a + offset, to = b + offset;
          if (to < 0 || from > t.length) continue;
          const lo = Math.max(0, from), hi = Math.min(t.length, to), mid = (lo + hi) / 2;
          const fade = Math.min(1, (t.length - mid) / 56) * Math.min(1, mid / 22);
          c.globalAlpha = threadAlpha * fade * (closing ? 1 - span(end, 0, .5) * (mid / t.length) : 1);
          const x0 = cx + t.side * (gate + lo), x1 = cx + t.side * (gate + hi);
          c.fillRect(Math.min(x0, x1), cy + funnel(t, mid) - .35, Math.abs(x1 - x0), .7);
        }
      }
    }

    // Particles leave the threads and pour into the knot.
    if (!failed && (!closing || end < .45)) {
      for (const p of particles) {
        c.fillStyle = p.glint ? palette.glow : palette.ink;
        const life = (cycle + p.phase) % 1, travel = ease(life);
        const t = p.thread, from = gate + t.length * (1 - p.to * .9), x = cx + t.side * (from - (from - gate + 10) * travel);
        const y = cy + funnel(t, Math.abs(x - cx) - gate) * (1 - travel * travel) + p.lane * (1 - travel);
        c.globalAlpha = Math.sin(Math.PI * life) * (p.glint ? .8 : .55) * (closing ? 1 - end / .45 : 1);
        c.beginPath(); c.arc(x, y, p.size * (1 - travel * .4), 0, Math.PI * 2); c.fill();
      }
    }

    // The knot: written, swept by light, then faded for the next round.
    const write = closing ? 1 : failed ? .56 : ease(span(cycle, .14, .68));
    const knotAlpha = closing || failed ? 1 : 1 - span(cycle, .88, 1);
    const knot = strokePolygon(write, cx, cy);
    if (knot) {
      c.globalAlpha = knotAlpha;
      c.fillStyle = failed ? palette.fail : palette.ink;
      c.fill(knot.path);
      if (!failed && !closing && write < 1) {
        const g = c.createRadialGradient(cx + knot.tip.x, cy + knot.tip.y, 0, cx + knot.tip.x, cy + knot.tip.y, 9);
        g.addColorStop(0, palette.glow); g.addColorStop(1, 'transparent');
        c.globalAlpha = .55; c.fillStyle = g; c.fillRect(cx + knot.tip.x - 9, cy + knot.tip.y - 9, 18, 18);
      }
      const sweep = closing ? span(end, .05, .45) : span(cycle, .7, .88);
      if (!failed && sweep > 0 && sweep < 1) {
        const at = PATH[Math.round(sweep * (PATH.length - 1))];
        const g = c.createRadialGradient(cx + at.x, cy + at.y, 0, cx + at.x, cy + at.y, 7);
        g.addColorStop(0, palette.glow); g.addColorStop(1, 'transparent');
        c.save(); c.clip(knot.path); c.globalAlpha = .9 * knotAlpha; c.fillStyle = g; c.fillRect(cx + at.x - 7, cy + at.y - 7, 14, 14); c.restore();
      }
    }

    // The period and its ink bloom.
    const drop = closing ? span(end, .3, .42) : span(cycle, .7, .74);
    if (!failed && drop > 0) {
      c.globalAlpha = knotAlpha; c.fillStyle = palette.ink;
      c.beginPath(); c.arc(cx + DOT.x, cy + DOT.y, DOT.r * ease(drop), 0, Math.PI * 2); c.fill();
      const bloom = closing ? span(end, .34, .75) : span(cycle, .72, .96);
      if (bloom > 0 && bloom < 1) {
        c.globalAlpha = .45 * (1 - bloom) * knotAlpha; c.strokeStyle = palette.glow; c.lineWidth = .8;
        c.beginPath(); c.arc(cx + DOT.x, cy + DOT.y, 2 + 8 * ease(bloom), 0, Math.PI * 2); c.stroke();
      }
    }

    // Closing: the threads have become one hairline drawn out from the knot.
    if (closing) {
      const reach = ease(span(end, .45, 1)) * (width / 2 - gate - 6);
      for (const side of [-1, 1]) {
        // Left meets the knot's entry stroke, right leaves from the period.
        const x0 = side < 0 ? cx - 35 : cx + DOT.x + 4, x1 = x0 + side * reach, y = cy + (side < 0 ? 3.6 : DOT.y - .4);
        const g = c.createLinearGradient(x0, 0, x1, 0);
        g.addColorStop(0, palette.thread); g.addColorStop(1, 'transparent');
        c.globalAlpha = .55; c.fillStyle = g; c.fillRect(Math.min(x0, x1), y, Math.abs(x1 - x0), .8);
      }
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    frames++;
  }

  function running() {
    return !!owner && visible && !document.hidden && !reduce.matches && !settled && phase !== 'failed';
  }

  function tick(now) {
    frame = 0;
    if (!running()) return;
    // Not laid out yet (just mounted, or in a collapsed pane): try next frame.
    if (!layout()) { frame = requestAnimationFrame(tick); return; }
    if (!started) started = now;
    const active = phase === 'active' || phase === 'retrying';
    if (active) paint(((now - started) / (phase === 'retrying' ? CYCLE * .7 : CYCLE)) % 1, 0, now);
    else {
      settleAt ||= now;
      const end = Math.min(1, (now - settleAt) / SETTLE);
      paint(1, Math.max(.001, end), now);
      if (end >= 1) { settled = true; return; }
    }
    frame = requestAnimationFrame(tick);
  }

  function still() {
    if (!owner || !layout()) return;
    if (phase === 'failed') paint(0, 0, 0);
    else paint(1, 1, 0);
  }

  function refresh() {
    palette = night() ? PALETTE.night : PALETTE.day;
    if (!owner) return;
    if (reduce.matches || phase === 'failed' || settled) { cancelAnimationFrame(frame); frame = 0; still(); return; }
    if (running() && !frame) frame = requestAnimationFrame(tick);
  }

  const api = window.__pinkieCompactionGlyph = {
    mount(target, nextPhase) {
      if (owner !== target) {
        owner = target; settled = false; started = 0; settleAt = 0;
        host ||= Object.assign(document.createElement('span'), {className: 'pinkie-compaction-knot'});
        if (!canvas) { canvas = document.createElement('canvas'); ctx = canvas.getContext('2d'); host.append(canvas); }
        target.replaceChildren(host);
        width = 0;
        resizeObserver ||= typeof ResizeObserver === 'function' ? new ResizeObserver(() => { width = 0; if (settled || reduce.matches || phase === 'failed') still(); }) : null;
        resizeObserver?.disconnect(); resizeObserver?.observe(target);
        themeObserver ||= new MutationObserver(() => refresh());
        themeObserver.disconnect(); themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-pinkie-night', 'data-theme-mode']});
      }
      const was = phase;
      phase = String(nextPhase || 'active');
      const working = phase === 'active' || phase === 'retrying';
      if (was !== phase) {
        if (working) { settled = false; settleAt = 0; }
        else if (phase === 'complete' || phase === 'skipped') { settled = phase === 'skipped'; settleAt = 0; }
      }
      host.dataset.mode = reduce.matches ? 'static' : 'particles';
      visible = target.closest('.laolao-compaction-notice')?.dataset.motion !== 'paused';
      refresh();
    },
    setVisible(target, on) { if (owner === target) { visible = on; if (on) refresh(); else { cancelAnimationFrame(frame); frame = 0; } } },
    park(target) { if (owner === target) { cancelAnimationFrame(frame); frame = 0; resizeObserver?.disconnect(); owner = null; host?.remove(); } },
    dispose() { cancelAnimationFrame(frame); frame = 0; resizeObserver?.disconnect(); themeObserver?.disconnect(); owner = null; host?.remove(); host = canvas = ctx = null; },
    status() { return {renderers: canvas ? 1 : 0, mode: host?.dataset.mode || 'loading', phase, visible: !!frame, settled, frames}; },
  };
  reduce.addEventListener?.('change', () => { if (host) host.dataset.mode = reduce.matches ? 'static' : 'particles'; refresh(); });
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('pagehide', api.dispose);
})();
