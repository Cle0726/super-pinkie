// A home for the existing capability cards, using their original RPCs and forms.
// This does not replace the native settings page or change permissions.
export function mountUtilities(host, signal) {
  const node = (tag, cls, text) => {
    const el = document.createElement(tag);
    el.className = cls;
    if (text) el.textContent = text;
    return el;
  };
  const button = node('button', 'cle-utilities-entry', '功能');
  button.type = 'button';
  button.title = '记忆、定时任务、连接器和用量';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  const layer = node('div', 'cle-utilities-layer');
  layer.hidden = true;
  const panel = node('section', 'cle-utilities');
  panel.id = 'cle-utilities';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', '功能与连接');
  const head = node('header', 'cle-utilities__head');
  const closeButton = node('button', 'cle-utilities__close', '×');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '关闭功能面板');
  head.append(node('strong', '', '功能与连接'), closeButton);
  const scroll = node('div', 'pinkie-user-settings__scroll');
  const memory = node('button', 'cle-utilities__memory', '当前模式的独立记忆');
  memory.type = 'button';
  memory.addEventListener('click', () => { close(false); window.__clekkMemoryUI?.open(); });
  const usage = node('section', 'cle-utilities__usage');
  usage.setAttribute('aria-label', '本机用量统计');
  usage.append(node('h3', '', '本机用量'), node('p', '', '沿用原 App 的累计统计，费用显示为估算。'));
  const cards = node('div', 'cle-utilities__cards');
  const shortcuts = node('section', 'cle-utilities__shortcuts');
  shortcuts.setAttribute('aria-label', '原 App 的空间与演示工具');
  shortcuts.append(node('h3', '', '空间与演示'));
  for (const [label, port, handler] of [['派对空间', 18889, 'laolaoParty'], ['灵感圆桌', 18891, 'laolaoRoundtable']]) {
    const link = node('a', 'cle-utilities__shortcut', label);
    link.href = `http://127.0.0.1:${port}/`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.addEventListener('click', event => {
      const bridge = window.webkit?.messageHandlers?.[handler];
      if (bridge) { event.preventDefault(); bridge.postMessage({action: 'open'}); close(false); }
    });
    shortcuts.append(link);
  }
  const presentation = node('button', 'cle-utilities__shortcut', '演示工具：激光笔、画笔、荧光笔、聚光灯、放大镜');
  presentation.type = 'button';
  const presentationLabel = presentation.textContent;
  presentation.addEventListener('click', () => {
    if (!window.__laolaoLaser?.toggle) { presentation.textContent = '演示工具正在加载，请稍后重试'; return; }
    presentation.textContent = presentationLabel;
    close(false);
    window.__laolaoLaser.toggle();
  });
  shortcuts.append(presentation);
  scroll.append(memory, shortcuts, usage, cards);
  panel.append(head, scroll);
  layer.append(panel);
  document.body.append(layer);
  let previousFocus = null;
  function close(restore = true) {
    if (layer.hidden) return;
    layer.hidden = panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restore && previousFocus?.isConnected) previousFocus.focus({preventScroll: true});
  }
  const open = () => {
    previousFocus = document.activeElement;
    layer.hidden = panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    window.__pinkieCapabilities?.mount(cards);
    window.__laolaoUsage?.render();
    closeButton.focus({preventScroll: true});
  };
  button.addEventListener('click', () => layer.hidden ? open() : close());
  closeButton.addEventListener('click', () => close());
  layer.addEventListener('pointerdown', event => { if (event.target === layer) close(); });
  document.addEventListener('keydown', event => {
    if (layer.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const elements = [...panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }, {signal});
  window.addEventListener('laolao:modechange', () => close(), {signal});
  const mount = () => {
    const footer = document.querySelector('.sidebar-shell__footer .sidebar-footer-bar') || document.querySelector('.sidebar-shell__footer');
    if (footer && button.parentElement !== footer) footer.append(button);
  };
  mount();
  const interval = setInterval(mount, 1200);
  signal.addEventListener('abort', () => { clearInterval(interval); button.remove(); layer.remove(); }, {once: true});
  return {open, close};
}
