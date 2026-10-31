/* 碧琪学习台 · 生词本。先生写词，内置模型按所备考试整理中文谐音和常考搭配；复习沿用笔记本的记忆曲线。 */
(() => {
  'use strict';
  if (window.__pinkieStudyDeskVocabLoaded) return;
  window.__pinkieStudyDeskVocabLoaded = true;
  let registered = false;
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const FILTERS = [['all', '全部'], ['due', '待复习'], ['pending', '整理中'], ['failed', '需重试']];
  const RATINGS = [['forgot', '忘了', '1'], ['fuzzy', '模糊', '2'], ['remembered', '记得', '3']];
  const LAYOUT_KEY = 'pinkie.vocab.layout';
  // 卡片 / 词表的选择只是本机偏好，读写失败就用卡片。
  const readLayout = () => { try { return localStorage.getItem(LAYOUT_KEY) === 'table' ? 'table' : 'cards'; } catch { return 'cards'; } };
  const saveLayout = value => { try { localStorage.setItem(LAYOUT_KEY, value); } catch {} };
  const nextLabel = at => {
    const days = Math.round(((Number(at) || 0) - Date.now()) / 86400000);
    return !at || days <= 0 ? '今天复习' : days === 1 ? '明天复习' : `${days} 天后复习`;
  };
  // 读音用系统自带的英语语音，不联网；没有语音时按钮不出现。
  const speak = text => {
    const synth = window.speechSynthesis; if (!synth || !text) return;
    synth.cancel(); const say = new SpeechSynthesisUtterance(text); say.lang = 'en-US'; say.rate = .9;
    const voice = synth.getVoices().find(item => /^en[-_]US/i.test(item.lang)); if (voice) say.voice = voice;
    synth.speak(say);
  };

  function mount(root, ctx) {
    let keyHandler = null;
    const desk = ctx.desk || window.__pinkieStudyDesk, icon = (name, size = 'xs') => desk.icon(name, {size});
    const request = (method, params = {}, timeout = 20000) => ctx.request('pinkie.learning.vocab.' + method, params, timeout);
    let alive = true, revision = 0, filter = 'all', query = '', data = null, poll = 0, searchTimer = 0, review = null, toastTimer = 0, examFilter = '', layout = readLayout();
    const saved = desk.local().vocabUi; if (saved) ({filter, query, review, examFilter, layout} = saved);
    const route = desk.local().vocabRoute || {}; desk.local().vocabRoute = null;
    if (route.query) { query=route.query;filter='all';examFilter=''; }
    root.classList.add('pinkie-desk-vocab'); root.replaceChildren();

    const top = el('header', 'v-top');
    const title = el('h2', 'v-title', '生词本'), count = el('span', 'v-count', '正在打开…');
    const filters = el('div', 'v-filters pk-seg'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', '筛选');
    for (const [id, label] of FILTERS) {
      const b = el('button', '', label); b.type = 'button'; b.dataset.filter = id; b.setAttribute('aria-pressed', String(id === filter));
      b.addEventListener('click', () => { filter = id; for (const node of filters.children) node.setAttribute('aria-pressed', String(node.dataset.filter === id)); load(); });
      filters.append(b);
    }
    const model = el('span', 'v-model', '内置模型');
    const reviewButton = el('button', 'v-review', '复习'); reviewButton.type = 'button'; reviewButton.addEventListener('click', startReview);
    // 页眉：小字「英语 · N 个词」+ 宋体页名；右边一个粉色复习键。页边批注是碧琪写给先生的提醒。
    const heading = el('div', 'v-heading'), bookKicker = el('div', 'v-book-kicker pk-kicker', '生词本'); count.classList.add('pk-kicker'); heading.append(bookKicker, count, title);
    top.append(heading, filters, model, reviewButton);
    const aside = el('aside', 'v-aside'), wordCard = el('img', 'pk-sticker'); wordCard.src = desk.sticker?.('vocab-card') || ''; wordCard.alt = ''; wordCard.setAttribute('aria-hidden', 'true');
    const note = el('div', 'pk-note'); note.append(el('small', '', '碧琪写在页边'), document.createTextNode('粉色字是我编的谐音，只帮你记，考试别照着念哦。'));
    aside.append(note, wordCard);
    const shelfStamp = el('span', 'pk-stamp pk-mstamp', '已收录'); shelfStamp.hidden = true;

    // 「我在备考」：选中的考试决定标注和搭配；第一个是主考试。
    const examsRow = el('div', 'v-exams'); examsRow.setAttribute('role', 'group'); examsRow.setAttribute('aria-label', '我在备考');
    const cover = el('div', 'v-cover');
    const add = el('form', 'v-add');
    const input = el('textarea'); input.rows = 2; input.placeholder = '写下生词，一行一个，可以在后面附中文\n例如：ambulance　或　look forward to 期待';
    input.setAttribute('aria-label', '要加入生词本的单词或短语');
    const submit = el('button', 'v-add-button', '加入生词本'); submit.type = 'submit'; submit.prepend(icon('book-a'));
    const addHint = el('p', 'v-add-hint', '碧琪会用内置模型整理音标、中文谐音、所备考试的常考搭配和例句；⌘↩ 也能加入。');
    add.append(input, submit, addHint);
    add.addEventListener('submit', event => { event.preventDefault(); addWords(); });
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); addWords(); } });

    const tools = el('div', 'v-tools');
    const searchBox = el('label', 'v-search'), search = el('input'); search.type = 'search'; search.placeholder = '搜单词、中文、谐音或搭配'; search.setAttribute('aria-label', '搜索生词本');
    searchBox.append(icon('search'), search);
    search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { query = search.value.trim(); load(); }, 180); });
    const retryAll = el('button', 'v-text-button', '全部重新整理'); retryAll.type = 'button'; retryAll.hidden = true;
    retryAll.addEventListener('click', async () => { const ids = (data?.words || []).filter(word => word.status === 'failed').map(word => word.id); if (!ids.length) return; retryAll.disabled = true; try { await request('organize', {ids}); await load(); } catch (error) { toast(error.message); } finally { retryAll.disabled = false; } });
    const examSelect = el('select', 'v-exam-filter'); examSelect.setAttribute('aria-label', '按考试筛选');
    examSelect.addEventListener('change', () => { examFilter = examSelect.value; load(); });
    const layoutGroup = el('div', 'v-layout'); layoutGroup.setAttribute('role', 'group'); layoutGroup.setAttribute('aria-label', '显示方式');
    for (const [id, label, mark] of [['cards', '卡片', 'layout-grid'], ['table', '词表', 'list']]) {
      const b = el('button'); b.type = 'button'; b.dataset.layout = id; b.append(icon(mark), el('span', '', label)); b.setAttribute('aria-pressed', String(layout === id));
      b.addEventListener('click', () => { layout = id; saveLayout(id); for (const node of layoutGroup.children) node.setAttribute('aria-pressed', String(node.dataset.layout === id)); render(); });
      layoutGroup.append(b);
    }
    tools.append(searchBox, examSelect, layoutGroup, retryAll);

    const list = el('div', 'v-list'); list.setAttribute('aria-live', 'polite');
    const stage = el('section', 'v-stage'); stage.hidden = true; stage.setAttribute('aria-label', '生词复习');
    const toastHost = el('div', 'v-toast'); toastHost.setAttribute('role', 'status'); toastHost.hidden = true;
    const compactTitle = el('h2', 'v-spread-title', '生词本'); heading.append(compactTitle);
    const compactList = el('div', 'v-spread-list'); compactList.setAttribute('aria-label', '手账词表');
    const foot = el('footer', 'v-foot'), layouts = el('div', 'v-book-layouts'); layouts.setAttribute('aria-label', '摊开方式');
    for (const [value, label, lines] of [['single', '单页', ''], ['spread', '对开', '<path d="M11 1v14"/>'], ['spread-chat', '对开加便签', '<path d="M8 1v14M15 1v14"/>']]) {
      const b = el('button'); b.type = 'button'; b.setAttribute('aria-label', label); b.innerHTML = '<svg viewBox="0 0 22 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="1" width="20" height="14" rx="2"/>' + lines + '</svg>'; b.addEventListener('click', () => window.__pinkieStudyDesk.setLayout(value)); layouts.append(b);
    }
    const manage = el('button', 'v-text-button', '管理'); manage.type = 'button'; manage.addEventListener('click', manageDialog);
    foot.append(layouts, manage, reviewButton);
    root.append(shelfStamp, top, aside, examsRow, cover, add, tools, list, compactList, foot, stage, toastHost);

    function toast(text, action) {
      clearTimeout(toastTimer); toastHost.replaceChildren(el('span', '', text)); toastHost.hidden = false;
      if (action) { const b = el('button', '', action.label); b.type = 'button'; b.addEventListener('click', () => { toastHost.hidden = true; action.run(); }); toastHost.append(b); }
      toastTimer = setTimeout(() => { toastHost.hidden = true; }, action ? 6000 : 3200);
    }

    async function load() {
      const token = ++revision;
      try {
        const result = await request('list', {filter, query, limit: 500, exam: examFilter});
        if (!alive || token !== revision) return;
        data = result; render();
        if(route.wordId) { const node=[...root.querySelectorAll('[data-id]')].find(n=>n.dataset.id===route.wordId&&n.getClientRects().length);if(node){node.tabIndex=-1;node.scrollIntoView({block:'center'});node.focus();delete route.wordId;} }
        clearTimeout(poll);
        if ((result.counts.pending || result.retagging) && !document.hidden && (!ctx.pane || desk.isFocused())) poll = setTimeout(load, 2500);
        if (route.review && !route.started) { route.started = true; if (result.counts.due) startReview(); else toast('今天没有要复习的生词'); }
      } catch (error) { if (alive && token === revision) { count.textContent = error.message || '读取失败'; } }
    }

    function render() {
      const {counts, words} = data;
      root.toggleAttribute('data-reviewing', Boolean(review));
      compactTitle.textContent = `今天到期 ${counts.due || 0} 个`;
      const primary = data.exams?.find(exam => exam.id === data.settings?.primary);
      const kicker = bookKicker; if (kicker) kicker.textContent = '生词本 · ' + (primary?.name || '单词和短语');
      compactList.replaceChildren();
      for (const word of words) {
        const row = el('article', 'v-book-word'); row.dataset.id = word.id;
        const term = el('div', 'v-book-term'); term.append(el('b', '', word.word), el('span', 'v-book-sound', word.userHomophone || word.homophone || ''));
        const meaning = el('div', 'v-book-meaning'); meaning.append(el('span', '', word.meaning || word.hint || (word.status === 'failed' ? '整理失败' : '碧琪正在整理…')));
        if (word.collocations?.length) meaning.append(document.createTextNode(' · ' + word.collocations[0].en));
        const strength = el('span', 'v-book-memory'), level = Math.max(0, Math.min(5, (Number(word.reviewLevel) || 0) + (word.reviewCount ? 1 : 0)));
        strength.setAttribute('aria-label', `记忆强度 ${level} / 5`); for (let i = 0; i < 5; i++) strength.append(window.__pinkieDeskKit?.star(i < level ? level >= 4 ? 'gold' : 'full' : '') || '');
        const detail = el('button', 'v-book-detail', '详情'); detail.type = 'button'; detail.setAttribute('aria-label', '查看 ' + word.word); detail.addEventListener('click', () => wordDialog(word));
        if (word.sourceNoteId) { const origin = el('button', 'v-book-origin', '出处 ↗'); origin.type = 'button'; origin.addEventListener('click', () => ctx.go('notes', {noteId: word.sourceNoteId})); meaning.append(origin); }
        row.append(term, meaning, strength, detail);
        if (Number(word.createdAt) > Date.now() - 600000) { row.classList.add('is-new'); const stamp = el('span', 'pk-stamp v-book-new', '刚收'); row.prepend(stamp); }
        compactList.append(row);
      }
      if (!words.length) compactList.append(el('p', 'v-book-empty', '生词本还是空的。点页底「管理」，写下要背的词。'));
      count.textContent = counts.total ? `${counts.total} 个词${counts.pending ? ` · ${counts.pending} 个整理中` : ''}` : '还没有生词';
      model.textContent = data.model ? `内置模型 · ${data.model}` : data.organizing ? '内置模型整理中' : '内置模型';
      reviewButton.textContent = counts.due ? `复习 ${counts.due} 个` : '今天没有要复习的'; if (counts.due && window.__pinkieDeskKit) reviewButton.append(window.__pinkieDeskKit.star('full'));
      shelfStamp.hidden = !counts.total;
      reviewButton.disabled = !counts.due;
      retryAll.hidden = !counts.failed;
      renderExams();
      if (review) return;
      list.replaceChildren();
      list.classList.toggle('is-table', layout === 'table');
      if (!words.length) {
        const empty = el('div', 'v-empty');
        empty.append(el('strong', '', counts.total ? '没有符合条件的生词' : '生词本还是空的'),
          el('p', '', counts.total ? '换个筛选或搜索词试试。' : '在上面写下第一个词，碧琪会把它整理成好记的谐音和常考搭配。'));
        list.append(empty); return;
      }
      if (layout === 'table') { list.append(table(words)); return; }
      for (const word of words) list.append(card(word));
    }

    const examOf = id => data?.exams?.find(item => item.id === id);
    // 考试标签最多三个：B 级粉色，其它中性色。
    function examTags(word, max = 3) {
      const wrap = el('span', 'v-tags');
      for (const tag of (word.exams || []).slice(0, max)) {
        const exam = examOf(tag.id); if (!exam) continue;
        wrap.append(el('span', 'v-tag' + (tag.id === 'pretco-b' ? ' is-b' : '') + (tag.tier === '超纲' ? ' is-out' : ''), `${exam.short} ${tag.tier}`));
      }
      return wrap;
    }
    function renderExams() {
      const settings = data.settings || {exams: [], primary: ''}, selected = settings.exams || [];
      examsRow.replaceChildren(el('span', 'v-exams-label', '我在备考'));
      for (const exam of data.exams || []) {
        const on = selected.includes(exam.id), b = el('button', 'v-exam' + (on ? ' is-on' : '')); b.type = 'button'; b.setAttribute('aria-pressed', String(on));
        b.append(el('span', '', exam.name)); if (on && settings.primary === exam.id && selected.length > 1) b.append(el('span', 'v-exam-primary', '主'));
        b.append(el('span', 'v-exam-count', String(data.counts.byExam?.[exam.id]?.total ?? 0)));
        b.title = on ? (settings.primary === exam.id ? '主考试：释义和搭配按它来写' : '再点一次取消；按住 ⌥ 点设为主考试') : '加入备考';
        b.addEventListener('click', event => {
          let next = on ? selected.filter(id => id !== exam.id) : [...selected, exam.id], primary = settings.primary;
          if (on && event.altKey) { next = selected; primary = exam.id; }
          if (!next.length) { toast('至少选一个考试'); return; }
          if (!next.includes(primary)) primary = next[0];
          void saveSettings({exams: next, primary});
        });
        examsRow.append(b);
      }
      const importButton = el('button', 'v-exam is-add'); importButton.type = 'button'; importButton.append(icon('upload'), el('span', '', '导入自己的词表')); importButton.addEventListener('click', importDialog);
      examsRow.append(importButton);
      if (selected.length > 1) {
        const primary = el('select', 'v-primary'); primary.setAttribute('aria-label', '主考试');
        for (const id of selected) { const o = el('option', '', '主考试：' + (examOf(id)?.name || id)); o.value = id; primary.append(o); }
        primary.value = settings.primary; primary.addEventListener('change', () => void saveSettings({exams: selected, primary: primary.value}));
        examsRow.append(primary);
      }
      if (data.retagging) { const busy = el('span', 'v-retag'); busy.append(icon('loader-circle'), document.createTextNode('碧琪正在补考试标注…')); examsRow.append(busy); }
      cover.replaceChildren();
      for (const id of selected) {
        const exam = examOf(id), stats = data.counts.byExam?.[id] || {total: 0, mastered: 0, learning: 0}; if (!exam) continue;
        const cardNode = el('div', 'v-cv'), row = el('div', 'v-cv-row');
        row.append(el('strong', '', exam.name), el('span', 'v-cv-num', `已收 ${stats.total} · 掌握 ${stats.mastered}`));
        // 一排 8 颗星：收进来的词按比例摊开，掌握的是金箔，在学的是半颗，其余空心。
        const bar = el('div', 'v-cv-bar v-cv-stars'), total = Math.max(1, stats.total), slots = Math.min(8, stats.total), kit = window.__pinkieDeskKit;
        const gold = Math.round(stats.mastered / total * slots), half = Math.min(slots - gold, Math.round(stats.learning / total * slots));
        if (kit) bar.append(kit.stars(Array.from({length: 8}, (_, i) => i < gold ? 'gold' : i < gold + half ? 'half' : '')));
        bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', `${exam.name}：已收 ${stats.total}，掌握 ${stats.mastered}，学习中 ${stats.learning}`);
        cardNode.append(row, bar, el('small', '', exam.approxSize ? `考纲约 ${exam.approxSize} 词 · 只统计你收进来的词` : '只统计你收进来的词'));
        cover.append(cardNode);
      }
      for (const item of data.lists || []) {
        const cardNode = el('div', 'v-cv is-list'), row = el('div', 'v-cv-row');
        row.append(el('strong', '', item.name), el('span', 'v-cv-num', `覆盖 ${item.covered} / ${item.total}`));
        const bar = el('div', 'v-cv-bar v-cv-stars'), lit = item.covered ? Math.max(1, Math.round(item.covered / Math.max(1, item.total) * 8)) : 0;
        if (window.__pinkieDeskKit) bar.append(window.__pinkieDeskKit.stars(Array.from({length: 8}, (_, i) => i < lit ? 'full' : '')));
        cardNode.append(row, bar, el('small', '', `我导入的词表${item.exam ? ' · ' + (examOf(item.exam)?.name || '') : ''}`)); cover.append(cardNode);
      }
      cover.hidden = Boolean(review) || !cover.children.length;
      const current = examSelect.value;
      examSelect.replaceChildren(...[['', '全部考试'], ...(data.exams || []).map(exam => [exam.id, exam.name])].map(([v, t]) => { const o = el('option', '', t); o.value = v; return o; }));
      examSelect.value = current || examFilter;
    }
    async function saveSettings(next) {
      try { const result = await request('settings.set', next); toast(result.retagging ? `已更新备考考试，碧琪正在给 ${result.retagging} 个词补标注` : '已更新备考考试'); await load(); }
      catch (error) { toast(error.message); }
    }
    // 词表视图：一行一个词，单词+音标、谐音、释义·搭配、考试、记忆强度。
    function table(words) {
      const grid = el('div', 'v-table'); grid.setAttribute('role', 'table');
      const head = el('div', 'v-row is-head'); head.setAttribute('role', 'row');
      for (const label of ['单词', '谐音', '释义 · 搭配', '考试', '记忆强度']) { const c = el('span', '', label); c.setAttribute('role', 'columnheader'); head.append(c); }
      grid.append(head);
      for (const word of words) {
        const row = el('div', 'v-row'); row.setAttribute('role', 'row'); row.dataset.status = word.status;
        const w = el('div', 'v-cell-word'); w.append(el('b', '', word.word), el('span', 'v-ph', [word.phonetic, word.pos].filter(Boolean).join(' ')));
        const sound = el('div', 'v-cell-sound'); if (word.userHomophone) sound.append(el('span', 'v-hm', word.userHomophone)); if (word.homophone && word.homophone !== word.userHomophone) sound.append(el('span', word.userHomophone ? 'v-hm-alt' : 'v-hm', word.homophone));
        const meaning = el('div', 'v-cell-meaning'); meaning.append(el('span', '', word.status === 'ready' ? word.meaning : word.status === 'failed' ? (word.error || '整理失败') : '碧琪正在整理…'));
        if (word.collocations?.length) meaning.append(el('span', 'v-ph', word.collocations.slice(0, 2).map(pair => pair.en).join(' · ')));
        const raw = Number(word.reviewLevel), level = Number.isFinite(raw) ? Math.max(0, Math.min(5, raw + 1)) : 0, strength = el('span', 'v-strength'); strength.setAttribute('aria-label', `记忆强度 ${level} / 5`);
        for (let i = 0; i < 5; i++) strength.append(window.__pinkieDeskKit?.star(i < level ? level >= 4 ? 'gold' : 'full' : '') || el('i', i < level ? 'f' : ''));
        row.append(w, sound, meaning, examTags(word), strength); grid.append(row);
      }
      return grid;
    }
    function wordDialog(word) {
      const d = el('dialog', 'lesson-dialog v-dialog'); d.setAttribute('aria-label', '生词详情');
      const close = el('button', 'v-text-button', '关闭'); close.type = 'button'; close.addEventListener('click', () => d.close()); d.append(close, card(word));
      root.append(d); d.addEventListener('close', () => d.remove(), {once: true}); d.showModal();
    }
    function manageDialog() {
      const d = el('dialog', 'lesson-dialog v-dialog v-management'); d.setAttribute('aria-label', '生词本管理');
      const close = el('button', 'v-text-button', '关闭'); close.type = 'button'; close.addEventListener('click', () => d.close()); d.append(el('h2', '', '生词本管理'), close);
      const positions = [examsRow, cover, add, tools].map(node => [node, node.nextSibling]); for (const [node] of positions) d.append(node);
      root.append(d); d.addEventListener('close', () => { for (const [node] of positions) root.insertBefore(node, list); d.remove(); }, {once: true}); d.showModal();
    }
    function importDialog() {
      const d = el('dialog', 'lesson-dialog v-dialog'); d.setAttribute('aria-label', '导入自己的词表');
      const head = el('header'), close = el('button', 'v-icon-button'); close.type = 'button'; close.setAttribute('aria-label', '关闭'); close.append(icon('x')); close.addEventListener('click', () => d.close());
      head.append(el('h2', '', '导入自己的词表'), close);
      const form = el('form', 'v-import'), name = el('input'); name.placeholder = '词表名字，例如：四级高频 500'; name.setAttribute('aria-label', '词表名字');
      const exam = el('select'); exam.setAttribute('aria-label', '属于哪个考试'); for (const [v, t] of [['', '不属于某个考试'], ...(data?.exams || []).map(item => [item.id, item.name])]) { const o = el('option', '', t); o.value = v; exam.append(o); }
      const text = el('textarea'); text.rows = 8; text.placeholder = '一行一个英文单词或短语；也可以选一个 txt / csv 文件'; text.setAttribute('aria-label', '词表内容');
      const file = el('input'); file.type = 'file'; file.accept = '.txt,.csv,text/plain,text/csv'; file.setAttribute('aria-label', '选择词表文件');
      file.addEventListener('change', async () => { const f = file.files?.[0]; if (!f) return; if (f.size > 2_000_000) { toast('文件太大，最多 2MB'); return; } text.value = await f.text(); if (!name.value) name.value = f.name.replace(/\.[^.]+$/, ''); });
      const note = el('p', 'v-add-hint', '只用来算覆盖率，不会把这些词塞进生词本。');
      const ok = el('button', 'v-add-button', '导入'); ok.type = 'submit';
      form.append(name, exam, text, file, note, ok);
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (ok.disabled) return; ok.disabled = true;
        try { const result = await request('importList', {name: name.value, text: text.value, exam: exam.value}); d.close(); toast(`已导入 ${result.list.total} 个词，覆盖 ${result.list.covered} 个`); await load(); }
        catch (error) { toast(error.message); } finally { ok.disabled = false; }
      });
      d.append(head, form); root.append(d); d.addEventListener('close', () => d.remove(), {once: true}); d.showModal(); name.focus();
    }

    function card(word, {full = true} = {}) {
      const item = el('article', 'v-card'); item.dataset.status = word.status; item.dataset.id = word.id;
      const head = el('div', 'v-head');
      head.append(el('h3', 'v-word', word.word));
      if (window.speechSynthesis) { const say = el('button', 'v-say'); say.type = 'button'; say.setAttribute('aria-label', `朗读 ${word.word}`); say.append(icon('volume-2')); say.addEventListener('click', () => speak(word.word)); head.append(say); }
      if (word.exams?.length) head.append(examTags(word));
      item.append(head);
      const sub = [word.phonetic, word.pos].filter(Boolean).join('  ');
      if (sub) item.append(el('p', 'v-phonetic', sub));
      if (word.status === 'pending' || word.status === 'organizing') {
        const wait = el('p', 'v-wait'); wait.append(icon('loader-circle'), document.createTextNode(word.hint ? `${word.hint} · 碧琪正在整理谐音和搭配…` : '碧琪正在整理谐音和搭配…'));
        item.append(wait); if (full) item.append(actions(word)); return item;
      }
      if (word.status === 'failed') {
        if (word.hint) item.append(el('p', 'v-meaning', word.hint));
        item.append(el('p', 'v-error', word.error || '整理失败，原词已保存'));
        if (full) item.append(actions(word)); return item;
      }
      if (word.meaning) item.append(el('p', 'v-meaning', word.meaning));
      if (word.userHomophone || word.homophone || word.memory) {
        // 先生自己写的谐音排在前面，碧琪给的放后面。
        const sound = el('div', 'v-sound');
        sound.append(el('span', 'v-label', word.userHomophone || word.homophone ? '谐音' : '记忆'));
        const body = el('div');
        if (word.userHomophone) { const mine = el('strong', '', word.userHomophone); mine.append(el('small', 'v-mine', '我写的')); body.append(mine); }
        if (word.homophone && word.homophone !== word.userHomophone) body.append(word.userHomophone ? el('p', 'v-hm-alt', '碧琪：' + word.homophone) : el('strong', '', word.homophone));
        if (word.memory) body.append(el('p', '', word.memory));
        sound.append(body); item.append(sound);
      }
      if (word.collocations?.length) {
        const primary = examOf(data?.settings?.primary);
        const block = el('div', 'v-block'); block.append(el('span', 'v-label', `${primary ? primary.short : ''}常考搭配`));
        const ul = el('ul', 'v-colls');
        for (const pair of word.collocations) { const li = el('li'); li.append(el('b', '', pair.en), el('span', '', pair.zh)); ul.append(li); }
        block.append(ul); item.append(block);
      }
      if (word.example?.en) {
        const block = el('div', 'v-block v-example'); block.append(el('span', 'v-label', '例句'), el('p', 'v-en', word.example.en));
        if (word.example.zh) block.append(el('p', 'v-zh', word.example.zh));
        item.append(block);
      }
      if (word.examTip) { const tip = el('p', 'v-tip'); tip.append(icon('lightbulb'), document.createTextNode(word.examTip)); item.append(tip); }
      if (full) item.append(actions(word));
      return item;
    }

    function actions(word) {
      const foot = el('footer', 'v-foot');
      const raw = Number(word.reviewLevel), level = Number.isFinite(raw) ? Math.max(0, Math.min(5, raw + 1)) : 0;
      if (word.status === 'ready' && window.__pinkieDeskKit) { const mem = window.__pinkieDeskKit.stars(Array.from({length: 5}, (_, i) => i < level ? level >= 4 ? 'gold' : 'full' : ''), {label: `记忆强度 ${level} / 5`}); mem.classList.add('v-mem'); foot.append(mem); }
      foot.append(el('span', 'v-next', word.status === 'ready' ? nextLabel(word.nextReviewAt) : word.status === 'failed' ? '未整理' : '整理中'));
      if (word.status !== 'organizing') {
        const redo = el('button', 'v-icon-button'); redo.type = 'button'; redo.title = '重新整理'; redo.setAttribute('aria-label', `重新整理 ${word.word}`); redo.append(icon('refresh-cw'));
        redo.addEventListener('click', async () => { redo.disabled = true; try { await request('organize', {ids: [word.id]}); await load(); } catch (error) { toast(error.message); redo.disabled = false; } });
        foot.append(redo);
      }
      const remove = el('button', 'v-icon-button'); remove.type = 'button'; remove.title = '删除'; remove.setAttribute('aria-label', `删除 ${word.word}`); remove.append(icon('trash-2'));
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          const result = await request('delete', {id: word.id}); await load();
          toast(`已删除 ${word.word}`, {label: '撤销', run: async () => { try { await request('restore', {word: result.word}); await load(); } catch (error) { toast(error.message); } }});
        } catch (error) { toast(error.message); remove.disabled = false; }
      });
      const ask = el('button', 'v-text-button', '问碧琪'); ask.type = 'button'; ask.addEventListener('click', () => desk.askRef('word:' + word.id, word.word));
      const origin = el('button', 'v-text-button', '出处'); origin.type = 'button'; origin.addEventListener('click', () => desk.revealRef('word:' + word.id));
      foot.append(ask, origin, remove);
      return foot;
    }

    async function addWords() {
      const text = input.value.trim(); if (!text || submit.disabled) return;
      submit.disabled = true;
      try {
        const result = await request('add', {text});
        input.value = '';
        const parts = [];
        if (result.added.length) parts.push(`加入 ${result.added.length} 个，碧琪正在整理`);
        if (result.duplicates.length) parts.push(`${result.duplicates.slice(0, 3).join('、')}${result.duplicates.length > 3 ? ' 等' : ''}已经在生词本里`);
        toast(parts.join('；'));
        if (filter !== 'all' && filter !== 'pending') { filter = 'all'; for (const node of filters.children) node.setAttribute('aria-pressed', String(node.dataset.filter === 'all')); }
        await load();
        if (result.added.length) ctx.motion?.confettiAt?.(submit, 'small');
      } catch (error) { toast(error.message || '加入失败'); }
      finally { submit.disabled = false; input.focus(); }
    }

    async function startReview() {
      try {
        const queue = await request('review.queue', {limit: 20});
        if (!alive) return;
        if (!queue.words.length) { toast('今天没有要复习的生词'); return; }
        review = {words: queue.words, index: 0, flipped: false, done: 0}; root.setAttribute('data-reviewing', '');
        list.hidden = add.hidden = tools.hidden = filters.hidden = reviewButton.hidden = examsRow.hidden = cover.hidden = aside.hidden = true; stage.hidden = false; renderReview();
      } catch (error) { toast(error.message); }
    }

    function endReview() {
      review = null; root.removeAttribute('data-reviewing'); stage.hidden = true; stage.replaceChildren(); list.hidden = add.hidden = tools.hidden = filters.hidden = reviewButton.hidden = examsRow.hidden = aside.hidden = false; load();
    }

    function renderReview() {
      stage.replaceChildren();
      const bar = el('div', 'v-stage-bar'), back = el('button', 'v-text-button', '回到生词本'); back.type = 'button'; back.addEventListener('click', endReview);
      const word = review.words[review.index];
      bar.append(el('span', 'v-progress', word ? `第 ${review.index + 1} / ${review.words.length} 个` : '本轮完成'), back);
      stage.append(bar);
      if (!word) {
        const done = el('div', 'v-empty'); done.append(el('strong', '', `这一轮复习了 ${review.done} 个词`), el('p', '', '记得的会隔几天再回来，忘了的明天再见。'));
        stage.append(done); return;
      }
      const flash = el('div', 'v-flash');
      if (!review.flipped) {
        const front = el('button', 'v-front'); front.type = 'button'; front.setAttribute('aria-label', '翻面');
        front.append(el('strong', 'v-word', word.word), el('span', 'v-phonetic', word.phonetic || ''), el('span', 'v-hint', '先在心里想中文和谐音，按空格翻面'));
        front.addEventListener('click', flip); flash.append(front);
        if (window.speechSynthesis) speak(word.word);
      } else {
        flash.append(card(word, {full: false}));
        const rate = el('div', 'v-rate');
        for (const [rating, label, key] of RATINGS) { const b = el('button', '', label); b.type = 'button'; b.dataset.rating = rating; b.append(el('kbd', '', key)); b.addEventListener('click', () => grade(rating)); rate.append(b); }
        flash.append(rate);
      }
      stage.append(flash);
    }
    function flip() { if (review && !review.flipped && review.words[review.index]) { review.flipped = true; renderReview(); } }
    async function grade(rating) {
      const word = review?.words[review.index]; if (!word || !review.flipped) return;
      try { await request('review', {id: word.id, rating}); } catch (error) { toast(error.message); return; }
      if (!review) return;
      review.done++; review.index++; review.flipped = false; renderReview();
    }

    keyHandler = event => {
      if (!review || event.target.closest?.('input, textarea')) return;
      if (event.code === 'Space') { event.preventDefault(); flip(); return; }
      const rating = RATINGS.find(item => item[2] === event.key); if (rating && review.flipped) { event.preventDefault(); grade(rating[0]); }
    };
    const teardown = () => { desk.local().vocabUi = {filter, query, review, examFilter, layout}; alive = false; revision++; clearTimeout(poll); clearTimeout(searchTimer); clearTimeout(toastTimer); window.speechSynthesis?.cancel(); keyHandler = null; };
    load();
    return {unmount: teardown, keydown: event => keyHandler?.(event), pause() { clearTimeout(poll); window.speechSynthesis?.cancel(); }, resume() { if (alive && (data?.counts?.pending || data?.retagging)) { clearTimeout(poll); poll = setTimeout(load, 2500); } }};
  }

  // 选中文字 → 记生词：和「记笔记」同一条选中工具条，只在学习模式、选中的是英文词或短语时出现。
  const pageSession = () => new URL(location.href).searchParams.get('session')
    || document.querySelector('.sidebar-recent-session--active[data-session-key]')?.dataset.sessionKey || '';
  const learning = () => document.documentElement.getAttribute('data-laolao-mode') === 'learning' || pageSession().startsWith('agent:learning:');
  // 和后端同一套判断：每行是英文词或短语，后面最多跟一句简短中文释义；讲了用法道理（后接、区别……）或是整句英文的不算。
  const RULE_HINT = /[A-Za-z]|后接|后面|接动|区别|用于|用法|表示|不能|必须|一般|注意|句|[。！？]/;
  const looksLikeVocab = text => {
    const lines = text.split(/\n+/).map(line => line.trim().replace(/^[-*•\d.、)\s]+/, '')).filter(Boolean);
    return lines.length >= 1 && lines.length <= 30 && text.length <= 600 && lines.every(line => {
      const match = line.match(/^([A-Za-z][A-Za-z'’\- .()/]*[A-Za-z.)]|[A-Za-z])\s*(?:[-—–:：=,，]\s*)?([^A-Za-z].*)?$/);
      if (!match) return false;
      const words = match[1].trim().split(/\s+/), hint = (match[2] || '').trim();
      if (words.length > 6 || (words.length >= 3 && /\.$/.test(match[1]) && !/\b(?:sth|sb)\.$/.test(match[1]))) return false;
      return hint.length <= 24 && !RULE_HINT.test(hint);
    });
  };
  const chatToast = (message, error = false) => {
    let toast = document.querySelector('.laolao-learning-toast');
    if (!toast) { toast = el('div', 'laolao-learning-toast'); toast.setAttribute('role', 'status'); document.body.append(toast); }
    toast.textContent = message; toast.dataset.error = error ? '1' : '0'; toast.classList.add('is-visible');
    clearTimeout(chatToast.timer); chatToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  };
  const saveSelectedWords = async text => {
    const gateway = window.__laolaoSidebar?.gwRequest;
    if (typeof gateway !== 'function') return chatToast('学习台正在连接，请稍后再试', true);
    try {
      const result = await gateway('pinkie.learning.vocab.add', {sessionKey: pageSession(), text}, 20000);
      if (result.added.length) chatToast(`已记进生词本：${result.added.map(word => word.word).slice(0, 3).join('、')}${result.added.length > 3 ? ' 等' : ''}，碧琪正在整理谐音和搭配`);
      else chatToast(`${result.duplicates.slice(0, 3).join('、')} 已经在生词本里`);
    } catch (error) { chatToast(error.message || '生词保存失败', true); }
  };
  const registerSelection = () => {
    if (!window.__pinkieSelectionActions?.register) return false;
    window.__pinkieSelectionActions.register('vocab', {
      // 只在像单词时出现；出现时排在「记笔记」前面，当主按钮。
      order: 0,
      when: ({text, assistant, library}) => learning() && (!!assistant || !!library) && looksLikeVocab(text),
      create: () => el('button', 'laolao-learning-selection-save laolao-learning-selection-vocab', '记生词'),
      run: selected => { if (selected.assistant && window.__pinkieDeskChat?.active?.() && window.__pinkieDeskChat?.collectSelection) void window.__pinkieDeskChat.collectSelection(selected, 'word').catch(() => {}); else void saveSelectedWords(selected.text); },
    });
    return true;
  };
  if (!registerSelection()) {
    window.addEventListener('pinkie:selection-ready', registerSelection, {once:true});
  }

  function register() {
    const desk = window.__pinkieStudyDesk;
    if (registered || !desk?.registerView) return registered;
    desk.registerView('vocab', {title: '生词本', icon: 'book-a', mount});
    registered = true; return true;
  }
  if (!register()) {
    const timer = window.setInterval(() => { if (register()) window.clearInterval(timer); }, 200);
    window.addEventListener('pagehide', () => window.clearInterval(timer), {once: true});
  }
})();
