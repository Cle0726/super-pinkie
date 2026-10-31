(() => {
  'use strict';
  if (window.__pinkieLearningInline) return;
  const SLOT = '[data-pinkie-learning-slot]';
  const practiceKinds=['c_program','circuit_lab','network_lab','math_check','english_reading','english_writing','mock_exam','review_queue'];
  const kinds = new Set(['quiz', 'function_plot', 'process_flow', 'sentence_parse', 'mapreduce_lab',...practiceKinds]);
  const ROLES = {subject: '主语', predicate: '谓语', object: '宾语', complement: '表语/补语', clause: '从句', modifier: '修饰成分', linker: '连接成分'};
  const mergeState = (previous, next) => {
    if (next.input !== undefined && next.input !== previous.input) {
      previous = {...previous, assignments: {}};
      delete previous.demonstrate;
    }
    const merged = {...previous, ...next};
    for (const key of ['values', 'labels', 'assignments','parameters','answers','flags']) if (previous?.[key] && next?.[key]) merged[key] = {...previous[key], ...next[key]};
    return merged;
  };
  const roots = new Map(), views = new Set(), pendingRoots = new Set(), patched = new WeakSet();
  const elements = new WeakMap();
  const reads = new Map(), sessionRevisions = new Map();
  let queued = false;
  const node = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = String(text);
    return el;
  };
  const button = (label, fn, className = '') => {
    const el = node('button', `pinkie-il-button ${className}`, label);
    el.type = 'button'; el.addEventListener('click', fn); return el;
  };
  const call = (method, params) => {
    const request = window.__laolaoSidebar?.gwRequest;
    return typeof request === 'function' ? request(method, params, 16000)
      : Promise.reject(new Error('学习服务正在连接，请稍后重试'));
  };
  const get = ref => {
    const key = `${ref.sessionKey}:${ref.kind}:${ref.id}`;
    if (!reads.has(key)) {
      const request = Promise.resolve().then(() => call('pinkie.learning.inline.get', ref)).finally(() => reads.delete(key));
      reads.set(key, request);
    }
    return reads.get(key);
  };
  const copy = data => JSON.parse(JSON.stringify(data));
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `il-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const preserve = (element, fn) => {
    const pane = element.closest('openclaw-chat-pane');
    return pane && typeof window.__pinkieChatViewport?.preserve === 'function'
      ? window.__pinkieChatViewport.preserve(pane, fn) : fn();
  };
  const ownerSession = slot => slot.pinkieLearningSession
    || slot.closest('openclaw-chat-pane')?.state?.sessionKey
    || slot.closest('openclaw-chat-pane')?.sessionKey
    || slot.closest('[data-session-key]')?.dataset.sessionKey
    || new URL(location.href).searchParams.get('session') || '';
  const validRef = ref => ref?.v === 1 && kinds.has(ref.kind) && typeof ref.id === 'string'
    && ref.id.length > 0 && ref.id.length <= 160 && /^agent:learning:[^\r\n]{1,480}$/.test(ref.sessionKey || '');

  function rawRefs(group) {
    const rows = Array.isArray(group) ? group : Array.isArray(group?.groups) ? group.groups : [group];
    const messages = rows.flatMap(row => row?.messages || []).map(entry => entry.message || entry);
    const names = new Map(), result = [];
    for (const message of messages) for (const part of Array.isArray(message.content) ? message.content : []) {
      if (/^tool[_-]?(call|use)$/i.test(part?.type || '')) names.set(part.id || part.callId || part.toolCallId, part.name);
    }
    const add = value => {
      if (typeof value !== 'string' || value.length > 500000) return;
      try {
        let data = JSON.parse(value);
        if (!data?.inline && data?.details?.inline) data = data.details;
        if (!data?.inline && Array.isArray(data?.content)) data = JSON.parse(data.content.find(p => p?.type === 'text')?.text || 'null');
        if (validRef(data?.inline)) result.push(data.inline);
      } catch { /* Ordinary tool output is not an interactive component. */ }
    };
    for (const message of messages) {
      if (String(message.toolName || message.name || '').split('.').at(-1) === 'learning_activity'
        && /^(tool|toolresult|tool_result)$/i.test(message.role || '') && !message.isError) {
        add(typeof message.content === 'string' ? message.content : (message.content || []).filter(p => p?.type === 'text').map(p => p.text || '').join(''));
      }
      for (const part of Array.isArray(message.content) ? message.content : []) {
        if (!/^tool[_-]?result$/i.test(part?.type || '') || part.isError) continue;
        const name = part.name || names.get(part.callId || part.toolCallId || part.tool_use_id);
        if (String(name || '').split('.').at(-1) !== 'learning_activity') continue;
        add(part.text ?? part.output ?? (Array.isArray(part.content) ? part.content.filter(p => p?.type === 'text').map(p => p.text || '').join('') : part.content));
      }
    }
    return result;
  }

  class View {
    constructor(ref, slot) {
      this.ref = ref; this.slot = slot; this.expanded = true; this.visible = false; this.generation = 0;
      this.pending = new Map(); this.drafts = new Map(); this.explaining = new Set();
      this.element = node('section', 'pinkie-learning-inline');
      this.element.dataset.pinkieLearningId = ref.id;
      this.element.dataset.pinkieLearningSession = ref.sessionKey;
      this.title = node('strong', 'pinkie-il-title', ref.title || '互动学习');
      this.toggle = button('收起', () => this.setExpanded(!this.expanded), 'pinkie-il-quiet');
      this.toggle.setAttribute('aria-expanded', 'true');
      const head = node('header', 'pinkie-il-header'); head.append(this.title, this.toggle);
      this.body = node('div', 'pinkie-il-body'); this.body.style.minHeight = '120px';
      this.body.append(node('p', 'pinkie-il-placeholder', '正在准备交互内容…'));
      this.status = node('div', 'pinkie-il-status'); this.status.setAttribute('role', 'status');
      this.element.append(head, this.body, this.status);
      views.add(this); elements.set(this.element, this); slot.append(this.element);
      if (intersection) intersection.observe(this.element); else this.setVisible(true);
      window.dispatchEvent(new CustomEvent('pinkie:learning-inline-mounted', {detail: ref}));
    }
    say(text, error = false) {
      if (this.disposed) return;
      this.status.replaceChildren(node('span', '', text)); this.status.dataset.error = error ? '1' : '0';
      if (error) this.status.append(button('重试保存', () => { void this.flush(); }, 'pinkie-il-quiet'));
    }
    setVisible(visible) {
      if (this.visible === visible) return;
      this.visible = visible;
      if (visible && this.expanded) void this.load();
      else this.unload();
    }
    setExpanded(expanded) {
      this.expanded = expanded;
      preserve(this.element, () => {
        this.toggle.textContent = expanded ? '收起' : '展开';
        this.toggle.setAttribute('aria-expanded', String(expanded));
        this.body.hidden = !expanded;
        if (expanded && this.visible) void this.load(); else this.unload();
      });
    }
    async load(force = false) {
      if (this.disposed || !this.expanded || !this.visible || this.loading || this.loaded && !force) return;
      this.loading = true;
      const generation = ++this.generation;
      try {
        const data = await get(this.ref);
        if (this.disposed || generation !== this.generation || !this.expanded || !this.visible) return;
        this.data = copy(data); this.loaded = true;
        this.draftRevision = data.drafts?.revision || 0;
        for (const [id, draft] of Object.entries(data.drafts?.items || {})) if (!this.pending.has(id) && this.writingKey !== id) this.drafts.set(id, {...draft});
        preserve(this.element, () => {
          this.body.style.minHeight = '';
          this.renderContent();
        });
      } catch (error) {
        if (this.disposed || generation !== this.generation) return;
        this.body.replaceChildren(node('p', 'pinkie-il-error', error.message || '暂时无法读取这条交互内容'),
          button('重新加载', () => { void this.load(true); }));
      } finally { if (generation === this.generation) this.loading = false; }
    }
    cleanupDrawing() {
      window.__pinkieLearningPractice?.cleanup(this);
      this.resize?.disconnect(); this.resize = null;
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0; this.draw = null;
    }
    unload() {
      if (this.disposed) return;
      void this.flush();
      this.cleanupDrawing();
      const height = this.body.getBoundingClientRect().height;
      this.generation++; this.loading = false; this.loaded = false;
      if (this.expanded && height) this.body.style.minHeight = `${Math.ceil(height)}px`;
      this.body.replaceChildren(node('p', 'pinkie-il-placeholder', '交互内容已暂停，回到这里继续'));
    }
    dispose() {
      if (this.disposed) return;
      void this.flush(); clearTimeout(this.saveTimer); this.cleanupDrawing();
      this.disposed = true; this.generation++;
      intersection?.unobserve(this.element); views.delete(this);
    }
    enqueue(key, payload) {
      const previous = this.pending.get(key);
      if (payload.state && previous?.state) payload = {...payload, state: mergeState(previous.state, payload.state)};
      this.pending.set(key, payload); this.say('正在保存…');
      clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => { void this.flush(); }, 220);
    }
    async writeOne(payload, retry = true) {
      const quiz = this.ref.kind === 'quiz';
      try {
        const result = await call(quiz ? 'pinkie.learning.inline.draft' : 'pinkie.learning.inline.save', {
          sessionKey: this.ref.sessionKey, id: this.ref.id,
          revision: quiz ? this.draftRevision : this.data.visual.revision, ...payload,
        });
        if (quiz) this.draftRevision = result.drafts.revision;
        else {
          const local = this.data.visual.state;
          this.data.visual = result.visual;
          // Inputs queued during the request keep their latest local value.
          for (const next of this.pending.values()) {
            if (next.state) this.data.visual.state = mergeState(this.data.visual.state, next.state);
          }
          if (this.draw && JSON.stringify(local) !== JSON.stringify(this.data.visual.state)) this.draw();
        }
        return result;
      } catch (error) {
        if (retry && /已更新/.test(error.message || '')) {
          const fresh = await get(this.ref);
          if (quiz) this.draftRevision = fresh.drafts.revision;
          else this.data.visual.revision = fresh.visual.revision;
          return this.writeOne(payload, false);
        }
        throw error;
      }
    }
    flush() {
      clearTimeout(this.saveTimer);
      if (this.saving) return this.saving;
      if (!this.pending.size || !this.data) return Promise.resolve(true);
      this.saving = (async () => {
        while (this.pending.size) {
          const [key, payload] = this.pending.entries().next().value; this.pending.delete(key); this.writingKey = key;
          try { await this.writeOne(payload); }
          catch (error) {
            if (!this.pending.has(key)) this.pending.set(key, payload);
            this.say(`尚未保存：${error.message || '连接暂时中断'}`, true); return false;
          } finally { this.writingKey = null; }
        }
        this.say('已保存'); return true;
      })().finally(() => { this.saving = null; });
      return this.saving;
    }
    draft(item) {
      if (!this.drafts.has(item.id)) this.drafts.set(item.id, {answer: item.kind === 'multiple_choice' ? [] : '', confidence: null, hintUsed: false});
      return this.drafts.get(item.id);
    }
    saveDraft(item) { this.enqueue(item.id, {itemId: item.id, ...copy(this.draft(item))}); }
    renderContent() {
      if (this.ref.kind === 'quiz') return this.renderQuiz();
      if(practiceKinds.includes(this.ref.kind)) {
        this.cleanupDrawing();this.body.replaceChildren();
        if(window.__pinkieLearningPractice)window.__pinkieLearningPractice.render(this,{node,button,call,preserve,uid,mergeState});
        else this.body.append(node('p','pinkie-il-error','练习组件正在加载，请重新展开'));
        return;
      }
      if (this.ref.kind === 'function_plot') this.renderPlot();
      else if (this.ref.kind === 'process_flow') this.renderFlow();
      else if (this.ref.kind === 'sentence_parse') this.renderSentence();
      else this.renderMapReduce();
      this.renderSources(this.data.visual.sources || []);
    }
    renderSources(sources) {
      if (!sources.length) return;
      const area = node('div', 'pinkie-il-source');
      for (const source of sources) {
        const text = [source.title, source.label || (source.location ? `第${source.location}页` : '')].filter(Boolean).join(' · ') || '查看原文';
        if (!source.bookId) { area.append(node('span', '', text)); continue; }
        const jump = button(`${text} ↗`, async () => {
          jump.disabled = true;
          try {
            if (!window.__pinkieLibrary?.open) throw new Error('资料库正在准备，请稍后重试');
            await window.__pinkieLibrary.open(source.bookId, {location: source.location, quote: source.quote || ''});
          } catch (error) { this.say(error.message || '暂时无法打开原文'); }
          finally { jump.disabled = false; }
        }, 'pinkie-il-quiet'); jump.setAttribute('aria-label', `打开原文：${text}`); area.append(jump);
      }
      this.body.append(area);
    }
    renderQuiz() {
      this.cleanupDrawing(); this.body.replaceChildren();
      const activity = this.data.activity;
      const items = activity.kind === 'batch' ? activity.items : [activity];
      const sequential = activity.presentation === 'step_solution';
      const unlocked = index => !sequential || items.slice(0, index).every(step => typeof step.result?.correct === 'boolean');
      const item = items.find((item, index) => item.id === this.activeItem && unlocked(index))
        || items.find((item, index) => !item.submission && unlocked(index)) || items.find((item, index) => unlocked(index) && typeof item.result?.correct !== 'boolean') || items[0];
      if (!item) return;
      this.activeItem = item.id;
      if (sequential) {
        this.body.append(node('div', 'pinkie-il-source', `第${items.indexOf(item) + 1} / ${items.length}步 · 先尝试，再核对`));
        if (activity.question !== '分题复习' && activity.question !== item.question) this.body.append(node('p', 'pinkie-il-problem', activity.question));
      }
      if (items.length > 1) {
        const tabs = node('nav', 'pinkie-il-items'); tabs.setAttribute('aria-label', '题组进度');
        for (const [index, entry] of items.entries()) {
          const tab = button(`${index + 1}${entry.result ? entry.result.correct === true ? ' ✓' : ' ·' : ''}`, () => {
            this.activeItem = entry.id; preserve(this.element, () => this.renderQuiz());
          });
          tab.setAttribute('aria-current', String(entry.id === item.id));
          tab.disabled = !unlocked(index);
          tab.setAttribute('aria-label', `第${index + 1}题，${entry.submission ? '已作答' : '未作答'}`); tabs.append(tab);
        }
        this.body.append(tabs);
      }
      this.body.append(node('h3', 'pinkie-il-question', item.question));
      this.renderSources(item.sources?.length ? item.sources : activity.sources || []);
      if (!item.submission && !this.data.readOnly) {
        const draft = this.draft(item);
        const answers = node('fieldset', 'pinkie-il-answers');
        const legend = node('legend', 'pinkie-il-sr-only', '你的答案'); answers.append(legend);
        if (['single_choice', 'multiple_choice'].includes(item.kind)) {
          for (const option of item.options || []) {
            const label = node('label', 'pinkie-il-choice'), input = node('input');
            input.type = item.kind === 'multiple_choice' ? 'checkbox' : 'radio';
            input.name = `${this.elementId || (this.elementId = uid())}-${item.id}`; input.value = option.id;
            input.checked = Array.isArray(draft.answer) ? draft.answer.includes(option.id) : draft.answer === option.id;
            input.addEventListener('change', () => {
              draft.answer = item.kind === 'multiple_choice' ? Array.from(answers.querySelectorAll('input:checked')).map(input => input.value) : option.id;
              this.saveDraft(item);
            });
            label.append(input, node('span', '', `${option.id}. ${option.label}`)); answers.append(label);
          }
        } else {
          const input = node('textarea', 'pinkie-il-answer'); input.rows = item.kind === 'short_answer' ? 3 : 2;
          input.value = typeof draft.answer === 'string' ? draft.answer : ''; input.setAttribute('aria-label', '你的答案');
          input.placeholder = item.kind === 'fill_blank' ? '填写答案' : '用自己的话回答';
          input.addEventListener('input', () => { draft.answer = input.value; this.saveDraft(item); }); answers.append(input);
        }
        this.body.append(answers);
        if (item.hint) {
          const hint = node('details', 'pinkie-il-hint'); hint.open = draft.hintUsed;
          hint.append(node('summary', '', '给一点提示'), node('p', '', item.hint));
          hint.addEventListener('toggle', () => { if (hint.open && !draft.hintUsed) { draft.hintUsed = true; this.saveDraft(item); } });
          this.body.append(hint);
        }
        const confidence = node('div', 'pinkie-il-confidence'); confidence.setAttribute('role', 'group'); confidence.setAttribute('aria-label', '作答把握度，可选');
        for (const [value, label] of [[25, '没把握'], [60, '有点把握'], [90, '很确定']]) {
          const choice = button(label, () => {
            draft.confidence = draft.confidence === value ? null : value;
            for (const input of confidence.querySelectorAll('button')) input.setAttribute('aria-pressed', String(Number(input.dataset.confidence) === draft.confidence));
            this.saveDraft(item);
          }, 'pinkie-il-quiet'); choice.dataset.confidence = value; choice.setAttribute('aria-pressed', String(draft.confidence === value)); confidence.append(choice);
        }
        const submit = button('提交答案', () => { void this.submit(item, submit); }, 'pinkie-il-primary');
        const actions = node('div', 'pinkie-il-actions'); actions.append(confidence, submit); this.body.append(actions);
      } else {
        const answer = item.submission?.answer ?? this.draft(item).answer;
        const formatted = (Array.isArray(answer) ? answer : [answer]).map(value => {
          const option = item.options?.find(option => option.id === value); return option ? `${option.id}. ${option.label}` : value;
        }).filter(Boolean).join('；');
        this.body.append(node('p', 'pinkie-il-submitted', formatted ? `你的答案：${formatted}` : '这道题当时未提交答案'));
        if (item.result) {
          const result = item.result, verdict = node('div', 'pinkie-il-verdict', result.correct === true ? '✓ 回答正确' : result.correct === false ? '继续巩固这个知识点' : '掌握情况待确认');
          verdict.dataset.correct = String(result.correct); this.body.append(verdict);
          if (result.feedback) this.body.append(node('p', '', result.feedback));
          if (result.comparison?.length) {
            const comparison = node('div', 'pinkie-il-comparison'); comparison.append(node('strong', '', '错因对照'));
            for (const entry of result.comparison) {
              const row = node('div', 'pinkie-il-comparison-row');
              if (entry.quote) row.append(node('blockquote', '', `你的回答：“${entry.quote}”`));
              if (entry.expected) row.append(node('p', '', `正确思路：${entry.expected}`));
              if (entry.reason) row.append(node('p', 'pinkie-il-source', entry.reason));
              comparison.append(row);
            }
            this.body.append(comparison);
          }
          if (result.explanation) {
            const detail = node('details', 'pinkie-il-explanation'); detail.append(node('summary', '', '查看讲解'), node('p', '', result.explanation)); this.body.append(detail);
          }
          if (result.keyPoint) {
            this.body.append(node('p', 'pinkie-il-keypoint', result.keyPoint));
            const save = button('存入学习笔记', async () => {
              save.disabled = true;
              try {
                await call('pinkie.learning.notes.save', {sessionKey: this.ref.sessionKey,
                  title: item.topic || activity.topic || '练习要点', content: result.keyPoint,
                  sourceLabel: '互动题卡', sourceAnchor: (item.sources || activity.sources || []).find(source => source.bookId && source.location != null)});
                save.textContent = '已存入笔记';
              } catch (error) { save.disabled = false; this.say(error.message || '暂时无法保存笔记'); }
            }); this.body.append(save);
          }
          const attemptId = item.submission?.attemptId || result.attemptId;
          if (attemptId) {
            const correction = node('details', 'pinkie-il-explanation'); correction.append(node('summary', '', '评分有误？'));
            const reason = node('textarea', 'pinkie-il-answer'); reason.rows = 2; reason.placeholder = '写一下核对依据'; reason.setAttribute('aria-label', '纠正评分的依据');
            const correct = button(result.correct === true ? '改为回答错误' : '改为回答正确', async () => {
              if (!reason.value.trim()) { this.say('先填写更正依据'); reason.focus(); return; }
              correct.disabled = true;
              try {
                await call('pinkie.learning.attempts.correct', {sessionKey: this.ref.sessionKey, id: attemptId, correct: result.correct !== true, reason: reason.value});
                await this.load(true); this.say('评分已更正');
              } catch (error) { correct.disabled = false; this.say(error.message || '暂时无法更正评分'); }
            }); correction.append(reason, correct); this.body.append(correction);
          }
        } else if (item.submission) {
          const correctness = item.submission.correctness;
          this.body.append(node('p', 'pinkie-il-verdict', correctness === true ? '✓ 答案正确，讲解正在准备' : correctness === false ? '答案还不对，讲解正在准备' : '答案已保存，等待讲解'));
          if (!this.data.readOnly) this.body.append(button('请求讲解', () => { void this.explain(activity, item); }));
        }
        if (this.data.readOnly) this.body.append(node('div', 'pinkie-il-source', '历史练习 · 作答记录已保留'));
        else if (item.result && (!sequential || typeof item.result.correct === 'boolean')) {
          const next = items.find(entry => !entry.submission && entry.id !== item.id);
          const action = button(next ? sequential ? '继续下一步' : '下一题' : '再练一道', async () => {
            if (next) { this.activeItem = next.id; preserve(this.element, () => this.renderQuiz()); return; }
            action.disabled = true;
            try {
              await call('chat.send', {sessionKey: this.ref.sessionKey, idempotencyKey: uid(),
                message: `[[CLEKK_LEARNING_NEXT_V1]]\n上题：${JSON.stringify({question: item.question, topic: item.topic || activity.topic, note_ids: item.noteIds || [], result: item.result, sources: item.sources || []})}\nretry_of: ${item.submission?.attemptId || ''}\n请调用 learning_activity present 给一道针对当前知识点的变式题，retry_of 使用上面的作答编号，保留来源。不要一次连发多题。`});
              this.say('新题正在准备');
            } catch (error) { action.disabled = false; this.say(error.message || '暂时无法请求新题'); }
          }); this.body.append(action);
        }
      }
      if (sequential && items.every(step => typeof step.result?.correct === 'boolean')) {
        const solution = node('details', 'pinkie-il-explanation'); solution.append(node('summary', '', '查看完整解法'));
        for (const [index, step] of items.entries()) {
          solution.append(node('strong', '', `第${index + 1}步：${step.question}`), node('p', '', step.result.explanation || step.result.feedback || step.result.keyPoint || '已核对'));
        }
        this.body.append(solution);
      }
    }
    async submit(item, submit) {
      if (this.busy) return;
      const draft = this.draft(item);
      if (Array.isArray(draft.answer) ? !draft.answer.length : !String(draft.answer).trim()) { this.say('先填写或选择答案'); return; }
      this.busy = true; submit.disabled = true;
      try {
        await this.flush();
        const result = await call('pinkie.learning.submit', {sessionKey: this.ref.sessionKey, activityId: this.ref.id,
          itemId: item.id, ...copy(draft), submissionId: item.submissionId || (item.submissionId = uid())});
        if (this.disposed) return;
        this.pending.delete(item.id);
        this.data.activity = result.current;
        preserve(this.element, () => this.renderQuiz());
        const submitted = (result.current.items || [result.current]).find(value => value.id === item.id);
        await this.explain(result.current, submitted);
      } catch (error) { this.say(error.message || '答案暂时没有提交成功'); }
      finally {
        this.busy = false;
        if (!this.disposed) { submit.disabled = false; if (this.loaded) preserve(this.element, () => this.renderQuiz()); }
      }
    }
    async explain(activity, item) {
      if (!item?.submission || this.explaining.has(item.id)) return;
      this.explaining.add(item.id);
      try {
        const answer = item.submission;
        const message = `[[CLEKK_LEARNING_ANSWER_V1]]\nactivity_id: ${activity.id}\nitem_id: ${item.id}\nanswer: ${JSON.stringify(answer.answer)}\nconfidence: ${answer.confidence ?? 'not_provided'}\nhint_used: ${Boolean(answer.hintUsed)}\nserver_check: ${answer.correctness === true ? 'correct' : answer.correctness === false ? 'incorrect' : 'needs_model'}\n请只对这一小题调用 learning_activity resolve，使用 item_results 并保留 item_id，给出简短讲解和具体错因。可用comparison逐点对照，answer_quote只能引用实际回答。客观题以服务器判定为准。${activity.presentation === 'step_solution' ? '这是分步解题，只核对当前步骤，不要提前讲后面的步骤或提前结束整题。' : ''}`;
        await call('chat.send', {sessionKey: this.ref.sessionKey, message, idempotencyKey: uid()});
        this.say('答案已保存，正在准备讲解');
      } catch (error) { this.say(`答案已保存，讲解暂时未送达：${error.message || '请点请求讲解重试'}`); }
      finally { this.explaining.delete(item.id); }
    }
    renderSentence() {
      this.cleanupDrawing(); this.body.replaceChildren();
      const record = this.data.visual, checked = record.state.checked;
      this.body.append(node('p', 'pinkie-il-problem', record.definition.sentence));
      const tools = node('div', 'pinkie-il-role-tools'); tools.setAttribute('role', 'group'); tools.setAttribute('aria-label', '选择语法角色');
      this.selectedRole ||= 'subject';
      if (!checked) {
        this.body.append(node('p', 'pinkie-il-source', '先选语法角色，再点原句片段；再次点击可以取消。'));
        for (const [role, title] of Object.entries(ROLES)) {
          const pick = button(title, () => {
            this.selectedRole = role;
            for (const button of tools.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.role === role));
          }); pick.dataset.role = role; pick.setAttribute('aria-pressed', String(role === this.selectedRole)); tools.append(pick);
        }
        this.body.append(tools);
      } else this.body.append(node('div', 'pinkie-il-verdict', `对照示范：${record.analysis.correct} / ${record.analysis.total} 处一致`));
      const fragments = node('div', 'pinkie-il-sentence');
      for (const segment of record.definition.segments) {
        const selected = record.state.labels[segment.id];
        const part = button('', () => {
          if (this.busy) return;
          if (this.data.visual.state.checked) this.selectedSegment = segment.id;
          else {
            const labels = this.data.visual.state.labels;
            const role = labels[segment.id] === this.selectedRole ? '' : this.selectedRole;
            if (role) labels[segment.id] = role; else delete labels[segment.id];
            this.enqueue('visual', {state: {labels: {[segment.id]: role}}});
          }
          preserve(this.element, () => this.renderContent());
          [...this.body.querySelectorAll('[data-pinkie-segment]')].find(el => el.dataset.pinkieSegment === segment.id)?.focus({preventScroll: true});
        }, 'pinkie-il-segment');
        part.dataset.pinkieSegment = segment.id;
        part.append(node('span', '', segment.text));
        if (selected) part.append(node('small', '', ROLES[selected]));
        if (checked) {
          const result = record.analysis.entries.find(entry => entry.id === segment.id);
          part.dataset.correct = String(result.correct);
          part.setAttribute('aria-pressed', String(segment.id === this.selectedSegment));
          if (!result.correct) part.append(node('small', 'pinkie-il-source', `示范：${ROLES[segment.role]}`));
        } else part.setAttribute('aria-pressed', String(Boolean(selected)));
        fragments.append(part);
      }
      this.body.append(fragments);
      if (checked) {
        this.selectedSegment ||= record.definition.segments[0].id;
        const segment = record.definition.segments.find(s => s.id === this.selectedSegment) || record.definition.segments[0];
        const analysis = node('div', 'pinkie-il-sentence-detail');
        analysis.append(node('strong', '', `${segment.text.trim()} · ${ROLES[segment.role]}`));
        if (segment.explanation) analysis.append(node('p', '', segment.explanation));
        if (segment.referent) analysis.append(node('p', 'pinkie-il-keypoint', `指代：${segment.referent}`));
        this.body.append(node('p', 'pinkie-il-source', '点片段查看解析和指代关系。'), analysis);
      }
      const act = button(checked ? '重新标注' : '核对本句', async () => {
        if (this.busy) return;
        this.busy = true; act.disabled = true;
        try {
          if (!await this.flush()) return;
          await this.writeOne({state: checked ? {reset: true} : {check: true}});
          if (!this.disposed && this.loaded) preserve(this.element, () => this.renderContent());
          this.say(checked ? '已开始新一轮标注' : '已核对，可点片段看解析');
        } catch (error) { this.say(error.message || '暂时无法核对'); }
        finally { this.busy = false; act.disabled = false; }
      }, 'pinkie-il-primary'); this.body.append(act);
    }
    labData() {
      const record = this.data.visual, words = record.state.input.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
      if (!words.length || words.length > 80) throw new Error('词频实验需要1–80个词，请缩短输入');
      const partition = key => {
        let hash = 0; for (let i = 0; i < key.length; i++) hash = (Math.imul(31, hash) + key.charCodeAt(i)) | 0;
        return (hash & 0x7fffffff) % record.definition.workers;
      };
      const pairs = words.map((key, i) => ({id: `pair-${i}`, key, bucket: partition(key)}));
      const counts = new Map(); for (const pair of pairs) counts.set(pair.key, (counts.get(pair.key) || 0) + 1);
      return {pairs, output: [...counts].sort((a, b) => a[0].localeCompare(b[0]))};
    }
    renderMapReduce() {
      this.cleanupDrawing(); this.body.replaceChildren();
      const record = this.data.visual, state = record.state;
      const {pairs, output} = this.labData();
      const phaseLabel = {input: '输入数据', map: 'Map', shuffle: 'Shuffle', reduce: 'Reduce'};
      const nav = node('nav', 'pinkie-il-flow'); nav.setAttribute('aria-label', '词频实验阶段');
      for (const [key, title] of Object.entries(phaseLabel)) { const tag = node('span', 'pinkie-il-lab-phase', title); tag.setAttribute('aria-current', String(key === state.phase)); nav.append(tag); }
      this.body.append(nav);
      const input = node('textarea', 'pinkie-il-answer'); input.rows = 2; input.value = state.input; input.setAttribute('aria-label', '词频实验输入'); input.maxLength = 2000;
      const apply = button('更新数据', () => {
        const before = this.data.visual.state;
        const next = input.value.trim();
        this.data.visual.state = {...before, input: next};
        try { this.labData(); }
        catch (error) { this.data.visual.state = before; this.say(error.message); return; }
        this.data.visual.state = {input: next, assignments: {}, usedDemo: false, phase: 'input'};
        this.selectedPair = '';
        this.enqueue('visual', {state: {input: next, phase: 'input'}});
        preserve(this.element, () => this.renderContent());
      });
      this.body.append(input, apply);
      const movePhase = phase => {
        this.data.visual.state.phase = phase;
        this.enqueue('visual', {state: {phase}});
        preserve(this.element, () => this.renderContent());
      };
      if (state.phase === 'input') {
        this.body.append(node('p', 'pinkie-il-source', '把输入拆成单词，每出现一次就产生一个 (key, 1)。'), button('运行 Map', () => movePhase('map'), 'pinkie-il-primary'));
        return;
      }
      this.body.append(node('p', 'pinkie-il-source', `${pairs.length}个键值对 · ${record.definition.workers}个Reduce桶。相同key按同一分桶规则进入同桶。`));
      const area = node('div', 'pinkie-il-lab-area');
      const pool = node('div', 'pinkie-il-pair-pool'); pool.setAttribute('aria-label', '待分桶的键值对');
      const buckets = node('div', 'pinkie-il-buckets');
      const place = (id, bucket) => {
        if (!pairs.some(pair => pair.id === id)) return;
        this.data.visual.state.assignments[id] = bucket;
        this.data.visual.state.phase = 'shuffle'; this.selectedPair = '';
        this.enqueue('visual', {state: {assignments: {[id]: bucket}, phase: 'shuffle'}});
        preserve(this.element, () => this.renderContent());
      };
      const pairButton = pair => {
        const chip = node('div', 'pinkie-il-button pinkie-il-pair', `(${pair.key}, 1)`);
        chip.setAttribute('role', 'button'); chip.tabIndex = 0;
        chip.addEventListener('click', event => {
          this.selectedPair = pair.id;
          for (const entry of this.body.querySelectorAll('[data-pinkie-pair]')) entry.setAttribute('aria-pressed', String(entry.dataset.pinkiePair === pair.id));
          this.say(`已选 ${pair.key}，点一个桶放入`);
          if (event.detail === 0) this.body.querySelector('[data-pinkie-bucket-button]')?.focus();
        });
        chip.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chip.click(); }
        });
        chip.draggable = true; chip.dataset.pinkiePair = pair.id; chip.setAttribute('aria-pressed', String(this.selectedPair === pair.id));
        chip.addEventListener('dragstart', event => {
          event.stopPropagation();
          event.dataTransfer.setData('application/x-pinkie-pair', JSON.stringify({card: this.ref.id, session: this.ref.sessionKey, pair: pair.id}));
          event.dataTransfer.effectAllowed = 'move';
        }); return chip;
      };
      for (const pair of pairs) if (!Number.isInteger(state.assignments[pair.id])) pool.append(pairButton(pair));
      if (!pool.children.length) pool.append(node('p', 'pinkie-il-source', '键值对已全部放入桶中'));
      for (let index = 0; index < record.definition.workers; index++) {
        const bucket = node('div', 'pinkie-il-bucket'); bucket.dataset.pinkieBucket = String(index);
        bucket.append(node('strong', '', `桶 ${index + 1}`));
        const put = button(`放入桶 ${index + 1}`, () => this.selectedPair ? place(this.selectedPair, index) : this.say('先点选一个键值对，或直接拖到这里'));
        put.dataset.pinkieBucketButton = String(index); bucket.append(put);
        bucket.addEventListener('dragover', event => { if (!Array.from(event.dataTransfer.types).includes('application/x-pinkie-pair')) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; });
        bucket.addEventListener('drop', event => {
          if (!Array.from(event.dataTransfer.types).includes('application/x-pinkie-pair')) return;
          event.preventDefault(); event.stopPropagation();
          try { const drop = JSON.parse(event.dataTransfer.getData('application/x-pinkie-pair')); if (drop.card === this.ref.id && drop.session === this.ref.sessionKey) place(drop.pair, index); } catch { /* Foreign drag data is not a pair. */ }
        });
        for (const pair of pairs) if (state.assignments[pair.id] === index) bucket.append(pairButton(pair));
        buckets.append(bucket);
      }
      area.append(pool, buckets); this.body.append(node('p', 'pinkie-il-source', '拖动键值对到桶中；也可以先点键值对，再点“放入桶”。'), area);
      const ready = pairs.every(pair => state.assignments[pair.id] === pair.bucket);
      const actions = node('div', 'pinkie-il-actions');
      actions.append(button('核对分桶', () => {
        const unassigned = pairs.filter(pair => !Number.isInteger(this.data.visual.state.assignments[pair.id]));
        const wrong = pairs.find(pair => Number.isInteger(this.data.visual.state.assignments[pair.id]) && this.data.visual.state.assignments[pair.id] !== pair.bucket);
        this.say(unassigned.length ? `还有${unassigned.length}个键值对没有分桶` : wrong ? `${wrong.key} 按本实验规则应进入桶 ${wrong.bucket + 1}，相同key必须进入同桶` : '分桶正确，可以运行 Reduce');
      }));
      actions.append(button('演示自动分桶', () => {
        const assignments = Object.fromEntries(pairs.map(pair => [pair.id, pair.bucket]));
        Object.assign(this.data.visual.state, {assignments, usedDemo: true, phase: 'shuffle'});
        this.enqueue('visual', {state: {assignments, demonstrate: true, phase: 'shuffle'}});
        preserve(this.element, () => this.renderContent());
      }));
      const reduce = button('运行 Reduce', () => movePhase('reduce'), 'pinkie-il-primary'); reduce.disabled = !ready; actions.append(reduce); this.body.append(actions);
      if (state.usedDemo) this.body.append(node('p', 'pinkie-il-source', '已使用自动分桶示范，可以修改输入再自己试一次。'));
      if (state.phase === 'reduce') {
        const results = node('div', 'pinkie-il-reduce-output'); results.append(node('strong', '', 'Reduce 输出：每个key的值相加'));
        for (const [key, count] of output) results.append(node('div', 'pinkie-il-reduce-row', `${key}：${Array(count).fill('1').join(' + ')} = ${count}`));
        this.body.append(results);
      }
      this.body.append(button('问碧琪这一步', async () => {
        try {
          if (!await this.flush()) return;
          await call('chat.send', {sessionKey: this.ref.sessionKey, idempotencyKey: uid(), message: `请解释我当前MapReduce实验的这一步。\nactivity_id: ${this.ref.id}\n实际状态：${JSON.stringify(this.data.visual.state)}\n根据实际输入和分桶解释，不要把操作次数当成已经掌握。`});
          this.say('已把当前实验状态交给碧琪');
        } catch (error) { this.say(error.message || '暂时无法发送问题'); }
      }));
    }
    renderPlot() {
      this.cleanupDrawing(); this.body.replaceChildren();
      const formula = node('div', 'pinkie-il-formula'); formula.setAttribute('aria-live', 'off');
      const plot = node('div', 'pinkie-il-plot');
      const controls = node('div', 'pinkie-il-parameters');
      this.body.append(formula, plot, controls);
      const inputNodes = new Map();
      const definition = this.data.visual.definition;
      // Keep one coordinate scale for the full slider range. Rescaling on each
      // input made a*x² look unchanged when only its opening changed.
      const parameter = key => definition.parameters.find(p => p.key === key);
      const extrema = (key, factor) => {
        const p = parameter(key); const values = [p.min * factor, p.max * factor];
        return [Math.min(...values), Math.max(...values)];
      };
      const envelopes = definition.family === 'sine'
        ? [-Math.max(Math.abs(parameter('a').min), Math.abs(parameter('a').max)), Math.max(Math.abs(parameter('a').min), Math.abs(parameter('a').max))]
        : Array.from({length: 241}, (_, i) => {
          const x = definition.domain[0] + (definition.domain[1] - definition.domain[0]) * i / 240;
          const terms = definition.family === 'linear' ? [extrema('a', x), extrema('b', 1)] : [extrema('a', x * x), extrema('b', x), extrema('c', 1)];
          return [terms.reduce((sum, term) => sum + term[0], 0), terms.reduce((sum, term) => sum + term[1], 0)];
        }).flat();
      let ymin = Math.min(0, ...envelopes), ymax = Math.max(0, ...envelopes);
      const padding = Math.max(.5, (ymax - ymin) * .08); ymin -= padding; ymax += padding;
      for (const p of this.data.visual.definition.parameters) {
        const label = node('label', 'pinkie-il-parameter'), caption = node('span'), value = node('output');
        const input = node('input'); input.type = 'range'; input.min = p.min; input.max = p.max; input.step = p.step;
        input.value = this.data.visual.state.values[p.key]; input.setAttribute('aria-label', p.label);
        caption.append(node('span', '', p.label), value); label.append(caption, input); controls.append(label);
        inputNodes.set(p.key, {input, value});
        input.addEventListener('input', () => {
          const value = Number(input.value); this.data.visual.state.values[p.key] = value;
          this.enqueue('visual', {state: {values: {[p.key]: value}}});
          this.scheduleDraw();
        });
      }
      const clip = `il-plot-${uid()}`;
      this.draw = () => {
        if (!this.loaded || !this.visible || !this.expanded || this.disposed) return;
        const {definition, state} = this.data.visual, {a = 1, b = 0, c = 0} = state.values;
        const pretty = value => Number(value.toPrecision(4)).toString();
        const compute = x => definition.family === 'linear' ? a * x + b : definition.family === 'sine' ? a * Math.sin(b * x + c) : a * x * x + b * x + c;
        formula.textContent = definition.family === 'linear' ? `f(x) = ${pretty(a)}x + ${pretty(b)}`
          : definition.family === 'sine' ? `f(x) = ${pretty(a)} sin(${pretty(b)}x + ${pretty(c)})` : `f(x) = ${pretty(a)}x² + ${pretty(b)}x + ${pretty(c)}`;
        for (const [key, elements] of inputNodes) { elements.input.value = state.values[key]; elements.value.textContent = pretty(state.values[key]); }
        const width = Math.max(240, Math.floor(plot.clientWidth || 480)), height = 232;
        const left = 54, right = width - 16, top = 24, bottom = height - 34;
        const [xmin, xmax] = definition.domain;
        const points = Array.from({length: 241}, (_, i) => { const x = xmin + (xmax - xmin) * i / 240; return [x, compute(x)]; });
        const sx = x => left + (x - xmin) / (xmax - xmin) * (right - left);
        const sy = y => bottom - (y - ymin) / (ymax - ymin) * (bottom - top);
        const svgNode = (tag, attrs, text) => {
          const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
          for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, value);
          if (text !== undefined) el.textContent = text; return el;
        };
        const svg = svgNode('svg', {viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${formula.textContent}，横坐标${xmin}至${xmax}`});
        const defs = svgNode('defs'), clipPath = svgNode('clipPath', {id: clip});
        clipPath.append(svgNode('rect', {x: left, y: top, width: right - left, height: bottom - top})); defs.append(clipPath); svg.append(defs);
        const tickCount = width < 400 ? 3 : 5;
        for (let index = 0; index < tickCount; index++) {
          const x = xmin + (xmax - xmin) * index / (tickCount - 1), y = ymin + (ymax - ymin) * index / (tickCount - 1);
          svg.append(svgNode('line', {x1: sx(x), x2: sx(x), y1: top, y2: bottom, class: 'pinkie-il-gridline'}));
          svg.append(svgNode('line', {x1: left, x2: right, y1: sy(y), y2: sy(y), class: 'pinkie-il-gridline'}));
          svg.append(svgNode('text', {x: sx(x), y: bottom + 18, 'text-anchor': index === 0 ? 'start' : index === tickCount - 1 ? 'end' : 'middle'}, pretty(x)));
          svg.append(svgNode('text', {x: left - 7, y: sy(y) + 4, 'text-anchor': 'end'}, pretty(y)));
        }
        if (xmin <= 0 && xmax >= 0) svg.append(svgNode('line', {x1: sx(0), x2: sx(0), y1: top, y2: bottom, class: 'pinkie-il-axis'}));
        svg.append(svgNode('line', {x1: left, x2: right, y1: sy(0), y2: sy(0), class: 'pinkie-il-axis'}));
        svg.append(svgNode('text', {x: 4, y: 13}, 'f(x)'));
        svg.append(svgNode('text', {x: right, y: height - 2, 'text-anchor': 'end'}, 'x'));
        svg.append(svgNode('path', {d: points.map(([x, y], index) => `${index ? 'L' : 'M'}${sx(x).toFixed(2)},${sy(y).toFixed(2)}`).join(' '), 'clip-path': `url(#${clip})`, class: 'pinkie-il-curve'}));
        plot.replaceChildren(svg);
      };
      if (typeof ResizeObserver === 'function') {
        this.resize = new ResizeObserver(() => this.scheduleDraw()); this.resize.observe(plot);
      }
      this.draw();
    }
    scheduleDraw() {
      if (this.frame || !this.draw) return;
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw?.(); });
    }
    renderFlow() {
      this.cleanupDrawing(); this.body.replaceChildren();
      const {definition, state} = this.data.visual;
      const steps = node('nav', 'pinkie-il-flow'); steps.setAttribute('aria-label', '流程步骤');
      const detail = node('div', 'pinkie-il-flow-detail'); detail.setAttribute('aria-live', 'polite');
      const show = id => {
        const step = definition.steps.find(step => step.id === id) || definition.steps[0];
        for (const entry of steps.querySelectorAll('button')) entry.setAttribute('aria-current', String(entry.dataset.step === step.id));
        detail.replaceChildren(node('strong', '', step.label));
        if (step.description) detail.append(node('p', '', step.description));
        if (step.input) detail.append(node('p', 'pinkie-il-flow-data', `输入：${step.input}`));
        if (step.output) detail.append(node('p', 'pinkie-il-flow-data', `输出：${step.output}`));
      };
      for (const [index, step] of definition.steps.entries()) {
        if (index) { const arrow = node('span', 'pinkie-il-flow-arrow', '→'); arrow.setAttribute('aria-hidden', 'true'); steps.append(arrow); }
        const pick = button(step.label, () => {
          this.data.visual.state.selectedStep = step.id; show(step.id); this.enqueue('visual', {state: {selectedStep: step.id}});
        }); pick.dataset.step = step.id; steps.append(pick);
      }
      this.body.append(steps, detail); show(state.selectedStep);
    }
  }

  const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) elements.get(entry.target)?.setVisible(entry.isIntersecting);
  }, {rootMargin: '160px'}) : null;

  function bind(slot) {
    if (!slot.isConnected) return;
    let root = roots.get(slot);
    if (!root) {
      root = {items: new Map(), limit: 12}; roots.set(slot, root);
      if (!patched.has(slot)) {
        patched.add(slot);
        for (const property of ['pinkieLearningCards', 'pinkieLearningSource', 'pinkieLearningSession']) {
          let value = slot[property];
          Object.defineProperty(slot, property, {configurable: true, get: () => value, set(next) { value = next; enqueueRoot(slot); }});
        }
      }
    }
    const sessionKey = ownerSession(slot);
    // An aggregate work card owns the interaction. Expanded native tool rows
    // inside its lazy body must not mount the same card a second time.
    const nested = slot.closest('.chat-work-group, .chat-session-activity, .chat-activity-group__body');
    const supplied = nested ? [] : Array.isArray(slot.pinkieLearningCards) ? slot.pinkieLearningCards : rawRefs(slot.pinkieLearningSource);
    const refs = [...new Map(supplied.filter(ref => validRef(ref) && ref.sessionKey === sessionKey).map(ref => [`${ref.kind}:${ref.id}`, ref])).values()];
    const shown = refs.slice(0, root.limit), keys = new Set(shown.map(ref => `${ref.sessionKey}:${ref.kind}:${ref.id}`));
    for (const [key, view] of root.items) if (!keys.has(key)) { view.dispose(); view.element.remove(); root.items.delete(key); }
    for (const ref of shown) {
      const key = `${ref.sessionKey}:${ref.kind}:${ref.id}`, existing = root.items.get(key);
      if (!existing) root.items.set(key, new View(ref, slot));
      else {
        if (existing.title.textContent !== (ref.title || '互动学习')) existing.title.textContent = ref.title || '互动学习';
        if ((ref.revision || 0) > (existing.ref.revision || 0)) { existing.ref = ref; if (!existing.pending.size) void existing.load(true); }
      }
    }
    if (refs.length > root.limit) {
      if (!root.more) root.more = button('', () => { root.limit += 12; bind(slot); });
      root.more.textContent = `再显示${Math.min(12, refs.length - root.limit)}条互动内容`;
      slot.append(root.more);
    } else { root.more?.remove(); root.more = null; }
  }
  function enqueueRoot(slot) {
    pendingRoots.add(slot);
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const slot of pendingRoots) if (slot.isConnected) bind(slot);
      pendingRoots.clear();
      for (const [slot, root] of roots) if (!slot.isConnected) {
        for (const view of root.items.values()) view.dispose(); roots.delete(slot);
      }
    });
  }
  function scan(root) {
    if (root?.matches?.(SLOT)) enqueueRoot(root);
    for (const slot of root?.querySelectorAll?.(SLOT) || []) enqueueRoot(slot);
  }
  const observer = new MutationObserver(records => {
    let removed = false;
    for (const record of records) {
      if (record.target.closest?.('.pinkie-learning-inline-slot')) continue;
      for (const node of record.addedNodes) if (node.nodeType === 1) scan(node);
      removed ||= record.removedNodes.length > 0;
    }
    if (removed && roots.size) for (const slot of roots.keys()) if (!slot.isConnected) enqueueRoot(slot);
  });
  observer.observe(document.documentElement, {childList: true, subtree: true});
  scan(document);
  window.addEventListener('pinkie:learning-state', event => {
    const remote = event.detail, session = remote?.sessionKey;
    if (!session || (sessionRevisions.get(session) ?? -1) >= remote.revision) return;
    sessionRevisions.set(session, remote.revision);
    for (const view of views) {
      if (view.ref.sessionKey !== session || view.ref.kind !== 'quiz' || !view.data || !view.loaded) continue;
      if (remote.current?.id === view.ref.id) view.data.activity = remote.current;
      view.data.readOnly = !remote.enabled || remote.current?.id !== view.ref.id;
      if (!view.busy) preserve(view.element, () => view.renderQuiz());
    }
  });
  const pause = () => { for (const view of views) { void view.flush(); view.cleanupDrawing(); } };
  const resume = () => { for (const view of views) if (view.loaded && view.data && view.visible && view.expanded) {
    if(view.ref.kind==='function_plot')view.renderPlot();
    else if(practiceKinds.includes(view.ref.kind))preserve(view.element,()=>view.renderContent());
  } };
  document.addEventListener('visibilitychange', () => document.hidden ? pause() : resume());
  window.addEventListener('pinkie:app-background', pause);
  window.addEventListener('pinkie:app-foreground', resume);
  window.addEventListener('pagehide', pause);
  window.__pinkieLearningInline = {
    mount(ref,slot) { if(!validRef(ref))throw Error('练习引用不正确');slot.classList.add('pinkie-learning-inline-slot');slot.dataset.pinkieLearningSlot=uid();slot.pinkieLearningSession=ref.sessionKey;slot.pinkieLearningCards=[ref];enqueueRoot(slot); },
    hasActivity: (sessionKey, id) => [...views].some(view => !view.disposed && view.element.isConnected && view.ref.sessionKey === sessionKey && view.ref.id === id),
    stats: () => ({slots: roots.size, cards: views.size, loaded: [...views].filter(view => view.loaded).length, requests: reads.size}),
  };
})();
