/*
 * 来啦～老弟：全模式共用的网页资料工作区。
 *
 * OpenClaw 的 markdown 渲染器给所有外链加了 target="_blank" 和
 * rel="noreferrer noopener"。在 WKWebView 桌面应用里，target="_blank"
 * 需要 WKUIDelegate 实现 webView(_:createWebViewWith:) 才能接住。原生
 * Launcher 现在会把这种新窗口请求统一送进右侧浏览器工作区。
 *
 * 原生 App 提供独立 WKWebView 侧栏；本脚本只负责在所有模式挂载入口，
 * 并把聊天里的网页链接交给原生侧栏。浏览器页不属于聊天 DOM，因此
 * 切换模式、恢复会话或裁剪聊天消息都不会把它重建掉。
 *
 * 非原生环境仍保留 iframe 预览作为兼容回退：
 *  - 用 iframe 加载目标 URL，能在窗口里看就直接看；
 *  - 5 秒还没触发 load 事件（多半是 X-Frame-Options: DENY /
 *    SAMEORIGIN 或 CSP frame-ancestors 拒绝嵌入），自动切到 fallback
 *    面板：显示完整 URL、提供「复制网址」按钮；
 *  - 头部「在浏览器打开」按钮先尝试 window.open()，返回 null 说明
 *    createWebView 代理也没接，就回退到「复制网址 + 提示」。
 *
 * 跳过：# 锚点、mailto:、tel:、javascript:、相对路径、非 http/file
 * 协议。也只拦截聊天/markdown 内容里的链接，不动侧栏、设置页等
 * 应用内导航。
 *
 * 双栏：入口按 pane 各自挂载，不共用一个全局 id。同一个 id 在两个
 * pane 之间搬动会让另一侧的工具凭空消失，也会在 pane 缓存重绘时
 * 把按钮连根拔掉；这里每个 pane 各有一个按钮，点击都打开同一个原生
 * 工作区（页面与登录状态继续留在那一个 WKWebView 里）。
 */
(() => {
  "use strict";

  const viewerId = "laolao-link-viewer";
  // 内容容器：所有 markdown 渲染产物都在这几个 class 里
  const CONTENT_SELECTOR = ".chat-text, .chat-bubble, .sidebar-markdown, .markdown-reader, .markdown, .chat-tool-card__block-content, .chat-assistant-attachment-card";
  const SKIP_PROTOCOLS = /^(#|mailto:|tel:|javascript:|data:)/i;
  const ALLOW_PROTOCOLS = /^(https?:|file:)/i;
  const EMBED_TIMEOUT_MS = 5000;
  const PANE_SELECTOR = ".chat-pane-cache__pane";
  const ENTRY_CLASS = "laolao-browser-entry";
  const browserBridge = () => window.webkit?.messageHandlers?.laolaoBrowserWorkspace;
  // 原生 App 才有这个桥；普通浏览器/嵌入式预览只能退回 iframe，
  // 界面必须说清楚这是“页内预览”，不能假装原生浮窗已经打开。
  const isNative = () => Boolean(browserBridge());

  let removeKeyListener = null;
  let loadTimer = null;
  let didLoad = false;

  const close = () => {
    const viewer = document.getElementById(viewerId);
    if (viewer) {
      viewer.classList.remove("is-open");
      // 让淡出动画跑完再移除，避免突兀
      setTimeout(() => viewer.remove(), 180);
    }
    removeKeyListener?.();
    removeKeyListener = null;
    if (loadTimer) {
      clearTimeout(loadTimer);
      loadTimer = null;
    }
    didLoad = false;
  };

  // 优先用 navigator.clipboard，老上下文回退到 execCommand
  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {}
      document.body.removeChild(ta);
      return ok;
    }
  };

  const showFallback = (viewer, url) => {
    const iframe = viewer.querySelector(".laolao-link-viewer__iframe");
    const loading = viewer.querySelector(".laolao-link-viewer__loading");
    const fallback = viewer.querySelector(".laolao-link-viewer__fallback");
    if (iframe) iframe.style.display = "none";
    if (loading) loading.style.display = "none";
    if (fallback) {
      fallback.style.display = "flex";
      const urlInput = fallback.querySelector(".laolao-link-viewer__fallback-url");
      if (urlInput) urlInput.value = url;
    }
  };

  const flashButton = (btn, text, resetText) => {
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = resetText || original; }, 1800);
  };

  const open = (url) => {
    if (!url) return;
    const bridge = browserBridge();
    if (bridge) {
      bridge.postMessage({ action: "open", url });
      return;
    }
    close();

    const viewer = document.createElement("div");
    viewer.id = viewerId;
    viewer.className = "laolao-link-viewer";
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-modal", "true");
    // 无桥时这是页内 iframe，不是 App 的原生浮窗。标题和 aria-label
    // 都按实际能力写，避免把“预览失败”当成“浏览器已打开”。
    viewer.setAttribute("aria-label", "页内预览（非原生浏览器）");

    // 用 DOM API 构建而非 innerHTML，避免 URL 里的 < > 引号注入风险
    const header = document.createElement("div");
    header.className = "laolao-link-viewer__header";

    const urlBox = document.createElement("div");
    urlBox.className = "laolao-link-viewer__url";
    urlBox.textContent = url; // textContent 自动转义
    urlBox.setAttribute("title", url);

    const externalBtn = document.createElement("button");
    externalBtn.className = "laolao-link-viewer__external";
    externalBtn.type = "button";
    externalBtn.textContent = "↗ 在浏览器打开";
    externalBtn.title = "尝试在系统浏览器打开";

    // 明确的环境说明：没有原生桥时，这里只是页内嵌入预览。
    const modeNote = document.createElement("div");
    modeNote.className = "laolao-link-viewer__mode";
    modeNote.textContent = "页内预览 · 未连接原生浏览器";
    modeNote.title = "当前环境没有 App 原生浏览器桥，以下为页内嵌入预览；部分站点会拒绝嵌入。";

    const closeBtn = document.createElement("button");
    closeBtn.className = "laolao-link-viewer__close";
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "关闭预览");
    closeBtn.title = "关闭预览";

    header.append(modeNote, urlBox, externalBtn, closeBtn);

    const body = document.createElement("div");
    body.className = "laolao-link-viewer__body";

    const loading = document.createElement("div");
    loading.className = "laolao-link-viewer__loading";
    loading.textContent = "正在加载预览…";

    const iframe = document.createElement("iframe");
    iframe.className = "laolao-link-viewer__iframe";
    iframe.setAttribute("referrerpolicy", "no-referrer");
    // sandbox 给目标页足够权限跑脚本，但挡住顶层跳转、弹窗等危险行为
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
    );

    const fallback = document.createElement("div");
    fallback.className = "laolao-link-viewer__fallback";
    fallback.style.display = "none";

    const fbIcon = document.createElement("div");
    fbIcon.className = "laolao-link-viewer__fallback-icon";
    fbIcon.textContent = "🌐";

    const fbTitle = document.createElement("div");
    fbTitle.className = "laolao-link-viewer__fallback-title";
    fbTitle.textContent = "该网站拒绝了嵌入预览";

    const fbHint = document.createElement("div");
    fbHint.className = "laolao-link-viewer__fallback-hint";
    fbHint.textContent = "可能是 X-Frame-Options 或 CSP 限制。这不是原生浮窗失败：当前环境没有 App 浏览器桥，只能页内嵌入。可以点上面「在浏览器打开」按钮，或者复制网址到浏览器手动打开。";

    const fbUrl = document.createElement("input");
    fbUrl.className = "laolao-link-viewer__fallback-url";
    fbUrl.readOnly = true;

    const fbCopy = document.createElement("button");
    fbCopy.className = "laolao-link-viewer__fallback-copy";
    fbCopy.type = "button";
    fbCopy.textContent = "复制网址";

    fallback.append(fbIcon, fbTitle, fbHint, fbUrl, fbCopy);
    body.append(loading, iframe, fallback);
    viewer.append(header, body);

    // 行为绑定
    iframe.addEventListener("load", () => {
      didLoad = true;
      if (loadTimer) {
        clearTimeout(loadTimer);
        loadTimer = null;
      }
      loading.style.display = "none";
      iframe.style.display = "block";
      fallback.style.display = "none";
    });

    // 部分站点不会触发 onload 也不会触发 onerror，5s 兜底切到 fallback
    loadTimer = setTimeout(() => {
      if (!didLoad) showFallback(viewer, url);
    }, EMBED_TIMEOUT_MS);

    closeBtn.addEventListener("click", close);

    externalBtn.addEventListener("click", () => {
      // 先试 window.open —— WKWebView 如果实现了 createWebView 代理会
      // 开新窗口；没实现的话返回 null，再回退到剪贴板。
      let opened = null;
      try {
        opened = window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        opened = null;
      }
      if (opened) {
        close();
        return;
      }
      copyToClipboard(url).then((ok) => {
        flashButton(externalBtn, ok ? "✓ 已复制网址" : "复制失败，请手动选择", "↗ 在浏览器打开");
      });
    });

    fbCopy.addEventListener("click", () => {
      copyToClipboard(url).then((ok) => {
        flashButton(fbCopy, ok ? "✓ 已复制" : "复制失败", "复制网址");
      });
    });

    viewer.addEventListener("click", (event) => {
      if (event.target === viewer) close();
    });

    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown, true);
    removeKeyListener = () => document.removeEventListener("keydown", onKeyDown, true);

    // iframe.src 必须在插入到 DOM 之后再赋值，否则某些 WebKit 版本会
    // 错过 load 事件
    document.body.append(viewer);
    iframe.src = url;
    requestAnimationFrame(() => viewer.classList.add("is-open"));
  };

  const launcherStyle = document.createElement("style");
  launcherStyle.textContent = `
    .${ENTRY_CLASS}{
      display:flex;flex:0 0 28px;width:28px;height:28px;min-height:28px;
      margin:0;padding:0;align-items:center;justify-content:center;
      border:0;border-radius:10px;color:var(--cle-ink-3,#668b97);background:transparent;cursor:pointer;
      transition:color .18s ease,background .18s ease,transform .18s ease;
    }
    .${ENTRY_CLASS} svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.45;stroke-linecap:round;stroke-linejoin:round}
    .${ENTRY_CLASS}:hover{color:var(--cle-ink,#4f7f8d);background:color-mix(in srgb,var(--cle-ink,#000) 5%,transparent)}
    .${ENTRY_CLASS}:active{transform:scale(.96)}
    .${ENTRY_CLASS}:focus-visible{outline:2px solid var(--cle-gaze,#cf4282);outline-offset:-2px}
    .${ENTRY_CLASS}[data-native="false"]{}
    .laolao-video-workspace-open{align-self:flex-start;border:1px solid var(--cle-line,#e2ddd0);border-radius:8px;padding:5px 10px;background:var(--cle-surface,#fff);color:var(--cle-ink,#15161a);cursor:pointer}
    .laolao-video-workspace-open:hover{color:var(--cle-gaze,#2a63e8)}
    .laolao-link-viewer__mode{flex:0 0 auto;padding:2px 8px;border:1px solid var(--cle-line,#e2ddd0);border-radius:999px;color:var(--cle-ink-3,#8a8a80);font:500 10.5px/1.4 -apple-system,"PingFang SC",sans-serif;white-space:nowrap}
    @media(prefers-reduced-motion:reduce){.${ENTRY_CLASS}{transition:none}}
    @container cle-pane (max-width:420px){.${ENTRY_CLASS}{flex-basis:26px;width:26px;height:26px}}
  `;
  document.head.append(launcherStyle);

  // 每个 pane 各自一个入口。pane 是缓存的，DOM 节点会被上层重绘；
  // 因此只检查“这个 pane 的 composer lead 里是否已经有自己的按钮”，
  // 不再用全局 id 去别的 pane 里搬。
  const railFor = (pane) => pane?.querySelector(".agent-chat__composer-lead")
    || pane?.querySelector(".chat-workspace-rail");

  const mountForPane = (pane) => {
    if (!pane || pane.hasAttribute("inert")) return;
    const rail = railFor(pane);
    if (!rail) return;
    mountOnRail(rail);
  };

  // 真正的挂载只依赖一个 rail，pane / 单栏 / body 都能复用；不依赖全局 id。
  const mountOnRail = (rail) => {
    if (!rail) return;
    const existing = rail.querySelector(`:scope > .${ENTRY_CLASS}`);
    if (existing) {
      existing.dataset.native = String(isNative());
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = ENTRY_CLASS;
    button.dataset.native = String(isNative());
    // 标题按能力区分：原生工作区 or 页内预览回退。
    button.title = isNative() ? "打开浏览器（浮窗）" : "打开浏览器（与碧琪共用）";
    button.setAttribute("aria-label", button.title);
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4"></circle><path d="M3.8 12h16.4M12 3.6c2.3 2.3 3.5 5.1 3.5 8.4S14.3 18.1 12 20.4M12 3.6C9.7 5.9 8.5 8.7 8.5 12s1.2 6.1 3.5 8.4"></path></svg>';
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const bridge = browserBridge();
      // 两侧入口打开同一个原生工作区；页面和登录状态都在那一个
      // WKWebView 里，不因抛 pane 而重建。
      if (bridge) { bridge.postMessage({ action: "open" }); return; }
      // 没有原生浮窗（Safari / 普通浏览器）：打开这一侧的真浏览器面板（与碧琪共用，能真正打开网页），
      // 而不是一个多数网站拒绝嵌入的 iframe。面板的原生开关已在页头隐藏，避免两个浏览器键。
      const host = button.closest(".chat-pane-cache__pane, .chat-split-view__cell") || document;
      const toggle = host.querySelector(".chat-browser-panel-toggle") || document.querySelector(".chat-browser-panel-toggle");
      if (toggle) toggle.click(); else open("https://www.google.com/");
    });
    const party = rail.querySelector("#pinkie-party-entry");
    rail.insertBefore(button, party || null);
  };

  const mountBrowserLauncher = () => {
    const panes = document.querySelectorAll(PANE_SELECTOR);
    if (!panes.length) {
      // 单栏/旧 DOM：没有 pane 容器时直接挂到 composer lead 上。
      for (const lead of document.querySelectorAll(".agent-chat__composer-lead")) {
        if (lead.querySelector(`:scope > .${ENTRY_CLASS}`)) {
          lead.querySelector(`:scope > .${ENTRY_CLASS}`).dataset.native = String(isNative());
          continue;
        }
        mountOnRail(lead);
      }
      return;
    }
    for (const pane of panes) mountForPane(pane);
    // 已不在任何 pane 里的旧按钮只由自己清理，不靠全局 id 搬迁。
    for (const stale of document.querySelectorAll(`.${ENTRY_CLASS}`)) {
      if (!stale.closest(PANE_SELECTOR)) stale.remove();
    }
  };

  // Playback controls keep their normal behaviour. The separate entry also
  // covers attachment cards whose media URL is relative to the gateway.
  const mountMediaWorkspaceActions = () => {
    document.querySelectorAll(".chat-assistant-attachment-card video, .chat-bubble video").forEach((video) => {
      const parent = video.parentElement;
      if (!parent || parent.querySelector(".laolao-video-workspace-open")) return;
      const button = document.createElement("button");
      button.className = "laolao-video-workspace-open";
      button.type = "button";
      // 没有原生桥时不能写“在侧栏打开”：那会承诺一个并不存在的浮窗。
      button.textContent = isNative() ? "在侧栏打开" : "页内预览";
      button.title = isNative() ? "在 App 浏览器工作区打开" : "当前环境没有原生浏览器，将在页内预览";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const source = video.currentSrc || video.getAttribute("src") || video.querySelector("source[src]")?.getAttribute("src");
        if (!source) return;
        try {
          const url = new URL(source, window.location.href);
          if (ALLOW_PROTOCOLS.test(url.protocol)) open(url.href);
        } catch (_) {}
      });
      parent.append(button);
    });
  };

  // Lit may replace the rail's children when its file view expands. Re-seat
  // this launcher after that local click update, instead of waiting 1.5s.
  let launcherMountFrame = 0;
  document.addEventListener("click", event => {
    if (!event.target.closest?.(".chat-workspace-rail, .chat-pane-cache__pane") || launcherMountFrame) return;
    launcherMountFrame = requestAnimationFrame(() => {
      launcherMountFrame = 0;
      mountBrowserLauncher();
    });
  }, true);

  // Pane caches are rebuilt on split on/off and on room switch; a 1.5s poll
  // alone leaves the new side visibly without its button. Watch only for
  // added nodes, and only schedule when a visible pane is actually missing one.
  const needsMount = () => {
    const panes = document.querySelectorAll(PANE_SELECTOR);
    if (!panes.length) return true;
    for (const pane of panes) {
      if (pane.hasAttribute("inert")) continue;
      const rail = railFor(pane);
      if (rail && !rail.querySelector(`:scope > .${ENTRY_CLASS}`)) return true;
    }
    return false;
  };
  let mountQueued = false;
  const scheduleMount = () => {
    if (mountQueued) return;
    mountQueued = true;
    requestAnimationFrame(() => {
      mountQueued = false;
      if (needsMount()) mountBrowserLauncher();
    });
  };
  if (typeof MutationObserver === "function") {
    new MutationObserver(scheduleMount).observe(document.body, {childList: true, subtree: true});
  }

  // The app swaps chat roots during mode/session changes. A low-frequency,
  // idempotent mount catches anything the observer cannot see (attribute-only
  // changes, a pane reactivated from cache).
  setInterval(mountBrowserLauncher, 1500);
  setInterval(mountMediaWorkspaceActions, 1500);
  mountBrowserLauncher();
  mountMediaWorkspaceActions();

  // 拦截聊天内容里的链接点击
  document.addEventListener(
    "click",
    (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest?.("a[href]");
      if (!link) return;
      // 只动聊天/markdown 内容里的链接，不碰侧栏、设置等应用内导航
      const inContent = link.closest?.(CONTENT_SELECTOR);
      if (!inContent) return;
      const href = link.getAttribute("href") || "";
      if (!href || SKIP_PROTOCOLS.test(href)) return;
      let target = href;
      if (!ALLOW_PROTOCOLS.test(target)) {
        if (!link.closest(".chat-assistant-attachment-card")) return;
        try { target = new URL(href, window.location.href).href; } catch (_) { return; }
        if (!ALLOW_PROTOCOLS.test(target)) return;
      }
      // 如果链接目标是图片且 image-viewer 会接管，让它先处理。
      // image-viewer 的选择器只匹配 img 元素，不匹配 a 元素，所以
      // a[href] 永远不会被它截到——这里直接处理即可。
      event.preventDefault();
      event.stopImmediatePropagation();
      open(target);
    },
    true // capture，抢在原生 target=_blank 之前
  );
})();
