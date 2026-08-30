(() => {
  "use strict";

  const viewerId = "laolao-image-viewer";
  let removeKeyListener = null;

  const close = () => {
    document.getElementById(viewerId)?.remove();
    removeKeyListener?.();
    removeKeyListener = null;
  };

  const open = (source, alt) => {
    if (!source) return;
    close();

    const viewer = document.createElement("div");
    viewer.id = viewerId;
    viewer.className = "laolao-image-viewer";
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-modal", "true");
    viewer.setAttribute("aria-label", "碧琪的图片放大预览");
    viewer.innerHTML = '<button class="laolao-image-viewer__close" type="button" aria-label="收起图片" title="收起图片">×</button><img class="laolao-image-viewer__image" alt="" />';

    const image = viewer.querySelector("img");
    image.src = source;
    image.alt = alt || "碧琪带来的图片";
    viewer.querySelector("button").addEventListener("click", close);
    viewer.addEventListener("click", (event) => {
      if (event.target === viewer) close();
    });

    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown, true);
    removeKeyListener = () => document.removeEventListener("keydown", onKeyDown, true);

    document.body.append(viewer);
    requestAnimationFrame(() => viewer.classList.add("is-open"));
  };

  document.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const image = event.target.closest?.(".chat-message-image, .chat-tool-card__preview-image, .cm-image img");
    if (!image) return;
    const source = image.currentSrc || image.src;
    if (!source) return;
    // OpenClaw's stock handler asks WebKit to create a new browser window.
    // Catch it first and keep the preview inside this app instead.
    event.preventDefault();
    event.stopImmediatePropagation();
    open(source, image.alt);
  }, true);
})();
