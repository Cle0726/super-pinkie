/* 输入框下面的「工具箱」（一个礼物盒按钮）。
 *
 * 原来左边一排是：附件、网页 GPT、深度研究、回答风格、联网、拆分视图……每个模式再加自己的，挤成一串。
 * 现在每个模式都通用的那几样收进这一个按钮，点开才展开；模式专属的（项目的工作程度和项目文件夹、
 * 想法的取向、学习的资料和笔记、无限制的脱敏）照旧留在外面。
 *
 * 做法和侧栏底部的「更多」一样：原来的按钮一个都不删、不重做，只是用样式收起来，菜单里的每一行
 * 把点击转给原来的按钮，所以各自的状态、快捷键和后端调用都还是原来那一份。
 * 收起来的只是「在默认状态」的按钮：深度研究点亮了、网页 GPT 开着、联网关了、风格不是默认时，
 * 那一颗会自己回到输入框下面，让人一眼看到这个会话现在不是默认的（样式在 laolao-composer-tray.css）。
 *
 * 这个脚本没加载或者出错时，根节点上没有 data-pinkie-tray，界面和以前完全一样。 */
(() => {
  'use strict';
  if (window.__pinkieComposerTray) return;
  const root = document.documentElement;
  const svg = body => `<svg class="pinkie-ic" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  const ICON = {
    // 礼物盒：盒身和盖子是细线，蝴蝶结是粉的；悬停时盖子抬一下。
    tray: svg('<path d="M5.2 11.4h13.6v8.100H5.2z"/><path d="M12 11.4v8.100" opacity=".55"/>'
      + '<g class="pk-lid"><path d="M4 7.900h16v3.500H4z"/>'
      + '<path class="pk-a" d="M12 7.900c-1.500-3.300-5.200-3.400-5-1.300.2 1.500 3 1.600 5 1.300zM12 7.900c1.500-3.300 5.200-3.400 5-1.300-.2 1.500-3 1.600-5 1.300z"/></g>'),
    file: svg('<path d="M7 3.500h7l4 4v13H7z"/><path d="M14 3.500v4h4"/><path class="pk-a" d="M12 11v5.500M9.300 13.700h5.400"/>'),
    web: svg('<circle cx="12" cy="12" r="8"/><path d="M4 12h16" opacity=".6"/><path class="pk-a" d="M12 4c2.700 2.500 2.700 13.500 0 16"/><path d="M12 4c-2.700 2.500-2.700 13.500 0 16" opacity=".6"/>'),
    style: svg('<path d="M5 19.500l3.600-.8L19 8.300a1.900 1.900 0 0 0-2.700-2.700L5.900 16z"/><path class="pk-a" d="M14.600 7.300l2.700 2.700"/>'),
    research: svg('<circle cx="10.500" cy="10.500" r="6.200"/><path d="M15.300 15.300L20 20"/>'
      + '<path class="pk-f" d="M10.500 7.300c.3 1.900 1.100 2.700 3 3-1.900.3-2.700 1.100-3 3-.3-1.900-1.100-2.700-3-3 1.900-.3 2.700-1.100 3-3z"/>'),
    webgpt: svg('<rect x="3.500" y="5.500" width="17" height="12" rx="2.200"/><path d="M9 20.500h6"/><path class="pk-a" d="M8.500 11.500h3M14 11.500h1.500"/>'),
    split: svg('<rect x="3.500" y="5" width="17" height="14" rx="2.200"/><path class="pk-a" d="M12 5v14"/>'),
  };
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  // 每一行：在这个输入框里找原来的那颗按钮；找不到（这个模式或这个版本没有）就不出这一行。
  const ROWS = [
    {key: 'web', group: 'session', icon: ICON.web, name: '联网搜索', hint: '要最新信息时先搜再答',
      find: input => input.querySelector('.pinkie-chip--web'),
      state: node => ({kind: 'switch', on: node.getAttribute('aria-pressed') !== 'false'})},
    {key: 'style', group: 'session', icon: ICON.style, name: '回答风格', hint: '只管写法，不改做事的方式',
      find: input => input.querySelector('.pinkie-chip--style'),
      state: node => ({kind: 'value', value: text(node).replace(/^风格[:：]\s*/, '').replace(/\s*▾$/, '') || '默认'}), closes: true},
    {key: 'research', group: 'session', icon: ICON.research, name: '深度研究', hint: '下一条消息查资料，写成带来源的报告',
      find: input => input.querySelector('.laolao-research-btn'),
      state: node => ({kind: 'switch', on: node.classList.contains('is-on')})},
    {key: 'webgpt', group: 'session', icon: ICON.webgpt, name: '网页 GPT 协作', hint: '借你登录的网页 GPT 一起做',
      find: input => input.querySelector('.laolao-web-gpt-collab'),
      state: node => ({kind: 'switch', on: node.classList.contains('is-active')}),
      more: {label: '管理', title: '管理网页 GPT 协作', run: node => node.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true}))}},
    {key: 'split', group: 'window', icon: ICON.split, name: '拆分视图', hint: '两个会话并排放',
      find: input => input.querySelector('.chat-open-split-view'),
      state: node => ({kind: 'switch', on: node.getAttribute('aria-pressed') === 'true'}), closes: true},
  ];
  const GROUP_TITLE = {attach: '添加', session: '这个会话', window: '窗口'};

  let menu = null, anchor = null, timer = 0, signature = '';
  const inputOf = node => node?.closest?.('.agent-chat__input') || null;
  const attachOptions = input => [...(input?.querySelectorAll('.agent-chat__attach-menu-popover .agent-chat__attach-menu-option') || [])];
  const available = input => ROWS.map(row => ({row, node: row.find(input)})).filter(entry => entry.node);

  function close(restoreFocus = false) {
    if (!menu) return;
    window.clearInterval(timer); timer = 0;
    menu.remove(); menu = null; signature = '';
    anchor?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) anchor?.focus?.({preventScroll: true});
    anchor = null;
  }
  function place() {
    if (!menu || !anchor) return;
    if (!anchor.isConnected) { close(); return; }
    const rect = anchor.getBoundingClientRect();
    menu.style.left = Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))) + 'px';
    // 平时向上弹，压在输入框上方；首页的输入框在屏幕中间，上面放不下就向下弹，不盖住问候语。
    menu.style.maxHeight = '';
    const above = rect.top - 16, below = window.innerHeight - rect.bottom - 16, need = menu.offsetHeight;
    const down = need > above && below > above;
    menu.dataset.side = down ? 'down' : 'up';
    menu.style.top = down ? Math.round(rect.bottom + 8) + 'px' : '';
    menu.style.bottom = down ? '' : Math.round(window.innerHeight - rect.top + 8) + 'px';
    menu.style.maxHeight = Math.max(160, Math.round(down ? below : above)) + 'px';
  }
  function rowButton({icon, name, hint, state, more, disabled}, onClick) {
    const row = document.createElement('div');
    row.className = 'pinkie-tray__row';
    const main = document.createElement('button');
    main.type = 'button'; main.className = 'pinkie-tray__item'; main.disabled = Boolean(disabled);
    main.setAttribute('role', state?.kind === 'switch' ? 'menuitemcheckbox' : 'menuitem');
    if (state?.kind === 'switch') main.setAttribute('aria-checked', String(state.on));
    const glyph = document.createElement('span'); glyph.className = 'pinkie-tray__icon';
    if (typeof icon === 'string') glyph.innerHTML = icon; else if (icon) glyph.append(icon);
    const body = document.createElement('span'); body.className = 'pinkie-tray__body';
    const title = document.createElement('span'); title.className = 'pinkie-tray__name'; title.textContent = name;
    body.append(title);
    if (hint) { const sub = document.createElement('span'); sub.className = 'pinkie-tray__hint'; sub.textContent = hint; body.append(sub); }
    main.append(glyph, body);
    if (state?.kind === 'switch') { const knob = document.createElement('span'); knob.className = 'pinkie-tray__switch'; knob.setAttribute('aria-hidden', 'true'); main.append(knob); }
    if (state?.kind === 'value') { const value = document.createElement('span'); value.className = 'pinkie-tray__value'; value.textContent = state.value + ' ›'; main.append(value); }
    main.addEventListener('click', onClick);
    row.append(main);
    if (more) {
      const extra = document.createElement('button');
      extra.type = 'button'; extra.className = 'pinkie-tray__more'; extra.textContent = more.label;
      extra.title = more.title; extra.setAttribute('aria-label', more.title);
      extra.addEventListener('click', more.onClick);
      row.append(extra);
    }
    return row;
  }
  function render() {
    if (!menu || !anchor) return;
    const input = inputOf(anchor);
    if (!input) { close(); return; }
    const options = attachOptions(input), rows = available(input).map(entry => ({...entry, state: entry.row.state(entry.node)}));
    // 只在内容真的变了时重画，开着菜单的这段时间里焦点和悬停不会被打断。
    const next = JSON.stringify([options.map(text), rows.map(entry => [entry.row.key, entry.state, entry.node.disabled === true])]);
    if (next === signature) return;
    const focused = menu.contains(document.activeElement) ? document.activeElement.closest('.pinkie-tray__row')?.dataset.key : '';
    signature = next;
    const parts = [];
    const group = (name, children) => {
      if (!children.length) return;
      const section = document.createElement('div'); section.className = 'pinkie-tray__group'; section.setAttribute('role', 'group');
      const title = document.createElement('div'); title.className = 'pinkie-tray__title'; title.textContent = GROUP_TITLE[name];
      section.setAttribute('aria-label', GROUP_TITLE[name]);
      if (name === 'attach') { const tiles = document.createElement('div'); tiles.className = 'pinkie-tray__tiles'; tiles.append(...children); section.append(title, tiles); }
      else section.append(title, ...children);
      parts.push(section);
    };
    group('attach', options.map((option, index) => {
      const icon = option.querySelector('svg')?.cloneNode(true);
      icon?.setAttribute('aria-hidden', 'true');
      const row = rowButton({icon: icon || ICON.file, name: text(option) || '添加文件'}, () => { close(); option.click(); });
      row.dataset.key = 'attach-' + index;
      return row;
    }));
    for (const name of ['session', 'window']) {
      group(name, rows.filter(entry => entry.row.group === name).map(({row, node, state}) => {
        // 原按钮停用时（比如还没读到这个会话的设置），把它自己的说明当副标题，不只是灰掉。
        const why = node.disabled === true ? node.dataset.pinkieTooltip || node.getAttribute('aria-label') || '' : '';
        const item = rowButton({
          // 停用时不显示开关或「默认 ›」：那是没读到时的占位，不是这个会话真的设置。
          icon: row.icon, name: row.name, hint: why || row.hint, state: why ? null : state, disabled: node.disabled === true,
          more: row.more && {...row.more, onClick: () => { close(); row.more.run(node); }},
        }, () => {
          if (row.closes) close();
          node.click();
        });
        item.dataset.key = row.key;
        return item;
      }));
    }
    menu.replaceChildren(...parts);
    if (focused) menu.querySelector(`.pinkie-tray__row[data-key="${focused}"] .pinkie-tray__item`)?.focus?.({preventScroll: true});
    place();
  }
  function open(button, viaKeyboard) {
    close();
    anchor = button;
    menu = document.createElement('div');
    menu.className = 'pinkie-tray';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '工具箱');
    document.body.append(menu);
    button.setAttribute('aria-expanded', 'true');
    render();
    if (!menu.querySelector('.pinkie-tray__item')) { close(); return; }
    // 开关的状态是各自的脚本异步改的（要等后端回话），菜单开着时跟着看。
    timer = window.setInterval(render, 250);
    if (viaKeyboard) menu.querySelector('.pinkie-tray__item:not(:disabled)')?.focus?.({preventScroll: true});
  }
  function trayButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pinkie-tray-btn';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', '工具箱：附件、联网、回答风格、深度研究等');
    button.dataset.pinkieTooltip = '工具箱';
    button.innerHTML = ICON.tray + '<span>工具</span>';
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      if (menu && anchor === button) close(); else open(button, event.detail === 0);
    });
    return button;
  }
  function mount() {
    let mounted = false;
    for (const actions of document.querySelectorAll('.agent-chat__input .agent-chat__composer-actions')) {
      if (!actions.querySelector(':scope > .pinkie-tray-btn')) actions.prepend(trayButton());
      mounted = true;
    }
    // 标在根节点上：样式据此收起通用按钮。没有输入框的页面不标。
    if (mounted) root.setAttribute('data-pinkie-tray', '1'); else root.removeAttribute('data-pinkie-tray');
    if (menu && !anchor?.isConnected) close();
  }

  document.addEventListener('pointerdown', event => {
    if (!menu || menu.contains(event.target) || anchor?.contains(event.target)) return;
    close();
  }, true);
  document.addEventListener('keydown', event => {
    if (!menu) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...menu.querySelectorAll('.pinkie-tray__item:not(:disabled)')];
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus?.({preventScroll: true});
  }, true);
  window.addEventListener('resize', place);
  window.addEventListener('laolao:modechange', () => { close(); mount(); });
  window.addEventListener('pinkie:session-selected', () => close());
  window.addEventListener('pinkie:composer-chips', mount);
  window.setInterval(mount, 1000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once: true}); else mount();

  window.__pinkieComposerTray = {mount, close, rows: input => available(input).map(entry => ({key: entry.row.key, ...entry.row.state(entry.node)}))};
})();
