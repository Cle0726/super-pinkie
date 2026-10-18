// The host mounts a replacement activation before calling the old disposer.
// Our modules share document-level DOM, so retire them before mounting the next
// set. A document lease also works across separately imported bundle revisions.
const KEY = Symbol.for('cle-studio.activation');

export function beginActivation(doc = document) {
  doc[KEY]?.dispose();
  const controller = new AbortController();
  const activation = {
    signal: controller.signal,
    dispose() {
      if (controller.signal.aborted) return;
      controller.abort();
      if (doc[KEY] !== activation) return;
      delete doc.documentElement.dataset.cle;
      delete doc[KEY];
    },
  };
  doc[KEY] = activation;
  return activation;
}
