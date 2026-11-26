#!/usr/bin/env node
// 共享皮肤主按钮白字对比度（协调者 20:53）截图，约定照 tools/pr-shots/minimal.mjs。
// 项目设置弹窗「保存」主按钮：碧琪项目模式（settings 场景）+ Metre（metre-board 场景）× 1440 / 820 × 日夜，共 8 张。
// report.json 记主按钮字色 / 底色（对比度在下载后算）。
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
  const answers = {
    'pinkie.project.settings.get': {ok: true, name: '单词小游戏', folder: 'C:/work/单词小游戏', instructions: '回答用中文，代码注释也写中文。', pinned: ['README.md']},
    'pinkie.project.settings.files': {ok: true, files: []},
  };
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
};

const measure = (page, selectors) => page.evaluate(list => list.map(sel => {
  const node = document.querySelector(sel);
  if (!node) return {sel, missing: true};
  const s = getComputedStyle(node), r = node.getBoundingClientRect();
  return {sel, text: (node.textContent || '').trim().slice(0, 40), color: s.color, background: s.backgroundColor,
    mode: document.documentElement.getAttribute('data-laolao-mode'), w: Math.round(r.width), h: Math.round(r.height)};
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

async function projectSettings(name, scene, theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, scene, theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForFunction(() => window.__laolaoSidebar?.gwRequest?.__skin === true, {timeout: 15_000});
    await page.evaluate(() => window.PinkieArtifacts?.openProjectSettings?.('单词小游戏', 'C:/work/单词小游戏'));
    await page.waitForSelector('.pinkie-project-settings .laolao-modal__button--primary', {timeout: 10_000})
      .catch(error => report.push({name, theme, width, step: 'open', error: error.message}));
    await page.waitForTimeout(250);
    await shot(page, name, theme, width);
    report.push({name, theme, width, step: 'project-settings', pageErrors,
      styles: await measure(page, ['.pinkie-project-settings', '.pinkie-project-settings .laolao-modal__button--primary'])});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      await projectSettings('project', 'settings', theme, width);
      await projectSettings('metre', 'metre-board', theme, width);
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
