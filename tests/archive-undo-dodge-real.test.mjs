// B11 复发防护（真页面，默认 WebKit）：非 Metre 归档撤销条「已归档 · 撤销」。
// ① 「撤销」字色对撤销条底色 ≥ 4.5:1（项目日间旧值 3.66）；② 撤销条不压输入框外壳里的任何按钮 / 工具栏 / 输入框（旧值 bottom:32px，1440 宽压在工具栏上）。
// 覆盖：项目（sidebar-expanded）、无限（home-unrestricted）× 日夜 × 1440 / 820；820 下侧栏是抽屉，先展开。
// 触发：侧栏会话行聚焦后按 Delete（真走 archiveWithUndo），夹具网关对 sessions.patch / lineage 回 {}，不改真数据。
// 反例：把页面拿到的 laolao-sidebar.css / .js 换回改前写法再 reload，同一套量法必须量出日间不合格、1440 相交。
// 每个 (mode, theme) 只开一次页：同页依次量 1440 / 820 正例，再挂 routeOld + reload 量 1440 / 820 反例（真页面加载 8 次）。
// reload 会重跑 openRealScenePage 的 init 脚本（清 localStorage）并重新拉夹具会话列表，所以反例拿到的是一张干净的页。
import assert from 'node:assert/strict';
import test from 'node:test';
import {REPO_ROOT, installRealControlUi, launchRealBrowser, openRealScenePage, startRealUiServer} from './visual/lib/real-harness.mjs';
import {SCENES, archiveOneRow, measureUndo, openDrawer, routeOld} from './visual/lib/archive-undo-probe.mjs';
import {playwright} from '../tools/study-desk/harness.mjs';

const WIDTHS = [1440, 820];
const TEXT_MIN = 4.5;
const ENGINE = process.env.PINKIE_VISUAL_ENGINE || 'webkit';

// 只等会动到量值的过渡：落在撤销条 / 输入框外壳 / 侧栏本身、其祖先或子孙上的。CI 上换宽后偶有过渡 5s 还在 running
// （#96 7231513547，量值却都合格），那时打出卡住的元素和属性、finish 掉再量；量得对不对仍由下面的原有断言判。
const RELEVANT = ['.pinkie-archive-undo', '.agent-chat__composer-shell', 'aside.sidebar'];
const runningTransitions = (sels) => {
  const keys = sels.flatMap((s) => [...document.querySelectorAll(s)]);
  return document.getAnimations().filter((a) => a instanceof CSSTransition && a.playState === 'running').map((a) => {
    const el = a.effect?.target;
    const near = Boolean(el && keys.some((k) => k === el || k.contains(el) || el.contains(k)));
    const cls = el && typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return {near, el: el ? el.tagName.toLowerCase() + cls : null, prop: a.transitionProperty};
  });
};
const QUIET = `(${runningTransitions})(${JSON.stringify(RELEVANT)}).every((r) => !r.near)`;
async function settle(page, label) {
  if (await page.waitForFunction(QUIET, null, {timeout: 5000}).then(() => true, () => false)) return;
  console.log(`ℹ ${label}: 5s 后过渡仍在跑，finish 后再量 ${JSON.stringify(await page.evaluate(runningTransitions, RELEVANT))}`);
  await page.evaluate(() => document.getAnimations().forEach((a) => { if (a instanceof CSSTransition && a.playState === 'running') a.finish(); }));
  if (await page.waitForFunction(QUIET, null, {timeout: 2000}).then(() => true, () => false)) return;
  console.log(`ℹ ${label}: finish 后过渡又起来了 ${JSON.stringify(await page.evaluate(runningTransitions, RELEVANT))}`);
}
const fmt = (m) => `${m.mode}${m.night ? '/夜' : '/日'} 撤销 ${m.ratio}:1 bar=${JSON.stringify(m.bar)} shell=${JSON.stringify(m.shell)} 压到=${JSON.stringify(m.hits)} bottom=${m.inlineBottom || '(css)'}`;

// 上一宽度的撤销条要先拿掉，否则 archiveOneRow 的 waitForSelector 会直接认旧条。
async function measureAt(page, width, label) {
  await page.evaluate(() => document.querySelectorAll('.pinkie-archive-undo').forEach((n) => n.remove()));
  await page.setViewportSize({width, height: 900});
  await page.waitForTimeout(400);
  await settle(page, `${label} 换宽`);
  await openDrawer(page);
  await archiveOneRow(page);
  await settle(page, `${label} 撤销条`);
  const m = await measureUndo(page);
  assert.ok(m, `${label}: 撤销条没出现`);
  return m;
}

test('B11 非 Metre 撤销条：「撤销」≥4.5 且不压输入框工具栏（项目/无限 × 日夜 × 1440/820）；换回旧写法必须量出不合格', {timeout: 360_000}, async (t) => {
  let pw;
  try { pw = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  try { browser = await launchRealBrowser(ENGINE, pw); }
  catch (err) { t.skip(`${ENGINE} is not installed: ${err.message.split('\n')[0]}`); return; }
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});

  const oldRows = [];
  for (const [mode, id] of Object.entries(SCENES)) {
    for (const theme of ['day', 'night']) {
      const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, id, theme, {timezoneId: 'Asia/Shanghai'});
      try {
        for (const width of WIDTHS) {
          const tag = `${mode}(${id}) ${theme} ${width}`;
          const m = await measureAt(page, width, tag);
          console.log(`ℹ ${tag}: ${fmt(m)}`);
          assert.equal(m.mode, mode, `${tag}: 模式不对`);
          assert.equal(m.night, theme === 'night', `${tag}: 日夜没切对`);
          assert.ok(m.shell && m.targets > 0, `${tag}: 没量到输入框外壳和里面的控件（量不到不能算通过）`);
          assert.ok(m.ratio >= TEXT_MIN, `${tag}: 「撤销」${m.ratio}:1 < ${TEXT_MIN}`);
          assert.equal(m.shellOverlap, 0, `${tag}: 撤销条压到输入框外壳 — ${fmt(m)}`);
          assert.deepEqual(m.hits, [], `${tag}: 撤销条压到控件 — ${fmt(m)}`);
          assert.ok(m.onScreen, `${tag}: 撤销条出了屏幕 — ${fmt(m)}`);
          assert.deepEqual([...pageErrors], [], `${tag}: 页面报错`);
        }

        const swapped = await routeOld(context);
        await page.reload();
        for (const width of WIDTHS) {
          const tag = `${mode}(${id}) ${theme} ${width}`;
          const m = await measureAt(page, width, `${tag} 旧写法`);
          console.log(`ℹ ${tag} 旧写法: ${fmt(m)} swapped=${JSON.stringify(swapped)}`);
          assert.ok(swapped.css >= 1 && swapped.js >= 1, `${tag}: 旧写法没换上 ${JSON.stringify(swapped)}`);
          oldRows.push({mode, theme, width, ...m});
        }
      } finally {
        await context.close();
      }
    }
  }
  const dayLow = oldRows.filter((r) => r.theme === 'day' && r.ratio < TEXT_MIN);
  assert.ok(dayLow.some((r) => r.mode === 'project'), `反例没生效：旧写法项目日间「撤销」应 <${TEXT_MIN} — ${oldRows.map(fmt).join('; ')}`);
  const wideHit = oldRows.filter((r) => r.width === 1440 && (r.hits.length > 0 || r.shellOverlap > 0));
  assert.ok(wideHit.length >= 1, `反例没生效：旧写法 1440 宽撤销条应压到输入框 — ${oldRows.filter((r) => r.width === 1440).map(fmt).join('; ')}`);
});
