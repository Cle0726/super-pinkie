/* cle-classic:v1 —— 原有的形态，原样搬到连笔引擎里
 *
 *   think  思绪流：∞ 形流线两瓣轮流鼓起，念头追赶、核心心跳   read   铺成倾斜书页，扫描光逐行掠过
 *   write  羽毛笔按笔顺书写签名（循环）      edit   体素化分层错位，e 炸开重组
 *   done   落款：羽毛笔快速签名 → 句点墨晕 → 光沿笔顺流过 → 羽毛化开 → 收拢为矢量签名
 *
 * 公式、随机分布都和原来着色器里的一样，停下来时是同一堆点；只是点和粒子的对应关系按笔顺排过，
 * 于是进出这些形态时也是一根线在变。
 */
import {TAU, STRIDE, X, Y, Z, W, GLOW, ALPHA, SIZE, VIEW, clamp, fract, lerp, smooth, viewX, viewY, worldX, worldY, buildTimeline, assign} from './laolao-cle-kit.js';

// 原着色器 hash() 在显卡上算出来的值。JS 的双精度 sin 算不出同样的数，所以直接记下来
const READ_LEN = [.2036, .4258, .8633, .1748, .7578, .8789].map((h) => .55 + .45 * h);
const FORKED = [new Set([51]), new Set([17, 29, 42, 47, 51])];    // 分叉的羽枝：左、右
const hash = (n) => fract(Math.sin(n) * 43758.5453);
const step = (edge, x) => (x < edge ? 0 : 1);
const ease = (x) => x * x * (3 - 2 * x);

export function classicForms({P, sig, out}) {
  const {n, seed, text} = P;
  const sx = (i) => seed[i * 4], sy = (i) => seed[i * 4 + 1], sz = (i) => seed[i * 4 + 2], sw = (i) => seed[i * 4 + 3];
  const all = Array.from({length: n}, (_, i) => i), identity = () => Int32Array.from(all);
  // 世界坐标写回画布坐标：和其它形态在同一个空间里插值
  function world(i, x, y, z, g, dens = 1, size = 1) {
    const o = i * STRIDE;
    out[o + X] = viewX(x); out[o + Y] = viewY(y); out[o + Z] = z;
    out[o + W] = 0; out[o + GLOW] = g; out[o + ALPHA] = dens; out[o + SIZE] = size;
  }

  /* 待机：签名本身（中心线 + 笔宽） */
  const idle = {
    place(i) {
      const o = i * STRIDE, dot = P.width[i] === 0;
      out[o + X] = dot ? viewX(text[i * 3]) : P.cx[i];
      out[o + Y] = dot ? viewY(text[i * 3 + 1]) : P.cy[i];
      out[o + Z] = text[i * 3 + 2];
      out[o + W] = P.width[i];
    },
  };

  /* 思考：思绪流。两瓣轮流鼓起，两颗念头追赶，穿过交叉点时点亮核心 */
  const thinkSeed = identity();
  // C 走左瓣（和 C 一样逆时针），l·e·下划线走右瓣；核心和火花不动
  assign(thinkSeed, all.filter((i) => sw(i) >= .26), (i) => fract(sx(i) + .5));
  const cX = Math.cos(.42), sX = Math.sin(.42), cY = Math.cos(-.1), sY = Math.sin(-.1);
  let weigh = 0, beat = 0, flash = 0, h1 = 0, h2 = 0, px = 0, py = 0, pz = 0;
  function thinkPath(s, t) {
    const a = s * TAU, side = Math.sin(a);
    px = 3.25 * side * (1 + .17 * weigh * side);
    py = 1.22 * Math.sin(2 * a) * (1 + .22 * weigh * side) + .13 * Math.sin(a * 6 - t * 3.6);
    pz = .9 * Math.cos(2 * a);
  }
  function tilted(i, x, y, z, g, d, size) {
    const x1 = cY * x + sY * z, z1 = -sY * x + cY * z;
    world(i, x1, cX * y - sX * z1, sX * y + cX * z1, g, d, size);
  }
  const think = {
    seeds: thinkSeed,
    frame(t) {
      weigh = Math.sin(t * 1.05);
      const ph = fract(t / 1.3);
      beat = Math.exp(-(((ph - .08) * 15) ** 2)) + .6 * Math.exp(-(((ph - .27) * 15) ** 2));
      h1 = fract(t * .17); h2 = fract(t * .115 + .41);
      const c1 = Math.abs(fract(h1 * 2 + .5) - .5), c2 = Math.abs(fract(h2 * 2 + .5) - .5);
      flash = Math.exp(-c1 * c1 * 900) + Math.exp(-c2 * c2 * 900);
    },
    place(i, t) {
      const j = thinkSeed[i], a = sx(j), b = sy(j), c = sz(j), w = sw(j);
      if (w < .1) {                                        // 核心
        const dx = a - .5 + 1e-4, dy = b - .5 + 1e-4, dz = c - .5 + 1e-4, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const r = (.2 + .16 * beat + .12 * flash) * Math.sqrt(fract(w * 37.1));
        tilted(i, dx / len * r + .02 * Math.sin(t * 19 + a * 80), dy / len * r + .02 * Math.sin(t * 19 + b * 80), dz / len * r + .02 * Math.sin(t * 19 + c * 80),
          .55 + .7 * beat + .9 * flash, .9, 1.1 + .4 * beat);
      } else if (w < .26) {                                // 火花：核心 → 流线
        const k = t * (.5 + .35 * a) + c, f = fract(k), e = 1 - (1 - f) ** 3, arc = Math.sin(f * 3.14159);
        thinkPath(fract(b + Math.floor(k) * .618), t);
        tilted(i, px * e, py * e + .5 * (a - .5) * arc, pz * e + .7 * (b - .5) * arc,
          .3 + 1.1 * (1 - f), smooth(0, .06, f) * (1 - smooth(.7, 1, f)) * .85, .75);
      } else {                                             // 流线
        let s = fract(a + t * .06);
        s = fract(s + .035 * Math.sin(TAU * (2 * s - t * .32)));
        const d1 = fract(h1 - s), d2 = fract(h2 - s);
        const lead = Math.max(Math.exp(-(1 - d1) * 70), Math.exp(-(1 - d2) * 70));
        const hot = Math.max(Math.exp(-d1 * 16), Math.exp(-d2 * 16)), spread = 1 - .6 * hot;
        thinkPath(s, t);
        tilted(i, px, py + (b - .5) * .24 * spread, pz + (c - .5) * .24 * spread,
          .1 + 1.25 * hot + .6 * lead, .45 + .55 * Math.max(hot, lead), .85 + .75 * hot);
      }
    },
  };

  /* 读：倾斜书页。笔顺对应成一行行来回折的连续折线 */
  const readSeed = identity();
  assign(readSeed, all, (i) => { const line = Math.floor(sy(i) * 6); return line + (line % 2 ? 1 - sx(i) : sx(i)) * .999; });
  const rc = Math.cos(-.32), rs = Math.sin(-.32), yc = Math.cos(-.42), ys = Math.sin(-.42);
  let cur = 0, along = 0;
  const read = {
    seeds: readSeed,
    frame(t) { cur = Math.floor(t * .7) % 6; along = fract(t * .7); },
    place(i) {
      const j = readSeed[i], line = Math.min(5, Math.floor(sy(j) * 6)), len = READ_LEN[line], u = sx(j) * len;
      const x = (u + Math.floor(u * 9) * .012 - .5) * 6.2, scan = lerp(-3.3, 3.3 * len, along), here = line === cur;
      const hot = here ? smooth(.75, 0, Math.abs(x - scan)) : 0;
      const read0 = step(line, cur - .5) + (here ? step(x, scan) : 0);
      const y = (2.5 - line) * .42 + hot * .08, z = (sz(j) - .5) * .06 + hot * .55;
      const y1 = rc * y - rs * z, z1 = rs * y + rc * z;
      world(i, yc * x + ys * z1, y1 + .1, -ys * x + yc * z1, hot + read0 * .12);
    },
  };

  /* 改：体素化分层错位，e 炸开重组 */
  const cell = .2;
  let burst = 0;
  const edit = {
    frame(t) { burst = smooth(.15, .85, .5 + .5 * Math.sin(t * 2.1)); },
    place(i, t) {
      const ax = text[i * 3], ay = text[i * 3 + 1], az = text[i * 3 + 2], row = Math.floor(ay / .55), ph = t * 1.8 + row * 1.9;
      let x = Math.floor(ax / cell) * cell + cell * .5, y = Math.floor(ay / cell) * cell + cell * .5, z = Math.floor(az / cell) * cell + cell * .5;
      let g = .15, d = 1;
      x += Math.sin(ph) * .22 * (((row % 2) + 2) % 2);
      z += Math.cos(ph) * .45;
      if (P.letter[i] === 2) {
        const k = burst * burst;
        x += (sx(i) - .5) * 1.5 * k; y += (sy(i) - .5) * 1.5 * k; z += (sz(i) - .5) * 2.4 * k;
        g = .3 + burst * .4; d = 1 - burst * .55;
      }
      world(i, x, y, z, g, d);
    },
  };

  /* 写与落款 */
  const quillSeed = identity();
  // 羽毛从上往下铺：C 去羽梢，下划线落到笔尖
  assign(quillSeed, all.filter((i) => P.quill[i]), (i) => {
    const k = sx(i), b = sy(i);
    if (k < .09) return 3 + (1 - b) * .99;                 // 笔尖
    if (k < .21) return 2 + (1 - b) * .99;                 // 羽杆
    return sz(i) < .58 ? (1 - b) * .99 : 1 + b * .99;      // 左羽片向下、右羽片向上
  });
  const loopTL = buildTimeline(sig, 1, true), signTL = buildTimeline(sig, 2, false), signEnd = signTL.end + .55;
  // 从签名变进来时 C 已经在纸上：笔从 l 起笔接着写，不先缩成一个点再从头来
  const resume = loopTL.steps.find((s) => s.kind === 'air' && s.to === 2).t1;
  const segs = sig.segs, last = segs.length - 1;
  const pen = {x: 0, y: 2, z: 0, press: 0, write: 1.1, ink: 1}, prev = {x: 0, y: 0}, drag = {x: 0, y: 0}, qm = new Float64Array(9);
  function point(k, f, to) {
    const s = segs[k], p = s.dot ? s.c : s.pts[clamp(Math.round(f * (s.pts.length - 1)), 0, s.pts.length - 1)];
    to.x = worldX(p.x); to.y = worldY(p.y);
    return to;
  }
  const a0 = {x: 0, y: 0}, b0 = {x: 0, y: 0};
  function penAt(tl, time) {                               // 笔顺 → 笔尖位置、笔压、已写进度
    const t = isFinite(tl.period) ? time % tl.period : time;
    let st = tl.steps[tl.steps.length - 1];
    for (const s of tl.steps) if (t < s.t1) { st = s; break; }
    const f = clamp((t - st.t0) / (st.t1 - st.t0));
    pen.press = 1; pen.write = 0; pen.ink = 1;
    switch (st.kind) {
      case 'enter': point(0, 0, pen); pen.press = ease(f); break;
      case 'draw': {
        const s = segs[st.seg], k = ease(f) * .2 + f * .8;
        point(st.seg, k, pen); pen.write = s.o0 + (s.o1 - s.o0) * k;
        pen.press = .85 + .15 * Math.sin(f * Math.PI);
        break;
      }
      case 'dab': {
        const s = segs[st.seg];
        point(st.seg, 0, pen); pen.write = s.o0 + (s.o1 - s.o0) * ease(f);
        pen.press = Math.sin(f * Math.PI) * 1.25;
        break;
      }
      case 'air':
        point(st.from, 1, a0); point(st.to, 0, b0);
        pen.x = lerp(a0.x, b0.x, ease(f)); pen.y = lerp(a0.y, b0.y, ease(f)); pen.write = segs[st.from].o1;
        pen.press = 1 - Math.sin(f * Math.PI) * 1.1;
        break;
      case 'hold': point(last, 1, pen); pen.write = 1.02; pen.press = Math.max(0, 1 - f * 3); break;
      case 'leave': point(last, 1, pen); pen.x += ease(f) * 1.2; pen.y += ease(f) * .6; pen.write = 1.02; pen.press = 0; break;
      default:
        point(last, 1, a0); point(0, 0, b0);
        pen.x = lerp(a0.x + 1.2, b0.x, ease(f)); pen.y = lerp(a0.y + .6, b0.y, ease(f));
        pen.write = 1.02; pen.press = 0; pen.ink = 1 - ease(f);
    }
    pen.press = Math.max(0, pen.press);
  }
  function holdPen(tl, t, dt, from) {
    penAt(tl, Math.max(0, t + from));
    if (dt > 0 && t > dt) {
      const vx = (pen.x - prev.x) / dt, vy = (pen.y - prev.y) / dt, k = Math.min(1, dt * 8);
      drag.x += (clamp(vx * .22, -1, 1) - drag.x) * k;
      drag.y += (clamp(vy * .22, -1, 1) - drag.y) * k;
    } else { drag.x = drag.y = 0; }
    prev.x = pen.x; prev.y = pen.y;
    // rotZ · rotX · rotY
    const rz = -.86 - drag.x * .14, rx = -.22 + drag.y * .1, ry = .35 + Math.sin(t * .8) * .3;
    const A = Math.cos(rz), B = Math.sin(rz), C = Math.cos(rx), D = Math.sin(rx), E = Math.cos(ry), F = Math.sin(ry);
    qm[0] = A * E - B * D * F; qm[1] = -B * C; qm[2] = A * F + B * D * E;
    qm[3] = B * E + A * D * F; qm[4] = A * C; qm[5] = B * F - A * D * E;
    qm[6] = -C * F; qm[7] = D; qm[8] = C * E;
  }
  let sweep = -1, released = 0;
  function writing(i, t) {
    // 已写出的墨
    const order = P.order[i], seedX = sx(i);
    const dry = smooth(.8, 1, P.local[i]) * step(.5, hash(seedX * 91));
    let dens = pen.ink * (1 - dry * .7);
    let g = smooth(.05, 0, pen.write - order) * 1.1 + smooth(.045, 0, Math.abs(order - sweep)) * 1.4;
    let x = text[i * 3] + .006 * Math.sin(t * .9 + seedX * 40);
    let y = text[i * 3 + 1] + .006 * Math.cos(t * .7 + sy(i) * 40);
    let z = text[i * 3 + 2] + .006 * Math.sin(t * .8 + sz(i) * 40);
    if (!P.quill[i]) {
      if (order > pen.write) { x = pen.x; y = pen.y; z = pen.z; g = 0; dens = 0; }   // 未写到：藏在笔尖
      world(i, x, y, z, g, dens);
      return;
    }
    // 羽毛笔：笔尖、羽杆、56 根离散羽枝
    const j = quillSeed[i], k = sx(j), b = sy(j), c = sz(j), w = sw(j);
    let qx, qy, qz, qg = 0, qd;
    if (k < .09) {
      const h = b * .34, r = .055 * (h / .34), side = c < .5 ? -1 : 1;
      qx = side * (r * (.35 + .65 * w) + .006 * smooth(0, .22, h)) * (1 + pen.press * .8); qy = h; qz = (w - .5) * .012;
      qg = .95 * (1 - h / .34); qd = .95;
    } else if (k < .21) {
      const h = .3 + b * 3.3, a = c * TAU;
      qx = .06 * h * h / 3.4 + Math.cos(a) * .018; qy = h; qz = Math.sin(a) * .018;
      qd = .7; qg = .1;
    } else {
      const left = c < .58, side = left ? -1 : 1, bi = Math.floor(b * 56), f = (bi + .5) / 56, y0 = .62 + f * 2.85;
      const width = (left ? .74 : .4) * Math.sin(3.14159 * Math.min(1, f * 1.02 + .04)) ** .55 * (1 - .18 * f);
      const u = fract(w * 7.13), L = width * u * (FORKED[left ? 0 : 1].has(bi) ? .55 : 1);
      qx = .06 * y0 * y0 / 3.4 + side * L; qy = y0 + L * .55 + u * u * width * .22;
      qz = Math.sin(u * 3.14159) * .04 * side + (hash(bi * 3.1) - .5) * .03;
      qd = .62 + .3 * (1 - u); qg = .04;
    }
    qx = (qx + Math.sin(t * 3 + qy * 2) * .01 * qy) * 1.5; qy *= 1.5; qz *= 1.5;
    const lifted = 1 - pen.press;
    let fx = pen.x + qm[0] * qx + qm[1] * qy + qm[2] * qz;
    let fy = pen.y + lifted * .3 + qm[3] * qx + qm[4] * qy + qm[5] * qz;
    let fz = pen.z + lifted * .22 + qm[6] * qx + qm[7] * qy + qm[8] * qz;
    if (released > 0) {                                    // 羽毛一缕缕化开，落回笔画
      const m = smooth(b * .5, b * .5 + .5, released), puff = Math.sin(m * 3.14159) * .9;
      fx = lerp(fx, x, m) + puff * (sx(j) - .5); fy = lerp(fy, y, m) + puff * (b - .5); fz = lerp(fz, z, m) + puff * (c - .5);
      qg = lerp(qg, g, m); qd = lerp(qd, dens, m);
    }
    world(i, fx, fy, fz, qg, qd, .58);
  }
  const write = {
    live: true, seeds: quillSeed,
    frame(t, dt) { holdPen(loopTL, t, dt, resume); sweep = -1; released = 0; },
    place: writing,
  };
  const done = {
    live: true, seeds: quillSeed,
    fx: {ring: .05, ringAlpha: 0, alpha: 1, paper: 0, settled: false},
    frame(t, dt) {
      holdPen(signTL, t, dt, -.5);
      const d = t - signEnd, fx = this.fx, r = clamp(d / .9), power2 = (x) => (x < .5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
      const s = clamp((d - .1) / 1.1);
      sweep = d < .1 ? -1 : -.05 + 1.13 * (.5 - .5 * Math.cos(Math.PI * s));
      released = power2(clamp((d - .55) / .9));
      fx.ring = .05 + 1.55 * (1 - (1 - r) * (1 - r));
      fx.ringAlpha = d < 0 ? 0 : .9 * (1 - r * r);
      fx.paper = clamp((d - 1.45) / .5);
      fx.alpha = 1 - clamp((d - 1.55) / .6);
      fx.settled = d >= 2.2;
    },
    place: writing,
  };

  const dot = segs[last].c;
  return {idle, think, read, edit, write, done, ringAt: {x: (dot.x - VIEW.cx) / VIEW.scale, y: -(dot.y - VIEW.cy) / VIEW.scale}};
}
