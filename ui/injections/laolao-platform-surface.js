/* 拿不到顺畅的 WebGL（软件渲染、驱动被关掉、WebKit 判定有性能顾虑）时，
   关掉 3D 碧琪、氛围画布和毛玻璃。这些效果会占满主线程，8GB 的机器一开窗口就换页。 */
(() => {
  "use strict";
  if (window.__pinkieSurface) return;
  let software = false, renderer = "unavailable";
  try {
    const gl = document.createElement("canvas").getContext("webgl", {failIfMajorPerformanceCaveat: true});
    if (!gl) software = true;
    else {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      software = /swiftshader|basic render driver|llvmpipe|software/i.test(renderer);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch { software = true; }
  const lite = software
    || document.documentElement.hasAttribute("data-pinkie-lite")
    || Boolean(navigator.deviceMemory && navigator.deviceMemory <= 8)
    || (typeof localStorage !== "undefined" && localStorage.getItem("pinkie-lite") === "1");
  window.__pinkieSurface = Object.freeze({software, renderer, lite});
  if (!lite) return;
  document.documentElement.setAttribute("data-pinkie-lite", "");
  if (!document.getElementById("pinkie-lite")) {
    const sheet = document.createElement("style");
    sheet.id = "pinkie-lite";
    sheet.textContent = "html[data-pinkie-lite] *, html[data-pinkie-lite] *::before, html[data-pinkie-lite] *::after { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }";
    document.head.append(sheet);
  }
})();
