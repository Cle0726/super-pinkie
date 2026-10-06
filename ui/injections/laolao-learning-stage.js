(() => {
  "use strict";

  const START_MARKER = "[[CLEKK_LEARNING_START_V1]]";
  const ANSWER_MARKER = "[[CLEKK_LEARNING_ANSWER_V1]]";
  const NEXT_MARKER = "[[CLEKK_LEARNING_NEXT_V1]]";
  const BATCH_MARKER = "[[CLEKK_LEARNING_BATCH_V1]]";
  const ASSET = "./laolao-learning-question.png";
  const state = {
    sessionKey: "",
    revision: -1,
    remote: null,
    stage: null,
    toggle: null,
    notebookButton: null,
    drawer: null,
    selectionButton: null,
    selectionText: "",
    selectionLabel: "",
    polling: false,
    notes: [],
    noteData: null,
    notesSessionKey: "",
    selectedTags: new Set(),
    searchText: "",
    sortMode: "latest",
    listMode: "groups",
    groupVisibility: new Map(),
    includeMerged: false,
    sessionLabels: new Map(),
    sessionLabelsAt: 0,
    notesLoadId: 0,
    reviewQueue: null,
    reviewIndex: 0,
    reviewFlipped: false,
    organizationPlan: null,
    organizationBusy: false,
    organizationRequestId: "",
    organizationReminderDismissed: false,
    organizationSourceNotes: [],
    undoKind: "",
    undoValue: null,
    undoTimer: 0,
    undoNote: null,
    lastOrganizationBackupId: "",
    noteMenu: null,
  };

  const el = (tag, className, text) => {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  };

  const request = (method, params, timeout = 16000) => {
    const gateway = window.__laolaoSidebar?.gwRequest;
    if (typeof gateway !== "function") return Promise.reject(new Error("学习工作台正在连接，请稍后再试"));
    return gateway(method, params, timeout);
  };

  const pageSessionKey = () => {
    const routed = new URL(location.href).searchParams.get("session") || "";
    if (routed) return routed;
    const active = document.querySelector(".sidebar-recent-session--active[data-session-key]");
    return active?.dataset.sessionKey || document.querySelector("openclaw-app-shell")?.context?.gateway?.snapshot?.sessionKey || "";
  };

  const inLearningMode = () => {
    const mode = document.documentElement.getAttribute("data-laolao-mode");
    const key = pageSessionKey();
    return mode === "learning" || key.startsWith("agent:learning:");
  };

  const setBusy = (button, busy, label) => {
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle("is-busy", busy);
    if (label) button.textContent = label;
  };

  const showToast = (message, error = false) => {
    let toast = document.querySelector(".laolao-learning-toast");
    if (!toast) {
      toast = el("div", "laolao-learning-toast");
      toast.setAttribute("role", "status");
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.dataset.error = error ? "1" : "0";
    toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
  };

  const sendControl = async (message, sessionOverride = "") => {
    const sessionKey = sessionOverride || pageSessionKey();
    if (!sessionKey) throw new Error("没有找到当前学习会话");
    const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : `learning-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return request("chat.send", {sessionKey, message, idempotencyKey}, 30000);
  };

  const hideControlMessages = () => {
    const groups = Array.from(document.querySelectorAll(".chat-group.user")).slice(-8);
    for (const group of groups) {
      const text = group.textContent || "";
      // Older saved chats can still contain note controls sent before the independent drawer model.
      const internal = [START_MARKER, ANSWER_MARKER, NEXT_MARKER, BATCH_MARKER,
        "[[CLEKK_NOTE_LIGHT_V1]]", "[[CLEKK_NOTE_DEEP_V1]]"].some(marker => text.includes(marker));
      group.classList.toggle("laolao-learning-control-message", internal);
    }
  };

  const composer = () => document.querySelector(".agent-chat__composer-shell") || document.querySelector(".agent-chat__input");

  const ensureStage = () => {
    if (state.stage?.isConnected) return state.stage;
    const anchor = composer();
    if (!anchor?.parentElement) return null;
    state.stage?.remove();
    const stage = el("section", "laolao-learning-stage");
    stage.setAttribute("aria-live", "polite");
    stage.hidden = true;
    anchor.parentElement.insertBefore(stage, anchor);
    state.stage = stage;
    return stage;
  };

  const statusLine = (root, text, error = false) => {
    let node = root.querySelector(".laolao-learning-stage__status");
    if (!node) {
      node = el("div", "laolao-learning-stage__status");
      root.append(node);
    }
    node.textContent = text;
    node.dataset.error = error ? "1" : "0";
  };

  const selectedAnswer = stage => {
    const current = state.remote?.current;
    if (!current) return "";
    if (current.kind === "multiple_choice") {
      return Array.from(stage.querySelectorAll('input[name="learning-answer"]:checked')).map(input => input.value);
    }
    if (current.kind === "single_choice") return stage.querySelector('input[name="learning-answer"]:checked')?.value || "";
    return stage.querySelector(".laolao-learning-stage__answer")?.value.trim() || "";
  };

  const submitAnswer = async button => {
    const current = state.remote?.current;
    const stage = state.stage;
    if (!current || !stage) return;
    const answer = selectedAnswer(stage);
    if ((!Array.isArray(answer) && !answer) || (Array.isArray(answer) && !answer.length)) {
      statusLine(stage, "先选一个答案，碧琪才知道从哪里讲起呀。", true);
      return;
    }
    const confidence = Number(stage.querySelector(".laolao-learning-stage__confidence")?.value || 50);
    setBusy(button, true, "正在判断…");
    try {
      const result = await request("pinkie.learning.submit", {
        sessionKey: pageSessionKey(),
        activityId: current.id,
        answer,
        confidence,
        submissionId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      });
      state.remote = result;
      state.revision = Number(result?.revision) || state.revision;
      renderStage(result);
      const serverCheck = result?.current?.submission?.correctness;
      await sendControl(`${ANSWER_MARKER}\nactivity_id: ${current.id}\nanswer: ${JSON.stringify(answer)}\nconfidence: ${confidence}\nserver_check: ${serverCheck === true ? "correct" : serverCheck === false ? "incorrect" : "needs_model"}\n请调用 learning_activity resolve，给出简短口语化反馈，再决定是否继续下一题。`);
    } catch (error) {
      statusLine(stage, error.message || "答案没有送出去，请再试一次", true);
      setBusy(button, false, "提交答案");
    }
  };

  const saveCurrentKeyPoint = async button => {
    const current = state.remote?.current;
    const content = current?.result?.keyPoint || current?.result?.explanation || current?.question;
    if (!content) return;
    setBusy(button, true, "保存中…");
    try {
      await request("pinkie.learning.notes.save", {
        sessionKey: pageSessionKey(),
        title: current.topic || "本题知识点",
        content,
        tags: current.topic ? [current.topic] : [],
        sourceLabel: "互动题卡",
        sourceSessionLabel: state.sessionLabels.get(pageSessionKey()) || "",
      });
      setBusy(button, false, "已记下");
      showToast("已放进学习笔记，不会随聊天压缩丢失");
      if (state.drawer?.classList.contains("is-open")) await loadNotes();
    } catch (error) {
      setBusy(button, false, "记入笔记");
      showToast(error.message || "笔记保存失败", true);
    }
  };

  const nextQuestion = async button => {
    setBusy(button, true, "准备中…");
    try {
      await sendControl(`${NEXT_MARKER}\n请根据刚才的表现与当前学习主题，调用 learning_activity present 给一题难度合适的变式题。一次只出一题。`);
      statusLine(state.stage, "碧琪正在按刚才的表现准备下一题…");
    } catch (error) {
      statusLine(state.stage, error.message || "下一题暂时没有送出去", true);
      setBusy(button, false, "下一题");
    }
  };

  const stopActiveInteractionRun = async sessionKey => {
    // First the server-side learning fence is written by toggleInteraction.
    // Then cancel any queued recovery and the reply which may still be about to
    // call learning_activity. The native stop button is only a compatibility
    // fallback for older gateways without chat.abort.
    const results = await Promise.allSettled([
      request("pinkie.watchdog.cancel", {sessionKey}, 8000),
      request("chat.abort", {sessionKey, preserveSideRuns: false}, 12000),
    ]);
    if (results[1]?.status === "fulfilled") return;
    const nativeStop = document.querySelector(".chat-send-btn--stop");
    if (nativeStop && !nativeStop.disabled) nativeStop.click();
  };

  const optionNode = (current, option) => {
    const label = el("label", "laolao-learning-option");
    const input = el("input");
    input.type = current.kind === "multiple_choice" ? "checkbox" : "radio";
    input.name = "learning-answer";
    input.value = option.id;
    const badge = el("span", "laolao-learning-option__badge", option.id);
    const text = el("span", "laolao-learning-option__text", option.label);
    label.append(input, badge, text);
    return label;
  };

  const renderStage = remote => {
    const stage = ensureStage();
    if (!stage) return;
    const current = remote?.current;
    stage.hidden = !remote?.enabled;
    stage.classList.toggle("is-resolved", current?.phase === "explained" || current?.phase === "complete");
    stage.replaceChildren();
    if (!remote?.enabled) return;

    const art = el("img", "laolao-learning-stage__art");
    art.src = ASSET;
    art.alt = "碧琪拿着学习笔记本";
    art.decoding = "async";
    art.draggable = false;
    const body = el("div", "laolao-learning-stage__body");
    const eyebrow = el("div", "laolao-learning-stage__eyebrow", current?.topic || "碧琪互动学习");
    body.append(eyebrow);

    if (!current) {
      body.append(el("h3", "laolao-learning-stage__question", "想先练哪一个知识点？"));
      body.append(el("p", "laolao-learning-stage__lead", "直接继续聊天也可以；需要练习时，碧琪会把当前内容变成一张可作答的题卡。"));
      const actions = el("div", "laolao-learning-stage__actions");
      const begin = el("button", "laolao-learning-button laolao-learning-button--primary", "从当前内容出一题");
      begin.type = "button";
      begin.addEventListener("click", async () => {
        setBusy(begin, true, "准备中…");
        try { await sendControl(`${START_MARKER}\n请从当前对话选择最值得巩固的知识点，调用 learning_activity present 出一道互动题；上下文不足时先用一句话问我要练什么。`); }
        catch (error) { setBusy(begin, false, "从当前内容出一题"); statusLine(stage, error.message, true); }
      });
      actions.append(begin);
      body.append(actions);
      stage.append(body, art);
      return;
    }

    body.append(el("h3", "laolao-learning-stage__question", current.question));
    if (current.phase === "asking") {
      const answers = el("div", "laolao-learning-stage__answers");
      if (current.kind === "single_choice" || current.kind === "multiple_choice") {
        for (const option of current.options || []) answers.append(optionNode(current, option));
      } else {
        const input = el("textarea", "laolao-learning-stage__answer");
        input.rows = current.kind === "short_answer" ? 3 : 2;
        input.placeholder = current.kind === "fill_blank" ? "把答案填在这里…" : "用自己的话答，短一点也没关系…";
        input.setAttribute("aria-label", "你的答案");
        answers.append(input);
      }
      body.append(answers);
      if (current.hint) {
        const details = el("details", "laolao-learning-stage__hint");
        details.append(el("summary", "", "给一点提示"), el("p", "", current.hint));
        body.append(details);
      }
      const confidence = el("label", "laolao-learning-stage__confidence-row");
      confidence.append(document.createTextNode("把握 "));
      const range = el("input", "laolao-learning-stage__confidence");
      range.type = "range"; range.min = "0"; range.max = "100"; range.value = "60";
      const value = el("span", "", "60%");
      range.addEventListener("input", () => { value.textContent = `${range.value}%`; });
      confidence.append(range, value);
      const actions = el("div", "laolao-learning-stage__actions");
      const submit = el("button", "laolao-learning-button laolao-learning-button--primary", "提交答案");
      submit.type = "button";
      submit.addEventListener("click", () => submitAnswer(submit));
      actions.append(confidence, submit);
      body.append(actions);
    } else if (current.phase === "evaluating") {
      const immediate = current.submission?.correctness;
      body.append(el("div", `laolao-learning-result ${immediate === true ? "is-correct" : immediate === false ? "is-incorrect" : ""}`, immediate === true ? "答对啦，碧琪正在把关键原因讲清楚…" : immediate === false ? "这次没选对，但错因马上就能弄明白…" : "碧琪正在看你的思路…"));
    } else {
      const result = current.result || {};
      const verdict = result.correct === true ? "答对啦！" : result.correct === false ? "差一点，正好抓住这个坑。" : "这题已经讲清楚啦。";
      body.append(el("div", `laolao-learning-result ${result.correct === true ? "is-correct" : result.correct === false ? "is-incorrect" : ""}`, verdict));
      if (result.feedback) body.append(el("p", "laolao-learning-result__feedback", result.feedback));
      if (result.explanation) body.append(el("p", "laolao-learning-result__explanation", result.explanation));
      if (result.keyPoint) {
        const point = el("div", "laolao-learning-keypoint");
        point.append(el("strong", "", "这一句记住："), document.createTextNode(result.keyPoint));
        body.append(point);
      }
      const actions = el("div", "laolao-learning-stage__actions");
      const note = el("button", "laolao-learning-button", "记入笔记");
      const next = el("button", "laolao-learning-button laolao-learning-button--primary", "下一题");
      note.type = next.type = "button";
      note.addEventListener("click", () => saveCurrentKeyPoint(note));
      next.addEventListener("click", () => nextQuestion(next));
      actions.append(note, next);
      body.append(actions);
    }
    stage.append(body, art);
  };

  const toggleInteraction = async button => {
    const enabled = !(state.remote?.enabled ?? state.toggle?.getAttribute("aria-pressed") === "true");
    const sessionKey = pageSessionKey();
    setBusy(button, true, enabled ? "开启中…" : "关闭中…");
    try {
      const result = await request("pinkie.learning.set", {sessionKey, enabled});
      state.remote = result;
      state.revision = Number(result?.revision) || 0;
      renderStage(result);
      syncButtons();
      if (!enabled) {
        await stopActiveInteractionRun(sessionKey);
        showToast("互动学习已停止，当前题卡和出题请求已取消");
      } else if (!result.current) {
        await sendControl(`${START_MARKER}\n请从当前对话选择最值得巩固的知识点，调用 learning_activity present 出一道互动题；上下文不足时先用一句话问我要练什么。`);
      }
    } catch (error) {
      showToast(error.message || "互动学习切换失败", true);
      syncButtons();
    }
  };

  const syncButtons = () => {
    const enabled = Boolean(state.remote?.enabled);
    if (state.toggle) {
      state.toggle.classList.toggle("is-active", enabled);
      state.toggle.setAttribute("aria-pressed", String(enabled));
      state.toggle.textContent = enabled ? "互动中" : "互动学习";
      state.toggle.disabled = false;
    }
  };

  const ensureButtons = () => {
    const actions = document.querySelector(".agent-chat__composer-actions");
    if (!actions) return;
    if (!state.toggle?.isConnected) {
      const button = el("button", "laolao-learning-toggle", "互动学习");
      button.type = "button";
      button.title = "开启可直接作答的沉浸题卡；普通聊天不受影响";
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => toggleInteraction(button));
      actions.prepend(button);
      state.toggle = button;
    }
    if (!state.notebookButton?.isConnected) {
      const button = el("button", "laolao-learning-notebook-button", "笔记");
      button.type = "button";
      button.title = "打开学习笔记本";
      button.addEventListener("click", openNotebook);
      actions.prepend(button);
      state.notebookButton = button;
    }
    syncButtons();
  };

  const normalizedNoteText = value => String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const noteOriginal = note => String(note?.original ?? note?.content ?? "");
  const currentSession = () => pageSessionKey();
  const notebookSession = () => "agent:learning:notes-library";
  const currentTags = () => [...state.selectedTags];

  const loadSessionLabels = async () => {
    if (Date.now() - state.sessionLabelsAt < 45_000) return;
    state.sessionLabelsAt = Date.now();
    try {
      const result = await request("sessions.list", {agentId: "learning", limit: 1000}, 10000);
      const rows = Array.isArray(result) ? result : result?.sessions || result?.items || [];
      const labels = new Map();
      for (const row of rows) {
        const key = row?.key || row?.sessionKey || row?.id;
        if (key) labels.set(String(key), String(row.label || row.displayName || row.title || row.name || String(key).split(":").at(-1).slice(0, 8)));
      }
      state.sessionLabels = labels;
    } catch { /* Session titles are a convenience; show a short session id if unavailable. */ }
  };

  const showUndoBar = (message, kind, value, timeout = 0) => {
    const bar = state.drawer?.querySelector(".laolao-learning-notes__undo");
    if (!bar) return;
    clearTimeout(state.undoTimer);
    state.undoKind = kind;
    state.undoValue = value;
    bar.replaceChildren();
    bar.append(el("span", "", message));
    const undo = el("button", "", "撤销");
    undo.type = "button";
    undo.addEventListener("click", async () => {
      undo.disabled = true;
      try {
        if (state.undoKind === "delete") {
          await request("pinkie.learning.notes.restore", {sessionKey: notebookSession(), note: state.undoValue});
          showToast("已恢复这条笔记");
        } else if (state.undoKind === "organize") {
          await request("pinkie.learning.notes.organize.undo", {sessionKey: notebookSession(), backupId: state.undoValue});
          state.lastOrganizationBackupId = "";
          showToast("已恢复整理前的笔记");
        }
        bar.hidden = true;
        state.undoKind = ""; state.undoValue = null;
        await loadNotes();
      } catch (error) { undo.disabled = false; showToast(error.message || "撤销失败", true); }
    });
    bar.append(undo);
    bar.hidden = false;
    if (timeout) state.undoTimer = setTimeout(() => {
      if (state.undoKind === kind && state.undoValue === value) {
        bar.hidden = true; state.undoKind = ""; state.undoValue = null;
      }
    }, timeout);
  };

  const addNoteSource = (card, note) => {
    const sourceKey = String(note.sourceSessionKey || "");
    const shortKey = sourceKey.split(":").at(-1)?.slice(0, 8) || "未知会话";
    const session = note.sourceSessionLabel || state.sessionLabels.get(sourceKey) || (sourceKey === notebookSession() ? "笔记本" : `来源会话 ${shortKey}`);
    const dateValue = Number(note.createdAt || note.updatedAt) || 0;
    const date = dateValue ? new Intl.DateTimeFormat("zh-CN", {month: "numeric", day: "numeric"}).format(new Date(dateValue)) : "日期未知";
    const source = el("div", "laolao-learning-note__source", `${session} · ${date}${note.sourceLabel ? ` · ${note.sourceLabel}` : ""}`);
    source.title = sourceKey;
    card.append(source);
  };

  const renderCompareCard = (body, note) => {
    const items = Array.isArray(note.compareItems) ? note.compareItems : [];
    const grid = el("div", "laolao-learning-note__compare");
    for (const item of items) {
      const cell = el("div", "laolao-learning-note__compare-item");
      cell.append(el("strong", "", item.term || "词条"), el("span", "", item.meaning || ""));
      grid.append(cell);
    }
    body.append(grid);
    if (note.differencePoints || note.meaning) body.append(el("p", "laolao-learning-note__difference", note.differencePoints || note.meaning));
  };

  // An open "⋯" menu is lifted out of its card into the drawer's own layer. Left inside the card it
  // shares the list's stacking order: a hovered card (transform) traps it below the next sticky group
  // header and the cards after it, and the scrolling list clips it. In the drawer layer it paints
  // above every header and card, and flips upward when the visible list has no room below.
  const closeNoteMenu = ({restoreFocus = false} = {}) => {
    const open = state.noteMenu;
    if (!open) return;
    state.noteMenu = null;
    const {card, home, more, menu} = open;
    menu.hidden = true;
    menu.classList.remove("is-floating");
    menu.style.removeProperty("top"); menu.style.removeProperty("left");
    delete menu.dataset.placement;
    card.classList.remove("has-open-menu");
    more.setAttribute("aria-expanded", "false");
    if (home.isConnected) home.append(menu); else menu.remove();
    if (restoreFocus && more.isConnected) more.focus();
  };

  const placeNoteMenu = () => {
    const open = state.noteMenu;
    if (!open) return;
    const drawer = state.drawer;
    const scroller = drawer?.querySelector(".laolao-learning-notes__content");
    if (!drawer?.classList.contains("is-open") || !open.more.isConnected || !scroller) return closeNoteMenu();
    const frame = drawer.getBoundingClientRect();
    const visible = scroller.getBoundingClientRect();
    const anchor = open.more.getBoundingClientRect();
    if (anchor.bottom <= visible.top || anchor.top >= visible.bottom) return closeNoteMenu();
    const {menu} = open;
    const gap = 4, edge = 8;
    const width = menu.offsetWidth, height = menu.offsetHeight;
    const below = visible.bottom - edge - anchor.bottom - gap;
    const above = anchor.top - gap - visible.top - edge;
    const upward = height > below && above > below;
    const top = Math.max(visible.top + edge, Math.min(upward ? anchor.top - gap - height : anchor.bottom + gap, visible.bottom - edge - height));
    const left = Math.max(frame.left + edge, Math.min(anchor.right - width, frame.right - edge - width));
    menu.dataset.placement = upward ? "above" : "below";
    menu.style.top = `${Math.round(top - frame.top - drawer.clientTop)}px`;
    menu.style.left = `${Math.round(left - frame.left - drawer.clientLeft)}px`;
  };

  const openNoteMenu = (card, home, more, menu) => {
    closeNoteMenu();
    if (!state.drawer?.isConnected) return;
    state.noteMenu = {card, home, more, menu};
    menu.classList.add("is-floating");
    menu.hidden = false;
    state.drawer.append(menu);
    card.classList.add("has-open-menu");
    more.setAttribute("aria-expanded", "true");
    placeNoteMenu();
  };

  const beginEdit = (card, note) => {
    closeNoteMenu();
    const form = el("form", "laolao-learning-note__edit");
    const title = el("input"); title.value = note.title || ""; title.placeholder = "标题"; title.setAttribute("aria-label", "笔记标题");
    const content = el("textarea"); content.rows = 4; content.value = note.content || ""; content.setAttribute("aria-label", "笔记正文");
    const tags = el("input"); tags.value = (note.tags || []).join(", "); tags.placeholder = "标签，用逗号分隔"; tags.setAttribute("aria-label", "笔记标签");
    const actions = el("div", "laolao-learning-note__edit-actions");
    const save = el("button", "laolao-learning-button laolao-learning-button--primary", "保存修改"); save.type = "submit";
    const cancel = el("button", "laolao-learning-button", "取消"); cancel.type = "button";
    cancel.addEventListener("click", () => loadNotes());
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!content.value.trim()) return content.focus();
      setBusy(save, true, "保存中…");
      try {
        await request("pinkie.learning.notes.update", {
          sessionKey: notebookSession(), id: note.id, title: title.value, content: content.value,
          tags: tags.value.split(/[,，]/).map(value => value.trim()).filter(Boolean),
        });
        showToast("笔记已更新"); await loadNotes();
      } catch (error) { setBusy(save, false, "保存修改"); showToast(error.message || "修改失败", true); }
    });
    actions.append(save, cancel); form.append(title, content, tags, actions);
    card.replaceChildren(form);
    title.focus();
  };

  const startSingleNoteQuiz = async note => {
    try {
      if (!state.remote?.enabled) {
        state.remote = await request("pinkie.learning.set", {sessionKey: currentSession(), enabled: true});
        state.revision = Number(state.remote?.revision) || state.revision;
      }
      closeNotebook();
      const questionNote = {id: note.id, term: note.term || note.title || "", meaning: note.meaning || "", example: note.example || "", content: note.content || ""};
      await request("pinkie.learning.notes.quiz.prepare", {sessionKey: currentSession(), ids: [note.id]});
      await sendControl(`${START_MARKER}\n请围绕这条笔记调用 learning_activity present 出一道理解题，并将 note_ids 设为 JSON 中的 id。笔记：${JSON.stringify(questionNote)}`);
    } catch (error) { showToast(error.message || "出题失败", true); }
  };

  const deleteNoteWithUndo = async note => {
    try {
      const result = await request("pinkie.learning.notes.delete", {sessionKey: notebookSession(), id: note.id});
      showUndoBar("已删除", "delete", result.note, 5000);
      await loadNotes();
    } catch (error) { showToast(error.message || "删除失败", true); }
  };

  const noteSuggestion = (note, similar) => {
    const pair = similar.find(item => item.ids.includes(note.id));
    if (!pair) return null;
    const suggestion = el("div", "laolao-learning-note__suggestion");
    suggestion.append(el("span", "", pair.type === "merge" ? "发现相同词条 · 可合并" : "发现相近表达 · 可做成对比卡"));
    const preview = el("button", "", "整理预览"); preview.type = "button";
    preview.addEventListener("click", () => requestDeepOrganization());
    suggestion.append(preview);
    return suggestion;
  };

  const renderNoteCard = (note, similar) => {
    const card = el("article", `laolao-learning-note${note.kind === "compare" ? " is-compare" : ""}`);
    card.tabIndex = 0;
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", `编辑笔记：${note.title || note.term || "知识点"}`);
    card.addEventListener("click", event => {
      const control = event.target.closest("button, input, textarea, form, details, a");
      if (control && card.contains(control)) return;
      beginEdit(card, note);
    });
    card.addEventListener("keydown", event => {
      if ((event.key === "Enter" || event.key === " ") && event.target === card) { event.preventDefault(); beginEdit(card, note); }
    });
    const titleText = String(note.title || "").trim();
    const content = String(note.content || "").trim();
    const sameOrPrefix = titleText && content && (normalizedNoteText(titleText) === normalizedNoteText(content)
      || normalizedNoteText(content).startsWith(normalizedNoteText(titleText)));
    if (note.kind === "compare") {
      card.append(el("h3", "", titleText || "易混对比"));
      const body = el("div", "laolao-learning-note__body"); renderCompareCard(body, note); card.append(body);
    } else if (note.term && note.meaning && (/\s=\s/.test(content) || note.lightOrganizedAt)) {
      const body = el("div", "laolao-learning-note__term-row");
      body.append(el("strong", "", note.term), el("span", "", note.meaning));
      card.append(body);
      if (note.example) card.append(el("div", "laolao-learning-note__example", note.example));
      if (note.note) card.append(el("p", "laolao-learning-note__extra", note.note));
      if (note.supplementalMeaning) card.append(el("p", "laolao-learning-note__supplement", note.supplementalMeaning));
    } else {
      const exactTitleDuplicate = sameOrPrefix && normalizedNoteText(content) === normalizedNoteText(titleText);
      if (!sameOrPrefix || exactTitleDuplicate) card.append(el("h3", "", titleText || content || "知识点"));
      const remaining = sameOrPrefix && !exactTitleDuplicate
        ? content.slice(titleText.length).replace(/^\s*(?:\r?\n|[：:-])\s*/, "") : (sameOrPrefix ? "" : content);
      if (remaining) card.append(el("p", "", remaining));
      if (note.supplementalMeaning) card.append(el("p", "laolao-learning-note__supplement", note.supplementalMeaning));
    }
    const similarity = noteSuggestion(note, similar); if (similarity) card.append(similarity);
    if (note.compareCardId) card.append(el("div", "laolao-learning-note__linked", "已关联对比卡"));
    if (note.suggestedFix) card.append(el("div", "laolao-learning-note__fix", `可核对${note.suggestedFix.field === "example" ? "例句" : "释义"}：${note.suggestedFix.suggestion}`));
    if (note.tags?.length) {
      const tags = el("div", "laolao-learning-note__tags");
      for (const tag of note.tags) tags.append(el("span", "", tag));
      card.append(tags);
    }
    const reviewed = note.lastReviewedAt ? new Date(note.lastReviewedAt).toLocaleDateString("zh-CN", {month: "numeric", day: "numeric"}) : "从未复习";
    card.append(el("div", "laolao-learning-note__review-meta", `复习 ${note.reviewCount || 0} 次 · 最近 ${reviewed}${note.lapses ? ` · 错 ${note.lapses} 次` : ""}`));
    addNoteSource(card, note);
    const actionBar = el("div", "laolao-learning-note__menu-wrap");
    const more = el("button", "laolao-learning-note__more", "⋯"); more.type = "button"; more.setAttribute("aria-label", "更多笔记操作"); more.setAttribute("aria-expanded", "false");
    const menu = el("div", "laolao-learning-note__menu"); menu.hidden = true;
    const items = [
      ["复制", async () => { try { await navigator.clipboard.writeText(note.content || noteOriginal(note)); showToast("已复制"); } catch { showToast("系统没有允许复制，请手动选择文字", true); } }],
      ["编辑", () => beginEdit(card, note)],
      ["整理这条", () => organizeSingleNote(note)],
      ["用它出题", () => startSingleNoteQuiz(note)],
      ["删除", () => deleteNoteWithUndo(note)],
    ];
    for (const [label, action] of items) {
      const item = el("button", "", label); item.type = "button";
      if (label === "整理这条") {
        item.dataset.notesOrganize = "1";
        item.disabled = state.organizationBusy || !state.noteData?.organizer?.available;
      }
      item.addEventListener("click", event => { event.stopPropagation(); closeNoteMenu(); action(); });
      menu.append(item);
    }
    more.addEventListener("click", event => {
      event.stopPropagation();
      if (state.noteMenu?.menu === menu) closeNoteMenu(); else openNoteMenu(card, actionBar, more, menu);
    });
    actionBar.append(more, menu); card.append(actionBar);
    return card;
  };

  const renderReview = list => {
    closeNoteMenu();
    const queue = state.reviewQueue || [];
    const note = queue[state.reviewIndex];
    if (!note) {
      const done = el("section", "laolao-learning-review laolao-learning-review--done");
      done.append(el("div", "laolao-learning-review__eyebrow", "今日复习完成"), el("h3", "", "太棒啦，这一轮都复习完了！"));
      const leave = el("button", "laolao-learning-button laolao-learning-button--primary", "回到笔记"); leave.type = "button"; leave.addEventListener("click", () => { state.reviewQueue = null; renderNotes(state.notes, state.noteData?.similar || []); });
      done.append(leave); list.replaceChildren(done); return;
    }
    const panel = el("section", "laolao-learning-review");
    panel.append(el("div", "laolao-learning-review__eyebrow", `复习 ${state.reviewIndex + 1} / ${queue.length}`));
    const front = el("div", "laolao-learning-review__front");
    if (note.kind === "compare") {
      front.append(el("p", "", "想一想：下面这些表达分别怎么用，有什么区别？"));
      const terms = (note.compareItems || []).map(item => item.term).join("　·　");
      front.append(el("strong", "", terms || note.term || note.title));
    } else front.append(el("strong", "", note.term || note.title || note.content));
    panel.append(front);
    if (state.reviewFlipped) {
      const back = el("div", "laolao-learning-review__back");
      if (note.kind === "compare") renderCompareCard(back, note);
      else {
        back.append(el("p", "", note.meaning || note.content || ""));
        if (note.example) back.append(el("small", "", note.example));
        if (note.note) back.append(el("p", "", note.note));
      }
      panel.append(back);
      const grades = el("div", "laolao-learning-review__grades");
      for (const [rating, label] of [["remembered", "记得"], ["fuzzy", "模糊"], ["forgot", "忘了"]]) {
        const button = el("button", `laolao-learning-button${rating === "remembered" ? " laolao-learning-button--primary" : ""}`, label); button.type = "button";
        button.addEventListener("click", async () => {
          setBusy(button, true, "记录中…");
          try {
            const result = await request("pinkie.learning.notes.review", {sessionKey: notebookSession(), id: note.id, rating});
            state.notes = state.notes.map(item => item.id === note.id ? result.note : item);
            state.reviewQueue.splice(state.reviewIndex, 1);
            state.reviewFlipped = false;
            await loadNotes();
          } catch (error) { setBusy(button, false, label); showToast(error.message || "复习记录失败", true); }
        });
        grades.append(button);
      }
      panel.append(grades);
    } else {
      const flip = el("button", "laolao-learning-button laolao-learning-button--primary", "翻面看释义"); flip.type = "button";
      flip.addEventListener("click", () => { state.reviewFlipped = true; renderReview(list); }); panel.append(flip);
    }
    const exit = el("button", "laolao-learning-review__exit", "结束复习"); exit.type = "button";
    exit.addEventListener("click", () => { state.reviewQueue = null; state.reviewFlipped = false; renderNotes(state.notes, state.noteData?.similar || []); });
    panel.append(exit); list.replaceChildren(panel);
  };

  const startReview = async () => {
    try {
      const result = await request("pinkie.learning.notes.list", {sessionKey: notebookSession(), limit: 500});
      state.reviewQueue = (result.notes || []).filter(note => !Number(note.nextReviewAt) || Number(note.nextReviewAt) <= Date.now());
      state.reviewIndex = 0; state.reviewFlipped = false;
      renderReview(state.drawer?.querySelector(".laolao-learning-notes__list"));
    } catch (error) { showToast(error.message || "复习列表读取失败", true); }
  };

  const renderOrganizationPreview = plan => {
    const host = state.drawer?.querySelector(".laolao-learning-notes__preview");
    if (!host) return;
    host.replaceChildren();
    if (!plan) { host.hidden = true; return; }
    host.hidden = false;
    const panel = el("section", "laolao-learning-organize-preview");
    const header = el("header", "laolao-learning-organize-preview__header");
    header.append(el("strong", "", "整理预览"));
    const close = el("button", "", "×"); close.type = "button"; close.setAttribute("aria-label", "关闭整理预览"); close.addEventListener("click", () => { state.organizationPlan = null; renderOrganizationPreview(null); });
    header.append(close); panel.append(header);
    const byType = new Map([["merge", "合并重复"], ["compare", "易混对比"], ["group", "主题归类"], ["fix", "释义与例句核对"]]);
    const checked = [];
    const sourceNotes = state.organizationSourceNotes || [];
    const map = new Map(sourceNotes.map(note => [note.id, note]));
    for (const [type, title] of byType) {
      const operations = (plan.operations || []).filter(item => item.type === type);
      if (!operations.length) continue;
      const section = el("section", "laolao-learning-organize-preview__section"); section.append(el("h4", "", `${title} · ${operations.length}`));
      for (const operation of operations) {
        const item = el("label", "laolao-learning-organize-preview__item");
        const checkbox = el("input"); checkbox.type = "checkbox"; checkbox.checked = true; checkbox.value = operation.id; checked.push(checkbox);
        const detail = el("div", "");
        const before = (operation.ids || [operation.noteId]).map(id => map.get(id)).filter(Boolean);
        if (type === "merge") {
          detail.append(el("strong", "", `合并 ${before.map(note => note.term || note.title).join(" + ")}`));
          detail.append(el("p", "", `改后：${operation.term || operation.title || map.get(operation.keepId)?.term || "保留原词条"}${operation.meaning ? ` = ${operation.meaning}` : ""}`));
        } else if (type === "compare") {
          detail.append(el("strong", "", operation.title || before.map(note => note.term || note.title).join(" / ")));
          detail.append(el("p", "", `改前：${before.map(note => `${note.term || note.title} = ${note.meaning || note.content}`).join("；")}`));
          detail.append(el("p", "", `改后：${(operation.items || []).map(item => `${item.term} = ${item.meaning}`).join("；") || operation.differencePoints || "建立易混对比卡"}`));
        } else if (type === "group") {
          detail.append(el("strong", "", `归入「${operation.topic}」`));
          detail.append(el("p", "", before.map(note => note.term || note.title).join("、")));
        } else {
          detail.append(el("strong", "", `${map.get(operation.noteId)?.term || map.get(operation.noteId)?.title || "笔记"} · ${operation.field}`));
          detail.append(el("p", "", `建议：${operation.suggestion}（只标注，不替换原文）`));
        }
        detail.append(el("small", "", `理由：${operation.reason}`));
        item.append(checkbox, detail); section.append(item);
      }
      panel.append(section);
    }
    if (plan.discarded?.length) {
      const discarded = el("div", "laolao-learning-organize-preview__discarded");
      discarded.append(el("strong", "", `已忽略 ${plan.discarded.length} 项无效操作`));
      for (const item of plan.discarded) discarded.append(el("p", "", `${item.type}：${item.reason}`));
      panel.append(discarded);
    }
    if (!plan.operations?.length) panel.append(el("p", "laolao-learning-notes__empty", "碧琪没有找到可以执行的整理建议。原笔记保持不变。"));
    const actions = el("div", "laolao-learning-organize-preview__actions");
    const apply = el("button", "laolao-learning-button laolao-learning-button--primary", "应用所选"); apply.type = "button"; apply.disabled = !checked.length;
    apply.addEventListener("click", async () => {
      const ids = checked.filter(input => input.checked).map(input => input.value);
      if (!ids.length) return showToast("请至少选择一项整理", true);
      setBusy(apply, true, "备份并应用…");
      try {
        const result = await request("pinkie.learning.notes.organize.apply", {sessionKey: notebookSession(), requestId: plan.id, operationIds: ids}, 20000);
        state.lastOrganizationBackupId = result.backupId;
        state.organizationPlan = null; renderOrganizationPreview(null);
        showUndoBar("整理已应用", "organize", result.backupId);
        await loadNotes();
      } catch (error) { setBusy(apply, false, "应用所选"); showToast(error.message || "整理应用失败", true); }
    });
    const cancel = el("button", "laolao-learning-button", "取消"); cancel.type = "button";
    cancel.addEventListener("click", () => { state.organizationPlan = null; renderOrganizationPreview(null); });
    actions.append(apply, cancel); panel.append(actions); host.append(panel);
  };

  const requestDeepOrganization = async () => {
    if (state.organizationBusy) return;
    const sessionKey = notebookSession();
    const requestId = crypto.randomUUID ? crypto.randomUUID() : `organize-${Date.now()}`;
    state.organizationRequestId = requestId;
    state.organizationBusy = true;
    renderOrganizer(state.noteData?.organizer);
    const status = state.drawer?.querySelector(".laolao-learning-notes__status");
    if (status) status.textContent = "整理助手正在检查笔记…";
    try {
      const result = await request("pinkie.learning.notes.list", {sessionKey, limit: 500});
      if (notebookSession() !== sessionKey || state.organizationRequestId !== requestId) return;
      state.organizationSourceNotes = (result.notes || []).filter(note => note.status !== "merged");
      const plan = await request("pinkie.learning.notes.organize.preview", {sessionKey, requestId}, 50000);
      if (notebookSession() !== sessionKey || state.organizationRequestId !== requestId) return;
      state.organizationPlan = plan; renderOrganizationPreview(plan);
      if (status) status.textContent = `${plan.operations?.length || 0} 项待确认 · 未选中的不生效`;
    } catch (error) {
      if (notebookSession() !== sessionKey || state.organizationRequestId !== requestId) return;
      if (status) status.textContent = error.message || "整理失败 · 笔记保持原样";
      showToast(error.message || "整理失败，笔记保持原样", true);
    } finally {
      if (state.organizationRequestId === requestId) {
        state.organizationBusy = false; state.organizationRequestId = ""; renderOrganizer(state.noteData?.organizer);
      }
    }
  };

  const renderOrganizer = data => {
    const select = state.drawer?.querySelector(".laolao-learning-notes__model");
    const hint = state.drawer?.querySelector(".laolao-learning-notes__model-hint");
    if (!select) return;
    const signature = JSON.stringify(data || {});
    if (select.dataset.catalog !== signature) {
      select.replaceChildren();
      const fallback = el("option", "", data?.defaultModelName ? `默认 · ${data.defaultModelName}` : "暂无可用模型"); fallback.value = "";
      select.append(fallback);
      for (const model of data?.models || []) {
        const option = el("option", "", model.name); option.value = model.id; select.append(option);
      }
      select.value = data?.selectedModel || ""; select.dataset.catalog = signature;
    }
    select.disabled = !(data?.models?.length);
    if (hint) hint.textContent = data?.available ? "仅手动整理 · 不占用聊天" : "模型不可用 · 保存照常";
    for (const button of state.drawer.querySelectorAll("[data-notes-organize]")) {
      button.disabled = state.organizationBusy || !data?.available;
    }
  };

  const renderTagFilters = tags => {
    const host = state.drawer?.querySelector(".laolao-learning-notes__tag-filters");
    if (!host) return;
    host.replaceChildren();
    if (!tags?.length) { host.hidden = true; return; }
    host.hidden = false;
    for (const tag of tags) {
      const button = el("button", `laolao-learning-note-tag${state.selectedTags.has(tag) ? " is-selected" : ""}`, tag);
      button.type = "button"; button.setAttribute("aria-pressed", String(state.selectedTags.has(tag)));
      button.addEventListener("click", () => {
        if (state.selectedTags.has(tag)) state.selectedTags.delete(tag); else state.selectedTags.add(tag);
        loadNotes();
      }); host.append(button);
    }
  };

  const renderNotes = (notes, similar = []) => {
    const list = state.drawer?.querySelector(".laolao-learning-notes__list");
    if (!list) return;
    closeNoteMenu();
    list.replaceChildren();
    if (state.reviewQueue) { renderReview(list); return; }
    if (!notes.length) {
      const empty = el("div", "laolao-learning-notes__empty");
      empty.append(el("strong", "", state.searchText || state.selectedTags.size ? "没有找到这条笔记" : "留下一条值得记住的内容"));
      empty.append(el("p", "", state.searchText || state.selectedTags.size
        ? "试试更短的关键词，或取消一个标签。"
        : "选中聊天里的知识点，或点上面的“新笔记”。"));
      list.append(empty);
      return;
    }
    const sorted = [...notes].sort((a, b) => {
      if (state.sortMode === "least-reviewed") return (Number(a.lastReviewedAt) || 0) - (Number(b.lastReviewedAt) || 0) || (Number(a.reviewCount) || 0) - (Number(b.reviewCount) || 0);
      if (state.sortMode === "most-mistakes") return (Number(b.lapses) || 0) - (Number(a.lapses) || 0) || (Number(b.reviewCount) || 0) - (Number(a.reviewCount) || 0);
      return (Number(b.updatedAt || b.createdAt) || 0) - (Number(a.updatedAt || a.createdAt) || 0);
    });
    if (state.listMode === "time") {
      for (const note of sorted) list.append(renderNoteCard(note, similar));
      return;
    }
    const groups = new Map();
    for (const note of sorted) {
      const key = note.topic || note.tags?.[0] || "未分类";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(note);
    }
    [...groups].forEach(([topic, items], index) => {
      const group = el("details", "laolao-learning-note-group");
      group.open = state.groupVisibility.has(topic) ? state.groupVisibility.get(topic) : index === 0;
      group.addEventListener("toggle", () => state.groupVisibility.set(topic, group.open));
      const summary = el("summary", "", `${topic} · ${items.length} 条`); group.append(summary);
      const cards = el("div", "laolao-learning-note-group__cards");
      for (const note of items) cards.append(renderNoteCard(note, similar));
      group.append(cards); list.append(group);
    });
  };

  const renderOrganizationReminder = count => {
    const banner = state.drawer?.querySelector(".laolao-learning-notes__organize-reminder");
    if (!banner) return;
    const key = `pinkie:notes:organize-dismissed:${notebookSession()}`;
    let dismissedAtCount = 0;
    try { dismissedAtCount = Number(localStorage.getItem(key)) || 0; } catch {}
    banner.hidden = count < 10 || dismissedAtCount >= count;
  };

  const loadNotes = async () => {
    const sessionKey = notebookSession();
    if (state.notesSessionKey !== sessionKey) {
      state.notesSessionKey = sessionKey;
      state.selectedTags.clear(); state.searchText = ""; state.includeMerged = false;
      state.reviewQueue = null; state.reviewFlipped = false; state.organizationPlan = null;
      state.organizationBusy = false; state.organizationRequestId = "";
      state.groupVisibility = new Map();
      const search = state.drawer?.querySelector(".laolao-learning-notes__search"); if (search) search.value = "";
      renderOrganizationPreview(null);
    }
    const requestId = ++state.notesLoadId;
    const status = state.drawer?.querySelector(".laolao-learning-notes__status");
    if (status) status.textContent = "正在读取…";
    void loadSessionLabels();
    try {
      const result = await request("pinkie.learning.notes.list", {
        sessionKey, query: state.searchText, tags: currentTags(),
        includeMerged: state.includeMerged, limit: 500,
      });
      if (requestId !== state.notesLoadId) return;
      state.noteData = result; state.notes = Array.isArray(result?.notes) ? result.notes : [];
      renderOrganizer(result?.organizer);
      const due = Number(result?.dueCount) || 0;
      const dueButton = state.drawer?.querySelector(".laolao-learning-notes__due");
      if (dueButton) { dueButton.textContent = `今天要复习 ${due} 条`; dueButton.disabled = due === 0; }
      const batch = state.drawer?.querySelector(".laolao-learning-notes__batch");
      if (batch) { batch.textContent = `一起出题（${due}）`; batch.disabled = due === 0; }
      const reviewBar = state.drawer?.querySelector(".laolao-learning-notes__review-bar");
      if (reviewBar) reviewBar.hidden = due === 0;
      const merged = state.drawer?.querySelector(".laolao-learning-notes__merged");
      if (merged) { merged.textContent = state.includeMerged ? "隐藏已合并" : "已合并"; merged.setAttribute("aria-pressed", String(state.includeMerged)); }
      renderTagFilters(result?.availableTags || []);
      renderNotes(state.notes, result?.similar || []);
      renderOrganizationReminder(Number(result?.unorganizedCount) || 0);
      if (status) status.textContent = `${state.notes.length} 条 · 独立保存，删除聊天不影响笔记`;
      void loadSessionLabels().then(() => {
        if (state.drawer?.classList.contains("is-open") && state.notesSessionKey === sessionKey) renderNotes(state.notes, state.noteData?.similar || []);
      });
    } catch (error) {
      if (status) status.textContent = error.message || "读取失败";
    }
  };

  const organizeSingleNote = async note => {
    if (state.organizationBusy) return;
    const sessionKey = notebookSession();
    const requestId = crypto.randomUUID ? crypto.randomUUID() : `note-${Date.now()}-${Math.random()}`;
    state.organizationBusy = true; state.organizationRequestId = requestId;
    renderOrganizer(state.noteData?.organizer);
    showToast("正在整理这条笔记…");
    try {
      const result = await request("pinkie.learning.notes.organize.light", {sessionKey, id: note.id}, 50000);
      if (notebookSession() !== sessionKey || state.organizationRequestId !== requestId) return;
      showToast(result.skipped ? result.reason || "这次整理已跳过" : "这条笔记已整理");
      if (state.drawer?.classList.contains("is-open")) await loadNotes();
    } catch (error) {
      if (notebookSession() === sessionKey && state.organizationRequestId === requestId) showToast(error.message || "整理失败，笔记保持原样", true);
    } finally {
      if (state.organizationRequestId === requestId) {
        state.organizationBusy = false; state.organizationRequestId = ""; renderOrganizer(state.noteData?.organizer);
      }
    }
  };

  const enterBatchQuiz = async () => {
    try {
      const result = await request("pinkie.learning.notes.list", {sessionKey: notebookSession(), limit: 500});
      const due = (result.notes || []).filter(note => !Number(note.nextReviewAt) || Number(note.nextReviewAt) <= Date.now());
      if (!due.length) return showToast("今天没有到期笔记");
      if (!state.remote?.enabled) {
        state.remote = await request("pinkie.learning.set", {sessionKey: currentSession(), enabled: true});
        state.revision = Number(state.remote?.revision) || state.revision;
      }
      closeNotebook();
      const payload = due.map(note => ({
        id: note.id, term: note.term || note.title || "", meaning: note.meaning || "",
        example: note.example || "", note: note.note || "", content: (note.content || "").slice(0, 1400),
        kind: note.kind || "note", compareItems: note.compareItems || [],
      }));
      await request("pinkie.learning.notes.quiz.prepare", {sessionKey: currentSession(), ids: payload.map(note => note.id)});
      await sendControl(`${BATCH_MARKER}\nnote_ids: ${JSON.stringify(payload.map(note => note.id))}\n请把这些到期笔记一次编成一组练习，尽量每条都覆盖到，再用 learning_activity present 展示多小题题卡。笔记：${JSON.stringify(payload)}`);
    } catch (error) { showToast(error.message || "批量出题失败", true); }
  };

  const exportAnkiCsv = async () => {
    let notes = state.notes;
    try {
      const result = await request("pinkie.learning.notes.list", {sessionKey: notebookSession(), limit: 500});
      notes = result.notes || [];
    } catch (error) { return showToast(error.message || "导出失败", true); }
    const cells = [
      ["Front", "Back", "Example", "Tags", "Source", "Date"],
      ...notes.map(note => [
        note.term || note.title || note.content,
        note.kind === "compare" ? (note.compareItems || []).map(item => `${item.term}: ${item.meaning}`).join(" | ") : note.meaning || note.content,
        note.example || "",
        [...(note.tags || []), note.topic || ""].filter(Boolean).join(" "),
        note.sourceLabel || note.sourceSessionKey || "",
        note.createdAt ? new Date(note.createdAt).toISOString().slice(0, 10) : "",
      ]),
    ];
    const csv = "\ufeff" + cells.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
    const link = el("a"); link.href = url; link.download = "碧琪学习笔记-Anki.csv"; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };

  const revealMarkdown = () => {
    const file = state.noteData?.markdownPath;
    const reveal = window.__laolaoSidebar?.revealProject;
    if (!file || typeof reveal !== "function") return showToast("暂时无法打开 Finder", true);
    reveal(file);
  };

  const closeNotebook = () => {
    closeNoteMenu();
    state.drawer?.classList.remove("is-open");
    state.drawer?.setAttribute("aria-hidden", "true");
    if (state.drawer) state.drawer.inert = true;
  };

  function openNotebook() {
    let drawer = state.drawer;
    if (!drawer?.isConnected) {
      drawer = el("aside", "laolao-learning-notes");
      drawer.setAttribute("aria-label", "学习笔记本");
      drawer.setAttribute("aria-hidden", "true");
      drawer.inert = true;
      const header = el("header", "laolao-learning-notes__header");
      header.append(el("div", "laolao-learning-notes__title", "碧琪学习笔记"));
      const close = el("button", "", "×"); close.type = "button"; close.setAttribute("aria-label", "关闭笔记本"); close.addEventListener("click", closeNotebook); header.append(close);
      const contentWrap = el("div", "laolao-learning-notes__content");
      const reviewBar = el("div", "laolao-learning-notes__review-bar");
      reviewBar.hidden = true;
      const due = el("button", "laolao-learning-notes__due", "今天要复习 0 条"); due.type = "button"; due.disabled = true; due.addEventListener("click", startReview);
      const batch = el("button", "laolao-learning-notes__batch", "一起出题（0）"); batch.type = "button"; batch.disabled = true; batch.addEventListener("click", enterBatchQuiz);
      reviewBar.append(due, batch);

      const topActions = el("div", "laolao-learning-notes__top-actions");
      const newButton = el("button", "laolao-learning-button laolao-learning-button--primary", "＋ 新笔记"); newButton.type = "button";
      const organize = el("button", "laolao-learning-button", "一键整理"); organize.type = "button"; organize.addEventListener("click", requestDeepOrganization);
      organize.dataset.notesOrganize = "1";
      const markdown = el("button", "laolao-learning-notes__icon-action", "Markdown"); markdown.type = "button"; markdown.addEventListener("click", revealMarkdown);
      const anki = el("button", "laolao-learning-notes__icon-action", "Anki CSV"); anki.type = "button"; anki.addEventListener("click", exportAnkiCsv);
      const tools = el("details", "laolao-learning-notes__tools");
      tools.append(el("summary", "", "更多 ···"));
      const toolPanel = el("div", "laolao-learning-notes__tools-panel");
      const exports = el("div", "laolao-learning-notes__exports");
      exports.append(el("span", "", "导出笔记"), markdown, anki);
      toolPanel.append(exports);
      tools.append(toolPanel);
      topActions.append(newButton, organize, tools);

      const modelRow = el("div", "laolao-learning-notes__model-row");
      const modelLabel = el("label", "", "整理模型");
      const model = el("select", "laolao-learning-notes__model"); model.setAttribute("aria-label", "笔记整理模型");
      const modelHint = el("small", "laolao-learning-notes__model-hint", "仅手动整理 · 不占用聊天");
      modelLabel.append(model); modelRow.append(modelLabel, modelHint);
      toolPanel.append(modelRow);
      for (const button of [markdown, anki]) button.addEventListener("click", () => { tools.open = false; });
      model.addEventListener("change", async () => {
        const sessionKey = notebookSession(); const previous = state.noteData?.organizer;
        model.disabled = true;
        try {
          const data = await request("pinkie.learning.notes.organizer.setModel", {sessionKey, model: model.value});
          if (notebookSession() !== sessionKey) return;
          if (state.noteData) state.noteData.organizer = data;
          renderOrganizer(data);
        } catch (error) {
          if (notebookSession() !== sessionKey) return;
          model.value = previous?.selectedModel || ""; renderOrganizer(previous); showToast(error.message || "模型选择失败", true);
        }
      });

      const compose = el("form", "laolao-learning-notes__compose"); compose.hidden = true;
      const title = el("input"); title.placeholder = "标题（可不填）"; title.setAttribute("aria-label", "笔记标题");
      const noteBody = el("textarea"); noteBody.rows = 4; noteBody.placeholder = "写下值得以后复习的知识点…"; noteBody.setAttribute("aria-label", "笔记内容");
      const noteTags = el("input"); noteTags.placeholder = "标签（可不填，用逗号分隔）"; noteTags.setAttribute("aria-label", "笔记标签");
      const saveRow = el("div", "laolao-learning-notes__compose-actions");
      const save = el("button", "laolao-learning-button laolao-learning-button--primary", "保存笔记"); save.type = "submit";
      const cancelCompose = el("button", "laolao-learning-button", "收起"); cancelCompose.type = "button"; cancelCompose.addEventListener("click", () => { compose.hidden = true; newButton.setAttribute("aria-expanded", "false"); });
      saveRow.append(save, cancelCompose); compose.append(title, noteBody, noteTags, saveRow);
      compose.addEventListener("submit", async event => {
        event.preventDefault();
        if (!noteBody.value.trim()) return noteBody.focus();
        const sessionKey = currentSession();
        setBusy(save, true, "保存中…");
        try {
          await request("pinkie.learning.notes.save", {
            sessionKey, title: title.value, content: noteBody.value,
            tags: noteTags.value.split(/[,，]/).map(value => value.trim()).filter(Boolean), sourceLabel: "手写笔记",
            sourceSessionLabel: state.sessionLabels.get(sessionKey) || "",
          });
          title.value = ""; noteBody.value = ""; noteTags.value = ""; compose.hidden = true; newButton.setAttribute("aria-expanded", "false");
          setBusy(save, false, "保存笔记"); await loadNotes();
        } catch (error) { setBusy(save, false, "保存笔记"); showToast(error.message || "保存失败", true); }
      });
      newButton.setAttribute("aria-expanded", "false");
      newButton.addEventListener("click", () => {
        compose.hidden = !compose.hidden; newButton.setAttribute("aria-expanded", String(!compose.hidden));
        if (!compose.hidden) title.focus();
      });

      const reminder = el("div", "laolao-learning-notes__organize-reminder"); reminder.hidden = true;
      reminder.append(el("span", "", "有 10 条以上笔记还没做主题整理"));
      const remindOrganize = el("button", "", "现在整理"); remindOrganize.type = "button"; remindOrganize.addEventListener("click", requestDeepOrganization);
      remindOrganize.dataset.notesOrganize = "1";
      const remindDismiss = el("button", "", "×"); remindDismiss.type = "button"; remindDismiss.setAttribute("aria-label", "关闭整理提示");
      remindDismiss.addEventListener("click", () => {
        const key = `pinkie:notes:organize-dismissed:${notebookSession()}`;
        try { localStorage.setItem(key, String(state.noteData?.unorganizedCount || 10)); } catch {}
        reminder.hidden = true;
      }); reminder.append(remindOrganize, remindDismiss);

      const searchRow = el("div", "laolao-learning-notes__search-row");
      const search = el("input", "laolao-learning-notes__search"); search.type = "search"; search.placeholder = "搜索词条、释义和笔记…"; search.setAttribute("aria-label", "搜索学习笔记");
      let searchTimer = 0;
      search.addEventListener("input", () => {
        state.searchText = search.value.trim(); clearTimeout(searchTimer); searchTimer = setTimeout(loadNotes, 220);
      });
      const merged = el("button", "laolao-learning-notes__merged", "已合并"); merged.type = "button"; merged.addEventListener("click", () => { state.includeMerged = !state.includeMerged; loadNotes(); });
      searchRow.append(search, merged);
      const tags = el("div", "laolao-learning-notes__tag-filters"); tags.hidden = true;

      const filters = el("div", "laolao-learning-notes__filters");
      const sort = el("select", "laolao-learning-notes__sort"); sort.setAttribute("aria-label", "笔记排序");
      for (const [value, label] of [["latest", "最新"], ["least-reviewed", "最久没复习"], ["most-mistakes", "最常记错"]]) {
        const option = el("option", "", label); option.value = value; sort.append(option);
      }
      sort.value = state.sortMode;
      sort.addEventListener("change", () => { state.sortMode = sort.value; renderNotes(state.notes, state.noteData?.similar || []); });
      const view = el("div", "laolao-learning-notes__view-toggle");
      for (const [mode, label] of [["groups", "按主题"], ["time", "按时间"]]) {
        const button = el("button", `laolao-learning-notes__view${state.listMode === mode ? " is-selected" : ""}`, label); button.type = "button";
        button.addEventListener("click", () => {
          state.listMode = mode;
          for (const item of view.querySelectorAll("button")) item.classList.toggle("is-selected", item === button);
          renderNotes(state.notes, state.noteData?.similar || []);
        }); view.append(button);
      }
      filters.append(sort, view);

      const status = el("div", "laolao-learning-notes__status");
      const preview = el("div", "laolao-learning-notes__preview"); preview.hidden = true;
      const list = el("div", "laolao-learning-notes__list");
      const undo = el("div", "laolao-learning-notes__undo"); undo.hidden = true;
      contentWrap.append(topActions, reviewBar, compose, reminder, searchRow, tags, filters, status, preview, list, undo);
      drawer.append(header, contentWrap);
      contentWrap.addEventListener("scroll", placeNoteMenu, {passive: true});
      drawer.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        event.preventDefault(); event.stopPropagation();
        if (state.noteMenu) closeNoteMenu({restoreFocus: true});
        else if (tools.open) tools.open = false;
        else closeNotebook();
      });
      drawer.addEventListener("click", event => { if (!event.target.closest?.(".laolao-learning-notes__tools")) tools.open = false; });
      document.body.append(drawer);
      state.drawer = drawer;
    }
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    drawer.inert = false;
    loadNotes();
  }

  const saveSelection = async () => {
    const text = state.selectionText;
    state.selectionButton?.remove(); state.selectionButton = null;
    if (!text) return;
    try {
      await request("pinkie.learning.notes.save", {sessionKey: pageSessionKey(), content: text, sourceLabel: state.selectionLabel || "聊天摘录", sourceSessionLabel: state.sessionLabels.get(pageSessionKey()) || ""});
      showToast("已记进学习笔记");
      if (state.drawer?.classList.contains("is-open")) await loadNotes();
    } catch (error) { showToast(error.message || "笔记保存失败", true); }
  };

  const selectionCandidate = () => {
    if (!inLearningMode()) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text || text.length < 2 || text.length > 20000 || selection.rangeCount === 0) return;
    const anchor = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
    const assistant = anchor?.closest?.(".chat-group.assistant");
    if (!assistant) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    state.selectionButton?.remove();
    const button = el("button", "laolao-learning-selection-save", "记笔记");
    button.type = "button";
    button.style.left = `${Math.max(8, Math.min(window.innerWidth - 88, rect.left + rect.width / 2 - 38))}px`;
    button.style.top = `${Math.max(8, rect.top - 42)}px`;
    state.selectionText = text;
    state.selectionLabel = assistant.querySelector(".chat-sender-name")?.textContent?.trim() || "碧琪回答";
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", saveSelection);
    document.body.append(button);
    state.selectionButton = button;
  };

  const poll = async () => {
    if (state.polling || !inLearningMode()) return;
    const sessionKey = pageSessionKey();
    if (!sessionKey) return;
    state.polling = true;
    try {
      const result = await request("pinkie.learning.current", {sessionKey}, 8000);
      if (state.drawer?.classList.contains("is-open") && state.notesSessionKey !== notebookSession()) void loadNotes();
      if (state.sessionKey !== sessionKey || state.revision !== Number(result?.revision)) {
        state.sessionKey = sessionKey;
        state.revision = Number(result?.revision) || 0;
        state.remote = result;
        renderStage(result);
      }
      syncButtons();
    } catch {
      // 网关启动或重连期间保持现有题卡，下一轮自动恢复，不闪空白。
    } finally { state.polling = false; }
  };

  const leaveLearningMode = () => {
    state.stage?.remove(); state.stage = null;
    state.toggle?.remove(); state.toggle = null;
    state.notebookButton?.remove(); state.notebookButton = null;
    closeNotebook();
    state.selectionButton?.remove(); state.selectionButton = null;
    state.sessionKey = ""; state.revision = -1; state.remote = null;
  };

  const reconcile = () => {
    if (!inLearningMode()) return leaveLearningMode();
    ensureButtons();
    if (state.remote?.enabled && !state.stage?.isConnected) renderStage(state.remote);
    hideControlMessages();
    poll();
  };

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      state.sessionKey = ""; state.revision = -1; state.remote = null;
      state.stage?.remove(); state.stage = null;
    }
    reconcile();
  }, 1200);
  window.addEventListener("pinkie:session-selected", reconcile);
  window.addEventListener("laolao:modechange", reconcile);
  window.addEventListener("laolao:sessions-changed", () => { if (state.drawer?.classList.contains("is-open")) void loadNotes(); });
  document.addEventListener("mouseup", () => setTimeout(selectionCandidate, 0), true);
  document.addEventListener("mousedown", event => {
    if (state.selectionButton && !event.target.closest(".laolao-learning-selection-save")) {
      state.selectionButton.remove(); state.selectionButton = null;
    }
    if (state.noteMenu && !event.target.closest?.(".laolao-learning-note__menu, .laolao-learning-note__more")) closeNoteMenu();
  }, true);
  window.addEventListener("resize", placeNoteMenu);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", reconcile, {once: true});
  else reconcile();
})();
