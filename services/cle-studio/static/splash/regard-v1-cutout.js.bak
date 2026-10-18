// Le regard — the C.le. opening. A still oil portrait in the dark; only the eyes live.
// Standalone ES module (no dependencies) so the Launcher's local page and the web app share it.
//
//   const r = await createRegard(canvas, {base: './art/'});
//   r.play();            // emerge + open eyes, then hold (breathing glow, slow blinks)
//   r.hold();            // jump straight into the held gaze (handoff from the Launcher)
//   await r.exit();      // slow blink, then the dark opens from between the eyes
//   r.dispose();
//   r.renderAt(seconds)  // deterministic frame for review tools

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uOpen, uClosed, uGlow;
uniform vec2 uRes;          // canvas px
uniform vec2 uImg;          // image px
uniform vec2 uCenter;       // image px shown at screen centre
uniform float uZoom;        // screen px per image px
uniform vec4 uEyeA, uEyeB;  // cx, cy, w, h (image px)
uniform vec2 uAng;          // eye tilt (radians)
uniform float uExpose, uLid, uGlowAmt, uRim, uReveal, uTime, uGrain;
uniform vec2 uRevealAt;     // screen px

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * noise(p); p *= 2.03; a *= .5; } return s; }

// 1 inside the parted lids, 0 on the closed lid. aperture 0 = shut, 1 = open.
float lid(vec2 p, vec4 eye, float ang, float aperture){
  vec2 d = p - eye.xy; float c = cos(-ang), s = sin(-ang);
  d = vec2(c*d.x - s*d.y, s*d.x + c*d.y);
  vec2 q = d / (vec2(eye.z, eye.w) * vec2(.62, .78));
  float across = clamp(1. - q.x*q.x, 0., 1.);
  float half_ = aperture * pow(across, .55);
  float edge = .025 + .09 * (1. - aperture);
  return (1. - smoothstep(half_ - edge, half_ + edge, abs(q.y))) * step(abs(q.x), 1.08);
}
float region(vec2 p, vec4 eye, float ang){
  vec2 d = p - eye.xy; float c = cos(-ang), s = sin(-ang);
  d = vec2(c*d.x - s*d.y, s*d.x + c*d.y);
  vec2 q = d / (vec2(eye.z, eye.w) * vec2(.95, 1.6));
  return 1. - smoothstep(.85, 1.15, length(q));
}

void main(){
  vec2 frag = vUv * uRes;
  vec2 p = uCenter + (frag - uRes * .5) / uZoom * vec2(1., -1.);   // image px, y down
  vec2 uv = p / uImg;
  bool inside = all(greaterThanEqual(uv, vec2(0.))) && all(lessThanEqual(uv, vec2(1.)));

  // ink background with a faint canvas tooth and vignette
  vec2 sv = vUv - .5; sv.x *= uRes.x / uRes.y;
  float vig = smoothstep(1.15, .25, length(sv));
  float tooth = fbm(frag * .012) * .5 + fbm(frag * .09) * .5;
  vec3 col = vec3(.027, .031, .043) * (.65 + .35 * vig) + (tooth - .5) * .012;

  if (inside) {
    vec4 o = texture(uOpen, uv), cl = texture(uClosed, uv);
    float la = lid(p, uEyeA, uAng.x, uLid), lb = lid(p, uEyeB, uAng.y, uLid);
    float rg = max(region(p, uEyeA, uAng.x), region(p, uEyeB, uAng.y));
    float open = max(la, lb);
    vec4 face = mix(cl, mix(cl, o, open), rg);
    face = mix(o, face, rg);           // outside the eye regions both paintings agree; use open
    float a = face.a;
    vec3 paint = face.rgb;

    // light from above-left: the coat emerges from the dark
    float top = clamp(1.1 - uv.y * 1.05 + (uv.x - .5) * -.15, 0., 1.);
    vec3 lit = paint * uExpose * (.55 + .65 * top);

    // rim light on edges that face the light
    vec2 lightDir = normalize(vec2(-.35, -1.));
    vec2 tap = lightDir * 10. / uImg;
    float ahead = texture(uOpen, uv + tap).a;
    float rim = clamp(a - ahead, 0., 1.) * uRim * (.4 + .6 * top);
    lit += vec3(.55, .70, .92) * rim * .55;

    // the eyes are emitters: they ignore the exposure
    float eyeLight = open * rg;
    vec3 iris = o.rgb * eyeLight;
    float bluish = clamp((o.b - o.r) * 2.2, 0., 1.) * eyeLight;
    lit = mix(lit, iris * (1.05 + .25 * uGlowAmt), bluish);

    col = mix(col, lit, a);
    float g = texture(uGlow, uv).r * uGlowAmt * (.82 + .18 * uLid);
    col += vec3(.08, .50, 1.) * g * .22 + vec3(.55, .88, 1.) * g * g * .06;
  }

  // film-like grain keeps the paint alive at any scale
  col += (hash(frag + fract(uTime) * 91.7) - .5) * uGrain;

  // exit: the dark opens outward from between the eyes, along a brushy edge
  float alpha = 1.;
  if (uReveal > 0.) {
    vec2 d = frag - uRevealAt; float r = length(d) / length(uRes);
    vec2 dir = d / max(length(d), 1e-3);
    float fade = smoothstep(.0, .06, r);
    // dry-brush: bristle streaks pushed outward, broken by canvas tooth (seamless: no angle wrap)
    float bristle = fbm(dir * 46. + r * 2.2) * .10 + fbm(dir * 5. + r * 1.1 + 7.) * .035;
    float brush = (bristle + (noise(frag * .06) - .5) * .025) * fade;
    float edge = uReveal * .72 - .10;
    alpha = smoothstep(edge - .012, edge + .012, r + brush);
  }
  outColor = vec4(col * alpha, alpha);
}`;

const ease = {
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  expo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));

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
  const [meta, open, closed, glow] = await Promise.all([
    fetch(base + 'head.json').then((r) => r.json()),
    loadImage(base + 'head-open.webp'), loadImage(base + 'head-closed.webp'), loadImage(base + 'head-glow.png'),
  ]);

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

  const tex = (img, unit, name) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    return t;
  };
  const textures = [tex(open, 0, 'uOpen'), tex(closed, 1, 'uClosed'), tex(glow, 2, 'uGlow')];
  const U = {};
  for (const n of ['uRes', 'uImg', 'uCenter', 'uZoom', 'uEyeA', 'uEyeB', 'uAng', 'uExpose', 'uLid', 'uGlowAmt', 'uRim', 'uReveal', 'uTime', 'uGrain', 'uRevealAt']) U[n] = gl.getUniformLocation(prog, n);
  const [ea, eb] = meta.eyes;
  const deg = Math.PI / 180;
  gl.uniform2f(U.uImg, meta.size[0], meta.size[1]);
  gl.uniform4f(U.uEyeA, ea.cx, ea.cy, ea.w, ea.h);
  gl.uniform4f(U.uEyeB, eb.cx, eb.cy, eb.w, eb.h);
  gl.uniform2f(U.uAng, ea.angle * deg, eb.angle * deg);
  const eyeMid = {x: (ea.cx + eb.cx) / 2, y: (ea.cy + eb.cy) / 2};

  // ---- the performance -------------------------------------------------
  // Camera: begins close on the eyes, settles on the head. Times in seconds.
  const T = {emerge: [0.25, 1.35], open: [1.25, 2.05], settle: [0.0, 2.9], hold: 2.9};
  let mode = 'idle', startedAt = 0, holdFrom = T.hold, exitAt = 0, exitResolve = null, raf = 0, disposed = false;
  let nextBlink = 0, blinkAt = -10;

  const state = (t) => {
    const s = {expose: 0, lid: 0, glow: 0, rim: 0, reveal: 0, zoomK: 0, blink: 0, sign: 0};
    s.sign = (mode === 'held' || mode === 'exit') && t >= T.hold ? 1 : seg(t, 2.65, 4.15);
    if (mode === 'held' || t >= T.hold) {
      const h = t - holdFrom;
      s.expose = 1; s.rim = 1; s.zoomK = 1;
      s.lid = 1; s.glow = .62 + .14 * Math.sin(h * 1.25);        // breathing glow
      if (t >= nextBlink) { blinkAt = t; nextBlink = t + 5.2 + Math.random() * 3.4; }
      const b = t - blinkAt;                                        // slow, deliberate cat blink
      if (b >= 0 && b < .62) s.lid *= b < .16 ? 1 - ease.inOut(b / .16) : ease.out(clamp01((b - .26) / .36));
    } else {
      s.expose = ease.inOut(seg(t, ...T.emerge));
      s.rim = ease.inOut(seg(t, T.emerge[0] + .25, T.emerge[1] + .3));
      const o = seg(t, ...T.open);
      s.lid = ease.expo(o) * (o < 1 ? 1 : 1);
      s.glow = ease.out(seg(t, T.open[0] + .15, T.open[1] + .35)) * (.62 + .55 * Math.exp(-Math.pow((t - 2.05) / .28, 2)));
      s.zoomK = ease.inOut(seg(t, ...T.settle));
    }
    if (mode === 'exit') {
      const e = t - exitAt;
      // blink first (trust), then the dark opens from between the eyes
      if (e < .5) s.lid *= e < .14 ? 1 - ease.inOut(e / .14) : ease.out(clamp01((e - .2) / .3));
      s.reveal = ease.inOut(seg(e, .42, 1.25));
    }
    return s;
  };

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
    // settled framing: head height ≈ 62% of the viewport; start: eyes fill ~70% of width
    const box = meta.bbox || [0, 0, meta.size[0], meta.size[1]];
    const settled = Math.min((H * .78) / box[3], (W * .70) / box[2]);
    const close = (W * .46) / (eb.cx - ea.cx + ea.w * 2.2);
    const k = s.zoomK;
    const zoom = close * Math.pow(settled / close, k);          // log-space zoom feels like a steady dolly
    const cy = eyeMid.y + (box[1] + box[3] * .5 - eyeMid.y) * k;
    gl.uniform2f(U.uRes, W, H);
    gl.uniform2f(U.uCenter, eyeMid.x, cy);
    gl.uniform1f(U.uZoom, zoom);
    gl.uniform1f(U.uExpose, s.expose);
    gl.uniform1f(U.uLid, s.lid);
    gl.uniform1f(U.uGlowAmt, s.glow);
    gl.uniform1f(U.uRim, s.rim);
    gl.uniform1f(U.uReveal, s.reveal);
    gl.uniform1f(U.uTime, t);
    gl.uniform1f(U.uGrain, .018);
    // reveal origin = between the eyes on screen
    const ex = W * .5 + (eyeMid.x - eyeMid.x) * zoom, ey = H * .5 - (eyeMid.y - cy) * zoom;
    gl.uniform2f(U.uRevealAt, ex, ey);
    if (signature) {
      const dpr = canvas.width / Math.max(1, canvas.clientWidth);
      const bottom = (H * .5 + (box[1] + box[3] - cy) * zoom) / dpr;
      const width = Math.min(220, box[2] * zoom / dpr * .46);
      const el = signature.svg;
      el.style.left = `${canvas.clientWidth / 2 - width / 2}px`;
      el.style.top = `${Math.min(canvas.clientHeight - width * .5, bottom - width * .06)}px`;
      el.style.width = `${width}px`;
      el.style.opacity = String(Math.max(0, 1 - s.reveal * 3) * Math.min(1, s.sign * 6));
      signature.write(s.sign);
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return s;
  };

  const loop = (now) => {
    if (disposed) return;
    const t = (now - startedAt) / 1000;
    const s = draw(t);
    if (mode === 'exit' && s.reveal >= 1) { mode = 'done'; exitResolve?.(); return; }
    raf = requestAnimationFrame(loop);
  };

  return {
    play() {
      mode = 'play'; startedAt = performance.now(); nextBlink = T.hold + 3.5;
      if (reducedMotion) { mode = 'held'; holdFrom = 0; }
      cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    },
    hold() {
      mode = 'held'; startedAt = performance.now() - T.hold * 1000; holdFrom = T.hold; nextBlink = T.hold + 2.5;
      cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    },
    exit() {
      return new Promise((resolve) => {
        exitResolve = resolve;
        const t = (performance.now() - startedAt) / 1000;
        if (t < T.hold && mode === 'play') {
          // never cut the opening short: leave right after the eyes have settled
          setTimeout(() => { mode = 'exit'; exitAt = (performance.now() - startedAt) / 1000; }, (T.hold - t) * 1000);
        } else { mode = 'exit'; exitAt = t; }
        if (reducedMotion) { mode = 'done'; resolve(); }
      });
    },
    renderAt(seconds, {exitAfter = null} = {}) {
      mode = exitAfter == null ? 'play' : 'exit'; exitAt = exitAfter ?? 0; nextBlink = 1e9;
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
