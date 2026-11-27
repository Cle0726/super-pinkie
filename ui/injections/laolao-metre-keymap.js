/* laolao-metre-keymap —— T3 #26（L38）：Metre 里的快捷键一览和实际按键对上，只在 Metre 生效。
 *
 * 1. 单按 ? 打开 / 收起快捷键一览（就是 ⌘/ · Ctrl+/ 打开的那张，laolao-artifacts.js openShortcuts）。
 *    焦点在输入框、编辑器里，或者开着模态弹层时不拦，? 照常是一个字。
 *    挂在 window 捕获阶段并 preventDefault：原生「打字就聚焦输入框」（chat-page handleDocumentKeydown，
 *    document 捕获阶段，先看 defaultPrevented）就不会把 ? 打进输入框。
 * 2. Windows / Linux 上 Ctrl+B 显示 / 隐藏侧栏：原生 openclaw-app-shell 的 ⌘B 只认 metaKey，
 *    表里写的 Ctrl+B 原来按了没反应。这里调同一个原生 toggleNavigationSurface()。
 *    工作台里的 Ctrl+B 仍是工作台自己的侧栏：工作台先拿到并 preventDefault，这里看到 defaultPrevented 就不动。
 * 3. 一览的内容：补上 K3（⌘/Ctrl+1…9、Ctrl+Tab，laolao-metre-workspace.js）、K2（Esc 停止 / 连按两下清空）、
 *    ? 本身；选了「Ctrl / ⌘ + Enter 发送」（I7，laolao-metre-prefs.js）时，发送 / 换行两行按偏好写。
 *    laolao-artifacts.js 画表前把 shortcutGroups() 交给这里的 groups()；不在 Metre 时原样返回同一个数组，
 *    其他五个模式的一览一个字不变。
 * 不开定时器、不开观察器、不加 window.__ 全局名：只挂在 window.Pinkie.metreKeymap。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.metreKeymap) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const isMac = /Mac|iPhone|iPad/i.test((window.navigator && window.navigator.platform) || '');
  // 和原生「打字就聚焦输入框」排除的那一组一致：这些地方 ? 是要打出来的字。
  const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="listbox"], [role="textbox"]';
  const EDITOR = '.monaco-editor, .monaco-diff-editor, .cm-editor, .pk-wb, .pk-wb-host, .pk-wb-quick, [data-workbench-editor]';
  const MODAL = 'dialog[open], [aria-modal="true"]';
  const SEND_KEY = 'pinkie.metre.prefs.sendKey';
  const k = (mac, win) => (isMac ? mac : win);
  const inside = (target, sel) => Boolean(target && typeof target.closest === 'function' && target.closest(sel));
  const sendKey = () => {
    try { return window.localStorage?.getItem(SEND_KEY) === 'modifier-enter' ? 'modifier-enter' : 'enter'; } catch { return 'enter'; }
  };

  // ---------- 1. ? 唤出一览 ----------
  function question(event) {
    if (!isMetre() || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return false;
    if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (inside(event.target, TYPING) || inside(event.target, EDITOR) || document.querySelector(MODAL)) return false;
    const open = window.PinkieArtifacts?.openShortcuts;
    if (typeof open !== 'function') return false;
    event.preventDefault();
    void open();
    return true;
  }

  // ---------- 2. Windows / Linux 的 Ctrl+B ----------
  function sidebar(event) {
    if (isMac || !isMetre() || event.defaultPrevented || event.repeat) return false;
    if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || String(event.key || '').toLowerCase() !== 'b') return false;
    if (inside(event.target, EDITOR)) return false;
    const shell = document.querySelector('openclaw-app-shell');
    if (typeof shell?.toggleNavigationSurface !== 'function') return false;
    event.preventDefault();
    shell.toggleNavigationSurface();
    return true;
  }

  // ---------- 3. 一览内容 ----------
  function groups(list) {
    if (!isMetre() || !Array.isArray(list)) return list;
    const swap = sendKey() === 'modifier-enter'
      ? {'发送': k('⌘Enter', 'Ctrl+Enter'), '换行': k('Enter · ⇧Enter', 'Enter · Shift+Enter')}
      : {};
    const extra = {
      '会话': [
        ['打开侧栏第 1–9 个会话', k('⌘1 … ⌘9', 'Ctrl+1 … Ctrl+9')],
        ['下一个 / 上一个会话', k('⌃Tab / ⌃⇧Tab', 'Ctrl+Tab / Ctrl+Shift+Tab')],
      ],
      '输入框': [['停止正在回答的这一轮', 'Esc'], ['清空输入框', 'Esc 连按两下']],
    };
    const key = (title, label, keys) => {
      if (title === '输入框' && Object.hasOwn(swap, label)) return swap[label];
      if (title === '全局' && label === '快捷键一览') return keys + ' · ?';
      return keys;
    };
    return list.map(([title, rows]) => [title, [
      ...rows.map(([label, keys]) => [label, key(title, label, keys)]),
      ...(extra[title] || []),
    ]]);
  }

  window.addEventListener('keydown', question, true);
  document.addEventListener('keydown', sidebar, false);

  ns.metreKeymap = Object.freeze({groups, question, sidebar});
})();
