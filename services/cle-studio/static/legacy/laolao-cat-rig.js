/* 碧琪的动作引擎（替代原版 laolao-buddy-rig.js 的粉鬃毛检测）。
   把静态猫图切成竖条，按「身体 / 头 / 尾」三块权重做很小的局部变形：
   - 呼吸：整幅以下边缘为锚点做极小的纵向起伏，底边永远钉在输入框上沿；
   - 头：不透明像素在上半部更厚的那一侧判定为头，跟着鼠标/打字轻歪、轻点；
   - 尾：另一侧的下缘，慢慢扫，被戳时弹一下；
   - 完成：整体小跃起再落回（落回时略微压扁），不是让整张图一直缩放；
   - 眨眼：切到闭眼图一小会儿（同目录有闭眼图才眨），不做像素手术。
   没有颜色识别、没有粉色鬃毛假设；只看 alpha 轮廓，所以黑猫、白猫、任何画风都适用。
   页面不可见 / 被菜单挡住 / 减少动态效果 / 2d 画布不可用时，退回静态图。 */
(() => {
  "use strict";
  if (window.__pinkieCatRig) return;

  const STRIPS = 26;          // 竖条数：够看出头尾，代价极低（26 次 drawImage/帧）
  const PAD_TOP = .24;        // 画布向上留出跃起空间（图高的比例）
  const IDLE_FPS = 30, LIVE_FPS = 58;
  const ALPHA_MIN = 24;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ── 轮廓 → 头尾分区（纯函数，测试里直接喂 alpha） ───────────────────── */
  function profileFromAlpha(alpha, w, h) {
    if (!alpha || !w || !h) return null;
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (let y = 0; y < h; y += 1) {
      const row = y * w;
      for (let x = 0; x < w; x += 1) {
        if (alpha[row + x] <= ALPHA_MIN) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 <= x0 || y1 <= y0) return null;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // 头 = 上半部「更厚」的一侧。猫趴着时头抬起来，上部质量明显偏向头那边。
    const topLimit = y0 + bh * .42;
    let leftTop = 0, rightTop = 0;
    for (let y = y0; y <= Math.min(y1, Math.ceil(topLimit)); y += 1) {
      const row = y * w;
      for (let x = x0; x <= x1; x += 1) {
        if (alpha[row + x] <= ALPHA_MIN) continue;
        if (x - x0 < bw / 2) leftTop += 1; else rightTop += 1;
      }
    }
    const headLeft = leftTop >= rightTop;
    return {
      box: [x0, y0, x1 + 1, y1 + 1], bw, bh, headLeft,
      headU: headLeft ? .24 : .76,
      tailU0: headLeft ? .56 : .02,
      tailU1: headLeft ? .98 : .44,
    };
  }

  /* 每个竖条的三块权重（0..1）。头只影响上面那侧，尾只影响另一侧下缘，其余是身体。 */
  function weightsAt(profile, u) {
    const p = profile || {headU: .24, tailU0: .56, tailU1: .98};
    const head = Math.pow(Math.max(0, 1 - Math.abs(u - p.headU) / .34), 1.35);
    const span = p.tailU1 - p.tailU0;
    const tail = span > 0 ? Math.pow(clamp((u - p.tailU0) / span, 0, 1), 1.7) : 0;
    const body = clamp(1 - .6 * head - .3 * tail, 0, 1);
    return {head, tail, body};
  }

  /* ── 情绪参数：呼吸幅度/频率、尾巴幅度、歪头幅度、是否眨眼 ───────────── */
  const MOODS = {
    rest: {breath: .012, rate: .28, tail: 3.4, tilt: 1.0, blink: true},
    typing: {breath: .016, rate: .34, tail: 5.2, tilt: 1.15, blink: true},
    working: {breath: .020, rate: .42, tail: 7.2, tilt: 1.3, blink: true, nod: [.9, 1.6]},
    happy: {breath: .024, rate: .52, tail: 11.0, tilt: 1.6, blink: false},
    sleepy: {breath: .034, rate: .12, tail: 1.4, tilt: .4, blink: false},
  };

  function newMotion() {
    return {
      lean: 0, vLean: 0, bob: 0, vBob: 0, lift: 0, vLift: 0, sq: 0, vsq: 0,
      tailPh: 0, tailKick: 0, blink: 0,
      target: {lean: 0, bob: 0},
      attention: null, pointerAt: 0, gazeAt: 0, glance: null,
      nextFidget: 0, nextBlink: 0, blinkAt: 0, double: false,
    };
  }

  /* 一步物理：弹簧 + 重力。纯函数式（就地修改传入的 s），测试可直接调用。 */
  function stepMotion(s, mood, dt, t) {
    const M = MOODS[mood] || MOODS.rest;
    const spring = (x, v, target, k, damp) => {
      const a = -k * (x - target) - damp * v;
      v += a * dt;
      return [x + v * dt, v];
    };
    s.tailKick *= Math.exp(-2.2 * dt);
    const nodY = M.nod ? Math.sin(t * Math.PI * 2 * M.nod[0]) * M.nod[1] : 0;
    [s.lean, s.vLean] = spring(s.lean, s.vLean, s.target.lean, 70, 9);
    [s.bob, s.vBob] = spring(s.bob, s.vBob, s.target.bob + nodY, 150, 12);
    [s.sq, s.vsq] = spring(s.sq, s.vsq, 0, 220, 12);
    if (s.lift > 0 || s.vLift > 0) {
      s.vLift -= 1400 * dt;          // 重力：单位是显示像素/秒²，跃起峰值约 8px
      s.lift += s.vLift * dt;
      if (s.lift <= 0) {
        s.lift = 0;
        if (s.vLift < -60) s.vsq -= Math.min(2.0, -s.vLift / 90);
        s.vLift = 0;
      }
    }
    s.tailPh += dt * (M.tail + s.tailKick * 8);
    return {M, breathe: Math.sin(t * Math.PI * 2 * M.rate) * .5 + .5};
  }

  /* 每个竖条的位移（像素，按 168px 宽的精灵标定），也是纯函数。
     dx：尾巴左右扫 + 头随视线/打字的横向轻移；dy：头点动 + 跃起（向上为正）。
     底边由 drawPlate 钳住，所以纵向只可能往上让，不可能把猫压出输入框。 */
  const LEAN_PX = 30;      // lean 满量程 → 头横移像素
  function stripOffset(profile, u, s, M, breathe) {
    const w = weightsAt(profile, u);
    const tailPx = Math.sin(s.tailPh) * M.tail + s.tailKick * 9;
    const dx = tailPx * w.tail
      + s.lean * LEAN_PX * M.tilt * w.head;
    const dy = s.bob * w.head
      + Math.cos(s.tailPh * .9) * M.tail * .35 * w.tail
      - s.lift;
    // dy 为正 = 向下（头点下去）；负 = 向上（跃起、抬头）
    const scaleY = 1 + breathe * M.breath * w.body - s.sq * .012;
    return {dx, dy, scaleY, head: w.head, tail: w.tail};
  }

  /* ── 读图 + 轮廓缓存（一次一张，空闲时预热） ─────────────────────────── */
  const cache = new Map();
  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image " + src));
    img.src = src;
  });
  const profileOfImage = (img) => {
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    if (!W || !H) return null;
    const sw = Math.min(220, W), sh = Math.max(1, Math.round(H * sw / W));
    const cv = document.createElement("canvas");
    cv.width = sw; cv.height = sh;
    const cx = cv.getContext("2d", {willReadFrequently: true});
    if (!cx) return null;
    cx.drawImage(img, 0, 0, sw, sh);
    const data = cx.getImageData(0, 0, sw, sh).data;
    const alpha = new Uint8Array(sw * sh);
    for (let i = 0, k = 3; i < alpha.length; i += 1, k += 4) alpha[i] = data[k];
    return profileFromAlpha(alpha, sw, sh);
  };
  const prepare = (src) => {
    if (!cache.has(src)) {
      cache.set(src, loadImage(src).then((img) => {
        let profile = null;
        try { profile = profileOfImage(img); } catch (e) { profile = null; }
        return {src, img, profile};
      }).catch(() => null));
    }
    return cache.get(src);
  };

  const warmQueue = [];
  let warming = false;
  const warmNext = () => {
    const src = warmQueue.shift();
    if (!src) { warming = false; return; }
    warming = true;
    setTimeout(() => {
      if (document.hidden) { warmQueue.unshift(src); warming = false; return; }
      prepare(src).catch(() => {}).finally(warmNext);
    }, 320);
  };
  const warm = (srcs) => {
    for (const src of srcs) if (src && !cache.has(src) && !warmQueue.includes(src)) warmQueue.push(src);
    if (!warming) warmNext();
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden && warmQueue.length && !warming) warmNext(); });

  /* ── 画一帧 ───────────────────────────────────────────────────────────── */
  function drawPlate(ctx, plate, motion, M, breathe, alpha, W, H) {
    if (!plate) return;
    const img = plate.img;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const contentH = H / (1 + PAD_TOP);
    const scale = Math.min(W / iw, contentH / ih);
    const dw = iw * scale, dh = ih * scale;
    const ox = (W - dw) / 2;
    const stripW = iw / STRIPS;
    // 动作幅度按实际显示宽度等比缩放（参数是按 168px 精灵标定的像素值）
    const k = dw / 168;
    ctx.globalAlpha = alpha;
    for (let i = 0; i < STRIPS; i += 1) {
      const u = (i + .5) / STRIPS;
      const o = stripOffset(plate.profile, u, motion, M, breathe);
      const sy = Math.max(.88, Math.min(1.14, o.scaleY));
      const hgt = dh * sy;
      const x = ox + (i * dw / STRIPS) + o.dx * k;
      // 底边钉在锚点：向下最多到画布底（不会被压出输入框），向上（跃起）自由
      const y = Math.min(H - hgt, H - hgt + o.dy * k);
      // 左右各多画 1px，避免竖条之间出现缝
      ctx.drawImage(img, i * stripW, 0, stripW + (i === STRIPS - 1 ? 0 : 1), ih, x, y, dw / STRIPS + 1, hgt);
    }
    ctx.globalAlpha = 1;
  }

  class Rig {
    constructor(figure) {
      this.figure = figure;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "pinkie-buddy__rig";
      this.canvas.setAttribute("aria-hidden", "true");
      Object.assign(this.canvas.style, {
        left: "0%", width: "100%",
        bottom: "0%",
        height: `${(1 + PAD_TOP) * 100}%`,
      });
      const ctx = this.canvas.getContext("2d", {alpha: true});
      if (!ctx) throw new Error("no 2d");
      this.ctx = ctx;
      this.motion = newMotion();
      this.mood = "rest";
      this.t = 0; this.last = 0; this.lastDraw = 0; this.raf = 0;
      this.paused = false; this.dead = false; this.visible = true;
      this.plate = null; this.closed = null;
      this.mix = 1; this.prev = null; this.mixFrom = 0;
      this.ticket = 0;
      this.nextFidget = performance.now() + 9000 + Math.random() * 8000;
      this.nextBlink = performance.now() + 2000;
      this.blinkAt = 0; this.double = false;
      this.canvas.addEventListener("contextlost", (e) => { e.preventDefault(); this.dead = true; this.onDead?.(); });
      figure.append(this.canvas);
      this.resize();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(figure);
      this.onVis = () => { if (!document.hidden) this.kick(); };
      document.addEventListener("visibilitychange", this.onVis);
      if (typeof IntersectionObserver === "function") {
        this.io = new IntersectionObserver((rows) => {
          this.visible = rows.some((r) => r.isIntersecting);
          if (this.visible) this.kick();
        }, {threshold: 0});
        this.io.observe(figure);
      }
      this.kick();
    }
    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(1, this.figure.clientWidth || 1);
      // the canvas follows the figure's real box (the art's own proportions), never a fixed ratio:
      // a hard-coded 168:90 stretched any other frame tall and thin
      const boxH = this.figure.clientHeight || W / (168 / 90);
      const H = Math.max(1, Math.round(boxH * (1 + PAD_TOP)));
      const w = Math.round(W * dpr), h = Math.round(H * dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w; this.canvas.height = h;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.cssW = W; this.cssH = H;
        this.kick();
      } else { this.cssW = W; this.cssH = H; }
    }
    async setImage(openSrc, closedSrc) {
      const ticket = (this.ticket = (this.ticket || 0) + 1);
      const open = await prepare(openSrc);
      if (ticket !== this.ticket || this.dead) return false;
      if (!open) return false;
      if (this.plate && this.plate.src !== open.src) { this.prev = this.plate; this.mixFrom = performance.now(); this.mix = 0; }
      this.plate = open;
      if (closedSrc) prepare(closedSrc).then((c) => { if (ticket === this.ticket && c) this.closed = c; }).catch(() => {});
      else this.closed = null;
      this.kick();
      return true;
    }
    setMood(m) {
      if (!MOODS[m]) return;
      this.mood = m;
      if (m === "sleepy") { this.motion.target.lean = 0; this.motion.target.bob = 0; }
      this.kick();
    }
    impulse(kind, amount = 0) {
      const s = this.motion;
      if (kind === "key") { s.vBob += 46; }
      else if (kind === "perk") { s.vBob -= 78; s.vsq += 1.2; }
      else if (kind === "boop") { s.vsq -= 2.6; s.vLean += (Math.random() < .5 ? -1 : 1) * 1.5; s.tailKick = 1; }
      else if (kind === "hop") { if (s.lift < .5) { s.vLift = 150; s.vsq += 1.6; s.tailKick = 1; } }
      else if (kind === "pulse") { s.vBob += 26; }
      else if (kind === "wake") { s.vBob -= 96; s.vsq += 1.5; s.vLean += (Math.random() < .5 ? -1 : 1) * 1.1; s.tailKick = 1; }
      else if (kind === "scroll") {
        const a = Math.max(-1, Math.min(1, amount / 160));
        s.vBob += a * 34; s.vLean += a * .3; s.tailKick = Math.max(s.tailKick, Math.abs(a) * .6);
      }
      this.kick();
    }
    attend(x, y, ms = 0) {
      this.motion.attention = x == null ? null : {x, y, until: ms ? performance.now() + ms : Infinity};
      this.kick();
    }
    look(x, y) {
      if (x == null) { this.motion.pointerAt = 0; return; }
      const r = this.figure.getBoundingClientRect();
      if (Math.hypot(x - (r.left + r.width * .4), y - (r.top + r.height * .45)) > 420) return;
      this.motion.pointerAt = performance.now();
      this.aim(x, y);
    }
    aim(x, y, gain = 1, near = true) {
      const s = this.motion;
      if (x == null) { s.target.lean = 0; s.target.bob = 0; this.kick(); return; }
      const r = this.figure.getBoundingClientRect();
      const hx = r.left + r.width * (this.plate?.profile?.headU ?? .3);
      const hy = r.top + r.height * .3;
      const dx = x - hx, dy = y - hy, dist = Math.hypot(dx, dy);
      const k = !near ? 1 : dist > 420 ? 0 : 1 - (dist / 420) * .5;
      const nx = clamp(dx / 260, -1, 1), ny = clamp(dy / 260, -1, 1);
      s.target.lean = nx * .42 * k * gain;
      s.target.bob = ny * 4.2 * k * gain;
      this.kick();
    }
    fidget(now) {
      const s = this.motion, kinds = ["tail", "shake", "glance", "blink", "hop"];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      if (kind === "tail") s.tailKick = 1;
      else if (kind === "shake") { s.vLean += (Math.random() < .5 ? -1 : 1) * 1.2; s.vsq += .8; }
      else if (kind === "glance") {
        const r = this.figure.getBoundingClientRect(), side = Math.random() < .5 ? -1 : 1;
        this.glance = [{x: r.left + r.width * .4 + side * 360, y: r.top - 100, until: now + 750}, {x: r.left + r.width * .4 - side * 300, y: r.top - 40, until: now + 1500}];
      } else if (kind === "blink") { this.nextBlink = now; this.forceDouble = true; }
      else if (kind === "hop" && s.lift < .5) s.vLift = 110;
    }
    kick() {
      if (!this.raf && !this.dead && !this.paused && !document.hidden && this.plate) {
        this.last = 0;
        this.raf = requestAnimationFrame((t) => this.frame(t));
      }
    }
    pause(on) { this.paused = Boolean(on); if (this.paused) { cancelAnimationFrame(this.raf); this.raf = 0; } else this.kick(); }
    frame(now) {
      this.raf = 0;
      if (this.dead || this.paused || document.hidden || !this.plate) return;
      if (!this.visible) { this.raf = requestAnimationFrame((t) => this.frame(t)); return; }
      // 被输入框菜单挡住时不画（CSS 里已隐藏），隔一会儿再看
      if ((this.visCheck = (this.visCheck || 0) + 1) % 24 === 0) {
        this.hiddenNow = this.figure.checkVisibility ? !this.figure.checkVisibility({checkVisibilityCSS: true, checkOpacity: true}) : false;
      }
      if (this.hiddenNow) { this.last = now; this.raf = requestAnimationFrame((t) => this.frame(t)); return; }
      const s = this.motion;
      const live = Math.abs(s.vLean) + Math.abs(s.vBob) + Math.abs(s.vsq) * 18 + Math.abs(s.vLift) + s.tailKick * 8 > .5 || s.lift > .01 || s.blink > 0 || this.mix < 1;
      const gap = 1000 / (live ? LIVE_FPS : IDLE_FPS);
      if (this.lastDraw && now - this.lastDraw < gap - 1.5) { this.raf = requestAnimationFrame((t) => this.frame(t)); return; }
      const dt = this.last ? Math.min(.05, (now - this.last) / 1000) : 1 / 60;
      this.last = now; this.t += dt;
      const {M, breathe} = stepMotion(s, this.mood, dt, this.t);
      // 视线：鼠标 2 秒没动就去看「正在发生的事」；闲着时偶尔东张西望
      const idleLook = now - s.pointerAt > 2200;
      if (idleLook && this.mood !== "sleepy" && now - s.gazeAt > 150) {
        s.gazeAt = now;
        while (this.glance?.length && this.glance[0].until < now) this.glance.shift();
        if (this.glance && !this.glance.length) this.glance = null;
        if (s.attention && s.attention.until < now) s.attention = null;
        const g = this.glance?.[0] || s.attention;
        if (g) this.aim(g.x, g.y, this.glance ? .9 : .7, false);
        else { s.target.lean = 0; s.target.bob = 0; }
      }
      if (now >= this.nextFidget) {
        this.nextFidget = now + 12000 + Math.random() * 18000;
        if ((this.mood === "rest" || this.mood === "typing") && idleLook && s.lift < .5) this.fidget(now);
      }
      // 眨眼：闭 70ms、停 40ms、睁 110ms；偶尔连眨两下
      const canBlink = Boolean(this.closed) && M.blink && !this.prev;
      if (canBlink && now >= this.nextBlink && !this.blinkAt) { this.blinkAt = now; this.double = this.forceDouble || Math.random() < .18; this.forceDouble = false; }
      if (this.blinkAt) {
        const e = now - this.blinkAt;
        s.blink = e < 70 ? e / 70 : e < 110 ? 1 : e < 220 ? 1 - (e - 110) / 110 : 0;
        if (e >= 220) {
          this.blinkAt = 0;
          if (this.double) { this.double = false; this.nextBlink = now + 120; }
          else this.nextBlink = now + 2400 + Math.random() * 3800;
        }
      } else s.blink = 0;
      if (!canBlink) s.blink = 0;
      if (this.prev) {
        this.mix = Math.min(1, (now - this.mixFrom) / 240);
        if (this.mix >= 1) { this.prev = null; this.mix = 1; }
      }
      this.paint(M, breathe);
      this.lastDraw = now;
      if (!this.shown) { this.shown = true; this.onReady?.(); }
      this.raf = requestAnimationFrame((t) => this.frame(t));
    }
    paint(M, breathe) {
      const ctx = this.ctx, W = this.cssW, H = this.cssH;
      if (!W || !H) return;
      ctx.clearRect(0, 0, W, H);
      if (this.prev) drawPlate(ctx, this.prev, this.motion, M, breathe, 1 - this.mix, W, H);
      drawPlate(ctx, this.plate, this.motion, M, breathe, this.prev ? this.mix : 1, W, H);
      if (this.closed && this.motion.blink > .01) drawPlate(ctx, this.closed, this.motion, M, breathe, this.motion.blink, W, H);
    }
    destroy() {
      cancelAnimationFrame(this.raf); this.raf = 0; this.dead = true;
      this.ro?.disconnect(); this.io?.disconnect();
      document.removeEventListener("visibilitychange", this.onVis);
      this.canvas.remove();
    }
  }

  const attach = (figure) => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
    try { return new Rig(figure); } catch { return null; }
  };

  window.__pinkieCatRig = {
    attach, prepare, warm, profileFromAlpha, weightsAt, stripOffset, stepMotion, newMotion, MOODS, STRIPS, PAD_TOP,
    get ready() { return Boolean(window.__pinkieCatRig); },
  };
})();
