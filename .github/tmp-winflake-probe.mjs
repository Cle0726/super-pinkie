// TEMPORARY (winflake line): diagnostic probe, removed before the final commit.
// Opens the study desk with the same harness options as the two flaky tests
// and reports what keeps the compositor busy: running infinite animations,
// rAF call rate and sources, and visible backdrop-filter / blur layers.
import {startHarness, playwright, isolatedService} from '../tools/study-desk/harness.mjs';

const describe = () => {
  const name = t => !t ? '?' : (t.id ? '#' + t.id : '') + (typeof t.className === 'string' && t.className.trim() ? '.' + t.className.trim().split(/\s+/).join('.') : (t.id ? '' : t.tagName?.toLowerCase()));
  const anims = document.getAnimations()
    .filter(a => a.playState === 'running' && a.effect?.getTiming?.().iterations === Infinity)
    .map(a => (a.animationName || a.transitionProperty || a.id || 'anim') + ' @ ' + name(a.effect.target) + ' visible=' + (a.effect.target?.checkVisibility?.() ?? '?'));
  const heavy = [];
  for (const n of document.querySelectorAll('*')) {
    const s = getComputedStyle(n);
    const bf = s.backdropFilter, f = s.filter;
    if ((bf && bf !== 'none') || (f && f !== 'none' && /blur|drop-shadow/.test(f))) {
      if (!n.checkVisibility?.()) continue;
      const r = n.getBoundingClientRect();
      heavy.push(name(n) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + (bf && bf !== 'none' ? ' backdrop=' + bf : '') + (f && f !== 'none' ? ' filter=' + f.slice(0, 60) : ''));
    }
  }
  return {anims, heavy: heavy.slice(0, 25), heavyCount: heavy.length};
};

const configs = [
  {name: 'entry (vendor:false)', opts: s => ({vendor: false, handler: s.handler}), layouts: [null]},
  {name: 'conversation (legacyUI)', opts: s => ({legacyUI: true, handler: s.handler}), layouts: [null, 'spread-chat']},
];
for (const cfg of configs) {
  const service = await isolatedService();
  let harness, browser;
  try {
    harness = await startHarness(cfg.opts(service));
    browser = await playwright().chromium.launch({headless: true, channel: 'chrome'});
    const page = await browser.newPage({viewport: {width: 1440, height: 900}, ...(process.env.PROBE_REDUCED ? {reducedMotion: 'reduce'} : {})});
    await page.addInitScript(() => {
      const orig = window.requestAnimationFrame.bind(window);
      window.__raf = {n: 0, src: {}};
      window.requestAnimationFrame = cb => {
        if (window.__rafOn) { window.__raf.n++; const s = (new Error().stack || '').split('\n')[2]?.trim() || '?'; window.__raf.src[s] = (window.__raf.src[s] || 0) + 1; }
        return orig(cb);
      };
    });
    await page.goto(harness.url);
    await page.locator('#pinkie-study-desk').waitFor({state: 'attached'});
    for (const state of ['initial', 'today', ...cfg.layouts.filter(Boolean)]) {
      if (state === 'today') await page.evaluate(() => window.__pinkieStudyDesk?.go('today'));
      else if (state !== 'initial') await page.evaluate(l => window.__pinkieStudyDesk?.setLayout(l), state);
      await page.waitForTimeout(1500);
      await page.evaluate(() => { window.__raf = {n: 0, src: {}}; window.__rafOn = true; });
      await page.waitForTimeout(3000);
      const raf = await page.evaluate(() => { window.__rafOn = false; return window.__raf; });
      const d = await page.evaluate(describe);
      console.log(`\n### ${cfg.name} / ${state}: view=${await page.locator('#pinkie-study-desk').getAttribute('data-view')}`);
      console.log(`rAF calls in 3 s: ${raf.n}`);
      for (const [s, n] of Object.entries(raf.src).sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`  ${n}x ${s.slice(0, 160)}`);
      console.log(`running infinite animations: ${d.anims.length}`);
      for (const a of d.anims.slice(0, 30)) console.log('  ' + a.slice(0, 200));
      console.log(`visible blur/backdrop layers: ${d.heavyCount}`);
      for (const h of d.heavy) console.log('  ' + h.slice(0, 200));
    }
  } finally {
    try { await browser?.close(); } finally { try { await harness?.close(); } finally { await service.close(); } }
  }
}
