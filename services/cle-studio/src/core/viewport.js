// Share the same viewport policy with the classic skin. The native 2026.10
// virtualizer owns its anchors; the shared module only repairs older panes.
import '../../../../ui/injections/laolao-perf.js';

export function mountViewport(signal) {
  const viewport = window.__pinkieChatViewport;
  if (!viewport || signal?.aborted) return;
  viewport.install();
  signal?.addEventListener('abort', () => viewport.dispose(), {once: true});
}
