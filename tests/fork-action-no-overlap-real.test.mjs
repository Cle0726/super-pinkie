// fork-btn-no-overlap 复发测试（#437 审图遗留，mac-coord #96，macdev5）。
// main 上「从这里分出去」键绝对定位在气泡右上角，悬停时压短回答正文（m6-checkpoint 量到 forkOverlapText=2236）。
// 修法：非 Metre 每组只在回答下方操作栏（.chat-group-footer-actions）挂一个键，对应组内最后一条可分叉气泡。
// 测法：真装的 Control UI，short-answers（long-conversation 灌一行短回答）/ long-conversation × 1440 / 820 × 日 / 夜，非 Metre：
//   正向：每个页脚键悬停后可见、可点（中心点命中键本身）、overText = 0、有页脚的组气泡里不再有键（工作过程步骤组无页脚，另案）；
//   反例：同页把键塞回对应气泡（main 的挂法），至少一组 overText > 0；
//   对比度：悬停后页脚键文字按截图像素量，日 / 夜都 ≥ 4.5；反例把 #477 初版 62% 稀释注回，日间最差那格必须 < 4.5；
//   并且页面没有报错。
import assert from 'node:assert/strict';
import test from 'node:test';
import {REPO_ROOT, installRealControlUi, launchRealBrowser, startRealUiServer} from './visual/lib/real-harness.mjs';
import {SCENES, hoverKeyGroup, measureKey, measureKeyContrast, openScene, revertKeyColor, useWidth} from './visual/lib/fork-action-overlap.mjs';
import {playwright} from '../tools/study-desk/harness.mjs';

test('fork-btn-no-overlap：非 Metre 分叉键在回答下方操作栏、悬停不压正文；塞回气泡就压', {timeout: 420_000}, async (t) => {
  const installed = installRealControlUi({repoRoot: REPO_ROOT});
  let server = null;
  let browser = null;
  t.after(async () => {
    try { await browser?.close(); } catch {}
    try { await server?.close(); }
    finally { installed.cleanup(); }
  });
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = process.env.PINKIE_VISUAL_ENGINE === 'webkit'
    ? await playwright().webkit.launch({headless: true})
    : await launchRealBrowser();

  let worstOld = 0;
  const old62 = [];
  // B34：每个场景 × 主题只开一页，1440 → 820 在同一页里换宽度量（开页本来就是 1280 再改宽，见 useWidth），8 次开页省成 4 次。
  // 页面报错按宽度分开记：换宽度时记下已有条数，每个宽度只看自己那段。
  for (const scene of SCENES) for (const theme of ['day', 'night']) {
    const {context, page, pageErrors} = await openScene(browser, server.origin, scene, theme, 1440);
    try {
      for (const width of [1440, 820]) {
        const label = `${scene} ${theme} ${width}`;
        const errorsBefore = pageErrors.length;
        if (width !== 1440) await useWidth(page, width);
        const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
        assert.notEqual(mode, 'metre', 'Metre 由 laolao-metre-skin.css 接管，这里要量非 Metre');
        // 工作过程步骤组（.chat-group--timeline-step）没有页脚，键仍留在气泡里，另案处理；这里只管有页脚的回答组。
        const layout = await page.evaluate(() => ({
          inBubble: [...document.querySelectorAll('.chat-bubble > .pinkie-fork-action')].filter((k) => !k.closest('.chat-group--timeline-step')).length,
          groups: [...document.querySelectorAll('.chat-group.assistant .chat-group-footer')].map((f) => f.querySelectorAll('.pinkie-fork-action').length),
        }));
        assert.equal(layout.inBubble, 0, `${label} 非 Metre 有页脚的回答组气泡里不该再有分叉键`);
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
          const ct = await measureKeyContrast(page, i);
          t.diagnostic(`${label} #${i} 键文字 ${JSON.stringify(ct)}`);
          assert.ok(ct.textPx?.ratio >= 4.5, `${label} #${i} 页脚键文字对比度 ${ct.textPx?.ratio} ≥ 4.5（${JSON.stringify(ct)}）`);
          if (theme === 'day') {
            const tag = await revertKeyColor(page);
            const was = await measureKeyContrast(page, i);
            t.diagnostic(`${label} #${i} 注回 62% ${JSON.stringify(was)}`);
            old62.push({label, i, ratio: was.textPx?.ratio});
            await tag.evaluate((n) => n.remove());
          }
        }
        assert.deepEqual(pageErrors.slice(errorsBefore), [], `${label} 页面报错`);
      }
      assert.deepEqual(pageErrors, [], `${scene} ${theme} 页面报错`);
    } finally {
      await context.close();
    }
  }
  assert.ok(worstOld > 0, `反例没生效：键塞回气泡（main 挂法）也没压到正文，最大 ${worstOld}`);
  assert.ok(old62.length > 0, '日间量过注回 62% 的键');
  const worst62 = Math.min(...old62.map((x) => x.ratio));
  assert.ok(worst62 < 4.5, `反例没生效：注回 62% 稀释日间最差也 ≥ 4.5（${JSON.stringify(old62)}）`);
});
