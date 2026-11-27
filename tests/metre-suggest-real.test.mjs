// I8「下一句建议」在真实 Control UI 上的复发测试（m5，11-25）。设计：build/quick-run/设计-I8.md。
// 真实安装的 Control UI + 碧琪注入 + 假网关（tests/visual/lib/real-harness.mjs），1440 日 / 820 夜：
//   1. 发一句，假网关回一条「用 React 还是 Vue？」，回答结束后输入框上方出两条建议（React / Vue），在输入框外壳前面、看得见；
//   2. 点「Vue」：输入框里是「Vue」、焦点在输入框，**假网关没有收到新的 chat.send**（deliveries 条数不变），建议收起；
//   3. 设置里关掉（pinkie.metre.prefs.nextSuggest=off）后再来一轮，不出建议；
//   4. 建议按钮的字和它实际底色对比度 ≥ 4.5:1（日 / 夜）。
// 反例：把 fill() 改成点了就发送，第 2 条变红（见 PR #104 说明）。
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
const ROW = '.pk-metre-suggest';
const REPLY = '两种都能做。用 React 还是 Vue？';

const sends = () => (window.__fake?.state?.deliveries || []).length;
const rowState = () => {
  const row = document.querySelector('.pk-metre-suggest');
  if (!row) return null;
  const r = row.getBoundingClientRect();
  const chip = row.querySelector('.pk-metre-suggest__chip')?.getBoundingClientRect();
  const box = document.querySelector('.agent-chat__composer-combobox')?.getBoundingClientRect();
  return {chips: [...row.querySelectorAll('.pk-metre-suggest__chip')].map((b) => b.textContent),
    beforeShell: row.nextElementSibling?.classList.contains('agent-chat__composer-shell') ?? false,
    visible: r.width > 0 && r.height > 0 && r.bottom <= innerHeight && r.top >= 0,
    leftGap: chip && box ? Math.round((chip.left - box.left) * 100) / 100 : null, overRight: chip && box ? Math.round(r.right - box.right) : null};
};
// 字 / 底，以及边框对按钮底、对按钮背后实际底色（往上找第一个不透明的背景）的对比度。
const contrast = () => {
  const lum = (s) => { const m = s.match(/[\d.]+/g).map(Number); const [r, g, b] = m.slice(0, 3).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (x, y) => { const a = lum(x), c = lum(y); return Math.round(((Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05)) * 100) / 100; };
  const opaque = (s) => { const m = s.match(/[\d.]+/g); return m && (m.length < 4 || Number(m[3]) >= 0.99) && !/^rgba\(0, 0, 0, 0\)$/.test(s); };
  const b = document.querySelector('.pk-metre-suggest__chip'); if (!b) return null;
  const cs = getComputedStyle(b);
  let el = b.parentElement, behind = 'rgb(255, 255, 255)';
  for (; el; el = el.parentElement) { const bg = getComputedStyle(el).backgroundColor; if (opaque(bg)) { behind = bg; break; } }
  return {fg: cs.color, bg: cs.backgroundColor, border: cs.borderTopColor, behind,
    ratio: ratio(cs.color, cs.backgroundColor), edgeOnChip: ratio(cs.borderTopColor, cs.backgroundColor), edgeOnPage: ratio(cs.borderTopColor, behind)};
};

async function turn(page, text) {
  await page.fill(BOX, text);
  await page.press(BOX, 'Enter');
  await page.waitForFunction(() => { const st = document.querySelector('openclaw-chat-pane')?.state; return st && !st.chatRunId && !st.chatSending && !st.chatStream && st.chatMessages?.at(-1)?.role === 'assistant'; }, null, {timeout: 10_000});
  await page.waitForTimeout(400);   // 保留：turn() 也用来断言「关掉后不出建议」，没有能等的条件
}

test('I8 real page: 回答后出下一句建议，点了只填不发，设置里能关（1440 日 / 820 夜）', async (t) => {
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

  for (const [width, theme] of [[1440, 'day'], [820, 'night']]) {
    await t.test(`I8 ${width} ${theme}`, async () => {
      const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, 'metre-board', theme);
      try {
        await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
        await page.setViewportSize({width, height: 800});
        await page.waitForSelector(BOX, {timeout: 5_000});
        assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')), 'metre');
        await page.evaluate((reply) => { localStorage.removeItem('pinkie.metre.prefs.nextSuggest'); window.__fake.setTransport({normalReply: reply, autoCompleteNormal: true}); }, REPLY);

        // 1. 一轮结束出建议
        await turn(page, '做个待办应用');
        const s1 = await page.evaluate(rowState);
        t.diagnostic(`I8 ${width} ${theme} 建议 ${JSON.stringify(s1)} 对比 ${JSON.stringify(await page.evaluate(contrast))}`);
        assert.ok(s1, '回答结束后出建议');
        assert.deepEqual(s1.chips, ['React', 'Vue']);
        assert.ok(s1.beforeShell, '在输入框外壳前面');
        assert.ok(s1.visible, '看得见、在视口里');
        assert.ok(Math.abs(s1.leftGap) <= 0.5, `第一条建议的左边框和输入框左边框齐平（差 ${s1.leftGap}px，只容 ±0.5 取整误差）`);
        assert.ok(s1.overRight <= 1, `建议这一行不超出输入框右边（超出 ${s1.overRight}px）`);

        // 4. 对比度
        const c = await page.evaluate(contrast);
        assert.ok(c.ratio >= 4.5, `建议按钮字 / 底对比度 ${c.ratio} < 4.5（${c.fg} on ${c.bg}）`);
        assert.ok(c.edgeOnChip >= 3, `建议按钮边框对按钮底 ${c.edgeOnChip} < 3（${c.border} on ${c.bg}）`);
        assert.ok(c.edgeOnPage >= 3, `建议按钮边框对背后实际底色 ${c.edgeOnPage} < 3（${c.border} on ${c.behind}）`);

        // 2. 点了只填不发
        const before = await page.evaluate(sends);
        await page.click(`${ROW} .pk-metre-suggest__chip >> text=Vue`);
        await page.waitForTimeout(400);   // 保留：同时断言「没有发出新的 chat.send」，要给可能的误发送留时间
        assert.equal(await page.inputValue(BOX), 'Vue', '填进输入框');
        assert.equal(await page.evaluate(sends), before, '没有发出新的 chat.send');
        assert.equal(await page.evaluate((sel) => document.activeElement === document.querySelector(sel), BOX), true, '焦点在输入框');
        assert.equal(await page.evaluate(rowState), null, '点了之后建议收起');
        await page.fill(BOX, '');

        // 3. 设置里关掉
        await page.evaluate(() => localStorage.setItem('pinkie.metre.prefs.nextSuggest', 'off'));
        await turn(page, '再来一句');
        assert.equal(await page.evaluate(rowState), null, '关掉后不出建议');
        await page.evaluate(() => localStorage.removeItem('pinkie.metre.prefs.nextSuggest'));
        assert.deepEqual(pageErrors, [], '页面没有报错');
      } finally {
        await context.close();
      }
    });
  }
});
