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
    '时不我待', '時不我待', '我见犹怜', '我見猶憐', '依然故我', '我思故我在', '人不犯我', '我不犯人', '你死我活', '你情我愿', '你來我往', '你来我往',
    '自我', '忘我', '无我', '無我', '本我', '超我', '真我', '非我', '大我', '小我', '物我', '我执', '我執', '敌我', '敵我', '你我', '我们', '我們', '我俩', '我倆', '我辈', '我輩',
    // 「我国、我方」这类里的「我」是「我们这边」，不是碧琪自己
    '我国(?!庆)', '我國(?!慶)', '我方(?![案法便向式才面])', '我军', '我軍', '我党', '我黨', '我省(?=[的各内]|[\\s，。；：！？、]|$)', '我市(?=[的各内]|[\\s，。；：！？、]|$)', '我县', '我縣', '我校(?![对验正准])', '我院', '我司', '我局(?![限部])', '我厂', '我廠', '我单位', '我公司',
    // 系统和软件里的名字，改了用户就找不到了
    '我的电脑', '我的電腦', '我的文档', '我的文檔', '我的图片', '我的音乐', '我的视频', '我的下载', '我的收藏', '我的订单', '我的訂單', '我的主页', '我的账户', '我的帐户', '我的钱包', '我的关注', '我的云盘'];
  const KEEP = new RegExp(KEEP_WORDS.join('|'), 'g');
  const STOP = '\\s，。；：！？、「」『』“”（）()';
  // 这些地方的字不是碧琪在说自己，原样留着（留着「我」只是不够可爱，换错了会把意思说错）：
  // 围栏代码块、行内代码、Markdown 链接地址、裸网址；
  // 引用行（> 开头）和两条分隔线之间的整段——那是替用户起草的稿子或转述别人的话；
  // 各种引号里的话——按钮名、用户的原话、起草的句子；
  // 路径和文件名（「我的简历.docx」改了就和真实文件对不上）。
  const PROTECTED = new RegExp([
    '```[\\s\\S]*?(?:```|$)', '~~~[\\s\\S]*?(?:~~~|$)', '`[^`\\n]*`', '\\]\\([^)\\s]*\\)', 'https?:\\/\\/[^\\s)）]+',
    '^[ \\t]*>[^\\n]*',
    '^[ \\t]*(?:-{3,}|\\*{3,}|_{3,})[ \\t]*\\n[\\s\\S]*?\\n[ \\t]*(?:-{3,}|\\*{3,}|_{3,})[ \\t]*$',
    '「[^」\\n]{0,200}」', '『[^』\\n]{0,200}』', '“[^”\\n]{0,200}”', '‘[^’\\n]{0,200}’', '"[^"\\n]{0,200}"',
    `(?:~|\\.{1,2})?[\\\\/][^${STOP}]+`, `[A-Za-z]:\\\\[^${STOP}]*`,
    `我[^${STOP}/\\\\]{0,30}\\.[A-Za-z][A-Za-z0-9]{1,5}(?![A-Za-z0-9])`,
  ].join('|'), 'gm');
  // 这一行是在替用户写第一人称的自我介绍（「大家好，我叫小王」「我是一名设计师」），整行不动。
  const SPOKEN_FOR_USER = /我叫(?!碧琪)|我是(?:一名|一位|来自)/;

  // 同一句话里已经说过一次「碧琪」，逗号后面紧跟着的主语「我」就省掉：
  // 「我看了一下，我觉得可以」读成「碧琪看了一下，觉得可以」，不是一句里连着两三个「碧琪」。
  // 只在不会改变意思的时候省：中间没有换人（你 / 他 / 她），后面不是「我的 / 我这边」这类。
  const SENTENCE_END = '。！？!?；;';
  const OTHER_PERSON = '你您他她它';
  const NOT_SUBJECT = '的们們这這那俩倆';
  const replaceLine = (text) => {
    if (SPOKEN_FOR_USER.test(text)) return text;
    const kept = new Map();
    for (const match of text.matchAll(KEEP)) kept.set(match.index, match[0]);
    let out = '', said = false;
    for (let i = 0; i < text.length; i += 1) {
      const word = kept.get(i);
      if (word) { out += word; i += word.length - 1; said = false; continue; }
      const ch = text[i];
      if (ch !== '我') {
        if (SENTENCE_END.includes(ch) || OTHER_PERSON.includes(ch)) said = false;
        out += ch;
        continue;
      }
      const next = text[i + 1] || '';
      const subject = next && !NOT_SUBJECT.includes(next);
      if (said && subject && /[，,]\s*$/.test(out)) continue;
      out += '碧琪';
      if (subject) said = true;
    }
    return out;
  };
  const replacePlain = (text) => text.split('\n').map(replaceLine).join('\n');

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
    // 引用块是替用户起草的稿子或别人的话；按钮上的字是用户点了要发出去的话（「帮我改成暗色」）。
    'blockquote', 'button', '[role="button"]',
    '[contenteditable="true"]', '[contenteditable=""]', '.katex', 'math', 'svg', '.cm-editor', '.cm-preview',
    '.chat-tool-card', '.chat-tool-msg-summary', '.chat-timeline-tool-row',
    '.chat-assistant-attachment-card', '.chat-sender-name', '.cle-status', '.cle-args', '.cle-run',
    '[data-pinkie-first-person="off"]',
  ].join(', ');
  // 链接文字如果本身是路径、文件名或网址，保持原样，免得和真实文件对不上。
  const PATHLIKE = /[\\/]|\.[A-Za-z0-9]{1,6}$|^https?:/;

  // 两条分隔线之间的整段是替用户起草的稿子（和后端规则里「两条分隔线之间」是同一件事）。
  const betweenRules = (el) => {
    for (let depth = 0; el && depth < 6 && !el.matches(SPEECH); depth += 1, el = el.parentElement) {
      let before = el.previousElementSibling, after = el.nextElementSibling;
      while (before && before.tagName !== 'HR') before = before.previousElementSibling;
      if (!before) continue;
      while (after && after.tagName !== 'HR') after = after.nextElementSibling;
      if (after) return true;
    }
    return false;
  };

  const speaks = (node) => {
    const parent = node.parentElement;
    if (!parent || !parent.closest(SPEECH) || parent.closest(SKIP)) return false;
    // 工具组（含过程卡里的工具步骤）只放行其中的说明句行。
    if (parent.closest(TOOL_GROUP) && !parent.closest('.chat-timeline-text-row')) return false;
    if (betweenRules(parent)) return false;
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
