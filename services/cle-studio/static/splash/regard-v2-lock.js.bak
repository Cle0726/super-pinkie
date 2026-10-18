// Le regard — the C.le. opening, shot like a film close-up.
// Two full-bleed oil keyframes (a macro on the eyes, then a medium close-up), each with an
// eyes-closed twin. The painting never warps; the camera moves, and only the eyes live.
//
//   const r = await createRegard(canvas, {base: './art/', signature});
//   r.play();  r.hold();  await r.exit();  r.renderAt(seconds, {exitAfter});  r.dispose();

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uAo, uAc, uBo, uBc;          // macro open/closed, wide open/closed
uniform vec2 uRes, uSizeA, uSizeB;
uniform vec3 uCamA, uCamB;                     // centre (image px) + zoom (screen px per image px)
uniform vec4 uEyeA0, uEyeA1, uEyeB0, uEyeB1;   // cx, cy, w, h (image px)
uniform vec4 uAngs;                            // tilts A0 A1 B0 B1
uniform float uMix, uExpose, uLid, uGlow, uReveal, uTime, uGrain;
uniform vec2 uRevealAt;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * noise(p); p *= 2.03; a *= .5; } return s; }
vec2 rot(vec2 d, float a){ float c = cos(a), s = sin(a); return vec2(c*d.x - s*d.y, s*d.x + c*d.y); }

// parted-lid mask: 1 where the open eye shows, 0 on the closed lid
float lid(vec2 p, vec4 eye, float ang, float ap){
  vec2 q = rot(p - eye.xy, -ang) / (vec2(eye.z, eye.w) * vec2(.60, .80));
  float half_ = ap * pow(clamp(1. - q.x*q.x, 0., 1.), .55);
  float e = .02 + .10 * (1. - ap);
  return (1. - smoothstep(half_ - e, half_ + e, abs(q.y))) * step(abs(q.x), 1.06);
}
float region(vec2 p, vec4 eye, float ang){
  vec2 q = rot(p - eye.xy, -ang) / (vec2(eye.z, eye.w) * vec2(.95, 1.7));
  return 1. - smoothstep(.8, 1.15, length(q));
}

vec3 shot(sampler2D o, sampler2D c, vec2 size, vec3 cam, vec4 e0, vec4 e1, float a0, float a1, vec2 frag, out float glowOut){
  vec2 p = cam.xy + (frag - uRes * .5) / cam.z * vec2(1., -1.);
  vec2 uv = clamp(p / size, vec2(0.), vec2(1.));
  vec3 open = texture(o, uv).rgb, closed = texture(c, uv).rgb;
  float rg = max(region(p, e0, a0), region(p, e1, a1));
  float m = max(lid(p, e0, a0, uLid), lid(p, e1, a1, uLid)) * rg;
  vec3 col = mix(closed, open, m);
  // the coat is lit by the scene; the eyes are emitters and ignore the exposure
  float iris = clamp((open.b - open.r) * 2.4 - .15, 0., 1.) * m;
  col = mix(col * uExpose, open * (1. + .30 * uGlow), iris);
  // bloom from the painting's own blurred mip levels: only the blue light blooms
  vec3 soft = textureLod(o, uv, 4.5).rgb, wide = textureLod(o, uv, 6.5).rgb;
  float b1 = clamp((soft.b - soft.r) * 2.0 - .1, 0., 1.), b2 = clamp((wide.b - wide.r) * 2.0 - .1, 0., 1.);
  glowOut = (b1 * .65 + b2 * .55) * rg * uLid;
  return col;
}

void main(){
  vec2 frag = vUv * uRes;
  float gA = 0., gB = 0.;
  vec3 col = shot(uAo, uAc, uSizeA, uCamA, uEyeA0, uEyeA1, uAngs.x, uAngs.y, frag, gA);
  float g = gA;
  if (uMix > 0.) {
    vec3 b = shot(uBo, uBc, uSizeB, uCamB, uEyeB0, uEyeB1, uAngs.z, uAngs.w, frag, gB);
    col = mix(col, b, uMix); g = mix(gA, gB, uMix);
  }
  col += vec3(.06, .48, 1.) * g * uGlow * .30 + vec3(.5, .86, 1.) * g * g * uGlow * .10;
  vec2 sv = vUv - .5; sv.x *= uRes.x / uRes.y;
  col *= mix(.55, 1., smoothstep(1.05, .25, length(sv)));          // lens vignette
  col += (hash(frag + fract(uTime) * 91.7) - .5) * uGrain;          // film grain
  float alpha = 1.;
  if (uReveal > 0.) {                                               // the dark opens from between the eyes
    vec2 d = frag - uRevealAt; float r = length(d) / length(uRes);
    vec2 dir = d / max(length(d), 1e-3);
    float brush = (fbm(dir * 46. + r * 2.2) * .10 + fbm(dir * 5. + r * 1.1 + 7.) * .035 + (noise(frag * .06) - .5) * .025) * smoothstep(0., .06, r);
    float edge = uReveal * .72 - .10;
    alpha = smoothstep(edge - .012, edge + .012, r + brush);
  }
  outColor = vec4(col * alpha, alpha);
}`;

const ease = {
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  expo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => (img.decode ? img.decode().catch(() => {}).then(() => resolve(img)) : resolve(img));
    img.onerror = () => reject(new Error('regard: failed to load ' + src));
    img.src = src;
  });
}

export async function createRegard(canvas, {base = './art/', signature = null, reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches} = {}) {
  const gl = canvas.getContext('webgl2', {premultipliedAlpha: true, alpha: true, antialias: false});
  if (!gl) throw new Error('regard: webgl2 unavailable');
  const meta = await fetch(base + 'regard.json').then((r) => r.json());
  const imgs = await Promise.all([meta.macro.open, meta.macro.closed, meta.wide.open, meta.wide.closed].map((f) => loadImage(base + f)));

  const compile = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const textures = imgs.map((img, unit) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, ['uAo', 'uAc', 'uBo', 'uBc'][unit]), unit);
    return t;
  });
  const U = {};
  for (const n of ['uRes', 'uSizeA', 'uSizeB', 'uCamA', 'uCamB', 'uEyeA0', 'uEyeA1', 'uEyeB0', 'uEyeB1', 'uAngs', 'uMix', 'uExpose', 'uLid', 'uGlow', 'uReveal', 'uTime', 'uGrain', 'uRevealAt']) U[n] = gl.getUniformLocation(prog, n);
  const A = meta.macro, B = meta.wide, deg = Math.PI / 180;
  gl.uniform2f(U.uSizeA, A.size[0], A.size[1]);
  gl.uniform2f(U.uSizeB, B.size[0], B.size[1]);
  const eyeU = (u, e) => gl.uniform4f(u, e.cx, e.cy, e.w, e.h);
  eyeU(U.uEyeA0, A.eyes[0]); eyeU(U.uEyeA1, A.eyes[1]); eyeU(U.uEyeB0, B.eyes[0]); eyeU(U.uEyeB1, B.eyes[1]);
  gl.uniform4f(U.uAngs, A.eyes[0].angle * deg, A.eyes[1].angle * deg, B.eyes[0].angle * deg, B.eyes[1].angle * deg);
  const mid = (s) => ({x: (s.eyes[0].cx + s.eyes[1].cx) / 2, y: (s.eyes[0].cy + s.eyes[1].cy) / 2, span: Math.hypot(s.eyes[1].cx - s.eyes[0].cx, s.eyes[1].cy - s.eyes[0].cy)});
  const mA = mid(A), mB = mid(B);

  // ---- the shot list (seconds) ----
  // 0.0 black · 0.3–1.4 the macro emerges, eyes shut · 1.3–2.1 the lids part, the gaze ignites
  // 2.0–3.4 the camera draws back; the macro dissolves into the medium close-up, eyes locked
  // 3.4– hold: the glow breathes, a slow blink now and then; the signature writes itself
  const T = {emerge: [0.3, 1.4], open: [1.3, 2.1], pull: [2.0, 4.0], dissolve: [2.35, 3.3], hold: 3.4, sign: [3.0, 4.5]};
  let mode = 'idle', startedAt = 0, exitAt = 0, exitResolve = null, raf = 0, disposed = false;
  let nextBlink = 0, blinkAt = -10;

  const state = (t) => {
    const s = {expose: 0, lid: 0, glow: 0, mix: 0, pull: 0, reveal: 0, sign: 0};
    const live = mode !== 'frame' && mode !== 'exit-frame';
    if (mode === 'held') {
      s.expose = 1; s.mix = 1; s.pull = 1; s.sign = 1; s.lid = 1;
    } else {
      s.expose = ease.sine(seg(t, ...T.emerge));
      s.lid = ease.expo(seg(t, ...T.open));
      s.pull = ease.inOut(seg(t, ...T.pull));
      s.mix = ease.inOut(seg(t, ...T.dissolve));
      s.sign = seg(t, ...T.sign);
    }
    const flare = Math.exp(-Math.pow((t - 2.05) / .26, 2));
    s.glow = (mode === 'held' ? 1 : ease.out(seg(t, T.open[0] + .1, T.open[1] + .3))) * (.78 + .12 * Math.sin(t * 1.2) + (mode === 'held' ? 0 : .5 * flare));
    if (t >= T.hold || mode === 'held') {
      if (live && t >= nextBlink) { blinkAt = t; nextBlink = t + 5.5 + Math.random() * 3.5; }
      const b = t - blinkAt;                                        // a slow, deliberate cat blink
      if (b >= 0 && b < .62) s.lid *= b < .15 ? 1 - ease.inOut(b / .15) : ease.out(clamp01((b - .25) / .37));
    }
    if (mode === 'exit' || mode === 'exit-frame') {
      const e = t - exitAt;
      if (e >= 0 && e < .5) s.lid *= e < .14 ? 1 - ease.inOut(e / .14) : ease.out(clamp01((e - .2) / .3));
      s.reveal = ease.inOut(seg(e, .42, 1.25));
    }
    return s;
  };

  const cover = (size, W, H) => Math.max(W / size[0], H / size[1]);
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  const draw = (t) => {
    resize();
    const s = state(t);
    const W = canvas.width, H = canvas.height;
    // A, the macro: a slow push-out (a camera breathes, it never stops dead)
    const zA = cover(A.size, W, H) * lerp(1.14, 1.0, s.pull);
    // B, the medium close-up: at the dissolve its eyes sit exactly where A's are; then it
    // keeps drawing back to its own cover framing
    const zLock = zA * (mA.span / mB.span);
    const zHome = cover(B.size, W, H) * 1.03;
    const k = ease.inOut(seg(s.pull, .25, 1));
    const zB = zLock * Math.pow(zHome / zLock, k);
    const camB = {x: lerp(mB.x, B.size[0] / 2, k), y: lerp(mB.y, B.size[1] / 2, k)};
    // keep B's frame edges inside the image while it is settling
    const halfW = W / 2 / zB, halfH = H / 2 / zB;
    camB.x = Math.min(Math.max(camB.x, halfW), B.size[0] - halfW);
    camB.y = Math.min(Math.max(camB.y, halfH), B.size[1] - halfH);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform3f(U.uCamA, mA.x, mA.y, zA);
    gl.uniform3f(U.uCamB, camB.x, camB.y, zB);
    gl.uniform1f(U.uMix, s.mix);
    gl.uniform1f(U.uExpose, s.expose);
    gl.uniform1f(U.uLid, s.lid);
    gl.uniform1f(U.uGlow, s.glow);
    gl.uniform1f(U.uReveal, s.reveal);
    gl.uniform1f(U.uTime, t);
    gl.uniform1f(U.uGrain, .016);
    gl.uniform2f(U.uRevealAt, W * .5 + (mB.x - camB.x) * zB, H * .5 - (mB.y - camB.y) * zB);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (signature) {
      const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
      const width = Math.min(240, cssW * .17);
      const el = signature.svg;
      el.style.left = `${cssW / 2 - width / 2}px`;
      el.style.top = `${cssH * .82}px`;
      el.style.width = `${width}px`;
      el.style.opacity = String(Math.max(0, 1 - s.reveal * 3) * Math.min(1, s.sign * 6));
      signature.write(s.sign);
    }
    return s;
  };

  const loop = (now) => {
    if (disposed) return;
    const s = draw((now - startedAt) / 1000);
    if (mode === 'exit' && s.reveal >= 1) { mode = 'done'; exitResolve?.(); return; }
    raf = requestAnimationFrame(loop);
  };

  return {
    play() {
      mode = 'play'; startedAt = performance.now(); nextBlink = T.hold + 3.5;
      if (reducedMotion) mode = 'held';
      cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    },
    hold() {
      mode = 'held'; startedAt = performance.now(); nextBlink = 2.5;
      cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    },
    exit() {
      return new Promise((resolve) => {
        exitResolve = resolve;
        if (reducedMotion) { mode = 'done'; resolve(); return; }
        const t = (performance.now() - startedAt) / 1000;
        // never cut the opening short: leave right after the eyes have settled
        if (mode === 'play' && t < T.hold) setTimeout(() => { mode = 'exit'; exitAt = (performance.now() - startedAt) / 1000; }, (T.hold - t) * 1000);
        else { if (mode === 'held') mode = 'exit'; else mode = 'exit'; exitAt = t; }
      });
    },
    renderAt(seconds, {exitAfter = null} = {}) {
      mode = exitAfter == null ? 'frame' : 'exit-frame'; exitAt = exitAfter ?? 0; nextBlink = 1e9;
      return draw(seconds);
    },
    dispose() {
      disposed = true; cancelAnimationFrame(raf);
      for (const t of textures) gl.deleteTexture(t);
      gl.deleteBuffer(buf); gl.deleteProgram(prog);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
