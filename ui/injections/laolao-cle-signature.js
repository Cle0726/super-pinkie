/* cle-signature:v1 —— 「C.le.」签名字形
 * 中心线（手绘贝塞尔）+ 程序化笔压 → 可变宽度轮廓。签名与粒子共用同一份几何。
 *   CleSignature.strokes        笔顺：C → 点 → l·e·花式下划线 → 点
 *   CleSignature.outline(svg)   生成填充轮廓 path 字符串数组
 *   CleSignature.sample(n)      沿笔顺取样（中心点、法向偏移、笔顺进度、笔画内进度）
 */
(function () {
  'use strict';
  var VIEW = {w: 200, h: 96};
  var SLANT = Math.tan(12 * Math.PI / 180), BASE = 64;
  function skew(x, y) { return {x: x + (BASE - y) * SLANT, y: y}; }
  var STROKES = [
    // C：右上起笔带小钩，逆时针大弧，收笔上挑
    {id: 'C', d: 'M55 25C53 17 44 13 34 16C20 20 12 36 15 52C18 67 33 74 47 68C53 65 57 60 59 55', w: 5.2},
    {id: 'd1', dot: [67, 64], r: 3.9},
    // l·e 连笔：从基线入笔，l 上冲成环，落下接 e 的小环，再甩出花式下划线回勾到字底
    {id: 'le', d: 'M73 64C82 55 95 37 97 24C98.5 14 91 11 88 19C84 30 85 50 88 59C90 65 96 66 102 61' +
      'C108 56 118 50 118 44C118 39 111 38 107 44C103 51 104 62 113 65C120 67 128 63 134 59' +
      'C142 54 157 55 161 61C164 66 152 73 120 76.5C88 79.5 50 78 24 84', w: 4.6},
    {id: 'd2', dot: [168, 64], r: 3.9},
  ];

  function pathEl(d) {
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    return p;
  }

  // 笔压：下行重、上行轻；入锋由细到粗、出锋渐细（花式下划线拖成发丝）
  function width(base, dirY, t, tailLong) {
    var down = Math.max(0, dirY);
    var w = base * (.16 + 1.12 * Math.pow(down, 1.4) + .12 * (1 - Math.abs(dirY)));
    w *= .35 + .65 * Math.min(1, t / .06);
    var tail = tailLong ? .58 : .85;
    if (t > tail) w *= 1 - .9 * Math.pow((t - tail) / (1 - tail), 1.2);
    return Math.max(.35, w);
  }

  function centerline(stroke, host, step) {
    var el = pathEl(stroke.d);
    host.appendChild(el);
    var L = el.getTotalLength(), n = Math.max(24, Math.round(L / (step || .8))), pts = [];
    for (var i = 0; i <= n; i++) {
      var s = (i / n) * L, a = el.getPointAtLength(s), b = el.getPointAtLength(Math.min(L, s + .7));
      var c = i === n ? el.getPointAtLength(Math.max(0, s - .7)) : null;
      a = skew(a.x, a.y); b = skew(b.x, b.y); if (c) c = skew(c.x, c.y);
      var tx = c ? a.x - c.x : b.x - a.x, ty = c ? a.y - c.y : b.y - a.y, tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      pts.push({x: a.x, y: a.y, nx: -ty, ny: tx, t: i / n, w: width(stroke.w, ty, i / n, stroke.id === 'le')});
    }
    el.remove();
    return {pts: pts, len: L};
  }

  function outline(host) {
    return STROKES.map(function (s) {
      if (s.dot) {
        var r = s.r, q = skew(s.dot[0], s.dot[1]);
        return 'M' + (q.x - r) + ' ' + q.y + 'a' + r + ' ' + (r * .86) + ' -28 1 0 ' + (2 * r) + ' 0a' + r + ' ' + (r * .86) + ' -28 1 0 ' + (-2 * r) + ' 0Z';
      }
      var pts = centerline(s, host).pts, L = [], R = [];
      pts.forEach(function (p) {
        L.push((p.x + p.nx * p.w / 2).toFixed(2) + ' ' + (p.y + p.ny * p.w / 2).toFixed(2));
        R.push((p.x - p.nx * p.w / 2).toFixed(2) + ' ' + (p.y - p.ny * p.w / 2).toFixed(2));
      });
      return 'M' + L.join('L') + 'L' + R.reverse().join('L') + 'Z';
    });
  }

  window.CleSignature = {view: VIEW, skew: skew, strokes: STROKES, outline: outline, centerline: centerline, width: width};
})();
