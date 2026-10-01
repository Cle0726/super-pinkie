/* 冷启动开屏动效：碧琪「准备冲刺」。
   开场：画面从朦胧暖光里对焦，镜头轻推。
   等待：每 1.5 秒一个小循环——扭屁股、后蹄扬土、假胡子抖两下；彩纸和气球在文字上面飘。
   离场：进度走满，碧琪朝镜头猛冲，冲到镜头前的一刻从她脸上炸开圆洞，露出 App。
   画面是两层：补好的背景板 + 抠出来的碧琪（素材由 scripts/mode-transition-assets 生成），
   WebGL 合成；粒子画在 2D 画布上；进度条在原来的胶囊上加高光、发光前端、字变白和完成动效。
   laolao-splash.js 负责就绪判断和兜底，这里只管画面。不支持 WebGL、素材没加载出来、
   系统要求减少动态效果，或 localStorage['laolao:splash-fx']==='off' 时返回 null，静态开屏照常走完。 */
((root, factory) => {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PinkieSplashFx = api;
})(typeof window === "object" ? window : globalThis, (root) => {
  "use strict";

  const ASSET_VERSION = "splashfx1";
  const FINISH = 380;          // 就绪后进度走满
  const EXIT_DELAY = 260;      // 走满后停一下再冲
  const CHARGE = 420;          // 冲向镜头
  const IMPACT = 330;          // 冲到镜头前、冲破开屏的那一刻
  const HOLE = 560;            // 圆洞扩散
  const OPENING = 1250;        // 开场结束（已对焦、推镜完成）
  const CYCLE = 1500;          // 等待中的小循环
  const IDLE_FROM = 900;
  const LOAD_TIMEOUT = 2500;

  // 图片坐标（x 左到右、y 上到下，0–1）
  const ANCHOR = [.60, .92];               // 前蹄着地点：蓄力、扭动都绕这里
  const FACE = [.56, .60];                 // 冲向镜头时的中心
  const MUST = [.566, .69, .062, .034];    // 假胡子中心和半宽高
  const DUST = [.83, .80];                 // 后蹄扬尘
  const HAIR = [[.38, .24, .66, .56], [.63, .20, .95, .60], [.40, .50, .48, .70]];

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const easeOutCubic = (x) => 1 - (1 - x) ** 3;
  const easeInQuad = (x) => x * x;
  const easeInCubic = (x) => x * x * x;
  const smooth = (x) => x * x * (3 - 2 * x);
  const lerp = (a, b, x) => a + (b - a) * x;

  const assetUrls = () => ({
    // 和 laolao-splash.css 首帧用的是同一个地址，共用已经下载好的图。
    image: "/laolao-splash.png",
    mask: `/laolao-splash-mask.png?v=${ASSET_VERSION}`,
    plate: `/laolao-splash-plate.webp?v=${ASSET_VERSION}`,
    plateSoft: `/laolao-splash-plate-soft.png?v=${ASSET_VERSION}`,
    charSoft: `/laolao-splash-char-soft.png?v=${ASSET_VERSION}`,
  });

  // ---------- WebGL ----------
  const VERT = "attribute vec2 p; varying vec2 vUv; void main(){ vUv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }";
  const FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uImage, uPlate, uMask, uPlateSoft, uCharSoft;
    uniform vec2 uRes, uImg, uPan, uAnchor, uFace, uHopT, uHopS;
    uniform vec4 uMust, uHair[3];
    uniform vec3 uHole;
    uniform float uTime, uZoom, uCharge, uRot, uMustA, uMustS, uBlurBg, uBlurChar, uHaze, uWobble, uPx;
    vec2 cover(vec2 s) {
      float sa = uRes.x / uRes.y, ia = uImg.x / uImg.y;
      if (sa > ia) s.y = (s.y - .5) * (ia / sa) + .5; else s.x = (s.x - .5) * (sa / ia) + .5;
      return s;
    }
    float box(vec2 p, vec4 b) {
      vec2 q = vec2(p.x, 1. - p.y);
      return smoothstep(b.x - .03, b.x + .01, q.x) * (1. - smoothstep(b.z - .01, b.z + .03, q.x))
           * smoothstep(b.y - .03, b.y + .01, q.y) * (1. - smoothstep(b.w - .01, b.w + .03, q.y));
    }
    mat2 rot(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }
    void main() {
      float asp = uImg.x / uImg.y;
      vec2 p0 = cover(vUv);
      // 远处墙面几乎不动，地板越近动得越多，碧琪比地板还靠前。
      float depth = mix(.35, 1., 1. - smoothstep(.05, .55, p0.y));
      float zb = mix(1., uZoom, depth);
      vec2 pb = .5 + (p0 - .5) / zb + uPan * depth;
      float zc = 1. + (uZoom - 1.) * 1.22;
      vec2 pc0 = .5 + (p0 - .5) / zc + uPan * 1.22;
      // 冲向镜头：绕脸放大
      vec2 q = (pc0 - uFace) / uCharge;
      vec2 pcA = uFace + q;
      // 蓄力：绕前蹄缩放、扭动（按图片比例转，避免变形）
      q = pcA - uAnchor - uHopT;
      q.x *= asp; q = rot(uRot) * q; q.x /= asp;
      vec2 pc = uAnchor + q / uHopS;
      // 假胡子：只在胡子那一小块扭一扭、弹一弹
      vec2 md = (pc - uMust.xy) / uMust.zw;
      float mw = 1. - smoothstep(.55, 1.25, length(md));
      vec2 mq = pc - uMust.xy; mq.x *= asp;
      mq = rot(uMustA * mw) * mq; mq.y /= mix(1., uMustS, mw); mq.x /= asp;
      pc = uMust.xy + mq;

      // 鬃毛和尾巴的外圈轻轻飘动
      vec4 m = texture2D(uMask, pc);
      float hair = max(max(box(pc, uHair[0]), box(pc, uHair[1])), box(pc, uHair[2]));
      float band = clamp(m.r - m.g, 0., 1.) * hair * uWobble;
      vec2 wave = vec2(sin(pc.y * 46. + uTime * 2.3) + .5 * sin(pc.y * 91. - uTime * 3.1), cos(pc.x * 39. + uTime * 1.9)) * .0021 * band;
      vec2 pcd = pc + wave;
      float inside = step(0., pcd.x) * step(pcd.x, 1.) * step(0., pcd.y) * step(pcd.y, 1.);
      float a = smoothstep(.32, .68, texture2D(uMask, pcd).r) * inside;

      // 背景：挖空区用补好的背景板，其余直接用原图；清晰和柔焦之间过渡。
      float hole = texture2D(uMask, pb).b;
      vec3 sharpBg = mix(texture2D(uImage, pb).rgb, texture2D(uPlate, pb).rgb, hole);
      vec3 bg = mix(sharpBg, texture2D(uPlateSoft, pb).rgb, uBlurBg);
      vec4 sharp = vec4(texture2D(uImage, pcd).rgb * a, a);
      vec4 softC = texture2D(uCharSoft, pc) * inside;
      vec4 ch = mix(sharp, softC, uBlurChar);
      vec3 col = bg * (1. - ch.a) + ch.rgb;
      col = mix(col, vec3(1., .968, .98), uHaze * .42);

      // 冲破开屏：从碧琪脸的位置炸开圆洞，露出 App；洞口一圈亮边。
      float alpha = 1.;
      if (uHole.z > 0.) {
        vec2 dv = gl_FragCoord.xy - uHole.xy;
        float dist = length(dv), ang = atan(dv.y, dv.x);
        float edge = uHole.z * (1. + .05 * sin(ang * 7. + uTime * 6.) + .03 * sin(ang * 13. - uTime * 4.));
        float aa = 1.5 * uPx;
        alpha = smoothstep(edge - aa, edge + aa, dist);
        float rim = (1. - smoothstep(edge, edge + 26. * uPx, dist)) * alpha;
        col = mix(col, vec3(1., .86, .93), rim * .8);
      }
      gl_FragColor = vec4(col * alpha, alpha);
    }`;
  const UNIFORMS = ["uRes", "uImg", "uPan", "uAnchor", "uFace", "uHopT", "uHopS", "uMust", "uHair", "uHole", "uTime", "uZoom",
    "uCharge", "uRot", "uMustA", "uMustS", "uBlurBg", "uBlurChar", "uHaze", "uWobble", "uPx"];

  function createGL(canvas, images) {
    const gl = canvas.getContext("webgl", {premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: "high-performance"});
    if (!gl) return null;
    const shader = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link");
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const U = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)]));
    [["uImage", images.image, false], ["uPlate", images.plate, false], ["uMask", images.mask, false],
      ["uPlateSoft", images.plateSoft, false], ["uCharSoft", images.charSoft, true]].forEach(([name, src, premultiply], unit) => {
      const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    });
    gl.uniform2f(U.uImg, images.image.naturalWidth, images.image.naturalHeight);
    gl.uniform2f(U.uAnchor, ANCHOR[0], 1 - ANCHOR[1]);
    gl.uniform2f(U.uFace, FACE[0], 1 - FACE[1]);
    gl.uniform4f(U.uMust, MUST[0], 1 - MUST[1], MUST[2], MUST[3]);
    gl.uniform4fv(U.uHair, new Float32Array(HAIR.flat()));
    return {gl, U};
  }

  // ---------- 粒子：按时间计算位置，同一时间永远画出同一帧 ----------
  function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }
  const COLORS = ["#f06aa6", "#ffd166", "#8ecdf0", "#c9a7f5", "#ff9fc6", "#ffffff"];
  function makeParticles() {
    const r = rng(11);
    const pick = (list) => list[(r() * list.length) | 0];
    return {
      rain: Array.from({length: 70}, (_, i) => ({at: 200 + i * 95, x: r(), vy: .045 + r() * .05, sway: 14 + r() * 26, phase: r() * 6,
        freq: .0015 + r() * .0015, size: 5 + r() * 5, spin: (r() - .5) * .01, rot: r() * 6, color: pick(COLORS)})),
      balloons: Array.from({length: 4}, (_, i) => ({at: 500 + i * 1500, x: .06 + i * .09 + r() * .04, size: 22 + r() * 12,
        vy: .05 + r() * .02, sway: 10 + r() * 12, phase: r() * 6, color: ["#f37cb0", "#ffd166", "#8ecdf0", "#c9a7f5"][i]})),
      dust: Array.from({length: 14}, () => ({ang: -Math.PI * (.02 + r() * .4), speed: .06 + r() * .1, size: 12 + r() * 16, lift: r()})),
      pebbles: Array.from({length: 7}, () => ({ang: -Math.PI * (.1 + r() * .4), speed: .14 + r() * .12, size: 2 + r() * 2})),
      cannon: Array.from({length: 110}, () => ({ang: r() * Math.PI * 2, speed: .08 + r() * .3, size: 8 + r() * 10,
        spin: (r() - .5) * .04, rot: r() * 6, color: pick(COLORS), life: 520 + r() * 420, ride: .82 + r() * .2})),
      streaks: Array.from({length: 22}, () => ({ang: r() * Math.PI * 2, r0: .25 + r() * .3, len: 40 + r() * 90, w: 1.5 + r() * 2.5})),
      done: Array.from({length: 24}, () => ({ang: -Math.PI * (.1 + r() * .8), speed: .18 + r() * .3, size: 4 + r() * 4,
        spin: (r() - .5) * .03, rot: r() * 6, color: pick(COLORS), life: 650 + r() * 400})),
    };
  }
  function drawBalloon(ctx, x, y, s, color) {
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = "rgba(160,90,130,.55)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, s * 1.15); ctx.bezierCurveTo(-s * .3, s * 1.6, s * .3, s * 2.1, 0, s * 2.75); ctx.stroke();
    const g = ctx.createRadialGradient(-s * .35, -s * .4, s * .1, 0, 0, s * 1.15);
    g.addColorStop(0, "#ffffff"); g.addColorStop(.25, color); g.addColorStop(1, color);
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, s * .86, s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-s * .12, s * .98); ctx.lineTo(s * .12, s * .98); ctx.lineTo(0, s * 1.15); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function drawConfetti(ctx, x, y, size, rot, color, alpha) {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, Math.cos(rot * 2.3));
    ctx.fillStyle = color; ctx.fillRect(-size / 2, -size * .3, size, size * .6); ctx.restore();
  }
  function drawSparkle(ctx, x, y, rr, rot, color, alpha) {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = color; ctx.translate(x, y); ctx.rotate(rot); ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, k = i % 2 ? rr * .35 : rr; ctx.lineTo(Math.cos(a) * k, Math.sin(a) * k); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function drawPuff(ctx, x, y, rr, alpha) {
    ctx.save(); ctx.globalAlpha *= alpha;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, "rgba(255,246,236,.95)"); g.addColorStop(.6, "rgba(250,226,214,.55)"); g.addColorStop(1, "rgba(245,210,200,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  // ---------- 素材 ----------
  const reduced = () => Boolean(root.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  let webglChecked = null;
  function webglAvailable() {
    if (webglChecked !== null) return webglChecked;
    try {
      const probe = root.document.createElement("canvas");
      const gl = probe.getContext("webgl");
      webglChecked = Boolean(gl);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch { webglChecked = false; }
    return webglChecked;
  }
  const disabled = () => {
    try { return root.localStorage?.getItem?.("laolao:splash-fx") === "off"; } catch { return false; }
  };
  const supported = () => !reduced() && !disabled() && webglAvailable();
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new root.Image();
      image.decoding = "async";
      image.onload = () => (image.decode ? image.decode().then(() => resolve(image), () => resolve(image)) : resolve(image));
      image.onerror = () => reject(new Error(`load ${src}`));
      image.src = src;
    });
  }
  function withTimeout(promise, ms) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = root.setTimeout(() => reject(new Error("timeout")), ms); })])
      .finally(() => root.clearTimeout(timer));
  }
  const el = (tag, className, attrs = {}) => {
    const node = root.document.createElement(tag);
    node.className = className;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };

  // ---------- 一次开屏 ----------
  // host：#laolao-splash。onImpact：冲破开屏的那一刻（App 开始入场）。
  function play({host, onImpact} = {}) {
    if (!host || !supported()) return null;
    const shell = host.querySelector(".laolao-splash__progress-shell");
    const fill = host.querySelector(".laolao-splash__progress-fill");
    const message = host.querySelector(".laolao-splash__message");
    if (!shell || !fill || !message) return null;

    // 首帧的 CSS 画面还在朦胧状态，就从开场开始播；已经对焦好了，就直接接手对焦后的画面。
    let early = true;
    try { early = /blur\(18px\)/.test(root.getComputedStyle(host, "::after").filter || ""); } catch {}
    const offset = early ? 0 : OPENING;

    const glCanvas = el("canvas", "laolao-splash__gl", {"aria-hidden": "true"});
    const fxCanvas = el("canvas", "laolao-splash__particles", {"aria-hidden": "true"});
    const gloss = el("span", "laolao-splash__gloss", {"aria-hidden": "true"});
    const tip = el("span", "laolao-splash__tip", {"aria-hidden": "true"});
    tip.append(el("i", "laolao-splash__star"), el("i", "laolao-splash__star"));
    const lit = el("span", "laolao-splash__message laolao-splash__message--lit", {"aria-hidden": "true"});
    const flash = el("span", "laolao-splash__flash", {"aria-hidden": "true"});
    const added = [glCanvas, fxCanvas, gloss, tip, lit, flash];

    const parts = makeParticles();
    const view = {w: 1, h: 1, glScale: 1, fxScale: 1, left: 0, top: 0};
    let gl = null, U = null, fx = null, images = null, raf = 0, startAt = 0;
    let readyAt = Infinity, exitAt = Infinity, finishP = 0, shownP = 0, lastText = null;
    let active = false, destroyed = false, impacted = false, leaving = false, doneMarked = false, fallbackTimer = 0;
    let resolveFinished;
    const finished = new Promise((resolve) => { resolveFinished = resolve; });

    const resize = () => {
      const rect = host.getBoundingClientRect();
      view.w = Math.max(1, rect.width); view.h = Math.max(1, rect.height); view.left = rect.left; view.top = rect.top;
      const dpr = root.devicePixelRatio || 1;
      // 素材只有 1672 像素宽，画布再大也不会更清楚；封顶省 GPU。
      view.glScale = Math.min(dpr, Math.max(1, 2000 / view.w), 2);
      view.fxScale = Math.min(dpr, 2);
      glCanvas.width = Math.round(view.w * view.glScale); glCanvas.height = Math.round(view.h * view.glScale);
      fxCanvas.width = Math.round(view.w * view.fxScale); fxCanvas.height = Math.round(view.h * view.fxScale);
      gl?.viewport(0, 0, glCanvas.width, glCanvas.height);
    };

    const progressTarget = () => {
      const value = Number(shell.getAttribute("aria-valuenow"));
      return Number.isFinite(value) ? clamp(value / 100) : shownP;
    };

    const state = (t) => {
      const charge = clamp((t - exitAt) / CHARGE);
      // 开场：镜头从 1.06 推到 1，之后极慢地继续推近；冲刺时整个场景再往前冲一点。
      const zoom = lerp(1.06, 1, easeOutCubic(clamp(t / 1600))) + .022 * smooth(clamp((t - 1600) / 7000)) + .07 * easeInQuad(charge);
      const panX = lerp(.018, 0, easeOutCubic(clamp(t / 1600))) + .004 * Math.sin(t / 2100);
      // 对焦：碧琪先清楚，背景晚一点；冲刺时背景失焦。
      const blurChar = Math.max(1 - smooth(clamp((t - 150) / 600)), .55 * easeInQuad(charge));
      const blurBg = Math.max(1 - smooth(clamp((t - 300) / 850)), .9 * easeOutCubic(charge));
      const haze = Math.max(1 - easeOutCubic(clamp(t / 900)), .25 * Math.sin(Math.PI * charge));
      // 等待中的小动作
      const idle = clamp((t - IDLE_FROM) / 300);
      const c = Math.max(0, t - IDLE_FROM) % CYCLE;
      const breath = .5 - .5 * Math.cos((t - IDLE_FROM) / CYCLE * Math.PI * 2);
      let sy = 1 - .014 * breath * idle, sx = 1 + .007 * breath * idle, rot = 0;
      // 扭屁股：420ms 里来回三下，越扭越小
      if (c < 420 && t < exitAt) { const u = c / 420; rot = .022 * Math.sin(u * Math.PI * 6) * (1 - u) * idle; }
      // 抖胡子：900–1220ms 快速抖两下
      let mustA = 0, mustS = 1;
      if (c > 900 && c < 1220) {
        const u = (c - 900) / 320;
        mustA = .2 * Math.sin(u * Math.PI * 4) * (1 - u) * idle;
        mustS = 1 + .12 * Math.sin(u * Math.PI * 2) * (1 - u) * idle;
      }
      // 就绪后先压低蓄力，再冲
      if (t >= readyAt) {
        const windUp = smooth(clamp((t - readyAt) / FINISH)) * (1 - charge);
        sy *= 1 - .035 * windUp; sx *= 1 + .02 * windUp;
      }
      return {zoom, panX, blurChar, blurBg, haze, sy, sx, rot, mustA, mustS, c, idle, charge,
        chargeScale: 1 + .95 * easeInCubic(charge), ty: .03 * easeInQuad(charge), holeK: clamp((t - exitAt - IMPACT) / HOLE)};
    };

    // 图片上一点在开屏上的位置（角色层，含蓄力和冲刺）
    const toScreen = (ix, iy, s) => {
      const ia = images.image.naturalWidth / images.image.naturalHeight;
      let qx = (ix - ANCHOR[0]) * s.sx * ia, qy = ((1 - iy) - (1 - ANCHOR[1])) * s.sy;
      const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
      [qx, qy] = [cr * qx - sr * qy, sr * qx + cr * qy];
      let u = ANCHOR[0] + qx / ia, v = 1 - ANCHOR[1] + qy + s.ty;
      u = FACE[0] + (u - FACE[0]) * s.chargeScale; v = (1 - FACE[1]) + (v - (1 - FACE[1])) * s.chargeScale;
      const zc = 1 + (s.zoom - 1) * 1.22;
      let x = .5 + (u - .5 - s.panX * 1.22) * zc, y = .5 + (v - .5) * zc;
      const sa = view.w / view.h;
      if (sa > ia) y = (y - .5) / (ia / sa) + .5; else x = (x - .5) / (sa / ia) + .5;
      return {x: x * view.w, y: (1 - y) * view.h};
    };
    const farFrom = (p) => Math.max(Math.hypot(p.x, p.y), Math.hypot(view.w - p.x, p.y), Math.hypot(p.x, view.h - p.y), Math.hypot(view.w - p.x, view.h - p.y));
    // 圆洞：先快后慢地推开，能看到洞口往外冲。
    const holeRadius = (k, far) => (k > 0 ? 6 + (easeOutCubic(k) * .72 + k * .28) * far * 1.12 : 0);

    const render = (t) => {
      const s = state(t), d = view.glScale;
      gl.uniform2f(U.uRes, glCanvas.width, glCanvas.height);
      gl.uniform1f(U.uPx, d);
      gl.uniform1f(U.uTime, t / 1000);
      gl.uniform1f(U.uZoom, s.zoom);
      gl.uniform2f(U.uPan, s.panX, 0);
      gl.uniform2f(U.uHopT, 0, s.ty);
      gl.uniform2f(U.uHopS, s.sx, s.sy);
      gl.uniform1f(U.uRot, s.rot);
      gl.uniform1f(U.uCharge, s.chargeScale);
      gl.uniform1f(U.uMustA, s.mustA);
      gl.uniform1f(U.uMustS, s.mustS);
      gl.uniform1f(U.uBlurBg, s.blurBg);
      gl.uniform1f(U.uBlurChar, s.blurChar);
      gl.uniform1f(U.uHaze, s.haze);
      gl.uniform1f(U.uWobble, clamp(t / 700));
      const face = toScreen(FACE[0], FACE[1] - .02, s);
      const rim = holeRadius(s.holeK, farFrom(face));
      gl.uniform3f(U.uHole, face.x * d, (view.h - face.y) * d, rim * d);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      const ctx = fx;
      ctx.setTransform(view.fxScale, 0, 0, view.fxScale, 0, 0); ctx.clearRect(0, 0, view.w, view.h);
      ctx.globalAlpha = 1 - clamp((t - exitAt - IMPACT - 200) / 300);
      // 彩纸慢慢落、气球慢慢升（画在文字上面）
      for (const p of parts.rain) {
        const dt = t - p.at; if (dt < 0) continue;
        const y = -20 + p.vy * dt; if (y > view.h + 20) continue;
        drawConfetti(ctx, p.x * view.w + Math.sin(p.phase + dt * p.freq) * p.sway, y, p.size, p.rot + p.spin * dt, p.color, .85);
      }
      for (const b of parts.balloons) {
        const dt = t - b.at; if (dt < 0) continue;
        const y = view.h + 60 - b.vy * dt; if (y < -120) continue;
        ctx.save(); ctx.globalAlpha *= .9; drawBalloon(ctx, b.x * view.w + Math.sin(b.phase + dt / 800) * b.sway, y, b.size, b.color); ctx.restore();
      }
      if (s.idle > 0 && t < exitAt) {
        // 扭屁股时后蹄扬土
        if (s.c < 700) {
          const k = s.c / 700, hoof = toScreen(DUST[0], DUST[1], s), e = s.c;
          for (const p of parts.dust) drawPuff(ctx, hoof.x + Math.cos(p.ang) * p.speed * e * 1.4,
            hoof.y + Math.sin(p.ang) * p.speed * e * .7 - p.lift * 14 * k, p.size * (.7 + 1.1 * k), (1 - k) * .95);
          for (const p of parts.pebbles) {
            const x = hoof.x + Math.cos(p.ang) * p.speed * e, y = hoof.y + Math.sin(p.ang) * p.speed * e + .0009 * e * e;
            ctx.save(); ctx.globalAlpha *= 1 - k; ctx.fillStyle = "#d9a5b8"; ctx.beginPath(); ctx.arc(x, y, p.size, 0, Math.PI * 2); ctx.fill(); ctx.restore();
          }
        }
        // 抖胡子时旁边冒两颗小星
        if (s.c > 880 && s.c < 1300) {
          const k = (s.c - 880) / 420, a = toScreen(MUST[0] + .07, MUST[1] - .03, s), b = toScreen(MUST[0] - .075, MUST[1] - .02, s);
          drawSparkle(ctx, a.x + 10 * k, a.y - 14 * k, 7 * Math.sin(Math.PI * k), k * 3, "#fff4b8", 1);
          drawSparkle(ctx, b.x - 8 * k, b.y - 10 * k, 5 * Math.sin(Math.PI * k), -k * 3, "#ffffff", 1);
        }
      }
      // 冲向镜头：从脸周围往外射的速度线
      if (t >= exitAt && s.charge < 1) {
        const k = s.charge, f = toScreen(FACE[0], FACE[1], s), R = Math.hypot(view.w, view.h);
        for (const p of parts.streaks) {
          const r0 = (p.r0 + k * .5) * R * .5, r1 = r0 + p.len * (1 + k * 3);
          ctx.save(); ctx.globalAlpha *= .75 * Math.sin(Math.PI * k); ctx.strokeStyle = "#fffaf2"; ctx.lineWidth = p.w; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(f.x + Math.cos(p.ang) * r0, f.y + Math.sin(p.ang) * r0);
          ctx.lineTo(f.x + Math.cos(p.ang) * r1, f.y + Math.sin(p.ang) * r1); ctx.stroke(); ctx.restore();
        }
      }
      // 冲破的一瞬间：彩纸骑在洞口边缘往外喷
      const burst = t - exitAt - IMPACT;
      if (burst > 0) {
        ctx.globalAlpha = 1;
        for (const p of parts.cannon) {
          if (burst > p.life) continue;
          const dd = rim * p.ride + p.speed * burst;
          drawConfetti(ctx, face.x + Math.cos(p.ang) * dd, face.y + Math.sin(p.ang) * dd + .0004 * burst * burst,
            p.size, p.rot + p.spin * burst, p.color, 1 - clamp((burst - p.life * .6) / (p.life * .4)));
        }
      }
      // 进度条走满：末端撒一把
      const doneAt = t - (readyAt + FINISH);
      if (doneAt > 0 && doneAt < 1100) {
        ctx.globalAlpha = 1;
        const b = shell.getBoundingClientRect(), x0 = b.right - view.left - 14, y0 = b.top - view.top + b.height / 2;
        for (const p of parts.done) {
          if (doneAt > p.life) continue;
          drawConfetti(ctx, x0 + Math.cos(p.ang) * p.speed * doneAt, y0 + Math.sin(p.ang) * p.speed * doneAt + .0006 * doneAt * doneAt,
            p.size, p.rot + p.spin * doneAt, p.color, 1 - clamp((doneAt - p.life * .6) / (p.life * .4)));
        }
      }
    };

    // 进度条：填充按宽度走（最短一个圆头），白字层跟着裁切；台词换了就弹一下。
    const syncBar = (t) => {
      shownP = t < readyAt ? progressTarget() : lerp(finishP, 1, easeOutCubic(clamp((t - readyAt) / FINISH)));
      const w = shell.clientWidth, h = shell.clientHeight, filled = h + (w - h) * shownP;
      fill.style.width = `${filled.toFixed(1)}px`;
      lit.style.clipPath = `inset(0 ${(w - filled).toFixed(1)}px 0 0)`;
      tip.style.translate = `${filled.toFixed(1)}px 0`;
      shell.style.setProperty("--laolao-splash-progress", shownP.toFixed(3));
      const text = message.textContent;
      if (text !== lastText) {
        lastText = text;
        lit.textContent = text;
        for (const node of [message, lit]) { node.classList.remove("is-swapping"); void node.offsetWidth; node.classList.add("is-swapping"); }
      }
      if (!doneMarked && t >= readyAt + FINISH * .6) { doneMarked = true; shell.classList.add("is-done"); }
    };

    const restoreDom = () => {
      for (const node of added) node.remove();
      host.classList.remove("laolao-splash--fx", "is-fx-leaving");
      shell.classList.remove("is-done");
      for (const prop of ["width"]) fill.style.removeProperty(prop);
      shell.style.removeProperty("--laolao-splash-progress");
      message.classList.remove("is-swapping");
    };
    const cleanup = ({restore = false} = {}) => {
      if (destroyed) return;
      destroyed = true; active = false;
      root.cancelAnimationFrame(raf);
      root.clearTimeout(fallbackTimer);
      root.removeEventListener("resize", resize);
      try { gl?.getExtension("WEBGL_lose_context")?.loseContext(); } catch {}
      // 退回静态开屏时由 laolao-splash.js 自己触发 App 入场；正常播完或兜底结束才在这里补上。
      if (restore) restoreDom();
      else if (!impacted) { impacted = true; try { onImpact?.(); } catch {} }
      resolveFinished();
    };

    const tick = (now) => {
      if (destroyed) return;
      const t = now - startAt + offset;
      syncBar(t);
      render(t);
      if (!leaving && t >= exitAt) { leaving = true; host.classList.add("is-fx-leaving"); }
      if (!impacted && t >= exitAt + IMPACT) { impacted = true; try { onImpact?.(); } catch {} }
      if (t >= exitAt + IMPACT + HOLE + 120) { cleanup(); return; }
      raf = root.requestAnimationFrame(tick);
    };

    const ready = (async () => {
      const urls = assetUrls();
      const entries = await withTimeout(Promise.all(Object.entries(urls).map(async ([key, url]) => [key, await loadImage(url)])), LOAD_TIMEOUT);
      if (destroyed) throw new Error("aborted");
      images = Object.fromEntries(entries);
      host.prepend(glCanvas);
      host.append(fxCanvas);
      fill.append(gloss);
      shell.append(tip, lit, flash);
      resize();
      const created = createGL(glCanvas, images);
      if (!created) throw new Error("webgl");
      ({gl, U} = created);
      fx = fxCanvas.getContext("2d");
      root.addEventListener("resize", resize);
      startAt = root.performance.now();
      syncBar(offset);
      render(offset);
      // 第一帧画好后再隐藏 CSS 首帧，交接时不会闪。
      host.classList.add("laolao-splash--fx");
      active = true;
      raf = root.requestAnimationFrame(tick);
    })();
    ready.catch(() => cleanup({restore: true}));

    return {
      ready,
      get active() { return active && !destroyed; },
      // 页面就绪：进度走满、碧琪冲出去、冲破开屏。返回的 Promise 在画面播完后结束。
      finish() {
        if (!active || destroyed) return finished;
        if (readyAt === Infinity) {
          const t = root.performance.now() - startAt + offset;
          finishP = shownP;
          readyAt = t;
          exitAt = readyAt + FINISH + EXIT_DELAY;
          // 窗口被隐藏时动画时钟会停，不能让开屏一直挡着。
          if (root.document.hidden) cleanup();
          else fallbackTimer = root.setTimeout(() => cleanup(), FINISH + EXIT_DELAY + IMPACT + HOLE + 1500);
        }
        return finished;
      },
      abort() { cleanup({restore: true}); },
    };
  }

  return {supported, play, assetUrls, _test: {ANCHOR, FACE, MUST, timings: {FINISH, EXIT_DELAY, CHARGE, IMPACT, HOLE, OPENING}}};
});
