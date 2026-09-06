(() => {
  "use strict";

  const modes = {
    chat: { label: "唠嗑模式", agent: "main", avatar: "/laolao-mode-chat-hd.png?v=avatars6" },
    project: { label: "项目模式", agent: "project", avatar: "/laolao-mode-project-hd.png?v=avatars6" },
    thinking: { label: "想法模式", agent: "thinking", avatar: "/laolao-mode-thinking-hd.png?v=avatars6" },
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

    let more = nav.querySelector(":scope > .laolao-classic-more");
    if (!more) {
      more = document.createElement("button");
      more.type = "button";
      more.className = "laolao-classic-more";
      more.textContent = "更多";
      more.setAttribute("aria-expanded", "false");
      more.addEventListener("click", () => {
        const open = nav.getAttribute("data-laolao-more-open") !== "1";
        nav.setAttribute("data-laolao-more-open", open ? "1" : "0");
        more.setAttribute("aria-expanded", String(open));
      });
      nav.append(more);
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

  const ensureComposerBrand = () => {
    document.querySelectorAll(".agent-chat__composer-shell textarea, .agent-chat__input textarea").forEach((input) => {
      if (input.getAttribute("placeholder") !== "给 碧琪 发消息") {
        input.setAttribute("placeholder", "给 碧琪 发消息");
      }
    });
  };

  const ensureRail = () => {
    if (!document.querySelector(".shell.shell--chat")) return;
    let rail = document.querySelector(".chat-workspace-rail");
    if (!rail) {
      rail = document.createElement("aside");
      rail.className = "chat-workspace-rail chat-workspace-rail--collapsed laolao-classic-workspace-rail";
      rail.setAttribute("aria-label", "会话工作区");
      document.querySelector(".shell.shell--chat")?.append(rail);
    }
    if (!rail.classList.contains("laolao-classic-workspace-rail")) return;
    if (!rail.querySelector(".laolao-classic-rail__toggle")) {
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
    }
  };

  let pending = false;
  const render = () => {
    pending = false;
    const shell = document.querySelector("openclaw-app-shell .shell.shell--chat, .shell.shell--chat");
    if (!shell) return;
    document.documentElement.setAttribute("data-laolao-classic-shell", "1");
    ensureBreadcrumbs();
    ensureNavigation();
    ensureFooterBrand();
    ensureComposerBrand();
    ensureRail();
  };

  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(render);
  };

  window.addEventListener("popstate", schedule);
  window.addEventListener("laolao:modechange", schedule);
  setInterval(schedule, 1200);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule, { once: true });
  else schedule();
})();
