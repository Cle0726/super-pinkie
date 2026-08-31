(() => {
  "use strict";

  const storageKey = "laolao:active-mode";
  const skipEntrySplashKey = "laolao:skip-entry-splash";
  const skipEntrySplashParam = "laolao-switch";
  const modeHandoffKey = "laolao:mode-handoff";
  const modes = [
    {
      id: "chat",
      label: "唠嗑模式",
      address: "先生",
      asset: "./laolao-mode-chat.svg?v=states6",
      avatar: "./laolao-mode-chat-hd.png?v=avatars6",
      transition: "./laolao-mode-transition-chat.png?v=transition2",
      phrases: [
        "先生稍等，碧琪把聊天气球牵过来啦…",
        "杯子蛋糕摆好，马上陪先生唠个痛快！",
        "耳朵竖起来——碧琪来听先生说啦！",
      ],
      readyPhrase: "唠嗑时间到！",
      sessionKey: "agent:main:main",
    },
    {
      id: "project",
      label: "项目模式",
      address: "老板",
      asset: "./laolao-mode-project.svg?v=states6",
      avatar: "./laolao-mode-project-hd.png?v=avatars6",
      transition: "./laolao-mode-transition-project.png?v=transition2",
      phrases: [
        "老板稍等，碧琪正在把项目档案摊开…",
        "目标、文件和下一步都在排队报到啦！",
        "铅笔夹好，碧琪再核对一遍现场…",
      ],
      readyPhrase: "项目工作台就位！",
      sessionKey: "agent:project:main",
    },
    {
      id: "thinking",
      label: "想法模式",
      address: "先生",
      asset: "./laolao-mode-thinking.svg?v=states6",
      avatar: "./laolao-mode-thinking-hd.png?v=avatars6",
      transition: "./laolao-mode-transition-thinking.png?v=transition2",
      phrases: [
        "先生稍等，碧琪在把点子排成彩带…",
        "卷卷鬃毛转一圈，好主意正在冒泡！",
        "先把最亮的那颗想法星星捞出来…",
      ],
      readyPhrase: "想法抓住啦！",
      sessionKey: "agent:thinking:main",
    },
    {
      id: "unrestricted",
      label: "无限制模式",
      address: "先生",
      asset: "./laolao-mode-unrestricted.svg?v=states6",
      avatar: "./laolao-mode-unrestricted-hd.png?v=avatars6",
      transition: "./laolao-mode-transition-unrestricted.png?v=transition2",
      phrases: [
        "先生，彩虹力量开始升温啦…",
        "星星和纸屑让一让，想象力要冲出去啦！",
        "最后一条彩带系好——马上自由开跑！",
      ],
      readyPhrase: "彩虹力量全开！",
      sessionKey: "agent:unrestricted:main",
    },
  ];

  let menu = null;
  let trigger = null;
  let switching = false;
  const transitionPreloads = [];

  const currentSessionKey = () => {
    const routed = new URLSearchParams(window.location.search).get("session") || "";
    if (routed) return routed;
    const activeRow = document.querySelector(".sidebar-recent-session--active[data-session-key]");
    if (activeRow?.dataset.sessionKey) return activeRow.dataset.sessionKey;
    return document.querySelector("openclaw-app-shell")?.context?.gateway?.snapshot?.sessionKey || "";
  };

  const modeFromSession = () => {
    const session = currentSessionKey();
    if (session.startsWith("agent:project:")) return "project";
    if (session.startsWith("agent:thinking:")) return "thinking";
    if (session.startsWith("agent:unrestricted:")) return "unrestricted";
    if (session.startsWith("agent:main:")) return "chat";
    return null;
  };

  const activeMode = () => modeFromSession() || localStorage.getItem(storageKey) || "chat";
  const modeById = (id) => modes.find((mode) => mode.id === id) || modes[0];

  const syncModePresentation = (mode) => {
    const previousMode = document.documentElement.getAttribute("data-laolao-mode");
    document.documentElement.setAttribute("data-laolao-mode", mode.id);
    if (previousMode !== mode.id) {
      window.dispatchEvent(new CustomEvent("laolao:modechange", { detail: { mode: mode.id } }));
    }

    document.querySelectorAll(".dashboard-header__breadcrumb-link").forEach((element) => {
      element.setAttribute("data-laolao-mode-label", mode.label);
      element.setAttribute("aria-label", mode.label);
    });

    document.querySelectorAll([
      "img.chat-avatar.assistant",
      ".agent-chat__welcome > img",
      ".agent-chat__welcome img[alt='碧琪']",
      ".agent-chat__welcome img[alt='助手']",
    ].join(", ")).forEach((avatar) => {
      if (avatar.getAttribute("src") !== mode.avatar) {
        avatar.setAttribute("src", mode.avatar);
      }
      avatar.setAttribute("data-laolao-mode-avatar", mode.id);
      avatar.setAttribute("alt", `碧琪·${mode.label}`);
    });
  };

  const closeMenu = () => {
    menu?.remove();
    menu = null;
    trigger?.setAttribute("aria-expanded", "false");
  };

  const preloadTransitions = () => {
    if (transitionPreloads.length) return;
    modes.forEach((mode) => {
      [mode.transition, mode.asset, mode.avatar].forEach((source) => {
        const image = new Image();
        image.src = source;
        transitionPreloads.push(image);
      });
    });
  };

  const playModeTransition = (mode) => new Promise((resolve) => {
    const overlay = document.createElement("section");
    overlay.className = `laolao-mode-transition laolao-mode-transition--${mode.id}`;
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute("aria-label", `正在切换到${mode.label}`);
    overlay.style.setProperty("--laolao-mode-transition-image", `url("${mode.transition}")`);

    const scene = document.createElement("div");
    scene.className = "laolao-mode-transition__scene";

    const sweep = document.createElement("div");
    sweep.className = "laolao-mode-transition__sweep";

    const content = document.createElement("div");
    content.className = "laolao-mode-transition__content";

    const eyebrow = document.createElement("p");
    eyebrow.className = "laolao-mode-transition__eyebrow";
    eyebrow.textContent = "碧琪的模式切换";

    const title = document.createElement("h2");
    title.className = "laolao-mode-transition__title";
    title.textContent = mode.label;

    const progress = document.createElement("div");
    progress.className = "laolao-mode-transition__progress";
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", "100");
    progress.setAttribute("aria-valuenow", "8");

    const fill = document.createElement("span");
    fill.className = "laolao-mode-transition__fill";

    const message = document.createElement("span");
    message.className = "laolao-mode-transition__message";
    message.textContent = mode.phrases[0];

    const percentage = document.createElement("span");
    percentage.className = "laolao-mode-transition__percentage";
    percentage.textContent = "8%";

    progress.append(fill, message, percentage);
    content.append(eyebrow, title, progress);
    overlay.append(scene, sweep, content);
    document.body.append(overlay);
    window.requestAnimationFrame(() => overlay.classList.add("is-visible"));

    const startedAt = performance.now();
    const runDuration = 2400;
    let handedOff = false;
    const handoff = () => {
      if (handedOff) return;
      handedOff = true;
      fill.style.width = "68%";
      percentage.textContent = "68%";
      message.textContent = `模式小屋正在开门，${mode.address}稍等…`;
      progress.setAttribute("aria-valuenow", "68");
      resolve({ overlay, progress, fill, message, percentage });
    };

    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const ratio = Math.min(1, elapsed / runDuration);
      const value = Math.min(68, Math.round(8 + ratio * 60));
      const phraseIndex = Math.min(mode.phrases.length - 1, Math.floor(ratio * mode.phrases.length));
      fill.style.width = `${value}%`;
      percentage.textContent = `${value}%`;
      message.textContent = mode.phrases[phraseIndex];
      progress.setAttribute("aria-valuenow", String(value));
      if (ratio >= 1) handoff();
      else window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });

  const navigateWithinApp = (mode, next) => {
    const shell = document.querySelector("openclaw-app-shell");
    const context = shell?.context;
    if (typeof context?.navigate === "function") {
      context.gateway?.setSessionKey?.(mode.sessionKey);
      context.navigate("chat", { search: next.search });
      return "router";
    }

    // The router's history adapter listens for popstate. This keeps the current
    // document, gateway connection and transition layer alive on older builds.
    window.history.pushState({}, "", `${next.pathname}${next.search}${next.hash}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    return "history";
  };

  const finishModeTransition = (mode, ui) => new Promise((resolve) => {
    const startedAt = performance.now();
    let completed = false;
    let fallbackStarted = false;

    const destinationReady = () => {
      const session = currentSessionKey();
      const modeReady = document.documentElement.getAttribute("data-laolao-mode") === mode.id;
      const inputReady = Boolean(document.querySelector(".agent-chat__input"));
      const avatarReady = Boolean(document.querySelector(`[data-laolao-mode-avatar="${mode.id}"]`));
      return session === mode.sessionKey && modeReady && inputReady && avatarReady;
    };

    const complete = () => {
      if (completed) return;
      completed = true;
      ui.fill.style.width = "100%";
      ui.percentage.textContent = "100%";
      ui.message.textContent = mode.readyPhrase;
      ui.progress.setAttribute("aria-valuenow", "100");
      document.documentElement.setAttribute("data-laolao-mode-enter", "1");
      window.setTimeout(() => document.documentElement.removeAttribute("data-laolao-mode-enter"), 1250);
      window.setTimeout(() => {
        ui.overlay.classList.add("is-leaving");
        window.setTimeout(() => {
          ui.overlay.remove();
          switching = false;
          resolve();
        }, 560);
      }, 420);
    };

    const tick = () => {
      if (completed) return;
      const elapsed = performance.now() - startedAt;
      const value = Math.min(96, Math.round(68 + elapsed / 92));
      ui.fill.style.width = `${value}%`;
      ui.percentage.textContent = `${value}%`;
      ui.progress.setAttribute("aria-valuenow", String(value));
      ui.message.textContent = elapsed < 1200
        ? `模式小屋正在开门，${mode.address}稍等…`
        : mode.phrases.at(-1);

      if (destinationReady() && elapsed >= 700) {
        complete();
        return;
      }

      // A future upstream build may hide its router internals. Only then fall
      // back to a normal reload instead of leaving the user stuck forever.
      if (!fallbackStarted && elapsed >= 6000) {
        fallbackStarted = true;
        sessionStorage.setItem(skipEntrySplashKey, "1");
        sessionStorage.setItem(modeHandoffKey, JSON.stringify({
          mode: mode.id,
          progress: value,
          startedAt: Date.now(),
        }));
        const fallbackUrl = new URL(window.location.href);
        fallbackUrl.searchParams.set("session", mode.sessionKey);
        fallbackUrl.searchParams.set(skipEntrySplashParam, "1");
        window.location.assign(fallbackUrl.href);
        return;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });

  const switchMode = async (mode) => {
    if (switching) return;
    if (mode.id === activeMode()) {
      closeMenu();
      return;
    }
    switching = true;
    closeMenu();
    const transition = await playModeTransition(mode);
    localStorage.setItem(storageKey, mode.id);
    sessionStorage.removeItem(skipEntrySplashKey);
    sessionStorage.removeItem(modeHandoffKey);
    const next = new URL(window.location.href);
    next.searchParams.set("session", mode.sessionKey);
    next.searchParams.delete(skipEntrySplashParam);
    next.searchParams.delete("draft");
    transition.overlay.dataset.navigation = navigateWithinApp(mode, next);
    syncModePresentation(mode);
    await finishModeTransition(mode, transition);
  };

  const openMenu = () => {
    if (!trigger) return;
    if (menu) {
      closeMenu();
      return;
    }
    const current = activeMode();
    menu = document.createElement("div");
    menu.className = "laolao-mode-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "选择碧琪的工作模式");
    modes.forEach((mode) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "laolao-mode-menu__option";
      option.setAttribute("role", "menuitemradio");
      option.setAttribute("aria-checked", String(mode.id === current));
      option.innerHTML = `<img src="${mode.asset}" alt="${mode.label}" />`;
      option.addEventListener("click", () => switchMode(mode));
      menu.append(option);
    });
    const bounds = trigger.getBoundingClientRect();
    menu.style.left = `${Math.max(8, bounds.left)}px`;
    menu.style.top = `${bounds.bottom + 7}px`;
    document.body.append(menu);
    trigger.setAttribute("aria-expanded", "true");
  };

  const render = () => {
    const mode = modeById(activeMode());
    syncModePresentation(mode);
    const identity = document.querySelector(".sidebar-brand__identity");
    if (!identity) return;
    trigger = identity.querySelector(".laolao-mode-switcher");
    if (!trigger) {
      trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "laolao-mode-switcher";
      trigger.setAttribute("aria-haspopup", "menu");
      trigger.setAttribute("aria-expanded", "false");
      trigger.addEventListener("click", openMenu);
      identity.append(trigger);
    }
    trigger.setAttribute("aria-label", `当前是${mode.label}，点这里切换模式`);
    const image = trigger.querySelector("img");
    if (image?.getAttribute("src") !== mode.asset) {
      trigger.innerHTML = `<img src="${mode.asset}" alt="${mode.label}" />`;
    }
  };

  document.addEventListener("pointerdown", (event) => {
    if (menu && !menu.contains(event.target) && !trigger?.contains(event.target)) closeMenu();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
  window.addEventListener("popstate", render);
  new MutationObserver(render).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  window.addEventListener("load", () => window.setTimeout(preloadTransitions, 420), { once: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true });
  else render();
})();
