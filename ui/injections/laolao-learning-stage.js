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
    selectionButton: null,
    selectionText: "",
    selectionLabel: "",
    polling: false,
    sessionLabels: new Map(),
  };

  const el = (tag, className, text) => {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  };
  // 学习台在时，关闭键走学习台唯一的图标出口（Lucide x）；不在时保留 ×。
  const xMark = button => { const mark = window.__pinkieStudyDesk?.icon?.("x", {size: "sm"}); if (mark) { button.textContent = ""; button.append(mark); } return button; };

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

  const showToast = (message, error = false, action = null) => {
    let toast = document.querySelector(".laolao-learning-toast");
    if (!toast) {
      toast = el("div", "laolao-learning-toast");
      toast.setAttribute("role", "status");
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.dataset.error = error ? "1" : "0";
    toast.classList.toggle("has-action", Boolean(action));
    // 带按钮的提示（例如「改记到生词本」）多停一会儿，按钮可点。
    if (action) {
      const go = el("button", "", action.label); go.type = "button";
      go.addEventListener("click", () => { toast.classList.remove("is-visible"); void action.run(); }, {once: true});
      toast.append(go);
    }
    toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), action ? 7000 : 2400);
  };

  const sendControl = async (message, sessionOverride = "") => {
    if(window.__pinkieStudyConversation?.active()&&(!sessionOverride||sessionOverride===window.__pinkieStudyConversation.sessionKey()))return window.__pinkieStudyConversation.send(message);
    const sessionKey = sessionOverride || (window.__pinkieStudyConversation?.active() ? window.__pinkieStudyConversation.sessionKey() : pageSessionKey());
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
  const selectedAnswer = stage => {
    const current = activeItem();
    if (!current) return "";
    const selected = Array.from(stage.querySelectorAll('input[data-learning-answer="1"]')).filter(input => input.checked).map(input => input.value);
    if (current.kind === "multiple_choice") return selected;
    if (current.kind === "single_choice") return selected[0] || "";
    return stage.querySelector(".laolao-learning-stage__answer")?.value.trim() || "";
  };
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
    const nativeStop = document.querySelector(".chat-send-btn--stop");
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
    if(step.attemptId&&window.__pinkieStudyConversation?.active())return window.__pinkieStudyConversation.retry(step.attemptId);
    const sessionKey = pageSessionKey();
    if (step.sessionKey && step.sessionKey !== sessionKey) { showToast("这一步属于另一个学习会话，请先切换到对应会话。", true); return; }
    setBusy(button, true, "准备中…");
    try {
      if (step.kind === "review") { await startReview(); return; }
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

  const syncButtons = () => {
    const enabled = state.remote ? Boolean(state.remote.enabled) : true;
    if (state.toggle) {
      state.toggle.classList.toggle("is-active", enabled);
      state.toggle.setAttribute("aria-pressed", String(enabled));
      state.toggle.textContent = enabled ? "互动中" : "互动已关";
      state.toggle.title = enabled ? "碧琪会在讲解时直接在消息里放题卡、图表和实验；点一下关闭" : "已关闭互动：碧琪只用文字讲解；点一下重新打开";
      state.toggle.disabled = false;
    }
    if (state.toolsDue) {
      const due = Number(state.dueCount) || 0;
      state.toolsDue.textContent = due > 0 ? `今日复习 ${due}` : "今日复习";
      state.toolsDue.classList.toggle("is-due", due > 0);
    }
  };

  const refreshDueCount = async () => {
    try {
      const result = await request("pinkie.learning.notes.list", {sessionKey: notebookSession(), limit: 1}, 15000);
      state.dueCount = Number(result?.dueCount) || 0;
      syncButtons();
    } catch { /* 静默：复习计数失败不影响聊天 */ }
  };

  const ensureButtons = () => {
    const actions = document.querySelector(".agent-chat__composer-actions");
    if (!actions) return;
    // Components are part of the assistant's output. No switch or lab launcher
    // is needed to make them available. Retain the existing notebook shortcut.
    actions.querySelectorAll('.laolao-learning-toggle,.laolao-learning-tools').forEach(n => n.remove());
    state.toggle = null; state.toolsCapsule = null; state.toolsDue = null;
    if (!state.notebookButton?.isConnected) {
      const button = el("button", "laolao-learning-notebook-button", "笔记");
      button.type = "button";
      button.title = "打开学习台的笔记本";
      button.addEventListener("click", openDeskNotebook);
      actions.prepend(button);
      state.notebookButton = button;
    }
    syncButtons();
  };

  const currentSession = () => window.__pinkieStudyConversation?.active() ? window.__pinkieStudyConversation.sessionKey() : pageSessionKey();
  const notebookSession = () => "agent:learning:notes-library";
  const closeNotebook = () => { document.querySelector(".laolao-learning-notes")?.remove(); };
  const openNotebook = (options = {}) => {
    const desk = window.__pinkieStudyDesk;
    if (desk?.go && document.getElementById("pinkie-study-desk")) { desk.go("notes", options); return; }
    showToast("笔记本正在加载，稍后再点一次", true);
  };
  const startReview = () => openNotebook({view: "review"});
  const startSingleNoteQuiz = async note => {
    try {
      if (!state.remote?.enabled || state.remote.sessionKey !== currentSession()) {
        state.remote = await request("pinkie.learning.set", {sessionKey: currentSession(), enabled: true});
        state.revision = Number(state.remote?.revision) || state.revision;
      }
      closeNotebook();
      const questionNote = {id: note.id, term: note.term || note.title || "", meaning: note.meaning || "", example: note.example || "", content: note.content || "", sourceAnchor: note.sourceAnchor || null};
      await request("pinkie.learning.notes.quiz.prepare", {sessionKey: currentSession(), ids: [note.id]});
      await sendControl(`${START_MARKER}\n请围绕这条笔记调用 learning_activity present 出一道理解题，并将 note_ids 设为 JSON 中的 id。笔记：${JSON.stringify(questionNote)}`);
    } catch (error) { showToast(error.message || "出题失败", true); }
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
      } catch (error) { if (currentSession() === sessionKey) showToast(error.message || "纠正没有保存", true); }
      finally { if (currentSession() === sessionKey) setBusy(save, false, "保存纠正"); }
    });
    details.append(reason, save); root.append(details);
  };

  const saveSelection = async () => {
    const text = state.selectionText;
    state.selectionButton?.remove(); state.selectionButton = null;
    if (!text) return;
    try {
      const result = await request("pinkie.learning.notes.save", {sessionKey: pageSessionKey(), content: text, sourceLabel: state.selectionLabel || "聊天摘录", sourceSessionLabel: state.sessionLabels.get(pageSessionKey()) || ""});
      // 后端判断这其实只是单词或短语：一键改记到生词本，笔记归档、可撤销。
      if (result?.looksLikeVocab && result.note?.id) showToast(`已记进笔记本 · 这像是一个${result.vocabKind || "短语"}`, false, {label: "改记到生词本", run: () => moveSavedNote(result.note.id)});
      else showToast("已记进笔记本");
    } catch (error) { showToast(error.message || "笔记保存失败", true); }
  };

  const moveSavedNote = async id => {
    try {
      const moved = await request("pinkie.learning.vocab.fromNotes.apply", {sessionKey: notebookSession(), noteIds: [id]});
      showToast(`已搬进生词本 ${moved.wordCount} 个词 · 碧琪正在整理音标和搭配`, false, {label: "撤销", run: async () => {
        try { await request("pinkie.learning.vocab.fromNotes.undo", {sessionKey: notebookSession(), backupId: moved.backupId}); showToast("已撤销，笔记放回笔记本"); }
        catch (error) { showToast(error.message || "撤销失败", true); }
      }});
    } catch (error) { showToast(error.message || "搬进生词本失败", true); }
  };

  // 聊天里的笔记入口只进入已验收的整页笔记本。
  const openDeskNotebook = () => {
    const desk = window.__pinkieStudyDesk;
    if (desk?.go && document.getElementById("pinkie-study-desk")) { desk.go("notes"); return; }
    openNotebook();
  };

  // 笔记本的单条与按节出题沿用同一份学习题卡协议。
  const quizNotes = async notes => {
    const list = [...new Map((Array.isArray(notes) ? notes : []).filter(note => note?.id).map(note => [note.id, note])).values()].slice(0, 10);
    if (!list.length) throw new Error("没有可出题的笔记");
    if (list.length === 1) return startSingleNoteQuiz(list[0]);
    if (!state.remote?.enabled || state.remote.sessionKey !== currentSession()) {
      state.remote = await request("pinkie.learning.set", {sessionKey: currentSession(), enabled: true});
      state.revision = Number(state.remote?.revision) || state.revision;
    }
    closeNotebook();
    const payload = list.map(note => ({
      id: note.id, term: note.term || note.title || "", meaning: note.meaning || "",
      example: note.example || "", note: note.note || "", content: (note.content || ""),
      kind: note.kind || "note", compareItems: note.compareItems || [], sourceAnchor: note.sourceAnchor || null,
    }));
    await request("pinkie.learning.notes.quiz.prepare", {sessionKey: currentSession(), ids: payload.map(note => note.id)});
    await sendControl(`${BATCH_MARKER}\nnote_ids: ${JSON.stringify(payload.map(note => note.id))}\n请用 learning_activity present 的 items 数组出一组练习，每个 item 是独立可作答的小题，分别填写 note_ids、评分点和真实 sources。不要把多题塞进一个 question，也不要给整组统一判分。笔记：${JSON.stringify(payload)}`);
  };

  window.__pinkieSelectionActions?.register('note', {
    order: 1,
    when: ({text, assistant, library}) => inLearningMode() && (!!assistant || !!library) && text.length >= 2,
    create: () => el("button", "laolao-learning-selection-save", "记笔记"),
    run: selected => {
      const {text, assistant, library} = selected;
      if (assistant && window.__pinkieDeskChat?.active?.() && window.__pinkieDeskChat?.collectSelection) { void window.__pinkieDeskChat.collectSelection(selected, "note").catch(() => {}); return; }
      if (library) { void window.__pinkieLibrary.saveSelection(selected).catch(error => showToast(error.message, true)); return; }
      state.selectionText = text;
      state.selectionLabel = assistant?.querySelector(".chat-sender-name")?.textContent?.trim() || "碧琪回答";
      void saveSelection();
    },
  });

  const poll = async () => {
    if (state.polling || !inLearningMode()) return;
    const sessionKey = pageSessionKey();
    if (!sessionKey || document.hidden || state.disposed) return;
    const now = Date.now();
    if (state.lastPollSession === sessionKey && now - (state.lastPollAt || 0) < 1200) return;
    state.lastPollSession = sessionKey; state.lastPollAt = now;
    state.polling = true;
    try {
      const result = await request("pinkie.learning.current", {sessionKey}, 8000);
      if (state.disposed || pageSessionKey() !== sessionKey) return;
      if (state.sessionKey !== sessionKey || state.revision !== Number(result?.revision)) {
        state.sessionKey = sessionKey;
        state.revision = Number(result?.revision) || 0;
        state.remote = result;
        renderStage(result);
      }
      syncButtons();
      // Keep notebook review counts current without adding UI above the composer.
      if (!state.dueFetchedAt || Date.now() - state.dueFetchedAt > 30_000) {
        state.dueFetchedAt = Date.now();
        void refreshDueCount();
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
    if (!inLearningMode()) return leaveLearningMode();
    ensureButtons();
    if (state.remote?.enabled && state.remote?.current && !state.stage?.isConnected) renderStage(state.remote);
    hideControlMessages();
    poll();
  };

  let lastHref = location.href, reconcileTimer = 0, chatObserver = null;
  const queueReconcile = () => {
    if (document.hidden || reconcileTimer) return;
    reconcileTimer = setTimeout(() => {
      reconcileTimer = 0;
      if (location.href !== lastHref) { lastHref = location.href; state.sessionKey = ""; state.revision = -1; state.remote = null; state.stage?.remove(); state.stage = null; }
      reconcile();
    }, Math.max(80, 1200 - (Date.now() - (state.lastPollAt || 0))));
  };
  const observeChat = () => {
    if (typeof MutationObserver !== "function" || !document.body || chatObserver) return;
    chatObserver = new MutationObserver(records => {
      if (records.some(record => (record.target.nodeType === 1 ? record.target : record.target.parentElement)?.closest?.('.chat-thread,.agent-chat__messages,.chat-messages'))) queueReconcile();
    });
    chatObserver.observe(document.body, {childList:true,characterData:true,subtree:true});
  };
  document.addEventListener("visibilitychange", () => { if (document.hidden) { clearTimeout(reconcileTimer); reconcileTimer = 0; } else queueReconcile(); });
  window.addEventListener("popstate", queueReconcile);
  window.addEventListener("pinkie:learning-state", event => { if (event.detail !== state.remote) queueReconcile(); });
  window.addEventListener("pagehide", () => { clearTimeout(reconcileTimer); reconcileTimer = 0; chatObserver?.disconnect(); chatObserver = null; });
  window.addEventListener("pageshow", () => { observeChat(); queueReconcile(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observeChat, {once:true}); else observeChat();
  window.addEventListener("pinkie:learning-continue", event => {
    if (event.detail?.sessionKey === pageSessionKey()) void continueLearning(event.detail?.step || {});
  });
  window.addEventListener("pinkie:learning-inline-mounted", event => {
    if (event.detail?.sessionKey === pageSessionKey() && event.detail?.id === state.remote?.current?.id) renderStage(state.remote);
  });
  window.addEventListener("pinkie:session-selected", reconcile);
  window.addEventListener("laolao:modechange", reconcile);
  window.addEventListener("pinkie:library-note-saved", () => { void refreshDueCount(); });

  // Compatibility entry points point at the full-page notebook; no legacy drawer is constructed.
  window.__pinkieLearningNotes = {open: openNotebook, close: closeNotebook, quiz: quizNotes, retry: continueLearning, correction: appendGradeCorrection};
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", reconcile, {once: true});
  else reconcile();
})();
