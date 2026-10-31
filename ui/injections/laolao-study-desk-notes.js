/* 碧琪学习台 · 笔记本。收集、读懂、回顾共用一份原笔记。 */
(() => {
  'use strict';
  if (window.__pinkieStudyDeskNotes) return;
  const desk = window.__pinkieStudyDesk; if (!desk) return;
  const TYPES = ['规则', '易错', '句型', '方法', '概念', '摘录'];
  const LIBRARY = 'agent:learning:notes-library';
  const LEGACY = '旧版整理稿';
  const RATINGS = [['forgot', '忘了', '1'], ['fuzzy', '模糊', '2'], ['remembered', '记得', '3']];
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const date = at => at ? new Date(at).toLocaleDateString('zh-CN', {month: 'long', day: 'numeric'}) : '';
  const shortDate = at => at ? new Date(at).toLocaleDateString('zh-CN', {month: 'numeric', day: 'numeric'}) : '';
  const uuid = () => crypto.randomUUID ? crypto.randomUUID() : 'r-' + Date.now() + '-' + Math.random().toString(16).slice(2);


  function mount(root, ctx) {
    let keyHandler = null;
    const local = ctx.local ? ctx.local() : desk.local(), controller = new AbortController(), reduced = () => Boolean(ctx.motion?.reduced);
    let alive = true, revision = 0, data = null, toc = null, menu = null, searchTimer = 0, toastTimer = 0, pollTimer = 0;
    let section = null, preview = null, review = null, moves = null, wrongAttempts = [], autoSuggested = false, editing = '';
    const checked = new Set();
    let route = {...(local.notesRoute || {view: 'inbox'})}, mode = route.mode || (route.subject ? 'manuscript' : 'cards'), query = local.notesUi?.query || '';
    review = local.notesUi?.review || null;
    root.classList.add('pinkie-desk-notes'); root.replaceChildren();
    const rpc = (name, params = {}, timeout = 20000) => ctx.request('pinkie.learning.' + name, {sessionKey: LIBRARY, ...params}, timeout);
    const btn = (text, action, cls = 'n-btn', mark) => {
      const n = el('button', cls); n.type = 'button'; if (mark) n.append(desk.icon(mark, {size: 'xs'})); if (text) n.append(el('span', '', text));
      n.addEventListener('click', () => {
        if (n.dataset.busy) return; n.dataset.busy = '1';
        Promise.resolve().then(() => action(n)).catch(error => toast(error.message)).finally(() => { delete n.dataset.busy; });
      }); return n;
    };
    const badge = type => el('span', 'n-chip n-type-' + (TYPES.includes(type) ? type : '摘录'), type || '未分类');
    const examName = id => toc?.exams?.find(exam => exam.id === id)?.name || (id === 'other' ? '其它' : id || '其它');
    const aside = el('nav', 'n-toc'); aside.setAttribute('aria-label', '笔记目录');
    const main = el('div', 'n-main'), head = el('header', 'n-head'), heading = el('div', 'n-heading');
    const crumb = el('div', 'n-crumb'), title = el('h2'), subtitle = el('p', 'n-subtitle'); heading.append(crumb, title, subtitle);
    const tools = el('div', 'n-tools'), segment = el('div', 'n-segment'); segment.setAttribute('role', 'group'); segment.setAttribute('aria-label', '笔记显示方式');
    for (const [id, text] of [['manuscript', '整理稿'], ['cards', '卡片']]) { const b = btn(text, () => { mode = id; local.notesRoute = {...route, mode}; load(); }, ''); b.dataset.mode = id; segment.append(b); }
    const searchBox = el('label', 'n-search'), search = el('input'); search.type = 'search'; search.placeholder = '搜笔记'; search.setAttribute('aria-label', '搜索笔记'); searchBox.append(desk.icon('search', {size: 'xs'}), search);
    search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { query = search.value.trim(); if (query && !['cards'].includes(mode) && route.subject) mode = 'cards'; load(); }, 180); });
    const organize = btn('整理', () => organizeSection(), 'n-btn', 'sparkles');
    const add = btn('记一条', () => edit(null), 'n-btn n-ink', 'plus');
    const more = btn('', n => openMenu(n, [['导出 Markdown', () => exportMarkdown()], ['导出 Anki CSV', () => exportAnki()], ['整理模型', () => modelDialog()], ['看已合并', () => navigate({view: 'merged'})]]), 'n-btn n-icon', 'ellipsis'); more.setAttribute('aria-label', '笔记本更多');
    const directory = btn('目录', () => { root.classList.toggle('n-directory-open'); directory.setAttribute('aria-expanded', String(root.classList.contains('n-directory-open'))); }, 'n-btn n-directory-toggle', 'list'); directory.setAttribute('aria-expanded', 'false');
    tools.append(directory, segment, searchBox, organize, add, more); head.append(heading, tools);
    const content = el('div', 'n-scroll'); content.setAttribute('aria-live', 'polite');
    const toastHost = el('div', 'n-toast'); toastHost.setAttribute('role', 'status'); toastHost.hidden = true;
    main.append(head, content); root.append(aside, main, toastHost);

    function toast(text, action) {
      if (!alive) return;
      clearTimeout(toastTimer); toastHost.replaceChildren(el('span', '', text)); toastHost.hidden = false;
      if (action) toastHost.append(btn(action.label, async () => { toastHost.hidden = true; await action.run(); }, ''));
      toastTimer = setTimeout(() => { toastHost.hidden = true; }, action ? 8000 : 4000);
    }
    const undoable = (text, run) => toast(text, {label: '撤销', run: async () => { await run(); await load(); toast('已撤销'); }});
    function closeMenu(focus = false) { if (!menu) return; const previous = menu.anchor; menu.node.remove(); previous.setAttribute('aria-expanded', 'false'); menu = null; if (focus && previous.isConnected) previous.focus(); }
    function place(node, anchor) {
      const r = root.getBoundingClientRect(), a = anchor.getBoundingClientRect(), scale = r.width / root.offsetWidth || 1;
      const left = Math.max(8, Math.min((a.right - r.left) / scale - node.offsetWidth, root.clientWidth - node.offsetWidth - 8));
      const below = (a.bottom - r.top) / scale + 4, top = below + node.offsetHeight > root.clientHeight - 8 ? (a.top - r.top) / scale - node.offsetHeight - 4 : below;
      Object.assign(node.style, {left: left + 'px', top: Math.max(8, top) + 'px'});
    }
    function openMenu(anchor, actions) {
      if (menu?.anchor === anchor) return closeMenu(true);
      closeMenu(); const node = el('div', 'n-menu'); node.setAttribute('role', 'menu');
      for (const [label, run] of actions) { const b = btn(label, () => { closeMenu(); return run(); }, ''); b.setAttribute('role', 'menuitem'); node.append(b); }
      // 菜单直接放在视图层：卡片的 transform 和滚动裁剪都不能盖住它。
      root.append(node); menu = {node, anchor, scrollTop:content.scrollTop}; anchor.setAttribute('aria-expanded', 'true'); place(node, anchor); node.firstElementChild?.focus();
    }
    // 「来自 N 条原笔记」的小浮层，和菜单同一层。
    function openSources(anchor, ids) {
      if (menu?.anchor === anchor) return closeMenu(true);
      closeMenu(); const node = el('div', 'n-menu n-sources'); node.setAttribute('role', 'dialog'); node.setAttribute('aria-label', '来源原笔记');
      const byId = new Map((data?.notes || []).map(note => [note.id, note]));
      for (const id of ids) {
        const note = byId.get(id);
        const b = btn(note ? (note.title || note.term || note.content || '').slice(0, 40) : '这条原笔记已不在本节', () => { closeMenu(); if (note) navigate({...route, mode: 'cards', noteId: id}); }, '');
        b.disabled = !note; node.append(b);
      }
      root.append(node); menu = {node, anchor}; anchor.setAttribute('aria-expanded', 'true'); place(node, anchor); node.firstElementChild?.focus();
    }
    document.addEventListener('pointerdown', event => { if (menu && !menu.node.contains(event.target) && !menu.anchor.contains(event.target)) closeMenu(); }, {signal: controller.signal});
    content.addEventListener('scroll', () => { if(menu&&menu.scrollTop!==content.scrollTop)closeMenu(); }, {signal: controller.signal});
    window.addEventListener('resize', () => closeMenu(), {signal: controller.signal});
    function dialog(label) {
      closeMenu(); const d = el('dialog', 'lesson-dialog n-dialog'), h = el('header'), previous = document.activeElement;
      d.setAttribute('aria-label', label); const close = btn('', () => d.close(), 'n-btn n-icon', 'x'); close.setAttribute('aria-label', '关闭' + label);
      h.append(el('h2', '', label), close); d.append(h); root.append(d);
      d.addEventListener('close', () => { d.remove(); if (previous?.isConnected) previous.focus(); }, {once: true}); d.showModal(); return d;
    }
    function navigate(next) {
      root.classList.remove('n-directory-open'); directory.setAttribute('aria-expanded', 'false');
      route = next; mode = next.mode || (next.subject ? 'manuscript' : 'cards'); local.notesRoute = {...route, mode};
      query = ''; search.value = ''; preview = null; review = null; editing = ''; checked.clear(); load();
    }
    function renderToc() {
      aside.replaceChildren(el('h1', '', '笔记本'));
      const entry = (label, count, next, mark, sub = false) => {
        const b = btn(label, () => navigate(next), 'n-toc-entry' + (sub ? ' n-toc-sub' : ''), mark);
        b.append(el('span', 'n-number', count ?? 0)); const on = next.view === route.view && next.exam === route.exam && next.subject === route.subject && next.topic === route.topic;
        b.setAttribute('aria-current', on ? 'page' : 'false'); aside.append(b); return b;
      };
      entry('收集箱', toc.inbox, {view: 'inbox'}, 'inbox').classList.add('n-inbox-entry');
      entry('今天回顾', toc.today?.count, {view: 'review'}, 'rotate-ccw');
      entry('易错', toc.mistakes, {view: 'mistakes'}, 'triangle-alert');
      for (const exam of toc.exams || []) {
        if (!exam.subjects?.length) continue;
        aside.append(el('div', 'n-group', exam.name));
        for (const subject of exam.subjects) {
          entry(subject.name, subject.count, {exam: exam.id, subject: subject.name}, subject.legacy ? 'file-text' : /C\s*语言/.test(subject.name) ? 'code' : /网络/.test(subject.name) ? 'network' : /数/.test(subject.name) ? 'sigma' : /电/.test(subject.name) ? 'zap' : /写/.test(subject.name) ? 'pen-line' : 'book-open');
          const topics = subject.topics || [], key = exam.id + '/' + subject.name, expanded = local.notesExpanded?.includes(key);
          for (const topic of expanded ? topics : topics.slice(0, 5)) entry(topic.name, topic.count, {exam: exam.id, subject: subject.name, topic: topic.name}, null, true);
          if (topics.length > 5) aside.append(btn(expanded ? '收起考点' : `展开另外 ${topics.length - 5} 个考点`, () => { local.notesExpanded = expanded ? local.notesExpanded.filter(x => x !== key) : [...(local.notesExpanded || []), key]; renderToc(); }, 'n-toc-expand'));
        }
      }
      const foot = el('div', 'n-toc-foot'); aside.append(foot); const moved = entry('已搬进生词本', toc.moved, {view: 'moved'}, 'book-a'); const pen = el('img', 'pk-sticker n-toc-sticker'); pen.src = desk.sticker?.('notes-highlighter') || ''; pen.alt = ''; pen.setAttribute('aria-hidden', 'true');
      foot.append(moved, pen, el('p', 'pk-note', '笔记记「道理」：规则、方法、易错。单词和短语请记进生词本。'));
    }
    async function load() {
      const token = ++revision; closeMenu(); clearTimeout(pollTimer); content.setAttribute('aria-busy', 'true');
      try {
        const legacy = route.exam === 'other' && route.subject === LEGACY;
        const params = {limit: 500, query, ...(route.exam ? {exam: route.exam, subject: route.subject, ...(route.topic ? {topic: route.topic} : {})} : {}),
          ...(route.view === 'inbox' ? {inbox: true} : ['mistakes', 'moved'].includes(route.view) ? {view: route.view} : route.view === 'merged' ? {includeMerged: true} : {})};
        const jobs = [rpc('notes.toc'), legacy ? rpc('notes.list', {limit: 500}) : rpc('notes.list', params)];
        if (route.subject && mode === 'manuscript') jobs.push(rpc('notes.section.get', {exam: route.exam, subject: route.subject}));
        if (route.view === 'review' && (!review || !review.notes.length)) jobs.push(rpc('notes.recall.queue', {limit: 10}));
        if (route.view === 'mistakes') jobs.push(rpc('attempts.list', {sessionKey: typeof ctx.sessionKey === 'function' ? ctx.sessionKey() : ctx.sessionKey, wrongOnly: true, limit: 20}));
        if (route.view === 'inbox') jobs.push(rpc('vocab.fromNotes.preview').catch(() => null));
        const results = await Promise.all(jobs);
        if (!alive || token !== revision) return;
        [toc, data] = results;
        if (route.subject && mode === 'manuscript') section = results[2];
        if (route.view === 'review' && (!review || !review.notes.length)) { const queue = results[2]; review = {queue, notes: queue.notes || [], index: 0, flipped: false, done: 0}; }
        if (route.view === 'inbox') moves = results[2];
        if (route.view === 'mistakes') wrongAttempts = results[2]?.attempts || [];
        renderToc(); render();
        if (route.noteId) { const card = [...content.querySelectorAll('[data-note-id]')].find(n => n.dataset.noteId === route.noteId); card?.scrollIntoView({block: 'center'}); card?.focus(); route = {...route, noteId: undefined}; }
        if (route.view === 'inbox') inboxFollowUp();
      } catch (error) { if (alive && token === revision) { content.replaceChildren(el('p', 'n-empty', error.message), btn('重试', load)); } }
      finally { if (alive && token === revision) content.removeAttribute('aria-busy'); }
    }
    function render() {
      closeMenu(); content.replaceChildren();
      const isSection = Boolean(route.subject), legacy = route.subject === LEGACY;
      title.textContent = route.topic || route.subject || ({inbox: '收集箱', review: '今天回顾', mistakes: '易错', moved: '已搬进生词本', merged: '已合并'}[route.view] || '原笔记');
      crumb.textContent = [route.exam ? examName(route.exam) : '', route.topic ? route.subject : ''].filter(Boolean).join(' / ');
      segment.hidden = !isSection || legacy; organize.hidden = !isSection || legacy; for (const b of segment.children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
      const count = (data.notes || []).length;
      if (route.view === 'inbox') { subtitle.textContent = '聊天里随手记下的内容先放在这里，碧琪帮你分好类再收进笔记本'; return renderInbox(); }
      if (route.view === 'review') { subtitle.textContent = reviewSubtitle(); return renderReview(); }
      if (isSection && (mode === 'manuscript' || legacy)) {
        const saved = section?.section;
        subtitle.textContent = saved ? `${legacy ? saved.sourceCount : section.noteCount} 条原笔记 → 提炼成 ${saved.pointCount} 个要点 · ${date(saved.builtAt || saved.createdAt)} 整理${legacy ? ' · 只读' : ''}` : `${section?.noteCount ?? count} 条原笔记 · 还没有整理稿`;
        return renderManuscript();
      }
      subtitle.textContent = route.view === 'moved' ? `${count} 条 · 原笔记归档在这里，词在生词本里背` : `${count} 条 · 按最近更新`;
      renderCards(); if (route.view === 'mistakes') renderWrongAttempts();
    }

    // ---- 卡片 ----
    function renderCards() {
      const cards = el('div', 'n-cards');
      let notes = data.notes || []; if (route.view === 'merged') notes = notes.filter(n => n.status === 'merged');
      if (!notes.length) { content.append(el('div', 'n-empty', query ? '没有找到相关笔记' : '这里还没有笔记')); return; }
      for (const note of notes) {
        const card = el('article', 'n-card'); card.dataset.noteId = note.id; card.tabIndex = 0; card.setAttribute('aria-label', note.title || note.term || '原笔记');
        const top = el('div', 'n-card-top'); top.append(badge(note.noteType)); if (note.lapses) top.append(el('span', 'n-chip', `错 ${note.lapses} 次`));
        const body = el('div', 'n-card-body'); body.append(el('h3', '', note.title || note.term || '原笔记'), el('p', '', note.recallAnswer || note.meaning || note.content || '')); if (note.example) body.append(el('p', 'n-example', note.example));
        const foot = el('footer'); foot.append(el('span', '', `${note.sourceLabel || '聊天摘录'} · ${shortDate(note.updatedAt || note.createdAt)} · ${note.reviewCount ? `复习 ${note.reviewCount} 次` : '还没复习'}`));
        const active = note.status !== 'moved' && note.status !== 'merged';
        if (active) foot.append(btn('考我', () => quiz([note]), 'n-text-button', 'pencil-line'));
        const more = btn('', n => openMenu(n, active ? [['问碧琪', () => ctx.desk.askRef('note:' + note.id, note.title || '这条笔记')], ['回到出处', () => note.sourceAnchor ? originalDialog(note) : ctx.desk.revealRef('note:' + note.id)], ['编辑', () => edit(note, card)], ['整理这条', async () => { await rpc('notes.organize.light', {id: note.id}, 120000); await load(); toast('已整理这条'); }], ['移到…', () => moveDialog(note)], ['搬进生词本', () => moveWords([note.id])], ['删除', () => deleteNote(note)]] : [['查看原文', () => originalDialog(note)]]), 'n-icon', 'ellipsis'); more.setAttribute('aria-label', `更多：${note.title || note.term || '原笔记'}`); foot.append(more);
        card.append(top, body, foot); if (active) { body.addEventListener('click', () => edit(note, card)); card.addEventListener('keydown', e => { if (e.target === card && e.key === 'Enter') { e.preventDefault(); edit(note, card); } }); }
        cards.append(card);
      }
      content.append(cards);
    }
    function renderWrongAttempts() {
      if (!wrongAttempts.length) return;
      const list = el('section', 'n-wrong-items'); list.append(el('h3', '', '最近需要巩固的题目'));
      for (const attempt of wrongAttempts) {
        const card = el('article', 'n-card n-wrong-record'); card.append(el('h3', '', attempt.question || attempt.topic || '练习记录'), el('p', '', '你的答案：' + (attempt.answerText || (Array.isArray(attempt.answer) ? attempt.answer.join('、') : attempt.answer || '未填写'))));
        if (attempt.result?.feedback) card.append(el('p', '', attempt.result.feedback));
        card.append(btn('独立重做这题', async () => { window.__pinkieStudyConversation?.open(); await window.__pinkieLearningNotes?.retry?.({attemptId: attempt.id}); }, 'n-btn n-primary'));
        window.__pinkieLearningNotes?.correction?.(card, attempt.id, attempt.result?.correct); list.append(card);
      }
      content.append(list);
    }
    function edit(note, card) {
      closeMenu(); const d = card ? null : dialog('记一条'), form = el('form', 'n-edit');
      const field = (label, tag, value) => { const wrap = el('label', '', label), input = el(tag); input.value = value || ''; input.setAttribute('aria-label', label); wrap.append(input); form.append(wrap); return input; };
      const titleInput = field('笔记标题', 'input', note?.title), text = field('笔记正文', 'textarea', note?.content), cue = field('回忆提示问题', 'input', note?.cue), tags = field('笔记标签', 'input', note?.tags?.join(', '));
      text.rows = 5; const actions = el('div', 'n-actions'), save = el('button', 'n-btn n-ink', '保存'); save.type = 'submit'; actions.append(save, btn('取消', () => d ? d.close() : render())); form.append(actions);
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (!text.value.trim() || save.disabled) return text.focus(); save.disabled = true;
        try {
          const result = await rpc(note ? 'notes.update' : 'notes.save', {id: note?.id, title: titleInput.value, content: text.value, cue: cue.value, tags: tags.value.split(/[,，]/).map(x => x.trim()).filter(Boolean)});
          d?.close(); await load();
          if (!note && result?.looksLikeVocab && result.note?.id) toast(`已记进笔记本 · 这像是一个${result.vocabKind || '短语'}`, {label: '改记到生词本', run: () => moveWords([result.note.id])});
          else toast(note ? '笔记已更新' : '已记进笔记本 · 在收集箱里');
        } catch (error) { toast(error.message); } finally { save.disabled = false; }
      });
      if (card) card.replaceChildren(form); else d.append(form); titleInput.focus();
    }
    async function deleteNote(note) { const result = await rpc('notes.delete', {id: note.id}); await load(); undoable('已删除笔记', () => rpc('notes.restore', {note: result.note})); }
    function originalDialog(note) { const d = dialog('原笔记'); d.append(el('p', 'n-original', note.original || note.content)); if (note.sourceAnchor) d.append(btn('打开书架原文', async () => { const a = note.sourceAnchor; d.close(); await window.__pinkieLibrary?.open(a.bookId, {location: a.location, quote: a.quote}); })); }
    // 「移到…」：改考试、科目、考点和类型；同时算作收下。
    function classifyForm(seed, onSubmit, submitLabel = '收下') {
      const form = el('form', 'n-classify'), exams = (toc?.exams || []).filter(exam => !exam.subjects?.some(s => s.legacy) || exam.id === 'other');
      const select = (label, options, value) => { const s = el('select'); s.setAttribute('aria-label', label); for (const [v, t] of options) { const o = el('option', '', t); o.value = v; s.append(o); } s.value = value; return s; };
      const type = select('笔记类型', TYPES.map(t => [t, t]), TYPES.includes(seed.noteType) ? seed.noteType : '概念');
      const exam = select('考试', exams.map(e => [e.id, e.name]), exams.some(e => e.id === seed.exam) ? seed.exam : 'other');
      const listId = 'n-dl-' + Math.random().toString(16).slice(2), topicId = listId + '-t';
      const subjectList = el('datalist'), topicList = el('datalist'); subjectList.id = listId; topicList.id = topicId;
      const fill = () => {
        const current = toc?.exams?.find(e => e.id === exam.value);
        subjectList.replaceChildren(...(current?.subjects || []).filter(s => !s.legacy).map(s => { const o = el('option'); o.value = s.name; return o; }));
        topicList.replaceChildren(...(current?.subjects?.find(s => s.name === subject.value)?.topics || []).map(t => { const o = el('option'); o.value = t.name; return o; }));
      };
      const subject = el('input'); subject.value = seed.subject || ''; subject.maxLength = 12; subject.placeholder = '科目'; subject.setAttribute('aria-label', '科目'); subject.setAttribute('list', listId);
      const topic = el('input'); topic.value = seed.topic || ''; topic.maxLength = 16; topic.placeholder = '考点'; topic.setAttribute('aria-label', '考点'); topic.setAttribute('list', topicId);
      exam.addEventListener('change', fill); subject.addEventListener('input', fill); fill();
      const ok = el('button', 'n-btn n-ink', submitLabel); ok.type = 'submit';
      form.append(type, exam, subject, topic, subjectList, topicList, ok);
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (ok.disabled) return; ok.disabled = true;
        try { await onSubmit({noteType: type.value, exam: exam.value, subject: subject.value.trim() || '未分类', topic: topic.value.trim()}); }
        catch (error) { toast(error.message); } finally { ok.disabled = false; }
      });
      return form;
    }
    function moveDialog(note) {
      const d = dialog('移到…'); d.append(el('p', 'n-dialog-sub', note.title || note.content || ''));
      d.append(classifyForm(note, async fields => {
        const result = await rpc('notes.triage.apply', {items: [{id: note.id, ...fields}]}); d.close(); await load();
        undoable(`已移到 ${examName(fields.exam)} · ${fields.subject}`, () => rpc('notes.triage.undo', {backupId: result.backupId}));
      }, '移过去'));
    }
    async function moveWords(ids) {
      const result = await rpc('vocab.fromNotes.apply', {noteIds: ids}); await load();
      ctx.motion?.confettiAt?.(content.querySelector('.n-move') || toastHost, 'small');
      undoable(`已搬进生词本 ${result.wordCount} 个词 · 碧琪正在整理音标和搭配`, () => rpc('vocab.fromNotes.undo', {backupId: result.backupId}));
    }

    // ---- 收集箱 ----
    function inboxFollowUp() {
      const notes = data.notes || [], triage = data.triage || {};
      // 进收集箱时，没建议的笔记自动交给碧琪看一次；失败了等先生点「重新建议」。
      if (!autoSuggested && triage.state !== 'running' && triage.state !== 'failed' && notes.some(note => !note.suggestion)) {
        autoSuggested = true;
        rpc('notes.triage.suggest').then(result => { if (alive && result.running) schedulePoll(); }).catch(error => toast(error.message));
      }
      if (triage.state === 'running' || moves?.running || moves?.pending) schedulePoll();
    }
    function schedulePoll() {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(() => { if (!alive || document.hidden || ctx.pane && !ctx.desk.isFocused() || route.view !== 'inbox') return; if (editing) return schedulePoll(); load(); }, 2500);
    }
    function moveBanner() {
      const items = moves?.items || [];
      if (!items.length && !moves?.running && !moves?.pending) return null;
      const banner = el('section', 'n-move'), mark = el('span', 'n-move-icon'); mark.append(desk.icon('arrow-right-left', {size: 'sm'}));
      const text = el('div', 'n-move-text');
      if (!items.length) { text.append(el('strong', '', '碧琪正在看哪些其实是单词…'), el('p', '', moves?.error || `还有 ${moves?.pending || 0} 条在看，不影响你整理别的。`)); banner.append(mark, text); return banner; }
      const sample = [...new Set(items.flatMap(item => item.words.map(word => word.word)))].slice(0, 3).join('、');
      text.append(el('strong', '', `${items.length} 条看起来是单词或短语`), el('p', '', `例如 ${sample}。搬进生词本能背音标、谐音、搭配；你写的谐音会保留，原笔记归档、可撤销。`));
      const buttons = el('div', 'n-move-buttons');
      buttons.append(btn('逐条看', () => moveReview(items)), btn(`全部搬进生词本（${items.length}）`, () => moveWords(items.map(item => item.noteId)), 'n-btn n-primary'));
      banner.append(mark, text, buttons); return banner;
    }
    function moveReview(items) {
      const d = dialog('搬进生词本'), picked = new Set(items.map(item => item.noteId)), list = el('div', 'n-move-list');
      d.append(el('p', 'n-dialog-sub', '取消勾选的笔记会留在笔记本里。'));
      for (const item of items) {
        const row = el('label', 'n-move-row'), box = el('input'); box.type = 'checkbox'; box.checked = true;
        box.addEventListener('change', () => { if (box.checked) picked.add(item.noteId); else picked.delete(item.noteId); ok.lastChild.textContent = `搬进生词本（${picked.size}）`; ok.disabled = !picked.size; });
        const words = el('div', 'n-move-words');
        for (const word of item.words) { const w = el('span', 'n-move-word'); w.append(el('b', '', word.word)); if (word.hint) w.append(el('span', '', word.hint)); if (word.homophone) w.append(el('em', '', '谐音 ' + word.homophone)); words.append(w); }
        row.append(box, el('p', 'n-move-raw', item.text), words); list.append(row);
      }
      const ok = btn(`搬进生词本（${picked.size}）`, async () => { d.close(); await moveWords([...picked]); }, 'n-btn n-primary');
      const actions = el('div', 'n-actions'); actions.append(ok, btn('取消', () => d.close())); d.append(list, actions);
    }
    function renderInbox() {
      const banner = moveBanner(); if (banner) content.append(banner);
      const notes = data.notes || [], triage = data.triage || {};
      if (!notes.length) { const empty = el('div', 'n-empty'); empty.append(el('strong', '', '收集箱是空的'), el('p', '', '在聊天里选中一句规则，点「记笔记」就会出现在这里。')); content.append(empty); return; }
      const ready = notes.filter(note => note.suggestion && !note.suggestion.isVocab);
      const bar = el('div', 'n-ibar');
      bar.append(el('span', '', triage.state === 'running' ? `共 ${notes.length} 条 · 碧琪正在给 ${triage.queued || 0} 条想分类…` : triage.state === 'failed' ? `建议没生成：${triage.error || '整理模型暂时不可用'}` : `共 ${notes.length} 条 · ${ready.length} 条已有建议`));
      const acceptAll = btn(checked.size ? `收下所选（${checked.size}）` : '全部按建议收下', () => accept(checked.size ? notes.filter(n => checked.has(n.id) && n.suggestion && !n.suggestion.isVocab) : ready), 'n-btn');
      acceptAll.disabled = !ready.length;
      bar.append(acceptAll, btn('重新建议', async () => { autoSuggested = true; await rpc('notes.triage.suggest', {ids: notes.map(n => n.id)}); toast('碧琪重新看一遍，结果会陆续出现'); load(); }, 'n-btn n-ghost', 'sparkles'));
      const table = el('div', 'n-inbox'); table.setAttribute('role', 'list');
      for (const note of notes) table.append(inboxRow(note, triage));
      content.append(bar, table);
    }
    function inboxRow(note, triage) {
      const s = note.suggestion, row = el('div', 'n-irow' + (s?.isVocab ? ' is-word' : '')); row.dataset.noteId = note.id; row.setAttribute('role', 'listitem');
      const box = el('input'); box.type = 'checkbox'; box.checked = checked.has(note.id); box.setAttribute('aria-label', '选择这条');
      box.addEventListener('change', () => { if (box.checked) checked.add(note.id); else checked.delete(note.id); const b = content.querySelector('.n-ibar .n-btn'); if (b) b.lastChild.textContent = checked.size ? `收下所选（${checked.size}）` : '全部按建议收下'; });
      const raw = el('div', 'n-raw'), original = note.original || note.content || '';
      if (s?.isVocab) { const m = original.match(/^\s*([A-Za-z][A-Za-z'’\- ]*[A-Za-z])/); if (m) { raw.append(el('b', '', m[1]), document.createTextNode(original.slice(m.index + m[0].length))); } else raw.textContent = original; }
      else raw.textContent = original;
      const text = el('div', 'n-raw-wrap'); text.append(raw, el('div', 'n-from', `${note.sourceLabel || '聊天摘录'} · ${shortDate(note.createdAt)}`));
      const sugg = el('div', 'n-sugg');
      if (editing === note.id) {
        sugg.append(classifyForm(s || note, async fields => { await accept([{...note, suggestion: {...(s || {}), ...fields, isVocab: false}}]); editing = ''; }));
        sugg.append(btn('取消', () => { editing = ''; render(); }, 'n-text-button'));
      } else if (!s) {
        sugg.append(el('span', 'n-wait', triage.state === 'running' ? '碧琪正在看…' : '还没有建议'), btn('自己分类', () => { editing = note.id; render(); }, 'n-text-button'));
      } else if (s.isVocab) {
        sugg.append(el('span', 'n-arrow', '这是单词'), btn('搬进生词本', () => moveWords([note.id]), 'n-btn n-primary', 'book-a'), btn('当笔记收下', () => { editing = note.id; render(); }, 'n-text-button'));
      } else {
        sugg.append(el('span', 'n-arrow', '收进'), el('span', 'n-chip', `${examName(s.exam)} · ${s.subject || '未分类'}`), badge(s.noteType));
        const change = btn('', () => { editing = note.id; render(); }, 'n-icon', 'pencil-line'); change.setAttribute('aria-label', '改建议');
        sugg.append(change, btn('收下', () => accept([note], row), 'n-btn'));
      }
      row.append(box, text, sugg); return row;
    }
    async function accept(notes, row) {
      const items = notes.filter(n => n.suggestion && !n.suggestion.isVocab).map(n => ({id: n.id, noteType: n.suggestion.noteType, exam: n.suggestion.exam, subject: n.suggestion.subject || '未分类', topic: n.suggestion.topic || '', ...(n.suggestion.cue ? {cue: n.suggestion.cue} : {}), ...(n.suggestion.title ? {title: n.suggestion.title} : {})}));
      if (!items.length) return toast('没有可以收下的建议');
      const result = await rpc('notes.triage.apply', {items});
      const rows = row ? [row] : items.map(item => content.querySelector(`.n-irow[data-note-id="${CSS.escape(item.id)}"]`)).filter(Boolean);
      if (!reduced()) { const animations = rows.map(r => r.animate([{opacity:1,transform:'scaleY(1)'},{opacity:0,transform:'scaleY(.8)'}], {duration:220,easing:'ease-out',fill:'forwards'})); await Promise.all(animations.map(a => a.finished.catch(() => {}))); }
      for (const item of items) checked.delete(item.id);
      await load();
      undoable(`已收下 ${result.appliedCount} 条`, () => rpc('notes.triage.undo', {backupId: result.backupId}));
    }

    // ---- 整理稿 ----
    function renderManuscript() {
      const legacy = route.subject === LEGACY, saved = preview?.notebook || section?.section;
      if (preview) {
        const bar = el('div', 'n-stale n-preview-bar'); bar.append(el('span', '', '这是新整理稿的预览，原笔记不会变。'), btn('保存这份整理稿', () => savePreview(), 'n-btn n-primary'), btn('放弃', () => { preview = null; render(); }, 'n-btn'));
        content.append(bar);
      } else if (!legacy && section?.section && section.stale && section.newCount) {
        const bar = el('div', 'n-stale'); bar.append(el('span', '', `这一节有 ${section.newCount} 条新笔记还没并进整理稿。`), btn('并进来', () => organizeSection(), 'n-btn')); content.append(bar);
      }
      const page = el('article', 'n-paper'), holes = el('div', 'n-holes'); holes.append(el('i'), el('i'), el('i')); page.append(holes);
      if (!saved) {
        page.append(el('h3', '', route.subject), el('p', 'n-paper-meta', `${section?.noteCount || 0} 条原笔记 · 还没有整理稿`));
        page.append(el('p', 'n-paper-empty', section?.noteCount ? '让碧琪把这一节的原笔记提炼成一页能抄进本子的整理稿。' : '收集箱里收下的笔记会出现在这一节。'));
        if (section?.noteCount) { const row = el('div', 'n-quizme'); row.append(btn('整理这一节', () => organizeSection(), 'n-btn n-primary', 'sparkles')); page.append(row); }
        content.append(page); return;
      }
      const sections = route.topic && saved.sections.some(s => s.title === route.topic) ? saved.sections.filter(s => s.title === route.topic) : saved.sections;
      page.append(el('h3', '', saved.title || route.subject));
      const types = [...new Set(saved.sections.map(s => s.type).filter(Boolean))];
      const meta = el('div', 'n-paper-meta'); meta.append(el('span', '', `来自 ${saved.sourceCount} 条原笔记 · ${saved.pointCount} 个要点`)); for (const t of types) meta.append(badge(t)); page.append(meta);
      for (const part of sections) {
        const h = el('h4', '', part.title); if (part.type) h.append(badge(part.type)); page.append(h);
        const ol = el('ol');
        for (const point of part.points) {
          const li = el('li'), p = el('p', '', point.text);
          const src = el('button', 'n-src', `来自 ${point.sourceIds.length} 条原笔记`); src.type = 'button'; src.setAttribute('aria-haspopup', 'dialog'); src.addEventListener('click', () => openSources(src, point.sourceIds)); p.append(src);
          li.append(p); if (point.example) li.append(el('p', 'n-eg', '例：' + point.example)); if (point.reminder) li.append(el('p', 'n-warn', '易错：' + point.reminder));
          ol.append(li);
        }
        page.append(ol);
      }
      if (!preview) {
        const ids = sectionNoteIds(saved, sections), row = el('div', 'n-quizme');
        const quizButton = btn(`考考我这一节（${Math.min(10, ids.length)} 题）`, () => quiz(pickNotes(ids)), 'n-btn n-primary', 'pencil-line'); quizButton.disabled = !ids.length;
        row.append(quizButton, btn('复制', async () => { await navigator.clipboard.writeText(section.section.text || ''); toast('整理稿已复制'); }, 'n-btn', 'copy'), btn('导出 Markdown', () => exportMarkdown(), 'n-btn', 'download'));
        page.append(row);
      }
      content.append(page);
    }
    const sectionNoteIds = (saved, sections) => [...new Set(sections.flatMap(s => s.points.flatMap(p => p.sourceIds)))].filter(id => (data.notes || []).some(n => n.id === id && n.status !== 'moved' && n.status !== 'merged'));
    const pickNotes = ids => ids.slice(0, 10).map(id => data.notes.find(n => n.id === id)).filter(Boolean);
    async function organizeSection() {
      if (!route.subject || route.subject === LEGACY) return toast('请先在目录里选一个科目');
      if (mode !== 'manuscript') { mode = 'manuscript'; local.notesRoute = {...route, mode}; }
      organize.disabled = true; toast('碧琪正在整理这一节，大约需要半分钟…');
      try {
        const plan = await rpc('notes.section.build', {exam: route.exam, subject: route.subject, requestId: uuid()}, 180000);
        if (!alive) return; preview = plan; await load(); toast('预览好了，看一遍再保存');
      } finally { organize.disabled = false; }
    }
    async function savePreview() {
      const result = await rpc('notes.organize.apply', {requestId: preview.id, operationIds: []}); preview = null; await load();
      undoable('整理稿已保存', () => rpc('notes.organize.undo', {backupId: result.backupId}));
    }

    // ---- 今天回顾 ----
    function reviewSubtitle() {
      const q = review?.queue || {}, limit = q.dailyLimit ?? 10, backlog = q.backlog || 0;
      return `每天最多 ${limit} 条，按到期先后来` + (backlog ? `；积压的 ${backlog} 条会分到之后几天，不用一次补完` : '');
    }
    function renderReview() {
      const wrap = el('div', 'n-review'), notes = review?.notes || [], note = notes[review?.index ?? 0];
      if (!notes.length || !note) {
        const queue = review?.queue || {};
        if (queue.pending || queue.missing) {
          const box = el('div', 'n-empty'); box.append(el('strong', '', queue.pending ? '碧琪正在把笔记拆成问题和答案…' : '先把笔记拆成回忆卡'), el('p', '', '整段原文已经保存。准备好后，正面只显示问题，翻面才显示答案。'));
          const refresh = btn(queue.pending ? '查看进度' : '重新拆分', async () => { if (!queue.pending) await rpc('notes.recall.prepare', {force: true}); await load(); }, 'n-btn n-ink'); box.append(refresh);
          if (queue.problems?.length) box.append(el('p', '', queue.problems[0].error));
          wrap.append(box); content.append(wrap);
          if (queue.pending && !document.hidden && (!ctx.pane || ctx.desk.isFocused())) { clearTimeout(pollTimer); pollTimer = setTimeout(() => { review = null; load(); }, 2500); }
          return;
        }
        const empty = el('div', 'n-empty');
        empty.append(el('strong', '', review?.done ? `今天回顾了 ${review.done} 条` : review?.queue?.completedToday ? '今天的回顾做完了' : '今天没有到期的笔记'), el('p', '', '记得的会隔几天再回来，忘了的明天再见。'));
        wrap.append(empty); content.append(wrap); return;
      }
      const bar = el('div', 'n-rbar'), dots = el('div', 'n-dots');
      notes.forEach((_, i) => dots.append(el('i', i < review.index ? 'd' : i === review.index ? 'c' : '')));
      bar.append(dots, el('span', '', `第 ${review.index + 1} / ${notes.length} 条` + (note.subject ? ` · ${note.subject}` : '')));
      const card = el('div', 'n-rcard'), top = el('div', 'n-card-top'); top.append(badge(note.noteType));
      const q = el('div', 'n-q', note.recallQuestion || (note.cue && /[?？]|什么|怎么|如何|哪/.test(note.cue) ? note.cue : '请回忆这条笔记的关键知识点。'));
      const answer = el('textarea'); answer.rows = 3; answer.placeholder = '先在这里写下你记得的（可以不写），⌘↩ 或点「翻面」看答案'; answer.setAttribute('aria-label', '回忆内容'); answer.value = review.draft || '';
      answer.addEventListener('input', () => { review.draft = answer.value; });
      answer.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); flip(); } });
      card.append(top, q, answer);
      if (!review.flipped) { const row = el('div', 'n-actions'); row.append(btn('翻面', () => flip(), 'n-btn n-ink')); row.append(el('span', 'n-kbd-hint', '空格翻面')); card.append(row); }
      else {
        const ans = el('div', 'n-ans'); ans.append(el('p', '', note.recallAnswer || note.meaning || note.content || ''));
        if (!note.recallAnswer && note.example) ans.append(el('p', 'n-eg', '例：' + note.example));
        if (note.recallQuote) { const source = el('details', 'n-recall-source'); source.append(el('summary', '', '看原文依据'), el('p', '', note.recallQuote)); ans.append(source); }
        card.append(ans);
        const rate = el('div', 'n-rate');
        for (const [rating, label, key] of RATINGS) { const b = btn(label, () => grade(rating), rating === 'remembered' ? 'n-rate-ok' : ''); b.append(el('kbd', '', key)); rate.append(b); }
        card.append(rate);
      }
      const alt = el('div', 'n-alt'); alt.append(btn(`换成做题：用这 ${notes.length - review.index} 条出一组题`, () => quiz(notes.slice(review.index)), 'n-btn', 'pencil-line'));
      wrap.append(bar, card, alt, el('p', 'n-honest', '只凭你自评，碧琪不会替你判对错；做题模式会按答案计入掌握度。'));
      content.append(wrap);
      // 不自动聚焦输入框：空格默认翻面；想写下回忆时点进输入框，⌘↩ 翻面。也不聚焦评分按钮，免得空格误点「记得」。
    }
    function flip() { if (route.view === 'review' && review?.notes[review.index] && !review.flipped) { review.flipped = true; render(); } }
    async function grade(rating) {
      const note = review?.notes[review.index]; if (!note || !review.flipped || review.grading) return;
      review.grading = true;
      try { await rpc(note.recallId ? 'notes.recall.review' : 'notes.review', {id: note.id, recallId: note.recallId, rating}); } finally { review.grading = false; }
      review.done++; review.index++; review.flipped = false; review.draft = '';
      if (review.index >= review.notes.length) { const keep = review; review = null; await load(); if (review) review.done = keep.done; render(); return; }
      render(); rpc('notes.toc').then(next => { if (alive) { toc = next; renderToc(); } }).catch(() => {});
    }

    // ---- 出题、导出 ----
    // 题出在聊天舞台上：先回到对话，再走学习舞台已有的笔记出题链路（单条/批量），不另起协议。
    async function quiz(notes) {
      const hook = window.__pinkieLearningNotes?.quiz;
      if (!hook) return toast('聊天舞台还在连接，稍后再试');
      window.__pinkieStudyConversation?.open(); await hook(notes);
    }
    function exportMarkdown() {
      const md = section?.section?.markdown;
      if (!route.subject || !md) return toast('请先打开一节整理稿');
      download(md, `${route.subject}-整理稿.md`);
    }
    function exportAnki() {
      const notes = (data.notes || []).filter(n => !['moved', 'merged'].includes(n.status));
      download('﻿' + [['Front', 'Back', 'Example', 'Tags'], ...notes.map(n => [n.cue || n.title || n.term || n.content, n.meaning || n.content, n.example, (n.tags || []).join(' ')])].map(row => row.map(c => '"' + String(c || '').replace(/"/g, '""') + '"').join(',')).join('\r\n'), '笔记-Anki.csv', 'text/csv');
    }
    function download(text, name, type = 'text/markdown') { const url = URL.createObjectURL(new Blob([text], {type: type + ';charset=utf-8'})), a = el('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    async function modelDialog() {
      const d = dialog('整理模型'), info = await rpc('notes.organizer.status'); if (!d.isConnected) return;
      const select = el('select'); select.setAttribute('aria-label', '整理模型'); for (const m of info.models || []) { const o = el('option', '', m.name || m.id); o.value = m.id || m.key; select.append(o); } select.value = info.model || info.defaultModel || ''; d.append(select, btn('保存', async () => { await rpc('notes.organizer.setModel', {model: select.value}); d.close(); toast('整理模型已更新'); }, 'n-btn n-ink'));
    }
    keyHandler = event => {
      if (event.target.closest?.('input,textarea,select,[contenteditable=true]')) return;
      if (menu && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); return; }
      if (menu && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); const items = [...menu.node.children], i = items.indexOf(document.activeElement); items[(i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); return; }
      if (route.view === 'review' && review) {
        if (event.code === 'Space' && !event.target.closest?.('button')) { event.preventDefault(); flip(); return; }
        const rating = RATINGS.find(item => item[2] === event.key); if (rating && review.flipped) { event.preventDefault(); grade(rating[0]).catch(error => toast(error.message)); return; }
      }
      if (event.target.closest?.('.n-toc') && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); const entries = [...aside.querySelectorAll('.n-toc-entry')], i = entries.indexOf(document.activeElement), n = entries[(i + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length]; n.click(); n.focus(); }
    };
    const teardown = () => { local.notesUi = {query, review}; alive = false; revision++; controller.abort(); clearTimeout(searchTimer); clearTimeout(toastTimer); clearTimeout(pollTimer); closeMenu(); for (const d of root.querySelectorAll('dialog')) { d.close(); d.remove(); } keyHandler = null; };
    load();
    return {unmount: teardown, keydown: event => keyHandler?.(event), pause() { clearTimeout(pollTimer); }, resume() { if (route.view === 'inbox' && alive) schedulePoll(); else if (route.view === 'review' && review?.queue?.pending && alive) { clearTimeout(pollTimer); pollTimer = setTimeout(() => { review = null; load(); }, 500); } }};
  }
  desk.registerView('notes', {title: '笔记本', icon: 'notebook-text', mount});
  window.__pinkieStudyDeskNotes = {open: options => desk.go('notes', options)};
})();
