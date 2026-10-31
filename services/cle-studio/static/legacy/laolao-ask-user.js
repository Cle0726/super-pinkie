/* laolao-ask-user：碧琪的主动提问卡。
   碧琪调用 ask_user 工具后，在输入框正上方弹出一张选项卡：2–4 个选项可直接点，
   也可以选“其他”自己写。点选后，答案经原生输入框作为一条普通消息发回去，
   原生的发送、排队、追加逻辑全部照旧。

   - 卡片挂在 body 上、按输入框位置定位，不碰 Lit 管理的聊天 DOM。
   - 实时：读 laolao-sidebar 广播的 pinkie:gateway-event（ask_user 工具结果）。
   - 刷新后：从 chat.history 里最后一个还没回答的 ask_user 工具结果还原。 */
(() => {
  "use strict";
  if (window.__laolaoAskUser) return;

  const MARKER = "[[PINKIE_ASK_V1]]";
  const ANSWER_PREFIX = "【回答碧琪的提问】";
  const STICKER = "/cle/static/art/avatar.webp?v=20261019";
  const STORE = "laolao:ask-user:closed:v1";
  const $ = (sel, root = document) => root.querySelector(sel);
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const sessionKey = () => {
    const selected = window.__laolaoSidebar?.currentSessionKey?.();
    if (selected) return selected;
    const routed = new URL(location.href).searchParams.get("session") || "";
    if (routed) return routed;
    const active = document.querySelector(".sidebar-recent-session--active[data-session-key]");
    return active?.dataset.sessionKey || "";
  };
  const request = (method, params, timeout = 15000) => {
    const gateway = window.__laolaoSidebar?.gwRequest;
    return typeof gateway === "function" ? gateway(method, params, timeout) : Promise.reject(new Error("网关未连接"));
  };

  // Questions already answered or put aside, per session; bounded.
  const closedIds = () => { try { return JSON.parse(localStorage.getItem(STORE) || "[]"); } catch { return []; } };
  const markClosed = (id) => {
    if (!id) return;
    try { localStorage.setItem(STORE, JSON.stringify([...closedIds().filter((x) => x !== id), id].slice(-200))); } catch {}
  };

  const parseRecord = (text) => {
    const value = String(text || "");
    const start = value.indexOf(MARKER);
    if (start < 0) return null;
    try {
      const record = JSON.parse(value.slice(start + MARKER.length).split("\n")[0]);
      return record && typeof record.question === "string" && Array.isArray(record.options) && record.options.length >= 2 ? record : null;
    } catch { return null; }
  };
  const resultText = (result) => {
    if (typeof result === "string") return result;
    const content = result?.content ?? result;
    if (Array.isArray(content)) return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n");
    return typeof content?.text === "string" ? content.text : "";
  };

  // ---------- the card ----------
  let card = null, current = null, positionTimer = 0;

  const composer = () => $(".chat-pane-cache__pane--active .agent-chat__input") || $(".chat-pane-cache__pane--active .agent-chat__composer-shell");
  function position() {
    if (!card) return;
    const anchor = composer();
    if (!anchor) { card.style.visibility = "hidden"; return; }
    const rect = anchor.getBoundingClientRect();
    card.style.visibility = "";
    card.style.left = `${Math.round(rect.left)}px`;
    card.style.width = `${Math.round(rect.width)}px`;
    card.style.bottom = `${Math.round(window.innerHeight - rect.top + 10)}px`;
  }

  function close(reason = "dismiss") {
    if (!card) return;
    const leaving = card; card = null;
    if (current?.id) markClosed(current.id);
    current = null;
    clearInterval(positionTimer);
    leaving.classList.add(reason === "answered" ? "is-answered" : "is-leaving");
    setTimeout(() => leaving.remove(), reduced() ? 0 : 420);
  }

  function sendThroughComposer(text) {
    const input = document.querySelector(".chat-pane-cache__pane--active .agent-chat__composer-combobox textarea") || document.querySelector(".agent-chat__input textarea");
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    const draft = input.value;
    input.focus();
    setter.call(input, text);
    input.dispatchEvent(new Event("input", {bubbles: true, composed: true}));
    setTimeout(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", code: "Enter", bubbles: true, composed: true}));
      // Put back whatever the user had been typing before answering.
      if (draft) setTimeout(() => { setter.call(input, draft); input.dispatchEvent(new Event("input", {bubbles: true, composed: true})); }, 260);
    }, 60);
    return true;
  }

  function submit(labels, other = "") {
    if (!current || (!labels.length && !other.trim())) return;
    const lines = [`${ANSWER_PREFIX}${current.question}`];
    if (labels.length) lines.push(`我的选择：${labels.join("、")}`);
    if (other.trim()) lines.push(`${labels.length ? "补充" : "我的想法"}：${other.trim()}`);
    if (!sendThroughComposer(lines.join("\n"))) {
      window.__laolaoToast?.("没找到输入框，答案没有发出去");
      return;
    }
    close("answered");
  }

  function show(record, {fromHistory = false} = {}) {
    if (!record || closedIds().includes(record.id)) return;
    if (current?.id === record.id) return;
    if (card) { card.remove(); card = null; }
    current = {...record, sessionKey: sessionKey()};
    const multi = record.multiSelect === true;
    card = el("section", "laolao-ask" + (fromHistory ? " is-restored" : ""));
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "碧琪的提问");

    const head = el("header", "laolao-ask__head");
    const face = el("img", "laolao-ask__face"); face.src = STICKER; face.alt = "";
    const who = el("span", "laolao-ask__who", "碧琪想问你");
    head.append(face, who);
    if (record.header) head.append(el("span", "laolao-ask__chip", record.header));
    const later = el("button", "laolao-ask__later", "稍后再说"); later.type = "button";
    later.addEventListener("click", () => close("dismiss"));
    head.append(later);

    const question = el("p", "laolao-ask__question", record.question);
    const list = el("div", "laolao-ask__options");
    const picked = new Set();
    const confirm = el("button", "laolao-ask__confirm", "发送选择"); confirm.type = "button";
    const refreshConfirm = () => { confirm.disabled = picked.size === 0 && !otherInput.value.trim(); confirm.textContent = picked.size ? `发送选择（${picked.size}）` : "发送选择"; };
    record.options.forEach((option, index) => {
      const button = el("button", "laolao-ask__option"); button.type = "button";
      button.style.setProperty("--i", index);
      const key = el("span", "laolao-ask__key", String(index + 1));
      const text = el("span", "laolao-ask__text");
      text.append(el("strong", "", option.label));
      if (option.description) text.append(el("small", "", option.description));
      button.append(key, text);
      if (multi) button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        if (!multi) { button.classList.add("is-picked"); setTimeout(() => submit([option.label]), reduced() ? 0 : 160); return; }
        picked.has(option.label) ? picked.delete(option.label) : picked.add(option.label);
        button.classList.toggle("is-picked", picked.has(option.label));
        button.setAttribute("aria-pressed", String(picked.has(option.label)));
        refreshConfirm();
      });
      list.append(button);
    });

    const otherRow = el("div", "laolao-ask__other");
    const otherInput = el("input", "laolao-ask__other-input");
    otherInput.type = "text"; otherInput.placeholder = "其他：写下你的想法…";
    otherInput.addEventListener("input", () => { if (multi) refreshConfirm(); else otherSend.disabled = !otherInput.value.trim(); });
    otherInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing && otherInput.value.trim()) { event.preventDefault(); submit(multi ? [...picked] : [], otherInput.value); }
      if (event.key === "Escape") close("dismiss");
    });
    const otherSend = el("button", "laolao-ask__other-send", "发送"); otherSend.type = "button"; otherSend.disabled = true;
    otherSend.addEventListener("click", () => submit([], otherInput.value));
    otherRow.append(otherInput);
    if (!multi) otherRow.append(otherSend);

    const foot = el("footer", "laolao-ask__foot");
    foot.append(el("span", "laolao-ask__hint", multi ? "可以多选 · Esc 稍后再说" : `按 1–${record.options.length} 直接选 · Esc 稍后再说`));
    if (multi) { confirm.disabled = true; confirm.addEventListener("click", () => submit([...picked], otherInput.value)); foot.append(confirm); }

    card.append(head, question, list, otherRow, foot);
    document.body.append(card);
    position();
    clearInterval(positionTimer);
    positionTimer = setInterval(position, 400);
  }

  // Number keys pick an option when the user is not typing somewhere else.
  document.addEventListener("keydown", (event) => {
    if (!card || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const typing = event.target?.closest?.("textarea, input, [contenteditable='true']");
    if (event.key === "Escape" && (!typing || card.contains(event.target))) { close("dismiss"); return; }
    if (typing) return;
    const index = Number(event.key) - 1;
    const button = card.querySelectorAll(".laolao-ask__option")[index];
    if (button) { event.preventDefault(); button.click(); }
  }, true);
  addEventListener("resize", position);

  // ---------- live: the ask_user tool result ----------
  window.addEventListener("pinkie:gateway-event", (event) => {
    const {event: name, payload} = event.detail || {};
    if (!payload || (payload.sessionKey && payload.sessionKey !== sessionKey())) return;
    if ((name === "agent" || name === "session.tool") && payload.stream === "tool") {
      const data = payload.data || {};
      if (data.name === "ask_user" && data.phase === "result" && data.isError !== true) {
        const record = parseRecord(resultText(data.result));
        if (record) show({...record, id: record.id || data.toolCallId || ""});
      }
      return;
    }
    // A real user message (typed or this card's answer) settles the question.
    if (name === "session.message" && card) {
      const message = payload.message || {};
      const text = typeof message.content === "string" ? message.content : "";
      if (message.role === "user" && text.replace(/[​-‍⁠⁣﻿]/g, "").trim()) close("dismiss");
    }
  });

  // ---------- after a reload or session switch: restore an open question ----------
  let restoring = "";
  async function restore() {
    const key = sessionKey();
    if (!key || restoring === key) return;
    restoring = key;
    if (card && current?.sessionKey !== key) close("switch");
    try {
      const history = await request("chat.history", {sessionKey: key, limit: 24});
      if (sessionKey() !== key) return;
      const messages = Array.isArray(history?.messages) ? history.messages : [];
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index] || {};
        if (message.role === "user") {
          const text = typeof message.content === "string" ? message.content
            : Array.isArray(message.content) ? message.content.map((part) => part?.text || "").join("") : "";
          if (text.replace(/[​-‍⁠⁣﻿]/g, "").trim()) return;   // already answered
          continue;
        }
        if (/^toolresult$/i.test(String(message.role || "")) && message.toolName === "ask_user") {
          const record = parseRecord(resultText(message));
          if (record) show({...record, id: record.id || message.toolCallId || ""}, {fromHistory: true});
          return;
        }
      }
    } catch {
      restoring = "";   // gateway not ready yet; try again on the next tick
    }
  }
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) { lastHref = location.href; restoring = ""; }
    void restore();
  }, 1500);
  window.addEventListener("pinkie:session-selected", () => { restoring = ""; void restore(); });

  window.__laolaoAskUser = {show, close, parseRecord, get current() { return current; }};
})();
