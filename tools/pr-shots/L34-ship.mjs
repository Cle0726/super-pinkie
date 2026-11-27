#!/usr/bin/env node
// L34（T3 #22）的 PR 截图脚本：Metre 引擎台右侧「改动」面板最底下的「提交 / 开 PR」一条（laolao-metre-ship.js / .css）。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + 追加 <目录>/shots.jsonl。
// 页面照 tools/pr-shots/127-engine-upstream.mjs 搭：真的 Metre 皮肤、引擎台样式和脚本、共用观察器、本功能的脚本和样式；
// 网关是假的（只在页面里回会话、目录、改动和 pinkie.engines.ship.*），不连网关、不碰用户会话、不跑 git / gh。
// 每格（1440 / 820 × 日 / 夜）拍四张，共 16 张：
//   ship-drawer   打开「改动」面板：有两个文件没提交，「提交…」能点，「开 PR…」灰着并写原因
//   ship-commit   点了「提交…」：确认框（几个文件、哪个分支、写好的提交说明），还没提交
//   ship-clean    点了「确认提交」以后：结果一行，「提交…」灰着，「开 PR…」能点
//   ship-pr       点了「开 PR…」：确认框（推哪个分支、不强推、不合并，标题、说明、开成草稿），不点确认
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
const engineCss = read('laolao-metre-engine.css');
const shipCss = read('laolao-metre-ship.css');
const domWatch = read('laolao-dom-watch.js');
const engineJs = read('laolao-metre-engine.js');
const shipJs = read('laolao-metre-ship.js');

const page = (night) => `<!doctype html><html data-laolao-mode="metre"${night ? ' data-pinkie-night' : ''} lang="zh-CN"><head>
<style>${skin}</style><style>${engineCss}</style><style>${shipCss}</style>
<style>body{margin:0}.chat-main{position:relative;width:100vw;height:100vh;display:flex;flex-direction:column;justify-content:flex-end}</style></head><body>
<div class="chat-main"><div class="chat-thread" style="flex:1"></div>
<div class="agent-chat__composer-controls" style="display:flex;gap:4px;padding:12px"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;

// 在页面里跑：假网关。改动面板读 pinkie.engines.diff，提交 / 开 PR 那一条读 pinkie.engines.ship.*。
function mockGateway() {
  const HEAD = 'abc1234def5678abc1234def5678abc1234def56';
  const css = 'diff --git a/src/login.css b/src/login.css\n--- a/src/login.css\n+++ b/src/login.css\n@@ -1,3 +1,4 @@\n .login-button {\n-  background: #888;\n+  background: #2F6FEB;\n+  color: #fff;\n }\n';
  const js = 'diff --git a/src/login.js b/src/login.js\n--- a/src/login.js\n+++ b/src/login.js\n@@ -10,2 +10,5 @@\n export function mount(root) {\n+  const button = root.querySelector(".login-button");\n+  button.setAttribute("aria-label", "登录");\n+  return button;\n }\n';
  const changes = [{file: '/proj/src/login.css', additions: 2, deletions: 1, edits: 1, counted: true}, {file: '/proj/src/login.js', additions: 3, deletions: 0, edits: 1, counted: true}];
  const summary = {
    thread: {id: 't1', title: '登录按钮改成蓝色', engine: 'claudeAgent', engineName: 'Claude Code', model: 'haiku', level: 'full-access', plan: false, branch: 'feat/login-button', worktree: null, archived: false},
    status: 'done', activeRunId: null, runId: 'r1', runStartedAt: '2026-11-27T10:00:00Z', runCompletedAt: '2026-11-27T10:00:42Z', pending: [], changes,
    items: [
      {id: 'i1', kind: 'you', text: '把登录按钮改成蓝色，再给它加一个读屏名字'},
      {id: 'i2', kind: 'edit', status: 'completed', file: '/proj/src/login.css', additions: 2, deletions: 1, diff: css},
      {id: 'i3', kind: 'edit', status: 'completed', file: '/proj/src/login.js', additions: 3, deletions: 0, diff: js},
      {id: 'i4', kind: 'reply', text: '改好了：按钮底色换成蓝色、字换成白色；`mount` 里给按钮加了「登录」这个读屏名字。'},
    ],
  };
  const pref = {engine: 'claudeAgent', model: 'haiku', level: 'full-access', threadId: 't1', folder: '/proj'};
  const engines = [{id: 'claudeAgent', driver: 'claudeAgent', name: 'Claude Code', state: 'ready', text: '', enabled: true, installed: true, signedIn: true, upstream: 'own',
    quota: {state: 'unknown'}, models: [{slug: 'haiku', name: 'Haiku 5.5', isDefault: true}], setup: {canInstall: false, canAuthenticate: false},
    guide: {install: '', login: '', loginHint: '', link: '', note: '', managedInstall: false, managedSignin: false}}];
  const base = {ready: true, why: '', folder: '/proj', busy: false, branch: 'feat/login-button', head: HEAD, remote: true, pr: null};
  const dirty = {...base, files: [{status: 'M', file: 'src/login.css'}, {status: 'M', file: 'src/login.js'}],
    canCommit: true, commitWhy: '', commitToken: 'commit@0123456789abcdef', canPr: false, prWhy: '还有没提交的改动，先提交。', prToken: ''};
  const clean = {...base, head: 'f00dfeed1234f00dfeed1234f00dfeed1234f00d', files: [],
    canCommit: false, commitWhy: '没有要提交的改动。', commitToken: '', canPr: true, prWhy: '', prToken: 'pr@feat/login-button@f00dfeed1234f00dfeed1234f00dfeed1234f00d'};
  let committed = false;
  window.__laolaoToast = () => {};
  window.__shipShotsRpc = [];
  window.__laolaoSidebar = {gwRequest: async (method, params) => {
    window.__shipShotsRpc.push(method);
    if (method === 'pinkie.engines.session') return {sessionKey: params.sessionKey, pref, summary, error: '', service: {running: true}};
    if (method === 'pinkie.engines.catalog') return {enabled: true, running: true, source: 'live', levels: [], engines};
    if (method === 'pinkie.engines.diff') return {source: 'engine', diff: css + js, changes};
    if (method === 'pinkie.engines.ship.status') return committed ? clean : dirty;
    if (method === 'pinkie.engines.ship.commit') { committed = true; return {committed: true, head: clean.head, files: 2, summary: ''}; }
    if (method === 'pinkie.engines.ship.openPr') return {opened: true, url: 'https://example.test/me/proj/pull/9', branch: 'feat/login-button', head: clean.head, draft: true};
    return {};
  }};
}

const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';
const channel = process.env.PINKIE_UI_CHANNEL;
const browser = await playwright()[engine].launch({headless: true, ...(engine === 'chromium' && channel ? {channel} : {})});
const lines = [];
const report = [];
const ORIGIN = 'http://127.0.0.1:30134';
try {
  for (const width of [1440, 820]) for (const night of [false, true]) {
    const height = 900, tag = `${width}-${night ? 'night' : 'day'}`;
    const ctx = await browser.newContext({viewport: {width, height}, colorScheme: night ? 'dark' : 'light', locale: 'zh-CN'});
    const tab = await ctx.newPage();
    const errors = [];
    tab.on('pageerror', (error) => errors.push(error.message));
    try {
      await tab.route(ORIGIN + '/**', (route) => route.fulfill({contentType: 'text/html', body: page(night)}));
      await tab.goto(ORIGIN + '/chat?session=agent%3Ametre%3Ashots-l34');
      await tab.evaluate(mockGateway);
      await tab.addScriptTag({content: domWatch});
      await tab.addScriptTag({content: engineJs});
      await tab.addScriptTag({content: shipJs});
      const shot = async (state) => {
        await tab.mouse.move(0, 0);
        await tab.waitForTimeout(300);
        const name = `l34-${state}-${tag}`, file = name + '.png';
        const buf = await tab.screenshot({path: path.join(out, file)});
        lines.push({name, file, os: process.platform, browser: engine, width, height, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
      };
      const bar = tab.locator('.pk-eng-drawer .pk-ship');
      const button = (label) => bar.locator('button', {hasText: label}).first();
      await tab.locator('.pk-eng-chip--changes').first().click({timeout: 15_000});
      await button('提交…').waitFor({timeout: 15_000});
      await tab.locator('.pk-eng-drawer .pk-eng-diff__l--add').first().waitFor({timeout: 15_000});
      await shot('ship-drawer');
      await button('提交…').click();
      await bar.locator('.pk-ship__ask textarea').fill('登录按钮改成蓝色，加读屏名字');
      await shot('ship-commit');
      await button('确认提交').click();
      await tab.waitForFunction(() => {
        const b = [...document.querySelectorAll('.pk-ship button')].find((n) => n.textContent === '开 PR…');
        return Boolean(b && !b.disabled);
      }, null, {timeout: 15_000});
      await shot('ship-clean');
      await button('开 PR…').click();
      await bar.locator('.pk-ship__ask input[type="text"]').fill('登录按钮改成蓝色');
      await bar.locator('.pk-ship__ask textarea').fill('按钮底色换成蓝色，加了读屏名字。');
      await shot('ship-pr');
      const rpc = await tab.evaluate(() => window.__shipShotsRpc.filter((m) => m.startsWith('pinkie.engines.ship.')));
      report.push({tag, rpc, errors});
      if (rpc.includes('pinkie.engines.ship.openPr')) throw new Error('拍图时不该真的开 PR');
    } finally {
      await ctx.close();
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report-l34.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
}
console.log(`pr-shots L34: ${lines.length} 张 → ${out}`);
if (lines.length !== 16) { console.error('expected 16 shots'); process.exit(1); }
