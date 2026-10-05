/* Shared low-cost motion primitives for startup, four modes and party entry. */
((root, factory) => {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PinkieMotion = api;
})(typeof window === 'object' ? window : globalThis, root => {
  const progressValues = new WeakMap();
  const images = new Map();
  function text(node, value) { if (node && node.textContent !== value) node.textContent = value; }
  function updateProgress(fill, label, bar, value) {
    const previous = progressValues.get(fill) ?? -1;
    const next = Math.max(previous, Math.min(100, Math.max(0, Math.round(Number(value) || 0))));
    if (next === previous) return next;
    progressValues.set(fill, next);
    text(label, `${next}%`);
    bar?.setAttribute('aria-valuenow', String(next));
    return next;
  }
  function progress(fill, label, bar, value, {visual = true} = {}) {
    const previous = progressValues.get(fill) ?? -1;
    const next = updateProgress(fill, label, bar, value);
    if (visual && next !== previous) fill.style.transform = `scaleX(${next / 100})`;
    return next;
  }
  function displayedProgress(fill) {
    let transform = '';
    try { transform = root.getComputedStyle?.(fill)?.transform || ''; } catch {}
    if (!transform || transform === 'none') transform = fill?.style?.transform || '';
    const matrix = transform.match(/^matrix(?:3d)?\(([^)]+)\)/);
    const scale = matrix ? Number(matrix[1].split(',')[0]) : Number(/^scaleX\(([^)]+)\)/.exec(transform)?.[1]);
    return Number.isFinite(scale) ? Math.min(100, Math.max(0, scale * 100)) : null;
  }
  function animateProgress(fill, label, bar, from, to, duration, curve = 'linear') {
    if (!fill || typeof fill.animate !== 'function' || reduced()) return null;
    const start = Math.max(0, Math.min(100, Number(from) || 0));
    const end = Math.max(start, Math.min(100, Number(to) || 0));
    const ease = curve === 'easeOutQuad' ? (x) => 1 - (1 - x) ** 2 : (x) => x;
    const frameCount = curve === 'linear' ? 2 : 25;
    const frames = Array.from({length: frameCount}, (_, index) => {
      const ratio = index / (frameCount - 1);
      return {offset: ratio, transform: `scaleX(${(start + (end - start) * ease(ratio)) / 100})`};
    });
    fill.style.transition = 'none';
    fill.style.transform = `scaleX(${start / 100})`;
    updateProgress(fill, label, bar, start);
    return fill.animate(frames, {duration: Math.max(1, duration), easing: 'linear', fill: 'forwards'});
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
  const finishProgress = (fill, label, bar, duration = 300) => new Promise(resolve => {
    const start = Math.max(progressValues.get(fill) ?? 0, displayedProgress(fill) ?? 0);
    if (reduced()) { progress(fill, label, bar, 100); resolve(); return; }
    const animation = animateProgress(fill, label, bar, start, 100, duration, 'easeOutQuad');
    if (animation) {
      let started;
      const tick = (now) => {
        started ??= now;
        const ratio = Math.min(1, (now - started) / Math.max(1, duration));
        const value = start + (100 - start) * (1 - Math.pow(1 - ratio, 2));
        progress(fill, label, bar, value, {visual: false});
        if (ratio === 1) resolve(); else root.requestAnimationFrame(tick);
      };
      root.requestAnimationFrame(tick);
      return;
    }
    let started;
    const tick = now => {
      started ??= now;
      const ratio = Math.min(1, (now - started) / Math.max(1, duration));
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
    // OpenClaw 7.1 moved the real composer under a combobox wrapper. The old
    // selector missed it, so the branded entrance stayed at 94% even though
    // the complete chat (including restored history) was already usable.
    const input = doc.querySelector('.agent-chat__composer-combobox textarea') ||
      doc.querySelector('.agent-chat__input') ||
      doc.querySelector('textarea[placeholder], [contenteditable="true"]');
    // A brand-new chat can render before its portrait exists. Missing art is
    // not a reason to block the whole app; if an image exists, wait only while
    // it is actually loading.
    const avatarReady = !avatar || avatar.complete !== false;
    return (doc.documentElement.getAttribute('data-laolao-mode') === id ||
      doc.documentElement.getAttribute('data-laolao-mode-pending') === id) &&
      Boolean(input) && !doc.querySelector('.chat-loading-skeleton') && avatarReady;
  }
  function enter() {
    root.document.documentElement.setAttribute('data-laolao-mode-enter', '1');
    root.setTimeout(() => root.document.documentElement.removeAttribute('data-laolao-mode-enter'), 1250);
  }
  return { progress, updateProgress, displayedProgress, animateProgress, finishProgress, text, preload, stable, frames, reduced, modeAssets, chatReady, enter };
});
