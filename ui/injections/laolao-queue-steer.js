(() => {
  "use strict";
  if (window.__laolaoQueueSteer) return;

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
  const sameSession = (pane, item) => !item?.sessionKey || !pane?.state?.sessionKey
    || item.sessionKey === pane.state.sessionKey;
  const itemFor = (pane, id) => queueFor(pane).find((item) => item?.id === id && sameSession(pane, item)) || null;
  const nativeInFlight = (item) => Boolean(item?.sendRunId || item?.pendingRunId
    || item?.sendRequestStartedAtMs || item?.queueMode === "steer"
    || ["sending", "submitting", "waiting-model", "unconfirmed", "held", "delivery-unknown"].includes(item?.sendState));

  // A queued card is already the recoverable source of the user's text. Copying
  // it into the composer as well makes Enter submit a second copy.
  const restoreOrKeep = (pane, item, reason) => {
    notify(reason || "暂时没能确认送达，原文已保留在消息卡片里。");
    return false;
  };

  const makeQueuedAgain = (pane, id) => {
    const state = pane?.state;
    const item = itemFor(pane, id);
    if (!state || !item) return null;
    // An accepted steer cannot be taken back locally. Re-queueing it would send
    // the same instruction again after the current run ends.
    if (item.kind === "steered" || nativeInFlight(item)) return null;
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
  // copy as unconfirmed until delivery is visible. An ambiguous timeout is
  // never permission to send a second copy automatically.
  const restoreMissingQueuedItem = (pane, original) => {
    const state = pane?.state;
    if (!state || !original || itemFor(pane, original.id)) return itemFor(pane, original.id);
    if (original.sessionKey && state.sessionKey && original.sessionKey !== state.sessionKey) return null;
    state.chatQueue = [...queueFor(pane), {
      ...original,
      kind: "queued",
      pendingRunId: undefined,
      sendState: "unconfirmed",
      sendError: "送达未确认，请核对聊天记录后再重试。",
    }];
    requestPaint(pane);
    return itemFor(pane, original.id);
  };

  const queueRecovery = async (pane, reason) => {
    const recovery = window.__laolaoQueueRecovery;
    if (typeof recovery?.recover !== "function") return null;
    try { return await recovery.recover(pane, reason); } catch { return null; }
  };

  const receiptChecks = new WeakMap();
  const pruneDelivered = async (pane, force = false) => {
    const prune = window.__laolaoQueueRecovery?.pruneDelivered;
    if (typeof prune !== "function") return [];
    const queue = queueFor(pane);
    if (!queue.some((item) => item?.kind === "steered" || item?.queueMode === "steer"
        || nativeInFlight(item))) return [];
    const previous = receiptChecks.get(pane);
    if (previous?.promise) return previous.promise;
    if (!force && previous && Date.now() - previous.at < 1000) return [];
    const check = {at: Date.now(), promise: null};
    const state = pane.state, sessionKey = state?.sessionKey, sessionId = state?.currentSessionId;
    receiptChecks.set(pane, check);
    check.promise = Promise.resolve(prune(pane)).then((ids) => {
      if (pane.state !== state || state?.sessionKey !== sessionKey || state?.currentSessionId !== sessionId) return [];
      if (ids?.length) notify("已追加到当前任务。");
      return Array.isArray(ids) ? ids : [];
    }).catch(() => []).finally(() => { check.promise = null; });
    return check.promise;
  };

  const settleFallback = async (pane, id, reason) => {
    // Unknown delivery is not proof that sending failed. Only confirmed unsent
    // cards may enter the ordinary retry path.
    if (itemFor(pane, id)?.sendState !== "unconfirmed") await queueRecovery(pane, reason);
    // Native retry can be asynchronous. Keep its original card as the one
    // recoverable source, including after a failure or disconnect.
    window.setTimeout(() => {
      const item = itemFor(pane, id);
      if (!item) return;
      if (item.sendState === "failed" || pane?.state?.connected === false) {
        restoreOrKeep(pane, item);
      }
    }, 500);
  };

  const steeringByPane = new WeakMap();
  const performSteer = async (pane, id, {automatic = false} = {}) => {
    const original = itemFor(pane, id);
    if (!original) return {state: "gone"};
    const state = pane?.state, sessionKey = state?.sessionKey;
    const sessionId = state?.currentSessionId;
    const currentScope = () => pane?.state === state && state.sessionKey === sessionKey
      && state.currentSessionId === sessionId;
    if (original.kind === "steered" || nativeInFlight(original)) {
      await pruneDelivered(pane, true);
      if (!currentScope()) return {state: "superseded"};
      return {state: itemFor(pane, id) ? "unconfirmed" : "delivered"};
    }
    const runId = pane?.state?.chatRunId;
    const steer = nativeQueueMethod(pane, "steerQueuedChatMessage");
    if (!runId || !steer) {
      if (automatic) notify("这轮结束后发送。");
      await settleFallback(pane, id, "no-tracked-run");
      return {state: "queued"};
    }
    let receipt;
    try {
      receipt = await steer(id);
    } catch {
      // Older bundles surface transport failures by throwing, newer ones leave
      // the original queued item in place. Both converge through this branch.
    }
    if (!currentScope()) return {state: "superseded"};
    const current = itemFor(pane, id);
    if (!current) {
      if (locallyDelivered(pane, original)
          || ["ok", "accepted", "in_flight", "started"].includes(receipt?.status)) return {state: "delivered"};
      const restored = restoreMissingQueuedItem(pane, original);
      if (!restored) {
        restoreOrKeep(pane, original);
        return {state: "retained"};
      }
      if (automatic) notify("追加的送达状态还未确认，原文已保留，请勿重复发送。");
      await settleFallback(pane, id, "steer-race-missing-card");
      return {state: "unconfirmed"};
    }
    const accepted = ["ok", "accepted", "in_flight", "started"].includes(receipt?.status);
    if (accepted || current.kind === "steered") {
      if (current.kind !== "steered") {
        state.chatQueue = queueFor(pane).map((item) => item.id === id ? {...item,
          kind: "steered", pendingRunId: receipt?.runId || runId, sendState: "unconfirmed"} : item);
      }
      await pruneDelivered(pane, true);
      if (!currentScope()) return {state: "superseded"};
      requestPaint(pane);
      return {state: itemFor(pane, id) ? "steered" : "delivered"};
    }
    // 2026.10 keeps the submission in its outbox and returns void. Its
    // sending/submitting fields and idempotency key must stay intact.
    if (nativeInFlight(current)) {
      await pruneDelivered(pane, true);
      if (!currentScope()) return {state: "superseded"};
      return {state: itemFor(pane, id) ? "unconfirmed" : "delivered"};
    }
    // A thrown timeout or a void result is ambiguous, even when the card
    // remained in the queue. Keep the original exactly once and ask for proof.
    state.chatQueue = queueFor(pane).map((item) => item.id === id ? {...item,
      sendState: item.sendState === "failed" ? "failed" : "unconfirmed",
      sendError: item.sendError || "送达未确认，请核对聊天记录后再重试。"} : item);
    requestPaint(pane);
    await pruneDelivered(pane, true);
    if (!currentScope()) return {state: "superseded"};
    return {state: itemFor(pane, id) ? "unconfirmed" : "delivered"};
  };
  const steerQueued = (pane, id, options = {}) => {
    let pending = steeringByPane.get(pane);
    if (!pending) steeringByPane.set(pane, pending = new Map());
    if (pending.has(id)) return pending.get(id);
    const promise = performSteer(pane, id, options).finally(() => pending.delete(id));
    pending.set(id, promise);
    return promise;
  };

  const pendingByPane = new WeakMap();
  const scheduleDefaultSteer = (pane, text) => {
    if (!pane || !paneBusy(pane) || !normalizedText(text)) return;
    const state = pane.state;
    const sessionKey = state?.sessionKey;
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
      if (pane?.state !== state || state?.sessionKey !== sessionKey) {
        pendingByPane.set(pane, (pendingByPane.get(pane) || []).filter((entry) => entry !== ticket));
        return;
      }
      const item = queueFor(pane).find((entry) => entry && !ticket.ids.has(entry.id)
        && sameSession(pane, entry) && normalizedText(entry.text) === ticket.text);
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

  const syncQueueControls = () => {
    for (const pane of document.querySelectorAll?.("openclaw-chat-pane") || []) {
      void pruneDelivered(pane);
      const visible = queueFor(pane).filter((item) => sameSession(pane, item)
        && !["sending", "submitting"].includes(item?.sendState));
      const rows = pane.querySelectorAll?.(".chat-queue__item") || [];
      rows.forEach((row, index) => {
        const id = row.getAttribute?.("data-chat-queue-item");
        const item = id ? visible.find((entry) => entry.id === id)
          : rows.length === visible.length ? visible[index] : null;
        if (!item) return;
        row.dataset.pinkieQueueId = item.id;
        row.dataset.pinkieQueueLabel = item.kind === "steered" ? "确认追加中"
          : item.sendState === "unconfirmed" ? "送达待确认"
          : item.sendState === "failed" ? "发送失败" : "结束后发送";
        row.querySelector?.(".chat-queue__pinkie-defer")?.remove();
      });
    }
  };

  const start = () => {
    syncQueueControls();
    const root = document.querySelector("openclaw-app") || document.querySelector("openclaw-app-shell")
      || document.querySelector("#openclaw-mount-fallback") || document.body;
    if (!root || root.dataset.pinkieQueueSteerWatch === "1") return;
    root.dataset.pinkieQueueSteerWatch = "1";
    new MutationObserver(() => syncQueueControls()).observe(root, {
      childList: true, subtree: true,
    });
    // A durable receipt may arrive while the run remains active and the queue
    // DOM does not change. Prune only; this path never retries or sends.
    window.setInterval?.(syncQueueControls, 1000);
  };

  window.__laolaoQueueSteer = {
    steerQueued, makeQueuedAgain, restoreMissingQueuedItem, syncQueueControls,
    // Kept as a small diagnostic/test seam for bundle API drift. It never
    // sends directly; both functions resolve and call native queue actions.
    scheduleDefaultSteer, nativeQueueMethod, pruneDelivered,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once: true});
  else start();
})();
