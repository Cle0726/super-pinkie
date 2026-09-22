(() => {
  "use strict";

  /* This only changes the file rail's presentation. It never changes the
     workspace, session file list, or what an agent can read and write. */
  const RAIL = ".chat-workbench > .chat-workspace-rail:not([data-laolao-fallback-rail=\"1\"])";
  const SYSTEM_FOLDERS = new Set([
    ".git", ".openclaw", "avatars", "memory", "persona", "skills", "node_modules", "__pycache__",
  ]);
  const SYSTEM_FILES = new Set([
    "agents.md", "aesthetics.md", "dreams.md", "heartbeat.md", "identity.md", "soul.md", "tools.md", "user.md",
  ]);
  const DELIVERY_FOLDERS = new Set([
    "final", "publish", "deliverable", "deliverables", "output", "outputs", "export", "exports", "release", "releases",
  ]);
  const MATERIAL_FOLDERS = new Set([
    "upload", "uploads", "attachment", "attachments", "inbox", "input", "inputs", "source", "sources", "reference", "references", "material", "materials",
  ]);
  const PROCESS_FOLDERS = new Set([
    "clawhub", "operations", "reports", "scripts", "tools", "work", "debug", "logs", "log", "tmp", "temp", "cache", "color_grades", "frames_inspect", "video_debug", "samples", "scenes_test", "seven_acts_vision",
  ]);
  const DELIVERY_FILE = /(?:^|[_-])(?:final|master|deliver|publish|output|export|release)(?:[_.-]|$)/i;
  const MATERIAL_FILE = /(?:^|[_-])(?:user|upload|inbound|attachment|source|reference|material|input)(?:[_.-]|$)/i;
  const PROCESS_FILE = /(?:^|[_-])(?:task|watchdog|debug|inspect|temp|raw|screen|frame|grade|state|log|ledger|report)(?:[_.-]|$)/i;
  const SECTION_LABELS = new Map([
    ["changed", "本轮重点文件"],
    ["artifacts", "会话附件"],
    ["read", "会话资料"],
    ["browser", "工作目录"],
  ]);

  let queued = false;

  const normalize = (value) => String(value || "").trim().toLowerCase();
  const rowName = (row) => row.querySelector(".chat-workspace-rail__file-name")?.textContent?.trim() || "";
  const rowPath = (row) => {
    const name = rowName(row);
    const meta = row.querySelector(".chat-workspace-rail__file-meta")?.textContent?.trim() || "";
    const sizedPath = meta.match(/^(.*?)\s+\/\s+\d+(?:\.\d+)?\s*(?:B|KB|MB|GB)$/i)?.[1]?.trim();
    return sizedPath || (/[\\/]/.test(name) ? name : meta || name);
  };
  const isSystemName = (name) => {
    const value = normalize(name);
    return SYSTEM_FOLDERS.has(value) ||
      SYSTEM_FILES.has(value) ||
      /^openclaw-workspace-state(?:-[\w.-]+)?\.json$/i.test(value) ||
      /^\.?(?:ds_store|gitignore)$/i.test(value);
  };
  const isSystemPath = (value) => {
    const parts = normalize(value).split(/[\\/]+/).filter(Boolean);
    return parts.some((part) => SYSTEM_FOLDERS.has(part)) || isSystemName(parts.at(-1));
  };
  const hasPart = (parts, candidates) => parts.some((part) => candidates.has(part));
  const classifyPath = (value) => {
    const normalized = normalize(value);
    const parts = normalized.split(/[\\/]+/).filter(Boolean);
    const file = parts.at(-1) || "";
    if (isSystemPath(normalized)) return "internal";
    if (hasPart(parts, MATERIAL_FOLDERS) || MATERIAL_FILE.test(file)) return "material";
    const underRun = parts.includes("runs");
    if (hasPart(parts, DELIVERY_FOLDERS) || DELIVERY_FILE.test(file) || (underRun && parts.at(-1) === "runs")) return "delivery";
    if (hasPart(parts, PROCESS_FOLDERS) || PROCESS_FILE.test(file)) return "internal";
    /* A run folder itself is a useful path into the final/publish tree. */
    if (underRun) return "delivery";
    return "other";
  };
  const isMissingRow = (row) => /(?:missing|缺失)/i.test(row.querySelector(".chat-workspace-rail__file-badge")?.textContent || "");

  const sectionKind = (title) => {
    const value = normalize(title);
    /* The native headings may already have been localized by an earlier
       decoration pass, so recognize both the original and display labels. */
    if (/^(?:已更改|changed|本轮产出|本轮重点文件)/.test(value)) return "changed";
    if (/^(?:工件|artifacts?|交付文件|会话附件)/.test(value)) return "artifacts";
    if (/^(?:已读取|read|你上传|会话资料)/.test(value)) return "read";
    if (/^(?:项目文件|files?|工作目录)/.test(value)) return "browser";
    return null;
  };

  const updateFocusControl = (rail, count) => {
    const anchor = rail.querySelector(".chat-workspace-rail__summary") ||
      rail.querySelector(".chat-workspace-rail__path") ||
      rail.querySelector(".chat-workspace-rail__header");
    if (!anchor) return;

    let control = rail.querySelector(":scope > .laolao-workspace-focus");
    if (!control) {
      control = document.createElement("div");
      control.className = "laolao-workspace-focus";
      const copy = document.createElement("p");
      copy.className = "laolao-workspace-focus__copy";
      copy.textContent = "只显示交付和资料；过程文件可按需展开";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "laolao-workspace-focus__toggle";
      toggle.addEventListener("click", () => {
        rail.dataset.laolaoSystemRequested = rail.dataset.laolaoSystemRequested === "true" ? "false" : "true";
        decorateRail(rail);
      });
      control.append(copy, toggle);
      anchor.insertAdjacentElement("afterend", control);
    }

    const toggle = control.querySelector(".laolao-workspace-focus__toggle");
    if (!toggle) return;
    if (count === 0) {
      control.hidden = true;
      return;
    }
    control.hidden = false;
    const visible = rail.dataset.laolaoSystemVisible === "true";
    toggle.textContent = visible ? "收起过程文件" : `显示过程 / 系统文件（${count}）`;
    toggle.setAttribute("aria-pressed", String(rail.dataset.laolaoSystemRequested === "true"));
  };

  const decorateRail = (rail) => {
    if (!rail?.isConnected) return;
    rail.dataset.laolaoWorkspaceFocus = "1";
    if (!rail.dataset.laolaoSystemRequested) rail.dataset.laolaoSystemRequested = "false";

    rail.querySelectorAll(".chat-workspace-rail__section").forEach((section) => {
      const title = section.querySelector(":scope > .chat-workspace-rail__section-title");
      const kind = sectionKind(title?.textContent);
      if (!kind || !title) return;
      section.dataset.laolaoWorkspaceSection = kind;
      if (title.textContent !== SECTION_LABELS.get(kind)) title.textContent = SECTION_LABELS.get(kind);
    });

    const browser = rail.querySelector(".chat-workspace-rail__browser");
    if (browser) browser.dataset.laolaoWorkspaceSection = "browser";
    const searchActive = Boolean(browser?.querySelector("input[type=search]")?.value?.trim());
    const showExtras = searchActive || rail.dataset.laolaoSystemRequested === "true";
    rail.dataset.laolaoSystemVisible = showExtras ? "true" : "false";
    let hiddenCount = 0;

    rail.querySelectorAll(".chat-workspace-rail__section").forEach((section) => {
      const kind = section.dataset.laolaoWorkspaceSection;
      if (kind !== "changed" && kind !== "read") return;
      let visibleRows = 0;
      section.querySelectorAll(".chat-workspace-rail__file").forEach((row) => {
        const fileKind = isMissingRow(row) ? "internal" : classifyPath(rowPath(row));
        /* The changed/read lists are already scoped to this conversation.
           A plain document there can be a real user upload or agent output,
           even if its filename does not contain a magic keyword. Only known
           process/state entries and missing paths are hidden here. */
        const extra = fileKind === "internal";
        if (extra) hiddenCount += 1;
        if (!extra || showExtras) visibleRows += 1;
        row.dataset.laolaoFocusKind = fileKind;
        row.dataset.laolaoFocusHidden = extra && !showExtras ? "true" : "false";
      });
      section.dataset.laolaoFocusEmpty = visibleRows === 0 && !showExtras ? "true" : "false";
    });

    let visibleBrowserRows = 0;
    browser?.querySelectorAll(".chat-workspace-rail__file").forEach((row) => {
      const fileKind = isMissingRow(row) ? "internal" : classifyPath(rowPath(row));
      const extra = fileKind === "internal" || fileKind === "other";
      if (extra) hiddenCount += 1;
      if (!extra || showExtras) visibleBrowserRows += 1;
      row.dataset.laolaoFocusKind = fileKind;
      row.dataset.laolaoFocusHidden = extra && !showExtras ? "true" : "false";
    });
    if (browser) browser.dataset.laolaoFocusEmpty = visibleBrowserRows === 0 && !showExtras ? "true" : "false";

    /* Searching is an intentional request for a file, including a process or
       system file, so it always shows the unfiltered native search result. */
    updateFocusControl(rail, hiddenCount);
  };

  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      document.querySelectorAll(RAIL).forEach(decorateRail);
    });
  };

  const observeRail = (rail) => {
    if (rail.dataset.laolaoWorkspaceFocusObserver === "1" || typeof MutationObserver !== "function") return;
    rail.dataset.laolaoWorkspaceFocusObserver = "1";
    const observer = new MutationObserver(schedule);
    /* The observer is bounded to this small rail. It is intentionally not a
       document/chat transcript observer, so streamed messages cannot trigger
       it or make the composer flicker. */
    observer.observe(rail, { childList: true, subtree: true });
    window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
  };

  document.addEventListener("pointerover", (event) => {
    const rail = event.target instanceof Element ? event.target.closest(RAIL) : null;
    if (!rail) return;
    observeRail(rail);
    decorateRail(rail);
  }, true);

  document.addEventListener("input", (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    const rail = input?.matches(".chat-workspace-rail__search input") ? input.closest(RAIL) : null;
    if (rail) window.setTimeout(() => decorateRail(rail), 0);
  }, true);

  const start = () => {
    document.querySelectorAll(RAIL).forEach((rail) => {
      observeRail(rail);
      decorateRail(rail);
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  window.setTimeout(start, 450);
})();
