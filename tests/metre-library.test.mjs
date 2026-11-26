// R5 ③：作品库「在工作台打开」+ 工作台不在时的只读预览面板（laolao-metre-library.js）+ 后端 maxBytes（tests/workbench-read-maxbytes.test.mjs）。
// 复发防护：
//   1. 键只在 Metre、只给当前项目文件夹里的文本类作品（md / csv / txt）；项目外、图片 / HTML / PDF 不出键（反例）。
//   2. 键单独一条放在查看器头部下面（不挤头部，× 不被挤出纸面）；停在旧版本时键写「打开当前文件」、说明写「作品库里看的是第 N 版…」，换到最新版回到「在工作台打开」；打开的是磁盘上的原文件（工作台标签，相对项目根）。
//   3. 工作台出不来（< 600）时开只读预览：读的时候带 maxBytes 256 KB；截了就说「只显示前 256 KB…」；图片内联；二进制说去处；Esc 关、焦点回到键上。
//   4. 其他模式同样的作品不出键（反例）。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = rel => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const js = read('../ui/injections/laolao-metre-library.js');
const css = read('../ui/injections/laolao-metre-library.css');
const bench = read('../ui/injections/laolao-workbench.js');
const artifacts = read('../ui/injections/laolao-artifacts.js');
const domWatch = read('../ui/injections/laolao-dom-watch.js');
const head = read('../ui/injections/laolao-head.fragment.html');
const regions = JSON.parse(read('../ui/injections/regions.json'));
const PORT = 30133;
const TYPES = {js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', ttf: 'font/ttf', svg: 'image/svg+xml', png: 'image/png'};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('loaded after metre-files, owned by the metre region, rides the existing art-viewer hook; no observer / interval / window global / !important', () => {
  const at = name => head.indexOf(`/${name}?v=@hash`);
  assert.ok(at('laolao-metre-library.css') > at('laolao-metre-files.js'));
  assert.ok(at('laolao-metre-library.js') > at('laolao-metre-library.css'));
  const metre = Object.values(regions.regions || regions).find(region => (region.files || []).includes('laolao-metre-files.js'));
  assert.ok(metre?.files.includes('laolao-metre-library.js') && metre.files.includes('laolao-metre-library.css'));
  assert.doesNotMatch(js, /new MutationObserver|setInterval\(|window\.__\w+\s*=/);
  assert.doesNotMatch(css, /!important/);
  assert.match(artifacts, /dispatchEvent\(new CustomEvent\('pinkie:art-viewer', \{detail: \{item, actions\}\}\)\)/, 'the viewer still hands out {item, actions}');
  assert.match(artifacts, /label\.textContent = `版本 \$\{index \+ 1\} \/ \$\{item\.versions\.length\}`/, 'and still writes 版本 N / M, which the key reads');
});

let sharedBrowser;
after(async () => { const b = await sharedBrowser; await b?.close?.(); });
async function start() {
  let lib;
  try { lib = playwright(); } catch { return {why: 'Playwright is not installed here'}; }
  for (const options of [{}, {channel: 'chrome'}, {channel: 'msedge'}]) {
    try { return await lib.chromium.launch({headless: true, ...options}); } catch {}
  }
  return {why: 'no Chromium browser here'};
}
async function launch(t) {
  sharedBrowser ??= start();
  const b = await sharedBrowser;
  if (b.why) { t.skip(b.why); return null; }
  return b;
}
const page = mode => `<!doctype html><html data-laolao-mode="${mode}"><head><link rel="stylesheet" href="/laolao-workbench.css"><style>${css}</style></head><body>
<main class="content content--chat" style="position:fixed;inset:0;overflow:auto"><openclaw-chat-pane active></openclaw-chat-pane></main></body></html>`;
async function open(browser, mode, {width = 1280} = {}) {
  const tab = await browser.newPage({viewport: {width, height: 800}});
  await tab.route(`http://127.0.0.1:${PORT}/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/chat') return route.fulfill({contentType: 'text/html; charset=utf-8', body: page(mode)});
    const file = fileURLToPath(new URL('../ui/injections' + url.pathname, import.meta.url));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({status: 404, body: ''});
    return route.fulfill({contentType: TYPES[file.split('.').pop()] || 'application/octet-stream', body: fs.readFileSync(file)});
  });
  await tab.goto(`http://127.0.0.1:${PORT}/chat?session=agent%3A${mode === 'metre' ? 'metre' : 'project'}%3Atest`);
  await tab.evaluate(png => {
    document.querySelector('openclaw-chat-pane').state = {chatMessages: [], sessionKey: location.search.includes('metre') ? 'agent:metre:test' : 'agent:project:test'};
    window.calls = [];
    window.__laolaoSidebar = {gwRequest: async (method, params = {}) => {
      window.calls.push([method, params.path || '', params.maxBytes]);
      if (method === 'pinkie.fs.status') return {root: '/proj', agentId: 'metre', name: 'proj', bound: true, unrestricted: false};
      if (method === 'pinkie.fs.list') return {entries: []};
      if (method === 'pinkie.fs.read') {
        const p = String(params.path);
        if (/big\.md$/.test(p)) return {kind: 'text', content: '# 开头\n', path: p, readOnly: true, truncated: true, size: 900000, mtimeMs: 1};
        if (/\.png$/.test(p)) return {kind: 'image', dataUrl: png, path: p, readOnly: false, size: 70, mtimeMs: 1};
        if (/\.bin$/.test(p)) return {kind: 'binary', path: p, readOnly: false, size: 70, mtimeMs: 1};
        return {kind: 'text', content: 'text of ' + p, path: p, readOnly: false, size: 10, mtimeMs: 1};
      }
      if (method === 'pinkie.fs.git') return {repo: false};
      if (method === 'pinkie.fs.stat') return {stats: (params.paths || []).map(p => ({path: p, exists: true, kind: 'file', size: 10, mtimeMs: 1}))};
      return {};
    }};
  }, PNG);
  await tab.addScriptTag({content: domWatch});
  await tab.addScriptTag({content: bench});
  await tab.addScriptTag({content: js});
  return tab;
}
// 照作品库查看器的结构搭一个（.pinkie-art-viewer > .pinkie-art-view > 版本标签 + actions），再发它会发的事件
const viewer = (tab, item, label = '版本 1 / 1') => tab.evaluate(([item, label]) => {
  document.querySelector('.pinkie-art-viewer')?.remove();
  const mask = document.createElement('div'); mask.className = 'pinkie-art-viewer';
  mask.style.cssText = 'position:fixed;inset:0;z-index:2147481000;display:flex;align-items:center;justify-content:center';   // 同 laolao-artifacts.css 里真查看器的叠放
  mask.innerHTML = `<section class="pinkie-art-view"><header><span class="pinkie-art-versions__label">${label}</span><div class="pinkie-art-view__actions"><button class="pinkie-art-btn">打开</button></div></header></section>`;
  document.body.append(mask);
  // 和真查看器一样：点遮罩本身关闭；Esc 挂在 document 捕获阶段关闭
  const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); } };
  const finish = () => { mask.remove(); document.removeEventListener('keydown', onKey, true); };
  document.addEventListener('keydown', onKey, true);
  mask.onpointerdown = event => { if (event.target === mask) finish(); };
  window.dispatchEvent(new CustomEvent('pinkie:art-viewer', {detail: {item, actions: mask.querySelector('.pinkie-art-view__actions')}}));
}, [item, label]);
const keyText = tab => tab.evaluate(async () => { for (let i = 0; i < 40; i++) { const k = document.querySelector('.pk-mlib-open'); if (k) return k.textContent; await new Promise(r => setTimeout(r, 25)); } return null; });
const item = (path, kind = 'doc') => ({id: 'a-' + path, path, kind, title: path.split('/').pop(), versions: [{v: 1}, {v: 2}]});

test('in Metre the library viewer offers 在工作台打开 for text artifacts inside the project only, names the version it is showing, and opens the file on disk', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  const tab = await open(browser, 'metre');
  try {
    await viewer(tab, item('/proj/notes.md'), '版本 1 / 2');
    assert.equal(await keyText(tab), '打开当前文件', 'an old version is on screen: the key says it opens the current file');
    assert.equal(await tab.locator('.pk-mlib-open').getAttribute('aria-label'), '打开当前文件（作品库里看的是第 1 版）');
    assert.equal(await tab.locator('.pk-mlib-strip__note').textContent(), '作品库里看的是第 1 版；磁盘上的文件可能已经改过', 'and the strip says which version is on screen');
    // 键不进查看器头部（头部 820 时就满了，塞进去 × 会被挤出纸面）：单独一条，紧跟在头部后面
    assert.equal(await tab.evaluate(() => document.querySelector('.pinkie-art-view__actions .pk-mlib-open')), null, 'the key is not squeezed into the header');
    assert.equal(await tab.evaluate(() => document.querySelector('.pinkie-art-view header').nextElementSibling?.className), 'pk-mlib-strip');
    await viewer(tab, item('/proj/notes.md'), '版本 2 / 2');
    assert.equal(await keyText(tab), '在工作台打开');
    assert.equal(await tab.locator('.pk-mlib-strip').count(), 1, 'one strip per viewer');
    assert.equal(await tab.locator('.pk-mlib-open').getAttribute('title'), '打开的是磁盘上的当前文件，不是作品库里的快照');
    // 反例：项目外、图片、HTML 不出键
    for (const [p, kind] of [['/etc/notes.md', 'doc'], ['/proj/a.png', 'image'], ['/proj/page.html', 'html'], ['/proj/r.pdf', 'doc']]) {
      await viewer(tab, item(p, kind));
      assert.equal(await keyText(tab), null, p + ' gets no key');
    }
    await viewer(tab, item('/proj/data.csv', 'sheet'));
    assert.equal(await keyText(tab), '在工作台打开', 'csv is text too');
    await tab.locator('.pk-mlib-open').click();
    await tab.waitForFunction(() => window.__pinkieWorkbench.state.tabs.some(t => t.path === 'data.csv' && t.kind === 'text'), null, {timeout: 10_000});
    assert.equal(await tab.locator('.pk-mlib-preview').count(), 0, 'the workbench is here, so no preview panel');
    await tab.waitForFunction(() => !document.querySelector('.pinkie-art-viewer'), null, {timeout: 3000});
    assert.equal(await tab.locator('.pinkie-art-viewer').count(), 0, 'the full-screen viewer must not stay over the workbench');
  } finally { await tab.close(); }
});

test('under 600px the key opens a read-only preview instead: 256 KB head only, says so when cut, images inline, binaries point elsewhere; Esc closes and returns focus', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  const tab = await open(browser, 'metre', {width: 560});
  try {
    // 窄窗口：键是短字、整个在视口里，不靠挤查看器头部
    await viewer(tab, item('/proj/big.md'), '版本 1 / 2');
    assert.equal(await keyText(tab), '打开当前文件');
    assert.ok(await tab.evaluate(() => { const r = document.querySelector('.pk-mlib-open').getBoundingClientRect(); return r.width > 0 && r.width < 140 && r.right <= innerWidth; }), 'the key is short and fully on screen');
    await viewer(tab, item('/proj/big.md'), '版本 2 / 2');
    assert.equal(await keyText(tab), '在工作台打开');
    await tab.locator('.pk-mlib-open').click();
    await tab.locator('.pk-mlib-preview__text').waitFor({timeout: 5000});
    assert.equal(await tab.evaluate(() => window.__pinkieWorkbench.state.visible), false, 'the workbench is not forced out');
    assert.ok((await tab.evaluate(() => window.calls)).some(([m, p, max]) => m === 'pinkie.fs.read' && p === '/proj/big.md' && max === 262144), 'asks for the first 256 KB only');
    assert.equal(await tab.locator('.pk-mlib-preview__text').textContent(), '# 开头\n');
    assert.equal(await tab.locator('.pk-mlib-preview__note').textContent(), '只显示前 256 KB，完整内容请在工作台或系统程序里打开');
    assert.equal(await tab.locator('.pk-mlib-preview__tag').textContent(), '当前文件 · 只读', 'says it is the file on disk now, not the version the viewer shows');
    // 遮罩是压暗：日夜都是深色半透明（反例：从 --metre-text 混出来，夜间会把底下提亮）
    const [r, g, b, a] = (await tab.evaluate(() => getComputedStyle(document.querySelector('.pk-mlib-preview')).backgroundColor)).match(/[\d.]+/g).map(Number);
    assert.ok(Math.max(r, g, b) < 60 && a > 0.3, 'the mask dims what is under it');
    assert.equal(await tab.locator('.pk-mlib-preview').getAttribute('role'), 'dialog');
    assert.ok(await tab.evaluate(() => Number(getComputedStyle(document.querySelector('.pk-mlib-preview')).zIndex) > 2147481000), 'the panel stacks above the library viewer');
    await tab.keyboard.press('Escape');
    await tab.waitForFunction(() => !document.querySelector('.pk-mlib-preview'));
    assert.equal(await tab.locator('.pinkie-art-viewer').count(), 1, 'one Esc closes only the preview, the viewer under it stays');
    assert.equal(await tab.evaluate(() => document.activeElement?.classList.contains('pk-mlib-open')), true, 'focus goes back to the key');
    // 不截的文本不出说明；图片内联；二进制说去处
    assert.equal(await tab.evaluate(() => window.Pinkie.metreLibrary.openPreview('/proj/small.md')), 'text');
    assert.equal(await tab.locator('.pk-mlib-preview__note').isVisible(), false);
    assert.equal(await tab.evaluate(() => window.Pinkie.metreLibrary.openPreview('/proj/a.png')), 'image');
    assert.equal(await tab.locator('.pk-mlib-preview__image').count(), 1);
    assert.equal(await tab.evaluate(() => window.Pinkie.metreLibrary.openPreview('/proj/x.bin')), 'binary');
    assert.match(await tab.locator('.pk-mlib-preview__note').textContent(), /请用系统默认程序打开/);
    assert.equal(await tab.locator('.pk-mlib-preview').count(), 1, 'one panel at a time');
  } finally { await tab.close(); }
});

test('in other modes the same artifact gets no key (counterexample)', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  const tab = await open(browser, 'project');
  try {
    await viewer(tab, item('/proj/notes.md'));
    assert.equal(await keyText(tab), null);
  } finally { await tab.close(); }
});
