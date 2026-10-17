/* cle-space:v4 —— 「C.le.」签名 × 三维粒子
 *
 * 待机是一枚矢量签名（尖头笔的粗细对比 + 花式下划线）。开始工作时签名溶解为粒子，
 * 粒子在三维空间里变换形态；工作结束，粒子由一支羽毛笔重新「落款」，再收拢回矢量签名。
 *
 *   idle   矢量签名（粒子隐藏，且精确压在笔画里，切换无缝）
 *   think  思绪流：∞ 形流线两瓣轮流鼓起，念头追赶、核心心跳   read   铺成倾斜书页，扫描光逐行掠过
 *   write  羽毛笔按笔顺书写签名（循环）      edit   体素化分层错位，e 炸开重组
 *   done   落款：羽毛笔快速签名 → 句点墨晕 → 光沿笔顺流过 → 羽毛化开 → 收拢为矢量签名
 *
 * 技术：Three.js（WebGL 粒子，形态全部在顶点着色器里计算）+ GSAP（时间线）+ SVG（签名）。
 * 依赖：window.gsap、window.CleSignature（cle-signature.js）。
 */
import * as THREE from './laolao-vendor-three.module.min.js';

const gsap = window.gsap;
const SIG = window.CleSignature;
const STATES = {idle: 0, think: 1, read: 2, write: 3, edit: 4, done: 5};
const VIEW = {cx: 96, cy: 54, k: 1 / 19};
const toWorld = (x, y) => new THREE.Vector3((x - VIEW.cx) * VIEW.k, -(y - VIEW.cy) * VIEW.k, 0);
const QUILL_SHARE = .34;

const PALETTES = {
  cle: {
    night: {a: '#e4ebff', b: '#8aa8ff', glow: '#62b4ff', ink: '#e9eeff', blend: 'add'},
    day: {a: '#2c2945', b: '#15131f', glow: '#2f7bff', ink: '#1a1826', blend: 'normal'},
  },
  pinkie: {
    night: {a: '#ffd8e8', b: '#ff7ab3', glow: '#ffa3cb', ink: '#ffd3e6', blend: 'add'},
    day: {a: '#ef68a3', b: '#b4459a', glow: '#ff4f9a', ink: '#b4459a', blend: 'normal'},
  },
};

/* ───────────────────────── 着色器 ───────────────────────── */
const VERT = /* glsl */`
uniform float uTime, uMix, uFrom, uTo, uWrite, uInk, uPress, uSweep, uQuillOut, uSize, uScale, uFocus, uAlpha;
uniform vec3 uPen;
uniform vec2 uDrag;
attribute vec3 aText, aCenter;
attribute vec4 aSeed;
attribute float aOrder, aLetter, aLocal, aQuill;
varying float vAlpha, vGlow;
float dens = 1.;
float psz = 1.;    // 粒子尺寸系数（羽毛笔用更细的点，让羽枝条纹显出来）

const float TAU = 6.2831853;
mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
mat3 rotZ(float a){ float c=cos(a), s=sin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }
float hash(float n){ return fract(sin(n)*43758.5453); }

vec3 drift(vec3 p, float amp){
  return p + amp * vec3(sin(uTime*.9 + aSeed.x*40.), cos(uTime*.7 + aSeed.y*40.), sin(uTime*.8 + aSeed.z*40.));
}

vec3 fIdle(out float g){ g = 0.; return aText; }

/* 思考：思绪流。粒子沿一条三维 ∞ 形流线不停地流——像思路在两个念头之间来回权衡：
 * 左右两瓣交替鼓起、收拢；两颗亮「念头」沿流线追赶，穿过交叉点时点亮核心；
 * 核心按心跳收放，火花从核心射向流线。全是形变与流动，没有整体旋转。 */
vec3 thinkPath(float s){
  float a = s * TAU, side = sin(a);
  float weigh = sin(uTime * 1.05);                     // 两瓣轮流鼓起
  float x = 3.25 * side * (1. + .17 * weigh * side);
  float y = 1.22 * sin(2. * a) * (1. + .22 * weigh * side);
  float z = .9 * cos(2. * a);                          // 马鞍形起伏：两瓣向后弯、交叉点在前（左右镜像对称，两股正好穿过核心）
  y += .13 * sin(a * 6. - uTime * 3.6);                // 沿流线前进的涟漪
  return vec3(x, y, z);
}
float heads(float s, out float lead){
  float h1 = fract(uTime * .17), h2 = fract(uTime * .115 + .41);
  float d1 = fract(h1 - s), d2 = fract(h2 - s);        // 0 = 正在头部，越大越靠后
  lead = max(exp(-(1. - d1) * 70.), exp(-(1. - d2) * 70.));
  return max(exp(-d1 * 16.), exp(-d2 * 16.));
}
float crossFlash(){                                    // 念头穿过 ∞ 的交叉点（s = 0 / 0.5）时的闪光
  float h1 = fract(uTime * .17), h2 = fract(uTime * .115 + .41);
  float c1 = abs(fract(h1 * 2. + .5) - .5), c2 = abs(fract(h2 * 2. + .5) - .5);
  return exp(-c1 * c1 * 900.) + exp(-c2 * c2 * 900.);
}
vec3 fThink(out float g){
  mat3 view = rotX(.42) * rotY(-.1);
  float ph = fract(uTime / 1.3);
  float beat = exp(-pow((ph - .08) * 15., 2.)) + .6 * exp(-pow((ph - .27) * 15., 2.));   // 心跳：咚—哒
  float flash = crossFlash();
  if (aSeed.w < .1) {                                  // 核心
    vec3 dir = normalize(aSeed.xyz - .5 + 1e-4);
    float r = (.2 + .16 * beat + .12 * flash) * pow(fract(aSeed.w * 37.1), .5);
    g = .55 + .7 * beat + .9 * flash; dens = .9; psz = 1.1 + .4 * beat;
    return view * (dir * r + .02 * sin(uTime * 19. + aSeed.xyz * 80.));
  }
  if (aSeed.w < .26) {                                 // 火花：核心 → 流线
    float rate = .5 + .35 * aSeed.x;
    float k = uTime * rate + aSeed.z;
    float f = fract(k);
    float st = fract(aSeed.y + floor(k) * .618);       // 每次换一个落点
    float e = 1. - pow(1. - f, 3.);
    vec3 arc = vec3(0., .5 * (aSeed.x - .5), .7 * (aSeed.y - .5)) * sin(f * 3.14159);
    g = .3 + 1.1 * (1. - f); psz = .75;
    dens = smoothstep(0., .06, f) * (1. - smoothstep(.7, 1., f)) * .85;
    return view * (thinkPath(st) * e + arc);
  }
  float s = fract(aSeed.x + uTime * .06);              // 流线：粒子一直在流
  s = fract(s + .035 * sin(TAU * (2. * s - uTime * .32)));   // 疏密波沿流线推进
  float lead;
  float hot = heads(s, lead);
  vec3 p = thinkPath(s) + vec3(0., (aSeed.y - .5) * .24, (aSeed.z - .5) * .24) * (1. - .6 * hot);
  g = .1 + 1.25 * hot + .6 * lead;
  dens = .45 + .55 * max(hot, lead);
  psz = .85 + .75 * hot;
  return view * p;
}

vec3 fRead(out float g){
  float line = floor(aSeed.y * 6.);
  float len = .55 + .45 * hash(line + 3.);
  float u = aSeed.x * len;
  float word = floor(u * 9.);
  float x = (u + word * .012 - .5) * 6.2;
  vec3 p = vec3(x, (2.5 - line) * .42, (aSeed.z - .5) * .06);
  float speed = .7;
  float cur = mod(floor(uTime * speed), 6.);
  float scan = mix(-3.3, 3.3 * len, fract(uTime * speed));
  float hot = (1. - step(.5, abs(line - cur))) * smoothstep(.75, .0, abs(x - scan));
  float done = step(line, cur - .5) + (1. - step(.5, abs(line - cur))) * step(x, scan);
  p.z += hot * .55;
  p.y += hot * .08;
  g = hot + done * .12;
  return rotY(-.42) * rotX(-.32) * p + vec3(0., .1, 0.);
}

/* 羽毛笔：本地坐标里笔尖在原点，羽杆沿 +y（带弧度）。
 * 笔尖：细长金属尖 + 中缝；羽杆：细中轴；羽片：约 56 根离散羽枝，每根是一条上弯的细线，前窄后宽。 */
vec3 rachis(float h){ return vec3(.06 * h * h / 3.4, h, 0.); }    // 羽杆整体微弯
vec3 quill(out float g){
  float k = aSeed.x, a = aSeed.z * TAU;
  vec3 p; g = 0.;
  if (k < .09) {                                       // 笔尖
    float h = aSeed.y * .34;
    float r = .055 * (h / .34);
    float side = aSeed.z < .5 ? -1. : 1.;
    float slit = smoothstep(.0, .22, h);               // 中缝：两瓣之间留空
    p = vec3(side * (r * (.35 + .65 * aSeed.w) + .006 * slit) * (1. + uPress * .8), h, (aSeed.w - .5) * .012);
    g = .95 * (1. - h / .34);
    dens = .95;
  } else if (k < .21) {                                // 羽杆
    float h = .3 + aSeed.y * 3.3;
    p = rachis(h) + vec3(cos(a) * .018, 0., sin(a) * .018);
    dens = .7; g = .1;
  } else {                                             // 羽片：离散羽枝
    float N = 56.;
    float side = aSeed.z < .58 ? -1. : 1.;
    float bi = floor(aSeed.y * N);
    float f = (bi + .5) / N;                           // 羽枝在羽杆上的位置
    float y0 = .62 + f * 2.85;
    float wmax = side < 0. ? .74 : .4;
    float w = wmax * pow(sin(3.14159 * min(1., f * 1.02 + .04)), .55) * (1. - .18 * f);
    float split = step(.9, hash(bi + side * 17.));     // 偶尔分叉
    float u = fract(aSeed.w * 7.13);                   // 沿羽枝
    float L = w * u * (1. - split * .45);
    vec3 base = rachis(y0);
    // 羽枝向上斜出、末端上弯
    p = base + vec3(side * L, L * .55 + u * u * w * .22, sin(u * 3.14159) * .04 * side);
    p.z += (hash(bi * 3.1) - .5) * .03;
    dens = .62 + .3 * (1. - u); g = .04;
  }
  p.x += sin(uTime * 3. + p.y * 2.) * .01 * p.y;       // 细微颤动
  p *= 1.5;
  psz = .58;
  mat3 R = rotZ(-.86 - uDrag.x * .14) * rotX(-.22 + uDrag.y * .1) * rotY(.35 + sin(uTime * .8) * .3);
  vec3 lift = vec3(0., (1. - uPress) * .3, (1. - uPress) * .22);
  return uPen + lift + R * p;
}

vec3 inked(out float g){
  float dry = smoothstep(.8, 1., aLocal) * step(.5, hash(aSeed.x * 91.));   // 收笔的飞白
  dens = uInk * (1. - dry * .7);
  float sweep = smoothstep(.045, .0, abs(aOrder - uSweep));                  // 光沿笔顺流过
  g = smoothstep(.05, .0, uWrite - aOrder) * 1.1 + sweep * 1.4;
  return drift(aText, .006);
}

vec3 fWrite(out float g){
  if (aQuill > .5) {
    vec3 q = quill(g);
    if (uQuillOut <= 0.) return q;
    float gi; float d0 = dens;
    vec3 t = inked(gi);
    float k = smoothstep(aSeed.y * .5, aSeed.y * .5 + .5, uQuillOut);       // 羽毛一缕缕化开
    g = mix(g, gi, k); dens = mix(d0, dens, k);
    return mix(q, t, k) + sin(k * 3.14159) * (aSeed.xyz - .5) * .9;
  }
  if (aOrder > uWrite) { g = 0.; dens = 0.; return uPen; }               // 未写到：藏在笔尖
  return inked(g);
}

vec3 fEdit(out float g){
  float cell = .2;
  vec3 q = floor(aText / cell) * cell + cell * .5;
  float row = floor(aText.y / .55);
  float ph = uTime * 1.8 + row * 1.9;
  q.x += sin(ph) * .22 * step(.5, mod(row, 2.));
  q.z += cos(ph) * .45;
  g = .15;
  if (aLetter > 1.5 && aLetter < 2.5) {
    float k = smoothstep(.15, .85, .5 + .5 * sin(uTime * 2.1));
    q = mix(q, q + (aSeed.xyz - .5) * vec3(1.5, 1.5, 2.4), k * k);
    g = .3 + k * .4;
    dens = 1. - k * .55;
  }
  return q;
}

vec3 F0(float id, out float g){
  if (id < .5) return fIdle(g);
  if (id < 1.5) return fThink(g);
  if (id < 2.5) return fRead(g);
  if (id < 3.5) return fWrite(g);
  if (id < 4.5) return fEdit(g);
  return fWrite(g);                                    // done 复用书写，由 JS 驱动落款时间线
}
vec3 F(float id, out float g, out float dn, out float ps){
  dens = 1.; psz = 1.;
  vec3 r = F0(id, g);
  dn = dens; ps = psz;
  return r;
}

void main(){
  float gA, gB, dA, dB, sA, sB;
  vec3 A = F(uFrom, gA, dA, sA);
  vec3 B = F(uTo, gB, dB, sB);
  float t = clamp(uMix * 1.55 - aSeed.z * .55, 0., 1.);
  float e = t * t * (3. - 2. * t);
  vec3 p = mix(A, B, e) + sin(e * 3.14159) * (aSeed.xyz - .5) * vec3(1.6, 1.6, 2.6);
  vGlow = mix(gA, gB, e) + sin(e * 3.14159) * .3;

  vec4 mv = modelViewMatrix * vec4(p, 1.);
  float depth = -mv.z;
  float blur = abs(depth - uFocus) * .32;
  gl_PointSize = uSize * mix(sA, sB, e) * (.55 + aSeed.w * .9) * uScale / depth * (1. + blur) * (1. + vGlow * .45);
  vAlpha = uAlpha * (.55 + .45 * aSeed.w) / (1. + blur * 2.2) * mix(dA, dB, e);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */`
uniform vec3 uA, uB, uGlow;
varying float vAlpha, vGlow;
void main(){
  vec2 c = gl_PointCoord - .5;
  float d = length(c);
  if (d > .5 || vAlpha < .004) discard;
  float soft = smoothstep(.5, .05, d);
  vec3 col = mix(uB, uA, smoothstep(.5, .0, d));
  col = mix(col, uGlow, clamp(vGlow, 0., 1.));
  gl_FragColor = vec4(col, soft * vAlpha * (1. + vGlow * .5));
}
`;

const RING_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uOpacity;
varying vec2 vUv;
void main(){
  float d = length(vUv - .5) * 2.;
  float ring = smoothstep(.06, .0, abs(d - .86)) + smoothstep(.22, .0, abs(d - .8)) * .35;
  gl_FragColor = vec4(uColor, ring * uOpacity);
}
`;
const RING_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;

/* ───────────────────────── 签名几何 ───────────────────────── */
function buildSignature() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
  document.body.appendChild(svg);
  const segs = SIG.strokes.map((s, i) => {
    if (s.dot) {
      const q = SIG.skew(s.dot[0], s.dot[1]);
      return {i, dot: true, c: q, r: s.r, letter: 3, len: 16};
    }
    const cl = SIG.centerline(s, svg, .5);
    return {i, dot: false, pts: cl.pts, letter: s.id === 'C' ? 0 : 1, len: cl.len};
  });
  const total = segs.reduce((a, s) => a + s.len, 0);
  let acc = 0;
  segs.forEach((s) => { s.o0 = acc / total; acc += s.len; s.o1 = acc / total; });
  const outline = SIG.outline(svg);
  svg.remove();
  return {segs, total, outline};
}

function samplePoints(n, sig) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = (i + Math.random() * .5) / n;
    const seg = sig.segs.find((s) => o <= s.o1 + 1e-6) || sig.segs[sig.segs.length - 1];
    const local = (o - seg.o0) / (seg.o1 - seg.o0);
    let x, y, cx, cy, letter = seg.letter;
    if (seg.dot) {
      const th = Math.random() * Math.PI * 2, r = seg.r * Math.sqrt(Math.random());
      x = seg.c.x + Math.cos(th) * r; y = seg.c.y + Math.sin(th) * r * .86; cx = seg.c.x; cy = seg.c.y;
    } else {
      const f = local * (seg.pts.length - 1), j = Math.floor(f), m = f - j;
      const p = seg.pts[j], q = seg.pts[Math.min(seg.pts.length - 1, j + 1)];
      cx = p.x + (q.x - p.x) * m; cy = p.y + (q.y - p.y) * m;
      const w = p.w + (q.w - p.w) * m, off = (Math.random() - .5) * w;
      x = cx + p.nx * off; y = cy + p.ny * off;
      if (seg.i === 2 && cx > 100) letter = 2;           // e 及之后
    }
    const v = toWorld(x, y);
    v.z = (Math.random() - .5) * .05;
    out.push({v, c: toWorld(cx, cy), order: o, local, letter});
  }
  return out;
}

/* 笔顺时间线：落笔时长按笔画长度分配；段间提笔划弧；点用「顿」 */
function buildTimeline(sig, speed, loop) {
  const DRAW = 3.4 / speed, AIR = .22 / speed, DAB = .28 / speed;
  const steps = [];
  let t = .3;
  steps.push({kind: 'enter', t0: 0, t1: t});
  sig.segs.forEach((s, i) => {
    if (i) { steps.push({kind: 'air', t0: t, t1: t + AIR, from: i - 1, to: i}); t += AIR; }
    const d = s.dot ? DAB : DRAW * (s.len / sig.total) * 1.3;
    steps.push({kind: s.dot ? 'dab' : 'draw', seg: i, t0: t, t1: t + d});
    t += d;
  });
  const end = t;
  if (loop) {
    steps.push({kind: 'hold', t0: t, t1: t + .9}); t += .9;
    steps.push({kind: 'leave', t0: t, t1: t + .45}); t += .45;
    steps.push({kind: 'fade', t0: t, t1: t + .55}); t += .55;
  } else {
    steps.push({kind: 'hold', t0: t, t1: t + 99});
  }
  return {steps, period: loop ? t : Infinity, end};
}

/* ───────────────────────── 主类 ───────────────────────── */
export class CleSpace {
  constructor(host, opt = {}) {
    this.host = host;
    this.opt = Object.assign({palette: 'cle', count: 3400, night: null, interactive: true, manual: false}, opt);
    this.state = 'idle';
    this.clock = 0;
    this.stateStart = 0;
    this.pointer = new THREE.Vector2();
    this.penPrev = new THREE.Vector3();
    this.drag = new THREE.Vector2();
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const r = this.renderer = new THREE.WebGLRenderer({alpha: true, antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: !!opt.preserve});
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.setClearColor(0x000000, 0);
    host.appendChild(r.domElement);
    r.domElement.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 2, .1, 100);
    this.rig = new THREE.Group();
    this.scene.add(this.rig);

    this.sig = buildSignature();
    this.writeTL = buildTimeline(this.sig, 1, true);
    this.signTL = buildTimeline(this.sig, 2, false);
    this.buildParticles();
    this.buildRing();
    this.buildSVG();
    this.applyTheme();
    this.resize();

    if ('ResizeObserver' in window) new ResizeObserver(() => this.resize()).observe(host);
    if (this.opt.interactive) {
      host.addEventListener('pointermove', (e) => {
        const b = host.getBoundingClientRect();
        this.pointer.set((e.clientX - b.left) / b.width - .5, (e.clientY - b.top) / b.height - .5);
      });
      host.addEventListener('pointerleave', () => this.pointer.set(0, 0));
    }
    this.visible = true;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => { this.visible = es[0].isIntersecting; this.loop(); }).observe(host);
    }
    document.addEventListener('visibilitychange', () => this.loop());
    if (!this.opt.manual) this.loop();
  }

  buildParticles() {
    const n = this.opt.count;
    const pts = samplePoints(n, this.sig);
    const g = new THREE.BufferGeometry();
    const A = (k) => new Float32Array(n * k);
    const text = A(3), center = A(3), seed = A(4), order = A(1), letter = A(1), local = A(1), quill = A(1);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      text.set([p.v.x, p.v.y, p.v.z], i * 3);
      center.set([p.c.x, p.c.y, 0], i * 3);
      seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
      order[i] = p.order; letter[i] = p.letter; local[i] = p.local;
      quill[i] = Math.random() < QUILL_SHARE ? 1 : 0;
    }
    const set = (name, arr, k) => g.setAttribute(name, new THREE.BufferAttribute(arr, k));
    set('position', text, 3); set('aText', text, 3); set('aCenter', center, 3); set('aSeed', seed, 4);
    set('aOrder', order, 1); set('aLetter', letter, 1); set('aLocal', local, 1); set('aQuill', quill, 1);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 9);

    this.u = {
      uTime: {value: 0}, uMix: {value: 1}, uFrom: {value: 0}, uTo: {value: 0},
      uWrite: {value: 1.1}, uInk: {value: 1}, uPress: {value: 0}, uSweep: {value: -1}, uQuillOut: {value: 0},
      uPen: {value: new THREE.Vector3(0, 2, 0)}, uDrag: {value: new THREE.Vector2()},
      uSize: {value: this.opt.size || .066}, uScale: {value: 600}, uFocus: {value: 13}, uAlpha: {value: 0},
      uA: {value: new THREE.Color()}, uB: {value: new THREE.Color()}, uGlow: {value: new THREE.Color()},
    };
    this.material = new THREE.ShaderMaterial({uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false});
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.rig.add(this.points);
  }

  buildRing() {
    const last = this.sig.segs[this.sig.segs.length - 1];
    this.ringU = {uColor: {value: new THREE.Color()}, uOpacity: {value: 0}};
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({uniforms: this.ringU, vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false}));
    this.ring.position.copy(toWorld(last.c.x, last.c.y));
    this.ring.scale.setScalar(.01);
    this.rig.add(this.ring);
  }

  buildSVG() {
    const NS = 'http://www.w3.org/2000/svg';
    const s = this.svg = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', `0 0 ${SIG.view.w} ${SIG.view.h}`);
    s.setAttribute('aria-label', 'C.le.');
    s.style.cssText = 'position:absolute;pointer-events:none;overflow:visible';
    const g = this.svgInk = document.createElementNS(NS, 'g');
    this.sig.outline.forEach((d) => { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); g.appendChild(p); });
    s.appendChild(g);
    this.host.appendChild(s);
  }

  applyTheme() {
    const night = this.opt.night ?? document.documentElement.hasAttribute('data-pinkie-night');
    const pal = (PALETTES[this.opt.palette] || PALETTES.cle)[night ? 'night' : 'day'];
    this.u.uA.value.set(pal.a); this.u.uB.value.set(pal.b); this.u.uGlow.value.set(pal.glow);
    this.ringU.uColor.value.set(pal.glow);
    this.svgInk.setAttribute('fill', pal.ink);
    this.material.blending = pal.blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.material.needsUpdate = true;
    this.night = night;
  }

  resize() {
    if (this.disposed) return;
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 构图：签名 + 举起的羽毛笔都要入画
    const fitW = this.opt.fitW || 11.6, fitH = this.opt.fitH || 8.6, tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = Math.max(fitH / 2 / tan, fitW / 2 / tan / this.camera.aspect);
    this.camera.position.set(0, 0, dist);
    this.u.uFocus.value = dist;
    this.camera.updateProjectionMatrix();
    this.u.uScale.value = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * tan);
    this.placeSVG();
    if (!this.opt.manual) this.render();
  }

  // 让矢量签名与 z=0 平面上的粒子签名逐像素重合（交接时镜头已回正）
  placeSVG() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.camera.updateMatrixWorld();                   // 投影前必须刷新，否则用的是单位矩阵
    const a = toWorld(0, 0).project(this.camera), b = toWorld(SIG.view.w, SIG.view.h).project(this.camera);
    const x0 = (a.x + 1) / 2 * w, y0 = (1 - a.y) / 2 * h, x1 = (b.x + 1) / 2 * w, y1 = (1 - b.y) / 2 * h;
    Object.assign(this.svg.style, {left: x0 + 'px', top: y0 + 'px', width: (x1 - x0) + 'px', height: (y1 - y0) + 'px'});
    this.svgRect = {x: x0, y: y0, w: x1 - x0, h: y1 - y0, cw: w, ch: h};
  }

  set(state) {
    if (!(state in STATES) || state === this.state) return;
    const from = this.state;
    const u = this.u;
    this.state = state;
    this.stateStart = this.clock;
    gsap.killTweensOf([u.uMix, u.uAlpha, u.uSweep, u.uQuillOut, this.svg.style, this.ringU.uOpacity, this.ring.scale]);
    if (this.doneTL) { this.doneTL.kill(); this.doneTL = null; }

    const fromId = STATES[from] ?? STATES.done;      // 'idle-from-done' 等内部过渡态按落款处理
    if (state === 'idle') {                          // 粒子回到笔画里，再交还给矢量签名
      u.uFrom.value = fromId; u.uTo.value = 0; u.uMix.value = 0;
      gsap.to(u.uMix, {value: 1, duration: 1.1, ease: 'power2.inOut'});
      gsap.to(u.uAlpha, {value: 0, duration: .5, delay: 1.05});
      gsap.to(this.svg.style, {opacity: 1, duration: .5, delay: .95});
      return;
    }
    // 从签名出发：矢量淡出、粒子在原位显现 —— 看起来是签名本身溶解成粒子
    if (from === 'idle') u.uAlpha.value = 0;
    gsap.to(u.uAlpha, {value: 1, duration: .3, ease: 'power1.out'});
    gsap.to(this.svg.style, {opacity: 0, duration: .45, ease: 'power1.in'});
    u.uFrom.value = fromId;
    u.uTo.value = STATES[state];
    u.uMix.value = 0;
    u.uQuillOut.value = 0;
    u.uSweep.value = -1;
    gsap.to(u.uMix, {value: 1, duration: 1.25, ease: 'power2.inOut', delay: from === 'idle' ? .15 : 0});
    if (state === 'done') this.playDone();
  }

  /* 落款：快速签名 → 句点墨晕 → 光沿笔顺流过 → 羽毛化开 → 收拢为矢量签名 */
  playDone() {
    const u = this.u, signEnd = this.signTL.end + .55;
    const tl = this.doneTL = gsap.timeline({delay: signEnd});
    tl.set(this.ringU.uOpacity, {value: .9})
      .fromTo(this.ring.scale, {x: .05, y: .05}, {x: 1.6, y: 1.6, duration: .9, ease: 'power2.out'}, 0)
      .to(this.ringU.uOpacity, {value: 0, duration: .9, ease: 'power1.in'}, 0)
      .fromTo(u.uSweep, {value: -.05}, {value: 1.08, duration: 1.1, ease: 'power1.inOut'}, .1)
      .to(u.uQuillOut, {value: 1, duration: .9, ease: 'power2.inOut'}, .55)
      .add(() => { this.state = 'idle-from-done'; }, 1.4)
      .to(this.svg.style, {opacity: 1, duration: .5}, 1.45)
      .to(u.uAlpha, {value: 0, duration: .6}, 1.55)
      .add(() => { this.state = 'idle'; u.uFrom.value = 0; u.uTo.value = 0; u.uMix.value = 1; u.uQuillOut.value = 0; u.uSweep.value = -1; }, 2.2);
  }

  /* 笔顺 → 笔尖位置、笔压、已写进度 */
  penAt(tl, time) {
    const segs = this.sig.segs, t = isFinite(tl.period) ? time % tl.period : time;
    const st = tl.steps.find((s) => t < s.t1) || tl.steps[tl.steps.length - 1];
    const f = Math.min(1, Math.max(0, (t - st.t0) / (st.t1 - st.t0)));
    const ease = (x) => x * x * (3 - 2 * x);
    const point = (i, k) => {
      const s = segs[i];
      if (s.dot) return toWorld(s.c.x, s.c.y);
      const idx = Math.max(0, Math.min(s.pts.length - 1, Math.round(k * (s.pts.length - 1))));
      return toWorld(s.pts[idx].x, s.pts[idx].y);
    };
    const start = (i) => point(i, 0), end = (i) => point(i, 1), last = segs.length - 1;
    let pen, press = 1, write = 0, ink = 1;
    switch (st.kind) {
      case 'enter': pen = start(0); press = ease(f); break;
      case 'draw': {
        const s = segs[st.seg], k = ease(f) * .2 + f * .8;
        pen = point(st.seg, k); write = s.o0 + (s.o1 - s.o0) * k;
        press = .85 + .15 * Math.sin(f * Math.PI);
        break;
      }
      case 'dab': {
        const s = segs[st.seg];
        pen = start(st.seg); write = s.o0 + (s.o1 - s.o0) * ease(f);
        press = Math.sin(f * Math.PI) * 1.25;
        break;
      }
      case 'air': {
        pen = end(st.from).lerp(start(st.to), ease(f)); write = segs[st.from].o1;
        press = 1 - Math.sin(f * Math.PI) * 1.1;
        break;
      }
      case 'hold': pen = end(last); write = 1.02; press = Math.max(0, 1 - f * 3); break;
      case 'leave': pen = end(last).add(new THREE.Vector3(ease(f) * 1.2, ease(f) * .6, 0)); write = 1.02; press = 0; break;
      default: pen = end(last).add(new THREE.Vector3(1.2, .6, 0)).lerp(start(0), ease(f)); write = 1.02; press = 0; ink = 1 - ease(f);
    }
    return {pen, press: Math.max(0, press), write, ink};
  }

  update(dt) {
    this.clock += dt;
    const u = this.u, t = this.clock;
    u.uTime.value = t;
    const writing = this.state === 'write' || this.state === 'done' || u.uFrom.value === STATES.write;
    if (writing) {
      const tl = this.state === 'done' ? this.signTL : this.writeTL;
      const w = this.penAt(tl, Math.max(0, t - this.stateStart - .5));
      u.uPen.value.copy(w.pen);
      u.uPress.value = w.press;
      u.uWrite.value = w.write;
      u.uInk.value = w.ink;
      if (dt > 0) {
        const vx = (w.pen.x - this.penPrev.x) / dt, vy = (w.pen.y - this.penPrev.y) / dt, k = Math.min(1, dt * 8);
        this.drag.x += (Math.max(-1, Math.min(1, vx * .22)) - this.drag.x) * k;
        this.drag.y += (Math.max(-1, Math.min(1, vy * .22)) - this.drag.y) * k;
      }
      this.penPrev.copy(w.pen);
      u.uDrag.value.copy(this.drag);
    } else if (this.state !== 'idle-from-done') {
      u.uWrite.value = 1.1; u.uInk.value = 1;
    }
    // 工作中：镜头环绕 + 视差；回到签名：镜头回正（矢量交接需要正视）
    const calm = this.state === 'idle' || this.state === 'idle-from-done';
    const ry = calm ? 0 : Math.sin(t * .35) * .22 + this.pointer.x * .5;
    const rx = calm ? 0 : Math.sin(t * .27) * .07 + this.pointer.y * .3;
    const k = Math.min(1, dt * (calm ? 4 : 3));
    this.rig.rotation.y += (ry - this.rig.rotation.y) * k;
    this.rig.rotation.x += (rx - this.rig.rotation.x) * k;
  }

  render() { this.renderer.render(this.scene, this.camera); }

  loop() {
    if (this.raf || this.disposed || this.opt.manual || !this.visible || document.hidden) return;
    let last = performance.now();
    const tick = (now) => {
      this.raf = 0;
      if (this.disposed || !this.visible || document.hidden) return;
      const dt = Math.min(1 / 30, (now - last) / 1000); last = now;
      const night = document.documentElement.hasAttribute('data-pinkie-night');
      if (this.opt.night == null && night !== this.night) this.applyTheme();
      this.update(dt);
      // 静止的签名不必每帧渲染
      if (this.state !== 'idle' || this.u.uAlpha.value > .001 || gsap.isTweening(this.u.uMix)) this.render();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /* 确定性出帧（分镜）。done 的后半程由 GSAP 时间线驱动，这里按同样的时刻手动设定 */
  renderAt(state, time) {
    const u = this.u;
    this.state = state === 'idle' ? 'idle' : state;
    this.clock = 0; this.stateStart = 0;
    u.uFrom.value = 0; u.uTo.value = STATES[state];
    u.uMix.value = Math.min(1, Math.max(0, (time - .15) / 1.25));
    u.uAlpha.value = state === 'idle' ? 0 : Math.min(1, time / .3);
    u.uQuillOut.value = 0; u.uSweep.value = -1;
    this.ringU.uOpacity.value = 0;
    this.penPrev.copy(this.penAt(this.writeTL, 0).pen); this.drag.set(0, 0);
    const steps = Math.max(1, Math.round(time * 60));
    for (let k = 0; k < steps; k++) this.update(time / steps);
    if (state === 'done') {
      const d = time - (this.signTL.end + .55);
      if (d > 0) {
        const r = Math.min(1, d / .9);
        this.ring.scale.setScalar(.05 + 1.55 * (1 - Math.pow(1 - r, 2)));
        this.ringU.uOpacity.value = .9 * (1 - r);
        u.uSweep.value = Math.min(1.08, -.05 + 1.13 * Math.max(0, (d - .1) / 1.1));
        u.uQuillOut.value = Math.min(1, Math.max(0, (d - .55) / .9));
        if (d > 1.55) u.uAlpha.value = Math.max(0, 1 - (d - 1.55) / .6);
      }
    }
    this.render();
    return state === 'idle' || (state === 'done' && time > this.signTL.end + .55 + 1.45);
  }

  get svgMarkup() { return this.svg.outerHTML; }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.doneTL) this.doneTL.kill();
    gsap.killTweensOf([this.u.uMix, this.u.uAlpha, this.u.uSweep, this.u.uQuillOut, this.svg.style]);
    this.renderer.dispose();
    this.points.geometry.dispose();
    this.material.dispose();
    this.renderer.domElement.remove();
    this.svg.remove();
  }
}
