/* Pinkie laser pointer: a rail launcher that turns the cursor into a real
   presentation laser — a fine thread of light drawn behind the point.
   The stroke is a self-consuming polyline (PowerPoint style): while you move
   it keeps a constant-time tail, and when you stop it evaporates as one
   piece (telestrator style), like the laser tools in excalidraw and tldraw.
   Left-click the rail button to toggle, right-click it to tune parameters,
   ESC to leave. Visual language: restrained — a hairline stroke that is
   white-hot at the point and cools into the theme color as it ages. */
(() => {
  const REDUCED = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

  const style = document.createElement('style');
  style.textContent = `
    #pinkie-laser-entry{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;min-height:92px;margin:5px 2px 6px;padding:8px 0;flex-shrink:0;border:0;border-radius:18px;color:#a24a78;background:linear-gradient(180deg,#fff5fb14,#fff4fae6 46%,#f9dff03a);cursor:pointer;user-select:none;-webkit-user-select:none;transition:background .22s,box-shadow .22s,transform .22s}
    #pinkie-laser-entry svg{width:26px;height:26px;pointer-events:none;filter:drop-shadow(0 3px 5px #c06a992e);transition:transform .3s}
    #pinkie-laser-entry span{writing-mode:vertical-rl;font-size:11px;font-weight:550;letter-spacing:3px;line-height:1}
    #pinkie-laser-entry:hover{background:#fff7fbe0;box-shadow:inset 0 0 0 1px #d98bb126}
    #pinkie-laser-entry:hover svg{transform:translateY(-2px) rotate(-8deg)}
    #pinkie-laser-entry:focus-visible{outline:2px solid #d983ae;outline-offset:-2px}
    #pinkie-laser-entry[aria-pressed="true"]{background:linear-gradient(180deg,#f067a4,#d13a7d);color:#fff;box-shadow:0 4px 14px #d13a7d55,inset 0 0 0 1px #ffffff2e}
    #pinkie-laser-entry[aria-pressed="true"] svg{filter:drop-shadow(0 0 6px #ffd3e8cc)}
    .chat-workspace-rail:not(.chat-workspace-rail--collapsed) #pinkie-laser-entry{flex-direction:row;min-height:52px;margin:6px 12px;padding:7px 10px}
    .chat-workspace-rail:not(.chat-workspace-rail--collapsed) #pinkie-laser-entry span{writing-mode:horizontal-tb;letter-spacing:2px}
    html.laolao-laser-on,html.laolao-laser-on *{cursor:none !important}
    #pinkie-laser-canvas{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:10002}
    #pinkie-laser-hint{position:fixed;left:50%;bottom:34px;transform:translateX(-50%) translateY(8px);z-index:10003;pointer-events:none;padding:8px 16px;border-radius:999px;background:rgba(255,250,253,.94);color:#b04e81;font-size:12px;font-weight:550;letter-spacing:1px;box-shadow:0 6px 22px #a3507f33,inset 0 0 0 1px #ecc3d9;opacity:0;transition:opacity .28s,transform .28s}
    #pinkie-laser-hint.laolao-laser-hint--show{opacity:1;transform:translateX(-50%) translateY(0)}
    #pinkie-laser-settings{position:fixed;z-index:10004;width:216px;padding:14px 14px 10px;border-radius:16px;background:rgba(255,251,253,.97);box-shadow:0 10px 34px #8f3f6b38,inset 0 0 0 1px #f2cfe2;color:#8d4265;font-size:12px;user-select:none;-webkit-user-select:none}
    #pinkie-laser-settings h4{margin:0 0 10px;font-size:12.5px;font-weight:650;letter-spacing:2px;color:#c2497f;display:flex;justify-content:space-between;align-items:center}
    #pinkie-laser-settings h4 button{border:0;background:none;color:#c98bab;font-size:13px;cursor:pointer;padding:2px 4px;border-radius:6px}
    #pinkie-laser-settings h4 button:hover{background:#fbe9f2;color:#b04e81}
    #pinkie-laser-settings .laser-row{display:flex;align-items:center;gap:8px;margin:7px 0}
    #pinkie-laser-settings .laser-row label{flex:0 0 52px;font-weight:550;letter-spacing:1px}
    #pinkie-laser-settings .laser-row output{flex:0 0 34px;text-align:right;color:#c2497f;font-weight:600;font-variant-numeric:tabular-nums}
    #pinkie-laser-settings input[type="range"]{flex:1;height:3px;-webkit-appearance:none;appearance:none;border-radius:99px;background:linear-gradient(90deg,#f067a4,#f4c4db);outline:none;cursor:pointer}
    #pinkie-laser-settings input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:13px;height:13px;border-radius:50%;background:#fff;border:2.5px solid #e0559a;box-shadow:0 1px 5px #d13a7d4d;cursor:pointer}
    #pinkie-laser-settings .laser-swatches{display:flex;gap:8px;margin:10px 0 4px;padding-left:60px}
    #pinkie-laser-settings .laser-swatch{width:20px;height:20px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px #00000026,inset 0 0 0 1px #00000014;cursor:pointer;padding:0;transition:transform .15s}
    #pinkie-laser-settings .laser-swatch:hover{transform:scale(1.15)}
    #pinkie-laser-settings .laser-swatch[aria-pressed="true"]{box-shadow:0 0 0 2px #fff,0 0 0 4px currentColor}
    #pinkie-laser-settings .laser-foot{margin-top:8px;padding-top:8px;border-top:1px solid #f6d9e8;font-size:10.5px;color:#c98bab;letter-spacing:.5px}
    @media(prefers-reduced-motion:reduce){#pinkie-laser-entry,#pinkie-laser-entry svg,#pinkie-laser-hint,#pinkie-laser-settings .laser-swatch{transition:none}}
  `;
  document.head.append(style);

  const ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<path d="M13.2 10.8 5.6 18.4c-.5.5-.5 1.3 0 1.8.5.5 1.3.5 1.8 0l7.6-7.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'
    + '<path d="M14.6 9.4c-1.2-1.2-3.1-1.2-4.2 0-.4.4-.3 1 .1 1.4l2.7 2.7c.4.4 1 .5 1.4.1 1.1-1.1 1.1-3 0-4.2Z" fill="currentColor" opacity=".9"/>'
    + '<path d="M15.5 3.5v2.2M19.6 6.4l-1.6 1.6M20.5 10.5h-2.2M8.9 4.9l1.2 1.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
    + '<circle cx="16.4" cy="12.9" r="1.15" fill="currentColor"/>'
    + '</svg>';

  // ---- tunable settings (right-click the rail button) ---------------------
  const SETTINGS_KEY = 'laolao:laser-settings.v1';
  const COLOR_PRESETS = [
    { name: '玫粉', pink: [224, 64, 127], hot: [240, 103, 168], core: [255, 226, 240], css: '#e0407f' },
    { name: '正红', pink: [229, 62, 62], hot: [247, 101, 101], core: [255, 228, 228], css: '#e53e3e' },
    { name: '鸢尾紫', pink: [139, 92, 246], hot: [167, 128, 250], core: [236, 228, 255], css: '#8b5cf6' },
    { name: '暖阳橙', pink: [245, 158, 11], hot: [250, 181, 74], core: [255, 240, 214], css: '#f59e0b' },
  ];
  const DEFAULTS = { width: 1, trail: 1050, glow: 1, color: 0 };
  const loadSettings = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return {
        width: Math.min(2, Math.max(0.5, Number(raw.width) || DEFAULTS.width)),
        trail: Math.min(6000, Math.max(400, Number(raw.trail) || DEFAULTS.trail)),
        glow: Math.min(2, Math.max(0, raw.glow === undefined ? DEFAULTS.glow : Number(raw.glow))),
        color: COLOR_PRESETS[raw.color] ? raw.color : 0,
      };
    } catch { return { ...DEFAULTS }; }
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

  let active = false;
  let canvas = null, ctx = null, rafId = 0, dpr = 1;
  let seen = false;
  let lastMoveAt = 0;
  const points = [];   // {x, y, t} raw pointer samples, oldest first
  const ripples = [];  // expanding rings on click

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

  // One pass over the stroke. Each segment is a quadratic curve through its
  // sample; color lerps from white-hot (young) into the preset (old) while
  // alpha and width ease out — light cooling as it ages. `rise` lifts the
  // whole stroke a few pixels while it evaporates, like heat haze.
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

  const frame = (now) => {
    rafId = requestAnimationFrame(frame);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalCompositeOperation = 'lighter';

    trimTrail(now);
    const idleFor = now - lastMoveAt;
    // Group fade: the resting stroke evaporates as one piece after IDLE_MS.
    const fadeT = idleFor <= IDLE_MS ? 0 : Math.min(1, (idleFor - IDLE_MS) / FADE_MS);
    const groupFade = 1 - easeOut(fadeT);
    const rise = REDUCED ? 0 : fadeT * 5;
    if (groupFade <= 0 && points.length) points.length = 0;

    if (points.length > 1) {
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

    if (seen && points.length) {
      const head = points[points.length - 1];
      drawHead(head.x, head.y, groupFade);
    }
    ctx.globalCompositeOperation = 'source-over';
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
    hintTimer = setTimeout(() => hint.classList.remove('laolao-laser-hint--show'), 2400);
  };

  // ---- settings popover (right-click the rail button) ---------------------
  let settingsPanel = null;
  const closeSettings = () => { settingsPanel?.remove(); settingsPanel = null; };

  const openSettings = (anchor) => {
    if (settingsPanel) { closeSettings(); return; }
    const panel = document.createElement('div');
    panel.id = 'pinkie-laser-settings';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '激光笔设置');

    const head = document.createElement('h4');
    head.textContent = '激光笔设置';
    const closer = document.createElement('button');
    closer.type = 'button';
    closer.textContent = '✕';
    closer.setAttribute('aria-label', '关闭设置');
    closer.onclick = closeSettings;
    head.append(closer);
    panel.append(head);

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
      input.addEventListener('input', () => {
        set(Number(input.value));
        saveSettings();
        syncTrail();
        out.textContent = format(get());
      });
      row.append(name, input, out);
      panel.append(row);
    };

    slider('粗细', 0.5, 2, 0.1, () => settings.width, v => { settings.width = v; }, v => `${v.toFixed(1)}×`);
    slider('轨迹时长', 400, 6000, 100, () => settings.trail, v => { settings.trail = v; }, v => `${(v / 1000).toFixed(1)}s`);
    slider('辉光', 0, 2, 0.1, () => settings.glow, v => { settings.glow = v; }, v => `${v.toFixed(1)}×`);

    const swatches = document.createElement('div');
    swatches.className = 'laser-swatches';
    COLOR_PRESETS.forEach((preset, index) => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'laser-swatch';
      sw.style.background = preset.css;
      sw.style.color = preset.css;
      sw.title = preset.name;
      sw.setAttribute('aria-label', `激光颜色：${preset.name}`);
      sw.setAttribute('aria-pressed', settings.color === index ? 'true' : 'false');
      sw.onclick = () => {
        settings.color = index;
        saveSettings();
        swatches.querySelectorAll('.laser-swatch').forEach(el =>
          el.setAttribute('aria-pressed', el === sw ? 'true' : 'false'));
      };
      swatches.append(sw);
    });
    panel.append(swatches);

    const foot = document.createElement('div');
    foot.className = 'laser-foot';
    foot.textContent = '右键图标随时调整 · 设置自动保存';
    panel.append(foot);

    document.body.append(panel);
    const rect = anchor.getBoundingClientRect();
    panel.style.right = `${Math.max(8, window.innerWidth - rect.left + 10)}px`;
    panel.style.top = `${Math.min(window.innerHeight - 240, Math.max(8, rect.top - 40))}px`;
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

  const onMove = (event) => {
    const now = performance.now();
    const last = points[points.length - 1];
    // Sub-pixel jitter only pollutes the curve; demand ~1.5px of travel.
    if (last && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 1.5) return;
    points.push({ x: event.clientX, y: event.clientY, t: now });
    if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);
    lastMoveAt = now;
    seen = true;
  };
  const onDown = (event) => {
    ripples.push({ x: event.clientX, y: event.clientY, t: 0 });
    if (ripples.length > 6) ripples.shift();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      // Settings panel gets the first Escape; the laser itself gets the next.
      if (settingsPanel) { closeSettings(); return; }
      off();
    }
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
    window.addEventListener('keydown', onKey);
    document.documentElement.addEventListener('pointerleave', onLeave);
    rafId = requestAnimationFrame(frame);
    syncButton();
    showHint('激光笔已开启 · 移动留下光迹 · 单击打出光圈 · ESC 退出 · 右键图标调参数');
  };

  const off = () => {
    if (!active) return;
    active = false;
    document.documentElement.classList.remove('laolao-laser-on');
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('keydown', onKey);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    canvas?.remove(); canvas = null; ctx = null;
    points.length = 0; ripples.length = 0; seen = false;
    closeSettings();
    document.getElementById('pinkie-laser-hint')?.remove();
    syncButton();
  };

  const toggle = () => (active ? off() : on());
  window.__laolaoLaser = { toggle, on, off, active: () => active, settings };

  // ---- rail launcher ------------------------------------------------------
  const mount = () => {
    const rail = document.querySelector('.chat-workspace-rail');
    let btn = document.getElementById('pinkie-laser-entry');
    if (!rail) { btn?.remove(); return; }
    if (btn?.parentElement === rail) return;
    btn?.remove();
    btn = document.createElement('button');
    btn.id = 'pinkie-laser-entry';
    btn.type = 'button';
    btn.title = '激光笔：左键开启，右键调参数（ESC 退出）';
    btn.setAttribute('aria-label', '开启激光笔，右键打开设置');
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.innerHTML = ICON;
    const label = document.createElement('span');
    label.textContent = '激光笔';
    btn.append(label);
    btn.addEventListener('click', toggle);
    btn.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openSettings(btn);
    });
    // Park it right above the party space entry so the rail reads as a group.
    const party = rail.querySelector('#pinkie-party-entry');
    if (party) party.before(btn); else rail.append(btn);
  };
  // Poll instead of a subtree-wide MutationObserver: during streaming every
  // markdown chunk rebuilds the DOM, and each observer receives its own copy
  // of every mutation record (the GC "record avalanche" that froze the page).
  // mount() is idempotent, so a slow 1.5s poll is more than enough here.
  setInterval(mount, 1500);
  mount();
})();
