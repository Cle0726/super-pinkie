// 11-24 T3 第一批 #12：Metre 输入框图片缩略图点开放大（laolao-metre-thumbs.js），真浏览器里跑。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const inj = (f) => fileURLToPath(new URL('../ui/injections/' + f, import.meta.url));
const read = (f) => fs.readFileSync(inj(f), 'utf8');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});

// 原生 2026.7.1-2 的缩略条结构（chat-page 打包里 .chat-attachments-preview > .chat-attachment-thumb > img + 移除键）
const IMG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#3355cc"/></svg>');
const page = (mode) => `<!doctype html><html data-laolao-mode="${mode}"><head><style>
  .chat-attachments-preview{display:flex;gap:8px;padding:10px} .chat-attachment-thumb{width:60px;height:60px;position:relative;overflow:hidden;border:1px solid #ccc}
  .chat-attachment-thumb img{width:100%;height:100%;object-fit:cover} .chat-attachment-remove{position:absolute;top:2px;right:2px;width:24px;height:24px}
</style></head><body><openclaw-chat-pane><div class="chat-attachments-preview">
  <div class="chat-attachment-thumb" id="t1"><img src="${IMG}" alt="shot.png"><button class="chat-attachment-remove" aria-label="Remove attachment" id="rm">×</button></div>
  <div class="chat-attachment-thumb chat-attachment-thumb--file" id="f1"><span>报告.pdf</span></div>
</div><textarea></textarea></openclaw-chat-pane></body></html>`;

async function setup(browser, mode) {
  const p = await browser.newPage({viewport: {width: 1200, height: 700}});
  await p.setContent(page(mode));
  await p.addScriptTag({path: inj('laolao-image-viewer.js')});
  await p.addScriptTag({path: inj('laolao-metre-thumbs.js')});
  await p.evaluate(() => document.querySelector('textarea').dispatchEvent(new Event('paste', {bubbles: true})));
  await p.waitForTimeout(700);
  return p;
}
const state = (p) => p.evaluate(() => {
  const v = document.getElementById('laolao-image-viewer'), t = document.getElementById('t1'), f = document.getElementById('f1');
  return {viewer: !!v, src: v?.querySelector('img')?.getAttribute('src')?.slice(0, 22) || null, role: t.getAttribute('role'), tab: t.getAttribute('tabindex'), label: t.getAttribute('aria-label'), fileRole: f.getAttribute('role')};
});

test(`Metre composer thumbnail opens the image viewer; remove key and other modes untouched (${engine})`, {timeout: 60_000}, async () => {
  const browser = await launch();
  try {
    const p = await setup(browser, 'metre');
    let s = await state(p);
    assert.deepEqual([s.role, s.tab, s.label, s.fileRole], ['button', '0', '放大查看这张图', null], `Metre thumb decorated, file card not: ${JSON.stringify(s)}`);
    await p.click('#rm');
    s = await state(p);
    assert.equal(s.viewer, false, 'clicking the remove key must not open the viewer');
    await p.click('#t1', {position: {x: 15, y: 40}});
    s = await state(p);
    assert.ok(s.viewer && s.src === 'data:image/svg+xml,%3C', `click opens the viewer with the original image: ${JSON.stringify(s)}`);
    await p.keyboard.press('Escape');
    assert.equal((await state(p)).viewer, false, 'Escape closes the viewer');
    await p.focus('#t1'); await p.keyboard.press('Enter');
    assert.equal((await state(p)).viewer, true, 'Enter on the focused thumb opens the viewer');
    await p.close();

    const q = await setup(browser, 'chat');
    await q.click('#t1', {position: {x: 15, y: 40}});
    s = await state(q);
    assert.deepEqual([s.viewer, s.role, s.tab], [false, null, null], `other modes untouched: ${JSON.stringify(s)}`);
    await q.close();
  } finally { await browser.close(); }
});

test('wiring: laolao-metre-thumbs.js is registered, loaded after the viewer, and adds no forbidden patterns', () => {
  const head = read('laolao-head.fragment.html');
  assert.match(head, /<script defer src="\/laolao-metre-thumbs\.js\?v=@hash"><\/script>/);
  assert.ok(head.indexOf('laolao-image-viewer.js') < head.indexOf('laolao-metre-thumbs.js'), 'viewer is loaded before the thumbs script');
  const regions = JSON.parse(read('regions.json'));
  const owner = (regions.regions || regions).find((g) => (g.files || []).includes('laolao-metre-thumbs.js'));
  assert.equal(owner?.id, 'metre');
  const js = read('laolao-metre-thumbs.js');
  for (const bad of [/MutationObserver/, /setInterval/, /window\.__\w+\s*=(?!=)/, /!important/]) assert.doesNotMatch(js, bad);
});
