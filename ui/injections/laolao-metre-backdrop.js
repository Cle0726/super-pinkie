/* laolao-metre-backdrop —— Metre 首页 / 对话页底部的像素画带（11-15 第十一稿「谱台灯」）。
 *
 * 用户 11-15 晚看了装进 App 的「月夜」：「像素视觉元素没有 Metre 自己的感觉，像素密度也低，质量太差，整体也没有大厂的氛围和呼吸感」。
 * 月亮、山、电线杆、音符、草、星星、萤火虫和整屏的 LED 缝全部拿掉（它们是照参考视频抄的题材）。
 *
 * 现在画的是 Metre 自己的事：一个指挥，一排排等着开工的声部。
 *   夜里的排练厅，从乐手的座位看出去：近处几排谱台，每个谱台上夹着一盏小灯；中间偏右是指挥台，
 *   黑猫坐在上面看着你；最远处是舞台口，里面立着像素 M 节拍器的剪影。
 *   谱台灯 = 子会话（和总控台同一份数据，laolao-metre-board-data.js）：
 *     没有子会话时只有指挥台那一盏亮着；每派出一个亮一盏——在跑 = 钴蓝，做完 = 暖白（暗一档），出错 = 砖红，排队 = 不亮。
 *   会动的只有两样：指挥台的灯和节拍器的摆锤，按 ♩=72 跳格。减少动态效果时静止。
 * 版面：画只占页面底部一条（首页约 28% 高，对话页约 16% 高、对比度降一半），上面是空的——
 *   只有一层很细的抖动渐变（大厅的暗），不放任何东西。提示语、对话正文都在那片空里。
 * 画法：一格 2 个 CSS 像素（按设备像素取整，格子边永远落在整像素上），整张图先画进一块低分辨率的 Uint32 缓冲，
 *   最近邻放大贴到画布上；不压缝。精灵是一格一格摆的（猫 44 格高，近排谱台 30 格高，远排 16 格高）；
 *   渐变和光晕用 4×4 Bayer 抖动；剪影受光的一侧描一圈亮边。
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
  // 每种材质 5–6 级：地（floor0..2）、剪影（sil / silRim）、谱纸（各状态 hi / lo / line）、灯（各状态 core / glow）、大厅的暗（hall1..3）。
  const PALETTES = {
    dark: {
      bg: '#151514', hall1: '#17171A', hall2: '#191A1F', hall3: '#1C1D25',
      floor0: '#0F0F11', floor1: '#0C0C0E', floor2: '#09090B', riser: '#24252C', riserDim: '#1A1B20',
      stage: '#262938', stageHi: '#353A54', arch: '#2C2D36',
      sil: '#070708', silRim: '#4A4D60', frame: '#17171B', frameRim: '#3A3B46', pole: '#202026',
      cat: '#050506', catRim: '#5C5A50', eye: '#93A5EE', eyeHi: '#DCE3FF',
      podium: '#131316', podiumTop: '#2E2F38', podiumFace: '#0D0D10',
      off: {hi: '#24242A', lo: '#1F1F24', line: '#19191D', core: null, glow: null},
      run: {hi: '#B4C0F6', lo: '#6272BE', line: '#3D4A8E', core: '#E6EBFF', glow: '#93A5EE'},
      done: {hi: '#8F897B', lo: '#5A564C', line: '#3D3A33', core: '#D9D0B8', glow: '#8C8470'},
      fail: {hi: '#9A4B39', lo: '#5E2D22', line: '#3B1B14', core: '#E07A5F', glow: '#B4513B'},
      wait: {hi: '#26262B', lo: '#1F1F24', line: '#19191C', core: null, glow: null},
      lead: {hi: '#EDE6D2', lo: '#A79F8A', line: '#6B6556', core: '#FFF6DC', glow: '#D9CDA8'},
    },
    light: {
      bg: '#F7F6F3', hall1: '#F5F3EF', hall2: '#F2F0EA', hall3: '#EEEBE4',
      floor0: '#ECE9E1', floor1: '#E8E4DB', floor2: '#E3DFD5', riser: '#BDB6A7', riserDim: '#D2CCBF',
      stage: '#E2DDD0', stageHi: '#D6D0C1', arch: '#B9B2A3',
      sil: '#2B2925', silRim: '#6B665C', frame: '#4A463F', frameRim: '#8A8478', pole: '#6B665C',
      cat: '#1B1A18', catRim: '#77736B', eye: '#2F4BB0', eyeHi: '#B9C5F3',
      podium: '#D9D4C8', podiumTop: '#8A8478', podiumFace: '#CBC5B7',
      off: {hi: '#F4F2EC', lo: '#EFECE5', line: '#DDD8CC', core: null, glow: null},
      run: {hi: '#E4E9FA', lo: '#C9D2F4', line: '#2F4BB0', core: '#2F4BB0', glow: '#2F4BB0'},
      done: {hi: '#EFEAE0', lo: '#E4DED1', line: '#A39C8D', core: '#8A8478', glow: '#B9B2A3'},
      fail: {hi: '#F3DFD9', lo: '#EAC8BE', line: '#A8432F', core: '#A8432F', glow: '#A8432F'},
      wait: {hi: '#F4F2EC', lo: '#EFECE5', line: '#DDD8CC', core: null, glow: null},
      lead: {hi: '#FFFDF7', lo: '#F1ECDF', line: '#4A463F', core: '#2F4BB0', glow: '#2F4BB0'},
    },
  };
  const resolve = (pal) => {
    const out = {};
    for (const [k, v] of Object.entries(pal)) out[k] = typeof v === 'string' ? rgb(v) : Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, vv ? rgb(vv) : null]));
    return out;
  };

  // ---------- 精灵（一格一格摆的） ----------
  // 黑猫，正面略侧坐着，44 格高：大尖耳、一双斜的蓝眼、尾巴从右边绕到前面。K 身体，E 眼睛，H 眼睛高光。
  const CAT = [
    '....K.................K.............',
    '....KK...............KK.............',
    '....KKK.............KKK.............',
    '....KKKK...........KKKK.............',
    '....KKKKK.........KKKKK.............',
    '....KKKKKK.......KKKKKK.............',
    '....KKKKKKK.....KKKKKKK.............',
    '....KKKKKKKK...KKKKKKKK.............',
    '....KKKKKKKKKKKKKKKKKKKK............',
    '...KKKKKKKKKKKKKKKKKKKKKK...........',
    '...KKKKKKKKKKKKKKKKKKKKKK...........',
    '..KKKKKKKKKKKKKKKKKKKKKKKK..........',
    '..KKKKKKKKKKKKKKKKKKKKKKKK..........',
    '..KKKEKKKKKKKKKKKKKKKKEKKK..........',
    '..KKKEEHKKKKKKKKKKKKHEEKKK..........',
    '..KKKKEEEKKKKKKKKKKEEEKKKK..........',
    '..KKKKKKEEKKKKKKKKEEKKKKKK..........',
    '..KKKKKKKKKKKKKKKKKKKKKKKK..........',
    '...KKKKKKKKKKKKKKKKKKKKKK...........',
    '...KKKKKKKKKKKKKKKKKKKKKK...........',
    '....KKKKKKKKKKKKKKKKKKKK............',
    '.....KKKKKKKKKKKKKKKKKK.............',
    '......KKKKKKKKKKKKKKKKKK............',
    '......KKKKKKKKKKKKKKKKKKK...........',
    '.....KKKKKKKKKKKKKKKKKKKKK..........',
    '.....KKKKKKKKKKKKKKKKKKKKKK.........',
    '....KKKKKKKKKKKKKKKKKKKKKKKK........',
    '....KKKKKKKKKKKKKKKKKKKKKKKKK.......',
    '....KKKKKKKKKKKKKKKKKKKKKKKKKK......',
    '....KKKKKKKKKKKKKKKKKKKKKKKKKK......',
    '....KKKKKKKKKKKKKKKKKKKKKKKKKKK.....',
    '....KKKKKKKKKKKKKKKKKKKKKKKKKKK.....',
    '....KKKKKKKKKKKKKKKKKKKKKKKKKKKK....',
    '....KKKKKKKKKKKKKKKKKKKKKKKKKKKK....',
    '....KKKKKKKKKKKKKKKKKKKKKKKKKKKK....',
    '....KKKKKKKKKKKKKKKKKKKKKKKKKKKK....',
    '....KKKKKK.KKKKKKKKKKKKKKKKKKKKK....',
    '....KKKKKK.KKKKKKKKKKKKKKKKKKKKK....',
    '....KKKKKK.KKKKKKKKKKKKKKKKKKKKK..K.',
    '....KKKKKK.KKKKKKKKKKKKKKKKKKKKK.KK.',
    '....KKKKKK.KKKKKKKKKKKKKKKKKKKKKKKK.',
    '...KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK.',
    '.KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK..',
    '..KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK...',
  ];
  // 像素 M 节拍器（和 laolao-metre-brand.js 的标志同一张图；摆锤 '@' 单独画，会动）
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
  // 谱台（正面，看得见谱纸）：三种大小。字符：L 灯罩  B 灯泡  F 谱板边框  S 谱纸  l 谱线  P 立杆和三脚
  // 一格一格写死，不是算出来的：每一种大小的谱线、折缝、灯罩都单独摆过。
  const STAND_NEAR = [
    '.........LLLLL.........',
    '........LLLLLLL........',
    '.........BBBBB.........',
    'FFFFFFFFFFFFFFFFFFFFFFF',
    'FSSSSSSSSSSFSSSSSSSSSSF',
    'FSSSSSSSSSSFSSSSSSSSSSF',
    'FSlllllllSSFSSlllllllSF',
    'FSSSSSSSSSSFSSSSSSSSSSF',
    'FSlllllllSSFSSlllllllSF',
    'FSSSSSSSSSSFSSSSSSSSSSF',
    'FSlllllllSSFSSlllllllSF',
    'FSSSSSSSSSSFSSSSSSSSSSF',
    'FSlllllllSSFSSlllllllSF',
    'FSSSSSSSSSSFSSSSSSSSSSF',
    'FSlllllSSSSFSSlllllllSF',
    'FSSSSSSSSSSFSSSSSSSSSSF',
    'FFFFFFFFFFFFFFFFFFFFFFF',
    '.FFFFFFFFFFFFFFFFFFFFF.',
    '..........PPP..........',
    '..........PPP..........',
    '..........PPP..........',
    '..........PPP..........',
    '..........PPP..........',
    '..........PPP..........',
    '..........PPP..........',
    '..........PPP..........',
    '.........PPPPP.........',
    '.......PPP.P.PPP.......',
    '.....PPP...P...PPP.....',
    '...PPP.....P.....PPP...',
  ];
  const STAND_MID = [
    '......LLLLL......',
    '.......BBB.......',
    'FFFFFFFFFFFFFFFFF',
    'FSSSSSSSFSSSSSSSF',
    'FSlllllSFSlllllSF',
    'FSSSSSSSFSSSSSSSF',
    'FSlllllSFSlllllSF',
    'FSSSSSSSFSSSSSSSF',
    'FSlllllSFSlllllSF',
    'FSSSSSSSFSSSSSSSF',
    'FSlllSSSFSlllllSF',
    'FSSSSSSSFSSSSSSSF',
    'FFFFFFFFFFFFFFFFF',
    '.......PPP.......',
    '........P........',
    '........P........',
    '........P........',
    '........P........',
    '........P........',
    '.......PPP.......',
    '.....PP.P.PP.....',
    '...PP...P...PP...',
  ];
  const STAND_FAR = [
    '....LLL....',
    '.....B.....',
    'FFFFFFFFFFF',
    'FSSSSFSSSSF',
    'FSlllFlllSF',
    'FSSSSFSSSSF',
    'FSlllFlllSF',
    'FSSSSFSSSSF',
    'FFFFFFFFFFF',
    '.....P.....',
    '.....P.....',
    '.....P.....',
    '.....P.....',
    '....PPP....',
    '...P.P.P...',
    '..P..P..P..',
  ];
  // 指挥台上的谱台（背面，只是一块剪影；它的灯照着猫）
  const STAND_LEAD = [
    '.........LLLLL.........',
    '..........BBB..........',
    'FFFFFFFFFFFFFFFFFFFFFFF',
    'FFFFFFFFFFFFFFFFFFFFFFF',
    'FFFFFFFFFFFFFFFFFFFFFFF',
    'FFFFFFFFFFFFFFFFFFFFFFF',
    'FFFFFFFFFFFFFFFFFFFFFFF',
    'FFFFFFFFFFFFFFFFFFFFFFF',
    'FFFFFFFFFFFFFFFFFFFFFFF',
    'FFFFFFFFFFFFFFFFFFFFFFF',
    'FFFFFFFFFFFFFFFFFFFFFFF',
    'FFFFFFFFFFFFFFFFFFFFFFF',
    '.FFFFFFFFFFFFFFFFFFFFF.',
    '..........PPP..........',
    '..........PPP..........',
    '..........PPP..........',
    '..........PPP..........',
    '..........PPP..........',
    '..........PPP..........',
    '..........PPP..........',
    '.........PPPPP.........',
    '.......PPP.P.PPP.......',
  ];
  const SPRITES = {CAT, LOGO, STAND_NEAR, STAND_MID, STAND_FAR, STAND_LEAD};

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

  /* 画静的那一层。返回 {buf, anchors}。
   * cols×rows 是整块画布的格数；band 是场景占的行数（贴底），band 上面的行只有大厅的暗（抖动渐变，越往上越接近底色，最上面是透明）。
   * quiet = [x0, x1]：输入框那一栏的格范围（对话页用它把指挥台和舞台口让到两边的空地上）；首页传 null。 */
  function buildScene({cols, rows, band, dark, home, lamps = [], quiet = null, dim = 0}) {
    const C = resolve(dark ? PALETTES.dark : PALETTES.light);
    const buf = new Uint32Array(cols * rows);            // 0 = 透明（露出页面底色）
    const y0 = rows - band;                              // 场景顶
    const floorY = y0 + Math.round(band * 0.42);         // 地平线：上面是后墙和舞台口，下面是地
    const fade = (c) => dim ? mix(c, C.bg, dim) : c;
    const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < cols && y < rows) buf[y * cols + x] = pack(fade(c)); };
    const solid = new Uint8Array(cols * rows);           // 剪影占了哪些格（描亮边用）

    // 1. 大厅的暗：从画布顶到地平线，底色 → hall1 → hall2 → hall3，相邻两档之间抖动
    const hall = [null, C.hall1, C.hall2, C.hall3];
    for (let y = 0; y < floorY; y++) {
      const t = Math.pow(y / Math.max(1, floorY), 1.6) * 3;
      const lo = Math.min(3, Math.floor(t)), frac = t - lo;
      for (let x = 0; x < cols; x++) {
        const lvl = Math.min(3, lo + (frac > bayer(x, y) ? 1 : 0));
        if (hall[lvl]) set(x, y, hall[lvl]);
      }
    }
    // 2. 地：三档，越近越深（浅色主题是越近越实），抖动；三道台阶线（乐队的阶梯台）
    const floorH = rows - floorY;
    for (let y = floorY; y < rows; y++) {
      const t = ((y - floorY) / Math.max(1, floorH)) * 2;
      const lo = Math.min(2, Math.floor(t)), frac = t - lo;
      for (let x = 0; x < cols; x++) set(x, y, [C.floor0, C.floor1, C.floor2][Math.min(2, lo + (frac > bayer(x, y) ? 1 : 0))]);
    }
    const risers = [0, Math.round(floorH * 0.2), Math.round(floorH * 0.52)].map((d) => floorY + d);
    risers.forEach((y, i) => { for (let x = 0; x < cols; x++) set(x, y, i === 0 ? C.riser : (x + i) % 2 ? C.riserDim : C.riser); });

    // 位置：首页舞台口在正中、指挥台中间偏右；对话页两样各让到输入框两边的空地（空地不够宽就留在原处，被输入框挡住也无妨）
    let stageX = Math.round(cols * 0.5), podX = Math.round(cols * 0.66);
    if (!home && quiet) {
      const left = quiet[0], right = cols - quiet[1];
      if (right >= 84) podX = quiet[1] + Math.round(right / 2);
      if (left >= 60) stageX = Math.round(left / 2);
      else if (right >= 150) { stageX = quiet[1] + Math.round(right * 0.25); podX = quiet[1] + Math.round(right * 0.68); }
    }

    // 3. 舞台口：一道拱（只有一圈边）+ 里面一片抖动的光 + 像素 M 的剪影
    const archW = Math.min(196, Math.round(cols * 0.34)), archH = Math.max(18, Math.round(band * 0.6)), archR = Math.min(16, Math.floor(archH / 2));
    const ax0 = stageX - Math.floor(archW / 2), ax1 = ax0 + archW - 1, ay0 = floorY - archH;
    const inArch = (x, y) => {
      if (x < ax0 || x > ax1 || y < ay0 || y >= floorY) return false;
      if (y >= ay0 + archR) return true;
      const cx = x < ax0 + archR ? ax0 + archR : x > ax1 - archR ? ax1 - archR : x;
      return Math.hypot(x - cx, y - (ay0 + archR)) <= archR + 0.2;
    };
    for (let y = ay0; y < floorY; y++) for (let x = ax0; x <= ax1; x++) {
      if (!inArch(x, y)) continue;
      const edge = !inArch(x - 1, y) || !inArch(x + 1, y) || !inArch(x, y - 1);
      if (edge) { set(x, y, C.arch); continue; }
      const d = Math.hypot((x - stageX) / (archW * 0.52), (y - floorY) / (archH * 1.0));
      const g = Math.max(0, 1 - d);
      // 三档：最里面一团亮（stageHi），外面一圈 stage，再外面抖动着融进大厅的暗
      if (g > 0.5 && (g - 0.5) * 2.6 > bayer(x + 1, y + 2)) set(x, y, C.stageHi);
      else if (g * 1.9 > bayer(x, y) + 0.1) set(x, y, C.stage);
    }
    // 舞台口的光落在地上一小片（梯形，越近越疏）
    for (let dy = 1; dy <= Math.round(floorH * 0.22); dy++) {
      const y = floorY + dy, half = Math.round(archW * 0.36 + dy * 1.6), k = 1 - dy / (floorH * 0.22 + 1);
      for (let x = stageX - half; x <= stageX + half; x++) if (k * 0.62 * (1 - Math.abs(x - stageX) / (half + 1)) > bayer(x, y)) set(x, y, mix(C.floor0, C.stage, 0.55));
    }
    const logoS = archH >= 52 ? 3 : archH >= 30 ? 2 : 1;                 // 标志按舞台口的高矮放大（一个标志格 = logoS×logoS 画格）
    const logo = {x: stageX - Math.floor(13 * logoS / 2), y: floorY - 11 * logoS, s: logoS};
    LOGO.forEach((row, ry) => [...row].forEach((ch, rx) => {
      if (ch !== '#') return;
      for (let dy = 0; dy < logoS; dy++) for (let dx = 0; dx < logoS; dx++) {
        const x = logo.x + rx * logoS + dx, y = logo.y + ry * logoS + dy;
        const lit = (ry === 0 || LOGO[ry - 1][rx] !== '#') && dy === 0;      // 顶上一圈亮边
        set(x, y, lit ? C.silRim : C.sil);
      }
    }));

    // 画一个谱台。depth 0 近 / 1 中 / 2 远：越远越往底色里退（大气透视）
    const drawStand = (sprite, cx, baseY, state, depth) => {
      const st = C[state] || C.off;
      const w = sprite[0].length, h = sprite.length, x0 = cx - Math.floor(w / 2), yTop = baseY - h + 1;
      const far = [0, 0.18, 0.38][depth];
      const tone = (c) => far ? mix(c, dark ? C.hall3 : C.floor0, far) : c;
      const lit = Boolean(st.glow);
      // 灯下的光晕：以灯泡为圆心，抖动着淡出；浅色主题只是一圈很疏的点
      if (lit) {
        const bx = cx, by = yTop + (sprite[1].includes('B') ? 1 : 2), r = Math.round(w * (dark ? 0.78 : 0.5));
        for (let y = by - r; y <= by + r; y++) for (let x = bx - r; x <= bx + r; x++) {
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          const d = Math.hypot(x - bx, (y - by) * 1.15) / r;
          if (d >= 1) continue;
          const g = 1 - d;
          if (g * g * (dark ? 0.9 : 0.34) > bayer(x, y)) {
            const under = buf[y * cols + x];
            const base = under ? [under & 255, (under >> 8) & 255, (under >> 16) & 255] : C.bg;
            buf[y * cols + x] = pack(mix(base, fade(tone(st.glow)), dark ? 0.2 + g * 0.3 : 0.5));
          }
        }
      }
      const sheetRows = sprite.filter((r) => r.includes('S')).length;
      let sheetRow = -1;
      sprite.forEach((row, ry) => {
        if (row.includes('S')) sheetRow++;
        [...row].forEach((ch, rx) => {
          if (ch === '.') return;
          const x = x0 + rx, y = yTop + ry;
          let c;
          if (ch === 'L') c = lit ? mix(C.frame, st.glow, 0.35) : C.frame;
          else if (ch === 'B') c = st.core || C.frame;
          else if (ch === 'F') c = (ry === 0 || sprite[ry - 1][rx] === '.' || sprite[ry - 1][rx] === 'B' || sprite[ry - 1][rx] === 'L') ? (lit ? mix(C.frameRim, st.glow, 0.55) : C.frameRim) : C.frame;
          else if (ch === 'P') c = (rx > 0 && row[rx - 1] === '.') ? mix(C.pole, C.frameRim, 0.5) : C.pole;
          else if (ch === 'l') c = st.line;
          else c = (sheetRow / Math.max(1, sheetRows - 1)) * 1.15 - 0.1 > bayer(x, y) ? st.lo : st.hi;   // 谱纸：靠灯的一头亮，往下抖动着暗下去
          set(x, y, tone(c));
          solid[y * cols + x] = 1;
        });
      });
      // 亮着的灯在地上落一小片光
      if (lit && dark) for (let x = x0 - 2; x < x0 + w + 2; x++) for (let dy = 0; dy < 2; dy++) {
        const y = baseY + 1 + dy; if (y >= rows || x < 0 || x >= cols) continue;
        if (0.55 - dy * 0.25 > bayer(x, y)) set(x, y, mix(C.floor1, tone(st.glow), 0.22));
      }
    };

    // 4. 谱台的位置：三排，围着指挥台散开。先排好位置，再按离指挥台的远近给灯编号（最近的先亮）
    const slots = [];
    const farBase = risers[1] - 1, midBase = risers[2] - 1, nearBase = rows + 4;       // 近排的三脚落在画面外，只露出谱板和半截杆
    const rowOf = (sprite, base, gap, depth, phase) => {
      const w = sprite[0].length;
      for (let x = Math.round(gap * phase); x < cols + w; x += gap) {
        if (depth === 2 && Math.abs(x - stageX) < 13 * logoS / 2 + w) continue;             // 远排不挡 M
        if (depth >= 1 && Math.abs(x - podX) < 34 + w / 2) continue;                        // 中、远排给指挥台和猫让位
        if (depth === 0 && Math.abs(x - podX) < 30 + w / 2) continue;                       // 近排不挡猫
        if (!home && quiet && x + w / 2 > quiet[0] - 2 && x - w / 2 < quiet[1] + 2) continue; // 对话页：输入框后面不放
        slots.push({sprite, cx: x, base, depth});
      }
    };
    rowOf(STAND_FAR, farBase, 30, 2, 0.5);
    rowOf(STAND_MID, midBase, 46, 1, 0.82);
    rowOf(STAND_NEAR, nearBase, 70, 0, 0.45);
    const order = slots.map((s, i) => i).sort((a, b) => (Math.abs(slots[a].cx - podX) + slots[a].depth * 26) - (Math.abs(slots[b].cx - podX) + slots[b].depth * 26));
    order.forEach((slotIndex, rank) => { slots[slotIndex].state = lamps[rank] || 'off'; });
    const paintRow = (depth) => slots.filter((s) => s.depth === depth).forEach((s) => drawStand(s.sprite, s.cx, s.base, s.state, s.depth));
    paintRow(2);

    // 5. 指挥台：一块矮台子 + 背对我们的谱台（它的灯会跳）+ 猫
    const podW = 74, podH = 8, podBase = Math.min(rows - 3, risers[2] + Math.round((rows - risers[2]) * 0.5));
    const px0 = podX - Math.floor(podW / 2), podTop = podBase - podH + 1;
    for (let y = podTop; y <= podBase; y++) for (let x = px0; x < px0 + podW; x++) {
      if ((y === podTop) && (x === px0 || x === px0 + podW - 1)) continue;
      const c = y === podTop ? C.podiumTop : y === podTop + 1 ? C.podium : (x - px0) % 12 === 0 ? C.podium : y === podBase ? C.podium : C.podiumFace;
      set(x, y, c);
    }
    const cat = {x: podX - 6, y: podTop - CAT.length};
    CAT.forEach((row, ry) => [...row].forEach((ch, rx) => {
      if (ch === '.') return;
      const x = cat.x + rx, y = cat.y + ry;
      let c = ch === 'E' ? C.eye : ch === 'H' ? C.eyeHi : C.cat;
      // 受光的一侧（左、上）描一圈亮边
      // 受光的一侧（左、上：指挥台的灯在它左前方）描一圈亮边；背光的一侧（右）只描很暗的一线，让尾巴和背不融进地里
      const edgeL = rx === 0 || row[rx - 1] === '.', edgeT = ry === 0 || CAT[ry - 1][rx] === '.', edgeR = rx === row.length - 1 || row[rx + 1] === '.';
      if (ch === 'K' && (edgeL || edgeT)) c = edgeL && ry > 20 ? mix(C.catRim, C.cat, 0.35) : C.catRim;
      else if (ch === 'K' && edgeR) c = mix(C.cat, C.catRim, 0.38);
      set(x, y, c);
      solid[y * cols + x] = 1;
    }));
    const lead = {cx: podX - 24, base: podTop - 1};
    paintRow(1);
    paintRow(0);

    return {buf, cols, rows, C, dim, solid, anchors: {logo, lead, cat, floorY, y0, stageX, podX, slots}};
  }

  /* 会动的两样，叠在静的那一层上：指挥台的灯（每拍亮一下、半拍收回一格）和节拍器的摆锤（左-中-右-中）。
   * put(x, y, [r,g,b]) 由调用方给（它负责 dim 和越界）。step 是半拍数；still = 减少动态效果。 */
  function paintMoving(scene, step, still, put, under) {
    const {C, anchors: {logo, lead}} = scene;
    // 摆锤
    const phase = still ? 1 : step % 4;
    const bobX = logo.x + Math.round((6 + [0, 0.5, 1, 0.5][phase]) * logo.s);
    for (let y = 0; y < 2 * logo.s; y++) for (let x = 0; x < 2 * logo.s; x++) put(bobX + x, logo.y + 3 * logo.s + y, C.eye);
    // 指挥台的谱台和灯：强拍光晕大一格
    const on = still || step % 2 === 0;
    const sprite = STAND_LEAD, w = sprite[0].length, h = sprite.length, x0 = lead.cx - Math.floor(w / 2), yTop = lead.base - h + 1;
    const st = C.lead, r = on ? 19 : 17, bx = lead.cx, by = yTop + 1, cols = scene.cols;
    for (let y = by - r; y <= by + r; y++) for (let x = bx - r; x <= bx + r; x++) {
      const d = Math.hypot(x - bx, (y - by) * 1.1) / r;
      if (d >= 1 || x < 0 || y < 0 || x >= cols || scene.solid[y * cols + x]) continue;
      const g = 1 - d;
      if (g * g * (scene.dark ? 1.0 : 0.3) > bayer(x, y)) put(x, y, mix(under(x, y), st.glow, scene.dark ? 0.14 + g * 0.34 : 0.45));
    }
    sprite.forEach((row, ry) => [...row].forEach((ch, rx) => {
      if (ch === '.') return;
      const top = ry === 0 || sprite[ry - 1][rx] === '.' || sprite[ry - 1][rx] === 'B' || sprite[ry - 1][rx] === 'L';
      const c = ch === 'B' ? (on ? st.core : mix(st.core, st.glow, 0.5)) : ch === 'L' ? mix(C.frame, st.glow, 0.3) : ch === 'P' ? C.pole : top ? mix(C.frameRim, st.glow, on ? 0.7 : 0.45) : C.sil;
      put(x0 + rx, yTop + ry, c);
    }));
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
  let timer = 0, step = 0, observed = null, lastStep = -1, lampSig = '', previewLamps = null;
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
    canvas = null; ctx = null; scene = null; low = null; img = null; lastStep = -1; lampSig = '';
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
    scene = buildScene({cols, rows, band, dark: isDark(), home, lamps, quiet, dim: home ? 0 : 0.5});
    scene.dark = isDark();
    low = document.createElement('canvas');
    low.width = cols; low.height = rows;
    lowCtx = low.getContext('2d');
    img = lowCtx.createImageData(cols, rows);
    view = {cols, rows, cellDev};
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
    preview(list) { previewLamps = Array.isArray(list) ? list.slice() : null; if (canvas) { layout(); draw(true); } },
    sync,
  });
})();
