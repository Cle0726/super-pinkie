#!/usr/bin/env node
// #109 / #112「作品装成桌面应用」界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json（量到的颜色 / 尺寸）。
// 真页面（tests/visual/lib/real-harness.mjs），假原生桥 + 假 pinkie.apps.* / pinkie.artifacts.* 数据，不碰用户会话。
// 每格（1440 / 820 × 日夜）拍：
//   viewer-new        作品预览带「装到桌面」入口（没装过）
//   dialog            点入口后的安装对话框（#112 多联网 / 读文件勾选）
//   viewer-installed  装过的作品，入口显示「已装到桌面」
//   settings          设置「已装的应用」卡片（两行：打开 / 卸载）
//   uninstall-confirm 点第一行「卸载」后的确认框（没有确认框就在 report 记 noConfirm，不拍）
//   uninstall-after   确认后（或没有确认框时直接）的结果：行没了 + 提示
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
  const apps = [
    {id: 'w0123456789abcde', artifactId: 'a1b2', name: '单词小游戏', version: 2, latest: 3, network: [], files: false},
    {id: 'wfedcba987654321', artifactId: 'c3d4', name: '番茄计时器（专注版）', version: 5, latest: 5, network: ['https://api.weather.example'], files: true},
  ];
  const answers = {
    'pinkie.artifacts.get': {ok: true, item},
    'pinkie.artifacts.read': {ok: true, v: 3, size: 40, mime: 'text/plain', encoding: 'utf8', data: '<h1 style="font:24px system-ui">单词小游戏</h1>'},
    'pinkie.apps.forArtifact': {ok: true, app: null},
    'pinkie.apps.needs': {ok: true, version: 3, network: ['https://api.dictionary.example', 'https://cdn.fonts.example'], files: true},
    'pinkie.apps.list': {ok: true, apps},
    'pinkie.apps.remove': {ok: true},
  };
  window.pywebview = {api: {pinkieNative: async () => ({ok: true})}};
  const wrap = () => {
    const sidebar = window.__laolaoSidebar;
    if (!sidebar || typeof sidebar.gwRequest !== 'function' || sidebar.gwRequest.__apps) return false;
    const real = sidebar.gwRequest.bind(sidebar);
    const fake = (method, params, timeout) => (method in answers ? Promise.resolve(answers[method]) : real(method, params, timeout));
    fake.__apps = true;
    sidebar.gwRequest = fake;
    return true;
  };
  const timer = setInterval(() => { if (wrap()) clearInterval(timer); }, 50);
  window.__appsShotItem = item;
  window.__appsShotAnswers = answers;
  window.__appsShotApps = apps;
};

const measure = (page, selectors) => page.evaluate(list => list.map(sel => {
  const node = document.querySelector(sel);
  if (!node) return {sel, missing: true};
  const s = getComputedStyle(node), r = node.getBoundingClientRect();
  return {sel, text: (node.textContent || '').trim().slice(0, 60), color: s.color, background: s.backgroundColor, font: s.fontSize,
    w: Math.round(r.width), h: Math.round(r.height), overflowX: node.scrollWidth > node.clientWidth + 1};
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

async function viewer(theme, width, installedApp) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForFunction(() => window.__laolaoSidebar?.gwRequest?.__apps === true, {timeout: 15_000});
    const opened = await page.evaluate(async installedApp => {
      if (installedApp) window.__appsShotAnswers['pinkie.apps.forArtifact'] = {ok: true, app: window.__appsShotApps[0]};
      const open = window.PinkieArtifacts?.openViewer;
      if (typeof open !== 'function') return 'no-openViewer';
      await open(window.__appsShotItem.id);
      return 'ok';
    }, installedApp);
    await page.waitForSelector('.pk-apps-install', {timeout: 10_000}).catch(() => {});
    if (installedApp) await page.waitForFunction(() => document.querySelector('.pk-apps-install')?.textContent === '已装到桌面', {timeout: 5_000}).catch(() => {});
    await page.waitForTimeout(300);
    const name = installedApp ? 'viewer-installed' : 'viewer-new';
    await shot(page, name, theme, width);
    report.push({theme, width, step: name, opened, styles: await measure(page, ['.pk-apps-install', '.pinkie-art-view__actions'])});
    if (!installedApp) {
      await page.click('.pk-apps-install').catch(error => report.push({theme, width, step: 'click-install', error: error.message}));
      await page.waitForSelector('.pk-apps-dialog', {timeout: 10_000}).catch(() => {});
      await page.waitForTimeout(250);
      await shot(page, 'dialog', theme, width);
      report.push({theme, width, step: 'dialog', styles: await measure(page, ['.pk-apps-dialog', '.pk-apps-dialog__name', '.pk-apps-dialog__perm', '.pk-apps-dialog .laolao-modal__button', '.pk-apps-dialog .laolao-modal__button--primary'])});
    }
    report.push({theme, width, step: name + ' pageErrors', pageErrors});
  } finally {
    await context.close();
  }
}

async function settings(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'settings', theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForSelector('.pk-apps-card .pk-apps-row', {timeout: 10_000}).catch(() => {});
    await page.evaluate(() => document.querySelector('.pk-apps-card')?.scrollIntoView({block: 'center'}));
    await page.waitForTimeout(250);
    await shot(page, 'settings', theme, width);
    report.push({theme, width, step: 'settings', styles: await measure(page, ['.pk-apps-card', '.pk-apps-row', '.pk-apps-row__actions', '.pk-apps-row .pinkie-art-btn', '.pk-apps-row .pk-apps-uninstall'])});
    const rowsBefore = await page.locator('.pk-apps-card .pk-apps-row').count();
    await page.locator('.pk-apps-card .pk-apps-row').first().locator('.pk-apps-uninstall, .pinkie-art-btn--quiet').click()
      .catch(error => report.push({theme, width, step: 'click-uninstall', error: error.message}));
    // 确认框：认 .pinkie-art-confirm 遮罩里的 role=dialog 或 .laolao-modal（作品库 confirmBox 同款）。
    const confirm = await page.waitForSelector('.pinkie-art-confirm [role=dialog], .pinkie-art-confirm .laolao-modal', {timeout: 2_500}).catch(() => null);
    if (confirm) {
      await page.waitForTimeout(250);
      await shot(page, 'uninstall-confirm', theme, width);
      report.push({theme, width, step: 'uninstall-confirm', styles: await measure(page, ['.pinkie-art-confirm .laolao-modal', '.pinkie-art-confirm .laolao-modal__title', '.pinkie-art-confirm .pinkie-art-confirm__text', '.pinkie-art-confirm .laolao-modal__button--primary'])});
      await page.click('.pinkie-art-confirm .laolao-modal__button--primary').catch(error => report.push({theme, width, step: 'click-confirm', error: error.message}));
    } else {
      report.push({theme, width, step: 'uninstall-confirm', noConfirm: true});
    }
    await page.waitForFunction(n => document.querySelectorAll('.pk-apps-card .pk-apps-row').length < n, rowsBefore, {timeout: 5_000}).catch(() => {});
    await page.waitForTimeout(300);
    await shot(page, 'uninstall-after', theme, width);
    report.push({theme, width, step: 'uninstall-after', rowsBefore, rowsAfter: await page.locator('.pk-apps-card .pk-apps-row').count(), pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      await viewer(theme, width, false);
      await viewer(theme, width, true);
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
