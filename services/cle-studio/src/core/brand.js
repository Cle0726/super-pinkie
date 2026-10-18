// Nothing that is not C.le. reaches the screen: upstream promotion, community links,
// mascots and brand words. CSS hides known components; this pass catches the rest.
const HIDE = [
  '.sidebar-shell__invite', '.community-invite-card', 'aside.invite',
];
const EXTERNAL = /^https?:\/\/(?:www\.)?(?:reddit\.com|discord\.gg|discord\.com|x\.com|twitter\.com|github\.com\/openclaw|clawhub\.ai|openclaw\.ai|docs\.openclaw\.ai)/i;
const WORD = /OpenClaw(?:\s+Control)?/g;
// Rebrand the application's chrome, never the user's messages, source code,
// documents or useful links in a reply.
const CONTENT = '.chat-group, .chat-text, .chat-bubble, pre, code, textarea, input, [contenteditable="true"], .monaco-editor, .pinkie-library-reader, .laolao-learning-notes';

export function brandStyles() {
  return `${HIDE.join(',')}{display:none!important}`;
}

function sweep(root) {
  for (const a of root.querySelectorAll?.('a[href]') || []) {
    if (a.closest(CONTENT)) continue;
    if (EXTERNAL.test(a.href)) { a.removeAttribute('href'); a.hidden = true; }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest(CONTENT)) continue;
    if (n.nodeValue && n.nodeValue.includes('OpenClaw')) n.nodeValue = n.nodeValue.replace(WORD, 'C.le.');
  }
}

export function startBrandGuard(signal) {
  if (document.title.includes('OpenClaw')) document.title = document.title.replace(WORD, 'C.le.');
  sweep(document.body);
  let queued = new Set();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const nodes = queued; queued = new Set();
    for (const node of nodes) if (node.isConnected) sweep(node.nodeType === 1 ? node : node.parentNode || document.body);
    if (document.title.includes('OpenClaw')) document.title = document.title.replace(WORD, 'C.le.');
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 || n.nodeType === 3) queued.add(n);
    if (queued.size && !scheduled) { scheduled = true; (window.requestIdleCallback || setTimeout)(flush, {timeout: 400}); }
  });
  observer.observe(document.body, {childList: true, subtree: true});
  signal?.addEventListener('abort', () => observer.disconnect(), {once: true});
}
