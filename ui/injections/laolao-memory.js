(() => {
  "use strict";

  const modeLabels = {chat: "唠嗑模式", project: "项目模式", thinking: "想法模式", unrestricted: "无限制模式"};
  const kindLabels = {identity: "稳定身份", preference: "偏好", feedback: "纠正与默契", decision: "长期决策", fact: "稳定事实", reference: "参考位置"};
  let layer = null;
  let editorRecord = null;

  const sessionKey = () => document.querySelector("openclaw-app-shell")?.context?.gateway?.snapshot?.sessionKey ||
    new URLSearchParams(location.search).get("session") || "";
  const mode = () => document.documentElement.getAttribute("data-laolao-mode") || "chat";
  const request = (method, params, timeout) => {
    const gw = window.__laolaoSidebar?.gwRequest;
    if (typeof gw !== "function") return Promise.reject(new Error("网关连接尚未准备好"));
    return gw(method, params, timeout);
  };
  const node = (tag, className, text) => {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  };

  const setStatus = (text, error = false) => {
    const status = layer?.querySelector(".laolao-memory-status");
    if (!status) return;
    status.textContent = text;
    status.dataset.error = error ? "1" : "0";
  };

  const close = () => {
    layer?.remove();
    layer = null;
    editorRecord = null;
  };

  const form = () => layer?.querySelector(".laolao-memory-editor");
  const closeEditor = () => {
    const value = form();
    if (value) value.hidden = true;
    editorRecord = null;
  };

  const openEditor = (record = null) => {
    const value = form();
    if (!value) return;
    editorRecord = record;
    value.hidden = false;
    value.querySelector('[name="kind"]').value = record?.kind || "preference";
    value.querySelector('[name="key"]').value = record?.key || "";
    value.querySelector('[name="text"]').value = record?.text || "";
    value.querySelector('[name="tags"]').value = (record?.tags || []).join("，");
    value.querySelector('[name="pinned"]').checked = Boolean(record?.pinned);
    value.querySelector('[name="text"]').focus();
  };

  const renderRecords = records => {
    const list = layer?.querySelector(".laolao-memory-list");
    if (!list) return;
    list.replaceChildren();
    if (!records.length) {
      list.append(node("div", "laolao-memory-empty", "这个模式还没有长期记忆。重要偏好和稳定结论会留在这里。"));
      return;
    }
    for (const record of records) {
      const card = node("article", "laolao-memory-card");
      const meta = node("div", "laolao-memory-card__meta");
      meta.append(node("span", "laolao-memory-card__kind", kindLabels[record.kind] || record.kind));
      if (record.pinned) meta.append(node("span", "", "已置顶"));
      const text = node("p", "laolao-memory-card__text", record.text);
      const actions = node("div", "laolao-memory-card__actions");
      const edit = node("button", "", "编辑");
      edit.type = "button";
      edit.setAttribute("aria-label", "编辑这条记忆");
      edit.addEventListener("click", () => openEditor(record));
      const remove = node("button", "", "删除");
      remove.type = "button";
      remove.setAttribute("aria-label", "删除这条记忆");
      let armed = false;
      let resetTimer = 0;
      remove.addEventListener("click", async () => {
        if (!armed) {
          armed = true;
          remove.textContent = "确认";
          resetTimer = window.setTimeout(() => { armed = false; remove.textContent = "删除"; }, 3000);
          return;
        }
        window.clearTimeout(resetTimer);
        try {
          await request("pinkie.memory.forget", {sessionKey: sessionKey(), id: record.id});
          setStatus("已从当前模式删除");
          await load();
        } catch (error) { setStatus(error.message, true); }
      });
      actions.append(edit, remove);
      card.append(meta, text, actions);
      list.append(card);
    }
  };

  const load = async () => {
    if (!layer) return;
    const query = layer.querySelector(".laolao-memory-search")?.value || "";
    setStatus("正在读取当前模式…");
    try {
      const result = await request("pinkie.memory.list", {sessionKey: sessionKey(), query, limit: 300}, 16000);
      renderRecords(Array.isArray(result?.records) ? result.records : []);
      const projectNote = mode() === "project" ? " · 当前项目独立" : "";
      setStatus(`${result?.records?.length || 0} 条记忆${projectNote}`);
    } catch (error) {
      renderRecords([]);
      setStatus(error.message || "记忆读取失败", true);
    }
  };

  const save = async () => {
    const value = form();
    if (!value) return;
    const payload = {
      sessionKey: sessionKey(),
      id: editorRecord?.id,
      kind: value.querySelector('[name="kind"]').value,
      key: value.querySelector('[name="key"]').value,
      text: value.querySelector('[name="text"]').value,
      tags: value.querySelector('[name="tags"]').value.split(/[，,;；]/).map(item => item.trim()).filter(Boolean),
      pinned: value.querySelector('[name="pinned"]').checked,
    };
    if (editorRecord && !payload.key) payload.key = editorRecord.key;
    try {
      await request("pinkie.memory.remember", payload, 16000);
      closeEditor();
      setStatus("已保存到当前模式，不会同步到其他模式");
      await load();
    } catch (error) { setStatus(error.message || "保存失败", true); }
  };

  const showClearConfirm = () => {
    const confirm = layer?.querySelector(".laolao-memory-confirm");
    if (confirm) confirm.hidden = false;
  };

  const buildEditor = () => {
    const editor = node("section", "laolao-memory-editor");
    editor.hidden = true;
    const kind = node("select"); kind.name = "kind"; kind.setAttribute("aria-label", "记忆类型");
    for (const [value, label] of Object.entries(kindLabels)) {
      const option = node("option", "", label); option.value = value; kind.append(option);
    }
    const key = node("input"); key.name = "key"; key.placeholder = "稳定名称（可留空）"; key.setAttribute("aria-label", "稳定记忆名称");
    const text = node("textarea"); text.name = "text"; text.placeholder = "只写未来仍有价值的偏好、纠正、事实或决定"; text.setAttribute("aria-label", "记忆内容");
    const tagInput = node("input"); tagInput.name = "tags"; tagInput.placeholder = "标签，用逗号分开"; tagInput.setAttribute("aria-label", "记忆标签");
    const checks = node("label", "laolao-memory-editor__checks");
    const pinned = node("input"); pinned.type = "checkbox"; pinned.name = "pinned"; checks.append(pinned, document.createTextNode("重要记忆，优先参考"));
    const actions = node("div", "laolao-memory-editor__actions");
    const cancel = node("button", "laolao-memory-button", "取消"); cancel.type = "button"; cancel.addEventListener("click", closeEditor);
    const submit = node("button", "laolao-memory-button laolao-memory-button--primary", "保存记忆"); submit.type = "button"; submit.addEventListener("click", save);
    actions.append(cancel, submit);
    editor.append(kind, key, text, tagInput, checks, actions);
    return editor;
  };

  const open = () => {
    if (layer) return;
    layer = node("div", "laolao-memory-layer");
    layer.setAttribute("role", "presentation");
    const panel = node("section", "laolao-memory-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "当前模式的独立长期记忆");
    const head = node("header", "laolao-memory-head");
    const title = node("div", "laolao-memory-title");
    title.append(node("strong", "", `${modeLabels[mode()] || "当前模式"} · 记忆匣`), node("span", "", "物理独立保存，不会串到其他模式"));
    const closeButton = node("button", "laolao-memory-close", "×"); closeButton.type = "button"; closeButton.setAttribute("aria-label", "关闭记忆匣"); closeButton.addEventListener("click", close);
    head.append(title, closeButton);
    const toolbar = node("div", "laolao-memory-toolbar");
    const search = node("input", "laolao-memory-search"); search.type = "search"; search.placeholder = "搜索当前模式记忆"; search.setAttribute("aria-label", "搜索当前模式记忆");
    let searchTimer = 0;
    search.addEventListener("input", () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(load, 180); });
    const add = node("button", "laolao-memory-button laolao-memory-button--primary", "＋ 新增"); add.type = "button"; add.addEventListener("click", () => openEditor());
    toolbar.append(search, add);
    const list = node("main", "laolao-memory-list");
    const foot = node("footer", "laolao-memory-foot");
    const status = node("span", "laolao-memory-status", "正在读取当前模式…");
    const clear = node("button", "laolao-memory-button laolao-memory-button--danger", "清空当前范围"); clear.type = "button"; clear.addEventListener("click", showClearConfirm);
    const confirm = node("span", "laolao-memory-confirm"); confirm.hidden = true;
    const cancelClear = node("button", "laolao-memory-button", "取消"); cancelClear.type = "button"; cancelClear.addEventListener("click", () => { confirm.hidden = true; });
    const confirmClear = node("button", "laolao-memory-button laolao-memory-button--danger", "确认清空"); confirmClear.type = "button";
    confirmClear.addEventListener("click", async () => {
      try {
        const result = await request("pinkie.memory.clear", {sessionKey: sessionKey(), confirm: "CLEAR_CURRENT_MEMORY"}, 16000);
        confirm.hidden = true;
        setStatus(`已清空 ${result?.deleted || 0} 条，仅限当前范围`);
        await load();
      } catch (error) { setStatus(error.message || "清空失败", true); }
    });
    confirm.append(node("span", "", "不会影响其他模式"), cancelClear, confirmClear);
    foot.append(status, clear, confirm);
    panel.append(head, toolbar, buildEditor(), list, foot);
    layer.append(panel);
    layer.addEventListener("pointerdown", event => { if (event.target === layer) close(); });
    document.body.append(layer);
    void load();
  };

  const ensureEntry = () => {
    const host = document.querySelector(".sidebar-shell__footer .sidebar-footer-bar") || document.querySelector(".sidebar-shell__footer");
    if (!host || host.querySelector(":scope > .laolao-memory-entry")) return;
    const button = node("button", "laolao-memory-entry");
    button.type = "button";
    button.title = "当前模式的独立长期记忆";
    button.setAttribute("aria-label", "打开当前模式的独立长期记忆");
    button.addEventListener("click", open);
    host.append(button);
  };

  document.addEventListener("keydown", event => { if (event.key === "Escape" && layer) close(); });
  window.addEventListener("laolao:modechange", close);
  window.addEventListener("popstate", close);
  window.__clekkMemoryUI = {open, close};
  window.setInterval(ensureEntry, 1200);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensureEntry, {once: true});
  else ensureEntry();
})();
