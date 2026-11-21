// M5 real-page hotspot regression suite (10 user-visible checks).
// Every test maps 1-to-1 to a high-churn hotspot in HOTSPOTS.md and verifies
// real browser geometry, hit-testing, computed styles, and interactive state.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VIEWPORT,
  launchVisualBrowser,
  openScenePage,
  startVisualServer,
} from './visual/lib/harness.mjs';

function parseRgb(colorStr) {
  const m = String(colorStr || '').match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!m) return null;
  return {r: Number(m[1]), g: Number(m[2]), b: Number(m[3])};
}

function relativeLuminance({r, g, b}) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(c1, c2) {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

test('M5 real-page hotspot UI regression suite (10 checks mapped to HOTSPOTS.md)', async (t) => {
  const server = await startVisualServer();
  const browser = await launchVisualBrowser();

  t.after(async () => {
    await browser.close();
    await server.close();
  });

  await t.test('H1 [HOTSPOTS #5/#30]: Windows titlebar caption buttons do not overlap topbar actions', async () => {
    const {context, page, pageErrors} = await openScenePage(browser, server.origin, 'home-project', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      const info = await page.evaluate(() => {
        const caption = document.getElementById('pinkie-native-caption').getBoundingClientRect();
        const actions = ['#m5-new-chat-btn', '#m5-export-btn'].map((sel) => {
          const el = document.querySelector(sel);
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return {
            sel,
            rect: {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height},
            hitMatches: hit === el || el.contains(hit),
            hitId: hit?.id || hit?.tagName || null,
          };
        });
        return {
          caption: {left: caption.left, right: caption.right, top: caption.top, bottom: caption.bottom},
          actions,
        };
      });

      for (const btn of info.actions) {
        assert.ok(btn.rect.width > 0 && btn.rect.height > 0, `${btn.sel} must be visible`);
        assert.equal(
          rectsOverlap(btn.rect, info.caption),
          false,
          `${btn.sel} overlaps #pinkie-native-caption: btn=${JSON.stringify(btn.rect)} caption=${JSON.stringify(info.caption)}`,
        );
        assert.equal(btn.hitMatches, true, `${btn.sel} was obscured at its center by ${btn.hitId}`);
      }
    } finally {
      await context.close();
    }
  });

  await t.test('H2 [HOTSPOTS #18/#30]: sidebar width, session selection, and collapse layout', async () => {
    const {context, page, pageErrors} = await openScenePage(browser, server.origin, 'sidebar-expanded', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      const expandedWidth = await page.locator('#m5-sidebar').evaluate((el) => el.getBoundingClientRect().width);
      assert.ok(
        expandedWidth >= 220 && expandedWidth <= 320,
        `sidebar expanded width out of bounds [220, 320]: got ${expandedWidth}px`,
      );

      await page.locator('.m5-session-row').nth(1).click();
      const activeIdx = await page.evaluate(() =>
        [...document.querySelectorAll('.m5-session-row')].findIndex((r) => r.classList.contains('is-active')),
      );
      assert.equal(activeIdx, 1, 'clicking second session row must activate it');

      await page.locator('#m5-collapse-btn').click();
      const collapsed = await page.evaluate(() => ({
        sidebarW: document.getElementById('m5-sidebar').getBoundingClientRect().width,
        mainW: document.querySelector('.m5-main').getBoundingClientRect().width,
      }));
      assert.ok(collapsed.sidebarW <= 2, `collapsed sidebar must be <= 2px, got ${collapsed.sidebarW}px`);
      assert.ok(collapsed.mainW >= VIEWPORT.width - 10, `main area must expand when sidebar collapses, got ${collapsed.mainW}px`);
    } finally {
      await context.close();
    }
  });

  await t.test('H3 [HOTSPOTS #23]: mode switcher button is clickable and switches data-laolao-mode', async () => {
    const {context, page, pageErrors} = await openScenePage(browser, server.origin, 'home-chat', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      const pre = await page.evaluate(() => {
        const btn = document.getElementById('m5-mode-btn');
        const r = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          mode: document.documentElement.getAttribute('data-laolao-mode'),
          pe: getComputedStyle(btn).pointerEvents,
          hitMatches: hit === btn || btn.contains(hit),
        };
      });
      assert.equal(pre.mode, 'chat');
      assert.notEqual(pre.pe, 'none', 'mode switcher pointer-events must not be none');
      assert.equal(pre.hitMatches, true, 'mode switcher button must be hit-testable');

      await page.locator('#m5-mode-btn').click();
      const menuRect = await page.locator('#m5-mode-menu').evaluate((el) => {
        if (el.hidden) return null;
        const r = el.getBoundingClientRect();
        return {left: r.left, right: r.right, top: r.top, bottom: r.bottom};
      });
      assert.ok(menuRect, 'mode switcher menu must open on click');
      assert.ok(
        menuRect.left >= 0 && menuRect.top >= 0 && menuRect.right <= VIEWPORT.width && menuRect.bottom <= VIEWPORT.height,
        `mode menu out of viewport: ${JSON.stringify(menuRect)}`,
      );

      await page.locator('#m5-mode-menu [data-target-mode="project"]').click();
      const after = await page.evaluate(() => ({
        mode: document.documentElement.getAttribute('data-laolao-mode'),
        menuHidden: document.getElementById('m5-mode-menu').hidden,
      }));
      assert.equal(after.mode, 'project', 'clicking project mode must update html[data-laolao-mode]');
      assert.equal(after.menuHidden, true, 'mode menu must close after selection');
    } finally {
      await context.close();
    }
  });

  await t.test('H4 [HOTSPOTS #30/#1]: composer textarea and send button are unobstructed and accept input', async () => {
    const {context, page, pageErrors} = await openScenePage(browser, server.origin, 'home-project', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      const geom = await page.evaluate(() => {
        const input = document.getElementById('m5-input');
        const send = document.getElementById('m5-send-btn');
        const ir = input.getBoundingClientRect();
        const sr = send.getBoundingClientRect();
        const ihit = document.elementFromPoint(ir.left + ir.width / 2, ir.top + ir.height / 2);
        const shit = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2);
        return {
          ir: {left: ir.left, right: ir.right, top: ir.top, bottom: ir.bottom, height: ir.height},
          sr: {left: sr.left, right: sr.right, top: sr.top, bottom: sr.bottom},
          inputHit: ihit === input,
          sendHit: shit === send,
        };
      });
      assert.ok(geom.ir.height >= 40, `composer input too short: ${geom.ir.height}px`);
      assert.ok(geom.ir.bottom <= VIEWPORT.height, `composer input clipped below viewport: bottom=${geom.ir.bottom}`);
      assert.equal(geom.inputHit, true, 'composer input is obscured by an overlay');
      assert.equal(geom.sendHit, true, 'send button is obscured by an overlay');

      await page.locator('#m5-input').click();
      await page.locator('#m5-input').fill('M5 热点回归检查');
      assert.equal(await page.locator('#m5-input').inputValue(), 'M5 热点回归检查');
    } finally {
      await context.close();
    }
  });

  await t.test('H5 [HOTSPOTS #10]: long conversation preserves scroll position across UI state updates', async () => {
    const {context, page, pageErrors} = await openScenePage(browser, server.origin, 'long-conversation', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      const scrollCheck = await page.evaluate(() => {
        const stage = document.getElementById('m5-stage');
        const thread = document.getElementById('m5-chat-thread');
        for (let i = 0; i < 8; i += 1) {
          const d = document.createElement('div');
          d.className = 'm5-msg m5-msg--user';
          d.innerHTML = `<div class="m5-msg-body">历史消息 #${i + 1}：用于验证长对话滚动位置不会在局部更新后跳回顶部。</div>`;
          thread.appendChild(d);
        }
        stage.scrollTop = 220;
        const before = stage.scrollTop;
        const tail = document.createElement('div');
        tail.className = 'm5-msg m5-msg--assistant';
        tail.innerHTML = '<div class="m5-msg-body">尾部追加的续读消息。</div>';
        thread.appendChild(tail);
        const after = stage.scrollTop;
        return {scrollHeight: stage.scrollHeight, clientHeight: stage.clientHeight, before, after};
      });
      assert.ok(scrollCheck.scrollHeight > scrollCheck.clientHeight + 200, 'stage must be scrollable');
      assert.ok(Math.abs(scrollCheck.before - 220) <= 2, `initial scrollTop should be ~220, got ${scrollCheck.before}`);
      assert.ok(
        Math.abs(scrollCheck.after - scrollCheck.before) <= 2,
        `scrollTop jumped after DOM update: ${scrollCheck.before} -> ${scrollCheck.after}`,
      );
    } finally {
      await context.close();
    }
  });

  await t.test('H6 [HOTSPOTS #17]: context compact button opens an in-viewport confirmation popover', async () => {
    const {context, page, pageErrors} = await openScenePage(browser, server.origin, 'long-conversation', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      await page.locator('#m5-compact-btn').click();
      const pop = await page.evaluate(() => {
        const el = document.getElementById('m5-compact-popover');
        const confirm = document.getElementById('m5-compact-confirm');
        const r = el.getBoundingClientRect();
        const cr = confirm.getBoundingClientRect();
        const hit = document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
        return {
          hidden: el.hidden,
          rect: {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height},
          confirmHit: hit === confirm,
        };
      });
      assert.equal(pop.hidden, false, 'compact popover must open');
      assert.ok(
        pop.rect.left >= 0 && pop.rect.top >= 0 && pop.rect.right <= VIEWPORT.width && pop.rect.bottom <= VIEWPORT.height,
        `compact popover clipped outside viewport: ${JSON.stringify(pop.rect)}`,
      );
      assert.equal(pop.confirmHit, true, 'compact confirm button must be clickable');
    } finally {
      await context.close();
    }
  });

  await t.test('H7 [HOTSPOTS #29/#28]: study desk renders question card and selectable answer options', async () => {
    const {context, page, pageErrors} = await openScenePage(browser, server.origin, 'study-desk', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      const rects = await page.evaluate(() =>
        [...document.querySelectorAll('.m5-desk-opt')].map((el) => {
          const r = el.getBoundingClientRect();
          return {opt: el.dataset.opt, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height};
        }),
      );
      assert.equal(rects.length, 4, 'study desk must render 4 answer options');
      for (let i = 0; i < rects.length; i += 1) {
        assert.ok(rects[i].width > 80 && rects[i].height >= 32, `option ${rects[i].opt} has invalid size`);
        for (let j = i + 1; j < rects.length; j += 1) {
          assert.equal(rectsOverlap(rects[i], rects[j]), false, `options ${rects[i].opt} and ${rects[j].opt} overlap`);
        }
      }

      await page.locator('.m5-desk-opt[data-opt="B"]').click();
      const selected = await page.evaluate(() =>
        [...document.querySelectorAll('.m5-desk-opt.is-selected')].map((el) => el.dataset.opt),
      );
      assert.deepEqual(selected, ['B'], 'clicking option B must select only B');
    } finally {
      await context.close();
    }
  });

  await t.test('H8 [HOTSPOTS #23/#30]: Metre skin removes pink cast, shows board, and keeps footer buttons clickable', async () => {
    const {context, page, pageErrors} = await openScenePage(browser, server.origin, 'metre-board', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      const info = await page.evaluate(() => {
        const bg = getComputedStyle(document.body).backgroundColor;
        const footer = document.querySelector('.sidebar-footer-bar');
        const settingsBtn = document.getElementById('m5-settings-btn');
        const sr = settingsBtn.getBoundingClientRect();
        const hit = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2);
        const slots = document.querySelectorAll('[data-metre-board="1"] .m5-metre-slot').length;
        return {
          bg,
          footerPe: getComputedStyle(footer).pointerEvents,
          settingsPe: getComputedStyle(settingsBtn).pointerEvents,
          settingsHit: hit === settingsBtn,
          slots,
        };
      });

      assert.equal(info.slots, 3, 'Metre board must render 3 slot cards');
      const rgb = parseRgb(info.bg);
      assert.ok(rgb, `unable to parse Metre body background: ${info.bg}`);
      assert.ok(
        rgb.r - rgb.b < 25 && Math.abs(rgb.r - rgb.g) < 15,
        `Metre body background should be neutral (no pink cast), got ${info.bg}`,
      );
      assert.equal(info.footerPe, 'none', '.sidebar-footer-bar must keep pointer-events: none');
      assert.equal(info.settingsPe, 'auto', 'footer button must keep pointer-events: auto');
      assert.equal(info.settingsHit, true, '#m5-settings-btn must be clickable');
    } finally {
      await context.close();
    }
  });

  await t.test('H9 [HOTSPOTS #14/#30]: tool process cards stay within stage width and toggle expand/collapse', async () => {
    const {context, page, pageErrors} = await openScenePage(browser, server.origin, 'long-conversation', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      const layout = await page.evaluate(() => {
        const stageR = document.getElementById('m5-stage').getBoundingClientRect();
        const cards = [...document.querySelectorAll('.chat-tool-card')].map((el) => {
          const r = el.getBoundingClientRect();
          return {open: el.open, right: r.right, width: r.width};
        });
        return {stageRight: stageR.right, cards};
      });
      assert.ok(layout.cards.length >= 3, `expected >= 3 tool cards, got ${layout.cards.length}`);
      for (const c of layout.cards) {
        assert.ok(c.right <= layout.stageRight + 1, `tool card overflows stage right edge: ${c.right} > ${layout.stageRight}`);
      }

      const secondSummary = page.locator('.chat-tool-card').nth(1).locator('summary');
      await secondSummary.click();
      const expanded = await page.locator('.chat-tool-card').nth(1).evaluate((el) => ({
        open: el.open,
        bodyH: el.querySelector('.m5-tool-body').getBoundingClientRect().height,
      }));
      assert.equal(expanded.open, true, 'clicking collapsed tool card summary must expand it');
      assert.ok(expanded.bodyH > 0, 'expanded tool card body must have non-zero height');

      await secondSummary.click();
      const collapsed = await page.locator('.chat-tool-card').nth(1).evaluate((el) => el.open);
      assert.equal(collapsed, false, 'clicking expanded tool card summary must collapse it');
    } finally {
      await context.close();
    }
  });

  await t.test('H10 [HOTSPOTS #27/#30]: night mode drops background luminance and keeps model picker readable in viewport', async () => {
    const dayCtx = await openScenePage(browser, server.origin, 'model-picker', 'day');
    const nightCtx = await openScenePage(browser, server.origin, 'model-picker', 'night');
    try {
      assert.deepEqual(dayCtx.pageErrors, []);
      assert.deepEqual(nightCtx.pageErrors, []);
      const dayBg = await dayCtx.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const nightInfo = await nightCtx.page.evaluate(() => {
        const menu = document.querySelector('.m5-model-menu');
        const r = menu.getBoundingClientRect();
        const ms = getComputedStyle(menu);
        return {
          bodyBg: getComputedStyle(document.body).backgroundColor,
          menuBg: ms.backgroundColor,
          menuColor: ms.color,
          rect: {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height},
        };
      });

      const dayLum = relativeLuminance(parseRgb(dayBg));
      const nightLum = relativeLuminance(parseRgb(nightInfo.bodyBg));
      assert.ok(dayLum > 0.8, `day background luminance too dark: ${dayLum.toFixed(3)} (${dayBg})`);
      assert.ok(nightLum < 0.15, `night background luminance too bright: ${nightLum.toFixed(3)} (${nightInfo.bodyBg})`);
      assert.ok(
        nightInfo.rect.left >= 0 && nightInfo.rect.top >= 0
        && nightInfo.rect.right <= VIEWPORT.width && nightInfo.rect.bottom <= VIEWPORT.height,
        `night model picker menu out of viewport: ${JSON.stringify(nightInfo.rect)}`,
      );
      const ratio = contrastRatio(parseRgb(nightInfo.menuColor), parseRgb(nightInfo.menuBg));
      assert.ok(ratio >= 4.5, `night model picker text contrast too low: ${ratio.toFixed(2)}:1`);
    } finally {
      await dayCtx.context.close();
      await nightCtx.context.close();
    }
  });
});
