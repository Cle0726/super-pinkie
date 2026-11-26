// Real-page screenshots call document.fonts.ready inside a 30s budget.
// A face that is still loading eats that budget: portable-checks run
// 45748757225, job 139671161380, real-scene home-learning-night logged
// "fonts loaded" and then page.screenshot timed out. The same branch's later
// run was green. Wait the load out here, and drop only faces that never finish,
// so a settled capture is unchanged.

export async function releaseStuckFonts(maxWaitMs = 20000) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const fonts = document.fonts;
  if (!fonts) return;
  const loading = () => [...fonts].filter((face) => face.status === 'loading');
  const slices = Math.max(1, Math.ceil(maxWaitMs / 100));
  for (let i = 0; i < slices; i += 1) {
    if (loading().length === 0) break;
    await Promise.race([fonts.ready.catch(() => {}), wait(100)]);
    if (loading().length === 0) break;
  }
  const stuck = loading();
  if (stuck.length === 0) {
    // Chromium keeps status "loading" until the ready promise is observed,
    // even after every face has already settled.
    await Promise.race([fonts.ready.catch(() => {}), wait(100)]);
    return;
  }
  // Deleting a CSS-connected face does not cancel its network load, and
  // document.fonts.ready stays pending while that load is open. Drop the
  // @font-face rule, then stop the browsing context's remaining loads.
  // Faces that finished inside the wait are left alone, so a settled capture
  // does not change.
  const families = new Set(stuck.map((face) => face.family));
  for (const sheet of [...(document.styleSheets || [])]) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (let i = rules.length - 1; i >= 0; i -= 1) {
      const rule = rules[i];
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const name = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      if (!families.has(name)) continue;
      try { sheet.deleteRule(i); } catch { /* read-only sheet */ }
    }
  }
  for (const face of stuck) {
    try { fonts.delete(face); } catch { /* already removed */ }
  }
  try { window.stop(); } catch { /* already stopped */ }
  await Promise.race([fonts.ready.catch(() => {}), wait(500)]);
  if (!fonts.__pinkieFreezeAdd) {
    const origAdd = fonts.add.bind(fonts);
    fonts.add = (face) => (face && face.status === 'loaded' ? origAdd(face) : fonts);
    fonts.__pinkieFreezeAdd = true;
  }
}

export async function stabilizeRealFontsForCapture(page, {maxWaitMs = 20000} = {}) {
  await page.evaluate(releaseStuckFonts, maxWaitMs);
}

// Patch pages created after this call. captureRealScenePng screenshots those
// pages; real-harness.mjs itself stays untouched (open PRs already edit it).
export function installRealCaptureFontFreeze(browser) {
  if (!browser || browser.__pinkieFontFreeze) return browser;
  const origContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await origContext(...args);
    const origPage = context.newPage.bind(context);
    context.newPage = async (...pageArgs) => {
      const page = await origPage(...pageArgs);
      const shot = page.screenshot.bind(page);
      page.screenshot = async (options) => {
        await stabilizeRealFontsForCapture(page);
        return shot(options);
      };
      return page;
    };
    return context;
  };
  browser.__pinkieFontFreeze = true;
  return browser;
}
