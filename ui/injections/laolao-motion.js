/* Shared low-cost motion primitives for startup, four modes and party entry. */
((root, factory) => {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PinkieMotion = api;
})(typeof window === 'object' ? window : globalThis, root => {
  const progressValues = new WeakMap();
  const images = new Map();
  function text(node, value) { if (node && node.textContent !== value) node.textContent = value; }
  function progress(fill, label, bar, value) {
    const previous = progressValues.get(fill) ?? -1;
    const next = Math.max(previous, Math.min(100, Math.max(0, Math.round(Number(value) || 0))));
    if (next === previous) return next;
    progressValues.set(fill, next);
    fill.style.transform = `scaleX(${next / 100})`;
    text(label, `${next}%`);
    bar?.setAttribute('aria-valuenow', String(next));
    return next;
  }
  function preload(source) {
    if (!images.has(source)) {
      const image = new root.Image();
      image.decoding = 'async';
      const pending = new Promise(resolve => {
        let done = false;
        const finish = ok => { if (done) return; done = true; root.clearTimeout(timer); if (!ok) images.delete(source); resolve(ok); };
        const timer = root.setTimeout(() => finish(false), 10000);
        image.onload = () => {
          if (image.decode) image.decode().then(() => finish(true), () => finish(image.naturalWidth > 0));
          else finish(image.naturalWidth > 0);
        };
        image.onerror = () => finish(false);
        image.src = source;
      });
      images.set(source, pending);
    }
    return images.get(source);
  }
  function stable(check, duration = 240) {
    let since = null;
    return now => {
      if (!check()) { since = null; return false; }
      if (since === null) since = now;
      return now - since >= duration;
    };
  }
  const frames = () => new Promise(resolve => root.requestAnimationFrame(() => root.requestAnimationFrame(resolve)));
  const reduced = () => Boolean(root.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const finishProgress = (fill, label, bar) => new Promise(resolve => {
    const start = progressValues.get(fill) ?? 0;
    if (reduced()) { progress(fill, label, bar, 100); resolve(); return; }
    let started;
    const tick = now => {
      started ??= now;
      const ratio = Math.min(1, (now - started) / 300);
      progress(fill, label, bar, start + (100 - start) * (1 - Math.pow(1 - ratio, 2)));
      if (ratio === 1) resolve(); else root.requestAnimationFrame(tick);
    };
    root.requestAnimationFrame(tick);
  });
  const modeAssets = id => Promise.all([
    `/laolao-mode-transition-${id}.png?v=transition2`,
    `/laolao-mode-${id}-hd.png?v=avatars6`,
    id === 'chat' ? '/laolao-wallpaper.png' : `/laolao-wallpaper-${id}.png`,
  ].map(preload));
  function chatReady(id) {
    const doc = root.document;
    // A thread containing only the user's first message has no assistant
    // portrait yet. Its decoded mode-button portrait is a valid fallback.
    const avatar = doc.querySelector(`[data-laolao-mode-avatar="${id}"]`) ||
      doc.querySelector(`.laolao-mode-switcher[data-mode="${id}"] img`);
    return doc.documentElement.getAttribute('data-laolao-mode') === id &&
      Boolean(doc.querySelector('.agent-chat__input')) &&
      !doc.querySelector('.chat-loading-skeleton') && Boolean(avatar?.complete);
  }
  function enter() {
    root.document.documentElement.setAttribute('data-laolao-mode-enter', '1');
    root.setTimeout(() => root.document.documentElement.removeAttribute('data-laolao-mode-enter'), 1250);
  }
  return { progress, finishProgress, text, preload, stable, frames, reduced, modeAssets, chatReady, enter };
});
