#!/usr/bin/env node
// #163（协调者 22:00 四项）截图，约定照 tools/pr-shots/minimal.mjs。1440 / 820 × 日夜，每格：
//   project / metre  项目设置弹窗（碧琪项目模式 / Metre）：「保存」主按钮字 ≥ 4.5、按钮圆角
//   confirm          作品库「从作品库移除」确认框（碧琪项目模式）：主按钮字、按钮圆角
//   settings         设置页（碧琪项目模式）：侧栏模式切换箭头（不再是「⌟」）+「第三方许可」说明行数
// report.json 记颜色、圆角、箭头 transform、说明栏行数（对比度在下载后算）。
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
    'pinkie.project.settings.get': {ok: true, name: '单词小游戏', folder: 'C:/work/单词小游戏', instructions: '回答用中文，代码注释也写中文。', pinned: ['README.md']},
    'pinkie.project.settings.files': {ok: true, files: []},
    'pinkie.artifacts.get': {ok: true, item},
    'pinkie.artifacts.read': {ok: true, v: 3, size: 40, mime: 'text/plain', encoding: 'utf8', data: '<h1 style="font:24px system-ui">单词小游戏</h1>'},
    'pinkie.apps.forArtifact': {ok: true, app: null},
    'pinkie.apps.list': {ok: true, apps: []},
  };
  window.pywebview = {api: {pinkieNative: async () => ({ok: true})}};
  const wrap = () => {
    const sidebar = window.__laolaoSidebar;
    if (!sidebar || typeof sidebar.gwRequest !== 'function' || sidebar.gwRequest.__skin) return false;
    const real = sidebar.gwRequest.bind(sidebar);
    const fake = (method, params, timeout) => (method in answers ? Promise.resolve(answers[method]) : real(method, params, timeout));
    fake.__skin = true;
    sidebar.gwRequest = fake;
    return true;
  };
  const timer = setInterval(() => { if (wrap()) clearInterval(timer); }, 50);
  window.__skinShotItem = item;
};

const measure = (page, selectors) => page.evaluate(list => list.map(sel => {
  const node = document.querySelector(sel);
  if (!node) return {sel, missing: true};
  const s = getComputedStyle(node), r = node.getBoundingClientRect();
  const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.4;
  return {sel, text: (node.textContent || '').trim().slice(0, 40), color: s.color, background: s.backgroundColor, radius: s.borderTopLeftRadius,
    transform: s.transform, display: s.display, mode: document.documentElement.getAttribute('data-laolao-mode'),
    w: Math.round(r.width), h: Math.round(r.height), lines: Math.round(r.height / lh)};
}), selectors);

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
const open = async (scene, theme, width) => {
  const opened = await H.openRealScenePage(browser, server.origin, scene, theme, {initScript});
  await opened.page.setViewportSize({width, height: HEIGHT});
  await opened.page.waitForFunction(() => window.__laolaoSidebar?.gwRequest?.__skin === true, {timeout: 15_000});
  return opened;
};

async function projectSettings(name, scene, theme, width) {
  const {context, page, pageErrors} = await open(scene, theme, width);
  try {
    await page.evaluate(() => window.PinkieArtifacts?.openProjectSettings?.('单词小游戏', 'C:/work/单词小游戏'));
    await page.waitForSelector('.pinkie-project-settings .laolao-modal__button--primary', {timeout: 10_000})
      .catch(error => report.push({name, theme, width, step: 'open', error: error.message}));
    await page.waitForTimeout(250);
    await shot(page, name, theme, width);
    report.push({name, theme, width, step: 'project-settings', pageErrors, styles: await measure(page, ['.pinkie-project-settings',
      '.pinkie-project-settings .laolao-modal__button--primary', '.pinkie-project-settings .laolao-modal__button:not(.laolao-modal__button--primary)'])});
  } finally {
    await context.close();
  }
}

async function confirmRemove(theme, width) {
  const {context, page, pageErrors} = await open('settings', theme, width);
  try {
    await page.evaluate(() => window.PinkieArtifacts?.openViewer?.(window.__skinShotItem.id));
    const remove = page.locator('button', {hasText: '从作品库移除'}).first();
    await remove.click({timeout: 10_000}).catch(error => report.push({name: 'confirm', theme, width, step: 'click-remove', error: error.message}));
    await page.waitForSelector('.pinkie-art-confirm .laolao-modal__button--primary', {timeout: 10_000})
      .catch(error => report.push({name: 'confirm', theme, width, step: 'confirm-open', error: error.message}));
    await page.waitForTimeout(250);
    await shot(page, 'confirm', theme, width);
    report.push({name: 'confirm', theme, width, step: 'confirm', pageErrors, styles: await measure(page, ['.pinkie-art-confirm .laolao-modal',
      '.pinkie-art-confirm .laolao-modal__button--primary', '.pinkie-art-confirm .laolao-modal__button:not(.laolao-modal__button--primary)'])});
  } finally {
    await context.close();
  }
}

async function settings(theme, width) {
  const {context, page, pageErrors} = await open('settings', theme, width);
  try {
    await page.waitForSelector('.pinkie-user-settings__notices .pinkie-user-settings__row', {timeout: 10_000})
      .catch(error => report.push({name: 'settings', theme, width, step: 'notices', error: error.message}));
    await page.evaluate(() => document.querySelector('.pinkie-user-settings__notices')?.scrollIntoView({block: 'center'}));
    await page.waitForTimeout(250);
    await shot(page, 'settings', theme, width);
    report.push({name: 'settings', theme, width, step: 'settings', pageErrors, styles: await measure(page, ['.laolao-mode-switcher .laolao-mode-button__arrow',
      '.pinkie-user-settings__notices .pinkie-user-settings__hint', '.pinkie-user-settings__notices .pinkie-user-settings__row'])});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      await projectSettings('project', 'settings', theme, width);
      await projectSettings('metre', 'metre-board', theme, width);
      await confirmRemove(theme, width);
      await settings(theme, width);
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
