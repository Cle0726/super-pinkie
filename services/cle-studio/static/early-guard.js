/* C.le. early guard — runs before the app module, from a same-origin file.
 *
 * The router writes the document title from `updated()` on its very first render, and it writes
 * `"<context> — OpenClaw"`. The plugin's own guard (src/core/brand.js) can only start once the
 * bundle has downloaded and activate() has run, so between the first render and activation the
 * tab still shows the upstream wordmark — observed as
 *
 *     New session — OpenClaw          (first AX sample)
 *     …becomes… Codex… — C.le.        (after the plugin loads)
 *
 * This file closes that window. It is a classic script, loaded synchronously from <head> as
 * "/cle-early.js", so it is parsed and executed before the deferred module graph runs. It needs
 * no inline script (the gateway CSP allows `script-src 'self'` but not unsafe-inline) and no
 * loosening of the policy.
 *
 * Scope is deliberately narrow — the title plus the product chrome's accessible labels:
 *   - a MutationObserver on <title> catches every later rewrite, including the " · <environment>"
 *     suffix the presentation layer appends after the fact;
 *   - the sidebar header/card labels are rebranded through a whitelist (no document-wide text
 *     replacement); a label the user or a third party owns is left exactly as written;
 *   - it only rewrites the positions the native app fills with the product name, so a session the
 *     user named "关于OpenClaw的笔记" keeps its name (see localTitle below);
 *   - installing twice is a no-op: the app's own guard and a hot reload must not stack observers.
 *
 * Timing is the whole point: this runs from <head>, so `document.body` does not exist yet. Every
 * observer therefore attaches to an ancestor that *does* exist (documentElement), and the first
 * chrome node the parser appends is caught before it is ever painted.
 *
 * The plugin guard (src/core/brand.js) additionally owns the content sweep and retires with the
 * plugin; this file is what keeps the product brand correct before activation and after teardown.
 */
(function (global) {
  'use strict';

  // Idempotent install. A second copy (double injection, or the same document re-served) must not
  // add another observer.
  var KEY = '__cleEarlyBrandGuard';
  if (global[KEY]) return;
  global[KEY] = {version: 3, installed: true};

  var BRAND_TOKEN = 'OpenClaw(?:\\s+Control)?';
  var BARE_BRAND = new RegExp('^' + BRAND_TOKEN + '$');
  var BRAND_TAIL = new RegExp('^(.* — )(' + BRAND_TOKEN + ')$');
  var ENV_TAIL = /^(.*?)( · [^·]+)$/;

  /**
   * Rebrand a title without renaming the session it describes.
   *
   *   "OpenClaw"                         -> "C.le."
   *   "OpenClaw Control"                 -> "C.le."
   *   "New session — OpenClaw"           -> "New session — C.le."
   *   "New session — OpenClaw · Prod"    -> "New session — C.le. · Prod"
   *   "关于OpenClaw的笔记 — OpenClaw"      -> "关于OpenClaw的笔记 — C.le."
   *   "关于OpenClaw的笔记"                 -> unchanged (no native brand position)
   *
   * Kept in sync with localTitle() in src/core/brand.js; the test suite asserts both agree.
   */
  function localTitle(title) {
    if (typeof title !== 'string' || title.indexOf('OpenClaw') === -1) return title;

    function rewriteCore(core) {
      if (BARE_BRAND.test(core)) return 'C.le.';
      var tail = BRAND_TAIL.exec(core);
      if (tail) return tail[1] + 'C.le.';
      return null;
    }

    var withEnv = ENV_TAIL.exec(title);
    if (withEnv) {
      var core = rewriteCore(withEnv[1]);
      if (core !== null) return core + withEnv[2];
    }
    var whole = rewriteCore(title);
    return whole === null ? title : whole;
  }

  function syncTitle() {
    var current = document.title;
    var next = localTitle(current);
    if (next !== current) document.title = next;
  }

  /* ---------- product chrome labels ---------- */

  // Only the sidebar's own header/card carry a product-name prefix in their accessible label:
  //   aria-label="${name} · <workspace menu label>"
  // where `name` falls back to the product name until the gateway answers. Everything else in the
  // document belongs to the user (messages, code, documents) or to a third party, and must not be
  // rewritten — so this list is a whitelist of product chrome, never a document-wide sweep.
  var CHROME_SELECTORS = [
    '.sidebar-workspace-header__main',
    '.sidebar-agent-card__main',
    '.sidebar-workspace-header',
    '.sidebar-agent-card',
  ];
  // One combined selector for "is / contains product chrome" checks.
  var CHROME_ALL = CHROME_SELECTORS.join(', ');
  // Separators the native composer uses between chrome parts.
  var SEPARATORS = [' · ', ' — '];

  /**
   * Rebrand a chrome label, keeping everything after the product name.
   *
   *   "OpenClaw · <workspace menu>"  -> "C.le. · <workspace menu>"
   *   "OpenClaw"                     -> "C.le."
   *   "OpenClaw Notes · …"           -> unchanged (a user-named agent)
   *   "<anything else>"              -> unchanged
   */
  function localLabel(label) {
    if (typeof label !== 'string') return label;
    if (label.indexOf('OpenClaw') !== 0) return label;
    var rest = label.slice('OpenClaw'.length);
    // The bare product token, optionally followed by " Control" (the app's own longer form).
    if (rest === '' ) return 'C.le.';
    if (rest.indexOf(' Control') === 0) {
      var afterControl = rest.slice(' Control'.length);
      if (afterControl === '' ) return 'C.le.';
      for (var c = 0; c < SEPARATORS.length; c += 1) {
        if (afterControl.indexOf(SEPARATORS[c]) === 0) return 'C.le.' + afterControl;
      }
      // "OpenClaw Controls …" is a different word, not the product token.
      return label;
    }
    // Only a separator may follow; anything else means this is a user-named agent.
    for (var i = 0; i < SEPARATORS.length; i += 1) {
      if (rest.indexOf(SEPARATORS[i]) === 0) return 'C.le.' + rest;
    }
    return label;
  }

  function chromeBlocks() {
    var out = [];
    for (var i = 0; i < CHROME_SELECTORS.length; i += 1) {
      var nodes = document.querySelectorAll(CHROME_SELECTORS[i]);
      for (var j = 0; j < nodes.length; j += 1) out.push(nodes[j]);
    }
    return out;
  }

  /** Rebrand the labels of the product chrome only. Cheap: a handful of nodes, no tree walk. */
  function syncChromeLabels() {
    var changed = 0;
    var blocks = chromeBlocks();
    for (var i = 0; i < blocks.length; i += 1) {
      var block = blocks[i];
      var nodes = [block];
      var inner = block.querySelectorAll('[aria-label]');
      for (var j = 0; j < inner.length; j += 1) nodes.push(inner[j]);
      for (var k = 0; k < nodes.length; k += 1) {
        var node = nodes[k];
        var raw = node.getAttribute && node.getAttribute('aria-label');
        var next = localLabel(raw);
        if (next !== raw) { node.setAttribute('aria-label', next); changed += 1; }
      }
    }
    return changed;
  }

  /**
   * Mark the name slot only while it still shows the upstream fallback.
   *
   * CSS cannot read text, so the stylesheet keys the wordmark rule on this attribute instead of
   * on html:not([data-cle]) — which is what made the brand vanish when the plugin retired. A
   * user-chosen name clears the mark and keeps its own glyphs.
   */
  var FALLBACK_ATTR = 'data-cle-fallback';
  var FALLBACK_TEXT = /^\s*OpenClaw(?:\s+Control)?\s*$/;
  function syncNameFallback() {
    var slots = document.querySelectorAll('.sidebar-agent-card__name-text');
    for (var i = 0; i < slots.length; i += 1) {
      var slot = slots[i];
      var text = slot.textContent || '';
      var isFallback = FALLBACK_TEXT.test(text);
      if (isFallback) {
        if (!slot.hasAttribute(FALLBACK_ATTR)) slot.setAttribute(FALLBACK_ATTR, '');
      } else if (slot.hasAttribute(FALLBACK_ATTR)) {
        slot.removeAttribute(FALLBACK_ATTR);
      }
    }
  }

  syncTitle();
  syncChromeLabels();
  syncNameFallback();

  // The router assigns document.title (a childList/characterData change inside <title>) on every
  // navigation, so watching the element itself is enough and costs nothing on unrelated churn.
  var title = document.querySelector('title');
  var watched = null;
  var observer = null;

  function attach() {
    var node = document.querySelector('title');
    if (!node || node === watched) return;
    watched = node;
    if (observer) observer.disconnect();
    observer = new MutationObserver(syncTitle);
    observer.observe(node, {childList: true, characterData: true, subtree: true});
    syncTitle();
  }

  attach();
  // <title> can be replaced wholesale by a document rewrite; re-attach if that happens.
  if (document.head) {
    new MutationObserver(attach).observe(document.head, {childList: true});
  } else if (title) {
    new MutationObserver(attach).observe(document.documentElement, {childList: true});
  }

  // Chrome labels are rewritten by the native app on sidebar re-render (and restored verbatim
  // when the plugin retires). Watch attributes plus subtree churn, throttled to one microtask so
  // a burst of renders costs one pass — and never a whole-document text walk.
  var pending = false;
  function scheduleLabels() {
    if (pending) return;
    pending = true;
    Promise.resolve().then(function () {
      pending = false;
      syncChromeLabels();
      syncNameFallback();
    });
  }

  /**
   * Is this mutation record about the product chrome?
   *
   * The observer lives on documentElement (the only ancestor that exists while <head> is still
   * being parsed), so it sees the whole document. Filtering here keeps the work bounded: only a
   * label change or an inserted node that *is* / *contains* chrome is worth a pass. Message text,
   * code and third-party nodes never match.
   */
  function touchesChrome(record) {
    if (record.type === 'attributes') {
      return record.attributeName === 'aria-label' && isChromeNode(record.target);
    }
    if (record.type === 'characterData') {
      // Text inside the name slot can flip the fallback state.
      return isNameSlot(nearestElement(record.target));
    }
    // A re-render that replaces the name's text arrives as childList on the slot itself, with the
    // target *being* the chrome node rather than an ancestor of an added one.
    if (isNameSlot(nearestElement(record.target))) return true;
    for (var i = 0; i < record.addedNodes.length; i += 1) {
      var node = record.addedNodes[i];
      if (node.nodeType !== 1) continue;
      if (isChromeNode(node) || (node.querySelector && node.querySelector(CHROME_ALL))) return true;
    }
    return false;
  }

  function nearestElement(node) {
    var el = node;
    while (el && el.nodeType !== 1) el = el.parentNode;
    return el;
  }
  function isChromeNode(node) {
    var el = nearestElement(node);
    return !!(el && el.closest && el.closest(CHROME_ALL));
  }
  function isNameSlot(el) {
    return !!(el && el.closest && el.closest('.sidebar-agent-card__name-text'));
  }


  var chromeObserver = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i += 1) {
      if (touchesChrome(records[i])) { scheduleLabels(); return; }
    }
  });
  // documentElement exists at parse time even though <body> does not yet: a <head> script runs
  // while the parser is still building the tree, so observing body here would silently never
  // attach and every later chrome change would go unguarded.
  var rootNode = document.documentElement || document.body;
  if (rootNode) {
    chromeObserver.observe(rootNode, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label'],
    });
  }

  // The first chrome node may have been appended before this script ran (or arrive in the same
  // parser turn): run once now and catch up at DOMContentLoaded. The root observer
  // above already covers module renders that happen before DOMContentLoaded.
  syncChromeLabels();
  syncNameFallback();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      syncChromeLabels();
      syncNameFallback();
    }, {once: true});
  }

  global[KEY].localTitle = localTitle;
  global[KEY].localLabel = localLabel;
  global[KEY].syncChromeLabels = syncChromeLabels;
  global[KEY].syncNameFallback = syncNameFallback;
  global[KEY].syncTitle = syncTitle;
})(typeof globalThis !== 'undefined' ? globalThis : this);
