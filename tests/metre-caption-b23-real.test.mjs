// B23（uireview #218 记）：Windows 右上窗口键胶囊（app/windows_bridge_scripts.py 注入的 #pinkie-native-window-controls）
// 在 Metre 里还是碧琪的粉紫描边 / 粉色渐变底，最左「检查更新」的星是粉的。Metre 里不该有粉色。
// 修法：bridge 里加 html[data-pinkie-platform=windows][data-laolao-mode=metre] 几条（日 / 夜），胶囊变量换成 Metre 色板：
// 底 --metre-surface、描边 --metre-line-strong、图标 --metre-text、更新标记 --metre-cobalt、关闭悬停 --metre-danger。
// 这里在真实安装的 Control UI + 碧琪注入 + bridge 上量：
// - Metre 日 / 夜：胶囊没有渐变底、底色和描边就是 Metre 变量、星是钴蓝、图标是墨色，都不偏粉；图标对胶囊底 ≥ 4.5:1；
// - 非 Metre（普通会话）：胶囊仍是原来的粉色渐变，不跟着变；
// - 反例：页面上删掉新加的 Metre 胶囊规则，Metre 日间胶囊退回粉色渐变底、星退回 #d9508d。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  settleRealPage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

function readCaption() {
  const el = document.getElementById('pinkie-native-window-controls');
  if (!el) return {missing: true};
  const cs = getComputedStyle(el);
  const star = el.querySelector('.pinkie-update-control .pk-star');
  const icon = el.querySelector('button[data-act="min"]') || el.querySelector('button');
  // 不用元素探针（CI 上两次都量成继承下来的 --metre-text：颜色过渡 / !important 规则都会干扰）。
  // 直接读 <html> 上变量的值，画到 1x1 画布上读回像素，换成 rgb(r, g, b)。
  const root = getComputedStyle(document.documentElement);
  const ctx = Object.assign(document.createElement('canvas'), {width: 1, height: 1}).getContext('2d', {willReadFrequently: true});
  const resolve = (v) => {
    const raw = root.getPropertyValue(v).trim();
    if (!raw) return `(${v} 没定义)`;
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = raw; ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  };
  const out = {
    mode: document.documentElement.getAttribute('data-laolao-mode'),
    bgImage: cs.backgroundImage, bg: cs.backgroundColor, edge: cs.borderTopColor,
    star: star ? getComputedStyle(star).fill : null, ink: icon ? getComputedStyle(icon).color : null,
    surface: resolve('--metre-surface'), line: resolve('--metre-line-strong'), cobalt: resolve('--metre-cobalt'), text: resolve('--metre-text'),
  };
  return out;
}

function dropMetreCaptionRules() {
  let n = 0;
  const walk = (owner, list) => {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const r = list[i];
      if (!r.selectorText && r.cssRules) walk(r, r.cssRules);
      else if (r.selectorText && r.selectorText.includes('data-laolao-mode="metre"') && r.selectorText.includes('#pinkie-native-window-controls')) { owner.deleteRule(i); n += 1; }
    }
  };
  for (const sh of document.styleSheets) { try { walk(sh, sh.cssRules); } catch {} }
  return n;
}

const nums = (s) => (String(s).match(/[\d.]+/g) || []).map(Number);
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const x = lum(nums(a)), y = lum(nums(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// 「偏粉」：红明显高于绿、蓝也高于绿（品红 / 粉紫一类）
const pinkish = (s) => { const [r, g, b] = nums(s); return r - g > 25 && b - g > 5; };

test('B23: Windows caption capsule uses the Metre palette in Metre (day and night), stays pink elsewhere; removing the rules brings the pink back', {timeout: 240_000}, async (t) => {
  let installed, server, browser, context, page;
  // B55: cleanup first, so a browser that fails to launch cannot leave the server open.
  // Reverse order (context → browser → server → install), each layer in try/finally.
  t.after(async () => {
    try { await context?.close(); } finally {
      try { await browser?.close(); } finally {
        try { await server?.close(); } finally { installed?.cleanup(); }
      }
    }
  });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  // macOS WebKit 的 newPage 每次约 10s。Metre 夜间只看属性（[data-pinkie-night] / [data-theme="dark"]），
  // 所以 metre-board 只开一页：先量夜间，再页内切到日间重新 settle 后量；删规则的反例会污染页面，放在这一页最后。
  ({context, page} = await openRealScenePage(browser, server.origin, 'metre-board', 'night'));
  try {
    for (const theme of ['night', 'day']) {
      if (theme === 'day') {
        await page.emulateMedia({colorScheme: 'light'});
        await settleRealPage(page, 'day');
        const attrs = await page.evaluate(() => ({
          night: document.documentElement.hasAttribute('data-pinkie-night'),
          theme: document.documentElement.getAttribute('data-theme'),
        }));
        assert.equal(attrs.night, false, '页内切到日间后 data-pinkie-night 还在，量到的仍是夜间');
        assert.notEqual(attrs.theme, 'dark', '页内切到日间后 data-theme 仍是 dark，量到的仍是夜间');
      }
      const m = await page.evaluate(readCaption);
      assert.notEqual(m.missing, true, `${theme}：胶囊没挂上`);
      assert.equal(m.mode, 'metre');
      assert.equal(m.bgImage, 'none', `${theme}：Metre 里胶囊不该还有渐变底`);
      assert.equal(m.bg, m.surface, `${theme}：胶囊底应是 --metre-surface`);
      assert.equal(m.edge, m.line, `${theme}：胶囊描边应是 --metre-line-strong`);
      assert.equal(m.star, m.cobalt, `${theme}：更新星应是 --metre-cobalt`);
      assert.equal(m.ink, m.text, `${theme}：图标应是 --metre-text`);
      for (const k of ['bg', 'edge', 'star', 'ink']) assert.ok(!pinkish(m[k]), `${theme}：${k}=${m[k]} 偏粉`);
      assert.ok(ratio(m.ink, m.bg) >= 4.5, `${theme}：图标对胶囊底 ${ratio(m.ink, m.bg).toFixed(2)}:1 < 4.5`);
      if (theme === 'day') {
        const n = await page.evaluate(dropMetreCaptionRules);
        assert.ok(n >= 2, `反例：应删掉至少两条 Metre 胶囊规则，实删 ${n}`);
        const back = await page.evaluate(readCaption);
        assert.match(back.bgImage, /gradient/, '反例没生效：删掉后胶囊仍没有粉色渐变底');
        assert.equal(back.star, 'rgb(217, 80, 141)', '反例没生效：删掉后更新星应退回 #d9508d');
      }
    }
  } finally { await context.close(); context = undefined; }

  // sidebar-expanded 要另一条 session URL 和场景初始化脚本，openRealScenePage 不接已有页，所以单独开一页。
  ({context, page} = await openRealScenePage(browser, server.origin, 'sidebar-expanded', 'day'));
  try {
    const m = await page.evaluate(readCaption);
    assert.notEqual(m.mode, 'metre');
    assert.match(m.bgImage, /gradient/, '非 Metre：胶囊应保留原来的粉色渐变底');
    assert.equal(m.star, 'rgb(217, 80, 141)', '非 Metre：更新星保留 #d9508d');
  } finally { await context.close(); context = undefined; }
});
