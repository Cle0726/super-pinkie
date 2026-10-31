// 功能与连接：记忆、定时任务、连接器、本机用量，以及原 App 的空间与演示入口。
// 这一层只负责入口、编排和降级：被移植模块自己的行为留在各自的脚本里，
// 桥接样式集中在 bridge.css，避免在末尾再堆一层高优先级覆盖。
const S = 'cle-utilities';

// 线性图标，和原生 footer 的 16px / 1.5px 描边保持一致。
const ICONS = {
  tools: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  memory: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5h9.5A2.5 2.5 0 0 1 18 7v12.5H8.5A2.5 2.5 0 0 1 6 17z"/><path d="M9 4.5v15M11.5 9h4M11.5 12.5h4"/></svg>',
};

export function mountUtilities(host, signal) {
  // 热重载会让插件再次 activate：旧实例已经清掉，但它的按钮可能还挂在原生 footer 上
  // （原生 Lit 重渲染时不会带走外来节点）。先摘掉孤儿，否则 footer 里会出现两个入口。
  for (const stale of document.querySelectorAll('.cle-utilities-entry, .cle-utilities-layer')) stale.remove();
  const node = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    return el;
  };
  const glyph = (name, cls = '') => {
    const el = node('span', `${S}__glyph${cls ? ' ' + cls : ''}`);
    el.innerHTML = ICONS[name];           // 常量 SVG，不拼接任何外部数据
    el.setAttribute('aria-hidden', 'true');
    return el;
  };

  /* ── footer 入口：和原生图标同尺寸，不再是一个文字按钮 ── */
  const button = node('button', `${S}-entry sidebar-footer-icon`);
  button.type = 'button';
  button.title = '功能与连接：记忆、定时任务、连接器、用量';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.append(glyph('tools'));

  const layer = node('div', `${S}-layer`);
  layer.hidden = true;
  const panel = node('section', S);
  panel.id = S;
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', '功能与连接');

  const head = node('header', `${S}__head`);
  const titles = node('div', `${S}__titles`);
  titles.append(node('strong', '', '功能与连接'), node('span', `${S}__sub`, '记忆、定时任务、连接器与本机用量'));
  const closeButton = node('button', `${S}__close`);
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '关闭功能面板');
  closeButton.append(glyph('close'));
  head.append(titles, closeButton);

  // 唯一的异步反馈出口：读屏会播报，视觉上是面板顶部一行提示。
  const status = node('p', `${S}__status`);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  const say = (text, state = '') => {
    status.textContent = text || '';
    status.dataset.state = state;
    status.hidden = !text;
  };

  const scroll = node('div', 'pinkie-user-settings__scroll');

  /* ── 记忆 ── */
  const memory = node('button', `${S}__row`);
  memory.type = 'button';
  const memoryCopy = node('span', `${S}__row-copy`);
  memoryCopy.append(
    node('b', '', '当前模式的独立记忆'),
    node('small', '', '按模式物理隔离，不会串到别的模式'),
  );
  memory.append(glyph('memory'), memoryCopy);

  /* ── 空间：原生桥优先，普通网页里保留可点的地址并说明区别 ── */
  const hasBridge = (name) => typeof window.webkit?.messageHandlers?.[name]?.postMessage === 'function';
  const space = node('section', `${S}__group`);
  space.setAttribute('aria-label', '原 App 的空间');
  space.append(node('h3', `${S}__group-title`, '空间'));
  const spaceRow = node('div', `${S}__actions`);
  for (const [label, port, handler, note] of [
    ['派对空间', 18889, 'laolaoParty', '和碧琪的几个分身一起聊'],
    ['灵感圆桌', 18891, 'laolaoRoundtable', '让几个模型互相接话'],
  ]) {
    const link = node('a', `${S}__action`, label);
    link.href = `http://127.0.0.1:${port}/`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.dataset.native = hasBridge(handler) ? '1' : '0';
    link.title = hasBridge(handler) ? `${note}（在 App 里打开）` : `${note}（在新标签页打开，需要 App 内置服务正在运行）`;
    link.addEventListener('click', event => {
      const bridge = window.webkit?.messageHandlers?.[handler];
      if (typeof bridge?.postMessage === 'function') {
        event.preventDefault();
        bridge.postMessage({action: 'open'});
        close(false);
        return;
      }
      // 没有原生桥：如实说明这是网页标签，而不是假装空间已经打开。
      say('网页里会在新标签页打开。若打不开，说明 App 内置服务没有运行。', 'warn');
    });
    spaceRow.append(link);
  }
  space.append(spaceRow);
  if (!hasBridge('laolaoParty') && !hasBridge('laolaoRoundtable')) {
    space.append(node('p', `${S}__hint`, '当前是网页环境，没有 App 的原生桥，空间会在新标签页打开。'));
  }

  /* ── 演示工具 ── */
  const demo = node('section', `${S}__group`);
  demo.setAttribute('aria-label', '演示工具');
  demo.append(
    node('h3', `${S}__group-title`, '演示'),
    node('p', `${S}__hint`, '激光笔、画笔、荧光笔、聚光灯、放大镜；快捷键 1-5 切换，⌘Z 撤销。'),
  );
  const presentation = node('button', `${S}__action`, '打开演示工具');
  presentation.type = 'button';
  presentation.addEventListener('click', () => {
    const laser = window.__laolaoLaser;
    if (typeof laser?.toggle !== 'function') {
      say('演示工具还在加载，稍等一下再点。', 'warn');
      presentation.disabled = true;
      setTimeout(() => { presentation.disabled = false; }, 900);
      return;
    }
    say('');
    close(false);
    laser.toggle();
  });
  demo.append(presentation);

  /* ── 本机用量 ── */
  const usage = node('section', `${S}__usage`);
  usage.setAttribute('aria-label', '本机用量统计');
  usage.append(node('h3', `${S}__group-title`, '本机用量'), node('p', `${S}__hint`, '沿用原 App 的累计统计，费用显示为估算。'));
  const usageNote = node('p', `${S}__hint`);
  usageNote.hidden = true;

  /* ── 被移植的卡片：定时任务、连接器 ── */
  const cards = node('div', `${S}__cards`);
  const cardsNote = node('p', `${S}__hint`);
  cardsNote.hidden = true;

  scroll.append(memory, space, demo, usage, usageNote, cards, cardsNote);
  panel.append(head, status, scroll);
  layer.append(panel);
  document.body.append(layer);

  let previousFocus = null;
  let capabilityTimer = 0;
  let capabilityTries = 0;
  let usageTimer = 0;
  let usageTries = 0;

  const stopTimers = () => {
    clearTimeout(capabilityTimer); capabilityTimer = 0;
    clearTimeout(usageTimer); usageTimer = 0;
  };

  // 移植模块是异步、按顺序加载的：面板早于它们打开时必须稍后重试，
  // 否则这一次会话里「定时任务 / 连接器」会永久缺失且没有任何解释。
  function ensureCapabilities() {
    clearTimeout(capabilityTimer); capabilityTimer = 0;
    const api = window.__pinkieCapabilities;
    if (typeof api?.mount === 'function') {
      // 移植卡片自己只在第一次挂载时读数据（内部有 loaded 闸门），
      // 所以每次重新打开面板都重建容器，否则用户会看到上一次的定时任务与连接器状态。
      if (cards.childElementCount) cards.replaceChildren();
      try { api.mount(cards); } catch (error) { console.error('[cle] utilities: capabilities mount failed', error); }
      const mounted = !!cards.querySelector('#pinkie-connectors');
      cardsNote.hidden = mounted;
      if (mounted) { cardsNote.textContent = ''; capabilityTries = 0; return; }
    }
    if (capabilityTries >= 10) {
      cardsNote.textContent = '定时任务和连接器没能加载，关掉这个面板再打开试一次。';
      cardsNote.hidden = false;
      return;
    }
    cardsNote.textContent = '定时任务和连接器正在加载…';
    cardsNote.hidden = false;
    capabilityTries += 1;
    capabilityTimer = setTimeout(ensureCapabilities, 400);
  }

  function ensureUsage() {
    clearTimeout(usageTimer); usageTimer = 0;
    const api = window.__laolaoUsage;
    if (typeof api?.render === 'function') {
      try { api.render(); } catch (error) { console.error('[cle] utilities: usage render failed', error); }
      if (api.view) { usageNote.hidden = true; usageTries = 0; return; }
    }
    if (usageTries >= 10) {
      usageNote.textContent = '统计源暂时读不到，先不显示数字。';
      usageNote.hidden = false;
      return;
    }
    usageNote.textContent = '正在读取本机统计…';
    usageNote.hidden = false;
    usageTries += 1;
    usageTimer = setTimeout(ensureUsage, 400);
  }

  function close(restore = true) {
    if (layer.hidden) return;
    stopTimers();
    layer.hidden = panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (!restore) return;
    // macOS 上用鼠标点按钮不会让按钮获得焦点，此时的 activeElement 是 body；
    // 直接"还原"会把键盘用户丢到页面顶部，所以退回入口本身。
    const target = previousFocus?.isConnected && previousFocus !== document.body ? previousFocus : button;
    target.focus({preventScroll: true});
  }

  const open = () => {
    previousFocus = document.activeElement;
    capabilityTries = 0; usageTries = 0;
    say('');
    layer.hidden = panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    ensureCapabilities();
    ensureUsage();
    closeButton.focus({preventScroll: true});
  };

  memory.addEventListener('click', () => {
    const api = window.__clekkMemoryUI;
    if (typeof api?.open !== 'function') {
      say('记忆匣还没准备好，稍等一下再试。', 'warn');
      return;
    }
    close(false);
    api.open();
  });

  button.addEventListener('click', () => (layer.hidden ? open() : close()));
  closeButton.addEventListener('click', () => close());
  layer.addEventListener('pointerdown', event => { if (event.target === layer) close(); });
  document.addEventListener('keydown', event => {
    if (layer.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const elements = [...panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]')]
      .filter(el => !el.disabled && el.getClientRects().length);
    const first = elements[0], last = elements.at(-1);
    if (!first) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }, {signal});
  window.addEventListener('laolao:modechange', () => close(), {signal});
  window.addEventListener('popstate', () => close(), {signal});

  const mount = () => {
    const footer = document.querySelector('.sidebar-shell__footer .sidebar-footer-bar') || document.querySelector('.sidebar-shell__footer');
    if (footer && button.parentElement !== footer) footer.append(button);
  };
  mount();
  const interval = setInterval(mount, 1200);
  signal.addEventListener('abort', () => {
    clearInterval(interval);
    stopTimers();
    button.remove();
    layer.remove();
  }, {once: true});
  return {open, close};
}
