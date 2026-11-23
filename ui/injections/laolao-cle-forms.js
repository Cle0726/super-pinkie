/* cle-forms:v1 —— 每种步骤一个形态，都由 C.le. 的笔画变出来
 *
 * 规矩：
 *   - 只用签名的 6 个部件（C、两个点、l、e、花式下划线），每个部件在形状里有固定的去处；
 *   - 笔触和签名一样：12° 斜度、下重上轻、收笔拖成发丝；
 *   - 部件的走向和签名一致（C 逆时针、l·e 从左往右、下划线先向右回勾再向左甩），变形时才不会拧成一团；
 *   - 循环动作里会「跳回起点」的地方，跳的那一刻必须是看不见的（透明度为 0）。
 * 坐标是签名的 200×96 画布。
 */
import {PART, E_END, TAU, STRIDE, X, Y, W, GLOW, ALPHA, SIZE, RED, clamp, fract, lerp, smooth, bump, pingPong3, pen, polyline} from './laolao-cle-kit.js';

/** 状态行的步骤类别 → 形态。 */
export const FORM_OF = Object.freeze({
  think: 'think',
  read: 'read', show: 'read',
  write: 'write', create: 'write', reply: 'write',
  edit: 'edit', move: 'edit',
  exec: 'exec',
  search: 'search', models: 'search',
  find: 'code',
  fetch: 'web', browse: 'web', webgpt: 'web',
  test: 'test', review: 'test',
  build: 'build',
  install: 'get', download: 'get',
  git: 'git',
  session: 'team', dispatch: 'team', manage: 'team',
  plan: 'plan',
  image: 'image', view: 'image', shot: 'image',
  memory: 'memory',
  ask: 'ask',
  wait: 'wait', cron: 'wait',
  delete: 'erase',
  computer: 'pointer',
  quiz: 'learn', lab: 'learn', grade: 'learn', note: 'learn',
  tool: 'tool',
  ok: 'ok', fail: 'fail', done: 'done', idle: 'idle', stopped: 'idle',
});
/** 不认识的类别用「其他工具」，不再停在上一步的样子。 */
export const formOf = (kind) => (Object.hasOwn(FORM_OF, kind) ? FORM_OF[kind] : 'tool');

export function inkForms({P, SIG, out}) {
  const {C, DOT1, L, E, TAIL, DOT2} = PART;
  const isDot = (p) => p === DOT1 || p === DOT2;
  const brush = (d, w, hair) => pen(SIG, d, w, hair);
  const leU = (i) => clamp(P.local[i] / E_END);            // l、e 连成一笔时的位置
  const tmp = [0, 0];

  function put(i, x, y, w = 0) {
    const o = i * STRIDE;
    out[o + X] = x; out[o + Y] = y; out[o + W] = w;
  }
  function look(i, glow, alpha = 1, size = 1) {
    const o = i * STRIDE;
    out[o + GLOW] = glow; out[o + ALPHA] = alpha; out[o + SIZE] = size;
  }
  // 沿一笔走：笔宽跟着笔压，再夹在 lo、hi 之间（小尺寸下既不断也不糊）
  function trace(i, line, u, lo = 0, hi = 99, dx = 0, dy = 0) {
    const n = line.length / 3 - 1, f = clamp(u) * n, j = Math.min(n - 1, Math.floor(f)), m = f - j, a = j * 3;
    put(i, lerp(line[a], line[a + 3], m) + dx, lerp(line[a + 1], line[a + 4], m) + dy, clamp(lerp(line[a + 2], line[a + 5], m), lo, hi));
  }
  function disc(i, x, y, rx, ry = rx) { put(i, x + P.discX[i] * rx, y + P.discY[i] * ry); }
  // 一圈：逆时针，左边下笔重、右边上笔轻
  function ring(i, u, cx, cy, rx, ry = rx, heavy = 2.3, from = -1.1) {
    const a = from - u * (TAU + .12), x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    put(i, cx + x - y * .12, cy + y, (1.6 + heavy * Math.max(0, -Math.cos(a))) * smooth(-.02, .04, u) * (1 - .7 * smooth(.93, 1, u)));
  }
  const slantX = (x, y) => SIG.skew(x, y).x;

  const forms = {};

  /* 搜索：C 合成带起笔小钩的镜圈，下划线甩成镜柄，l、e 断成一串信息点 */
  {
    const lens = brush('M97 24C94 17 88 14 79 15C62 16 52 30 55 47C58 65 78 73 94 65C110 57 114 34 101 21C96 16 90 14 83 15', 6.4);
    const grip = brush('M103 61C109 67 116 75 123 81C127 84.5 131 85 133 82', 7.6, true);
    let dx = 0, dy = 0, shine = 0;
    forms.search = {
      frame(t) { dx = Math.sin(t * 1.35) * 31; dy = Math.sin(t * 2.7) * 3; shine = t * .7; },
      place(i) {
        const p = P.part[i], u = P.u[i];
        if (p === C) {
          trace(i, lens, u, 2.4, 4.4, dx, dy);
          const d = fract(u - shine);
          look(i, .42 + .7 * bump(Math.min(d, 1 - d), .12));
        } else if (p === TAIL) {
          trace(i, grip, u, 0, 5, dx, dy);
          look(i, .45);
        } else {
          let col, row;
          if (p === L || p === E) {
            const k = Math.min(17, Math.floor(leU(i) * 18));
            col = Math.floor(k / 3); row = col % 2 ? k % 3 : 2 - (k % 3);
          } else { col = p === DOT1 ? 1 : 4; row = 1; }
          const y = 20 + row * 25, x = slantX(15 + col * 32, y), hot = 1 - smooth(19, 31, Math.hypot(x - 83 - dx, y - 42 - dy));
          disc(i, x, y, 2.5 + 3.4 * hot);
          look(i, hot * 1.2, .55 + .45 * hot);
        }
      },
    };
  }

  /* 命令：C 折成提示符，l、e 拉成输出行，下划线是正在敲的一行，两个点合成光标 */
  {
    const prompt = brush('M27 24C29 26 31 27 33 29C40 35 47 41 53 46.5C43 54.5 31 63 19 70', 7.4);
    const long = brush('M78 50C100 47 128 52 162 48', 11.5), short = brush('M78 50C96 48 114 51 138 48', 11.5);
    const typed = brush('M172 80C160 78 148 78 134 79C112 81 90 81 70 80', 15, true);
    let k = 0, cursor = 0;
    forms.exec = {
      frame(t) { k = fract(t * .46 + .3); cursor = 69 + Math.min(1, k / .8) * 101; },
      place(i, t) {
        const p = P.part[i], u = P.u[i];
        if (p === C) {
          trace(i, prompt, u, 2.4);
          look(i, .5);
        } else if (isDot(p)) {
          disc(i, cursor + 5, 78, 5.4, 7.8);
          const blink = k < .8 ? 1 : .35 + .65 * smooth(-.3, .3, Math.sin(t * TAU * 2.4));
          look(i, 1.1, smooth(0, .05, k) * blink * (1 - smooth(.93, 1, k)), 1.2);
        } else if (p === TAIL) {
          trace(i, typed, u, 1.3);
          const x = out[i * STRIDE + X], shown = Math.max(1 - smooth(cursor - 3, cursor + 3, x), .07);
          look(i, .2 + bump(x - cursor, 18) * .8, lerp(shown, .07, smooth(.9, 1, k)) * lerp(.07, 1, smooth(0, .04, k)) + .07);
        } else {
          const first = p === L, r = ((first ? 1.25 : .25) + t * .7) % 2, lift = 13 - r * 22;
          trace(i, first ? long : short, u, 0, 99, -lift * .21, lift);
          look(i, .3 * (1 - smooth(0, .6, r)), smooth(0, .16, r) * (1 - smooth(1.84, 2, r)) * .9);
        }
      },
    };
  }

  /* 查代码：C 和下划线折成一对尖括号，l、e、两个点是括号里的代码 */
  {
    const open = brush('M49 18C47 20 45 22 42 25C32 34 22 42 13 48.5C21 57 31 68 44 80', 6.6);
    const close = brush('M147 18C149 20 151 22 154 25C163 34 172 42 179 48.5C171 57 158 69 146 80', 6.6);
    let cur = 0, wide = 0;
    forms.code = {
      frame(t) { cur = (t * 2.1) % 6; wide = Math.sin(t * 2) * 3; },
      place(i) {
        const p = P.part[i], u = P.u[i];
        if (p === C || p === TAIL) {
          trace(i, p === C ? open : close, u, 2, 5, p === C ? -wide : wide);
          look(i, .42);
          return;
        }
        const second = u > .5, k = p === L ? (second ? 1 : 0) : p === DOT1 ? 2 : p === DOT2 ? 3 : second ? 5 : 4;
        const d = ((cur - k - .5) % 6 + 9) % 6 - 3, hot = bump(d, .48);
        if (isDot(p)) {
          disc(i, p === DOT1 ? 82 : 116, 49, 13, 2.8 + hot * 1.8);
          look(i, hot * 1.2, .7 + .3 * hot, 1.3);
        } else {
          const y = p === L ? 30 : 68, x0 = p === L ? 66 : 62;
          put(i, slantX(x0 + u * (p === L ? 68 : 56), y), y + Math.sin(u * 9) * .5, 2.4 + hot * 2.6);
          look(i, hot * 1.2, (.65 + .35 * hot) * smooth(.04, .08, Math.abs(u - .5)));
        }
      },
    };
  }

  /* 看网页：C 闭成地球，l 一笔来回画出三条经线，e 变赤道，下划线甩成轨道，两个点是卫星 */
  {
    const cx = 96, cy = 48.5, R = 34;
    let head = 0;
    const orbitX = (a) => cx + Math.cos(a) * 86 + Math.sin(a) * 3;
    const orbitY = (a) => cy + Math.sin(a) * 17 - Math.cos(a) * 15;
    forms.web = {
      frame(t) { head = t * 1.7; },
      place(i, t) {
        const p = P.part[i], u = P.u[i];
        if (p === C) {
          ring(i, u, cx, cy, R);
          look(i, .4);
        } else if (p === L) {                              // 南极 → 北极 → 南极 → 北极：一笔不断
          const k = Math.min(2, Math.floor(u * 3)), f = u * 3 - k, v = k % 2 ? f : 1 - f, a = v * Math.PI;
          const phi = ((k + .5) * Math.PI / 3 + t * .8) % Math.PI - Math.PI / 2, y = -Math.cos(a) * R;
          put(i, cx + Math.sin(a) * Math.sin(phi) * R - y * .12, cy + y, .8 + 1.3 * Math.sin(a));
          look(i, .15, .9 * smooth(0, .3, Math.cos(phi)));
        } else if (p === E) {
          const a = Math.PI - u * TAU, y = Math.sin(a) * 9;
          put(i, cx + Math.cos(a) * R - y * .12, cy + y + 1, 1.6);
          look(i, .15, .3 + .55 * smooth(-.15, .15, Math.sin(a)));
        } else if (p === TAIL) {
          const a = -1.05 + u * TAU * .84, x = orbitX(a), d = fract((head - a) / Math.PI) * Math.PI;
          put(i, x, orbitY(a), (4.4 * smooth(-.05, .1, u) + .4) * (1 - .88 * smooth(.45, 1, u)));
          look(i, .15 + Math.exp(-d * 2) * 1.1, Math.sin(a) < 0 && Math.abs(x - cx) < R ? .08 : .9);
        } else {
          const a = head + (p === DOT2 ? Math.PI : 0);
          disc(i, orbitX(a), orbitY(a), 5.2);
          look(i, 1.1, 1, 1.2);
        }
      },
    };
  }

  /* 测试：C、l、e 各绕成一个圈，句点挨个跳进去检查（只表示「在查」，不提前打勾） */
  {
    const base = brush('M176 79C160 85 92 85 18 89', 8, true);
    const CX = [37, 95, 153];
    let at = 0, hop = 0, turnAt = 0;
    forms.test = {
      frame(t) { at = pingPong3(t * 1.25); hop = Math.sin(Math.PI * (at - Math.floor(at))); turnAt = fract(t * 1.1); },
      place(i) {
        const p = P.part[i], u = P.u[i];
        if (p === TAIL) {
          trace(i, base, u, .8, 3);
          look(i, .2 + bump(out[i * STRIDE + X] - 37 - at * 58, 20) * .7, .8);
        } else if (isDot(p)) {
          disc(i, 37 + at * 58, 45 - hop * 19, 7, 7 + hop);
          look(i, 1.05, 1, 1.55);
        } else {
          const k = p === C ? 0 : p === L ? 1 : 2, on = bump(at - k, .36), d = fract(u + turnAt);
          ring(i, u, CX[k], 45, 20 + on * 2.2, 20 + on * 2.2, 1.8, p === C ? -1.1 : Math.PI / 2);
          look(i, .12 + on * (.35 + bump(Math.min(d, 1 - d), .13)), .65 + .35 * on);
        }
      },
    };
  }

  /* 构建：三块方体各是一笔画成，依次抬起、落下、咬合 */
  {
    const R = 21, T = [0, -R], TR = [.866 * R, -.5 * R], TL = [-.866 * R, -.5 * R], BR = [.866 * R, .5 * R], BL = [-.866 * R, .5 * R], B = [0, R], M = [0, 0];
    const cube = polyline([TR, T, TL, BL, B, BR, TR, M, B, M, TL].flat());
    const CX = [77.8, 96, 114.2], CY = [67, 35.5, 67], lift = [0, 0, 0], land = [0, 0, 0];
    forms.build = {
      frame(t) {
        const c = fract(t * .5) * 3;
        for (let k = 0; k < 3; k++) {
          const s = c - k, on = s >= 0 && s <= 1;
          lift[k] = on ? Math.sin(s * Math.PI) ** 2 : 0;
          land[k] = on ? bump(s - .88, .1) : 0;
        }
      },
      place(i) {
        const p = P.part[i];
        if (isDot(p)) {
          disc(i, 96, 56.5, 3.6 + 3 * Math.max(land[0], land[1], land[2]));
          look(i, .6 + Math.max(land[0], land[1], land[2]), 1, 1.2);
          return;
        }
        const k = p === C ? 0 : p === TAIL ? 2 : 1, side = k === 0 ? -1 : k === 2 ? 1 : 0;
        cube.at(k === 1 ? leU(i) : P.u[i], tmp);
        put(i, CX[k] + side * 12 * lift[k] + tmp[0] - tmp[1] * .08, CY[k] + (k === 1 ? -10 : -8) * lift[k] + tmp[1], 2.2);
        look(i, .2 + .9 * Math.max(land[k], lift[k] * .4));
      },
    };
  }

  /* 安装 / 下载：C 竖成箭杆，l 挑成箭头，e 断成墨滴，下划线兜成托盘 */
  {
    const shaft = brush('M88 9C90 22 95 48 96 62C96 65 94 65 92 63C85 57 75 49 66 41', 5.4);
    const barb = brush('M94 65C100 59 108 50 116 41', 8.5);
    const tray = brush('M157 62C158 70 160 80 155 85C149 90 52 89 39 86C33 84 33 74 34 64', 8);
    const FALL = [56, 138, 72, 122, 44];
    let bob = 0, arrive = 0;
    forms.get = {
      frame(t) { bob = Math.sin(t * 3) * 3; arrive = .5 + .5 * Math.sin(t * 5); },
      place(i, t) {
        const p = P.part[i], u = P.u[i];
        if (p === C || p === L) {
          trace(i, p === C ? shaft : barb, u, 2, 4.6, 0, bob);
          look(i, .45 + .6 * bump(u - fract(t * .9) * 1.4 + .2, .15));
        } else if (p === TAIL) {
          trace(i, tray, u, 1.8, 4);
          look(i, .15 + .6 * arrive * bump(out[i * STRIDE + X] - 96, 30));
        } else {
          const k = p === DOT1 ? 1 : p === DOT2 ? 3 : Math.min(4, Math.floor(u * 5)), f = fract(t * .6 + k * .2 + .25);
          disc(i, FALL[k], 12 + f * f * 64, 3.2, 4.6);
          look(i, f, smooth(0, .16, f) * (1 - smooth(.82, 1, f)), p === E ? 1 : 1.3);
        }
      },
    };
  }

  /* Git：下划线是右端轻挑的主干，l、e 连成分支，C 卷成枝头的提交，两个点是分叉与合并 */
  {
    const rise = brush('M42 74C64 74 60 52 70 39C75 32 80 28 90 28', 6.6);
    const fall = brush('M97 28C114 28 120 38 129 52C137 65 141 74 154 74', 5);
    const trunk = brush('M183 64C179 71 170 75 152 74.5C114 73.5 62 72.5 14 77', 11, true);
    let head = 0;
    forms.git = {
      frame(t) { head = fract(t * .35) * 230 - 8; },
      place(i) {
        const p = P.part[i], u = P.u[i];
        if (isDot(p)) {
          const x = p === DOT1 ? 41 : 151, hot = bump(x - head, 18);
          disc(i, x, 74, 6.3 + 2.2 * hot);
          look(i, .55 + .7 * hot, 1, 1.75);
          return;
        }
        if (p === C) {
          const a = -1.2 - u * TAU * 1.9, r = 8.3 - 4.8 * smooth(.45, 1, u);
          put(i, 98 + Math.cos(a) * r, 28 + Math.sin(a) * r * .88, 3.4);
        } else if (p === TAIL) trace(i, trunk, u, .9, 3.4);
        else trace(i, p === L ? rise : fall, u, 1.7, 3.2);
        look(i, (p === C ? .5 : .22) + 1.05 * bump(out[i * STRIDE + X] - head, 17));
      },
    };
  }

  /* 子会话：C、l、e 绕成三颗卫星，下划线是它们和主核之间的连线，两个点是主核 */
  {
    const HX = 96, HY = 52, sx = [0, 0, 0], sy = [0, 0, 0], depth = [0, 0, 0];
    forms.team = {
      frame(t) {
        for (let k = 0; k < 3; k++) {
          const a = Math.PI + .2 + k * TAU / 3 + t * .7;
          sx[k] = HX + Math.cos(a) * 64; sy[k] = HY + Math.sin(a) * 27; depth[k] = .5 + .5 * Math.sin(a);
        }
      },
      place(i, t) {
        const p = P.part[i], u = P.u[i];
        if (isDot(p)) {
          disc(i, HX, HY, 8.5 + Math.sin(t * 2.6));
          look(i, .95, 1, 1.85);
        } else if (p === TAIL) {                           // 主核 → 卫星 → 主核 → …：一笔不断
          const k = Math.min(4, Math.floor(u * 5)), f = u * 5 - k, s = k >> 1, out0 = k % 2 ? 1 - f : f;
          put(i, lerp(HX, sx[s], out0), lerp(HY, sy[s], out0), 1.7);
          const hot = bump(out0 - (.5 + .5 * Math.sin(t * 2.6 + s * 2)), .14);
          look(i, hot * 1.3, (.4 + .6 * hot) * smooth(0, .12, out0) * (1 - smooth(.74, .84, out0)));
        } else {
          const k = p === C ? 0 : p === L ? 1 : 2, r = 12.5 + depth[k] * 2.5;
          ring(i, u, sx[k], sy[k], r, r * .92, 1.9, p === C ? -1.1 : Math.PI / 2);
          look(i, .2 + .45 * depth[k], .75 + .25 * depth[k]);
        }
      },
    };
  }

  /* 计划：每个部件写成一行「方框 + 一道」，两个点在正做的那一格里 */
  {
    const Y0 = [23, 49, 75], END = [160, 146, 172];
    const rows = Y0.map((y, k) => polyline([
      [33, y], [33, y - 8], [17, y - 8], [17, y + 8], [33, y + 8], [33, y], [46, y], [END[k], y - 1],
    ].flat()));
    let at = 0;
    forms.plan = {
      frame(t) { at = pingPong3(t * 1.05); },
      place(i) {
        const p = P.part[i];
        if (isDot(p)) {
          const y = 23 + at * 26;
          disc(i, slantX(25, y), y, 4.8);
          look(i, 1.1, 1, 1.7);
          return;
        }
        const k = p === C ? 0 : p === TAIL ? 2 : 1, u = k === 0 ? P.u[i] : k === 1 ? leU(i) : 1 - P.u[i];
        const line = rows[k], on = bump(at - k, .38), s = u * line.length;
        line.at(u, tmp);
        put(i, slantX(tmp[0], tmp[1]), tmp[1], (s < 64 ? 2.1 : 2.8 * (1 - .6 * smooth(.8, 1, u))) + on * 1.5);
        look(i, on, (.65 + .35 * on) * (s > 64.5 && s < 76.5 ? 0 : 1));
      },
    };
  }

  /* 图片：C 和下划线合成取景框，l、e 连成山，两个点是太阳，画面随扫描显影 */
  {
    const top = brush('M158 16C124 14 70 15 33 16C28 16 28 20 28 25C28 44 28 68 29 88', 8.5);
    const bottom = brush('M158 16C161 30 160 64 160 84C160 88 156 88 151 88C118 88 70 87 29 88', 8.5);
    const hills = brush('M37 81C47 70 60 52 72 42C76 39 88 60 94 65C100 58 109 47 117 46C124 47 139 68 150 81', 5.4);
    let scan = 0;
    forms.image = {
      frame(t) { scan = 96 + 84 * Math.cos(t * 1.15); },
      place(i) {
        const p = P.part[i];
        if (p === C || p === TAIL) trace(i, p === C ? top : bottom, P.u[i], 1.8, 3.6);
        else if (isDot(p)) disc(i, 133, 33, 7.5);
        else trace(i, hills, leU(i), 1.6, 3.8);
        const x = out[i * STRIDE + X], hot = bump(x - scan, 12), inked = 1 - smooth(scan - 3, scan + 5, x);
        look(i, .18 + hot * 1.1, p === C || p === TAIL ? 1 : .4 + .6 * inked, isDot(p) ? 1.6 : 1);
      },
    };
  }

  /* 记忆：l·e·下划线穿成星座，C 圈住正被想起的那一颗 */
  {
    const S = [[16, 64], [44, 27], [77, 55], [104, 19], [133, 63], [176, 33]], STAR = .07, EDGE = (1 - STAR * 6) / 5;
    let head = 0, hx = 0, hy = 0;
    forms.memory = {
      frame(t) {
        head = (.5 - .5 * Math.cos(t * .62)) * 5;
        const k = Math.min(4, Math.floor(head)), f = smooth(0, 1, head - k);
        hx = lerp(S[k][0], S[k + 1][0], f); hy = lerp(S[k][1], S[k + 1][1], f);
      },
      place(i) {
        const p = P.part[i];
        if (p === C) {
          ring(i, P.u[i], hx, hy, 10.5, 10, 1.3);
          look(i, .75);
        } else if (isDot(p)) {
          const s = p === DOT1 ? 0 : 5, hot = bump(head - s, .55);
          disc(i, S[s][0], S[s][1], 5 + 2 * hot);
          look(i, .3 + hot, 1, 1.4);
        } else {
          const v = clamp(P.local[i]) / (STAR + EDGE), s = Math.min(5, Math.floor(v)), r = (v - s) * (STAR + EDGE);
          if (r <= STAR || s === 5) {
            const hot = bump(head - s, .55);
            disc(i, S[s][0], S[s][1], 4.6 + 3 * hot);
            look(i, .25 + hot);
          } else {
            const f = clamp((r - STAR) / EDGE), hot = bump(head - s - f, .4);
            put(i, lerp(S[s][0], S[s + 1][0], f), lerp(S[s][1], S[s + 1][1], f), 1.5 + hot);
            look(i, hot, .5 + .5 * hot);
          }
        }
      },
    };
  }

  /* 等你确认：C 和下划线合成对话泡，l、e、两个点变成三个依次跳的点 */
  {
    const left = brush('M124 15C100 12 62 12 42 18C16 26 14 62 38 72C44 75 50 76 58 76C58 84 54 90 47 95', 5.6);
    const right = brush('M124 15C138 16 152 18 161 23C186 37 178 70 150 75C128 79 100 78 82 77C74 82 62 91 47 95', 6.4);
    let breathe = 1;
    forms.ask = {
      frame(t) { breathe = 1 + .035 * Math.sin(t * 3); },
      place(i, t) {
        const p = P.part[i];
        if (p === C || p === TAIL) {
          trace(i, p === C ? left : right, P.u[i], 1.5, 4.2);
          const o = i * STRIDE;
          out[o + X] = 96 + (out[o + X] - 96) * breathe; out[o + Y] = 46 + (out[o + Y] - 46) * breathe;
          look(i, .25);
        } else {
          const k = p === DOT1 ? 0 : p === DOT2 ? 2 : Math.min(2, Math.floor(leU(i) * 3));
          const hop = Math.max(0, Math.sin(t * 4.5 - k * .9 + .6)) ** 4;
          disc(i, 69 + k * 28, 47 - hop * 8, 6.2 + 1.4 * hop);
          look(i, .35 + hop, 1, 1.1);
        }
      },
    };
  }

  /* 等待 / 定时：C 和下划线合成沙漏，l、e 是两边的沙，两个点是漏下来的那一线，流完翻面 */
  {
    const left = polyline([[30, -38], [-30, -38], [-27, -27], [-3, 0], [-27, 27], [-30, 38], [30, 38]].flat());
    const right = polyline([[30, -38], [27, -27], [3, 0], [27, 27], [30, 38]].flat());
    let n = 0, run = 0, turn = 0, c = 1, s = 0;
    forms.wait = {
      frame(t) {
        const v = (t + .3) / 3.6, f = fract(v);
        n = Math.floor(v); run = Math.min(1, f / .8); turn = smooth(.8, 1, f);
        const a = (n + turn) * Math.PI;
        c = Math.cos(a); s = Math.sin(a);
      },
      place(i, t) {
        const p = P.part[i], u = P.u[i];
        if (isDot(p)) {                                    // 沙线永远竖直向下，不跟着翻
          disc(i, 96, 66, 1.7, 15);
          look(i, 1, smooth(0, .06, run) * (1 - smooth(.93, 1, run)) * (.8 + .2 * Math.sin(t * 22)), 1.1);
          return;
        }
        let x, y, w;
        if (p === C || p === TAIL) {
          (p === C ? left : right).at(u, tmp);
          x = tmp[0]; y = tmp[1]; w = p === C ? 2.6 : 2.3;
          look(i, .2);
        } else {
          const topChamber = p === L, draining = topChamber === (n % 2 === 0), amount = draining ? 1 - run : run;
          const near = draining ? 4 : 36 - 32 * amount, far = draining ? 4 + 32 * amount : 36;
          const r = Math.min(5.999, u * 6), row = Math.floor(r), across = row % 2 ? 1 - (r - row) : r - row;
          const dist = lerp(near, far, (row + .5) / 6);
          x = (across * 2 - 1) * Math.min(25, dist * .78); y = topChamber ? -dist : dist; w = 1.6 + 4 * amount;
          look(i, .5, smooth(0, .16, amount) * .85);
        }
        y *= .98;
        put(i, 96 + x * c - y * s - (x * s + y * c) * .06, 51 + x * s + y * c, w);
      },
    };
  }

  /* 删除：C 和下划线是纸边，l、e、两个点是纸上的字，从右往左被风吹散 */
  {
    const edgeA = brush('M110 14C90 13 62 13 46 14C42 14 42 18 42 22C42 42 41 70 42 88', 8);
    const edgeB = brush('M110 14C112 30 112 66 111 84C111 88 107 88 103 88C84 88 62 87 42 88', 8);
    let k = 0, edge = 0;
    forms.erase = {
      frame(t) { k = fract(t * .36 + .14); edge = lerp(150, -40, clamp((k - .14) / .86)); },
      place(i) {
        const p = P.part[i], u = P.u[i], o = i * STRIDE;
        let seam = 1;
        if (p === C || p === TAIL) trace(i, p === C ? edgeA : edgeB, u, 1.8, 3.6);
        else if (isDot(p)) disc(i, slantX(p === DOT1 ? 62 : 84, 76), 76, 11, 1.8);
        else {
          const second = p === E || u > .5, v = p === E ? u : second ? (u - .54) / .46 : u / .46;
          const y = p === E ? 60 : second ? 45 : 30;
          put(i, slantX(52 + clamp(v) * (p === E ? 48 : 46), y), y, 2.3);
          if (p === L) seam = smooth(.035, .05, Math.abs(u - .5));
        }
        const x = out[o + X], gone = p === C ? 0 : clamp((x - edge) / 38), drift = 22 + P.seed[i * 4 + 1] * 50;
        out[o + X] += gone * drift;
        out[o + Y] += gone * (Math.sin(gone * 3 + P.seed[i * 4 + 2] * 5) * 20 - 4);
        out[o + W] *= 1 - gone * .6;
        look(i, .12 + bump(x - edge, 11) * .9, p === C ? .55 + .45 * smooth(x - 12, x + 12, edge) * smooth(0, .12, k) * (1 - smooth(.93, 1, k)) : seam * (1 - gone) * smooth(0, .12, k) * (1 - smooth(.93, 1, k)), isDot(p) ? 1.2 : 1);
      },
    };
  }

  /* 操作电脑：l、e 勾成箭头，C 和下划线是点击荡开的两圈，两个点落在箭尖 */
  {
    const V = [[0, 0], [0, 50], [12, 39], [20, 57], [30, 52.5], [22, 35.5], [38, 34], [0, 0]];
    const arrow = polyline(V.flat());
    let ax = 0, ay = 0, press = 0, wave = 0;
    forms.pointer = {
      frame(t) {
        const k = fract(t * .55), away = k < .4 ? 1 - smooth(0, .4, k) : smooth(.78, 1, k);
        press = Math.sin(clamp((k - .42) / .14) * Math.PI); wave = clamp((k - .48) / .3);
        ax = 78 + away * 42; ay = 34 + away * 5 + press * 3;
      },
      place(i) {
        const p = P.part[i], open = Math.sin(wave * Math.PI);
        if (p === C || p === TAIL) {
          const r = (p === C ? 14 : 8) + open * (p === C ? 15 : 8);
          ring(i, P.u[i], 78, 34, r, r * .9, .9);
          look(i, .55 + open * .6, .28 + .72 * open);
        } else if (isDot(p)) {
          disc(i, ax, ay, 3.2 + press * 2.5);
          look(i, .7 + press * .5, 1, 1.2);
        } else {
          arrow.at(leU(i), tmp);
          put(i, ax + tmp[0] * (1 - press * .06), ay + tmp[1] * (1 - press * .06), 2.6);
          look(i, .25 + press * .5);
        }
      },
    };
  }

  /* 学习：C 和下划线是摊开的两页，l 是正翻过去的那一页，e 是字 */
  {
    const pageA = brush('M94 27C75 17 50 14 27 20C25 21 25 24 25 27C25 45 25 62 26 81C50 75 75 77 94 87', 6);
    const pageB = brush('M94 27C113 17 138 14 163 20C165 21 165 24 165 27C164 45 164 62 162 81C138 75 113 77 94 87', 6.6);
    let ex = 0, ey = 0, shown = 0;
    forms.learn = {
      frame(t) { const a = fract(t * .5 + .2) * Math.PI; ex = Math.cos(a) * 66; ey = Math.sin(a) * 15; shown = smooth(0, .4, Math.sin(a)); },
      place(i) {
        const p = P.part[i], u = P.u[i];
        if (p === C || p === TAIL) {
          trace(i, p === C ? pageA : pageB, u, 1.7, 3.8);
          look(i, .2);
        } else if (p === L) {                              // 书脊下 → 页角 → 页角 → 书脊上
          const v = Math.min(2.999, u * 3), k = Math.floor(v), f = v - k;
          const x = k === 0 ? ex * f : k === 1 ? ex : ex * (1 - f);
          const far = k === 0 ? f : k === 1 ? 1 : 1 - f, y = (k === 0 ? 87 : k === 1 ? lerp(87, 27, f) : 27);
          const curve = k === 1 ? 0 : Math.sin(f * Math.PI) * -7;
          const yy = y + curve - ey * far - 6 * far;
          put(i, slantX(94 + x, yy), yy, 2.7);
          look(i, .9, shown);
        } else if (p === E) {
          const v = Math.min(3.999, u * 4), k = Math.floor(v), f = v - k, right = k === 1 || k === 2, y = k < 2 ? 39 : 57;
          const along = k < 2 ? f : 1 - f, x = (right ? 107 : 40) + along * 41;
          put(i, slantX(x, y), y - Math.sin(along * Math.PI) * 2, 1.9);
          look(i, .15, .7 * smooth(0, .06, f) * (1 - smooth(.94, 1, f)));
        } else {
          const x = p === DOT1 ? 60 : 128;
          disc(i, slantX(x, 70), 70, 8, 1.5);
          look(i, .15, .7, 1.1);
        }
      },
    };
  }

  /* 其他工具：C、下划线是两枚咬合的齿轮，l、e 是轮毂 */
  {
    let turn = 0;
    forms.tool = {
      frame(t) { turn = t; },
      place(i) {
        const p = P.part[i], u = P.u[i], big = p === C || p === L || p === DOT1;
        const cx = big ? 72 : 122.5, cy = big ? 55 : 39, R = big ? 28 : 17, teeth = big ? 8 : 5, rot = big ? turn : -turn * 1.6 + .25;
        if (isDot(p)) {
          disc(i, cx, cy, big ? 4.2 : 3.4);
          look(i, .8, 1, 1.3);
        } else if (p === L || p === E) {
          ring(i, u, cx, cy, big ? 12 : 7.5, big ? 12 : 7.5, 1.1, Math.PI / 2);
          look(i, .6);
        } else {
          const a = -1.1 - u * TAU, tooth = clamp(Math.sin(a * teeth) * 2.6, -1, 1);
          put(i, cx + Math.cos(a + rot) * (R + tooth * 3.6), cy + Math.sin(a + rot) * (R + tooth * 3.6), 2.5);
          look(i, big ? .2 : .15 + .45 * Math.max(0, tooth));
        }
      },
    };
  }

  /* 成功：C 压成顿笔，l·e·下划线一口气挑上去甩出发丝，最后落下一个句点 */
  {
    const down = brush('M42 38C50 45 58 56 64 67C66 72 67 75 69 77', 8.5);
    const flick = brush('M69 77C78 61 91 43 105 31C116 21 130 13 142 12C149 11.5 153 15 150 19', 18, true);
    forms.ok = {
      place(i, t) {
        const p = P.part[i];
        if (isDot(p)) {
          const k = clamp((t - .12) / .5), fallen = k < .7 ? 1 - (k / .7) ** 2 : Math.sin((k - .7) / .3 * Math.PI) * .12;
          disc(i, 139, 75 - fallen * 30, 7.2);
          look(i, .35 + bump(t - .55, .18), smooth(0, .22, t), 1.2);
          return;
        }
        if (p === C) trace(i, down, P.u[i], 0, 6);
        else trace(i, flick, P.local[i], 0, 7.5);
        look(i, .5 + bump(P.order[i] - t * 1.6, .12) * 1.1);
      },
    };
  }

  /* 失败：C 和连笔交叉成一个叉，抖一下，两个点掉下来 */
  {
    const down = brush('M56 18C60 21 65 25 72 31C91 47 111 65 129 81', 6.4);
    const up = brush('M68 82C86 64 105 39 122 22C128 16 135 14.5 133 19.5', 14, true);
    forms.fail = {
      place(i, t) {
        const p = P.part[i], o = i * STRIDE, shake = Math.sin(t * 34) * 3.4 * Math.exp(-t * 3) * smooth(0, .04, t);
        if (isDot(p)) {
          const k = clamp(t / .55), right = p === DOT2 ? 1 : -1, bounce = Math.abs(Math.sin(k * Math.PI * 2)) * (1 - k) * 12;
          disc(i, 96 + right * (12 + 38 * k), 48 + 38 * k * k - bounce, 5.4);
          look(i, .85, 1, 1.35);
        } else {
          if (p === C) trace(i, down, P.u[i], 2.4, 6, shake);
          else trace(i, up, P.local[i], 0, 7, shake);
          look(i, .85);
        }
        out[o + RED] = 1;
      },
    };
  }

  return forms;
}
