// metre-board footer flake probe: when the extra wand shows up, record why Metre's hide rule did not apply.
// Usage (lock held, isolated gateway only): node tools/tmp94-laser-probe.mjs <repoRoot> [rounds]
// Opens the metre-board real scene day+night `rounds` times through the repo's own real harness and,
// right after settle (the moment the screenshot would be taken), logs one JSON line per theme.
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const [repo = '.', roundsArg = '6'] = process.argv.slice(2);
const h = await import(pathToFileURL(path.resolve(repo, 'tests/visual/lib/real-harness.mjs')).href);
const PROBE = () => {
  const root = document.documentElement;
  const btns = [...document.querySelectorAll('#pinkie-laser-entry')].map((b) => {
    const r = b.getBoundingClientRect();
    return {display: getComputedStyle(b).display, w: Math.round(r.width), x: Math.round(r.left), parent: String(b.parentElement?.className || '').slice(0, 60), inShadow: b.getRootNode() !== document};
  });
  const skin = [...document.querySelectorAll('link[rel~="stylesheet"]')].filter((l) => /laolao-metre-skin\.css/.test(l.href))
    .map((l) => ({disabled: l.disabled, loaded: Boolean(l.sheet), rules: (() => { try { return l.sheet?.cssRules.length ?? -1; } catch { return -2; } })()}));
  const footer = [...document.querySelectorAll('.sidebar-shell__footer .sidebar-footer-icon, .sidebar-shell__footer .sidebar-brand__icon')]
    .filter((e) => e.getBoundingClientRect().width > 0).map((e) => String(e.id || e.getAttribute('aria-label') || e.className).slice(0, 40));
  return {mode: root.getAttribute('data-laolao-mode'), pending: root.getAttribute('data-laolao-mode-pending'), enter: root.hasAttribute('data-laolao-mode-enter'), btns, skin, footer};
};
const inst = h.installRealControlUi({repoRoot: path.resolve(repo)});
const server = await h.startRealUiServer({controlUiDir: inst.controlUiDir, repoRoot: path.resolve(repo), runDir: inst.runDir});
const browser = await h.launchRealBrowser();
try {
  for (let i = 0; i < Number(roundsArg); i++) {
    for (const theme of ['day', 'night']) {
      const {context, page} = await h.openRealScenePage(browser, server.origin, 'metre-board', theme, {lockPerfClock: true});
      try { console.log(i, theme, JSON.stringify(await page.evaluate(PROBE))); }
      finally { await context.close(); }
    }
  }
} finally {
  await browser.close();
  await server.close?.();
}
