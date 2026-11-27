// #261 项目模式走查 #1 + #7/#8/#9（issuecomment-7193531313），作品库与查看器：
// #1 Windows 窗口键胶囊不能盖住作品库搜索框、关闭钮和查看器右侧按钮（项目模式 + 无限制模式，见 #96 7196834032）；
// #7 说明行 / 卡片来源 / 「从作品库移除」字 ≥4.5；#8 关闭钮 × ≥4.5、版本分隔点 ≥3；
// #9 筛选胶囊 / 查看器按钮 / 搜索框边框 ≥3，搜索框 placeholder ≥4.5。1440/820 × 日/夜，按实际绘制底色合成计算。
import assert from 'node:assert/strict';
import test, {after, before, describe} from 'node:test';
import {
  REPO_ROOT,
  assertRealPageLoaded,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const HEIGHT = 800;
const WIDTHS = [1440, 820];

const initScript = () => {
  const item = {id: 'a1b2', kind: 'doc', title: '单词表.txt', path: 'C:/work/单词表.txt', mode: 'project', sessionKey: '',
    createdAt: 0, updatedAt: 0, exists: true, size: 2048, version: 3, total: 3,
    versions: [1, 2, 3].map((v) => ({v, ts: 0, size: 2048, runId: '', source: 'tool', snapshot: true}))};
  const answers = {
    'pinkie.artifacts.list': {ok: true, items: [item], cursor: null},
    'pinkie.artifacts.get': {ok: true, item},
    'pinkie.artifacts.read': {ok: true, v: 3, size: 40, mime: 'text/plain', encoding: 'utf8', data: 'apple 苹果'},
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
  window.__artTestItem = item;
};

function probe({cover, text, dots, edges, placeholder}) {
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
  const textRatio = (node, color) => { const bg = backdrop(node, true); return ratio(over(ink(node, color), bg), bg); };
  const out = {cover: [], text: [], dots: [], edges: [], placeholder: []};
  const caption = document.getElementById('pinkie-native-window-controls');
  const cr = caption && caption.getBoundingClientRect();
  for (const sel of cover) {
    const node = document.querySelector(sel);
    if (!node) { out.cover.push({sel, missing: true}); continue; }
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const overlap = !!cr && r.left < cr.right && r.right > cr.left && r.top < cr.bottom && r.bottom > cr.top;
    out.cover.push({sel, overlap, hitSelf: hit === node || node.contains(hit), hit: hit ? `${hit.tagName}#${hit.id}.${hit.className}` : null,
      rect: [r.left, r.top, r.right, r.bottom].map(Math.round), caption: cr ? [cr.left, cr.top, cr.right, cr.bottom].map(Math.round) : null});
  }
  for (const [key, list] of [['text', text], ['dots', dots]]) {
    for (const sel of list) {
      const node = document.querySelector(sel);
      out[key].push(node ? {sel, ratio: textRatio(node, getComputedStyle(node).color)} : {sel, missing: true});
    }
  }
  for (const sel of edges) {
    const node = document.querySelector(sel);
    if (!node) { out.edges.push({sel, missing: true}); continue; }
    const outer = backdrop(node, false);
    const inner = over(parse(getComputedStyle(node).backgroundColor), outer);
    const edge = ink(node, getComputedStyle(node).borderTopColor);
    out.edges.push({sel, ratio: Math.min(ratio(over(edge, outer), outer), ratio(over(edge, inner), inner)), edge: getComputedStyle(node).borderTopColor, bg: getComputedStyle(node).backgroundColor, outer: outer.map(Math.round).join(","), active: document.activeElement === node});
  }
  for (const sel of placeholder) {
    const node = document.querySelector(sel);
    out.placeholder.push(node ? {sel, ratio: textRatio(node, getComputedStyle(node, '::placeholder').color)} : {sel, missing: true});
  }
  return out;
}

const LIBRARY = {
  cover: ['.pinkie-art-page .pinkie-art-search', '.pinkie-art-page .pinkie-art-close'],
  text: ['.pinkie-art-page .pinkie-art-note', '.pinkie-art-page .pinkie-art-card__meta', '.pinkie-art-page .pinkie-art-close'],
  dots: [],
  edges: ['.pinkie-art-page .pinkie-art-chip[aria-pressed="false"]', '.pinkie-art-page .pinkie-art-search'],
  placeholder: ['.pinkie-art-page .pinkie-art-search'],
};
const VIEWER = {
  cover: ['.pinkie-art-view .pinkie-art-btn--quiet'],
  text: ['.pinkie-art-view .pinkie-art-btn--quiet'],
  dots: ['.pinkie-art-view .pinkie-art-versions__dot'],
  edges: ['.pinkie-art-view .pinkie-art-btn:not(.pinkie-art-btn--quiet)'],
  placeholder: [],
};

function collect(where, result, problems) {
  for (const item of result.cover) {
    if (item.missing || item.overlap || !item.hitSelf) problems.push(`${where} 遮挡 ${JSON.stringify(item)}`);
  }
  for (const [key, min] of [['text', 4.5], ['dots', 3], ['edges', 3], ['placeholder', 4.5]]) {
    for (const item of result[key]) {
      if (item.missing || !(item.ratio >= min)) problems.push(`${where} ${key}<${min} ${item.sel} ${item.missing ? "missing" : item.ratio} ${item.edge ? JSON.stringify({edge: item.edge, bg: item.bg, outer: item.outer, active: item.active}) : ""}`);
    }
  }
}

// 同一页面换宽度：等窗口键胶囊跟到新右缘、两帧；作品库与查看器每个宽度都从关闭状态重开，
// 焦点落点、遮挡与配色全部按新宽度重新量，不沿用上一宽度的布局。
async function measureAt(page, width, where, problems) {
  await page.setViewportSize({width, height: HEIGHT});
  await page.waitForFunction((w) => {
    const caption = document.getElementById('pinkie-native-window-controls');
    return caption && Math.abs(caption.getBoundingClientRect().right - w) < 40;
  }, width, {timeout: 10_000});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => window.PinkieArtifacts.open());
  await page.waitForSelector('.pinkie-art-page .pinkie-art-card__meta', {timeout: 10_000});
  await page.waitForFunction(() => document.activeElement?.matches('.pinkie-art-search') && document.getAnimations().every((a) => a.playState !== 'running'), null, {timeout: 10_000});
  collect(`${where} 作品库`, await page.evaluate(probe, LIBRARY), problems);
  await page.evaluate(() => document.activeElement?.blur());
  collect(`${where} 作品库静止态`, await page.evaluate(probe, {cover: [], text: [], dots: [], edges: ['.pinkie-art-page .pinkie-art-search'], placeholder: []}), problems);
  await page.evaluate(() => window.PinkieArtifacts.openViewer(window.__artTestItem.id));
  await page.waitForSelector('.pinkie-art-view .pinkie-art-btn--quiet', {timeout: 10_000});
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, {timeout: 10_000});
  collect(`${where} 查看器`, await page.evaluate(probe, VIEWER), problems);
  await page.evaluate(() => {
    document.querySelector('.pinkie-art-viewer .pinkie-art-close')?.click();
    window.PinkieArtifacts.close();
  });
  await page.waitForFunction(() => !document.querySelector('.pinkie-art-viewer, .pinkie-art-page'), null, {timeout: 10_000});
}

describe('真浏览器（server / browser 全文件复用一次）', () => {
  let installed = null;
  let server = null;
  let browser = null;
  before(async () => {
    installed = installRealControlUi({repoRoot: REPO_ROOT});
    server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
    browser = await launchRealBrowser();
  }, {timeout: 120_000});
  after(async () => {
    await browser?.close();
    await server?.close();
    installed?.cleanup();
  });

  test('作品库与查看器：窗口键不遮挡、说明字 / 关闭钮 / 边框对比度达标', {timeout: 240_000}, async (t) => {
    const problems = [];
    for (const scene of ['settings', 'home-unrestricted']) {
      for (const theme of ['day', 'night']) {
        const started = Date.now();
        const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, scene, theme, {initScript});
        try {
          await assertRealPageLoaded(page);
          await page.waitForFunction(() => window.__laolaoSidebar?.gwRequest?.__art === true, null, {timeout: 15_000});
          for (const width of WIDTHS) await measureAt(page, width, `${scene}/${theme}/${width}`, problems);
          assert.deepEqual(pageErrors, [], `${scene}/${theme} pageerror`);
        } finally {
          await context.close();
        }
        t.diagnostic(`${scene}/${theme} 用时 ${Date.now() - started}ms`);
      }
    }
    assert.deepEqual(problems, []);
  });
});
