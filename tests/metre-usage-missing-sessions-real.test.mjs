// 协调者 11-27 10:18（B85 走查发现）：网关回的 sessions.usage 缺 sessions 时，原生用量页 render 读
// this.usageResult?.sessions.length（可选链只护到 usageResult）报 TypeError reading 'length'，页面一直停在「加载中」。
// 修法在 ui/injections/laolao-metre-usage.js 的 guardUsagePage：原生 willUpdate 之后把缺的 sessions 补成 []，页面走它自己的空状态。
// 这里在真实安装的 OpenClaw Control UI + 碧琪注入上打开 /usage；隔离假网关对 sessions.usage / usage.cost 本来就回 {}，正好是缺字段的样子。
// 反例：页面载入前先占住 Pinkie.metreUsage，laolao-metre-usage.js 直接返回、不装护栏——必须报那个 TypeError、停在「加载中」。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const withoutGuard = () => {
  const ns = (window.Pinkie = window.Pinkie || {});
  ns.metreUsage = Object.freeze({counterExample: true});
};

let ctx = null;
async function setup() {
  if (ctx) return ctx;
  let browser;
  try { browser = await launchRealBrowser(); } catch (error) { return {skip: `没有可用浏览器：${String(error?.message || error).slice(0, 120)}`}; }
  const installed = installRealControlUi({repoRoot: REPO_ROOT});
  const server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  ctx = {browser, installed, server};
  return ctx;
}

test.after(async () => {
  if (!ctx) return;
  await ctx.browser.close().catch(() => {});
  await ctx.server.close().catch(() => {});
  ctx.installed.cleanup();
});

async function openUsage(t, initScript) {
  const c = await setup();
  if (c.skip) { t.skip(c.skip); return null; }
  const {context, page, pageErrors} = await openRealScenePage(c.browser, c.server.origin, 'metre-board', 'day', initScript ? {initScript} : {});
  try {
    await page.evaluate(() => {
      const shell = document.querySelector('openclaw-app-shell');
      const nav = [shell, shell?.context].find((o) => typeof o?.navigate === 'function');
      if (nav) nav.navigate('usage');
      else { history.pushState({}, '', '/usage'); dispatchEvent(new PopStateEvent('popstate')); }
    });
    await page.waitForSelector('openclaw-usage-page', {timeout: 15_000});
    await page.waitForTimeout(2500);
    const state = await page.evaluate(() => {
      const el = document.querySelector('openclaw-usage-page');
      return {
        path: location.pathname,
        loading: Boolean(el?.usageLoading),
        sessionsIsArray: Array.isArray(el?.usageResult?.sessions),
        hasResult: Boolean(el?.usageResult),
        text: (el?.textContent || '').replace(/\s+/g, ' ').slice(0, 400),
      };
    });
    return {state, errors: pageErrors.map((e) => String(e?.message || e))};
  } finally {
    await context.close();
  }
}

const lengthError = (errors) => errors.filter((e) => /reading 'length'/.test(e));

test('网关回的 sessions.usage 缺 sessions：用量页不报错，走原生空状态（从日期范围开始）', async (t) => {
  const r = await openUsage(t, null);
  if (!r) return;
  t.diagnostic(JSON.stringify(r));
  assert.equal(r.state.path, '/usage');
  assert.deepEqual(lengthError(r.errors), [], '不该再报 TypeError reading length');
  assert.ok(r.state.hasResult && r.state.sessionsIsArray, '缺的 sessions 应补成 []');
  assert.match(r.state.text, /从日期范围开始|无数据/, '应显示原生空状态');
});

test('反例：不装护栏（Pinkie.metreUsage 先被占住）时，同样的回包让用量页报 TypeError reading length', async (t) => {
  const r = await openUsage(t, withoutGuard);
  if (!r) return;
  t.diagnostic(JSON.stringify(r));
  assert.equal(r.state.path, '/usage');
  assert.ok(lengthError(r.errors).length > 0, `反例应报 TypeError reading length：${JSON.stringify(r.errors).slice(0, 300)}`);
  assert.equal(r.state.sessionsIsArray, false, '反例里 sessions 不该被补');
});
