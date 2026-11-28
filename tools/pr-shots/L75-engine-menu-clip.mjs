#!/usr/bin/env node
// L75 的 PR 截图脚本（照 tools/pr-shots/minimal.mjs 的约定：node <脚本> --out <目录>，写 PNG + 追加 <目录>/shots.jsonl）。
// 拍 Metre 引擎菜单 four 状态（网关给四档）底部「放手程度」一节：
//   four-before：main 的样式——这一节在列表末尾跟着滚，列表比菜单高几 px，四个档位按钮的下边框被菜单底边切掉（对照用，不是基线）；
//   four：本 PR 的样式——这一节贴住列表底边，四个按钮整排可见。
// 1440 / 820 × 日 / 夜，共 8 张。拍之前鼠标挪开，拍的是不悬停的样子。
// 每张都量按钮底边和菜单可视底边：four 必须 ≤ 可视底边，four-before 必须超出（证明拍到的就是被切的样子）；
// 两组同尺寸同日夜的截图哈希相同就非零退出。
// 页面照 tests/metre-engine-menu-levels-clip.test.mjs 搭：真的 Metre 皮肤和引擎样式、真的引擎脚本，网关是假的（只在页面里回），
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
const FIX = ' position: sticky; bottom: 0; background: var(--metre-surface, #fff);';
const before = css.replace(FIX, '');
if (before === css) { console.error('没找到 sticky 规则，拍不了改之前的对照'); process.exit(1); }

// 和 services/mode-architecture/engines-bridge.mjs 的 LEVELS 同样四档。
const FOUR = [
  {id: 'full-access', name: '全放手', hint: '命令和改文件都直接做；真有问题或缺账号才来问你'},
  {id: 'auto', name: '自己判断', hint: '常规操作自己批，拿不准的来问你'},
  {id: 'auto-accept-edits', name: '改文件不问', hint: '改文件直接做，跑命令等别的事先问你'},
  {id: 'approval-required', name: '每步都问', hint: '跑命令、改文件之前都先等你点头'},
];

const page = (style, night) => `<!doctype html><html data-laolao-mode="metre"${night ? ' data-pinkie-night' : ''} lang="zh-CN"><head>
<style>${skin}</style><style>${style}</style>
<style>body{margin:0}.chat-main{position:relative;width:100vw;height:100vh;display:flex;flex-direction:column;justify-content:flex-end}</style></head><body>
<div class="chat-main"><div class="chat-thread" style="flex:1"></div>
<div class="agent-chat__composer-controls" style="display:flex;gap:4px;padding:12px"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;

function mockGateway(levels) {
  window.__laolaoToast = () => {};
  window.__laolaoSidebar = {gwRequest: async (method, params) => {
    if (method === 'pinkie.engines.session') return {sessionKey: params.sessionKey, pref: {engine: 'metre', level: 'auto-accept-edits'}, summary: null, error: '', service: {running: true}};
    if (method === 'pinkie.engines.catalog') return {enabled: true, running: true, source: 'live', levels, engines: []};
    return {};
  }};
}

const STATES = [
  {state: 'four-before', style: before, clipped: true},
  {state: 'four', style: css, clipped: false},
];

const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';
const channel = process.env.PINKIE_UI_CHANNEL;
const browser = await playwright()[engine].launch({headless: true, ...(engine === 'chromium' && channel ? {channel} : {})});
const lines = [];
const hashes = new Map();
const ORIGIN = 'http://127.0.0.1:30175';
try {
  for (const width of [1440, 820]) for (const night of [false, true]) for (const one of STATES) {
    const height = 900, tag = `${width}-${night ? 'night' : 'day'}`;
    const ctx = await browser.newContext({viewport: {width, height}, colorScheme: night ? 'dark' : 'light', locale: 'zh-CN'});
    const tab = await ctx.newPage();
    try {
      await tab.route(ORIGIN + '/**', (route) => route.fulfill({contentType: 'text/html', body: page(one.style, night)}));
      await tab.goto(ORIGIN + '/chat?session=agent%3Ametre%3Ashotsl75');
      await tab.evaluate(mockGateway, FOUR);
      await tab.addScriptTag({content: js});
      const chip = tab.locator('.agent-chat__composer-controls > .pk-eng-chip').first();
      await chip.waitFor({timeout: 15_000});
      await chip.click();
      await tab.locator('.pk-eng-menu .pk-eng-seg').first().waitFor({timeout: 15_000});
      await tab.mouse.move(0, 0);
      await tab.waitForTimeout(300);
      const m = await tab.evaluate(() => {
        const menu = document.querySelector('.pk-eng-menu'), body = menu.querySelector('.pk-eng-menu__body');
        const segs = [...menu.querySelectorAll('.pk-eng-menu__levels .pk-eng-seg')];
        const visible = Math.min(body.getBoundingClientRect().bottom, menu.getBoundingClientRect().bottom - parseFloat(getComputedStyle(menu).borderBottomWidth), innerHeight);
        return {count: segs.length, over: Math.max(...segs.map((seg) => seg.getBoundingClientRect().bottom)) - visible};
      });
      if (m.count !== 4) throw new Error(`${one.state} ${tag}：档位按钮有 ${m.count} 个，应该 4 个`);
      if (one.clipped && !(m.over > 0.5)) throw new Error(`${one.state} ${tag}：main 的样式下按钮应被切，实际超出 ${m.over}px——对照没拍到问题`);
      if (!one.clipped && m.over > 0.5) throw new Error(`${one.state} ${tag}：按钮底边超出菜单可视底边 ${m.over}px`);
      const name = `L75-${one.state}-${tag}`, file = name + '.png';
      const buf = await tab.screenshot({path: path.join(out, file)});
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      hashes.set(`${one.state} ${tag}`, sha256);
      lines.push({name, file, os: process.platform, browser: engine, width, height, bytes: buf.length, sha256, segOverPx: Math.round(m.over * 100) / 100});
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots L75: ${lines.length} 张 → ${out}`);
if (lines.length !== 8) { console.error('expected 8 shots'); process.exit(1); }
const same = [];
for (const width of [1440, 820]) for (const night of [false, true]) {
  const tag = `${width}-${night ? 'night' : 'day'}`;
  const a = hashes.get(`four-before ${tag}`), b = hashes.get(`four ${tag}`);
  if (!a || !b || a === b) same.push(tag);
}
if (same.length) { console.error(`four-before 和 four 的截图哈希相同：${same.join(', ')}`); process.exit(1); }
