// Zero-dependency PNG decoder, pixel differ, and PNG encoder using Node's built-in zlib.
import zlib from 'node:zlib';

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('Invalid PNG signature');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
        throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`);
      }
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const recon = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const srcStart = y * (stride + 1) + 1;
    const dstStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const xVal = raw[srcStart + x];
      const a = x >= bpp ? recon[dstStart + x - bpp] : 0;
      const b = y > 0 ? recon[dstStart - stride + x] : 0;
      const c = (x >= bpp && y > 0) ? recon[dstStart - stride + x - bpp] : 0;
      let v;
      if (filter === 0) v = xVal;
      else if (filter === 1) v = (xVal + a) & 0xff;
      else if (filter === 2) v = (xVal + b) & 0xff;
      else if (filter === 3) v = (xVal + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (xVal + paeth(a, b, c)) & 0xff;
      else throw new Error(`Unsupported PNG filter ${filter}`);
      recon[dstStart + x] = v;
    }
  }
  if (bpp === 4) return {width, height, data: recon};
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < recon.length; i += 3, j += 4) {
    rgba[j] = recon[i];
    rgba[j + 1] = recon[i + 1];
    rgba[j + 2] = recon[i + 2];
    rgba[j + 3] = 255;
  }
  return {width, height, data: rgba};
}

function makeChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 4, 'ascii');
  const body = Buffer.concat([head.subarray(4), data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, data, crcBuf]);
}

export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter None
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, {level: 6});
  return Buffer.concat([
    PNG_SIG,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function comparePng(actualBuf, baselineBuf, {channelTolerance = 10} = {}) {
  const a = decodePng(actualBuf);
  const b = decodePng(baselineBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return {
      width: a.width,
      height: a.height,
      baselineWidth: b.width,
      baselineHeight: b.height,
      totalPixels: a.width * a.height,
      diffPixels: a.width * a.height,
      diffPercent: 100,
      diffPngBuffer: actualBuf,
      dimensionMismatch: true,
      box: null,
      maxDelta: null,
    };
  }
  const totalPixels = a.width * a.height;
  const diffRgba = new Uint8Array(totalPixels * 4);
  let diffPixels = 0;
  // 诊断用（B51）：所有像素里最大的单通道差，和超容差像素的包围框；不影响判定
  let maxDelta = 0, x0 = a.width, y0 = a.height, x1 = -1, y1 = -1;
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const dr = Math.abs(a.data[idx] - b.data[idx]);
    const dg = Math.abs(a.data[idx + 1] - b.data[idx + 1]);
    const db = Math.abs(a.data[idx + 2] - b.data[idx + 2]);
    const da = Math.abs(a.data[idx + 3] - b.data[idx + 3]);
    maxDelta = Math.max(maxDelta, dr, dg, db, da);
    if (dr > channelTolerance || dg > channelTolerance || db > channelTolerance || da > channelTolerance) {
      diffPixels++;
      const x = i % a.width, y = (i - x) / a.width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      diffRgba[idx] = 255;
      diffRgba[idx + 1] = 0;
      diffRgba[idx + 2] = 128;
      diffRgba[idx + 3] = 255;
    } else {
      const gray = Math.round(0.299 * a.data[idx] + 0.587 * a.data[idx + 1] + 0.114 * a.data[idx + 2]);
      const dim = Math.round(gray * 0.35 + 165);
      diffRgba[idx] = dim;
      diffRgba[idx + 1] = dim;
      diffRgba[idx + 2] = dim;
      diffRgba[idx + 3] = 255;
    }
  }
  const diffPercent = (diffPixels / totalPixels) * 100;
  return {
    width: a.width,
    height: a.height,
    totalPixels,
    diffPixels,
    diffPercent,
    diffPngBuffer: diffPixels > 0 ? encodePng(a.width, a.height, diffRgba) : null,
    dimensionMismatch: false,
    box: diffPixels > 0 ? {x0, y0, x1, y1} : null,
    maxDelta,
  };
}

// B51：重复渲染断言的失败信息。开头保持原样（大家按它 grep），后面补场景 / 主题、尺寸、包围框、最大通道差。
export function describeRepeatDiff({scene, theme, runA, runB}, diff) {
  const head = `${scene}-${theme} non-deterministic render: run ${runA} vs run ${runB} `
    + `differed by ${diff.diffPixels} px (${diff.diffPercent.toFixed(4)}%)`;
  const size = diff.dimensionMismatch
    ? `size ${diff.width}x${diff.height} vs ${diff.baselineWidth}x${diff.baselineHeight}`
    : `size ${diff.width}x${diff.height}`;
  const b = diff.box;
  const box = b ? `box x=${b.x0}..${b.x1} y=${b.y0}..${b.y1} (${b.x1 - b.x0 + 1}x${b.y1 - b.y0 + 1})` : 'box none';
  const delta = diff.maxDelta == null ? 'max channel Δ n/a' : `max channel Δ${diff.maxDelta}`;
  return `${head}; scene=${scene} theme=${theme}; ${size}; ${box}; ${delta}`;
}
