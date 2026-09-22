(() => {
  "use strict";

  /* Warm only static, same-origin destinations. Chat/session data, tool
     output, and workspace file contents remain demand-loaded and authoritative
     to the native client; this is a cache hint, never a second data loader. */
  const warmedRoutes = new Set();
  const MAX_IDLE_ROUTES = 3;
  const MAX_WARMED_ROUTES = 8;

  const hasConstrainedConnection = () => {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return connection?.saveData === true || /(^|-)2g/.test(connection?.effectiveType || "");
  };

  const scheduleIdle = (callback) => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(callback, { timeout: 1800 });
    } else {
      window.setTimeout(callback, 420);
    }
  };

  const routeFrom = (href) => {
    if (!href || hasConstrainedConnection()) return null;
    let url;
    try { url = new URL(href, window.location.href); } catch { return null; }
    if (url.origin !== window.location.origin || url.hash || url.pathname.startsWith("/__openclaw__/")) return null;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return null;
    /* A session route can carry a long live transcript. Let the existing chat
       client load that exactly once instead of prefetching a stale snapshot. */
    if (url.pathname.startsWith("/chat") || url.searchParams.has("session")) return null;
    return url.href;
  };

  const warmRoute = (href) => {
    const route = routeFrom(href);
    if (!route || warmedRoutes.has(route) || warmedRoutes.size >= MAX_WARMED_ROUTES) return;
    warmedRoutes.add(route);
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "document";
    link.href = route;
    link.fetchPriority = "low";
    link.dataset.laolaoRouteWarmup = "1";
    document.head.append(link);
  };

  const warmModeArt = () => {
    const motion = window.PinkieMotion;
    if (!motion) return;
    /* PinkieMotion keeps a shared promise cache, so this costs nothing if the
       switcher already warmed these images. Decode only in an idle slice. */
    ["chat", "project", "thinking", "learning", "unrestricted"].forEach((id) => {
      void motion.modeAssets(id);
    });
  };

  const warmLikelyRoutes = () => {
    const links = [...document.querySelectorAll("aside.sidebar a[href], .dashboard-header a[href]")];
    let count = 0;
    for (const link of links) {
      const before = warmedRoutes.size;
      warmRoute(link.href);
      if (warmedRoutes.size > before && ++count >= MAX_IDLE_ROUTES) break;
    }
  };

  document.addEventListener("pointerover", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (link) warmRoute(link.href);
  }, { capture: true, passive: true });

  document.addEventListener("focusin", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (link) warmRoute(link.href);
  }, true);

  const start = () => scheduleIdle(() => {
    warmModeArt();
    warmLikelyRoutes();
  });

  window.addEventListener("laolao:splash-cleared", start, { once: true });
  window.addEventListener("laolao:modechange", () => scheduleIdle(warmModeArt));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
