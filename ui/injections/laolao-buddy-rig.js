/* 输入框上碧琪的「活气」：把同一张图放进一张会微微变形的网格里（WebGL），不用新素材也能动起来。
   - 一直在：很轻的呼吸、头发和尾巴慢慢晃、隔几秒眨一下眼；
   - 鼠标靠近：头轻轻偏向鼠标；点她：被戳得一缩、头发弹一下；
   - 你打字：每敲一下她跟着轻点一下头；碧琪输出时：跟着节奏点头、尾巴摆得快一点；
   - 完成：蹦一下再落回输入框上沿；困了：呼吸变慢、不再眨眼。
   眼睛位置、头发和尾巴的范围都是第一次载入图片时自动从像素里找出来的（每张图算一次并缓存）。
   底边一直钉在输入框上沿，不会“飘”起来。页面隐藏、减少动态效果、或 WebGL 不可用时退回原来的静态图。 */
(() => {
  "use strict";
  if (window.__pinkieBuddyRig) return;

  const GRID_X = 36, GRID_Y = 22;
  const cache = new Map();

  /* ── 读图：找眼睛、眼皮颜色、头发和尾巴的范围 ───────────────────────── */
  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  const analyse = (img) => {
    const W = img.naturalWidth, H = img.naturalHeight;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const cx = cv.getContext("2d", {willReadFrequently: true});
    cx.drawImage(img, 0, 0);
    const px = cx.getImageData(0, 0, W, H).data;
    const at = (x, y) => (y * W + x) * 4;
    const lum = (i) => .299 * px[i] + .587 * px[i + 1] + .114 * px[i + 2];
    const isIris = (i) => px[i + 3] > 200 && px[i + 2] > 140 && px[i + 2] - px[i] > 45 && px[i + 1] > 95 && px[i + 1] - px[i] > 15;
    const isDark = (i) => px[i + 3] > 200 && lum(i) < 70;
    const isWhite = (i) => px[i + 3] > 200 && px[i] > 225 && px[i + 1] > 225 && px[i + 2] > 225;
    const isHair = (i) => {
      if (px[i + 3] < 160) return false;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      return r > 170 && g < 120 && b > 90 && r - g > 100;   // 头发是更深更艳的粉
    };

    // 1. 虹膜：蓝色连通块，里面要有黑瞳孔（屁股上的气球标记没有）
    const seen = new Uint8Array(W * H);
    const blobs = [];
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const k = y * W + x;
      if (seen[k] || !isIris(k * 4)) continue;
      const stack = [k]; seen[k] = 1;
      let n = 0, sx = 0, sy = 0, x0 = x, x1 = x, y0 = y, y1 = y;
      while (stack.length) {
        const q = stack.pop(), qx = q % W, qy = (q / W) | 0;
        n += 1; sx += qx; sy += qy;
        if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = qx + dx, ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nk = ny * W + nx;
          if (!seen[nk] && isIris(nk * 4)) { seen[nk] = 1; stack.push(nk); }
        }
      }
      if (n < 25) continue;
      let dark = 0;
      for (let yy = y0; yy <= y1; yy += 1) for (let xx = x0; xx <= x1; xx += 1) if (isDark(at(xx, yy))) dark += 1;
      if (dark < 4) continue;
      blobs.push({n, cx: sx / n, cy: sy / n, x0, x1, y0, y1});
    }
    blobs.sort((a, b) => b.n - a.n);
    // 两只眼：高度接近、大小接近
    let eyesBlobs = [];
    for (let i = 0; i < blobs.length && !eyesBlobs.length; i += 1) for (let j = i + 1; j < blobs.length; j += 1) {
      const a = blobs[i], b = blobs[j];
      if (Math.abs(a.cy - b.cy) < H * .09 && Math.abs(a.cx - b.cx) > W * .03 && Math.abs(a.cx - b.cx) < W * .22 && Math.min(a.n, b.n) / Math.max(a.n, b.n) > .3) { eyesBlobs = [a, b]; break; }
    }
    // 只找到一只“眼”多半是蓝色发饰：宁可不眨眼

    // 2. 每只眼的范围：从虹膜往外长，吃进眼白、瞳孔、眼眶黑线，限定在半径内
    const mask = new Uint8ClampedArray(W * H * 4);
    for (let k = 3; k < mask.length; k += 4) mask[k] = 255;   // 不透明，上传时预乘透明度才不会把通道清零
    const eyes = [];
    eyesBlobs.slice(0, 2).forEach((b, idx) => {
      const r = Math.max(b.x1 - b.x0, b.y1 - b.y0) * .5;
      const R = r * 1.75;
      const inEye = new Uint8Array(W * H);
      const stack = [];
      for (let y = b.y0; y <= b.y1; y += 1) for (let x = b.x0; x <= b.x1; x += 1) {
        const k = y * W + x;
        if (Math.hypot(x - b.cx, y - b.cy) <= r * 1.05 && px[k * 4 + 3] > 120) { inEye[k] = 1; stack.push(k); }
      }
      // 眼白要真的白（脸上的浅粉不算），黑的（瞳孔、眼眶、睫毛）可以长得远一点
      const sat = (i) => Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]);
      const ok = (i) => isIris(i) || isDark(i) || isWhite(i) || (px[i + 3] > 200 && lum(i) > 215 && sat(i) < 28);
      while (stack.length) {
        const q = stack.pop(), qx = q % W, qy = (q / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = qx + dx, ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nk = ny * W + nx;
          if (inEye[nk]) continue;
          const dist = Math.hypot((nx - b.cx) * .9, ny - b.cy);
          if (dist > R * 1.25 || (dist > R * 1.1 && !(isDark(nk * 4) && ny < b.cy)) || (dist > R && !isWhite(nk * 4) && !isDark(nk * 4))) continue;
          if (ok(nk * 4)) { inEye[nk] = 1; stack.push(nk); }
        }
      }
      // 补洞 + 外扩一圈，免得眨眼时留下亮边。只扫眼睛附近（整张图扫一遍要几十毫秒，会卡一下）
      let x0 = W, x1 = 0, y0 = H, y1 = 0;
      const reach = R * 1.25 + 3;
      const sy0 = Math.max(2, Math.floor(b.cy - reach)), sy1 = Math.min(H - 3, Math.ceil(b.cy + reach));
      const sx0 = Math.max(2, Math.floor(b.cx - reach / .9)), sx1 = Math.min(W - 3, Math.ceil(b.cx + reach / .9));
      for (let y = sy0; y <= sy1; y += 1) for (let x = sx0; x <= sx1; x += 1) {
        const k = y * W + x;
        let hit = inEye[k];
        if (!hit) for (let dy = -2; dy <= 2 && !hit; dy += 1) for (let dx = -2; dx <= 2 && !hit; dx += 1) hit = dx * dx + dy * dy <= 5 && inEye[k + dy * W + dx];
        if (!hit) continue;
        mask[k * 4 + idx] = 255;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      // 眼皮颜色：眼睛外面一圈脸上最常见的颜色（避开黑线、眼白和头发）
      const buckets = new Map();
      for (let y = Math.max(0, y0 - 6); y <= Math.min(H - 1, y1 + 4); y += 1) for (let x = Math.max(0, x0 - 5); x <= Math.min(W - 1, x1 + 5); x += 1) {
        const k = y * W + x, i = k * 4;
        if (mask[i + idx] || px[i + 3] < 240 || lum(i) < 150 || isWhite(i) || isHair(i)) continue;
        const key = (px[i] >> 3) << 10 | (px[i + 1] >> 3) << 5 | (px[i + 2] >> 3);
        const e = buckets.get(key) || {n: 0, r: 0, g: 0, b: 0};
        e.n += 1; e.r += px[i]; e.g += px[i + 1]; e.b += px[i + 2];
        buckets.set(key, e);
      }
      let best = null;
      for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
      const lidColor = best ? [best.r / best.n / 255, best.g / best.n / 255, best.b / best.n / 255] : [.98, .76, .87];
      eyes.push({box: [x0 / W, y0 / H, (x1 + 1) / W, (y1 + 1) / H], cx: b.cx / W, cy: b.cy / H, lid: lidColor});
    });

    // 3. 每个网格顶点的权重：头（以眼睛为中心）、尾巴（最右边那团）、头发（深粉像素，模糊后）
    const hair = new Float32Array(W * H);
    for (let k = 0; k < W * H; k += 1) hair[k] = isHair(k * 4) ? 1 : 0;
    let right = 0;
    for (let x = W - 1; x >= 0 && !right; x -= 1) for (let y = 0; y < H; y += 1) if (px[at(x, y) + 3] > 100) { right = x; break; }
    const head = eyes.length ? {x: eyes.reduce((s, e) => s + e.cx, 0) / eyes.length, y: eyes.reduce((s, e) => s + e.cy, 0) / eyes.length} : {x: .33, y: .5};
    const weights = new Float32Array((GRID_X + 1) * (GRID_Y + 1) * 3);
    const rad = 7;
    for (let gy = 0; gy <= GRID_Y; gy += 1) for (let gx = 0; gx <= GRID_X; gx += 1) {
      const u = gx / GRID_X, v = gy / GRID_Y, o = (gy * (GRID_X + 1) + gx) * 3;
      const dx = (u - head.x) / .26, dy = (v - head.y) / .62;
      weights[o] = Math.exp(-(dx * dx + dy * dy) * 1.4);
      const tailStart = Math.max(.55, right / W - .3);
      weights[o + 1] = Math.min(1, Math.max(0, (u - tailStart) / (right / W - tailStart + 1e-3))) ** 1.6;
      const sx = Math.round(u * (W - 1)), sy = Math.round(v * (H - 1));
      let s = 0, c = 0;
      for (let yy = Math.max(0, sy - rad); yy <= Math.min(H - 1, sy + rad); yy += 2) for (let xx = Math.max(0, sx - rad); xx <= Math.min(W - 1, sx + rad); xx += 2) { s += hair[yy * W + xx]; c += 1; }
      weights[o + 2] = c ? s / c : 0;
    }
    return {W, H, eyes, head, weights, mask: new ImageData(mask, W, H)};
  };

  const prepare = (src) => {
    if (!cache.has(src)) cache.set(src, loadImage(src).then((img) => ({img, ...analyse(img)})));
    return cache.get(src);
  };
  /* 空闲时把这个模式的几张表情图先算好，一次一张，隔开一点，换表情时就不会卡那一下 */
  const warmQueue = [];
  let warming = false;
  const warmNext = () => {
    const src = warmQueue.shift();
    if (!src) { warming = false; return; }
    warming = true;
    setTimeout(() => {
      if (document.hidden) { warmQueue.unshift(src); warming = false; return; }
      prepare(src).catch(() => {}).finally(warmNext);
    }, 350);
  };
  const warm = (srcs) => {
    for (const src of srcs) if (!cache.has(src) && !warmQueue.includes(src)) warmQueue.push(src);
    if (!warming) warmNext();
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden && warmQueue.length && !warming) warmNext(); });

  /* ── 画：一张网格 + 两张图交替（换表情时淡入淡出） ─────────────────────── */
  const VS = `
attribute vec2 aUV; attribute vec3 aW0; attribute vec3 aW1;
uniform vec2 uImg; uniform vec4 uRect; uniform float uMixW;
uniform vec2 uPivot; uniform float uTheta; uniform vec2 uHead; uniform float uBreath;
uniform vec2 uTail; uniform vec2 uHair; uniform float uT; uniform vec2 uSquash; uniform float uLift;
varying vec2 vUV;
void main() {
  vec3 w = mix(aW0, aW1, uMixW);
  vec2 p = aUV * uImg;
  float ground = smoothstep(uImg.y, uImg.y * .84, p.y);
  float body = (uImg.y - p.y) / uImg.y;
  p.y -= uBreath * body * uImg.y * (.55 + .45 * w.x);
  float a = uTheta * w.x * ground;
  vec2 d = p - uPivot;
  p = uPivot + mat2(cos(a), sin(a), -sin(a), cos(a)) * d;
  p += uHead * w.x * ground;
  p += uTail * w.y * ground * vec2(1., .6);
  float ph = aUV.x * 9. + aUV.y * 7.;
  p += vec2(sin(uT * 17. + ph), cos(uT * 15. + ph * 1.3)) * uHair.x * w.z * ground;
  p += vec2(sin(uT * 1.7 + ph), cos(uT * 1.3 + ph)) * uHair.y * w.z * ground;
  p.x = uImg.x * .5 + (p.x - uImg.x * .5) * uSquash.x;
  p.y = uImg.y - (uImg.y - p.y) * uSquash.y - uLift;
  vUV = aUV;
  gl_Position = vec4(uRect.x + p.x / uImg.x * uRect.z, uRect.y - p.y / uImg.y * uRect.w, 0., 1.);
}`;
  const FS = `
precision mediump float;
uniform sampler2D uTex0; uniform sampler2D uTex1; uniform sampler2D uMask0; uniform sampler2D uMask1;
uniform float uMix; uniform float uBlink;
uniform vec4 uEyeA0; uniform vec4 uEyeB0; uniform vec3 uLidA0; uniform vec3 uLidB0;
uniform vec4 uEyeA1; uniform vec4 uEyeB1; uniform vec3 uLidA1; uniform vec3 uLidB1;
varying vec2 vUV;
const vec3 LASH = vec3(.23, .10, .16);
vec4 lid(vec4 c, float m, vec4 box, vec3 skin) {
  if (m < .01 || uBlink < .01 || box.z <= box.x) return c;
  vec2 l = (vUV - box.xy) / (box.zw - box.xy);
  float cx = l.x * 2. - 1.;
  float edge = uBlink * 1.12 - .06 * (1. - cx * cx);
  float shut = uBlink > .82 ? 1. : smoothstep(edge + .05, edge - .03, l.y);
  vec3 col = mix(c.rgb, skin * c.a, shut * m);
  // 合上时那条弯弯的睫毛线；半合时眼皮下沿也有一道
  float lineY = uBlink > .82 ? .58 + .2 * (1. - cx * cx) : edge;
  float line = (1. - smoothstep(.045, .1, abs(l.y - lineY))) * smoothstep(1., .72, abs(cx)) * smoothstep(.25, .6, uBlink);
  col = mix(col, LASH * c.a, line * m);
  return vec4(col, c.a);
}
void main() {
  vec4 a = texture2D(uTex0, vUV), b = texture2D(uTex1, vUV);
  vec4 ma = texture2D(uMask0, vUV), mb = texture2D(uMask1, vUV);
  a = lid(lid(a, ma.r, uEyeA0, uLidA0), ma.g, uEyeB0, uLidB0);
  b = lid(lid(b, mb.r, uEyeA1, uLidA1), mb.g, uEyeB1, uLidB1);
  gl_FragColor = mix(a, b, uMix);
}`;

  // 画布比图大一圈，留出蹦跳和歪头的空间（单位：图宽 / 图高的比例）
  const PAD = {l: .08, r: .08, t: .24, b: .02};
  const MOODS = {
    rest: {breath: [.25, .022], tail: [1.0, 6], wobble: 1.0, blink: true},
    typing: {breath: [.3, .022], tail: [1.5, 6.5], wobble: 1.2, blink: true},
    working: {breath: [.32, .024], tail: [2.4, 8], wobble: 1.4, blink: true, nod: [1.1, 3.2]},
    happy: {breath: [.4, .026], tail: [6.5, 10], wobble: 2.0, blink: false},
    sleepy: {breath: [.13, .04], tail: [.35, 2.5], wobble: .5, blink: false},
  };

  class Rig {
    constructor(figure) {
      this.figure = figure;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "pinkie-buddy__rig";
      this.canvas.setAttribute("aria-hidden", "true");
      Object.assign(this.canvas.style, {left: `${-PAD.l * 100}%`, width: `${(1 + PAD.l + PAD.r) * 100}%`, top: `${-PAD.t / (1) * 100}%`, height: `${(1 + PAD.t + PAD.b) * 100}%`});
      const gl = this.canvas.getContext("webgl", {premultipliedAlpha: true, alpha: true, antialias: true, powerPreference: "low-power"});
      if (!gl) throw new Error("no webgl");
      this.gl = gl;
      this.prog = this.program(VS, FS);
      this.loc = {};
      const names = ["uImg", "uRect", "uMixW", "uPivot", "uTheta", "uHead", "uBreath", "uTail", "uHair", "uT", "uSquash", "uLift", "uTex0", "uTex1", "uMask0", "uMask1", "uMix", "uBlink", "uEyeA0", "uEyeB0", "uLidA0", "uLidB0", "uEyeA1", "uEyeB1", "uLidA1", "uLidB1"];
      for (const n of names) this.loc[n] = gl.getUniformLocation(this.prog, n);
      this.aUV = gl.getAttribLocation(this.prog, "aUV");
      this.aW0 = gl.getAttribLocation(this.prog, "aW0");
      this.aW1 = gl.getAttribLocation(this.prog, "aW1");
      this.buildGrid();
      this.items = new Map();
      this.front = null; this.back = null; this.mix = 0; this.mixFrom = 0;
      this.mood = "rest"; this.t = 0; this.last = 0; this.raf = 0;
      this.s = {theta: 0, vTheta: 0, hx: 0, vhx: 0, hy: 0, vhy: 0, sq: 0, vsq: 0, lift: 0, vLift: 0, hair: 0, tailPh: 0, tailKick: 0, blink: 0};
      this.target = {theta: 0, hx: 0, hy: 0};
      // 看哪儿：鼠标最优先；鼠标停了就看「正在发生的事」（碧琪在写的回复、你在打的字）；闲着时偶尔东张西望
      this.pointerAt = 0; this.attention = null; this.glance = null; this.gazeAt = 0;
      this.nextFidget = performance.now() + 9000 + Math.random() * 8000;
      this.nextBlink = performance.now() + 1800;
      this.blinkAt = 0; this.double = false;
      this.canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.dead = true; this.onDead?.(); });
      figure.append(this.canvas);
      this.resize();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(figure);
      this.onVis = () => { if (!document.hidden) this.kick(); };
      document.addEventListener("visibilitychange", this.onVis);
    }
    program(vs, fs) {
      const gl = this.gl;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }
    buildGrid() {
      const gl = this.gl, uv = [], idx = [];
      for (let y = 0; y <= GRID_Y; y += 1) for (let x = 0; x <= GRID_X; x += 1) uv.push(x / GRID_X, y / GRID_Y);
      for (let y = 0; y < GRID_Y; y += 1) for (let x = 0; x < GRID_X; x += 1) {
        const i = y * (GRID_X + 1) + x;
        idx.push(i, i + 1, i + GRID_X + 1, i + 1, i + GRID_X + 2, i + GRID_X + 1);
      }
      this.uvBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
      this.idxBuf = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      this.count = idx.length;
    }
    texture(source) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    async setImage(src) {
      const ticket = (this.ticket = (this.ticket || 0) + 1);
      const data = await prepare(src);
      if (ticket !== this.ticket || this.dead) return false;
      let item = this.items.get(src);
      if (!item) {
        const gl = this.gl;
        const w = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, w); gl.bufferData(gl.ARRAY_BUFFER, data.weights, gl.STATIC_DRAW);
        item = {data, tex: this.texture(data.img), mask: this.texture(data.mask), w};
        this.items.set(src, item);
      }
      if (this.front === item) return true;
      if (!this.front) { this.front = item; this.mix = 0; }
      else { this.back = item; this.mixFrom = performance.now(); }
      this.kick();
      return true;
    }
    setMood(m) {
      if (!MOODS[m]) return;
      this.mood = m;
      if (m === "sleepy") this.target.theta = this.target.hx = this.target.hy = 0;
      this.kick();
    }
    impulse(kind, amount = 0) {
      const s = this.s;
      if (kind === "key") { s.vhy += 55; s.hair = Math.min(3.5, s.hair + .9); }
      else if (kind === "perk") { s.vhy -= 90; s.vsq += 1.4; s.hair = Math.min(4, s.hair + 2); }
      else if (kind === "boop") { s.vsq -= 3; s.hair = Math.min(5, s.hair + 4); s.vTheta += (Math.random() < .5 ? -1 : 1) * 1.6; }
      else if (kind === "hop") { if (s.lift < .5) { s.vLift = 220; s.vsq += 2.2; s.hair = Math.min(5, s.hair + 3); } }
      else if (kind === "pulse") { s.vhy += 30; s.hair = Math.min(2.5, s.hair + .5); }
      else if (kind === "wake") { s.vhy -= 110; s.vsq += 1.8; s.hair = Math.min(5, s.hair + 3.5); s.vTheta += (Math.random() < .5 ? -1 : 1) * 1.2; s.tailKick = 1; }
      else if (kind === "scroll") {
        // 滚动聊天时头发和脑袋跟着惯性晃一下（amount：这一帧滚了多少像素，向下为正）
        const a = Math.max(-1, Math.min(1, amount / 160));
        s.vhy += a * 38; s.vTheta += a * .35; s.hair = Math.min(4, s.hair + Math.abs(a) * 1.4);
      }
      this.kick();
    }
    /* 东张西望、甩甩尾巴…闲着时偶尔做个小动作，让她看起来是活的 */
    fidget(now) {
      const s = this.s, kinds = ["tail", "shake", "glance", "blink", "hop"];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      if (kind === "tail") s.tailKick = 1;
      else if (kind === "shake") { s.hair = Math.min(5, s.hair + 3.5); s.vTheta += (Math.random() < .5 ? -1 : 1) * 1.3; }
      else if (kind === "glance") {
        const r = this.figure.getBoundingClientRect(), side = Math.random() < .5 ? -1 : 1;
        this.glance = [{x: r.left + r.width * .3 + side * 380, y: r.top - 120, until: now + 750}, {x: r.left + r.width * .3 - side * 300, y: r.top - 60, until: now + 1500}];
      } else if (kind === "blink") { this.nextBlink = now; this.forceDouble = true; }
      else if (kind === "hop") { if (s.lift < .5) { s.vLift = 130; s.hair = Math.min(4, s.hair + 1.5); } }
    }
    attend(x, y, ms = 0) {
      this.attention = x == null ? null : {x, y, until: ms ? performance.now() + ms : Infinity};
      this.kick();
    }
    look(x, y) {
      // x, y：鼠标的屏幕坐标；null 表示鼠标离开窗口
      if (x == null || !this.front) { this.pointerAt = 0; return; }
      // 只有鼠标在她附近（420px 内）才抢走视线；远处的鼠标不打扰她看别的
      const r = this.figure.getBoundingClientRect();
      if (Math.hypot(x - (r.left + r.width * this.front.data.head.x), y - (r.top + r.height * this.front.data.head.y)) > 420) return;
      this.pointerAt = performance.now();
      this.aim(x, y);
    }
    aim(x, y, gain = 1, near = true) {
      if (x == null || !this.front) { this.target.theta = this.target.hx = this.target.hy = 0; this.kick(); return; }
      const r = this.figure.getBoundingClientRect();
      const hx = r.left + r.width * this.front.data.head.x, hy = r.top + r.height * this.front.data.head.y;
      const dx = x - hx, dy = y - hy, dist = Math.hypot(dx, dy);
      // 鼠标越近她越专注；看「事情」时不论远近都转过去
      const k = !near ? 1 : dist > 420 ? 0 : 1 - dist / 420 * .5;
      const nx = Math.max(-1, Math.min(1, dx / 260)), ny = Math.max(-1, Math.min(1, dy / 260));
      this.target.theta = nx * .13 * k * gain;
      this.target.hx = nx * 5 * k * gain;
      this.target.hy = ny * 3 * k * gain;
      this.kick();
    }
    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.kick(); }
    }
    kick() { if (!this.raf && !this.dead && !this.paused && !document.hidden) { this.last = 0; this.raf = requestAnimationFrame((t) => this.frame(t)); } }
    /* 转场盖住页面时先停，省下 GPU 给转场 */
    pause(on) { this.paused = Boolean(on); if (this.paused) { cancelAnimationFrame(this.raf); this.raf = 0; } else this.kick(); }
    frame(now) {
      this.raf = 0;
      if (this.dead || this.paused || document.hidden || !this.front) return;
      // 被输入框的菜单挡住（她会先躲起来）时不画，隔一会儿再看
      if ((this.visCheck = (this.visCheck || 0) + 1) % 20 === 0) this.hiddenNow = this.figure.checkVisibility ? !this.figure.checkVisibility({checkVisibilityCSS: true, checkOpacity: true}) : false;
      if (this.hiddenNow) { this.last = now; this.raf = requestAnimationFrame((t) => this.frame(t)); return; }
      const dt = this.last ? Math.min(.05, (now - this.last) / 1000) : 1 / 60;
      this.last = now; this.t += dt;
      const s = this.s, m = MOODS[this.mood] || MOODS.rest;
      const spring = (x, v, target, k, damp) => { const a = -k * (x - target) - damp * v; v += a * dt; return [x + v * dt, v]; };
      // 有动作时满帧，平时 30 帧就够
      const lively = Math.abs(s.vTheta) + Math.abs(s.vhy) + Math.abs(s.vhx) + Math.abs(s.vsq) * 20 + Math.abs(s.vLift) + s.hair * 10 + s.tailKick * 10 > .6 || this.back || s.lift > .01 || s.blink > 0;
      // 视线：鼠标 2 秒没动，就转去看正在发生的事；闲着时偶尔东张西望
      const idleLook = now - this.pointerAt > 2200;
      if (idleLook && this.mood !== "sleepy" && now - this.gazeAt > 150) {
        this.gazeAt = now;
        while (this.glance?.length && this.glance[0].until < now) this.glance.shift();
        if (this.glance && !this.glance.length) this.glance = null;
        if (this.attention && this.attention.until < now) this.attention = null;
        const g = this.glance?.[0] || this.attention;
        if (g) this.aim(g.x, g.y, this.glance ? .9 : .7, false); else this.target.theta = this.target.hx = this.target.hy = 0;
      }
      if (now >= this.nextFidget) {
        this.nextFidget = now + 12000 + Math.random() * 18000;
        if ((this.mood === "rest" || this.mood === "typing") && idleLook && s.lift < .5) this.fidget(now);
      }
      s.tailKick *= Math.exp(-2.2 * dt);
      let nodY = 0;
      if (m.nod) nodY = Math.sin(this.t * Math.PI * 2 * m.nod[0]) * m.nod[1];
      [s.theta, s.vTheta] = spring(s.theta, s.vTheta, this.target.theta, 70, 9);
      [s.hx, s.vhx] = spring(s.hx, s.vhx, this.target.hx, 70, 10);
      [s.hy, s.vhy] = spring(s.hy, s.vhy, this.target.hy + nodY, 160, 13);
      [s.sq, s.vsq] = spring(s.sq, s.vsq, 0, 220, 12);
      if (s.lift > 0 || s.vLift > 0) {
        s.vLift -= 900 * dt; s.lift += s.vLift * dt;
        if (s.lift <= 0) { s.lift = 0; if (s.vLift < -60) { s.vsq -= Math.min(2.6, -s.vLift / 90); s.hair = Math.min(5, s.hair + 2.5); } s.vLift = 0; }
      }
      s.hair *= Math.exp(-3.2 * dt);
      s.tailPh += dt * (m.tail[0] + s.tailKick * 9);
      // 眨眼：闭 70ms，停 40ms，睁 110ms；偶尔连眨两下
      const eyes = this.front.data.eyes.length > 1 && m.blink && !this.back;
      if (eyes && now >= this.nextBlink && !this.blinkAt) { this.blinkAt = now; this.double = this.forceDouble || Math.random() < .18; this.forceDouble = false; }
      if (this.blinkAt) {
        const e = now - this.blinkAt;
        s.blink = e < 70 ? e / 70 : e < 110 ? 1 : e < 220 ? 1 - (e - 110) / 110 : 0;
        if (e >= 220) {
          this.blinkAt = 0;
          if (this.double) { this.double = false; this.nextBlink = now + 120; }
          else this.nextBlink = now + 2400 + Math.random() * 3800;
        }
      } else s.blink = 0;
      if (!eyes) s.blink = 0;
      // 换表情
      let mix = 0;
      if (this.back) {
        mix = Math.min(1, (now - this.mixFrom) / 260);
        if (mix >= 1) { this.front = this.back; this.back = null; mix = 0; }
      }
      if (lively || mix || now - (this.lastDraw || 0) > 32) { this.draw(mix, m); this.lastDraw = now; }
      this.raf = requestAnimationFrame((t) => this.frame(t));
    }
    draw(mix, m) {
      const gl = this.gl, L = this.loc, s = this.s, f = this.front, b = this.back || this.front;
      const {W, H} = f.data;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.prog);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf); gl.enableVertexAttribArray(this.aUV); gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, f.w); gl.enableVertexAttribArray(this.aW0); gl.vertexAttribPointer(this.aW0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.w); gl.enableVertexAttribArray(this.aW1); gl.vertexAttribPointer(this.aW1, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
      const tw = 1 + PAD.l + PAD.r, th = 1 + PAD.t + PAD.b;
      gl.uniform2f(L.uImg, W, H);
      gl.uniform4f(L.uRect, -1 + 2 * PAD.l / tw, 1 - 2 * PAD.t / th, 2 / tw, 2 / th);
      gl.uniform1f(L.uMixW, mix);
      const head = f.data.head;
      gl.uniform2f(L.uPivot, head.x * W, Math.min(.92, head.y + .34) * H);
      gl.uniform1f(L.uTheta, s.theta);
      gl.uniform2f(L.uHead, s.hx, s.hy);
      gl.uniform1f(L.uBreath, (Math.sin(this.t * Math.PI * 2 * m.breath[0]) * .5 + .5) * m.breath[1]);
      const tail = m.tail[1] + s.tailKick * 7;
      gl.uniform2f(L.uTail, Math.sin(s.tailPh) * tail, Math.cos(s.tailPh * .9) * tail * .5);
      gl.uniform2f(L.uHair, s.hair, m.wobble);
      gl.uniform1f(L.uT, this.t);
      gl.uniform2f(L.uSquash, 1 - s.sq * .5, 1 + s.sq);
      gl.uniform1f(L.uLift, s.lift);
      const bind = (unit, tex, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); };
      bind(0, f.tex, L.uTex0); bind(1, b.tex, L.uTex1); bind(2, f.mask, L.uMask0); bind(3, b.mask, L.uMask1);
      gl.uniform1f(L.uMix, mix);
      gl.uniform1f(L.uBlink, s.blink);
      const eye = (item, i) => item.data.eyes[i] || {box: [0, 0, 0, 0], lid: [1, 1, 1]};
      const put = (item, a, bb, la, lb) => {
        const e0 = eye(item, 0), e1 = eye(item, 1);
        gl.uniform4fv(a, e0.box); gl.uniform4fv(bb, e1.box); gl.uniform3fv(la, e0.lid); gl.uniform3fv(lb, e1.lid);
      };
      put(f, L.uEyeA0, L.uEyeB0, L.uLidA0, L.uLidB0);
      put(b, L.uEyeA1, L.uEyeB1, L.uLidA1, L.uLidB1);
      gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
      if (!this.shown) { this.shown = true; this.onReady?.(); }
    }
    destroy() {
      cancelAnimationFrame(this.raf); this.raf = 0; this.dead = true;
      this.ro?.disconnect(); document.removeEventListener("visibilitychange", this.onVis);
      this.canvas.remove();
    }
  }

  const attach = (figure) => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
    try { return new Rig(figure); } catch { return null; }
  };

  window.__pinkieBuddyRig = {prepare, analyse, attach, warm, GRID_X, GRID_Y};
})();
