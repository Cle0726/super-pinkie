#!/usr/bin/env node
// #127 的 PR 截图脚本（照 tools/pr-shots/minimal.mjs 的约定：node <脚本> --out <目录>，写 PNG + 追加 <目录>/shots.jsonl）。
// 拍引擎菜单模型子菜单最底下「用谁的模型」那一行：菜单本身、Claude Code 的模型列表（「改用碧琪模型」）、
// 点进去后「Claude Code · 碧琪模型」的模型列表（「改回我自己的账号」）、Antigravity 的模型列表（灰掉的那一行和原因），
// 1440 / 820 × 日 / 夜，共 16 张。拍之前鼠标挪开，拍的是不悬停的样子。
// 页面照 tests/metre-engine-upstream-ui.test.mjs 搭：真的 Metre 皮肤和引擎样式、真的引擎和上游脚本，网关是假的（只在页面里回目录），
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
const upstreamJs = read('laolao-metre-engine-upstream.js');

const page = (night) => `<!doctype html><html data-laolao-mode="metre"${night ? ' data-pinkie-night' : ''} lang="zh-CN"><head>
<style>${skin}</style><style>${css}</style>
<style>body{margin:0}.chat-main{position:relative;width:100vw;height:100vh;display:flex;flex-direction:column;justify-content:flex-end}</style></head><body>
<div class="chat-main"><div class="chat-thread" style="flex:1"></div>
<div class="agent-chat__composer-controls" style="display:flex;gap:4px;padding:12px"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;

function mockGateway() {
  const row = (id, driver, name, extra = {}) => ({id, driver, name, state: 'ready', text: '', enabled: true, installed: true, signedIn: true, upstream: 'own',
    quota: {state: 'unknown'}, models: [{slug: id + '/m1', name: name + ' Model', isDefault: true}], setup: {canInstall: false, canAuthenticate: false},
    guide: {install: '', login: '', loginHint: '', link: '', note: '', managedInstall: false, managedSignin: false}, ...extra});
  const engines = [
    row('claudeAgent', 'claudeAgent', 'Claude Code', {switchable: {to: 'claudeAgent-pinkie'}}),
    row('claudeAgent-pinkie', 'claudeAgent', 'Claude Code · 碧琪模型', {upstream: 'pinkie', switchable: {to: 'claudeAgent-pinkie'}, models: [{slug: 'pinkie/gw/top', name: 'Top', isDefault: true}]}),
    row('antigravity', 'antigravity', 'Antigravity', {switchable: {why: '只能用 Google 账号或 Gemini 的 API 密钥，没有换上游的口子'}}),
    row('kiro', 'kiro', 'Kiro'),
  ];
  window.__laolaoToast = () => {};
  window.__laolaoSidebar = {gwRequest: async (method, params) => {
    if (method === 'pinkie.engines.session') return {sessionKey: params.sessionKey, pref: {engine: 'metre'}, summary: null, error: '', service: {running: true}};
    if (method === 'pinkie.engines.catalog') return {enabled: true, running: true, source: 'live', levels: [], engines};
    if (method === 'pinkie.engines.choose') return {sessionKey: params.sessionKey, pref: {engine: params.engine, model: params.model}, summary: null, error: '', service: {running: true}};
    return {};
  }};
}

const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';
const channel = process.env.PINKIE_UI_CHANNEL;
const browser = await playwright()[engine].launch({headless: true, ...(engine === 'chromium' && channel ? {channel} : {})});
const lines = [];
const ORIGIN = 'http://127.0.0.1:30117';
try {
  for (const width of [1440, 820]) for (const night of [false, true]) {
    const height = 900, tag = `${width}-${night ? 'night' : 'day'}`;
    const ctx = await browser.newContext({viewport: {width, height}, colorScheme: night ? 'dark' : 'light', locale: 'zh-CN'});
    const tab = await ctx.newPage();
    try {
      await tab.route(ORIGIN + '/**', (route) => route.fulfill({contentType: 'text/html', body: page(night)}));
      await tab.goto(ORIGIN + '/chat?session=agent%3Ametre%3Ashots127');
      await tab.evaluate(mockGateway);
      await tab.addScriptTag({content: js});
      await tab.addScriptTag({content: upstreamJs});
      const chip = tab.locator('.agent-chat__composer-controls > .pk-eng-chip').first();
      await chip.waitFor({timeout: 15_000});
      const shot = async (state) => {
        await tab.mouse.move(0, 0);
        await tab.waitForTimeout(300);
        const name = `127-${state}-${tag}`, file = name + '.png';
        const buf = await tab.screenshot({path: path.join(out, file)});
        lines.push({name, file, os: process.platform, browser: engine, width, height, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
      };
      await chip.click();
      await tab.locator('.pk-eng-menu__group').first().waitFor({timeout: 15_000});
      await shot('menu');
      await tab.locator('.pk-eng-menu__item').filter({has: tab.locator('.pk-eng-menu__name', {hasText: /^Claude Code$/})}).first().click();
      await tab.locator('.pk-eng-menu__back').waitFor({timeout: 15_000});
      await tab.locator('.pk-eng-menu__item--upstream').first().waitFor({timeout: 15_000});
      await shot('claude');
      await tab.locator('.pk-eng-menu__item--upstream').first().click();
      await tab.locator('.pk-eng-menu__sub', {hasText: '碧琪模型'}).waitFor({timeout: 15_000});
      await shot('pinkie');
      await tab.locator('.pk-eng-menu__back').first().click();
      await tab.locator('.pk-eng-menu__group').first().waitFor({timeout: 15_000});
      await tab.locator('.pk-eng-menu__item').filter({has: tab.locator('.pk-eng-menu__name', {hasText: /^Antigravity$/})}).first().click();
      await tab.locator('.pk-eng-menu__item--upstream.pk-eng-menu__item--dim').waitFor({timeout: 15_000});
      await shot('grey');
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots #127: ${lines.length} 张 → ${out}`);
if (lines.length !== 16) { console.error('expected 16 shots'); process.exit(1); }
