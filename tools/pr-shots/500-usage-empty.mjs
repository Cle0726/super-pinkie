#!/usr/bin/env node
// #500 用量页空状态截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// uireview 11-27 18:34Z / 监工 10:41：在 #500 现头拍空状态——Metre 用量页（照 B85 #497 的格子：1440 × 日夜 × 1.25 / 1.5），
// 另加一张非 Metre（项目模式）1440 日间。看空状态的字和日期框日 / 夜读不读得清、和卡片骨架有没有冲突。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 不接 sessions.usage / usage.cost：隔离假网关本来就回 {}，正好是缺 sessions 的样子（#500 修的就是这个）。
// report.json 每张记：页面有没有出来、还在不在加载、sessions 是否补成了数组、有没有 TypeError reading 'length'、空状态那段字。
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
const WIDTH = 1440, HEIGHT = 900;

// [scene, theme, scale, how]：Metre 走侧栏「用量」入口（真点），项目模式没有这个入口，走原生路由。
const CELLS = [
  ['metre-board', 'day', 1.25, 'entry'], ['metre-board', 'night', 1.25, 'entry'],
  ['metre-board', 'day', 1.5, 'entry'], ['metre-board', 'night', 1.5, 'entry'],
  ['home-project', 'day', 1, 'route'],
];

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];

const waitFn = (page, fn, arg, ms = 15_000) => page.waitForFunction(fn, arg, {timeout: ms}).then(() => true, () => false);

async function openUsage(page, how) {
  await page.evaluate(() => window.__pinkieMetreBoard?.close?.()).catch(() => {});
  let clicked = false;
  if (how === 'entry') {
    const onScreen = () => { const e = document.querySelector('aside.sidebar .pk-metre-nav--usage'); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0; };
    if (!(await page.evaluate(onScreen))) await page.$('button[aria-label="展开侧边栏"]').then((b) => b?.click({timeout: 5000})).catch(() => {});
    if (await waitFn(page, onScreen, null, 5000)) { await page.click('aside.sidebar .pk-metre-nav--usage', {timeout: 5000}).catch(() => {}); clicked = true; }
  }
  if (!clicked) {
    await page.evaluate(() => {
      const shell = document.querySelector('openclaw-app-shell');
      const nav = [shell, shell?.context].find((o) => typeof o?.navigate === 'function');
      if (nav) nav.navigate('usage');
      else { history.pushState({}, '', '/usage'); dispatchEvent(new PopStateEvent('popstate')); }
    });
  }
  const shown = await waitFn(page, () => Boolean(document.querySelector('openclaw-usage-page')));
  const settled = await waitFn(page, () => { const el = document.querySelector('openclaw-usage-page'); return Boolean(el && !el.usageLoading && el.usageResult); });
  return {via: clicked ? 'entry' : 'route', shown, settled};
}

try {
  for (const [scene, theme, scale, how] of CELLS) {
    const tag = `${scene === 'metre-board' ? 'metre' : 'project'}-${theme}-x${String(scale).replace('.', '')}`;
    const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, scene, theme, {deviceScaleFactor: scale});
    try {
      await page.setViewportSize({width: WIDTH, height: HEIGHT});
      await page.waitForTimeout(800);
      let prepared = null, prepareError = null;
      try { prepared = await openUsage(page, how); } catch (e) { prepareError = String(e?.message || e).slice(0, 300); }
      await page.waitForTimeout(700);
      const state = await page.evaluate(() => {
        const el = document.querySelector('openclaw-usage-page');
        return {mode: document.documentElement.getAttribute('data-laolao-mode') || '', path: location.pathname, dpr: window.devicePixelRatio,
          loading: Boolean(el?.usageLoading), sessionsIsArray: Array.isArray(el?.usageResult?.sessions),
          text: (el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300)};
      });
      const errors = pageErrors.map((e) => String(e?.message || e).slice(0, 200));
      const lengthError = errors.some((e) => /reading 'length'/.test(e));
      const file = `500-usage-empty-${tag}.png`;
      const buf = await page.screenshot({path: path.join(out, file)});
      lines.push({name: `500-usage-empty-${tag}`, file, os: process.platform, browser: engine || 'chromium', width: WIDTH, height: HEIGHT, deviceScaleFactor: scale,
        bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
      report.push({tag, scene, theme, scale, prepared, prepareError, ...state, lengthError, pageErrors: errors});
      console.log(JSON.stringify({tag, mode: state.mode, dpr: state.dpr, prepared, loading: state.loading, sessionsIsArray: state.sessionsIsArray, lengthError}));
    } finally {
      await context.close();
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
