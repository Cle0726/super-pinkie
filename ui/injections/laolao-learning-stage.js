(() => {
  "use strict";

  const START_MARKER = "[[CLEKK_LEARNING_START_V1]]";
  const ANSWER_MARKER = "[[CLEKK_LEARNING_ANSWER_V1]]";
  const NEXT_MARKER = "[[CLEKK_LEARNING_NEXT_V1]]";
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

  const sendControl = async message => {
    const sessionKey = pageSessionKey();
    if (!sessionKey) throw new Error("没有找到当前学习会话");
    const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : `learning-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return request("chat.send", {sessionKey, message, idempotencyKey}, 30000);
  };

  const hideControlMessages = () => {
    const groups = Array.from(document.querySelectorAll(".chat-group.user")).slice(-8);
    for (const group of groups) {
      const text = group.textContent || "";
      const internal = text.includes(START_MARKER) || text.includes(ANSWER_MARKER) || text.includes(NEXT_MARKER);
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
    const enabled = !Boolean(state.remote?.enabled);
    setBusy(button, true, enabled ? "开启中…" : "关闭中…");
    try {
      const result = await request("pinkie.learning.set", {sessionKey: pageSessionKey(), enabled});
      state.remote = result;
      state.revision = Number(result?.revision) || 0;
      renderStage(result);
      syncButtons();
      if (enabled && !result.current) await sendControl(`${START_MARKER}\n请从当前对话选择最值得巩固的知识点，调用 learning_activity present 出一道互动题；上下文不足时先用一句话问我要练什么。`);
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

  const renderNotes = notes => {
    const list = state.drawer?.querySelector(".laolao-learning-notes__list");
    if (!list) return;
    list.replaceChildren();
    if (!notes.length) {
      list.append(el("div", "laolao-learning-notes__empty", "还没有笔记。选中聊天里的知识点，点“记笔记”就会放到这里。"));
      return;
    }
    for (const note of notes) {
      const card = el("article", "laolao-learning-note");
      card.append(el("h3", "", note.title || "知识点"), el("p", "", note.content));
      const actions = el("div", "laolao-learning-note__actions");
      const copy = el("button", "", "复制");
      const quiz = el("button", "", "用它出题");
      const remove = el("button", "", "删除");
      copy.type = quiz.type = remove.type = "button";
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(note.content); showToast("已复制"); }
        catch { showToast("系统没有允许复制，请手动选择文字", true); }
      });
      quiz.addEventListener("click", async () => {
        try {
          if (!state.remote?.enabled) await request("pinkie.learning.set", {sessionKey: pageSessionKey(), enabled: true});
          closeNotebook();
          await sendControl(`${START_MARKER}\n请围绕下面这条学习笔记调用 learning_activity present 出一道理解题。\n${note.content}`);
        } catch (error) { showToast(error.message || "出题失败", true); }
      });
      remove.addEventListener("click", async () => {
        if (remove.dataset.confirm !== "1") {
          remove.dataset.confirm = "1"; remove.textContent = "确认删除";
          setTimeout(() => { if (remove.isConnected) { remove.dataset.confirm = "0"; remove.textContent = "删除"; } }, 3000);
          return;
        }
        try { await request("pinkie.learning.notes.delete", {sessionKey: pageSessionKey(), id: note.id}); await loadNotes(); }
        catch (error) { showToast(error.message || "删除失败", true); }
      });
      actions.append(copy, quiz, remove);
      card.append(actions);
      list.append(card);
    }
  };

  const loadNotes = async () => {
    const status = state.drawer?.querySelector(".laolao-learning-notes__status");
    if (status) status.textContent = "正在读取…";
    try {
      const result = await request("pinkie.learning.notes.list", {sessionKey: pageSessionKey(), limit: 300});
      renderNotes(Array.isArray(result?.notes) ? result.notes : []);
      if (status) status.textContent = `${result?.notes?.length || 0} 条 · 已独立保存`;
    } catch (error) {
      if (status) status.textContent = error.message || "读取失败";
    }
  };

  const closeNotebook = () => {
    state.drawer?.classList.remove("is-open");
    state.drawer?.setAttribute("aria-hidden", "true");
  };

  function openNotebook() {
    let drawer = state.drawer;
    if (!drawer?.isConnected) {
      drawer = el("aside", "laolao-learning-notes");
      drawer.setAttribute("aria-label", "学习笔记本");
      drawer.setAttribute("aria-hidden", "true");
      const header = el("header", "laolao-learning-notes__header");
      header.append(el("div", "", "碧琪学习笔记"));
      const close = el("button", "", "×"); close.type = "button"; close.setAttribute("aria-label", "关闭笔记本"); close.addEventListener("click", closeNotebook); header.append(close);
      const compose = el("div", "laolao-learning-notes__compose");
      const title = el("input"); title.placeholder = "标题（可不填）"; title.setAttribute("aria-label", "笔记标题");
      const content = el("textarea"); content.rows = 4; content.placeholder = "写下值得以后复习的知识点…"; content.setAttribute("aria-label", "笔记内容");
      const save = el("button", "laolao-learning-button laolao-learning-button--primary", "保存笔记"); save.type = "button";
      save.addEventListener("click", async () => {
        if (!content.value.trim()) return content.focus();
        setBusy(save, true, "保存中…");
        try {
          await request("pinkie.learning.notes.save", {sessionKey: pageSessionKey(), title: title.value, content: content.value, sourceLabel: "手写笔记"});
          title.value = ""; content.value = ""; setBusy(save, false, "保存笔记"); await loadNotes();
        } catch (error) { setBusy(save, false, "保存笔记"); showToast(error.message || "保存失败", true); }
      });
      compose.append(title, content, save);
      drawer.append(header, compose, el("div", "laolao-learning-notes__status"), el("div", "laolao-learning-notes__list"));
      document.body.append(drawer);
      state.drawer = drawer;
    }
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    loadNotes();
  }

  const saveSelection = async () => {
    const text = state.selectionText;
    state.selectionButton?.remove(); state.selectionButton = null;
    if (!text) return;
    try {
      await request("pinkie.learning.notes.save", {sessionKey: pageSessionKey(), content: text, sourceLabel: state.selectionLabel || "聊天摘录"});
      showToast("已记进学习笔记");
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
  document.addEventListener("mouseup", () => setTimeout(selectionCandidate, 0), true);
  document.addEventListener("mousedown", event => {
    if (state.selectionButton && !event.target.closest(".laolao-learning-selection-save")) {
      state.selectionButton.remove(); state.selectionButton = null;
    }
  }, true);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", reconcile, {once: true});
  else reconcile();
})();
