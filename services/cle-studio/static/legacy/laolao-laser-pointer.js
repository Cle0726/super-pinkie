/* Pinkie presentation toolbox: a global sidebar launcher that turns the
   cursor into a full presentation kit — laser, annotation pen, highlighter,
   spotlight and magnifier — drawn on a single overlay canvas.
   Interaction model borrows from gromit-mpx (keyboard-first: 1-5 switch
   tools, Cmd+Z undo, ESC leaves, no UI in the way) and ppInk (Shift+wheel
   retunes the active tool). The laser stroke itself keeps the v4 engine:
   a self-consuming polyline (excalidraw) that evaporates as one group once
   idle (tldraw telestrator). Visual language: restrained — hairline strokes
   that are white-hot at the point and cool into the theme color as they age.
   Left-click the footer icon to toggle, right-click it for settings. */
(() => {
  if (window.__laolaoLaser) return;
  const REDUCED = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

  const style = document.createElement('style');
  style.textContent = `
    #pinkie-laser-entry{color:#a24a78}
    #pinkie-laser-entry svg{width:18px;height:18px;display:block}
    #pinkie-laser-entry[aria-pressed="true"]{background:linear-gradient(180deg,#f067a4,#d13a7d) !important;color:#fff !important;box-shadow:0 4px 14px #d13a7d55,inset 0 0 0 1px #ffffff2e}
    #pinkie-laser-entry[aria-pressed="true"] svg{filter:drop-shadow(0 0 5px #ffd3e8cc)}
    html.laolao-laser-on,html.laolao-laser-on *{cursor:none !important}
    /* The overlay hides the native cursor, but the toolbar and settings panel
       are interactive chrome: the pointer must come back over them. */
    html.laolao-laser-on #pinkie-laser-toolbar,html.laolao-laser-on #pinkie-laser-toolbar *{cursor:pointer !important}
    html.laolao-laser-on #pinkie-laser-settings,html.laolao-laser-on #pinkie-laser-settings *{cursor:auto !important}
    html.laolao-laser-on #pinkie-laser-settings button,html.laolao-laser-on #pinkie-laser-settings input[type="range"],html.laolao-laser-on #pinkie-laser-settings .laser-swatch{cursor:pointer !important}
    #pinkie-laser-canvas{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:10002}
    #pinkie-laser-toolbar{position:fixed;left:0;top:50%;transform:translateY(-50%) translateX(calc(-100% + 8px));z-index:10004;display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 6px;border-radius:0 999px 999px 0;background:rgba(255,250,253,.96);box-shadow:0 8px 26px #8f3f6b30,inset 0 0 0 1px #f2cfe2;opacity:.55;transition:opacity .25s,transform .25s}
    #pinkie-laser-toolbar.laolao-laser-toolbar--show{opacity:1;transform:translateY(-50%) translateX(6px)}
    #pinkie-laser-toolbar .laser-tool-btn{width:32px;height:32px;border:0;border-radius:50%;background:transparent;color:#b04e81;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:background .18s,color .18s,transform .18s}
    #pinkie-laser-toolbar .laser-tool-btn svg{width:17px;height:17px;pointer-events:none}
    #pinkie-laser-toolbar .laser-tool-btn:hover{background:#fbe9f2;transform:translateY(-1px)}
    #pinkie-laser-toolbar .laser-tool-btn[aria-pressed="true"]{background:linear-gradient(180deg,#f067a4,#d13a7d);color:#fff;box-shadow:0 3px 10px #d13a7d4d}
    #pinkie-laser-toolbar .laser-tool-btn:disabled{opacity:.32;cursor:default;transform:none;background:transparent}
    #pinkie-laser-toolbar .laser-tool-sep{width:18px;height:1px;background:#f0d3e2;margin:3px 0}
    #pinkie-laser-hint{position:fixed;left:50%;bottom:34px;transform:translateX(-50%) translateY(8px);z-index:10003;pointer-events:none;padding:8px 16px;border-radius:999px;background:rgba(255,250,253,.94);color:#b04e81;font-size:12.5px;font-weight:500;box-shadow:0 6px 22px #a3507f33,inset 0 0 0 1px #ecc3d9;opacity:0;transition:opacity .28s,transform .28s;white-space:nowrap}
    #pinkie-laser-hint.laolao-laser-hint--show{opacity:1;transform:translateX(-50%) translateY(0)}
    #pinkie-laser-settings{position:fixed;z-index:10005;width:276px;box-sizing:border-box;max-height:min(76vh,600px);overflow-x:hidden;overflow-y:auto;padding:14px 16px 12px;border-radius:16px;background:rgba(255,253,251,.97);border:1px solid rgba(121,87,109,.14);box-shadow:0 18px 44px rgba(60,30,45,.16),0 2px 8px rgba(60,30,45,.06);color:#3a3230;font:400 13px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Hiragino Sans GB",sans-serif;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;animation:laser-settings-in .22s cubic-bezier(.3,1.3,.5,1)}
    #pinkie-laser-settings h4{margin:0 0 2px;font-size:14px;font-weight:600;color:#3a3230;display:flex;justify-content:space-between;align-items:center}
    #pinkie-laser-settings h4 button{width:24px;height:24px;display:grid;place-items:center;border:0;border-radius:7px;background:transparent;color:#a08e86;font-size:12px;line-height:1;cursor:pointer;padding:0}
    #pinkie-laser-settings h4 button:hover{background:rgba(0,0,0,.05);color:#5a4a46}
    #pinkie-laser-settings h5{margin:14px 0 2px;font-size:11.5px;font-weight:600;color:#9a8b84}
    #pinkie-laser-settings .laser-row{display:grid;grid-template-columns:60px minmax(0,1fr) 46px;align-items:center;column-gap:10px;min-height:30px}
    #pinkie-laser-settings .laser-row label{font-size:12.5px;font-weight:500;color:#5d4f52;white-space:nowrap}
    #pinkie-laser-settings .laser-row output{justify-self:end;min-width:38px;box-sizing:border-box;padding:1px 6px;border-radius:6px;background:color-mix(in srgb,var(--accent,#e94f91) 9%,#fff);color:color-mix(in srgb,var(--accent,#e94f91) 72%,#4a3a40);font-size:11.5px;font-weight:600;text-align:center;font-variant-numeric:tabular-nums}
    #pinkie-laser-settings input[type="range"]{--p:50%;width:100%;min-width:0;height:18px;margin:0;-webkit-appearance:none;appearance:none;background:transparent;outline:none;cursor:pointer}
    #pinkie-laser-settings input[type="range"]::-webkit-slider-runnable-track{height:4px;border-radius:99px;background:linear-gradient(90deg,var(--accent,#e94f91) 0 var(--p),rgba(121,87,109,.16) var(--p) 100%)}
    #pinkie-laser-settings input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:50%;background:#fff;border:1px solid rgba(121,87,109,.22);box-shadow:0 1px 4px rgba(60,30,45,.22);transition:transform .15s}
    #pinkie-laser-settings input[type="range"]:hover::-webkit-slider-thumb{transform:scale(1.15)}
    #pinkie-laser-settings input[type="range"]:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#e94f91) 30%,transparent)}
    #pinkie-laser-settings .laser-row--colors{margin-top:8px}
    #pinkie-laser-settings .laser-swatches{grid-column:2 / -1;display:flex;gap:10px}
    #pinkie-laser-settings .laser-swatch{width:20px;height:20px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.18);cursor:pointer;padding:0;transition:transform .15s}
    #pinkie-laser-settings .laser-swatch:hover{transform:scale(1.12)}
    #pinkie-laser-settings .laser-swatch[aria-pressed="true"]{box-shadow:0 0 0 2px #fff,0 0 0 3.5px currentColor}
    #pinkie-laser-settings .laser-foot{margin-top:10px;padding-top:8px;border-top:1px solid rgba(121,87,109,.1);font-size:11px;color:#a3958f}
    @keyframes laser-settings-in{from{opacity:0;transform:translateY(6px) scale(.98)}}
    @media(prefers-reduced-motion:reduce){#pinkie-laser-toolbar,#pinkie-laser-hint,#pinkie-laser-settings .laser-swatch{transition:none}#pinkie-laser-settings{animation:none}}
  `;
  document.head.append(style);

  const svgWrap = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const TOOL_ORDER = ['laser', 'pen', 'hl', 'spot', 'mag'];
  const TOOLS = {
    laser: {
      label: '激光笔',
      hint: '激光笔 · 移动留下光迹 · 单击打出光圈',
      icon: '<path d="M13.2 10.8 5.6 18.4c-.5.5-.5 1.3 0 1.8.5.5 1.3.5 1.8 0l7.6-7.6"/><path d="M14.6 9.4c-1.2-1.2-3.1-1.2-4.2 0-.4.4-.3 1 .1 1.4l2.7 2.7c.4.4 1 .5 1.4.1 1.1-1.1 1.1-3 0-4.2Z" fill="currentColor" stroke="none"/><path d="M15.5 3.5v2.2M19.6 6.4l-1.6 1.6M20.5 10.5h-2.2M8.9 4.9l1.2 1.8"/><circle cx="16.4" cy="12.9" r="1.15" fill="currentColor" stroke="none"/>',
    },
    pen: {
      label: '画笔',
      hint: '画笔 · 按住拖动标注 · ⌘Z 撤销 · C 清屏',
      icon: '<path d="M4 20l1.2-4.2L16.5 4.5a2.1 2.1 0 0 1 3 3L8.2 18.8 4 20Z"/><path d="M14.5 6.5l3 3"/>',
    },
    hl: {
      label: '荧光笔',
      hint: '荧光笔 · 半透明宽笔触，不遮字',
      icon: '<path d="M5 15.5 13.5 7l3.5 3.5L8.5 19l-4.7 1.2 1.2-4.7Z"/><path d="M15 5.5l2-2 3.5 3.5-2 2"/>',
    },
    spot: {
      label: '聚光灯',
      hint: '聚光灯 · 讲哪里亮哪里 · ⇧滚轮调孔径',
      icon: '<circle cx="12" cy="12" r="5.5"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>',
    },
    mag: {
      label: '放大镜',
      hint: '放大镜 · 圆形放大区跟随光标 · ⇧滚轮调倍率',
      icon: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3 20 20"/><path d="M8.2 10.5h4.6M10.5 8.2v4.6"/>',
    },
  };

  // ---- tunable settings (right-click the footer icon) ----------------------
  const SETTINGS_KEY = 'laolao:laser-settings.v2';
  const LEGACY_KEY = 'laolao:laser-settings.v1';
  const COLOR_PRESETS = [
    { name: '玫粉', pink: [224, 64, 127], hot: [240, 103, 168], core: [255, 226, 240], css: '#e0407f' },
    { name: '正红', pink: [229, 62, 62], hot: [247, 101, 101], core: [255, 228, 228], css: '#e53e3e' },
    { name: '鸢尾紫', pink: [139, 92, 246], hot: [167, 128, 250], core: [236, 228, 255], css: '#8b5cf6' },
    { name: '暖阳橙', pink: [245, 158, 11], hot: [250, 181, 74], core: [255, 240, 214], css: '#f59e0b' },
    { name: '冰蓝', pink: [90, 168, 255], hot: [142, 195, 255], core: [239, 247, 255], css: '#5aa8ff' },
  ];
  const DEFAULTS = {
    width: 1, trail: 1050, glow: 1, color: 4,
    penWidth: 2.5, hlWidth: 18, hlAlpha: 0.32,
    spotRadius: 130, spotDim: 0.55, magZoom: 2,
  };
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const loadSettings = () => {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}'); } catch { /* private mode */ }
    try { raw = { ...raw, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { /* private mode */ }
    return {
      width: clamp(num(raw.width, DEFAULTS.width), 0.5, 2),
      trail: clamp(num(raw.trail, DEFAULTS.trail), 400, 6000),
      glow: clamp(raw.glow === undefined ? DEFAULTS.glow : num(raw.glow, DEFAULTS.glow), 0, 2),
      color: COLOR_PRESETS[raw.color] ? raw.color : DEFAULTS.color,
      penWidth: clamp(num(raw.penWidth, DEFAULTS.penWidth), 1, 8),
      hlWidth: clamp(num(raw.hlWidth, DEFAULTS.hlWidth), 8, 32),
      hlAlpha: clamp(num(raw.hlAlpha, DEFAULTS.hlAlpha), 0.15, 0.6),
      spotRadius: clamp(num(raw.spotRadius, DEFAULTS.spotRadius), 60, 300),
      spotDim: clamp(num(raw.spotDim, DEFAULTS.spotDim), 0.3, 0.8),
      magZoom: clamp(num(raw.magZoom, DEFAULTS.magZoom), 1.5, 3),
    };
  };
  const settings = loadSettings();
  const saveSettings = () => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  };
  // Kept as live bindings so the frame loop reads the latest values. A longer
  // 轨迹持续时间 also lets the resting marks stay longer before evaporating.
  let TRAIL_MS = REDUCED ? Math.min(settings.trail, 450) : settings.trail;
  let IDLE_MS = Math.max(1300, settings.trail * 0.8);
  const syncTrail = () => {
    TRAIL_MS = REDUCED ? Math.min(settings.trail, 450) : settings.trail;
    IDLE_MS = Math.max(1300, settings.trail * 0.8);
  };
  const palette = () => COLOR_PRESETS[settings.color];
  const FADE_MS = 600;    // evaporation duration once idle
  const MAX_POINTS = 480;
  const MAX_STROKE_POINTS = 1200;

  let active = false;
  let tool = 'laser';
  let canvas = null, ctx = null, rafId = 0, dpr = 1;
  let seen = false;
  let lastMoveAt = 0;
  const cursor = { x: 0, y: 0, sx: 0, sy: 0 };
  const points = [];   // {x, y, t} raw laser samples, oldest first
  const ripples = [];  // expanding rings on click
  const strokes = [];  // committed pen / highlighter strokes
  const redoStack = [];
  let drawing = null;  // stroke in progress
  let toolbar = null;

  const resize = () => {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  };

  // Self-consuming tail: drop samples older than TRAIL_MS. While the pointer
  // keeps moving this is a constant-time comet tail; once it stops, the whole
  // stroke rests, then evaporates as one group (telestrator).
  const trimTrail = (now) => {
    const cutoff = now - TRAIL_MS;
    let drop = 0;
    while (drop < points.length && points[drop].t < cutoff) drop++;
    if (drop > 0) points.splice(0, drop);
  };

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const lerp = (a, b, t) => a + (b - a) * t;

  // One pass over the laser stroke. Each segment is a quadratic curve through
  // its sample; color lerps from white-hot (young) into the preset (old)
  // while alpha and width ease out — light cooling as it ages. `rise` lifts
  // the whole stroke a few pixels while it evaporates, like heat haze.
  const strokePass = (now, width, alpha, groupFade, rise, aura) => {
    const pal = palette();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < points.length - 1; i++) {
      const age = (now - points[i].t) / TRAIL_MS;
      const k = Math.max(0, 1 - age) * groupFade;
      if (k <= 0.015) continue;
      const rgb = aura
        ? pal.pink
        : [0, 1, 2].map(c => Math.round(lerp(pal.core[c], pal.hot[c], Math.min(1, age * 1.6))));
      const a = alpha * easeOut(k);
      const w = Math.max(0.5, width * settings.width * (0.4 + 0.6 * k));
      const mx = (points[i].x + points[i + 1].x) / 2;
      const my = (points[i].y + points[i + 1].y) / 2 - rise;
      const px = (points[i - 1].x + points[i].x) / 2;
      const py = (points[i - 1].y + points[i].y) / 2 - rise;
      ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(points[i].x, points[i].y - rise, mx, my);
      ctx.stroke();
    }
  };

  // The laser spot: small and precise. A crisp white point inside a thin
  // colored ring, with the faintest halo. Nothing flashy — restraint.
  const drawHead = (x, y, groupFade) => {
    const pal = palette();
    if (settings.glow > 0.05) {
      const auraR = 11 * settings.glow;
      const aura = ctx.createRadialGradient(x, y, 0, x, y, auraR);
      aura.addColorStop(0, `rgba(${pal.pink[0]},${pal.pink[1]},${pal.pink[2]},${.2 * groupFade})`);
      aura.addColorStop(1, `rgba(${pal.pink[0]},${pal.pink[1]},${pal.pink[2]},0)`);
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(x, y, auraR, 0, Math.PI * 2);
      ctx.fill();
    }
    const haloR = 4.6;
    const halo = ctx.createRadialGradient(x, y, 0, x, y, haloR);
    halo.addColorStop(0, `rgba(255,255,255,${.96 * groupFade})`);
    halo.addColorStop(.55, `rgba(${pal.hot[0]},${pal.hot[1]},${pal.hot[2]},${.7 * groupFade})`);
    halo.addColorStop(1, `rgba(${pal.hot[0]},${pal.hot[1]},${pal.hot[2]},0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, haloR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${groupFade})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  };

  // Committed pen / highlighter strokes: same midpoint smoothing as the
  // laser, but permanent until undone or cleared.
  const drawStroke = (s) => {
    if (s.pts.length < 2) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.style;
    ctx.lineWidth = s.width;
    ctx.beginPath();
    ctx.moveTo(s.pts[0].x, s.pts[0].y);
    for (let i = 1; i < s.pts.length - 1; i++) {
      const mx = (s.pts[i].x + s.pts[i + 1].x) / 2;
      const my = (s.pts[i].y + s.pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(s.pts[i].x, s.pts[i].y, mx, my);
    }
    const last = s.pts[s.pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  };
  const strokeStyle = (kind) => {
    const pal = palette();
    if (kind === 'hl') return `rgba(${pal.hot[0]},${pal.hot[1]},${pal.hot[2]},${settings.hlAlpha})`;
    return `rgba(${pal.pink[0]},${pal.pink[1]},${pal.pink[2]},0.92)`;
  };

  // Spotlight: one radial gradient covering the whole screen — transparent
  // inside the aperture, dim outside. Strokes drawn afterwards stay lit.
  const drawSpot = (x, y) => {
    const r = settings.spotRadius;
    const dim = ctx.createRadialGradient(x, y, r * 0.85, x, y, r * 1.3);
    dim.addColorStop(0, 'rgba(24,10,18,0)');
    dim.addColorStop(1, `rgba(24,10,18,${settings.spotDim})`);
    ctx.fillStyle = dim;
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.02, 0, Math.PI * 2);
    ctx.stroke();
  };

  // Magnifier: a circular lens sampling the live screen-capture video around
  // the cursor. Screen coordinates come from pointer events, so the crop
  // stays aligned even when the window is not fullscreen.
  let magStream = null, magVideo = null;
  const stopMag = () => {
    magStream?.getTracks().forEach(track => track.stop());
    magStream = null;
    if (magVideo) { magVideo.srcObject = null; magVideo = null; }
  };
  const startMag = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      showHint('当前环境不支持屏幕捕获，已切换到聚光灯');
      setTool('spot');
      return;
    }
    try {
      magStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      magVideo = document.createElement('video');
      magVideo.muted = true;
      magVideo.srcObject = magStream;
      await magVideo.play();
      magStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopMag();
        if (active && tool === 'mag') { showHint('屏幕共享已结束，切换到聚光灯'); setTool('spot'); }
      });
    } catch {
      stopMag();
      if (active && tool === 'mag') { showHint('未获得屏幕录制权限，已切换到聚光灯'); setTool('spot'); }
    }
  };
  const drawLens = () => {
    const pal = palette();
    const R = 110;
    if (magVideo && magVideo.readyState >= 2 && magVideo.videoWidth) {
      const z = settings.magZoom;
      const scale = magVideo.videoWidth / (window.screen.width || window.innerWidth);
      const sw = (R * 2 / z) * scale;
      const sh = sw * (magVideo.videoHeight / magVideo.videoWidth);
      const sx = cursor.sx * scale - sw / 2;
      const sy = cursor.sy * (magVideo.videoHeight / (window.screen.height || window.innerHeight)) - sh / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(magVideo, sx, sy, sw, sh, cursor.x - R, cursor.y - R, R * 2, R * 2);
      ctx.restore();
    }
    ctx.strokeStyle = `rgba(${pal.pink[0]},${pal.pink[1]},${pal.pink[2]},.95)`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, R - 3.5, 0, Math.PI * 2);
    ctx.stroke();
  };

  // Small ring cursor for pen / highlighter so the hidden native cursor
  // still has an on-screen presence sized to the stroke.
  const drawToolCursor = () => {
    const pal = palette();
    if (tool === 'pen' || tool === 'hl') {
      const w = tool === 'pen' ? settings.penWidth : settings.hlWidth;
      const r = Math.max(2.5, w / 2);
      if (tool === 'hl') {
        ctx.fillStyle = `rgba(${pal.hot[0]},${pal.hot[1]},${pal.hot[2]},${settings.hlAlpha * .5})`;
        ctx.beginPath();
        ctx.arc(cursor.x, cursor.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(${pal.pink[0]},${pal.pink[1]},${pal.pink[2]},.85)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  const frame = (now) => {
    rafId = requestAnimationFrame(frame);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    if (tool === 'spot' && seen) drawSpot(cursor.x, cursor.y);

    for (const s of strokes) drawStroke(s);
    if (drawing) drawStroke(drawing);

    ctx.globalCompositeOperation = 'lighter';
    trimTrail(now);
    const idleFor = now - lastMoveAt;
    // Group fade: the resting stroke evaporates as one piece after IDLE_MS.
    const fadeT = idleFor <= IDLE_MS ? 0 : Math.min(1, (idleFor - IDLE_MS) / FADE_MS);
    const groupFade = 1 - easeOut(fadeT);
    const rise = REDUCED ? 0 : fadeT * 5;
    if (groupFade <= 0 && points.length) points.length = 0;

    if (tool === 'laser' && points.length > 1) {
      if (settings.glow > 0.05) strokePass(now, 3.4, .1 * settings.glow, groupFade, rise, true); // whisper aura
      strokePass(now, 1.7, .85, groupFade, rise, false);                                          // hairline
    }

    const pal = palette();
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.t += REDUCED ? .16 : .06;
      if (r.t >= 1) { ripples.splice(i, 1); continue; }
      // One crisp hairline ring, expanding with a long ease, nothing else.
      const ease = 1 - Math.pow(1 - r.t, 4);
      ctx.strokeStyle = `rgba(${pal.pink[0]},${pal.pink[1]},${pal.pink[2]},${(1 - r.t) * .7})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 5 + ease * 36, 0, Math.PI * 2);
      ctx.stroke();
      if (r.t < .3) {
        ctx.fillStyle = `rgba(${pal.hot[0]},${pal.hot[1]},${pal.hot[2]},${(1 - r.t / .3) * .6})`;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (tool === 'laser' && seen && points.length) {
      const head = points[points.length - 1];
      drawHead(head.x, head.y, groupFade);
    }
    ctx.globalCompositeOperation = 'source-over';

    if (seen) drawToolCursor();
    if (tool === 'mag' && seen) drawLens();
  };

  let hintTimer = 0;
  const showHint = (text) => {
    let hint = document.getElementById('pinkie-laser-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'pinkie-laser-hint';
      document.body.append(hint);
    }
    hint.textContent = text;
    requestAnimationFrame(() => hint.classList.add('laolao-laser-hint--show'));
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove('laolao-laser-hint--show'), 2600);
  };

  // ---- floating toolbar ----------------------------------------------------
  const syncToolbar = () => {
    if (!toolbar) return;
    toolbar.querySelectorAll('.laser-tool-btn[data-tool]').forEach(btn =>
      btn.setAttribute('aria-pressed', btn.dataset.tool === tool ? 'true' : 'false'));
    const undoBtn = toolbar.querySelector('[data-act="undo"]');
    const redoBtn = toolbar.querySelector('[data-act="redo"]');
    const clearBtn = toolbar.querySelector('[data-act="clear"]');
    if (undoBtn) undoBtn.disabled = strokes.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
    if (clearBtn) clearBtn.disabled = strokes.length === 0 && !drawing;
  };
  const toolButton = (id) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'laser-tool-btn';
    btn.dataset.tool = id;
    btn.innerHTML = svgWrap(TOOLS[id].icon);
    btn.title = `${TOOLS[id].label}（${TOOL_ORDER.indexOf(id) + 1}）`;
    btn.setAttribute('aria-label', TOOLS[id].label);
    btn.setAttribute('aria-pressed', id === tool ? 'true' : 'false');
    btn.addEventListener('click', () => setTool(id));
    return btn;
  };
  const actButton = (act, label, icon, onClick) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'laser-tool-btn';
    btn.dataset.act = act;
    btn.innerHTML = svgWrap(icon);
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.addEventListener('click', onClick);
    return btn;
  };
  const buildToolbar = () => {
    toolbar = document.createElement('div');
    toolbar.id = 'pinkie-laser-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '演示工具');
    TOOL_ORDER.forEach(id => toolbar.append(toolButton(id)));
    const sep = document.createElement('span');
    sep.className = 'laser-tool-sep';
    toolbar.append(sep);
    toolbar.append(actButton('undo', '撤销（⌘Z）', '<path d="M8 5 4 9l4 4"/><path d="M4 9h9a6 6 0 0 1 0 12h-2"/>', undoStroke));
    toolbar.append(actButton('redo', '重做（⌘⇧Z）', '<path d="m16 5 4 4-4 4"/><path d="M20 9h-9a6 6 0 0 0 0 12h2"/>', redoStroke));
    toolbar.append(actButton('clear', '清屏（C）', '<path d="M5 5l14 14M19 5 5 19"/>', clearStrokes));
    toolbar.append(actButton('close', '退出（ESC）', '<path d="M12 3v8"/><path d="M6.5 6.2a8 8 0 1 0 11 0"/>', off));
    document.body.append(toolbar);
    syncToolbar();
  };

  // Edge-docked auto-hide: the bar rests as a thin tab on the left edge and
  // slides in only when the pointer comes near, so it never covers the
  // composer. The band between the tab and the chat area keeps the current
  // state, which makes hovering the revealed bar stable.
  let toolbarHideTimer = 0;
  const syncToolbarProximity = (x) => {
    if (!toolbar) return;
    if (x < 56) {
      clearTimeout(toolbarHideTimer);
      toolbar.classList.add('laolao-laser-toolbar--show');
    } else if (x > 220) {
      clearTimeout(toolbarHideTimer);
      toolbarHideTimer = setTimeout(() => toolbar?.classList.remove('laolao-laser-toolbar--show'), 500);
    }
  };

  // ---- settings popover (right-click the footer icon) ----------------------
  let settingsPanel = null;
  const closeSettings = () => { settingsPanel?.remove(); settingsPanel = null; };

  const openSettings = (anchor) => {
    if (settingsPanel) { closeSettings(); return; }
    const panel = document.createElement('div');
    panel.id = 'pinkie-laser-settings';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '演示工具设置');

    const head = document.createElement('h4');
    head.textContent = '演示工具设置';
    const closer = document.createElement('button');
    closer.type = 'button';
    closer.textContent = '✕';
    closer.setAttribute('aria-label', '关闭设置');
    closer.onclick = closeSettings;
    head.append(closer);
    panel.append(head);

    const section = (title) => {
      const h = document.createElement('h5');
      h.textContent = title;
      panel.append(h);
    };
    const slider = (label, min, max, step, get, set, format) => {
      const row = document.createElement('div');
      row.className = 'laser-row';
      const name = document.createElement('label');
      name.textContent = label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min; input.max = max; input.step = step; input.value = get();
      const out = document.createElement('output');
      out.textContent = format(get());
      // 轨道左边按当前值填色，一眼看出大概在哪个位置
      const fill = () => input.style.setProperty('--p', `${((Number(input.value) - min) / (max - min)) * 100}%`);
      fill();
      input.addEventListener('input', () => {
        set(Number(input.value));
        saveSettings();
        syncTrail();
        out.textContent = format(get());
        fill();
      });
      row.append(name, input, out);
      panel.append(row);
    };

    section('激光笔');
    slider('粗细', 0.5, 2, 0.1, () => settings.width, v => { settings.width = v; }, v => `${v.toFixed(1)}×`);
    slider('轨迹时长', 400, 6000, 100, () => settings.trail, v => { settings.trail = v; }, v => `${(v / 1000).toFixed(1)}s`);
    slider('辉光', 0, 2, 0.1, () => settings.glow, v => { settings.glow = v; }, v => `${v.toFixed(1)}×`);
    section('画笔 / 荧光笔');
    slider('画笔粗细', 1, 8, 0.5, () => settings.penWidth, v => { settings.penWidth = v; }, v => `${v.toFixed(1)}px`);
    slider('荧光宽幅', 8, 32, 1, () => settings.hlWidth, v => { settings.hlWidth = v; }, v => `${v.toFixed(0)}px`);
    slider('荧光浓度', 0.15, 0.6, 0.01, () => settings.hlAlpha, v => { settings.hlAlpha = v; }, v => `${Math.round(v * 100)}%`);
    section('聚光灯 / 放大镜');
    slider('光孔大小', 60, 300, 5, () => settings.spotRadius, v => { settings.spotRadius = v; }, v => `${v.toFixed(0)}px`);
    slider('压暗程度', 0.3, 0.8, 0.05, () => settings.spotDim, v => { settings.spotDim = v; }, v => `${Math.round(v * 100)}%`);
    slider('放大倍率', 1.5, 3, 0.1, () => settings.magZoom, v => { settings.magZoom = v; }, v => `${v.toFixed(1)}×`);

    const colorRow = document.createElement('div');
    colorRow.className = 'laser-row laser-row--colors';
    const colorLabel = document.createElement('label');
    colorLabel.textContent = '颜色';
    const swatches = document.createElement('div');
    swatches.className = 'laser-swatches';
    COLOR_PRESETS.forEach((preset, index) => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'laser-swatch';
      sw.style.background = preset.css;
      sw.style.color = preset.css;
      sw.title = preset.name;
      sw.setAttribute('aria-label', `主题色：${preset.name}`);
      sw.setAttribute('aria-pressed', settings.color === index ? 'true' : 'false');
      sw.onclick = () => {
        settings.color = index;
        saveSettings();
        swatches.querySelectorAll('.laser-swatch').forEach(el =>
          el.setAttribute('aria-pressed', el === sw ? 'true' : 'false'));
      };
      swatches.append(sw);
    });
    colorRow.append(colorLabel, swatches);
    panel.append(colorRow);

    const foot = document.createElement('div');
    foot.className = 'laser-foot';
    foot.textContent = '右键图标随时调整 · 设置自动保存';
    panel.append(foot);

    document.body.append(panel);
    const rect = anchor.getBoundingClientRect();
    panel.style.left = `${Math.min(window.innerWidth - panel.offsetWidth - 8, Math.max(8, rect.left - 12))}px`;
    panel.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 10)}px`;
    settingsPanel = panel;

    setTimeout(() => {
      window.addEventListener('pointerdown', function dismiss(event) {
        if (!settingsPanel) { window.removeEventListener('pointerdown', dismiss); return; }
        if (!settingsPanel.contains(event.target) && event.target.id !== 'pinkie-laser-entry') {
          closeSettings();
          window.removeEventListener('pointerdown', dismiss);
        }
      });
    }, 0);
  };

  // ---- stroke management ----------------------------------------------------
  function undoStroke() {
    const s = strokes.pop();
    if (s) redoStack.push(s);
    syncToolbar();
  }
  function redoStroke() {
    const s = redoStack.pop();
    if (s) strokes.push(s);
    syncToolbar();
  }
  function clearStrokes() {
    strokes.length = 0;
    redoStack.length = 0;
    drawing = null;
    syncToolbar();
  }

  // ---- tool switching --------------------------------------------------------
  const setTool = (next) => {
    if (!TOOLS[next]) return;
    if (tool === 'mag' && next !== 'mag') stopMag();
    tool = next;
    drawing = null;
    points.length = 0;
    syncToolbar();
    if (next === 'mag') startMag();
    showHint(TOOLS[next].hint);
  };

  // ---- pointer + keyboard ----------------------------------------------------
  const onMove = (event) => {
    const now = performance.now();
    cursor.x = event.clientX; cursor.y = event.clientY;
    cursor.sx = event.screenX; cursor.sy = event.screenY;
    seen = true;
    syncToolbarProximity(event.clientX);
    if (drawing) {
      const last = drawing.pts[drawing.pts.length - 1];
      if (!last || Math.hypot(event.clientX - last.x, event.clientY - last.y) >= 1.5) {
        drawing.pts.push({ x: event.clientX, y: event.clientY });
        if (drawing.pts.length > MAX_STROKE_POINTS) drawing.pts.splice(0, drawing.pts.length - MAX_STROKE_POINTS);
      }
      return;
    }
    if (tool !== 'laser') return;
    const last = points[points.length - 1];
    // Sub-pixel jitter only pollutes the curve; demand ~1.5px of travel.
    if (last && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 1.5) return;
    points.push({ x: event.clientX, y: event.clientY, t: now });
    if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);
    lastMoveAt = now;
  };
  const onDown = (event) => {
    if (event.button !== 0) return;
    if (tool === 'pen' || tool === 'hl') {
      drawing = {
        kind: tool,
        width: tool === 'pen' ? settings.penWidth : settings.hlWidth,
        style: strokeStyle(tool),
        pts: [{ x: event.clientX, y: event.clientY }],
      };
      redoStack.length = 0;
      return;
    }
    ripples.push({ x: event.clientX, y: event.clientY, t: 0 });
    if (ripples.length > 6) ripples.shift();
  };
  const onUp = () => {
    if (!drawing) return;
    if (drawing.pts.length > 1) strokes.push(drawing);
    drawing = null;
    syncToolbar();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      // Settings panel gets the first Escape; the toolbox itself gets the next.
      if (settingsPanel) { closeSettings(); return; }
      off();
      return;
    }
    if (!active) return;
    const typing = event.target?.closest?.('input, textarea, [contenteditable="true"], [contenteditable=""]');
    if (typing) return;
    // macOS first: Cmd+Z / Cmd+Shift+Z (Ctrl accepted for parity).
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoStroke(); else undoStroke();
      }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const digit = TOOL_ORDER[Number(event.key) - 1];
    if (digit && event.key.length === 1) { setTool(digit); return; }
    if (event.key.toLowerCase() === 'c' && event.key.length === 1) clearStrokes();
  };
  // Shift+wheel retunes the active tool (ppInk style); plain wheel scrolls.
  const WHEEL_STEPS = {
    laser: { get: () => settings.width, set: v => { settings.width = clamp(v, 0.5, 2); }, step: 0.1 },
    pen: { get: () => settings.penWidth, set: v => { settings.penWidth = clamp(v, 1, 8); }, step: 0.5 },
    hl: { get: () => settings.hlWidth, set: v => { settings.hlWidth = clamp(v, 8, 32); }, step: 2 },
    spot: { get: () => settings.spotRadius, set: v => { settings.spotRadius = clamp(v, 60, 300); }, step: 10 },
    mag: { get: () => settings.magZoom, set: v => { settings.magZoom = clamp(v, 1.5, 3); }, step: 0.1 },
  };
  const onWheel = (event) => {
    if (!active || !event.shiftKey) return;
    event.preventDefault();
    const spec = WHEEL_STEPS[tool];
    if (!spec) return;
    spec.set(spec.get() + (event.deltaY > 0 ? -spec.step : spec.step));
    saveSettings();
  };
  const onLeave = () => { seen = false; };

  const syncButton = () => {
    const btn = document.getElementById('pinkie-laser-entry');
    if (btn) btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  };

  const on = () => {
    if (active) return;
    active = true;
    document.documentElement.classList.add('laolao-laser-on');
    canvas = document.createElement('canvas');
    canvas.id = 'pinkie-laser-canvas';
    ctx = canvas.getContext('2d');
    document.body.append(canvas);
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    document.documentElement.addEventListener('pointerleave', onLeave);
    buildToolbar();
    rafId = requestAnimationFrame(frame);
    syncButton();
    if (tool === 'mag') startMag();
    showHint('演示工具已开启 · 1-5 切换 · ⇧滚轮调粗细 · ⌘Z 撤销 · 左缘唤出工具条 · ESC 退出');
  };

  const off = () => {
    if (!active) return;
    active = false;
    document.documentElement.classList.remove('laolao-laser-on');
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('wheel', onWheel);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    stopMag();
    clearTimeout(toolbarHideTimer);
    canvas?.remove(); canvas = null; ctx = null;
    toolbar?.remove(); toolbar = null;
    points.length = 0; ripples.length = 0;
    strokes.length = 0; redoStack.length = 0;
    drawing = null; seen = false;
    closeSettings();
    document.getElementById('pinkie-laser-hint')?.remove();
    syncButton();
  };

  const toggle = () => (active ? off() : on());
  window.__laolaoLaser = {
    toggle, on, off, setTool,
    active: () => active,
    tool: () => tool,
    settings,
    strokes: () => strokes.length,
    undo: undoStroke, redo: redoStroke, clear: clearStrokes,
  };

  // ---- global sidebar footer launcher -------------------------------------
  // The toolbox is global, not tied to one mode's workspace rail: it mounts
  // into the sidebar footer icon bar next to docs / update / more tools.
  const mount = () => {
    const footer = document.querySelector('.sidebar-shell__footer');
    const host = footer?.querySelector('.sidebar-footer-actions') ||
      footer?.querySelector('.sidebar-footer-bar') || footer;
    let btn = document.getElementById('pinkie-laser-entry');
    if (!host) { btn?.remove(); return; }
    if (btn?.parentElement === host) return;
    btn?.remove();
    btn = document.createElement('button');
    btn.id = 'pinkie-laser-entry';
    btn.type = 'button';
    btn.className = 'sidebar-brand__icon sidebar-footer-icon';
    btn.title = '演示工具：左键开启，右键设置（ESC 退出）';
    btn.setAttribute('aria-label', '演示工具：激光笔、画笔、荧光笔、聚光灯、放大镜');
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.innerHTML = svgWrap(TOOLS.laser.icon);
    btn.addEventListener('click', toggle);
    btn.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openSettings(btn);
    });
    const more = host.querySelector('.laolao-footer-more');
    if (more) more.before(btn); else host.append(btn);
  };
  // Poll instead of a subtree-wide observer: during streaming every markdown
  // chunk rebuilds the DOM, and wide observers each receive a copy of every
  // mutation record. mount() is idempotent, so a slow 1.5s poll is plenty.
  setInterval(mount, 1500);
  mount();
})();
