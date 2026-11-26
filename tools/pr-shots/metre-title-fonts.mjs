#!/usr/bin/env node
// Metre 弹层标题衬线字体栈（协调者 01:12）：标题「从作品库移除「单词小游戏.html」？」里中文和拉丁字母是不是落到两种不同的衬线字体。
// 约定照 tools/pr-shots/minimal.mjs。1440 / 820 × 日 / 夜，Metre（metre-board 场景）三个弹层：
//   confirm   作品库「从作品库移除」确认框
//   project   项目设置
//   install   装到桌面
// report.json 记标题 font-family 计算值 + Chromium 实际用来画字的字体（CDP CSS.getPlatformFontsForNode，按字体分字形数），
// 另外单独量标题里的中文段 / 拉丁段（拆成两个 span 的探针，不改页面上的标题）。
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

const initScript = () => {
  const item = {id: 'a1b2', kind: 'html', title: '单词小游戏.html', path: 'C:/work/单词小游戏.html', mode: 'project', sessionKey: '',
    createdAt: 0, updatedAt: 0, exists: true, size: 2048, version: 3, total: 3,
    versions: [1, 2, 3].map(v => ({v, ts: 0, size: 2048, runId: '', source: 'tool', snapshot: true}))};
  const answers = {
    'pinkie.project.settings.get': {ok: true, name: '单词小游戏', folder: 'C:/work/单词小游戏', instructions: '', pinned: []},
    'pinkie.project.settings.files': {ok: true, files: []},
    'pinkie.artifacts.get': {ok: true, item},
    'pinkie.artifacts.read': {ok: true, v: 3, size: 40, mime: 'text/plain', encoding: 'utf8', data: '<h1 style="font:24px system-ui">单词小游戏</h1>'},
    'pinkie.apps.forArtifact': {ok: true, app: null},
    'pinkie.apps.list': {ok: true, apps: []},
  };
  window.pywebview = {api: {pinkieNative: async () => ({ok: true})}};
  const wrap = () => {
    const sidebar = window.__laolaoSidebar;
    if (!sidebar || typeof sidebar.gwRequest !== 'function' || sidebar.gwRequest.__fonts) return false;
    const real = sidebar.gwRequest.bind(sidebar);
    const fake = (method, params, timeout) => (method in answers ? Promise.resolve(answers[method]) : real(method, params, timeout));
    fake.__fonts = true;
    sidebar.gwRequest = fake;
    return true;
  };
  const timer = setInterval(() => { if (wrap()) clearInterval(timer); }, 50);
  window.__fontsItem = item;
};

const HEIGHT = 800;
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];
const shot = async (page, name, theme, width) => {
  const file = `${name}-${theme}-${width}.png`;
  const buf = await page.screenshot({path: path.join(out, file)});
  lines.push({name: `${name}-${theme}-${width}`, file, os: process.platform, browser: engine || 'chromium', width, height: HEIGHT,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};

// 用 CDP 问 Chromium：这个节点里的字实际是哪些字体画的（每个字体画了几个字形）。
async function platformFonts(page, selector) {
  let cdp;
  try {
    cdp = await page.context().newCDPSession(page);
  } catch (error) {
    return {error: `no CDP: ${error.message}`};
  }
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const {root} = await cdp.send('DOM.getDocument', {depth: -1});
    const {nodeIds} = await cdp.send('DOM.querySelectorAll', {nodeId: root.nodeId, selector});
    const outList = [];
    for (const nodeId of nodeIds) {
      const {node} = await cdp.send('DOM.describeNode', {nodeId, depth: 1});
      // 字体按「文本节点」报：标题 h3 的文字在它的子文本节点上，两个都问一遍。
      const ids = [nodeId];
      for (const child of node.children || []) if (child.nodeType === 3 && child.backendNodeId) {
        const pushed = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', {backendNodeIds: [child.backendNodeId]}).catch(() => null);
        if (pushed?.nodeIds?.[0]) ids.push(pushed.nodeIds[0]);
      }
      const fonts = [];
      for (const id of ids) {
        const r = await cdp.send('CSS.getPlatformFontsForNode', {nodeId: id}).catch(error => ({error: error.message}));
        if (r.fonts) fonts.push(...r.fonts);
      }
      outList.push(fonts);
    }
    return {nodes: outList};
  } finally {
    await cdp.detach().catch(() => {});
  }
}

// 在弹层里放两个探针 span（中文段 / 拉丁段，跟标题同一套计算样式），分开量各自落到哪个字体。
async function probeSegments(page, scope) {
  await page.evaluate(scopeSel => {
    const title = document.querySelector(`${scopeSel} .laolao-modal__title`);
    if (!title) return;
    for (const [cls, text] of [['pk-font-probe-cjk', '从作品库移除单词小游戏'], ['pk-font-probe-latin', '.html Metre Aa']]) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      span.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap';
      title.append(span);
    }
  }, scope);
  const cjk = await platformFonts(page, `${scope} .pk-font-probe-cjk`);
  const latin = await platformFonts(page, `${scope} .pk-font-probe-latin`);
  await page.evaluate(() => document.querySelectorAll('.pk-font-probe-cjk,.pk-font-probe-latin').forEach(n => n.remove()));
  return {cjk, latin};
}

const computed = (page, sel) => page.evaluate(s => {
  const n = document.querySelector(s);
  if (!n) return {sel: s, missing: true};
  const c = getComputedStyle(n);
  return {sel: s, text: n.textContent.trim().slice(0, 40), family: c.fontFamily, size: c.fontSize, weight: c.fontWeight,
    mode: document.documentElement.getAttribute('data-laolao-mode'), night: document.documentElement.hasAttribute('data-pinkie-night')};
}, sel);

async function dialog(name, theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
  const scope = {confirm: '.pinkie-art-confirm', project: '.pinkie-project-settings', install: '.pk-apps-dialog'}[name];
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForFunction(() => window.__laolaoSidebar?.gwRequest?.__fonts === true, {timeout: 15_000})
      .catch(error => report.push({name, theme, width, step: 'wrap', error: error.message}));
    if (name === 'project') {
      await page.evaluate(() => window.PinkieArtifacts?.openProjectSettings?.('单词小游戏', 'C:/work/单词小游戏'));
    } else {
      await page.evaluate(() => window.PinkieArtifacts?.openViewer?.(window.__fontsItem.id));
      const label = name === 'confirm' ? '从作品库移除' : '装到桌面';
      await page.locator('button', {hasText: label}).first().click({timeout: 10_000})
        .catch(error => report.push({name, theme, width, step: 'click', error: error.message}));
    }
    await page.waitForSelector(`${scope} .laolao-modal__title`, {timeout: 10_000})
      .catch(error => report.push({name, theme, width, step: 'open', error: error.message}));
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(300);
    await shot(page, `${name}-metre`, theme, width);
    const title = await computed(page, `${scope} .laolao-modal__title`);
    const rendered = await platformFonts(page, `${scope} .laolao-modal__title`);
    const segments = await probeSegments(page, scope);
    report.push({name, theme, width, step: 'fonts', pageErrors, title, rendered, segments});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      for (const name of ['confirm', 'project', 'install']) await dialog(name, theme, width);
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map(l => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
