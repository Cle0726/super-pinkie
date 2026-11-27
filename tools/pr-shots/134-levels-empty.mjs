#!/usr/bin/env node
// #134 的 PR 截图脚本（照 tools/pr-shots/minimal.mjs 的约定：node <脚本> --out <目录>，写 PNG + 追加 <目录>/shots.jsonl）。
// 拍 Metre 引擎菜单底部「放手程度」一节：
//   fail-before：取清单失败（退成 levels: []），用去掉空检查的旧代码——只剩一个空的「放手程度」标题（对照用，不是基线）；
//   fail：同样取清单失败，用本 PR 的代码——不再画这一节；
//   four：网关给四档——四个按钮照旧，和改之前一样。
// 1440 / 820 × 日 / 夜，共 12 张。拍之前鼠标挪开，拍的是不悬停的样子。
// 页面照 tests/metre-engine-menu-levels.test.mjs 搭：真的 Metre 皮肤和引擎样式、真的引擎脚本，网关是假的（只在页面里回），
// 不连网关、不碰用户会话。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {playwright} from '../study-desk/harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});

const read = (name) => fs.readFileSync(fileURLToPath(new URL('../../ui/injections/' + name, import.meta.url)), 'utf8');
const skin = read('laolao-metre-skin.css');
const css = read('laolao-metre-engine.css');
const js = read('laolao-metre-engine.js');
const GUARD = 'if ((catalog.levels || []).length) body.append(levels);';
const before = js.replace(GUARD, 'body.append(levels);');
if (before === js) { console.error('没找到空检查，拍不了改之前的对照'); process.exit(1); }

// 和 services/mode-architecture/engines-bridge.mjs 的 LEVELS 同样四档。
const FOUR = [
  {id: 'full-access', name: '全放手', hint: '命令和改文件都直接做；真有问题或缺账号才来问你'},
  {id: 'auto', name: '自己判断', hint: '常规操作自己批，拿不准的来问你'},
  {id: 'auto-accept-edits', name: '改文件不问', hint: '改文件直接做，跑命令等别的事先问你'},
  {id: 'approval-required', name: '每步都问', hint: '跑命令、改文件之前都先等你点头'},
];

const page = (night) => `<!doctype html><html data-laolao-mode="metre"${night ? ' data-pinkie-night' : ''} lang="zh-CN"><head>
<style>${skin}</style><style>${css}</style>
<style>body{margin:0}.chat-main{position:relative;width:100vw;height:100vh;display:flex;flex-direction:column;justify-content:flex-end}</style></head><body>
<div class="chat-main"><div class="chat-thread" style="flex:1"></div>
<div class="agent-chat__composer-controls" style="display:flex;gap:4px;padding:12px"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;

function mockGateway({catalog}) {
  window.__laolaoToast = () => {};
  window.__laolaoSidebar = {gwRequest: async (method, params) => {
    if (method === 'pinkie.engines.session') return {sessionKey: params.sessionKey, pref: {engine: 'metre', level: 'auto-accept-edits'}, summary: null, error: '', service: {running: true}};
    if (method === 'pinkie.engines.catalog') { if (catalog === 'fail') throw new Error('gateway timeout'); return catalog; }
    return {};
  }};
}

const STATES = [
  {state: 'fail-before', code: before, catalog: 'fail', section: true},
  {state: 'fail', code: js, catalog: 'fail', section: false},
  {state: 'four', code: js, catalog: {enabled: true, running: true, source: 'live', levels: FOUR, engines: []}, section: true},
];

const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';
const channel = process.env.PINKIE_UI_CHANNEL;
const browser = await playwright()[engine].launch({headless: true, ...(engine === 'chromium' && channel ? {channel} : {})});
const lines = [];
const ORIGIN = 'http://127.0.0.1:30134';
try {
  for (const width of [1440, 820]) for (const night of [false, true]) for (const one of STATES) {
    const height = 900, tag = `${width}-${night ? 'night' : 'day'}`;
    const ctx = await browser.newContext({viewport: {width, height}, colorScheme: night ? 'dark' : 'light', locale: 'zh-CN'});
    const tab = await ctx.newPage();
    try {
      await tab.route(ORIGIN + '/**', (route) => route.fulfill({contentType: 'text/html', body: page(night)}));
      await tab.goto(ORIGIN + '/chat?session=agent%3Ametre%3Ashots134');
      await tab.evaluate(mockGateway, {catalog: one.catalog});
      await tab.addScriptTag({content: one.code});
      const chip = tab.locator('.agent-chat__composer-controls > .pk-eng-chip').first();
      await chip.waitFor({timeout: 15_000});
      await chip.click();
      await tab.locator('.pk-eng-menu .pk-eng-menu__item').first().waitFor({timeout: 15_000});
      const section = await tab.locator('.pk-eng-menu .pk-eng-menu__levels').count();
      if (Boolean(section) !== one.section) throw new Error(`${one.state} ${tag}: 「放手程度」一节 ${section ? '有' : '没有'}，应该${one.section ? '有' : '没有'}`);
      await tab.mouse.move(0, 0);
      await tab.waitForTimeout(300);
      const name = `134-${one.state}-${tag}`, file = name + '.png';
      const buf = await tab.screenshot({path: path.join(out, file)});
      lines.push({name, file, os: process.platform, browser: engine, width, height, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots #134: ${lines.length} 张 → ${out}`);
if (lines.length !== 12) { console.error('expected 12 shots'); process.exit(1); }
