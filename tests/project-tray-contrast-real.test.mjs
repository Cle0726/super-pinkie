// #261 #5 / #10 复发防护（真页面，WebKit）：项目模式下侧栏「临时」入口、输入框下面「工作程度」芯片和它的下拉箭头、
// 「工具」按钮，日夜 × 1440 / 820 都要够对比度：字 ≥ 4.5:1，图标和箭头 ≥ 3:1。
// 11-26 量到的旧值（日间）：「临时」1.91，箭头 2.14，「工具」3.07–3.99。原因是 color-mix(currentColor 55% / 68%) 再叠 opacity .75 / .7。
// 量法：字色 × 自己和祖先的 opacity 连乘，混到它后面一层层合成出来的底上，再算对比度。
// 反例写在测试里：把旧配方原样贴回页面，同一套量法必须量出不合格。
import assert from 'node:assert/strict';
import test from 'node:test';
import {REPO_ROOT, installRealControlUi, openRealScenePage, startRealUiServer} from './visual/lib/real-harness.mjs';
import {playwright} from '../tools/study-desk/harness.mjs';

const SCENES = ['home-project', 'sidebar-expanded'];
const WIDTHS = [1440, 820];
const TEXT_MIN = 4.5;
const ICON_MIN = 3;

const OLD_RECIPE = `
.pinkie-temp-entry.pinkie-temp-entry { color: color-mix(in srgb, currentColor 55%, transparent) !important; opacity: .75 !important; }
.pinkie-chip.pinkie-chip--mode:not(#_x) { color: color-mix(in srgb, currentColor 68%, transparent) !important; }
.pinkie-chip--mode .pinkie-chip__caret.pinkie-chip__caret { opacity: .7 !important; stroke-width: 1.5 !important; }
.agent-chat__input .pinkie-tray-btn.pinkie-tray-btn { color: var(--fog-muted, color-mix(in srgb, currentColor 68%, transparent)) !important; }
`;

function measure() {
  const rgb = (s) => {
    const n = (String(s).match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    if (/^color\(srgb\s/.test(s)) return n.map((v, i) => (i < 3 ? v * 255 : v));
    if (/^rgba?\(/.test(s)) return n;
    throw new Error(`读不懂的颜色格式：${s}`);
  };
  const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3]));
  const lum = (c) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => {
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(getComputedStyle(n).backgroundColor);
    let bg = [255, 255, 255];
    for (const c of chain.reverse()) { const v = rgb(c); bg = over([v[0], v[1], v[2], v[3] ?? 1], bg); }
    return bg;
  };
  const opOf = (el) => { let op = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity); return op; };
  // 820 下侧栏收起，「临时」靠祖先 opacity:0 藏起来，盒子还在：不算可见，否则会量出 1.00 的假失败。
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width >= 2 && r.height >= 2 && cs.visibility !== 'hidden' && opOf(el) >= 0.05; };
  const host = (el) => (el instanceof SVGElement ? el.closest('svg')?.parentElement || el : el);
  const k = (el, colorStr) => {
    const raw = rgb(colorStr); const bg = bgOf(host(el));
    const ink = over([raw[0], raw[1], raw[2], (raw[3] ?? 1) * opOf(el)], bg);
    return {ratio: ratio(ink, bg), ink: `rgb(${ink.map(Math.round)})`, bg: `rgb(${bg.map(Math.round)})`};
  };
  const paint = (svg) => {
    const shape = svg.querySelector('path,polyline,line,circle,rect') || svg;
    const s = getComputedStyle(shape);
    return s.stroke && s.stroke !== 'none' ? s.stroke : s.fill && s.fill !== 'none' ? s.fill : getComputedStyle(svg).color;
  };
  const out = [];
  const push = (name, kind, el, colorStr) => out.push({name, kind, ...k(el, colorStr)});
  const groups = [
    ['临时', 'aside.sidebar .pinkie-temp-entry', ':scope > svg'],
    ['工作程度', '.agent-chat__input .pinkie-chip--mode:not(.pinkie-baton)', ':scope > svg:not(.pinkie-chip__caret)'],
    ['工具', '.agent-chat__input .pinkie-tray-btn', ':scope > svg'],
  ];
  for (const [label, sel, iconSel] of groups) {
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el)) continue;
      if (el.textContent.trim()) push(`${label}·字`, 'text', el, getComputedStyle(el).color);
      const icon = el.querySelector(iconSel);
      if (icon && visible(icon)) push(`${label}·图标`, 'icon', icon, paint(icon));
      const caret = el.querySelector('.pinkie-chip__caret');
      if (caret && visible(caret)) push(`${label}·箭头`, 'icon', caret, paint(caret));
    }
  }
  return {mode: document.documentElement.dataset.laolaoMode, night: document.documentElement.hasAttribute('data-pinkie-night'), items: out};
}

const settle = (page) => page.waitForFunction(
  () => document.getAnimations().filter((a) => a instanceof CSSTransition).every((a) => a.playState !== 'running'),
  null, {timeout: 5000});
const fmt = (items) => items.map((i) => `${i.name} ${i.ink} on ${i.bg} ${i.ratio.toFixed(2)}`).join('; ');
const low = (items) => items.filter((i) => i.ratio < (i.kind === 'text' ? TEXT_MIN : ICON_MIN));

test('#261 项目模式：「临时」、工作程度芯片与箭头、「工具」按钮日夜 × 1440/820 对比度达标；贴回旧配方必须量出不合格', {timeout: 240_000}, async (t) => {
  let pw;
  try { pw = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  try { browser = await pw.webkit.launch({headless: true}); }
  catch (err) { t.skip(`WebKit is not installed: ${err.message.split('\n')[0]}`); return; }
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});

  const badByTheme = {day: [], night: []};
  for (const theme of ['day', 'night']) {
    for (const width of WIDTHS) {
      const good = []; const bad = [];
      for (const id of SCENES) {
        const {context, page} = await openRealScenePage(browser, server.origin, id, theme, {timezoneId: 'Asia/Shanghai'});
        try {
          await page.setViewportSize({width, height: 900});
          await page.waitForTimeout(400);
          await settle(page);
          const r = await page.evaluate(measure);
          assert.equal(r.mode, 'project', `${id} ${theme} ${width}: 不是项目模式`);
          assert.equal(r.night, theme === 'night', `${id} ${theme} ${width}: 日夜没切对`);
          good.push(...r.items.map((i) => ({...i, name: `${id}/${i.name}`})));

          await page.addStyleTag({content: OLD_RECIPE});
          await page.waitForTimeout(400);
          await settle(page);
          bad.push(...(await page.evaluate(measure)).items.map((i) => ({...i, name: `${id}/${i.name}`})));
        } finally {
          await context.close();
        }
      }
      const tag = `${theme} ${width}`;
      console.log(`ℹ ${tag}: ${fmt(good)}`);
      console.log(`ℹ ${tag} 旧配方: ${fmt(bad)}`);
      const names = new Set(good.map((i) => i.name.split('/')[1]));
      const required = width >= 1440
        ? ['临时·字', '临时·图标', '工作程度·字', '工作程度·箭头', '工具·字', '工具·图标']
        : ['工作程度·字', '工作程度·箭头', '工具·字', '工具·图标'];
      for (const n of required) assert.ok(names.has(n), `${tag}: 没量到「${n}」（量不到不能算通过） — ${fmt(good)}`);
      assert.deepEqual(low(good).map((i) => i.name), [], `${tag}: 对比度不够 — ${fmt(low(good))}`);
      for (const b of bad) {
        const g = good.find((i) => i.name === b.name);
        assert.ok(g && b.ratio < g.ratio, `${tag}: 旧配方没贴上「${b.name}」— 改后 ${g?.ratio.toFixed(2)}，旧配方 ${b.ratio.toFixed(2)}`);
      }
      badByTheme[theme].push(...bad.map((i) => ({...i, name: `${width}/${i.name}`})));
    }
    // 夜间 820 没有「临时」，旧配方下芯片和「工具」在夜间本来就达标（6.55 / 3.97 / 4.79），所以反例按日、夜各自汇总判断，不要求每一格都不达标。
    assert.ok(low(badByTheme[theme]).length >= 1, `${theme}: 反例没生效：贴回旧配方后仍全部达标 — ${fmt(badByTheme[theme])}`);
  }
});
