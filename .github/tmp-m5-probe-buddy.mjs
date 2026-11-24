// TEMPORARY (M5 rework, PR #59): read-only probe for the Linux night-scene jitter
// in the pinkie-buddy area. Opens a scene N times with the real harness and logs
// the buddy's state at screenshot time, then hashes the buddy clip on the same
// page over 2 s. Deleted together with tmp-m5-real-baseline.yml.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as H from '../tests/visual/lib/real-harness.mjs';

const [list = 'home-chat-night,long-conversation-night,home-chat-day', n = '3'] = process.argv.slice(2);
const out = path.join(process.env.RUNNER_TEMP || '.', 'buddy-probe');
fs.mkdirSync(out, {recursive: true});
const installed = H.installRealControlUi({repoRoot: H.REPO_ROOT});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: H.REPO_ROOT, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const state = (page) => page.evaluate(() => {
  const b = document.querySelector('.pinkie-buddy');
  if (!b) return {buddy: false};
  const fig = b.querySelector('.pinkie-buddy__figure');
  const r = b.getBoundingClientRect();
  const imgs = [...b.querySelectorAll('img.pinkie-buddy__img')].map((i) => {
    const cs = getComputedStyle(i);
    return {src: (i.getAttribute('src') || '').split('/').pop(), front: i.classList.contains('is-front'), complete: i.complete, w: i.naturalWidth, op: cs.opacity, filter: cs.filter.slice(0, 80)};
  });
  const fcs = fig ? getComputedStyle(fig) : null;
  return {
    buddy: true, cls: b.className, dataState: b.dataset.state, mode: b.dataset.mode,
    rect: [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 100) / 100),
    rig: Boolean(b.querySelector('.pinkie-buddy__rig')), reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    fig: fcs ? {anim: fcs.animationName, transform: fcs.transform} : null,
    imgs,
    anims: document.getAnimations({subtree: true}).filter((a) => a.effect?.target && b.contains(a.effect.target)).map((a) => `${a.animationName || a.transitionProperty}:${a.playState}:${Math.round(a.currentTime || 0)}`),
    settle: window.__pinkieRealSettle || null,
  };
});
try {
  console.log('browser', browser.version());
  for (const name of list.split(',')) {
    const theme = name.endsWith('-night') ? 'night' : 'day';
    const scene = name.replace(/-(day|night)$/, '');
    for (let i = 0; i < Number(n); i += 1) {
      const r = await H.openRealScenePage(browser, server.origin, scene, theme, {lockPerfClock: true});
      const s = await state(r.page);
      const rect = s.rect || [0, 0, 1, 1];
      const clip = {x: Math.max(0, rect[0] - 10), y: Math.max(0, rect[1] - 10), width: rect[2] + 20, height: rect[3] + 20};
      const hashes = [];
      for (let k = 0; k < 6; k += 1) {
        const png = await r.page.screenshot({clip, animations: 'disabled', caret: 'hide', type: 'png'});
        hashes.push(crypto.createHash('sha1').update(png).digest('hex').slice(0, 8));
        if (k === 0) fs.writeFileSync(path.join(out, `${name}.r${i + 1}.png`), png);
        await r.page.waitForTimeout(350);
      }
      console.log(`${name} r${i + 1} clipHashes=${hashes.join(' ')} state=${JSON.stringify(s)}`);
      await r.context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
  installed.cleanup();
}
