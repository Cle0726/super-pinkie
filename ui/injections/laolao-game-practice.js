/* 碧琪上岸记 · 刷题（真题题库，REDO-1109 E2）。两页学习台视图：
   - gamepractice：题库首页。上面四个快速入口（随机 10 题 / 错题重刷 / 听力 Part I / 按年份整套），中间按题型，主体是考点表（题数 · 做过 · 正确率，弱项排前）。
   - gamepracset：作答页。跟背一背 / 守关一套版式：顶上状态条（× · 标题 · 进度 · 战斗条），下面题目；篇章题左文右题（窄屏上文下题），文章自己滚动、题目固定可见。
   判分只认官方答案（后端判）；答完显示官方解析，「讲给我听」才调模型。做错的真题变成错题怪。
   视觉：VFX.md（衬线标题、拉丁窄体小字、等宽数字、发丝线、不出 emoji）。 */
(() => {
  'use strict';
  if (window.__pinkieGamePractice) return;
  const G = () => window.__pinkieGame;
  const desk = () => window.__pinkieStudyDesk;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (cls, text) => { const b = el('button', cls, text); b.type = 'button'; return b; };
  // 讲解排版：优先解析 6 板块模板（先看选项识考点 / 回题干秒杀 / 逐词带读 / 一块块大白话 / 四个选项逐词扫 / 送分搭配 / 一句话钉牢），旧缓存则兼容斜线带读。
  const GLOSS = /([A-Za-z][A-Za-z0-9'’.\-]*)\s*([\u4e00-\u9fff][^（(\n/／]{0,24}?)\s*[（(]([^）)\n]{1,40})[）)]/g;
  const WORD_ROW = /^([A-Za-z][A-Za-z0-9'’.\-]*)\s+([\u4e00-\u9fff][^\s]*)\s+(.+)$/;
  const PHRASE_ROW = /^([A-Za-z][A-Za-z0-9'’.\-]*(?:\s+[A-Za-z0-9'’.\-]+)*)\s+([\u4e00-\u9fff][^\s]*)\s+(.+)$/;
  const MEMO_SPLIT = /\s*[|｜]\s*(?:(?:快速)?记忆(?:法)?|速记|巧记|联想|记)\s*[:：]?\s*|\s*[|｜]\s+/;
  const MEMO_LINE = /^(?:↳|->|→)?\s*(?:(?:快速)?记忆(?:法)?|速记|巧记|联想|记)\s*[:：]\s*(.+)$/;
  const splitMemo = text => {
    const m = String(text || '').match(MEMO_SPLIT);
    if (!m) return [String(text || '').trim(), ''];
    return [text.slice(0, m.index).trim(), text.slice(m.index + m[0].length).trim()];
  };
  const appendMemo = (row, memo) => {
    const cleanMemo = String(memo || '').trim();
    if (!cleanMemo || !row) return;
    row.classList.add('has-memo');
    const note = el('span', 'pkp-memo');
    note.append(el('em', 'pkp-memo__tag', '记'), document.createTextNode(cleanMemo));
    row.append(note);
  };
  const SEC_HEAD = /^(先看选项识考点|回题干秒杀|审题与扣分点|审题与格式要件|逐词带读|全文逐词带读|范文逐词带读|一块块大白话|逐句精讲与拆译|逐句拆译|范文逐句拆译|四个选项逐词扫|选项逐词扫|送分搭配|核心高频搭配|写作万能模板与搭配|B级固定搭配扩展|B级搭配扩展|固定搭配扩展|扩展搭配)(?:\s*[（(][^）)\n]{1,30}[）)])?\s*[:：]?$/;
  const SENT_HEAD = /^(第\s*\d+\s*句(?:\s*[:：].*)?|Sentence\s*\d+(?:\s*[:：].*)?)$/i;
  const REF_LINE = /^(完整官方译文|完整官方范文|官方参考译文|官方参考范文)\s*[:：]\s*(.+)$/;
  const PIT_LINE = /^(?:⚠️\s*)?(避坑|注意|易错点?)\s*[:：]\s*(.+)$/;
  const PIN_LINE = /^(?:⚠️\s*)?一句话钉牢\s*[:：]?\s*(.*)$/;
  const cleanHead = line => String(line || '').replace(/^[#*\s]+/, '').replace(/[*]+$/g, '').trim();
  const syllable = raw => String(raw || '').trim().split(/[\s·・]+/).filter(Boolean).join('·');
  const dropCue = text => String(text || '').replace(/(?:^|\n)\s*带读\s*[:：]\s*(?=\n|$)/g, '\n').replace(/带读\s*[:：]\s*$/g, '').trim();
  const stripWholeCue = text => String(text || '').replace(/^(?:整句(?:通译|翻译|译文)?|中文(?:翻译|译文)?|译文|翻译)\s*[:：]\s*/, '').trim();
  const appendLines = (node, text) => {
    const lines = String(text || '').split(/\n/).map(s => s.trim()).filter(Boolean);
    lines.forEach((line, i) => { if (i) node.append(document.createElement('br')); node.append(document.createTextNode(line)); });
    return lines.length;
  };
  const parseStructured = src => {
    const rawLines = src.split(/\n/);
    const intro = [];
    const sections = [];
    const pin = [];
    let cur = null;
    let inPin = false;
    for (const raw of rawLines) {
      const line = raw.trim();
      const head = cleanHead(line);
      const hm = head.match(SEC_HEAD);
      if (hm) {
        inPin = false;
        const title = hm[1];
        const kind = /逐词带读/.test(title) ? 'words' : /选项逐词扫/.test(title) ? 'opts' : /一块块大白话|逐句/.test(title) ? 'chunks' : 'prose';
        cur = {title, kind, lines: []};
        sections.push(cur);
        continue;
      }
      const pm = head.match(PIN_LINE);
      if (pm) {
        inPin = true;
        if (pm[1].trim()) pin.push(pm[1].trim());
        continue;
      }
      if (inPin) {
        if (line) pin.push(line);
      } else if (cur) {
        cur.lines.push(line);
      } else {
        intro.push(line);
      }
    }
    if (!sections.length) return null;
    return {intro: intro.join('\n').trim(), sections, pin: pin.join('\n').trim()};
  };
  const glossRun = src => {
    const cue = src.match(/(?:^|\n)\s*带读\s*[:：]\s*/);
    const offset = cue ? cue.index + cue[0].length : 0;
    const sub = src.slice(offset);
    const hits = [];
    GLOSS.lastIndex = 0;
    let m;
    while ((m = GLOSS.exec(sub))) hits.push({en: m[1].trim(), zh: m[2].trim(), py: syllable(m[3]), index: offset + m.index, end: offset + m.index + m[0].length});
    const groups = [];
    for (const hit of hits) {
      const prev = groups[groups.length - 1];
      const between = prev ? src.slice(prev.end, hit.index) : '';
      if (prev && /[/／]/.test(between) && /^[\s/／,，.。;；]+$/.test(between)) { prev.chunks.push(hit); prev.end = hit.end; }
      else groups.push({start: hit.index, end: hit.end, chunks: [hit]});
    }
    return groups.find(g => g.chunks.length >= 2) || null;
  };
  const wholeLine = text => {
    const cleanText = stripWholeCue(text);
    return ((cleanText.match(/[\u4e00-\u9fff]/g) || []).length >= 5) && ((cleanText.match(/[A-Za-z]/g) || []).length <= 6);
  };
  function lectureNode(text) {
    const src = String(text || '').replace(/\r\n/g, '\n').trim();
    const box = el('div', 'pkp-fb__lecture');
    const structured = parseStructured(src);
    if (structured) {
      if (structured.intro) {
        const introLines = structured.intro.split(/\n/).map(s => s.trim()).filter(Boolean);
        const leadLines = [];
        for (const l of introLines) {
          const rm = l.match(REF_LINE);
          if (rm) {
            if (leadLines.length) { const lead = el('p', 'pkp-lead pkp-say'); appendLines(lead, leadLines.join('\n')); box.append(lead); leadLines.length = 0; }
            const refBox = el('div', 'pkp-refbox');
            refBox.append(el('small', '', rm[1]), el('p', 'pkp-p', rm[2].trim()));
            box.append(refBox);
          } else {
            leadLines.push(l);
          }
        }
        if (leadLines.length) {
          const lead = el('p', 'pkp-lead pkp-say');
          appendLines(lead, leadLines.join('\n'));
          box.append(lead);
        }
      }
      for (const sec of structured.sections) {
        const wrap = el('section', 'pkp-sec');
        wrap.dataset.kind = sec.kind;
        wrap.append(el('h4', 'pkp-sec__title', sec.title));
        const body = sec.lines.join('\n').trim();
        if (!body) continue;
        if (sec.kind === 'words' || sec.kind === 'opts') {
          const list = el('div', 'pkp-wlist');
          const rowRe = sec.kind === 'words' ? WORD_ROW : PHRASE_ROW;
          let lastRow = null;
          for (const line of sec.lines.filter(Boolean)) {
            if (SENT_HEAD.test(cleanHead(line))) {
              list.append(el('h5', 'pkp-sent-head', cleanHead(line)));
              lastRow = null;
              continue;
            }
            const ml = line.match(MEMO_LINE);
            if (ml && lastRow) {
              appendMemo(lastRow, ml[1]);
              continue;
            }
            const hit = line.includes('✅');
            const [core, memo] = splitMemo(line.replace(/✅/g, '').trim());
            const wm = core.match(rowRe);
            if (wm) {
              const row = el('div', 'pkp-wrow');
              if (hit) row.classList.add('is-hit');
              row.append(el('b', 'pkp-en', wm[1].trim()), el('span', 'pkp-py', wm[2].trim()), el('span', 'pkp-zh', wm[3].trim() + (hit ? ' ✅' : '')));
              appendMemo(row, memo);
              list.append(row);
              lastRow = row;
            } else {
              list.append(el('p', 'pkp-p', line));
              lastRow = null;
            }
          }
          wrap.append(list);
        } else if (sec.kind === 'chunks') {
          let blist = null;
          const ensureBlist = () => { if (!blist) { blist = el('div', 'pkp-blist'); wrap.append(blist); } return blist; };
          for (const line of sec.lines.filter(Boolean)) {
            if (SENT_HEAD.test(cleanHead(line))) {
              blist = null;
              wrap.append(el('h5', 'pkp-sent-head', cleanHead(line)));
              continue;
            }
            if (/^(?:整句(?:通译|翻译|译文)?|中文(?:翻译|译文)?)\s*[:：]/.test(line)) {
              blist = null;
              const whole = el('p', 'pkp-whole');
              whole.append(el('small', '', '整句'), document.createTextNode(stripWholeCue(line)));
              wrap.append(whole);
              continue;
            }
            const pit = line.match(PIT_LINE);
            if (pit) {
              blist = null;
              const note = el('p', 'pkp-pit');
              note.append(el('small', '', pit[1]), document.createTextNode(pit[2].trim()));
              wrap.append(note);
              continue;
            }
            const bm = line.match(/^(.+?)\s*(?:→|->)\s*(.+)$/);
            if (bm) {
              const row = el('div', 'pkp-bline');
              row.append(el('b', 'pkp-en', bm[1].trim()), el('span', 'pkp-arr', '→'), el('span', 'pkp-zh', bm[2].trim()));
              ensureBlist().append(row);
            } else {
              ensureBlist().append(el('p', 'pkp-p', line));
            }
          }
        } else {
          for (const para of body.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)) {
            const p = el('p', 'pkp-p');
            appendLines(p, para);
            wrap.append(p);
          }
        }
        box.append(wrap);
      }
      if (structured.pin) {
        const pin = el('div', 'pkp-pin');
        pin.append(el('small', '', '一句话钉牢'));
        const p = el('p', 'pkp-p');
        appendLines(p, structured.pin);
        pin.append(p);
        box.append(pin);
      }
      return box;
    }
    const addProse = chunk => {
      for (const block of dropCue(chunk).split(/\n{2,}/).map(s => s.trim()).filter(Boolean)) {
        const p = el('p', 'pkp-say');
        if (appendLines(p, block)) box.append(p);
      }
    };
    const run = glossRun(src);
    if (!run) {
      const glosses = src.match(/[（(][^）)\n]{1,40}[）)]/g) || [];
      addProse(glosses.length >= 2 && /[/／]/.test(src) ? src.replace(/\s*[/／]\s*/g, '\n') : src);
      if (!box.childNodes.length) box.append(el('p', 'pkp-say', src));
      return box;
    }
    addProse(src.slice(0, run.start));
    const read = el('div', 'pkp-read');
    read.append(el('small', '', '带读'));
    const list = el('div', 'pkp-wlist');
    for (const c of run.chunks) {
      const row = el('div', 'pkp-wrow');
      row.append(el('b', 'pkp-en', c.en), el('span', 'pkp-py', c.py), el('span', 'pkp-zh', c.zh));
      list.append(row);
    }
    read.append(list);
    box.append(read);
    const rest = src.slice(run.end).replace(/^[\s,，.。;；！!？?]+/, '');
    const tails = dropCue(rest).split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    tails.forEach((para, i) => {
      const lines = para.split(/\n/).map(s => s.trim()).filter(Boolean);
      if (i === tails.length - 1 && lines.length === 1 && (/^(?:整句|中文|译文|翻译)/.test(lines[0]) || wholeLine(lines[0]))) {
        const whole = el('p', 'pkp-whole');
        whole.append(el('small', '', '整句'), document.createTextNode(stripWholeCue(lines[0])));
        box.append(whole);
      } else {
        const p = el('p', 'pkp-say');
        appendLines(p, para);
        box.append(p);
      }
    });
    return box;
  }
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
  const pct = v => (v == null ? '—' : `${v}%`);
  const QKIND = {choice: '词汇语法 · 选择', 'word-form': '词汇语法 · 词形', 'passage-choice': '阅读 · 短文选择', 'practical-fill': '阅读 · 填空', 'passage-short': '阅读 · 简答',
    'term-match': '阅读 · 术语配对', 'translate-choice': '翻译 · 选择', 'translate-passage': '翻译 · 段落', writing: '写作',
    'listen-response': '听力 · 问句应答', 'listen-dialogue': '听力 · 短对话', 'listen-conversation': '听力 · 对话理解', 'listen-dictation': '听力 · 短文填空'};
  const TEXT_KINDS = new Set(['word-form', 'practical-fill', 'passage-short', 'listen-dictation']);
  const BIG_KINDS = new Set(['translate-passage', 'writing']);
  const backName = v => desk()?.backName?.(v) || '返回';
  // 做到一半退出、切换其它模块、关掉重开，每个模块 / 题型 / 考点各自独立保留进度和未提交草稿。
  const RESUME_STORE_KEY = 'pinkie-practice-progress-v4';
  const LEGACY_RESUME_KEY = 'pinkie-practice-resume-v3';
  const bucketOf = spec => {
    if (!spec || typeof spec !== 'object') return 'random';
    if (spec.bucket) return String(spec.bucket);
    const m = String(spec.mode || 'random').trim();
    const mod = String(spec.module || '').trim();
    const k = String(spec.kind || '').trim();
    const pt = String(spec.point || '').trim();
    if (m === 'listening' || (m === 'module' && mod === 'listening') || (m === 'kind' && k === 'listening')) return 'module:listening';
    if (m === 'module' && mod) return `module:${mod}`;
    if (m === 'kind' && k) return `kind:${k}`;
    if (m === 'point' && pt) return `point:${pt}`;
    if (m === 'wrong') return 'wrong';
    return 'random';
  };
  const readResumeStore = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(RESUME_STORE_KEY) || 'null');
      if (raw && typeof raw === 'object' && raw.buckets && typeof raw.buckets === 'object') {
        const now = Date.now();
        const clean = {};
        for (const [k, v] of Object.entries(raw.buckets)) {
          if (!v?.set?.setId || !v.set.items?.length || v.set.finished) continue;
          if (now - (v.at || 0) > 30 * 86400000) continue;
          clean[k] = v;
        }
        return {lastBucket: clean[raw.lastBucket] ? raw.lastBucket : Object.keys(clean)[0] || '', buckets: clean};
      }
    } catch { /* ignore */ }
    return {lastBucket: '', buckets: {}};
  };
  const writeResumeStore = data => {
    try {
      const entries = Object.entries(data.buckets || {}).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 30);
      const buckets = Object.fromEntries(entries);
      const lastBucket = buckets[data.lastBucket] ? data.lastBucket : entries[0]?.[0] || '';
      localStorage.setItem(RESUME_STORE_KEY, JSON.stringify({lastBucket, buckets}));
      localStorage.removeItem(LEGACY_RESUME_KEY);
    } catch { /* 空间满了就这次不记 */ }
  };
  const loadResume = (bucket = '') => {
    const store = readResumeStore();
    const key = bucket || store.lastBucket;
    return (key && store.buckets[key]) || null;
  };
  const clearResume = (bucketOrSetId = '') => {
    const store = readResumeStore();
    if (!bucketOrSetId) {
      const pane = desk()?.pane?.();
      const cur = pane?.state?.practiceSet;
      bucketOrSetId = cur ? bucketOf(cur) : store.lastBucket;
    }
    if (bucketOrSetId && store.buckets[bucketOrSetId]) {
      delete store.buckets[bucketOrSetId];
    } else if (bucketOrSetId) {
      for (const [k, v] of Object.entries(store.buckets)) {
        if (v?.set?.setId === bucketOrSetId) delete store.buckets[k];
      }
    }
    writeResumeStore(store);
  };
  const remember = (setOverride = null) => {
    const pane = desk()?.pane?.();
    const set = setOverride || pane?.state?.practiceSet;
    if (!set?.setId || !set.items?.length) return;
    const b = bucketOf(set);
    if (set.finished) { clearResume(b); return; }
    const store = readResumeStore();
    const params = pane?.state?.practiceParams || {mode: set.mode, kind: set.kind, point: set.point, module: set.module, count: set.items.length};
    store.buckets[b] = {set, params, returnView: pane?.state?.returnView || '', at: Date.now()};
    store.lastBucket = b;
    writeResumeStore(store);
  };
  const adoptResume = (bucket = '') => {
    const saved = loadResume(bucket);
    if (!saved) return null;
    const pane = desk()?.pane?.();
    if (pane?.state) {
      pane.state.practiceSet = saved.set;
      if (saved.params) pane.state.practiceParams = saved.params;
      if (saved.returnView) pane.state.returnView = saved.returnView;
    }
    return saved.set;
  };
  // 把本地尚未同步到后端的草稿（如突然强关 App）合并进后端返回的续做组里，确保零丢失。
  const mergeLocalDrafts = set => {
    if (!set?.setId) return set;
    const localSaved = loadResume(bucketOf(set));
    if (!localSaved?.set || localSaved.set.setId !== set.setId) return set;
    const ls = localSaved.set;
    if ((ls.updatedAt || localSaved.at || 0) <= (set.updatedAt || 0)) return set;
    const mergedDrafts = {...(set.drafts || {})};
    for (const [k, v] of Object.entries(ls.drafts || {})) {
      if (!set.answered?.[k] && mergedDrafts[k] == null && v != null && v !== '') mergedDrafts[k] = v;
    }
    const mergedCrossed = {...(ls.crossed || {}), ...(set.crossed || {})};
    return {
      ...set,
      drafts: mergedDrafts,
      crossed: mergedCrossed,
      cursor: Number.isInteger(ls.cursor) ? ls.cursor : set.cursor,
      audioTime: Math.max(Number(set.audioTime) || 0, Number(ls.audioTime) || 0),
    };
  };

  // 开一组（默认自动续接对应模块的未完成进度；传入 fresh: true 时重抽一组）
  async function openSet(params, {from} = {}) {
    const g = G();
    const req = {...params};
    if (!req.setId) req.requestId = rid();
    const raw = await g.call('practice.start', req, 60000);
    if (raw?.empty || !raw?.setId) { g.toast(raw?.why || '这一类题现在没有可做的'); return null; }
    const r = mergeLocalDrafts(raw);
    const pane = desk()?.pane?.();
    const cleanParams = {mode: r.mode, kind: r.kind, point: r.point, module: r.module, count: params?.count || r.items.length, ...(params?.nodeId ? {nodeId: params.nodeId} : {})};
    if (pane?.state) { pane.state.practiceSet = r; pane.state.practiceParams = cleanParams; }
    if (params?.fresh) clearResume(bucketOf(r));
    desk()?.go('gamepracset');
    remember(r);
    return r;
  }

  // ───────────── 题库首页 ─────────────
  async function mountHome(host, ctx) {
    const g = G();
    host.classList.add('pkp-home');
    const head = el('header', 'pkb-page__head');
    const back = btn('pkb-x', '×'); back.setAttribute('aria-label', g?.backLabel?.() || '回营地'); back.title = back.getAttribute('aria-label');
    back.addEventListener('click', () => (g?.goBack ? g.goBack() : desk()?.go('today')));
    const t = el('div'); t.append(el('small', 'pkb-kicker', 'DRILL · 真题题库'), el('h2', '', '刷题'));
    const hudHost = el('div', 'pkb-page__hud');
    head.append(back, t, hudHost); host.append(head);
    try { await g.manifest(); await g.forms(); await g.state(); g.hud(hudHost, {compact: true}); } catch { /* HUD 可选 */ }
    const body = el('div', 'pkp-body'); host.append(body);
    body.append(el('p', 'pkg-empty', '正在翻题库…'));
    let ov;
    try { ov = await g.call('practice.overview', {}, 30000); } catch (e) { body.replaceChildren(el('p', 'pkg-empty', e.message || '题库没打开')); return; }
    if (!host.isConnected) return;
    body.replaceChildren();
    const local = ctx.local?.() || {};
    const busy = b => { b.disabled = true; b.dataset.busy = '1'; };
    const free = b => { b.disabled = false; delete b.dataset.busy; };
    const go = async (b, params) => { busy(b); try { await openSet(params); } catch (e) { g.toast(e.message || '没打开'); } finally { if (b.isConnected) free(b); } };

    if (!ov.total) {
      const empty = el('section', 'pkp-empty');
      empty.append(el('h3', '', '题库还是空的'), el('p', '', '插上放真题的 U 盘、开着 App，碧琪会把每套卷拆好放进考场，题库跟着就有了。'));
      body.append(empty); return;
    }
    const lede = el('p', 'pkp-lede');
    const papers = ov.papers || 0;
    lede.append(el('b', 'pkg-num', String(papers)), document.createTextNode(' 套历年真题和官方模拟卷，'), el('b', 'pkg-num', String(ov.total)), document.createTextNode(' 道题。答案和解析都是官方的。'));
    const locked = (ov.reserved || []).filter(r => r.locked);
    if (locked.length) lede.append(document.createTextNode(` 最新 ${locked.length} 套留给整套模考，不进随机。`));
    body.append(lede);

    const fmtTime = sec => { const s = Math.max(0, Math.floor(Number(sec) || 0)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
    const openBadgeText = op => {
      if (!op) return '';
      if (op.done > 0 && op.draftCount > 0) return `继续 ${op.done}/${op.total} · 草稿 ${op.draftCount}`;
      if (op.done > 0) return `继续 ${op.done}/${op.total}`;
      if (op.draftCount > 0) return `草稿 ${op.draftCount}/${op.total}`;
      if (op.audioTime > 5) return `已听 ${fmtTime(op.audioTime)}`;
      return '继续';
    };
    const openParamsOf = op => {
      if (op.mode === 'module') return {mode: 'module', module: op.module};
      if (op.mode === 'listening') return {mode: 'listening'};
      if (op.mode === 'kind') return {mode: 'kind', kind: op.kind, count: op.total || 10};
      if (op.mode === 'point') return {mode: 'point', point: op.point, count: op.total || 10};
      if (op.mode === 'wrong') return {mode: 'wrong', count: op.total || 10};
      return {mode: 'random', count: op.total || 10};
    };

    // 进行中的练习总览条：跨模块 / 题型 / 考点各自保存，互不覆盖
    const inProgress = Array.isArray(ov.inProgress) ? ov.inProgress : [];
    if (inProgress.length) {
      const strip = el('section', 'pkp-resume');
      const rh = el('header', 'pkg-sec');
      rh.append(el('small', 'pkg-kicker', 'IN PROGRESS'), el('h3', '', '继续上次练习'), el('span', 'pkg-sec__meta', `${inProgress.length} 个模块有未完成进度，互不覆盖`));
      const row = el('div', 'pkp-resume__list');
      for (const op of inProgress) {
        const item = el('div', 'pkp-rcard');
        item.dataset.bucket = op.bucket;
        const mainBtn = btn('pkp-rcard__main');
        mainBtn.append(el('b', '', op.title || '刷题'), el('span', 'pkp-open-pill pkg-num', openBadgeText(op)));
        mainBtn.addEventListener('click', () => go(mainBtn, {setId: op.setId, ...openParamsOf(op)}));
        const acts = el('div', 'pkp-rcard__act');
        const restartBtn = btn('pkb-link pkp-rcard__reset', '重开');
        restartBtn.title = '放弃这组进度，重新抽一组';
        restartBtn.addEventListener('click', () => go(restartBtn, {...openParamsOf(op), fresh: true}));
        const dropBtn = btn('pkp-rcard__drop', '×');
        dropBtn.setAttribute('aria-label', `放弃「${op.title}」的进度`);
        dropBtn.title = '清除这组进度';
        dropBtn.addEventListener('click', async () => {
          dropBtn.disabled = true;
          try {
            await g.call('practice.abandon', {setId: op.setId}, 15000);
            clearResume(op.bucket);
            desk()?.go('gamepractice');
          } catch (e) { dropBtn.disabled = false; g.toast(e.message || '清除失败'); }
        });
        acts.append(restartBtn, dropBtn);
        item.append(mainBtn, acts);
        row.append(item);
      }
      strip.append(rh, row);
      body.append(strip);
    }

    // 快速入口
    const quick = el('nav', 'pkp-quick'); quick.setAttribute('aria-label', '刷题方式');
    const card = (id, en, zh, sub, run, {hot = false, off = false, open = null} = {}) => {
      const b = btn('pkp-qcard'); b.dataset.q = id; if (hot) b.dataset.hot = '1'; if (open) b.dataset.open = '1';
      const topRow = el('span', 'pkp-qcard__top');
      topRow.append(el('small', '', en));
      if (open) topRow.append(el('span', 'pkp-open-pill pkg-num', openBadgeText(open)));
      b.append(topRow, el('b', '', zh), el('em', '', sub), el('i', 'pkp-qcard__rule'));
      if (off) { b.disabled = true; b.dataset.off = '1'; } else b.addEventListener('click', () => run(b));
      quick.append(b); return b;
    };
    const r = ov.random || {};
    card('random', 'RANDOM', '随机 10 题', r.total ? `词汇 · 词形 · 翻译单题 · 已做 ${r.done}/${r.total}` : '单题池是空的', b => go(b, {mode: 'random', count: 10}), {hot: true, off: !r.total, open: r.open});
    card('wrong', 'RETRY', '错题重刷', ov.wrong ? `${ov.wrong} 道做错的真题原题` : '刷题里还没有做错的题', b => go(b, {mode: 'wrong', count: 10}), {off: !ov.wrong && !ov.wrongOpen, open: ov.wrongOpen});
    const lis = (ov.kinds || []).find(k => k.id === 'listening');
    card('listening', 'LISTENING', '听力 Part I', lis?.total ? '随机一套 · 放原录音' : '没有听力题', b => go(b, {mode: 'listening'}), {off: !lis?.total, open: lis?.open});
    card('year', 'BY YEAR', '按年份整套', '进考场，按年份选整卷', () => desk()?.go('gameexam'));
    body.append(quick);

    // 按试卷模块：一套卷的 Part I–V，答完和考点 / 题型一样能看官方解析、讲给我听
    const mods = el('section', 'pkp-modules');
    const mh = el('header', 'pkg-sec'); mh.append(el('small', 'pkg-kicker', 'BY MODULE'), el('h3', '', '按试卷模块'), el('span', 'pkg-sec__meta', '各模块独立保存进度 · 2025–2020 跨年优先混刷'));
    const modRow = el('div', 'pkp-modules__row');
    for (const m of ov.modules || []) {
      const b = btn('pkp-kind pkp-mod'); b.dataset.module = m.id; if (m.open) b.dataset.open = '1';
      const txt = el('span', 'pkp-kind__t');
      txt.append(el('b', '', m.name), el('small', '', m.note || ''));
      if (m.open) txt.append(el('span', 'pkp-open-pill pkg-num', openBadgeText(m.open)));
      b.append(txt, el('span', 'pkp-kind__n pkg-num', m.total ? `${m.done}/${m.total}` : '—'));
      if (!m.total) b.disabled = true; else b.addEventListener('click', () => go(b, {mode: 'module', module: m.id}));
      modRow.append(b);
    }
    mods.append(mh, modRow); body.append(mods);

    // 考点表（主体）
    const pts = el('section', 'pkp-points');
    const ph = el('header', 'pkg-sec'); ph.append(el('small', 'pkg-kicker', 'BY TOPIC'), el('h3', '', '按考点'), el('span', 'pkg-sec__meta', '弱项排前 · 10 题一组'));
    pts.append(ph);
    const seg = el('div', 'pkg-seg'); seg.setAttribute('role', 'tablist');
    const areas = [{id: 'all', name: '全部'}, ...(ov.areas || []).filter(a => a.id !== 'listening')];
    let area = areas.some(a => a.id === local.practiceArea) ? local.practiceArea : 'all';
    const list = el('div', 'pkp-plist');
    const paint = () => {
      list.replaceChildren();
      const rows = (ov.points || []).filter(p => area === 'all' || p.area === area);
      if (!rows.length) list.append(el('p', 'pkg-empty', '这一类还没有标好考点的题。'));
      const head = el('div', 'pkp-prow is-head'); head.append(el('span', '', '考点'), el('span', '', '题数'), el('span', '', '做过'), el('span', '', '正确率'), el('span', '', ''));
      if (rows.length) list.append(head);
      for (const p of rows) {
        const row = btn('pkp-prow'); row.dataset.point = p.id;
        const weak = p.done >= 3 && p.acc != null && p.acc < 60;
        if (weak) row.dataset.weak = '1';
        if (p.open) row.dataset.open = '1';
        const name = el('span', 'pkp-prow__name'); name.append(el('b', '', p.name), el('small', '', p.groupName));
        const bar = el('i', 'pkp-prow__bar'); bar.style.setProperty('--p', `${p.acc ?? 0}%`); if (p.acc == null) bar.dataset.none = '1';
        const accCell = el('span', 'pkp-prow__acc'); accCell.append(el('b', 'pkg-num', pct(p.acc)), bar);
        const goLabel = p.open ? openBadgeText(p.open) : weak ? '先补这个' : '练';
        row.append(name, el('span', 'pkg-num', String(p.total)), el('span', 'pkg-num', String(p.done)), accCell, el('span', 'pkp-prow__go' + (p.open ? ' is-open pkg-num' : ''), goLabel));
        row.setAttribute('aria-label', `${p.groupName} ${p.name}：${p.total} 题，做过 ${p.done}，正确率 ${pct(p.acc)}${p.open ? '，' + goLabel : ''}`);
        row.addEventListener('click', () => go(row, {mode: 'point', point: p.id, count: 10}));
        list.append(row);
      }
    };
    for (const a of areas) {
      const b = btn('', a.name); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(a.id === area));
      b.addEventListener('click', () => { area = a.id; local.practiceArea = a.id; seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', String(x === b))); paint(); });
      seg.append(b);
    }
    const listen = btn('', '听力'); listen.disabled = true; listen.dataset.off = '1'; listen.title = '先按套练 Part I，单题随机准备中'; listen.setAttribute('aria-disabled', 'true');
    seg.append(listen);
    const listenNote = el('p', 'pkp-listenote', '先按套练 Part I，单题随机准备中');
    pts.append(seg, listenNote, list); paint();

    // 按题型（侧栏）
    const kinds = el('section', 'pkp-kinds');
    const kh = el('header', 'pkg-sec'); kh.append(el('small', 'pkg-kicker', 'BY TYPE'), el('h3', '', '按题型'));
    kinds.append(kh);
    for (const k of (ov.kinds || []).filter(x => x.id !== 'listening')) {
      const b = btn('pkp-kind'); b.dataset.kind = k.id; if (k.open) b.dataset.open = '1';
      const txt = el('span', 'pkp-kind__t');
      txt.append(el('b', '', k.name), el('small', '', k.note || ''));
      if (k.open) txt.append(el('span', 'pkp-open-pill pkg-num', openBadgeText(k.open)));
      b.append(txt, el('span', 'pkp-kind__n pkg-num', k.total ? `${k.done}/${k.total}` : '—'));
      if (!k.total) b.disabled = true; else b.addEventListener('click', () => go(b, {mode: 'kind', kind: k.id, count: 10}));
      kinds.append(b);
    }
    // 留卷
    if ((ov.reserved || []).length) {
      const res = el('div', 'pkp-reserved');
      res.append(el('small', 'pkg-kicker', 'RESERVED'), el('p', '', '最新几套真题留给考场整套模考；考过或手动解锁后进题库。'));
      for (const p of ov.reserved) {
        const row = el('div', 'pkp-res'); row.append(el('span', '', p.title));
        if (p.locked) {
          const u = btn('pkb-link', '解锁'); u.addEventListener('click', async () => { u.disabled = true; try { await g.call('practice.unlock', {paperId: p.paperId}); desk()?.go('gamepractice'); } catch (e) { u.disabled = false; g.toast(e.message || '没解锁'); } });
          row.append(u);
        } else row.append(el('em', '', '已进题库'));
        res.append(row);
      }
      kinds.append(res);
    }
    const tg = ov.tagging || {};
    if (tg.untagged) kinds.append(el('p', 'pkp-tagnote', tg.state === 'tagging' ? `碧琪在给新题标考点（${tg.untagged} 道）…` : `${tg.untagged} 道新题还没标考点，碧琪在线时会补上。`));
    if (ov.unclassified) kinds.append(el('p', 'pkp-tagnote', `${ov.unclassified} 道题考点没标出来，在「未分类」里。`));
    const grid = el('div', 'pkp-grid'); grid.append(pts, kinds); body.append(grid);
    return {unmount() {}};
  }

  // ───────────── 作答页 ─────────────
  function mountSet(host, ctx) {
    const g = G();
    const local = ctx.local?.() || {};
    const data = local.practiceSet?.items?.length ? local.practiceSet : adoptResume();
    if (!data?.items?.length && host.dataset.pkpResume !== '1') {
      host.dataset.pkpResume = '1';
      host.classList.add('pkb-guard', 'pkp-set');
      host.append(el('p', 'pkb-empty', '在找上次做到的地方…'));
      let dead = false;
      let resumedRuntime = null;
      const giveUp = () => { if (dead || !host.isConnected) return; host.replaceChildren(el('div', 'pkb-result')); const p = host.firstChild; p.append(el('h3', '', '这组题不在了'), el('p', 'pkb-result__line', '回题库再开一组。')); const b = btn('pkg-btn', '回题库'); b.addEventListener('click', () => desk()?.go('gamepractice')); p.append(b); };
      if (!g?.call) { giveUp(); return {unmount() { dead = true; }, keydown() {}}; }
      g.call('practice.current', {}, 15000).then(raw => {
        if (dead || !host.isConnected) return;
        if (!raw?.items?.length || raw.finished) { giveUp(); return; }
        const r = mergeLocalDrafts(raw);
        const pane = desk()?.pane?.();
        if (pane?.state) { pane.state.practiceSet = r; pane.state.practiceParams = {mode: r.mode, kind: r.kind, point: r.point, module: r.module, count: r.items.length}; }
        remember(r);
        delete host.dataset.pkpResume;
        host.replaceChildren();
        host.className = host.className.replace(/\bpk[pb]-[\w-]+/g, '').trim();
        resumedRuntime = mountSet(host, ctx);
        if (pane) pane.runtime = resumedRuntime;
      }).catch(() => giveUp());
      return {
        unmount() { dead = true; resumedRuntime?.unmount?.(); },
        pause() { resumedRuntime?.pause?.(); },
        keydown(event) { return resumedRuntime?.keydown?.(event); },
      };
    }
    host.classList.add('pkb-guard', 'pkp-set');
    const top = el('header', 'pk-drill-top pkb-top pkb-guard__top');
    const back = btn('pkb-x', '×');
    const title = el('div', 'pkb-guard__title'); title.append(el('small', 'pkb-kicker', 'DRILL · 真题'), el('b', '', data?.title || '刷题'));
    const prevTop = btn('pkp-prev-btn', '上一题');
    prevTop.title = '返回上一题看解析';
    prevTop.hidden = true;
    const count = el('span', 'pk-drill-count pkb-guard__count pkb-num', '');
    top.append(back, title, prevTop, count); host.append(top);
    const backTo = () => { const v = local.returnView; return v && v !== 'gamepracset' ? v : 'gamepractice'; };
    const leaveNow = () => (ctx.go ? ctx.go(backTo()) : desk()?.go(backTo()));
    back.setAttribute('aria-label', `退出刷题，${backName(backTo())}`); back.title = back.getAttribute('aria-label');
    if (!data?.items?.length) {
      const p = el('div', 'pkb-result'); p.append(el('h3', '', '这组题不在了'), el('p', 'pkb-result__line', '回题库再开一组。'));
      const b = btn('pkg-btn', backName(backTo())); b.addEventListener('click', leaveNow); p.append(b);
      host.append(p); back.addEventListener('click', leaveNow); return {};
    }
    const items = data.items;
    const answered = {...(data.answered || {})};
    const drafts = {};
    if (data.drafts && typeof data.drafts === 'object') {
      for (const [k, v] of Object.entries(data.drafts)) {
        if (!answered[k] && (typeof v === 'number' || (typeof v === 'string' && v.trim()))) drafts[k] = v;
      }
    }
    const termCrossed = new Map();
    if (data.crossed && typeof data.crossed === 'object') {
      for (const [k, arr] of Object.entries(data.crossed)) {
        if (Array.isArray(arr) && arr.length) termCrossed.set(k, new Set(arr));
      }
    }
    let audioTime = Number(data.audioTime) || 0;
    const firstTodo = items.findIndex(it => !answered[it.itemId]);
    let i = Number.isInteger(data.cursor) && data.cursor >= 0 && data.cursor < items.length
      ? data.cursor
      : (firstTodo >= 0 ? firstTodo : items.length);
    let right = Object.values(answered).filter(r => r.correct).length, combo = 0, busy = false, alive = true, finished = Boolean(data.finished), asking = false;
    let lastFinishResult = data.finished || null;
    let picked = null;
    let draftTimer = 0;
    let draftDirty = false;
    const crossedObj = () => {
      const out = {};
      for (const [k, set] of termCrossed) if (set?.size) out[k] = [...set];
      return out;
    };
    const draftCountNow = () => {
      let n = 0;
      for (const [k, v] of Object.entries(drafts)) {
        if (answered[k]) continue;
        if (typeof v === 'number' || (typeof v === 'string' && v.trim())) n++;
      }
      return n;
    };
    const hasAnyProgress = () => Object.keys(answered).length > 0 || draftCountNow() > 0 || audioTime > 5 || Object.keys(crossedObj()).length > 0;
    const syncLocalState = () => {
      data.answered = {...answered};
      data.drafts = {...drafts};
      data.crossed = crossedObj();
      data.cursor = i;
      data.audioTime = audioTime;
      data.updatedAt = Date.now();
      if (!finished) remember(data);
    };
    const flushDraft = () => {
      clearTimeout(draftTimer);
      draftTimer = 0;
      if (audio && Number.isFinite(audio.currentTime) && audio.currentTime > 0) audioTime = Math.round(audio.currentTime * 10) / 10;
      syncLocalState();
      if (finished || !draftDirty || !data.setId || !hasAnyProgress()) return;
      draftDirty = false;
      G()?.call?.('practice.saveDraft', {setId: data.setId, drafts: {...drafts}, crossed: crossedObj(), cursor: i, audioTime, replace: true}, 10000)?.catch?.(() => { draftDirty = true; });
    };
    const scheduleDraftSave = () => {
      draftDirty = true;
      syncLocalState();
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => { if (alive) flushDraft(); }, 500);
    };
    const a = window.__pinkieGameBattle?.arena({form: g.equippedForm(), strip: true});
    if (a) {
      top.append(a.root);
      a.setEnemy({kind: 'target', name: data.mode === 'listening' || data.module === 'listening' ? '纸靶 · 听力' : '纸靶 · 真题', level: 1, note: data.title});
      a.setHp(1 - right / items.length, {instant: true}); a.setCombo(0);
    }
    // 听力：整套原录音一个播放条（记忆播放进度）
    let audio = null;
    if (data.audio?.url) {
      audio = new Audio(data.audio.url);
      audio.preload = 'metadata';
      let restoredAudio = false;
      audio.addEventListener('loadedmetadata', () => {
        if (!restoredAudio && audioTime > 1 && Number.isFinite(audio.duration) && audioTime < audio.duration - 1) {
          restoredAudio = true;
          try { audio.currentTime = audioTime; } catch { /* ignore */ }
        }
      });
      let lastAudioTick = 0;
      audio.addEventListener('timeupdate', () => {
        const now = Date.now();
        if (now - lastAudioTick >= 3000) {
          lastAudioTick = now;
          audioTime = Math.round(audio.currentTime * 10) / 10;
          if (audioTime > 5) scheduleDraftSave();
        }
      });
      audio.addEventListener('pause', () => {
        audioTime = Math.round((audio.currentTime || 0) * 10) / 10;
        if (audioTime > 5) { draftDirty = true; flushDraft(); }
      });
      host.append(recordBar(audio));
    } else if (data.mode === 'listening' || data.module === 'listening') host.append(el('p', 'pkp-warn', '本机没有这套的原录音，只能看题。'));
    const onVisibility = () => { if (document.hidden) flushDraft(); };
    const onPageHide = () => { flushDraft(); };
    document.addEventListener?.('visibilitychange', onVisibility);
    window.addEventListener?.('pagehide', onPageHide);
    const stage = el('div', 'pk-drill-stage pkp-stage'); host.append(stage);
    const live = el('div', 'pk-sr'); live.setAttribute('aria-live', 'polite'); host.append(live);
    let termKeyHandler = null;
    const termGroupAt = idx => {
      const it = items[idx];
      if (!it || it.qkind !== 'term-match') return null;
      const mat = it.material || '';
      let start = idx, end = idx;
      if (mat) {
        while (start > 0 && items[start - 1].qkind === 'term-match' && items[start - 1].material === mat) start--;
        while (end + 1 < items.length && items[end + 1].qkind === 'term-match' && items[end + 1].material === mat) end++;
      }
      return {start, end, items: items.slice(start, end + 1), material: mat};
    };
    const syncNav = () => {
      const grp = i < items.length ? termGroupAt(i) : null;
      const canPrev = items.length > 0 && (i >= items.length ? true : grp ? grp.start > 0 : i > 0);
      prevTop.hidden = !canPrev;
      prevTop.disabled = busy || !canPrev;
    };
    const paintCount = () => {
      const grp = i < items.length ? termGroupAt(i) : null;
      if (grp && grp.end > grp.start) count.textContent = `${grp.start + 1}–${grp.end + 1} / ${items.length}`;
      else count.textContent = `${Math.min(i + 1, items.length)} / ${items.length}`;
      syncNav();
    };
    const goPrev = () => {
      if (busy || !items.length) return;
      let target;
      if (i >= items.length) {
        target = items.length - 1;
      } else {
        const grp = termGroupAt(i);
        target = grp ? grp.start - 1 : i - 1;
      }
      if (target < 0) return;
      const prevGrp = termGroupAt(target);
      i = prevGrp ? prevGrp.start : target;
      show();
    };
    prevTop.addEventListener('click', goPrev);
    const makePrevLink = () => {
      const b = btn('pkb-link pkp-prev-btn pkp-prev-inline', '上一题');
      b.title = '返回上一题看解析';
      b.addEventListener('click', goPrev);
      return b;
    };

    const askLeave = () => {
      const done = Object.keys(answered).length;
      const draftN = draftCountNow();
      if (finished || (!done && !draftN && audioTime <= 5)) { leaveNow(); return; }
      if (asking) return; asking = true;
      draftDirty = true;
      flushDraft();
      const dialog = el('dialog', 'lesson-dialog pk-drill-ask'); dialog.setAttribute('aria-label', '退出刷题');
      const parts = [];
      if (done > 0) parts.push(`已答 ${done} 题`);
      if (draftN > 0) parts.push(`草稿 ${draftN} 项`);
      dialog.append(el('p', '', `这组做到第 ${Math.min(i + 1, items.length)} / ${items.length} 题${parts.length ? `（${parts.join('，')}）` : ''}。进度已按模块自动保存，下次点对应模块会从这里接着做。`));
      const row = el('div', 'pk-done-actions');
      const stay = btn('pk-btn', '接着做'); stay.dataset.kind = 'go'; stay.addEventListener('click', () => dialog.close('stay'));
      const quit = btn('pk-link', `先放着，${backName(backTo())}`); quit.addEventListener('click', () => dialog.close('leave'));
      const reset = btn('pk-link', '放弃并重抽'); reset.addEventListener('click', () => dialog.close('reset'));
      row.append(stay, quit, reset); dialog.append(row); host.append(dialog); dialog.showModal(); stay.focus();
      dialog.addEventListener('close', async () => {
        asking = false;
        const val = dialog.returnValue;
        dialog.remove();
        if (val === 'leave') { draftDirty = true; flushDraft(); leaveNow(); return; }
        if (val === 'reset') {
          try {
            const pane = desk()?.pane?.();
            const params = pane?.state?.practiceParams || {mode: data.mode, kind: data.kind, point: data.point, module: data.module, count: items.length};
            await G().call('practice.abandon', {setId: data.setId}, 15000).catch(() => {});
            clearResume(bucketOf(data));
            const nx = await G().call('practice.start', {...params, fresh: true, requestId: rid()}, 60000);
            if (nx?.setId) {
              if (pane?.state) pane.state.practiceSet = nx;
              remember(nx);
              mountAgain();
            } else {
              leaveNow();
            }
          } catch (e) { G().toast(e.message || '重抽失败'); }
        }
      }, {once: true});
    };
    back.addEventListener('click', askLeave);

    // 文章：同一篇只建一次，换题不跳
    let shownMaterial = null, qCol = null;
    function layout(it) {
      // 术语配对的候选已经是右边的按钮，不再左边重复列一遍
      const key = it.qkind === 'term-match' ? null : it.material && !it.qkind.startsWith('listen') ? it.material : (it.qkind === 'listen-dictation' ? it.material : null);
      if (key === shownMaterial && qCol) return;
      shownMaterial = key; stage.replaceChildren();
      if (key) {
        const wrap = el('div', 'pkp-split');
        const material = el('article', 'pkp-material');
        const label = it.qkind === 'listen-dictation' ? '听写原文' : '原文';
        const title = el('h3', 'pkp-material__title', label);
        const toggle = btn('pkp-material__toggle', `展开${label}`);
        const text = el('div', 'pkp-material__text', data.materials?.[key] || '');
        text.id = `pkp-material-${rid()}`;
        text.tabIndex = 0;
        text.setAttribute('role', 'region');
        text.setAttribute('aria-label', label);
        toggle.setAttribute('aria-controls', text.id);
        toggle.setAttribute('aria-expanded', 'false');
        toggle.addEventListener('click', () => {
          const expanded = toggle.getAttribute('aria-expanded') === 'true';
          toggle.setAttribute('aria-expanded', String(!expanded));
          toggle.textContent = `${expanded ? '展开' : '收起'}${label}`;
        });
        material.append(title, toggle, text);
        qCol = el('section', 'pk-drill-col pkp-qcol'); wrap.append(material, qCol); stage.append(wrap);
      } else { qCol = el('section', 'pk-drill-col pkb-guard__q'); stage.append(qCol); }
    }
    function show() {
      busy = false;
      termKeyHandler = null;
      paintCount();
      if (!finished && hasAnyProgress()) { data.cursor = i; scheduleDraftSave(); }
      const it = items[i];
      if (!it) { finish(); return; }
      const termGrp = termGroupAt(i);
      if (termGrp) { showTermGroup(termGrp); return; }
      layout(it);
      qCol.replaceChildren();
      const prev = answered[it.itemId] || null;
      const q = el('div', 'pk-drill-q');
      const question = el('header', 'pkp-question');
      const meta = [QKIND[it.qkind] || '真题', it.point && it.point !== '未分类' ? `考点 · ${it.point}` : '', it.difficulty ? `难度 ${it.difficulty}` : ''].filter(Boolean).join(' · ');
      const heading = el('p', 'pkp-question__meta');
      heading.append(el('b', 'pkp-question__number', `第 ${i + 1} 题`), el('span', '', meta));
      const prompt = it.qkind === 'listen-response' ? '听问句，选最佳应答' : it.qkind === 'listen-dialogue' ? '听对话，回答问题' : it.qkind === 'listen-conversation' ? '听长对话 / 短文，回答问题' : (it.prompt || '');
      const stem = el('h3', 'pk-drill-stem', prompt);
      if (it.base) stem.append(el('span', 'pkp-base', ` （${it.base}）`));
      question.append(heading, stem);
      const source = [it.paper, it.no ? `原卷第 ${it.no} 题` : ''].filter(Boolean).join(' · ');
      if (source) question.append(el('small', 'pkp-source', source));
      q.append(question);
      picked = null;
      let restorePick = null;
      if (it.options) {
        const list = el('div', 'pk-drill-options pkb-guard__opts');
        const givenIdx = prev && prev.given !== '' && prev.given != null && Number.isInteger(Number(prev.given)) ? Number(prev.given) : -1;
        const savedPick = !prev && Number.isInteger(drafts[it.itemId]) ? drafts[it.itemId] : -1;
        it.options.forEach((o, k) => {
          const b = btn('pk-choice pkb-opt');
          b.append(el('kbd', '', 'ABCD'[k] || String(k + 1)), el('span', '', o));
          if (prev) {
            b.disabled = true;
            if (k === prev.answer) b.classList.add('is-answer');
            if (k === givenIdx) { b.classList.add('is-on'); if (!prev.correct) b.classList.add('is-wrong'); }
          } else {
            b.addEventListener('click', () => choose(k, b, list, it.itemId));
            if (k === savedPick) restorePick = () => choose(k, b, list, it.itemId, {silent: true});
          }
          list.append(b);
        });
        q.append(list);
        if (!prev) q.append(choiceBar(`1–${it.options.length} 或 A–${'ABCD'[it.options.length - 1]} 选择 · Enter 检查`));
      } else if (it.qkind === 'term-match') {
        const letters = letterChoices(data.materials?.[it.material] || '');
        const list = el('div', 'pkp-letters');
        const givenLetter = prev && prev.given != null ? String(prev.given).trim().toUpperCase() : '';
        const savedLetter = !prev && typeof drafts[it.itemId] === 'string' ? drafts[it.itemId].trim().toUpperCase() : '';
        for (const L of letters) {
          const b = btn('pk-choice pkp-letter');
          b.append(el('kbd', '', L.letter), el('span', '', L.text));
          if (prev) {
            b.disabled = true;
            if (L.letter === prev.key) b.classList.add('is-answer');
            if (L.letter === givenLetter) { b.classList.add('is-on'); if (!prev.correct) b.classList.add('is-wrong'); }
          } else {
            b.addEventListener('click', () => choose(L.letter, b, list, it.itemId));
            if (L.letter === savedLetter) restorePick = () => choose(L.letter, b, list, it.itemId, {silent: true});
          }
          list.append(b);
        }
        q.append(list);
        if (!prev) q.append(choiceBar('先点一项，选错了可以改 · Enter 检查'));
      } else if (BIG_KINDS.has(it.qkind)) {
        const ta = el('textarea', 'pkp-essay'); ta.rows = it.qkind === 'writing' ? 12 : 8; ta.placeholder = it.qkind === 'writing' ? '在这里写作文（80–100 词）。写完点「交给碧琪阅卷」。' : '在这里写中文译文。';
        ta.setAttribute('aria-label', '你的作答');
        const legacyKey = `pkp-draft:${data.setId}:${it.itemId}`;
        if (prev) {
          ta.value = prev.given != null ? String(prev.given) : '';
          ta.readOnly = true; ta.disabled = true;
          q.append(ta);
        } else {
          let initial = typeof drafts[it.itemId] === 'string' ? drafts[it.itemId] : '';
          if (!initial) { try { initial = sessionStorage.getItem(legacyKey) || ''; } catch { /* 无 */ } }
          ta.value = initial;
          ta.addEventListener('input', () => {
            if (ta.value.trim()) drafts[it.itemId] = ta.value;
            else delete drafts[it.itemId];
            scheduleDraftSave();
            try { sessionStorage.removeItem(legacyKey); } catch { /* 无 */ }
          });
          const sub = btn('pkg-btn', '交给碧琪阅卷'); sub.addEventListener('click', () => submit(ta.value, sub, {essay: true}));
          const row = el('div', 'pkp-row');
          if (i > 0) row.append(makePrevLink());
          row.append(sub, el('small', '', it.qkind === 'writing' ? '按考场五档细则判分，约半分钟' : '按准确 8 + 通顺 4 判分'));
          q.append(ta, row);
        }
      } else {
        const form = el('form', 'pkp-fill'); const input = el('input', 'pkp-input'); input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = it.qkind === 'word-form' ? '填词的正确形式' : '填答案（1–3 个词）';
        input.setAttribute('aria-label', '你的答案');
        if (prev) {
          input.value = prev.given != null ? String(prev.given) : '';
          input.readOnly = true; input.disabled = true;
          form.append(input);
          q.append(form);
        } else {
          if (typeof drafts[it.itemId] === 'string') input.value = drafts[it.itemId];
          input.addEventListener('input', () => {
            if (input.value.trim()) drafts[it.itemId] = input.value;
            else delete drafts[it.itemId];
            scheduleDraftSave();
          });
          const sub = btn('pkg-btn', '提交'); sub.type = 'submit';
          form.append(input, sub);
          form.addEventListener('submit', e => { e.preventDefault(); if (!input.value.trim()) { input.focus(); return; } submit(input.value, sub); });
          q.append(form, barOf('回车提交 · 不分大小写'));
          setTimeout(() => input.focus(), 40);
        }
      }
      qCol.append(q);
      if (restorePick) restorePick();
      if (prev) feedback(it, prev, {restore: true});
      qCol.scrollTop = 0;
    }
    function barOf(text) {
      const bar = el('footer', 'pk-drill-bar');
      if (i > 0) bar.append(makePrevLink());
      bar.append(el('span', 'pk-drill-keys', text));
      return bar;
    }
    // 和背单词一样：点选项只是选定，还能改；回车或「检查」才交卷。
    function choose(answer, b, list, itemId = '', {silent = false} = {}) {
      if (busy) return;
      picked = {answer, el: b};
      list.querySelectorAll('.pk-choice').forEach(n => { n.classList.toggle('is-on', n === b); n.setAttribute('aria-pressed', String(n === b)); });
      const check = qCol.querySelector('.pk-drill-check');
      check?.classList.add('is-ready');
      check?.setAttribute('aria-disabled', 'false');
      if (!silent && itemId) {
        drafts[itemId] = answer;
        scheduleDraftSave();
      }
    }
    function choiceBar(hint) {
      const bar = barOf(hint);
      const check = btn('pk-drill-check');
      check.setAttribute('aria-disabled', 'true');
      check.append(el('span', '', '检查'));
      check.addEventListener('click', () => { if (!picked || busy || check.getAttribute('aria-disabled') === 'true') return; submit(picked.answer, picked.el); });
      bar.append(check);
      return bar;
    }

    async function submit(answer, b, {essay = false} = {}) {
      const it = items[i];
      if (busy || !alive || !it || answered[it.itemId]) return;
      busy = true; syncNav();
      const controls = [...qCol.querySelectorAll('button, input, textarea')]; controls.forEach(x => { x.disabled = true; });
      b?.classList.add('is-lock');
      const wait = essay ? el('p', 'pkp-wait', '碧琪在按考场细则阅卷…') : null; if (wait) qCol.querySelector('.pk-drill-q')?.append(wait);
      let r;
      try { r = await G().call('practice.answer', {setId: data.setId, itemId: it.itemId, answer}, essay ? 90000 : 20000); }
      catch (e) { controls.forEach(x => { x.disabled = false; }); b?.classList.remove('is-lock'); wait?.remove(); busy = false; syncNav(); live.textContent = e.message || '没记上，再交一次'; G().toast(e.message || '没记上，再交一次'); return; }
      if (!alive) return;
      wait?.remove(); b?.classList.remove('is-lock');
      busy = false; syncNav();
      const saved = {...r, given: r.given ?? answer};
      answered[it.itemId] = saved;
      delete drafts[it.itemId];
      syncLocalState();
      if (it.options) { const opts = qCol.querySelectorAll('.pkb-opt'); opts[saved.answer]?.classList.add('is-answer'); if (!saved.correct) b?.classList.add('is-wrong'); }
      if (it.qkind === 'term-match') { qCol.querySelectorAll('.pkp-letter').forEach(x => { if (x.querySelector('kbd')?.textContent === saved.key) x.classList.add('is-answer'); }); if (!saved.correct) b?.classList.add('is-wrong'); }
      if (saved.correct) { right++; a?.strike({crit: saved.combo > 0 && saved.combo % 5 === 0, damage: 96 + (saved.combo || 1) * 6}); } else a?.dodge();
      combo = saved.combo || 0; a?.setCombo(combo); a?.setHp(1 - right / items.length);
      if (saved.correct && combo > 0 && a && combo % a.threshold === 0) a.ult(combo);
      if (saved.awards?.length) G().play(saved.awards, {from: a?.foe || b});
      qCol.querySelector('.pk-drill-bar')?.remove();
      feedback(it, saved);
      live.textContent = saved.correct ? '答对了' : '没答对';
    }
    function feedback(it, r, {restore = false} = {}) {
      const box = el('div', 'pkp-fb'); box.dataset.kind = r.correct ? 'right' : 'wrong';
      const headline = r.grade ? `${r.grade.score} / ${r.grade.max} 分` : r.correct ? '答对了' : '没答对';
      const h = el('div', 'pkp-fb__head'); h.append(el('small', 'pkg-kicker', r.correct ? 'HIT' : 'MISS'), el('b', '', headline));
      box.append(h);
      if (r.grade?.reason) box.append(el('p', 'pkp-fb__line', r.grade.reason));
      if (!r.grade) { const k = el('p', 'pkp-fb__key'); k.append(el('small', '', '官方答案'), el('b', '', r.key || '')); box.append(k); }
      if (r.why) { const w = el('p', 'pkp-fb__why'); w.append(el('small', '', '官方解析'), document.createTextNode(r.why)); box.append(w); }
      if (r.script) { const s = el('p', 'pkp-fb__why'); s.append(el('small', '', '录音原文'), document.createTextNode(r.script)); box.append(s); }
      if (r.grade?.reference) {
        const ref = el('details', 'pkp-fb__ref');
        ref.open = true;
        const refLabel = it.qkind === 'translate-passage' ? '官方参考译文' : it.qkind === 'writing' ? '官方参考范文' : '官方参考答案';
        ref.append(el('summary', '', refLabel), el('p', '', r.grade.reference));
        box.append(ref);
      }
      if (r.monster) box.append(el('p', 'pkp-fb__mon', `这题变成了错题怪「${r.monster.name}」，过几天回来，讨伐时出变体题。`));
      const row = el('div', 'pkp-row');
      const nextLabel = i + 1 < items.length ? '下一题' : finished ? '回结算页' : '结算';
      const next = btn('pk-btn', nextLabel); next.dataset.kind = 'go'; next.addEventListener('click', () => { i++; show(); });
      const explain = btn('pkb-link', '讲给我听');
      explain.title = '完整讲解：考点、秒杀、逐词带读、翻译、选项扫盲、搭配';
      const readMore = btn('pkb-link pkp-read-btn', '带读+搭配');
      readMore.title = '只看逐词带读、整句翻译，再补充 B 级高频固定搭配';
      let explainNotice;
      let currentLecture;
      const modeButtons = [
        {mode: 'full', el: explain, label: '讲给我听', retry: '再讲一次', busy: '碧琪在按标准答案讲…'},
        {mode: 'read', el: readMore, label: '带读+搭配', retry: '重试带读', busy: '碧琪在准备带读和搭配…'},
      ];
      const resetLabels = activeMode => {
        for (const item of modeButtons) {
          item.el.disabled = false;
          item.el.textContent = item.label;
          item.el.setAttribute('aria-pressed', activeMode === item.mode ? 'true' : 'false');
        }
      };
      const renderLecture = (text, mode, {scroll = true} = {}) => {
        currentLecture?.remove();
        const lecture = lectureNode(text);
        lecture.dataset.mode = mode;
        currentLecture = lecture;
        row.after(lecture);
        resetLabels(mode);
        if (scroll) {
          const col = lecture.closest('.pk-drill-col');
          if (col) {
            const top = lecture.getBoundingClientRect().top - col.getBoundingClientRect().top + col.scrollTop;
            col.scrollTo({top: Math.max(0, top - 8), behavior: desk()?.motion?.reduced ? 'auto' : 'smooth'});
          }
        }
      };
      const askMode = async item => {
        explainNotice?.remove(); explainNotice = null;
        for (const other of modeButtons) { other.el.disabled = true; other.el.textContent = other === item ? item.busy : other.label; }
        const failed = message => {
          if (!box.isConnected) return;
          for (const other of modeButtons) { other.el.disabled = false; other.el.textContent = other === item ? item.retry : other.label; }
          explainNotice = el('p', 'pkp-fb__mon', message || '这次没有生成讲解，请检查内置模型后重试。');
          const switchModel = btn('pkb-link', '切换模型'); switchModel.addEventListener('click', () => desk()?.openBuiltinModel?.());
          explainNotice.append(document.createTextNode(' '), switchModel); row.after(explainNotice);
        };
        try {
          const payload = item.mode === 'read' ? {setId: data.setId, itemId: it.itemId, mode: 'read'} : {setId: data.setId, itemId: it.itemId};
          const res = await G().call('practice.explain', payload, 260000);
          if (res?.text && alive) {
            const rec = answered[it.itemId];
            if (rec) {
              rec.lectures = {...(rec.lectures || {}), [item.mode]: res.text};
              rec.lastLectureMode = item.mode;
              data.answered = {...answered};
              remember();
            }
          }
          if (!box.isConnected) return;
          if (res?.text) {
            renderLecture(res.text, item.mode, {scroll: true});
            return;
          }
          failed(res?.error);
        }
        catch (e) { failed(e.message || '讲解暂时没连上，请重试。'); }
      };
      for (const item of modeButtons) {
        item.el.setAttribute('aria-pressed', 'false');
        item.el.addEventListener('click', () => void askMode(item));
      }
      row.append(next);
      if (i > 0) row.append(makePrevLink());
      const nextTodo = items.findIndex(x => !answered[x.itemId]);
      if (nextTodo > i + 1) {
        const jump = btn('pkb-link pkp-jump-btn', `回到第 ${nextTodo + 1} 题`);
        jump.addEventListener('click', () => { i = nextTodo; show(); });
        row.append(jump);
      }
      row.append(explain, readMore); box.append(row);
      qCol.append(box);
      if (restore) {
        const savedLectures = r.lectures || {};
        const mode = r.lastLectureMode && savedLectures[r.lastLectureMode] ? r.lastLectureMode : (savedLectures.full ? 'full' : savedLectures.read ? 'read' : null);
        const text = mode ? savedLectures[mode] : '';
        const staleSubj = BIG_KINDS.has(it.qkind) && /^选了|先看选项识考点|四个选项逐词扫/.test(String(text || ''));
        if (mode && !staleSubj) renderLecture(text, mode, {scroll: false});
      } else {
        next.focus({preventScroll: true});
        box.scrollIntoView({block: 'nearest', behavior: desk()?.motion?.reduced ? 'auto' : 'smooth'});
      }
    }
    // ───────────── 术语配对（Task 4 真题原卷排布：左英文术语表 A–Q，右 53–57 中文配对表）─────────────
    function showTermGroup(grp) {
      shownMaterial = '__term-match__';
      stage.replaceChildren();
      const rawMat = data.materials?.[grp.material] || '';
      const letters = letterChoices(rawMat);
      const examples = parseTermExamples(rawMat);
      const exMap = new Map(examples.map(x => [x.letter, x.text]));
      const letterMap = new Map(letters.map(x => [x.letter, x.text]));
      const validLetters = new Set(letters.map(x => x.letter));
      const grpKey = grp.material || grp.items[0].itemId;
      const legacyTmKey = `pkp-tm-draft:${data.setId}:${grpKey}`;
      const draft = {};
      try {
        const legacySaved = JSON.parse(sessionStorage.getItem(legacyTmKey) || 'null');
        if (legacySaved && typeof legacySaved === 'object') Object.assign(draft, legacySaved);
      } catch { /* 无 */ }
      for (const it of grp.items) {
        const v = drafts[it.itemId];
        if (typeof v === 'string' && validLetters.has(v.trim().toUpperCase())) draft[it.itemId] = v.trim().toUpperCase();
        if (answered[it.itemId] || (draft[it.itemId] && !validLetters.has(draft[it.itemId]))) delete draft[it.itemId];
      }
      const saveDraft = () => {
        for (const it of grp.items) {
          if (!answered[it.itemId] && draft[it.itemId]) drafts[it.itemId] = draft[it.itemId];
          else delete drafts[it.itemId];
        }
        try { sessionStorage.removeItem(legacyTmKey); } catch { /* 无 */ }
        scheduleDraftSave();
      };
      const clearDraft = () => {
        for (const it of grp.items) {
          delete draft[it.itemId];
          delete drafts[it.itemId];
        }
        try { sessionStorage.removeItem(legacyTmKey); } catch { /* 无 */ }
        scheduleDraftSave();
      };
      let crossed = termCrossed.get(grpKey);
      if (!crossed) { crossed = new Set(); termCrossed.set(grpKey, crossed); }

      const allAnswered = () => grp.items.every(it => Boolean(answered[it.itemId]));
      const firstEditable = () => grp.items.findIndex(it => !answered[it.itemId] && !draft[it.itemId]);
      const anyEditable = () => grp.items.findIndex(it => !answered[it.itemId]);
      let activeIdx = firstEditable();
      if (activeIdx < 0) activeIdx = anyEditable();
      let inspectIdx = -1;
      if (allAnswered()) {
        const fw = grp.items.findIndex(it => !answered[it.itemId]?.correct);
        inspectIdx = fw >= 0 ? fw : 0;
      }

      const wrap = el('div', 'pkp-split is-tm');
      // 左栏：英文术语表（A–Q / A–T）
      const bank = el('article', 'pkp-material pkp-tm-bank');
      const bankHead = el('div', 'pkp-tm-bank__head');
      const rangeText = letters.length ? `${letters[0].letter}–${letters[letters.length - 1].letter}` : '';
      const bankTitle = el('h3', 'pkp-tm-bank__title');
      bankTitle.append(document.createTextNode('英文术语表'));
      if (rangeText) bankTitle.append(el('span', 'pkp-tm-bank__range pkg-num', rangeText));
      const bankStat = el('span', 'pkp-tm-bank__stat');
      const bankToggle = btn('pkp-tm-bank__toggle', '收起词表');
      bankToggle.setAttribute('aria-expanded', 'true');
      bankToggle.addEventListener('click', () => {
        const open = bankToggle.getAttribute('aria-expanded') === 'true';
        bankToggle.setAttribute('aria-expanded', String(!open));
        bankToggle.textContent = open ? '展开词表' : '收起词表';
        bank.classList.toggle('is-collapsed', open);
      });
      bankHead.append(bankTitle, bankStat, bankToggle);
      const bankList = el('div', 'pkp-tm-bank__list');
      bankList.setAttribute('role', 'list');
      bank.append(bankHead, bankList);

      // 右栏：试卷原版 53–57 配对表 + 操作栏 + 核对后逐题解析
      qCol = el('section', 'pk-drill-col pkp-qcol is-tm');
      wrap.append(bank, qCol);
      stage.append(wrap);

      const firstIt = grp.items[0];
      const nos = grp.items.map(x => x.no).filter(n => n != null);
      const noRange = nos.length
        ? (nos[0] === nos[nos.length - 1] ? `原卷第 ${nos[0]} 题` : `原卷第 ${nos[0]}–${nos[nos.length - 1]} 题`)
        : '';
      const headCard = el('header', 'pkp-question pkp-tm-head');
      const metaRow = el('p', 'pkp-question__meta');
      const numLabel = grp.end > grp.start ? `第 ${grp.start + 1}–${grp.end + 1} 题` : `第 ${grp.start + 1} 题`;
      const metaBits = [QKIND['term-match'], firstIt.paper, noRange].filter(Boolean).join(' · ');
      metaRow.append(el('b', 'pkp-question__number', numLabel), el('span', '', metaBits));
      const tipLine = el('p', 'pkp-tm-tip');
      headCard.append(metaRow, tipLine);

      const sheet = el('div', 'pkp-tm-sheet');
      const barHost = el('div', 'pkp-tm-bar-host');
      const fbHost = el('div', 'pkp-tm-fb-host');
      qCol.append(headCard, sheet, barHost, fbHost);

      const rows = groupTermRows(grp.items);
      const termBtns = new Map();
      const exNodes = new Map();
      const slotNodes = [];
      let hoverLetter = '';
      let hoverSlotIdx = -1;

      const setHover = (letter, slotIdx) => {
        hoverLetter = letter || '';
        hoverSlotIdx = slotIdx;
        syncHover();
      };
      const syncHover = () => {
        for (const [L, b] of termBtns) {
          let on = hoverLetter === L;
          if (!on && hoverSlotIdx >= 0) {
            const it = grp.items[hoverSlotIdx];
            const r = answered[it.itemId];
            if (r) on = r.key === L || String(r.given || '').trim().toUpperCase() === L;
            else on = draft[it.itemId] === L;
          }
          b.classList.toggle('is-hover-link', on);
        }
        for (const [L, node] of exNodes) {
          node.classList.toggle('is-hover-link', hoverLetter === L);
        }
        slotNodes.forEach((s, idx) => {
          let on = hoverSlotIdx === idx;
          if (!on && hoverLetter) {
            const it = grp.items[idx];
            const r = answered[it.itemId];
            if (r) on = r.key === hoverLetter || String(r.given || '').trim().toUpperCase() === hoverLetter;
            else on = draft[it.itemId] === hoverLetter;
          }
          s.root.classList.toggle('is-hover-link', on);
        });
      };

      const pickNextEmpty = fromIdx => {
        for (let step = 1; step <= grp.items.length; step++) {
          const cand = (fromIdx + step) % grp.items.length;
          const it = grp.items[cand];
          if (!answered[it.itemId] && !draft[it.itemId]) return cand;
        }
        return fromIdx;
      };

      const assignLetter = (letter, {advance = true, toggle = false} = {}) => {
        if (busy || allAnswered()) return;
        if (activeIdx < 0 || answered[grp.items[activeIdx]?.itemId]) {
          activeIdx = anyEditable();
          if (activeIdx < 0) return;
        }
        const it = grp.items[activeIdx];
        if (toggle && draft[it.itemId] === letter) {
          delete draft[it.itemId];
        } else {
          draft[it.itemId] = letter;
          crossed.delete(letter);
          if (advance) activeIdx = pickNextEmpty(activeIdx);
        }
        saveDraft();
        paint();
      };

      const clearSlot = idx => {
        if (busy) return;
        const it = grp.items[idx];
        if (!it || answered[it.itemId]) return;
        if (draft[it.itemId]) {
          delete draft[it.itemId];
          saveDraft();
        }
        activeIdx = idx;
        paint();
      };

      // 建立左侧英文词表行
      for (const L of letters) {
        const b = btn('pkp-tm-term');
        b.dataset.letter = L.letter;
        b.setAttribute('role', 'listitem');
        const k = el('kbd', 'pkp-tm-term__key', L.letter);
        const en = el('span', 'pkp-tm-term__en', L.text);
        en.lang = 'en';
        const tag = el('em', 'pkp-tm-term__tag');
        b.append(k, en, tag);
        b.addEventListener('click', () => {
          if (busy) return;
          if (allAnswered()) {
            const matchIdx = grp.items.findIndex(it => answered[it.itemId]?.key === L.letter);
            const fallbackIdx = matchIdx >= 0 ? matchIdx : grp.items.findIndex(it => String(answered[it.itemId]?.given || '').trim().toUpperCase() === L.letter);
            if (fallbackIdx >= 0) {
              inspectIdx = fallbackIdx;
              paint();
              slotNodes[fallbackIdx]?.root.scrollIntoView({block: 'nearest', behavior: desk()?.motion?.reduced ? 'auto' : 'smooth'});
            }
            return;
          }
          assignLetter(L.letter, {advance: true, toggle: true});
        });
        b.addEventListener('contextmenu', e => {
          if (allAnswered()) return;
          e.preventDefault();
          if (crossed.has(L.letter)) crossed.delete(L.letter);
          else crossed.add(L.letter);
          scheduleDraftSave();
          paint();
        });
        b.addEventListener('mouseenter', () => setHover(L.letter, -1));
        b.addEventListener('mouseleave', () => setHover('', -1));
        bankList.append(b);
        termBtns.set(L.letter, b);
      }

      // 若原卷带有官方 Examples 提示，放在 53 题最上方（与真题试卷完全一致）
      if (examples.length) {
        const exRow = el('div', 'pkp-tm-row pkp-tm-exrow');
        exRow.append(el('span', 'pkp-tm-no pkp-tm-exlabel', '示例'));
        const exWrap = el('div', 'pkp-tm-slots pkp-tm-exslots');
        for (const ex of examples) {
          const chip = btn('pkp-tm-ex');
          chip.dataset.letter = ex.letter;
          chip.title = letterMap.get(ex.letter) ? `原卷示例：${ex.letter} — ${letterMap.get(ex.letter)}（点击对照左侧）` : '原卷示例';
          chip.append(el('span', 'pkp-tm-blank pkg-num', `（ ${ex.letter} ）`), el('span', 'pkp-tm-zh', ex.text));
          chip.addEventListener('mouseenter', () => setHover(ex.letter, -1));
          chip.addEventListener('mouseleave', () => setHover('', -1));
          chip.addEventListener('click', () => {
            setHover(ex.letter, -1);
            termBtns.get(ex.letter)?.scrollIntoView({block: 'nearest', behavior: desk()?.motion?.reduced ? 'auto' : 'smooth'});
          });
          exWrap.append(chip);
          exNodes.set(ex.letter, chip);
        }
        exRow.append(exWrap);
        sheet.append(exRow);
      }

      // 建立右侧 53–57 试卷原版配对行
      for (const row of rows) {
        const rowEl = el('div', 'pkp-tm-row' + (row.slots.length === 1 ? ' is-single' : ''));
        const noText = row.no != null ? String(row.no) : String(grp.start + row.slots[0].idx + 1);
        rowEl.append(el('span', 'pkp-tm-no pkg-num', noText));
        const slotsWrap = el('div', 'pkp-tm-slots');
        for (const s of row.slots) {
          const it = s.it;
          const idx = s.idx;
          const slotEl = el('div', 'pkp-tm-slot');
          slotEl.setAttribute('role', 'button');
          slotEl.tabIndex = 0;
          slotEl.dataset.idx = String(idx);
          slotEl.dataset.item = it.itemId;
          const blankEl = el('span', 'pkp-tm-blank pkg-num');
          const zhEl = el('span', 'pkp-tm-zh', it.prompt || '');
          const dupEl = el('em', 'pkp-tm-dup', '重复');
          dupEl.hidden = true;
          const clearBtn = btn('pkp-tm-clear', '×');
          clearBtn.setAttribute('aria-label', `清除 ${it.prompt || ''}`);
          clearBtn.title = '清除这一空';
          clearBtn.hidden = true;
          clearBtn.addEventListener('click', e => { e.stopPropagation(); clearSlot(idx); });
          slotEl.append(blankEl, zhEl, dupEl, clearBtn);
          const onSelectSlot = () => {
            if (busy) return;
            if (answered[it.itemId]) {
              inspectIdx = idx;
              paint();
              const targetKey = answered[it.itemId].key;
              termBtns.get(targetKey)?.scrollIntoView({block: 'nearest'});
            } else {
              activeIdx = idx;
              paint();
            }
          };
          slotEl.addEventListener('click', onSelectSlot);
          slotEl.addEventListener('keydown', e => {
            if (e.key === ' ' || e.key === 'Enter') {
              if (allAnswered() || answered[it.itemId]) { e.preventDefault(); onSelectSlot(); }
            }
          });
          slotEl.addEventListener('mouseenter', () => setHover('', idx));
          slotEl.addEventListener('mouseleave', () => setHover('', -1));
          slotsWrap.append(slotEl);
          slotNodes[idx] = {root: slotEl, blank: blankEl, zh: zhEl, dup: dupEl, clear: clearBtn};
        }
        rowEl.append(slotsWrap);
        sheet.append(rowEl);
      }

      // 构建选中单题解析卡（支持「讲给我听」/「带读+搭配」与缓存恢复）
      function renderDetail(hostBox, it, idx) {
        hostBox.replaceChildren();
        const r = answered[it.itemId];
        if (!r) return;
        hostBox.dataset.itemId = it.itemId;
        const head = el('div', 'pkp-tm-detail__head');
        const label = `${it.no ? `原卷第 ${it.no} 题` : `第 ${grp.start + idx + 1} 题`} · ${it.prompt || ''}`;
        head.append(
          el('b', 'pkp-tm-detail__title', label),
          el('span', `pkp-tm-pill ${r.correct ? 'is-right' : 'is-wrong'}`, r.correct ? '答对了' : '没答对')
        );
        if (grp.items.length > 1) {
          head.append(el('small', 'pkp-tm-detail__hint', '点上方任意中文词切换'));
        }
        hostBox.append(head);

        const ansKey = String(r.key || '').trim().toUpperCase();
        const ansEn = letterMap.get(ansKey);
        const k = el('p', 'pkp-fb__key');
        k.append(el('small', '', '官方答案'), el('b', '', ansEn ? `${ansKey} — ${ansEn}` : (r.key || '')));
        hostBox.append(k);

        const givenL = r.given != null ? String(r.given).trim().toUpperCase() : '';
        if (!r.correct && givenL) {
          const givenEn = letterMap.get(givenL);
          const gLine = el('p', 'pkp-tm-detail__yours');
          gLine.append(el('small', '', '你的选择'), document.createTextNode(givenEn ? `${givenL} — ${givenEn}` : givenL));
          hostBox.append(gLine);
        }
        if (r.why) {
          const w = el('p', 'pkp-fb__why');
          w.append(el('small', '', '官方解析'), document.createTextNode(r.why));
          hostBox.append(w);
        }
        if (r.monster) {
          hostBox.append(el('p', 'pkp-fb__mon', `这题变成了错题怪「${r.monster.name}」，过几天回来，讨伐时出变体题。`));
        }

        const actRow = el('div', 'pkp-row pkp-tm-detail__act');
        const explain = btn('pkb-link', '讲给我听');
        explain.title = '完整讲解：考点、秒杀、逐词带读、翻译、选项扫盲、搭配';
        const readMore = btn('pkb-link pkp-read-btn', '带读+搭配');
        readMore.title = '只看逐词带读、整句翻译，再补充 B 级高频固定搭配';
        let explainNotice = null;
        let currentLecture = null;
        const modeButtons = [
          {mode: 'full', el: explain, label: '讲给我听', retry: '再讲一次', busy: '碧琪在按标准答案讲…'},
          {mode: 'read', el: readMore, label: '带读+搭配', retry: '重试带读', busy: '碧琪在准备带读和搭配…'},
        ];
        const resetLabels = activeMode => {
          for (const item of modeButtons) {
            item.el.disabled = false;
            item.el.textContent = item.label;
            item.el.setAttribute('aria-pressed', activeMode === item.mode ? 'true' : 'false');
          }
        };
        const showLecture = (text, mode, {scroll = true} = {}) => {
          currentLecture?.remove();
          const lecture = lectureNode(text);
          lecture.dataset.mode = mode;
          currentLecture = lecture;
          actRow.after(lecture);
          resetLabels(mode);
          if (scroll) {
            const top = lecture.getBoundingClientRect().top - qCol.getBoundingClientRect().top + qCol.scrollTop;
            qCol.scrollTo({top: Math.max(0, top - 8), behavior: desk()?.motion?.reduced ? 'auto' : 'smooth'});
          }
        };
        const askMode = async item => {
          explainNotice?.remove(); explainNotice = null;
          for (const other of modeButtons) { other.el.disabled = true; other.el.textContent = other === item ? item.busy : other.label; }
          const failed = message => {
            if (!hostBox.isConnected || hostBox.dataset.itemId !== it.itemId) return;
            for (const other of modeButtons) { other.el.disabled = false; other.el.textContent = other === item ? item.retry : other.label; }
            explainNotice = el('p', 'pkp-fb__mon', message || '这次没有生成讲解，请检查内置模型后重试。');
            const switchModel = btn('pkb-link', '切换模型'); switchModel.addEventListener('click', () => desk()?.openBuiltinModel?.());
            explainNotice.append(document.createTextNode(' '), switchModel);
            actRow.after(explainNotice);
          };
          try {
            const payload = item.mode === 'read' ? {setId: data.setId, itemId: it.itemId, mode: 'read'} : {setId: data.setId, itemId: it.itemId};
            const res = await G().call('practice.explain', payload, 260000);
            if (res?.text && alive) {
              const rec = answered[it.itemId];
              if (rec) {
                rec.lectures = {...(rec.lectures || {}), [item.mode]: res.text};
                rec.lastLectureMode = item.mode;
                data.answered = {...answered};
                remember();
              }
            }
            if (!hostBox.isConnected || hostBox.dataset.itemId !== it.itemId) return;
            if (res?.text) {
              showLecture(res.text, item.mode, {scroll: true});
              return;
            }
            failed(res?.error);
          } catch (e) {
            failed(e.message || '讲解暂时没连上，请重试。');
          }
        };
        for (const item of modeButtons) {
          item.el.setAttribute('aria-pressed', 'false');
          item.el.addEventListener('click', () => void askMode(item));
        }
        actRow.append(explain, readMore);
        hostBox.append(actRow);

        const savedLectures = r.lectures || {};
        const mode = r.lastLectureMode && savedLectures[r.lastLectureMode] ? r.lastLectureMode : (savedLectures.full ? 'full' : savedLectures.read ? 'read' : null);
        if (mode) showLecture(savedLectures[mode], mode, {scroll: false});
      }

      let lastRenderedInspectKey = '';
      let checkBtnRef = null;

      async function submitTermGroup() {
        if (busy || !alive) return;
        const todo = grp.items.filter(it => !answered[it.itemId]);
        if (!todo.length || todo.some(it => !draft[it.itemId])) return;
        busy = true;
        syncNav();
        if (checkBtnRef) {
          checkBtnRef.disabled = true;
          const sp = checkBtnRef.querySelector('span');
          if (sp) sp.textContent = '核对中…';
        }
        const allAwards = [];
        let grpRight = 0;
        let hitUlt = false;
        try {
          for (const it of todo) {
            const ans = draft[it.itemId];
            const r = await G().call('practice.answer', {setId: data.setId, itemId: it.itemId, answer: ans}, 20000);
            if (!alive) return;
            const saved = {...r, given: r.given ?? ans};
            answered[it.itemId] = saved;
            data.answered = {...answered};
            delete draft[it.itemId];
            saveDraft();
            remember();
            if (saved.correct) grpRight++;
            combo = saved.combo || 0;
            if (saved.correct && combo > 0 && a && combo % a.threshold === 0) hitUlt = true;
            if (saved.awards?.length) allAwards.push(...saved.awards);
          }
        } catch (e) {
          busy = false;
          syncNav();
          live.textContent = e.message || '没记上，再交一次';
          G().toast(e.message || '没记上，再交一次');
          paint();
          return;
        }
        if (!alive) return;
        busy = false;
        syncNav();
        right = Object.values(answered).filter(r => r.correct).length;
        if (grpRight > 0) a?.strike({crit: grpRight === todo.length || (combo > 0 && combo % 5 === 0), damage: 96 + grpRight * 18});
        else a?.dodge();
        a?.setCombo(combo);
        a?.setHp(1 - right / items.length);
        if (hitUlt && a) a.ult(combo);
        if (allAwards.length) G().play(allAwards, {from: a?.foe || checkBtnRef});
        clearDraft();
        const fw = grp.items.findIndex(it => answered[it.itemId] && !answered[it.itemId].correct);
        inspectIdx = fw >= 0 ? fw : 0;
        activeIdx = -1;
        lastRenderedInspectKey = '';
        live.textContent = grp.items.length > 1 ? `这一组答对 ${grpRight} / ${todo.length} 题` : (grpRight ? '答对了' : '没答对');
        paint({justGraded: true});
      }

      function paint({justGraded = false} = {}) {
        const doneAll = allAnswered();
        if (doneAll && (inspectIdx < 0 || !grp.items[inspectIdx])) {
          const fw = grp.items.findIndex(it => answered[it.itemId] && !answered[it.itemId].correct);
          inspectIdx = fw >= 0 ? fw : 0;
        }
        tipLine.textContent = doneAll
          ? '核对完成：点任意中文词对照左侧英文，并按需点「讲给我听」或「带读+搭配」。'
          : '真题原卷排布：先扫右侧全部中文词，可先易后难；点括号后再点左侧英文或直接按字母键填入，已配字母自动灰显排除（右键英文可划掉干扰项）。';

        // 统计每个字母被哪些题使用（未核对按当前填入，核对后按官方答案）
        const usage = new Map();
        const currentUsage = new Map();
        grp.items.forEach((it, idx) => {
          const r = answered[it.itemId];
          const curVal = r ? String(r.given || '').trim().toUpperCase() : (draft[it.itemId] || '');
          if (curVal) {
            if (!currentUsage.has(curVal)) currentUsage.set(curVal, []);
            currentUsage.get(curVal).push({it, idx, r});
          }
          if (doneAll && r?.key) {
            const k = String(r.key).trim().toUpperCase();
            if (!usage.has(k)) usage.set(k, []);
            usage.get(k).push({it, idx, r});
          } else if (!doneAll && curVal) {
            if (!usage.has(curVal)) usage.set(curVal, []);
            usage.get(curVal).push({it, idx, r});
          }
        });

        const activeLetter = !doneAll && activeIdx >= 0 ? (draft[grp.items[activeIdx]?.itemId] || '') : '';
        const inspectRec = inspectIdx >= 0 ? answered[grp.items[inspectIdx]?.itemId] : null;
        const inspectKey = inspectRec ? String(inspectRec.key || '').trim().toUpperCase() : '';
        const inspectGiven = inspectRec && !inspectRec.correct ? String(inspectRec.given || '').trim().toUpperCase() : '';

        // 更新左侧英文术语表状态
        let usedLettersCount = 0;
        let exampleOnlyCount = 0;
        for (const L of letters) {
          const b = termBtns.get(L.letter);
          const list = usage.get(L.letter) || [];
          const used = list.length > 0;
          const exText = exMap.get(L.letter) || '';
          const isEx = Boolean(exText);
          if (used) usedLettersCount++;
          else if (isEx) exampleOnlyCount++;
          const tag = b.querySelector('.pkp-tm-term__tag');
          b.classList.toggle('is-used', !doneAll && used);
          b.classList.toggle('is-example', !used && isEx);
          b.classList.toggle('is-dup', !doneAll && (list.length > 1 || (used && isEx)));
          b.classList.toggle('is-crossed', !doneAll && !used && !isEx && crossed.has(L.letter));
          b.classList.toggle('is-linked', (!doneAll && activeLetter === L.letter) || (inspectIdx >= 0 && inspectKey === L.letter));
          b.classList.toggle('is-linked-wrong', inspectIdx >= 0 && Boolean(inspectGiven) && inspectGiven === L.letter);
          b.classList.toggle('is-graded-right', doneAll && used && list.every(x => x.r?.correct));
          b.classList.toggle('is-graded-wrong', doneAll && used && list.some(x => x.r && !x.r.correct));
          if (used) {
            const first = list[0];
            const prefix = first.it.no != null ? `${first.it.no} ` : '';
            tag.textContent = list.length > 1
              ? `${prefix}${first.it.prompt} 等${list.length}处`
              : isEx && !doneAll ? `示例冲突 · ${prefix}${first.it.prompt}` : `${prefix}${first.it.prompt}`;
            tag.hidden = false;
          } else if (isEx) {
            tag.textContent = `例 ${exText}`;
            tag.hidden = false;
          } else if (!doneAll && crossed.has(L.letter)) {
            tag.textContent = '已排除';
            tag.hidden = false;
          } else {
            tag.textContent = '';
            tag.hidden = true;
          }
        }
        const remainTerms = Math.max(0, letters.length - usedLettersCount - exampleOnlyCount);
        bankStat.textContent = doneAll
          ? `共 ${letters.length} 项`
          : examples.length
            ? `已配 ${usedLettersCount} · 示例 ${examples.length} · 剩 ${remainTerms} 项`
            : `已用 ${usedLettersCount} · 剩 ${remainTerms} 项`;

        // 更新右侧 53–57 中文槽位
        let filledCount = 0;
        let hasDup = false;
        let hasExConflict = false;
        grp.items.forEach((it, idx) => {
          const node = slotNodes[idx];
          const r = answered[it.itemId];
          const val = r ? String(r.given || '').trim().toUpperCase() : (draft[it.itemId] || '');
          if (val) filledCount++;
          const dup = !r && Boolean(val) && (currentUsage.get(val)?.length || 0) > 1;
          const exHit = !r && Boolean(val) && exMap.has(val);
          if (dup) hasDup = true;
          if (exHit) hasExConflict = true;
          node.root.classList.toggle('is-active', !doneAll && !r && idx === activeIdx);
          node.root.classList.toggle('is-filled', !r && Boolean(val));
          node.root.classList.toggle('is-dup', dup || exHit);
          node.root.classList.toggle('is-right', Boolean(r?.correct));
          node.root.classList.toggle('is-wrong', Boolean(r && !r.correct));
          node.root.classList.toggle('is-inspect', idx === inspectIdx && Boolean(r));
          node.dup.textContent = exHit ? '示例' : '重复';
          node.dup.hidden = !(dup || exHit);
          node.clear.hidden = Boolean(r) || !val;
          if (r) {
            const ansKey = String(r.key || '').trim().toUpperCase();
            node.blank.textContent = r.correct ? `✓ ${ansKey}` : `✗ ${val || '—'} → ${ansKey}`;
          } else {
            node.blank.textContent = val ? `（ ${val} ）` : '（　）';
          }
        });

        // 底部操作栏（未全部交卷时显示）
        barHost.replaceChildren();
        checkBtnRef = null;
        if (!doneAll) {
          const todoCount = grp.items.filter(it => !answered[it.itemId]).length;
          const todoFilled = grp.items.filter(it => !answered[it.itemId] && draft[it.itemId]).length;
          const rem = todoCount - todoFilled;
          const bar = el('footer', 'pk-drill-bar pkp-tm-bar');
          if (grp.start > 0) bar.append(makePrevLink());
          const status = el('span', 'pkp-tm-status');
          const warnMsg = hasDup ? ' · 有重复字母，请检查' : hasExConflict ? ' · 选到了原卷示例项，请确认' : '';
          status.textContent = `已配 ${filledCount} / ${grp.items.length}` + warnMsg;
          if (hasDup || hasExConflict) status.classList.add('is-warn');
          bar.append(status);
          if (todoFilled > 0) {
            const clearAll = btn('pkb-link pkp-tm-clearall', '清空未交');
            clearAll.addEventListener('click', () => {
              for (const it of grp.items) if (!answered[it.itemId]) delete draft[it.itemId];
              saveDraft();
              activeIdx = anyEditable();
              paint();
            });
            bar.append(clearAll);
          }
          const check = btn('pk-drill-check');
          const ready = rem === 0 && !busy;
          check.classList.toggle('is-ready', ready);
          check.setAttribute('aria-disabled', String(!ready));
          const label = rem > 0 ? `还差 ${rem} 空` : (grp.items.length > 1 ? (todoCount < grp.items.length ? `核对剩余 ${todoCount} 空` : '核对这一组') : '检查');
          check.append(el('span', '', label));
          check.addEventListener('click', () => { if (ready) void submitTermGroup(); });
          checkBtnRef = check;
          bar.append(check);
          barHost.append(bar);
        }

        // 核对后汇总卡 & 选中小题解析区
        const inspectKeySig = `${doneAll ? 'all' : 'part'}:${inspectIdx}:${inspectIdx >= 0 ? grp.items[inspectIdx]?.itemId : ''}`;
        if (doneAll) {
          if (lastRenderedInspectKey !== inspectKeySig || !fbHost.querySelector('.pkp-tm-fb')) {
            lastRenderedInspectKey = inspectKeySig;
            fbHost.replaceChildren();
            const grpRightTotal = grp.items.filter(it => answered[it.itemId]?.correct).length;
            const wrongIdxs = grp.items.map((it, idx) => (!answered[it.itemId]?.correct ? idx : -1)).filter(x => x >= 0);
            const box = el('div', 'pkp-fb pkp-tm-fb');
            box.dataset.kind = grpRightTotal === grp.items.length ? 'right' : 'wrong';

            const h = el('div', 'pkp-fb__head');
            const headline = grp.items.length > 1
              ? `答对 ${grpRightTotal} / ${grp.items.length} 题`
              : (grpRightTotal ? '答对了' : '没答对');
            h.append(el('small', 'pkg-kicker', grpRightTotal === grp.items.length ? 'HIT' : 'MISS'), el('b', '', headline));
            box.append(h);

            const navRow = el('div', 'pkp-row');
            const nextLabel = grp.end + 1 < items.length ? '下一题' : finished ? '回结算页' : '结算';
            const next = btn('pk-btn', nextLabel);
            next.dataset.kind = 'go';
            next.addEventListener('click', () => { i = grp.end + 1; show(); });
            navRow.append(next);
            if (grp.start > 0) navRow.append(makePrevLink());
            const nextTodo = items.findIndex(x => !answered[x.itemId]);
            if (nextTodo > grp.end + 1) {
              const jump = btn('pkb-link pkp-jump-btn', `回到第 ${nextTodo + 1} 题`);
              jump.addEventListener('click', () => { i = nextTodo; show(); });
              navRow.append(jump);
            }
            if (wrongIdxs.length > 1) {
              const nextWrong = btn('pkb-link pkp-tm-nextwrong', `下一错题 (${wrongIdxs.length})`);
              nextWrong.addEventListener('click', () => {
                const pos = wrongIdxs.indexOf(inspectIdx);
                inspectIdx = wrongIdxs[(pos + 1) % wrongIdxs.length];
                paint();
              });
              navRow.append(nextWrong);
            }
            box.append(navRow);

            const detailBox = el('div', 'pkp-tm-detail');
            if (inspectIdx < 0 || !grp.items[inspectIdx]) inspectIdx = wrongIdxs[0] ?? 0;
            renderDetail(detailBox, grp.items[inspectIdx], inspectIdx);
            box.append(detailBox);
            fbHost.append(box);
            if (justGraded) {
              next.focus({preventScroll: true});
              box.scrollIntoView({block: 'nearest', behavior: desk()?.motion?.reduced ? 'auto' : 'smooth'});
            }
          }
        } else if (inspectIdx >= 0 && answered[grp.items[inspectIdx]?.itemId]) {
          if (lastRenderedInspectKey !== inspectKeySig || !fbHost.querySelector('.pkp-tm-detail')) {
            lastRenderedInspectKey = inspectKeySig;
            fbHost.replaceChildren();
            const box = el('div', 'pkp-fb pkp-tm-fb is-partial');
            box.dataset.kind = answered[grp.items[inspectIdx].itemId].correct ? 'right' : 'wrong';
            const detailBox = el('div', 'pkp-tm-detail');
            renderDetail(detailBox, grp.items[inspectIdx], inspectIdx);
            box.append(detailBox);
            fbHost.append(box);
          }
        } else {
          lastRenderedInspectKey = '';
          fbHost.replaceChildren();
        }
        syncHover();
      }

      // 键盘操作：直接敲字母 A–Q/T 填入并自动跳下一空，Backspace 清除，方向键切换，Enter 核对/下一题
      const stepV = rows.some(r => r.slots.length > 1) ? 2 : 1;
      termKeyHandler = event => {
        const k = String(event.key || '');
        const code = String(event.code || '');
        const upper = /^[A-Za-z]$/.test(k) ? k.toUpperCase() : (/^Key[A-Z]$/.test(code) ? code.slice(3) : '');
        if (!allAnswered()) {
          if (/^[A-Z]$/.test(upper) && validLetters.has(upper)) {
            event.preventDefault();
            assignLetter(upper, {advance: true});
            return true;
          }
          if (k === 'Backspace' || k === 'Delete') {
            event.preventDefault();
            if (activeIdx >= 0) {
              const curIt = grp.items[activeIdx];
              if (curIt && !answered[curIt.itemId] && draft[curIt.itemId]) {
                clearSlot(activeIdx);
              } else {
                for (let step = 1; step < grp.items.length; step++) {
                  const prevIdx = (activeIdx - step + grp.items.length) % grp.items.length;
                  if (!answered[grp.items[prevIdx].itemId]) { activeIdx = prevIdx; paint(); break; }
                }
              }
            }
            return true;
          }
          if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(k)) {
            event.preventDefault();
            const delta = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : k === 'ArrowDown' ? stepV : -stepV;
            const n = grp.items.length;
            let nextIdx = ((activeIdx < 0 ? 0 : activeIdx) + delta + n) % n;
            for (let t = 0; t < n; t++) {
              if (!answered[grp.items[nextIdx].itemId]) { activeIdx = nextIdx; paint(); break; }
              nextIdx = (nextIdx + (delta > 0 ? 1 : -1) + n) % n;
            }
            return true;
          }
          if (k === 'Enter') {
            if (event.target?.closest?.('.pkp-prev-btn, .pkp-tm-clear, .pkp-tm-clearall, .pkp-tm-bank__toggle')) return false;
            if (checkBtnRef?.classList.contains('is-ready')) {
              event.preventDefault();
              void submitTermGroup();
              return true;
            }
          }
          return false;
        }
        if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(k)) {
          event.preventDefault();
          const delta = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : k === 'ArrowDown' ? stepV : -stepV;
          inspectIdx = ((inspectIdx < 0 ? 0 : inspectIdx) + delta + grp.items.length) % grp.items.length;
          paint();
          return true;
        }
        if (k === 'Enter') {
          if (event.target?.closest?.('.pkp-prev-btn, .pkb-link, .pkp-tm-slot, .pkp-tm-term, .pkp-tm-bank__toggle')) return false;
          const next = fbHost.querySelector('.pk-btn');
          if (next) { event.preventDefault(); next.click(); return true; }
        }
        return false;
      };

      paint();
      qCol.scrollTop = 0;
    }

    async function finish() {
      if (!alive) return;
      termKeyHandler = null;
      const alreadyDone = finished && Boolean(lastFinishResult);
      finished = true;
      i = items.length;
      paintCount();
      try { audio?.pause(); } catch { /* 无 */ }
      stage.replaceChildren(); const col = el('section', 'pk-drill-col pkb-guard__q'); stage.append(col); qCol = col; shownMaterial = undefined;
      let r = lastFinishResult;
      if (!r) {
        col.append(el('p', 'pkb-empty', '结算中…'));
        try { r = await G().call('practice.finish', {setId: data.setId}); } catch (e) { col.replaceChildren(el('p', 'pkb-empty', e.message || '结算失败，再点一次')); return; }
        if (!alive) return;
        lastFinishResult = r;
        data.finished = r;
        for (const k of Object.keys(drafts)) delete drafts[k];
        clearResume(bucketOf(data));
      }
      const perfect = r.scored > 0 && r.correct === r.scored;
      if (!alreadyDone && r.correct >= (r.total || items.length)) a?.defeat();
      const card = el('div', 'pkb-result'); card.dataset.passed = String(r.scored ? r.correct / r.scored >= .6 : false);
      card.append(el('small', 'pkb-kicker', perfect ? 'PERFECT' : 'RESULT'), el('h3', '', perfect ? '一题不错' : '这组做完了'), el('p', 'pkb-result__score', ''));
      card.querySelector('.pkb-result__score').append(el('b', 'pkb-num', String(r.correct)), document.createTextNode(` / ${r.scored} 题对`));
      card.append(el('p', 'pkb-result__line', r.scored > r.correct ? '错的题记成了错题怪，也能在「错题重刷」里再做原题。' : r.maxCombo >= 5 ? `最高连击 ${r.maxCombo}。` : '题库里还有很多，换个考点试试。'));
      const act = el('div', 'pkb-result__act');
      const home = backTo();
      const again = btn('pkg-btn', '再来一组'); again.addEventListener('click', async () => { again.disabled = true; try { const pane = desk()?.pane?.(); const params = pane?.state?.practiceParams || {mode: 'random'}; const nx = await G().call('practice.start', {...params, fresh: true, requestId: rid()}, 60000); if (nx?.empty || !nx?.setId) { G().toast(nx?.why || '这一类题现在没有可做的'); again.disabled = false; return; } pane.state.practiceSet = nx; remember(nx); mountAgain(); } catch (e) { again.disabled = false; G().toast(e.message || '没打开'); } });
      const reviewLast = btn('pkb-link pkp-prev-btn', '回看上一题'); reviewLast.addEventListener('click', goPrev);
      const out = btn('pkb-link', backName(home)); out.addEventListener('click', leaveNow);
      act.append(again, reviewLast, out);
      if (home !== 'gamepractice') { const lib = btn('pkb-link', '回题库'); lib.addEventListener('click', () => desk()?.go('gamepractice')); act.append(lib); }
      card.append(act); col.replaceChildren(card); again.focus({preventScroll: true});
      if (!alreadyDone) {
        if (r.awards?.length) setTimeout(() => G().play(r.awards, {from: a?.foe || card}), 400); else G().pending?.();
      }
    }
    let childRuntime = null;
    // 「再来一组」：同一页重新挂（返回目标不变）
    function mountAgain() {
      alive = false;
      clearTimeout(draftTimer);
      document.removeEventListener?.('visibilitychange', onVisibility);
      window.removeEventListener?.('pagehide', onPageHide);
      try { audio?.pause(); } catch { /* 无 */ }
      host.replaceChildren();
      host.className = host.className.replace(/\bpk[pb]-[\w-]+/g, '').trim();
      childRuntime = mountSet(host, ctx);
      const pane = desk()?.pane?.();
      if (pane) pane.runtime = childRuntime;
    }

    show();
    return {
      unmount() {
        flushDraft();
        alive = false;
        clearTimeout(draftTimer);
        document.removeEventListener?.('visibilitychange', onVisibility);
        window.removeEventListener?.('pagehide', onPageHide);
        childRuntime?.unmount?.();
        try { audio?.pause(); } catch { /* 无 */ }
      },
      pause() {
        flushDraft();
        try { audio?.pause(); } catch { /* 无 */ }
        childRuntime?.pause?.();
      },
      keydown(event) {
        if (childRuntime) return childRuntime.keydown(event);
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === 'Escape') { event.preventDefault(); askLeave(); return; }
        if (host.querySelector('dialog[open]')) return;
        const tag = event.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (termKeyHandler && termKeyHandler(event)) return;
        const key = String(event.key || '').toLowerCase();
        const code = String(event.code || '');
        const choices = [...(qCol?.querySelectorAll('.pkb-opt:not(:disabled), .pkp-letter:not(:disabled)') || [])];
        if (choices.length && !qCol.querySelector('.pkp-fb')) {
          let idx = /^[1-9]$/.test(key) ? Number(key) - 1 : (/^[a-j]$/.test(key) ? key.charCodeAt(0) - 97 : -1);
          if (idx < 0 && /^(?:Digit|Numpad)[1-9]$/.test(code)) idx = Number(code.slice(-1)) - 1;
          else if (idx < 0 && /^Key[A-J]$/.test(code)) idx = code.charCodeAt(3) - 65;
          if (idx >= 0 && idx < choices.length && idx < 10) { event.preventDefault(); choices[idx].click(); return; }
        }
        if (event.key === 'Enter') {
          if (event.target?.closest?.('.pk-drill-check, .pkp-fb .pk-btn, .pkp-material__toggle, .pkp-prev-btn')) return;
          const next = qCol?.querySelector('.pkp-fb .pk-btn');
          const check = qCol?.querySelector('.pk-drill-check.is-ready');
          if (next || check) { event.preventDefault(); (next || check).click(); }
        }
      },
    };
  }

  // 术语配对的候选：「A — xxx」一行一个；同时解析原卷 Examples 提示行「Examples: (D) 门诊部  (O) 预期寿命」
  function letterChoices(material) {
    const out = [];
    for (const line of String(material).split(/\n+/)) {
      const m = /^\s*([A-Z])\s*[—\-–:：.)）]\s*(.+)$/.exec(line);
      if (m && !out.some(x => x.letter === m[1])) out.push({letter: m[1], text: m[2].trim()});
    }
    return out;
  }
  function parseTermExamples(material) {
    const out = [];
    for (const line of String(material || '').split(/\n+/)) {
      const m = /^\s*Examples?\s*[:：]\s*(.+)$/i.exec(line);
      if (!m) continue;
      const re = /[（(]\s*([A-Z])\s*[）)]\s*([^（()）\n]+)/g;
      let hit;
      while ((hit = re.exec(m[1]))) {
        const letter = hit[1].toUpperCase();
        const text = hit[2].trim();
        if (letter && text && !out.some(x => x.letter === letter)) out.push({letter, text});
      }
    }
    return out;
  }
  // 按真题 Task 4 原卷排布：同题号（如两个 53）并作一行两空，其余一题一行
  function groupTermRows(list) {
    const rows = [];
    for (let idx = 0; idx < list.length; idx++) {
      const it = list[idx];
      const prev = rows[rows.length - 1];
      if (prev && it.no != null && prev.no === it.no && prev.slots.length < 2) {
        prev.slots.push({it, idx});
      } else {
        rows.push({no: it.no, slots: [{it, idx}]});
      }
    }
    return rows;
  }
  function recordBar(audio) {
    const mmss = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
    const bar = el('div', 'pke-record pkp-record');
    const b = btn('pke-play');
    const meta = el('div', 'pke-record__meta'); meta.append(el('small', 'pkg-kicker', 'ORIGINAL AUDIO'), el('b', '', '原录音'));
    const track = el('div', 'pke-record__track'); track.tabIndex = 0; track.setAttribute('role', 'slider'); track.setAttribute('aria-label', '录音进度');
    const fill = el('i', 'pke-record__fill'); track.append(el('i', 'pke-record__rail'), fill);
    const time = el('span', 'pke-record__time pkg-num', '00:00 / --:--');
    const icon = () => { b.innerHTML = audio.paused ? '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 5v14l12-7z" fill="currentColor"/></svg>' : '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>'; b.setAttribute('aria-label', audio.paused ? '播放原录音' : '暂停'); };
    const paint = () => { const d = audio.duration; fill.style.transform = `scaleX(${Number.isFinite(d) && d > 0 ? audio.currentTime / d : 0})`; time.textContent = `${mmss(audio.currentTime * 1000)} / ${Number.isFinite(d) ? mmss(d * 1000) : '--:--'}`; bar.dataset.on = audio.paused ? '' : '1'; icon(); };
    b.addEventListener('click', () => { if (audio.paused) audio.play().catch(() => { time.textContent = '录音放不了，请检查声音输出'; }); else audio.pause(); });
    const seek = x => { const r = track.getBoundingClientRect(); if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(1, (x - r.left) / r.width)) * audio.duration; };
    track.addEventListener('pointerdown', e => { seek(e.clientX); track.setPointerCapture?.(e.pointerId); });
    track.addEventListener('pointermove', e => { if (e.buttons) seek(e.clientX); });
    track.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime + (e.key === 'ArrowRight' ? 5 : -5)); } });
    for (const ev of ['timeupdate', 'play', 'pause', 'loadedmetadata', 'ended']) audio.addEventListener(ev, () => { if (bar.isConnected) paint(); });
    audio.addEventListener('error', () => { if (bar.isConnected) { time.textContent = '录音没加载上（重开这一组会重新取）'; bar.dataset.err = '1'; } });
    icon(); bar.append(b, meta, track, time);
    return bar;
  }

  // 营地 / 地图用：直接开某个考点的一组（讲完课的下一站）
  async function startPoint(point, {nodeId = '', from} = {}) {
    if (from) from.disabled = true;
    try { return await openSet({mode: 'point', point, count: 8, nodeId}); }
    catch (e) { G()?.toast(e.message || '没打开'); return null; }
    finally { if (from) from.disabled = false; }
  }

  function register() {
    const d = desk(); if (!d?.registerView) return false;
    d.registerView('gamepractice', {title: '刷题', wide: true, mount: (h, c) => mountHome(h, c)});
    d.registerView('gamepracset', {title: '刷题', wide: true, mount: (h, c) => mountSet(h, c), keydown: (e, ctx) => ctx.pane?.runtime?.keydown?.(e)});
    return true;
  }
  if (!register()) { const t = setInterval(() => { if (register()) clearInterval(t); }, 150); setTimeout(() => clearInterval(t), 20000); }

  window.__pinkieGamePractice = {openSet, startPoint, bucketOf, letterChoices, parseTermExamples, groupTermRows, lectureNode};
})();
