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

export function mountStudy(host, signal) {
  const request = (method, params = {}) => host.request(method, params);
  let today = null, focus = null, loading = false, sheet = null, backFocus = null;
  let lastLoaded = 0, refreshTimer = 0;
  const visible = () => document.documentElement.dataset.cleRoom === 'learning';
  const strip = node('section', 'cle-study');
  strip.setAttribute('aria-label', '今日学习');
  const summary = node('div', 'cle-study__summary');
  const eyebrow = node('span', 'cle-study__eyebrow');
  eyebrow.innerHTML = '<b>习作</b><em>Étude · 今日</em>';
  const progress = node('span', 'cle-study__progress', '正在读取学习进度…');
  const streak = node('span', 'cle-study__streak');
  const timer = node('span', 'cle-study__timer');
  const notice = node('div', 'cle-study__notice'); notice.setAttribute('role', 'status');
  const focusButton = action('专注 25 分钟', async () => {
    focusButton.disabled = true;
    try {
      if (focus) {
        const result = await request('pinkie.learning.focus.stop', {id: focus.id});
        focus = null; today = result.today;
        say(result.minutes ? `这一轮记下了 ${result.minutes} 分钟。` : '未满一分钟，这轮没有增加时长。');
      } else {
        const result = await request('pinkie.learning.focus.start', {minutes: 25});
        focus = result.focus; say('计时开始。先专心做眼前这一小步。');
      }
      paint();
    } catch (error) { say(error.message, true); }
    finally { focusButton.disabled = false; }
  });
  const settings = action('学习约定', () => openSheet());
  summary.append(eyebrow, progress, streak, timer);
  const buttons = node('div', 'cle-study__actions'); buttons.append(focusButton, settings);
  strip.append(summary, buttons, notice);

  function say(text, error = false) {
    notice.textContent = text; notice.dataset.error = String(error); notice.hidden = !text;
  }
  function clock() {
    if (!focus) { timer.textContent = ''; return; }
    const seconds = Math.max(0, Math.floor((Date.now() - focus.start) / 1000));
    const remaining = Math.max(0, focus.plannedMinutes * 60 - seconds);
    timer.textContent = remaining > 0 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : '本轮到时';
    timer.setAttribute('aria-label', remaining > 0 ? `专注还剩 ${Math.ceil(remaining / 60)} 分钟` : '本轮专注已到时间，可以结束计时');
  }
  function paint() {
    if (today) {
      const p = today.progress;
      // three gauges: what the pact asks for today, and how much of it is real
      const gauge = (label, value, goal, unit, invert = false) => {
        const k = invert ? (value ? 0 : 1) : goal ? Math.min(1, value / goal) : 1;
        const g = node('span', 'cle-study__gauge'); g.dataset.done = String(k >= 1);
        g.innerHTML = `<span class="cle-study__gauge-label"></span><span class="cle-study__gauge-value"></span><i style="--k:${k.toFixed(3)}"></i>`;
        g.firstChild.textContent = label; g.children[1].textContent = invert ? `${value} ${unit}` : `${value}/${goal} ${unit}`;
        return g;
      };
      progress.replaceChildren(gauge('专注', p.minutes, today.goals.minutes, '分钟'), gauge('做题', p.questions, today.goals.questions, '道'), gauge('待复习', p.dueReviews, 0, '张', true));
      progress.setAttribute('aria-label', `${p.minutes}/${today.goals.minutes} 分钟 · ${p.questions}/${today.goals.questions} 道题 · ${p.dueReviews} 张待复习`);
      strip.dataset.complete = String(today.complete);
      // the streak is a row of blossoms he has kept; seven at most, then a number
      const n = today.streak.current || 0;
      streak.replaceChildren(...Array.from({length: Math.min(7, n)}, () => node('i', 'cle-study__bloom')), node('span', '', n ? `连续 ${n} 天` : '今天开个头'));
      streak.title = today.complete ? '今日已完成' : `连续 ${n} 天`;
      eyebrow.querySelector('em').textContent = today.complete ? 'Étude · 今日已完成' : 'Étude · 今日';
    }
    focusButton.textContent = focus ? '结束本轮' : '专注 25 分钟'; clock();
  }
  async function load(force = false) {
    if (loading || !visible() || (!force && Date.now() - lastLoaded < 15000)) return;
    loading = true;
    try {
      const [day, status] = await Promise.all([request('pinkie.learning.today'), request('pinkie.learning.focus.status')]);
      if (signal.aborted) return;
      today = day; focus = status.active; lastLoaded = Date.now(); paint();
    } catch (error) { say(`暂时读不到学习进度：${error.message}`, true); }
    finally { loading = false; }
  }
  function mount() {
    strip.hidden = !visible();
    if (!visible()) { closeSheet(); return; }
    const root = document.querySelector('.chat-pane-cache__pane--active .chat-main') || document.querySelector('.chat-main');
    if (root && strip.parentElement !== root) root.prepend(strip);
    load();
  }
  function closeSheet() {
    if (!sheet) return;
    sheet?.remove(); sheet = null;
    if (backFocus?.isConnected) backFocus.focus({preventScroll: true});
  }
  async function openSheet() {
    if (sheet || !visible()) return;
    backFocus = document.activeElement;
    const current = node('aside', 'cle-study-sheet'); sheet = current;
    current.setAttribute('role', 'dialog'); current.setAttribute('aria-modal', 'false');
    current.setAttribute('aria-label', '学习约定');
    const header = node('header', 'cle-study-sheet__header');
    const heading = node('div'); heading.append(node('p', 'cle-label', 'LE PACTE'), node('h2', '', '每天，把约定做完。'));
    header.append(heading, action('关闭', closeSheet));
    const status = node('p', 'cle-study-sheet__status', '正在读取…'); status.setAttribute('role', 'status');
    current.append(header, status); document.body.append(current);
    current.querySelector('button').focus();
    try {
      const [day, history, receivers, schedules] = await Promise.all([
        request('pinkie.learning.today'), request('pinkie.learning.history', {days: 28}),
        request('pinkie.cron.targets').catch(() => ({targets: []})),
        request('cron.list', {includeDisabled: true}).catch(() => ({jobs: []})),
      ]);
      if (sheet !== current || signal.aborted) return;
      today = day; paint();
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
        event.preventDefault(); save.disabled = true;
        const selected = targets.find(item => `${item.channel}|${item.to}` === target.value);
        const split = target.value.indexOf('|');
        const channel = split >= 0 ? {kind: target.value.slice(0, split), to: target.value.slice(split + 1)} : {kind: 'none', to: null};
        try {
          const {pact: updated} = await request('pinkie.learning.pact.set', {patch: {
            daily: {minutes: Number(minutes.value), questions: Number(questions.value), reviews: fields.reviews.value},
            intensity: fields.intensity.value, exam: {date: fields.exam.value || null}, timezone: fields.timezone.value.trim(),
            reminders: {morning: fields.morning.value, evening: fields.evening.value, lastCall: fields.lastCall.value}, channel,
          }});
          try { await syncReminders(request, updated, enable.checked, selected || {}); }
          catch (error) { throw new Error(`学习目标已保存，提醒尚未同步：${error.message}`); }
          status.textContent = enable.checked ? '已保存。到点会按当天的实际进度提醒你。' : '已保存学习约定，定时提醒已关闭。';
          status.dataset.error = 'false'; await load(true);
        } catch (error) { status.textContent = error.message; status.dataset.error = 'true'; }
        finally { save.disabled = false; }
      });
      current.append(form);
    } catch (error) { if (sheet === current) { status.textContent = error.message; status.dataset.error = 'true'; } }
  }

  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-cle-room']});
  const unsubscribe = host.subscribe?.(mount);
  const roomMount = new MutationObserver(() => { if (visible() && !strip.isConnected) mount(); });
  roomMount.observe(document.body, {childList: true, subtree: true});
  const clockTimer = setInterval(() => { if (visible() && !document.hidden) clock(); }, 1000);
  refreshTimer = setInterval(() => { if (!document.hidden) load(); }, 20000);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && sheet) { event.stopPropagation(); closeSheet(); } }, {signal});
  const offEvent = host.onEvent('chat', payload => {
    if (String(payload?.sessionKey || '').startsWith('agent:learning:') && ['final', 'aborted', 'error'].includes(payload.state)) load(true);
  });
  mount();
  signal.addEventListener('abort', () => {
    observer.disconnect(); roomMount.disconnect(); unsubscribe?.(); offEvent?.();
    clearInterval(clockTimer); clearInterval(refreshTimer); strip.remove(); closeSheet();
  }, {once: true});
}
