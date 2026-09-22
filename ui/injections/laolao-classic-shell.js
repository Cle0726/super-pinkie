(() => {
  "use strict";

  const modes = {
    chat: { label: "唠嗑模式", agent: "main", avatar: "/laolao-mode-chat-hd.png?v=avatars6" },
    project: { label: "项目模式", agent: "project", avatar: "/laolao-mode-project-hd.png?v=avatars6" },
    thinking: { label: "想法模式", agent: "thinking", avatar: "/laolao-mode-thinking-hd.png?v=avatars6" },
    learning: { label: "学习模式", agent: "learning", avatar: "/laolao-mode-learning-hd.png?v=avatars1" },
    unrestricted: { label: "无限制模式", agent: "unrestricted", avatar: "/laolao-mode-unrestricted-hd.png?v=avatars6" },
  };

  const activeMode = () => {
    const presented = document.documentElement.getAttribute("data-laolao-mode");
    if (modes[presented]) return presented;
    const session = new URLSearchParams(location.search).get("session") || "";
    if (session.startsWith("agent:main:")) return "chat";
    return Object.keys(modes).find((id) => session.startsWith(`agent:${id}:`)) ||
      localStorage.getItem("laolao:active-mode") || "chat";
  };

  const ensureBreadcrumbs = () => {
    const mode = modes[activeMode()] || modes.chat;
    document.querySelectorAll(".chat-pane__header-leading").forEach((host) => {
      let breadcrumb = host.querySelector(":scope > .laolao-classic-breadcrumb");
      if (!breadcrumb) {
        breadcrumb = document.createElement("div");
        breadcrumb.className = "laolao-classic-breadcrumb";
        breadcrumb.innerHTML = [
          '<strong class="laolao-classic-breadcrumb__mode"></strong>',
          '<span class="laolao-classic-breadcrumb__sep">›</span>',
          '<span class="laolao-classic-breadcrumb__agent">碧琪</span>',
          '<span class="laolao-classic-breadcrumb__sep">›</span>',
          '<em>聊天</em>',
        ].join("");
        host.append(breadcrumb);
      }
      breadcrumb.querySelector(".laolao-classic-breadcrumb__mode").textContent = mode.label;
    });
  };

  const ensureNavigation = () => {
    const nav = document.querySelector("aside.sidebar .sidebar-nav");
    if (!nav) return;
    const homeLabel = nav.querySelector(".nav-item--home .nav-item__text");
    if (homeLabel && homeLabel.textContent !== "概览") homeLabel.textContent = "概览";

    /* Use the upstream More control as the single source of truth. */
    nav.querySelectorAll(":scope > .laolao-classic-more").forEach((node) => {
      if (!node.closest(".nav-section--more")) node.remove();
    });
    const more = nav.querySelector(":scope > .nav-section.nav-section--more > .nav-section__label");
    if (more) {
      more.classList.add("laolao-classic-more");
      more.setAttribute("type", "button");
    }

    const create = document.querySelector(".sidebar-session-toolbar .sidebar-new-session");
    if (create && !create.querySelector(".laolao-classic-new-label")) {
      const label = document.createElement("span");
      label.className = "laolao-classic-new-label";
      label.textContent = "新会话";
      create.append(label);
    }
  };

  const ensureFooterBrand = () => {
    const mode = modes[activeMode()] || modes.chat;
    const button = document.querySelector(".sidebar-shell__footer .sidebar-identity-card");
    if (!button) return;
    button.setAttribute("aria-label", "碧琪设置");
    button.setAttribute("title", "碧琪设置");
    const name = button.querySelector(".sidebar-identity-card__name");
    if (name) {
      name.textContent = "碧琪设置";
      name.setAttribute("title", "碧琪设置");
    }
    const avatar = button.querySelector(".viewer-avatar--footer");
    if (!avatar) return;
    avatar.setAttribute("aria-label", "碧琪设置");
    let image = avatar.querySelector(":scope > img.laolao-classic-account-avatar");
    if (!image) {
      image = document.createElement("img");
      image.className = "laolao-classic-account-avatar";
      image.alt = "";
      image.draggable = false;
      avatar.replaceChildren(image);
    }
    if (image.getAttribute("src") !== mode.avatar) image.setAttribute("src", mode.avatar);
  };

  /* Keep the always-visible footer deliberately small. Native controls stay
     mounted (and therefore keep their original listeners/state), while this
     overflow menu forwards to them. Nothing is removed or reimplemented. */
  const footerSecondaryActions = [
    {
      key: "fullscreen",
      selectors: "#pinkie-window-fullscreen",
      label: (node) => node.getAttribute("aria-label")?.replace(/\s*\([^)]*\)\s*$/, "") || "全屏显示",
      icon: '<path d="M8.5 4.5h-4v4M15.5 4.5h4v4M8.5 19.5h-4v-4M15.5 19.5h4v-4"></path>',
    },
    {
      key: "theme",
      selectors: '[aria-label^="颜色模式"], [title^="颜色模式"]',
      label: (node) => (node.getAttribute("aria-label") || node.title || "颜色模式").replace("颜色模式：", "外观 · "),
      icon: '<path d="M19 14.5A7 7 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z"></path>',
    },
    {
      key: "pair",
      selectors: '[aria-label*="配对移动设备"], [title*="配对移动设备"]',
      label: () => "配对移动设备",
      icon: '<rect x="7.5" y="3" width="9" height="18" rx="2"></rect><path d="M10.5 17.5h3"></path>',
    },
    {
      key: "memory",
      selectors: ".laolao-memory-entry",
      label: () => "长期记忆",
      icon: '<path d="M6 4.5h9a3 3 0 0 1 3 3v12H8a2 2 0 0 1-2-2v-13Z"></path><path d="M8 19.5a2 2 0 0 1 2-2h8M9.5 8h5M9.5 11h5"></path>',
    },
    {
      key: "docs",
      selectors: '.sidebar-shell__footer a[href*="docs.openclaw.ai"], .sidebar-shell__footer [aria-label="文档"]',
      label: () => "帮助文档",
      icon: '<path d="M6 3.5h8l4 4v13H6z"></path><path d="M14 3.5v4h4M9 12h6M9 15h6"></path>',
    },
    {
      key: "update",
      selectors: "#pinkie-manual-update",
      label: () => "检查更新",
      icon: '<path d="M18.5 8A7 7 0 1 0 19 14"></path><path d="M18.5 3.5V8h-4.5"></path>',
    },
  ];

  let footerMenu = null;
  let footerMenuButton = null;

  const footerItemFor = (node) => {
    if (!node) return null;
    const group = node.closest?.(".sidebar-footer-actions") || node.closest?.(".sidebar-footer-bar");
    if (!group) return node;
    let item = node;
    while (item.parentElement && item.parentElement !== group) item = item.parentElement;
    return item.parentElement === group ? item : node;
  };

  const closeFooterMenu = () => {
    if (!footerMenu || !footerMenuButton) return;
    footerMenu.hidden = true;
    footerMenuButton.setAttribute("aria-expanded", "false");
  };

  const positionFooterMenu = () => {
    if (!footerMenu || !footerMenuButton || footerMenu.hidden) return;
    const rect = footerMenuButton.getBoundingClientRect();
    const width = 190;
    footerMenu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    footerMenu.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`;
  };

  const actionNode = (spec) => [...document.querySelectorAll(spec.selectors)]
    .find((node) => !node.closest?.(".laolao-footer-overflow")) || null;

  const renderFooterMenu = () => {
    if (!footerMenu) return 0;
    const rows = [];
    for (const spec of footerSecondaryActions) {
      const original = actionNode(spec);
      if (!original) continue;
      const originalItem = footerItemFor(original);
      if (originalItem) originalItem.dataset.laolaoFooterSecondary = "1";
      const row = document.createElement("button");
      row.type = "button";
      row.className = "laolao-footer-overflow__item";
      row.dataset.action = spec.key;
      row.setAttribute("role", "menuitem");
      row.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${spec.icon}</svg><span></span>`;
      row.querySelector("span").textContent = spec.label(original);
      row.disabled = original.matches?.(":disabled") === true;
      row.addEventListener("click", () => {
        closeFooterMenu();
        original.click();
      });
      rows.push(row);
    }
    footerMenu.replaceChildren(...rows);
    return rows.length;
  };

  const ensureFooterMenu = () => {
    const footer = document.querySelector(".sidebar-shell__footer");
    const host = footer?.querySelector(".sidebar-footer-actions") || footer?.querySelector(".sidebar-footer-bar");
    if (!footer || !host) return;

    if (!footerMenu || !footerMenu.isConnected) {
      footerMenu = document.createElement("div");
      footerMenu.className = "laolao-footer-overflow";
      footerMenu.setAttribute("role", "menu");
      footerMenu.setAttribute("aria-label", "更多工具");
      footerMenu.hidden = true;
      document.body.append(footerMenu);
    }
    if (!footerMenuButton || !footerMenuButton.isConnected) {
      footerMenuButton = document.createElement("button");
      footerMenuButton.type = "button";
      footerMenuButton.className = "sidebar-brand__icon sidebar-footer-icon laolao-footer-more";
      footerMenuButton.setAttribute("aria-label", "更多工具");
      footerMenuButton.setAttribute("title", "更多工具");
      footerMenuButton.setAttribute("aria-haspopup", "menu");
      footerMenuButton.setAttribute("aria-expanded", "false");
      footerMenuButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.25"></circle><circle cx="12" cy="12" r="1.25"></circle><circle cx="18" cy="12" r="1.25"></circle></svg>';
      footerMenuButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const opening = footerMenu.hidden;
        if (!opening) return closeFooterMenu();
        if (!renderFooterMenu()) return;
        footerMenu.hidden = false;
        footerMenuButton.setAttribute("aria-expanded", "true");
        positionFooterMenu();
      });
      host.append(footerMenuButton);
    }
    const count = renderFooterMenu();
    footerMenuButton.hidden = count === 0;
    if (!footerMenu.hidden) positionFooterMenu();
  };

  const ensureComposerBrand = () => {
    document.querySelectorAll(".agent-chat__composer-shell textarea, .agent-chat__input textarea").forEach((input) => {
      if (input.getAttribute("placeholder") !== "给 碧琪 发消息") {
        input.setAttribute("placeholder", "给 碧琪 发消息");
      }
    });
  };

  const isFallbackRail = (node) => node?.dataset?.laolaoFallbackRail === "1";

  const moveLaunchers = (from, to) => {
    if (!from || !to || from === to) return;
    from.querySelectorAll(":scope > #pinkie-party-entry, :scope > #pinkie-roundtable-entry")
      .forEach((entry) => to.append(entry));
  };

  const ensureFallbackRailControls = (rail) => {
    const injectedToggle = rail.querySelector(".laolao-classic-rail__toggle");
    if (injectedToggle) return;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "laolao-classic-rail__toggle";
    toggle.title = "折叠或展开左侧栏";
    toggle.setAttribute("aria-label", "折叠或展开左侧栏");
    toggle.addEventListener("click", () => {
      document.querySelector([
        'button[aria-label="折叠侧边栏"]',
        'button[aria-label="展开侧边栏"]',
      ].join(","))?.click();
    });
    rail.prepend(toggle);
  };

  const ensureRail = () => {
    if (!document.querySelector(".shell.shell--chat")) return;
    const workbench = document.querySelector(".chat-workbench");
    if (!workbench) return;

    const rails = [...document.querySelectorAll(".chat-workspace-rail")];
    const fallbacks = rails.filter(isFallbackRail);
    /* The upstream rail owns its own state and children. Never adopt it, move
       it, or tag it with our classes: native CSS targets its real workbench
       position from the first frame. We only retire our clearly marked
       fallback once the runtime provides its rail. */
    const nativeRail = rails.find((node) => !isFallbackRail(node) && node.parentElement === workbench) ||
      rails.find((node) => !isFallbackRail(node)) || null;

    if (nativeRail) {
      fallbacks.forEach((fallback) => {
        moveLaunchers(fallback, nativeRail);
        fallback.remove();
      });
      return;
    }

    let fallback = fallbacks.find((node) => node.parentElement === workbench) || fallbacks[0] || null;
    if (!fallback) {
      fallback = document.createElement("aside");
      fallback.className = "chat-workspace-rail chat-workspace-rail--collapsed";
      fallback.dataset.laolaoFallbackRail = "1";
      fallback.setAttribute("aria-label", "会话工作区");
      workbench.append(fallback);
    } else if (fallback.parentElement !== workbench) {
      /* Only our marked fallback is ever moved. A runtime-owned rail is left
         completely untouched, even on older layouts. */
      workbench.append(fallback);
    }

    fallbacks.forEach((other) => {
      if (other === fallback) return;
      moveLaunchers(other, fallback);
      other.remove();
    });
    ensureFallbackRailControls(fallback);
  };

  let pending = false;
  let observedWorkbench = null;
  let railObserver = null;

  const observeRailMount = () => {
    const workbench = document.querySelector(".chat-workbench");
    if (workbench === observedWorkbench) return;
    railObserver?.disconnect();
    observedWorkbench = workbench;
    if (!workbench || typeof MutationObserver !== "function") return;
    railObserver = new MutationObserver(() => schedule());
    railObserver.observe(workbench, { childList: true });
  };

  const render = () => {
    pending = false;
    const shell = document.querySelector("openclaw-app-shell .shell.shell--chat, .shell.shell--chat");
    if (!shell) return;
    document.documentElement.setAttribute("data-laolao-classic-shell", "1");
    ensureBreadcrumbs();
    ensureNavigation();
    ensureFooterBrand();
    ensureFooterMenu();
    ensureComposerBrand();
    observeRailMount();
    ensureRail();
  };

  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(render);
  };

  window.addEventListener("popstate", schedule);
  window.addEventListener("laolao:modechange", schedule);
  window.addEventListener("resize", positionFooterMenu);
  document.addEventListener?.("pointerdown", (event) => {
    if (footerMenu?.hidden) return;
    if (footerMenu?.contains(event.target) || footerMenuButton?.contains(event.target)) return;
    closeFooterMenu();
  }, true);
  document.addEventListener?.("keydown", (event) => {
    if (event.key === "Escape") closeFooterMenu();
  });
  window.addEventListener("pagehide", () => railObserver?.disconnect(), { once: true });
  setInterval(schedule, 1200);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule, { once: true });
  else schedule();
})();
