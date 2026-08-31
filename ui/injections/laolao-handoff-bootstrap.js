(() => {
  // Run synchronously beside the splash markup so a mode handoff is painted
  // at its carried percentage on the very first frame of the new document.
  let handoff = null;
  try {
    handoff = JSON.parse(sessionStorage.getItem("laolao:mode-handoff") || "null");
  } catch {}
  if (!handoff || !["chat", "project", "thinking", "unrestricted"].includes(handoff.mode)) return;

  const splash = document.getElementById("laolao-splash");
  const fill = document.getElementById("laolao-splash-fill");
  const message = document.getElementById("laolao-splash-message");
  const percentage = document.getElementById("laolao-splash-percentage");
  const progressbar = splash?.querySelector('[role="progressbar"]');
  if (!splash || !fill || !message || !percentage) return;

  const details = {
    chat: { label: "唠嗑模式", waiting: "新聊天正在铺开彩带…" },
    project: { label: "项目模式", waiting: "项目档案正在摊开…" },
    thinking: { label: "想法模式", waiting: "灵感房间正在亮灯…" },
    unrestricted: { label: "无限制模式", waiting: "彩虹力量正在接管房间…" },
  }[handoff.mode];
  const carriedProgress = Math.max(68, Math.min(96, Number(handoff.progress) || 68));

  splash.dataset.handoffBootstrapped = "1";
  splash.classList.add("is-mode-progress", `is-mode-progress--${handoff.mode}`);
  splash.style.setProperty(
    "--laolao-mode-progress-image",
    `url("./laolao-mode-transition-${handoff.mode}.png?v=transition2")`,
  );
  const eyebrow = splash.querySelector(".laolao-splash__eyebrow");
  const title = splash.querySelector(".laolao-splash__title");
  if (eyebrow) eyebrow.textContent = "碧琪的模式切换";
  if (title) title.textContent = details.label;

  fill.style.transition = "none";
  fill.style.width = `${carriedProgress}%`;
  percentage.textContent = `${carriedProgress}%`;
  message.textContent = details.waiting;
  progressbar?.setAttribute("aria-valuenow", String(carriedProgress));
})();
