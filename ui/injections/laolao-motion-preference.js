/* One motion setting for every machine.
 *
 * Effects are part of 碧琪's identity, so the OS "reduce motion" flag no longer
 * decides them: on Windows it is switched on implicitly by "Adjust for best
 * performance" / "Show animations" off, which silently stripped the animations
 * on many PCs. Everyone gets the full effects by default; people who need
 * calmer motion turn on 设置 → 外观与声音 → 减少动效.
 *
 * The 60+ existing `prefers-reduced-motion` rules stay untouched in source. This
 * script answers them from the app setting instead:
 *  - window.matchMedia queries that mention prefers-reduced-motion,
 *  - CSS @media rules (rewritten in place, including styles added later).
 * Must load right after laolao-night.js, before any other injection. */
(() => {
  "use strict";
  if (window.__pinkieMotion) return;
  const KEY = "pinkie.motion.reduce.v1";
  const QUERY = /\(\s*prefers-reduced-motion\s*(?::\s*(reduce|no-preference)\s*)?\)/gi;
  const ALWAYS = "(min-width: 0px)";
  const NEVER = "(max-width: 0.001px)";
  const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
  let reduce = read();

  const resolve = (text) => text.replace(QUERY, (_m, value) => {
    const wantsReduce = (value || "reduce").toLowerCase() === "reduce";
    return wantsReduce === reduce ? ALWAYS : NEVER;
  });

  // --- matchMedia -----------------------------------------------------------
  const nativeMatchMedia = window.matchMedia.bind(window);
  const lists = new Set();
  class MotionQueryList extends EventTarget {
    constructor(query) { super(); this.media = query; this.onchange = null; }
    get matches() { return nativeMatchMedia(resolve(this.media)).matches; }
    addListener(fn) { if (typeof fn === "function") this.addEventListener("change", fn); }
    removeListener(fn) { if (typeof fn === "function") this.removeEventListener("change", fn); }
  }
  window.matchMedia = function matchMedia(query) {
    const text = String(query);
    QUERY.lastIndex = 0;
    if (!QUERY.test(text)) return nativeMatchMedia(text);
    QUERY.lastIndex = 0;
    const list = new MotionQueryList(text);
    lists.add(list);
    return list;
  };

  // --- CSS @media rules -----------------------------------------------------
  const originals = new WeakMap();
  const rewriteRules = (rules) => {
    for (const rule of rules) {
      if (typeof CSSMediaRule !== "undefined" && rule instanceof CSSMediaRule) {
        let original = originals.get(rule);
        if (original == null) {
          QUERY.lastIndex = 0;
          if (QUERY.test(rule.media.mediaText)) { original = rule.media.mediaText; originals.set(rule, original); }
        }
        if (original != null) {
          const next = resolve(original);
          if (rule.media.mediaText !== next) rule.media.mediaText = next;
        }
      }
      if (rule.cssRules) rewriteRules(rule.cssRules);
    }
  };
  const rewriteSheet = (sheet) => {
    try { if (sheet?.cssRules) rewriteRules(sheet.cssRules); } catch { /* cross-origin */ }
  };
  const rewriteAll = () => {
    for (const sheet of document.styleSheets) rewriteSheet(sheet);
    for (const sheet of document.adoptedStyleSheets || []) rewriteSheet(sheet);
  };
  const watchNode = (node) => {
    if (node.nodeType !== 1) return;
    const targets = node.matches?.("style, link[rel~='stylesheet']") ? [node] : node.querySelectorAll?.("style, link[rel~='stylesheet']") || [];
    for (const el of targets) {
      if (el.tagName === "LINK" && !el.sheet) el.addEventListener("load", () => rewriteSheet(el.sheet), {once: true});
      else rewriteSheet(el.sheet);
    }
  };
  new MutationObserver((records) => {
    for (const record of records) {
      // A <style> whose text changed is re-parsed and loses the rewrite.
      const style = record.target.nodeType === 1 ? record.target.closest?.("style") : record.target.parentElement?.closest?.("style");
      if (style) rewriteSheet(style.sheet);
      record.addedNodes.forEach(watchNode);
    }
  }).observe(document.documentElement, {childList: true, subtree: true, characterData: true});
  document.querySelectorAll("style, link[rel~='stylesheet']").forEach(watchNode);
  document.addEventListener("DOMContentLoaded", rewriteAll, {once: true});
  window.addEventListener("load", rewriteAll, {once: true});

  // --- the setting ----------------------------------------------------------
  const tellShell = () => {
    try { window.webkit?.messageHandlers?.pinkieMotion?.postMessage({reduce}); } catch {}
  };
  const apply = (next) => {
    const before = new Map([...lists].map((list) => [list, list.matches]));
    reduce = Boolean(next);
    document.documentElement.toggleAttribute("data-pinkie-reduce-motion", reduce);
    rewriteAll();
    for (const [list, was] of before) {
      if (list.matches === was) continue;
      const event = new Event("change");
      Object.defineProperties(event, {matches: {value: list.matches}, media: {value: list.media}});
      list.onchange?.call(list, event);
      list.dispatchEvent(event);
    }
    tellShell();
    window.dispatchEvent(new CustomEvent("pinkie:motion-change", {detail: {reduce}}));
  };
  document.documentElement.toggleAttribute("data-pinkie-reduce-motion", reduce);
  tellShell();
  window.addEventListener("storage", (event) => { if (event.key === KEY) apply(read()); });
  window.__pinkieMotion = Object.freeze({
    get reduce() { return reduce; },
    set(value) {
      try { localStorage.setItem(KEY, value ? "1" : "0"); } catch {}
      apply(value);
    },
  });
})();
