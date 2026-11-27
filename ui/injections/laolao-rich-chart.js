/* laolao-rich-chart —— 回复里的 ```chart 图表
 *
 * laolao-rich.js 第一次遇到图表块时用 import() 加载本文件（ES 模块，不挂任何全局名，要用的小工具由 rich.js 传进来）。
 *
 * 写法（JSON）：
 *   {"type": "bar|line|area|pie|doughnut|radar|polarArea",      不写就是 bar
 *    "title": "看完该记住的结论",
 *    "labels": ["8月", "9月", "10月"],                          横轴上的名字 / 每一块的名字
 *    "series": [{"name": "吃饭", "data": [2400, 2050, 1760]}],   一组或几组数，每组个数和 labels 一样；只有一组也可以直接写 "data"
 *    "unit": "元", "stacked": true, "horizontal": true}
 * 数只能是数字（缺的写 null）。格式不对——不是 JSON、没有数、个数对不上、数里混了文字、类型不认识、
 * 饼图有几组或有负数——就不画：原代码块露出来，上面一句话说哪里不对，不白屏、不报错。
 *
 * 图下面两个键：「数据表」在图和表之间切换；「复制图片」把标题和图拼成一张实底 PNG 放进剪贴板，
 * 剪贴板用不了就存成图片文件。
 * 配色全取 laolao-rich-chart.css 里的 --pk-chart-* 变量（日、夜、Metre 各一套），改颜色只改那里。 */

const TYPES = new Set(['bar', 'line', 'area', 'pie', 'doughnut', 'radar', 'polarArea']);
const ROUND = new Set(['pie', 'doughnut', 'polarArea']);
const MAX_LABELS = 200;
const MAX_SERIES = 12;

function bad(why) {
  const error = new Error('chart: ' + why);
  error.pkUser = '图表格式有误：' + why + '下面是原文。';
  return error;
}
const shortJson = (v) => { const s = JSON.stringify(v) ?? String(v); return s.length > 24 ? s.slice(0, 23) + '…' : s; };

/* ── 校验：通过的才画，返回整理好的一份 ── */
export function normalize(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw bad('内容不是一个 {…} 对象。');
  const type = spec.type == null ? 'bar' : String(spec.type);
  if (!TYPES.has(type)) throw bad(`不认识的类型「${type}」。`);
  const labels = spec.labels;
  if (!Array.isArray(labels) || !labels.length) throw bad('没有 labels。');
  if (labels.length > MAX_LABELS) throw bad(`labels 超过 ${MAX_LABELS} 个。`);
  if (labels.some((l) => l == null || typeof l === 'object')) throw bad('labels 里只能写文字或数字。');
  const raw = Array.isArray(spec.series) ? spec.series : spec.data !== undefined ? [{name: spec.name, data: spec.data}] : null;
  if (!raw || !raw.length) throw bad('没有数据（series 或 data）。');
  if (raw.length > MAX_SERIES) throw bad(`数据超过 ${MAX_SERIES} 组。`);
  const series = raw.map((s, i) => {
    const which = raw.length > 1 ? `第 ${i + 1} 组` : '这组';
    if (!s || typeof s !== 'object' || !Array.isArray(s.data)) throw bad(`${which}数据没有 data。`);
    if (s.data.length !== labels.length) throw bad(`${which}数据有 ${s.data.length} 个数，labels 有 ${labels.length} 个。`);
    for (const v of s.data) {
      if (v !== null && !(typeof v === 'number' && Number.isFinite(v))) throw bad(`${which}数据里有不是数字的值 ${shortJson(v)}。`);
    }
    return {name: s.name == null ? '' : String(s.name), data: s.data.slice()};
  });
  if (!series.some((s) => s.data.some((v) => v !== null))) throw bad('一个数都没有。');
  if (ROUND.has(type)) {
    if (series.length !== 1) throw bad('饼图、环形图只能有一组数据。');
    if (series[0].data.some((v) => v !== null && v < 0)) throw bad('饼图、环形图里不能有负数。');
  }
  return {
    type, series, labels: labels.map(String),
    title: spec.title == null ? '' : String(spec.title),
    unit: spec.unit == null ? '' : String(spec.unit),
    stacked: !!spec.stacked, horizontal: !!spec.horizontal,
  };
}

/* ── 配色：从 CSS 变量取，跟着模式和日夜走 ── */
export function paletteOf(node) {
  const cs = getComputedStyle(node);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    series: [1, 2, 3, 4, 5, 6].map((i) => v('--pk-chart-' + i, '#2f7bff')),
    ink: v('--pk-chart-ink', 'rgba(40,30,51,.68)'),
    grid: v('--pk-chart-grid', 'rgba(40,30,51,.08)'),
    edge: v('--pk-chart-edge', '#fff'),
    paper: v('--pk-chart-paper', '#fff'),
    title: v('--pk-chart-title', '#2a2233'),
    font: v('--pk-chart-font', 'sans-serif'),
  };
}
// 只给 6 位十六进制色加透明度；别的写法原样用
const alpha = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? c + a : c);

function datasetsOf(spec, pal) {
  const type = spec.type === 'area' ? 'line' : spec.type, area = spec.type === 'area';
  return spec.series.map((s, i) => {
    const c = pal.series[i % pal.series.length];
    return ROUND.has(type)
      ? {label: s.name, data: s.data, backgroundColor: s.data.map((_, j) => pal.series[j % pal.series.length]), borderColor: pal.edge, borderWidth: 2}
      : {label: s.name, data: s.data, borderColor: c, backgroundColor: area || type === 'radar' ? alpha(c, '33') : type === 'line' ? c : alpha(c, 'cc'),
        fill: area || type === 'radar', tension: .32, borderWidth: type === 'line' ? 2.2 : 0, pointRadius: type === 'line' ? 2.5 : 3,
        borderRadius: type === 'bar' ? 6 : 0, maxBarThickness: 42, spanGaps: false};
  });
}

function optionsOf(spec, pal, fmt) {
  const type = spec.type === 'area' ? 'line' : spec.type, round = ROUND.has(type);
  const font = {family: pal.font};
  const num = (v) => (typeof v === 'number' ? v.toLocaleString('zh-CN') : v);
  const unit = {display: false};
  const value = (c) => (spec.horizontal ? c.parsed?.x : c.parsed?.y ?? c.parsed?.r ?? c.parsed);
  return {
    responsive: true, maintainAspectRatio: false,
    animation: {duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600},
    indexAxis: spec.horizontal ? 'y' : 'x',
    plugins: {
      legend: {display: spec.series.length > 1 || round, position: 'bottom', labels: {color: pal.ink, font, boxWidth: 5, boxHeight: 5, padding: 14, usePointStyle: true}},
      tooltip: {titleFont: font, bodyFont: font, callbacks: {label: (c) => `${c.dataset.label ? c.dataset.label + '：' : (round ? c.label + '：' : '')}${fmt(value(c))}`}},
    },
    scales: round ? {} : type === 'radar'
      ? {r: {grid: {color: pal.grid}, angleLines: {color: pal.grid}, pointLabels: {color: pal.ink, font}, ticks: {display: false}}}
      : {
        x: {stacked: spec.stacked, grid: {display: !!spec.horizontal, color: pal.grid}, border: {display: !spec.horizontal}, title: spec.horizontal ? unit : {display: false}, ticks: {color: pal.ink, font, ...(spec.horizontal ? {callback: num} : {})}},
        y: {stacked: spec.stacked, grid: {display: !spec.horizontal, color: pal.grid}, border: {display: false}, title: spec.horizontal ? {display: false} : unit, ticks: {color: pal.ink, font, ...(spec.horizontal ? {} : {callback: num})}},
      },
  };
}

/* ── 数据表：第一列是 labels，后面每组一列；单位写在表头 ── */
export function tableOf(spec, el) {
  const box = el('div', 'pk-chart__grid');
  const table = el('table', 'pk-chart__table');
  table.setAttribute('data-pk-nosort', '');
  const unit = spec.unit ? `（${spec.unit}）` : '';
  const head = el('tr');
  const corner = el('th', null, '名称'); corner.scope = 'col'; head.append(corner);
  spec.series.forEach((s) => { const th = el('th', null, (s.name || '数值') + unit); th.scope = 'col'; head.append(th); });
  const thead = el('thead'); thead.append(head);
  const tbody = el('tbody');
  spec.labels.forEach((label, row) => {
    const tr = el('tr');
    const th = el('th', null, label); th.scope = 'row'; tr.append(th);
    spec.series.forEach((s) => { const v = s.data[row]; tr.append(el('td', null, v === null ? '—' : v.toLocaleString('zh-CN'))); });
    tbody.append(tr);
  });
  table.append(thead, tbody);
  box.append(table);
  return box;
}

/* ── 复制图片：实底 + 标题 + 图（图例在图里），按图本来的像素密度拼 ── */
export function composeImage(chart, title, pal) {
  const src = chart.canvas, dpr = chart.currentDevicePixelRatio || window.devicePixelRatio || 1;
  const pad = Math.round(20 * dpr), size = Math.round(15 * dpr), head = title ? Math.round(size * 1.6 + 8 * dpr) : 0;
  const out = document.createElement('canvas');
  out.width = src.width + pad * 2;
  out.height = src.height + pad * 2 + head;
  const g = out.getContext('2d');
  g.fillStyle = pal.paper;
  g.fillRect(0, 0, out.width, out.height);
  if (title) {
    g.fillStyle = pal.title;
    g.font = `600 ${size}px ${pal.font}`;
    g.textBaseline = 'top';
    g.fillText(title, pad, pad, src.width);
  }
  g.drawImage(src, pad, pad + head);
  return out;
}
const fileName = (title) => (title.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 40) || '图表') + '.png';
function saveFile(blob, title) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName(title);
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
// 本机 WebKit（2370 / 2388）画得上却编码不出：toDataURL 三种格式都回 data:，convertToBlob 抛错。
// 这时用像素自己拼一张不压缩的 PNG（stored deflate + CRC32 + Adler-32），createImageBitmap 能解回原像素
function pngFromPixels(canvas) {
  const w = canvas.width, h = canvas.height, px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const crcTable = Array.from({length: 256}, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  const be = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (type, data) => {
    const body = new Uint8Array(4 + data.length); body.set([...type].map((c) => c.charCodeAt(0))); body.set(data, 4);
    let c = ~0; for (const v of body) c = crcTable[(c ^ v) & 255] ^ (c >>> 8);
    return [new Uint8Array(be(data.length)), body, new Uint8Array(be(~c >>> 0))];
  };
  const blocks = Math.max(1, Math.ceil(raw.length / 65535)), z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z.set([0x78, 0x01]);
  let at = 2, a = 1, b = 0;
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * 65535, (i + 1) * 65535), n = part.length;
    z.set([i === blocks - 1 ? 1 : 0, n & 255, n >>> 8, ~n & 255, (~n >>> 8) & 255], at); z.set(part, at + 5); at += 5 + n;
  }
  for (const v of raw) { a = (a + v) % 65521; b = (b + a) % 65521; }
  z.set(be(((b << 16) | a) >>> 0), at);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob([sig, ...chunk('IHDR', new Uint8Array([...be(w), ...be(h), 8, 6, 0, 0, 0])), ...chunk('IDAT', z), ...chunk('IEND', new Uint8Array())], {type: 'image/png'});
}
// toBlob 回空就改用 toDataURL 解出同一张 PNG，再不行用像素自己拼；三样都不行才算失败
function pngOf(canvas) {
  const viaUrl = () => {
    const url = canvas.toDataURL('image/png');
    const comma = url.indexOf(',');
    if (!url.startsWith('data:image/png') || comma < 0 || comma === url.length - 1) throw new Error('toDataURL');
    const bin = atob(url.slice(comma + 1)), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], {type: 'image/png'});
  };
  return new Promise((ok, no) => {
    const fallback = () => { try { ok(viaUrl()); } catch { try { ok(pngFromPixels(canvas)); } catch (error) { no(error); } } };
    try { canvas.toBlob((b) => (b && b.size ? ok(b) : fallback()), 'image/png'); } catch { fallback(); }
  });
}
// 剪贴板要在点击的同一拍里拿到 ClipboardItem（WebKit 的要求），所以先给它一个还没好的 Promise
export async function copyImage(chart, spec, pal) {
  const out = composeImage(chart, [spec.title, spec.unit && `（单位：${spec.unit}）`].filter(Boolean).join(''), pal);
  const blob = pngOf(out);
  blob.catch(() => {});
  try {
    if (typeof navigator.clipboard?.write !== 'function' || typeof ClipboardItem !== 'function') throw new Error('no clipboard');
    await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
    return 'copied';
  } catch {
    saveFile(await blob, spec.title);
    return 'saved';
  }
}

/* ── 画：kit = {el, script, css, chartSrc, cssHref, toast}（rich.js 传进来） ── */
// 配色从 CSS 变量取，所以要等样式表真的加载完再画；加载失败也不拦着（paletteOf 有兜底色），最多等 3 秒
const sheets = new Map();
function sheetReady(href) {
  if (sheets.has(href)) return sheets.get(href);
  const link = [...document.querySelectorAll('link[data-pk-css]')].find((l) => l.dataset.pkCss === href);
  const ready = !link || link.sheet ? Promise.resolve() : new Promise((ok) => {
    const t = setTimeout(ok, 3000);
    const end = () => { clearTimeout(t); ok(); };
    link.addEventListener('load', end, {once: true});
    link.addEventListener('error', end, {once: true});
  });
  sheets.set(href, ready);
  return ready;
}

export function parse(src) {
  let raw;
  try { raw = JSON.parse(String(src)); } catch { throw bad('不是有效的 JSON（引号、逗号、括号要成对）。'); }
  return normalize(raw);
}

export async function renderChart(box, src, kit) {
  const spec = parse(src);
  kit.css(kit.cssHref);
  await Promise.all([kit.script(kit.chartSrc), sheetReady(kit.cssHref)]);
  if (!box.isConnected) return;
  const Chart = window.Chart;
  if (typeof Chart !== 'function') throw new Error('Chart.js 没有加载');
  const pal = paletteOf(box);
  const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('zh-CN') : v) + (spec.unit ? (/^[%‰℃°]/.test(spec.unit) ? '' : ' ') + spec.unit : '');
  const {el} = kit;
  const wrap = el('div', 'pk-chart');
  if (spec.title || spec.unit) {
    const head = el('div', 'pk-chart__title', spec.title);
    if (spec.unit) head.append(el('span', 'pk-chart__unit', '单位：' + spec.unit));
    wrap.append(head);
  }
  const stage = el('div', 'pk-chart__stage');
  const canvas = el('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', (spec.title || '图表') + '。点「数据表」可以看每个数。');
  const plot = el('div', 'pk-chart__plot');
  plot.append(canvas);
  stage.append(plot);
  const bar = el('div', 'pk-chart__bar');
  const tableKey = el('button', 'pk-chart__key', '数据表');
  tableKey.type = 'button'; tableKey.setAttribute('aria-pressed', 'false');
  const copyKey = el('button', 'pk-chart__key', '复制图片');
  copyKey.type = 'button';
  const note = el('span', 'pk-chart__note');
  note.setAttribute('aria-live', 'polite');
  bar.append(tableKey, copyKey, note);
  wrap.append(stage, bar);
  box.append(wrap);

  const chart = new Chart(canvas, {type: spec.type === 'area' ? 'line' : spec.type, data: {labels: spec.labels, datasets: datasetsOf(spec, pal)}, options: optionsOf(spec, pal, fmt)});
  box.__pkChart = chart;

  let grid = null, timer = 0;
  const say = (text) => { note.textContent = text; clearTimeout(timer); timer = setTimeout(() => { note.textContent = ''; }, 2400); };
  tableKey.addEventListener('click', () => {
    const on = !wrap.classList.contains('is-table');
    if (on && !grid) { grid = tableOf(spec, el); stage.append(grid); }   // 放进图区里，盖在图的位置上，切换不跳
    wrap.classList.toggle('is-table', on);
    tableKey.setAttribute('aria-pressed', String(on));
  });
  copyKey.addEventListener('click', async () => {
    copyKey.disabled = true;
    try {
      const how = await copyImage(chart, spec, pal);
      say(how === 'copied' ? '已复制，可以直接粘贴' : '剪贴板用不了，已存成图片文件');
    } catch (error) {
      console.warn('[laolao-rich-chart] copy', error);
      say('没复制成，请再试一次');
    } finally {
      copyKey.disabled = false;
    }
  });
  return chart;
}
