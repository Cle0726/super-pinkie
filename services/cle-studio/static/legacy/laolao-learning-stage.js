// Ported for the C.le. native host.
(() => {
  "use strict";

  const START_MARKER = "[[CLEKK_LEARNING_START_V1]]";
  const ANSWER_MARKER = "[[CLEKK_LEARNING_ANSWER_V1]]";
  const NEXT_MARKER = "[[CLEKK_LEARNING_NEXT_V1]]";
  const BATCH_MARKER = "[[CLEKK_LEARNING_BATCH_V1]]";
  const ASSET = "";

  // One controller per learning pane. 双模式 shows two panes at once; a single module-level
  // state made the second pane steal the first pane's buttons, stage and session. Each
  // controller owns its state, its DOM and its session key, and is disposed when its pane goes.
  const instances = new Set();

  // ---- panes ---------------------------------------------------------------
  // 双模式 keeps two live chat panes side by side (one is active, the other stays visible).
  // Every panel below belongs to the pane it was mounted into; a pane is addressed by its
  // session key, so a click in one pane can never move, close or answer in the other.
  const paneSession = pane => {
    if (!pane) return "";
    const direct = pane.sessionKey || pane.dataset?.sessionKey || "";
    if (direct) return String(direct);
    try {
      const owner = JSON.parse(pane.dataset?.mcpAppOwnerKey || "null");
      if (Array.isArray(owner) && owner[1]) return String(owner[1]);
    } catch { /* not an owner-marked pane */ }
    const inner = pane.querySelector?.('openclaw-chat-pane') || null;
    return String(inner?.sessionKey || "");
  };
  const allPanes = () => Array.from(document.querySelectorAll("openclaw-chat-pane.chat-pane-cache__pane"));
  const visiblePanes = () => allPanes().filter(pane => pane.classList.contains("chat-pane-cache__pane--visible")
    || pane.classList.contains("chat-pane-cache__pane--active"));
  const paneOf = node => node?.closest?.("openclaw-chat-pane") || null;
  const paneRoot = pane => pane?.querySelector(".chat-main") || pane;

  // Degradation only: before the native panes mount (or in an older host without split view)
  // there is no pane to address, so the single visible chat is used. Everything after mount
  // resolves through the owning pane instead.
  const fallbackChat = () => document.querySelector(".chat-pane-cache__pane--active") || null;
  const fallbackComposer = () => document.querySelector(".chat-pane-cache__pane--active .agent-chat__composer-shell");
  const fallbackLead = () => document.querySelector(".chat-pane-cache__pane--active .agent-chat__composer-lead");

  const focusedPane = () => paneOf(document.activeElement) || fallbackChat() || visiblePanes()[0] || null;

  // the learning session this instance speaks for: its own pane, never "the first pane on the page".
  // With no pane at all (first paint) fall back to the routed session.
  const sessionKeyFor = (pane = null) => {
    const own = paneSession(pane);
    if (own) return own;
    const routed = window.CLE?.host?.sessions?.selectedKey || new URL(location.href).searchParams.get("session") || "";
    if (routed) return routed;
    const active = document.querySelector(".sidebar-recent-session--active[data-session-key]");
    return active?.dataset.sessionKey || document.querySelector("openclaw-app-shell")?.context?.gateway?.snapshot?.sessionKey || "";
  };

  const isLearningSession = key => /^agent:learning:/.test(String(key || ""));
  // a room may differ per pane: the pane's own session wins over the global room badge
  const inLearningMode = (pane = null) => {
    if (pane) return isLearningSession(paneSession(pane));
    const mode = document.documentElement.getAttribute("data-cle-room");
    return mode === "learning" || isLearningSession(sessionKeyFor(null));
  };

  function createController() {
  const state = {
    pane: null,
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
    manuscriptMode: "",
    undoKind: "",
    undoValue: null,
    undoTimer: 0,
    undoNote: null,
    lastOrganizationBackupId: "",
    noteMenu: null,
    examPacks: null,
    examPacksLoading: false,
    examPackId: "",
    packMode: false,
    packSuggestions: null,
    packSelected: new Set(),
  };

  const el = (tag, className, text) => {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  };

  // every call inside a controller means "this pane's session"
  const pageSessionKey = () => sessionKeyFor(state.pane);

  const request = (method, params, timeout = 16000) => {
    const gateway = window.__laolaoSidebar?.gwRequest;
    if (typeof gateway !== "function") return Promise.reject(new Error("学习工作台正在连接，请稍后再试"));
    return gateway(method, params, timeout);
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
    const scope = paneElement() || document;
    const groups = Array.from(scope.querySelectorAll(".chat-group.user")).slice(-8);
    for (const group of groups) {
      const text = group.textContent || "";
      // Older saved chats can still contain note controls sent before the independent drawer model.
      const internal = [START_MARKER, ANSWER_MARKER, NEXT_MARKER, BATCH_MARKER,
        "[[CLEKK_NOTE_LIGHT_V1]]", "[[CLEKK_NOTE_DEEP_V1]]"].some(marker => text.includes(marker));
      group.classList.toggle("laolao-learning-control-message", internal);
    }
  };

  // the composer of this controller's own pane (never the first composer on the page)
  const paneElement = () => state.pane?.isConnected ? state.pane : null;
  const composer = () => {
    const pane = paneElement();
    return pane ? pane.querySelector(".agent-chat__composer-shell") : fallbackComposer();
  };

  const ensureStage = () => {
    const anchor = composer();
    if (!anchor?.parentElement) return null;
    if (state.stage?.isConnected && state.stage.parentElement === anchor.parentElement) return state.stage;
    state.stage?.remove();
    const stage = el("section", "laolao-learning-stage");
    stage.setAttribute("aria-live", "polite");
    stage.hidden = true;
    stage.dataset.clePaneSession = pageSessionKey();
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

  const activityItems = current => Array.isArray(current?.items) && current.items.length ? current.items : current ? [current] : [];
  const itemPhase = item => item?.phase === "evaluating" ? "evaluating" : item?.result ? "explained" : item?.submission ? "evaluating" : "asking";

  const activeItem = (current = state.remote?.current) => {
    const items = activityItems(current);
    if (state.activityId !== current?.id) {
      state.activityId = current?.id || "";
      state.activeItemId = "";
      state.answerDrafts = new Map();
    }
    return items.find(item => item.id === state.activeItemId) || items.find(item => !item.submission) || items[0] || null;
  };

  const itemDraft = item => {
    state.answerDrafts ||= new Map();
    const key = item?.id || state.remote?.current?.id;
    if (!state.answerDrafts.has(key)) state.answerDrafts.set(key, {answer: "", confidence: null, hintUsed: false});
    return state.answerDrafts.get(key);
  };

  const sameActivity = (sessionKey, activityId) => !state.disposed && pageSessionKey() === sessionKey && state.remote?.current?.id === activityId;

  const answerLabel = (item, answer) => (Array.isArray(answer) ? answer : [answer]).map(value => {
    const option = item?.options?.find(option => option.id === value);
    return option ? `${option.id}. ${option.label}` : String(value ?? "");
  }).join("；");


  const explainAnswer = async (button, current = state.remote?.current, item = activeItem(current)) => {
    const sessionKey = pageSessionKey();
    if (!current || !item?.submission) return;
    setBusy(button, true, "正在请求讲解…");
    try {
      const submission = item.submission;
      await sendControl(`${ANSWER_MARKER}\nactivity_id: ${current.id}\nitem_id: ${item.id}\nanswer: ${JSON.stringify(submission.answer)}\nconfidence: ${submission.confidence ?? "not_provided"}\nhint_used: ${Boolean(submission.hintUsed)}\nserver_check: ${submission.correctness === true ? "correct" : submission.correctness === false ? "incorrect" : "needs_model"}\n请只对这一小题调用 learning_activity resolve，使用 item_results 并保留 item_id。给出评分点与具体错因；客观题以服务器判定为准，不要替其他小题判分。`, sessionKey);
      if (sameActivity(sessionKey, current.id)) statusLine(state.stage, "答案已保存，正在准备讲解。可以继续做下一小题。");
    } catch (error) {
      if (sameActivity(sessionKey, current.id)) statusLine(state.stage, `答案已保存。讲解暂时没有送达：${error.message || "请重试讲解"}`, true);
    } finally { if (sameActivity(sessionKey, current.id)) setBusy(button, false, "重试讲解"); }
  };


  const appendQuestionSources = (root, sources) => {
    const anchors = Array.isArray(sources) ? sources.filter(source => source?.bookId && source?.location != null) : [];
    if (!anchors.length) return;
    const row = el("div", "laolao-learning-stage__sources");
    for (const source of anchors.slice(0, 4)) {
      const jump = el("button", "pinkie-library__source-jump", `查看原文 · ${source.title || "资料"}${source.label ? ` · ${source.label}` : ""}`);
      jump.type = "button"; jump.addEventListener("click", async () => {
        try { if (!window.__pinkieLibrary?.open) throw new Error("资料阅读器尚未连接，请稍后再试"); await window.__pinkieLibrary.open(source.bookId, {location: source.location, quote: source.quote || ""}); }
        catch (error) { showToast(error.message, true); }
      }); row.append(jump);
    }
    root.append(row);
  };


  const continueLearning = async (step = {}, button = null) => {
    const sessionKey = pageSessionKey();
    if (step.sessionKey && step.sessionKey !== sessionKey) { showToast("这一步属于另一个学习会话，请先切换到对应会话。", true); return; }
    setBusy(button, true, "准备中…");
    try {
      if (step.kind === "review") { openNotebook(); await startReview(); return; }
      if ((step.kind === "reading" || step.kind === "read") && step.bookId) { await window.__pinkieLibrary?.open(step.bookId, {location: step.location}); return; }
      if (step.attemptId) { const result = await request("pinkie.learning.attempts.retry", {sessionKey, id: step.attemptId}); if (pageSessionKey() !== sessionKey) return; state.remote = result; state.revision = Number(result.revision) || state.revision; renderStage(result); closeNotebook(); return; }
      const remote = await request("pinkie.learning.current", {sessionKey});
      if (pageSessionKey() !== sessionKey) return;
      if (remote.current && step.kind !== "practice" && step.kind !== "weak") { state.remote = remote; state.revision = Number(remote.revision) || state.revision; renderStage(remote); state.stage?.scrollIntoView({block: "nearest"}); return; }
      if (!remote.enabled) { const enabled = await request("pinkie.learning.set", {sessionKey, enabled: true}); if (pageSessionKey() !== sessionKey) return; state.remote = enabled; state.revision = Number(enabled.revision) || state.revision; renderStage(enabled); }
      await sendControl(`${START_MARKER}\n${step.topic ? `请先围绕薄弱点 ${JSON.stringify(step.topic)} ` : "请从当前对话选择一个值得巩固的知识点，"}调用 learning_activity present 出一道理解题；上下文不足时先问我要练什么。一次只出一题。`, sessionKey);
    } catch (error) { if (pageSessionKey() === sessionKey) showToast(error.message || "暂时无法继续学习", true); }
    finally { if (pageSessionKey() === sessionKey) setBusy(button, false, step.label || "继续学习"); }
  };


  const appendGradeCorrection = (root, attemptId, correct) => {
    if (!attemptId) return;
    const details = el("details", "laolao-learning-stage__correction"); details.append(el("summary", "", "评分有误？手动纠正"));
    const reason = el("textarea", "laolao-learning-stage__answer"); reason.rows = 2; reason.placeholder = "说明依据，例如同义答案或评分点遗漏。"; reason.setAttribute("aria-label", "纠正评分的依据");
    const save = el("button", "laolao-learning-button", correct === true ? "改为仍需巩固" : "改为回答正确"); save.type = "button";
    save.addEventListener("click", async () => {
      const sessionKey = currentSession();
      if (!reason.value.trim()) { showToast("写一句纠正依据，再保存。", true); reason.focus(); return; }
      setBusy(save, true, "正在保存…");
      try {
        const result = await request("pinkie.learning.attempts.correct", {sessionKey, id: attemptId, correct: correct !== true, reason: reason.value.trim()});
        if (currentSession() !== sessionKey) return;
        if (result.state?.current?.id === state.remote?.current?.id) { state.remote = result.state; state.revision = Number(result.state.revision) || state.revision; renderStage(state.remote); }
        showToast("已保存人工纠正，原评分和依据仍会保留。");
        if (state.radarMode) void openMistakesRadar();
      } catch (error) { if (currentSession() === sessionKey) showToast(error.message || "纠正没有保存", true); }
      finally { if (currentSession() === sessionKey) setBusy(save, false, "保存纠正"); }
    });
    details.append(reason, save); root.append(details);
  };


  const selectedAnswer = stage => {
    const current = activeItem();
    if (!current) return "";
    const selected = Array.from(stage.querySelectorAll('input[data-learning-answer="1"]')).filter(input => input.checked).map(input => input.value);
    if (current.kind === "multiple_choice") return selected;
    if (current.kind === "single_choice") return selected[0] || "";
    return stage.querySelector(".laolao-learning-stage__answer")?.value.trim() || "";
  };
  const submitAnswer = async button => {
    const current = state.remote?.current;
    const item = activeItem(current);
    const stage = state.stage;
    const sessionKey = pageSessionKey();
    if (!current || !item || !stage || item.submission) return;
    const answer = selectedAnswer(stage);
    if ((!Array.isArray(answer) && !answer) || (Array.isArray(answer) && !answer.length)) {
      statusLine(stage, "先写下或选好答案，再提交就好。", true);
      return;
    }
    const draft = itemDraft(item);
    draft.answer = answer;
    draft.submissionId ||= crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    setBusy(button, true, "正在提交…");
    try {
      const result = await request("pinkie.learning.submit", {
        sessionKey, activityId: current.id, itemId: item.id, answer,
        confidence: draft.confidence, hintUsed: draft.hintUsed, submissionId: draft.submissionId,
      });
      if (!sameActivity(sessionKey, current.id)) return;
      state.activeItemId = item.id;
      state.remote = result;
      state.revision = Number(result?.revision) || state.revision;
      renderStage(result);
      const submitted = activityItems(result.current).find(entry => entry.id === item.id) || result.current;
      await explainAnswer(null, result.current, submitted);
    } catch (error) {
      if (!sameActivity(sessionKey, current.id)) return;
      statusLine(stage, error.message || "答案没有送出去，请再试一次", true);
      setBusy(button, false, "提交答案");
    }
  };

  const saveCurrentKeyPoint = async button => {
    const current = activeItem();
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
        sourceAnchor: current.sources?.find(source => source?.bookId && source.location != null),
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
    const sessionKey = pageSessionKey();
    const current = state.remote?.current;
    const item = activeItem(current);
    if (!item) return;
    setBusy(button, true, "准备中…");
    try {
      const attemptId = item.submission?.attemptId || item.result?.attemptId || item.attemptId || "";
      await sendControl(`${NEXT_MARKER}\n上题：${JSON.stringify({question: item.question, topic: item.topic, note_ids: item.noteIds || [], answer: item.submission?.answer, result: item.result, sources: item.sources || []})}\nretry_of: ${attemptId}\n请针对刚才暴露的知识点，调用 learning_activity present 给一道难度合适的变式题。present.retry_of 必须设为上面的作答 id，note_ids 只关联本题真正考察的笔记，来源保持真实。不要重复原题，也不要提前给答案。一次只出一题。`, sessionKey);
      if (sameActivity(sessionKey, current.id)) statusLine(state.stage, "正在按刚才的表现准备变式题…");
    } catch (error) {
      if (!sameActivity(sessionKey, current.id)) return;
      statusLine(state.stage, error.message || "下一题暂时没有送出去", true);
      setBusy(button, false, "再试一次");
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
    const nativeStop = (paneElement() || document).querySelector(".chat-pane-cache__pane--active .chat-send-btn--stop")
      || (paneElement() || document).querySelector(".chat-send-btn--stop");
    if (nativeStop && !nativeStop.disabled) nativeStop.click();
  };

  const optionNode = (current, option) => {
    const label = el("label", "laolao-learning-option");
    const input = el("input");
    input.type = current.kind === "multiple_choice" ? "checkbox" : "radio";
    input.name = `learning-answer:${pageSessionKey()}:${state.remote?.current?.id}:${current.id}`;
    input.dataset.learningAnswer = "1";
    input.value = option.id;
    const badge = el("span", "laolao-learning-option__badge", option.id);
    const text = el("span", "laolao-learning-option__text", option.label);
    label.append(input, badge, text);
    return label;
  };

  const renderStage = remote => {
    if (typeof CustomEvent === "function") window.dispatchEvent?.(new CustomEvent("pinkie:learning-state", {detail: remote}));
    const current = remote?.current;
    const item = activeItem(current);
    const inline = current?.id && window.__pinkieLearningInline?.hasActivity?.(remote?.sessionKey || pageSessionKey(), current.id);
    // Due notes belong in the notebook. Only an actual legacy activity needs
    // this fallback; ordinary chat must not grow an unsolicited review banner.
    if (!remote?.enabled || !item?.question || inline) {
      state.stage?.remove(); state.stage = null;
      return;
    }
    const stage = ensureStage();
    if (!stage) return;
    const phase = itemPhase(item);
    stage.hidden = false;
    stage.classList.toggle("is-resolved", phase === "explained");
    stage.classList.toggle("has-no-art", !ASSET);
    stage.replaceChildren();
    const body = el("div", "laolao-learning-stage__body");
    body.append(el("div", "laolao-learning-stage__eyebrow", item?.topic || current?.topic || "互动学习"));
    if (item) {
      const items = activityItems(current);
      if (items.length > 1) {
        const progress = el("nav", "laolao-learning-stage__items");
        progress.setAttribute("aria-label", "题组进度，每题单独评分");
        progress.append(el("span", "", `${items.filter(entry => itemPhase(entry) === "explained").length}/${items.length} 题已讲解`));
        items.forEach((entry, index) => {
          const stateLabel = itemPhase(entry) === "explained" ? entry.result.correct === true ? "答对" : entry.result.correct === false ? "待巩固" : "已讲解" : entry.submission ? "待讲解" : "未作答";
          const tab = el("button", "laolao-learning-stage__item", `${index + 1}`);
          tab.type = "button"; tab.dataset.state = itemPhase(entry) === "explained" ? entry.result.correct === true ? "correct" : "practice" : entry.submission ? "pending" : "asking";
          tab.setAttribute("aria-label", `第 ${index + 1} 题，${stateLabel}`);
          tab.setAttribute("aria-current", String(entry.id === item.id));
          tab.addEventListener("click", () => { state.activeItemId = entry.id; renderStage(state.remote); });
          progress.append(tab);
        });
        body.append(progress);
      }
      body.append(el("h3", "laolao-learning-stage__question", item.question));
      appendQuestionSources(body, item.sources || current.sources || []);
      if (phase === "asking") {
        const draft = itemDraft(item);
        const answers = el("div", "laolao-learning-stage__answers");
        if (item.kind === "single_choice" || item.kind === "multiple_choice") {
          for (const option of item.options || []) {
            const label = optionNode(item, option);
            const input = label.querySelector("input");
            input.checked = Array.isArray(draft.answer) ? draft.answer.includes(option.id) : draft.answer === option.id;
            input.addEventListener("change", () => { draft.answer = selectedAnswer(stage); });
            answers.append(label);
          }
        } else {
          const input = el("textarea", "laolao-learning-stage__answer");
          input.rows = item.kind === "short_answer" ? 3 : 2;
          input.value = typeof draft.answer === "string" ? draft.answer : "";
          input.placeholder = item.kind === "fill_blank" ? "把答案填在这里…" : "用自己的话答，短一点也没关系…";
          input.setAttribute("aria-label", "你的答案");
          input.addEventListener("input", () => { draft.answer = input.value; });
          answers.append(input);
        }
        body.append(answers);
        if (item.hint) {
          const details = el("details", "laolao-learning-stage__hint");
          details.open = draft.hintUsed;
          details.append(el("summary", "", "给一点提示"), el("p", "", item.hint));
          details.addEventListener("toggle", () => { if (details.open) draft.hintUsed = true; });
          body.append(details);
        }
        const confidence = el("fieldset", "laolao-learning-stage__confidence-row");
        confidence.append(el("legend", "", "这题有多大把握？（可选）"));
        for (const [value, label] of [[25, "没把握"], [60, "有点把握"], [90, "很确定"]]) {
          const choose = el("button", "laolao-learning-stage__confidence", label);
          choose.type = "button"; choose.setAttribute("aria-pressed", String(draft.confidence === value));
          choose.addEventListener("click", () => {
            draft.confidence = draft.confidence === value ? null : value;
            for (const sibling of confidence.querySelectorAll("button")) sibling.setAttribute("aria-pressed", String(sibling === choose && draft.confidence === value));
          });
          confidence.append(choose);
        }
        const submit = el("button", "laolao-learning-button laolao-learning-button--primary", "提交答案");
        submit.type = "button"; submit.addEventListener("click", () => submitAnswer(submit));
        const actions = el("div", "laolao-learning-stage__actions"); actions.append(confidence, submit); body.append(actions);
      } else {
        const answer = el("div", "laolao-learning-stage__submitted");
        answer.append(el("strong", "", "你的答案"), el("p", "", answerLabel(item, item.submission?.answer)));
        if (item.submission?.hintUsed) answer.append(el("small", "", "本次用了提示，会单独记录为提示后作答。"));
        body.append(answer);
        if (phase === "evaluating") {
          const immediate = item.submission?.correctness;
          body.append(el("div", `laolao-learning-result ${immediate === true ? "is-correct" : immediate === false ? "is-incorrect" : ""}`, immediate === true ? "答案正确，正在准备讲解…" : immediate === false ? "答案还不对，正在分析错因…" : "答案已保存，正在核对你的思路…"));
          if (item.result?.feedback) body.append(el("p", "laolao-learning-result__feedback", item.result.feedback));
          if (item.result?.criteria?.some(point => point.met == null)) body.append(el("p", "laolao-learning-stage__lead", "评分点还没核对完整，暂不更新掌握等级。可以重试讲解补齐。"));
          const retry = el("button", "laolao-learning-button", "重试讲解"); retry.type = "button";
          retry.addEventListener("click", () => explainAnswer(retry)); body.append(retry);
        } else {
          const result = item.result || {};
          const verdict = result.correct === true ? (item.submission?.hintUsed ? "提示后答对，下次独立试试" : "这题答对了") : result.correct === false ? "这个知识点还需要巩固" : "这题已讲解，掌握情况待确认";
          body.append(el("div", `laolao-learning-result ${result.correct === true ? "is-correct" : result.correct === false ? "is-incorrect" : ""}`, verdict));
          let explanationRoot = body;
          if (result.gradingConflict || result.gradeSource === "user_correction") {
            body.append(el("p", "laolao-learning-result__error", result.gradeSource === "user_correction"
              ? `已按你的人工纠正记录${result.correctionReason ? `：${result.correctionReason}` : "，原评分仍保留"}。`
              : "答案已按标准答案核对，讲解存在分歧。可以查看原文或人工纠正评分。"));
            explanationRoot = el("details", "laolao-learning-stage__original-explanation");
            explanationRoot.append(el("summary", "", "查看原讲解（可能不适用于当前评分）")); body.append(explanationRoot);
          }
          appendGradeCorrection(body, result.attemptId || item.submission?.attemptId || item.attemptId, result.correct);
          if (result.feedback) explanationRoot.append(el("p", "laolao-learning-result__feedback", result.feedback));
          if (result.explanation) explanationRoot.append(el("p", "laolao-learning-result__explanation", result.explanation));
          if (result.criteria?.length) {
            const criteria = el("ul", "laolao-learning-result__criteria");
            for (const point of result.criteria) criteria.append(el("li", "", `${point.met === true ? "✓" : point.met === false ? "待补" : "待确认"} ${point.label || point.id || "评分点"}${point.feedback ? `：${point.feedback}` : ""}`));
            explanationRoot.append(criteria);
          }
          const rawError = result.errorType || result.error_type;
          const errorLabel = ({concept: "概念理解",method: "解题方法",reading: "审题",careless: "疏漏",memory: "记忆"})[rawError] || rawError;
          if (errorLabel) explanationRoot.append(el("p", "laolao-learning-result__error", `这次主要卡在：${errorLabel}`));
          if (result.reviewMessage) body.append(el("p", "laolao-learning-stage__lead", result.reviewMessage));
          const nextReview = Math.min(...(result.reviewedNotes || []).map(note => Number(note.nextReviewAt)).filter(value => value > 0));
          if (Number.isFinite(nextReview)) body.append(el("p", "laolao-learning-stage__lead", `已安排复习：${new Date(nextReview).toLocaleDateString("zh-CN", {month: "long", day: "numeric"})}。答对一次只是一条证据，之后还会再核对。`));
          if (result.keyPoint) { const point = el("div", "laolao-learning-keypoint"); point.append(el("strong", "", "记住这一点："), document.createTextNode(result.keyPoint)); explanationRoot.append(point); }
          const actions = el("div", "laolao-learning-stage__actions");
          const note = el("button", "laolao-learning-button", "记入笔记"); note.type = "button"; note.addEventListener("click", () => saveCurrentKeyPoint(note));
          const next = el("button", "laolao-learning-button laolao-learning-button--primary", result.correct === false ? "换一道类似题" : "继续练习"); next.type = "button"; next.addEventListener("click", () => nextQuestion(next));
          if (!result.gradingConflict && result.gradeSource !== "user_correction") actions.append(note);
          if (items.every(entry => itemPhase(entry) === "explained")) actions.append(next);
          body.append(actions);
        }
        const nextItem = items.find(entry => !entry.submission);
        if (nextItem) { const next = el("button", "laolao-learning-button laolao-learning-button--primary", "继续下一小题"); next.type = "button"; next.addEventListener("click", () => { state.activeItemId = nextItem.id; renderStage(state.remote); }); body.append(next); }
      }
    }
    stage.append(body);
    if (ASSET) { const art = el("img", "laolao-learning-stage__art"); art.src = ASSET; art.alt = "学习伙伴拿着笔记本"; art.decoding = "async"; art.draggable = false; stage.append(art); }
  };

  const toggleInteraction = async button => {
    const enabled = !(state.remote?.enabled ?? state.toggle?.getAttribute("aria-pressed") === "true");
    const sessionKey = pageSessionKey();
    setBusy(button, true, enabled ? "开启中…" : "关闭中…");
    try {
      const result = await request("pinkie.learning.set", {sessionKey, enabled});
      if (pageSessionKey() !== sessionKey) return;
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

  const absorbLegacyButtons = () => {
    const pane = paneElement();
    const actions = (pane || fallbackChat())?.querySelector(".agent-chat__composer-lead") || fallbackLead();
    if (!actions) return;
    for (const node of actions.querySelectorAll(".laolao-learning-notebook-button")) node.classList.add("laolao-learning--absorbed");
  };

  const syncButtons = () => {
    const enabled = Boolean(state.remote?.enabled);
    if (state.toggle) {
      state.toggle.classList.toggle("is-active", enabled);
      state.toggle.setAttribute("aria-pressed", String(enabled));
      state.toggle.textContent = enabled ? "互动中" : "互动学习";
      state.toggle.disabled = false;
    }
    if (state.toolsDue) {
      const due = Number(state.dueCount) || 0;
      state.toolsDue.textContent = due > 0 ? `今日复习 ${due}` : "今日复习";
      state.toolsDue.classList.toggle("is-due", due > 0);
    }
    if (state.toolsCapsule?.isConnected) absorbLegacyButtons();
  };

  const refreshDueCount = async () => {
    try {
      const result = await request("pinkie.learning.notes.list", {sessionKey: notebookSession(), limit: 1}, 15000);
      state.dueCount = Number(result?.dueCount) || 0;
      syncButtons();
    } catch { /* 静默：复习计数失败不影响聊天 */ }
  };

  const ensureToolsCapsule = actions => {
    if (state.toolsCapsule?.isConnected) {
      // the capsule follows the room: 学习工具 exists only on a learning pane
      if (!inLearningMode(state.pane)) { state.toolsCapsule.remove(); state.toolsCapsule = null; state.toolsDue = null; return; }
      if (state.toolsCapsule.parentElement !== actions) actions.prepend(state.toolsCapsule);
      return;
    }
    if (!inLearningMode(state.pane)) return;
    const capsule = el("div", "laolao-learning-tools");
    const trigger = el("button", "laolao-learning-tools__trigger", "学习工具");
    trigger.type = "button";
    trigger.title = "复习、资料库等学习工具；鼠标靠近展开";
    trigger.setAttribute("aria-haspopup", "true");
    const tray = el("div", "laolao-learning-tools__tray");
    tray.setAttribute("role", "menu");

    const review = el("button", "laolao-learning-tools__item laolao-learning-tools__due", "今日复习");
    review.type = "button";
    review.addEventListener("click", () => { openNotebook(); startReview(); });
    state.toolsDue = review;

    const notes = el("button", "laolao-learning-tools__item", "笔记本");
    notes.type = "button";
    notes.addEventListener("click", () => openNotebook());

    const library = el("button", "laolao-learning-tools__item", "资料库");
    library.type = "button";
    library.addEventListener("click", async () => {
      try { await window.__pinkieLibrary?.shelf(); }
      catch { showToast("资料库未就绪", true); }
    });

    const packs = el("button", "laolao-learning-tools__item", "考纲题库");
    packs.type = "button";
    packs.addEventListener("click", () => openExamPacks());

    const mistakes = el("button", "laolao-learning-tools__item", "错题雷达");
    mistakes.type = "button";
    mistakes.addEventListener("click", () => openMistakesRadar());

    const practice=el("button","laolao-learning-tools__item","练习实验");practice.type="button";
    practice.addEventListener("click",async()=>{try{await window.__pinkieLearningPractice?.open(pageSessionKey());}catch(error){showToast(error.message,true);}});
    tray.append(review, notes, library, packs, mistakes, practice);
    capsule.append(trigger, tray);
    actions.prepend(capsule);
    state.toolsCapsule = capsule;
    refreshDueCount();
    absorbLegacyButtons();
  };

  // Controls for one pane. 双模式 renders two composers: each controller owns the buttons in its
  // own lead, adopts buttons already there after a cached re-render, and never touches the other
  // side. Everything essential is (re)created locally, so a hidden or re-rendered lead cannot
  // leave one side without 互动学习 / 学习工具.
  const ensureButtons = () => {
    const pane = paneElement();
    const actions = (pane || fallbackChat())?.querySelector(".agent-chat__composer-lead") || fallbackLead();
    if (!actions) return;

    // adopt surviving nodes from a previous render of this same pane
    if (!state.toggle?.isConnected) state.toggle = actions.querySelector(".laolao-learning-toggle");
    if (!state.notebookButton?.isConnected) state.notebookButton = actions.querySelector(".laolao-learning-notebook-button");
    if (!state.toolsCapsule?.isConnected) state.toolsCapsule = actions.querySelector(".laolao-learning-tools");
    if (state.toolsCapsule) state.toolsDue = state.toolsCapsule.querySelector(".laolao-learning-tools__due");

    ensureToolsCapsule(actions);
    for (const button of [state.toggle, state.notebookButton]) {
      if (button?.isConnected && button.parentElement !== actions) actions.prepend(button);
    }
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
    if (note.sourceAnchor) {
      const jump = el("button", "pinkie-library__source-jump", `${note.sourceAnchor.title} · ${note.sourceAnchor.label} ↗`);
      jump.type = "button"; jump.title = "回到原文并高亮";
      jump.addEventListener("click", event => { event.stopPropagation(); closeNotebook(); void window.__pinkieLibrary?.open(note.sourceAnchor.bookId, {location: note.sourceAnchor.location, quote: note.sourceAnchor.quote}).catch(error => showToast(error.message, true)); });
      source.append(el("br"), jump);
    }
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
      const questionNote = {id: note.id, term: note.term || note.title || "", meaning: note.meaning || "", example: note.example || "", content: note.content || "", sourceAnchor: note.sourceAnchor || null};
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
      if (note.sourceAnchor) { closeNotebook(); void window.__pinkieLibrary?.open(note.sourceAnchor.bookId, {location: note.sourceAnchor.location, quote: note.sourceAnchor.quote}).catch(error => showToast(error.message, true)); }
      else beginEdit(card, note);
    });
    card.addEventListener("keydown", event => {
      if ((event.key === "Enter" || event.key === " ") && event.target === card) { event.preventDefault(); if (note.sourceAnchor) { closeNotebook(); void window.__pinkieLibrary?.open(note.sourceAnchor.bookId, {location: note.sourceAnchor.location, quote: note.sourceAnchor.quote}).catch(error => showToast(error.message, true)); } else beginEdit(card, note); }
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
    renderSavedManuscript();
    closeNoteMenu();
    const queue = state.reviewQueue || [];
    const note = queue[state.reviewIndex];
    if (!note) {
      const done = el("section", "laolao-learning-review laolao-learning-review--done");
      done.append(el("div", "laolao-learning-review__eyebrow", "这一轮复习完成"), el("h3", "", state.reviewDailyRemaining === 0 ? "今天的复习计划已完成，积压可以留到以后分批复习。" : state.reviewRemaining ? `本轮已完成，还有 ${state.reviewRemaining} 条，休息一下再继续。` : "这一轮都核对完了，隔天还能记得才更稳。"));
      const leave = el("button", "laolao-learning-button laolao-learning-button--primary", "回到笔记"); leave.type = "button"; leave.addEventListener("click", () => { state.reviewQueue = null; renderNotes(state.notes, state.noteData?.similar || []); });
      done.append(leave); list.replaceChildren(done); return;
    }
    const panel = el("section", "laolao-learning-review");
    panel.append(el("div", "laolao-learning-review__eyebrow", `本轮 ${Number(state.reviewDone || 0) + 1} / ${state.reviewTotal || queue.length}`));
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
      if (state.reviewRecall) { const own = el("p", "laolao-learning-review__own", `刚才的回忆：${state.reviewRecall}`); panel.append(own); }
      panel.append(back);
      panel.append(el("small", "laolao-learning-review__self-rating", "对照原笔记自评；这里不会自动判定你的答案对错。"));
      const grades = el("div", "laolao-learning-review__grades");
      for (const [rating, label] of [["remembered", "记得"], ["fuzzy", "模糊"], ["forgot", "忘了"]]) {
        const button = el("button", `laolao-learning-button${rating === "remembered" ? " laolao-learning-button--primary" : ""}`, label); button.type = "button";
        button.addEventListener("click", async () => {
          const ownerSession = currentSession();
          setBusy(button, true, "记录中…");
          try {
            const result = await request("pinkie.learning.notes.review", {sessionKey: notebookSession(), id: note.id, rating});
            if (currentSession() !== ownerSession || state.reviewQueue?.[state.reviewIndex]?.id !== note.id) return;
            if (Number.isFinite(state.reviewDailyRemaining)) state.reviewDailyRemaining = Math.max(0, state.reviewDailyRemaining - 1);
            state.notes = state.notes.map(item => item.id === note.id ? result.note : item);
            state.reviewQueue.splice(state.reviewIndex, 1);
            state.reviewDone = Number(state.reviewDone || 0) + 1;
            state.reviewRecall = "";
            state.reviewFlipped = false;
            await loadNotes();
          } catch (error) { setBusy(button, false, label); showToast(error.message || "复习记录失败", true); }
        });
        grades.append(button);
      }
      panel.append(grades);
    } else {
      const recall = el("textarea", "laolao-learning-stage__answer laolao-learning-review__recall");
      recall.rows = 2; recall.value = state.reviewRecall || "";
      recall.placeholder = "先用自己的话回忆含义或用法，也可以先在心里想一遍。";
      recall.setAttribute("aria-label", "先回忆，再核对");
      recall.addEventListener("input", () => { state.reviewRecall = recall.value; }); panel.append(recall);
      const flip = el("button", "laolao-learning-button laolao-learning-button--primary", "回忆好了，核对释义"); flip.type = "button";
      flip.addEventListener("click", () => { state.reviewFlipped = true; renderReview(list); }); panel.append(flip);
    }
    const exit = el("button", "laolao-learning-review__exit", "结束复习"); exit.type = "button";
    exit.addEventListener("click", () => { state.reviewQueue = null; state.reviewFlipped = false; renderNotes(state.notes, state.noteData?.similar || []); });
    panel.append(exit); list.replaceChildren(panel);
  };

  const startReview = async () => {
    const sessionKey = notebookSession();
    try {
      state.radarMode = false;
      const result = await request("pinkie.learning.notes.review.queue", {sessionKey, limit: 10});
      if (notebookSession() !== sessionKey) return;
      state.reviewQueue = result.notes || [];
      state.reviewRemaining = Number(result.remainingCount) || 0; state.reviewDailyRemaining = result.dailyRemaining;
      state.reviewTotal = state.reviewQueue.length; state.reviewDone = 0; state.reviewRecall = "";
      state.reviewIndex = 0; state.reviewFlipped = false;
      const list = state.drawer?.querySelector(".laolao-learning-notes__list");
      if (list) renderReview(list);
    } catch (error) { if (notebookSession() === sessionKey) showToast(error.message || "复习列表读取失败", true); }
  };

  const normalizePackText = value => String(value ?? "").normalize("NFKC").toLowerCase();

  const loadExamPacks = async () => {
    if (state.examPacks) return state.examPacks;
    const response = await fetch(new URL("laolao-exam-packs.json", location.href).href, {cache: "no-cache"});
    if (!response.ok) throw new Error("考纲题库文件读取失败（" + response.status + "）");
    const doc = await response.json();
    state.examPacks = Array.isArray(doc?.packs) ? doc.packs : [];
    return state.examPacks;
  };

  const packHaystack = note => normalizePackText([
    note?.title, note?.content, note?.term, note?.meaning, note?.example, note?.note,
  ].filter(Boolean).join(" "));

  // 通用功能词与纯语法形式词：单独出现不能判定考点（否则 that / which 会把任何句子都判成“定语从句”）
  const GENERIC_KEYWORDS = new Set([
    "that", "which", "who", "whom", "whose", "when", "where", "why", "what", "as", "to", "in", "on", "at",
    "for", "of", "with", "by", "from", "about", "and", "or", "the", "a", "an", "is", "are", "was", "were",
    "be", "been", "being", "do", "does", "did", "it", "this", "these", "those", "not", "but", "if", "so",
    "then", "than", "there", "here", "how", "as we know", "as is known", "such as",
    "-ing", "to do", "doing", "done", "原形", "单三", "复数", "过去式", "过去分词", "现在分词",
    "不定式", "第三人称单数", "句子", "单词", "短语",
  ]);

  // 多词搭配是强信号（2 分）；单字至少 4 个字符才算强信号，短词只记 1 分。
  // 一个考点总分 ≥ 2 才建议，避免单靠一个泛词误标。
  const keywordWeight = raw => {
    const key = normalizePackText(raw).trim();
    if (key.length < 2) return 0;
    if (GENERIC_KEYWORDS.has(key)) return 0;
    if (key.includes(" ")) return 2;
    return key.length >= 4 ? 2 : 1;
  };

  const scanPack = (notes, pack) => {
    const suggestions = [];
    for (const note of notes) {
      if (note?.status === "merged") continue;
      const hay = packHaystack(note);
      if (!hay) continue;
      const existing = Array.isArray(note.tags) ? note.tags.filter(Boolean) : [];
      const existingSet = new Set(existing);
      const hits = [];
      for (const topic of pack.topics || []) {
        let score = 0;
        const matched = [];
        for (const keyword of topic.keywords || []) {
          const weight = keywordWeight(keyword);
          if (!weight) continue;
          if (hay.includes(normalizePackText(keyword))) {
            score += weight;
            if (matched.length < 3) matched.push(String(keyword));
          }
        }
        if (score < 2) continue;
        hits.push({ name: topic.name, score, keywords: matched });
      }
      const add = hits.filter(item => !existingSet.has(item.name)).map(item => item.name);
      if (!add.length) continue;
      suggestions.push({
        id: note.id,
        title: String(note.title || note.term || note.content || "无标题").split("\n")[0].slice(0, 60),
        existing,
        add,
        evidence: hits.filter(item => add.includes(item.name)).map(item => `${item.name}（${item.keywords.join("、")}）`).join("；"),
        merged: [...existing, ...add],
      });
    }
    return suggestions;
  };

  const packSummaryText = (pack, suggestions, notes) => {
    if (!suggestions.length) return `《${pack.name}》扫描了 ${notes.length} 条笔记，没有发现可补充的考点标签。`;
    return `《${pack.name}》扫描了 ${notes.length} 条笔记，${suggestions.length} 条可以补考点标签。`;
  };

  const applyPackTags = async (pack, suggestions, selectedIds) => {
    const picked = suggestions.filter(item => selectedIds.has(item.id));
    if (!picked.length) { showToast("先选要应用标签的笔记", true); return; }
    let ok = 0;
    const failed = [];
    for (const item of picked) {
      try {
        await request("pinkie.learning.notes.update", {
          sessionKey: notebookSession(),
          id: item.id,
          tags: item.merged,
        }, 20000);
        ok += 1;
      } catch (error) {
        failed.push(item.title + "：" + (error?.message || "写入失败"));
      }
    }
    if (ok) showToast(`已为 ${ok} 条笔记补上《${pack.name}》考点标签`);
    if (failed.length) showToast(failed[0], true);
    await openExamPacks(pack.id);
  };

  const openExamPacks = async (preferredPackId) => {
    try {
      state.packMode = true;
      state.radarMode = false;
      state.reviewQueue = null;
      let drawer = state.drawer;
      if (!drawer?.classList.contains("is-open")) { openNotebook(); drawer = state.drawer; }
      for (let i = 0; i < 40; i++) {
        if (drawer?.querySelector(".laolao-learning-notes__list")?.children?.length) break;
        await new Promise(r => setTimeout(r, 100));
      }
      const list = drawer?.querySelector(".laolao-learning-notes__list");
      if (!list) throw new Error("笔记列表未就绪");
      list.hidden = false;
      const manuscriptHost = drawer?.querySelector(".laolao-learning-notes__manuscript");
      if (manuscriptHost) manuscriptHost.hidden = true;
      const previewHost = drawer?.querySelector(".laolao-learning-notes__preview");
      if (previewHost) previewHost.hidden = true;

      const panel = el("section", "laolao-learning-packs");
      panel.append(el("div", "laolao-learning-packs__eyebrow", "考纲题库"));
      list.replaceChildren(panel);

      let packs = [];
      try {
        packs = await loadExamPacks();
      } catch (error) {
        panel.append(el("p", "laolao-learning-packs__empty", error.message || "考纲题库加载失败"));
        return;
      }
      if (!packs.length) {
        panel.append(el("p", "laolao-learning-packs__empty", "没有找到考纲题库文件。"));
        return;
      }

      const pack = packs.find(item => item.id === preferredPackId) || packs.find(item => item.id === state.examPackId) || packs[0];
      state.examPackId = pack.id;
      const notesResult = await request("pinkie.learning.notes.list", {sessionKey: notebookSession(), limit: 500}, 20000);
      const notes = (notesResult.notes || []).filter(note => note.status !== "merged");
      state.notes = notesResult.notes || state.notes;
      const suggestions = scanPack(notes, pack);

      // 首次进入默认全选，之后保留用户上一次的勾选
      if (!state.packSuggestions) {
        state.packSelected = new Set(suggestions.map(item => item.id));
      } else {
        const valid = new Set(suggestions.map(item => item.id));
        state.packSelected = new Set([...state.packSelected].filter(id => valid.has(id)));
      }
      state.packSuggestions = suggestions;

      const tabs = el("div", "laolao-learning-packs__tabs");
      for (const item of packs) {
        const tab = el("button", "laolao-learning-packs__tab" + (item.id === pack.id ? " is-active" : ""), item.name);
        tab.type = "button";
        tab.addEventListener("click", () => { state.packSuggestions = null; state.packSelected = new Set(); void openExamPacks(item.id); });
        tabs.append(tab);
      }
      panel.append(tabs);
      if (pack.description) panel.append(el("p", "laolao-learning-packs__desc", pack.description));
      panel.append(el("p", "laolao-learning-packs__summary", packSummaryText(pack, suggestions, notes)));

      if (suggestions.length) {
        const toolbar = el("div", "laolao-learning-packs__actions");
        const toggleAll = el("button", "laolao-learning-button", "全部选中");
        toggleAll.type = "button";
        toggleAll.addEventListener("click", () => {
          const allSelected = suggestions.every(item => state.packSelected.has(item.id));
          state.packSelected = allSelected ? new Set() : new Set(suggestions.map(item => item.id));
          void openExamPacks(pack.id);
        });
        if (suggestions.every(item => state.packSelected.has(item.id))) toggleAll.textContent = "全部取消";
        const apply = el("button", "laolao-learning-button laolao-learning-button--primary", "应用选中标签");
        apply.type = "button";
        apply.addEventListener("click", async () => {
          setBusy(apply, true, "应用中");
          await applyPackTags(pack, suggestions, state.packSelected);
          setBusy(apply, false);
        });
        toolbar.append(toggleAll, apply);
        panel.append(toolbar);

        const box = el("div", "laolao-learning-packs__list");
        for (const item of suggestions) {
          const row = el("label", "laolao-learning-packs__item");
          const check = el("input");
          check.type = "checkbox";
          check.checked = state.packSelected.has(item.id);
          check.addEventListener("change", () => {
            if (check.checked) state.packSelected.add(item.id); else state.packSelected.delete(item.id);
          });
          const body = el("div", "laolao-learning-packs__item-body");
          body.append(el("strong", "laolao-learning-packs__item-title", item.title));
          const tags = el("div", "laolao-learning-packs__tags");
          for (const name of item.add) tags.append(el("span", "laolao-learning-packs__tag is-new", "+" + name));
          for (const name of item.existing) tags.append(el("span", "laolao-learning-packs__tag", name));
          body.append(tags);
          row.append(check, body);
          box.append(row);
        }
        panel.append(box);
      } else {
        panel.append(el("p", "laolao-learning-packs__empty", "这条考纲的关键词都已经在现有标签里了，或者笔记内容还没覆盖到这些考点。"));
      }

      const exit = el("button", "laolao-learning-button", "返回笔记");
      exit.type = "button";
      exit.addEventListener("click", () => {
        state.packMode = false;
        state.packSuggestions = null;
        renderNotes(state.notes, state.noteData?.similar || []);
      });
      panel.append(exit);
      for (const node of [list, list.parentElement, drawer]) {
        if (node) node.scrollTop = 0;
      }
    } catch (error) {
      showToast(error.message || "考纲题库读取失败", true);
    }
  };

  const openMistakesRadar = async () => {
    const sessionKey = currentSession();
    try {
      state.radarMode = true;
      if (!state.drawer?.classList.contains("is-open")) openNotebook();
      const result = await request("pinkie.learning.attempts.list", {sessionKey, wrongOnly: true, limit: 20});
      if (currentSession() !== sessionKey || !state.radarMode) return;
      const drawer = state.drawer;
      const list = drawer?.querySelector(".laolao-learning-notes__list");
      if (!list) throw new Error("学习记录尚未就绪");
      list.hidden = false;
      for (const selector of [".laolao-learning-notes__manuscript", ".laolao-learning-notes__preview"]) { const host = drawer.querySelector(selector); if (host) host.hidden = true; }
      const panel = el("section", "laolao-learning-radar");
      panel.append(el("div", "laolao-learning-radar__eyebrow", "最近需要巩固的题目"));
      panel.append(el("p", "laolao-learning-stage__lead", "按最近作答记录补练。做错后先找原因，再独立试一次；累计错误次数不代表你现在的水平。"));
      const attempts = result.attempts || [];
      if (!attempts.length) panel.append(el("p", "laolao-learning-radar__empty", "暂时没有待巩固的作答记录。可以继续学习，或做一道题看看掌握情况。"));
      for (const attempt of attempts) {
        const card = el("article", "laolao-learning-radar__wrong-item");
        card.append(el("strong", "", attempt.question || attempt.topic || "练习记录"));
        card.append(el("p", "laolao-learning-result__feedback", `你的答案：${attempt.answerText || (Array.isArray(attempt.answer) ? attempt.answer.join("、") : attempt.answer || "未填写")}`));
        const errorType = attempt.errorType || attempt.result?.errorType;
        const errorLabel = ({concept: "概念理解", method: "解题方法", reading: "审题", careless: "疏漏", memory: "记忆"})[errorType] || errorType;
        if (errorLabel) card.append(el("small", "", `先补这一点：${errorLabel}`));
        if (attempt.result?.feedback) card.append(el("p", "laolao-learning-result__feedback", attempt.result.feedback));
        appendQuestionSources(card, attempt.sources || []);
        const retry = el("button", "laolao-learning-button laolao-learning-button--primary", "独立重做这题"); retry.type = "button";
        retry.addEventListener("click", () => continueLearning({attemptId: attempt.id}, retry)); card.append(retry);
        appendGradeCorrection(card, attempt.id, attempt.result?.correct);
        panel.append(card);
      }
      const exit = el("button", "laolao-learning-button", "返回笔记"); exit.type = "button";
      exit.addEventListener("click", () => { state.radarMode = false; renderNotes(state.notes, state.noteData?.similar || []); }); panel.append(exit);
      list.replaceChildren(panel); list.scrollTop = 0;
    } catch (error) { if (currentSession() === sessionKey) showToast(error.message || "作答记录读取失败", true); }
  };

  const notebookDocument = notebook => {
    const article = el("article", "laolao-learning-manuscript");
    article.append(el("h3", "laolao-learning-manuscript__title", notebook.title));
    article.append(el("small", "laolao-learning-manuscript__count", `${notebook.sourceCount} 条原笔记 · 提炼为 ${notebook.pointCount} 个知识点`));
    if (notebook.stale) article.append(el("p", "laolao-learning-manuscript__stale", "原笔记有新增或修改，重新整理可更新这份稿子。"));
    for (const section of notebook.sections || []) {
      const topic = el("section", "laolao-learning-manuscript__topic");
      topic.append(el("h4", "", section.title));
      const points = el("ol");
      for (const point of section.points || []) {
        const item = el("li");
        item.append(el("p", "", point.text));
        if (point.example) item.append(el("p", "laolao-learning-manuscript__example", `例：${point.example}`));
        if (point.reminder) item.append(el("p", "laolao-learning-manuscript__reminder", `易错：${point.reminder}`));
        points.append(item);
      }
      topic.append(points); article.append(topic);
    }
    return article;
  };

  const manuscriptActions = notebook => {
    const actions = el("div", "laolao-learning-manuscript__actions");
    const copy = el("button", "laolao-learning-button", "复制整理稿"); copy.type = "button";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(notebook.text); showToast("整理稿已复制"); }
      catch { showToast("系统没有允许复制，请选择文字或导出整理稿", true); }
    });
    const download = el("button", "laolao-learning-button", "导出整理稿"); download.type = "button";
    download.addEventListener("click", () => {
      const url = URL.createObjectURL(new Blob([notebook.markdown], {type: "text/markdown;charset=utf-8"}));
      const link = el("a"); link.href = url; link.download = "Li An 学习笔记-整理稿.md";
      document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    });
    actions.append(copy, download); return actions;
  };

  const renderSavedManuscript = () => {
    const host = state.drawer?.querySelector(".laolao-learning-notes__manuscript");
    const list = state.drawer?.querySelector(".laolao-learning-notes__list");
    if (!host) return;
    const notebook = state.noteData?.organizedNotebook;
    const show = Boolean(notebook) && state.manuscriptMode !== "source" && !state.organizationPlan && !state.reviewQueue
      && !state.searchText && !state.selectedTags.size && !state.includeMerged && !state.radarMode && !state.packMode;
    host.hidden = !show;
    if (list) list.hidden = show || Boolean(state.organizationPlan?.notebook);
    host.replaceChildren();
    const toggle = state.drawer.querySelector(".laolao-learning-notes__manuscript-toggle");
    if (toggle) { toggle.hidden = !notebook; toggle.textContent = show ? "查看原笔记" : "查看整理稿"; }
    if (show) host.append(manuscriptActions(notebook), notebookDocument(notebook));
  };

  const renderOrganizationPreview = plan => {
    const host = state.drawer?.querySelector(".laolao-learning-notes__preview");
    if (!host) return;
    host.replaceChildren();
    if (!plan) { host.hidden = true; renderSavedManuscript(); return; }
    host.hidden = false;
    const panel = el("section", "laolao-learning-organize-preview");
    const header = el("header", "laolao-learning-organize-preview__header");
    header.append(el("strong", "", plan.notebook ? "抄写稿预览" : "整理预览"));
    const close = el("button", "", "×"); close.type = "button"; close.setAttribute("aria-label", "关闭整理预览"); close.addEventListener("click", () => { state.organizationPlan = null; renderOrganizationPreview(null); });
    header.append(close); panel.append(header);
    if (plan.notebook) panel.append(manuscriptActions(plan.notebook), notebookDocument(plan.notebook));
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
    if (!plan.operations?.length && !plan.notebook) panel.append(el("p", "laolao-learning-notes__empty", "Li An 没有找到可以执行的整理建议。原笔记保持不变。"));
    const actions = el("div", "laolao-learning-organize-preview__actions");
    const applyLabel = plan.notebook ? "保存整理稿" : "应用所选";
    const apply = el("button", "laolao-learning-button laolao-learning-button--primary", applyLabel); apply.type = "button"; apply.disabled = !checked.length && !plan.notebook;
    apply.addEventListener("click", async () => {
      const ids = checked.filter(input => input.checked).map(input => input.value);
      if (!ids.length && !plan.notebook) return showToast("请至少选择一项整理", true);
      setBusy(apply, true, "备份并应用…");
      try {
        const result = await request("pinkie.learning.notes.organize.apply", {sessionKey: notebookSession(), requestId: plan.id, operationIds: ids}, 20000);
        state.lastOrganizationBackupId = result.backupId;
        if (result.organizedNotebook) state.manuscriptMode = "organized";
        state.organizationPlan = null; renderOrganizationPreview(null);
        showUndoBar(result.organizedNotebook ? "整理稿已保存" : "整理已应用", "organize", result.backupId);
        await loadNotes();
      } catch (error) { setBusy(apply, false, applyLabel); showToast(error.message || "整理应用失败", true); }
    });
    const cancel = el("button", "laolao-learning-button", "取消"); cancel.type = "button";
    cancel.addEventListener("click", () => { state.organizationPlan = null; renderOrganizationPreview(null); });
    actions.append(apply, cancel); panel.append(actions); host.append(panel);
    renderSavedManuscript();
  };

  const requestDeepOrganization = async () => {
    if (state.organizationBusy) return;
    const sessionKey = notebookSession();
    const requestId = crypto.randomUUID ? crypto.randomUUID() : `organize-${Date.now()}`;
    state.organizationRequestId = requestId;
    state.organizationBusy = true;
    renderOrganizer(state.noteData?.organizer);
    const status = state.drawer?.querySelector(".laolao-learning-notes__status");
    if (status) status.textContent = "正在合并重复知识点、提炼重点，生成可直接抄写的笔记…";
    try {
      const result = await request("pinkie.learning.notes.list", {sessionKey, limit: 500});
      if (notebookSession() !== sessionKey || state.organizationRequestId !== requestId) return;
      state.organizationSourceNotes = (result.notes || []).filter(note => note.status !== "merged");
      const plan = await request("pinkie.learning.notes.organize.preview", {sessionKey, requestId}, 130000);
      if (notebookSession() !== sessionKey || state.organizationRequestId !== requestId) return;
      if (!plan.notebook) throw new Error("新版整理功能还未加载，请关闭后重新打开 App 再试。");
      state.organizationPlan = plan; renderOrganizationPreview(plan);
      if (status) status.textContent = `${plan.notebook.sourceCount} 条原笔记 → ${plan.notebook.pointCount} 个知识点 · 预览后保存`;
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
    // 雷达模式：列表由 openMistakesRadar 独占。必须先于 replaceChildren 返回，
    // 否则 loadNotes 迟到时会把已经渲染好的雷达整个清掉。
    if (state.radarMode || state.packMode) return;
    closeNoteMenu();
    list.replaceChildren();
    renderSavedManuscript();
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
      state.manuscriptMode = "";
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
      if (status) status.textContent = result.organizedNotebook && state.manuscriptMode !== "source"
        ? `${result.organizedNotebook.pointCount} 个知识点 · 整理稿与原笔记分别保存`
        : `${state.notes.length} 条 · 独立保存，删除聊天不影响笔记`;
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
      const result = await request("pinkie.learning.notes.review.queue", {sessionKey: notebookSession(), limit: 10});
      const due = result.notes || [];
      if (!due.length) return showToast("今天没有到期笔记");
      if (!state.remote?.enabled) {
        state.remote = await request("pinkie.learning.set", {sessionKey: currentSession(), enabled: true});
        state.revision = Number(state.remote?.revision) || state.revision;
      }
      closeNotebook();
      const payload = due.map(note => ({
        id: note.id, term: note.term || note.title || "", meaning: note.meaning || "",
        example: note.example || "", note: note.note || "", content: (note.content || "").slice(0, 1400),
        kind: note.kind || "note", compareItems: note.compareItems || [], sourceAnchor: note.sourceAnchor || null,
      }));
      await request("pinkie.learning.notes.quiz.prepare", {sessionKey: currentSession(), ids: payload.map(note => note.id)});
      await sendControl(`${BATCH_MARKER}\nnote_ids: ${JSON.stringify(payload.map(note => note.id))}\n请用 learning_activity present 的 items 数组出一组练习，每个 item 是独立可作答的小题，分别填写 note_ids、评分点和真实 sources。不要把多题塞进一个 question，也不要给整组统一判分。笔记：${JSON.stringify(payload)}`);
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
    const link = el("a"); link.href = url; link.download = "Li An 学习笔记-Anki.csv"; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };

  const revealMarkdown = () => {
    const file = state.noteData?.markdownPath;
    const reveal = window.__laolaoSidebar?.revealProject;
    if (!file || typeof reveal !== "function") return showToast("暂时无法打开 Finder", true);
    reveal(file);
  };

  // A drawer that always slid in from the window edge covered the other half of 双模式 and
  // looked like it belonged to the wrong side. Keep it inside the pane that opened it.
  const positionDrawer = () => {
    const drawer = state.drawer;
    const pane = paneElement();
    if (!drawer || !pane) return;
    const rect = pane.getBoundingClientRect();
    if (!rect.width) return;
    const width = Math.max(280, Math.min(390, rect.width - 24));
    drawer.style.position = "fixed";
    drawer.style.width = `${width}px`;
    drawer.style.right = "auto";
    drawer.style.left = `${Math.round(rect.right - width - 12)}px`;
    drawer.style.top = `${Math.round(Math.max(8, rect.top + 12))}px`;
    drawer.style.bottom = `${Math.round(Math.max(8, window.innerHeight - rect.bottom + 12))}px`;
  };

  const closeNotebook = () => {
    closeNoteMenu();
    state.drawer?.classList.remove("is-open");
    state.drawer?.setAttribute("aria-hidden", "true");
    if (state.drawer) state.drawer.inert = true;
  };

  // every pane keeps its own instance; opening one closes the others (one notebook on screen),
  // but each instance only ever touches its own drawer, stage and buttons.
  const closeSiblingNotebooks = () => {
    for (const instance of instances) {
      if (instance === my) continue;
      try { instance.closeNotebook(); } catch { /* sibling already torn down */ }
    }
  };

  function openNotebook() {
    // one notebook at a time across panes; the open one belongs to the pane that asked
    closeSiblingNotebooks();
    let drawer = state.drawer;
    if (!drawer?.isConnected) {
      drawer = el("aside", "laolao-learning-notes");
      drawer.setAttribute("aria-label", "学习笔记本");
      drawer.setAttribute("aria-hidden", "true");
      drawer.inert = true;
      const header = el("header", "laolao-learning-notes__header");
      header.append(el("div", "laolao-learning-notes__title", "Li An 学习笔记"));
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
      organize.title = "合并重复知识点，提炼重点，生成可直接抄写的整理稿";
      organize.dataset.notesOrganize = "1";
      const manuscriptToggle = el("button", "laolao-learning-button laolao-learning-notes__manuscript-toggle", "查看整理稿");
      manuscriptToggle.type = "button"; manuscriptToggle.hidden = true;
      manuscriptToggle.addEventListener("click", () => {
        const showingManuscript = !state.drawer.querySelector(".laolao-learning-notes__manuscript")?.hidden;
        state.manuscriptMode = showingManuscript ? "source" : "organized";
        if (state.manuscriptMode === "organized") {
          state.searchText = ""; state.selectedTags.clear(); state.includeMerged = false;
          state.reviewQueue = null; state.reviewFlipped = false; state.organizationPlan = null;
          const search = state.drawer.querySelector(".laolao-learning-notes__search"); if (search) search.value = "";
          renderOrganizationPreview(null);
        }
        void loadNotes();
      });
      const markdown = el("button", "laolao-learning-notes__icon-action", "Markdown"); markdown.type = "button"; markdown.addEventListener("click", revealMarkdown);
      const anki = el("button", "laolao-learning-notes__icon-action", "Anki CSV"); anki.type = "button"; anki.addEventListener("click", exportAnkiCsv);
      const tools = el("details", "laolao-learning-notes__tools");
      tools.append(el("summary", "", "更多 ···"));
      const toolPanel = el("div", "laolao-learning-notes__tools-panel");
      const exports = el("div", "laolao-learning-notes__exports");
      exports.append(el("span", "", "导出笔记"), markdown, anki);
      toolPanel.append(exports);
      tools.append(toolPanel);
      topActions.append(newButton, organize, manuscriptToggle, tools);

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
      reminder.append(el("span", "", "有 10 条以上笔记可以提炼成抄写稿"));
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
        state.manuscriptMode = "source";
        state.searchText = search.value.trim(); clearTimeout(searchTimer); searchTimer = setTimeout(loadNotes, 220);
      });
      const merged = el("button", "laolao-learning-notes__merged", "已合并"); merged.type = "button"; merged.addEventListener("click", () => { state.manuscriptMode = "source"; state.includeMerged = !state.includeMerged; loadNotes(); });
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
      const manuscript = el("div", "laolao-learning-notes__manuscript"); manuscript.hidden = true;
      const list = el("div", "laolao-learning-notes__list");
      const undo = el("div", "laolao-learning-notes__undo"); undo.hidden = true;
      contentWrap.append(topActions, reviewBar, compose, reminder, searchRow, tags, filters, status, preview, manuscript, list, undo);
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
    // the drawer stays anchored to the pane that opened it (side by side in 双模式)
    const owner = paneElement() || focusedPane();
    drawer.dataset.clePaneSession = paneSession(owner) || pageSessionKey(owner);
    positionDrawer();
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

  const poll = async () => {
    if (state.polling || !inLearningMode(state.pane)) return;
    const sessionKey = pageSessionKey();
    if (!sessionKey || document.hidden || state.disposed) return;
    const now = Date.now();
    if (state.lastPollSession === sessionKey && now - (state.lastPollAt || 0) < 1200) return;
    state.lastPollSession = sessionKey; state.lastPollAt = now;
    state.polling = true;
    try {
      const result = await request("pinkie.learning.current", {sessionKey}, 8000);
      if (state.disposed || pageSessionKey() !== sessionKey) return;
      if (state.drawer?.classList.contains("is-open") && state.notesSessionKey !== notebookSession()) void loadNotes();
      if (state.sessionKey !== sessionKey || state.revision !== Number(result?.revision)) {
        state.sessionKey = sessionKey;
        state.revision = Number(result?.revision) || 0;
        state.remote = result;
        renderStage(result);
      }
      syncButtons();
      // 每 30 秒顺带刷新一次今日复习数，让空态横幅和胶囊保持准确
      if (!state.dueFetchedAt || Date.now() - state.dueFetchedAt > 30_000) {
        state.dueFetchedAt = Date.now();
        refreshDueCount().then(() => { if (!state.disposed && pageSessionKey() === sessionKey && !state.remote?.current) renderStage(state.remote); });
      }
    } catch {
      // 网关启动或重连期间保持现有题卡，下一轮自动恢复，不闪空白。
    } finally { state.polling = false; }
  };

  const leaveLearningMode = () => {
    state.stage?.remove(); state.stage = null;
    state.toggle?.remove(); state.toggle = null;
    state.notebookButton?.remove(); state.notebookButton = null;
    state.toolsCapsule?.remove(); state.toolsCapsule = null; state.toolsDue = null;
    closeNotebook();
    state.selectionButton?.remove(); state.selectionButton = null;
    state.sessionKey = ""; state.revision = -1; state.remote = null; state.activityId = ""; state.answerDrafts = new Map();
  };

  const reconcile = () => {
    if (!inLearningMode(state.pane)) return leaveLearningMode();
    ensureButtons();
    if (state.remote?.enabled && !state.stage?.isConnected) renderStage(state.remote);
    hideControlMessages();
    poll();
  };

  const dispose = () => {
    if(state.disposed)return;state.disposed=true;
    leaveLearningMode();
    state.drawer?.remove(); state.drawer = null;
    window.clearInterval(tickTimer);
    window.removeEventListener("resize", placeNoteMenu);
    instances.delete(instance);
  };

  const tickTimer = window.setInterval(() => {
    if (!state.pane?.isConnected) { dispose(); return; }
    reconcile();
  }, 1200);

  window.addEventListener("resize", () => { placeNoteMenu(); if (state.drawer?.classList.contains("is-open")) positionDrawer(); });
  document.addEventListener("mousedown", event => {
    if (state.noteMenu && !event.target.closest?.(".laolao-learning-note__menu, .laolao-learning-note__more")) closeNoteMenu();
  }, true);

  const instance = {
    get pane() { return state.pane; },
    setPane(pane) { state.pane = pane; },
    reconcile,
    dispose,
    closeNotebook,
    reset() {
      state.sessionKey = ""; state.revision = -1; state.remote = null; state.dueFetchedAt = 0;
      state.stage?.remove(); state.stage = null;
      closeNotebook();
    },
    continueLearning(step) { return continueLearning(step); },
    refreshInline(id) { if(id===state.remote?.current?.id)renderStage(state.remote); },
    refreshNotes() {
      if (state.drawer?.classList.contains("is-open")) void loadNotes();
    },
    // the selection action belongs to the pane the selection came from
    saveSelection(text, label) {
      state.selectionText = text;
      state.selectionLabel = label;
      return saveSelection();
    },
    toast(message, error) { showToast(message, error); },
    accepts(pane) { return !pane || !state.pane || pane === state.pane; },
    // test seam: which session this side answers to
    get sessionKey() { return pageSessionKey(); },
  };
  instances.add(instance);
  return instance;
  }

  // ---- pane lifecycle -------------------------------------------------------
  // A controller is bound to one chat pane and follows that pane's session: when the pane
  // shows another session (history, new chat, cache swap), only that pane's controller
  // resets. Panes that disappear are disposed, so no timer or listener outlives them.
  const bootControllers = () => {
    const panes = Array.from(document.querySelectorAll("openclaw-chat-pane.chat-pane-cache__pane"));
    const live = new Set(panes);
    for (const instance of [...instances]) {
      if (!instance.pane || !live.has(instance.pane) || !instance.pane.isConnected) instance.dispose();
    }
    for (const pane of panes) {
      const boundSession = paneSession(pane);
      let instance = [...instances].find(item => item.pane === pane);
      if (!instance) {
        instance = createController();
        instance.setPane(pane);
        instance.lastSession = boundSession;
      } else if (instance.lastSession !== boundSession) {
        // the same pane now shows a different session: reset only this side
        instance.setPane(pane);
        instance.reset();
        instance.lastSession = boundSession;
      }
      if (!isLearningSession(boundSession)) { instance.reconcile(); continue; }
      instance.reconcile();
    }
    // no pane mounted yet (first paint): fall back to a page-scoped controller
    if (!panes.length && !instances.size) {
      const instance = createController();
      instances.add(instance);
      instance.reconcile();
    }
  };

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; bootControllers(); });
  };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ["class"]});
  window.addEventListener("pinkie:session-selected", schedule);
  window.addEventListener("pinkie:learning-continue",event=>{for(const instance of instances)if(instance.sessionKey===event.detail?.sessionKey)void instance.continueLearning(event.detail.step||{});});
  window.addEventListener("pinkie:learning-inline-mounted",event=>{for(const instance of instances)if(instance.sessionKey===event.detail?.sessionKey)instance.refreshInline(event.detail.id);});
  window.addEventListener("laolao:modechange", schedule);
  window.addEventListener("laolao:sessions-changed", () => {
    for (const instance of instances) instance.refreshNotes();
  });

  // ---- text selection: one registration for the page, routed to the pane that owns it ----
  // Registering this inside the controller would add one action per pane and let two panes
  // write the same note twice. The handler resolves the controller from the selected node.
  const controllersFor = () => [...instances].filter(instance => instance.pane);
  const controllerFor = node => {
    const pane = paneOf(node);
    const owner = pane ? controllersFor().find(instance => instance.pane === pane) : controllersFor().find(instance => instance.accepts(null));
    return owner || controllersFor()[0] || null;
  };
  window.__pinkieSelectionActions?.register('note', {
    order: 1,
    when: ({text, assistant, library}) => {
      const instance = controllerFor(assistant || library || document.body);
      if (!instance || !(isLearningSession(instance.sessionKey) || document.documentElement.getAttribute("data-cle-room") === "learning")) return false;
      return (!!assistant || !!library) && text.length >= 2;
    },
    create: () => el("button", "laolao-learning-selection-save", "记笔记"),
    run: selected => {
      const {text, assistant, library} = selected;
      if (library) { void window.__pinkieLibrary.saveSelection(selected).catch(error => showToast(error.message, true)); return; }
      const instance = controllerFor(assistant || document.body);
      if (!instance) return showToast("没有找到对应的学习会话", true);
      const label = assistant?.querySelector(".chat-sender-name")?.textContent?.trim() || "Li An 回答";
      void instance.saveSelection(text, label);
    },
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootControllers, {once: true});
  else bootControllers();
  window.__cleLearningControllers = instances;
})();
