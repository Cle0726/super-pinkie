// G3a 复发防护（真页面）：原生技能页（/skills，openclaw-skills-page）在 Metre 里穿 Metre 皮肤、说中文。
// 11-25 真页面核实（mui3\核实-真页面-1125.md）：从「更多工具」→「技能」进去，卡片是所有模式共用的
// laolao-theme.css 给 .card 铺的粉边（rgba(217, 89, 143, .2) !important），选中的筛选键是原生 .agent-tab.active 的紫，
// 页面文字（All / Ready / Needs Setup / Disabled、Filter installed skills、Installed skills and their status.…）是打包里写死的英文。
// 这里在真实安装的 OpenClaw Control UI + 碧琪注入上进 /skills，读计算后的颜色和页面文字，日夜各一遍。
// 反例写在测试里：从页面上删掉 laolao-metre-skin.css 里带 openclaw-skills-page 的规则，颜色必须变回粉 / 紫；
// 关掉 Metre 的措辞替换（离开 Metre 时走的同一个 detach），英文必须原样回来。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const ENGLISH = ['Needs Setup', 'Installed skills and their status.', 'Search and install skills from the registry'];
const CHINESE = ['全部', '可用', '待设置', '已停用', '已装的技能和状态。', '从技能库搜索并安装'];

// 在页面里读：卡片边框、选中筛选键的字色 / 底色 / 边框，以及同一处 Metre 变量算出来的颜色。
function readSkills() {
  const pageEl = document.querySelector('openclaw-skills-page');
  if (!pageEl) return null;
  const card = pageEl.querySelector('.card');
  const tab = pageEl.querySelector('.agent-tab.active');
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;border:1px solid var(--metre-line);background:var(--metre-hover);color:var(--metre-text);outline:1px solid var(--metre-line-strong)';
  pageEl.append(probe);
  const ps = getComputedStyle(probe);
  const want = {line: ps.borderTopColor, hover: ps.backgroundColor, text: ps.color, strong: ps.outlineColor};
  probe.remove();
  const cs = card && getComputedStyle(card);
  const ts = tab && getComputedStyle(tab);
  const filter = pageEl.querySelector('input[name="skills-filter"]');
  return {
    want,
    card: cs && {border: cs.borderTopColor, shadow: cs.boxShadow},
    tab: ts && {text: ts.color, bg: ts.backgroundColor, border: ts.borderTopColor, label: tab.textContent.trim()},
    placeholder: filter?.getAttribute('placeholder') || '',
    text: pageEl.innerText,
  };
}

const PINK = /rgba\(217, 89, 143/;

test('G3a real page: in Metre the native skills page drops the pink / purple and speaks Chinese; without the overrides it goes back', async (t) => {
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const theme of ['day', 'night']) {
    const {context, page, meta} = await openRealScenePage(browser, server.origin, 'metre-board', theme);
    try {
      await page.goto(`${server.origin}/skills?harnessSession=active&session=${encodeURIComponent(meta.sessionKey)}`, {waitUntil: 'load', timeout: 60_000});
      await page.waitForFunction(() => document.documentElement.getAttribute('data-laolao-mode') === 'metre', null, {timeout: 30_000});
      await page.waitForSelector('openclaw-skills-page .agent-tab.active', {timeout: 30_000});
      await page.waitForFunction(() => /待设置/.test(document.querySelector('openclaw-skills-page')?.innerText || ''), null, {timeout: 10_000}).catch(() => {});
      const got = await page.evaluate(readSkills);
      assert.ok(got?.card && got.tab, `${theme}: 技能页没渲染出卡片或选中的筛选键`);
      const show = JSON.stringify({card: got.card, tab: got.tab, want: got.want});
      console.log(`ℹ ${theme}: ${show}`);

      // 皮肤
      assert.equal(got.card.border, got.want.line, `${theme}: 卡片边框不是 Metre 线色 — ${show}`);
      assert.doesNotMatch(got.card.border, PINK, `${theme}: 卡片还是粉边`);
      assert.equal(got.card.shadow, 'none', `${theme}: 卡片还带粉色投影 — ${show}`);
      assert.equal(got.tab.text, got.want.text, `${theme}: 选中筛选键的字不是正文色 — ${show}`);
      assert.equal(got.tab.bg, got.want.hover, `${theme}: 选中筛选键的底不是 Metre 悬停色 — ${show}`);
      assert.equal(got.tab.border, got.want.strong, `${theme}: 选中筛选键的边不是 Metre 深线色 — ${show}`);

      // 文字
      for (const s of CHINESE) assert.ok(got.text.includes(s), `${theme}: 技能页里没有「${s}」 — ${got.text.slice(0, 300)}`);
      for (const s of ENGLISH) assert.ok(!got.text.includes(s), `${theme}: 技能页里还有英文「${s}」`);
      assert.match(got.text, /\d+\s*个/, `${theme}: 「N shown」没换成「N 个」`);
      assert.equal(got.placeholder, '筛选已装的技能');
      assert.match(got.tab.label, /^全部/);

      if (theme === 'day') {
        // 反例一：删掉本 PR 给技能页加的两条 Metre 规则（只删选择器里带 openclaw-skills-page 的规则），颜色必须回到粉 / 紫。
        const removed = await page.evaluate(() => {
          let n = 0;
          for (const sh of document.styleSheets) {
            if (!/laolao-metre-skin\.css/.test(sh.href || '')) continue;
            for (let i = sh.cssRules.length - 1; i >= 0; i--) {
              if ((sh.cssRules[i].selectorText || '').includes('openclaw-skills-page')) { sh.deleteRule(i); n++; }
            }
          }
          return n;
        });
        assert.equal(removed, 2, '没找到技能页的两条 Metre 规则');
        const bad = await page.evaluate(readSkills);
        console.log(`ℹ day without overrides: ${JSON.stringify({card: bad.card, tab: bad.tab})}`);
        assert.match(bad.card.border, PINK, '反例没生效：删掉规则后卡片不是粉边');
        assert.notEqual(bad.tab.text, bad.want.text, '反例没生效：删掉规则后选中筛选键的字仍是正文色');

        // 反例二：关掉 Metre 的措辞替换（离开 Metre 时走的就是它），英文原样回来，说明中文确实是这里换的、离开时能还原。
        await page.evaluate(() => window.__pinkieMetreWords.detach());
        const back = await page.evaluate(readSkills);
        for (const s of ENGLISH) assert.ok(back.text.includes(s), `detach 后没还原「${s}」`);
        assert.equal(back.placeholder, 'Filter installed skills');
        assert.match(back.tab.label, /^All/);
      }
    } finally {
      await context.close();
    }
  }
});
