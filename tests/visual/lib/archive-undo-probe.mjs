// 非 Metre 归档撤销条（laolao-sidebar.js showArchiveUndo）真页面量法，tests/archive-undo-dodge-real.test.mjs 与 tools/pr-shots/b11-archive-undo.mjs 共用。
// 触发：侧栏会话行聚焦后按 Delete（laolao-session-list.js → archiveWithUndo），夹具网关对 sessions.patch / lineage 回 {}，不改真数据。
// 量：「撤销」字色对撤销条底色的对比度；撤销条和输入框外壳、外壳里每个可见按钮 / 输入框的相交面积；是否在屏内。
// 反例：routeOld 把页面拿到的 laolao-sidebar.css / .js 换回改前写法（字色 var(--accent)、不避让）。

export const NEW_DAY_COLOR = 'color:color-mix(in srgb,var(--accent,#d9508d) 70%,#44343c)';
export const OLD_DAY_COLOR = 'color:var(--accent,#d9508d)';
export const NEW_NIGHT_RULE = 'html[data-pinkie-night] .pinkie-archive-undo button{color:var(--accent,#ff7fb3)}';
export const LIFT_JS = /const shell=document\.documentElement\.dataset\.laolaoMode!=='metre'[^\n]*?'px';/;
export const SCENES = Object.freeze({project: 'sidebar-expanded', unrestricted: 'home-unrestricted'});

export async function routeOld(context) {
  const swapped = {css: 0, js: 0};
  await context.route(/\/laolao-sidebar\.css(\?|$)/, async (route) => {
    const res = await route.fetch();
    let text = await res.text();
    if (text.includes(NEW_DAY_COLOR) && text.includes(NEW_NIGHT_RULE)) {
      text = text.replace(NEW_DAY_COLOR, OLD_DAY_COLOR).replace(NEW_NIGHT_RULE, '');
      swapped.css++;
    }
    await route.fulfill({response: res, body: text});
  });
  await context.route(/\/laolao-sidebar\.js(\?|$)/, async (route) => {
    const res = await route.fetch();
    let text = await res.text();
    if (LIFT_JS.test(text)) { text = text.replace(LIFT_JS, ''); swapped.js++; }
    await route.fulfill({response: res, body: text});
  });
  return swapped;
}

// 窄宽下侧栏是抽屉：先点原生「展开侧边栏」，等侧栏滑到 x >= 0（同 l29-metre-undo.mjs）
export async function openDrawer(page) {
  const drawer = await page.evaluate(() => Math.round(document.querySelector('aside.sidebar')?.getBoundingClientRect().left ?? -9999) < 0);
  if (drawer) {
    await page.click('button[aria-label="展开侧边栏"]');
    await page.waitForFunction(() => document.querySelector('aside.sidebar')?.getBoundingClientRect().left >= 0, null, {timeout: 5_000});
    await page.waitForTimeout(400);
  }
  return drawer;
}

const ROWS = 'aside.sidebar #laolao-session-manager .session-row-host[data-session-key]';

// 挑看得见、不是当前会话的行，聚焦它的链接按 Delete；人格行等不响应 Delete 的就换下一行，最多试 5 行。
export async function archiveOneRow(page) {
  await page.waitForSelector(`${ROWS} a.sidebar-recent-session__link`, {state: 'attached', timeout: 15_000});
  const count = await page.evaluate((sel) => {
    const seen = (n) => { const r = n.getBoundingClientRect(), s = getComputedStyle(n); return n.getClientRects().length > 0 && r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && s.visibility !== 'hidden'; };
    const active = (n) => n.classList.contains('sidebar-recent-session--active') || !!n.querySelector('.sidebar-recent-session--active');
    const rows = [...document.querySelectorAll(sel)].filter((n) => !n.classList.contains('pinkie-session-part') && n.querySelector('a.sidebar-recent-session__link') && seen(n));
    rows.sort((a, b) => Number(active(a)) - Number(active(b)));
    rows.forEach((n, i) => { n.dataset.b11UndoPick = String(i); });
    return rows.length;
  }, ROWS);
  for (let i = 0; i < Math.min(count, 5); i++) {
    const key = await page.evaluate((i) => {
      const row = document.querySelector(`[data-b11-undo-pick="${i}"]`);
      row?.querySelector('a.sidebar-recent-session__link')?.focus();
      return row?.dataset.sessionKey || '';
    }, i);
    if (!key) continue;
    await page.keyboard.press('Delete');
    const shown = await page.waitForSelector('.pinkie-archive-undo', {timeout: 3_000}).then(() => true, () => false);
    if (shown) { await page.waitForTimeout(250); return key; }
  }
  throw new Error(`侧栏里没有能按 Delete 归档的会话行（看得见的 ${count} 行）`);
}

export const measureUndo = (page) => page.evaluate(() => {
  const rgb = (s) => {
    const n = (String(s).match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    if (/^color\(srgb\s/.test(s)) return n.map((v, i) => (i < 3 ? v * 255 : v));
    if (/^rgba?\(/.test(s)) return n;
    throw new Error(`读不懂的颜色格式：${s}`);
  };
  const over = (f, b) => [0, 1, 2].map((i) => f[i] * (f[3] ?? 1) + b[i] * (1 - (f[3] ?? 1)));
  const lum = (c) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const box = (n) => { const r = n.getBoundingClientRect(); return {left: r.left, top: r.top, right: r.right, bottom: r.bottom}; };
  const area = (a, c) => Math.max(0, Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top)) * Math.max(0, Math.min(a.right, c.right) - Math.max(a.left, c.left));
  const round = (r) => r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)]));
  const vis = (n) => { const r = n.getBoundingClientRect(), s = getComputedStyle(n); return r.width >= 2 && r.height >= 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const bar = document.querySelector('.pinkie-archive-undo');
  if (!bar) return null;
  const btn = bar.querySelector('button');
  const bg = over(rgb(getComputedStyle(bar).backgroundColor), [255, 255, 255]);
  const ink = over(rgb(getComputedStyle(btn).color), bg);
  const b = box(bar);
  const shell = document.querySelector('.agent-chat__composer-shell');
  const targets = shell ? [...shell.querySelectorAll('button, textarea, input, select, [role="button"], [contenteditable="true"]')].filter(vis) : [];
  const hits = targets.map((n) => ({what: n.getAttribute('aria-label') || n.textContent.trim().slice(0, 12) || n.tagName.toLowerCase(), area: Math.round(area(b, box(n)))})).filter((h) => h.area > 0);
  return {
    mode: document.documentElement.dataset.laolaoMode, night: document.documentElement.hasAttribute('data-pinkie-night'),
    text: bar.textContent, buttonColor: getComputedStyle(btn).color, background: getComputedStyle(bar).backgroundColor,
    ratio: Math.round(ratio(ink, bg) * 100) / 100,
    bar: round(b), shell: shell ? round(box(shell)) : null, shellOverlap: shell ? Math.round(area(b, box(shell))) : null,
    targets: targets.length, hits, inlineBottom: bar.style.bottom || '',
    onScreen: b.left >= 0 && b.top >= 0 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1,
  };
});
