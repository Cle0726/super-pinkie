(() => {
  const skipEntrySplashKey = "laolao:skip-entry-splash";
  const skipEntrySplashParam = "laolao-switch";
  const modeHandoffKey = "laolao:mode-handoff";
  const splash = document.getElementById("laolao-splash");
  const fill = document.getElementById("laolao-splash-fill");
  const message = document.getElementById("laolao-splash-message");
  const percentage = document.getElementById("laolao-splash-percentage");
  const progressbar = splash?.querySelector('[role="progressbar"]');
  if (!splash || !fill || !message || !percentage) return;
  const currentUrl = new URL(window.location.href);
  const skipForModeSwitch = currentUrl.searchParams.get(skipEntrySplashParam) === "1";
  if (skipForModeSwitch || sessionStorage.getItem(skipEntrySplashKey) === "1") {
    sessionStorage.removeItem(skipEntrySplashKey);
    let storedHandoff = null;
    try {
      storedHandoff = JSON.parse(sessionStorage.getItem(modeHandoffKey) || "null");
    } catch {}
    sessionStorage.removeItem(modeHandoffKey);
    const session = currentUrl.searchParams.get("session") || "";
    const inferredMode = session.startsWith("agent:project:")
      ? "project"
      : session.startsWith("agent:thinking:")
        ? "thinking"
        : session.startsWith("agent:unrestricted:")
          ? "unrestricted"
          : "chat";
    const modeId = ["chat", "project", "thinking", "unrestricted"].includes(storedHandoff?.mode)
      ? storedHandoff.mode
      : inferredMode;
    const modeDetails = {
      chat: {
        label: "唠嗑模式",
        waiting: ["新聊天正在铺开彩带…", "碧琪在确认唠嗑小屋已经站稳…"],
        ready: "唠嗑小屋准备好啦！",
      },
      project: {
        label: "项目模式",
        address: "老板",
        waiting: ["老板，项目档案正在摊开…", "碧琪在确认目标、文件和工具都已就位…"],
        ready: "项目工作台准备好啦！",
      },
      thinking: {
        label: "想法模式",
        waiting: ["灵感房间正在亮灯…", "碧琪在确认想法和工具都到齐…"],
        ready: "想法小屋准备好啦！",
      },
      unrestricted: {
        label: "无限制模式",
        waiting: ["彩虹力量正在接管房间…", "碧琪在确认自由模式已经完全站稳…"],
        ready: "彩虹力量准备好啦！",
      },
    }[modeId];
    if (skipForModeSwitch) {
      currentUrl.searchParams.delete(skipEntrySplashParam);
      window.history.replaceState(window.history.state, "", currentUrl.href);
    }
    splash.classList.add("is-mode-progress", `is-mode-progress--${modeId}`);
    splash.style.setProperty("--laolao-mode-progress-image", `url("./laolao-mode-transition-${modeId}.png?v=transition2")`);
    const eyebrow = splash.querySelector(".laolao-splash__eyebrow");
    const title = splash.querySelector(".laolao-splash__title");
    if (eyebrow) eyebrow.textContent = "碧琪的模式切换";
    if (title) title.textContent = modeDetails.label;
    const carriedProgress = Math.max(68, Math.min(96, Number(storedHandoff?.progress) || 68));
    fill.style.transition = "none";
    fill.style.width = `${carriedProgress}%`;
    percentage.textContent = `${carriedProgress}%`;
    message.textContent = modeDetails.waiting[0];
    progressbar?.setAttribute("aria-valuenow", String(carriedProgress));

    const handoffStartedAt = performance.now();
    let handoffCompleted = false;
    const destinationReady = () => {
      const shellReady = Boolean(document.querySelector("openclaw-app .shell"));
      const modeReady = document.documentElement.getAttribute("data-laolao-mode") === modeId;
      const inputReady = Boolean(document.querySelector(".agent-chat__input"));
      const avatarReady = Boolean(document.querySelector(`[data-laolao-mode-avatar="${modeId}"]`));
      return shellReady && modeReady && inputReady && avatarReady;
    };
    const completeHandoff = () => {
      if (handoffCompleted) return;
      handoffCompleted = true;
      fill.style.width = "100%";
      percentage.textContent = "100%";
      message.textContent = modeDetails.ready;
      progressbar?.setAttribute("aria-valuenow", "100");
      document.documentElement.setAttribute("data-laolao-mode-enter", "1");
      window.setTimeout(() => document.documentElement.removeAttribute("data-laolao-mode-enter"), 1250);
      window.setTimeout(() => {
        splash.classList.add("is-leaving");
        window.setTimeout(() => splash.remove(), 560);
      }, 420);
    };
    const tickHandoff = () => {
      if (handoffCompleted) return;
      const elapsed = performance.now() - handoffStartedAt;
      const value = Math.min(96, Math.round(carriedProgress + elapsed / 92));
      fill.style.width = `${value}%`;
      percentage.textContent = `${value}%`;
      progressbar?.setAttribute("aria-valuenow", String(value));
      message.textContent = elapsed < 1200 ? modeDetails.waiting[0] : modeDetails.waiting[1];
      if (destinationReady() && elapsed >= 700) {
        completeHandoff();
        return;
      }
      window.requestAnimationFrame(tickHandoff);
    };
    window.requestAnimationFrame(() => {
      fill.style.removeProperty("transition");
      window.requestAnimationFrame(tickHandoff);
    });
    window.setTimeout(() => {
      if (!handoffCompleted) message.textContent = `${modeDetails.address || "先生"}，连接比平时慢，碧琪还在认真等…`;
    }, 8000);
    window.setTimeout(completeHandoff, 30000);
    return;
  }

  const startedAt = performance.now();
  const minimumDuration = 2600;
  const phrases = [
    "先生稍等，碧琪在给气球打气…",
    "卷胡子扶正中，千万别让它跑掉！",
    "纸屑正在排队进场，乖一点点！",
    "派对大炮预热中，别眨眼！",
    "最后检查：惊喜有没有藏好？",
  ];
  let completed = false;
  let readyToLeave = false;

  const setProgress = (value, phrase) => {
    const safeValue = Math.max(0, Math.min(100, Math.round(value)));
    fill.style.width = `${safeValue}%`;
    percentage.textContent = `${safeValue}%`;
    progressbar?.setAttribute("aria-valuenow", String(safeValue));
    if (phrase) message.textContent = phrase;
  };

  const appIsReady = () => Boolean(document.querySelector("openclaw-app .shell"));

  const hideSplash = () => {
    if (completed) return;
    completed = true;
    setProgress(100, "先生，门要开啦！");
    window.setTimeout(() => {
      splash.classList.add("is-leaving");
      window.setTimeout(() => splash.remove(), 560);
    }, 360);
  };

  const tick = () => {
    if (completed) return;
    const elapsed = performance.now() - startedAt;
    const progress = Math.min(94, 8 + elapsed / 28);
    const phraseIndex = Math.min(phrases.length - 1, Math.floor(elapsed / 560));
    setProgress(progress, phrases[phraseIndex]);
    if (appIsReady()) readyToLeave = true;
    if (readyToLeave && elapsed >= minimumDuration) {
      hideSplash();
      return;
    }
    window.requestAnimationFrame(tick);
  };

  document.addEventListener("DOMContentLoaded", () => {
    const fallback = document.getElementById("openclaw-mount-fallback");
    if (!fallback || !window.MutationObserver) return;
    new MutationObserver(() => {
      if (!fallback.hidden) hideSplash();
    }).observe(fallback, { attributes: true, attributeFilter: ["hidden"] });
  });

  setProgress(8, phrases[0]);
  window.requestAnimationFrame(tick);
  window.addEventListener("load", () => {
    if (appIsReady()) readyToLeave = true;
  });
})();
