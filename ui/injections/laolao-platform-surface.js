/* Rendering diagnostics only. Both platforms keep the complete Mac visuals. */
(() => {
  "use strict";
  if (window.__pinkieSurface) return;
  let software = false, renderer = "unavailable";
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (gl) {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      software = /swiftshader|basic render driver|llvmpipe|software/i.test(renderer);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } else software = true;
  } catch { software = true; }
  window.__pinkieSurface = Object.freeze({software, renderer});
  // Clear the retired Windows-only global suppression, including cached copies.
  document.documentElement.removeAttribute("data-pinkie-lite");
  document.getElementById("pinkie-lite")?.remove();
})();
