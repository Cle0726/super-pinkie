/* laolao-metre-backdrop —— Metre 首页 / 对话页底部的像素画带（11-15 第十一稿「谱台灯」）。
 *
 * 用户 11-15 晚看了装进 App 的「月夜」：「像素视觉元素没有 Metre 自己的感觉，像素密度也低，质量太差，整体也没有大厂的氛围和呼吸感」。
 * 月亮、山、电线杆、音符、草、星星、萤火虫和整屏的 LED 缝全部拿掉（它们是照参考视频抄的题材）。
 *
 * 现在画的是 Metre 自己的事：一个指挥，一排排等着开工的声部。
 *   夜里的排练厅，从乐手的座位看出去：近处几排谱台，每个谱台上夹着一盏小灯；中间偏右是指挥台，
 *   上面一个背对我们的谱台（指挥的位置空着——猫在输入框上，不在画里重复）；最远处是舞台口，里面立着像素 M 节拍器的剪影。
 *   谱台灯 = 子会话（和总控台同一份数据，laolao-metre-board-data.js）：
 *     没有子会话时只有指挥台那一盏亮着；每派出一个亮一盏——在跑 = 钴蓝，做完 = 暖白（暗一档），出错 = 砖红，排队 = 不亮。
 *   会动的只有两样：指挥台的灯和节拍器的摆锤，按 ♩=72 跳格。减少动态效果时静止。
 * 版面：画只占页面底部一条（首页约 28% 高，对话页约 16% 高、对比度降一半），上面是空的——
 *   只有一层很细的抖动渐变（大厅的暗），不放任何东西。提示语、对话正文都在那片空里。
 * 画法：一格 2 个 CSS 像素（按设备像素取整，格子边永远落在整像素上），整张图先画进一块低分辨率的 Uint32 缓冲，
 *   最近邻放大贴到画布上；不压缝。
 *   谱台三种大小（谱板 33 / 23 / 15 格宽），谱面上有谱线、音符、小节线，每个谱台不一样；立杆左亮右暗、带箍和三脚；
 *   地板是朝舞台口收拢的木条；舞台口有框、束腰的侧幕、檐幕、台唇和脚灯；渐变和光晕用 4×4 Bayer 抖动。
 * 浅色主题不是把深色反相：是谱纸上的墨线版——暖白底、墨色剪影、灯是钴蓝的点。
 * 资源（批 6「不留常驻动画」）：只在 Metre 的对话页 / 首页、窗口可见时跑；一个 setTimeout 每半拍走一步，只重画会动的两小块；
 *   标志页开着时停；减少动态效果时只画一帧。不在 Metre 时画布直接拿掉，根元素上的 data-pk-metre-backdrop 也拿掉。 */
(() => {
  'use strict';
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (G.__pinkieMetreBackdrop) return;
  const BPM = 72;
  const STEP = 60_000 / BPM / 2;          // 半拍走一步
  const CELL = 2;                         // 一格 2 个 CSS 像素

  // ---------- 小工具 ----------
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const pack = (c) => ((255 << 24) | (Math.round(c[2]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[0])) >>> 0;   // ImageData 是小端 ABGR

  // ---------- 颜色 ----------
  // 每种材质 4–6 级。深色：夜里的排练厅，暖光来自指挥台的灯，冷光来自舞台口。浅色：谱纸上的墨线版（不是反相）。
  const PALETTES = {
    dark: {
      bg: '#151514', hall1: '#17171A', hall2: '#191A1F', hall3: '#1C1D25', wall: '#22232D', rail: '#2A2C38',
      f0: '#131316', f1: '#101012', f2: '#0C0C0E', seam: '#070708', edge: '#2E303B', edgeLo: '#050506',
      arch: '#2B2C38', archHi: '#474A62', archLo: '#191A21',
      st0: '#1B1D2A', st1: '#252940', st2: '#333A5C', st3: '#4A548A',
      cu0: '#0D0E18', cu1: '#161A2C', cu2: '#212642', cu3: '#30386A', fringe: '#7A7458',
      lip: '#30323F', lipHi: '#5E6384', footCore: '#EEF1FF', hood: '#09090C',
      sil: '#060608', silRim: '#6A72A6', silFace: '#15172A',
      frame: '#141419', frameHi: '#4E5060', frameLo: '#09090C', pole: '#22222A', poleHi: '#5C5E72', poleLo: '#0C0C10', lampHood: '#26272F',
      cat: '#060607', cat2: '#101015', cat3: '#1C1C25', warmHi: '#D8C99A', warmMid: '#7A6E50', warmLo: '#352F23',
      coolRim: '#4C557E', coolDim: '#262A3E', eye: '#7F97F5', eyeHi: '#EAF0FF', eyeLo: '#3F58C4', pupil: '#0A0E24', nose: '#34313A',
      whiskIn: '#4A473C', whiskOut: '#55524A',
      podTop: '#4A4030', podTopLo: '#221E17', podFace: '#15120F', podFaceHi: '#2B251C', podFaceLo: '#090807', podTrim: '#5E5239',
      off: {hi: '#2B2B32', mid: '#25252B', lo: '#1F1F24', line: '#35353E', ink: '#40404B', core: null, glow: null},
      run: {hi: '#DCE3FF', mid: '#AEBAF4', lo: '#7785D0', line: '#6373BE', ink: '#232C66', core: '#F4F6FF', glow: '#93A5EE'},
      done: {hi: '#BBB39D', mid: '#938D7E', lo: '#6C675A', line: '#5E5A50', ink: '#2C2923', core: '#E8DEC2', glow: '#8C8470'},
      fail: {hi: '#C96A53', mid: '#9E4E3B', lo: '#703628', line: '#5A2A1F', ink: '#280F0A', core: '#F28E72', glow: '#B4513B'},
      lead: {core: '#FFF6DC', glow: '#D9CDA8'},
    },
    light: {
      bg: '#F7F6F3', hall1: '#F5F3EF', hall2: '#F2F0EA', hall3: '#EEEBE4', wall: '#E2DDD2', rail: '#D2CCBF',
      f0: '#EEEBE3', f1: '#E9E5DC', f2: '#E3DFD5', seam: '#CDC7BA', edge: '#9C9587', edgeLo: '#D6D1C5',
      arch: '#8A8478', archHi: '#5A554C', archLo: '#B9B2A3',
      st0: '#E0DBCF', st1: '#E9E5DB', st2: '#F1EEE6', st3: '#FCFBF8',
      cu0: '#4A463F', cu1: '#6B665C', cu2: '#8F887B', cu3: '#B4AD9F', fringe: '#2B2925',
      lip: '#A39C8D', lipHi: '#4A463F', footCore: '#2F4BB0', hood: '#3A3732',
      sil: '#2B2925', silRim: '#77736B', silFace: '#45413B',
      frame: '#4A463F', frameHi: '#77736B', frameLo: '#2B2925', pole: '#5A554C', poleHi: '#9C9587', poleLo: '#3A3732', lampHood: '#3A3732',
      cat: '#1B1A18', cat2: '#252320', cat3: '#33302C', warmHi: '#C9C2B2', warmMid: '#77736B', warmLo: '#4A463F',
      coolRim: '#6B665C', coolDim: '#45413B', eye: '#6C86EA', eyeHi: '#EAF0FF', eyeLo: '#2F4BB0', pupil: '#101633', nose: '#5A554C',
      whiskIn: '#6B665C', whiskOut: '#5A554C',
      podTop: '#D6D0C1', podTopLo: '#C4BDAD', podFace: '#E2DDD2', podFaceHi: '#EDEAE2', podFaceLo: '#BDB6A7', podTrim: '#5A554C',
      off: {hi: '#FCFBF8', mid: '#F5F3EE', lo: '#EDEAE2', line: '#D6D1C5', ink: '#B9B2A3', core: null, glow: null},
      run: {hi: '#F4F6FF', mid: '#DEE5FB', lo: '#C6D0F3', line: '#91A1E0', ink: '#2F4BB0', core: '#2F4BB0', glow: '#2F4BB0'},
      done: {hi: '#F7F3EA', mid: '#ECE6D9', lo: '#E0D9C9', line: '#B9B2A3', ink: '#6B665C', core: '#8A8478', glow: '#B9B2A3'},
      fail: {hi: '#FAE8E2', mid: '#F1D1C7', lo: '#E6B8AB', line: '#CB8876', ink: '#8E3524', core: '#A8432F', glow: '#A8432F'},
      lead: {core: '#2F4BB0', glow: '#2F4BB0'},
    },
  };
  for (const p of Object.values(PALETTES)) p.wait = p.off;
  PALETTES.dark.tap = {hi: '#FFF8E4', mid: '#EADFBE', lo: '#C9BD98', line: '#A89C78', ink: '#3A3323', core: '#FFF6DC', glow: '#D9CDA8'};
  PALETTES.light.tap = {hi: '#F4F6FF', mid: '#E6EBFB', lo: '#D3DBF5', line: '#91A1E0', ink: '#2F4BB0', core: '#2F4BB0', glow: '#2F4BB0'};
  const resolve = (pal) => {
    const out = {};
    for (const [k, v] of Object.entries(pal)) out[k] = typeof v === 'string' ? rgb(v) : Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, vv ? rgb(vv) : null]));
    return out;
  };
  const hash = (n) => { n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return n >>> 0; };
  // 在几档颜色之间按 t（0..1）取色，相邻两档之间抖动
  const ramp = (levels, t, x, y) => {
    const n = levels.length - 1, v = Math.max(0, Math.min(1, t)) * n, lo = Math.floor(v);
    return levels[Math.min(n, lo + (v - lo > bayer(x, y) ? 1 : 0))];
  };

  // ---------- 精灵 ----------
  // 像素 M 节拍器（和 laolao-metre-brand.js 的标志同一张图；摆锤单独画，会动）
  const LOGO = [
    '...##...##...',
    '...##...##...',
    '...##...##...',
    '..#..#....#..',
    '..#..#....#..',
    '..#..#.#..#..',
    '..#...#...#..',
    '.#....#....#.',
    '.#....#....#.',
    '.#....#....#.',
    '#############',
  ];
  const SPRITES = {LOGO};

  // 谱台的三种大小（0 近 / 1 中 / 2 远）：w 谱板宽、dh 谱板高、n 一行谱几条线、gap 行距
  const STAND_SIZES = [
    {w: 33, dh: 23, lampW: 9, lampH: 3, pole: 3, poleH: 40, legH: 0, n: 3, gap: 2},
    {w: 23, dh: 16, lampW: 7, lampH: 3, pole: 3, poleH: 13, legH: 4, n: 2, gap: 2},
    {w: 15, dh: 10, lampW: 5, lampH: 2, pole: 1, poleH: 9, legH: 3, n: 1, gap: 1},
  ];
  const LEAD = {w: 27, dh: 15, lampW: 9, poleH: 11, legH: 4};          // 指挥台上的谱台（背面）
  LEAD.h = 3 + LEAD.dh + 1 + LEAD.poleH + LEAD.legH;

  // ---------- 场景 ----------
  // 把 sessions（总控台那份）变成灯的状态表
  function lampStates(sessions) {
    const out = [];
    for (const s of Array.isArray(sessions) ? sessions : []) {
      const st = String(s?.status || s?.state || s || '').toLowerCase();
      out.push(/run|active|working/.test(st) ? 'run' : /queue|pending|wait/.test(st) ? 'wait' : /fail|error|block|timeout|abort/.test(st) ? 'fail' : 'done');
    }
    return out;
  }

  /* 画静的那一层。返回 {buf, anchors…}。
   * cols×rows 是整块画布的格数；band 是场景占的行数（贴底），band 上面的行只有大厅的暗（抖动渐变，越往上越接近底色，最上面是透明）。
   * quiet = [x0, x1]：输入框那一栏的格范围（对话页用它把指挥台和舞台口让到两边的空地上）；首页传 null。 */
  function buildScene({cols, rows, band, dark, home, lamps = [], quiet = null, dim = 0, flash = -1}) {
    const C = resolve(dark ? PALETTES.dark : PALETTES.light);
    const buf = new Uint32Array(cols * rows);            // 0 = 透明（露出页面底色）
    const solid = new Uint8Array(cols * rows);           // 实心的东西占了哪些格（光晕不往上盖）
    const y0 = rows - band;                              // 场景顶
    const floorY = y0 + Math.round(band * 0.4);          // 地平线：上面是后墙和舞台口，下面是地板
    const floorH = rows - floorY;
    const fade = (c) => (dim ? mix(c, C.bg, dim) : c);
    const inb = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
    const set = (x, y, c) => { if (inb(x, y)) buf[y * cols + x] = pack(fade(c)); };
    const hard = (x, y, c) => { if (inb(x, y)) { buf[y * cols + x] = pack(fade(c)); solid[y * cols + x] = 1; } };
    const blend = (x, y, c, a) => {                      // 往已有的颜色上叠一层
      if (!inb(x, y)) return;
      const v = buf[y * cols + x], under = v ? [v & 255, (v >> 8) & 255, (v >> 16) & 255] : C.bg;
      buf[y * cols + x] = pack(mix(under, fade(c), a));
    };

    // 1. 大厅的暗：从画布顶到地平线，底色 → hall1 → hall2 → hall3
    const hall = [null, C.hall1, C.hall2, C.hall3];
    for (let y = 0; y < floorY; y++) {
      const t = Math.pow(y / Math.max(1, floorY), 1.6) * 3, lo = Math.min(3, Math.floor(t)), frac = t - lo;
      for (let x = 0; x < cols; x++) { const lvl = Math.min(3, lo + (frac > bayer(x, y) ? 1 : 0)); if (hall[lvl]) set(x, y, hall[lvl]); }
    }

    // 位置：首页舞台口在正中、指挥台中间偏右；对话页两样各让到输入框两边的空地
    let stageX = Math.round(cols * 0.5), podX = Math.round(cols * 0.68);
    if (!home && quiet) {
      const left = quiet[0], right = cols - quiet[1];
      if (right >= 104) podX = quiet[1] + Math.round(right / 2);
      if (left >= 80) stageX = Math.round(left / 2);
      else if (right >= 190) { stageX = quiet[1] + Math.round(right * 0.25); podX = quiet[1] + Math.round(right * 0.7); }
    }

    // 2. 后墙：护墙板的竖线（从上往下抖动着显出来）、腰线、踢脚
    for (let x = 0; x < cols; x++) {
      set(x, floorY - 8, C.wall);
      set(x, floorY - 2, C.wall); set(x, floorY - 1, C.rail);
    }

    // 3. 舞台口：一圈框 + 两边束起来的幕布 + 顶上的檐幕 + 里面的光 + 台唇和脚灯 + 像素 M
    const fr = home ? 3 : 2, lipH = home ? 4 : 3;
    const archW = Math.max(40, Math.min(232, Math.round(cols * 0.4), 2 * Math.min(stageX, cols - stageX) - 8, home || !quiet ? 999 : stageX < quiet[0] ? 2 * (quiet[0] - stageX) - 4 : 999)), archH = Math.max(34, Math.round(band * (home ? 0.5 : 0.58))), archR = Math.min(14, archH >> 1);
    const ax0 = stageX - (archW >> 1), ax1 = ax0 + archW - 1, ay0 = floorY - archH;
    const inArch = (x, y, k = 0) => {
      const a = ax0 + k, b = ax1 - k, top = ay0 + k, r = Math.max(1, archR - k);
      if (x < a || x > b || y < top || y >= floorY) return false;
      if (y >= top + r) return true;
      const cx = x < a + r ? a + r : x > b - r ? b - r : x;
      return Math.hypot(x - cx, y - (top + r)) <= r + 0.2;
    };
    const iw = archW - 2 * fr, ih = archH - fr, ix0 = ax0 + fr, iy0 = ay0 + fr;
    const cw = Math.round(iw * 0.16), vh = Math.round(ih * 0.22), tie = 0.64;
    const curtainW = (t) => (t < tie ? cw - cw * 0.42 * (t / tie) ** 2 : cw * 0.58 + cw * 0.3 * ((t - tie) / (1 - tie)));
    const swN = Math.max(3, Math.round(iw / 30)), sw = iw / swN;
    const CU = [C.cu0, C.cu1, C.cu2, C.cu3], ST = [C.st0, C.st1, C.st2, C.st3];
    for (let y = ay0; y < floorY; y++) for (let x = ax0; x <= ax1; x++) {
      if (!inArch(x, y)) continue;
      if (!inArch(x, y, fr)) { hard(x, y, !inArch(x, y, 1) ? C.archLo : inArch(x, y, fr - 1) ? C.archHi : C.arch); continue; }
      const lx = x - ix0, ly = y - iy0, t = ly / ih, side = Math.min(lx, iw - 1 - lx);
      if (ly >= ih - lipH) { set(x, y, ly === ih - lipH ? C.lipHi : (lx % 6 === 3 && ly > ih - lipH + 1) ? C.archLo : C.lip); continue; }
      // 檐幕：一串垂下来的弧
      const fx = (lx % sw) / sw, vEdge = vh * (0.55 + 0.45 * (1 - (2 * fx - 1) ** 2));
      if (ly < vEdge) {
        if (ly >= Math.floor(vEdge) - 0 && ly + 1 >= vEdge) { set(x, y, lx & 1 ? C.fringe : C.cu0); continue; }
        const v = (ly / vEdge) * 2.6 + (2 * fx - 1) ** 2 * 1.4, f = v - Math.floor(v);
        set(x, y, ramp(CU, (1 - Math.abs(2 * f - 1)) * 0.82, x, y)); continue;
      }
      // 侧幕：束腰以上直垂，束腰处收窄，往下再散开；一道道褶子
      const cwt = curtainW(t);
      if (side < cwt) {
        if (Math.abs(ly - Math.round(ih * tie)) < 1) { set(x, y, C.fringe); continue; }
        if (side >= cwt - 1) { set(x, y, C.cu3); continue; }
        const f = (side / cwt) * 5, ff = f - Math.floor(f);
        set(x, y, ramp(CU, (1 - Math.abs(2 * ff - 1)) * 0.86, x, y)); continue;
      }
      // 台里面的光：台口中间最亮，往外四档退到暗；顶上打下来一束
      const d = Math.hypot((x - stageX) / (iw * 0.5), (y - (floorY - lipH)) / (ih * 0.95));
      const cone = Math.abs(x - stageX) < 5 + ly * 0.2 ? 0.16 : 0;
      set(x, y, ramp(ST, (1 - d) * 1.25 + cone, x, y));
    }
    // 脚灯：台唇上一排小灯罩，光往台里打
    for (let k = 0; ; k++) {
      const off = 9 + k * 18; if (off > iw / 2 - cw - 6) break;
      for (const fxp of [stageX - off, stageX + off]) {
        const fy = floorY - lipH - 1;
        for (let dx = -1; dx <= 1; dx++) set(fxp + dx, fy, C.hood);
        set(fxp, fy - 1, C.footCore);
        for (let dy = 2; dy <= 5; dy++) for (let dx = -dy; dx <= dy; dx++) if ((1 - dy / 6) * 0.8 > bayer(fxp + dx, fy - dy)) blend(fxp + dx, fy - dy, C.st3, 0.5);
      }
    }
    const logoS = ih - vh - lipH >= 38 ? 3 : ih - vh - lipH >= 24 ? 2 : 1;       // 标志按舞台口的高矮放大（一个标志格 = logoS×logoS 画格）
    const logo = {x: stageX - Math.floor(13 * logoS / 2), y: floorY - lipH - 11 * logoS, s: logoS};
    LOGO.forEach((row, ry) => [...row].forEach((ch, rx) => {
      if (ch !== '#') return;
      const topEdge = ry === 0 || LOGO[ry - 1][rx] !== '#', leftEdge = rx === 0 || row[rx - 1] !== '#';
      for (let dy = 0; dy < logoS; dy++) for (let dx = 0; dx < logoS; dx++)
        hard(logo.x + rx * logoS + dx, logo.y + ry * logoS + dy, topEdge && dy === 0 ? C.silRim : leftEdge && dx === 0 ? C.silFace : C.sil);
    }));
    for (let x = logo.x - 2; x < logo.x + 13 * logoS + 2; x++) if (bayer(x, 1) < 0.5) blend(x, floorY - lipH, C.sil, 0.6);   // M 落在台唇上的影子

    // 4. 地板：木条朝舞台口收拢（透视），远处的缝抖动着淡掉；两道台阶沿
    const vpx = stageX, vpy = floorY - Math.round(floorH * 0.16), pk = (rows - vpy) / 26;
    const plank = (x, y) => Math.floor(((x - vpx) / (y - vpy)) * pk);
    const FL = [C.f0, C.f1, C.f2];
    for (let y = floorY; y < rows; y++) {
      const d = (y - floorY) / floorH;
      for (let x = 0; x < cols; x++) {
        const i = plank(x, y), h = hash(i + 4096);
        let c = ramp(FL, d + (h & 1 ? 0.12 : -0.08), x, y);
        if (plank(x - 1, y) !== i && d * 2.8 > bayer(x, y)) c = C.seam;
        else if (d > 0.12 && (y === floorY + 4 + (h >>> 3) % floorH || y === floorY + 4 + (h >>> 11) % floorH)) c = C.seam;   // 木条的接头
        set(x, y, c);
      }
    }
    // 舞台口的光落在地上一片（越近越疏）
    const spill = Math.round(floorH * 0.3);
    for (let dy = 0; dy < spill; dy++) {
      const y = floorY + dy, half = Math.round(iw * 0.4 + dy * 1.8), k = 1 - dy / spill;
      for (let x = stageX - half; x <= stageX + half; x++) if (k * 0.7 * (1 - Math.abs(x - stageX) / (half + 1)) > bayer(x, y)) blend(x, y, C.st2, dark ? 0.5 : 0.6);
    }
    const risers = [floorY, floorY + Math.round(floorH * 0.22), floorY + Math.round(floorH * 0.5)];
    for (const y of risers.slice(1)) for (let x = 0; x < cols; x++) { set(x, y, C.edge); set(x, y + 1, C.edgeLo); if (bayer(x, y) < 0.5) blend(x, y + 2, C.edgeLo, 0.6); }

    // 画一个谱台。depth 0 近 / 1 中 / 2 远：越远越往底色里退（大气透视）；seed 决定谱面上的音符（每个谱台不一样）
    const drawStand = (cx, baseY, depth, state, seed) => {
      const z = STAND_SIZES[depth], st = C[state] || C.off, lit = Boolean(st.glow);
      const H = z.lampH + z.dh + 2 + z.poleH + z.legH, yTop = baseY - H + 1, deskTop = yTop + z.lampH, x0 = cx - (z.w >> 1);
      const far = [0, 0.16, 0.34][depth];
      const tone = (c) => (far ? mix(c, dark ? C.hall3 : C.f0, far) : c);
      const P = (x, y, c) => hard(x, y, tone(c));
      // 灯下的光晕（浅色主题只是一圈很疏的点）
      if (lit) {
        const by = deskTop - 1, r = Math.round(z.w * (dark ? 0.82 : 0.5));
        for (let y = by - r; y <= by + r; y++) for (let x = cx - r; x <= cx + r; x++) {
          if (!inb(x, y) || solid[y * cols + x]) continue;
          const g = 1 - Math.hypot(x - cx, (y - by) * 1.15) / r;
          if (g > 0 && g * g * (dark ? 0.9 : 0.34) > bayer(x, y)) blend(x, y, tone(st.glow), dark ? 0.18 + g * 0.3 : 0.5);
        }
        // 灯落在地上的光斑
        if (z.legH) { const rx = Math.round(z.w * 0.8), ry = depth === 1 ? 3 : 2;
          for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) { const g = 1 - Math.hypot(dx / rx, dy / ry); if (g > 0 && g * 0.9 > bayer(cx + dx, baseY + dy)) blend(cx + dx, baseY + dy, tone(st.glow), dark ? 0.2 : 0.3); } }
      }
      // 夹在谱板上沿的小灯：灯罩两行 + 灯口一行
      const lw = z.lampW >> 1;
      if (z.lampH === 3) for (let dx = -lw + 1; dx <= lw - 1; dx++) P(cx + dx, yTop, dx === -lw + 1 ? C.poleHi : C.lampHood);
      for (let dx = -lw; dx <= lw; dx++) P(cx + dx, deskTop - 2, lit ? mix(C.lampHood, st.glow, dx === -lw ? 0.6 : 0.3) : dx === -lw ? C.frameHi : C.lampHood);
      for (let dx = -lw + 1; dx <= lw - 1; dx++) P(cx + dx, deskTop - 1, st.core || C.frameLo);
      // 谱板：框（上、左受光，下、右背光）+ 两页谱纸，中间一道折缝
      const pw = (z.w - 3) >> 1, unit = 2 * z.n - 1 + z.gap;
      for (let ry = 0; ry < z.dh; ry++) for (let rx = 0; rx < z.w; rx++) {
        const x = x0 + rx, y = deskTop + ry;
        if (ry === 0) { P(x, y, lit ? mix(C.frameHi, st.glow, 0.55) : C.frameHi); continue; }
        if (ry === z.dh - 1) { P(x, y, C.frameLo); continue; }
        if (rx === 0) { P(x, y, C.frameHi); continue; }
        if (rx === z.w - 1) { P(x, y, C.frame); continue; }
        if (x === cx) { P(x, y, mix(st.lo, st.ink, 0.35)); continue; }
        let c = ramp([st.hi, st.mid, st.lo], Math.hypot(x - cx, (y - deskTop) * 1.3) / (z.w * 0.62), x, y);
        const page = x < cx ? 0 : 1, pc = page ? x - cx - 1 : rx - 1, iy = ry - 1;      // pc：这一页里的第几列
        if (page ? pc === 0 : pc === pw - 1) c = mix(c, st.lo, 0.6);                    // 折缝两边暗一线
        const sIdx = Math.floor((iy - 1) / unit), r = (iy - 1) - sIdx * unit;
        if (iy >= 1 && r < 2 * z.n - 1 && (sIdx + 1) * unit - z.gap <= z.dh - 3 && pc >= 1 && pc <= pw - 2) {
          if (r % 2 === 0) c = st.line;
          if (pc === pw - 2) c = st.line;                                               // 小节线收尾
          const k = seed * 131 + page * 17 + sIdx * 5;
          if (z.n === 3 && pc >= 2 && pc <= pw - 4) {
            const g0 = 2 + 3 * Math.floor((pc - 2) / 3), o = pc - g0, h = hash(k * 31 + g0), hr = (h >>> 4) % 5;
            if (h % 6 && o < 2) { if (r === hr) c = st.ink; else if (o === 1 && hr >= 2 && r < hr && r >= hr - 2) c = st.ink; else if (o === 0 && hr < 2 && r > hr && r <= hr + 2) c = st.ink; }
          } else if (z.n === 2 && pc % 2 === 1 && pc <= pw - 3) { const h = hash(k * 31 + pc); if (h % 5 && r === (h >>> 4) % 3) c = st.ink; }
          else if (z.n === 1 && pc <= pw - 3 && hash(k * 31 + pc) % 3 === 0) c = st.ink;
        }
        P(x, y, c);
      }
      // 托谱的沿
      const ly = deskTop + z.dh;
      for (let rx = 0; rx < z.w; rx++) P(x0 + rx, ly, lit ? mix(C.frameHi, st.glow, 0.25) : C.frameHi);
      for (let rx = 1; rx < z.w - 1; rx++) P(x0 + rx, ly + 1, C.frameLo);
      // 立杆（左亮右暗）+ 锁紧的箍 + 三脚
      const py0 = ly + 2, legTop = baseY - z.legH + 1;
      for (let y = py0; y <= baseY; y++) {
        if (z.pole === 3) { P(cx - 1, y, C.poleHi); P(cx, y, C.pole); P(cx + 1, y, C.poleLo); } else P(cx, y, mix(C.pole, C.poleHi, 0.5));
      }
      if (z.pole === 3) { const cy = py0 + Math.round((legTop - py0) * 0.42); for (let dx = -2; dx <= 2; dx++) { P(cx + dx, cy, C.poleHi); P(cx + dx, cy + 1, dx === 2 ? C.poleLo : C.pole); } }
      for (let i = 0; i < z.legH; i++) {
        const y = legTop + i, o = z.pole === 3 ? 2 + 2 * i : 1 + i;
        P(cx - o, y, C.poleHi); P(cx - o - 1, y, C.pole); P(cx + o, y, C.pole); P(cx + o + 1, y, C.poleLo);
      }
    };

    // 5. 谱台的位置：三排，围着指挥台散开。先排好位置，再按离指挥台的远近给灯编号（最近的先亮）
    const slots = [];
    const rowOf = (base, gap, depth, phase) => {
      const w = STAND_SIZES[depth].w;
      for (let x = Math.round(gap * phase); x < cols + w; x += gap) {
        if ((depth === 2 || (!home && depth === 1)) && Math.abs(x - stageX) < archW / 2 + w) continue;                   // 远排不挡舞台口
        if (Math.abs(x - podX) < 34 + w / 2) continue;                                      // 给指挥台让位
        if (!home && quiet && x + w / 2 > quiet[0] - 2 && x - w / 2 < quiet[1] + 2) continue; // 对话页：输入框后面不放
        slots.push({cx: x, base, depth});
      }
    };
    rowOf(risers[1] - 2, 60, 2, 0);
    rowOf(risers[2] - 2, 60, 1, 0.5);
    rowOf(rows + 30, 120, 0, 0.5);                        // 近排的立杆伸到画面外，只露出谱板和一截杆
    const order = slots.map((s, i) => i).sort((a, b) => (Math.abs(slots[a].cx - podX) + slots[a].depth * 26) - (Math.abs(slots[b].cx - podX) + slots[b].depth * 26));
    order.forEach((slotIndex, rank) => { slots[slotIndex].state = lamps[rank] || 'off'; });
    if (slots[flash] && slots[flash].state === 'off') slots[flash].state = 'tap';   // 点了一下的那个谱台：灯亮一拍
    const paintRow = (depth) => slots.forEach((s, i) => { if (s.depth === depth) drawStand(s.cx, s.base, s.depth, s.state, i + 1); });
    paintRow(2);
    paintRow(1);

    // 6. 指挥台：木台子（台面受灯光，正面有嵌板）；背对我们的谱台在 paintMoving 里画（它的灯会跳）
    const podW = 58, podH = home ? 12 : 9, podBase = rows - 3, podTop = podBase - podH + 1, px0 = podX - (podW >> 1);
    const lead = {cx: podX, base: podTop + 1};
    for (let x = px0 - 3; x < px0 + podW + 3; x++) for (let dy = 1; dy <= 2; dy++) if (bayer(x, dy) < (dy === 1 ? 0.75 : 0.4)) blend(x, podBase + dy, C.seam, 0.7);   // 台子的影子
    for (let ry = 0; ry < podH; ry++) for (let rx = 0; rx < podW; rx++) {
      const x = px0 + rx, y = podTop + ry;
      let c;
      if (ry < 4) {                                                                         // 台面（往后收一点）
        if (rx < 3 - ry || rx >= podW - (3 - ry)) continue;
        c = ry === 3 ? C.podTrim : ramp([C.podTop, C.podTopLo], Math.abs(x - lead.cx) / 34 + ry * 0.08, x, y);
      } else {
        const m = rx % 29, inner = ry >= 6 && ry <= podH - 3 && m >= 3 && m <= 25;
        c = ry === podH - 1 ? C.podFaceLo : rx === 0 ? C.podFaceHi : rx === podW - 1 ? C.podFaceLo
          : inner ? ((ry === 6 || m === 3) ? C.podFaceLo : (ry === podH - 3 || m === 25) ? C.podFaceHi : ramp([C.podFaceHi, C.podFace], rx / 40, x, y)) : C.podFace;
      }
      hard(x, y, c);
    }
    paintRow(0);

    return {buf, cols, rows, C, dim, dark, solid, anchors: {logo, lead, floorY, y0, stageX, podX, slots}};
  }

  /* 会动的两样，叠在静的那一层上：指挥台的灯（每拍亮一下、半拍收回一格）和节拍器的摆锤（左-中-右-中）。
   * put(x, y, [r,g,b]) 由调用方给（它负责 dim 和越界）。step 是半拍数；still = 减少动态效果。 */
  function paintMoving(scene, step, still, put, under) {
    const {C, dark, cols, anchors: {logo, lead}} = scene;
    // 摆锤
    const phase = still ? 1 : step % 4;
    const bobX = logo.x + Math.round((6 + [0, 0.5, 1, 0.5][phase]) * logo.s);
    for (let y = 0; y < 2 * logo.s; y++) for (let x = 0; x < 2 * logo.s; x++) put(bobX + x, logo.y + 3 * logo.s + y, y === 0 || x === 0 ? C.eye : C.eyeLo);
    // 指挥台的谱台（背面）和灯：强拍光晕大一格
    const on = still || step % 2 === 0;
    const z = LEAD, st = C.lead, x0 = lead.cx - (z.w >> 1), yTop = lead.base - z.h + 1, deskTop = yTop + 3;
    const r = on ? 21 : 19, by = deskTop - 1;
    for (let y = by - r; y <= by + r; y++) for (let x = lead.cx - r; x <= lead.cx + r; x++) {
      if (x < 0 || y < 0 || x >= cols || y >= scene.rows || scene.solid[y * cols + x]) continue;
      const g = 1 - Math.hypot(x - lead.cx, (y - by) * 1.1) / r;
      if (g > 0 && g * g * (dark ? 1.0 : 0.3) > bayer(x, y)) put(x, y, mix(under(x, y), st.glow, dark ? 0.14 + g * 0.36 : 0.45));
    }
    const lw = z.lampW >> 1, hot = mix(C.frameHi, st.glow, on ? 0.75 : 0.5);
    for (let dx = -lw + 1; dx <= lw - 1; dx++) put(lead.cx + dx, yTop, dx === -lw + 1 ? C.poleHi : C.lampHood);
    for (let dx = -lw; dx <= lw; dx++) put(lead.cx + dx, yTop + 1, mix(C.lampHood, st.glow, 0.3));
    for (let dx = -lw + 1; dx <= lw - 1; dx++) put(lead.cx + dx, yTop + 2, on ? st.core : mix(st.core, st.glow, 0.5));
    for (let ry = 0; ry < z.dh; ry++) for (let rx = 0; rx < z.w; rx++) {
      // 背板：顶上一线被灯照亮；中间一道筋、两道横撑、四颗铆钉
      const c = ry === 0 ? hot : rx === z.w - 1 ? mix(C.frameHi, st.glow, 0.3) : rx === 0 ? C.frame : ry === z.dh - 1 ? C.frameLo
        : rx === z.w >> 1 ? C.pole : (ry === 4 || ry === 10) ? C.frame : ((rx === 3 || rx === z.w - 4) && (ry === 2 || ry === 12)) ? C.frameHi : C.sil;
      put(x0 + rx, deskTop + ry, c);
    }
    const ly = deskTop + z.dh;
    for (let rx = 1; rx < z.w - 1; rx++) put(x0 + rx, ly, C.frameLo);
    for (let y = ly + 1; y <= lead.base; y++) { put(lead.cx - 1, y, C.pole); put(lead.cx, y, C.pole); put(lead.cx + 1, y, C.poleHi); }
    const cy = ly + 4; for (let dx = -2; dx <= 2; dx++) { put(lead.cx + dx, cy, C.poleHi); put(lead.cx + dx, cy + 1, C.pole); }
    for (let i = 0; i < z.legH; i++) { const y = lead.base - z.legH + 1 + i, o = 2 + 2 * i; put(lead.cx - o, y, C.pole); put(lead.cx - o - 1, y, C.poleLo); put(lead.cx + o, y, C.poleHi); put(lead.cx + o + 1, y, C.pole); }
  }

  // 给单测和离线出图用（node 里没有 document）
  G.__pinkieMetreScene = {CELL, BPM, SPRITES, PALETTES, buildScene, paintMoving, lampStates};
  if (typeof document === 'undefined') return;

  // ==================================================================================================
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const isHome = () => root.getAttribute('data-laolao-startup-home') === '1';
  const isDark = () => root.getAttribute('data-theme') === 'dark' || root.hasAttribute('data-pinkie-night');
  const reduced = () => root.hasAttribute('data-pinkie-reduce-motion') || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const mainEl = () => document.querySelector('main.content.content--chat');
  let canvas = null, ctx = null, scene = null, low = null, lowCtx = null, img = null, view = null;
  let timer = 0, step = 0, observed = null, lastStep = -1, lampSig = '', previewLamps = null, flashSlot = -1, flashTimer = 0;
  const mainClass = new MutationObserver(() => queue());
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => queue()) : null;

  function mount() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'pk-metre-backdrop';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
    root.setAttribute('data-pk-metre-backdrop', '');
  }
  function unmount() {
    stop();
    if (observed && ro) ro.unobserve(observed);
    observed = null;
    mainClass.disconnect();
    canvas?.remove();
    canvas = null; ctx = null; scene = null; low = null; img = null; lastStep = -1; lampSig = ''; flashSlot = -1; clearTimeout(flashTimer);
    root.removeAttribute('data-pk-metre-backdrop');
    root.style.removeProperty('--metre-band');
  }
  const currentLamps = () => previewLamps || lampStates(window.__pinkieMetreBoardData?.data?.sessions);

  // 量位置、算格数、画静的那一层
  function layout() {
    const main = mainEl();
    if (!canvas || !main) return;
    const rect = main.getBoundingClientRect();
    const home = isHome();
    const dpr = window.devicePixelRatio || 1;
    const cellDev = Math.max(2, Math.round(CELL * dpr));           // 一格占几个设备像素（整数）
    const cellCss = cellDev / dpr;
    const fullH = window.innerHeight - rect.top;
    // 场景高：首页约 28%，对话页约 16%；上面再留一段只有「大厅的暗」的过渡
    const bandCss = home ? Math.max(184, Math.min(300, Math.round(fullH * 0.28))) : Math.max(112, Math.min(168, Math.round(fullH * 0.16)));
    const band = Math.round(bandCss / cellCss);
    const rows = band + Math.round(band * (home ? 0.9 : 0.6));
    const cols = Math.ceil(rect.width / cellCss);
    const cssW = cols * cellCss, cssH = rows * cellCss;
    Object.assign(canvas.style, {left: Math.round(rect.left * dpr) / dpr + 'px', top: 'auto', bottom: '0px', width: cssW + 'px', height: cssH + 'px'});
    canvas.width = cols * cellDev;
    canvas.height = rows * cellDev;
    ctx = canvas.getContext('2d');
    root.style.setProperty('--metre-band', Math.round(band * cellCss) + 'px');
    const col = document.querySelector('.agent-chat__input')?.getBoundingClientRect();
    const quiet = !home && col && col.width ? [Math.floor((col.left - rect.left) / cellCss) - 4, Math.ceil((col.right - rect.left) / cellCss) + 4] : null;
    const lamps = currentLamps();
    lampSig = lamps.join(',');
    scene = buildScene({cols, rows, band, dark: isDark(), home, lamps, quiet, dim: home ? 0 : 0.5, flash: flashSlot});
    
    low = document.createElement('canvas');
    low.width = cols; low.height = rows;
    lowCtx = low.getContext('2d');
    img = lowCtx.createImageData(cols, rows);
    view = {cols, rows, cellDev, cellCss};
    lastStep = -1;
  }

  function draw(force = false) {
    if (!ctx || !scene || !img) return;
    const tempo = document.querySelector('.pk-metre-tempo');
    if (tempo) tempo.dataset.beat = String(reduced() ? 0 : Math.floor(step / 2) % 4);
    if (!force && step === lastStep) return;
    lastStep = step;
    const {cols, rows, cellDev} = view;
    const out = new Uint32Array(img.data.buffer);
    out.set(scene.buf);
    const bg = scene.C.bg, dim = scene.dim;
    const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < cols && y < rows) out[y * cols + x] = pack(dim ? mix(c, bg, dim) : c); };
    const under = (x, y) => { const v = x >= 0 && y >= 0 && x < cols && y < rows ? scene.buf[y * cols + x] : 0; return v ? [v & 255, (v >> 8) & 255, (v >> 16) & 255] : bg; };
    paintMoving(scene, step, reduced(), put, under);
    lowCtx.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(low, 0, 0, cols * cellDev, rows * cellDev);
  }
  function tick() {
    timer = 0;
    if (!running()) return;
    step++;
    // 子会话变了（派出、做完、出错）：灯跟着换，静的那一层重画一次
    if (currentLamps().join(',') !== lampSig) layout();
    draw();
    timer = setTimeout(tick, STEP);
  }
  const running = () => Boolean(canvas) && !document.hidden && !window.__pinkieMetreBrand?.isOpen && !reduced();
  function start() { if (!timer && running()) timer = setTimeout(tick, STEP); }
  function stop() { clearTimeout(timer); timer = 0; }


  /* ---------- 点一下（11-16 用户：「加鼠标点击有“特别”的像素动画」） ----------
   * 在 Metre 的空白处点一下 = 指挥棒点了一拍：点的地方荡开一圈菱形的像素波（抖动着淡掉），冒出三颗像素音符一格一格往上飘；
   * 点在画带里时，离得最近的那个谱台的灯跟着亮一拍。按钮、输入框、正文、侧栏、总控台、弹层上的点击不触发。
   * 每次点击临时建一块 2px 格的小画布（不拦鼠标），0.7 秒画完就拿掉——不留常驻动画；减少动态效果时不出现。 */
  const NOTE = ['...#.', '...##', '...#.', '...#.', '.###.', '####.', '.##..'];
  const TAP_FRAMES = 24, TAP_MS = 40, TAP_SIZE = 128;
  const QUIET_HIT = 'button, a, input, textarea, select, summary, label, [role="button"], [role="menu"], [role="dialog"], [role="listbox"], [contenteditable], .chat-text, .chat-group, .agent-chat__input, aside.sidebar, header.topbar, .pk-metre-board, .pk-metre-brand, [data-metre-pop], .laolao-menu, .pinkie-tray';
  function tapFx(clientX, clientY) {
    const dpr = window.devicePixelRatio || 1, cellDev = Math.max(2, Math.round(CELL * dpr)), cellCss = cellDev / dpr;
    const C = resolve(isDark() ? PALETTES.dark : PALETTES.light);
    const cv = document.createElement('canvas');
    cv.className = 'pk-metre-tap';
    cv.setAttribute('aria-hidden', 'true');
    cv.width = cv.height = TAP_SIZE * cellDev;
    const half = TAP_SIZE * cellCss / 2;
    Object.assign(cv.style, {position: 'fixed', left: Math.round((clientX - half) * dpr) / dpr + 'px', top: Math.round((clientY - half) * dpr) / dpr + 'px', width: TAP_SIZE * cellCss + 'px', height: TAP_SIZE * cellCss + 'px', pointerEvents: 'none', zIndex: '2147483000', imageRendering: 'pixelated'});
    document.body.append(cv);
    const g = cv.getContext('2d'), mid = TAP_SIZE >> 1;
    const css = (c) => `rgb(${c.map(Math.round).join(',')})`;
    const ink = css(C.eye), inkLo = css(C.eyeLo), warm = css(isDark() ? C.lead.core : C.frame);
    const dot = (x, y, color) => { if (x >= 0 && y >= 0 && x < TAP_SIZE && y < TAP_SIZE) { g.fillStyle = color; g.fillRect(x * cellDev, y * cellDev, cellDev, cellDev); } };
    const seed = hash(Math.round(clientX) * 7919 + Math.round(clientY));
    const notes = [0, 1, 2, 3, 4].map((i) => ({dx: [-9, 1, 10, -19, 20][i] + ((seed >>> (i * 3)) & 3) - 1, dy: [2, -3, 1, 6, 5][i], delay: [0, 2, 4, 6, 7][i], color: i === 1 || i === 4 ? warm : ink}));
    let f = 0;
    const frame = () => {
      g.clearRect(0, 0, cv.width, cv.height);
      const t = f / (TAP_FRAMES - 1);
      // 两圈菱形波：外圈快、内圈慢半拍；越往外越疏
      for (const [lag, color] of [[0, ink], [4, inkLo], [8, inkLo]]) {
        const ff = f - lag; if (ff < 0) continue;
        const r = Math.round(2 + ff * 2.3), keep = 1 - ff / (TAP_FRAMES - lag);
        for (let dx = -r; dx <= r; dx++) for (const dy of [r - Math.abs(dx), Math.abs(dx) - r]) if (keep > bayer(mid + dx, mid + dy)) dot(mid + dx, mid + dy, color);
      }
      // 四颗小星沿对角线弹出去，一亮一灭
      if (f >= 2 && f < TAP_FRAMES - 4) for (const [sx, sy] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
        const d = Math.round(6 + f * 1.5), x = mid + sx * d, y = mid + sy * Math.round(d * 0.7);
        dot(x, y, warm); if (f & 1) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) dot(x + dx, y + dy, ink);
      }
      // 落点：一个小十字，亮两帧
      if (f < 3) { dot(mid, mid, warm); if (f < 2) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) dot(mid + dx, mid + dy, ink); }
      // 音符：一格一格往上，每四帧左右晃一格，最后抖动着散掉
      for (const n of notes) {
        const nf = f - n.delay; if (nf < 0) continue;
        const nx = mid + n.dx + ((nf >> 2) & 1) - 2, ny = mid + n.dy - 6 - Math.round(nf * 1.3), keep = Math.min(1, (TAP_FRAMES - f) / 5);
        NOTE.forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch === '#' && keep > bayer(nx + rx, ny + ry) * 0.999) dot(nx + rx, ny + ry, n.color); }));
      }
      if (++f < TAP_FRAMES) setTimeout(frame, TAP_MS); else cv.remove();
      void t;
    };
    frame();
  }
  function onTap(e) {
    if (e.button !== 0 || !canvas || !isMetre() || reduced()) return;
    const el = e.target instanceof Element ? e.target : null;
    if (!el || el.closest(QUIET_HIT) || !el.closest('main.content')) return;
    if (String(window.getSelection?.() || '')) return;
    tapFx(e.clientX, e.clientY);
    // 点在画带里：最近的谱台亮一拍
    const rect = canvas.getBoundingClientRect();
    if (scene && view && e.clientY >= rect.top && e.clientX >= rect.left) {
      const cx = (e.clientX - rect.left) / view.cellCss, cy = (e.clientY - rect.top) / view.cellCss;
      let best = -1, bestD = 46;
      scene.anchors.slots.forEach((sl, i) => { const z = STAND_SIZES[sl.depth], d = Math.hypot(sl.cx - cx, (sl.base - z.poleH - z.legH - z.dh / 2 - cy) * 1.4); if (d < bestD) { bestD = d; best = i; } });
      if (best >= 0) {
        flashSlot = best; layout(); draw(true);
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { flashSlot = -1; if (canvas) { layout(); draw(true); } }, STEP * 2);
      }
    }
  }

  // ---------- 什么时候有 ----------
  function sync() {
    const main = isMetre() ? mainEl() : null;
    if (!main) { unmount(); return; }
    mount();
    if (observed !== main) {
      if (observed && ro) ro.unobserve(observed);
      observed = main;
      ro?.observe(main);
      mainClass.disconnect();
      mainClass.observe(main, {attributes: true, attributeFilter: ['class']});
    }
    layout();
    draw(true);
    if (running()) start(); else stop();
  }
  let queued = false;
  const queue = () => { if (!queued) { queued = true; setTimeout(() => { queued = false; sync(); }, 150); } };

  function boot() {
    new MutationObserver(queue).observe(root, {attributes: true, attributeFilter: ['data-laolao-mode', 'data-laolao-startup-home', 'data-theme', 'data-pinkie-night', 'data-pinkie-reduce-motion']});
    const shell = document.querySelector('openclaw-app') || document.body;
    // 换页（对话 ↔ 设置等）时 main 的 class 会变；只看结构变化，不看对话流里的字
    new MutationObserver((records) => {
      if (!isMetre() && !canvas) return;
      if (records.some((r) => !(r.target instanceof Element) || !r.target.closest('.chat-thread, .pk-metre-board, .pk-metre-brand, .pk-metre-backdrop'))) queue();
    }).observe(shell, {childList: true, subtree: true});
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else queue(); });
    window.addEventListener('resize', queue);
    document.addEventListener('pointerdown', onTap, true);
    // 总控台的数据到了 / 换了会话：灯马上跟上（不等下一拍）
    window.addEventListener('pinkie:session-selected', queue);
    // 标志页开关：它开着时停，关了接着走
    document.addEventListener('keydown', () => setTimeout(() => { if (canvas) { if (running()) start(); else stop(); } }, 0), true);
    document.addEventListener('click', () => setTimeout(() => { if (canvas) { if (running()) start(); else stop(); } }, 0), true);
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true});
  else boot();

  window.__pinkieMetreBackdrop = Object.freeze({
    get mounted() { return Boolean(canvas); },
    get running() { return Boolean(timer); },
    get step() { return step; },
    get lamps() { return currentLamps(); },
    // 预览 / 验收用：临时指定灯的状态（['run','done','fail',…]），传 null 恢复成跟总控台走
    tap(x, y) { tapFx(x, y); },
    preview(list) { previewLamps = Array.isArray(list) ? list.slice() : null; if (canvas) { layout(); draw(true); } },
    sync,
  });
})();
