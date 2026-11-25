// 回复里原生代码块的标题栏（语言名 + 「复制」）：非 Metre 五个模式 × 日夜，小字对标题栏实际底 ≥ 4.5:1。
// 页面加载真主题 laolao-theme.css、laolao-night.css、laolao-rich.css；原生 index.css 不在仓库里，只抄标题栏那几条原样放进页面。
// 背后放最坏的情况：粉色壁纸直接透到消息里（日间 #d9598f，夜间 #1a1418）。
// 反例：把 laolao-rich.css 里给标题栏加的两条去掉（回到原生 #00000014 + --muted），项目日间要红。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const inj = (name) => fs.readFileSync(path.join(root, 'ui', 'injections', name), 'utf8');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
const ORIGIN = 'http://127.0.0.1:30132';

// 原生 openclaw control-ui index.css 里标题栏的规则（2026.7.1-2，原样）和根变量
const NATIVE = ':root{--text:#d4d4d8;--muted:#8b8b94;--mono:monospace;--font-body:sans-serif;--radius-sm:6px}'
  + ':root[data-theme-mode=light]{--text:#403c35;--muted:#6e6960}'
  + '.code-block-wrapper{border-radius:var(--radius-sm);margin-top:.75em;position:relative;overflow:visible}'
  + '.code-block-wrapper pre{border-radius:0 0 var(--radius-sm) var(--radius-sm);margin:0;overflow-x:auto}'
  + '.code-block-header{background:#00000040;justify-content:space-between;align-items:center;gap:8px;padding:4px 8px 4px 12px;font-size:12px;line-height:1;display:flex}'
  + ':root[data-theme-mode=light] .code-block-header{background:#00000014}'
  + '.code-block-lang{color:var(--muted);font-family:var(--mono);text-transform:lowercase;font-size:12px}'
  + '.code-block-copy{appearance:none;color:var(--muted);font-size:12px;font-family:var(--font-body);background:0 0;border:none;padding:2px 6px}';

const MSG = '<div class="chat-group assistant"><div class="chat-group-messages"><div class="chat-bubble"><div class="chat-text"><p>例子：</p>'
  + '<div class="code-block-wrapper"><div class="code-block-header"><span class="code-block-lang">chart</span><button type="button" class="code-block-copy"><span class="code-block-copy__idle">复制</span></button></div>'
  + '<pre><code>{"type":"bar"}</code></pre></div><p>完。</p></div></div></div></div>';

const page = ({mode, night}) => `<!doctype html><html data-laolao-mode="${mode}" data-theme="${night ? 'dark' : 'light'}"${night ? ' data-pinkie-night="1"' : ' data-theme-mode="light"'}><head>`
  + `<style>${NATIVE}</style>`
  + '<link rel="stylesheet" href="/laolao-theme.css"><link rel="stylesheet" href="/laolao-night.css"><link rel="stylesheet" href="/laolao-rich.css">'
  + `<style>html,body{background:${night ? '#1a1418' : '#d9598f'} !important;background-image:none !important}</style></head>`
  + `<body style="margin:0;width:760px;font:15px/1.7 sans-serif"><div class="chat-thread"><div class="chat-thread-inner">${MSG}</div></div></body></html>`;

async function open(browser, opts, mutateRich = null) {
  const tab = await browser.newPage({viewport: {width: 800, height: 600}});
  const errors = [];
  tab.on('pageerror', (e) => errors.push(String(e)));
  await tab.route(ORIGIN + '/**', (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (name === 'chat') return route.fulfill({contentType: 'text/html; charset=utf-8', body: page(opts)});
    if (!/^laolao-[\w.-]+\.css$/.test(name)) return route.fulfill({status: 404, body: ''});
    let body = inj(name);
    if (name === 'laolao-rich.css' && mutateRich) body = mutateRich(body);
    return route.fulfill({contentType: 'text/css; charset=utf-8', body});
  });
  await tab.goto(ORIGIN + '/chat');
  await tab.waitForFunction(() => [...document.styleSheets].length >= 5);
  return {tab, errors};
}

// 标题栏小字对它实际看到的底：从标题栏往上一层层叠背景色，叠到页面底为止。
const headerProblems = (tab) => tab.evaluate(() => {
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return {r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1}; };
  const over = (top, under) => ({r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1});
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const seenBg = (node) => {
    const layers = [];
    for (let n = node; n && n.nodeType === 1; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) layers.push(c); }
    let acc = {r: 255, g: 255, b: 255, a: 1};
    for (const c of layers.reverse()) acc = over(c, acc);
    return acc;
  };
  const out = [];
  for (const sel of ['.code-block-lang', '.code-block-copy']) {
    const el = document.querySelector('.code-block-header ' + sel);
    const bg = seenBg(el);
    const fg = over(parse(getComputedStyle(el).color), bg);
    const r = ratio(fg, bg);
    if (r < 4.5) out.push(`${el.textContent} ${r.toFixed(2)}:1（字 ${getComputedStyle(el).color}，底 ${getComputedStyle(el.closest('.code-block-header')).backgroundColor}）`);
  }
  return out;
});

const MODES = ['chat', 'project', 'thinking', 'learning', 'unrestricted'];

test('原生代码块标题栏：非 Metre 五个模式 × 日夜，语言名和「复制」对实际底 ≥ 4.5:1；反例（去掉补丁）项目日间要红', async () => {
  const browser = await launch();
  try {
    const found = [];
    for (const mode of MODES) for (const night of [false, true]) {
      const {tab, errors} = await open(browser, {mode, night});
      for (const p of await headerProblems(tab)) found.push(`${mode}${night ? ' 夜' : ' 日'}：${p}`);
      assert.deepEqual(errors, []);
      await tab.close();
    }
    assert.deepEqual(found, []);

    const strip = (css) => {
      const out = css.replace(/^html:not\(\[data-laolao-mode="metre"\]\)[^\n]*code-block-header[^\n]*\n/gm, '');
      assert.notEqual(out, css, '反例：找得到标题栏那两条');
      return out;
    };
    const {tab} = await open(browser, {mode: 'project', night: false}, strip);
    const bad = await headerProblems(tab);
    assert.ok(bad.length >= 1, '反例：回到原生样式时项目日间要红，实际 ' + JSON.stringify(bad));
  } finally { await browser.close(); }
});
