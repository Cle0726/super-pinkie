/* Manual context compaction for every chat mode. Uses OpenClaw's native
   sessions.compact RPC directly, so no slash-command message appears in chat. */
(() => {
  "use strict";

  const BUTTON_CLASS = "laolao-context-compact-btn";
  const POPOVER_ID = "laolao-context-compact-popover";
  const COMPACTION_STATE_PREFIX = "laolao.context-compaction.v1:";
  const COMPACTION_COMPLETE_MS = 10_000;
  const COMPACTION_MAX_AGE_MS = 15 * 60_000;
  let busy = false;
  let popover = null;
  let usage = null;
  let usageKey = "";
  let usageFetchedAt = 0;
  let usageRequest = null;
  let sessionInfo = null;
  let glyphLoad;
  const glyphBase = document.currentScript?.src;
  function mountCompactionGlyph(icon, phase) {
    if (window.__pinkieCompactionGlyph) { window.__pinkieCompactionGlyph.mount(icon,phase); return; }
    glyphLoad ||= new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('./laolao-compaction-glyph.js?v=compactionglyph2',glyphBase||location.href).href;script.onload=resolve;script.onerror=reject;document.head.append(script);});
    glyphLoad.then(()=>{if(icon.isConnected)window.__pinkieCompactionGlyph?.mount(icon,icon.closest('.laolao-compaction-notice')?.dataset.phase||phase);}).catch(()=>{});
  }
  const noticeMotionObserver = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      entry.target.dataset.onscreen = entry.isIntersecting ? "1" : "0";
      entry.target.dataset.motion = !document.hidden && entry.isIntersecting ? "running" : "paused";
      window.__pinkieCompactionGlyph?.setVisible(entry.target.querySelector(".laolao-compaction-notice__icon"),entry.target.dataset.motion==="running");
    }
  }, {threshold: 0}) : null;
  document.addEventListener("visibilitychange", () => {
    document.querySelectorAll(".laolao-compaction-notice").forEach((node) => {
      node.dataset.motion = !document.hidden && node.dataset.onscreen !== "0" ? "running" : "paused";
      window.__pinkieCompactionGlyph?.setVisible(node.querySelector(".laolao-compaction-notice__icon"),node.dataset.motion==="running");
    });
  });

  const currentSessionKey = () => {
    const routed = new URLSearchParams(location.search).get("session") || "";
    if (/^agent:(main|project|thinking|learning|unrestricted):/.test(routed)) return routed;
    const active = document.querySelector(".sidebar-recent-session--active[data-session-key]");
    return active?.dataset?.sessionKey || "";
  };

  const toast = (message) => {
    const shared = window.__laolaoToast;
    if (typeof shared === "function") shared(message);
    else window.dispatchEvent(new CustomEvent("laolao:toast", {detail: {message}}));
  };

  const closePopover = () => {
    popover?.remove();
    popover = null;
    document.querySelector(`.${BUTTON_CLASS}`)?.setAttribute("aria-expanded", "false");
  };

  const formatTokens = (value) => {
    if (value == null || value === "") return "";
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number).toLocaleString() : "";
  };

  const contextCapacity = (session, defaults) => {
    if (session?.totalTokens == null) return null;
    const used = Number(session?.totalTokens);
    const limit = Number(session?.contextTokens || defaults?.contextTokens);
    if (!Number.isFinite(used) || used < 0 || !Number.isFinite(limit) || limit <= 0) return null;
    const percent = Math.min(100, Math.round(used / limit * 100));
    const sourceBudget = session?.pinkieCompactionBudget;
    const compactionBudget = sourceBudget
      && Number(sourceBudget.window) === limit
      && Number.isFinite(Number(sourceBudget.threshold))
      && Number.isFinite(Number(sourceBudget.triggerRatio))
      ? {window: Number(sourceBudget.window), threshold: Number(sourceBudget.threshold), triggerRatio: Number(sourceBudget.triggerRatio)}
      : null;
    return {used, limit, percent, approximate: session?.totalTokensFresh === false, compactionBudget};
  };

  const compactionStorageKey = (key) => `${COMPACTION_STATE_PREFIX}${encodeURIComponent(key)}`;

  const readCompactionState = (key) => {
    if (!key) return null;
    try {
      const state = JSON.parse(localStorage.getItem(compactionStorageKey(key)) || "null");
      if (!state || !Number.isFinite(Number(state.startedAt))) return null;
      const age = Date.now() - Number(state.startedAt);
      if (state.phase === "complete" || state.phase === "skipped" || state.phase === "failed") {
        if (!Number.isFinite(Number(state.completedAt)) || Date.now() - Number(state.completedAt) > COMPACTION_COMPLETE_MS) {
          localStorage.removeItem(compactionStorageKey(key));
          return null;
        }
      } else if (age > COMPACTION_MAX_AGE_MS) {
        localStorage.removeItem(compactionStorageKey(key));
        return null;
      }
      return state;
    } catch { return null; }
  };

  const saveCompactionState = (key, state) => {
    try { localStorage.setItem(compactionStorageKey(key), JSON.stringify(state)); } catch {}
  };

  const readSessionInfo = async (key, timeout = 15_000) => {
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (!key || typeof rpc !== "function") return null;
    const agentId = key.split(":")[1];
    const result = await rpc("sessions.list", {agentId, limit: 1000}, timeout);
    const session = result?.sessions?.find?.((item) => item.key === key) || null;
    return {key, session, capacity: contextCapacity(session, result?.defaults), result};
  };

  const captureCompactionBaseline = (key, startedAt) => {
    void readSessionInfo(key).then((info) => {
      const state = readCompactionState(key);
      if (!state || state.startedAt !== startedAt || !["active", "retrying"].includes(state.phase)) return;
      if (state.beforeTokens == null && Number.isFinite(info?.capacity?.used)) state.beforeTokens = info.capacity.used;
      if (state.beforeCount == null && Number.isFinite(Number(info?.session?.compactionCount))) state.beforeCount = Number(info.session.compactionCount);
      saveCompactionState(key, state);
      if (usageKey === key && info?.capacity) {
        sessionInfo = info;
        usage = info.capacity;
        renderContextViewer();
      }
    }).catch(() => {});
  };

  const beginCompaction = (key, source, runId = "") => {
    if (!key) return;
    const previous = readCompactionState(key);
    const continuing = previous && ["active", "retrying"].includes(previous.phase);
    const startedAt = continuing ? previous.startedAt : Date.now();
    const sessionCount = sessionInfo?.key === key ? Number(sessionInfo.session?.compactionCount) : NaN;
    const state = {
      ...(continuing ? previous : {}),
      phase: "active",
      source: previous?.source || source,
      runId: runId || previous?.runId || "",
      startedAt,
      beforeTokens: previous?.beforeTokens ?? (usageKey === key ? usage?.used : null),
      beforeCount: previous?.beforeCount ?? (Number.isFinite(sessionCount) ? sessionCount : null)
    };
    saveCompactionState(key, state);
    renderCompactionNotice();
    if (state.beforeTokens == null || state.beforeCount == null) captureCompactionBaseline(key, startedAt);
  };

  const finishCompaction = (key, details = {}) => {
    const previous = readCompactionState(key);
    if (!previous || (["complete", "skipped", "failed"].includes(previous.phase) && details.final !== true)) return;
    const phase = details.completed ? "complete" : details.outcome === "skipped" ? "skipped" : "failed";
    const state = {
      ...previous,
      phase,
      completedAt: Date.now(),
      beforeTokens: details.tokensBefore != null && Number.isFinite(Number(details.tokensBefore)) ? Number(details.tokensBefore) : previous.beforeTokens,
      afterTokens: details.tokensAfter != null && Number.isFinite(Number(details.tokensAfter)) ? Number(details.tokensAfter) : null,
      message: details.message || ""
    };
    saveCompactionState(key, state);
    renderCompactionNotice();
    if (phase !== "complete" || state.afterTokens != null) return;
    const completedAt = state.completedAt;
    void readSessionInfo(key).then((info) => {
      const current = readCompactionState(key);
      if (!current || current.phase !== "complete" || current.completedAt !== completedAt) return;
      if (Number.isFinite(Number(info?.session?.totalTokens))) current.afterTokens = Number(info.session.totalTokens);
      if (usageKey === key && info?.capacity) {
        sessionInfo = info;
        usage = info.capacity;
        renderContextViewer();
      }
      saveCompactionState(key, current);
      renderCompactionNotice();
    }).catch(() => {});
  };

  const reconcileCompactionState = (key, session, capacity) => {
    const state = readCompactionState(key);
    if (!state || !["active", "retrying"].includes(state.phase)) return;
    const countAdvanced = state.beforeCount != null && Number.isFinite(Number(state.beforeCount))
      && Number.isFinite(Number(session?.compactionCount))
      && Number(session.compactionCount) > Number(state.beforeCount);
    const tokenCountDropped = state.beforeTokens != null && Number.isFinite(Number(state.beforeTokens))
      && Number.isFinite(Number(capacity?.used))
      && Number(capacity.used) < Number(state.beforeTokens);
    if (countAdvanced || tokenCountDropped) {
      finishCompaction(key, {completed: true, tokensBefore: state.beforeTokens, tokensAfter: capacity?.used});
    }
  };

  const fetchContextCapacity = () => {
    const key = currentSessionKey();
    if (key !== usageKey) {
      usageKey = key;
      usage = null;
      sessionInfo = null;
      usageFetchedAt = 0;
    }
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (!key || typeof rpc !== "function" || usageRequest || Date.now() - usageFetchedAt < 15000) return;
    usageFetchedAt = Date.now();
    const agentId = key.split(":")[1];
    usageRequest = readSessionInfo(key)
      .then((info) => {
        if (usageKey !== key) return;
        sessionInfo = info;
        usage = info?.capacity || null;
        reconcileCompactionState(key, info?.session, usage);
        renderContextViewer();
      })
      .catch(() => {})
      .finally(() => { usageRequest = null; });
  };

  // OpenClaw's own estimate (chars / 4), the same one its /context report uses.
  const estimateTokens = (chars) => Math.round((Number(chars) || 0) / 4);
  const shortTokens = (value) => {
    const number = Math.max(0, Number(value) || 0);
    if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number % 1_000_000 ? 2 : 0).replace(/\.?0+$/, "")}M`;
    if (number >= 1000) return `${(number / 1000).toFixed(1).replace(/\.0$/, "")}k`;
    return String(Math.round(number));
  };
  const sharePercent = (value, limit) => {
    const share = limit > 0 ? value / limit * 100 : 0;
    return share > 0 && share < 0.1 ? "<0.1%" : `${share.toFixed(1)}%`;
  };
  // Rows of the panel. Fixed parts come from the last run's report; the
  // conversation is whatever of the real usage those parts do not explain.
  const contextRows = (capacity, breakdown) => {
    const reserve = capacity.compactionBudget ? Math.max(0, capacity.limit - capacity.compactionBudget.threshold) : 0;
    const fixed = breakdown ? [
      {id: "tools", label: "工具定义", tokens: estimateTokens(breakdown.tools), count: breakdown.toolCount ? `${breakdown.toolCount} 个` : ""},
      {id: "rules", label: "系统规则", tokens: estimateTokens(breakdown.rules)},
      {id: "files", label: "人格与记忆文件", tokens: estimateTokens(breakdown.files), count: breakdown.fileCount ? `${breakdown.fileCount} 个` : ""},
      {id: "skills", label: "技能目录", tokens: estimateTokens(breakdown.skills), count: breakdown.skillCount ? `${breakdown.skillCount} 个` : ""}
    ] : [];
    const fixedTotal = fixed.reduce((sum, row) => sum + row.tokens, 0);
    // A stale total can be smaller than the estimate; never show negatives.
    if (fixedTotal > capacity.used && fixedTotal > 0) fixed.forEach((row) => { row.tokens = Math.round(row.tokens * capacity.used / fixedTotal); });
    const used = breakdown
      ? [{id: "messages", label: "对话消息", tokens: Math.max(0, capacity.used - fixed.reduce((sum, row) => sum + row.tokens, 0))}, ...fixed]
      : [{id: "messages", label: "已使用", tokens: capacity.used}];
    const free = Math.max(0, capacity.limit - capacity.used - reserve);
    return [
      ...used,
      ...(reserve ? [{id: "reserve", label: "自动整理预留", tokens: Math.min(reserve, Math.max(0, capacity.limit - capacity.used))}] : []),
      {id: "free", label: "剩余空间", tokens: free}
    ];
  };

  const compactFromPanel = () => {
    const anchor = document.querySelector(`.${BUTTON_CLASS}`) || makeButton();
    void compact(anchor);
  };

  // While open, the panel lives directly under <body>: inside the composer
  // it shares the composer's stacking context, so page content outside the
  // composer (the start page greeting) could paint over it.
  const panelOf = (viewer) => viewer.__lcvPanel;
  const placePanel = (viewer) => {
    const panel = panelOf(viewer);
    const summary = viewer.querySelector("summary");
    if (!panel || !summary || panel.parentElement !== document.body) return;
    const rect = summary.getBoundingClientRect();
    const width = panel.offsetWidth;
    const left = `${Math.round(Math.max(12, Math.min(rect.right - width, innerWidth - width - 12)))}px`;
    const bottom = `${Math.round(Math.max(12, innerHeight - rect.top + 10))}px`;
    if (panel.style.left !== left) panel.style.left = left;
    if (panel.style.bottom !== bottom) panel.style.bottom = bottom;
  };
  const dockPanel = (viewer) => {
    const panel = panelOf(viewer);
    if (!panel) return;
    if (viewer.open && viewer.isConnected) {
      if (panel.parentElement !== document.body) { document.body.append(panel); panel.classList.add("is-floating"); }
      placePanel(viewer);
    } else if (panel.parentElement !== viewer) {
      panel.classList.remove("is-floating");
      if (viewer.isConnected) viewer.append(panel); else panel.remove();
    }
  };

  const buildContextViewer = () => {
    const viewer = document.createElement("details");
    viewer.className = "laolao-context-viewer";
    viewer.innerHTML = `<summary><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" class="laolao-context-viewer__track"/><circle cx="8" cy="8" r="6.5" class="laolao-context-viewer__fill"/></svg><span class="laolao-context-viewer__percent"></span></summary>`
      + `<section class="laolao-context-viewer__popover" role="dialog" aria-label="上下文">`
      + `<header class="lcv-head"><strong>上下文</strong><small class="lcv-muted lcv-source"></small></header>`
      + `<div class="lcv-total"><b class="lcv-used"></b><small class="lcv-muted lcv-amount"></small></div>`
      + `<div class="lcv-bar" aria-hidden="true"></div>`
      + `<ul class="lcv-rows"></ul>`
      + `<small class="lcv-muted lcv-note"></small>`
      + `<footer class="lcv-actions"><button type="button" class="laolao-context-viewer__compact">现在整理上下文</button></footer>`
      + `</section>`;
    const panel = viewer.querySelector(".laolao-context-viewer__popover");
    viewer.__lcvPanel = panel;
    // One click compacts: the button is already behind the panel, no second confirm.
    panel.querySelector(".laolao-context-viewer__compact").addEventListener("click", (event) => {
      event.preventDefault();
      viewer.removeAttribute("open");
      compactFromPanel();
    });
    viewer.addEventListener("toggle", () => {
      dockPanel(viewer);
      if (viewer.open) {
        // Opening always asks for fresh numbers instead of a 15s-old cache.
        usageFetchedAt = 0;
        fetchContextCapacity();
        renderContextViewer();
      }
    });
    return viewer;
  };

  const renderContextViewer = () => {
    const metas = document.querySelectorAll(".agent-chat__composer-meta");
    document.querySelectorAll(".laolao-context-viewer").forEach((node) => {
      if (!node.closest(".agent-chat__composer-meta") || metas.length !== 1) { node.remove(); panelOf(node)?.remove(); }
    });
    document.querySelectorAll(".laolao-context-viewer__popover.is-floating").forEach((panel) => {
      const owner = Array.from(document.querySelectorAll(".laolao-context-viewer")).find((node) => panelOf(node) === panel);
      if (!owner?.open) panel.remove();
    });
    // One capacity control for every mode and for both known/missing usage.
    // Keep Lit's native meter in place; CSS hides it only while ours is present.
    if (metas.length !== 1 || !usageKey) return;
    const meta = metas[0];
    const ratio = usageKey === currentSessionKey() ? usage : null;
    const breakdown = ratio && sessionInfo?.key === usageKey ? sessionInfo.session?.pinkieContextBreakdown || null : null;
    const describeThreshold = (capacity) => {
      const budget = capacity?.compactionBudget;
      if (!budget) return "";
      return `到约 ${formatTokens(budget.threshold)} 令牌（${Math.round(budget.triggerRatio * 100)}%）时自动整理`;
    };
    let viewer = meta.querySelector(".laolao-context-viewer");
    if (!viewer) {
      viewer = buildContextViewer();
      meta.append(viewer);
    }
    const label = ratio ? `${ratio.approximate ? "约 " : ""}${ratio.percent}%` : "—";
    const panel = panelOf(viewer);
    const setText = (selector, value) => {
      const node = viewer.querySelector(selector) || panel?.querySelector(selector);
      if (node && node.textContent !== value) node.textContent = value;
    };
    setText(".laolao-context-viewer__percent", label);
    const offset = String(40.84 * (1 - (ratio?.percent || 0) / 100));
    const fill = viewer.querySelector(".laolao-context-viewer__fill");
    if (fill.style.strokeDashoffset !== offset) fill.style.strokeDashoffset = offset;
    const thresholdText = describeThreshold(ratio);
    const summary = viewer.querySelector("summary");
    const aria = ratio ? `上下文容量：已用${label}，${formatTokens(ratio.used)} / ${formatTokens(ratio.limit)} 令牌${thresholdText ? `；${thresholdText}` : ""}` : "上下文容量：等待用量数据";
    if (summary.getAttribute("aria-label") !== aria) summary.setAttribute("aria-label", aria);
    viewer.dataset.level = !ratio ? "" : ratio.compactionBudget && ratio.used >= ratio.compactionBudget.threshold * 0.9 ? "high" : ratio.percent >= 50 ? "mid" : "low";

    // The panel is only rebuilt while it is open.
    dockPanel(viewer);
    if (!viewer.open) return;
    setText(".lcv-used", ratio ? `已使用 ${label}` : "等待会话用量数据");
    setText(".lcv-amount", ratio ? `${shortTokens(ratio.used)} / ${shortTokens(ratio.limit)}` : "");
    setText(".lcv-source", ratio ? (breakdown ? "明细为估算" : "") : "");
    const rows = ratio ? contextRows(ratio, breakdown) : [];
    const signature = JSON.stringify(rows.map((row) => [row.id, row.tokens, row.count || ""]));
    if (viewer.dataset.rows !== signature) {
      viewer.dataset.rows = signature;
      const bar = panel.querySelector(".lcv-bar");
      const list = panel.querySelector(".lcv-rows");
      bar.replaceChildren(...rows.filter((row) => row.id !== "free" && row.tokens > 0).map((row) => {
        const part = document.createElement("i");
        part.className = `lcv-c-${row.id}`;
        part.style.width = `${Math.max(0.6, row.tokens / ratio.limit * 100)}%`;
        return part;
      }));
      list.replaceChildren(...rows.map((row) => {
        const item = document.createElement("li");
        item.className = `lcv-row lcv-c-${row.id}`;
        const dot = document.createElement("i");
        const name = document.createElement("span");
        name.className = "lcv-name";
        name.textContent = row.label;
        if (row.count) {
          const count = document.createElement("small");
          count.className = "lcv-muted";
          count.textContent = row.count;
          name.append(" ", count);
        }
        const amount = document.createElement("b");
        amount.textContent = shortTokens(row.tokens);
        const share = document.createElement("small");
        share.className = "lcv-muted";
        share.textContent = sharePercent(row.tokens, ratio.limit);
        item.append(dot, name, amount, share);
        return item;
      }));
    }
    const notes = [];
    if (ratio?.approximate) notes.push("用量为估算");
    if (thresholdText) notes.push(thresholdText);
    if (ratio && !breakdown) notes.push("发一条消息后会显示每一类占多少");
    setText(".lcv-note", ratio ? notes.join(" · ") : "有用量数据后会自动更新");
    const main = panel.querySelector(".laolao-context-viewer__compact");
    const state = readCompactionState(usageKey);
    const compacting = busy || ["active", "retrying"].includes(state?.phase);
    const streaming = Boolean(document.querySelector(".chat-send-btn--stop"));
    const mainText = compacting ? "正在整理上下文…" : streaming ? "回复结束后可以整理" : "现在整理上下文";
    if (main.textContent !== mainText) main.textContent = mainText;
    const disabled = compacting || streaming || !ratio;
    if (main.disabled !== disabled) main.disabled = disabled;
    placePanel(viewer);
  };

  const renderCompactionNotice = () => {
    const key = currentSessionKey();
    const state = readCompactionState(key);
    document.querySelectorAll(".laolao-compaction-notice").forEach((node) => {
      if (!state || node.closest("[data-pinkie-compaction]")?.dataset.pinkieCompaction !== key) { window.__pinkieCompactionGlyph?.park(node.querySelector(".laolao-compaction-notice__icon")); noticeMotionObserver?.unobserve(node); node.remove(); }
    });
    if (!state) return;
    // This empty, per-session slot is rendered by the native chat template.
    // Only its unmanaged children belong to us; never append into Lit's list
    // of messages or into the composer.
    const host = Array.from(document.querySelectorAll("[data-pinkie-compaction]"))
      .find((node) => node.dataset.pinkieCompaction === key);
    if (!host) return;
    let notice = host.querySelector(".laolao-compaction-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "laolao-compaction-notice";
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      notice.dataset.laolaoCompactionNotice = "true";
      const icon = document.createElement("span");
      icon.className = "laolao-compaction-notice__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "C.le.";
      const copy = document.createElement("strong");
      copy.className = "laolao-compaction-notice__copy";
      const note = document.createElement("span");
      note.className = "laolao-compaction-notice__note";
      const elapsed = document.createElement("span");
      elapsed.className = "laolao-compaction-notice__elapsed";
      elapsed.setAttribute("aria-hidden", "true");
      notice.append(icon, copy, note, elapsed);
      notice.dataset.motion = document.hidden ? "paused" : "running";
      noticeMotionObserver?.observe(notice);
    }
    if (notice.parentElement !== host) host.prepend(notice);
    const active = state.phase === "active" || state.phase === "retrying";
    const phaseChanged = notice.dataset.phase !== state.phase;
    notice.dataset.phase = state.phase;
    mountCompactionGlyph(notice.querySelector(".laolao-compaction-notice__icon"),state.phase);
    const copy = notice.querySelector(".laolao-compaction-notice__copy");
    const note = notice.querySelector(".laolao-compaction-notice__note");
    const elapsed = notice.querySelector(".laolao-compaction-notice__elapsed");
    let message = "";
    let description = "";
    if (state.phase === "active") {
      message = "正在整理上下文";
      description = "最近内容会保留，历史记录仍可回看。";
    } else if (state.phase === "retrying") {
      message = "整理好了，接着处理～";
      description = "碧琪正在恢复当前任务，工作进度会继续显示。";
    }
    else if (state.phase === "complete") {
      const before = formatTokens(state.beforeTokens);
      const after = formatTokens(state.afterTokens);
      message = "对话整理好啦";
      description = before && after
        ? `整理前 ${before} → 整理后 ${after} 令牌`
        : "最近的内容已保留，可以继续当前任务。";
    } else if (state.phase === "skipped") message = "当前内容暂时不需要整理";
    else { message = "这次整理没有完成"; description = "当前对话仍保留，可以稍后再试。"; }
    if (copy.textContent !== message) copy.textContent = message;
    if (note.textContent !== description) note.textContent = description;
    if (note.title !== description) note.title = description;
    const seconds = Math.max(0, Math.floor((Date.now() - Number(state.startedAt)) / 1000));
    const timeText = active
      ? `已用时 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
      : "";
    if (elapsed.textContent !== timeText) elapsed.textContent = timeText;
    if (phaseChanged) host.closest("openclaw-chat-pane")?.requestUpdate?.();
  };

  // Usage is persisted when a run (or a compaction) ends. Ask right away and
  // once more shortly after, instead of waiting out the 15s cache.
  let usageRefreshTimer = 0;
  const refreshUsageSoon = (key) => {
    if (key !== currentSessionKey()) return;
    usageFetchedAt = 0;
    fetchContextCapacity();
    clearTimeout(usageRefreshTimer);
    usageRefreshTimer = setTimeout(() => { usageFetchedAt = 0; fetchContextCapacity(); }, 1800);
  };

  const handleCompactionEvent = (event) => {
    const name = event.detail?.event;
    const payload = event.detail?.payload || {};
    const key = typeof payload.sessionKey === "string" ? payload.sessionKey : "";
    if (!key || !/^agent:(main|project|thinking|learning|unrestricted):/.test(key)) return;
    const terminal = name === "agent" && payload.stream === "lifecycle"
      && ["end", "error"].includes(payload.data?.phase)
      || name === "chat" && ["final", "aborted", "error"].includes(payload.state);
    if (terminal) {
      refreshUsageSoon(key);
      const state = readCompactionState(key);
      // The compaction already succeeded before retrying the original task.
      // Its matching terminal event clears the continuation notice, including
      // when the task ends with an error. Never finish another run's notice.
      if (state?.phase === "retrying" && state.runId && state.runId === payload.runId) {
        finishCompaction(key, {completed: true});
      }
      return;
    }
    if (name === "session.operation" && payload.operation === "compact") {
      if (payload.phase === "start") beginCompaction(key, "manual", payload.operationId || "");
      else if (payload.phase === "end") {
        refreshUsageSoon(key);
        finishCompaction(key, {
          completed: payload.completed === true,
          outcome: payload.completed === false ? "failed" : "",
          tokensBefore: payload.tokensBefore,
          tokensAfter: payload.tokensAfter
        });
      }
      return;
    }
    if (name !== "agent" || payload.stream !== "compaction") return;
    const details = payload.data || {};
    if (details.phase === "start") {
      beginCompaction(key, "automatic", payload.runId || "");
    } else if (details.phase === "end" && details.willRetry === true && details.completed === true) {
      const state = readCompactionState(key);
      if (state) {
        state.phase = "retrying";
        state.runId = payload.runId || state.runId;
        saveCompactionState(key, state);
        renderCompactionNotice();
      }
    } else if (details.phase === "end" && details.preflight === true && details.skipped === true) {
      // The pre-send check decided nothing needed compacting: drop the notice
      // quietly instead of announcing a non-event.
      const state = readCompactionState(key);
      if (state && ["active", "retrying"].includes(state.phase)) {
        try { localStorage.removeItem(compactionStorageKey(key)); } catch {}
        renderCompactionNotice();
      }
    } else if (details.phase === "end") {
      refreshUsageSoon(key);
      finishCompaction(key, {
        completed: details.completed === true,
        outcome: details.completed === false ? "failed" : "",
        tokensBefore: details.tokensBefore,
        tokensAfter: details.tokensAfter
      });
    }
  };

  const localizeCompactionDividers = () => {
    const labelText = "前面的对话已整理，原始记录仍保留";
    document.querySelectorAll(".chat-divider").forEach((divider) => {
      const label = divider.querySelector(".chat-divider__label");
      if (!label) return;
      // Keep Lit's text/comment nodes and bindings intact. Replacing all
      // children or removing the native details can break the next update.
      for (const node of label.childNodes) {
        if (node.nodeType === 3 && node.nodeValue?.trim() && node.nodeValue !== labelText) node.nodeValue = labelText;
      }
      const rule = divider.querySelector(".chat-divider__rule");
      if (rule?.getAttribute("aria-label") !== labelText) rule?.setAttribute("aria-label", labelText);
    });
  };

  const compact = async (button) => {
    if (busy) return;
    if (document.querySelector(".chat-send-btn--stop")) {
      toast("当前回复完成后再整理上下文");
      return;
    }
    const key = currentSessionKey();
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (!key || key.includes(":subagent:") || typeof rpc !== "function") {
      toast("当前会话还没连接好");
      return;
    }
    busy = true;
    closePopover();
    button.classList.add("is-running");
    button.disabled = true;
    button.setAttribute("aria-label", "正在整理上下文");
    beginCompaction(key, "manual");
    try {
      const agentId = key.split(":")[1] || undefined;
      const result = await rpc("sessions.compact", {key, agentId}, 600_000);
      if (!result?.ok) throw new Error("整理没有完成");
      finishCompaction(key, {
        completed: result.compacted === true,
        outcome: result.compacted === false ? "skipped" : "",
        final: true,
        tokensBefore: result.result?.tokensBefore,
        tokensAfter: result.result?.tokensAfter
      });
      window.dispatchEvent(new Event("laolao:sessions-changed"));
    } catch {
      finishCompaction(key, {outcome: "failed", final: true});
    } finally {
      busy = false;
      button.classList.remove("is-running");
      button.disabled = false;
      button.setAttribute("aria-label", "手动整理上下文");
    }
  };

  const openPopover = (button) => {
    if (popover) { closePopover(); return; }
    popover = document.createElement("section");
    popover.id = POPOVER_ID;
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "手动整理上下文");
    const copy = document.createElement("div");
    copy.className = "laolao-context-compact__copy";
    const title = document.createElement("strong");
    title.textContent = "整理上下文";
    const desc = document.createElement("span");
    desc.textContent = "浓缩较早内容，最近对话和工作检查点继续保留。";
    copy.append(title, desc);
    const actions = document.createElement("div");
    actions.className = "laolao-context-compact__actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    cancel.addEventListener("click", closePopover);
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "is-primary";
    confirm.textContent = "开始整理";
    confirm.addEventListener("click", () => void compact(button));
    actions.append(cancel, confirm);
    popover.append(copy, actions);
    document.body.append(popover);
    const buttonRect = button.getBoundingClientRect();
    const rect = popover.getBoundingClientRect();
    popover.style.left = `${Math.max(10, Math.min(buttonRect.right - rect.width, innerWidth - rect.width - 10))}px`;
    popover.style.top = `${Math.max(10, buttonRect.top - rect.height - 8)}px`;
    button.setAttribute("aria-expanded", "true");
  };

  const makeButton = () => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.setAttribute("aria-label", "手动整理上下文");
    button.setAttribute("aria-expanded", "false");
    button.title = "手动整理上下文";
    button.innerHTML = "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M5 8h5V3M19 16h-5v5M10 8 4 2M14 16l6 6'/><path d='M14 8h5V3M10 16H5v5'/></svg>";
    button.addEventListener("click", () => openPopover(button));
    return button;
  };

  const render = () => {
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((node) => {
      if (!node.closest(".agent-chat__composer-actions")) node.remove();
    });
    const actions = document.querySelector(".agent-chat__composer-actions");
    if (actions && !actions.querySelector(`.${BUTTON_CLASS}`)) {
      const deepThink = actions.querySelector(".laolao-deep-think-btn");
      const button = makeButton();
      if (deepThink) actions.insertBefore(button, deepThink);
      else actions.append(button);
    }
    fetchContextCapacity();
    renderContextViewer();
    renderCompactionNotice();
    localizeCompactionDividers();
  };

  const ensureStyle = () => {
    if (document.getElementById("laolao-context-compact-style")) return;
    const style = document.createElement("style");
    style.id = "laolao-context-compact-style";
    style.textContent = `
.laolao-context-compact-btn{position:relative;display:inline-grid;place-items:center;width:30px;height:30px;margin:0 2px;padding:0;border:1px solid transparent;border-radius:999px;background:transparent;color:#a34b72;cursor:pointer;transition:background .16s ease,border-color .16s ease,color .16s ease}.laolao-context-compact-btn:hover,.laolao-context-compact-btn[aria-expanded="true"]{border-color:rgba(205,91,141,.28);background:rgba(255,248,252,.48)}.laolao-context-compact-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.45;stroke-linecap:round;stroke-linejoin:round}.laolao-context-compact-btn.is-running svg{animation:laolao-context-spin 1.1s linear infinite}.laolao-context-compact-btn:disabled{cursor:wait;opacity:.72}
#laolao-context-compact-popover{position:fixed;z-index:2147483000;width:min(286px,calc(100vw - 20px));padding:12px;border:1px solid rgba(255,255,255,.74);border-radius:17px;background:linear-gradient(145deg,rgba(255,252,253,.94),rgba(249,228,240,.91));color:#61394e;box-shadow:0 18px 42px rgba(84,42,65,.16),inset 0 1px rgba(255,255,255,.78);animation:laolao-context-pop .16s cubic-bezier(.2,.78,.28,1) both}.laolao-context-compact__copy{display:flex;flex-direction:column;gap:4px}.laolao-context-compact__copy strong{font-size:12px}.laolao-context-compact__copy span{color:rgba(97,57,78,.62);font-size:10.5px;line-height:1.45}.laolao-context-compact__actions{display:flex;justify-content:flex-end;gap:6px;margin-top:10px}.laolao-context-compact__actions button{padding:5px 10px;border:1px solid rgba(184,99,136,.18);border-radius:999px;background:rgba(255,255,255,.42);color:inherit;font-size:10.5px;cursor:pointer}.laolao-context-compact__actions button.is-primary{border-color:rgba(205,76,132,.26);background:#d85b91;color:white}
#laolao-context-compact-toast{position:fixed;left:50%;bottom:72px;z-index:2147483647;max-width:min(520px,84vw);padding:8px 14px;border:1px solid rgba(255,255,255,.74);border-radius:999px;background:rgba(252,235,244,.96);color:#6d3650;box-shadow:0 10px 28px rgba(106,48,79,.16);font-size:12px;opacity:0;pointer-events:none;transform:translate(-50%,6px);transition:opacity .18s ease,transform .18s ease;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#laolao-context-compact-toast.is-visible{opacity:1;transform:translate(-50%,0)}
@keyframes laolao-context-spin{to{transform:rotate(360deg)}}@keyframes laolao-context-pop{from{opacity:0;transform:translateY(4px) scale(.985)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.laolao-context-compact-btn,.laolao-context-compact-btn svg,#laolao-context-compact-popover,#laolao-context-compact-toast{animation:none!important;transition:none!important}}
.laolao-context-viewer{position:relative;color:#776b88;flex:none}.laolao-context-viewer summary{display:inline-flex;align-items:center;gap:5px;min-height:24px;padding:0 6px;border-radius:999px;cursor:pointer;list-style:none;font-size:11px;font-variant-numeric:tabular-nums}.laolao-context-viewer summary::-webkit-details-marker{display:none}.laolao-context-viewer summary:hover,.laolao-context-viewer[open] summary{background:rgba(206,140,181,.13)}.laolao-context-viewer svg{transform:rotate(-90deg);flex:none}.laolao-context-viewer circle{fill:none;stroke-width:2.5}.laolao-context-viewer__track{stroke:rgba(119,107,136,.22)}.laolao-context-viewer__fill{stroke:#bd73a2;stroke-linecap:round;stroke-dasharray:40.84;transition:stroke-dashoffset .35s ease}.laolao-context-viewer[data-level="mid"] .laolao-context-viewer__fill{stroke:#c9789f}.laolao-context-viewer[data-level="high"] .laolao-context-viewer__fill{stroke:#e0607e}
.laolao-context-viewer__popover{position:absolute;right:0;bottom:calc(100% + 10px);z-index:100;width:min(312px,calc(100vw - 24px));box-sizing:border-box;padding:16px 16px 14px;border:1px solid rgba(255,255,255,.8);border-radius:18px;background:linear-gradient(150deg,rgba(255,252,254,.97),rgba(249,236,245,.95));box-shadow:0 18px 44px rgba(88,54,77,.17),inset 0 1px rgba(255,255,255,.8);backdrop-filter:blur(18px) saturate(120%);-webkit-backdrop-filter:blur(18px) saturate(120%);color:#4d3a52;font-size:12px;line-height:1.35;--lcv-messages:#d46a9d;--lcv-tools:#8e9be3;--lcv-rules:#e2a45f;--lcv-files:#5fb3a2;--lcv-skills:#b48ad8;--lcv-reserve:rgba(119,107,136,.32);--lcv-free:rgba(119,107,136,.12);--lcv-muted:#8a7c90}
.laolao-context-viewer__popover.is-floating{position:fixed;right:auto;bottom:auto;z-index:2147482000;animation:lcv-pop .18s cubic-bezier(.2,.78,.28,1) both}@keyframes lcv-pop{from{opacity:0;translate:0 6px;scale:.98}to{opacity:1;translate:0 0;scale:1}}
.laolao-context-viewer__popover .lcv-muted{color:var(--lcv-muted);font-weight:400}
.lcv-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.lcv-head strong{font-size:13px;font-weight:650;letter-spacing:.02em}.lcv-source{font-size:10.5px}
.lcv-total{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:10px;font-variant-numeric:tabular-nums}.lcv-used{font-size:17px;font-weight:650}.lcv-amount{font-size:12px}
.lcv-bar{display:flex;gap:2px;height:7px;margin:10px 0 12px;border-radius:99px;background:var(--lcv-free);overflow:hidden}.lcv-bar i{display:block;height:100%;flex:none;border-radius:2px;transition:width .35s ease}
.lcv-rows{display:grid;gap:7px;margin:0;padding:0;list-style:none}.lcv-row{display:grid;grid-template-columns:10px minmax(0,1fr) auto 46px;align-items:center;gap:9px;font-variant-numeric:tabular-nums}.lcv-row>i{width:10px;height:10px;border-radius:3px}.lcv-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lcv-name small{font-size:10.5px}.lcv-row b{font-weight:550;text-align:right}.lcv-row>small{text-align:right;font-size:11px}
.lcv-c-messages{background:var(--lcv-messages)}.lcv-c-tools{background:var(--lcv-tools)}.lcv-c-rules{background:var(--lcv-rules)}.lcv-c-files{background:var(--lcv-files)}.lcv-c-skills{background:var(--lcv-skills)}.lcv-c-reserve{background:repeating-linear-gradient(135deg,var(--lcv-reserve) 0 3px,transparent 3px 6px)}.lcv-c-free{background:var(--lcv-free)}
.lcv-row.lcv-c-messages,.lcv-row.lcv-c-tools,.lcv-row.lcv-c-rules,.lcv-row.lcv-c-files,.lcv-row.lcv-c-skills,.lcv-row.lcv-c-reserve,.lcv-row.lcv-c-free{background:none}
.lcv-row.lcv-c-messages>i{background:var(--lcv-messages)}.lcv-row.lcv-c-tools>i{background:var(--lcv-tools)}.lcv-row.lcv-c-rules>i{background:var(--lcv-rules)}.lcv-row.lcv-c-files>i{background:var(--lcv-files)}.lcv-row.lcv-c-skills>i{background:var(--lcv-skills)}.lcv-row.lcv-c-reserve>i{background:repeating-linear-gradient(135deg,var(--lcv-reserve) 0 2px,transparent 2px 4px);box-shadow:inset 0 0 0 1px var(--lcv-reserve)}.lcv-row.lcv-c-free>i{background:transparent;box-shadow:inset 0 0 0 1px var(--lcv-reserve)}
.lcv-row.lcv-c-free,.lcv-row.lcv-c-reserve{color:var(--lcv-muted)}
.lcv-note{display:block;margin-top:12px;padding-top:10px;border-top:1px solid rgba(119,107,136,.14);font-size:11px;line-height:1.5}.lcv-note:empty{display:none}
.lcv-actions{margin-top:10px}.laolao-context-viewer__compact{display:block;width:100%;height:32px;border:1px solid rgba(184,99,136,.24);border-radius:10px;background:rgba(255,255,255,.78);color:inherit;font:500 12px/1 inherit;cursor:pointer;transition:background .16s ease,border-color .16s ease}.laolao-context-viewer__compact:hover:not(:disabled){background:#fff;border-color:rgba(205,91,141,.38)}.laolao-context-viewer__compact:disabled{cursor:default;opacity:.6}
.laolao-context-viewer__popover :is(button):focus-visible{outline:2px solid rgba(207,66,130,.45);outline-offset:1px}
html[data-pinkie-night]:not(#_n) .laolao-context-viewer__popover{--lcv-muted:#a99bb0;--lcv-reserve:rgba(220,205,230,.3);--lcv-free:rgba(255,255,255,.08)}
html[data-pinkie-night]:not(#_n) .laolao-context-viewer__popover .lcv-muted,html[data-pinkie-night]:not(#_n) .laolao-context-viewer__popover .lcv-row.lcv-c-free span,html[data-pinkie-night]:not(#_n) .laolao-context-viewer__popover .lcv-row.lcv-c-reserve span{color:var(--lcv-muted)!important}
html[data-pinkie-night]:not(#_n) .lcv-note{border-top-color:rgba(255,255,255,.08)}
@media(prefers-reduced-motion:reduce){.lcv-bar i,.laolao-context-viewer__compact{transition:none}.laolao-context-viewer__popover.is-floating{animation:none}}
.agent-chat__composer-meta:has(> .laolao-context-viewer) > .context-usage{display:none!important}
.compaction-indicator--active:not(.laolao-compaction-notice),.compaction-indicator--complete:not(.laolao-compaction-notice){display:none!important}
.pinkie-chat-compaction:empty{display:none}
/* Context compaction: a borderless divider in the timeline. The knot canvas
   spans the row; status and timer sit centred beneath it. */
.laolao-compaction-notice{--memory-ink:#2c2945;--memory-muted:#7a7590;--memory-glint:#2f7bff;display:grid;grid-template-columns:minmax(0,1fr) auto auto minmax(0,1fr);grid-template-areas:"art art art art" ". copy time ." "note note note note";column-gap:8px;align-items:center;box-sizing:border-box;width:min(640px,calc(100% - 32px));max-width:100%;margin:12px auto 14px;padding:0;border:0;background:none;box-shadow:none;color:var(--memory-ink);overflow:hidden}
.laolao-compaction-notice__icon{grid-area:art;display:block;position:relative;width:100%;height:34px;color:var(--memory-ink)}
.pinkie-compaction-knot,.pinkie-compaction-knot>canvas{display:block;width:100%;height:34px}
.laolao-compaction-notice__icon::before{content:none}
.laolao-compaction-notice__copy{grid-area:copy;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;line-height:20px;letter-spacing:.02em}
.laolao-compaction-notice:is([data-phase="active"],[data-phase="retrying"]) .laolao-compaction-notice__copy{background-image:linear-gradient(105deg,var(--memory-ink) 0 40%,var(--memory-glint) 50%,var(--memory-ink) 60% 100%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:pinkie-memory-sheen 2.8s linear infinite}
.laolao-compaction-notice__elapsed{grid-area:time;font-size:11px;line-height:20px;color:var(--memory-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.laolao-compaction-notice__elapsed:not(:empty)::before{content:"·";margin-right:8px;opacity:.6}
.laolao-compaction-notice__elapsed:empty{display:none}
.laolao-compaction-notice:has(.laolao-compaction-notice__elapsed:empty) .laolao-compaction-notice__copy{grid-column:2 / 4;text-align:center}
.laolao-compaction-notice__note{grid-area:note;min-width:0;font-size:11px;line-height:17px;color:var(--memory-muted);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.laolao-compaction-notice__note:empty{display:none}
.laolao-compaction-notice[data-phase="failed"]{--memory-ink:#8a5d2c;--memory-muted:#9a7a5a}
html:is([data-pinkie-night],[data-theme-mode="dark"]) .laolao-compaction-notice{--memory-ink:#e9eeff;--memory-muted:#9aa2c0;--memory-glint:#8ccaff}
html:is([data-pinkie-night],[data-theme-mode="dark"]) .laolao-compaction-notice[data-phase="failed"]{--memory-ink:#e8c08f;--memory-muted:#b89d7e}
.laolao-compaction-notice[data-motion="paused"] *{animation-play-state:paused!important}
@keyframes pinkie-memory-sheen{from{background-position:130% 0}to{background-position:-130% 0}}
@media(max-width:640px){.laolao-compaction-notice{width:calc(100% - 24px);margin:10px 12px 12px}}
@media(prefers-reduced-motion:reduce){.laolao-compaction-notice *{animation:none!important}.laolao-compaction-notice .laolao-compaction-notice__copy{-webkit-text-fill-color:currentColor;background:none}}
.chat-divider{margin:6px 8px!important}.chat-divider__rule{gap:8px!important;min-height:15px}.chat-divider__label{color:#a34b72!important;font-size:10.5px!important;letter-spacing:.025em;line-height:1.35;white-space:nowrap}.chat-divider__line{opacity:.45}.chat-divider__details{display:none!important}
`;
    document.head.append(style);
  };

  document.addEventListener("pointerdown", (event) => {
    if (popover && !popover.contains(event.target) && !event.target.closest?.(`.${BUTTON_CLASS}`)) closePopover();
    document.querySelectorAll(".laolao-context-viewer[open]").forEach((viewer) => {
      if (!viewer.contains(event.target) && !panelOf(viewer)?.contains(event.target)) viewer.removeAttribute("open");
    });
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closePopover();
    const open = document.querySelector(".laolao-context-viewer[open]");
    if (open) { open.removeAttribute("open"); open.querySelector("summary")?.focus(); }
  });
  // Keep the floating panel beside its ring when the window changes size.
  window.addEventListener("resize", () => document.querySelectorAll(".laolao-context-viewer[open]").forEach(placePanel), {passive: true});
  ensureStyle();
  render();
  setInterval(render, 900);
  window.addEventListener("pinkie:gateway-event", handleCompactionEvent);
  window.addEventListener("laolao:sessions-changed", () => { usageFetchedAt = 0; fetchContextCapacity(); });
  window.__laolaoContextCompact = {compact, currentSessionKey, contextCapacity, readCompactionState, handleCompactionEvent};
})();
