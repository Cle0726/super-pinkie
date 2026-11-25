// TEMPORARY (#94, engines 11-25): only used by .github/workflows/tmp-94-real-baseline.yml, delete along with it.
// Opens metre-board in the real-page harness on linux (no gateway, no upstream). Logs, per day / night:
//   ① state after settle (fold level, model-name limit, input height, model-name width)
//   ② the same steps as measure() done by hand: input height with this batch's keys hidden, with full / shortest model name; and with the keys shown at the shortest name
//   ③ after one forced re-measure (viewport -1px then back), the state again
// Use: whether the input is one row in ③ tells whether "didn't measure again after a late change" or "measuring logic is wrong".
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const repo = path.resolve(process.argv[2] || '.');
const h = await import(pathToFileURL(path.join(repo, 'tests/visual/lib/real-harness.mjs')).href);
const inst = h.installRealControlUi({repoRoot: repo});
const server = await h.startRealUiServer({controlUiDir: inst.controlUiDir, repoRoot: repo, runDir: inst.runDir});
const browser = await h.launchRealBrowser();
const SNAP = () => {
  const c = document.querySelector('.chat-main .agent-chat__composer-controls');
  const input = c?.closest('.agent-chat__input');
  if (!c || !input) return {none: true};
  const box = c.querySelector(':scope > .pk-perm-chips');
  const model = c.querySelector(':scope > .chat-composer-model-control');
  const label = model && (model.querySelector('.pinkie-trigger-label') || model.querySelector('.chat-controls__inline-select-label'));
  const name = label?.querySelector('.pinkie-external-model-name') || label;
  const kids = [...c.children].filter((k) => k.getBoundingClientRect().height > 0).map((k) => {
    const r = k.getBoundingClientRect();
    return `${(String(k.className).split(' ').find((x) => /pk-|pinkie|model-control|context|deep|baton/.test(x)) || k.tagName).slice(0, 26)}@${Math.round(r.left)},${Math.round(r.top)}w${Math.round(r.width)}`;
  });
  const fonts = document.fonts ? [...document.fonts].map((f) => `${f.family}:${f.status}`).filter((s) => !s.endsWith(':loaded')) : [];
  return {inputH: Math.round(input.getBoundingClientRect().height), controlsW: Math.round(c.getBoundingClientRect().width), fold: box?.dataset.fold, boxDisplay: box ? getComputedStyle(box).display : null,
    squeezed: model?.style.getPropertyValue('--pk-perm-model-label') || '', labelW: label ? Math.round(label.getBoundingClientRect().width * 10) / 10 : null,
    labelMax: label ? getComputedStyle(label).maxWidth : null, clipped: name ? name.scrollWidth > name.clientWidth + 1 : null, notLoadedFonts: fonts, kids};
};
const REPLAY = () => {
  const c = document.querySelector('.chat-main .agent-chat__composer-controls');
  const input = c.closest('.agent-chat__input');
  const box = c.querySelector(':scope > .pk-perm-chips');
  const model = c.querySelector(':scope > .chat-composer-model-control');
  const label = model && (model.querySelector('.pinkie-trigger-label') || model.querySelector('.chat-controls__inline-select-label'));
  const V = '--pk-perm-model-label';
  const keep = model?.style.getPropertyValue(V) || '';
  const H = () => Math.round(input.getBoundingClientRect().height * 10) / 10;
  const W = () => label ? Math.round(label.getBoundingClientRect().width * 10) / 10 : null;
  const tier = label?.querySelector(':scope > .pinkie-external-tier');
  const minCss = `calc(8ch + ${tier ? Math.ceil(tier.getBoundingClientRect().width) + 16 : 0}px)`;
  const out = {minCss};
  model?.style.removeProperty(V); out.fullW = W(); out.shownFullH = H();
  model?.style.setProperty(V, minCss); out.minW = W(); out.shownMinH = H();
  box.style.display = 'none'; out.h0Min = H();
  model?.style.removeProperty(V); out.hiddenFullH = H();
  box.style.display = '';
  if (keep) model.style.setProperty(V, keep); else model?.style.removeProperty(V);
  out.restoredH = H();
  return out;
};
// Why does the squeezed limit not narrow the label on linux (replay: 8ch limit, width still 140.4px)?
// Under the squeeze, record the label's computed max-width / display / the variable as the label and the model key see it,
// the parent's display, then force an inline max-width of 60px to see whether the label can get narrower at all.
const DIAG = () => {
  const c = document.querySelector('.chat-main .agent-chat__composer-controls');
  const model = c?.querySelector(':scope > .chat-composer-model-control');
  const label = model && (model.querySelector('.pinkie-trigger-label') || model.querySelector('.chat-controls__inline-select-label'));
  if (!label) return {none: true};
  const V = '--pk-perm-model-label';
  const keep = model.style.getPropertyValue(V) || '';
  const cs = () => getComputedStyle(label);
  const W = () => Math.round(label.getBoundingClientRect().width * 10) / 10;
  const chain = [];
  for (let n = label.parentElement; n && n !== c && chain.length < 6; n = n.parentElement) {
    const s = getComputedStyle(n);
    chain.push(`${n.tagName.toLowerCase()}.${String(n.className).split(' ').filter(Boolean).slice(0, 2).join('.')}:${s.display}/w${Math.round(n.getBoundingClientRect().width)}/max${s.maxWidth}`);
  }
  const out = {cls: String(label.className), text: (label.textContent || '').trim().slice(0, 40), chain,
    base: {w: W(), display: cs().display, maxWidth: cs().maxWidth, minWidth: cs().minWidth, flex: cs().flex, overflow: cs().overflow, whiteSpace: cs().whiteSpace, fontSize: cs().fontSize}};
  model.style.setProperty(V, 'calc(8ch + 0px)');
  out.squeezed = {w: W(), maxWidth: cs().maxWidth, varOnLabel: cs().getPropertyValue(V), varOnModel: getComputedStyle(model).getPropertyValue(V)};
  model.style.setProperty(V, '60px');
  out.squeezed60 = {w: W(), maxWidth: cs().maxWidth};
  if (keep) model.style.setProperty(V, keep); else model.style.removeProperty(V);
  label.style.setProperty('max-width', '60px', 'important');
  out.inline60 = {w: W(), maxWidth: cs().maxWidth, display: cs().display};
  label.style.removeProperty('max-width');
  const rules = [];
  for (const sheet of document.styleSheets) {
    let list; try { list = sheet.cssRules; } catch { continue; }
    const walk = (rs) => { for (const r of rs) {
      if (r.cssRules && !r.selectorText) { try { walk(r.cssRules); } catch {} continue; }
      if (!r.selectorText || !r.style) continue;
      if (!/max-width|width|display|flex/.test(r.style.cssText)) continue;
      let hit = false; try { hit = label.matches(r.selectorText); } catch {}
      if (hit) rules.push(`${(sheet.href || 'inline').split('/').pop().split('?')[0]} :: ${r.selectorText.slice(0, 140)} { ${r.style.cssText.slice(0, 160)} }`);
    } };
    walk(list);
  }
  out.rules = rules.slice(0, 20);
  out.restoredW = W();
  return out;
};
// 2b showed: with the variable at calc(8ch) or even an inline max-width:60px !important, the label's computed max-width is still 260px.
// Only a running transition beats an inline !important. Record transition / animations directly, read again after turning transitions off, and read again after waiting.
const DIAG2 = async () => {
  const c = document.querySelector('.chat-main .agent-chat__composer-controls');
  const model = c?.querySelector(':scope > .chat-composer-model-control');
  const label = model && (model.querySelector('.pinkie-trigger-label') || model.querySelector('.chat-controls__inline-select-label'));
  if (!label) return {none: true};
  const V = '--pk-perm-model-label';
  const keep = model.style.getPropertyValue(V) || '';
  const cs = () => getComputedStyle(label);
  const W = () => Math.round(label.getBoundingClientRect().width * 10) / 10;
  const anim = () => (label.getAnimations?.() || []).map((a) => `${a.constructor.name}:${a.transitionProperty || a.animationName || ''}:${a.playState}`);
  const out = {inlineStyle: label.getAttribute('style') || '', tr: {prop: cs().transitionProperty, dur: cs().transitionDuration, delay: cs().transitionDelay}, anim0: anim()};
  model.style.setProperty(V, '60px');
  out.set = {w: W(), maxWidth: cs().maxWidth, anim: anim()};
  await new Promise((r) => setTimeout(r, 600));
  out.after600 = {w: W(), maxWidth: cs().maxWidth, anim: anim()};
  if (keep) model.style.setProperty(V, keep); else model.style.removeProperty(V);
  await new Promise((r) => setTimeout(r, 600));
  label.style.setProperty('transition', 'none', 'important');
  model.style.setProperty(V, '60px');
  out.noTransition = {w: W(), maxWidth: cs().maxWidth, anim: anim()};
  if (keep) model.style.setProperty(V, keep); else model.style.removeProperty(V);
  label.style.removeProperty('transition');
  const ancestors = [];
  for (let n = label; n && n !== document.body && ancestors.length < 8; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.transitionDuration.split(',').some((d) => parseFloat(d) > 0)) ancestors.push(`${n.tagName.toLowerCase()}.${String(n.className).split(' ').filter(Boolean).slice(0, 2).join('.')} :: ${s.transitionProperty.slice(0, 80)} / ${s.transitionDuration.slice(0, 60)}`);
  }
  out.ancestorsWithTransition = ancestors;
  out.restoredW = W();
  return out;
};
try {
  for (const theme of ['day', 'night']) {
    const {context, page} = await h.openRealScenePage(browser, server.origin, 'metre-board', theme, {lockPerfClock: true});
    try {
      const vp = page.viewportSize();
      console.log(theme, 'viewport', JSON.stringify(vp));
      console.log(theme, '1-settled', JSON.stringify(await page.evaluate(SNAP)));
      console.log(theme, '2-replay', JSON.stringify(await page.evaluate(REPLAY)));
      console.log(theme, '2b-diag', JSON.stringify(await page.evaluate(DIAG)));
      console.log(theme, '2c-diag', JSON.stringify(await page.evaluate(DIAG2)));
      await page.setViewportSize({width: vp.width - 1, height: vp.height});
      await page.waitForTimeout(300);
      await page.setViewportSize(vp);
      await page.waitForTimeout(2500);
      console.log(theme, '3-refit', JSON.stringify(await page.evaluate(SNAP)));
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await server.close?.();
  try { inst.cleanup?.(); console.log('cleanup ok'); } catch (error) { console.log('cleanup failed', error.message); }
}
