(() => {
  "use strict";

  /* The workspace rail already owns listing, searching and navigation.  This
     layer only takes over a click when the selected file is visual material;
     text, folders and all existing rail actions remain native. */
  const PREVIEWABLE = new Map([
    ["pdf", "pdf"],
    ["html", "html"], ["htm", "html"],
    ["png", "image"], ["jpg", "image"], ["jpeg", "image"],
    ["gif", "image"], ["webp", "image"], ["avif", "image"],
    ["bmp", "image"], ["tif", "image"], ["tiff", "image"],
    ["heic", "image"], ["heif", "image"], ["svg", "image"],
  ]);
  const RAIL = ".chat-workbench > .chat-workspace-rail:not([data-laolao-fallback-rail=\"1\"])";
  const SIZE_STORAGE_KEY = "laolao-material-preview-size-v2";
  const PANEL_MARGIN = 16;
  const pending = new Map();
  const previewCleanups = new WeakMap();
  const previousResult = window.__laolaoMaterialPreviewResult;
  let requestNumber = 0;

  const extensionOf = (value) => {
    const match = String(value || "").trim().match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
    return match ? match[1].toLowerCase() : "";
  };

  const previewKind = (value) => PREVIEWABLE.get(extensionOf(value)) || null;
  const isAbsolute = (value) => /^(?:\/|[A-Za-z]:[\\/])/.test(value);

  const getRoot = (rail) => rail?.querySelector(".chat-workspace-rail__path")?.textContent?.trim() || "";

  const pathFromRow = (row, rail) => {
    const name = row?.querySelector(".chat-workspace-rail__file-name")?.textContent?.trim() || "";
    const meta = row?.querySelector(".chat-workspace-rail__file-meta")?.textContent?.trim() || "";
    /* Browser rows are rendered as `relative/path / 12 KB`; session rows
       already put their path in the name. Split only a recognised size tail,
       so normal paths with spaces remain untouched. */
    const metadataPath = meta.match(/^(.*?)\s+\/\s+\d+(?:\.\d+)?\s*(?:B|KB|MB|GB)$/i)?.[1]?.trim();
    const visiblePath = metadataPath || name;
    if (!visiblePath || !previewKind(visiblePath)) return null;
    const root = getRoot(rail);
    const path = isAbsolute(visiblePath) || !root
      ? visiblePath
      : `${root.replace(/[\\/]+$/, "")}/${visiblePath.replace(/^[\\/]+/, "")}`;
    return { name: visiblePath.split(/[\\/]/).pop() || visiblePath, path, kind: previewKind(visiblePath) };
  };

  const nativeBridgeAvailable = () => Boolean(
    window.webkit?.messageHandlers?.laolaoMaterialPreview ||
    window.pywebview?.api?.preview_material,
  );

  const nextRequestID = () => `material-${Date.now().toString(36)}-${(++requestNumber).toString(36)}`;

  const requestNativePreview = (target) => {
    const payload = { action: "open", path: target.path, kind: target.kind };
    const macHandler = window.webkit?.messageHandlers?.laolaoMaterialPreview;
    if (macHandler) {
      const requestId = nextRequestID();
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          pending.delete(requestId);
          reject(new Error("预览器没有及时回应，请再点一次。"));
        }, 8_000);
        pending.set(requestId, { resolve, reject, timeout });
        try {
          macHandler.postMessage({ ...payload, requestId });
        } catch (error) {
          window.clearTimeout(timeout);
          pending.delete(requestId);
          reject(error);
        }
      });
    }
    const windowsBridge = window.pywebview?.api?.preview_material;
    if (windowsBridge) return Promise.resolve(windowsBridge(payload));
    return Promise.reject(new Error("当前 App 还没有加载材料预览器。"));
  };

  window.__laolaoMaterialPreviewResult = (payload) => {
    const request = pending.get(payload?.requestId);
    if (!request) {
      previousResult?.(payload);
      return;
    }
    pending.delete(payload.requestId);
    window.clearTimeout(request.timeout);
    if (payload?.ok && (typeof payload.url === "string" || typeof payload.src === "string")) request.resolve(payload);
    else request.reject(new Error(payload?.message || "这个材料暂时无法预览。"));
  };

  const closePreview = (rail) => {
    const panel = rail?.querySelector(":scope > .laolao-material-preview");
    if (!panel) return;
    previewCleanups.get(panel)?.();
    panel.remove();
  };

  const clamp = (value, minimum, maximum) => Math.max(Math.min(minimum, maximum), Math.min(Number(value) || minimum, maximum));

  const previewBounds = () => ({
    maxWidth: Math.max(280, window.innerWidth - PANEL_MARGIN * 2),
    maxHeight: Math.max(240, window.innerHeight - PANEL_MARGIN * 2),
  });

  const rememberedSize = () => {
    try {
      const value = JSON.parse(window.localStorage.getItem(SIZE_STORAGE_KEY) || "null");
      return Number.isFinite(value?.width) && Number.isFinite(value?.height) ? value : null;
    } catch (_) {
      return null;
    }
  };

  const setExpandedSize = (panel, requested = rememberedSize()) => {
    const { maxWidth, maxHeight } = previewBounds();
    const width = clamp(requested?.width ?? Math.min(1080, maxWidth), Math.min(420, maxWidth), maxWidth);
    const height = clamp(requested?.height ?? Math.min(780, maxHeight), Math.min(340, maxHeight), maxHeight);
    panel.style.setProperty("--laolao-material-preview-width", `${Math.round(width)}px`);
    panel.style.setProperty("--laolao-material-preview-height", `${Math.round(height)}px`);
    return { width, height };
  };

  const rememberSize = (size) => {
    try {
      window.localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify({ width: Math.round(size.width), height: Math.round(size.height) }));
    } catch (_) {
      // Private browsing and strict storage policies must not block a preview.
    }
  };

  const attachResizeHandle = (panel, handle, signal) => {
    const stopResizing = () => document.documentElement.classList.remove("laolao-material-preview-resizing");
    handle.addEventListener("pointerdown", (event) => {
      if (!panel.classList.contains("is-expanded") || event.button !== 0) return;
      const bounds = panel.getBoundingClientRect();
      const start = { x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height };
      handle.setPointerCapture?.(event.pointerId);
      document.documentElement.classList.add("laolao-material-preview-resizing");
      event.preventDefault();
      event.stopPropagation();

      const resize = (move) => {
        if (move.pointerId !== event.pointerId) return;
        const next = setExpandedSize(panel, {
          width: start.width + move.clientX - start.x,
          height: start.height + move.clientY - start.y,
        });
        rememberSize(next);
      };
      const finish = (up) => {
        if (up.pointerId !== event.pointerId) return;
        handle.releasePointerCapture?.(event.pointerId);
        stopResizing();
        handle.removeEventListener("pointermove", resize);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
      };
      handle.addEventListener("pointermove", resize);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    }, { signal });
    signal.addEventListener("abort", stopResizing, { once: true });
  };

  const makeButton = (label, className) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.setAttribute("aria-label", label);
    button.title = label;
    return button;
  };

  const openPreview = (rail, target) => {
    closePreview(rail);
    const panel = document.createElement("section");
    panel.className = "laolao-material-preview is-loading";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", `${target.name} 预览`);
    const lifecycle = new AbortController();
    previewCleanups.set(panel, () => lifecycle.abort());

    const header = document.createElement("header");
    header.className = "laolao-material-preview__header";
    const back = makeButton("返回文件", "laolao-material-preview__back");
    back.textContent = "‹";
    const title = document.createElement("strong");
    title.className = "laolao-material-preview__title";
    title.textContent = target.name;
    title.title = target.path;
    const type = document.createElement("span");
    type.className = "laolao-material-preview__type";
    type.textContent = target.kind === "pdf" ? "PDF" : target.kind === "html" ? "HTML" : "图片";
    const expand = makeButton("放大预览", "laolao-material-preview__expand");
    expand.textContent = "⛶";
    const close = makeButton("关闭预览", "laolao-material-preview__close");
    close.textContent = "×";
    expand.addEventListener("click", () => {
      const expanded = panel.classList.toggle("is-expanded");
      if (expanded) setExpandedSize(panel);
      else {
        panel.style.removeProperty("--laolao-material-preview-width");
        panel.style.removeProperty("--laolao-material-preview-height");
      }
      resizeHandle.hidden = !expanded;
      expand.textContent = expanded ? "↙" : "⛶";
      expand.setAttribute("aria-label", expanded ? "恢复侧栏预览（右下角可自由调节大小）" : "放大预览");
      expand.title = expanded ? "恢复侧栏预览（右下角可自由调节大小）" : "放大预览";
      panel.setAttribute("aria-modal", expanded ? "true" : "false");
    });
    back.addEventListener("click", () => closePreview(rail));
    close.addEventListener("click", () => closePreview(rail));
    header.append(back, title, type, expand, close);

    const body = document.createElement("div");
    body.className = "laolao-material-preview__body";
    const loading = document.createElement("p");
    loading.className = "laolao-material-preview__loading";
    loading.textContent = target.kind === "pdf"
      ? "正在翻开 PDF…"
      : target.kind === "html" ? "正在打开 HTML…" : "正在展开图片…";
    body.append(loading);
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "laolao-material-preview__resize";
    resizeHandle.setAttribute("role", "separator");
    resizeHandle.setAttribute("aria-label", "拖动以调节预览大小");
    resizeHandle.title = "拖动以调节宽度和高度";
    resizeHandle.hidden = true;
    attachResizeHandle(panel, resizeHandle, lifecycle.signal);
    window.addEventListener("resize", () => {
      if (panel.isConnected && panel.classList.contains("is-expanded")) setExpandedSize(panel, {
        width: panel.getBoundingClientRect().width,
        height: panel.getBoundingClientRect().height,
      });
    }, { passive: true, signal: lifecycle.signal });
    panel.append(header, body, resizeHandle);
    rail.append(panel);

    requestNativePreview(target).then((result) => {
      if (!panel.isConnected) return;
      const source = result.url || result.src;
      if (!source) throw new Error("预览地址为空。");
      panel.classList.remove("is-loading");
      body.replaceChildren();
      if (target.kind === "pdf" || target.kind === "html") {
        const frame = document.createElement("iframe");
        frame.className = `laolao-material-preview__pdf laolao-material-preview__${target.kind}`;
        frame.src = source;
        frame.title = `${target.name} ${target.kind === "pdf" ? "PDF" : "HTML"} 预览`;
        /* HTML needs its own document for styles and interaction, but must
           never inherit access to or navigate the surrounding chat page. */
        if (target.kind === "html") {
          frame.setAttribute("sandbox", "allow-scripts");
          frame.referrerPolicy = "no-referrer";
        }
        body.append(frame);
      } else {
        const image = document.createElement("img");
        image.className = "laolao-material-preview__image chat-tool-card__preview-image";
        image.src = source;
        image.alt = target.name;
        image.decoding = "async";
        body.append(image);
      }
    }).catch((error) => {
      if (!panel.isConnected) return;
      panel.classList.remove("is-loading");
      const message = document.createElement("p");
      message.className = "laolao-material-preview__error";
      message.textContent = error instanceof Error ? error.message : "这个材料暂时无法预览。";
      body.replaceChildren(message);
    });
  };

  const decorateRail = (rail) => {
    if (!rail) return;
    rail.querySelectorAll(".chat-workspace-rail__file").forEach((row) => {
      const target = pathFromRow(row, rail);
      if (!target) return;
      row.classList.add("laolao-material-file");
      if (!row.querySelector(".laolao-material-file__badge")) {
        const badge = document.createElement("span");
        badge.className = "laolao-material-file__badge";
        badge.textContent = target.kind === "pdf" ? "PDF" : target.kind === "html" ? "HTML" : "图";
        row.querySelector(".chat-workspace-rail__file-main")?.append(badge);
      }
    });
  };

  document.addEventListener("pointerover", (event) => {
    const rail = event.target instanceof Element ? event.target.closest(RAIL) : null;
    if (rail) decorateRail(rail);
  }, true);

  document.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !nativeBridgeAvailable()) return;
    const origin = event.target instanceof Element ? event.target : null;
    const rail = origin?.closest(RAIL);
    const row = origin?.closest(".chat-workspace-rail__file");
    const opener = origin?.closest(".chat-workspace-rail__file-open, .chat-workspace-rail__row-action");
    if (!rail || !row || !opener) return;
    if (opener.classList.contains("chat-workspace-rail__row-action") && !/preview|预览/i.test(opener.getAttribute("aria-label") || "")) return;
    const target = pathFromRow(row, rail);
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openPreview(rail, target);
  }, true);

  const initialDecorate = () => document.querySelectorAll(RAIL).forEach(decorateRail);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialDecorate, { once: true });
  else initialDecorate();
})();
