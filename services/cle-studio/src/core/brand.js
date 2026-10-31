// Nothing that is not C.le. reaches the screen: upstream promotion, community links,
// mascots and brand words. CSS hides known components; this pass catches the rest.
//
// The native app owns two things this pass exists for, and both are re-written *after* the
// plugin loads:
//
//   1. document.title. The router calls syncDocumentTitle() on every navigation and on every
//      runtime update: `${context} — OpenClaw`, plus ` · ${environment.label}` when an
//      environment is set. It is appended to whatever the title currently is, so a one-shot
//      fix is not enough — and the assignment happens on <title> inside <head>, which an
//      observer scoped to document.body can never see.
//   2. Sidebar chrome: the workspace header's aria-label is `${name} · 工作区菜单` where the
//      name falls back to the upstream product name before the gateway answers.
//
// The rules below are deliberately narrow: only the document title and the sidebar's own
// chrome are touched. Message bodies, code blocks, documents and user links are never
// rewritten.
const HIDE = [
  '.sidebar-shell__invite', '.community-invite-card', 'aside.invite',
];
// Upstream promotion links. Each alternative is anchored to a full host (or a full path prefix on
// github.com) so an unrelated host such as openclaw.ai.example.com is not swallowed, and so a
// link a user pasted into a reply keeps working.
const EXTERNAL_HOSTS = [
  'reddit\\.com', 'discord\\.gg', 'discord\\.com', 'x\\.com', 'twitter\\.com',
  'clawhub\\.ai', 'openclaw\\.ai', 'docs\\.openclaw\\.ai',
];
const EXTERNAL = new RegExp(
  `^https?://(?:www\\.)?(?:${EXTERNAL_HOSTS.join('|')})(?::\\d+)?(?:[/?#]|$)`
  + '|^https?://(?:www\\.)?github\\.com/openclaw(?:[/?#]|$)',
  'i',
);
const WORD = /OpenClaw(?:\s+Control)?/g;
// Rebrand the application's chrome, never the user's messages, source code,
// documents or useful links in a reply.
const CONTENT = '.chat-group, .chat-text, .chat-bubble, pre, code, textarea, input, [contenteditable="true"], .monaco-editor, .pinkie-library-reader, .laolao-learning-notes';

// The workspace header renders one of two marks depending on the theme: a span (when the theme
// sets mascot "none") or an <img src=favicon.svg>. The label is a separate node, and the name
// text is wrapped by the hover-marquee helper as
//   span.sidebar-agent-card__name-text.hover-marquee > span.hover-marquee__text
// so a rule that only targets the outer span has to zero the font-size to reach the inner text.
const CHROME = '.sidebar-workspace-header__main, .sidebar-agent-card__main, .sidebar-workspace-header, .sidebar-agent-card';
// Separator the native app uses between chrome parts in labels ("name · 工作区菜单").
const LABEL_SEPARATORS = [' · ', ' — '];

export function brandStyles() {
  return `${HIDE.join(',')}{display:none!important}`;
}

// The brand token as the router writes it: "OpenClaw" or "OpenClaw Control".
const BRAND_TOKEN = 'OpenClaw(?:\\s+Control)?';
const BARE_BRAND = new RegExp(`^${BRAND_TOKEN}$`, 'u');
// Native composition (control-ui-core Uc()): "[<n> ]<context> — <brand>", and
// applyControlUiPresentation() may then append " · <environment>".
const BRAND_TAIL = new RegExp(`^(.* — )(${BRAND_TOKEN})$`, 'u');
// The trailing " · <environment>" segment. Non-greedy so the *last* middot wins, and a context
// that itself contains " · " still lands on the brand tail in the fallback pass below.
const ENV_TAIL = /^(.*?)( · [^·]+)$/u;

/**
 * Rebrand a document title without renaming the session it describes.
 *
 * Only the positions the native app itself fills with the product name are rewritten:
 *
 *   "OpenClaw"                          → "C.le."          (startup, no session context)
 *   "OpenClaw Control"                  → "C.le."
 *   "Main Session — OpenClaw"           → "Main Session — C.le."
 *   "(2) Chat — OpenClaw · Production"  → "(2) Chat — C.le. · Production"
 *
 * A title whose *context* happens to contain the word is left alone, because that word is the
 * user's: "关于OpenClaw的笔记 — OpenClaw" → "关于OpenClaw的笔记 — C.le.", and a bare
 * "关于OpenClaw的笔记" (no native tail) is returned unchanged.
 */
export function localTitle(title) {
  if (typeof title !== 'string' || !title.includes('OpenClaw')) return title;

  const rewriteCore = (core) => {
    if (BARE_BRAND.test(core)) return 'C.le.';
    const tail = BRAND_TAIL.exec(core);
    if (tail) return `${tail[1]}C.le.`;
    return null;
  };

  // Try the form with an environment suffix first; if that core is not a native brand tail, fall
  // back to the whole string so a context containing " · " is still handled.
  const withEnv = ENV_TAIL.exec(title);
  if (withEnv) {
    const core = rewriteCore(withEnv[1]);
    if (core !== null) return `${core}${withEnv[2]}`;
  }
  return rewriteCore(title) ?? title;
}

/**
 * Rebrand one aria-label built from chrome parts, e.g. "OpenClaw · 工作区菜单".
 * Only the leading product name is replaced; the rest of the label is kept verbatim so the
 * accessible name still says what the control does.
 */
export function localLabel(label) {
  if (typeof label !== 'string') return label;
  if (!label.startsWith('OpenClaw')) return label;
  const rest = label.slice('OpenClaw'.length);
  // The bare product token, optionally followed by " Control" (the app's own longer form).
  if (rest === '') return 'C.le.';
  if (rest.startsWith(' Control')) {
    const afterControl = rest.slice(' Control'.length);
    if (afterControl === '') return 'C.le.';
    // "OpenClaw Controls …" is a different word, not the product token.
    return LABEL_SEPARATORS.some((sep) => afterControl.startsWith(sep)) ? `C.le.${afterControl}` : label;
  }
  // Only a separator or the end of the string may follow the product name. Anything else means
  // this is not the product-name prefix (e.g. a user-named agent called "OpenClaw Notes").
  return LABEL_SEPARATORS.some((sep) => rest.startsWith(sep)) ? `C.le.${rest}` : label;
}

function sweep(root) {
  for (const a of root.querySelectorAll?.('a[href]') || []) {
    if (a.closest(CONTENT)) continue;
    if (EXTERNAL.test(a.href)) { a.removeAttribute('href'); a.hidden = true; }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (isProtectedText(n)) continue;
    if (isAgentNameText(n)) continue;
    if (n.nodeValue && n.nodeValue.includes('OpenClaw')) n.nodeValue = n.nodeValue.replace(WORD, 'C.le.');
  }
}

/**
 * The agent name in the workspace header is a *user* choice once the gateway answers, and the
 * native fallback is the bare product word. CSS already rebrands the fallback while the plugin
 * is loading; rewriting the node here would also rename an agent genuinely called "OpenClaw".
 * So only the exact fallback string is replaced, and only while it is still the bare word.
 */
function isAgentNameText(node) {
  const element = node.nodeType === 1 ? node : (node.parentElement ?? node.parentNode);
  if (!element?.closest) return false;
  if (!element.closest('.sidebar-agent-card__name-text')) return false;
  return node.nodeValue !== 'OpenClaw';
}

/**
 * Product words inside a text node, but only in chrome.
 *
 * The blunt rule is "never touch user content". The subtlety is that a text node's parent is
 * not always an Element with closest() in every engine path, and a node can be a *descendant*
 * of protected content, so the guard is applied to the nearest element ancestor.
 */
function isProtectedText(node) {
  // Text.parentElement exists in browsers, but walk to the nearest element anyway so the rule
  // holds for detached fragments and for harnesses that build bare nodes.
  let element = node.nodeType === 1 ? node : (node.parentElement ?? node.parentNode);
  while (element && element.nodeType !== 1) element = element.parentNode;
  if (!element?.closest) return false;
  return Boolean(element.closest(CONTENT));
}

/** The chrome container a mutation belongs to, so a batch only re-reads that sidebar block. */
function chromeScopeFor(node) {
  if (!node) return null;
  let element = node.nodeType === 1 ? node : (node.parentElement ?? node.parentNode);
  while (element && element.nodeType !== 1) element = element.parentNode;
  return element?.closest?.(CHROME) ?? null;
}

/**
 * Mark the name slot only while it still shows the upstream fallback.
 *
 * The stylesheet keys the wordmark rule on this attribute rather than on html:not([data-cle]),
 * because the latter made the brand disappear the moment the plugin retired. A user-chosen name
 * clears the mark and keeps its own glyphs.
 */
const FALLBACK_ATTR = 'data-cle-fallback';
const FALLBACK_TEXT = /^\s*OpenClaw(?:\s+Control)?\s*$/u;
export function syncNameFallback(root = document) {
  let changed = 0;
  for (const slot of root.querySelectorAll?.('.sidebar-agent-card__name-text') || []) {
    const isFallback = FALLBACK_TEXT.test(slot.textContent || '');
    if (isFallback) {
      if (!slot.hasAttribute(FALLBACK_ATTR)) { slot.setAttribute(FALLBACK_ATTR, ''); changed += 1; }
    } else if (slot.hasAttribute(FALLBACK_ATTR)) {
      slot.removeAttribute(FALLBACK_ATTR);
      changed += 1;
    }
  }
  return changed;
}

/** Chrome-only pass: sidebar labels and marks. Returns how many nodes it changed. */
export function sweepChrome(root = document) {
  let changed = 0;
  // The label sits on the button/card element itself, and the product name is only the leading
  // part — so walk the labelled nodes inside the sidebar and let localLabel decide. The scope may
  // be the sidebar block itself (from a mutation batch) or the document (initial pass).
  // querySelector would return only the first chrome block; every block (workspace header and
  // the agent card in roster mode) carries its own label, so collect them all.
  const blocks = root.closest?.(CHROME) ? [root] : [...(document.querySelectorAll?.(CHROME) || [])];
  if (!blocks.length) blocks.push(root);
  const labelled = [];
  for (const block of blocks) {
    labelled.push(...(block.querySelectorAll?.('[aria-label]') || []));
    if (block.nodeType === 1 && block.getAttribute?.('aria-label')) labelled.push(block);
  }
  const seen = new Set();
  for (const node of labelled) {
    if (seen.has(node)) continue;
    seen.add(node);
    if (!node.closest?.(CHROME)) continue;
    const label = node.getAttribute('aria-label');
    const next = localLabel(label);
    if (next !== label) { node.setAttribute('aria-label', next); changed += 1; }
  }
  changed += syncNameFallback(root);
  return changed;
}

/** Title sync. Cheap enough to run on every mutation batch: one string compare. */
export function syncTitle() {
  const next = localTitle(document.title);
  if (next === document.title) return false;
  document.title = next;
  return true;
}

export function startBrandGuard(signal) {
  syncTitle();
  sweep(document.body);
  sweepChrome(document);

  let queued = new Set();
  let scheduled = false;
  let disposed = false;
  const flush = () => {
    scheduled = false;
    if (disposed) return;
    const nodes = queued; queued = new Set();
    // The title is written by the router at any time, including when the only mutation was in
    // <head>. Check it on every batch rather than only when body nodes were queued.
    syncTitle();
    // Chrome labels are cheap to re-read (a handful of nodes), so refresh only the block each
    // mutation belongs to — never the whole document.
    for (const node of nodes) {
      if (!node.isConnected) continue;
      const scope = chromeScopeFor(node);
      if (scope) sweepChrome(scope);
      sweep(node.nodeType === 1 ? node : node.parentNode || document.body);
    }
  };
  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    // Title and labels are user-visible chrome, so they must not wait for an idle window: a
    // background tab would sit on the upstream wordmark for up to `timeout`. A microtask runs
    // after the current task, before the next paint, which is the tightest correct moment.
    // The sweep itself is bounded to the mutated nodes, so this stays cheap.
    Promise.resolve().then(flush);
  };

  const observer = new MutationObserver((records) => {
    let dirty = false;
    for (const r of records) {
      if (r.type === 'characterData') { if (r.target) queued.add(r.target); dirty = true; continue; }
      if (r.type === 'attributes') {
        // An aria-label-only change carries no added node, so the target itself has to be queued:
        // flush walks the queue, and a bare dirty flag would reach neither chromeScopeFor nor
        // sweepChrome — the label would keep the upstream wordmark forever.
        if (r.target) queued.add(r.target);
        dirty = true;
        continue;
      }
      for (const n of r.addedNodes) if (n.nodeType === 1 || n.nodeType === 3) queued.add(n);
      dirty = true;
    }
    if (dirty) schedule();
  });

  // childList/subtree and characterData cover late text and late subtrees; attributes is
  // limited to the attribute the router actually writes, so unrelated churn stays free.
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label'],
  });
  // <head> is observed separately and only for the title element: the router assigns
  // document.title (a characterData change inside <title>) and appends " · environment".
  const titleNode = document.querySelector('title');
  if (titleNode) observer.observe(titleNode, {childList: true, characterData: true, subtree: true});
  // document.title = "..." replaces the text node wholesale, which shows up as a childList
  // change on <title>; some paths instead mutate the existing node. Both are covered above,
  // and <head> is watched too in case <title> itself is created late.
  const head = document.head;
  if (head) observer.observe(head, {childList: true, subtree: false});

  const stop = () => {
    disposed = true;
    observer.disconnect();
    queued.clear();
  };
  signal?.addEventListener('abort', stop, {once: true});
  if (!signal) return stop;
  return stop;
}
