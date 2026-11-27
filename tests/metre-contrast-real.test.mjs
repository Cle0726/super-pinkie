// X4 复发防护（真页面）：系统「提高对比度」（prefers-contrast: more）时，Metre 侧栏和底栏状态带里用弱化色的小字日夜都到 4.5:1。
// 11-25 真页面核实：Metre 日间弱化色 #77736B 在页面底 / 侧栏 / 悬停底上只有 4.37 / 4.10 / 4.03:1。
// 这里在真实安装的 OpenClaw Control UI + 碧琪注入上，模拟 prefers-contrast: more，量计算后的字色对它后面第一层不透明底的对比度。
// 同时确认平时（no-preference）Metre 的变量和 main 一样，外观不变。
// 反例写在测试里：从页面上删掉 laolao-metre-contrast.css 的规则，日间弱化色小字必须掉回 4.5 以下。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

// 平时的 Metre 变量（laolao-metre-skin.css 日间 / 夜间两段），高对比关掉时必须原样
const NORMAL = {
  day: {muted: 'rgb(119, 115, 107)', line: 'rgb(228, 226, 220)', strong: 'rgb(211, 208, 200)'},
  night: {muted: 'rgb(145, 141, 132)', line: 'rgb(39, 39, 37)', strong: 'rgb(57, 56, 53)'},
};

// 在页面里：找侧栏和底栏状态带里字色等于弱化色、本身有字的元素，算它对后面第一层不透明底的对比度。
function readContrast() {
  const probe = document.createElement('i');
  probe.style.cssText = 'position:absolute;color:var(--metre-muted);border:1px solid var(--metre-line);outline:1px solid var(--metre-line-strong)';
  document.body.append(probe);
  const ps = getComputedStyle(probe);
  const tokens = {muted: ps.color, line: ps.borderTopColor, strong: ps.outlineColor};
  probe.remove();
  // 11-25：color-mix() 算出来的色，浏览器报成 color(srgb r g b [/ a])，分量是 0–1；以前当 0–255 读，会把 (90,84,105) 读成近黑。
  const rgb = (s) => {
    const n = (s.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    if (/^rgba?\(/.test(s)) return n;
    if (/^color\(srgb\s/.test(s)) return n.map((v, i) => (i < 3 ? v * 255 : v));
    throw new Error(`读不懂的颜色格式：${s}`);
  };
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const bgOf = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c.length >= 3 && (c[3] === undefined || c[3] >= 0.99)) return c.slice(0, 3);
    }
    return rgb(getComputedStyle(document.documentElement).backgroundColor).slice(0, 3);
  };
  const out = [];
  for (const scope of document.querySelectorAll('aside.sidebar, .pk-metre-backstage, .pk-bs')) {
    for (const el of scope.querySelectorAll('*')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.color !== tokens.muted || cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const bg = bgOf(el);
      // 11-25：侧栏时间 / 分组标题自己带 opacity（.56 / .7），只看 color 会把实际 2.5:1 的字算成 6:1。按自己和祖先的透明度连乘，把字色混到底上再算。
      let op = 1;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
      if (op < 0.05) continue;   // 悬停才出现的行内按键等，平时就是全透明、看不见，不算
      const raw = rgb(cs.color); const alpha = (raw[3] === undefined ? 1 : raw[3]) * op;
      const ink = raw.slice(0, 3).map((v, i) => alpha * v + (1 - alpha) * bg[i]);
      const a = lum(ink); const b = lum(bg);
      out.push({el: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`, text: el.textContent.trim().slice(0, 16),
        ink: `rgb(${ink})`, bg: `rgb(${bg})`, opacity: op, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)});
    }
  }
  // 11-25 协调者加：会话标题（字色不是弱化色，上面那圈量不到）。Metre 夜间不带 data-pinkie-night，没选中的标题曾吃日间配方，约 2.5:1；
  // 选中的那行（laolao-sidebar-surface.css:144 accent 45% + #3d3036）夜间约 2.96:1。active 标出是不是选中行。
  // 选中行的底是 accent 7% 半透明，bgOf 跳过它取侧栏底；夜间两者只差几级灰，对 4.5 的判断没影响。
  const titles = [];
  for (const el of document.querySelectorAll('aside.sidebar .sidebar-recent-session .sidebar-recent-session__name')) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || !el.textContent.trim()) continue;
    const cs = getComputedStyle(el); const bg = bgOf(el);
    let op = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
    const raw = rgb(cs.color); const alpha = (raw[3] === undefined ? 1 : raw[3]) * op;
    const ink = raw.slice(0, 3).map((v, i) => alpha * v + (1 - alpha) * bg[i]);
    const a = lum(ink); const b = lum(bg);
    titles.push({el: 'span.sidebar-recent-session__name', active: !!el.closest('.sidebar-recent-session--active'), text: el.textContent.trim().slice(0, 16), ink: `rgb(${ink})`, bg: `rgb(${bg})`, opacity: op,
      ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)});
  }
  return {tokens, items: out, titles};
}

const fmt = (items) => items.map((i) => `${i.el}「${i.text}」${i.ink} on ${i.bg} ${i.ratio.toFixed(2)}`).join('; ');

// 改了字色 / 删了规则后，等 CSS 过渡全部停下再量（Metre 皮肤给字色有 160ms 过渡，半路读到的是过渡中的颜色，Chromium 还会报成 oklab(...)）。
// 只看 CSS 过渡：页面上猫、加载圈等无限循环的 CSS 动画一直 running，算进来会永远等不到。getAnimations() 会先刷样式，刚起的过渡已经在里面。
// 和下面「切高对比后」那处 11-26 已经在 CI 上跑着的等法是同一个条件。
const transitionsSettled = (page) => page.waitForFunction(
  () => document.getAnimations().filter((a) => a instanceof CSSTransition).every((a) => a.playState !== 'running'),
  null, {timeout: 5000},
);

test('X4 real page: with prefers-contrast: more, Metre muted small text in sidebar and status band reaches 4.5:1 day and night; normal look unchanged', async (t) => {
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const theme of ['day', 'night']) {
    const {context, page} = await openRealScenePage(browser, server.origin, 'metre-board', theme);
    try {
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')), 'metre');

      // 平时：变量和 main 一样
      await page.emulateMedia({contrast: 'no-preference'});
      const normal = await page.evaluate(readContrast);
      assert.deepEqual(normal.tokens, NORMAL[theme], `${theme}: 没开高对比时 Metre 变量变了`);

      // 高对比
      await page.emulateMedia({contrast: 'more'});
      assert.equal(await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches), true);
      // 11-26：切高对比后字色有 160ms 过渡，过渡中 Chromium 把颜色报成 oklab(...)（CI 夜间读到过）；等过渡全部停下再量，不去读半路的颜色。
      // 只看 CSS 过渡：页面上猫、加载圈等无限循环的 CSS 动画一直 running，算进来会永远等不到。getAnimations() 会先刷样式，刚切的过渡已经在里面。
      await page.waitForFunction(() => document.getAnimations().filter((a) => a instanceof CSSTransition).every((a) => a.playState !== 'running'), null, {timeout: 5000});
      const more = await page.evaluate(readContrast);
      console.log(`ℹ ${theme} more: tokens ${JSON.stringify(more.tokens)}; ${fmt(more.items)}`);
      assert.notEqual(more.tokens.muted, NORMAL[theme].muted, `${theme}: 高对比时弱化色没换`);
      assert.ok(more.items.length >= 1, `${theme}: 侧栏 / 状态带里没找到用弱化色的小字`);
      for (const i of more.items) assert.ok(i.ratio >= 4.5, `${theme}: ${i.el}「${i.text}」只有 ${i.ratio.toFixed(2)}:1 — ${fmt(more.items)}`);
      console.log(`ℹ ${theme} more titles: ${fmt(more.titles)}`);
      assert.ok(more.titles.some((i) => !i.active), `${theme}: 侧栏里没找到没选中的会话标题（量不到不能算通过）`);
      assert.ok(more.titles.some((i) => i.active), `${theme}: 侧栏里没找到选中的会话标题（量不到不能算通过）`);
      for (const i of more.titles) assert.ok(i.ratio >= 4.5, `${theme}: ${i.active ? '选中' : '没选中'}的会话标题「${i.text}」只有 ${i.ratio.toFixed(2)}:1 — ${fmt(more.titles)}`);
      // 11-25 协调者 16:54：没选中的会话标题单独一条断言（日 / 夜），反例是把颜色改浅要红。
      const unselectedLow = (titles) => titles.filter((i) => !i.active && i.ratio < 4.5);
      assert.deepEqual(unselectedLow(more.titles), [], `${theme}: 高对比下没选中的会话标题没到 4.5:1 — ${fmt(more.titles)}`);

      // 反例：只把没选中的标题字色改浅（往它自己的底色靠 60%），同一条断言必须红；选中行不动。
      const faded = await page.evaluate(() => {
        const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number);
        let n = 0;
        for (const el of document.querySelectorAll('aside.sidebar .sidebar-recent-session:not(.sidebar-recent-session--active) .sidebar-recent-session__name')) {
          let bg = [255, 255, 255];
          for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
            const c = parse(getComputedStyle(p).backgroundColor);
            if (c.length >= 3 && (c[3] === undefined || c[3] >= 0.99)) { bg = c.slice(0, 3); break; }
          }
          const ink = parse(getComputedStyle(el).color).slice(0, 3);
          const mix = ink.map((v, i) => Math.round(0.4 * v + 0.6 * bg[i]));
          el.style.setProperty('transition', 'none', 'important');
          el.style.setProperty('color', `rgb(${mix.join(', ')})`, 'important');
          n++;
        }
        return n;
      });
      assert.ok(faded >= 1, `${theme}: 反例：没找到可以改浅的没选中会话标题`);
      await transitionsSettled(page);
      const lighter = await page.evaluate(readContrast);
      console.log(`ℹ ${theme} more, unselected titles faded: ${fmt(lighter.titles)}`);
      assert.ok(unselectedLow(lighter.titles).length >= 1, `${theme}: 反例没生效：没选中的标题改浅后仍都 ≥ 4.5 — ${fmt(lighter.titles)}`);
      assert.deepEqual(lighter.titles.filter((i) => i.active).map((i) => i.ink), more.titles.filter((i) => i.active).map((i) => i.ink), `${theme}: 反例改到了选中行`);
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('aside.sidebar .sidebar-recent-session__name')) { el.style.removeProperty('color'); el.style.removeProperty('transition'); }
      });
      await transitionsSettled(page);
      assert.deepEqual(unselectedLow((await page.evaluate(readContrast)).titles), [], `${theme}: 撤掉反例后没选中的标题没回到 4.5:1`);

      if (theme === 'night') {
        // 反例：删掉 laolao-metre-contrast.css 的规则，夜间没选中的会话标题必须掉回 4.5 以下（就是协调者看到的那几行）
        const removed = await page.evaluate(() => {
          let n = 0;
          for (const sh of document.styleSheets) {
            if (!/laolao-metre-contrast\.css/.test(sh.href || '')) continue;
            for (let i = sh.cssRules.length - 1; i >= 0; i--) { sh.deleteRule(i); n++; }
          }
          return n;
        });
        assert.ok(removed >= 1, '页面上没有 laolao-metre-contrast.css');
        await transitionsSettled(page);
        const bad = await page.evaluate(readContrast);
        console.log(`ℹ night more without contrast css, titles: ${fmt(bad.titles)}`);
        assert.ok(bad.titles.some((i) => !i.active), '反例：删掉后侧栏里没找到没选中的会话标题');
        assert.ok(bad.titles.some((i) => !i.active && i.ratio < 4.5), `反例没生效：删掉后夜间没选中的会话标题仍都 ≥ 4.5 — ${fmt(bad.titles)}`);
        assert.ok(bad.titles.some((i) => i.active), '反例：删掉后侧栏里没找到选中的会话标题');
        assert.ok(bad.titles.some((i) => i.active && i.ratio < 4.5), `反例没生效：删掉后夜间选中的会话标题仍 ≥ 4.5 — ${fmt(bad.titles)}`);
      }

      if (theme === 'day') {
        // 反例：删掉 laolao-metre-contrast.css 的规则，日间弱化色小字必须掉回 4.5 以下
        const removed = await page.evaluate(() => {
          let n = 0;
          for (const sh of document.styleSheets) {
            if (!/laolao-metre-contrast\.css/.test(sh.href || '')) continue;
            for (let i = sh.cssRules.length - 1; i >= 0; i--) { sh.deleteRule(i); n++; }
          }
          return n;
        });
        assert.ok(removed >= 1, '页面上没有 laolao-metre-contrast.css');
        await transitionsSettled(page);   // Metre 皮肤给字色有 160ms 过渡，删规则后马上读会读到过渡中的颜色、一个都对不上弱化色
        const bad = await page.evaluate(readContrast);
        const seen = await page.evaluate(() => [...document.querySelectorAll('aside.sidebar .pinkie-session-time')].slice(0, 3).map((el) => `${getComputedStyle(el).color} / transition ${getComputedStyle(el).transitionDuration}`));
        assert.ok(bad.items.length >= 1, `反例：删掉后侧栏 / 状态带里没找到用弱化色的小字（量不到不能算通过）；弱化色 ${bad.tokens.muted}，侧栏时间实际 ${seen.join(' | ')}`);
        console.log(`ℹ day more without contrast css: ${fmt(bad.items)}`);
        assert.equal(bad.tokens.muted, NORMAL.day.muted);
        assert.ok(bad.items.some((i) => i.ratio < 4.5), `反例没生效：删掉后小字仍都 ≥ 4.5 — ${fmt(bad.items)}`);
      }
    } finally {
      await context.close();
    }
  }
});
