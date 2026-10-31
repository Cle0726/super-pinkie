/* 碧琪手账 v2 · 学习台这一侧的陪伴层（briefs/study-desk-v2/PLAN.md §3.2、§4）：
   今日页的碧琪每天一句、剪报、今晚收的便签（带出处）、带着今天的考点问碧琪；看板「本月」月历。
   全部按北京时间（后端算好给过来）。每样东西只在今日页打开时请求一次，没有定时器。 */
(() => {
  'use strict';
  if (window.__pinkieDeskHandbook) return;
  const kit = () => window.__pinkieDeskKit;
  const desk = () => window.__pinkieStudyDesk;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const beijingDay = (at = Date.now()) => new Date(at + 8 * 3_600_000).toISOString().slice(0, 10);
  const pointRef = focus => focus?.payload?.k && Number.isInteger(focus.payload.i) ? `point:${focus.payload.k}.${focus.payload.i}` : '';

  // ---------- 碧琪每天一句：替换今日页气泡；模型写的和模板的标出来源 ----------
  async function daily(host, request) {
    const bubble = host.querySelector('.bubble'); if (!bubble) return;
    const paint = result => {
      const line = result?.line; if (!line?.text || !bubble.isConnected) return;
      bubble.textContent = line.text;
      bubble.dataset.source = line.source;
      bubble.append(el('small', 'pk-daily-by', line.source === 'model' ? '碧琪今天写给你的' : '碧琪随手写的'));
    };
    try {
      const first = await request('pinkie.learning.desk.companion', {});
      paint(first);
      // 当天第一次打开：先给模板，等碧琪写好（一次请求，最多 40 秒）再换上。
      if (first?.line?.pending) paint(await request('pinkie.learning.desk.companion', {wait: true}, 40_000));
    } catch {}
  }

  // ---------- 剪报：外面的世界。考前 7 天、深夜后端不给 ----------
  function clipping(clip, {small = false, onSave} = {}) {
    const k = kit(), card = el('article', 'pk-clip' + (small ? ' pk-clip--small' : ''));
    card.append(el('small', 'pk-clip-src', [clip.source, clip.publishedAt].filter(Boolean).join(' · ')));
    const title = el('a', 'pk-clip-title', clip.title); title.href = clip.url; title.target = '_blank'; title.rel = 'noopener noreferrer';
    card.append(title);
    if (!small) {
      card.append(el('p', 'pk-clip-sum', clip.summary));
      if (clip.quote) card.append(el('q', 'pk-clip-quote', clip.quote));
      if (clip.note) card.append(k.note(clip.note, {by: ''}));
      const row = el('div', 'pk-clip-row');
      const open = el('a', 'pk-link', '读原文 ↗'); open.href = clip.url; open.target = '_blank'; open.rel = 'noopener noreferrer';
      row.append(open);
      if (onSave) {
        const save = k.button('收进剪报本', async () => {
          save.disabled = true;
          try { await onSave(clip); save.replaceWith(k.stamp('已收', {size: 'sm', animateIn: true})); }
          catch (error) { save.disabled = false; save.title = error.message; }
        }, {kind: 'link'});
        row.append(save);
      }
      card.append(row);
    }
    return card;
  }
  async function clippings(slot, request) {
    try {
      let result = await request('pinkie.learning.desk.clippings', {});
      if (result?.hidden) return;
      if (result?.status === 'running') result = await request('pinkie.learning.desk.clippings', {wait: true}, 270_000);
      if (!slot.isConnected || result?.status !== 'ok' || !result.clippings?.length) return;
      let saved = new Set();
      try { saved = new Set((await request('pinkie.learning.desk.clippings.saved', {})).clips?.map(clip => clip.url)); } catch {}
      const box = el('section', 'pk-clips'); box.setAttribute('aria-label', '剪报');
      box.append(el('h4', 'pk-clips-h', '剪报'));
      // 第一张展开，第二张只留标题；节日当天整块缩到一行。
      result.clippings.slice(0, result.small ? 1 : 2).forEach((clip, i) => {
        box.append(clipping(clip, {small: result.small || i > 0, onSave: saved.has(clip.url) ? null : value => request('pinkie.learning.desk.clippings.save', {clip: value})}));
      });
      slot.replaceChildren(box); fit(slot.closest('.view'));
    } catch {}
  }

  // ---------- 今晚收的：从聊天里收进手账的东西，点「出处」回到那条消息 ----------
  async function tonight(slot, request) {
    try {
      const [{receipts = []}, {memos = []}] = await Promise.all([request('pinkie.learning.ref.receipts', {recent: true}), request('pinkie.learning.ref.memos', {})]);
      const today = beijingDay();
      const list = receipts.filter(r => !r.undone && r.action === 'collect' && beijingDay(r.at) === today).slice(0, 4);
      if (!slot.isConnected || (!list.length && !memos.length)) return;
      const k = kit(), box = el('section', 'pk-tonight-list'); box.setAttribute('aria-label', '今晚收的');
      box.append(el('h4', '', '今晚收的'));
      const ul = el('ul');
      for (const r of list) {
        const li = el('li');
        li.append(k.stamp(r.targetLabel?.replace('本', '') || '收', {size: 'sm', tone: r.by === 'biqi' ? 'pink' : 'ink'}), el('span', '', r.title || r.text || ''));
        if (r.origin?.messageId) li.append(k.button('出处', () => { window.__pinkieDeskChat?.reveal?.(r.origin); }, {kind: 'link'}));
        ul.append(li);
      }
      // 昨天收进「明天计划」的便签，今天拿出来。
      if (memos.length) { const li = el('li'); li.append(k.stamp('便签', {size: 'sm', tone: 'ink'}), el('span', '', '昨天留给今天：' + memos.map(m => m.text).join('；'))); ul.append(li); }
      box.append(ul); slot.replaceChildren(box); fit(slot.closest('.view'));
    } catch {}
  }

  // ---------- 带着今天的考点问碧琪：输入框左边一枚可以按下的小条目卡 ----------
  const armed = new WeakMap();
  function askChip(host, data) {
    const ask = host.querySelector('form.ask'), ref = pointRef(data.focus), k = kit();
    if (!ask || !ref || !k) return;
    const title = String(data.focus.title || '').replace(/^(?:学|继续上课|继续)\s*·\s*/, '');
    const chip = k.refChip({kind: 'point', title}, {onOpen: () => {
      const on = !armed.get(ask); armed.set(ask, on ? ref : '');
      chip.setAttribute('aria-pressed', String(on)); ask.querySelector('input')?.focus();
    }});
    chip.classList.add('pk-ask-ref'); chip.setAttribute('aria-pressed', 'false');
    chip.title = '按下：这条消息带上这个考点的真实记录';
    const row = el('div', 'pk-ask-refs'); row.append(el('small', '', '问碧琪时带上'), chip);
    ask.before(row);
  }
  // 今日页的发送框调用：按下了条目卡就在消息末尾附上隐藏标记，后端换成真实记录。发完就松开。
  function withRefs(text, form) {
    const ref = form && armed.get(form);
    if (!ref || !String(text || '').trim()) return text;
    armed.set(form, '');
    form.parentElement?.querySelector('.pk-ask-ref')?.setAttribute('aria-pressed', 'false');
    return `${String(text).trim()}\n\n[[DESK_REF_V1 ${ref}]]`;
  }

  // ---------- 放不下时一级一级收：剪报只留标题 → 各留一条 → 不列今晚收的 → 不贴剪报 → 不显示「带上」 ----------
  // 只在新东西放进来、窗口大小变了时量一次（几次同步布局），不跑循环。发送框和碧琪始终留在页面里。
  const FIT_LEVELS = 5;
  function fit(host) {
    if (!host.isConnected) return;
    const left = host.querySelector('.h-left'); if (!left) return;
    // 量布局盒子（offsetTop / offsetHeight 不算 transform）：页面刚打开时各块还在做入场位移，scrollHeight 会虚高。
    const limit = host.clientHeight - (parseFloat(getComputedStyle(host).paddingBottom) || 0) + 1;
    const over = () => [...left.children].some(n => n.offsetParent === host && n.offsetHeight && n.offsetTop + n.offsetHeight > limit);
    for (let level = 0; level <= FIT_LEVELS; level++) {
      if (level) host.dataset.pkFit = String(level); else delete host.dataset.pkFit;
      if (!over()) return;
    }
  }
  let fitTimer = 0, fitHost = null;
  window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { if (fitHost?.isConnected) fit(fitHost); }, 120); });

  // ---------- 今日页挂件（laolao-study-desk.js 的 mountToday 在页面画好后调用） ----------
  function today(host, data, ctx) {
    if (!kit() || !host?.isConnected) return;
    const request = (method, params = {}, timeout) => ctx.request(method, params, timeout);
    const left = host.querySelector('.h-left'), row = host.querySelector('.desk-date-row');
    const hero = data.almanac?.protagonist;
    host.classList.add('pk-ink'); if (hero?.tape) host.dataset.tape = hero.tape;
    if (row && !row.querySelector('.pk-month-link')) {
      const link = kit().button('本月 →', () => ctx.go('month'), {kind: 'link'}); link.classList.add('pk-month-link'); row.append(link, kit().button('剪报本', () => ctx.go('clippings'), {kind: 'link'}));
    }
    // 发送框靠 margin-top:auto 压在左栏底部；新加的几块按固定顺序放在它上面，谁先回来都不乱。
    const ask = left?.querySelector('form.ask');
    if (left && ask) {
      const slots = ['pk-slot-tonight', 'pk-slot-clips'].map(cls => el('div', cls));
      for (const slot of slots) left.insertBefore(slot, ask);
      void tonight(slots[0], request); void clippings(slots[1], request);
    }
    askChip(host, data);
    fitHost = host; fit(host);
    void daily(host, request);
  }

  // ---------- 本月：手账月历跨页 ----------
  const WEEK = ['一', '二', '三', '四', '五', '六', '日']; // 国内的手账从周一排起
  function mountMonth(host, ctx) {
    const k = kit(); host.classList.add('pk-ink', 'pk-month');
    let month = '';
    const render = async () => {
      host.setAttribute('aria-busy', 'true');
      let data;
      try { data = await ctx.request('pinkie.learning.desk.month', month ? {month} : {}); }
      catch (error) { if (host.isConnected) { host.replaceChildren(el('p', 'desk-loading', error.message), k.button('重试', render, {kind: 'link'})); } return; }
      if (!host.isConnected) return;
      month = data.month; host.replaceChildren(); host.setAttribute('aria-busy', 'false');
      const [y, m] = data.month.split('-').map(Number);
      const head = el('header', 'pk-month-head'), titles = el('div');
      titles.append(el('div', 'pk-kicker', `看板 · 本月 · 学了 ${data.studiedDays} 天`), el('h2', 'pk-title', `${y} 年 ${m} 月`));
      const nav = el('div', 'pk-month-nav');
      nav.append(k.button('← 上个月', () => { month = data.prev; void render(); }, {kind: 'link'}),
        ...(data.month !== data.today.slice(0, 7) ? [k.button('回到这个月', () => { month = ''; void render(); }, {kind: 'link'})] : []),
        k.button('下个月 →', () => { month = data.next; void render(); }, {kind: 'link'}),
        k.button('回今日', () => ctx.go('today'), {kind: 'ink', size: 'sm'}));
      head.append(titles, nav);
      const grid = el('div', 'pk-cal'); grid.setAttribute('role', 'grid'); grid.setAttribute('aria-label', `${y} 年 ${m} 月月历`);
      for (const w of WEEK) grid.append(el('div', 'pk-cal-wd', w));
      for (let i = 0; i < (data.days[0].weekday + 6) % 7; i++) grid.append(el('div', 'pk-cal-pad'));
      for (const day of data.days) {
        const cell = el('div', 'pk-cal-day'); cell.setAttribute('role', 'gridcell');
        if (day.today) cell.dataset.today = ''; if (day.future) cell.dataset.future = ''; if (day.off) cell.dataset.off = '';
        if ([0, 6].includes(day.weekday)) cell.dataset.weekend = '';
        const num = el('b', 'pk-cal-n', String(day.day)); if (day.exams.length) num.dataset.exam = '';
        const top = el('div', 'pk-cal-top'); top.append(num, el('small', 'pk-cal-lunar', day.lunar));
        cell.append(top);
        const tags = [...new Set([...day.exams, day.birthday ? '生日' : '', day.anniversary ? '纪念日' : '', day.term, ...day.festivals, day.off ? '休' : '', day.workday ? '班' : ''].filter(Boolean))];
        if (tags.length) cell.append(el('small', 'pk-cal-tag', tags.slice(0, 2).join(' · ')));
        if (day.studied) {
          const mark = el('div', 'pk-cal-mark');
          mark.append(k.stars(Array(day.stars).fill('full'), {label: `学过，${day.stars} 颗星`}));
          if (day.minutes) mark.append(el('small', '', `${day.minutes} 分`));
          cell.append(mark);
        }
        if (day.milestone) { cell.dataset.milestone = ''; cell.append(el('small', 'pk-cal-milestone', day.milestone)); }
        const label = [`${m} 月 ${day.day} 日`, day.lunar, ...tags, day.studied ? `学过 ${day.answered} 题` : '', day.milestone].filter(Boolean).join('，');
        cell.setAttribute('aria-label', label); cell.title = label;
        grid.append(cell);
      }
      const legend = el('div', 'pk-cal-legend');
      legend.append(el('span', '', '星星越多，那天学得越扎实'), el('span', 'pk-cal-key-exam', '圈出来的是考试日'), el('span', '', '铅笔小字是农历、节气、节日'));
      host.append(head, grid, legend);
    };
    void render();
  }

  function mountClippings(host, ctx) {
    host.classList.add('pk-clippings'); let alive = true;
    const load = async () => {
      host.replaceChildren(el('p', '', '正在翻剪报本…'));
      try {
        const {clips = []} = await ctx.request('pinkie.learning.desk.clippings.saved'); if (!alive || !host.isConnected) return;
        const header = el('header', 'pk-month-head'); header.append(el('h2', 'pk-title', '剪报本'), kit().button('回今日', () => ctx.go('today'), {kind:'link'}));
        host.replaceChildren(header);
        if (!clips.length) host.append(el('p', 'pk-note', '喜欢的报道收进来以后，会一直留在这里。'));
        for (const clip of clips) { const article = clipping(clip), remove = kit().button('取消收藏', async () => { await ctx.request('pinkie.learning.desk.clippings.unsave', {url:clip.url}); await load(); }, {kind:'link'}); article.append(remove); host.append(article); }
      } catch (error) { if (alive) host.replaceChildren(el('p', '', error.message), kit().button('重试', load, {kind:'link'})); }
    }; void load(); return {unmount(){alive=false;}};
  }
  desk()?.registerView('clippings', {title:'剪报本', mount:mountClippings});
  desk()?.registerView('entry', {title:'手账条目', mount(host,ctx) {
    let alive=true; const ref=ctx.local().entryRef;
    host.classList.add('pk-entry');host.append(el('p','', '正在翻到这条记录…'));
    ctx.request('pinkie.learning.ref.resolve',{refs:[ref],details:true}).then(result=>{
      if(!alive||!host.isConnected)return; const card=result.cards?.[0];
      if(!card?.ok)throw Error(card?.error||'这条记录已经不在了');
      const heading=el('header','pk-month-head');heading.append(el('h2','pk-title',card.title),kit().button('回今日',()=>ctx.go('today'),{kind:'link'}));
      const body=el('div','pk-entry-body',card.detail||card.subtitle||''),actions=el('footer','pk-entry-actions');
      actions.append(kit().button('问碧琪',()=>ctx.desk.askRef(ref,card.title)));
      if(card.origin)actions.append(kit().button('回到出处',()=>window.__pinkieDeskChat?.reveal(card.origin),{kind:'link'}));
      if(card.kind==='point'){const id=ref.slice(6),cut=id.lastIndexOf('.');actions.append(kit().button('学这一点',()=>window.__pinkieStudyDeskLesson?.forPane(ctx.pane).open({k:id.slice(0,cut),i:Number(id.slice(cut+1))})));}
      if(['attempt','wrong'].includes(card.kind))actions.append(kit().button('独立重做',async()=>{window.__pinkieStudyConversation?.open();await window.__pinkieLearningNotes?.retry({attemptId:ref.slice(ref.indexOf(':')+1)});}));
      if(card.kind==='set')actions.append(kit().button('再练一组',()=>ctx.desk.startSet({chapter:card.chapter})));
      if(card.kind==='lesson'&&card.point){const p=card.point;actions.append(kit().button('回到课程',()=>window.__pinkieStudyDeskLesson?.forPane(ctx.pane).open({k:p.k||p.chapter,i:p.i??p.index??0})));}
      if(card.kind==='page')actions.append(kit().button('打开这一页',()=>window.__pinkieLibrary?.open(card.bookId,{location:Number(card.location)||1})));
      if(card.kind==='mat')actions.append(kit().button('查找这份讲义',()=>window.__pinkieStudyDeskLesson?.forPane(ctx.pane).openMaterials()));
      host.replaceChildren(heading,el('p','pk-note',card.status||card.subtitle||''),body,actions);
    }).catch(error=>{if(alive)host.replaceChildren(el('p','',error.message));});
    return{unmount(){alive=false;}};
  }});
  window.__pinkieDeskHandbook = {today, withRefs, mountMonth};
  // 视图表在学习台脚本里常驻，挂一次就够（index.html 里学习台脚本排在本文件前面）。
  try { desk()?.registerView('month', {title: '本月', mount: mountMonth}); } catch (error) { console.warn('[study-desk] month view', error); }
})();
