// The host mounts a replacement activation before calling the old disposer.
// Our modules share document-level DOM, so retire them before mounting the next
// set. A document lease also works across separately imported bundle revisions.
const KEY = Symbol.for('cle-studio.activation');

// Connection loss also disposes the host activation, and the host activates again on reconnect
// (a refresh usually handshakes more than once). Tearing the UI down on every dispose put the
// upstream app on screen for each of those gaps. So a dispose of the live activation waits: if a
// new activation arrives within the grace it takes over in the same task (the old modules retire
// and the new ones mount before anything is painted); only a dispose nobody follows retires the UI.
export const RETIRE_GRACE_MS = 10_000;

export function beginActivation(doc = document) {
  doc[KEY]?.retire();
  const controller = new AbortController();
  let timer = null;
  const activation = {
    signal: controller.signal,
    retire() {
      if (controller.signal.aborted) return;
      if (timer) { clearTimeout(timer); timer = null; }
      controller.abort();
      if (doc[KEY] !== activation) return;
      // The document's skin is static presentation, not a live registration: keep it while the
      // native app disables its controls and reconnects.
      delete doc.documentElement.dataset.cleActive;
      delete doc[KEY];
    },
    dispose() {
      if (controller.signal.aborted || timer) return;
      // already superseded (the host disposes the previous one after mounting the next)
      if (doc[KEY] !== activation) { activation.retire(); return; }
      timer = setTimeout(activation.retire, RETIRE_GRACE_MS);
      timer.unref?.();
    },
  };
  doc[KEY] = activation;
  return activation;
}
