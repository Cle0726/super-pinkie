#!/usr/bin/env node
// #393 实页证据（协调者 05:36Z）：嵌套路由下打开模型菜单 / 学习页，图片实际加载、没有对应 404。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + shots.jsonl；另写 report.json。
// 做法：真页面先正常打开（/chat?session=…），再整页重载到 /chat/?…（session 参数保留）。路由器会把更深的
// /chat/a/b 改回 /chat，但保留 /chat/：这里 ./laolao-* 会解析成 /chat/laolao-*（404），是真的嵌套基准。
// 重载后所有注入都在这个基准下第一次解析图片，再打开模型菜单 / 让学习页画题卡。每格记：
//   - 这一格里所有 laolao-* 请求的 URL 和状态码（page 'response'）
//   - 真页面 harness 记的 4xx（failedRequests）里有没有 laolao-*
//   - 对照：同一嵌套路径下 ./laolao-*（旧写法）fetch 应是 404、/laolao-*（新写法）应是 200——证明这条路由真会把相对路径带歪
//   - 学习页：.laolao-learning-stage__art 的 currentSrc / complete / naturalWidth
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const WIDTH = 1440, HEIGHT = 800;
const NESTED = '/chat/';

// 学习页：只假 pinkie.learning.current，让 learning-stage 画一张单选题卡（其余请求照走 fake gateway）
const learningInit = () => {
  const activity = {id: 'pr393-quiz-1', kind: 'single_choice', title: '#393 路径自检', topic: '非谓语动词',
    question: 'This museum is well worth ______.', options: ['to visit', 'visiting', 'visited', 'be visited'], phase: 'asking'};
  const wrap = () => {
    const sidebar = window.__laolaoSidebar;
    if (!sidebar || typeof sidebar.gwRequest !== 'function' || sidebar.gwRequest.__pr393) return false;
    const real = sidebar.gwRequest.bind(sidebar);
    const fake = (method, params, timeout) => (method === 'pinkie.learning.current'
      ? Promise.resolve({ok: true, enabled: true, revision: 7, sessionKey: params?.sessionKey || '', current: activity, history: []})
      : real(method, params, timeout));
    fake.__pr393 = true;
    sidebar.gwRequest = fake;
    return true;
  };
  const timer = setInterval(() => { if (wrap()) clearInterval(timer); }, 50);
};

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];

const shot = async (page, name) => {
  const file = `${name}.png`;
  const buf = await page.screenshot({path: path.join(out, file)});
  lines.push({name, file, os: process.platform, browser: engine || 'chromium', width: WIDTH, height: HEIGHT,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};

// 整页重载到嵌套基准（session 参数保留）；context 上的 initScript（冻结时钟、假学习题）重载后照样生效
const goNested = async (page) => {
  const target = await page.evaluate((nested) => `${nested}${location.search}`, NESTED);
  await page.goto(`${server.origin}${target}`, {waitUntil: 'load', timeout: 60_000});
  await page.waitForFunction(() => !document.getElementById('laolao-splash'), {timeout: 30_000});
  await page.waitForFunction(() => Boolean(document.querySelector('.agent-chat__input'))
    && Boolean(document.querySelector('#laolao-session-manager')), {timeout: 15_000});
  await page.waitForTimeout(500);
  return page.evaluate(() => location.pathname);
};

const control = (page, names) => page.evaluate(async (list) => {
  const res = [];
  for (const n of list) {
    const rel = new URL(`./${n}`, location.href).href, abs = new URL(`/${n}`, location.href).href;
    const st = async (u) => { try { return (await fetch(u, {cache: 'no-store'})).status; } catch (e) { return String(e); } };
    res.push({name: n, relative: rel.replace(location.origin, ''), relativeStatus: await st(rel), absolute: abs.replace(location.origin, ''), absoluteStatus: await st(abs)});
  }
  return res;
}, names);

async function cell(kind, scene, theme) {
  const name = `${kind}-${theme}-${WIDTH}`;
  const row = {name, kind, scene, theme, steps: []};
  const opened = await H.openRealScenePage(browser, server.origin, scene, theme, kind === 'learning' ? {initScript: learningInit} : {});
  const {context, page, pageErrors, failedRequests} = opened;
  const assetHits = [];
  page.on('response', (res) => {
    const u = new URL(res.url());
    if (/\/laolao-[^/]*\.png$/.test(u.pathname)) assetHits.push({path: u.pathname, status: res.status()});
  });
  try {
    await page.setViewportSize({width: WIDTH, height: HEIGHT});
    row.route = await goNested(page);
    if (kind === 'picker') {
      const trigger = 'details.chat-controls__model > summary, details.chat-controls__model-picker > summary';
      await page.click(trigger, {timeout: 10_000}).catch((e) => row.steps.push({step: 'open-picker', error: e.message}));
      await H.waitModelPickerReady(page).catch((e) => row.steps.push({step: 'picker-ready', error: e.message}));
      // 框图在页面加载时就预取（重载后、开菜单前），所以这里不等新请求，只给背景层一点时间换上
      await page.waitForTimeout(400);
      row.picker = await page.evaluate(() => {
        const menu = document.querySelector('details[open] .chat-controls__inline-select-menu--combined');
        return menu ? {open: true, backgroundImage: (menu.style.backgroundImage || '').slice(0, 120)} : {open: false};
      });
      row.preControl = {hits: assetHits.length, failed: failedRequests.length};
      row.control = await control(page, ['laolao-reasoning-frame-medium.png']);
    } else {
      await page.waitForFunction(() => {
        const img = document.querySelector('.laolao-learning-stage__art');
        return Boolean(img && img.complete && img.naturalWidth > 0);
      }, {timeout: 12_000}).catch((e) => row.steps.push({step: 'learning-art', error: e.message}));
      row.learning = await page.evaluate(() => {
        const img = document.querySelector('.laolao-learning-stage__art');
        return img ? {src: img.getAttribute('src'), currentSrc: img.currentSrc.replace(location.origin, ''), complete: img.complete,
          natural: `${img.naturalWidth}x${img.naturalHeight}`, route: location.pathname} : {missing: true, route: location.pathname};
      });
      row.preControl = {hits: assetHits.length, failed: failedRequests.length};
      row.control = await control(page, ['laolao-learning-question.png']);
    }
    await shot(page, name);
  } finally {
    row.assetRequests = assetHits;
    // 对照 fetch 自己的 ./laolao-* 404 不算页面的：只看对照之前的请求
    const cut = row.preControl || {hits: assetHits.length, failed: failedRequests.length};
    row.asset404 = [...assetHits.slice(0, cut.hits).filter((h) => h.status >= 400).map((h) => `${h.status} ${h.path}`),
      ...failedRequests.slice(0, cut.failed).filter((f) => /laolao-[^ ]*\.png/.test(f))];
    row.pageErrors = pageErrors;
    const imgOk = kind === 'picker'
      ? assetHits.some((h) => /laolao-reasoning-frame-/.test(h.path) && h.status === 200 && !h.path.startsWith('/chat/'))
      : Boolean(row.learning && row.learning.complete && !String(row.learning.natural).startsWith('0') && row.learning.currentSrc === '/laolao-learning-question.png');
    const ctlOk = (row.control || []).every((c) => c.relativeStatus === 404 && c.absoluteStatus === 200);
    row.ok = row.route === NESTED && imgOk && ctlOk && row.asset404.length === 0;
    report.push(row);
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    await cell('picker', 'long-conversation', theme);
    await cell('learning', 'home-learning', theme);
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
for (const r of report) console.log(`${r.ok ? 'OK ' : 'BAD'} ${r.name} route=${r.route} 404=${r.asset404.length} control=${JSON.stringify((r.control || []).map((c) => [c.relativeStatus, c.absoluteStatus]))}${r.steps.length ? ' steps=' + JSON.stringify(r.steps) : ''}`);
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
