// The opening: Le regard plays once per app launch over the booting UI — his eye opens, holds your
// gaze, blinks, and the screen opens in the shape of his eye onto the room. Never blocks: if WebGL or the art fails, the UI is simply there.
const KEY = 'cle:splash:shown';
const MIN_HOLD = 200;            // ms he holds your gaze once the UI is ready, before the blink

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
      const {createRegard} = await import('/cle/static/splash/regard.js?v=20261019');
      regard = await createRegard(layer.querySelector('canvas'), {base: '/cle/static/art/'});
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
