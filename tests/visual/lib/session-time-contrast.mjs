// 真页面侧栏高亮会话行时间（.sidebar-recent-session--active .pinkie-session-time）的对比度量法（B11·S5，macdev5）。
// - 计算：computed 字色 × 祖先透明度，叠在祖先背景层逐层合成的实际底上，算 WCAG 对比。
// - 像素：有字截一张、把字藏掉再截一张，逐列取最大对比，按 binPx 分箱取最浅箱（与 effort-tier-ink 同一量法）。
import {decodePng} from './png-diff.mjs';
import {openRealScenePage} from './real-harness.mjs';

export const TIME = 'aside.sidebar #laolao-session-manager .sidebar-recent-session--active .pinkie-session-time';

function seedChatHistory() {
  const t = Date.now();
  const text = (s) => [{type: 'text', text: s}];
  window.__fakeSeedHistory = [
    {role: 'user', content: text('帮我整理一下周末去郊外露营要带的东西。'), timestamp: t - 300_000},
    {role: 'assistant', stopReason: 'stop', timestamp: t - 240_000, content: text('## 露营清单\n\n1. 帐篷')},
  ];
}

// home-chat 点进第一条对话，让侧栏出现高亮行；820 宽侧栏是抽屉，先展开（同 tests/metre-workspace-real.test.mjs 的 openMetre）。
export async function openActiveRow(browser, origin, theme, width) {
  const opened = await openRealScenePage(browser, origin, 'home-chat', theme, {timezoneId: 'Asia/Shanghai', initScript: seedChatHistory});
  const {page} = opened;
  await page.setViewportSize({width, height: 800});
  const item = page.locator('.laolao-startup-home__item').first();
  await item.waitFor({state: 'visible', timeout: 10_000});
  await item.click();
  await page.waitForSelector(TIME, {state: 'attached', timeout: 10_000});
  const left = await page.evaluate(() => Math.round(document.querySelector('aside.sidebar')?.getBoundingClientRect().left ?? -9999));
  if (left < 0) {
    await page.click('button[aria-label="展开侧边栏"]');
    await page.waitForFunction(() => document.querySelector('aside.sidebar')?.getBoundingClientRect().left >= 0, null, {timeout: 5_000});
    // 保留死等：上面只等到抽屉进窗口，滑入过渡还要放完再截图。
    await page.waitForTimeout(300);
  }
  // 鼠标移开侧栏：悬停时时间会被藏掉（laolao-sidebar.css:470）。
  await page.mouse.move(width - 10, 790);
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.x >= 0 && getComputedStyle(el).display !== 'none';
  }), TIME, {timeout: 5_000});
  return opened;
}

// 看得见的高亮行时间：有字、没被藏、整块在窗口里。
export async function visibleTimes(page, width) {
  return (await computedTimes(page)).filter((r) => r.text && r.display !== 'none' && r.box.width > 0 && r.box.x >= 0 && r.box.x + r.box.width <= width);
}

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

export function palest(withBuf, withoutBuf, binPx) {
  const A = decodePng(withBuf), B = decodePng(withoutBuf), cols = [];
  const at = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
  for (let x = 0; x < A.width; x++) {
    let best = 1, n = 0;
    for (let y = 0; y < A.height; y++) { const r = contrast(at(A, x, y), at(B, x, y)); if (r > 1.15) n++; if (r > best) best = r; }
    cols.push(n >= 2 ? best : 0);
  }
  const step = Math.max(2, Math.round(binPx)), bins = [];
  for (let x = 0; x < cols.length; x += step) { const s = cols.slice(x, x + step).filter(Boolean); if (s.length >= Math.max(2, step * 0.4)) bins.push(Math.max(...s)); }
  return bins.length ? Math.min(...bins) : 1;
}

// 每个高亮行时间一项：{text, color, opacity, ink, bg, ratio, box}
export async function computedTimes(page) {
  const rows = await page.evaluate((sel) => {
    const parse = (s) => {
      let m = s.match(/rgba?\(([^)]+)\)/);
      if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
      m = s.match(/color\(srgb ([^)]+)\)/);
      if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
      return [0, 0, 0, 0];
    };
    const put = (top, under, a) => [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a));
    return [...document.querySelectorAll(sel)].map((t) => {
      const layers = [];
      let op = 1;
      for (let n = t; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        op *= Number(cs.opacity);
        const c = parse(cs.backgroundColor);
        if (n !== t && c[3] > 0) layers.push(c);
        if (c[3] >= 0.999) break;
      }
      let bg = [255, 255, 255];
      for (const c of layers.reverse()) bg = put(c, bg, c[3]);
      const s = getComputedStyle(t);
      const fg = parse(s.color);
      const r = t.getBoundingClientRect();
      return {text: t.textContent.trim(), color: s.color, opacity: op, display: s.display, bg, ink: put(fg, bg, fg[3] * op), box: {x: r.x, y: r.y, width: r.width, height: r.height}};
    });
  }, TIME);
  return rows.map((r) => ({...r, bg: r.bg.map(Math.round), ink: r.ink.map(Math.round), ratio: contrast(r.ink.map(Math.round), r.bg.map(Math.round))}));
}

export async function pixelTime(page, box, {binPx = 4} = {}) {
  const clip = {x: Math.max(0, box.x - 2), y: Math.max(0, box.y - 2), width: box.width + 4, height: box.height + 4};
  const a = await page.screenshot({clip, animations: 'disabled'});
  const hide = await page.addStyleTag({content: `${TIME}{color:transparent!important;-webkit-text-fill-color:transparent!important}`});
  const b = await page.screenshot({clip, animations: 'disabled'});
  await hide.evaluate((n) => n.remove());
  return palest(a, b, binPx);
}

// 反例：注回 origin/main@b8fcd5be 的写法——日间 --sb-muted 不透明（laolao-sidebar-surface.css:7），
// 夜间继承行色再叠 laolao-sidebar.css:467 的 .56。
export const REVERT_CSS = [
  `html:not([data-pinkie-night]):not(#_r1):not(#_r2):not(#_r3) ${TIME}{color:var(--sb-muted)!important;opacity:1!important}`,
  `html[data-pinkie-night]:not(#_r1):not(#_r2):not(#_r3) ${TIME}{color:inherit!important;opacity:.56!important}`,
].join('\n');
