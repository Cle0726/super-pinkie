/* laolao-metre-minimap —— 界面吸收计划 T3 #4「时间线缩略条（小节线）」（#96 L32），只在 Metre 生效。
 *
 * 对话区右边一条竖着的细谱：你说的每一句话是一根小节线（第 N 小节），按它在整段对话里的位置排开；
 * 一段浅框是此刻屏幕上看得到的那一段，正在读的那一小节是钴蓝。
 * 点一根小节线跳到那一条提问（瞬时滚动：平滑滚动会被 laolao-perf.js 的位置恢复打断），
 * 焦点在小节线上时 ↑ / ↓ / Home / End 在小节之间走，Enter / 空格跳。
 * 少于 3 条提问、对话不用滚、首页、外部引擎台、窄窗工作台在「代码」页时整条不出。
 * 对话正文右边放不下缩略条时（窄窗），给对话区右边让出一条（html[data-pk-mmap="tight"]，只在 Metre 下有样式）。
 * 只读页面上已经画出来的对话：不调网关、不开定时器循环、不开 DOM 观察器、不加 window.__ 全局；
 * 重画挂在 Pinkie.domWatch、对话区滚动和窗口大小变化上，没变化不写 DOM。离开 Metre 整条拿掉，其他模式一个字不动。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.metreMinimap) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const MIN = 3;        // 少于 3 条提问不出
  const READ_AT = 0.3;  // 视口上方 30% 处算「正在读」
  const GAP = 3;        // 两根小节线至少隔 3px
  const W = 18;         // 缩略条宽度（和 laolao-metre-minimap.css 一致）
  const NEED = W + 8;   // 对话正文右边至少要空出的宽度
  const EXTRA = 30;     // 空不出来时给对话区右边加的内边距（css 里同一个数）
  const CLIP = 40;
  const el = (tag, cls) => { const node = document.createElement(tag); node.className = cls; return node; };
  const pane = () => document.querySelector('openclaw-chat-pane[active]') || document.querySelector('openclaw-chat-pane');
  function clip(text, n = CLIP) {
    const chars = [...String(text || '').replace(/\s+/g, ' ').trim()];
    return chars.length > n ? chars.slice(0, n).join('') + '…' : chars.join('');
  }
  const label = (text, index) => `第 ${index + 1} 小节` + (clip(text) ? ` · ${clip(text)}` : '');

  // ---------- 纯计算：每条提问在缩略条上的位置、正在读哪一小节、看得到的那一段 ----------
  // tops：每条提问在可滚动内容里的位置（px）；length：缩略条可用的高度。
  function layout({tops, scrollTop, clientHeight, scrollHeight, length}) {
    const total = Math.max(scrollHeight, clientHeight, 1);
    const span = Math.max(0, Math.round(length));
    const y = v => Math.round(Math.min(1, Math.max(0, v / total)) * span);
    const ticks = [];
    for (const top of tops) ticks.push(Math.min(span, Math.max(y(top), ticks.length ? ticks[ticks.length - 1] + GAP : 0)));
    let current = tops.length ? 0 : -1;
    if (tops.length && scrollTop + clientHeight >= total - 2) current = tops.length - 1;  // 读到底了：最后一小节
    else tops.forEach((top, i) => { if (top <= scrollTop + clientHeight * READ_AT) current = i; });
    const bandTop = y(scrollTop);
    return {ticks, current, band: {top: bandTop, height: Math.max(6, y(scrollTop + clientHeight) - bandTop)}};
  }

  // ---------- 画 ----------
  let rail = null, band = null, list = null, groups = [], last = '';
  const hooked = new WeakSet();
  const flashes = new WeakMap();
  function remove() {
    rail?.remove();
    rail = band = list = null; groups = []; last = '';
    if (root.dataset.pkMmap) delete root.dataset.pkMmap;
  }
  function blocked() {
    const d = root.dataset;
    return d.laolaoStartupHome === '1' || d.pkEngine === 'on' || (d.pkWbNarrow === '1' && d.pkWbView === 'code');
  }
  const userGroups = inner => [...inner.querySelectorAll('.chat-group.user')]
    .filter(g => !g.closest('.pinkie-session-cards') && g.getClientRects().length);
  const textOf = g => g.querySelector('.chat-bubble[data-message-text]')?.getAttribute('data-message-text') || g.textContent || '';

  function build() {
    rail = el('nav', 'pk-mmap');
    rail.setAttribute('aria-label', '对话小节：点一根小节线跳到那一条提问');
    band = el('div', 'pk-mmap__band');
    band.setAttribute('aria-hidden', 'true');
    list = el('div', 'pk-mmap__ticks');
    rail.append(band, list);
    rail.addEventListener('click', onClick);
    rail.addEventListener('keydown', onKey);
    document.body.append(rail);
  }

  function paint() {
    if (!isMetre()) { if (rail || root.dataset.pkMmap) remove(); return; }
    const p = pane();
    const thread = p?.querySelector('.chat-thread');
    const inner = thread?.querySelector('.chat-thread-inner');
    if (blocked() || !inner || !thread.getClientRects().length) { if (rail || root.dataset.pkMmap) remove(); return; }
    if (!hooked.has(thread)) { hooked.add(thread); thread.addEventListener('scroll', schedule, {passive: true}); }
    const found = userGroups(inner);
    if (found.length < MIN || thread.scrollHeight <= thread.clientHeight + 4) { if (rail || root.dataset.pkMmap) remove(); return; }

    const box = thread.getBoundingClientRect();
    const right = box.left + thread.clientLeft + thread.clientWidth;  // 滚动条左边
    // 放得下吗：按「没让位时」的空隙算，让过位以后不会来回跳
    const tight = root.dataset.pkMmap === 'tight';
    const natural = right - inner.getBoundingClientRect().right - (tight ? EXTRA : 0);
    if ((natural < NEED) !== tight) {
      if (tight) delete root.dataset.pkMmap; else root.dataset.pkMmap = 'tight';
      schedule();
      return;
    }

    const top0 = box.top + thread.clientTop + 12;
    let bottom = box.top + thread.clientTop + thread.clientHeight - 12;
    const input = p.querySelector('.agent-chat__input') || document.querySelector('.chat-main .agent-chat__input');
    const ir = input?.getClientRects().length ? input.getBoundingClientRect() : null;
    if (ir && ir.top > top0 && ir.top < bottom + 12) bottom = ir.top - 12;  // 输入框压在对话区下半截时，缩略条停在它上面
    const length = bottom - top0;
    if (length < 80) { if (rail) remove(); return; }

    const offset = thread.scrollTop - box.top - thread.clientTop;
    const tops = found.map(g => g.getBoundingClientRect().top + offset);
    const view = layout({tops, scrollTop: thread.scrollTop, clientHeight: thread.clientHeight, scrollHeight: thread.scrollHeight, length});
    const labels = found.map((g, i) => label(textOf(g), i));
    groups = found;
    const sig = [Math.round(right), Math.round(top0), Math.round(length), view.current, view.band.top, view.band.height, view.ticks.join(','), labels.join('\u0001')].join('|');
    if (sig === last && rail?.isConnected) return;
    last = sig;
    if (!rail?.isConnected) build();

    rail.style.left = Math.round(right - 4 - W) + 'px';
    rail.style.top = Math.round(top0) + 'px';
    rail.style.height = Math.round(length) + 'px';
    band.style.top = view.band.top + 'px';
    band.style.height = view.band.height + 'px';
    while (list.children.length < view.ticks.length) {
      const b = el('button', 'pk-mmap__tick');
      b.type = 'button';
      list.append(b);
    }
    while (list.children.length > view.ticks.length) list.lastElementChild.remove();
    view.ticks.forEach((y, i) => {
      const b = list.children[i];
      b.style.top = y + 'px';
      b.dataset.index = String(i);
      b.title = labels[i];
      b.setAttribute('aria-label', labels[i]);
      if (i === view.current) b.setAttribute('aria-current', 'location');
      else b.removeAttribute('aria-current');
    });
  }

  // ---------- 跳 ----------
  function jump(index) {
    const g = groups[index];
    if (!g?.isConnected) return false;
    g.scrollIntoView({block: 'start', behavior: 'auto'});
    g.setAttribute('data-pk-mmap-hit', '');
    clearTimeout(flashes.get(g));
    flashes.set(g, setTimeout(() => g.removeAttribute('data-pk-mmap-hit'), 1400));
    schedule();
    return true;
  }
  function onClick(event) {
    const tick = event.target.closest?.('.pk-mmap__tick');
    if (!tick) return;
    event.preventDefault();
    jump(Number(tick.dataset.index));
  }
  function onKey(event) {
    const tick = event.target.closest?.('.pk-mmap__tick');
    if (!tick || !list) return;
    const ticks = [...list.children];
    const i = ticks.indexOf(tick);
    const next = {ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: ticks.length - 1}[event.key];
    if (next === undefined) return;
    event.preventDefault();
    ticks[Math.max(0, Math.min(ticks.length - 1, next))]?.focus();
  }

  // ---------- 什么时候重画 ----------
  let frame = 0;
  const tick = () => { frame = 0; paint(); };
  function schedule() { if (!frame) frame = requestAnimationFrame(tick); }
  window.Pinkie?.domWatch?.watch('.chat-thread', schedule, {immediate: true, always: true});
  window.addEventListener('resize', schedule);
  window.addEventListener('laolao:modechange', schedule);
  window.addEventListener('pinkie:session-selected', schedule);

  ns.metreMinimap = Object.freeze({layout, label, paint: schedule, jump});
})();
