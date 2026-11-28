// win-coord 7230136101 / uireview 23:23Z（#445 7230102280）：窄宽（<= 860px）下改动抽屉看不到。
// main 上 laolao-metre-engine.css 的窄宽 media 把 .pk-eng-stage--drawer 的列改成 `minmax(0, 1fr) 0`，
// 抽屉还按基础规则占第 2 列（grid-column: 2）。绝对定位的 grid 子项以自己占的格子为包含块，
// 所以 inset: 0 只铺满那条 0 宽的列，抽屉被压在右边一条窄带里。修法：窄宽下抽屉占满整个台面
// （grid-column: 1 / -1; grid-row: 1 / -1）。这是修 main 上已有的问题，不是 L34 本身带来的。
// 第 1 条是纯 node 静态检查（本机能跑）；后面是真页面断言（820 / 560 必须铺满，1440 仍是侧栏），
// 每条都在同一页面上换回旧写法当反例，旧写法必须量出「抽屉不到台面一半宽」。浏览器用例留给 CI。
import {after, test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = name => fs.readFileSync(fileURLToPath(new URL('../ui/injections/' + name, import.meta.url)), 'utf8');
const js = read('laolao-metre-engine.js');
const css = read('laolao-metre-engine.css');
const FIX = /grid-column:\s*1\s*\/\s*-1;\s*grid-row:\s*1\s*\/\s*-1;\s*/;
// 反例：同一份 CSS 去掉这两条声明，就是 main 上原来的写法。
const oldCss = css.replace(FIX, '');

function narrowDrawerRule(source) {
  const bare = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const media = bare.match(/@media\s*\(max-width:\s*860px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(media, 'has the narrow-width media block');
  const rule = media[1].match(/\.pk-eng-stage--drawer\s+\.pk-eng-drawer\s*\{([^}]*)\}/);
  assert.ok(rule, 'the narrow-width media has a .pk-eng-stage--drawer .pk-eng-drawer rule');
  return rule[1];
}

test('narrow width: the open drawer spans the whole stage grid, not the zero-width second column', () => {
  const rule = narrowDrawerRule(css);
  assert.match(rule, /grid-column:\s*1\s*\/\s*-1/, 'drawer spans every column under 860px');
  assert.match(rule, /grid-row:\s*1\s*\/\s*-1/, 'drawer spans every row under 860px');
  assert.match(rule, /position:\s*absolute/, 'still laid over the thread, not pushing it');
  assert.doesNotMatch(css, /!\s*important/i);
  assert.notEqual(oldCss, css, 'the counterexample really removes the fix');
  assert.doesNotMatch(narrowDrawerRule(oldCss), /grid-column/, 'the counterexample is the old main rule');
});

let shared = null;
function launch() {
  shared ??= (async () => {
    let lib;
    try { lib = playwright(); } catch { return {skip: 'Playwright is not installed here'}; }
    const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
    try {
      return {browser: await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})})};
    } catch (error) {
      return {skip: 'no browser: ' + error.message.split('\n')[0]};
    }
  })();
  return shared;
}
after(async () => {
  const got = await shared;
  if (got?.browser) await got.browser.close();
});

const view = () => ({
  sessionKey: 'agent:metre:a',
  pref: {engine: 'claudeAgent', model: 'claude-opus-5-5', level: 'auto', threadId: 't1'},
  summary: {thread: {id: 't1', engine: 'claudeAgent', engineName: 'Claude Code', model: 'claude-opus-5-5', level: 'auto'},
    status: 'completed', activeRunId: null, runStartedAt: null, runCompletedAt: new Date().toISOString(),
    pending: [], changes: [{file: 'a.css', additions: 1, deletions: 1, edits: 1}], turnCount: 1,
    items: [
      {id: 'u', kind: 'you', status: 'completed', text: 'fix it'},
      {id: 'r', kind: 'reply', status: 'completed', text: 'Done: `a.css`'},
    ]},
});
const diff = {diff: 'diff --git a/a.css b/a.css\n--- a/a.css\n+++ b/a.css\n@@ -1 +1 @@\n-a { color: red; }\n+a { color: blue; }\n', changes: [{file: 'a.css', additions: 1, deletions: 1}]};

// 在宽 width 的窗口里打开改动抽屉，量抽屉和台面的位置。
async function measure(browser, width, styles) {
  const context = await browser.newContext({viewport: {width, height: 800}});
  try {
    const tab = await context.newPage();
    const page = `<!doctype html><html data-laolao-mode="metre"><head><style>html,body{margin:0}${styles}</style></head><body>
      <div class="chat-main" style="position:relative;width:${width}px;height:760px"><div class="chat-thread">native</div>
      <div class="agent-chat__composer-controls"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;
    await tab.route('http://127.0.0.1:30117/**', route => route.fulfill({contentType: 'text/html', body: page}));
    await tab.goto('http://127.0.0.1:30117/chat?session=agent%3Ametre%3Aa');
    await tab.evaluate(([scene, patch]) => {
      window.__laolaoToast = () => {};
      window.__laolaoSidebar = {gwRequest: async method => {
        if (method === 'pinkie.engines.session') return scene;
        if (method === 'pinkie.engines.catalog') return {enabled: true, running: true, levels: [], engines: []};
        if (method === 'pinkie.engines.diff') return patch;
        return {};
      }};
    }, [view(), diff]);
    await tab.addScriptTag({content: js});
    await tab.locator('.pk-eng-stage .pk-eng-chip--changes').click({timeout: 10_000});
    await tab.locator('.pk-eng-stage--drawer .pk-eng-drawer:not([hidden])').waitFor({timeout: 10_000});
    await tab.locator('.pk-eng-drawer .pk-eng-diff').waitFor({timeout: 10_000});
    return await tab.evaluate(() => {
      const box = el => { const r = el.getBoundingClientRect(); return {left: r.left, right: r.right, width: r.width, height: r.height}; };
      const drawer = document.querySelector('.pk-eng-drawer');
      const out = {stage: box(document.querySelector('.pk-eng-stage')), drawer: box(drawer), viewport: innerWidth};
      // uireview 23:23Z：面板里的控件拿到焦点时，浏览器会把它滚进视口，旧写法下整页因此左移约一个面板宽。
      drawer.querySelector('.pk-eng-drawer__close').focus();
      const shifted = [];
      if (window.scrollX) shifted.push('window ' + window.scrollX);
      for (let el = drawer.parentElement; el; el = el.parentElement) if (el.scrollLeft) shifted.push((el.className || el.tagName) + ' ' + el.scrollLeft);
      out.shifted = shifted;
      return out;
    });
  } finally { await context.close().catch(() => {}); }
}

for (const width of [820, 560]) {
  test(`real page ${width}px: the open drawer covers the whole stage; with the old rule it is squeezed to the right edge`, {timeout: 60_000}, async t => {
    const got = await launch();
    if (got.skip) { t.skip(got.skip); return; }
    const now = await measure(got.browser, width, css);
    assert.ok(now.stage.width > 300, `stage is laid out at ${width}px: ${JSON.stringify(now.stage)}`);
    assert.ok(Math.abs(now.drawer.left - now.stage.left) <= 1, `drawer starts at the stage's left edge: ${JSON.stringify(now)}`);
    assert.ok(now.drawer.width >= now.stage.width - 2, `drawer is as wide as the stage: ${JSON.stringify(now)}`);
    assert.ok(now.drawer.height >= now.stage.height - 2, `drawer is as tall as the stage: ${JSON.stringify(now)}`);
    assert.ok(now.drawer.left >= -1 && now.drawer.right <= now.viewport + 1, `drawer stays inside the window: ${JSON.stringify(now)}`);
    assert.deepEqual(now.shifted, [], 'focusing a control in the drawer does not scroll the page or the stage sideways');
    const before = await measure(got.browser, width, oldCss);
    assert.ok(before.drawer.width < before.stage.width / 2, `counterexample: the old rule leaves the drawer under half the stage: ${JSON.stringify(before)}`);
  });
}

test('real page 1440px: the drawer stays a side panel on the right (the narrow fix does not apply)', {timeout: 60_000}, async t => {
  const got = await launch();
  if (got.skip) { t.skip(got.skip); return; }
  const wide = await measure(got.browser, 1440, css);
  assert.ok(wide.drawer.width > 200 && wide.drawer.width < wide.stage.width / 2, `side panel, not full width: ${JSON.stringify(wide)}`);
  assert.ok(Math.abs(wide.drawer.right - wide.stage.right) <= 1, `side panel sits on the right: ${JSON.stringify(wide)}`);
});
