// M5 rework: real-page hotspot regression suite (10 user-visible checks).
// Runs against the real installed OpenClaw Control UI + Pinkie UI bundle
// (openclaw@<runtime-manifest> + tools/ui-parity/bundle.py + tools/assets/stamp.mjs
// + app/windows_bridge_scripts.py + scripts/chat-ui-harness/fake-gateway.js).
// Every test maps 1-to-1 to a high-churn hotspot in briefs/maintenance-1120/HOTSPOTS.md.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  VIEWPORT,
  assertRealPageLoaded,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';
import {decodePng} from './visual/lib/png-diff.mjs';

function meanPngLuminance(pngBuf) {
  const {width, height, data} = decodePng(pngBuf);
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y += 8) {
    for (let x = 0; x < width; x += 8) {
      const idx = (y * width + x) * 4;
      sum += relativeLuminance({r: data[idx], g: data[idx + 1], b: data[idx + 2]});
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

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

test('M5 real-page hotspot UI regression suite (10 checks on real Control UI)', async (t) => {
  let installed, server, browser;
  // B55: cleanup is registered before anything starts; a browser that failed to launch used to leave the
  // server listening, so the file never exited and windows-checks waited out its 30-minute limit.
  t.after(async () => {
    await browser?.close();
    await server?.close();
    installed?.cleanup();
  });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  await t.test('H1 [HOTSPOTS #5/#30]: Windows native window controls are unobstructed and do not overlap topbar controls', async () => {
    const {context, page, pageErrors, failedRequests} = await openRealScenePage(browser, server.origin, 'sidebar-expanded', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(failedRequests, []);
      await assertRealPageLoaded(page);

      const info = await page.evaluate(() => {
        const controls = document.getElementById('pinkie-native-window-controls');
        if (!controls) return {missing: true};
        const cRect = controls.getBoundingClientRect();
        const buttons = ['min', 'max', 'close'].map((act) => {
          const btn = controls.querySelector(`[data-act="${act}"]`);
          const r = btn?.getBoundingClientRect();
          const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
          return {
            act,
            present: Boolean(btn),
            rect: r ? {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height} : null,
            hitMatches: Boolean(btn && (hit === btn || btn.contains(hit))),
            hitDesc: hit ? `${hit.tagName}#${hit.id}.${hit.className}` : null,
          };
        });
        const topbarItems = [...document.querySelectorAll('.laolao-usage__chip, .chat-pane__header button, .dashboard-header button')]
          .filter((el) => {
            if (controls.contains(el)) return false;
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 && r.width > 4 && r.height > 4;
          })
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              desc: `${el.tagName}.${String(el.className || '').trim().split(/\s+/).slice(0, 2).join('.')}`,
              rect: {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height},
            };
          });
        return {
          missing: false,
          captionRect: {left: cRect.left, right: cRect.right, top: cRect.top, bottom: cRect.bottom, width: cRect.width, height: cRect.height},
          buttons,
          topbarItems,
        };
      });

      assert.equal(info.missing, false, '#pinkie-native-window-controls must be mounted by windows_bridge_scripts.py');
      assert.ok(info.captionRect.width >= 90 && info.captionRect.height >= 24, `invalid caption rect: ${JSON.stringify(info.captionRect)}`);
      for (const btn of info.buttons) {
        assert.equal(btn.present, true, `missing native caption button [data-act="${btn.act}"]`);
        assert.ok(btn.rect.width >= 20 && btn.rect.height >= 20, `caption button ${btn.act} collapsed: ${JSON.stringify(btn.rect)}`);
        assert.equal(btn.hitMatches, true, `caption button ${btn.act} is obscured at center by ${btn.hitDesc}`);
      }
      assert.ok(info.topbarItems.length > 0, 'expected visible topbar chips/buttons to check overlap against caption controls');
      for (const item of info.topbarItems) {
        assert.equal(
          rectsOverlap(item.rect, info.captionRect),
          false,
          `topbar element ${item.desc} overlaps #pinkie-native-window-controls: item=${JSON.stringify(item.rect)} caption=${JSON.stringify(info.captionRect)}`,
        );
      }
    } finally {
      await context.close();
    }
  });

  await t.test('H2 [HOTSPOTS #18/#30]: real sidebar width, session selection, and collapse expand chat-main', async () => {
    const {context, page, pageErrors, failedRequests} = await openRealScenePage(browser, server.origin, 'sidebar-expanded', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(failedRequests, []);
      await assertRealPageLoaded(page);

      const before = await page.evaluate(() => {
        const sidebar = document.querySelector('aside.nav, .shell-nav, .sidebar');
        const main = document.querySelector('.chat-main');
        const rows = [...document.querySelectorAll('#laolao-session-manager .session-row-host[data-session-key]')]
          .filter((el) => el.getBoundingClientRect().height > 10);
        return {
          sidebarW: sidebar ? sidebar.getBoundingClientRect().width : 0,
          mainW: main ? main.getBoundingClientRect().width : 0,
          rowCount: rows.length,
        };
      });
      assert.ok(
        before.sidebarW >= 210 && before.sidebarW <= 280,
        `real sidebar expanded width out of bounds [210, 280]: got ${before.sidebarW}px`,
      );
      assert.ok(before.rowCount >= 2, `expected >= 2 visible sessions in real #laolao-session-manager, got ${before.rowCount}`);

      const secondRow = page.locator('#laolao-session-manager .session-row-host[data-session-key]').nth(1);
      const targetKey = await secondRow.getAttribute('data-session-key');
      await secondRow.locator('a.sidebar-recent-session__link').click();
      await page.waitForFunction(
        (key) => new URLSearchParams(location.search).get('session') === key
          || document.querySelector('#laolao-session-manager .sidebar-recent-session--active')?.getAttribute('data-session-key') === key,
        targetKey,
        {timeout: 5_000},
      );

      const toggleSel = '.sidebar [data-pinkie-sidebar-toggle], .sidebar button[aria-label="折叠侧边栏"]';
      await page.waitForSelector(toggleSel, {timeout: 5_000});
      await page.click(toggleSel);
      await page.waitForFunction(
        () => document.documentElement.getAttribute('data-pinkie-sidebar-auto') === '1'
          || Boolean(document.querySelector('.sidebar.sidebar--collapsed')),
        {timeout: 5_000},
      );
      // 等侧栏收起的宽度过渡放完：轮询到 .chat-main 变宽超过 160px 为止；等不到不在这里报错，交给下面原有断言给出原来的失败信息。
      await page.waitForFunction(
        (w) => (document.querySelector('.chat-main')?.getBoundingClientRect().width || 0) > w + 160,
        before.mainW,
        {timeout: 5_000},
      ).catch(() => {});
      const after = await page.evaluate(() => {
        const main = document.querySelector('.chat-main');
        return {mainW: main ? main.getBoundingClientRect().width : 0};
      });
      assert.ok(
        after.mainW > before.mainW + 160,
        `collapsing sidebar must widen .chat-main by >160px: before=${before.mainW}px after=${after.mainW}px`,
      );
    } finally {
      await context.close();
    }
  });

  await t.test('H3 [HOTSPOTS #23]: real mode switcher opens menu in viewport and switches html[data-laolao-mode]', async () => {
    const {context, page, pageErrors, failedRequests} = await openRealScenePage(browser, server.origin, 'home-chat', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(failedRequests, []);
      await assertRealPageLoaded(page);

      const pre = await page.evaluate(() => {
        const btn = document.querySelector('.laolao-mode-switcher');
        if (!btn) return {missing: true};
        const r = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          missing: false,
          mode: document.documentElement.getAttribute('data-laolao-mode'),
          pe: getComputedStyle(btn).pointerEvents,
          hitMatches: hit === btn || btn.contains(hit),
        };
      });
      assert.equal(pre.missing, false, '.laolao-mode-switcher must be mounted on real page');
      assert.equal(pre.mode, 'chat');
      assert.notEqual(pre.pe, 'none', 'mode switcher pointer-events must not be none');
      assert.equal(pre.hitMatches, true, 'real mode switcher button must be hit-testable');

      await page.click('.laolao-mode-switcher');
      const menuRect = await page.evaluate(() => {
        const menu = document.querySelector('.laolao-mode-menu');
        if (!menu) return null;
        const r = menu.getBoundingClientRect();
        return r.width > 0 && r.height > 0
          ? {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height}
          : null;
      });
      assert.ok(menuRect, 'clicking .laolao-mode-switcher must open .laolao-mode-menu');
      assert.ok(
        menuRect.left >= 0 && menuRect.top >= 0 && menuRect.right <= VIEWPORT.width && menuRect.bottom <= VIEWPORT.height,
        `real mode menu out of viewport: ${JSON.stringify(menuRect)}`,
      );

      await page.click('.laolao-mode-menu [data-mode="project"], .laolao-mode-menu button:has-text("项目模式")');
      await page.waitForFunction(
        () => document.documentElement.getAttribute('data-laolao-mode') === 'project',
        {timeout: 10_000},
      );
    } finally {
      await context.close();
    }
  });

  await t.test('H4 [HOTSPOTS #30/#1]: real composer textarea and send button are unobstructed and accept input', async () => {
    const {context, page, pageErrors, failedRequests} = await openRealScenePage(browser, server.origin, 'sidebar-expanded', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(failedRequests, []);
      await assertRealPageLoaded(page);

      const inputLoc = page.locator('.agent-chat__composer-combobox textarea').first();
      await inputLoc.waitFor({state: 'visible', timeout: 5_000});

      const beforeGeom = await page.evaluate(() => {
        const ta = document.querySelector('.agent-chat__composer-combobox textarea');
        const r = ta.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          rect: {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height},
          hitMatches: hit === ta || ta.contains(hit),
          hitDesc: hit ? `${hit.tagName}#${hit.id}.${hit.className}` : null,
        };
      });
      assert.ok(beforeGeom.rect.height >= 24 && beforeGeom.rect.width >= 200, `composer textarea invalid rect: ${JSON.stringify(beforeGeom.rect)}`);
      assert.ok(beforeGeom.rect.bottom <= VIEWPORT.height, `composer textarea clipped below viewport: ${JSON.stringify(beforeGeom.rect)}`);
      assert.equal(beforeGeom.hitMatches, true, `composer textarea obscured at center by ${beforeGeom.hitDesc}`);

      await inputLoc.click();
      await inputLoc.fill('M5 真实页面热点回归输入检查');
      assert.equal(await inputLoc.inputValue(), 'M5 真实页面热点回归输入检查');

      const sendGeom = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('.agent-chat__input .chat-send-btn')];
        const send = btns.find((b) => (
          !b.classList.contains('chat-send-btn--stop')
          && !b.classList.contains('chat-send-btn--laolao-dictation')
          && !b.classList.contains('chat-send-btn--voice')
          && b.getBoundingClientRect().width > 0
        )) || btns.find((b) => b.getBoundingClientRect().width > 0);
        if (!send) return {missing: true};
        const r = send.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          missing: false,
          rect: {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height},
          hitMatches: hit === send || send.contains(hit),
          hitDesc: hit ? `${hit.tagName}#${hit.id}.${hit.className}` : null,
        };
      });
      assert.equal(sendGeom.missing, false, 'real send button must be present');
      assert.equal(sendGeom.hitMatches, true, `real send button obscured at center by ${sendGeom.hitDesc}`);
    } finally {
      await context.close();
    }
  });

  await t.test('H5 [HOTSPOTS #10]: real long conversation in .chat-thread preserves scrollTop across live updates', async () => {
    const {context, page, pageErrors, failedRequests} = await openRealScenePage(browser, server.origin, 'long-conversation', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(failedRequests, []);
      await assertRealPageLoaded(page);

      const scrollCheck = await page.evaluate(async () => {
        const thread = document.querySelector('.chat-thread');
        if (!thread) return {missing: true};
        // Ensure content exceeds viewport height for scrolling test
        if (thread.scrollHeight <= thread.clientHeight + 200) {
          for (let i = 0; i < 6; i += 1) {
            const group = document.createElement('div');
            group.className = 'chat-group user';
            group.innerHTML = `<div class="chat-bubble"><div class="chat-text">长对话滚动保持探针消息 #${i + 1}：验证真实 .chat-thread 在尾部追加内容时不会跳回顶部。</div></div>`;
            thread.appendChild(group);
          }
        }
        const targetTop = Math.min(220, Math.floor((thread.scrollHeight - thread.clientHeight) / 2));
        thread.scrollTop = targetTop;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const before = thread.scrollTop;

        const tail = document.createElement('div');
        tail.className = 'chat-group assistant';
        tail.innerHTML = '<div class="chat-bubble"><div class="chat-text">尾部追加一条更新消息。</div></div>';
        thread.appendChild(tail);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const after = thread.scrollTop;
        return {
          missing: false,
          scrollHeight: thread.scrollHeight,
          clientHeight: thread.clientHeight,
          targetTop,
          before,
          after,
        };
      });

      assert.equal(scrollCheck.missing, false, 'real .chat-thread must exist');
      assert.ok(scrollCheck.scrollHeight > scrollCheck.clientHeight + 100, `thread must be scrollable: ${JSON.stringify(scrollCheck)}`);
      assert.ok(Math.abs(scrollCheck.before - scrollCheck.targetTop) <= 4, `initial scrollTop drifted: ${JSON.stringify(scrollCheck)}`);
      assert.ok(Math.abs(scrollCheck.after - scrollCheck.before) <= 4, `scrollTop jumped across DOM update: ${scrollCheck.before} -> ${scrollCheck.after}`);
    } finally {
      await context.close();
    }
  });

  await t.test('H6 [HOTSPOTS #17]: real context compact / viewer popover opens inside viewport with clickable action', async () => {
    const {context, page, pageErrors, failedRequests} = await openRealScenePage(browser, server.origin, 'long-conversation', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(failedRequests, []);
      await assertRealPageLoaded(page);

      const triggerSel = 'details.laolao-context-viewer > summary';
      const trigger = page.locator(triggerSel).first();
      await trigger.waitFor({state: 'visible', timeout: 10_000});
      await trigger.click();
      // 等弹层挂到 body 上（details 的 toggle 事件是异步的，laolao-context-compact.js 在那里才加 is-floating）
      // 且它自己的 lcv-pop 入场动画（.18s，带 translate/scale，会影响量到的矩形）放完，再量位置。
      // 等不到也不在这里报错：下面原有断言会给出原来的失败信息。
      await page.waitForFunction(() => {
        const el = document.querySelector('.laolao-context-viewer__popover.is-floating');
        return Boolean(el) && el.getAnimations().every((a) => a.playState !== 'running');
      }, null, {timeout: 5_000}).catch(() => {});

      const pop = await page.evaluate(() => {
        const el = document.querySelector('.laolao-context-viewer__popover.is-floating, details.laolao-context-viewer[open] .laolao-context-viewer__popover');
        if (!el) return {missing: true};
        const r = el.getBoundingClientRect();
        const btn = el.querySelector('.laolao-context-viewer__compact, button');
        const br = btn ? btn.getBoundingClientRect() : null;
        const hit = br ? document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2) : null;
        return {
          missing: false,
          rect: {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height},
          hasButton: Boolean(btn),
          btnHit: Boolean(btn && (hit === btn || btn.contains(hit))),
          hitDesc: hit ? `${hit.tagName}#${hit.id}.${hit.className}` : null,
        };
      });

      assert.equal(pop.missing, false, 'clicking details.laolao-context-viewer > summary must open context popover on real page');
      assert.ok(pop.rect.width > 120 && pop.rect.height > 40, `context popover invalid size: ${JSON.stringify(pop.rect)}`);
      assert.ok(
        pop.rect.left >= 0 && pop.rect.top >= 0 && pop.rect.right <= VIEWPORT.width && pop.rect.bottom <= VIEWPORT.height,
        `real context popover clipped outside viewport: ${JSON.stringify(pop.rect)}`,
      );
      assert.equal(pop.hasButton, true, 'context popover must contain .laolao-context-viewer__compact button');
      assert.equal(pop.btnHit, true, `context popover action button obscured by ${pop.hitDesc}`);
    } finally {
      await context.close();
    }
  });

  await t.test('H7 [HOTSPOTS #29/#28]: real study desk renders non-overlapping quiz options and selects choice on click', async () => {
    const {context, page, pageErrors, failedRequests} = await openRealScenePage(browser, server.origin, 'study-desk', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(failedRequests, []);
      await assertRealPageLoaded(page);

      const rects = await page.evaluate(() => (
        [...document.querySelectorAll('.pk-drill .pk-drill-options .pk-choice')].map((el, idx) => {
          const r = el.getBoundingClientRect();
          return {idx, text: el.textContent?.trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height};
        })
      ));
      assert.equal(rects.length, 4, `real study desk must render 4 options, got ${rects.length}`);
      for (let i = 0; i < rects.length; i += 1) {
        assert.ok(rects[i].width > 80 && rects[i].height >= 28, `option ${i} invalid rect: ${JSON.stringify(rects[i])}`);
        for (let j = i + 1; j < rects.length; j += 1) {
          assert.equal(rectsOverlap(rects[i], rects[j]), false, `study desk options ${i} and ${j} overlap`);
        }
      }

      await page.locator('.pk-drill .pk-drill-options .pk-choice').nth(1).click();
      const selected = await page.evaluate(() => ({
        choices: [...document.querySelectorAll('.pk-drill .pk-drill-options .pk-choice')].map((el) => (
          el.classList.contains('is-on') || el.getAttribute('aria-pressed') === 'true'
        )),
        checkDisabled: document.querySelector('.pk-drill-check')?.getAttribute('aria-disabled'),
      }));
      assert.equal(selected.choices[1], true, `clicking 2nd real study desk option must select it: ${JSON.stringify(selected)}`);
      assert.notEqual(selected.checkDisabled, 'true', 'selecting an answer must enable .pk-drill-check');
    } finally {
      await context.close();
    }
  });

  await t.test('H8 [HOTSPOTS #23/#30]: real Metre skin removes pink cast, mounts .pk-metre-board, and keeps footer buttons clickable', async () => {
    const {context, page, pageErrors, failedRequests} = await openRealScenePage(browser, server.origin, 'metre-board', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(failedRequests, []);
      await assertRealPageLoaded(page);

      const info = await page.evaluate(() => {
        const bg = getComputedStyle(document.body).backgroundColor;
        const board = document.querySelector('.pk-metre-board');
        const slots = board ? board.querySelectorAll('.pk-metre-board__card[data-metre-slot]').length : 0;
        const footer = document.querySelector('.sidebar-footer-bar');
        const settingsBtn = document.querySelector('.sidebar-footer-bar a.sidebar-footer-icon[aria-label="设置"], .sidebar-footer-bar .laolao-footer-more');
        const sr = settingsBtn?.getBoundingClientRect();
        const hit = sr ? document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2) : null;
        return {
          mode: document.documentElement.getAttribute('data-laolao-mode'),
          bg,
          hasBoard: Boolean(board && !board.hidden && board.getBoundingClientRect().height > 120),
          slots,
          footerPe: footer ? getComputedStyle(footer).pointerEvents : null,
          settingsPe: settingsBtn ? getComputedStyle(settingsBtn).pointerEvents : null,
          settingsHit: Boolean(settingsBtn && (hit === settingsBtn || settingsBtn.contains(hit))),
          hitDesc: hit ? `${hit.tagName}#${hit.id}.${hit.className}` : null,
        };
      });

      assert.equal(info.mode, 'metre');
      assert.equal(info.hasBoard, true, 'real .pk-metre-board must be rendered with non-zero height');
      assert.ok(info.slots >= 3, `expected >= 3 Metre board slots, got ${info.slots}`);
      const rgb = parseRgb(info.bg);
      assert.ok(rgb, `unable to parse real Metre body background: ${info.bg}`);
      assert.ok(
        rgb.r - rgb.b < 25 && Math.abs(rgb.r - rgb.g) < 15,
        `real Metre body background should be neutral (no pink cast), got ${info.bg}`,
      );
      if (info.footerPe !== null) {
        assert.equal(info.footerPe, 'none', '.sidebar-footer-bar must keep pointer-events: none');
      }
      assert.equal(info.settingsPe, 'auto', 'real settings footer button must keep pointer-events: auto');
      assert.equal(info.settingsHit, true, `real settings button in Metre obscured by ${info.hitDesc}`);
    } finally {
      await context.close();
    }
  });

  await t.test('H9 [HOTSPOTS #14/#30]: real tool/process cards stay within .chat-thread width and toggle expand/collapse', async () => {
    const {context, page, pageErrors, failedRequests} = await openRealScenePage(browser, server.origin, 'long-conversation', 'day');
    try {
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(failedRequests, []);
      await assertRealPageLoaded(page);

      const layout = await page.evaluate(() => {
        const thread = document.querySelector('.chat-thread');
        const tr = thread?.getBoundingClientRect();
        const cards = [...document.querySelectorAll('.chat-thread details.pinkie-process, .chat-thread .chat-group.tool')];
        return {
          threadRight: tr ? tr.right : 0,
          cards: cards.map((el) => {
            const r = el.getBoundingClientRect();
            return {
              tag: el.tagName,
              cls: String(el.className || ''),
              right: r.right,
              width: r.width,
              height: r.height,
            };
          }),
        };
      });

      assert.ok(layout.cards.length >= 2, `expected >= 2 real process/tool cards in long-conversation, got ${layout.cards.length}`);
      for (const c of layout.cards) {
        assert.ok(
          c.right <= layout.threadRight + 2,
          `real tool card (${c.tag}.${c.cls}) overflows .chat-thread right edge: ${c.right} > ${layout.threadRight}`,
        );
      }

      // Finished tool groups are folded behind the real C.le. run row (button.cle-run,
      // ui/injections/cle-ink.js). Opening it must reveal the tool row, the tool row
      // must expand its own detail, and both must fold back to the original height.
      const group = page.locator('.chat-thread .chat-group.tool').filter({has: page.locator('button.cle-run')}).first();
      const runRow = group.locator('button.cle-run').first();
      await runRow.waitFor({state: 'visible', timeout: 5_000});
      const groupH = async () => group.evaluate((el) => el.getBoundingClientRect().height);
      const foldedH = await groupH();
      assert.equal(await runRow.getAttribute('aria-expanded'), 'false', 'finished tool group must start folded');
      await runRow.click();
      await page.waitForFunction((el) => el.getAttribute('aria-expanded') === 'true', await runRow.elementHandle(), {timeout: 5_000});
      // 下面几处展开 / 收起：轮询到高度满足和原有断言同一个条件为止（展开、收起可能带过渡）；
      // 等不到不在这里报错，交给原有断言给出原来的失败信息。
      const settle = async (loc, fn, arg) => page.waitForFunction(fn, [await loc.elementHandle(), arg], {timeout: 5_000}).catch(() => {});
      await settle(group, ([el, h]) => el.getBoundingClientRect().height > h + 10, foldedH);
      const openH = await groupH();
      assert.ok(openH > foldedH + 10, `clicking real button.cle-run must unfold the tool group: folded=${foldedH}, open=${openH}`);

      const toolRow = group.locator('.chat-tool-msg-collapse').first();
      const summaryBtn = toolRow.locator('button.chat-tool-msg-summary').first();
      await summaryBtn.waitFor({state: 'visible', timeout: 5_000});
      const beforeH = await toolRow.evaluate((el) => el.getBoundingClientRect().height);
      await summaryBtn.click();
      await settle(toolRow, ([el, h]) => el.getBoundingClientRect().height > h + 10, beforeH);
      const expandedH = await toolRow.evaluate((el) => el.getBoundingClientRect().height);
      assert.ok(
        expandedH > beforeH + 10,
        `clicking real button.chat-tool-msg-summary must expand tool detail: before=${beforeH}, after=${expandedH}`,
      );
      const detailRight = await toolRow.evaluate((el) => el.getBoundingClientRect().right);
      assert.ok(detailRight <= layout.threadRight + 2, `expanded tool detail overflows .chat-thread: ${detailRight} > ${layout.threadRight}`);
      await summaryBtn.click();
      await settle(toolRow, ([el, h]) => Math.abs(el.getBoundingClientRect().height - h) <= 2, beforeH);
      const collapsedH = await toolRow.evaluate((el) => el.getBoundingClientRect().height);
      assert.ok(
        Math.abs(collapsedH - beforeH) <= 2,
        `clicking real button.chat-tool-msg-summary again must collapse back: before=${beforeH}, collapsed=${collapsedH}`,
      );
      await runRow.click();
      await settle(group, ([el, h]) => el.querySelector('button.cle-run')?.getAttribute('aria-expanded') === 'false'
        && Math.abs(el.getBoundingClientRect().height - h) <= 2, foldedH);
      assert.equal(await runRow.getAttribute('aria-expanded'), 'false', 'clicking button.cle-run again must fold the group');
      const refoldedH = await groupH();
      assert.ok(Math.abs(refoldedH - foldedH) <= 2, `tool group must fold back: folded=${foldedH}, refolded=${refoldedH}`);
    } finally {
      await context.close();
    }
  });

  await t.test('H10 [HOTSPOTS #27/#30]: real night mode drops luminance, mounts pinkie-buddy, and keeps model picker readable in viewport', async () => {
    const dayCtx = await openRealScenePage(browser, server.origin, 'model-picker', 'day');
    let dayLum;
    try {
      assert.deepEqual(dayCtx.pageErrors, []);
      assert.deepEqual(dayCtx.failedRequests, []);
      await assertRealPageLoaded(dayCtx.page);
      const dayShot = await dayCtx.page.screenshot({animations: 'disabled', caret: 'hide', type: 'png'});
      dayLum = meanPngLuminance(dayShot);
    } finally {
      await dayCtx.context.close();
    }

    const nightCtx = await openRealScenePage(browser, server.origin, 'model-picker', 'night');
    try {
      assert.deepEqual(nightCtx.pageErrors, []);
      assert.deepEqual(nightCtx.failedRequests, []);
      await assertRealPageLoaded(nightCtx.page);

      const nightShot = await nightCtx.page.screenshot({animations: 'disabled', caret: 'hide', type: 'png'});
      const nightLum = meanPngLuminance(nightShot);

      const nightInfo = await nightCtx.page.evaluate(() => {
        const menu = document.querySelector('.chat-controls__inline-select-menu--combined');
        const buddy = document.querySelector('.pinkie-buddy');
        const r = menu?.getBoundingClientRect();
        const ms = menu ? getComputedStyle(menu) : null;
        return {
          nightAttr: document.documentElement.hasAttribute('data-pinkie-night'),
          hasBuddy: Boolean(buddy && buddy.getBoundingClientRect().width > 20),
          hasMenu: Boolean(menu && r && r.width > 100 && r.height > 40),
          menuBg: ms?.backgroundColor || '',
          menuColor: ms?.color || '',
          rect: r ? {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height} : null,
        };
      });

      assert.equal(nightInfo.nightAttr, true, 'real page must have html[data-pinkie-night] in night theme');
      assert.equal(nightInfo.hasBuddy, true, 'real .pinkie-buddy must be mounted on composer');
      assert.equal(nightInfo.hasMenu, true, 'real model picker menu must be open');
      assert.ok(
        dayLum > 0.5 && nightLum < 0.25 && nightLum < dayLum * 0.4,
        `real night mode must sharply drop rendered luminance: day=${dayLum.toFixed(3)}, night=${nightLum.toFixed(3)}`,
      );
      assert.ok(
        nightInfo.rect.left >= 0 && nightInfo.rect.top >= 0
        && nightInfo.rect.right <= VIEWPORT.width && nightInfo.rect.bottom <= VIEWPORT.height,
        `real night model picker out of viewport: ${JSON.stringify(nightInfo.rect)}`,
      );

      const menuFg = parseRgb(nightInfo.menuColor);
      const menuBg = parseRgb(nightInfo.menuBg);
      if (menuFg && menuBg && !/rgba\([^)]*,\s*0\s*\)/.test(nightInfo.menuBg)) {
        const ratio = contrastRatio(menuFg, menuBg);
        assert.ok(ratio >= 4.5, `real night model picker text contrast too low: ${ratio.toFixed(2)}:1 (fg=${nightInfo.menuColor}, bg=${nightInfo.menuBg})`);
      }
    } finally {
      await nightCtx.context.close();
    }
  });
});
