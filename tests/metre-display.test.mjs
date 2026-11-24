// 11-24 第零批「基础显示」的复发测试：laolao-metre-display.css。真浏览器里跑，页面上只放原生的那几条样式 + 本文件。
// 改前（Metre 停用 redesign.css 以后）：12 列表格每格 63px、不能横向滚动；600×8000 的图缩成 15×200，4000×400 缩成 300×30；坏图只剩 71×22；看图器遮罩是碧琪粉紫。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const inj = (f) => fileURLToPath(new URL('../ui/injections/' + f, import.meta.url));
const read = (f) => fs.readFileSync(inj(f), 'utf8');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
const svg = (w, h) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#3b5bdb"/></svg>`).toString('base64');

// 原生 control-ui（openclaw 2026.7.1-2）里决定这几处样子的原样规则，加上看图器在 laolao-theme.css 里的遮罩色。
const NATIVE = `
  body{margin:0;font:14px sans-serif}
  .chat-thread{width:780px;margin:20px}
  .chat-text :where(table){border-collapse:collapse;width:100%;max-width:100%;font-size:13px;display:block;overflow-x:auto}
  .chat-message-images{flex-wrap:wrap;gap:8px;display:flex}
  .chat-message-image{object-fit:contain;max-width:300px;max-height:200px}
  .laolao-image-viewer{position:fixed;inset:0;background:rgba(54,23,42,.42)}
  :root{--metre-text:#1F1E1D;--metre-bg:#F7F6F3;--metre-surface:#FFFFFF;--metre-line:#E4E2DC;--metre-line-strong:#C9C6BE;--metre-muted:#6B6860;--metre-hover:#EFEDE8;--metre-cobalt:#2F4BD8;--metre-sans:sans-serif}`;
const cells = (tag) => Array.from({length: 12}, (_, i) => `<${tag}>${tag === 'th' ? '列' + (i + 1) + '很宽的表头' : '内容 ' + (i + 1) + ' 一段比较长的单元格文字'}</${tag}>`).join('');
const page = (mode) => `<!doctype html><html${mode ? ` data-laolao-mode="${mode}"` : ''}><head><style>${NATIVE}\n${read('laolao-metre-display.css')}</style></head><body>
<div class="chat-thread"><div class="chat-group assistant"><div class="chat-text"><table><thead><tr>${cells('th')}</tr></thead><tbody><tr>${cells('td')}</tr></tbody></table></div></div>
<div class="chat-message-images"><img class="chat-message-image" id="normal" alt="附件图片" src="${svg(1280, 720)}"></div><div class="chat-message-images"><img class="chat-message-image" id="tall" alt="附件图片" src="${svg(600, 8000)}"></div><div class="chat-message-images"><img class="chat-message-image" id="wide" alt="附件图片" src="${svg(4000, 400)}"></div><div class="chat-message-images"><img class="chat-message-image" id="broken" alt="附件图片" src="data:image/png;base64,AAAA"></div></div>
<div class="laolao-image-viewer" id="viewer"></div></body></html>`;

async function measure(browser, mode) {
  const p = await browser.newPage({viewport: {width: 900, height: 900}});
  await p.setContent(page(mode));
  await p.waitForFunction(() => [...document.images].every((i) => i.complete));
  return p.evaluate(() => {
    const tb = document.querySelector('table'), td = [...tb.querySelectorAll('td')];
    const box = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
    const after = getComputedStyle(document.getElementById('broken'), '::after');
    return {tableW: Math.round(tb.getBoundingClientRect().width), tableSW: tb.scrollWidth, minCell: Math.min(...td.map((d) => Math.round(d.getBoundingClientRect().width))),
      normal: box('normal'), tall: box('tall'), wide: box('wide'), broken: box('broken'), brokenText: after.content, viewerBg: getComputedStyle(document.getElementById('viewer')).backgroundColor};
  });
}

test(`Metre basic display: wide tables scroll, long / wide / broken images keep a readable box, image viewer uses Metre ink (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const m = await measure(browser, 'metre');
    assert.ok(m.tableSW > m.tableW + 200, `wide table scrolls sideways in Metre: ${JSON.stringify(m)}`);
    assert.ok(m.minCell >= 84, `table cells keep their minimum width: ${m.minCell}`);
    assert.ok(m.normal[0] === 300 && Math.abs(m.normal[1] - 169) <= 1, `a normal picture keeps its native thumbnail size: ${m.normal}`);
    assert.ok(m.tall[0] >= 120 && m.tall[1] === 200, `long picture is not a 15px sliver: ${m.tall}`);
    assert.ok(m.wide[0] === 300 && m.wide[1] >= 64, `wide picture is not a 30px strip: ${m.wide}`);
    assert.ok(m.broken[0] >= 120 && m.broken[1] >= 64, `broken picture gets a placeholder box: ${m.broken}`);
    assert.equal(m.brokenText, '"图片打不开"');
    assert.notEqual(m.viewerBg, 'rgba(54, 23, 42, 0.42)', 'viewer backdrop is not the Pinkie plum in Metre');

    const other = await measure(browser, 'chat');
    assert.equal(other.tableSW, other.tableW, 'other modes: this file does not touch tables');
    assert.deepEqual(other.tall, [15, 200], 'other modes: this file does not touch thumbnails');
    assert.equal(other.viewerBg, 'rgba(54, 23, 42, 0.42)', 'other modes keep the Pinkie viewer');
  } finally { await browser.close(); }
});

// B-A1：碧琪交付卡的网格（laolao-material-preview.css 原样规则）。改前 820 宽两张挤一排。
const DELIVERY = '.chat-bubble .chat-assistant-attachments:has(> .laolao-delivery-card){display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:10px;width:100%;min-width:0}.laolao-delivery-card{display:block;min-height:120px;border:1px solid #ccc}';
const cardsPage = (mode) => `<!doctype html><html${mode ? ` data-laolao-mode="${mode}"` : ''}><head><style>${NATIVE}
${DELIVERY}
${read('laolao-metre-display.css')}</style></head><body>
<div class="chat-thread"><div class="chat-bubble"><div class="chat-assistant-attachments"><div class="laolao-delivery-card" id="c1">报告.pdf</div><div class="laolao-delivery-card" id="c2">录音.mp3</div></div></div></div></body></html>`;
async function cardRows(browser, mode, width) {
  const p = await browser.newPage({viewport: {width, height: 700}});
  await p.setContent(cardsPage(mode));
  const r = await p.evaluate(() => ['c1', 'c2'].map((id) => { const b = document.getElementById(id).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width)]; }));
  await p.close();
  return r;
}

test(`Metre attachment cards: one per row in a narrow window, unchanged when wide and in other modes (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const [a, b] = await cardRows(browser, 'metre', 820);
    assert.ok(a[0] === b[0] && b[1] > a[1] && a[2] >= 700, `820 wide in Metre: cards stack, full width: ${JSON.stringify([a, b])}`);
    const [c, d] = await cardRows(browser, 'chat', 820);
    assert.ok(c[1] === d[1] && d[0] > c[0], `other modes keep two per row: ${JSON.stringify([c, d])}`);
    const [e, g] = await cardRows(browser, 'metre', 1440);
    assert.ok(e[1] === g[1] && g[0] > e[0], `wide Metre window keeps the grid: ${JSON.stringify([e, g])}`);
  } finally { await browser.close(); }
});

// T3#5：原生「复制为 Markdown」包在 openclaw-tooltip 里，碧琪按键行在的时候 Metre 下要藏掉（改前两个复制键并排）。
const copyPage = (mode) => `<!doctype html><html${mode ? ` data-laolao-mode="${mode}"` : ''}><head><style>${NATIVE}\n${read('laolao-message-actions.css')}\n${read('laolao-metre-display.css')}</style></head><body>
<div class="chat-thread"><div class="chat-group assistant"><div class="chat-group-messages"><div class="chat-group-footer"><div class="chat-group-footer-actions">
<openclaw-tooltip style="display:contents"><button class="btn btn--xs chat-copy-btn" id="native">复制为 Markdown</button></openclaw-tooltip>
<div class="pinkie-msg-row pinkie-msg-row--assistant"><button class="pinkie-msg-btn" id="ours">复制</button></div>
</div></div></div></div></div></body></html>`;
async function copyKeys(browser, mode) {
  const p = await browser.newPage({viewport: {width: 1440, height: 700}});
  await p.setContent(copyPage(mode));
  const r = await p.evaluate(() => ['native', 'ours'].map((id) => { const b = document.getElementById(id).getBoundingClientRect(); return b.width > 0 && b.height > 0; }));
  await p.close();
  return r;
}

test(`Metre message footer: one copy key, native Markdown copy hidden when ours is present (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const [native, ours] = await copyKeys(browser, 'metre');
    assert.deepEqual([native, ours], [false, true], `Metre: native copy hidden, ours shown: ${JSON.stringify([native, ours])}`);
    const [n2, o2] = await copyKeys(browser, 'chat');
    assert.deepEqual([n2, o2], [true, true], `other modes untouched by this file: ${JSON.stringify([n2, o2])}`);
  } finally { await browser.close(); }
});

// T3#6：用户消息的「复制」「编辑」被页脚时间戳压住、点不到（Metre 皮肤把按键行绝对定位到气泡右下角，正好落在时间戳上）。
// 下面仿真页面：皮肤那条定位规则 + 原生页脚（时间戳靠右，opacity .72 自成一层，所以盖在按键上）。改后：两个键中心点得到自己，时间戳在按键行左边。
const SKIN_ROW = 'html[data-laolao-mode="metre"] .chat-group.user .chat-bubble{position:relative}html[data-laolao-mode="metre"] .chat-group.user .pinkie-msg-row{position:absolute;right:0;top:100%;margin-top:4px}';
const ROW_CSS = '.chat-group{display:flex;flex-direction:column;align-items:flex-end;width:756px}.chat-group-messages{display:flex;flex-direction:column;align-items:flex-end;width:100%}.chat-bubble{padding:10px 14px;border:1px solid #ccc}.pinkie-msg-row{display:flex;gap:2px}.pinkie-msg-btn{width:26px;height:26px;padding:0;border:0}.chat-group-footer{display:flex;justify-content:flex-end;align-items:center;gap:8px;width:514px;height:24px}.chat-group-timestamp{font-size:11px;white-space:nowrap;opacity:.72}';
const userRowPage = (mode) => `<!doctype html><html data-laolao-mode="${mode}"><head><style>${ROW_CSS}\n${SKIN_ROW}\n${read('laolao-metre-display.css')}</style></head><body>
<div class="chat-thread" style="padding:40px"><div class="chat-group user"><div class="chat-group-messages"><div class="chat-bubble">把第三节的截图换掉<div class="pinkie-msg-row pinkie-msg-row--user"><button class="pinkie-msg-btn" id="cp">复</button><button class="pinkie-msg-btn" id="ed">编</button></div></div>
<div class="chat-group-footer"><div class="chat-group-footer__meta"><time class="chat-group-timestamp" id="ts">2026年11月24日 3:19</time></div></div></div></div></div></body></html>`;

test(`Metre user message: copy / edit keys are clickable, the timestamp sits to their left (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const p = await browser.newPage({viewport: {width: 1000, height: 400}});
    await p.setContent(userRowPage('metre'));
    const r = await p.evaluate(() => {
      const hit = (id) => { const n = document.getElementById(id), b = n.getBoundingClientRect(); return n.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)); };
      const ts = document.getElementById('ts').getBoundingClientRect(), row = document.querySelector('.pinkie-msg-row').getBoundingClientRect();
      return {copy: hit('cp'), edit: hit('ed'), tsRight: Math.round(ts.right), rowLeft: Math.round(row.left)};
    });
    assert.ok(r.copy && r.edit, `both keys receive their own clicks: ${JSON.stringify(r)}`);
    assert.ok(r.tsRight <= r.rowLeft, `timestamp ends before the key row starts: ${JSON.stringify(r)}`);
    await p.close();
  } finally { await browser.close(); }
});

// T3#6：编辑框在 820 宽时出界（碧琪 .pinkie-msg-edit 固定 min-width: min(520px, 70vw)，Metre 对话栏 752 宽、消息列 max 68%）。
const EDIT_CSS = '.chat-thread{width:752px;margin-left:34px}.chat-group{display:flex;justify-content:flex-end;width:100%}.chat-group-messages{width:100%;max-width:min(900px,68%);display:flex;flex-direction:column;align-items:flex-end}.chat-bubble{max-width:min(85%,600px);padding:9px 16px;border:1px solid #ccc}.pinkie-msg-edit{margin-top:8px;display:flex;flex-direction:column;gap:8px;min-width:min(520px,70vw)}.pinkie-msg-edit textarea{width:100%;box-sizing:border-box}.chat-bubble[data-pinkie-editing] > :not(.pinkie-msg-edit){display:none}';
const editPage = (mode) => `<!doctype html><html data-laolao-mode="${mode}"><head><style>body{margin:0}${EDIT_CSS}\n${read('laolao-metre-display.css')}</style></head><body>
<div class="chat-thread" id="th"><div class="chat-group user"><div class="chat-group-messages"><div class="chat-bubble" data-pinkie-editing="1"><span>原文</span>
<div class="pinkie-msg-edit" id="box"><textarea>再把链接都检查一遍</textarea><div><button id="send">发送</button></div></div></div></div></div></div></body></html>`;

test(`Metre edit-and-resend box stays inside the thread at 820 and keeps a usable width (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const p = await browser.newPage({viewport: {width: 820, height: 500}});
    await p.setContent(editPage('metre'));
    const r = await p.evaluate(() => { const b = document.getElementById('box').getBoundingClientRect(), t = document.getElementById('th').getBoundingClientRect(); return {l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), thL: Math.round(t.left), thR: Math.round(t.right)}; });
    assert.ok(r.l >= r.thL && r.r <= r.thR, `edit box inside the thread: ${JSON.stringify(r)}`);
    assert.ok(r.w >= 440, `edit box is still roomy: ${JSON.stringify(r)}`);
    await p.close();
  } finally { await browser.close(); }
});

test('wiring: laolao-metre-display.css is in the head after the Metre keys and backstage, owned by the Metre region, Metre-only, and adds no !important', () => {
  const head = read('laolao-head.fragment.html');
  assert.match(head, /<link rel="stylesheet" href="\/laolao-metre-keys\.css\?v=@hash">\n<script defer src="\/laolao-metre-backstage\.js\?v=@hash"><\/script>\n<link rel="stylesheet" href="\/laolao-metre-display\.css\?v=@hash">\n/);
  assert.ok(/"id": "metre"[\s\S]*?"laolao-metre-display\.css"/.test(read('regions.json')), 'registered in the Metre region');
  const css = read('laolao-metre-display.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!css.includes('!important'));
  for (const rule of css.split('}').map((s) => s.trim().replace(/^@media[^{]*\{\s*/, '')).filter(Boolean)) assert.match(rule, /^html\[data-laolao-mode="metre"\]/, `every rule is Metre-only: ${rule.slice(0, 80)}`);
});
