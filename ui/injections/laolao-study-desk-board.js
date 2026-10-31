/* 碧琪学习台 · 看板。外壳提供 RPC、主题和动效，数字来自程序，结论来自模型。 */
(() => {
  'use strict';
  if (window.__pinkieStudyDeskBoardLoaded) return;
  window.__pinkieStudyDeskBoardLoaded = true;
  const NS = 'http://www.w3.org/2000/svg';
  let registered = false;
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const svg = (tag, attrs = {}, text) => { const node = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v))); if (text != null) node.textContent = text; return node; };
  const num = value => value != null && Number.isFinite(Number(value)) ? Number(value) : 0;
  const dayDiff = (a, b) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000;
  const shortDate = date => date ? date.slice(5).replace('-', ' 月 ') + ' 日' : '尚无法推算';
  const FIELDS = {date: '日期', minutes: '专注分钟', answered: '作答', correct: '答对', reviews: '复习', attempts: '作答', independent: '独立答对', hinted: '看过提示',
    count: '次数', unresolved: '待复测', done: '已复习', backlog: '到期积压', total: '考点', lit: '点亮', mastered: '掌握', weak: '薄弱', daysLeft: '距考试天数', lastActivityAt: '最后记录', daysIdle: '无记录天数'};
  function plainHeadline(root, value) {
    // 只创建文本和 em，不把 RPC 里的任意 HTML 直接插到页面。
    const template = document.createElement('template'); template.innerHTML = String(value || '');
    const append = (parent, source) => [...source.childNodes].forEach(node => {
      if (node.nodeType === 3) parent.append(document.createTextNode(node.textContent));
      else if (node.nodeName === 'EM') { const mark = el('em', 'pk-hl'); append(mark, node); parent.append(mark); }
      else if (!['SCRIPT', 'STYLE'].includes(node.nodeName)) append(parent, node);
    });
    root.replaceChildren(); append(root, template.content);
  }
  function skeleton(root, lines = 3) {
    root.replaceChildren(); const skel = el('div', 'b-skeleton'); skel.setAttribute('aria-label', '正在分析');
    for (let i = 0; i < lines; i++) skel.append(el('i'));
    root.append(skel);
  }
  function spark(values) {
    const data = (values || []).map(num), graph = svg('svg', {viewBox: '0 0 100 26', preserveAspectRatio: 'none', 'aria-hidden': 'true'});
    if (!data.length) return graph;
    const min = Math.min(...data), max = Math.max(...data);
    const points = data.map((v, i) => [data.length === 1 ? 100 : i / (data.length - 1) * 100, 24 - (v - min) / (max - min || 1) * 20]);
    graph.append(svg('path', {d: points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' '), fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke'}),
      svg('circle', {cx: points.at(-1)[0], cy: points.at(-1)[1], r: 2.6, fill: 'var(--pink)'}));
    return graph;
  }
  function mount(root, ctx) {
    let alive = true, revision = 0, range = ctx.pane?.state.boardRange || '7d', insight = null, digest = null;
    const animations = new Set();
    const motion = ctx.motion || {};
    const key = typeof ctx.sessionKey === 'function' ? ctx.sessionKey() : ctx.sessionKey;
    const request = (method, params = {}, timeout = 45000) => ctx.request('pinkie.learning.desk.' + method, {sessionKey: key, ...params}, timeout);
    const animate = tween => { if (tween) animations.add(tween); return tween; };
    const stopMotion = () => { for (const tween of animations) tween.kill?.(); animations.clear(); };
    root.classList.add('pinkie-desk-board'); root.replaceChildren();
    const top = el('div', 'b-top'), title = el('h2', 'b-title', '学习看板'), ranges = el('div', 'b-ranges pk-seg'); ranges.setAttribute('aria-label', '统计范围');
    // 页眉小字：统计的是哪几天（北京日期）；页码是今年第几周。
    const kicker = el('div', 'pk-kicker b-kicker'), heading = el('div', 'b-heading'); heading.append(kicker, title);
    const bj = new Date(Date.now() + 8 * 3_600_000), md = d => `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`;
    const span = days => { const from = new Date(bj - (days - 1) * 86_400_000); return `${md(from)} – ${from.getUTCMonth() === bj.getUTCMonth() ? bj.getUTCDate() + ' 日' : md(bj)}`; };
    const week = (() => { const d = new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate())); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7); })();
    const kickerFor = value => ({'7d': '最近 7 天 · ' + span(7), '30d': '最近 30 天 · ' + span(30), all: '从开始到今天'})[value] || '';
    const model = el('div', 'b-model'), chip = el('span', 'b-model-chip', '正在连接内置模型'), refresh = el('button', 'b-refresh', '重新分析'); refresh.type = 'button'; refresh.prepend(window.__pinkieStudyDesk.icon('refresh-cw', {size: 'xs'}));
    model.append(chip, refresh); top.append(heading, ranges, model);
    const headline = el('div', 'b-headline'); headline.setAttribute('role', 'status'); headline.setAttribute('aria-live', 'polite');
    const metrics = el('div', 'b-metrics'), learning = el('section', 'b-learning'), pace = el('section', 'b-pace'), diag = el('section', 'b-diag');
    pace.append(el('h3', '', '备考节奏 · 专升本'), el('p', 'b-sub', '已点亮的考点和需要的进度，由程序计算'));
    const chart = el('div', 'b-chart'), paceNote = el('p', 'b-pace-note'); pace.append(chart, paceNote);
    diag.append(el('h3', '', '碧琪的诊断'), el('p', 'b-sub', '内置模型读了账本和作答记录，每条都附依据'));
    const lens = el('img', 'pk-sticker b-sticker'); lens.src = window.__pinkieStudyDesk.sticker?.('board-magnifier') || ''; lens.alt = ''; lens.setAttribute('aria-hidden', 'true'); diag.append(lens);
    const findings = el('div', 'b-findings'), adoptRow = el('div', 'b-adopt-row'), adopt = el('button', 'b-adopt', '采纳为明天的计划'), adoptMsg = el('small', '', '会写进学习约定');
    adopt.type = 'button'; adopt.disabled = true; adoptRow.append(adopt, adoptMsg); diag.append(findings, adoptRow);
    root.append(top, headline, metrics, learning, pace, diag, el('div', 'pk-pageno', `第 ${week} 周`));
    const buttons = [['7d', '最近 7 天'], ['30d', '30 天'], ['all', '全部']].map(([value, label]) => {
      const button = el('button', '', label); button.type = 'button'; button.dataset.range = value;
      button.addEventListener('click', () => { if (range === value) return; range = value; if (ctx.pane) ctx.pane.state.boardRange = range; load(); }); ranges.append(button); return button;
    });
    const countUp = (node, value) => {
      node.dataset.count = String(value); node.textContent = String(value);
      if (motion.reduced || !motion.gsap) return;
      const state = {value: 0};
      animate(motion.gsap.to(state, {value, duration: .9, ease: 'power2.out', onUpdate() { if (alive && node.isConnected) node.textContent = String(Math.round(state.value)); }}));
    };
    function renderMetrics(data) {
      const rate = data.answered.independentRate, delta = data.minutes.delta;
      const entries = [['专注', data.minutes.total, '分钟', delta == null ? '暂无上一周期对比' : `比上期${delta >= 0 ? '多' : '少'} ${Math.round(Math.abs(delta) * 100)}%`, data.minutes.series],
        ['作答', data.answered.total, '题', rate == null ? '暂无可判断的作答' : `独立正确 ${Math.round(rate * 100)}%`, data.answered.series],
        ['复习', data.reviews.done, '张', `积压 ${data.reviews.backlog} 张`, data.reviews.series],
        ['连续', data.streak.current, '天', `历史最佳 ${data.streak.best} 天`, data.streak.series || []]];
      metrics.replaceChildren();
      entries.forEach(([label, value, unit, note, series]) => {
        const metric = el('div', 'b-metric'), big = el('div', 'b-metric-number'), counter = el('span', 'b-counter'), small = el('span', 'b-unit', unit);
        big.append(counter, small); metric.append(el('small', '', label), big, el('div', 'b-delta', note), spark(series)); metrics.append(metric); countUp(counter, num(value));
      });
      learning.replaceChildren();
      if (data.learning) {
        const progress = data.learning; learning.append(el('h3', '', '学习进度'));
        for (const [field, label] of [['learned', '已学'], ['practiced', '已练'], ['mastered', '已掌握']]) {
          // 进度只用星星：一排 12 颗，按比例点亮（有一个就至少亮一颗）；已学半颗、已练粉、已掌握金箔。
          const row = el('div', 'b-learning-row'), track = el('div', 'b-learning-track'); row.dataset.state = field;
          const total = Math.max(0, num(progress.total)), value = Math.max(0, num(progress[field])), lit = value ? Math.max(1, Math.round(Math.min(1, total ? value / total : 0) * 12)) : 0;
          const kit = window.__pinkieDeskKit; if (kit) track.append(kit.stars(Array.from({length: 12}, (_, i) => i < lit ? {learned: 'half', practiced: 'full', mastered: 'gold'}[field] : '')));
          track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', label); track.setAttribute('aria-valuenow', Math.min(value, total)); track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', total);
          row.append(el('span', '', label), track, el('b', '', `${value} / ${total}`)); learning.append(row);
        }
        if (num(progress.learnedNotPracticed) > 0) {
          const reminder = el('p', 'b-learning-reminder', `有 ${num(progress.learnedNotPracticed)} 个考点学了还没练`), practice = el('button', 'b-text-button', '去练'); practice.type = 'button'; practice.append(window.__pinkieStudyDesk.icon('chevron-right', {size: 'xs'}));
          practice.onclick = async () => {
            practice.disabled = true;
            try {
              const today = await request('today'); if (!alive) return;
              for (const subject of today.mastery?.subjects || []) for (const chapter of subject.chapters || []) {
                const item = chapter.items.find(item => item.state === 'learned');
                if (item) { await window.__pinkieStudyDesk.startSet({chapter: chapter.k, item: item.i, size: 4}); return; }
              }
              ctx.go('today');
            } catch (error) { if (alive) practice.textContent = '重试去练'; }
            finally { practice.disabled = false; }
          };
          reminder.append(practice); learning.append(reminder);
        }
      }
    }
    function renderPace(data) {
      chart.replaceChildren();
      if (!data) {
        const empty = el('div', 'b-chart-empty'), nap = el('img', 'pk-sticker'), say = el('div'); nap.src = window.__pinkieStudyDesk.sticker?.('asleep') || ''; nap.alt = ''; nap.setAttribute('aria-hidden', 'true');
        say.append(el('p', 'pk-note', '先告诉我两场考试的日期，我才能帮你排节奏哦。'));
        const setup = el('button', 'b-text-button pk-link', '去今日页设置日期'); setup.type = 'button'; setup.onclick = () => ctx.go('today'); say.append(setup); empty.append(nap, say); chart.append(empty);
        paceNote.textContent = '两场考试的准确日期待确认。'; return;
      }
      const graph = svg('svg', {viewBox: '0 0 640 236', role: 'img', 'aria-label': `已点亮 ${data.lit} / ${data.total} 个考点；${data.projectedDate ? '预计 ' + data.projectedDate : '证据不足，暂不推算'}`});
      const history = data.history || [], elapsed = history.at(-1)?.[0] || 0;
      const examDay = dayDiff(data.startDate, data.examDate), projectedDay = data.projectedDate ? dayDiff(data.startDate, data.projectedDate) : 0;
      const span = Math.max(1, examDay, projectedDay, elapsed), X = d => 24 + d / span * 600, Y = v => 194 - num(v) / Math.max(1, data.total) * 180;
      for (const v of [0, Math.round(data.total / 2), data.total]) graph.append(svg('line', {x1: 24, x2: 624, y1: Y(v), y2: Y(v), stroke: 'var(--hair)'}), svg('text', {x: 16, y: Y(v) + 4, fill: 'var(--ink-3)', 'font-size': 10, 'text-anchor': 'end'}, v));
      if (examDay > 0) graph.append(svg('line', {x1: X(0), x2: X(examDay), y1: Y(0), y2: Y(data.total), stroke: 'var(--ink-3)', 'stroke-dasharray': '3 5'}),
        svg('text', {x: X(examDay), y: 5, fill: 'var(--ink)', 'font-size': 11, 'text-anchor': 'end'}, '专升本'));
      for (let i = 0; i <= 4; i++) {
        const d = Math.round(i * span / 4), date = new Date(Date.parse(data.startDate + 'T00:00:00Z') + d * 86400000).toISOString().slice(0, 10);
        graph.append(svg('text', {x: X(d), y: 218, fill: 'var(--ink-3)', 'font-size': 10, 'text-anchor': i === 4 ? 'end' : 'start'}, date.slice(5).replace('-', '/')));
      }
      if (data.projectedDate && data.ratePerDay > 0) graph.append(svg('line', {x1: X(elapsed), x2: X(projectedDay), y1: Y(data.lit), y2: Y(data.total), stroke: 'var(--pink)', 'stroke-width': 2, 'stroke-dasharray': '1 6', 'stroke-linecap': 'round'}));
      const line = svg('path', {d: history.map(([d, v], i) => `${i ? 'L' : 'M'}${X(d)} ${Y(v)}`).join(' '), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'});
      graph.append(line, svg('circle', {cx: X(elapsed), cy: Y(data.lit), r: 5, fill: 'var(--pink)'}),
        svg('text', {x: Math.min(540, X(elapsed) + 12), y: Y(data.lit) - 10, fill: 'var(--ink)', 'font-size': 12}, `今天 · ${data.lit} 个`));
      chart.append(graph); animate(motion.drawIn?.(line));
      paceNote.textContent = data.projectedDate ? `按现在每天 ${num(data.ratePerDay).toFixed(1)} 个的速度，预计 ${shortDate(data.projectedDate)}点亮全部考点，${data.daysEarly >= 0 ? '比考试早' : '比考试晚'} ${Math.abs(data.daysEarly)} 天。` : '还没有独立点亮的考点，先积累证据，再推算完成时间。';
    }
    function evidenceButton(id, rows) {
      const row = rows.find(row => row.id === id), button = el('button', 'b-evidence', id); button.type = 'button';
      const description = row ? `${row.label}：` + Object.entries(row.values).filter(([k]) => FIELDS[k]).map(([k, v]) => `${FIELDS[k]} ${v == null ? '未设置' : v}`).join('；') : '本次摘要中没有这条依据';
      // 不设 title：control-ui 的全局提示会接管 title，和下面的依据浮层叠成两层。
      button.setAttribute('aria-label', `依据 ${id}，${description}`);
      const tooltip = el('span', 'b-evidence-tip', description); tooltip.setAttribute('role', 'tooltip'); button.append(tooltip); return button;
    }
    function renderInsight(result) {
      insight = result; findings.replaceChildren(); adopt.disabled = true; adopt.textContent = '采纳为明天的计划';
      const time = result.generatedAt ? new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit'}).format(result.generatedAt) : '';
      const tokens = result.usage?.total;
      chip.textContent = [result.autoSkipped ? '等待手动分析' : result.model?.name || '模型暂不可用', time, result.ms > 0 ? `用时 ${(result.ms / 1000).toFixed(1)} 秒` : '', tokens == null ? '用量未返回' : Number(tokens).toLocaleString() + ' tokens', result.insightStale ? '数据已更新' : result.status === 'cached' ? '已缓存' : ''].filter(Boolean).join(' · ');
      if (!['ok', 'cached'].includes(result.status)) {
        headline.textContent = result.autoSkipped ? '这个范围还没分析' : '这次没分析成功';
        findings.append(el('p', 'b-failure', result.error || '程序统计仍可查看，稍后再试一次。'));
        const retry = el('button', 'b-text-button', '重试'); retry.type = 'button'; retry.onclick = () => load(true); findings.append(retry); adoptMsg.textContent = '分析成功后再安排明天。'; return;
      }
      plainHeadline(headline, result.headline || '先看看这段时间留下的学习证据。'); animate(motion.splitIn?.(headline));
      const rows = result.digest?.rows || digest?.rows || [];
      (result.findings || []).forEach((finding, index) => {
        const item = el('div', 'b-finding'), body = el('div'), refs = el('div', 'b-references'); refs.append(el('span', '', '依据 '));
        (finding.evidence || []).forEach(id => refs.append(evidenceButton(id, rows)));
        body.append(el('p', '', finding.text), refs); item.append(el('span', 'b-no', index + 1), body); findings.append(item);
      });
      if (result.plan) {
        const plan = el('div', 'b-finding b-plan'); const mark = el('span', 'b-no'); mark.append(window.__pinkieStudyDesk.icon('calendar-check', {size: 'sm'})); plan.append(mark, el('p', '', result.plan.text)); findings.append(plan); adopt.disabled = false;
        for (const item of result.plan.items || []) if (item.kind === 'learn') {
          const local = window.__pinkieStudyDesk?.local?.(), subjects = local?.today?.mastery?.subjects || [];
          const chapter = subjects.flatMap(s => s.chapters || []).find(ch => ch.k === item.k);
          const text = item.text || item.title || chapter?.items?.find(p => p.i === item.i)?.text || `${item.k} · 考点 ${Number(item.i || 0) + 1}`;
          findings.append(el('p', 'b-plan-learn', '学 · ' + text));
        }
      }
      adoptMsg.textContent = result.insightStale ? '数据有更新，可重新分析后再采纳。' : '会写进学习约定，明早按约定时间提醒。';
    }
    async function load(force = false) {
      const token = ++revision; stopMotion(); refresh.disabled = true; root.setAttribute('aria-busy', 'true');
      buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === range))); kicker.textContent = kickerFor(range);
      skeleton(headline, 1); skeleton(findings); adopt.disabled = true;
      const requestedRange = range;
      const report = request('insight', {range: requestedRange, force}).catch(error => ({status: 'failed', error: error.message}));
      const data = await Promise.allSettled([request('metrics', {range: requestedRange}), request('digest', {range: requestedRange})]);
      if (!alive || token !== revision) return;
      if (data[0].status === 'fulfilled') { renderMetrics(data[0].value); renderPace(data[0].value.pace); }
      else { metrics.replaceChildren(el('p', 'b-failure', '统计暂时没有读到：' + data[0].reason.message)); chart.replaceChildren(); paceNote.textContent = '稍后重试。'; }
      digest = data[1].status === 'fulfilled' ? data[1].value : null;
      const result = await report;
      if (!alive || token !== revision) return;
      renderInsight(result); refresh.disabled = false; root.setAttribute('aria-busy', 'false');
    }
    refresh.onclick = () => load(true);
    adopt.onclick = async () => {
      if (!insight?.plan || adopt.disabled) return;
      const token = revision; adopt.disabled = true; adopt.textContent = '正在写入…';
      try {
        const result = await request('adoptPlan', {planId: insight.plan.id});
        if (!alive || token !== revision) return;
        adopt.textContent = '已采纳'; adoptMsg.textContent = `明早 ${result.reminderAt}，碧琪会按这个计划提醒先生。`; motion.confettiAt?.(adopt, 'small');
      } catch (error) { if (alive && token === revision) { adopt.disabled = false; adopt.textContent = '重试采纳'; adoptMsg.textContent = error.message; } }
    };
    const changes = el('section', 'b-receipts'); changes.append(el('h3', '', '最近改动')); root.append(changes);
    const refreshChanges = async () => {
      try {
        const {receipts = []} = await ctx.request('pinkie.learning.ref.receipts', {recent:true}); if (!alive || !root.isConnected) return;
        changes.replaceChildren(el('h3', '', '最近改动'));
        if (!receipts.length) changes.append(el('p', 'b-sub', '收进手账、采纳计划和更正判分，都会在这里留下回执。'));
        for (const receipt of receipts.slice(0, 8)) {
          const row = el('div', 'b-receipt'); row.append(el('span', '', (receipt.by === 'biqi' ? '碧琪 · ' : '') + (receipt.title || receipt.text || receipt.action)));
          if (receipt.undone) row.append(el('small', '', '已撤销'));
          else if (receipt.undoable) { const undo = el('button', 'b-refresh', '撤销'); undo.type = 'button'; undo.onclick = async () => { undo.disabled=true; try { await ctx.request('pinkie.learning.ref.undo', {receiptId:receipt.receiptId}); await refreshChanges(); } catch (error) { undo.disabled=false; undo.textContent=error.message; } }; row.append(undo); }
          changes.append(row);
        }
      } catch (error) { if (alive) changes.append(el('p', 'b-sub', '改动记录暂时没读到：' + error.message)); }
    }; void refreshChanges();
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const reduce = () => { if (motion.reduced) { stopMotion(); root.querySelectorAll('[data-count]').forEach(node => { node.textContent = node.dataset.count; }); root.querySelectorAll('.b-chart path').forEach(path => { path.style.strokeDasharray = 'none'; path.style.strokeDashoffset = '0'; }); } };
    media?.addEventListener?.('change', reduce);
    const teardown = () => { alive = false; revision++; stopMotion(); media?.removeEventListener?.('change', reduce); };
    load();
    return {unmount: teardown, pause: stopMotion};
  }
  function register() {
    const desk = window.__pinkieStudyDesk;
    if (registered || !desk?.registerView) return registered;
    desk.registerView('board', {title: '看板', icon: 'chart', mount}); registered = true; return true;
  }
  if (!register()) {
    const timer = window.setInterval(() => { if (register()) window.clearInterval(timer); }, 200);
    window.addEventListener('pagehide', () => window.clearInterval(timer), {once: true});
  }
})();
