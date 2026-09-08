/* CLE Kk：只保留上游真正负责状态的“更多”按钮。 */
(() => {
  "use strict";

  const syncMoreButton = () => {
    const nav = document.querySelector("aside.sidebar .sidebar-nav");
    if (!nav) return;

    /* 只删旧注入追加到 nav 直属层的按钮，不能删原生 nav-section 内的按钮。 */
    nav.querySelectorAll(":scope > .laolao-classic-more").forEach((node) => {
      if (!node.closest(".nav-section--more")) node.remove();
    });

    const native = nav.querySelector(":scope > .nav-section.nav-section--more > .nav-section__label");
    if (!native) return;
    native.classList.add("laolao-classic-more");
    native.setAttribute("type", "button");
  };

  let frame = 0;
  const scheduleSync = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      syncMoreButton();
    });
  };
  const observer = new MutationObserver(scheduleSync);
  const start = () => {
    syncMoreButton();
    const nav = document.querySelector("aside.sidebar .sidebar-nav");
    if (nav) observer.observe(nav, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.addEventListener("pagehide", () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
  }, { once: true });
})();
