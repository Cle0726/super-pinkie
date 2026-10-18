// The opening: Le regard plays once per app launch over the booting UI, then the dark opens from
// between his eyes onto the room. Never blocks: if WebGL or the art fails, the UI is simply there.
const KEY = 'cle:splash:shown';
const MIN_HOLD = 600;            // ms the wide shot is held after the eyes settle, before the reveal

export function mountSplash(signal) {
  try { if (sessionStorage.getItem(KEY)) return; sessionStorage.setItem(KEY, '1'); } catch {}
  if (new URLSearchParams(location.search).has('nosplash')) return;
  const layer = document.createElement('div');
  layer.id = 'cle-splash';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = '<canvas></canvas>';
  document.documentElement.append(layer);
  let regard = null;
  const finish = () => { layer.classList.add('is-gone'); setTimeout(() => { regard?.dispose(); layer.remove(); }, 400); };
  signal.addEventListener('abort', finish, {once: true});
  (async () => {
    try {
      const [{createRegard}, {createSignature}] = await Promise.all([
        import('/cle/static/splash/regard.js'), import('/cle/static/splash/signature.js')]);
      const sig = createSignature('#F1EADB');
      sig.svg.classList.add('cle-splash__sig');
      layer.append(sig.svg);
      regard = await createRegard(layer.querySelector('canvas'), {base: '/cle/static/art/', signature: sig});
      regard.play();
      // leave once the UI underneath is ready (composer on screen), never before the eyes have settled
      const ready = new Promise((resolve) => {
        const t0 = performance.now();
        const check = () => (document.querySelector('.agent-chat__input') || performance.now() - t0 > 9000) ? resolve() : setTimeout(check, 120);
        check();
      });
      await ready;
      await new Promise((r) => setTimeout(r, MIN_HOLD));
      await regard.exit();
      finish();
    } catch (error) {
      console.warn('[cle] splash skipped:', error.message);
      finish();
    }
  })();
}
