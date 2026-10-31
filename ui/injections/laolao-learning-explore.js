(() => {
  'use strict';
  // ChatGPT 式消息内实验：公式代入当前值 + 实时图 + 读数 + 滑杆。定义来自服务器，这里只画图和算数。
  if (window.__pinkieLearningExplore) return;
  const NS = 'http://www.w3.org/2000/svg';
  const kinds = ['concept_lab', 'logic_lab', 'timing_lab', 'sequence_lab'];
  const S = (tag, attrs = {}, text) => {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== null) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = String(text);
    return el;
  };
  const E = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = String(text); return el; };
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const sig = (x, n = 3) => Number.isFinite(x) ? Number(Number(x).toPrecision(n)) : x;
  const num = (x, n = 4) => { if (!Number.isFinite(x)) return x > 0 ? '∞' : x < 0 ? '−∞' : '—'; const s = String(sig(x, n)); return s.replace('-', '−'); };
  const PREFIX = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'μ'], [1e-9, 'n']];
  // 带单位自动换算 m/k/μ 前缀，3 位有效数字。
  const fmt = (x, unit = '', n = 3) => {
    if (!Number.isFinite(x)) return `${num(x)} ${unit}`.trim();
    if (!unit || unit === '°' || unit === '%') return `${num(x, n)}${unit === '°' ? '°' : unit ? ' ' + unit : ''}`;
    if (x === 0) return `0 ${unit}`;
    const [scale, prefix] = PREFIX.find(([s]) => Math.abs(x) >= s * .9995) || PREFIX.at(-1);
    return `${num(x / scale, n)} ${prefix}${unit}`;
  };
  const FACTOR = {'kΩ': 1e3, 'μF': 1e-6, 'mH': 1e-3};
  const BASE = {'kΩ': 'Ω', 'μF': 'F', 'mH': 'H'};
  const exp = Math.exp, PI = Math.PI;
  const RICH = /([_^])(\(([^()]*)\)|([A-Za-z0-9]+))/g;
  // 把 u_C、e^(−t/τ) 这样的写法变成真正的下标、上标。
  function rich(el, text, svg = false) {
    text = String(text); el.textContent = ''; let last = 0;
    for (const match of text.matchAll(RICH)) {
      const [whole, mark, , group, word] = match, body = group ?? word;
      if (mark === '_' && group !== undefined) continue;
      if (match.index > last) el.append(text.slice(last, match.index));
      if (svg) { const t = S('tspan', {'baseline-shift': mark === '_' ? 'sub' : 'super', 'font-size': '75%'}, body); el.append(t, S('tspan', {}, '\u200b')); }
      else el.append(E(mark === '_' ? 'sub' : 'sup', '', body));
      last = match.index + whole.length;
    }
    if (last < text.length) el.append(text.slice(last));
    return el;
  }

  // ---------- 画图工具 ----------
  function frame(svg, box, xr, yr, opts = {}) {
    const [x0, y0, w, h] = box, [xmin, xmax] = xr, [ymin, ymax] = yr;
    const lx = opts.logx;
    const tx = x => lx ? Math.log10(x) : x;
    const sx = x => x0 + (tx(x) - tx(xmin)) / (tx(xmax) - tx(xmin)) * w;
    const sy = y => y0 + h - (y - ymin) / (ymax - ymin) * h;
    const g = S('g', {class: 'pil-frame'});
    g.append(S('rect', {x: x0, y: y0, width: w, height: h, class: 'pil-plot-bg'}));
    const xt = opts.xticks || ticks(xmin, xmax, w < 260 ? 3 : 5, lx), yt = opts.yticks || ticks(ymin, ymax, h < 140 ? 3 : 5);
    for (const [x, label] of xt) { g.append(S('line', {x1: sx(x), x2: sx(x), y1: y0, y2: y0 + h, class: 'pil-grid'})); g.append(S('text', {x: sx(x), y: y0 + h + 14, 'text-anchor': 'middle', class: 'pil-tick'}, label)); }
    for (const [y, label] of yt) { g.append(S('line', {x1: x0, x2: x0 + w, y1: sy(y), y2: sy(y), class: 'pil-grid'})); g.append(S('text', {x: x0 - 5, y: sy(y) + 4, 'text-anchor': 'end', class: 'pil-tick'}, label)); }
    if (!lx && xmin < 0 && xmax > 0) g.append(S('line', {x1: sx(0), x2: sx(0), y1: y0, y2: y0 + h, class: 'pil-axis'}));
    if (ymin < 0 && ymax > 0) g.append(S('line', {x1: x0, x2: x0 + w, y1: sy(0), y2: sy(0), class: 'pil-axis'}));
    if (opts.xlabel) g.append(S('text', {x: x0 + w, y: y0 + h + 28, 'text-anchor': 'end', class: 'pil-axis-label'}, opts.xlabel));
    if (opts.ylabel) g.append(S('text', {x: x0, y: y0 - 7, 'text-anchor': 'start', class: 'pil-axis-label'}, opts.ylabel));
    const clipId = `pil-clip-${Math.random().toString(36).slice(2)}`;
    const clip = S('clipPath', {id: clipId}); clip.append(S('rect', {x: x0, y: y0 - 2, width: w, height: h + 4})); g.append(clip);
    svg.append(g);
    const curve = (fn, cls, from = xmin, to = xmax, samples = 240) => {
      let d = '', pen = false;
      for (let i = 0; i <= samples; i++) {
        const x = lx ? 10 ** (Math.log10(from) + (Math.log10(to) - Math.log10(from)) * i / samples) : from + (to - from) * i / samples;
        const y = fn(x);
        if (!Number.isFinite(y) || Math.abs(y) > 1e6) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(clamp(y, ymin - (ymax - ymin) * 2, ymax + (ymax - ymin) * 2)).toFixed(1)}`; pen = true;
      }
      const path = S('path', {d, class: cls, 'clip-path': `url(#${clipId})`}); svg.append(path); return path;
    };
    return {sx, sy, curve, clipId};
  }
  function ticks(min, max, count, log) {
    if (log) { const out = []; for (let e = Math.ceil(Math.log10(min)); e <= Math.floor(Math.log10(max)); e++) out.push([10 ** e, fmt(10 ** e).replace(/ $/, '')]); return out; }
    const raw = (max - min) / Math.max(1, count - 1), mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
    const out = []; for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push([Number(v.toPrecision(10)), num(v, 3)]);
    return out;
  }
  const dot = (svg, x, y, cls = 'pil-dot', r = 4.5) => svg.append(S('circle', {cx: x, cy: y, r, class: cls}));
  const label = (svg, x, y, text, cls = 'pil-label', anchor = 'start') => { const t = rich(S('text', {x, y, class: cls, 'text-anchor': anchor}), text, true); svg.append(t); return t; };
  const line = (svg, x1, y1, x2, y2, cls = 'pil-wire') => svg.append(S('line', {x1, y1, x2, y2, class: cls}));
  const poly = (svg, points, cls = 'pil-wire') => svg.append(S('polyline', {points: points.map(p => p.join(',')).join(' '), class: cls}));
  // 国标符号：电阻是矩形，电容两块板，电感半圆，电源长短线。
  function resistor(svg, x1, y1, x2, y2, text, cls = '') {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, horizontal = Math.abs(x2 - x1) > Math.abs(y2 - y1), L = 34, T = 12;
    if (horizontal) { line(svg, x1, y1, mx - L / 2, my); line(svg, mx + L / 2, my, x2, y2); svg.append(S('rect', {x: mx - L / 2, y: my - T / 2, width: L, height: T, rx: 2, class: `pil-part ${cls}`})); if (text) label(svg, mx, my - T / 2 - 6, text, 'pil-label', 'middle'); }
    else { line(svg, x1, y1, mx, my - L / 2); line(svg, mx, my + L / 2, x2, y2); svg.append(S('rect', {x: mx - T / 2, y: my - L / 2, width: T, height: L, rx: 2, class: `pil-part ${cls}`})); if (text) label(svg, mx + T / 2 + 6, my + 4, text); }
  }
  function capacitor(svg, x, y1, y2, text) {
    const my = (y1 + y2) / 2; line(svg, x, y1, x, my - 4); line(svg, x, my + 4, x, y2);
    svg.append(S('line', {x1: x - 12, x2: x + 12, y1: my - 4, y2: my - 4, class: 'pil-plate'})); svg.append(S('line', {x1: x - 12, x2: x + 12, y1: my + 4, y2: my + 4, class: 'pil-plate'}));
    if (text) label(svg, x + 16, my + 4, text);
  }
  function inductor(svg, x, y1, y2, text) {
    const my = (y1 + y2) / 2, r = 5; line(svg, x, y1, x, my - 4 * r); line(svg, x, my + 4 * r, x, y2);
    let d = `M${x},${my - 4 * r}`; for (let i = 0; i < 4; i++) d += ` a${r},${r} 0 0 1 0,${2 * r}`; svg.append(S('path', {d, class: 'pil-wire'}));
    if (text) label(svg, x + 12, my + 4, text);
  }
  function battery(svg, x, y1, y2, text) {
    const my = (y1 + y2) / 2; line(svg, x, y1, x, my - 5); line(svg, x, my + 5, x, y2);
    svg.append(S('line', {x1: x - 13, x2: x + 13, y1: my - 5, y2: my - 5, class: 'pil-plate'})); svg.append(S('line', {x1: x - 7, x2: x + 7, y1: my + 5, y2: my + 5, class: 'pil-plate pil-thick'}));
    label(svg, x - 18, my - 8, '+', 'pil-label', 'end'); if (text) label(svg, x - 18, my + 12, text, 'pil-label', 'end');
  }
  // 电流方向的流动虚线，速度随电流大小变化。
  function flow(svg, d, strength) {
    if (!(strength > 0)) return;
    const path = S('path', {d, class: 'pil-current'}); path.style.animationDuration = `${clamp(1.6 / Math.sqrt(strength), .35, 8).toFixed(2)}s`; svg.prepend(path);
  }
  function bar(svg, x, y, w, h, parts) {
    const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0) || 1; let cursor = x;
    for (const part of parts) {
      const width = w * Math.max(0, part.value) / total;
      svg.append(S('rect', {x: cursor, y, width: Math.max(0, width - 2), height: h, rx: 4, class: part.cls}));
      if (width > 46) label(svg, cursor + width / 2, y + h / 2 + 4, part.text, 'pil-bar-label', 'middle');
      cursor += width;
    }
  }
  const svgBox = (W, H) => S('svg', {viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'pil-svg', role: 'img'});

  // ---------- 概念实验 ----------
  const F = {
    x2: {f: x => x * x, d: x => 2 * x, F: x => x ** 3 / 3, tex: 'x²', dtex: '2x', Ftex: 'x³/3', dom: [-3.2, 3.2]},
    x3: {f: x => x ** 3 - 3 * x, d: x => 3 * x * x - 3, F: x => x ** 4 / 4 - 1.5 * x * x, tex: 'x³ − 3x', dtex: '3x² − 3', Ftex: 'x⁴/4 − 3x²/2', dom: [-2.6, 2.6]},
    sin: {f: Math.sin, d: Math.cos, F: x => -Math.cos(x), tex: 'sin x', dtex: 'cos x', Ftex: '−cos x', dom: [-3.5, 3.5]},
    exp: {f: Math.exp, d: Math.exp, F: Math.exp, tex: 'eˣ', dtex: 'eˣ', Ftex: 'eˣ', dom: [-3, 2.2]},
    ln: {f: Math.log, d: x => 1 / x, F: x => x * Math.log(x) - x, tex: 'ln x', dtex: '1/x', Ftex: 'x ln x − x', dom: [.05, 4]},
    line: {f: x => 2 * x + 1, d: () => 2, F: x => x * x + x, tex: '2x + 1', dtex: '2', Ftex: 'x² + x', dom: [-3.2, 3.2]},
  };
  const range = (fn, a, b) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i <= 200; i++) { const y = fn(a + (b - a) * i / 200); if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); } } const pad = (hi - lo) * .12 || 1; return [lo - pad, hi + pad]; };

  const CONCEPTS = {
    ohm: {
      compute: ({U, R}) => { const I = U / R; return {formula: `I = U / R = ${fmt(U, 'V')} ÷ ${fmt(R, 'Ω')} = ${fmt(I, 'A')}`, readouts: [['电流 I', fmt(I, 'A'), true], ['功率 P = UI', fmt(U * I, 'W')]], hint: `R 不变时 I 与 U 成正比，U 不变时 I 与 R 成反比；直线越陡，电阻越小。`, I}; },
      draw(svg, W, H, {U, R}, r) {
        const wide = W >= 520, cw = wide ? W * .42 : W, ch = wide ? H : H * .5;
        const L = 50, Rt = cw - 30, T = 30, B = ch - 24;
        battery(svg, L, B, T, fmt(U, 'V')); line(svg, L, T, Rt, T); resistor(svg, Rt, T, Rt, B, `R = ${fmt(R, 'Ω')}`); line(svg, Rt, B, L, B);
        flow(svg, `M${L},${T} L${Rt},${T} L${Rt},${B} L${L},${B}`, r.I * 10);
        label(svg, (L + Rt) / 2, T - 8, `I = ${fmt(r.I, 'A')}`, 'pil-label pil-strong', 'middle');
        const px = wide ? cw + 50 : 46, py = wide ? 22 : ch + 24, pw = wide ? W - cw - 66 : W - 62, ph = wide ? H - 56 : H - ch - 58;
        const imax = 36 / R * 1.05, p = frame(svg, [px, py, pw, ph], [0, 36], [0, imax], {xlabel: 'U / V', ylabel: 'I', yticks: ticks(0, imax, 4).map(([y]) => [y, fmt(y, 'A')])});
        p.curve(u => u / R, 'pil-curve'); dot(svg, p.sx(U), p.sy(U / R));
      },
    },
    series_divider: {
      compute: ({U, R1, R2}) => { const I = U / (R1 + R2), U1 = I * R1, U2 = I * R2; return {formula: `U₂ = U · R₂ / (R₁ + R₂) = ${fmt(U, 'V')} × ${fmt(R2, 'Ω')} / ${fmt(R1 + R2, 'Ω')} = ${fmt(U2, 'V')}`, readouts: [['电流 I', fmt(I, 'A')], ['U₁', fmt(U1, 'V'), true], ['U₂', fmt(U2, 'V'), true], ['总电阻', fmt(R1 + R2, 'Ω')]], hint: `串联电流处处相等，电压按电阻正比分配：U₁ : U₂ = R₁ : R₂ = ${num(R1 / R2, 3)} : 1。`, I, U1, U2}; },
      draw(svg, W, H, {U, R1, R2}, r) {
        const L = 50, Rt = Math.min(W - 150, 330), T = 30, B = H - 60, M = (T + B) / 2;
        battery(svg, L, B, T, fmt(U, 'V')); line(svg, L, T, Rt, T); resistor(svg, Rt, T, Rt, M, `R₁ ${fmt(R1, 'Ω')}`); resistor(svg, Rt, M, Rt, B, `R₂ ${fmt(R2, 'Ω')}`); line(svg, Rt, B, L, B);
        svg.append(S('circle', {cx: Rt, cy: M, r: 3, class: 'pil-node'}));
        flow(svg, `M${L},${T} L${Rt},${T} L${Rt},${B} L${L},${B}`, r.I * 10);
        const bx = 24, bw = W - 48; label(svg, bx, H - 34, '电源电压被分成两份', 'pil-tick');
        bar(svg, bx, H - 28, bw, 22, [{value: r.U1, cls: 'pil-seg-a', text: `U₁ ${fmt(r.U1, 'V')}`}, {value: r.U2, cls: 'pil-seg-b', text: `U₂ ${fmt(r.U2, 'V')}`}]);
      },
    },
    parallel_divider: {
      compute: ({U, R1, R2}) => { const I1 = U / R1, I2 = U / R2, I = I1 + I2, Req = R1 * R2 / (R1 + R2); return {formula: `I₁ = I · R₂ / (R₁ + R₂) = ${fmt(I, 'A')} × ${fmt(R2, 'Ω')} / ${fmt(R1 + R2, 'Ω')} = ${fmt(I1, 'A')}`, readouts: [['总电流 I', fmt(I, 'A')], ['I₁', fmt(I1, 'A'), true], ['I₂', fmt(I2, 'A'), true], ['等效电阻', fmt(Req, 'Ω')]], hint: `并联电压相等，电流按电阻反比分配：I₁ : I₂ = R₂ : R₁；等效电阻比最小的那个还小。`, I, I1, I2}; },
      draw(svg, W, H, {U, R1, R2}, r) {
        const L = 50, A = Math.min(W - 190, 240), Bx = A + 110, T = 30, B = H - 60;
        battery(svg, L, B, T, fmt(U, 'V')); line(svg, L, T, Bx, T); line(svg, L, B, Bx, B);
        resistor(svg, A, T, A, B, `R₁ ${fmt(R1, 'Ω')}`); resistor(svg, Bx, T, Bx, B, `R₂ ${fmt(R2, 'Ω')}`);
        for (const x of [A]) { svg.append(S('circle', {cx: x, cy: T, r: 3, class: 'pil-node'})); svg.append(S('circle', {cx: x, cy: B, r: 3, class: 'pil-node'})); }
        flow(svg, `M${L},${T} L${A},${T} L${A},${B} L${L},${B}`, r.I1 * 10); flow(svg, `M${A},${T} L${Bx},${T} L${Bx},${B} L${A},${B}`, r.I2 * 10);
        label(svg, 24, H - 34, '总电流被分成两路', 'pil-tick');
        bar(svg, 24, H - 28, W - 48, 22, [{value: r.I1, cls: 'pil-seg-a', text: `I₁ ${fmt(r.I1, 'A')}`}, {value: r.I2, cls: 'pil-seg-b', text: `I₂ ${fmt(r.I2, 'A')}`}]);
      },
    },
    rc_transient: {
      compute: ({mode, U, R, C, k}) => {
        const tau = R * C, t = k * tau, charge = mode === 'charge', uc = charge ? U * (1 - exp(-k)) : U * exp(-k), i = (charge ? 1 : -1) * U / R * exp(-k);
        return {formula: `${charge ? `u_C = U(1 − e^(−t/τ)) = ${fmt(U, 'V')} × (1 − e^(−${num(k, 3)}))` : `u_C = U·e^(−t/τ) = ${fmt(U, 'V')} × e^(−${num(k, 3)})`} = ${fmt(uc, 'V')}，τ = RC = ${fmt(R, 'Ω')} × ${fmt(C, 'F')} = ${fmt(tau, 's')}`,
          readouts: [['时间常数 τ', fmt(tau, 's'), true], ['时刻 t', fmt(t, 's')], ['u_C', fmt(uc, 'V'), true], ['i_C', fmt(i, 'A')], [charge ? '已充到' : '还剩', `${num(100 * uc / U, 3)}%`]],
          hint: k >= 3 ? `t ≥ 3τ 时已${charge ? '充到 95%' : '放到 5%'}以上，工程上认为暂态结束（3τ–5τ）。` : `t = τ 时${charge ? '充到 63.2%' : '剩 36.8%'}；电容电压不能突变，电流可以突变。`, uc, i, tau};
      },
      draw(svg, W, H, {mode, U, k}) { transient(svg, W, H, mode === 'charge' ? x => 1 - exp(-x) : x => exp(-x), k, U, 'u_C', 'V', mode === 'charge' ? x => exp(-x) : x => -exp(-x), 'i_C'); },
    },
    rl_transient: {
      compute: ({mode, U, R, L, k}) => {
        const tau = L / R, t = k * tau, I0 = U / R, on = mode === 'charge', i = on ? I0 * (1 - exp(-k)) : I0 * exp(-k), uL = on ? U * exp(-k) : -U * exp(-k);
        return {formula: `${on ? `i_L = (U/R)(1 − e^(−t/τ))` : `i_L = (U/R)·e^(−t/τ)`} = ${fmt(i, 'A')}，τ = L / R = ${fmt(L, 'H')} ÷ ${fmt(R, 'Ω')} = ${fmt(tau, 's')}`,
          readouts: [['时间常数 τ', fmt(tau, 's'), true], ['时刻 t', fmt(t, 's')], ['i_L', fmt(i, 'A'), true], ['u_L', fmt(uL, 'V')], ['稳态电流', fmt(I0, 'A')]],
          hint: `电感电流不能突变；R 越大 τ = L/R 越小，过渡越快（和 RC 电路相反）。`};
      },
      draw(svg, W, H, {mode, U, R, k}) { transient(svg, W, H, mode === 'charge' ? x => 1 - exp(-x) : x => exp(-x), k, U / R, 'i_L', 'A', mode === 'charge' ? x => exp(-x) : x => -exp(-x), 'u_L'); },
    },
    sine_ac: {
      compute: ({Um, Im, f, pu, pi}) => {
        let phi = ((pu - pi + 540) % 360) - 180; if (phi === -180) phi = 180;
        const rel = phi === 0 ? '同相' : Math.abs(phi) === 180 ? '反相' : Math.abs(phi) === 90 ? (phi > 0 ? '电压超前电流 90°（正交）' : '电压滞后电流 90°（正交）') : phi > 0 ? `电压超前电流 ${num(phi)}°` : `电压滞后电流 ${num(-phi)}°`;
        return {formula: `u = ${num(Um)} sin(${num(2 * PI * f, 4)}t ${pu < 0 ? '−' : '+'} ${num(Math.abs(pu))}°) V，i = ${num(Im)} sin(${num(2 * PI * f, 4)}t ${pi < 0 ? '−' : '+'} ${num(Math.abs(pi))}°) A`,
          readouts: [['角频率 ω', `${num(2 * PI * f, 4)} rad/s`], ['周期 T', fmt(1 / f, 's')], ['U 有效值', fmt(Um / Math.SQRT2, 'V'), true], ['I 有效值', fmt(Im / Math.SQRT2, 'A')], ['相位差 φ', `${num(phi)}°`, true]],
          hint: `${rel}。三要素：幅值（最大值 = √2 × 有效值）、角频率 ω = 2πf、初相。`, phi};
      },
      draw(svg, W, H, {Um, Im, f, pu, pi}, r) {
        const wide = W >= 560, pw = wide ? W - 230 : W - 70, T = 2 / f;
        const p = frame(svg, [46, 22, pw, H - 56], [0, T], [-1.15, 1.15], {xlabel: 't', yticks: [[-1, '−Um'], [0, '0'], [1, 'Um']], xticks: [0, .25, .5, .75, 1, 1.25, 1.5, 1.75, 2].filter((_, i) => wide || i % 2 === 0).map(m => [m / f, m === 0 ? '0' : `${num(m)}T`])});
        const w = 2 * PI * f, rad = d => d * PI / 180;
        p.curve(t => Math.sin(w * t + rad(pu)), 'pil-curve'); p.curve(t => Math.sin(w * t + rad(pi)), 'pil-curve-b');
        label(svg, 52 + pw - 4, 38, 'u', 'pil-label pil-a', 'end'); label(svg, 52 + pw - 4, 54, 'i', 'pil-label pil-b', 'end');
        if (wide) {
          const cx = W - 92, cy = (H - 20) / 2, R0 = Math.min(76, cy - 14);
          svg.append(S('circle', {cx, cy, r: R0, class: 'pil-grid'})); line(svg, cx - R0 - 6, cy, cx + R0 + 6, cy, 'pil-axis');
          const arrow = (deg, len, cls) => { const x = cx + len * Math.cos(rad(deg)), y = cy - len * Math.sin(rad(deg)); line(svg, cx, cy, x, y, cls); dot(svg, x, y, cls === 'pil-phasor' ? 'pil-dot' : 'pil-dot-b', 3.5); };
          arrow(pu, R0, 'pil-phasor'); arrow(pi, R0 * clamp(Im / 10, .35, 1), 'pil-phasor-b');
          label(svg, cx, H - 8, `相量图 · φ = ${num(r.phi)}°`, 'pil-tick', 'middle');
        }
      },
    },
    rlc_series: {
      compute: ({U, R, L, C, f}) => {
        const w = 2 * PI * f, XL = w * L, XC = 1 / (w * C), X = XL - XC, Z = Math.hypot(R, X), I = U / Z, phi = Math.atan2(X, R) * 180 / PI, f0 = 1 / (2 * PI * Math.sqrt(L * C));
        const nature = Math.abs(X) < R * .02 ? '谐振（纯电阻性）' : X > 0 ? '感性（电压超前电流）' : '容性（电压滞后电流）';
        return {formula: `|Z| = √(R² + (X_L − X_C)²) = √(${fmt(R, 'Ω')}² + (${fmt(XL, 'Ω')} − ${fmt(XC, 'Ω')})²) = ${fmt(Z, 'Ω')}`,
          readouts: [['X_L = ωL', fmt(XL, 'Ω')], ['X_C = 1/ωC', fmt(XC, 'Ω')], ['|Z|', fmt(Z, 'Ω'), true], ['电流 I', fmt(I, 'A'), true], ['φ', `${num(phi, 3)}°`], ['cos φ', num(Math.cos(phi * PI / 180), 3)], ['谐振频率 f₀', fmt(f0, 'Hz')], ['U_L / U_C', `${fmt(I * XL, 'V')} / ${fmt(I * XC, 'V')}`]],
          hint: `${nature}。f = f₀ = 1/(2π√LC) 时 X_L = X_C，|Z| 最小、电流最大，U_L、U_C 可能远大于电源电压。`, XL, XC, Z, I, f0};
      },
      draw(svg, W, H, {U, R, L, C, f}, r) {
        const wide = W >= 560, tw = wide ? 190 : 0;
        if (wide) {
          const X = r.XL - r.XC, scale = 120 / Math.max(R, Math.abs(X), r.Z), ox = 26, oy = H / 2 + (X > 0 ? 50 : -50) * Math.min(1, Math.abs(X) * scale / 100);
          const rx = ox + R * scale, ry = oy - X * scale;
          line(svg, ox, oy, rx, oy, 'pil-phasor'); line(svg, rx, oy, rx, ry, 'pil-phasor-b'); line(svg, ox, oy, rx, ry, 'pil-wire pil-strong-line');
          label(svg, (ox + rx) / 2, oy + (X >= 0 ? 16 : -8), 'R', 'pil-label', 'middle'); label(svg, rx + 6, (oy + ry) / 2 + 4, 'X'); label(svg, (ox + rx) / 2 - 8, (oy + ry) / 2 - 6, '|Z|', 'pil-label pil-strong', 'end');
          label(svg, 20, 18, '阻抗三角形', 'pil-tick');
        }
        const lo = 10, hi = 2000, Ifn = fx => { const w = 2 * PI * fx; return U / Math.hypot(R, w * L - 1 / (w * C)); };
        let imax = 0; for (let i = 0; i <= 200; i++) imax = Math.max(imax, Ifn(10 ** (1 + Math.log10(200) * i / 200)));
        const p = frame(svg, [tw + 52, 22, W - tw - 70, H - 56], [lo, hi], [0, imax * 1.1], {logx: true, xlabel: 'f / Hz', ylabel: 'I', yticks: ticks(0, imax * 1.1, 4).map(([y]) => [y, fmt(y, 'A')])});
        p.curve(Ifn, 'pil-curve', lo, hi);
        if (r.f0 >= lo && r.f0 <= hi) { line(svg, p.sx(r.f0), 22, p.sx(r.f0), H - 34, 'pil-guide'); label(svg, p.sx(r.f0) + 4, 34, 'f₀', 'pil-label pil-b'); }
        dot(svg, p.sx(clamp(f, lo, hi)), p.sy(r.I));
      },
    },
    rectifier: {
      compute: ({type, filter, U2}) => {
        const k = type === 'bridge' ? (filter === 'cap' ? 1.2 : .9) : (filter === 'cap' ? 1 : .45), Uo = k * U2;
        return {formula: `U_O ≈ ${num(k)} U₂ = ${num(k)} × ${fmt(U2, 'V')} = ${fmt(Uo, 'V')}`,
          readouts: [['输出平均值 U_O', fmt(Uo, 'V'), true], ['峰值 √2·U₂', fmt(Math.SQRT2 * U2, 'V')], ['二极管最高反压', fmt(Math.SQRT2 * U2, 'V')], ['二极管电流', type === 'bridge' ? 'I_D = I_O / 2' : 'I_D = I_O']],
          hint: type === 'bridge' ? `桥式：四只二极管两两轮流导通，正负半周都有输出${filter === 'cap' ? '；加电容后电压更平、平均值升到约 1.2U₂' : '，平均值 0.9U₂'}。` : `半波：只有正半周导通${filter === 'cap' ? '；加电容后约 U₂' : '，平均值 0.45U₂'}。`, k};
      },
      draw(svg, W, H, {type, filter, U2}, r) {
        const Um = Math.SQRT2 * U2, p = frame(svg, [46, 22, W - 66, H - 56], [0, 3], [-Um * 1.1, Um * 1.15], {xlabel: '周期', ylabel: 'u', yticks: [[-Um, `−${fmt(Um, 'V')}`], [0, '0'], [Um, fmt(Um, 'V')]], xticks: [[0, '0'], [1, 'T'], [2, '2T'], [3, '3T']]});
        p.curve(t => Um * Math.sin(2 * PI * t), 'pil-curve-faint');
        const raw = t => { const s = Math.sin(2 * PI * t); return type === 'bridge' ? Um * Math.abs(s) : Um * Math.max(0, s); };
        let out = raw;
        if (filter === 'cap') {
          const period = type === 'bridge' ? .5 : 1, decay = type === 'bridge' ? 2.2 : 3.4;
          out = t => { const tp = Math.floor((t - .25) / period) * period + .25; const held = tp >= 0 ? Um * exp(-(t - tp) / decay) : 0; return Math.max(raw(t), held); };
        }
        p.curve(out, 'pil-curve', 0, 3, 480);
        line(svg, 46, p.sy(r.k * U2), W - 20, p.sy(r.k * U2), 'pil-guide'); label(svg, W - 24, p.sy(r.k * U2) - 6, `U_O ≈ ${fmt(r.k * U2, 'V')}`, 'pil-label pil-b', 'end');
        label(svg, 52, H - 40, '浅色：u₂；深色：输出 u_O', 'pil-tick');
      },
    },
    bjt_bias: {
      compute: ({Vcc, Rb, Rc, beta}) => {
        const IB = Math.max(0, (Vcc - .7) / Rb), ICsat = (Vcc - .3) / Rc; let IC = beta * IB, UCE = Vcc - IC * Rc, region = '放大区';
        if (IB <= 0) { IC = 0; UCE = Vcc; region = '截止区'; } else if (IC >= ICsat) { IC = ICsat; UCE = .3; region = '饱和区'; }
        return {formula: `I_B = (V_CC − U_BE) / R_B = (${num(Vcc)} − 0.7) V ÷ ${fmt(Rb, 'Ω')} = ${fmt(IB, 'A')}；I_C = βI_B = ${fmt(beta * IB, 'A')}；U_CE = V_CC − I_C R_C = ${fmt(UCE, 'V')}`,
          readouts: [['I_B', fmt(IB, 'A')], ['I_C', fmt(IC, 'A'), true], ['U_CE', fmt(UCE, 'V'), true], ['工作区', region, true], ['I_C(sat)', fmt(ICsat, 'A')]],
          hint: region === '饱和区' ? `βI_B 已超过 I_C(sat)，三极管饱和：I_C 不再受 I_B 控制，U_CE ≈ 0.3 V。把 R_B 调大一点就能回到放大区。` : `R_B 变小 → I_B 变大 → Q 点沿负载线向上移；Q 点在负载线中间附近时，输出不容易失真。`, IB, IC, UCE, ICsat, region};
      },
      draw(svg, W, H, {Vcc, Rc, beta}, r) {
        const icmax = Vcc / Rc * 1.15, p = frame(svg, [58, 22, W - 78, H - 56], [0, Vcc * 1.05], [0, icmax], {xlabel: 'U_CE / V', ylabel: 'I_C', yticks: ticks(0, icmax, 4).map(([y]) => [y, fmt(y, 'A')])});
        const step = r.IB > 0 ? r.IB / 2 : (Vcc - .7) / 300 / 2;
        for (let k = 1; k <= 5; k++) { const ib = step * k, ic = beta * ib; if (ic > icmax) break; p.curve(u => ic * (1 - exp(-u / .25)) * (1 + u / 60), 'pil-curve-faint', 0, Vcc * 1.05, 80); label(svg, p.sx(Vcc * 1.03), p.sy(ic * (1 + Vcc / 60)) - 3, `${fmt(ib, 'A')}`, 'pil-tick', 'end'); }
        line(svg, p.sx(0), p.sy(Vcc / Rc), p.sx(Vcc), p.sy(0), 'pil-guide'); label(svg, p.sx(Vcc * .78) + 6, p.sy(Vcc / Rc * .22) - 8, '直流负载线', 'pil-tick');
        dot(svg, p.sx(r.UCE), p.sy(r.IC), r.region === '放大区' ? 'pil-dot' : 'pil-dot-warn', 6); label(svg, p.sx(r.UCE) + 9, p.sy(r.IC) - 8, `Q（${r.region}）`, 'pil-label pil-strong');
      },
    },
    opamp: {
      compute: ({mode, R1, Rf, ui, Vsat}) => {
        const Au = mode === 'inverting' ? -Rf / R1 : 1 + Rf / R1, ideal = Au * ui, uo = clamp(ideal, -Vsat, Vsat), sat = Math.abs(ideal) > Vsat;
        return {formula: `${mode === 'inverting' ? 'A_u = −R_f / R₁' : 'A_u = 1 + R_f / R₁'} = ${num(Au, 4)}；u_O = A_u·u_I = ${num(Au, 4)} × ${fmt(ui, 'V')} = ${sat ? `${fmt(ideal, 'V')} → 限幅 ${fmt(uo, 'V')}` : fmt(uo, 'V')}`,
          readouts: [['电压放大倍数 A_u', num(Au, 4), true], ['输出 u_O', fmt(uo, 'V'), true], ['状态', sat ? '饱和（非线性区）' : '线性区']],
          hint: sat ? `理想输出超出 ±U_OM，运放进入饱和，只能输出 ${fmt(Math.sign(ideal) * Vsat, 'V')}；减小 u_I 或 R_f/R₁ 回到线性区。` : mode === 'inverting' ? `反相比例：虚短 u₋ ≈ u₊ = 0（虚地），虚断 i₋ ≈ 0，所以 u_O = −(R_f/R₁)u_I。` : `同相比例：u₋ ≈ u₊ = u_I，输入电阻很大；R_f = 0 时就是电压跟随器。`, Au, uo};
      },
      draw(svg, W, H, {mode, ui, Vsat}, r) {
        const wide = W >= 540, sw = wide ? 230 : 0;
        if (wide) {
          const x = 60, y = H / 2, tri = [[x + 60, y - 40], [x + 60, y + 40], [x + 130, y]];
          poly(svg, [...tri, tri[0]], 'pil-part'); label(svg, x + 68, y - 14, '−'); label(svg, x + 68, y + 22, '+');
          const inv = mode === 'inverting';
          resistor(svg, x - 40, y - 20, x + 60, y - 20, 'R₁'); if (!inv) line(svg, x - 40, y - 20, x - 40, y + 60);
          line(svg, x + 60, y + 20, inv ? x + 40 : x - 10, y + 20); if (inv) { line(svg, x + 40, y + 20, x + 40, y + 50); label(svg, x + 40, y + 64, '⏚', 'pil-label', 'middle'); } else label(svg, x - 14, y + 24, 'u_I', 'pil-label', 'end');
          if (inv) label(svg, x - 44, y - 16, 'u_I', 'pil-label', 'end'); else label(svg, x - 44, y + 74, '⏚', 'pil-label', 'middle');
          line(svg, x + 10, y - 20, x + 10, y - 66); resistor(svg, x + 10, y - 66, x + 160, y - 66, 'R_f'); line(svg, x + 160, y - 66, x + 160, y); line(svg, x + 130, y, x + 175, y);
          label(svg, x + 180, y + 4, 'u_O');
        }
        const p = frame(svg, [sw + 52, 22, W - sw - 70, H - 56], [-5, 5], [-Vsat * 1.15, Vsat * 1.15], {xlabel: 'u_I / V', ylabel: 'u_O / V'});
        p.curve(x => clamp(r.Au * x, -Vsat, Vsat), 'pil-curve'); dot(svg, p.sx(ui), p.sy(r.uo));
      },
    },
    limit: {
      compute: ({fn, d}) => {
        const L = {sinx: {f: x => Math.sin(x) / x, at: 'x → 0', to: 1, tex: 'sin x / x'}, e: {f: n => (1 + 1 / n) ** n, at: 'n → ∞', to: Math.E, tex: '(1 + 1/n)ⁿ'}, cos: {f: x => (1 - Math.cos(x)) / (x * x), at: 'x → 0', to: .5, tex: '(1 − cos x) / x²'}, exp: {f: x => (Math.exp(x) - 1) / x, at: 'x → 0', to: 1, tex: '(eˣ − 1) / x'}}[fn];
        const x = fn === 'e' ? 10 ** d : 10 ** -d, y = L.f(x);
        return {formula: `lim(${L.at}) ${L.tex} = ${fn === 'e' ? 'e ≈ 2.71828' : num(L.to)}；当前 ${fn === 'e' ? 'n' : 'x'} = ${num(x, 4)}，值 = ${y.toFixed(6)}`,
          readouts: [[fn === 'e' ? 'n' : 'x', num(x, 4)], ['函数值', y.toFixed(6), true], ['与极限相差', Math.abs(y - L.to).toExponential(2)]],
          hint: fn === 'e' ? `n 越大越接近 e，但永远到不了；这是“1^∞”型。` : `x 越靠近 0，值越靠近 ${num(L.to)}；在 0 处函数没有定义（空心点），极限只看“靠近”。`, L, x, y};
      },
      draw(svg, W, H, {fn, d}, r) {
        if (fn === 'e') {
          const p = frame(svg, [52, 22, W - 72, H - 56], [1, 1e4], [1.9, 2.85], {logx: true, xlabel: 'n'});
          p.curve(r.L.f, 'pil-curve', 1, 1e4); line(svg, 52, p.sy(Math.E), W - 20, p.sy(Math.E), 'pil-guide'); label(svg, W - 24, p.sy(Math.E) - 6, 'e', 'pil-label pil-b', 'end'); dot(svg, p.sx(r.x), p.sy(r.y));
          return;
        }
        const yr = fn === 'cos' ? [0, .7] : fn === 'exp' ? [0, 3.4] : [-.3, 1.2], p = frame(svg, [46, 22, W - 66, H - 56], [-3, 3], yr, {xlabel: 'x'});
        p.curve(r.L.f, 'pil-curve'); line(svg, 46, p.sy(r.L.to), W - 20, p.sy(r.L.to), 'pil-guide');
        svg.append(S('circle', {cx: p.sx(0), cy: p.sy(r.L.to), r: 5, class: 'pil-hollow'}));
        dot(svg, p.sx(r.x), p.sy(r.y)); dot(svg, p.sx(-r.x), p.sy(r.L.f(-r.x)), 'pil-dot-b', 4);
      },
    },
    derivative: {
      compute: ({fn, x0, h}) => {
        const g = F[fn], x = clamp(x0, g.dom[0] + .05, g.dom[1] - .05), y = g.f(x), k = g.d(x), hh = Math.max(h, 1e-6), ks = (g.f(x + hh) - y) / hh;
        const b = y - k * x;
        return {formula: `f(x) = ${g.tex}，f′(x) = ${g.dtex}，f′(${num(x, 3)}) = ${num(k, 4)}；割线斜率 [f(x₀+Δx) − f(x₀)] / Δx = ${num(ks, 4)}`,
          readouts: [['f(x₀)', num(y, 4)], ['切线斜率 f′(x₀)', num(k, 4), true], ['割线斜率', num(ks, 4)], ['切线方程', `y = ${num(k, 3)}x ${b < 0 ? '−' : '+'} ${num(Math.abs(b), 3)}`]],
          hint: `${h < .05 ? 'Δx 很小了：割线几乎和切线重合，这就是导数的定义。' : '把 Δx 拖向 0，看割线怎么变成切线。'}${Math.abs(k) < .02 ? ' f′(x₀) ≈ 0：这里可能是极值点。' : k > 0 ? ' f′(x₀) > 0：函数在这里单调递增。' : ' f′(x₀) < 0：函数在这里单调递减。'}`, g, x, y, k, ks};
      },
      draw(svg, W, H, {fn, h}, r) {
        const g = r.g, yr = range(g.f, ...g.dom), p = frame(svg, [46, 22, W - 66, H - 56], g.dom, yr, {xlabel: 'x'});
        // 单调区间：f′ > 0 涂一层，f′ < 0 另一层。
        const N = 120; for (let i = 0; i < N; i++) { const a = g.dom[0] + (g.dom[1] - g.dom[0]) * i / N, b = g.dom[0] + (g.dom[1] - g.dom[0]) * (i + 1) / N, s = g.d((a + b) / 2); svg.append(S('rect', {x: p.sx(a), y: H - 38, width: p.sx(b) - p.sx(a) + .5, height: 4, class: s > 0 ? 'pil-up' : 'pil-down'})); }
        p.curve(g.f, 'pil-curve');
        p.curve(t => r.y + r.k * (t - r.x), 'pil-tangent');
        if (h > .01) { const x2 = r.x + h; p.curve(t => r.y + r.ks * (t - r.x), 'pil-secant'); dot(svg, p.sx(x2), p.sy(g.f(x2)), 'pil-dot-b', 4); }
        dot(svg, p.sx(r.x), p.sy(r.y));
        label(svg, 52, 36, '切线', 'pil-label pil-a'); label(svg, 88, 36, '割线', 'pil-label pil-b'); label(svg, W - 24, H - 42, '底部色条：增 / 减', 'pil-tick', 'end');
      },
    },
    integral: {
      compute: ({fn, a, b, n, method}) => {
        const g = F[fn], lo = Math.max(Math.min(a, b), g.dom[0]), hi = Math.min(Math.max(a, b), g.dom[1]), sign = a <= b ? 1 : -1, dx = (hi - lo) / n;
        let sum = 0; for (let i = 0; i < n; i++) sum += g.f(lo + dx * (i + (method === 'left' ? 0 : method === 'right' ? 1 : .5))) * dx;
        const exact = (g.F(hi) - g.F(lo)) * sign; sum *= sign;
        return {formula: `∫ ${num(a)}→${num(b)} ${g.tex} dx = [${g.Ftex}] = ${num(exact, 5)}`,
          readouts: [['黎曼和', num(sum, 5)], ['精确值', num(exact, 5), true], ['误差', num(Math.abs(sum - exact), 3)], ['每段宽 Δx', num(dx, 3)]],
          hint: `${n >= 40 ? '分得越细，矩形面积之和越接近定积分。' : '把 n 拖大：矩形越窄，和越接近精确值。'}${g.f((lo + hi) / 2) < 0 || fn === 'sin' || fn === 'x3' ? ' x 轴下方的面积算负值。' : ''}${a > b ? ' 上限小于下限，积分变号。' : ''}`, g, lo, hi, dx};
      },
      draw(svg, W, H, {n, method}, r) {
        const g = r.g, yr = range(g.f, ...g.dom); yr[0] = Math.min(yr[0], 0); yr[1] = Math.max(yr[1], 0);
        const p = frame(svg, [46, 22, W - 66, H - 56], g.dom, yr, {xlabel: 'x'});
        for (let i = 0; i < n; i++) {
          const x = r.lo + r.dx * i, y = g.f(r.lo + r.dx * (i + (method === 'left' ? 0 : method === 'right' ? 1 : .5)));
          svg.append(S('rect', {x: p.sx(x), y: Math.min(p.sy(y), p.sy(0)), width: Math.max(.5, p.sx(x + r.dx) - p.sx(x)), height: Math.abs(p.sy(y) - p.sy(0)), class: y >= 0 ? 'pil-area' : 'pil-area-neg'}));
        }
        p.curve(g.f, 'pil-curve');
        for (const x of [r.lo, r.hi]) line(svg, p.sx(x), 22, p.sx(x), H - 34, 'pil-guide');
      },
    },
    ode: {
      compute: ({k, y0}) => ({formula: `dy/dx = ky → 分离变量 dy/y = k dx → y = y(0)·e^(kx) = ${num(y0)}·e^(${num(k)}x)`,
        readouts: [['y(1)', num(y0 * exp(k), 4), true], ['y(2)', num(y0 * exp(2 * k), 4)], ['性质', k > 0 ? '指数增长' : k < 0 ? '指数衰减' : '常数']],
        hint: `每个小线段是该点的斜率 ky；解曲线处处沿着线段走。初值不同得到不同的特解，合起来是通解 y = Ce^(kx)。`}),
      draw(svg, W, H, {k, y0}) {
        const p = frame(svg, [46, 22, W - 66, H - 56], [-3, 3], [-4, 4], {xlabel: 'x'});
        for (let x = -2.75; x <= 2.8; x += .5) for (let y = -3.5; y <= 3.6; y += .7) {
          const s = k * y, len = 9, ang = Math.atan(s * (p.sy(0) - p.sy(1)) / (p.sx(1) - p.sx(0)));
          line(svg, p.sx(x) - len * Math.cos(ang), p.sy(y) + len * Math.sin(ang), p.sx(x) + len * Math.cos(ang), p.sy(y) - len * Math.sin(ang), 'pil-field');
        }
        p.curve(x => y0 * exp(k * x), 'pil-curve'); dot(svg, p.sx(0), p.sy(y0));
      },
    },
    subnet: {
      compute: ({ip, prefix}) => {
        const n = ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0), mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
        const net = (n & mask) >>> 0, bc = (net | ~mask) >>> 0, dotted = x => [24, 16, 8, 0].map(s => (x >>> s) & 255).join('.'), hosts = 2 ** (32 - prefix) - 2;
        return {formula: `网络地址 = IP AND 掩码 = ${ip} AND ${dotted(mask)} = ${dotted(net)}`,
          readouts: [['子网掩码', dotted(mask), true], ['网络地址', dotted(net), true], ['广播地址', dotted(bc)], ['可用主机', `${dotted(net + 1)} – ${dotted(bc - 1)}`], ['可用主机数', `2^${32 - prefix} − 2 = ${hosts}`, true], ['地址块大小', String(2 ** (32 - prefix))]],
          hint: `/${prefix}：前 ${prefix} 位是网络号，后 ${32 - prefix} 位是主机号；主机位全 0 是网络地址、全 1 是广播地址，都不能分给主机。`, n, mask, net};
      },
      draw(svg, W, H, {prefix}, r) {
        // 宽屏一行 32 位；窄屏拆成两行，每行 16 位，保证每一位都看得清。
        const per = W < 560 ? 16 : 32, lines = 32 / per, rows = [['IP', r.n], ['掩码', r.mask], ['网络', r.net]], left = 44, cell = (W - left - 14 - (per / 8 - 1) * 6) / per, top = 26, rowH = 30, block = rows.length * rowH + 12;
        const at = i => { const k = i % per; return left + k * cell + Math.floor(k / 8) * 6; };
        for (let part = 0; part < lines; part++) rows.forEach(([name, value], row) => {
          const y = top + part * block + row * rowH; label(svg, left - 6, y + 16, name, 'pil-tick', 'end');
          for (let i = part * per; i < (part + 1) * per; i++) {
            const x = at(i), bit = (value >>> (31 - i)) & 1;
            svg.append(S('rect', {x, y, width: cell - 1.5, height: 22, rx: 3, class: i < prefix ? 'pil-bit-net' : 'pil-bit-host'}));
            if (cell >= 9) label(svg, x + (cell - 1.5) / 2, y + 15, bit, 'pil-bit', 'middle');
          }
        });
        const part = Math.floor(Math.min(prefix, 31.5) / per), within = prefix - part * per, split = within === per ? at(per - 1) + cell - .75 : at(part * per + within) - (within % 8 === 0 && within ? 3.75 : .75);
        line(svg, split, top + part * block - 8, split, top + part * block + rows.length * rowH - 6, 'pil-split'); label(svg, split, top + part * block - 12, `/${prefix}`, 'pil-label pil-strong', 'middle');
        label(svg, left, H - 6, '■ 网络号', 'pil-tick pil-a'); label(svg, left + 70, H - 6, '■ 主机号', 'pil-tick pil-b');
      },
    },
  };
  function transient(svg, W, H, shape, k, scale, name, unit, other, otherName) {
    const p = frame(svg, [52, 22, W - 72, H - 56], [0, 5], [other(0) < 0 ? -1.1 : 0, 1.1], {xlabel: 't', xticks: [0, 1, 2, 3, 4, 5].map(m => [m, m ? `${m}τ` : '0']), yticks: [[0, '0'], [1, fmt(scale, unit)], [.632, '63.2%'], ...(other(0) < 0 ? [[-1, '−']] : [])]});
    p.curve(other, 'pil-curve-faint'); p.curve(shape, 'pil-curve');
    line(svg, p.sx(k), 22, p.sx(k), H - 34, 'pil-guide'); dot(svg, p.sx(k), p.sy(shape(k)));
    label(svg, 58, 38, name, 'pil-label pil-a'); label(svg, 58, 54, `${otherName}（浅色）`, 'pil-tick');
  }

  // ---------- 渲染 ----------
  function slider(entry, value, onInput) {
    const wrap = E('label', 'pil-control'), head = E('span', 'pil-control-head'), out = E('output', 'pil-control-value');
    head.append(rich(E('span'), entry.label), out); wrap.append(head);
    if (entry.options) {
      const group = E('div', 'pil-segmented'); group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-label', entry.label);
      for (const [optionValue, text] of entry.options) {
        const b = E('button', 'pil-seg', text); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(optionValue === value));
        b.addEventListener('click', () => { for (const other of group.children) other.setAttribute('aria-checked', String(other === b)); onInput(optionValue); });
        group.append(b);
      }
      head.lastChild.remove(); wrap.append(group); return {wrap, set() {}};
    }
    if (entry.type === 'text') {
      const input = E('input', 'pil-text'); input.value = value; input.spellcheck = false; input.setAttribute('aria-label', entry.label);
      input.addEventListener('change', () => onInput(input.value.trim(), input)); head.lastChild.remove(); wrap.append(input); return {wrap, set() {}};
    }
    const input = E('input', 'pil-range'); input.type = 'range'; input.setAttribute('aria-label', entry.label);
    const toPos = x => entry.log ? Math.round(1000 * Math.log(x / entry.min) / Math.log(entry.max / entry.min)) : x;
    const fromPos = p => entry.log ? sig(entry.min * (entry.max / entry.min) ** (p / 1000), 3) : Number(p);
    if (entry.log) { input.min = 0; input.max = 1000; input.step = 1; } else { input.min = entry.min; input.max = entry.max; input.step = entry.step || 'any'; }
    const show = x => { out.textContent = FACTOR[entry.unit] ? fmt(x * FACTOR[entry.unit], BASE[entry.unit]) : entry.unit ? fmt(x, entry.unit) : num(x); };
    input.value = toPos(value); show(value);
    input.addEventListener('input', () => { const x = fromPos(input.value); show(x); onInput(x); });
    wrap.append(input);
    return {wrap, set(x) { input.value = toPos(x); show(x); }};
  }
  function readouts(host, rows) {
    host.replaceChildren(...rows.map(([name, value, strong]) => { const chip = E('div', strong ? 'pil-readout pil-readout-strong' : 'pil-readout'); chip.append(rich(E('span'), name), rich(E('b'), value)); return chip; }));
  }
  function askButton(view, h, describe) {
    return h.button('问碧琪', async () => {
      try {
        if (!await view.flush()) return;
        await h.call('chat.send', {sessionKey: view.ref.sessionKey, idempotencyKey: h.uid(), message: `请结合我现在的实验状态讲一讲。\nactivity_id: ${view.ref.id}\n${describe()}\n按实际参数解释为什么是这个结果；拖动参数只算操作，不算掌握。`});
        view.say('已把当前状态交给碧琪');
      } catch (error) { view.say(error.message || '暂时无法发送问题'); }
    }, 'pinkie-il-quiet pil-ask');
  }
  function figureLoop(view, figure, paint) {
    view.draw = () => {
      if (!view.loaded || !view.visible || !view.expanded || view.disposed) return;
      const W = Math.max(280, Math.floor(figure.clientWidth || 560));
      paint(W);
    };
    if (typeof ResizeObserver === 'function') { let last = 0; view.resize = new ResizeObserver(() => { const w = Math.floor(figure.clientWidth); if (w && w !== last) { last = w; view.scheduleDraw(); } }); view.resize.observe(figure); }
  }

  function renderConcept(view, h) {
    const record = view.data.visual, d = record.definition, concept = CONCEPTS[d.concept];
    if (!concept) { view.body.append(E('p', 'pinkie-il-error', '这个实验需要更新碧琪后才能显示')); return; }
    const root = E('div', 'pil-x'), formula = E('div', 'pil-formula'), figure = E('div', 'pil-figure'), stats = E('div', 'pil-readouts'), hint = E('p', 'pil-hint'), controls = E('div', 'pil-controls');
    formula.setAttribute('aria-live', 'off'); hint.setAttribute('aria-live', 'polite');
    root.append(formula, figure, stats, hint, controls); view.body.append(root);
    const values = () => Object.fromEntries(d.vars.map(entry => { const raw = record.state.values[entry.key]; return [entry.key, FACTOR[entry.unit] ? raw * FACTOR[entry.unit] : raw]; }));
    for (const entry of d.vars) {
      const control = slider(entry, record.state.values[entry.key], (value, input) => {
        if (entry.type === 'text' && !/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(value)) { view.say('请输入有效的 IPv4 地址，例如 192.168.10.34', true); if (input) input.value = record.state.values[entry.key]; return; }
        view.data.visual.state.values[entry.key] = value; view.enqueue('visual', {state: {values: {[entry.key]: value}}}); view.scheduleDraw();
      });
      controls.append(control.wrap);
    }
    figureLoop(view, figure, W => {
      const v = values(), r = concept.compute(v), H = d.concept === 'subnet' ? (W < 560 ? 250 : 140) : W < 480 && d.concept === 'ohm' ? 420 : 250;
      rich(formula, r.formula); readouts(stats, r.readouts); rich(hint, `注意看：${r.hint}`);
      const svg = svgBox(W, H); svg.setAttribute('aria-label', `${record.title}：${r.formula}`);
      concept.draw(svg, W, H, v, r); figure.replaceChildren(svg);
    });
    root.append(askButton(view, h, () => `实验：${record.title}（${d.concept}）\n参数：${JSON.stringify(view.data.visual.state.values)}\n当前结果：${concept.compute(values()).readouts.map(([a, b]) => `${a}=${b}`).join('，')}`));
    view.draw();
  }

  // ---------- 逻辑函数 ----------
  const evalTree = (node, env) => node.op === 'var' ? env[node.name] : node.op === 'const' ? node.value : node.op === 'not' ? 1 - evalTree(node.args[0], env)
    : node.op === 'and' ? (node.args.every(a => evalTree(a, env)) ? 1 : 0) : node.op === 'or' ? (node.args.some(a => evalTree(a, env)) ? 1 : 0) : node.args.reduce((acc, a) => acc ^ evalTree(a, env), 0);
  function literal(term) {
    const span = E('span', 'pil-sop');
    if (!term.length) { span.textContent = '1'; return span; }
    for (const {v, neg} of term) { const s = E('span', neg ? 'pil-bar' : '', v); span.append(s); }
    return span;
  }
  const GRAY = [[0], [0, 1], [0, 1, 3, 2]];
  function renderLogic(view, h) {
    const record = view.data.visual, d = record.definition, state = record.state, vars = d.variables, n = vars.length;
    const root = E('div', 'pil-x'), formula = E('div', 'pil-formula'), switches = E('div', 'pil-switches'), tabs = E('div', 'pil-segmented pil-tabs'), panel = E('div', 'pil-figure'), hint = E('p', 'pil-hint');
    const sop = E('div', 'pil-readouts');
    root.append(formula, switches, tabs, panel, sop, hint); view.body.append(root);
    formula.textContent = `Y = ${d.expression}`;
    const chip = E('div', 'pil-readout pil-readout-strong'); chip.append(E('span', '', '最简与或式')); const expr = E('b'); expr.append('Y = ');
    if (!d.sop.length) expr.append('0'); else d.sop.forEach((term, i) => { if (i) expr.append(' + '); expr.append(literal(term)); });
    chip.append(expr); sop.append(chip);
    const ones = d.outputs.flatMap((o, m) => o ? [m] : []); const mchip = E('div', 'pil-readout'); mchip.append(E('span', '', '最小项'), E('b', '', ones.length ? `Σm(${ones.join(', ')})` : '无')); sop.append(mchip);
    const lamp = E('div', 'pil-lamp');
    const paint = () => {
      const env = state.inputs, m = vars.reduce((acc, name) => acc * 2 + env[name], 0), y = evalTree(d.tree, env);
      for (const b of switches.querySelectorAll('button[data-var]')) { const on = env[b.dataset.var] === 1; b.setAttribute('aria-pressed', String(on)); b.querySelector('b').textContent = on ? '1' : '0'; }
      lamp.dataset.on = String(y === 1); lamp.lastChild.textContent = String(y);
      hint.textContent = `注意看：输入 ${vars.map(name => `${name}=${env[name]}`).join('、')} 是第 ${m} 号最小项 m${m}，输出 Y=${y}。${state.view === 'kmap' ? '卡诺图里相邻格只差一个变量，圈越大消去的变量越多。' : state.view === 'gates' ? '亮色导线是 1，灰色是 0。' : '点上面的开关切换输入，对应行会高亮。'}`;
      panel.replaceChildren(state.view === 'kmap' ? kmap(d, m) : state.view === 'gates' ? gates(d, env, panel.clientWidth || 520) : truthTable(d, m));
    };
    for (const name of vars) {
      const b = E('button', 'pil-switch'); b.type = 'button'; b.dataset.var = name; b.append(E('span', '', name), E('b', '', '0')); b.setAttribute('aria-label', `输入 ${name}`);
      b.addEventListener('click', () => { state.inputs[name] = 1 - state.inputs[name]; view.enqueue('visual', {state: {inputs: {[name]: state.inputs[name]}}}); paint(); });
      switches.append(b);
    }
    lamp.append(E('span', '', 'Y'), E('b', '', '0')); switches.append(E('span', 'pil-arrow', '→'), lamp);
    for (const [key, text] of [['table', '真值表'], ['kmap', '卡诺图'], ['gates', '逻辑图']]) {
      const b = E('button', 'pil-seg', text); b.type = 'button'; b.setAttribute('aria-checked', String(state.view === key)); b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { state.view = key; for (const other of tabs.children) other.setAttribute('aria-checked', String(other === b)); view.enqueue('visual', {state: {view: key}}); paint(); });
      tabs.append(b);
    }
    tabs.setAttribute('role', 'radiogroup'); tabs.setAttribute('aria-label', '视图');
    view.draw = paint; root.append(askButton(view, h, () => `逻辑函数 Y = ${d.expression}\n当前输入：${JSON.stringify(state.inputs)}，视图：${state.view}`));
    paint();
  }
  function truthTable(d, current) {
    const wrap = E('div', 'pil-table-wrap'), table = E('table', d.variables.length >= 4 ? 'pil-table pil-table-compact' : 'pil-table'), head = E('tr');
    for (const name of [...d.variables, 'Y']) head.append(E('th', '', name)); head.prepend(E('th', 'pil-muted', 'm'));
    table.append(head);
    d.outputs.forEach((y, m) => {
      const row = E('tr'); if (m === current) row.className = 'pil-row-current';
      row.append(E('td', 'pil-muted', m)); d.variables.forEach((_, i) => row.append(E('td', '', (m >> (d.variables.length - 1 - i)) & 1)));
      const out = E('td', y ? 'pil-one' : '', y); row.append(out); table.append(row);
    });
    wrap.append(table); return wrap;
  }
  function kmap(d, current) {
    const vars = d.variables, n = vars.length, rowsVars = vars.slice(0, Math.floor(n / 2)), colVars = vars.slice(Math.floor(n / 2));
    const rows = GRAY[rowsVars.length], cols = GRAY[colVars.length], wrap = E('div', 'pil-table-wrap'), table = E('table', 'pil-kmap');
    const bits = (value, width) => width ? value.toString(2).padStart(width, '0') : '';
    const head = E('tr'); head.append(E('th', 'pil-muted', `${rowsVars.join('') || ' '}\\${colVars.join('')}`)); for (const c of cols) head.append(E('th', '', bits(c, colVars.length))); table.append(head);
    const groups = d.sop.map(term => d.outputs.flatMap((_, m) => term.every(({v, neg}) => ((m >> (n - 1 - vars.indexOf(v))) & 1) === (neg ? 0 : 1)) ? [m] : []));
    for (const r of rows) {
      const tr = E('tr'); tr.append(E('th', '', bits(r, rowsVars.length) || '—'));
      for (const c of cols) {
        const m = (r << colVars.length) | c, cell = E('td', d.outputs[m] ? 'pil-one' : '', d.outputs[m]);
        const inGroups = groups.flatMap((g, i) => g.includes(m) ? [i] : []);
        if (inGroups.length) { cell.dataset.group = String(inGroups[0] % 4); cell.style.setProperty('--rings', inGroups.length); }
        if (m === current) cell.classList.add('pil-cell-current'); cell.append(E('small', '', `m${m}`)); tr.append(cell);
      }
      table.append(tr);
    }
    wrap.append(table); if (groups.length) { const legend = E('div', 'pil-kmap-legend'); d.sop.forEach((term, i) => { const item = E('span', 'pil-kmap-key'); item.dataset.group = String(i % 4); item.append(literal(term)); legend.append(item); }); wrap.append(legend); }
    return wrap;
  }
  function gates(d, env, width) {
    // 国标矩形门：与 &，或 ≥1，非 1（输出带圈），异或 =1。从右往左按树深度排列。
    const depth = node => node.args ? 1 + Math.max(...node.args.map(depth)) : 0, leaves = node => node.args ? node.args.reduce((s, a) => s + leaves(a), 0) : 1;
    const D = depth(d.tree), rowsCount = leaves(d.tree), W = Math.max(300, width), colW = (W - 90) / Math.max(1, D), rowH = 34, H = Math.max(120, rowsCount * rowH + 24);
    const svg = svgBox(W, H); let next = 0; const inputs = new Map();
    const place = (node, level) => {
      if (!node.args) { const y = 18 + (next++ + .5) * rowH; return {x: 50, y, value: evalTree(node, env), text: node.op === 'var' ? node.name : String(node.value)}; }
      const kids = node.args.map(arg => place(arg, level + 1)), x = 50 + (D - level) * colW, y = kids.reduce((s, k) => s + k.y, 0) / kids.length, value = evalTree(node, env), gh = Math.max(28, kids.length * 18), gx = x - 34;
      kids.forEach((k, i) => { const iy = node.args.length === 1 ? y : y - gh / 2 + gh * (i + .5) / kids.length, mid = (k.x + gx) / 2; poly(svg, [[k.x, k.y], [mid, k.y], [mid, iy], [gx, iy]], k.value ? 'pil-wire-on' : 'pil-wire-off'); });
      svg.append(S('rect', {x: gx, y: y - gh / 2, width: 30, height: gh, rx: 3, class: 'pil-gate'}));
      label(svg, gx + 15, y + 4, {and: '&', or: '≥1', not: '1', xor: '=1'}[node.op], 'pil-gate-text', 'middle');
      if (node.op === 'not') svg.append(S('circle', {cx: gx + 34, cy: y, r: 4, class: 'pil-gate'}));
      return {x: gx + (node.op === 'not' ? 38 : 30), y, value};
    };
    const out = place(d.tree, 0);
    line(svg, out.x, out.y, W - 30, out.y, out.value ? 'pil-wire-on' : 'pil-wire-off'); label(svg, W - 26, out.y + 4, `Y=${out.value}`, 'pil-label pil-strong');
    svg.querySelectorAll('*'); // 保持顺序：先画线后画门
    let row = 0; const walk = node => { if (node.args) return node.args.forEach(walk); const y = 18 + (row++ + .5) * rowH, value = evalTree(node, env); label(svg, 40, y + 4, `${node.op === 'var' ? node.name : node.value}=${value}`, value ? 'pil-label pil-a' : 'pil-tick', 'end'); }; walk(d.tree);
    void inputs; return svg;
  }

  // ---------- 时序 ----------
  const EQUATION = {d: 'Qⁿ⁺¹ = D', jk: 'Qⁿ⁺¹ = J·Q̄ⁿ + K̄·Qⁿ', t: 'Qⁿ⁺¹ = T ⊕ Qⁿ', rs: 'Qⁿ⁺¹ = S + R̄·Qⁿ（约束 SR = 0）'};
  function wave(def, state) {
    const {device, clocks, bits, direction} = def;
    if (device === 'counter') { const size = 1 << bits; return Array.from({length: clocks + 1}, (_, i) => direction === 'up' ? i % size : (size - i % size) % size); }
    const q = [state.q0];
    for (let i = 0; i < clocks; i++) {
      const p = q[i], x = name => state.inputs[name][i];
      q.push(device === 'd' ? x('D') : device === 't' ? (x('T') ? 1 - p : p) : device === 'jk' ? (x('J') && x('K') ? 1 - p : x('J') ? 1 : x('K') ? 0 : p) : (x('S') && x('R') ? p : x('S') ? 1 : x('R') ? 0 : p));
    }
    return q;
  }
  function renderTiming(view, h) {
    const record = view.data.visual, d = record.definition, state = record.state;
    const root = E('div', 'pil-x'), formula = E('div', 'pil-formula'), figure = E('div', 'pil-figure'), stats = E('div', 'pil-readouts'), hint = E('p', 'pil-hint'), controls = E('div', 'pil-controls');
    root.append(formula, figure, stats, hint, controls); view.body.append(root);
    formula.textContent = d.device === 'counter' ? `${d.bits} 位${d.direction === 'up' ? '加法' : '减法'}计数器：每个${d.edge === 'rising' ? '上升沿' : '下降沿'}计 1，模 ${1 << d.bits}` : `${d.name}特性方程：${EQUATION[d.device]}，${d.edge === 'rising' ? '上升沿' : '下降沿'}触发`;
    if (d.device !== 'counter') {
      const q0 = E('button', 'pinkie-il-button pil-inline-button', ''); q0.type = 'button';
      const sync = () => { q0.textContent = `初态 Q = ${state.q0}（点击切换）`; };
      q0.addEventListener('click', () => { state.q0 = 1 - state.q0; sync(); view.enqueue('visual', {state: {q0: state.q0}}); view.scheduleDraw(); }); sync(); controls.append(q0);
    }
    figureLoop(view, figure, W => {
      const q = wave(d, state), rows = d.device === 'counter' ? d.bits : d.inputNames.length + 1, left = 46, P = (W - left - 14) / d.clocks, rowH = 40, H = 30 + (rows + 1) * rowH;
      const svg = svgBox(W, H), rise = d.edge === 'rising';
      const level = (y, v) => y + (v ? 6 : rowH - 14);
      // 时钟
      let path = `M${left},${level(10, rise ? 0 : 1)}`;
      for (let i = 0; i < d.clocks; i++) { const x = left + i * P, a = rise ? 0 : 1; path += ` L${x + P / 2},${level(10, a)} L${x + P / 2},${level(10, 1 - a)} L${x + P},${level(10, 1 - a)} L${x + P},${level(10, a)}`; }
      svg.append(S('path', {d: path, class: 'pil-wave-clk'})); label(svg, left - 8, 10 + rowH / 2 + 2, 'CP', 'pil-tick', 'end');
      for (let i = 0; i < d.clocks; i++) {
        const x = left + i * P + P / 2; line(svg, x, 4, x, H - 6, i === state.cursor ? 'pil-edge-current' : 'pil-edge');
        svg.append(S('path', {d: `M${x - 4},${rise ? 16 : 26} L${x},${rise ? 10 : 32} L${x + 4},${rise ? 16 : 26}`, class: 'pil-wave-clk'}));
        label(svg, x, H - 2, i + 1, 'pil-tick', 'middle');
      }
      const drawBits = (y, values, cls, clickable, name) => {
        let d2 = '';
        values.forEach((v, i) => { const x = left + i * P; d2 += `${i ? 'L' : 'M'}${x},${level(y, v)} L${x + P},${level(y, v)}`; });
        svg.append(S('path', {d: d2, class: cls}));
        if (clickable) values.forEach((v, i) => {
          const hit = S('rect', {x: left + i * P + 1, y: y + 2, width: P - 2, height: rowH - 6, class: 'pil-hit', tabindex: 0, role: 'button', 'aria-label': `${name} 第 ${i + 1} 个周期 = ${v}，点击切换`});
          const toggle = () => { state.inputs[name][i] = 1 - state.inputs[name][i]; state.cursor = i; view.enqueue('visual', {state: {inputs: {[name]: state.inputs[name]}, cursor: i}}); view.scheduleDraw(); };
          hit.addEventListener('click', toggle); hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
          svg.append(hit); label(svg, left + i * P + P / 4, y + rowH / 2 + 3, v, 'pil-bit-label', 'middle');
        });
      };
      let y = 10 + rowH;
      if (d.device === 'counter') {
        for (let b = 0; b < d.bits; b++) {
          const values = Array.from({length: d.clocks}, (_, i) => { const before = q[i], after = q[i + 1]; return [(before >> b) & 1, (after >> b) & 1]; });
          let p2 = ''; values.forEach(([a, c], i) => { const x = left + i * P; p2 += `${i ? 'L' : 'M'}${x},${level(y, a)} L${x + P / 2},${level(y, a)} L${x + P / 2},${level(y, c)} L${x + P},${level(y, c)}`; });
          svg.append(S('path', {d: p2, class: 'pil-wave-q'})); label(svg, left - 8, y + rowH / 2 + 2, `Q${b}`, 'pil-tick', 'end'); y += rowH;
        }
        q.slice(1).forEach((v, i) => label(svg, left + i * P + P * .75, y + 14, v, 'pil-label pil-strong', 'middle'));
      } else {
        for (const name of d.inputNames) { drawBits(y, state.inputs[name], 'pil-wave-in', true, name); label(svg, left - 8, y + rowH / 2 + 2, name, 'pil-tick', 'end'); y += rowH; }
        let p2 = `M${left},${level(y, q[0])}`; for (let i = 0; i < d.clocks; i++) { const x = left + i * P + P / 2; p2 += ` L${x},${level(y, q[i])} L${x},${level(y, q[i + 1])} L${left + (i + 1) * P},${level(y, q[i + 1])}`; }
        svg.append(S('path', {d: p2, class: 'pil-wave-q'})); label(svg, left - 8, y + rowH / 2 + 2, 'Q', 'pil-tick pil-strong', 'end');
      }
      figure.replaceChildren(svg);
      const i = state.cursor;
      if (d.device === 'counter') { readouts(stats, [['第 ' + (i + 1) + ' 个脉冲后', `${q[i + 1].toString(2).padStart(d.bits, '0')}₂ = ${q[i + 1]}`, true], ['模', String(1 << d.bits)]]); hint.textContent = `注意看：Q0 每个脉冲翻转一次，Q1 每 2 个、Q2 每 4 个——高位是低位的二分频。`; }
      else {
        const x = name => state.inputs[name][i], inputsText = d.inputNames.map(name => `${name}=${x(name)}`).join('、');
        const rsBad = d.device === 'rs' && state.inputs.S.some((s, k) => s && state.inputs.R[k]);
        readouts(stats, [[`第 ${i + 1} 个${rise ? '上升沿' : '下降沿'}前`, `${inputsText}，Qⁿ=${q[i]}`], ['沿后 Qⁿ⁺¹', String(q[i + 1]), true]]);
        hint.textContent = rsBad ? '注意看：出现了 S=R=1，同步 RS 触发器的约束 SR=0 被违反，触发后状态不定（这里按保持画）。' : `注意看：Q 只在${rise ? '上升沿' : '下降沿'}（竖线处）按特性方程更新，两个沿之间输入怎么变都不影响 Q。点输入波形的格子可以翻转 0/1。`;
      }
    });
    root.append(askButton(view, h, () => `时序实验：${d.name}，${d.edge}\n输入：${JSON.stringify(state.inputs)}，初态 ${state.q0}\nQ 序列：${wave(d, state).join('')}`));
    view.draw();
  }

  // ---------- 协议时序图 ----------
  const fill = (text, seeds) => text.replace(/\{(\w)(?:\+(\d))?\}/g, (_, name, add) => String((seeds[name] ?? 0) + Number(add || 0)));
  function renderSequence(view, h) {
    const record = view.data.visual, d = record.definition, state = record.state;
    const root = E('div', 'pil-x'), figure = E('div', 'pil-figure'), detail = E('div', 'pil-detail'), nav = E('div', 'pil-nav'), controls = E('div', 'pil-controls');
    root.append(figure, detail, nav, controls); view.body.append(root);
    let timer = 0;
    const go = step => { state.step = clamp(step, 0, d.messages.length); view.enqueue('visual', {state: {step: state.step}}); view.scheduleDraw(); };
    const prev = h.button('上一步', () => go(state.step - 1)), next = h.button('下一步', () => go(state.step + 1), 'pinkie-il-primary'), play = h.button('自动播放', () => {
      if (timer) { clearInterval(timer); timer = 0; play.textContent = '自动播放'; return; }
      if (state.step >= d.messages.length) go(0);
      play.textContent = '暂停'; timer = setInterval(() => { if (!view.element.isConnected || state.step >= d.messages.length) { clearInterval(timer); timer = 0; play.textContent = '重新播放'; return; } go(state.step + 1); }, 1300);
    });
    const counter = E('span', 'pil-tick'); nav.append(prev, counter, next, play);
    view.stopTimer = () => { clearInterval(timer); timer = 0; };
    for (const name of Object.keys(d.seeds || {})) {
      const wrap = E('label', 'pil-control'), input = E('input', 'pil-text'); input.type = 'number'; input.min = 0; input.value = state.seeds[name];
      wrap.append(E('span', 'pil-control-head', `初始序号 ${name}（${name === 'x' ? d.actors[0] : d.actors[1]}）`), input);
      input.addEventListener('change', () => { const value = Math.floor(Number(input.value)); if (!Number.isInteger(value) || value < 0) { input.value = state.seeds[name]; return; } state.seeds[name] = value; view.enqueue('visual', {state: {seeds: {[name]: value}}}); view.scheduleDraw(); });
      controls.append(wrap);
    }
    figureLoop(view, figure, W => {
      const n = d.actors.length, top = 40, gap = 46, H = top + d.messages.length * gap + 40, xs = d.actors.map((_, i) => 16 + (W - 32) * (i + .5) / n), svg = svgBox(W, H);
      d.actors.forEach((actor, i) => {
        const w = Math.min((W - 32) / n - 8, 120); svg.append(S('rect', {x: xs[i] - w / 2, y: 6, width: w, height: 24, rx: 6, class: 'pil-actor'})); label(svg, xs[i], 22, actor, 'pil-label pil-strong', 'middle');
        line(svg, xs[i], 30, xs[i], H - 8, 'pil-lifeline');
      });
      d.messages.forEach((m, i) => {
        const y = top + (i + .7) * gap, shown = i < state.step, current = i === state.step - 1, x1 = xs[m.from], x2 = xs[m.to], dir = Math.sign(x2 - x1);
        const g = S('g', {class: shown ? current ? 'pil-msg pil-msg-current' : 'pil-msg' : 'pil-msg pil-msg-future'});
        g.append(S('line', {x1, y1: y - 10, x2: x2 - dir * 2, y2: y + 6, class: 'pil-msg-line'}));
        g.append(S('path', {d: `M${x2},${y + 6} l${-dir * 9},${-6} l${dir * 1},${8} z`, class: 'pil-msg-head'}));
        if (shown) g.append(S('text', {x: (x1 + x2) / 2, y: y - 14, 'text-anchor': 'middle', class: 'pil-msg-text'}, fill(m.label, state.seeds)));
        else g.append(S('text', {x: (x1 + x2) / 2, y: y - 14, 'text-anchor': 'middle', class: 'pil-msg-text'}, `第 ${i + 1} 步`));
        svg.append(g);
        if (shown && m.states && W >= 420) m.states.forEach((s, k) => { if (s) label(svg, xs[k] + (k === 0 ? -6 : 6), y + 18, s, 'pil-state', k === 0 ? 'end' : 'start'); });
      });
      if (d.start?.some(Boolean) && W >= 420) d.start.forEach((s, k) => { if (s) label(svg, xs[k] + (k === 0 ? -6 : 6), top + 2, s, 'pil-state', k === 0 ? 'end' : 'start'); });
      figure.replaceChildren(svg);
      counter.textContent = `${state.step} / ${d.messages.length}`; prev.disabled = state.step <= 0; next.disabled = state.step >= d.messages.length;
      const m = d.messages[state.step - 1];
      detail.replaceChildren();
      if (m) { detail.append(E('strong', '', `第 ${state.step} 步：${d.actors[m.from]} → ${d.actors[m.to]}  ${fill(m.label, state.seeds)}`)); if (m.detail) detail.append(E('p', '', m.detail)); }
      else detail.append(E('p', 'pil-hint', '点“下一步”或“自动播放”，一条一条看报文怎么走。'));
      if (state.step >= d.messages.length && d.why) detail.append(E('p', 'pil-keypoint', d.why));
    });
    root.append(askButton(view, h, () => `时序图：${record.title}\n当前第 ${state.step}/${d.messages.length} 步${d.seeds && Object.keys(d.seeds).length ? `，初始序号 ${JSON.stringify(state.seeds)}` : ''}`));
    view.draw();
  }

  function render(view, h) {
    const kind = view.data.visual.kind;
    if (kind === 'concept_lab') renderConcept(view, h);
    else if (kind === 'logic_lab') renderLogic(view, h);
    else if (kind === 'timing_lab') renderTiming(view, h);
    else renderSequence(view, h);
  }
  function cleanup(view) { view.stopTimer?.(); view.stopTimer = null; }
  window.__pinkieLearningExplore = {kinds, render, cleanup, fmt, wave, CONCEPTS};
})();
