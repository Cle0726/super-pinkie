(() => {
  "use strict";

  // 忙碌时，原生 control-ui 会先把文字留成 chatQueue 项。这里不改写
  // handleSendChat，也不自己发 chat.send：只等原生项出现，再委托 pane
  // 自己的 steerQueuedChatMessage / retryQueuedChatMessage 继续处理。
  // 这样原生的提交防重、附件处理、持久化和断线重试仍是唯一的权威路径。

  const paneForEvent = (event) => {
    const path = event.composedPath?.() || [];
    const fromPath = path.find((node) => node?.tagName?.toLowerCase?.() === "openclaw-chat-pane");
    if (fromPath) return fromPath;
    const fromTarget = event.target?.closest?.("openclaw-chat-pane");
    if (fromTarget) return fromTarget;
    const panes = document.querySelectorAll?.("openclaw-chat-pane") || [];
    return panes.length === 1 ? panes[0] : null;
  };
  // The native composer lives in a shadow root in current control-ui builds.
  // At document capture phase event.target is retargeted to the chat pane, so
  // inspect composedPath() instead of assuming closest() can see the textarea.
  const pathMatch = (event, selector) => (event.composedPath?.() || []).find((node) =>
    node?.matches?.(selector)) || event.target?.closest?.(selector) || null;
  const composerForEvent = (event) => pathMatch(event, ".agent-chat__composer-combobox textarea");

  const queueFor = (pane) => Array.isArray(pane?.state?.chatQueue) ? pane.state.chatQueue : [];
  // Current control-ui exposes queue actions on its state/controller object,
  // while a few older builds proxy them onto the custom element.  Resolve the
  // public native action rather than assuming either shape; do not recreate
  // its chat.send protocol here.
  const nativeQueueMethod = (pane, name) => {
    for (const owner of [pane, pane?.state, pane?.controller, pane?.chatController]) {
      if (typeof owner?.[name] === "function") return owner[name].bind(owner);
    }
    return null;
  };
  const paneBusy = (pane) => {
    const state = pane?.state;
    if (state?.chatRunId || state?.chatSending || state?.chatStream) return true;
    const stop = pane?.querySelector?.(".chat-send-btn--stop");
    return Boolean(stop && stop.offsetParent !== null);
  };
  const notify = (message) => {
    if (typeof window.__laolaoToast === "function") window.__laolaoToast(message);
    else window.dispatchEvent(new CustomEvent("laolao:toast", {detail: {message}}));
  };
  const requestPaint = (pane) => {
    pane?.state?.requestUpdate?.();
    pane?.requestUpdate?.();
  };
  const normalizedText = (value) => String(value || "").trim();
  const itemFor = (pane, id) => queueFor(pane).find((item) => item?.id === id) || null;

  const setComposerTextIfEmpty = (pane, text) => {
    const value = String(text || "");
    if (!value.trim()) return false;
    const state = pane?.state;
    const input = pane?.querySelector?.(".agent-chat__composer-combobox textarea")
      || document.querySelector?.(".agent-chat__composer-combobox textarea");
    if (normalizedText(state?.chatMessage) || normalizedText(input?.value)) return false;
    // Use the textarea's normal input event so the native controlled composer
    // owns the new draft. No Lit-managed chat DOM is rewritten here.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement?.prototype || {}, "value"
    )?.set;
    if (input) {
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event("input", {bubbles: true}));
    } else if (state) {
      state.chatMessage = value;
      requestPaint(pane);
    }
    return true;
  };

  const restoreOrKeep = (pane, item, reason) => {
    const restored = setComposerTextIfEmpty(pane, item?.text);
    if (restored) notify(reason || "暂时没能送出，原文已放回输入框。");
    else notify(reason || "暂时没能送出，原文已保留在待发送卡片里。");
    return restored;
  };

  const makeQueuedAgain = (pane, id) => {
    const state = pane?.state;
    const item = itemFor(pane, id);
    if (!state || !item) return null;
    state.chatQueue = queueFor(pane).map((entry) => entry?.id === id ? {
      ...entry,
      kind: "queued",
      pendingRunId: undefined,
      sendState: undefined,
      sendError: undefined,
    } : entry);
    requestPaint(pane);
    return itemFor(pane, id);
  };

  const locallyDelivered = (pane, item) => {
    const delivered = window.__laolaoQueueRecovery?.isDelivered;
    if (typeof delivered !== "function") return false;
    try { return delivered(item, pane?.state?.chatMessages || []); } catch { return false; }
  };

  // `steerQueuedChatMessage()` has one awkward native race: terminal handling
  // can remove its pending card before the steer RPC returns `timeout`. Keep a
  // copy of the original card until delivery is visible, then put it back as a
  // normal native queue item for the history-deduped retry path. This is state
  // repair only; the actual send still goes through retryQueuedChatMessage.
  const restoreMissingQueuedItem = (pane, original) => {
    const state = pane?.state;
    if (!state || !original || itemFor(pane, original.id)) return itemFor(pane, original.id);
    if (original.sessionKey && state.sessionKey && original.sessionKey !== state.sessionKey) return null;
    state.chatQueue = [...queueFor(pane), {
      ...original,
      kind: "queued",
      pendingRunId: undefined,
      sendState: undefined,
      sendError: undefined,
    }];
    requestPaint(pane);
    return itemFor(pane, original.id);
  };

  const queueRecovery = async (pane, reason) => {
    const recovery = window.__laolaoQueueRecovery;
    if (typeof recovery?.recover !== "function") return null;
    try { return await recovery.recover(pane, reason); } catch { return null; }
  };

  const settleFallback = async (pane, id, reason) => {
    await queueRecovery(pane, reason);
    // Native retry can be asynchronous. A later failed/offline item is the
    // only point where we put text back into an empty composer; otherwise its
    // original queue card stays the single source of truth and cannot duplicate.
    window.setTimeout(() => {
      const item = itemFor(pane, id);
      if (!item) return;
      if (item.sendState === "failed" || pane?.state?.connected === false) {
        restoreOrKeep(pane, item);
      }
    }, 500);
  };

  const steerQueued = async (pane, id, {automatic = false} = {}) => {
    const original = itemFor(pane, id);
    if (!original) return {state: "gone"};
    const runId = pane?.state?.chatRunId;
    const steer = nativeQueueMethod(pane, "steerQueuedChatMessage");
    if (!runId || !steer) {
      if (automatic) notify("这轮结束后发送。");
      await settleFallback(pane, id, "no-tracked-run");
      return {state: "queued"};
    }
    try {
      await steer(id);
    } catch {
      // Older bundles surface transport failures by throwing, newer ones leave
      // the original queued item in place. Both converge through this branch.
    }
    const current = itemFor(pane, id);
    if (!current) {
      if (locallyDelivered(pane, original)) return {state: "delivered"};
      const restored = restoreMissingQueuedItem(pane, original);
      if (!restored) {
        restoreOrKeep(pane, original);
        return {state: "retained"};
      }
      if (automatic) notify("这轮结束后发送。");
      await settleFallback(pane, id, "steer-race-missing-card");
      return {state: "queued"};
    }
    if (current.kind === "steered" && current.pendingRunId) {
      requestPaint(pane);
      return {state: "steered"};
    }
    makeQueuedAgain(pane, id);
    if (automatic) notify("这轮结束后发送。");
    await settleFallback(pane, id, "steer-fallback");
    return {state: "queued"};
  };

  const pendingByPane = new WeakMap();
  const scheduleDefaultSteer = (pane, text) => {
    if (!pane || !paneBusy(pane) || !normalizedText(text)) return;
    const state = pane.state;
    const pending = pendingByPane.get(pane) || [];
    const startedAt = Date.now();
    const ticket = {
      text: normalizedText(text),
      ids: new Set(queueFor(pane).map((item) => item?.id)),
      startedAt,
      attempts: 0,
    };
    // A click/keypress can be observed twice while a component remounts. Keep
    // the one short-lived intent, but allow intentionally repeated messages.
    if (pending.some((entry) => entry.text === ticket.text && startedAt - entry.startedAt < 300)) return;
    pending.push(ticket);
    pendingByPane.set(pane, pending);

    const observe = () => {
      ticket.attempts += 1;
      const item = queueFor(pane).find((entry) => entry && !ticket.ids.has(entry.id)
        && normalizedText(entry.text) === ticket.text);
      if (item) {
        const list = pendingByPane.get(pane) || [];
        pendingByPane.set(pane, list.filter((entry) => entry !== ticket));
        void steerQueued(pane, item.id, {automatic: true});
        return;
      }
      if (ticket.attempts < 30 && pane?.isConnected !== false
          && pane?.state === state && paneBusy(pane)) {
        window.setTimeout(observe, 25);
        return;
      }
      const list = pendingByPane.get(pane) || [];
      pendingByPane.set(pane, list.filter((entry) => entry !== ticket));
    };
    // Let the native event handler create the queue item first. This also
    // lets its chatSubmitGuards reject a duplicate before we touch anything.
    window.setTimeout(observe, 0);
  };

  const sendButton = (event) => {
    const button = pathMatch(event, ".chat-send-btn");
    if (!button || button.disabled || button.hasAttribute?.("disabled")) return null;
    if (["chat-send-btn--stop", "chat-send-btn--voice", "chat-send-btn--laolao-dictation", "chat-send-btn--queue"]
      .some((name) => button.classList?.contains(name))) return null;
    return button;
  };

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.altKey) return;
    const input = composerForEvent(event);
    if (input?.value) scheduleDefaultSteer(paneForEvent(event), input.value);
  }, true);
  document.addEventListener("click", (event) => {
    const button = sendButton(event);
    if (!button) return;
    const pane = paneForEvent(event);
    const input = composerForEvent(event) || pane?.querySelector?.(".agent-chat__composer-combobox textarea")
      || document.querySelector?.(".agent-chat__composer-combobox textarea");
    if (input?.value) scheduleDefaultSteer(pane, input.value);
  }, true);

  const deferSteered = (pane, id) => {
    const item = makeQueuedAgain(pane, id);
    if (!item) return;
    notify("已改为这轮结束后发送。");
    void queueRecovery(pane, "user-defer-steered");
  };

  const ensureDeferControl = (row, pane, item) => {
    const actions = row.querySelector?.(".chat-queue__actions");
    if (!actions) return;
    let control = actions.querySelector?.(".chat-queue__pinkie-defer");
    if (!control) {
      control = document.createElement("button");
      control.type = "button";
      control.className = "btn chat-queue__pinkie-defer";
      control.setAttribute("aria-label", "改为结束后发送");
      control.setAttribute("title", "改为结束后发送");
      control.append(document.createTextNode("改为结束后发"));
      control.addEventListener("click", () => {
        const id = control.dataset.pinkieQueueId;
        if (id) deferSteered(pane, id);
      });
      actions.append(control);
    }
    control.dataset.pinkieQueueId = item.id;
  };

  const syncQueueControls = () => {
    for (const pane of document.querySelectorAll?.("openclaw-chat-pane") || []) {
      const visible = queueFor(pane).filter((item) => item?.sendState !== "sending");
      const rows = pane.querySelectorAll?.(".chat-queue__item") || [];
      rows.forEach((row, index) => {
        const item = visible[index];
        if (!item) return;
        row.dataset.pinkieQueueId = item.id;
        if (item.kind === "steered") ensureDeferControl(row, pane, item);
        else row.querySelector?.(".chat-queue__pinkie-defer")?.remove();
      });
    }
  };

  const start = () => {
    syncQueueControls();
    const root = document.querySelector("openclaw-app") || document.querySelector("#openclaw-mount-fallback");
    if (!root || root.dataset.pinkieQueueSteerWatch === "1") return;
    root.dataset.pinkieQueueSteerWatch = "1";
    new MutationObserver(() => syncQueueControls()).observe(root, {
      childList: true, subtree: true,
    });
  };

  window.__laolaoQueueSteer = {
    steerQueued, makeQueuedAgain, restoreMissingQueuedItem, syncQueueControls,
    // Kept as a small diagnostic/test seam for bundle API drift. It never
    // sends directly; both functions resolve and call native queue actions.
    scheduleDefaultSteer, nativeQueueMethod,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once: true});
  else start();
})();
