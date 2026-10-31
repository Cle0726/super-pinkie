// Upstream chrome C.le. does not have is removed from the page, not hidden.
//
// Every node listed here is a leaf the native app renders for its own product: a promotion,
// its mascot, a link to its docs, the multi-user "正在回复 <person>" attribution. None of
// them holds state the app reads back, so taking the element out is safe: Lit keeps its
// part markers (comments) and simply has nothing between them; a later render that brings
// the node back is caught by the observer and taken out again.
const GONE = [
  '.chat-reply-attribution',                          // 正在回复 · <avatar> · <name>
  '.sidebar-shell__invite', '.community-invite-card', 'aside.invite',
  '.agent-chat__welcome-clawd',                       // the upstream mascot on the welcome
  '.chat-controls__permission-learn-more',            // "了解更多" → docs.openclaw.ai
].join(', ');

export function mountPrune(signal) {
  const sweep = (root) => {
    if (root.matches?.(GONE)) { root.remove(); return; }
    for (const node of root.querySelectorAll?.(GONE) || []) node.remove();
  };
  const mo = new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) sweep(n);
  });
  mo.observe(document.body, {childList: true, subtree: true});
  sweep(document.body);
  signal.addEventListener('abort', () => mo.disconnect(), {once: true});
}
