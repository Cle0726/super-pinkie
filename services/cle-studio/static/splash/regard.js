// Le regard — the C.le. opening. One shot on his eye, built like a film shot rather than a slide:
// the painting is split into depths (scripts/art/splash-layers.py) — the gold-and-blue mosaic far behind
// his head, the cat, and a flowering branch close to the lens — so the slow push-in has parallax,
// and focus can travel from the flowers to his eye.
//
//   in the dark   pure black; a seam of ice-blue lights inside his closed lid, a few motes rise from it
//   the light     a cold raking light finds him from the eye outward, stroke by stroke along the
//                 knife marks of the paint (never a fade-up); the branch catches warm light last;
//                 focus pulls from the flowers to the eye
//   the gaze      the lid cracks, draws, overshoots a breath and settles; the dilated pupil narrows to
//                 a slit; light runs over the facets of the iris; a ripple leaves the eye; gold leaf lifts
//   waiting       he breathes; gold leaf drifts at three depths (far, near, past the lens); he blinks
//   leaving       a slow blink of trust; the camera passes through the flowers; the screen opens in the
//                 shape of his eye onto the room while the gold leaf rushes past the lens
//
//   const r = await createRegard(canvas, {base: './art/'});
//   r.play();  r.hold();  await r.exit();  r.renderAt(seconds, {exitAfter});  r.dispose();

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uO, uC, uF, uM;              // cat plate open / closed, branch (premultiplied), far mask
uniform vec2 uRes, uSize, uPupil, uSeamAt, uFgOff;
uniform vec3 uCam, uZl, uBlur;                 // centre + zoom · per-depth zoom (far, cat, branch) · per-depth defocus
uniform float uLU[32], uLL[32], uLC[32];      // the blink: top / bottom of the open eye and the meeting crease, per column
uniform vec2 uLX;                              // the columns those samples span (image px)
uniform vec4 uEye, uSL;                        // eye ellipse · the painted crease of the closed lid (cx, cy, half length, angle)
uniform float uAng, uKey, uReveal, uFgLight, uLid, uGlow, uDil, uTime, uGrain, uSheen, uRipple, uSeam, uAperture, uScale, uStroke;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * noise(p); p *= 2.03; a *= .5; } return s; }
vec2 rot(vec2 d, float a){ float c = cos(a), s = sin(a); return vec2(c*d.x - s*d.y, s*d.x + c*d.y); }

// the parting lid. It opens where the seam burned — on the painted crease of the closed lid — and
// turns into the open eye's own almond as it widens, so the light and the opening are one line
float lid(vec2 p, float ap){
  float k = smoothstep(0., .75, ap);
  vec2 c = mix(uSL.xy, uEye.xy, k);
  float a = mix(uSL.w, uAng, k);
  vec2 ext = mix(vec2(uSL.z, uSL.z * .6), uEye.zw * vec2(.60, .80), k);
  vec2 q = rot(p - c, -a) / ext;
  float half_ = ap * pow(clamp(1. - q.x*q.x, 0., 1.), .55);
  float e = .02 + .10 * (1. - ap);
  // a shut lid lets nothing through (the soft edge alone would leak half the iris along its axis)
  return (1. - smoothstep(half_ - e, half_ + e, abs(q.y))) * step(abs(q.x), 1.06) * smoothstep(0., .06, ap);
}
float region(vec2 p){ vec2 q = rot(p - uEye.xy, -uAng) / (uEye.zw * vec2(.95, 1.7)); return 1. - smoothstep(.8, 1.15, length(q)); }
float seamLine(vec2 p){
  vec2 q = rot(p - uEye.xy, -uAng) / (uEye.zw * vec2(.60, .80));
  return (1. - smoothstep(.85, 1.05, abs(q.x))) * exp(-pow(q.y / .045, 2.));
}
vec2 layer(vec2 frag, float zl){ return uCam.xy + (frag - uRes * .5) / (uCam.z * zl) * vec2(1., -1.); }
// the light reaches a point along the knife strokes: an anisotropic noise stretched along the fur
float front(vec2 p, float delay){
  vec2 q = rot(p - uEye.xy, uStroke);
  float n = fbm(q * vec2(.0032, .024)) + .35 * fbm(q * vec2(.011, .07));
  return uReveal - delay - length(p - uEye.xy) + (n - .62) * 900.;
}

void main(){
  vec2 frag = vUv * uRes;
  float lod0 = max(0., log2(1. / max(uCam.z, 1e-4)));
  vec2 p = layer(frag, uZl.y);

  if (uRipple > 0. && uRipple < 1.6) {
    vec2 d = p - uEye.xy; float r = length(d);
    float fr = uRipple * 1400.;
    float w = exp(-pow((r - fr) / 90., 2.)) * (1. - uRipple / 1.6);
    p += normalize(d + 1e-3) * sin((r - fr) * .05) * 7. * w;
  }
  vec2 uv = clamp(p / uSize, vec2(0.), vec2(1.));
  float lod = lod0 + uBlur.y;

  // ---- the cat (focus plane) ----
  vec3 closed = textureLod(uC, uv, lod).rgb;
  float rg = region(p);

  // the blink, as layers: the fur of the upper and lower lid is lifted off the open painting and
  // slides over the eyeball until the two edges meet on the painted crease. The lid fur stretches
  // as it travels (it is skin, not a shutter), the lid casts a shadow on the eye beneath it and its
  // wet rim catches a line of light. Only the very end hands over to the closed painting.
  float k = clamp(1. - uLid, -.06, 1.);
  float fi = clamp((p.x - uLX.x) / (uLX.y - uLX.x), 0., 1.) * 31.;
  int i0 = int(floor(fi)); int i1 = min(i0 + 1, 31); float fr = fi - float(i0);
  float U = mix(uLU[i0], uLU[i1], fr), Lb = mix(uLL[i0], uLL[i1], fr), Cm = mix(uLC[i0], uLC[i1], fr);
  float inX = smoothstep(uLX.x - 40., uLX.x + 6., p.x) * (1. - smoothstep(uLX.y - 6., uLX.y + 40., p.x));
  float Eu = mix(U, Cm, k), El = mix(Lb, Cm, k);
  float Tt = U - 170., Bb = Lb + 110.;
  vec2 q = p;
  if (p.y > Tt && p.y < Eu) q.y = Tt + (p.y - Tt) * (U - Tt) / max(Eu - Tt, 1.);
  else if (p.y > El && p.y < Bb) q.y = Bb - (Bb - p.y) * (Bb - Lb) / max(Bb - El, 1.);
  q = mix(p, q, inX);
  float ball = smoothstep(Eu - 1.2, Eu + 1.2, p.y) * (1. - smoothstep(El - 1.2, El + 1.2, p.y)) * inX;
  // the pupil: dilated in the dark, it narrows to a slit as the light reaches it
  vec2 dp = p - uPupil;
  float near = exp(-dot(dp / vec2(70., 120.), dp / vec2(70., 120.)) * 1.6) * rg;
  vec2 po = uPupil + dp / vec2(1. + uDil * 2.2 * near, 1. + uDil * .12 * near);
  vec3 open = textureLod(uO, clamp(mix(q, po, ball) / uSize, vec2(0.), vec2(1.)), lod).rgb;
  float over = max(k, 0.);
  float shade = (exp(-max(p.y - Eu, 0.) / (14. + 26. * (1. - over))) * .62 + exp(-max(El - p.y, 0.) / 12.) * .3) * ball * smoothstep(.0, .12, over);
  open *= 1. - shade;
  // the lid margin: a dark line of skin, and only a faint wet glint on the eye just under it
  float moving = smoothstep(.04, .25, over) * (1. - smoothstep(.8, .95, over));
  float rimU = exp(-pow((p.y - Eu + 1.5) / 3.2, 2.)), rimL = exp(-pow((p.y - El - 1.) / 2.6, 2.));
  open *= 1. - (rimU * .7 + rimL * .45) * moving * inX;
  open += vec3(.45, .7, 1.) * exp(-pow((p.y - Eu - 4.) / 2.4, 2.)) * ball * moving * .09;
  float hand = smoothstep(.8, 1., k) * smoothstep(0., 1., rg + inX);
  vec3 cat = mix(open, closed, hand);
  float m = ball * (1. - hand);
  float lm = m;
  // the light finds him stroke by stroke; at its front only the paint ridges catch a cold glint
  float fc = front(p, 0.);
  float lit = smoothstep(0., 340., fc);
  vec3 soft = textureLod(uO, uv, lod + 3.).rgb;
  float ridge = max(0., dot(cat - soft, vec3(.4, .4, .2))) * 3.2;
  float edgeLight = exp(-pow((fc - 120.) / 170., 2.));
  vec3 col = cat * lit * uKey + vec3(.55, .78, 1.) * ridge * edgeLight * .9 * step(.001, uReveal);

  // ---- far: the mosaic behind his head, a little softer and slower ----
  vec2 pf = layer(frag, uZl.x);
  vec2 uvf = clamp(pf / uSize, vec2(0.), vec2(1.));
  float mf = textureLod(uM, uvf, 1.).r;
  vec3 far = textureLod(uO, uvf, lod0 + uBlur.x).rgb * smoothstep(0., 900., front(pf, 900.)) * uKey * .78;
  col = mix(col, far, mf);

  // ---- the iris, the lid edge, the seam ----
  float iris = clamp((open.b - open.r) * 2.4 - .15, 0., 1.) * m;
  float facets = pow(fbm(p * .022 + vec2(uTime * .35, -uTime * .22)), 3.) * 2.2 + pow(noise(p * .09 + uTime * 1.3), 8.) * 1.6;
  vec3 irisCol = open * (1. + .30 * uGlow) + vec3(.25, .62, 1.) * facets * uGlow * .55;
  col = mix(col, irisCol * max(uKey, .6), iris);
  vec3 nearBlue = textureLod(uO, uv, 3.5).rgb;
  float onEye = clamp((nearBlue.b - nearBlue.r) * 3. - .1, 0., 1.);
  float edge = 0.;                          // the lid's wet rim is drawn with the lids above
  col += vec3(.55, .82, 1.) * edge * .55 * uGlow;
  // the seam: a hot filament along his painted crease — white-hot core, ice-blue falloff, brightest
  // at the middle of the lid and tapering to nothing at the corners, with light flowing along it
  vec2 ql = rot(p - uSL.xy, -uSL.w);
  float along = ql.x / uSL.z;
  float taper = pow(clamp(1. - along * along, 0., 1.), 1.3);
  float band = exp(-pow(ql.y / 38., 2.));
  float crease = smoothstep(.015, .22, closed.b - closed.r) * band;
  vec3 cs = textureLod(uC, uv, lod + 2.5).rgb;
  float creaseSoft = smoothstep(.0, .16, cs.b - cs.r) * exp(-pow(ql.y / 120., 2.));
  float flow = .7 + .3 * noise(vec2(along * 5. - uTime * 1.6, 7.)) * (.8 + .2 * noise(vec2(uTime * 11., 1.)));
  float seam = crease * taper * uSeam * (1. - m) * flow;
  col += vec3(.16, .5, 1.) * seam * 1.5 + vec3(.85, .95, 1.) * pow(seam, 3.) * 1.6;
  col += vec3(.06, .3, 1.) * creaseSoft * taper * uSeam * (1. - uLid) * flow * .55;
  float sb = exp(-pow(length((p - uEye.xy) / (uEye.zw * vec2(1.1, 1.5))), 1.6) * 1.4) * uSeam * (1. - uLid);
  col += vec3(.05, .22, .8) * sb * .22;

  // gold in the fur under a low raking light, after the cold light has arrived
  float bandS = exp(-pow((dot(p - uEye.xy, normalize(vec2(1., .55))) - mix(-1500., 1900., uSheen)) / 260., 2.));
  col += vec3(1., .78, .42) * ridge * bandS * .8 * uKey * step(.001, uSheen) * step(uSheen, .999);

  vec3 b1 = textureLod(uO, uv, 4.5).rgb, b2 = textureLod(uO, uv, 6.5).rgb;
  float g = (clamp((b1.b - b1.r) * 2. - .1, 0., 1.) * .65 + clamp((b2.b - b2.r) * 2. - .1, 0., 1.) * .55) * rg * uLid;
  col += vec3(.06, .48, 1.) * g * uGlow * .32 + vec3(.5, .86, 1.) * g * g * uGlow * .12;

  // ---- the branch near the lens: occludes as a silhouette until the warm light reaches it ----
  vec2 pb = layer(frag, uZl.z) + uFgOff;
  vec4 fb = textureLod(uF, clamp(pb / uSize, vec2(0.), vec2(1.)), lod0 + uBlur.z);
  float warm = uFgLight * smoothstep(-200., 500., front(pb, 700.));
  col = col * (1. - fb.a) + fb.rgb * vec3(1.04, .97, .88) * warm;

  // ---- the lens ----
  vec2 sv = vUv - .5; sv.x *= uRes.x / uRes.y;
  col *= mix(.38, 1., smoothstep(1.05, .2, length(sv)));
  col += (hash(frag + fract(uTime) * 91.7) - .5) * uGrain;
  col = max(col, 0.);

  float alpha = 1.;
  if (uAperture > 0.) {
    vec2 d = rot(frag - uSeamAt, uSL.w) / uRes.y;           // the room opens along the crease
    float k = uAperture * uAperture;
    vec2 R = vec2(mix(.18, 3.2, k), mix(.0, 2.4, k)) * uScale;
    vec2 q = d / max(R, vec2(1e-4));
    float shape = pow(clamp(1. - q.x * q.x, 0., 1.), .55);
    float brush = (fbm(d * 24. + uTime * .3) - .5) * .08;
    float inside = (1. - smoothstep(-.03, .03, abs(q.y) - shape + brush)) * step(abs(q.x), 1.);
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
  sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  in: (t) => t * t * t,
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const lidCurve = (k) => {
  if (k <= 0) return 0;
  if (k < .12) return .25 * ease.out(k / .12);
  if (k < .72) return .25 + .78 * ease.inOut((k - .12) / .6);
  return 1.03 - .03 * ease.out(clamp01((k - .72) / .28));
};
const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

async function loadImage(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error('regard: failed to load ' + src);
  const blob = await res.blob();
  if (self.createImageBitmap) return createImageBitmap(blob, {premultiplyAlpha: 'premultiply'});
  const url = URL.createObjectURL(blob);
  try { const img = new Image(); img.src = url; await img.decode(); return img; }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

// ---- the shot (seconds) ----
const T = {
  seam: [.45, 1.25],            // the seam ignites in the dark
  reveal: [1.0, 2.9],           // the cold light travels out from the eye along the strokes
  key: [1.05, 2.7],             // the exposure it leaves behind
  focus: [1.3, 2.5],            // focus pulls from the branch to the eye
  warm: [1.7, 2.9],             // the branch catches warm light
  sheen: [2.4, 3.9],
  open: [2.35, 3.2], dil: [2.5, 3.6], ripple: 3.0, hold: 3.6,
};

export async function createRegard(canvas, {base = './art/', reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches} = {}) {
  const gl = canvas.getContext('webgl2', {premultipliedAlpha: true, alpha: true, antialias: false});
  if (!gl) throw new Error('regard: webgl2 unavailable');
  const meta = await fetch(base + 'regard.json?v=20261019').then((r) => r.json());
  const A = meta.macro;
  const L = meta.layers || {open: 'splash-l-open.webp', closed: 'splash-l-closed.webp', fg: 'splash-l-fg.webp', mask: 'splash-l-mask.webp'};
  const imgs = await Promise.all([L.open, L.closed, L.fg, L.mask].map((f) => loadImage(base + f + '?v=20261019')));

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
  // premultiplied on upload, so the branch's defocus (mip blur) never drags a dark fringe in
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
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
    gl.uniform1i(gl.getUniformLocation(prog, ['uO', 'uC', 'uF', 'uM'][unit]), unit);
    return t;
  });
  const U = {};
  for (const n of ['uRes', 'uSize', 'uPupil', 'uSeamAt', 'uFgOff', 'uCam', 'uZl', 'uBlur', 'uEye', 'uAng', 'uKey', 'uReveal', 'uFgLight', 'uLid', 'uGlow', 'uDil', 'uTime', 'uGrain', 'uSheen', 'uRipple', 'uSeam', 'uAperture', 'uScale', 'uStroke', 'uSL', 'uLX']) U[n] = gl.getUniformLocation(prog, n);
  const eye = A.eyes[0], deg = Math.PI / 180;
  const pupil = A.pupil || {x: eye.cx + 5, y: eye.cy - 34};
  gl.uniform2f(U.uSize, A.size[0], A.size[1]);
  gl.uniform4f(U.uEye, eye.cx, eye.cy, eye.w, eye.h);
  gl.uniform1f(U.uAng, eye.angle * deg);
  gl.uniform2f(U.uPupil, pupil.x, pupil.y);
  gl.uniform1f(U.uStroke, -28 * deg);
  // measured on splash-macro-closed: the crease runs (1630,505) → (1990,665)
  const sl = A.seam || {x: 1810, y: 585, half: 200, angle: 24};
  gl.uniform4f(U.uSL, sl.x, sl.y, sl.half, sl.angle * deg);
  // measured by scripts/art/eye-geometry.py
  const lids = A.lids;
  gl.uniform2f(U.uLX, lids.x[0], lids.x[1]);
  gl.uniform1fv(gl.getUniformLocation(prog, 'uLU'), new Float32Array(lids.U));
  gl.uniform1fv(gl.getUniformLocation(prog, 'uLL'), new Float32Array(lids.L));
  gl.uniform1fv(gl.getUniformLocation(prog, 'uLC'), new Float32Array(lids.C));           // the knife strokes of his fur run down and back from the eye

  let mode = 'idle', startedAt = 0, exitAt = 0, exitResolve = null, raf = 0, disposed = false, nextBlink = 0, blinkAt = -10;

  // ---- gold leaf, all analytic from fixed seeds (a frame at time t is always the same frame) ----
  const R = rng(20261018);
  // gold leaf is torn foil: every flake gets its own ragged outline (6–8 points, uneven radii)
  const foil = () => { const n = 6 + Math.floor(R() * 3), pts = [];
    for (let i = 0; i < n; i++) { const a = (i + R() * .6) / n * 6.283, r = .45 + R() * .75; pts.push([Math.cos(a) * r * 1.35, Math.sin(a) * r * .8]); }
    return pts; };
  const flake = () => ({a: -Math.PI * (.15 + .7 * R()), sp: 80 + R() * 260, r: 1.2 + R() * 3.2, swirl: (R() - .5) * 2.4,
    spin: 3 + R() * 8, ph: R() * 6.28, life: 1.6 + R() * 2.2, blue: R() < .16, rim: R() * 6.283, rr: .7 + R() * .5, shape: foil()});
  const lift = Array.from({length: 44}, () => { const f = flake(); f.r = .7 + Math.pow(R(), 2.2) * 4; return {t0: T.ripple - .1 + R() * .9, ...f}; });
  // motes of ice-blue that leave the seam while it burns in the dark
  const motes = Array.from({length: 16}, () => ({t0: T.seam[0] + .15 + R() * .9, u: R() * 2 - 1, vy: 18 + R() * 30, life: 1 + R() * 1.1, r: .6 + R() * 1.1, ph: R() * 6.28}));
  // drifting leaf at three depths: far (small, dim), near (sharp), past the lens (large, out of focus)
  const DEPTH = [{n: 18, s: .4, a: .55, blur: 0, sp: .55}, {n: 9, s: .85, a: .85, blur: 0, sp: 1}, {n: 3, s: 5.5, a: .16, blur: 1, sp: 2.1}];
  const drift = DEPTH.flatMap((d) => Array.from({length: d.n}, () => ({...d, x: R(), P: 7 + R() * 6, ph: R(), sway: .02 + R() * .05, r: 1.3 + R() * 2.4, spin: 2 + R() * 5, rot: R() * 6.28, blue: R() < .1, shape: foil()})));
  // leaving: leaf thrown past the lens from his eye
  const rush = Array.from({length: 54}, () => ({a: R() * 6.283, sp: .6 + R() * 1.6, r: 1.4 + R() * 2.6, d0: .02 + R() * .12, ph: R() * 6.28, spin: 4 + R() * 7, blue: R() < .2, shape: foil()}));

  const state = (t) => {
    const s = {key: 0, reveal: 0, seam: 0, lid: 0, glow: 0, dil: 1, sheen: 0, ripple: -1, aperture: 0, fgLight: 0, focus: 0, push: 0, pass: 0, breath: 0, exitE: null, t};
    const live = mode !== 'frame' && mode !== 'exit-frame';
    s.push = ease.sine(seg(t, 0, 7));
    if (mode === 'held') {
      Object.assign(s, {key: 1, reveal: 1e5, lid: 1, dil: 0, fgLight: 1, focus: 1, push: .6, glow: .9 + .1 * Math.sin(t * 1.2)});
    } else {
      s.seam = ease.out(seg(t, ...T.seam)) * (1 - ease.out(seg(t, T.open[0] + .15, T.open[1])));
      s.reveal = ease.inOut(seg(t, ...T.reveal)) * 4200;
      s.key = ease.sine(seg(t, ...T.key));
      s.focus = ease.inOut(seg(t, ...T.focus));
      s.fgLight = ease.sine(seg(t, ...T.warm));
      s.sheen = seg(t, ...T.sheen);
      s.lid = lidCurve(seg(t, ...T.open));
      s.dil = 1 - ease.inOut(seg(t, ...T.dil));
      s.ripple = t - T.ripple;
      const flare = Math.exp(-Math.pow((t - T.ripple) / .26, 2));
      s.glow = ease.out(seg(t, T.open[0] + .05, T.open[1] + .3)) * (.8 + .1 * Math.sin(t * 1.2) + .55 * flare);
    }
    if (t >= T.hold || mode === 'held') {
      if (live && t >= nextBlink) { blinkAt = t; nextBlink = t + 5 + Math.random() * 3; }
      const b = t - blinkAt;
      if (b >= 0 && b < .78) s.lid *= b < .2 ? 1 - ease.in(b / .2) * .98 - .02 * seg(b, .15, .2) : b < .3 ? 0 : ease.out(clamp01((b - .3) / .48));
      s.dil = Math.max(s.dil, .06 + .05 * Math.sin(t * .9));
    }
    s.breath = Math.sin(t * 1.25) * .0035 * seg(t, 2.6, 3.6);
    if (mode === 'exit' || mode === 'exit-frame') {
      const e = t - exitAt;
      s.lid *= 1 - ease.inOut(seg(e, 0, .5));
      s.seam = Math.max(s.seam, ease.out(seg(e, .3, .6)));
      s.aperture = ease.inOut(seg(e, .55, 1.45));
      s.glow *= 1 + .4 * seg(e, .3, .6);
      s.pass = ease.in(seg(e, .2, 1.3));          // the camera moves through the branch
      s.exitE = e;
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

  // one flake of gold leaf (or a blue spark), turning in the light; `blur` draws it past the lens
  const paintFlake = (x, y, r, rot, flip, a, blue, blur, shape) => {
    if (a <= .003) return;
    lctx.save(); lctx.translate(x, y); lctx.globalAlpha = Math.min(1, a);
    if (blur) {
      // out of focus: a soft disc of light with a brighter rim, as a real lens draws it — added as
      // light, so over the dark fur it glows instead of greying it
      lctx.globalCompositeOperation = 'lighter';
      const g = lctx.createRadialGradient(0, 0, 0, 0, 0, r);
      const c = blue ? '130,196,255' : '255,214,150';
      g.addColorStop(0, `rgba(${c},.16)`); g.addColorStop(.7, `rgba(${c},.2)`); g.addColorStop(.9, `rgba(${c},.26)`); g.addColorStop(1, `rgba(${c},0)`);
      lctx.fillStyle = g; lctx.beginPath(); lctx.arc(0, 0, r, 0, 6.28); lctx.fill();
    } else {
      lctx.rotate(rot); lctx.scale(1, Math.max(.15, Math.abs(flip)));
      if (blue) {
        lctx.fillStyle = 'rgba(130,200,255,1)'; lctx.shadowColor = 'rgba(90,168,255,.9)'; lctx.shadowBlur = r * 3;
        lctx.beginPath(); lctx.arc(0, 0, r * .45, 0, 6.28); lctx.fill();
      } else {
        const sh = Math.pow(Math.abs(flip), 6);          // it catches the light only when it faces you
        lctx.fillStyle = `rgb(${Math.round(112 + 140 * sh)},${Math.round(80 + 140 * sh)},${Math.round(36 + 130 * sh)})`;
        lctx.shadowColor = `rgba(255,226,170,${.7 * sh})`; lctx.shadowBlur = r * (1 + 3 * sh);
        lctx.beginPath();
        if (shape) { shape.forEach(([px, py], i) => (i ? lctx.lineTo(px * r, py * r) : lctx.moveTo(px * r, py * r))); }
        else { lctx.moveTo(-r * 1.4, -r * .25); lctx.quadraticCurveTo(0, -r * .9, r * 1.5, -r * .1); lctx.lineTo(r * 1.1, r * .45); lctx.quadraticCurveTo(-r * .2, r * .7, -r * 1.4, -r * .25); }
        lctx.closePath(); lctx.fill();
      }
    }
    lctx.restore();
  };

  const drawLeaf = (t, s, toScreen, sc, z) => {
    lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, leaf.width, leaf.height);
    if (s.aperture >= 1) return;
    const W = leaf.width, H = leaf.height, fade = 1 - seg(s.aperture, .08, .42);   // never litter the room
    const [ex, ey] = toScreen(eye.cx, eye.cy);
    const ang = eye.angle * deg;
    // motes leaving the seam, in the dark
    for (const m of motes) {
      const age = t - m.t0; if (age < 0 || age > m.life) continue;
      const k = age / m.life;
      const ux = m.u * eye.w * .55 * z, x = ex + ux * Math.cos(ang) + Math.sin(age * 3 + m.ph) * 6 * sc;
      const y = ey + ux * Math.sin(ang) - m.vy * age * sc * 1.6;
      paintFlake(x, y, m.r * sc * 2, 0, 1, Math.min(1, age / .2) * (1 - k) * .9 * fade, true, 0);
    }
    // the lift as the eye opens
    for (const f of lift) {
      const age = t - f.t0; if (age < 0 || age > f.life) continue;
      const k = age / f.life, d = f.sp * age * sc * (1 - .35 * k);
      const bx = Math.cos(f.rim) * eye.w * .62 * f.rr, by = Math.sin(f.rim) * eye.h * .75 * f.rr;
      const a = Math.atan2(by - 40, bx) + f.swirl * age * .35;
      const x = ex + bx * z + Math.cos(a) * d + Math.sin(age * 2 + f.ph) * 10 * sc;
      const y = ey + by * z + Math.sin(a) * d - 22 * age * sc + 18 * age * age * sc;
      paintFlake(x, y, f.r * sc * 2.2, f.ph + age * f.spin * .4, Math.cos(f.ph + age * f.spin), Math.min(1, age / .15) * (1 - k) * fade, f.blue, 0, f.shape);
    }
    // the slow drift while he waits, at three depths, with parallax against the push
    const on = seg(t, 2.6, 3.8) * fade;
    if (on > 0) for (const p of drift) {
      const u = ((t / p.P + p.ph) % 1 + 1) % 1;
      const env = Math.sin(Math.PI * u);
      const x = (p.x + (u - .5) * .22 * p.sp + Math.sin(t * .6 + p.rot) * p.sway) * W - (s.push - .5) * 40 * p.sp * sc;
      const y = H * (1.08 - u * 1.2);
      paintFlake(x, y, p.r * sc * 2 * p.s, p.rot + t * p.spin * .3, Math.cos(p.rot + t * p.spin), p.a * env * on, p.blue, p.blur, p.shape);
    }
    // leaving: the leaf rushes past the lens from his eye
    if (s.exitE != null && s.exitE > .45) {
      const e = s.exitE - .45;
      for (const f of rush) {
        const d = f.d0 + Math.pow(e * f.sp, 2.2);                 // perspective: slow, then past you
        const x = ex + Math.cos(f.a) * d * W * .9, y = ey + Math.sin(f.a) * d * W * .6;
        paintFlake(x, y, f.r * sc * (1.5 + d * 22), f.ph + e * f.spin, Math.cos(f.ph + e * f.spin), Math.min(1, e / .12) * (1 - seg(d, .45, .9)) * (d > .28 ? .55 : 1), f.blue, d > .28 ? 1 : 0, f.shape);
      }
    }
  };

  const draw = (t) => {
    resize();
    const s = state(t);
    const W = canvas.width, H = canvas.height;
    const z = cover(A.size, W, H) * lerp(1.0, 1.1, s.push);
    const cam = {x: lerp(A.size[0] / 2, eye.cx, .18 * s.push), y: lerp(A.size[1] / 2, eye.cy, .18 * s.push)};
    const halfW = W / 2 / z, halfH = H / 2 / z;
    cam.x = Math.min(Math.max(cam.x, halfW), A.size[0] - halfW); cam.y = Math.min(Math.max(cam.y, halfH), A.size[1] - halfH);
    const toScreen = (x, y) => [W * .5 + (x - cam.x) * z, H * .5 + (y - cam.y) * z];
    const [sx, sy] = toScreen(sl.x, sl.y);
    // depth: the far mosaic lags the push, the branch overtakes it (and, leaving, passes the lens)
    const k = s.push, sway = seg(t, 2.6, 3.6);
    const zl = [1 - .035 * k, 1 + s.breath, 1 + .07 * k + 1.6 * s.pass * s.pass];
    const fgOff = [Math.sin(t * .7) * 6 * sway, Math.cos(t * .55) * 4 * sway];
    // defocus (mip levels): branch sharp → soft as focus travels to the eye; cat soft → sharp
    const blur = [lerp(1.8, 2.3, s.focus), lerp(2.6, 0, s.focus), lerp(.4, 3.6, s.focus) + 2.5 * s.pass];
    gl.uniform2f(U.uRes, W, H);
    gl.uniform3f(U.uCam, cam.x, cam.y, z);
    gl.uniform3f(U.uZl, zl[0], zl[1], zl[2]);
    gl.uniform3f(U.uBlur, blur[0], blur[1], blur[2]);
    gl.uniform2f(U.uFgOff, fgOff[0], fgOff[1]);
    gl.uniform1f(U.uKey, s.key); gl.uniform1f(U.uReveal, s.reveal); gl.uniform1f(U.uFgLight, s.fgLight * (1 - s.pass));
    gl.uniform1f(U.uLid, s.lid); gl.uniform1f(U.uGlow, s.glow);
    gl.uniform1f(U.uDil, s.dil); gl.uniform1f(U.uTime, t); gl.uniform1f(U.uGrain, .022);
    gl.uniform1f(U.uSheen, s.sheen); gl.uniform1f(U.uRipple, s.ripple); gl.uniform1f(U.uSeam, s.seam);
    gl.uniform1f(U.uAperture, s.aperture);
    gl.uniform2f(U.uSeamAt, sx, H - sy);
    gl.uniform1f(U.uScale, Math.max(.6, eye.w * z / H * 3.2));
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    drawLeaf(t, s, toScreen, W / 1440, z);
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
    renderAt(seconds, {exitAfter = null, blink = null} = {}) {
      mode = exitAfter == null ? 'frame' : 'exit-frame'; exitAt = exitAfter ?? 0; nextBlink = 1e9;
      if (blink != null) blinkAt = blink;
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
