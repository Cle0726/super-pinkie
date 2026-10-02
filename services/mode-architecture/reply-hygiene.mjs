// 回复卫生：落盘前删掉模型漏进正文的内部自检。
//
// 提示词已经要求「自检在心里完成、不写进回复」，但 Gemini 这类模型仍会把
// 「（执行【出题自检门禁】：纯净裸题，零前戏、零暗示👇）」这样的自我声明写进
// 回复，偶尔还会先写一段带答案的解题草稿，再列一张「执行【出题自检门禁】：」
// 清单，最后才是真正的题目。这里只认这几种明确的形状，不做模糊改写；
// 清理后如果没剩下像样的内容，就保留原文。

const GATE = '【[^】\\n]{0,24}(?:自检|门禁)[^】\\n]{0,24}】';
// 括号里的自我声明：「（严格执行【出题自检门禁】：纯净裸题…👇）」
const GATE_ASIDE = new RegExp(`\\s*[（(][^（）()\\n]{0,40}${GATE}[^（）()\\n]{0,160}[）)]`, 'gu');
// 单独成行的清单标题：「执行【出题自检门禁】：」
const GATE_HEADER = new RegExp(`^\\s*(?:[-*•+]\\s*)?(?:\\*\\*)?(?:严格)?(?:执行|启动|进行|完成)?\\s*${GATE}(?:\\*\\*)?\\s*[:：]?\\s*$`, 'u');
// 整行都是在宣布执行自检：「严格执行【出题自检门禁】：纯净裸题…」
const GATE_LINE = new RegExp(`^\\s*(?:[-*•+]\\s*)?[（(]?\\s*(?:\\*\\*)?(?:严格)?(?:执行|启动|进行|完成)\\s*${GATE}`, 'u');
const LIST_ITEM = /^\s*(?:[-*•+]|\d+[.)、])\s+/u;
// 写给先生看的话总会称呼先生；解题草稿不会。
const ADDRESSED = /先生|碧琪/u;
const MIN_KEPT = 30;   // 去掉草稿前，后面至少要剩这么多正文
const MIN_LEFT = 12;   // 清理后至少要剩这么多字

const meaningful = (text) => text.replace(/[\s\p{P}\p{S}]/gu, '').length;

// 模型有时把真正的正文直接粘在清单最后一条后面：
// 「- 格式规范：单道题，等待先生作答！**太帅了先生！全中！** 🎯」
// 「- 只有纯净裸题，等待先生作答！### 📝 真题 · 第 34 题」
// 去掉清单时把粘着的标题或加粗正文留下来。
function salvageGlued(item = '') {
  const heading = item.search(/#{1,6}\s/u);
  if (heading > 0) return [item.slice(heading).trim(), ''];
  const bold = item.indexOf('**');
  if (bold > 0) {
    const head = item.slice(0, bold);
    const cut = Math.max(head.lastIndexOf('！'), head.lastIndexOf('。'), head.lastIndexOf('!'), head.lastIndexOf('?'), head.lastIndexOf('？'));
    if (cut >= 0) return [item.slice(cut + 1).trim(), ''];
  }
  return [];
}

export function cleanReplyText(text = '') {
  const original = String(text ?? '');
  if (!original || !new RegExp(GATE, 'u').test(original)) return original;
  let lines = original.split('\n');

  // 「解题草稿 + 自检清单 + 正文」：清单标题和它下面的条目一起去掉；标题前面
  // 那段如果不是对先生说的话，就是草稿（常常连答案都写了），也一起去掉。
  const header = lines.findIndex((line) => GATE_HEADER.test(line));
  if (header >= 0) {
    let end = header;
    while (end + 1 < lines.length && (LIST_ITEM.test(lines[end + 1]) || /^\s{2,}\S/u.test(lines[end + 1]))) end += 1;
    const before = lines.slice(0, header).join('\n');
    const after = [...salvageGlued(end > header ? lines[end] : ''), ...lines.slice(end + 1)];
    const dropBefore = !ADDRESSED.test(before) && meaningful(after.join('\n')) >= MIN_KEPT;
    lines = [...(dropBefore ? [] : lines.slice(0, header)), ...after];
  }

  lines = lines.filter((line) => !GATE_LINE.test(line));
  const cleaned = lines.join('\n')
    .replace(GATE_ASIDE, '')
    .replace(/[ \t]+$/gmu, '')
    .replace(/^(?:\s*(?:---|\*\*\*)\s*\n)+/u, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  // 清理后几乎什么都不剩（整条回复只有一句自我声明）时保留原文，不发空消息。
  return meaningful(cleaned) >= MIN_LEFT ? cleaned : original;
}

// 只改文字部分；没有变化时返回 null，调用方原样放行。
export function sanitizeAssistantMessage(message) {
  if (!message || message.role !== 'assistant') return null;
  if (typeof message.content === 'string') {
    const text = cleanReplyText(message.content);
    return text === message.content ? null : {...message, content: text};
  }
  if (!Array.isArray(message.content)) return null;
  let changed = false;
  const content = message.content.map((part) => {
    if (part?.type !== 'text' || typeof part.text !== 'string') return part;
    const text = cleanReplyText(part.text);
    if (text === part.text) return part;
    changed = true;
    return {...part, text};
  });
  return changed ? {...message, content} : null;
}
