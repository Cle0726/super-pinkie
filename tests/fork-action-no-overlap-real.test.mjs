// fork-btn-no-overlap 复发测试（#437 审图遗留，mac-coord #96，macdev5）。
// main 上「从这里分出去」键绝对定位在气泡右上角，悬停时压短回答正文（m6-checkpoint 量到 forkOverlapText=2236）。
// 修法：非 Metre 每组只在回答下方操作栏（.chat-group-footer-actions）挂一个键，对应组内最后一条可分叉气泡。
// 测法：真装的 Control UI，short / long-conversation × 1440 / 820 × 日 / 夜，非 Metre：
//   正向：每个页脚键悬停后可见、可点（中心点命中键本身）、overText = 0、气泡里不再有键；
//   反例：同页把键塞回对应气泡（main 的挂法），至少一组 overText > 0；
//   并且页面没有报错。
import assert from 'node:assert/strict';
import test from 'node:test';
import {REPO_ROOT, installRealControlUi, launchRealBrowser, startRealUiServer} from './visual/lib/real-harness.mjs';
import {hoverKeyGroup, measureKey, openScene} from './visual/lib/fork-action-overlap.mjs';

test('fork-btn-no-overlap：非 Metre 分叉键在回答下方操作栏、悬停不压正文；塞回气泡就压', {timeout: 300_000}, async (t) => {
  const installed = installRealControlUi({repoRoot: REPO_ROOT});
  let server = null;
  let browser = null;
  t.after(async () => {
    try { await browser?.close(); } catch {}
    try { await server?.close(); }
    finally { installed.cleanup(); }
  });
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  let worstOld = 0;
  for (const scene of ['short-conversation', 'long-conversation']) for (const theme of ['day', 'night']) for (const width of [1440, 820]) {
    const label = `${scene} ${theme} ${width}`;
    const {context, page, pageErrors} = await openScene(browser, server.origin, scene, theme, width);
    try {
      const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
      assert.notEqual(mode, 'metre', 'Metre 由 laolao-metre-skin.css 接管，这里要量非 Metre');
      const layout = await page.evaluate(() => ({
        inBubble: document.querySelectorAll('.chat-bubble > .pinkie-fork-action').length,
        groups: [...document.querySelectorAll('.chat-group.assistant .chat-group-footer')].map((f) => f.querySelectorAll('.pinkie-fork-action').length),
      }));
      assert.equal(layout.inBubble, 0, `${label} 非 Metre 气泡里不该再有分叉键`);
      assert.ok(layout.groups.some((n) => n === 1), `${label} 要有挂了键的回答页脚`);
      assert.ok(layout.groups.every((n) => n <= 1), `${label} 每组页脚最多一个键：${layout.groups}`);
      const count = layout.groups.filter((n) => n === 1).length;
      for (let i = 0; i < count; i += 1) {
        await hoverKeyGroup(page, i);
        const now = await page.evaluate(measureKey, {index: i});
        const old = await page.evaluate(measureKey, {index: i, asMain: true});
        t.diagnostic(`${label} #${i} ${now.messageId} 键 ${now.box} op=${now.opacity} overText=${now.overText}；塞回气泡 overText=${old.overText}`);
        assert.ok(now.bubbleFound, `${label} #${i} 键记的 messageId 找不到对应气泡`);
        assert.equal(Number(now.opacity), 1, `${label} #${i} 悬停后键要可见`);
        assert.equal(now.pointer, 'auto', `${label} #${i} 悬停后键要可点`);
        assert.ok(now.clickable, `${label} #${i} 键中心被别的元素挡住`);
        assert.equal(now.overText, 0, `${label} #${i} 键压正文 ${now.overText}`);
        worstOld = Math.max(worstOld, old.overText);
      }
      assert.deepEqual(pageErrors, [], `${label} 页面报错`);
    } finally {
      await context.close();
    }
  }
  assert.ok(worstOld > 0, `反例没生效：键塞回气泡（main 挂法）也没压到正文，最大 ${worstOld}`);
});
