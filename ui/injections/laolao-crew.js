/* 分工气球 · 把「碧琪分头在忙」画出来。
 *
 * 父会话开了子会话（同一个模式里的，或者开到别的模式里的），输入框上方飘起一排气球：
 * 一只气球就是一个正在干活的碧琪，气球里是她在那个模式的脸，颜色跟着模式走。
 *   运行中 → 气球上下飘；等你回复 → 气球上挂个问号、轻轻扯线；
 *   做完   → 气球「啪」一下变成一份包好的礼物；出错 → 气球瘪下去。
 * 全部回来的那一刻撒一次彩带，过一会儿这一排自己收起来。点气球就去那个会话（别的模式会带你切过去）。
 *
 * 数据全部来自 laolao-session-cards.js 已经在取的那一份（血缘、卡片、会话状态），这里不发任何请求、
 * 不开定时轮询、不开观察器。没有子会话在跑时什么都不画。
 *
 * 对外：window.PinkieCrew = {render(composer, family), summarize(family), clear()}
 *   family: [{key, title, mode, status}]，status 是 running | waiting | done | error。 */
(() => {
  'use strict';
  if (window.PinkieCrew) return;
  const MODES = {
    chat: {name: '唠嗑模式', face: 'chat'},
    project: {name: '项目模式', face: 'project'},
    ideas: {name: '想法模式', face: 'thinking'},
    learning: {name: '学习模式', face: 'learning'},
  };
  const STATUS = {running: '正在忙', waiting: '等你回复', done: '做完了', error: '出错了'};
  const MAX = 5, LINGER_MS = 9000; // 五只：再多就伸到趴在输入框右上角的小碧琪身子底下了

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
  let strip = null, lastSignature = '', lingerTimer = 0, seen = new Map(), celebrated = '';

  function clear() {
    clearTimeout(lingerTimer); lingerTimer = 0;
    strip?.remove(); strip = null; lastSignature = '';
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
    const float = el('span', 'pinkie-crew__float');
    const balloon = el('span', 'pinkie-crew__balloon');
    const face = el('img', 'pinkie-crew__face');
    face.src = `/laolao-mode-${mode.face}-sm.png?v=sm1`; face.alt = ''; face.draggable = false; face.decoding = 'async';
    balloon.append(face, el('span', 'pinkie-crew__shine'));
    if (row.status === 'waiting') balloon.append(el('span', 'pinkie-crew__ask', '?'));
    if (row.status === 'done') balloon.append(el('span', 'pinkie-crew__bow'));
    float.append(balloon, el('span', 'pinkie-crew__string'));
    // 刚从「在忙」变成「做完」：放一次「啪」的小碎屑。之前就做完的不重放。
    if (row.status === 'done' && previous && previous !== 'done' && !reduced()) {
      button.classList.add('is-popping');
      for (let i = 0; i < 6; i += 1) { const bit = el('i', 'pinkie-crew__bit'); bit.style.setProperty('--i', String(i)); float.append(bit); }
    }
    button.append(float, el('span', 'pinkie-crew__name', title));
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
      const round = sessionKey + '|' + summary.rows.map(row => row.key).join(',');
      if (celebrated !== round) {
        celebrated = round;
        try { if (!reduced()) window.__pinkieBuddy?.burst?.('party'); } catch {}
      }
      lingerTimer = setTimeout(() => { strip?.classList.add('is-leaving'); lingerTimer = setTimeout(clear, 600); }, LINGER_MS);
    }
    return summary;
  }

  window.PinkieCrew = {render, summarize, clear};
})();
