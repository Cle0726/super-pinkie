// B9：断线时原生 <openclaw-connection-banner> 胶囊是 position: fixed，聊天页上盖住顶部 callout 原文的头几行；
// 日间胶囊底是半透明的 --bg-elevated，底下的红字透出来和状态叠在一起，看着就是「原文截断」。
// 修法在 laolao-theme.css：聊天页横幅回文档流（.content--chat > openclaw-connection-banner > .connection-banner），胶囊底改不透明 --popover。
// 这里在真实安装的 Control UI + 碧琪注入上，让原生应用自己渲染横幅（gatewayConnected = false），聊天区顶部放一条长错误 callout，
// 820 / 1440 × 日 / 夜量：胶囊和 callout 不相交、胶囊底不透明。反例：删掉两条新规则，至少一处又盖住，日间底又变半透明。
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';
import {waitFirstFrame} from './helpers/browser-first-frame.mjs';

const LONG_ERR = "Error: ENOENT: no such file or directory, open '/Users/me/Library/Application Support/SuperPinkie/workspaces/project-2026-11/attachments/very-long-attachment-name-quarterly-report-final-v3.xlsx' (errno -2)";
const LONG_STATE = 'WebSocket closed with code 1006 (abnormal closure) while reconnecting to ws://127.0.0.1:19999/ws, retrying in 8s';
const RULES = ['.content--chat > openclaw-connection-banner > .connection-banner', '.connection-banner .connection-banner__pill'];

// #96（提速去抖动）：浏览器在 before() 里起一次，文件级共用，和 metre-backstage-sync.test.mjs 同一套做法；
// 这个文件目前只有一条测试，但把冷启动挪到测试计时之外，不受单条测试超时预算影响。
let browser = null, why = '';
before(async () => {
  try { browser = await launchRealBrowser(); }
  catch (error) { why = 'no browser: ' + error.message.split('\n')[0]; return; }
  await waitFirstFrame(browser, 'connection-banner-overlap-real');
}, {timeout: 120_000});
after(async () => { await browser?.close(); });

async function showBanner(page) {
  return page.evaluate(async ({LONG_ERR, LONG_STATE}) => {
    const pane = document.querySelector('openclaw-chat-pane');
    if (!pane) return 'openclaw-chat-pane';
    const box = document.createElement('div');
    box.className = 'callout danger';
    box.id = 'b9-callout';
    box.textContent = LONG_ERR;
    pane.prepend(box);
    // 横幅由 openclaw-app-shell 渲染；openclaw-app 也有 gatewayConnected，设它会换成登录门把 shell 整个替掉。
    const host = document.querySelector('openclaw-app-shell');
    if (!host || !('gatewayConnected' in host)) return 'openclaw-app-shell.gatewayConnected';
    host.gatewayLastError = LONG_STATE;
    host.gatewayConnected = false;
    await host.updateComplete;
    return document.querySelector('main.content--chat > openclaw-connection-banner .connection-banner__pill') ? null : '原生横幅';
  }, {LONG_ERR, LONG_STATE});
}

function measure() {
  const pill = document.querySelector('openclaw-connection-banner .connection-banner__pill');
  const callout = document.querySelector('#b9-callout');
  const a = pill.getBoundingClientRect();
  const b = callout.getBoundingClientRect();
  const bg = getComputedStyle(pill).backgroundColor;
  const n = (bg.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
  const alpha = /^(rgba|color)\(/.test(bg) && n.length >= 4 ? n[3] : 1;
  const overlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) * Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  return {pill: [a.top, a.bottom, a.left, a.right].map(Math.round), callout: [b.top, b.bottom].map(Math.round), overlap: Math.round(overlap), alpha, bg};
}

// 原来固定等 400/300ms 再量；改成等条件：胶囊和 callout 的框、胶囊底色连续 3 帧读数不变（和 fork-action-overlap.mjs
// hoverKeyGroup 的 w.n/w.st 稳定计数同一个写法）。等不到（环境极端慢）就落到原逻辑，照旧往下量、交给断言判。
async function waitMeasureSettle(page) {
  await page.waitForFunction(() => {
    const pill = document.querySelector('openclaw-connection-banner .connection-banner__pill');
    const callout = document.querySelector('#b9-callout');
    if (!pill || !callout) return false;
    const a = pill.getBoundingClientRect();
    const b = callout.getBoundingClientRect();
    const sig = JSON.stringify([a.top, a.bottom, a.left, a.right, b.top, b.bottom, getComputedStyle(pill).backgroundColor].map((v) => (typeof v === 'number' ? Math.round(v) : v)));
    const w = window.__pkB9Settle || (window.__pkB9Settle = {sig: null, n: 0});
    w.n = w.sig === sig ? w.n + 1 : 0;
    w.sig = sig;
    if (w.n >= 3) { delete window.__pkB9Settle; return true; }
    return false;
  }, null, {polling: 'raf', timeout: 2_000}).catch(() => {});
}

test('B9 real page: on chat, the disconnected banner pill no longer covers the top callout and has an opaque background at 820 / 1440, day and night; removing the rules brings the overlap back', async (t) => {
  if (!browser) { t.skip(why || 'no browser'); return; }
  let installed; let server;
  t.after(async () => { await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});

  // B101（提速）：日夜在开页面时就定了，宽度是开页后才设的。所以一个主题只开一页：先在 820 / 1440 量正例，
  // 再删一次那两条规则、在 820 / 1440 量反例（删了就不用放回）。页面加载 4 → 2，断言一条没改。
  const bad = [];
  for (const theme of ['day', 'night']) {
    const {context, page} = await openRealScenePage(browser, server.origin, 'long-conversation', theme);
    try {
      for (const width of [820, 1440]) {
        const tag = `${width}-${theme}`;
        await page.setViewportSize({width, height: 900});
        assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-laolao-watchdog-state')), null, `${tag}: watchdog 提示在，原生横幅会被藏掉，量不到`);
        await page.evaluate(() => document.querySelectorAll('#b9-callout').forEach((n) => n.remove()));   // 同一页换宽度：先拿掉上一次插的 callout，和新开页面一样只有一条
        const missing = await showBanner(page);
        assert.equal(missing, null, `${tag}: 页面上没有 ${missing}`);
        await waitMeasureSettle(page);
        const got = await page.evaluate(measure);
        console.log(`ℹ ${tag}: ${JSON.stringify(got)}`);
        assert.equal(got.overlap, 0, `${tag}: 横幅胶囊盖住了 callout — ${JSON.stringify(got)}`);
        assert.ok(got.alpha >= 0.99, `${tag}: 胶囊底半透明 ${got.bg}`);
      }

      const removed = await page.evaluate((frags) => {
        let n = 0;
        for (const sh of document.styleSheets) {
          let rules; try { rules = sh.cssRules; } catch { continue; }
          for (let i = rules.length - 1; i >= 0; i--) if (frags.includes(rules[i].selectorText)) { sh.deleteRule(i); n++; }
        }
        return n;
      }, RULES);
      assert.equal(removed, 2, `${theme} 反例：页面上没找到那两条新规则（找到 ${removed} 条）`);
      for (const width of [820, 1440]) {
        const tag = `${width}-${theme}`;
        await page.setViewportSize({width, height: 900});
        await page.evaluate(() => document.querySelectorAll('#b9-callout').forEach((n) => n.remove()));   // 同一页换宽度：先拿掉上一次插的 callout，和新开页面一样只有一条
        const missing = await showBanner(page);
        assert.equal(missing, null, `${tag}: 页面上没有 ${missing}`);
        await waitMeasureSettle(page);
        const after = await page.evaluate(measure);
        console.log(`ℹ ${tag} without the rules: ${JSON.stringify(after)}`);
        bad.push({tag, ...after});
      }
    } finally {
      await context.close();
    }
  }
  assert.ok(bad.some((b) => b.overlap > 0), `反例没生效：删掉规则后胶囊都不盖 callout — ${JSON.stringify(bad)}`);
  assert.ok(bad.filter((b) => b.tag.endsWith('-day')).every((b) => b.alpha < 0.99), `反例没生效：删掉规则后日间胶囊底仍不透明 — ${JSON.stringify(bad)}`);
});
