/* laolao-rich:v1 —— Li An 回复里的富内容
 *
 * Li An 在回复里写带语言标记的代码块，这里把它们原地变成能用的东西：
 *   ```ui         选项按钮、表单、清单、方案卡片（C.le. 风格的轻量渲染器，写法沿用 A2UI 的思路）
 *   ```chart      图表（Chart.js）
 *   ```mermaid    流程图、思维导图、时间线、甘特图（Mermaid）
 *   $…$  $$…$$    数学公式（KaTeX；apply-chat-math.mjs 先让 markdown 原样保住公式）
 *   ```followups  回复下面的「接着问」按钮（只在最新一条回复上出现）
 *   ```app        能直接玩的小应用（隔离框架，配色由网关注入）
 *   表格           点表头排序
 * 三个库只在第一次用到时才加载。原代码块藏起来但保留，点右上角「源码」能看。
 * 只处理 Li An 的消息，流式输出中的气泡先不动，写完再变。 */
(() => {
  'use strict';
  if (window.__laolaoRich) return;
  window.__laolaoRich = true;

  const LANGS = new Set(['ui', 'chart', 'mermaid', 'followups', 'app']);
  // 插件静态目录（/cle/static/legacy/），不再相对页面路径
  const BASE = '/cle/static/legacy/';
  const VENDOR = {
    chart: BASE + 'laolao-vendor-chart.js?v=4.5.1',
    mermaid: BASE + 'laolao-vendor-mermaid.js?v=12.0.0',
    katex: BASE + 'laolao-katex/katex.min.js?v=0.18.9',
    katexCss: BASE + 'laolao-katex/katex.min.css?v=0.18.9',
    mhchem: BASE + 'laolao-katex/mhchem.min.js?v=0.18.9',
  };
  // C.le. 只用一个强调色（冰蓝 gaze）+ 纸墨灰阶；其余色相只用于区分数据系列
  const CLE = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const PALETTE = {
    day: ['#1C7FE0', '#5F5A52', '#9C968C', '#7FA8D6', '#B0752F', '#3E6B4F'],
    night: ['#38AEFF', '#C9C3B8', '#8A857C', '#6E9DCC', '#D19A5A', '#6FBF97'],
  };
  const night = () => document.documentElement.hasAttribute('data-pinkie-night');
  const toast = (m) => { try { window.__laolaoToast?.(m); } catch {} };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('laolao:rich:' + k) || 'null'); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('laolao:rich:' + k, JSON.stringify(v)); } catch {} },
  };
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

  /* ── 按需加载 ── */
  const loading = {};
  function script(src) {
    return loading[src] ||= new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = ok; s.onerror = () => { delete loading[src]; fail(new Error('加载失败：' + src)); };
      document.head.append(s);
    });
  }
  function css(href) {
    if (document.querySelector(`link[data-pk-css="${href}"]`)) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.dataset.pkCss = href; document.head.append(l);
  }
  const katexReady = () => (css(VENDOR.katexCss), script(VENDOR.katex).then(() => script(VENDOR.mhchem).catch(() => {})));

  /* ── 发给 Li An：和提问卡一样走输入框，原来没打完的字放回去 ── */
  const paneFor = origin => origin?.closest?.('openclaw-chat-pane') || document.querySelector('openclaw-chat-pane[active]') || document.querySelector('openclaw-chat-pane');
  const sessionFor = origin => paneFor(origin)?.state?.sessionKey || window.__laolaoSidebar?.currentSessionKey?.() || new URL(location.href).searchParams.get('session') || document.querySelector('.sidebar-recent-session--active[data-session-key]')?.dataset.sessionKey || '';
  const request = (method, params, timeout = 15000) => typeof window.__laolaoSidebar?.gwRequest === 'function'
    ? window.__laolaoSidebar.gwRequest(method, params, timeout) : Promise.reject(new Error('网关暂未连接，请稍后再试。'));
  async function send(text, origin) {
    const key = sessionFor(origin);
    if (!key) throw new Error('没有找到当前聊天，请打开一段对话后重试。');
    const state = paneFor(origin)?.state;
    if (typeof state?.handleSendChat === 'function') {
      if (!state.connected) throw new Error('连接暂时断开，内容还没发送，请稍后再试。');
      const busy = !!(state.chatRunId || state.chatSending);
      await state.handleSendChat(String(text), {restoreDraft: true});
      if (state.sessionKey !== key) throw new Error('聊天已经切换，请回到原对话重新提交。');
      if (state.chatError || state.lastError) throw new Error(String(state.chatError || state.lastError));
      return {queued: busy, sessionKey: key};
    }
    await request('chat.send', {sessionKey: key, message: String(text), deliver: false, idempotencyKey: crypto.randomUUID()});
    return {queued: false, sessionKey: key};
  }
  function inlineError(root, message) {
    let node = root.querySelector(':scope > .pk-ui__error');
    if (!node) { node = el('div', 'pk-ui__error'); node.setAttribute('role', 'alert'); root.append(node); }
    node.textContent = String(message || '发送没有完成，请重试。');
  }

  /* ── 外壳：标题栏右上角「源码」 ── */
  function shell(kind, src, wrapper) {
    const box = el('div', 'pk-rich pk-rich--' + kind);
    const tools = el('div', 'pk-rich__tools');
    const btn = el('button', 'pk-rich__src', '源码'); btn.type = 'button';
    btn.addEventListener('click', () => { const show = wrapper.hasAttribute('data-pk-hidden'); wrapper.toggleAttribute('data-pk-hidden', !show); btn.setAttribute('aria-pressed', String(show)); });
    tools.append(btn);
    box.append(tools);
    return box;
  }
  function fail(box, msg) { box.classList.add('is-error'); box.append(el('div', 'pk-rich__error', msg)); }

  /* ── 行内 / 独立公式的兜底 ──
   * 上游 Control UI 的新 markdown（markdown-it）没有公式规则，$…$ 会原样留在正文里。
   * 这里按 $…$、$$…$$、\(…\)、\[…\] 识别，包成 <span|div class="pk-math"> 再交给 KaTeX。
   * 只处理文字节点，不碰代码块、链接、已有的 .pk-math；价格写法（$5 到 $10）不动。 */
  const MATH_TEXT = /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|(?<![\\$])\$([^$\n]+?)(?<!\\)\$(?!\$)|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g;
  function mathIn(node) {
    const text = node.nodeValue || '';
    if (!/[$\\]/.test(text)) return false;
    MATH_TEXT.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m, hit = false;
    while ((m = MATH_TEXT.exec(text))) {
      const raw = m[0];
      const display = m[1] !== undefined || m[4] !== undefined;
      const tex = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (!tex.trim()) continue;
      if (!display) {
        // $5 到 $10 这种价格/货币写法不当公式
        if (/^\s/.test(tex) || /\s$/.test(tex)) continue;
        if (/^[\d.,]+$/.test(tex)) continue;
      }
      if (m.index > last) frag.append(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement(display ? 'div' : 'span');
      span.className = 'pk-math' + (display ? ' pk-math--block' : '');
      span.textContent = tex;
      frag.append(span);
      last = m.index + raw.length; hit = true;
    }
    if (!hit) return false;
    if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
    node.replaceWith(frag);
    return true;
  }
  function mathify(root) {
    if (!root?.isConnected || root.closest?.('.pk-math, pre, code, .katex')) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest('pre, code, a, .pk-math, .katex, .code-block-header') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    for (const n of nodes) if (n.isConnected) mathIn(n);
  }

  /* ── ```ui ────────────────────────────────────────────────
   * {"title","text",
   *  "buttons": ["A","B"] | [{"label","send"}],                 点了直接发
   *  "fields": [{"id","type":"choice|multi|text|number|date|time|slider|check","label",
   *              "options","min","max","step","value","placeholder","long","unit"}],
   *  "submit": "按钮文字",                                         填完一起发
   *  "checklist": ["…"] | [{"text","done"}],                      自己勾，不发
   *  "cards": [{"title","text","tag","button"}]}                   方案卡片，点卡片上的按钮发 */
  function renderUI(box, spec, key) {
    const done = store.get('ui:' + key);
    const root = el('div', 'pk-ui');
    if (spec.title) root.append(el('div', 'pk-ui__title', String(spec.title)));
    if (spec.text) root.append(el('div', 'pk-ui__text', String(spec.text)));
    const lock = (summary) => {
      root.classList.add('is-sent');
      root.querySelectorAll('button, input, textarea, select').forEach((n) => { if (!n.classList.contains('pk-todo__box')) n.disabled = true; });
      if (summary) { const s = el('div', 'pk-ui__sent'); s.append(el('b', '', '已提交'), el('span', '', summary)); root.append(s); }
    };
    let sending = false;
    const fire = async (text, summary, mark) => {
      if (sending || done || root.classList.contains('is-sent')) return;
      sending = true;
      root.setAttribute('aria-busy', 'true');
      root.querySelector(':scope > .pk-ui__error')?.remove();
      try {
        await send(text, box);
        store.set('ui:' + key, {summary, mark: mark ? mark.dataset.i ?? null : null, at: Date.now()});
        if (mark) mark.classList.add('is-chosen');
        lock(summary);
      } catch (error) { inlineError(root, error.message); }
      finally { sending = false; root.removeAttribute('aria-busy'); }
    };

    if (Array.isArray(spec.buttons) && spec.buttons.length) {
      const row = el('div', 'pk-ui__buttons');
      spec.buttons.forEach((b, i) => {
        const label = typeof b === 'string' ? b : String(b.label ?? '');
        const msg = typeof b === 'string' ? b : String(b.send ?? b.label ?? '');
        if (!label) return;
        const btn = el('button', 'pk-chip', label); btn.type = 'button'; btn.dataset.i = String(i);
        btn.addEventListener('click', () => fire(msg, label, btn));
        row.append(btn);
      });
      root.append(row);
    }

    if (Array.isArray(spec.cards) && spec.cards.length) {
      const grid = el('div', 'pk-ui__cards');
      spec.cards.forEach((c, i) => {
        const card = el('div', 'pk-card'); card.dataset.i = String(i);
        if (c.tag) card.append(el('span', 'pk-card__tag', String(c.tag)));
        if (c.title) card.append(el('div', 'pk-card__title', String(c.title)));
        if (c.text) card.append(el('div', 'pk-card__text', String(c.text)));
        if (c.button !== false) {
          const label = typeof c.button === 'string' ? c.button : '选这个';
          const btn = el('button', 'pk-btn pk-btn--ghost', label); btn.type = 'button';
          btn.addEventListener('click', () => fire(c.send ? String(c.send) : `我选「${c.title || label}」`, String(c.title || label), card));
          card.append(btn);
        }
        grid.append(card);
      });
      root.append(grid);
    }

    const values = {};
    const fields = Array.isArray(spec.fields) ? spec.fields : [];
    if (fields.length) {
      const form = el('div', 'pk-ui__fields');
      fields.forEach((f, i) => {
        const id = String(f.id || 'f' + i), type = String(f.type || 'text'), label = String(f.label || '');
        const row = el('div', 'pk-field pk-field--' + type);
        if (type !== 'check') row.append(el('div', 'pk-field__label', label));
        if (type === 'choice' || type === 'multi') {
          const opts = el('div', 'pk-field__options');
          values[id] = type === 'multi' ? (Array.isArray(f.value) ? [...f.value] : []) : (f.value ?? null);
          (Array.isArray(f.options) ? f.options : []).forEach((o) => {
            const text = String(typeof o === 'object' && o ? o.label ?? o.value : o);
            const chip = el('button', 'pk-chip', text); chip.type = 'button';
            if (values[id] === text || Array.isArray(values[id]) && values[id].includes(text)) chip.classList.add('is-on');
            chip.addEventListener('click', () => {
              if (type === 'multi') { chip.classList.toggle('is-on'); values[id] = [...opts.querySelectorAll('.is-on')].map((n) => n.textContent); }
              else { opts.querySelectorAll('.is-on').forEach((n) => n.classList.remove('is-on')); chip.classList.add('is-on'); values[id] = text; }
            });
            opts.append(chip);
          });
          row.append(opts);
        } else if (type === 'slider') {
          const min = Number(f.min ?? 0), max = Number(f.max ?? 100), step = Number(f.step ?? 1);
          const v = Number(f.value ?? Math.round((min + max) / 2));
          const wrap = el('div', 'pk-slider');
          const input = el('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(v);
          input.setAttribute('aria-label', label);
          const out = el('output', 'pk-slider__val');
          const sync = () => { values[id] = Number(input.value); out.textContent = input.value + (f.unit ? ' ' + f.unit : ''); input.style.setProperty('--p', ((input.value - min) / (max - min || 1) * 100) + '%'); };
          input.addEventListener('input', sync); sync();
          wrap.append(input, out); row.append(wrap);
        } else if (type === 'check') {
          const lab = el('label', 'pk-check');
          const box = el('input', 'pk-check__box'); box.type = 'checkbox'; box.checked = !!f.value; values[id] = box.checked;
          box.addEventListener('change', () => { values[id] = box.checked; });
          lab.append(box, el('span', '', label)); row.append(lab);
        } else {
          const long = type === 'text' && f.long;
          const input = el(long ? 'textarea' : 'input', 'pk-input');
          if (!long) input.type = type === 'number' ? 'number' : type === 'date' ? 'date' : type === 'time' ? 'time' : 'text';
          input.setAttribute('aria-label', label); input.required = !!f.required;
          for (const name of ['min', 'max', 'step']) if (f[name] != null) input[name] = String(f[name]);
          if (long) input.rows = 3;
          if (f.placeholder) input.placeholder = String(f.placeholder);
          if (f.value != null) input.value = String(f.value);
          values[id] = input.value;
          input.addEventListener('input', () => { values[id] = input.value; });
          row.append(input);
          if (f.unit) row.append(el('span', 'pk-field__unit', String(f.unit)));
        }
        form.append(row);
      });
      root.append(form);
      const submit = el('button', 'pk-btn pk-btn--primary', String(spec.submit || '发给 Li An')); submit.type = 'button';
      submit.addEventListener('click', () => {
        const invalid = fields.find((f, i) => f.required && (values[String(f.id || 'f' + i)] == null || values[String(f.id || 'f' + i)] === '' || Array.isArray(values[String(f.id || 'f' + i)]) && !values[String(f.id || 'f' + i)].length));
        if (invalid) { inlineError(root, '请先填写「' + (invalid.label || invalid.id) + '」。'); return; }
        for (const input of root.querySelectorAll('input,textarea')) if (!input.checkValidity()) { input.reportValidity(); return; }
        const lines = [], parts = [];
        fields.forEach((f, i) => {
          const id = String(f.id || 'f' + i), v = values[id];
          let shown = Array.isArray(v) ? v.join('、') : typeof v === 'boolean' ? (v ? '是' : '否') : String(v ?? '');
          if (f.type === 'slider' && f.unit) shown += ' ' + f.unit;
          if (!shown.trim()) shown = '（没填）';
          lines.push(`${f.label || id}：${shown}`);
          parts.push(shown);
        });
        fire(`${spec.title ? `「${spec.title}」` : '我填好了'}\n${lines.join('\n')}`, parts.join(' · '));
      });
      const bar = el('div', 'pk-ui__submit'); bar.append(submit); root.append(bar);
    }

    if (Array.isArray(spec.checklist) && spec.checklist.length) {
      const saved = store.get('check:' + key) || {};
      const list = el('div', 'pk-ui__checklist');
      const count = el('div', 'pk-ui__count');
      const refresh = () => { const all = list.querySelectorAll('input').length, on = list.querySelectorAll('input:checked').length; count.textContent = `${on} / ${all}`; root.classList.toggle('is-complete', all > 0 && on === all); };
      spec.checklist.forEach((item, i) => {
        const text = String(typeof item === 'object' && item ? item.text ?? '' : item);
        const lab = el('label', 'pk-check');
        const box = el('input', 'pk-check__box pk-todo__box'); box.type = 'checkbox';
        box.checked = i in saved ? !!saved[i] : !!(typeof item === 'object' && item && item.done);
        box.addEventListener('change', () => { saved[i] = box.checked; store.set('check:' + key, saved); refresh(); });
        lab.append(box, el('span', '', text)); list.append(lab);
      });
      root.append(list, count); refresh();
    }

    box.append(root);
    if (done) {
      if (done.mark != null) root.querySelectorAll('.pk-ui__buttons > .pk-chip, .pk-card').forEach((n) => { if (n.dataset.i === String(done.mark)) n.classList.add('is-chosen'); });
      lock(done.summary);
    }
  }

  /* ── ```chart ── */
  async function renderChart(box, spec) {
    await script(VENDOR.chart);
    if (!box.isConnected) return;
    const Chart = window.Chart;
    const dark = night(), pal = PALETTE[dark ? 'night' : 'day'];
    const ink = CLE('--cle-ink-2') || (dark ? 'rgba(255,255,255,.62)' : 'rgba(20,18,15,.62)');
    const grid = CLE('--cle-line') || (dark ? 'rgba(255,255,255,.08)' : 'rgba(20,18,15,.08)');
    const surface = CLE('--cle-surface') || (dark ? '#131418' : '#FBFAF7');
    let type = String(spec.type || 'bar');
    const area = type === 'area'; if (area) type = 'line';
    const round = type === 'pie' || type === 'doughnut' || type === 'polarArea';
    const series = Array.isArray(spec.series) ? spec.series : spec.data ? [{name: spec.name || '', data: spec.data}] : [];
    const datasets = series.map((s, i) => {
      const c = pal[i % pal.length];
      return round
        ? {label: s.name || '', data: s.data, backgroundColor: (s.data || []).map((_, j) => pal[j % pal.length]), borderColor: surface, borderWidth: 2}
        : {label: s.name || '', data: s.data, borderColor: c, backgroundColor: area || type === 'radar' ? c + '33' : type === 'line' ? c : c + 'cc', fill: area || type === 'radar', tension: .32, borderWidth: type === 'line' ? 2.2 : 0, pointRadius: type === 'line' ? 2.5 : 3, borderRadius: type === 'bar' ? 6 : 0, maxBarThickness: 42};
    });
    const unit = spec.unit ? String(spec.unit) : '';
    const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('zh-CN') : v) + (unit ? ' ' + unit : '');
    const wrap = el('div', 'pk-chart');
    if (spec.title) wrap.append(el('div', 'pk-chart__title', String(spec.title)));
    const stage = el('div', 'pk-chart__stage'); const cv = el('canvas'); stage.append(cv); wrap.append(stage);
    box.append(wrap);
    // 图表自带一张卡片（留白 + 描边），外面不再套一层 pk-rich 外壳。
    // 画布高度由卡片的高度决定，卡片不能再被画布撑回去：左右各留 16px，纵向留出标题与图例。
    box.classList.add('pk-chart-card');
    Chart.defaults.font.family = CLE('--cle-sans') || '-apple-system, "PingFang SC", sans-serif';
    const chart = new Chart(cv, {
      type,
      data: {labels: spec.labels || [], datasets},
      options: {
        responsive: true, maintainAspectRatio: false, animation: {duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600},
        indexAxis: spec.horizontal ? 'y' : 'x',
        plugins: {
          legend: {display: datasets.length > 1 || round, position: 'bottom', labels: {color: ink, boxWidth: 10, boxHeight: 10, usePointStyle: true}},
          tooltip: {callbacks: {label: (c) => `${c.dataset.label ? c.dataset.label + '：' : (round ? c.label + '：' : '')}${fmt(spec.horizontal ? c.parsed?.x : c.parsed?.y ?? c.parsed?.r ?? c.parsed)}`}},
        },
        scales: round ? {} : type === 'radar'
          ? {r: {grid: {color: grid}, angleLines: {color: grid}, pointLabels: {color: ink}, ticks: {display: false}}}
          : {x: {stacked: !!spec.stacked, grid: {display: false}, ticks: {color: ink}}, y: {stacked: !!spec.stacked, grid: {color: grid}, border: {display: false}, ticks: {color: ink, callback: (v) => fmt(v)}}},
      },
    });
    box.__pkChart = chart;
  }

  /* ── ```mermaid ── */
  let mermaidSeq = 0, mermaidTheme = '';
  async function renderMermaid(box, src) {
    await script(VENDOR.mermaid);
    if (!box.isConnected) return;
    const m = window.mermaid;
    const dark = night(), theme = dark ? 'night' : 'day';
    if (mermaidTheme !== theme) {
      // C.le. 配色：纸色节点、墨色文字、冰蓝描边与连线；思维导图各分支依次用调色板里的颜色
      const pal = PALETTE[theme];
      const tone = {
        ink: CLE('--cle-ink') || (dark ? '#ECE8E1' : '#15130F'),
        ink2: CLE('--cle-ink-2') || (dark ? '#9A958C' : '#5F5A52'),
        surface: CLE('--cle-surface') || (dark ? '#131418' : '#FBFAF7'),
        paper: CLE('--cle-paper') || (dark ? '#0B0C0F' : '#F3F0EA'),
        line: CLE('--cle-line-strong') || (dark ? 'rgba(255,255,255,.14)' : 'rgba(20,18,15,.18)'),
        gaze: CLE('--cle-gaze') || (dark ? '#38AEFF' : '#1C7FE0'),
      };
      const vars = {darkMode: dark, background: 'transparent', primaryColor: tone.surface, primaryBorderColor: tone.gaze, primaryTextColor: tone.ink,
        secondaryColor: tone.paper, tertiaryColor: tone.paper, lineColor: tone.ink2, textColor: tone.ink, edgeLabelBackground: tone.surface,
        clusterBkg: tone.paper, clusterBorder: tone.line, titleColor: tone.ink, nodeBorder: tone.gaze, mainBkg: tone.surface, nodeTextColor: tone.ink,
        actorBkg: tone.surface, actorBorder: tone.gaze, actorTextColor: tone.ink, signalColor: tone.ink2, signalTextColor: tone.ink,
        labelBoxBkgColor: tone.surface, labelBoxBorderColor: tone.line, labelTextColor: tone.ink, noteBkgColor: tone.paper, noteTextColor: tone.ink, noteBorderColor: tone.line,
        pieTitleTextColor: tone.ink, pieSectionTextColor: tone.ink, pieLegendTextColor: tone.ink, pieStrokeColor: tone.surface};
      pal.forEach((c, i) => { vars['cScale' + i] = c; vars['cScaleLabel' + i] = dark ? '#0B0C0F' : '#FBFAF7'; vars['cScale' + (i + 6)] = c; vars['cScaleLabel' + (i + 6)] = dark ? '#0B0C0F' : '#FBFAF7'; });
      m.initialize({startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: {...vars, fontFamily: CLE('--cle-sans') || '-apple-system, "PingFang SC", sans-serif', fontSize: '14px'},
        flowchart: {curve: 'basis', padding: 12}, mindmap: {padding: 14}});
      mermaidTheme = theme;
    }
    await m.parse(src);                               // 先校验：写错了直接抛错，不在页面上留下错误图
    const id = 'pk-mermaid-' + (++mermaidSeq);
    let svg;
    try { ({svg} = await m.render(id, src)); } finally { document.getElementById('d' + id)?.remove(); }
    if (!box.isConnected) return;
    // 流程图放在自己的卡片里；外面那层 pk-rich 只留「源码」按钮（不再占位）
    box.classList.add('pk-mermaid-card');
    const wrap = el('div', 'pk-mermaid'); wrap.innerHTML = svg; box.prepend(wrap);
    const tools = box.querySelector('.pk-rich__tools');
    if (tools && !tools.querySelector('[data-pk-full]')) {
      const full = iconButton('full', '展开图表', () => setFull(box, !box.classList.contains('is-full')));
      full.dataset.pkFull = '';
      const copy = el('button', 'pk-rich__src', '复制'); copy.type = 'button'; copy.setAttribute('aria-label', '复制图表源码');
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(src); copy.textContent = '已复制'; } catch { toast('请展开源码后复制。'); } });
      tools.prepend(full, copy);
    }
    // 横着很长的图（七八步的流程）别硬缩到气泡宽度——字会小到看不清；按可读的大小放，左右滑动看
    const svgEl = wrap.querySelector('svg'), vb = svgEl?.viewBox?.baseVal;
    requestAnimationFrame(() => {
      const avail = wrap.clientWidth;
      if (vb && avail && vb.width > avail * 1.25) {
        svgEl.style.maxWidth = 'none';
        svgEl.style.width = Math.round(Math.min(vb.width, avail * 2.2)) + 'px';
        wrap.classList.add('is-wide');
      }
    });
  }

  /* ── ```app：聊天里能直接玩的小应用 ──
   * 外壳 = 一条标题栏（应用名 · 重新开始 · 全屏 · 源码）+ 隔离框架。
   * 框架没有同源权限，只能用 postMessage 报高度；配色由网关注入，昼夜切换时发消息过去。 */
  const ICON = {
    app: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6.4 5.2v5.6L11 8z" fill="currentColor"/></svg>',
    restart: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M3.2 2.4v2.8H6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    full: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    shrink: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    code: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  function iconButton(icon, label, onClick) {
    const b = el('button', 'pk-app__tool'); b.type = 'button'; b.innerHTML = ICON[icon];
    b.title = label; b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }
  const appFrames = new Set();
  const themeOf = () => night() ? 'night' : 'day';
  let fullBox = null;
  function setFull(box, on) {
    if (on && fullBox && fullBox !== box) setFull(fullBox, false);
    box.classList.toggle('is-full', on);
    document.documentElement.classList.toggle('pk-app-full', on);
    const btn = box.querySelector('[data-pk-full]');
    if (btn) { btn.innerHTML = ICON[on ? 'shrink' : 'full']; btn.title = on ? '还原' : '全屏'; btn.setAttribute('aria-label', btn.title); }
    fullBox = on ? box : null;
    document.querySelector('.pk-app__scrim')?.remove();
    if (on) {
      const scrim = el('div', 'pk-app__scrim');
      scrim.addEventListener('click', () => setFull(box, false));
      box.before(scrim);
      box.querySelector('.pk-app__frame')?.focus();
    }
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && fullBox) { e.stopPropagation(); setFull(fullBox, false); } }, true);

  async function renderApp(box, src, wrapper) {
    const doc = new DOMParser().parseFromString(src, 'text/html');
    const named = (doc.querySelector('title')?.textContent || '').trim().slice(0, 60);
    const title = named || '小应用';
    box.querySelector('.pk-rich__tools')?.remove();
    const bar = el('div', 'pk-app__bar');
    const name = el('div', 'pk-app__name');
    const glyph = el('span', 'pk-app__glyph'); glyph.innerHTML = ICON.app;
    name.append(glyph, el('b', '', title));
    if (named) name.append(el('span', 'pk-app__kind', '小应用'));
    const tools = el('div', 'pk-app__tools');
    bar.append(name, tools);
    const stage = el('div', 'pk-app__stage');
    const loader = el('div', 'pk-app__loading'); loader.append(el('i'), el('span', '', '正在搭起来…'));
    stage.append(loader);
    box.append(bar, stage);

    const result = await request('pinkie.rich.app.put', {sessionKey: sessionFor(box), html: src});
    if (!box.isConnected) return;
    const url = () => result.url + '&theme=' + themeOf();
    const frame = el('iframe', 'pk-app__frame');
    frame.title = title; frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer';
    frame.style.colorScheme = night() ? 'dark' : 'light';
    frame.src = url();
    frame.addEventListener('load', () => { loader.remove(); box.classList.add('is-ready'); });
    const source = iconButton('code', '源码', () => {
      const show = wrapper.hasAttribute('data-pk-hidden');
      wrapper.toggleAttribute('data-pk-hidden', !show); source.setAttribute('aria-pressed', String(show));
    });
    const full = iconButton('full', '全屏', () => setFull(box, !box.classList.contains('is-full'))); full.dataset.pkFull = '';
    tools.append(iconButton('restart', '重新开始', () => { box.classList.remove('is-ready'); frame.src = url() + '&r=' + Date.now(); }), full, source);
    box.__pkApp = {frame, id: result.id, token: result.token};
    appFrames.add(box);
    stage.append(frame);
  }
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== 'pinkie-app-size' || !Number.isFinite(data.height)) return;
    for (const box of appFrames) {
      if (!box.isConnected) { appFrames.delete(box); continue; }
      const app = box.__pkApp;
      if (event.source === app.frame.contentWindow && data.id === app.id && data.token === app.token) {
        app.frame.style.height = Math.round(Math.max(96, Math.min(720, data.height))) + 'px';
      }
    }
  });
  function retheme() {
    for (const box of appFrames) {
      if (!box.isConnected) { appFrames.delete(box); continue; }
      const frame = box.__pkApp.frame;
      frame.style.colorScheme = night() ? 'dark' : 'light';
      frame.contentWindow?.postMessage({type: 'pinkie-app-theme', night: night()}, '*');
    }
  }

  /* ── 代码块 → 组件 ── */
  const done = new WeakMap();   // code 元素 → {src, box}
  function blockOf(code) {
    const m = (code.className || '').match(/language-([\w-]+)/);
    return m && LANGS.has(m[1]) ? m[1] : null;
  }
  function wrapperOf(code) {
    return code.closest('details.json-collapse') || code.closest('.code-block-wrapper') || code.closest('pre');
  }
  async function build(code, lang, src) {
    const wrapper = wrapperOf(code);
    if (!wrapper) return;
    const prev = done.get(code);
    if (prev && prev.src === src && prev.box.isConnected) return;
    if (prev?.box) { prev.box.__pkChart?.destroy?.(); prev.box.remove(); }
    const group = code.closest('.chat-group');
    const message = code.closest('[data-message-id]')?.dataset.messageId || group?.querySelector('[data-message-id]')?.dataset.messageId || [...(group?.parentElement?.children || [])].indexOf(group);
    const key = hash(sessionFor(code) + '|' + message + '|' + src);
    if (lang === 'followups') {
      wrapper.setAttribute('data-pk-hidden', '');
      done.set(code, {src, box: wrapper});
      placeFollowups();
      return;
    }
    const box = shell(lang, src, wrapper);
    done.set(code, {src, box});
    wrapper.setAttribute('data-pk-hidden', '');
    wrapper.after(box);
    try {
      if (lang === 'ui') renderUI(box, JSON.parse(src), key);
      else if (lang === 'chart') await renderChart(box, JSON.parse(src));
      else if (lang === 'mermaid') await renderMermaid(box, src);
      else if (lang === 'app') await renderApp(box, src, wrapper);
    } catch (err) {
      // 写错了就把原代码块露出来，别让内容消失
      wrapper.removeAttribute('data-pk-hidden');
      fail(box, lang === 'mermaid' ? '这张图的写法有误，下面是原文。' : '这段内容格式有误，下面是原文。');
      console.warn('[laolao-rich]', lang, err);
    }
  }

  /* ── 「接着问」：只在最新一条 Li An 回复上 ── */
  // 只在内容真的变了时才动 DOM：这里每次扫描都会跑，删了再加会触发观察者，自己把自己循环起来
  const activeThread = () => document.querySelector('.chat-pane-cache__pane--active') || document;
  function placeFollowups() {
    const groups = [...activeThread().querySelectorAll('.chat-group')].filter(n => !n.closest('.agent-chat__welcome'));
    const last = groups.at(-1);
    const target = last?.classList.contains('assistant') ? last : null;
    if (target) placeInThread(target);
    document.querySelectorAll('.pk-follow').forEach(n => { if (!target || !target.contains(n)) n.remove(); });
  }
  function placeInThread(last) {
    const clear = () => last.querySelectorAll('.pk-follow').forEach((n) => n.remove());
    if (last.querySelector('.chat-bubble.streaming') || last.classList.contains('chat-group--streaming')) { clear(); return; }
    const code = [...last.querySelectorAll('code.language-followups')].pop();
    let items = null;
    try { items = code ? JSON.parse(code.textContent) : null; } catch {}
    if (!Array.isArray(items) || !items.length) { clear(); return; }
    const sig = JSON.stringify(items.slice(0, 4));
    const have = last.querySelector('.pk-follow');
    if (have && have.dataset.sig === sig) return;
    clear();
    const key = hash(sessionFor(last) + '|' + (last.querySelector('[data-message-id]')?.dataset.messageId || '') + '|' + sig);
    if (store.get('follow:' + key)) return;
    const row = el('div', 'pk-follow'); row.dataset.sig = sig;
    items.slice(0, 4).forEach((q) => {
      const text = String(typeof q === 'object' && q ? q.label ?? q.text ?? '' : q);
      if (!text) return;
      const b = el('button', 'pk-follow__item', text); b.type = 'button';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await send(text, row); store.set('follow:' + key, 1); row.remove(); }
        catch (error) { inlineError(row, error.message); b.disabled = false; }
      });
      row.append(b);
    });
    // 挂在回复的最末尾：建议紧跟着这一条，排在附件 / 操作行后面
    last.append(row);
  }

  /* ── 公式 ── */
  async function renderMath(nodes) {
    try { await katexReady(); } catch (e) { console.warn('[laolao-rich] katex', e); return; }
    nodes.forEach((n) => {
      if (n.hasAttribute('data-pk-done')) return;
      const tex = n.getAttribute('data-pk-tex') ?? n.textContent;
      n.setAttribute('data-pk-tex', tex);
      try {
        window.katex.render(tex, n, {displayMode: n.classList.contains('pk-math--block') || n.classList.contains('pk-math--display'), throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml'});
        n.setAttribute('data-pk-done', '');
      } catch (e) { n.classList.add('is-error'); }
    });
  }

  /* ── 表格排序 ── */
  const num = (s) => { const t = String(s).replace(/[,，\s¥￥$%元]/g, ''); return t !== '' && !isNaN(t) ? Number(t) : null; };
  function sortable(table) {
    if (table.hasAttribute('data-pk-sort')) return;
    const head = table.querySelector('thead tr'), body = table.querySelector('tbody');
    if (!head || !body || body.rows.length < 2) { table.setAttribute('data-pk-nosort', ''); return; }
    table.setAttribute('data-pk-sort', '');
    [...head.cells].forEach((th, col) => {
      th.tabIndex = 0;
      const go = () => {
        const dir = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
        [...head.cells].forEach((c) => c.removeAttribute('aria-sort'));
        th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
        const rows = [...body.rows];
        const nums = rows.every((r) => num(r.cells[col]?.textContent ?? '') !== null);
        rows.sort((a, b) => {
          const x = a.cells[col]?.textContent.trim() ?? '', y = b.cells[col]?.textContent.trim() ?? '';
          return dir * (nums ? num(x) - num(y) : x.localeCompare(y, 'zh-Hans-CN', {numeric: true}));
        });
        rows.forEach((r) => body.append(r));
      };
      th.addEventListener('click', go);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  /* ── 扫描 ── */
  const SCOPE = '.chat-group.assistant';
  const nativeMermaid = new WeakMap();
  function bridgeNativeMermaid() {
    for (const native of activeThread().querySelectorAll('.chat-group.assistant .markdown-mermaid > openclaw-mermaid')) {
      if (live(native) || !native.source?.trim()) continue;
      const previous = nativeMermaid.get(native);
      if (previous?.source === native.source && previous.pre.isConnected) continue;
      previous?.box?.remove();
      previous?.pre.remove();
      const wrapper = native.parentElement;
      const pre = el('pre', 'cle-mermaid-source');
      const code = el('code', 'language-mermaid', native.source); code.dataset.pkSeen = '';
      pre.append(code); wrapper.after(pre);
      wrapper.classList.add('cle-native-mermaid--bridged');
      // Keep the native component and its source; add the original renderer
      // beside it so WebKit does not depend on the new sandbox-frame loader.
      void build(code, 'mermaid', native.source);
      nativeMermaid.set(native, {source: native.source, pre, box: done.get(code)?.box});
    }
  }
  // Native panes are cached. Render only the selected conversation.
  const scopes = () => [...activeThread().querySelectorAll(SCOPE)].filter(n => !n.closest('.agent-chat__welcome'));
  const all = (selector) => scopes().flatMap((root) => [...root.querySelectorAll(selector)]);
  // 只看还没处理过的节点（原生选择器，长对话里也只是一次索引查找）；流式输出中的气泡跳过，写完再处理
  // 新皮肤的代码块结构不一定还是 pre > code，按语言 class 找更稳；只看还没处理过的节点
  const CODE_SEL = [...LANGS].map((l) => `${SCOPE} .chat-text code.language-${l}:not([data-pk-seen])`).join(',');
  const MATH_SEL = `${SCOPE} .chat-text .pk-math:not([data-pk-done]):not(.is-error)`;
  const TABLE_SEL = `${SCOPE} .chat-text table:not([data-pk-sort]):not([data-pk-nosort])`;
  const live = n => !!n.closest('.chat-bubble.streaming, .chat-group--streaming');
  function scan() {
    pending = false;
    bridgeNativeMermaid();
    all(CODE_SEL).forEach((code) => {
      if (live(code) || !wrapperOf(code)) return;
      code.setAttribute('data-pk-seen', '');
      build(code, blockOf(code), code.textContent.trim());
    });
    // 先把正文里的 $…$ 包成 .pk-math（新皮肤没有这一步），再统一交给 KaTeX
    const paras = all('.chat-text').filter(n => !live(n));
    paras.forEach(mathify);
    const math = all(MATH_SEL).filter((n) => !live(n));
    if (math.length) renderMath(math);
    all(TABLE_SEL).forEach((t) => { if (!live(t)) sortable(t); });
    placeFollowups();
  }
  let pending = false;
  // 新界面把消息放在虚拟列表里（.chat-virtual-sizer / .chat-virtual-block），外层的
  // .chat-thread-inner 只放欢迎页。所以观察要挂在聊天正文的滚动容器上：
  // .chat-thread-viewport 是常驻节点，会话切换、滚动重建消息都在它下面发生。
  const observers = new Map();
  const SCOPE_ROOT = '.chat-thread-viewport';
  const roots = () => {
    const list = [...document.querySelectorAll(SCOPE_ROOT)];
    return list.length ? list : [...document.querySelectorAll('.chat-thread-inner')];
  };
  const schedule = () => { if (!pending) { pending = true; setTimeout(scan, 160); } };
  // 自己的节点（富内容、图表、接着问、公式）加进来 / 删掉会再次触发观察者；只有「新增了别人
  // 生成的内容」或者「聊天内容被替换」才重扫 —— 否则每轮扫描都会删了再加，自己循环自己。
  // 已经处理过的节点都有记号（data-pk-seen / data-pk-done / data-pk-sort），重扫是幂等的。
  const MINE = '.pk-rich, .pk-chart-card, .pk-mermaid-card, .pk-follow, .katex, .pk-math';
  const changed = (records) => {
    let dirty = false;
    for (const record of records) {
      for (const node of record.removedNodes || []) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('.pk-chart-card')) node.__pkChart?.destroy?.();
        for (const box of node.querySelectorAll?.('.pk-chart-card') || []) box.__pkChart?.destroy?.();
      }
      if (dirty) continue;
      for (const node of record.addedNodes || []) {
        if (node.nodeType !== 1 || node.matches?.(MINE)) continue;
        // 只认出「别人的新内容」：消息、代码块、表格、原生流程图；纯组件容器不算
        if (node.matches?.('.chat-group, .chat-text, pre, code, table, .markdown-mermaid, .code-block-wrapper, .chat-virtual-block, .chat-virtual-row')) { dirty = true; break; }
        if (node.querySelector('.chat-group, .chat-text, pre, code, table, .markdown-mermaid')) { dirty = true; break; }
      }
    }
    if (dirty) schedule();
  };
  function attach() {
    let any = false;
    for (const [h, observer] of observers) if (!h.isConnected) { observer.disconnect(); observers.delete(h); any = true; }
    for (const h of roots()) if (!observers.has(h)) {
      const observer = new MutationObserver(changed);
      observer.observe(h, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
      observers.set(h, observer); any = true;
    }
    if (any) schedule();
  }
  setInterval(attach, 400);
  attach();

  // 昼夜切换：图表和流程图按新配色重画
  new MutationObserver(() => {
    document.querySelectorAll('.pk-chart-card, .pk-mermaid-card').forEach((b) => {
      b.__pkChart?.destroy?.();
      const code = b.previousElementSibling?.querySelector?.('code[data-pk-seen]');
      code?.removeAttribute('data-pk-seen');
      b.remove();
    });
    mermaidTheme = '';
    retheme();
    schedule();
  }).observe(document.documentElement, {attributes: true, attributeFilter: ['data-pinkie-night']});

  window.__laolaoRichApi = {send, scan, request, sessionFor};
})();
