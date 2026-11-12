/* 分工 · 把「碧琪分头在忙」安静地标出来。
 *
 * 聊天是干活的地方：平时外表克制，只有一行细线画的小符号；手放上去、点下去时回应才丰富。
 *
 * 父会话开了子会话（同一个模式里的，或者开到别的模式里的），输入框上方出现一条细线，线上一串小圆：
 *   运行中 → 一段弧沿着圆慢慢走；等你回复 → 圆心一个琥珀色的点；
 *   做完   → 圆画满、里面描出一个对勾（只在刚做完时描一次）；出错 → 虚线圆加一个叉。
 * 平时不显示名字（等你回复的那个除外，因为它需要你）。
 * 悬停或聚焦：那个圆展开成一小条，写出名字、在哪个模式、什么状态，弧走得快一点；按下有回弹。
 * 点了就去那个会话（别的模式会带你切过去）。全部回来后停留片刻自己收起。
 *
 * 符号全部是内联 SVG，不用图片。数据来自 laolao-session-cards.js 已经在取的那一份，
 * 这里不发任何请求、不开定时轮询、不开观察器。没有子会话在跑时什么都不画。
 *
 * 对外：window.PinkieCrew = {render(composer, family), summarize(family), clear()}
 *   family: [{key, title, mode, status}]，status 是 running | waiting | done | error。 */
(() => {
  'use strict';
  if (window.PinkieCrew) return;
  const MODES = {
    chat: {name: '唠嗑模式'}, project: {name: '项目模式'}, ideas: {name: '想法模式'}, learning: {name: '学习模式'},
  };
  const STATUS = {running: '正在忙', waiting: '等你回复', done: '做完了', error: '出错了'};
  const MAX = 5, LINGER_MS = 6000; // 五只：再多就伸到趴在输入框右上角的小碧琪身子底下了

  // 只在有人还没回来、或者刚刚全部回来时才出现；排在前面的是还在忙的。
  function summarize(family) {
    const rows = (Array.isArray(family) ? family : []).filter(row => row && row.key && STATUS[row.status]);
    const busy = rows.filter(row => row.status === 'running' || row.status === 'waiting');
    const order = {waiting: 0, running: 1, error: 2, done: 3};
    const shown = [...rows].sort((a, b) => order[a.status] - order[b.status]).slice(0, MAX);
    const back = rows.length - busy.length;
    const label = !rows.length ? ''
      : busy.length ? (back ? `碧琪分头在忙 · ${back}/${rows.length} 回来了` : `碧琪分成 ${rows.length} 路在忙`)
      : `${rows.length} 路都回来啦`;
    return {rows: shown, busy: busy.length, total: rows.length, hidden: rows.length - shown.length, label,
      waiting: busy.filter(row => row.status === 'waiting').length};
  }

  if (typeof document === 'undefined') { window.PinkieCrew = {summarize, render() {}, clear() {}}; return; }

  const el = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const reduced = () => Boolean(window.__pinkieMotion?.reduce);
  let strip = null, lastSignature = '', lingerTimer = 0, seen = new Map();

  function clear() {
    clearTimeout(lingerTimer); lingerTimer = 0;
    strip?.remove(); strip = null; lastSignature = '';
  }

  // 一个 20×20 的线条符号：底圈、状态弧、状态记号。全部用 currentColor 和一个强调色。
  const SVG = 'http://www.w3.org/2000/svg';
  const MARKS = {done: 'M6.4 10.4l2.4 2.4 4.8-5.2', error: 'M7.4 7.4l5.2 5.2M12.6 7.4l-5.2 5.2'};
  function shape(tag, className, attrs) {
    const node = document.createElementNS(SVG, tag);
    node.setAttribute('class', className);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  }
  function glyph(status) {
    const svg = shape('svg', 'pinkie-crew__glyph', {viewBox: '0 0 20 20', 'aria-hidden': 'true'});
    const circle = {cx: 10, cy: 10, r: 7, pathLength: 100};
    svg.append(shape('circle', 'pinkie-crew__track', circle), shape('circle', 'pinkie-crew__arc', circle));
    if (status === 'waiting' || status === 'running') svg.append(shape('circle', 'pinkie-crew__core', {cx: 10, cy: 10, r: status === 'waiting' ? 2.6 : 1.4}));
    if (MARKS[status]) svg.append(shape('path', 'pinkie-crew__mark', {d: MARKS[status], pathLength: 100}));
    return svg;
  }

  function token(row, previous) {
    const mode = MODES[row.mode] || MODES.chat;
    const button = el('button', 'pinkie-crew__one pinkie-crew__one--' + row.status);
    button.type = 'button';
    button.dataset.mode = row.mode in MODES ? row.mode : 'chat';
    const title = row.title || '子会话';
    const tip = `${title} · ${mode.name} · ${STATUS[row.status]}`;
    button.setAttribute('aria-label', tip);
    button.dataset.pinkieTooltip = tip;
    button.onclick = () => window.dispatchEvent(new CustomEvent('pinkie:open-session-in-mode', {detail: {sessionKey: row.key}}));
    // 刚从「在忙」变成「做完」：圆和对勾描一次。之前就做完的不重放。
    if (row.status === 'done' && previous && previous !== 'done' && !reduced()) button.classList.add('is-fresh');
    const text = el('span', 'pinkie-crew__text');
    text.append(el('span', 'pinkie-crew__name', title), el('span', 'pinkie-crew__where', mode.name + ' · ' + STATUS[row.status]));
    button.append(glyph(row.status), text);
    return button;
  }

  function render(composer, family, sessionKey = '') {
    const summary = summarize(family);
    if (!composer?.parentElement || !summary.total) { clear(); if (!summary.total) seen = new Map(); return summary; }
    const signature = JSON.stringify([sessionKey, summary.rows.map(row => [row.key, row.status, row.title, row.mode]), summary.total]);
    const allBack = summary.busy === 0;
    // 进到一个早就全部做完的会话：不翻旧账，不出现。
    const hadBusy = [...seen.values()].some(status => status === 'running' || status === 'waiting');
    if (allBack && !hadBusy && !strip) { seen = new Map(summary.rows.map(row => [row.key, row.status])); return summary; }
    if (signature !== lastSignature || !strip?.isConnected) {
      lastSignature = signature;
      if (!strip) { strip = el('div', 'pinkie-crew'); strip.setAttribute('role', 'group'); }
      strip.setAttribute('aria-label', summary.label);
      strip.classList.toggle('is-all-back', allBack);
      const label = el('span', 'pinkie-crew__label', summary.label);
      const row = el('span', 'pinkie-crew__row');
      for (const item of summary.rows) row.append(token(item, seen.get(item.key)));
      if (summary.hidden) row.append(el('span', 'pinkie-crew__more', '+' + summary.hidden));
      strip.replaceChildren(label, row);
      if (strip.parentElement !== composer.parentElement || strip.nextElementSibling !== composer) composer.before(strip);
      seen = new Map(summary.rows.map(item => [item.key, item.status]));
    }
    clearTimeout(lingerTimer); lingerTimer = 0;
    if (allBack) {
      lingerTimer = setTimeout(() => { strip?.classList.add('is-leaving'); lingerTimer = setTimeout(clear, 600); }, LINGER_MS);
    }
    return summary;
  }

  window.PinkieCrew = {render, summarize, clear};
})();
