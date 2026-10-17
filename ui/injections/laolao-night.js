/* 黑夜模式开关：跟着原生「配色」（跟随系统 / 浅色 / 深色）走。
   - 页面一开始（启动画面出现之前）就按保存的配色和系统外观打上 html[data-pinkie-night]，避免夜里先闪一下白屏；
   - 原生界面之后会写 data-theme-mode，以它为准；系统外观变化时同步；
   - 同时告诉 macOS 原生层，让原生画的浏览器栏和分屏底色一起变深。 */
(() => {
  "use strict";
  if (window.__pinkieNight) return;
  const root = document.documentElement;
  const media = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  const savedMode = () => {
    try {
      const prefix = "openclaw.control.settings.v1";
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const pageGateway = `${protocol}//${location.host}`;
      const currentGateway = localStorage.getItem(`openclaw.control.currentGateway.v1:${pageGateway}`);
      const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
      const gateway = local ? `${protocol}//${location.hostname}:18789` : pageGateway;
      const keys = [currentGateway && `${prefix}:${currentGateway.replace(/\/$/, "")}`, `${prefix}:${gateway}`, `${prefix}:${pageGateway}`, `${prefix}:default`, prefix];
      for (const key of keys) {
        if (!key) continue;
        const mode = JSON.parse(localStorage.getItem(key) || "{}").themeMode;
        if (mode === "dark" || mode === "light" || mode === "system") return mode;
      }
    } catch {}
    // 出厂默认深色：没有存过偏好的设备直接进黑夜模式。
    return "dark";
  };
  const resolve = () => {
    const native = root.getAttribute("data-theme-mode");
    if (native === "dark" || native === "light") return native === "dark";
    const mode = savedMode();
    return mode === "dark" || (mode === "system" && Boolean(media?.matches));
  };
  let last = null, lastMode = null;
  const apply = () => {
    const night = resolve();
    const mode = savedMode();
    if (night === last && mode === lastMode) return;
    last = night;
    lastMode = mode;
    root.toggleAttribute("data-pinkie-night", night);
    try { window.webkit?.messageHandlers?.laolaoWindowControl?.postMessage({action: "appearance", dark: night, mode}); } catch {}
    window.dispatchEvent(new CustomEvent("pinkie:night", {detail: night}));
  };
  apply();
  // 只看根节点的一个属性，开销很小；页面卸载时断开。
  const observer = new MutationObserver(apply);
  observer.observe(root, {attributes: true, attributeFilter: ["data-theme-mode"]});
  media?.addEventListener?.("change", () => setTimeout(apply, 0));
  window.addEventListener("storage", apply);
  window.addEventListener("pagehide", () => observer.disconnect());
  window.addEventListener("pageshow", () => {
    observer.observe(root, {attributes: true, attributeFilter: ["data-theme-mode"]});
    apply();
  });
  window.__pinkieNight = {get on() { return Boolean(last); }, apply};
})();
