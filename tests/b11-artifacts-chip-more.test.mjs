// B11 无限制模式走查 #6（tools/pr-shots/b11-infinite-walkthrough.md:29）+ 作品库「再看更多」边框：
// 复发点：.pinkie-art-chip[aria-pressed="true"] 字色 color-mix(accent 82%, text) 压在 14% accent 底上，日间只有 3.99；
//         .pinkie-art-more 边框用 var(--pa-line)（.12 透明），对卡片底只有约 1.22。
// 要求：选中键文字 ≥4.5，「再看更多」边框对外侧和内侧都 ≥3；日 / 夜 × 1440 / 820 × settings / home-unrestricted。
// 反例：同页停用 laolao-artifacts.css，换回 82% 与 pa-line 的旧写法，必须跌破阈值。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, {after, before, describe} from 'node:test';
import {
  REPO_ROOT,
  assertRealPageLoaded,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';
import {playwright} from '../tools/study-desk/harness.mjs';

const CSS = fs.readFileSync(path.join(REPO_ROOT, 'ui/injections/laolao-artifacts.css'), 'utf8');
const CHIP_ON = /\.pinkie-art-chip\[aria-pressed="true"\] \{[^}]*\}/;
const MORE = /\.pinkie-art-more \{[^}]*\}/;
const CSS_OLD = CSS
  .replace(CHIP_ON, (r) => r.replace('var(--pa-accent) 60%', 'var(--pa-accent) 82%'))
  .replace(MORE, (r) => r.replace('border:1px solid var(--pa-edge)', 'border:1px solid var(--pa-line)'));

test('静态：选中键字色不再是 82% accent，「再看更多」边框用 --pa-edge', () => {
  const chip = CSS.match(CHIP_ON);
  const more = CSS.match(MORE);
  assert.ok(chip && more, '找到两条规则');
  assert.doesNotMatch(chip[0], /var\(--pa-accent\) 82%/);
  assert.match(chip[0], /color:color-mix\(in srgb,var\(--pa-accent\) 60%,var\(--pa-text\)\)/);
  assert.match(more[0], /border:1px solid var\(--pa-edge\)/);
  assert.doesNotMatch(chip[0] + more[0], /!important/);
  assert.notEqual(CSS_OLD, CSS, '反例替换命中');
});

const initScript = () => {
  const item = {id: 'a1b2', kind: 'doc', title: '单词表.txt', path: 'C:/work/单词表.txt', mode: 'project', sessionKey: '',
    createdAt: 0, updatedAt: 0, exists: true, size: 2048, version: 1, total: 1,
    versions: [{v: 1, ts: 0, size: 2048, runId: '', source: 'tool', snapshot: true}]};
  const answers = {
    'pinkie.artifacts.list': {ok: true, items: [item], cursor: 'next'},
    'pinkie.artifacts.get': {ok: true, item},
    'pinkie.apps.forArtifact': {ok: true, app: null},
    'pinkie.apps.list': {ok: true, apps: []},
  };
  window.pywebview = {api: {pinkieNative: async () => ({ok: true})}};
  const wrap = () => {
    const sidebar = window.__laolaoSidebar;
    if (!sidebar || typeof sidebar.gwRequest !== 'function' || sidebar.gwRequest.__art) return false;
    const real = sidebar.gwRequest.bind(sidebar);
    const fake = (method, params, timeout) => (method in answers ? Promise.resolve(answers[method]) : real(method, params, timeout));
    fake.__art = true;
    sidebar.gwRequest = fake;
    return true;
  };
  const timer = setInterval(() => { if (wrap()) clearInterval(timer); }, 50);
};

// 逐层叠背景；文字对自身底，边框分别对外侧（父层）和内侧（自身底）取较差。
function probe() {
  const parse = (s) => {
    let m = String(s).match(/^rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
    m = String(s).match(/^color\(srgb\s+([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
    return [0, 0, 0, 0];
  };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
  const chain = (node) => { const list = []; for (let n = node; n && n.nodeType === 1; n = n.parentElement) list.push(n); return list; };
  const backdrop = (node, withSelf) => {
    let c = [255, 255, 255, 1];
    for (const n of chain(withSelf ? node : node.parentElement).reverse()) c = over(parse(getComputedStyle(n).backgroundColor), c);
    return c;
  };
  const opacity = (node) => chain(node).reduce((acc, n) => acc * Number(getComputedStyle(n).opacity || 1), 1);
  const ink = (node, color) => { const c = parse(color); c[3] *= opacity(node); return c; };
  const chip = document.querySelector('.pinkie-art-page .pinkie-art-kinds .pinkie-art-chip[aria-pressed="true"]');
  const more = document.querySelector('.pinkie-art-page .pinkie-art-more:not([hidden])');
  const res = {mode: document.documentElement.getAttribute('data-laolao-mode'), chip: null, more: null};
  if (chip) {
    const bg = backdrop(chip, true);
    res.chip = {text: chip.textContent, color: getComputedStyle(chip).color, ratio: ratio(over(ink(chip, getComputedStyle(chip).color), bg), bg)};
  }
  if (more) {
    const outer = backdrop(more, false);
    const inner = over(parse(getComputedStyle(more).backgroundColor), outer);
    const edge = ink(more, getComputedStyle(more).borderTopColor);
    res.more = {edge: getComputedStyle(more).borderTopColor, ratio: Math.min(ratio(over(edge, outer), outer), ratio(over(edge, inner), inner))};
  }
  return res;
}

async function swapToOld(page, css) {
  await page.evaluate((text) => {
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      if (/laolao-artifacts\.css/.test(link.getAttribute('href') || '')) link.disabled = true;
    }
    const style = document.createElement('style');
    style.id = 'b11-art-before';
    style.textContent = text;
    document.head.appendChild(style);
  }, css);
  await page.waitForTimeout(150);
}

// 换宽度后等布局和过渡停稳，再把焦点和指针挪开，避免 hover / focus 样式混进量值。
async function settleAt(page, width) {
  await page.setViewportSize({width, height: 800});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForSelector('.pinkie-art-page .pinkie-art-more:not([hidden])', {timeout: 10_000});
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, {timeout: 10_000});
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(1, 799);
}

const WIDTHS = [1440, 820];

describe('真浏览器（server / browser 全文件复用一次）', () => {
  let installed = null;
  let server = null;
  let browser = null;

  before(async () => {
    installed = installRealControlUi({repoRoot: REPO_ROOT});
    server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
    browser = process.env.PINKIE_VISUAL_ENGINE === 'webkit'
      ? await playwright().webkit.launch({headless: true})
      : await launchRealBrowser();
  }, {timeout: 120_000});

  after(async () => {
    await browser?.close();
    await server?.close();
    installed?.cleanup();
  });

  // 同一个 scene×theme 只开一次页：改后依次量 1440 → 820，换回旧写法后再量 820 → 1440，宽度×新旧组合一个不少。
  test('选中键字 ≥4.5、「再看更多」边框 ≥3；换回旧写法必须跌破', {timeout: 240_000}, async (t) => {
    const problems = [];
    let oldDayChip = Infinity;
    let oldMore = Infinity;
    for (const scene of ['settings', 'home-unrestricted']) {
      for (const theme of ['day', 'night']) {
        const started = Date.now();
        const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, scene, theme, {initScript});
        try {
          await assertRealPageLoaded(page);
          await page.waitForFunction(() => window.__laolaoSidebar?.gwRequest?.__art === true, null, {timeout: 15_000});
          await page.evaluate(() => window.PinkieArtifacts.open());
          for (const width of WIDTHS) {
            const where = `${scene}/${theme}/${width}`;
            await settleAt(page, width);
            const after = await page.evaluate(probe);
            t.diagnostic(`${where} 改后 ${JSON.stringify(after)}`);
            if (!after.chip || !(after.chip.ratio >= 4.5)) problems.push(`${where} 选中键字 <4.5 ${JSON.stringify(after.chip)}`);
            if (!after.more || !(after.more.ratio >= 3)) problems.push(`${where} 再看更多边框 <3 ${JSON.stringify(after.more)}`);
          }
          await swapToOld(page, CSS_OLD);
          for (const width of [...WIDTHS].reverse()) {
            const where = `${scene}/${theme}/${width}`;
            await settleAt(page, width);
            const before = await page.evaluate(probe);
            t.diagnostic(`${where} 改前 ${JSON.stringify(before)}`);
            if (!before.chip || !before.more) problems.push(`${where} 反例没量到元素 ${JSON.stringify(before)}`);
            if (theme === 'day') oldDayChip = Math.min(oldDayChip, before.chip?.ratio ?? Infinity);
            oldMore = Math.min(oldMore, before.more?.ratio ?? Infinity);
          }
          assert.deepEqual(pageErrors, [], `${scene}/${theme} pageerror`);
        } finally {
          await context.close();
        }
        t.diagnostic(`${scene}/${theme} 用时 ${Date.now() - started}ms`);
      }
    }
    assert.deepEqual(problems, []);
    assert.ok(oldDayChip < 4.5, `反例：旧 82% 日间选中键字应 <4.5，实际最差 ${oldDayChip}`);
    assert.ok(oldMore < 3, `反例：旧 pa-line 边框应 <3，实际最差 ${oldMore}`);
  });
});
