// B11 复发防护（真页面，WebKit）：非 Metre 归档撤销条「已归档 · 撤销」。
// ① 「撤销」字色对撤销条底色 ≥ 4.5:1（项目日间旧值 3.66）；② 撤销条不压输入框外壳里的任何按钮 / 工具栏 / 输入框（旧值 bottom:32px，1440 宽压在工具栏上）。
// 覆盖：项目（sidebar-expanded）、无限（home-unrestricted）× 日夜 × 1440 / 820；820 下侧栏是抽屉，先展开。
// 触发：侧栏会话行聚焦后按 Delete（真走 archiveWithUndo），夹具网关对 sessions.patch / lineage 回 {}，不改真数据。
// 反例：把页面拿到的 laolao-sidebar.css / .js 换回改前写法再 reload，同一套量法必须量出日间不合格、1440 相交。
import assert from 'node:assert/strict';
import test from 'node:test';
import {REPO_ROOT, installRealControlUi, openRealScenePage, startRealUiServer} from './visual/lib/real-harness.mjs';
import {SCENES, archiveOneRow, measureUndo, openDrawer, routeOld} from './visual/lib/archive-undo-probe.mjs';
import {playwright} from '../tools/study-desk/harness.mjs';

const WIDTHS = [1440, 820];
const TEXT_MIN = 4.5;

const settle = (page) => page.waitForFunction(
  () => document.getAnimations().filter((a) => a instanceof CSSTransition).every((a) => a.playState !== 'running'),
  null, {timeout: 5000});
const fmt = (m) => `${m.mode}${m.night ? '/夜' : '/日'} 撤销 ${m.ratio}:1 bar=${JSON.stringify(m.bar)} shell=${JSON.stringify(m.shell)} 压到=${JSON.stringify(m.hits)} bottom=${m.inlineBottom || '(css)'}`;

async function cell(browser, origin, id, theme, width, old) {
  const {context, page, pageErrors} = await openRealScenePage(browser, origin, id, theme, {timezoneId: 'Asia/Shanghai'});
  try {
    let swapped = null;
    if (old) { swapped = await routeOld(context); await page.reload(); }
    await page.setViewportSize({width, height: 900});
    await page.waitForTimeout(400);
    await settle(page);
    await openDrawer(page);
    await archiveOneRow(page);
    await settle(page);
    const m = await measureUndo(page);
    assert.ok(m, `${id} ${theme} ${width}${old ? ' 旧写法' : ''}: 撤销条没出现`);
    return {m, swapped, pageErrors: [...pageErrors]};
  } finally {
    await context.close();
  }
}

test('B11 非 Metre 撤销条：「撤销」≥4.5 且不压输入框工具栏（项目/无限 × 日夜 × 1440/820）；换回旧写法必须量出不合格', {timeout: 360_000}, async (t) => {
  let pw;
  try { pw = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  try { browser = await pw.webkit.launch({headless: true}); }
  catch (err) { t.skip(`WebKit is not installed: ${err.message.split('\n')[0]}`); return; }
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});

  const oldRows = [];
  for (const [mode, id] of Object.entries(SCENES)) {
    for (const theme of ['day', 'night']) {
      for (const width of WIDTHS) {
        const tag = `${mode}(${id}) ${theme} ${width}`;
        const good = await cell(browser, server.origin, id, theme, width, false);
        console.log(`ℹ ${tag}: ${fmt(good.m)}`);
        assert.equal(good.m.mode, mode, `${tag}: 模式不对`);
        assert.equal(good.m.night, theme === 'night', `${tag}: 日夜没切对`);
        assert.ok(good.m.shell && good.m.targets > 0, `${tag}: 没量到输入框外壳和里面的控件（量不到不能算通过）`);
        assert.ok(good.m.ratio >= TEXT_MIN, `${tag}: 「撤销」${good.m.ratio}:1 < ${TEXT_MIN}`);
        assert.equal(good.m.shellOverlap, 0, `${tag}: 撤销条压到输入框外壳 — ${fmt(good.m)}`);
        assert.deepEqual(good.m.hits, [], `${tag}: 撤销条压到控件 — ${fmt(good.m)}`);
        assert.ok(good.m.onScreen, `${tag}: 撤销条出了屏幕 — ${fmt(good.m)}`);
        assert.deepEqual(good.pageErrors, [], `${tag}: 页面报错`);

        const bad = await cell(browser, server.origin, id, theme, width, true);
        console.log(`ℹ ${tag} 旧写法: ${fmt(bad.m)} swapped=${JSON.stringify(bad.swapped)}`);
        assert.ok(bad.swapped.css >= 1 && bad.swapped.js >= 1, `${tag}: 旧写法没换上 ${JSON.stringify(bad.swapped)}`);
        oldRows.push({mode, theme, width, ...bad.m});
      }
    }
  }
  const dayLow = oldRows.filter((r) => r.theme === 'day' && r.ratio < TEXT_MIN);
  assert.ok(dayLow.some((r) => r.mode === 'project'), `反例没生效：旧写法项目日间「撤销」应 <${TEXT_MIN} — ${oldRows.map(fmt).join('; ')}`);
  const wideHit = oldRows.filter((r) => r.width === 1440 && (r.hits.length > 0 || r.shellOverlap > 0));
  assert.ok(wideHit.length >= 1, `反例没生效：旧写法 1440 宽撤销条应压到输入框 — ${oldRows.filter((r) => r.width === 1440).map(fmt).join('; ')}`);
});
