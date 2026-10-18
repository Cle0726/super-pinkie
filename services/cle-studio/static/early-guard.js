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
 * Scope is deliberately narrow — it owns the title and nothing else:
 *   - a MutationObserver on <title> catches every later rewrite, including the " · <environment>"
 *     suffix the presentation layer appends after the fact;
 *   - it only rewrites the positions the native app fills with the product name, so a session the
 *     user named "关于OpenClaw的笔记" keeps its name (see localTitle below);
 *   - installing twice is a no-op: the app's own guard and a hot reload must not stack observers.
 *
 * The plugin guard stays authoritative for the sidebar labels and the content sweep; this file
 * fixes the title because the title is the one thing painted before any plugin code can run.
 */
(function (global) {
  'use strict';

  // Idempotent install. A second copy (double injection, or the same document re-served) must not
  // add another observer.
  var KEY = '__cleEarlyBrandGuard';
  if (global[KEY]) return;
  global[KEY] = {version: 1, installed: true};

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

  syncTitle();

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

  global[KEY].localTitle = localTitle;
  global[KEY].syncTitle = syncTitle;
})(typeof globalThis !== 'undefined' ? globalThis : this);
