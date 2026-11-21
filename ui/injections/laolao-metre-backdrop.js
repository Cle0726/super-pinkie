/* laolao-metre-backdrop —— Metre 首页 / 对话页底部的像素画带（11-15 第十一稿「谱台灯」；11-16 第十二稿：细节 + 地面波纹）。
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
 *   光：主光是舞台口的冷光（从远处正前方来，离舞台口越远越暗），局部光是各盏谱台灯（从上往下、各自的颜色）。
 *   后墙是规整的竖向吸音木条 + 凸起的护墙嵌板（斜面朝舞台口受光）；舞台里有天幕渐变、吊杆灯和光锥、透视的台板；
 *   谱台三种大小，近排的谱纸有厚度、翻起的页角、夹子，灯罩有弧度；地板是朝舞台口收拢的打蜡木条，倒着后墙和舞台口。
 *   静的那一层分两份：完整的一张（buf）和「拿掉谱台、椅子、指挥台」的一张（base），东西各自记成一组（obj / groups）——
 *   点击的波纹要让地面起伏、东西跟着上下，就靠这个分层。
 * 浅色主题不是把深色反相：是谱纸上的墨线版——暖白底、墨色剪影、灯是钴蓝的点。
 * 资源（批 6「不留常驻动画」）：只在 Metre 的对话页 / 首页、窗口可见时跑；一个 setTimeout 每半拍走一步，只重画会动的那几行；
 *   标志页开着时停；减少动态效果时只画一帧。不在 Metre 时画布直接拿掉，根元素上的 data-pk-metre-backdrop 也拿掉。 */
(() => {
  'use strict';
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (G.__pinkieMetreBackdrop) return;
  const BPM = 72;
  const STEP = 60_000 / BPM / 2;          // 半拍走一步
  const CELL = 2;                         // 一格 2 个 CSS 像素
  const RIPPLE_MS = 1300, RIPPLE_FRAME = 16;  // 点击的水波：一共多久；窗口在后台时退回定时器的一帧多久（前台跟屏幕刷新走）

  // ---------- 小工具 ----------
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const pack = (c) => ((255 << 24) | (Math.round(c[2]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[0])) >>> 0;   // ImageData 是小端 ABGR
  const unpack = (v, bg) => (v ? [v & 255, (v >> 8) & 255, (v >> 16) & 255] : bg);
  const mod = (a, n) => ((a % n) + n) % n;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------- 颜色 ----------
  // 每种材质 4–6 级。深色：夜里的排练厅，暖光来自指挥台的灯，冷光来自舞台口。浅色：谱纸上的墨线版（不是反相）。
  const PALETTES = {
    dark: {
      bg: '#151514', hall1: '#17171A', hall2: '#191A1F', hall3: '#1C1D25', wall: '#22232D', rail: '#2A2C38',
      f0: '#1D1E24', f1: '#19191F', f2: '#141519', seam: '#0B0B0E', edge: '#30323E', edgeLo: '#08080A',
      slat0: '#1A1B22', slat1: '#1F2029', slat2: '#262834', slat3: '#2F3243', slatGap: '#0F1014', bevHi: '#383B4D', bevLo: '#0F1014',
      arch: '#2B2C38', archHi: '#474A62', archLo: '#191A21',
      st0: '#1B1D2A', st1: '#252940', st2: '#333A5C', st3: '#4A548A', st4: '#6873B0',
      cu0: '#0D0E18', cu1: '#161A2C', cu2: '#212642', cu3: '#30386A', fringe: '#7A7458',
      lip: '#30323F', lipHi: '#5E6384', footCore: '#EEF1FF', hood: '#09090C',
      sil: '#060608', silRim: '#6A72A6', silFace: '#15172A',
      frame: '#141419', frameHi: '#4E5060', frameLo: '#09090C', pole: '#22222A', poleHi: '#5C5E72', poleLo: '#0C0C10', lampHood: '#26272F',
      cat: '#060607', cat2: '#101015', cat3: '#1C1C25', warmHi: '#D8C99A', warmMid: '#7A6E50', warmLo: '#352F23',
      coolRim: '#4C557E', coolDim: '#262A3E', eye: '#7F97F5', eyeHi: '#EAF0FF', eyeLo: '#3F58C4', pupil: '#0A0E24', nose: '#34313A',
      whiskIn: '#4A473C', whiskOut: '#55524A',
      podTop: '#4A4030', podTopLo: '#221E17', podFace: '#15120F', podFaceHi: '#2B251C', podFaceLo: '#090807', podTrim: '#5E5239',
      glint: '#97A3E2', drop: '#EEF1FF', shade: '#000000', paper: '#FFFFFF',
      off: {hi: '#2B2B32', mid: '#25252B', lo: '#1F1F24', line: '#35353E', ink: '#40404B', core: null, glow: null},
      run: {hi: '#DCE3FF', mid: '#AEBAF4', lo: '#7785D0', line: '#6373BE', ink: '#232C66', core: '#F4F6FF', glow: '#93A5EE'},
      done: {hi: '#BBB39D', mid: '#938D7E', lo: '#6C675A', line: '#5E5A50', ink: '#2C2923', core: '#E8DEC2', glow: '#8C8470'},
      fail: {hi: '#C96A53', mid: '#9E4E3B', lo: '#703628', line: '#5A2A1F', ink: '#280F0A', core: '#F28E72', glow: '#B4513B'},
      lead: {core: '#FFF6DC', glow: '#D9CDA8'},
    },
    light: {
      bg: '#F7F6F3', hall1: '#F5F3EF', hall2: '#F2F0EA', hall3: '#EEEBE4', wall: '#E2DDD2', rail: '#D2CCBF',
      f0: '#EEEBE3', f1: '#E9E5DC', f2: '#E3DFD5', seam: '#CDC7BA', edge: '#9C9587', edgeLo: '#D6D1C5',
      slat0: '#E4E0D6', slat1: '#E9E5DD', slat2: '#EEEBE5', slat3: '#F4F2ED', slatGap: '#CFC9BC', bevHi: '#FCFBF8', bevLo: '#BDB6A7',
      arch: '#8A8478', archHi: '#5A554C', archLo: '#B9B2A3',
      st0: '#E0DBCF', st1: '#E9E5DB', st2: '#F1EEE6', st3: '#FCFBF8', st4: '#FFFFFF',
      cu0: '#4A463F', cu1: '#6B665C', cu2: '#8F887B', cu3: '#B4AD9F', fringe: '#2B2925',
      lip: '#A39C8D', lipHi: '#4A463F', footCore: '#2F4BB0', hood: '#3A3732',
      sil: '#2B2925', silRim: '#77736B', silFace: '#45413B',
      frame: '#4A463F', frameHi: '#77736B', frameLo: '#2B2925', pole: '#5A554C', poleHi: '#9C9587', poleLo: '#3A3732', lampHood: '#3A3732',
      cat: '#1B1A18', cat2: '#252320', cat3: '#33302C', warmHi: '#C9C2B2', warmMid: '#77736B', warmLo: '#4A463F',
      coolRim: '#6B665C', coolDim: '#45413B', eye: '#6C86EA', eyeHi: '#EAF0FF', eyeLo: '#2F4BB0', pupil: '#101633', nose: '#5A554C',
      whiskIn: '#6B665C', whiskOut: '#5A554C',
      podTop: '#D6D0C1', podTopLo: '#C4BDAD', podFace: '#E2DDD2', podFaceHi: '#EDEAE2', podFaceLo: '#BDB6A7', podTrim: '#5A554C',
      glint: '#5A554C', drop: '#2F4BB0', shade: '#8A8478', paper: '#FFFFFF',
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
    {w: 33, dh: 23, lampW: 11, lampH: 4, pole: 3, poleH: 40, legH: 0, n: 3, gap: 2},
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

  /* 画静的那一层。返回 {buf, base, obj, …, anchors}。
   * cols×rows 是整块画布的格数；band 是场景占的行数（贴底），band 上面的行只有大厅的暗（抖动渐变，越往上越接近底色，最上面是透明）。
   * quiet = [x0, x1]：输入框那一栏的格范围（对话页用它把指挥台和舞台口让到两边的空地上）；首页传 null。
   * keepTop：输入框上沿在第几行（对话页「空中」点击的光点落在它上面，不落到输入框后面）。 */
  function buildScene({cols, rows, band, dark, home, lamps = [], quiet = null, dim = 0, flash = -1, keepTop = null}) {
    const C = resolve(dark ? PALETTES.dark : PALETTES.light);
    const N = cols * rows;
    const buf = new Uint32Array(N);                      // 完整的一张；0 = 透明（露出页面底色）
    const base = new Uint32Array(N);                     // 拿掉谱台、椅子、指挥台的一张（波纹从这里取地面）
    const solid = new Uint8Array(N);                     // 实心的东西占了哪些格（光晕不往上盖）
    const obj = new Uint16Array(N);                      // 每格属于哪一组东西（0 = 不属于）
    const groups = [null];
    const y0 = rows - band;                              // 场景顶
    const floorY = y0 + Math.round(band * 0.4);          // 地平线：上面是后墙和舞台口，下面是地板
    const floorH = rows - floorY;
    const fade = (c) => (dim ? mix(c, C.bg, dim) : c);
    const inb = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
    const set = (x, y, c) => { if (inb(x, y)) { const v = pack(fade(c)); buf[y * cols + x] = v; base[y * cols + x] = v; } };
    const hard = (x, y, c) => { if (inb(x, y)) { set(x, y, c); solid[y * cols + x] = 1; } };
    const blend = (x, y, c, a) => {                      // 往已有的颜色上叠一层（两份都叠）
      if (!inb(x, y)) return;
      const i = y * cols + x, f = fade(c);
      buf[i] = pack(mix(unpack(buf[i], C.bg), f, a));
      base[i] = pack(mix(unpack(base[i], C.bg), f, a));
    };
    // 一组东西（一个谱台连它的椅子 / 指挥台）：只画进 buf，记下归属和包围盒
    const group = (info) => { groups.push({id: groups.length, x0: cols, y0: rows, x1: -1, y1: -1, ...info}); return groups.length - 1; };
    const own = (g) => (x, y, c) => {
      if (!inb(x, y)) return;
      const i = y * cols + x, gr = groups[g];
      buf[i] = pack(fade(c)); solid[i] = 1; obj[i] = g;
      if (x < gr.x0) gr.x0 = x; if (x > gr.x1) gr.x1 = x; if (y < gr.y0) gr.y0 = y; if (y > gr.y1) gr.y1 = y;
    };

    // 1. 大厅的暗：从过渡段顶到地平线，底色 → hall1 → hall2 → hall3（画布可以比这高：再往上是透明，空中点击的光点从那里落下来）
    const hall = [null, C.hall1, C.hall2, C.hall3];
    const hy0 = Math.max(0, y0 - Math.round(band * (home ? 0.9 : 0.6)));
    for (let y = hy0; y < floorY; y++) {
      const t = Math.pow((y - hy0) / Math.max(1, floorY - hy0), 1.6) * 3, lo = Math.min(3, Math.floor(t)), frac = t - lo;
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

    // 2. 后墙。光只从舞台口来：离舞台口越近越亮，斜面朝着舞台口的那一侧受光。
    //    上半：规整的竖向吸音木条（4 格一根：3 格面 + 1 格缝），每 7 根一道嵌板缝；亮度按根算（一根一个色，不抖动、不随机），往上抖动着淡进大厅。
    //    中间：腰线（一线高光 + 一线暗缝）。下半：凸起的护墙嵌板，四条斜面一亮一暗。
    const wainTop = floorY - 18, slatTop = floorY - Math.round(band * 0.4) + 2, slatBot = wainTop - 4;
    const wallLit = (x) => Math.max(0, 1 - Math.abs(x - stageX) / (cols * 0.42));
    const SLAT = [C.slat0, C.slat1, C.slat2, C.slat3];
    for (let x = 0; x < cols; x++) {
      const m = mod(x - stageX, 4), si = Math.floor((x - stageX) / 4), joint = mod(si, 7) === 0;
      const lit = wallLit(si * 4 + stageX + 1.5), towardStage = x < stageX ? m === 2 : m === 0;
      for (let y = slatTop; y < slatBot; y++) {
        const up = (y - slatTop) / Math.max(1, slatBot - slatTop);       // 0 顶 → 1 底
        if (up * 2.2 + lit * 0.5 < bayer(x, y) * 0.9 + 0.12) continue;  // 顶上淡进大厅
        let c;
        if (m === 3 || (joint && m === 0)) c = C.slatGap;
        else {
          const lvl = Math.min(3, Math.floor(lit * 3.2 + up * 0.5 + (towardStage ? 0.9 : 0)));
          c = SLAT[Math.max(0, lvl)];
        }
        set(x, y, c);
      }
      set(x, slatBot, C.slatGap);
      set(x, slatBot + 1, lit > 0.25 ? C.bevHi : C.rail);
      set(x, slatBot + 2, C.rail);
      set(x, slatBot + 3, C.bevLo);
      // 护墙嵌板（34 格一块，对齐舞台口的中线）
      const pw = 34, px = mod(x - stageX - 17, pw), pcx = x - px + pw / 2, fromRight = pcx < stageX;
      const plit = wallLit(pcx);
      for (let y = wainTop; y < floorY - 2; y++) {
        const py = y - wainTop;
        let c = plit > 0.45 ? C.wall : C.hall3;
        if (px === 0) c = C.slatGap;
        else if (px >= 3 && px <= pw - 4 && py >= 2 && py <= 12) {
          const hiL = !fromRight, top = py === 2, bot = py === 12, lft = px === 3, rgt = px === pw - 4;
          if (top) c = plit > 0.15 ? C.bevHi : C.rail;
          else if (bot) c = C.bevLo;
          else if (lft) c = hiL && plit > 0.15 ? C.bevHi : C.bevLo;
          else if (rgt) c = !hiL && plit > 0.15 ? C.bevHi : C.bevLo;
          else c = plit > 0.3 ? C.wall : C.hall3;
        }
        set(x, y, c);
      }
      set(x, floorY - 2, C.wall); set(x, floorY - 1, C.rail);
    }

    // 3. 舞台口：一圈框 + 两边束起来的幕布 + 顶上的檐幕 + 吊杆灯 + 天幕 + 透视台板 + 台唇和脚灯 + 像素 M
    const fr = home ? 3 : 2, lipH = home ? 4 : 3, deckH = home ? 6 : 4;
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
    const deckTop = ih - lipH - deckH, battenY = vh + 1;
    const fixtures = [];
    for (let k = 0, n = Math.max(2, Math.round((iw - 2 * cw) / 16)); k < n; k++) fixtures.push(Math.round(stageX + (k - (n - 1) / 2) * ((iw - 2 * cw - 10) / Math.max(1, n - 1))));
    for (let y = ay0; y < floorY; y++) for (let x = ax0; x <= ax1; x++) {
      if (!inArch(x, y)) continue;
      if (!inArch(x, y, fr)) { hard(x, y, !inArch(x, y, 1) ? C.archLo : inArch(x, y, fr - 1) ? C.archHi : C.arch); continue; }
      const lx = x - ix0, ly = y - iy0, t = ly / ih, side = Math.min(lx, iw - 1 - lx);
      if (ly >= ih - lipH) { set(x, y, ly === ih - lipH ? C.lipHi : (lx % 6 === 3 && ly > ih - lipH + 1) ? C.archLo : C.lip); continue; }
      // 檐幕：一串垂下来的弧
      const fx = (lx % sw) / sw, vEdge = vh * (0.55 + 0.45 * (1 - (2 * fx - 1) ** 2));
      if (ly < vEdge) {
        if (ly + 1 >= vEdge) { set(x, y, lx & 1 ? C.fringe : C.cu0); continue; }
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
      // 台板：最里面一线被天幕照亮，往前两档；一道横缝，几道朝台里收拢的竖缝
      if (ly >= deckTop) {
        const dk = ly - deckTop, cen = Math.max(0, 1 - Math.abs(x - stageX) / (iw * 0.5));
        const joint = dk > 0 && Math.abs(mod((x - stageX) * 6 / (dk + 10) + 0.5, 1) - 0.5) * (dk + 10) / 6 < 0.5;
        let c = dk === 0 ? C.st3 : cen > 0.35 ? C.st2 : C.st1;
        if (dk === Math.round(deckH * 0.5) || joint) c = dk === 0 ? C.st2 : C.st1 === c ? C.st0 : C.st1;
        set(x, y, c);
        continue;
      }
      // 吊杆：一根横杆，挂着一排小灯（灯罩两格 + 灯口一格）
      if (ly === battenY) { set(x, y, C.hood); continue; }
      const fxd = fixtures.reduce((best, f) => (Math.abs(x - f) < Math.abs(best) ? x - f : best), 999);
      if (ly === battenY + 1 && Math.abs(fxd) <= 1) { set(x, y, fxd === -1 ? C.archHi : C.hood); continue; }
      if (ly === battenY + 2 && Math.abs(fxd) <= 1) { set(x, y, fxd === 0 ? C.footCore : C.hood); continue; }
      // 天幕：上暗下亮的冷光（5 档、抖动过渡），中间亮两边暗；台面上方一道很窄的地平线亮
      const tt = (ly - battenY) / Math.max(1, deckTop - battenY), centre = Math.max(0, 1 - Math.abs(x - stageX) / (iw * 0.55));
      const lvl = 0.18 + tt * tt * 0.55 + centre * 0.36 + (deckTop - ly <= 2 ? 0.1 : 0);
      set(x, y, ramp([C.st0, C.st1, C.st2, C.st3, C.st4], lvl, x, y));
    }
    // 脚灯：台唇上一排小灯罩，光往台里打
    for (let k = 0; ; k++) {
      const off = 9 + k * 18; if (off > iw / 2 - cw - 6) break;
      for (const fxp of [stageX - off, stageX + off]) {
        const fy = floorY - lipH - 1;
        for (let dx = -1; dx <= 1; dx++) set(fxp + dx, fy, C.hood);
        set(fxp, fy - 1, C.footCore);
        for (let dy = 2; dy <= 4; dy++) for (let dx = -dy; dx <= dy; dx++) if ((1 - dy / 5) * 0.7 > bayer(fxp + dx, fy - dy)) blend(fxp + dx, fy - dy, C.st3, 0.5);
      }
    }
    const logoS = ih - vh - lipH >= 38 ? 3 : ih - vh - lipH >= 24 ? 2 : 1;       // 标志按舞台口的高矮放大（一个标志格 = logoS×logoS 画格）
    const mBase = floorY - lipH - 3;                                                    // M 立在台板中间（台唇往里 2 格）
    const logo = {x: stageX - Math.floor(13 * logoS / 2), y: mBase - 11 * logoS + 1, s: logoS};
    for (let x = logo.x - 3; x < logo.x + 13 * logoS + 3; x++) for (let dy = 1; dy <= 2; dy++) if (bayer(x, dy) < (dy === 1 ? 0.8 : 0.35)) blend(x, mBase + dy, C.sil, 0.55);   // M 落在台板上的影子
    LOGO.forEach((row, ry) => [...row].forEach((ch, rx) => {
      if (ch !== '#') return;
      const topEdge = ry === 0 || LOGO[ry - 1][rx] !== '#', leftEdge = rx === 0 || row[rx - 1] !== '#';
      for (let dy = 0; dy < logoS; dy++) for (let dx = 0; dx < logoS; dx++)
        hard(logo.x + rx * logoS + dx, logo.y + ry * logoS + dy, topEdge && dy === 0 ? C.silRim : leftEdge && dx === 0 ? C.silFace : C.sil);
    }));
    // 节拍器的刻度：底座上一排小刻痕（中间长、两边短）
    if (logoS >= 2) for (let k = -3; k <= 3; k++) { const tx = logo.x + Math.round(6.5 * logoS) + k * logoS - (logoS === 3 ? 1 : 0); set(tx, logo.y + 10 * logoS, C.silRim); if (!k) set(tx, logo.y + 10 * logoS + 1, C.silRim); }

    // 4. 地板：木条朝舞台口收拢（透视），远处的缝抖动着淡掉；两道台阶沿
    const vpx = stageX, vpy = floorY - Math.round(floorH * 0.16), pk = (rows - vpy) / 26;
    const plank = (x, y) => Math.floor(((x - vpx) / (y - vpy)) * pk);
    const FL = [C.f0, C.f1, C.f2];
    for (let y = floorY; y < rows; y++) {
      const d = (y - floorY) / floorH;
      for (let x = 0; x < cols; x++) {
        const i = plank(x, y), h = hash(i + 4096);
        let c = FL[clamp(Math.floor((d + ((h & 3) - 1.5) * 0.1) * 3), 0, 2)];          // 一根木条一个色，按远近分三档（不抖动）
        // 木纹：顺着木条方向的细纹（同一根木条里按 u 偏移取几道），近处才看得清
        const u = ((x - vpx) / (y - vpy)) * pk - i;
        if (d > 0.35 && Math.abs(((u * 5 + (h >>> 5) % 5) % 5) - 2.5) < 0.12 && (y + (h >>> 9)) % 11 < 4) c = mix(c, C.seam, 0.4);
        if (plank(x - 1, y) !== i && d * 2.8 > bayer(x, y)) c = C.seam;
        else if (d > 0.12 && (y === floorY + 4 + (h >>> 3) % floorH || y === floorY + 4 + (h >>> 11) % floorH)) c = C.seam;   // 木条的接头
        set(x, y, c);
      }
    }
    // 上过蜡的台板：后墙和舞台口在地上倒一层淡淡的影（越往近越淡、越碎），木缝把倒影切开
    const reflH = Math.round(floorH * 0.42), seamPk = pack(fade(C.seam));
    for (let dy = 1; dy <= reflH; dy++) {
      const y = floorY + dy, sy = floorY - 1 - Math.round(dy * 1.15), k = (1 - dy / reflH) ** 1.6;
      if (sy < 0) break;
      for (let x = 0; x < cols; x++) {
        const v = buf[sy * cols + x];
        if (!v || buf[y * cols + x] === seamPk) continue;
        const a = k * (dark ? 0.42 : 0.3);
        if (a > bayer(x, y) * 0.9) blend(x, y, unpack(v, C.bg), a);
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
    const drawStand = (cx, baseY, depth, state, seed, put) => {
      const z = STAND_SIZES[depth], st = C[state] || C.off, lit = Boolean(st.glow);
      const H = z.lampH + z.dh + 2 + z.poleH + z.legH, yTop = baseY - H + 1, deskTop = yTop + z.lampH, x0 = cx - (z.w >> 1);
      const far = [0, 0.16, 0.34][depth];
      const tone = (c) => (far ? mix(c, dark ? C.hall3 : C.f0, far) : c);
      const P = (x, y, c) => put(x, y, tone(c));
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
        // 亮着的灯在打过蜡的地板上拖一道竖的倒影（中间实、两边碎，越往下越淡）
        if (z.legH) { const L = Math.round(z.dh * 1.1), hw = z.lampW >> 1;
          for (let dy = 2; dy <= L; dy++) for (let dx = -hw; dx <= hw; dx++) {
            const k = (1 - dy / L) * (1 - Math.abs(dx) / (hw + 1)), x = cx + dx, y = baseY + dy;
            if (inb(x, y) && !solid[y * cols + x] && k * (dark ? 0.95 : 0.6) > bayer(x, y)) blend(x, y, tone(st.glow), dark ? 0.22 + k * 0.3 : 0.4);
          } }
      }
      // 夹在谱板上沿的小灯。近排：有弧度的灯罩（顶一线高光、左亮右暗、下沿一圈被灯照亮）+ 灯口；中、远排：灯罩两行 + 灯口一行
      const lw = z.lampW >> 1;
      if (z.lampH === 4) {
        for (let dx = -lw + 3; dx <= lw - 3; dx++) P(cx + dx, yTop, dx <= -lw + 4 ? C.poleHi : C.lampHood);
        for (let dx = -lw + 1; dx <= lw - 1; dx++) P(cx + dx, yTop + 1, dx === -lw + 1 ? C.poleHi : dx === lw - 1 ? C.poleLo : dx < -1 ? mix(C.lampHood, C.poleHi, 0.35) : C.lampHood);
        for (let dx = -lw; dx <= lw; dx++) P(cx + dx, yTop + 2, lit ? mix(C.lampHood, st.glow, dx === -lw || dx === lw ? 0.25 : 0.6) : dx === -lw ? C.frameHi : dx === lw ? C.poleLo : C.lampHood);
        for (let dx = -lw + 1; dx <= lw - 1; dx++) P(cx + dx, yTop + 3, st.core || C.frameLo);
      } else {
        if (z.lampH === 3) for (let dx = -lw + 1; dx <= lw - 1; dx++) P(cx + dx, yTop, dx === -lw + 1 ? C.poleHi : C.lampHood);
        for (let dx = -lw; dx <= lw; dx++) P(cx + dx, deskTop - 2, lit ? mix(C.lampHood, st.glow, dx === -lw ? 0.6 : 0.3) : dx === -lw ? C.frameHi : C.lampHood);
        for (let dx = -lw + 1; dx <= lw - 1; dx++) P(cx + dx, deskTop - 1, st.core || C.frameLo);
      }
      // 谱板：框（上、左受光，下、右背光）+ 两页谱纸，中间一道折缝
      const pw = (z.w - 3) >> 1, unit = 2 * z.n - 1 + z.gap, near = depth === 0, ear = near ? 4 : depth === 1 ? 3 : 0;
      for (let ry = 0; ry < z.dh; ry++) for (let rx = 0; rx < z.w; rx++) {
        const x = x0 + rx, y = deskTop + ry;
        if (ry === 0) { P(x, y, lit ? mix(C.frameHi, st.glow, 0.55) : C.frameHi); continue; }
        if (ry === z.dh - 1) { P(x, y, C.frameLo); continue; }
        if (rx === 0) { P(x, y, C.frameHi); continue; }
        if (rx === z.w - 1) { P(x, y, C.frame); continue; }
        if (x === cx) { P(x, y, mix(st.lo, st.ink, 0.35)); continue; }
        // 右上角翻起的页角：角被折下去露出谱板，折过来的那一小块是纸背（亮），折线一道暗
        if (ear) { const ei = z.w - 2 - rx, ej = ry - 1;
          if (ei >= 0 && ej >= 0 && ei + ej < ear) { P(x, y, C.frame); continue; }
          if (ei >= 0 && ej >= 0 && ei + ej === ear) { P(x, y, mix(st.lo, st.ink, 0.25)); continue; }
          if (ei >= 0 && ej >= 0 && ei + ej <= ear + (near ? 2 : 1) && ei < ear + 1 && ej < ear + 1 && ei > 0 && ej > 0) { P(x, y, st.hi); continue; } }
        // 近排：纸有厚度——右页右边、两页底下各露一线下面那张纸的边
        if (near && (rx === z.w - 2 || ry === z.dh - 2)) { P(x, y, mix(st.lo, st.line, 0.5)); continue; }
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
      // 近排：谱板上沿正中一个夹子（压住两页纸）
      if (near) { for (let dx = -1; dx <= 1; dx++) { P(cx + dx, deskTop, dx < 1 ? C.poleHi : C.pole); P(cx + dx, deskTop + 1, dx === -1 ? C.pole : C.poleLo); } }
      // 托谱的沿
      const ly = deskTop + z.dh;
      for (let rx = 0; rx < z.w; rx++) P(x0 + rx, ly, lit ? mix(C.frameHi, st.glow, 0.25) : C.frameHi);
      for (let rx = 1; rx < z.w - 1; rx++) P(x0 + rx, ly + 1, C.frameLo);
      // 立杆（左亮右暗）+ 锁紧的箍 + 三脚
      const py0 = ly + 2, legTop = baseY - z.legH + 1;
      for (let y = py0; y <= baseY; y++) {
        if (z.pole === 3) { P(cx - 1, y, C.poleHi); P(cx, y, C.pole); P(cx + 1, y, C.poleLo); } else P(cx, y, mix(C.pole, C.poleHi, 0.5));
      }
      if (z.pole === 3) { const cy = py0 + Math.round((Math.min(legTop, rows) - py0) * 0.42); for (let dx = -2; dx <= 2; dx++) { P(cx + dx, cy, C.poleHi); P(cx + dx, cy + 1, dx === 2 ? C.poleLo : C.pole); } }
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
    // 谱台后面（我们这一侧）的乐手椅：只看得到椅背、座沿和四条腿；椅背顶上那条边接住谱台灯的光
    const drawChair = (cx, base, depth, state, put) => {
      const st = C[state] || C.off, lit = Boolean(st.glow);
      const far = [0, 0.16, 0.34][depth];
      const tone = (c) => (far ? mix(c, dark ? C.hall3 : C.f0, far) : c);
      const P = (x, y, c) => put(x, y, tone(c));
      const w = depth === 1 ? 13 : 9, backH = depth === 1 ? 7 : 5, legH = depth === 1 ? 5 : 3;
      const x0 = cx - (w >> 1), x1 = x0 + w - 1, seatY = base - legH, top = seatY - backH;
      for (let x = x0 - 1; x <= x1 + 1; x++) if (bayer(x, base + 1) < 0.6) blend(x, base + 1, C.seam, 0.7);   // 影子
      for (let y = top; y < seatY; y++) for (let x = x0; x <= x1; x++) {
        const ry = y - top, rx = x - x0;
        if (ry === 0 && (rx === 0 || rx === w - 1)) continue;                                 // 圆角
        const c = ry === 0 ? (lit ? mix(C.frameHi, st.glow, 0.6) : C.frameHi)
          : rx === 0 ? C.frameHi : rx === w - 1 ? C.frameLo
          : ry === 1 && lit ? mix(C.frame, st.glow, 0.25)
          : (rx % 4 === 2 && ry > 1 && ry < backH - 1) ? C.frameLo : C.frame;                 // 椅背上的竖条
        P(x, y, c);
      }
      for (let x = x0 - 1; x <= x1 + 1; x++) P(x, seatY, x === x0 - 1 ? C.poleHi : C.poleLo); // 座沿
      for (let y = seatY + 1; y <= base; y++) {
        P(x0, y, C.pole); P(x1, y, C.poleLo);                                                 // 后腿
        if (y > seatY + 1) { P(x0 + 2, y, C.poleLo); P(x1 - 2, y, C.poleLo); }                // 前腿（远一点、暗一点）
      }
    };
    const paintRow = (depth) => slots.forEach((s, i) => {
      if (s.depth !== depth) return;
      const z = STAND_SIZES[depth];
      s.lamp = {x: s.cx, y: s.base - (z.lampH + z.dh + 2 + z.poleH + z.legH) + 1 + z.lampH - 1, w: z.lampW, depth};
      const g = group({kind: 'stand', cx: s.cx, foot: s.base, order: depth ? s.base + 1 : s.base, lim: depth === 2 ? 2 : 3, slot: s, lamp: s.lamp, state: s.state});
      const put = own(g);
      drawStand(s.cx, s.base, s.depth, s.state, i + 1, put);
      if (depth) drawChair(s.cx, s.base + 1, depth, s.state, put);
    });
    paintRow(2);
    paintRow(1);

    // 6. 指挥台：木台子（台面受灯光，正面有嵌板）；背对我们的谱台在 paintMoving 里画（它的灯会跳）
    const podW = 58, podH = home ? 12 : 9, podBase = rows - 3, podTop = podBase - podH + 1, px0 = podX - (podW >> 1);
    const lead = {cx: podX, base: podTop + 1};
    const gPod = group({kind: 'podium', cx: podX, foot: podBase, order: podBase, lim: 1});
    const podPut = own(gPod);
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
      podPut(x, y, c);
    }
    paintRow(0);

    // 波纹要用的：地面的相机（和木条同一个灭点）、光源、画家顺序
    // 点击的水波要用的：地面的相机（和木条同一个灭点）、光源、画家顺序
    const Dm = rows - vpy, geo = {vpx, vpy, Dm, f: 1.5 * Dm};
    const toFloor = (x, y) => { const d = Math.max(1, y - vpy); return {X: (x - vpx) * Dm / d, Z: geo.f * Dm / d}; };
    const lights = [];
    const addLight = (x, y, col, ink, I, rad, stage = false) => lights.push({...toFloor(x, y), x, col, ink, I, rad, stage});
    addLight(stageX, floorY, C.glint, C.glint, 1, 0, true);
    addLight(podX, podBase, C.lead.glow, C.lead.core, 0.9, 80);
    for (const s of slots) { const st = C[s.state]; if (st && st.glow) addLight(s.cx, Math.min(s.base, rows + 30), st.glow, st.core, s.state === 'done' ? 0.55 : 0.8, 60); }
    const paintOrder = groups.slice(1).sort((a, b) => a.order - b.order).map((g) => g.id);
    const landY = floorY + Math.round(floorH * (home ? 0.5 : 0.45));
    return {buf, base, obj, groups, cols, rows, C, dim, dark, solid,
      anchors: {logo, lead, floorY, floorH, y0, hy0, stageX, podX, slots, quiet, keepTop, landY, geo, lights, paintOrder, gPod}};
  }

  /* 会动的两样，叠在静的那一层上：指挥台的灯（每拍亮一下、半拍收回一格）和节拍器的摆锤（左-中-右-中，一根摆杆连到底部的支点）。
   * put(x, y, [r,g,b]) 由调用方给（它负责 dim 和越界）。step 是半拍数；still = 减少动态效果；leadDy = 指挥台被波纹顶起 / 落下几格。 */
  function paintMoving(scene, step, still, put, under, leadDy = 0) {
    const {C, dark, cols, anchors: {logo, lead: lead0}} = scene;
    const lead = leadDy ? {cx: lead0.cx, base: lead0.base + leadDy} : lead0;
    // 摆锤和摆杆
    const phase = still ? 1 : step % 4;
    const bobX = logo.x + Math.round((6 + [0, 0.5, 1, 0.5][phase]) * logo.s);
    const pivX = logo.x + Math.round(6.5 * logo.s) - 1, pivY = logo.y + 6 * logo.s, topY = logo.y + 5 * logo.s;
    const rodX = bobX + logo.s - 1;
    for (let y = topY; y < pivY; y++) put(Math.round(rodX + (pivX - rodX) * (y - topY) / Math.max(1, pivY - topY)), y, C.silRim);
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

  /* ---------- 点一下 =「一个音落进水里」（11-16 定稿，标准见 RIPPLE-DETAIL-PLAN-1116.md §A‴） ----------
   * 点哪里都有，效果就在点的地方：落点先是一个像素符头砸下去，砸出一圈 3D 水波，水里跳出两三颗像素音符往上飘、晃、抖动着散掉。
   * 水波（两种，同一种材质）：
   *   地板上：地面是一个真的平面，和木条同一个灭点的针孔相机。屏幕行离灭点 d 格，最底行 d = Dm；深度 Z = f·Dm/d；
   *     横向在每个波自己的正对坐标里算：(x − 落点x)·Dm/d。近大远小、远处更扁更细更慢，全由投影得到（落点越远波做得越大，免得看不见）。
   *   地板以上（大厅、后墙、舞台口）：同样的波、固定扁度的椭圆——整块背景像一层深色的水面。
   * 波 = 高度场：「墨西哥帽」波包（一圈隆起，前后各一道凹），一个十六分音符后再跟一圈小的；多次点击直接相加。
   * 画法：从远到近（从上到下）一行行重画，每个像素按自己那点的高度抬起来，空当用近的那行填；近处的波峰抬起来会盖住后面的东西。
   *   地板上谱台、椅子、指挥台按脚的深度插进这个顺序里，跟着脚下的地面上下动；波峰扫过谁的脚，谁的灯闪一下。
   *   明暗按坡度：光从远处（舞台口 / 上方）来，朝光的坡推向光的颜色（地板上还有各盏灯各自的颜色），背光的坡压暗；不抖动，弱了色带自己变细消失。
   * 音符第一颗钴蓝，其余墨色；每颗在水面上有一个倒着的淡影子。 */
  const RIP = {speed: 0.12, ease: 1400, sigma: 5.5, amp: 4.4, spread: 24, decay: 700, lag: 208, second: 0.55, gain: 3.4, lift: 0.55};
  const HEAD_MS = 90;   // 符头落下来要 90ms，落进去那一刻才起波
  // rp.k：波在地面上做多大（地板上 k = √(Dm/d)，1..2.2）
  function waveOf(rp, a) {
    const k = rp.k || 1;
    const env = Math.min(1, a / 60) * Math.exp(-a / RIP.decay) * (1 - (a / RIPPLE_MS) ** 4);
    const R0 = k * RIP.speed * RIP.ease * (1 - Math.exp(-a / RIP.ease));
    const a1 = a - RIP.lag, k1 = a1 > 0 ? RIP.second * Math.min(1, a1 / 60) : 0;
    const R1 = a1 > 0 ? k * RIP.speed * RIP.ease * (1 - Math.exp(-a1 / RIP.ease)) : 0;
    const sig = k * RIP.sigma * (1 + a / 1600);
    return {sx: rp.sx, sy: rp.sy, Z: rp.Z, A: RIP.amp * (rp.amp || 1) * env * k ** 1.25, env, R0, R1, k1, sig, sp: RIP.spread * k, reach: R0 + 4.5 * sig};
  }
  // 一个波在半径 r 处：高度 WH、对 r 的导数 WD、离主波峰多近 WC——写进这三个变量，不分配数组（每帧要算几万次）
  let WH = 0, WD = 0, WC = 0;
  function waveAt(w, r) {
    const S = 1 / Math.sqrt(1 + r / w.sp), dS = -S / (2 * (w.sp + r));
    let p = 0, dp = 0, crest = 0;
    const u0 = (r - w.R0) / w.sig;
    if (u0 > -4.5 && u0 < 4.5) { const e = Math.exp(-u0 * u0 / 2); p += (1 - u0 * u0) * e; dp += e * (u0 * u0 * u0 - 3 * u0) / w.sig; crest = e * e; }
    if (w.k1) { const u1 = (r - w.R1) / w.sig; if (u1 > -4.5 && u1 < 4.5) { const e = Math.exp(-u1 * u1 / 2); p += w.k1 * (1 - u1 * u1) * e; dp += w.k1 * e * (u1 * u1 * u1 - 3 * u1) / w.sig; } }
    WH = w.A * S * p; WD = w.A * (dS * p + S * dp); WC = crest * w.env * S;
  }
  // 按受光量 lv 给一个像素上色（地板和地板以上共用）
  function shadeTo(scene, src, lv, Lc, ink, lc) {
    const {C, dark} = scene;
    if (lv > 0.12) {
      if (dark) return pack(lv > 0.72 ? mix(Lc, C.paper, 0.3) : lv > 0.4 ? mix(src, Lc, 0.72) : mix(src, Lc, 0.38));
      return pack(lv > 0.95 ? mix(src, lc(ink), 0.5) : lv > 0.4 ? lc(C.paper) : mix(src, lc(C.paper), 0.6));   // 墨线版：亮面纸白，最陡的朝光坡落一道淡墨
    }
    if (lv < -0.3) return pack(dark ? mix(src, C.shade, lv < -0.75 ? 0.45 : 0.25) : mix(src, C.shade, lv < -0.75 ? 0.42 : 0.24));
    return null;
  }

  // 地板上的水波：out 先整张换成 base，再一行行把地面和东西画回去。没有地板上的波返回 null，不碰 out。
  function paintRipples(scene, ripples, now, out) {
    const {C, cols, rows, buf, base, obj, groups, dark, dim, anchors: {floorY, geo, lights, paintOrder, gPod}} = scene;
    const {vpy, Dm, f} = geo;
    const waves = [], taps = new Map();
    for (const rp of ripples) {
      const a = now - rp.t0;
      if (rp.air || a <= 0 || a > RIPPLE_MS) continue;
      waves.push(waveOf(rp, a));
      if (rp.group && a < 420) taps.set(rp.group, Math.max(taps.get(rp.group) || 0, 1 - a / 420));
    }
    if (!waves.length) return null;
    out.set(base);
    const bg = C.bg, wd = dim ? dim * 0.4 : 0;
    const lc = (c) => (wd ? mix(c, bg, wd) : c);
    // 每个波在它自己的「正对着看」的坐标里算：横向 = 和落点的屏幕横距 ÷ 这一行的缩放（不然落点离灭点很远时，圈会顺着木条拉成长条）
    const heightAt = (x, sc, Z) => {
      let h = 0, crest = 0;
      for (const w of waves) { const r = Math.hypot((x - w.sx) / sc, Z - w.Z); if (r > w.reach) continue; waveAt(w, r); h += WH; crest += WC; }
      return [h, crest];
    };
    // 东西跟着脚下的地面动多少格；波峰扫过时灯闪多亮
    const dyOf = new Int8Array(groups.length), flashOf = new Float32Array(groups.length);
    for (const id of paintOrder) {
      const g = groups[id], d = Math.max(1, g.foot - vpy), [h, crest] = heightAt(g.cx, d / Dm, f * Dm / d);
      dyOf[id] = -clamp(Math.round(h * d / Dm), -g.lim, g.lim);
      flashOf[id] = Math.max(taps.get(id) || 0, clamp((crest - 0.12) * 2.2, 0, 1));
    }
    const paintGroup = (id) => {
      const g = groups[id], dy = dyOf[id];
      for (let y = g.y0; y <= g.y1; y++) {
        const ty = y + dy; if (ty < 0 || ty >= rows) continue;
        for (let x = g.x0, i = y * cols + g.x0; x <= g.x1; x++, i++) if (obj[i] === id) out[ty * cols + x] = buf[i];
      }
      const p = flashOf[id];
      if (p > 0.05 && g.lamp) {                                           // 灯闪一下：灯口变亮 + 一圈小光晕
        const st = C[g.state] && C[g.state].glow ? C[g.state] : C.tap, {x: lx, w: lw} = g.lamp, ly = g.lamp.y + dy, hw = lw >> 1, gr = 3 + hw + Math.round(p * 3);
        const core = lc(st.core), glow = lc(st.glow);
        for (let y = ly - gr; y <= ly + gr; y++) for (let x = lx - gr; x <= lx + gr; x++) {
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          const i = y * cols + x;
          if (y === ly && Math.abs(x - lx) < hw) { out[i] = pack(mix(unpack(out[i], bg), core, Math.min(1, p * 1.4))); continue; }
          const sy = y - dy; if (sy >= 0 && sy < rows && obj[sy * cols + x]) continue;
          const gg = 1 - Math.hypot(x - lx, (y - ly) * 1.2) / gr;
          if (gg > 0 && gg * gg * p * 1.5 > bayer(x, y)) out[i] = pack(mix(unpack(out[i], bg), glow, (dark ? 0.3 : 0.5) + gg * 0.3));
        }
      }
    };
    const E = 8, lastY = new Int32Array(cols).fill(floorY - 1), stageL = lights[0];
    let gi = 0, top = floorY - 1;
    for (let ys = floorY; ys < rows + E; ys++) {
      const sy = Math.min(rows - 1, ys), d = ys - vpy, sc = d / Dm, Z = f / sc;
      let xa = cols, xb = -1;
      for (const w of waves) {
        const dz = Z - w.Z; if (Math.abs(dz) >= w.reach) continue;
        const half = Math.sqrt(w.reach * w.reach - dz * dz);
        xa = Math.min(xa, Math.floor(w.sx - half * sc)); xb = Math.max(xb, Math.ceil(w.sx + half * sc));
      }
      xa = Math.max(0, xa); xb = Math.min(cols - 1, xb);
      const rowLights = xb >= xa ? lights.filter((L) => L.stage || Math.abs(L.Z - Z) < L.rad) : lights;
      // 这一行受光最多能有多少：坡太缓、抬得太少，明暗一定落在「不改色」那一档，就不用一盏盏灯算
      let wTot = 0; for (const L of rowLights) wTot += L.stage ? 1 : L.I;
      const liftK = RIP.lift / (RIP.amp * sc ** -0.6);
      for (let x = 0; x < cols; x++) {
        let c = base[sy * cols + x], yi = ys;
        if (x >= xa && x <= xb) {
          let h = 0, gX = 0, gZ = 0, any = false;
          for (const w of waves) {
            const dx = (x - w.sx) / sc, dz = Z - w.Z, r = Math.hypot(dx, dz);
            if (r > w.reach) continue;
            waveAt(w, r);
            if (WH === 0 && WD === 0) continue;
            any = true; h += WH;
            if (r > 1e-3) { gX += WD * dx / r; gZ += WD * dz / r; }
          }
          const lift = liftK * h;
          if (any && RIP.gain * Math.hypot(gX, gZ) * wTot + Math.abs(lift) < 0.12) { any = false; yi = Math.round(ys - h * sc); }
          if (any) {
            yi = Math.round(ys - h * sc);
            // 受光：舞台口（远处正前方，离舞台口越远越弱）+ 每盏亮着的灯（按地面距离衰减），各自的颜色
            let v = 0, wr = 0, cr = 0, cg = 0, cb = 0, ink = null, inkW = 0;
            for (const L of rowLights) {
              const lx = (L.x - x) / sc, lz = L.Z - Z, len = Math.hypot(lx, lz) || 1;
              const wgt = L.stage ? 0.4 + 0.6 * Math.max(0, 1 - Math.abs(x - L.x) / (cols * 0.5)) : L.I * Math.max(0, 1 - len / L.rad) ** 2;
              if (wgt <= 0) continue;
              const facing = -(gX * lx + gZ * lz) / len;
              v += wgt * facing;
              if (facing > 0) { const k = wgt * facing; wr += k; cr += L.col[0] * k; cg += L.col[1] * k; cb += L.col[2] * k; if (k > inkW) { inkW = k; ink = L.ink; } }
            }
            v = v * RIP.gain + lift;   // 高处受光多、低处被挡
            const shaded = shadeTo(scene, unpack(c, bg), v, lc(wr ? [cr / wr, cg / wr, cb / wr] : stageL.col), ink || C.glint, lc);
            if (shaded != null) c = shaded;
          }
        }
        const ly = lastY[x];
        if (yi > ly) { for (let y = Math.max(ly + 1, 0); y <= Math.min(yi, rows - 1); y++) out[y * cols + x] = c; }
        else if (yi >= 0 && yi < rows) out[yi * cols + x] = c;
        if (yi < top) top = yi;
        lastY[x] = yi;
      }
      while (gi < paintOrder.length && groups[paintOrder[gi]].order <= ys) paintGroup(paintOrder[gi++]);
    }
    while (gi < paintOrder.length) paintGroup(paintOrder[gi++]);
    for (const id of paintOrder) if (dyOf[id] < 0) top = Math.min(top, groups[id].y0 + dyOf[id]);
    return {top: Math.max(0, top), leadDy: dyOf[gPod] || 0};
  }

  /* 地板以上：「一个音落在谱纸上」。这一片是正对着我们的一张平面（大厅的暗、后墙、舞台口），点一下：
   *   符头从我们这边飞向纸面 → 落上去的一刻，藏在黑里的谱纸（五线 + 小节线）显出来，被压成一个漏斗形的坑（谱线往坑里收拢）→
   *   纸弹回来鼓成一个包，把符头弹成 ♪ 飞走 → 一圈圈正圆的涟漪荡开，谱纸跟着隐回黑里。
   *   坑 = 「重力井」1/(1+r²)；画法：坑按透视放缩（陷下去的缩小、鼓起来的放大），涟漪按坡度像透镜一样把后面的线推开；
   *   光从左上来，受光坡推亮、背光坡压暗、越深越暗，不抖动。谱台、椅子、指挥台在纸前面，不被弯；在地平线（墙和地板的交线）截断。 */
  const SHEET = {s: 12, Rw: 58, Hw: 12, T: 240, tau: 280, Dz: 16, launch: 170, Rs: 12, Hr: 3.4, sig: 4, sp: 30, kr: 4.2, kh: 1.3, gR: 1.15, gW: 2.4, ao: 0.1, note: 300};
  const STAFF = {gap: 3, lines: 5, period: 22, bar: 28};
  // 谱纸上 (qx, qy) 这一格（一格盖住 span 格谱纸）有没有线：五线（线距 3，一组 5 线，周期 22）+ 小节线（每 28 格，只在五线之间）
  function staffHit(qx, qy, span) {
    const tol = 0.5 + Math.max(0, span - 1) / 2, top = (STAFF.lines - 1) * STAFF.gap, m = mod(qy, STAFF.period);
    for (let k = 0; k <= top; k += STAFF.gap) { const d = Math.abs(m - k); if (d < tol || STAFF.period - d < tol) return true; }
    if (m > top + tol && m < STAFF.period - tol) return false;
    const b = mod(qx, STAFF.bar);
    return b < tol || STAFF.bar - b < tol;
  }
  // 一次空中点击在 a 毫秒时的样子：坑有多深（wc > 0 往里陷，< 0 鼓出来）、两圈涟漪、谱纸显出多大
  function sheetOf(rp, a) {
    const S = SHEET, end = 2.5 * S.T;
    const wc = a > 0 && a < end ? Math.sin(Math.PI * a / S.T) * Math.exp(-a / S.tau) * Math.min(1, (end - a) / 120) : 0;
    const b = a - S.launch, ring = (bb) => S.Rs + RIP.speed * RIP.ease * (1 - Math.exp(-bb / RIP.ease));
    const env = b > 0 ? Math.min(1, b / 80) * Math.exp(-b / 650) * Math.max(0, 1 - (a / RIPPLE_MS) ** 4) : 0;
    const b1 = b - RIP.lag, k1 = b1 > 0 ? RIP.second * Math.min(1, b1 / 60) : 0;
    const sig = S.sig * (1 + Math.max(0, b) / 1600), R0 = b > 0 ? ring(b) : 0;
    // 谱纸显出来的地方跟着波走：坑压下去时坑口那一块全显（弹起后 150ms 收掉）；之后只在两圈波峰附近显（波推到哪、纸亮到哪），
    //   波峰里面留一层半显的、随涟漪一起淡——涟漪走完，谱纸也隐回黑里，不留一块不动的谱纸。
    const dent = a < S.launch + 120 ? Math.min(1, a / 50) : Math.max(0, 1 - (a - S.launch - 120) / 150);
    const ringVis = clamp((env - 0.12) * 3, 0, 1), inner = 0.55 * clamp((env - 0.3) * 2.5, 0, 1);
    return {sx: rp.sx, sy: rp.sy, wc, env, A: S.Hr * env, R0, R1: b1 > 0 ? ring(b1) : 0, k1, sig, sp: S.sp, dent, Rd: S.Rw * 0.6, ringVis, inner,
      // 坑平了、里面那层也淡了以后，两圈波峰里面是空的，不用逐格算
      hole: wc === 0 && inner === 0 && dent === 0 && env > 0 ? (k1 ? ring(b1) : R0) - 7 * sig : 0, reach: Math.max(S.Rw, env > 0 ? R0 + 4.5 * sig : 0)};
  }
  // 谱纸显出来的带：波峰外沿收得快（纸是被波推开的，波前面还是黑的），里沿拖得长
  const bandOf = (u) => (u > 4.5 || u < -7 ? 0 : Math.exp(-u * u / (u > 0 ? 4 : 10)));
  // 坑的形状 G(r) = 1/(1+(r/s)²)，在 Rw 处平滑收到 0；写进 GH（高）、GD（对 r 的导数）
  let GH = 0, GD = 0;
  function wellAt(r) {
    const S = SHEET;
    if (r >= S.Rw) { GH = 0; GD = 0; return; }
    const L = 1 / (1 + (r / S.s) ** 2), q = 1 - (r / S.Rw) ** 2, cut = q * q;
    GH = L * cut; GD = (-2 * r / (S.s * S.s)) * L * L * cut - L * 4 * q * r / (S.Rw * S.Rw);
  }
  function paintSheet(scene, ripples, now, out) {
    const {C, cols, dark, dim, obj, base, anchors: {floorY}} = scene, S = SHEET;
    const waves = [];
    for (const rp of ripples) { const a = now - rp.t0; if (rp.air && a > 0 && a <= RIPPLE_MS) waves.push(sheetOf(rp, a)); }
    if (!waves.length) return null;
    const bg = C.bg, wd = dim ? dim * 0.4 : 0, lc = (c) => (wd ? mix(c, bg, wd) : c);
    const fade = (c) => pack(dim ? mix(c, bg, dim) : c);
    const voids = new Set([0, fade(C.bg), fade(C.hall1), fade(C.hall2), fade(C.hall3)]);
    const line = lc(dark ? mix(bg, C.glint, 0.28) : mix(bg, C.frame, 0.34)), lineHalf = lc(dark ? mix(bg, C.glint, 0.14) : mix(bg, C.frame, 0.17));
    const Lc = lc(C.glint), paper = lc(C.paper), shade = C.shade, Lx = 0.37, Ly = 0.93;
    const lineP = pack(line), lineHalfP = pack(lineHalf), tone = new Map();
    let x0 = cols, x1 = -1, y0 = floorY, y1 = -1;
    for (const w of waves) { x0 = Math.min(x0, Math.floor(w.sx - w.reach)); x1 = Math.max(x1, Math.ceil(w.sx + w.reach)); y0 = Math.min(y0, Math.floor(w.sy - w.reach)); y1 = Math.max(y1, Math.ceil(w.sy + w.reach)); }
    x0 = Math.max(0, x0); x1 = Math.min(cols - 1, x1); y0 = Math.max(0, y0); y1 = Math.min(floorY - 1, y1);
    if (x1 < x0 || y1 < y0) return null;
    const W = x1 - x0 + 1, src = new Uint32Array(W * (y1 - y0 + 1));
    for (let y = y0; y <= y1; y++) src.set(out.subarray(y * cols + x0, y * cols + x1 + 1), (y - y0) * W);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * cols + x;
      if (obj[i]) continue;                                            // 谱台、椅子、指挥台在纸前面
      let h = 0, gx = 0, gy = 0, wx = 0, wy = 0, qx = x, qy = y, span = 1, vis = 0, any = false;
      for (const w of waves) {
        const ux = x - w.sx, uy = y - w.sy, r = Math.hypot(ux, uy);
        if (r > w.reach || r < w.hole) continue;
        if (w.dent > 0 && r < w.Rd) vis = Math.max(vis, w.dent * (r < w.Rd * 0.6 ? 1 : 0.5));
        const u0 = (r - w.R0) / w.sig, u1 = w.k1 ? (r - w.R1) / w.sig : 9;
        if (w.ringVis > 0) vis = Math.max(vis, Math.max(bandOf(u0), bandOf(u1), r < w.R0 ? w.inner : 0) * w.ringVis);
        let hw = 0, dw = 0, hr = 0, dr = 0;
        if (w.wc !== 0 && r < S.Rw) { wellAt(r); hw = -S.Hw * w.wc * GH; dw = -S.Hw * w.wc * GD; }
        if (w.env > 0 && ((u0 > -4.5 && u0 < 4.5) || (u1 > -4.5 && u1 < 4.5))) { waveAt(w, r); hr = WH; dr = WD; }
        if (hw === 0 && dw === 0 && hr === 0 && dr === 0) continue;
        any = true; h += hw + hr;
        const m = 1 + hw / S.Dz;                                         // 坑：陷下去的缩小、鼓起来的放大（透视）
        if (r > 1e-3) {
          const nx = ux / r, ny = uy / r;
          gx += dr * nx; gy += dr * ny; wx += dw * nx; wy += dw * ny;
          // 涟漪：纸面真的跟着起伏——波峰把谱线往外顶、波谷往里收（kh·高度），坡上像透镜一样拉开 / 挤拢（kr·坡度）
          const push = S.kr * dr + S.kh * hr;
          qx += ux * (1 / m - 1) - push * nx; qy += uy * (1 / m - 1) - push * ny;
        }
        span = Math.max(span, 1 / m);
      }
      if (!any && !vis) continue;
      const sx = clamp(Math.round(qx), x0, x1), sy = clamp(Math.round(qy), y0, y1), si = sy * cols + sx;
      let v = obj[si] ? base[si] : src[(sy - y0) * W + (sx - x0)], isLine = false;
      if (vis >= 0.3 && voids.has(v) && staffHit(qx, qy, span)) { isLine = true; v = vis >= 0.75 ? lineP : lineHalfP; }
      let c = v;
      if (any) {
        // 底色按涟漪的坡 + 一点坑的坡受光；谱线按全部的坡受光（坑主要靠谱线的明暗和收拢读出来）；越深越暗
        const lR = (Lx * gx + Ly * gy) * S.gR, lW = (Lx * wx + Ly * wy) * S.gW, lv = isLine ? lR + lW + 0.3 * S.ao * h : dark ? lR + 0.6 * lW + S.ao * h : lR + 0.25 * lW + 0.6 * S.ao * h;
        // 明暗只有几档：同一个底色、同一档的结果记下来，不每格都重新混色
        const tier = lv > 0.8 ? 1 : lv > 0.72 ? 2 : lv > 0.4 ? 3 : lv > 0.15 ? 4 : lv < -0.7 ? 5 : lv < -0.3 ? 6 : 0;
        const key = tier ? v * 16 + tier * 2 + (isLine ? 1 : 0) : 0, hitC = tier ? tone.get(key) : undefined;
        if (hitC !== undefined) { out[i] = hitC; continue; }
        const src0 = unpack(v, bg);
        if (dark) {
          // 最亮的一档留给谱线（波是纸在动，读起来靠谱线亮起来）；空底上的高光收一档
          if (lv > 0.72) c = pack(isLine ? mix(Lc, paper, 0.3) : mix(src0, Lc, 0.5));
          else if (lv > 0.4) c = pack(mix(src0, Lc, isLine ? 0.7 : 0.36));
          else if (lv > 0.15) c = pack(mix(src0, Lc, isLine ? 0.4 : 0.18));
          else if (lv < -0.7) c = pack(mix(src0, shade, 0.55));
          else if (lv < -0.3) c = pack(mix(src0, shade, 0.3));
        } else {
          if (lv > 0.8) c = pack(mix(src0, lc(C.glint), 0.45));                          // 墨线版：最陡的朝光坡落一道淡墨
          else if (lv > 0.4) c = pack(isLine ? mix(src0, paper, 0.45) : paper);
          else if (lv < -0.7) c = pack(mix(src0, lc(shade), 0.45));
          else if (lv < -0.3) c = pack(mix(src0, lc(shade), 0.25));
        }
        if (tier) tone.set(key, c);
      }
      out[i] = c;
    }
    return y0;
  }

  // 音符：落点先砸下一个符头；波一起，水里跳出两三颗像素音符，抛起来、一格一格往上飘、左右晃一格、最后抖动着散掉；水面上有倒着的淡影子
  const NOTES = {
    eighth: ['...#...', '...##..', '...#.#.', '...#..#', '...#..#', '...#...', '.###...', '####...', '####...', '.##....'],
    quarter: ['...#', '...#', '...#', '...#', '...#', '...#', '.###', '####', '####', '.##.'],
    beamed: ['...######', '...######', '...#....#', '...#....#', '...#....#', '.###..###', '####.####', '####.####', '.##...##.'],
    head: ['.###.', '#####', '#####', '.###.'],
  };
  Object.assign(SPRITES, {noteEighth: NOTES.eighth, noteQuarter: NOTES.quarter, noteBeamed: NOTES.beamed, noteHead: NOTES.head});
  function paintNotes(scene, ripples, now, out) {
    const {C, cols, rows, dark, dim} = scene;
    const bg = C.bg, wd = dim ? dim * 0.35 : 0, lc = (c) => (wd ? mix(c, bg, wd) : c);
    const accent = lc(dark ? [0x93, 0xA5, 0xEE] : [0x2F, 0x4B, 0xB0]), ink = lc(dark ? [0xC9, 0xC6, 0xBE] : [0x4A, 0x47, 0x41]);
    let top = null;
    const blit = (sp, x, y, c, a, dither) => {
      for (let ry = 0; ry < sp.length; ry++) for (let rx = 0; rx < sp[ry].length; rx++) {
        if (sp[ry][rx] !== '#') continue;
        const px = x + rx, py = y + ry;
        if (px < 0 || py < 0 || px >= cols || py >= rows || (dither && dither < bayer(px, py))) continue;
        const i = py * cols + px; out[i] = a >= 1 ? pack(c) : pack(mix(unpack(out[i], bg), c, a));
      }
      if (top == null || y < top) top = y;
    };
    // 竖直面上的符头：钴蓝的实心斜椭圆，左上一点高光、右下一线暗边（有体积的一颗「球」）；s = 看上去多大，deep = 陷进坑里多深（变暗）
    const hiC = mix(accent, lc(C.paper), dark ? 0.6 : 0.5), loC = mix(accent, [0, 0, 0], dark ? 0.35 : 0.3), deepC = dark ? [0, 0, 0] : lc(C.shade);
    const ct = Math.cos(-0.38), st = Math.sin(-0.38);
    const oval = (cx, cy, s, paint) => {
      const rx = 3.4 * s, ry = 2.5 * s, R = Math.ceil(rx) + 1;
      for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
        const u = (x * ct + y * st) / rx, v = (-x * st + y * ct) / ry, d = u * u + v * v;
        const px = cx + x, py = cy + y;
        if (d > 1 || px < 0 || py < 0 || px >= cols || py >= rows) continue;
        paint(py * cols + px, u, v, d);
      }
      if (top == null || cy - R < top) top = Math.max(0, cy - R);
    };
    const headAt = (cx, cy, s, deep) => oval(cx, cy, s, (i, u, v, d) => {
      const lit = -0.55 * u - 0.83 * v;
      let c = lit > 0.5 && d < 0.55 ? hiC : lit < -0.45 && d > 0.35 ? loC : accent;
      if (deep > 0) c = mix(c, deepC, deep);
      out[i] = pack(c);
    });
    for (const rp of ripples) {
      const a = now - rp.t0, ix = rp.px, iy = rp.py;
      if (rp.echo || a < -HEAD_MS || a > RIPPLE_MS) continue;     // 落到地板上的回声没有自己的符头和音符
      if (rp.air) {
        // 符头从我们这边飞向纸面：越飞越小；深色纸上是它照出的一圈光斑（越近越小越亮），浅色是它的影子从右下滑到它脚下
        if (a < 0) {
          const k = 1 + a / HEAD_MS, s = 1 + 1.6 * (1 - k) ** 2;
          if (dark) {
            const R = 2.5 + 7 * (1 - k);
            for (let y = Math.floor(iy - R); y <= iy + R; y++) for (let x = Math.floor(ix - R); x <= ix + R; x++) {
              const d = Math.hypot(x - ix, y - iy) / R; if (d > 1 || x < 0 || y < 0 || x >= cols || y >= rows) continue;
              const i = y * cols + x; out[i] = pack(mix(unpack(out[i], bg), accent, (d < 0.5 ? 0.3 : 0.16) * (0.4 + k)));
            }
          } else {
            const o = Math.round(1 + 6 * (s - 1) / 1.6);
            oval(ix + o, iy + o, 1, (i) => { out[i] = pack(mix(unpack(out[i], bg), lc(C.shade), 0.55)); });
          }
          headAt(ix, iy, s, 0);
          continue;
        }
        // 陷进坑里：跟着纸变小、变暗；鼓起来时变大；SHEET.note 那一刻变成第一颗 ♪ 飞走
        if (a < SHEET.note) { const w = sheetOf(rp, a); headAt(ix, iy, Math.max(0.8, 1 - 0.6 * SHEET.Hw * w.wc / SHEET.Dz), clamp(w.wc, 0, 1) * 0.3); }
      } else {
        // 地板上：符头从上面落下来（3 帧），落进去的一刻压扁成一道
        if (a < 0) { const k = 1 + a / HEAD_MS; blit(NOTES.head, ix - 2, Math.round(iy - 3 - (1 - k) * 14), accent, 1); continue; }
        if (a < 70) { for (let dx = -3; dx <= 3; dx++) blit(['#'], ix + dx, iy, accent, Math.abs(dx) < 2 ? 1 : 0.5); }
      }
      // 跳出来的音符
      const n = rp.notes || 2;
      for (let k = 0; k < n; k++) {
        const hk = hash(rp.seed * 31 + k * 7), t = rp.air ? a - SHEET.note - k * 100 : a - 60 - k * 110; if (t < 0) continue;
        const life = 900, p = t / life; if (p >= 1) continue;
        const kind = k === 0 ? 'eighth' : ['quarter', 'beamed', 'eighth'][hk % 3], sp = NOTES[kind];
        const side = (k % 2 ? 1 : -1) * (4 + (hk >>> 4) % 9), rise = 22 + (hk >>> 8) % 14;
        const lift = rise * (1 - (1 - Math.min(1, p * 1.6)) ** 2) + p * 10;            // 先抛起来，后面慢慢飘
        const wob = Math.floor(t / 132) % 2 ? 1 : 0;                                      // 每四帧左右晃一格
        const x = Math.round(ix + side * Math.min(1, p * 2)) + wob - (sp[0].length >> 1), yBase = iy - Math.round(lift);
        const col = k === 0 ? accent : ink, fade = p < 0.6 ? 0 : 1 - (p - 0.6) / 0.4;   // 后 40% 抖动着散掉
        if (rp.air) {
          // 竖直面：右下一个影子（深色是淡的回影），离纸越远离得越开——音符是从纸面飞向我们的
          const d = 1 + Math.round(4 * Math.min(1, p * 1.8));
          blit(sp, x + d, yBase - sp.length + d, dark ? col : lc(C.shade), dark ? 0.2 : 0.35, p < 0.6 ? 0 : fade);
          blit(sp, x, yBase - sp.length, col, 1, p < 0.6 ? 0 : fade);
          continue;
        }
        blit(sp, x, yBase - sp.length, col, 1, p < 0.6 ? 0 : fade);
        // 水面上倒着的淡影子：离水越远越淡、越碎
        const refl = Math.max(0, 1 - lift / 30) * (p < 0.6 ? 1 : fade);
        if (refl > 0.05) blit(sp.slice().reverse(), x, iy + Math.round(lift * 0.35) + 1, col, 0.35, refl * 0.9);
      }
    }
    return top;
  }

  // 点在 (x, y)（画布格坐标）：返回要加的波（地板上 / 地板以上），带落点和音符
  function makeRipples(scene, x, y, now) {
    const {obj, groups, cols, rows, anchors: {floorY, geo}} = scene;
    const {vpy, Dm, f} = geo;
    const at = (xx, yy) => { const d = Math.max(1, yy - vpy); return {sx: xx, Z: f * Dm / d, k: clamp(Math.sqrt(Dm / d), 1, 2.2)}; };
    const seed = hash(x * 977 + y * 131 + Math.round(now)) % 1000;
    const hit = x >= 0 && y >= 0 && x < cols && y < rows ? obj[y * cols + x] : 0;
    if (hit) { const g = groups[hit], fy = Math.min(g.foot, rows - 1); return [{...at(g.cx, fy), t0: now + HEAD_MS, seed, group: hit, px: x, py: y, notes: 3}]; }
    if (y >= floorY + 1) return [{...at(x, y), t0: now + HEAD_MS, seed, px: x, py: y, notes: 3}];
    // 地板以上：竖直面上压出坑、荡开涟漪；涟漪走到墙和地板的交线时，「声音」落到正下方的地板上接着荡开（谱台跟着起伏、灯闪）。
    //   落地的时刻 = 涟漪走到交线的时刻（最晚 360ms），离得越远落地的波越弱。
    //   落点在交线上（离灭点很近、地面上很远），按透视把波做大（k = Dm/d），让它在一秒多里扫过远、中两排谱台。
    const D = floorY - y, S = SHEET, full = RIP.speed * RIP.ease, q = (D - S.Rs) / full;
    const lag = Math.min(360, S.launch + (q <= 0 ? 0 : q < 0.95 ? -RIP.ease * Math.log(1 - q) : Infinity));
    const ey = Math.min(rows - 1, floorY + 2), ed = Math.max(1, ey - vpy);
    const echo = {...at(x, ey), k: clamp(Dm / ed, 1, 7), t0: now + HEAD_MS + lag, seed, px: x, py: ey, echo: true, amp: clamp(1.05 - D / 280, 0.45, 0.85)};
    return [{air: true, sx: x, sy: y, t0: now + HEAD_MS, seed, px: x, py: y, notes: 3}, echo];
  }

  // 点在 (x, y)（格坐标）附近的谱台：按谱板中心算距离（竖向算重一点），46 格以内最近的那个；没有返回 -1。
  //   点一下，它的灯亮一拍（不亮的灯亮成 tap 色；本来亮着的照旧，波纹另让它闪一下）。
  function nearestSlot(scene, x, y) {
    let best = -1, bestD = 46;
    scene.anchors.slots.forEach((sl, i) => {
      const z = STAND_SIZES[sl.depth], d = Math.hypot(sl.cx - x, (sl.base - z.poleH - z.legH - z.dh / 2 - y) * 1.4);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  // 画一帧（运行时和离线出图共用）：静的一层 → 地板上的水波（东西跟着动）→ 会动的两样 → 地板以上的谱纸 → 音符。返回这一帧改动到的最上一行。
  function compose(scene, step, still, ripples, now, out) {
    const live = ripples && ripples.length ? ripples : null;
    const rip = live ? paintRipples(scene, live, now, out) : null;
    if (!rip) out.set(scene.buf);
    const {cols, rows, C: {bg}, dim} = scene;
    const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < cols && y < rows) out[y * cols + x] = pack(dim ? mix(c, bg, dim) : c); };
    const under = (x, y) => unpack(x >= 0 && y >= 0 && x < cols && y < rows ? out[y * cols + x] : 0, bg);
    paintMoving(scene, step, still, put, under, rip ? rip.leadDy : 0);
    if (!live) return null;
    const tops = [rip && rip.top, paintSheet(scene, live, now, out), paintNotes(scene, live, now, out)].filter((v) => v != null);
    return tops.length ? Math.max(0, Math.min(...tops)) : null;
  }

  // 给单测和离线出图用（node 里没有 document）
  G.__pinkieMetreScene = {CELL, BPM, SPRITES, PALETTES, RIPPLE_MS, buildScene, paintMoving, lampStates, paintRipples, makeRipples, nearestSlot, compose};
  if (typeof document === 'undefined') return;

  // ==================================================================================================
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const isHome = () => root.getAttribute('data-laolao-startup-home') === '1';
  const isDark = () => root.getAttribute('data-theme') === 'dark' || root.hasAttribute('data-pinkie-night');
  const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => root.hasAttribute('data-pinkie-reduce-motion') || Boolean(motionPreference?.matches);
  const mainEl = () => document.querySelector('main.content.content--chat');
  let canvas = null, ctx = null, scene = null, low = null, lowCtx = null, img = null, view = null;
  let sceneKey = '', runActive = false;
  let timer = 0, step = 0, observed = null, lastStep = -1, lampSig = '', previewLamps = null, prevTop = 0, prevRip = false;
  let ripples = [], rippleTimer = 0, rippleRaf = 0, lastFrame = 0, flashSlot = -1, flashTimer = 0;
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
    canvas = null; ctx = null; scene = null; low = null; img = null; lastStep = -1; sceneKey = ''; lampSig = ''; ripples = []; stopRipple(); flashSlot = -1; clearTimeout(flashTimer);
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
    // 画布铺满对话区整高（上面是透明的，只有空中点击掉下来的光点会画到那里）
    const rows = Math.max(band + Math.round(band * (home ? 0.9 : 0.6)), Math.ceil(fullH / cellCss));
    const cols = Math.ceil(rect.width / cellCss);
    const cssW = cols * cellCss, cssH = rows * cellCss;
    const col = document.querySelector('.agent-chat__input')?.getBoundingClientRect();
    const quiet = !home && col && col.width ? [Math.floor((col.left - rect.left) / cellCss) - 4, Math.ceil((col.right - rect.left) / cellCss) + 4] : null;
    const keepTop = quiet ? Math.floor((col.top - (window.innerHeight - cssH)) / cellCss) : null;
    const lamps = currentLamps();
    const left = Math.round(rect.left * dpr) / dpr;
    const dark = isDark();
    const signature = JSON.stringify([left, cssW, cssH, cols, rows, band, cellDev, dark, home, lamps, quiet, keepTop, flashSlot]);
    if (sceneKey === signature) return false;
    sceneKey = signature;
    Object.assign(canvas.style, {left: left + 'px', top: 'auto', bottom: '0px', width: cssW + 'px', height: cssH + 'px'});
    canvas.width = cols * cellDev;
    canvas.height = rows * cellDev;
    ctx = canvas.getContext('2d');
    root.style.setProperty('--metre-band', Math.round(band * cellCss) + 'px');
    lampSig = lamps.join(',');
    scene = buildScene({cols, rows, band, dark, home, lamps, quiet, keepTop, dim: home ? 0 : 0.5, flash: flashSlot});
    low = document.createElement('canvas');
    low.width = cols; low.height = rows;
    lowCtx = low.getContext('2d');
    img = lowCtx.createImageData(cols, rows);
    view = {cols, rows, cellDev, cellCss};
    lastStep = -1;
    return true;
  }

  // force：整张重画（量过位置之后）；否则只重画这一帧和上一帧改动到的那几行（会动的两样在画带里，波纹的光点可能更高）
  function draw(force = false) {
    if (!ctx || !scene || !img) return;
    const tempo = document.querySelector('.pk-metre-tempo');
    const beat = String(reduced() ? 0 : Math.floor(step / 2) % 4);
    if (tempo && tempo.dataset.beat !== beat) tempo.dataset.beat = beat;
    if (!force && step === lastStep && !ripples.length && !prevRip) return;
    lastStep = step;
    const {cols, rows, cellDev} = view;
    const out = new Uint32Array(img.data.buffer);
    const top = compose(scene, step, reduced(), ripples, Date.now(), out);
    const cur = top == null ? scene.anchors.hy0 : Math.min(top, scene.anchors.hy0);
    const y0 = force ? 0 : Math.max(0, Math.min(cur, prevTop));
    prevTop = cur; prevRip = top != null;
    lowCtx.putImageData(img, 0, 0, 0, y0, cols, rows - y0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, y0 * cellDev, cols * cellDev, (rows - y0) * cellDev);
    ctx.drawImage(low, 0, y0, cols, rows - y0, 0, y0 * cellDev, cols * cellDev, (rows - y0) * cellDev);
  }
  function tick() {
    timer = 0;
    if (!running()) return;
    step++;
    // 子会话变了（派出、做完、出错）：灯跟着换，静的那一层重画一次
    if (currentLamps().join(',') !== lampSig) { layout(); draw(true); } else draw();
    timer = setTimeout(tick, STEP);
  }
  const running = () => Boolean(canvas) && (runActive || currentLamps().includes('run'))
    && !document.hidden && !window.__pinkieMetreBrand?.isOpen && !reduced();
  function start() { if (!timer && running()) timer = setTimeout(tick, STEP); }
  function stop() { clearTimeout(timer); timer = 0; }

  // 点击：只在点击后的约 1.5 秒里逐帧画（跟屏幕刷新走，最多 60 帧每秒；窗口在后台时退回 16ms 的定时器），画完就停，平时不常驻；
  //   按钮、输入框、正文、侧栏、总控台、弹层上不触发；减少动态效果时不出现。
  const QUIET_HIT = 'button, a, input, textarea, select, summary, label, [role="button"], [role="menu"], [role="dialog"], [role="listbox"], [contenteditable], .chat-text, .chat-group, .agent-chat__input, aside.sidebar, header.topbar, .pk-metre-board, .pk-metre-brand, [data-metre-pop], .laolao-menu, .pinkie-tray';
  // 前台跟屏幕刷新走；同时挂一个 50ms 的保底定时器（窗口被挡住、画面不在前面时 rAF 会停，但页面不算 hidden），哪个先到用哪个
  function nextRipple() {
    rippleTimer = setTimeout(rippleTick, document.hidden ? RIPPLE_FRAME : 50);
    if (!document.hidden && typeof requestAnimationFrame === 'function') rippleRaf = requestAnimationFrame(rippleTick);
  }
  function stopRipple() { clearTimeout(rippleTimer); if (rippleRaf) cancelAnimationFrame(rippleRaf); rippleTimer = 0; rippleRaf = 0; }
  function rippleTick() {
    stopRipple();
    const now = Date.now();
    // 120Hz 的屏上隔一帧画一次（60 帧每秒就够顺，省一半的活）
    if (now - lastFrame < 14 && ripples.length) { nextRipple(); return; }
    lastFrame = now;
    ripples = ripples.filter((rp) => now - rp.t0 <= RIPPLE_MS);
    if (reduced()) ripples = [];
    draw();
    if (ripples.length && canvas) nextRipple();
  }
  // clientX / clientY（页面坐标）→ 荡一圈；返回是否荡了
  function tapAt(clientX, clientY) {
    if (!canvas || !scene || !view || reduced()) return false;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((clientX - rect.left) / view.cellCss), y = Math.round((clientY - rect.top) / view.cellCss);
    if (x < 0 || y < 0 || x >= view.cols || y >= view.rows) return false;
    // 点在谱台附近：最近的那个谱台灯亮一拍（至少两个半拍），静的一层带着它重画一次；
    //   熄灯也要整层重画（约一帧的活），所以等这一下的波纹走完再熄，不在波纹中间卡一帧
    const slot = nearestSlot(scene, x, y);
    if (slot >= 0) {
      clearTimeout(flashTimer);
      if (slot !== flashSlot) { flashSlot = slot; layout(); draw(true); }
      const off = () => {
        if (ripples.length && canvas) { flashTimer = setTimeout(off, 120); return; }
        flashSlot = -1; flashTimer = 0; if (canvas) { layout(); draw(true); }
      };
      flashTimer = setTimeout(off, STEP * 2);
    }
    ripples.push(...makeRipples(scene, x, y, Date.now()));
    if (ripples.length > 4) ripples = ripples.slice(-4);   // 最多同时 4 个（空中点击一次是两个：竖直面 + 落到地板上的回声）
    if (!rippleTimer && !rippleRaf) rippleTick();
    window.dispatchEvent(new CustomEvent('pinkie:metre-tap', {detail: {x: clientX, y: clientY}}));   // 输入框上的猫听见了，竖起耳朵
    return true;
  }
  function onTap(e) {
    if (e.button !== 0 || !canvas || !isMetre() || reduced()) return;
    const el = e.target instanceof Element ? e.target : null;
    if (!el || el.closest(QUIET_HIT) || !el.closest('main.content')) return;
    if (String(window.getSelection?.() || '')) return;
    tapAt(e.clientX, e.clientY);
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
    if (layout()) draw(true);
    if (running()) start(); else stop();
  }
  let queued = false;
  const queue = () => { if (!queued) { queued = true; setTimeout(() => { queued = false; sync(); }, 150); } };

  function boot() {
    new MutationObserver(queue).observe(root, {attributes: true, attributeFilter: ['data-laolao-mode', 'data-laolao-startup-home', 'data-theme', 'data-pinkie-night', 'data-pinkie-reduce-motion']});
    const shell = document.querySelector('openclaw-app') || document.body;
    // 换页（对话 ↔ 设置等）时 main 的 class 会变；只看结构变化，不看对话流里的字
    window.Pinkie?.domWatch?.createObserver((records) => {
      if (!isMetre() && !canvas) return;
      if (records.some((r) => !(r.target instanceof Element) || !r.target.closest('.chat-thread, .pk-metre-board, .pk-metre-brand, .pk-metre-backdrop'))) queue();
    })?.watch(shell, {childList: true});
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else queue(); });
    window.addEventListener('resize', queue);
    document.addEventListener('pointerdown', onTap, true);
    // 总控台的数据到了 / 换了会话：灯马上跟上（不等下一拍）
    window.addEventListener('pinkie:session-selected', () => { runActive = false; queue(); });
    window.addEventListener('pinkie:metre-board-data', queue);
    window.addEventListener('pinkie:run-view', (event) => {
      const active = Boolean(event.detail?.live?.active);
      if (active !== runActive) { runActive = active; queue(); }
    });
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
    tap(x, y) { return tapAt(x, y); },
    preview(list) { previewLamps = Array.isArray(list) ? list.slice() : null; if (canvas) { layout(); draw(true); } },
    sync,
  });
})();
