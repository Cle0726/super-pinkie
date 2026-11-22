// M3 rework differential & product regression tests:
// Runs identical DOM MutationObserver and timer scenarios against the browser's
// native APIs and the real ui/injections/laolao-dom-watch.js (no mocks/stubs),
// plus loads the unmodified ui/injections/laolao-learning-reminder.js product script.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DOM_WATCH_SRC = fs.readFileSync(path.join(REPO_ROOT, 'ui/injections/laolao-dom-watch.js'), 'utf8');
const LEARNING_REMINDER_SRC = fs.readFileSync(path.join(REPO_ROOT, 'ui/injections/laolao-learning-reminder.js'), 'utf8');

async function launchBrowser() {
  const {chromium} = playwright();
  const engine = process.env.PINKIE_VISUAL_ENGINE || '';
  const opts = {headless: true};
  if (engine === 'msedge' || engine === 'chrome') {
    return chromium.launch({...opts, channel: engine});
  }
  const attempts = [opts, {...opts, channel: 'chrome'}, {...opts, channel: 'msedge'}];
  let lastError;
  for (const attempt of attempts) {
    try {
      return await chromium.launch(attempt);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function runPair(browser, body) {
  const out = {};
  for (const kind of ['native', 'shared']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message || String(err)));
    try {
      await page.setContent('<!doctype html><html><head></head><body></body></html>');
      if (kind === 'shared') {
        await page.addScriptTag({content: DOM_WATCH_SRC});
      }
      const value = await page.evaluate(async ({mode, script}) => {
        window.__timeoutCalls = 0;
        const rawSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (...args) => {
          window.__timeoutCalls += 1;
          return rawSetTimeout(...args);
        };
        const wait = (ms) => new Promise((resolve) => rawSetTimeout(resolve, ms));
        const add = (tag = 'div') => document.body.appendChild(document.createElement(tag));
        const mk = (cb) => mode === 'shared'
          ? window.Pinkie.domWatch.createObserver(cb)
          : new MutationObserver(cb);
        const startPoll = (fn, ms) => {
          if (mode === 'shared') {
            const handle = window.Pinkie.domWatch.poll(fn, ms);
            return () => handle.stop();
          }
          const id = window.setInterval(fn, ms);
          return () => window.clearInterval(id);
        };
        const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
        const runner = new AsyncFn('wait', 'add', 'mk', 'startPoll', 'mode', script);
        return runner(wait, add, mk, startPoll, mode);
      }, {mode: kind, script: body});
      out[kind] = {value, pageErrors};
    } finally {
      await context.close();
    }
  }
  return out;
}

test('M3 differential: domWatch observers and polling match native browser APIs', async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());

  await t.test('multi-target observe and mixed observe+watch do not overwrite earlier targets', async () => {
    const res = await runPair(browser, `
      const a = add(), b = add();
      const hits = [];
      const o = mk((recs) => {
        for (const r of recs) hits.push({type: r.type, target: r.target === a ? 'a' : r.target === b ? 'b' : 'other', attr: r.attributeName});
      });
      o.observe(a, {attributes: true, attributeFilter: ['data-a']});
      if (mode === 'shared') o.watch(b, {childList: true});
      else o.observe(b, {childList: true, subtree: true});
      a.setAttribute('data-a', '1');
      a.setAttribute('data-ignored', '1');
      b.append('x');
      await wait(40);
      o.disconnect();
      return hits;
    `);
    assert.deepEqual(res.shared.pageErrors, res.native.pageErrors);
    assert.deepEqual(res.shared.value, res.native.value);
    assert.equal(res.shared.value.length, 2);
  });

  await t.test('re-observing the same target replaces options without losing earlier queued records', async () => {
    const res = await runPair(browser, `
      const a = add();
      const events = [];
      const o = mk((recs) => {
        for (const r of recs) events.push({type: r.type, attr: r.attributeName});
      });
      o.observe(a, {childList: true});
      a.append('before');
      o.observe(a, {attributes: true, attributeFilter: ['data-keep']});
      a.append('after');
      a.setAttribute('data-skip', '1');
      a.setAttribute('data-keep', '2');
      await wait(40);
      o.disconnect();
      return events;
    `);
    assert.deepEqual(res.shared.pageErrors, res.native.pageErrors);
    assert.deepEqual(res.shared.value, res.native.value);
    assert.deepEqual(res.shared.value, [
      {type: 'childList', attr: null},
      {type: 'attributes', attr: 'data-keep'},
    ]);
  });

  await t.test('disconnect discards pending records and disconnect->mutate->observe does not self-trigger', async () => {
    const res = await runPair(browser, `
      const a = add();
      let droppedCalls = 0;
      const d = mk(() => { droppedCalls += 1; });
      d.observe(a, {childList: true});
      a.append('discard-me');
      d.disconnect();
      await wait(30);

      const b = add();
      let loopCalls = 0;
      let o;
      o = mk(() => {
        loopCalls += 1;
        if (loopCalls > 40) return;
        o.disconnect();
        b.append('self');
        o.observe(b, {childList: true});
      });
      o.observe(b, {childList: true});
      b.append('seed');
      await wait(200);
      o.disconnect();
      return {droppedCalls, loopCalls};
    `);
    assert.deepEqual(res.shared.pageErrors, res.native.pageErrors);
    assert.deepEqual(res.shared.value, res.native.value);
    assert.deepEqual(res.shared.value, {droppedCalls: 0, loopCalls: 1});
  });

  await t.test('observe ignores mutations that happened before registration without dropping records for existing observers', async () => {
    const res = await runPair(browser, `
      const a = add();
      let existingCount = 0;
      let lateCount = 0;
      const existing = mk((recs) => { existingCount += recs.length; });
      existing.observe(a, {childList: true, attributes: true, subtree: true});
      a.append('before');
      a.setAttribute('data-k', 'before');
      const late = mk((recs) => { lateCount += recs.length; });
      late.observe(a, {childList: true, attributes: true, subtree: true});
      await wait(40);
      a.setAttribute('data-k', 'after');
      await wait(40);
      existing.disconnect();
      late.disconnect();
      return {existingCount, lateCount};
    `);
    assert.deepEqual(res.shared.pageErrors, res.native.pageErrors);
    assert.deepEqual(res.shared.value, res.native.value);
    assert.deepEqual(res.shared.value, {existingCount: 3, lateCount: 1});
  });

  await t.test('takeRecords returns queued records, clears queue, and does not steal records from other observers', async () => {
    const res = await runPair(browser, `
      const a = add();
      let o1Cb = 0, o2Cb = 0;
      const o1 = mk(() => { o1Cb += 1; });
      const o2 = mk((recs) => { o2Cb += recs.length; });
      o1.observe(a, {childList: true});
      o2.observe(a, {childList: true});
      a.append('x');
      a.append('y');
      const firstTake = o1.takeRecords();
      const secondTake = o1.takeRecords();
      await wait(40);
      o1.disconnect();
      o2.disconnect();
      return {
        firstTakeLen: firstTake.length,
        secondTakeLen: secondTake.length,
        isMutationRecord: firstTake.every((r) => r instanceof MutationRecord),
        o1Cb,
        o2Cb,
      };
    `);
    assert.deepEqual(res.shared.pageErrors, res.native.pageErrors);
    assert.deepEqual(res.shared.value, res.native.value);
    assert.deepEqual(res.shared.value, {
      firstTakeLen: 2,
      secondTakeLen: 0,
      isMutationRecord: true,
      o1Cb: 0,
      o2Cb: 2,
    });
  });

  await t.test('all options including oldValue, empty attributeFilter, characterData, and invalid option TypeErrors match native', async () => {
    const res = await runPair(browser, `
      const a = add();
      const txt = document.createTextNode('init');
      a.append(txt);

      const withOld = [];
      const oOld = mk((recs) => {
        for (const r of recs) withOld.push({type: r.type, attr: r.attributeName, oldValue: r.oldValue});
      });
      oOld.observe(a, {attributeOldValue: true, characterDataOldValue: true, subtree: true});

      const withoutOld = [];
      const oPlain = mk((recs) => {
        for (const r of recs) withoutOld.push({type: r.type, attr: r.attributeName, oldValue: r.oldValue});
      });
      oPlain.observe(a, {attributes: true, characterData: true, subtree: true});

      let emptyFilterCount = 0;
      const oEmpty = mk(() => { emptyFilterCount += 1; });
      oEmpty.observe(a, {attributeFilter: []});

      a.setAttribute('data-v', '1');
      a.setAttribute('data-v', '2');
      txt.data = 'next';
      await wait(40);
      oOld.disconnect();
      oPlain.disconnect();
      oEmpty.disconnect();

      const invalidThrows = [];
      const oErr = mk(() => {});
      for (const bad of [
        {},
        {attributes: false, attributeFilter: ['id']},
        {attributes: false, attributeOldValue: true},
        {characterData: false, characterDataOldValue: true},
      ]) {
        try {
          oErr.observe(a, bad);
          invalidThrows.push('no-throw');
        } catch (err) {
          invalidThrows.push(err.name);
        }
      }

      return {withOld, withoutOld, emptyFilterCount, invalidThrows};
    `);
    assert.deepEqual(res.shared.pageErrors, res.native.pageErrors);
    assert.deepEqual(res.shared.value, res.native.value);
    assert.deepEqual(res.shared.value.withOld, [
      {type: 'attributes', attr: 'data-v', oldValue: null},
      {type: 'attributes', attr: 'data-v', oldValue: '1'},
      {type: 'characterData', attr: null, oldValue: 'init'},
    ]);
    assert.deepEqual(res.shared.value.withoutOld, [
      {type: 'attributes', attr: 'data-v', oldValue: null},
      {type: 'attributes', attr: 'data-v', oldValue: null},
      {type: 'characterData', attr: null, oldValue: null},
    ]);
    assert.equal(res.shared.value.emptyFilterCount, 0);
    assert.deepEqual(res.shared.value.invalidThrows, ['TypeError', 'TypeError', 'TypeError', 'TypeError']);
  });

  await t.test('detached targets, detached-after-observe targets, shadowRoot, document, and documentElement without subtree match native', async () => {
    const res = await runPair(browser, `
      const detached = document.createElement('div');
      let detachedCalls = 0;
      const oDetached = mk(() => { detachedCalls += 1; });
      oDetached.observe(detached, {childList: true});
      detached.append('x');

      const host = add();
      const shadow = host.attachShadow({mode: 'open'});
      const shadowInner = shadow.appendChild(document.createElement('span'));
      let shadowCalls = 0, shadowInnerCalls = 0;
      const oShadow = mk(() => { shadowCalls += 1; });
      oShadow.observe(shadow, {childList: true});
      const oShadowInner = mk(() => { shadowInnerCalls += 1; });
      oShadowInner.observe(shadowInner, {attributes: true});
      shadow.append(document.createElement('b'));
      shadowInner.setAttribute('data-s', '1');

      const docElDesc = add();
      let htmlNoSubtreeChild = 0, htmlNoSubtreeAttr = 0, docNoSubtree = 0;
      const oHtmlChild = mk(() => { htmlNoSubtreeChild += 1; });
      oHtmlChild.observe(document.documentElement, {childList: true});
      const oHtmlAttr = mk(() => { htmlNoSubtreeAttr += 1; });
      oHtmlAttr.observe(document.documentElement, {attributes: true});
      const oDoc = mk(() => { docNoSubtree += 1; });
      oDoc.observe(document, {childList: true});

      const willDetach = add();
      let afterDetachCalls = 0;
      const oAfterDetach = mk(() => { afterDetachCalls += 1; });
      oAfterDetach.observe(willDetach, {childList: true});

      await wait(30);
      docElDesc.append('descendant');
      document.documentElement.setAttribute('data-html-direct', '1');
      willDetach.remove();
      await wait(40);
      willDetach.append('mutated-while-detached');
      await wait(40);

      oDetached.disconnect();
      oShadow.disconnect();
      oShadowInner.disconnect();
      oHtmlChild.disconnect();
      oHtmlAttr.disconnect();
      oDoc.disconnect();
      oAfterDetach.disconnect();

      return {
        detachedCalls,
        shadowCalls,
        shadowInnerCalls,
        htmlNoSubtreeChild,
        htmlNoSubtreeAttr,
        docNoSubtree,
        afterDetachCalls,
      };
    `);
    assert.deepEqual(res.shared.pageErrors, res.native.pageErrors);
    assert.deepEqual(res.shared.value, res.native.value);
    assert.deepEqual(res.shared.value, {
      detachedCalls: 1,
      shadowCalls: 1,
      shadowInnerCalls: 1,
      htmlNoSubtreeChild: 0,
      htmlNoSubtreeAttr: 1,
      docNoSubtree: 0,
      afterDetachCalls: 1,
    });
  });

  await t.test('removed-before-delivery, moved-between-subtrees, and transient observers match native', async () => {
    const res = await runPair(browser, `
      const a = add(), c = add();
      const b1 = document.createElement('i');
      const b2 = document.createElement('i');
      const b3 = document.createElement('i');
      a.append(b1, b2, b3);
      await wait(20);

      let aAttrRecords = 0, cAttrRecords = 0;
      const oA = mk((recs) => { aAttrRecords += recs.length; });
      const oC = mk((recs) => { cAttrRecords += recs.length; });
      oA.observe(a, {attributes: true, subtree: true});
      oC.observe(c, {attributes: true, subtree: true});

      // 1. Mutate b1 then remove b1 before delivery
      b1.setAttribute('data-step', '1');
      b1.remove();

      // 2. Mutate b2 while in a, then move b2 to c before delivery
      b2.setAttribute('data-step', '2');
      c.append(b2);

      // 3. Remove b3 from a, then mutate b3 in the same microtask (transient observer)
      b3.remove();
      b3.setAttribute('data-step', '3');

      await wait(40);
      oA.disconnect();
      oC.disconnect();
      return {aAttrRecords, cAttrRecords};
    `);
    assert.deepEqual(res.shared.pageErrors, res.native.pageErrors);
    assert.deepEqual(res.shared.value, res.native.value);
    assert.deepEqual(res.shared.value, {aAttrRecords: 3, cAttrRecords: 0});
  });

  await t.test('observer callback exceptions are reported to console/pageerror and do not block other observers', async () => {
    const res = await runPair(browser, `
      const a = add();
      let secondCalls = 0;
      const o1 = mk(() => { throw new Error('m3-observer-boom'); });
      const o2 = mk(() => { secondCalls += 1; });
      o1.observe(a, {childList: true});
      o2.observe(a, {childList: true});
      a.append('boom');
      await wait(40);
      o1.disconnect();
      o2.disconnect();
      return {secondCalls};
    `);
    assert.deepEqual(res.shared.value, res.native.value);
    assert.equal(res.shared.value.secondCalls, 1);
    assert.ok(res.native.pageErrors.some((e) => e.includes('m3-observer-boom')), `native pageErrors: ${JSON.stringify(res.native.pageErrors)}`);
    assert.ok(res.shared.pageErrors.some((e) => e.includes('m3-observer-boom')), `shared pageErrors: ${JSON.stringify(res.shared.pageErrors)}`);
  });

  await t.test('polling runs normally while document.hidden is true (both poll and every)', async () => {
    const hidden = await runPair(browser, `
      Object.defineProperty(document, 'hidden', {get: () => true, configurable: true});
      let ticks = 0;
      const stop = startPoll(() => { ticks += 1; }, 100);
      let everyTicks = 0;
      const stopEvery = mode === 'shared'
        ? (() => { const h = window.Pinkie.domWatch.every(100, () => { everyTicks += 1; }); return () => h.stop(); })()
        : (() => { const id = window.setInterval(() => { everyTicks += 1; }, 100); return () => window.clearInterval(id); })();
      await wait(1100);
      stop();
      stopEvery();
      return {ticks, everyTicks};
    `);
    assert.ok(hidden.native.value.ticks >= 8, `native hidden ticks=${hidden.native.value.ticks}`);
    assert.ok(hidden.shared.value.ticks >= 8, `shared hidden ticks=${hidden.shared.value.ticks}`);
    assert.ok(hidden.native.value.everyTicks >= 8, `native everyTicks=${hidden.native.value.everyTicks}`);
    assert.ok(hidden.shared.value.everyTicks >= 8, `shared everyTicks=${hidden.shared.value.everyTicks}`);
  });

  await t.test('late short interval registered after long interval wakes up on its own cadence', async () => {
    const lateShort = await runPair(browser, `
      const stopLong = startPoll(() => {}, 5000);
      await wait(20);
      let ticks = 0;
      const stopShort = startPoll(() => { ticks += 1; }, 100);
      await wait(1500);
      stopLong();
      stopShort();
      return {ticks};
    `);
    assert.ok(lateShort.native.value.ticks >= 10, `native lateShort ticks=${lateShort.native.value.ticks}`);
    assert.ok(lateShort.shared.value.ticks >= 10, `shared lateShort ticks=${lateShort.shared.value.ticks}`);
  });

  await t.test('registering a new interval inside a timer callback does not spawn parallel timeout chains', async () => {
    const insideHandler = await runPair(browser, `
      let once = 0;
      let stopChild = null;
      const stopParent = startPoll(() => {
        if (!once) {
          once = 1;
          stopChild = startPoll(() => {}, 100);
        }
      }, 100);
      await wait(400);
      const before = window.__timeoutCalls;
      await wait(1000);
      const timeoutsPerSecond = window.__timeoutCalls - before;
      stopParent();
      stopChild?.();
      return {timeoutsPerSecond};
    `);
    assert.equal(insideHandler.native.value.timeoutsPerSecond, 0);
    assert.equal(insideHandler.shared.value.timeoutsPerSecond, 0);
  });

  await t.test('polling callback exceptions are reported to console/pageerror like native setInterval', async () => {
    const pollErr = await runPair(browser, `
      let stop;
      stop = startPoll(() => {
        stop();
        throw new Error('m3-poll-boom');
      }, 40);
      await wait(160);
      return {done: true};
    `);
    assert.ok(pollErr.native.pageErrors.some((e) => e.includes('m3-poll-boom')), `native poll errors: ${JSON.stringify(pollErr.native.pageErrors)}`);
    assert.ok(pollErr.shared.pageErrors.some((e) => e.includes('m3-poll-boom')), `shared poll errors: ${JSON.stringify(pollErr.shared.pageErrors)}`);
  });

  await t.test('mixed connected + shadowRoot targets on the same observer deliver interleaved records and stop cleanly on disconnect', async () => {
    const res = await runPair(browser, `
      const connected = add();
      const host = add();
      const shadow = host.attachShadow({mode: 'open'});
      const order = [];
      const o = mk((recs) => {
        for (const r of recs) order.push(r.target === connected ? 'connected' : r.target === shadow ? 'shadow' : 'other');
      });
      o.observe(connected, {childList: true});
      o.observe(shadow, {childList: true});
      connected.append('1');
      shadow.append(document.createElement('i'));
      connected.append('2');
      await wait(40);
      o.disconnect();
      connected.append('after-disconnect');
      shadow.append(document.createElement('b'));
      await wait(40);
      return order;
    `);
    assert.deepEqual(res.shared.pageErrors, res.native.pageErrors);
    assert.deepEqual(res.shared.value, res.native.value);
    assert.deepEqual(res.shared.value, ['connected', 'shadow', 'connected']);
  });
});

test('M3 product regression: unmodified laolao-learning-reminder.js reacts to both html attributes and body subtree mutations', async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());

  // 1. Direct reproduction of the coordinator's product.cjs check
  for (const attr of ['data-pinkie-study-desk', 'data-laolao-mode']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message || String(e)));
    try {
      await page.setContent('<!doctype html><html data-laolao-mode="study"><head></head><body></body></html>');
      await page.addScriptTag({content: DOM_WATCH_SRC});
      await page.addScriptTag({content: LEARNING_REMINDER_SRC});
      await page.waitForTimeout(300);
      const scheduled = await page.evaluate(async (attrName) => {
        let count = 0;
        const realRaf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (fn) => {
          count += 1;
          return realRaf(fn);
        };
        document.documentElement.setAttribute(attrName, 'changed');
        await new Promise((r) => setTimeout(r, 200));
        return count;
      }, attr);
      assert.deepEqual(errs, []);
      assert.ok(
        scheduled >= 1,
        `expected laolao-learning-reminder.js to schedule reconcile when html[${attr}] changes, got ${scheduled}`,
      );
    } finally {
      await context.close();
    }
  }

  // 2. End-to-end mount/unmount behavior on real header DOM with unmodified product scripts
  const context = await browser.newContext();
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message || String(e)));
  try {
    await page.setContent(`<!doctype html>
      <html data-laolao-mode="chat" data-pinkie-study-desk="chat">
        <head><style>.dashboard-header{display:flex;width:900px;height:40px;}</style></head>
        <body><div class="dashboard-header"><div class="dashboard-header__actions"></div></div></body>
      </html>`);
    await page.evaluate(() => {
      window.__pinkieStudyDesk = {
        sessionKey: () => 'agent:learning:main',
        request: async () => ({exams: [{name: '高等数学', daysLeft: 12, date: '2026-12-03'}]}),
      };
    });
    await page.addScriptTag({content: DOM_WATCH_SRC});
    await page.addScriptTag({content: LEARNING_REMINDER_SRC});
    await page.waitForTimeout(250);

    // Initially in chat mode: reminder should not be mounted
    assert.equal(await page.evaluate(() => Boolean(document.getElementById('pinkie-learning-reminder'))), false);

    // Switch html[data-laolao-mode] -> learning: reminder must mount and render exam countdown
    await page.evaluate(() => document.documentElement.setAttribute('data-laolao-mode', 'learning'));
    await page.waitForFunction(() => document.getElementById('pinkie-learning-reminder')?.textContent?.includes('高等数学'), null, {timeout: 2000});

    // Switch html[data-pinkie-study-desk] -> desk: reminder must unmount
    await page.evaluate(() => document.documentElement.setAttribute('data-pinkie-study-desk', 'desk'));
    await page.waitForFunction(() => !document.getElementById('pinkie-learning-reminder'), null, {timeout: 2000});

    // Switch html[data-pinkie-study-desk] -> chat: reminder must remount
    await page.evaluate(() => document.documentElement.setAttribute('data-pinkie-study-desk', 'chat'));
    await page.waitForFunction(() => Boolean(document.getElementById('pinkie-learning-reminder')), null, {timeout: 2000});

    // Body subtree mutation (replacing header): reminder must remount into the new header
    await page.evaluate(() => {
      document.querySelector('.dashboard-header')?.remove();
      const nextHeader = document.createElement('div');
      nextHeader.className = 'dashboard-header';
      nextHeader.innerHTML = '<div class="dashboard-header__actions"></div>';
      document.body.append(nextHeader);
    });
    await page.waitForFunction(
      () => Boolean(document.querySelector('.dashboard-header #pinkie-learning-reminder')),
      null,
      {timeout: 2000},
    );

    assert.deepEqual(errs, []);
  } finally {
    await context.close();
  }
});
