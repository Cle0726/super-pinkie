// Le regard — the C.le. opening. One shot only: the macro on his eye, a painting that never warps.
// In the dark a raking light finds the gold in his fur; a seam of ice-blue lights along the closed
// lid; the eye cracks open, overshoots a breath and settles; the pupil, dilated in the dark, narrows
// to a slit as the light reaches it; light runs over the knife-cut facets of the iris, a ripple of
// refraction leaves the eye and gold leaf lifts off his face. To leave, he blinks — slowly, as cats
// do to someone they trust — and the screen opens in the shape of his eye onto the room.
//
//   const r = await createRegard(canvas, {base: './art/'});
//   r.play();  r.hold();  await r.exit();  r.renderAt(seconds, {exitAfter});  r.dispose();

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uO, uC;                      // eye open / closed (same painting)
uniform vec2 uRes, uSize, uPupil, uSeamAt;
uniform vec3 uCam;                             // centre (image px) + zoom (screen px per image px)
uniform vec4 uEye;                             // cx, cy, w, h (image px)
uniform float uAng, uExpose, uLid, uGlow, uDil, uTime, uGrain, uSheen, uRipple, uSeam, uAperture, uScale;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * noise(p); p *= 2.03; a *= .5; } return s; }
vec2 rot(vec2 d, float a){ float c = cos(a), s = sin(a); return vec2(c*d.x - s*d.y, s*d.x + c*d.y); }

// parted-lid mask in eye space: 1 where the open eye shows
float lid(vec2 p, float ap){
  vec2 q = rot(p - uEye.xy, -uAng) / (uEye.zw * vec2(.60, .80));
  float half_ = ap * pow(clamp(1. - q.x*q.x, 0., 1.), .55);
  float e = .02 + .10 * (1. - ap);
  return (1. - smoothstep(half_ - e, half_ + e, abs(q.y))) * step(abs(q.x), 1.06);
}
float region(vec2 p){ vec2 q = rot(p - uEye.xy, -uAng) / (uEye.zw * vec2(.95, 1.7)); return 1. - smoothstep(.8, 1.15, length(q)); }
// the closed lid's seam as a thin line (eye space distance to the lid's meeting curve)
float seamLine(vec2 p){
  vec2 q = rot(p - uEye.xy, -uAng) / (uEye.zw * vec2(.60, .80));
  float along = 1. - smoothstep(.85, 1.05, abs(q.x));
  return along * exp(-pow(q.y / .045, 2.));
}

void main(){
  vec2 frag = vUv * uRes;
  vec2 p = uCam.xy + (frag - uRes * .5) / uCam.z * vec2(1., -1.);

  // a ripple of refraction leaving the eye once it is open
  if (uRipple > 0. && uRipple < 1.6) {
    vec2 d = p - uEye.xy; float r = length(d);
    float front = uRipple * 1400.;
    float w = exp(-pow((r - front) / 90., 2.)) * (1. - uRipple / 1.6);
    p += normalize(d + 1e-3) * sin((r - front) * .05) * 7. * w;
  }

  vec2 uv = clamp(p / uSize, vec2(0.), vec2(1.));
  float lod = max(0., log2(1. / max(uCam.z, 1e-4)));       // explicit LOD (WebKit derivatives)
  vec3 closed = textureLod(uC, uv, lod).rgb;

  // the pupil: dilated in the dark, it narrows to a slit as the light reaches it (local horizontal
  // magnification around the slit, inside the iris only)
  vec2 dp = p - uPupil;
  float near = exp(-dot(dp / vec2(70., 120.), dp / vec2(70., 120.)) * 1.6) * region(p);
  vec2 po = uPupil + dp / vec2(1. + uDil * 2.2 * near, 1. + uDil * .12 * near);
  vec3 open = textureLod(uO, clamp(po / uSize, vec2(0.), vec2(1.)), lod).rgb;

  float rg = region(p);
  float lm = lid(p, uLid);
  float m = lm * rg;
  vec3 col = mix(closed, open, m);

  // the iris is an emitter: it ignores the exposure, and light runs over its knife-cut facets
  float iris = clamp((open.b - open.r) * 2.4 - .15, 0., 1.) * m;
  float facets = pow(fbm(p * .022 + vec2(uTime * .35, -uTime * .22)), 3.) * 2.2 + pow(noise(p * .09 + uTime * 1.3), 8.) * 1.6;
  vec3 irisCol = open * (1. + .30 * uGlow) + vec3(.25, .62, 1.) * facets * uGlow * .55;
  col = mix(col * uExpose, irisCol, iris);

  // the lid's edge catches light while it moves
  vec3 nearBlue = textureLod(uO, uv, 3.5).rgb;
  float onEye = clamp((nearBlue.b - nearBlue.r) * 3. - .1, 0., 1.);
  float edge = 4. * lm * (1. - lm) * onEye * step(.02, uLid) * step(uLid, .995);
  col += vec3(.55, .82, 1.) * edge * .55 * uGlow;

  // a seam of ice-blue along the closed lid: the gaze lit from inside before it opens
  // the seam follows his painted lid: the faint blue of the crease in the closed painting
  float crease = clamp((closed.b - closed.r) * 6. - .12, 0., 1.) * region(p) * smoothstep(.0, .25, seamLine(p) + lid(p, .5));
  float seam = crease * uSeam * (1. - m);
  col += vec3(.18, .55, 1.) * seam * 1.6 + vec3(.7, .9, 1.) * seam * seam * .8;

  // a low raking light finds the gold in the fur: only the brush ridges catch it
  vec3 soft = textureLod(uO, uv, lod + 3.).rgb;
  float ridge = max(0., dot(open - soft, vec3(.4, .4, .2))) * 3.;
  float band = exp(-pow((dot(p - uEye.xy, normalize(vec2(1., .55))) - mix(-1500., 1900., uSheen)) / 260., 2.));
  col += vec3(1., .78, .42) * ridge * band * .9 * uExpose * step(.001, uSheen) * step(uSheen, .999);

  // bloom from the painting's own blurred mips: only the blue light blooms
  vec3 b1 = textureLod(uO, uv, 4.5).rgb, b2 = textureLod(uO, uv, 6.5).rgb;
  float g = (clamp((b1.b - b1.r) * 2. - .1, 0., 1.) * .65 + clamp((b2.b - b2.r) * 2. - .1, 0., 1.) * .55) * rg * uLid;
  col += vec3(.06, .48, 1.) * g * uGlow * .32 + vec3(.5, .86, 1.) * g * g * uGlow * .12;
  float sb = exp(-length((p - uEye.xy) / (uEye.zw * vec2(1.4, 2.2)))) * uSeam * (1. - uLid);
  col += vec3(.1, .4, 1.) * sb * .35;

  vec2 sv = vUv - .5; sv.x *= uRes.x / uRes.y;
  col *= mix(.5, 1., smoothstep(1.05, .22, length(sv)));         // lens vignette
  col += (hash(frag + fract(uTime) * 91.7) - .5) * uGrain;         // film grain

  // leaving: the screen opens in the shape of his eye, from the seam outward, onto the room
  float alpha = 1.;
  if (uAperture > 0.) {
    vec2 d = rot(frag - uSeamAt, uAng) / uRes.y;
    float k = uAperture * uAperture;
    vec2 R = vec2(mix(.18, 3.2, k), mix(.0, 2.4, k)) * uScale;
    vec2 q = d / max(R, vec2(1e-4));
    float shape = pow(clamp(1. - q.x * q.x, 0., 1.), .55);
    float brush = (fbm(d * 24. + uTime * .3) - .5) * .08;
    float inside = 1. - smoothstep(-.03, .03, abs(q.y) - shape + brush);
    inside *= step(abs(q.x), 1.);
    alpha = 1. - inside;
    float rim = exp(-pow((abs(q.y) - shape + brush) / .06, 2.)) * step(abs(q.x), 1.) * (1. - k);
    col += vec3(.3, .7, 1.) * rim * 1.2;
    alpha = max(alpha, rim * .9);
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
// the lid: a quick crack, a slower draw, a breath of overshoot, settle
const lidCurve = (k) => {
  if (k <= 0) return 0;
  if (k < .12) return .25 * ease.out(k / .12);
  if (k < .72) return .25 + .78 * ease.inOut((k - .12) / .6);
  return 1.03 - .03 * ease.out(clamp01((k - .72) / .28));
};
// a seeded random, so a frame at time t is always the same frame
const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

async function loadImage(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error('regard: failed to load ' + src);
  const blob = await res.blob();
  if (self.createImageBitmap) return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try { const img = new Image(); img.src = url; await img.decode(); return img; }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

export async function createRegard(canvas, {base = './art/', reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches} = {}) {
  const gl = canvas.getContext('webgl2', {premultipliedAlpha: true, alpha: true, antialias: false});
  if (!gl) throw new Error('regard: webgl2 unavailable');
  const meta = await fetch(base + 'regard.json').then((r) => r.json());
  const A = meta.macro;
  const imgs = await Promise.all([A.open, A.closed].map((f) => loadImage(base + f)));

  // gold leaf lifting off his face: a 2D layer over the painting
  const leaf = document.createElement('canvas');
  leaf.className = 'cle-splash__leaf';
  canvas.after(leaf);
  const lctx = leaf.getContext('2d');

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
    gl.uniform1i(gl.getUniformLocation(prog, ['uO', 'uC'][unit]), unit);
    return t;
  });
  const U = {};
  for (const n of ['uRes', 'uSize', 'uPupil', 'uSeamAt', 'uCam', 'uEye', 'uAng', 'uExpose', 'uLid', 'uGlow', 'uDil', 'uTime', 'uGrain', 'uSheen', 'uRipple', 'uSeam', 'uAperture', 'uScale']) U[n] = gl.getUniformLocation(prog, n);
  const eye = A.eyes[0], deg = Math.PI / 180;
  const pupil = A.pupil || {x: eye.cx + 5, y: eye.cy - 34};
  gl.uniform2f(U.uSize, A.size[0], A.size[1]);
  gl.uniform4f(U.uEye, eye.cx, eye.cy, eye.w, eye.h);
  gl.uniform1f(U.uAng, eye.angle * deg);
  gl.uniform2f(U.uPupil, pupil.x, pupil.y);

  // ---- the shot (seconds) ----
  // .2–1.4 the painting rises out of the dark · .7–2.6 a raking light crosses the fur
  // .9–1.5 the seam lights · 1.35–2.25 the lid opens (crack, draw, overshoot, settle)
  // 1.5–2.7 the pupil narrows · 2.05 a ripple leaves the eye, gold leaf lifts · 2.7– he holds your gaze
  const T = {emerge: [0.2, 1.4], sheen: [0.7, 2.6], seam: [0.9, 1.5], open: [1.35, 2.25], dil: [1.5, 2.7], ripple: 2.05, hold: 2.7};
  let mode = 'idle', startedAt = 0, exitAt = 0, exitResolve = null, raf = 0, disposed = false, nextBlink = 0, blinkAt = -10;

  // gold leaf: analytic trajectories from a fixed seed (a frame at t is always the same)
  const R = rng(20261018);
  const flakes = Array.from({length: 110}, () => ({
    t0: T.ripple - .1 + R() * .9, a: -Math.PI * (.15 + .7 * R()), sp: 80 + R() * 260, r: 1.2 + R() * 3.2,
    swirl: (R() - .5) * 2.4, spin: 3 + R() * 8, ph: R() * 6.28, life: 1.6 + R() * 2.2, blue: R() < .16, rim: R() * 6.283, rr: .7 + R() * .5,
  }));

  const state = (t) => {
    const s = {expose: 0, lid: 0, glow: 0, dil: 1, sheen: 0, seam: 0, ripple: -1, aperture: 0, t};
    const live = mode !== 'frame' && mode !== 'exit-frame';
    if (mode === 'held') { s.expose = 1; s.lid = 1; s.dil = 0; s.glow = .9 + .1 * Math.sin(t * 1.2); }
    else {
      s.expose = ease.sine(seg(t, ...T.emerge));
      s.sheen = seg(t, ...T.sheen);
      s.seam = ease.out(seg(t, ...T.seam)) * (1 - ease.out(seg(t, T.open[0] + .2, T.open[1])));
      s.lid = lidCurve(seg(t, ...T.open));
      s.dil = 1 - ease.inOut(seg(t, ...T.dil));
      s.ripple = t - T.ripple;
      const flare = Math.exp(-Math.pow((t - T.ripple) / .26, 2));
      s.glow = ease.out(seg(t, T.open[0] + .05, T.open[1] + .3)) * (.8 + .1 * Math.sin(t * 1.2) + .55 * flare);
    }
    if (t >= T.hold || mode === 'held') {
      if (live && t >= nextBlink) { blinkAt = t; nextBlink = t + 5 + Math.random() * 3; }
      const b = t - blinkAt;
      if (b >= 0 && b < .62) s.lid *= b < .15 ? 1 - ease.inOut(b / .15) : ease.out(clamp01((b - .25) / .37));
      // a breath of the pupil while he holds your gaze
      s.dil = Math.max(s.dil, .06 + .05 * Math.sin(t * .9));
    }
    if (mode === 'exit' || mode === 'exit-frame') {
      const e = t - exitAt;
      // the slow blink of trust: close (.5s), the seam glows, then the eye-shaped opening onto the room
      s.lid *= 1 - ease.inOut(seg(e, 0, .5));
      s.seam = Math.max(s.seam, ease.out(seg(e, .3, .6)));
      s.aperture = ease.inOut(seg(e, .55, 1.45));
      s.glow *= 1 + .4 * seg(e, .3, .6);
    }
    return s;
  };

  const cover = (size, W, H) => Math.max(W / size[0], H / size[1]);
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (leaf.width !== w || leaf.height !== h) { leaf.width = w; leaf.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  const drawLeaf = (t, s, toScreen, scale, z) => {
    lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, leaf.width, leaf.height);
    if (s.aperture >= 1) return;
    const fade = 1 - s.aperture;
    const [ex, ey] = toScreen(eye.cx, eye.cy);
    for (const f of flakes) {
      const age = t - f.t0; if (age < 0 || age > f.life) continue;
      const k = age / f.life;
      const d = f.sp * age * scale * (1 - .35 * k);
      // born on a ring around the eye, carried outward and up, turning on the air
      const bx = Math.cos(f.rim) * eye.w * .62 * f.rr, by = Math.sin(f.rim) * eye.h * .75 * f.rr;
      const ang = Math.atan2(by - 40, bx) + f.swirl * age * .35;
      const x = ex + bx * z + Math.cos(ang) * d + Math.sin(age * 2 + f.ph) * 10 * scale;
      const y = ey + by * z + Math.sin(ang) * d - 22 * age * scale + 18 * age * age * scale;
      const a = Math.min(1, age / .15) * (1 - k) * fade;
      const flip = Math.cos(f.ph + age * f.spin), r = f.r * scale * 2.2;
      lctx.save(); lctx.translate(x, y); lctx.rotate(f.ph + age * f.spin * .4); lctx.scale(1, Math.max(.15, Math.abs(flip)));
      lctx.globalAlpha = a;
      if (f.blue) {
        lctx.fillStyle = 'rgba(130,200,255,1)'; lctx.shadowColor = 'rgba(90,168,255,.9)'; lctx.shadowBlur = 8 * scale;
        lctx.beginPath(); lctx.arc(0, 0, r * .45, 0, 6.28); lctx.fill();
      } else {
        const sh = .55 + .45 * flip;
        lctx.fillStyle = `rgb(${Math.round(160 + 95 * sh)},${Math.round(118 + 90 * sh)},${Math.round(44 + 70 * sh)})`;
        lctx.shadowColor = `rgba(255,214,140,${.45 * sh})`; lctx.shadowBlur = 4 * scale;
        lctx.beginPath(); lctx.moveTo(-r * 1.4, -r * .25); lctx.quadraticCurveTo(0, -r * .9, r * 1.5, -r * .1);
        lctx.lineTo(r * 1.1, r * .45); lctx.quadraticCurveTo(-r * .2, r * .7, -r * 1.4, -r * .25); lctx.closePath(); lctx.fill();
      }
      lctx.restore();
    }
  };

  const draw = (t) => {
    resize();
    const s = state(t);
    const W = canvas.width, H = canvas.height;
    // the camera leans in a little while we look, and drifts toward the eye
    const z = cover(A.size, W, H) * lerp(1.0, 1.1, ease.sine(seg(s.t, 0, 4.2)));
    const lean = ease.sine(seg(s.t, 0, 4.2));
    const cam = {x: lerp(A.size[0] / 2, eye.cx, .18 * lean), y: lerp(A.size[1] / 2, eye.cy, .18 * lean)};
    const halfW = W / 2 / z, halfH = H / 2 / z;
    cam.x = Math.min(Math.max(cam.x, halfW), A.size[0] - halfW); cam.y = Math.min(Math.max(cam.y, halfH), A.size[1] - halfH);
    const toScreen = (x, y) => [W * .5 + (x - cam.x) * z, H * .5 + (y - cam.y) * z];
    const [sx, sy] = toScreen(eye.cx, eye.cy);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform3f(U.uCam, cam.x, cam.y, z);
    gl.uniform1f(U.uExpose, s.expose); gl.uniform1f(U.uLid, s.lid); gl.uniform1f(U.uGlow, s.glow);
    gl.uniform1f(U.uDil, s.dil); gl.uniform1f(U.uTime, t); gl.uniform1f(U.uGrain, .018);
    gl.uniform1f(U.uSheen, s.sheen); gl.uniform1f(U.uRipple, s.ripple); gl.uniform1f(U.uSeam, s.seam);
    gl.uniform1f(U.uAperture, s.aperture);
    gl.uniform2f(U.uSeamAt, sx, H - sy);                           // GL frag coords are y-up
    gl.uniform1f(U.uScale, Math.max(.6, eye.w * z / H * 3.2));
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    drawLeaf(t, s, toScreen, z / cover(A.size, W, H) * (W / 1440), z);
    return s;
  };

  const loop = (now) => {
    if (disposed) return;
    const s = draw((now - startedAt) / 1000);
    if (mode === 'exit' && s.aperture >= 1) { mode = 'done'; exitResolve?.(); return; }
    raf = requestAnimationFrame(loop);
  };

  return {
    play() {
      mode = 'play'; startedAt = performance.now(); nextBlink = T.hold + 3.5;
      if (reducedMotion) mode = 'held';
      cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    },
    hold() { mode = 'held'; startedAt = performance.now(); nextBlink = 2.5; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); },
    exit() {
      return new Promise((resolve) => {
        exitResolve = resolve;
        if (reducedMotion) { mode = 'done'; resolve(); return; }
        const t = (performance.now() - startedAt) / 1000;
        // never cut the opening short: leave once the eye has settled and the leaf has lifted
        const at = T.hold + .3;
        if (mode === 'play' && t < at) setTimeout(() => { mode = 'exit'; exitAt = (performance.now() - startedAt) / 1000; }, (at - t) * 1000);
        else { mode = 'exit'; exitAt = t; }
      });
    },
    renderAt(seconds, {exitAfter = null} = {}) {
      mode = exitAfter == null ? 'frame' : 'exit-frame'; exitAt = exitAfter ?? 0; nextBlink = 1e9;
      return draw(seconds);
    },
    dispose() {
      disposed = true; cancelAnimationFrame(raf);
      for (const t of textures) gl.deleteTexture(t);
      gl.deleteBuffer(buf); gl.deleteProgram(prog); leaf.remove();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
