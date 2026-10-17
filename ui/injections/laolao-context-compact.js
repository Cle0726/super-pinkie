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

  const renderContextViewer = () => {
    const metas = document.querySelectorAll(".agent-chat__composer-meta");
    document.querySelectorAll(".laolao-context-viewer").forEach((node) => {
      if (!node.closest(".agent-chat__composer-meta") || metas.length !== 1) node.remove();
    });
    // One capacity control for every mode and for both known/missing usage.
    // Keep Lit's native meter in place; CSS hides it only while ours is present.
    if (metas.length !== 1 || !usageKey) return;
    const meta = metas[0];
    const ratio = usageKey === currentSessionKey() ? usage : null;
    const describeThreshold = (capacity) => {
      const budget = capacity?.compactionBudget;
      if (!budget) return "";
      return `到约 ${formatTokens(budget.threshold)} 令牌（${Math.round(budget.triggerRatio * 100)}%）时自动整理`;
    };
    let viewer = meta.querySelector(".laolao-context-viewer");
    if (!viewer) {
      viewer = document.createElement("details");
      viewer.className = "laolao-context-viewer";
      viewer.innerHTML = `<summary><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" class="laolao-context-viewer__track"/><circle cx="8" cy="8" r="6.5" class="laolao-context-viewer__fill"/></svg><span class="laolao-context-viewer__percent"></span></summary><section class="laolao-context-viewer__popover"><strong>上下文容量</strong><div class="laolao-context-viewer__amount"></div><div class="laolao-context-viewer__bar"><span></span></div><small class="laolao-context-viewer__note"></small><button type="button" class="laolao-context-viewer__compact">现在整理上下文</button></section>`;
      // The ring owns manual compaction too: one entry instead of a second
      // composer button. The original button stays in the DOM as the anchor
      // and busy-state carrier for its confirmation popover.
      viewer.querySelector(".laolao-context-viewer__compact").addEventListener("click", (event) => {
        event.preventDefault();
        viewer.removeAttribute("open");
        document.querySelector(`.${BUTTON_CLASS}`)?.click();
      });
      meta.append(viewer);
    }
    const label = ratio ? `${ratio.approximate ? "约 " : ""}${ratio.percent}%` : "—";
    const setText = (selector, value) => {
      const node = viewer.querySelector(selector);
      if (node.textContent !== value) node.textContent = value;
    };
    setText(".laolao-context-viewer__percent", label);
    setText(".laolao-context-viewer__amount", ratio
      ? `${formatTokens(ratio.used)} / ${formatTokens(ratio.limit)} 令牌` : "等待会话用量数据");
    setText(".laolao-context-viewer__note", ratio
      ? `${ratio.approximate ? "估算 · " : ""}剩余约 ${formatTokens(Math.max(0, ratio.limit - ratio.used))} 令牌${describeThreshold(ratio) ? `；${describeThreshold(ratio)}` : ""}` : "有用量数据后会自动更新");
    const offset = String(40.84 * (1 - (ratio?.percent || 0) / 100));
    const fill = viewer.querySelector(".laolao-context-viewer__fill");
    if (fill.style.strokeDashoffset !== offset) fill.style.strokeDashoffset = offset;
    const width = `${ratio?.percent || 0}%`;
    const bar = viewer.querySelector(".laolao-context-viewer__bar span");
    if (bar.style.width !== width) bar.style.width = width;
    const summary = viewer.querySelector("summary");
    const thresholdText = describeThreshold(ratio);
    const aria = ratio ? `上下文容量：已用${label}，${formatTokens(ratio.used)} / ${formatTokens(ratio.limit)} 令牌${thresholdText ? `；${thresholdText}` : ""}` : "上下文容量：等待用量数据";
    if (summary.getAttribute("aria-label") !== aria) summary.setAttribute("aria-label", aria);
  };

  const renderCompactionNotice = () => {
    const key = currentSessionKey();
    const state = readCompactionState(key);
    document.querySelectorAll(".laolao-compaction-notice").forEach((node) => {
      if (!state || node.closest("[data-pinkie-compaction]")?.dataset.pinkieCompaction !== key) node.remove();
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
      const copy = document.createElement("strong");
      copy.className = "laolao-compaction-notice__copy";
      const note = document.createElement("span");
      note.className = "laolao-compaction-notice__note";
      const elapsed = document.createElement("span");
      elapsed.className = "laolao-compaction-notice__elapsed";
      notice.append(icon, copy, note, elapsed);
    }
    if (notice.parentElement !== host) host.prepend(notice);
    const active = state.phase === "active" || state.phase === "retrying";
    const phaseChanged = notice.dataset.phase !== state.phase;
    notice.dataset.phase = state.phase;
    const copy = notice.querySelector(".laolao-compaction-notice__copy");
    const note = notice.querySelector(".laolao-compaction-notice__note");
    const elapsed = notice.querySelector(".laolao-compaction-notice__elapsed");
    let message = "";
    let description = "";
    if (state.phase === "active") {
      message = "正在整理对话内容～";
      description = "可能需要几分钟，最近的内容会保留。";
    } else if (state.phase === "retrying") {
      message = "整理好了，接着处理～";
      description = "碧琪正在恢复当前任务，工作进度会继续显示。";
    }
    else if (state.phase === "complete") {
      const before = formatTokens(state.beforeTokens);
      const after = formatTokens(state.afterTokens);
      message = "对话整理好啦";
      description = before && after
        ? `对话整理完成：整理前 ${before} → ${after} 令牌`
        : "最近的内容已保留，可以继续当前任务。";
    } else if (state.phase === "skipped") message = "当前内容暂时不需要整理";
    else { message = "这次整理没有完成"; description = "当前对话仍保留，可以稍后再试。"; }
    if (copy.textContent !== message) copy.textContent = message;
    if (note.textContent !== description) note.textContent = description;
    const seconds = Math.max(0, Math.floor((Date.now() - Number(state.startedAt)) / 1000));
    const timeText = active
      ? `已用时 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
      : "";
    if (elapsed.textContent !== timeText) elapsed.textContent = timeText;
    if (phaseChanged) host.closest("openclaw-chat-pane")?.requestUpdate?.();
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
    } else if (details.phase === "end") {
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
.laolao-context-viewer{position:relative;color:#776b88;flex:none}.laolao-context-viewer summary{display:inline-flex;align-items:center;gap:5px;min-height:24px;padding:0 6px;border-radius:999px;cursor:pointer;list-style:none;font-size:11px;font-variant-numeric:tabular-nums}.laolao-context-viewer summary::-webkit-details-marker{display:none}.laolao-context-viewer summary:hover,.laolao-context-viewer[open] summary{background:rgba(206,140,181,.13)}.laolao-context-viewer svg{transform:rotate(-90deg);flex:none}.laolao-context-viewer circle{fill:none;stroke-width:2.5}.laolao-context-viewer__track{stroke:rgba(119,107,136,.22)}.laolao-context-viewer__fill{stroke:#bd73a2;stroke-linecap:round;stroke-dasharray:40.84;transition:stroke-dashoffset .35s ease}.laolao-context-viewer__popover{position:absolute;right:0;bottom:calc(100% + 9px);z-index:100;width:min(268px,calc(100vw - 24px));box-sizing:border-box;padding:14px;border:1px solid rgba(255,255,255,.78);border-radius:16px;background:linear-gradient(145deg,rgba(255,252,254,.97),rgba(248,234,244,.95));box-shadow:0 15px 38px rgba(88,54,77,.16);color:#503c56;font-size:11px}.laolao-context-viewer__popover strong{font-size:12px}.laolao-context-viewer__amount{margin-top:8px;font-variant-numeric:tabular-nums;font-weight:650}.laolao-context-viewer__bar{height:5px;margin:10px 0;border-radius:99px;background:rgba(119,107,136,.15);overflow:hidden}.laolao-context-viewer__bar span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#c888b1,#9fa5db);transition:width .35s ease}.laolao-context-viewer__note{color:#766b7e;line-height:1.4}.laolao-context-viewer__compact{display:block;width:100%;height:28px;margin-top:10px;border:1px solid rgba(184,99,136,.22);border-radius:9px;background:rgba(255,255,255,.8);color:inherit;font:500 11.5px/1 inherit;cursor:pointer}.laolao-context-viewer__compact:hover{background:#fff}
.agent-chat__composer-meta:has(> .laolao-context-viewer) > .context-usage{display:none!important}
.compaction-indicator--active:not(.laolao-compaction-notice),.compaction-indicator--complete:not(.laolao-compaction-notice){display:none!important}
.pinkie-chat-compaction:empty{display:none}
.laolao-compaction-notice{display:grid;grid-template-columns:30px minmax(0,1fr);column-gap:11px;row-gap:4px;box-sizing:border-box;width:min(560px,calc(100% - 66px));margin:12px 16px 12px 50px;padding:14px 17px;border:1px solid rgba(205,91,141,.18);border-radius:17px;background:linear-gradient(135deg,rgba(255,250,253,.86),rgba(247,234,243,.68));color:#70425a;box-shadow:0 5px 18px rgba(106,48,79,.05)}
.laolao-compaction-notice__icon{grid-column:1;grid-row:1 / span 3;display:grid;place-items:center;align-self:start;width:28px;height:28px;border-radius:9px;background:rgba(205,91,141,.10);color:#a34b72}
.laolao-compaction-notice__icon::before{content:"";width:13px;height:15px;border:1.3px solid currentColor;border-radius:3px;box-shadow:3px -3px 0 -1px rgba(205,91,141,.25);opacity:.75}
.laolao-compaction-notice[data-phase="active"] .laolao-compaction-notice__icon::before{width:12px;height:12px;border-radius:50%;border-color:rgba(189,115,162,.28);border-top-color:#a34b72;box-shadow:none;animation:laolao-context-spin 1.1s linear infinite}
.laolao-compaction-notice[data-phase="complete"] .laolao-compaction-notice__icon::before{content:"✓";width:auto;height:auto;border:0;box-shadow:none;color:#698e76;font-size:18px;line-height:1}
.laolao-compaction-notice__copy{grid-column:2;font-size:13px;font-weight:600;line-height:1.5;letter-spacing:.01em}
.laolao-compaction-notice__note{grid-column:2;font-size:12px;line-height:1.6;color:#937889}
.laolao-compaction-notice__note:empty,.laolao-compaction-notice__elapsed:empty{display:none}
.laolao-compaction-notice__elapsed{grid-column:2;margin-top:2px;font-size:10.5px;color:#a38a98;font-variant-numeric:tabular-nums}
html[data-pinkie-night] .laolao-compaction-notice{border-color:rgba(220,160,197,.17);background:linear-gradient(135deg,rgba(46,37,50,.82),rgba(36,32,42,.70));color:#e5c5d7;box-shadow:0 5px 18px rgba(0,0,0,.08)}
html[data-pinkie-night] .laolao-compaction-notice__note,html[data-pinkie-night] .laolao-compaction-notice__elapsed{color:#ae91a3}
@media(max-width:640px){.laolao-compaction-notice{width:calc(100% - 32px);margin:10px 16px;padding:12px 14px}}
@media(prefers-reduced-motion:reduce){.laolao-compaction-notice__icon::before{animation:none!important}}
.chat-divider{margin:6px 8px!important}.chat-divider__rule{gap:8px!important;min-height:15px}.chat-divider__label{color:#a34b72!important;font-size:10.5px!important;letter-spacing:.025em;line-height:1.35;white-space:nowrap}.chat-divider__line{opacity:.45}.chat-divider__details{display:none!important}
`;
    document.head.append(style);
  };

  document.addEventListener("pointerdown", (event) => {
    if (popover && !popover.contains(event.target) && !event.target.closest?.(`.${BUTTON_CLASS}`)) closePopover();
  }, true);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closePopover(); });
  ensureStyle();
  render();
  setInterval(render, 900);
  window.addEventListener("pinkie:gateway-event", handleCompactionEvent);
  window.addEventListener("laolao:sessions-changed", () => { usageFetchedAt = 0; fetchContextCapacity(); });
  window.__laolaoContextCompact = {compact, currentSessionKey, contextCapacity, readCompactionState, handleCompactionEvent};
})();
