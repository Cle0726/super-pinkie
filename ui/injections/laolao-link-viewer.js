/*
 * 来啦～老弟：聊天内链接就地预览。
 *
 * OpenClaw 的 markdown 渲染器给所有外链加了 target="_blank" 和
 * rel="noreferrer noopener"。在 WKWebView 桌面应用里，target="_blank"
 * 需要 WKUIDelegate 实现 webView(_:createWebViewWith:) 才会开新窗口；
 * 超級碧琪的 Launcher.swift 没实现这个代理，导致链接点击被静默
 * 吞掉——用户看到的现象就是「点了没反应」。
 *
 * 本脚本在 capture 阶段拦截 .chat-bubble / .sidebar-markdown 等聊天
 * 内容里的 <a> 点击，就地打开一个 in-app 预览层：
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
