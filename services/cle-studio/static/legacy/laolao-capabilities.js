/* laolao-capabilities:v2 —— 设置页里的「定时任务」和「连接器」，以及输入框旁的「深度研究」开关
 *
 * 用的是 OpenClaw 自带的调度器（cron.*）和 MCP 登记（pinkie.connectors.*），这里只是碧琪风格的外壳：
 * 和设置页其它卡片同一套写法（图标标题、圆角选项、粉色按钮），不出现「MCP」「会话 ID」这类工程词。
 * 推送对象从已有的微信 / 飞书 / QQ 聊天里取（pinkie.cron.targets），不用先生手抄 ID。 */
(() => {
  'use strict';
  if (window.__pinkieCapabilities) return;
  const S = 'pinkie-user-settings__';
  const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const request = (name, params = {}, timeout = 20000) => typeof window.__laolaoSidebar?.gwRequest === 'function'
    ? window.__laolaoSidebar.gwRequest(name, params, timeout) : Promise.reject(new Error('还没连上碧琪，稍等一下再试。'));
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
  const ZONE_NAME = {'America/Los_Angeles': '洛杉矶时间', 'America/New_York': '纽约时间', 'Asia/Shanghai': '北京时间', 'Asia/Hong_Kong': '香港时间', 'Asia/Taipei': '台北时间', 'Asia/Tokyo': '东京时间', 'Europe/London': '伦敦时间', UTC: 'UTC'};
  const zoneName = (tz) => ZONE_NAME[tz] || tz;
  const CHANNEL = {'openclaw-weixin': '微信', feishu: '飞书', qqbot: 'QQ', last: '最近聊天的地方'};
  const MODES = [['main', '雅叙'], ['project', '营造'], ['thinking', '堇思'], ['learning', '习作'], ['unrestricted', '挥洒']];
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const pad = (n) => String(n).padStart(2, '0');
  const clock = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  function when(ms) {
    if (!ms) return '';
    const d = new Date(ms), today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / 864e5);
    const day = days === 0 ? '今天' : days === 1 ? '明天' : days === -1 ? '昨天' : (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return day + ' ' + clock(ms);
  }

  /* ── 和设置页一致的小零件 ── */
  function button(label, fn, kind = '') {
    const b = node('button', S + 'button' + (kind ? ' ' + S + 'button--' + kind : ''), label); b.type = 'button';
    if (fn) b.addEventListener('click', async () => { if (b.disabled) return; b.disabled = true; try { await fn(); } finally { b.disabled = false; } });
    return b;
  }
  function textButton(label, fn) {
    const b = node('button', 'pk-cap__link', label); b.type = 'button';
    if (fn) b.addEventListener('click', async () => { if (b.disabled) return; b.disabled = true; try { await fn(); } finally { b.disabled = false; } });
    return b;
  }
  function choices(parent, entries, value, onPick, multi = false) {
    const wrap = node('div', S + 'segments ' + S + 'segments--wrap pk-cap__choices'); parent.append(wrap);
    let current = multi ? new Set(value) : value;
    const nodes = entries.map(([id, label, sub]) => {
      const b = node('button', S + 'choice'); b.type = 'button'; b.dataset.id = id;
      b.append(node('span', '', label)); if (sub) b.append(node('small', 'pk-cap__choice-sub', sub));
      b.addEventListener('click', () => {
        if (multi) { current.has(id) ? current.size > 1 && current.delete(id) : current.add(id); }
        else current = id;
        paint(); onPick?.(multi ? [...current] : current);
      });
      wrap.append(b); return b;
    });
    const paint = () => nodes.forEach((b) => { const on = multi ? current.has(b.dataset.id) : b.dataset.id === current; b.classList.toggle('is-selected', on); b.setAttribute('aria-pressed', String(on)); });
    paint();
    return {get: () => (multi ? [...current] : current), set(v) { current = multi ? new Set(v) : v; paint(); }, wrap};
  }
  function line(parent, title, hint) {
    const row = node('div', 'pk-cap__line'); parent.append(row);
    const label = node('div', 'pk-cap__line-label'); label.append(node('span', '', title)); if (hint) label.append(node('small', '', hint));
    const body = node('div', 'pk-cap__line-body'); row.append(label, body);
    return body;
  }
  function input(parent, type = 'text', value = '', placeholder = '') {
    const i = node(type === 'textarea' ? 'textarea' : 'input', 'pk-cap__input');
    if (type !== 'textarea') i.type = type; else i.rows = 3;
    i.value = value; if (placeholder) i.placeholder = placeholder; parent.append(i); return i;
  }
  function card(parent, icon, title, hint) {
    const s = node('section', S + 'card pk-cap');
    const h = node('header', S + 'card-header');
    // 图标不再用 emoji：字体里的彩色字符既不受主题控制，也不符合线性图标的尺寸与基线。
    // 这里先放空壳，由 CSS 按卡片 id 填线性 SVG（见 capabilities.css）。
    const ic = node('span', S + 'icon', icon || ''); ic.setAttribute('aria-hidden', 'true');
    h.append(ic, node('h3', S + 'card-title', title));
    s.append(h, node('p', S + 'card-hint', hint)); parent.append(s); return s;
  }
  function status(parent) { const n = node('p', S + 'status pk-cap__status'); n.setAttribute('aria-live', 'polite'); parent.append(n); return n; }
  const say = (n, message, kind = '') => { n.textContent = message || ''; n.dataset.state = kind; };
  const attempt = (s, fn, busy = '正在处理…') => async () => { say(s, busy, 'busy'); try { await fn(); } catch (error) { say(s, error?.message || '没有完成，再试一次。', 'error'); } };
  function confirmInline(row, text, yes, onYes) {
    row.querySelector('.pk-cap__confirm')?.remove();
    const box = node('div', 'pk-cap__confirm'); box.append(node('span', '', text));
    const no = textButton('算了', () => box.remove());
    box.append(button(yes, onYes, 'small'), no); row.append(box); no.focus();
  }
  function toggle(on, label, fn) {
    const t = node('button', 'pk-cap__switch'); t.type = 'button'; t.setAttribute('role', 'switch');
    t.setAttribute('aria-checked', String(on)); t.setAttribute('aria-label', label); t.append(node('i'));
    t.addEventListener('click', async () => { if (t.disabled) return; t.disabled = true; try { await fn(!on); } finally { t.disabled = false; } });
    return t;
  }

  /* ── 定时任务 ── */
  function describeSchedule(job) {
    const s = job.schedule || {};
    if (s.kind === 'every') {
      const min = Math.round(s.everyMs / 60000);
      return {big: min % 60 === 0 ? min / 60 + ' 小时' : min + ' 分钟', small: '每隔'};
    }
    if (s.kind === 'at') return {big: clock(Date.parse(s.at)), small: when(Date.parse(s.at)).split(' ')[0] + ' · 一次'};
    const m = String(s.expr || '').match(/^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6](?:,[0-6])*)$/);
    if (m) {
      const days = m[3] === '*' ? '每天' : '每周' + m[3].split(',').map((d) => WEEK[Number(d)]).join('、');
      return {big: pad(m[2]) + ':' + pad(m[1]), small: days};
    }
    return {big: '自定义', small: s.expr || '', mono: true};
  }
  const TEMPLATES = [
    ['早上的天气', '每天早上 8 点', {text: '查一下今天的天气，告诉我要不要带伞、穿什么。', kind: 'daily', time: '08:00'}],
    ['周一的待办', '每周一 9 点', {text: '整理上周没做完的事和这周要注意的安排，列成清单。', kind: 'weekly', time: '09:00', days: ['1']}],
    ['睡前小结', '每晚 10 点', {text: '帮我回顾今天聊过的事，挑出值得记住的三件。', kind: 'daily', time: '22:00'}],
  ];

  function cronPanel(parent) {
    const box = card(parent, '', '定时任务', '让碧琪按时去做一件事，做完把结果推给你。也可以直接在聊天里说「每天早上 8 点把天气发我飞书」。');
    box.id = 'pinkie-schedules';
    const list = node('div', 'pk-cap__list'), sheet = node('div', 'pk-cap__sheet'), bar = node('div', 'pk-cap__bar');
    const out = status(box);
    sheet.hidden = true;
    let editing = null, targets = [], jobsCache = [];

    // 表单
    const what = input(line(sheet, '要碧琪做什么'), 'textarea', '', '例如：查一下今天的天气，告诉我要不要带伞。');
    const whenBody = line(sheet, '什么时候');
    const kind = choices(whenBody, [['daily', '每天'], ['weekly', '每周'], ['every', '每隔一段时间'], ['once', '只一次'], ['cron', '自定义']], 'daily', () => fields());
    const detail = node('div', 'pk-cap__when'); whenBody.append(detail);
    const days = choices(detail, WEEK.map((d, i) => [String(i), '周' + d]).slice(1).concat([['0', '周日']]), ['1'], null, true);
    const time = input(detail, 'time', '08:00');
    const everyRow = node('div', 'pk-cap__inline'); detail.append(everyRow);
    const every = input(everyRow, 'number', '30'); every.min = '1'; every.max = '1440';
    const unit = choices(everyRow, [['m', '分钟'], ['h', '小时']], 'm');
    const once = input(detail, 'datetime-local');
    const expr = input(detail, 'text', '0 8 * * *', '分 时 日 月 周'); expr.classList.add('pk-cap__mono');
    const tzRow = node('div', 'pk-cap__tz'); detail.append(tzRow);
    const tzText = node('span'), tz = input(tzRow, 'text', zone); tz.hidden = true;
    const tzEdit = textButton('换时区', () => { tz.hidden = false; tzEdit.hidden = true; tz.focus(); });
    tzRow.prepend(tzText); tzRow.append(tzEdit);
    const who = choices(line(sheet, '交给谁做', '用哪个模式的碧琪'), MODES, 'main');
    const pushBody = line(sheet, '做完推送到');
    let push = choices(pushBody, [['none', '不推送']], 'none', () => fields());
    const manual = node('div', 'pk-cap__inline pk-cap__manual'); pushBody.append(manual);
    const manualChannel = choices(manual, [['openclaw-weixin', '微信'], ['feishu', '飞书'], ['qqbot', 'QQ']], 'openclaw-weixin');
    const manualTo = input(manual, 'text', '', '对方的账号 ID'); manualTo.classList.add('pk-cap__mono');
    const name = input(line(sheet, '起个名字', '可以不填'), 'text', '', '不填就用要做的事开头几个字');
    const actions = node('div', 'pk-cap__actions');
    const sheetStatus = status(sheet);
    sheet.append(actions);

    function pushChoices(selected) {
      const entries = [['none', '不推送', '只留在任务记录里']];
      for (const t of targets) entries.push([t.channel + '|' + t.to, CHANNEL[t.channel] || t.channel, '尾号 ' + t.tail + (t.at ? ' · ' + when(t.at).split(' ')[0] + '聊过' : '')]);
      entries.push(['last', '最近聊天的地方'], ['manual', '其他…']);
      push.wrap.remove();
      push = choices(pushBody, entries, entries.some(([id]) => id === selected) ? selected : 'none', () => fields());
      pushBody.prepend(push.wrap);
    }
    function fields() {
      const k = kind.get();
      days.wrap.hidden = k !== 'weekly';
      time.hidden = !['daily', 'weekly'].includes(k);
      everyRow.hidden = k !== 'every';
      once.hidden = k !== 'once';
      expr.hidden = k !== 'cron';
      tzRow.hidden = !['daily', 'weekly', 'cron'].includes(k);
      tzText.textContent = '按' + zoneName(tz.value.trim() || zone);
      manual.hidden = push.get() !== 'manual';
    }
    tz.addEventListener('input', fields);
    function open(job, template) {
      editing = job?.id || null;
      say(sheetStatus, '');
      what.value = job?.payload?.message || template?.text || '';
      name.value = job ? (job.displayName || job.name || '') : '';
      who.set(job?.agentId || 'main');
      tz.value = job?.schedule?.tz || zone; tz.hidden = true; tzEdit.hidden = false;
      const s = job?.schedule;
      const m = s?.kind === 'cron' && String(s.expr).match(/^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6](?:,[0-6])*)$/);
      if (s?.kind === 'every') { kind.set('every'); const min = Math.round(s.everyMs / 60000); min % 60 === 0 ? (every.value = min / 60, unit.set('h')) : (every.value = min, unit.set('m')); }
      else if (s?.kind === 'at') { kind.set('once'); const d = new Date(s.at); once.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
      else if (m) { kind.set(m[3] === '*' ? 'daily' : 'weekly'); time.value = pad(m[2]) + ':' + pad(m[1]); days.set(m[3] === '*' ? ['1'] : m[3].split(',')); }
      else if (s?.kind === 'cron') { kind.set('cron'); expr.value = s.expr; }
      else { kind.set(template?.kind || 'daily'); time.value = template?.time || '08:00'; days.set(template?.days || ['1']); }
      const d = job?.delivery;
      let pick = 'none';
      if (d?.mode === 'announce') {
        if (!d.to || d.channel === 'last') pick = 'last';
        else if (targets.some((t) => t.channel === d.channel && t.to === d.to)) pick = d.channel + '|' + d.to;
        else { pick = 'manual'; manualChannel.set(d.channel); manualTo.value = d.to; }
      } else if (!job && targets.length) pick = targets[0].channel + '|' + targets[0].to;
      pushChoices(pick);
      save.textContent = editing ? '保存修改' : '开始定时';
      sheet.hidden = false; addButton.hidden = true; fields();
      sheet.scrollIntoView({block: 'nearest', behavior: 'smooth'});
      what.focus();
    }
    function close() { sheet.hidden = true; editing = null; addButton.hidden = false; }
    function schedule() {
      const k = kind.get();
      if (k === 'every') {
        const n = Number(every.value), min = unit.get() === 'h' ? n * 60 : n;
        if (!Number.isFinite(min) || min < 1 || min > 525600) throw new Error('间隔填 1 分钟到 1 年之间。');
        return {kind: 'every', everyMs: Math.round(min * 60000)};
      }
      if (k === 'once') {
        const at = new Date(once.value);
        if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now()) throw new Error('选一个还没到的时间。');
        return {kind: 'at', at: at.toISOString()};
      }
      const zoneValue = tz.value.trim() || zone;
      try { new Intl.DateTimeFormat('zh-CN', {timeZone: zoneValue}); } catch { throw new Error('这个时区认不出来，例如 Asia/Shanghai。'); }
      if (k === 'cron') {
        if (!/^\S+( \S+){4}$/.test(expr.value.trim())) throw new Error('时间表达式是 5 段：分 时 日 月 周。');
        return {kind: 'cron', expr: expr.value.trim(), tz: zoneValue, staggerMs: 0};
      }
      const [h, m] = time.value.split(':').map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) throw new Error('选一下几点。');
      const dow = k === 'weekly' ? days.get().sort().join(',') : '*';
      return {kind: 'cron', expr: `${m} ${h} * * ${dow}`, tz: zoneValue, staggerMs: 0};
    }
    function delivery() {
      const p = push.get();
      if (p === 'none') return {mode: 'none'};
      if (p === 'last') return {mode: 'announce', channel: 'last'};
      if (p === 'manual') {
        if (!manualTo.value.trim()) throw new Error('填一下对方的账号 ID，或者选上面已有的人。');
        return {mode: 'announce', channel: manualChannel.get(), to: manualTo.value.trim()};
      }
      const t = targets.find((x) => x.channel + '|' + x.to === p);
      return {mode: 'announce', channel: t.channel, to: t.to, ...(t.accountId ? {accountId: t.accountId} : {})};
    }
    const save = button('开始定时', attempt(sheetStatus, async () => {
      const text = what.value.trim();
      if (!text) throw new Error('先写下要碧琪做什么。');
      const label = name.value.trim() || text.replace(/\s+/g, ' ').slice(0, 18);
      const job = editing && jobsCache.find((j) => j.id === editing);
      const patch = {agentId: who.get(), schedule: schedule(), delivery: delivery(),
        payload: {...(job?.payload || {}), kind: 'agentTurn', message: text}};
      if (job) {
        // 只改先生动过的名字：有中文显示名的任务改显示名，内部代号保持不变
        if (label !== (job.displayName || job.name)) patch[job.displayName ? 'displayName' : 'name'] = label;
        await request('cron.update', {id: editing, patch});
      } else {
        await request('cron.add', {...patch, name: label, enabled: true, sessionTarget: 'isolated', wakeMode: 'now', deleteAfterRun: kind.get() === 'once'});
      }
      const edited = !!job;
      close(); await load(); say(out, edited ? '改好了。' : '定好了，到点碧琪会去做。', 'ok');
    }, '正在保存…'), 'primary');
    actions.append(save, textButton('取消', close));

    function row(job) {
      const r = node('article', 'pk-job'); r.dataset.enabled = String(!!job.enabled);
      const w = describeSchedule(job);
      const time = node('div', 'pk-job__when'); time.append(node('b', w.mono ? 'pk-cap__mono' : '', w.big), node('span', '', w.small));
      const main = node('div', 'pk-job__main');
      const title = job.displayName || job.name;
      main.append(node('strong', '', title));
      const text = job.description || job.payload?.message || '';
      if (text) main.append(node('p', 'pk-job__text', text.replace(/\s+/g, ' ')));
      const meta = [];
      const d = job.delivery;
      meta.push(d?.mode === 'announce' ? '推送到' + (CHANNEL[d.channel] || d.channel || '最近聊天的地方') : '不推送');
      meta.push((MODES.find(([id]) => id === job.agentId) || [, job.agentId || '雅叙'])[1] + '模式');
      if (job.enabled && job.state?.nextRunAtMs) meta.push('下次 ' + when(job.state.nextRunAtMs));
      const last = job.state?.lastRunAtMs;
      if (last) meta.push('上次 ' + when(last) + (job.state.lastStatus === 'ok' ? ' 做完了' : job.state.lastStatus ? ' 没做成' : ''));
      main.append(node('small', 'pk-job__meta', meta.join(' · ')));
      const ops = node('div', 'pk-job__ops');
      ops.append(
        textButton('现在做一次', attempt(out, async () => { await request('cron.run', {id: job.id, mode: 'force'}); say(out, '「' + title + '」已经开始了，做完会出现在记录里。', 'ok'); }, '正在叫碧琪…')),
        ...(job.payload?.kind === 'agentTurn' ? [textButton('修改', () => open(job))] : []),
        textButton('记录', attempt(out, async () => { await history(job, r); say(out, ''); }, '正在读取记录…')),
        textButton('删除', () => confirmInline(r, '删掉「' + title + '」？', '删除', attempt(out, async () => { await request('cron.remove', {id: job.id}); await load(); say(out, '删掉了。', 'ok'); }))),
      );
      main.append(ops);
      const sw = toggle(!!job.enabled, (job.enabled ? '暂停' : '启用') + '「' + title + '」', attempt(out, async (on) => { await request('cron.update', {id: job.id, patch: {enabled: on}}); await load(); say(out, on ? '已启用。' : '已暂停。', 'ok'); }));
      r.append(time, main, sw);
      return r;
    }
    async function history(job, r) {
      const result = await request('cron.runs', {id: job.id, scope: 'job', limit: 5, offset: 0, sortDir: 'desc'});
      r.querySelector('.pk-job__history')?.remove();
      const h = node('ol', 'pk-job__history');
      if (!result.entries?.length) h.append(node('li', 'pk-cap__empty', '还没有做过。'));
      for (const run of result.entries || []) {
        const li = node('li'); const ok = run.status === 'ok';
        li.dataset.ok = String(ok);
        li.append(node('b', '', when(run.runAtMs || run.ts || run.startedAtMs)), node('span', '', ok ? '做完了' : run.status === 'error' ? '没做成' : run.status || '进行中'));
        if (run.error || run.summary) li.append(node('p', '', String(run.error || run.summary).replace(/\s+/g, ' ').slice(0, 280)));
        h.append(li);
      }
      r.append(h);
    }
    async function load() {
      const [jobs, state, t] = await Promise.all([
        request('cron.list', {includeDisabled: true, limit: 100, offset: 0}),
        request('cron.status').catch(() => ({})),
        request('pinkie.cron.targets').catch(() => ({targets: []})),
      ]);
      targets = t.targets || [];
      jobsCache = jobs.jobs || [];
      list.replaceChildren();
      if (state.enabled === false) list.append(node('p', 'pk-cap__warn', '调度暂时关着，任务不会自动执行。'));
      if (!jobsCache.length) {
        const empty = node('div', 'pk-cap__empty-box');
        empty.append(node('p', 'pk-cap__empty', '还没有定时任务。从一个例子开始：'));
        const ideas = node('div', 'pk-cap__ideas');
        for (const [title, sub, template] of TEMPLATES) {
          const b = node('button', 'pk-cap__idea'); b.type = 'button';
          b.append(node('b', '', title), node('span', '', sub));
          b.addEventListener('click', () => open(null, template));
          ideas.append(b);
        }
        empty.append(ideas); list.append(empty);
      }
      for (const job of jobsCache) list.append(row(job));
    }
    const addButton = button('＋ 新的定时任务', () => open(null), 'primary');
    bar.append(addButton);
    box.append(list, bar, sheet, out);
    let loaded = false;
    return {load: async () => { if (loaded) return; loaded = true; try { await load(); } catch (error) { loaded = false; say(out, error.message, 'error'); } }};
  }

  /* ── 连接器 ── */
  const FOLDER = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5.5a2 2 0 0 1 2-2h3.3l1.8 2h5.9a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const PLUG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 2.5v4M13 2.5v4M5 6.5h10v3a5 5 0 0 1-10 0zM10 14.5v3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const RECIPES = [
    {id: 'github', title: 'GitHub', mark: 'GH', text: '查仓库、议题和代码', kind: 'token'},
    {id: 'notion', title: 'Notion', mark: 'N', text: '读写你授权的页面', kind: 'oauth'},
    {id: 'files', title: '本地资料夹', svg: FOLDER, text: '只读打开一个文件夹', kind: 'folder'},
    {id: 'custom', title: '其他服务', svg: PLUG, text: '填服务地址接入', kind: 'custom'},
  ];
  const recipeOf = (server) => RECIPES.find((r) => r.id === server.name.replace(/-\d+$/, '')) || RECIPES[3];
  function tile(recipe) {
    const t = node('span', 'pk-tile pk-tile--' + recipe.id); t.setAttribute('aria-hidden', 'true');
    if (recipe.svg) t.innerHTML = recipe.svg; else t.textContent = recipe.mark;
    return t;
  }

  function connectorPanel(parent) {
    const box = card(parent, '', '连接器', '把你自己的账号和资料接给碧琪，他就能直接去查、去读。密钥只存在这台电脑上。');
    box.id = 'pinkie-connectors';
    const list = node('div', 'pk-cap__list'), grid = node('div', 'pk-cap__grid'), sheet = node('div', 'pk-cap__sheet');
    const out = status(box);
    sheet.hidden = true;
    let catalog = [], servers = [], current = null;
    const probed = new Map();

    function uniqueName(base) {
      let n = base, i = 2;
      while (servers.some((s) => s.name === n)) n = base + '-' + i++;
      return n;
    }
    async function pickFolder(field) {
      const bridge = window.webkit?.messageHandlers?.laolaoProjectFolder;
      if (typeof bridge?.postMessage !== 'function') { field.focus(); return; }
      const requestId = crypto.randomUUID();
      const result = await new Promise((resolve) => {
        const previous = window.__laolaoProjectFolderResult;
        let timer;
        const handler = (payload) => {
          if (payload?.requestId !== requestId) { if (typeof previous === 'function') previous(payload); return; }
          clearTimeout(timer); if (window.__laolaoProjectFolderResult === handler) window.__laolaoProjectFolderResult = previous; resolve(payload);
        };
        window.__laolaoProjectFolderResult = handler;
        timer = setTimeout(() => handler({requestId, timeout: true}), 120000);
        try { bridge.postMessage({action: 'choose', context: 'connector', requestId, path: field.value.trim()}); } catch { handler({requestId, error: true}); }
      });
      if (result?.path && String(result.path).startsWith('/')) field.value = result.path;
    }
    function openSheet(recipe) {
      current = recipe;
      grid.querySelectorAll('.pk-cap__recipe').forEach((b) => b.classList.toggle('is-selected', b.dataset.id === recipe.id));
      sheet.replaceChildren();
      const head = node('div', 'pk-cap__sheet-head'); head.append(tile(recipe), node('b', '', '接入 ' + recipe.title));
      sheet.append(head);
      const s = status(sheet);
      const actions = node('div', 'pk-cap__actions');
      const item = catalog.find((c) => c.id === recipe.id);
      let token, folder, url, auth, json;
      if (recipe.kind === 'token') {
        const body = line(sheet, '访问令牌', '在 GitHub 设置里生成');
        token = input(body, 'password', '', 'ghp_… 或 github_pat_…'); token.autocomplete = 'new-password'; token.classList.add('pk-cap__mono');
        if (item?.source) { const a = node('a', 'pk-cap__source', '怎么生成令牌 ↗'); a.href = item.source; a.target = '_blank'; a.rel = 'noopener noreferrer'; body.append(a); }
      } else if (recipe.kind === 'oauth') {
        sheet.append(node('p', 'pk-cap__note', '点「接入」后会打开 Notion 的登录页，你选好要给碧琪看的页面，再把页面给的授权码贴回来就行。'));
      } else if (recipe.kind === 'folder') {
        const body = line(sheet, '哪个文件夹', '碧琪只能读，不会改');
        const rowEl = node('div', 'pk-cap__inline'); body.append(rowEl);
        folder = input(rowEl, 'text', '', '/Users/…/Documents/资料');
        rowEl.append(button('选择…', () => pickFolder(folder), 'small'));
      } else {
        url = input(line(sheet, '服务地址', '以 https:// 开头'), 'url', '', 'https://example.com/mcp'); url.classList.add('pk-cap__mono');
        auth = input(line(sheet, '访问令牌', '没有就不填'), 'password', ''); auth.autocomplete = 'new-password'; auth.classList.add('pk-cap__mono');
        const more = node('details', 'pk-cap__more'); more.append(node('summary', '', '用一段配置接入（高级）'));
        json = input(more, 'textarea', '', '{"command":"npx","args":["-y","…"]}'); json.classList.add('pk-cap__mono'); json.rows = 4;
        sheet.append(more);
      }
      const connect = button('接入', attempt(s, async () => {
        let config;
        if (recipe.kind === 'custom') {
          if (json.value.trim()) { try { config = JSON.parse(json.value); } catch { throw new Error('这段配置不是有效的 JSON。'); } }
          else {
            if (!/^https?:\/\//.test(url.value.trim())) throw new Error('填一下服务地址。');
            config = {url: url.value.trim(), transport: 'streamable-http'};
            if (auth.value.trim()) config.headers = {Authorization: 'Bearer ' + auth.value.trim()};
          }
        } else {
          if (!item) throw new Error('列表还没读到，稍等再试。');
          config = structuredClone(item.config);
          if (recipe.kind === 'token') { if (!token.value.trim()) throw new Error('贴一下你的 GitHub 令牌。'); config.headers = {Authorization: 'Bearer ' + token.value.trim()}; }
          if (recipe.kind === 'folder') { if (!folder.value.trim().startsWith('/')) throw new Error('选一个文件夹，或者贴完整路径。'); config.args = [...config.args, folder.value.trim()]; }
        }
        let host = '';
        try { host = config.url ? new URL(config.url).hostname.split('.').slice(-2, -1)[0] || '' : ''; } catch {}
        const nameBase = recipe.kind === 'custom' ? (host || 'service').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'service' : recipe.id;
        const name = uniqueName(nameBase);
        await request('pinkie.connectors.save', {name, config});
        if (token) token.value = ''; if (auth) auth.value = '';
        await load();
        sheet.hidden = true; current = null;
        grid.querySelectorAll('.pk-cap__recipe').forEach((b) => b.classList.remove('is-selected'));
        say(out, '接好了「' + recipe.title + '」，新开的对话里碧琪就能用。', 'ok');
        const server = servers.find((x) => x.name === name);
        if (server?.auth === 'oauth') list.querySelector(`[data-name="${CSS.escape(name)}"] [data-login]`)?.click();
      }, '正在接入…'), 'primary');
      actions.append(connect, textButton('取消', () => { sheet.hidden = true; grid.querySelectorAll('.pk-cap__recipe').forEach((b) => b.classList.remove('is-selected')); }));
      sheet.append(actions);
      sheet.hidden = false;
      (token || folder || url || connect).focus();
    }
    function serverRow(server) {
      const recipe = recipeOf(server);
      const r = node('article', 'pk-conn'); r.dataset.name = server.name;
      const main = node('div', 'pk-conn__main');
      const probe = probed.get(server.name);
      const state = !server.enabled ? ['off', '已暂停'] : probe?.ok ? ['on', '能用 · ' + probe.tools + ' 个功能'] : probe ? ['bad', '连不上'] : ['idle', '还没测试'];
      const head = node('div', 'pk-conn__head');
      head.append(node('strong', '', server.name === recipe.id ? recipe.title : server.name));
      const dot = node('span', 'pk-conn__state', state[1]); dot.dataset.state = state[0]; head.append(dot);
      main.append(head, node('small', 'pk-conn__meta', server.url || [server.command].filter(Boolean).join(' ') || ''));
      const ops = node('div', 'pk-job__ops');
      const test = textButton('测试', attempt(out, async () => {
        const result = await request('pinkie.connectors.probe', {name: server.name}, 70000);
        const st = result.servers?.[server.name];
        if (!st || result.diagnostics?.length) {
          probed.set(server.name, {ok: false});
          renderList();
          throw new Error(result.diagnostics?.map((d) => d.message).join('；') || '连不上，检查一下地址和授权。');
        }
        probed.set(server.name, {ok: true, tools: st.tools ?? 0});
        renderList(); say(out, '「' + server.name + '」能用，有 ' + (st.tools ?? 0) + ' 个功能。', 'ok');
      }, '正在连接…'));
      ops.append(test);
      if (server.auth === 'oauth') {
        const login = textButton('登录授权', attempt(out, async () => {
          const result = await request('pinkie.connectors.login', {name: server.name}, 70000);
          r.querySelector('.pk-conn__oauth')?.remove();
          if (result.authorized) { say(out, '已经授权过了，点「测试」看看。', 'ok'); return; }
          if (!result.url || !/^https:\/\//.test(result.url)) throw new Error('没拿到登录页面，稍后再试。');
          const o = node('div', 'pk-conn__oauth');
          const a = node('a', S + 'button ' + S + 'button--primary', '打开登录页 ↗'); a.href = result.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
          const code = input(o, 'text', '', '登录后页面给的授权码'); code.classList.add('pk-cap__mono');
          o.prepend(a);
          o.append(button('完成', attempt(out, async () => {
            const v = await request('pinkie.connectors.login', {name: server.name, code: code.value.trim()}, 70000);
            if (!v.authorized) throw new Error('授权还没完成，检查一下授权码。');
            o.remove(); say(out, '授权好了，点「测试」看看。', 'ok');
          }, '正在确认…'), 'small'));
          r.append(o); say(out, '在打开的页面里登录，再把授权码贴回来。');
        }, '正在打开登录…'));
        login.dataset.login = '';
        ops.append(login);
      }
      ops.append(textButton('移除', () => confirmInline(r, '移除「' + server.name + '」？碧琪以后就用不了它了。', '移除', attempt(out, async () => { await request('pinkie.connectors.remove', {name: server.name}); await load(); say(out, '移除了。', 'ok'); }))));
      main.append(ops);
      const sw = toggle(!!server.enabled, (server.enabled ? '暂停' : '启用') + '「' + server.name + '」', attempt(out, async (on) => { await request('pinkie.connectors.toggle', {name: server.name, enabled: on}); await load(); say(out, on ? '已启用，新开的对话里生效。' : '已暂停。', 'ok'); }));
      r.append(tile(recipe), main, sw);
      return r;
    }
    function renderList() {
      list.replaceChildren(...servers.map(serverRow));
      grid.querySelectorAll('.pk-cap__recipe').forEach((b) => {
        const has = b.dataset.id !== 'custom' && servers.some((s) => recipeOf(s).id === b.dataset.id);
        b.querySelector('.pk-cap__recipe-tag')?.remove();
        if (has) b.append(node('span', 'pk-cap__recipe-tag', '已接入'));
      });
    }
    async function load() {
      const result = await request('pinkie.connectors.list');
      catalog = result.catalog || []; servers = result.servers || [];
      renderList();
    }
    const label = node('p', 'pk-cap__sub', '可以接入');
    for (const recipe of RECIPES) {
      const b = node('button', 'pk-cap__recipe'); b.type = 'button'; b.dataset.id = recipe.id;
      const copy = node('span', 'pk-cap__recipe-copy'); copy.append(node('b', '', recipe.title), node('small', '', recipe.text));
      b.append(tile(recipe), copy);
      b.addEventListener('click', () => openSheet(recipe));
      grid.append(b);
    }
    box.append(list, label, grid, sheet, out);
    let loaded = false;
    return {load: async () => { if (loaded) return; loaded = true; try { await load(); } catch (error) { loaded = false; say(out, error.message, 'error'); } }};
  }

  let panels = null, parent = null;
  function mount(target) {
    if (!target || target.querySelector('#pinkie-connectors')) return;
    parent = target;
    const holder = node('div', 'pk-capabilities'); const footer = target.querySelector('.' + S + 'footer'); footer ? footer.before(holder) : target.append(holder);
    panels = [cronPanel(holder), connectorPanel(holder)];
    checkVisible();
  }
  function checkVisible() {
    if (panels && parent?.closest('#cle-utilities')?.hidden === false) for (const panel of panels) void panel.load();
  }
  /* ── 输入框旁的「深度研究」开关 ──
   * 打开后，下一条消息按深度研究来做（网关在生成提示词时加上要求）；发出去、做完就自动关。
   * 不拦截发送：思考强度、网页 GPT、首页各有自己的发送拦截，这里只在网关做记号。 */
  const RESEARCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/><path class="laolao-research-btn__spark" d="M10.5 7.6l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z"/></svg>';
  const researchKey = (n) => window.__laolaoSidebar?.currentSessionKey?.() || window.__laolaoRichApi?.sessionFor?.(n) || new URL(location.href).searchParams.get('session') || '';
  const researchState = new Map();   // sessionKey → armed
  function paintResearch(btn, on) {
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('is-on', on);
    btn.title = on ? '下一条消息会做深度研究（再点一下取消）' : '深度研究：查资料、交叉核对，写成带来源的报告';
  }
  function researchButton(actions) {
    const btn = node('button', 'laolao-research-btn'); btn.type = 'button';
    btn.innerHTML = RESEARCH_ICON + '<span>深度研究</span>';
    btn.setAttribute('aria-label', '深度研究');
    btn.addEventListener('click', async () => {
      const key = researchKey(btn);
      if (!key || btn.disabled) return;
      const on = !btn.classList.contains('is-on');
      btn.disabled = true; paintResearch(btn, on);
      try { const r = await request('pinkie.research.arm', {sessionKey: key, on}, 8000); researchState.set(key, !!r.armed); paintResearch(btn, !!r.armed); }
      catch { paintResearch(btn, !on); window.__laolaoToast?.('深度研究开关暂时不可用'); }
      finally { btn.disabled = false; }
      if (on) btn.closest('.agent-chat__input')?.querySelector('textarea')?.focus();
    });
    actions.append(btn);
    return btn;
  }
  async function syncResearch(btn) {
    const key = researchKey(btn);
    if (!key) return;
    if (btn.dataset.key !== key) { btn.dataset.key = key; paintResearch(btn, !!researchState.get(key)); }
    try { const r = await request('pinkie.research.status', {sessionKey: key}, 6000); researchState.set(key, !!r.armed); if (btn.dataset.key === key) paintResearch(btn, !!r.armed); } catch {}
  }
  function mountResearch() {
    for (const actions of document.querySelectorAll('.chat-pane-cache__pane--active .agent-chat__composer-lead')) {
      let btn = actions.querySelector(':scope > .laolao-research-btn');
      if (!btn) { btn = researchButton(actions); void syncResearch(btn); }
      else if (btn.dataset.key !== researchKey(btn)) void syncResearch(btn);
    }
  }
  // 发出去之后记号就被这一条用掉了：按钮跟着熄灭（以网关为准）
  window.addEventListener('pinkie:gateway-event', (event) => {
    const p = event.detail?.payload;
    if (!p || event.detail.event !== 'chat' || !p.sessionKey) return;
    for (const btn of document.querySelectorAll('.laolao-research-btn.is-on')) if (btn.dataset.key === p.sessionKey) void syncResearch(btn);
  });
  setInterval(mountResearch, 1000);
  mountResearch();

  window.__pinkieCapabilities = {mount};
  window.addEventListener('pinkie:settings-ready', (event) => mount(event.detail));
  const ready = () => mount(document.querySelector('#laolao-user-settings .' + S + 'scroll'));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once: true}); else ready();
  setInterval(checkVisible, 1200);
})();
