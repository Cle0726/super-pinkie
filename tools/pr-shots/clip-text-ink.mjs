// 走查脚本共用：用 background-clip:text 画的字（-webkit-text-fill-color 透明，字形里透出的是背景渐变），
// 计算样式里没有「字色」——backgroundColor 就是墨色本身，拿 color 对 backgroundColor 算会得到 1.0 左右的假低分。
// 这里改按像素量：同一块区域拍两张（有字 / 把这段字藏掉），逐像素比，按半个字宽分段，每段取最深的字形像素，
// 报最浅的那一段（渐变字最淡处）和中位数。只用 node:zlib 解 PNG，不依赖第三方包、不在页面里跑画布。
import zlib from 'node:zlib';

// Playwright 截图：8 位、非隔行的 RGB / RGBA（灰度也接）。
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let o = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), kind = buf.toString('latin1', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; interlace = d[12]; }
    else if (kind === 'IDAT') idat.push(d);
    else if (kind === 'IEND') break;
    o += 12 + len;
  }
  const ch = {0: 1, 2: 3, 4: 2, 6: 4}[type];
  if (depth !== 8 || !ch || interlace) throw new Error(`unsupported PNG: depth ${depth} type ${type} interlace ${interlace}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch] : 0, b = y ? px[up + x] : 0, c = x >= ch && y ? px[up + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  const rgb = (x, y) => { const i = y * stride + x * ch; return ch >= 3 ? [px[i], px[i + 1], px[i + 2]] : [px[i], px[i], px[i]]; };
  return {width: w, height: h, rgb};
}

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (x, y) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);

// withBuf：有字的截图；withoutBuf：同一块、字藏掉（= 底）。binPx：分段宽度（设备像素，约半个字宽）。
export function inkRatio(withBuf, withoutBuf, binPx) {
  const A = decodePng(withBuf), B = decodePng(withoutBuf);
  if (A.width !== B.width || A.height !== B.height) throw new Error('crop sizes differ');
  const cols = [];
  for (let x = 0; x < A.width; x++) {
    let best = 1, n = 0;
    for (let y = 0; y < A.height; y++) {
      const r = contrast(lum(A.rgb(x, y)), lum(B.rgb(x, y)));
      if (r > 1.15) n++;
      if (r > best) best = r;
    }
    cols.push(n >= 2 ? best : 0);
  }
  const step = Math.max(2, Math.round(binPx)), bins = [];
  for (let x = 0; x < cols.length; x += step) {
    const inked = cols.slice(x, x + step).filter(Boolean);
    // 只剩一两列抗锯齿边的段（字尾、字缝）不算，免得把边缘当成「最浅处」。
    if (inked.length >= Math.max(2, step * 0.4)) bins.push(Math.max(...inked));
  }
  if (!bins.length) return {ratio: 1, median: 1, bins: 0};
  const sorted = [...bins].sort((a, b) => a - b);
  return {ratio: +sorted[0].toFixed(2), median: +sorted[sorted.length >> 1].toFixed(2), bins: bins.length};
}

const HIDE = 'color:transparent!important;-webkit-text-fill-color:transparent!important;background:none!important;filter:none!important;text-shadow:none!important';

// hide：要藏掉的那段字（和它的 background-clip 来源）的选择器；clip：截图区域（CSS 像素）；binPx 同上。
export async function clipTextInk(page, hide, clip, binPx) {
  const withBuf = await page.screenshot({clip, animations: 'disabled'});
  const tag = await page.addStyleTag({content: `${hide}{${HIDE}}`});
  try {
    const withoutBuf = await page.screenshot({clip, animations: 'disabled'});
    return inkRatio(withBuf, withoutBuf, binPx);
  } finally {
    await tag.evaluate((n) => n.remove());
  }
}
