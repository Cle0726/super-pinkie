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

test('wiring: laolao-metre-display.css is in the head after the Metre keys and backstage, owned by the Metre region, Metre-only, and adds no !important', () => {
  const head = read('laolao-head.fragment.html');
  assert.match(head, /<link rel="stylesheet" href="\/laolao-metre-keys\.css\?v=@hash">\n<script defer src="\/laolao-metre-backstage\.js\?v=@hash"><\/script>\n<link rel="stylesheet" href="\/laolao-metre-display\.css\?v=@hash">\n/);
  assert.ok(/"id": "metre"[\s\S]*?"laolao-metre-display\.css"/.test(read('regions.json')), 'registered in the Metre region');
  const css = read('laolao-metre-display.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!css.includes('!important'));
  for (const rule of css.split('}').map((s) => s.trim()).filter(Boolean)) assert.match(rule, /^html\[data-laolao-mode="metre"\]/, `every rule is Metre-only: ${rule.slice(0, 80)}`);
});
