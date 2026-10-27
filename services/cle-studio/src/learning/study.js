import {REMINDERS, ownedReminder, syncReminders} from './reminders.js';

const node = (tag, cls, text) => {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (text !== undefined) element.textContent = text;
  return element;
};
const action = (label, handler, cls = '') => {
  const button = node('button', `cle-study__button ${cls}`, label);
  button.type = 'button'; button.addEventListener('click', handler); return button;
};

// The pane a node belongs to. 双模式 runs two live chat panes; the study bar of each side is
// its own strip, fed by that side's session, and it disappears with its pane.
const paneOf = (element) => element?.closest?.('openclaw-chat-pane') || null;
const paneSession = (pane) => {
  if (!pane) return '';
  const direct = pane.sessionKey || pane.dataset?.sessionKey || '';
  if (direct) return String(direct);
  try {
    const owner = JSON.parse(pane.dataset?.mcpAppOwnerKey || 'null');
    if (Array.isArray(owner) && owner[1]) return String(owner[1]);
  } catch { /* not an owner-marked pane */ }
  return String(pane.querySelector?.('openclaw-chat-pane')?.sessionKey || '');
};
const isLearning = (sessionKey) => /^agent:learning:/.test(String(sessionKey || ''));
const panes = () => [...document.querySelectorAll('openclaw-chat-pane.chat-pane-cache__pane')];

// The host retires a plugin activation when the UI reloads or the gateway restarts. Requests made
// afterwards reject with an internal sentence ("This plugin UI activation has ended. Use the
// current activation.") that means "this activation is over" — not "your study progress is
// broken". Treating it as a user-facing failure is what put that sentence in the transcript.
const ACTIVATION_ENDED = /activation has ended|use the current activation/i;
export const isActivationEnded = (error) => ACTIVATION_ENDED.test(String(error?.message ?? error ?? ''));

// Thrown by the guarded request so a call that starts after retirement never reaches the host.
class RetiredError extends Error {
  constructor() { super('study panel retired'); this.retired = true; }
}

export function mountStudy(host, signal) {
  const panels = new Map();      // pane element -> strip controller
  // A mount that is already aborted must not allocate anything: no observers, no timers, no frame
  // requests, and no RPC. Returning an empty registry keeps the shape callers expect.
  if (signal?.aborted) return {panels, get retired() { return true; }};

  let retired = false;
  let sheet = null, backFocus = null;
  let frame = 0;
  const timers = new Set();
  const isRetired = () => retired || Boolean(signal?.aborted);

  // Every request goes through here: after retirement the host is never called, so a dead panel
  // cannot keep talking to a dead activation.
  const request = (method, params = {}) => {
    if (isRetired()) return Promise.reject(new RetiredError());
    return host.request(method, params);
  };
  // A failure worth showing the user: a real error while this activation is still alive.
  const reportable = (error) => !isRetired() && !isActivationEnded(error) && !error?.retired;

  function createPanel(pane) {
    if (isRetired()) return null;
    let dead = false;
    let today = null, focus = null, loading = false, lastLoaded = 0, loadSeq = 0;
    let plannedMinutes = 15;
    // `alive` gates every write and every request: a disposed panel or a retired activation is
    // closed. It must NOT test strip.isConnected — the strip is legitimately detached until
    // mount() places it, and a pane re-render detaches it for a moment.
    const strip = node('section', 'cle-study');
    const alive = () => !dead && !isRetired();
    strip.setAttribute('aria-label', '今日学习');
    strip.dataset.clePaneSession = paneSession(pane);
    const summary = node('div', 'cle-study__summary');
    const eyebrow = node('span', 'cle-study__eyebrow');
    eyebrow.append(node('b', '', '习作'), node('em', '', 'Étude · 今日'));
    const progress = node('span', 'cle-study__progress', '正在读取学习进度…');
    const streak = node('span', 'cle-study__streak');
    const timer = node('span', 'cle-study__timer');
    const nextStep = node('div', 'cle-study__next-step');
    const nextLabel = node('strong', 'cle-study__next-label', '今天先学一小步');
    const nextDescription = node('span', 'cle-study__next-description', '正在整理下一步…');
    const mastery = node('span', 'cle-study__mastery');
    nextStep.append(nextLabel, nextDescription, mastery);
    const notice = node('div', 'cle-study__notice'); notice.setAttribute('role', 'status');
    const duration = node('select', 'cle-study__duration');
    duration.setAttribute('aria-label', '本轮学习时长');
    for (const minutes of [5, 15, 25]) {
      const option = node('option', '', `${minutes} 分钟`); option.value = String(minutes); duration.append(option);
    }
    duration.value = '15';
    duration.addEventListener('change', () => { plannedMinutes = Number(duration.value) || 15; paint(); });
    const focusButton = action('开始专注', async () => {
      if (!alive()) return;
      focusButton.disabled = true;
      try {
        if (focus) {
          const result = await request('pinkie.learning.focus.stop', {id: focus.id});
          // the activation may have ended while the focus stop was in flight: never claim a result
          if (!alive()) return;
          focus = null; today = result.today;
          say(result.minutes ? `这一轮记下了 ${result.minutes} 分钟。` : '未满一分钟，这轮没有增加时长。');
        } else {
          const result = await request('pinkie.learning.focus.start', {minutes: plannedMinutes});
          if (!alive()) return;
          focus = result.focus; say('计时开始。先专心做眼前这一小步。');
        }
        paint();
      } catch (error) {
        // a retired activation is not a failure to report, and the action is not retried
        if (!reportable(error)) return;
        say(error.message, true);
      } finally { if (alive()) focusButton.disabled = false; }
    });
    const continueButton = action('继续学习', () => {
      if (!alive()) return;
      const sessionKey = paneSession(pane);
      const step = today?.nextStep || {kind: Number(today?.progress?.dueReviews) > 0 ? 'review' : 'resume'};
      // The learning card controller owns answers and reader/review state. Route the single
      // continuation action to its pane rather than issuing a second, competing question here.
      window.dispatchEvent(new CustomEvent('pinkie:learning-continue', {detail: {sessionKey, step}}));
    }, 'cle-study__button--primary');
    const settings = action('学习约定', () => openSheet(paneSession(pane)));
    summary.append(eyebrow, progress, streak, timer);
    const buttons = node('div', 'cle-study__actions'); buttons.append(focusButton, duration, continueButton, settings);
    strip.append(summary, buttons, nextStep, notice);

    function say(text, error = false) {
      if (!alive()) return;
      notice.textContent = text; notice.dataset.error = String(error); notice.hidden = !text;
    }
    function clock() {
      if (!alive()) return;
      if (!focus) { timer.textContent = ''; return; }
      const seconds = Math.max(0, Math.floor((Date.now() - focus.start) / 1000));
      const remaining = Math.max(0, focus.plannedMinutes * 60 - seconds);
      timer.textContent = remaining > 0 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : '本轮到时';
      timer.setAttribute('aria-label', remaining > 0 ? `专注还剩 ${Math.ceil(remaining / 60)} 分钟` : '本轮专注已到时间，可以结束计时');
    }
    function paint() {
      if (!alive()) return;
      if (today) {
        const p = today.progress;
        // three gauges: what the pact asks for today, and how much of it is real
        const gauge = (label, value, goal, unit, invert = false) => {
          const k = invert ? (value ? 0 : 1) : goal ? Math.min(1, value / goal) : 1;
          const g = node('span', 'cle-study__gauge'); g.dataset.done = String(k >= 1);
          const bar = node('i'); bar.setAttribute('style', `--k:${k.toFixed(3)}`);
          g.append(node('span', 'cle-study__gauge-label', label), node('span', 'cle-study__gauge-value', invert ? `${value} ${unit}` : `${value}/${goal} ${unit}`), bar);
          return g;
        };
        const reviews = today.reviewPlan;
        progress.replaceChildren(gauge('专注', p.minutes, today.goals.minutes, '分钟'), gauge('做题', p.questions, today.goals.questions, '道'), reviews ? gauge('今日复习', reviews.done, reviews.target, '张') : gauge('待复习', p.dueReviews, 0, '张', true));
        progress.setAttribute('aria-label', `${p.minutes}/${today.goals.minutes} 分钟 · ${p.questions}/${today.goals.questions} 道题 · ${reviews ? `今日复习 ${reviews.done}/${reviews.target} 张，另有 ${reviews.backlog} 张分日完成` : `${p.dueReviews} 张待复习`}`);
        strip.dataset.complete = String(today.complete);
        // the streak is a row of blossoms he has kept; seven at most, then a number
        const n = today.streak.current || 0;
        streak.replaceChildren(...Array.from({length: Math.min(7, n)}, () => node('i', 'cle-study__bloom')), node('span', '', n ? `连续 ${n} 天` : '今天开个头'));
        streak.title = today.complete ? '今日任务已完成，掌握情况另计' : `连续 ${n} 天`;
        eyebrow.querySelector('em').textContent = today.complete ? 'Étude · 今日任务已完成' : 'Étude · 今日';
        const step = today.nextStep;
        nextLabel.textContent = step?.label || (p.dueReviews ? `下一步：复习 ${Math.min(10, p.dueReviews)} 个知识点` : '下一步：继续当前题目或读到的地方');
        nextDescription.textContent = `${step?.description || (p.dueReviews ? `共 ${p.dueReviews} 条待复习，分小轮完成。` : '接着当前进度，做一道题或学一个新知识点。')}${reviews?.backlog ? ` 另有 ${reviews.backlog} 张留到以后分批复习。` : ''}`;
        const evidence = today.mastery;
        mastery.textContent = evidence ? `掌握证据：独立答对 ${Number(evidence.independentCorrect) || 0} · 提示后答对 ${Number(evidence.assistedCorrect) || 0} · 答对待确认 ${Number(evidence.uncertainCorrect) || 0} · 待巩固 ${Number(evidence.needsPractice) || 0}${evidence.delayedVerified ? ` · 隔日验证 ${evidence.delayedVerified}` : ''}` : '做够题是完成任务，隔天还能独立答对才是掌握。';
        continueButton.textContent = step?.kind === 'review' ? '开始这一轮' : '继续学习';
      }
      focusButton.textContent = focus ? '结束本轮' : '开始专注'; duration.disabled = Boolean(focus); clock();
    }
    async function load(force = false) {
      if (!alive() || loading || (!force && Date.now() - lastLoaded < 15000)) return;
      loading = true;
      const seq = ++loadSeq;
      try {
        const sessionKey = paneSession(pane);
        const [day, status] = await Promise.all([request('pinkie.learning.today', {sessionKey}), request('pinkie.learning.focus.status')]);
        // an in-flight answer that lands after retirement must not write a retired strip
        if (!alive() || seq !== loadSeq || paneSession(pane) !== sessionKey) return;
        today = day; focus = status.active; lastLoaded = Date.now(); paint();
      } catch (error) {
        // the activation-ended sentence is lifecycle noise, not progress trouble; a real error while
        // this activation is alive is still surfaced
        if (!reportable(error)) return;
        say(`暂时读不到学习进度：${error.message}`, true);
      } finally { loading = false; }
    }
    function mount() {
      if (!alive()) return;
      const learning = isLearning(paneSession(pane));
      strip.hidden = !learning;
      if (!learning) { closeSheet(); return; }
      const root = pane.querySelector('.chat-main') || pane;
      if (root && strip.parentElement !== root) root.prepend(strip);
      load();
    }
    return {
      element: strip,
      mount,
      load,
      paint,
      clock: () => { if (!isRetired() && !document.hidden) clock(); },
      dispose() {
        dead = true;
        strip.remove();
        if (sheet?.dataset?.clePaneSession === strip.dataset.clePaneSession) closeSheet();
      },
      get isDead() { return dead; },
      get sessionKey() { return paneSession(pane); },
    };
  }

  function closeSheet() {
    if (!sheet) return;
    const current = sheet; sheet = null;
    current.remove();
    if (backFocus?.isConnected) backFocus.focus({preventScroll: true});
    backFocus = null;
  }
  async function openSheet(ownerSession) {
    if (sheet || isRetired()) return;
    backFocus = document.activeElement;
    const current = node('aside', 'cle-study-sheet'); sheet = current;
    // the dialog is appended below, so liveness is "still the current sheet and not retired"
    const sheetAlive = () => sheet === current && !isRetired();
    current.dataset.clePaneSession = ownerSession || '';
    current.setAttribute('role', 'dialog'); current.setAttribute('aria-modal', 'false');
    current.setAttribute('aria-label', '学习约定');
    const header = node('header', 'cle-study-sheet__header');
    const heading = node('div'); heading.append(node('p', 'cle-label', 'LE PACTE'), node('h2', '', '每天，把约定做完。'));
    header.append(heading, action('关闭', closeSheet));
    const status = node('p', 'cle-study-sheet__status', '正在读取…'); status.setAttribute('role', 'status');
    current.append(header, status); document.body.append(current);
    current.querySelector('button').focus();
    const fail = (error) => {
      if (!sheetAlive()) return;
      // never render the host's internal activation sentence into the dialog
      if (!reportable(error)) { closeSheet(); return; }
      status.textContent = error.message; status.dataset.error = 'true';
    };
    try {
      const [day, history, receivers, schedules] = await Promise.all([
        request('pinkie.learning.today'), request('pinkie.learning.history', {days: 28}),
        request('pinkie.cron.targets').catch(() => ({targets: []})),
        request('cron.list', {includeDisabled: true}).catch(() => ({jobs: []})),
      ]);
      if (!sheetAlive()) return;
      for (const panel of panels.values()) { panel.paint(); }
      const pact = day.pact;
      status.textContent = `${day.date} · ${pact.timezone}。今天的进度会自动记下来。`;
      const historyRow = node('div', 'cle-study-sheet__history'); historyRow.setAttribute('aria-label', '最近28天学习记录');
      for (const item of history.days) {
        const cell = node('span', 'cle-study-sheet__day'); cell.dataset.state = item.state;
        cell.title = `${item.date} · ${{complete: '完成', partial: '进行过', missed: '未学习', future: '未到'}[item.state]}`;
        cell.setAttribute('aria-label', cell.title); historyRow.append(cell);
      }
      current.append(historyRow);
      const form = node('form', 'cle-study-sheet__form');
      const fields = {};
      function field(key, label, type, value, options = null) {
        const wrap = node('label', 'cle-study-sheet__field'); wrap.append(node('span', '', label));
        const input = node(options ? 'select' : 'input');
        if (options) for (const [v, text] of options) { const option = node('option', '', text); option.value = v; input.append(option); }
        else input.type = type;
        input.value = value ?? ''; input.name = key; wrap.append(input); fields[key] = input; form.append(wrap); return input;
      }
      const minutes = field('minutes', '每天专注（分钟）', 'number', pact.daily.minutes); minutes.min = '5'; minutes.max = '600'; minutes.required = true;
      const questions = field('questions', '每天做题（道）', 'number', pact.daily.questions); questions.min = '0'; questions.max = '500'; questions.required = true;
      field('reviews', '复习目标', '', pact.daily.reviews, [['due', '清掉当天到期复习'], ['skip', '暂不设复习目标']]);
      field('intensity', '督促方式', '', pact.intensity, [['gentle', '温和提醒'], ['firm', '直接督促'], ['relentless', '严格盯进度']]);
      field('exam', '考试日期（可留空）', 'date', pact.exam.date);
      field('timezone', '学习时间所在时区', 'text', pact.timezone).required = true;
      for (const item of REMINDERS) field(item.field, item.label, 'time', pact.reminders[item.field]).required = true;
      const targets = receivers.targets || [];
      const target = field('target', '提醒发到哪里', '', pact.channel.kind === 'none' ? '' : `${pact.channel.kind}|${pact.channel.to}`,
        [['', '先不开推送'], ...targets.map(item => [`${item.channel}|${item.to}`, item.label || item.name || `${item.channel} · ${item.to}`])]);
      const saved = `${pact.channel.kind}|${pact.channel.to}`;
      if (pact.channel.kind !== 'none' && !targets.some(item => `${item.channel}|${item.to}` === saved)) {
        const option = node('option', '', `已保存的 ${pact.channel.kind} 聊天`); option.value = saved; target.append(option); target.value = saved;
      }
      const check = node('label', 'cle-study-sheet__enable');
      const enable = node('input'); enable.type = 'checkbox';
      enable.checked = (schedules.jobs || []).some(job => job.enabled && REMINDERS.some(item => ownedReminder(job, item)));
      check.append(enable, node('span', '', '开启早间、晚间和睡前提醒')); form.append(check);
      const enableState = () => { enable.disabled = !target.value; if (!target.value) enable.checked = false; };
      target.addEventListener('change', enableState); enableState();
      if (!targets.length && pact.channel.kind === 'none') form.append(node('p', 'cle-study-sheet__hint', '连接一个已有聊天后，就可以把学习提醒发过去。'));
      const save = node('button', 'cle-study__button cle-study__button--primary', '保存学习约定'); save.type = 'submit'; form.append(save);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        // a retired panel must not repeat a side effect: no write, no reminder sync, no retry
        if (!sheetAlive() || save.disabled) return;
        save.disabled = true;
        const selected = targets.find(item => `${item.channel}|${item.to}` === target.value);
        const split = target.value.indexOf('|');
        const channel = split >= 0 ? {kind: target.value.slice(0, split), to: target.value.slice(split + 1)} : {kind: 'none', to: null};
        try {
          const {pact: updated} = await request('pinkie.learning.pact.set', {patch: {
            daily: {minutes: Number(minutes.value), questions: Number(questions.value), reviews: fields.reviews.value},
            intensity: fields.intensity.value, exam: {date: fields.exam.value || null}, timezone: fields.timezone.value.trim(),
            reminders: {morning: fields.morning.value, evening: fields.evening.value, lastCall: fields.lastCall.value}, channel,
          }});
          if (!sheetAlive()) return;
          try { await syncReminders(request, updated, enable.checked, selected || {}); }
          catch (error) {
            // half-applied: the pact saved, the reminders did not. Say so only while alive.
            if (!sheetAlive()) return;
            if (!reportable(error)) { closeSheet(); return; }
            throw new Error(`学习目标已保存，提醒尚未同步：${error.message}`);
          }
          if (!sheetAlive()) return;
          status.textContent = enable.checked ? '已保存。到点会按当天的实际进度提醒你。' : '已保存学习约定，定时提醒已关闭。';
          status.dataset.error = 'false';
          for (const panel of panels.values()) await panel.load(true);
        } catch (error) {
          if (!sheetAlive()) return;
          if (!reportable(error)) { closeSheet(); return; }
          status.textContent = error.message; status.dataset.error = 'true';
        } finally { if (sheetAlive()) save.disabled = false; }
      });
      current.append(form);
    } catch (error) { fail(error); }
  }

  // keep one strip per learning pane; panes that leave are disposed with their strip
  function sync() {
    if (isRetired()) return;
    const live = new Set(panes());
    for (const [pane, panel] of panels) {
      if (!live.has(pane) || !pane.isConnected) { panel.dispose(); panels.delete(pane); }
    }
    for (const pane of live) {
      let panel = panels.get(pane);
      if (!panel || panel.isDead) { panel = createPanel(pane); if (!panel) return; panels.set(pane, panel); }
      panel.mount();
    }
    if (!live.size) {
      // first paint before the native panes mount: one page-scoped strip, removed on dispose
      if (!panels.has(document.body)) {
        const panel = createPanel(document.body);
        if (!panel) return;
        panel.mount();
        // body scope: the strip is attached to the active chat main if one exists
        const root = document.querySelector('.chat-pane-cache__pane--active .chat-main') || document.querySelector('.chat-main');
        if (root && panel.element.parentElement !== root) root.prepend(panel.element);
        panel.element.hidden = !(document.documentElement.dataset.cleRoom === 'learning');
        panels.set(document.body, panel);
      }
    }
  }

  let queued = false;
  const schedule = () => {
    // after retirement nothing may be scheduled again — a frame queued before the abort is what
    // recreated the strip behind the removed one
    if (queued || isRetired()) return;
    queued = true;
    frame = requestAnimationFrame(() => {
      frame = 0;
      queued = false;
      if (isRetired()) return;
      sync();
    });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-cle-room']});
  const tree = new MutationObserver(schedule);
  tree.observe(document.body, {childList: true, subtree: true});
  const unsubscribe = host.subscribe?.(schedule);
  const clockTimer = setInterval(() => {
    if (isRetired() || document.hidden) return;
    for (const panel of panels.values()) panel.clock();
  }, 1000);
  const refreshTimer = setInterval(() => {
    if (isRetired() || document.hidden) return;
    for (const panel of panels.values()) panel.load();
  }, 20000);
  timers.add(clockTimer); timers.add(refreshTimer);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && sheet) { event.stopPropagation(); closeSheet(); } }, {signal});
  const offEvent = host.onEvent('chat', payload => {
    if (isRetired()) return;
    if (String(payload?.sessionKey || '').startsWith('agent:learning:') && ['final', 'aborted', 'error'].includes(payload.state)) {
      for (const panel of panels.values()) panel.load(true);
    }
  });
  sync();
  const retire = () => {
    if (retired) return;
    retired = true;
    observer.disconnect(); tree.disconnect(); unsubscribe?.(); offEvent?.();
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    queued = false;
    for (const timer of timers) clearInterval(timer);
    timers.clear();
    for (const panel of panels.values()) panel.dispose();
    panels.clear();
    closeSheet();
  };
  signal?.addEventListener('abort', retire, {once: true});
  return {panels, get retired() { return isRetired(); }, retire};
}
