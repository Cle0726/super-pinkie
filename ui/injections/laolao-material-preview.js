(() => {
  "use strict";

  /* The rail keeps its existing navigation; this layer adds a small native
     file menu and opens previews only after a user click. */
  const PREVIEWABLE = new Map([
    ["pdf", "pdf"],
    ["html", "html"], ["htm", "html"],
    ["png", "image"], ["jpg", "image"], ["jpeg", "image"],
    ["gif", "image"], ["webp", "image"], ["avif", "image"],
    ["bmp", "image"], ["tif", "image"], ["tiff", "image"],
    ["heic", "image"], ["heif", "image"], ["svg", "image"],
    ["mp4", "video"], ["mov", "video"], ["m4v", "video"], ["webm", "video"],
    ["mp3", "audio"], ["m4a", "audio"], ["wav", "audio"],
    ["md", "text"], ["markdown", "text"], ["txt", "text"], ["text", "text"],
    ["log", "text"], ["csv", "text"], ["tsv", "text"], ["json", "text"],
    ["yaml", "text"], ["yml", "text"], ["xml", "text"], ["toml", "text"],
    ["ini", "text"], ["conf", "text"], ["swift", "text"], ["py", "text"],
    ["js", "text"], ["mjs", "text"], ["cjs", "text"], ["ts", "text"],
    ["tsx", "text"], ["jsx", "text"], ["css", "text"], ["scss", "text"],
    ["sh", "text"], ["bash", "text"], ["zsh", "text"], ["c", "text"],
    ["h", "text"], ["cpp", "text"], ["hpp", "text"], ["rs", "text"],
    ["go", "text"], ["java", "text"], ["kt", "text"], ["rb", "text"],
    ["php", "text"], ["sql", "text"], ["diff", "text"], ["patch", "text"],
    ["plist", "text"],
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

  const previewKind = (value) => PREVIEWABLE.get(extensionOf(value)) || "external";
  const isAbsolute = (value) => /^(?:\/|[A-Za-z]:[\\/])/.test(value);
  const revealLabel = () => /Windows/i.test(window.navigator?.userAgent || "") ? "在文件夹中显示" : "在访达中显示";

  const getRoot = (rail) => rail?.querySelector(".chat-workspace-rail__path")?.textContent?.trim() || "";

  const pathFromRow = (row, rail) => {
    const name = row?.querySelector(".chat-workspace-rail__file-name")?.textContent?.trim() || "";
    const meta = row?.querySelector(".chat-workspace-rail__file-meta")?.textContent?.trim() || "";
    /* Browser rows are rendered as `relative/path / 12 KB`; session rows
       already put their path in the name. Split only a recognised size tail,
       so normal paths with spaces remain untouched. */
    const metadataPath = meta.match(/^(.*?)\s+\/\s+\d+(?:\.\d+)?\s*(?:B|KB|MB|GB)$/i)?.[1]?.trim();
    const visiblePath = metadataPath || name;
    if (!visiblePath) return null;
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

  const requestNativeAction = (target, action) => {
    const payload = { action, path: target.path, kind: target.kind };
    const macHandler = window.webkit?.messageHandlers?.laolaoMaterialPreview;
    if (macHandler) {
      const requestId = nextRequestID();
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          pending.delete(requestId);
          reject(new Error("文件操作没有及时回应，请再点一次。"));
        }, action === "save" ? 120_000 : 8_000);
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
    return Promise.reject(new Error("当前 App 还没有加载文件操作功能。"));
  };

  window.__laolaoMaterialPreviewResult = (payload) => {
    const request = pending.get(payload?.requestId);
    if (!request) {
      previousResult?.(payload);
      return;
    }
    pending.delete(payload.requestId);
    window.clearTimeout(request.timeout);
    if (payload?.ok) request.resolve(payload);
    else request.reject(new Error(payload?.message || "这个材料暂时无法预览。"));
  };

  const closePreview = (rail) => {
    const panels = [...document.querySelectorAll(".laolao-material-preview")];
    if (!panels.length) {
      const panel = rail?.querySelector(":scope > .laolao-material-preview");
      if (panel) panels.push(panel);
    }
    panels.forEach((panel) => {
      previewCleanups.get(panel)?.();
      panel.remove();
    });
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

  const runFileAction = (target, action, rail) => {
    const selectedAction = action === "preview" && target.kind === "external" ? "open-default" : action;
    if (selectedAction === "preview") {
      openPreview(rail, target);
      return;
    }
    requestNativeAction(target, selectedAction).then((result) => {
      if (selectedAction === "save") {
        revealToast({ message: `已保存到下载：「${target.name}」`, path: result.path, actionLabel: revealLabel() });
      } else if (selectedAction === "open-default") {
        revealToast({ message: `已用默认应用打开「${target.name}」`, path: target.path, actionLabel: revealLabel() });
      } else if (selectedAction === "open") {
        openPreview(rail, target, result);
      }
    }).catch((error) => showFileActionError(error?.message || "文件操作失败。"));
  };

  let actionMenu = null;
  const closeActionMenu = () => {
    actionMenu?.remove();
    actionMenu = null;
  };

  const showFileActionError = (message) => {
    const menu = document.createElement("div");
    menu.className = "laolao-material-menu laolao-material-menu--error";
    menu.textContent = message;
    document.body.append(menu);
    const left = Math.max(12, Math.min(window.innerWidth - 300, (window.innerWidth - 280) / 2));
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(12, window.innerHeight - 92)}px`;
    window.setTimeout(() => menu.remove(), 4200);
  };

  const showActionMenu = (target, anchor, rail = null) => {
    closeActionMenu();
    const menu = document.createElement("div");
    menu.className = "laolao-material-menu";
    menu.setAttribute("role", "menu");
    const entries = [
      [target.kind === "external" ? "用默认应用打开" : "预览", "preview"],
      ["保存到下载", "save"],
      [revealLabel(), "reveal"],
    ];
    for (const [label, action] of entries) {
      const button = makeButton(label, "laolao-material-menu__item");
      button.textContent = label;
      button.setAttribute("role", "menuitem");
      button.addEventListener("click", () => {
        closeActionMenu();
        runFileAction(target, action, rail);
      });
      menu.append(button);
    }
    document.body.append(menu);
    const bounds = anchor?.getBoundingClientRect?.();
    const left = Math.max(10, Math.min(window.innerWidth - 210, bounds?.left ?? (window.innerWidth - 200) / 2));
    const top = Math.max(10, Math.min(window.innerHeight - 160, (bounds?.bottom ?? 40) + 5));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    actionMenu = menu;
  };

  const checkAndShowActionMenu = (target, anchor, rail) => {
    requestNativeAction(target, "check")
      .then(() => showActionMenu(target, anchor, rail))
      .catch((error) => showFileActionError(error?.message || "这个文件不存在或无法打开。"));
  };

  const revealToast = (payload) => {
    document.getElementById("laolao-material-preview-toast")?.remove();
    const toast = document.createElement("div");
    toast.id = "laolao-material-preview-toast";
    toast.className = "laolao-material-toast";
    toast.setAttribute("role", "status");
    const message = document.createElement("span");
    message.textContent = payload?.message || "文件操作已完成。";
    toast.append(message);
    if (typeof payload?.path === "string" && payload.path) {
      const label = payload.actionLabel || revealLabel();
      const reveal = makeButton(label, "laolao-material-toast__reveal");
      reveal.textContent = label;
      reveal.addEventListener("click", () => {
        reveal.disabled = true;
        requestNativeAction({ path: payload.path }, "reveal").then(() => {
          message.textContent = "已经在访达中显示。";
          window.setTimeout(() => toast.remove(), 1800);
        }).catch((error) => {
          message.textContent = error?.message || "无法在访达中显示这个文件。";
          reveal.disabled = false;
        });
      });
      toast.append(reveal);
    }
    document.body.append(toast);
    window.setTimeout(() => toast.remove(), 12_000);
  };
  window.__laolaoMaterialPreviewToast = revealToast;

  const typeLabel = (kind) => ({
    pdf: "PDF", html: "HTML", image: "图片", video: "视频", audio: "音频", text: "文本",
  }[kind] || "文件");

  const openPreview = (rail, target, registered = null) => {
    rail = rail && (rail.getBoundingClientRect?.().width || 0) >= 260 ? rail : null;
    if (target.kind === "external") {
      requestNativeAction(target, "open-default").then((result) => {
        revealToast({ message: `已用默认应用打开「${target.name}」`, path: target.path, actionLabel: revealLabel() });
        return result;
      }).catch((error) => showFileActionError(error?.message || "无法打开这个文件。"));
      return;
    }
    closePreview(rail);
    const panel = document.createElement("section");
    panel.className = `laolao-material-preview is-loading${rail ? "" : " is-detached"}`;
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
    type.textContent = typeLabel(target.kind);
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
    loading.textContent = target.kind === "pdf" ? "正在翻开 PDF…"
      : target.kind === "html" ? "正在打开 HTML…"
      : target.kind === "video" ? "正在加载视频…"
      : target.kind === "audio" ? "正在加载音频…"
      : target.kind === "text" ? "正在读取文本…" : "正在展开图片…";
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
    (rail || document.body).append(panel);

    (registered ? Promise.resolve(registered) : requestNativeAction(target, "open")).then((result) => {
      if (!panel.isConnected) return;
      const source = result.url || result.src;
      if (!source) throw new Error("预览地址为空。");
      panel.classList.remove("is-loading");
      body.replaceChildren();
      if (["pdf", "html", "text"].includes(target.kind)) {
        const frame = document.createElement("iframe");
        frame.className = `laolao-material-preview__document laolao-material-preview__${target.kind}`;
        frame.src = source;
        frame.title = `${target.name} ${typeLabel(target.kind)} 预览`;
        /* HTML needs its own document for styles and interaction, but must
           never inherit access to or navigate the surrounding chat page. */
        if (target.kind === "html") {
          frame.setAttribute("sandbox", "allow-scripts");
          frame.referrerPolicy = "no-referrer";
        } else if (target.kind === "text") {
          frame.setAttribute("sandbox", "");
        }
        body.append(frame);
      } else if (target.kind === "video" || target.kind === "audio") {
        const media = document.createElement(target.kind);
        media.className = `laolao-material-preview__media laolao-material-preview__${target.kind}`;
        media.src = source;
        media.controls = true;
        media.preload = "metadata";
        media.setAttribute("playsinline", "");
        media.setAttribute("aria-label", target.name);
        body.append(media);
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
      if (target.kind !== "external" && !row.querySelector(".laolao-material-file__badge")) {
        const badge = document.createElement("span");
        badge.className = "laolao-material-file__badge";
        badge.textContent = typeLabel(target.kind);
        row.querySelector(".chat-workspace-rail__file-main")?.append(badge);
      }
      if (!row.querySelector(".laolao-material-file__actions")) {
        const actions = document.createElement("span");
        actions.className = "laolao-material-file__actions";
        const menu = makeButton("打开文件操作", "laolao-material-file__menu");
        menu.textContent = "⋯";
        menu.dataset.laolaoFileActions = "1";
        actions.append(menu);
        row.querySelector(".chat-workspace-rail__file-main")?.append(actions);
      }
    });
  };

  document.addEventListener("pointerover", (event) => {
    const rail = event.target instanceof Element ? event.target.closest(RAIL) : null;
    if (rail) decorateRail(rail);
    const code = event.target instanceof Element ? event.target.closest("pre, code") : null;
    if (code && pathFromText(code.textContent)) code.classList.add("laolao-material-path");
  }, true);

  const normalizePath = (value) => {
    let path = String(value || "").trim().replace(/^[`'"“‘]+|[`'"”’]+$/g, "");
    path = path.replace(/[.,;:!?，。；：！？）》】]+$/g, "");
    return isAbsolute(path) || path.startsWith("~/") ? path : null;
  };

  const targetFromPath = (path) => {
    const normalized = normalizePath(path);
    if (!normalized) return null;
    return {
      path: normalized,
      name: normalized.split(/[\\/]/).pop() || normalized,
      kind: previewKind(normalized),
    };
  };

  const pathFromText = (value) => {
    const text = String(value || "").trim();
    const exact = normalizePath(text);
    if (exact) return exact;
    const candidate = text.match(/(?:~[\\/]|\/(?:Users|home)\/[^\s/]+\/|[A-Za-z]:[\\/])[^\r\n<>"'`]+/i)?.[0];
    return normalizePath(candidate);
  };

  const pathFromChatClick = (event, origin) => {
    const anchor = origin?.closest("a[href]");
    const href = anchor?.getAttribute("href") || "";
    const decodePath = (value) => {
      try {
        return decodeURIComponent(value);
      } catch (_) {
        return value;
      }
    };
    if (href.toLowerCase().startsWith("file://")) {
      try {
        const pathname = decodePath(new URL(anchor.href).pathname);
        return normalizePath(pathname.replace(/^\/([a-z]:[\\/])/i, "$1"));
      } catch (_) {
        return null;
      }
    }
    const linkedPath = normalizePath(decodePath(href));
    if (linkedPath && !href.startsWith("//")) return linkedPath;
    const code = origin?.closest("pre, code");
    if (code) {
      const exact = pathFromText(code.textContent);
      if (exact) return exact;
    }
    const content = origin?.closest(".chat-bubble, .chat-tool-card, .chat-tool-card__block-content, .chat-activity-group, .markdown");
    if (!content && !code) return null;
    const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    const node = caret?.startContainer;
    if (node?.nodeType === Node.TEXT_NODE) {
      const line = node.textContent || "";
      const start = line.lastIndexOf("\n", Math.max(0, caret.startOffset - 1)) + 1;
      const endIndex = line.indexOf("\n", caret.startOffset);
      const lineEnd = endIndex < 0 ? line.length : endIndex;
      const candidate = pathFromText(line.slice(start, lineEnd));
      if (candidate) return candidate;
    }
    return code ? pathFromText(code.textContent) : null;
  };

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeActionMenu();
  });
  document.addEventListener("pointerdown", (event) => {
    if (actionMenu && event.target instanceof Node && !actionMenu.contains(event.target)) closeActionMenu();
  }, true);

  document.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !nativeBridgeAvailable()) return;
    const origin = event.target instanceof Element ? event.target : null;
    if (!origin) return;
    const rail = origin?.closest(RAIL);
    const row = origin?.closest(".chat-workspace-rail__file");
    const opener = origin?.closest(".chat-workspace-rail__file-open, .chat-workspace-rail__row-action");
    if (row && rail) {
      const target = pathFromRow(row, rail);
      if (!target) return;
      if (origin.closest("[data-laolao-file-actions='1']")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        checkAndShowActionMenu(target, origin, rail);
        return;
      }
      if (opener) {
        if (opener.classList.contains("chat-workspace-rail__row-action") && !/preview|预览/i.test(opener.getAttribute("aria-label") || "")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        runFileAction(target, "preview", rail);
        return;
      }
    }
    const path = pathFromChatClick(event, origin);
    const target = targetFromPath(path);
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    checkAndShowActionMenu(target, origin, origin.closest(RAIL) || document.querySelector(RAIL));
  }, true);

  const initialDecorate = () => document.querySelectorAll(RAIL).forEach(decorateRail);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialDecorate, { once: true });
  else initialDecorate();
})();
