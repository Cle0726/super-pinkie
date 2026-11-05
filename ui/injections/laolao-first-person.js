/* 碧琪说话时，App 聊天窗口把第一人称「我」显示成「碧琪」。
 *
 * 外部渠道（飞书 / 微信 / QQ）由 services/first-person-renderer 和
 * mode-architecture 的 reply_payload_sending 在发出前替换；App 自己的聊天窗口
 * 直接渲染模型原文，不经过那两个钩子，所以在这里做显示层替换。所有模式共用
 * 同一个聊天页，这一个脚本就覆盖全部模式，外加学习台的独立对话框。
 *
 * 只改给人看的文字节点：会话记录、复制出去的原文、下一轮给模型的上下文都不变。
 * 只处理碧琪自己说的话：回复正文、过程卡里的说明句、思考块。用户消息、工具
 * 卡片与输出、代码、公式、输入框、文件名一律不碰。
 *
 * Lit 安全：只改文字节点的值，不动元素和 Lit 的注释标记；Lit 之后重写同一节点
 * 时会触发 characterData，再替换一次即可（替换结果幂等）。
 */
(() => {
  'use strict';
  if (window.__pinkieFirstPerson) return;

  // 与 services/mode-architecture/first-person.mjs 同一份规则（测试检查一致），见那里的说明。
  // --- first-person rules begin ---
  const KEEP_WORDS = ['唯我独尊', '唯我獨尊', '尔虞我诈', '爾虞我詐', '卿卿我我', '我行我素', '舍我其谁', '捨我其誰',
    '自我', '忘我', '无我', '無我', '本我', '超我', '敌我', '敵我', '我们', '我們'];
  const KEEP = new RegExp(KEEP_WORDS.join('|'), 'g');
  // 围栏代码块、行内代码、Markdown 链接地址、裸网址
  const PROTECTED = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|\]\([^)\s]*\)|https?:\/\/[^\s)）]+/g;

  const replacePlain = (text) => {
    let out = '', last = 0;
    for (const match of text.matchAll(KEEP)) {
      out += text.slice(last, match.index).replaceAll('我', '碧琪') + match[0];
      last = match.index + match[0].length;
    }
    return out + text.slice(last).replaceAll('我', '碧琪');
  };

  function renderFirstPerson(value) {
    if (typeof value !== 'string' || !value.includes('我')) return value;
    let out = '', last = 0;
    for (const match of value.matchAll(PROTECTED)) {
      out += replacePlain(value.slice(last, match.index)) + match[0];
      last = match.index + match[0].length;
    }
    return out + replacePlain(value.slice(last));
  }
  // --- first-person rules end ---

  // 碧琪说的话所在的区域：主聊天的助手消息组（含过程卡里的说明句和思考块），
  // 以及学习台独立对话框里的助手消息。
  // 时间线把工具之间的说明句放进工具组里的 .chat-timeline-text-row，那也是碧琪在说话。
  const SPEECH = '.chat-group.assistant, .chat-timeline-text-row';
  const TOOL_GROUP = '.chat-group.tool';
  // 这些地方的字不是碧琪在说话，或改了会出错：工具卡片与输出、代码、公式、
  // 输入控件、附件卡片、状态行（由其他脚本按原值比对维护）、发送者名字。
  const SKIP = [
    'pre', 'code', 'kbd', 'samp', 'textarea', 'input', 'select', 'option', 'script', 'style',
    '[contenteditable="true"]', '[contenteditable=""]', '.katex', 'math', 'svg', '.cm-editor', '.cm-preview',
    '.chat-tool-card', '.chat-tool-msg-summary', '.chat-timeline-tool-row',
    '.chat-assistant-attachment-card', '.chat-sender-name', '.cle-status', '.cle-args', '.cle-run',
    '[data-pinkie-first-person="off"]',
  ].join(', ');
  // 链接文字如果本身是路径、文件名或网址，保持原样，免得和真实文件对不上。
  const PATHLIKE = /[\\/]|\.[A-Za-z0-9]{1,6}$|^https?:/;

  const speaks = (node) => {
    const parent = node.parentElement;
    if (!parent || !parent.closest(SPEECH) || parent.closest(SKIP)) return false;
    // 工具组（含过程卡里的工具步骤）只放行其中的说明句行。
    if (parent.closest(TOOL_GROUP) && !parent.closest('.chat-timeline-text-row')) return false;
    const link = parent.closest('a');
    if (link && PATHLIKE.test((link.textContent || '').trim())) return false;
    return true;
  };

  const renderText = (node) => {
    const value = node.nodeValue;
    if (!value || !value.includes('我') || !speaks(node)) return;
    const next = renderFirstPerson(value);
    if (next !== value) node.nodeValue = next;
  };

  const renderTree = (root) => {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) { renderText(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    // 大多数新增子树（工具输出、侧栏、设置）里没有「我」，先用 textContent 判断，免得逐个走文字节点。
    if (!(root.textContent || '').includes('我')) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) renderText(node);
  };

  const threadRoot = () => document.querySelector('openclaw-app') || document.querySelector('#openclaw-mount-fallback');

  const watch = (root) => {
    if (!root || root.dataset.pinkieFirstPersonWatch === '1') return false;
    root.dataset.pinkieFirstPersonWatch = '1';
    renderTree(root);
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') renderText(record.target);
        else for (const node of record.addedNodes) renderTree(node);
      }
    }).observe(root, {childList: true, characterData: true, subtree: true});
    return true;
  };

  const start = () => {
    if (!watch(threadRoot())) {
      // openclaw-app 还没挂上时等它出现（只看 body 的直接子节点，不做全页扫描）。
      const waiter = new MutationObserver(() => { if (watch(threadRoot())) waiter.disconnect(); });
      waiter.observe(document.body, {childList: true});
    }
    // 学习台独立对话框挂在 body 上、不在 openclaw-app 里；它每次整块重绘后会发这个事件。
    window.addEventListener('pinkie:desk-conversation-rendered', () => {
      renderTree(document.getElementById('pinkie-desk-chat'));
    });
    renderTree(document.getElementById('pinkie-desk-chat'));
  };

  window.__pinkieFirstPerson = {render: renderFirstPerson, renderTree};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();
})();
