/* cle-ink:v1 —— 连笔引擎：任意两个形态之间流畅来回
 *
 *   平常：上一步 → 收成 C.le. → 沿笔画展开成下一步（合计 1.15 秒，不比原来的 1.25 秒慢）
 *   很快连着来的步骤：直接变过去，不每次绕回签名，免得频闪
 *   成功 / 失败：是同一步的收势，直接变
 *   中途被打断：从此刻的位置、此刻的速度接着变，不跳、不停顿
 *
 * 变形先插值笔画中心线和笔宽，再按新中心线的法向铺开墨点，所以中途也一直是笔画。
 * 没有 DOM、没有 three：渲染在 laolao-cle-space.js。
 */
import {STRIDE, X, Y, Z, W, GLOW, ALPHA, SIZE, RED, clamp, smooth, buildParticles, worldX, worldY} from './laolao-cle-kit.js';
import {classicForms} from './laolao-cle-classic.js';
import {inkForms} from './laolao-cle-forms.js';

export const TIME = Object.freeze({
  wake: .15,       // 从静止签名出发：先让粒子在原位显出来
  back: .42,       // 收回签名
  rest: .08,       // 在签名上停一拍
  out: .65,        // 从签名展开
  direct: .5,      // 快步骤、被打断：直接变
  result: .45,     // 成功 / 失败
  home: .6,        // 回到待机签名
  sign: .8,        // 落款起笔前收进笔尖
});
const QUICK = 1.1;        // 两次切换间隔短于这个秒数，就不绕回签名
const CARRY = .05;        // 被打断时沿原速度滑出去的时间常数
const MAX_SPEED = 620;    // 画布单位 / 秒：继承的速度封顶，免得滑出画面
const TELEPORT = 1800;    // 再快的是循环里看不见的瞬移，不继承
const STAGGER = .4;       // 沿笔顺错开多少

export class CleInk {
  constructor({SIG, sig, count, random}) {
    const P = this.P = buildParticles(sig, count, random);
    const n = count * STRIDE;
    this.count = count;
    this.target = new Float32Array(n);     // 目标形态这一帧的样子
    this.mixed = new Float32Array(n);      // 变形中实际的样子
    this.held = new Float32Array(n);       // 本次变形出发时的样子
    this.speed = new Float32Array(count * 3);
    this.carry = new Float32Array(count * 3);
    this.position = new Float32Array(count * 3);
    this.look = new Float32Array(count * 4);   // 发光、透明度、点大小、红
    const classic = classicForms({P, sig, out: this.target});
    const {ringAt, ...kept} = classic;
    this.ringAt = ringAt;
    this.forms = {...kept, ...inkForms({P, SIG, out: this.target})};
    this.fx = {alpha: 0, paper: 1, ring: .05, ringAlpha: 0};
    this.clock = 0;
    this.lastSet = -9;
    this.form = 'idle';
    this.next = null;
    this.delay = 0; this.dur = 0; this.since = 1; this.time = 0;
    this.reversed = false;
    this.frame(0);
    this.mixed.set(this.target);
    this.spread();
  }

  get names() { return Object.keys(this.forms); }
  get moving() { return this.since < this.delay + this.dur; }
  /** 要去的形态（经过签名时，是签名之后那个）。 */
  get goal() { return this.next || this.form; }

  set(name, {quick = false} = {}) {
    if (!this.forms[name]) return false;
    if (name === this.goal) {
      // 还在回签名的路上，这一步就已经做完了：别绕了，直接变过去让它露个脸
      if (!quick || this.next !== name) return false;
      this.begin(name, TIME.direct);
      return true;
    }
    const gap = this.clock - this.lastSet;
    this.lastSet = this.clock;
    if (name === 'idle') this.begin(name, TIME.home);
    else if (name === 'done') this.begin(name, TIME.sign);
    else if (this.next) {                               // 正在收回签名：改个去处就行
      if (name === 'ok' || name === 'fail') this.begin(name, TIME.result);
      else this.next = name;
    } else if (this.form === 'idle') {
      this.begin(name, TIME.out, this.moving ? 0 : TIME.wake);
    } else if (name === 'ok' || name === 'fail') this.begin(name, TIME.result);
    else if (quick || this.moving || this.form === 'done' || gap < QUICK) this.begin(name, TIME.direct);
    else {
      this.begin('idle', TIME.back);
      this.next = name;
    }
    return true;
  }

  begin(name, dur, delay = 0) {
    this.held.set(this.mixed);
    for (let i = 0; i < this.count; i++) {
      const k = i * 3, vx = this.speed[k], vy = this.speed[k + 1], vz = this.speed[k + 2];
      const v = Math.hypot(vx, vy), keep = v > TELEPORT || this.mixed[i * STRIDE + ALPHA] <= .05 ? 0 : Math.min(1, MAX_SPEED / (v || 1));
      this.carry[k] = vx * keep; this.carry[k + 1] = vy * keep; this.carry[k + 2] = vz * keep;
    }
    this.form = name; this.next = null;
    this.dur = dur; this.delay = delay; this.since = 0; this.time = 0;
    this.reversed = name === 'idle';                    // 收回签名时倒着笔顺收
  }

  /** 算出目标形态这一帧的样子。 */
  frame(dt) {
    const form = this.forms[this.form], {P, target} = this, t = form.live ? this.since : this.time;
    for (let i = 0, o = 0; i < this.count; i++, o += STRIDE) {
      target[o + Z] = P.text[i * 3 + 2];
      target[o + W] = target[o + GLOW] = target[o + RED] = 0;
      target[o + ALPHA] = target[o + SIZE] = 1;
    }
    form.frame?.(t, dt);
    for (let i = 0, o = 0; i < this.count; i++, o += STRIDE) {
      form.place(i, t);
      const j = form.seeds ? form.seeds[i] : i;
      target[o + ALPHA] *= P.alpha[j];
      target[o + SIZE] *= P.size[j];
    }
  }

  step(dt) {
    if (!(dt > 0)) return;
    this.clock += dt;
    this.since += dt;
    // 循环动作等墨线快落定了才起步：起点固定，「跳回起点」也不会发生在变形途中
    this.time += dt * (this.dur ? smooth(.55, 1.1, (this.since - this.delay) / this.dur) : 1);
    if (this.next && this.since >= this.dur + TIME.rest) this.begin(this.next, TIME.out);

    const m = this.dur ? clamp((this.since - this.delay) / this.dur) : 1;
    const resting = this.form === 'idle' && !this.next && m >= 1;
    if (resting && this.fx.alpha === 0) { this.speed.fill(0); return; }     // 静止的签名不必每帧算

    this.frame(dt);
    const {P, target, mixed, held, speed, carry} = this, slide = CARRY * (1 - Math.exp(-this.since / CARRY));
    for (let i = 0, o = 0, k = 0; i < this.count; i++, o += STRIDE, k += 3) {
      let x = target[o], y = target[o + Y], z = target[o + Z];
      if (m >= 1) {
        mixed[o + W] = target[o + W]; mixed[o + GLOW] = target[o + GLOW]; mixed[o + ALPHA] = target[o + ALPHA];
        mixed[o + SIZE] = target[o + SIZE]; mixed[o + RED] = target[o + RED];
      } else {
        const order = this.reversed ? 1 - P.order[i] : P.order[i];
        const t = clamp(m * (1 + STAGGER) - order * STAGGER), e = t * t * (3 - 2 * t), r = 1 - e;
        x = (held[o] + carry[k] * slide) * r + x * e;
        y = (held[o + Y] + carry[k + 1] * slide) * r + y * e;
        z = (held[o + Z] + carry[k + 2] * slide) * r + z * e;
        mixed[o + W] = held[o + W] * r + target[o + W] * e;
        // 4·t·(1−t)：墨流过这一段时亮一下
        mixed[o + GLOW] = held[o + GLOW] * r + target[o + GLOW] * e + 4 * e * r * .6;
        mixed[o + ALPHA] = held[o + ALPHA] * r + target[o + ALPHA] * e;
        mixed[o + SIZE] = held[o + SIZE] * r + target[o + SIZE] * e;
        mixed[o + RED] = held[o + RED] * r + target[o + RED] * e;
      }
      speed[k] = (x - mixed[o]) / dt; speed[k + 1] = (y - mixed[o + Y]) / dt; speed[k + 2] = (z - mixed[o + Z]) / dt;
      mixed[o + X] = x; mixed[o + Y] = y; mixed[o + Z] = z;
    }
    this.handOff(dt, resting);
    this.spread();
  }

  /* 粒子和矢量签名的交接、落款时的墨晕 */
  handOff(dt, resting) {
    const fx = this.fx;
    fx.ringAlpha = 0;
    if (this.form === 'done') {
      const done = this.forms.done.fx;
      fx.ring = done.ring; fx.ringAlpha = done.ringAlpha; fx.paper = done.paper;
      fx.alpha = Math.min(done.alpha, fx.alpha + dt / .3);
      if (done.settled) {
        this.form = 'idle'; this.dur = this.delay = this.time = 0; this.since = 1;
        fx.alpha = 0; fx.paper = 1; fx.ringAlpha = 0;
      }
      return;
    }
    fx.alpha = resting ? Math.max(0, fx.alpha - dt / .4) : Math.min(1, fx.alpha + dt / .3);
    fx.paper = resting ? 1 - fx.alpha : Math.min(fx.paper, 1 - fx.alpha);
  }

  /* 中心线 + 笔宽 → 墨点 */
  spread() {
    const {P, mixed, position, look} = this;
    for (let i = 0, o = 0, k = 0, l = 0; i < this.count; i++, o += STRIDE, k += 3, l += 4) {
      let x = mixed[o], y = mixed[o + Y];
      const w = mixed[o + W];
      if (w > .001) {
        const a = P.before[i] * STRIDE, b = P.after[i] * STRIDE, tx = mixed[b] - mixed[a], ty = mixed[b + Y] - mixed[a + Y];
        const len = Math.sqrt(tx * tx + ty * ty);
        // 一笔折返、缩成一点的瞬间没有方向：笔宽跟着收到 0，法向翻面时才不闪
        if (len > 1e-4) {
          const s = P.off[i] * w * Math.min(1, len / .8) / len;
          x -= ty * s; y += tx * s;
        }
      }
      position[k] = worldX(x); position[k + 1] = worldY(y); position[k + 2] = mixed[o + Z];
      look[l] = mixed[o + GLOW]; look[l + 1] = mixed[o + ALPHA]; look[l + 2] = mixed[o + SIZE]; look[l + 3] = mixed[o + RED];
    }
  }
}
