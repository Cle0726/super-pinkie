/* cle-space:v5 —— 「C.le.」签名 × 连笔粒子（渲染）
 *
 * 待机是一枚矢量签名（尖头笔的粗细对比 + 花式下划线）。开始工作时签名溶解为粒子，粒子按笔顺变成
 * 每一步的形状，步骤之间都是同一根墨线在变；工作结束由羽毛笔重新「落款」，再收拢回矢量签名。
 *
 *   laolao-cle-kit.js       签名拆笔、画笔
 *   laolao-cle-classic.js   原有形态：思考、读、写、改、落款
 *   laolao-cle-forms.js     其余每种步骤的形态，和「类别 → 形态」的表
 *   laolao-cle-ink.js       连笔引擎：衔接、打断、快步骤
 *   这个文件                three.js：镜头、点精灵、主题、矢量签名交接
 *
 * 依赖：window.CleSignature（cle-signature.js）。
 */
import * as THREE from './laolao-vendor-three.module.min.js';
import {CleInk} from './laolao-cle-ink.js';
import {formOf} from './laolao-cle-forms.js';
import {buildSignature, worldX, worldY} from './laolao-cle-kit.js';

const SIG = window.CleSignature;
const toWorld = (x, y) => new THREE.Vector3(worldX(x), worldY(y), 0);
const FRAME = 1 / 100;               // 120 / 240 Hz 的屏隔帧画（60–80 帧）：小标看不出差别，省一半以上 CPU

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
uniform float uSize, uScale, uFocus, uAlpha;
attribute vec4 aInk;                 // 发光、透明度、点大小、红
varying float vAlpha, vGlow, vRed;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.);
  float depth = -mv.z;
  float blur = abs(depth - uFocus) * .32;
  vGlow = aInk.x; vRed = aInk.w;
  gl_PointSize = uSize * aInk.z * uScale / depth * (1. + blur) * (1. + vGlow * .45);
  vAlpha = uAlpha * aInk.y / (1. + blur * 2.2);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */`
uniform vec3 uA, uB, uGlow, uRed;
varying float vAlpha, vGlow, vRed;
void main(){
  vec2 c = gl_PointCoord - .5;
  float d = length(c);
  if (d > .5 || vAlpha < .004) discard;
  float soft = smoothstep(.5, .05, d);
  vec3 col = mix(uB, uA, smoothstep(.5, .0, d));
  col = mix(col, uGlow, clamp(vGlow, 0., 1.));
  col = mix(col, uRed, vRed);
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

/* ───────────────────────── 主类 ───────────────────────── */
export class CleSpace {
  constructor(host, opt = {}) {
    this.host = host;
    this.opt = Object.assign({palette: 'cle', count: 3400, night: null, interactive: true, manual: false}, opt);
    this.state = 'idle';
    this.clock = 0;
    this.pointer = new THREE.Vector2();
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const r = this.renderer = new THREE.WebGLRenderer({alpha: true, antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: !!opt.preserve});
    r.setPixelRatio((window.PinkieTuning ? window.PinkieTuning.pixelRatio(2) : Math.min(2, window.devicePixelRatio || 1)));
    r.setClearColor(0x000000, 0);
    host.appendChild(r.domElement);
    r.domElement.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 2, .1, 100);
    this.rig = new THREE.Group();
    this.scene.add(this.rig);

    this.buildSignature();
    this.buildParticles();
    this.buildRing();
    this.buildSVG();
    this.applyTheme();
    this.resize();

    if ('ResizeObserver' in window) (this.sized = new ResizeObserver(() => this.resize())).observe(host);
    if (this.opt.interactive) {
      host.addEventListener('pointermove', (e) => {
        const b = host.getBoundingClientRect();
        this.pointer.set((e.clientX - b.left) / b.width - .5, (e.clientY - b.top) / b.height - .5);
      });
      host.addEventListener('pointerleave', () => this.pointer.set(0, 0));
    }
    this.visible = true;
    if ('IntersectionObserver' in window) {
      (this.seen = new IntersectionObserver((es) => { this.visible = es[es.length - 1].isIntersecting; this.loop(); })).observe(host);
    }
    this.wake = () => this.loop();
    document.addEventListener('visibilitychange', this.wake);
    if (!this.opt.manual) this.loop();
  }

  // 粒子和矢量轮廓共用浏览器量出来的同一份中心线，交接才逐像素重合
  buildSignature() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
    document.body.appendChild(svg);
    this.sig = buildSignature(SIG, (s) => SIG.centerline(s, svg, .5));
    this.sig.outline = SIG.outline(svg);
    svg.remove();
  }

  buildParticles() {
    const ink = this.ink = new CleInk({SIG, sig: this.sig, count: this.opt.count, random: this.opt.random});
    const g = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(ink.position, 3).setUsage(THREE.DynamicDrawUsage);
    this.look = new THREE.BufferAttribute(ink.look, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.position);
    g.setAttribute('aInk', this.look);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 9);

    this.u = {
      uSize: {value: this.opt.size || .066}, uScale: {value: 600}, uFocus: {value: 13}, uAlpha: {value: 0},
      uA: {value: new THREE.Color()}, uB: {value: new THREE.Color()}, uGlow: {value: new THREE.Color()}, uRed: {value: new THREE.Color('#e5484d')},
    };
    this.material = new THREE.ShaderMaterial({uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false});
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.rig.add(this.points);
  }

  buildRing() {
    this.ringU = {uColor: {value: new THREE.Color()}, uOpacity: {value: 0}};
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({uniforms: this.ringU, vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false}));
    this.ring.position.set(this.ink.ringAt.x, this.ink.ringAt.y, 0);
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
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;                              // 正被重绘摘下来：保留原来的尺寸，接回去时不闪
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

  /** kind：状态行的步骤类别（think / search / git …），或 done / idle。 */
  set(kind, how) {
    const form = formOf(kind);
    if (this.ink.set(form, how)) this.state = form;
  }

  update(dt) {
    this.clock += dt;
    const ink = this.ink, fx = ink.fx, t = this.clock;
    ink.step(dt);
    this.position.needsUpdate = this.look.needsUpdate = true;
    this.u.uAlpha.value = fx.alpha;
    this.svg.style.opacity = fx.paper;
    this.ringU.uOpacity.value = fx.ringAlpha;
    this.ring.scale.setScalar(fx.ring);
    // 落款播完，引擎自己回到待机
    if (!ink.next && ink.form === 'idle') this.state = 'idle';
    // 工作中：镜头环绕 + 视差；回到签名：镜头回正（矢量交接需要正视）
    const calm = ink.goal === 'idle' || (ink.goal === 'done' && (fx.paper > 0 || fx.ringAlpha > 0));
    const ry = calm ? 0 : Math.sin(t * .35) * .22 + this.pointer.x * .5;
    const rx = calm ? 0 : Math.sin(t * .27) * .07 + this.pointer.y * .3;
    const k = Math.min(1, dt * (calm ? 6 : 3));
    this.rig.rotation.y += (ry - this.rig.rotation.y) * k;
    this.rig.rotation.x += (rx - this.rig.rotation.x) * k;
  }

  render() { this.renderer.render(this.scene, this.camera); }

  loop() {
    if (this.raf || this.disposed || this.opt.manual || !this.visible || document.hidden) return;
    let last = performance.now(), drawn = false;
    const tick = (now) => {
      this.raf = 0;
      if (this.disposed || !this.visible || document.hidden) return;
      const dt = (now - last) / 1000;
      if (dt >= FRAME) {
        last = now;
        const night = document.documentElement.hasAttribute('data-pinkie-night');
        if (this.opt.night == null && night !== this.night) this.applyTheme();
        this.update(Math.min(1 / 20, dt));
        // 静止的签名不必每帧渲染：粒子淡完再补一帧空画面就停
        const busy = this.ink.fx.alpha > 0 || this.ink.goal !== 'idle';
        if (busy || drawn) this.render();
        drawn = busy;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  get svgMarkup() { return this.svg.outerHTML; }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.sized?.disconnect();
    this.seen?.disconnect();
    document.removeEventListener('visibilitychange', this.wake);
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch {}   // 上下文当场还给显卡，不等垃圾回收
    this.points.geometry.dispose();
    this.material.dispose();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.renderer.domElement.remove();
    this.svg.remove();
  }
}
