/* 碧琪上岸记 · 形态签名特效（11-08 验收）。
 * 用户：「每个形态都要独立独特的特效（新颖独特）」。9 种大招构图是骨架，这里给 24 个形态每个一套专属母题，
 * 叠在构图的时间轴上（大招）和命中点上（命中），一眼认得出是谁。全部按 VFX.md：发丝线、白热核心、快出慢收、
 * 每个形态只用自己的 3 色 + 白，不用卡通星 / 爱心 / emoji。
 * 引擎（laolao-game-fx.js）持有时钟：每帧调 frame(time, cineT)，这里不起自己的 rAF；没有实例时画布隐藏。
 * Canvas2D：夜间 / 过场里用叠加（lighter）出光，纸面上用正常混合 + 压暗提饱和的颜色。 */
(() => {
  'use strict';
  if (window.__pinkieGameSig) return;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const eo = t => 1 - (1 - t) ** 4;                       // expo-out 近似：快出
  const ei = t => t * t * t;                               // 慢收
  const win = (t, a, b, c, d) => Math.min(seg(t, a, b), 1 - seg(t, c, d));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mulberry = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  // ── 颜色 ──
  const hex = h => { const s = String(h || '#ffffff').replace('#', ''); const n = parseInt(s.length === 3 ? s.replace(/./g, c => c + c) : s.slice(0, 6), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a, 0, 1).toFixed(3)})`;
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const lum = c => (.299 * c[0] + .587 * c[1] + .114 * c[2]) / 255;
  const sat = c => (Math.max(...c) - Math.min(...c)) / 255;
  const WHITE = [255, 255, 255];
  // 纸面：接近白的颜色换成配色里最饱和的那个、压到中明度（同 fx 引擎的 paperTone）。
  function paperTone(c, pal) {
    const vivid = pal.reduce((a, b) => sat(b) > sat(a) ? b : a, pal[0]);
    const target = sat(vivid) < .12 ? [199, 33, 102] : vivid.map(v => v * Math.min(1, .42 / Math.max(.05, lum(vivid))));
    const l = lum(c), w = clamp((l - .55) / .3, 0, 1) * .9;
    return mix(c.map(v => clamp(l * 255 + (v - l * 255) * 1.4, 0, 255) * .9), target, w);
  }

  // ── 画笔 ──
  // 每次画都通过 env：env.g（ctx）、env.dark、env.pal（[r,g,b] 三色）、env.k（尺寸系数）。
  const tone = (env, c) => env.dark ? c : paperTone(c, env.pal);
  // 发光线：外晕 → 中层 → 白热核心。path(g) 自己 beginPath。
  function glow(env, path, c, w = 1.4, a = 1) {
    const g = env.g; if (a <= .004) return;
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (env.dark) {
      g.globalCompositeOperation = 'lighter';
      for (const [k, al, cc] of [[7, .07, c], [2.8, .26, c], [1, .95, mix(c, WHITE, .7)]]) { path(g); g.strokeStyle = rgba(cc, a * al); g.lineWidth = w * k * env.k; g.stroke(); }
    } else {
      g.globalCompositeOperation = 'source-over';
      const t = tone(env, c);
      for (const [k, al] of [[4, .09], [1, .92]]) { path(g); g.strokeStyle = rgba(t, a * al); g.lineWidth = w * k * env.k; g.stroke(); }
    }
    g.globalCompositeOperation = 'source-over';
  }
  // 实色线（墨、纸带、轮廓），不发光。
  function solid(env, path, c, w = 1.4, a = 1, cap = 'round') {
    const g = env.g; if (a <= .004) return;
    g.globalCompositeOperation = 'source-over'; g.lineCap = cap; g.lineJoin = 'round';
    path(g); g.strokeStyle = rgba(env.dark ? c : tone(env, c), a); g.lineWidth = w * env.k; g.stroke();
  }
  function fill(env, path, c, a = 1, light = false) {
    const g = env.g; if (a <= .004) return;
    g.globalCompositeOperation = light && env.dark ? 'lighter' : 'source-over';
    path(g); g.fillStyle = typeof c === 'string' ? c : rgba(env.dark || !light ? c : tone(env, c), a); g.fill();
    g.globalCompositeOperation = 'source-over';
  }
  // 柔光点：白热中心 → 本色 → 透明。
  function bloom(env, x, y, r, c, a = 1) {
    const g = env.g; if (a <= .004 || r <= .5) return;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    if (env.dark) { g.globalCompositeOperation = 'lighter'; gr.addColorStop(0, rgba(mix(c, WHITE, .85), a)); gr.addColorStop(.18, rgba(c, a * .55)); gr.addColorStop(1, rgba(c, 0)); }
    else { const t = tone(env, c); gr.addColorStop(0, rgba(t, a * .55)); gr.addColorStop(.3, rgba(t, a * .22)); gr.addColorStop(1, rgba(t, 0)); }
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.globalCompositeOperation = 'source-over';
  }
  // 四芒细光（发丝十字，两端渐隐）。
  function glint(env, x, y, r, c, a = 1, rot = 0) {
    const g = env.g; if (a <= .004) return;
    for (const [ang, len] of [[rot, r], [rot + Math.PI / 2, r * .62]]) {
      const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len, gr = g.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
      const cc = env.dark ? mix(c, WHITE, .6) : tone(env, c);
      gr.addColorStop(0, rgba(cc, 0)); gr.addColorStop(.5, rgba(cc, a)); gr.addColorStop(1, rgba(cc, 0));
      g.globalCompositeOperation = env.dark ? 'lighter' : 'source-over'; g.strokeStyle = gr; g.lineWidth = 1.3 * env.k; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x - dx, y - dy); g.lineTo(x + dx, y + dy); g.stroke();
    }
    bloom(env, x, y, r * .28, c, a * .8);
    g.globalCompositeOperation = 'source-over';
  }
  // 流光：一段按方向拉长、尾部渐隐的发丝。
  function streak(env, x, y, ang, len, c, a = 1, w = 1.6) {
    const g = env.g, dx = Math.cos(ang) * len, dy = Math.sin(ang) * len, gr = g.createLinearGradient(x - dx, y - dy, x, y);
    const cc = env.dark ? mix(c, WHITE, .55) : tone(env, c);
    gr.addColorStop(0, rgba(cc, 0)); gr.addColorStop(1, rgba(cc, a));
    g.globalCompositeOperation = env.dark ? 'lighter' : 'source-over'; g.strokeStyle = gr; g.lineWidth = w * env.k; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x - dx, y - dy); g.lineTo(x, y); g.stroke(); g.globalCompositeOperation = 'source-over';
  }
  // 折线 / 曲线按进度描出来：pts 是点列，p ∈ [0,1]。
  function partial(pts, p) {
    if (p >= 1) return pts; if (p <= 0) return pts.slice(0, 1);
    let total = 0; const d = [0]; for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); d.push(total); }
    const want = total * p, out = [pts[0]];
    for (let i = 1; i < pts.length; i++) { if (d[i] <= want) out.push(pts[i]); else { const f = (want - d[i - 1]) / Math.max(1e-6, d[i] - d[i - 1]); out.push([lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)]); break; } }
    return out;
  }
  const poly = (pts, close = false) => g => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); if (close) g.closePath(); };
  const circle = (x, y, r, a0 = 0, a1 = TAU) => g => { g.beginPath(); g.arc(x, y, Math.max(.1, r), a0, a1); };
  const ellipse = (x, y, rx, ry, rot, a0 = 0, a1 = TAU) => g => { g.beginPath(); g.ellipse(x, y, Math.max(.1, rx), Math.max(.1, ry), rot, a0, a1); };
  const sample = (n, f) => Array.from({length: n + 1}, (_, i) => f(i / n));
  // 纸带（彩带 / 丝带 / 红毯边）：中心线 + 宽度，宽度 × |cos(扭转)| 做出翻面，背面暗 30%，正对时一闪高光。
  function ribbon(env, pts, width, twist, c, a = 1, back = .7) {
    const g = env.g; if (a <= .004 || pts.length < 2) return;
    g.globalCompositeOperation = 'source-over';
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], ang = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2;
      const tw = twist(i / (pts.length - 1)), cs = Math.cos(tw), w = width * env.k * Math.max(.08, Math.abs(cs)) / 2;
      const nx = Math.cos(ang) * w, ny = Math.sin(ang) * w;
      let col = cs < 0 ? c.map(v => v * back) : c; if (cs > .94) col = mix(col, WHITE, (cs - .94) / .06 * .6);
      if (!env.dark) col = paperTone(col, env.pal);
      g.fillStyle = rgba(col, a); g.beginPath(); g.moveTo(x0 - nx, y0 - ny); g.lineTo(x1 - nx, y1 - ny); g.lineTo(x1 + nx, y1 + ny); g.lineTo(x0 + nx, y0 + ny); g.closePath(); g.fill();
    }
  }

  // ── 母题 ──
  // ult(env, T)：T = 过场进度 0–1（.84 释放）；env.cx/cy = 条带中心，W/H 屏幕。
  // hit(env, t)：t = 命中进度 0–1；env.x/y = 命中点，env.crit。
  // 每个母题自己决定层次：引入（0–.3）→ 停留 → 释放（.84）→ 余韵。
  const R = .84;
  const M = {};

  // 日常：派对拉炮。两角拉炮喷出卷曲纸彩带，释放时再一轮。
  function streamer(env, ox, oy, ang, speed, curl, len, p, c, w, phase) {
    const pts = sample(26, s => { const u = s * p * len; return [ox + Math.cos(ang) * u * speed + Math.sin(u * curl + phase) * 18 * env.k, oy + Math.sin(ang) * u * speed + u * u * 120 + Math.cos(u * curl * .8 + phase) * 10 * env.k]; });
    ribbon(env, pts, w, s => s * 9 + phase, c, 1);
  }
  M.party = {
    ult(env, T) {
      const {W, H, pal, rnd} = env;
      for (const [vol, t0] of [[0, .04], [1, R - .02]]) {
        const p = eo(seg(T, t0, t0 + .32)), a = 1 - seg(T, t0 + .5, t0 + .7 > 1 ? 1 : t0 + .7);
        if (p <= 0 || a <= 0) continue;
        for (let side = 0; side < 2; side++) for (let i = 0; i < 7; i++) {
          const r = env.r(vol * 100 + side * 10 + i), ox = side ? W * .97 : W * .03, oy = H * .98, base = side ? -Math.PI * .72 : -Math.PI * .28;
          env.g.globalAlpha = a; streamer(env, ox, oy, base + (r - .5) * .6, H * (.9 + r * .7), 6 + r * 6, 1, p, pal[i % 3], 7 + r * 5, r * 6); env.g.globalAlpha = 1;
        }
        // 炮口的一闪
        bloom(env, W * .03, H * .98, H * .18 * (1 - seg(T, t0, t0 + .12)), pal[2], 1 - seg(T, t0, t0 + .14));
        bloom(env, W * .97, H * .98, H * .18 * (1 - seg(T, t0, t0 + .12)), pal[2], 1 - seg(T, t0, t0 + .14));
      }
    },
    hit(env, t) {
      const {x, y, pal} = env, p = eo(seg(t, 0, .55)), a = 1 - seg(t, .55, 1);
      env.g.globalAlpha = a;
      for (let i = 0; i < (env.crit ? 9 : 6); i++) { const r = env.r(i); streamer(env, x, y, -Math.PI / 2 + (i / 5 - .5) * 2.4, 260 * env.k, 9, .9, p, pal[i % 3], 5, r * 6); }
      env.g.globalAlpha = 1;
      glow(env, circle(x, y, 70 * env.k * eo(seg(t, 0, .4))), pal[2], 1.1, 1 - seg(t, 0, .45));
    },
  };

  // 学习：钢笔。一笔压出墨池的长下划线 → 释放时一个勾；三张便签从边上飘进来。
  function nibStroke(env, pts, p, c, w) {
    const part = partial(pts, p); if (part.length < 2) return;
    for (let i = 1; i < part.length; i++) { const s = i / pts.length; solid(env, poly([part[i - 1], part[i]]), c, w * (1.6 - s * 1.2), 1); }
    bloom(env, part[0][0], part[0][1], w * 2.4 * env.k, c, .5);
  }
  function note(env, x, y, s, rot, c, a) {
    const g = env.g; g.save(); g.translate(x, y); g.rotate(rot); g.globalAlpha = a;
    g.fillStyle = rgba(env.dark ? mix(c, WHITE, .25) : mix(c, WHITE, .55), .92); g.fillRect(-s / 2, -s / 2, s, s);
    g.fillStyle = rgba([0, 0, 0], .08); g.fillRect(-s / 2, s / 2 - 4, s, 4);
    g.strokeStyle = rgba(env.dark ? [255, 255, 255] : [60, 40, 60], .35); g.lineWidth = 1; for (let i = 1; i <= 3; i++) { g.beginPath(); g.moveTo(-s * .36, -s / 2 + s * i * .24); g.lineTo(s * (.36 - i * .07), -s / 2 + s * i * .24); g.stroke(); }
    g.restore();
  }
  M.pen = {
    ult(env, T) {
      const {W, H, cx, cy, pal} = env, ink = env.dark ? mix(pal[0], WHITE, .4) : pal[1];
      const line = sample(40, s => [lerp(W * .06, W * .94, s), cy + H * .24 + Math.sin(s * 5) * 4 + s * -14]);
      nibStroke(env, line, eo(seg(T, .06, .34)), ink, 3.2);
      const tick = [[cx + H * .5, cy - H * .02], [cx + H * .58, cy + H * .08], [cx + H * .8, cy - H * .2]];
      nibStroke(env, tick, eo(seg(T, R - .02, R + .08)), pal[2], 5);
      for (let i = 0; i < 3; i++) { const p = eo(seg(T, .12 + i * .06, .42 + i * .06)); note(env, lerp(W + 80, W * (.8 - i * .07), p), H * (.18 + i * .2), 70 * env.k, (i - 1) * .14 + (1 - p) * .6, pal[i % 3], p * (1 - seg(T, .9, 1))); }
      if (T > R) for (let i = 0; i < 8; i++) { const a = env.r(i) * TAU; streak(env, tick[2][0] + Math.cos(a) * 60 * eo(seg(T, R, 1)), tick[2][1] + Math.sin(a) * 60 * eo(seg(T, R, 1)), a, 24, pal[2], 1 - seg(T, R, 1)); }
    },
    hit(env, t) {
      const {x, y, pal} = env, ink = env.dark ? mix(pal[0], WHITE, .4) : pal[1], a = 1 - seg(t, .6, 1);
      env.g.globalAlpha = a;
      nibStroke(env, sample(16, s => [x - 80 * env.k + s * 160 * env.k, y + 40 * env.k + Math.sin(s * 4) * 2]), eo(seg(t, 0, .35)), ink, 2.6);
      nibStroke(env, [[x - 16 * env.k, y], [x - 2 * env.k, y + 14 * env.k], [x + 26 * env.k, y - 20 * env.k]], eo(seg(t, .2, .45)), pal[2], 3.6);
      env.g.globalAlpha = 1;
      if (env.crit) note(env, x + 70 * env.k, y - 50 * env.k, 46 * env.k, .2, pal[0], eo(seg(t, .1, .3)) * a);
    },
  };

  // 项目：蓝图。扫描线铺开细网格，尺寸线量出条带，释放时一条时间轴上的里程碑旗逐个立起。
  M.blueprint = {
    ult(env, T) {
      const {W, H, cy, pal} = env, c = env.dark ? mix(pal[1], WHITE, .45) : pal[1], sweep = eo(seg(T, .02, .3)) * W;
      const a = .35 * (1 - seg(T, .92, 1)), step = 34 * env.k;
      for (let x = 0; x < sweep; x += step) glow(env, poly([[x, 0], [x, H]]), c, .45, a * (x % (step * 4) < 1 ? 1.8 : 1));
      for (let y = 0; y < H; y += step) glow(env, poly([[0, y], [sweep, y]]), c, .45, a * (Math.round(y / step) % 4 ? 1 : 1.8));
      glow(env, poly([[sweep, 0], [sweep, H]]), pal[2], 1.4, T < .32 ? 1 : 0);
      // 尺寸线
      const d = eo(seg(T, .22, .4)), y0 = cy - H * .28, x0 = W * .1, x1 = lerp(x0, W * .9, d);
      glow(env, poly([[x0, y0], [x1, y0]]), pal[2], 1, .9 * (1 - seg(T, .92, 1)));
      for (const xx of [x0, x1]) glow(env, poly([[xx, y0 - 9], [xx, y0 + 9]]), pal[2], 1, .9 * d * (1 - seg(T, .92, 1)));
      // 里程碑
      const ty = cy + H * .3, tl = eo(seg(T, R - .1, R + .02));
      glow(env, poly([[W * .12, ty], [lerp(W * .12, W * .88, tl), ty]]), c, 1.1, 1 - seg(T, .94, 1));
      for (let i = 0; i < 5; i++) {
        const fx = lerp(W * .16, W * .84, i / 4), p = eo(seg(T, R - .04 + i * .025, R + .06 + i * .025)), aa = 1 - seg(T, .95, 1);
        if (p <= 0) continue;
        glow(env, poly([[fx, ty], [fx, ty - 54 * env.k * p]]), c, 1, aa);
        fill(env, poly([[fx, ty - 54 * env.k * p], [fx + 26 * env.k * p, ty - 46 * env.k * p], [fx, ty - 38 * env.k * p]], true), i === 4 ? pal[2] : pal[0], aa * .95, true);
        bloom(env, fx, ty, 16 * env.k, pal[2], aa * (1 - seg(T, R + i * .025, R + .1 + i * .025)));
      }
    },
    hit(env, t) {
      const {x, y, pal} = env, c = env.dark ? mix(pal[1], WHITE, .5) : pal[1], p = eo(seg(t, 0, .3)), a = 1 - seg(t, .55, 1), s = lerp(110, 54, p) * env.k;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) glow(env, poly([[x + sx * s, y + sy * (s - 18 * env.k)], [x + sx * s, y + sy * s], [x + sx * (s - 18 * env.k), y + sy * s]]), pal[2], 1.3, a);
      for (let i = -2; i <= 2; i++) { glow(env, poly([[x + i * 20 * env.k, y - s * .8], [x + i * 20 * env.k, y + s * .8]]), c, .5, a * .5 * p); glow(env, poly([[x - s * .8, y + i * 20 * env.k], [x + s * .8, y + i * 20 * env.k]]), c, .5, a * .5 * p); }
      bloom(env, x, y, 26 * env.k, pal[2], (1 - seg(t, .2, .6)));
    },
  };

  // 思考：思维晶格。节点逐个连成发丝网，脉冲沿边走；释放时全网一亮 + 一道竖向灵光。
  function lattice(env, n, cx, cy, rx, ry, salt) {
    const nodes = Array.from({length: n}, (_, i) => { const a = env.r(salt + i) * TAU, r = Math.sqrt(env.r(salt + i + 50)); return [cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]; });
    const edges = []; nodes.forEach((p, i) => { const near = nodes.map((q, j) => [Math.hypot(p[0] - q[0], p[1] - q[1]), j]).filter(e => e[1] !== i).sort((a, b) => a[0] - b[0]).slice(0, 2); for (const [, j] of near) if (i < j || !edges.some(e => e[0] === j && e[1] === i)) edges.push([i, j]); });
    return {nodes, edges};
  }
  M.lattice = {
    ult(env, T) {
      const {W, H, cx, cy, pal} = env, L = env.memo('lat', () => lattice(env, 22, W / 2, H / 2, W * .48, H * .44, 7));
      const fade = 1 - seg(T, .92, 1);
      L.edges.forEach(([i, j], k) => { const p = eo(seg(T, .04 + k * .012, .2 + k * .012)); if (p <= 0) return; const a = L.nodes[i], b = L.nodes[j]; glow(env, poly([a, [lerp(a[0], b[0], p), lerp(a[1], b[1], p)]]), pal[1], .8, fade * (.55 + .45 * seg(T, R, R + .03) * (1 - seg(T, R + .03, .95))));
        const q = (T * 2.2 + k * .37) % 1; if (T > .3 && T < .9) bloom(env, lerp(a[0], b[0], q), lerp(a[1], b[1], q), 7 * env.k, pal[2], .8); });
      L.nodes.forEach((p, i) => { const on = seg(T, .04 + i * .01, .1 + i * .01); glow(env, circle(p[0], p[1], 3.2 * env.k), pal[2], 1, on * fade); if (T > R) bloom(env, p[0], p[1], 30 * env.k, pal[2], 1 - seg(T, R, .96)); });
      const f = seg(T, R, R + .02) * (1 - seg(T, R + .02, .98));
      glow(env, poly([[cx - H * .3, 0], [cx - H * .3, H]]), pal[2], 2, f);
      glint(env, cx - H * .3, cy, H * .35, pal[2], f);
    },
    hit(env, t) {
      const {x, y, pal} = env, L = env.memo('lat', () => lattice(env, 7, x, y, 90 * env.k, 80 * env.k, 3)), a = 1 - seg(t, .6, 1);
      L.edges.forEach(([i, j], k) => { const p = eo(seg(t, k * .03, .3 + k * .03)), A = L.nodes[i], B = L.nodes[j]; glow(env, poly([A, [lerp(A[0], B[0], p), lerp(A[1], B[1], p)]]), pal[1], .8, a); });
      L.nodes.forEach(p => glow(env, circle(p[0], p[1], 2.6 * env.k), pal[2], 1, a));
      glint(env, x, y, 70 * env.k * eo(seg(t, .1, .4)), pal[2], 1 - seg(t, .25, .7));
    },
  };

  // 无限制：色散波。三道错位的环（偏移的分光）一圈圈扫开；释放时一道大色散波 + 棱镜把光拆成扇面。
  const SPECTRUM = [[255, 70, 140], [255, 214, 90], [70, 230, 200], [110, 140, 255]];
  function prismRing(env, x, y, r, a, w = 1.4) { [[-3, 0], [0, 0], [3, 0]].forEach(([dx], i) => glow(env, circle(x + dx * env.k * (r / 200), y, r + i * 2), i === 1 ? env.pal[2] : SPECTRUM[i * 2 % 4], w, a)); }
  M.prism = {
    ult(env, T) {
      const {H, cx, cy} = env;
      for (let i = 0; i < 4; i++) { const p = seg(T, .03 + i * .08, .5 + i * .08); if (p > 0 && p < 1) prismRing(env, cx, cy, H * 1.1 * eo(p), (1 - p) * .9); }
      const r = seg(T, R, 1); if (r > 0) { prismRing(env, cx, cy, H * 1.5 * eo(r), (1 - r), 3); }
      // 棱镜扇面
      const f = seg(T, R - .04, R + .04) * (1 - seg(T, R + .05, .98)), px = cx + H * .55, py = cy - H * .05;
      glow(env, poly([[px, py - 40 * env.k], [px + 40 * env.k, py + 30 * env.k], [px - 40 * env.k, py + 30 * env.k]], true), WHITE, 1.2, f);
      glow(env, poly([[0, py + 10], [px - 20 * env.k, py + 6]]), WHITE, 1.6, f);
      SPECTRUM.forEach((c, i) => glow(env, poly([[px + 22 * env.k, py + 8], [env.W, py - H * .2 + i * H * .1]]), c, 1.5, f));
    },
    hit(env, t) {
      const {x, y} = env, p = eo(seg(t, 0, .7));
      prismRing(env, x, y, 120 * env.k * p, 1 - seg(t, .2, 1));
      if (env.crit) prismRing(env, x, y, 70 * env.k * p, 1 - seg(t, .1, .8), 2);
      SPECTRUM.forEach((c, i) => streak(env, x + Math.cos(-.5 + i * .33) * 130 * env.k * p, y + Math.sin(-.5 + i * .33) * 130 * env.k * p, -.5 + i * .33, 50 * env.k, c, 1 - seg(t, .3, .9)));
    },
  };

  // 名侦探：放大镜扫过，线索钉逐个亮起，红线把它们连起来，释放时全部收向中心。
  function magnifier(env, x, y, r, a) {
    glow(env, circle(x, y, r), env.pal[2], 2, a);
    glow(env, circle(x, y, r - 7 * env.k), env.pal[2], .6, a * .6);
    fill(env, circle(x, y, r - 2), env.dark ? 'rgba(255,248,236,.06)' : 'rgba(255,255,255,.18)');
    const h0 = Math.PI * .25; glow(env, poly([[x + Math.cos(h0) * r, y + Math.sin(h0) * r], [x + Math.cos(h0) * r * 1.65, y + Math.sin(h0) * r * 1.65]]), env.pal[1], 4.5, a);
    glow(env, circle(x, y, r * .7, Math.PI * 1.1, Math.PI * 1.45), WHITE, 1.2, a * .8);
  }
  M.lens = {
    ult(env, T) {
      const {W, H, pal} = env, red = [200, 40, 60], pins = env.memo('pins', () => Array.from({length: 6}, (_, i) => [W * (.1 + .8 * env.r(i + 9)), H * (.14 + .72 * env.r(i + 19))]));
      const sx = lerp(-H * .2, W + H * .2, ei(seg(T, .05, .8)) * .5 + eo(seg(T, .05, .8)) * .5), sy = H * .4 + Math.sin(T * 6) * H * .06;
      if (T < R) magnifier(env, sx, sy, H * .14, 1 - seg(T, .74, .82));
      const fade = 1 - seg(T, .94, 1), conv = eo(seg(T, R, R + .1)), cx = W * .5, cy = H * .5;
      const P = pins.map(p => [lerp(p[0], cx, conv * .85), lerp(p[1], cy, conv * .85)]);
      P.forEach((p, i) => { const on = seg(T, .1 + i * .08, .14 + i * .08); if (on <= 0) return; if (i) { const q = P[i - 1], d = eo(seg(T, .1 + i * .08, .2 + i * .08)); solid(env, poly([q, [lerp(q[0], p[0], d), lerp(q[1], p[1], d) + Math.sin(d * Math.PI) * 14]]), red, 1.4, .9 * fade); }
        fill(env, circle(p[0], p[1], 5 * env.k), rgba(red, fade)); bloom(env, p[0], p[1], 22 * env.k, pal[2], on * (1 - seg(T, .1 + i * .08, .3 + i * .08)) + (T > R ? 1 - seg(T, R, .95) : 0)); });
    },
    hit(env, t) {
      const {x, y, pal} = env, p = eo(seg(t, 0, .35)), a = 1 - seg(t, .55, 1), red = [200, 40, 60];
      magnifier(env, x, y, lerp(140, 58, p) * env.k, a);
      for (let i = 0; i < 4; i++) { const ang = i * Math.PI / 2; glow(env, poly([[x + Math.cos(ang) * 70 * env.k, y + Math.sin(ang) * 70 * env.k], [x + Math.cos(ang) * 86 * env.k, y + Math.sin(ang) * 86 * env.k]]), pal[2], 1, a * p); }
      const pins = [[x - 120 * env.k, y - 40 * env.k], [x + 130 * env.k, y + 30 * env.k]], d = eo(seg(t, .15, .5));
      for (const q of pins) { solid(env, poly([[x, y], [lerp(x, q[0], d), lerp(y, q[1], d)]]), red, 1.2, a * .9); fill(env, circle(q[0], q[1], 4 * env.k), rgba(red, a * d)); }
    },
  };

  // 海盗船长：藏宝图墨线 + 罗盘。虚线航线描出、终点画 X；角落罗盘针摆动后定住；释放时炮口烟（粒子层）。
  function compass(env, x, y, r, needle, a) {
    const c = env.pal[0], d = env.dark ? [240, 225, 200] : [70, 50, 40];
    glow(env, circle(x, y, r), c, 1.1, a); glow(env, circle(x, y, r * .82), c, .6, a * .6);
    for (let i = 0; i < 32; i++) { const an = i / 32 * TAU, l = i % 8 ? (i % 4 ? .06 : .1) : .16; glow(env, poly([[x + Math.cos(an) * r, y + Math.sin(an) * r], [x + Math.cos(an) * r * (1 - l), y + Math.sin(an) * r * (1 - l)]]), c, .7, a); }
    for (let i = 0; i < 8; i++) { const an = i / 8 * TAU - Math.PI / 2, l = i % 2 ? .4 : .7; solid(env, poly([[x, y], [x + Math.cos(an - .12) * r * .14, y + Math.sin(an - .12) * r * .14], [x + Math.cos(an) * r * l, y + Math.sin(an) * r * l], [x + Math.cos(an + .12) * r * .14, y + Math.sin(an + .12) * r * .14]], true), d, .8, a * .7); }
    const nx = Math.cos(needle - Math.PI / 2), ny = Math.sin(needle - Math.PI / 2);
    fill(env, poly([[x + nx * r * .74, y + ny * r * .74], [x - ny * 5 * env.k, y + nx * 5 * env.k], [x + ny * 5 * env.k, y - nx * 5 * env.k]], true), env.pal[2], a, true);
  }
  M.chart = {
    ult(env, T) {
      const {W, H, pal} = env, ink = env.dark ? [236, 214, 178] : [74, 50, 36], fade = 1 - seg(T, .93, 1);
      const route = env.memo('route', () => sample(60, s => [lerp(W * .05, W * .82, s), H * (.8 - .5 * s) + Math.sin(s * 9) * H * .07]));
      const part = partial(route, eo(seg(T, .05, .62))), g = env.g;
      g.setLineDash([10 * env.k, 9 * env.k]); solid(env, poly(part), ink, 2.2, .9 * fade); g.setLineDash([]);
      const end = route[route.length - 1], x = eo(seg(T, .6, .7));
      if (x > 0) { const s = 22 * env.k; solid(env, poly([[end[0] - s, end[1] - s], [end[0] - s + 2 * s * x, end[1] - s + 2 * s * x]]), pal[2], 4, fade); solid(env, poly([[end[0] + s, end[1] - s], [end[0] + s - 2 * s * seg(T, .66, .74), end[1] - s + 2 * s * seg(T, .66, .74)]]), pal[2], 4, fade); }
      const swing = Math.sin(T * 28) * 1.4 * (1 - eo(seg(T, .1, .7))) + .6;
      compass(env, W * .86, H * .22, H * .13, swing, eo(seg(T, .04, .2)) * fade);
      if (T > R) bloom(env, end[0], end[1], H * .2, pal[0], 1 - seg(T, R, .98));
    },
    hit(env, t) {
      const {x, y, pal} = env, s = 20 * env.k, a = 1 - seg(t, .55, 1), p = seg(t, 0, .2), q = seg(t, .12, .32);
      solid(env, poly([[x - s, y - s], [x - s + 2 * s * p, y - s + 2 * s * p]]), pal[2], 4, a); solid(env, poly([[x + s, y - s], [x + s - 2 * s * q, y - s + 2 * s * q]]), pal[2], 4, a);
      env.g.setLineDash([7 * env.k, 7 * env.k]); glow(env, circle(x, y, 70 * env.k, -Math.PI * .9, -Math.PI * .9 + Math.PI * 1.4 * eo(seg(t, 0, .45))), pal[0], 1.2, a); env.g.setLineDash([]);
      if (env.crit) compass(env, x, y, 64 * env.k, Math.sin(t * 30) * (1 - t), a * .8);
    },
  };

  // 宇航员：倾斜的轨道椭圆一条条描出，卫星拖着尾光绕行；释放时一道推进尾焰穿过画面。
  M.orbit = {
    ult(env, T) {
      const {W, H, cx, cy, pal} = env, fade = 1 - seg(T, .93, 1);
      [[.62, .2, -.22], [.48, .14, .34], [.8, .26, .05]].forEach(([rx, ry, rot], i) => {
        const p = eo(seg(T, .03 + i * .07, .32 + i * .07)), X = cx + H * .2, Y = cy;
        glow(env, ellipse(X, Y, H * rx, H * ry, rot, 0, TAU * p), i === 1 ? pal[2] : pal[0], .9, .8 * fade);
        if (p >= 1) { const ang = T * (5 + i * 2) + i, ux = Math.cos(ang) * H * rx, uy = Math.sin(ang) * H * ry, px = X + ux * Math.cos(rot) - uy * Math.sin(rot), py = Y + ux * Math.sin(rot) + uy * Math.cos(rot);
          bloom(env, px, py, 14 * env.k, pal[2], fade); glint(env, px, py, 18 * env.k, pal[2], .8 * fade);
          glow(env, ellipse(X, Y, H * rx, H * ry, rot, ang - .5, ang), pal[2], 1.6, .7 * fade); }
      });
      const b = seg(T, R - .02, R + .1);
      if (b > 0 && b < 1) { const x = lerp(-W * .2, W * 1.2, eo(b)), y = cy + H * .32 - b * H * .5; streak(env, x, y, -Math.atan2(H * .5, W * 1.4), W * .45, pal[2], 1, 6); streak(env, x, y, -Math.atan2(H * .5, W * 1.4), W * .3, WHITE, 1, 2.2); bloom(env, x, y, 40 * env.k, pal[2], 1); }
    },
    hit(env, t) {
      const {x, y, pal} = env, p = eo(seg(t, 0, .4)), a = 1 - seg(t, .6, 1), rx = 92 * env.k, ry = 30 * env.k, rot = -.3;
      glow(env, ellipse(x, y, rx, ry, rot, 0, TAU * p), pal[0], 1, a);
      const ang = t * 14, ux = Math.cos(ang) * rx, uy = Math.sin(ang) * ry;
      bloom(env, x + ux * Math.cos(rot) - uy * Math.sin(rot), y + ux * Math.sin(rot) + uy * Math.cos(rot), 12 * env.k, pal[2], a);
      glow(env, circle(x, y, 40 * env.k + 90 * env.k * eo(seg(t, .1, .7))), pal[2], 1, 1 - seg(t, .1, .7));
    },
  };

  // 龙骑士：一道龙翼的影子从画面掠过，释放时一记火焰吐息横扫成弧。
  function wing(env, x, y, s, flap, c, a) {
    const g = env.g; g.save(); g.translate(x, y); g.scale(s, s * (1 - flap * .35)); g.globalAlpha = a;
    g.fillStyle = c; g.beginPath(); g.moveTo(0, 0);
    g.bezierCurveTo(60, -80, 180, -110, 300, -60); g.lineTo(250, -20); g.lineTo(270, 10); g.lineTo(200, 0); g.lineTo(215, 34); g.lineTo(140, 16); g.lineTo(140, 50); g.bezierCurveTo(90, 20, 40, 10, 0, 0);
    g.moveTo(0, 0); g.bezierCurveTo(-60, -80, -180, -110, -300, -60); g.lineTo(-250, -20); g.lineTo(-270, 10); g.lineTo(-200, 0); g.lineTo(-215, 34); g.lineTo(-140, 16); g.lineTo(-140, 50); g.bezierCurveTo(-90, 20, -40, 10, 0, 0);
    g.fill(); g.restore();
  }
  function flame(env, x, y, r, a0, a1, a) {
    const g = env.g, n = 28;
    for (let i = 0; i < n; i++) {
      const s = i / n, ang = lerp(a0, a1, s), jitter = Math.sin(s * 40 + env.now * 30) * .06;
      const c = mix(env.pal[2], env.pal[1], s), w = (1 - Math.abs(s - .6) * 1.2) * 34 * env.k;
      glow(env, circle(x, y, r * (1 + jitter), ang, ang + (a1 - a0) / n * 1.3), c, w / 7, a * (1 - s * .4));
    }
    glow(env, circle(x, y, r, a0, a1), WHITE, 1.4, a * .9);
  }
  M.dragon = {
    ult(env, T) {
      const {W, H, cx, cy, pal} = env, p = seg(T, .06, .6);
      if (p > 0 && p < 1) wing(env, lerp(W * 1.3, -W * .3, p), H * .3 + Math.sin(p * Math.PI) * -H * .1, H / 520, Math.abs(Math.sin(p * 9)), env.dark ? 'rgba(10,4,8,.55)' : 'rgba(60,20,30,.18)', Math.sin(p * Math.PI));
      const f = seg(T, R - .03, R + .1), fade = 1 - seg(T, R + .06, .98);
      if (f > 0) flame(env, cx - H * .9, cy + H * .9, H * 1.35, -Math.PI * .5, lerp(-Math.PI * .5, -Math.PI * .02, eo(f)), fade);
      if (T > R) for (let i = 0; i < 18; i++) { const r = env.r(i), u = seg(T, R, 1); bloom(env, W * r, H * (1 - u * (.4 + env.r(i + 40) * .5)), 4 * env.k, pal[2], (1 - u) * .9); }
    },
    hit(env, t) {
      const {x, y} = env, p = eo(seg(t, 0, .35)), a = 1 - seg(t, .4, 1);
      flame(env, x - 110 * env.k, y + 90 * env.k, 150 * env.k, -Math.PI * .55, lerp(-Math.PI * .55, -Math.PI * .02, p), a);
    },
  };

  // 女王：红毯从中下方向上铺开（透视梯形 + 金边），释放时极简王冠轮廓 + 权杖光柱。
  function crown(env, x, y, s, a) {
    const pts = [[-1, .5], [-1, -.2], [-.55, .12], [0, -.6], [.55, .12], [1, -.2], [1, .5]].map(([u, v]) => [x + u * s, y + v * s]);
    glow(env, poly(pts), env.pal[1], 1.6, a); glow(env, poly([[x - s, y + .5 * s + 8 * env.k], [x + s, y + .5 * s + 8 * env.k]]), env.pal[1], 1.2, a);
    for (const [u, v] of [[-1, -.2], [0, -.6], [1, -.2]]) bloom(env, x + u * s, y + v * s, 9 * env.k, env.pal[2], a);
  }
  M.carpet = {
    ult(env, T) {
      const {W, H, cx, cy, pal} = env, p = eo(seg(T, .04, .4)), fade = 1 - seg(T, .93, 1), red = pal[0], gold = pal[1];
      const bx = W / 2, top = lerp(H, H * .52, p), wb = W * .2, wt = W * .045;
      { const g = env.g, gr = g.createLinearGradient(0, H, 0, top), base = env.dark ? red : paperTone(red, pal);
        gr.addColorStop(0, rgba(base, (env.dark ? .34 : .2) * fade)); gr.addColorStop(.7, rgba(base, (env.dark ? .14 : .08) * fade)); gr.addColorStop(1, rgba(base, 0));
        g.globalCompositeOperation = 'source-over'; g.fillStyle = gr; poly([[bx - wb, H], [bx - lerp(wb, wt, p), top], [bx + lerp(wb, wt, p), top], [bx + wb, H]], true)(g); g.fill();
        for (let i = 1; i < 6; i++) { const yy = lerp(H, top, (i / 6) ** 1.6), hw = lerp(wb, lerp(wb, wt, p), (H - yy) / Math.max(1, H - top)) * .9; glow(env, poly([[bx - hw, yy], [bx + hw, yy]]), gold, .5, fade * .45 * (1 - i / 7)); } }
      for (const sgn of [-1, 1]) glow(env, poly([[bx + sgn * wb * .94, H], [bx + sgn * lerp(wb, wt, p) * .94, top]]), gold, 1.2, fade);
      const c = eo(seg(T, R - .04, R + .06));
      if (c > 0) { crown(env, cx - H * .02, cy - H * .38, H * .07 * (1.3 - .3 * c), c * fade); const pillar = 1 - seg(T, R + .02, .98); glow(env, poly([[cx - H * .02, 0], [cx - H * .02, H]]), gold, 3, pillar * .7); bloom(env, cx - H * .02, cy - H * .38, H * .3, gold, pillar * .6); }
    },
    hit(env, t) {
      const {x, y, pal} = env, p = eo(seg(t, 0, .35)), a = 1 - seg(t, .55, 1);
      crown(env, x, y - 70 * env.k * p, 26 * env.k, a);
      for (const sgn of [-1, 1]) glow(env, poly([[x + sgn * 20 * env.k, y + 30 * env.k], [x + sgn * 150 * env.k * p, y + 30 * env.k]]), pal[1], 1.2, a);
    },
  };

  // 公主：薄纱（半透明波浪带）扫过，花瓣成螺旋，释放时一朵发丝玫瑰线（rose curve）绽开。
  function rose(env, x, y, r, p, a) {
    const pts = sample(220, s => { const th = s * TAU * 2 * p, rr = r * Math.cos(2.5 * th) * (1 - s * .3); return [x + Math.cos(th) * rr, y + Math.sin(th) * rr]; });
    glow(env, poly(pts), env.pal[1], 1, a);
  }
  function petal(env, x, y, s, rot, c, a) { const g = env.g; g.save(); g.translate(x, y); g.rotate(rot); fill(env, gg => { gg.beginPath(); gg.ellipse(0, 0, s, s * .55, 0, 0, TAU); }, rgba(env.dark ? c : mix(c, WHITE, .1), a)); g.restore(); }
  M.rose = {
    ult(env, T) {
      const {W, H, cx, cy, pal} = env, fade = 1 - seg(T, .93, 1);
      for (let i = 0; i < 3; i++) { const p = seg(T, .03 + i * .08, .7 + i * .08), off = lerp(-W * .4, W * .4, eo(p));
        const pts = sample(30, s => [s * W, H * (.2 + i * .28) + Math.sin(s * 5 + T * 4 + i) * H * .05]);
        env.g.save(); env.g.translate(off * .3, 0); env.g.globalAlpha = Math.sin(p * Math.PI) * .5; solid(env, poly(pts), mix(pal[0], WHITE, .4), 44, .16); env.g.restore(); env.g.globalAlpha = 1; }
      for (let i = 0; i < 30; i++) { const r = env.r(i), u = seg(T, .05 + r * .2, .95), th = r * TAU + u * 5, rr = lerp(H * .05, H * .7, u);
        if (u > 0 && u < 1) petal(env, cx + Math.cos(th) * rr * 1.4, cy + Math.sin(th) * rr * .8, 9 * env.k, th * 2, pal[i % 2], (1 - u) * .9); }
      const b = eo(seg(T, R - .05, R + .1)); if (b > 0) rose(env, cx + H * .42, cy - H * .1, H * .2 * b, b, fade);
    },
    hit(env, t) {
      const {x, y, pal} = env, a = 1 - seg(t, .55, 1);
      rose(env, x, y, 54 * env.k, eo(seg(t, 0, .45)), a);
      for (let i = 0; i < 6; i++) { const u = eo(seg(t, 0, .8)), th = i / 6 * TAU + u * 2.5; petal(env, x + Math.cos(th) * 100 * env.k * u, y + Math.sin(th) * 100 * env.k * u, 8 * env.k, th, pal[i % 2], a); }
    },
  };

  // 骑士：盾面轮廓，一道镜面反光斜扫过；释放时两柄剑线交叉成 X，交点迸火花。
  function shield(env, x, y, s, a, glare) {
    const pts = sample(40, u => { const th = u * TAU; const px = Math.sin(th) * s * .82, py = th < Math.PI ? -s * .7 + (1 - Math.cos(th)) * s * .85 : -s * .7 + (1 - Math.cos(th)) * s * .85; return [x + px, y + py]; });
    const outline = [[x - s * .82, y - s * .7], [x + s * .82, y - s * .7], [x + s * .82, y - s * .05], [x, y + s], [x - s * .82, y - s * .05]];
    const g = env.g; g.save(); g.beginPath(); g.moveTo(outline[0][0], outline[0][1]); g.lineTo(outline[1][0], outline[1][1]); g.lineTo(outline[2][0], outline[2][1]); g.quadraticCurveTo(x + s * .7, y + s * .6, x, y + s); g.quadraticCurveTo(x - s * .7, y + s * .6, outline[4][0], outline[4][1]); g.closePath();
    const path = gg => { gg.beginPath(); gg.moveTo(outline[0][0], outline[0][1]); gg.lineTo(outline[1][0], outline[1][1]); gg.lineTo(outline[2][0], outline[2][1]); gg.quadraticCurveTo(x + s * .7, y + s * .6, x, y + s); gg.quadraticCurveTo(x - s * .7, y + s * .6, outline[4][0], outline[4][1]); gg.closePath(); };
    g.clip(); if (glare >= 0 && glare <= 1) { const gx = lerp(x - s * 1.6, x + s * 1.6, glare), gr = g.createLinearGradient(gx - s * .3, y - s, gx + s * .3, y + s); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, env.dark ? 'rgba(255,255,255,.55)' : 'rgba(140,155,176,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.globalCompositeOperation = env.dark ? 'lighter' : 'source-over'; g.fillStyle = gr; g.fillRect(x - s * 2, y - s * 2, s * 4, s * 4); }
    g.restore(); glow(env, path, env.pal[1], 1.5, a); void pts;
  }
  function blades(env, x, y, s, p, a) {
    for (const sg of [-1, 1]) { const ang = -Math.PI / 2 + sg * .62, ex = x + Math.cos(ang) * s, ey = y + Math.sin(ang) * s, sx = x - Math.cos(ang) * s * .7, sy = y - Math.sin(ang) * s * .7;
      const q = eo(p); glow(env, poly([[sx, sy], [lerp(sx, ex, q), lerp(sy, ey, q)]]), WHITE, 1.8, a); glow(env, poly([[sx - Math.sin(ang) * 14 * env.k, sy + Math.cos(ang) * 14 * env.k], [sx + Math.sin(ang) * 14 * env.k, sy - Math.cos(ang) * 14 * env.k]]), env.pal[1], 2, a * q); }
  }
  M.aegis = {
    ult(env, T) {
      const {H, cx, cy, pal} = env, fade = 1 - seg(T, .93, 1), sx = cx + H * .5, sy = cy - H * .04;
      shield(env, sx, sy, H * .2 * (1.08 - .08 * eo(seg(T, .05, .3))), eo(seg(T, .05, .25)) * fade, seg(T, .3, .62));
      const b = seg(T, R - .04, R + .03); if (b > 0) blades(env, sx, sy + H * .02, H * .36, b, fade);
      if (T > R) { for (let i = 0; i < 16; i++) { const an = env.r(i) * TAU, u = eo(seg(T, R, .98)); streak(env, sx + Math.cos(an) * u * H * .3, sy + Math.sin(an) * u * H * .3, an, 30 * env.k, i % 2 ? pal[2] : WHITE, 1 - u); } bloom(env, sx, sy, H * .2, pal[2], 1 - seg(T, R, .95)); }
    },
    hit(env, t) {
      const {x, y, pal} = env, a = 1 - seg(t, .5, 1);
      shield(env, x, y, 44 * env.k, a * .5, seg(t, 0, .5));
      blades(env, x, y, 90 * env.k, seg(t, 0, .22), a);
      for (let i = 0; i < 10; i++) { const an = env.r(i) * TAU, u = eo(seg(t, .15, .8)); streak(env, x + Math.cos(an) * u * 90 * env.k, y + Math.sin(an) * u * 90 * env.k + u * u * 30, an, 16 * env.k, pal[2], 1 - u); }
    },
  };

  // 甜点师：奶油裱花螺旋（星形嘴的平行脊线）从底部旋起，糖粒落下；释放时一朵裱花玫瑰。
  function piping(env, x, y, r, turns, p, a, w = 13) {
    const pts = sample(120, s => { const th = s * TAU * turns, rr = r * (1 - s * .85); return [x + Math.cos(th) * rr, y + Math.sin(th) * rr * .62 - s * r * .5]; });
    const part = partial(pts, p), cream = env.dark ? [255, 244, 224] : [250, 236, 214], edge = env.pal[1];
    // 发丝裱花：一圈淡奶油底晕 + 四道细棱线（裱花嘴的齿纹），不画粗管。
    solid(env, poly(part), cream, w * .9, a * (env.dark ? .07 : .12));
    glow(env, poly(part), edge, .9, a * .75);
    for (const off of [-.45, -.15, .15, .45]) { const g = env.g; g.save(); g.translate(off * w * env.k * .6, -off * 3); glow(env, poly(part), cream, .55, a * .8); g.restore(); }
  }
  function sprinkle(env, x, y, rot, c, a) { const g = env.g; g.save(); g.translate(x, y); g.rotate(rot); solid(env, poly([[-4 * env.k, 0], [4 * env.k, 0]]), c, 2.6, a); g.restore(); }
  M.piping = {
    ult(env, T) {
      const {W, H, cx, cy, pal} = env, fade = 1 - seg(T, .93, 1);
      piping(env, W * .14, H * .9, H * .3, 3, eo(seg(T, .05, .5)), fade);
      piping(env, W * .86, H * .9, H * .26, 2.6, eo(seg(T, .12, .55)), fade);
      for (let i = 0; i < 46; i++) { const r = env.r(i), u = seg(T, r * .5, r * .5 + .45); if (u > 0 && u < 1) sprinkle(env, W * env.r(i + 70), lerp(-20, H * .8, u), r * 7 + u * 4, pal[i % 3], (1 - u) * .95); }
      const b = eo(seg(T, R - .04, R + .1)); if (b > 0) piping(env, cx + H * .45, cy + H * .06, H * .14, 2.4, b, fade, 10);
    },
    hit(env, t) {
      const {x, y, pal} = env, a = 1 - seg(t, .6, 1);
      piping(env, x, y + 30 * env.k, 46 * env.k, 2.2, eo(seg(t, 0, .45)), a, 8);
      for (let i = 0; i < 12; i++) { const an = env.r(i) * TAU, u = eo(seg(t, .05, .8)); sprinkle(env, x + Math.cos(an) * u * 110 * env.k, y + Math.sin(an) * u * 110 * env.k + u * u * 40, an + u * 6, pal[i % 3], a); }
    },
  };

  // 魔法少女：两条缎带绕中轴螺旋上升（前后明暗），释放时收成蝴蝶结并迸光。
  function helix(env, x, y0, y1, r, turns, phase, p, c, w, a) {
    const pts = sample(70, s => [x + Math.cos(s * TAU * turns + phase) * r, lerp(y0, y1, s * p)]);
    ribbon(env, pts, w, s => s * TAU * turns + phase + Math.PI / 2, c, a);
  }
  M.ribbon = {
    ult(env, T) {
      const {H, cx, cy, pal} = env, p = eo(seg(T, .04, .55)), fade = 1 - seg(T, R, R + .06), X = cx + H * .3;
      helix(env, X, H * 1.05, -H * .05, H * .3 * (1 - .3 * seg(T, .6, R)), 2.2, T * 6, p, pal[0], 16, fade);
      helix(env, X, H * 1.05, -H * .05, H * .3 * (1 - .3 * seg(T, .6, R)), 2.2, T * 6 + Math.PI, p, pal[2], 12, fade);
      const b = seg(T, R - .02, R + .1), bf = 1 - seg(T, .9, 1);
      if (b > 0) { const s = H * .1 * eo(b), y = cy - H * .05;
        glow(env, g => { g.beginPath(); g.moveTo(X, y); g.bezierCurveTo(X - s * 1.6, y - s * 1.1, X - s * 1.8, y + s * .9, X, y); g.bezierCurveTo(X + s * 1.6, y - s * 1.1, X + s * 1.8, y + s * .9, X, y); }, pal[0], 2, bf);
        glow(env, poly([[X, y], [X - s * .7, y + s * 1.6]]), pal[0], 2, bf); glow(env, poly([[X, y], [X + s * .8, y + s * 1.5]]), pal[0], 2, bf);
        bloom(env, X, y, H * .35 * eo(b), pal[2], 1 - seg(T, R, .97)); }
    },
    hit(env, t) {
      const {x, y, pal} = env, a = 1 - seg(t, .55, 1);
      helix(env, x, y + 70 * env.k, y - 70 * env.k, 60 * env.k, 1.2, t * 8, eo(seg(t, 0, .4)), pal[0], 9, a);
      bloom(env, x, y, 60 * env.k, pal[2], 1 - seg(t, .1, .6));
    },
  };

  // 星砂占星师：星盘刻度环缓转，星座 7 颗星逐颗点亮并连线；释放时全部耀一下。
  function astrolabe(env, x, y, r, rot, a) {
    glow(env, circle(x, y, r), env.pal[1], .9, a); glow(env, circle(x, y, r * .9), env.pal[1], .5, a * .6);
    for (let i = 0; i < 72; i++) { const an = i / 72 * TAU + rot, l = i % 6 ? .03 : .07; glow(env, poly([[x + Math.cos(an) * r, y + Math.sin(an) * r], [x + Math.cos(an) * r * (1 - l), y + Math.sin(an) * r * (1 - l)]]), env.pal[1], .5, a); }
    glow(env, ellipse(x, y, r * .9, r * .36, rot * .5), env.pal[2], .6, a * .5);
  }
  const CONST = [[0, 0], [.18, -.2], [.42, -.14], [.58, -.34], [.78, -.22], [.66, .02], [.9, .12]];
  M.zodiac = {
    ult(env, T) {
      const {H, cx, cy, pal} = env, fade = 1 - seg(T, .93, 1), X = cx + H * .3, Y = cy - H * .02;
      astrolabe(env, X, Y, H * .42, T * .9, eo(seg(T, .03, .25)) * fade * .8);
      const P = CONST.map(([u, v]) => [X - H * .36 + u * H * .72, Y + v * H * .72 + H * .06]);
      P.forEach((p, i) => { const on = seg(T, .12 + i * .075, .16 + i * .075); if (on <= 0) return;
        if (i) { const q = P[i - 1], d = eo(seg(T, .12 + i * .075, .2 + i * .075)); glow(env, poly([q, [lerp(q[0], p[0], d), lerp(q[1], p[1], d)]]), pal[2], .8, fade * .9); }
        glint(env, p[0], p[1], (14 + 10 * (1 - seg(T, .12 + i * .075, .3 + i * .075))) * env.k, pal[2], fade); });
      if (T > R) P.forEach(p => glint(env, p[0], p[1], H * .08 * eo(seg(T, R, .9)), pal[2], 1 - seg(T, R, .97)));
    },
    hit(env, t) {
      const {x, y, pal} = env, a = 1 - seg(t, .6, 1);
      astrolabe(env, x, y, 76 * env.k, t * 2, a * .6 * eo(seg(t, 0, .3)));
      const P = [[-50, 20], [-14, -26], [24, -8], [54, -40]].map(([u, v]) => [x + u * env.k, y + v * env.k]);
      P.forEach((p, i) => { const on = seg(t, i * .08, .06 + i * .08); if (i) glow(env, poly([P[i - 1], p]), pal[2], .8, a * on); glint(env, p[0], p[1], 14 * env.k, pal[2], a * on); });
    },
  };

  // 古风状元：金榜卷轴从中间向两边展开（两个卷轴杆分开，中间是金纸和竖格），释放时朱批一圈。
  function brushRing(env, x, y, r, p, a) {
    const pts = sample(80, s => { const th = -Math.PI * .6 + s * TAU * .92 * p; return [x + Math.cos(th) * r * (1 + Math.sin(s * 7) * .02), y + Math.sin(th) * r * .9]; });
    for (let i = 1; i < pts.length; i++) { const s = i / pts.length; solid(env, poly([pts[i - 1], pts[i]]), [196, 18, 47], (1 - Math.abs(s - .3) * .9) * 14, a * (1 - s * .25)); }
  }
  M.scroll = {
    ult(env, T) {
      const {W, H, cy, pal} = env, p = eo(seg(T, .04, .4)), fade = 1 - seg(T, .93, 1), half = W * .42 * p, y0 = cy - H * .36, y1 = cy - H * .26;
      const paper = env.dark ? [70, 52, 24] : [242, 214, 140];
      fill(env, poly([[W / 2 - half, y0], [W / 2 + half, y0], [W / 2 + half, y1], [W / 2 - half, y1]], true), rgba(paper, (env.dark ? .12 : .22) * fade));
      for (const yy of [y0, y1]) glow(env, poly([[W / 2 - half, yy], [W / 2 + half, yy]]), pal[2], .7, fade * .8);
      for (let x = W / 2 - half + 22; x < W / 2 + half; x += 22 * env.k) glow(env, poly([[x, y0 + 4], [x, y1 - 4]]), pal[2], .5, .55 * fade);
      for (const sg of [-1, 1]) { const x = W / 2 + sg * half; solid(env, poly([[x, y0 - 10 * env.k], [x, y1 + 10 * env.k]]), env.dark ? [150, 96, 44] : [90, 50, 25], 3.2, fade); bloom(env, x, y0 - 10 * env.k, 8 * env.k, pal[2], fade * .6); }
      const r = eo(seg(T, R - .05, R + .08)); if (r > 0) brushRing(env, W * .78, cy - H * .02, H * .14, r, fade);
    },
    hit(env, t) {
      const {x, y, pal} = env, a = 1 - seg(t, .6, 1);
      brushRing(env, x, y, 48 * env.k, eo(seg(t, 0, .4)), a);
      for (let i = -1; i <= 1; i++) glow(env, poly([[x + i * 70 * env.k, y - 60 * env.k], [x + i * 70 * env.k, y - 60 * env.k + 120 * env.k * eo(seg(t, .1, .4))]]), pal[2], .6, a * .7);
    },
  };

  // 偶像：三束追光从顶部扫动、释放时汇到中心；底部一片荧光棒随拍子摇。
  function cone(env, x, y, tx, ty, w, c, a) {
    const g = env.g, ang = Math.atan2(ty - y, tx - x), len = Math.hypot(tx - x, ty - y), nx = -Math.sin(ang) * w, ny = Math.cos(ang) * w;
    const gr = g.createLinearGradient(x, y, tx, ty); const cc = env.dark ? c : paperTone(c, env.pal);
    gr.addColorStop(0, rgba(env.dark ? mix(cc, WHITE, .7) : cc, .5 * a)); gr.addColorStop(1, rgba(cc, 0));
    g.globalCompositeOperation = env.dark ? 'lighter' : 'source-over'; g.fillStyle = gr; g.beginPath(); g.moveTo(x, y); g.lineTo(tx + nx, ty + ny); g.lineTo(tx - nx, ty - ny); g.closePath(); g.fill(); g.globalCompositeOperation = 'source-over'; void len;
  }
  M.spotlight = {
    ult(env, T) {
      const {W, H, cx, cy, pal} = env, fade = 1 - seg(T, .94, 1), conv = eo(seg(T, R - .1, R));
      [.15, .5, .85].forEach((u, i) => { const sw = Math.sin(T * 7 + i * 2) * W * .22 * (1 - conv), tx = lerp(W * u + sw, cx + H * .3, conv), ty = lerp(H * .95, cy, conv); cone(env, W * u, -10, tx, ty, H * (.16 - .06 * conv), i === 1 ? WHITE : pal[i === 0 ? 0 : 1], eo(seg(T, .03 + i * .05, .2)) * fade); });
      const beat = Math.abs(Math.sin(T * 18)), rows = 3;
      for (let r = 0; r < rows; r++) for (let i = 0; i < 26; i++) { const x = (i + (r % 2) * .5) / 26 * W, y = H * (.9 + r * .045), ang = -Math.PI / 2 + Math.sin(T * 10 + i * .6 + r) * .35 * (.4 + beat * .6), c = [pal[0], pal[1], pal[2]][(i + r) % 3];
        glow(env, poly([[x, y], [x + Math.cos(ang) * 26 * env.k, y + Math.sin(ang) * 26 * env.k]]), c, 1.6, eo(seg(T, .1, .3)) * fade * (.5 + r * .2)); }
      if (T > R) bloom(env, cx + H * .3, cy, H * .5, WHITE, (1 - seg(T, R, .97)) * .7);
    },
    hit(env, t) {
      const {x, y, pal} = env, a = 1 - seg(t, .55, 1);
      cone(env, x + 40 * env.k, y - 260 * env.k, x, y + 30 * env.k, 64 * env.k, WHITE, a * eo(seg(t, 0, .2)));
      for (let i = 0; i < 7; i++) { const sx = x + (i - 3) * 26 * env.k, ang = -Math.PI / 2 + Math.sin(t * 20 + i) * .4; glow(env, poly([[sx, y + 80 * env.k], [sx + Math.cos(ang) * 22 * env.k, y + 80 * env.k + Math.sin(ang) * 22 * env.k]]), pal[i % 3], 1.4, a); }
    },
  };

  // 赛博荧光：扫描线 + 数据错位（色块切片、横向撕裂、RGB 分离条）。
  function slices(env, x, y, w, h, n, amp, a, salt) {
    const g = env.g; g.globalCompositeOperation = env.dark ? 'lighter' : 'source-over';
    for (let i = 0; i < n; i++) { const r = env.r(salt + i + Math.floor(env.now * 16) * 7), yy = y + (r - .5) * h, hh = (2 + env.r(salt + i * 3) * 10) * env.k, dx = (env.r(salt + i * 5 + Math.floor(env.now * 12)) - .5) * amp;
      g.fillStyle = rgba(env.dark ? env.pal[1] : paperTone(env.pal[1], env.pal), .45 * a); g.fillRect(x - w / 2 + dx, yy, w * (.2 + r * .6), hh);
      g.fillStyle = rgba(env.dark ? env.pal[2] : paperTone(env.pal[2], env.pal), .45 * a); g.fillRect(x - w / 2 + dx + 6 * env.k, yy + hh * .5, w * (.15 + r * .5), hh * .5); }
    g.globalCompositeOperation = 'source-over';
  }
  M.datamosh = {
    ult(env, T) {
      const {W, H, cx, cy, pal} = env, fade = 1 - seg(T, .93, 1), sy = (T * 2.2 % 1) * H;
      glow(env, poly([[0, sy], [W, sy]]), pal[2], 1.2, .9 * fade);
      for (let y = 0; y < H; y += 4) { const g = env.g; g.fillStyle = env.dark ? 'rgba(0,0,0,.08)' : 'rgba(40,20,60,.03)'; g.fillRect(0, y, W, 1); }
      const burst = T > .05 && T < .2 || T > R - .02 && T < R + .1;
      if (burst) slices(env, W / 2, H / 2, W, H, 22, W * .2, 1, 3);
      for (const [x, y, s] of [[W * .1, H * .14, 1], [W * .9, H * .86, -1]]) { const p = eo(seg(T, .05, .2)); glow(env, poly([[x, y + s * 40 * env.k * p], [x, y], [x + s * 140 * env.k * p, y]]), pal[2], 1.4, fade); glow(env, poly([[x + s * 10, y + s * 10], [x + s * 90 * env.k * p, y + s * 10]]), pal[1], .7, fade * .7); }
      if (T > R) { for (let i = 0; i < 5; i++) { const y = H * env.r(i + Math.floor(T * 30)); glow(env, poly([[0, y], [W, y]]), i % 2 ? pal[1] : pal[2], 1.2, 1 - seg(T, R, .96)); } bloom(env, cx + H * .3, cy, H * .3, pal[2], 1 - seg(T, R, .9)); }
    },
    hit(env, t) {
      const {x, y, pal} = env, a = 1 - seg(t, .5, 1), s = 70 * env.k;
      slices(env, x, y, 220 * env.k, 120 * env.k, env.crit ? 12 : 7, 60 * env.k, a, 11);
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) glow(env, poly([[x + sx * s, y + sy * (s - 14 * env.k)], [x + sx * s, y + sy * s], [x + sx * (s - 14 * env.k), y + sy * s]]), pal[2], 1.2, a);
    },
  };

  // 忍者：烟雾弹团团炸开，一记弧斩带三道残影分身；释放时一圈烟环。
  function smoke(env, x, y, r, a) {
    const g = env.g, c = env.dark ? [200, 192, 205] : [150, 140, 155];
    for (let i = 0; i < 6; i++) { const an = env.r(i + x) * TAU, d = r * .45, gr = g.createRadialGradient(x + Math.cos(an) * d, y + Math.sin(an) * d, 0, x + Math.cos(an) * d, y + Math.sin(an) * d, r * .7);
      gr.addColorStop(0, rgba(c, .32 * a)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.beginPath(); g.arc(x + Math.cos(an) * d, y + Math.sin(an) * d, r * .7, 0, TAU); g.fill(); }
  }
  function crescentCut(env, x, y, r, rot, a, c) { glow(env, g => { g.beginPath(); g.arc(x, y, r, rot - 1.1, rot + 1.1); g.arc(x + Math.cos(rot) * r * .22, y + Math.sin(rot) * r * .22, r * .86, rot + .95, rot - .95, true); g.closePath(); }, c, 1.1, a); fill(env, g => { g.beginPath(); g.arc(x, y, r, rot - 1.1, rot + 1.1); g.arc(x + Math.cos(rot) * r * .22, y + Math.sin(rot) * r * .22, r * .86, rot + .95, rot - .95, true); g.closePath(); }, c, a * .35, true); }
  M.smokeclone = {
    ult(env, T) {
      const {W, H, cx, cy, pal} = env, fade = 1 - seg(T, .94, 1);
      for (let i = 0; i < 5; i++) { const p = seg(T, .04 + i * .09, .4 + i * .09); if (p > 0 && p < 1) smoke(env, W * (.1 + .8 * env.r(i + 3)), H * (.2 + .6 * env.r(i + 13)), H * .16 * eo(p), (1 - p)); }
      const c = seg(T, R - .06, R + .04);
      if (c > 0) for (let k = 3; k >= 0; k--) { const lag = k * .045, q = eo(seg(T, R - .06 + lag, R + .04 + lag)); crescentCut(env, cx + H * .35 - k * 40 * env.k, cy, H * .28, -.5 + q * .9, (k ? .25 / k : 1) * (1 - seg(T, R + .04, .97)), k ? pal[1] : WHITE); }
      if (T > R) smoke(env, cx + H * .3, cy, H * .45 * eo(seg(T, R, 1)), (1 - seg(T, R, 1)) * .8 * fade);
    },
    hit(env, t) {
      const {x, y, pal} = env, a = 1 - seg(t, .5, 1);
      smoke(env, x, y, 90 * env.k * eo(seg(t, 0, .7)), 1 - seg(t, .2, 1));
      for (let k = 2; k >= 0; k--) crescentCut(env, x - k * 26 * env.k, y, 70 * env.k, -.4 + eo(seg(t, k * .05, .25 + k * .05)) * .8, a * (k ? .3 / k : 1), k ? pal[1] : WHITE);
    },
  };

  // 立冬：一缕缕热气上升（竖向扭动的发丝），暖橘灯笼慢慢浮起，释放时灯笼一齐亮。
  function lantern(env, x, y, s, a, on) {
    const warm = [255, 150, 60];
    bloom(env, x, y, s * (2.2 + on), warm, a * (.5 + on * .5));
    fill(env, ellipse(x, y, s * .8, s, 0), rgba(env.dark ? [220, 60, 40] : [200, 50, 40], a * .85));
    for (const u of [-.5, 0, .5]) solid(env, ellipse(x, y, s * .8 * Math.abs(Math.cos(u * 1.2)), s, 0, -Math.PI / 2, Math.PI / 2), [255, 190, 120], .7, a * .5);
    solid(env, poly([[x - s * .3, y - s], [x + s * .3, y - s]]), [80, 40, 30], 2.4, a); solid(env, poly([[x, y + s], [x, y + s * 1.5]]), [255, 190, 90], 1, a);
  }
  function wisp(env, x, y, h, phase, a, c) { glow(env, poly(sample(24, s => [x + Math.sin(s * 6 + phase) * 10 * env.k * s, y - s * h])), c, .8, a); }
  M.lantern = {
    ult(env, T) {
      const {W, H, pal} = env, fade = 1 - seg(T, .94, 1);
      for (let i = 0; i < 9; i++) { const u = (T * .6 + env.r(i)) % 1; wisp(env, W * (.05 + .9 * env.r(i + 30)), H * (1.05 - u * .3), H * .3, T * 8 + i, Math.sin(u * Math.PI) * .6 * fade, mix(pal[1], WHITE, .3)); }
      for (let i = 0; i < 6; i++) { const r = env.r(i + 50), rise = eo(seg(T, .04 + r * .2, 1)); lantern(env, W * (.08 + i * .17 + r * .04), lerp(H * 1.1, H * (.25 + r * .4), rise), (16 + r * 10) * env.k, fade * seg(T, .04, .2), seg(T, R - .02, R + .05) * (1 - seg(T, R + .05, .98))); }
    },
    hit(env, t) {
      const {x, y, pal} = env, a = 1 - seg(t, .6, 1);
      lantern(env, x, y - 20 * env.k * eo(t), 18 * env.k, a, 1 - seg(t, 0, .5));
      for (let i = 0; i < 4; i++) wisp(env, x + (i - 1.5) * 22 * env.k, y + 40 * env.k, 120 * env.k * eo(seg(t, 0, .8)), t * 10 + i, a * .7, mix(pal[1], WHITE, .3));
    },
  };

  // 小雪：大的发丝六角冰晶自己长出来（六臂 + 分枝），慢慢落；释放时一圈霜裂线。
  function crystal(env, x, y, r, p, rot, a, c) {
    for (let k = 0; k < 6; k++) { const an = rot + k * Math.PI / 3, ex = x + Math.cos(an) * r * p, ey = y + Math.sin(an) * r * p;
      glow(env, poly([[x, y], [ex, ey]]), c, .9, a);
      for (const f of [.45, .7]) { if (p < f) continue; const bx = x + Math.cos(an) * r * f, by = y + Math.sin(an) * r * f, l = r * (1 - f) * .55 * seg(p, f, 1);
        for (const sg of [-1, 1]) glow(env, poly([[bx, by], [bx + Math.cos(an + sg * .9) * l, by + Math.sin(an + sg * .9) * l]]), c, .7, a); } }
    glow(env, poly(sample(6, s => [x + Math.cos(rot + s * TAU) * r * .16 * p, y + Math.sin(rot + s * TAU) * r * .16 * p])), c, .7, a);
  }
  M.firstsnow = {
    ult(env, T) {
      const {W, H, cx, cy, pal} = env, fade = 1 - seg(T, .94, 1), c = env.dark ? [230, 242, 255] : [62, 118, 186];
      for (let i = 0; i < 7; i++) { const r = env.r(i), g0 = .03 + r * .3, p = eo(seg(T, g0, g0 + .3)), fall = T * H * (.08 + r * .06); if (p > 0) crystal(env, W * (.06 + .88 * env.r(i + 20)), H * (.1 + .6 * env.r(i + 40)) + fall, (26 + r * 34) * env.k, p, r + T * .4, fade * (.6 + r * .4), c); }
      if (T > R) { const u = eo(seg(T, R, 1)); for (let k = 0; k < 12; k++) { const an = k / 12 * TAU + env.r(k) * .2, pts = sample(5, s => [cx + H * .3 + Math.cos(an + Math.sin(s * 9) * .08) * s * H * .5 * u, cy + Math.sin(an + Math.sin(s * 9) * .08) * s * H * .5 * u]); glow(env, poly(pts), c, .7, 1 - seg(T, R + .05, 1)); } }
    },
    hit(env, t) {
      const {x, y, pal} = env, c = env.dark ? [230, 242, 255] : [62, 118, 186];
      crystal(env, x, y + 10 * env.k * t, 54 * env.k, eo(seg(t, 0, .45)), t * .5, 1 - seg(t, .55, 1), c);
    },
  };

  // 大雪：极光幕。顶部几层竖向条纹的光带缓慢起伏，释放时整幕亮起。
  function aurora(env, x0, x1, y, h, T, a, n = 3) {
    const g = env.g; g.globalCompositeOperation = env.dark ? 'lighter' : 'source-over';
    const cols = [env.pal[1], [120, 220, 255], env.pal[2]];
    for (let L = 0; L < n; L++) for (let i = 0; i <= 60; i++) { const s = i / 60, x = lerp(x0, x1, s), wave = Math.sin(s * 5 + T * 3 + L * 1.7) * h * .25 + Math.sin(s * 13 + T * 5) * h * .05, yy = y + wave + L * h * .2;
      const c = cols[L % 3], gr = g.createLinearGradient(x, yy - h * .6, x, yy + h * .2), base = env.dark ? c : paperTone(c, env.pal);
      const k = (.5 + .5 * Math.sin(s * 40 + L)) * a * .35; gr.addColorStop(0, rgba(base, 0)); gr.addColorStop(.75, rgba(base, k)); gr.addColorStop(1, rgba(base, 0));
      g.fillStyle = gr; g.fillRect(x, yy - h * .6, (x1 - x0) / 60 + 1, h * .8); }
    g.globalCompositeOperation = 'source-over';
  }
  M.aurora = {
    ult(env, T) {
      const {W, H} = env, a = eo(seg(T, .03, .35)) * (1 - seg(T, .93, 1)) * (1 + seg(T, R, R + .04) * (1 - seg(T, R + .04, .95)) * .9);
      aurora(env, 0, W, H * .3, H * .5, T * 2, a);
    },
    hit(env, t) {
      const {x, y} = env; aurora(env, x - 120 * env.k, x + 120 * env.k, y - 30 * env.k, 120 * env.k, t * 3, Math.sin(seg(t, 0, 1) * Math.PI), 2);
      glow(env, circle(x, y, 30 * env.k + 70 * env.k * eo(seg(t, 0, .6))), env.pal[1], 1, 1 - seg(t, 0, .6));
    },
  };

  // 毕业：学位帽从底下抛起，透视的菱形帽顶翻转，流苏线跟着甩；释放时再抛一轮 + 金光。
  function cap(env, x, y, s, rot, flip, a) {
    const g = env.g, sq = Math.max(.15, Math.abs(Math.cos(flip))); g.save(); g.translate(x, y); g.rotate(rot); g.scale(1, sq);
    const dark = env.dark ? [36, 34, 56] : [26, 26, 46];
    fill(env, poly([[-s, 0], [0, -s * .5], [s, 0], [0, s * .5]], true), rgba(dark, a)); glow(env, poly([[-s, 0], [0, -s * .5], [s, 0], [0, s * .5]], true), env.pal[1], .7, a * .7); g.restore();
    const tx = x + Math.cos(rot) * s * .2, ty = y + Math.sin(rot) * s * .2; glow(env, poly([[tx, ty], [tx + Math.sin(flip) * s * .4, ty + s * .7]]), env.pal[1], 1.2, a); bloom(env, tx + Math.sin(flip) * s * .4, ty + s * .7, 5 * env.k, env.pal[1], a);
  }
  M.mortarboard = {
    ult(env, T) {
      const {W, H, cx, cy, pal} = env, fade = 1 - seg(T, .95, 1);
      for (const [vol, t0, n] of [[0, .03, 6], [1, R - .03, 9]]) for (let i = 0; i < n; i++) { const r = env.r(vol * 50 + i), u = seg(T, t0 + r * .05, t0 + .55 + r * .05); if (u <= 0 || u >= 1) continue;
        const x = W * (.1 + .8 * env.r(vol * 50 + i + 20)) + (r - .5) * u * W * .2, y = H * 1.1 - (u * 2 - u * u) * H * (.7 + r * .3); cap(env, x, y, (26 + r * 16) * env.k, (r - .5) * 1.2 + u * 3, u * 12 + r * 6, fade * (1 - seg(u, .8, 1))); }
      if (T > R) bloom(env, cx + H * .3, cy, H * .45, pal[1], (1 - seg(T, R, .96)) * .8);
    },
    hit(env, t) {
      const {x, y, pal} = env, u = eo(seg(t, 0, .7));
      cap(env, x, y - u * 120 * env.k, 24 * env.k, u * 2, u * 10, 1 - seg(t, .55, 1));
      glow(env, circle(x, y, 40 * env.k + 60 * env.k * u), pal[1], 1.1, 1 - seg(t, 0, .55));
    },
  };

  // 金章大师：玫瑰扭索纹（guilloché）的金章在中心压印——同心环 + 交织的正弦花环逐层描出，金箔飘落。
  function guilloche(env, x, y, r, p, rot, a) {
    const gold = env.pal[0];
    glow(env, circle(x, y, r), gold, 1.6, a); glow(env, circle(x, y, r * .93), gold, .6, a * .7);
    for (let L = 0; L < 3; L++) { const k = 12 + L * 6, rr = r * (.8 - L * .17), amp = r * .07; const pts = sample(240, s => { const th = s * TAU * p + rot; const q = rr + Math.sin(th * k) * amp; return [x + Math.cos(th) * q, y + Math.sin(th) * q]; }); glow(env, poly(pts), L === 1 ? env.pal[1] : gold, .55, a); }
    for (let i = 0; i < 60; i++) { const an = i / 60 * TAU + rot; if (i / 60 > p) break; glow(env, poly([[x + Math.cos(an) * r * .93, y + Math.sin(an) * r * .93], [x + Math.cos(an) * r, y + Math.sin(an) * r]]), gold, .6, a); }
  }
  function leaf(env, x, y, s, flip, c, a) { const w = Math.max(.12, Math.abs(Math.cos(flip))); fill(env, ellipse(x, y, s * w, s * .7, flip * .3), rgba(Math.cos(flip) > .9 ? mix(c, WHITE, .5) : Math.cos(flip) < 0 ? c.map(v => v * .7) : c, a)); }
  M.goldseal = {
    ult(env, T) {
      const {W, H, cx, cy, pal} = env, fade = 1 - seg(T, .94, 1), X = cx + H * .45, Y = cy - H * .02;
      const p = eo(seg(T, .05, .7)), press = seg(T, R - .02, R + .02), s = lerp(1.25, 1, eo(press));
      guilloche(env, X, Y, H * .2 * s, p, T * .3, fade * (.6 + .4 * press));
      if (T > R) { glow(env, circle(X, Y, H * .2 + H * .3 * eo(seg(T, R, 1))), pal[0], 2, 1 - seg(T, R, .96)); bloom(env, X, Y, H * .3, pal[0], (1 - seg(T, R, .9)) * .7); }
      for (let i = 0; i < 26; i++) { const r = env.r(i), u = seg(T, .1 + r * .5, .6 + r * .5); if (u > 0 && u < 1) leaf(env, W * env.r(i + 60) + Math.sin(u * 6 + i) * 30, lerp(-20, H, u), (6 + r * 5) * env.k, u * 14 + i, pal[0], (1 - seg(u, .8, 1)) * .95); }
    },
    hit(env, t) {
      const {x, y, pal} = env, a = 1 - seg(t, .55, 1);
      guilloche(env, x, y, 50 * env.k * lerp(1.3, 1, eo(seg(t, 0, .2))), eo(seg(t, 0, .4)), t, a);
      for (let i = 0; i < 8; i++) { const an = env.r(i) * TAU, u = eo(seg(t, .1, .9)); leaf(env, x + Math.cos(an) * u * 90 * env.k, y + Math.sin(an) * u * 60 * env.k + u * u * 50 * env.k, 5 * env.k, u * 12 + i, pal[0], a); }
    },
  };

  // 形态 → 签名（目录 forms.json 的 sig 字段优先；后端旧版没有这个字段时用这张表）。
  const BY_FORM = {daily: 'party', learning: 'pen', project: 'blueprint', thinking: 'lattice', unrestricted: 'prism', detective: 'lens', pirate: 'chart', astronaut: 'orbit',
    'dragon-rider': 'dragon', queen: 'carpet', princess: 'rose', knight: 'aegis', chef: 'piping', 'magical-girl': 'ribbon', astrologer: 'zodiac', zhuangyuan: 'scroll',
    idol: 'spotlight', cyber: 'datamosh', ninja: 'smokeclone', lidong: 'lantern', xiaoxue: 'firstsnow', daxue: 'aurora', graduate: 'mortarboard', 'gold-master': 'goldseal'};
  const LABEL = {party: '派对拉炮', pen: '钢笔批注', blueprint: '蓝图里程碑', lattice: '思维晶格', prism: '色散波', lens: '放大镜与红线', chart: '藏宝图与罗盘', orbit: '轨道', dragon: '龙影吐息',
    carpet: '红毯王冠', rose: '玫瑰薄纱', aegis: '盾光交剑', piping: '奶油裱花', ribbon: '缎带变身', zodiac: '星盘星座', scroll: '金榜朱批', spotlight: '追光荧光海', datamosh: '数据错位',
    smokeclone: '烟遁残影', lantern: '热气灯笼', firstsnow: '初雪冰晶', aurora: '极光幕', mortarboard: '抛帽', goldseal: '金章压印'};
  function of(form) {
    if (!form) return null;
    const id = typeof form === 'string' ? form : form.sig || form.id;
    return M[id] ? id : BY_FORM[id] || BY_FORM[typeof form === 'object' ? form.id : ''] || null;
  }

  // ── 画布与实例 ──
  const st = {canvas: null, ctx: null, dpr: 1, list: [], w: 0, h: 0};
  function ensureCanvas(layer) {
    if (!st.canvas) { const c = st.canvas = document.createElement('canvas'); c.className = 'pk-gamefx-sig'; c.setAttribute('aria-hidden', 'true'); st.ctx = c.getContext('2d'); }
    if (layer && st.canvas.parentElement !== layer) layer.append(st.canvas);
    const dpr = Math.min(2, window.devicePixelRatio || 1) * (window.__pinkieGameFx?.settings?.().res || 1), w = innerWidth, h = innerHeight;
    if (w !== st.w || h !== st.h || dpr !== st.dpr) { st.w = w; st.h = h; st.dpr = dpr; st.canvas.width = Math.round(w * dpr); st.canvas.height = Math.round(h * dpr); st.canvas.style.width = w + 'px'; st.canvas.style.height = h + 'px'; }
    return st.ctx;
  }
  // start({kind: 'ult'|'hit', id, x, y, crit, palette, dark, time, dur, layer, cineGeo})
  function start(o) {
    const id = of(o.id); if (!id || !st.ctx && !ensureCanvas(o.layer)) return null;
    ensureCanvas(o.layer);
    if (o.kind === 'ult') st.list = st.list.filter(i => i.kind !== 'ult');
    const seed = Math.floor(Math.random() * 1e9), r = mulberry(seed), rs = [];
    const inst = {kind: o.kind, id, t0: o.time, dur: o.dur || (o.crit ? .85 : .62), x: o.x, y: o.y, crit: Boolean(o.crit), pal: (o.palette?.length ? o.palette : ['#F7A8C8', '#DB1F74', '#FFD36E']).slice(0, 3).map(hex), dark: o.dark, geo: o.cineGeo, memo: new Map(),
      r: i => { while (rs.length <= i) rs.push(r()); return rs[i]; }};
    if (st.list.length > 24) st.list.shift();
    st.list.push(inst); st.canvas.dataset.live = '1'; return inst;
  }
  function stopUlt() { st.list = st.list.filter(i => i.kind !== 'ult'); if (!st.list.length) clear(); }
  function clear() { if (!st.ctx) return; st.ctx.setTransform(1, 0, 0, 1, 0, 0); st.ctx.clearRect(0, 0, st.canvas.width, st.canvas.height); st.canvas.dataset.live = '0'; }
  // 大招时间：释放（.84）之前跟着过场走；释放之后按引擎时间再走 TAIL 秒，过场结束了也画完（被跳过时由 stopUlt 直接清掉）。
  const TAIL = .7;
  function ultT(inst, time, cine) {
    if (cine && inst.tR == null) { const T = clamp(cine.t / cine.dur, 0, 1); if (T < R) return T; inst.tR = time - (T - R) * cine.dur; inst.span = cine.dur * (1 - R) + TAIL; }
    if (inst.tR == null) return 2;
    return R + (1 - R) * (time - inst.tR) / inst.span;
  }
  // 每帧由引擎调：time = 引擎时间（会被顿帧冻住、被审片放慢），cine = 当前过场 {t, dur, geo} 或 null。返回还有没有实例活着。
  function frame(time, cine, density = 1) {
    if (!st.ctx) return false;
    const g = st.ctx; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, st.canvas.width, st.canvas.height);
    if (!st.list.length) { st.canvas.dataset.live = '0'; return false; }
    g.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    const W = st.w, H = st.h;
    st.list = st.list.filter(inst => {
      const T = inst.kind === 'ult' ? ultT(inst, time, cine) : (time - inst.t0) / inst.dur;
      if (T >= 1 || T < 0 && inst.kind !== 'ult') return T < 0;
      const geo = inst.geo || cine?.geo || {c: [0, 0]}, k = inst.kind === 'ult' ? Math.max(.8, H / 900) : (inst.crit ? 1.3 : 1) * Math.max(.75, Math.min(1.2, H / 900));
      const env = {g, W, H, cx: W / 2 + geo.c[0] * H, cy: H / 2 - geo.c[1] * H, x: inst.x, y: inst.y, crit: inst.crit, pal: inst.pal, dark: inst.dark, k, now: time, r: inst.r, density,
        memo: (key, f) => { if (!inst.memo.has(key)) inst.memo.set(key, f()); return inst.memo.get(key); }};
      try { g.save(); (inst.kind === 'ult' ? M[inst.id].ult : M[inst.id].hit)(env, clamp(T, 0, 1)); } catch { /* 单个母题出错不影响其它 */ } finally { g.restore(); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
      return true;
    });
    if (!st.list.length) st.canvas.dataset.live = '0';
    return st.list.length > 0;
  }
  window.__pinkieGameSig = {of, start, frame, stopUlt, clear, alive: () => st.list.length > 0, ids: Object.keys(M), byForm: BY_FORM, label: LABEL, _st: st};
})();
