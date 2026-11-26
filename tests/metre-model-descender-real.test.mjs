// 模型名 g 下钩被剪（「gemini」像「qemini」）的真页面复发测试（ui3，11-25）。
// 根：laolao-metre-skin.css 给输入框下面这排按钮写了 font: 400 13px/1，按钮里的 span 用 font: inherit
// 继承成 line-height 1，行框只有 13px；原生 .chat-controls__inline-select-label 和
// .pinkie-external-model-name 都是 overflow:hidden，于是字体的下伸部（g p y q j）被这个 span 自己裁掉。
// 测法：每个按钮里每段看得见的文字，用 Range 量它的字形盒子（字体 ascent + descent，和行高无关），
// 往上走到按钮为止，任何一层 overflow 不是 visible 的祖先都不能在上下方向把它切掉（容 0.5px 取整）。
// 三宽（1440 / 1024 / 820）× 日夜。每一格里再把行高临时压回 1 量一次，必须量出被裁（反例要红）。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const BOX = '.agent-chat__composer-combobox textarea';
const BUTTONS = ['.pinkie-tray-btn', '.chat-controls__inline-select-trigger', '.pinkie-effort-trigger', '.laolao-deep-think-btn', '.laolao-context-viewer > summary'];
// 反例：和皮肤那条规则同样的选择器，多三个 :not(#id) 压过它，只把行高改回 1。
const REVERT = `html[data-laolao-mode="metre"]:not(#_r1):not(#_r2):not(#_r3) .agent-chat__input :is(${BUTTONS.join(', ')}) { line-height: 1 !important; }`;

// 字体就绪（字形盒子跟字体走）后再等两帧，样式和排版都落定再量；不靠固定毫秒。
const settle = async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); };

// 返回 {checked, clipped:[…], model}：checked 是量过的文字段数，model 是模型名那段的量法，clipped 是被切掉的。
const measure = (sels) => {
  const out = {checked: 0, clipped: [], model: null};
  const round = (n) => Math.round(n * 100) / 100;
  for (const btn of document.querySelectorAll(sels.map((s) => `.agent-chat__input ${s}`).join(', '))) {
    const br = btn.getBoundingClientRect();
    if (!br.width || !br.height) continue;
    const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const host = node.parentElement;
      if (!host || !host.getClientRects().length || getComputedStyle(host).visibility === 'hidden') continue;
      // 只给读屏用的隐藏文字（1×1px + clip，比如深度思考键的「极致思考」）本来就不显示，不算。
      let srOnly = false;
      for (let el = host; el && el !== btn.parentElement; el = el.parentElement) {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if ((r.width <= 1 && r.height <= 1) || /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip)) { srOnly = true; break; }
      }
      if (srOnly) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      const top = Math.min(...rects.map((r) => r.top)), bottom = Math.max(...rects.map((r) => r.bottom));
      out.checked++;
      const isModel = host.closest('.chat-controls__inline-select-trigger') && /gemini|flash|claude|gpt/i.test(node.textContent);
      let clip = null;
      for (let el = host; el && el !== btn.parentElement; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const r = el.getBoundingClientRect();
        const inTop = r.top + el.clientTop, inBottom = inTop + el.clientHeight;
        if (top < inTop - 0.5 || bottom > inBottom + 0.5) {
          clip = {by: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`, glyph: [round(top), round(bottom)], box: [round(inTop), round(inBottom)], lineHeight: cs.lineHeight, fontSize: cs.fontSize};
          break;
        }
      }
      const row = {text: node.textContent.trim().slice(0, 40), glyphH: round(bottom - top), clip};
      if (isModel && !out.model) out.model = row;
      if (clip) out.clipped.push(row);
    }
  }
  return out;
};

test('Metre 输入框下面一排按钮的字（含模型名的 g 下钩）不被父级裁掉：三宽 × 日夜，行高压回 1 必须量出被裁', async (t) => {
  const installed = installRealControlUi({repoRoot: REPO_ROOT});
  let server = null;
  let browser = null;
  t.after(async () => {
    try { await browser?.close(); }
    finally {
      try { await server?.close(); }
      finally { installed.cleanup(); }
    }
  });
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const width of [1440, 1024, 820]) {
    for (const theme of ['day', 'night']) {
      await t.test(`${width} ${theme}`, async () => {
        const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, 'metre-board', theme);
        try {
          await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
          await page.setViewportSize({width, height: 800});
          await page.waitForSelector(BOX, {timeout: 5_000});
          assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')), 'metre');
          await page.waitForFunction(() => document.querySelector('.agent-chat__input .chat-controls__inline-select-trigger')?.textContent.trim(), null, {timeout: 10_000});
          await page.waitForTimeout(300);

          const now = await page.evaluate(measure, BUTTONS);
          t.diagnostic(`${width} ${theme} 现在 ${JSON.stringify(now)}`);
          assert.ok(now.model, `量到了模型名那段（${JSON.stringify(now)}）`);
          assert.ok(now.checked >= 2, `至少量到两段按钮文字（实际 ${now.checked}）`);
          assert.deepEqual(now.clipped, [], '没有一段字被父级在上下方向裁掉');

          await page.addStyleTag({content: REVERT});
          // 不靠固定毫秒：等每个按钮的计算行高真变成 1（= 字号），再等字体就绪和两帧，才量。
          await page.waitForFunction((sels) => {
            const els = [...document.querySelectorAll(sels.map((s) => `.agent-chat__input ${s}`).join(', '))];
            return els.length > 0 && els.every((el) => { const cs = getComputedStyle(el); return cs.lineHeight === '1' || Math.abs(parseFloat(cs.lineHeight) - parseFloat(cs.fontSize)) < 0.01; });
          }, BUTTONS, {timeout: 5_000});
          await page.evaluate(settle);
          const reverted = await page.evaluate(measure, BUTTONS);
          t.diagnostic(`${width} ${theme} 行高压回 1 ${JSON.stringify(reverted.model)}`);
          assert.ok(reverted.model?.clip, `反例：行高压回 1 时必须量出模型名被裁（${JSON.stringify(reverted.model)}）`);
          assert.deepEqual(pageErrors, [], '页面没有报错');
        } finally {
          await context.close();
        }
      });
    }
  }
});
