// 真页面：Metre 下作品库「从作品库移除」确认框的标题跟正文用同一套无衬线字（协调者 00:56：#202 Metre 820 夜那张标题落到衬线）。
// 来源：laolao-metre-skin.css 给所有 Metre 弹层标题 font: 500 17px/1.3 var(--metre-serif) !important；
// 确认框（遮罩 .pinkie-art-confirm）在 laolao-artifacts.css 设 --pk-modal-title-font:var(--metre-sans)，标题改读它。
// 别的 Metre 弹层（项目设置）不设这个变量，标题照旧衬线——这里一起量，确认没改大。
// 反例写在测试里：把遮罩上的变量清掉（initial），标题必须掉回衬线。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const initScript = () => {
  const item = {id: 'a1b2', kind: 'html', title: '单词小游戏.html', path: 'C:/work/单词小游戏.html', mode: 'project', sessionKey: '',
    createdAt: 0, updatedAt: 0, exists: true, size: 2048, version: 3, total: 3,
    versions: [1, 2, 3].map(v => ({v, ts: 0, size: 2048, runId: '', source: 'tool', snapshot: true}))};
  const answers = {
    'pinkie.project.settings.get': {ok: true, name: '单词小游戏', folder: 'C:/work/单词小游戏', instructions: '', pinned: []},
    'pinkie.project.settings.files': {ok: true, files: []},
    'pinkie.artifacts.get': {ok: true, item},
    'pinkie.artifacts.read': {ok: true, v: 3, size: 40, mime: 'text/plain', encoding: 'utf8', data: '<h1>单词小游戏</h1>'},
    'pinkie.apps.forArtifact': {ok: true, app: null},
    'pinkie.apps.list': {ok: true, apps: []},
  };
  window.pywebview = {api: {pinkieNative: async () => ({ok: true})}};
  const wrap = () => {
    const sidebar = window.__laolaoSidebar;
    if (!sidebar || typeof sidebar.gwRequest !== 'function' || sidebar.gwRequest.__titleFont) return false;
    const real = sidebar.gwRequest.bind(sidebar);
    const fake = (method, params, timeout) => (method in answers ? Promise.resolve(answers[method]) : real(method, params, timeout));
    fake.__titleFont = true;
    sidebar.gwRequest = fake;
    return true;
  };
  const timer = setInterval(() => { if (wrap()) clearInterval(timer); }, 50);
  window.__titleFontItem = item;
};

const isSerif = family => /^\s*"?Georgia/i.test(family);

function readFonts(scope) {
  const q = sel => document.querySelector(sel);
  const title = q(`${scope} .laolao-modal__title`);
  const text = q(`${scope} :is(.pinkie-art-confirm__text,.laolao-modal__body,p)`);
  const sans = (() => { const i = document.createElement('i'); i.style.fontFamily = 'var(--metre-sans)'; document.body.append(i); const f = getComputedStyle(i).fontFamily; i.remove(); return f; })();
  return {mode: document.documentElement.getAttribute('data-laolao-mode'), sans,
    title: title && getComputedStyle(title).fontFamily, titleText: title?.textContent.trim().slice(0, 30),
    text: text && getComputedStyle(text).fontFamily, size: title && getComputedStyle(title).fontSize, weight: title && getComputedStyle(title).fontWeight};
}

test('Metre 作品库移除确认框标题用正文无衬线字（日 / 夜），项目设置标题仍衬线；清掉变量会掉回衬线', async (t) => {
  let installed, server, browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();
  for (const theme of ['day', 'night']) {
    const {context, page} = await openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
    try {
      await page.setViewportSize({width: 820, height: 800});
      await page.waitForFunction(() => window.__laolaoSidebar?.gwRequest?.__titleFont === true, {timeout: 15_000});
      // ① 作品库移除确认框
      await page.evaluate(() => window.PinkieArtifacts.openViewer(window.__titleFontItem.id));
      await page.locator('button', {hasText: '从作品库移除'}).first().click({timeout: 10_000});
      await page.waitForSelector('.pinkie-art-confirm .laolao-modal__title', {timeout: 10_000});
      const got = await page.evaluate(readFonts, '.pinkie-art-confirm');
      console.log(`ℹ ${theme} confirm: ${JSON.stringify(got)}`);
      assert.equal(got.mode, 'metre', `${theme}: 不在 Metre`);
      assert.match(got.titleText, /从作品库移除/);
      assert.ok(!isSerif(got.title), `${theme}: 确认框标题还是衬线：${got.title}`);
      assert.equal(got.title, got.sans, `${theme}: 标题不是 --metre-sans`);
      assert.equal(got.title, got.text, `${theme}: 标题和正文字体不一样`);
      assert.equal(got.size, '17px', `${theme}: 标题字号别动`);
      assert.equal(got.weight, '500', `${theme}: 标题字重别动`);
      // 反例：清掉遮罩上的变量，标题必须掉回衬线（证明是这条变量在起作用，不是别的规则碰巧盖住）。
      const back = await page.evaluate(() => {
        const mask = document.querySelector('.pinkie-art-confirm');
        mask.style.setProperty('--pk-modal-title-font', 'initial');
        const f = getComputedStyle(mask.querySelector('.laolao-modal__title')).fontFamily;
        mask.style.removeProperty('--pk-modal-title-font');
        return {cleared: f, restored: getComputedStyle(mask.querySelector('.laolao-modal__title')).fontFamily};
      });
      console.log(`ℹ ${theme} counterexample: ${JSON.stringify(back)}`);
      assert.ok(isSerif(back.cleared), `${theme}: 反例没生效：清掉变量后标题不是衬线：${back.cleared}`);
      assert.equal(back.restored, got.title, `${theme}: 撤掉反例后标题没回到无衬线`);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.pinkie-art-confirm', {state: 'detached', timeout: 5_000});
      // ② 项目设置弹层：不在确认框遮罩里，Metre 标题照旧衬线（范围没改大）。
      await page.evaluate(() => window.PinkieArtifacts.openProjectSettings('单词小游戏', 'C:/work/单词小游戏'));
      await page.waitForSelector('.pinkie-project-settings .laolao-modal__title', {timeout: 10_000});
      const ps = await page.evaluate(readFonts, '.pinkie-project-settings');
      console.log(`ℹ ${theme} project-settings: ${JSON.stringify(ps)}`);
      assert.ok(isSerif(ps.title), `${theme}: 项目设置标题不该变：${ps.title}`);
    } finally {
      await context.close();
    }
  }
});
