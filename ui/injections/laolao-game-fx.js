/* 碧琪上岸记 · 游戏特效引擎（window.__pinkieGameFx）
   - 一个 WebGL 上下文（Three.js r185，本地打包），GPU 实例化粒子：每颗粒子的轨迹在顶点着色器里按出生时间解析计算，CPU 每帧只改一个 uniform。
   - 22 种粒子（形状全部是片元着色器里的 SDF，不用贴图）、9 种大招过场、顿帧、震屏、辉光 / 景深。
   - 没东西在播时零 rAF；页面隐藏立刻停（画面和声音）。
   - 只认用户自己的「游戏特效」设置；不看内存 / GPU / 系统设置。唯一例外：WebGL 真起不来时退回 DOM 平面版。 */
(() => {
  'use strict';
  if (window.__pinkieGameFx) return;
  const BASE = new URL('.', document.currentScript?.src || location.href).href;
  const KEY = 'pinkie.gamefx.v1', MOTION_KEY = 'pinkie.motion.reduce.v1', SOUND_KEY = 'pinkie.study.sound.v1';

  // ───────────────────────── 设置 ─────────────────────────
  const TIERS = {
    cinematic: {label: '电影级', density: 1, bloom: 1, dof: true, shake: 1, hitstop: true, cine: 'full', biqi: true, book: '3d', fps: 0, res: 1, volume: .8},
    lush: {label: '华丽', density: .7, bloom: .7, dof: false, shake: .8, hitstop: true, cine: 'full', biqi: true, book: '3d', fps: 60, res: .85, volume: .7},
    standard: {label: '标准', density: .45, bloom: .35, dof: false, shake: .6, hitstop: true, cine: 'short', biqi: true, book: '3d', fps: 60, res: .75, volume: .6},
    quiet: {label: '安静', density: 0, bloom: 0, dof: false, shake: 0, hitstop: false, cine: 'off', biqi: false, book: 'flat', fps: 30, res: .5, volume: .4},
  };
  const TIER_ORDER = ['cinematic', 'lush', 'standard', 'quiet'];
  const FIELDS = ['density', 'bloom', 'dof', 'shake', 'hitstop', 'cine', 'biqi', 'book', 'fps', 'res', 'volume'];
  const read = () => { try { const raw = JSON.parse(localStorage.getItem(KEY) || 'null'); if (raw && typeof raw === 'object') return raw; } catch { /* 缺省电影级 */ } return {}; };
  const reducedMotion = () => { try { if (localStorage.getItem(MOTION_KEY) === '1') return true; } catch { /* 读不到就当没开 */ } return document.documentElement.dataset.pinkieReduceMotion === '1'; };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function sanitize(field, v) {
    const base = TIERS.cinematic[field];
    if (typeof base === 'boolean') return Boolean(v);
    if (field === 'cine') return ['full', 'short', 'off'].includes(v) ? v : undefined;
    if (field === 'book') return v === 'flat' ? 'flat' : v === '3d' ? '3d' : undefined;
    if (field === 'fps') return [0, 30, 60].includes(Number(v)) ? Number(v) : undefined;
    const n = Number(v); if (!Number.isFinite(n)) return undefined;
    return field === 'res' ? clamp(n, .5, 1) : clamp(n, 0, 1);
  }
  let forcedTier = '';
  function settings() {
    const raw = read(), tier = forcedTier || (TIERS[raw.tier] ? raw.tier : 'cinematic');
    const out = {...TIERS[tier], tier, custom: {}, reduced: false};
    if (!forcedTier) for (const f of FIELDS) { const v = sanitize(f, raw.custom?.[f]); if (v !== undefined && v !== TIERS[tier][f]) { out[f] = v; out.custom[f] = v; } }
    if (reducedMotion()) { Object.assign(out, TIERS.quiet, {tier: 'quiet', custom: {}, reduced: true}); }
    out.label = TIERS[out.tier].label;
    return out;
  }
  function save(next) {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 私密窗口等：本次会话照样生效 */ memo = next; }
    applySettings(); window.dispatchEvent(new CustomEvent('pinkie:gamefx-settings', {detail: settings()}));
  }
  let memo = null;
  function setTier(tier) { if (!TIERS[tier]) return settings(); save({tier, custom: {}}); return settings(); }
  function setCustom(field, value) { const raw = read(); const tier = TIERS[raw.tier] ? raw.tier : 'cinematic'; const v = sanitize(field, value); if (v === undefined) return settings(); save({tier, custom: {...(raw.custom || {}), [field]: v}}); return settings(); }

  // ───────────────────────── 粒子种类 ─────────────────────────
  // shape = 片元着色器里的形状编号；add = 叠加发光；g = 重力（px/s²，正 = 往下）；drag = 空气阻力；sp = 初速；life = 寿命（s）；size = 直径（px）；spin = 转速；fl = 左右飘 [幅度 px, 频率]
  const P = (shape, add, g, drag, sp, life, size, spin, fl, colors, count, extra = {}) => ({shape, add, g, drag, sp, life, size, spin, fl, colors, count, ...extra});
  const KINDS = {
    sparkle: P([20], 1, 60, 2.2, [220, 620], [.5, 1.1], [10, 26], [-2, 2], [0, 0], ['#fff6c8', '#ffd1ec', '#ffffff'], 70),
    stars: P([1], 1, 380, 1.4, [260, 760], [.7, 1.3], [12, 30], [-5, 5], [0, 0], ['#ffd34d', '#ffe9a3', '#ff8ac4'], 60),
    confetti: P([2], 0, 520, 1.6, [380, 980], [1.4, 2.4], [9, 16], [-9, 9], [18, 5], ['#DB1F74', '#ffd34d', '#57c7ff', '#7fe0a8', '#b58cff'], 90),
    petals: P([3], 0, 70, 1.8, [120, 420], [2, 3.4], [12, 22], [-2.5, 2.5], [40, 2.2], ['#ffc2dc', '#ff9ec7', '#fff0f6'], 60),
    hearts: P([4], 0, -90, 1.6, [160, 460], [1.2, 2], [14, 30], [-1.2, 1.2], [16, 3], ['#ff4f9a', '#ff86b8', '#ffd1e4'], 40),
    ink: P([5], 0, 40, 3.2, [120, 420], [.9, 1.6], [12, 34], [-.6, .6], [0, 0], ['#2b1d27', '#4a3343', '#1a1a2e'], 36, {grow: 1}),
    crystal: P([6], 1, 260, 1.5, [260, 700], [.8, 1.5], [12, 28], [-4, 4], [0, 0], ['#9fe8ff', '#d4b8ff', '#ffffff'], 50),
    bubbles: P([7], 0, -160, 1.1, [80, 300], [1.4, 2.6], [12, 34], [0, 0], [22, 2.6], ['#bfefff', '#e4d8ff', '#ffffff'], 36),
    snow: P([8], 0, 60, 1.2, [60, 260], [2.2, 3.6], [10, 22], [-1, 1], [26, 1.6], ['#ffffff', '#e6f4ff', '#cfe6ff'], 60),
    embers: P([9], 1, -260, 1.3, [120, 520], [.8, 1.8], [5, 12], [0, 0], [14, 6], ['#ff9a3c', '#ffd25e', '#ff5a3c'], 70),
    notes: P([10], 0, -120, 1.4, [140, 420], [1.3, 2.2], [16, 28], [-1, 1], [20, 3], ['#DB1F74', '#7a4cff', '#2aa8ff'], 30),
    cards: P([11], 0, 420, 1.3, [300, 820], [1.4, 2.2], [20, 34], [-6, 6], [10, 3], ['#ffffff', '#ffe3ef', '#fff6d8'], 30),
    smoke: P([12], 0, -60, 2.4, [40, 200], [1.2, 2.2], [40, 110], [-.4, .4], [10, 1], ['#d9cfd6', '#bfb4c0', '#efe8ee'], 24, {grow: 1.6}),
    gold: P([20, 13], 1, 520, 1.4, [280, 800], [.9, 1.6], [10, 22], [-6, 6], [0, 0], ['#ffd34d', '#ffb800', '#fff1b0'], 70),
    leaves: P([14], 0, 90, 1.7, [120, 420], [2, 3.2], [14, 26], [-3, 3], [44, 1.8], ['#7fbf5a', '#c9a227', '#e0782f'], 44),
    lightning: P([15], 1, 0, 6, [40, 160], [.18, .4], [26, 56], [0, 0], [0, 0], ['#d8f1ff', '#9fd5ff', '#ffffff'], 16),
    neon: P([16], 1, 0, 2.6, [200, 700], [.5, 1.1], [14, 50], [0, 0], [0, 0], ['#ff3fd1', '#3ff3ff', '#b3ff3f'], 30, {grow: 1.2}),
    bats: P([17], 0, -40, 1.2, [180, 520], [1.3, 2.1], [18, 30], [-.3, .3], [30, 8], ['#3a2438', '#5b2a5a', '#2a1a33'], 26),
    gears: P([18], 0, 520, 1.4, [260, 720], [1.2, 2], [16, 34], [-5, 5], [0, 0], ['#c9a24a', '#a0a7b4', '#e2c27a'], 30),
    feathers: P([19], 0, 50, 2.2, [120, 380], [2.2, 3.4], [18, 34], [-1.6, 1.6], [46, 1.4], ['#ffffff', '#fff1f8', '#f2e9ff'], 30),
    coins: P([13], 0, 760, 1.1, [380, 900], [1.1, 1.8], [16, 26], [-8, 8], [0, 0], ['#ffd34d', '#ffbf1f', '#fff0a8'], 40),
    steam: P([21], 0, -180, 2, [40, 160], [1.1, 2], [30, 80], [-.3, .3], [12, 2], ['#ffffff', '#f2f2f7', '#e9eef5'], 26, {grow: 1.4}),
  };
  const PRESETS = ['burst', 'slash', 'spell', 'curtain', 'ink', 'warp', 'rain', 'stamp', 'beam'];
  const PRESET_LABEL = {burst: '推镜爆发', slash: '斩击', spell: '魔法阵', curtain: '舞台幕布', ink: '水墨晕开', warp: '星空跃迁', rain: '从天而降', stamp: '盖章砸下', beam: '光束'};

  // ───────────────────────── 运行状态 ─────────────────────────
  const stats = {frames: 0, rafActive: false, lastFrameAt: 0, contexts: 0, fallback: false, frameTimes: []};
  const st = {THREE: null, loading: null, renderer: null, canvas: null, layer: null, w: 1, h: 1, dpr: 1, raf: 0, last: 0, time: 0, hitUntil: 0, aliveUntil: 0,
    meshes: {}, cine: null, cineQueue: Promise.resolve(), scenes: new Map(), active: null, composer: null, bloomPass: null, outputPass: null, renderPass: null, addons: null, hidden: false, lastDraw: 0};
  const sceneFactories = new Map();
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = list => list[Math.floor(Math.random() * list.length)];

  function layer() {
    if (st.layer?.isConnected) return st.layer;
    const n = document.createElement('div'); n.className = 'pk-gamefx-layer'; n.setAttribute('aria-hidden', 'true');
    document.body.append(n); st.layer = n; return n;
  }
  function loadThree() {
    if (st.THREE) return Promise.resolve(st.THREE);
    if (stats.fallback) return Promise.resolve(null);
    return st.loading ||= (async () => {
      try {
        const THREE = await import(BASE + 'laolao-vendor-three.module.min.js');
        const probe = document.createElement('canvas');
        const gl = probe.getContext('webgl2', {failIfMajorPerformanceCaveat: false});
        if (!gl) throw Error('no webgl2');
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        st.THREE = THREE; return THREE;
      } catch (error) { stats.fallback = true; stats.fallbackReason = String(error?.message || error); return null; }
    })();
  }
  function loadAddons() { return st.addons ||= import(BASE + 'laolao-vendor-three-addons.module.min.js').catch(() => null); }

  // ───────────────────────── 着色器 ─────────────────────────
  const PARTICLE_VS = `
    attribute vec2 aP0; attribute vec2 aVel; attribute vec4 aTime; attribute vec3 aColor; attribute vec4 aMot; attribute vec4 aRot;
    uniform float uTime; uniform vec2 uRes; uniform vec2 uShake; uniform float uAdd;
    varying vec2 vUv; varying vec3 vColor; varying float vAlpha; varying float vShape; varying float vLife; varying float vSeed;
    void main(){
      float t = uTime - aTime.x; float life = aTime.y;
      if (t < 0.0 || t > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      float k = aMot.y; float dt = k > 0.001 ? (1.0 - exp(-k * t)) / k : t;
      vec2 p = aP0 + aVel * dt + vec2(0.0, 0.5 * aMot.x * t * t);
      p.x += aMot.z * sin(aMot.w * t + aRot.w * 6.2831);
      float u = t / life;
      float grow = smoothstep(0.0, 0.07, u) * (1.0 + aRot.z * u) * (1.0 - smoothstep(0.75, 1.0, u) * 0.55);
      float ang = aRot.x + aRot.y * t;
      vec2 q = position.xy;
      float shape = aTime.z;
      if (shape > 1.5 && shape < 2.5 || shape > 10.5 && shape < 11.5 || shape > 12.5 && shape < 13.5) q.x *= mix(0.25, 1.0, abs(cos(ang * 1.3 + aRot.w * 3.0)));
      if (shape > 14.5 && shape < 15.5) q.y *= 2.2;
      if (shape > 20.5) q.y *= 1.5;
      float c = cos(ang), s = sin(ang);
      q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
      p += q * aTime.w * grow * (uAdd > 0.5 ? 1.7 : 1.0) + uShake;
      gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
      vUv = position.xy * 2.0; vColor = aColor; vShape = shape; vLife = u; vSeed = aRot.w;
      vAlpha = 1.0 - smoothstep(0.62, 1.0, u);
    }`;
  const PARTICLE_FS = `
    precision highp float;
    uniform float uGlow; uniform float uAdd;
    varying vec2 vUv; varying vec3 vColor; varying float vAlpha; varying float vShape; varying float vLife; varying float vSeed;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
    float sdStar(vec2 p, float r, float rf){ const vec2 k1 = vec2(0.809016994375, -0.587785252292); const vec2 k2 = vec2(-k1.x, k1.y);
      p.x = abs(p.x); p -= 2.0*max(dot(k1,p),0.0)*k1; p -= 2.0*max(dot(k2,p),0.0)*k2; p.x = abs(p.x); p.y -= r;
      vec2 ba = rf*vec2(-k1.y,k1.x) - vec2(0,1); float h = clamp(dot(p,ba)/dot(ba,ba), 0.0, r); return length(p-ba*h) * sign(p.y*ba.x-p.x*ba.y); }
    float sdHeart(vec2 p){ p.y = -p.y + 0.55; p.x = abs(p.x); p *= 1.25;
      if (p.y + p.x > 1.0) return sqrt(dot(p - vec2(0.25, 0.75), p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
      return sqrt(min(dot(p - vec2(0.0, 1.0), p - vec2(0.0, 1.0)), dot(p - 0.5 * max(p.x + p.y, 0.0), p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y); }
    float box(vec2 p, vec2 b, float r){ vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
    float seg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h); }
    void main(){
      vec2 p = vUv * (uAdd > 0.5 ? 1.7 : 1.0); float r = length(p); float d = 1.0; float shade = 1.0; float glowBoost = 0.0; vec3 col = vColor;
      int s = int(vShape + 0.5);
      if (s == 0) { d = r - 0.8; }
      else if (s == 1) { d = sdStar(p * 1.05, 0.82, 0.45); shade = 1.0 - 0.25 * smoothstep(-0.4, 0.4, p.x + p.y); glowBoost = 0.4; }
      else if (s == 2) { d = box(p, vec2(0.62, 0.95), 0.08); shade = 0.8 + 0.2 * sin(vLife * 30.0 + vSeed * 9.0); }
      else if (s == 3) { vec2 q = p; q.x *= 1.7; d = length(q - vec2(0.0, 0.15)) - 0.75 + 0.35 * max(0.0, -p.y); shade = 0.85 + 0.15 * (1.0 - r); col = mix(col, vec3(1.0), 0.25 * (1.0 - r)); }
      else if (s == 4) { d = sdHeart(p * 1.15); shade = 1.0 - 0.2 * smoothstep(-0.3, 0.6, p.x - p.y); col = mix(col, vec3(1.0), 0.35 * smoothstep(0.35, 0.0, length(p - vec2(-0.3, -0.25)))); }
      else if (s == 5) { float n = noise(p * 3.0 + vSeed * 17.0) * 0.45 + noise(p * 7.0 - vSeed * 5.0) * 0.2; d = r - 0.55 - n * 0.5; shade = 0.75 + 0.35 * n; }
      else if (s == 6) { vec2 q = abs(p); d = (q.x * 1.6 + q.y) - 0.95; shade = p.x > 0.0 ? (p.y > 0.0 ? 0.7 : 1.0) : (p.y > 0.0 ? 0.85 : 1.15); glowBoost = 0.5; }
      else if (s == 7) { d = abs(r - 0.72) - 0.08; float hl = smoothstep(0.28, 0.0, length(p - vec2(-0.3, -0.32))); col = mix(col, vec3(1.0), 0.6); shade = 0.7 + hl * 2.0; d = min(d, length(p - vec2(-0.3, -0.32)) - 0.14); }
      else if (s == 8) { float a = atan(p.y, p.x); float arm = abs(sin(a * 3.0)); d = min(abs(r * sin(mod(a, 1.0472) - 0.5236)) - 0.07, 9.0); d = max(d, r - 0.92); d = min(d, r - 0.2); float br = abs(fract(r * 3.0) - 0.5); d = min(d, max(abs(r*sin(mod(a,1.0472)-0.5236)) - 0.22 * step(0.35, r) * step(br, 0.12), r - 0.8)); }
      else if (s == 9) { d = r - 0.55; glowBoost = 1.4; col = mix(col, vec3(1.0, 0.95, 0.8), smoothstep(0.4, 0.0, r)); }
      else if (s == 10) { d = min(length((p - vec2(-0.25, 0.45)) * vec2(1.0, 1.35)) - 0.3, box(p - vec2(0.03, -0.1), vec2(0.07, 0.6), 0.03)); d = min(d, seg(p, vec2(0.05, -0.7), vec2(0.45, -0.35)) - 0.09); }
      else if (s == 11) { d = box(p, vec2(0.62, 0.88), 0.14); float inner = sdHeart((p - vec2(0.0, 0.0)) * 3.4) / 3.4; float border = abs(box(p, vec2(0.52, 0.78), 0.1)) - 0.025; if (inner < 0.0) col = vec3(0.86, 0.12, 0.45); if (border < 0.0) col = mix(col, vec3(0.86, 0.12, 0.45), 0.6); shade = 1.0; }
      else if (s == 12) { float n = noise(p * 2.2 + vSeed * 11.0 + vLife * 1.5); d = r - 0.55 - n * 0.4; shade = 0.9; }
      else if (s == 13) { d = r - 0.88; float rim = smoothstep(0.62, 0.7, r); float shine = smoothstep(0.25, 0.0, abs(p.x + p.y * 0.6 - 0.2 + sin(vLife * 8.0) * 0.5)); col = mix(col, col * 0.72, rim); col = mix(col, vec3(1.0, 0.98, 0.85), shine * 0.8); glowBoost = 0.35; }
      else if (s == 14) { vec2 q = p; q.x *= 2.0; d = length(q) - 0.95 + 0.25 * abs(p.y); float rib = smoothstep(0.06, 0.0, abs(p.x)); col = mix(col, col * 0.65, rib); }
      else if (s == 15) { vec2 q = p * vec2(1.0, 1.0); float zz = abs(q.x - 0.35 * sign(sin(q.y * 4.5)) * fract(q.y * 2.25)); d = max(zz - 0.12 * (1.0 - abs(q.y)), abs(q.y) - 0.95); glowBoost = 0.8; col = mix(col, vec3(1.0), 0.35); }
      else if (s == 16) { d = abs(r - 0.7) - 0.06; glowBoost = 0.9; }
      else if (s == 17) { vec2 q = vec2(abs(p.x), p.y); float wing = q.y - 0.35 * sin(q.x * 6.0 + 1.2) * smoothstep(0.1, 0.9, q.x) + 0.12; d = max(max(-wing, q.y - 0.3 + 0.4 * q.x), q.x - 0.95); d = min(d, length(p * vec2(1.4, 1.0)) - 0.22); }
      else if (s == 18) { float a = atan(p.y, p.x); float teeth = smoothstep(-0.2, 0.2, sin(a * 8.0)) * 0.16; d = max(r - 0.68 - teeth, 0.24 - r); shade = 0.75 + 0.35 * (1.0 - r); }
      else if (s == 19) { vec2 q = p; q.x *= 2.6; float sp = length(q) - 0.95; float barbs = 0.5 + 0.5 * sin(p.y * 40.0 + sign(p.x) * 2.0); d = sp + barbs * 0.06 * smoothstep(0.0, 0.3, abs(p.x)); float rachis = smoothstep(0.05, 0.0, abs(p.x)); col = mix(col, col * 0.8, rachis); }
      else if (s == 20) { float a = abs(p.x) * abs(p.y); d = min(abs(p.x) + abs(p.y) * 6.0, abs(p.y) + abs(p.x) * 6.0) - 0.9; d = min(d, r - 0.18); glowBoost = 1.2; col = mix(col, vec3(1.0), 0.4); }
      else { float n = noise(p * 2.6 + vec2(vSeed * 7.0, -vLife * 2.0)); d = length(p * vec2(1.0, 0.7)) - 0.5 - n * 0.4; shade = 0.95; }
      float aa = fwidth(d) * 1.2 + 0.015;
      float soft = (s == 12 || s == 21) ? smoothstep(0.45, -0.6, d) * 0.55 : smoothstep(aa, -aa, d);
      // 发光种类：实心部分正常叠（浅色纸面上也看得清），光晕只加亮、不遮挡，并收在圆形窗口里（不会露出方块边）。
      float win = smoothstep(1.7, 1.1, r);
      float glow = uAdd > 0.5 ? uGlow * (0.22 + glowBoost) * exp(-max(d, 0.0) * 3.2) * win : 0.0;
      float core = soft * vAlpha;
      vec3 c = col * shade;
      gl_FragColor = vec4(c * core + mix(c, vec3(1.0), 0.35) * glow * vAlpha * 0.85, core);
    }`;
  // 大招过场：一张全屏四边形把背景、立绘、遮罩、光效一次画完；粒子在它上面再画一层。
  const CINE_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const CINE_FS = `
    precision highp float;
    uniform float uT; uniform float uTime; uniform int uPreset; uniform vec2 uRes; uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2;
    uniform sampler2D uArt; uniform float uArtOk; uniform float uArtAspect; uniform float uDof; uniform float uFade;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
    float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
    float ease(float x){ x = clamp(x, 0.0, 1.0); return 1.0 - pow(1.0 - x, 3.0); }
    float back(float x){ x = clamp(x, 0.0, 1.0); float c1 = 1.70158, c3 = c1 + 1.0; return 1.0 + c3 * pow(x - 1.0, 3.0) + c1 * pow(x - 1.0, 2.0); }
    vec4 art(vec2 uv, float scale, vec2 off, float blur){
      float screenAspect = uRes.x / uRes.y; vec2 q = uv - 0.5; q /= scale; q -= off;
      if (uArtAspect > screenAspect) q.x *= screenAspect / uArtAspect; else q.y *= uArtAspect / screenAspect;
      q += 0.5;
      if (uArtOk < 0.5) { float g = smoothstep(0.9, 0.0, length(q - 0.5)); vec3 c = mix(uC1, uC0, g); float star = smoothstep(0.02, 0.0, abs(length(q - 0.5) - 0.28 - 0.04 * sin(atan(q.y - 0.5, q.x - 0.5) * 5.0))); return vec4(c + star * 0.8, 1.0); }
      if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec4(0.0);
      vec4 c = texture2D(uArt, q);
      if (blur > 0.001) { vec4 acc = c; float b = blur * 0.006; acc += texture2D(uArt, q + vec2(b, 0.0)); acc += texture2D(uArt, q - vec2(b, 0.0)); acc += texture2D(uArt, q + vec2(0.0, b)); acc += texture2D(uArt, q - vec2(0.0, b));
        acc += texture2D(uArt, q + vec2(b, b) * 0.7); acc += texture2D(uArt, q - vec2(b, b) * 0.7); acc += texture2D(uArt, q + vec2(b, -b) * 0.7); acc += texture2D(uArt, q + vec2(-b, b) * 0.7); c = acc / 9.0; }
      return c;
    }
    void main(){
      vec2 uv = vUv; float aspect = uRes.x / uRes.y; vec2 p = (uv - 0.5) * vec2(aspect, 1.0); float r = length(p); float ang = atan(p.y, p.x);
      float T = uT; vec3 col = vec3(0.0); float tilt = uDof * smoothstep(0.18, 0.5, abs(uv.y - 0.52));
      if (uPreset == 0) { // burst 推镜爆发
        float rays = pow(0.5 + 0.5 * sin(ang * 22.0 + uTime * 2.5), 6.0) * smoothstep(1.2, 0.0, r);
        col = mix(uC1 * 0.35, uC0, smoothstep(1.1, 0.0, r)) + rays * uC2 * 1.2 * ease(T * 4.0);
        vec4 a = art(uv, mix(1.35, 1.04, ease(T * 2.2)) + 0.03 * sin(uTime * 3.0) * (1.0 - T), vec2(0.0), tilt * 2.0);
        col = mix(col, a.rgb, a.a * ease(T * 5.0));
        col += vec3(1.0) * smoothstep(0.12, 0.0, T) * 1.2;
      } else if (uPreset == 1) { // slash 斩击
        float cut = dot(p, normalize(vec2(1.0, 0.55)));
        float sweep = mix(-1.4, 1.4, ease((T - 0.05) * 5.0));
        float line = exp(-abs(p.y * 0.9 - p.x * 0.5) * 60.0) * step(cut, sweep) * smoothstep(0.55, 0.2, T);
        float speed = pow(fract(dot(p, vec2(0.48, -0.88)) * 9.0 + uTime * 6.0 + hash(floor(p * 12.0))), 18.0) * 0.5;
        col = mix(vec3(0.06, 0.02, 0.07), uC1 * 0.5, smoothstep(1.2, 0.0, r)) + speed * uC2;
        float split = (1.0 - ease((T - 0.25) * 3.0)) * 0.06; float side = sign(p.y * 0.9 - p.x * 0.5);
        vec4 a = art(uv + vec2(split * side, -split * side * 0.5), 1.08, vec2(0.0), tilt * 2.0);
        col = mix(col, a.rgb, a.a * smoothstep(0.15, 0.32, T));
        col += (uC2 + vec3(0.6)) * line * 3.0;
      } else if (uPreset == 2) { // spell 魔法阵
        col = mix(vec3(0.05, 0.02, 0.12), uC1 * 0.4, smoothstep(1.3, 0.0, r));
        float grow = back(T * 2.2); float rr = r / max(0.001, grow);
        float rot = uTime * 0.8; float a2 = ang + rot;
        float ring = smoothstep(0.012, 0.0, abs(rr - 0.42)) + smoothstep(0.008, 0.0, abs(rr - 0.36)) + smoothstep(0.01, 0.0, abs(rr - 0.2));
        float runes = smoothstep(0.02, 0.0, abs(rr - 0.39)) * step(0.55, fract(a2 * 6.0)) * step(0.25, hash(vec2(floor(a2 * 6.0 / 1.0), 3.0)));
        float star = 0.0; for (int i = 0; i < 6; i++) { float th = float(i) * 1.0472 - rot * 0.6; vec2 dir = vec2(cos(th), sin(th)); star += smoothstep(0.008, 0.0, abs(dot(p / max(0.001, grow), vec2(-dir.y, dir.x)) - 0.0) ) * step(abs(dot(p / max(0.001, grow), dir)), 0.36); }
        float magic = (ring + runes + star * 0.5) * step(rr, 0.45) * 0.62;
        vec4 a = art(uv, mix(0.9, 1.02, ease(T * 1.6)), vec2(0.0), tilt * 2.0);
        col = mix(col, a.rgb, a.a * smoothstep(0.25, 0.55, T) * 0.92);
        col += magic * mix(uC0, vec3(1.0), 0.4) * 1.6 * (1.0 - smoothstep(0.75, 1.0, T) * 0.6);
      } else if (uPreset == 3) { // curtain 舞台幕布 + 聚光
        float open = ease((T - 0.12) * 2.4) * 0.52; float edge = abs(uv.x - 0.5);
        float folds = 0.5 + 0.5 * sin(uv.x * 70.0 + sin(uv.y * 3.0) * 2.0); vec3 velvet = mix(vec3(0.35, 0.02, 0.08), vec3(0.75, 0.08, 0.2), folds) * (0.6 + 0.4 * uv.y);
        float spot = smoothstep(0.75, 0.0, length((uv - vec2(0.5, 0.45)) * vec2(aspect * 0.8, 1.0)));
        vec4 a = art(uv, 1.02, vec2(0.0), tilt * 2.0);
        vec3 stage = mix(vec3(0.03, 0.02, 0.04), a.rgb, a.a) * (0.25 + 1.1 * spot);
        stage += vec3(1.0, 0.95, 0.8) * spot * 0.15 * (0.5 + 0.5 * noise(uv * 30.0 + uTime));
        col = edge < open ? stage : velvet;
        col *= 1.0 - 0.35 * smoothstep(0.03, 0.0, abs(edge - open));
        col = mix(col, uC1 * 0.25, smoothstep(0.85, 1.0, uv.y) * 0.6);
      } else if (uPreset == 4) { // ink 水墨晕开
        vec3 paper = vec3(0.965, 0.93, 0.9) * (0.92 + 0.08 * fbm(uv * 8.0));
        float spread = ease(T * 1.8) * 1.25; float n = fbm(p * 3.0 + 4.0);
        float mask = smoothstep(spread, spread - 0.12, r + n * 0.45);
        vec4 a = art(uv, 1.03, vec2(0.0), tilt * 2.0);
        float lum = dot(a.rgb, vec3(0.3, 0.59, 0.11)); vec3 wash = mix(vec3(0.15, 0.1, 0.13), a.rgb, 0.45 + 0.55 * smoothstep(0.4, 1.0, T));
        col = mix(paper, mix(paper, wash, a.a), mask);
        float rim = smoothstep(0.08, 0.0, abs(r + n * 0.45 - spread)) * (1.0 - T);
        col = mix(col, vec3(0.1, 0.06, 0.09), rim * 0.8);
        col = mix(col, uC0 * 0.9, smoothstep(0.2, 0.0, abs(r + n * 0.4 - spread * 0.55)) * 0.15);
      } else if (uPreset == 5) { // warp 星空跃迁
        col = mix(vec3(0.01, 0.0, 0.05), uC1 * 0.3, smoothstep(1.3, 0.0, r));
        float speed = 1.0 - smoothstep(0.55, 0.9, T);
        for (int i = 0; i < 3; i++) { float fi = float(i); vec2 g = vec2(ang * 40.0 + fi * 13.0, 0.0); float id = floor(g.x); float h = hash(vec2(id, fi));
          float z = fract(h * 7.0 - uTime * (0.6 + speed * 2.4) * (0.5 + h)); float sr = z * 1.4; float len = 0.02 + speed * 0.25 * z;
          col += smoothstep(len, 0.0, abs(r - sr)) * smoothstep(0.06, 0.0, abs(fract(g.x) - 0.5) * 0.08 * (2.0 - z)) * mix(uC2, vec3(1.0), h) * z * 2.0; }
        vec4 a = art(uv, mix(0.15, 1.04, ease((T - 0.1) * 2.2)), vec2(0.0), tilt * 2.0);
        col = mix(col, a.rgb, a.a * smoothstep(0.1, 0.35, T));
        col += vec3(1.0) * smoothstep(0.06, 0.0, abs(T - 0.32)) * 0.9;
      } else if (uPreset == 6) { // rain 从天而降
        col = mix(uC1 * 0.25 + vec3(0.04), uC0 * 0.55, uv.y);
        vec4 a = art(uv + vec2(0.0, 0.01 * sin(uTime * 2.0)), mix(1.12, 1.04, ease(T)), vec2(0.0), tilt * 2.0);
        col = mix(col, a.rgb, a.a * smoothstep(0.05, 0.3, T));
        col += uC2 * 0.25 * smoothstep(0.6, 0.0, length((uv - vec2(0.5, 1.05)) * vec2(aspect, 2.0)));
      } else if (uPreset == 7) { // stamp 盖章砸下
        vec3 paper = vec3(0.97, 0.94, 0.9) * (0.94 + 0.06 * fbm(uv * 10.0));
        vec4 a = art(uv, 1.03, vec2(0.0, 0.0), tilt * 2.0);
        col = mix(paper, a.rgb, a.a * 0.9 * smoothstep(0.0, 0.25, T));
        float drop = mix(3.2, 1.0, ease((T - 0.08) * 5.0)); float rr = r / (0.3 * drop);
        float ring = smoothstep(0.06, 0.0, abs(rr - 0.92)) + smoothstep(0.04, 0.0, abs(rr - 0.78));
        float grit = step(0.35, fbm(p * 30.0)); float stampA = ring * grit * smoothstep(0.05, 0.25, T);
        col = mix(col, vec3(0.86, 0.12, 0.28), clamp(stampA, 0.0, 0.92));
        float wave = (T - 0.28) * 2.2; col += vec3(1.0, 0.85, 0.9) * smoothstep(0.05, 0.0, abs(r - wave)) * step(0.28, T) * (1.0 - T);
      } else { // beam 光束
        col = mix(vec3(0.02, 0.01, 0.04), uC1 * 0.2, smoothstep(1.2, 0.0, r));
        float w = mix(0.002, 0.65, ease((T - 0.08) * 1.8)); float beam = exp(-pow(abs(p.x) / max(0.002, w * 0.35), 2.0));
        vec4 a = art(uv, 1.04, vec2(0.0), tilt * 2.0);
        float reveal = smoothstep(w * 0.5, w * 0.5 - 0.1, abs(p.x));
        col = mix(col, a.rgb, a.a * reveal);
        float godray = pow(0.5 + 0.5 * sin(p.x * 50.0 + fbm(vec2(p.x * 8.0, uTime)) * 6.0), 4.0) * beam;
        col += mix(uC2, vec3(1.0), 0.5) * (beam * 0.65 + godray * 0.35) * (1.0 - smoothstep(0.6, 1.0, T) * 0.7);
      }
      col *= 1.0 - 0.45 * smoothstep(0.55, 1.3, r);
      gl_FragColor = vec4(col * uFade, uFade);
    }`;

  // ───────────────────────── 引擎 ─────────────────────────
  const MAX = 8192;
  function makeSystem(THREE, add) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const attrs = {aP0: 2, aVel: 2, aTime: 4, aColor: 3, aMot: 4, aRot: 4}, arrays = {};
    for (const [name, size] of Object.entries(attrs)) { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * size), size); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); arrays[name] = a; }
    for (let i = 0; i < MAX; i++) arrays.aTime.array[i * 4 + 1] = -1;
    g.instanceCount = MAX;
    const m = new THREE.ShaderMaterial({vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {uTime: {value: 0}, uRes: {value: new THREE.Vector2(1, 1)}, uShake: {value: new THREE.Vector2()}, uGlow: {value: 1}, uAdd: {value: add ? 1 : 0}},
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, premultipliedAlpha: true});
    // 四边形在像素坐标里拼好再翻 y，绕向会反过来，所以用双面（否则全部被背面剔除）。0 号属性钉成逐顶点的 position（ANGLE 的老要求）。
    m.index0AttributeName = 'position';
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = add ? 3 : 2;
    return {mesh, arrays, head: 0, dirty: []};
  }
  async function ensure() {
    if (st.renderer) return true;
    const THREE = await loadThree(); if (!THREE) return false;
    if (st.renderer) return true;
    try {
      const canvas = document.createElement('canvas'); canvas.className = 'pk-gamefx-canvas';
      const renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'high-performance'});
      renderer.setClearColor(0x000000, 0); renderer.autoClear = false;
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); stats.contextLost = true; }, false);
      st.renderer = renderer; st.canvas = canvas; stats.contexts = 1;
      st.scene = new THREE.Scene(); st.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      st.meshes.normal = makeSystem(THREE, false); st.meshes.add = makeSystem(THREE, true);
      st.scene.add(st.meshes.normal.mesh, st.meshes.add.mesh);
      st.cineMat = new THREE.ShaderMaterial({vertexShader: CINE_VS, fragmentShader: CINE_FS, depthTest: false, depthWrite: false,
        uniforms: {uT: {value: 0}, uTime: {value: 0}, uPreset: {value: 0}, uRes: {value: new THREE.Vector2(1, 1)}, uC0: {value: new THREE.Color()}, uC1: {value: new THREE.Color()}, uC2: {value: new THREE.Color()},
          uArt: {value: null}, uArtOk: {value: 0}, uArtAspect: {value: 1.5}, uDof: {value: 0}, uFade: {value: 1}}});
      st.cineQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), st.cineMat); st.cineQuad.frustumCulled = false; st.cineQuad.renderOrder = 0; st.cineQuad.visible = false;
      st.scene.add(st.cineQuad);
      layer().append(canvas); resize(); applySettings();
      window.addEventListener('resize', resize);
      return true;
    } catch (error) { stats.fallback = true; stats.fallbackReason = String(error?.message || error); return false; }
  }
  function resize() {
    if (!st.renderer) return;
    const s = settings(), host = st.active?.host;
    const rect = host ? host.getBoundingClientRect() : {width: innerWidth, height: innerHeight};
    st.w = Math.max(1, Math.round(rect.width)); st.h = Math.max(1, Math.round(rect.height));
    st.dpr = (window.devicePixelRatio || 1) * s.res;
    st.renderer.setPixelRatio(st.dpr); st.renderer.setSize(st.w, st.h, false);
    st.canvas.style.width = st.w + 'px'; st.canvas.style.height = st.h + 'px';
    for (const sys of Object.values(st.meshes)) sys.mesh.material.uniforms.uRes.value.set(st.w, st.h);
    st.cineMat?.uniforms.uRes.value.set(st.w, st.h);
    st.composer?.setSize(st.w, st.h); st.composer?.setPixelRatio?.(st.dpr);
    st.active?.instance?.resize?.(st.w, st.h);
    draw();
  }
  function applySettings() {
    const s = settings();
    document.documentElement.dataset.pinkieGamefx = s.tier;
    document.documentElement.toggleAttribute('data-pinkie-gamefx-flat', s.book === 'flat' || stats.fallback);
    if (!st.renderer) return;
    for (const sys of Object.values(st.meshes)) sys.mesh.material.uniforms.uGlow.value = .3 + s.bloom * .75;
    resize();
  }
  function want() { return st.time < st.aliveUntil || st.cine || performance.now() < st.hitUntil || st.shake || st.active?.instance?.animating?.(); }
  function kick() {
    if (st.raf || st.inFrame || st.hidden || document.hidden || !st.renderer) return;
    st.last = performance.now(); stats.rafActive = true; st.raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    st.raf = 0; st.inFrame = true;
    try { tick(now); } finally { st.inFrame = false; }
  }
  function tick(now) {
    if (document.hidden) { stats.rafActive = false; return; }
    const s = settings(), cap = s.fps ? 1000 / s.fps : 0;
    if (cap && now - st.lastDraw < cap - 1.5) { st.raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(.05, Math.max(0, (now - st.last) / 1000)); st.last = now; st.lastDraw = now;
    const frozen = now < st.hitUntil;
    if (!frozen) st.time += dt;
    stats.frames++; stats.lastFrameAt = now; stats.frameTimes.push(now); if (stats.frameTimes.length > 600) stats.frameTimes.splice(0, 300);
    if (st.cine) stepCine(dt, frozen);
    if (st.shake) { const k = st.shake; const e = (now - k.start) / k.ms; if (e >= 1) st.shake = null; else { const a = k.power * (1 - e) * (1 - e); k.x = (Math.random() * 2 - 1) * a; k.y = (Math.random() * 2 - 1) * a; } }
    if (!frozen) st.active?.instance?.update?.(dt, st.time);
    draw();
    if (want()) st.raf = requestAnimationFrame(frame);
    else { stats.rafActive = false; clearSystems(); draw(); hideCanvasIfIdle(); }
  }
  function flush(sys) {
    for (const [start, count] of sys.dirty) for (const a of Object.values(sys.arrays)) a.addUpdateRange(start * a.itemSize, count * a.itemSize);
    if (sys.dirty.length) for (const a of Object.values(sys.arrays)) a.needsUpdate = true;
    sys.dirty.length = 0;
  }
  function draw() {
    const r = st.renderer; if (!r) return;
    const T = st.time;
    for (const sys of Object.values(st.meshes)) { flush(sys); const u = sys.mesh.material.uniforms; u.uTime.value = T; u.uShake.value.set(st.shake?.x || 0, st.shake?.y || 0); }
    const useComposer = st.composer && (st.cine || st.active?.instance?.opaque) && settings().bloom >= .6;
    r.setRenderTarget(null); r.clear();
    if (st.active?.instance?.render && !st.cine) st.active.instance.render(r, {composer: useComposer ? st.composer : null});
    if (useComposer) { st.renderPass.scene = st.scene; st.renderPass.camera = st.camera; st.composer.render(); }
    else r.render(st.scene, st.camera);
    st.canvas.dataset.live = '1';
  }
  function hideCanvasIfIdle() { if (st.canvas && !st.active && !st.cine) st.canvas.dataset.live = '0'; }
  function clearSystems() { /* 全部粒子已在着色器里过期；保留缓冲，避免重新分配。 */ }

  function colorOf(THREE, hex) { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }
  function targetPoint(target) {
    if (!target) return {x: innerWidth / 2, y: innerHeight / 2};
    if (target instanceof Element) { const r = target.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r}; }
    return {x: Number(target.x) || 0, y: Number(target.y) || 0};
  }
  function localPoint(pt) {
    if (!st.active?.host) return pt;
    const r = st.active.host.getBoundingClientRect(); return {...pt, x: pt.x - r.left, y: pt.y - r.top};
  }
  // 发射：pattern = radial | fountain | rain | ring | stream（带 to，打向目标并在目标处炸开）| spray
  function emit(kind, origin, opts = {}) {
    const spec = KINDS[kind] || KINDS.sparkle, THREE = st.THREE, s = settings();
    const add = Boolean(spec.add) && !opts.normal; const sys = st.meshes[add ? 'add' : 'normal'];
    const density = opts.ignoreDensity ? 1 : s.density;
    const n = Math.round((opts.count ?? spec.count) * (opts.scale ?? 1) * density);
    if (n <= 0) return 0;
    const palette = (opts.palette?.length ? opts.palette : spec.colors).map(c => colorOf(THREE, c));
    const pattern = opts.pattern || 'radial', power = opts.power ?? 1, delay = opts.delay || 0;
    const to = opts.to ? localPoint(targetPoint(opts.to)) : null;
    const a = sys.arrays; let longest = 0;
    const start = sys.head;
    for (let i = 0; i < n; i++) {
      const j = sys.head; sys.head = (sys.head + 1) % MAX;
      let x = origin.x, y = origin.y, vx, vy, life = rand(...spec.life) * (opts.lifeScale || 1), g = spec.g * (opts.gravity ?? 1), drag = spec.drag;
      const sp = rand(...spec.sp) * power; let born = st.time + delay + (opts.stagger ? Math.random() * opts.stagger : 0);
      if (pattern === 'fountain') { const th = -Math.PI / 2 + rand(-.5, .5) * (opts.spread ?? 1); vx = Math.cos(th) * sp; vy = Math.sin(th) * sp * 1.2; }
      else if (pattern === 'rain') { x = rand(-40, st.w + 40); y = rand(-st.h * .25, -20); vx = rand(-40, 40); vy = rand(.4, 1) * sp; g = Math.abs(g) + 200; drag = .4; born = st.time + delay + Math.random() * (opts.window ?? 1.2); life = Math.max(life, (st.h + 80) / Math.max(120, vy) * .9); }
      else if (pattern === 'ring') { const th = i / n * Math.PI * 2; vx = Math.cos(th) * sp; vy = Math.sin(th) * sp; g *= .2; }
      else if (pattern === 'stream' && to) { const T = opts.travel || .45; const jx = rand(-60, 60), jy = rand(-80, 20); vx = (to.x - x) / T + jx; vy = (to.y - y) / T + jy; g = 0; drag = 0; life = T * rand(.92, 1.02); born = st.time + delay + (i / n) * .12; }
      else if (pattern === 'spray') { const dir = opts.angle ?? 0, th = dir + rand(-.35, .35); vx = Math.cos(th) * sp; vy = Math.sin(th) * sp; }
      else { const th = Math.random() * Math.PI * 2, k = Math.sqrt(Math.random()); vx = Math.cos(th) * sp * k; vy = Math.sin(th) * sp * k - (g > 0 ? sp * .35 : 0); }
      if (opts.rect) { x = opts.rect.left + Math.random() * opts.rect.width; y = opts.rect.top + Math.random() * opts.rect.height; }
      const shape = pick(spec.shape), c = pick(palette), size = rand(...spec.size) * (opts.size || 1);
      a.aP0.array.set([x, y], j * 2); a.aVel.array.set([vx, vy], j * 2);
      a.aTime.array.set([born, life, shape, size], j * 4); a.aColor.array.set(c, j * 3);
      a.aMot.array.set([g, drag, spec.fl[0] * rand(.4, 1), spec.fl[1] * rand(.6, 1.4)], j * 4);
      a.aRot.array.set([Math.random() * 6.283, rand(...spec.spin), spec.grow || 0, Math.random()], j * 4);
      longest = Math.max(longest, born - st.time + life);
    }
    if (start + n <= MAX) sys.dirty.push([start, n]); else { sys.dirty.push([start, MAX - start]); sys.dirty.push([0, (start + n) % MAX]); }
    st.aliveUntil = Math.max(st.aliveUntil, st.time + longest);
    if (pattern === 'stream' && to && opts.impact !== false) emit(opts.impactKind || kind, to, {...opts, pattern: 'radial', to: null, delay: delay + (opts.travel || .45), count: Math.round((opts.count ?? spec.count) * .7), power: .8});
    return n;
  }
  async function burst(kind, at, opts = {}) {
    if (hiddenOrQuiet()) return 0;
    if (!(await ensure())) return domBurst(kind, at, opts);
    showCanvas();
    const n = emit(kind, localPoint(targetPoint(at)), opts);
    kick(); return n;
  }
  function hiddenOrQuiet() { return document.hidden || settings().density <= 0; }
  function showCanvas() { if (st.canvas) { if (!st.active && st.canvas.parentElement !== layer()) layer().append(st.canvas); st.canvas.dataset.live = '1'; } }

  // WebGL 起不来时的平面版：几颗 CSS 星星，transform / opacity 动画，播完就删。
  function domBurst(kind, at, opts = {}) {
    const pt = targetPoint(at), s = settings(); if (s.density <= 0) return 0;
    const spec = KINDS[kind] || KINDS.sparkle, n = Math.max(4, Math.round(10 * s.density * (opts.scale || 1))), host = layer();
    for (let i = 0; i < n; i++) {
      const d = document.createElement('i'); d.className = 'pk-gamefx-dot'; d.style.left = pt.x + 'px'; d.style.top = pt.y + 'px'; d.style.background = pick(opts.palette || spec.colors);
      const th = Math.random() * Math.PI * 2, r = rand(40, 120) * (opts.power || 1);
      host.append(d);
      const anim = d.animate([{transform: 'translate(-50%,-50%) scale(1)', opacity: 1}, {transform: `translate(calc(-50% + ${Math.cos(th) * r}px), calc(-50% + ${Math.sin(th) * r}px)) scale(.3)`, opacity: 0}], {duration: rand(450, 800), easing: 'cubic-bezier(.2,.7,.3,1)'});
      anim.onfinish = () => d.remove();
    }
    return n;
  }

  // 顿帧：引擎时间停住；GSAP 和 CSS 动画同时暂停（学习台的动画都走 GSAP）。
  function hitstop(ms = 70) {
    const s = settings(); if (!s.hitstop || document.hidden) return Promise.resolve(false);
    ms = clamp(Number(ms) || 70, 20, 160);
    const until = performance.now() + ms; st.hitUntil = Math.max(st.hitUntil, until);
    const gsap = window.__pinkieDeskVendors?.gsap || window.gsap;
    const root = document.documentElement; root.dataset.pinkieHitstop = '1';
    try { gsap?.globalTimeline.pause(); } catch { /* 没有 GSAP 就只停引擎时间 */ }
    kick();
    return new Promise(resolve => setTimeout(() => { if (performance.now() >= st.hitUntil - 2) { delete root.dataset.pinkieHitstop; try { gsap?.globalTimeline.resume(); } catch { /* 同上 */ } } resolve(true); }, ms));
  }
  // 震屏：WebGL 层用 uniform 偏移；DOM 用 WAAPI 关键帧（只动 transform）。
  function shake(power = 1, target) {
    const s = settings(); const amp = clamp(Number(power) || 1, 0, 3) * s.shake * 9; if (amp <= .2 || document.hidden) return null;
    const ms = 260 + 140 * Math.min(2, power);
    st.shake = {power: amp, start: performance.now(), ms, x: 0, y: 0}; kick();
    const node = target instanceof Element ? target : document.querySelector('#pinkie-study-desk .desk-content') || document.getElementById('pinkie-study-desk');
    if (!node) return null;
    const frames = []; for (let i = 0; i <= 8; i++) { const k = (1 - i / 8) ** 2; frames.push({transform: i === 8 ? 'none' : `translate(${(Math.random() * 2 - 1) * amp * k}px, ${(Math.random() * 2 - 1) * amp * k}px) rotate(${(Math.random() * 2 - 1) * .25 * k}deg)`}); }
    return node.animate(frames, {duration: ms, easing: 'linear', composite: 'add'});
  }

  // ───────────────────────── 大招过场 ─────────────────────────
  const textures = new Map();
  function texture(url) {
    if (!url || !st.THREE) return Promise.resolve(null);
    if (textures.has(url)) return textures.get(url);
    const p = new Promise(resolve => { const img = new Image(); img.decoding = 'async'; img.onload = () => { const t = new st.THREE.Texture(img); t.colorSpace = st.THREE.SRGBColorSpace; t.needsUpdate = true; t.userData.aspect = img.naturalWidth / Math.max(1, img.naturalHeight); resolve(t); }; img.onerror = () => resolve(null); img.src = new URL(url, BASE).href; });
    textures.set(url, p); return p;
  }
  const DEFAULT_ART = {daily: 'laolao-mode-chat-hd.png', learning: 'laolao-mode-learning-hd.png', project: 'laolao-mode-project-hd.png', thinking: 'laolao-mode-thinking-hd.png', unrestricted: 'laolao-mode-unrestricted-hd.png'};
  const PRESET_TIMING = {burst: 1.5, slash: 1.35, spell: 1.9, curtain: 2, ink: 1.9, warp: 1.8, rain: 1.8, stamp: 1.4, beam: 1.7};
  function cinematic(preset, opts = {}) {
    const job = st.cineQueue.then(() => runCinematic(preset, opts));
    st.cineQueue = job.catch(() => {}); return job;
  }
  async function runCinematic(preset, opts) {
    const s = settings();
    if (!PRESETS.includes(preset)) preset = 'burst';
    if (document.hidden || s.cine === 'off') return {played: false, reason: s.cine === 'off' ? 'off' : 'hidden'};
    if (!(await ensure())) return domCinematic(preset, opts);
    const palette = (opts.palette?.length ? opts.palette : ['#DB1F74', '#7a2a5c', '#ffd34d']).map(c => new st.THREE.Color(c));
    // 没给立绘时先用现成的模式碧琪图（App 里和注入脚本同一个根目录），B 的大招立绘到了就按形态换。
    const tex = await Promise.race([texture(opts.art || DEFAULT_ART[opts.form?.id || opts.form] || DEFAULT_ART.daily), new Promise(r => setTimeout(() => r(null), 900))]);
    const dur = (opts.duration || PRESET_TIMING[preset]) * (s.cine === 'short' ? .62 : 1);
    const u = st.cineMat.uniforms;
    u.uPreset.value = PRESETS.indexOf(preset); u.uC0.value.copy(palette[0]); u.uC1.value.copy(palette[1] || palette[0]); u.uC2.value.copy(palette[2] || palette[0]);
    u.uArt.value = tex; u.uArtOk.value = tex ? 1 : 0; u.uArtAspect.value = tex?.userData.aspect || 1.5; u.uDof.value = s.dof ? 1 : 0; u.uT.value = 0; u.uFade.value = 0;
    if (s.bloom >= .6) await ensureComposer();
    // 过场期间画布挪到最上层全屏，结束后放回原处。
    const prevHost = st.active; if (prevHost) detachScene(true);
    layer().append(st.canvas); st.canvas.dataset.live = '1'; st.canvas.dataset.cine = '1'; resize();
    st.cineQuad.visible = true;
    const text = cineText(preset, opts, dur);
    return new Promise(resolve => {
      const done = (skipped = false) => {
        if (!st.cine) return; st.cine = null; st.cineQuad.visible = false; delete st.canvas.dataset.cine; text.remove();
        removeEventListener('keydown', onKey, true); text.removeEventListener('pointerdown', onSkip);
        if (prevHost) attachScene(prevHost); else { draw(); }
        resolve({played: true, skipped, preset});
      };
      const onSkip = () => done(true);
      const onKey = event => { if (event.key === 'Escape' || event.key === ' ' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); done(true); } };
      text.addEventListener('pointerdown', onSkip); addEventListener('keydown', onKey, true);
      st.cine = {preset, t: 0, dur, opts, palette: opts.palette, particle: opts.particle || 'sparkle', fired: new Set(), done};
      kick();
      sfx('ult', {form: opts.form, preset});
    });
  }
  function stepCine(dt, frozen) {
    const c = st.cine; if (!frozen) c.t += dt;
    const T = clamp(c.t / c.dur, 0, 1), u = st.cineMat.uniforms;
    u.uT.value = T; u.uTime.value = st.time; u.uFade.value = Math.min(1, c.t / .12) * (1 - clamp((T - .9) / .1, 0, 1));
    const fire = (name, at, fn) => { if (T >= at && !c.fired.has(name)) { c.fired.add(name); fn(); } };
    const cx = st.w / 2, cy = st.h / 2, kind = c.particle, pal = c.palette, P = c.preset;
    fire('a', .12, () => {
      if (P === 'rain') emit(kind, {x: cx, y: 0}, {pattern: 'rain', count: 520, palette: pal, window: c.dur * .7, ignoreDensity: false, scale: 1});
      else if (P === 'warp') emit('sparkle', {x: cx, y: cy}, {pattern: 'ring', count: 160, power: 2.2, palette: pal});
      else if (P === 'curtain') emit('confetti', {x: cx, y: -10}, {pattern: 'rain', count: 220, palette: pal, window: c.dur * .5});
      else emit(kind, {x: cx, y: cy}, {count: 150, power: 2.1, palette: pal});
      if (P === 'stamp' || P === 'burst' || P === 'slash') { shake(P === 'stamp' ? 2 : 1.3); }
    });
    fire('b', .3, () => { emit(kind, {x: cx, y: st.h * .9}, {pattern: 'fountain', count: 200, power: 1.6, palette: pal, spread: 1.4}); if (P === 'stamp') { emit('ink', {x: cx, y: cy}, {pattern: 'ring', count: 80, power: 1.4}); } });
    fire('c', .55, () => emit('sparkle', {x: cx, y: cy}, {count: 70, power: 1.6, palette: pal}));
    if (c.t >= c.dur) c.done(false);
  }
  function cineText(preset, opts, dur) {
    const n = document.createElement('div'); n.className = 'pk-gamefx-cine-text'; n.dataset.preset = preset; n.style.setProperty('--dur', dur + 's');
    const title = document.createElement('strong'); title.textContent = opts.text || '碧琪大招！';
    const sub = document.createElement('span'); sub.textContent = opts.sub || '';
    const hint = document.createElement('em'); hint.textContent = '点一下跳过';
    n.append(title, sub, hint); layer().append(n); return n;
  }
  function domCinematic(preset, opts) {
    // 平面版：一张全屏手账卡片 + 文字，0.9 s，不需要 WebGL。
    return new Promise(resolve => {
      const n = cineText(preset, opts, .9); n.classList.add('is-flat');
      const end = () => { n.remove(); resolve({played: true, flat: true, preset}); };
      n.addEventListener('pointerdown', end); setTimeout(end, 900);
    });
  }
  async function ensureComposer() {
    if (st.composer) return true;
    const addons = await loadAddons(); if (!addons || !st.renderer) return false;
    const {EffectComposer, RenderPass, UnrealBloomPass, OutputPass} = addons;
    const composer = new EffectComposer(st.renderer); composer.setPixelRatio(st.dpr); composer.setSize(st.w, st.h);
    st.renderPass = new RenderPass(st.scene, st.camera); st.renderPass.clear = true;
    st.bloomPass = new UnrealBloomPass(new st.THREE.Vector2(st.w, st.h), .42, .45, .8);
    st.outputPass = new OutputPass();
    composer.addPass(st.renderPass); composer.addPass(st.bloomPass); composer.addPass(st.outputPass);
    st.composer = composer; return true;
  }

  // ───────────────────────── 3D 场景（立体书 / 扭蛋 / Boss / 营地） ─────────────────────────
  // registerScene(name, factory)：factory({THREE, addons, engine, host, opts}) → {render(renderer, {composer}), update(dt,t), animating(), resize(w,h), opaque, dispose()}
  function registerScene(name, factory) { sceneFactories.set(name, factory); }
  function detachScene(temp) { if (!st.active) return; if (!temp) { try { st.active.instance?.dispose?.(); } catch { /* 场景自己的清理失败不影响引擎 */ } } st.active = temp ? st.active : null; }
  function attachScene(handle) { st.active = handle; handle.host.append(st.canvas); st.canvas.dataset.live = '1'; resize(); kick(); }
  async function scene(name, opts = {}) {
    const factory = sceneFactories.get(name); if (!factory) throw Error('没有这个场景：' + name);
    if (!(await ensure())) return null;
    const addons = await loadAddons();
    if (st.active) closeScene();
    const handle = {name, host: opts.host || layer(), instance: null};
    handle.instance = await factory({THREE: st.THREE, addons, engine: api, host: handle.host, opts, settings: settings()});
    if (handle.instance?.opaque && settings().bloom >= .6) await ensureComposer();
    attachScene(handle);
    handle.close = () => { if (st.active === handle) closeScene(); };
    handle.invalidate = () => { draw(); kick(); };
    return handle;
  }
  function closeScene() { if (!st.active) return; detachScene(false); layer().append(st.canvas); resize(); draw(); hideCanvasIfIdle(); }

  // ───────────────────────── 声音（WebAudio 现场合成，多层 + 混响 + 形态音色） ─────────────────────────
  const audio = {ctx: null, master: null, wet: null, gesture: false};
  const TIMBRE = {bell: ['sine', [1, 2.76, 5.4], .9], chime: ['sine', [1, 3, 4.2], 1.2], pluck: ['triangle', [1, 2], .35], synth: ['sawtooth', [1, 1.005], .4], square: ['square', [1], .25],
    brass: ['sawtooth', [1, 2, 3], .55], harp: ['triangle', [1, 2, 4], .8], koto: ['triangle', [1, 3], .5], 'music-box': ['sine', [1, 4], 1], drum: ['sine', [1], .2], '8bit': ['square', [1, 2], .18], choir: ['sine', [1, 2, 3, 4], 1.4]};
  function soundOn() { try { const raw = JSON.parse(localStorage.getItem(SOUND_KEY) || 'null'); if (raw && raw.on === false) return false; } catch { /* 缺省开 */ } return true; }
  function ensureAudio() {
    if (audio.ctx) return audio.ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    const ctx = new AC(); audio.ctx = ctx; audio.master = ctx.createGain(); audio.master.connect(ctx.destination);
    const conv = ctx.createConvolver(), len = Math.floor(ctx.sampleRate * 1.6), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6; }
    conv.buffer = buf; audio.wet = ctx.createGain(); audio.wet.gain.value = .28; audio.wet.connect(conv); conv.connect(audio.master);
    return ctx;
  }
  addEventListener('pointerdown', () => { audio.gesture = true; const c = ensureAudio(); if (c?.state === 'suspended' && !document.hidden) c.resume().catch(() => {}); }, true);
  addEventListener('keydown', () => { audio.gesture = true; }, true);
  function voice(ctx, {type = 'sine', freq = 440, to, at = 0, dur = .3, level = .3, partials = [1], wet = .3, attack = .005}) {
    const t0 = ctx.currentTime + at, g = ctx.createGain();
    g.gain.setValueAtTime(.0001, t0); g.gain.linearRampToValueAtTime(level, t0 + attack); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    g.connect(audio.master); if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(audio.wet); }
    partials.forEach((ratio, i) => { const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq * ratio, t0); if (to) o.frequency.exponentialRampToValueAtTime(to * ratio, t0 + dur); og.gain.value = 1 / (1 + i * 1.6); o.connect(og); og.connect(g); o.start(t0); o.stop(t0 + dur + .05); });
  }
  function noiseHit(ctx, {at = 0, dur = .12, level = .25, freq = 1800, q = .8, type = 'bandpass', wet = .2}) {
    const t0 = ctx.currentTime + at, len = Math.max(1, Math.floor(ctx.sampleRate * dur)), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); src.buffer = b; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = level;
    src.connect(f); f.connect(g); g.connect(audio.master); if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(audio.wet); } src.start(t0);
  }
  function sfx(name, opts = {}) {
    if (!audio.gesture || document.hidden || !soundOn() || (document.hasFocus && !document.hasFocus())) return false;
    const ctx = ensureAudio(); if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    audio.master.gain.value = settings().volume * .42;
    const [type, partials, ring] = TIMBRE[opts.timbre || formTimbre(opts.form)] || TIMBRE.bell;
    const base = 523.25 * (opts.pitch || 1);
    switch (name) {
      case 'hit': voice(ctx, {type, partials, freq: base * 1.5, dur: .18 + ring * .2, level: .22}); noiseHit(ctx, {dur: .06, level: .16, freq: 3200}); break;
      case 'crit': voice(ctx, {type, partials, freq: base * 2, dur: .5 + ring * .3, level: .26}); voice(ctx, {type: 'sine', freq: 90, to: 45, dur: .32, level: .4, wet: 0}); noiseHit(ctx, {dur: .18, level: .3, freq: 900, q: .5}); break;
      case 'combo': [0, 1, 2].forEach(i => voice(ctx, {type, partials, freq: base * [1, 1.25, 1.5][i] * (1 + (opts.n || 0) * .01), at: i * .05, dur: .25, level: .16})); break;
      case 'ult': noiseHit(ctx, {dur: .9, level: .16, freq: 600, q: .3, type: 'lowpass', wet: .4}); voice(ctx, {type: 'sawtooth', freq: 110, to: 440, dur: .9, level: .1}); [0, 1, 2, 3].forEach(i => voice(ctx, {type, partials, freq: base * [1, 1.26, 1.5, 2][i], at: .55 + i * .07, dur: .9 + ring * .4, level: .17, wet: .5})); voice(ctx, {type: 'sine', freq: 70, to: 38, at: .5, dur: .6, level: .45, wet: 0}); break;
      case 'coin': voice(ctx, {type: 'square', freq: 988, dur: .07, level: .08, wet: .1}); voice(ctx, {type: 'square', freq: 1319, at: .07, dur: .22, level: .08, wet: .2}); break;
      case 'sparkle': [0, 1, 2, 3, 4].forEach(i => voice(ctx, {type: 'sine', partials: [1, 3], freq: 1760 * (1 + i * .19), at: i * .035, dur: .3, level: .05, wet: .6})); break;
      case 'stamp': voice(ctx, {type: 'sine', freq: 140, to: 60, dur: .22, level: .45, wet: .1}); noiseHit(ctx, {dur: .1, level: .35, freq: 500, q: .6}); break;
      case 'whoosh': noiseHit(ctx, {dur: .45, level: .18, freq: 1200, q: .4, wet: .3}); break;
      case 'gacha-turn': [0, 1, 2, 3, 4, 5].forEach(i => noiseHit(ctx, {at: i * .07, dur: .03, level: .18, freq: 2600, q: 4, wet: .05})); break;
      case 'capsule-drop': voice(ctx, {type: 'sine', freq: 300, to: 120, dur: .18, level: .25, wet: .2}); voice(ctx, {type: 'sine', freq: 260, to: 110, at: .22, dur: .12, level: .12, wet: .2}); break;
      case 'open': { const lv = opts.rarity === 'SSR' ? 3 : opts.rarity === 'SR' ? 2 : 1; for (let i = 0; i < 2 + lv * 2; i++) voice(ctx, {type, partials, freq: base * [1, 1.25, 1.5, 2, 2.5, 3, 4, 5][i], at: i * .06, dur: .6 + lv * .3, level: .12 + lv * .03, wet: .5}); if (lv === 3) voice(ctx, {type: 'sine', partials: [1, 2, 3, 4], freq: 261.6, at: .4, dur: 2.2, level: .14, wet: .7}); break; }
      case 'levelup': [0, 1, 2, 3].forEach(i => voice(ctx, {type, partials, freq: base * [1, 1.25, 1.5, 2][i], at: i * .09, dur: .5, level: .16, wet: .4})); break;
      case 'boss-hit': voice(ctx, {type: 'sine', freq: 75, to: 35, dur: .5, level: .5, wet: .2}); noiseHit(ctx, {dur: .3, level: .35, freq: 400, q: .4, type: 'lowpass'}); break;
      case 'miss': voice(ctx, {type: 'sine', freq: 392, to: 330, dur: .22, level: .08, wet: .2}); break;
      default: return false;
    }
    return true;
  }
  const FORM_TIMBRE = {};
  function formTimbre(form) { return (form && (FORM_TIMBRE[form] || FORM_TIMBRE[form?.id] || form?.sound)) || 'bell'; }
  function setFormTimbre(map) { Object.assign(FORM_TIMBRE, map || {}); }

  // ───────────────────────── 奖励播放（后端决定，前端只播） ─────────────────────────
  const AWARD_ICON = {stars: '⭐', seals: '🟡', shards: '💎', item: '🎁', form: '🦄', levelup: '💗', awaken: '🌈', capture: '📖', node: '🔆', boss: '🗼', rank: '🎖️', chest: '🧰', gift: '🎀'};
  let awardQueue = Promise.resolve();
  const played = new Set();
  function playAward(award, opts = {}) {
    if (!award || typeof award !== 'object') return Promise.resolve(false);
    if (award.id && played.has(award.id)) return Promise.resolve(false);
    if (award.id) played.add(award.id);
    const job = awardQueue.then(() => runAward(award, opts)).catch(() => false);
    awardQueue = job; return job;
  }
  function hudAnchor(kind) { return document.querySelector(`[data-game-hud="${kind === 'seals' ? 'seals' : kind === 'shards' ? 'shards' : 'stars'}"]`); }
  async function runAward(award, opts) {
    const s = settings(), level = ['small', 'medium', 'big', 'cinematic'].includes(award.fx) ? award.fx : 'small';
    const text = awardText(award);
    const from = opts.from ? targetPoint(opts.from) : {x: innerWidth / 2, y: innerHeight * .42};
    const anchor = hudAnchor(award.kind), kind = award.kind === 'seals' ? 'gold' : award.kind === 'shards' ? 'crystal' : opts.particle || 'stars';
    if (level === 'cinematic' && s.cine !== 'off') {
      await cinematic(opts.preset || (award.kind === 'boss' ? 'beam' : award.kind === 'awaken' ? 'spell' : 'stamp'), {text, sub: award.reason || '', art: opts.art, palette: opts.palette, particle: kind, form: opts.form});
      chip(text, award, 'big'); return true;
    }
    if (level === 'big') { sfx('levelup', opts); shake(.8); burst(kind, from, {count: 160, power: 1.5, palette: opts.palette}); burst('confetti', {x: from.x, y: from.y + 20}, {pattern: 'fountain', count: 90}); banner(text, award); }
    else if (level === 'medium') { sfx('sparkle', opts); burst(kind, from, {count: 80, palette: opts.palette}); }
    else sfx('coin', opts);
    if (anchor && (award.kind === 'stars' || award.kind === 'seals' || award.kind === 'shards')) burst(kind, from, {pattern: 'stream', to: anchor, count: clamp(Math.round((award.amount || 1) * 1.5), 6, 40), travel: .5, impactKind: 'sparkle'});
    chip(text, award, level);
    await new Promise(r => setTimeout(r, level === 'big' ? 900 : level === 'medium' ? 420 : 160));
    return true;
  }
  function awardText(a) {
    const n = Number(a.amount) || 0;
    if (a.kind === 'stars') return `+${n} ⭐`;
    if (a.kind === 'seals') return `+${n} 金印`;
    if (a.kind === 'shards') return `+${n} 碎片`;
    return a.reason || ({levelup: '亲密度升级', awaken: '觉醒！', capture: '收服错题怪', node: '点亮新节点', boss: '巴别兽受伤了', rank: '段位提升', chest: '委托宝箱', gift: '碧琪的小礼物', form: '新形态', item: '新物品'})[a.kind] || '奖励';
  }
  function chip(text, award, level) {
    const host = layer(); let stack = host.querySelector('.pk-gamefx-chips'); if (!stack) { stack = document.createElement('div'); stack.className = 'pk-gamefx-chips'; host.append(stack); }
    const c = document.createElement('div'); c.className = 'pk-gamefx-chip'; c.dataset.level = level; c.dataset.kind = award.kind || '';
    const i = document.createElement('b'); i.textContent = AWARD_ICON[award.kind] || '✨'; const t = document.createElement('span'); t.textContent = text;
    c.append(i, t); if (award.reason && level !== 'small' && award.reason !== text) { const r = document.createElement('small'); r.textContent = award.reason; c.append(r); }
    stack.append(c); while (stack.children.length > 4) stack.firstElementChild.remove();
    setTimeout(() => { c.classList.add('is-out'); setTimeout(() => c.remove(), 400); }, level === 'small' ? 1600 : 2600);
  }
  function banner(text, award) {
    const n = document.createElement('div'); n.className = 'pk-gamefx-banner'; const t = document.createElement('strong'); t.textContent = text; n.append(t);
    if (award.reason) { const r = document.createElement('span'); r.textContent = award.reason; n.append(r); }
    layer().append(n); setTimeout(() => n.remove(), 1800);
  }

  // ───────────────────────── 生命周期 ─────────────────────────
  document.addEventListener('visibilitychange', () => {
    st.hidden = document.hidden;
    if (document.hidden) {
      if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; } stats.rafActive = false;
      st.cine?.done(true); st.aliveUntil = st.time; st.shake = null;
      if (audio.ctx?.state === 'running') audio.ctx.suspend().catch(() => {});
    } else if (st.active) kick();
  });
  addEventListener('blur', () => { if (audio.ctx?.state === 'running') audio.ctx.suspend().catch(() => {}); });
  addEventListener('focus', () => { if (audio.ctx?.state === 'suspended' && audio.gesture && !document.hidden) audio.ctx.resume().catch(() => {}); });
  addEventListener('storage', event => { if (event.key === KEY || event.key === MOTION_KEY) { applySettings(); window.dispatchEvent(new CustomEvent('pinkie:gamefx-settings', {detail: settings()})); } });
  addEventListener('pinkie:motion-change', () => { applySettings(); window.dispatchEvent(new CustomEvent('pinkie:gamefx-settings', {detail: settings()})); });

  // ───────────────────────── 设置页 UI（设置 → 外观与声音 → 游戏特效） ─────────────────────────
  const FIELD_UI = [
    ['density', '粒子密度', 'range', '命中、奖励、大招里粒子的多少。'],
    ['bloom', '辉光', 'range', '发光粒子和过场的光晕强度。'],
    ['dof', '景深', 'toggle', '过场和立体书背景虚化。'],
    ['shake', '震屏', 'range', '暴击、盖章、Boss 受击时画面抖动的幅度。'],
    ['hitstop', '顿帧', 'toggle', '暴击瞬间停顿 60–90 毫秒，打击更有分量。'],
    ['cine', '全屏过场', 'seg', '大招、觉醒、Boss 结算的全屏动画。', [['full', '完整'], ['short', '简短'], ['off', '关']]],
    ['biqi', '碧琪动画', 'toggle', '营地和战斗里碧琪的待机动作。'],
    ['book', '立体书', 'seg', '地图用 3D 立体书还是平面版。', [['3d', '3D'], ['flat', '平面']]],
    ['fps', '帧率上限', 'seg', '', [[30, '30'], [60, '60'], [0, '不限']]],
    ['res', '渲染分辨率', 'range', '特效画面的清晰度（50–100%）。', null, .5],
    ['volume', '音效音量', 'range', '游戏音效的音量（学习音效关掉时不出声）。'],
  ];
  function buildSettings(host, h = {}) {
    if (!host || host.querySelector('.pk-gamefx-settings')) return true;
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const wrap = el('div', 'pk-gamefx-settings'); host.append(wrap);
    const rowOf = (label, hint) => {
      if (typeof h.row === 'function') return h.row(wrap, label, hint);
      const item = el('div', 'pinkie-user-settings__row'); const copy = el('div', 'pinkie-user-settings__row-copy'); copy.append(el('strong', '', label)); if (hint) copy.append(el('span', '', hint)); const control = el('div', 'pinkie-user-settings__row-control'); item.append(copy, control); wrap.append(item); return {item, copy, control};
    };
    const pressed = (node, on) => { if (typeof h.setPressed === 'function') h.setPressed(node, on); else { node.setAttribute('aria-pressed', String(Boolean(on))); node.classList.toggle('is-active', Boolean(on)); } };
    const choice = (parent, label, fn) => { const b = el('button', 'pinkie-user-settings__choice', label); b.type = 'button'; b.addEventListener('click', fn); parent.append(b); return b; };
    const tierRow = rowOf('游戏特效', '学习台游戏的画面档位。只按你的选择，每台电脑效果都一样。');
    tierRow.item?.classList.add('pk-gamefx-tier-row');
    const tierGroup = el('div', 'pinkie-user-settings__segments pinkie-user-settings__segments--wrap'); tierRow.control.append(tierGroup);
    const tierButtons = TIER_ORDER.map(t => [t, choice(tierGroup, TIERS[t].label + (t === 'cinematic' ? '（默认）' : ''), () => { setTier(t); paint(); })]);
    const reducedNote = el('p', 'pinkie-user-settings__soft-note pk-gamefx-reduced', '「减少动效」已打开：游戏特效按安静档播放。'); wrap.append(reducedNote);
    const details = el('details', 'pk-gamefx-custom'); const summary = el('summary', '', '自定义细项'); details.append(summary); wrap.append(details);
    const controls = {};
    for (const [field, label, kind, hint, options, min] of FIELD_UI) {
      const r = rowOf(label, hint); details.append(r.item);
      if (kind === 'range') {
        const input = el('input', 'pk-gamefx-range'); input.type = 'range'; input.min = String(Math.round((min || 0) * 100)); input.max = '100'; input.step = '5'; input.setAttribute('aria-label', label);
        const out = el('output', 'pk-gamefx-range-value'); input.addEventListener('input', () => { out.textContent = input.value + '%'; }); input.addEventListener('change', () => { setCustom(field, Number(input.value) / 100); paint(); });
        r.control.append(input, out); controls[field] = {kind, input, out};
      } else if (kind === 'toggle') {
        const g = el('div', 'pinkie-user-settings__segments'); r.control.append(g);
        controls[field] = {kind, buttons: [[true, choice(g, '开', () => { setCustom(field, true); paint(); })], [false, choice(g, '关', () => { setCustom(field, false); paint(); })]]};
      } else {
        const g = el('div', 'pinkie-user-settings__segments'); r.control.append(g);
        controls[field] = {kind, buttons: options.map(([v, l]) => [v, choice(g, l, () => { setCustom(field, v); paint(); })])};
      }
    }
    const reset = el('button', 'pinkie-user-settings__button pk-gamefx-reset', '恢复这一档的默认'); reset.type = 'button'; reset.addEventListener('click', () => { setTier(settings().tier); paint(); }); details.append(reset);
    const note = el('p', 'pinkie-user-settings__soft-note', '我们在 M1 8GB 上测试用「标准」档；电影级最好看，旧电脑上可能掉帧，但画面一样。'); details.append(note);
    function paint() {
      const s = settings();
      for (const [t, b] of tierButtons) pressed(b, s.tier === t); reducedNote.hidden = !s.reduced;
      for (const [field, c] of Object.entries(controls)) {
        if (c.kind === 'range') { c.input.value = String(Math.round(s[field] * 100)); c.out.textContent = c.input.value + '%'; c.input.disabled = s.reduced; }
        else for (const [v, b] of c.buttons) { pressed(b, s[field] === v); b.disabled = s.reduced; }
      }
      summary.textContent = Object.keys(s.custom).length ? `自定义细项（改了 ${Object.keys(s.custom).length} 项）` : '自定义细项';
      for (const [, b] of tierButtons) b.disabled = s.reduced;
    }
    paint(); addEventListener('pinkie:gamefx-settings', paint);
    return true;
  }

  // ───────────────────────── 对外接口 ─────────────────────────
  const api = {
    burst, hitstop, shake, cinematic, scene, registerScene, closeScene, setTier, setCustom, settings, playAward, sfx, setFormTimbre, buildSettings,
    kinds: Object.keys(KINDS), presets: PRESETS.slice(), presetLabel: {...PRESET_LABEL}, tiers: TIER_ORDER.map(id => ({id, label: TIERS[id].label, ...TIERS[id]})),
    ensure, loadThree, loadAddons, layer, base: BASE,
    // 只给 QA 用：强制档位（不写存储）、统计、帧率测量
    _st: () => st,
    _forceTier(t) { forcedTier = TIERS[t] ? t : ''; applySettings(); },
    stats() { const live = st.time < st.aliveUntil; return {...stats, frameTimes: undefined, alive: live, cine: Boolean(st.cine), scene: st.active?.name || '', time: st.time, webgl: Boolean(st.renderer)}; },
    fps(sinceMs = 2000) { const now = performance.now(), ts = stats.frameTimes.filter(t => t >= now - sinceMs); if (ts.length < 3) return {median: 0, p5: 0, frames: ts.length}; const dts = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b); const med = dts[Math.floor(dts.length / 2)], p95 = dts[Math.floor(dts.length * .95)]; return {median: Math.round(1000 / med), p5: Math.round(1000 / p95), frames: ts.length}; },
  };
  window.__pinkieGameFx = api;
  applySettings();
  window.dispatchEvent(new CustomEvent('pinkie:gamefx-ready'));
})();
