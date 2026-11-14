// Metre 的像素黑猫：帧数据和画法。预览页（cat-preview.html）和正式界面用的是同一份文件。
// 原型是 C.le.控制台图标上的黑猫（ref/cle-cat.png）。用户点头之前不接进界面。
// 画布 16×16。字符：. 透明  K 身体  E 眼睛  H 眼睛高光  S 蓝影子（也用作闭眼）  G 灰（小花、方块、? !）
(function (root) {
  'use strict';

  const SIZE = 16;
  const PALETTE = {K: '#0E0E10', E: '#2F9BFF', H: '#9AD4FF', S: '#1F3FA8', G: '#8A8A88'};
  const OUTLINE = '#3A3A3C'; // 只在深色主题下画在身体外沿

  // ---- 姿势 ----
  const SIT = [
    '................',
    '....K.....K.....',
    '....KK...KK.....',
    '....KKK.KKK.....',
    '....KKKKKKK.....',
    '...KKKKKKKKK....',
    '...KEHKKKHEK....',
    '...KKKKKKKKK....',
    '....KKKKKKKKK...',
    '.....KKKKKKKKK..',
    '.....KKKKKKKKKK.',
    '.....KKKKKKKKKK.',
    '.....KKKKKKKKKKK',
    '.....KK.KKKKKKKK',
    '...KKKKKKKKKKKK.',
    '....SSSSSSSSSSS.',
  ];
  const FRONT = [
    '................',
    '...K......K.....',
    '...KK....KK.....',
    '...KKK..KKK.....',
    '...KKKKKKKK.....',
    '..KKKKKKKKKK....',
    '..KEHKKKKHEK....',
    '..KKKKKKKKKK....',
    '...KKKKKKKK.....',
    '...KKKKKKKK.....',
    '..KKKKKKKKKK....',
    '..KKKKKKKKKK....',
    '..KKKKKKKKKK.K..',
    '..KKKK..KKKK.K..',
    '..KKKK..KKKKKK..',
    '..SSSSSSSSSSSS..',
  ];
  const LOAF = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '...K.....K......',
    '...KK...KK......',
    '...KKK.KKK......',
    '..KKKKKKKKK.....',
    '..KEHKKKHEKKKK..',
    '..KKKKKKKKKKKKK.',
    '..KKKKKKKKKKKKK.',
    '...KKKKKKKKKKKKK',
    '..KKKKKKKKKKKKKK',
    '..KK.KKKKKKKKKK.',
    '..SSSSSSSSSSSSS.',
  ];
  const RUN_A = [
    '................',
    '................',
    '..K.....K.......',
    '..KK...KK.....K.',
    '..KKK.KKK.....K.',
    '.KKKKKKKKK...KK.',
    '.KEHKKKHEK...K..',
    '.KKKKKKKKK..KK..',
    '..KKKKKKKKKKKK..',
    '...KKKKKKKKKKK..',
    '...KKKKKKKKKKK..',
    '...KKKKKKKKKKK..',
    '...KK.KK..KK.KK.',
    '..KK..K...K...K.',
    '..K...K...K...K.',
    '..SSSSSSSSSSSSS.',
  ];
  const RUN_B = [
    '................',
    '..K.....K.......',
    '..KK...KK.......',
    '..KKK.KKK......K',
    '.KKKKKKKKK....KK',
    '.KEHKKKHEK...KK.',
    '.KKKKKKKKK..KK..',
    '..KKKKKKKKKKKK..',
    '...KKKKKKKKKKK..',
    '...KKKKKKKKKKK..',
    '...KKKKKKKKKKK..',
    '....KK.KK.KKK...',
    '.....K.K..K.K...',
    '.....KK....KK...',
    '................',
    '...SSSSSSSSSSS..',
  ];
  const DOWN = [ // 卧倒
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.K....K.........',
    '.KK..KK.........',
    '.KKKKKKK..KKKK..',
    'KKKKKKKKKKKKKKK.',
    'KKEKKEKKKKKKKKKK',
    '.KKKKKKKKKKKKKKK',
    '.SSSSSSSSSSSSSS.',
  ];
  const CURL = [ // 睡觉
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '...K..K.........',
    '...KKKKKKKKKK...',
    '..KKKKKKKKKKKK..',
    '..KSSKSSKKKKKKK.',
    '..KKKKKKKKKKKKK.',
    '...KKKKKKKKKKK..',
    '....SSSSSSSSS...',
  ];

  // ---- 小工具：在姿势上改几个像素 ----
  // put(姿势, 'x,y,字符 x,y,字符 …')
  function put(pose, edits) {
    const rows = pose.map(row => row.split(''));
    for (const edit of String(edits || '').split(/\s+/).filter(Boolean)) {
      const [x, y, ch] = edit.split(',');
      rows[Number(y)][Number(x)] = ch;
    }
    return rows.map(row => row.join(''));
  }
  // 把 y0..y1 这几行整体横移 dx（歪头、探头用）
  function slide(pose, y0, y1, dx) {
    return pose.map((row, y) => {
      if (y < y0 || y > y1 || !dx) return row;
      return dx > 0 ? ('.'.repeat(dx) + row).slice(0, SIZE) : (row + '.'.repeat(-dx)).slice(-SIZE);
    });
  }
  function flip(pose) {
    return pose.map(row => row.split('').reverse().join(''));
  }

  // 眼睛（坐姿）：默认是两条平的细长眼，各两格，靠里的一格更亮
  const EYES_SHUT = '4,6,S 5,6,S 9,6,S 10,6,S';
  const EYES_UP = '4,6,K 5,6,K 9,6,K 10,6,K 4,5,E 5,5,H 9,5,H 10,5,E';
  const EYES_LEFT = '4,6,H 5,6,E 9,6,H 10,6,E';
  const EYES_RIGHT = '4,6,E 5,6,H 9,6,E 10,6,H';
  const EYES_SQUINT = '4,6,K 5,6,E 9,6,E 10,6,K';
  const EYES_WIDE = '4,6,H 5,6,H 9,6,H 10,6,H 4,7,E 5,7,E 9,7,E 10,7,E';
  // 尾巴尖（坐姿）：默认贴地伸到身前
  const TAIL_UP = '3,14,. 4,14,. 4,13,K';
  const TAIL_OUT = '2,14,K';
  // 小花
  const BUD = '0,11,G 2,11,G 0,12,G 1,12,G 2,12,G 1,13,G 1,14,G';
  const HALF = BUD + ' 1,11,H';
  const BLOOM = HALF + ' 1,10,G';

  // 写字时爪子前面的一页纸（尾巴尖收起来）
  const PAGE = '3,14,. 4,14,. 1,14,G 2,14,G 3,14,G';

  const sit = edits => put(SIT, BUD + ' ' + (edits || ''));
  const sitBare = edits => put(SIT, edits || '');

  // 尾巴竖起（完成）
  const TAIL_RAISED = '3,14,. 4,14,. 15,12,. 15,13,. 14,9,K 14,8,K 14,7,K 14,6,K 15,5,K 15,4,K';
  // 炸毛（出错）
  const SPIKES = '2,5,K 12,5,K 3,3,K 11,3,K 13,8,K 15,9,K 4,9,K 15,11,K 4,11,K 2,13,K 2,7,K 12,7,K 3,14,. 14,7,K 13,6,K';
  const BANG = '14,0,G 14,1,G 14,2,G 14,4,G';

  const RIGHT = flip(SIT); // 朝右坐（派发时推方块）
  const pushFrame = (bx, lean) => put(lean ? slide(RIGHT, 1, 8, 1) : RIGHT, `11,14,. 12,14,. ${bx},13,G ${bx + 1},13,G ${bx},14,G ${bx + 1},14,G`);

  // ---- 16 个状态 ----
  // fps：每秒帧数（最高 8）。hold：每帧停几拍，不写就是每帧 1 拍。
  const STATES = {
    idle: {label: '空闲', fps: 4, frames: [sit(), sit(EYES_SHUT), sit(), sit(TAIL_UP)]},
    think: {label: '思考', fps: 3, frames: [sit(EYES_UP), sit(EYES_UP + ' ' + TAIL_UP), sit(EYES_UP), sit(EYES_UP + ' ' + TAIL_OUT)]},
    read: {label: '读取', fps: 4, frames: [sit(EYES_LEFT), sit(), sit(EYES_RIGHT), sit()]},
    write: {label: '写入 / 修改', fps: 6, frames: [sitBare(PAGE + ' 4,12,K'), sitBare(PAGE + ' 4,13,K'), sitBare(PAGE + ' 4,12,K 7,13,K 6,13,.'), sitBare(PAGE + ' 4,13,K 7,13,K 6,13,.')]},
    create: {label: '创建', fps: 4, frames: [sitBare(), sitBare('1,13,G'), sitBare('1,13,G 1,12,G 0,13,G 0,12,G'), sitBare('0,11,G 1,11,G 2,11,G 0,12,G 2,12,G 0,13,G 1,13,G 2,13,G 1,12,H')]},
    exec: {label: '执行命令', fps: 8, frames: [RUN_A, RUN_B, put(RUN_A, '2,13,. 3,13,. 2,14,. 3,14,K 6,14,. 7,14,K 14,13,. 14,14,. 13,14,K'), RUN_B]},
    search: {label: '搜索 / 看网页', fps: 4, frames: [slide(sit(), 1, 7, -1), put(sit(), '4,1,. 3,2,K 10,1,. 11,2,K'), slide(sit(), 1, 7, 1), put(sit(), '4,1,. 3,2,K 10,1,. 11,2,K')]},
    image: {label: '看图片', fps: 2, frames: [sit(), slide(slide(sit(), 1, 3, -1), 6, 8, 1)]},
    dispatch: {label: '派发', fps: 4, frames: [pushFrame(12, false), pushFrame(12, true), pushFrame(13, true), pushFrame(14, false)]},
    waiting: {label: '等子会话', fps: 2, frames: [put(LOAF, '15,10,K 15,11,K'), put(LOAF, '15,11,K 14,9,K')]},
    review: {label: '验收', fps: 2, frames: [sit(EYES_SQUINT), slide(sit(EYES_SQUINT), 1, 8, -1)]},
    ask: {label: '等你确认', fps: 2, frames: [put(FRONT, '13,1,G 14,1,G 15,2,G 14,3,G 14,5,G'), put(FRONT, '13,0,G 14,0,G 15,1,G 14,2,G 14,4,G')]},
    done: {label: '完成', fps: 3, frames: [sit(), sitBare(HALF + ' ' + TAIL_RAISED), sitBare(BLOOM + ' ' + TAIL_RAISED)]},
    error: {label: '出错', fps: 4, frames: [sitBare(SPIKES + ' ' + BANG + ' ' + EYES_WIDE), sitBare(SPIKES + ' ' + EYES_WIDE + ' 2,5,. 12,5,. 1,6,K 13,5,K')]},
    stopped: {label: '已停下', fps: 1, frames: [DOWN]},
    sleep: {label: '睡觉', fps: 1, frames: [put(CURL, '12,7,G'), put(CURL, '11,3,G 12,3,G 13,3,G 14,3,G 13,4,G 12,5,G 11,6,G 12,6,G 13,6,G 14,6,G')]},
  };

  // 模式菜单里的静态猫头（同一只猫的头，取坐姿的上半部分）
  const HEAD = SIT.slice(0, 9).map(row => row.slice(1, 14));

  // 画一帧。scale 取整数；dark 为真时在身体外沿加一圈描边。
  function draw(ctx, frame, scale, options) {
    const dark = Boolean(options && options.dark);
    const ox = (options && options.x) || 0;
    const oy = (options && options.y) || 0;
    const at = (x, y) => (frame[y] && frame[y][x]) || '.';
    for (let y = 0; y < frame.length; y += 1) {
      for (let x = 0; x < frame[y].length; x += 1) {
        const ch = at(x, y);
        if (ch === '.') {
          if (dark && (at(x - 1, y) === 'K' || at(x + 1, y) === 'K' || at(x, y - 1) === 'K' || at(x, y + 1) === 'K')) {
            ctx.fillStyle = OUTLINE;
            ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
          }
          continue;
        }
        ctx.fillStyle = PALETTE[ch];
        ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    }
  }

  const api = {SIZE, PALETTE, OUTLINE, STATES, HEAD, draw};
  root.LaolaoMetreCat = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
