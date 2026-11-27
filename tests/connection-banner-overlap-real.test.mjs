// B9：断线时原生 <openclaw-connection-banner> 胶囊是 position: fixed，聊天页上盖住顶部 callout 原文的头几行；
// 日间胶囊底是半透明的 --bg-elevated，底下的红字透出来和状态叠在一起，看着就是「原文截断」。
// 修法在 laolao-theme.css：聊天页横幅回文档流（.content--chat > openclaw-connection-banner > .connection-banner），胶囊底改不透明 --popover。
// 这里在真实安装的 Control UI + 碧琪注入上，让原生应用自己渲染横幅（gatewayConnected = false），聊天区顶部放一条长错误 callout，
// 820 / 1440 × 日 / 夜量：胶囊和 callout 不相交、胶囊底不透明。反例：删掉两条新规则，至少一处又盖住，日间底又变半透明。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const LONG_ERR = "Error: ENOENT: no such file or directory, open '/Users/me/Library/Application Support/SuperPinkie/workspaces/project-2026-11/attachments/very-long-attachment-name-quarterly-report-final-v3.xlsx' (errno -2)";
const LONG_STATE = 'WebSocket closed with code 1006 (abnormal closure) while reconnecting to ws://127.0.0.1:19999/ws, retrying in 8s';
const RULES = ['.content--chat > openclaw-connection-banner > .connection-banner', '.connection-banner .connection-banner__pill'];

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

test('B9 real page: on chat, the disconnected banner pill no longer covers the top callout and has an opaque background at 820 / 1440, day and night; removing the rules brings the overlap back', async (t) => {
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  const bad = [];
  for (const width of [820, 1440]) {
    for (const theme of ['day', 'night']) {
      const tag = `${width}-${theme}`;
      const {context, page} = await openRealScenePage(browser, server.origin, 'long-conversation', theme);
      try {
        await page.setViewportSize({width, height: 900});
        assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-laolao-watchdog-state')), null, `${tag}: watchdog 提示在，原生横幅会被藏掉，量不到`);
        const missing = await showBanner(page);
        assert.equal(missing, null, `${tag}: 页面上没有 ${missing}`);
        await page.waitForTimeout(400);
        const got = await page.evaluate(measure);
        console.log(`ℹ ${tag}: ${JSON.stringify(got)}`);
        assert.equal(got.overlap, 0, `${tag}: 横幅胶囊盖住了 callout — ${JSON.stringify(got)}`);
        assert.ok(got.alpha >= 0.99, `${tag}: 胶囊底半透明 ${got.bg}`);

        const removed = await page.evaluate((frags) => {
          let n = 0;
          for (const sh of document.styleSheets) {
            let rules; try { rules = sh.cssRules; } catch { continue; }
            for (let i = rules.length - 1; i >= 0; i--) if (frags.includes(rules[i].selectorText)) { sh.deleteRule(i); n++; }
          }
          return n;
        }, RULES);
        assert.equal(removed, 2, `${tag} 反例：页面上没找到那两条新规则（找到 ${removed} 条）`);
        await page.waitForTimeout(300);
        const after = await page.evaluate(measure);
        console.log(`ℹ ${tag} without the rules: ${JSON.stringify(after)}`);
        bad.push({tag, ...after});
      } finally {
        await context.close();
      }
    }
  }
  assert.ok(bad.some((b) => b.overlap > 0), `反例没生效：删掉规则后胶囊都不盖 callout — ${JSON.stringify(bad)}`);
  assert.ok(bad.filter((b) => b.tag.endsWith('-day')).every((b) => b.alpha < 0.99), `反例没生效：删掉规则后日间胶囊底仍不透明 — ${JSON.stringify(bad)}`);
});
