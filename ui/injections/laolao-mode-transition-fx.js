/* 模式转场：让转场图自己动起来。
   每个模式一种揭幕方式（气球 / 蓝图方块 / 想法云朵 / 星星 / 彩虹斜切），
   揭开后先朦胧再对焦，碧琪做一个招牌动作，配自己的粒子。
   画面是两层：补好的背景板 + 抠出来的碧琪（遮罩和背景板由
   scripts/mode-transition-assets 预先生成），用 WebGL 合成；粒子画在 2D 画布上。
   不支持 WebGL、素材没加载出来或系统要求减少动态效果时，返回 null，
   由 laolao-mode-switcher.js 走原来的转场。 */
((root, factory) => {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PinkieModeTransitionFx = api;
})(typeof window === "object" ? window : globalThis, (root) => {
  "use strict";

  const ASSET_VERSION = "modetransitionfx1";
  const FINISH = 380;          // 加载好后进度走完的时长
  const EXIT = 460;            // 退场时长
  const PHRASE_EVERY = 600;    // 每句台词至少停留的时长
  const COPY_DELAY = 200;      // 揭幕后多久出文字
  const EXPECTED_WAIT = 1500;  // 进度条按这个时长走到 72%，之后慢慢爬
  const LOAD_TIMEOUT = 2500;

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const easeOutCubic = (x) => 1 - (1 - x) ** 3;
  const easeOutQuart = (x) => 1 - (1 - x) ** 4;
  const easeInQuad = (x) => x * x;
  const easeInOutCubic = (x) => x < .5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  const smooth = (x) => x * x * (3 - 2 * x);
  const easeOutBack = (x, s = 1.7) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;
  const lerp = (a, b, x) => a + (b - a) * x;
  const back = (s) => (x) => easeOutBack(x, s);
  // 分段关键帧：[[t, value, ease?], ...]
  const keys = (frames, t) => {
    if (t <= frames[0][0]) return frames[0][1];
    for (let i = 1; i < frames.length; i++) {
      const [t1, v1, ease = easeOutCubic] = frames[i];
      const [t0, v0] = frames[i - 1];
      if (t <= t1) return lerp(v0, v1, ease((t - t0) / (t1 - t0)));
    }
    return frames.at(-1)[1];
  };

  // ---------- 五个模式 ----------
  // 图片坐标：x 从左到右、y 从上到下，都是 0–1。
  // revealType：0 气球爆开 / 1 蓝图方块 / 2 想法云朵 / 3 星星 / 4 彩虹斜切
  // charDepth：角色层跟随镜头的程度；hop：揭幕后多久做招牌动作。
  const MODES = {
    chat: {
      pop: 320, reveal: 560, hop: 420, revealType: 0, charDepth: 1.22,
      anchor: [.688, .915], shadow: [.678, .903, .165, .05, 1],
      hair: [[0, 0, 1, .37], [.575, 0, 1, .61], [.74, 0, 1, .89]],
      haze: [1, .965, .98], rim: [1, .9, .95],
      // 原地蹦一下：先蹲、再弹起、落地压扁、回弹。
      motion: (t, h) => ({
        ty: keys([[0, 0], [110, 0], [330, .012], [520, 0, easeInQuad], [900, 0]], h),
        sy: keys([[0, 1], [110, .92], [330, 1.085], [520, 1.01, easeInQuad], [630, .93], [900, 1, back(2.2)]], h)
          + (h > 900 ? .011 * Math.sin((h - 900) / 380) : 0),
        sx: keys([[0, 1], [110, 1.05], [330, .96], [520, 1, easeInQuad], [630, 1.04], [900, 1, back(2.2)]], h)
          - (h > 900 ? .005 * Math.sin((h - 900) / 380) : 0),
        rot: 0,
      }),
    },
    project: {
      pop: 300, reveal: 640, hop: 380, revealType: 1, charDepth: .7,
      anchor: [.76, .705], clipY: .708, shadow: null,
      hair: [[.55, .08, .9, .40], [.58, .30, .66, .62]],
      haze: [.96, 1, .99], rim: [.86, 1, .97],
      // 先躲在抽屉里只露出眼睛，然后「噌」地冒出来，落定时压一下。
      motion: (t, h, pop) => {
        const peek = -.27;
        return {
          ty: h < 0 ? peek : lerp(peek, 0, easeOutQuart(clamp(h / 300))),
          sy: keys([[0, 1], [90, 1.08], [300, .95, easeInQuad], [560, 1, back(2)]], h) + (h > 560 ? .006 * Math.sin((h - 560) / 420) : 0),
          sx: keys([[0, 1], [90, .95], [300, 1.04, easeInQuad], [560, 1, back(2)]], h),
          rot: .022 * Math.sin((t - pop) / 60) * clamp((t - pop) / 160) * (1 - clamp(h / 260)),
        };
      },
    },
    thinking: {
      pop: 440, reveal: 680, hop: 640, revealType: 2, charDepth: 1.22,
      anchor: [.70, .87], shadow: null,
      hair: [[.53, .12, .80, .42], [.74, .40, .92, .75], [.68, .55, .93, .90]],
      haze: [.985, .965, 1], rim: [.96, .9, 1],
      // 歪着头慢慢想，想到了就「叮」地挺一下。
      motion: (t, h, pop) => ({
        ty: 0,
        sy: keys([[0, 1], [130, 1.045], [300, .985], [640, 1, back(1.8)]], h) + (h > 640 ? .006 * Math.sin((h - 640) / 520) : 0),
        sx: keys([[0, 1], [130, .975], [300, 1.01], [640, 1, back(1.8)]], h),
        rot: .016 * Math.sin((t - pop) / 700) * clamp((t - pop) / 500),
      }),
    },
    learning: {
      pop: 400, reveal: 640, hop: 560, revealType: 3, charDepth: 1.22,
      anchor: [.73, 1], shadow: null,
      hair: [[.45, .04, 1, .34], [.86, .30, 1, .62], [.56, .56, .64, .92]],
      haze: [1, .985, .95], rim: [1, .95, .8],
      // 从画面下边升上来，举手的瞬间往上一挺。下边被画面截断，所以不转动、不往上跳。
      motion: (t, h, pop) => ({
        ty: lerp(-.08, 0, easeOutCubic(clamp((t - pop) / 560))),
        sy: keys([[0, 1], [120, 1.05], [290, .97, easeInQuad], [600, 1, back(2)]], h) + (h > 600 ? .007 * Math.sin((h - 600) / 460) : 0),
        sx: keys([[0, 1], [120, .97], [290, 1.025, easeInQuad], [600, 1, back(2)]], h),
        rot: 0,
      }),
    },
    unrestricted: {
      pop: 260, reveal: 460, hop: 300, revealType: 4, charDepth: 1.22,
      anchor: [.675, .92], shadow: [.675, .915, .09, .03, .8],
      hair: [[.46, .05, .82, .40], [.70, .28, 1, .86]],
      haze: [1, .975, .96], rim: [1, .95, .9],
      // 踩着节拍左右摇摆，一拍一压。
      motion: (t, h) => {
        if (h < 0) return {ty: 0, sx: 1, sy: 1, rot: 0};
        const k = h / 400, f = k - Math.floor(k);
        const amp = lerp(1, .35, clamp(h / 1700)) * clamp(h / 120);
        return {
          ty: 0,
          sy: 1 - amp * .045 * Math.cos(f * Math.PI * 2),
          sx: 1 + amp * .028 * Math.cos(f * Math.PI * 2),
          rot: amp * .024 * Math.sin(Math.PI * k),
        };
      },
    },
  };

  const assetUrls = (id) => ({
    image: `/laolao-mode-transition-${id}.png?v=transition2`,
    mask: `/laolao-mode-transition-${id}-mask.png?v=${ASSET_VERSION}`,
    plate: `/laolao-mode-transition-${id}-plate.webp?v=${ASSET_VERSION}`,
    plateSoft: `/laolao-mode-transition-${id}-plate-soft.png?v=${ASSET_VERSION}`,
    charSoft: `/laolao-mode-transition-${id}-char-soft.png?v=${ASSET_VERSION}`,
  });

  // ---------- WebGL：背景板 + 角色两层，按深度做视差，带对焦和五种揭幕 ----------
  const VERT = `attribute vec2 p; varying vec2 vUv; void main(){ vUv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;
  const FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uImage, uPlate, uMask, uPlateSoft, uCharSoft;
    uniform vec2 uRes, uImg, uPan, uAnchor, uHopT, uHopS;
    uniform float uTime, uZoom, uFade, uWobble, uBlurBg, uBlurChar, uHaze, uRot, uClipY, uCharDepth, uRevealType, uRimFade, uPx;
    uniform vec3 uReveal, uHazeColor, uRimColor;
    uniform vec4 uRevealB, uShadow, uHair[3];
    vec2 cover(vec2 s) {
      float sa = uRes.x / uRes.y, ia = uImg.x / uImg.y;
      if (sa > ia) s.y = (s.y - .5) * (ia / sa) + .5; else s.x = (s.x - .5) * (sa / ia) + .5;
      return s;
    }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    // 五角星的有向距离（Inigo Quilez）
    float sdStar5(vec2 p, float r, float rf) {
      const vec2 k1 = vec2(.809016994375, -.587785252292);
      const vec2 k2 = vec2(-.809016994375, -.587785252292);
      p.x = abs(p.x);
      p -= 2. * max(dot(k1, p), 0.) * k1;
      p -= 2. * max(dot(k2, p), 0.) * k2;
      p.x = abs(p.x);
      p.y -= r;
      vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0., 1.);
      float h = clamp(dot(p, ba) / dot(ba, ba), 0., r);
      return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
    }
    float box(vec2 p, vec4 b) {  // 图片坐标里的一个软边矩形（y 从上到下）
      vec2 q = vec2(p.x, 1. - p.y);
      return smoothstep(b.x - .03, b.x + .01, q.x) * (1. - smoothstep(b.z - .01, b.z + .03, q.x))
           * smoothstep(b.y - .03, b.y + .01, q.y) * (1. - smoothstep(b.w - .01, b.w + .03, q.y));
    }
    void main() {
      vec2 p0 = cover(vUv);
      // 远处墙面几乎不动，地板越近动得越多，碧琪比地板还靠前。
      float depth = mix(.35, 1., 1. - smoothstep(.05, .55, p0.y));
      float zb = mix(1., uZoom, depth);
      vec2 pb = .5 + (p0 - .5) / zb + uPan * depth;
      float zc = 1. + (uZoom - 1.) * uCharDepth;
      vec2 pc0 = .5 + (p0 - .5) / zc + uPan * uCharDepth;
      // 角色动作：绕锚点缩放、转动、平移（按图片比例转，避免变形）。
      float asp = uImg.x / uImg.y;
      vec2 q = pc0 - uAnchor - uHopT;
      q.x *= asp;
      q = mat2(cos(uRot), -sin(uRot), sin(uRot), cos(uRot)) * q;
      q.x /= asp;
      vec2 pc = uAnchor + q / uHopS;

      // 鬃毛和尾巴的外圈轻轻飘动；脸、蹄子不动。
      vec4 m = texture2D(uMask, pc);
      float hair = max(max(box(pc, uHair[0]), box(pc, uHair[1])), box(pc, uHair[2]));
      float band = clamp(m.r - m.g, 0., 1.) * hair * uWobble;
      vec2 wave = vec2(sin(pc.y * 46. + uTime * 2.3) + .5 * sin(pc.y * 91. - uTime * 3.1),
                       cos(pc.x * 39. + uTime * 1.9)) * .0021 * band;
      vec2 pcd = pc + wave;
      float inside = step(0., pcd.x) * step(pcd.x, 1.) * step(0., pcd.y) * step(pcd.y, 1.);
      // 抽屉之类挡在角色前面的东西：这条线以下不画角色。
      float clipK = uClipY > 0. ? smoothstep(uClipY - .002, uClipY + .002, pc0.y) : 1.;
      float a = smoothstep(.32, .68, texture2D(uMask, pcd).r) * inside * clipK;

      // 背景：挖空区用补好的背景板，其余直接用原图；清晰版和柔焦版之间过渡。
      float hole = texture2D(uMask, pb).b;
      vec3 sharpBg = mix(texture2D(uImage, pb).rgb, texture2D(uPlate, pb).rgb, hole);
      vec3 bg = mix(sharpBg, texture2D(uPlateSoft, pb).rgb, uBlurBg);
      if (uShadow.z > 0.) {
        float lift = clamp(uHopT.y / .012, 0., 1.);
        vec2 fs = (pb - uShadow.xy) / vec2(uShadow.z - .02 * lift, uShadow.w);
        float shadow = (1. - smoothstep(.35, 1., length(fs))) * mix(.16, .11, lift) * uRevealB.w;
        bg *= 1. - shadow * vec3(.55, .9, .72);
      }

      // 角色：预乘颜色，清晰版和柔焦版之间过渡。
      vec4 sharp = vec4(texture2D(uImage, pcd).rgb * a, a);
      vec4 softC = texture2D(uCharSoft, pc) * inside * clipK;
      vec4 ch = mix(sharp, softC, uBlurChar);
      vec3 col = bg * (1. - ch.a) + ch.rgb;
      // 失焦时带一点发亮的雾感，像从光里浮出来。
      col = mix(col, uHazeColor, uHaze * .42);

      // 揭幕：五种形状，各自带一圈亮边。距离按 CSS 像素算（uPx = 每 CSS 像素的画布像素）。
      vec2 frag = gl_FragCoord.xy, dv = frag - uReveal.xy;
      float alpha = 0., rim = 0.;
      vec4 over = vec4(0.);
      float aa = 1.5 * uPx;
      if (uRevealType < .5) {            // 气球爆开：边缘有点不规则
        float dist = length(dv), ang = atan(dv.y, dv.x);
        float edge = uReveal.z * (1. + .035 * sin(ang * 9. + uTime * 5.) + .02 * sin(ang * 4. - uTime * 3.));
        alpha = 1. - smoothstep(edge - aa, edge + aa, dist);
        rim = smoothstep(edge - 34. * uPx, edge - 2. * uPx, dist) * alpha;
      } else if (uRevealType < 1.5) {    // 蓝图方块：一格一格翻出来，格线随后淡去
        float cell = uRevealB.x;
        vec2 id = floor(frag / cell), c = (id + .5) * cell;
        float delay = length(c - uReveal.xy) / uRevealB.y * .72 + hash(id) * .28;
        float k = clamp((uReveal.z - delay) / .22, 0., 1.);
        float e = 1. - pow(1. - k, 3.);
        float hs = cell * .5 * e + .5, rr = 7. * uPx * (1. - k);
        vec2 bq = abs(frag - c) - vec2(hs) + rr;
        float d = length(max(bq, 0.)) + min(max(bq.x, bq.y), 0.) - rr;
        alpha = (1. - smoothstep(-1., 1., d)) * step(.001, k);
        rim = (1. - k) * alpha;
        vec2 g = abs(fract(frag / cell) - .5);
        float line = 1. - smoothstep(.5 * uPx, 1.6 * uPx, (.5 - max(g.x, g.y)) * cell);
        over = vec4(.35, .67, .65, 1.) * line * uRevealB.z * alpha;
      } else if (uRevealType < 2.5) {    // 想法云朵：一圈圆鼓鼓的边
        float dist = length(dv), ang = atan(dv.y, dv.x);
        float edge = uReveal.z * (.9 + .16 * sqrt(abs(sin(ang * 3. + uTime * .5))));
        alpha = 1. - smoothstep(edge - aa, edge + aa, dist);
        rim = smoothstep(edge - 40. * uPx, edge - 2. * uPx, dist) * alpha;
      } else if (uRevealType < 3.5) {    // 星星：从笔画出的星星里展开
        float r = uRevealB.x;
        vec2 sp = mat2(cos(r), sin(r), -sin(r), cos(r)) * dv;
        float d = sdStar5(sp, uReveal.z, .52) - uReveal.z * .05;
        alpha = 1. - smoothstep(-aa, aa, d);
        rim = smoothstep(-36. * uPx, -2. * uPx, d) * alpha;
      } else {                           // 彩虹斜切：边上拖着三色彩带
        float d = dot(dv, uRevealB.xy) - uReveal.z;
        alpha = 1. - smoothstep(-aa, aa, d);
        rim = smoothstep(-44. * uPx, -2. * uPx, d) * alpha;
        float bw = uRevealB.z, u = d / bw;
        vec3 rb = mix(vec3(.94, .34, .56), vec3(.99, .80, .36), smoothstep(.31, .35, u));
        rb = mix(rb, vec3(.39, .75, .92), smoothstep(.64, .68, u));
        float ba = smoothstep(-aa, aa, d) * (1. - smoothstep(bw - aa, bw + aa, d));
        over = vec4(rb, 1.) * ba;
      }
      col = mix(col, uRimColor, rim * uRimFade * .55);
      alpha *= uFade;
      vec4 outc = vec4(col * alpha, alpha);
      over *= uFade;
      gl_FragColor = over + outc * (1. - over.a);
    }`;

  const UNIFORMS = ['uRes', 'uImg', 'uPan', 'uAnchor', 'uHopT', 'uHopS', 'uTime', 'uZoom', 'uFade', 'uWobble', 'uBlurBg',
    'uBlurChar', 'uHaze', 'uRot', 'uClipY', 'uCharDepth', 'uRevealType', 'uRimFade', 'uPx', 'uReveal', 'uHazeColor',
    'uRimColor', 'uRevealB', 'uShadow', 'uHair'];

  function createGL(canvas, images, m) {
    const gl = canvas.getContext('webgl', {premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'high-performance'});
    if (!gl) return null;
    const shader = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const U = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)]));
    [['uImage', images.image, false], ['uPlate', images.plate, false], ['uMask', images.mask, false],
      ['uPlateSoft', images.plateSoft, false], ['uCharSoft', images.charSoft, true]].forEach(([name, src, premultiply], unit) => {
      const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    });
    gl.uniform2f(U.uImg, images.image.naturalWidth, images.image.naturalHeight);
    gl.uniform2f(U.uAnchor, m.anchor[0], 1 - m.anchor[1]);
    gl.uniform1f(U.uClipY, m.clipY ? 1 - m.clipY : 0);
    gl.uniform1f(U.uCharDepth, m.charDepth);
    gl.uniform1f(U.uRevealType, m.revealType);
    gl.uniform3f(U.uHazeColor, ...m.haze);
    gl.uniform3f(U.uRimColor, ...m.rim);
    const sh = m.shadow;
    gl.uniform4f(U.uShadow, sh ? sh[0] : 0, sh ? 1 - sh[1] : 0, sh ? sh[2] : 0, sh ? sh[3] : 0);
    gl.uniform4fv(U.uHair, new Float32Array([0, 1, 2].flatMap((i) => m.hair[i] || [2, 2, 2, 2])));
    return {gl, U};
  }

  // ---------- 粒子：按时间计算位置，同一时间永远画出同一帧 ----------
  function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }
  const pick = (r, list) => list[(r() * list.length) | 0];
  const PALETTE = {
    chat: ['#f06aa6', '#ffd166', '#8ecdf0', '#c9a7f5', '#ff9fc6', '#ffffff'],
    project: ['#59aaa5', '#8fd3c9', '#f483b2', '#ffd166', '#ffffff', '#c5e8e2'],
    thinking: ['#c9a7f5', '#b98bd6', '#ffffff', '#ffd9f0', '#9fd2ea', '#fff4b8'],
    learning: ['#f4c66d', '#ffe08a', '#df8fbd', '#c9a7f5', '#ffffff', '#ffd166'],
    unrestricted: ['#ef568f', '#f3ca63', '#63bfe9', '#9be27f', '#c9a7f5', '#ffffff'],
  };

  function drawBalloon(ctx, x, y, s, color, stringLen = 1.6) {
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(160,90,130,.55)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, s * 1.15);
    ctx.bezierCurveTo(-s * .3, s * 1.6, s * .3, s * (1.2 + stringLen * .6), 0, s * (1.15 + stringLen)); ctx.stroke();
    const g = ctx.createRadialGradient(-s * .35, -s * .4, s * .1, 0, 0, s * 1.15);
    g.addColorStop(0, '#ffffff'); g.addColorStop(.25, color); g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, s * .86, s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-s * .12, s * .98); ctx.lineTo(s * .12, s * .98); ctx.lineTo(0, s * 1.15); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function drawConfetti(ctx, x, y, size, rot, color, alpha) {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.rotate(rot);
    ctx.scale(1, Math.cos(rot * 2.3)); ctx.fillStyle = color;
    ctx.fillRect(-size / 2, -size * .3, size, size * .6); ctx.restore();
  }
  function drawSparkle(ctx, x, y, r, rot, color, alpha) {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = color; ctx.translate(x, y); ctx.rotate(rot); ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * .35 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function starPath(ctx, r, inner = .48) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * inner : r;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
  }
  function drawStar5(ctx, x, y, r, rot, color, alpha) {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = color; ctx.lineJoin = 'round'; ctx.strokeStyle = color; ctx.lineWidth = r * .25;
    starPath(ctx, r); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  function drawBubble(ctx, x, y, r, alpha, stroke = 'rgba(168,120,214,.95)') {
    ctx.save(); ctx.globalAlpha *= alpha;
    ctx.shadowColor = 'rgba(150,100,200,.28)'; ctx.shadowBlur = r * .5; ctx.shadowOffsetY = r * .08;
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(2.2, r * .1);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowColor = 'transparent'; ctx.stroke();
    ctx.fillStyle = 'rgba(214,190,240,.9)';
    ctx.beginPath(); ctx.ellipse(x - r * .36, y - r * .38, r * .2, r * .13, -.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawRing(ctx, x, y, r, alpha, color) {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(x - r * .4, y - r * .4, r * .16, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawPaper(ctx, x, y, w, h, rot, color, alpha) {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.rotate(rot); ctx.scale(Math.cos(rot * 1.7), 1);
    ctx.fillStyle = color; ctx.strokeStyle = 'rgba(120,80,110,.18)'; ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, 2.5); else ctx.rect(-w / 2, -h / 2, w, h);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(120,90,130,.28)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) { const yy = -h / 2 + h * (.3 + i * .2); ctx.beginPath(); ctx.moveTo(-w * .3, yy); ctx.lineTo(w * (i === 2 ? .1 : .3), yy); ctx.stroke(); }
    ctx.restore();
  }
  function drawCheck(ctx, x, y, s, rot, color, alpha) {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.rotate(rot);
    ctx.strokeStyle = color; ctx.lineWidth = s * .28; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-s * .5, 0); ctx.lineTo(-s * .12, s * .38); ctx.lineTo(s * .55, -s * .4); ctx.stroke(); ctx.restore();
  }
  function drawStreak(ctx, x0, y0, x1, y1, width, color, alpha) {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.lineCap = 'round';
    const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, color);
    ctx.strokeStyle = g; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore();
  }
  // 加载完成时从进度条末端撒出来的东西，每个模式不一样。
  const DONE_KIND = {chat: 'confetti', project: 'check', thinking: 'bubble', learning: 'star', unrestricted: 'streak'};
  function drawDoneBit(ctx, kind, x, y, p, dt, alpha) {
    const rot = p.rot + p.spin * dt;
    if (kind === 'confetti') drawConfetti(ctx, x, y, p.size, rot, p.color, alpha);
    else if (kind === 'check') {
      if (p.alt) drawCheck(ctx, x, y, p.size * 1.5, rot * .3, '#59aaa5', alpha); else drawConfetti(ctx, x, y, p.size, rot, p.color, alpha);
    } else if (kind === 'bubble') {
      if (p.alt) drawRing(ctx, x, y, p.size * .9, alpha, 'rgba(185,139,214,.9)'); else drawSparkle(ctx, x, y, p.size * .8, rot, p.color, alpha);
    } else if (kind === 'star') drawStar5(ctx, x, y, p.size * .7, rot, p.color, alpha);
    else if (p.alt) drawStar5(ctx, x, y, p.size * .6, rot, p.color, alpha);
    else drawStreak(ctx, x - Math.cos(p.ang) * 18, y - Math.sin(p.ang) * 18, x, y, 3, p.color, alpha);
  }

  function makeParticles(id) {
    const r = rng(7 + id.length * 13), C = PALETTE[id];
    const P = {
      doneBurst: Array.from({length: 26}, () => ({ang: -Math.PI * (.1 + r() * .8), speed: .18 + r() * .32, size: 4 + r() * 4,
        spin: (r() - .5) * .03, rot: r() * 6, color: pick(r, C), life: 650 + r() * 400, alt: r() > .5})),
    };
    if (id === 'chat') {
      P.burst = Array.from({length: 54}, () => ({ang: r() * Math.PI * 2, speed: .45 + r() * .95, size: 5 + r() * 6,
        spin: (r() - .5) * .03, rot: r() * 6, color: pick(r, C), life: 900 + r() * 700}));
      P.rain = Array.from({length: 120}, (_, i) => ({at: 60 + i * (i < 50 ? 22 : 75), x: r(), vy: .07 + r() * .07,
        sway: 18 + r() * 30, phase: r() * 6, freq: .002 + r() * .002, size: 5 + r() * 5, spin: (r() - .5) * .012,
        rot: r() * 6, color: pick(r, C)}));
      P.balloons = Array.from({length: 5}, (_, i) => ({at: 120 + i * 360, x: .08 + i * .085 + r() * .04,
        size: 24 + r() * 16, vy: .055 + r() * .03, sway: 10 + r() * 14, phase: r() * 6, color: ['#f37cb0', '#ffd166', '#8ecdf0', '#c9a7f5', '#ff9fc6'][i]}));
      P.sparkles = Array.from({length: 12}, () => ({ang: Math.PI + r() * Math.PI, dist: 30 + r() * 70, size: 3 + r() * 4, delay: r() * 120}));
    } else if (id === 'project') {
      P.papers = Array.from({length: 11}, () => ({vx: (r() - .5) * .5, vy: -(.55 + r() * .45), spin: (r() - .5) * .016, rot: r() * 6,
        w: 18 + r() * 10, color: pick(r, ['#ffffff', '#ffffff', '#fff3b0', '#ffd6e8', '#c9efe9']), delay: r() * 90, life: 1300 + r() * 500}));
      P.rain = Array.from({length: 46}, (_, i) => ({at: 80 + i * 55, x: r(), vy: .06 + r() * .05, sway: 12 + r() * 20, phase: r() * 6,
        freq: .002 + r() * .002, size: 5 + r() * 4, spin: (r() - .5) * .01, rot: r() * 6, color: pick(r, C)}));
      P.boing = Array.from({length: 5}, (_, i) => ({ang: -Math.PI * (.2 + i * .15)}));
    } else if (id === 'thinking') {
      P.chain = [[.62, .60, 12], [.53, .46, 20], [0, 0, 32]];
      P.rings = Array.from({length: 16}, (_, i) => ({at: 100 + i * 210, x: .05 + r() * .5, r: 6 + r() * 14, vy: .035 + r() * .03,
        sway: 8 + r() * 16, phase: r() * 6}));
      P.converge = Array.from({length: 12}, (_, i) => ({ang: i / 12 * Math.PI * 2 + r() * .3, dist: 70 + r() * 50, size: 3 + r() * 3}));
      P.twinkles = [[.533, .085, 0], [.655, .07, 1.2], [.715, .155, 2.1], [.60, .17, 3]];
      P.idea = Array.from({length: 14}, () => ({ang: r() * Math.PI * 2, speed: .12 + r() * .16, size: 3 + r() * 3, color: pick(r, C)}));
    } else if (id === 'learning') {
      P.rain = Array.from({length: 40}, (_, i) => ({at: 60 + i * 70, x: r(), vy: .05 + r() * .05, sway: 10 + r() * 18, phase: r() * 6,
        freq: .002 + r() * .002, size: 4 + r() * 4, spin: (r() - .5) * .006, rot: r() * 6, color: pick(r, ['#f4c66d', '#ffe08a', '#ffffff', '#df8fbd'])}));
      P.papers = Array.from({length: 6}, (_, i) => ({at: 150 + i * 420, y: .15 + r() * .5, vx: .09 + r() * .05, sway: 30 + r() * 30,
        phase: r() * 6, rot: r() * 6, spin: (r() - .5) * .004, w: 22 + r() * 10}));
      P.noteStars = Array.from({length: 14}, () => ({ang: -Math.PI * (.15 + r() * .7), speed: .22 + r() * .24, size: 6 + r() * 5,
        spin: (r() - .5) * .02, rot: r() * 6, color: pick(r, ['#f4c66d', '#ffe08a', '#ffffff'])}));
      P.aha = Array.from({length: 12}, () => ({ang: -Math.PI * (.45 + r() * .6), speed: .2 + r() * .22, size: 5 + r() * 5}));
    } else if (id === 'unrestricted') {
      P.speed = Array.from({length: 18}, () => ({y: r(), len: 80 + r() * 160, delay: r() * 260, v: 2.2 + r() * 1.6, w: 1.5 + r() * 2}));
      P.streamers = Array.from({length: 18}, (_, i) => ({at: 40 + i * 120, x: r(), vy: .08 + r() * .06, phase: r() * 6,
        color: pick(r, ['#ef568f', '#f3ca63', '#63bfe9', '#9be27f', '#c9a7f5']), len: 26 + r() * 20}));
      P.rain = Array.from({length: 50}, (_, i) => ({at: 40 + i * 50, x: r(), vy: .08 + r() * .07, sway: 14 + r() * 22, phase: r() * 6,
        freq: .002 + r() * .003, size: 4 + r() * 4, spin: (r() - .5) * .02, rot: r() * 6, color: pick(r, C)}));
      P.splash = Array.from({length: 9}, () => ({ang: -Math.PI * (.12 + r() * .76), speed: .1 + r() * .12, size: 2.5 + r() * 2.5, color: pick(r, C)}));
    }
    return P;
  }

  const STAR_TILT = -.25;  // 画出来的星星稍微歪一点
  const cloudOrigin = (v) => ({x: v.w * .41, y: v.h * .33});
  const starOrigin = (v) => ({x: v.w * .43, y: v.h * .37});

  // 每个模式的粒子（ctx 是 CSS 像素坐标）。env：view、parts、时间点、toScreen。
  const FX = {
    chat(ctx, t, s, e) {
      const {view, parts, POP, HOP} = e;
      const pop = {x: view.w * .3, y: view.h * .42};
      // 揭幕前：气球鼓起来；然后「啵」
      if (t < POP) {
        const k = easeOutBack(clamp(t / (POP - 40)), 2.4), wob = 1 + .05 * Math.sin(t / 22);
        drawBalloon(ctx, pop.x, pop.y - 10, 34 * k * wob, '#f06aa6', .9);
      } else if (t < POP + 260) {
        const k = (t - POP) / 260;
        ctx.save(); ctx.strokeStyle = `rgba(240,106,166,${1 - k})`; ctx.lineWidth = 3; ctx.lineCap = 'round';
        for (let i = 0; i < 10; i++) {
          const a = i / 10 * Math.PI * 2, r0 = 30 + 60 * k, r1 = r0 + 24 * (1 - k);
          ctx.beginPath(); ctx.moveTo(pop.x + Math.cos(a) * r0, pop.y + Math.sin(a) * r0); ctx.lineTo(pop.x + Math.cos(a) * r1, pop.y + Math.sin(a) * r1); ctx.stroke();
        }
        ctx.restore();
      }
      for (const p of parts.burst) {
        const dt = t - POP; if (dt < 0 || dt > p.life) continue;
        const x = pop.x + Math.cos(p.ang) * p.speed * dt * (1 - dt / 4000);
        const y = pop.y + Math.sin(p.ang) * p.speed * dt * (1 - dt / 4000) + .00045 * dt * dt;
        drawConfetti(ctx, x, y, p.size, p.rot + p.spin * dt, p.color, 1 - clamp((dt - p.life * .6) / (p.life * .4)));
      }
      e.fallRain(t, parts.rain, (x, y, p, dt) => drawConfetti(ctx, x, y, p.size, p.rot + p.spin * dt, p.color, .9));
      for (const b of parts.balloons) {
        const dt = t - POP - b.at; if (dt < 0) continue;
        const y = view.h + 60 - b.vy * dt; if (y < -120) continue;
        const x = b.x * view.w + Math.sin(b.phase + dt / 700) * b.sway;
        ctx.save(); ctx.globalAlpha *= .9; drawBalloon(ctx, x, y, b.size, b.color); ctx.restore();
      }
      // 落地时脚边的小星光
      const land = t - (HOP + 520);
      if (land > 0 && land < 700) {
        const f = e.toScreen(e.m.anchor[0], e.m.anchor[1], s);
        for (const sp of parts.sparkles) {
          const k = clamp((land - sp.delay) / 500); if (k <= 0 || k >= 1) continue;
          drawSparkle(ctx, f.x + Math.cos(sp.ang) * sp.dist * easeOutCubic(k), f.y - 8 + Math.sin(sp.ang) * sp.dist * .5 * easeOutCubic(k),
            sp.size * (1 - k * .5), k * 2, '#fff4b8', 1 - k);
        }
      }
    },

    project(ctx, t, s, e) {
      const {view, parts, POP, HOP} = e;
      // 揭幕前：蓝图格线从左边、下边画出来（和揭幕方块的格子对齐）
      const gridOut = 1 - clamp((t - POP - 200) / 500);
      if (gridOut > 0) {
        ctx.save(); ctx.strokeStyle = 'rgba(89,170,165,.5)'; ctx.lineWidth = 1; ctx.globalAlpha *= gridOut;
        const cols = Math.ceil(view.w / 64), rows = Math.ceil(view.h / 64);
        for (let i = 1; i <= cols; i++) {
          const k = easeOutCubic(clamp((t - ((i * 37) % 11) * 11) / (POP + 40)));
          if (k <= 0) continue;
          ctx.beginPath(); ctx.moveTo(i * 64, view.h); ctx.lineTo(i * 64, view.h * (1 - k)); ctx.stroke();
        }
        for (let j = 1; j <= rows; j++) {
          const k = easeOutCubic(clamp((t - ((j * 29) % 7) * 15) / (POP + 40)));
          if (k <= 0) continue;
          const y = view.h - j * 64;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(view.w * k, y); ctx.stroke();
        }
        ctx.restore();
      }
      e.fallRain(t, parts.rain, (x, y, p, dt) => drawConfetti(ctx, x, y, p.size, p.rot + p.spin * dt, p.color, .85));
      // 碧琪冒出来时，抽屉里的文件跟着飞出来
      const out = t - HOP - 60, drawer = e.toScreen(.78, .70, s, 'plate');
      for (const p of parts.papers) {
        const dt = out - p.delay; if (dt < 0 || dt > p.life) continue;
        const x = drawer.x + p.vx * dt, y = drawer.y + p.vy * dt + .0011 * dt * dt;
        drawPaper(ctx, x, y, p.w, p.w * 1.25, p.rot + p.spin * dt, p.color, 1 - clamp((dt - p.life * .7) / (p.life * .3)));
      }
      // 落定的一瞬间，头顶「噔」几道线
      const land = t - HOP - 300;
      if (land > 0 && land < 420) {
        const k = land / 420, head = e.toScreen(.76, .11, s);
        ctx.save(); ctx.globalAlpha *= 1 - k; ctx.strokeStyle = '#59aaa5'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        for (const b of parts.boing) {
          const r0 = 26 + 30 * easeOutCubic(k), r1 = r0 + 16 * (1 - k);
          ctx.beginPath(); ctx.moveTo(head.x + Math.cos(b.ang) * r0, head.y + Math.sin(b.ang) * r0);
          ctx.lineTo(head.x + Math.cos(b.ang) * r1, head.y + Math.sin(b.ang) * r1); ctx.stroke();
        }
        ctx.restore();
      }
    },

    thinking(ctx, t, s, e) {
      const {view, parts, POP, HOP} = e;
      // 揭幕前：冒出三个想法泡泡，最后一个鼓成云朵
      const c = cloudOrigin(view);
      parts.chain.forEach(([fx, fy, r], i) => {
        const k = clamp((t - i * 120) / 220);
        if (k <= 0) return;
        const x = i === 2 ? c.x : view.w * fx, y = i === 2 ? c.y : view.h * fy;
        const fadeOut = 1 - clamp((t - POP - 60 * (2 - i)) / 260);
        if (fadeOut <= 0) return;
        const grow = i === 2 ? 1 + easeInQuad(clamp((t - POP + 120) / 120)) * .45 : 1;
        drawBubble(ctx, x, y, r * easeOutBack(k, 2.6) * grow, fadeOut);
      });
      // 慢慢升起的小泡泡圈
      for (const b of parts.rings) {
        const dt = t - POP - b.at; if (dt < 0) continue;
        const y = view.h + 30 - b.vy * dt; if (y < -40) continue;
        drawRing(ctx, b.x * view.w + Math.sin(b.phase + dt / 800) * b.sway, y, b.r, .75 * clamp(dt / 300), 'rgba(185,139,214,.75)');
      }
      // 画里头顶那几颗星星一闪一闪
      const tw = clamp((t - POP - 300) / 400);
      if (tw > 0) for (const [ix, iy, ph] of parts.twinkles) {
        const p = e.toScreen(ix, iy, s, 'plate'), k = .5 + .5 * Math.sin(t / 260 + ph);
        drawSparkle(ctx, p.x, p.y, 6 + 6 * k, t / 900 + ph, '#fffbe0', tw * (.35 + .65 * k));
      }
      // 「叮」：四周的小火花聚到头顶，然后亮一下
      const idea = e.toScreen(.645, .10, s), h = t - HOP;
      if (h > -260 && h < 0) {
        const k = easeInQuad(clamp((h + 260) / 260));
        for (const p of parts.converge) drawSparkle(ctx, idea.x + Math.cos(p.ang) * p.dist * (1 - k), idea.y + Math.sin(p.ang) * p.dist * (1 - k),
          p.size, p.ang + k * 3, '#fff4b8', .4 + .6 * k);
      }
      if (h >= 0 && h < 700) {
        const k = h / 700;
        ctx.save(); ctx.globalAlpha *= 1 - k;
        const g = ctx.createRadialGradient(idea.x, idea.y, 0, idea.x, idea.y, 70);
        g.addColorStop(0, 'rgba(255,250,214,.95)'); g.addColorStop(1, 'rgba(255,250,214,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(idea.x, idea.y, 70 * (.6 + .4 * easeOutCubic(k)), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        drawSparkle(ctx, idea.x, idea.y, 26 * easeOutBack(clamp(h / 260), 2.2) * (1 - k * .4), k * 1.2, '#ffffff', 1 - easeInQuad(k));
        drawRing(ctx, idea.x, idea.y, 18 + 60 * easeOutCubic(k), (1 - k) * .8, 'rgba(255,214,120,.9)');
        for (const p of parts.idea) drawSparkle(ctx, idea.x + Math.cos(p.ang) * p.speed * h, idea.y + Math.sin(p.ang) * p.speed * h,
          p.size * (1 - k), p.ang + k * 4, p.color, 1 - k);
      }
    },

    learning(ctx, t, s, e) {
      const {view, parts, POP, HOP} = e;
      // 揭幕前：一颗发光的笔尖画出星星，画完星星就展开
      const o = starOrigin(view);
      if (t < POP + 120) {
        const k = easeInOutCubic(clamp(t / (POP - 40))), R = 56;
        ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(STAR_TILT);
        ctx.globalAlpha *= 1 - clamp((t - POP) / 120);
        ctx.strokeStyle = '#f4c66d'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        starPath(ctx, R, .52);
        const len = 10 * Math.hypot(R - R * .52 * Math.cos(Math.PI / 5), R * .52 * Math.sin(Math.PI / 5));
        ctx.setLineDash([len * k, len]); ctx.stroke(); ctx.setLineDash([]);
        if (k >= 1) { ctx.fillStyle = 'rgba(255,236,170,.75)'; ctx.fill(); }
        ctx.restore();
        if (k < 1) {
          // 笔尖沿着星星的边走
          const seg = k * 10, i = Math.floor(seg), f = seg - i;
          const pt = (j) => { const a = -Math.PI / 2 + j * Math.PI / 5, rr = j % 2 ? R * .52 : R; return [Math.cos(a) * rr, Math.sin(a) * rr]; };
          const [ax, ay] = pt(i), [bx, by] = pt(i + 1);
          const c = Math.cos(STAR_TILT), sn = Math.sin(STAR_TILT), px = lerp(ax, bx, f), py = lerp(ay, by, f);
          drawSparkle(ctx, o.x + c * px - sn * py, o.y + sn * px + c * py, 9, t / 60, '#fffbe0', 1);
        }
      }
      e.fallRain(t, parts.rain, (x, y, p, dt) => drawStar5(ctx, x, y, p.size * .6, p.rot + p.spin * dt, p.color, .85));
      // 飘过的纸页
      for (const p of parts.papers) {
        const dt = t - POP - p.at; if (dt < 0) continue;
        const x = view.w + 30 - p.vx * dt; if (x < -40) continue;
        const y = p.y * view.h + Math.sin(p.phase + dt / 600) * p.sway;
        drawPaper(ctx, x, y, p.w, p.w * 1.3, p.rot + p.spin * dt + Math.sin(dt / 500) * .4, 'rgba(255,255,255,.92)', .8);
      }
      // 举手那一下：蹄尖「灵光一闪」迸出火花，笔记本上的星星蹦出小星星
      const h = t - HOP;
      if (h > 0 && h < 700) {
        const k = h / 700, hoof = e.toScreen(.52, .31, s);
        ctx.save(); ctx.globalAlpha *= 1 - k;
        const g = ctx.createRadialGradient(hoof.x, hoof.y, 0, hoof.x, hoof.y, 90);
        g.addColorStop(0, 'rgba(255,240,170,.9)'); g.addColorStop(1, 'rgba(255,240,170,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hoof.x, hoof.y, 90 * (.5 + .5 * easeOutCubic(k)), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        drawRing(ctx, hoof.x, hoof.y, 20 + 70 * easeOutCubic(k), (1 - k) * .9, 'rgba(244,190,90,.95)');
        for (const p of parts.aha) drawSparkle(ctx, hoof.x + Math.cos(p.ang) * p.speed * h, hoof.y + Math.sin(p.ang) * p.speed * h,
          p.size * (1 - k * .6), p.ang + k * 4, '#fff1a8', 1 - easeInQuad(k));
        const note = e.toScreen(.813, .82, s);
        for (const p of parts.noteStars) {
          const x = note.x + Math.cos(p.ang) * p.speed * h, y = note.y + Math.sin(p.ang) * p.speed * h + .0005 * h * h;
          drawStar5(ctx, x, y, p.size * (1 - k * .5), p.rot + p.spin * h, p.color, 1 - easeInQuad(k));
        }
      }
    },

    unrestricted(ctx, t, s, e) {
      const {view, parts, POP, HOP, REVEAL} = e;
      // 揭幕前：一道彩虹流星横着冲过去
      if (t < POP + 160) {
        const k = easeInOutCubic(clamp(t / POP)), y = view.h * .46, head = -60 + (view.w + 120) * k;
        const fade = 1 - clamp((t - POP) / 160);
        ['#63bfe9', '#f3ca63', '#ef568f'].forEach((c, i) => drawStreak(ctx, head - 260, y + (i - 1) * 9, head, y + (i - 1) * 9, 8, c, .95 * fade));
        drawSparkle(ctx, head + 6, y, 14, t / 40, '#ffffff', fade);
      }
      // 斜切扫过时的速度线
      const sl = t - POP;
      if (sl > 0 && sl < REVEAL + 300) for (const p of parts.speed) {
        const dt = sl - p.delay; if (dt < 0) continue;
        const x = -p.len + p.v * dt, y = p.y * view.h;
        if (x > view.w + 20) continue;
        drawStreak(ctx, x, y, x + p.len, y, p.w, 'rgba(255,255,255,.95)', .8 * (1 - clamp((sl - REVEAL) / 300)));
      }
      // 彩带卷卷和星星纸屑
      for (const p of parts.streamers) {
        const dt = t - POP - p.at; if (dt < 0) continue;
        const y = -30 + p.vy * dt; if (y > view.h + 40) continue;
        const x = p.x * view.w + Math.sin(p.phase + dt / 500) * 16;
        ctx.save(); ctx.strokeStyle = p.color; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.globalAlpha *= .9; ctx.beginPath();
        for (let i = 0; i <= 12; i++) { const u = i / 12; ctx.lineTo(x + Math.sin(u * 9 + dt / 140 + p.phase) * 6, y - u * p.len); }
        ctx.stroke(); ctx.restore();
      }
      e.fallRain(t, parts.rain, (x, y, p, dt) => (p.size > 6 ? drawStar5(ctx, x, y, p.size * .55, p.rot + p.spin * dt, p.color, .9)
        : drawConfetti(ctx, x, y, p.size, p.rot + p.spin * dt, p.color, .9)));
      // 每踩一拍，脚下溅起一小圈亮点
      const h = t - HOP;
      if (h > 0) {
        const beat = Math.floor(h / 400), local = h - beat * 400;
        if (beat < 4 && local < 360) {
          const foot = e.toScreen(e.m.anchor[0], e.m.anchor[1], s), k = local / 360, amp = lerp(1, .5, beat / 3);
          for (const p of parts.splash) drawSparkle(ctx, foot.x + Math.cos(p.ang) * p.speed * local * 1.6 * amp,
            foot.y - 6 + Math.sin(p.ang) * p.speed * local * amp + .0007 * local * local, p.size, k * 3, p.color, 1 - k);
        }
      }
    },
  };

  // ---------- 素材 ----------
  const reduced = () => Boolean(root.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  let webglChecked = null;
  function webglAvailable() {
    if (webglChecked !== null) return webglChecked;
    try {
      const probe = root.document.createElement('canvas');
      const gl = probe.getContext('webgl');
      webglChecked = Boolean(gl);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { webglChecked = false; }
    return webglChecked;
  }
  const supported = (id) => Boolean(MODES[id]) && !reduced() && webglAvailable()
    && root.localStorage?.getItem?.('laolao:mode-transition-fx') !== 'off';

  // 空闲时只把文件拉进 HTTP 缓存；真正解码留到切换那一刻。
  const warmed = new Set();
  function warm(id) {
    if (!MODES[id] || warmed.has(id) || typeof root.fetch !== 'function') return;
    warmed.add(id);
    const urls = assetUrls(id);
    for (const key of ['image', 'mask', 'plate', 'plateSoft', 'charSoft']) root.fetch(urls[key], {cache: 'force-cache'}).catch(() => {});
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new root.Image();
      image.decoding = 'async';
      image.onload = () => (image.decode ? image.decode().then(() => resolve(image), () => resolve(image)) : resolve(image));
      image.onerror = () => reject(new Error(`load ${src}`));
      image.src = src;
    });
  }
  function withTimeout(promise, ms) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = root.setTimeout(() => reject(new Error('timeout')), ms); })])
      .finally(() => root.clearTimeout(timer));
  }

  // ---------- 转场 DOM ----------
  const el = (tag, className, attrs = {}) => {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  function buildOverlay(mode) {
    const overlay = el('section', `laolao-mode-transition laolao-mode-transition--fx laolao-mode-transition--${mode.id}`, {
      role: 'status', 'aria-live': 'polite', 'aria-label': `正在切换到${mode.label}`,
    });
    const glCanvas = el('canvas', 'laolao-mode-transition__gl', {'aria-hidden': 'true'});
    const veil = el('div', 'laolao-mode-transition__veil');
    const content = el('div', 'laolao-mode-transition__content');
    const eyebrow = el('p', 'laolao-mode-transition__eyebrow');
    eyebrow.textContent = '碧琪的模式切换';
    const title = el('h2', 'laolao-mode-transition__title', {'aria-label': mode.label});
    [...mode.label].forEach((char, i) => {
      const span = el('span', '', {'aria-hidden': 'true'});
      span.style.setProperty('--i', String(i));
      span.textContent = char;
      title.append(span);
    });
    const progress = el('div', 'laolao-mode-transition__progress', {role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '8'});
    const fill = el('span', 'laolao-mode-transition__fill');
    fill.append(el('span', 'laolao-mode-transition__gloss'), el('span', 'laolao-mode-transition__dots'));
    const tip = el('span', 'laolao-mode-transition__tip', {'aria-hidden': 'true'});
    tip.append(el('i', 'laolao-mode-transition__star'), el('i', 'laolao-mode-transition__star'));
    const message = el('span', 'laolao-mode-transition__message');
    const msg = el('span', 'laolao-mode-transition__msg');
    message.append(msg);
    const lit = el('span', 'laolao-mode-transition__message laolao-mode-transition__message--lit', {'aria-hidden': 'true'});
    const litMsg = el('span', 'laolao-mode-transition__msg');
    lit.append(litMsg);
    const percentage = el('span', 'laolao-mode-transition__percentage');
    const flash = el('span', 'laolao-mode-transition__flash', {'aria-hidden': 'true'});
    progress.append(fill, tip, message, lit, percentage, flash);
    content.append(eyebrow, title, progress);
    const fxCanvas = el('canvas', 'laolao-mode-transition__particles', {'aria-hidden': 'true'});
    overlay.append(glCanvas, veil, content, fxCanvas);
    return {overlay, glCanvas, fxCanvas, content, progress, fill, tip, lit, messages: [msg, litMsg], percentage};
  }

  // ---------- 一次转场 ----------
  function play(mode, hooks = {}) {
    if (!supported(mode.id)) return null;
    const m = MODES[mode.id];
    const POP = m.pop, REVEAL = m.reveal, HOP = POP + m.hop, COPY_IN = POP + COPY_DELAY;
    const ui = buildOverlay(mode);
    const parts = makeParticles(mode.id);
    const view = {w: 1, h: 1, glScale: 1, fxScale: 1};
    let gl = null, U = null, fx = null, images = null;
    let startAt = 0, readyAt = Infinity, readyProgress = .72, exitAt = Infinity, raf = 0;
    let phraseKey = '', copyStep = 0, waitingText = '', finished = false, destroyed = false;
    let resolveCovered, resolveFinished, rejectReady;
    const covered = new Promise((resolve) => { resolveCovered = resolve; });
    const done = new Promise((resolve) => { resolveFinished = resolve; });
    const phrases = mode.phrases?.length ? mode.phrases : [''];

    const resize = () => {
      const rect = ui.overlay.getBoundingClientRect();
      view.w = Math.max(1, rect.width); view.h = Math.max(1, rect.height);
      const dpr = root.devicePixelRatio || 1;
      // 素材只有 1672 像素宽，画布再大也不会更清楚；按需封顶，省 GPU。
      view.glScale = Math.min(dpr, Math.max(1, 2000 / view.w), 2);
      view.fxScale = Math.min(dpr, 2);
      ui.glCanvas.width = Math.round(view.w * view.glScale); ui.glCanvas.height = Math.round(view.h * view.glScale);
      ui.fxCanvas.width = Math.round(view.w * view.fxScale); ui.fxCanvas.height = Math.round(view.h * view.fxScale);
      gl?.viewport(0, 0, ui.glCanvas.width, ui.glCanvas.height);
    };

    // 进度：文字出现时从 8% 开始，等待中逼近 72% 再慢慢爬；目的地就绪后 380ms 走完。
    const waitingProgress = (t) => {
      const w = t - COPY_IN;
      if (w <= EXPECTED_WAIT) return .08 + .64 * easeOutCubic(clamp(w / EXPECTED_WAIT));
      return .72 + .22 * (1 - Math.exp(-(w - EXPECTED_WAIT) / 4000));
    };
    const progressAt = (t) => (t < readyAt ? waitingProgress(t) : lerp(readyProgress, 1, easeOutCubic(clamp((t - readyAt) / FINISH))));

    const revealAt = (t) => {
      const W = view.w * view.glScale, H = view.h * view.glScale, d = view.glScale;
      const k = clamp((t - POP) / REVEAL), started = t >= POP;
      const far = (x, y) => Math.max(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y));
      const rimFade = 1 - smooth(clamp((k - .7) / .3));
      if (m.revealType === 0) return {o: [view.w * .3 * d, view.h * .58 * d], z: started ? easeOutQuart(k) * Math.hypot(W, H) * 1.05 : 0, b: [0, 0, 0], rimFade};
      if (m.revealType === 1) {
        const grid = .5 * (1 - smooth(clamp((t - POP - REVEAL * .55) / 700)));
        return {o: [0, H * .5], z: started ? easeOutCubic(k) * 1.25 : -1, b: [64 * d, far(0, H * .5), grid], rimFade};
      }
      if (m.revealType === 2) {
        const c = cloudOrigin(view), o = [c.x * d, (view.h - c.y) * d];
        return {o, z: started ? 44 * d + easeOutQuart(k) * far(o[0], o[1]) * 1.02 : 0, b: [0, 0, 0], rimFade};
      }
      if (m.revealType === 3) {
        const c = starOrigin(view), o = [c.x * d, (view.h - c.y) * d];
        const z = started ? 56 * d + (easeInOutCubic(k) * .7 + easeOutQuart(k) * .3) * far(o[0], o[1]) * 3 : 0;
        return {o, z, b: [STAR_TILT * (1 - k) + Math.sin(t / 900) * .04, 0, 0], rimFade};
      }
      const ang = .32, n = [Math.cos(ang), Math.sin(ang)], band = 58 * d;
      const total = W * n[0] + H * n[1] + band + 4;
      return {o: [0, 0], z: started ? easeInOutCubic(k) * total : -band - 10, b: [n[0], n[1], band], rimFade};
    };

    const state = (t) => {
      const tRel = t - POP;
      const exit = clamp((t - exitAt) / EXIT);
      const zoom = tRel < 0 ? 1.09 : lerp(1.09, 1, easeOutCubic(clamp(tRel / 1500))) + .006 * Math.sin(t / 1400);
      const panX = tRel < 0 ? .025 : lerp(.025, 0, easeOutCubic(clamp(tRel / 1500))) + .003 * Math.sin(t / 1700);
      // 对焦：先朦胧发亮，焦点先落到碧琪，背景随后清晰；退场时反过来轻微失焦。
      const blurChar = Math.max(1 - smooth(clamp((t - (POP + 120)) / 620)), exit * .7);
      const blurBg = Math.max(1 - smooth(clamp((t - (POP + 260)) / 900)), exit * .8);
      const haze = Math.max(t < POP ? 1 : 1 - easeOutCubic(clamp(tRel / 820)), exit * .35);
      return {zoom: zoom + exit * .05, panX, ...m.motion(t, t - HOP, POP), fade: 1 - easeInQuad(exit), exit, blurChar, blurBg, haze};
    };

    // 图片上的一点在画面上的位置（char 跟着碧琪动，plate 跟着背景动）。
    const toScreen = (ix, iy, s, layer = 'char') => {
      let u = ix, v = 1 - iy, p0;
      const ia = images.image.naturalWidth / images.image.naturalHeight;
      if (layer === 'char') {
        let qx = (u - m.anchor[0]) * s.sx * ia, qy = (v - (1 - m.anchor[1])) * s.sy;
        const c = Math.cos(s.rot), sn = Math.sin(s.rot);
        [qx, qy] = [c * qx - sn * qy, sn * qx + c * qy];
        u = m.anchor[0] + qx / ia; v = 1 - m.anchor[1] + qy + s.ty;
        const zc = 1 + (s.zoom - 1) * m.charDepth;
        p0 = [.5 + (u - .5 - s.panX * m.charDepth) * zc, .5 + (v - .5) * zc];
      } else {
        const depth = lerp(.35, 1, 1 - smooth(clamp((v - .05) / .5)));
        const zb = lerp(1, s.zoom, depth);
        p0 = [.5 + (u - .5 - s.panX * depth) * zb, .5 + (v - .5) * zb];
      }
      const sa = view.w / view.h;
      let [x, y] = p0;
      if (sa > ia) y = (y - .5) / (ia / sa) + .5; else x = (x - .5) / (sa / ia) + .5;
      return {x: x * view.w, y: (1 - y) * view.h};
    };
    const fallRain = (t, list, draw) => {
      for (const p of list) {
        const dt = t - POP - p.at; if (dt < 0) continue;
        const y = -20 + p.vy * dt; if (y > view.h + 20) continue;
        draw(p.x * view.w + Math.sin(p.phase + dt * p.freq) * p.sway, y, p, dt);
      }
    };
    const env = {view, parts, POP, HOP, REVEAL, m, toScreen, fallRain};

    const render = (t) => {
      const s = state(t), rv = revealAt(t);
      gl.uniform2f(U.uRes, ui.glCanvas.width, ui.glCanvas.height);
      gl.uniform1f(U.uPx, view.glScale);
      gl.uniform1f(U.uTime, t / 1000);
      gl.uniform1f(U.uZoom, s.zoom);
      gl.uniform2f(U.uPan, s.panX, 0);
      gl.uniform2f(U.uHopT, 0, s.ty);
      gl.uniform2f(U.uHopS, s.sx, s.sy);
      gl.uniform1f(U.uRot, s.rot);
      gl.uniform1f(U.uFade, s.fade);
      gl.uniform1f(U.uWobble, clamp((t - POP) / 600));
      gl.uniform1f(U.uBlurBg, s.blurBg);
      gl.uniform1f(U.uBlurChar, s.blurChar);
      gl.uniform1f(U.uHaze, s.haze);
      gl.uniform3f(U.uReveal, rv.o[0], rv.o[1], rv.z);
      gl.uniform4f(U.uRevealB, rv.b[0], rv.b[1], rv.b[2], m.shadow ? m.shadow[4] : 0);
      gl.uniform1f(U.uRimFade, rv.rimFade);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      fx.setTransform(view.fxScale, 0, 0, view.fxScale, 0, 0);
      fx.clearRect(0, 0, view.w, view.h);
      fx.globalAlpha = s.fade;
      FX[mode.id](fx, t, s, env);
      // 加载完成：从进度条末端撒一把
      const doneAt = t - (readyAt + FINISH);
      if (doneAt > 0) {
        const bar = ui.progress.getBoundingClientRect(), box = ui.overlay.getBoundingClientRect();
        const x0 = bar.right - box.left - 14, y0 = bar.top - box.top + bar.height / 2;
        for (const p of parts.doneBurst) {
          if (doneAt > p.life) continue;
          const x = x0 + Math.cos(p.ang) * p.speed * doneAt, y = y0 + Math.sin(p.ang) * p.speed * doneAt + .0006 * doneAt * doneAt;
          drawDoneBit(fx, DONE_KIND[mode.id], x, y, p, doneAt, 1 - clamp((doneAt - p.life * .6) / (p.life * .4)));
        }
      }
    };

    const setMessage = (text, ready = false) => {
      ui.progress.classList.toggle('is-done', ready);
      for (const node of ui.messages) {
        node.textContent = text;
        node.classList.remove('is-swapping'); void node.offsetWidth; node.classList.add('is-swapping');
      }
    };

    const syncDom = (t) => {
      if (copyStep === 0 && t >= COPY_IN) { ui.overlay.classList.add('is-copy-in'); copyStep = 1; }
      const p = progressAt(t), ready = t >= readyAt + FINISH;
      // 填充按宽度走（最短一个圆头），圆头和彩点不会被压扁。
      const w = ui.progress.clientWidth, h = ui.progress.clientHeight, filled = h + (w - h) * p;
      ui.fill.style.width = `${filled.toFixed(1)}px`;
      ui.lit.style.clipPath = `inset(0 ${(w - filled).toFixed(1)}px 0 0)`;
      ui.tip.style.translate = `${filled.toFixed(1)}px 0`;
      ui.progress.style.setProperty('--laolao-progress', p.toFixed(3));
      const value = String(Math.round(p * 100));
      if (ui.progress.getAttribute('aria-valuenow') !== value) ui.progress.setAttribute('aria-valuenow', value);
      const index = Math.floor(Math.max(0, t - COPY_IN) / PHRASE_EVERY);
      const key = ready ? 'ready' : (index >= phrases.length + 3 && waitingText ? 'waiting' : String(Math.min(phrases.length - 1, index)));
      if (key !== phraseKey) {
        phraseKey = key;
        setMessage(key === 'ready' ? mode.readyPhrase : key === 'waiting' ? waitingText : phrases[+key], key === 'ready');
      }
      if (t >= readyAt && exitAt === Infinity) exitAt = Math.max(readyAt + FINISH + 300, HOP + 820, POP + REVEAL + 200);
      if (t >= exitAt && copyStep === 1) {
        copyStep = 2;
        ui.overlay.classList.add('is-leaving');
        try { hooks.onExit?.(); } catch {}
      }
    };

    const cleanup = () => {
      if (destroyed) return;
      destroyed = true;
      root.cancelAnimationFrame(raf);
      root.removeEventListener('resize', resize);
      try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch {}
      ui.overlay.remove();
      resolveCovered();
      resolveFinished();
    };

    const tick = (now) => {
      if (destroyed) return;
      const t = now - startAt;
      syncDom(t);
      render(t);
      if (t >= POP + REVEAL + 16) resolveCovered();
      if (t >= exitAt + EXIT) { cleanup(); return; }
      raf = root.requestAnimationFrame(tick);
    };

    const ready = (async () => {
      const urls = assetUrls(mode.id);
      const entries = await withTimeout(Promise.all(Object.entries(urls).map(async ([key, url]) => [key, await loadImage(url)])), LOAD_TIMEOUT);
      if (destroyed) throw new Error('aborted');
      images = Object.fromEntries(entries);
      root.document.body.append(ui.overlay);
      resize();
      const created = createGL(ui.glCanvas, images, m);
      if (!created) throw new Error('webgl');
      ({gl, U} = created);
      fx = ui.fxCanvas.getContext('2d');
      root.addEventListener('resize', resize);
      setMessage(phrases[0]);
      startAt = root.performance.now();
      render(0);
      raf = root.requestAnimationFrame(tick);
    })();
    ready.catch(() => cleanup());

    return {
      overlay: ui.overlay,
      ready,
      // 揭幕完全盖住旧页面后再换路由，换页过程藏在画面后面。
      covered,
      // 目的地已就绪：进度走完、完成动效、退场，结束后移除浮层。
      finish() {
        if (!finished && !destroyed) {
          finished = true;
          const t = root.performance.now() - startAt;
          readyProgress = waitingProgress(t);
          readyAt = Math.max(t, COPY_IN);
          // 窗口被隐藏时动画时钟会停，不能让浮层一直挡着。
          if (root.document.hidden) cleanup();
          else root.setTimeout(cleanup, Math.max(readyAt + FINISH + 300, HOP + 820) - t + EXIT + 1500);
        }
        return done;
      },
      waiting(text) { waitingText = text; },
      abort: cleanup,
    };
  }

  return {supported, warm, play, assetUrls, modes: Object.keys(MODES), _test: {MODES, makeParticles, keys}};
});
