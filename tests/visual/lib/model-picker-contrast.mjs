// 真页面 model-picker 触发按钮的对比度量法（B11·model-picker，macdev5）。
// - 档位字（.pinkie-external-tier，background-clip:text）：有字截一张、把字藏掉再截一张，逐列取最大对比，按 binPx 分箱取最浅箱。
//   与 tests/effort-tier-ink-b11.test.mjs 同一量法。
// - 触发按钮边框：computed border-top-color 叠在外层实际底色上，对外层底算 WCAG 对比；透明 / 无边框记 1。
import zlib from 'node:zlib';

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

export function decodePng(buf) {
  let o = 8, w = 0, h = 0, type = 0; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), kind = buf.toString('latin1', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); type = d[9]; } else if (kind === 'IDAT') idat.push(d); else if (kind === 'IEND') break;
    o += 12 + len;
  }
  const ch = type === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch] : 0, b = y ? px[up + x] : 0, c = x >= ch && y ? px[up + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  return {width: w, height: h, rgb: (x, y) => { const i = y * stride + x * ch; return [px[i], px[i + 1], px[i + 2]]; }};
}

export function palest(withBuf, withoutBuf, binPx) {
  const A = decodePng(withBuf), B = decodePng(withoutBuf), cols = [];
  for (let x = 0; x < A.width; x++) {
    let best = 1, n = 0;
    for (let y = 0; y < A.height; y++) { const r = contrast(A.rgb(x, y), B.rgb(x, y)); if (r > 1.15) n++; if (r > best) best = r; }
    cols.push(n >= 2 ? best : 0);
  }
  const step = Math.max(2, Math.round(binPx)), bins = [];
  for (let x = 0; x < cols.length; x += step) { const s = cols.slice(x, x + step).filter(Boolean); if (s.length >= Math.max(2, step * 0.4)) bins.push(Math.max(...s)); }
  return bins.length ? Math.min(...bins) : 1;
}

export const TRIGGER = '.pinkie-effort-trigger';
export const TIER = '.pinkie-effort-trigger .pinkie-external-tier';

// 档位字最浅段：渐变档流光会扫过整排字，所以和 effort-tier-ink 一样冻在 5 个位置各量一次，取最浅；
// 「关闭」是纯色档，位置对它没有影响。
export const POSITIONS = ['0%', '25%', '50%', '75%', '100%'];

export async function tierPalest(page, {binPx = 12, positions = POSITIONS} = {}) {
  const r = await page.locator(TIER).first().boundingBox();
  if (!r) throw new Error('找不到触发按钮里的档位字');
  const clip = {x: Math.max(0, r.x - 2), y: Math.max(0, r.y - 2), width: r.width + 4, height: r.height + 4};
  let worst = Infinity;
  for (const pos of positions) {
    const freeze = await page.addStyleTag({content: `${TIER}{animation:none!important;background-position:${pos} 50%!important}`});
    try {
      const a = await page.screenshot({clip, animations: 'disabled'});
      const hide = await page.addStyleTag({content: `${TIER}{color:transparent!important;-webkit-text-fill-color:transparent!important;background:none!important;filter:none!important}`});
      const b = await page.screenshot({clip, animations: 'disabled'});
      await hide.evaluate((n) => n.remove());
      worst = Math.min(worst, palest(a, b, binPx));
    } finally {
      await freeze.evaluate((n) => n.remove());
    }
  }
  return worst;
}

// 边框：读 computed 值（rgba() 或 color(srgb …)），叠到外层实际底上再算。
export async function borderContrast(page) {
  const got = await page.evaluate((sel) => {
    const parse = (s) => {
      let m = s.match(/rgba?\(([^)]+)\)/);
      if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
      m = s.match(/color\(srgb ([^)]+)\)/);
      if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
      return [0, 0, 0, 0];
    };
    const e = document.querySelector(sel);
    if (!e) return {missing: true};
    const layers = [];
    for (let n = e.parentElement; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 0.999) break;
    }
    const put = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3]));
    let outer = [255, 255, 255];
    for (const c of layers.reverse()) outer = put(c, outer);
    const s = getComputedStyle(e);
    const bc = parse(s.borderTopColor);
    return {width: parseFloat(s.borderTopWidth) || 0, style: s.borderTopStyle, raw: s.borderTopColor, alpha: bc[3], outer, over: put(bc, outer)};
  }, TRIGGER);
  if (got.missing) throw new Error('找不到 .pinkie-effort-trigger');
  const ratio = got.width < 1 || got.style === 'none' || got.alpha === 0 ? 1 : contrast(got.over.map(Math.round), got.outer.map(Math.round));
  return {...got, ratio};
}

// 反例：把边框和「关闭」字色注回 origin/main@647fc80d 的值。
export const REVERT_CSS = [
  'html:not(#_r1):not(#_r2):not(#_r3):not(#_r4) .pinkie-effort-trigger{border-color:transparent!important;transition:none!important}',
  'html:not(#_r1):not(#_r2):not(#_r3):not(#_r4) .pinkie-effort-trigger[data-pinkie-material="off"]{--pinkie-outside-ink:#605a65!important}',
].join('\n');
