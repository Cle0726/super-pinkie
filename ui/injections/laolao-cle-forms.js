/* cle-forms:v2 —— 每种步骤一个形态，都由 C.le. 的笔画变出来
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
  ok: 'ok', fail: 'fail', done: 'done', idle: 'idle', stopped: 'stopped',
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

  /* 搜索：C 合成带起笔小钩的镜圈，下划线甩成镜柄；l、e 是三行字，镜片扫过的地方字放大变粗，两个点是找到的那两处 */
  {
    const lens = brush('M97 24C94 17 88 14 79 15C62 16 52 30 55 47C58 65 78 73 94 65C110 57 114 34 101 21C96 16 90 14 83 15', 6.4);
    const grip = brush('M103 61C109 67 116 75 123 81C127 84.5 131 85 133 82', 7.6, true);
    const ROW = [26, 46, 66], FOUND = [[138, 46], [44, 66]];
    let dx = 0, dy = 0, shine = 0, lx = 0, ly = 0;
    forms.search = {
      frame(t) { dx = Math.sin(t * 1.1) * 38; dy = Math.sin(t * 2.2) * 2; shine = t * .7; lx = 83 + dx; ly = 42 + dy; },
      place(i) {
        const p = P.part[i], u = P.u[i];
        if (p === C && u < .88) {
          trace(i, lens, u / .88, 2.4, 4.4, dx, dy);
          const d = fract(u / .88 - shine);
          look(i, .42 + .7 * bump(Math.min(d, 1 - d), .12));
        } else if (p === C) {                              // 镜片左上的一道弧形反光
          const f = (u - .88) / .12, a = 3.55 + f * .9, s = Math.sin(f * Math.PI);
          put(i, 81 + dx + Math.cos(a) * 18, 41 + dy + Math.sin(a) * 18, 1.5 * s);
          look(i, 1, .7 * s, .9);
        } else if (p === TAIL) {
          trace(i, grip, u, 0, 5, dx, dy);
          look(i, .45);
        } else if (isDot(p)) {
          const [x, y] = FOUND[p === DOT1 ? 0 : 1], hit = 1 - smooth(14, 26, Math.hypot(slantX(x, y) - lx, y - ly));
          disc(i, slantX(x, y), y + 4.5, 9 + 3 * hit, 1.6);
          look(i, .25 + hit, .35 + .65 * hit, 1.1);
        } else {
          const v = leU(i) * 3, k = Math.min(2, Math.floor(v)), f = v - k, y = ROW[k], x0 = 24 + (k === 1 ? 10 : 0);
          const x = slantX(x0 + f * (k === 2 ? 118 : 140), y), word = fract((x + k * 9) / 23);
          const lens0 = 1 - smooth(15, 23, Math.hypot(x - lx, y - ly)), gap = smooth(.7, .76, word) * (1 - smooth(.94, 1, word));
          put(i, x + (x - lx) * .32 * lens0, y + (y - ly) * .32 * lens0, 1.6 + 2.4 * lens0);
          look(i, .1 + .55 * lens0, (.5 + .5 * lens0) * (1 - gap));
        }
      },
    };
  }

  /* 命令：一个终端窗口。e 画窗框和标题栏（左上三个小按钮），C 折成提示符，l 是往上滚的输出（一个词一个词的），
     下划线是正在敲的这一行（敲到哪露到哪），两个点合成方块光标 */
  {
    const prompt = brush('M19 67C23 70 27 72.5 31 76C27 79.5 23 82 19 85', 5.4);
    const typed = brush('M171 76C130 76 88 76 41 76', 6.2);
    const win = polyline([[182, 21], [10, 21], [10, 14], [13, 9.5], [17, 8], [175, 8], [179, 9.5], [182, 14], [182, 84],
      [179, 88.5], [175, 90], [17, 90], [13, 88.5], [10, 84], [10, 21]].flat());
    const hsh = (n) => fract(Math.sin(n) * 43758.5453);
    const gap = (w) => smooth(.72, .78, w) * (1 - smooth(.94, 1, w));
    let k = 0, cursor = 41;
    forms.exec = {
      frame(t) { k = fract(t * .42 + .3); cursor = 41 + Math.min(1, k / .8) * 130; },
      place(i, t) {
        const p = P.part[i], u = P.u[i];
        if (p === C) {
          trace(i, prompt, u, 2.2, 4.4);
          look(i, .45 + .25 * Math.sin(t * 2));
        } else if (isDot(p)) {
          disc(i, slantX(cursor + 4.5, 76), 76, 4, 6.6);
          const blink = k < .8 ? 1 : .3 + .7 * smooth(-.3, .3, Math.sin(t * TAU * 2.4));
          look(i, 1.1, smooth(0, .05, k) * blink * (1 - smooth(.93, 1, k)), 1.15);
        } else if (p === TAIL) {
          trace(i, typed, u, 1.6, 3);
          const x = out[i * STRIDE + X], shown = 1 - smooth(cursor - 2, cursor + 2, x);
          look(i, .15 + bump(x - cursor, 14) * .9, shown * (1 - gap(fract((x - 41) / 17))) * (1 - smooth(.9, 1, k)));
        } else if (p === E) {
          if (u < .14) {                                   // 标题栏上的三个小按钮
            const b = Math.min(2, Math.floor(u / .14 * 3));
            disc(i, 19 + b * 8, 14.5, 2.3);
            look(i, b ? .15 : .8, .7, .9);
          } else {
            win.at((u - .14) / .86, tmp);
            put(i, tmp[0], tmp[1], 1.6);
            look(i, .04, .5, 1.3);
          }
        } else {                                           // 输出：三行一直往上滚，滚出去就换一行新的
          const v = u * 3, r = Math.min(2, Math.floor(v)), f = v - r, g = r + t * .5, pos = g % 3, gen = Math.floor(g / 3);
          const y = 64 - pos * 12, len = .42 + .52 * hsh(gen * 3.1 + r * 7.7), x = 22 + f * 150 * len;
          put(i, slantX(x, y), y, 3.2);
          look(i, .2 * (1 - smooth(0, 1, pos)), smooth(0, .3, pos) * (1 - smooth(2.3, 2.85, pos)) * (1 - gap(fract((x + gen * 11 + r * 5) / 16))) * .9);
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

  /* 测试：C 合成一只烧瓶，l、e 是晃动的液面，下划线一半是液体、一半是往上冒的气泡，两个点从瓶口逸出 */
  {
    const flask = brush('M112 12C101.33 12.00 90.67 12.00 80 12C82.00 13.00 84.00 14.00 86 15C86.00 22.00 86.00 29.00 86 36C73.67 50.33 61.33 64.67 49 79C50.00 81.00 51.00 83.00 52 85C80.67 85.00 109.33 85.00 138 85C139.00 83.00 140.00 81.00 141 79C128.67 64.67 116.33 50.33 104 36C104.00 29.00 104.00 22.00 104 15C106.67 14.00 109.33 13.00 112 12', 5.6);
    const side = (y) => 18.5 + Math.max(0, y - 36) * (37 / 43);      // 瓶身从瓶颈往下张开的半宽
    const surf = (x, t) => 58 + 2.3 * Math.sin(x * .17 - t * 3.4) + 1.4 * Math.sin(t * 1.7);
    const HATCH = [66, 72, 78], BUB = [[82, .0], [108, .27], [94, .52], [120, .76]];
    forms.test = {
      place(i, t) {
        const p = P.part[i], u = P.u[i];
        if (p === C && u < .86) {
          trace(i, flask, u / .86, 2.2, 4.2);
          look(i, .3);
        } else if (p === C) {                              // 玻璃上的一道竖高光
          const f = (u - .86) / .14, y = lerp(47, 77, f), s = Math.sin(f * Math.PI);
          put(i, slantX(95 - side(y) + 6.5, y), y, 1.4 * s);
          look(i, .95, .6 * s, .9);
        } else if (p === L || p === E) {
          const y0 = 58, hw = side(y0) - 2.5, x = 95 - hw + leU(i) * hw * 2;
          const y = surf(x, t) - 2.4 * smooth(hw - 8, hw, Math.abs(x - 95));   // 贴着瓶壁往上翘的弯月面
          put(i, slantX(x, y), y, 2.4);
          look(i, .55 + .35 * Math.sin(x * .17 - t * 3.4));
        } else if (p === TAIL && u < .4) {                  // 气泡：从瓶底升到液面就破
          const v = u / .4 * 4, k = Math.min(3, Math.floor(v)), a = (v - k) * TAU, [bx, off] = BUB[k];
          const f = fract(t * (.42 + k * .06) + off), y = lerp(82, 61, f * f * (3 - 2 * f)), r = (1.8 + k % 2 * 1.2) + 2.2 * f;
          const x = bx + Math.sin(f * 7 + k) * 2.5;
          put(i, slantX(x, y) + Math.cos(a) * r, y + Math.sin(a) * r, 1.3);
          look(i, .5, smooth(0, .12, f) * (1 - smooth(.86, 1, f)) * .95);
        } else if (p === TAIL) {                            // 液体：三行淡淡的排线
          const v = (u - .4) / .6 * 3, k = Math.min(2, Math.floor(v)), y = HATCH[k], hw = side(y) - 4, x = 95 - hw + (v - k) * hw * 2;
          put(i, slantX(x, y), y, 1.6);
          look(i, .15, .34 * smooth(.02, .1, v - k) * (1 - smooth(.9, .98, v - k)));
        } else {
          const f = fract(t * .42 + (p === DOT2 ? .5 : 0)), y = lerp(40, 4, f);
          disc(i, slantX(95 + Math.sin(f * 9 + (p === DOT2 ? 2 : 0)) * 4, y), y, 2.8 + f * 2.4);
          look(i, .7, smooth(0, .15, f) * (1 - smooth(.7, .95, f)), 1.2);
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

  /* Git：下划线是主干，l·e 从分叉处弯出去成一条支线，C 是支线顶端的提交，两个点是主干上的分叉和最新一次提交；一道光沿着历史往前走 */
  {
    const branch = brush('M40 66C54 66 58 31 82 31C103 31 120 31 139 31', 5.4);
    const trunk = brush('M188 64C184.00 64.67 180.00 65.33 176 66C167.33 66.00 158.67 66.00 150 66C132.33 66.00 114.67 66.00 97 66C78.00 66.00 59.00 66.00 40 66C31.33 66.00 22.67 66.00 14 66', 9.5, true);
    let head = 0;
    forms.git = {
      frame(t) { head = fract(t * .32) * 240 - 20; },
      place(i) {
        const p = P.part[i], u = P.u[i];
        if (isDot(p)) {
          const x = p === DOT1 ? 40 : 172, hot = bump(x - head, 16);
          disc(i, slantX(x, 66), 66, 6.2 + 2 * hot);
          look(i, .5 + .8 * hot, 1, 1.7);
          return;
        }
        if (p === C) { const r = 8 + 2.2 * bump(148 - head, 14); ring(i, u, slantX(148, 31), 31, r, r * .95, 1.7); }
        else if (p === TAIL) trace(i, trunk, u, 1.2, 3.4);
        else trace(i, branch, leU(i), 1.6, 3.4);
        look(i, (p === C ? .55 : .22) + 1.05 * bump(out[i * STRIDE + X] - head, 16));
      },
    };
  }

  /* 子会话：主核（实心点）外面一圈圈「派活」的波纹；C、l、e 绕成三个子会话节点，每个圈里有一颗小核；
     下划线是三条连线，任务一颗颗从主核送出去，到了节点，节点的小核亮一下 */
  {
    const HX = 96, HY = 50, sx = [0, 0, 0], sy = [0, 0, 0], depth = [0, 0, 0], q = [0, 0, 0];
    let ping = 0;
    const sent = (k) => clamp(q[k] / .7) * .8;                  // 任务包在连线上的位置（0 = 主核）
    forms.team = {
      frame(t) {
        for (let k = 0; k < 3; k++) {
          const a = Math.PI + .2 + k * TAU / 3 + t * .45;
          sx[k] = HX + Math.cos(a) * 66; sy[k] = HY + Math.sin(a) * 28; depth[k] = .5 + .5 * Math.sin(a);
          q[k] = fract(t * .6 + k / 3);
        }
        ping = fract(t * .6);
      },
      place(i, t) {
        const p = P.part[i], u = P.u[i];
        if (p === DOT1) {
          disc(i, HX, HY, 7.2 + .8 * Math.sin(t * 2.6));
          look(i, .95, 1, 1.75);
        } else if (p === DOT2) {                          // 波纹：从主核往外扩，扩到看不见再从头来
          const a = u * TAU, r = 9 + ping * 22;
          put(i, HX + Math.cos(a) * r, HY + Math.sin(a) * r * .9, 1.1);
          look(i, .7 * (1 - ping), smooth(0, .08, ping) * (1 - ping) * .8, .8);
        } else if (p === TAIL) {                          // 主核 → 节点 → 主核 → …：一笔不断
          const k = Math.min(4, Math.floor(u * 5)), f = u * 5 - k, s = k >> 1, d = k % 2 ? 1 - f : f;
          put(i, lerp(HX, sx[s], d), lerp(HY, sy[s], d), 1.4);
          const hot = bump(d - sent(s), .06) * (1 - smooth(.68, .74, q[s]));
          look(i, .1 + hot * 1.4, (.3 + .7 * hot) * smooth(0, .12, d) * (1 - smooth(.74, .84, d)), 1 + hot * .6);
        } else {
          const k = p === C ? 0 : p === L ? 1 : 2, r = 12 + depth[k] * 2.5, arrive = bump(q[k] - .74, .05);
          if (u < .78) ring(i, u / .78, sx[k], sy[k], r, r * .92, 1.8, p === C ? -1.1 : Math.PI / 2);
          else disc(i, sx[k], sy[k], 3.2 + 1.6 * arrive);
          look(i, (u < .78 ? .2 + .3 * depth[k] : .5) + arrive * .9, .65 + .35 * depth[k], u < .78 ? 1 : 1.15);
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

  /* 记忆：l·e·下划线连成北斗七星（斗柄 + 斗勺），C 圈住正被想起的那一颗，两个点是斗柄头和天枢 */
  {
    const S = [[20, 38], [48, 27], [76, 34], [99, 49], [108, 79], [160, 80], [171, 48]];
    const V = [0, 1, 2, 3, 4, 5, 6, 3].map((k) => S[k]), N = V.length, STAR = .055, EDGE = (1 - STAR * N) / (N - 1);
    let head = 0, hx = 0, hy = 0;
    forms.memory = {
      frame(t) {
        head = (.5 - .5 * Math.cos(t * .55)) * (N - 1);
        const k = Math.min(N - 2, Math.floor(head)), f = smooth(0, 1, head - k);
        hx = lerp(V[k][0], V[k + 1][0], f); hy = lerp(V[k][1], V[k + 1][1], f);
      },
      place(i, t) {
        const p = P.part[i];
        if (p === C) {
          ring(i, P.u[i], hx, hy, 11, 10.4, 1.3);
          look(i, .8);
        } else if (isDot(p)) {
          const s = p === DOT1 ? 0 : 6, hot = bump(head - s, .6), tw = .5 + .5 * Math.sin(t * 2.3 + s);
          disc(i, S[s][0], S[s][1], 5.2 + 1.8 * hot);
          look(i, .35 + .3 * tw + hot, 1, 1.45);
        } else {
          const v = clamp(P.local[i]) / (STAR + EDGE), s = Math.min(N - 1, Math.floor(v)), r = (v - s) * (STAR + EDGE);
          const tw = .5 + .5 * Math.sin(t * 2.3 + s * 1.7);
          if (r <= STAR || s === N - 1) {
            const hot = bump(head - s, .55);
            disc(i, V[s][0], V[s][1], 4 + 2.6 * hot + tw);
            look(i, .2 + .35 * tw + hot, .85 + .15 * tw);
          } else {
            const f = clamp((r - STAR) / EDGE), hot = bump(head - s - f, .4);
            put(i, lerp(V[s][0], V[s + 1][0], f), lerp(V[s][1], V[s + 1][1], f), 1.2 + hot);
            look(i, hot, .42 + .5 * hot);
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

  /* 修改：一支铅笔斜着写。C 是笔身轮廓，下划线是正在写出来的那一行（写到哪露到哪），l、e 是格线，两个点是笔尖和橡皮 */
  {
    const LEN = 58, HW = 6.2, CONE = 12, FERRULE = 11;
    const body = polyline([[LEN, -HW], [CONE, -HW], [0, 0], [CONE, HW], [LEN, HW], [LEN, -HW], [LEN - FERRULE, -HW], [LEN - FERRULE, HW]].flat());
    const X0 = 26, X1 = 156, wave = (x) => 70 - 6 * Math.sin(x * .2) - 2.4 * Math.sin(x * .55 + 1);
    let tx = X0, ty = 70, ca = 0, sa = 0, fade = 1, lift = 0;
    forms.edit = {
      frame(t) {
        const p = fract(t / 3.4), go = smooth(0, .7, p), back = smooth(.8, 1, p);
        tx = lerp(lerp(X0, X1, go), X0, back);
        lift = smooth(.68, .78, p) * (1 - smooth(.94, 1, p));
        ty = wave(tx) - lift * 9;
        fade = 1 - smooth(.8, .93, p);
        const a = -.88 + (1 - lift) * .07 * Math.sin(t * 11);
        ca = Math.cos(a); sa = Math.sin(a);
      },
      place(i, t) {
        const p = P.part[i], u = P.u[i];
        if (p === C) {
          body.at(u, tmp);
          const al = tmp[0], ac = tmp[1];
          put(i, tx + al * ca - ac * sa, ty + al * sa + ac * ca, 2.1);
          look(i, .28);
        } else if (isDot(p)) {
          const tip = p === DOT1, al = tip ? 1.5 : LEN + 4.5;
          disc(i, tx + al * ca, ty + al * sa, tip ? 2.6 : 5.2, tip ? 2.6 : 5.2);
          look(i, tip ? 1.15 - .6 * lift : .3, 1, tip ? 1.2 : 1.35);
        } else if (p === TAIL) {
          const x = lerp(X1, X0, u);                       // 和签名的下划线一样，参数从右往左
          if (x > tx) { put(i, tx, ty, 0); look(i, 0, 0); return; }
          put(i, x, wave(x), 2.6 * (.45 + .55 * smooth(X0, X0 + 14, x)));
          look(i, .1 + bump(x - tx, 9) * 1.1, fade);
        } else if (p === E) {                              // 笔尖后面落下的石墨屑，抬笔时不掉
          const s = P.seed[i * 4], f = fract(s * 7.3 + t * 1.4);
          put(i, tx - 3 - f * 15 + (P.seed[i * 4 + 1] - .5) * 7, ty + 3 + f * f * 9 + (P.seed[i * 4 + 2] - .5) * 3, 0);
          look(i, .25, (1 - f) * .55 * (1 - lift) * fade * smooth(X0 + 4, X0 + 12, tx), .75);
        } else {
          put(i, slantX(18 + leU(i) * 160, 82), 82, 1.1);
          look(i, 0, .42);
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
