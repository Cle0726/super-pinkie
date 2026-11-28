/* laolao-metre-transition —— Metre 的进场和离场（11-24 第九版：用户打回第八版「像素环」，回到第 1 版「音符跳动」mui\proto-v3-1123\v3.js 上打磨；
 * 小猫不出现，用户 11-23）。♩=72，一拍 B=250ms 的细分。
 *   进场 play()：上下两半谱纸合上（0–380ms）→ 五线从左往右划出、像素 M 当谱号一列列亮起，亮满时轻轻落位回弹 → 指挥棒每拍落在一个音符上
 *     （450/700/950/1200ms），拍与拍之间往上弹；音符在拍点落到谱上：先高两格、再一格、落下压扁一下再弹回，刚落下的那个是钴蓝；音符上方的谱台灯
 *     跟着同一拍一盏盏亮 → 1250ms 起新页面好了就从中缝上下翻开（420ms），同时发 pinkie:metre-sweep。总长约 1.67 秒（和第 1 版一样）。
 *   离场 leave()（Metre → 碧琪，进场倒过来）：谱纸带着整页谱面从上下合上（0–280ms）→ 指挥棒画一个收拍的圈、一顿（360ms）→ 音符从最后一个起
 *     按拍跳起、飞离谱面，灯跟着一盏盏灭 → 五线连同中缝往中间收拢、M 暗下去 → 760ms 谱面收空 = covered。交接（11-24 第 5 轮）：碧琪转场在离场一开始
 *     就备贴图，到 handoff.hold（620ms，最后一个音符还在飞）才起，只留引子的最后 100ms（无限制不留），720ms 起它就揭开，和五线收拢叠 40ms；它盖住以后 release() 拿掉谱纸。
 * 一张全屏 canvas 按像素格画（短边 / 140，至少 4px），没有图片和 WebGL，只在过场期间有 rAF。减少动态效果、或画不了 canvas 时都返回 null，切换器照原来
 * 的方式原地换。对外：PinkieMetreTransition.play() → {overlay, ready, covered, waiting(), finish(), abort()}；leave() → {overlay, covered, handoff, release()}。 */
(() => {
  'use strict';
  if (window.PinkieMetreTransition) return;
  const root = document.documentElement;
  // 13×11 的像素 M（和 laolao-metre-brand.js 的 LOGO 同一张图；@ = 摆锤的位置，这里另画会摆的摆）
  const LOGO = ['...##...##...', '...##...##...', '...##...##...', '..#..#.@@.#..', '..#..#.@@.#..', '..#..#.#..#..',
    '..#...#...#..', '.#....#....#.', '.#....#....#.', '.#....#....#.', '#############'];
  const HEAD = ['.##.', '####', '.##.'], SQUASH = ['.####.', '######'];   // 音符头；落地那一下压扁成矮一格、宽两格
  const reduced = () => root.hasAttribute('data-pinkie-reduce-motion') || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const dark = () => root.getAttribute('data-theme') === 'dark' || root.hasAttribute('data-pinkie-night');
  const palette = () => dark()
    ? {bg: '#151514', line: '#6E6B63', on: '#ECEAE4', dim: '#34332F', accent: '#93A5EE', lamp: '#E9C77A', warm: '255,214,140'}
    : {bg: '#F7F6F3', line: '#9C988F', on: '#1B1A18', dim: '#DDDAD3', accent: '#2F4BB0', lamp: '#D89A2C', warm: '232,168,60'};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));   // 窗口在后台时 rAF 不走，切换会卡住；那时退回定时器
  const frame = () => document.hidden ? wait(32) : new Promise((resolve) => requestAnimationFrame(resolve));
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v)), lerp = (a, b, u) => a + (b - a) * u, easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), backOut = (t, s = 2) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
  // 时间线（毫秒）。进场 = 第 1 版原样；离场：合上、收拍、音符一个个离开（隔 HOP）、五线收拢、收空
  const COVER = 380, OPEN = 420, B = 250, FIRST = 450, HOLD = 1250;
  const CLOSE = 280, CUT = 360, HOP = 60, CLEAR = 540, GONE = 760, CUE = 620, INTRO = 100;

  // 一张谱纸：进场和离场共用同一套画法。paint() 读 st：t = 进场时间；ex ≥ 0 时是离场（谱面停在进场画完的样子往回收）
  function score(label) {
    if (reduced()) return null;
    const overlay = document.createElement('section');
    overlay.className = 'pk-metre-transition'; overlay.setAttribute('role', 'status'); overlay.setAttribute('aria-live', 'polite'); overlay.setAttribute('aria-label', label);
    const cv = document.createElement('canvas'), g = cv.getContext?.('2d');
    if (!g) return null; overlay.append(cv);
    Object.assign(overlay.style, {position: 'fixed', inset: '0', zIndex: '2147483000', pointerEvents: 'auto', background: 'transparent'});
    Object.assign(cv.style, {position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block'}); document.body.append(overlay);
    const W = window.innerWidth, H = window.innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const C = palette();
    const P = Math.max(4, Math.round(Math.min(W, H) / 140));      // 像素格（860 高时 6px）
    const sn = (v) => Math.round(v / P) * P;
    const GAP = 3 * P, TH = Math.max(1, Math.round(P / 2));       // 谱线间距、线粗
    const mid = sn(H / 2), lineY = [-2, -1, 0, 1, 2].map((k) => mid + k * GAP);   // 第三线 = 谱纸的中缝
    const sx0 = sn(W * 0.16), sx1 = sn(W * 0.84), cx = sn(W / 2);
    const LS = Math.max(2, Math.round((4 * GAP + 2 * P) / 11));  // 谱号 M 的一格
    const lx = sx0 + 2 * P, ly = Math.round(mid - (11 * LS) / 2), clefEnd = lx + 13 * LS + 3 * P;
    const barX = sn(clefEnd + (sx1 - clefEnd) * 0.7);
    const notesX = [0, 1, 2, 3].map((k) => sn(clefEnd + ((barX - clefEnd) * (k + 0.5)) / 4));
    const PITCH = [1, 3, 5, 7], noteY = PITCH.map((p) => sn(lineY[4] - (p * GAP) / 2));   // 一拍一个音，往上走
    const ictus = [0, 1, 2, 3].map((k) => FIRST + k * B), lampY = lineY[0] - 7 * GAP;                            // 谱台灯：每个音符正上方一盏，比棒子弹得最高处还高
    const trail = [], st = {t: 0, ex: -1, dyTop: -mid, dyBot: H - mid, open: 0};
    const box = (x, y, w, h, color) => { g.fillStyle = color; g.fillRect(x, y, w, h); };

    // 指挥棒。进场：预备从左上落下，每拍落在一个音符上（拍点），两拍之间往上弹；数完停在小节线右上方，轻轻点着。
    const pts = [{x: clefEnd - P, y: lineY[0] - 5 * GAP, t: COVER}, ...ictus.map((ti, k) => ({x: notesX[k], y: noteY[k] - 2 * P, t: ti})), {x: barX + 2 * P, y: lineY[0] - 4 * GAP, t: ictus[3] + B}];
    const rest = pts[pts.length - 1];
    function batonAt(t, ex) {
      if (ex >= 0) {   // 离场：收拍——从停的地方画一个圈，一顿，收掉
        if (ex < 120) return {x: rest.x, y: sn(rest.y + Math.sin((ex / B) * Math.PI) * P)};
        const u = easeInOut(clamp((ex - 120) / (CUT - 120))), a = Math.PI / 2 - u * Math.PI * 1.8, r = 2 * GAP * (1 - 0.35 * u);
        return {x: sn(rest.x + Math.cos(a) * r), y: sn(rest.y - 2 * GAP + Math.sin(a) * r + 2 * GAP * u * 0.5)};
      }
      if (t < pts[0].t) return null;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1]; if (t > b.t) continue;
        const u = (t - a.t) / (b.t - a.t), x = a.x + (b.x - a.x) * easeInOut(u);
        // 拍点前加速落下、拍点后弹起（落得干脆，弹得有弹性）
        const y = i === 0 ? a.y + (b.y - a.y) * u * u : a.y + (b.y - a.y) * u - Math.sin(Math.PI * Math.pow(u, 0.8)) * 3 * GAP;
        return {x: sn(x), y: sn(y)};
      }
      return {x: rest.x, y: sn(rest.y + Math.sin(((t - rest.t) / B) * Math.PI) * P)};
    }

    function content(t, ex) {
      const out = ex >= 0; if (out) t = 1e4;                     // 离场时谱面就是进场画完的样子
      const fade = 1 - clamp(st.open / 0.35);                    // 翻开时指挥棒先收
      const shut = out ? easeInOut(clamp((ex - CLEAR) / 200)) : 0, mAlpha = out ? 1 - clamp((ex - CLEAR - 60) / 140) : 1;
      // 五线：盖满以后从左往右一笔划出（每根晚 24ms）；离场时两头往中间收拢
      let drawn = 0; g.globalAlpha = mAlpha;
      lineY.forEach((y, k) => {
        const p = easeOut(clamp((t - COVER - k * 24) / 260)); if (k === 4) drawn = p;
        const a = sn(lerp(sx0, cx, shut)), b = sn(lerp(sx0 + (sx1 - sx0) * p, cx, shut));
        if (b > a) box(a, y - Math.floor(TH / 2), b - a, TH, C.line);
      });
      const a0 = sn(lerp(sx0, cx, shut)), a1 = sn(lerp(sx1, cx, shut));
      if (drawn > 0 && shut < 1) box(a0, lineY[0] - Math.floor(TH / 2), TH, 4 * GAP + TH, C.line);                          // 起始线
      if (drawn * (sx1 - sx0) > barX - sx0 && barX > a0 && barX < a1) box(barX, lineY[0] - Math.floor(TH / 2), TH, 4 * GAP + TH, C.line); // 小节线
      if (drawn >= 1 && shut < 1) { box(a1 - 3 * P, lineY[0], TH, 4 * GAP, C.line); box(a1 - P, lineY[0], P, 4 * GAP + TH, C.line); }   // 终止线
      g.globalAlpha = 1;   // 谱台灯：音符落拍那一下亮（先冲亮再稳住），在音符上投一锥很淡的暖光；离场时跟着自己的音符灭
      notesX.forEach((x, k) => {
        if (t < COVER + 120) return;
        const leaveAt = CUT + (3 - k) * HOP, on = out ? ex < leaveAt : t >= ictus[k], k2 = on ? (!out && t - ictus[k] < 90 ? 1.6 : 1) : 0;
        g.globalAlpha = clamp((t - COVER - 120) / 160) * mAlpha;
        box(x - TH / 2, lampY - 3 * P, TH, 3 * P, C.dim);
        if (on) { const gr = g.createLinearGradient(0, lampY, 0, noteY[k]); gr.addColorStop(0, `rgba(${C.warm},${0.2 * k2})`); gr.addColorStop(1, `rgba(${C.warm},0)`);
          g.fillStyle = gr; g.beginPath(); g.moveTo(x - 2 * P, lampY + 2 * P); g.lineTo(x + 2 * P, lampY + 2 * P); g.lineTo(x + 6 * P, noteY[k]); g.lineTo(x - 6 * P, noteY[k]); g.closePath(); g.fill(); }
        box(x - 2 * P, lampY, 4 * P, 2 * P, on ? C.lamp : C.dim); if (k2 > 1) box(x - 3 * P, lampY + 2 * P, 6 * P, P, C.lamp);
        g.globalAlpha = 1;
      });
      // 谱号 = 像素 M：一列一列亮，亮满时往下落半格再回弹；中间的 V 常暗。离场时从右往左暗下去、淡掉
      const lit = out ? 13 - Math.ceil(clamp((ex - CLEAR) / 180) * 13) : clamp(Math.ceil(((t - 260) / 240) * 13), 0, 13);
      const mDy = out ? 0 : t < 500 ? -P : Math.round(-1.5 * P * (1 - backOut(clamp((t - 500) / 220))));
      g.globalAlpha = mAlpha;
      if (t > 260) for (let gy = 0; gy < 11; gy++) for (let gx = 0; gx < 13; gx++) {
        const c = LOGO[gy][gx]; if (c === '.' || c === '@') continue;
        const inner = gx >= 5 && gx <= 7 && gy >= 3 && gy <= 9;
        box(lx + gx * LS, ly + gy * LS + mDy, LS, LS, !inner && gx < lit ? C.on : C.dim);
      }
      if (lit >= 13) {   // 摆：每个拍点摆到一头；离场时停在正中
        const a = out || t < FIRST ? 0 : 0.36 * Math.cos((Math.PI * (t - FIRST)) / B);
        const px = lx + 6.5 * LS, py = ly + 10 * LS + mDy, L = 8 * LS, q = Math.max(2, Math.round(LS * 0.5));
        for (let i = 0; i <= 16; i++) { const f = i / 16; box(Math.round((px + Math.sin(a) * L * f) / q) * q - q / 2, Math.round((py - Math.cos(a) * L * f) / q) * q - q / 2, q, q, C.on); }
        box(Math.round(px + Math.sin(a) * L - LS), Math.round(py - Math.cos(a) * L - LS), 2 * LS, 2 * LS, C.accent);
      }
      g.font = `600 ${Math.max(10, Math.round(P * 2.4))}px ui-monospace, "Cascadia Mono", Consolas, monospace`; g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillStyle = t > 700 && lit > 6 ? C.on : C.dim; g.fillText('METRE', lx + (13 * LS) / 2, lineY[4] + 4 * P);
      g.globalAlpha = 1;
      // 音符：拍点那一刻落到谱上（先高两格、再一格、落下压扁一下、再弹回）；刚落下的那个是钴蓝，两边溅起两粒小点。
      // 离场：从最后一个起按拍蹲一下、跳起一格两格、飞出谱面淡掉，跳起来的那个是钴蓝
      ictus.forEach((ti, k) => {
        if (t < ti) return;
        const d = t - ti, u = out ? ex - (CUT + (3 - k) * HOP) : -1;
        let dy = d < 45 ? -2 * P : d < 85 ? -P : 0, head = d >= 85 && d < 135 ? SQUASH : HEAD, color = d < B ? C.accent : C.on, alpha = 1;
        if (u >= 0) {
          head = u < 40 ? SQUASH : HEAD; color = C.accent;
          dy = u < 40 ? 0 : u < 70 ? -P : u < 100 ? -2 * P : -sn((2 + 0.004 * (u - 100) * (u - 100)) * P);
          alpha = 1 - clamp((u - 100) / 110);
        }
        if (alpha <= 0) return; g.globalAlpha = alpha;
        const hx = notesX[k] - 2 * P, hy = sn(noteY[k] - 1.5 * P) + dy, sq = head === SQUASH;
        head.forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch === '#') box(hx + (rx - (sq ? 1 : 0)) * P, hy + (ry + (sq ? 1 : 0)) * P, P, P, color); }));
        if (PITCH[k] < 4) box(hx + 4 * P - TH, hy - 6 * P + (sq ? P : 0), TH, 7 * P - (sq ? P : 0), color);
        else box(hx, hy + P, TH, 7 * P - (sq ? P : 0), color);
        if (!out && d < 90) { g.globalAlpha = 1 - d / 90; const o = Math.floor(d / 45) * P; box(hx - 2 * P - o, hy + 2 * P - o, P, P, C.accent); box(hx + 5 * P + o, hy + 2 * P - o, P, P, C.accent); }
        g.globalAlpha = 1;
      });
      // 指挥棒的轨迹（最近 260ms）和棒尖；离场收拍那一顿棒尖放大一格，然后淡掉
      const bf = out ? 1 - clamp((ex - CUT - 60) / 100) : fade;
      if (bf > 0) {
        const now = out ? ex : t;
        for (const p of trail) { g.globalAlpha = bf * clamp(1 - (now - p.t) / 260) * 0.8; box(p.x, p.y, P, P, C.accent); }
        const tip = trail[trail.length - 1], big = out && ex >= CUT && ex < CUT + 60 ? P : 0;
        if (tip) { g.globalAlpha = bf; box(tip.x - P / 2 - big / 2, tip.y - P / 2 - big / 2, 2 * P + big, 2 * P + big, C.accent); }
        g.globalAlpha = 1;
      }
    }
    function paint() {
      const out = st.ex >= 0, now = out ? st.ex : st.t, tip = out && st.ex > CUT ? null : batonAt(st.t, st.ex);
      if (tip) { const last = trail[trail.length - 1]; if (!last || last.x !== tip.x || last.y !== tip.y) trail.push({...tip, t: now}); }
      while (trail.length && now - trail[0].t > 260) trail.shift();
      g.clearRect(0, 0, W, H);
      for (const [dy, y0, h] of [[st.dyTop, 0, mid], [st.dyBot, mid, H - mid]]) {
        g.save(); g.translate(0, sn(dy)); g.beginPath(); g.rect(0, y0, W, h); g.clip();
        box(0, y0, W, h, C.bg);
        { const k = st.ex >= 0 ? easeInOut(clamp((st.ex - CLEAR) / 200)) : 0, a = sn(cx * k); if (k < 1) box(a, y0 === 0 ? mid - 1 : mid, W - 2 * a, 1, C.dim); }   // 谱纸的折缝：离场时和五线一起往中间收掉
        content(st.t, st.ex); g.restore();
      }
    }
    return {overlay, st, paint, mid, H};
  }

  function play() {
    const s = score('正在切换到 Metre'); if (!s) return null; const {overlay, st, paint, mid, H} = s;
    let alive = true, leaving = false, t0 = 0; const ready = frame();
    // 合上：按时间推进，慢机器上跳几帧也准时盖满
    const covered = (async () => {
      await ready; t0 = performance.now();
      while (alive && st.t < COVER) {
        st.t = performance.now() - t0; const e = easeInOut(clamp(st.t / COVER)); st.dyTop = -mid * (1 - e); st.dyBot = (H - mid) * (1 - e);
        paint(); await frame();
      }
      if (!alive) throw new Error('aborted');
      st.dyTop = 0; st.dyBot = 0;
    })();
    // 五线、谱号、四拍：和合上接着走；数完之前不翻开，之后新页面好了就翻开，没好就停在谱面上等
    const counted = (async () => {
      try { await covered; } catch { return; }
      while (alive) { st.t = performance.now() - t0; if (leaving && st.t >= HOLD) return; paint(); await frame(); }
    })();
    async function finish() {
      leaving = true; await counted;
      if (!alive) return;
      window.dispatchEvent(new CustomEvent('pinkie:metre-sweep', {detail: {ms: OPEN}}));   // 翻开：页面里的进场跟着这一拍起（laolao-metre-home.js）
      const o0 = performance.now(); let d;
      while (alive && (d = performance.now() - o0) < OPEN) {
        const e = easeInOut(d / OPEN); st.open = d / OPEN; st.t = performance.now() - t0; st.dyTop = -mid * e; st.dyBot = (H - mid) * e;
        paint(); await frame();
      }
      alive = false; overlay.remove();
    }
    function abort() { alive = false; overlay.remove(); }
    return {overlay, ready, covered, waiting() {}, finish, abort};
  }

  // 离场：画到收空为止（covered），谱纸留着垫在碧琪转场下面，release() 才拿掉；万一没人来拿，15 秒后自己拿掉。handoff 交给碧琪转场：hold 那一拍起、只留 INTRO 的引子
  function leave(to) {
    const s = score('正在离开 Metre'); if (!s) return null; const {overlay, st, paint, mid, H} = s;
    let alive = true, cued; st.ex = 0; const release = () => { alive = false; overlay.remove(); }, cue = new Promise((resolve) => { cued = resolve; });
    const covered = (async () => {
      await frame(); const t0 = performance.now();
      while (alive && st.ex < GONE) {
        st.ex = performance.now() - t0; if (st.ex >= CUE) cued(); const e = easeInOut(clamp(st.ex / CLOSE)); st.dyTop = -mid * (1 - e); st.dyBot = (H - mid) * (1 - e);
        paint(); await frame();
      }
      cued(); if (!alive) throw new Error('aborted');
      st.ex = GONE; st.dyTop = 0; st.dyBot = 0; paint(); setTimeout(release, 15000);
    })();
    covered.catch(() => {});
    return {overlay, covered, release, handoff: {hold: cue, intro: to === 'unrestricted' ? 0 : INTRO}};   // 无限制的彩虹斜切从角上细细地起，直接在交接那一拍起
  }

  window.PinkieMetreTransition = Object.freeze({play, leave});
})();
