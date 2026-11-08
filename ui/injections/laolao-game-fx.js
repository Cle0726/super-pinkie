/* 碧琪上岸记 · 游戏特效引擎（window.__pinkieGameFx）
   视觉语言（briefs/study-desk-game/VFX.md）：光 / 墨 / 纸三类材质，分层叠加、白热核心、按速度拉伸的流光、3D 翻转受光的纸片金箔；
   大招 = 压暗调色 + 斜切条带切入（立绘对焦、速度线、网点）+ 衬线大标题 + 收束闪光。不画卡通图标，不用 emoji。
   - 一个 WebGL 上下文（Three.js r185，本地打包），GPU 实例化粒子：轨迹在顶点着色器里按出生时间解析计算，CPU 每帧只改 uniform。
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
    if (v === undefined || v === null) return undefined;
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

  // ───────────────────────── 特效材质（光 / 墨 / 纸） ─────────────────────────
  // 视觉语言见 briefs/study-desk-game/VFX.md。要点：每个特效由 3–6 层元素按时间错开叠成（闪光 → 冲击环 → 火花 → 余韵），
  // 发光元素是「白热核心 + 本色 + 衰减」，火花按速度拉成流光，纸片 / 金箔 / 花瓣在 3D 里翻转受光。不画卡通图标。
  const E = {STREAK: 0, MOTE: 1, GLINT: 2, RING: 3, FLASH: 4, SHARD: 5, FOIL: 6, PETAL: 7, INK: 8, PUFF: 9, EMBER: 10, BOKEH: 11, BUBBLE: 12,
    FLAKE: 13, COIN: 14, ARC: 15, SIGIL: 16, LEAF: 17, FEATHER: 18, CARD: 19, NEON: 20, RIPPLE: 21, CRESCENT: 22, PILLAR: 23};
  const LIGHT = new Set([E.STREAK, E.MOTE, E.GLINT, E.RING, E.FLASH, E.EMBER, E.BOKEH, E.FLAKE, E.ARC, E.SIGIL, E.NEON, E.RIPPLE, E.CRESCENT, E.PILLAR]);
  const POINT = new Set([E.RING, E.FLASH, E.SIGIL, E.RIPPLE, E.PILLAR, E.CRESCENT, E.ARC]);   // 原地放的元素
  // 一层 = 元素 + 数量 + 物理。c：数字 = 配色下标，'h' = 白热（白和主色之间），'w' = 白，或直接写颜色。
  // sp 初速 px/s；life 秒；size 直径 px（流光是粗细）；g 重力 px/s²（正 = 往下）；drag 阻力；turb [幅度 px, 频率]；stretch 流光长度 = 速度 × stretch；
  // grow 寿命内放大；aspect 宽高比；tumble 3D 翻转角速度；int 不透明度；delay 秒。
  const L = (e, n, o = {}) => ({e, n, sp: [0, 0], life: [.6, 1], size: [4, 8], g: 0, drag: 2, spin: [0, 0], turb: [0, 0], stretch: 0, grow: 0, aspect: 1,
    tumble: [0, 0], c: [0, 1, 2], int: 1, delay: 0, ...o});
  const flash = (k = 1, o = {}) => L(E.FLASH, 1, {life: [.2, .24], size: [110 * k, 130 * k], c: ['h'], ...o});
  const ring = (k = 1, o = {}) => L(E.RING, 1, {life: [.42, .5], size: [230 * k, 270 * k], c: [0], ...o});
  const streaks = (n, o = {}) => L(E.STREAK, n, {sp: [420, 1150], life: [.22, .55], size: [1.7, 2.8], g: 280, drag: 3.4, stretch: .042, c: ['h', 0, 2], ...o});
  const motes = (n, o = {}) => L(E.MOTE, n, {sp: [30, 220], life: [.9, 1.9], size: [5, 11], g: -24, drag: 1.7, turb: [10, 1.6], c: [0, 2, 'h'], int: .8, ...o});
  const glints = (n, o = {}) => L(E.GLINT, n, {sp: [60, 360], life: [.5, 1.1], size: [16, 40], drag: 3, spin: [-1.2, 1.2], c: ['h', 0], ...o});
  const crescent = (k = 1, o = {}) => L(E.CRESCENT, 1, {life: [.34, .38], size: [210 * k, 230 * k], c: ['h'], ...o});
  const K = (pal, layers) => ({pal, layers});
  // 22 个配方名沿用第一版（形态目录 learning-game-forms.json 的 particle 字段用这些名字），画法全部换成新材质。
  const KINDS = {
    sparkle: K(['#fff1d0', '#ff9ccb', '#ffffff'], [flash(.7), glints(10), streaks(16), motes(22)]),
    stars: K(['#ffd36e', '#ff8fc0', '#fff4d6'], [flash(.85), ring(.7), glints(12, {size: [18, 46]}), streaks(26), motes(18)]),
    confetti: K(['#DB1F74', '#f2c35b', '#fbf4ee'], [flash(.55), L(E.FOIL, 44, {sp: [300, 920], life: [1.5, 2.5], size: [7, 12], aspect: .55, g: 380, drag: 2.3, turb: [26, 2.2], spin: [-4, 4], tumble: [5, 11]}), glints(6), motes(10)]),
    petals: K(['#ffc6dc', '#f08ab4', '#fff2f7'], [L(E.PETAL, 26, {sp: [140, 460], life: [2, 3.3], size: [11, 18], aspect: .72, g: 55, drag: 1.9, turb: [36, 1.5], spin: [-2, 2], tumble: [2, 5]}), motes(16), glints(4)]),
    hearts: K(['#ff5fa2', '#ffb3d1', '#fff0f6'], [flash(.5), L(E.BOKEH, 10, {sp: [80, 320], life: [1.2, 2.2], size: [9, 20], g: -60, drag: 2, turb: [12, 1.4], int: .6}), motes(18), streaks(10, {c: [0, 'h']})]),
    ink: K(['#24171f', '#43303d', '#DB1F74'], [L(E.INK, 7, {sp: [40, 200], life: [1.1, 1.7], size: [60, 150], drag: 4, c: [0, 1]}), L(E.INK, 24, {sp: [320, 820], life: [.5, .9], size: [5, 12], g: 640, drag: 2.6, c: [0]}), motes(6, {c: [2]})]),
    crystal: K(['#a6e6ff', '#c6b0ff', '#ffffff'], [flash(.7), ring(.6), L(E.SHARD, 22, {sp: [300, 900], life: [.9, 1.6], size: [10, 22], aspect: .55, g: 420, drag: 1.8, spin: [-5, 5], tumble: [4, 10], int: .86}), glints(10), motes(14)]),
    bubbles: K(['#bfefff', '#e2d6ff', '#ffffff'], [L(E.BUBBLE, 16, {sp: [80, 300], life: [1.6, 2.8], size: [14, 40], g: -140, drag: 1.2, turb: [22, 2], c: [0, 1]}), motes(10)]),
    snow: K(['#ffffff', '#cfe6ff', '#8fc6ff'], [L(E.FLAKE, 10, {sp: [160, 380], life: [2.2, 3.4], size: [22, 38], g: 50, drag: 1.6, turb: [24, 1.4], spin: [-.8, .8], c: [1, 2, 0]}), motes(30, {size: [3, 9], g: 40, c: [0, 1]}), glints(4, {c: ['h', 1]})]),
    embers: K(['#ff9a3c', '#ffd25e', '#ff4a2a'], [flash(.6, {c: [1]}), L(E.EMBER, 46, {sp: [120, 520], life: [.8, 1.9], size: [3, 6], g: -220, drag: 1.4, turb: [18, 5], c: [0, 2, 1]}), streaks(14, {c: [1, 0]}), L(E.PUFF, 4, {sp: [20, 80], life: [1.2, 1.8], size: [60, 110], g: -60, drag: 2, grow: 1.4, c: ['#3a2a30'], int: .7})]),
    notes: K(['#c46bff', '#ff6fb7', '#7fd3ff'], [L(E.RIPPLE, 2, {life: [.8, 1.1], size: [220, 320], c: [0, 2], delay: [0, .12]}), motes(22), glints(6), streaks(10)]),
    cards: K(['#fffaf3', '#DB1F74', '#f2c35b'], [flash(.5), L(E.CARD, 16, {sp: [300, 820], life: [1.3, 2.1], size: [18, 30], aspect: .7, g: 420, drag: 1.6, spin: [-3, 3], tumble: [3, 8], c: [1, 2]}), glints(6)]),
    smoke: K(['#d9cfd6', '#a99aa6', '#efe8ee'], [L(E.PUFF, 10, {sp: [40, 200], life: [1.2, 2.2], size: [60, 140], g: -50, drag: 2.4, grow: 1.6}), motes(6)]),
    gold: K(['#ffd25e', '#c8902a', '#fff1c2'], [flash(.8), ring(.6), L(E.FOIL, 30, {sp: [300, 900], life: [1.3, 2.2], size: [6, 11], aspect: .6, g: 360, drag: 2.2, turb: [22, 2], spin: [-4, 4], tumble: [5, 12]}), streaks(22, {c: ['h', 0]}), glints(8), motes(14)]),
    leaves: K(['#86b85f', '#c9a227', '#e0782f'], [L(E.LEAF, 22, {sp: [120, 420], life: [2, 3.2], size: [14, 24], aspect: .62, g: 90, drag: 1.7, turb: [44, 1.8], spin: [-3, 3], tumble: [2, 6]}), motes(8)]),
    lightning: K(['#d8f1ff', '#7fb8ff', '#ffffff'], [flash(1), L(E.ARC, 6, {life: [.14, .26], size: [120, 240], c: ['h', 0], randomAngle: true}), streaks(28, {sp: [600, 1400], c: ['h', 1]}), glints(6), ring(.6, {c: [1]})]),
    neon: K(['#ff3fd1', '#3ff3ff', '#b3ff3f'], [flash(.5), L(E.NEON, 18, {sp: [200, 700], life: [.4, .9], size: [3, 5], aspect: [6, 16], drag: 3, alignV: true}), streaks(16), ring(.5, {c: [1]})]),
    bats: K(['#3a2438', '#7a2a6a', '#2a1a33'], [L(E.INK, 6, {sp: [40, 200], life: [1, 1.5], size: [50, 110], drag: 4, c: [0, 2]}), motes(12, {c: [1]})]),
    gears: K(['#c9a24a', '#a0a7b4', '#e2c27a'], [flash(.6, {c: [2]}), L(E.SHARD, 16, {sp: [300, 800], life: [.9, 1.5], size: [8, 16], aspect: .8, g: 500, drag: 1.6, spin: [-6, 6], tumble: [6, 12]}), streaks(22, {c: ['#ffb347', 'h'], g: 520}), glints(4)]),
    feathers: K(['#ffffff', '#f3e6ff', '#ffe1ee'], [L(E.FEATHER, 14, {sp: [120, 380], life: [2.2, 3.4], size: [18, 32], aspect: .5, g: 50, drag: 2.2, turb: [46, 1.4], spin: [-1.4, 1.4], tumble: [1.5, 4]}), motes(16, {c: [1, 2]})]),
    coins: K(['#ffd25e', '#c8902a', '#fff1c2'], [flash(.6), L(E.COIN, 16, {sp: [380, 900], life: [1.1, 1.7], size: [14, 22], g: 760, drag: 1.1, spin: [-1, 1], tumble: [6, 14], c: [0]}), glints(8), streaks(12, {c: ['h', 0]})]),
    steam: K(['#ffffff', '#eef2f7', '#dfe6ef'], [L(E.PUFF, 7, {sp: [60, 200], life: [1.1, 2], size: [36, 80], g: -180, drag: 2, grow: 1.5, int: .75}), motes(8)]),
  };
  // 命中招式：形态目录的 hit 字段 → [底层配方, 额外层]。fx.hit(name, 目标, {crit, palette, angle, form})。
  const HITS = {
    pop: ['confetti', [streaks(12)]], stamp: ['ink', [ring(.8, {c: [2]})]], shard: ['crystal', []],
    rainbow: ['sparkle', [streaks(20, {c: ['#ff6f9f', '#ffd36e', '#6fd3ff', '#9be27f']})]], lens: ['sparkle', [flash(1.3), glints(8, {size: [30, 64]})]],
    coin: ['coins', []], ping: ['sparkle', [L(E.RIPPLE, 1, {life: [.5, .6], size: [140, 160], c: [0]})]], flame: ['embers', []], carpet: ['gold', [streaks(10)]],
    sparkle: ['sparkle', []], slash: ['sparkle', [crescent(1)]], sprinkle: ['confetti', []], heart: ['hearts', []], constellation: ['stars', [glints(10)]],
    brush: ['ink', [crescent(1.1, {c: [0], normal: true})]], glow: ['sparkle', [motes(24)]], glitch: ['neon', []],
    shuriken: ['sparkle', [crescent(.7), glints(6)]], steam: ['steam', []], flake: ['snow', []],
    aurora: ['sparkle', [streaks(18, {c: ['#7dffc9', '#6fd3ff', '#c39bff'], stretch: .07, sp: [300, 700], g: -60})]],
  };
  const PRESETS = ['burst', 'slash', 'spell', 'curtain', 'ink', 'warp', 'rain', 'stamp', 'beam'];
  const PRESET_LABEL = {burst: '新星', slash: '一闪', spell: '法阵', curtain: '谢幕', ink: '泼墨', warp: '跃迁', rain: '星落', stamp: '落印', beam: '天光'};
  const PRESET_EN = {burst: 'NOVA', slash: 'SEVER', spell: 'ARCANA', curtain: 'ENCORE', ink: 'SUMI-E', warp: 'HYPERDRIVE', rain: 'STARFALL', stamp: 'SEAL', beam: 'RADIANCE'};
  // 过场构图：条带角度（弧度，逆时针为正）、条带半高（屏高比例）、条带中心（屏高单位，y 向上）。着色器和文字排版共用这一份。
  const PRESET_GEO = {burst: {theta: -.16, h: .2, c: [0, .02]}, slash: {theta: -.36, h: .19, c: [0, .02]}, spell: {theta: -.12, h: .16, c: [0, .15]},
    curtain: {theta: 0, h: .24, c: [0, .03]}, ink: {theta: 0, h: .27, c: [-.3, .02]}, warp: {theta: 0, h: .3, c: [-.3, .02]},
    rain: {theta: -.08, h: .19, c: [0, .04]}, stamp: {theta: -.12, h: .19, c: [0, .03]}, beam: {theta: 0, h: .19, c: [0, .02]}};
  const PRESET_TIMING = {burst: 1.8, slash: 1.7, spell: 2.3, curtain: 2.2, ink: 2.2, warp: 2, rain: 2.1, stamp: 1.9, beam: 1.9};

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
  const GLSL_LIB = `
    const float PI = 3.14159265;
    float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
    mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
    float seg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
    float fill(float d){ float w = max(fwidth(d), 1e-4); return 1.0 - smoothstep(-w, w, d); }
    float hair(float d, float w){ return 1.0 - smoothstep(w * 0.45, w * 1.5, d); }
    // 法阵：同心细环 + 刻度 + 符文环 + 六芒星 + 节点小圆。uv 是未压扁的圆坐标，draw 描线进度，w 线宽（uv 单位）。
    float sigilLines(vec2 uv, float draw, float t, float w){
      float r = length(uv), a01 = atan(uv.y, uv.x) / (2.0 * PI) + 0.5, L = 0.0;
      L += hair(abs(r - 0.97), w) * step(a01, draw);
      L += hair(abs(r - 0.935), w) * step(1.0 - a01, draw) * 0.8;
      float ta = fract(a01 + t * 0.018), cell = fract(ta * 120.0), major = step(0.95, fract(floor(ta * 120.0) / 10.0 + 0.001));
      float tlen = mix(0.022, 0.05, major);
      L += hair(abs(cell - 0.5) * (2.0 * PI * r / 120.0), w) * step(0.902 - tlen, r) * step(r, 0.902) * step(ta, draw);
      L += hair(abs(r - 0.845), w) * step(fract(a01 + 0.25), draw);
      float ga = fract(a01 - t * 0.03), gi = floor(ga * 40.0);
      vec2 gq = vec2((fract(ga * 40.0) - 0.5) * (2.0 * PI * 0.775 / 40.0) / 0.04, (r - 0.775) / 0.04);
      float gd = 9.0;
      for (int s = 0; s < 3; s++) {
        float h1 = hash(vec2(gi, float(s) * 7.1)), h2 = hash(vec2(gi + 3.0, float(s) * 3.7 + 1.0));
        vec2 A = vec2(floor(h1 * 3.0) - 1.0, floor(fract(h1 * 7.0) * 3.0) - 1.0) * vec2(0.42, 0.8);
        vec2 B = vec2(floor(h2 * 3.0) - 1.0, floor(fract(h2 * 7.0) * 3.0) - 1.0) * vec2(0.42, 0.8);
        if (length(A - B) > 0.1) gd = min(gd, seg(gq, A, B));
      }
      L += hair(gd * 0.04, w) * step(abs(gq.y), 1.2) * step(ga, draw) * 0.85;
      L += hair(abs(r - 0.70), w) * step(fract(a01 + 0.5), draw);
      vec2 hp = rot(t * 0.05) * uv;
      float hd = 9.0, nd = 9.0;
      for (int i = 0; i < 6; i++) {
        float a0 = float(i) * PI / 3.0 + PI * 0.5;
        vec2 A = 0.70 * vec2(cos(a0), sin(a0)), B = 0.70 * vec2(cos(a0 + 2.0 * PI / 3.0), sin(a0 + 2.0 * PI / 3.0));
        hd = min(hd, seg(hp, A, mix(A, B, clamp(draw * 1.5 - float(i) * 0.07, 0.0, 1.0))));
        nd = min(nd, abs(length(hp - A) - 0.055));
      }
      L += hair(hd, w) + hair(nd, w) * step(0.55, draw);
      L += hair(abs(r - 0.36), w) * step(a01, draw) + hair(abs(r - 0.33), w) * step(1.0 - a01, draw) * 0.7;
      return min(L, 1.6);
    }`;
  const PARTICLE_VS = `
    attribute vec2 aP0; attribute vec2 aVel; attribute vec2 aAcc; attribute vec4 aTime; attribute vec3 aColor; attribute vec4 aMot; attribute vec4 aRot; attribute vec4 aExt;
    uniform float uTime; uniform vec2 uRes; uniform vec2 uShake;
    varying vec2 vUv; varying vec3 vColor; varying float vAlpha; varying float vShape; varying float vLife; varying float vSeed; varying vec2 vSize; varying float vSpin; varying float vTumble; varying float vInt;
    void main(){
      float t = uTime - aTime.x, life = aTime.y;
      if (t < 0.0 || t > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      float shape = aTime.z, size = aTime.w, seed = aRot.w, u = t / life;
      float k = aMot.x, e = exp(-k * t), dt = k > 0.001 ? (1.0 - e) / k : t;
      vec2 p = aP0 + aVel * dt + 0.5 * aAcc * t * t;
      vec2 v = aVel * (k > 0.001 ? e : 1.0) + aAcc * t;
      float ta = aMot.y, tf = aMot.z, ph = seed * 37.0;
      p += ta * vec2(sin(tf * t + ph) - sin(ph) + 0.5 * (sin(2.3 * tf * t + ph * 1.7) - sin(ph * 1.7)), 0.6 * (cos(0.7 * tf * t + ph * 0.9) - cos(ph * 0.9)));
      v += ta * tf * vec2(cos(tf * t + ph) + 1.15 * cos(2.3 * tf * t + ph * 1.7), -0.42 * sin(0.7 * tf * t + ph * 0.9));
      vec2 q = position.xy;
      vec2 sz = vec2(size * aExt.x, size);
      float ang = aRot.x + aRot.y * t;
      float tumble = cos(aExt.y * t + seed * 6.2831);
      float scale = (1.0 + aRot.z * u) * smoothstep(0.0, 0.05, u);
      if (shape < 0.5) {                                   // 流光：沿速度拉长，头在粒子位置，尾巴拖在后面
        float len = clamp(length(v) * aMot.w, size * 2.0, size * 70.0);
        sz = vec2(len, size * 3.0); ang = atan(v.y, v.x); scale = 1.0; q.x -= 0.42;
      } else if (shape > 3.5 && shape < 4.5) { sz = vec2(size * 3.2, size); ang = 0.0; scale = 1.0; }          // 闪光（横向变形镜头光）
      else if ((shape > 2.5 && shape < 3.5) || (shape > 20.5 && shape < 21.5)) { ang = 0.0; scale = 1.0; }    // 冲击环 / 声波：半径在片元里算
      else if (shape > 14.5 && shape < 15.5) { sz = vec2(size, size * 0.34); scale = 1.0; }                    // 电弧
      else if (shape > 15.5 && shape < 16.5) { sz = vec2(size, size * aExt.z); ang = 0.0; scale = 1.0; }       // 法阵：压扁成地面透视
      else if (shape > 22.5) { sz = vec2(size * 0.36, size * 2.4); q.y -= 0.5; ang = 0.0; scale = 1.0; }       // 光柱：底边在粒子位置
      else if (shape > 21.5) { scale = 1.0; }                                                                 // 弧形斩
      bool flips = (shape > 4.5 && shape < 7.5) || (shape > 13.5 && shape < 14.5) || (shape > 16.5 && shape < 19.5);
      if (flips) q.x *= mix(0.07, 1.0, abs(tumble));
      vec2 local = q * sz * scale;
      float c = cos(ang), s = sin(ang);
      p += vec2(c * local.x - s * local.y, s * local.x + c * local.y) + uShake;
      gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
      vUv = position.xy * 2.0; vColor = aColor; vShape = shape; vLife = u; vSeed = seed; vSize = sz * max(scale, 0.05); vSpin = ang; vTumble = tumble; vInt = aExt.w;
      vAlpha = smoothstep(0.0, 0.03, u) * (1.0 - smoothstep(0.62, 1.0, u));
    }`;
  const PARTICLE_FS = `
    precision highp float;
    uniform float uGlow; uniform float uDark; uniform float uTime; uniform float uAdd;
    varying vec2 vUv; varying vec3 vColor; varying float vAlpha; varying float vShape; varying float vLife; varying float vSeed; varying vec2 vSize; varying float vSpin; varying float vTumble; varying float vInt;
    ${GLSL_LIB}
    // 发光：白热核心 → 本色 → 衰减。浅色纸面上核心不那么白、颜色更饱和，并且盖住一部分底色，否则在奶油色纸上看不见。
    vec4 light(vec3 col, float core, float glow){
      vec3 c = mix(col, vec3(1.0), clamp(core * mix(0.2, 1.0, uDark), 0.0, 1.0));
      float a = clamp(core + glow * uGlow * mix(0.7, 1.0, uDark), 0.0, 1.0);
      return vec4(c * a, a * mix(0.86, 0.0, uDark));
    }
    vec4 solid(vec3 col, float a){ return vec4(col * a, a); }
    float star5(vec2 p, float r, float rf){
      const vec2 k1 = vec2(0.809016994, -0.587785252), k2 = vec2(-0.809016994, -0.587785252);
      p.x = abs(p.x); p -= 2.0 * max(dot(k1, p), 0.0) * k1; p -= 2.0 * max(dot(k2, p), 0.0) * k2; p.x = abs(p.x); p.y -= r;
      vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0); float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
      return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
    }
    vec4 fStreak(vec2 uv){
      float along = uv.x * 0.5 + 0.5, d = abs(uv.y);
      float w = mix(0.05, 0.34, pow(along, 1.3));
      float body = (1.0 - smoothstep(0.8, 1.0, uv.x)) * pow(along, 1.5);
      float age = 1.0 - vLife * 0.55;
      return light(vColor, (1.0 - smoothstep(w * 0.45, w, d)) * body * age, exp(-d * d / (w * w * 5.0 + 0.002)) * body * 0.55 * age);
    }
    vec4 fMote(vec2 uv){
      float r = length(uv), tw = 0.7 + 0.3 * sin(uTime * (5.0 + vSeed * 9.0) + vSeed * 50.0), edge = 1.0 - smoothstep(0.7, 1.0, r);
      return light(vColor, exp(-r * r * 26.0) * tw * edge, exp(-r * r * 4.5) * 0.6 * tw * edge);
    }
    vec4 fGlint(vec2 uv){
      vec2 p = rot(vSpin) * uv; float th = 2.6 / vSize.x;
      float rh = (1.0 - smoothstep(th * 0.3, th * 1.6, abs(p.y))) * pow(max(0.0, 1.0 - abs(p.x)), 2.4);
      float rv = (1.0 - smoothstep(th * 0.3, th * 1.6, abs(p.x))) * pow(max(0.0, 1.0 - abs(p.y)), 2.4);
      vec2 d = rot(0.7854) * p;
      float rd = ((1.0 - smoothstep(th * 0.2, th * 1.2, abs(d.y))) * pow(max(0.0, 1.0 - abs(d.x) * 1.9), 2.0) + (1.0 - smoothstep(th * 0.2, th * 1.2, abs(d.x))) * pow(max(0.0, 1.0 - abs(d.y) * 1.9), 2.0)) * 0.35;
      float r = length(p), tw = 0.55 + 0.45 * sin(uTime * (7.0 + vSeed * 6.0) + vSeed * 40.0);
      return light(vColor, (rh + rv + rd) * tw + exp(-r * r * 110.0), exp(-r * r * 14.0) * 0.35 * tw);
    }
    vec4 fRing(vec2 uv){
      float r = length(uv), u = vLife, R = 0.06 + 0.9 * (1.0 - pow(1.0 - u, 3.0));
      float th = mix(0.035, 1.8 / vSize.x, pow(u, 0.5)), dd = abs(r - R), fade = pow(1.0 - u, 1.8);
      float inner = (1.0 - smoothstep(0.0, R, r)) * 0.07 * (1.0 - u);
      return light(vColor, (1.0 - smoothstep(th * 0.4, th, dd)) * fade * 0.9, (exp(-dd * dd / (th * th * 8.0 + 1e-5)) * 0.35 + inner) * fade);
    }
    vec4 fFlash(vec2 uv){
      vec2 c = vec2(uv.x * 3.2, uv.y); float r = length(c), u = vLife;
      float k = smoothstep(0.0, 0.05, u) * pow(1.0 - u, 2.6);
      float streak = exp(-uv.y * uv.y * 300.0) * pow(max(0.0, 1.0 - abs(uv.x)), 1.4);
      return light(vColor, (exp(-r * r * 18.0) + streak * 0.75) * k, exp(-r * r * 3.0) * 0.32 * k);
    }
    vec4 fShard(vec2 uv){
      float kx = 0.42 + 0.32 * hash(vec2(vSeed, 3.1)), sk = (hash(vec2(vSeed, 5.7)) - 0.5) * 0.5;
      vec2 p = vec2(uv.x, uv.y + sk * uv.x);
      float d = (abs(p.x) / kx + abs(p.y)) - 0.94;
      float inside = fill(d * kx * 0.7);
      float facet = step(0.0, p.x * vTumble + p.y * 0.3);
      float lit = mix(0.42, 1.0, facet) * (0.55 + 0.45 * abs(vTumble));
      float edge = 1.0 - smoothstep(0.0, 0.1, abs(d));
      vec3 col = vColor * lit + vec3(1.0) * (pow(abs(vTumble), 22.0) * 0.9 + edge * 0.32);
      return solid(col, inside * (0.8 + 0.2 * facet));
    }
    vec4 fFoil(vec2 uv){
      float inside = fill(max(abs(uv.x), abs(uv.y)) - 0.92), f = abs(vTumble);
      float sheen = 1.0 - smoothstep(0.0, 0.32, abs(uv.x * 0.6 + uv.y * 0.8 - vTumble * 1.6));
      vec3 base = vColor * (vTumble > 0.0 ? 1.0 : 0.7);
      vec3 col = base * (0.4 + 0.72 * f * f) + vec3(1.0) * (pow(f, 28.0) * 0.85 + sheen * 0.32 * f);
      return solid(col, inside);
    }
    vec4 fPetal(vec2 uv){
      float y = -uv.y, w = 0.72 * sqrt(max(0.0, 1.0 - y * y)) * (0.8 + 0.3 * y);
      float notch = 0.2 * (1.0 - smoothstep(0.0, 0.1, abs(uv.x))) * smoothstep(0.55, 1.0, y);
      float inside = fill(max(abs(uv.x) - w, y - 1.0 + notch));
      vec3 col = mix(vColor * 0.8, mix(vColor, vec3(1.0), 0.42), smoothstep(-1.0, 1.0, y));
      col -= (1.0 - smoothstep(0.0, 0.03, abs(uv.x))) * smoothstep(1.0, -0.6, y) * 0.1;
      col *= (0.66 + 0.34 * abs(vTumble)) * (vTumble > 0.0 ? 1.0 : 0.88);
      return solid(col, inside * 0.95);
    }
    vec4 fInk(vec2 uv){
      float r = length(uv), n = fbm(uv * 2.4 + vSeed * 13.0), u = vLife;
      float spread = mix(0.32, 0.92, 1.0 - pow(1.0 - min(u * 2.2, 1.0), 3.0));
      float d = r - spread * (0.78 + (n - 0.5) * 0.55);
      float inside = 1.0 - smoothstep(-0.04, 0.03, d), pool = smoothstep(-0.18, 0.0, d) * 0.22;
      float erosion = smoothstep(0.55, 0.8, n + (1.0 - u) * 1.1), grain = 0.9 + 0.1 * noise(uv * 30.0 + vSeed);
      float wash = 0.55 + 0.45 * fbm(uv * 4.0 + vSeed * 7.0);
      return solid(vColor * (1.0 - pool * 0.5), inside * (0.5 + pool) * wash * grain * erosion);
    }
    vec4 fPuff(vec2 uv){
      float r = length(uv), n = fbm(uv * 1.7 + vec2(vSeed * 9.0, uTime * 0.12));
      float body = 1.0 - smoothstep(0.25, 1.0, r + (n - 0.5) * 0.7);
      return solid(vColor * (0.86 + 0.24 * n), body * smoothstep(0.35, 0.7, n + (1.0 - vLife) * 0.8) * 0.42);
    }
    vec4 fEmber(vec2 uv){
      float r = length(uv), fl = 0.55 + 0.45 * sin(uTime * (22.0 + vSeed * 18.0) + vSeed * 90.0);
      vec3 col = mix(vec3(1.0, 0.93, 0.72), vColor, smoothstep(0.0, 0.7, vLife));
      return light(col, exp(-r * r * 16.0) * fl, exp(-r * r * 3.5) * 0.5 * fl);
    }
    vec4 fBokeh(vec2 uv){
      vec2 p = vec2(abs(uv.x), -uv.y) * 0.62 + vec2(0.0, 0.5);
      float d;
      if (p.y + p.x > 1.0) d = length(p - vec2(0.25, 0.75)) - 0.35355;
      else d = sqrt(min(dot(p - vec2(0.0, 1.0), p - vec2(0.0, 1.0)), dot(p - 0.5 * max(p.x + p.y, 0.0), p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
      float a = (1.0 - smoothstep(-0.09, 0.07, d)) * 0.5 + (1.0 - smoothstep(0.0, 0.06, abs(d + 0.04))) * 0.22;
      return light(vColor, a * 0.55, a * 0.3);
    }
    vec4 fBubble(vec2 uv){
      float r = length(uv), rim = 1.0 - smoothstep(0.0, 0.07 + 4.0 / vSize.x, abs(r - 0.9));
      vec3 film = 0.55 + 0.45 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + atan(uv.y, uv.x) * 0.16 + r * 1.3 + vSeed + uTime * 0.15));
      float hl = exp(-dot(uv - vec2(-0.38, -0.42), uv - vec2(-0.38, -0.42)) * 40.0);
      float body = (1.0 - smoothstep(0.86, 0.9, r)) * 0.06;
      vec3 col = mix(vColor, film, 0.65);
      return vec4(col * (rim * 0.6 + body) + vec3(1.0) * hl * 0.9, rim * 0.6 + body + hl * 0.9);
    }
    vec4 fFlake(vec2 uv){
      vec2 p = rot(vSpin) * uv; float r = length(p), a = atan(p.y, p.x), sec = PI / 3.0;
      a = mod(a + sec * 0.5, sec) - sec * 0.5;
      vec2 q = vec2(cos(a), abs(sin(a))) * r; float px = 2.0 / vSize.x;
      float d = min(min(seg(q, vec2(0.0), vec2(0.92, 0.0)), seg(q, vec2(0.42, 0.0), vec2(0.62, 0.2))), min(seg(q, vec2(0.66, 0.0), vec2(0.8, 0.13)), seg(q, vec2(0.22, 0.0), vec2(0.3, 0.09))));
      return light(vColor, 1.0 - smoothstep(px * 0.45, px * 1.3, d), exp(-d * d / (px * px * 10.0)) * 0.15);
    }
    vec4 fCoin(vec2 uv){
      float r = length(uv), inside = fill(r - 0.96), f = abs(vTumble);
      float shade = 0.7 + 0.32 * (-uv.y) * (0.4 + 0.6 * f);
      float emb = 1.0 - smoothstep(0.0, 0.035, abs(star5(uv / 0.5, 0.8, 0.45) * 0.5));
      vec3 face = vColor * shade * (1.0 + emb * 0.3 * (uv.y < 0.0 ? 1.0 : -0.6));
      vec3 col = mix(face, vColor * 0.7, smoothstep(0.78, 0.82, r) - (1.0 - smoothstep(0.0, 0.02, abs(r - 0.8))) * 0.3);
      col = mix(vColor * 0.5, col, smoothstep(0.08, 0.3, f)) + vec3(1.0) * pow(f, 30.0) * 0.75 * (1.0 - r);
      return solid(col, inside);
    }
    vec4 fArc(vec2 uv){
      float x = uv.x, tt = floor(uTime * 24.0);
      float off = ((noise(vec2(x * 3.0 + vSeed * 10.0, tt)) - 0.5) * 0.9 + (noise(vec2(x * 9.0 + vSeed * 20.0, tt * 1.7)) - 0.5) * 0.35) * (1.0 - smoothstep(0.6, 1.0, abs(x)));
      float d = abs(uv.y - off), px = 2.0 / vSize.y, on = step(0.25, hash(vec2(tt, vSeed))), ends = 1.0 - smoothstep(0.85, 1.0, abs(x));
      return light(vColor, (1.0 - smoothstep(px * 0.6, px * 2.0, d)) * on * ends, exp(-d * d * 30.0) * 0.6 * on * ends);
    }
    vec4 fSigil(vec2 uv){
      float u = vLife, draw = smoothstep(0.0, 0.42, u), fade = 1.0 - smoothstep(0.8, 1.0, u), r = length(uv);
      float w = max(2.2 / vSize.x, fwidth(r) * 1.4);
      float lines = sigilLines(uv, draw, uTime, w);
      float lock = smoothstep(0.4, 0.46, u) * (1.0 - smoothstep(0.46, 0.7, u));
      float glow = exp(-abs(r - 0.7) * 30.0) * 0.12 + (1.0 - smoothstep(0.0, 0.97, r)) * 0.07;
      return light(vColor, (lines * (1.0 + lock * 1.4) + exp(-r * r * 500.0) * 1.5) * fade, glow * fade * (1.0 + lock * 2.0));
    }
    vec4 fLeaf(vec2 uv){
      float w = 0.56 * (1.0 - uv.y * uv.y) * (1.0 + 0.1 * uv.y);
      float inside = fill(max(abs(uv.x) - w, abs(uv.y) - 1.0));
      float vein = (1.0 - smoothstep(0.0, 0.035, abs(uv.x))) * 0.25 + (1.0 - smoothstep(0.0, 0.06, abs(fract((uv.y + abs(uv.x) * 0.8) * 4.0) - 0.5))) * 0.08 * step(abs(uv.x), w * 0.85);
      vec3 col = vColor * (0.7 + 0.3 * abs(vTumble)) * (vTumble > 0.0 ? 1.0 : 0.82);
      col = mix(col * 0.9, col * 1.12, smoothstep(-1.0, 1.0, uv.x * 0.6 - uv.y * 0.4)) * (1.0 - vein * 0.3);
      return solid(col, inside);
    }
    vec4 fFeather(vec2 uv){
      float bend = 0.06 * uv.y * uv.y, w = 0.42 * sqrt(max(0.0, 1.0 - uv.y * uv.y)) * (0.9 - 0.25 * uv.y);
      float d = abs(uv.x + bend) - w, barbs = 0.75 + 0.25 * sin(uv.y * 26.0 + abs(uv.x) * 14.0);
      float shaft = 1.0 - smoothstep(0.0, 0.03, abs(uv.x + bend));
      vec3 col = mix(vColor, vColor * 0.74, shaft * 0.6) * (0.8 + 0.2 * abs(vTumble));
      return solid(col, (1.0 - smoothstep(-0.12, 0.02, d)) * barbs * 0.92 * (1.0 - smoothstep(0.85, 1.0, abs(uv.y))));
    }
    vec4 fCard(vec2 uv){
      vec2 b = abs(uv) - vec2(0.8); float rd = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0) - 0.12;
      float inside = fill(rd), border = 1.0 - smoothstep(0.0, 0.045, abs(rd + 0.15));
      vec3 paper = vec3(1.0, 0.985, 0.965);
      vec3 col = vTumble > 0.0 ? mix(paper, vColor, border * 0.9) : mix(vColor, vColor * 0.76, step(0.5, fract((uv.x + uv.y) * 4.0)) * 0.35);
      col = col * (0.72 + 0.28 * abs(vTumble)) + vec3(1.0) * pow(abs(vTumble), 26.0) * 0.35;
      return solid(col, inside);
    }
    vec4 fNeon(vec2 uv){
      vec2 pp = uv * vSize * 0.5; float L = max(0.0, vSize.x * 0.5 - vSize.y * 0.5), h = vSize.y * 0.5;
      float d = seg(pp, vec2(-L, 0.0), vec2(L, 0.0)), fl = step(0.12, hash(vec2(floor(uTime * 20.0), vSeed)));
      return light(vColor, (1.0 - smoothstep(h * 0.12, h * 0.3, d)) * fl, exp(-d * d / (h * h * 0.18)) * 0.7 * fl);
    }
    vec4 fRipple(vec2 uv){
      float r = length(uv), acc = 0.0, th = 2.4 / vSize.x;
      for (int i = 0; i < 3; i++) {
        float k = clamp(vLife * 1.35 - float(i) * 0.17, 0.0, 1.0), R = 0.1 + 0.88 * (1.0 - pow(1.0 - k, 2.2));
        acc += (1.0 - smoothstep(th * 0.4, th * 1.6, abs(r - R))) * (1.0 - k) * step(0.001, k);
      }
      return light(vColor, acc, acc * 0.4);
    }
    vec4 fCrescent(vec2 uv){
      float r = length(uv), ang = atan(uv.y, uv.x), u = vLife;
      float head = mix(-1.5, 1.6, 1.0 - pow(1.0 - min(u / 0.35, 1.0), 3.0)), trail = 2.2;
      float tp = (ang - (head - trail)) / trail, inArc = step(0.0, tp) * step(tp, 1.0);
      float wv = 0.11 * sin(PI * clamp(tp, 0.0, 1.0)) * (1.0 - u * 0.6) + 0.002, d = abs(r - 0.8);
      float core = (1.0 - smoothstep(wv * 0.3, wv, d)) * inArc * pow(max(tp, 0.0), 0.6), fade = 1.0 - smoothstep(0.45, 1.0, u);
      if (uAdd < 0.5) {   // 墨色斩：正常混合，带干笔飞白
        float dry = smoothstep(0.35, 0.6, noise(vec2(ang * 30.0, d * 80.0) + vSeed * 10.0) + tp * 0.3);
        return solid(vColor, core * fade * dry * 0.95);
      }
      return light(vColor, core * fade, exp(-d * d / (wv * wv * 3.0)) * inArc * max(tp, 0.0) * 0.5 * fade);
    }
    vec4 fPillar(vec2 uv){
      float u = vLife, env = smoothstep(0.0, 0.15, u) * (1.0 - smoothstep(0.6, 1.0, u));
      float vf = smoothstep(-1.0, 0.1, uv.y) * (1.0 - smoothstep(0.85, 1.0, uv.y));
      float stream = 0.6 + 0.4 * noise(vec2(uv.x * 6.0, uv.y * 4.0 + uTime * 3.0));
      return light(vColor, exp(-uv.x * uv.x * 40.0) * vf * env * stream, exp(-uv.x * uv.x * 4.0) * 0.45 * vf * env);
    }
    void main(){
      int s = int(vShape + 0.5); vec2 uv = vUv; vec4 c;
      if (s == 0) c = fStreak(uv); else if (s == 1) c = fMote(uv); else if (s == 2) c = fGlint(uv); else if (s == 3) c = fRing(uv);
      else if (s == 4) c = fFlash(uv); else if (s == 5) c = fShard(uv); else if (s == 6) c = fFoil(uv); else if (s == 7) c = fPetal(uv);
      else if (s == 8) c = fInk(uv); else if (s == 9) c = fPuff(uv); else if (s == 10) c = fEmber(uv); else if (s == 11) c = fBokeh(uv);
      else if (s == 12) c = fBubble(uv); else if (s == 13) c = fFlake(uv); else if (s == 14) c = fCoin(uv); else if (s == 15) c = fArc(uv);
      else if (s == 16) c = fSigil(uv); else if (s == 17) c = fLeaf(uv); else if (s == 18) c = fFeather(uv); else if (s == 19) c = fCard(uv);
      else if (s == 20) c = fNeon(uv); else if (s == 21) c = fRipple(uv); else if (s == 22) c = fCrescent(uv); else c = fPillar(uv);
      c *= vAlpha * vInt;
      if (c.a < 0.0004 && max(c.r, max(c.g, c.b)) < 0.0004) discard;
      gl_FragColor = c;
    }`;
  // 大招切入：页面压暗调色 → 斜切条带（立绘 + 速度线 + 网点）滑入并对焦 → 标题 → 条带收成一线 → 闪光释放。
  // 九种构图共用一套时间轴；角度 / 半高 / 中心由 PRESET_GEO 传进来，DOM 标题按同一份数据排版。
  const CINE_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const CINE_FS = `
    precision highp float;
    varying vec2 vUv;
    uniform float uT, uTime, uPreset, uDur, uArtOk, uArtAspect, uArtScale, uDof, uFade, uTheta, uH0;
    uniform vec2 uRes, uFocus, uBc;
    uniform vec3 uC0, uC1, uC2;
    uniform sampler2D uArt;
    ${GLSL_LIB}
    float eOut(float x){ x = clamp(x, 0.0, 1.0); return 1.0 - pow(1.0 - x, 4.0); }
    float eIn(float x){ x = clamp(x, 0.0, 1.0); return x * x * x; }
    float win(float x, float a, float b){ return clamp((x - a) / (b - a), 0.0, 1.0); }
    vec4 over(vec4 top, vec4 under){ return top + under * (1.0 - top.a); }
    vec4 art(vec2 a, float bias){
      if (uArtOk < 0.5 || a.x < 0.0 || a.y < 0.0 || a.x > 1.0 || a.y > 1.0) return vec4(0.0);
      return texture2D(uArt, vec2(a.x, 1.0 - a.y), bias);
    }
    void main(){
      float asp = uRes.x / uRes.y, px = 1.0 / uRes.y, aa = px * 1.2;
      vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
      float T = uT, s = uT * uDur;
      int P = int(uPreset + 0.5);
      bool paper = P == 4;
      float dimIn = eOut(win(T, 0.0, 0.12)), bandK = eOut(win(T, 0.05, 0.27)), coll = eIn(win(T, 0.76, 0.86)), outK = win(T, 0.84, 1.0);
      float dimA = dimIn * (1.0 - eOut(P == 4 ? win(T, 0.74, 0.92) : outK));
      vec3 deep = mix(uC1 * 0.3, vec3(0.025, 0.018, 0.04), 0.6);
      float vig = smoothstep(1.3, 0.2, length(p * vec2(0.72, 1.0)));
      vec3 bgc = paper ? vec3(0.965, 0.94, 0.915) * (0.95 + 0.05 * vig) : deep * (0.5 + 0.7 * vig);
      vec4 C = vec4(bgc, 1.0) * dimA * (paper ? 0.93 : 0.82);
      vec3 hot = mix(uC2, vec3(1.0), 0.35);

      // ── 底层：环境速度线 / 预设专属背景 ──
      if (!paper) {
        float row = floor((p.y + 2.0) * 150.0), hr = hash(vec2(row, 1.7));
        float sl = step(0.84, hr) * smoothstep(0.72, 1.0, fract(p.x * (0.25 + hr * 0.4) - s * (0.6 + hr * 1.6) + hr * 9.0));
        C.rgb += uC2 * sl * 0.09 * dimA * (1.0 - coll);
      }
      if (P == 2) {        // 法阵：地面上的透视法阵 + 光柱
        vec2 sc = vec2(-0.36, -0.3), sq = (p - sc) / vec2(0.56, 0.56 * 0.34);
        float w = max(px * 1.4 / 0.56, fwidth(length(sq)) * 1.3);
        float lines = sigilLines(sq, smoothstep(0.03, 0.42, T), uTime, w) * (1.0 - win(T, 0.8, 0.95));
        float lock = smoothstep(0.42, 0.46, T) * (1.0 - smoothstep(0.46, 0.62, T));
        C.rgb += hot * lines * dimA * (1.0 + lock * 0.7);
        C.rgb += uC2 * exp(-abs(length(sq) - 0.7) * 12.0) * 0.06 * dimA;
        float pil = exp(-(p.x + 0.36) * (p.x + 0.36) * 90.0) * smoothstep(-0.32, 0.5, p.y) * (1.0 - smoothstep(0.3, 0.9, p.y)) * smoothstep(0.2, 0.4, T) * (1.0 - coll);
        C.rgb += hot * pil * 0.35;
      } else if (P == 3) { // 谢幕：顶光聚光灯 + 体积雾
        float cone = abs(p.x) - (0.06 + (0.5 - p.y) * 0.32);
        float spot = (1.0 - smoothstep(-0.12, 0.02, cone)) * smoothstep(-0.6, 0.5, p.y) * smoothstep(0.02, 0.2, T);
        float haze = 0.7 + 0.3 * fbm(p * 4.0 + vec2(0.0, -s * 0.15));
        C.rgb += mix(vec3(1.0, 0.92, 0.78), uC2, 0.3) * spot * haze * 0.16 * dimA;
      } else if (P == 5) { // 跃迁：向心星流
        vec2 q = p - uBc; float r = length(q), an = atan(q.y, q.x) * 160.0 / PI, cell = floor(an), h = hash(vec2(cell, 9.1));
        float lx = abs(fract(an) - 0.5) * (r * PI / 160.0) / px;          // 到本格中线的像素距离
        float f = fract(r * (0.9 + h) - s * (1.4 + h * 2.0) + h * 7.0);
        float line = (1.0 - smoothstep(0.4, 1.4, lx)) * step(0.78, h) * pow(smoothstep(0.55, 1.0, f), 2.0) * smoothstep(0.14, 0.7, r);
        C.rgb += mix(uC2, vec3(1.0), 0.65) * line * 0.75 * dimA * (1.0 - coll);
      } else if (P == 6) { // 星落：斜落的流星
        vec2 q = rot(0.32) * p; float col = floor(q.x * 90.0), h = hash(vec2(col, 4.4));
        float lx = abs(fract(q.x * 90.0) - 0.5) / 90.0 / px;
        float f = fract(q.y * (0.35 + h * 0.5) + s * (0.9 + h * 1.4) + h * 5.0);
        float line = (1.0 - smoothstep(0.35, 1.3, lx)) * step(0.8, h) * pow(smoothstep(0.7, 1.0, f), 4.0);
        C.rgb += mix(uC2, vec3(1.0), 0.6) * line * 0.85 * dimA * (1.0 - coll);
      }

      // ── 条带 ──
      vec2 b = rot(-uTheta) * (p - uBc);
      float open = 1.0, lead = -9.0;
      if (P == 0 || P == 2 || P == 6 || P == 7) lead = mix(asp * 1.3, -asp * 1.3, bandK);
      else if (P == 1 || P == 8) open = eOut(win(T, 0.12, 0.3));
      float H = uH0 * open * (1.0 - coll);
      float leadM = lead > -8.0 ? smoothstep(lead - aa * 2.0, lead + aa * 2.0, b.x + b.y * 0.45) : 1.0;
      if (P == 3) leadM = 1.0 - smoothstep(asp * 0.75 * bandK - aa, asp * 0.75 * bandK + aa, abs(b.x));
      float mask = (1.0 - smoothstep(H - aa, H + aa, abs(b.y))) * leadM;
      float inkRim = 0.0;
      if (P == 4) {        // 泼墨：墨迹边缘的不规则遮罩
        vec2 ip = (p - uBc) * vec2(0.6, 1.0);
        float R = (0.06 + 0.3 * eOut(win(T, 0.04, 0.3))) * (1.0 - coll);
        float d = length(ip) - R * (0.86 + (fbm(p * 3.0 + 4.0) - 0.5) * 0.55 + (fbm(p * 11.0 + 9.0) - 0.5) * 0.14);
        mask = 1.0 - smoothstep(-0.006, 0.006, d);
        inkRim = smoothstep(-0.07, 0.0, d) * mask;
        leadM = 1.0;
      } else if (P == 5) { // 跃迁：圆形光圈
        float R = 0.34 * eOut(win(T, 0.07, 0.3)) * (1.0 - coll);
        mask = 1.0 - smoothstep(R - aa, R + aa, length(p - uBc));
      }
      // 第二条（强调色）错开半拍跟进，做出层次
      if (!paper && P != 5 && P != 3) {
        vec2 b2 = rot(-(uTheta + 0.05)) * (p - uBc - vec2(0.0, -0.018));
        float lead2 = lead > -8.0 ? mix(asp * 1.5, -asp * 1.3, eOut(win(T, 0.09, 0.33))) : -9.0;
        float H2 = uH0 * 1.15 * open * (1.0 - eIn(win(T, 0.73, 0.83)));
        float m2 = (1.0 - smoothstep(H2 - aa, H2 + aa, abs(b2.y))) * (lead2 > -8.0 ? smoothstep(lead2 - aa, lead2 + aa, b2.x + b2.y * 0.45) : 1.0);
        C = over(vec4(mix(deep, uC2, 0.62), 1.0) * m2 * 0.9, C);
      }
      // 条带底：主色到深色的渐变、网点、速度线
      vec3 bb = mix(deep * 1.4, mix(deep, uC1, 0.78), smoothstep(-asp * 0.6, asp * 0.55, b.x));
      bb += uC0 * 0.16 * smoothstep(-uH0 * 0.2, uH0, b.y) * smoothstep(-asp * 0.3, asp * 0.5, b.x);
      bb *= 0.8 + 0.2 * (1.0 - smoothstep(0.0, uH0, abs(b.y)));
      if (paper) { float wash = fbm(p * 5.0 + 3.0); bb = mix(vec3(0.055, 0.04, 0.05), vec3(0.16, 0.12, 0.14), wash * wash) + uC1 * 0.04; }
      vec2 hc = fract(rot(0.785) * p * uRes.y / 6.5) - 0.5;
      float dotR = 0.12 + 0.24 * smoothstep(-0.1, asp * 0.5, b.x);
      if (!paper) bb = mix(bb, bb * 1.22 + uC2 * 0.06, (1.0 - smoothstep(dotR - 0.07, dotR + 0.07, length(hc))) * 0.32);
      float brow = floor(b.y * 130.0), bh = hash(vec2(brow, 3.3));
      if (!paper) bb += vec3(1.0) * step(0.58, bh) * smoothstep(0.62, 1.0, fract(b.x * (0.3 + bh * 0.5) + s * (2.0 + bh * 3.0) + bh * 13.0)) * 0.11;
      // 立绘：焦点落在条带中线偏左，轻微漂移；先虚后实（对焦）；残影；投影；轮廓光
      float artH = uH0 * 2.0 * 2.15 * uArtScale;
      vec2 artC = vec2(-asp * 0.17 - s * 0.022 + (1.0 - bandK) * 0.22, uH0 * 0.5);
      if (P == 3) artC.x = -asp * 0.06 - s * 0.012;
      if (P == 4) { artC = vec2(0.02 - s * 0.01, -0.02); artH *= 0.66; }
      if (P == 5) { artC = vec2(0.0, uH0 * 0.12); artH *= 0.82; }
      vec2 au = (b - artC) / artH; au = vec2(au.x / uArtAspect, -au.y) + uFocus;
      float bias = uDof > 0.5 ? 4.5 * (1.0 - smoothstep(0.15, 0.42, T)) : 0.0;
      vec4 A = art(au, bias);
      vec4 Ec = art(au + vec2(0.06 * (1.0 - bandK) + 0.018, 0.0), 2.5);
      vec4 Sh = art(au + vec2(-0.014, -0.02), 3.5);
      vec4 Rm = art(au + vec2(-0.007, 0.007), 1.0);
      float rim = clamp(A.a - Rm.a, 0.0, 1.0);
      vec3 ar = A.rgb * 0.95 + uC1 * 0.05 * A.a + hot * rim * 1.4;
      vec4 band = vec4(bb * (1.0 - Sh.a * 0.45), 1.0);
      float echo = 0.42 * (1.0 - smoothstep(0.1, 0.42, T));
      band = over(vec4(uC2 * Ec.a * echo, Ec.a * echo), band);
      if (P == 4) band.rgb = mix(band.rgb, vec3(0.04, 0.03, 0.035), inkRim * 0.85);
      C = over(band * mask * dimIn, C);
      // 角色破框：下边被条带裁掉，头可以伸出条带上沿（泼墨 / 跃迁留在遮罩里）
      float charM = (P == 4 || P == 5) ? mask : smoothstep(-H - aa, -H + aa, b.y) * leadM * (1.0 - smoothstep(H + uH0 * 1.3, H + uH0 * 1.4, b.y)) * (1.0 - coll) * step(0.0005, H);
      C = over(vec4(ar, A.a) * charM * dimIn, C);
      // 边线：强调色 2px + 外侧白色细线；天光 / 一闪打开时边线更亮
      if (P != 4 && P != 5) {
        float edgeBoost = (P == 8 || P == 1) ? 1.0 + 2.5 * (1.0 - open) : 1.0;
        float e1 = (1.0 - smoothstep(px * 0.8, px * 2.4, abs(abs(b.y) - H))) * leadM * step(0.0005, H);
        float e2 = (1.0 - smoothstep(px * 0.4, px * 1.3, abs(abs(b.y) - H - px * 7.0))) * leadM * step(0.0005, H) * 0.55;
        C.rgb += (hot * e1 * edgeBoost + vec3(1.0) * e2) * dimIn; C.a = max(C.a, e1 * dimIn);
      } else if (P == 5) {
        float R = 0.34 * eOut(win(T, 0.07, 0.3)) * (1.0 - coll), e = 1.0 - smoothstep(px * 0.8, px * 2.6, abs(length(p - uBc) - R));
        C.rgb += hot * e * step(0.001, R); C.a = max(C.a, e);
      }
      // 一闪：先划过一道光
      if (P == 1) {
        float head = mix(asp * 0.9, -asp * 0.9, eOut(win(T, 0.03, 0.12))), sd = abs(b.y);
        float on = step(head, b.x) * (1.0 - win(T, 0.14, 0.3));
        float sline = (1.0 - smoothstep(px * 1.0, px * 3.0, sd)) * on;
        C.rgb += vec3(1.0) * sline + hot * exp(-sd * sd / (px * px * 90.0)) * on * 0.6; C.a = max(C.a, sline);
      }
      // 天光：横向光束先亮
      if (P == 8) {
        float bl = exp(-b.y * b.y / (px * px * (6.0 + 400.0 * open))) * (1.0 - win(T, 0.18, 0.36)) * smoothstep(0.02, 0.1, T);
        C.rgb += mix(hot, vec3(1.0), 0.6) * bl; C.a = max(C.a, bl);
      }
      // 收束：条带压成一线，白热闪一下
      float cl = sin(PI * win(T, 0.76, 0.9));
      float fl = exp(-b.y * b.y / (px * px * (3.0 + 50.0 * (1.0 - coll)))) * cl * (P == 4 || P == 5 ? 0.0 : 1.0);
      C.rgb += mix(hot, vec3(1.0), 0.7) * fl * 1.2; C.a = max(C.a, fl);
      C.rgb += (hash(gl_FragCoord.xy + floor(s * 24.0)) - 0.5) * 0.03 * C.a;   // 胶片颗粒
      gl_FragColor = C * uFade;
    }`;

  // ───────────────────────── 引擎 ─────────────────────────
  const MAX = 8192;
  function makeSystem(THREE, add) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const attrs = {aP0: 2, aVel: 2, aAcc: 2, aTime: 4, aColor: 3, aMot: 4, aRot: 4, aExt: 4}, arrays = {};
    for (const [name, size] of Object.entries(attrs)) { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * size), size); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); arrays[name] = a; }
    for (let i = 0; i < MAX; i++) arrays.aTime.array[i * 4 + 1] = -1;
    g.instanceCount = MAX;
    const m = new THREE.ShaderMaterial({vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {uTime: {value: 0}, uRes: {value: new THREE.Vector2(1, 1)}, uShake: {value: new THREE.Vector2()}, uGlow: {value: 1}, uAdd: {value: add ? 1 : 0}, uDark: {value: 0}},
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
      // 全程按 sRGB 原值处理（贴图不解码、颜色不转线性、输出不再编码），直出和 OutputPass 两条路颜色一致。
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); stats.contextLost = true; }, false);
      st.renderer = renderer; st.canvas = canvas; stats.contexts = 1;
      st.scene = new THREE.Scene(); st.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      st.meshes.normal = makeSystem(THREE, false); st.meshes.add = makeSystem(THREE, true);
      st.scene.add(st.meshes.normal.mesh, st.meshes.add.mesh);
      const V2 = () => new THREE.Vector2();
      st.cineMat = new THREE.ShaderMaterial({vertexShader: CINE_VS, fragmentShader: CINE_FS, depthTest: false, depthWrite: false, transparent: true,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, premultipliedAlpha: true,
        uniforms: {uT: {value: 0}, uTime: {value: 0}, uPreset: {value: 0}, uDur: {value: 1.8}, uRes: {value: new THREE.Vector2(1, 1)}, uC0: {value: new THREE.Color()}, uC1: {value: new THREE.Color()}, uC2: {value: new THREE.Color()},
          uArt: {value: null}, uArtOk: {value: 0}, uArtAspect: {value: 1}, uArtScale: {value: 1}, uFocus: {value: V2()}, uDof: {value: 0}, uFade: {value: 1}, uTheta: {value: 0}, uH0: {value: .2}, uBc: {value: V2()}}});
      st.cineQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), st.cineMat); st.cineQuad.frustumCulled = false; st.cineQuad.renderOrder = 0; st.cineQuad.visible = false;
      st.scene.add(st.cineQuad);
      layer().append(canvas); resize(); applySettings();
      window.addEventListener('resize', resize);
      // 预热：空闲时把过场和粒子的着色器、辉光管线先编译好，第一次大招不卡（一次性，不起 rAF 循环）。
      (window.requestIdleCallback || (fn => setTimeout(fn, 200)))(() => warm());
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
    for (const sys of Object.values(st.meshes)) sys.mesh.material.uniforms.uGlow.value = .35 + s.bloom * .65;
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
    const dt = Math.min(.05, Math.max(0, (now - st.last) / 1000)) * (st.timeScale ?? 1); st.last = now; st.lastDraw = now;
    const frozen = now < st.hitUntil;
    if (!frozen) st.time += dt;
    stats.frames++; stats.lastFrameAt = now; stats.frameTimes.push(now); if (stats.frameTimes.length > 600) stats.frameTimes.splice(0, 300);
    if (st.cine) stepCine(dt, frozen);
    if (st.shake) { const k = st.shake; const e = (now - k.start) / k.ms; if (e >= 1) st.shake = null; else { const a = k.power * (1 - e) * (1 - e); k.x = (Math.random() * 2 - 1) * a; k.y = (Math.random() * 2 - 1) * a; } }
    if (!frozen) st.active?.instance?.update?.(dt, st.time);
    draw();
    if (want()) st.raf = requestAnimationFrame(frame);
    else { stats.rafActive = false; draw(); hideCanvasIfIdle(); }
  }
  function flush(sys) {
    for (const [start, count] of sys.dirty) for (const a of Object.values(sys.arrays)) a.addUpdateRange(start * a.itemSize, count * a.itemSize);
    if (sys.dirty.length) for (const a of Object.values(sys.arrays)) a.needsUpdate = true;
    sys.dirty.length = 0;
  }
  function themeDark() { const d = document.documentElement; return d.dataset.themeMode === 'dark' || d.hasAttribute('data-pinkie-night'); }
  function draw() {
    const r = st.renderer; if (!r) return;
    const T = st.time, dark = st.cine ? (st.cine.preset === 'ink' ? 0 : 1) : (st.active?.instance?.opaque ? 1 : themeDark() ? 1 : 0);
    for (const sys of Object.values(st.meshes)) { flush(sys); const u = sys.mesh.material.uniforms; u.uTime.value = T; u.uDark.value = dark; u.uShake.value.set(st.shake?.x || 0, st.shake?.y || 0); }
    const useComposer = st.composer && (st.cine || st.active?.instance?.opaque) && settings().bloom >= .6;
    r.setRenderTarget(null); r.clear();
    if (st.active?.instance?.render && !st.cine) st.active.instance.render(r, {composer: useComposer ? st.composer : null});
    if (useComposer) { st.renderPass.scene = st.scene; st.renderPass.camera = st.camera; st.composer.render(); }
    else r.render(st.scene, st.camera);
    st.canvas.dataset.live = '1';
  }
  function hideCanvasIfIdle() { if (st.canvas && !st.active && !st.cine) st.canvas.dataset.live = '0'; }

  function colorOf(THREE, hex) { const c = new THREE.Color(hex).convertLinearToSRGB(); return [c.r, c.g, c.b]; }
  function targetPoint(target) {
    if (!target) return {x: innerWidth / 2, y: innerHeight / 2};
    if (target instanceof Element) { const r = target.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r}; }
    return {x: Number(target.x) || 0, y: Number(target.y) || 0};
  }
  function localPoint(pt) {
    if (!st.active?.host) return pt;
    const r = st.active.host.getBoundingClientRect(); return {...pt, x: pt.x - r.left, y: pt.y - r.top};
  }
  const rr = v => Array.isArray(v) ? rand(v[0], v[1]) : (v || 0);
  function paletteOf(list) { return (list?.length ? list : KINDS.sparkle.pal).slice(0, 4).map(c => colorOf(st.THREE, c)); }
  // 纸面（浅色主题）上：提高饱和、压暗；接近白的颜色换成配色里最深的那个（太浅就用碧琪玫红），否则在奶油色纸上看不见。
  const lum = c => .299 * c[0] + .587 * c[1] + .114 * c[2];
  function paperTone(rgb, pal, lightEl) {
    // 目标色：配色里最饱和的那个，压到中等明度（雪 → 深一点的冰蓝，金 → 古金，粉 → 玫红）；整组都是灰白才用碧琪玫红。
    const sat = c => Math.max(...c) - Math.min(...c);
    const vivid = pal.reduce((a, b) => sat(b) > sat(a) ? b : a, pal[0]);
    const target = sat(vivid) < .12 ? [.78, .13, .4] : vivid.map(v => v * Math.min(1, .42 / Math.max(.05, lum(vivid))));
    const l = lum(rgb), k = lightEl ? .8 : .96, w = clamp((l - .6) / .3, 0, 1) * (lightEl ? .85 : .3);
    return rgb.map((v, i) => clamp((l + (v - l) * 1.45) * k * (1 - w) + target[i] * w, 0, 1));
  }
  function onPaper() { return !st.cine && !st.active?.instance?.opaque && !themeDark(); }
  function pickColor(c, pal) {
    if (typeof c === 'number') return pal[c % pal.length];
    if (c === 'h') { const p = pal[0]; return [p[0] + (1 - p[0]) * .6, p[1] + (1 - p[1]) * .6, p[2] + (1 - p[2]) * .6]; }
    if (c === 'w') return [1, 1, 1];
    return colorOf(st.THREE, c);
  }
  // 发射一层。pattern = radial | fountain | rain | ring | spray（angle + spread）| stream（to + travel，弧线飞向目标）| point（原地）。
  function emitLayer(l, origin, o) {
    const sys = st.meshes[LIGHT.has(l.e) && !l.normal ? 'add' : 'normal'];
    const single = POINT.has(l.e) && l.n <= 2;
    const n = single ? l.n : Math.round(l.n * o.count);
    if (n <= 0) return 0;
    const a = sys.arrays, start = sys.head; let longest = 0;
    const pattern = POINT.has(l.e) ? 'point' : (l.pattern || o.pattern || 'radial');
    const to = o.to ? localPoint(targetPoint(o.to)) : null, paper = onPaper(), lightEl = LIGHT.has(l.e);
    for (let i = 0; i < n; i++) {
      const j = sys.head; sys.head = (sys.head + 1) % MAX;
      let x = origin.x, y = origin.y, vx = 0, vy = 0, ax = 0, ay = l.g * (o.gravity ?? 1), drag = l.drag, turb = l.turb;
      let life = rr(l.life) * (o.lifeScale || 1), born = st.time + (o.delay || 0) + rr(l.delay) + (o.stagger ? Math.random() * o.stagger : 0);
      const sp = rr(l.sp) * (o.power ?? 1);
      let th = Math.random() * Math.PI * 2;
      if (pattern === 'point') { if (l.e === E.ARC) th = Math.random() * Math.PI * 2; }
      else if (pattern === 'fountain') { th = -Math.PI / 2 + rand(-.5, .5) * (o.spread ?? 1); vx = Math.cos(th) * sp; vy = Math.sin(th) * sp * 1.15; }
      else if (pattern === 'rain') { x = rand(-40, st.w + 40); y = rand(-st.h * .2, -20); vx = rand(-40, 40) + (o.wind || 0); vy = rand(.5, 1) * sp + 200; ay = Math.abs(ay) + 160; drag = .3; born = st.time + (o.delay || 0) + Math.random() * (o.window ?? 1.2); life = Math.max(life, (st.h + 80) / Math.max(160, vy)); }
      else if (pattern === 'ring') { th = i / n * Math.PI * 2 + rand(-.05, .05); vx = Math.cos(th) * sp; vy = Math.sin(th) * sp; ay *= .15; if (o.radius) { x += Math.cos(th) * o.radius; y += Math.sin(th) * o.radius; } }
      else if (pattern === 'spray') { th = (o.angle ?? 0) + rand(-1, 1) * (o.spread ?? .35); vx = Math.cos(th) * sp; vy = Math.sin(th) * sp; }
      else if (pattern === 'stream' && to) {
        const T = o.travel || .55, dx = to.x - x, dy = to.y - y, dist = Math.max(1, Math.hypot(dx, dy));
        const bend = (i % 2 ? 1 : -1) * rand(.25, 1) * dist * 2.6 / (T * T);
        ax = -dy / dist * bend; ay = dx / dist * bend; vx = (dx - .5 * ax * T * T) / T; vy = (dy - .5 * ay * T * T) / T;
        drag = 0; turb = [0, 0]; life = T * rand(.97, 1); born = st.time + (o.delay || 0) + (i / n) * .18;
      } else { const k = Math.sqrt(Math.random()); vx = Math.cos(th) * sp * k; vy = Math.sin(th) * sp * k - (ay > 0 ? sp * .3 : 0); }
      if (o.rect) { x = o.rect.left + Math.random() * o.rect.width; y = o.rect.top + Math.random() * o.rect.height; }
      const size = rr(l.size) * (o.size || 1), aspect = rr(l.aspect) || 1;
      const angle0 = l.alignV ? Math.atan2(vy, vx) : l.e === E.CRESCENT ? (o.angle ?? rand(-1.1, -.4)) : th;
      const spin = l.alignV ? 0 : rr(l.spin), tumble = rr(l.tumble) * (Math.random() < .5 ? -1 : 1);
      const c0 = pickColor(l.c[Math.floor(Math.random() * l.c.length)], o.pal), c = paper ? paperTone(c0, o.pal, lightEl) : c0;
      a.aP0.array.set([x, y], j * 2); a.aVel.array.set([vx, vy], j * 2); a.aAcc.array.set([ax, ay], j * 2);
      a.aTime.array.set([born, life, l.e, size], j * 4); a.aColor.array.set(c, j * 3);
      a.aMot.array.set([drag, (turb[0] || 0) * rand(.4, 1), (turb[1] || 0) * rand(.6, 1.4), l.stretch || 0], j * 4);
      a.aRot.array.set([angle0, spin, l.grow || 0, Math.random()], j * 4);
      a.aExt.array.set([aspect, tumble, l.squash ?? 1, l.int ?? 1], j * 4);
      longest = Math.max(longest, born - st.time + life);
    }
    if (start + n <= MAX) sys.dirty.push([start, n]); else { sys.dirty.push([start, MAX - start]); sys.dirty.push([0, (start + n) % MAX]); }
    st.aliveUntil = Math.max(st.aliveUntil, st.time + longest);
    return n;
  }
  // 一组层一起放。o.count 是数量倍数（已乘粒子密度）；o.pal 是 sRGB 数组。
  function play(layers, origin, opts = {}) {
    const s = settings();
    const scale = (opts.scale ?? 1) * (opts.count ? clamp(opts.count / 60, .2, 3) : 1) * (opts.ignoreDensity ? 1 : s.density);
    const o = {...opts, count: scale, pal: Array.isArray(opts.pal?.[0]) ? opts.pal : paletteOf(opts.pal || opts.palette)};
    let n = 0; for (const l of layers) n += emitLayer(l, origin, o);
    return n;
  }
  async function begin() {
    if (hiddenOrQuiet()) return false;
    if (!(await ensure())) return null;
    showCanvas(); return true;
  }
  async function burst(kind, at, opts = {}) {
    if (opts.pattern === 'stream' && opts.to) return comet(at, opts.to, {...opts, palette: opts.palette || (KINDS[kind] || KINDS.sparkle).pal});
    const ok = await begin(); if (ok === false) return 0; if (ok === null) return domBurst(kind, at, opts);
    const spec = KINDS[kind] || KINDS.sparkle;
    const n = play(spec.layers, localPoint(targetPoint(at)), {...opts, pal: opts.palette?.length ? opts.palette : spec.pal});
    kick(); return n;
  }
  // 命中：闪光 + 冲击环 + 形态的碎屑 + 招式特有的一层；暴击加顿帧、震屏、第二道环和更快的火花。
  async function hit(name = 'sparkle', at, opts = {}) {
    const def = HITS[name] || HITS.sparkle, spec = KINDS[def[0]] || KINDS.sparkle, crit = Boolean(opts.crit);
    if (opts.sound !== false) sfx(crit ? 'crit' : 'hit', {form: opts.form});
    if (crit) { shake(opts.shake ?? 1.1); hitstop(opts.hitstop ?? 80); }
    const ok = await begin(); if (ok === false) return 0; if (ok === null) return domBurst(def[0], at, opts);
    const k = crit ? 1.35 : 1;
    const ringy = crit || ['stamp', 'ping', 'lens', 'shard'].includes(name);
    const layers = [flash(.7 * k), ...(ringy ? [ring(.5 * k)] : []), ...spec.layers.filter(l => l.e !== E.FLASH && l.e !== E.RING).map(l => ({...l, n: Math.max(1, Math.round(l.n * (crit ? .9 : .62)))})), ...def[1]];
    if (crit) layers.push(streaks(18, {sp: [700, 1500]}), ring(.95, {c: ['h'], delay: .06}));
    const n = play(layers, localPoint(targetPoint(at)), {size: 1.3, ...opts, pal: opts.palette?.length ? opts.palette : spec.pal});
    kick(); return n;
  }
  // 彗星：一串流光沿弧线飞向目标（HUD 计数器等），到达时一点闪光和小环。
  async function comet(from, to, opts = {}) {
    const ok = await begin(); if (!ok) return 0;
    const T = opts.travel || .55, n = clamp(Math.round(opts.count ?? 12), 3, 36), pal = opts.palette;
    const a = localPoint(targetPoint(from));
    play([L(E.STREAK, n, {size: [2, 3.1], stretch: .05, c: ['h', 0, 2]}), L(E.MOTE, Math.ceil(n * .5), {size: [6, 10], c: ['h', 0], int: .9})], a, {pattern: 'stream', to, travel: T, scale: 1, ignoreDensity: true, pal});
    play([flash(.32), ring(.3), glints(4, {sp: [40, 160], size: [12, 24]})], localPoint(targetPoint(to)), {delay: T * .92, scale: 1, ignoreDensity: true, pal});
    kick(); return n;
  }
  // 法阵：地面透视的细线法阵（描线 → 锁定一闪 → 光柱 → 淡出），给施法 / 觉醒 / 守关用。
  async function sigil(at, opts = {}) {
    const ok = await begin(); if (!ok) return 0;
    const size = opts.size || 320, dur = opts.duration || 1.9, pal = opts.palette || ['#ffd36e', '#ff8fc0', '#fff4d6'];
    const p = localPoint(targetPoint(at));
    play([L(E.SIGIL, 1, {life: [dur, dur], size: [size, size], squash: opts.flat === false ? 1 : .36, c: [0]}),
      L(E.PILLAR, 1, {life: [dur * .6, dur * .6], size: [size * .55, size * .55], delay: dur * .24, c: ['h']}),
      L(E.MOTE, 26, {sp: [10, 60], life: [1, 1.8], size: [4, 8], g: -160, drag: 1, turb: [8, 2], c: ['h', 0, 2], delay: [dur * .2, dur * .5]}),
      glints(6, {delay: dur * .24, sp: [20, 120]})], p, {scale: 1, ignoreDensity: true, pal, rect: null});
    kick(); return 1;
  }
  async function impact(at, opts = {}) {
    const ok = await begin(); if (!ok) return 0;
    const k = opts.scale || 1;
    play([flash(.9 * k), ring(.8 * k), ring(.5 * k, {c: ['h'], delay: .05}), streaks(24), glints(6), motes(14)], localPoint(targetPoint(at)), {...opts, scale: k, pal: opts.palette});
    kick(); return 1;
  }
  function hiddenOrQuiet() { return document.hidden || settings().density <= 0; }
  function showCanvas() { if (st.canvas) { if (!st.active && st.canvas.parentElement !== layer()) layer().append(st.canvas); st.canvas.dataset.live = '1'; } }

  // WebGL 起不来时的平面版：几点柔光，transform / opacity 动画，播完就删。
  function domBurst(kind, at, opts = {}) {
    const pt = targetPoint(at), s = settings(); if (s.density <= 0) return 0;
    const spec = KINDS[kind] || KINDS.sparkle, n = Math.max(4, Math.round(10 * s.density * (opts.scale || 1))), host = layer();
    for (let i = 0; i < n; i++) {
      const d = document.createElement('i'); d.className = 'pk-gamefx-dot'; d.style.left = pt.x + 'px'; d.style.top = pt.y + 'px'; d.style.setProperty('--c', pick(opts.palette || spec.pal));
      const th = Math.random() * Math.PI * 2, r = rand(40, 120) * (opts.power || 1);
      host.append(d);
      const anim = d.animate([{transform: 'translate(-50%,-50%) scale(1)', opacity: 1}, {transform: `translate(calc(-50% + ${Math.cos(th) * r}px), calc(-50% + ${Math.sin(th) * r}px)) scale(.3)`, opacity: 0}], {duration: rand(450, 800), easing: 'cubic-bezier(.16,1,.3,1)'});
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

  // ───────────────────────── 大招切入 ─────────────────────────
  const textures = new Map();
  function texture(url) {
    if (!url || !st.THREE) return Promise.resolve(null);
    if (textures.has(url)) return textures.get(url);
    const p = new Promise(resolve => {
      const img = new Image(); img.decoding = 'async';
      img.onload = () => {
        const THREE = st.THREE, src = keyBackground(img);
        const t = new THREE.Texture(src); t.colorSpace = THREE.NoColorSpace; t.premultiplyAlpha = true; t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.needsUpdate = true;
        t.userData.aspect = img.naturalWidth / Math.max(1, img.naturalHeight); Object.assign(t.userData, subjectBox(src));
        resolve(t);
      };
      img.onerror = () => resolve(null); img.src = new URL(url, BASE).href;
    });
    textures.set(url, p); return p;
  }
  const DEFAULT_ART = {daily: 'laolao-mode-chat-hd.png', learning: 'laolao-mode-learning-hd.png', project: 'laolao-mode-project-hd.png', thinking: 'laolao-mode-thinking-hd.png', unrestricted: 'laolao-mode-unrestricted-hd.png'};
  // 立绘如果自带浅色底（现有模式图就是），从四边往里洪水填充，把和边连通的近白色抠成透明；带彩色背景的大招图不动。
  function keyBackground(img) {
    try {
      const w = img.naturalWidth, h = img.naturalHeight; if (!w || !h || w * h > 4.2e6) return img;
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', {willReadFrequently: true}); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, w, h), px = d.data;
      const light = i => px[i + 3] > 200 && Math.min(px[i], px[i + 1], px[i + 2]) > 228 && Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) < 26;
      const corners = [0, (w - 1) * 4, (h - 1) * w * 4, (h * w - 1) * 4];
      if (corners.filter(light).length < 3) return img;
      const seen = new Uint8Array(w * h), stack = [];
      for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x); for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
      while (stack.length) { const k = stack.pop(); if (seen[k]) continue; seen[k] = 1; const i = k * 4; if (!light(i)) continue; px[i + 3] = 0; const x = k % w, y = (k / w) | 0;
        if (x > 0) stack.push(k - 1); if (x < w - 1) stack.push(k + 1); if (y > 0) stack.push(k - w); if (y < h - 1) stack.push(k + w); }
      g.putImageData(d, 0, 0); return c;
    } catch { return img; }
  }
  // 透明立绘：找角色的外框，焦点放在头部（外框上方 30%），并按角色高度归一化取景；整张不透明的大招图用默认取景。
  function subjectBox(src) {
    try {
      const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height, S = 96, sh = Math.max(1, Math.round(S * h / w));
      const c = document.createElement('canvas'); c.width = S; c.height = sh; const g = c.getContext('2d', {willReadFrequently: true}); g.drawImage(src, 0, 0, S, sh);
      const d = g.getImageData(0, 0, S, sh).data; let x0 = S, y0 = sh, x1 = -1, y1 = -1;
      for (let y = 0; y < sh; y++) for (let x = 0; x < S; x++) if (d[(y * S + x) * 4 + 3] > 140) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (x1 < 0) return {focus: [.5, .38], fill: 1, opaque: false};
      const bw = (x1 - x0 + 1) / S, bh = (y1 - y0 + 1) / sh;
      if (bw > .97 && bh > .97) return {focus: [.5, .42], fill: 1, opaque: true};
      return {focus: [(x0 + x1 + 1) / 2 / S, (y0 + (y1 - y0 + 1) * .3) / sh], fill: clamp(.62 / bh, .7, 1.8), opaque: false};
    } catch { return {focus: [.5, .38], fill: 1, opaque: false}; }
  }
  function cinematic(preset, opts = {}) {
    const job = st.cineQueue.then(() => runCinematic(preset, opts));
    st.cineQueue = job.catch(() => {}); return job;
  }
  const DEFAULT_PALETTE = ['#F7A8C8', '#DB1F74', '#FFD36E'];
  async function runCinematic(preset, opts) {
    const s = settings();
    if (!PRESETS.includes(preset)) preset = 'burst';
    if (document.hidden || s.cine === 'off') return {played: false, reason: s.cine === 'off' ? 'off' : 'hidden'};
    if (!(await ensure())) return domCinematic(preset, opts);
    const THREE = st.THREE, geo = PRESET_GEO[preset], pal = opts.palette?.length >= 3 ? opts.palette : DEFAULT_PALETTE;
    const formId = typeof opts.form === 'string' ? opts.form : opts.form?.id;
    // 没给立绘时先用现成的模式碧琪图，B 的大招立绘到了就按形态换。
    const tex = await Promise.race([texture(opts.art || DEFAULT_ART[formId] || DEFAULT_ART.daily), new Promise(r => setTimeout(() => r(null), 900))]);
    const dur = (opts.duration || PRESET_TIMING[preset]) * (s.cine === 'short' ? .62 : 1);
    const u = st.cineMat.uniforms, col = c => new THREE.Color(c).convertLinearToSRGB();
    u.uPreset.value = PRESETS.indexOf(preset); u.uDur.value = dur; u.uC0.value.copy(col(pal[0])); u.uC1.value.copy(col(pal[1])); u.uC2.value.copy(col(pal[2]));
    u.uArt.value = tex; u.uArtOk.value = tex ? 1 : 0; u.uArtAspect.value = tex?.userData.aspect || 1;
    const focus = opts.focus || tex?.userData.focus || [.5, .38]; u.uFocus.value.set(focus[0], focus[1]); u.uArtScale.value = opts.artScale || tex?.userData.fill || 1;
    u.uDof.value = s.dof ? 1 : 0; u.uT.value = 0; u.uFade.value = 1; u.uTheta.value = geo.theta; u.uH0.value = geo.h; u.uBc.value.set(geo.c[0], geo.c[1]);
    if (s.bloom >= .6) await ensureComposer();
    // 过场期间画布挪到最上层全屏，结束后放回原处。
    const prevHost = st.active; if (prevHost) detachScene(true);
    layer().append(st.canvas); st.canvas.dataset.live = '1'; st.canvas.dataset.cine = '1'; resize();
    st.cineQuad.visible = true;
    const text = cineText(preset, opts, dur, geo, pal);
    return new Promise(resolve => {
      const done = (skipped = false) => {
        if (!st.cine) return; st.cine = null; st.cineQuad.visible = false; applySettings(); delete st.canvas.dataset.cine; text.remove();
        removeEventListener('keydown', onKey, true); text.removeEventListener('pointerdown', onSkip);
        if (prevHost) attachScene(prevHost); else { draw(); kick(); }
        resolve({played: true, skipped, preset});
      };
      const onSkip = () => done(true);
      const onKey = event => { if (event.key === 'Escape' || event.key === ' ' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); done(true); } };
      text.addEventListener('pointerdown', onSkip); addEventListener('keydown', onKey, true);
      st.cine = {preset, t: 0, dur, opts, geo, pal, particle: opts.particle || 'sparkle', fired: new Set(), done};
      kick();
      sfx('ult', {form: opts.form, preset, dur});
    });
  }
  function stepCine(dt, frozen) {
    const c = st.cine; if (!frozen) c.t += dt;
    const T = clamp(c.t / c.dur, 0, 1), u = st.cineMat.uniforms;
    u.uT.value = T; u.uTime.value = st.time;
    for (const sys of Object.values(st.meshes)) sys.mesh.material.uniforms.uGlow.value = (.35 + settings().bloom * .65) * .75;
    const fire = (name, at, fn) => { if (T >= at && !c.fired.has(name)) { c.fired.add(name); try { fn(); } catch { /* 单个粒子事件失败不影响过场 */ } } };
    const W = st.w, H = st.h, g = c.geo, P = c.preset, pal = c.pal, one = {scale: 1, ignoreDensity: true, pal};
    const cx = W / 2 + g.c[0] * H, cy = H / 2 - g.c[1] * H;
    const dir = [Math.cos(g.theta), -Math.sin(g.theta)], perp = [Math.sin(g.theta), Math.cos(g.theta)];
    const at = (along, across = 0) => ({x: cx + dir[0] * along * H + perp[0] * across * H, y: cy + dir[1] * along * H + perp[1] * across * H});
    const density = Math.max(.35, settings().density);
    if (!['ink', 'warp', 'curtain'].includes(P)) fire('enter', .07, () => {
      for (let i = -2; i <= 2; i++) play([streaks(Math.round(9 * density), {sp: [1200, 2200], g: 0, drag: .9, stretch: .07, life: [.35, .6], c: ['h', 2]})], at(W / H * .55, i * g.h * .38), {...one, pattern: 'spray', angle: Math.atan2(-dir[1], -dir[0]), spread: .025});
    });
    fire('focus', .32, () => { for (let i = 0; i < 6; i++) play([glints(1, {size: [22, 44], sp: [0, 30], c: ['h', 2]})], at(rand(-.6, .9) * W / H * .5, (i % 2 ? 1 : -1) * g.h), one); });
    if (P === 'burst') fire('nova', .08, () => play([flash(2.4), ring(1.8, {c: [2]})], at(-W / H * .17), one));
    if (P === 'slash') {
      fire('cut', .06, () => { play([streaks(Math.round(34 * density), {sp: [500, 1400], g: 120, c: ['h', 2]})], at(0), {...one, pattern: 'spray', angle: Math.atan2(dir[1], dir[0]) + Math.PI, spread: .12}); play([streaks(Math.round(34 * density), {sp: [500, 1400], g: 120, c: ['h', 2]})], at(0), {...one, pattern: 'spray', angle: Math.atan2(dir[1], dir[0]), spread: .12}); });
      fire('cut-shake', .11, () => shake(1.1));
    }
    if (P === 'spell') fire('pillar', .3, () => {
      const base = {x: W / 2 - .36 * H, y: H / 2 + .3 * H};
      play([L(E.MOTE, Math.round(40 * density), {sp: [10, 60], life: [1.2, 2], size: [4, 9], g: -150, drag: .8, turb: [10, 2], c: ['h', 2, 0]})], base, {...one, rect: {left: W / 2 - H * .5, top: base.y - H * .06, width: H, height: H * .12}});
    });
    if (P === 'curtain') {
      fire('dust', .08, () => play([L(E.MOTE, Math.round(46 * density), {sp: [4, 30], life: [1.6, 2.4], size: [3, 7], g: -8, drag: .5, turb: [12, .8], c: ['w', 2], int: .7})], {x: W / 2, y: H / 2}, {...one, rect: {left: W / 2 - H * .32, top: 0, width: H * .64, height: H}}));
      fire('foil', .3, () => play([L(E.FOIL, Math.round(60 * density), {sp: [80, 200], life: [1.8, 2.6], size: [6, 10], aspect: .6, g: 160, drag: 1.2, turb: [26, 2], spin: [-4, 4], tumble: [5, 11], c: [2, 0, 'w']})], {x: W / 2, y: 0}, {...one, pattern: 'rain', window: c.dur * .4}));
    }
    if (P === 'warp') fire('converge', .04, () => play([streaks(Math.round(70 * density), {sp: [900, 1600], g: 0, drag: 0, stretch: .06, life: [.32, .42], c: ['h', 2]})], at(0), {...one, pattern: 'ring', power: -1, radius: H * .75}));
    if (P === 'rain') fire('fall', .05, () => play([streaks(Math.round(80 * density), {sp: [700, 1100], g: 400, drag: .2, stretch: .05, size: [1.6, 2.6], life: [1, 1.4], c: ['h', 2, 0]})], {x: W / 2, y: 0}, {...one, pattern: 'rain', window: c.dur * .62, wind: 260}));
    if (P === 'stamp') fire('seal', .26, () => {
      const p = sealPoint(c, W, H);
      shake(1.6); hitstop(70); sfx('stamp');
      play([ring(1.1, {c: [0]}), L(E.PUFF, Math.round(8 * density), {sp: [80, 260], life: [.8, 1.4], size: [50, 110], drag: 3, grow: 1.2, c: ['#e8ddd3', '#cbbcb0'], int: .7}), L(E.INK, Math.round(14 * density), {sp: [200, 600], life: [.4, .8], size: [4, 9], g: 500, drag: 2.4, c: [1]})], p, one);
    });
    if (P === 'beam') fire('flare', .1, () => play([flash(2.4, {c: ['h']}), glints(4, {size: [40, 70], sp: [0, 40]})], at(W / H * .2), one));
    if (P === 'ink') fire('blot', .05, () => {
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + rand(-.2, .2), ex = cx + Math.cos(a) * H * .6 * rand(.95, 1.12), ey = cy + Math.sin(a) * H * .36 * rand(.95, 1.12);
        if (i % 2) play([L(E.INK, 1, {sp: [10, 40], life: [1.6, 2.1], size: [H * .035, H * .07], drag: 4, delay: [.08, .22], int: .8, c: ['#1c1218']})], {x: ex, y: ey}, one);
        play([L(E.INK, Math.round(4 * density), {sp: [260, 700], life: [.4, .8], size: [3, 8], g: 600, drag: 2.4, delay: [.1, .2], c: ['#1c1218']})], {x: ex, y: ey}, {...one, pattern: 'spray', angle: Math.atan2(Math.sin(a) * .6, Math.cos(a)), spread: .5}); }
    });
    fire('release', .84, () => {
      const p = P === 'warp' ? at(0) : at(-W / H * .1);
      if (P === 'ink') play([L(E.INK, Math.round(36 * density), {sp: [300, 1100], life: [.5, 1], size: [4, 12], g: 700, drag: 2.2, c: ['#1c1218']}), ring(1.6, {c: [1]})], p, one);
      else play([flash(2.2), ring(2.4), ring(1.5, {c: ['h'], delay: .06}), streaks(Math.round(70 * density), {sp: [600, 1700]}), glints(14, {size: [20, 48]}), motes(Math.round(44 * density), {life: [1.4, 2.4], sp: [60, 420]})], p, one);
      const kind = KINDS[c.particle] || KINDS.sparkle;
      play(kind.layers.filter(l => l.e !== E.FLASH && l.e !== E.RING), p, {...one, scale: 1.1 * density, pal});
      shake(.7); sfx('release', {form: c.opts.form});
    });
    if (c.t >= c.dur) c.done(false);
  }
  function sealPoint(c, W, H) { const g = c.geo, dx = W * .78 - (W / 2 + g.c[0] * H); return {x: W * .78, y: H / 2 - g.c[1] * H + dx * Math.tan(g.theta) * -1}; }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function cineText(preset, opts, dur, geo, pal) {
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const n = el('div', 'pk-cut'); n.dataset.preset = preset;
    const formName = opts.kicker || (typeof opts.form === 'object' ? opts.form?.name : '') || '';
    n.style.setProperty('--dur', dur + 's'); n.style.setProperty('--theta', (-geo.theta * 180 / Math.PI).toFixed(2) + 'deg');
    n.style.setProperty('--h0', (geo.h * 100).toFixed(2) + 'vh'); n.style.setProperty('--cx', (geo.c[0] * 100).toFixed(2) + 'vh'); n.style.setProperty('--cy', (-geo.c[1] * 100).toFixed(2) + 'vh');
    n.style.setProperty('--accent', pal[2] || '#FFD36E'); n.style.setProperty('--tone', pal[1] || '#DB1F74');
    const frame = el('div', 'pk-cut__frame'), copy = el('div', 'pk-cut__copy');
    const kicker = el('div', 'pk-cut__kicker'); kicker.append(el('i', '', 'ULTIMATE'), el('b', '', '')); if (formName) kicker.append(el('span', '', formName));
    copy.append(kicker, el('strong', 'pk-cut__title', opts.text || '碧琪 · 大招'), el('i', 'pk-cut__rule'), el('span', 'pk-cut__sub', [PRESET_EN[preset], opts.sub].filter(Boolean).join('  ·  ')));
    frame.append(copy);
    if (preset === 'stamp') { const cxp = innerWidth / 2 + geo.c[0] * innerHeight; n.style.setProperty('--seal', ((innerWidth * .78 - cxp) / Math.cos(geo.theta)).toFixed(1) + 'px'); frame.append(sealSvg(opts.seal || '碧琪上岸')); }
    n.append(frame, el('em', 'pk-cut__skip', '点击跳过'));
    layer().append(n); return n;
  }
  // 白文印：朱红底、阴刻白字（右列从上往下读），噪声打出缺墨，轻微位移做出手按的毛边。
  function sealSvg(text) {
    const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('class', 'pk-cut__seal'); svg.setAttribute('viewBox', '0 0 120 120'); svg.setAttribute('aria-hidden', 'true');
    const chars = [...String(text)].slice(0, 4); while (chars.length < 4) chars.push('');
    const pos = [[86, 46], [86, 98], [34, 46], [34, 98]];
    svg.innerHTML = `<defs><filter id="pk-seal-ink" x="-6%" y="-6%" width="112%" height="112%"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="7" result="n"/>`
      + `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  7 0 0 0 -1.1" result="holes"/><feComposite in="SourceGraphic" in2="holes" operator="in" result="e"/>`
      + `<feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="3" result="w"/><feDisplacementMap in="e" in2="w" scale="2.6" xChannelSelector="R" yChannelSelector="G"/></filter></defs>`
      + `<g filter="url(#pk-seal-ink)"><rect x="5" y="5" width="110" height="110" rx="9" fill="#c4122f"/><rect x="12.5" y="12.5" width="95" height="95" rx="5" fill="none" stroke="#fbf1e8" stroke-width="2.6"/>`
      + chars.map((ch, i) => `<text x="${pos[i][0]}" y="${pos[i][1]}" text-anchor="middle" font-size="44" font-weight="900" fill="#fbf1e8" font-family="Songti SC, STSong, Noto Serif SC, serif">${ch.replace(/[<&>]/g, '')}</text>`).join('') + `</g>`;
    return svg;
  }
  function domCinematic(preset, opts) {
    // 平面版（WebGL 起不来）：压暗 + 同一套标题排版，1 秒。
    return new Promise(resolve => {
      const n = cineText(preset, opts, 1, PRESET_GEO[preset] || PRESET_GEO.burst, opts.palette?.length >= 3 ? opts.palette : DEFAULT_PALETTE); n.classList.add('is-flat');
      const end = () => { n.remove(); resolve({played: true, flat: true, preset}); };
      n.addEventListener('pointerdown', end); setTimeout(end, 1000);
    });
  }
  async function warm() {
    try {
      if (!st.renderer || st.warmed) return; st.warmed = true;
      st.cineQuad.visible = true; st.renderer.compile(st.scene, st.camera); st.cineQuad.visible = Boolean(st.cine);
      if (settings().bloom >= .6 && await ensureComposer()) { const v = st.cineQuad.visible; st.cineQuad.visible = true; st.cineMat.uniforms.uFade.value = 0; st.composer.render(); st.cineMat.uniforms.uFade.value = 1; st.cineQuad.visible = v; st.renderer.setRenderTarget(null); st.renderer.clear(); }
    } catch { /* 预热失败不影响正常播放 */ }
  }
  async function ensureComposer() {
    if (st.composer) return true;
    const addons = await loadAddons(); if (!addons || !st.renderer) return false;
    const {EffectComposer, RenderPass, UnrealBloomPass, OutputPass} = addons;
    const composer = new EffectComposer(st.renderer); composer.setPixelRatio(st.dpr); composer.setSize(st.w, st.h);
    st.renderPass = new RenderPass(st.scene, st.camera); st.renderPass.clear = true;
    st.bloomPass = new UnrealBloomPass(new st.THREE.Vector2(st.w, st.h), .42, .35, .9);
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
  // 噪声扫频：起势（rise）或拖尾，配合滤波器频率指数滑动。
  function sweep(ctx, {at = 0, dur = .6, from = 300, to = 4000, level = .15, q = .7, type = 'bandpass', wet = .3, rise = true}) {
    const t0 = ctx.currentTime + at, len = Math.max(1, Math.floor(ctx.sampleRate * dur)), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) { const k = i / len; d[i] = (Math.random() * 2 - 1) * (rise ? k * k * (1 - k * k * k * .6) : (1 - k) ** 2); }
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); src.buffer = b; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(from, t0); f.frequency.exponentialRampToValueAtTime(to, t0 + dur); g.gain.value = level;
    src.connect(f); f.connect(g); g.connect(audio.master); if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(audio.wet); } src.start(t0);
  }
  // 形态目录里出现的音色名补齐（没有的回落到钟声）。
  Object.assign(TIMBRE, {sine: ['sine', [1], .6], bubbly: ['sine', [1, 2], .4], glass: ['sine', [1, 2.76, 5.4], 1.1], click: ['triangle', [1], .15], roar: ['sawtooth', [1, .5], .6],
    fanfare: ['sawtooth', [1, 2, 3], .55], steel: ['triangle', [1, 2.4, 3.9], .9], pop: ['sine', [1], .2], twinkle: ['sine', [1, 4], 1.2], celesta: ['sine', [1, 4, 8], .9], guzheng: ['triangle', [1, 3], .5], whoosh: ['sine', [1, 2], .5]});
  // 音效：不用方波 8-bit 音色；打击 = 高频瞬态 + 有音高的身体 + 形态音色；大招 = 起势扫频 + 和弦 + 释放时的低频冲击和闪光尾音。
  function sfx(name, opts = {}) {
    if (!audio.gesture || document.hidden || !soundOn() || (document.hasFocus && !document.hasFocus())) return false;
    const ctx = ensureAudio(); if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    audio.master.gain.value = settings().volume * .42;
    const [type, partials, ring] = TIMBRE[opts.timbre || formTimbre(opts.form)] || TIMBRE.bell;
    const base = 523.25 * (opts.pitch || 1);
    switch (name) {
      case 'hit': noiseHit(ctx, {dur: .035, level: .16, freq: 4200, q: .9, type: 'highpass', wet: .05}); voice(ctx, {type: 'sine', freq: base * 1.5, to: base * 1.05, dur: .14, level: .12, wet: .1}); voice(ctx, {type, partials, freq: base * 2, dur: .25 + ring * .15, level: .06, wet: .3}); break;
      case 'crit': voice(ctx, {type: 'sine', freq: 72, to: 36, dur: .42, level: .42, wet: 0}); noiseHit(ctx, {dur: .16, level: .24, freq: 1100, q: .6}); voice(ctx, {type: 'sine', partials: [1, 2.76, 5.4], freq: base * 3, dur: .7, level: .05, wet: .6}); voice(ctx, {type, partials, freq: base * 1.5, dur: .5 + ring * .3, level: .08, wet: .4}); break;
      case 'combo': [0, 1, 2].forEach(i => voice(ctx, {type: 'sine', partials: [1, 2.76], freq: base * [1, 1.25, 1.5][i] * (1 + (opts.n || 0) * .01), at: i * .045, dur: .3, level: .07, wet: .4})); break;
      case 'ult': { const d = opts.dur || 1.8; sweep(ctx, {dur: d * .7, from: 220, to: 5200, level: .11, q: .6, wet: .35}); voice(ctx, {type: 'sine', freq: 55, to: 82, dur: d * .78, level: .1, wet: 0, attack: .3});
        [1, 1.26, 1.5, 1.89].forEach((r, i) => voice(ctx, {type, partials, freq: base * r * .5, at: .12 + i * .03, dur: 1.4 + ring * .4, level: .05, wet: .55, attack: .02})); break; }
      case 'release': voice(ctx, {type: 'sine', freq: 64, to: 30, dur: .7, level: .48, wet: .05}); sweep(ctx, {dur: .55, from: 1800, to: 240, level: .2, type: 'lowpass', rise: false, wet: .5});
        for (let i = 0; i < 6; i++) voice(ctx, {type: 'sine', partials: [1, 2.01], freq: 1800 + Math.random() * 2400, at: .05 + i * .06, dur: .5, level: .025, wet: .75}); break;
      case 'coin': voice(ctx, {type: 'sine', partials: [1, 2.01], freq: 2637, dur: .18, level: .055, wet: .35}); voice(ctx, {type: 'sine', freq: 3951, at: .045, dur: .32, level: .04, wet: .5}); noiseHit(ctx, {dur: .02, level: .045, freq: 6000, type: 'highpass', wet: .1}); break;
      case 'sparkle': [1, 1.25, 1.5, 2, 2.5].forEach((r, i) => voice(ctx, {type: 'sine', partials: [1, 3], freq: 1318.5 * r, at: i * .04, dur: .5, level: .033, wet: .7, attack: .01})); break;
      case 'stamp': voice(ctx, {type: 'sine', freq: 130, to: 52, dur: .26, level: .5, wet: .1}); noiseHit(ctx, {dur: .12, level: .3, freq: 700, type: 'lowpass', wet: .15}); noiseHit(ctx, {dur: .05, level: .08, freq: 2400, q: .5, wet: .1}); break;
      case 'whoosh': sweep(ctx, {dur: .28, from: 500, to: 2600, level: .13, q: .5, wet: .3}); sweep(ctx, {at: .26, dur: .24, from: 2600, to: 900, level: .1, q: .5, rise: false, wet: .3}); break;
      case 'gacha-turn': [0, 1, 2, 3, 4, 5].forEach(i => noiseHit(ctx, {at: i * .07, dur: .03, level: .16, freq: 2600, q: 4, wet: .05})); break;
      case 'capsule-drop': voice(ctx, {type: 'sine', freq: 300, to: 120, dur: .18, level: .25, wet: .2}); voice(ctx, {type: 'sine', freq: 260, to: 110, at: .22, dur: .12, level: .12, wet: .2}); break;
      case 'open': { const lv = opts.rarity === 'SSR' ? 3 : opts.rarity === 'SR' ? 2 : 1; if (lv >= 2) sweep(ctx, {dur: .5, from: 400, to: 4800, level: .08, wet: .4});
        for (let i = 0; i < 2 + lv * 2; i++) voice(ctx, {type, partials, freq: base * [1, 1.25, 1.5, 2, 2.5, 3, 4, 5][i], at: .05 + i * .06, dur: .6 + lv * .3, level: .06 + lv * .015, wet: .5}); break; }
      case 'levelup': voice(ctx, {type: 'sine', freq: base * .5, dur: 1, level: .07, wet: .4}); [1, 1.25, 1.5, 2].forEach((r, i) => voice(ctx, {type: 'sine', partials: [1, 2.76, 5.4], freq: base * r, at: i * .07, dur: .9, level: .07, wet: .55})); break;
      case 'boss-hit': voice(ctx, {type: 'sine', freq: 75, to: 35, dur: .5, level: .5, wet: .2}); noiseHit(ctx, {dur: .3, level: .35, freq: 400, q: .4, type: 'lowpass'}); break;
      case 'miss': voice(ctx, {type: 'sine', freq: 392, to: 330, dur: .22, level: .07, wet: .2}); break;
      default: return false;
    }
    return true;
  }
  const FORM_TIMBRE = {};
  function formTimbre(form) { return (form && (FORM_TIMBRE[form] || FORM_TIMBRE[form?.id] || form?.sound)) || 'bell'; }
  function setFormTimbre(map) { Object.assign(FORM_TIMBRE, map || {}); }

  // ───────────────────────── 奖励播放（后端决定，前端只播） ─────────────────────────
  // 图标是手画的多面体矢量（不用 emoji）；数字用等宽数字体滚动计数；奖励卡片是纸面 / 夜间玻璃两套。
  function starFacets() {
    const cx = 12, cy = 12.8, R = 10.2, r = 4.3, pts = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? r : R; pts.push([cx + Math.cos(a) * k, cy + Math.sin(a) * k]); }
    let out = '';
    for (let i = 0; i < 10; i++) { const a = pts[i], b = pts[(i + 1) % 10]; const lightSide = (a[0] + b[0]) / 2 < cx + 1.5 && i % 2 === 1 || i % 2 === 0 && (a[0] + b[0]) / 2 < cx; out += `<path d="M${cx} ${cy}L${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}Z" fill="${lightSide ? '#f7d67e' : i % 2 ? '#c98f2b' : '#e0ad46'}"/>`; }
    return out;
  }
  const ICON = {
    stars: `<svg viewBox="0 0 24 24">${starFacets()}</svg>`,
    seals: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3.2" fill="#c9952f"/><path d="M3 6.2A3.2 3.2 0 0 1 6.2 3H21v0L3 21z" fill="#e8bd5c" opacity=".55"/><rect x="5.4" y="5.4" width="13.2" height="13.2" rx="1.6" fill="none" stroke="#fbe7b0" stroke-width="1.1"/><text x="12" y="16.1" text-anchor="middle" font-size="9.6" font-weight="900" fill="#5c3a0c" font-family="Songti SC, STSong, serif">印</text></svg>',
    shards: '<svg viewBox="0 0 24 24"><path d="M12 2l7.5 6.2L12 22 4.5 8.2z" fill="#7d68e8"/><path d="M12 2l7.5 6.2H4.5z" fill="#b9a9ff"/><path d="M12 2L8.6 8.2 12 22z" fill="#9c8af5"/><path d="M12 2l3.4 6.2L12 22z" fill="#6a55d6"/><path d="M4.5 8.2h15" stroke="#e6deff" stroke-width=".7"/></svg>',
    badge: '<svg viewBox="0 0 24 24"><path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 7.5l4.5 4.5-4.5 4.5L7.5 12z" fill="currentColor"/></svg>',
  };
  const KIND_COLOR = {stars: '#d9a23c', seals: '#c9952f', shards: '#7d68e8', levelup: '#DB1F74', awaken: '#e2589a', capture: '#3f8c80', node: '#d9a23c', boss: '#b5122c', rank: '#5266e0', chest: '#a8742f', gift: '#DB1F74', form: '#DB1F74', item: '#7d68e8'};
  const AWARD_PAL = {stars: ['#ffd36e', '#ff8fc0', '#fff4d6'], seals: ['#ffd25e', '#c8902a', '#fff1c2'], shards: ['#b9a8ff', '#7fd3ff', '#ffffff']};
  const UNIT = {stars: '星星', seals: '金印', shards: '碎片'};
  const KIND_TEXT = {levelup: '亲密度升级', awaken: '觉醒', capture: '收服错题怪', node: '点亮新节点', boss: '巴别兽受创', rank: '段位提升', chest: '委托宝箱', gift: '碧琪的小礼物', form: '新形态', item: '新物品'};
  let awardQueue = Promise.resolve();
  const played = new Set();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function playAward(award, opts = {}) {
    if (!award || typeof award !== 'object') return Promise.resolve(false);
    if (award.id && played.has(award.id)) return Promise.resolve(false);
    if (award.id) played.add(award.id);
    const job = awardQueue.then(() => runAward(award, opts)).catch(() => false);
    awardQueue = job; return job;
  }
  function hudAnchor(kind) { return document.querySelector(`[data-game-hud="${kind === 'seals' ? 'seals' : kind === 'shards' ? 'shards' : 'stars'}"]`); }
  function awardParts(a) {
    const n = Math.max(0, Math.round(Number(a.amount) || 0));
    if (UNIT[a.kind]) return {num: n, unit: UNIT[a.kind], title: `+${n} ${UNIT[a.kind]}`};
    const t = a.reason && a.kind !== 'levelup' && a.kind !== 'awaken' ? (KIND_TEXT[a.kind] || a.reason) : (KIND_TEXT[a.kind] || a.reason || '奖励');
    return {num: null, unit: '', title: a.kind === 'levelup' && n ? `${t} · Lv.${n}` : t};
  }
  async function runAward(award, opts) {
    const s = settings(), level = ['small', 'medium', 'big', 'cinematic'].includes(award.fx) ? award.fx : 'small';
    const parts = awardParts(award);
    const from = opts.from ? targetPoint(opts.from) : {x: innerWidth / 2, y: innerHeight * .42};
    const anchor = hudAnchor(award.kind), currency = Boolean(UNIT[award.kind]);
    const kind = award.kind === 'seals' ? 'gold' : award.kind === 'shards' ? 'crystal' : opts.particle || 'stars';
    const pal = opts.palette || AWARD_PAL[award.kind] || (KINDS[kind] || KINDS.stars).pal;
    if (level === 'cinematic' && s.cine !== 'off') {
      await cinematic(opts.preset || (award.kind === 'boss' ? 'beam' : award.kind === 'awaken' ? 'spell' : 'stamp'), {text: parts.title, sub: award.reason && award.reason !== parts.title ? award.reason : '', kicker: opts.kicker, art: opts.art, palette: opts.palette, particle: kind, form: opts.form});
      chip(award, parts, 'big'); return true;
    }
    if (level === 'big') { sfx('levelup', opts); shake(.5); impact(from, {palette: pal, scale: 1.15}); burst(kind, from, {scale: 1.2, palette: pal}); titleCard(award, parts); }
    else if (level === 'medium') { sfx('sparkle', opts); burst(kind, from, {scale: .8, palette: pal}); }
    else sfx('coin', opts);
    const travel = .55;
    if (anchor && currency) { comet(from, anchor, {count: clamp(Math.round((award.amount || 1) * 1.2), 5, 28), travel, palette: pal}); pulse(anchor, travel); }
    chip(award, parts, level);
    await wait(level === 'big' ? 900 : level === 'medium' ? 420 : 160);
    return true;
  }
  function pulse(node, delay) {
    try { node.animate([{transform: 'scale(1)'}, {transform: 'scale(1.09)', offset: .28}, {transform: 'scale(1)'}], {duration: 460, delay: delay * 1000, easing: 'cubic-bezier(.2,.8,.2,1)', composite: 'add'}); } catch { /* 老 WebKit 不支持 composite 时不跳 */ }
  }
  function countUp(node, to, ms = 520) {
    if (!(to > 1)) { node.textContent = `+${to}`; return; }
    const t0 = performance.now();
    const step = () => { const k = Math.min(1, (performance.now() - t0) / ms), e = 1 - (1 - k) ** 3; node.textContent = `+${Math.round(to * e)}`; if (k < 1) setTimeout(step, 33); };
    node.textContent = '+0'; step();
  }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function iconFor(kind) { const i = el('span', 'pk-award__icon'); i.innerHTML = ICON[kind] || ICON.badge; return i; }
  function chip(award, parts, level) {
    const host = layer(); let stack = host.querySelector('.pk-awards'); if (!stack) { stack = el('div', 'pk-awards'); host.append(stack); }
    const c = el('div', 'pk-award'); c.dataset.level = level; c.dataset.kind = award.kind || ''; c.style.setProperty('--k', KIND_COLOR[award.kind] || '#DB1F74');
    c.append(iconFor(award.kind));
    const body = el('div', 'pk-award__body'), line = el('div', 'pk-award__line');
    if (parts.num != null) { const num = el('b', 'pk-award__num'); line.append(num, el('span', 'pk-award__unit', parts.unit)); countUp(num, parts.num); }
    else line.append(el('b', 'pk-award__title', parts.title));
    body.append(line);
    if (award.reason && award.reason !== parts.title) body.append(el('small', 'pk-award__why', award.reason));
    c.append(body); stack.append(c); while (stack.children.length > 4) stack.firstElementChild.remove();
    setTimeout(() => { c.classList.add('is-out'); setTimeout(() => c.remove(), 420); }, level === 'small' ? 1800 : 2800);
  }
  function titleCard(award, parts) {
    const n = el('div', 'pk-award-title'); n.style.setProperty('--k', KIND_COLOR[award.kind] || '#d9a23c');
    const body = el('div', 'pk-award-title__body');
    body.append(el('small', '', award.kind === 'levelup' ? 'LEVEL UP' : award.kind === 'awaken' ? 'AWAKENING' : 'REWARD'), el('strong', '', parts.title));
    if (award.reason && award.reason !== parts.title) body.append(el('span', '', award.reason));
    n.append(el('i', 'pk-award-title__rule'), body, el('i', 'pk-award-title__rule'));
    layer().append(n); setTimeout(() => n.remove(), 2100);
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
      const item = el('div', 'pinkie-user-settings__row'); const copy = el('div', 'pinkie-user-settings__row-copy'); copy.append(el('span', 'pinkie-user-settings__row-title', label)); if (hint) copy.append(el('span', 'pinkie-user-settings__hint', hint)); const control = el('div', 'pinkie-user-settings__row-control'); item.append(copy, control); wrap.append(item); return {item, copy, control};
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
    burst, hit, comet, sigil, impact, hitstop, shake, cinematic, scene, registerScene, closeScene, setTier, setCustom, settings, playAward, sfx, setFormTimbre, buildSettings,
    kinds: Object.keys(KINDS), hits: Object.keys(HITS), presets: PRESETS.slice(), presetLabel: {...PRESET_LABEL}, presetEn: {...PRESET_EN}, presetTiming: {...PRESET_TIMING},
    tiers: TIER_ORDER.map(id => ({id, label: TIERS[id].label, ...TIERS[id]})),
    ensure, loadThree, loadAddons, layer, base: BASE,
    // 只给 QA 用：强制档位（不写存储）、统计、帧率测量
    _st: () => st,
    _forceTier(t) { forcedTier = TIERS[t] ? t : ''; applySettings(); },
    _timeScale(k = 1) { st.timeScale = k; for (const a of document.getAnimations?.() || []) if (a.effect?.target?.closest?.('.pk-gamefx-layer')) a.playbackRate = k; },
    stats() { const live = st.time < st.aliveUntil; return {...stats, frameTimes: undefined, alive: live, cine: Boolean(st.cine), scene: st.active?.name || '', time: st.time, webgl: Boolean(st.renderer)}; },
    fps(sinceMs = 2000) { const now = performance.now(), ts = stats.frameTimes.filter(t => t >= now - sinceMs); if (ts.length < 3) return {median: 0, p5: 0, frames: ts.length}; const dts = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b); const med = dts[Math.floor(dts.length / 2)], p95 = dts[Math.floor(dts.length * .95)]; return {median: Math.round(1000 / med), p5: Math.round(1000 / p95), frames: ts.length}; },
  };
  window.__pinkieGameFx = api;
  applySettings();
  window.dispatchEvent(new CustomEvent('pinkie:gamefx-ready'));
})();
