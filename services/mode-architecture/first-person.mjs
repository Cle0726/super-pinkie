// 碧琪说话时把第一人称「我」呈现为「碧琪」。只改给人看的文字，不改模型和会话记录。
// 规则：
// - 代码块、行内代码、链接地址里的字一律不动（改了会让代码、路径、网址失效）；
// - 「我们 / 我們」是包括对方的说法，换成「碧琪们」会说错意思，保持原样；
// - 「自我、忘我、无我、唯我独尊、敌我、尔虞我诈、卿卿我我、我行我素、舍我其谁」等
//   词语里的「我」不是在说碧琪自己，保持原样；
// - 已经替换过的文字再跑一遍结果不变。
// 同一份实现也内嵌在 services/first-person-renderer/index.mjs（独立插件包不能跨目录引用），
// tests/first-person-renderer.test.mjs 会检查两份行为一致。

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

export function renderFirstPerson(value) {
  if (typeof value !== 'string' || !value.includes('我')) return value;
  let out = '', last = 0;
  for (const match of value.matchAll(PROTECTED)) {
    out += replacePlain(value.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + replacePlain(value.slice(last));
}
