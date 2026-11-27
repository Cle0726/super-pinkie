// 本机 WebKit 画得上却编码不出：toBlob 回 null、toDataURL 回 'data:,' 都不抛错。
// 应用图标（laolao-desktop-apps.js drawIcon）和白板导出（laolao-whiteboard.js exportPng）都要走图表那份 pngOf 退路。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INJ = path.join(ROOT, 'ui/injections');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const {pngOf} = await import(pathToFileURL(path.join(INJ, 'laolao-rich-chart.js')).href);

function pixels(w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i++) px[i] = (i * 37 + (i >> 2)) & 255;
  return px;
}

// WebKit 坏掉的样子：toBlob → null，toDataURL → 'data:,'，像素照样读得出
function brokenCanvas(w, h, {px = pixels(w, h), readFails = false} = {}) {
  const ctx = {
    getImageData: () => { if (readFails) throw new Error('getImageData'); return {data: px}; },
    beginPath() {}, roundRect() {}, rect() {}, fill() {}, fillText() {},
  };
  return {width: w, height: h, px, getContext: () => ctx, toBlob: cb => cb(null), toDataURL: () => 'data:,'};
}

function decodePng(bytes) {
  const buf = Buffer.from(bytes);
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG 签名');
  let at = 8, w = 0, h = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at), type = buf.toString('latin1', at + 4, at + 8), data = buf.subarray(at + 8, at + 8 + len);
    assert.equal(buf.readUInt32BE(at + 8 + len), zlib.crc32(buf.subarray(at + 4, at + 8 + len)), type + ' CRC');
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); assert.deepEqual([...data.subarray(8)], [8, 6, 0, 0, 0]); }
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (w * 4 + 1)], 0, '每行 filter 0');
    out.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  }
  return {w, h, px: out};
}

test('pngOf：toBlob 回 null、toDataURL 回 data:, 时用像素自拼出能解回原像素的 PNG', async () => {
  const canvas = brokenCanvas(300, 7);
  const blob = await pngOf(canvas);
  assert.equal(blob.type, 'image/png');
  const png = decodePng(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual([png.w, png.h], [300, 7]);
  assert.deepEqual([...png.px], [...canvas.px]);
});

test('pngOf 反例：像素也读不出时 reject，不回空图', async () => {
  await assert.rejects(pngOf(brokenCanvas(4, 4, {readFails: true})), /getImageData/);
});

// 只取 drawIcon 这一个函数，在主上下文里跑（动态 import 用默认加载器，FileReader 用 Node 的 Blob 补）
const APPS = read('ui/injections/laolao-desktop-apps.js');
function drawIconFrom(source, canvas) {
  const start = source.indexOf('async function drawIcon(name) {');
  const endMark = "    } catch { return ''; }\n  }";
  assert.ok(start >= 0, '找到 drawIcon');
  const fn = source.slice(start, source.indexOf(endMark, start) + endMark.length);
  class FileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(buf => { this.result = 'data:' + blob.type + ';base64,' + Buffer.from(buf).toString('base64'); this.onload(); }, e => { this.error = e; this.onerror(); });
    }
  }
  const document = {createElement: () => canvas, baseURI: pathToFileURL(INJ + '/').href};
  const COLORS = ['#F26BA8'];
  return new Function('document', 'window', 'FileReader', 'COLORS', `return (${fn});`)(document, {}, FileReader, COLORS);
}
const ICON_RE = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;

test('drawIcon：WebKit 回 data:, 时改走 pngOf，得到网关 decodeIcon 认得的 256×256 PNG', async () => {
  const canvas = brokenCanvas(256, 256);
  const url = await drawIconFrom(APPS, canvas)('单词小游戏');
  const match = ICON_RE.exec(url);
  assert.ok(match, '形如 data:image/png;base64,…');
  const bytes = Buffer.from(match[1], 'base64');
  assert.ok(bytes.length <= 512 * 1024, '不超 APP_LIMITS.iconBytes');
  const png = decodePng(bytes);
  assert.deepEqual([png.w, png.h], [256, 256]);
  assert.deepEqual([...png.px], [...canvas.px]);
});

test('drawIcon：toDataURL 正常时原样返回，不去加载图表模块', async () => {
  const good = 'data:image/png;base64,iVBORw0KGgo=';
  const canvas = {...brokenCanvas(256, 256), toDataURL: () => good, toBlob: () => assert.fail('不该走退路')};
  assert.equal(await drawIconFrom(APPS, canvas)('A'), good);
});

test('drawIcon 反例：退路也失败时回空串；换回直接 toDataURL 的旧写法会把 data:, 交给网关', async () => {
  assert.equal(await drawIconFrom(APPS, brokenCanvas(256, 256, {readFails: true}))('A'), '');
  const old = APPS.replace(/const url = canvas\.toDataURL\('image\/png'\);[\s\S]*?readAsDataURL\(blob\); \}\);\n/, "return canvas.toDataURL('image/png');\n");
  assert.notEqual(old, APPS, '旧写法替换成功');
  const url = await drawIconFrom(old, brokenCanvas(256, 256))('A');
  assert.equal(url, 'data:,');
  assert.equal(ICON_RE.test(url), false, '旧写法网关 decodeIcon 认不得，图标会丢');
});

// 白板导出依赖真 DOM（SVG → Image → canvas），这里静态卡住：只许走 pngOf，不许再直接 toBlob / toDataURL
const guarded = src => !/canvas\.(toBlob|toDataURL)\(/.test(src) && /import\(new URL\(\(window\.__pinkieAsset \|\| \(p => p\)\)\('\.\/laolao-rich-chart\.js'\), document\.baseURI\)\.href\)\)\.pngOf\(canvas\)/.test(src);

test('白板 exportPng 走 pngOf；圆桌页能取到 /laolao-rich-chart.js', () => {
  const wb = read('ui/injections/laolao-whiteboard.js');
  assert.ok(guarded(wb));
  const server = read('services/roundtable/server.py');
  assert.match(server, /'\/laolao-rich-chart\.js': ROOT\/'ui\/injections\/laolao-rich-chart\.js'/);
  assert.match(server, /img-src 'self' data:; style-src 'self'; script-src 'self'/, "CSP script-src 'self' 允许同源模块");
});

test('白板反例：换回只走 toBlob 的旧写法时静态检查变红', () => {
  const wb = read('ui/injections/laolao-whiteboard.js');
  const old = wb.replace(/const blob = await \(await import\([^\n]*\.pngOf\(canvas\);/,
    "const blob = await new Promise((resolve, reject) => canvas.toBlob(v => (v ? resolve(v) : reject(new Error('没导出来'))), 'image/png'));");
  assert.notEqual(old, wb, '旧写法替换成功');
  assert.equal(guarded(old), false);
});
