(() => {
  "use strict";
  const motion = window.PinkieMotion;

  const storageKey = "laolao:active-mode";
  const lastSessionStorageKey = (modeId) => `laolao:last-session:${modeId}`;
  const skipEntrySplashKey = "laolao:skip-entry-splash";
  const skipEntrySplashParam = "laolao-switch";
  const modeHandoffKey = "laolao:mode-handoff";
  const modes = [
    {
      id: "chat",
      label: "唠嗑模式",
      address: "先生",
      asset: "/laolao-mode-chat.svg?v=states6",
      avatar: "/laolao-mode-chat-hd.png?v=avatars6",
      transition: "/laolao-mode-transition-chat.png?v=transition2",
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
      asset: "/laolao-mode-project.svg?v=states6",
      avatar: "/laolao-mode-project-hd.png?v=avatars6",
      transition: "/laolao-mode-transition-project.png?v=transition2",
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
      asset: "/laolao-mode-thinking.svg?v=states6",
      avatar: "/laolao-mode-thinking-hd.png?v=avatars6",
      transition: "/laolao-mode-transition-thinking.png?v=transition2",
      phrases: [
        "先生稍等，碧琪在把点子排成彩带…",
        "卷卷鬃毛转一圈，好主意正在冒泡！",
        "先把最亮的那颗想法星星捞出来…",
      ],
      readyPhrase: "想法抓住啦！",
      sessionKey: "agent:thinking:main",
    },
    {
      id: "learning",
      label: "学习模式",
      address: "先生",
      asset: "/laolao-mode-learning.svg?v=states1",
      avatar: "/laolao-mode-learning-hd.png?v=avatars1",
      transition: "/laolao-mode-transition-learning.png?v=transition1",
      phrases: [
        "先生稍等，碧琪把学习桌和笔记本摆好啦…",
        "先找到最关键的那个概念，再把它弄懂弄会！",
        "小实验准备好了，学会以后马上用起来…",
      ],
      readyPhrase: "学习小屋就位！",
      sessionKey: "agent:learning:main",
    },
    {
      id: "unrestricted",
      label: "无限制模式",
      address: "先生",
      asset: "/laolao-mode-unrestricted.svg?v=states6",
      avatar: "/laolao-mode-unrestricted-hd.png?v=avatars6",
      transition: "/laolao-mode-transition-unrestricted.png?v=transition2",
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
  let dockTrigger = null;
  let menuAnchor = null;
  let switching = false;
  let preloading = false;

  const hasWorkspaceDock = () => Boolean(
    window.webkit?.messageHandlers?.laolaoWorkspaceDock?.postMessage
  );

  const isDockedWorkspace = () =>
    document.documentElement.getAttribute("data-laolao-workspace-dock") === "1";

  const hasPrimaryWorkspaceSplit = () =>
    document.documentElement.getAttribute("data-laolao-workspace-split") === "1";

  // A small, fixed particle field gives the empty-chat identity a one-shot
  // materialisation effect without a continuous drawing loop. Every dot animates
  // only on mount or mode entry, then becomes fully inert.
  const WELCOME_PARTICLES = [
    [-112, -34, 2, 0], [-99, 18, 3, 55], [-88, -4, 2, 110],
    [-76, 42, 2, 25], [-68, -52, 3, 145], [-56, 28, 2, 75],
    [-48, -18, 3, 180], [-37, 51, 2, 120], [-29, -42, 2, 210],
    [-20, 17, 3, 155], [-12, -7, 2, 245], [-5, 39, 2, 195],
    [7, -38, 2, 220], [15, 8, 3, 135], [24, 45, 2, 185],
    [34, -17, 2, 90], [43, 30, 3, 235], [54, -48, 2, 40],
    [63, 12, 2, 165], [74, 43, 3, 100], [83, -26, 2, 205],
    [94, 4, 3, 65], [104, 32, 2, 150], [115, -14, 2, 15],
  ];

  const syncMinimalWelcome = (mode, replay = false) => {
    document.querySelectorAll(".agent-chat__welcome").forEach((welcome) => {
      welcome.setAttribute("data-laolao-minimal-welcome", "1");
      let particles = welcome.querySelector(".laolao-welcome-particles");
      const created = !particles;
      if (!particles) {
        particles = document.createElement("span");
        particles.className = "laolao-welcome-particles";
        particles.setAttribute("aria-hidden", "true");
        for (const [x, y, size, delay] of WELCOME_PARTICLES) {
          const dot = document.createElement("i");
          dot.style.setProperty("--particle-x", `${x}px`);
          dot.style.setProperty("--particle-y", `${y}px`);
          dot.style.setProperty("--particle-size", `${size}px`);
          dot.style.setProperty("--particle-delay", `${delay}ms`);
          particles.append(dot);
        }
        welcome.append(particles);
      }
      const changed = welcome.getAttribute("data-laolao-welcome-mode") !== mode.id;
      if (created || changed || replay) {
        welcome.setAttribute("data-laolao-welcome-mode", mode.id);
        if (replay) welcome.classList.remove("laolao-welcome--materializing");
        window.requestAnimationFrame(() => {
          if (welcome.getAttribute("data-laolao-welcome-mode") !== mode.id) return;
          welcome.classList.add("laolao-welcome--materializing");
          window.setTimeout(() => {
            if (welcome.getAttribute("data-laolao-welcome-mode") === mode.id) {
              welcome.classList.remove("laolao-welcome--materializing");
            }
          }, 1100);
        });
      }
    });
  };

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
    if (session.startsWith("agent:learning:")) return "learning";
    if (session.startsWith("agent:unrestricted:")) return "unrestricted";
    if (session.startsWith("agent:main:")) return "chat";
    return null;
  };

  const activeMode = () => modeFromSession() || localStorage.getItem(storageKey) || "chat";
  const modeById = (id) => modes.find((mode) => mode.id === id) || modes[0];
  const modeIdForSession = (key) => {
    if (String(key).startsWith("agent:project:")) return "project";
    if (String(key).startsWith("agent:thinking:")) return "thinking";
    if (String(key).startsWith("agent:learning:")) return "learning";
    if (String(key).startsWith("agent:unrestricted:")) return "unrestricted";
    if (String(key).startsWith("agent:main:")) return "chat";
    return null;
  };
  const agentIdForMode = (modeId) => modeId === "chat" ? "main" : modeId;
  const rememberSession = (key) => {
    const modeId = modeIdForSession(key);
    if (!modeId || String(key).includes(":subagent:")) return;
    try { localStorage.setItem(lastSessionStorageKey(modeId), String(key)); } catch {}
  };
  const storedSession = (mode) => {
    try {
      const key = localStorage.getItem(lastSessionStorageKey(mode.id)) || "";
      return modeIdForSession(key) === mode.id ? key : mode.sessionKey;
    } catch {
      return mode.sessionKey;
    }
  };
  const resolveTargetSession = async (mode) => {
    const preferred = storedSession(mode);
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (typeof rpc !== "function") return preferred;
    try {
      const result = await rpc("sessions.list", {
        agentId: agentIdForMode(mode.id), archived: false, limit: 1000,
      }, 8_000);
      const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
      const usable = sessions.filter((item) => item?.key && !item.key.includes(":subagent:") && item.archived !== true);
      if (usable.some((item) => item.key === preferred)) return preferred;
      if (usable.some((item) => item.key === mode.sessionKey)) return mode.sessionKey;
      return usable[0]?.key || mode.sessionKey;
    } catch {
      // A transient list failure must not turn a mode switch into a reconnect
      // loop. The last known exact session is safer than rebuilding the page.
      return preferred;
    }
  };

  // The native startup movie sits above the mounted chat. Replay the short
  // materialisation only after that cover is actually gone, so the user sees it.
  window.addEventListener("laolao:splash-cleared", () => {
    syncMinimalWelcome(modeById(activeMode()), true);
  });

  const syncModePresentation = (mode) => {
    const previousMode = document.documentElement.getAttribute("data-laolao-mode");
    if (previousMode !== mode.id) {
      document.documentElement.setAttribute("data-laolao-mode", mode.id);
      window.dispatchEvent(new CustomEvent("laolao:modechange", { detail: { mode: mode.id } }));
    }

    document.querySelectorAll(".dashboard-header__breadcrumb-link").forEach((element) => {
      if (element.getAttribute("data-laolao-mode-label") !== mode.label) {
        element.setAttribute("data-laolao-mode-label", mode.label);
      }
      if (element.getAttribute("aria-label") !== mode.label) {
        element.setAttribute("aria-label", mode.label);
      }
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
      if (avatar.getAttribute("data-laolao-mode-avatar") !== mode.id) {
        avatar.setAttribute("data-laolao-mode-avatar", mode.id);
      }
      if (avatar.getAttribute("alt") !== `碧琪·${mode.label}`) {
        avatar.setAttribute("alt", `碧琪·${mode.label}`);
      }
    });

    syncMinimalWelcome(mode);

    document.querySelectorAll(".laolao-classic-breadcrumb__mode").forEach((label) => {
      if (label.textContent !== mode.label) label.textContent = mode.label;
    });
  };

  const closeMenu = () => {
    menu?.remove();
    menu = null;
    menuAnchor?.setAttribute("aria-expanded", "false");
    menuAnchor = null;
  };

  const preloadTransitions = async () => {
    if (preloading) return;
    preloading = true;
    // All assets are local. Pre-decode them during the first idle window so a
    // later mode switch does not wait behind a 3.6s timer plus four serial
    // image groups. Promise deduplication in PinkieMotion keeps this cheap.
    await Promise.all(modes.map(mode => motion.preload(mode.transition)));
    await Promise.all(modes.map(mode => motion.modeAssets(mode.id)));
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
    motion.progress(fill, percentage, progress, 8);
    const assets = motion.modeAssets(mode.id);
    // Keep the current page visible until the transition artwork is decoded.
    motion.preload(mode.transition).then(() => motion.frames()).then(() => overlay.classList.add("is-visible"));

    let startedAt = performance.now();
    // Assets are already decoded in the background. Show a concise visual
    // handoff, then start the real route instead of waiting on decoration.
    const runDuration = motion.reduced() ? 100 : 420;
    let handedOff = false;
    const handoff = () => {
      if (handedOff) return;
      handedOff = true;
      motion.progress(fill, percentage, progress, 68);
      message.textContent = `模式小屋正在开门，${mode.address}稍等…`;
      resolve({ overlay, progress, fill, message, percentage, assets });
    };

    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const ratio = Math.min(1, elapsed / runDuration);
      const value = Math.min(68, Math.round(8 + ratio * 60));
      const phraseIndex = Math.min(mode.phrases.length - 1, Math.floor(ratio * mode.phrases.length));
      motion.progress(fill, percentage, progress, value);
      motion.text(message, mode.phrases[phraseIndex]);
      if (ratio >= 1) handoff();
      else window.requestAnimationFrame(tick);
    };
    // Start the timeline with the decoded scene, not with the network request.
    motion.preload(mode.transition).then(() => {
      startedAt = performance.now();
      window.requestAnimationFrame(tick);
    });
  });

  const navigateWithinApp = (mode, next) => {
    const shell = document.querySelector("openclaw-app-shell");
    const context = shell?.context;
    if (typeof shell?.navigate === "function") {
      shell.navigate("chat", { search: next.search });
      return "router";
    }
    if (typeof context?.navigate === "function") {
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
    let assetsReady = false;
    ui.assets.then(() => { assetsReady = true; });

    const destinationReady = motion.stable(() => {
      const session = currentSessionKey();
      return assetsReady && session === mode.sessionKey && motion.chatReady(mode.id);
    }, 140);

    const complete = async () => {
      if (completed) return;
      completed = true;
      ui.message.textContent = mode.readyPhrase;
      await motion.finishProgress(ui.fill, ui.percentage, ui.progress, 160);
      window.setTimeout(() => {
        motion.enter();
        ui.overlay.classList.add("is-leaving");
        window.setTimeout(() => {
          ui.overlay.remove();
          switching = false;
          resolve();
        }, 240);
      }, motion.reduced() ? 0 : 40);
    };

    const tick = () => {
      if (completed) return;
      const elapsed = performance.now() - startedAt;
      const value = Math.min(96, Math.round(68 + elapsed / 92));
      motion.progress(ui.fill, ui.percentage, ui.progress, value);
      motion.text(ui.message, elapsed < 1200
        ? `模式小屋正在开门，${mode.address}稍等…`
        : mode.phrases.at(-1));

      if (destinationReady(performance.now()) && elapsed >= 120) {
        complete();
        return;
      }

      // A future upstream build may hide its router internals. Only then fall
      // back to a normal reload instead of leaving the user stuck forever.
      if (!fallbackStarted && elapsed >= 12000) {
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
    rememberSession(currentSessionKey());
    const [transition, targetSessionKey] = await Promise.all([
      playModeTransition(mode),
      resolveTargetSession(mode),
    ]);
    const targetMode = {...mode, sessionKey: targetSessionKey};
    localStorage.setItem(storageKey, mode.id);
    sessionStorage.removeItem(skipEntrySplashKey);
    sessionStorage.removeItem(modeHandoffKey);
    const next = new URL(window.location.href);
    next.searchParams.set("session", targetSessionKey);
    next.searchParams.delete(skipEntrySplashParam);
    next.searchParams.delete("draft");
    transition.overlay.dataset.navigation = navigateWithinApp(targetMode, next);
    rememberSession(targetSessionKey);
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(
      "pinkie:session-selected", {detail: {sessionKey: targetSessionKey}}
    )), 0);
    syncModePresentation(targetMode);
    await finishModeTransition(targetMode, transition);
  };

  // Keep the surface live: the old SVG banners baked text and an opaque pill
  // into one image. Use the original HD portraits and native text instead.
  const renderModeButton = (button, mode) => {
    if (button.dataset.mode === mode.id && button.querySelector('.laolao-mode-button__label')) return;
    button.dataset.mode = mode.id;
    const portrait = document.createElement('img');
    portrait.src = mode.avatar;
    portrait.alt = '';
    portrait.draggable = false;
    const label = document.createElement('span');
    label.className = 'laolao-mode-button__label';
    label.textContent = mode.label;
    const arrow = document.createElement('span');
    arrow.className = 'laolao-mode-button__arrow';
    arrow.setAttribute('aria-hidden', 'true');
    button.replaceChildren(portrait, label, arrow);
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
      renderModeButton(option, mode);
      const warm = () => { void motion.modeAssets(mode.id); };
      option.addEventListener("pointerenter", warm, {once: true});
      option.addEventListener("focus", warm, {once: true});
      option.addEventListener("click", () => switchMode(mode));
      menu.append(option);
    });
    const bounds = trigger.getBoundingClientRect();
    menu.style.left = `${Math.max(8, bounds.left)}px`;
    menu.style.top = `${bounds.bottom + 7}px`;
    document.body.append(menu);
    menuAnchor = trigger;
    trigger.setAttribute("aria-expanded", "true");
  };

  const openWorkspaceDock = async (mode) => {
    const bridge = window.webkit?.messageHandlers?.laolaoWorkspaceDock;
    if (!bridge?.postMessage || isDockedWorkspace()) return;
    closeMenu();
    const sessionKey = await resolveTargetSession(mode);
    rememberSession(sessionKey);
    // The native layer validates both fields against its fixed five-mode map.
    // This message cannot alter the current route or start another gateway.
    bridge.postMessage({ action: "open", mode: mode.id, sessionKey });
  };

  // Either half may ask the native shell to drop the companion: the shell's
  // "close" branch is source-agnostic, and the docked half is the one that
  // hosts the always-visible exit button (see syncDockExitButton). Refusing
  // the docked half here was what left a narrow split with no way back.
  const closeWorkspaceDock = () => {
    const bridge = window.webkit?.messageHandlers?.laolaoWorkspaceDock;
    if (!bridge?.postMessage) return;
    closeMenu();
    bridge.postMessage({ action: "close" });
  };

  const DOCK_EXIT_ID = "laolao-dock-exit";

  // A fixed offset cannot be used here: the shell's top bar is 44px tall when
  // the pane is wide and grows to ~58px once the narrow layout wraps its usage
  // chips. Measure the real bar instead of guessing, so the exit never lands
  // on top of the controls it sits next to.
  const positionDockExit = (button) => {
    const bar = document.querySelector("header.topbar") || document.querySelector(".topnav-shell");
    const bottom = bar ? bar.getBoundingClientRect().bottom : 0;
    button.style.top = `${Math.round(Math.max(8, bottom) + 8)}px`;
  };

  // The dock picker in the primary pane is the only exit a split used to have,
  // and it lives inside the sidebar — which becomes a collapsed overlay as soon
  // as the halves get narrow. A split with a hidden sidebar therefore had no
  // reachable way out. Give the docked half its own exit that never depends on
  // the sidebar, and keep it in sync because the flag is set before paint.
  const syncDockExitButton = () => {
    const existing = document.getElementById(DOCK_EXIT_ID);
    if (!isDockedWorkspace() || !hasWorkspaceDock()) {
      existing?.remove();
      return;
    }
    if (existing) {
      positionDockExit(existing);
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.id = DOCK_EXIT_ID;
    button.className = "laolao-dock-exit";
    button.setAttribute("aria-label", "退出分屏，关闭右侧窗口");
    button.title = "退出分屏";
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 7.5l9 9"></path><path d="M16.5 7.5l-9 9"></path></svg><span class="laolao-dock-exit__label">退出分屏</span>';
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeWorkspaceDock();
    });
    document.body.append(button);
    positionDockExit(button);
  };

  // render() only re-runs on DOM mutations and history changes, so a pure
  // window resize has to re-seat the button on its own.
  window.addEventListener("resize", () => {
    const button = document.getElementById(DOCK_EXIT_ID);
    if (button) positionDockExit(button);
  });

  const openDockMenu = () => {
    if (!dockTrigger || !hasWorkspaceDock() || isDockedWorkspace()) return;
    if (menu) {
      closeMenu();
      return;
    }
    const current = activeMode();
    menu = document.createElement("div");
    menu.className = "laolao-mode-menu laolao-mode-menu--workspace-dock";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "选择要在右侧分屏打开的模式");
    modes.filter((mode) => mode.id !== current).forEach((mode) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "laolao-mode-menu__option";
      option.setAttribute("role", "menuitem");
      option.setAttribute("aria-label", `在右侧分屏打开${mode.label}`);
      renderModeButton(option, mode);
      const warm = () => { void motion.modeAssets(mode.id); };
      option.addEventListener("pointerenter", warm, { once: true });
      option.addEventListener("focus", warm, { once: true });
      option.addEventListener("click", () => { void openWorkspaceDock(mode); });
      menu.append(option);
    });
    // The companion has no decorative native title bar. Keep its sole close
    // action in the existing left-side split picker instead of spending a
    // whole 34px row above the second conversation.
    if (hasPrimaryWorkspaceSplit()) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "laolao-mode-menu__option laolao-mode-menu__option--dock-close";
      close.textContent = "关闭右侧分屏";
      close.setAttribute("aria-label", "关闭右侧分屏");
      close.addEventListener("click", closeWorkspaceDock);
      menu.append(close);
    }
    const bounds = dockTrigger.getBoundingClientRect();
    menu.style.left = `${Math.min(Math.max(8, bounds.right - 150), window.innerWidth - 168)}px`;
    menu.style.top = `${bounds.bottom + 7}px`;
    document.body.append(menu);
    menuAnchor = dockTrigger;
    dockTrigger.setAttribute("aria-expanded", "true");
  };

  const syncDockTrigger = (identity) => {
    dockTrigger = identity.querySelector(".laolao-mode-dock-trigger");
    if (isDockedWorkspace() || !hasWorkspaceDock()) {
      dockTrigger?.remove();
      dockTrigger = null;
      return;
    }
    if (!dockTrigger) {
      dockTrigger = document.createElement("button");
      dockTrigger.type = "button";
      dockTrigger.className = "laolao-mode-dock-trigger";
      dockTrigger.setAttribute("aria-haspopup", "menu");
      dockTrigger.setAttribute("aria-expanded", "false");
      // A single framed split is much clearer than two overlapping cards at
      // this small size. It reads as “one window, two work areas” instead of
      // looking like duplicated buttons in the sidebar header.
      dockTrigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"></rect><path d="M12 4.5v15"></path><path d="M6.5 8h2"></path><path d="M15.5 8h2"></path></svg>';
      dockTrigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openDockMenu();
      });
      identity.append(dockTrigger);
    }
    dockTrigger.setAttribute("aria-label", "分屏工作区：在右侧打开另一个模式");
    dockTrigger.title = "分屏工作区";
  };

  const render = () => {
    const mode = modeById(activeMode());
    rememberSession(currentSessionKey());
    syncModePresentation(mode);
    // Before the sidebar lookup: the split exit must survive a hidden sidebar.
    syncDockExitButton();
    const identity = document.querySelector(".sidebar-brand__identity") ||
      document.querySelector(".sidebar-brand");
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
    renderModeButton(trigger, mode);
    syncDockTrigger(identity);
  };

  document.addEventListener("pointerdown", (event) => {
    if (menu && !menu.contains(event.target) && !menuAnchor?.contains(event.target)) closeMenu();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
  window.addEventListener("popstate", render);
  let renderQueued = false;
  new MutationObserver(() => {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(() => { renderQueued = false; render(); });
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  const schedulePreload = () => window.setTimeout(() => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => { void preloadTransitions(); }, {timeout: 1200});
    } else {
      void preloadTransitions();
    }
  }, 120);
  window.addEventListener("load", schedulePreload, { once: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true });
  else render();
})();
