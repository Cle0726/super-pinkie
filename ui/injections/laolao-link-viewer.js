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
 */
(() => {
  "use strict";

  const viewerId = "laolao-link-viewer";
  // 内容容器：所有 markdown 渲染产物都在这几个 class 里
  const CONTENT_SELECTOR = ".chat-bubble, .sidebar-markdown, .markdown-reader, .markdown, .chat-tool-card__block-content";
  const SKIP_PROTOCOLS = /^(#|mailto:|tel:|javascript:|data:)/i;
  const ALLOW_PROTOCOLS = /^(https?:|file:)/i;
  const EMBED_TIMEOUT_MS = 5000;
  const browserBridge = () => window.webkit?.messageHandlers?.laolaoBrowserWorkspace;

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
    viewer.setAttribute("aria-label", "碧琪的链接预览");

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

    const closeBtn = document.createElement("button");
    closeBtn.className = "laolao-link-viewer__close";
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "关闭预览");
    closeBtn.title = "关闭预览";

    header.append(urlBox, externalBtn, closeBtn);

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
    fbHint.textContent = "可能是 X-Frame-Options 或 CSP 限制。可以点上面「在浏览器打开」按钮，或者复制网址到浏览器手动打开。";

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
    #laolao-browser-workspace-entry{
      display:flex;flex:0 0 28px;width:28px;height:28px;min-height:28px;
      margin:0 auto;padding:0;align-items:center;justify-content:center;
      border:0;border-radius:10px;color:#668b97;background:transparent;cursor:pointer;
      transition:color .18s ease,background .18s ease,transform .18s ease;
    }
    #laolao-browser-workspace-entry svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.45;stroke-linecap:round;stroke-linejoin:round}
    #laolao-browser-workspace-entry:hover{color:#4f7f8d;background:rgba(255,250,253,.72)}
    #laolao-browser-workspace-entry:active{transform:scale(.96)}
    #laolao-browser-workspace-entry:focus-visible{outline:2px solid rgba(207,66,130,.45);outline-offset:-2px}
    .chat-workspace-rail:not(.chat-workspace-rail--collapsed)>#laolao-browser-workspace-entry{display:none}
    @media(prefers-reduced-motion:reduce){#laolao-browser-workspace-entry{transition:none}}
  `;
  document.head.append(launcherStyle);

  const mountBrowserLauncher = () => {
    const rail = document.querySelector(".chat-workbench > .chat-workspace-rail, .chat-workspace-rail");
    let button = document.getElementById("laolao-browser-workspace-entry");
    if (!rail) {
      button?.remove();
      return;
    }
    if (button?.parentElement === rail) return;
    button?.remove();
    button = document.createElement("button");
    button.id = "laolao-browser-workspace-entry";
    button.type = "button";
    button.title = "打开浏览器";
    button.setAttribute("aria-label", "打开浏览器");
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4"></circle><path d="M3.8 12h16.4M12 3.6c2.3 2.3 3.5 5.1 3.5 8.4S14.3 18.1 12 20.4M12 3.6C9.7 5.9 8.5 8.7 8.5 12s1.2 6.1 3.5 8.4"></path></svg>';
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const bridge = browserBridge();
      if (bridge) bridge.postMessage({ action: "open" });
      else open("https://www.google.com/");
    });
    const party = rail.querySelector("#pinkie-party-entry");
    rail.insertBefore(button, party || null);
  };

  // The app swaps chat roots during mode/session changes. A low-frequency,
  // idempotent mount avoids a subtree observer competing with streaming text.
  setInterval(mountBrowserLauncher, 1500);
  mountBrowserLauncher();

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
      if (!ALLOW_PROTOCOLS.test(href)) return; // 让相对路径走原生
      // 如果链接目标是图片且 image-viewer 会接管，让它先处理。
      // image-viewer 的选择器只匹配 img 元素，不匹配 a 元素，所以
      // a[href] 永远不会被它截到——这里直接处理即可。
      event.preventDefault();
      event.stopImmediatePropagation();
      open(href);
    },
    true // capture，抢在原生 target=_blank 之前
  );
})();
