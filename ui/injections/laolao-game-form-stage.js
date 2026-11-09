/* 碧琪形态舞台（形态 v2，briefs/study-desk-game/FORMS-V2.md）。
   和输入框上的小碧琪（laolao-buddy-rig.js）、开屏（laolao-splash-fx.js）是同一套做法：WebGL 实时画，不是贴图换来换去。
   - 背景板：形态自己的场景（网页版 GPT 出的主视觉，角色挖掉、补好），跟着鼠标有一点视差，略虚一点出景深；
   - 角色：从主视觉抠出来的碧琪放进一张会变形的网格：呼吸、眨眼、鬃毛和尾巴摆、头跟着鼠标；点她会被戳一下；
   - 氛围：每个形态一套着色器（天角兽晨光光柱和金色浮尘、水晶折光闪点、海马水下焦散和气泡、麒麟灯火余烬和薄雾、
     夜骐月晕和星尘、较真窗上雨痕和台灯、日常 / 无限制柔光散景），背景一层、角色前面再一层更近更虚的；
   - 状态：idle / cheer（答对：蹦起、鬃毛甩、一道暖光）/ hurt（答错：一缩、抖一下、冷一下）；
   - 变身 transform(id)：光从脚下升起，旧形态的剪影烧成一圈光边溶解，场景换掉，新形态从光里凝出来，镜头轻推。
   avatar 模式（答题页状态条）：只画角色；答对 / 答错换成 GPT 出的姿势图，过一会儿回到待机。
   不支持 WebGL、素材没到、系统要求减少动态效果时退回静态图（stage 用主视觉，avatar 用立绘）。 */
(() => {
  'use strict';
  if (window.__pinkieFormStage) return;

  const G = () => window.__pinkieGame;
  const RIG = () => window.__pinkieBuddyRig;
  const GX = 36, GY = 22;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  // 每个形态的氛围：kind 选着色器分支，src = 主光源在背景板上的位置（0–1），c1/c2 = 光色
  const LOOK = {
    daily:        {kind: 0, src: [.86, .08], c1: [1, .82, .9], c2: [1, .93, .78], focus: .64},
    unrestricted: {kind: 0, src: [.86, .1], c1: [1, .78, .92], c2: [.78, .9, 1], focus: .64},
    alicorn:      {kind: 1, src: [.095, .45], c1: [1, .84, .62], c2: [1, .9, .96], focus: .56},
    crystal:      {kind: 2, src: [.3, 0], c1: [.86, .72, 1], c2: [.7, .95, 1], focus: .6},
    seapony:      {kind: 3, src: [.32, -.05], c1: [.72, 1, .96], c2: [1, .86, .9], focus: .52},
    kirin:        {kind: 4, src: [.7, .1], c1: [1, .62, .32], c2: [1, .86, .7], focus: .6},
    batpony:      {kind: 5, src: [.175, .125], c1: [.82, .86, 1], c2: [1, .86, .64], focus: .58},
    serious:      {kind: 6, src: [.17, .33], c1: [1, .78, .52], c2: [.62, .76, 1], focus: .62},
  };
  const look = id => LOOK[id] || LOOK.daily;

  const loadImage = src => new Promise((resolve, reject) => {
    const img = new Image(); img.decoding = 'async'; img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img); img.onerror = reject; img.src = src;
  });

  // 网格权重：头（眼睛周围）、尾巴（离头最远的那一侧）、头发（深粉）。buddy-rig 已经会找眼睛和头发，
  // 但它假定碧琪脸朝左、尾巴在右；形态图有的朝右（海马、天角兽），尾巴这一项按头的位置重算。
  const prepare = async (src) => {
    const rig = RIG();
    if (rig?.prepare) {
      try {
        const d = await rig.prepare(src);
        const w = new Float32Array(d.weights);
        const hx = d.head?.x ?? .35, side = hx > .5 ? -1 : 1;
        for (let gy = 0; gy <= GY; gy += 1) for (let gx = 0; gx <= GX; gx += 1) {
          const u = gx / GX, v = gy / GY, o = (gy * (GX + 1) + gx) * 3;
          const far = side > 0 ? u - hx : hx - u;
          w[o + 1] = (clamp((far - .3) / .45) ** 1.5) * smooth(.15, .45, v);
        }
        return {img: d.img, W: d.W, H: d.H, eyes: d.eyes || [], head: d.head || {x: .35, y: .3}, weights: w, mask: d.mask};
      } catch { /* 退回下面的平网格 */ }
    }
    const img = await loadImage(src);
    const W = img.naturalWidth, H = img.naturalHeight;
    const w = new Float32Array((GX + 1) * (GY + 1) * 3);
    for (let gy = 0; gy <= GY; gy += 1) for (let gx = 0; gx <= GX; gx += 1) { const o = (gy * (GX + 1) + gx) * 3; w[o] = Math.exp(-(((gx / GX - .35) / .26) ** 2 + ((gy / GY - .3) / .6) ** 2) * 1.4); }
    return {img, W, H, eyes: [], head: {x: .35, y: .3}, weights: w, mask: null};
  };

  const VS_QUAD = `attribute vec2 aP; varying vec2 vUV; uniform vec4 uRect; void main(){ vUV = aP; gl_Position = vec4(uRect.x + aP.x * uRect.z, uRect.y - aP.y * uRect.w, 0., 1.); }`;

  // 背景板 + 氛围。uFront=1 时只画前景那层更近更虚的光点（加在角色前面）。
  const FS_PLATE = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uA, uAs, uB, uBs;
uniform float uMixP, uT, uKind, uKindB, uFront, uFocus, uFlash, uLift, uAspect, uFeather, uDim, uAmb;
uniform vec2 uSrc, uSrcB;
uniform vec3 uC1, uC2, uC1B, uC2B;
float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * n2(p); p *= 2.03; a *= .5; } return s; }
// 散景光点：网格里每格一个，慢慢漂；size 是格子的比例，rise 是往上飘的速度
float motes(vec2 uv, float cells, float size, vec2 drift, float tw){
  vec2 p = uv * vec2(cells * uAspect, cells) + drift * uT;
  vec2 i = floor(p), f = fract(p) - .5;
  float r = h1(i);
  if (r > .55) return 0.;
  vec2 o = vec2(h1(i + 7.1), h1(i + 3.3)) - .5;
  o += .18 * vec2(sin(uT * .4 + r * 30.), cos(uT * .33 + r * 17.));
  float d = length(f - o * .6);
  float s = size * (.55 + .9 * h1(i + 1.7));
  float blink = mix(1., .5 + .5 * sin(uT * (1. + 2. * r) + r * 40.), tw);
  return smoothstep(s, s * .25, d) * blink * (.4 + .6 * h1(i + 9.2));
}
float shafts(vec2 uv, vec2 src, float k){
  vec2 d = uv - src; d.x *= uAspect;
  float a = atan(d.y, d.x), r = length(d);
  float ray = pow(n2(vec2(a * k, uT * .06)), 3.) + .6 * pow(n2(vec2(a * k * 2.3 + 4., uT * .045)), 4.);
  return ray * smoothstep(1.6, .05, r) * smoothstep(0., .08, r);
}
float caustic(vec2 uv){
  vec2 p = uv * vec2(9. * uAspect, 9.);
  float c = 0.;
  for (int i = 0; i < 3; i++) { float fi = float(i); p += vec2(sin(p.y * .9 + uT * (.5 + fi * .2)), cos(p.x * .8 - uT * (.45 + fi * .15))) * .7; c += .5 / (1. + 12. * abs(sin(p.x + p.y * .6))); }
  return c;
}
float glints(vec2 uv){
  vec2 p = uv * vec2(26. * uAspect, 26.);
  vec2 i = floor(p), f = fract(p) - .5;
  float r = h1(i);
  if (r > .16) return 0.;
  float life = pow(max(0., sin(uT * (.7 + r * 2.) + r * 60.)), 18.);
  vec2 o = (vec2(h1(i + 2.), h1(i + 5.)) - .5) * .6; f -= o;
  float star = max(smoothstep(.06, 0., abs(f.x)) * smoothstep(.45, 0., abs(f.y)), smoothstep(.06, 0., abs(f.y)) * smoothstep(.45, 0., abs(f.x)));
  return (star * .8 + smoothstep(.12, 0., length(f))) * life;
}
float rain(vec2 uv){
  vec2 p = vec2(uv.x * 140. * uAspect, uv.y * 3. + uT * 1.6);
  float col = floor(p.x), sp = .7 + h1(vec2(col, 1.)) * .9;
  float y = fract(uv.y * 2.2 + uT * sp + h1(vec2(col, 2.)));
  return smoothstep(.15, 0., abs(fract(p.x) - .5)) * smoothstep(0., .02, y) * smoothstep(.16, .02, y) * step(.55, h1(vec2(col, 3.)));
}
vec3 ambient(vec2 uv, float kind, vec2 src, vec3 c1, vec3 c2, float front){
  vec3 add = vec3(0.);
  float k = floor(kind + .5);
  if (front > .5) {
    // 前景层：少、大、虚
    float m = motes(uv + vec2(0., uT * .004), 3.2, .22, vec2(.05, -.06), .4);
    vec3 c = mix(c1, c2, h1(floor(uv * 3.2)));
    if (k == 3.) { m = motes(uv, 3.6, .2, vec2(.0, .22), .2); c = vec3(.86, 1., 1.); }
    if (k == 4.) { m = motes(uv, 4.5, .12, vec2(.03, .2), .8); c = c1; }
    if (k == 6.) { m *= .45; }
    return c * m * .22;
  }
  if (k == 0.) {
    add += mix(c1, c2, uv.x) * motes(uv, 9., .16, vec2(.02, -.035), .5) * .28;
    add += c2 * shafts(uv, src, 7.) * .05;
  } else if (k == 1.) {
    add += c1 * shafts(uv, src, 9.) * .24;
    add += c1 * motes(uv, 22., .1, vec2(.015, -.05), .7) * .5 * smoothstep(1., .2, length(uv - src));
    add += c2 * motes(uv, 11., .12, vec2(.01, -.025), .3) * .18;
    add += c1 * .1 * smoothstep(.5, 0., length((uv - src) * vec2(uAspect, 1.))) * (.85 + .15 * sin(uT * .7));
  } else if (k == 2.) {
    add += mix(c1, c2, .5 + .5 * sin(uv.x * 9. + uT * .6)) * glints(uv) * .9;
    float sweep = smoothstep(.12, 0., abs(fract((uv.x * uAspect + uv.y) * .35 - uT * .045) - .5));
    add += c2 * sweep * .07;
    add += c1 * shafts(uv, src, 8.) * .12;
    add += c1 * motes(uv, 14., .1, vec2(.01, -.02), .8) * .22;
  } else if (k == 3.) {
    float cz = caustic(uv) * smoothstep(.15, .7, uv.y);
    add += c1 * cz * .16;
    add += c1 * shafts(uv, src, 11.) * .28 * smoothstep(1., .1, uv.y);
    float b = motes(uv, 12., .14, vec2(.0, .3), 0.); // 气泡往上走
    add += vec3(.85, 1., 1.) * b * .3;
  } else if (k == 4.) {
    float mist = fbm(vec2(uv.x * 3. * uAspect - uT * .04, uv.y * 5.)) * smoothstep(.25, .6, uv.y) * smoothstep(1., .65, uv.y);
    add += c2 * mist * .12;
    add += c1 * motes(uv, 18., .08, vec2(.04, .12), 1.) * .7;
    add += c1 * .16 * smoothstep(.35, 0., length((uv - src) * vec2(uAspect, 1.))) * (.8 + .2 * n2(vec2(uT * 3., 0.)));
  } else if (k == 5.) {
    float halo = smoothstep(.32, .05, length((uv - src) * vec2(uAspect, 1.)));
    add += c1 * halo * (.14 + .04 * sin(uT * .5));
    float mist = fbm(vec2(uv.x * 2.2 * uAspect - uT * .03, uv.y * 4. + 2.)) * smoothstep(.35, .75, uv.y);
    add += c1 * mist * .08;
    add += vec3(1.) * glints(uv * .7 + 3.) * .5 * smoothstep(.55, .0, uv.y);
    add += c2 * motes(uv, 16., .07, vec2(.02, -.03), 1.) * .3;
  } else {
    float win = smoothstep(.6, .66, uv.x) * smoothstep(.75, .6, uv.y);
    add += c2 * rain(uv) * win * .3;
    add += c1 * .2 * smoothstep(.3, 0., length((uv - src) * vec2(uAspect, 1.))) * (.9 + .1 * n2(vec2(uT * 2.5, 1.)));
    add += c1 * motes(uv, 20., .07, vec2(.01, -.01), .6) * .35 * smoothstep(.45, .0, length((uv - src) * vec2(uAspect * .6, 1.)));
  }
  return add;
}
void main(){
  vec2 uv = vUV;
  if (uFront > .5) {
    vec3 a = ambient(uv, uKind, uSrc, uC1, uC2, 1.), b = ambient(uv, uKindB, uSrcB, uC1B, uC2B, 1.);
    vec3 c = mix(a, b, uMixP);
    gl_FragColor = vec4(c, 0.);
    return;
  }
  vec3 A = mix(texture2D(uA, uv).rgb, texture2D(uAs, uv).rgb, uFocus);
  vec3 B = mix(texture2D(uB, uv).rgb, texture2D(uBs, uv).rgb, uFocus);
  A += ambient(uv, uKind, uSrc, uC1, uC2, 0.) * uAmb;
  B += ambient(uv, uKindB, uSrcB, uC1B, uC2B, 0.) * uAmb;
  vec3 col = mix(A, B, uMixP);
  // 变身：脚下升起的光
  float rise = smoothstep(1., .55, uv.y) * uLift;
  col += mix(uC1, uC1B, uMixP) * rise * .35;
  col += vec3(1.) * uFlash;
  float v = smoothstep(1.25, .35, length((uv - .5) * vec2(1.1, 1.3)));
  col *= mix(.8, 1., v) * uDim;
  float al = 1.;
  if (uFeather > .5) al = smoothstep(0., .07, uv.x) * smoothstep(1., .93, uv.x) * smoothstep(0., .05, uv.y) * smoothstep(1., .95, uv.y);
  gl_FragColor = vec4(col * al, al);
}`;

  // 角色网格：同 buddy-rig 的变形（呼吸、头、尾巴、头发、压扁、跳起），加上边光、溶解、冷暖色闪
  const VS_CHAR = `
attribute vec2 aUV; attribute vec3 aW;
uniform vec2 uImg; uniform vec4 uRect;
uniform vec2 uPivot; uniform float uTheta; uniform vec2 uHead; uniform float uBreath;
uniform vec2 uTail; uniform vec2 uHair; uniform float uT; uniform vec2 uSquash; uniform float uLift; uniform float uShake;
varying vec2 vUV;
void main() {
  vec3 w = aW;
  vec2 p = aUV * uImg;
  float ground = smoothstep(uImg.y, uImg.y * .82, p.y);
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
  p.x += uShake * ground;
  p.x = uImg.x * .5 + (p.x - uImg.x * .5) * uSquash.x;
  p.y = uImg.y - (uImg.y - p.y) * uSquash.y - uLift;
  vUV = aUV;
  gl_Position = vec4(uRect.x + p.x / uImg.x * uRect.z, uRect.y - p.y / uImg.y * uRect.w, 0., 1.);
}`;
  const FS_CHAR = `
precision mediump float;
uniform sampler2D uTex; uniform sampler2D uMask;
uniform float uBlink, uHasMask, uAlpha, uRim, uDissolve, uWarm, uCool, uT;
uniform vec4 uEyeA; uniform vec4 uEyeB; uniform vec3 uLidA; uniform vec3 uLidB;
uniform vec3 uRimC; uniform vec2 uTexel;
varying vec2 vUV;
const vec3 LASH = vec3(.23, .10, .16);
float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y); }
vec4 lid(vec4 c, float m, vec4 box, vec3 skin) {
  if (m < .01 || uBlink < .01 || box.z <= box.x) return c;
  vec2 l = (vUV - box.xy) / (box.zw - box.xy);
  float cx = l.x * 2. - 1.;
  float edge = uBlink * 1.12 - .06 * (1. - cx * cx);
  float shut = uBlink > .82 ? 1. : smoothstep(edge + .05, edge - .03, l.y);
  vec3 col = mix(c.rgb, skin * c.a, shut * m);
  float lineY = uBlink > .82 ? .58 + .2 * (1. - cx * cx) : edge;
  float line = (1. - smoothstep(.045, .1, abs(l.y - lineY))) * smoothstep(1., .72, abs(cx)) * smoothstep(.25, .6, uBlink);
  col = mix(col, LASH * c.a, line * m);
  return vec4(col, c.a);
}
void main() {
  vec4 c = texture2D(uTex, vUV);
  if (uHasMask > .5) { vec4 m = texture2D(uMask, vUV); c = lid(lid(c, m.r, uEyeA, uLidA), m.g, uEyeB, uLidB); }
  // 边光：alpha 的边缘（周围有透明的地方）
  float an = 0.;
  an += texture2D(uTex, vUV + vec2(uTexel.x * 4., 0.)).a; an += texture2D(uTex, vUV - vec2(uTexel.x * 4., 0.)).a;
  an += texture2D(uTex, vUV + vec2(0., uTexel.y * 4.)).a; an += texture2D(uTex, vUV - vec2(0., uTexel.y * 4.)).a;
  float edge = clamp(c.a - an * .25, 0., 1.) * 2.2;
  vec3 rgb = c.rgb;
  float lum = dot(rgb, vec3(.299, .587, .114));
  rgb = mix(rgb, vec3(lum) * vec3(.82, .9, 1.15), uCool * .55);
  rgb += vec3(1., .78, .55) * uWarm * .18 * c.a;
  rgb += uRimC * edge * uRim * c.a;
  // 溶解：噪声阈值，烧开的地方留一圈热边
  float a = c.a;
  if (uDissolve > 0.) {
    float n = (n2(vUV * 7.) * .6 + n2(vUV * 21. + 3.) * .4) * .45 + (1. - vUV.y) * .55;
    float th = uDissolve * 1.2 - .1;
    float burn = smoothstep(th + .12, th, n) * smoothstep(th - .03, th + .01, n);
    rgb += (uRimC * 1.6 + .25) * burn * 1.8 * c.a;
    a *= smoothstep(th - .015, th + .02, n);
    rgb *= smoothstep(th - .015, th + .02, n);
  }
  gl_FragColor = vec4(rgb, a) * uAlpha;
}`;

  class Stage {
    constructor(host, id, opts = {}) {
      this.host = host; this.id = id; this.opts = opts;
      this.mode = opts.mode === 'avatar' ? 'avatar' : 'stage';
      this.canvas = document.createElement('canvas');
      this.canvas.className = `pkfs pkfs--${this.mode}`;
      this.canvas.setAttribute('aria-hidden', 'true');
      Object.assign(this.canvas.style, {position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block'});
      const gl = this.canvas.getContext('webgl', {premultipliedAlpha: true, alpha: true, antialias: true});
      if (!gl) throw new Error('no webgl');
      this.gl = gl;
      this.pPlate = this.program(VS_QUAD, FS_PLATE);
      this.pChar = this.program(VS_CHAR, FS_CHAR);
      this.lp = this.locs(this.pPlate); this.lc = this.locs(this.pChar);
      this.quad = this.buf(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]));
      this.grid();
      this.forms = new Map(); this.textures = new Map();
      this.s = {theta: 0, vTheta: 0, hx: 0, vhx: 0, hy: 0, vhy: 0, sq: 0, vsq: 0, lift: 0, vLift: 0, hair: 0, tailPh: 0, tailKick: 0, blink: 0, shake: 0, warm: 0, cool: 0, rim: 0};
      this.pointer = {x: 0, y: 0, tx: 0, ty: 0, at: 0};
      this.pose = null; this.poseUntil = 0; this.poseMix = 0;
      this.tr = null; // 变身
      this.t = 0; this.last = 0; this.raf = 0; this.visible = true;
      this.nextBlink = performance.now() + 1400; this.blinkAt = 0;
      this.still = !!opts.still || matchMedia('(prefers-reduced-motion: reduce)').matches;
      host.classList.add('pkfs-host');
      host.append(this.canvas);
      this.onMove = (e) => { const r = this.host.getBoundingClientRect(); if (!r.width) return; this.pointer.tx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1.4, 1.4); this.pointer.ty = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1.4, 1.4); this.pointer.at = performance.now(); this.kick(); };
      this.onPoke = () => { this.s.vsq += 2.6; this.s.tailKick = 1; this.kick(); };
      window.addEventListener('pointermove', this.onMove, {passive: true});
      this.canvas.addEventListener('pointerdown', this.onPoke);
      this.canvas.style.pointerEvents = opts.poke === false ? 'none' : 'auto';
      this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.fail(); });
      this.ro = new ResizeObserver(() => { this.resize(); this.kick(); }); this.ro.observe(host); this.ro.observe(this.canvas);
      this.io = new IntersectionObserver(([en]) => { this.visible = en.isIntersecting; this.kick(); }); this.io.observe(host);
      this.onVis = () => this.kick(); document.addEventListener('visibilitychange', this.onVis);
      this.resize();
      this.ready = this.load(id).then((f) => { this.cur = f; this.kick(); return this; });
    }
    program(vs, fs) {
      const gl = this.gl;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }
    locs(p) {
      const gl = this.gl, out = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i += 1) { const u = gl.getActiveUniform(p, i); out[u.name] = gl.getUniformLocation(p, u.name); }
      out.aP = gl.getAttribLocation(p, 'aP'); out.aUV = gl.getAttribLocation(p, 'aUV'); out.aW = gl.getAttribLocation(p, 'aW');
      return out;
    }
    buf(data, type) { const gl = this.gl, b = gl.createBuffer(); gl.bindBuffer(type || gl.ARRAY_BUFFER, b); gl.bufferData(type || gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; }
    grid() {
      const uv = [], idx = [];
      for (let y = 0; y <= GY; y += 1) for (let x = 0; x <= GX; x += 1) uv.push(x / GX, y / GY);
      for (let y = 0; y < GY; y += 1) for (let x = 0; x < GX; x += 1) { const i = y * (GX + 1) + x; idx.push(i, i + 1, i + GX + 1, i + 1, i + GX + 2, i + GX + 1); }
      this.uvBuf = this.buf(new Float32Array(uv)); this.idxBuf = this.buf(new Uint16Array(idx), this.gl.ELEMENT_ARRAY_BUFFER); this.count = idx.length;
    }
    tex(source) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    soft(img) { // 景深用的虚化版：缩小再放大
      const c = document.createElement('canvas'); c.width = Math.max(8, img.naturalWidth >> 3); c.height = Math.max(8, img.naturalHeight >> 3);
      const x = c.getContext('2d'); x.filter = 'blur(2px)'; x.drawImage(img, 0, 0, c.width, c.height); return c;
    }
    async sprite(src) {
      if (this.textures.has(src)) return this.textures.get(src);
      const job = prepare(src).then((d) => {
        const gl = this.gl;
        const it = {d, tex: this.tex(d.img), mask: d.mask ? this.tex(d.mask) : null, w: this.buf(d.weights)};
        gl.bindTexture(gl.TEXTURE_2D, it.tex);
        return it;
      });
      this.textures.set(src, job);
      return job;
    }
    async load(id) {
      if (this.forms.has(id)) return this.forms.get(id);
      const job = (async () => {
        const g = G(), slot = s => g?.art?.(`form/${id}/${s}`);
        const meta = g?.cache?.manifest?.[`form/${id}/plate`] || {};
        const f = {id, look: look(id), layout: meta.layout || {char: [.4, .1, .5, .8], w: 1536, h: 1024}};
        const charSrc = slot('portrait');
        if (!charSrc) throw new Error('no art');
        f.char = await this.sprite(charSrc);
        if (this.mode === 'stage') {
          const plate = await loadImage(slot('plate'));
          f.plateImg = plate; f.plate = this.tex(plate); f.plateSoft = this.tex(this.soft(plate));
        } else {
          for (const st of ['cheer', 'hurt']) { const u = slot(st); if (u) f[st] = this.sprite(u).catch(() => null); }
        }
        return f;
      })();
      this.forms.set(id, job);
      job.catch(() => this.forms.delete(id));
      return job;
    }
    resize() {
      // 画布可能被样式放得比宿主大（作答页头像往上多留蹦跳空间），按画布自己的尺寸取像素
      const cr = this.canvas.getBoundingClientRect(), r = cr.width ? cr : this.host.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.cw = w; this.ch = h;
    }
    kick() { if (!this.raf && !this.dead) this.raf = requestAnimationFrame((t) => this.frame(t)); }
    // 背景板在画布上的位置：铺满，角色中心落在 focus 处（左边留给文字）
    layout(f, zoom) {
      const {w: pw, h: ph} = f.plateImg ? {w: f.plateImg.naturalWidth, h: f.plateImg.naturalHeight} : f.layout;
      const c = f.layout.char;
      // 铺满优先；但角色必须整只在画面里（宽屏时会裁掉头）——放不下就缩到角色高度合适，两边用虚化的场景补
      const cover = Math.max(this.cw / pw, this.ch / ph);
      const fitChar = this.ch * .9 / (c[3] * ph);
      const s = Math.min(cover, fitChar) * zoom;
      const W = pw * s, H = ph * s;
      const cx = (c[0] + c[2] / 2) * W;
      const focus = this.opts.focus ?? f.look.focus;
      let x = this.cw * focus - cx; x = W >= this.cw ? clamp(x, this.cw - W, 0) : x;
      const top = c[1] * H, bottom = (c[1] + c[3]) * H;
      let y = this.ch * .5 - (top + bottom) / 2 + this.ch * .02;
      if (H >= this.ch) y = clamp(y, this.ch - H, 0);
      return {x, y, W, H, cover: s >= cover * zoom - 1e-6};
    }
    state(name) {
      const s = this.s, now = performance.now();
      if (name === 'cheer') { s.vsq -= 3.2; s.vLift += 620; s.warm = 1; s.rim = Math.max(s.rim, .7); s.tailKick = 1.4; }
      else if (name === 'hurt') { s.vsq += 3.4; s.cool = 1; s.shakeT = now; }
      if (this.mode === 'avatar' && (name === 'cheer' || name === 'hurt')) {
        Promise.resolve(this.cur?.[name]).then((it) => { if (!it) return; this.pose = it; this.poseFrom = performance.now(); this.poseUntil = this.poseFrom + 1500; this.kick(); });
      }
      this.kick();
    }
    // 从 fromId 变身回现在这个形态（衣橱里点「装备」时：先回到旧形态，再当面变过来）
    async play(fromId) {
      const to = this.cur || await this.ready.then(() => this.cur);
      if (!to || fromId === to.id) return;
      let from; try { from = await this.load(fromId); } catch { return; }
      this.cur = from; await this.transform(to.id);
    }
    // 变身到另一个形态。返回 Promise，演完才 resolve。
    async transform(id) {
      if (id === this.cur?.id) return;
      let next;
      try { next = await this.load(id); } catch { return; }
      if (this.still || this.mode !== 'stage') { this.cur = next; this.kick(); return; }
      await new Promise((resolve) => { this.tr = {from: this.cur, to: next, at: performance.now(), dur: 2000, resolve}; this.kick(); });
      this.cur = next;
    }
    step(dt, now) {
      const s = this.s, p = this.pointer;
      const idle = now - p.at > 2600;
      const gx = idle ? Math.sin(now / 2300) * .25 : p.tx, gy = idle ? Math.cos(now / 3100) * .15 : p.ty;
      p.x += (gx - p.x) * Math.min(1, dt * 3); p.y += (gy - p.y) * Math.min(1, dt * 3);
      const spring = (k, v, target, stiff, damp) => { const a = (target - s[k]) * stiff - s[v] * damp; s[v] += a * dt; s[k] += s[v] * dt; };
      const f = this.cur?.char?.d; const facing = f ? (f.head.x > .5 ? 1 : -1) : -1;
      spring('hx', 'vhx', p.x * 7 * (this.mode === 'avatar' ? .6 : 1), 60, 11);
      spring('hy', 'vhy', p.y * 3.5, 60, 11);
      spring('theta', 'vTheta', p.y * .035 * facing, 50, 10);
      spring('sq', 'vsq', 0, 140, 9);
      s.vLift -= 2600 * dt; s.lift += s.vLift * dt; if (s.lift <= 0) { if (s.vLift < -200) s.vsq += 1.6; s.lift = 0; s.vLift = 0; }
      s.hair += dt; s.tailPh += dt * (1.1 + s.tailKick * 4); s.tailKick = Math.max(0, s.tailKick - dt * 1.2);
      s.warm = Math.max(0, s.warm - dt * 1.4); s.cool = Math.max(0, s.cool - dt * 1.2); s.rim = Math.max(this.tr ? s.rim : 0, s.rim - dt * 1.1);
      s.shake = s.shakeT && now - s.shakeT < 420 ? Math.sin((now - s.shakeT) * .06) * 7 * (1 - (now - s.shakeT) / 420) : 0;
      if (now >= this.nextBlink && !this.blinkAt) this.blinkAt = now;
      if (this.blinkAt) { const k = (now - this.blinkAt) / 170; s.blink = k < 1 ? Math.sin(k * Math.PI) : 0; if (k >= 1) { this.blinkAt = 0; this.nextBlink = now + 2200 + Math.random() * 3600; } }
    }
    frame(now) {
      this.raf = 0;
      if (this.dead || !this.host.isConnected) { if (!this.host.isConnected) this.destroy(); return; }
      if (document.hidden || !this.visible) return;
      const dt = Math.min(.05, this.last ? (now - this.last) / 1000 : .016); this.last = now;
      this.t += dt;
      if (!this.still) this.step(dt, now);
      if (this.cur) this.draw(now);
      if (!this.still || this.tr) this.raf = requestAnimationFrame((t) => this.frame(t));
    }
    drawChar(it, rect, alpha, extra = {}) {
      if (!it || alpha <= 0) return;
      const gl = this.gl, L = this.lc, s = this.s, d = it.d;
      gl.useProgram(this.pChar);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf); gl.enableVertexAttribArray(L.aUV); gl.vertexAttribPointer(L.aUV, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, it.w); gl.enableVertexAttribArray(L.aW); gl.vertexAttribPointer(L.aW, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
      const k = rect.w / d.W; // 画布像素 / 图像素
      gl.uniform2f(L.uImg, d.W, d.H);
      gl.uniform4f(L.uRect, -1 + 2 * rect.x / this.cw, 1 - 2 * rect.y / this.ch, 2 * rect.w / this.cw, 2 * rect.h / this.ch);
      gl.uniform2f(L.uPivot, d.head.x * d.W, Math.min(.92, d.head.y + .34) * d.H);
      gl.uniform1f(L.uTheta, s.theta);
      gl.uniform2f(L.uHead, s.hx / k * .5, s.hy / k * .5);
      gl.uniform1f(L.uBreath, (Math.sin(this.t * Math.PI * 2 * .27) * .5 + .5) * .016);
      const tail = 6 / k * .5 + s.tailKick * 7 / k * .5;
      gl.uniform2f(L.uTail, Math.sin(s.tailPh) * tail, Math.cos(s.tailPh * .9) * tail * .5);
      gl.uniform2f(L.uHair, s.warm * 1.4 / k, 1.3 / k);
      gl.uniform1f(L.uT, this.t);
      gl.uniform2f(L.uSquash, 1 - s.sq * .05, 1 + s.sq * .07);
      gl.uniform1f(L.uLift, s.lift * .12 / k);
      gl.uniform1f(L.uShake, s.shake / k * .6);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, it.tex); gl.uniform1i(L.uTex, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, it.mask || it.tex); gl.uniform1i(L.uMask, 1);
      gl.uniform1f(L.uHasMask, it.mask ? 1 : 0);
      const e = (i) => d.eyes[i] || {box: [0, 0, 0, 0], lid: [1, 1, 1]};
      gl.uniform4fv(L.uEyeA, e(0).box); gl.uniform4fv(L.uEyeB, e(1).box); gl.uniform3fv(L.uLidA, e(0).lid); gl.uniform3fv(L.uLidB, e(1).lid);
      gl.uniform1f(L.uBlink, s.blink);
      gl.uniform1f(L.uAlpha, alpha);
      gl.uniform1f(L.uRim, extra.rim ?? s.rim);
      gl.uniform1f(L.uDissolve, extra.dissolve || 0);
      gl.uniform1f(L.uWarm, s.warm); gl.uniform1f(L.uCool, s.cool);
      gl.uniform3fv(L.uRimC, extra.rimC || this.cur.look.c1);
      gl.uniform2f(L.uTexel, 1 / d.W, 1 / d.H);
      gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    }
    drawPlate(a, b, mix, extra) {
      const gl = this.gl, L = this.lp;
      gl.useProgram(this.pPlate);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.enableVertexAttribArray(L.aP); gl.vertexAttribPointer(L.aP, 2, gl.FLOAT, false, 0, 0);
      const r = extra.rect;
      gl.uniform4f(L.uRect, -1 + 2 * r.x / this.cw, 1 - 2 * r.y / this.ch, 2 * r.W / this.cw, 2 * r.H / this.ch);
      const bind = (u, t, loc) => { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, u); };
      bind(0, a.plate, L.uA); bind(1, a.plateSoft, L.uAs); bind(2, b.plate, L.uB); bind(3, b.plateSoft, L.uBs);
      gl.uniform1f(L.uMixP, mix); gl.uniform1f(L.uT, this.t); gl.uniform1f(L.uFront, extra.front ? 1 : 0);
      gl.uniform1f(L.uFocus, extra.focus ?? .38); gl.uniform1f(L.uFlash, extra.flash || 0); gl.uniform1f(L.uLift, extra.lift || 0);
      gl.uniform1f(L.uFeather, extra.feather ? 1 : 0); gl.uniform1f(L.uDim, extra.dim ?? 1); gl.uniform1f(L.uAmb, extra.amb ?? 1);
      gl.uniform1f(L.uAspect, r.W / r.H);
      gl.uniform1f(L.uKind, a.look.kind); gl.uniform2fv(L.uSrc, a.look.src); gl.uniform3fv(L.uC1, a.look.c1); gl.uniform3fv(L.uC2, a.look.c2);
      gl.uniform1f(L.uKindB, b.look.kind); gl.uniform2fv(L.uSrcB, b.look.src); gl.uniform3fv(L.uC1B, b.look.c1); gl.uniform3fv(L.uC2B, b.look.c2);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    charRect(f, plate) {
      const c = f.layout.char;
      return {x: plate.x + c[0] * plate.W, y: plate.y + c[1] * plate.H, w: c[2] * plate.W, h: c[3] * plate.H};
    }
    draw(now) {
      const gl = this.gl;
      gl.viewport(0, 0, this.cw, this.ch);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (this.mode === 'avatar') return this.drawAvatar(now);
      const tr = this.tr;
      let k = 0;
      if (tr) { k = clamp((now - tr.at) / tr.dur); if (k >= 1) { this.tr = null; this.cur = tr.to; tr.resolve(); } }
      const from = tr ? tr.from : this.cur, to = tr ? tr.to : this.cur;
      const push = tr ? 1 + .035 * Math.sin(Math.PI * k) : 1;
      const p = this.pointer, drift = Math.sin(this.t * .21) * .5;
      const base = this.layout(to, 1.06 * push);
      const plateR = {...base, x: base.x - p.x * 9 - drift * 4, y: base.y - p.y * 6};
      const mix = tr ? smooth(.35, .62, k) : 0;
      const flash = tr ? Math.exp(-(((k - .47) / .05) ** 2)) * .32 : 0;
      const lift = tr ? Math.sin(Math.PI * clamp(k / .9)) : 0;
      if (!base.cover) {
        // 背板：同一张场景铺满整个画布，虚化、压暗，主画面羽化边缘叠在上面
        const pw = base.W / base.H, sc = Math.max(this.cw / base.W, this.ch / base.H) * 1.08;
        const BW = base.W * sc, BH = base.H * sc;
        this.drawPlate(from, to, mix, {rect: {x: (this.cw - BW) / 2 - p.x * 5, y: (this.ch - BH) / 2, W: BW, H: BH}, focus: 1, dim: .62, amb: 0});
      }
      this.drawPlate(from, to, mix, {rect: plateR, flash, lift, feather: !base.cover});
      // 角色离镜头更近，视差更大
      const fg = {...base, x: base.x - p.x * 18 - drift * 7, y: base.y - p.y * 10};
      if (tr) {
        const out = smooth(.12, .5, k), inn = 1 - smooth(.45, .9, k);
        this.s.rim = Math.max(this.s.rim, Math.sin(Math.PI * clamp(k * 1.1)));
        const fb = this.layout(from, 1.06 * push);
        if (k < .55) this.drawChar(from.char, this.charRect(from, {...fb, x: fb.x - p.x * 18 - drift * 7, y: fb.y - p.y * 10}), 1, {dissolve: out, rimC: to.look.c1});
        if (k > .42) this.drawChar(to.char, this.charRect(to, fg), 1, {dissolve: inn, rimC: to.look.c1});
      } else this.drawChar(this.cur.char, this.charRect(this.cur, fg), 1);
      gl.blendFunc(gl.ONE, gl.ONE);
      const front = {...base, x: base.x - p.x * 30 - drift * 12, y: base.y - p.y * 16};
      this.drawPlate(from, to, mix, {rect: front, front: true});
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    drawAvatar(now) {
      const it = this.cur.char, d = it.d;
      const pad = .06, top = .14;
      const fit = (dd) => { const sc = Math.min(this.cw * (1 - pad * 2) / dd.W, this.ch * (1 - top - .02) / dd.H); const w = dd.W * sc, h = dd.H * sc; return {x: (this.cw - w) / 2 - this.pointer.x * 3, y: this.ch - h - this.ch * .02, w, h}; };
      let pm = 0;
      if (this.pose) {
        const a = (now - this.poseFrom) / 180, b = (this.poseUntil - now) / 260;
        pm = clamp(Math.min(a, b));
        if (now > this.poseUntil) { this.pose = null; pm = 0; }
      }
      if (pm < 1) this.drawChar(it, fit(d), 1 - pm);
      if (pm > 0) this.drawChar(this.pose, fit(this.pose.d), pm);
    }
    fail() { this.dead = true; this.opts.onFail?.(); }
    destroy() {
      this.dead = true; cancelAnimationFrame(this.raf); this.raf = 0;
      window.removeEventListener('pointermove', this.onMove); document.removeEventListener('visibilitychange', this.onVis);
      this.ro?.disconnect(); this.io?.disconnect(); this.canvas.remove(); this.host.classList.remove('pkfs-host');
      if (this.tr) { this.tr.resolve(); this.tr = null; }
    }
  }

  const has = (id) => {
    const m = G()?.cache?.manifest || {};
    return !!(m[`form/${id}/plate`] && m[`form/${id}/portrait`]);
  };
  // 失败时的静态兜底：stage 用主视觉铺满，avatar 用立绘
  const fallback = (host, id, mode) => {
    const g = G(); const img = document.createElement('img'); img.alt = ''; img.decoding = 'async';
    img.className = `pkfs-still pkfs-still--${mode}`;
    img.src = (mode === 'stage' ? g?.art?.(`form/${id}/ult`) : null) || g?.portrait?.(id) || '';
    host.classList.add('pkfs-host'); host.append(img);
    return {ready: Promise.resolve(), state() {}, transform: async (nid) => { img.src = (mode === 'stage' ? g?.art?.(`form/${nid}/ult`) : null) || g?.portrait?.(nid) || img.src; }, destroy() { img.remove(); }, still: true};
  };
  const mount = (host, id, opts = {}) => {
    const mode = opts.mode === 'avatar' ? 'avatar' : 'stage';
    if (!has(id) || document.documentElement.hasAttribute('data-pinkie-lite')) return fallback(host, id, mode);
    let st;
    try { st = new Stage(host, id, opts); } catch { return fallback(host, id, mode); }
    let fb = null;
    const ctl = {
      ready: st.ready.catch(() => { st.destroy(); fb = fallback(host, id, mode); }),
      state: (n) => (fb || st).state(n),
      transform: (nid) => (fb || st).transform(nid),
      play: (fromId) => (fb ? Promise.resolve() : st.play(fromId)),
      destroy: () => (fb || st).destroy(),
      get id() { return st.cur?.id || id; },
    };
    return ctl;
  };
  // 场景明暗：营地文字用深字还是浅字（跟场景走，不跟钟点走）
  const DARK = new Set(['crystal', 'batpony', 'serious', 'kirin']);
  const tone = id => DARK.has(id) ? 'night' : 'day';
  window.__pinkieFormStage = {has, mount, tone, LOOK};
})();
