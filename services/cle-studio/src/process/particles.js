// Reuse the shipped C.le. particle renderer and its original choreography.
// This adapter only follows the new native UI's active working indicator.
const BASE = '/cle/static/legacy/';

function script(src, ready) {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const element = document.createElement('script'); element.src = BASE + src;
    element.onload = resolve; element.onerror = () => { element.remove(); reject(new Error(src)); };
    document.head.append(element);
  });
}

function runtime() {
  return window.__cleParticleRuntime || (window.__cleParticleRuntime = Promise.all([
    script('laolao-vendor-gsap.min.js', () => !!window.gsap),
    script('laolao-cle-signature.js', () => !!window.CleSignature),
  ]).then(() => import('/cle/static/legacy/laolao-cle-space.js')));
}

export function particleGlyph(signal) {
  const mount = document.createElement('span'); mount.className = 'cle-status__particles';
  mount.textContent = 'C.le.'; mount.setAttribute('aria-hidden', 'true');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let space = null, pending = false, desired = 'think';
  const stateFor = run => run.mode === 'write' ? 'write' : run.mode === 'done' ? 'done'
    : run.mode !== 'tool' ? 'think' : /^(read|view|open|look)/i.test(run.tool || '') ? 'read'
      : /^(edit|patch|apply)/i.test(run.tool || '') ? 'edit' : 'write';
  const destroy = () => { space?.dispose(); space = null; mount.replaceChildren(); mount.textContent = 'C.le.'; };

  async function attach(target, run) {
    if (!target || signal.aborted) return;
    desired = stateFor(run);
    if (mount.parentElement !== target) target.append(mount);
    if (space) { space.visible = true; space.loop(); space.set(desired); return; }
    if (pending || reduce.matches) return;
    pending = true;
    try {
      const {CleSpace} = await runtime();
      if (signal.aborted || reduce.matches || !mount.isConnected) return;
      mount.textContent = '';
      // The same count, framing and point size as the original status effect.
      space = new CleSpace(mount, {palette: 'cle', count: 1100, size: .17, fitW: 10.2, fitH: 5.4, interactive: false});
      space.set(desired);
    } catch (error) { mount.textContent = 'C.le.'; console.warn('[cle] particle fallback:', error.message); }
    finally { pending = false; }
  }
  function park() {
    if (space) { space.visible = false; space.set('idle'); }
    mount.remove();
  }
  const preference = () => { if (reduce.matches) destroy(); };
  reduce.addEventListener('change', preference);
  signal.addEventListener('abort', () => { reduce.removeEventListener('change', preference); destroy(); mount.remove(); }, {once: true});
  return {attach, park};
}
