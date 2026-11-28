// B57 复发防护（真页面）：Metre /cron 1440 下 laolao-memory.js 挂上「独立长期记忆」入口（.laolao-memory-entry）的那一帧，
// 底栏露出三个按钮，设置齿轮被挤到 149..179，压连接方灯（141..151）。CI 里 B22 那几次「偶发」红就是它
// （job 140168945282 night：设置 149..179、更多工具 181..213、记忆 215..245，onLamp ["设置"]）。
// 原因：入口由 laolao-memory.js 的 1200ms 轮询挂进 .sidebar-footer-bar，classic-shell 要等下一帧（rAF）才给它标
// data-laolao-footer-secondary、收进「更多工具」，中间那一帧入口是看得见的（本机干净 main 日夜各 4 次：挂上后露 10–20ms）。
// B22 只等 300ms，慢 runner 偶尔正好量在那一帧里。修法：classic-shell 激活时 .laolao-memory-entry 直接藏，不等标记。
// 这里确定地复现那一帧（不靠时机）：等已有入口收起后拿掉它，照 ensureEntry() 同步挂一个新的，在同一个任务里、下一帧之前量。
// 反例写在测试里：把藏规则里的 .laolao-memory-entry 去掉，入口必须重新露出来、设置压到方灯上。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

// 照 laolao-memory.js ensureEntry() 同步挂入口，然后立刻量（同一个任务里，classic-shell 的 rAF 还没跑）。
function remountAndRead() {
  document.querySelectorAll('.laolao-memory-entry').forEach((n) => n.remove());
  const host = document.querySelector('.sidebar-shell__footer .sidebar-footer-bar') || document.querySelector('.sidebar-shell__footer');
  if (!host) return null;
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.className = 'laolao-memory-entry';
  entry.title = '当前模式的独立长期记忆';
  entry.setAttribute('aria-label', '打开当前模式的独立长期记忆');
  host.append(entry);

  const side = document.querySelector('aside.sidebar');
  const lamp = side?.querySelector('.pinkie-connection-status');
  const box = (e) => { const r = e.getBoundingClientRect(); return {l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom)}; };
  const shown = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const lb = lamp && shown(lamp) ? box(lamp) : null;
  const items = [];
  for (const e of side?.querySelectorAll('.sidebar-shell__footer :is(button, a, [role="button"])') || []) {
    if (e.closest('.laolao-mode-switcher, .pinkie-connection-status') || !shown(e)) continue;
    items.push({id: e.getAttribute('aria-label') || e.id || e.title || e.className.split(' ')[0], ...box(e)});
  }
  const onLamp = lb ? items.filter((i) => i.l < lb.r && lb.l < i.r && i.t < lb.b && lb.t < i.b).map((i) => i.id) : [];
  return {
    memoryDisplay: getComputedStyle(entry).display,
    secondary: entry.dataset.laolaoFooterSecondary || null,
    shell: document.documentElement.getAttribute('data-laolao-classic-shell'),
    lamp: lb, items, onLamp,
  };
}

// 反例：把 classic-shell.css 藏规则里的 .laolao-memory-entry 去掉（回到只认 data-laolao-footer-secondary）。
function dropMemoryFromHideRule() {
  for (const sh of document.styleSheets) {
    if (!/laolao-classic-shell\.css/.test(sh.href || '')) continue;
    for (const r of sh.cssRules) {
      const sel = r.selectorText || '';
      if (!sel.includes('.laolao-memory-entry') || !sel.includes('data-laolao-footer-secondary')) continue;
      r.selectorText = sel.replace(/,\s*\.laolao-memory-entry/, '');
      return r.selectorText.includes('.laolao-memory-entry') ? -1 : 1;
    }
  }
  return 0;
}

test('B57 real page: in Metre /cron 1440 the memory entry is hidden in the very frame it mounts, so nothing in the footer sits on the lamp; without .laolao-memory-entry in the hide rule it shows again', async (t) => {
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const theme of ['day', 'night']) {
    const {context, page, meta} = await openRealScenePage(browser, server.origin, 'metre-board', theme);
    try {
      await page.setViewportSize({width: 1440, height: 900});
      // 页内切到 /cron，省掉第二次整页冷加载（同 tests/metre-a3-cron-night-card-real.test.mjs / metre-usage-missing-sessions-real）。
      // 没有 app-shell navigate 时退回 pushState + popstate，带上原来的 harnessSession / session 参数。
      await page.evaluate((sessionKey) => {
        const shell = document.querySelector('openclaw-app-shell');
        const nav = [shell, shell?.context].find((o) => typeof o?.navigate === 'function');
        if (nav) nav.navigate('cron');
        else { history.pushState({}, '', `/cron?harnessSession=active&session=${encodeURIComponent(sessionKey)}`); dispatchEvent(new PopStateEvent('popstate')); }
      }, meta.sessionKey);
      await page.waitForFunction(() => location.pathname === '/cron' && Boolean(document.querySelector('openclaw-cron-page')), null, {timeout: 30_000});
      await page.waitForFunction(() => document.documentElement.getAttribute('data-laolao-mode') === 'metre', null, {timeout: 30_000});
      await page.waitForSelector('aside.sidebar .sidebar-shell__footer .pinkie-connection-status', {timeout: 30_000});
      // 等 laolao-memory.js 挂上入口、classic-shell 把它收起一次，说明两边都跑起来了。
      await page.waitForFunction(() => document.querySelector('.laolao-memory-entry')?.dataset.laolaoFooterSecondary === '1', null, {timeout: 30_000});
      await page.waitForTimeout(300);

      const got = await page.evaluate(remountAndRead);
      const show = JSON.stringify(got);
      console.log(`ℹ ${theme}: ${show}`);
      assert.ok(got, `${theme}: 找不到底栏，挂不上记忆入口`);
      assert.ok(got.lamp, `${theme}: 没量到方灯 — ${show}`);
      assert.equal(got.shell, '1', `${theme}: classic-shell 没激活 — ${show}`);
      assert.equal(got.memoryDisplay, 'none', `${theme}: 记忆入口挂上那一帧露出来了 — ${show}`);
      assert.deepEqual(got.onLamp, [], `${theme}: 底栏有按钮压在方灯上 — ${show}`);

      if (theme === 'day') {
        const dropped = await page.evaluate(dropMemoryFromHideRule);
        assert.equal(dropped, 1, '没找到带 .laolao-memory-entry 的 classic-shell 藏规则（或去不掉）');
        const bad = await page.evaluate(remountAndRead);
        console.log(`ℹ day without .laolao-memory-entry in the hide rule: ${JSON.stringify(bad)}`);
        assert.notEqual(bad.memoryDisplay, 'none', '反例没生效：去掉后记忆入口挂上那一帧仍是 display none');
        assert.notDeepEqual(bad.onLamp, [], '反例没生效：去掉后底栏仍没有按钮压灯');
      }
    } finally {
      await context.close();
    }
  }
});
