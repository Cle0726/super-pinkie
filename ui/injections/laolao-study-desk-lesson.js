/* 碧琪学习台：每页独立的课程状态和资源清理。 */
(() => {
  'use strict';
  if (window.__pinkieStudyDeskLesson) return;
  const globalDesk = window.__pinkieStudyDesk; if (!globalDesk) return;
  function create(desk) {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (text, action, cls = 'lesson-secondary', mark) => { const n = el('button', cls); n.type = 'button'; if (mark && mark !== 'arrow') n.append(desk.icon(mark, {size: 'xs'})); n.append(el('span', '', text)); if (mark === 'arrow') n.append(desk.icon(mark, {size: 'xs'})); n.addEventListener('click', () => { Promise.resolve().then(() => action(n)).catch(error => report(n, error)); }); return n; };
  const data = () => desk.local().lessonUi ||= {mock: new Set(), prepared: null, current: null, revision: 0};
  const root = () => desk.pane()?.host || document.getElementById('pinkie-study-desk');
  const valid = (key, node) => desk.sessionKey() === key && Boolean(root()?.isConnected) && (!node || node.isConnected);
  const report = (node, error) => { const host = node?.closest('dialog,.lesson-paper,.lesson-bar') || root(); if (!host) return; let line = host.querySelector('.lesson-error'); if (!line) { line = el('p', 'lesson-error'); line.setAttribute('role', 'status'); host.append(line); } line.textContent = error.message || String(error); };
  const usage = u => Number(u?.total ?? u?.totalTokens ?? ((u?.input || 0) + (u?.output || 0))).toLocaleString();
  const model = m => typeof m === 'string' ? m : m?.name || m?.id || '简版课纲';
  const pointTitle = l => l?.point?.text || '选择一个考点';
  const readLabel = p => ({text: '原文', ocr: '识别', vision: '模型读过', transcript: '转写稿', unread: '还没读'}[p.readBy] || '本机文字');
  const stamp = at => { const n = new Date(at); return Number.isFinite(+n) ? `${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}` : '尚未扫描'; };
  function demo(host, local = data()) { if (local.mock.size && !host.querySelector('.lesson-demo')) host.append(el('small', 'lesson-demo', '示意数据')); }
  function mock(method, p, local) {
    local.fixture ||= {roots: [{id: 'study', label: '专升本讲义', path: '学习 / 专升本', mounted: true, lastScanAt: Date.now()}], files: {total: 436, indexed: 412, pending: 17, failed: 7, unsupported: 7}, pages: {total: 8393, text: 4195, ocr: 1203, ocrPending: 2995, vision: 37}, videos: {total: 875, transcribed: 163, pending: 712}, jobs: [{kind: 'scan', done: 412, total: 436, state: 'idle'}, {kind: 'ocr', done: 1203, total: 4198, state: 'running'}, {kind: 'map', done: 390, total: 412, state: 'waiting'}, {kind: 'vision', done: 37, total: 200, state: 'idle'}, {kind: 'transcribe', done: 163, total: 875, state: 'waiting', reason: '夜间 23:30–07:00 运行'}], tools: {pdftotext: true, pdftoppm: true, tesseract: true, ffmpeg: true, whisper: true}, storeBytes: 86 * 1024 * 1024};
    const page = {ref: 'm:demo:12', title: '动态电路讲义.pdf', label: '第 12 页', citation: '动态电路讲义.pdf · 第 12 页', subject: 'ee', chapters: ['ee4'], readBy: 'text', original: local.fixture.roots[0].mounted ? 'available' : 'offline'};
    if (method === 'materials.status') return structuredClone(local.fixture);
    if (method === 'materials.unsupported') return [{path: '旧版课件.doc', reason: '旧版文档格式暂不支持'}];
    if (method === 'materials.scan') return {queued: 17};
    if (method === 'materials.jobs.control') { for (const j of local.fixture.jobs) if (j.kind === p.kind) j.state = p.action === 'pause' ? 'paused' : 'running'; return structuredClone(local.fixture.jobs); }
    if (method === 'materials.read') return {pages: [{...page, ref: p.ref, text: '换路瞬间，电容电压和电感电流不能突变。先找换路前的稳态，再列出初始条件。'}], original: page.original};
    if (method === 'materials.pageImage') { const canvas = el('canvas'); canvas.width = 800; canvas.height = 1132; const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 1132); ctx.fillStyle = '#2E2236'; ctx.font = '30px serif'; ctx.fillText('换路定律 · 示意原页', 70, 110); ctx.font = '22px serif'; ctx.fillText('电容电压、电感电流不能突变。', 70, 180); return {dataUrl: canvas.toDataURL(), width: 800, height: 1132}; }
    if (method === 'materials.reveal') return {ok: true};
    if (method === 'lesson.current') return local.mockCurrent || null;
    if (method === 'lesson.prepare') {
      const subjects = desk.local().today?.mastery?.subjects || [];
      let point = {subject: '电工电子', chapter: p.k, chapterTitle: '动态电路', text: '换路定律', level: '掌握'};
      for (const s of subjects) for (const ch of s.chapters || []) if (ch.k === p.k) point = {subject: s.name, chapter: ch.k, chapterTitle: ch.t, text: ch.items[p.i]?.text || ch.t, level: ch.lv?.[p.i] === 1 ? '了解' : '掌握'};
      return {lessonId: 'demo-' + crypto.randomUUID(), status: 'ready', point, outline: {segments: [{n: 1, title: '先认清是什么', goal: '用自己的话说出定义', sources: [page.ref]}, {n: 2, title: '动手看一看', goal: '观察变化前后的关系', sources: [page.ref], lab: 'rc_transient'}, {n: 3, title: '试着用一次', goal: '独立完成一个小例子', sources: [page.ref]}], estMinutes: 15, opening: '先生，我们先看清换路前后，哪些量不能突然改变。', watchOut: '先找初始条件，再计算。'}, sources: [page], videos: [{id: 'demo-video', title: '第 37 讲 换路定律', durationSec: 2520, available: page.original === 'available', transcript: true}], record: {lessonCount: 1, lastStuck: '换路前后哪些量不能突变', worked: ['动手实验'], failed: ['水流类比']}, model: null, usage: {total: 0}};
    }
    if (method === 'lesson.begin') { local.mockCurrent = {...local.prepared, status: 'active', segment: 1, checks: {asked: 0, correct: 0}, startedAt: Date.now(), minutes: 0}; return {status: 'active', message: `开始上课：${pointTitle(local.prepared)}`}; }
    if (method === 'lesson.event') { if (!local.mockCurrent) throw Error('示意课程已结束'); if (p.type !== 'stuck') local.mockCurrent.status = p.type === 'pause' ? 'paused' : 'active'; return structuredClone(local.mockCurrent); }
    if (method === 'lesson.abandon') { local.mockCurrent = null; return {status: 'abandoned'}; }
    if (method === 'lesson.finish') { local.mockCurrent = null; return {status: 'done', state: 'learned', noteId: null, summary: {title: pointTitle(local.prepared) + ' · 课后笔记', keyPoints: ['先认清定义，再判断条件。', '每一步都说明使用的关系。', '用一道小题检查理解。'], formulas: ['u_C(0^+)=u_C(0^-)'], pitfalls: ['初始条件需要从换路前求出。'], stuck: [{segment: 2, what: '换路前后的量', resolved: true}], next: '先练 4 道，再看哪里需要补讲。'}, next: {kind: 'set', k: local.selection?.k || 'ee4', i: local.selection?.i || 0, size: 4}, model: null, usage: {total: 0}}; }
    throw Error('示意数据不支持这个操作');
  }
  async function rpc(method, params = {}, local = data(), key = desk.sessionKey()) {
    const family = method.startsWith('materials.') ? 'materials' : 'lesson';
    if (local.mock.has(family)) return mock(method, params, local);
    try { return await desk.request('pinkie.learning.' + (family === 'lesson' ? 'desk.' : '') + method, {sessionKey: key, ...params}, 50000); }
    catch (error) { if (!/unknown method|method (?:not found|not registered)|未知方法/i.test(error.message || '')) throw error; local.mock.add(family); return mock(method, params, local); }
  }
  function skeleton(host, count = 4) { const n = el('div', 'lesson-skeleton'); n.setAttribute('aria-label', '加载中'); for (let i = 0; i < count; i++) n.append(el('i')); host.append(n); }
  function dialog(title, cls = '') {
    const node = el('dialog', 'lesson-dialog ' + cls), header = el('header'), close = btn('关闭', () => node.close(), 'lesson-icon', 'x'); close.setAttribute('aria-label', '关闭' + title);
    node.setAttribute('aria-label', title); header.append(el('h2', '', title), close); node.append(header); const previous = document.activeElement;
    root()?.append(node); node.addEventListener('close', () => { node.remove(); if (previous?.isConnected) previous.focus(); }, {once: true});
    node.showModal(); close.focus(); return node;
  }
  async function mountStatus(host, initial) {
    const local = data(), key = desk.sessionKey();
    const control = btn('讲义状态', openMaterials, 'materials-status', 'file-text'); host.append(control);
    // 今日页先拼好再挂进页面：等一拍再更新，否则 isConnected 还是 false，状态标和轮询都永远不启动（2026-10-26 真机发现）。
    await new Promise(resolve => setTimeout(resolve, 0));
    let hasJobs = false;
    const update = m => {
      if (!valid(key, control)) return;
      const busy = m.busy || m.jobs?.find(j => j.state === 'running'), mounted = m.mounted ?? m.roots?.some(r => r.mounted);
      hasJobs = Boolean(busy);
      if (!hasJobs) { clearInterval(statusPolling); statusPolling=0; }
      const label = busy ? `${{scan: '正在索引', ocr: '识别扫描页', map: '正在对齐', vision: '正在读页', transcribe: '正在转写'}[busy.kind] || '正在处理'} ${Number(busy.done || 0).toLocaleString()} / ${Number(busy.total || 0).toLocaleString()}` : mounted ? `讲义 · 已索引 ${m.indexedFiles ?? m.files?.indexed ?? 0} 份 · ${stamp(m.updatedAt || m.roots?.[0]?.lastScanAt)} 更新` : 'U盘未插 · 用本机索引';
      control.replaceChildren(desk.icon(mounted ? 'usb' : 'hard-drive', {size: 'xs'}), el('span', '', label)); control.title = label;
      if (local.mock.has('materials')) control.append(el('small', 'status-demo', '讲义示意数据'));
    };
    if (initial) update(initial);
    else { control.setAttribute('aria-busy', 'true'); try { update(await rpc('materials.status', {}, local, key)); } catch (error) { if (valid(key, control)) { control.replaceChildren(el('span', '', '讲义状态未读到 · 点此重试')); control.title = error.message; } } finally { control.removeAttribute('aria-busy'); } }
    clearInterval(statusPolling);
    if (hasJobs && valid(key, control)) statusPolling = setInterval(async () => { if (!valid(key, control) || root()?.dataset.view !== 'today' || document.hidden || !desk.isFocused()) return; try { update(await rpc('materials.status', {}, local, key)); } catch (error) { if (valid(key, control)) control.title = error.message; } }, 15000);
  }
  async function openMaterials() {
    const node = dialog('讲义', 'materials-panel'), body = el('div'); node.append(body); const key = desk.sessionKey(), local = data(); let revision = 0;
    async function load() {
      const token = ++revision; body.replaceChildren(); skeleton(body, 6);
      try {
        const [status, unsupported] = await Promise.all([rpc('materials.status', {}, local, key), rpc('materials.unsupported', {}, local, key).catch(error => ({error: error.message}))]);
        if (!valid(key, node) || token !== revision) return;
        body.replaceChildren(el('p', 'lesson-meta', `原件留在U盘，本机只存文字和页码 · 占用 ${Math.round((status.storeBytes || 0) / 1048576)} MB`));
        for (const r of status.roots || []) { const line = el('div', 'material-root'); line.append(desk.icon(r.mounted ? 'usb' : 'hard-drive', {size: 'sm'}), el('strong', '', r.label), el('small', '', r.mounted ? '已连接' : '未连接 · 上次 ' + stamp(r.lastScanAt)), el('code', '', r.path)); body.append(line); }
        if (!status.roots?.length) body.append(el('p', 'lesson-banner', '尚未发现讲义目录，插上U盘后立即扫描。'));
        const jobs = status.jobs || [];
        for (const [kind, title] of [['scan', '索引'], ['ocr', '识别'], ['map', '对齐'], ['vision', '读页'], ['transcribe', '转写']]) {
          const j = jobs.find(j => j.kind === kind) || {done: 0, total: 0, state: 'idle'};
          const row = el('div', 'material-job'), meter = el('progress'); meter.max = Math.max(1, j.total || 0); meter.value = j.done || 0; meter.setAttribute('aria-label', title); row.dataset.state = j.state;
          row.append(el('span', '', title), meter, el('small', '', `${j.done || 0} / ${j.total || 0}${j.state === 'paused' ? ' · 已暂停' : ''}`));
          if (j.reason) row.append(el('p', 'lesson-meta', j.reason));
          if (kind === 'vision') row.append(el('p', 'lesson-meta', status.visionBudget ? `今日读页额度 ${status.visionBudget.used} / ${status.visionBudget.limit}` : '今日读页额度：服务端尚未提供'));
          body.append(row);
        }
        const missing = Object.entries(status.tools || {}).filter(([, ok]) => !ok).map(([name]) => name);
        if (missing.length) body.append(el('p', 'lesson-banner', `缺少 ${missing.join('、')}，对应任务暂不可用。`));
        const details = el('details'); const list = Array.isArray(unsupported) ? unsupported : unsupported.files || [];
        details.append(el('summary', '', `读不出的资料 ${list.length}`)); if (unsupported.error) details.append(el('p', '', unsupported.error));
        for (const item of list) details.append(el('p', 'lesson-meta', `${item.path} · ${item.reason}`)); body.append(details);
        const actions = el('footer', 'lesson-actions');
        const control = async (button, method, params) => { button.disabled = true; try { await rpc(method, params, local, key); if (valid(key, node)) await load(); } finally { button.disabled = false; } };
        actions.append(btn('立即扫描', b => control(b, 'materials.scan', {})), btn('现在转写', b => control(b, 'materials.jobs.control', {kind: 'transcribe', action: 'now'})));
        const paused = jobs.length > 0 && jobs.every(j => j.state === 'paused');
        actions.append(btn(paused ? '全部继续' : '全部暂停', async b => { b.disabled = true; try { for (const j of jobs) await rpc('materials.jobs.control', {kind: j.kind, action: paused ? 'resume' : 'pause'}, local, key); if (valid(key, node)) await load(); } finally { b.disabled = false; } }, 'lesson-ghost'));
        body.append(actions); demo(body, local);
      } catch (error) { if (valid(key, node)) { body.replaceChildren(el('p', 'lesson-error', error.message), btn('重试', load)); } }
    }
    await load();
  }
  function empty(host) { const node = el('div', 'lesson-empty'); const image = el('img', 'pk-sticker'); image.src = desk.sticker?.('thinking-pencil') || desk.base + 'laolao-pinkie-buddy-learning-working.png'; image.alt = '碧琪'; node.append(image, el('h2', '', '先选一个想学的考点。'), el('p', '', '回到今日，点地图上的考点，就可以备课。'), btn('选择考点', () => desk.go('today'), 'lesson-primary'), btn('回今日', () => desk.go('today'), 'link')); host.append(node); }
  async function openFocus(focus) {
    if (focus.kind === 'lesson') { const local = data(), key = desk.sessionKey(); local.current = await rpc('lesson.current', {}, local, key); if (valid(key)) { if (local.current) window.__pinkieDeskChat?.open?.(); else await open(focus.payload || {}); } }
    else await open(focus.payload || {});
  }
  async function open(selection) {
    const local = data(); local.selection = {k: selection.k || selection.chapter, i: selection.i ?? selection.item ?? 0}; local.result = null; local.prepared = null; local.begun = null; local.prepareError = ''; local.revision++;
    await desk.switchStageMode('learn');
  }
  function renderSide(host, state, text) {
    // 上课用碧琪在小黑板前的贴纸；整理笔记时咬着铅笔想，下课举星星。
    const side = el('aside', 'lesson-side'), image = el('img', 'pk-sticker'), art = {working: 'thinking-pencil', happy: 'correct'}[state] || 'lesson-chalk';
    image.src = desk.sticker?.(art) || desk.base + (state === 'question' ? 'laolao-learning-question.png' : `laolao-pinkie-buddy-learning-${state}.png`); image.alt = '碧琪'; side.append(image, el('p', 'lesson-speech', text)); host.append(side); return side;
  }
  function showConflict(current, proceed) {
    const node = dialog('还有一节没上完', 'lesson-conflict'); node.append(el('p', '', `「${pointTitle(current)}」上到第 ${current.segment || 1} / ${current.outline?.segments?.length || 1} 段。`));
    const actions = el('div', 'lesson-actions'); const resume = btn('继续那一节', () => { node.close(); data().current = current; window.__pinkieDeskChat?.open?.(); }, 'lesson-primary');
    actions.append(resume, btn('放弃它，开始这一节', async b => { b.disabled = true; await rpc('lesson.abandon', {lessonId: current.lessonId}); node.close(); await proceed(); })); node.append(actions); resume.focus();
  }
  function mount(host) {
    const local = data(), key = desk.sessionKey(), token = ++local.revision;
    const paper = el('article', 'lesson-paper'); host.append(paper); host.classList.add('lesson-stage');
    if (local.finishing) { skeleton(paper); renderSide(host, 'working', '碧琪在整理笔记…'); return; }
    if (local.result) { renderSummary(host, paper, local); return; }
    if (!local.selection?.k) { empty(paper); return; }
    if (local.prepared) { renderPrepared(host, paper, local); return; }
    skeleton(paper, 5); const side = renderSide(host, 'typing', '碧琪在备课… 0 秒');
    const active = () => valid(key, host) && token === local.revision;
    const started = Date.now(); let expired = false;
    const timer = setInterval(() => { if (!active()) { clearInterval(timer); return; } const sec = Math.floor((Date.now() - started) / 1000); side.querySelector('p').textContent = `碧琪在备课… ${sec} 秒`; if (sec >= 45) { expired = true; clearInterval(timer); local.revision++; paper.replaceChildren(el('p', 'lesson-error', '备课超时，重试'), btn('重试', () => { local.prepared = null; desk.refresh(); }, 'lesson-secondary', 'rotate-ccw')); side.querySelector('p').textContent = '备课超时了'; } }, 1000);
    host._lessonCleanup = () => clearInterval(timer);
    paper.append(btn('取消', () => { local.revision++; desk.go('today'); }, 'link'));
    const prepare = async () => {
      try { const result = await rpc('lesson.prepare', local.selection, local, key); if (!active() || expired) return; clearInterval(timer); local.prepared = result; desk.refresh(); }
      catch (error) { if (!active() || expired) return; clearInterval(timer); paper.replaceChildren(el('p', 'lesson-error', error.message), btn('重试', () => desk.refresh()), btn('回今日', () => desk.go('today'), 'link')); side.querySelector('p').textContent = '备课暂时没完成，稍后再试。'; }
    };
    rpc('lesson.current', {}, local, key).then(current => {
      if (!active()) return;
      if (current && ['active', 'paused'].includes(current.status) && (current.point?.chapter !== local.selection.k || Number(current.point?.i ?? current.item ?? -1) !== local.selection.i)) { clearInterval(timer); showConflict(current, prepare); }
      else if (current && ['active', 'paused'].includes(current.status)) { clearInterval(timer); showConflict(current, prepare); }
      else void prepare();
    }).catch(error => { if (active()) { clearInterval(timer); paper.replaceChildren(el('p', 'lesson-error', error.message), btn('重试', () => desk.refresh())); } });
    demo(paper, local);
  }
  function renderPrepared(host, paper, local) {
    const lesson = local.prepared, key = desk.sessionKey(), outline = lesson.outline || {};
    paper.append(el('p', 'lesson-meta', `${lesson.point?.subjectName || lesson.point?.subject || ''} · ${lesson.point?.chapterTitle || ''} · 考纲：${lesson.point?.level || '了解'}`), el('h1', '', pointTitle(lesson)));
    if (!lesson.model) paper.append(el('p', 'lesson-meta', '这次用的是简版课纲'));
    const list = el('ol', 'lesson-outline'); for (const [index, seg] of (outline.segments || []).entries()) { const row = el('li'), copy = el('div'), title = el('h3', '', seg.title); if (seg.lab) title.append(desk.icon('flask-conical', {size: 'xs'})); copy.append(title, el('p', '', seg.goal)); row.append(el('b', '', seg.n || index + 1), copy); list.append(row); } paper.append(list);
    if (outline.watchOut) paper.append(el('p', 'keyp', outline.watchOut));
    if (lesson.sources?.some(s => s.original === 'offline')) paper.append(el('p', 'lesson-banner', 'U盘未插 · 讲义用本机文字，原页和视频暂时打不开'));
    const sources = el('section', 'lesson-sources'); sources.append(el('h2', '', '讲义出处'));
    if (!lesson.sources?.length) sources.append(el('p', 'lesson-meta', '暂无对应讲义，可以照常上课。'));
    let extra; for (const [i, p] of (lesson.sources || []).entries()) { if (i === 4) { extra = el('details'); extra.append(el('summary', '', `再看 ${lesson.sources.length - 4} 条`)); sources.append(extra); } const row = el('div', 'lesson-source'); row.append(desk.icon('file-text', {size: 'xs'}), el('span', '', p.citation || p.title + ' · ' + p.label), el('small', 'lesson-chip', readLabel(p)), btn('看原页', () => openPage(p, lesson.sources), 'lesson-ghost', 'eye')); (i >= 4 ? extra : sources).append(row); } paper.append(sources);
    for (const v of lesson.videos || []) { const row = el('div', 'lesson-source'), open = btn('打开视频', () => rpc('materials.reveal', {videoId: v.id}), 'lesson-ghost', 'play'); open.disabled = !v.available; if (!v.available) open.title = '插上U盘才能打开视频'; row.append(el('span', '', `${v.title} · ${Math.round((v.durationSec || 0) / 60)} 分钟 · ${v.transcript ? '有转写稿' : '暂无转写稿'}`), open); paper.append(row); }
    const actions = el('footer', 'lesson-actions'); actions.append(el('small', 'lesson-meta', `预计 ${outline.estMinutes || 15} 分钟 · 备课 ${model(lesson.model)} · ${usage(lesson.usage)} tokens`), btn('换一个考点', () => desk.go('today')));
    actions.append(btn('开始上课', async b => {
      b.disabled = true;
      try {
        const begun = local.begun ||= {result: await rpc('lesson.begin', {lessonId: lesson.lessonId}, local, key), sent: false};
        if (!valid(key, host)) return;
        local.current = {...lesson, status: 'active', startedAt: Date.now(), segment: 1};
        if (local.mock.has('lesson') || begun.sent) window.__pinkieDeskChat?.open?.();
        else { await desk.askBiqi(begun.result.message); begun.sent = true; }
      } finally { b.disabled = false; }
    }, 'lesson-pink'));
    paper.append(actions); demo(paper, local); const stuckList = [lesson.record?.lastStuck].flat().map(item => typeof item === 'string' ? item : item?.what || item?.title || '').filter(Boolean), stuck = stuckList.join('、'); renderSide(host, 'question', (outline.opening || '先生，我们先把这个考点学清楚。') + (stuck ? `\n上次我们卡在${stuck}，这次换个讲法。` : ''));
    desk.motion.splitIn(paper.querySelector('h1'));
  }
  async function openPage(source, sources = [source]) {
    const release = desk.claimHeavy?.('pdf', desk.pane()); if (release === false) return;
    const node = dialog('原页', 'lesson-viewer'), body = el('div', 'page-body'), footer = el('footer', 'lesson-actions'), key = desk.sessionKey(), local = data();
    let page = {...source}, revision = 0, zoom = 1;
    node.addEventListener('close', () => release?.(), {once: true});
    const citation = el('p', 'lesson-meta'); node.insertBefore(citation, node.children[1] || null); node.append(body, footer);
    const tools = el('div', 'page-tools');
    const scale = delta => { zoom = Math.max(1, Math.min(2, zoom + delta)); const image = body.querySelector('img'); if (image) image.style.width = zoom * 100 + '%'; };
    const reveal = btn('在访达中显示', () => rpc('materials.reveal', {ref: page.ref}, local, key), 'lesson-ghost', 'folder-open');
    tools.append(btn('缩小', () => scale(-.5), 'lesson-icon', 'zoom-out'), btn('放大', () => scale(.5), 'lesson-icon', 'zoom-in'), reveal); node.insertBefore(tools, body);
    function adjacent(delta) { const neighbor = delta < 0 ? page.prevRef : page.nextRef; if (neighbor) { page = {ref: neighbor, title: page.title, readBy: page.readBy, original: page.original}; void load(); return; } const match = /^(m:[^:]+:)(\d+)$/.exec(page.ref); if (match) { const n = Number(match[2]) + delta; if (n < 1) return; page = {...page, ref: match[1] + n, label: '第 ' + n + ' 页', citation: page.title + ' · 第 ' + n + ' 页'}; } else { const index = sources.findIndex(p => p.ref === page.ref); if (!sources[index + delta]) return; page = {...sources[index + delta]}; } void load(); }
    const previous = btn('上一页', () => adjacent(-1), 'lesson-ghost', 'chevron-left'), next = btn('下一页', () => adjacent(1), 'lesson-ghost', 'chevron-right'), number = el('span', 'lesson-meta'); footer.append(previous, number, next);
    async function load() {
      const token = ++revision; zoom = 1; body.replaceChildren(); skeleton(body, 5); citation.textContent = (page.citation || page.title) + ' · ' + readLabel(page); number.textContent = page.label || ''; reveal.disabled = page.original === 'offline'; previous.disabled = /:1$/.test(page.ref); next.disabled = page.totalPages ? Number(page.ref.split(':').at(-1)) >= page.totalPages : false;
      try {
        const result = await rpc('materials.read', {ref: page.ref, span: 1, vision: 'never'}, local, key); if (!valid(key, node) || token !== revision) return;
        const read = result.pages?.[0] || page; page = {...page, ...read};
        const offline = result.original === 'offline' || page.original === 'offline'; reveal.disabled = offline; previous.disabled = page.prevRef === null || /:1$/.test(page.ref); next.disabled = page.nextRef === null || Boolean(page.totalPages && Number(page.ref.split(':').at(-1)) >= page.totalPages);
        citation.textContent = (page.citation || page.title) + ' · ' + readLabel(page);
        number.textContent = page.totalPages ? `${String(page.ref).split(':').at(-1)} / ${page.totalPages}` : page.label || '';
        body.replaceChildren();
        if (offline) body.append(el('p', 'lesson-banner', '插上U盘可以看原页' + (read.readBy === 'ocr' ? ' · 识别文字，公式以原页为准' : read.readBy === 'unread' ? ' · 这页还没认字' : '')));
        const textOnly = /\.(?:pptx?|docx?)(?:\s|$|·)/i.test(page.title || page.citation || '');
        if (!offline && !textOnly) { const image = await rpc('materials.pageImage', {ref: page.ref}, local, key); if (!valid(key, node) || token !== revision) return; const img = el('img', 'page-image'); if (!/^data:image\/(?:png|jpeg|webp|svg\+xml)[;,]/i.test(image.dataUrl || '')) throw Error('原页图片格式不可用'); img.src = image.dataUrl; img.alt = page.citation || page.title; body.append(img); }
        else body.append(el('div', 'page-text', read.text || '这页还没有本机文字，插上U盘后再试。'));
        demo(body, local);
      } catch (error) { if (valid(key, node) && token === revision) { body.replaceChildren(el('p', 'lesson-error', error.message), btn('重试', load)); } }
    }
    node.addEventListener('keydown', e => { if (e.target.closest('input,textarea,select,[contenteditable=true]')) return; if (e.key === 'ArrowLeft') { e.preventDefault(); adjacent(-1); } if (e.key === 'ArrowRight') { e.preventDefault(); adjacent(1); } if (['+', '=', '-'].includes(e.key)) { e.preventDefault(); scale(e.key === '-' ? -.5 : .5); } });
    await load();
  }
  let bar = null, polling = 0, statusPolling = 0, messageObserver = null, resizeObserver = null, padding = null, currentRevision = 0;
  function clearBar() {
    currentRevision++; clearInterval(polling); polling = 0; messageObserver?.disconnect(); messageObserver = null; resizeObserver?.disconnect(); resizeObserver = null;
    bar?.remove(); bar = null;
    releasePadding();
  }
  function releasePadding() { if (padding) { padding.node.removeAttribute('data-pinkie-lesson-space'); if (padding.value) padding.node.style.setProperty('--pinkie-lesson-base-padding', padding.value); else padding.node.style.removeProperty('--pinkie-lesson-base-padding'); padding = null; } }
  function messageColumn() { return window.__pinkieDeskChat?.messageColumn?.() || document.querySelector('openclaw-chat-pane[active] .chat-thread, openclaw-chat-pane .chat-thread, .agent-chat__messages, .chat-thread, .chat-messages'); }
  function positionBar() {
    if (!bar) return;
    const shared = window.__pinkieDeskChat?.lessonHost?.();
    if (shared) { releasePadding(); if (bar.parentElement !== shared) shared.append(bar); bar.style.cssText = ''; bar.classList.add('lesson-bar--shared'); const width = shared.getBoundingClientRect().width; bar.classList.toggle('lesson-bar--narrow', width < 720); bar.classList.toggle('lesson-bar--compact', width < 560); const strip = shared.closest('.pk-tonight'); strip?.classList.add('pk-tonight--lesson'); return; }
    const column = messageColumn(), viewport = column?.getBoundingClientRect(), rect = (column?.querySelector('.chat-thread-inner') || column)?.getBoundingClientRect();
    const side = document.querySelector('aside.sidebar:not(.sidebar--collapsed)')?.getBoundingClientRect();
    const left = rect && rect.width > 300 ? rect.left : Math.max(side?.right || 0, 110), width = rect && rect.width > 300 ? rect.width : innerWidth - left - 24;
    const top = Math.max(viewport?.top || 0, document.querySelector('.dashboard-header')?.getBoundingClientRect().bottom || 64);
    Object.assign(bar.style, {left: left + 'px', width: Math.max(250, width) + 'px', top: top + 'px'});
    bar.classList.toggle('lesson-bar--narrow', width < 720); bar.classList.toggle('lesson-bar--compact', width < 560);
    if (column && padding?.node !== column) { releasePadding(); padding = {node: column, value: column.style.getPropertyValue('--pinkie-lesson-base-padding')}; column.style.setProperty('--pinkie-lesson-base-padding', getComputedStyle(column).paddingTop); column.setAttribute('data-pinkie-lesson-space', ''); resizeObserver?.observe(column); }
  }
  async function refreshCurrent() {
    if (!root()?.isConnected || !window.__pinkieDeskChat?.active?.() || document.hidden || desk.pane() !== globalDesk.pane()) return;
    const key = desk.sessionKey(), local = data(), token = ++currentRevision;
    try { const current = await rpc('lesson.current', {}, local, key); if (!valid(key) || !window.__pinkieDeskChat?.active?.() || token !== currentRevision) return; if (current) { const prepared = local.prepared?.lessonId === current.lessonId ? local.prepared : null; current.sources ||= prepared?.sources || [...new Set((current.outline?.segments || []).flatMap(s => s.sources || []))].map((ref, i) => ({ref, title: '讲义出处 ' + (i + 1), citation: '讲义出处 ' + (i + 1)})); } local.current = current; paintBar(current, local); }
    catch (error) {
      if (!valid(key) || !window.__pinkieDeskChat?.active?.() || token !== currentRevision) return;
      if (!bar) { bar = el('section', 'lesson-bar'); bar.setAttribute('aria-label', '课程条'); bar.append(el('span', 'lesson-meta', '课程状态暂时没读到'), btn('重试', refreshCurrent)); root().append(bar); positionBar(); }
      report(bar, error);
    }
  }
  function paintBar(lesson, local) {
    if (!lesson || !['active', 'paused'].includes(lesson.status)) { bar?.remove(); bar = null; releasePadding(); return; }
    const signature = JSON.stringify([lesson.lessonId, lesson.status, lesson.segment, lesson.checks, lesson.outline?.segments, lesson.sources]);
    if (bar?.dataset.signature === signature) { positionBar(); return; }
    bar?.remove(); bar = el('section', 'lesson-bar'); bar.dataset.signature = signature; bar.dataset.status = lesson.status; bar.setAttribute('aria-label', '课程条');
    const title = el('div', 'lesson-bar-title'); title.append(el('i', 'lesson-state'), el('strong', '', pointTitle(lesson))); bar.append(title);
    const segments = lesson.outline?.segments || [], segment = Number(lesson.segment) || 1;
    const dots = el('div', 'lesson-segments'); for (const [i, seg] of segments.entries()) { const dot = el('i', i + 1 < segment ? 'done' : i + 1 === segment ? 'current' : ''); dot.title = seg.title; dots.append(dot); } dots.append(el('span', 'lesson-segment-count', `${segment} / ${segments.length}`)); bar.append(dots);
    const actions = el('div', 'lesson-bar-actions');
    const event = async (type, b) => { b.disabled = true; const key = desk.sessionKey(); try { const result = await rpc('lesson.event', {lessonId: lesson.lessonId, type, segment}, local, key); if (!valid(key)) return; local.current = result; if (type === 'resume' || type === 'stuck') { const text = type === 'stuck' ? '这段没懂，换个讲法' : `继续上课：${pointTitle(lesson)}，从第 ${segment} 段「${segments[segment - 1]?.title || ''}」接着讲`; if (!local.mock.has('lesson')) await desk.askBiqi(text); } await refreshCurrent(); } finally { b.disabled = false; } };
    if (lesson.status === 'paused') { dots.replaceChildren(el('span', '', '已暂停')); actions.append(btn('继续上课', b => event('resume', b), 'lesson-primary', 'play'), btn('下课', b => confirmFinish(lesson, b), 'lesson-ghost')); }
    else {
      const sourceButton = btn(`出处 ${(lesson.sources || []).length}`, () => {
        const existing = bar.querySelector('.lesson-source-popover'); if (existing) { existing.remove(); return; }
        const pop = el('div', 'lesson-source-popover'); pop.setAttribute('role', 'region'); pop.setAttribute('aria-label', '本节出处');
        for (const p of lesson.sources || []) pop.append(btn(p.citation || p.title, () => openPage(p, lesson.sources), 'lesson-ghost'));
        if (!lesson.sources?.length) pop.append(el('p', 'lesson-meta', '这节课暂无讲义出处。')); pop.append(btn('收起', () => pop.remove(), 'link')); bar.append(pop);
      }, 'lesson-ghost lesson-bar-source', 'file-text'); sourceButton.title = '讲义出处';
      const stuck = btn('没懂，换个讲法', b => event('stuck', b), 'lesson-secondary lesson-bar-stuck', 'rotate-ccw');
      stuck.setAttribute('aria-label','没懂，换个讲法');
      const pause = btn('暂停', b => event('pause', b), 'lesson-ghost lesson-bar-pause', 'pause'); pause.title = '暂停上课'; pause.setAttribute('aria-label','暂停');
      const ready = segment >= segments.length && Number(lesson.checks?.answered ?? lesson.checks?.asked ?? 0) >= segments.length;
      actions.append(sourceButton, stuck, pause, btn('讲完了，去练', b => ready ? finish(lesson, b) : confirmFinish(lesson, b), ready ? 'lesson-pink' : 'lesson-secondary', 'arrow'));
    }
    bar.append(actions); if (local.mock.has('lesson')) { bar.dataset.demo = 'true'; title.append(el('small', 'lesson-meta', '示意数据')); }
    root().append(bar); positionBar();
  }
  function confirmFinish(lesson, anchor) {
    bar?.querySelector('.lesson-finish-confirm')?.remove(); const pop = el('div', 'lesson-finish-confirm'); pop.setAttribute('role', 'region'); pop.setAttribute('aria-label', '确认下课');
    const yes = btn('下课', b => finish(lesson, b), 'lesson-primary'); pop.append(el('p', '', '还没讲完，确定下课吗？'), yes, btn('再听一会', () => { pop.remove(); anchor.focus(); }, 'link')); bar.append(pop); yes.focus();
  }
  function transcript(messages, startedAt) {
    const start = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt) || 0;
    return (messages || []).filter(m => ['user', 'assistant'].includes(m.role)).map(m => {
      const raw = m.timestamp ?? m.at ?? m.createdAt, at = typeof raw === 'number' ? (raw < 1e11 ? raw * 1000 : raw) : Date.parse(raw) || 0;
      const text = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.filter(p => p.type === 'text').map(p => p.text || '').join('\n') : String(m.text || '');
      return {role: m.role, text: text.replace(/```(?:learning_activity|json|tool)[\s\S]*?```/g, '[题卡：课堂练习]'), at};
    }).filter(m => m.at >= start && m.text.trim());
  }
  async function finish(lesson, button) {
    const local = data(), key = desk.sessionKey(); if (local.finishing) return;
    local.finishing = true; if (button) button.disabled = true; local.finishedLesson = lesson; local.result = null; desk.local().stageMode = 'learn'; desk.go('stage');
    try {
      const history = local.mock.has('lesson') ? {messages: []} : await desk.request('chat.history', {sessionKey: key, limit: 200});
      const result = await rpc('lesson.finish', {lessonId: lesson.lessonId, transcript: transcript(history.messages, lesson.startedAt)}, local, key);
      local.result = result; local.current = null;
    } catch (error) { local.finishError = error.message; local.result = {failed: true}; }
    finally { local.finishing = false; if (valid(key) && desk.local().view === 'stage') desk.refresh(); }
  }
  let mathLoading;
  async function math(nodes) {
    if (!window.katex) {
      mathLoading ||= new Promise((resolve, reject) => {
        const cssURL = new URL('laolao-katex/katex.min.css?v=0.18.9', desk.base).href;
        if (![...document.querySelectorAll('link[rel=stylesheet]')].some(n => n.href === cssURL)) { const css = el('link'); css.rel = 'stylesheet'; css.href = cssURL; document.head.append(css); }
        const url = new URL('laolao-katex/katex.min.js?v=0.18.9', desk.base).href;
        let script = [...document.scripts].find(n => n.src === url);
        const ready = () => window.katex ? resolve() : reject(Error('公式组件未就绪'));
        if (!script) { script = el('script'); script.src = url; document.head.append(script); }
        script.addEventListener('load', ready, {once: true}); script.addEventListener('error', () => reject(Error('公式组件加载失败')), {once: true});
      }).catch(error => { mathLoading = null; throw error; });
      await mathLoading;
    }
    for (const n of nodes) if (n.isConnected) window.katex.render(n.dataset.tex, n, {displayMode: true, throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml'});
  }
  function renderSummary(host, paper, local) {
    const result = local.result, lesson = local.finishedLesson || local.prepared || {}, summary = result.summary || {}, checks = summary.checks || lesson.checks || {asked: 0, correct: 0};
    paper.append(el('p', 'lesson-meta', `课后笔记 · ${stamp(Date.now())} · ${lesson.minutes || 0} 分钟`)); const title = el('h1', 'lesson-summary-title'); title.append(el('i', 'dot learned'), document.createTextNode(summary.title || pointTitle(lesson) + ' · 课后笔记')); paper.append(title);
    if (!summary.keyPoints?.length) { const failure = el('section', 'lesson-note-failed'); failure.append(el('p', '', result.failed ? '下课暂时没完成，对话记录仍然保留。' : '这次没生成笔记，对话记录已经保存。'), btn('再试一次', b => finish(lesson, b), 'link')); if (local.finishError) failure.append(el('p', 'lesson-meta', local.finishError)); paper.append(failure); }
    else { const points = el('ol', 'lesson-keypoints'); for (const text of summary.keyPoints) points.append(el('li', '', text)); paper.append(points); }
    const formulas = []; for (const tex of (summary.formulas || []).slice(0, 3)) { const n = el('div', 'lesson-formula', tex); n.dataset.tex = tex; formulas.push(n); paper.append(n); } if (formulas.length) math(formulas).catch(error => { if (paper.isConnected) paper.append(el('p', 'lesson-meta', error.message)); });
    for (const text of summary.pitfalls || []) paper.append(el('p', 'keyp', text));
    for (const stuck of summary.stuck || []) { const n = el('p', 'lesson-stuck' + (stuck.resolved ? '' : ' unresolved')); n.append(desk.icon(stuck.resolved ? 'circle-check' : 'circle-dot', {size: 'xs'}), document.createTextNode(stuck.what + (stuck.resolved ? '' : ' · 下次先讲这里'))); paper.append(n); }
    const checkRow = el('div', 'lesson-checks'); checkRow.append(el('span', 'lesson-meta', `理解检查 ${checks.correct || 0} / ${checks.asked || 0}`));
    for (let i = 0; i < Math.min(50, Number(checks.asked) || 0); i++) { const dot = el('i', i < checks.correct ? 'correct' : ''); dot.setAttribute('aria-hidden', 'true'); checkRow.append(dot); }
    paper.append(checkRow, el('p', 'lesson-meta', `小结 ${model(result.model)} · ${usage(result.usage)} tokens`));
    const actions = el('footer', 'lesson-actions'), next = result.next;
    if (!result.failed) actions.append(btn(next?.kind === 'chat' ? '让碧琪出题' : '去练 4 道', () => { if (next?.kind === 'chat') return desk.askBiqi(`请围绕「${pointTitle(lesson)}」出一道理解练习题，一次只出一题。`); return desk.startSet({chapter: next?.k || local.selection?.k, item: next?.i ?? local.selection?.i, size: 4}); }, 'lesson-primary', 'arrow'));
    const notes = btn('看笔记', () => desk.go('notes', {noteId: result.noteId}), 'lesson-secondary', 'notes'); notes.disabled = !result.noteId;
    actions.append(notes, btn('回今日', () => desk.go('today'), 'link')); paper.append(actions);
    if (lesson.sources?.length) paper.append(btn('查看本节出处', () => openPage(lesson.sources[0], lesson.sources), 'lesson-ghost', 'file-text'));
    demo(paper, local); renderSide(host, result.failed ? 'working' : 'happy', summary.next || (result.failed ? '课程还在，稍后可以再试一次。' : '先生，这节课学过了，接着试一小组。'));
  }
  function sync() {
    clearBar(); if (root()?.dataset.view !== 'today') { clearInterval(statusPolling); statusPolling = 0; } if (!root()?.isConnected || !window.__pinkieDeskChat?.active?.() || document.hidden || desk.pane() !== globalDesk.pane()) return;
    // 新聊天不抢发学习台请求；已有课程立即恢复，其他会话从首个 4 秒轮询或新消息恢复。
    if (data().current || data().prepared || desk.local().today?.focus?.kind === 'lesson') void refreshCurrent(); 
    const column = messageColumn(); if (column) { let queued = false; messageObserver = new MutationObserver(records => { if (queued || !records.some(r => r.type === 'characterData' || [...r.addedNodes].some(n => !bar?.contains(n)))) return; queued = true; setTimeout(() => { queued = false; void refreshCurrent(); }, 250); }); messageObserver.observe(column, {childList: true, characterData: true, subtree: true}); }
    resizeObserver = new ResizeObserver(positionBar); if (column) resizeObserver.observe(column); const sidebar = document.querySelector('aside.sidebar'); if (sidebar) resizeObserver.observe(sidebar);
  }
    const pause = (options={}) => { clearInterval(statusPolling); statusPolling = 0; if(!options.chat||!options.samePane)clearBar(); };
    return {open, openFocus, mountStatus, openMaterials, openPage, transcript, mount, sync, pause,
      unmount() { root()?.querySelector('.lesson-stage')?._lessonCleanup?.(); pause(); },
      resume() { sync(); }, dispose() { data().revision++; pause(); for (const d of root()?.querySelectorAll('.lesson-dialog') || []) { d.close(); d.remove(); } }};
  }
  const instances = new WeakMap();
  const forPane = (pane = globalDesk.pane()) => { if (!instances.has(pane)) instances.set(pane, create(globalDesk.forPane(pane))); return instances.get(pane); };
  const fromHost = host => { const id = host?.closest?.('[data-pane]')?.dataset.pane; return forPane(id ? globalDesk.contexts().find(ctx => ctx.pane.id === id)?.pane : globalDesk.pane()); };
  window.__pinkieStudyDeskLesson = {forPane, open: (...args) => forPane().open(...args), openFocus: (...args) => forPane().openFocus(...args),
    mountStatus: (host, ...args) => fromHost(host).mountStatus(host, ...args), openMaterials: (...args) => forPane().openMaterials(...args), openPage: (...args) => forPane().openPage(...args), transcript: (...args) => forPane().transcript(...args)};
  globalDesk.registerStageMode('learn', {title: '讲', create: ctx => forPane(ctx.pane)});
  const each = run => { if (!document.getElementById('pinkie-study-desk')) return; for (const ctx of globalDesk.contexts()) { const instance = instances.get(ctx.pane); if (instance) run(instance, ctx); } };
  for (const name of ['pinkie:study-desk-view', 'pinkie:study-desk-focus', 'pinkie:study-desk-mounted', 'pinkie:learning-state', 'pinkie:desk-chat-ready', 'pinkie:desk-conversation-ready']) window.addEventListener(name, event => each((instance,ctx) => { if(name==='pinkie:study-desk-focus'&&event.detail?.chat&&ctx.pane===globalDesk.pane())return;instance.sync(); }));
  window.addEventListener('pinkie:study-desk-unmount', () => each(instance => instance.dispose()));
  document.addEventListener('visibilitychange', () => each(instance => document.hidden ? instance.pause() : instance.sync()));
  window.addEventListener('pagehide', () => each(instance => instance.dispose()));
})();
