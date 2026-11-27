// 底部输入框 ↑/↓ 翻历史（I3）：原生已经有输入历史（本会话发过的问题 + 本地记录，最多 100 条），
// 但按键处理在历史走一步之后只 preventDefault 并在下一帧还原光标，没有请求重画，
// 于是 state.chatMessage 已经换成历史那句，输入框里的字要等别的更新才跟上（↓ 回到草稿时同样卡住）。
// 这里在冒泡阶段补一次重画：原生已处理（defaultPrevented）、没按修饰键、不在输入法组字中，
// 且状态里的草稿和输入框的值不一样时，请聊天面板 requestUpdate。Lit 的更新走微任务，
// 早于原生还原光标的那一帧，所以光标仍落在原生想要的位置。不改原生逻辑，不挂全局名。
(() => {
  'use strict';

  const COMPOSER = '.agent-chat__composer-combobox textarea';

  function sync(event) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (!event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const input = event.target;
    if (!(input instanceof HTMLTextAreaElement) || !input.matches(COMPOSER)) return;
    const pane = input.closest('openclaw-chat-pane') || document.querySelector('openclaw-chat-pane');
    const draft = pane?.state?.chatMessage;
    if (typeof draft !== 'string' || draft === input.value) return;
    pane.state?.requestUpdate?.();
    pane.requestUpdate?.();
  }

  document.addEventListener('keydown', sync);
})();
