// Loads the ported functional modules (classic scripts + styles) from the plugin's static
// route, in order. A module that fails to load is reported and skipped; the rest continue.
import {LEGACY_MODULES} from './modules.js';

const BASE = '/cle/static/legacy/';
// A native UI hot reload must not execute classic scripts a second time: they
// own timers and listeners which survive the module replacement.
const loaded = window.__cleLegacyLoaded || (window.__cleLegacyLoaded = new Set());

function addStyle(href) {
  if (document.querySelector(`link[data-cle-legacy="${href}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = BASE + href; link.dataset.cleLegacy = href;
    link.onload = () => resolve();
    link.onerror = () => { link.remove(); reject(new Error(`stylesheet ${href}`)); };
    document.head.append(link);
  });
}
function addScript(src) {
  if (loaded.has(src)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = BASE + src; s.async = false; s.dataset.cleLegacy = src;
    s.onload = () => { loaded.add(src); resolve(true); };
    s.onerror = () => { console.error('[cle] legacy module failed to load:', src); resolve(false); };
    document.head.append(s);
  });
}

export async function loadLegacy(report = {}) {
  for (const mod of LEGACY_MODULES) {
    if (mod.enabled === false) continue;
    try {
      await Promise.all((mod.css || []).map(addStyle));
      for (const js of mod.js || []) if (!(await addScript(js))) throw new Error(js);
      report[mod.id] = 'ok';
    } catch (e) { report[mod.id] = 'failed: ' + e.message; }
  }
  return report;
}
