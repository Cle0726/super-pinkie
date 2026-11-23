/* cle-peek:v1 —— 点一下状态行（或左边的 C.le. 小标），看本轮做了哪些步骤
 *
 *   [C.le.]  正在执行  node --test tests  12 秒  ›        ← 点这一行
 *   ┌───────────────────────────────────┐
 *   │ 本轮 6 步   正在执行 · 12 秒        │
 *   │ 0:00  读取文件   TOOLS.md          │
 *   │ 0:07  执行命令   node --test …   ● │
 *   └───────────────────────────────────┘
 *
 * - 状态行本来就不折叠过程（cle-stage 拦掉了 summary 的默认点击），这里把这一下点击用起来。
 *   键盘：Tab 到状态行，回车或空格打开；Esc 关闭并回到状态行。点小窗外面也关。
 * - 步骤取自卡片里已经渲染出来的工具行：名字用行上的中文标签，参数和开始时间用 cle-stage
 *   按 toolCallId 记在本机的那份。历史卡片也能看，没记下时间的步骤就不写时间。
 * - 正在跑的那一轮：最后一步标成进行中，打开期间每秒刷新一次（setTimeout，关了就停）。
 * - 点到正在动的小标：一道光沿笔顺跑过一遍（CleInk.poke）。悬停小标：一行提示。
 * - 换步骤时状态词淡入（cle-stage 的 write() 切换 data-flip / data-swap，动画在下面的样式里）。
 * 不加全局名、观察器和常驻定时器；样式随本文件注入，压过主题只靠 :not(#p…) 的权重。
 */
const P = 'html:not(#p1):not(#p2):not(#p3):not(#p4)';
const SUMMARY = '.pinkie-process > .pinkie-process__summary';
export const MAX_ROWS = 60;
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const EASE = 'cubic-bezier(.22, 1, .36, 1)';
const RUNNING = '.pinkie-process[data-cle-run] .cle-status';

const CSS = `
${P} ${SUMMARY}:has(> .cle-status) { cursor: pointer; }
${P} ${SUMMARY}:has(> .cle-status):focus-visible { outline: 2px solid var(--cle-accent); outline-offset: 3px; border-radius: 6px; }
${P} ${SUMMARY} > .cle-glyph { transition: opacity .18s ease, transform .14s ${EASE}; }
${P} ${SUMMARY}:hover > .cle-glyph--static { opacity: 1; }
${P} ${SUMMARY}:active > .cle-glyph { transform: scale(.94); }
${P} ${SUMMARY} > .cle-status::after { content: "›"; flex: none; margin-left: 1px; color: var(--cle-mute); opacity: 0;
  transform: translateX(-3px); transition: opacity .18s ease, transform .22s ${EASE}; }
${P} ${SUMMARY}:is(:hover, :focus-visible) > .cle-status::after { opacity: .75; transform: none; }
${P} ${SUMMARY}[aria-expanded="true"] > .cle-status::after { opacity: .9; transform: rotate(90deg); }

${P} ${RUNNING}:not([data-kind="done"]):not([data-kind="stopped"])[data-flip] > b { animation: cle-sweep 2.2s cubic-bezier(.45, .05, .35, 1) infinite, cle-flip-a .32s ${EASE} both; }
${P} ${RUNNING}:not([data-kind="done"]):not([data-kind="stopped"]):not([data-flip]) > b { animation: cle-sweep 2.2s cubic-bezier(.45, .05, .35, 1) infinite, cle-flip-b .32s ${EASE} both; }
${P} ${RUNNING}:is([data-kind="done"], [data-kind="stopped"])[data-flip] > b { animation: cle-flip-a .32s ${EASE} both; }
${P} ${RUNNING}:is([data-kind="done"], [data-kind="stopped"]):not([data-flip]) > b { animation: cle-flip-b .32s ${EASE} both; }
${P} ${RUNNING}[data-swap] > span { animation: cle-swap-a .3s ${EASE} both; }
${P} ${RUNNING}:not([data-swap]) > span { animation: cle-swap-b .3s ${EASE} both; }
@keyframes cle-flip-a { from { opacity: 0; transform: translateY(5px); } }
@keyframes cle-flip-b { from { opacity: 0; transform: translateY(5px); } }
@keyframes cle-swap-a { from { opacity: 0; transform: translateY(4px); filter: blur(2px); } }
@keyframes cle-swap-b { from { opacity: 0; transform: translateY(4px); filter: blur(2px); } }

${P} .cle-peek { position: fixed; z-index: 2147483000; display: flex; flex-direction: column; box-sizing: border-box;
  width: min(392px, calc(100vw - 16px)); max-height: min(360px, calc(100vh - 16px)); margin: 0; padding: 10px 4px 6px 12px;
  border: 0; border-radius: 12px; color: var(--cle-fg); background: rgba(255, 255, 255, .86);
  -webkit-backdrop-filter: blur(16px) saturate(1.5); backdrop-filter: blur(16px) saturate(1.5);
  box-shadow: 0 0 0 1px rgba(29, 27, 43, .07), 0 12px 32px -10px rgba(46, 24, 70, .3), 0 2px 6px rgba(46, 24, 70, .08);
  font: 12.5px/1.5 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; text-align: left; transform-origin: 14px 0; }
html[data-pinkie-night]:not(#p1):not(#p2):not(#p3):not(#p4) .cle-peek { background: rgba(29, 27, 42, .88);
  box-shadow: 0 0 0 1px rgba(236, 232, 240, .09), 0 16px 40px -12px rgba(0, 0, 0, .65); }
${P} .cle-peek[hidden] { display: none; }
${P} .cle-peek:not([hidden]) { animation: cle-peek-in .18s ${EASE} both; }
${P} .cle-peek[data-up]:not([hidden]) { transform-origin: 14px 100%; animation-name: cle-peek-up; }
@keyframes cle-peek-in { from { opacity: 0; transform: translateY(-4px) scale(.98); } }
@keyframes cle-peek-up { from { opacity: 0; transform: translateY(4px) scale(.98); } }
${P} .cle-peek__head { display: flex; align-items: baseline; gap: 10px; min-width: 0; padding: 0 8px 8px 0; border-bottom: 1px solid rgba(127, 120, 150, .16); }
${P} .cle-peek__head b { flex: none; font-weight: 600; color: var(--cle-ink); }
${P} .cle-peek__head span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cle-mute); font-variant-numeric: tabular-nums; }
${P} .cle-peek__list { list-style: none; margin: 4px 0 0; padding: 0 8px 0 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
${P} .cle-peek__list > li { position: relative; display: grid; grid-template-columns: 34px auto minmax(0, 1fr); gap: 9px; align-items: baseline;
  margin: 0; padding: 4px 0 4px 14px; list-style: none; }
${P} .cle-peek__list > li::before { content: ""; position: absolute; left: 2px; top: 11px; width: 5px; height: 5px; border-radius: 50%; background: var(--cle-mute); opacity: .5; }
${P} .cle-peek__list > li::after { content: ""; position: absolute; left: 4px; top: 19px; bottom: -8px; width: 1px; background: var(--cle-mute); opacity: .18; }
${P} .cle-peek__list > li:last-child::after { display: none; }
${P} .cle-peek__list > li[data-current]::before { background: var(--cle-accent); opacity: 1; animation: cle-peek-dot 1.6s ease-out infinite; }
@keyframes cle-peek-dot { from { box-shadow: 0 0 0 0 color-mix(in srgb, var(--cle-accent) 50%, transparent); } to { box-shadow: 0 0 0 7px transparent; } }
${P} .cle-peek__list time { font: 11px/1.5 ${MONO}; color: var(--cle-mute); font-variant-numeric: tabular-nums; }
${P} .cle-peek__list .l { white-space: nowrap; color: var(--cle-fg); }
${P} .cle-peek__list > li[data-current] .l { color: var(--cle-accent); font-weight: 500; }
${P} .cle-peek__list .x { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cle-mute); }
${P} .cle-peek__list .x[data-mono] { font: 11.5px/1.5 ${MONO}; color: var(--cle-cmd); }
${P} .cle-peek__note { padding: 6px 8px 2px 14px; color: var(--cle-mute); }
${P} .cle-peek-tip { position: fixed; z-index: 2147483001; box-sizing: border-box; max-width: min(420px, 70vw); padding: 4px 9px; border-radius: 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; color: #fff; background: rgba(26, 24, 38, .92);
  font: 12px/1.45 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
html[data-pinkie-night]:not(#p1):not(#p2):not(#p3):not(#p4) .cle-peek-tip { color: #1a1826; background: rgba(236, 232, 240, .95); }
${P} .cle-peek-tip[hidden] { display: none; }
${P} .cle-peek-tip:not([hidden]) { animation: cle-peek-up .14s ease-out both; }
@media (prefers-reduced-motion: reduce) {
  ${P} :is(.cle-peek, .cle-peek-tip, .cle-peek__list > li::before) { animation: none; }
  ${P} ${SUMMARY} > :is(.cle-glyph, .cle-status) { transition: none; }
}
`;

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** 毫秒 → 0:07、1:05 */
export function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/** 步骤 → 小窗里的行：时间从本轮开始（或第一步）算；进行中的是最后一步；太长只留最近的。 */
export function rowsFor(steps, {running = false, start = 0} = {}) {
  const t0 = start || (steps.find((s) => s.at) || {}).at || 0;
  const list = steps.length > MAX_ROWS ? steps.slice(-MAX_ROWS) : steps;
  return {
    hidden: steps.length - list.length,
    rows: list.map((s, k) => ({...s, when: s.at && t0 ? clock(s.at - t0) : '', current: running && k === list.length - 1})),
  };
}

function callIdOf(row) {
  const host = row.closest('[data-message-id]');
  const m = host && /^tool:[^:]+:([^:]+)/.exec(host.dataset.messageId || '');
  if (m) return m[1];
  const tk = window.__pinkieToolKind;
  return tk && tk.rowCallId ? tk.rowCallId(row) : '';
}

/** 卡片里已经渲染的工具行 → 步骤 */
export function stepsOf(card, args = {}) {
  return [...card.querySelectorAll('.pinkie-process__rows .chat-tool-msg-summary')].map((row) => {
    const id = callIdOf(row), rec = (id && args[id]) || null, extra = row.querySelector('.cle-args');
    const label = clean(row.querySelector('.chat-tool-msg-summary__label')?.textContent).split('·')[0].trim();
    const text = clean((rec && rec.t) || extra?.textContent || row.querySelector('.chat-tool-msg-summary__names')?.textContent);
    return {label: label || '用了工具', text, mono: !!(rec ? rec.m : extra && extra.hasAttribute('data-mono')), at: (rec && rec.at) || 0};
  });
}

if (typeof document !== 'undefined' && document.addEventListener) install();

function install() {
  const stage = () => window.__cleStage || null;
  const cardOf = (summary) => summary.closest('details.pinkie-process');
  const running = (card) => card.hasAttribute('data-cle-run') && !card.hasAttribute('data-cle-ended');
  let pop = null, list = null, head = null, note = null, owner = null, refresh = 0, tip = null, tipT = 0;

  function style() {
    if (document.getElementById('cle-peek-style')) return;
    const s = document.createElement('style');
    s.id = 'cle-peek-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  if (document.head) style(); else document.addEventListener('DOMContentLoaded', style, {once: true});

  function build() {
    pop = document.createElement('div');
    pop.className = 'cle-peek';
    pop.id = 'cle-peek';
    pop.hidden = true;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', '本轮步骤');
    head = pop.appendChild(document.createElement('div'));
    head.className = 'cle-peek__head';
    head.append(document.createElement('b'), document.createElement('span'));
    list = pop.appendChild(document.createElement('ol'));
    list.className = 'cle-peek__list';
    note = pop.appendChild(document.createElement('div'));
    note.className = 'cle-peek__note';
    document.body.appendChild(pop);
  }

  // 头部：「本轮 6 步」+ 状态行上此刻写的话（正在执行 · 12 秒 / 完成 · 6 个步骤 · 用时 47 秒）
  function headline(summary, count) {
    const lab = summary.querySelector(':scope > .cle-status');
    const verb = clean(lab && lab.querySelector('b')?.textContent);
    const right = clean(lab && lab.querySelector('i')?.textContent), what = clean(lab && lab.querySelector('em')?.textContent);
    const live = running(cardOf(summary));
    return [count ? '本轮 ' + count + ' 步' : '本轮', [verb, live ? right : what || right].filter(Boolean).join(' · ')];
  }

  function render() {
    if (!pop || !owner) return;
    const card = cardOf(owner);
    if (!card || !card.isConnected || !owner.isConnected) return close(false);
    const st = stage(), live = running(card), steps = stepsOf(card, st ? st.args : {});
    const {rows, hidden} = rowsFor(steps, {running: live, start: live && st && st.run && st.run.on ? st.run.since : 0});
    const [title, line] = headline(owner, steps.length);
    head.firstChild.textContent = title;
    head.lastChild.textContent = line;
    const follow = list.scrollTop + list.clientHeight >= list.scrollHeight - 4, keep = list.scrollTop;
    list.textContent = '';
    for (const r of rows) {
      const li = document.createElement('li');
      if (r.current) li.setAttribute('data-current', '');
      const time = li.appendChild(document.createElement('time'));
      time.textContent = r.when;
      const l = li.appendChild(document.createElement('span'));
      l.className = 'l';
      l.textContent = r.label;
      const x = li.appendChild(document.createElement('span'));
      x.className = 'x';
      x.textContent = r.text;
      x.title = r.text;
      if (r.mono && r.text) x.setAttribute('data-mono', '');
      list.appendChild(li);
    }
    list.scrollTop = follow ? list.scrollHeight : keep;
    note.textContent = !rows.length ? (live ? '还没有用到工具，正在想' : '这一轮没有用到工具') : hidden ? '更早的 ' + hidden + ' 步没有列出来' : '';
    note.hidden = !note.textContent;
    place();
    clearTimeout(refresh);
    if (live) refresh = setTimeout(render, 1000);
  }

  function place() {
    const anchor = owner.querySelector(':scope > .cle-glyph') || owner, r = anchor.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return close(false);
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const up = r.bottom + 8 + h > innerHeight - 8 && r.top - 8 - h > 8;
    pop.style.left = Math.round(Math.min(Math.max(8, r.left - 6), innerWidth - w - 8)) + 'px';
    pop.style.top = Math.round(up ? r.top - 8 - h : r.bottom + 8) + 'px';
    pop.toggleAttribute('data-up', up);
  }

  function open(summary) {
    style();
    if (!pop) build();
    if (owner && owner !== summary) close(false);
    hideTip();
    owner = summary;
    summary.setAttribute('aria-expanded', 'true');
    summary.setAttribute('aria-controls', pop.id);
    pop.hidden = false;
    list.scrollTop = list.scrollHeight;
    render();
    const st = stage(), card = cardOf(summary);
    if (st && st.space && card && card.hasAttribute('data-cle-active')) st.space.ink?.poke?.();
  }

  function close(refocus) {
    clearTimeout(refresh);
    if (pop) pop.hidden = true;
    if (owner) {
      owner.setAttribute('aria-expanded', 'false');
      if (refocus && owner.isConnected) owner.focus({preventScroll: true});
    }
    owner = null;
  }

  function hideTip() { clearTimeout(tipT); if (tip) tip.hidden = true; }
  function showTip(glyph) {
    clearTimeout(tipT);
    tipT = setTimeout(() => {
      const summary = glyph.closest(SUMMARY), card = summary && cardOf(summary);
      if (!card || !glyph.matches(':hover') || (pop && !pop.hidden)) return;
      const steps = card.querySelectorAll('.pinkie-process__rows .chat-tool-msg-summary').length;
      const lab = summary.querySelector(':scope > .cle-status');
      const doing = clean([lab && lab.querySelector('b')?.textContent, lab && lab.querySelector('em')?.textContent].join(' '));
      if (!tip) {
        tip = document.body.appendChild(document.createElement('div'));
        tip.className = 'cle-peek-tip';
        tip.setAttribute('role', 'tooltip');
      }
      tip.textContent = running(card) ? (steps ? '第 ' + steps + ' 步 · ' : '') + doing : (steps ? steps + ' 个步骤 · ' : '') + '点开看本轮做了什么';
      tip.hidden = false;
      const r = glyph.getBoundingClientRect();
      tip.style.left = Math.round(Math.min(Math.max(8, r.left - 4), innerWidth - tip.offsetWidth - 8)) + 'px';
      tip.style.top = Math.round(r.top - tip.offsetHeight - 6 < 8 ? r.bottom + 6 : r.top - tip.offsetHeight - 6) + 'px';
    }, 380);
  }

  document.addEventListener('click', (e) => {
    const summary = e.target.closest && e.target.closest(SUMMARY);
    if (summary && summary.querySelector(':scope > .cle-status')) {
      if (owner === summary && pop && !pop.hidden) close(false); else open(summary);
      return;
    }
    if (pop && !pop.hidden && !pop.contains(e.target)) close(false);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pop && !pop.hidden) { e.stopPropagation(); close(true); }
  }, true);
  document.addEventListener('pointerover', (e) => {
    const glyph = e.target.closest && e.target.closest(SUMMARY + ' > .cle-glyph');
    if (glyph && !glyph.contains(e.relatedTarget)) showTip(glyph);
  }, true);
  document.addEventListener('pointerout', (e) => {
    const glyph = e.target.closest && e.target.closest(SUMMARY + ' > .cle-glyph');
    if (glyph && !glyph.contains(e.relatedTarget)) hideTip();
  }, true);
  const follow = () => { hideTip(); if (pop && !pop.hidden && owner) place(); };
  window.addEventListener('scroll', follow, {capture: true, passive: true});
  window.addEventListener('resize', follow, {passive: true});
  window.addEventListener('pinkie:session-selected', () => { hideTip(); close(false); });
}
